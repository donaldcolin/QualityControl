const supabase = require('../../config/supabase');
const { GEMINI_MODEL, ai } = require('./index');
const { safeParseGeminiJSON } = require('./safe_parse');
const { callGeminiWithRetry } = require('./call_gemini');

function triageCall(callData, transcriptText = '', pastCalls = []) {
  const duration = callData?.duration_sec || 0;
  const source = callData?.source || 'phone_call';
  
  // Extract text from transcriptText, callData.transcript, or segments
  let rawText = transcriptText || callData?.transcript || '';
  if (!rawText && callData?.segments) {
    try {
      const segs = typeof callData.segments === 'string' ? JSON.parse(callData.segments) : callData.segments;
      if (Array.isArray(segs)) {
        rawText = segs.map(s => s.text_en || s.text || '').join(' ');
      }
    } catch (e) {
      rawText = '';
    }
  }
  const text = rawText.toLowerCase();
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  // 1. HIGHEST PRIORITY: High-Risk Compliance Triggers (Immediate Escalation to T2)
  const complianceRegexes = [
    /(?:100%|hundred\s*percent)\s*(?:placement|job|guarantee)/i,
    /(?:guaranteed?|pakka|assured)\s*(?:placement|job|package)/i,
    /(?:average|minimum|starting)\s*(?:package|salary)?[\s\S]{0,35}(?:36\s*lpa|36\s*lakh)/i,
    /(?:36\s*lpa|36\s*lakh)[\s\S]{0,35}(?:average|minimum|starting)/i,
    /(?:4[0-9]|5[0-9]|6[0-9]|7[0-9]|8[0-9]|9[0-9]|100)\s*(?:lpa|lakhs?)/i,
    /(?:self[- ]?fund|partly\s+self[- ]funding|pays?\s+for\s+itself)/i,
    /(?:send|transfer|gpay|phonepe|upi)[\s\S]{0,40}(?:to\s+me|my\s+(?:number|account|upi|id)|personal)/i,
    /(?:otp|pin|aadhaar|aadhar)\b/i,
    /(?:scam|police|court|fraud|refund|lawyer)/i
  ];
  const matched = complianceRegexes.find(r => r.test(text));
  if (matched) {
    return { tier: 'T2', valid: true, reason: 'High-risk compliance trigger detected in transcript.', compliance_trigger: true };
  }

  // 2. Immediate Drop / Non-connect Filter (< 45 seconds)
  if (duration > 0 && duration < 45) {
    return { tier: 'T0', valid: false, reason: `Call duration (${duration}s) under 45 seconds.` };
  }

  // 3. Google Meet Video Demos are ALWAYS T2 (Requires multi-modal computer vision & face tracking)
  if (source === 'google_meet') {
    return { tier: 'T2', valid: true, reason: 'Google Meet video demonstration requires multi-modal sensor fusion.' };
  }

  // 4. Phone Call Low-Interaction & Monologue Checks
  if (callData?.talk_to_listen_ratio) {
    const [agentPct, custPct] = callData.talk_to_listen_ratio.split(':').map(Number);
    if (custPct === 0) {
      return { tier: 'T0', valid: false, reason: 'Customer talk ratio is 0% (Voicemail / Monologue).' };
    }
  }
  const disposition = (callData?.disposition || callData?.call_status || '').toLowerCase();
  if (['busy', 'no answer', 'no_answer', 'wrong number', 'wrong_number', 'voicemail', 'dropped'].includes(disposition)) {
    return { tier: 'T0', valid: false, reason: `Disposition is ${disposition} (Non-conversation).` };
  }

  if (wordCount < 25) {
    if (wordCount >= 8 && isT1ForwardCall(text)) {
      return {
        tier: 'T1',
        sub_tier: 'T1_FORWARD',
        valid: true,
        reason: 'Prospect deferred call or forwarded to another family member/callback time.'
      };
    }
    return { tier: 'T0', valid: false, reason: `Transcript has only ${wordCount} words (low interaction / silence).` };
  }

  // 4. T2 Triggers: In-depth counseling calls (> 180 seconds / 3 minutes)
  if (duration > 180) {
    return { tier: 'T2', valid: true, reason: `In-depth counseling call (${Math.round(duration / 60)} mins) requires deep coaching.` };
  }

  // 5. T1 Sub-tier Classification (45s to 180s)
  // Check for Pitch Continuation (Reconnected dropped call)
  const reconnectPhrases = [
    'call disconnected', 'call cut', 'got disconnected', 'network issue', 
    'call disconnect', 'as i was saying', 'cut ho gaya', 'voice break', 
    'hear me now', 'cut aayiduchu', 'line cut', 'redial'
  ];
  const hasReconnectPhrase = reconnectPhrases.some(phrase => text.includes(phrase));
  const hasRecentLongCall = Array.isArray(pastCalls) && pastCalls.some(pc => (pc.duration_sec || 0) > 180);

  if (hasReconnectPhrase || hasRecentLongCall) {
    return {
      tier: 'T1',
      sub_tier: 'T1_CONTINUATION',
      valid: true,
      reason: 'Reconnected pitch continuation after call drop (Evaluates Closing & Logistics without discovery penalty).'
    };
  }

  // Check for Meeting / Exam Reminder & Logistics
  const reminderKeywords = ['reminder', 'meeting', 'meet', 'google meet', 'slot', 'knet', 'exam', 'laptop', 'link', 'whatsapp', 'join'];
  if (reminderKeywords.some(kw => text.includes(kw))) {
    return {
      tier: 'T1',
      sub_tier: 'T1_REMINDER',
      valid: true,
      reason: 'Meeting/Exam Reminder touchpoint (Logistical Audit).'
    };
  }

  // Check for Call Forwarding / Deferral (e.g. unavailable, call son/father, give number/time)
  if (isT1ForwardCall(text)) {
    return {
      tier: 'T1',
      sub_tier: 'T1_FORWARD',
      valid: true,
      reason: 'Prospect deferred call or forwarded to another family member/callback time.'
    };
  }

  // Default T1: Routine follow-up / reschedule
  return {
    tier: 'T1',
    sub_tier: 'T1_ROUTINE',
    valid: true,
    reason: 'Routine follow-up / check-in call (Lean Audit).'
  };
}

/**
 * Detects whether an interaction is a call forward / deferral where the prospect
 * is unavailable and asks to call a son, father, provide a number, or callback at another time.
 */
function isT1ForwardCall(text) {
  if (!text) return false;

  const unavailabilityPatterns = [
    'not available', 'not free', 'busy right now', 'in a meeting', 'in meeting',
    'driving', 'at work', 'in office', 'in class', 'cant talk', "can't talk",
    'cannot talk', 'call me later', 'call later', 'traveling', 'travelling',
    'call back later', 'talk later', 'not right now', 'wrong time',
    // Hindi / Hinglish
    'baad mein baat', 'baad me baat', 'baad mein call', 'baad me call',
    'abhi busy', 'office mein', 'office me', 'meeting mein', 'meeting me',
    'free nahi', 'free nai', 'shaam ko call', 'sham ko call', 'kal call',
    'driving kar raha', 'driving kar rahi', 'baad me', 'baad mein',
    // Tamil / Tanglish
    'ippo pesa mudiyadhu', 'ippo mudiyadhu', 'busy-aa irukken', 'driving-la irukken', 'office-la irukken',
    'office la irukken', 'apram call pannunga', 'aprom call pannunga',
    'naalaiku call pannunga', 'evening call pannunga', 'pesa mudiyala'
  ];

  const forwardingPatterns = [
    // English
    'call my son', 'call my father', 'talk to my father', 'speak to my father',
    'call my dad', 'call my mom', 'call my mother', 'call my husband',
    'speak with my daughter', 'talk to my son', 'call my daughter', 'speak to my son',
    'he is looking', 'she is looking', 'his number', 'her number',
    "my son's number", "my father's number", 'call his number', 'call her number',
    'take his number', 'take her number', 'give you his number', 'give you her number',
    'speak to him', 'speak to her', 'contact my father', 'contact my son',
    // Hindi / Hinglish
    'papa se baat', 'father se baat', 'bete se baat', 'bete ko call',
    'father ko call', 'papa ko call', 'unka number', 'unse baat', 'unhe call',
    'ladke ko call', 'ladke se baat', 'husband se baat',
    // Tamil / Tanglish
    'en paiyan kitta', 'paiyan kitta', 'father kitta', 'appa kitta',
    'avaru number', 'avanga kitta', 'avarkitta pesunga', 'en ponnu kitta',
    'ponnu kitta'
  ];

  const hasPhoneRegex = /(?:\+91[\-\s]?)?[6-9]\d{9}|[6-9]\d{4}\s*\d{5}/;
  const hasTimeRegex = /(?:(?:call\s*(?:me\s*)?(?:back\s*)?)?(?:after|around|at)\s*(?:[1-9]|1[0-2])\s*(?:pm|am|o'clock|baje))|(?:tomorrow\s*(?:at|after|around|morning|evening|shaam)?)|(?:shaam\s*ko|evening\s*call|morning\s*call|kal\s*call)/i;

  const hasUnavailability = unavailabilityPatterns.some(p => text.includes(p));
  const hasForwarding = forwardingPatterns.some(p => text.includes(p));
  const hasPhone = hasPhoneRegex.test(text);
  const hasTime = hasTimeRegex.test(text);

  // Trigger T1_FORWARD if:
  // 1. Explicitly forwarding to a family member (e.g. "call my father", "call my son on 9876543210")
  // 2. Unavailability paired with callback request, phone number, or specific callback time
  return hasForwarding || (hasUnavailability && (hasPhone || hasTime));
}

async function evaluateLeadJourney(leadId) {
  // Deterministic multi-call synthesis is performed zero-cost in qc_evaluations.js (lines 681-776).
  // This avoids burning 4,000-8,000 un-cached Gemini tokens per call.
  console.log(`⚡ [Journey Synthesis] Lead ${leadId} updated via deterministic zero-cost synthesis.`);
}

module.exports = {
  triageCall,
  isT1ForwardCall,
  evaluateLeadJourney,
};
