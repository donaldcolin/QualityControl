const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');
const qcEngine = require('./services/qc_engine');

// Pricing Constants for Gemini Flash Lite
const PRICE_CACHED_INPUT_PER_1M = 0.025;   // $0.025 per 1M cached tokens
const PRICE_UNCACHED_INPUT_PER_1M = 0.10;   // $0.10 per 1M uncached input tokens
const PRICE_OUTPUT_PER_1M = 0.40;           // $0.40 per 1M output tokens
const USD_TO_INR = 83.5;

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function runAudit() {
  console.log('================================================================');
  console.log('🔬  DEEP TOKEN AUDIT: 24-MINUTE REAL AUDIO CALL');
  console.log('================================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from environment');
  const ai = new GoogleGenAI({ apiKey });
  const model = qcEngine.GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const activeCacheName = await qcEngine.getActiveCache(ai, model);
  console.log(`✅ Using Master Cache: ${activeCacheName}`);

  const transcriptPath = path.resolve(__dirname, '../storage/json_transcripts/RonMckline_test_audio.json');
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found at: ${transcriptPath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const speakerTurns = rawData.speaker_turns || [];
  const transcriptText = speakerTurns.map(t => `${t.speaker} (${formatTime(t.start)}): ${t.text}`).join('\n');

  const { params: phoneParams } = await qcEngine.getParametersForSource('phone_call');
  const phoneQualityChecks = await qcEngine.getQualityChecks('phone_call');
  console.log(`• Loaded Rubric: ${phoneQualityChecks.length} quality parameters`);

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

  console.log(`🚀 Sending evaluation request to ${model}...`);
  const startTime = Date.now();
  const geminiResponse = await qcEngine.generateContentWithRetry({
    model,
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
  const rawText = geminiResponse.text;
  const parsed = qcEngine.safeParseGeminiJSON(rawText);

  if (parsed?.coaching_report?.category_scores) {
    parsed.coaching_report.category_scores = qcEngine.normalizeCategoryScores(parsed.coaching_report.category_scores);
  }

  // Token math
  const cachedTokens = usage.cachedContentTokenCount || 0;
  const promptTokens = usage.promptTokenCount;
  const uncachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const outputTokens = usage.candidatesTokenCount;

  const costCachedUSD = (cachedTokens / 1_000_000) * PRICE_CACHED_INPUT_PER_1M;
  const costUncachedUSD = (uncachedInputTokens / 1_000_000) * PRICE_UNCACHED_INPUT_PER_1M;
  const costOutputUSD = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;
  const totalCostUSD = costCachedUSD + costUncachedUSD + costOutputUSD;
  const totalCostINR = totalCostUSD * USD_TO_INR;

  console.log(`\n================================================================`);
  console.log(`📊 [OFFICIAL API USAGE METADATA] (Latency: ${latencySec}s)`);
  console.log(`================================================================`);
  console.log(`• Total Tokens:          ${usage.totalTokenCount.toLocaleString()}`);
  console.log(`• Cached Tokens Hit:     ${cachedTokens.toLocaleString()}`);
  console.log(`• Uncached Input Tokens: ${uncachedInputTokens.toLocaleString()}`);
  console.log(`• Total Output Tokens:   ${outputTokens.toLocaleString()}`);
  console.log(`----------------------------------------------------------------`);
  console.log(`• Cached Input Cost:     $${costCachedUSD.toFixed(5)} (~₹${(costCachedUSD * USD_TO_INR).toFixed(4)})`);
  console.log(`• Uncached Input Cost:   $${costUncachedUSD.toFixed(5)} (~₹${(costUncachedUSD * USD_TO_INR).toFixed(4)})`);
  console.log(`• Output Token Cost:     $${costOutputUSD.toFixed(5)} (~₹${(costOutputUSD * USD_TO_INR).toFixed(4)})`);
  console.log(`• TOTAL COST PER CALL:   $${totalCostUSD.toFixed(5)} USD  👉  ₹${totalCostINR.toFixed(4)} INR`);
  console.log(`================================================================\n`);

  // SECTION-BY-SECTION AUDIT
  console.log(`================================================================`);
  console.log(`🔍 [SECTION-BY-SECTION OUTPUT AUDIT & BYTE BREAKDOWN]`);
  console.log(`================================================================`);

  function inspectSection(name, obj) {
    if (!obj) {
      console.log(`• ${name.padEnd(35)}: [MISSING / NULL]`);
      return 0;
    }
    const str = JSON.stringify(obj);
    const chars = str.length;
    const estTokens = Math.round(chars / 3.8); // approx 3.8 chars per token for JSON
    const costINR = (estTokens / 1_000_000) * PRICE_OUTPUT_PER_1M * USD_TO_INR;
    const pct = ((estTokens / outputTokens) * 100).toFixed(1);
    console.log(`• ${name.padEnd(35)}: ${String(chars).padStart(5)} chars | ~${String(estTokens).padStart(4)} tokens (${pct.padStart(4)}%) | ₹${costINR.toFixed(4)}`);
    return estTokens;
  }

  inspectSection('1. Quality Checklist (46 items)', parsed.quality);
  inspectSection('2. Insights: Intent & Factors', { score: parsed.insights?.intent_score, high: parsed.insights?.high_intent_factors, low: parsed.insights?.low_intent_factors });
  inspectSection('3. Insights: Objections', parsed.insights?.objections);
  inspectSection('4. Insights: Data Capture', parsed.insights?.data_capture);
  inspectSection('5. Insights: BANT Details', parsed.insights?.bant);
  inspectSection('6. Summary & Next Steps', parsed.summary);
  inspectSection('7. Coaching: Category Scores', parsed.coaching_report?.category_scores);
  inspectSection('8. Coaching: Strengths & Improvements', { strengths: parsed.coaching_report?.top_strengths, improvements: parsed.coaching_report?.critical_improvements });
  inspectSection('9. Coaching: 3 Golden Rewrites', parsed.coaching_report?.advanced_coaching?.context_aware_rewrites);
  inspectSection('10. Coaching: Behavioral Dynamics', parsed.coaching_report?.advanced_coaching?.conversational_dynamics);
  inspectSection('11. Coaching: Overall Score & Summary', { score: parsed.coaching_report?.overall_score, grade: parsed.coaching_report?.overall_grade, summary: parsed.coaching_report?.summary });

  console.log(`================================================================\n`);

  // Print exact Category Scores word counts
  console.log(`📝 [CATEGORY SCORES CONTENT AUDIT]`);
  (parsed.coaching_report?.category_scores || []).forEach(cs => {
    const wWell = (cs.what_went_well || '').split(/\s+/).filter(Boolean).length;
    const wWrong = (cs.what_went_wrong || '').split(/\s+/).filter(Boolean).length;
    const wTip = (cs.coach_tip || '').split(/\s+/).filter(Boolean).length;
    console.log(`  [${cs.category}] (${cs.score}% - Grade ${cs.grade})`);
    console.log(`    - Well  (${wWell}w): "${cs.what_went_well}"`);
    console.log(`    - Wrong (${wWrong}w): "${cs.what_went_wrong}"`);
    console.log(`    - Tip   (${wTip}w): "${cs.coach_tip}"`);
  });

  // Save the full audit JSON to disk for inspectability
  const auditFilePath = path.join(__dirname, 'latest_audit_result.json');
  fs.writeFileSync(auditFilePath, JSON.stringify({
    metadata: {
      timestamp: new Date().toISOString(),
      latencySec,
      usage,
      cost: {
        totalCostUSD,
        totalCostINR,
        costCachedUSD,
        costUncachedUSD,
        costOutputUSD
      }
    },
    parsedResponse: parsed
  }, null, 2));
  console.log(`\n💾 Saved full audit JSON to: ${auditFilePath}`);
}

runAudit().catch(err => {
  console.error('Audit failed:', err);
  process.exit(1);
});
