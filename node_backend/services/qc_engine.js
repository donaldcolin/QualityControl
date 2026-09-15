const fs = require('fs');
const axios = require('axios');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');
const supabase = require('../config/supabase');

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
    Description: p.description
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

async function getPastCalls(prospectId) {
  if (!prospectId) return [];
  const { data, error } = await supabase
    .from('calls')
    .select('filename, language, duration_sec, segments, summary_data, insights_data, quality_data, call_quality_score, source, created_at')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error("Failed to fetch past calls:", error.message);
    return [];
  }
  return data || [];
}

async function getLeadState(prospectId) {
  if (!prospectId) return null;
  const { data, error } = await supabase
    .from('leads')
    .select('journey_summary, intent_score, bant_insights, data_capture')
    .eq('id', prospectId)
    .single();
  if (error) return null;
  return data;
}

// ═══════════════════════════════════════════════════════════════
//  INSIGHTS Schema & Prompt (Summary + Insights tabs)
// ═══════════════════════════════════════════════════════════════

function getInsightsSchema(dataCaptureQuestions) {
  // Build dynamic data_capture properties from the questions
  const dataCaptureProps = {};
  dataCaptureQuestions.forEach(q => {
    dataCaptureProps[q.label] = {
      type: 'object',
      properties: {
        answer: { type: 'string', description: `Answer to: ${q.question}` },
        evidence: { type: 'string', description: 'Evidence from the transcript supporting this answer' }
      }
    };
  });

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
              budget: { type: 'string', description: 'What was discussed about budget/financial constraints' },
              authority: { type: 'string', description: 'Who is the decision maker and their role' },
              needs: { type: 'string', description: 'What are the customer/student needs and requirements' },
              timeline: { type: 'string', description: 'What is the timeline for making a decision' }
            },
            description: 'BANT analysis extracted from the conversation'
          },
          data_capture: {
            type: 'object',
            properties: dataCaptureProps,
            description: 'Answers to specific data capture questions'
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
  const context = source === 'google_meet'
    ? 'a product demonstration meeting conducted via Google Meet'
    : 'a sales counselling phone call for university admissions';

  let prompt = `You are an ${role}. You are analyzing ${context}.\n\n`;

  // Inject past call context if available
  if (pastCalls && pastCalls.length > 0) {
    prompt += `=== PREVIOUS CALLS FOR THIS PROSPECT (${pastCalls.length} calls) ===\n`;
    pastCalls.forEach((pc, i) => {
      const summary = pc.summary_data ? (typeof pc.summary_data === 'string' ? JSON.parse(pc.summary_data) : pc.summary_data) : null;
      prompt += `--- Call ${i + 1} (${pc.source || 'phone_call'}, ${pc.created_at}) ---\n`;
      if (summary && summary.call_summary) {
        prompt += summary.call_summary.join('\n') + '\n';
      }
      prompt += '\n';
    });
  }

  if (leadState && leadState.journey_summary) {
    prompt += `=== PREVIOUS JOURNEY SUMMARY ===\n${leadState.journey_summary}\n\n`;
  }

  prompt += `=== CURRENT CALL TRANSCRIPT ===\n${transcript}\n\n`;

  prompt += `=== YOUR TASKS ===\n`;
  prompt += `1. Calculate an INTENT SCORE (0-100) based on the customer's buying signals.\n`;
  prompt += `2. List specific HIGH INTENT FACTORS — things the customer said/did that show genuine interest.\n`;
  prompt += `3. List specific LOW INTENT FACTORS — hesitations, concerns, red flags.\n`;
  prompt += `4. Identify all OBJECTIONS raised by the customer. For each objection:\n`;
  prompt += `   - Categorize it (e.g., "Exam Difficulty", "Parental Consent", "Alternative Career")\n`;
  prompt += `   - Describe what the customer said\n`;
  prompt += `   - Describe how the salesperson handled it\n`;
  prompt += `   - Note if the customer was satisfied with the response\n`;
  prompt += `5. Extract BANT (Budget, Authority, Needs, Timeline) from the conversation.\n`;
  prompt += `6. Answer the following DATA CAPTURE QUESTIONS:\n`;
  dataCaptureQuestions.forEach(q => {
    prompt += `   - ${q.label}: ${q.question}\n`;
  });
  prompt += `7. Identify the main CONVERSATION TOPICS discussed.\n`;
  prompt += `8. Write a comprehensive CALL SUMMARY with key points and main takeaways.\n`;
  prompt += `9. Update the JOURNEY SUMMARY to include insights from all previous calls plus this one.\n`;
  prompt += `10. Suggest concrete NEXT STEPS with suggested dialogue and due dates.\n\n`;

  prompt += `Be specific and cite evidence from the transcript wherever possible.\n`;

  return prompt;
}

// ═══════════════════════════════════════════════════════════════
//  QUALITY Schema & Prompt (Quality tab)
// ═══════════════════════════════════════════════════════════════

function getQualitySchema(qualityChecks) {
  const paramProperties = {};
  qualityChecks.forEach(check => {
    paramProperties[check.parameter] = {
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
  const context = source === 'google_meet'
    ? 'a product demonstration meeting conducted via Google Meet'
    : 'a sales counselling phone call for university admissions';

  let prompt = `You are an ${role}. You are evaluating the quality of ${context}.\n\n`;
  prompt += `=== TRANSCRIPT ===\n${transcript}\n\n`;

  prompt += `=== QUALITY PARAMETERS TO EVALUATE ===\n`;
  prompt += `For each parameter, assign a score (0 to max_score), a status, and a detailed reason.\n`;
  prompt += `Statuses: Done (full marks), Partially Done (partial marks), Needs Improvement (low marks), Not Applicable.\n\n`;

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

function getCoachingSchema(parameters) {
  const categories = groupByCategory(parameters);
  const categoryNames = Object.keys(categories);

  const categoryScoreProps = {};
  categoryNames.forEach(cat => {
    categoryScoreProps[cat] = {
      type: 'object',
      properties: {
        score: { type: 'number', description: `Score 0-100 for ${cat}` },
        grade: { type: 'string', description: 'Letter grade: A, B, C, D, or F' },
        what_went_well: { type: 'string', description: `What the associate did well in the ${cat} section. Be specific with transcript evidence.` },
        what_went_wrong: { type: 'string', description: `What went wrong or was missed in the ${cat} section. Be specific.` },
        coach_tip: { type: 'string', description: `Actionable coaching tip for improving ${cat}. Give a specific phrase or technique they can use next time.` }
      }
    };
  });

  const paramProperties = {};
  parameters.forEach(param => {
    paramProperties[param.Parameter] = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['Pass', 'Fail', 'Not Applicable'] },
        reason: { type: 'string', description: 'Reason for the pass/fail status based on the transcript' }
      }
    };
  });

  return {
    type: 'object',
    properties: {
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number', description: 'Overall score 0-100 across all categories' },
          overall_grade: { type: 'string', description: 'Overall letter grade: A (90-100), B (75-89), C (60-74), D (40-59), F (0-39)' },
          summary: { type: 'string', description: 'One paragraph executive summary of the coaching evaluation. Mention top strength and top improvement area.' },
          category_scores: {
            type: 'object',
            properties: categoryScoreProps,
            description: 'Per-category coaching breakdown'
          },
          top_strengths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Top 3-5 specific things the associate did well, with evidence from the transcript'
          },
          critical_improvements: {
            type: 'array',
            items: { type: 'string' },
            description: 'Top 3-5 specific things the associate must improve, with evidence from the transcript'
          },
          suggested_script_lines: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                situation: { type: 'string', description: 'The situation or moment in the call where this applies' },
                suggested_response: { type: 'string', description: 'What the associate should say in this situation' }
              }
            },
            description: '2-4 suggested script lines for situations where the associate struggled'
          },
          parameter_evaluations: {
            type: 'object',
            properties: paramProperties,
            description: 'Detailed pass/fail evaluation of each individual parameter'
          }
        },
        required: ['overall_score', 'overall_grade', 'summary', 'category_scores', 'top_strengths', 'critical_improvements', 'suggested_script_lines', 'parameter_evaluations']
      }
    },
    required: ['coaching_report']
  };
}

function buildCoachingPrompt(transcript, source, parameters) {
  const role = source === 'google_meet' ? 'Expert Video Demo Coach' : 'Expert Counselling Coach';
  const context = source === 'google_meet'
    ? 'a product demonstration meeting conducted via Google Meet'
    : 'a sales counselling phone call for university admissions';
  const categories = groupByCategory(parameters);

  let prompt = `You are an ${role}. You are evaluating ${context}.\n\n`;
  prompt += `Your job is NOT just to find mistakes — you are a COACH. For every section:\n`;
  prompt += `1. Acknowledge what was done well (be specific, quote the transcript)\n`;
  prompt += `2. Point out what was missed or done poorly (be specific)\n`;
  prompt += `3. Give a concrete, actionable coaching tip with an example phrase they can use next time\n`;
  prompt += `4. Suggest actual script lines for situations where they struggled\n\n`;

  prompt += `--- TRANSCRIPT ---\n`;
  prompt += `${transcript}\n\n`;

  prompt += `--- QC PARAMETERS (grouped by category) ---\n`;
  prompt += `Evaluate each parameter as Pass/Fail/Not Applicable with a reason.\n`;
  prompt += `Then provide a coaching summary per category.\n\n`;

  for (const [category, params] of Object.entries(categories)) {
    prompt += `== ${category} ==\n`;
    params.forEach(p => {
      prompt += `- ${p.Parameter}: ${p.Description}\n`;
    });
    prompt += `\n`;
  }

  prompt += `--- SCORING GUIDELINES ---\n`;
  prompt += `- A (90-100): Excellent — nearly all parameters passed, strong execution\n`;
  prompt += `- B (75-89): Good — most parameters passed, minor gaps\n`;
  prompt += `- C (60-74): Average — several parameters failed, clear coaching needed\n`;
  prompt += `- D (40-59): Below Average — significant gaps, urgent coaching needed\n`;
  prompt += `- F (0-39): Poor — most parameters failed, fundamental issues\n\n`;

  prompt += `Be encouraging but honest. This is coaching, not punishment.\n`;

  return prompt;
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

module.exports = {
  ai,
  knowledgeBase,
  // New functions
  getQualityChecks,
  getDataCaptureQuestions,
  getPastCalls,
  getLeadState,
  getInsightsSchema,
  buildInsightsPrompt,
  getQualitySchema,
  buildQualityPrompt,
  // Legacy functions
  getParametersForSource,
  getCoachingSchema,
  buildCoachingPrompt,
  getIntelligenceSchema
};
