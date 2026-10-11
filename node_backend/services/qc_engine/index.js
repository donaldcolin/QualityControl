const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

// ── Active model — change here to switch globally ─────────────────────────────
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

const geminiApiKey = process.env.GEMINI_API_KEY || '';
let ai = null;
if (geminiApiKey) {
  ai = new GoogleGenAI({ apiKey: geminiApiKey });
} else {
  console.warn("WARNING: Gemini API Key is missing. AI operations will fail.");
}

const configDir = path.join(__dirname, '..', '..', 'config');

// Load Hybrid Knowledge Base (AY2026 Historical Data)
let knowledgeBase = null;
try {
  const kbData = fs.readFileSync(path.join(configDir, 'knowledge_base.json'), 'utf8');
  knowledgeBase = JSON.parse(kbData);
  console.log(`Loaded Hybrid Knowledge Base with ${knowledgeBase.total_leads_analyzed} historical leads.`);
} catch (err) {
  console.warn("WARNING: knowledge_base.json not found or invalid in config/. Lead Intelligence will lack historical grounding.");
}

// Load BD Coaching Playbook
let bdPlaybook = '';
try {
  bdPlaybook = fs.readFileSync(path.join(configDir, 'bd_playbook.txt'), 'utf8');
  console.log(`Loaded BD Playbook (${bdPlaybook.length} chars) — Kalvium-specific coaching active.`);
} catch (err) {
  console.warn("WARNING: bd_playbook.txt not found in config/. AI coaching will be generic.");
}

// Load University Fee Structure Knowledge Base
let universityFeeKB = '';
try {
  universityFeeKB = fs.readFileSync(path.join(configDir, 'university_fee_structure.csv'), 'utf8');
  console.log(`Loaded University Fee Structure KB`);
} catch (err) {
  console.warn("WARNING: university_fee_structure.csv not found.");
}

// Ensure the index itself can be imported by workflows before requiring them to avoid circular dependency issues
module.exports = {
  ai,
  GEMINI_MODEL,
  knowledgeBase,
  bdPlaybook,
  universityFeeKB
};

const database = require('./database');
const schemas = require('./schemas');
const prompts = require('./prompts');
const workflows = require('./workflows');
const safeParse = require('./safe_parse');
const { callGeminiWithRetry } = require('./call_gemini');

// Helper pre-bound to the active ai instance
function generateContentWithRetry(params, options) {
  return callGeminiWithRetry(ai, params, options);
}

// Export everything to match the old qc_engine.js
Object.assign(module.exports, {
  ...database,
  ...schemas,
  ...prompts,
  ...workflows,
  ...safeParse,
  callGeminiWithRetry,
  generateContentWithRetry
});
