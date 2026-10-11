/**
 * Safely parses JSON strings returned by LLMs.
 * Handles:
 *   - Markdown ```json ... ``` code fences
 *   - Trailing commentary after the JSON block
 *   - Leading/trailing whitespace
 *   - Truncated JSON (logs a clear error message)
 */
function safeParseGeminiJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Empty or non-string response received from Gemini.');
  }

  let cleaned = rawText.trim();

  // 1. Strip markdown code fences if present
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  cleaned = cleaned.trim();

  // 2. Locate the outermost JSON structure
  const firstBrace = cleaned.search(/[\{\[]/);
  if (firstBrace === -1) {
    throw new Error(`No JSON object or array found in Gemini response. Snippet: "${cleaned.slice(0, 200)}"`);
  }

  const openChar = cleaned[firstBrace];
  const closeChar = openChar === '{' ? '}' : ']';

  // Find the matching closing brace/bracket (last occurrence)
  let lastBrace = cleaned.lastIndexOf(closeChar);
  if (lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error(`Unmatched ${openChar} in Gemini response — likely truncated. Snippet: "${cleaned.slice(0, 200)}"`);
  }

  cleaned = cleaned.substring(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse Gemini JSON after cleanup: ${err.message}. ` +
      `First 300 chars: "${cleaned.slice(0, 300)}"`
    );
  }
}

module.exports = { safeParseGeminiJSON };
