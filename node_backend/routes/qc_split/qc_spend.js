const express = require('express');
const router = express.Router();
const spendTracker = require('../../services/qc_engine/spend_tracker');

/**
 * GET /qc/spend_summary
 * Query params: ?date=YYYY-MM-DD (defaults to today)
 * Returns aggregated spend, hourly breakdown with human reasons, and token counts.
 */
router.get('/qc/spend_summary', (req, res) => {
  try {
    const targetDate = req.query.date || new Date().toISOString().slice(0, 10);
    const report = spendTracker.getSpendReport(targetDate);
    res.json({
      success: true,
      report
    });
  } catch (err) {
    console.error('[SpendAPI] Error generating spend report:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
