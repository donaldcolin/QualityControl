const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');

router.post('/scan_all', async (req, res) => {
  try {
    const { data: associates, error: assocErr } = await supabase.from('qc_associates').select('*');
    if (assocErr) throw assocErr;

    let totalLeadsFound = 0;
    let totalCallsQueued = 0;
    let totalCallsSkipped = 0;

    for (const assoc of associates) {
      try {
        const port = process.env.PORT || 3000;
        const leadsRes = await axios.get(`http://localhost:${port}/api/associates/${assoc.emp_number}/leads?page=1&pageSize=50`);
        const leads = leadsRes.data || [];
        totalLeadsFound += leads.length;

        for (const lead of leads) {
          try {
            const actRes = await axios.get(`http://localhost:${port}/api/leads/${lead.prospect_id}/activities`);
            const activities = actRes.data || [];
            
            for (const act of activities) {
              if (act.resource_url && act.duration > 60) {
                try {
                  const pushRes = await axios.post(`http://localhost:${port}/api/activities/push_to_qc`, {
                    activity_id: act.activity_id,
                    resource_url: act.resource_url,
                    duration: act.duration,
                    type: act.type,
                    prospect_id: act.prospect_id,
                    emp_number: assoc.emp_number,
                    client_number: lead.phone,
                    language: 'hi' // Ideally extract language from tags
                  });
                  if (pushRes.data && pushRes.data.status === 'queued') {
                    totalCallsQueued++;
                  }
                } catch (pushErr) {
                  if (pushErr.response && pushErr.response.data && pushErr.response.data.error && pushErr.response.data.error.includes("Already queued")) {
                    totalCallsSkipped++;
                  } else {
                    console.error("Push Error for Activity:", act.activity_id, pushErr.message);
                  }
                }
              }
            }
          } catch (e) {
            console.error("Error fetching activities for lead:", lead.prospect_id);
          }
        }
      } catch (e) {
        console.error("Error fetching leads for associate:", assoc.emp_number);
      }
    }

    res.json({
      summary: {
        associates_scanned: associates.length,
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
