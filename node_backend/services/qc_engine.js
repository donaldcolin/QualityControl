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

async function getParametersForSource(source) {
  const { data: dbParams, error } = await supabase
    .from('qc_parameters')
    .select('*')
    .eq('source', source);

  if (error) {
    console.error("Error fetching QC parameters from DB:", error);
    throw new Error("Failed to fetch QC parameters");
  }
  
  // Map database columns to the expected format (capitalized keys to match old CSV parsing)
  const mappedParams = dbParams.map(p => ({
    Parameter: p.parameter,
    Category: p.category,
    Description: p.description
  }));

  if (source === 'google_meet') {
    return {
      params: mappedParams,
      role: 'Expert Video Demo Coach',
      context: 'a product demonstration meeting conducted via Google Meet'
    };
  }
  return {
    params: mappedParams,
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
  const { role, context } = getParametersForSource(source);
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
  getParametersForSource,
  getCoachingSchema,
  buildCoachingPrompt,
  getIntelligenceSchema
};
