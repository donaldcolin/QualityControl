const supabase = require('../config/supabase');
const axios = require('axios');
const { lsqUrl } = require('../config/lsq');
require('dotenv').config();

const MAX_RETRIES = 5;

/**
 * Formats a raw payload object or array into the LeadSquared expected attribute list:
 * [ { "Attribute": "...", "Value": "..." } ]
 */
function formatLsqPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map(attr => ({
      Attribute: String(attr.Attribute || attr.attribute || attr.key || attr.Key),
      Value: typeof attr.Value === 'object' ? JSON.stringify(attr.Value) : String(attr.Value ?? attr.value ?? '')
    }));
  }

  if (typeof payload === 'object' && payload !== null) {
    const attributes = [];

    if (payload.coaching_report != null) {
      const coachingVal = typeof payload.coaching_report === 'object'
        ? JSON.stringify(payload.coaching_report)
        : String(payload.coaching_report);
      attributes.push({ Attribute: 'mx_QC_Coaching_Report', Value: coachingVal });
    }

    if (payload.source != null) {
      attributes.push({ Attribute: 'mx_QC_Source', Value: String(payload.source) });
    }

    if (payload.qc_score != null) {
      attributes.push({ Attribute: 'mx_QC_Score', Value: String(payload.qc_score) });
    }

    for (const [k, v] of Object.entries(payload)) {
      if (['prospect_id', 'leadId', 'coaching_report', 'source', 'qc_score'].includes(k)) continue;
      attributes.push({
        Attribute: k,
        Value: typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')
      });
    }

    return attributes;
  }

  return [];
}

/**
 * Sweeps the crm_outbox table for pending or failed records and pushes them to LSQ.
 * Uses an exponential/linear backoff strategy with proper payload formatting and leadId parameter.
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
      const leadId = item.prospect_id || item.payload?.prospect_id || item.payload?.leadId;
      if (!leadId) {
        throw new Error("Missing prospect_id for LeadSquared update");
      }

      const url = lsqUrl('LeadManagement.svc/Lead.Update') + `&leadId=${encodeURIComponent(leadId)}`;
      const formattedPayload = formatLsqPayload(item.payload);

      const response = await axios.post(url, formattedPayload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      if (response.data && response.data.Status === 'Success') {
        console.log(`✅ [CRM Worker] Pushed ${leadId} to LSQ successfully.`);
        await supabase.from('crm_outbox').update({
          status: 'success',
          processed_at: new Date().toISOString()
        }).eq('id', item.id);
      } else {
        throw new Error(JSON.stringify(response.data));
      }
    } catch (err) {
      console.error(`⚠️ [CRM Worker] Failed to push ${item.prospect_id} to LSQ:`, err.message);

      // Calculate backoff (1m, 5m, 15m, 30m, 60m)
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

module.exports = { processCrmOutbox, formatLsqPayload };
