const { GoogleGenAI } = require('@google/genai');
const path = require('path');
const fs = require('fs');
const { getMasterStaticContext, setInMemoryCache } = require('./cache_manager');

const geminiApiKey = process.env.GEMINI_API_KEY || '';
let ai = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({ apiKey: geminiApiKey });
}

const MODEL_ID = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

let activeCacheName = null;
let cacheExpiresAt = null;
let cacheCreatedAt = null;
let inFlightCreationPromise = null;

/**
 * Creates or retrieves an active 2-hour TTL cache (7200s).
 * Thread-safe: Uses a mutex promise to prevent concurrent calls from spawning multiple caches.
 * 
 * @returns {Promise<{ cacheName: string, expiresAt: number, remainingSec: number }>}
 */
async function getOrCreate2HourCache() {
  const now = Date.now();

  // 1. Return existing active cache if still valid with at least 3 minutes buffer
  if (activeCacheName && cacheExpiresAt && (cacheExpiresAt - now > 3 * 60 * 1000)) {
    const remainingSec = Math.max(0, Math.round((cacheExpiresAt - now) / 1000));
    return { cacheName: activeCacheName, expiresAt: cacheExpiresAt, remainingSec };
  }

  // 2. Concurrency Mutex Lock
  if (inFlightCreationPromise) {
    return await inFlightCreationPromise;
  }

  inFlightCreationPromise = (async () => {
    try {
      if (!ai || !ai.caches) {
        throw new Error('GoogleGenAI client or ai.caches is not initialized');
      }

      console.log(`⚡ [OnDemandCache] Generating 2-hour context cache on ${MODEL_ID}...`);
      const staticContext = getMasterStaticContext();

      const newCache = await ai.caches.create({
        model: MODEL_ID,
        config: {
          displayName: `qc_shift_batch_${Date.now()}`,
          contents: [{ role: 'user', parts: [{ text: staticContext }] }],
          ttl: '7200s' // 2 Hours TTL
        }
      });

      activeCacheName = newCache.name;
      cacheExpiresAt = new Date(newCache.expireTime).getTime();
      cacheCreatedAt = now;

      // Sync into cache_manager in-memory state
      setInMemoryCache(activeCacheName, newCache.expireTime, MODEL_ID);

      const remainingSec = Math.max(0, Math.round((cacheExpiresAt - now) / 1000));
      console.log(`✅ [OnDemandCache] Cache created: ${activeCacheName} (Expires: ${newCache.expireTime})`);

      return {
        cacheName: activeCacheName,
        expiresAt: cacheExpiresAt,
        remainingSec
      };
    } catch (err) {
      console.error(`❌ [OnDemandCache] Failed to create 2-hour cache: ${err.message}`);
      throw err;
    } finally {
      inFlightCreationPromise = null;
    }
  })();

  return await inFlightCreationPromise;
}

/**
 * Immediately purges the cache from Google Cloud RAM.
 * Called immediately when batch evaluation completes early to eliminate storage billing.
 */
async function purgeCacheEarly() {
  if (!activeCacheName) {
    return { purged: false, message: 'No active cache to purge' };
  }

  const cacheNameToDelete = activeCacheName;
  const activeDurationMs = cacheCreatedAt ? Date.now() - cacheCreatedAt : 0;
  const activeMins = Math.max(1, Math.round(activeDurationMs / (60 * 1000)));

  try {
    console.log(`🧹 [OnDemandCache] Purging cache ${cacheNameToDelete} early after ${activeMins} min(s) to eliminate storage fees...`);
    if (ai && ai.caches) {
      await ai.caches.delete({ name: cacheNameToDelete });
    }
    console.log(`✅ [OnDemandCache] Successfully deleted ${cacheNameToDelete}. RAM storage billing stopped.`);
    return {
      purged: true,
      cacheName: cacheNameToDelete,
      activeMins,
      savedHours: Math.max(0, 2 - (activeMins / 60))
    };
  } catch (err) {
    console.warn(`⚠️ [OnDemandCache] Notice during cache purge: ${err.message}`);
    return { purged: false, error: err.message };
  } finally {
    activeCacheName = null;
    cacheExpiresAt = null;
    cacheCreatedAt = null;
    setInMemoryCache(null);
  }
}

/**
 * Retrieves the current cache status.
 */
function getCacheStatus() {
  const now = Date.now();
  const isAlive = Boolean(activeCacheName && cacheExpiresAt && cacheExpiresAt > now);
  const remainingSec = isAlive ? Math.round((cacheExpiresAt - now) / 1000) : 0;

  return {
    isAlive,
    cacheName: activeCacheName,
    expiresAt: cacheExpiresAt,
    remainingSec,
    model: MODEL_ID
  };
}

module.exports = {
  getOrCreate2HourCache,
  purgeCacheEarly,
  getCacheStatus
};
