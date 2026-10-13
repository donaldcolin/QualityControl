export const KALVIUM_SLIDE_MAPPING = {
  1: "Title: India's #1 Work Integrated B.TECH",
  2: "Counselor Introduction",
  3: "Truth vs Reality vs Hope vs Choice",
  4: "The Headlines Are REAL (Layoffs)",
  5: "As a software engineer you will...",
  6: "The AI - REALITY",
  7: "The Reality of Traditional B.Tech",
  8: "B.Tech CSE vs B.Tech in AI",
  9: "You're already outdated from DAY 1",
  10: "Placement Stats reflect this already",
  11: "In the AI Era, College Brand Matters Less",
  12: "We reached out to top tech leaders",
  13: "What Matter & Doesn't Matter Anymore",
  14: "What do companies actually want?",
  15: "Google Now Hires 'Tons' Without Degree",
  16: "Work-Integrated Learning Introduction",
  17: "4 Years | Residential | On campus",
  18: "Curriculum Designed with Tech Leaders",
  19: "Placement & Internships Stats",
  20: "Internships (Student Profiles 1)",
  21: "Internships (Student Profiles 2)",
  22: "Internships (Student Profiles 3)",
  23: "Recruitment Partners",
  24: "How we Engineer Differently",
  25: "Work-Integrated Learning: Builds Skills",
  26: "Foundations-to-Excellence Curriculum",
  27: "Learning Like a Professional Looks Like",
  28: "Textbooks are not enough anymore",
  29: "Learn Coding the Right Way",
  30: "Kalvium Platform Dashboard",
  31: "Higher Education Real-Time Operating System",
  32: "Student Passion Projects",
  33: "Intensity that builds character",
  34: "Kalvium: 4 Pillars of Excellence",
  35: "Admissions Closing Soon",
  36: "Admissions Closing Soon (Dates)",
  37: "Why does Kalvium have an Entrance exam?",
  38: "Why Write Another Entrance Exam?",
  39: "Fair Selection Cartoon",
  40: "What is KNET?",
  41: "What is KNET (3 Steps)",
  42: "Important: Laptop/Camera requirement",
  43: "KNET tests how you think",
  44: "What KNET Evaluates?",
  45: "Multiple Pathways to Selection",
  46: "Psychometric Test",
  47: "What is this test?",
  48: "Portal: Psychometric Test Step",
  49: "Portal: Setup Test Environment",
  50: "Portal: Test Completed",
  51: "Sample Psychometric Report",
  52: "KNET: More than one way to show ability",
  53: "PART A: 4 Challenges",
  54: "PART B: The Questions",
  55: "KNET Test Pattern",
  56: "Portal: KNET Registration",
  57: "Portal: KNET Scheduled",
  58: "Portal: Launch KNET",
  59: "Portal: Test Live",
  60: "Portal: KNET Environment Check",
  61: "Portal: Part A Complete",
  62: "Portal: KNET Complete",
  63: "Let's take the next steps",
  64: "University Partners Overview",
  65: "Lovely Professional University (LPU)",
  66: "LPU: Infrastructure 1",
  67: "LPU: Infrastructure 2",
  68: "LPU: Library",
  69: "LPU: Sports",
  70: "LPU: Campus Life 1",
  71: "LPU: Campus Life 2",
  72: "LPU: Campus Life 3",
  73: "LPU: Campus Life 4",
  74: "LPU: Hostel Life",
  75: "LPU: Hostel Fee Details (Apartments)",
  76: "LPU: Hostel Fee Details (Standard)",
  77: "LPU: Proven Excellence (Rankings)",
  78: "LPU: B.Tech CSE Fees",
  79: "LPU: Scholarship Benefits",
  80: "JECRC University (Jaipur)",
  81: "JECRC: Infrastructure",
  82: "JECRC: Campus Life",
  83: "JECRC: Hostel Life 1",
  84: "JECRC: Hostel Life 2",
  85: "JECRC: Hostel Fee Details",
  86: "JECRC: Proven Excellence (Rankings)",
  87: "JECRC: B.Tech CSE Fees",
  88: "SRM University (Amaravati)",
  89: "SRM: Infrastructure",
  90: "SRM: Campus Life",
  91: "SRM: Hostel Life",
  92: "SRM: Hostel Fee Details",
  93: "SRM: Proven Excellence (Rankings)",
  94: "SRM: B.Tech CSE Fees",
  95: "Yenepoya University (Mangalore)",
  96: "Yenepoya Mangalore: Infrastructure",
  97: "Yenepoya Mangalore: Campus Life",
  98: "Yenepoya Mangalore: Rankings",
  99: "Yenepoya Mangalore: B.Tech CSE Fees",
  100: "Yenepoya University (Bangalore)",
  101: "Yenepoya Bangalore: Infrastructure",
  102: "Yenepoya Bangalore: Campus Life",
  103: "Yenepoya Bangalore: Rankings",
  104: "Yenepoya Bangalore: B.Tech CSE Fees",
  105: "AMET University (Chennai)",
  106: "AMET: Infrastructure",
  107: "AMET: Campus Life",
  108: "AMET: Rankings",
  109: "AMET: B.Tech CSE Fees",
  110: "AMET: Boys Hostel Fees",
  111: "AMET: Girls Hostel Fees",
  112: "St Joseph University (Chennai)",
  113: "St Joseph: Infrastructure",
  114: "St Joseph: Campus Life",
  115: "St Joseph: Hostel Life",
  116: "St Joseph: Hostel Fee Details",
  117: "St Joseph: Rankings",
  118: "St Joseph: Rankings 2",
  119: "St Joseph: B.Tech CSE Fees",
  120: "SGT University (Gurugram)",
  121: "SGT: Infrastructure",
  122: "SGT: Campus Life",
  123: "SGT: Hostel Life",
  124: "SGT: Hostel Fee Details",
  125: "SGT: B.Tech CSE Fees",
  126: "Kalasalingam (Srivilliputhur)",
  127: "Kalasalingam: Infrastructure",
  128: "Kalasalingam: Campus Life",
  129: "Kalasalingam: Rankings",
  130: "Kalasalingam: B.Tech CSE Fees",
  131: "Kalvium Direct Online",
  132: "Kalvium Direct Online: Fees",
  133: "Refer a Student",
  134: "Kalvium Curriculum (Sem 1-4)",
  135: "Kalvium Curriculum (Sem 5-8)",
};

export function getSlideCategory(slideNumber) {
  const num = Number(slideNumber);
  if (num >= 1 && num <= 15) {
    return { name: "Industry Reality & Brand", color: "indigo" };
  }
  if (num >= 16 && num <= 34) {
    return { name: "Curriculum & Internships", color: "blue" };
  }
  if (num >= 35 && num <= 63) {
    return { name: "Admissions & KNET Entrance", color: "violet" };
  }
  if (num >= 64 && num <= 130) {
    return { name: "University Campuses & Fees", color: "emerald" };
  }
  return { name: "Curriculum & Pathways", color: "purple" };
}

export function formatHumanDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export function getPacingStatus(durationSeconds, isShown = true) {
  if (!isShown || !durationSeconds || durationSeconds <= 0) {
    return { status: 'skipped', label: 'Not Shown', color: 'slate', badgeClass: 'bg-slate-100 text-slate-500 border-slate-200' };
  }
  if (durationSeconds < 20) {
    return { status: 'rushed', label: 'Rushed (<20s)', color: 'rose', badgeClass: 'bg-rose-50 text-rose-700 border-rose-200' };
  }
  if (durationSeconds < 60) {
    return { status: 'brief', label: 'Brief Summary', color: 'amber', badgeClass: 'bg-amber-50 text-amber-700 border-amber-200' };
  }
  if (durationSeconds <= 180) {
    return { status: 'optimal', label: 'Optimal Pace', color: 'emerald', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  }
  return { status: 'deep_dive', label: 'Deep Dive (>3m)', color: 'blue', badgeClass: 'bg-blue-50 text-blue-700 border-blue-200' };
}
