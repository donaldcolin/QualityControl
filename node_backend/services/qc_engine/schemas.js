
const { getParameterQuestion } = require('../../config/parameter_questions');

const CANONICAL_DATA_CAPTURE_FIELDS = [
  'Competitors Mentioned', 'Customer Location', 'JEE/Other Exams', 'Decision Maker',
  'Course/College Interested In', 'Email ID', 'JEE Coaching', 'Stream', 'Grade', 'Laptop Access'
];

function getInsightsSchema(dataCaptureQuestions, source = 'phone_call') {
  const isVideo = source === 'google_meet';

  const insightsProps = {
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
        },
        required: ['category', 'objection', 'how_handled', 'customer_satisfied']
      },
      description: 'All objections raised by the customer during the call'
    },
    bant: {
      type: 'object',
      properties: {
        budget: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] },
            details: { type: 'string', description: 'Budget status and financial details mentioned (fee range, affordability, whether fees were discussed or deferred)' }
          },
          required: ['status', 'details']
        },
        authority: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] },
            details: { type: 'string', description: 'Decision-maker dynamics (who was present on call, parents involved, who decides on college and finances)' }
          },
          required: ['status', 'details']
        },
        needs: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] },
            details: { type: 'string', description: 'Comprehensive student & parent needs (academic stream, learning style preferences, doubts about AI/career safety, branch interests, why they are looking at colleges)' }
          },
          required: ['status', 'details']
        },
        timeline: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['Qualified', 'Unqualified', 'Uncertain'] },
            details: { type: 'string', description: 'Admission timeline details (current grade, target intake year e.g. 2027, upcoming exams or decision milestones)' }
          },
          required: ['status', 'details']
        }
      },
      required: ['budget', 'authority', 'needs', 'timeline'],
      description: 'BANT analysis extracted from the conversation with thorough context'
    },
    data_capture: {
      type: 'object',
      properties: {
        extracted_fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              field: { 
                type: 'string', 
                enum: CANONICAL_DATA_CAPTURE_FIELDS,
                description: 'The exact canonical field name captured (e.g. Stream, Grade, Customer Location, Decision Maker)' 
              },
              value: { type: 'string', description: 'The value captured' },
              confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
              timestamp: { type: 'string', description: 'Timestamp MM:SS in transcript' }
            },
            required: ['field', 'value', 'confidence', 'timestamp']
          },
          description: 'Extracted facts for canonical fields. Return [] only if genuinely no fields were mentioned.'
        }
      },
      required: ['extracted_fields'],
      description: 'Canonical data capture fields extracted from conversation.'
    },
    conversation_topics: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key topics discussed during the conversation (max 3 short tags)'
    }
  };

  const insightsRequired = ['intent_score', 'high_intent_factors', 'low_intent_factors', 'objections', 'bant', 'data_capture', 'conversation_topics'];

  if (isVideo) {
    insightsProps.actual_meeting_start_time = { type: 'string', description: 'The exact timestamp when attendees first appeared on camera (from video timeline) or when the actual conversation began, ignoring pre-meeting silence. Format: MM:SS' };
    insightsProps.attendee_timeline = {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_time: { type: 'string', description: 'Start time of presence (e.g. 05:00 or 00:05:00)' },
          end_time: { type: 'string', description: 'End time of presence (e.g. 30:00 or 00:30:00)' },
          person: { type: 'string', description: 'The role or name of the attendee (e.g. Student, Mother)' },
          status: { type: 'string', description: 'Whether they were present, joined late, or left early' }
        },
        required: ['start_time', 'end_time', 'person', 'status']
      },
      description: 'Chronological timeline mapping who was present when, fusing video face counts with audio speaker roles'
    };
    insightsRequired.push('attendee_timeline');
  }

  return {
    type: 'object',
    properties: {
      insights: {
        type: 'object',
        properties: insightsProps,
        required: insightsRequired
      },
      summary: {
        type: 'object',
        properties: {
          call_summary: {
            type: 'array',
            items: { type: 'string' },
            description: 'Bullet points summarizing the discussion and customer situation'
          },
          key_points: {
            type: 'array',
            items: { type: 'string' },
            description: 'Critical facts extracted about the student, family, and preferences'
          },
          journey_summary: {
            type: 'string',
            description: 'Rolling summary of prospect journey across calls for CRM handover'
          }
        },
        required: ['call_summary', 'key_points', 'journey_summary']
      },
      next_steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Action item title' },
            due_by: { type: 'string', description: 'Suggested due date (YYYY-MM-DD)' }
          },
          required: ['title']
        },
        description: 'Concrete next steps for the agent'
      }
    },
    required: ['insights', 'summary', 'next_steps']
  };
}

function getQualitySchema(qualityChecks) {
  const paramProperties = {};
  qualityChecks.forEach(check => {
    paramProperties[sanitizeKey(check.parameter)] = {
      type: 'object',
      properties: {
        score: { type: 'number', description: `Score awarded (0 to ${check.max_score || 2})` },
        max_score: { type: 'number', description: `Maximum possible score: ${check.max_score || 2}` },
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

function getCombinedQualityCoachingSchema(qualityChecks, parameters) {
  return {
    type: 'object',
    properties: {
      quality: {
        type: 'array',
        items: {
          type: 'string',
          description: 'Compact parameter evaluation formatted as: "PARAM_ID|SCORE|THIRD_PERSON_REASON", e.g. "DP-01|1|[01:09] Asked stream without deep probe". SCORE is 2 (Done), 1 (Partially Done), 0 (Needs Improvement), or -1 (N/A). Third-person reason under 12 words.'
        },
        description: 'You MUST output a compact evaluation string for EVERY parameter in the rubric (all 46 items): "PARAM_ID|SCORE|REASON". Do not skip any parameter.'
      },
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number', description: 'Overall score 0-100' },
          overall_grade: { type: 'string', description: 'Letter grade A-F' },
          summary: { type: 'string', description: 'Executive summary of call performance and counseling approach' },
          category_scores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string', description: 'Category name' },
                score: { type: 'number', description: 'Score 0-100' },
                grade: { type: 'string', description: 'Letter grade A-F' },
                well: { type: 'string', description: 'EXACTLY 1 concise sentence under 15 words citing what was done well.' },
                wrong: { type: 'string', description: 'EXACTLY 1 concise sentence under 15 words citing specific gap or missed moment.' },
                tip: { type: 'string', description: 'EXACTLY 1 actionable coaching tip under 15 words from playbook.' }
              },
              required: ['category', 'score', 'grade', 'well', 'wrong', 'tip']
            }
          },
          top_strengths: { type: 'array', items: { type: 'string' }, description: 'Top specific strengths demonstrated with transcript evidence' },
          critical_improvements: { type: 'array', items: { type: 'string' }, description: 'Key areas for improvement with transcript evidence' },
          advanced_coaching: {
            type: 'object',
            properties: {
              context_aware_rewrites: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string', description: 'The exact timestamp range when this occurred, e.g. "02:05 - 03:59"' },
                    what_they_said: { type: 'string', description: 'The exact verbatim quote the associate used from the transcript (in original language)' },
                    why_it_failed: { type: 'string', description: 'Detailed, context-rich diagnosis: explain precisely what happened in this interaction, why this specific phrasing backfired or created resistance, the psychological impact on the prospect, and the exact Kalvium playbook principle violated.' },
                    golden_rewrite: { type: 'string', description: 'A detailed, realistic, high-impact golden script tailored specifically to the prospect and conversational context using Kalvium playbook techniques (Aikido method, Information Decay 75/50/25, Two-Slot technique, Socratic method). Provide a complete, natural conversational script with full context, not a brief 1-line fragment.' }
                  },
                  required: ['timestamp', 'what_they_said', 'why_it_failed', 'golden_rewrite']
                },
                description: 'Generate EXACTLY 3 high-impact, deeply contextualized golden rewrites focusing on the primary missed objection, discovery gap, or closing failure. Provide rich situational context and complete conversational scripts.'
              },
              conversational_dynamics: { type: 'string', description: 'Analysis of talk-to-listen ratio, pacing, monologuing, interrupting, and interaction balance' },
              tone_and_empathy: { type: 'string', description: 'Analysis of emotional intelligence, rapport, defensiveness, and active listening' },
              missed_opportunities: {
                type: 'array',
                items: { type: 'string' },
                description: 'Buying signals, emotional cues, or interest indicators the associate missed or talked over'
              },
              prospect_persona: { type: 'string', description: 'Persona identification (e.g. analytical parent, cautious first-gen family) and how the associate should adapt' },
              competitor_deflection: { type: 'string', description: 'Handling of competing colleges/exams or proactive positioning' },
              micro_agreements: { type: 'string', description: 'Trial closes, checkpoints, and prospect engagement checks' }
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

function getOmniSchema(dataCaptureQuestions, filteredQualityChecks, params, source = 'phone_call') {
  const insights = getInsightsSchema(dataCaptureQuestions, source);
  const qual_coach = getCombinedQualityCoachingSchema(params);
  return {
    type: 'object',
    properties: {
      insights: insights.properties.insights,
      summary: insights.properties.summary,
      next_steps: insights.properties.next_steps,
      quality: qual_coach.properties.quality,
      coaching_report: qual_coach.properties.coaching_report
    },
    required: ['insights', 'summary', 'quality', 'coaching_report']
  };
}

function getLeanOmniSchema(dataCaptureQuestions, filteredQualityChecks, params, subTier) {
  return {
    type: 'object',
    properties: {
      call_type_tag: {
        type: 'string',
        enum: ['Meeting Reminder', 'KNET Exam Reminder', 'Pitch Continuation', 'Call Forwarded / Callback Request', 'Routine Follow-up', 'Sales Call'],
        description: 'Operational classification'
      },
      insights: {
        type: 'object',
        properties: {
          intent_score: { type: 'number', description: 'Buying intent score 0-100' },
          data_capture: {
            type: 'object',
            properties: {
              extracted_fields: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    field: { 
                      type: 'string', 
                      enum: CANONICAL_DATA_CAPTURE_FIELDS,
                      description: 'Exact canonical field name (e.g. Stream, Grade, Customer Location, Decision Maker)' 
                    },
                    value: { type: 'string', description: 'Captured value' },
                    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    timestamp: { type: 'string', description: 'MM:SS' }
                  },
                  required: ['field', 'value', 'confidence', 'timestamp']
                },
                description: 'Genuinely captured fields. Return [] only if none mentioned.'
              }
            },
            required: ['extracted_fields'],
            description: 'Canonical data capture.'
          }
        },
        required: ['intent_score', 'data_capture']
      },
      summary: {
        type: 'object',
        properties: {
          call_summary: { type: 'array', items: { type: 'string' }, description: '1 concise sentence' }
        },
        required: ['call_summary']
      },
      next_steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Action title' }
          },
          required: ['title']
        }
      },
      quality: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            parameter: { type: 'string', description: 'Param ID or Name' },
            score: { type: 'number', description: 'Score' },
            max_score: { type: 'number', description: 'Max score' },
            status: { type: 'string', enum: ['Done', 'Partially Done', 'Needs Improvement', 'Not Applicable'] },
            coaching_status: { type: 'string', enum: ['Pass', 'Fail', 'Not Applicable'] },
            reason: { type: 'string', description: 'Brief quote or reason (under 10 words)' }
          },
          required: ['parameter', 'score', 'max_score', 'status', 'coaching_status', 'reason']
        },
        description: 'Audit by Exception: 2-4 evaluated checks ONLY.'
      },
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number', description: 'Score 0-100' },
          overall_grade: { type: 'string', description: 'Grade A-F' },
          summary: { type: 'string', description: '1 sentence summary' },
          coach_tip: { type: 'string', description: '1 actionable tip' }
        },
        required: ['overall_score', 'overall_grade', 'summary', 'coach_tip']
      }
    },
    required: ['call_type_tag', 'insights', 'summary', 'quality', 'coaching_report']
  };
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

function expandBant(rawBant) {
  if (!rawBant || typeof rawBant !== 'object') {
    return {
      budget: { status: 'Uncertain', details: '' },
      authority: { status: 'Uncertain', details: '' },
      needs: { status: 'Uncertain', details: '' },
      timeline: { status: 'Uncertain', details: '' }
    };
  }
  // If already in full expanded format:
  if (rawBant.budget && rawBant.budget.status) {
    return rawBant;
  }

  const keyMap = { b: 'budget', a: 'authority', n: 'needs', t: 'timeline' };
  const expanded = {};

  for (const [shortKey, fullKey] of Object.entries(keyMap)) {
    const val = rawBant[shortKey] != null ? rawBant[shortKey] : rawBant[fullKey];
    if (val && typeof val === 'object' && val.status) {
      expanded[fullKey] = val;
    } else if (typeof val === 'string') {
      const colonIdx = val.indexOf(':');
      let status = 'Uncertain';
      let details = val.trim();
      if (colonIdx !== -1) {
        const rawStatus = val.slice(0, colonIdx).trim().toUpperCase();
        details = val.slice(colonIdx + 1).trim();
        if (rawStatus === 'Q' || rawStatus.startsWith('QUAL')) status = 'Qualified';
        else if (rawStatus === 'U' || rawStatus.startsWith('UNQUAL')) status = 'Unqualified';
        else status = 'Uncertain';
      } else {
        const lower = val.toLowerCase();
        if (lower.startsWith('qual')) status = 'Qualified';
        else if (lower.startsWith('unqual')) status = 'Unqualified';
      }
      expanded[fullKey] = { status, details };
    } else {
      expanded[fullKey] = { status: 'Uncertain', details: '' };
    }
  }
  return expanded;
}

function populateMissingDataCaptureFields(dataCapture) {
  if (!dataCapture) {
    return { extracted_fields: [], missing_mandatory_fields: [...CANONICAL_DATA_CAPTURE_FIELDS] };
  }
  const extracted = Array.isArray(dataCapture.extracted_fields) ? dataCapture.extracted_fields : [];
  const capturedSet = new Set(extracted.map(f => (f.field || '').trim().toLowerCase()));
  const missing = CANONICAL_DATA_CAPTURE_FIELDS.filter(f => !capturedSet.has(f.toLowerCase()));
  return {
    ...dataCapture,
    extracted_fields: extracted,
    missing_mandatory_fields: missing
  };
}

function expandQualityExceptions(rawExceptions, paramLookup = new Map()) {
  if (!Array.isArray(rawExceptions)) return [];

  return rawExceptions.map(item => {
    // Strategy 1: Support compact pipe-separated string format ("PARAM_ID|SCORE|REASON")
    if (typeof item === 'string') {
      const parts = item.split('|');
      const rawId = (parts[0] || '').trim();
      const sRaw = parts[1] !== undefined ? parts[1].trim() : '0';
      const reason = parts.slice(2).join('|').trim();
      const sVal = parseInt(sRaw, 10);
      item = {
        id: rawId,
        s: isNaN(sVal) ? 0 : sVal,
        r: reason
      };
    }

    const rawParam = (item.id || item.param || item.parameter || '').trim();
    const matchedParam = paramLookup.get(rawParam) ||
      paramLookup.get(rawParam.toLowerCase()) ||
      rawParam;

    const isNA = item.status === 'Not Applicable' || item.s === -1 || item.score === -1;
    const score = isNA ? 0 : Number(item.s != null ? item.s : (item.score != null ? item.score : 0));
    const maxScore = isNA ? 0 : (item.max_score || 2);
    const status = item.status || (isNA ? 'Not Applicable' : score === maxScore ? 'Done' : score > 0 ? 'Partially Done' : 'Needs Improvement');
    const coachingStatus = item.coaching_status || (isNA ? 'Not Applicable' : score === maxScore ? 'Pass' : 'Fail');
    const reason = item.r || item.reason || '';

    return {
      parameter: matchedParam,
      param: rawParam,
      id: rawParam,
      question: getParameterQuestion(matchedParam) || matchedParam,
      score,
      max_score: maxScore,
      status,
      coaching_status: coachingStatus,
      reason
    };
  });
}

/**
 * Strategy 2 normalizer: Maps compact keys (well, wrong, tip) back to canonical
 * (what_went_well, what_went_wrong, coach_tip) for full database and frontend compatibility.
 */
function normalizeCategoryScores(categoryScores) {
  if (!Array.isArray(categoryScores)) return [];
  return categoryScores.map(cs => ({
    category: cs.category || '',
    score: typeof cs.score === 'number' ? cs.score : 0,
    grade: cs.grade || 'F',
    what_went_well: cs.what_went_well || cs.well || '',
    what_went_wrong: cs.what_went_wrong || cs.wrong || '',
    coach_tip: cs.coach_tip || cs.tip || ''
  }));
}

module.exports = {
  getInsightsSchema,
  getQualitySchema,
  getCombinedQualityCoachingSchema,
  getOmniSchema,
  getLeanOmniSchema,
  getIntelligenceSchema,
  expandBant,
  populateMissingDataCaptureFields,
  expandQualityExceptions,
  normalizeCategoryScores,
};
