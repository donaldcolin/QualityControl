const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const supabase = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');

// Storage directory allowed for local audio files
const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');

// Enforce authentication across all call endpoints
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { data, error } = await supabase.from('calls').select('id, filename, language, duration_sec, rating, notes');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

router.get('/:call_id', async (req, res) => {
  const { data, error } = await supabase.from('calls').select('*').eq('id', req.params.call_id).single();
  if (error || !data) return res.status(404).json({ error: "Not found" });

  if (data.segments && typeof data.segments === 'string') {
    try { data.segments = JSON.parse(data.segments); } catch(e){}
  }
  res.json(data);
});

router.get('/:call_id/audio', async (req, res) => {
  const { data, error } = await supabase.from('calls').select('audio_url').eq('id', req.params.call_id).single();
  if (error || !data || !data.audio_url) return res.status(404).json({ error: "Audio URL not found" });
  
  if (data.audio_url.startsWith('http://') || data.audio_url.startsWith('https://')) {
    return res.redirect(data.audio_url);
  }

  // Path containment & traversal prevention
  const resolvedPath = path.isAbsolute(data.audio_url)
    ? path.resolve(data.audio_url)
    : path.resolve(STORAGE_ROOT, data.audio_url);

  const relative = path.relative(STORAGE_ROOT, resolvedPath);
  const isContained = !relative.startsWith('..') && !path.isAbsolute(relative);

  if (!isContained) {
    console.warn(`[Security Alert] Blocked directory traversal attempt for call ${req.params.call_id}: "${data.audio_url}"`);
    return res.status(403).json({ error: "Access denied: Target file is outside authorized storage directory" });
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: "Local audio file not found" });
  }

  res.sendFile(resolvedPath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).json({ error: "Failed to stream audio file" });
    }
  });
});

router.post('/:call_id/rating', async (req, res) => {
  const { rating, notes } = req.body;
  const { error } = await supabase.from('calls').update({ rating, notes }).eq('id', req.params.call_id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ status: "ok" });
});

router.post('/:call_id/send_to_asr', async (req, res) => {
  try {
    const { data: callRow, error: fetchErr } = await supabase.from('calls').select('*').eq('id', req.params.call_id).single();
    if (fetchErr || !callRow) return res.status(404).json({ error: "Call not found" });

    const { v4: uuidv4 } = require('uuid');
    const queue_id = uuidv4();
    
    // We insert a new queue item linked to this call_id
    const { error: insertErr } = await supabase.from('callizer_queue').insert({
      id: queue_id,
      call_id: callRow.id, // using call_id as activity_id
      audio_url: callRow.audio_url || '',
      language: callRow.language || 'hi',
      status: 'pending',
      emp_number: callRow.emp_number || '',
      client_number: callRow.client_number || '',
      call_type: callRow.call_type || '',
      duration: callRow.duration_sec || 0,
      prospect_id: callRow.prospect_id || '',
      errors: '[]'
    });

    if (insertErr) throw insertErr;
    res.json({ status: "queued", queue_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
