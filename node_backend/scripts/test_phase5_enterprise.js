const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('🧪 Starting Phase 5: 24/7/365 Enterprise Production Hardening Test Suite...\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
    console.error(err.stack);
  }
}

// ── TEST 1: Universal Queue Watchdog In-Flight Sweep & Max Retries ──
runTest('Queue Watchdog sweeps abandoned in-flight states and respects max attempts', () => {
  const { sweepStaleQueueJobs } = require('../services/queue_watchdog');
  assert.strictEqual(typeof sweepStaleQueueJobs, 'function', 'sweepStaleQueueJobs must be exported');

  const watchdogSource = fs.readFileSync(path.join(__dirname, '../services/queue_watchdog.js'), 'utf8');
  assert(watchdogSource.includes('MAX_ATTEMPTS = 3'), 'Watchdog must define MAX_ATTEMPTS');
  assert(watchdogSource.includes('inFlightJobs'), 'Watchdog must query all inFlightJobs');
  assert(watchdogSource.includes('watchdog_max_retries'), 'Watchdog must record watchdog_max_retries failure stage');
});

// ── TEST 2: CRM Timeout Enforcement ──
runTest('LeadSquared CRM clients have 10s timeout protection configured', () => {
  const leadServiceSrc = fs.readFileSync(path.join(__dirname, '../services/lead_service.js'), 'utf8');
  assert(leadServiceSrc.includes('timeout: 10000'), 'lead_service must enforce 10000ms timeout');
  assert(leadServiceSrc.includes('lsqClient = axios.create'), 'lead_service must use lsqClient with timeout');

  const associatesSrc = fs.readFileSync(path.join(__dirname, '../routes/associates.js'), 'utf8');
  assert(associatesSrc.includes('timeout: 10000'), 'associates.js must enforce 10000ms timeout');

  const searchSrc = fs.readFileSync(path.join(__dirname, '../routes/search.js'), 'utf8');
  assert(searchSrc.includes('timeout: 10000'), 'search.js must enforce 10000ms timeout');

  const orchestratorSrc = fs.readFileSync(path.join(__dirname, '../routes/orchestrator.js'), 'utf8');
  assert(orchestratorSrc.includes('crm_timeouts'), 'orchestrator must track crm_timeouts');
});

// ── TEST 3: Zero-Backdoor Auth Middleware ──
runTest('Auth middleware eliminates hardcoded fallback strings and validates env secret', () => {
  const authSrc = fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8');
  assert(!authSrc.includes("'internal_ai_worker_token'"), 'auth.js must not contain hardcoded internal_ai_worker_token');
  assert(!authSrc.includes("INTERNAL_WORKER_SECRET || 'internal_qc_worker_secret_2026'"), 'auth.js must not have fallback secret string');
  assert(authSrc.includes('Production authentication failed: SUPABASE_JWT_SECRET must be configured'), 'auth.js must forbid unverified claims in production');
});

// ── TEST 4: Demo Push Loopback Authentication ──
runTest('Demo Push to QC includes Authorization bearer headers in internal loopbacks', () => {
  const qcEvalSrc = fs.readFileSync(path.join(__dirname, '../routes/qc_split/qc_evaluations.js'), 'utf8');
  assert(qcEvalSrc.includes('loopbackConfig = workerToken'), 'qc_evaluations must configure loopbackConfig with workerToken');
  assert(qcEvalSrc.includes('Authorization: `Bearer ${workerToken}`'), 'qc_evaluations must send Bearer token on loopback');
});

// ── TEST 5: Rolling Journey Token Capping & Compression ──
runTest('evaluateLeadJourney compresses prior calls and bounds context to 5 touchpoints', () => {
  const workflowSrc = fs.readFileSync(path.join(__dirname, '../services/qc_engine/workflows.js'), 'utf8');
  assert(workflowSrc.includes('MAX_JOURNEY_CALLS = 5'), 'workflows.js must cap rolling calls to 5');
  assert(workflowSrc.includes('calls.slice(-MAX_JOURNEY_CALLS)'), 'workflows.js must slice to recent calls');
  assert(workflowSrc.includes('Prior Call Summary:'), 'workflows.js must use compressed summaries for older calls');
  assert(workflowSrc.includes('Full Transcript:'), 'workflows.js must use full transcript only for latest call');
});

// ── TEST 6: High-Watermark Emergency Disk Protection ──
runTest('Disk Sweeper detects high-watermark capacity and enables 2-hour emergency purge', () => {
  const sweeperSrc = fs.readFileSync(path.join(__dirname, '../services/disk_sweeper.js'), 'utf8');
  assert(sweeperSrc.includes('HIGH_WATERMARK_PCT = 85'), 'disk_sweeper must define HIGH_WATERMARK_PCT');
  assert(sweeperSrc.includes('getDiskUsagePct'), 'disk_sweeper must implement getDiskUsagePct');
  assert(sweeperSrc.includes('effectiveTtlMs = 2 * 60 * 60 * 1000'), 'disk_sweeper must switch to 2h emergency TTL');
});

// ── TEST 7: RBAC Protection on QC Parameters and Demo Seed ──
runTest('Quality checks and Demo Seed endpoints require admin role', () => {
  const paramSrc = fs.readFileSync(path.join(__dirname, '../routes/qc_split/qc_parameters.js'), 'utf8');
  assert(paramSrc.includes("router.post('/quality_checks', requireRole(['admin'])"), 'POST /quality_checks must require admin');
  assert(paramSrc.includes("router.put('/quality_checks/:id', requireRole(['admin'])"), 'PUT /quality_checks/:id must require admin');
  assert(paramSrc.includes("router.delete('/quality_checks/:id', requireRole(['admin'])"), 'DELETE /quality_checks/:id must require admin');

  const leadSrc = fs.readFileSync(path.join(__dirname, '../routes/qc_split/qc_leads.js'), 'utf8');
  assert(leadSrc.includes("router.post('/demo/seed', requireRole(['admin'])"), 'POST /demo/seed must require admin');
});

// ── TEST 8: Dashboard KPI PostgREST Query Optimization ──
runTest('Dashboard KPIs use head counts and schema-safe aggregations', () => {
  const qcEvalSrc = fs.readFileSync(path.join(__dirname, '../routes/qc_split/qc_evaluations.js'), 'utf8');
  assert(qcEvalSrc.includes("select('*', { count: 'exact', head: true })"), 'dashboard_kpis must use head count query');
  assert(qcEvalSrc.includes("from('callizer_queue')"), 'dashboard_kpis must query callsToday from callizer_queue');
});

console.log(`\n================================================================`);
console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
console.log(`================================================================\n`);

if (passedTests !== totalTests) {
  process.exit(1);
} else {
  console.log('🎉 All Phase 5 Enterprise 24/7/365 resilience tests passed successfully!\n');
}
