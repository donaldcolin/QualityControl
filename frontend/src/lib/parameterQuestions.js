/**
 * Frontend Third-Person Question Mapping for QC Parameters.
 * Automatically displays plain-English questions for associates and TLs
 * for both new and historical call evaluations.
 */

export const PARAM_QUESTIONS = {
  // Discovery & Probing
  'DP-01': 'Did the associate find out the student\'s post-12th college plans before pitching?',
  'Post-12th Plan Elicited Before Any Pitch': 'Did the associate find out the student\'s post-12th college plans before pitching?',

  'DP-02': 'Did the associate find out where the family is in their college search (shortlisting, applied, or not started)?',
  'College Search Status Established': 'Did the associate find out where the family is in their college search (shortlisting, applied, or not started)?',

  'DP-03': 'Did the associate proactively ask which entrance exams (JEE, CET, etc.) the student is preparing for?',
  'Competing Exam Inventory Taken': 'Did the associate proactively ask which entrance exams (JEE, CET, etc.) the student is preparing for?',

  'DP-04': 'Did the associate establish the student\'s class, stream, board, and location?',
  'Class, Stream, Board and Location Captured': 'Did the associate establish the student\'s class, stream, board, and location?',

  'DP-05': 'Did the associate ask who makes the final college decision at home?',
  'Decision-Maker Explicitly Mapped': 'Did the associate ask who makes the final college decision at home?',

  'DP-06': 'Did the associate ask what matters most to the family (academics, placements, campus, fees)?',
  'Priorities Elicited and Ranked': 'Did the associate ask what matters most to the family (academics, placements, campus, fees)?',

  'DP-08': 'Did the associate probe what the family already knows about Kalvium before explaining it?',
  'Existing Kalvium Awareness Probed First': 'Did the associate probe what the family already knows about Kalvium before explaining it?',

  'DP-09': 'Did the associate elicit the student\'s own ambition, worry, or fear in their own words?',
  'Student\'s Own Ambition or Fear Surfaced': 'Did the associate elicit the student\'s own ambition, worry, or fear in their own words?',

  // Value Pitch & Kalvium Differentiators
  'VP-01': 'Did the associate build curiosity about the education curriculum gap before naming Kalvium?',
  'Market Gap Established Before Kalvium Is Named': 'Did the associate build curiosity about the education curriculum gap before naming Kalvium?',

  'VP-02': 'Did the associate guide the prospect to conclude that traditional college syllabi are outdated?',
  'Syllabus-Obsolescence Chain — Prospect States the Conclusion': 'Did the associate guide the prospect to conclude that traditional college syllabi are outdated?',

  'VP-03': 'Did the associate contrast Kalvium with local state entry routes (e.g. KCET, EAMCET, management quota)?',
  'Local Entry-Route Contrast Named': 'Did the associate contrast Kalvium with local state entry routes (e.g. KCET, EAMCET, management quota)?',

  'VP-04': 'Did the associate describe concrete, real-world projects on a laptop from day one?',
  'Practical Learning Described Concretely': 'Did the associate describe concrete, real-world projects on a laptop from day one?',

  'VP-05': 'Did the associate contrast Kalvium against traditional 4-year theory programs with concrete numbers?',
  'Quantified or Vivid Contrast Against a Normal B.Tech': 'Did the associate contrast Kalvium against traditional 4-year theory programs with concrete numbers?',

  'VP-06': 'Did the associate describe internships without making unauthorized year-based or stipend claims?',
  'Internships Described Without a Timing Claim': 'Did the associate describe internships without making unauthorized year-based or stipend claims?',

  'VP-07': 'Did the associate explain that the curriculum updates annually for the student\'s graduating batch?',
  'Curriculum Currency Anchored to the Student\'s Own Years': 'Did the associate explain that the curriculum updates annually for the student\'s graduating batch?',

  'VP-08': 'Did the associate explain how KNET filters classroom peer quality (no donation seats)?',
  'Peer Quality via KNET Explained': 'Did the associate explain how KNET filters classroom peer quality (no donation seats)?',

  'VP-09': 'Did the associate explain that 12th board marks do not buy admission into Kalvium?',
  'Marks-Irrelevance Inversion Delivered': 'Did the associate explain that 12th board marks do not buy admission into Kalvium?',

  'VP-10': 'Did the associate stick strictly to approved fact sheet figures (no fake placement or partner claims)?',
  'All Figures Within the Approved Fact Sheet': 'Did the associate stick strictly to approved fact sheet figures (no fake placement or partner claims)?',

  // Objection Handling & De-escalation
  'OH-01': 'Did the associate respect competing entrance exams without belittling the student\'s prospects?',
  'Competing Exam Never Disparaged': 'Did the associate respect competing entrance exams without belittling the student\'s prospects?',

  'OH-02': 'Did the associate position Kalvium alongside the family\'s existing plans rather than forcing a choice?',
  'Kalvium Positioned as Additional, Not a Replacement': 'Did the associate position Kalvium alongside the family\'s existing plans rather than forcing a choice?',

  'OH-03': 'Did the associate acknowledge competitors respectfully before contrasting Kalvium\'s model?',
  'Competitor Acknowledged, Then Contrasted': 'Did the associate acknowledge competitors respectfully before contrasting Kalvium\'s model?',

  'OH-04': 'Did the associate defer detailed fee discussions to the 1:1 session without inventing figures?',
  'Fees Handled Without Improvising a Figure': 'Did the associate defer detailed fee discussions to the 1:1 session without inventing figures?',

  'OH-05': 'Did the associate respect hesitations without being aggressive, pushy, or creating fake urgency?',
  '"We\'ll Think About It" Met With Respect, Not Pressure': 'Did the associate respect hesitations without being aggressive, pushy, or creating fake urgency?',

  'OH-06': 'Did the associate explain that KNET tests aptitude and problem solving, not PCM syllabus?',
  'Exam Difficulty De-risked': 'Did the associate explain that KNET tests aptitude and problem solving, not PCM syllabus?',

  'OH-07': 'Did the associate answer brand unfamiliarity with verifiable facts rather than hype?',
  'Unfamiliarity Answered With Facts, Not Overselling': 'Did the associate answer brand unfamiliarity with verifiable facts rather than hype?',

  'OH-08': 'Did the associate pause selling and listen empathetically when anger or hardship was shared?',
  'Hardship or Anger Triggered Listening, Not Selling': 'Did the associate pause selling and listen empathetically when anger or hardship was shared?',

  'OH-09': 'Did the associate explain placements realistically without promising 100% guarantees or outlier salaries?',
  'Placements Answered Honestly': 'Did the associate explain placements realistically without promising 100% guarantees or outlier salaries?',

  'OH-10': 'Did the associate avoid toxic scarcity tactics (e.g. claiming seats will vanish immediately)?',
  'No Hard Sell, Scarcity or Fear Pressure': 'Did the associate avoid toxic scarcity tactics (e.g. claiming seats will vanish immediately)?',

  // Intent Signals & Parental Buy-in
  'IP-01': 'Did the associate give the information-decay reason why both parents must attend the counseling demo?',
  'Parent Presence Explained, Not Just Asserted': 'Did the associate give the information-decay reason why both parents must attend the counseling demo?',

  'IP-02': 'Did the associate secure commitment from at least one parent (father preferred)?',
  'At Least One Parent Committed, Father Preferred': 'Did the associate secure commitment from at least one parent (father preferred)?',

  'IP-03': 'Did the associate attempt a live handoff to the parent if they were nearby at home?',
  'Live Handoff to the Parent Attempted': 'Did the associate attempt a live handoff to the parent if they were nearby at home?',

  'IP-04': 'Did the associate pitch in parental terms (degree, fees, accreditation, future) once a parent joined?',
  'Value Re-pitched in the Parent\'s Terms After Handoff': 'Did the associate pitch in parental terms (degree, fees, accreditation, future) once a parent joined?',

  'IP-05': 'Did the associate accept flexible attendance if both parents could not join together?',
  'Partial or Flexible Attendance Accepted': 'Did the associate accept flexible attendance if both parents could not join together?',

  'IP-06': 'Did the associate verify if the student can ensure parent participation for the demo?',
  'Student\'s Ability to Bring Parents Tested': 'Did the associate verify if the student can ensure parent participation for the demo?',

  'IP-08': 'Did the associate acknowledge prospect buying signals and fold them into the session agenda?',
  'Buying Signals Captured and Converted': 'Did the associate acknowledge prospect buying signals and fold them into the session agenda?',

  'IP-09': 'Did the associate find out when parents are home and available before proposing session timings?',
  'Parental Availability Established Before Proposing a Time': 'Did the associate find out when parents are home and available before proposing session timings?',

  'IP-10': 'Did the associate proactively state that no money should be paid to any unauthorized individual?',
  'Integrity / No-Payment Guidance Given': 'Did the associate proactively state that no money should be paid to any unauthorized individual?',

  // Call Control, Tonality & Next Steps
  'CC-01': 'Did the associate keep their talk-share under 75% without lecturing or monologuing?',
  'Prospect Given Room to Speak': 'Did the associate keep their talk-share under 75% without lecturing or monologuing?',

  'CC-02': 'Did the associate shift to a respectful, formal tone when speaking to the parent?',
  'Register Shifted Correctly on Handoff': 'Did the associate shift to a respectful, formal tone when speaking to the parent?',

  'CC-03': 'Did the associate regularly check understanding with confirmation tags rather than monologuing?',
  'Understanding Checked Through the Call': 'Did the associate regularly check understanding with confirmation tags rather than monologuing?',

  'CC-05': 'Did the associate acknowledge prospect digressions and steer smoothly back to the booking?',
  'Call Steered Back Without Talking Over Concerns': 'Did the associate acknowledge prospect digressions and steer smoothly back to the booking?',

  'CC-06': 'Did the associate offer two specific time slots instead of asking open-ended "when are you free"?',
  'Two Specific Slots Offered': 'Did the associate offer two specific time slots instead of asking open-ended "when are you free"?',

  'CC-07': 'Did the associate lock in an unambiguous, confirmed day and clock time for the demo?',
  'A Specific Day and Time Locked and Confirmed Back': 'Did the associate confirm and lock an unambiguous day and clock time with the family?',

  'CC-08': 'Did the associate ask for an email/WhatsApp with the reason (to generate the Meet link)?',
  'Contact Details Captured With a Stated Reason': 'Did the associate ask for an email/WhatsApp with the reason (to generate the Meet link)?',

  'CC-09': 'Did the associate instruct the family to join on a laptop for screen sharing?',
  'Prospect Set Up to Arrive Prepared': 'Did the associate instruct the family to join on a laptop for screen sharing?',

  'CC-10': 'Did the associate confirm sending the WhatsApp link and promising a reminder call?',
  'WhatsApp Confirmation and Reminder Promised': 'Did the associate confirm sending the WhatsApp link and promising a reminder call?'
};

export function getParamQuestion(key) {
  if (!key) return '';
  const trimmed = String(key).trim();
  return PARAM_QUESTIONS[trimmed] || PARAM_QUESTIONS[trimmed.toLowerCase()] || trimmed;
}
