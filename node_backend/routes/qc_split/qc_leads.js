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
//  LEADS CRUD & DEMO SEEDING
// ═══════════════════════════════════════════════════════════════


function resolveVisualTimeline(c, evaluation) {
  if (evaluation?.results?.visual_timeline) {
    return evaluation.results.visual_timeline;
  }
  if (c.insights_data?.visual_timeline) {
    return c.insights_data.visual_timeline;
  }
  if (c.source === 'google_meet') {
    const storageDir = path.join(__dirname, '..', '..', '..', 'storage');
    if (fs.existsSync(storageDir)) {
      const candidates = [
        path.join(storageDir, `${c.id}_timeline.json`),
        c.filename ? path.join(storageDir, `${c.filename}_timeline.json`) : null,
        c.filename ? path.join(storageDir, `${path.parse(c.filename).name}_timeline.json`) : null
      ].filter(Boolean);
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
        }
      }
    }
  }
  return null;
}

router.get('/leads', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = (page - 1) * limit;

    const { data: leads, error, count } = await supabase
      .from('leads')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;

    if (!leads || leads.length === 0) {
      res.set({
        'X-Total-Count': count || 0,
        'X-Page': page,
        'X-Limit': limit
      });
      return res.json([]);
    }

    const leadIds = leads.map(l => l.id);
    
    // Fetch ONLY calls for these paginated leads, NOT the entire calls table!
    const { data: callsData, error: callsError } = await supabase
      .from('calls')
      .select('*')
      .in('prospect_id', leadIds);

    if (callsError) console.error("Error fetching calls:", callsError);

    const callIds = (callsData || []).map(c => c.id);

    // Fetch ONLY latest evaluation runs for these calls, NOT the entire evaluation_runs table!
    let evalsData = [];
    if (callIds.length > 0) {
      const { data: evals, error: evalsError } = await supabase
        .from('evaluation_runs')
        .select('*')
        .in('call_id', callIds)
        .order('created_at', { ascending: false });

      if (evalsError) console.error("Error fetching evaluation_runs:", evalsError);
      evalsData = evals || [];
    }

    // Map latest evaluation to calls
    const evalMap = {};
    evalsData.forEach(e => {
      if (!evalMap[e.call_id]) evalMap[e.call_id] = e;
    });

    const callsByProspect = {};
    if (callsData) {
      callsData.forEach(c => {
        const evaluation = evalMap[c.id];
        if (evaluation && evaluation.results) {
           c.quality_data = evaluation.results.quality_data;
           c.insights_data = evaluation.results.insights_data;
           c.coaching_report = evaluation.results.coaching_report;
           c.summary_data = evaluation.results.summary_data;
           c.qc_results = evaluation.results.qc_results;
        }
        c.visual_timeline = resolveVisualTimeline(c, evaluation);

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
    
    res.set({
      'X-Total-Count': count || leadsWithCounts.length,
      'X-Page': page,
      'X-Limit': limit
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

    // Fetch evaluation_runs and enrich calls (matching GET /leads logic)
    const callIds = (calls || []).map(c => c.id);
    let evalMap = {};
    if (callIds.length > 0) {
      const { data: evalsData } = await supabase
        .from('evaluation_runs')
        .select('*')
        .in('call_id', callIds)
        .order('created_at', { ascending: false });

      if (evalsData) {
        evalsData.forEach(e => {
          if (!evalMap[e.call_id]) evalMap[e.call_id] = e;
        });
      }
    }

    const enrichedCalls = (calls || []).map(c => {
      const evaluation = evalMap[c.id];
      if (evaluation && evaluation.results) {
        c.quality_data = evaluation.results.quality_data;
        c.insights_data = evaluation.results.insights_data;
        c.coaching_report = evaluation.results.coaching_report;
        c.summary_data = evaluation.results.summary_data;
        c.qc_results = evaluation.results.qc_results;
      }
      c.visual_timeline = resolveVisualTimeline(c, evaluation);
      if (c.source === 'google_meet') {
        console.log(`[DEBUG] Call ${c.id}: eval exists=${!!evaluation}, eval.results.visual_timeline=${!!evaluation?.results?.visual_timeline}, c.insights_data.visual_timeline=${!!c.insights_data?.visual_timeline}, resolved=${!!c.visual_timeline}`);
      }
      return c;
    });

    lead.calls = enrichedCalls;
    // DEBUG: check if visual_timeline survived enrichment
    enrichedCalls.forEach(c => {
      if (c.source === 'google_meet') {
        console.log(`[DEBUG-RESPONSE] Call ${c.id}: visual_timeline=${!!c.visual_timeline}, keys=${c.visual_timeline ? Object.keys(c.visual_timeline) : 'N/A'}`);
      }
    });
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
    const response = await qcEngine.generateContentWithRetry({
      model: qcEngine.GEMINI_MODEL,
      contents: prompt,
      config: { responseMimeType: 'application/json', responseSchema, temperature: 0.2 }
    });

    const resultObj = qcEngine.safeParseGeminiJSON(response.text);
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


module.exports = router;
