const supabase = require('../config/supabase');

const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Scans callizer_queue for orphaned transitional states and resets or fails them.
 */
async function sweepStaleQueueJobs(timeoutMs = STALE_TIMEOUT_MS) {
  if (!supabase) return { failedDownloads: 0, resetLeases: 0 };

  const now = new Date();
  const thresholdIso = new Date(now.getTime() - timeoutMs).toISOString();

  let failedDownloads = 0;
  let resetLeases = 0;

  try {
    // 1. Fail orphaned download jobs stuck in "Downloading Video..."
    const { data: stuckDownloads, error: downloadErr } = await supabase
      .from('callizer_queue')
      .select('id, call_id, created_at, errors')
      .in('status', ['Downloading Video...', 'downloading'])
      .lt('created_at', thresholdIso);

    if (downloadErr) {
      console.warn('⚠️ [Queue Watchdog] Error checking stuck downloads:', downloadErr.message);
    } else if (stuckDownloads && stuckDownloads.length > 0) {
      for (const item of stuckDownloads) {
        let existingErrors = [];
        try {
          existingErrors = JSON.parse(item.errors || '[]');
          if (!Array.isArray(existingErrors)) existingErrors = [];
        } catch (_) {}

        existingErrors.push({
          stage: 'watchdog_timeout',
          error: `Job timed out in download state after ${Math.round(timeoutMs / 60000)} minutes.`,
          timestamp: new Date().toISOString()
        });

        await supabase
          .from('callizer_queue')
          .update({
            status: 'failed',
            errors: JSON.stringify(existingErrors)
          })
          .eq('id', item.id);

        failedDownloads++;
      }
      console.log(`🛡️ [Queue Watchdog] Cleaned up ${failedDownloads} orphaned download jobs stuck past timeout.`);
    }

    // 2. Recover dead worker leases stuck in "claimed" with expired lease
    const { data: expiredLeases, error: leaseErr } = await supabase
      .from('callizer_queue')
      .select('id, call_id, worker_id, lease_expires_at')
      .eq('status', 'claimed')
      .lt('lease_expires_at', now.toISOString());

    if (leaseErr) {
      console.warn('⚠️ [Queue Watchdog] Error checking expired leases:', leaseErr.message);
    } else if (expiredLeases && expiredLeases.length > 0) {
      for (const item of expiredLeases) {
        await supabase
          .from('callizer_queue')
          .update({
            status: 'pending',
            worker_id: null,
            claimed_at: null
          })
          .eq('id', item.id);

        resetLeases++;
      }
      console.log(`🔄 [Queue Watchdog] Reclaimed ${resetLeases} orphaned jobs with expired worker leases.`);
    }
  } catch (err) {
    console.error('❌ [Queue Watchdog] Sweep failed unexpectedly:', err.message);
  }

  return { failedDownloads, resetLeases };
}

let watchdogIntervalId = null;

/**
 * Starts the 24/7 background queue watchdog daemon.
 */
function startQueueWatchdogDaemon(intervalMs = 10 * 60 * 1000) {
  if (watchdogIntervalId) return;

  console.log(`🛡️ [Queue Watchdog] Starting 24/7 queue recovery watchdog daemon (Interval: ${Math.round(intervalMs / 60000)}m)`);

  // Run initial sweep on boot
  sweepStaleQueueJobs().catch(err => {
    console.warn('⚠️ [Queue Watchdog] Boot sweep failed:', err.message);
  });

  watchdogIntervalId = setInterval(() => {
    sweepStaleQueueJobs().catch(err => {
      console.error('❌ [Queue Watchdog] Scheduled sweep error:', err.message);
    });
  }, intervalMs);

  if (watchdogIntervalId.unref) watchdogIntervalId.unref();
}

/**
 * Stops the queue watchdog daemon cleanly.
 */
function stopQueueWatchdogDaemon() {
  if (watchdogIntervalId) {
    clearInterval(watchdogIntervalId);
    watchdogIntervalId = null;
    console.log('🛑 [Queue Watchdog] Daemon stopped.');
  }
}

module.exports = {
  sweepStaleQueueJobs,
  startQueueWatchdogDaemon,
  stopQueueWatchdogDaemon
};
