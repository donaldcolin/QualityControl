const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const supabase = require('../config/supabase');
const { getLeadsForAssociate, getActivitiesForLead, pushActivityToQCQueue } = require('../services/lead_service');
const { requireAuth, requireRole } = require('../middleware/auth');

router.use(requireAuth);

let currentScan = {
  running: false,
  scan_id: null,
  started_at: null,
  summary: null,
  last_error: null
};

// GET current scan status
router.get('/scan_status', (req, res) => {
  res.json(currentScan);
});

// POST trigger non-blocking scan all (Admin or AI Worker)
router.post('/scan_all', requireRole(['admin', 'ai_worker']), async (req, res) => {
  if (currentScan.running) {
    return res.status(409).json({
      error: 'A background scan is already in progress',
      scan_id: currentScan.scan_id,
      started_at: currentScan.started_at
    });
  }

  try {
    const { data: associates, error: assocErr } = await supabase.from('qc_associates').select('*');
    if (assocErr) throw assocErr;

    const scanId = uuidv4();
    currentScan = {
      running: true,
      scan_id: scanId,
      started_at: new Date().toISOString(),
      summary: {
        associates_total: (associates || []).length,
        associates_scanned: 0,
        leads_found: 0,
        calls_queued: 0,
        calls_skipped: 0,
        crm_timeouts: 0
      },
      last_error: null
    };

    // Return 202 Accepted immediately so Nginx/Client never suffers a 504 Gateway Timeout
    res.status(202).json({
      success: true,
      status: 'Scan started in background',
      scan_id: scanId,
      associates_count: (associates || []).length
    });

    // Run heavy scanning in decoupled background task
    setImmediate(async () => {
      console.log(`🚀 [Orchestrator] Starting background scan ${scanId} for ${(associates || []).length} associates...`);
      let totalLeadsFound = 0;
      let totalCallsQueued = 0;
      let totalCallsSkipped = 0;
      let totalTimeouts = 0;

      try {
        for (const assoc of (associates || [])) {
          let assocLang = 'hi';
          if (assoc.emp_tags) {
            const match = assoc.emp_tags.match(/\|lang:([a-z]{2})/i);
            if (match) assocLang = match[1].toLowerCase();
          }

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
                        language: assocLang,
                        call_date: act.created_on
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
              } catch (leadErr) {
                if (leadErr.code === 'ECONNABORTED' || leadErr.message?.includes('timeout')) {
                  totalTimeouts++;
                  console.warn(`⚠️ [Orchestrator] LSQ Timeout fetching activities for lead ${lead.prospect_id}`);
                } else {
                  console.error(`[Orchestrator] Failed fetching activities for lead ${lead.prospect_id}:`, leadErr.message);
                }
              }
            }
          } catch (assocErr) {
            if (assocErr.code === 'ECONNABORTED' || assocErr.message?.includes('timeout')) {
              totalTimeouts++;
              console.warn(`⚠️ [Orchestrator] LSQ Timeout fetching leads for associate ${assoc.emp_number}`);
            } else {
              console.error(`[Orchestrator] Failed fetching leads for associate ${assoc.emp_number}:`, assocErr.message);
            }
          }

          currentScan.summary.associates_scanned++;
          currentScan.summary.leads_found = totalLeadsFound;
          currentScan.summary.calls_queued = totalCallsQueued;
          currentScan.summary.calls_skipped = totalCallsSkipped;
          currentScan.summary.crm_timeouts = totalTimeouts;
        }

        console.log(`✅ [Orchestrator] Background scan ${scanId} finished. Queued: ${totalCallsQueued}, Skipped: ${totalCallsSkipped}`);
      } catch (fatalErr) {
        console.error(`❌ [Orchestrator] Background scan ${scanId} failed:`, fatalErr);
        currentScan.last_error = fatalErr.message;
      } finally {
        currentScan.running = false;
        currentScan.completed_at = new Date().toISOString();
      }
    });

  } catch (err) {
    console.error("Scan All Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
