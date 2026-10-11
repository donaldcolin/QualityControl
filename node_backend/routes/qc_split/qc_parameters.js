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
//  QUALITY CHECKS CRUD (uses qc_parameters table)
// ═══════════════════════════════════════════════════════════════



router.get('/quality_checks', async (req, res) => {
  const { source } = req.query;
  try {
    let query = supabase.from('qc_parameters').select('*').order('sort_order', { ascending: true });
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/quality_checks', async (req, res) => {
  const { source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order } = req.body;
  if (!category || !parameter) {
    return res.status(400).json({ error: 'category and parameter are required' });
  }
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .insert([{ source: source || 'phone_call', category, parameter, check_question, description, max_score: max_score || 10, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/quality_checks/:id', async (req, res) => {
  const { id } = req.params;
  const { source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .update({ source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/quality_checks/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('qc_parameters').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


module.exports = router;
