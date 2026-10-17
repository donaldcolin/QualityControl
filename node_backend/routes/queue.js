const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { extractAudioFromDrive } = require('../services/drive_audio_extractor');
const { requireAuth, requireRole } = require('../middleware/auth');
const adminOnly = requireRole(['admin', 'ai_worker']);
const {
  governAndIngestCall,
  playGate,
  pauseGate,
  stepGate,
  clearQueue,
  toggleKillswitch,
  getGovernorStatus,
  notifyPythonWorker: notifyGovernorWorker
} = require('../services/queue_governor/intake_governor');

// Enforce authentication on all queue endpoints
router.use(requireAuth);

const uploadDir = path.join(__dirname, '..', '..', 'storage', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * Notifies the Python worker with a 5s timeout.
 * Non-fatal: if worker is restarting, pending job will be processed by background polling.
 */
function notifyPythonWorker(queueId) {
  axios.post(`http://localhost:8000/api/process_audio`, { queue_id: queueId }, { timeout: 5000 })
    .catch(err => {
      console.warn(`⚠️ [Queue] Non-fatal worker notification notice for ${queueId}: ${err.message}`);
    });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir)
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + '-' + file.originalname)
  }
});
const upload = multer({ storage: storage });
const { saveBatch, getBatch } = require('../services/batch_store');

router.get('/queue', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('callizer_queue')
      .select('*')
      .order('priority', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    
    if (error) throw error;

    const prospectIds = [...new Set(data.map(q => q.prospect_id).filter(Boolean))];
    if (prospectIds.length > 0) {
      const { data: leads } = await supabase.from('leads').select('id, name').in('id', prospectIds);
      if (leads) {
        const leadMap = leads.reduce((acc, lead) => { acc[lead.id] = lead.name; return acc; }, {});
        data.forEach(q => {
          if (q.prospect_id && leadMap[q.prospect_id]) {
            q.prospect_name = leadMap[q.prospect_id];
          }
        });
      }
    }

    res.json(data);
  } catch (err) {
    console.error("Queue fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch queue" });
  }
});

// ==========================================
// 🛡️ AUTONOMOUS INTAKE GOVERNOR ENDPOINTS
// (MUST be defined BEFORE :queue_id wildcard)
// ==========================================

router.get('/queue/governor/status', async (req, res) => {
  try {
    const status = await getGovernorStatus();
    res.json(status);
  } catch (err) {
    console.error("Governor status error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/gate/play', adminOnly, async (req, res) => {
  try {
    const result = await playGate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/gate/pause', adminOnly, async (req, res) => {
  try {
    const result = await pauseGate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/gate/step', adminOnly, async (req, res) => {
  try {
    const result = await stepGate();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/gate/clear', adminOnly, async (req, res) => {
  try {
    const types = req.body?.types || ['completed', 'rejected'];
    const result = await clearQueue(types);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/governor/killswitch', adminOnly, (req, res) => {
  try {
    const { enabled } = req.body;
    const result = toggleKillswitch(enabled);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Auto-Scanner Control Routes ──────────────────────────────────────────
const { getAutoScannerStatus, pauseScanner, resumeScanner, runScanCycle } = require('../services/auto_scanner');

router.get('/queue/scanner/status', (req, res) => {
  res.json(getAutoScannerStatus());
});

router.post('/queue/scanner/pause', adminOnly, (req, res) => {
  pauseScanner();
  res.json({ success: true, status: 'paused' });
});

router.post('/queue/scanner/resume', adminOnly, (req, res) => {
  resumeScanner();
  res.json({ success: true, status: 'running' });
});

router.post('/queue/scanner/trigger', adminOnly, async (req, res) => {
  try {
    const result = await runScanCycle();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:queue_id/retry', async (req, res) => {
  try {
    const queue_id = req.params.queue_id;
    const { error } = await supabase
      .from('callizer_queue')
      .update({
        status: 'pending',
        attempt_count: 0,
        errors: '[]',
        is_gated_admitted: true
      })
      .eq('id', queue_id);

    if (error) throw error;
    notifyPythonWorker(queue_id);
    res.json({ success: true, message: "Item queued for retry" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 📋 QUEUE ITEM ROUTES (wildcard :queue_id)
// ==========================================

router.get('/queue/:queue_id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('callizer_queue')
      .select('*')
      .eq('id', req.params.queue_id)
      .maybeSingle();
    
    if (error) throw error;
    if (!data) return res.status(404).json({ error: "Queue item not found" });

    if (data.status === 'completed' && data.audio_url) {
      const { data: callData } = await supabase
        .from('calls')
        .select('id, segments')
        .eq('audio_url', data.audio_url)
        .order('id', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (callData) {
        data.result_call_id = callData.id;
        data.segments = callData.segments;
      }
    }

    res.json(data);
  } catch (err) {
    console.error("Queue item fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch queue item" });
  }
});

router.delete('/queue/:queue_id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('callizer_queue')
      .delete()
      .eq('id', req.params.queue_id);
      
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:queue_id/bump', async (req, res) => {
  try {
    const { error } = await supabase
      .from('callizer_queue')
      .update({ created_at: new Date().toISOString() })
      .eq('id', req.params.queue_id);
      
    if (error) throw error;

    notifyPythonWorker(req.params.queue_id);

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/queue/:queue_id/send_to_qc', async (req, res) => {
  try {
    const queue_id = req.params.queue_id;
    const { data: row, error: fetchErr } = await supabase.from('callizer_queue').select('status').eq('id', queue_id).maybeSingle();
    if (fetchErr || !row) return res.status(404).json({ error: "Not found" });
    if (row.status !== 'pending_manual_review' && row.status !== 'pending' && row.status !== 'paused') return res.status(400).json({ error: `Invalid status: ${row.status}` });

    const { error: updateErr } = await supabase.from('callizer_queue').update({ status: 'pending', is_gated_admitted: true }).eq('id', queue_id);
    if (updateErr) throw updateErr;

    notifyPythonWorker(queue_id);

    res.json({ status: "queued" });
  } catch (err) {
    console.error("Send to QC error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Governor & gate routes already defined above (before :queue_id wildcard)

router.post('/upload_run', upload.array('files'), async (req, res) => {
  try {
    const { language } = req.body;
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const batchId = uuidv4();
    const queueIds = [];
    const skippedItems = [];

    for (const file of files) {
      const absolutePath = path.resolve(file.path);
      const ingestRes = await governAndIngestCall({
        source: 'upload',
        callId: file.originalname,
        audioUrl: absolutePath,
        fileSizeBytes: file.size,
        durationSec: 0,
        callType: 'Local Upload',
        language: language || 'hi',
        priority: 2
      });

      if (ingestRes.admitted) {
        queueIds.push(ingestRes.queueId);
      } else {
        skippedItems.push({
          filename: file.originalname,
          reason: ingestRes.reason,
          status: ingestRes.status
        });
      }
    }

    saveBatch(batchId, queueIds);
    res.json({
      batch_id: batchId,
      total_admitted: queueIds.length,
      skipped: skippedItems
    });
  } catch (err) {
    console.error("Upload run error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload_drive_demo', async (req, res) => {
  try {
    const { drive_link, language, prospect_id } = req.body;
    
    if (!drive_link) {
      return res.status(400).json({ error: "Missing drive_link" });
    }

    // Governor safety checks (killswitch + dedup + rate limit)
    const { getEmergencyKillswitch } = require('../services/queue_governor/intake_governor');
    if (getEmergencyKillswitch()) {
      return res.status(503).json({ error: "Emergency killswitch is active. Intake halted." });
    }

    const { computeAudioFingerprint, checkDuplicate } = require('../services/queue_governor/dedup_engine');
    const dedupHash = computeAudioFingerprint({
      source: 'google_meet',
      externalId: drive_link,
      audioUrl: drive_link
    });
    const dupCheck = await checkDuplicate(dedupHash);
    if (dupCheck.isDuplicate) {
      return res.status(409).json({ 
        error: "Duplicate video demo already exists in queue.",
        existingItem: dupCheck.existingItem 
      });
    }

    const queue_id = uuidv4();
    
    // Insert into Queue immediately as Priority 1 (Urgent Demo)
    const { error: insertErr } = await supabase.from('callizer_queue').insert({
      id: queue_id,
      call_id: `Video Demo - ${prospect_id || queue_id.slice(0, 8)}`,
      audio_url: 'Downloading from Google Drive...',
      language: language || 'hi',
      status: 'Downloading Video...',
      priority: 1, // Priority 1 Express Pass
      source_type: 'google_meet',
      dedup_hash: dedupHash,
      emp_number: '',
      client_number: '',
      prospect_id: prospect_id || null,
      call_type: 'Video Demo',
      duration: 0,
      errors: '[]',
      is_gated_admitted: true
    });

    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    // Send response immediately so UI doesn't hang
    res.json({ queue_id, status: "queued", priority: 1 });

    // Download & extract in background
    (async () => {
        try {
            // 2. Download and Extract Audio to local mp3
            const localAudioPath = await extractAudioFromDrive(drive_link, queue_id);
            
            // 3. Update Queue item to pending (P1 Express Pass)
            await supabase.from('callizer_queue').update({
                audio_url: localAudioPath,
                status: 'pending',
                is_gated_admitted: true
            }).eq('id', queue_id);

            // 4. Notify Python Worker with timeout
            notifyPythonWorker(queue_id);
            
            console.log(`[Drive] Successfully queued Urgent Video Demo ${queue_id} (Priority 1)`);
        } catch (err) {
            console.error(`[Drive] Failed to process ${queue_id}:`, err);
            try {
              const errorEntry = {
                stage: 'drive_download_and_extraction',
                error: err.message,
                timestamp: new Date().toISOString()
              };
              await supabase.from('callizer_queue').update({
                status: 'failed',
                errors: JSON.stringify([errorEntry])
              }).eq('id', queue_id);
              console.log(`[Drive] Marked queue item ${queue_id} as 'failed' in Supabase.`);
            } catch (dbErr) {
              console.error(`[Drive] Failed to mark queue ${queue_id} as failed:`, dbErr.message);
            }
        }
    })();

  } catch (err) {
    console.error("Upload drive demo error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  try {
    const { folder_path, language } = req.body;
    
    if (!folder_path || !fs.existsSync(folder_path)) {
      return res.status(400).json({ error: "Invalid folder path" });
    }

    const stat = fs.statSync(folder_path);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }

    const files = fs.readdirSync(folder_path).filter(f => 
      f.endsWith('.wav') || f.endsWith('.mp3') || f.endsWith('.m4a') || f.endsWith('.flac') || f.endsWith('.ogg') || f.endsWith('.webm')
    );

    if (files.length === 0) {
      return res.status(400).json({ error: "No supported audio files found in directory" });
    }

    const batchId = uuidv4();
    const queueIds = [];
    const skippedItems = [];

    for (const filename of files) {
      const absolutePath = path.resolve(path.join(folder_path, filename));
      const fileStat = fs.statSync(absolutePath);

      const ingestRes = await governAndIngestCall({
        source: 'local_folder',
        callId: filename,
        audioUrl: absolutePath,
        fileSizeBytes: fileStat.size,
        durationSec: 0,
        callType: 'Local Folder',
        language: language || 'hi',
        priority: 2
      });

      if (ingestRes.admitted) {
        queueIds.push(ingestRes.queueId);
      } else {
        skippedItems.push({
          filename,
          reason: ingestRes.reason,
          status: ingestRes.status
        });
      }
    }

    saveBatch(batchId, queueIds);
    res.json({
      batch_id: batchId,
      total_admitted: queueIds.length,
      skipped: skippedItems
    });
  } catch (err) {
    console.error("Folder run error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:batchId/status', async (req, res) => {
  try {
    const batchId = req.params.batchId;
    const queueIds = getBatch(batchId);
    
    if (!queueIds || queueIds.length === 0) {
      return res.status(404).json({ error: "Batch not found or empty" });
    }

    const { data, error } = await supabase
      .from('callizer_queue')
      .select('*')
      .in('id', queueIds);

    if (error) throw error;

    let doneCount = 0;
    let failCount = 0;
    let allErrors = [];
    let segments = null;

    for (const item of data) {
      if (item.status === 'completed') doneCount++;
      if (item.status === 'failed') failCount++;
      
      try {
        const itemErrs = JSON.parse(item.errors);
        if (Array.isArray(itemErrs) && itemErrs.length > 0) {
          allErrors.push(...itemErrs.map(e => `${item.call_id}: ${e}`));
        }
      } catch(e) {}

      if (item.status === 'completed' && !segments && item.audio_url) {
        const { data: callData } = await supabase
          .from('calls')
          .select('segments')
          .eq('audio_url', item.audio_url)
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (callData) {
          segments = callData.segments;
        }
      }
    }

    let overallStatus = 'processing';
    let progressMsg = `${doneCount} / ${queueIds.length} files`;
    
    if (doneCount + failCount === queueIds.length) {
      if (failCount === queueIds.length) {
        overallStatus = 'failed';
        progressMsg = "All files failed";
      } else {
        overallStatus = 'completed';
        progressMsg = "Processing finished";
      }
    }

    res.json({
      status: overallStatus,
      progress_msg: progressMsg,
      errors: JSON.stringify(allErrors),
      done_files: doneCount,
      total_files: queueIds.length,
      segments: segments
    });

  } catch (err) {
    console.error("Batch status error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
