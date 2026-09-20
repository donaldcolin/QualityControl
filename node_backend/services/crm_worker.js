const supabase = require('../config/supabase');
const axios = require('axios');
require('dotenv').config();

// LSQ Configuration
const LSQ_HOST = process.env.LSQ_HOST || 'api.leadsquared.com';
const LSQ_ACCESS_KEY = process.env.LSQ_ACCESS_KEY;
const LSQ_SECRET_KEY = process.env.LSQ_SECRET_KEY;
const MAX_RETRIES = 5;

/**
 * Sweeps the crm_outbox table for pending or failed records and pushes them to LSQ.
 * Uses a basic backoff strategy.
 */
async function processCrmOutbox() {
  console.log('🔄 [CRM Worker] Checking outbox for pending messages...');

  // 1. Fetch pending records that are due for retry
  const { data: outboxItems, error: fetchError } = await supabase
    .from('crm_outbox')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', new Date().toISOString())
    .lt('retry_count', MAX_RETRIES)
    .limit(10); // Process in batches of 10

  if (fetchError) {
    console.error('❌ [CRM Worker] Error fetching outbox:', fetchError.message);
    return;
  }

  if (!outboxItems || outboxItems.length === 0) {
    return;
  }

  console.log(`📦 [CRM Worker] Found ${outboxItems.length} messages to process.`);

  // 2. Process each item
  for (const item of outboxItems) {
    // Lock the item to prevent concurrent processing if running multiple workers
    await supabase.from('crm_outbox').update({ status: 'processing' }).eq('id', item.id);

    try {
      const url = `https://${LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${LSQ_ACCESS_KEY}&secretKey=${LSQ_SECRET_KEY}`;
      
      const response = await axios.post(url, item.payload, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (response.data && response.data.Status === 'Success') {
        console.log(`✅ [CRM Worker] Pushed ${item.prospect_id} to LSQ successfully.`);
        await supabase.from('crm_outbox').update({
          status: 'success',
          processed_at: new Date().toISOString()
        }).eq('id', item.id);
      } else {
        throw new Error(JSON.stringify(response.data));
      }
    } catch (err) {
      console.error(`⚠️ [CRM Worker] Failed to push ${item.prospect_id} to LSQ:`, err.message);
      
      // Calculate backoff (1m, 5m, 15m, 30m, 1h)
      const backoffMinutes = [1, 5, 15, 30, 60][item.retry_count] || 60;
      const nextRetry = new Date(Date.now() + backoffMinutes * 60000).toISOString();
      
      await supabase.from('crm_outbox').update({
        status: 'failed',
        retry_count: item.retry_count + 1,
        last_error: err.message,
        next_retry_at: nextRetry
      }).eq('id', item.id);
    }
  }
}

// Start the worker immediately if run directly
if (require.main === module) {
  // Run every 1 minute
  setInterval(processCrmOutbox, 60000);
  processCrmOutbox();
}

module.exports = { processCrmOutbox };
