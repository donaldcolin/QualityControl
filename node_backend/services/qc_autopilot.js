const supabase = require('../config/supabase');
const { getExecutionMode } = require('../routes/qc_split/qc_mode');
const { startBatchQC, getBatchStatus } = require('./qc_batch_runner');

let _autopilotTimer = null;
let _isAutopilotActive = false;
let _lastCheckTime = null;
let _lastAutoTriggerTime = null;
let _quietCounter = 0; // Requires consecutive quiet ticks to prevent firing mid-batch upload

/**
 * Checks queue state and auto-launches batch QC when conditions are met.
 */
async function checkAndAutoTrigger() {
  _lastCheckTime = new Date().toISOString();

  // 1. Only run autopilot when system is in PROD mode
  const currentMode = getExecutionMode();
  if (currentMode !== 'prod') {
    return;
  }

  // 2. Check if a batch is already running
  const currentBatch = getBatchStatus();
  if (currentBatch.isRunning) {
    return;
  }

  try {
    // 3. Check for active ASR jobs in callizer_queue
    const { data: activeQueueItems, error: qErr } = await supabase
      .from('callizer_queue')
      .select('id, status')
      .not('status', 'in', '("completed","failed")')
      .limit(10);

    if (qErr) {
      console.warn(`[Autopilot] Queue check notice: ${qErr.message}`);
      return;
    }

    const activeAsrCount = activeQueueItems ? activeQueueItems.length : 0;

    // 4. Check for calls ready for QC
    const { count: readyCount, error: callsErr } = await supabase
      .from('calls')
      .select('id', { count: 'exact', head: true })
      .eq('qc_status', 'ready_for_qc');

    if (callsErr) {
      console.warn(`[Autopilot] Calls check notice: ${callsErr.message}`);
      return;
    }

    const readyCalls = readyCount || 0;

    // Condition 1: ASR is actively working -> keep quiet counter reset
    if (activeAsrCount > 0) {
      _quietCounter = 0;
      return;
    }

    // Condition 2: No calls waiting -> reset
    if (readyCalls === 0) {
      _quietCounter = 0;
      return;
    }

    // Condition 3: ASR is completely done (0 active jobs) AND calls are ready
    _quietCounter++;

    // Wait for 2 consecutive ticks (e.g. ~30-60s) to guarantee no more files are being dropped into queue
    if (_quietCounter >= 2) {
      console.log(`🤖 [Autopilot] Auto-detected: ASR queue is clean (0 active) and ${readyCalls} call(s) are ready for QC.`);
      console.log(`🚀 [Autopilot] Auto-triggering 2-Hour Batch QC with automatic post-run cache termination...`);
      _quietCounter = 0;
      _lastAutoTriggerTime = new Date().toISOString();

      await startBatchQC({ concurrency: 4 });
    }
  } catch (err) {
    console.warn(`[Autopilot] Tick check warning: ${err.message}`);
  }
}

/**
 * Starts the Autopilot background watcher.
 * Runs check every 30 seconds.
 */
function startAutopilotDaemon(intervalMs = 30000) {
  if (_autopilotTimer) {
    clearInterval(_autopilotTimer);
  }

  _isAutopilotActive = true;
  console.log(`🤖 [Autopilot] QC Shift-Batch Autopilot daemon started (Interval: ${intervalMs / 1000}s)`);

  _autopilotTimer = setInterval(() => {
    checkAndAutoTrigger().catch(err => {
      console.warn(`[Autopilot] Background tick error: ${err.message}`);
    });
  }, intervalMs);
}

/**
 * Stops the Autopilot background watcher.
 */
function stopAutopilotDaemon() {
  if (_autopilotTimer) {
    clearInterval(_autopilotTimer);
    _autopilotTimer = null;
  }
  _isAutopilotActive = false;
  console.log(`🛑 [Autopilot] Daemon stopped.`);
}

/**
 * Returns current status and telemetry of the autopilot daemon.
 */
function getAutopilotStatus() {
  return {
    isActive: _isAutopilotActive,
    mode: getExecutionMode(),
    lastCheckTime: _lastCheckTime,
    lastAutoTriggerTime: _lastAutoTriggerTime,
    quietTicks: _quietCounter
  };
}

module.exports = {
  startAutopilotDaemon,
  stopAutopilotDaemon,
  getAutopilotStatus,
  checkAndAutoTrigger
};
