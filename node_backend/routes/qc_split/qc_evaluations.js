const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../../middleware/auth');
const axios = require('axios');
const supabase = require('../../config/supabase');
const qcEngine = require('../../services/qc_engine');
const meetSync = require('../../services/meet_sync');
const { lsqParams } = require('../../config/lsq');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════
//  EVALUATE CALL — Main endpoint (Summary + Insights + Quality)
// ═══════════════════════════════════════════════════════════════


router.post('/qc/evaluate_call', requireAuth, requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { call_id, transcript, prospect_id, source } = req.body;

  if (!call_id && !transcript) {
    return res.status(400).json({ error: 'Either call_id or transcript is required' });
  }
  if (!qcEngine.ai) return res.status(500).json({ error: 'Gemini not configured' });

  let activeCallId = call_id;
  const effectiveSource = source || 'phone_call';

  if (activeCallId) {
    await supabase.from('calls').update({ qc_status: 'processing' }).eq('id', activeCallId);
  } else if (transcript) {
    // Synchronously create the call before returning 202, so it appears in the UI
    const { data: newCall, error: insertError } = await supabase
      .from('calls')
      .insert({
        id: uuidv4(),
        qc_status: 'processing',
        duration_sec: 0,
        prospect_id: prospect_id || null,
        source: effectiveSource
      })
      .select('id')
      .single();
      
    if (insertError) {
      console.error("Failed to insert call:", insertError);
    } else if (newCall) {
      activeCallId = newCall.id;
    }
  }

  // Return 202 Accepted immediately so the Python worker is not blocked for 3 minutes
  res.status(202).json({
    success: true,
    status: 'Evaluation started in background',
    call_id: activeCallId
  });

  // Execute heavy LLM operations in the background
  Promise.resolve().then(async () => {
    console.log(`🔄 [QC Background] Starting evaluation for call: ${activeCallId}, source: ${effectiveSource}`);
    try {
      let transcriptText = transcript;
      let callIdToUpdate = activeCallId;

    // 1. Get transcript from call if not provided directly
    if (call_id && !transcript) {
      const { data: call, error: callError } = await supabase
        .from('calls')
        .select('*')
        .eq('id', call_id)
        .single();

      if (callError || !call) throw new Error('Call not found');

      if (call.segments) {
        const segments = typeof call.segments === 'string' ? JSON.parse(call.segments) : call.segments;
        transcriptText = segments.map(s => `${s.speaker}: ${s.text_en || s.text}`).join('\n');
      } else if (call.transcript) {
        transcriptText = call.transcript;
      }
      
      // -- TRIAGE PIPELINE --
      const triage = qcEngine.triageCall(call);
      
      if (triage.tier === 'T0') {
        // Auto-reject without burning any LLM tokens
        console.log(`🛑 [Triage] Call ${call_id} rejected as T0: ${triage.reason}`);
        await supabase.from('evaluation_runs').insert({
          call_id: callIdToUpdate,
          model_id: 'auto-triage',
          input_snapshot: { source: effectiveSource },
          results: { call_quality_score: 0, call_quality_raw: '0/0', reject_reason: triage.reason },
          status: 'completed',
          evaluation_tier: 'T0'
        });
        await supabase.from('calls').update({ qc_status: 'rejected', call_quality_score: 0 }).eq('id', callIdToUpdate);
        return; // Abort processing
      }
      
      if (triage.tier === 'T1') {
        // Enqueue for nightly Gemini Batch API
        console.log(`⏳ [Triage] Call ${call_id} routed to T1 Batch Queue.`);
        await supabase.from('evaluation_runs').insert({
          call_id: callIdToUpdate,
          model_id: qcEngine.GEMINI_MODEL,
          input_snapshot: { transcript_length: transcriptText.length, source: effectiveSource },
          results: {},
          status: 'pending',
          evaluation_tier: 'T1_Batch'
        });
        return; // Abort real-time processing
      }
      
      // If T2, continue down the real-time pipeline...
      console.log(`🚨 [Triage] Call ${call_id} routed to T2 Real-Time Processing: ${triage.reason}`);
    }

    if (!transcriptText) throw new Error('No transcript content available');

    // 2. Fetch dynamic configurations
    const [qualityChecks, dataCaptureQuestions, pastCalls, leadState] = await Promise.all([
      qcEngine.getQualityChecks(effectiveSource),
      qcEngine.getDataCaptureQuestions(effectiveSource),
      qcEngine.getPastCalls(prospect_id, callIdToUpdate),
      qcEngine.getLeadState(prospect_id),
    ]);

    // If there are no past calls, this is effectively the first call.
    // Wipe any existing journey summary from the state so the AI doesn't hallucinate deleted calls.
    if (leadState && pastCalls.length === 0) {
      leadState.journey_summary = null;
      leadState.call_history_snapshot = [];
    }

    // Filter out "applicable_only_once_per_customer" checks if prospect has prior calls
    const filteredQualityChecks = qualityChecks.filter(check => {
      if (check.applicable_only_once_per_customer && pastCalls.length > 0) return false;
      return true;
    });

    // 3 & 4. Run OMNI EVALUATION (Insights + Quality + Coaching in one single pass)
    let insightsResult = {};
    let qualityResult = { quality: {} };
    let coachingReport = null;
    let combinedResult = {};

    if (filteredQualityChecks.length > 0) {
      try {
        const { params } = await qcEngine.getParametersForSource(effectiveSource);
        if (params.length > 0) {
          // OMNI-PROMPT: One massive prompt to extract everything at once (saves 2,700+ tokens)
          const omniSchema = qcEngine.getOmniSchema(dataCaptureQuestions, filteredQualityChecks, params);
          const omniPrompt = qcEngine.buildOmniPrompt(
            transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params
          );

          const omniResponse = await qcEngine.ai.models.generateContent({
            model: qcEngine.GEMINI_MODEL,
            contents: omniPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: omniSchema,
              temperature: 0.15
            }
          });

          const omniResult = JSON.parse(omniResponse.text);
          
          insightsResult = {
            insights: omniResult.insights,
            summary: omniResult.summary,
            next_steps: omniResult.next_steps
          };
          combinedResult = omniResult;
          
          // Convert quality array back to object keyed by parameter name (for DB storage compatibility)
          // PRE-FILL: Assume all parameters passed perfectly. The AI will only return exceptions.
          const qualityObj = {};
          filteredQualityChecks.forEach(check => {
            qualityObj[check.parameter] = {
              score: check.max_score || 5,
              max_score: check.max_score || 5,
              status: 'Done',
              coaching_status: 'Pass',
              reason: 'Standard Execution'
            };
          });

          if (Array.isArray(combinedResult.quality)) {
            combinedResult.quality.forEach(item => {
              qualityObj[item.parameter] = {
                score: item.score,
                max_score: item.max_score || (qualityObj[item.parameter] ? qualityObj[item.parameter].max_score : 5),
                status: item.status,
                coaching_status: item.coaching_status,
                reason: item.reason
              };
            });
          }
          
          qualityResult = { quality: qualityObj };
          coachingReport = combinedResult.coaching_report || null;
        } else {
          // No coaching params yet — fall back to quality-only pass
          // MUST run insights manually first!
          const insightsSchema = qcEngine.getInsightsSchema(dataCaptureQuestions);
          const insightsPrompt = qcEngine.buildInsightsPrompt(transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState);
          const insightsResponse = await qcEngine.ai.models.generateContent({
            model: qcEngine.GEMINI_MODEL,
            contents: insightsPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: insightsSchema,
              temperature: 0.15
            }
          });
          insightsResult = JSON.parse(insightsResponse.text);

          const qualitySchema = qcEngine.getQualitySchema(filteredQualityChecks);
          const qualityPrompt = qcEngine.buildQualityPrompt(transcriptText, effectiveSource, filteredQualityChecks);
          const qualityResponse = await qcEngine.ai.models.generateContent({
            model: qcEngine.GEMINI_MODEL,
            contents: qualityPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: qualitySchema,
              temperature: 0.15
            }
          });
          const rawResult = JSON.parse(qualityResponse.text);
          // Quality-only schema still uses sanitized keys — reverse-map them
          const reverseMap = {};
          filteredQualityChecks.forEach(check => {
            reverseMap[qcEngine.sanitizeKey(check.parameter)] = check.parameter;
          });
          const restoredQuality = {};
          for (const [sanitizedKey, value] of Object.entries(rawResult.quality || {})) {
            const originalName = reverseMap[sanitizedKey] || sanitizedKey;
            restoredQuality[originalName] = value;
          }
          qualityResult = { quality: restoredQuality };
        }
      } catch (combinedErr) {
        console.error('Combined omni evaluation failed:', combinedErr.message);
        throw combinedErr;
      }
    } else {
      // 4b. Fallback: No quality checks for this source, so run Insights only
      const insightsSchema = qcEngine.getInsightsSchema(dataCaptureQuestions);
      const insightsPrompt = qcEngine.buildInsightsPrompt(transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState);

      const insightsResponse = await qcEngine.ai.models.generateContent({
        model: qcEngine.GEMINI_MODEL,
        contents: insightsPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: insightsSchema,
          temperature: 0.15
        }
      });
      insightsResult = JSON.parse(insightsResponse.text);
    }

    // 5. Compute overall quality score from merged result
    let totalScore = 0;
    let totalMaxScore = 0;
    for (const [, evaluation] of Object.entries(qualityResult.quality || {})) {
      totalScore += evaluation.score || 0;
      totalMaxScore += evaluation.max_score || 0;
    }
    const callQualityScore = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;
    const callQualityRaw = `${totalScore}/${totalMaxScore}`;

    // 7. Save results to evaluation_runs (IMMUTABLE HISTORY) instead of mutating calls
    const resultsPayload = {
      insights_data: insightsResult.insights,
      summary_data: insightsResult.summary,
      quality_data: qualityResult.quality,
      conversation_topics: insightsResult.insights?.conversation_topics || [],
      call_quality_score: callQualityScore,
      call_quality_raw: callQualityRaw,
    };

    if (coachingReport) {
      // Extract per-parameter coaching results from unified quality entries
      const paramEvals = {};
      for (const [paramName, evaluation] of Object.entries(qualityResult.quality || {})) {
        paramEvals[paramName] = {
          status: evaluation.coaching_status || 'Not Applicable',
          reason: evaluation.reason || ''
        };
      }
      resultsPayload.qc_results = paramEvals;
      resultsPayload.coaching_report = coachingReport;
      resultsPayload.overall_score = coachingReport.overall_score;
      resultsPayload.overall_grade = coachingReport.overall_grade;
    }



    if (callIdToUpdate) {
      // Create immutable evaluation run record
      await supabase
        .from('evaluation_runs')
        .insert({
          call_id: callIdToUpdate,
          model_id: qcEngine.GEMINI_MODEL,
          input_snapshot: { transcript_length: transcriptText.length, source: effectiveSource },
          results: resultsPayload
        });
    }

    // 8. Update leads table with latest prospect state
    let finalProspectId = prospect_id;

    if (!finalProspectId) {
      // Auto-create a lead for raw audio drops so it shows up in the dashboard
      finalProspectId = uuidv4();
      
      // Update the call to link to this new prospect_id
      await supabase.from('calls').update({ prospect_id: finalProspectId }).eq('id', callIdToUpdate);
      
      // Insert new lead
      await supabase.from('leads').insert({
        id: finalProspectId,
        name: `Unknown Lead (${new Date().toLocaleDateString()})`,
        owner: 'Unassigned',
        updated_at: new Date().toISOString()
      });
    }

    if (finalProspectId) {
      // Recompute avg_call_quality_score across all calls for this prospect
      const { data: allCalls } = await supabase
        .from('calls')
        .select('call_quality_score')
        .eq('prospect_id', finalProspectId)
        .not('call_quality_score', 'is', null);

      let avgQualityScore = callQualityScore;
      if (allCalls && allCalls.length > 0) {
        const sum = allCalls.reduce((acc, c) => acc + (c.call_quality_score || 0), 0);
        avgQualityScore = Math.round(sum / allCalls.length);
      }

      // ── Fetch existing lead state for MERGE logic ──────────────────────
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id, intent_score, intent_factors, bant_insights, data_capture, call_history_snapshot')
        .eq('id', finalProspectId)
        .maybeSingle();

      const thisCallIntentScore = insightsResult.insights?.intent_score ?? null;
      const thisCallNumber = (allCalls?.length || 1);

      // ── 1. WEIGHTED INTENT SCORE ───────────────────────────────────────
      // First call: use as-is. Subsequent calls: 30% historical + 70% latest
      // so a short "give me 2 days" call doesn't nuke a high-intent lead.
      let mergedIntentScore = thisCallIntentScore;
      if (existingLead?.intent_score != null && thisCallIntentScore != null && thisCallNumber > 1) {
        mergedIntentScore = Math.round(0.3 * existingLead.intent_score + 0.7 * thisCallIntentScore);
      }

      // ── 2. ACCUMULATE INTENT FACTORS (append, don't replace) ───────────
      const newFactors = [
        ...(insightsResult.insights?.high_intent_factors || []).map(f => ({ type: 'high', factor: f, call_number: thisCallNumber })),
        ...(insightsResult.insights?.low_intent_factors || []).map(f => ({ type: 'low', factor: f, call_number: thisCallNumber }))
      ];
      const existingFactors = existingLead?.intent_factors || [];
      // Deduplicate by factor text — keep the latest call_number version
      const factorMap = new Map();
      existingFactors.forEach(f => factorMap.set(f.factor, f));
      newFactors.forEach(f => factorMap.set(f.factor, f));
      const mergedIntentFactors = Array.from(factorMap.values());

      // ── 3. MERGE BANT (only upgrade status, never downgrade) ───────────
      const bantRank = { 'Unqualified': 0, 'Uncertain': 1, 'Qualified': 2 };
      const existingBant = existingLead?.bant_insights || {};
      const newBant = insightsResult.insights?.bant || {};
      const mergedBant = {};
      for (const dim of ['budget', 'authority', 'needs', 'timeline']) {
        const oldEntry = existingBant[dim] || { status: 'Uncertain', details: '' };
        const newEntry = newBant[dim] || { status: 'Uncertain', details: '' };
        const oldRank = bantRank[oldEntry.status] ?? 1;
        const newRank = bantRank[newEntry.status] ?? 1;
        if (newRank >= oldRank) {
          // Upgrade or same — take new entry (fresher details)
          mergedBant[dim] = newEntry;
        } else {
          // Would be a downgrade — keep old status but append new details
          mergedBant[dim] = {
            status: oldEntry.status,
            details: `${oldEntry.details} | Call ${thisCallNumber}: ${newEntry.details}`
          };
        }
      }

      // ── 4. MERGE DATA CAPTURE (keep old fields, update if higher confidence) ──
      const confidenceRank = { 'Low': 0, 'Medium': 1, 'High': 2 };
      const existingCapture = existingLead?.data_capture || {};
      const newCapture = insightsResult.insights?.data_capture || {};
      
      const existingFields = existingCapture.extracted_fields || [];
      const newFields = newCapture.extracted_fields || [];
      
      // Build map keyed by field name, keep higher-confidence version
      const fieldMap = new Map();
      existingFields.forEach(f => fieldMap.set(f.field, f));
      newFields.forEach(f => {
        const existing = fieldMap.get(f.field);
        if (!existing || (confidenceRank[f.confidence] ?? 0) >= (confidenceRank[existing.confidence] ?? 0)) {
          fieldMap.set(f.field, { ...f, captured_in_call: thisCallNumber });
        }
      });

      // Missing fields = only those still not captured after merge
      const capturedFieldNames = new Set(Array.from(fieldMap.values()).map(f => f.field));
      const allMissingFields = [
        ...(existingCapture.missing_mandatory_fields || []),
        ...(newCapture.missing_mandatory_fields || [])
      ];
      const mergedMissing = [...new Set(allMissingFields)].filter(f => !capturedFieldNames.has(f));

      const mergedDataCapture = {
        extracted_fields: Array.from(fieldMap.values()),
        missing_mandatory_fields: mergedMissing
      };

      // ── 5. PER-CALL INTENT HISTORY (for trend tracking) ───────────────
      const existingHistory = pastCalls.length === 0 ? [] : (existingLead?.call_history_snapshot || []);
      const callSnapshot = {
        call_number: thisCallNumber,
        call_id: callIdToUpdate,
        intent_score: thisCallIntentScore,
        source: effectiveSource,
        evaluated_at: new Date().toISOString()
      };
      const mergedHistory = [...existingHistory, callSnapshot];

      // ── Build final lead update payload ────────────────────────────────
      const leadUpdate = {
        intent_score: mergedIntentScore,
        intent_factors: mergedIntentFactors,
        bant_insights: mergedBant,
        data_capture: mergedDataCapture,
        journey_summary: insightsResult.summary?.journey_summary || null,
        next_process_step: insightsResult.next_steps?.[0]?.title || null,
        avg_call_quality_score: avgQualityScore,
        call_history_snapshot: mergedHistory,
        updated_at: new Date().toISOString()
      };

      if (existingLead) {
        await supabase
          .from('leads')
          .update(leadUpdate)
          .eq('id', finalProspectId);
      } else {
        await supabase
          .from('leads')
          .insert({
            id: finalProspectId,
            name: 'LSQ Lead', // Fallback name
            owner: 'Unassigned',
            ...leadUpdate
          });
      }
    }
    
    if (callIdToUpdate) {
      // Update the call pointer only AFTER the leads table is updated
      // to prevent frontend polling from terminating prematurely.
      await supabase
        .from('calls')
        .update({ qc_status: 'evaluated', call_quality_score: callQualityScore })
        .eq('id', callIdToUpdate);
    }

    // ── TRIGGER HOLISTIC JOURNEY SYNTHESIS ──
    if (finalProspectId) {
      // We don't await this so it runs asynchronously in the background
      qcEngine.evaluateLeadJourney(finalProspectId);
    }

    // 9. Push to LeadSquared via CRM Outbox Pattern
    if (finalProspectId && prospect_id) { // Only push if it was an actual LSQ prospect
      try {
        await supabase.from('crm_outbox').insert({
          prospect_id: finalProspectId,
          payload: {
            prospect_id: finalProspectId,
            coaching_report: coachingReport,
            source: effectiveSource
          },
          status: 'pending'
        });
        console.log(`📦 Inserted LSQ push into crm_outbox for ${finalProspectId}`);
      } catch (outboxErr) {
        console.error("Failed to insert into CRM outbox:", outboxErr.message);
      }
    }

    console.log(`✅ Background evaluation complete for call: ${callIdToUpdate}`);
  } catch (err) {
    console.error(`❌ ASYNC EVALUATION ERROR for call ${activeCallId}:`, err.message);
    console.error(err.stack);
    const failId = activeCallId || call_id;
    if (failId) {
      await supabase.from('calls').update({ qc_status: 'failed' }).eq('id', failId);
    }
  }
  }); // End Promise.resolve().then()
});


// ═══════════════════════════════════════════════════════════════
//  DEMO (GOOGLE MEET) TRANSCRIPT → DIRECT QC EVALUATION
// ═══════════════════════════════════════════════════════════════


router.post('/activities/push_demo_to_qc', async (req, res) => {
  try {
    const { prospect_id, phone, name, emp_number, lead_name, lead_source } = req.body;

    if (!phone && !name) {
      return res.status(400).json({ error: 'Phone or name is required to locate the transcript in Google Drive.' });
    }

    // 1. Upsert lead so it appears in the QC Leads Dashboard immediately
    if (prospect_id) {
      let resolvedOwnerName = 'Unassigned';
      if (emp_number) {
        const { data: assoc } = await supabase.from('qc_associates').select('emp_name').eq('emp_number', emp_number).maybeSingle();
        if (assoc && assoc.emp_name) resolvedOwnerName = assoc.emp_name;
      }

      await supabase.from('leads').upsert({
        id: prospect_id,
        name: lead_name || 'Unknown',
        phone: phone || null,
        lead_source: lead_source || 'Phone',
        owner: resolvedOwnerName
      }, { onConflict: 'id', ignoreDuplicates: true });
    }

    // 2. Fetch transcript text from Google Drive via internal loopback
    const port = process.env.PORT || 3000;
    const driveParams = new URLSearchParams();
    if (phone) driveParams.append('phone', phone);
    if (name) driveParams.append('name', name);

    const driveRes = await axios.get(`http://localhost:${port}/api/drive/transcript?${driveParams.toString()}`);
    const transcriptText = driveRes.data?.content;

    if (!transcriptText || transcriptText.trim().length < 50) {
      return res.status(404).json({ error: 'Transcript not found or too short in Google Drive.' });
    }

    // 3. Directly call evaluate_call with the transcript (bypasses ASR pipeline)
    const evalRes = await axios.post(`http://localhost:${port}/api/qc/evaluate_call`, {
      prospect_id: prospect_id,
      transcript: transcriptText,
      source: 'google_meet'
    }, {
      timeout: 180000,
      headers: { 'Authorization': 'Bearer internal_ai_worker_token' }
    });

    console.log(`🎥 [Demo QC] Google Meet transcript pushed for evaluation. Prospect: ${prospect_id}`);
    res.json({ success: true, status: 'evaluation_started', call_id: evalRes.data?.call_id });
  } catch (err) {
    console.error('Push demo to QC error:', err.response?.data || err.message);
    const msg = err.response?.data?.error || err.message;
    res.status(err.response?.status || 500).json({ error: msg });
  }
});


// ═══════════════════════════════════════════════════════════════
//  MANUAL JOURNEY SYNTHESIS
// ═══════════════════════════════════════════════════════════════


router.post('/qc/evaluate_journey', requireAuth, requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { prospect_id } = req.body;
  if (!prospect_id) return res.status(400).json({ error: 'prospect_id is required' });
  
  try {
    // Run it asynchronously or wait for it. Since it's a manual trigger, we can await it.
    // Wait, the function might take a bit. Let's run it synchronously so the user knows when it's done.
    const result = await qcEngine.evaluateLeadJourney(prospect_id);
    res.json({ success: true, message: 'Journey synthesized successfully' });
  } catch (err) {
    console.error("Journey synthesis error:", err);
    res.status(500).json({ error: err.message });
  }
});


module.exports = router;
