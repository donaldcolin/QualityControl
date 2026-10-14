const fs = require('fs');
const path = require('path');
const { bdPlaybook, universityFeeKB, placementData } = require('./index');

const STATE_FILE_PATH = path.join(__dirname, '..', '..', 'config', '.gemini_cache_state.json');

// In-flight mutex promise to prevent concurrent workers from creating duplicate caches
let _inFlightCreationPromise = null;
let _cachedState = null;

function parseCsvLine(line) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsvSimple(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => obj[h.trim()] = vals[idx] || '');
    rows.push(obj);
  }
  return rows;
}

function getPhoneRubricText() {
  try {
    const phonePath = path.join(__dirname, '..', '..', 'config', 'qc_parameters_phone_v3.csv');
    if (!fs.existsSync(phonePath)) return 'No phone rubric file found.';
    const rows = parseCsvSimple(fs.readFileSync(phonePath, 'utf8'));
    let text = '';
    const groups = {};
    rows.forEach(r => {
      const cat = r.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });
    for (const [cat, params] of Object.entries(groups)) {
      text += `\n== Category: ${cat} ==\n`;
      params.forEach(p => {
        text += `- [${p.param_id}] ${p.parameter_name} (Max Score: ${p.max_score || 2})\n  Scoring Guide: ${p.scoring_prompt}\n  Evidence Required: ${p.evidence_required || 'timestamp + quote'}\n`;
      });
    }
    return text;
  } catch (err) {
    return `Error loading phone rubric: ${err.message}`;
  }
}

function getMeetRubricText() {
  try {
    const meetPath = path.join(__dirname, '..', '..', 'config', 'qc_parameters_video_v3.csv');
    if (!fs.existsSync(meetPath)) return 'No meet rubric file found.';
    const rows = parseCsvSimple(fs.readFileSync(meetPath, 'utf8'));
    let text = '';
    const groups = {};
    rows.forEach(r => {
      const cat = r.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(r);
    });
    for (const [cat, params] of Object.entries(groups)) {
      text += `\n== Category: ${cat} ==\n`;
      params.forEach(p => {
        text += `- [${p.param_id}] ${p.parameter_name} (Max Score: ${p.max_score || 2})\n  Scoring Guide: ${p.scoring_prompt}\n  Scale: ${p.scale || '2/1/0'}\n  Evidence Required: ${p.evidence_required || 'timestamp + quote'}\n`;
      });
    }
    return text;
  } catch (err) {
    return `Error loading meet rubric: ${err.message}`;
  }
}

/**
 * Builds the canonical Master Static Knowledge Base (~22,500 tokens).
 * Contains invariant information: BD Playbook, University Fee Matrix, Placement Data, Sales Rules,
 * and the complete canonical QC parameter rubrics for both Phone Calls and Video Meets.
 */
function getMasterStaticContext() {
  return `You are an Expert Quality Control Auditor & BD Coach for Kalvium.
Kalvium is a higher-education startup offering a Work-Integrated Computer Science Engineering degree.

CRITICAL SALES CYCLE RULES (AY 2027):
1. FIRST PHONE CALL: The goal is NEVER to ask for registration or payment. The ONLY goal is to build interest and invite the student and at least one parent to attend a 1-on-1 Google Meet demo.
2. GOOGLE MEET DEMO: During the video call, the counselor discusses the exam details and pushes for K-NET Exam Registration.
3. EXAM: The student writes the K-NET exam after 2 months.
4. INTERVIEW: If they pass the exam, they attend an interview (they only get ONE chance).
5. PROVISIONAL ADMISSION: If they pass the interview, they pay 10% of the total university fees to secure provisional admission.

EXPECTED 1:1 COUNSELLING BOOKING CALL FLOW (10 STAGES):
1. Warm Opening: Establish context, ask about 12th Std stream (note: in South India, 'Bio-Maths' is PCMB and 'Computer Science' is PCMC — both include Physics, Chemistry & Maths and qualify for B.Tech CSE), and check if they know Kalvium.
2. Probing and Aligning: Understand their current college search status, post-12th plans, and learning style (practical vs theory).
3. Understand Student + Parent Priorities: Go past generic priorities and surface internal conflicts.
4. Introduce Kalvium Based on Answers: Create curiosity about the gap in the current education market before introducing Kalvium.
5. Why connect early?: Frame KNET as a parallel pathway and timing advantage.
6. Create Need for 1:1 Counselling: De-sell it; explain it's not a webinar and it's to gather info.
7. University Structure (If asked): Student indicates preferred location/state; mentioning genuine partner universities as examples is completely permitted and encouraged as context.
8. Book the Counselling: Secure the decision-maker (at least one parent). Use the 'information decay' argument. Offer TWO specific slots.
9. Close: Lock commitment, send WhatsApp, set up logistics.
10. Registration Assist (post-session if applicable): Navigating portals and anti-fraud warnings.

FATAL COMPLIANCE RED LINES & GUARDRAILS:
- FP-06: Never claim internships or stipends make the degree 'partly self-funding' or pay for college fees.
- FP-10: Never improvise fees, payment schedules, or unauthorized installment schemes.
- FP-14: Never stack non-price advantages or invent unapproved discounts.
- FP-17: Never misrepresent outlier salaries (e.g. 36 LPA) as average, minimum, or normal.
- VP-10: Never quote unverified figures, unapproved partner counts, or unverified placement statistics.
- LC-11: Never verbally handle or ask for sensitive customer credentials (OTP, PIN, Aadhaar).
- LC-12: Never solicit direct money transfers, personal UPI, or payments outside official portals.
- 100% Placement Guarantee: Strictly prohibited. The canonical placed figure is 81.8% (90.4% interned).

STRICT AUDITOR MANDATE (ZERO LENIENCY — NO UNPROVEN PASSES):
You are a rigorous, unsparing Quality Auditor for Kalvium. Your mandate is to maintain institutional excellence.
A typical flawed sales call should score between 40% and 55%. Calls scoring above 80% should be exceptional. If an associate cuts corners, lectures, skips discovery, accepts obstacles without technique, or dominates conversation, you MUST heavily penalize them.

SCORING THRESHOLDS:
- 'Done' (Full Marks: 2/2): Award ONLY if the associate fully executed the specific, professional Kalvium playbook technique with verbatim transcript proof. Casual mentions, superficial nods, or half-measures DO NOT qualify.
- 'Partially Done' (Partial Marks: 1/2): Award ONLY if the associate actively attempted the structured playbook technique but missed a secondary detail. If the associate merely engaged in casual conversation or made an unguided remark, score MUST be 0.
- 'Needs Improvement' (Failed: 0/2): The associate did not execute the technique, merely chatted casually, lectured without interaction, accepted obstacles passively, monologued (>75% talk share), got argumentative, or skipped the stage entirely.

MANDATORY FAILURE TRIGGERS (NON-NEGOTIABLE 0/2 or 1/2):
1. DP-01 (Post-12th Plan Elicited Before Any Pitch): Score 0 if associate asked subjects/stream and immediately jumped to Kalvium without exploring what the student wants to do after 12th.
2. DP-02 (College Search Status Established): Score 0 unless associate specifically probed whether they are shortlisting, have applied, or visited colleges.
3. DP-03 (Competing Exam Inventory Taken): Score 0 if associate did not proactively ask which entrance exams (JEE, CET, etc.) the student is preparing for.
4. DP-04 (Class, Stream, Board, Location): Score max 1 if only stream is asked but board or location is omitted. Score 0 if stream was not probed.
5. DP-05 (Decision-Maker Explicitly Mapped): Score 0 if associate did not ask who makes the final education decision at home.
6. DP-06 (Priorities Elicited and Ranked): Score 0 if associate tells the prospect what their priorities should be instead of eliciting and ranking them.
7. DP-08 (Existing Kalvium Awareness Probed First): Score max 1 if associate asks what they know but ignores the answer and delivers a generic pitch anyway. Score 0 if not probed.
8. DP-09 (Student Ambition or Fear Surfaced): Score 0 if student's genuine ambition, worry, or fear was not elicited in their own words.
9. VP-01 (Market Gap Established Before Kalvium Is Named): Score 0 if associate named and pitched Kalvium without first building curiosity about the education market gap.
10. VP-02 (Syllabus-Obsolescence Chain — Prospect States the Conclusion): MANDATORY SOCRATIC METHOD. The associate must ask questions that lead the PROSPECT to say traditional syllabi are outdated. If the associate lectures or asserts it themselves without the prospect stating the conclusion, SCORE MUST BE 0!
11. VP-04 (Practical Learning Described Concretely): Score 0 if associate only used buzzwords ('practical', 'hands-on') without describing actual projects on laptop from day one.
12. VP-05 (Quantified Contrast Against Normal B.Tech): Score 0 unless associate gives a specific vivid contrast (e.g. dozens of real projects vs 1 final year project).
13. VP-06 (Internships Described Without Timing Claim): Score 0 if associate specifies an internship year (e.g. 'from 2nd year') or quotes stipend amounts.
14. VP-08 (Peer Quality via KNET Explained): Score 0 if KNET is described merely as an exam or fee barrier without explaining that it filters classroom peers (no donation/management seats).
15. VP-09 (Marks-Irrelevance Inversion Delivered): Score 0 unless associate explicitly explains that high board marks do not buy admission and low marks do not disqualify.
16. OH-01 (Competing Exam Never Disparaged): Score 0 if associate mocks JEE/NEET or belittles student's chance.
17. OH-05 ('We'll Think About It' Met With Respect, Not Pressure): Score 0 if associate pushes aggressively, repeats the ask, or creates fake urgency.
18. IP-01 (Parent Presence Explained, Not Just Asserted): Associate MUST deliver the 'information-decay' argument (student retains 75%, conveys 50%, parents hear 25%). Merely saying 'bring parents' without explaining why MUST SCORE 0!
19. IP-02 (At Least One Parent Committed, Father Preferred): If father's absence is accepted without attempting the information-decay argument, score MAX 1. If no parent committed, score 0.
20. IP-09 (Parental Availability Established Before Proposing a Time): Score 0 if associate proposes slots without first asking when parents are home and available.
21. IP-10 (Integrity / No-Payment Guidance Given): Score 0 if associate fails to proactively state that no money should be paid to any individual outside official portals.
22. CC-01 (Prospect Given Room to Speak): If associate talk-share exceeds 75% or delivers lengthy monologues answered only in monosyllables, SCORE MUST BE 0!
23. CC-06 (Two Specific Slots Offered): Score 0 if associate asks an open-ended 'when are you free?' or offers only a single time slot without an alternative.
24. CC-07 (A Specific Day and Time Locked and Confirmed Back): Score 0 if call ends on a vague time ('tomorrow evening', 'sometime Sunday') without a specific day and clock time.
25. CC-09 (Prospect Set Up to Arrive Prepared): Score 0 if associate omits instructing them to join on a laptop for screen sharing.

--- GROUND TRUTH KNOWLEDGE BASE: UNIVERSITY FEE STRUCTURE ---
${universityFeeKB || 'No fee structure file loaded.'}

--- GROUND TRUTH KNOWLEDGE BASE: 2026 PLACEMENT METRICS & COMPLIANCE RULES ---
${placementData || 'No placement data file loaded.'}

--- KALVIUM BD COACHING PLAYBOOK ---
${bdPlaybook || 'No BD playbook loaded.'}

--- CANONICAL QUALITY RUBRIC: 1:1 PHONE COUNSELLING CALLS (46 PARAMETERS) ---
${getPhoneRubricText()}

--- CANONICAL QUALITY RUBRIC: GOOGLE MEET VIDEO DEMONSTRATIONS (77 PARAMETERS) ---
${getMeetRubricText()}

--- CANONICAL DATA CAPTURE QUESTIONS (10 FIELDS - AUDIO & VIDEO) ---
1. Competitors Mentioned: What competitors or alternative options did the customer mention?
2. Customer Location: What is the customer's location (city/district)?
3. JEE/Other Exams: Is the customer preparing for JEE or have they written any other exams?
4. Decision Maker: Who is the decision maker at home?
5. Course/College Interested In: Which course/college is the customer planning to join?
6. Email ID: What is the customer's email ID?
7. JEE Coaching: Is the student taking JEE coaching?
8. Stream: Which stream or subject group does the student belong to (e.g. PCM, PCB, Commerce, Arts)?
9. Grade: What grade or class is the student currently in (e.g. 11th, 12th, dropper)?
10. Laptop Access: Does the student own or have access to a laptop or desktop computer to attend exams and classes?
`;
}

/**
 * Checks whether context caching is enabled via environment flag.
 */
function isCachingEnabled() {
  return process.env.ENABLE_CONTEXT_CACHING !== 'false';
}

/**
 * Loads cache state from disk if available.
 */
function loadStateFromDisk() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      _cachedState = JSON.parse(data);
      return _cachedState;
    }
  } catch (err) {
    console.warn(`[CacheManager] Could not read state from disk: ${err.message}`);
  }
  return null;
}

/**
 * Saves cache state to disk.
 */
function saveStateToDisk(state) {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(state, null, 2), 'utf8');
    _cachedState = state;
  } catch (err) {
    console.warn(`[CacheManager] Could not save state to disk: ${err.message}`);
  }
}

/**
 * Checks if a given cache state is valid and has at least bufferMinutes of remaining lifetime.
 */
function isCacheFresh(state, model, bufferMinutes = 30) {
  if (!state || !state.cacheName || state.model !== model) return false;
  if (!state.expireTime) return false;

  const expireTimeMs = new Date(state.expireTime).getTime();
  const nowMs = Date.now();
  const bufferMs = bufferMinutes * 60 * 1000;

  return expireTimeMs > (nowMs + bufferMs);
}

/**
 * Retrieves the active Gemini context cache resource name, creating or auto-renewing if needed.
 * Thread-safe: Uses an in-flight promise to prevent concurrent calls from spawning multiple caches.
 * 
 * @param {object} ai - GoogleGenAI client instance
 * @param {string} model - Model name (e.g., 'gemini-3.5-flash-lite')
 * @returns {Promise<string|null>} - Cache resource name (e.g. 'cachedContents/xyz') or null if disabled
 */
async function getActiveCache(ai, model) {
  if (!isCachingEnabled()) {
    return null;
  }
  if (!ai || !ai.caches) {
    console.warn('[CacheManager] ai.caches is not available on GoogleGenAI client');
    return null;
  }

  // 1. Check in-memory / disk state
  let state = _cachedState || loadStateFromDisk();
  if (state && isCacheFresh(state, model)) {
    return state.cacheName;
  }

  // 2. Concurrency Lock: If another request is currently creating a cache, await it
  if (_inFlightCreationPromise) {
    return await _inFlightCreationPromise;
  }

  // 3. Initiate cache creation with mutex
  _inFlightCreationPromise = (async () => {
    try {
      // Re-check state inside lock
      state = _cachedState || loadStateFromDisk();
      if (state && isCacheFresh(state, model)) {
        return state.cacheName;
      }

      console.log(`⚡ [CacheManager] Generating Gemini Context Cache for model: ${model}...`);
      const staticContext = getMasterStaticContext();
      const oldCacheName = state?.cacheName;

      // Create new cache with 24h TTL
      const newCache = await ai.caches.create({
        model,
        config: {
          contents: [{ role: 'user', parts: [{ text: staticContext }] }],
          ttl: '86400s' // 24 hours
        }
      });

      console.log(`✅ [CacheManager] Cache created: ${newCache.name} (expires: ${newCache.expireTime})`);

      const newState = {
        model,
        cacheName: newCache.name,
        expireTime: newCache.expireTime,
        createdAt: new Date().toISOString()
      };
      saveStateToDisk(newState);

      // Asynchronously cleanup the old expired/evicted cache
      if (oldCacheName && oldCacheName !== newCache.name) {
        ai.caches.delete({ name: oldCacheName }).catch(err => {
          // Non-fatal cleanup warning
          console.warn(`[CacheManager] Old cache cleanup warning: ${err.message}`);
        });
      }

      return newCache.name;
    } catch (err) {
      console.error(`❌ [CacheManager] Failed to create Gemini context cache:`, err.message);
      return null;
    } finally {
      _inFlightCreationPromise = null;
    }
  })();

  return await _inFlightCreationPromise;
}

/**
 * Invalidates the current cache state (e.g. upon receiving a 404 NOT_FOUND from Gemini).
 * Forces the next getActiveCache() call to create a fresh cache resource.
 */
async function invalidateCache(cacheNameToInvalidate = null) {
  console.log(`⚠️ [CacheManager] Invalidating cache pointer: ${cacheNameToInvalidate || 'all'}`);
  _cachedState = null;
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH);
    }
  } catch (e) {
    // ignore
  }
}

module.exports = {
  getMasterStaticContext,
  isCachingEnabled,
  getActiveCache,
  invalidateCache
};
