const { buildAttendeeTimeline, formatTime } = require('../services/qc_engine/attendance');

const seg = (speaker, start, end, text = 'hi') => ({ speaker, start, end, text });
const byPerson = r => Object.fromEntries(r.attendee_timeline.map(a => [a.person, a]));

test('no speech gives no card', () => {
  expect(buildAttendeeTimeline([], null, 600)).toBeNull();
  expect(buildAttendeeTimeline([seg('Advisor', 0, 5, '  ')], null, 600)).toBeNull();
});

test('silent waiting time before the first word is not the meeting start', () => {
  const r = buildAttendeeTimeline([seg('Advisor', 1517, 1520), seg('Student', 1520, 1530), seg('Advisor', 6800, 6835)], null, 6840);
  expect(r.actual_meeting_start_time).toBe('25:17');
  expect(byPerson(r).Advisor.status).toBe('Present');
});

test('late joiner and early leaver are flagged', () => {
  const r = buildAttendeeTimeline([
    seg('Advisor', 0, 10), seg('Student', 5, 20), seg('Parent', 600, 610), seg('Advisor', 3500, 3600),
  ], null, 3600);
  expect(byPerson(r).Parent.status).toBe('Joined late, Left early');
  expect(byPerson(r).Student.status).toBe('Left early');
  expect(byPerson(r).Advisor.status).toBe('Present');
});

test('a quiet customer stays present while the camera shows enough people', () => {
  const video = { face_timeline: [{ owner: 'customer', camera_on: true, faces_detected: 2, start_time: 0, end_time: 3600 }] };
  const r = buildAttendeeTimeline([
    seg('Advisor', 0, 10), seg('Student', 10, 20), seg('Parent', 30, 40), seg('Advisor', 3590, 3600),
  ], video, 3600);
  expect(byPerson(r).Parent.end_time).toBe('1:00:00');
  expect(byPerson(r).Parent.status).toBe('Present');
});

test('time format switches to H:MM:SS after an hour', () => {
  expect(formatTime(75)).toBe('1:15');
  expect(formatTime(6835)).toBe('1:53:55');
});
