const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');

// Get all parameters, optionally filtered by source
router.get('/parameters', async (req, res) => {
  const { source } = req.query;
  try {
    let query = supabase.from('qc_parameters').select('*').order('created_at', { ascending: true });
    
    if (source) {
      query = query.eq('source', source);
    }
    
    const { data, error } = await query;
    if (error) throw error;
    
    res.json(data);
  } catch (error) {
    console.error('Error fetching parameters:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a new parameter
router.post('/parameters', async (req, res) => {
  const { source, category, parameter, description, param_id, category_weight_pct, scale, polarity, embedded_breach_flag, evidence_required } = req.body;
  if (!source || !category || !parameter || !description) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .insert([{ source, category, parameter, description, param_id, category_weight_pct, scale, polarity, embedded_breach_flag, evidence_required }])
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Error adding parameter:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a parameter
router.put('/parameters/:id', async (req, res) => {
  const { id } = req.params;
  const { source, category, parameter, description, param_id, category_weight_pct, scale, polarity, embedded_breach_flag, evidence_required } = req.body;
  
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .update({ source, category, parameter, description, param_id, category_weight_pct, scale, polarity, embedded_breach_flag, evidence_required })
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error updating parameter:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete a parameter
router.delete('/parameters/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from('qc_parameters')
      .delete()
      .eq('id', id);
      
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting parameter:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
