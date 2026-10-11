/**
 * Invokes Gemini API generateContent with exponential backoff on transient errors (429, 503, RESOURCE_EXHAUSTED).
 * @param {object} ai - The GoogleGenAI client instance
 * @param {object} params - Parameters passed to ai.models.generateContent({ model, contents, config })
 * @param {object} [options] - Retry options
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

  let attempt = 0;
  while (true) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      attempt++;
      const errorMessage = String(err.message || '');
      const statusCode = err.status || err.statusCode || err.code;
      
      const isRateLimitOrTransient = 
        statusCode === 429 ||
        statusCode === 503 ||
        statusCode === 500 ||
        errorMessage.includes('429') ||
        errorMessage.includes('503') ||
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
