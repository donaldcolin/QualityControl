const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'node_backend', '.env') });
const { GoogleGenAI } = require('@google/genai');
const qcEngine = require('../node_backend/services/qc_engine');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY missing in node_backend/.env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

// Pricing per 1M tokens in USD
const PRICING = {
  'gemini-3.5-flash': { inputPerM: 0.15, outputPerM: 0.60 },
  'gemini-3.5-flash-lite': { inputPerM: 0.075, outputPerM: 0.30 },
  'gemini-2.5-flash': { inputPerM: 0.15, outputPerM: 0.60 }
};

const USD_TO_INR = 84.0;

function calculateCost(model, inputTokens, outputTokens) {
  const p = PRICING[model] || { inputPerM: 0.15, outputPerM: 0.60 };
  const costUSD = (inputTokens / 1_000_000) * p.inputPerM + (outputTokens / 1_000_000) * p.outputPerM;
  const costINR = costUSD * USD_TO_INR;
  return { costUSD, costINR };
}

function formatTimestamp(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

async function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('  TAMIL AUDIO BENCHMARK (IndicConformer ASR -> Gemini Models)');
  console.log('  Audio: RonMckline_test_audio.mp3 (24.23 minutes)');
  console.log('═══════════════════════════════════════════════════════════════════════════\n');

  // 1. Load ASR transcript
  const transcriptPath = path.join(__dirname, '..', 'storage', 'json_transcripts', 'RonMckline_test_audio.json');
  if (!fs.existsSync(transcriptPath)) {
    console.error(`Transcript file not found: ${transcriptPath}`);
    process.exit(1);
  }

  const asrData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const speakerTurns = asrData.speaker_turns || [];
  console.log(`Loaded ASR transcript: ${speakerTurns.length} speaker turns across 24 mins`);
  console.log(`Roles detected: ${JSON.stringify(asrData.roles_detected || {})}`);

  // Format transcript
  const formattedTranscript = speakerTurns
    .map(t => `[${formatTimestamp(t.start)} - ${formatTimestamp(t.end)}] ${t.speaker}: ${t.text}`)
    .join('\n');

  // 2. Fetch parameters for phone_call
  const source = 'phone_call';
  const { params } = await qcEngine.getParametersForSource(source);
  const qualityChecks = await qcEngine.getQualityChecks(source);
  console.log(`Loaded ${qualityChecks.length} quality checks and ${params.length} rubric parameters\n`);

  // 3. Prepare QC Evaluation Prompt & Schema
  const qcBlock = qcEngine._buildStaticQualityCoachingBlock(source, qualityChecks, params);
  const qcPrompt = `${qcBlock}
=== FULL CALL TRANSCRIPT (TAMIL / REGIONAL LANGUAGE) ===
${formattedTranscript}

INSTRUCTIONS FOR QC EVALUATION:
1. You are a strict auditor. Evaluate EVERY parameter in the rubric (Total: ${params.length}).
2. The transcript is in TAMIL. You must translate and understand each turn in its full context before scoring.
3. For each parameter, provide:
   - parameter: exact name
   - score: number based on scale
   - max_score: maximum allowed
   - status: 'Done' | 'Partially Done' | 'Needs Improvement' | 'Not Applicable'
   - coaching_status: 'Pass' | 'Fail' | 'Not Applicable'
   - reason: MUST cite timestamp + verbatim Tamil quote + English translation + why it passed or failed.
4. Output must be in standard English.`;

  const qcSchema = {
    type: 'object',
    properties: {
      quality: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            parameter: { type: 'string' },
            score: { type: 'number' },
            max_score: { type: 'number' },
            status: { type: 'string', enum: ['Done', 'Partially Done', 'Needs Improvement', 'Not Applicable'] },
            coaching_status: { type: 'string', enum: ['Pass', 'Fail', 'Not Applicable'] },
            reason: { type: 'string' }
          },
          required: ['parameter', 'score', 'max_score', 'status', 'coaching_status', 'reason']
        }
      }
    },
    required: ['quality']
  };

  // 4. Prepare Coaching Prompt & Schema
  const coachingPrompt = `You are an elite BD Trainer coaching Kalvium counsellors on 1:1 Counselling Booking Calls.
=== KALVIUM BD PLAYBOOK ===
${qcEngine.bdPlaybook || 'Kalvium Admissions Playbook AY 2027'}

=== FULL CALL TRANSCRIPT (TAMIL / REGIONAL LANGUAGE) ===
${formattedTranscript}

COACHING INSTRUCTIONS:
1. The transcript is a 24-minute counselling call conducted in Tamil. You must thoroughly analyze the dialogue.
2. Produce a comprehensive BD Coaching Report.
3. CRITICAL: Generate EXACTLY 5 CONTEXT-AWARE GOLDEN REWRITES capturing high-leverage missed opportunities:
   - timestamp: exact timestamp range from the transcript (e.g. "02:15 - 03:30")
   - what_they_said: exact phrase the advisor said in Tamil/Tanglish
   - why_it_failed: why this was ineffective, citing the specific Playbook section/rule violated
   - golden_rewrite: the ideal Kalvium pitch using facts and objection handling from the Playbook (in natural Tanglish or English)
4. Evaluate talk-to-listen dynamics, tone, parent involvement, and overall letter grade (A-F) and score (0-100).
5. All summary and feedback text must be written in standard English.`;

  const coachingSchema = {
    type: 'object',
    properties: {
      coaching_report: {
        type: 'object',
        properties: {
          overall_score: { type: 'number' },
          overall_grade: { type: 'string' },
          summary: { type: 'string' },
          category_scores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                score: { type: 'number' },
                grade: { type: 'string' },
                what_went_well: { type: 'string' },
                what_went_wrong: { type: 'string' },
                coach_tip: { type: 'string' }
              },
              required: ['category', 'score', 'grade', 'what_went_well', 'what_went_wrong', 'coach_tip']
            }
          },
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
              tone_and_empathy: { type: 'string' },
              missed_opportunities: { type: 'array', items: { type: 'string' } },
              prospect_persona: { type: 'string' }
            },
            required: ['context_aware_rewrites', 'conversational_dynamics', 'tone_and_empathy', 'missed_opportunities', 'prospect_persona']
          }
        },
        required: ['overall_score', 'overall_grade', 'summary', 'category_scores', 'top_strengths', 'critical_improvements', 'advanced_coaching']
      }
    },
    required: ['coaching_report']
  };

  const modelsToTest = ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  const benchmarkResults = {};

  for (const model of modelsToTest) {
    console.log(`\n───────────────────────────────────────────────────────────────────────────`);
    console.log(`▶ BENCHMARKING MODEL: [${model}]`);
    console.log(`───────────────────────────────────────────────────────────────────────────`);
    benchmarkResults[model] = {
      qc: {},
      coaching: {},
      total: {}
    };

    // ── PASS 1: QC Parameter Evaluation ──
    console.log(`  [Pass 1/2] Running QC Parameter Evaluation...`);
    const qcStart = Date.now();
    try {
      const qcRes = await qcEngine.callGeminiWithRetry(ai, {
        model,
        contents: qcPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: qcSchema,
          temperature: 0.15
        }
      });
      const qcLatency = (Date.now() - qcStart) / 1000;
      const qcParsed = qcEngine.safeParseGeminiJSON(qcRes.text);
      const qcUsage = qcRes.usageMetadata || {};
      const qcInputTokens = qcUsage.promptTokenCount || 0;
      const qcOutputTokens = qcUsage.candidatesTokenCount || 0;
      const qcTotalTokens = qcUsage.totalTokenCount || (qcInputTokens + qcOutputTokens);
      const qcCost = calculateCost(model, qcInputTokens, qcOutputTokens);

      const evaluatedParams = qcParsed.quality || [];
      const totalScore = evaluatedParams.reduce((acc, p) => acc + (p.score || 0), 0);
      const maxScore = evaluatedParams.reduce((acc, p) => acc + (p.max_score || 0), 0);
      const pctScore = maxScore > 0 ? ((totalScore / maxScore) * 100).toFixed(1) : 'N/A';

      console.log(`  ✓ QC Complete in ${qcLatency.toFixed(2)}s`);
      console.log(`    Tokens: In=${qcInputTokens.toLocaleString()} | Out=${qcOutputTokens.toLocaleString()} | Total=${qcTotalTokens.toLocaleString()}`);
      console.log(`    Cost: $${qcCost.costUSD.toFixed(5)} (~₹${qcCost.costINR.toFixed(3)})`);
      console.log(`    Score: ${totalScore}/${maxScore} (${pctScore}%) across ${evaluatedParams.length} parameters`);

      benchmarkResults[model].qc = {
        latencySec: qcLatency,
        inputTokens: qcInputTokens,
        outputTokens: qcOutputTokens,
        totalTokens: qcTotalTokens,
        costUSD: qcCost.costUSD,
        costINR: qcCost.costINR,
        paramsCount: evaluatedParams.length,
        totalScore,
        maxScore,
        pctScore,
        sampleEvidence: evaluatedParams.slice(0, 3)
      };
    } catch (err) {
      console.error(`  ✗ QC Evaluation Failed for ${model}:`, err.message);
      benchmarkResults[model].qc = { error: err.message };
    }

    // ── PASS 2: BD Coaching Report ──
    console.log(`  [Pass 2/2] Running BD Coaching Report Generation...`);
    const coachStart = Date.now();
    try {
      const coachRes = await qcEngine.callGeminiWithRetry(ai, {
        model,
        contents: coachingPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: coachingSchema,
          temperature: 0.15
        }
      });
      const coachLatency = (Date.now() - coachStart) / 1000;
      const coachParsed = qcEngine.safeParseGeminiJSON(coachRes.text);
      const coachUsage = coachRes.usageMetadata || {};
      const coachInputTokens = coachUsage.promptTokenCount || 0;
      const coachOutputTokens = coachUsage.candidatesTokenCount || 0;
      const coachTotalTokens = coachUsage.totalTokenCount || (coachInputTokens + coachOutputTokens);
      const coachCost = calculateCost(model, coachInputTokens, coachOutputTokens);

      const rep = coachParsed.coaching_report || {};
      const rewrites = rep.advanced_coaching?.context_aware_rewrites || [];

      console.log(`  ✓ Coaching Complete in ${coachLatency.toFixed(2)}s`);
      console.log(`    Tokens: In=${coachInputTokens.toLocaleString()} | Out=${coachOutputTokens.toLocaleString()} | Total=${coachTotalTokens.toLocaleString()}`);
      console.log(`    Cost: $${coachCost.costUSD.toFixed(5)} (~₹${coachCost.costINR.toFixed(3)})`);
      console.log(`    Grade: ${rep.overall_grade || 'N/A'} (Score: ${rep.overall_score || 0}/100)`);
      console.log(`    Golden Rewrites generated: ${rewrites.length}`);

      benchmarkResults[model].coaching = {
        latencySec: coachLatency,
        inputTokens: coachInputTokens,
        outputTokens: coachOutputTokens,
        totalTokens: coachTotalTokens,
        costUSD: coachCost.costUSD,
        costINR: coachCost.costINR,
        grade: rep.overall_grade,
        score: rep.overall_score,
        summary: rep.summary,
        rewritesCount: rewrites.length,
        sampleRewrite: rewrites[0] || null,
        topStrengths: rep.top_strengths,
        criticalImprovements: rep.critical_improvements,
        conversationalDynamics: rep.advanced_coaching?.conversational_dynamics
      };
    } catch (err) {
      console.error(`  ✗ Coaching Generation Failed for ${model}:`, err.message);
      benchmarkResults[model].coaching = { error: err.message };
    }

    // Totals for this model
    const qc = benchmarkResults[model].qc;
    const ch = benchmarkResults[model].coaching;
    if (!qc.error && !ch.error) {
      const totLatency = qc.latencySec + ch.latencySec;
      const totInputTokens = qc.inputTokens + ch.inputTokens;
      const totOutputTokens = qc.outputTokens + ch.outputTokens;
      const totTokens = qc.totalTokens + ch.totalTokens;
      const totCostUSD = qc.costUSD + ch.costUSD;
      const totCostINR = qc.costINR + ch.costINR;

      benchmarkResults[model].total = {
        latencySec: totLatency,
        inputTokens: totInputTokens,
        outputTokens: totOutputTokens,
        totalTokens: totTokens,
        costUSD: totCostUSD,
        costINR: totCostINR
      };

      console.log(`  ── [${model} TOTAL] ──`);
      console.log(`    Total Latency: ${totLatency.toFixed(2)}s`);
      console.log(`    Total Tokens: ${totTokens.toLocaleString()} (In: ${totInputTokens.toLocaleString()}, Out: ${totOutputTokens.toLocaleString()})`);
      console.log(`    Total Cost: $${totCostUSD.toFixed(5)} (~₹${totCostINR.toFixed(3)})`);
    }
  }

  // Save full results to json
  const outPath = path.join(__dirname, '..', 'storage', 'benchmark_results_tamil_audio.json');
  fs.writeFileSync(outPath, JSON.stringify(benchmarkResults, null, 2));
  console.log(`\nSaved benchmark data to: ${outPath}`);

  return benchmarkResults;
}

runBenchmark().catch(err => {
  console.error('Fatal error during benchmark:', err);
  process.exit(1);
});
