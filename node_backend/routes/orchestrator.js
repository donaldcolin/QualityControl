const express = require('express');
const router = express.Router();
const supabase = require('../config/supabase');
const { getLeadsForAssociate, getActivitiesForLead, pushActivityToQCQueue } = require('../services/lead_service');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

router.post('/scan_all', requireRole(['admin', 'ai_worker']), async (req, res) => {
  try {
    const { data: associates, error: assocErr } = await supabase.from('qc_associates').select('*');
    if (assocErr) throw assocErr;

    let totalLeadsFound = 0;
    let totalCallsQueued = 0;
    let totalCallsSkipped = 0;

    for (const assoc of (associates || [])) {
      try {
        const leads = await getLeadsForAssociate(assoc.emp_number, 1, 50);
        totalLeadsFound += leads.length;

        for (const lead of leads) {
          try {
            const activities = await getActivitiesForLead(lead.prospect_id);

            for (const act of activities) {
              if (act.resource_url && act.duration > 60) {
                try {
                  const pushRes = await pushActivityToQCQueue({
                    activity_id: act.activity_id,
                    resource_url: act.resource_url,
                    duration: act.duration,
                    type: act.type,
                    prospect_id: act.prospect_id,
                    emp_number: assoc.emp_number,
                    client_number: lead.phone,
                    language: 'hi' // Ideally extract language from tags
                  });
                  if (pushRes && pushRes.status === 'queued') {
                    totalCallsQueued++;
                  }
                } catch (pushErr) {
                  if (pushErr.isAlreadyQueued || pushErr.message?.includes("Already queued")) {
                    totalCallsSkipped++;
                  } else {
                    console.error("Push Error for Activity:", act.activity_id, pushErr.message);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Error fetching activities for lead:", lead.prospect_id, e.message);
          }
        }
      } catch (e) {
        console.error("Error fetching leads for associate:", assoc.emp_number, e.message);
      }
    }

    res.json({
      summary: {
        associates_scanned: (associates || []).length,
        leads_found: totalLeadsFound,
        calls_queued: totalCallsQueued,
        calls_skipped: totalCallsSkipped
      }
    });

  } catch (err) {
    console.error("Scan All Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
