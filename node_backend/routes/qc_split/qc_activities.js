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
//  ACTIVITIES & QUEUE
// ═══════════════════════════════════════════════════════════════


router.post('/activities/push_to_qc', async (req, res) => {
  try {
    const { activity_id, resource_url, duration, type, prospect_id, emp_number, client_number, language, lead_name, lead_source } = req.body;

    if (!resource_url) {
      return res.status(400).json({ error: "No recording URL available for this activity" });
    }

    // Upsert lead so it's immediately tracked on the QC Leads Dashboard
    if (prospect_id) {
      let resolvedOwnerName = 'Unassigned';
      if (emp_number) {
        const { data: assoc } = await supabase.from('qc_associates').select('emp_name').eq('emp_number', emp_number).maybeSingle();
        if (assoc && assoc.emp_name) resolvedOwnerName = assoc.emp_name;
      }
      
      await supabase.from('leads').upsert({
        id: prospect_id,
        name: lead_name || 'Unknown',
        phone: client_number || null,
        lead_source: lead_source || 'Phone',
        owner: resolvedOwnerName
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    const { data: existing } = await supabase
      .from('callizer_queue')
      .select('id, status')
      .eq('call_id', activity_id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: `Already queued (status: ${existing.status})`, queue_id: existing.id });
    }

    const queue_id = uuidv4();

    const { error: insertErr } = await supabase.from('callizer_queue').insert({
      id: queue_id,
      call_id: activity_id,
      audio_url: resource_url,
      language: language || 'hi',
      status: 'pending',
      emp_number: emp_number || '',
      client_number: client_number || '',
      call_type: type || '',
      duration: parseFloat(duration) || 0,
      prospect_id: prospect_id || '',
      errors: '[]'
    });

    if (insertErr) throw insertErr;

    res.json({ status: "queued", queue_id });
  } catch (err) {
    console.error("Push to QC error:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
