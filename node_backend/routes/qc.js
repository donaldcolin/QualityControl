const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/auth');
const axios = require('axios');
const supabase = require('../config/supabase');
const qcEngine = require('../services/qc_engine');
const meetSync = require('../services/meet_sync');
const { lsqParams } = require('../config/lsq');
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

  // Return 202 Accepted immediately so the Python worker is not blocked for 3 minutes
  res.status(202).json({
    success: true,
    status: 'Evaluation started in background',
    call_id: call_id
  });

  // Execute heavy LLM operations in the background
  Promise.resolve().then(async () => {
    try {
      let transcriptText = transcript;
      let callIdToUpdate = call_id;
      const effectiveSource = source || 'phone_call';

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
      qcEngine.getPastCalls(prospect_id),
      qcEngine.getLeadState(prospect_id),
    ]);

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
        console.error('Combined omni evaluation failed (non-fatal):', combinedErr.message);
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

    if (!callIdToUpdate && transcript) {
      // Create a new call row for direct transcript submissions if needed
      const { data: newCall } = await supabase
        .from('calls')
        .insert({
          qc_status: 'evaluated',
          transcript: transcriptText,
          filename: `${effectiveSource}_transcript`,
          language: 'en',
          duration_sec: 0,
          prospect_id: prospect_id || null,
          source: effectiveSource
        })
        .select('id')
        .single();

      if (newCall) callIdToUpdate = newCall.id;
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
        
      // Update the call pointer only
      await supabase
        .from('calls')
        .update({ qc_status: 'evaluated', call_quality_score: callQualityScore })
        .eq('id', callIdToUpdate);
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
      const existingHistory = existingLead?.call_history_snapshot || [];
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
    console.error("Async Evaluation Error:", err);
  }
  }); // End Promise.resolve().then()
});

// ═══════════════════════════════════════════════════════════════
//  LEADS CRUD & DEMO SEEDING
// ═══════════════════════════════════════════════════════════════

router.get('/leads', async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from('leads')
      .select('*')
      .order('updated_at', { ascending: false });
    
    if (error) throw error;
    
    // Fetch all calls and their latest evaluation runs for the dashboard
    const { data: callsData } = await supabase
      .from('calls')
      .select('*');

    const { data: evalsData } = await supabase
      .from('evaluation_runs')
      .select('*')
      .order('created_at', { ascending: false });

    // Map latest evaluation to calls
    const evalMap = {};
    if (evalsData) {
      evalsData.forEach(e => {
        if (!evalMap[e.call_id]) evalMap[e.call_id] = e;
      });
    }

    const callsByProspect = {};
    if (callsData) {
      callsData.forEach(c => {
        const evaluation = evalMap[c.id];
        if (evaluation && evaluation.results) {
           c.quality_data = evaluation.results.quality_data;
           c.insights_data = evaluation.results.insights_data;
           c.coaching_report = evaluation.results.coaching_report;
        }

        if (!callsByProspect[c.prospect_id]) callsByProspect[c.prospect_id] = [];
        callsByProspect[c.prospect_id].push(c);
      });
    }

    const leadsWithCounts = leads.map(l => {
      const leadCalls = callsByProspect[l.id] || [];
      return {
        ...l,
        calls: leadCalls,
        total_calls: leadCalls.length
      };
    });
    
    res.json(leadsWithCounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/leads/:id', async (req, res) => {
  try {
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .single();
      
    if (leadError) throw leadError;
    
    const { data: calls, error: callsError } = await supabase
      .from('calls')
      .select('*')
      .eq('prospect_id', req.params.id)
      .order('id', { ascending: true });
      
    if (callsError) throw callsError;
    
    lead.calls = calls || [];
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/demo/seed', async (req, res) => {
  try {
    // 0. Ensure the demo owners exist in qc_associates
    const sivaName = 'Siva Sandhiya P';
    let sivaNumber = 'bd41faa2-33df-11f0-9fe1-0259d35f5843'; // From db

    const abdulName = 'Abdul Kader Shanavas J';
    let abdulNumber = 'e3d08770-b30d-11ef-be59-0259d35f5843';

    await supabase.from('qc_associates').upsert([
      { emp_number: sivaNumber, emp_name: sivaName, emp_tags: 'Demo', language: 'en' },
      { emp_number: abdulNumber, emp_name: abdulName, emp_tags: 'Demo', language: 'en' }
    ], { onConflict: 'emp_number' });

    const prospect_id_1 = uuidv4();
    const { error: lead1Err } = await supabase.from('leads').insert({
      id: prospect_id_1,
      name: 'Farhaan (Demo - High Intent)',
      phone: '+91 9876543210',
      intent_score: 81,
      avg_call_quality_score: 96,
      
      next_process_step: '10 Sep \'26 - Provide WhatsApp Number',
      journey_summary: 'The customer, Farhaan\'s parent, is extremely interested in Kalvium\'s computer science program...',
      intent_factors: [
        { type: 'high', factor: 'Customer continues to ask clarifying questions about program structure.' },
        { type: 'high', factor: 'Customer agreed to the next steps immediately.' }
      ],
      bant_insights: {
        budget: { status: 'Qualified', details: 'Agreed to the standard fee structure without hesitation.' },
        authority: { status: 'Qualified', details: 'Father is the primary decision maker.' },
        need: { status: 'Qualified', details: 'Looking for a strong CS program for son.' },
        timeline: { status: 'Qualified', details: 'Wants to enroll for the upcoming academic year.' }
      },
      data_capture: {
        extracted_fields: [
          { field: 'Student Name', value: 'Aditya', confidence: 'High' },
          { field: 'Current Grade', value: '12th', confidence: 'High' },
          { field: 'Preferred City', value: 'Bangalore', confidence: 'Medium' }
        ],
        missing_mandatory_fields: ['10th Marks']
      },
      updated_at: new Date().toISOString()
    });
    
    const call1Id = uuidv4();
    const { error: call1Err } = await supabase.from('calls').insert({
      id: call1Id,
      prospect_id: prospect_id_1,
      source: 'phone_call',
      duration_sec: 660,
      talk_to_listen_ratio: '71:29',
      qc_status: 'evaluated',
      call_quality_score: 95,
      quality_data: { "Greeting": { score: 10, max_score: 10, status: 'Done', reason: 'Agent greeted properly.' } },
      summary_data: { call_summary: ['Customer wants to know about admissions.', 'Agent explained K-NET.'], key_points: ['Consultation needed with son.'] },
      insights_data: { objections: [{ category: 'Exam Difficulty', objection: 'Concerned about JEE.', how_handled: 'Clarified K-NET is aptitude-based.', customer_satisfied: true }] }
    });

    // Link prospect_id_1 to Siva
    await supabase.from('callizer_queue').insert({
      id: uuidv4(),
      call_id: call1Id,
      prospect_id: prospect_id_1,
      emp_number: sivaNumber,
      status: 'completed',
      audio_url: 'dummy',
      language: 'en'
    });

    // 2. Create Low Intent Demo Lead
    const prospect_id_2 = uuidv4();
    const { error: lead2Err } = await supabase.from('leads').insert({
      id: prospect_id_2,
      name: 'Aditya (Demo - Low Intent)',
      phone: '+91 9123456789',
      intent_score: 35,
      avg_call_quality_score: 55,
      
      next_process_step: 'Follow up in 2 weeks',
      journey_summary: 'Customer is hesitant due to the cost and prefers traditional colleges.',
      intent_factors: [
        { type: 'low', factor: 'Customer stated the fees are out of budget.' },
        { type: 'low', factor: 'Customer prefers a local college nearby.' }
      ],
      bant_insights: {
        budget: { status: 'Unqualified', details: 'Stated fees are too high.' },
        authority: { status: 'Qualified', details: 'Student is making the decision with parents.' },
        need: { status: 'Uncertain', details: 'Considering traditional colleges over Kalvium.' },
        timeline: { status: 'Unqualified', details: 'No urgency to decide.' }
      },
      data_capture: {
        extracted_fields: [
          { field: 'Student Name', value: 'Aditya', confidence: 'High' }
        ],
        missing_mandatory_fields: ['Current Grade', 'Preferred City', '10th Marks']
      },
      updated_at: new Date().toISOString()
    });
    
    const call2Id = uuidv4();
    const { error: call2Err } = await supabase.from('calls').insert({
      id: call2Id,
      prospect_id: prospect_id_2,
      source: 'phone_call',
      duration_sec: 420,
      talk_to_listen_ratio: '90:10',
      qc_status: 'evaluated',
      call_quality_score: 55,
      quality_data: { "Greeting": { score: 0, max_score: 10, status: 'Missed', reason: 'Agent did not greet.' } },
      summary_data: { call_summary: ['Customer complained about pricing.', 'Agent failed to handle objection.'], key_points: ['Unlikely to convert.'] },
      insights_data: { objections: [{ category: 'Cost', objection: 'Too expensive.', how_handled: 'Agent just repeated the price.', customer_satisfied: false }] }
    });

    // Link prospect_id_2 to Abdul
    await supabase.from('callizer_queue').insert({
      id: uuidv4(),
      call_id: call2Id,
      prospect_id: prospect_id_2,
      emp_number: abdulNumber,
      status: 'completed',
      audio_url: 'dummy',
      language: 'en'
    });

    if (lead1Err) throw lead1Err; if (lead2Err) throw lead2Err; if (call1Err) throw call1Err; if (call2Err) throw call2Err; res.json({ success: true, seeded_leads: [prospect_id_1, prospect_id_2] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  LEAD INTELLIGENCE
// ═══════════════════════════════════════════════════════════════

router.post('/intelligence/evaluate_lead', async (req, res) => {
  const { lead_id, lead_profile } = req.body;
  if (!lead_id) return res.status(400).json({ error: 'lead_id is required' });
  if (!qcEngine.ai) return res.status(500).json({ error: 'Gemini not configured' });

  try {
    const { data: lead, error: leadError } = await supabase.from('leads').select('*').eq('id', lead_id).single();
    if (leadError) throw new Error('Lead not found');

    const { data: pastCalls, error: pastCallsError } = await supabase.from('calls').select('call_number, transcript, qc_results, coaching_report, overall_score, source').eq('lead_id', lead_id).order('call_number', { ascending: true });
    if (pastCallsError) throw new Error('Could not fetch past calls');

    let prompt = `You are a PREDICTION ENGINE for a university admissions funnel (Kalvium/K-NET).\nYou must predict the probability that a specific lead will convert at each stage of the funnel.\nYour predictions MUST be grounded in the historical AY2026 data provided below.\n\n`;

    if (qcEngine.knowledgeBase) {
        prompt += `=== HISTORICAL AY2026 DATA (2,319 leads analyzed) ===\n\n`;
        prompt += `OVERALL FUNNEL:\n` + JSON.stringify(qcEngine.knowledgeBase.overall_funnel?.rates, null, 2) + `\n\n`;
        prompt += `CONVERSION BY BOARD:\n` + JSON.stringify(qcEngine.knowledgeBase.by_board, null, 2) + `\n\n`;
        prompt += `CONVERSION BY STATE:\n` + JSON.stringify(qcEngine.knowledgeBase.by_state, null, 2) + `\n\n`;
        prompt += `CROSS-CORRELATIONS:\n` + JSON.stringify(qcEngine.knowledgeBase.cross_correlations, null, 2) + `\n\n`;
    }

    prompt += `=== THIS LEAD'S PROFILE ===\nName: ${lead.name || 'Unknown'}\nTotal Calls Made: ${lead_profile?.total_calls || 'Unknown'}\n\n`;
    
    prompt += `=== CALL TRANSCRIPTS ===\n`;
    pastCalls?.forEach(pc => {
      prompt += `--- Call ${pc.call_number} (${pc.source || 'phone_call'}) ---\n${pc.transcript}\n\n`;
    });

    const responseSchema = qcEngine.getIntelligenceSchema();
    const response = await qcEngine.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 }
    });

    const resultObj = JSON.parse(response.text);
    await supabase.from('leads').update({
        overall_prediction: resultObj.overall_prediction,
        overall_reasoning: resultObj.overall_reasoning,
        stage_predictions: resultObj.stage_predictions,
        risk_factors: resultObj.risk_factors,
        positive_signals: resultObj.positive_signals
    }).eq('id', lead_id);

    res.json({ success: true, intelligence: resultObj });
  } catch (err) {
    console.error("Intelligence Error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  QUALITY CHECKS CRUD (uses qc_parameters table)
// ═══════════════════════════════════════════════════════════════

router.get('/coaching_templates', (req, res) => {
  try {
    const templatesPath = path.join(__dirname, '../config/coaching_templates.json');
    if (!fs.existsSync(templatesPath)) {
      return res.json([]);
    }
    const templates = JSON.parse(fs.readFileSync(templatesPath, 'utf8'));
    res.json(templates);
  } catch (error) {
    console.error('Error reading coaching templates:', error);
    res.status(500).json({ error: 'Failed to load coaching templates' });
  }
});

router.get('/quality_checks', async (req, res) => {
  const { source } = req.query;
  try {
    let query = supabase.from('qc_parameters').select('*').order('sort_order', { ascending: true });
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/quality_checks', async (req, res) => {
  const { source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order } = req.body;
  if (!category || !parameter) {
    return res.status(400).json({ error: 'category and parameter are required' });
  }
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .insert([{ source: source || 'phone_call', category, parameter, check_question, description, max_score: max_score || 10, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/quality_checks/:id', async (req, res) => {
  const { id } = req.params;
  const { source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from('qc_parameters')
      .update({ source, category, parameter, check_question, description, max_score, parameter_type, mark_fatal, enable_subjective_marking, na_condition, auto_detect_na, default_na, applicable_only_once_per_customer, sort_order })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/quality_checks/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('qc_parameters').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  DATA CAPTURE QUESTIONS CRUD
// ═══════════════════════════════════════════════════════════════

router.get('/data_capture_questions', async (req, res) => {
  const { source } = req.query;
  try {
    let query = supabase.from('data_capture_questions').select('*').order('sort_order', { ascending: true });
    if (source) query = query.eq('source', source);
    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/data_capture_questions', async (req, res) => {
  const { source, question, label, category, description, sort_order } = req.body;
  if (!question || !label) {
    return res.status(400).json({ error: 'question and label are required' });
  }
  try {
    const { data, error } = await supabase
      .from('data_capture_questions')
      .insert([{ source: source || 'phone_call', question, label, category: category || 'Data Capture', description, sort_order }])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/data_capture_questions/:id', async (req, res) => {
  const { id } = req.params;
  const { source, question, label, category, description, sort_order } = req.body;
  try {
    const { data, error } = await supabase
      .from('data_capture_questions')
      .update({ source, question, label, category, description, sort_order, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/data_capture_questions/:id', async (req, res) => {
  try {
    const { error } = await supabase.from('data_capture_questions').delete().eq('id', req.params.id);
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ACTIVITIES & QUEUE
// ═══════════════════════════════════════════════════════════════

router.post('/activities/push_to_qc', async (req, res) => {
  try {
    const { activity_id, resource_url, duration, type, prospect_id, emp_number, client_number, language, lead_name, lead_source } = req.body;

    if (!resource_url) {
      return res.status(400).json({ error: "No recording URL available for this activity" });
    }

    // Upsert lead so it's immediately tracked on the QC Leads Dashboard
    if (prospect_id) {
      let resolvedOwnerName = 'Unassigned';
      if (emp_number) {
        const { data: assoc } = await supabase.from('qc_associates').select('emp_name').eq('emp_number', emp_number).maybeSingle();
        if (assoc && assoc.emp_name) resolvedOwnerName = assoc.emp_name;
      }
      
      await supabase.from('leads').upsert({
        id: prospect_id,
        name: lead_name || 'Unknown',
        phone: client_number || null,
        lead_source: lead_source || 'Phone',
        owner: resolvedOwnerName
      }, { onConflict: 'id' });
    }

    const { data: existing } = await supabase
      .from('callizer_queue')
      .select('id, status')
      .eq('call_id', activity_id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: `Already queued (status: ${existing.status})`, queue_id: existing.id });
    }

    const queue_id = uuidv4();

    const { error: insertErr } = await supabase.from('callizer_queue').insert({
      id: queue_id,
      call_id: activity_id,
      audio_url: resource_url,
      language: language || 'hi',
      status: 'pending',
      emp_number: emp_number || '',
      client_number: client_number || '',
      call_type: type || '',
      duration: parseFloat(duration) || 0,
      prospect_id: prospect_id || '',
      errors: '[]'
    });

    if (insertErr) throw insertErr;

    res.json({ status: "queued", queue_id });
  } catch (err) {
    console.error("Push to QC error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  MEET SYNC
// ═══════════════════════════════════════════════════════════════

router.post('/meet_sync/trigger', async (req, res) => {
  try {
    const results = await meetSync.triggerManualSync();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  COACHING PUSH TO LSQ
// ═══════════════════════════════════════════════════════════════

router.post('/coaching/push_to_lsq', async (req, res) => {
  try {
    const { prospect_id, coaching_report, source } = req.body;

    if (!prospect_id || !coaching_report) {
      return res.status(400).json({ error: 'prospect_id and coaching_report are required' });
    }

    const { accessKey, secretKey } = lsqParams();
    if (!accessKey || !secretKey) {
      return res.status(400).json({ error: "LeadSquared API keys not set" });
    }

    const sourceEmoji = source === 'google_meet' ? '🎥 Video Demo' : '📞 Phone Call';
    const report = coaching_report;

    let activityNote = `${sourceEmoji} QC Coaching Report — Score: ${report.overall_score}/100 (Grade ${report.overall_grade})\n\n`;
    activityNote += `📝 ${report.summary}\n\n`;

    if (report.top_strengths && report.top_strengths.length > 0) {
      activityNote += `✅ STRENGTHS:\n`;
      report.top_strengths.forEach(s => { activityNote += `• ${s}\n`; });
      activityNote += `\n`;
    }

    if (report.critical_improvements && report.critical_improvements.length > 0) {
      activityNote += `❌ AREAS TO IMPROVE:\n`;
      report.critical_improvements.forEach(s => { activityNote += `• ${s}\n`; });
      activityNote += `\n`;
    }

    if (report.category_scores) {
      activityNote += `📊 CATEGORY SCORES:\n`;
      for (const [cat, data] of Object.entries(report.category_scores)) {
        activityNote += `• ${cat}: ${data.score}/100 (${data.grade})\n`;
      }
      activityNote += `\n`;
    }

    if (report.prescriptive_coaching && report.prescriptive_coaching.length > 0) {
      activityNote += `🎯 PRESCRIPTIVE COACHING (GOLDEN PITCH):\n`;
      report.prescriptive_coaching.forEach(pc => {
        activityNote += `• Situation: ${pc.situation}\n`;
        activityNote += `  ❌ You said: "${pc.what_associate_said}"\n`;
        activityNote += `  ✅ Golden Pitch: "${pc.golden_pitch}"\n`;
        activityNote += `  💡 Why: ${pc.why_it_works}\n\n`;
      });
    }

    const LSQ_QC_ACTIVITY_EVENT = parseInt(process.env.LSQ_QC_ACTIVITY_EVENT_CODE || '279', 10);
    const { lsqUrl } = require('../config/lsq');
    const url = lsqUrl('ProspectActivity.svc/Create');
    const payload = {
      RelatedProspectId: prospect_id,
      ActivityEvent: LSQ_QC_ACTIVITY_EVENT,
      ActivityNote: activityNote
    };

    const lsqRes = await axios.post(url, payload, { headers: { 'Content-Type': 'application/json' } });
    console.log(`🚀 Successfully pushed coaching report to LSQ for prospect ${prospect_id}`);
    res.json({ success: true, lsq_response: lsqRes.data });

  } catch (err) {
    console.error("Coaching Push Error:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
