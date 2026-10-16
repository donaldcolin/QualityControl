const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const qcEngine = require('./services/qc_engine');

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function evaluateModelOnRonMckline(modelName, ai, omniPrompt, omniSchema, phoneParams, phoneQualityChecks) {
  console.log(`\n================================================================`);
  console.log(`🚀 RUNNING FULL EVALUATION: ${modelName}`);
  console.log(`================================================================`);
  
  // Pre-flight cache
  let activeCacheName = null;
  try {
    activeCacheName = await qcEngine.getActiveCache(ai, modelName);
  } catch (err) {
    console.warn(`[Cache Warning] Could not get active cache for ${modelName}:`, err.message);
  }

  const startTime = Date.now();
  const geminiResponse = await qcEngine.generateContentWithRetry({
    model: modelName,
    contents: omniPrompt,
    config: {
      cachedContent: activeCacheName,
      responseMimeType: 'application/json',
      responseSchema: omniSchema,
      temperature: 0.15
    }
  });

  const latencySec = ((Date.now() - startTime) / 1000).toFixed(2);
  const usage = geminiResponse.usageMetadata;
  const parsed = qcEngine.safeParseGeminiJSON(geminiResponse.text);

  if (parsed?.insights?.bant) {
    parsed.insights.bant = qcEngine.expandBant(parsed.insights.bant);
  }
  if (parsed?.insights?.data_capture) {
    parsed.insights.data_capture = qcEngine.populateMissingDataCaptureFields(parsed.insights.data_capture);
  }
  if (parsed?.coaching_report?.category_scores) {
    parsed.coaching_report.category_scores = qcEngine.normalizeCategoryScores(parsed.coaching_report.category_scores);
  }

  const cachedTokens = usage.cachedContentTokenCount || 0;
  const promptTokens = usage.promptTokenCount;
  const uncachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const outputTokens = usage.candidatesTokenCount;
  const totalTokens = usage.totalTokenCount;

  // Google Official Pricing (USD per 1M)
  const is31 = modelName.includes('3.1');
  const googleInRate = is31 ? 0.25 : 0.30;
  const googleCachedRate = is31 ? 0.025 : 0.03;
  const googleOutRate = is31 ? 1.50 : 2.50;
  const FX = 94.0; // incl 18% GST

  const costGoogleUSD = (cachedTokens / 1e6) * googleCachedRate + (uncachedInputTokens / 1e6) * googleInRate + (outputTokens / 1e6) * googleOutRate;
  const costGoogleINR = costGoogleUSD * FX;

  // If Uncached on Google
  const costGoogleUncachedUSD = (promptTokens / 1e6) * googleInRate + (outputTokens / 1e6) * googleOutRate;
  const costGoogleUncachedINR = costGoogleUncachedUSD * FX;

  return {
    modelName,
    latencySec,
    usage: {
      cachedTokens,
      uncachedInputTokens,
      promptTokens,
      outputTokens,
      totalTokens
    },
    cost: {
      cachedUSD: costGoogleUSD,
      cachedINR: costGoogleINR,
      uncachedUSD: costGoogleUncachedUSD,
      uncachedINR: costGoogleUncachedINR
    },
    coaching: {
      overall_score: parsed?.coaching_report?.overall_score,
      overall_grade: parsed?.coaching_report?.overall_grade,
      summary: parsed?.coaching_report?.summary,
      category_scores: parsed?.coaching_report?.category_scores || [],
      rewrites_count: (parsed?.coaching_report?.advanced_coaching?.context_aware_rewrites || []).length,
      sample_rewrite: (parsed?.coaching_report?.advanced_coaching?.context_aware_rewrites || [])[0]
    },
    insights: {
      intent_score: parsed?.insights?.intent_score,
      extracted_fields_count: (parsed?.insights?.data_capture?.extracted_fields || []).length,
      sample_fields: (parsed?.insights?.data_capture?.extracted_fields || []).slice(0, 4),
      objections_count: (parsed?.insights?.objections || []).length,
      sample_objection: (parsed?.insights?.objections || [])[0]
    },
    quality_checks_evaluated: (parsed?.quality || []).length
  };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing');
  const ai = new GoogleGenAI({ apiKey });

  const transcriptPath = path.resolve(__dirname, '../storage/json_transcripts/RonMckline_test_audio.json');
  const rawData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const speakerTurns = rawData.speaker_turns || [];
  const transcriptText = speakerTurns.map(t => `${t.speaker} (${formatTime(t.start)}): ${t.text}`).join('\n');

  const { params: phoneParams } = await qcEngine.getParametersForSource('phone_call');
  const phoneQualityChecks = await qcEngine.getQualityChecks('phone_call');

  const omniSchema = qcEngine.getOmniSchema([], phoneQualityChecks, phoneParams, 'phone_call');
  const omniPrompt = qcEngine.buildDynamicOmniPrompt(
    transcriptText,
    'phone_call',
    null,
    [],
    { intent_score: 50 },
    phoneQualityChecks,
    phoneParams,
    null
  );

  console.log(`Transcript Loaded: ${transcriptText.length} chars | 46 Quality Parameters Prepared.`);

  // Run 3.5
  const res35 = await evaluateModelOnRonMckline('gemini-3.5-flash-lite', ai, omniPrompt, omniSchema, phoneParams, phoneQualityChecks);
  
  // Run 3.1
  const res31 = await evaluateModelOnRonMckline('gemini-3.1-flash-lite', ai, omniPrompt, omniSchema, phoneParams, phoneQualityChecks);

  const report = {
    evaluated_at: new Date().toISOString(),
    transcript_file: 'RonMckline_test_audio.json',
    call_duration: '24m 12s',
    results_35: res35,
    results_31: res31
  };

  fs.writeFileSync(path.join(__dirname, 'real_comparison_results.json'), JSON.stringify(report, null, 2));
  console.log('\n✅ Real comparison completed successfully! Results saved to real_comparison_results.json');
}

main().catch(err => {
  console.error('Fatal error during benchmark:', err);
  process.exit(1);
});
