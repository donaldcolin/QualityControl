const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');
const qcEngine = require('../services/qc_engine');
const { createObjectCsvWriter } = require('csv-writer');

const BATCH_SIZE = 200;

/**
 * Generates a validation CSV to compare old scores against the new Gemini-2.5-flash-002 engine.
 * Run this locally and send the CSV to the Senior Developer for sign-off.
 */
async function generateValidationSet() {
  console.log(`🧪 [Validation Gate] Sampling ${BATCH_SIZE} historical calls...`);

  // 1. Fetch random historical calls that have a transcript and an old score
  const { data: pastCalls, error } = await supabase
    .from('calls')
    .select('id, prospect_id, transcript, call_quality_score, provider_source')
    .not('transcript', 'is', null)
    .not('call_quality_score', 'is', null)
    .limit(BATCH_SIZE);

  if (error || !pastCalls || pastCalls.length === 0) {
    console.error('❌ Failed to fetch historical calls:', error);
    return;
  }

  console.log(`🧪 [Validation Gate] Fetched ${pastCalls.length} calls. Running v3 AI Engine...`);

  const results = [];

  // 2. Run them through the new engine
  for (let i = 0; i < pastCalls.length; i++) {
    const call = pastCalls[i];
    console.log(`   Progress: ${i+1}/${pastCalls.length} (Call: ${call.id})`);
    
    try {
      // Mock req/res for the engine functions
      const req = { body: { call_id: call.id, transcript: call.transcript, source: call.provider_source } };
      
      // Run the core quality evaluation
      const qualityResult = await qcEngine.runCallQuality(req, { status: () => ({ json: () => {} }) });
      
      results.push({
        call_id: call.id,
        prospect_id: call.prospect_id,
        source: call.provider_source,
        old_score: call.call_quality_score,
        new_score: qualityResult.call_quality_score || 'Error',
        score_diff: (qualityResult.call_quality_score || 0) - call.call_quality_score,
        v3_summary: qualityResult.summary_data?.call_summary?.[0] || '',
        transcript_snippet: call.transcript.substring(0, 100).replace(/\n/g, ' ') + '...'
      });
      
    } catch (err) {
      console.error(`⚠️ Failed to evaluate call ${call.id}:`, err.message);
    }
  }

  // 3. Output to CSV
  const csvPath = path.join(__dirname, '..', '..', 'storage', `validation_gate_v3.csv`);
  
  // Ensure storage dir exists
  if (!fs.existsSync(path.dirname(csvPath))) {
    fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  }

  const csvWriter = createObjectCsvWriter({
    path: csvPath,
    header: [
      { id: 'call_id', title: 'Call ID' },
      { id: 'prospect_id', title: 'Prospect ID' },
      { id: 'source', title: 'Source' },
      { id: 'old_score', title: 'Old Score (v2)' },
      { id: 'new_score', title: 'New Score (v3)' },
      { id: 'score_diff', title: 'Score Difference (v3 - v2)' },
      { id: 'v3_summary', title: 'v3 Summary Snippet' },
      { id: 'transcript_snippet', title: 'Transcript Snippet' }
    ]
  });

  await csvWriter.writeRecords(results);
  console.log(`✅ [Validation Gate] Success! CSV generated at: ${csvPath}`);
}

// Run immediately if called directly
if (require.main === module) {
  generateValidationSet();
}
