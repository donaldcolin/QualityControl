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
//  MEET SYNC
// ═══════════════════════════════════════════════════════════════


router.post('/meet_sync/trigger', async (req, res) => {
  try {
    const results = await meetSync.triggerManualSync();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ═══════════════════════════════════════════════════════════════
//  COACHING PUSH TO LSQ
// ═══════════════════════════════════════════════════════════════


router.post('/coaching/push_to_lsq', async (req, res) => {
  // Outbound activity push to LeadSquared is disabled per production requirements
  return res.json({
    success: true,
    status: 'disabled',
    message: 'LeadSquared outbound activity push is disabled'
  });
});


module.exports = router;
