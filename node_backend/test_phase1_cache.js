require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const qcEngine = require('./services/qc_engine');

async function runPhase1Tests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PHASE 1 VERIFICATION: GEMINI CONTEXT CACHING');
  console.log('====================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set in environment or .env');
  }
  const ai = new GoogleGenAI({ apiKey });
  const model = qcEngine.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  // ── TEST 1: STATIC TOKEN COUNT THRESHOLD ───────────────────────
  console.log('▶ [Test 1] Checking Master Static Knowledge Base token count...');
  const staticContext = qcEngine.getMasterStaticContext();
  const tokenCountRes = await ai.models.countTokens({
    model,
    contents: staticContext
  });
  console.log(`  ✓ Master Static Context has ${tokenCountRes.totalTokens} tokens.`);
  if (tokenCountRes.totalTokens < 4096) {
    throw new Error(`Token count ${tokenCountRes.totalTokens} is below Gemini caching threshold (4,096)!`);
  }
  console.log('  ✅ [Test 1 PASSED]: Static tokens comfortably exceed caching minimum.\n');

  // ── TEST 2: CACHE CREATION & DISK PERSISTENCE ──────────────────
  console.log('▶ [Test 2] Creating cache and verifying disk persistence...');
  const cacheName1 = await qcEngine.getActiveCache(ai, model);
  console.log(`  ✓ Active Cache Name: ${cacheName1}`);
  if (!cacheName1 || !cacheName1.startsWith('cachedContents/')) {
    throw new Error(`Invalid cache name returned: ${cacheName1}`);
  }

  const statePath = path.join(__dirname, 'config', '.gemini_cache_state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error('State file .gemini_cache_state.json was not created on disk!');
  }
  const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  console.log(`  ✓ Disk State: cacheName=${stateData.cacheName}, expires=${stateData.expireTime}`);
  if (stateData.cacheName !== cacheName1) {
    throw new Error('Disk state cacheName does not match returned cache name!');
  }

  // Second fetch must reuse the same cache instantly without recreating
  const cacheName2 = await qcEngine.getActiveCache(ai, model);
  if (cacheName2 !== cacheName1) {
    throw new Error(`Cache reuse failed! Expected ${cacheName1}, got ${cacheName2}`);
  }
  console.log('  ✓ Cache successfully reused from cache pointer.');
  console.log('  ✅ [Test 2 PASSED]: Cache creation & disk persistence verified.\n');

  // ── TEST 3: CONCURRENCY MUTEX LOCK ────────────────────────────
  console.log('▶ [Test 3] Testing concurrency mutex lock (simultaneous parallel calls)...');
  const parallelCalls = await Promise.all([
    qcEngine.getActiveCache(ai, model),
    qcEngine.getActiveCache(ai, model),
    qcEngine.getActiveCache(ai, model),
    qcEngine.getActiveCache(ai, model),
    qcEngine.getActiveCache(ai, model)
  ]);
  const allIdentical = parallelCalls.every(name => name === cacheName1);
  if (!allIdentical) {
    throw new Error(`Concurrency race condition detected! Names: ${JSON.stringify(parallelCalls)}`);
  }
  console.log(`  ✓ 5 concurrent requests all resolved to: ${cacheName1}`);
  console.log('  ✅ [Test 3 PASSED]: Concurrency safety verified.\n');

  // ── TEST 4: LIVE GENERATION & CACHE HIT VERIFICATION ───────────
  console.log('▶ [Test 4] Running live generateContent to verify cache hit...');
  const prompt = 'According to the official 2026 placement highlights, what is the highest salary and total placement percentage? Answer in 1 line.';
  const genResponse = await qcEngine.generateContentWithRetry({
    model,
    contents: prompt,
    config: {
      cachedContent: cacheName1,
      temperature: 0.1
    }
  });

  const usage = genResponse.usageMetadata;
  console.log('  ✓ Model Response:', genResponse.text.trim());
  console.log('  ✓ Usage Metadata:', {
    promptTokens: usage.promptTokenCount,
    cachedTokens: usage.cachedContentTokenCount,
    outputTokens: usage.candidatesTokenCount
  });

  if (!usage.cachedContentTokenCount || usage.cachedContentTokenCount < 11000) {
    throw new Error(`Cache hit failed! Expected >= 11,000 cached tokens, got: ${usage.cachedContentTokenCount}`);
  }
  console.log(`  ✓ CONFIRMED: ${usage.cachedContentTokenCount} tokens read directly from cache at 90% discount!`);
  console.log('  ✅ [Test 4 PASSED]: Live cache hit confirmed.\n');

  // ── TEST 5: INVALIDATION & AUTO-HEAL ───────────────────────────
  console.log('▶ [Test 5] Testing cache invalidation and auto-heal...');
  await qcEngine.invalidateCache(cacheName1);
  if (fs.existsSync(statePath)) {
    throw new Error('State file was not deleted upon invalidation!');
  }
  console.log('  ✓ State file cleanly unlinked.');
  
  const cacheNameFresh = await qcEngine.getActiveCache(ai, model);
  console.log(`  ✓ Auto-heal recreated fresh cache: ${cacheNameFresh}`);
  if (!cacheNameFresh || !cacheNameFresh.startsWith('cachedContents/')) {
    throw new Error('Auto-heal failed to create replacement cache!');
  }
  console.log('  ✅ [Test 5 PASSED]: Cache invalidation and auto-heal verified.\n');

  console.log('====================================================');
  console.log('🎉 ALL 5 PHASE 1 VERIFICATION TESTS PASSED SUCCESSFULLY!');
  console.log('====================================================');
}

runPhase1Tests().catch(err => {
  console.error('\n❌ PHASE 1 TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
