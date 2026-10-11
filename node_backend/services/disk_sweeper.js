const fs = require('fs');
const path = require('path');

const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');
const TARGET_DIRS = [
  path.join(STORAGE_ROOT, 'temp_audio'),
  path.join(STORAGE_ROOT, 'uploads')
];

// Default TTL: 24 hours (configurable via env)
const TTL_HOURS = parseInt(process.env.STORAGE_FILE_TTL_HOURS || '24', 10);
const TTL_MS = TTL_HOURS * 60 * 60 * 1000;

// Safety window: Never touch files created/modified in the last 15 minutes
const SAFETY_GRACE_MS = 15 * 60 * 1000;
const HIGH_WATERMARK_PCT = 85; // Emergency threshold

/**
 * Checks disk usage percentage if supported by OS filesystem.
 */
function getDiskUsagePct() {
  try {
    if (fs.statfsSync) {
      const stats = fs.statfsSync(STORAGE_ROOT);
      const total = stats.bsize * stats.blocks;
      const free = stats.bsize * stats.bfree;
      if (total > 0) {
        return ((total - free) / total) * 100;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Sweeps temporary media directories and removes files exceeding TTL.
 * Automatically activates emergency 2h purge if disk capacity exceeds 85%.
 */
function sweepStorage(customTtlMs = TTL_MS) {
  const now = Date.now();
  let totalDeleted = 0;
  let bytesFreed = 0;

  const usedPct = getDiskUsagePct();
  let effectiveTtlMs = customTtlMs;

  if (usedPct !== null && usedPct > HIGH_WATERMARK_PCT) {
    console.warn(`🚨 [Disk Sweeper] High-watermark disk capacity reached (${usedPct.toFixed(1)}% used). Activating emergency 2-hour TTL purge.`);
    effectiveTtlMs = 2 * 60 * 60 * 1000; // 2 hours emergency TTL
  }

  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) continue;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.startsWith('.')) continue; // Skip hidden files (.gitkeep, .DS_Store)

        const filePath = path.join(dir, file);
        try {
          const stats = fs.statSync(filePath);
          if (!stats.isFile()) continue;

          const fileAgeMs = now - stats.mtimeMs;

          // If file is older than effective TTL and safely past the grace window
          if (fileAgeMs > effectiveTtlMs && fileAgeMs > SAFETY_GRACE_MS) {
            bytesFreed += stats.size;
            fs.unlinkSync(filePath);
            totalDeleted++;
          }
        } catch (statErr) {
          // File might have been removed concurrently, ignore
        }
      }
    } catch (dirErr) {
      console.warn(`⚠️ [Disk Sweeper] Error reading directory ${dir}:`, dirErr.message);
    }
  }

  if (totalDeleted > 0) {
    const mbFreed = (bytesFreed / (1024 * 1024)).toFixed(2);
    console.log(`🧹 [Disk Sweeper] Cleaned up ${totalDeleted} expired temp files (${mbFreed} MB freed).`);
  }
  return { totalDeleted, bytesFreed };
}

let sweeperIntervalId = null;

/**
 * Starts the automated 24/7 background sweeping daemon.
 */
function startDiskSweeperDaemon(intervalMs = 60 * 60 * 1000) {
  if (sweeperIntervalId) return;

  console.log(`🛡️ [Disk Sweeper] Starting 24/7 storage cleanup daemon (TTL: ${TTL_HOURS}h, Interval: ${Math.round(intervalMs / 60000)}m)`);
  
  // Run an immediate sweep on boot
  try {
    sweepStorage();
  } catch (err) {
    console.error("⚠️ [Disk Sweeper] Boot sweep failed:", err.message);
  }

  // Schedule periodic background sweep
  sweeperIntervalId = setInterval(() => {
    try {
      sweepStorage();
    } catch (err) {
      console.error("⚠️ [Disk Sweeper] Periodic sweep failed:", err.message);
    }
  }, intervalMs);

  // Unref interval so it doesn't block graceful shutdown
  if (sweeperIntervalId.unref) {
    sweeperIntervalId.unref();
  }
}

function stopDiskSweeperDaemon() {
  if (sweeperIntervalId) {
    clearInterval(sweeperIntervalId);
    sweeperIntervalId = null;
  }
}

module.exports = {
  sweepStorage,
  startDiskSweeperDaemon,
  stopDiskSweeperDaemon
};
