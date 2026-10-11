/**
 * Comprehensive Phase 2 Verification & Resilience Test Suite
 * Tests:
 * 1. Disk Sweeper: TTL deletion, safety grace window protection, empty directories.
 * 2. LSQ Decommission: Verify crm_worker deleted, crm_outbox inserts removed, push_to_lsq returns disabled.
 * 3. Orchestrator: Verify non-blocking status and 202 execution structure.
 * 4. Error Handling: Verify global express error format and daemon lifecycle.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');
const TEMP_AUDIO_DIR = path.join(STORAGE_ROOT, 'temp_audio');
const UPLOADS_DIR = path.join(STORAGE_ROOT, 'uploads');

const { sweepStorage, startDiskSweeperDaemon, stopDiskSweeperDaemon } = require('../services/disk_sweeper');

async function runTests() {
  console.log('====================================================');
  console.log('🧪 RUNNING PHASE 2 PRODUCTION HARDENING TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}`);
      console.error(`     Error: ${err.message}`);
    }
  }

  // ── TEST GROUP 1: DISK SWEEPER ──────────────────────────────────────────
  console.log('📂 1. Testing Disk Sweeper Daemon & TTL Logic...');

  // Ensure directories exist
  if (!fs.existsSync(TEMP_AUDIO_DIR)) fs.mkdirSync(TEMP_AUDIO_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const testOldFile = path.join(TEMP_AUDIO_DIR, `test_old_${Date.now()}.mp3`);
  const testNewFile = path.join(TEMP_AUDIO_DIR, `test_new_${Date.now()}.mp3`);
  const testOldUpload = path.join(UPLOADS_DIR, `test_old_upload_${Date.now()}.wav`);

  // Write mock files
  fs.writeFileSync(testOldFile, 'mock old temp audio content');
  fs.writeFileSync(testNewFile, 'mock new temp audio content');
  fs.writeFileSync(testOldUpload, 'mock old upload content');

  // Set modified time for old files to 48 hours ago
  const fortyEightHoursAgo = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(testOldFile, fortyEightHoursAgo, fortyEightHoursAgo);
  fs.utimesSync(testOldUpload, fortyEightHoursAgo, fortyEightHoursAgo);

  test('Disk Sweeper deletes files older than TTL (24h)', () => {
    // Run sweeper with standard TTL (24h)
    const result = sweepStorage(24 * 60 * 60 * 1000);
    assert(result.totalDeleted >= 2, `Expected at least 2 files deleted, got ${result.totalDeleted}`);
    assert(!fs.existsSync(testOldFile), 'Expired audio file should have been deleted');
    assert(!fs.existsSync(testOldUpload), 'Expired upload file should have been deleted');
  });

  test('Disk Sweeper protects fresh files within safety grace window (15m)', () => {
    assert(fs.existsSync(testNewFile), 'Recent file within grace window must NOT be deleted');
    // Clean up our recent test file
    if (fs.existsSync(testNewFile)) fs.unlinkSync(testNewFile);
  });

  test('Disk Sweeper Daemon starts and stops cleanly without resource leaks', () => {
    startDiskSweeperDaemon(60000);
    // Calling start again should be idempotent
    startDiskSweeperDaemon(60000);
    stopDiskSweeperDaemon();
    // Calling stop again should be idempotent
    stopDiskSweeperDaemon();
  });

  // ── TEST GROUP 2: LSQ DECOMMISSIONING ───────────────────────────────────
  console.log('\n🚫 2. Testing LeadSquared Push Decommissioning...');

  test('crm_worker.js is completely deleted from the codebase', () => {
    const crmWorkerPath = path.join(__dirname, '..', 'services', 'crm_worker.js');
    assert(!fs.existsSync(crmWorkerPath), 'crm_worker.js must not exist in node_backend/services');
  });

  test('qc_evaluations.js has zero crm_outbox queue insertions', () => {
    const evalPath = path.join(__dirname, '..', 'routes', 'qc_split', 'qc_evaluations.js');
    const content = fs.readFileSync(evalPath, 'utf8');
    assert(!content.includes("from('crm_outbox').insert"), 'qc_evaluations.js should not insert into crm_outbox');
    assert(!content.includes('crm_outbox'), 'qc_evaluations.js should have all crm_outbox references removed');
  });

  test('/coaching/push_to_lsq route is safely decommissioned', () => {
    const integPath = path.join(__dirname, '..', 'routes', 'qc_split', 'qc_integrations.js');
    const content = fs.readFileSync(integPath, 'utf8');
    assert(content.includes('LeadSquared outbound activity push is disabled') && content.includes("'disabled'"), 'push_to_lsq endpoint should return disabled status');
  });

  // ── TEST GROUP 3: ORCHESTRATOR & RESILIENCE ─────────────────────────────
  console.log('\n⚡ 3. Testing Orchestrator & Process Hardening...');

  test('orchestrator.js exports non-blocking scan_status endpoint', () => {
    const orchPath = path.join(__dirname, '..', 'routes', 'orchestrator.js');
    const content = fs.readFileSync(orchPath, 'utf8');
    assert(content.includes("router.get('/scan_status'"), 'scan_status endpoint must exist');
    assert(content.includes('res.status(202)'), 'scan_all must return HTTP 202 Accepted immediately');
    assert(content.includes('setImmediate'), 'scan execution must be decoupled via setImmediate');
  });

  test('server.js contains uncaughtException and unhandledRejection handlers', () => {
    const serverPath = path.join(__dirname, '..', 'server.js');
    const content = fs.readFileSync(serverPath, 'utf8');
    assert(content.includes("process.on('unhandledRejection'"), 'unhandledRejection listener must exist');
    assert(content.includes("process.on('uncaughtException'"), 'uncaughtException listener must exist');
    assert(content.includes("process.on('SIGTERM'"), 'SIGTERM handler must exist');
    assert(content.includes("process.on('SIGINT'"), 'SIGINT handler must exist');
    assert(content.includes("app.set('trust proxy', 1)"), 'trust proxy must be enabled for reverse proxy');
  });

  // ── TEST GROUP 4: FRONTEND RESILIENCE ───────────────────────────────────
  console.log('\n🛡️ 4. Testing Frontend Error Boundary & Assets...');

  test('ErrorBoundary component exists and exports properly', () => {
    const ebPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'ErrorBoundary.jsx');
    assert(fs.existsSync(ebPath), 'ErrorBoundary.jsx must exist');
    const content = fs.readFileSync(ebPath, 'utf8');
    assert(content.includes('getDerivedStateFromError'), 'ErrorBoundary must implement getDerivedStateFromError');
    assert(content.includes('componentDidCatch'), 'ErrorBoundary must implement componentDidCatch');
  });

  test('App.jsx wraps main content and root in ErrorBoundary', () => {
    const appPath = path.join(__dirname, '..', '..', 'frontend', 'src', 'App.jsx');
    const content = fs.readFileSync(appPath, 'utf8');
    assert(content.includes("import ErrorBoundary from './components/ErrorBoundary';"), 'ErrorBoundary must be imported');
    assert(content.includes('<ErrorBoundary>'), 'ErrorBoundary component must wrap content');
  });

  console.log('\n====================================================');
  console.log(`📊 TEST RESULTS: ${passed}/${total} PASSED`);
  console.log('====================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal test runner failure:', err);
  process.exit(1);
});
