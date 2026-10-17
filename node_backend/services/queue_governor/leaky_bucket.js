const supabase = require('../../config/supabase');

/**
 * Leaky-Bucket Rate Limiter & Buffer Governor.
 * Buffers incoming recordings up to a hard ceiling of 500 items.
 * Implements watermark hysteresis (Normal / High / Overflow) and
 * Priority Preemption (Priority 1 Demos bypass the buffer line).
 */

const BUFFER_CAPACITY = 500;
const HIGH_WATERMARK = 400;
const HYSTERESIS_DRAIN_THRESHOLD = 350;

let _isThrottled = false;

/**
 * Priority Tier Definitions
 */
const PRIORITY_TIERS = {
  URGENT_DEMO: 1,      // google_meet video demo with student & parent
  STANDARD_CALL: 2,    // LeadSquared telephony inbound/outbound
  BACKFILL: 3          // Historical CSV upload / re-audit
};

/**
 * Determines whether the queue can accept an item of the given priority.
 * Priority 1 (Urgent Demos) always has an express pass.
 * 
 * @param {number} [priority=2]
 * @returns {Promise<{ allowed: boolean, watermark: 'NORMAL'|'HIGH_WATERMARK'|'OVERFLOW', currentBuffered: number, message: string }>}
 */
async function checkAdmission(priority = PRIORITY_TIERS.STANDARD_CALL) {
  if (!supabase) {
    return { allowed: true, watermark: 'NORMAL', currentBuffered: 0, message: 'Supabase inactive' };
  }

  try {
    // Count active items — everything NOT in a terminal state
    const { count, error } = await supabase
      .from('callizer_queue')
      .select('id', { count: 'exact', head: true })
      .not('status', 'in', '("completed","failed","dead_letter","rejected","paused")');

    if (error) {
      console.warn(`[LeakyBucket] Count error: ${error.message}`);
      return { allowed: true, watermark: 'NORMAL', currentBuffered: 0, message: error.message };
    }

    const currentCount = count || 0;

    // Hysteresis State Machine
    if (_isThrottled && currentCount < HYSTERESIS_DRAIN_THRESHOLD) {
      _isThrottled = false;
      console.log(`✅ [LeakyBucket] Buffer drained to ${currentCount}/${BUFFER_CAPACITY}. Resuming standard intake.`);
    } else if (!_isThrottled && currentCount >= BUFFER_CAPACITY) {
      _isThrottled = true;
      console.warn(`🛑 [LeakyBucket] Buffer reached hard ceiling ${currentCount}/${BUFFER_CAPACITY}! Ingestion throttled.`);
    }

    // Determine current watermark
    let watermark = 'NORMAL';
    if (currentCount >= BUFFER_CAPACITY) {
      watermark = 'OVERFLOW';
    } else if (currentCount >= HIGH_WATERMARK) {
      watermark = 'HIGH_WATERMARK';
    }

    // PRIORITY 1: Express Bypass Channel
    // Urgent counseling demos are never rejected unless DB is physically full
    if (priority === PRIORITY_TIERS.URGENT_DEMO) {
      return {
        allowed: true,
        watermark,
        currentBuffered: currentCount,
        message: 'Priority 1 Urgent Demo admitted via Express Bypass Channel.'
      };
    }

    // PRIORITY 3: Backfills only allowed when queue is completely quiet
    if (priority === PRIORITY_TIERS.BACKFILL && currentCount > 50) {
      return {
        allowed: false,
        watermark,
        currentBuffered: currentCount,
        message: `Priority 3 Backfill deferred: active queue count is ${currentCount} (threshold: 50).`
      };
    }

    // Standard Admission check
    if (_isThrottled) {
      return {
        allowed: false,
        watermark: 'OVERFLOW',
        currentBuffered: currentCount,
        message: `Queue buffer is full (${currentCount}/${BUFFER_CAPACITY}). Admission temporarily paused.`
      };
    }

    return {
      allowed: true,
      watermark,
      currentBuffered: currentCount,
      message: `Admitted into buffer (${currentCount}/${BUFFER_CAPACITY}).`
    };
  } catch (err) {
    console.warn(`[LeakyBucket] Warning: ${err.message}`);
    return { allowed: true, watermark: 'NORMAL', currentBuffered: 0, message: err.message };
  }
}

/**
 * Returns current status of the Leaky Bucket buffer.
 */
async function getBufferStatus() {
  const admission = await checkAdmission(PRIORITY_TIERS.STANDARD_CALL);
  return {
    capacity: BUFFER_CAPACITY,
    highWatermark: HIGH_WATERMARK,
    drainThreshold: HYSTERESIS_DRAIN_THRESHOLD,
    currentBuffered: admission.currentBuffered,
    watermark: admission.watermark,
    isThrottled: _isThrottled
  };
}

module.exports = {
  checkAdmission,
  getBufferStatus,
  PRIORITY_TIERS,
  BUFFER_CAPACITY,
  HIGH_WATERMARK
};
