
function getInsightsSchema(dataCaptureQuestions) {
  // (dataCaptureProps variable unused, removed)

  return {
    type: 'object',
    properties: {
      insights: {
        type: 'object',
        properties: {
          intent_score: { type: 'number', description: 'Buying intent score 0-100' },
          actual_meeting_start_time: { type: 'string', description: 'The exact timestamp when attendees first appeared on camera (from video timeline) or when the actual conversation began, ignoring pre-meeting silence. Format: MM:SS' },
          attendee_timeline: {
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
          },
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
            description: (Array.isArray(dataCaptureQuestions) && dataCaptureQuestions.length > 0 && dataCaptureQuestions.some(q => q.label && !q._isCanonical))
              ? `Answers to specific data capture questions. Expected fields and their questions:\n${dataCaptureQuestions.map(q => `- ${q.label}: ${q.question}`).join('\n')}`
              : 'Answers to the 10 canonical data capture questions defined in the Master Cached Context (Competitors Mentioned, Customer Location, JEE/Other Exams, Decision Maker, Course/College Interested In, Email ID, JEE Coaching, Stream, Grade, Laptop Access).'
          },
          conversation_topics: {
            type: 'array',
            items: { type: 'string' },
            description: 'Key topics discussed during the conversation (e.g., "K-NET Exam", "Program Curriculum")'
          }
        },
        required: ['intent_score', 'attendee_timeline', 'high_intent_factors', 'low_intent_factors', 'objections', 'bant', 'data_capture', 'conversation_topics']
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
            reason: { type: 'string', description: 'MUST MATCH the Evidence Required format (e.g. Timestamp + Verbatim Quote + Translation). Do NOT summarize. Provide the raw quote and timestamp even if they passed.' }
          },
          required: ['parameter', 'score', 'max_score', 'status', 'coaching_status', 'reason']
        },
        description: 'You MUST output an entry for EVERY parameter in the evaluation list. Evaluate ALL parameters — do NOT skip any. Default assumption: FAILED unless proven otherwise.'
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

function getOmniSchema(dataCaptureQuestions, filteredQualityChecks, params) {
  const insights = getInsightsSchema(dataCaptureQuestions);
  const qual_coach = getCombinedQualityCoachingSchema(params);
  return {
    type: 'object',
    properties: {
      insights: insights.properties.insights,
      summary: insights.properties.summary,
      next_steps: insights.properties.next_steps,
      quality: qual_coach.properties.quality,
      coaching_report: qual_coach.properties.coaching_report
    }
  };
}

function getLeanOmniSchema(dataCaptureQuestions, filteredQualityChecks, params, subTier) {
  return {
    type: 'object',
    properties: {
      call_type_tag: {
        type: 'string',
        enum: ['Meeting Reminder', 'KNET Exam Reminder', 'Pitch Continuation', 'Routine Follow-up', 'Sales Call'],
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
                    field: { type: 'string', description: 'Field name' },
                    value: { type: 'string', description: 'Captured value' },
                    confidence: { type: 'string', enum: ['High', 'Medium', 'Low'] },
                    timestamp: { type: 'string', description: 'MM:SS' }
                  },
                  required: ['field', 'value', 'confidence', 'timestamp']
                },
                description: 'Genuinely captured fields. Return [] if none.'
              }
            },
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

module.exports = {
  getInsightsSchema,
  getQualitySchema,
  getCombinedQualityCoachingSchema,
  getOmniSchema,
  getLeanOmniSchema,
  getIntelligenceSchema,
};
