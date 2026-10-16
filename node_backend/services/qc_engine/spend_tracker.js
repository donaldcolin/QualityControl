const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LEDGER_FILE_PATH = path.join(__dirname, '..', '..', 'config', 'gemini_spend_ledger.jsonl');

// Official Gemini Model Rates (USD per 1 Million tokens)
const MODEL_PRICING = {
  'gemini-3.1-flash-lite': {
    cachedInputPer1M: 0.025,
    uncachedInputPer1M: 0.25,
    outputPer1M: 1.50
  },
  'gemini-3.5-flash-lite': {
    cachedInputPer1M: 0.03,
    uncachedInputPer1M: 0.15,
    outputPer1M: 2.50
  },
  'gemini-2.5-flash': {
    cachedInputPer1M: 0.03,
    uncachedInputPer1M: 0.30,
    outputPer1M: 2.50
  },
  'gemini-1.5-flash': {
    cachedInputPer1M: 0.0375,
    uncachedInputPer1M: 0.15,
    outputPer1M: 0.60
  },
  'default': {
    cachedInputPer1M: 0.03,
    uncachedInputPer1M: 0.15,
    outputPer1M: 2.50
  }
};

const USD_TO_INR = Number(process.env.USD_TO_INR) || 84.0;

let _todayCumulativeINR = 0;
let _lastResetDate = new Date().toISOString().slice(0, 10);

/**
 * Calculates token cost in USD and INR.
 */
function calculateCost(model, usage = {}) {
  const modelKey = (model || '').toLowerCase().replace('models/', '');
  const rates = MODEL_PRICING[modelKey] || MODEL_PRICING['default'];

  const cachedTokens = Number(usage.cachedContentTokenCount || 0);
  const promptTokens = Number(usage.promptTokenCount || 0);
  const uncachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const outputTokens = Number(usage.candidatesTokenCount || 0);
  const totalTokens = Number(usage.totalTokenCount || (promptTokens + outputTokens));

  const costCachedUSD = (cachedTokens / 1_000_000) * rates.cachedInputPer1M;
  const costUncachedUSD = (uncachedInputTokens / 1_000_000) * rates.uncachedInputPer1M;
  const costOutputUSD = (outputTokens / 1_000_000) * rates.outputPer1M;
  const totalCostUSD = costCachedUSD + costUncachedUSD + costOutputUSD;
  const totalCostINR = totalCostUSD * USD_TO_INR;

  return {
    cachedTokens,
    uncachedInputTokens,
    outputTokens,
    totalTokens,
    costUSD: Number(totalCostUSD.toFixed(6)),
    costINR: Number(totalCostINR.toFixed(4)),
    rates
  };
}

/**
 * Records an API execution in the ledger and console.
 */
function recordSpend({ model, usage, reason = 'Gemini API Call', metadata = {} }) {
  if (!usage) return null;

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const hourNum = now.getHours();
  const hourStr = `${String(hourNum).padStart(2, '0')}:00 - ${String((hourNum + 1) % 24).padStart(2, '0')}:00`;

  // Reset daily accumulator on date change
  if (dateStr !== _lastResetDate) {
    _todayCumulativeINR = 0;
    _lastResetDate = dateStr;
  }

  const {
    cachedTokens,
    uncachedInputTokens,
    outputTokens,
    totalTokens,
    costUSD,
    costINR
  } = calculateCost(model, usage);

  _todayCumulativeINR += costINR;

  const entry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `spend_${Date.now()}`,
    timestamp: now.toISOString(),
    date: dateStr,
    hour: hourStr,
    reason,
    model: model || 'gemini-3.5-flash-lite',
    tokens: {
      cached: cachedTokens,
      uncached_input: uncachedInputTokens,
      output: outputTokens,
      total: totalTokens
    },
    cost_inr: costINR,
    cost_usd: costUSD,
    cumulative_today_inr: Number(_todayCumulativeINR.toFixed(4)),
    metadata
  };

  // Atomically append to JSONL ledger
  try {
    fs.appendFileSync(LEDGER_FILE_PATH, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn(`[SpendTracker] Could not write to ledger file: ${err.message}`);
  }

  // Print high-visibility real-time telemetry line in server console
  const costBadge = costINR < 1 ? `${(costINR * 100).toFixed(1)}p` : `₹${costINR.toFixed(2)}`;
  console.log(
    `💰 [GEMINI SPEND] ${costBadge} (${costINR.toFixed(4)} INR) | Tokens: ${cachedTokens.toLocaleString()} cache-hit, ${uncachedInputTokens.toLocaleString()} uncached, ${outputTokens.toLocaleString()} out | Reason: "${reason}" | Today: ₹${_todayCumulativeINR.toFixed(2)}`
  );

  return entry;
}

/**
 * Reads the ledger and generates an hourly spend breakdown.
 */
function getSpendReport(targetDate = null) {
  const queryDate = targetDate || new Date().toISOString().slice(0, 10);
  const items = [];

  if (fs.existsSync(LEDGER_FILE_PATH)) {
    try {
      const fileContent = fs.readFileSync(LEDGER_FILE_PATH, 'utf8');
      const lines = fileContent.trim().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          if (item.date === queryDate) {
            items.push(item);
          }
        } catch (e) {
          // ignore corrupted lines
        }
      }
    } catch (err) {
      console.warn(`[SpendTracker] Read error: ${err.message}`);
    }
  }

  // Group by hour
  const hourlyMap = {};
  let totalCostINR = 0;
  let totalCostUSD = 0;
  let totalTokens = 0;
  let totalOutputTokens = 0;

  items.forEach(item => {
    const h = item.hour || 'Other';
    if (!hourlyMap[h]) {
      hourlyMap[h] = {
        hour: h,
        count: 0,
        cost_inr: 0,
        cost_usd: 0,
        tokens_total: 0,
        reasons: []
      };
    }
    hourlyMap[h].count++;
    hourlyMap[h].cost_inr += (item.cost_inr || 0);
    hourlyMap[h].cost_usd += (item.cost_usd || 0);
    hourlyMap[h].tokens_total += (item.tokens?.total || 0);

    if (item.reason && !hourlyMap[h].reasons.includes(item.reason)) {
      hourlyMap[h].reasons.push(item.reason);
    }

    totalCostINR += (item.cost_inr || 0);
    totalCostUSD += (item.cost_usd || 0);
    totalTokens += (item.tokens?.total || 0);
    totalOutputTokens += (item.tokens?.output || 0);
  });

  const hourlyBreakdown = Object.values(hourlyMap).map(h => ({
    ...h,
    cost_inr: Number(h.cost_inr.toFixed(4)),
    cost_usd: Number(h.cost_usd.toFixed(6))
  }));

  // Sort hourly chronologically
  hourlyBreakdown.sort((a, b) => a.hour.localeCompare(b.hour));

  return {
    date: queryDate,
    total_requests: items.length,
    total_cost_inr: Number(totalCostINR.toFixed(4)),
    total_cost_usd: Number(totalCostUSD.toFixed(6)),
    total_tokens: totalTokens,
    total_output_tokens: totalOutputTokens,
    hourly_breakdown: hourlyBreakdown,
    recent_calls: items.slice(-20).reverse()
  };
}

module.exports = {
  calculateCost,
  recordSpend,
  getSpendReport,
  LEDGER_FILE_PATH
};
