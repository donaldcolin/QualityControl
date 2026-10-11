/**
 * Live End-to-End Test for server.js
 * Boots server on PORT=3999, tests endpoints, verifies graceful shutdown on SIGINT.
 */

const { fork } = require('child_process');
const http = require('http');
const path = require('path');
const assert = require('assert');

const TEST_PORT = 3999;
const serverPath = path.resolve(__dirname, '..', 'server.js');

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode, headers: res.headers, text: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function main() {
  console.log('🚀 Booting server.js on port', TEST_PORT);

  const serverProc = fork(serverPath, [], {
    env: { ...process.env, PORT: TEST_PORT },
    silent: true
  });

  serverProc.stdout.on('data', (d) => process.stdout.write(`[SERVER OUT] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[SERVER ERR] ${d}`));

  // Wait 1.5 seconds for boot
  await new Promise(r => setTimeout(r, 1500));

  try {
    console.log('\n📡 Testing GET /api/orchestrate/scan_status with Bearer token...');
    const scanRes = await fetch(`http://localhost:${TEST_PORT}/api/orchestrate/scan_status`, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer internal_qc_worker_secret_2026'
      }
    });
    console.log('  Response status:', scanRes.status);
    console.log('  Response body:', scanRes.body);
    assert.strictEqual(scanRes.status, 200);
    assert.strictEqual(scanRes.body.running, false);

    console.log('\n📡 Testing POST /api/coaching/push_to_lsq...');
    const lsqRes = await fetch(`http://localhost:${TEST_PORT}/api/coaching/push_to_lsq`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer internal_qc_worker_secret_2026',
        'Content-Type': 'application/json'
      }
    });
    console.log('  Response status:', lsqRes.status);
    console.log('  Response body:', lsqRes.body);
    assert.strictEqual(lsqRes.status, 200);
    assert.strictEqual(lsqRes.body.status, 'disabled');

    console.log('\n📡 Testing POST /api/orchestrate/scan_all (expect HTTP 202 Accepted)...');
    const scanAllRes = await fetch(`http://localhost:${TEST_PORT}/api/orchestrate/scan_all`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer internal_qc_worker_secret_2026',
        'Content-Type': 'application/json'
      }
    });
    console.log('  Response status:', scanAllRes.status);
    console.log('  Response body:', scanAllRes.body);
    assert.strictEqual(scanAllRes.status, 202);
    assert.strictEqual(scanAllRes.body.status, 'Scan started in background');
    assert(scanAllRes.body.scan_id, 'Scan ID must be present in response');

    console.log('\n🛑 Sending SIGINT to server process for graceful shutdown test...');
    serverProc.kill('SIGINT');

    const exitCode = await new Promise(resolve => {
      serverProc.on('exit', (code, signal) => {
        console.log(`✅ Server exited with code: ${code}, signal: ${signal}`);
        resolve(code);
      });
    });

    console.log('\n🎉 ALL LIVE SERVER END-TO-END TESTS PASSED!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Live test failed:', err);
    serverProc.kill('SIGKILL');
    process.exit(1);
  }
}

main();
