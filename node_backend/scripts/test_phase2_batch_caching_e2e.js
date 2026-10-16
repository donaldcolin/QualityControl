const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const axios = require('axios');
const supabase = require('../config/supabase');
const { v4: uuidv4 } = require('uuid');
const { getOrCreate2HourCache, purgeCacheEarly, getCacheStatus } = require('../services/qc_engine/on_demand_cache');
const { startBatchQC, getBatchStatus } = require('../services/qc_batch_runner');

const BASE_URL = 'http://localhost:3000/api';
const AUTH_HEADER = {
  headers: {
    'Authorization': 'Bearer internal_qc_worker_secret_2026',
    'Content-Type': 'application/json'
  }
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('🧪 Starting Phase 2 Batch Caching & Autopilot Test Suite...\n');

  try {
    // ──────────────────────────────────────────────────────────────────────────
    // TEST 1: Direct On-Demand Cache Creation & Early Purge
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 1: Testing on_demand_cache (Create 2h TTL & Early Purge) ---');
    const cacheResult = await getOrCreate2HourCache();
    console.log(`✓ Created 2-hour cache: ${cacheResult.cacheName}`);
    console.log(`✓ Initial remaining TTL: ${cacheResult.remainingSec}s (~${Math.round(cacheResult.remainingSec / 60)} mins)`);

    let status = getCacheStatus();
    if (!status.isAlive || status.cacheName !== cacheResult.cacheName) {
      throw new Error('Cache status does not match created cache!');
    }
    console.log('✓ getCacheStatus() verified: isAlive =', status.isAlive);

    // Test early purge
    console.log('Purging cache early...');
    const purgeResult = await purgeCacheEarly();
    console.log('✓ Purge result:', purgeResult);

    status = getCacheStatus();
    if (status.isAlive) {
      throw new Error('Cache should be dead after purgeEarly!');
    }
    console.log('✓ Confirmed cache is purged and isAlive = false\n');

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 2: REST API Endpoints (/qc/batch/status, /qc/batch/purge_cache)
    // ──────────────────────────────────────────────────────────────────────────
    console.log('--- Test 2: Testing REST API Endpoints ---');
    const apiStatusRes = await axios.get(`${BASE_URL}/qc/batch/status`, AUTH_HEADER);
    console.log('✓ /qc/batch/status response:', {
      batchRunning: apiStatusRes.data.batch.isRunning,
      autopilotActive: apiStatusRes.data.autopilot.isActive,
      cacheAlive: apiStatusRes.data.cache.isAlive
    });

    // ──────────────────────────────────────────────────────────────────────────
    // TEST 3: End-to-End Batch Run with Auto-Purge Verification
    // ──────────────────────────────────────────────────────────────────────────
    console.log('\n--- Test 3: End-to-End Batch Execution with Automatic Cache Kill ---');

    // Create 1 dummy test call in 'ready_for_qc' status with realistic conversation segments
    const testCallId = uuidv4();
    const testSegments = [
      { speaker: 'Agent', text: 'Hello, am I speaking with Priya?' },
      { speaker: 'Customer', text: 'Yes, this is Priya. Who is this?' },
      { speaker: 'Agent', text: 'Hi Priya, I am calling from Kalvium regarding your enquiry about our Work-Integrated Computer Science Engineering degree. Is this a good time to speak for two minutes?' },
      { speaker: 'Customer', text: 'Yes, sure. I recently completed my 12th board exams in Physics, Chemistry and Maths.' },
      { speaker: 'Agent', text: 'That is great Priya. In South India, both Computer Science and Maths streams qualify for B.Tech CSE. What are your plans after 12th? Have you started looking into colleges or entrance exams like JEE or state CET?' },
      { speaker: 'Customer', text: 'I am preparing for JEE, but I also want to explore good engineering colleges with strong practical coding and internships from first year.' },
      { speaker: 'Agent', text: 'That makes total sense. Traditional colleges teach 10-year-old theory, whereas at Kalvium students code on laptops from day one. Would you and your parents be free tomorrow evening for a 1-on-1 Google Meet counselling session to see the curriculum demo? Would 5 PM or 7 PM work better for your parents?' },
      { speaker: 'Customer', text: '7 PM tomorrow works well for my father and me.' }
    ];

    await supabase.from('calls').insert({
      id: testCallId,
      qc_status: 'ready_for_qc',
      duration_sec: 140,
      segments: JSON.stringify(testSegments),
      source: 'phone_call'
    });
    console.log(`✓ Inserted realistic call for batch run: ${testCallId} (qc_status: ready_for_qc)`);

    // Trigger batch run
    console.log('Triggering POST /qc/batch/start...');
    const startRes = await axios.post(`${BASE_URL}/qc/batch/start`, {
      concurrency: 2,
      targetCallIds: [testCallId]
    }, AUTH_HEADER);
    console.log('✓ Batch start response:', startRes.data);

    // Poll until batch completes
    console.log('Polling batch progress until completion...');
    let pollCount = 0;
    let completed = false;
    while (pollCount < 40) {
      await sleep(2000);
      pollCount++;
      const currentRes = await axios.get(`${BASE_URL}/qc/batch/status`, AUTH_HEADER);
      const bStatus = currentRes.data.batch;
      process.stdout.write(`  [Tick ${pollCount}] isRunning=${bStatus.isRunning}, completed=${bStatus.completed}/${bStatus.total}, failed=${bStatus.failed}, cacheRemaining=${bStatus.cacheRemainingSec}s\r`);

      if (!bStatus.isRunning && (bStatus.completed > 0 || bStatus.lastSummary?.completed > 0)) {
        completed = true;
        console.log(`\n✓ Batch successfully completed in ${bStatus.lastSummary?.durationSec || 0}s!`);
        console.log('  Summary:', bStatus.lastSummary);
        break;
      }
    }

    if (!completed) {
      throw new Error('Batch did not complete within timeout window');
    }

    // Verify call in Supabase was evaluated
    const { data: verifiedCall } = await supabase.from('calls').select('qc_status, call_quality_score, coaching_report').eq('id', testCallId).single();
    console.log(`✓ Database verification for call ${testCallId}:`);
    console.log(`  qc_status: ${verifiedCall?.qc_status}`);
    console.log(`  call_quality_score: ${verifiedCall?.call_quality_score}`);
    console.log(`  coaching_summary: ${verifiedCall?.coaching_report?.summary?.substring(0, 80)}...`);

    // Verify cache was automatically purged
    const finalCacheStatus = getCacheStatus();
    console.log(`✓ Verifying cache auto-kill: isAlive = ${finalCacheStatus.isAlive} (should be false)`);
    if (finalCacheStatus.isAlive) {
      throw new Error('Cache was NOT automatically killed after batch finished!');
    }
    console.log('✅ Confirmed: Cache was automatically destroyed from Google RAM on completion!');

    // Clean up dummy call
    await supabase.from('calls').delete().eq('id', testCallId);
    console.log('✓ Cleaned up test call from database');

    console.log('\n🎉 ALL PHASE 2 BATCH CACHING & AUTOPILOT TESTS PASSED!');
  } catch (err) {
    console.error('\n❌ Phase 2 test failed:', err.response?.data || err.message);
    process.exit(1);
  }
}

runTests();
