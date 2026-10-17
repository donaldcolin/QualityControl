const { getInsightsSchema, getQualitySchema, getCombinedQualityCoachingSchema } = require('./schemas');
const { universityFeeKB, bdPlaybook, placementData } = require('./index');
const _staticPromptCache = new Map();

function getKalviumContext(source, leadState = null) {
  const base = source === 'google_meet'
    ? 'a product demonstration meeting via Google Meet'
    : 'a university admissions sales counselling phone call';

  let ctx = `${base} for Kalvium. 
Kalvium is a higher-education startup offering a Work-Integrated Computer Science Engineering degree. Key features include hands-on practical learning, structured internships, and an aptitude-based entrance exam called K-NET (we do not require JEE/NEET).

CRITICAL SALES CYCLE RULES (AY 2027):
1. FIRST PHONE CALL: The goal is NEVER to ask for registration or payment. The ONLY goal is to build interest and invite the student and at least one parent to attend a 1-on-1 Google Meet demo.
2. GOOGLE MEET DEMO: During the video call, the counselor discusses the exam details and pushes for K-NET Exam Registration.
3. EXAM: The student writes the K-NET exam after 2 months.
4. INTERVIEW: If they pass the exam, they attend an interview (they only get ONE chance).
5. PROVISIONAL ADMISSION: If they pass the interview, they pay 10% of the total university fees to secure provisional admission.

You must judge the associate based on where they are in this cycle.`;

  if (source !== 'google_meet') {
    ctx += `\n\nEXPECTED CALL STRUCTURE (1:1 COUNSELLING BOOKING CALL - 10 STAGES):
1. Warm Opening: Establish context, ask about 12th Std stream (note: in Tamil Nadu / South India, "Bio-Maths" is PCMB and "Computer Science" is PCMC — both include Physics, Chemistry & Maths and qualify for B.Tech CSE), and check if they know Kalvium.
2. Probing and Aligning: Understand their current college search status, post-12th plans, and learning style (practical vs theory).
3. Understand Student + Parent Priorities: Go past generic priorities and surface internal conflicts.
4. Introduce Kalvium Based on Answers: Create curiosity about the gap in the current education market before introducing Kalvium.
5. Why connect early?: Frame KNET as a parallel pathway and timing advantage.
6. Create Need for 1:1 Counselling: De-sell it; explain it's not a webinar and it's to gather info.
7. University Structure (If asked): Student indicates preferred location/state; mentioning genuine partner universities as examples is completely permitted and encouraged as context.
8. Book the Counselling: Secure the decision-maker (at least one parent). Use the "information decay" argument. Offer TWO specific slots.
9. Close: Lock commitment, send WhatsApp, set up logistics.
10. Registration Assist (post-session if applicable): Navigating portals and anti-fraud warnings.
Evaluate the associate's adherence to this 10-stage flow.`;
  }

  if (leadState) {
    ctx += `\n\nCURRENT LEAD STATUS & HISTORY:`;
    if (leadState.kalvium_funnel_stage) ctx += `\n- Funnel Stage: ${leadState.kalvium_funnel_stage}`;
    if (leadState.next_process_step) ctx += `\n- Next Scheduled Activity: ${leadState.next_process_step}`;
    if (leadState.journey_summary) ctx += `\n- CRM Journey Summary (Past Calls): ${leadState.journey_summary}`;

    ctx += `\n\nIMPORTANT: The CRM "Lead Stage" might statically say "New Lead", so you MUST rely on the Funnel Stage, Next Activity, and Journey Summary above to determine where they actually are in the sales cycle. Do NOT penalize the associate for skipping introductory steps if the Journey Summary proves the customer already completed them!`;
  }

  if (universityFeeKB) {
    ctx += `\n\n--- GROUND TRUTH KNOWLEDGE BASE: UNIVERSITY FEE STRUCTURE ---\nWhen verifying Fee, Pricing, or Scholarship claims (e.g. FP-10 Total Fee Improvised or FP-08 Scholarship Limits), YOU MUST cross-reference the numbers quoted by the counselor against the following official data. If the counselor's numbers match this official CSV, DO NOT flag it as an improvised fee or mis-selling. Only flag if it contradicts this data.\n\n${universityFeeKB}\n-----------------------------------------------------------`;
  }

  if (placementData) {
    ctx += `\n\n--- GROUND TRUTH KNOWLEDGE BASE: 2026 PLACEMENT METRICS & COMPLIANCE RULES ---\nWhen verifying Placement, Salary, Package, or Internship claims (e.g. FP-17 Outlier Placement as Average, VP-10 Unsupported Figures, or any placement guarantees), YOU MUST cross-reference the numbers quoted by the counselor against the following official data.\n\n${placementData}\n--------------------------------------------------------------------------------`;
  }

  return ctx;
}

function sanitizeKey(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')    // Replace non-alphanumeric with _
    .replace(/^_+|_+$/g, '')         // Trim leading/trailing underscores
    .replace(/_+/g, '_')             // Collapse consecutive underscores
    || 'param';                      // Fallback
}

function groupByCategory(parameters) {
  const groups = {};
  parameters.forEach(p => {
    const cat = p.Category || 'Other';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  });
  return groups;
}

function formatVisualTimeline(videoTimeline) {
  if (!videoTimeline) return '';

  let tl = videoTimeline;
  if (typeof tl === 'string') {
    try {
      tl = JSON.parse(tl);
    } catch (e) {
      return '';
    }
  }

  let out = `=== VIDEO VISUAL TIMELINE & COMPUTER VISION GROUND TRUTH ===\n`;

  // 1. Facial & Webcam Analytics
  if (tl.facial_analytics) {
    const fa = tl.facial_analytics;
    const pct = v => (v != null ? `${Number(v).toFixed(1)}%` : null);
    out += `Webcam Presence (from the Meet tile name labels; the on-screen tile follows the active speaker):\n`;
    if (fa.associate_camera_active_pct != null) {
      const passed = fa.trust_metric_passed ? 'PASSED (>=50%)' : 'FAILED (<50%)';
      out += `- Advisor camera ON ${pct(fa.associate_camera_active_pct)} of the time the advisor's tile was on screen (tile visible ${pct(fa.associate_visible_pct)} of the call) — ${passed}\n`;
    } else {
      out += `- Advisor camera: NOT MEASURABLE (advisor's tile never shown in the recording). Do not penalise or credit camera usage.\n`;
    }
    if (fa.customer_camera_active_pct != null) {
      out += `- Customer camera ON ${pct(fa.customer_camera_active_pct)} of the time their tile was on screen; up to ${fa.max_people_on_customer_camera || 0} people visible on the customer's camera\n`;
    }
    out += '\n';
  }

  // 1b. Camera Timeline (Sensor Fusion)
  if (Array.isArray(tl.face_timeline) && tl.face_timeline.length > 0) {
    out += `Camera Timeline (Extracted from Video frames):\n`;
    tl.face_timeline.forEach(event => {
      const s = Math.floor(event.start_time / 60) + ':' + ('0' + (event.start_time % 60)).slice(-2);
      const e = Math.floor(event.end_time / 60) + ':' + ('0' + (event.end_time % 60)).slice(-2);
      const who = event.owner === 'associate' ? 'Advisor' : event.owner === 'customer' ? 'Customer' : 'Unknown participant';
      const cam = event.camera_on === false ? 'camera OFF' : `camera ON, ${event.faces_detected} face(s)`;
      out += event.owner !== undefined
        ? `  • [${s} - ${e}] -> ${who} on screen, ${cam}\n`
        : `  • [${s} - ${e}] -> ${event.faces_detected} Faces Detected in Video Feed\n`; // timelines made before owner tracking
    });
    out += '\n';
  }

  // 2. Presentation & Slide Analytics
  if (Array.isArray(tl.slides)) {
    const shownSlides = tl.slides.filter(s => s.is_shown || (s.total_duration_seconds && s.total_duration_seconds > 0));
    
    out += `Presentation & Screen Sharing Activity:\n`;
    out += `- Total Slides Presented: ${shownSlides.length} slides\n`;

    if (shownSlides.length > 0) {
      out += `Active Slides Detected by Computer Vision:\n`;
      shownSlides.forEach(s => {
        const title = s.title || `Slide ${s.slide_number}`;
        const dur = s.total_duration_seconds ? `${s.total_duration_seconds}s` : '0s';
        const intervals = Array.isArray(s.intervals_formatted) && s.intervals_formatted.length > 0
          ? s.intervals_formatted.join(', ')
          : (Array.isArray(s.intervals_raw) && s.intervals_raw.length > 0
              ? s.intervals_raw.map(r => `${Math.floor(r.start_sec / 60)}:${('0' + (r.start_sec % 60)).slice(-2)} to ${Math.floor(r.end_sec / 60)}:${('0' + (r.end_sec % 60)).slice(-2)}`).join(', ')
              : 'N/A');
        const rushed = s.rushed_warning ? ' [⚠️ RUSHED SLIDE]' : '';
        out += `  • Slide ${s.slide_number}: "${title}" | Time: ${intervals} (${dur})${rushed}\n`;
      });
    } else {
      out += `- No presentation slides detected during this meeting.\n`;
    }
    out += '\n';
  }

  out += `CRITICAL MULTI-MODAL AUDITING RULES FOR VIDEO DEMOS:\n`;
  out += `1. When evaluating visually-dependent parameters (e.g. VP-02, VP-03, VP-04, LC-08):\n`;
  out += `   - Cross-reference transcript timestamps against the exact active slide numbers and intervals above.\n`;
  out += `   - If a slide was NEVER shown according to the Computer Vision timeline, do NOT credit the associate for visual demonstration.\n`;
  out += `   - If the parameter requires the family to read from the screen (VP-04), verify that the quote corresponds with the slide active at that timestamp.\n`;
  out += `   - Your 'reason' field MUST state the visual proof (e.g. [Visual: Slide 21 "Placements" active at 14:32]).\n`;
  out += `2. For webcam parameters (DA-01): verify that advisor camera was active.\n`;

  return out;
}

function buildInsightsPrompt(transcript, source, dataCaptureQuestions, pastCalls, leadState, videoTimeline = null) {
  const role = source === 'google_meet' ? 'Expert Video Demo Analyst' : 'Expert Sales Call Analyst';
  const context = getKalviumContext(source, leadState);
  const callNumber = (pastCalls?.length || 0) + 1;

  let prompt = `You are an ${role}. You are analyzing ${context}.\n\n`;

  // ── Multi-call awareness header ──────────────────────────────────────
  if (callNumber > 1) {
    prompt += `⚠️ CRITICAL: This is CALL #${callNumber} for this prospect. You have ${pastCalls.length} previous call(s) below.\n`;
    prompt += `You MUST analyze this call IN CONTEXT of the full journey. A short follow-up call does NOT mean low intent — it may be a scheduling call or status check.\n`;
    prompt += `Your INTENT SCORE must reflect the CUMULATIVE journey, not just this single call.\n\n`;
  }

  // ── Inject rich past call context ────────────────────────────────────
  if (pastCalls && pastCalls.length > 0) {
    prompt += `=== PREVIOUS CALLS FOR THIS PROSPECT (${pastCalls.length} calls) ===\n`;
    pastCalls.forEach((pc, i) => {
      const summary = pc.summary_data ? (typeof pc.summary_data === 'string' ? JSON.parse(pc.summary_data) : pc.summary_data) : null;
      const insights = pc.insights_data ? (typeof pc.insights_data === 'string' ? JSON.parse(pc.insights_data) : pc.insights_data) : null;
      prompt += `--- Call ${i + 1} (${pc.source || 'phone_call'}, ${pc.duration_sec ? Math.round(pc.duration_sec / 60) + ' min' : 'unknown duration'}) ---\n`;
      if (summary && summary.call_summary) {
        prompt += `Summary: ${summary.call_summary.join(' | ')}\n`;
      }
      if (summary && summary.key_points) {
        prompt += `Key Points: ${summary.key_points.join(' | ')}\n`;
      }
      if (insights) {
        if (insights.intent_score != null) prompt += `Intent Score: ${insights.intent_score}/100\n`;
        if (insights.objections && insights.objections.length > 0) {
          prompt += `Objections Raised: ${insights.objections.map(o => `${o.category}: "${o.objection}" (${o.customer_satisfied ? 'resolved' : 'unresolved'})`).join('; ')}\n`;
        }
      }
      if (pc.call_quality_score != null) {
        prompt += `Call Quality: ${pc.call_quality_score}/100\n`;
      }
      prompt += '\n';
    });
  }

  // ── Inject existing lead state (accumulated data from all prior calls) ──
  if (leadState) {
    if (leadState.journey_summary) {
      prompt += `=== PREVIOUS JOURNEY SUMMARY (accumulated across all prior calls) ===\n${leadState.journey_summary}\n\n`;
    }
    if (leadState.intent_score != null) {
      prompt += `=== CURRENT LEAD INTENT SCORE: ${leadState.intent_score}/100 ===\n\n`;
    }
    if (leadState.bant_insights) {
      prompt += `=== CURRENT BANT STATUS ===\n`;
      for (const [dim, val] of Object.entries(leadState.bant_insights)) {
        if (val) prompt += `- ${dim}: ${val.status} — ${val.details}\n`;
      }
      prompt += '\n';
    }
    if (leadState.data_capture) {
      const captured = leadState.data_capture.extracted_fields || [];
      const missing = leadState.data_capture.missing_mandatory_fields || [];
      if (captured.length > 0) {
        prompt += `=== ALREADY CAPTURED DATA (from prior calls — do NOT mark these as missing) ===\n`;
        captured.forEach(f => { prompt += `- ${f.field}: ${f.value} (${f.confidence} confidence)\n`; });
        prompt += '\n';
      }
      if (missing.length > 0) {
        prompt += `=== STILL MISSING DATA FIELDS: ${missing.join(', ')} ===\n\n`;
      }
    }
  }

  prompt += `=== CURRENT CALL TRANSCRIPT (Call #${callNumber}) ===\n${transcript}\n\n`;

  prompt += `=== YOUR TASKS ===\n`;
  prompt += `1. Calculate an INTENT SCORE (0-100) based on the customer's buying signals ACROSS THE ENTIRE JOURNEY (all calls including this one).\n`;
  if (callNumber > 1) {
    prompt += `   IMPORTANT: Consider the trajectory. If previous calls showed high intent (e.g. ${leadState?.intent_score || 'N/A'}/100) and this call is just a short scheduling/follow-up call, the intent should remain similar or slightly adjusted — NOT drop to near zero.\n`;
    prompt += `   Conversely, if the customer explicitly says they're not interested anymore, intent SHOULD drop significantly.\n`;
  }
  prompt += `2. List specific HIGH INTENT FACTORS — things the customer said/did that show genuine interest (include factors from THIS call only).\n`;
  prompt += `3. List specific LOW INTENT FACTORS — hesitations, concerns, red flags (from THIS call only).\n`;
  prompt += `4. Identify all OBJECTIONS raised by the customer IN THIS CALL. For each objection:\n`;
  prompt += `   - Categorize it (e.g., "Exam Difficulty", "Parental Consent", "Alternative Career")\n`;
  prompt += `   - Describe what the customer said\n`;
  prompt += `   - Describe how the salesperson handled it\n`;
  prompt += `   - Note if the customer was satisfied with the response\n`;
  prompt += `5. Extract BANT (Budget, Authority, Needs, Timeline) — update based on any NEW information from this call. If nothing new was discussed for a dimension, return the same status as before.\n`;
  prompt += `6. Answer the following DATA CAPTURE QUESTIONS (extract every piece of information mentioned or verified in THIS call):\n`;
  dataCaptureQuestions.forEach(q => {
    prompt += `   - ${q.label}: ${q.question}\n`;
  });
  prompt += `7. Identify the main CONVERSATION TOPICS discussed IN THIS CALL.\n`;
  prompt += `8. Write a comprehensive CALL SUMMARY with key points FOR THIS CALL.\n`;
  if (callNumber === 1) {
    prompt += `9. Write a JOURNEY SUMMARY summarizing this conversation. Treat this as the very first interaction with the prospect. Focus only on what happened in this transcript.\n`;
  } else {
    prompt += `9. Write an updated JOURNEY SUMMARY that incorporates insights from ALL ${callNumber} calls. This must be a complete, rolling narrative covering the entire prospect journey from the first call to now. Include: what was discussed, what was promised, what objections were raised and how they were handled, what commitments were made (e.g., "ES said he will join the meeting"), and whether those commitments were kept.\n`;
  }
  prompt += `10. Suggest concrete NEXT STEPS with short action titles and due dates.\n\n`;

  if (videoTimeline) {
    prompt += `VIDEO EVIDENCE (computer vision, use for presentation and camera-related coaching):\n${formatVisualTimeline(videoTimeline)}\n\n`;
  }

  prompt += `Be specific and cite evidence from the transcript wherever possible.\n`;
  prompt += `CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.\n`;

  return prompt;
}

function buildQualityPrompt(transcript, source, qualityChecks) {
  const role = source === 'google_meet' ? 'Expert Video Demo Quality Auditor' : 'Expert Call Quality Auditor';
  const context = getKalviumContext(source);

  let prompt = `You are an ${role}. You are evaluating the quality of ${context}.\n\n`;
  prompt += `=== TRANSCRIPT ===\n${transcript}\n\n`;

  prompt += `=== QUALITY PARAMETERS TO EVALUATE ===\n`;
  prompt += `For each parameter, assign a score (0 to max_score), a status, and a detailed reason.\n`;
  prompt += `Statuses: Done (full marks), Partially Done (partial marks), Needs Improvement (low marks), Not Applicable.\n\n`;
  prompt += `CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.\n\n`;

  // Group by category for clarity
  const groups = {};
  qualityChecks.forEach(check => {
    const group = check.category || 'Other';
    if (!groups[group]) groups[group] = [];
    groups[group].push(check);
  });

  for (const [group, checks] of Object.entries(groups)) {
    prompt += `== ${group} ==\n`;
    checks.forEach(check => {
      prompt += `- ${check.parameter} (Max Score: ${check.max_score || 2})\n`;
      if (check.check_question) {
        prompt += `  Question: ${check.check_question}\n`;
      }
      prompt += `  Guidelines: ${check.description}\n`;
      if (check.na_condition) {
        prompt += `  Not Applicable When: ${check.na_condition}\n`;
      }
      prompt += `\n`;
    });
  }

  prompt += `Be fair but rigorous. Cite specific evidence from the transcript for each evaluation.\n`;

  return prompt;
}

function _buildStaticQualityCoachingBlock(source, qualityChecks, parameters, leadState = null) {
  // Hash key = source + all check IDs + all param names + lead stage
  const stage = leadState?.ProspectStage || 'none';
  const cacheKey = `${source}|${stage}|${qualityChecks.map(q => q.id || q.parameter).join(',')}|${parameters.map(p => p.Parameter).join(',')}`;
  if (_staticPromptCache.has(cacheKey)) return _staticPromptCache.get(cacheKey);

  const role = source === 'google_meet'
    ? 'Expert Video Demo Quality Auditor & Coach'
    : 'Expert Sales Call Quality Auditor & Coach';
  const context = getKalviumContext(source, leadState);

  let block = `You are an ${role} evaluating ${context}.\n`;
  block += `You must complete TWO tasks in one response.\n\n`;

  // ── PART 1: Quality evaluation ──────────────────────────────────────────────
  block += `=== PART 1: QUALITY SCORING (EVALUATE ALL PARAMETERS) ===\n`;
  block += `You are a rigorous, impartial Quality Auditor for Kalvium. Your mandate is absolute accuracy grounded in verbatim transcript evidence.\n`;
  block += `- Evaluate each parameter strictly on its factual merits. NEVER artificially inflate OR artificially depress scores to hit a pre-set percentage.\n`;
  block += `- If the transcript contains clear proof of execution (e.g. associate specifically offered two concrete time slots, confirmed a clock time, or de-risked KNET aptitude testing), award full credit (2/2) with timestamp evidence. If missed or violated, award 0/2 or 1/2.\n`;
  block += `- You MUST evaluate EVERY SINGLE parameter in the rubric below. Do NOT skip any. Output ALL parameters in your response.\n`;
  block += `- For each parameter: output compact object { "id": "<PARAM_ID>", "s": <score: 2, 1, 0, or -1 for N/A>, "r": "<third-person concise reason>" }.\n`;
  block += `- REASON RULES ("r"):\n`;
  block += `  • Write in THIRD PERSON ("Associate did X", "Associate missed Y"). NEVER use second person.\n`;
  block += `  • Be ultra-concise (under 12 words): "[MM:SS] What associate did and what was missed/done."\n`;
  block += `  • Zero corporate jargon: Ban words like "formally mapped", "nuanced dynamics", "consultative posture", "exhibited compliance". State the concrete action.\n`;
  block += `  • For unattempted/skipped checks: output EXACTLY "Not asked during call".\n`;
  block += `  • For negative guardrails where no breach occurred: output "No violations detected".\n`;
  block += `- SCORING THRESHOLDS:\n`;
  block += `  • 'Done' (2/2): ONLY if the associate fully executed the complete playbook technique with verbatim transcript proof. Casual mentions or half-measures DO NOT qualify.\n`;
  block += `  • 'Partially Done' (1/2): ONLY if the associate actively attempted the structured playbook technique but missed a secondary detail. Casual conversation or unguided questions MUST score 0/2, NOT 1/2.\n`;
  block += `  • 'Needs Improvement' (0/2): The associate did not execute the technique, merely chatted casually, lectured without interaction, accepted obstacles passively, monologued (>75% talk share), got argumentative, or skipped the stage entirely.\n`;
  block += `- NON-NEGOTIABLE FAILURE TRIGGERS:\n`;
  block += `  1. DP-01: Score 0 if associate asked subjects/stream and immediately jumped to Kalvium without exploring what the student wants to do post-12th.\n`;
  block += `  2. DP-02: Score 0 unless associate specifically probed whether they are shortlisting, have applied, or visited colleges.\n`;
  block += `  3. DP-03: Score 0 if associate did not proactively ask which entrance exams (JEE, CET, etc.) the student is preparing for.\n`;
  block += `  4. DP-04: Score max 1 if only stream is asked but board or location is omitted. Score 0 if stream was not probed.\n`;
  block += `  5. DP-05: Score 0 if associate did not ask who makes the final education decision at home.\n`;
  block += `  6. DP-06: Score 0 if associate tells the prospect what their priorities should be instead of eliciting and ranking them.\n`;
  block += `  7. DP-08: Score max 1 if associate asks what they know but ignores the answer and delivers a generic pitch anyway. Score 0 if not probed.\n`;
  block += `  8. DP-09: Score 0 if student's genuine ambition, worry, or fear was not elicited in their own words.\n`;
  block += `  9. VP-01: Score 0 if associate named and pitched Kalvium without first building curiosity about the education market gap.\n`;
  block += `  10. VP-02: MANDATORY SOCRATIC METHOD. The associate must ask questions that lead the PROSPECT to say traditional syllabi are outdated. If the associate lectures or asserts it themselves without the prospect stating the conclusion, SCORE MUST BE 0!\n`;
  block += `  11. VP-04: Score 0 if associate only used buzzwords ('practical', 'hands-on') without describing actual projects on laptop from day one.\n`;
  block += `  12. VP-05: Score 0 unless associate gives a specific vivid contrast (e.g. dozens of real projects vs 1 final year project).\n`;
  block += `  13. VP-06: Score 0 if associate specifies an internship year (e.g. 'from 2nd year') or quotes stipend amounts.\n`;
  block += `  14. VP-08: Score 0 if KNET is described merely as an exam or fee barrier without explaining that it filters classroom peers (no donation/management seats).\n`;
  block += `  15. VP-09: Score 0 unless associate explicitly explains that high board marks do not buy admission and low marks do not disqualify.\n`;
  block += `  16. OH-01: Score 0 if associate mocks JEE/NEET or belittles student's chance.\n`;
  block += `  17. OH-05: Score 0 if associate pushes aggressively, repeats the ask, or creates fake urgency.\n`;
  block += `  18. IP-01: Associate MUST deliver the 'information-decay' argument (student retains 75%, conveys 50%, parents hear 25%). Merely saying 'bring parents' without explaining why MUST SCORE 0!\n`;
  block += `  19. IP-02: If father's absence is accepted without attempting the information-decay argument, score MAX 1. If no parent committed, score 0.\n`;
  block += `  20. IP-09: Score 0 if associate proposes slots without first asking when parents are home and available.\n`;
  block += `  21. IP-10: Score 0 if associate fails to proactively state that no money should be paid to any individual outside official portals.\n`;
  block += `  22. CC-01: If associate talk-share exceeds 75% or delivers lengthy monologues answered only in monosyllables, SCORE MUST BE 0!\n`;
  block += `  23. CC-06: Score 0 if associate asks an open-ended 'when are you free?' or offers only a single time slot without an alternative.\n`;
  block += `  24. CC-07: Score 0 if call ends on a vague time ('tomorrow evening', 'sometime Sunday') without a specific day and clock time.\n`;
  block += `  25. CC-09: Score 0 if associate omits instructing them to join on a laptop for screen sharing.\n`;
  block += `- The transcript is often in Tamil/Hindi/regional languages. You MUST translate and understand the full context before scoring. Do NOT skip non-English content.\n\n`;

  if (source === 'google_meet') {
    block += `=== CRITICAL MULTI-MODAL EVIDENCE INSTRUCTIONS (VIDEO DEMOS) ===\n`;
    block += `- Parameters with visual dependency require: 'timestamp + verbatim quote + English translation + visual proof'.\n`;
    block += `- For visual proof, cite the EXACT active slide number/title or webcam status from the Visual Timeline provided below (e.g., "[Visual Proof: Slide 21 Placements active at 14:32]").\n`;
    block += `- If a parameter requires visual evidence (e.g. showing a slide or portal) but the Visual Timeline shows the slide was NOT shown or rushed, you MUST score 0.\n`;
    block += `- Differentiate speaker roles: [Advisor], [Advisor: Senior], [Student], [Parent].\n`;
    block += `- FATAL COMPLIANCE BREACHES: If an advisor makes unapproved self-funding claims (FP-06), solicits direct personal payments/UPI (LC-12), exposes sensitive credentials/OTP (LC-11), improvises unauthorized fee terms (FP-10), or stacks unapproved discount bundles (FP-14), you MUST mark mark_fatal: true, score: 0, status: 'Needs Improvement', and coaching_status: 'Fail'.\n\n`;
  }

  const qualityGroups = {};
  qualityChecks.forEach(check => {
    const group = check.category || 'Other';
    if (!qualityGroups[group]) qualityGroups[group] = [];
    qualityGroups[group].push(check);
  });
  for (const [group, checks] of Object.entries(qualityGroups)) {
    block += `== ${group} ==\n`;
    checks.forEach(check => {
      block += `- ${check.parameter} (Param ID: ${check.param_id || 'N/A'})\n`;
      block += `  Guide / Question: ${check.description}\n`;
      if (check.scale) block += `  Scale: ${check.scale}\n`;
      if (check.polarity) block += `  Polarity: ${check.polarity} ${check.polarity === 'guardrail_negative' ? '(CRITICAL: Check for breaches!)' : ''}\n`;
      if (check.evidence_required) block += `  Evidence Required (Your 'reason' field MUST follow this format): ${check.evidence_required}\n`;
      if (!check.scale) block += `  Max Score: ${check.max_score || 2}\n`;
      if (check.check_question) block += `  Q: ${check.check_question}\n`;
      if (check.na_condition) block += `  N/A when: ${check.na_condition}\n`;
    });
    block += '\n';
  }

  // ── PART 2: TARGETED COACHING REPORT ──────────────────────────────────────
  block += `=== PART 2: TARGETED COACHING REPORT ===\n`;
  block += `CRITICAL RULE: Generate EXACTLY 3 high-impact Golden Rewrites focusing exclusively on niche, high-leverage corrections that explain WHY the call failed to convert (e.g., poor objection handling, skipping discovery, over-pitching, fake urgency, failing to secure the parent).\n`;
  block += `Keep behavioral insights focused, insightful, and grounded in transcript evidence.\n\n`;

  // Inject the real BD playbook if available
  if (bdPlaybook) {
    block += `=== KALVIUM BD PLAYBOOK (use this as your coaching reference) ===\n`;
    block += bdPlaybook + '\n\n';
  }

  block += `=== COACHING PRIORITIES (most important first) ===\n`;
  block += `1. CALL FLOW VIOLATIONS: Did the associate follow the 10-stage call structure? Did they skip probing and jump straight to pitching?\n`;
  block += `2. OBJECTION MISHANDLING: When the prospect raised a concern, did the associate use the Aikido method from the playbook? Or did they make up facts, get defensive, or bulldoze past it?\n`;
  block += `3. RED LINE VIOLATIONS: Did the associate say anything from the RED LINES list (badmouthing competitors, promising 100% placement, guaranteeing salary, or claiming fake unpartnered colleges)? (Note: Associates CAN mention real partner university names like AMET, St. Joseph's, Kalasalingam, LPU, SRM AP as examples; this does NOT violate anything).\n`;
  block += `4. TONE & ENERGY: Did they sound like an admission counselor who cares, or a desperate salesman? Were they patient when explaining? Did they listen when the parent pushed back?\n`;
  block += `5. MISSED BUYING SIGNALS: Did the prospect show interest (asking about fees, campus, curriculum) and the associate failed to capitalize on it?\n`;
  block += `6. BOOKING FAILURE: Did the associate secure at least one parent for the 1:1 session? Did they offer two time slots? Did they confirm on WhatsApp?\n`;
  block += `7. OVER-PITCHING: Did the associate dump Kalvium's value proposition without first understanding the student's situation, priorities, and concerns?\n\n`;

  block += `=== CONTEXT-AWARE REWRITES INSTRUCTIONS ===\n`;
  block += `CRITICAL: You MUST generate EXACTLY 3 specific, deeply contextualized rewrites representing the biggest missed coaching opportunities (e.g. objection mishandling, skipped discovery, over-pitching, policy violations, or closing failures).\n`;
  block += `For EACH of the 3 rewrites:\n`;
  block += `- 'what_they_said': Quote the EXACT words the associate said with exact timestamp range.\n`;
  block += `- 'why_it_failed': Provide a DETAILED, context-rich diagnosis. Do NOT just state a brief rule check. Explain specifically what went wrong in this interaction, how the prospect reacted or perceived it, the psychological impact, and the exact Kalvium playbook principle violated.\n`;
  block += `- 'golden_rewrite': Provide a DETAILED, natural, context-rich conversational script that a top-performing Kalvium counselor would say in this exact situation. Tailor it with the prospect's actual context (names, board, situation) and execute proven Kalvium frameworks (e.g. Aikido validation + pivot, Information Decay formula [75% retained -> 50% conveyed -> 25% heard], Socratic questioning, Two-Slot scheduling). Give a complete, authentic spoken response, not an abbreviated 1-liner.\n`;
  block += `- The golden rewrite MUST match the original language/transliteration of the call or standard professional English. Never use Hinglish if the call was in South Indian languages or English.\n`;
  block += `IMPORTANT: While category_scores and quality reasons remain strictly 1-line, Context-Aware Rewrites MUST be rich, detailed, and deeply contextualized masterclass coaching.\n\n`;

  block += `Overall grade scale — A (90-100), B (75-89), C (60-74), D (40-59), F (0-39)\n\n`;

  const categories = groupByCategory(parameters);
  for (const [category, params] of Object.entries(categories)) {
    block += `== ${category} ==\n`;
    params.forEach(p => {
      block += `- ${p.Parameter}: ${p.Description}\n`;
    });
    block += '\n';
  }

  _staticPromptCache.set(cacheKey, block);
  return block;
}

function buildQualityCoachingPrompt(transcript, source, qualityChecks, parameters, leadState, videoTimeline = null) {
  const qualityBlock = _buildStaticQualityCoachingBlock(source, qualityChecks, parameters, leadState);
  const visualBlock = source === 'google_meet' && videoTimeline ? `\n${formatVisualTimeline(videoTimeline)}\n` : '';

  return `${qualityBlock}
${visualBlock}
=== FULL CALL TRANSCRIPT ===
${transcript}

IMPORTANT INSTRUCTIONS:
1. Evaluate Quality — you MUST output a score for EVERY SINGLE parameter. Do NOT skip any. If you cannot find clear evidence of execution, score it 0.
2. Generate the Deep Coaching Report.
3. Be RIGOROUS and EVIDENCE-GROUNDED in your grading. Award credit when supported by verbatim transcript proof, and penalize violations strictly. If the transcript is in a regional language, TRANSLATE it fully before scoring.
4. Ground every evaluation in facts. Do not invent false failures for clearly executed actions, and do not overlook genuine playbook violations.
CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.`;
}

function buildOmniPrompt(transcriptText, source, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params, videoTimeline = null) {
  const insightsP = buildInsightsPrompt(transcriptText, source, dataCaptureQuestions, pastCalls, leadState);
  const qualP = buildQualityCoachingPrompt(transcriptText, source, filteredQualityChecks, params, leadState, videoTimeline); 

  const dataCaptureFooter = `\n\n=== CRITICAL MANDATORY INSTRUCTIONS: DATA CAPTURE & JSON STRUCTURE ===
1. MANDATORY DATA CAPTURE: You MUST extract every fact mentioned in the call for the 10 canonical fields into 'insights.data_capture.extracted_fields':
   - 'Grade': Current standard/class (e.g. 12th Std, 11th Std, Dropper).
   - 'Stream': Student's academic stream (e.g. Bio-Maths, Computer Science, PCM, PCMB, MPC, Science).
     NOTE: "Bio-Maths" (PCMB) includes Physics, Chemistry & Maths, is a Science stream, and fully qualifies for B.Tech CSE!
   - 'Customer Location': Student or parent's city/town/district/school.
   - 'Decision Maker': Who decides (Father, Mother, Both Parents, Student).
   - 'Course/College Interested In': Target degree (e.g. B.Tech Computer Science).
   - 'Email ID': Email address if mentioned or verified.
   - 'JEE Coaching': Whether attending JEE/CET coaching (Yes/No).
   - 'JEE/Other Exams': Entrance exams being attempted (JEE, CET, etc.).
   - 'Laptop Access': Availability of a personal laptop/computer (Yes/No).
   - 'Competitors Mentioned': Competing colleges/universities or other options discussed.
   Do NOT leave 'extracted_fields' empty if any of these facts were stated in the transcript!
2. COMPLETE OUTPUT: You MUST output all top-level keys in JSON: 'insights', 'summary', 'next_steps', 'quality', and 'coaching_report'.`;

  return insightsP + "\n\n=== QUALITY & COACHING INSTRUCTIONS ===\n" + qualP + dataCaptureFooter;
}

/**
 * Lean dynamic prompt generator when Gemini Context Caching is active.
 * Excludes static knowledge base (BD Playbook, University Fees, Placement Highlights)
 * which is already embedded in the cached content.
 */
function buildDynamicOmniPrompt(transcriptText, source, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params, videoTimeline = null) {
  const role = source === 'google_meet' ? 'Expert Video Demo Analyst & Coach' : 'Expert Sales Call Analyst & Coach';
  const callNumber = (pastCalls?.length || 0) + 1;

  let prompt = `You are an ${role}. You are auditing and coaching a ${source === 'google_meet' ? 'Google Meet product demonstration meeting' : 'university admissions sales counselling phone call'} for Kalvium.\n`;
  prompt += `The Master Ground Truth Knowledge Base (BD Coaching Playbook, University Fee Structure, 2026 Batch Placement & Salary Highlights, 10-Stage Call Rules, and Fatal Pitch Compliance Boundaries) is provided in your cached context. Evaluate strictly against those official standards.\n\n`;

  // 1. Current Lead State & Journey History
  if (leadState) {
    prompt += `=== CURRENT LEAD STATUS & HISTORY ===\n`;
    if (leadState.kalvium_funnel_stage) prompt += `- Funnel Stage: ${leadState.kalvium_funnel_stage}\n`;
    if (leadState.next_process_step) prompt += `- Next Scheduled Activity: ${leadState.next_process_step}\n`;
    if (leadState.journey_summary) prompt += `- CRM Journey Summary (Past Calls): ${leadState.journey_summary}\n`;
    if (leadState.intent_score != null) prompt += `- Current Lead Intent Score: ${leadState.intent_score}/100\n`;
    prompt += '\n';
  }

  // 2. Multi-call awareness & past call summaries
  if (callNumber > 1) {
    prompt += `⚠️ CRITICAL: This is CALL #${callNumber} for this prospect. Analyze this call IN CONTEXT of the full journey.\n`;
    if (pastCalls && pastCalls.length > 0) {
      prompt += `=== PREVIOUS CALLS SUMMARY (${pastCalls.length} calls) ===\n`;
      pastCalls.forEach((pc, i) => {
        const summary = pc.summary_data ? (typeof pc.summary_data === 'string' ? JSON.parse(pc.summary_data) : pc.summary_data) : null;
        prompt += `- Call ${i + 1} (${pc.source || 'phone_call'}): ${summary?.call_summary ? (Array.isArray(summary.call_summary) ? summary.call_summary.join('; ') : summary.call_summary) : 'Completed'}\n`;
      });
      prompt += '\n';
    }
  }

  // 3. Visual Presentation & Timeline (for Video Calls)
  if (source === 'google_meet' && videoTimeline) {
    prompt += `=== VISUAL PRESENTATION & TIMELINE (COMPUTER VISION SENSOR FUSION) ===\n`;
    prompt += formatVisualTimeline(videoTimeline) + '\n\n';
  }

  // 4. Data Capture Instruction (Referencing cached questions)
  prompt += `=== MANDATORY DATA CAPTURE INSTRUCTION ===\n`;
  prompt += `Thoroughly scan the transcript and extract EVERY fact mentioned, confirmed, or discussed in THIS call for the 10 canonical fields into 'insights.data_capture.extracted_fields':
1. 'Grade': Current standard/class (e.g. 12th Std, 11th Std, Dropper).
2. 'Stream': Student stream/subjects (e.g. Bio-Maths, Computer Science, PCM, PCMB, MPC, Science). NOTE: Bio-Maths (PCMB) is a Science stream with Physics, Chemistry & Maths and qualifies for B.Tech CSE!
3. 'Customer Location': City, district, or school location (e.g. Trichy, Chandigarh, Chennai).
4. 'Decision Maker': Who makes the decision (e.g. Mother, Father, Both Parents, Student).
5. 'Course/College Interested In': Target degree (e.g. B.Tech Computer Science).
6. 'Email ID': Customer's email address.
7. 'JEE Coaching': Whether taking coaching (Yes/No).
8. 'JEE/Other Exams': Specific entrance exams mentioned (e.g. JEE, CET, etc.).
9. 'Laptop Access': Whether laptop/desktop is available (Yes/No).
10. 'Competitors Mentioned': Competitors, other colleges, or alternatives discussed.
CRITICAL: You MUST extract every field that was stated or confirmed in this call transcript with its exact value, confidence ('High'/'Medium'/'Low'), and timestamp MM:SS. Do NOT omit fields merely because they were mentioned in a previous call summary — if the associate verified or discussed it in THIS call, extract it!\n\n`;

  // 5. Quality Parameters Rubric (Definitions & guides are in cached context)
  prompt += `=== QUALITY PARAMETERS TO EVALUATE (EVALUATE ALL PARAMETERS) ===\n`;
  prompt += `Evaluate against the canonical quality rubric cached in your context for ${source === 'google_meet' ? 'Google Meet Video Demonstrations' : '1:1 Phone Counselling Calls'}.\n`;
  prompt += `AUDIT RULES (OBJECTIVE & EVIDENCE-GROUNDED AUDITOR MANDATE):\n`;
  prompt += `- You are a rigorous, impartial Quality Auditor for Kalvium. Your mandate is absolute accuracy grounded in verbatim transcript evidence.\n`;
  prompt += `- Evaluate each parameter strictly on its factual merits. NEVER artificially inflate OR artificially depress scores to hit a pre-set percentage.\n`;
  prompt += `- If the transcript contains clear proof of execution (e.g. associate specifically offered two concrete time slots like 5-6 PM or 6-7 PM, confirmed a clock time, or de-risked KNET as aptitude vs JEE PCM), you MUST award full credit (2/2) with the exact timestamp. Never claim an action was omitted if the transcript shows it was performed.\n`;
  prompt += `- If the associate missed, skipped, or violated a playbook technique (e.g. quoted unauthorized year-based internship stipends, skipped discovery, or failed to give the 75-50-25 decay argument), strictly award 0/2 or 1/2.\n`;
  prompt += `- If a parameter is not applicable (e.g. live handoff when the parent is already on the phone from line 1), mark compliant or N/A; do NOT penalize with an artificial failure.\n`;
  prompt += `- You MUST evaluate EVERY SINGLE parameter listed below. Do not skip any parameter.\n`;
  prompt += `- SCORING THRESHOLDS:\n`;
  prompt += `  • 'Done' (2/2): ONLY if the associate fully executed the complete playbook technique with verbatim transcript proof. Casual mentions or half-measures DO NOT qualify.\n`;
  prompt += `  • 'Partially Done' (1/2): ONLY if the associate actively attempted the structured playbook technique but missed a secondary detail. Casual conversation or unguided questions MUST score 0/2, NOT 1/2.\n`;
  prompt += `  • 'Needs Improvement' (0/2): The associate did not execute the technique, merely chatted casually, lectured without interaction, accepted obstacles passively, monologued (>75% talk share), got argumentative, or skipped the stage entirely.\n`;
  prompt += `- NON-NEGOTIABLE FAILURE TRIGGERS:\n`;
  prompt += `  1. DP-01: Score 0 if associate asked subjects/stream and immediately jumped to Kalvium without exploring what the student wants to do post-12th.\n`;
  prompt += `  2. DP-02: Score 0 unless associate specifically probed whether they are shortlisting, have applied, or visited colleges.\n`;
  prompt += `  3. DP-03: Score 0 if associate did not proactively ask which entrance exams (JEE, CET, etc.) the student is preparing for.\n`;
  prompt += `  4. DP-04: Score max 1 if only stream is asked but board or location is omitted. Score 0 if stream was not probed.\n`;
  prompt += `  5. DP-05: Score 0 if associate did not ask who makes the final education decision at home.\n`;
  prompt += `  6. DP-06: Score 0 if associate tells the prospect what their priorities should be instead of eliciting and ranking them.\n`;
  prompt += `  7. DP-08: Score max 1 if associate asks what they know but ignores the answer and delivers a generic pitch anyway. Score 0 if not probed.\n`;
  prompt += `  8. DP-09: Score 0 if student's genuine ambition, worry, or fear was not elicited in their own words.\n`;
  prompt += `  9. VP-01: Score 0 if associate named and pitched Kalvium without first building curiosity about the education market gap.\n`;
  prompt += `  10. VP-02: MANDATORY SOCRATIC METHOD. The associate must ask questions that lead the PROSPECT to say traditional syllabi are outdated. If the associate lectures or asserts it themselves without the prospect stating the conclusion, SCORE MUST BE 0!\n`;
  prompt += `  11. VP-04: Score 0 if associate only used buzzwords ('practical', 'hands-on') without describing actual projects on laptop from day one.\n`;
  prompt += `  12. VP-05: Score 0 unless associate gives a specific vivid contrast (e.g. dozens of real projects vs 1 final year project).\n`;
  prompt += `  13. VP-06: Score 0 if associate specifies an internship year (e.g. 'from 2nd year') or quotes stipend amounts.\n`;
  prompt += `  14. VP-08: Score 0 if KNET is described merely as an exam or fee barrier without explaining that it filters classroom peers (no donation/management seats).\n`;
  prompt += `  15. VP-09: Score 0 unless associate explicitly explains that high board marks do not buy admission and low marks do not disqualify.\n`;
  prompt += `  16. OH-01: Score 0 if associate mocks JEE/NEET or belittles student's chance.\n`;
  prompt += `  17. OH-05: Score 0 if associate pushes aggressively, repeats the ask, or creates fake urgency.\n`;
  prompt += `  18. IP-01: Associate MUST deliver the 'information-decay' argument (student retains 75%, conveys 50%, parents hear 25%). Merely saying 'bring parents' without explaining why MUST SCORE 0!\n`;
  prompt += `  19. IP-02: If father's absence is accepted without attempting the information-decay argument, score MAX 1. If no parent committed, score 0.\n`;
  prompt += `  20. IP-09: Score 0 if associate proposes slots without first asking when parents are home and available.\n`;
  prompt += `  21. IP-10: Score 0 if associate fails to proactively state that no money should be paid to any individual outside official portals.\n`;
  prompt += `  22. CC-01: If associate talk-share exceeds 75% or delivers lengthy monologues answered only in monosyllables, SCORE MUST BE 0!\n`;
  prompt += `  23. CC-06: Score 0 if associate asks an open-ended 'when are you free?' or offers only a single time slot without an alternative.\n`;
  prompt += `  24. CC-07: Score 0 if call ends on a vague time ('tomorrow evening', 'sometime Sunday') without a specific day and clock time.\n`;
  prompt += `  25. CC-09: Score 0 if associate omits instructing them to join on a laptop for screen sharing.\n\n`;

  const qualityGroups = {};
  filteredQualityChecks.forEach(check => {
    const group = check.category || 'Other';
    if (!qualityGroups[group]) qualityGroups[group] = [];
    qualityGroups[group].push(check);
  });
  for (const [group, checks] of Object.entries(qualityGroups)) {
    prompt += `== ${group} ==\n`;
    checks.forEach(check => {
      prompt += `- [${check.param_id || 'N/A'}] ${check.parameter} (Max: ${check.max_score || 2})\n`;
    });
    prompt += '\n';
  }

  // 6. Call Transcript
  prompt += `=== CURRENT CALL TRANSCRIPT (Call #${callNumber}) ===\n${transcriptText}\n\n`;

  // 7. Output Tasks & Language rules
  prompt += `=== OUTPUT INSTRUCTIONS ===\n`;
  prompt += `1. Provide insights (intent score 0-100, high/low intent factors with evidence, objections with how handled, comprehensive BANT analysis with status and rich contextual details for budget, authority, needs, and timeline).
     MANDATORY DATA CAPTURE: You MUST extract every piece of student/parent information stated in this call into 'insights.data_capture.extracted_fields' (Grade, Stream, Customer Location, Decision Maker, etc.). Note: 'Bio-Maths' (PCMB) is a Science stream qualifying for B.Tech CSE. Do not omit facts stated in the transcript!\n`;
  prompt += `2. QUALITY ARRAY: You MUST evaluate EVERY parameter listed above in the rubric (all 46 items) using compact pipe-separated format: ["PARAM_ID|SCORE|THIRD_PERSON_REASON", ...]. SCORE is 2 (Done), 1 (Partially Done), 0 (Needs Improvement), or -1 (Not Applicable). Do NOT omit parameters; evaluate all 46. Keep reason under 12 words.\n`;
  prompt += `3. Provide coaching report: EXACTLY 3 high-impact, deeply contextualized golden rewrites (detailed situational diagnosis in 'why_it_failed' + rich, realistic conversational script in 'golden_rewrite'). In contrast, keep category_scores (5 categories) strictly 1 concise sentence each (<15 words for well, wrong, and tip). Quality reasons remain strictly 1 line (<12 words).\n`;
  prompt += `4. SYNTAX RULE: Output compact, minified JSON without unnecessary indentation spaces or redundant linebreaks.\n`;
  prompt += `5. CRITICAL: Translate all regional speech (Tamil/Hindi) into standard English for output. NEVER output Devanagari or Tamil script.\n`;

  return prompt;
}

function buildLeanDynamicOmniPrompt(transcriptText, source, triageResult, pastCalls, leadState, filteredQualityChecks, params) {
  const callNumber = (pastCalls?.length || 0) + 1;
  const subTier = triageResult?.sub_tier || 'T1_ROUTINE';

  let prompt = `You are an Expert Quality & Sales Analyst auditing a 1:1 phone interaction for Kalvium.\n`;
  prompt += `The Master Ground Truth Knowledge Base (BD Coaching Playbook, University Fee Structure, 2026 Batch Placement & Salary Highlights, 10-Stage Call Rules, and Fatal Pitch Compliance Boundaries) is provided in your cached context. Evaluate strictly against those official standards.\n\n`;

  // 1. Operational Context based on sub-tier
  if (subTier === 'T1_CONTINUATION') {
    prompt += `=== OPERATIONAL CONTEXT: PITCH CONTINUATION / RE-DIAL (< 3 MINUTES) ===\n`;
    prompt += `This call is a short continuation of an interrupted counseling pitch where the earlier call got disconnected.\n`;
    prompt += `- DO NOT penalize the associate for skipping Discovery (DP-01 to DP-06) or initial pitch framing, because discovery occurred on the prior call.\n`;
    prompt += `- Mark already-covered discovery parameters with status 'Done' or 'Not Applicable' and reason 'Previously completed on prior pitch call'.\n`;
    prompt += `- EVALUATE STRICTLY ON:\n`;
    prompt += `  1. Reconnection & steering back smoothly (CC-05)\n`;
    prompt += `  2. Slot offering & locking specific day/time (CC-06, CC-07)\n`;
    prompt += `  3. Parent attendance secured (IP-02)\n`;
    prompt += `  4. Preparation & WhatsApp logistics (CC-09, CC-10)\n`;
    prompt += `  5. Zero compliance red lines (VP-10, OH-04, OH-09, IP-10)\n`;
    prompt += `- Set call_type_tag to 'Pitch Continuation'.\n\n`;
  } else if (subTier === 'T1_REMINDER') {
    prompt += `=== OPERATIONAL CONTEXT: MEETING / EXAM REMINDER (< 2-3 MINUTES) ===\n`;
    prompt += `This call is a short logistical touchpoint to confirm a Google Meet counseling demo or KNET entrance exam.\n`;
    prompt += `- DO NOT evaluate or penalize full sales pitch parameters (e.g. VP-01 market gap, VP-02 syllabus obsolescence, VP-05 normal B.Tech contrast, OH-01 to OH-07 objection handling). Mark all non-logistical pitch parameters as 'Not Applicable'.\n`;
    prompt += `- EVALUATE STRICTLY ON LOGISTICAL EXECUTION:\n`;
    prompt += `  1. Specific day and clock time locked/confirmed (CC-07)\n`;
    prompt += `  2. Set up to arrive prepared on laptop / internet (CC-09)\n`;
    prompt += `  3. Parent attendance confirmed for counseling (IP-02)\n`;
    prompt += `  4. WhatsApp link or credentials delivery verified (CC-10)\n`;
    prompt += `  5. Professional brevity, energy, and tonality (CC-01)\n`;
    prompt += `  6. Compliance red lines (VP-10, IP-10)\n`;
    prompt += `- If the associate executed the reminder clearly and confirmed logistics, award a high/perfect score.\n`;
    prompt += `- Set call_type_tag to 'Meeting Reminder' or 'KNET Exam Reminder'.\n\n`;
  } else if (subTier === 'T1_FORWARD') {
    prompt += `=== OPERATIONAL CONTEXT: CALL FORWARDING / DEFERRAL & CALLBACK REQUEST (< 2-3 MINUTES) ===\n`;
    prompt += `In this call, the prospect (parent or student) is unavailable (busy, driving, in office, in class) or asks to call another family member (son, father, mother) or defer to another time or phone number.\n`;
    prompt += `- DO NOT evaluate or penalize full sales pitch parameters (DP-01 to DP-06 discovery, VP-01 to VP-09 value pitch, KNET explanation, booking a demo). Mark all unattempted sales pitch parameters as 'Not Applicable'.\n`;
    prompt += `- EVALUATE STRICTLY ON COURTESY, RESPECTFULNESS & CONTACT LOGISTICS:\n`;
    prompt += `  1. Respecting Unavailability & No Pressure (OH-05, OH-08): Associate immediately respected that the prospect is busy/driving/at work without arguing or aggressively pushing a pitch.\n`;
    prompt += `  2. Accurate Contact & Callback Capture (CC-08): Associate clearly confirmed who to call (Father/Son/Student), the alternate phone number (if given), or the preferred callback window.\n`;
    prompt += `  3. Professional Brevity, Energy & Sign-off (CC-01): Associate remained polite, acknowledged the request, and signed off cleanly in < 60 seconds.\n`;
    prompt += `  4. Zero Compliance Violations (VP-10, IP-10): No inappropriate promises or compliance breaches.\n`;
    prompt += `- If the associate handled the deferral/forwarding politely and captured details cleanly, award a high score (90-100%).\n`;
    prompt += `- Set call_type_tag to 'Call Forwarded / Callback Request'.\n\n`;
  } else {
    prompt += `=== OPERATIONAL CONTEXT: ROUTINE CHECK-IN / RESCHEDULE ===\n`;
    prompt += `This call is a short routine interaction or reschedule request. Evaluate core discovery and compliance concisely.\n`;
    prompt += `- Set call_type_tag to 'Routine Follow-up'.\n\n`;
  }

  // 2. Current Lead State & Journey History
  if (leadState) {
    prompt += `=== CURRENT LEAD STATUS & HISTORY ===\n`;
    if (leadState.kalvium_funnel_stage) prompt += `- Funnel Stage: ${leadState.kalvium_funnel_stage}\n`;
    if (leadState.next_process_step) prompt += `- Next Scheduled Activity: ${leadState.next_process_step}\n`;
    if (leadState.journey_summary) prompt += `- CRM Journey Summary (Past Calls): ${leadState.journey_summary}\n`;
    if (leadState.intent_score != null) prompt += `- Current Lead Intent Score: ${leadState.intent_score}/100\n`;
    prompt += '\n';
  }

  // 3. Multi-call awareness
  if (callNumber > 1 && pastCalls && pastCalls.length > 0) {
    prompt += `⚠️ CRITICAL: This is CALL #${callNumber} for this prospect. You have ${pastCalls.length} previous call(s) on record.\n`;
    pastCalls.forEach((pc, i) => {
      const summary = pc.summary_data ? (typeof pc.summary_data === 'string' ? JSON.parse(pc.summary_data) : pc.summary_data) : null;
      prompt += `- Call ${i + 1} (${pc.duration_sec || 0}s): ${summary?.call_summary ? (Array.isArray(summary.call_summary) ? summary.call_summary.join('; ') : summary.call_summary) : 'Completed'}\n`;
    });
    prompt += '\n';
  }

  // 4. Data Capture Instruction
  prompt += `=== MANDATORY DATA CAPTURE INSTRUCTION ===\n`;
  prompt += `You MUST extract any facts mentioned in this call for the 10 canonical fields into 'insights.data_capture.extracted_fields':\n`;
  prompt += `- 'Grade': Current standard/class (e.g. 12th Std, 11th Std).\n`;
  prompt += `- 'Stream': Student stream (e.g. Bio-Maths, PCMB, Computer Science, PCM, MPC, Science). NOTE: Bio-Maths is a Science stream with Maths and qualifies for B.Tech CSE.\n`;
  prompt += `- 'Customer Location': City or district.\n`;
  prompt += `- 'Decision Maker': Who decides (Father, Mother, Student, Both Parents).\n`;
  prompt += `- 'Course/College Interested In': Preferred degree (e.g. B.Tech Computer Science).\n`;
  prompt += `- 'Email ID': Email address if mentioned.\n`;
  prompt += `- 'JEE Coaching': Taking coaching (Yes/No).\n`;
  prompt += `- 'JEE/Other Exams': Entrance exams mentioned.\n`;
  prompt += `- 'Laptop Access': Availability of laptop/desktop (Yes/No).\n`;
  prompt += `- 'Competitors Mentioned': Competitors or alternatives discussed.\n`;
  prompt += `Do NOT omit fields that were stated or confirmed in this call.\n\n`;

  // 5. Quality Parameters Checklist (Audit by Exception)
  prompt += `=== QUALITY PARAMETERS TO EVALUATE (AUDIT BY EXCEPTION) ===\n`;
  prompt += `CRITICAL EFFICIENCY RULE: Output quality entries ONLY for parameters that actually apply to this interaction (typically 2-4 logistical/closing checks or any compliance failures).\n`;
  prompt += `DO NOT output entries for non-applicable pitch parameters (e.g. VP-01 market gap, VP-02 syllabus obsolescence, etc.). All unlisted parameters will automatically default to 'Not Applicable' in the system.\n`;
  prompt += `Strict Compliance Rule: Always flag fatal breaches if detected.\n\n`;

  filteredQualityChecks.forEach(check => {
    prompt += `- [${check.param_id || 'N/A'}] ${check.parameter} (Max: ${check.max_score || 2})\n`;
  });
  prompt += '\n';

  // 6. Call Transcript
  prompt += `=== CURRENT CALL TRANSCRIPT (Call #${callNumber}) ===\n${transcriptText}\n\n`;

  // 7. Lean Output Instructions
  prompt += `=== LEAN OUTPUT INSTRUCTIONS ===\n`;
  prompt += `1. Provide call_type_tag, insights (intent score 0-100, factors, extracted_fields []).\n`;
  prompt += `2. Provide quality array: 2 to 4 applicable checks ONLY. Keep reason ultra-concise (under 15 words).\n`;
  prompt += `3. Provide coaching report: overall_score, overall_grade, 1-line summary, 1 single actionable coach_tip.\n`;
  prompt += `4. summary.call_summary: EXACTLY 1 concise bullet.\n`;
  prompt += `5. DO NOT generate multi-paragraph rewrites or essays. Keep total response ultra-lean.\n`;
  prompt += `6. Translate regional speech (Tamil/Hindi) into standard English for output. NEVER output Devanagari or Tamil script.\n`;

  return prompt;
}

module.exports = {
  getKalviumContext,
  sanitizeKey,
  groupByCategory,
  formatVisualTimeline,
  buildInsightsPrompt,
  buildQualityPrompt,
  _buildStaticQualityCoachingBlock,
  buildQualityCoachingPrompt,
  buildOmniPrompt,
  buildDynamicOmniPrompt,
  buildLeanDynamicOmniPrompt,
};
