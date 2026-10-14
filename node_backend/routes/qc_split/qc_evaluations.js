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

const FATAL_COMPLIANCE_PARAMETERS = [
  'Investment Shown to Become Partly Self-Funding',
  'Total Fee Improvised or Payment Terms Invented',
  'Non-Price Advantages Stacked Onto the Discounted Fee',
  'Advisor Collecting Money Directly',
  'Sensitive Credentials Spoken Aloud or Left On Screen',
  'Outlier Placement as Average'
];

// ═══════════════════════════════════════════════════════════════
//  EVALUATE CALL — Main endpoint (Summary + Insights + Quality)
// ═══════════════════════════════════════════════════════════════


router.post('/qc/evaluate_call', requireAuth, requireRole(['admin', 'ai_worker']), async (req, res) => {
  const { call_id, transcript, prospect_id, source, timeline } = req.body;

  if (!call_id && !transcript) {
    return res.status(400).json({ error: 'Either call_id or transcript is required' });
  }
  if (!qcEngine.ai) return res.status(500).json({ error: 'Gemini not configured' });

  let activeCallId = call_id;
  let effectiveSource = source || 'phone_call';

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
      let activeProspectId = prospect_id;
      let activeCallData = null;

    // 1. Get transcript and prospect_id from call if not provided directly
    if (call_id) {
      const { data: call, error: callError } = await supabase
        .from('calls')
        .select('*')
        .eq('id', call_id)
        .single();

      if (callError || !call) throw new Error('Call not found');
      activeCallData = call;

      if (!source && call.source) {
        effectiveSource = call.source;
      }

      if (!activeProspectId && call.prospect_id) {
        activeProspectId = call.prospect_id;
      }

      if (!transcript) {
        if (call.segments) {
          const segments = typeof call.segments === 'string' ? JSON.parse(call.segments) : call.segments;
          transcriptText = segments.map(s => `${s.speaker}: ${s.text_en || s.text}`).join('\n');
        } else if (call.transcript) {
          transcriptText = call.transcript;
        }
      }
    }

    if (!transcriptText) throw new Error('No transcript content available');

    // 2. Fetch dynamic configurations
    const [qualityChecks, dataCaptureQuestions, pastCalls, leadState] = await Promise.all([
      qcEngine.getQualityChecks(effectiveSource),
      qcEngine.getDataCaptureQuestions(effectiveSource),
      qcEngine.getPastCalls(activeProspectId, callIdToUpdate),
      qcEngine.getLeadState(activeProspectId),
    ]);

    // -- SMART TRIAGE ENGINE (T0 / T1 / T2) --
    const triage = qcEngine.triageCall(activeCallData || {}, transcriptText, pastCalls);

    if (triage.tier === 'T0') {
      // Auto-reject without burning any LLM tokens (Zero AI - ₹0.00)
      console.log(`🛑 [Triage] Call ${callIdToUpdate} rejected as T0: ${triage.reason}`);
      const t0Run = {
        call_id: callIdToUpdate,
        model_id: 'rule-engine-triage',
        input_snapshot: { source: effectiveSource, triage_reason: triage.reason, evaluation_tier: 'T0' },
        results: { call_quality_score: null, call_quality_raw: 'N/A (< 45s Non-Pitch)', reject_reason: triage.reason, tokens_saved: 28000, evaluation_tier: 'T0' }
      };
      await supabase.from('evaluation_runs').insert(t0Run);
      await supabase.from('calls').update({
        qc_status: 'rejected',
        call_quality_score: null,
        call_quality_raw: 'N/A (< 45s Non-Pitch)',
        summary_data: {
          call_summary: [`Call rejected by triage: ${triage.reason}`],
          key_points: ['Duration: < 45s or low interaction', 'Did not consume AI tokens'],
          main_takeaways: ['Non-pitch interaction']
        }
      }).eq('id', callIdToUpdate);
      return; // Abort processing cleanly without calling Gemini!
    }

    console.log(`⚡ [Triage] Call ${callIdToUpdate} routed to ${triage.tier} (${triage.sub_tier || 'DEEP'}): ${triage.reason}`);
    const isT1 = triage.tier === 'T1';

    // If there are no past calls, this is effectively the first call.
    // Wipe any existing journey summary from the state so the AI doesn't hallucinate deleted calls.
    if (leadState && pastCalls.length === 0) {
      leadState.journey_summary = null;
      leadState.call_history_snapshot = [];
    }

    // 2b. If video call, load visual timeline for multi-modal grounding
    // If not provided in body, try to recover from the previous run or load from file
    let videoTimeline = timeline || (activeCallData && activeCallData.insights_data && activeCallData.insights_data.visual_timeline) || null;
    if (!videoTimeline && effectiveSource === 'google_meet') {
      try {
        const storageDir = path.join(__dirname, '..', '..', '..', 'storage');
        const possibleNames = [
          `${callIdToUpdate}_timeline.json`,
          activeCallId ? `${activeCallId}_timeline.json` : null,
          activeCallData && activeCallData.filename ? `${activeCallData.filename}_timeline.json` : null
        ].filter(Boolean);
        for (const name of possibleNames) {
          const fullP = path.join(storageDir, name);
          if (fs.existsSync(fullP)) {
            videoTimeline = JSON.parse(fs.readFileSync(fullP, 'utf8'));
            console.log(`🎬 [Video QC] Ingested visual timeline from ${name}`);
            break;
          }
        }
      } catch (err) {
        console.warn(`[Video QC] Could not load timeline file: ${err.message}`);
      }
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
    let omniResponse = null;
    let activeCacheName = null;

    if (filteredQualityChecks.length > 0) {
      try {
        const { params } = await qcEngine.getParametersForSource(effectiveSource);
        if (params.length > 0) {
          // Check for active Gemini Context Cache (BD Playbook, Fees, Placements, Rules)
          activeCacheName = await qcEngine.getActiveCache(qcEngine.ai, qcEngine.GEMINI_MODEL);

          const omniSchema = isT1
            ? qcEngine.getLeanOmniSchema(dataCaptureQuestions, filteredQualityChecks, params, triage.sub_tier)
            : qcEngine.getOmniSchema(dataCaptureQuestions, filteredQualityChecks, params, effectiveSource);

          // Use lean dynamic prompt for T1; otherwise fallback to full dynamic omniPrompt
          const omniPrompt = isT1
            ? qcEngine.buildLeanDynamicOmniPrompt(
                transcriptText, effectiveSource, triage, pastCalls, leadState, filteredQualityChecks, params
              )
            : (activeCacheName
                ? qcEngine.buildDynamicOmniPrompt(
                    transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params, videoTimeline
                  )
                : qcEngine.buildOmniPrompt(
                    transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params, videoTimeline
                  )
              );

          const requestConfig = {
            responseMimeType: 'application/json',
            responseSchema: omniSchema,
            temperature: 0.15
          };
          if (activeCacheName) {
            requestConfig.cachedContent = activeCacheName;
          }

          omniResponse = await qcEngine.generateContentWithRetry({
            model: qcEngine.GEMINI_MODEL,
            contents: omniPrompt,
            config: requestConfig
          }, {
            reason: `QC Call Evaluation: ${activeCallId} (${triage.tier} - ${effectiveSource})`,
            caller: activeCallId,
            metadata: { call_id: activeCallId, tier: triage.tier, source: effectiveSource }
          });

          // Log token usage telemetry
          const usage = omniResponse?.usageMetadata;
          if (usage) {
            console.log(`⚡ [Gemini Token Telemetry] Total: ${usage.totalTokenCount} | Prompt: ${usage.promptTokenCount} | Cached Hit: ${usage.cachedContentTokenCount || 0} | Output: ${usage.candidatesTokenCount}`);
          }

          const omniResult = qcEngine.safeParseGeminiJSON(omniResponse.text);

          // Expand compact BANT into canonical { status, details } format for DB and lead synthesis
          if (omniResult.insights && omniResult.insights.bant) {
            omniResult.insights.bant = qcEngine.expandBant(omniResult.insights.bant);
          }

          // Populate missing mandatory data capture fields in Node.js
          if (omniResult.insights && omniResult.insights.data_capture) {
            omniResult.insights.data_capture = qcEngine.populateMissingDataCaptureFields(omniResult.insights.data_capture);
          }
          
          insightsResult = {
            insights: {
              ...(omniResult.insights || {}),
              call_type_tag: omniResult.call_type_tag || (isT1 ? (triage.sub_tier === 'T1_CONTINUATION' ? 'Pitch Continuation' : triage.sub_tier === 'T1_FORWARD' ? 'Call Forwarded / Callback Request' : 'Meeting Reminder') : 'Sales Call'),
              triage_tier: triage.sub_tier || triage.tier
            },
            summary: omniResult.summary,
            next_steps: omniResult.next_steps
          };
          combinedResult = omniResult;
          if (combinedResult.coaching_report?.category_scores) {
            combinedResult.coaching_report.category_scores = qcEngine.normalizeCategoryScores(combinedResult.coaching_report.category_scores);
          }
          
          // Convert quality array back to object keyed by parameter name (for DB storage compatibility)
          // DEFAULT: For T1 (Audit by Exception), assume unlisted parameters are Not Applicable so associates aren't penalized for unasked discovery. For T2, assume Failed unless evidence is found.
          const qualityObj = {};
          const paramNameLookup = new Map();

          filteredQualityChecks.forEach(check => {
            if (check.parameter) paramNameLookup.set(check.parameter, check.parameter);
            if (check.param_id) paramNameLookup.set(check.param_id, check.parameter);
            if (check.parameter) paramNameLookup.set(check.parameter.toLowerCase(), check.parameter);
            if (check.param_id) paramNameLookup.set(check.param_id.toLowerCase(), check.parameter);

            if (isT1) {
              qualityObj[check.parameter] = {
                score: 0,
                max_score: 0,
                status: 'Not Applicable',
                coaching_status: 'Not Applicable',
                reason: 'Not applicable for short/focused interaction',
                question: qcEngine.getParameterQuestion(check.parameter) || check.parameter,
                mark_fatal: false
              };
            } else {
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
                mark_fatal: FATAL_COMPLIANCE_PARAMETERS.includes(check.parameter)
              };
            }
          });

          if (Array.isArray(combinedResult.quality)) {
            const expandedQuality = qcEngine.expandQualityExceptions(combinedResult.quality, paramNameLookup);
            expandedQuality.forEach(item => {
              const matchedParam = item.parameter;
              const isNA = item.status === 'Not Applicable';
              const maxScore = isNA ? 0 : (item.max_score || (qualityObj[matchedParam] && qualityObj[matchedParam].max_score > 0 ? qualityObj[matchedParam].max_score : 2) || 2);

              qualityObj[matchedParam] = {
                score: isNA ? 0 : item.score,
                max_score: maxScore,
                status: item.status,
                coaching_status: isNA ? 'Not Applicable' : item.coaching_status,
                reason: item.reason || '',
                question: item.question || qcEngine.getParameterQuestion(matchedParam) || matchedParam,
                mark_fatal: FATAL_COMPLIANCE_PARAMETERS.includes(matchedParam)
              };
            });
          }
          
          // ── HARDCODED SAFETY NET: Internship Timing Claim Detection ──
          // The AI consistently fails to catch year-based internship claims in Tamil/Hindi.
          // This regex-based post-processor overrides the AI's score when a violation is found.
          const internshipParamName = 'Internships Described Without a Timing Claim';
          if (qualityObj[internshipParamName]) {
            const lowerTranscript = (transcriptText || '').toLowerCase();
            const internshipTimingPatterns = [
              // English patterns
              /(?:second|2nd|third|3rd|fourth|4th|first|1st)\s*year\s*(?:internship|intern)/i,
              /internship\s*(?:from|in|during|starts?\s*(?:from|in))\s*(?:second|2nd|third|3rd|first|1st|fourth|4th)\s*year/i,
              /(?:second|2nd|third|3rd)\s*year\s*(?:onwards?|onward)/i,
              // Tamil transliteration patterns (செகண்ட் இயர் = second year)
              /செகண்ட்\s*இயர்/,
              /ஃபர்ஸ்ட்\s*இயர்/,
              /தேர்ட்\s*இயர்/,
              /ஃபோர்த்\s*இயர்/,
              // Tamil + internship context
              /இன்டர்ன்ஷிப்[\s\S]{0,200}செகண்ட்\s*இயர்/,
              /செகண்ட்\s*இயர்[\s\S]{0,200}இன்டர்ன்ஷிப்/,
              // Hindi transliteration patterns
              /सेकंड\s*ईयर/,
              /इंटर्नशिप[\s\S]{0,200}सेकंड\s*ईयर/,
              /दूसर[ेा]\s*साल/,
              /तीसर[ेा]\s*साल/,
              // Mixed Hinglish/Tanglish
              /second\s*year[\s\S]{0,100}internship/i,
              /internship[\s\S]{0,100}second\s*year/i,
            ];
            const foundViolation = internshipTimingPatterns.some(pattern => pattern.test(transcriptText));
            if (foundViolation) {
              console.log(`🚨 [SAFETY NET] Internship timing claim detected in transcript! Forcing score to 0.`);
              qualityObj[internshipParamName] = {
                ...qualityObj[internshipParamName],
                score: 0,
                status: 'Needs Improvement',
                coaching_status: 'Fail',
                reason: '[AUTO-FLAGGED] Associate made a year-based internship timing claim (e.g. "second year"). This is a policy violation.'
              };
            }
          }

          // ── HARDCODED SAFETY NET: Placement & Salary Claims Detection (2026 Batch Ground Truth) ──
          const lowerTranscriptText = (transcriptText || '').toLowerCase();
          
          // 1. 100% Placement / Job Guarantee Safety Net (Canonical = 81.8% placed)
          const placementGuaranteePatterns = [
            /(?:100%|hundred\s*percent)\s*(?:placement|job|guarantee)/i,
            /(?:guaranteed?|pakka|assured)\s*(?:placement|job|package)/i,
            /(?:placement|job)\s*(?:guarantee|ki\s*guarantee|pakka|assured|100%)/i,
            /(?:har\s*(?:bachhe|bache|student)\s*ko\s*(?:job|placement)\s*mil(?:egi|ti|ta))/i,
            /(?:job|placement)\s*ki\s*guarantee/i,
            /(?:kandippa|pakka|sure[- ]?ah?)\s*(?:placement|job)/i
          ];
          if (placementGuaranteePatterns.some(p => p.test(lowerTranscriptText))) {
            console.log(`🚨 [SAFETY NET] 100% Placement guarantee detected in transcript! Flagging fatal breach.`);
            const targetParams = [
              'No invented placement/salary statistics outside script norms',
              'Outlier Placement as Average',
              'Unsupported or Inconsistent Figures',
              'All Figures Within the Approved Fact Sheet',
              'Placements Answered Honestly'
            ];
            targetParams.forEach(pName => {
              if (qualityObj[pName]) {
                qualityObj[pName] = {
                  ...qualityObj[pName],
                  score: 0,
                  status: 'Needs Improvement',
                  coaching_status: 'Fail',
                  mark_fatal: true,
                  reason: '[FATAL MIS-SELLING] Associate claimed 100% placement / job guarantee. Canonical 2026 data confirms 81.8% placed (90.4% interned). Guarantees are strictly prohibited.'
                };
              }
            });
          }

          // 2. Outlier Salary Package as Average / Inflated Salaries (> 36 LPA or 36 LPA as average)
          const outlierSalaryPatterns = [
            /(?:average|minimum|starting)\s*(?:package|salary)?[\s\S]{0,35}(?:36\s*lpa|36\s*lakh)/i,
            /(?:36\s*lpa|36\s*lakh)[\s\S]{0,35}(?:average|minimum|starting)/i,
            /(?:4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9]|100)\s*(?:lpa|lakhs?|lac|crore)/i,
            /(?:forty|fifty|sixty|seventy|eighty|ninety|crore)\s*(?:lpa|lakhs?)/i
          ];
          if (outlierSalaryPatterns.some(p => p.test(lowerTranscriptText))) {
            console.log(`🚨 [SAFETY NET] Outlier or unapproved salary package detected in transcript! Flagging breach.`);
            const targetSalaryParams = [
              'No invented placement/salary statistics outside script norms',
              'Outlier Placement as Average',
              'Unsupported or Inconsistent Figures'
            ];
            targetSalaryParams.forEach(pName => {
              if (qualityObj[pName]) {
                qualityObj[pName] = {
                  ...qualityObj[pName],
                  score: 0,
                  status: 'Needs Improvement',
                  coaching_status: 'Fail',
                  mark_fatal: true,
                  reason: '[FATAL PITCH DETECTED] Advisor quoted highest package (36 LPA) as average/minimum or cited unapproved salary > 36 LPA. Canonical 2026 median is 20 LPA.'
                };
              }
            });
          }

          // ── HARDCODED SAFETY NET: Video QC V3 Fatal Guardrail Detection ──
          if (effectiveSource === 'google_meet') {
            const lowerTranscript = (transcriptText || '').toLowerCase();

            // 1. FP-06: Self-Funding Claim
            const selfFundingParam = 'Investment Shown to Become Partly Self-Funding';
            if (qualityObj[selfFundingParam]) {
              const selfFundingPatterns = [
                /(?:self[- ]?fund(?:ing)?|partly\s+self[- ]funding)/i,
                /(?:internship|stipend)[\s\S]{0,40}(?:will\s+)?(?:pay|cover|recover)[\s\S]{0,30}(?:fees?|tuition|burden)/i,
                /(?:earn\s+and\s+pay|earn\s+while\s+you\s+learn[\s\S]{0,50}pay\s+fees)/i,
                /(?:fees?|tuition)[\s\S]{0,40}(?:nikal\s+jayegi|khud\s+hi\s+nikal|stipend\s+se\s+bhar)/i,
                /(?:fees?|tuition)[\s\S]{0,40}(?:stipend|internship)[\s\S]{0,40}(?:nikal|pay|cover|bhar)/i,
                /(?:stipend|internship)[\s\S]{0,40}(?:fees?|tuition)[\s\S]{0,40}(?:nikal|pay|cover|bhar)/i,
                /(?:degree|programme)\s+pays\s+for\s+itself/i
              ];
              if (selfFundingPatterns.some(p => p.test(lowerTranscript))) {
                console.log(`🚨 [SAFETY NET] FP-06 Self-funding claim detected! Triggering fatal breach.`);
                qualityObj[selfFundingParam] = {
                  ...qualityObj[selfFundingParam],
                  score: 0,
                  status: 'Needs Improvement',
                  coaching_status: 'Fail',
                  mark_fatal: true,
                  reason: '[FATAL PITCH DETECTED] Advisor claimed internships/stipends will pay for college fees. This is a fatal compliance violation.'
                };
              }
            }

            // 2. LC-12: Advisor Collecting Money Directly
            const directPayParam = 'Advisor Collecting Money Directly';
            if (qualityObj[directPayParam]) {
              const directPayPatterns = [
                /(?:send|transfer|gpay|phonepe|paytm|upi|pay)[\s\S]{0,50}(?:to\s+)?(?:me\b|my\s+(?:number|account|upi|id|gpay|phone)|personal)/i,
                /(?:mere\s+(?:number|account|upi|id|phone|gpay|qr)\s+(?:pe|par)\s+(?:bhej|dal|kar|transfer|pay|bhejo|daalo))/i,
                /(?:give\s+(?:me|cash)\s+(?:directly|instead))/i,
                /(?:direct\s+(?:mujhe|mere)\s+(?:pay|transfer|bhej))/i
              ];
              if (directPayPatterns.some(p => p.test(lowerTranscript))) {
                console.log(`🚨 [SAFETY NET] LC-12 Direct payment solicitation detected! Triggering fatal breach.`);
                qualityObj[directPayParam] = {
                  ...qualityObj[directPayParam],
                  score: 0,
                  status: 'Needs Improvement',
                  coaching_status: 'Fail',
                  mark_fatal: true,
                  reason: '[FATAL FRAUD DETECTED] Advisor requested direct money transfer/UPI to personal account instead of official portal.'
                };
              }
            }

            // 3. LC-11: Sensitive Credentials Spoken/Exposed
            const credsParam = 'Sensitive Credentials Spoken Aloud or Left On Screen';
            if (qualityObj[credsParam]) {
              const credPatterns = [
                /(?:share|tell|give|enter)\s+(?:me\s+)?(?:the\s+)?(?:otp|one[- ]time[- ]password|pin|aadhaar|aadhar)\b/i,
                /(?:otp\s+(?:batao|bataiye|share\s+karo|bhej\s+do|ayega\s+wo\s+batao|bhejiye))/i
              ];
              if (credPatterns.some(p => p.test(lowerTranscript))) {
                console.log(`🚨 [SAFETY NET] LC-11 Sensitive credentials exposed! Flagging critical security breach.`);
                qualityObj[credsParam] = {
                  ...qualityObj[credsParam],
                  score: 0,
                  status: 'Needs Improvement',
                  coaching_status: 'Fail',
                  mark_fatal: true,
                  reason: '[CRITICAL SECURITY BREACH] Advisor requested or verbally handled sensitive credentials (OTP/PIN/Aadhaar).'
                };
              }
            }

            // 4. Mark known critical guardrails as mark_fatal
            const FATAL_PARAM_NAMES = [
              'Investment Shown to Become Partly Self-Funding',
              'Total Fee Improvised or Payment Terms Invented',
              'Non-Price Advantages Stacked Onto the Discounted Fee',
              'Advisor Collecting Money Directly',
              'Sensitive Credentials Spoken Aloud or Left On Screen',
              'Outlier Placement as Average'
            ];
            FATAL_PARAM_NAMES.forEach(fpName => {
              if (qualityObj[fpName]) {
                qualityObj[fpName].mark_fatal = true;
              }
            });
          }

          qualityResult = { quality: qualityObj };
          coachingReport = combinedResult.coaching_report || null;
        } else {
          // No coaching params yet — fall back to quality-only pass
          // MUST run insights manually first!
          const insightsSchema = qcEngine.getInsightsSchema(dataCaptureQuestions, effectiveSource);
          const insightsPrompt = qcEngine.buildInsightsPrompt(transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState);
          const insightsResponse = await qcEngine.generateContentWithRetry({
            model: qcEngine.GEMINI_MODEL,
            contents: insightsPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: insightsSchema,
              temperature: 0.15
            }
          });
          insightsResult = qcEngine.safeParseGeminiJSON(insightsResponse.text);
          if (insightsResult.insights && insightsResult.insights.bant) {
            insightsResult.insights.bant = qcEngine.expandBant(insightsResult.insights.bant);
          }
          if (insightsResult.insights && insightsResult.insights.data_capture) {
            insightsResult.insights.data_capture = qcEngine.populateMissingDataCaptureFields(insightsResult.insights.data_capture);
          }

          const qualitySchema = qcEngine.getQualitySchema(filteredQualityChecks);
          const qualityPrompt = qcEngine.buildQualityPrompt(transcriptText, effectiveSource, filteredQualityChecks);
          const qualityResponse = await qcEngine.generateContentWithRetry({
            model: qcEngine.GEMINI_MODEL,
            contents: qualityPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: qualitySchema,
              temperature: 0.15
            }
          });
          const rawResult = qcEngine.safeParseGeminiJSON(qualityResponse.text);
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
      const insightsSchema = qcEngine.getInsightsSchema(dataCaptureQuestions, effectiveSource);
      const insightsPrompt = qcEngine.buildInsightsPrompt(transcriptText, effectiveSource, dataCaptureQuestions, pastCalls, leadState);

      const insightsResponse = await qcEngine.generateContentWithRetry({
        model: qcEngine.GEMINI_MODEL,
        contents: insightsPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: insightsSchema,
          temperature: 0.15
        }
      });
      insightsResult = qcEngine.safeParseGeminiJSON(insightsResponse.text);
      if (insightsResult.insights && insightsResult.insights.bant) {
        insightsResult.insights.bant = qcEngine.expandBant(insightsResult.insights.bant);
      }
      if (insightsResult.insights && insightsResult.insights.data_capture) {
        insightsResult.insights.data_capture = qcEngine.populateMissingDataCaptureFields(insightsResult.insights.data_capture);
      }
    }

    // 5. Compute overall quality score from merged result
    let totalScore = 0;
    let totalMaxScore = 0;
    let hasFatalBreach = false;
    const fatalBreaches = [];

    // Category weighting definitions for Video QC V3
    const VIDEO_V3_CATEGORY_WEIGHTS = {
      'Discovery & Multi-Stakeholder Engagement': 0.25,
      'Curriculum Pitch & Visual Proof': 0.15,
      'KNET Positioning & Fear Removal': 0.15,
      'Financial Presentation & ROI Framing': 0.20,
      'Live Closing & Frictionless Registration': 0.25
    };

    // Category weighting definitions for Phone QC V3 (From qc_parameters_phone_v3.csv)
    const PHONE_V3_CATEGORY_WEIGHTS = {
      'Discovery & Probing': 0.20,
      'Value Pitch & Kalvium Differentiators': 0.10,
      'Objection Handling & De-escalation': 0.15,
      'Intent Signals & Parental Buy-in': 0.30,
      'Call Control, Tonality & Next Steps': 0.25
    };

    const categoryPoints = {};

    for (const [paramName, evaluation] of Object.entries(qualityResult.quality || {})) {
      if (evaluation.status !== 'Not Applicable') {
        const checkDef = filteredQualityChecks.find(c => c.parameter === paramName || c.param_id === paramName);
        const cat = checkDef?.category || evaluation.category || 'Other';
        if (!categoryPoints[cat]) categoryPoints[cat] = { score: 0, maxScore: 0 };
        categoryPoints[cat].score += (evaluation.score || 0);
        categoryPoints[cat].maxScore += (evaluation.max_score || 0);

        totalScore += evaluation.score || 0;
        totalMaxScore += evaluation.max_score || 0;

        if (evaluation.mark_fatal && evaluation.score === 0 && FATAL_COMPLIANCE_PARAMETERS.includes(paramName)) {
          hasFatalBreach = true;
          fatalBreaches.push({
            parameter: paramName,
            reason: evaluation.reason || 'Fatal pitch breach confirmed'
          });
        }
      }
    }

    let callQualityScore = 0;
    let callQualityRaw = '';

    const weights = effectiveSource === 'google_meet' ? VIDEO_V3_CATEGORY_WEIGHTS : PHONE_V3_CATEGORY_WEIGHTS;
    let weightedTotal = 0;
    let totalWeightApplied = 0;
    let categoriesCalculated = 0;

    for (const [catName, weight] of Object.entries(weights)) {
      const catData = categoryPoints[catName];
      if (catData && catData.maxScore > 0) {
        const catPct = (catData.score / catData.maxScore) * 100;
        weightedTotal += (catPct * weight);
        totalWeightApplied += weight;
        categoriesCalculated++;
      }
    }

    if (isT1 && totalMaxScore === 0 && !hasFatalBreach) {
      callQualityScore = 100;
      callQualityRaw = 'N/A (Clean Short Call)';
    } else {
      callQualityScore = totalWeightApplied > 0
        ? Math.round(weightedTotal / totalWeightApplied)
        : (totalMaxScore > 0 ? Math.round((totalScore / totalMaxScore) * 100) : 0);
      callQualityRaw = `${totalScore}/${totalMaxScore} (${callQualityScore}% weighted)`;
    }

    if (hasFatalBreach) {
      const breachList = fatalBreaches.map(b => b.parameter).join(', ');
      callQualityRaw += ` [FAKE PITCH DETECTED: ${breachList}]`;
      console.log(`[FAKE PITCH DETECTED] Call ${callIdToUpdate} failed fatally due to: ${breachList}`);
    }

    // 7. Save results to evaluation_runs (IMMUTABLE HISTORY) instead of mutating calls
    const resultsPayload = {
      insights_data: insightsResult.insights,
      summary_data: insightsResult.summary,
      quality_data: qualityResult.quality,
      conversation_topics: insightsResult.insights?.conversation_topics || [],
      call_quality_score: callQualityScore,
      call_quality_raw: callQualityRaw,
      fatal_pitch_flag: hasFatalBreach,
      fatal_pitch_breaches: fatalBreaches,
      visual_timeline: videoTimeline || null
    };

    if (coachingReport) {
      if (hasFatalBreach) {
        coachingReport.overall_score = 0;
        coachingReport.overall_grade = 'F';
      } else {
        coachingReport.overall_score = callQualityScore;
        coachingReport.overall_grade = callQualityScore >= 90 ? 'A' : callQualityScore >= 75 ? 'B' : callQualityScore >= 60 ? 'C' : callQualityScore >= 40 ? 'D' : 'F';
      }
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
      resultsPayload.overall_score = hasFatalBreach ? 0 : coachingReport.overall_score;
      resultsPayload.overall_grade = hasFatalBreach ? 'F' : coachingReport.overall_grade;
    }



    if (callIdToUpdate) {
      // Create immutable evaluation run record
      resultsPayload.evaluation_tier = triage?.sub_tier || triage?.tier || 'T2';
      await supabase
        .from('evaluation_runs')
        .insert({
          call_id: callIdToUpdate,
          model_id: qcEngine.GEMINI_MODEL,
          input_snapshot: {
            transcript_length: transcriptText.length,
            source: effectiveSource,
            token_usage: omniResponse?.usageMetadata || null,
            cached_context: Boolean(activeCacheName),
            triage_reason: triage?.reason || null,
            evaluation_tier: triage?.sub_tier || triage?.tier || 'T2'
          },
          results: resultsPayload
        });
    }

    // 8. Update leads table with latest prospect state
    let finalProspectId = activeProspectId;

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
      const defaultFields = (dataCaptureQuestions || []).map(q => q.label || q.question || q.field).filter(Boolean);
      const allMissingFields = [
        ...(existingCapture.missing_mandatory_fields || []),
        ...(newCapture.missing_mandatory_fields || defaultFields)
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
        call_date: activeCallData?.call_date || null,
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
        .update({
          qc_status: hasFatalBreach ? 'fatal_audit_failure' : 'evaluated',
          call_quality_score: callQualityScore,
          call_quality_raw: callQualityRaw,
          quality_data: qualityResult.quality,
          summary_data: insightsResult.summary,
          insights_data: { ...(insightsResult.insights || {}), visual_timeline: videoTimeline || null },
          coaching_report: coachingReport
        })
        .eq('id', callIdToUpdate);
    }

    // ── TRIGGER HOLISTIC JOURNEY SYNTHESIS ──
    if (finalProspectId) {
      // We don't await this so it runs asynchronously in the background
      qcEngine.evaluateLeadJourney(finalProspectId);
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
    const { prospect_id, phone, name, emp_number, lead_name, lead_source, language } = req.body;

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

    // 2. Fetch recording MP4 link from Google Drive via internal loopback with worker auth
    const port = process.env.PORT || 3000;
    const workerToken = process.env.INTERNAL_WORKER_SECRET;
    const loopbackConfig = workerToken ? { headers: { Authorization: `Bearer ${workerToken}` }, timeout: 15000 } : { timeout: 15000 };

    const driveParams = new URLSearchParams();
    if (phone) driveParams.append('phone', phone);
    if (name) driveParams.append('name', name);

    const driveRes = await axios.get(`http://localhost:${port}/api/drive/recording?${driveParams.toString()}`, loopbackConfig);
    const driveLink = driveRes.data?.webViewLink;

    if (!driveLink) {
      return res.status(404).json({ error: 'Video Recording not found in Google Drive.' });
    }

    // 3. Queue the video demo into the new ASR pipeline!
    const queueRes = await axios.post(`http://localhost:${port}/api/upload_drive_demo`, {
      drive_link: driveLink,
      language: language || 'hi', 
      prospect_id: prospect_id
    }, loopbackConfig);

    console.log(`🎥 [Demo QC] Google Meet video queued for ASR pipeline. Prospect: ${prospect_id}, Queue ID: ${queueRes.data?.queue_id}`);
    res.json({ success: true, status: 'queued_for_asr', queue_id: queueRes.data?.queue_id });
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

// ═══════════════════════════════════════════════════════════════
//  DASHBOARD AGGREGATE KPIS
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard_kpis', async (req, res) => {
  try {
    // 1. Active associates count (lightweight head query)
    const { count: associatesCount } = await supabase
      .from('qc_associates')
      .select('*', { count: 'exact', head: true });

    // 2. Total lifetime calls count (zero row memory payload via PostgREST head query)
    const { count: totalCallsCount } = await supabase
      .from('calls')
      .select('*', { count: 'exact', head: true });

    // 3. Aggregate performance stats from calls
    const { data: calls, error: callsErr } = await supabase
      .from('calls')
      .select('call_quality_score, talk_to_listen_ratio');

    if (callsErr) throw callsErr;

    const totalCalls = totalCallsCount || (calls || []).length;
    
    // Average QC Score
    const scoredCalls = (calls || []).filter(c => c.call_quality_score != null && !isNaN(c.call_quality_score));
    const avgScore = scoredCalls.length > 0
      ? Math.round(scoredCalls.reduce((sum, c) => sum + Number(c.call_quality_score), 0) / scoredCalls.length)
      : null;

    // Average Talk:Listen
    let totalAgentPct = 0;
    let ratioCount = 0;
    (calls || []).forEach(c => {
      if (c.talk_to_listen_ratio && typeof c.talk_to_listen_ratio === 'string' && c.talk_to_listen_ratio.includes(':')) {
        const [agent, customer] = c.talk_to_listen_ratio.split(':').map(Number);
        if (!isNaN(agent) && !isNaN(customer) && (agent + customer) > 0) {
          totalAgentPct += agent;
          ratioCount++;
        }
      }
    });
    const avgTalkListen = ratioCount > 0
      ? `${Math.round(totalAgentPct / ratioCount)}:${100 - Math.round(totalAgentPct / ratioCount)}`
      : '50:50';

    // Calls analyzed today (from callizer_queue which possesses created_at timestamp)
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const { count: callsTodayCount } = await supabase
      .from('callizer_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('created_at', startOfToday.toISOString());
    const callsToday = callsTodayCount || 0;

    res.json({
      active_associates: associatesCount || 0,
      avg_qc_score: avgScore != null ? avgScore : 0,
      avg_talk_listen: avgTalkListen,
      calls_today: callsToday,
      total_calls: totalCalls
    });
  } catch (err) {
    console.error('Error fetching dashboard KPIs:', err.message);
    res.status(500).json({ error: 'Failed to calculate dashboard KPIs' });
  }
});

module.exports = router;
