/**
 * Safe PostgREST query chunking utility.
 * Prevents HTTP 414 Request-URI Too Long errors caused by excessive URL query parameter lengths.
 */

/**
 * Safely executes batch .in() PostgREST queries in small chunks to prevent
 * HTTP 414 Request-URI Too Large errors on large arrays of IDs.
 *
 * @param {Array} items - Array of items (e.g. UUIDs or IDs)
 * @param {number} chunkSize - Number of items per query chunk (default: 50)
 * @param {Function} fetchFn - Async callback receiving chunk array and returning results array
 * @returns {Promise<Array>} Flattened results array
 */
async function fetchInChunks(items, chunkSize = 50, fetchFn) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const results = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await fetchFn(chunk);
    if (Array.isArray(chunkResults) && chunkResults.length > 0) {
      results.push(...chunkResults);
    }
  }
  return results;
}

module.exports = {
  fetchInChunks
};
