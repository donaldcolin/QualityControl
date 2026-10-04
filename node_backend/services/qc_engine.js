const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const supabase = require('../config/supabase');

// ── Active model — change here to switch globally ─────────────────────────────
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// ── In-memory static prompt cache: keyed by source+paramHash ─────────────────
// Avoids rebuilding the large QC parameter block on every single call.
// Automatically invalidated when parameters change (new hash = new key).
const _staticPromptCache = new Map();

const geminiApiKey = process.env.GEMINI_API_KEY || '';
let ai = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({ apiKey: geminiApiKey });
} else {
  console.warn("WARNING: Gemini API Key is missing. AI operations will fail.");
}

const configDir = path.join(__dirname, '..', 'config');

// Load Hybrid Knowledge Base (AY2026 Historical Data)
let knowledgeBase = null;
try {
  const kbData = fs.readFileSync(path.join(configDir, 'knowledge_base.json'), 'utf8');
  knowledgeBase = JSON.parse(kbData);
  console.log(`Loaded Hybrid Knowledge Base with ${knowledgeBase.total_leads_analyzed} historical leads.`);
} catch (err) {
  console.warn("WARNING: knowledge_base.json not found or invalid in config/. Lead Intelligence will lack historical grounding.");
}

// Load BD Coaching Playbook (Real trainer knowledge — replaces AI-generated templates)
let bdPlaybook = '';
try {
  bdPlaybook = fs.readFileSync(path.join(configDir, 'bd_playbook.txt'), 'utf8');
  console.log(`Loaded BD Playbook (${bdPlaybook.length} chars) — Kalvium-specific coaching active.`);
} catch (err) {
  console.warn("WARNING: bd_playbook.txt not found in config/. AI coaching will be generic.");
}

// ═══════════════════════════════════════════════════════════════
//  Gemini Schema Key Sanitizer
//  Gemini structured output requires property names to be valid
//  identifiers: ^[a-zA-Z_][a-zA-Z0-9_]*$
// ═══════════════════════════════════════════════════════════════
function sanitizeKey(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')    // Replace non-alphanumeric with _
    .replace(/^_+|_+$/g, '')         // Trim leading/trailing underscores
    .replace(/_+/g, '_')             // Collapse consecutive underscores
    || 'param';                      // Fallback
}

// ═══════════════════════════════════════════════════════════════
//  Global Context Definition
// ═══════════════════════════════════════════════════════════════
function getKalviumContext(source, leadState = null) {
  const base = source === 'google_meet'
    ? 'a product demonstration meeting via Google Meet'
    : 'a university admissions sales counselling phone call';

  let ctx = `${base} for Kalvium. 
Kalvium is a higher-education startup offering a Work-Integrated Computer Science Engineering degree. Key features include hands-on practical learning, structured internships, and an aptitude-based entrance exam called K-NET (we do not require JEE/NEET).

CRITICAL SALES CYCLE RULES (AY 2027):
1. FIRST PHONE CALL: The goal is NEVER to ask for registration or payment. The ONLY goal is to build interest and invite the student and at least one parent to attend a 1-on-1 Google Meet demo.
2. GOOGLE MEET DEMO: During the video call, the counselor discusses the exam details and pushes for K-NET Exam Registration.
3. EXAM: The student writes the K-NET exam after 2 months.
4. INTERVIEW: If they pass the exam, they attend an interview (they only get ONE chance).
5. PROVISIONAL ADMISSION: If they pass the interview, they pay 10% of the total university fees to secure provisional admission.

You must judge the associate based on where they are in this cycle.`;

  if (source !== 'google_meet') {
    ctx += `\n\nEXPECTED CALL STRUCTURE (1:1 COUNSELLING BOOKING CALL - 10 STAGES):
1. Warm Opening: Establish context, ask about 12th Std stream, and check if they know Kalvium.
2. Probing and Aligning: Understand their current college search status, post-12th plans, and learning style (practical vs theory).
3. Understand Student + Parent Priorities: Go past generic priorities and surface internal conflicts.
4. Introduce Kalvium Based on Answers: Create curiosity about the gap in the current education market before introducing Kalvium.
5. Why connect early?: Frame KNET as a parallel pathway and timing advantage.
6. Create Need for 1:1 Counselling: De-sell it; explain it's not a webinar and it's to gather info.
7. University Structure (If asked): Student does NOT choose a university now, only a preferred state/location.
8. Book the Counselling: Secure the decision-maker (at least one parent). Use the "information decay" argument. Offer TWO specific slots.
9. Close: Lock commitment, send WhatsApp, set up logistics.
10. Registration Assist (post-session if applicable): Navigating portals and anti-fraud warnings.
Evaluate the associate's adherence to this 10-stage flow.`;
  }

  if (leadState) {
    ctx += `\n\nCURRENT LEAD STATUS & HISTORY:`;
    if (leadState.kalvium_funnel_stage) ctx += `\n- Funnel Stage: ${leadState.kalvium_funnel_stage}`;
    if (leadState.next_process_step) ctx += `\n- Next Scheduled Activity: ${leadState.next_process_step}`;
    if (leadState.journey_summary) ctx += `\n- CRM Journey Summary (Past Calls): ${leadState.journey_summary}`;

    ctx += `\n\nIMPORTANT: The CRM "Lead Stage" might statically say "New Lead", so you MUST rely on the Funnel Stage, Next Activity, and Journey Summary above to determine where they actually are in the sales cycle. Do NOT penalize the associate for skipping introductory steps if the Journey Summary proves the customer already completed them!`;
  }

  return ctx;
}

// ═══════════════════════════════════════════════════════════════
//  Fetch dynamic configurations from DB
// ═══════════════════════════════════════════════════════════════

async function getQCParameters(source) {
  const { data, error } = await supabase
    .from('qc_parameters')
    .select('*')
    .eq('source', source);
  if (error) throw new Error("Failed to fetch QC parameters: " + error.message);
  return data.map(p => ({
    Parameter: p.parameter,
    Category: p.category,
    Description: p.description,
    ParamId: p.param_id,
    CategoryWeightPct: p.category_weight_pct,
    Scale: p.scale,
    Polarity: p.polarity,
    EmbeddedBreachFlag: p.embedded_breach_flag,
    EvidenceRequired: p.evidence_required
  }));
}

async function getQualityChecks(source) {
  const { data, error } = await supabase
    .from('qc_parameters')
    .select('*')
    .eq('source', source)
    .order('sort_order', { ascending: true });
  if (error) throw new Error("Failed to fetch quality checks: " + error.message);
  return data;
}

async function getDataCaptureQuestions(source) {
  const { data, error } = await supabase
    .from('data_capture_questions')
    .select('*')
    .eq('source', source)
    .order('sort_order', { ascending: true });
  if (error) throw new Error("Failed to fetch data capture questions: " + error.message);
  return data;
}

async function getPastCalls(prospectId, currentCallId) {
  if (!prospectId) return [];
  let query = supabase
    .from('calls')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('id', { ascending: true });

  if (currentCallId) {
    query = query.neq('id', currentCallId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("Failed to fetch past calls:", error.message);
    return [];
  }
  const calls = data || [];

  // Enrich calls with evaluation_runs data (insights_data, summary_data)
  // so the prompt builder has full prior analysis context
  if (calls.length > 0) {
    const callIds = calls.map(c => c.id);
    const { data: evals } = await supabase
      .from('evaluation_runs')
      .select('call_id, results')
      .in('call_id', callIds)
      .order('created_at', { ascending: false });

    if (evals) {
      const evalMap = {};
      evals.forEach(e => {
        if (!evalMap[e.call_id]) evalMap[e.call_id] = e; // latest only
      });
      calls.forEach(c => {
        const ev = evalMap[c.id];
        if (ev && ev.results) {
          c.insights_data = c.insights_data || ev.results.insights_data;
          c.summary_data = c.summary_data || ev.results.summary_data;
        }
      });
    }
  }

  return calls;
}


async function getLeadState(prospectId) {
  if (!prospectId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('journey_summary, intent_score, bant_insights, data_capture, kalvium_funnel_stage, next_process_step')
    .eq('id', prospectId)
    .single();
  if (error) return null;
  return data;
}

// ═══════════════════════════════════════════════════════════════
//  INSIGHTS Schema & Prompt (Summary + Insights tabs)
// ═══════════════════════════════════════════════════════════════

function getInsightsSchema(dataCaptureQuestions) {
  // (dataCaptureProps variable unused, removed)

  return {
    type: 'object',
    properties: {
      insights: {
        type: 'object',
        properties: {
          intent_score: { type: 'number', description: 'Buying intent score 0-100' },
          high_intent_factors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific positive signals showing high buying intent, with evidence from transcript'
          },
          low_intent_factors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific negative signals or hesitations showing low intent, with evidence'
          },
          objections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Category tag for the objection (e.g., "Exam Difficulty and Admission Barriers")' },
                objection: { type: 'string', description: 'What the customer said / their concern' },
                how_handled: { type: 'string', description: 'How the salesperson addressed this objection' },
                customer_satisfied: { type: 'boolean', description: 'Was the customer satisfied with the response?' }
              }
            },
            description: 'All objections raised by the customer during the call'
          },
          bant: {
            type: 'object',
            properties: {
              budget: { type: 'object', properties: { status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] }, details: { type: 'string' } } },
              authority: { type: 'object', properties: { status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] }, details: { type: 'string' } } },
              needs: { type: 'object', properties: { status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] }, details: { type: 'string' } } },
              timeline: { type: 'object', properties: { status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] }, details: { type: 'string' } } }
            },
            description: 'BANT analysis extracted from the conversation'
          },
          data_capture: {
            type: 'object',
            properties: {
              missing_mandatory_fields: { type: 'array', items: { type: 'string' }, description: 'List of expected fields that were NOT captured' },
              extracted_fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { type: 'string', description: 'The name of the field captured' },
                    value: { type: 'string', description: 'The value captured' },
                    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    timestamp: { type: 'string', description: 'The timestamp (e.g. 02:15) in the transcript when this information was discussed' }
                  }
                }
              }
            },
            description: `Answers to specific data capture questions. Expected fields and their questions:\n${dataCaptureQuestions.map(q => `- ${q.label}: ${q.question}`).join('\n')}`
          },
          conversation_topics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key topics discussed during the conversation (e.g., "K-NET Exam", "Program Curriculum")'
          }
        },
        required: ['intent_score', 'high_intent_factors', 'low_intent_factors', 'objections', 'bant', 'data_capture', 'conversation_topics']
      },
      summary: {
        type: 'object',
        properties: {
          call_summary: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet points summarizing the discussion'
          },
          key_points: {
            type: 'array',
            items: { type: 'string' },
            description: 'Critical facts extracted (e.g., student grade, chosen stream, interests)'
          },
          main_takeaways: {
            type: 'array',
            items: { type: 'string' },
            description: 'Conclusions and outcomes of the conversation'
          },
          journey_summary: {
            type: 'string',
            description: 'Updated rolling summary of the prospect journey across ALL calls including this one'
          }
        },
        required: ['call_summary', 'key_points', 'main_takeaways', 'journey_summary']
      },
      next_steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short action title' },
            description: { type: 'string', description: 'Detailed description of the action' },
            suggested_say: { type: 'string', description: 'Suggested script/dialogue for the agent to use' },
            due_by: { type: 'string', description: 'Suggested due date in ISO format (YYYY-MM-DD)' }
          }
        },
        description: 'Concrete next steps for the agent with suggested dialogue and due dates'
      }
    },
    required: ['insights', 'summary', 'next_steps']
  };
}

function buildInsightsPrompt(transcript, source, dataCaptureQuestions, pastCalls, leadState) {
  const role = source === 'google_meet' ? 'Expert Video Demo Analyst' : 'Expert Sales Call Analyst';
  const context = getKalviumContext(source, leadState);
  const callNumber = (pastCalls?.length || 0) + 1;

  let prompt = `You are an ${role}. You are analyzing ${context}.\n\n`;

  // ── Multi-call awareness header ──────────────────────────────────────
  if (callNumber > 1) {
    prompt += `⚠️ CRITICAL: This is CALL #${callNumber} for this prospect. You have ${pastCalls.length} previous call(s) below.\n`;
    prompt += `You MUST analyze this call IN CONTEXT of the full journey. A short follow-up call does NOT mean low intent — it may be a scheduling call or status check.\n`;
    prompt += `Your INTENT SCORE must reflect the CUMULATIVE journey, not just this single call.\n\n`;
  }

  // ── Inject rich past call context ────────────────────────────────────
  if (pastCalls && pastCalls.length > 0) {
    prompt += `=== PREVIOUS CALLS FOR THIS PROSPECT (${pastCalls.length} calls) ===\n`;
    pastCalls.forEach((pc, i) => {
      const summary = pc.summary_data ? (typeof pc.summary_data === 'string' ? JSON.parse(pc.summary_data) : pc.summary_data) : null;
      const insights = pc.insights_data ? (typeof pc.insights_data === 'string' ? JSON.parse(pc.insights_data) : pc.insights_data) : null;
      prompt += `--- Call ${i + 1} (${pc.source || 'phone_call'}, ${pc.duration_sec ? Math.round(pc.duration_sec / 60) + ' min' : 'unknown duration'}) ---\n`;
      if (summary && summary.call_summary) {
        prompt += `Summary: ${summary.call_summary.join(' | ')}\n`;
      }
      if (summary && summary.key_points) {
        prompt += `Key Points: ${summary.key_points.join(' | ')}\n`;
      }
      if (insights) {
        if (insights.intent_score != null) prompt += `Intent Score: ${insights.intent_score}/100\n`;
        if (insights.objections && insights.objections.length > 0) {
          prompt += `Objections Raised: ${insights.objections.map(o => `${o.category}: "${o.objection}" (${o.customer_satisfied ? 'resolved' : 'unresolved'})`).join('; ')}\n`;
        }
      }
      if (pc.call_quality_score != null) {
        prompt += `Call Quality: ${pc.call_quality_score}/100\n`;
      }
      prompt += '\n';
    });
  }

  // ── Inject existing lead state (accumulated data from all prior calls) ──
  if (leadState) {
    if (leadState.journey_summary) {
      prompt += `=== PREVIOUS JOURNEY SUMMARY (accumulated across all prior calls) ===\n${leadState.journey_summary}\n\n`;
    }
    if (leadState.intent_score != null) {
      prompt += `=== CURRENT LEAD INTENT SCORE: ${leadState.intent_score}/100 ===\n\n`;
    }
    if (leadState.bant_insights) {
      prompt += `=== CURRENT BANT STATUS ===\n`;
      for (const [dim, val] of Object.entries(leadState.bant_insights)) {
        if (val) prompt += `- ${dim}: ${val.status} — ${val.details}\n`;
      }
      prompt += '\n';
    }
    if (leadState.data_capture) {
      const captured = leadState.data_capture.extracted_fields || [];
      const missing = leadState.data_capture.missing_mandatory_fields || [];
      if (captured.length > 0) {
        prompt += `=== ALREADY CAPTURED DATA (from prior calls — do NOT mark these as missing) ===\n`;
        captured.forEach(f => { prompt += `- ${f.field}: ${f.value} (${f.confidence} confidence)\n`; });
        prompt += '\n';
      }
      if (missing.length > 0) {
        prompt += `=== STILL MISSING DATA FIELDS: ${missing.join(', ')} ===\n\n`;
      }
    }
  }

  prompt += `=== CURRENT CALL TRANSCRIPT (Call #${callNumber}) ===\n${transcript}\n\n`;

  prompt += `=== YOUR TASKS ===\n`;
  prompt += `1. Calculate an INTENT SCORE (0-100) based on the customer's buying signals ACROSS THE ENTIRE JOURNEY (all calls including this one).\n`;
  if (callNumber > 1) {
    prompt += `   IMPORTANT: Consider the trajectory. If previous calls showed high intent (e.g. ${leadState?.intent_score || 'N/A'}/100) and this call is just a short scheduling/follow-up call, the intent should remain similar or slightly adjusted — NOT drop to near zero.\n`;
    prompt += `   Conversely, if the customer explicitly says they're not interested anymore, intent SHOULD drop significantly.\n`;
  }
  prompt += `2. List specific HIGH INTENT FACTORS — things the customer said/did that show genuine interest (include factors from THIS call only).\n`;
  prompt += `3. List specific LOW INTENT FACTORS — hesitations, concerns, red flags (from THIS call only).\n`;
  prompt += `4. Identify all OBJECTIONS raised by the customer IN THIS CALL. For each objection:\n`;
  prompt += `   - Categorize it (e.g., "Exam Difficulty", "Parental Consent", "Alternative Career")\n`;
  prompt += `   - Describe what the customer said\n`;
  prompt += `   - Describe how the salesperson handled it\n`;
  prompt += `   - Note if the customer was satisfied with the response\n`;
  prompt += `5. Extract BANT (Budget, Authority, Needs, Timeline) — update based on any NEW information from this call. If nothing new was discussed for a dimension, return the same status as before.\n`;
  prompt += `6. Answer the following DATA CAPTURE QUESTIONS (only extract NEW information from THIS call — already captured data is listed above):\n`;
  dataCaptureQuestions.forEach(q => {
    prompt += `   - ${q.label}: ${q.question}\n`;
  });
  prompt += `7. Identify the main CONVERSATION TOPICS discussed IN THIS CALL.\n`;
  prompt += `8. Write a comprehensive CALL SUMMARY with key points and main takeaways FOR THIS CALL.\n`;
  if (callNumber === 1) {
    prompt += `9. Write a JOURNEY SUMMARY summarizing this conversation. Treat this as the very first interaction with the prospect. Focus only on what happened in this transcript.\n`;
  } else {
    prompt += `9. Write an updated JOURNEY SUMMARY that incorporates insights from ALL ${callNumber} calls. This must be a complete, rolling narrative covering the entire prospect journey from the first call to now. Include: what was discussed, what was promised, what objections were raised and how they were handled, what commitments were made (e.g., "ES said he will join the meeting"), and whether those commitments were kept.\n`;
  }
  prompt += `10. Suggest concrete NEXT STEPS with suggested dialogue and due dates.\n\n`;

  prompt += `Be specific and cite evidence from the transcript wherever possible.\n`;
  prompt += `CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.\n`;

  return prompt;
}


// ═══════════════════════════════════════════════════════════════
//  QUALITY Schema & Prompt (Quality tab)
// ═══════════════════════════════════════════════════════════════

function getQualitySchema(qualityChecks) {
  const paramProperties = {};
  qualityChecks.forEach(check => {
    paramProperties[sanitizeKey(check.parameter)] = {
      type: 'object',
      properties: {
        score: { type: 'number', description: `Score awarded (0 to ${check.max_score || 10})` },
        max_score: { type: 'number', description: `Maximum possible score: ${check.max_score || 10}` },
        status: { type: 'string', enum: ['Done', 'Partially Done', 'Needs Improvement', 'Not Applicable'], description: 'Evaluation status' },
        reason: { type: 'string', description: 'Detailed justification based on the transcript' }
      }
    };
  });

  return {
    type: 'object',
    properties: {
      quality: {
        type: 'object',
        properties: paramProperties,
        description: 'Quality evaluation for each parameter'
      }
    },
    required: ['quality']
  };
}

function buildQualityPrompt(transcript, source, qualityChecks) {
  const role = source === 'google_meet' ? 'Expert Video Demo Quality Auditor' : 'Expert Call Quality Auditor';
  const context = getKalviumContext(source);

  let prompt = `You are an ${role}. You are evaluating the quality of ${context}.\n\n`;
  prompt += `=== TRANSCRIPT ===\n${transcript}\n\n`;

  prompt += `=== QUALITY PARAMETERS TO EVALUATE ===\n`;
  prompt += `For each parameter, assign a score (0 to max_score), a status, and a detailed reason.\n`;
  prompt += `Statuses: Done (full marks), Partially Done (partial marks), Needs Improvement (low marks), Not Applicable.\n\n`;
  prompt += `CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.\n\n`;

  // Group by category for clarity
  const groups = {};
  qualityChecks.forEach(check => {
    const group = check.category || 'Other';
    if (!groups[group]) groups[group] = [];
    groups[group].push(check);
  });

  for (const [group, checks] of Object.entries(groups)) {
    prompt += `== ${group} ==\n`;
    checks.forEach(check => {
      prompt += `- ${check.parameter} (Max Score: ${check.max_score || 10})\n`;
      if (check.check_question) {
        prompt += `  Question: ${check.check_question}\n`;
      }
      prompt += `  Guidelines: ${check.description}\n`;
      if (check.na_condition) {
        prompt += `  Not Applicable When: ${check.na_condition}\n`;
      }
      prompt += `\n`;
    });
  }

  prompt += `Be fair but rigorous. Cite specific evidence from the transcript for each evaluation.\n`;

  return prompt;
}

// ═══════════════════════════════════════════════════════════════
//  MERGED: Combined Quality + Coaching (2 passes → 1 pass)
// ═══════════════════════════════════════════════════════════════

/**
 * Builds the STATIC portion of the combined quality+coaching prompt.
 * This part is identical across all calls for the same source+parameter set.
 * Result is cached in memory so it is built at most once per unique config.
 */
function _buildStaticQualityCoachingBlock(source, qualityChecks, parameters, leadState = null) {
  // Hash key = source + all check IDs + all param names + lead stage
  const stage = leadState?.ProspectStage || 'none';
  const cacheKey = `${source}|${stage}|${qualityChecks.map(q => q.id || q.parameter).join(',')}|${parameters.map(p => p.Parameter).join(',')}`;
  if (_staticPromptCache.has(cacheKey)) return _staticPromptCache.get(cacheKey);

  const role = source === 'google_meet'
    ? 'Expert Video Demo Quality Auditor & Coach'
    : 'Expert Sales Call Quality Auditor & Coach';
  const context = getKalviumContext(source, leadState);

  let block = `You are an ${role} evaluating ${context}.\n`;
  block += `You must complete TWO tasks in one response.\n\n`;

  // ── PART 1: Quality evaluation ──────────────────────────────────────────────
  block += `=== PART 1: QUALITY SCORING ===\n`;
  block += `For each parameter: assign a score (0 to max_score), a status, and a reason citing the transcript.\n`;
  block += `Statuses: Done (full marks), Partially Done (partial), Needs Improvement (low), Not Applicable.\n\n`;

  const qualityGroups = {};
  qualityChecks.forEach(check => {
    const group = check.category || 'Other';
    if (!qualityGroups[group]) qualityGroups[group] = [];
    qualityGroups[group].push(check);
  });
  for (const [group, checks] of Object.entries(qualityGroups)) {
    block += `== ${group} ==\n`;
    checks.forEach(check => {
      block += `- ${check.parameter} (Param ID: ${check.param_id || 'N/A'})\n`;
      block += `  Guide / Question: ${check.description}\n`;
      if (check.scale) block += `  Scale: ${check.scale}\n`;
      if (check.polarity) block += `  Polarity: ${check.polarity} ${check.polarity === 'guardrail_negative' ? '(CRITICAL: Check for breaches!)' : ''}\n`;
      if (check.evidence_required) block += `  Evidence Required (Your 'reason' field MUST follow this format): ${check.evidence_required}\n`;
      if (!check.scale) block += `  Max Score: ${check.max_score || 10}\n`;
      if (check.check_question) block += `  Q: ${check.check_question}\n`;
      if (check.na_condition) block += `  N/A when: ${check.na_condition}\n`;
    });
    block += '\n';
  }

  // ── PART 2: DEEP COACHING REPORT ──────────────────────────────────────
  block += `=== PART 2: DEEP COACHING REPORT ===\n`;
  block += `You are an elite BD Trainer coaching Kalvium counsellors on 1:1 Counselling Booking Calls.\n`;
  block += `You are NOT a checklist auditor. A basic TL can check if someone said hello. Your job is to find INVISIBLE mistakes only an experienced trainer would catch.\n`;
  block += `CRITICAL RULE: DO NOT waste your Golden Rewrites on basic corrections like missing greetings, failing to say sir/madam, or minor pleasantries. You MUST focus exclusively on niche, high-leverage corrections that explain WHY the call failed to convert (e.g., poor objection handling, skipping discovery, over-pitching, fake urgency, failing to secure the parent).\n\n`;

  // Inject the real BD playbook if available
  if (bdPlaybook) {
    block += `=== KALVIUM BD PLAYBOOK (use this as your coaching reference) ===\n`;
    block += bdPlaybook + '\n\n';
  }

  block += `=== COACHING PRIORITIES (most important first) ===\n`;
  block += `1. CALL FLOW VIOLATIONS: Did the associate follow the 10-stage call structure? Did they skip probing and jump straight to pitching?\n`;
  block += `2. OBJECTION MISHANDLING: When the prospect raised a concern, did the associate use the Aikido method from the playbook? Or did they make up facts, get defensive, or bulldoze past it?\n`;
  block += `3. RED LINE VIOLATIONS: Did the associate say anything from the RED LINES list (badmouthing competitors, promising 100% placement, guaranteeing salary, or naming specific partner universities this cycle)?\n`;
  block += `4. TONE & ENERGY: Did they sound like an admission counselor who cares, or a desperate salesman? Were they patient when explaining? Did they listen when the parent pushed back?\n`;
  block += `5. MISSED BUYING SIGNALS: Did the prospect show interest (asking about fees, campus, curriculum) and the associate failed to capitalize on it?\n`;
  block += `6. BOOKING FAILURE: Did the associate secure at least one parent for the 1:1 session? Did they offer two time slots? Did they confirm on WhatsApp?\n`;
  block += `7. OVER-PITCHING: Did the associate dump Kalvium's value proposition without first understanding the student's situation, priorities, and concerns?\n\n`;

  block += `=== CONTEXT-AWARE REWRITES INSTRUCTIONS ===\n`;
  block += `CRITICAL: You MUST generate EXACTLY 3 specific rewrites. LLMs often get lazy and only generate 1. You must find 5 distinct coaching moments from across the entire transcript.\n`;
  block += `For EACH of the 4 rewrites:\n`;
  block += `- Quote the EXACT words the associate said (in whatever language they used).\n`;
  block += `- Explain WHY it failed, referencing the specific playbook section they violated.\n`;
  block += `- Write a GOLDEN REWRITE using the Kalvium-specific response from the playbook. The rewrite must use real Kalvium facts and positioning, not generic sales advice.\n`;
  block += `- The golden rewrite should sound natural and human, like a real Kalvium top performer would say it.\n`;
  block += `IMPORTANT: Do NOT give generic coaching like "be more empathetic" or "build rapport". Every piece of feedback must reference specific Kalvium knowledge, call flow stages, objection responses, or red lines from the playbook.\n\n`;

  block += `Overall grade scale — A (90-100), B (75-89), C (60-74), D (40-59), F (0-39)\n\n`;

  const categories = groupByCategory(parameters);
  for (const [category, params] of Object.entries(categories)) {
    block += `== ${category} ==\n`;
    params.forEach(p => {
      block += `- ${p.Parameter}: ${p.Description}\n`;
    });
    block += '\n';
  }

  _staticPromptCache.set(cacheKey, block);
  return block;
}

/**
 * JSON schema for the combined quality + coaching single-pass response.
 */
function getCombinedQualityCoachingSchema(qualityChecks, parameters) {
  // ARRAY-BASED: Instead of 123 named properties (61KB schema that exceeds Gemini's limit),
  // we use a single array with a 'parameter' name field. Schema is ~1.2KB regardless of param count.
  return {
    type: 'object',
    properties: {
      quality: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            parameter: { type: 'string', description: 'Exact parameter name from the evaluation list' },
            score: { type: 'number', description: 'Score awarded based on the specific parameter scale' },
            max_score: { type: 'number', description: 'Maximum possible score for this parameter based on the scale' },
            status: { type: 'string', enum: ['Done', 'Partially Done', 'Needs Improvement', 'Not Applicable'] },
            coaching_status: { type: 'string', enum: ['Pass', 'Fail', 'Not Applicable'] },
            breach_flag: { type: 'boolean', description: 'True if a guardrail_negative parameter was explicitly violated' },
            reason: { type: 'string', description: 'MUST MATCH the Evidence Required format (e.g. Timestamp + Quote + Translation). Max 10 words if Pass/Done.' }
          },
          required: ['parameter', 'score', 'max_score', 'status', 'coaching_status', 'reason']
        },
        description: 'EXCEPTION REPORTING ONLY: ONLY output parameters that received LESS THAN max score, FAILED, or NEED IMPROVEMENT. Do NOT include perfectly executed parameters.'
      },
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number', description: 'Overall score 0-100' },
          overall_grade: { type: 'string', description: 'Letter grade A-F' },
          summary: { type: 'string', description: 'One paragraph executive summary' },
          category_scores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Category name' },
                score: { type: 'number', description: 'Score 0-100' },
                grade: { type: 'string', description: 'A, B, C, D, or F' },
                what_went_well: { type: 'string' },
                what_went_wrong: { type: 'string' },
                coach_tip: { type: 'string' }
              },
              required: ['category', 'score', 'grade', 'what_went_well', 'what_went_wrong', 'coach_tip']
            }
          },
          top_strengths: { type: 'array', items: { type: 'string' }, description: 'Top 3-5 specific things the associate did well, with evidence' },
          critical_improvements: { type: 'array', items: { type: 'string' }, description: 'Top 3-5 critical things to improve, with evidence' },
          advanced_coaching: {
            type: 'object',
            properties: {
              context_aware_rewrites: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string', description: 'The exact timestamp range when this occurred, e.g. "02:05 - 03:59"' },
                    what_they_said: { type: 'string', description: 'The exact phrase the associate used (in original language)' },
                    why_it_failed: { type: 'string', description: 'Why this phrase was ineffective, referencing the playbook' },
                    golden_rewrite: { type: 'string', description: 'A tailored rewrite using the Kalvium-specific response from the playbook' }
                  },
                  required: ['timestamp', 'what_they_said', 'why_it_failed', 'golden_rewrite']
                },
                description: 'Generate EXACTLY 5 specific rewrites. Finding only 1 is unacceptable. You MUST include the exact timestamp range from the transcript.'
              },
              conversational_dynamics: { type: 'string', description: 'Deep analysis of talk-to-listen ratio, pacing, monologuing, interrupting, and whether the associate created space for the prospect to speak' },
              tone_and_empathy: { type: 'string', description: 'Analysis of emotional intelligence — did the associate match the prospect energy? Did they sound defensive when challenged? Did they show genuine care or read from a script?' },
              missed_opportunities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Buying signals, emotional cues, or interest indicators the associate completely missed or talked over'
              },
              prospect_persona: { type: 'string', description: 'Identify the persona (e.g., The Analytical Parent, The Anxious First-Gen Parent, The Price-Sensitive Father) and how the associate should have adapted' },
              competitor_deflection: { type: 'string', description: 'If a competitor was mentioned, how well did they handle it? If not mentioned, was there a moment where proactively addressing competition would have helped?' },
              micro_agreements: { type: 'string', description: 'Did the associate use trial closes and check-ins throughout the call? If they monologued for 3+ minutes without checking understanding, call it out.' }
            },
            required: ['context_aware_rewrites', 'conversational_dynamics', 'tone_and_empathy', 'missed_opportunities', 'prospect_persona']
          }
        },
        required: ['overall_score', 'overall_grade', 'summary', 'category_scores', 'top_strengths', 'critical_improvements', 'advanced_coaching']
      }
    },
    required: ['quality', 'coaching_report']
  };
}

// ═══════════════════════════════════════════════════════════════
//  LEGACY: Coaching Schema & Prompt (kept for backward compat)
// ═══════════════════════════════════════════════════════════════

async function getParametersForSource(source) {
  const params = await getQCParameters(source);
  if (source === 'google_meet') {
    return {
      params,
      role: 'Expert Video Demo Coach',
      context: 'a product demonstration meeting conducted via Google Meet'
    };
  }
  return {
    params,
    role: 'Expert Counselling Coach',
    context: 'a sales counselling phone call for university admissions'
  };
}

function groupByCategory(parameters) {
  const groups = {};
  parameters.forEach(p => {
    const cat = p.Category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });
  return groups;
}

// ═══════════════════════════════════════════════════════════════
//  Intelligence Schema (Lead Prediction)
// ═══════════════════════════════════════════════════════════════

function getIntelligenceSchema() {
  return {
    type: 'object',
    properties: {
      stage_predictions: {
        type: 'object',
        properties: {
          will_attend_knet: { type: 'number', description: 'Probability (0-100) the lead will attend KNET exam' },
          will_pass_knet: { type: 'number', description: 'Probability (0-100) the lead will pass KNET' },
          will_book_interview: { type: 'number', description: 'Probability (0-100) the lead will book interview' },
          will_pass_interview: { type: 'number', description: 'Probability (0-100) the lead will pass interview' },
          will_complete_pac: { type: 'number', description: 'Probability (0-100) the lead will complete PAC' },
          will_pay_full_fee: { type: 'number', description: 'Probability (0-100) the lead will pay 1st year fee' }
        }
      },
      overall_prediction: {
        type: 'boolean',
        description: 'Overall prediction: true if >50% likely to pay full fee'
      },
      overall_reasoning: {
        type: 'string',
        description: 'Detailed reasoning citing BOTH statistical evidence from AY2026 data AND transcript/profile evidence. Mention specific conversion rates for their board, state, marks range, and any cross-correlations that apply.'
      },
      risk_factors: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of specific risk factors that lower conversion probability'
      },
      positive_signals: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of specific positive signals that increase conversion probability'
      }
    },
    required: ['stage_predictions', 'overall_prediction', 'overall_reasoning', 'risk_factors', 'positive_signals']
  };
}

// ═══════════════════════════════════════════════════════════════
//  CALL TRIAGE LOGIC
// ═══════════════════════════════════════════════════════════════

/**
 * Determines the evaluation tier (T0, T1, T2) based on basic call metrics.
 * @param {Object} callData - The call metadata (duration, segments, etc.)
 * @returns {Object} { tier: 'T0'|'T1'|'T2', reason: string, valid: boolean }
 */
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

/**
 * Combine insights and quality schemas into a single Omni-Schema
 */
function getOmniSchema(dataCaptureQuestions, qualityChecks, parameters) {
  const insightsSchema = getInsightsSchema(dataCaptureQuestions);
  const qualitySchema = getCombinedQualityCoachingSchema(qualityChecks, parameters);
  return {
    type: 'object',
    properties: {
      ...insightsSchema.properties,
      ...qualitySchema.properties
    },
    required: [
      ...(insightsSchema.required || []),
      'quality',
      'coaching_report'
    ]
  };
}

/**
 * Combine insights and quality prompts into a single Omni-Prompt
 */
function buildOmniPrompt(transcript, source, dataCaptureQuestions, pastCalls, leadState, qualityChecks, parameters) {
  // Build insights context without the transcript appended
  const insightsBase = buildInsightsPrompt("", source, dataCaptureQuestions, pastCalls, leadState);
  // Remove the empty transcript section from the end of insightsBase
  const cleanInsightsBase = insightsBase.replace(/=== CURRENT CALL TRANSCRIPT \(Call #[0-9]+\) ===\n\n\nExtract all required JSON fields carefully based on the transcript and the accumulated context\./, "");

  // Build quality context
  const qualityBlock = _buildStaticQualityCoachingBlock(source, qualityChecks, parameters, leadState);

  return `${cleanInsightsBase}
${qualityBlock}

=== FULL CALL TRANSCRIPT ===
${transcript}

IMPORTANT INSTRUCTIONS:
1. Extract all Insights (BANT, Intent, Next Steps, etc.).
2. Evaluate Quality (Exception Reporting only - only output parameters that missed points).
3. Generate the Deep Coaching Report.
Be specific. Cite evidence from the transcript for every score and coaching point.
CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.`;
}

module.exports = {
  ai,
  GEMINI_MODEL,
  knowledgeBase,
  // Core fetch functions
  getQualityChecks,
  getDataCaptureQuestions,
  getPastCalls,
  getLeadState,
  // OmniPrompt
  getOmniSchema,
  buildOmniPrompt,
  // Insights (Pass 1 — unchanged)
  getInsightsSchema,
  buildInsightsPrompt,
  // Merged Quality + Coaching Schema (used by Omni)
  getCombinedQualityCoachingSchema,
  // Legacy quality-only (kept for fallback)
  getQualitySchema,
  buildQualityPrompt,
  // Fetch params
  getParametersForSource,
  // Intelligence
  getIntelligenceSchema,
  triageCall,
  // Utilities
  sanitizeKey
};
