const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');

const uploadDir = path.join(__dirname, '..', 'uploads');
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
      .single();
    
    if (error) throw error;

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
    const { data: row, error: fetchErr } = await supabase.from('callizer_queue').select('status').eq('id', queue_id).single();
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
