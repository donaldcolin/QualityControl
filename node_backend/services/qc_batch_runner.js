const supabase = require('../config/supabase');
const { getOrCreate2HourCache, purgeCacheEarly, getCacheStatus } = require('./qc_engine/on_demand_cache');

let _batchStatus = {
  isRunning: false,
  total: 0,
  completed: 0,
  failed: 0,
  currentCallId: null,
  startTime: null,
  elapsedSec: 0,
  cacheName: null,
  cacheRemainingSec: 0,
  estimatedSpendINR: 0,
  shouldStop: false,
  lastSummary: null
};

// In-flight run promise
let _activeBatchPromise = null;

/**
 * Returns the current status of the batch evaluation runner.
 */
function getBatchStatus() {
  const cacheStatus = getCacheStatus();
  const elapsedSec = _batchStatus.startTime && _batchStatus.isRunning
    ? Math.round((Date.now() - _batchStatus.startTime) / 1000)
    : (_batchStatus.lastSummary?.durationSec || 0);

  return {
    ..._batchStatus,
    elapsedSec,
    cacheName: cacheStatus.cacheName,
    cacheRemainingSec: cacheStatus.remainingSec,
    isCacheAlive: cacheStatus.isAlive
  };
}

/**
 * Emergency stop for currently active batch.
 */
async function stopBatchQC() {
  if (!_batchStatus.isRunning) {
    return { success: false, message: 'No batch currently running' };
  }
  console.log('🛑 [BatchRunner] Received stop signal. Aborting remaining queued calls...');
  _batchStatus.shouldStop = true;
  return { success: true, message: 'Stop signal sent. Active worker will stop after finishing current item.' };
}

/**
 * Starts a 2-Hour Batch QC Run.
 * Evaluates all calls with qc_status = 'ready_for_qc' using the cached prompt,
 * and auto-purges the cache from Google RAM the second the batch completes.
 * 
 * @param {object} options
 * @param {number} options.concurrency - Concurrent workers (default 4)
 * @param {string[]} options.targetCallIds - Optional array of specific call IDs to evaluate
 */
async function startBatchQC(options = {}) {
  if (_batchStatus.isRunning) {
    return {
      success: false,
      isRunning: true,
      message: 'A batch QC run is already in progress',
      status: getBatchStatus()
    };
  }

  const concurrency = options.concurrency || 4;

  // 1. Fetch target calls waiting for QC
  let query = supabase
    .from('calls')
    .select('id, segments, prospect_id, source')
    .eq('qc_status', 'ready_for_qc');

  if (options.targetCallIds && options.targetCallIds.length > 0) {
    query = query.in('id', options.targetCallIds);
  }

  const { data: callsToEvaluate, error: fetchErr } = await query;
  if (fetchErr) {
    throw new Error(`Failed to query ready calls: ${fetchErr.message}`);
  }

  if (!callsToEvaluate || callsToEvaluate.length === 0) {
    return {
      success: true,
      isRunning: false,
      total: 0,
      message: 'No calls currently waiting in "ready_for_qc" status.'
    };
  }

  // 2. Initialize in-memory status
  _batchStatus = {
    isRunning: true,
    total: callsToEvaluate.length,
    completed: 0,
    failed: 0,
    currentCallId: null,
    startTime: Date.now(),
    elapsedSec: 0,
    cacheName: null,
    cacheRemainingSec: 7200,
    estimatedSpendINR: 0,
    shouldStop: false,
    lastSummary: null
  };

  // Launch batch asynchronously in background so endpoint returns immediately
  _activeBatchPromise = (async () => {
    let cacheResult = null;
    const { executeEvaluationCore } = require('../routes/qc_split/qc_evaluations');

    try {
      console.log(`🚀 [BatchRunner] Starting batch evaluation for ${callsToEvaluate.length} calls (concurrency: ${concurrency})...`);

      // 3. Create or acquire 2-Hour Cache
      cacheResult = await getOrCreate2HourCache();
      _batchStatus.cacheName = cacheResult.cacheName;
      _batchStatus.cacheRemainingSec = cacheResult.remainingSec;

      // 4. Concurrency Queue (Worker Pool)
      let currentIndex = 0;

      async function worker(workerId) {
        while (currentIndex < callsToEvaluate.length) {
          if (_batchStatus.shouldStop) {
            console.log(`[BatchWorker ${workerId}] Stop signal acknowledged, exiting worker.`);
            break;
          }

          const call = callsToEvaluate[currentIndex++];
          if (!call) break;

          _batchStatus.currentCallId = call.id;
          console.log(`[BatchWorker ${workerId}] (${currentIndex}/${callsToEvaluate.length}) Evaluating call ${call.id}...`);

          try {
            await executeEvaluationCore({
              call_id: call.id,
              prospect_id: call.prospect_id,
              source: call.source || 'phone_call',
              cacheName: cacheResult?.cacheName
            });

            _batchStatus.completed++;
            // Real-world spend from gemini_spend_ledger.jsonl:
            // T1 calls ~₹0.16, T2 calls ~₹0.45 - ₹0.53 (Blended average: ₹0.33 / call)
            _batchStatus.estimatedSpendINR = parseFloat((_batchStatus.completed * 0.33).toFixed(2));
          } catch (evalErr) {
            console.error(`[BatchWorker ${workerId}] Error evaluating call ${call.id}:`, evalErr.message);
            _batchStatus.failed++;
          }
        }
      }

      // Spawn concurrent workers
      const workers = [];
      const numWorkers = Math.min(concurrency, callsToEvaluate.length);
      for (let i = 0; i < numWorkers; i++) {
        workers.push(worker(i + 1));
      }

      await Promise.all(workers);

      const durationSec = Math.round((Date.now() - _batchStatus.startTime) / 1000);
      console.log(`🎉 [BatchRunner] Batch complete! ${_batchStatus.completed} evaluated, ${_batchStatus.failed} failed in ${durationSec}s.`);

      _batchStatus.lastSummary = {
        total: callsToEvaluate.length,
        completed: _batchStatus.completed,
        failed: _batchStatus.failed,
        durationSec,
        spendINR: _batchStatus.estimatedSpendINR,
        completedAt: new Date().toISOString()
      };
    } catch (batchErr) {
      console.error(`❌ [BatchRunner] Fatal batch runner error:`, batchErr.message);
    } finally {
      // 5. CRITICAL: Immediately purge the cache from Google RAM to stop storage billing!
      console.log('🧹 [BatchRunner] Finalizing batch: Triggering early cache auto-purge...');
      try {
        await purgeCacheEarly();
      } catch (purgeErr) {
        console.warn(`[BatchRunner] Auto-purge notice: ${purgeErr.message}`);
      }

      _batchStatus.isRunning = false;
      _batchStatus.currentCallId = null;
      _activeBatchPromise = null;
    }
  })();

  return {
    success: true,
    isRunning: true,
    total: callsToEvaluate.length,
    concurrency,
    message: `Batch evaluation started for ${callsToEvaluate.length} calls.`
  };
}

module.exports = {
  startBatchQC,
  getBatchStatus,
  stopBatchQC
};
