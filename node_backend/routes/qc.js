const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const qcEngine = require('../services/qc_engine');
const meetSync = require('../services/meet_sync');
const { lsqParams } = require('../config/lsq');
const { v4: uuidv4 } = require('uuid');

// ═══════════════════════════════════════════════════════════════
//  EVALUATE CALL — Main endpoint (Summary + Insights + Quality)
// ═══════════════════════════════════════════════════════════════

router.post('/qc/evaluate_call', async (req, res) => {
  const { call_id, transcript, prospect_id, source } = req.body;

  if (!call_id && !transcript) {
    return res.status(400).json({ error: 'Either call_id or transcript is required' });
  }
  if (!qcEngine.ai) return res.status(500).json({ error: 'Gemini not configured' });

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

    // 3. Run INSIGHTS evaluation (Summary + Insights + Next Steps)
    const insightsSchema = qcEngine.getInsightsSchema(dataCaptureQuestions);
    const insightsPrompt = qcEngine.buildInsightsPrompt(transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState);

    const insightsResponse = await qcEngine.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: insightsPrompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: insightsSchema,
        temperature: 0.15
      }
    });

    const insightsResult = JSON.parse(insightsResponse.text());

    // 4. Run QUALITY evaluation (Quality tab scoring)
    let qualityResult = { quality: {} };
    if (filteredQualityChecks.length > 0) {
      const qualitySchema = qcEngine.getQualitySchema(filteredQualityChecks);
      const qualityPrompt = qcEngine.buildQualityPrompt(transcriptText, effectiveSource, filteredQualityChecks);

      const qualityResponse = await qcEngine.ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: qualityPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: qualitySchema,
          temperature: 0.15
        }
      });

      qualityResult = JSON.parse(qualityResponse.text());
    }

    // 5. Compute overall quality score
    let totalScore = 0;
    let totalMaxScore = 0;
    for (const [paramName, evaluation] of Object.entries(qualityResult.quality || {})) {
      const score = evaluation.score || 0;
      const maxScore = evaluation.max_score || 0;
      totalScore += score;
      totalMaxScore += maxScore;
    }
    const callQualityScore = totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0;
    const callQualityRaw = `${totalScore}/${totalMaxScore}`;

    // 6. Run LEGACY coaching evaluation (backward compat)
    let coachingReport = null;
    try {
      const { params } = await qcEngine.getParametersForSource(effectiveSource);
      if (params.length > 0) {
        const coachingPrompt = qcEngine.buildCoachingPrompt(transcriptText, effectiveSource, params);
        const coachingSchema = qcEngine.getCoachingSchema(params);

        const coachingResponse = await qcEngine.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: coachingPrompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: coachingSchema,
            temperature: 0.15
          }
        });

        const coachingResult = JSON.parse(coachingResponse.text());
        coachingReport = coachingResult.coaching_report;
      }
    } catch (coachingErr) {
      console.error("Legacy coaching evaluation failed (non-fatal):", coachingErr.message);
    }

    // 7. Save results to calls table
    const updatePayload = {
      qc_status: 'evaluated',
      insights_data: insightsResult.insights,
      summary_data: insightsResult.summary,
      quality_data: qualityResult.quality,
      conversation_topics: insightsResult.insights?.conversation_topics || [],
      call_quality_score: callQualityScore,
      call_quality_raw: callQualityRaw,
      prospect_id: prospect_id || null,
      source: effectiveSource,
    };

    // Include legacy coaching data if available
    if (coachingReport) {
      updatePayload.qc_results = coachingReport.parameter_evaluations;
      updatePayload.coaching_report = coachingReport;
      updatePayload.overall_score = coachingReport.overall_score;
      updatePayload.overall_grade = coachingReport.overall_grade;
    }

    if (callIdToUpdate) {
      await supabase
        .from('calls')
        .update(updatePayload)
        .eq('id', callIdToUpdate);
    } else if (transcript) {
      // Create a new call row for direct transcript submissions
      const { data: newCall } = await supabase
        .from('calls')
        .insert({
          ...updatePayload,
          transcript: transcriptText,
          filename: `${effectiveSource}_transcript`,
          language: 'en',
          duration_sec: 0
        })
        .select('id')
        .single();

      if (newCall) callIdToUpdate = newCall.id;
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

      const leadUpdate = {
        intent_score: insightsResult.insights?.intent_score || null,
        intent_factors: [
          ...(insightsResult.insights?.high_intent_factors || []).map(f => ({ type: 'high', factor: f })),
          ...(insightsResult.insights?.low_intent_factors || []).map(f => ({ type: 'low', factor: f }))
        ],
        bant_insights: insightsResult.insights?.bant || null,
        data_capture: insightsResult.insights?.data_capture || null,
        journey_summary: insightsResult.summary?.journey_summary || null,
        next_process_step: insightsResult.next_steps?.[0]?.title || null,
        avg_call_quality_score: avgQualityScore,
        updated_at: new Date().toISOString()
      };

      // Check if lead exists
      const { data: existingLead } = await supabase.from('leads').select('id').eq('id', finalProspectId).maybeSingle();

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

    // 9. Push to LeadSquared
    if (finalProspectId && prospect_id) { // Only push if it was an actual LSQ prospect
      axios.post(`http://localhost:${process.env.PORT || 3000}/api/coaching/push_to_lsq`, {
        prospect_id: finalProspectId,
        coaching_report: coachingReport,
        source: effectiveSource
      }).catch(err => console.error("LSQ push failed:", err.message));
    }

    res.json({
      success: true,
      call_id: callIdToUpdate,
      coaching_report: coachingReport,
      insights: insightsResult.insights,
      summary: insightsResult.summary,
      next_steps: insightsResult.next_steps,
      quality: qualityResult.quality,
      call_quality_score: callQualityScore,
      call_quality_raw: callQualityRaw
    });
  } catch (err) {
    console.error("Evaluation Error:", err);
    res.status(500).json({ error: err.message });
  }
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
    
    // Fetch call counts separately to avoid missing foreign key errors
    const { data: callsData } = await supabase
      .from('calls')
      .select('prospect_id');
      
    const callCounts = {};
    if (callsData) {
      callsData.forEach(c => {
        if (!callCounts[c.prospect_id]) callCounts[c.prospect_id] = 0;
        callCounts[c.prospect_id]++;
      });
    }
    
    // Add call count for the dashboard
    const leadsWithCounts = leads.map(l => ({
      ...l,
      total_calls: callCounts[l.id] || 0
    }));
    
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
    // 0. Ensure the demo owner exists in qc_associates
    const ownerName = 'Siva Sandhiya';
    let ownerNumber = 'SIVA-001';
    
    // Check if she already exists to use her actual emp_number
    const { data: existingOwners } = await supabase
      .from('qc_associates')
      .select('emp_number')
      .ilike('emp_name', '%Siva Sandhiya%')
      .limit(1);
      
    if (existingOwners && existingOwners.length > 0) {
      ownerNumber = existingOwners[0].emp_number;
    } else {
      await supabase.from('qc_associates').upsert([{
        emp_number: ownerNumber,
        emp_name: ownerName,
        emp_tags: 'Demo',
        language: 'en'
      }], { onConflict: 'emp_number' });
    }

    // 1. Create High Intent Demo Lead
    const prospect_id_1 = uuidv4();
    const { error: lead1Err } = await supabase.from('leads').insert({
      id: prospect_id_1,
      name: 'Farhaan (Demo - High Intent)',
      phone: '+91 9876543210',
      intent_score: 81,
      avg_call_quality_score: 96,
      kalvium_funnel_stage: 'PAC Paid',
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
    
    // Create call for High Intent Lead
    const { error: call1Err } = await supabase.from('calls').insert({
      id: uuidv4(),
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

    // 2. Create Low Intent Demo Lead
    const prospect_id_2 = uuidv4();
    const { error: lead2Err } = await supabase.from('leads').insert({
      id: prospect_id_2,
      name: 'Aditya (Demo - Low Intent)',
      phone: '+91 9123456789',
      intent_score: 35,
      avg_call_quality_score: 55,
      kalvium_funnel_stage: 'Exam Registered',
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
    
    // Create call for Low Intent Lead
    const { error: call2Err } = await supabase.from('calls').insert({
      id: uuidv4(),
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

    res.json({ success: true, seeded_leads: [prospect_id_1, prospect_id_2] });
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

    const resultObj = JSON.parse(response.text());
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
    const { activity_id, resource_url, duration, type, prospect_id, emp_number, client_number, language } = req.body;

    if (!resource_url) {
      return res.status(400).json({ error: "No recording URL available for this activity" });
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

    if (report.suggested_script_lines && report.suggested_script_lines.length > 0) {
      activityNote += `💡 SUGGESTED RESPONSES:\n`;
      report.suggested_script_lines.forEach(sl => {
        activityNote += `• [${sl.situation}]: "${sl.suggested_response}"\n`;
      });
      activityNote += `\n`;
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
