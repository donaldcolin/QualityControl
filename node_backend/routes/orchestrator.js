const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getTeamLeadsSince, syncSingleLeadEntirely } = require('../services/lead_service');
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

// POST sync one lead's full journey (all calls + demo) on demand
router.post('/scan_lead', requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { prospect_id, phone, name, owner_id, source } = req.body;
  if (!prospect_id) return res.status(400).json({ error: 'prospect_id is required' });
  try {
    const result = await syncSingleLeadEntirely({ prospect_id, phone, name: name || 'Lead', owner_id, source });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Scan Lead Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST trigger non-blocking scan of recently modified leads, one lead at a time (Admin or AI Worker)
router.post('/scan_all', requireRole(['admin', 'ai_worker']), (req, res) => {
  if (currentScan.running) {
    return res.status(409).json({
      error: 'A background scan is already in progress',
      scan_id: currentScan.scan_id,
      started_at: currentScan.started_at
    });
  }

  const days = Math.min(Number(req.body?.days) || 7, 90);
  const maxLeads = Math.min(Number(req.body?.max_leads) || 100, 500);
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 19).replace('T', ' ');

  const scanId = uuidv4();
  currentScan = {
    running: true,
    scan_id: scanId,
    started_at: new Date().toISOString(),
    summary: { leads_scanned: 0, calls_queued: 0, demos_queued: 0, skipped: 0, errors: 0, crm_timeouts: 0 },
    last_error: null
  };
  // 202 immediately so Nginx/Client never suffers a 504 Gateway Timeout
  res.status(202).json({ success: true, status: 'Scan started in background', scan_id: scanId });

  setImmediate(async () => {
    const sum = currentScan.summary;
    try {
      for (let cursor = since; sum.leads_scanned + sum.errors < maxLeads;) {
        const { leads, scannedUpTo } = await getTeamLeadsSince(cursor, maxLeads - sum.leads_scanned - sum.errors);
        if (!leads.length && scannedUpTo === cursor) break; // nothing newer in LSQ
        cursor = scannedUpTo;
        for (const lead of leads) {
          if (sum.leads_scanned + sum.errors >= maxLeads) break;
          try {
            const r = await syncSingleLeadEntirely(lead);
            sum.leads_scanned++;
            sum.calls_queued += r.calls_queued;
            sum.demos_queued += r.demos_queued;
            sum.skipped += r.calls_skipped + r.demos_skipped;
          } catch (leadErr) {
            sum.errors++;
            if (leadErr.code === 'ECONNABORTED' || leadErr.message?.includes('timeout')) sum.crm_timeouts++;
            console.warn(`[Orchestrator] Lead ${lead.prospect_id} failed: ${leadErr.message}`);
          }
          await new Promise(r => setTimeout(r, 300));
        }
      }
      console.log(`✅ [Orchestrator] Scan ${scanId} finished: ${sum.leads_scanned} leads, ${sum.calls_queued} calls, ${sum.demos_queued} demos.`);
    } catch (fatalErr) {
      console.error(`❌ [Orchestrator] Scan ${scanId} failed:`, fatalErr);
      currentScan.last_error = fatalErr.message;
    } finally {
      currentScan.running = false;
      currentScan.completed_at = new Date().toISOString();
    }
  });
});

module.exports = router;
