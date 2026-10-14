const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const spendTracker = require('../services/qc_engine/spend_tracker');

function runSpendReport() {
  const targetDate = process.argv[2] || new Date().toISOString().slice(0, 10);
  const report = spendTracker.getSpendReport(targetDate);

  console.log('\n========================================================================');
  console.log(`📊  GEMINI REAL-TIME SPEND & HOURLY AUDIT REPORT`);
  console.log(`📅  Date: ${report.date}`);
  console.log('========================================================================\n');

  console.log('📈 [SUMMARY METRICS]');
  console.log(`• Total Requests Made:   ${report.total_requests}`);
  console.log(`• Total Spend Today:     ₹${report.total_cost_inr.toFixed(2)} INR  ($${report.total_cost_usd.toFixed(4)} USD)`);
  console.log(`• Total Tokens Billed:   ${report.total_tokens.toLocaleString()}`);
  console.log(`• Total Output Tokens:   ${report.total_output_tokens.toLocaleString()}`);
  console.log('');

  console.log('⏱️  [HOURLY BREAKDOWN & REASONS]');
  console.log('------------------------------------------------------------------------');
  if (report.hourly_breakdown.length === 0) {
    console.log('  No API calls recorded yet for this date.');
  } else {
    report.hourly_breakdown.forEach(h => {
      const badge = h.cost_inr < 1 ? `${(h.cost_inr * 100).toFixed(1)}p` : `₹${h.cost_inr.toFixed(2)}`;
      console.log(`\n🕒 [${h.hour}]  Total: ${badge} INR (${h.count} request${h.count > 1 ? 's' : ''})`);
      console.log(`   Tokens: ${h.tokens_total.toLocaleString()} total tokens`);
      console.log('   Reasons:');
      h.reasons.forEach(r => console.log(`     - ${r}`));
    });
  }
  console.log('\n------------------------------------------------------------------------');

  if (report.recent_calls.length > 0) {
    console.log('\n📋 [RECENT 10 API CALLS]');
    console.log('------------------------------------------------------------------------');
    report.recent_calls.slice(0, 10).forEach((c, idx) => {
      const time = c.timestamp.slice(11, 19);
      const costBadge = c.cost_inr < 1 ? `${(c.cost_inr * 100).toFixed(1)}p` : `₹${c.cost_inr.toFixed(2)}`;
      console.log(
        `#${idx + 1} [${time}] ${costBadge.padEnd(8)} | ${c.tokens.cached.toLocaleString()} cached / ${c.tokens.output.toLocaleString()} out | ${c.reason}`
      );
    });
    console.log('------------------------------------------------------------------------\n');
  }

  console.log(`💡 Ledger File Location: ${spendTracker.LEDGER_FILE_PATH}\n`);
}

runSpendReport();
