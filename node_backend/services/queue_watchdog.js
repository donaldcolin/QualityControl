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

  const TERMINAL_STATUSES = ['completed', 'failed', 'fatal_audit_failure', 'rejected'];
  const MAX_ATTEMPTS = 3;

  try {
    // 1. Fail orphaned download jobs stuck in explicit download states
    const { data: stuckDownloads, error: downloadErr } = await supabase
      .from('callizer_queue')
      .select('id, call_id, created_at, errors, attempt_count')
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

    // 2. Recover ANY abandoned in-flight worker job whose lease expired or timed out
    // Catches 'claimed', 'Initializing...', 'Starting ASR pipeline...', 'Transcribing segment...', etc.
    const { data: inFlightJobs, error: inFlightErr } = await supabase
      .from('callizer_queue')
      .select('id, call_id, status, worker_id, lease_expires_at, claimed_at, created_at, attempt_count, errors')
      .neq('status', 'pending');

    if (inFlightErr) {
      console.warn('⚠️ [Queue Watchdog] Error checking in-flight jobs:', inFlightErr.message);
    } else if (inFlightJobs && inFlightJobs.length > 0) {
      for (const item of inFlightJobs) {
        if (TERMINAL_STATUSES.includes(item.status)) continue;

        // Check if lease is expired or if task was abandoned with no heartbeat past timeout
        const isLeaseExpired = item.lease_expires_at && new Date(item.lease_expires_at) < now;
        const isTimeExceeded = !item.lease_expires_at && (
          (item.claimed_at && new Date(item.claimed_at) < new Date(now.getTime() - timeoutMs)) ||
          (item.created_at && new Date(item.created_at) < new Date(now.getTime() - timeoutMs))
        );

        if (isLeaseExpired || isTimeExceeded) {
          const attempts = (item.attempt_count || 0);

          if (attempts >= MAX_ATTEMPTS) {
            // Max retries exceeded -> Fail the job with an explicit error
            let existingErrors = [];
            try {
              existingErrors = JSON.parse(item.errors || '[]');
              if (!Array.isArray(existingErrors)) existingErrors = [];
            } catch (_) {}

            existingErrors.push({
              stage: 'watchdog_max_retries',
              error: `Job abandoned by worker in state "${item.status}" after ${attempts} attempts. Failsafe triggered.`,
              timestamp: new Date().toISOString()
            });

            await supabase
              .from('callizer_queue')
              .update({
                status: 'failed',
                errors: JSON.stringify(existingErrors)
              })
              .eq('id', item.id);

            console.warn(`🛑 [Queue Watchdog] Job ${item.id} exceeded max retries (${attempts}). Marked as failed.`);
            failedDownloads++;
          } else {
            // Reclaim job and return to pending queue
            await supabase
              .from('callizer_queue')
              .update({
                status: 'pending',
                worker_id: null,
                claimed_at: null,
                lease_expires_at: null
              })
              .eq('id', item.id);

            resetLeases++;
            console.log(`🔄 [Queue Watchdog] Reclaimed abandoned job ${item.id} from status "${item.status}" (Attempt ${attempts + 1}/${MAX_ATTEMPTS}).`);
          }
        }
      }
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
