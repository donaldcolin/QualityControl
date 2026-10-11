const fs = require('fs');
const path = require('path');

const STORAGE_ROOT = path.resolve(__dirname, '..', '..', 'storage');
const BATCH_FILE_PATH = path.join(STORAGE_ROOT, 'batch_runs.json');

// In-memory cache for sub-millisecond retrieval
const batchCache = new Map();

/**
 * Loads persisted batches from storage/batch_runs.json into memory.
 */
function loadBatchesFromDisk() {
  try {
    if (fs.existsSync(BATCH_FILE_PATH)) {
      const raw = fs.readFileSync(BATCH_FILE_PATH, 'utf8');
      if (raw.trim()) {
        const parsed = JSON.parse(raw);
        for (const [batchId, queueIds] of Object.entries(parsed)) {
          if (Array.isArray(queueIds)) {
            batchCache.set(batchId, queueIds);
          }
        }
        console.log(`📦 [Batch Store] Loaded ${batchCache.size} persistent batches from disk.`);
      }
    }
  } catch (err) {
    console.warn('⚠️ [Batch Store] Failed to load batch store from disk:', err.message);
  }
}

// Initial load on module require
loadBatchesFromDisk();

/**
 * Persists current in-memory batches to storage/batch_runs.json atomically.
 */
function persistToDisk() {
  try {
    if (!fs.existsSync(STORAGE_ROOT)) {
      fs.mkdirSync(STORAGE_ROOT, { recursive: true });
    }

    // Retain the last 1000 batches to prevent unbounded disk growth
    const entries = Array.from(batchCache.entries()).slice(-1000);
    const serialized = JSON.stringify(Object.fromEntries(entries), null, 2);

    // Atomic write via temp file
    const tempFile = `${BATCH_FILE_PATH}.${Date.now()}.tmp`;
    fs.writeFileSync(tempFile, serialized, 'utf8');
    fs.renameSync(tempFile, BATCH_FILE_PATH);
  } catch (err) {
    console.error('❌ [Batch Store] Failed to persist batches to disk:', err.message);
  }
}

/**
 * Saves a batch run mapping (batchId -> Array<queue_id>) and writes to disk.
 */
function saveBatch(batchId, queueIds) {
  if (!batchId || !Array.isArray(queueIds)) return;
  batchCache.set(batchId, queueIds);
  persistToDisk();
}

/**
 * Retrieves the queue IDs for a given batchId.
 */
function getBatch(batchId) {
  if (!batchId) return null;
  // If not in cache, try reload from disk once in case another process/instance saved it
  if (!batchCache.has(batchId)) {
    loadBatchesFromDisk();
  }
  return batchCache.get(batchId) || null;
}

module.exports = {
  saveBatch,
  getBatch,
  loadBatchesFromDisk
};
