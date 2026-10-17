const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const supabase = require('../../config/supabase');
const { computeAudioFingerprint, checkDuplicate } = require('./dedup_engine');
const { screenAudio } = require('./t0_screener');
const { checkAdmission, PRIORITY_TIERS } = require('./leaky_bucket');
const { getExecutionMode } = require('../../routes/qc_split/qc_mode');

// In DEV mode, gate starts PAUSED so user has complete manual control (Play / Pause / Step 1)
// In PROD mode, gate runs 24/7 autonomously
let _gateState = 'paused';
let _emergencyKillswitch = false;

/**
 * Notifies the Python worker with a non-fatal timeout.
 */
function notifyPythonWorker(queueId) {
  axios.post(`http://localhost:8000/api/process_audio`, { queue_id: queueId }, { timeout: 5000 })
    .catch(err => {
      console.warn(`⚠️ [Governor] Worker notification notice for ${queueId}: ${err.message}`);
    });
}

/**
 * Resolves priority tier from call metadata
 */
function resolvePriority({ priority, source, callType, audioUrl }) {
  if (priority && [1, 2, 3].includes(Number(priority))) {
    return Number(priority);
  }
  const normType = String(callType || '').toLowerCase();
  const normSource = String(source || '').toLowerCase();
  const normUrl = String(audioUrl || '').toLowerCase();

  if (normType.includes('demo') || normType.includes('video') || normSource.includes('meet') || normUrl.endsWith('.mp4') || normUrl.includes('drive.google.com')) {
    return PRIORITY_TIERS.URGENT_DEMO; // 1
  }
  if (normType.includes('backfill') || normSource.includes('csv') || normSource.includes('backfill')) {
    return PRIORITY_TIERS.BACKFILL; // 3
  }
  return PRIORITY_TIERS.STANDARD_CALL; // 2
}

/**
 * Main admission & intake governor entry point.
 */
async function governAndIngestCall({
  source = 'phone_call',
  callId,
  audioUrl,
  durationSec = 0,
  fileSizeBytes = 0,
  callType,
  prospectId,
  language = 'hi',
  priority,
  empNumber = '',
  clientNumber = '',
  callDate
}) {
  const mode = getExecutionMode();

  // 0. Resolve language from associate tags if missing or defaulted to 'hi'
  let effectiveLanguage = language;
  if (empNumber && (!effectiveLanguage || effectiveLanguage === 'hi') && supabase) {
    try {
      const { data: assoc } = await supabase
        .from('qc_associates')
        .select('emp_tags')
        .eq('emp_number', empNumber)
        .maybeSingle();
      if (assoc && assoc.emp_tags) {
        const match = assoc.emp_tags.match(/\|lang:([a-z]{2})/i);
        if (match) {
          effectiveLanguage = match[1].toLowerCase();
        }
      }
    } catch (e) {
      // non-fatal
    }
  }
  if (!effectiveLanguage) effectiveLanguage = 'hi';

  // 1. Emergency Killswitch Check (PROD Mode safety)
  if (_emergencyKillswitch) {
    return {
      admitted: false,
      status: 'rejected_killswitch',
      reason: 'Emergency Killswitch is ACTIVE. Intake halted.'
    };
  }

  // 2. Resolve Priority Tier
  const resolvedPriority = resolvePriority({ priority, source, callType, audioUrl });

  // 3. Leaky-Bucket Rate Limiting (500-item ceiling with P1 bypass)
  const admission = await checkAdmission(resolvedPriority);
  if (!admission.allowed) {
    return {
      admitted: false,
      status: 'deferred_overflow',
      watermark: admission.watermark,
      currentBuffered: admission.currentBuffered,
      reason: admission.message
    };
  }

  // 4. Audio Fingerprint Deduplication (SHA-256)
  const dedupHash = computeAudioFingerprint({
    source,
    externalId: callId,
    durationSec,
    audioUrl,
    filename: callId
  });

  const dupCheck = await checkDuplicate(dedupHash);
  if (dupCheck.isDuplicate) {
    console.log(`🛡️ [Governor] Deduplication hit for ${callId} (${dedupHash.slice(0, 12)}...). Skipping redundant ASR.`);
    return {
      admitted: false,
      status: 'duplicate_skipped',
      existingItem: dupCheck.existingItem,
      reason: 'Duplicate audio fingerprint detected. Processing skipped.'
    };
  }

  // 5. T0 Fast-Path Audio Screening (Pre-ASR Filter)
  const screening = screenAudio({
    durationSec,
    fileSizeBytes,
    callType
  });

  const queueId = uuidv4();

  if (!screening.shouldProcess) {
    console.log(`⚡ [Governor] T0 Fast-Path rejected ${callId}: ${screening.reason}`);
    // Save to queue with status 'rejected' so it's logged in audit trail without consuming ASR/LLM resources
    if (supabase) {
      await supabase.from('callizer_queue').insert({
        id: queueId,
        call_id: callId || `call_${Date.now()}`,
        audio_url: audioUrl || 'none',
        language: effectiveLanguage,
        status: 'rejected',
        priority: resolvedPriority,
        source_type: source,
        dedup_hash: dedupHash,
        is_gated_admitted: false,
        emp_number: empNumber,
        client_number: clientNumber,
        call_type: callType || 'Non-Pitch',
        duration: durationSec,
        errors: JSON.stringify([screening.reason]),
        buffered_at: new Date().toISOString()
      }).catch(err => console.warn(`[Governor] T0 insert warning: ${err.message}`));
    }

    return {
      admitted: false,
      status: 'rejected_t0',
      reason: screening.reason,
      queueId
    };
  }

  // 6. DEV vs PROD Hardware Gating
  let isGatedAdmitted = false;
  if (mode === 'prod') {
    // PROD MODE (Lights-out): All valid items admitted immediately
    isGatedAdmitted = true;
  } else {
    // DEV MODE (M1 MacBook Air): Gated execution
    if (_gateState === 'running') {
      isGatedAdmitted = true;
    } else if (_gateState === 'step') {
      isGatedAdmitted = true;
      _gateState = 'paused'; // Auto-pause after admitting 1 item
    } else {
      isGatedAdmitted = false; // Paused: wait for manual UI trigger
    }
  }

  const initialStatus = isGatedAdmitted ? 'pending' : 'paused';

  // 7. Atomic Insert into Supabase
  if (supabase) {
    const insertPayload = {
      id: queueId,
      call_id: callId || `call_${Date.now()}`,
      audio_url: audioUrl,
      language: effectiveLanguage,
      status: initialStatus,
      priority: resolvedPriority,
      source_type: source,
      dedup_hash: dedupHash,
      is_gated_admitted: isGatedAdmitted,
      emp_number: empNumber,
      client_number: clientNumber,
      prospect_id: prospectId || null,
      call_type: callType || (resolvedPriority === 1 ? 'Video Demo' : 'Outbound'),
      duration: durationSec,
      errors: '[]',
      buffered_at: new Date().toISOString()
    };
    if (callDate) insertPayload.call_date = callDate;

    const { error: insertErr } = await supabase.from('callizer_queue').insert(insertPayload);
    if (insertErr) {
      console.error(`[Governor] Insert error for ${callId}:`, insertErr.message);
      throw insertErr;
    }
  }

  // 8. Wake up worker if admitted
  if (isGatedAdmitted) {
    notifyPythonWorker(queueId);
  }

  console.log(`📥 [Governor] Ingested ${callId} [P${resolvedPriority} | Status: ${initialStatus} | Mode: ${mode.toUpperCase()}]`);

  return {
    admitted: true,
    queueId,
    status: initialStatus,
    priority: resolvedPriority,
    dedupHash,
    mode
  };
}

/**
 * DEV MODE: Play Queue (Admits all paused items and resumes continuous processing)
 */
async function playGate() {
  _gateState = 'running';
  console.log(`▶️ [Governor] Queue GATE opened: RUNNING`);

  if (!supabase) return { gateState: _gateState, admittedCount: 0 };

  try {
    const { data, error } = await supabase
      .from('callizer_queue')
      .update({
        status: 'pending',
        is_gated_admitted: true
      })
      .in('status', ['paused', 'buffered'])
      .select('id');

    if (error) throw error;

    const admittedCount = data ? data.length : 0;
    if (admittedCount > 0) {
      notifyPythonWorker('bulk_wake');
    }
    return { gateState: _gateState, admittedCount };
  } catch (err) {
    console.error(`[Governor] playGate error: ${err.message}`);
    return { gateState: _gateState, admittedCount: 0, error: err.message };
  }
}

/**
 * DEV MODE: Pause Queue (Prevents new items from being processed by worker)
 */
async function pauseGate() {
  _gateState = 'paused';
  console.log(`⏸️ [Governor] Queue GATE paused.`);

  if (!supabase) return { gateState: _gateState };

  try {
    // Only pause items not yet picked up by a worker
    await supabase
      .from('callizer_queue')
      .update({
        status: 'paused',
        is_gated_admitted: false
      })
      .eq('status', 'pending')
      .is('worker_id', null);

    return { gateState: _gateState };
  } catch (err) {
    console.error(`[Governor] pauseGate error: ${err.message}`);
    return { gateState: _gateState, error: err.message };
  }
}

/**
 * DEV MODE: Step 1 File (Admits exactly ONE oldest/highest-priority item)
 */
async function stepGate() {
  _gateState = 'paused'; // stays in paused mode after step
  console.log(`⏭️ [Governor] Stepping 1 item...`);

  if (!supabase) return { gateState: _gateState, steppedItem: null };

  try {
    // Find next candidate ordered by priority ASC, created_at ASC
    const { data: candidates, error: fetchErr } = await supabase
      .from('callizer_queue')
      .select('id, call_id, priority, status')
      .in('status', ['paused', 'buffered'])
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchErr) throw fetchErr;
    if (!candidates || candidates.length === 0) {
      return { gateState: _gateState, steppedItem: null, message: 'No paused items to step.' };
    }

    const targetItem = candidates[0];
    const { error: updateErr } = await supabase
      .from('callizer_queue')
      .update({
        status: 'pending',
        is_gated_admitted: true
      })
      .eq('id', targetItem.id);

    if (updateErr) throw updateErr;

    notifyPythonWorker(targetItem.id);
    console.log(`⏭️ [Governor] Stepped item ${targetItem.call_id} (${targetItem.id}) into pending!`);

    return { gateState: _gateState, steppedItem: targetItem };
  } catch (err) {
    console.error(`[Governor] stepGate error: ${err.message}`);
    return { gateState: _gateState, steppedItem: null, error: err.message };
  }
}

/**
 * Clear Completed, Rejected, or Dead-Letter items
 */
async function clearQueue(types = ['completed', 'rejected']) {
  if (!supabase) return { success: true };

  try {
    const { error } = await supabase
      .from('callizer_queue')
      .delete()
      .in('status', types);

    if (error) throw error;
    console.log(`🧹 [Governor] Cleared queue items with status: ${types.join(', ')}`);
    return { success: true };
  } catch (err) {
    console.error(`[Governor] clearQueue error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Emergency Killswitch Toggle (PROD Mode safety)
 */
function toggleKillswitch(enabled) {
  _emergencyKillswitch = Boolean(enabled);
  console.log(`🚨 [Governor] Emergency Killswitch set to: ${_emergencyKillswitch ? 'ACTIVE' : 'INACTIVE'}`);
  return { emergencyKillswitch: _emergencyKillswitch };
}

/**
 * Comprehensive Governor Status
 */
async function getGovernorStatus() {
  const mode = getExecutionMode();
  let counts = {
    total: 0,
    active: 0,
    paused: 0,
    completed: 0,
    rejected: 0,
    dead_letter: 0,
    p1_urgent: 0,
    p2_standard: 0,
    p3_backfill: 0
  };

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('callizer_queue')
        .select('status, priority');

      if (!error && data) {
        counts.total = data.length;
        const TERMINAL = new Set(['completed', 'failed', 'dead_letter', 'rejected']);
        for (const item of data) {
          const s = (item.status || '').toLowerCase();
          const p = item.priority || 2;

          if (s === 'paused' || s === 'buffered') {
            counts.paused++;
          } else if (s === 'completed') {
            counts.completed++;
          } else if (s === 'rejected') {
            counts.rejected++;
          } else if (s === 'dead_letter') {
            counts.dead_letter++;
          } else if (!TERMINAL.has(s)) {
            counts.active++;
          }

          if (p === 1) counts.p1_urgent++;
          else if (p === 3) counts.p3_backfill++;
          else counts.p2_standard++;
        }
      }
    } catch (err) {
      console.warn(`[Governor] Status counts notice: ${err.message}`);
    }
  }

  return {
    mode,
    gateState: mode === 'prod' ? 'autonomous' : _gateState,
    emergencyKillswitch: _emergencyKillswitch,
    bufferCapacity: 500,
    counts,
    watermark: counts.active >= 500 ? 'OVERFLOW' : (counts.active >= 400 ? 'HIGH_WATERMARK' : 'NORMAL'),
    thermalPacing: mode === 'dev' ? 'Nominal (2s-12s Adaptive Pacing)' : 'Unconstrained (M6 Parallel)',
    concurrency: mode === 'dev' ? 1 : 4
  };
}

module.exports = {
  governAndIngestCall,
  playGate,
  pauseGate,
  stepGate,
  clearQueue,
  toggleKillswitch,
  getGovernorStatus,
  notifyPythonWorker,
  resolvePriority,
  getGateState: () => _gateState,
  getEmergencyKillswitch: () => _emergencyKillswitch
};
