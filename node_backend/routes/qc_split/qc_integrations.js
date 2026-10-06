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
  try {
    const { prospect_id, coaching_report, source } = req.body;

    if (!prospect_id || !coaching_report) {
      return res.status(400).json({ error: 'prospect_id and coaching_report are required' });
    }

    const { accessKey, secretKey } = lsqParams();
    if (!accessKey || !secretKey) {
      return res.status(400).json({ error: "LeadSquared API keys not set" });
    }

    const sourceEmoji = source === 'google_meet' ? '🎥 Video Demo' : '📞 Phone Call';
    const report = coaching_report;

    let activityNote = `${sourceEmoji} QC Coaching Report — Score: ${report.overall_score}/100 (Grade ${report.overall_grade})\n\n`;
    activityNote += `📝 ${report.summary}\n\n`;

    if (report.top_strengths && report.top_strengths.length > 0) {
      activityNote += `✅ STRENGTHS:\n`;
      report.top_strengths.forEach(s => { activityNote += `• ${s}\n`; });
      activityNote += `\n`;
    }

    if (report.critical_improvements && report.critical_improvements.length > 0) {
      activityNote += `❌ AREAS TO IMPROVE:\n`;
      report.critical_improvements.forEach(s => { activityNote += `• ${s}\n`; });
      activityNote += `\n`;
    }

    if (report.category_scores) {
      activityNote += `📊 CATEGORY SCORES:\n`;
      for (const [cat, data] of Object.entries(report.category_scores)) {
        activityNote += `• ${cat}: ${data.score}/100 (${data.grade})\n`;
      }
      activityNote += `\n`;
    }

    if (report.prescriptive_coaching && report.prescriptive_coaching.length > 0) {
      activityNote += `🎯 PRESCRIPTIVE COACHING (GOLDEN PITCH):\n`;
      report.prescriptive_coaching.forEach(pc => {
        activityNote += `• Situation: ${pc.situation}\n`;
        activityNote += `  ❌ You said: "${pc.what_associate_said}"\n`;
        activityNote += `  ✅ Golden Pitch: "${pc.golden_pitch}"\n`;
        activityNote += `  💡 Why: ${pc.why_it_works}\n\n`;
      });
    }

    const LSQ_QC_ACTIVITY_EVENT = parseInt(process.env.LSQ_QC_ACTIVITY_EVENT_CODE || '279', 10);
    const { lsqUrl } = require('../../config/lsq');
    const url = lsqUrl('ProspectActivity.svc/Create');
    const payload = {
      RelatedProspectId: prospect_id,
      ActivityEvent: LSQ_QC_ACTIVITY_EVENT,
      ActivityNote: activityNote
    };

    const lsqRes = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
    console.log(`🚀 Successfully pushed coaching report to LSQ for prospect ${prospect_id}`);
    res.json({ success: true, lsq_response: lsqRes.data });

  } catch (err) {
    console.error("Coaching Push Error:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
