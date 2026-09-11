const express = require('express');
const router = express.Router();
const axios = require('axios');
const supabase = require('../config/supabase');
const qcEngine = require('../services/qc_engine');
const meetSync = require('../services/meet_sync');
const { lsqParams } = require('../config/lsq');
const { v4: uuidv4 } = require('uuid');

router.post('/qc/evaluate_call', async (req, res) => {
  const { call_id, transcript, prospect_id, source } = req.body;

  if (!call_id && !transcript) {
    return res.status(400).json({ error: 'Either call_id or transcript is required' });
  }
  if (!qcEngine.ai) return res.status(500).json({ error: 'Gemini not configured' });

  try {
    let transcriptText = transcript;
    let callIdToUpdate = call_id;

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

    const effectiveSource = source || 'phone_call';
    const { params } = await qcEngine.getParametersForSource(effectiveSource);

    if (params.length === 0) throw new Error(`No parameters loaded for source: ${effectiveSource}`);

    const prompt = qcEngine.buildCoachingPrompt(transcriptText, effectiveSource, params);
    const responseSchema = qcEngine.getCoachingSchema(params);

    const response = await qcEngine.ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: responseSchema,
        temperature: 0.15
      }
    });

    const resultObj = JSON.parse(response.text());
    const report = resultObj.coaching_report;

    if (callIdToUpdate) {
      await supabase
        .from('calls')
        .update({
          qc_status: 'evaluated',
          qc_results: report.parameter_evaluations,
          coaching_report: report,
          overall_score: report.overall_score,
          overall_grade: report.overall_grade,
          prospect_id: prospect_id || null,
          source: effectiveSource
        })
        .eq('id', callIdToUpdate);
    } else if (transcript) {
      const { data: newCall } = await supabase
        .from('calls')
        .insert({
          transcript: transcriptText,
          qc_status: 'evaluated',
          qc_results: report.parameter_evaluations,
          coaching_report: report,
          overall_score: report.overall_score,
          overall_grade: report.overall_grade,
          prospect_id: prospect_id || null,
          source: effectiveSource,
          filename: `${effectiveSource}_transcript`,
          language: 'en',
          duration_sec: 0
        })
        .select('id')
        .single();

      if (newCall) callIdToUpdate = newCall.id;
    }

    if (prospect_id) {
      axios.post(`http://localhost:${process.env.PORT || 3000}/api/coaching/push_to_lsq`, {
        prospect_id,
        coaching_report: report,
        source: effectiveSource
      }).catch(err => console.error("LSQ push failed:", err.message));
    }

    res.json({ success: true, call_id: callIdToUpdate, coaching_report: report });
  } catch (err) {
    console.error("Coaching Evaluation Error:", err);
    res.status(500).json({ error: err.message });
  }
});

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

    // axios.post(`http://localhost:8000/api/process_audio`, { queue_id }).catch(err => {
    //   console.error("Failed to notify python worker:", err.message);
    // });

    res.json({ status: "queued", queue_id });
  } catch (err) {
    console.error("Push to QC error:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/meet_sync/trigger', async (req, res) => {
  try {
    const results = await meetSync.triggerManualSync();
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
