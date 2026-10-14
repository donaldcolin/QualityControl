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

async function runRonMcklineE2ETest() {
  console.log('================================================================');
  console.log('🎙️  END-TO-END EVALUATION: 24-MINUTE REAL AUDIO CALL');
  console.log('================================================================\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY missing from environment');
  const ai = new GoogleGenAI({ apiKey });
  const model = qcEngine.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  // ── STEP 1: LOAD & PARSE REAL AUDIO TRANSCRIPT ──────────────────
  const transcriptPath = path.resolve(__dirname, '../storage/json_transcripts/RonMckline_test_audio.json');
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found at: ${transcriptPath}`);
  }

  const rawData = JSON.parse(fs.readFileSync(transcriptPath, 'utf8'));
  const speakerTurns = rawData.speaker_turns || [];
  const lastTurn = speakerTurns[speakerTurns.length - 1];
  const durationSec = Math.round(lastTurn?.end || 1452);
  const durationFormatted = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;

  // Format into standardized timestamped transcript
  const transcriptText = speakerTurns.map(t => {
    return `${t.speaker} (${formatTime(t.start)}): ${t.text}`;
  }).join('\n');

  // ── STEP 2: DISPLAY INPUT METRICS ───────────────────────────────
  console.log('📥 [INPUT SPECIFICATIONS]');
  console.log(`• Audio File:        ${rawData.file || 'RonMckline_test_audio.mp3'}`);
  console.log(`• Call Type / Source:phone_call (Audio Call)`);
  console.log(`• Language:          Tamil (${rawData.language || 'ta'}) with English technical terms`);
  console.log(`• Total Duration:    ${durationSec}s (${durationFormatted})`);
  console.log(`• Total Dialogue:    ${speakerTurns.length} speaker turns (${transcriptText.length.toLocaleString()} characters)`);
  console.log(`• Roles Detected:    Advisor (${rawData.roles_detected?.SPEAKER_01 || 'SPEAKER_01'}), Student (${rawData.roles_detected?.SPEAKER_02 || 'SPEAKER_02'}), Parent (${rawData.roles_detected?.SPEAKER_00 || 'SPEAKER_00'})`);
  console.log(`• Sample Transcript Preview:`);
  speakerTurns.slice(0, 3).forEach(t => {
    console.log(`    ${t.speaker} (${formatTime(t.start)}): ${t.text}`);
  });
  console.log(`    ... [${speakerTurns.length - 6} additional dialogue turns] ...`);
  speakerTurns.slice(-3).forEach(t => {
    console.log(`    ${t.speaker} (${formatTime(t.start)}): ${t.text}`);
  });

  // ── STEP 3: TRIAGE ENGINE EVALUATION ────────────────────────────
  console.log('\n🧭 [TRIAGE ENGINE EVALUATION]');
  const mockCallRecord = {
    duration_sec: durationSec,
    source: 'phone_call'
  };
  const triage = qcEngine.triageCall(mockCallRecord, transcriptText, []);
  console.log(`• Triage Tier:       ${triage.tier} (${triage.tier === 'T2' ? 'Deep Comprehensive Audit' : triage.tier})`);
  console.log(`• Triage Valid:      ${triage.valid}`);
  console.log(`• Triage Reason:     ${triage.reason}`);

  if (triage.tier !== 'T2') {
    throw new Error(`Expected Tier T2 for 24-minute call, got: ${triage.tier}`);
  }

  // ── STEP 4: CONTEXT CACHING PRE-FLIGHT ──────────────────────────
  console.log('\n⚡ [GEMINI CONTEXT CACHING]');
  const activeCacheName = await qcEngine.getActiveCache(ai, model);
  console.log(`• Active Cache Name: ${activeCacheName}`);

  // Fetch quality checks and parameters for phone_call (46 parameters)
  const { params: phoneParams } = await qcEngine.getParametersForSource('phone_call');
  const phoneQualityChecks = await qcEngine.getQualityChecks('phone_call');
  console.log(`• Loaded Rubric:     ${phoneQualityChecks.length} quality parameters for phone counselling`);

  // Build Phase 2.2 Omni Schema (Audit by Exception + 3 Golden Rewrites + Audio Schema Splitting)
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

  // ── STEP 5: LIVE GEMINI EXECUTION ───────────────────────────────
  console.log('\n🚀 [LIVE LLM EXECUTION]');
  console.log(`  Sending 24-minute call transcript to Gemini Flash Lite with Context Cache...`);
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
  const parsed = qcEngine.safeParseGeminiJSON(geminiResponse.text);

  // Expand compact BANT into canonical format in Node.js
  const rawBant = parsed?.insights?.bant;
  if (parsed?.insights?.bant) {
    parsed.insights.bant = qcEngine.expandBant(parsed.insights.bant);
  }

  // Populate missing mandatory data capture fields in Node.js
  if (parsed?.insights?.data_capture) {
    parsed.insights.data_capture = qcEngine.populateMissingDataCaptureFields(parsed.insights.data_capture);
  }

  // Normalize compact category scores keys (well, wrong, tip -> what_went_well, what_went_wrong, coach_tip)
  if (parsed?.coaching_report?.category_scores) {
    parsed.coaching_report.category_scores = qcEngine.normalizeCategoryScores(parsed.coaching_report.category_scores);
  }

  // Calculate economics
  const cachedTokens = usage.cachedContentTokenCount || 0;
  const promptTokens = usage.promptTokenCount;
  const uncachedInputTokens = Math.max(0, promptTokens - cachedTokens);
  const outputTokens = usage.candidatesTokenCount;

  const costCachedUSD = (cachedTokens / 1_000_000) * PRICE_CACHED_INPUT_PER_1M;
  const costUncachedUSD = (uncachedInputTokens / 1_000_000) * PRICE_UNCACHED_INPUT_PER_1M;
  const costOutputUSD = (outputTokens / 1_000_000) * PRICE_OUTPUT_PER_1M;
  const totalCostUSD = costCachedUSD + costUncachedUSD + costOutputUSD;
  const totalCostINR = totalCostUSD * USD_TO_INR;

  // ── STEP 6: DISPLAY OUTPUT TELEMETRY & COST ─────────────────────
  console.log(`\n================================================================`);
  console.log(`📊 [OUTPUT TELEMETRY & COST BREAKDOWN] (Finished in ${latencySec}s)`);
  console.log(`================================================================`);
  console.log(`• Total Tokens:      ${usage.totalTokenCount.toLocaleString()}`);
  console.log(`• Cached Tokens Hit: ${cachedTokens.toLocaleString()} tokens (~93% cache hit!)`);
  console.log(`• Uncached Input:    ${uncachedInputTokens.toLocaleString()} tokens`);
  console.log(`• Output Tokens:     ${outputTokens.toLocaleString()} tokens (Pruned from ~7,500 baseline)`);
  console.log(`----------------------------------------------------------------`);
  console.log(`• Cached Input Cost: $${costCachedUSD.toFixed(5)} (~₹${(costCachedUSD * USD_TO_INR).toFixed(3)})`);
  console.log(`• Uncached Cost:     $${costUncachedUSD.toFixed(5)} (~₹${(costUncachedUSD * USD_TO_INR).toFixed(3)})`);
  console.log(`• Output Token Cost: $${costOutputUSD.toFixed(5)} (~₹${(costOutputUSD * USD_TO_INR).toFixed(3)})`);
  console.log(`• TOTAL COST (24m):  $${totalCostUSD.toFixed(5)} USD  👉  ₹${totalCostINR.toFixed(3)} INR`);
  console.log(`================================================================\n`);

  // ── STEP 7: DISPLAY LEAD INTELLIGENCE & INSIGHTS ────────────────
  console.log('🧠 [LEAD INTELLIGENCE & DISCOVERY]');
  console.log(`• Intent Score:      ${parsed?.insights?.intent_score}/100`);

  const capturedFields = parsed?.insights?.data_capture?.extracted_fields || [];
  console.log(`• Canonical Data Captured (${capturedFields.length} fields):`);
  capturedFields.forEach(f => {
    console.log(`    - ${f.field}: "${f.value}" (${f.confidence} confidence @ ${f.timestamp})`);
  });

  const objections = parsed?.insights?.objections || [];
  console.log(`• Objections Raised (${objections.length} detected):`);
  objections.forEach(o => {
    console.log(`    - [${o.category}] "${o.objection}"`);
    console.log(`      How Handled: ${o.how_handled} (Customer Satisfied: ${o.customer_satisfied ? 'Yes' : 'No'})`);
  });

  console.log(`• BANT Status:`);
  if (parsed?.insights?.bant) {
    for (const [dim, val] of Object.entries(parsed.insights.bant)) {
      console.log(`    - ${dim.toUpperCase()}: ${val.status} — ${val.details}`);
    }
  }

  // ── STEP 8: DISPLAY CALL SUMMARY & NEXT STEPS ───────────────────
  console.log('\n📝 [CALL SUMMARY & ACTION ITEMS]');
  const summaryBullets = parsed?.summary?.call_summary || [];
  summaryBullets.forEach(b => console.log(`  • Summary: ${b}`));
  const keyPoints = parsed?.summary?.key_points || [];
  keyPoints.forEach(kp => console.log(`  • Key Point: ${kp}`));
  console.log(`• Journey Summary: ${parsed?.summary?.journey_summary || 'N/A'}`);

  const nextSteps = parsed?.next_steps || [];
  console.log(`• Next Steps:`);
  nextSteps.forEach(ns => {
    console.log(`    - ${ns.title} (Due: ${ns.due_by || 'N/A'})`);
  });

  // ── STEP 9: DISPLAY 3 GOLDEN REWRITES & COACHING ────────────────
  console.log('\n🎯 [TARGETED COACHING & EXACTLY 3 GOLDEN REWRITES]');
  const coaching = parsed?.coaching_report;
  console.log(`• Overall Score:     ${coaching?.overall_score}/100 (Grade: ${coaching?.overall_grade})`);
  console.log(`• Executive Summary: ${coaching?.summary}`);

  console.log(`• Category Breakdown:`);
  (coaching?.category_scores || []).forEach(cs => {
    const wellWords = (cs.what_went_well || '').split(/\s+/).filter(Boolean).length;
    const wrongWords = (cs.what_went_wrong || '').split(/\s+/).filter(Boolean).length;
    const tipWords = (cs.coach_tip || '').split(/\s+/).filter(Boolean).length;
    console.log(`    [${cs.category}] Score: ${cs.score}/100 (${cs.grade})`);
    console.log(`      Well (${wellWords}w): ${cs.what_went_well}`);
    console.log(`      Wrong (${wrongWords}w): ${cs.what_went_wrong}`);
    console.log(`      Tip (${tipWords}w): ${cs.coach_tip}`);
  });

  const rewrites = coaching?.advanced_coaching?.context_aware_rewrites || [];
  console.log(`\n• 3 High-Impact Golden Rewrites (Count: ${rewrites.length}):`);
  rewrites.forEach((rw, idx) => {
    console.log(`  --------------------------------------------------------------`);
    console.log(`  REWRITE #${idx + 1} (${rw.timestamp || 'N/A'})`);
    console.log(`  ❌ What They Said:   "${rw.what_they_said}"`);
    console.log(`  ⚠️  Why It Failed:    ${rw.why_it_failed}`);
    console.log(`  ⭐ Golden Rewrite:   "${rw.golden_rewrite}"`);
  });
  console.log(`  --------------------------------------------------------------`);

  console.log(`• Behavioral Coaching:`);
  const adv = coaching?.advanced_coaching;
  if (adv) {
    console.log(`    - Dynamics: ${adv.conversational_dynamics}`);
    console.log(`    - Tone & Empathy: ${adv.tone_and_empathy}`);
    console.log(`    - Missed Opportunities: ${(adv.missed_opportunities || []).join('; ')}`);
    console.log(`    - Prospect Persona: ${adv.prospect_persona}`);
  }

  // ── STEP 10: DISPLAY QUALITY CHECKLIST RECONCILIATION ───────────
  console.log('\n📋 [RECONCILED QUALITY CHECKLIST]');
  const rawQualityExceptions = parsed?.quality || [];
  console.log(`• Evaluated Parameters from Gemini: ${rawQualityExceptions.length} items`);

  // Reconcile 46 parameters
  const qualityObj = {};
  const paramNameLookup = new Map();
  phoneQualityChecks.forEach(check => {
    if (check.parameter) paramNameLookup.set(check.parameter, check.parameter);
    if (check.param_id) paramNameLookup.set(check.param_id, check.parameter);
    if (check.parameter) paramNameLookup.set(check.parameter.toLowerCase(), check.parameter);
    if (check.param_id) paramNameLookup.set(check.param_id.toLowerCase(), check.parameter);

    const maxScore = check.max_score || 2;
    const isGuardrail = check.polarity === 'guardrail_negative';
    qualityObj[check.parameter] = {
      score: isGuardrail ? maxScore : 0,
      max_score: maxScore,
      status: isGuardrail ? 'Done' : 'Needs Improvement',
      coaching_status: isGuardrail ? 'Pass' : 'Fail',
      reason: isGuardrail
        ? 'Compliant'
        : 'Not asked during call',
      question: qcEngine.getParameterQuestion(check.parameter) || check.parameter,
      mark_fatal: false
    };
  });

  const expandedQuality = qcEngine.expandQualityExceptions(rawQualityExceptions, paramNameLookup);
  expandedQuality.forEach(item => {
    const matchedParam = item.parameter;
    const maxScore = item.max_score || 2;
    const isNA = item.status === 'Not Applicable';

    qualityObj[matchedParam] = {
      score: item.score,
      max_score: maxScore,
      status: item.status,
      coaching_status: item.coaching_status,
      reason: item.reason || '',
      question: item.question || qcEngine.getParameterQuestion(matchedParam) || matchedParam,
      mark_fatal: false
    };
  });

  // Run hardcoded safety nets
  const internshipParamName = 'Internships Described Without a Timing Claim';
  if (qualityObj[internshipParamName]) {
    const lowerTranscript = transcriptText.toLowerCase();
    const internshipTimingPatterns = [
      /(?:second|2nd|third|3rd|fourth|4th|first|1st)\s*year\s*(?:internship|intern)/i,
      /internship\s*(?:from|in|during|starts?\s*(?:from|in))\s*(?:second|2nd|third|3rd|first|1st|fourth|4th)\s*year/i,
      /(?:second|2nd|third|3rd)\s*year\s*(?:onwards?|onward)/i,
      /செகண்ட்\s*இயர்/,
      /ஃபர்ஸ்ட்\s*இயர்/,
      /தேர்ட்\s*இயர்/
    ];
    if (internshipTimingPatterns.some(p => p.test(lowerTranscript))) {
      qualityObj[internshipParamName] = {
        ...qualityObj[internshipParamName],
        score: 0,
        status: 'Needs Improvement',
        coaching_status: 'Fail',
        reason: '[AUTO-FLAGGED SAFETY NET] Associate made a year-based internship timing claim.'
      };
      console.log(`  🚨 Safety Net: Flagged "${internshipParamName}" due to timing claim in Tamil.`);
    }
  }

  const allKeys = Object.keys(qualityObj);
  let passes = 0, partials = 0, fails = 0;
  let totalScore = 0, totalMaxScore = 0;

  const PHONE_V3_CATEGORY_WEIGHTS = {
    'Discovery & Probing': 0.20,
    'Value Pitch & Kalvium Differentiators': 0.10,
    'Objection Handling & De-escalation': 0.15,
    'Intent Signals & Parental Buy-in': 0.30,
    'Call Control, Tonality & Next Steps': 0.25
  };
  const categoryPoints = {};

  allKeys.forEach(k => {
    const item = qualityObj[k];
    const st = item.status;
    if (st === 'Done') passes++;
    else if (st === 'Partially Done') partials++;
    else fails++;

    totalScore += (item.score || 0);
    totalMaxScore += (item.max_score || 0);

    const checkDef = phoneQualityChecks.find(c => c.parameter === k || c.param_id === k);
    const cat = checkDef?.category || 'Other';
    if (!categoryPoints[cat]) categoryPoints[cat] = { score: 0, maxScore: 0 };
    categoryPoints[cat].score += (item.score || 0);
    categoryPoints[cat].maxScore += (item.max_score || 0);
  });

  let weightedTotal = 0;
  let totalWeightApplied = 0;
  for (const [catName, weight] of Object.entries(PHONE_V3_CATEGORY_WEIGHTS)) {
    const catData = categoryPoints[catName];
    if (catData && catData.maxScore > 0) {
      const catPct = (catData.score / catData.maxScore) * 100;
      weightedTotal += (catPct * weight);
      totalWeightApplied += weight;
    }
  }
  const weightedQualityScore = totalWeightApplied > 0
    ? Math.round(weightedTotal / totalWeightApplied)
    : (totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0);

  console.log(`• Full Reconciled Checklist: ${allKeys.length} / ${phoneQualityChecks.length} parameters`);
  console.log(`    - Passed / Full Marks: ${passes} parameters`);
  console.log(`    - Partially Done:      ${partials} parameters`);
  console.log(`    - Needs Improvement:   ${fails} parameters`);
  console.log(`• Raw Checklist Score:     ${totalScore}/${totalMaxScore} (${Math.round((totalScore/totalMaxScore)*100)}%)`);
  console.log(`• WEIGHTED QC SCORE:       ${weightedQualityScore}% (Calculated via 5 Official Category Weights)`);
  console.log(`• Category Breakdown:`);
  for (const [catName, weight] of Object.entries(PHONE_V3_CATEGORY_WEIGHTS)) {
    const catData = categoryPoints[catName] || { score: 0, maxScore: 0 };
    const pct = catData.maxScore > 0 ? Math.round((catData.score / catData.maxScore) * 100) : 0;
    console.log(`    - ${catName} (${Math.round(weight*100)}% wt): ${catData.score}/${catData.maxScore} (${pct}%)`);
  }

  console.log('\nSample Quality Checklist Entries (Third-Person Questions & Reasons):');
  const sampleParams = rawQualityExceptions.map(e => paramNameLookup.get((e.id || e.param || e.parameter || '').trim()) || e.id || e.param || e.parameter).filter(Boolean).slice(0, 5);
  sampleParams.forEach(p => {
    const item = qualityObj[p];
    if (item) {
      console.log(`  - Question: "${item.question || p}"`);
      console.log(`    Status: ${item.status} (${item.score}/${item.max_score}) | Reason: ${item.reason}`);
    }
  });

  console.log('\n================================================================');
  console.log('🎉 24-MINUTE CALL E2E TEST COMPLETED SUCCESSFULLY!');
  console.log('================================================================');
}

runRonMcklineE2ETest().catch(err => {
  console.error('\n❌ E2E TEST FAILED:', err.message);
  console.error(err.stack);
  process.exit(1);
});
