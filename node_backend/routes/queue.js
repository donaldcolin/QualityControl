const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { extractAudioFromDrive } = require('../services/drive_audio_extractor');
const { requireAuth } = require('../middleware/auth');

// Enforce authentication on all queue endpoints
router.use(requireAuth);

const uploadDir = path.join(__dirname, '..', '..', 'storage', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
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

const localBatches = new Map();

router.get('/queue', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('callizer_queue')
      .select('*')
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

    axios.post(`http://localhost:8000/api/process_audio`, { queue_id: req.params.queue_id }).catch(err => {
      console.error("Failed to notify python worker:", err.message);
    });

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
    if (row.status !== 'pending_manual_review' && row.status !== 'pending') return res.status(400).json({ error: `Invalid status: ${row.status}` });

    const { error: updateErr } = await supabase.from('callizer_queue').update({ status: 'pending' }).eq('id', queue_id);
    if (updateErr) throw updateErr;

    axios.post(`http://localhost:8000/api/process_audio`, { queue_id }).catch(err => {
      console.error("Failed to notify python worker:", err.message);
    });

    res.json({ status: "queued" });
  } catch (err) {
    console.error("Send to QC error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/upload_run', upload.array('files'), async (req, res) => {
  try {
    const { language } = req.body;
    const files = req.files;
    
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No files uploaded" });
    }

    const batchId = uuidv4();
    const queueIds = [];

    for (const file of files) {
      const queue_id = uuidv4();
      const absolutePath = path.resolve(file.path);
      
      const { error: insertErr } = await supabase.from('callizer_queue').insert({
        id: queue_id,
        call_id: file.originalname,
        audio_url: absolutePath,
        language: language || 'hi',
        status: 'pending',
        emp_number: '',
        client_number: '',
        call_type: 'Local Upload',
        duration: 0,
        errors: '[]'
      });

      if (insertErr) throw insertErr;
      queueIds.push(queue_id);

      axios.post(`http://localhost:8000/api/process_audio`, { queue_id }).catch(err => {
        console.error("Failed to notify python worker:", err.message);
      });
    }

    localBatches.set(batchId, queueIds);
    res.json({ batch_id: batchId });
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

    const queue_id = uuidv4();
    
    // 1. Insert into Queue immediately so UI sees it as Downloading
    const { error: insertErr } = await supabase.from('callizer_queue').insert({
      id: queue_id,
      call_id: `Video Demo - ${prospect_id || queue_id}`,
      audio_url: 'Downloading from Google Drive...',
      language: language || 'hi',
      status: 'Downloading Video...',
      emp_number: '',
      client_number: '',
      prospect_id: prospect_id || null,
      call_type: 'Video Demo',
      duration: 0,
      errors: '[]'
    });

    if (insertErr) {
      return res.status(500).json({ error: insertErr.message });
    }

    // Send response immediately so UI doesn't hang while downloading 2GB video
    res.json({ queue_id, status: "queued" });

    // Download in background
    (async () => {
        try {
            // 2. Download and Extract Audio to local mp3
            const localAudioPath = await extractAudioFromDrive(drive_link, queue_id);
            
            // 3. Update the Queue item to pending with the local audio path
            await supabase.from('callizer_queue').update({
                audio_url: localAudioPath,
                status: 'pending' // Python worker will pick it up now
            }).eq('id', queue_id);

            // 4. Notify Python Worker
            axios.post(`http://localhost:8000/api/process_audio`, { queue_id }).catch(err => {
              console.error("Failed to notify python worker:", err.message);
            });
            
            console.log(`[Drive] Successfully queued Video Demo ${queue_id}`);
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

    for (const filename of files) {
      const queue_id = uuidv4();
      const absolutePath = path.resolve(path.join(folder_path, filename));
      
      const { error: insertErr } = await supabase.from('callizer_queue').insert({
        id: queue_id,
        call_id: filename,
        audio_url: absolutePath,
        language: language || 'hi',
        status: 'pending',
        emp_number: '',
        client_number: '',
        call_type: 'Local Folder',
        duration: 0,
        errors: '[]'
      });

      if (insertErr) throw insertErr;
      queueIds.push(queue_id);

      axios.post(`http://localhost:8000/api/process_audio`, { queue_id }).catch(err => {
        console.error("Failed to notify python worker:", err.message);
      });
    }

    localBatches.set(batchId, queueIds);
    res.json({ batch_id: batchId });
  } catch (err) {
    console.error("Folder run error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/runs/:batchId/status', async (req, res) => {
  try {
    const batchId = req.params.batchId;
    const queueIds = localBatches.get(batchId);
    
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
