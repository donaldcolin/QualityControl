const cacheManager = require('./cache_manager');
const spendTracker = require('./spend_tracker');

/**
 * Invokes Gemini API generateContent with exponential backoff on transient errors (429, 503, RESOURCE_EXHAUSTED)
 * and transparent auto-healing on cache eviction (404 / CachedContent not found).
 * @param {object} ai - The GoogleGenAI client instance
 * @param {object} params - Parameters passed to ai.models.generateContent({ model, contents, config })
 * @param {object} [options] - Retry options
 * @param {string} [options.reason] - Human-readable business reason for auditing/spend tracking
 * @param {string} [options.caller] - Caller identifier (e.g. Call ID)
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.initialDelayMs=1500] - Base delay before first retry
 * @param {number} [options.factor=2] - Exponential multiplier
 */
async function callGeminiWithRetry(ai, params, options = {}) {
  if (!ai || !ai.models) {
    throw new Error("Gemini AI client is not initialized or API key is missing.");
  }

  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1500;
  const factor = options.factor ?? 2;
  const timeoutMs = options.timeoutMs ?? 60000;

  let attempt = 0;
  while (true) {
    let timer = null;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error(`Gemini API request timed out after ${timeoutMs}ms`);
          timeoutErr.status = 504;
          timeoutErr.isTimeout = true;
          reject(timeoutErr);
        }, timeoutMs);
        if (timer.unref) timer.unref();
      });

      const result = await Promise.race([
        ai.models.generateContent(params),
        timeoutPromise
      ]);
      clearTimeout(timer);

      // ── Real-Time Spend Tracking & Hourly Ledger ─────────────────────────
      if (result && result.usageMetadata) {
        try {
          const spendEntry = spendTracker.recordSpend({
            model: params.model,
            usage: result.usageMetadata,
            reason: options.reason || options.caller || params._reason || 'QC Evaluation',
            metadata: options.metadata || {}
          });
          result._spend = spendEntry;
        } catch (spendErr) {
          console.warn(`[SpendTracker] Warning: Could not record spend: ${spendErr.message}`);
        }
      }

      return result;
    } catch (err) {
      if (timer) clearTimeout(timer);
      attempt++;
      const errorMessage = String(err.message || '');
      const statusCode = err.status || err.statusCode || err.code;

      // Check for cache eviction (404 NOT_FOUND on cachedContent)
      const isCacheEviction = 
        Boolean(params?.config?.cachedContent) &&
        (statusCode === 404 || 
         errorMessage.includes('not found') || 
         errorMessage.includes('cachedContents') ||
         errorMessage.includes('CachedContent'));

      if (isCacheEviction && attempt <= maxRetries) {
        console.warn(`⚠️ [Gemini Cache Eviction] Cache ${params.config.cachedContent} expired or missing. Auto-healing...`);
        await cacheManager.invalidateCache(params.config.cachedContent);
        const newCacheName = await cacheManager.getActiveCache(ai, params.model);
        if (newCacheName) {
          params.config.cachedContent = newCacheName;
          console.log(`🔄 [Gemini Cache Auto-Heal] Refreshed cache pointer to ${newCacheName}. Retrying...`);
        } else {
          delete params.config.cachedContent;
          console.warn(`⚠️ [Gemini Cache Fallback] Context caching unavailable. Retrying without cache...`);
        }
        continue;
      }
      
      const isRateLimitOrTransient = 
        err.isTimeout ||
        statusCode === 429 ||
        statusCode === 503 ||
        statusCode === 504 ||
        statusCode === 500 ||
        errorMessage.includes('429') ||
        errorMessage.includes('503') ||
        errorMessage.includes('timed out') ||
        errorMessage.includes('RESOURCE_EXHAUSTED') ||
        errorMessage.includes('UNAVAILABLE') ||
        errorMessage.includes('overloaded') ||
        errorMessage.includes('Resource has been exhausted');

      if (attempt > maxRetries || !isRateLimitOrTransient) {
        throw err;
      }

      const jitter = Math.floor(Math.random() * 500);
      const delayMs = (initialDelayMs * Math.pow(factor, attempt - 1)) + jitter;
      console.warn(`⚠️ [Gemini Retry] Attempt ${attempt}/${maxRetries} failed: "${errorMessage.slice(0, 100)}...". Retrying in ${delayMs}ms...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { callGeminiWithRetry };
