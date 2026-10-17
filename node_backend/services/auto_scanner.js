const supabase = require('../config/supabase');
const { getExecutionMode } = require('../routes/qc_split/qc_mode');
const { getTeamLeadsSince, syncSingleLeadEntirely } = require('./lead_service');

let _scannerTimer = null;
let _isScanning = false;
let _isPaused = false;
let _lastScanResult = null;
let _scanCount = 0;

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_LEADS_PER_CYCLE = 3; // Complete at most 3 leads per cycle
const MAX_QUEUE_PER_CYCLE = MAX_LEADS_PER_CYCLE; // active-queue depth guard
const LEAD_PACING_MS = 300;
const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

// High-watermark: LSQ ModifiedOn ("yyyy-MM-dd HH:mm:ss", UTC) of the last lead fully processed.
let _lastScannedTimestamp = null;
const toLsqTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

/**
 * Runs one scan cycle: recently modified leads (high-watermark) → each lead fully synced, one at a time.
 * Only executes in PROD mode. Respects pause state and per-cycle cap.
 */
async function runScanCycle() {
  const mode = getExecutionMode();
  if (mode !== 'prod') return { skipped: true, reason: 'Not in PROD mode' };
  if (_isPaused) return { skipped: true, reason: 'Scanner is paused' };
  if (_isScanning) return { skipped: true, reason: 'Previous scan still running' };

  // Check current queue depth — skip if ASR is already busy
  if (supabase) {
    try {
      const { count } = await supabase
        .from('callizer_queue')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '("completed","failed","dead_letter","rejected","paused")');

      if (count && count >= MAX_QUEUE_PER_CYCLE) {
        console.log(`[AutoScanner] Skipping — ${count} items already active in queue.`);
        return { skipped: true, reason: `${count} items already active` };
      }
    } catch (err) {
      // Non-fatal, continue with scan
    }
  }

  _isScanning = true;
  _scanCount++;
  const cycleId = _scanCount;
  const startTime = Date.now();

  let queued = 0;
  let demos = 0;
  let skipped = 0;
  let errors = 0;
  let leadsScanned = 0;

  try {
    const since = _lastScannedTimestamp || toLsqTime(new Date(Date.now() - INITIAL_LOOKBACK_MS));
    const { leads, scannedUpTo } = await getTeamLeadsSince(since, MAX_LEADS_PER_CYCLE);
    console.log(`🔄 [AutoScanner] Cycle #${cycleId} started — ${leads.length} team leads modified since ${since}`);
    let allDone = true;

    for (const [i, lead] of leads.entries()) {
      if (_isPaused) break;
      try {
        const r = await syncSingleLeadEntirely(lead);
        leadsScanned++;
        queued += r.calls_queued;
        demos += r.demos_queued;
        skipped += r.calls_skipped + r.demos_skipped;
        console.log(`[AutoScanner] Processed Lead ${i + 1}/${leads.length} (${lead.name}): ${r.calls_queued} calls, ${r.demos_queued} demo queued. Advancing to next lead...`);
        _lastScannedTimestamp = lead.modified_on || _lastScannedTimestamp;
      } catch (leadErr) {
        errors++;
        console.warn(`[AutoScanner] Lead ${lead.prospect_id} failed: ${leadErr.message}. Will retry next cycle.`);
        allDone = false;
        break; // keep the watermark behind the failed lead; don't skip past it
      }
      await new Promise(r => setTimeout(r, LEAD_PACING_MS));
    }
    // Every team lead done (or none found): skip past the non-team leads examined too.
    if (allDone && !_isPaused) _lastScannedTimestamp = scannedUpTo;

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    _lastScanResult = {
      cycle: cycleId,
      timestamp: new Date().toISOString(),
      durationSec,
      leadsScanned,
      queued,
      demos,
      skipped,
      errors,
      watermark: _lastScannedTimestamp
    };
    console.log(`✅ [AutoScanner] Cycle #${cycleId} done in ${durationSec}s — ${leadsScanned} leads, ${queued} calls, ${demos} demos queued (${skipped} skipped).`);
    return _lastScanResult;
  } catch (fatalErr) {
    console.error(`❌ [AutoScanner] Cycle #${cycleId} fatal error:`, fatalErr.message);
    _lastScanResult = { cycle: cycleId, timestamp: new Date().toISOString(), error: fatalErr.message };
    return _lastScanResult;
  } finally {
    _isScanning = false;
  }
}

/**
 * Starts the auto-scanner daemon.
 */
function startAutoScannerDaemon(intervalMs = DEFAULT_INTERVAL_MS) {
  if (_scannerTimer) return;

  console.log(`🔍 [AutoScanner] Starting PROD auto-scanner daemon (Interval: ${Math.round(intervalMs / 60000)}m, Max leads per cycle: ${MAX_LEADS_PER_CYCLE})`);

  // First scan after 60s boot delay
  setTimeout(() => {
    runScanCycle().catch(err => console.warn(`[AutoScanner] Boot scan error: ${err.message}`));
  }, 60 * 1000);

  _scannerTimer = setInterval(() => {
    runScanCycle().catch(err => console.error(`[AutoScanner] Scan error: ${err.message}`));
  }, intervalMs);

  if (_scannerTimer.unref) _scannerTimer.unref();
}

function stopAutoScannerDaemon() {
  if (_scannerTimer) {
    clearInterval(_scannerTimer);
    _scannerTimer = null;
    console.log('🛑 [AutoScanner] Daemon stopped.');
  }
}

function pauseScanner() {
  _isPaused = true;
  console.log('⏸️ [AutoScanner] Paused.');
}

function resumeScanner() {
  _isPaused = false;
  console.log('▶️ [AutoScanner] Resumed.');
}

function getAutoScannerStatus() {
  return {
    active: !!_scannerTimer,
    isPaused: _isPaused,
    isScanning: _isScanning,
    totalCycles: _scanCount,
    maxPerCycle: MAX_LEADS_PER_CYCLE,
    watermark: _lastScannedTimestamp,
    lastResult: _lastScanResult
  };
}

module.exports = {
  startAutoScannerDaemon,
  stopAutoScannerDaemon,
  pauseScanner,
  resumeScanner,
  getAutoScannerStatus,
  runScanCycle
};
