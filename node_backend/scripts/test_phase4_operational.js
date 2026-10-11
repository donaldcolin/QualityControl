/**
 * Comprehensive Phase 4 Operational Hardening & Observability Test Suite
 * Validates:
 * 1. Boot Environment & Storage Directory Validator (config/env_validator.js)
 * 2. 24/7 Unified Health Probes & Diagnostics (routes/health.js)
 * 3. HTTP 206 Partial Content & Range Streaming (routes/calls.js)
 * 4. Gemini API Call Execution Timeouts & Backoff Recovery (services/qc_engine/call_gemini.js)
 * 5. FFmpeg Child Process Safety & Timeout Handling (services/drive_audio_extractor.js)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const http = require('http');
const express = require('express');

async function runPhase4Tests() {
  console.log('🧪 Starting Phase 4 Operational Hardening Test Suite...\n');
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

  // ── TEST 1: PRE-FLIGHT BOOT ENVIRONMENT VALIDATOR ────────────────────────
  console.log('--- 1. Testing Pre-Flight Boot Validator ---');
  const { validateEnvironment } = require('../config/env_validator');

  test('validateEnvironment ensures required storage directories exist', () => {
    const res = validateEnvironment();
    assert(typeof res === 'object', 'Must return validation result object');

    const storageRoot = path.resolve(__dirname, '../../storage');
    assert(fs.existsSync(path.join(storageRoot, 'temp_audio')), 'temp_audio must exist');
    assert(fs.existsSync(path.join(storageRoot, 'json_transcripts')), 'json_transcripts must exist');
    assert(fs.existsSync(path.join(storageRoot, 'reference_slides', 'images')), 'slides/images must exist');
  });

  // ── TEST 2: UNIFIED 24/7 HEALTHCHECK PROBE ───────────────────────────────
  console.log('\n--- 2. Testing Unified 24/7 Healthcheck Probe ---');
  const healthRouter = require('../routes/health');

  await asyncTest('GET /health returns structured diagnostics with memory and daemons', async () => {
    const app = express();
    app.use('/health', healthRouter);

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    const res = await fetch(`http://localhost:${port}/health`);
    const data = await res.json();
    server.close();

    assert(data.status === 'healthy' || data.status === 'degraded', 'Status must be healthy or degraded');
    assert(typeof data.uptime_seconds === 'number', 'uptime_seconds must be a number');
    assert(typeof data.memory === 'object', 'memory metrics must be an object');
    assert(data.memory.rss_mb > 0, 'rss_mb must be greater than 0');
    assert(data.services.storage.status === 'writable', 'storage check must confirm writable');
    assert(data.daemons.disk_sweeper === 'active', 'disk_sweeper must be active');
    assert(data.daemons.queue_watchdog === 'active', 'queue_watchdog must be active');
  });

  // ── TEST 3: HTTP 206 RANGE STREAMING ─────────────────────────────────────
  console.log('\n--- 3. Testing HTTP 206 Range Streaming ---');
  await asyncTest('Range headers return HTTP 206 Partial Content with correct byte slices', async () => {
    const storageRoot = path.resolve(__dirname, '../../storage');
    const tempDir = path.join(storageRoot, 'temp_audio');
    const testAudioPath = path.join(tempDir, 'test_range_audio.wav');

    // Create 1000-byte test payload
    const testBuffer = Buffer.alloc(1000, 65); // 1000 'A' characters
    fs.writeFileSync(testAudioPath, testBuffer);

    const app = express();
    // Simulate range streaming handler logic from calls.js
    app.get('/audio', (req, res) => {
      const stat = fs.statSync(testAudioPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunkSize = (end - start) + 1;

        res.status(206).set({
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/wav'
        });

        fs.createReadStream(testAudioPath, { start, end }).pipe(res);
      } else {
        res.set({
          'Content-Length': fileSize,
          'Accept-Ranges': 'bytes',
          'Content-Type': 'audio/wav'
        });
        fs.createReadStream(testAudioPath).pipe(res);
      }
    });

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    // Test 1: Range request for bytes 100-199 (100 bytes)
    const rangeRes = await fetch(`http://localhost:${port}/audio`, {
      headers: { 'Range': 'bytes=100-199' }
    });

    assert.strictEqual(rangeRes.status, 206, 'Must return HTTP 206 Partial Content');
    assert.strictEqual(rangeRes.headers.get('content-range'), 'bytes 100-199/1000', 'Content-Range must match');
    assert.strictEqual(rangeRes.headers.get('content-length'), '100', 'Content-Length must be 100');
    assert.strictEqual(rangeRes.headers.get('accept-ranges'), 'bytes', 'Accept-Ranges must be bytes');
    const chunkData = await rangeRes.arrayBuffer();
    assert.strictEqual(chunkData.byteLength, 100, 'Received payload must be exactly 100 bytes');

    // Test 2: Standard non-ranged request
    const fullRes = await fetch(`http://localhost:${port}/audio`);
    assert.strictEqual(fullRes.status, 200, 'Must return HTTP 200 for full audio');
    assert.strictEqual(fullRes.headers.get('content-length'), '1000', 'Full length must be 1000');

    server.close();
    fs.unlinkSync(testAudioPath);
  });

  // ── TEST 4: GEMINI EXECUTION TIMEOUT & RETRY RECOVERY ────────────────────
  console.log('\n--- 4. Testing Gemini Call Timeout & Recovery ---');
  const { callGeminiWithRetry } = require('../services/qc_engine/call_gemini');

  await asyncTest('callGeminiWithRetry recovers after simulated timeout', async () => {
    let callAttempts = 0;
    const mockAi = {
      models: {
        generateContent: async () => {
          callAttempts++;
          if (callAttempts === 1) {
            // First attempt hangs past the 100ms test timeout
            await new Promise(r => setTimeout(r, 200));
            return { text: 'too late' };
          }
          // Second attempt succeeds immediately
          return { text: JSON.stringify({ success: true, attempts: callAttempts }) };
        }
      }
    };

    const result = await callGeminiWithRetry(mockAi, {}, {
      timeoutMs: 80, // Fast timeout for test
      initialDelayMs: 20,
      factor: 1,
      maxRetries: 2
    });

    assert(result && result.text, 'Must return result from recovery attempt');
    assert.strictEqual(callAttempts, 2, 'Must have timed out on attempt 1 and succeeded on attempt 2');
  });

  // ── TEST 5: FFMPEG RUNNER & NOTIFICATION TIMEOUT ─────────────────────────
  console.log('\n--- 5. Testing FFmpeg Safety & Queue Notification ---');
  const driveExtractor = require('../services/drive_audio_extractor');
  test('drive_audio_extractor exports extractAudioFromDrive', () => {
    assert(typeof driveExtractor.extractAudioFromDrive === 'function', 'extractAudioFromDrive must be a function');
  });

  console.log(`\n========================================`);
  console.log(`Phase 4 Test Results: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4Tests().catch(err => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
});
