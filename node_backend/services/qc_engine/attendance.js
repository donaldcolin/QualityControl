// Attendee presence for Meet demos, computed from real timestamps instead of asking the LLM:
// who spoke when (ASR segments) + whose camera was on screen (video_analyzer face_timeline).

const ADVISOR_ROLES = new Set(['Advisor', 'Advisor: Senior', 'Agent']);
const LATE_JOIN_SEC = 120;
const EARLY_LEAVE_SEC = 300;

function formatTime(sec) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * Returns { actual_meeting_start_time, attendee_timeline: [{ person, start_time, end_time, status }] }
 * or null when there is no usable speech.
 */
function buildAttendeeTimeline(segments, videoTimeline, durationSec) {
  const spoken = (segments || []).filter(s => s && s.speaker && String(s.text || '').trim() && Number.isFinite(s.start));
  if (spoken.length === 0) return null;

  const roles = new Map(); // speaker -> { first, last }
  for (const s of spoken) {
    const r = roles.get(s.speaker) || { first: s.start, last: s.end ?? s.start };
    r.first = Math.min(r.first, s.start);
    r.last = Math.max(r.last, s.end ?? s.start);
    roles.set(s.speaker, r);
  }

  const events = Array.isArray(videoTimeline?.face_timeline) ? videoTimeline.face_timeline : [];
  const customerOn = events.filter(e => e.owner === 'customer' && e.camera_on !== false);
  const lastAssociate = Math.max(-1, ...events.filter(e => e.owner === 'associate').map(e => e.end_time));
  const customerRoleCount = [...roles.keys()].filter(r => !ADVISOR_ROLES.has(r)).length;
  // A quiet customer stays "present" while the customer camera shows enough people for every customer role
  const lastCustomerCam = Math.max(-1, ...customerOn.filter(e => (e.faces_detected || 0) >= customerRoleCount).map(e => e.end_time));

  const firstSpeech = Math.min(...[...roles.values()].map(r => r.first));
  const meetingStart = Math.min(firstSpeech, ...customerOn.map(e => e.start_time));
  const callEnd = Math.max(durationSec || 0, ...[...roles.values()].map(r => r.last));

  const attendee_timeline = [...roles.entries()]
    .sort((a, b) => a[1].first - b[1].first)
    .map(([person, r]) => {
      const camEnd = ADVISOR_ROLES.has(person) ? lastAssociate : lastCustomerCam;
      const end = Math.min(callEnd, Math.max(r.last, camEnd));
      let status = 'Present';
      if (r.first - meetingStart > LATE_JOIN_SEC) status = 'Joined late';
      if (callEnd - end > EARLY_LEAVE_SEC) status = status === 'Joined late' ? 'Joined late, Left early' : 'Left early';
      return { person, start_time: formatTime(r.first), end_time: formatTime(end), status };
    });

  return { actual_meeting_start_time: formatTime(meetingStart), attendee_timeline };
}

module.exports = { buildAttendeeTimeline, formatTime };
