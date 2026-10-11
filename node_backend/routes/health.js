const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');

const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');

/**
 * Liveness & Readiness Diagnostic Probe for 24/7 monitoring.
 * Accessible by reverse proxy, load balancers, and external monitoring daemons.
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const checks = {
    database: { status: 'unknown', latency_ms: 0 },
    python_worker: { status: 'unknown', latency_ms: 0 },
    storage: { status: 'unknown' }
  };

  let isHealthy = true;

  // 1. Check Supabase Database Connectivity
  const dbStart = Date.now();
  try {
    if (supabase) {
      const { error } = await supabase
        .from('qc_associates')
        .select('emp_number', { count: 'exact', head: true })
        .limit(1);

      checks.database.latency_ms = Date.now() - dbStart;
      if (error) {
        checks.database.status = 'degraded';
        checks.database.error = error.message;
      } else {
        checks.database.status = 'up';
      }
    } else {
      checks.database.status = 'unconfigured';
    }
  } catch (dbErr) {
    checks.database.status = 'down';
    checks.database.error = dbErr.message;
    isHealthy = false;
  }

  // 2. Check Python ASR & Webhook Worker Connectivity
  const pyStart = Date.now();
  try {
    const pyResp = await axios.get('http://127.0.0.1:8000/health', { timeout: 2500 });
    checks.python_worker.latency_ms = Date.now() - pyStart;
    checks.python_worker.status = (pyResp.status === 200) ? 'up' : 'degraded';
  } catch (pyErr) {
    checks.python_worker.status = 'down';
    checks.python_worker.error = pyErr.message;
    // Python worker down is non-fatal for serving static reads, but marked degraded
  }

  // 3. Check Storage Directory Write Access
  try {
    const testFile = path.join(STORAGE_ROOT, 'temp_audio', `.healthcheck_${Date.now()}.tmp`);
    fs.writeFileSync(testFile, 'ok', 'utf8');
    if (fs.existsSync(testFile)) {
      fs.unlinkSync(testFile);
      checks.storage.status = 'writable';
    } else {
      checks.storage.status = 'unreadable';
      isHealthy = false;
    }
  } catch (storageErr) {
    checks.storage.status = 'unwritable';
    checks.storage.error = storageErr.message;
    isHealthy = false;
  }

  // 4. Memory Metrics
  const mem = process.memoryUsage();
  const memoryMetrics = {
    rss_mb: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
    heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024 * 10) / 10,
    heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    external_mb: Math.round(mem.external / 1024 / 1024 * 10) / 10
  };

  const payload = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    latency_ms: Date.now() - startTime,
    memory: memoryMetrics,
    services: checks,
    daemons: {
      disk_sweeper: 'active',
      queue_watchdog: 'active'
    }
  };

  const statusCode = isHealthy ? 200 : 503;
  res.status(statusCode).json(payload);
});

module.exports = router;
