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

const { pushActivityToQCQueue } = require('../../services/lead_service');

// ═══════════════════════════════════════════════════════════════
//  ACTIVITIES & QUEUE
// ═══════════════════════════════════════════════════════════════

router.post('/activities/push_to_qc', async (req, res) => {
  try {
    const result = await pushActivityToQCQueue(req.body);
    res.json(result);
  } catch (err) {
    if (err.isAlreadyQueued) {
      return res.status(400).json({ error: err.message, queue_id: err.queue_id });
    }
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({ error: err.message });
  }
});


module.exports = router;
