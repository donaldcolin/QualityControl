const { getInsightsSchema, getQualitySchema, getCombinedQualityCoachingSchema } = require('./schemas');
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
1. Warm Opening: Establish context, ask about 12th Std stream, and check if they know Kalvium.
2. Probing and Aligning: Understand their current college search status, post-12th plans, and learning style (practical vs theory).
3. Understand Student + Parent Priorities: Go past generic priorities and surface internal conflicts.
4. Introduce Kalvium Based on Answers: Create curiosity about the gap in the current education market before introducing Kalvium.
5. Why connect early?: Frame KNET as a parallel pathway and timing advantage.
6. Create Need for 1:1 Counselling: De-sell it; explain it's not a webinar and it's to gather info.
7. University Structure (If asked): Student does NOT choose a university now, only a preferred state/location.
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
    const camPct = tl.facial_analytics.associate_camera_active_pct != null
      ? `${Number(tl.facial_analytics.associate_camera_active_pct).toFixed(1)}%`
      : 'N/A';
    const passed = tl.facial_analytics.trust_metric_passed ? 'PASSED (>=50%)' : 'FAILED (<50%)';
    out += `Webcam Face Presence:\n`;
    out += `- Advisor Camera Active: ${camPct} of call (${passed})\n\n`;
  }

  // 1b. Face Count Timeline (Sensor Fusion)
  if (Array.isArray(tl.face_timeline) && tl.face_timeline.length > 0) {
    out += `Attendee Face Count Timeline (Extracted from Video frames):\n`;
    tl.face_timeline.forEach(event => {
      const s = Math.floor(event.start_time / 60) + ':' + ('0' + (event.start_time % 60)).slice(-2);
      const e = Math.floor(event.end_time / 60) + ':' + ('0' + (event.end_time % 60)).slice(-2);
      out += `  • [${s} - ${e}] -> ${event.faces_detected} Faces Detected in Video Feed\n`;
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
  prompt += `6. Answer the following DATA CAPTURE QUESTIONS (only extract NEW information from THIS call — already captured data is listed above):\n`;
  dataCaptureQuestions.forEach(q => {
    prompt += `   - ${q.label}: ${q.question}\n`;
  });
  prompt += `7. Identify the main CONVERSATION TOPICS discussed IN THIS CALL.\n`;
  prompt += `8. Write a comprehensive CALL SUMMARY with key points and main takeaways FOR THIS CALL.\n`;
  if (callNumber === 1) {
    prompt += `9. Write a JOURNEY SUMMARY summarizing this conversation. Treat this as the very first interaction with the prospect. Focus only on what happened in this transcript.\n`;
  } else {
    prompt += `9. Write an updated JOURNEY SUMMARY that incorporates insights from ALL ${callNumber} calls. This must be a complete, rolling narrative covering the entire prospect journey from the first call to now. Include: what was discussed, what was promised, what objections were raised and how they were handled, what commitments were made (e.g., "ES said he will join the meeting"), and whether those commitments were kept.\n`;
  }
  prompt += `10. Suggest concrete NEXT STEPS with suggested dialogue and due dates.\n\n`;

  prompt += `11. CONSTRUCT AN ATTENDEE TIMELINE (SENSOR FUSION):\n`;
  if (videoTimeline) {
    prompt += `    - Cross-reference the speakers in the Audio Transcript with the Visual Face Timeline provided below.\n`;
    prompt += `    - Visual Face Timeline reveals EXACTLY when new people entered or left the video frame.\n`;
    prompt += `    - CRITICAL GOOGLE MEET UI QUIRK: In Google Meet, webcams are often hidden when the Associate is talking (Active Speaker View).\n`;
    prompt += `    - If the face count temporarily drops to 0, or rapidly fluctuates between 1 and 2, DO NOT assume people left!\n`;
    prompt += `    - Assume attendees are still present unless they explicitly state they are leaving, or if the face count stays reduced for a prolonged period (e.g. 5+ minutes).\n`;
    prompt += `    - Example: If face count goes from 1 to 2 at 05:00, and SPEAKER_01 says 'I am his mother' at 05:12, then the Mother joined at 05:00.\n`;
    prompt += `    - Determine the 'actual_meeting_start_time' by finding the exact timestamp when the face count first changes from 0 to 1 (or 2) and stays there, ignoring the initial period where the camera was off.\n`;
    prompt += `    - Visual Timeline: \n${formatVisualTimeline(videoTimeline)}\n\n`;
  } else {
    prompt += `    - Infer the timeline of who was present (Student, Parent, etc.) based purely on when their distinct voices spoke in the transcript.\n\n`;
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
  block += `=== PART 1: QUALITY SCORING ===\n`;
  block += `For each parameter: assign a score (0 to max_score), a status, and a reason citing the transcript.\n`;
  block += `Statuses: Done (full marks), Partially Done (partial), Needs Improvement (low), Not Applicable.\n`;
  block += `CRITICAL GRADING INSTRUCTION: You are NOT a friendly reviewer. You are a HOSTILE AUDITOR hired to find every flaw.\n`;
  block += `- Your DEFAULT assumption is that every parameter FAILED. The associate must PROVE they did it well through clear transcript evidence.\n`;
  block += `- If you cannot find EXPLICIT, CLEAR evidence in the transcript that the parameter was executed, score it 0. Silence is NOT compliance.\n`;
  block += `- 'Done' (2/2) requires FLAWLESS execution with clear evidence. Average execution = 'Partially Done' (1/2). Missing or poor = 'Needs Improvement' (0/2).\n`;
  block += `- A score above 80% should be RARE. Most calls have significant gaps. If you're giving 90%+, you are being too lenient.\n`;
  block += `- The transcript is often in Tamil/Hindi/regional languages. You MUST translate and understand the full context before scoring. Do NOT skip non-English content.\n`;
  block += `- You MUST evaluate EVERY SINGLE parameter. Do not skip any. Output ALL parameters in your response.\n\n`;

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

  // ── PART 2: DEEP COACHING REPORT ──────────────────────────────────────
  block += `=== PART 2: DEEP COACHING REPORT ===\n`;
  block += `You are an elite BD Trainer coaching Kalvium counsellors on 1:1 Counselling Booking Calls.\n`;
  block += `You are NOT a checklist auditor. A basic TL can check if someone said hello. Your job is to find INVISIBLE mistakes only an experienced trainer would catch.\n`;
  block += `CRITICAL RULE: DO NOT waste your Golden Rewrites on basic corrections like missing greetings, failing to say sir/madam, or minor pleasantries. You MUST focus exclusively on niche, high-leverage corrections that explain WHY the call failed to convert (e.g., poor objection handling, skipping discovery, over-pitching, fake urgency, failing to secure the parent).\n\n`;

  // Inject the real BD playbook if available
  if (bdPlaybook) {
    block += `=== KALVIUM BD PLAYBOOK (use this as your coaching reference) ===\n`;
    block += bdPlaybook + '\n\n';
  }

  block += `=== COACHING PRIORITIES (most important first) ===\n`;
  block += `1. CALL FLOW VIOLATIONS: Did the associate follow the 10-stage call structure? Did they skip probing and jump straight to pitching?\n`;
  block += `2. OBJECTION MISHANDLING: When the prospect raised a concern, did the associate use the Aikido method from the playbook? Or did they make up facts, get defensive, or bulldoze past it?\n`;
  block += `3. RED LINE VIOLATIONS: Did the associate say anything from the RED LINES list (badmouthing competitors, promising 100% placement, guaranteeing salary, or naming specific partner universities this cycle)?\n`;
  block += `4. TONE & ENERGY: Did they sound like an admission counselor who cares, or a desperate salesman? Were they patient when explaining? Did they listen when the parent pushed back?\n`;
  block += `5. MISSED BUYING SIGNALS: Did the prospect show interest (asking about fees, campus, curriculum) and the associate failed to capitalize on it?\n`;
  block += `6. BOOKING FAILURE: Did the associate secure at least one parent for the 1:1 session? Did they offer two time slots? Did they confirm on WhatsApp?\n`;
  block += `7. OVER-PITCHING: Did the associate dump Kalvium's value proposition without first understanding the student's situation, priorities, and concerns?\n\n`;

  block += `=== CONTEXT-AWARE REWRITES INSTRUCTIONS ===\n`;
  block += `CRITICAL: You MUST generate EXACTLY 3 specific rewrites. LLMs often get lazy and only generate 1. You must find 5 distinct coaching moments from across the entire transcript.\n`;
  block += `For EACH of the 4 rewrites:\n`;
  block += `- Quote the EXACT words the associate said (in whatever language they used).\n`;
  block += `- Explain WHY it failed, referencing the specific playbook section they violated.\n`;
  block += `- Write a GOLDEN REWRITE using the Kalvium-specific response from the playbook. The rewrite must use real Kalvium facts and positioning, not generic sales advice.\n`;
  block += `- The golden rewrite MUST be in the exact same language as the original transcript (transliterated to English/Latin script, e.g., Tanglish for Tamil calls, Kanglish for Kannada calls) OR standard English. NEVER use Hinglish if the original call was not in Hindi/Hinglish.\n`;
  block += `- The golden rewrite should sound natural and human, like a real Kalvium top performer would say it.\n`;
  block += `IMPORTANT: Do NOT give generic coaching like "be more empathetic" or "build rapport". Every piece of feedback must reference specific Kalvium knowledge, call flow stages, objection responses, or red lines from the playbook.\n\n`;

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
3. Be HOSTILE in your grading. Your job is to find flaws, not to praise. If the transcript is in a regional language, TRANSLATE it fully before scoring.
4. A call scoring above 85% should be extremely rare. If you're giving high scores across the board, you are failing at your job.
CRITICAL INSTRUCTION FOR ALL OUTPUTS: The transcript may contain regional languages mixed with English (e.g. Hinglish, Tanglish). You MUST write all your output fields, summaries, coaching feedback, and extracted quotes in standard English. Translate any regional language into English before outputting it. DO NOT output text in Devanagari, Tamil, Telugu, or any non-Latin scripts.`;
}

function buildOmniPrompt(transcriptText, source, dataCaptureQuestions, pastCalls, leadState, filteredQualityChecks, params, videoTimeline = null) {
  const insightsP = buildInsightsPrompt(transcriptText, source, dataCaptureQuestions, pastCalls, leadState);
  const qualP = buildQualityCoachingPrompt(transcriptText, source, filteredQualityChecks, params, leadState, videoTimeline); 
  return insightsP + "\n\n=== QUALITY & COACHING INSTRUCTIONS ===\n" + qualP;
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
};
