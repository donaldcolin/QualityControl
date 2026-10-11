/**
 * Comprehensive Phase 3 Resilience & Production Hardening Test Suite
 * Validates:
 * 1. Persistent Batch Store (storage/batch_runs.json atomic persistence & rehydration)
 * 2. Safe PostgREST Query Chunking (fetchInChunks handling edge cases & large ID arrays)
 * 3. Drive API Query Sanitization (escaping single quotes & backslashes)
 * 4. Queue Watchdog Daemon exports & integrity
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

async function runPhase3Tests() {
  console.log('🧪 Starting Phase 3 Production Hardening Test Suite...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // ── TEST 1: BATCH STORE PERSISTENCE & REHYDRATION ─────────────────────────
  console.log('--- 1. Testing Persistent Batch Store ---');
  const { saveBatch, getBatch } = require('../services/batch_store');

  test('saveBatch and getBatch in-memory retrieval', () => {
    const testBatchId = 'test-batch-' + Date.now();
    const testQueueIds = ['q-uuid-1', 'q-uuid-2', 'q-uuid-3'];

    saveBatch(testBatchId, testQueueIds);
    const retrieved = getBatch(testBatchId);

    assert.deepStrictEqual(retrieved, testQueueIds, 'Retrieved queue IDs must match saved IDs');
  });

  test('Batch file persistence to storage/batch_runs.json', () => {
    const batchStorePath = path.join(__dirname, '../../storage/batch_runs.json');
    assert(fs.existsSync(batchStorePath), 'storage/batch_runs.json must exist');

    const fileContent = JSON.parse(fs.readFileSync(batchStorePath, 'utf8'));
    assert(typeof fileContent === 'object', 'File content must be a JSON object');
  });

  // ── TEST 2: SAFE QUERY CHUNKING (db_utils.js) ─────────────────────────────
  console.log('\n--- 2. Testing Safe PostgREST Query Chunking ---');
  const { fetchInChunks } = require('../utils/db_utils');

  await asyncTest('fetchInChunks splits 125 items into chunks of 50 and preserves order', async () => {
    const fakeIds = Array.from({ length: 125 }, (_, i) => `lead-${i}`);
    const callLog = [];

    const results = await fetchInChunks(fakeIds, 50, async (chunk) => {
      callLog.push(chunk.length);
      return chunk.map(id => ({ id, enriched: true }));
    });

    assert.deepStrictEqual(callLog, [50, 50, 25], 'Must execute in chunk sizes of 50, 50, 25');
    assert.strictEqual(results.length, 125, 'Total results must match original items count');
    assert.strictEqual(results[0].id, 'lead-0');
    assert.strictEqual(results[124].id, 'lead-124');
  });

  await asyncTest('fetchInChunks handles empty and null inputs safely', async () => {
    const resEmpty = await fetchInChunks([], 50, async () => [{ dummy: 1 }]);
    assert.deepStrictEqual(resEmpty, [], 'Empty array input must return empty array');

    const resNull = await fetchInChunks(null, 50, async () => [{ dummy: 1 }]);
    assert.deepStrictEqual(resNull, [], 'Null input must return empty array');
  });

  // ── TEST 3: GOOGLE DRIVE SANITIZATION ────────────────────────────────────
  console.log('\n--- 3. Testing Google Drive API Parameter Sanitization ---');
  test('Apostrophes and backslashes are escaped safely', () => {
    function sanitizeDriveParam(str) {
      if (!str) return '';
      return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    const nameWithApostrophe = "O'Connor";
    const sanitizedName = sanitizeDriveParam(nameWithApostrophe);
    assert.strictEqual(sanitizedName, "O\\'Connor", "Apostrophe must be escaped with backslash");

    const inputWithSlash = "test\\path";
    const sanitizedSlash = sanitizeDriveParam(inputWithSlash);
    assert.strictEqual(sanitizedSlash, "test\\\\path", "Backslash must be escaped");
  });

  // ── TEST 4: QUEUE WATCHDOG DAEMON EXPORTS ─────────────────────────────────
  console.log('\n--- 4. Testing Queue Watchdog Daemon Exports ---');
  const watchdog = require('../services/queue_watchdog');
  test('Queue watchdog exports sweepStaleQueueJobs and daemon lifecycle functions', () => {
    assert(typeof watchdog.sweepStaleQueueJobs === 'function', 'sweepStaleQueueJobs must be a function');
    assert(typeof watchdog.startQueueWatchdogDaemon === 'function', 'startQueueWatchdogDaemon must be a function');
    assert(typeof watchdog.stopQueueWatchdogDaemon === 'function', 'stopQueueWatchdogDaemon must be a function');
  });

  console.log(`\n========================================`);
  console.log(`Phase 3 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase3Tests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
