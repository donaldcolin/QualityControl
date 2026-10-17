const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const { startBatchQC, getBatchStatus, stopBatchQC } = require('../../services/qc_batch_runner');
const { getAutopilotStatus, checkAndAutoTrigger } = require('../../services/qc_autopilot');
const { purgeCacheEarly, getCacheStatus } = require('../../services/qc_engine/on_demand_cache');

/**
 * POST /qc/batch/start
 * Launches 2-hour batch QC on all calls in 'ready_for_qc' status.
 */
router.post('/qc/batch/start', requireAuth, requireRole(['admin', 'ai_worker', 'authenticated']), async (req, res) => {
  try {
    const { concurrency, targetCallIds } = req.body || {};
    const result = await startBatchQC({
      concurrency: parseInt(concurrency) || 4,
      targetCallIds: Array.isArray(targetCallIds) ? targetCallIds : null
    });
    res.json(result);
  } catch (err) {
    console.error('Batch start error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /qc/batch/status
 * Live progress and telemetry of current/last batch and active cache state.
 */
router.get('/qc/batch/status', async (req, res) => {
  try {
    const batch = getBatchStatus();
    const autopilot = getAutopilotStatus();
    const cache = getCacheStatus();

    res.json({
      success: true,
      batch,
      autopilot,
      cache
    });
  } catch (err) {
    console.error('Batch status error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /qc/batch/stop
 * Emergency halt for running batch.
 */
router.post('/qc/batch/stop', requireAuth, requireRole(['admin', 'ai_worker', 'authenticated']), async (req, res) => {
  try {
    const result = await stopBatchQC();
    res.json(result);
  } catch (err) {
    console.error('Batch stop error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /qc/batch/purge_cache
 * Manual admin purge to immediately delete any alive Gemini context cache.
 */
router.post('/qc/batch/purge_cache', requireAuth, requireRole(['admin', 'ai_worker', 'authenticated']), async (req, res) => {
  try {
    const result = await purgeCacheEarly();
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Cache purge error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /qc/batch/autopilot/trigger
 * Manually invokes the autopilot check cycle (for tests / manual cron hooks).
 */
router.post('/qc/batch/autopilot/trigger', requireAuth, requireRole(['admin', 'ai_worker', 'authenticated']), async (req, res) => {
  try {
    await checkAndAutoTrigger();
    res.json({
      success: true,
      message: 'Autopilot check executed',
      autopilot: getAutopilotStatus(),
      batch: getBatchStatus()
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
