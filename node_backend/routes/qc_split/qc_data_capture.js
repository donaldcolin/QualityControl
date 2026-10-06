const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const axios = require('axios');
const supabase = require('../../config/supabase');
const qcEngine = require('../../services/qc_engine');
const meetSync = require('../../services/meet_sync');
const { lsqParams } = require('../../config/lsq');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════
//  DATA CAPTURE QUESTIONS CRUD
// ═══════════════════════════════════════════════════════════════


router.get('/data_capture_questions', async (req, res) => {
  const { source } = req.query;
  try {
    let query = supabase.from('data_capture_questions').select('*').order('sort_order', { ascending: true });
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/data_capture_questions', async (req, res) => {
  const { source, question, label, category, description, sort_order } = req.body;
  if (!question || !label) {
    return res.status(400).json({ error: 'question and label are required' });
  }
  try {
    const { data, error } = await supabase
      .from('data_capture_questions')
      .insert([{ source: source || 'phone_call', question, label, category: category || 'Data Capture', description, sort_order }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/data_capture_questions/:id', async (req, res) => {
  const { id } = req.params;
  const { source, question, label, category, description, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from('data_capture_questions')
      .update({ source, question, label, category, description, sort_order, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/data_capture_questions/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('data_capture_questions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
