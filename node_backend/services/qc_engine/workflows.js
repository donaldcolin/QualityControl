const supabase = require('../../config/supabase');
const { GEMINI_MODEL, ai } = require('./index');
const { safeParseGeminiJSON } = require('./safe_parse');
const { callGeminiWithRetry } = require('./call_gemini');

function triageCall(callData) {
  const { duration_sec, talk_to_listen_ratio, segments } = callData;

  // T0: Automatically fail calls that are clearly not genuine conversations
  if (duration_sec < 30) {
    return { tier: 'T0', valid: false, reason: 'Call duration under 30 seconds.' };
  }

  if (talk_to_listen_ratio) {
    const [agentPct, customerPct] = talk_to_listen_ratio.split(':').map(Number);
    if (customerPct === 0) {
      return { tier: 'T0', valid: false, reason: 'Talk-to-listen ratio is 100:0 (Monologue).' };
    }
  }

  // Check for high-risk keywords in the transcript to bump to T2 (Real-time)
  const highRiskKeywords = ['guarantee', '100% placement', 'police', 'scam', 'refund', 'court'];
  if (segments && segments.length > 0) {
    let parsedSegments = segments;
    if (typeof segments === 'string') {
      try {
        parsedSegments = JSON.parse(segments);
      } catch (e) {
        parsedSegments = [];
      }
    }
    const transcriptText = Array.isArray(parsedSegments) ? parsedSegments.map(s => s.text || s.text_en || '').join(' ').toLowerCase() : '';
    const hasRisk = highRiskKeywords.some(kw => transcriptText.includes(kw));
    if (hasRisk) {
      return { tier: 'T2', valid: true, reason: 'High-risk keyword detected (Compliance Review Required).' };
    }
  }

  // Default to T2 (Real-time Evaluation) since the user wants instant results
  return { tier: 'T2', valid: true, reason: 'Standard call profile (Instant Processing Enabled).' };
}

async function evaluateLeadJourney(leadId) {
  if (!ai) return;

  // 1. Fetch the lead
  const { data: lead, error: leadError } = await supabase
    .from('leads')
    .select('id, name, journey_insights, journey_coaching')
    .eq('id', leadId)
    .single();

  if (leadError || !lead) {
    console.error(`Journey Sync failed: Lead ${leadId} not found`);
    return;
  }

  // 2. Fetch the newly evaluated calls (ordered by date)
  const { data: calls } = await supabase
    .from('calls')
    .select('id, created_at, source, duration_sec, transcript, summary_data, insights_data, filename, qc_status')
    .eq('prospect_id', leadId)
    .in('qc_status', ['evaluated', 'completed', 'fatal_audit_failure'])
    .order('created_at', { ascending: true });

  if (!calls || calls.length === 0) return;

  // 3. Construct prompt with bounded context window (prevents token explosion on long funnels)
  const MAX_JOURNEY_CALLS = 5;
  const recentCalls = calls.length > MAX_JOURNEY_CALLS ? calls.slice(-MAX_JOURNEY_CALLS) : calls;
  const lastIndex = recentCalls.length - 1;

  let transcriptHistory = recentCalls.map((c, idx) => {
    const isLatestCall = idx === lastIndex;
    let contentBlock = '';

    if (isLatestCall) {
      // Latest call gets full transcript for rich grounding
      contentBlock = `Full Transcript:\n${c.transcript || 'No transcript available'}`;
    } else {
      // Prior calls are compressed to structured summaries (saving up to 90% tokens)
      const summaryList = Array.isArray(c.summary_data?.call_summary) 
        ? c.summary_data.call_summary.join('; ')
        : (typeof c.summary_data === 'string' ? c.summary_data : 'Call completed');
      const keyPoints = Array.isArray(c.summary_data?.key_points)
        ? c.summary_data.key_points.join('; ')
        : '';
      contentBlock = `Prior Call Summary: ${summaryList}\nKey Takeaways: ${keyPoints || 'N/A'}`;
    }

    return `
--- Touchpoint ${calls.length - recentCalls.length + idx + 1} (${c.source || 'telephony'}) ---
Date: ${c.created_at}
Duration: ${Math.round((c.duration_sec || 0)/60)} mins
${contentBlock}
`;
  }).join('\n\n');

  const journeySchema = {
    type: 'object',
    properties: {
      journey_insights: {
        type: 'object',
        description: 'Overarching summary of BANT, intent progression, and objections across all touchpoints.',
        properties: {
          intent_progression: { type: 'string', description: 'Narrative of how the prospect intent evolved from Touchpoint 1 to the latest touchpoint.' },
          objections_status: { type: 'string', description: 'Which objections were raised, and which ones were successfully resolved or remain open.' },
          overall_bant_summary: { type: 'string', description: 'Holistic summary of their Budget, Authority, Needs, and Timeline.' }
        }
      },
      journey_coaching: {
        type: 'object',
        description: 'High-level coaching feedback tracking associate progress from the first call to the final demo.',
        properties: {
          improvements_noted: { type: 'string', description: 'Positive feedback on how the associate improved or adapted across the calls.' },
          recurring_mistakes: { type: 'string', description: 'Critical feedback on mistakes repeated across multiple touchpoints.' },
          next_touchpoint_strategy: { type: 'string', description: 'Strategic advice for the NEXT time the associate speaks with this lead.' }
        }
      }
    },
    required: ['journey_insights', 'journey_coaching']
  };

  const prompt = `You are a Senior Sales Director doing a holistic "Journey Review" for a lead.
Do NOT just evaluate a single call. Look at the entire sequence of touchpoints below.
Your job is to provide a rolling, additive narrative of the lead's progression and the associate's coaching needs over time.

Previous Journey State (if any):
${JSON.stringify(lead.journey_insights || {})}
${JSON.stringify(lead.journey_coaching || {})}

ALL TOUCHPOINTS FOR THIS LEAD:
${transcriptHistory}

Generate the updated journey insights and journey coaching.
Focus specifically on CROSS-CALL continuity (e.g., "The pricing objection from Call 1 was resolved in Call 2").`;

  try {
    const response = await callGeminiWithRetry(ai, {
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: journeySchema,
        temperature: 0.2
      }
    });
  
    const result = safeParseGeminiJSON(response.text);
    
    // 4. Update the lead with the synthesized JSONB
    await supabase.from('leads').update({
      journey_insights: result.journey_insights,
      journey_coaching: result.journey_coaching,
      updated_at: new Date().toISOString()
    }).eq('id', leadId);

    console.log(`✅ Successfully generated holistic Journey Synthesis for Lead ${leadId}`);
  } catch (e) {
    console.error(`❌ Journey Synthesis failed for Lead ${leadId}:`, e.message);
  }
}

module.exports = {
  triageCall,
  evaluateLeadJourney,
};
