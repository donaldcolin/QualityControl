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
