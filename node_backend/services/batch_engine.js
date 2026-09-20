const fs = require('fs');
const path = require('path');
const supabase = require('../config/supabase');
const qcEngine = require('./qc_engine');

/**
 * Sweeps for all pending T1 calls, aggregates them into a JSONL manifest, 
 * and initiates a Gemini Batch API job. (Placeholder logic for actual Google AI SDK)
 */
async function initiateNightlyBatch() {
  console.log('📦 [Batch Engine] Sweeping for pending T1 calls...');
  
  const { data: pendingRuns, error } = await supabase
    .from('evaluation_runs')
    .select('id, input_snapshot')
    .eq('status', 'pending')
    .eq('evaluation_tier', 'T1_Batch');

  if (error || !pendingRuns || pendingRuns.length === 0) {
    console.log('📦 [Batch Engine] No pending calls found.');
    return;
  }

  console.log(`📦 [Batch Engine] Found ${pendingRuns.length} pending calls. Generating JSONL...`);
  
  // 1. Create a DB record for the batch
  const { data: batchRecord } = await supabase
    .from('gemini_batches')
    .insert({
      batch_name: `Nightly_Batch_${new Date().toISOString()}`,
      status: 'pending_upload',
      total_requests: pendingRuns.length
    })
    .select('id')
    .single();

  const batchId = batchRecord.id;

  // 2. Generate JSONL file
  const jsonlLines = pendingRuns.map((run, index) => {
    // In a real implementation, you would construct the exact payload Gemini expects:
    // {"request": {"contents": [{"parts": [{"text": run.input_snapshot.transcript}]}]}}
    return JSON.stringify({
      custom_id: run.id,
      request: { transcript_length: run.input_snapshot.transcript_length }
    });
  });

  const tempFilePath = path.join(__dirname, '..', '..', 'storage', `batch_${batchId}.jsonl`);
  fs.writeFileSync(tempFilePath, jsonlLines.join('\n'));

  // 3. Mark the evaluation_runs as attached to this batch
  const runIds = pendingRuns.map(r => r.id);
  await supabase
    .from('evaluation_runs')
    .update({ batch_id: batchId, status: 'processing' })
    .in('id', runIds);

  console.log(`📦 [Batch Engine] Created batch ${batchId}. In production, this would now upload to Google Cloud Storage.`);
  
  // Simulate successful upload
  await supabase
    .from('gemini_batches')
    .update({ status: 'processing' })
    .eq('id', batchId);
}

module.exports = { initiateNightlyBatch };
