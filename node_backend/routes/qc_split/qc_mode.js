const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const supabase = require('../../config/supabase');
const { requireRole } = require('../../middleware/auth');

let _currentMode = process.env.QC_MODE || 'dev';

function getExecutionMode() {
  return _currentMode;
}

/**
 * GET /qc/mode
 * Returns the active execution mode, model, caching state, and live queue counts.
 */
router.get('/qc/mode', async (req, res) => {
  let counts = { ready_for_qc: 0, processing: 0, evaluated: 0 };
  try {
    const [readyRes, procRes, evalRes] = await Promise.all([
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('qc_status', 'ready_for_qc'),
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('qc_status', 'processing'),
      supabase.from('calls').select('id', { count: 'exact', head: true }).eq('qc_status', 'evaluated'),
    ]);
    counts.ready_for_qc = readyRes.count || 0;
    counts.processing = procRes.count || 0;
    counts.evaluated = evalRes.count || 0;
  } catch (err) {
    console.warn(`[QCMode] Non-fatal counts fetch notice: ${err.message}`);
  }

  res.json({
    success: true,
    mode: _currentMode,
    model: process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
    isCachingEnabled: process.env.ENABLE_CONTEXT_CACHING === 'true',
    counts,
    description: _currentMode === 'dev' 
      ? 'DEV MODE: Instant evaluations on-the-fly, zero cache storage fee billed.' 
      : 'PROD MODE: Shift Batch Autopilot (transcripts queued during day, evaluated in bulk with cache at shift end).'
  });
});

/**
 * POST /qc/mode
 * Body: { mode: 'dev' | 'prod' }
 * Dynamically toggles execution mode without restarting the server.
 */
router.post('/qc/mode', requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { mode } = req.body;
  if (!mode || (mode !== 'dev' && mode !== 'prod')) {
    return res.status(400).json({ 
      success: false, 
      error: 'Invalid mode. Supported values: "dev" or "prod"' 
    });
  }

  _currentMode = mode;
  process.env.QC_MODE = mode;

  // Persist to .env file so it survives server reboots
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    if (fs.existsSync(envPath)) {
      let envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('QC_MODE=')) {
        envContent = envContent.replace(/QC_MODE=[^\r\n]+/, `QC_MODE=${mode}`);
      } else {
        envContent += `\nQC_MODE=${mode}`;
      }
      fs.writeFileSync(envPath, envContent, 'utf8');
    }
  } catch (err) {
    console.warn(`[QCMode] Notice updating .env: ${err.message}`);
  }

  // When switching to PROD: auto-admit all paused/buffered items so the autonomous worker picks them up
  let admittedCount = 0;
  if (mode === 'prod' && supabase) {
    try {
      const { data, error } = await supabase
        .from('callizer_queue')
        .update({ status: 'pending', is_gated_admitted: true })
        .in('status', ['paused', 'buffered'])
        .select('id');

      if (!error && data) {
        admittedCount = data.length;
        if (admittedCount > 0) {
          console.log(`🔀 [QC Mode] Auto-admitted ${admittedCount} paused items into PROD pipeline.`);
          // Wake up Python worker
          const axios = require('axios');
          axios.post('http://localhost:8000/api/process_audio', { queue_id: 'mode_switch_wake' }, { timeout: 3000 })
            .catch(() => {});
        }
      }
    } catch (admitErr) {
      console.warn(`[QCMode] Auto-admit notice: ${admitErr.message}`);
    }
  }

  console.log(`🔀 [QC Mode] Switched execution mode to: ${mode.toUpperCase()}`);

  res.json({
    success: true,
    mode: _currentMode,
    admittedCount,
    message: `QC Execution Mode successfully set to ${mode.toUpperCase()}${admittedCount > 0 ? `. Auto-admitted ${admittedCount} paused items.` : ''}`
  });
});

module.exports = {
  router,
  getExecutionMode
};
