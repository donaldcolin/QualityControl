const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'node_backend', '.env') });
const { GoogleGenAI } = require('@google/genai');
const qcEngine = require('../node_backend/services/qc_engine');

const apiKey = process.env.GEMINI_API_KEY;
const ai = new GoogleGenAI({ apiKey });

function formatTimestamp(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function run() {
  const transcriptPath = path.join(__dirname, '..', 'storage', 'json_transcripts', 'RonMckline_test_audio.json');
  const asrData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const speakerTurns = asrData.speaker_turns || [];

  const formattedTranscript = speakerTurns
    .map(t => `[${formatTimestamp(t.start)} - ${formatTimestamp(t.end)}] ${t.speaker}: ${t.text}`)
    .join('\n');

  const coachingPrompt = `You are an elite BD Trainer coaching Kalvium counsellors on 1:1 Counselling Booking Calls.
=== KALVIUM BD PLAYBOOK ===
${qcEngine.bdPlaybook || 'Kalvium Admissions Playbook AY 2027'}

=== FULL CALL TRANSCRIPT (TAMIL / REGIONAL LANGUAGE) ===
${formattedTranscript}

=== CRITICAL COACHING INSTRUCTIONS ===
1. Analyze this 24-minute Tamil counselling call.
2. Generate EXACTLY 5 CONTEXT-AWARE GOLDEN REWRITES capturing high-leverage missed coaching opportunities:
   For EACH rewrite:
   - timestamp: exact timestamp range from transcript (e.g. "02:15 - 03:30")
   - what_they_said: exact words the advisor spoke in Tamil/Tanglish
   - why_it_failed: detailed explanation of why it failed, referencing the specific Playbook section/rule (e.g., Red Lines, Aikido method, Over-pitching, 10-stage call flow)
   - golden_rewrite: the exact phrase the advisor SHOULD have said, using Kalvium positioning, objection handling from the Playbook, and phrased in natural Tanglish or standard English that a South Indian counselor would speak.
3. Also provide:
   - overall_grade and overall_score
   - summary
   - top_strengths (top 3)
   - critical_improvements (top 3)
   - conversational_dynamics (talk-to-listen analysis)
All explanations must be in standard English.`;

  const coachingSchema = {
    type: 'object',
    properties: {
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number' },
          overall_grade: { type: 'string' },
          summary: { type: 'string' },
          top_strengths: { type: 'array', items: { type: 'string' } },
          critical_improvements: { type: 'array', items: { type: 'string' } },
          advanced_coaching: {
            type: 'object',
            properties: {
              context_aware_rewrites: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    timestamp: { type: 'string' },
                    what_they_said: { type: 'string' },
                    why_it_failed: { type: 'string' },
                    golden_rewrite: { type: 'string' }
                  },
                  required: ['timestamp', 'what_they_said', 'why_it_failed', 'golden_rewrite']
                }
              },
              conversational_dynamics: { type: 'string' },
              tone_and_empathy: { type: 'string' }
            },
            required: ['context_aware_rewrites', 'conversational_dynamics', 'tone_and_empathy']
          }
        },
        required: ['overall_score', 'overall_grade', 'summary', 'top_strengths', 'critical_improvements', 'advanced_coaching']
      }
    },
    required: ['coaching_report']
  };

  const models = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  const results = {};

  for (const model of models) {
    console.log(`\n▶ Generating full Coaching & 5 Golden Rewrites with [${model}]...`);
    const t0 = Date.now();
    const res = await qcEngine.callGeminiWithRetry(ai, {
      model,
      contents: coachingPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: coachingSchema,
        temperature: 0.15
      }
    });
    const lat = (Date.now() - t0) / 1000;
    const parsed = qcEngine.safeParseGeminiJSON(res.text);
    results[model] = {
      latency: lat,
      tokens: res.usageMetadata || {},
      coaching_report: parsed.coaching_report
    };
    console.log(`✓ Completed [${model}] in ${lat.toFixed(2)}s`);
  }

  const outP = path.join(__dirname, '..', 'storage', 'golden_rewrites_comparison.json');
  fs.writeFileSync(outP, JSON.stringify(results, null, 2));
  console.log(`\nSaved comparison to: ${outP}`);
}

run().catch(console.error);
