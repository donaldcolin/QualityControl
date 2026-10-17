const supabase = require('../config/supabase');
const { getExecutionMode } = require('../routes/qc_split/qc_mode');
const { getLeadsForAssociate, getActivitiesForLead, pushActivityToQCQueue } = require('./lead_service');

let _scannerTimer = null;
let _isScanning = false;
let _isPaused = false;
let _lastScanResult = null;
let _scanCount = 0;

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_QUEUE_PER_CYCLE = 3; // Don't flood ASR — queue at most 3 new calls per cycle

/**
 * Runs one full scan cycle: Associates → Leads → Activities → Queue
 * Only executes in PROD mode. Respects pause state and per-cycle cap.
 */
async function runScanCycle() {
  const mode = getExecutionMode();
  if (mode !== 'prod') return { skipped: true, reason: 'Not in PROD mode' };
  if (_isPaused) return { skipped: true, reason: 'Scanner is paused' };
  if (_isScanning) return { skipped: true, reason: 'Previous scan still running' };

  // Check current queue depth — skip if ASR is already busy
  if (supabase) {
    try {
      const { count } = await supabase
        .from('callizer_queue')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("completed","failed","dead_letter","rejected","paused")');

      if (count && count >= MAX_QUEUE_PER_CYCLE) {
        console.log(`[AutoScanner] Skipping — ${count} items already active in queue.`);
        return { skipped: true, reason: `${count} items already active` };
      }
    } catch (err) {
      // Non-fatal, continue with scan
    }
  }

  _isScanning = true;
  _scanCount++;
  const cycleId = _scanCount;
  const startTime = Date.now();

  let queued = 0;
  let skipped = 0;
  let errors = 0;
  let leadsScanned = 0;

  try {
    const { data: associates, error: assocErr } = await supabase
      .from('qc_associates')
      .select('emp_number, emp_name, emp_tags');

    if (assocErr || !associates || associates.length === 0) {
      console.warn(`[AutoScanner] Cycle #${cycleId}: No associates found.`);
      return { skipped: true, reason: 'No associates' };
    }

    console.log(`🔄 [AutoScanner] Cycle #${cycleId} started — scanning ${associates.length} associates (max ${MAX_QUEUE_PER_CYCLE} per cycle)...`);

    for (const assoc of associates) {
      // Stop early if we hit the per-cycle cap or got paused mid-scan
      if (queued >= MAX_QUEUE_PER_CYCLE || _isPaused) break;

      // Extract associate language (e.g. |lang:ta -> 'ta', fallback 'hi')
      let assocLang = 'hi';
      if (assoc.emp_tags) {
        const match = assoc.emp_tags.match(/\|lang:([a-z]{2})/i);
        if (match) assocLang = match[1].toLowerCase();
      }

      try {
        const leads = await getLeadsForAssociate(assoc.emp_number, 1, 50);

        for (const lead of leads) {
          if (queued >= MAX_QUEUE_PER_CYCLE || _isPaused) break;
          leadsScanned++;

          try {
            const activities = await getActivitiesForLead(lead.prospect_id);

            for (const act of activities) {
              if (queued >= MAX_QUEUE_PER_CYCLE || _isPaused) break;
              if (!act.resource_url || !act.duration || act.duration <= 60) continue;

              try {
                const result = await pushActivityToQCQueue({
                  activity_id: act.activity_id,
                  resource_url: act.resource_url,
                  duration: act.duration,
                  type: act.type,
                  prospect_id: act.prospect_id,
                  emp_number: assoc.emp_number,
                  client_number: lead.phone || '',
                  language: assocLang,
                  lead_name: lead.name,
                  lead_source: lead.lead_source,
                  call_date: act.created_on
                });

                if (result && result.status === 'queued') {
                  queued++;
                  console.log(`📥 [AutoScanner] Queued call ${act.activity_id} for ${assoc.emp_name} [${assocLang.toUpperCase()}]`);
                }
              } catch (pushErr) {
                if (pushErr.isAlreadyQueued || pushErr.message?.includes('Already queued') || pushErr.message?.includes('duplicate')) {
                  skipped++;
                } else {
                  errors++;
                  if (errors <= 3) {
                    console.warn(`[AutoScanner] Push error: ${pushErr.message}`);
                  }
                }
              }
            }
          } catch (leadErr) {
            if (!(leadErr.code === 'ECONNABORTED' || leadErr.message?.includes('timeout'))) {
              errors++;
            }
          }
        }
      } catch (assocErr) {
        if (!(assocErr.code === 'ECONNABORTED' || assocErr.message?.includes('timeout'))) {
          errors++;
        }
      }
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    _lastScanResult = {
      cycle: cycleId,
      timestamp: new Date().toISOString(),
      durationSec,
      associates: associates.length,
      leadsScanned,
      queued,
      skipped,
      errors
    };

    if (queued > 0) {
      console.log(`✅ [AutoScanner] Cycle #${cycleId} done in ${durationSec}s — Queued: ${queued}/${MAX_QUEUE_PER_CYCLE}, Skipped: ${skipped}`);
    } else {
      console.log(`✅ [AutoScanner] Cycle #${cycleId} done in ${durationSec}s — No new calls (${skipped} already queued).`);
    }

    return _lastScanResult;
  } catch (fatalErr) {
    console.error(`❌ [AutoScanner] Cycle #${cycleId} fatal error:`, fatalErr.message);
    _lastScanResult = { cycle: cycleId, timestamp: new Date().toISOString(), error: fatalErr.message };
    return _lastScanResult;
  } finally {
    _isScanning = false;
  }
}

/**
 * Starts the auto-scanner daemon.
 */
function startAutoScannerDaemon(intervalMs = DEFAULT_INTERVAL_MS) {
  if (_scannerTimer) return;

  console.log(`🔍 [AutoScanner] Starting PROD auto-scanner daemon (Interval: ${Math.round(intervalMs / 60000)}m, Max per cycle: ${MAX_QUEUE_PER_CYCLE})`);

  // First scan after 60s boot delay
  setTimeout(() => {
    runScanCycle().catch(err => console.warn(`[AutoScanner] Boot scan error: ${err.message}`));
  }, 60 * 1000);

  _scannerTimer = setInterval(() => {
    runScanCycle().catch(err => console.error(`[AutoScanner] Scan error: ${err.message}`));
  }, intervalMs);

  if (_scannerTimer.unref) _scannerTimer.unref();
}

function stopAutoScannerDaemon() {
  if (_scannerTimer) {
    clearInterval(_scannerTimer);
    _scannerTimer = null;
    console.log('🛑 [AutoScanner] Daemon stopped.');
  }
}

function pauseScanner() {
  _isPaused = true;
  console.log('⏸️ [AutoScanner] Paused.');
}

function resumeScanner() {
  _isPaused = false;
  console.log('▶️ [AutoScanner] Resumed.');
}

function getAutoScannerStatus() {
  return {
    active: !!_scannerTimer,
    isPaused: _isPaused,
    isScanning: _isScanning,
    totalCycles: _scanCount,
    maxPerCycle: MAX_QUEUE_PER_CYCLE,
    lastResult: _lastScanResult
  };
}

module.exports = {
  startAutoScannerDaemon,
  stopAutoScannerDaemon,
  pauseScanner,
  resumeScanner,
  getAutoScannerStatus,
  runScanCycle
};
