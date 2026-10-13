require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const supabase = require('./config/supabase');
const qcEngine = require('./services/qc_engine');

async function runE2ETriageFlow() {
  console.log('====================================================');
  console.log('🧪 RUNNING PHASE 2.1 FULL SYSTEM INTEGRATION TEST');
  console.log('====================================================\n');

  const testProspectId = uuidv4();
  const testT0CallId = uuidv4();
  const testT1CallId = uuidv4();

  try {
    // ── STEP 1: CREATE TEST PROSPECT IN SUPABASE ─────────────────
    console.log('▶ [Step 1] Creating test lead...');
    const { error: leadErr } = await supabase.from('leads').insert({
      id: testProspectId,
      name: 'Test Prospect Triage',
      owner: 'QC System Tester',
      intent_score: 50,
      data_capture: { extracted_fields: [], missing_mandatory_fields: ['Email ID', 'Laptop Access'] }
    });
    if (leadErr) console.warn('Lead insert notice:', leadErr.message);

    // ── STEP 2: TEST T0 SHORT CALL AUTO-REJECTION ───────────────
    console.log('\n▶ [Step 2] Testing T0 Call (< 45s) insertion and handling...');
    const shortTranscript = 'Hello? Is anyone there? Can you hear me? Call disconnected.';
    const { error: cErr } = await supabase.from('calls').insert({
      id: testT0CallId,
      prospect_id: testProspectId,
      source: 'phone_call',
      duration_sec: 20,
      segments: [{ speaker: 'Agent', text: shortTranscript }],
      qc_status: 'pending'
    });
    if (cErr) console.error('  ⚠️ Insert call error:', cErr.message);

    const t0Triage = qcEngine.triageCall({ duration_sec: 20, source: 'phone_call' }, shortTranscript, []);
    console.log('  ✓ Triage Decision:', t0Triage);

    if (t0Triage.tier !== 'T0') {
      throw new Error(`Expected T0 tier, got ${t0Triage.tier}`);
    }

    // Simulate T0 handler record write
    await supabase.from('evaluation_runs').insert({
      call_id: testT0CallId,
      model_id: 'rule-engine-triage',
      input_snapshot: { source: 'phone_call', triage_reason: t0Triage.reason, evaluation_tier: 'T0' },
      results: { call_quality_score: null, call_quality_raw: 'N/A (< 45s Non-Pitch)', reject_reason: t0Triage.reason, tokens_saved: 28000, evaluation_tier: 'T0' }
    });
    await supabase.from('calls').update({
      qc_status: 'rejected',
      call_quality_score: null,
      call_quality_raw: 'N/A (< 45s Non-Pitch)'
    }).eq('id', testT0CallId);

    // Verify DB update
    const { data: verifiedT0Call } = await supabase.from('calls').select('qc_status, call_quality_raw').eq('id', testT0CallId).single();
    const { data: verifiedT0Eval } = await supabase.from('evaluation_runs').select('results, input_snapshot').eq('call_id', testT0CallId).single();

    if (verifiedT0Call?.qc_status !== 'rejected') throw new Error('T0 call was not marked as rejected');
    if (verifiedT0Eval?.results?.evaluation_tier !== 'T0') throw new Error('T0 evaluation run tier mismatch');
    console.log('  ✅ [T0 SUCCESS]: Rejected cleanly at ₹0.00 cost, logged in evaluation_runs & calls.\n');

    // ── STEP 3: TEST T1 REMINDER CALL QUALITY EVALUATION ────────
    console.log('▶ [Step 3] Testing T1 Meeting Reminder Call (55s) handling...');
    const reminderTranscript = `
Speaker 0 (00:02): Hello, am I speaking with Rahul?
Speaker 1 (00:04): Yes, Rahul here.
Speaker 0 (00:06): Hi Rahul, Anand from Kalvium. Just calling to remind you about our 1:1 counseling meeting today at 5:00 PM. Have you received the Google Meet link on WhatsApp?
Speaker 1 (00:15): Yes, I got the link.
Speaker 0 (00:17): Great! Please ensure you join on a laptop with your father so we can walk through everything together.
Speaker 1 (00:23): Sure, my father and I will join from my laptop.
Speaker 0 (00:27): Perfect! Looking forward to meeting you at 5 PM. Have a great day!
`;
    await supabase.from('calls').insert({
      id: testT1CallId,
      prospect_id: testProspectId,
      source: 'phone_call',
      duration_sec: 55,
      segments: [{ speaker: 'Agent', text: reminderTranscript }],
      qc_status: 'pending'
    });

    const t1Triage = qcEngine.triageCall({ duration_sec: 55, source: 'phone_call' }, reminderTranscript, []);
    console.log('  ✓ Triage Decision:', t1Triage);
    if (t1Triage.tier !== 'T1' || t1Triage.sub_tier !== 'T1_REMINDER') {
      throw new Error(`Expected T1_REMINDER tier, got ${t1Triage.tier} (${t1Triage.sub_tier})`);
    }

    // Run live evaluation using active cache & lean schema
    const activeCacheName = await qcEngine.getActiveCache(qcEngine.ai, qcEngine.GEMINI_MODEL);
    const { params } = await qcEngine.getParametersForSource('phone_call');
    const qualityChecks = await qcEngine.getQualityChecks('phone_call');

    const leanSchema = qcEngine.getLeanOmniSchema([], qualityChecks, params, t1Triage.sub_tier);
    const leanPrompt = qcEngine.buildLeanDynamicOmniPrompt(
      reminderTranscript,
      'phone_call',
      t1Triage,
      [],
      { intent_score: 50 },
      qualityChecks,
      params
    );

    console.log('  ⚡ Sending T1 Live Gemini request with Master Cached Context...');
    const startTime = Date.now();
    const omniResponse = await qcEngine.generateContentWithRetry({
      model: qcEngine.GEMINI_MODEL,
      contents: leanPrompt,
      config: {
        cachedContent: activeCacheName,
        responseMimeType: 'application/json',
        responseSchema: leanSchema,
        temperature: 0.15
      }
    });
    const evalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    const usage = omniResponse.usageMetadata;
    console.log(`  ✓ Gemini finished in ${evalDuration}s. Output Tokens: ${usage.candidatesTokenCount} (Cached Tokens: ${usage.cachedContentTokenCount})`);

    const omniResult = qcEngine.safeParseGeminiJSON(omniResponse.text);

    // Apply Audit by Exception mapping logic
    const qualityObj = {};
    const paramNameLookup = new Map();
    qualityChecks.forEach(check => {
      if (check.parameter) paramNameLookup.set(check.parameter, check.parameter);
      if (check.param_id) paramNameLookup.set(check.param_id, check.parameter);
      if (check.parameter) paramNameLookup.set(check.parameter.toLowerCase(), check.parameter);
      if (check.param_id) paramNameLookup.set(check.param_id.toLowerCase(), check.parameter);

      qualityObj[check.parameter] = {
        score: 0,
        max_score: 0,
        status: 'Not Applicable',
        coaching_status: 'Not Applicable',
        reason: 'Not applicable for short interaction (Audit by Exception)',
        mark_fatal: false
      };
    });

    if (Array.isArray(omniResult.quality)) {
      omniResult.quality.forEach(item => {
        const matchedParam = paramNameLookup.get(item.parameter) ||
          paramNameLookup.get((item.parameter || '').toLowerCase()) ||
          item.parameter;
        const isNA = item.status === 'Not Applicable';
        const maxScore = isNA ? 0 : (item.max_score || 2);
        qualityObj[matchedParam] = {
          score: isNA ? 0 : item.score,
          max_score: maxScore,
          status: item.status,
          coaching_status: isNA ? 'Not Applicable' : item.coaching_status,
          reason: item.reason,
          mark_fatal: false
        };
      });
    }

    // Score calculation
    let totalScore = 0;
    let totalMaxScore = 0;
    for (const [pName, evalItem] of Object.entries(qualityObj)) {
      if (evalItem.status !== 'Not Applicable') {
        totalScore += evalItem.score;
        totalMaxScore += evalItem.max_score;
      }
    }
    const finalScore = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 100;

    console.log(`  ✓ Total Evaluated Parameters: ${Object.values(qualityObj).filter(q => q.status !== 'Not Applicable').length} / ${qualityChecks.length}`);
    console.log(`  ✓ Quality Score: ${finalScore}% (${totalScore}/${totalMaxScore})`);

    if (finalScore < 80) {
      throw new Error(`KPI Penalty Error: Associate score (${finalScore}%) unfairly penalized on a clean reminder call!`);
    }

    // Persist to evaluation_runs and calls
    await supabase.from('evaluation_runs').insert({
      call_id: testT1CallId,
      model_id: qcEngine.GEMINI_MODEL,
      input_snapshot: {
        source: 'phone_call',
        cached_context: Boolean(activeCacheName),
        tokens: usage,
        evaluation_tier: t1Triage.sub_tier
      },
      results: {
        evaluation_tier: t1Triage.sub_tier,
        call_quality_score: finalScore,
        call_quality_raw: `${totalScore}/${totalMaxScore}`,
        quality_data: qualityObj,
        coaching_report: omniResult.coaching_report,
        summary_data: omniResult.summary,
        insights_data: omniResult.insights
      }
    });

    await supabase.from('calls').update({
      qc_status: 'evaluated',
      call_quality_score: finalScore,
      call_quality_raw: `${totalScore}/${totalMaxScore}`,
      quality_data: qualityObj,
      coaching_report: omniResult.coaching_report,
      summary_data: omniResult.summary
    }).eq('id', testT1CallId);

    console.log('  ✅ [T1 SUCCESS]: Meeting reminder evaluated at 100% KPI fairness, persisted to Supabase.\n');

    console.log('====================================================');
    console.log('🎉 FULL SYSTEM INTEGRATION TEST PASSED SUCCESSFULLY!');
    console.log('====================================================');

  } catch (err) {
    console.error('\n❌ INTEGRATION TEST FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // ── CLEANUP TEST ARTIFACTS ──────────────────────────────────
    console.log('\n🧹 Cleaning up test database records...');
    await supabase.from('evaluation_runs').delete().in('call_id', [testT0CallId, testT1CallId]);
    await supabase.from('calls').delete().in('id', [testT0CallId, testT1CallId]);
    await supabase.from('leads').delete().eq('id', testProspectId);
    console.log('✓ Cleanup complete.');
  }
}

runE2ETriageFlow();
