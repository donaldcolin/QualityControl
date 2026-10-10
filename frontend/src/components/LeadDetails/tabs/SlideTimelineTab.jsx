import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Clock, Eye, AlertTriangle, Monitor, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabsContent } from "@/components/ui/tabs";

const KALVIUM_SLIDE_MAPPING = {
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

const SlideTimelineTab = ({ activeCall }) => {
  const visualTimeline = activeCall?.visual_timeline || activeCall?.insights_data?.visual_timeline;

  if (!visualTimeline) {
    return (
      <TabsContent value="timeline" className="h-full mt-0">
        <div className="flex flex-col items-center justify-center p-12 text-slate-500">
          <Monitor className="w-12 h-12 mb-4 text-slate-300" />
          <h3 className="text-lg font-bold">No Visual Timeline Available</h3>
          <p className="mt-2 text-sm text-center max-w-sm">
            This call does not have visual timeline data. This might be an audio-only call or the video analysis was not completed.
          </p>
        </div>
      </TabsContent>
    );
  }

  const { facial_analytics, slides } = visualTimeline;
  const shownSlides = (slides || []).filter(s => s.is_shown);

  // Extract fatal breaches specifically to show alongside the timeline
  const fatalBreaches = Object.entries(activeCall?.quality_data || {}).filter(
    ([param, data]) => data.mark_fatal && data.score === 0
  );

  return (
    <TabsContent value="timeline" className="h-full mt-0">
      <div className="p-6 overflow-y-auto h-full space-y-6">
      
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-500">Associate Camera Active</p>
              <p className="text-2xl font-bold">{facial_analytics?.associate_camera_active_pct?.toFixed(1) || 0}%</p>
            </div>
            <div className={cn(
              "w-12 h-12 rounded-full flex items-center justify-center",
              facial_analytics?.trust_metric_passed ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600"
            )}>
              <Monitor className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-500">Slides Presented</p>
              <p className="text-2xl font-bold">{shownSlides.length} <span className="text-sm font-normal text-slate-400">/ {slides?.length || 0}</span></p>
            </div>
            <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center">
              <Presentation className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {fatalBreaches.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-3">
            <CardTitle className="text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Fake Pitch Detected
            </CardTitle>
            <CardDescription className="text-red-600/80">
              The AI auditor caught the following compliance or mis-selling violations during this presentation:
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {fatalBreaches.map(([param, data], idx) => (
                <div key={idx} className="bg-white p-3 rounded-md border border-red-100 shadow-sm flex flex-col gap-2">
                  <div className="flex justify-between items-start">
                    <h4 className="font-bold text-sm text-red-900">{param}</h4>
                    {data.reason && data.reason.match(/\b\d+:\d{2}\b/) && (
                      <button 
                        onClick={() => {
                          const timeStr = data.reason.match(/\b\d+:\d{2}\b/)[0];
                          const [mins, secs] = timeStr.split(':').map(Number);
                          const timeInSeconds = mins * 60 + secs;
                          window.dispatchEvent(new CustomEvent('jump-to-time', { detail: { callId: activeCall.id, start: timeInSeconds } }));
                        }}
                        className="flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 hover:bg-red-200 transition-colors rounded text-xs font-mono font-bold shrink-0"
                      >
                        <Clock className="w-3 h-3" />
                        {data.reason.match(/\b\d+:\d{2}\b/)[0]}
                      </button>
                    )}
                  </div>
                  <p className="text-sm text-red-800 leading-relaxed whitespace-pre-wrap">
                    {data.reason ? data.reason.replace(/\s*\b\d+:\d{2}\b\s*[-\:]*\s*/, ' ').trim() : ''}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Slide Presentation Timeline</CardTitle>
          <CardDescription>Chronological breakdown of slides presented during the demo.</CardDescription>
        </CardHeader>
        <CardContent>
          {shownSlides.length === 0 ? (
            <p className="text-sm text-slate-500 italic">No slides were detected during this call.</p>
          ) : (
            <div className="relative border-l border-slate-200 ml-4 space-y-8 pb-4">
              {shownSlides.map((slide, idx) => (
                <div key={idx} className="relative pl-6">
                  {/* Timeline Node */}
                  <span className={cn(
                    "absolute -left-2.5 top-1 w-5 h-5 rounded-full border-2 border-white flex items-center justify-center",
                    slide.rushed_warning ? "bg-amber-400" : "bg-blue-500"
                  )}>
                    {slide.rushed_warning ? <AlertTriangle className="w-3 h-3 text-white" /> : <span className="w-2 h-2 bg-white rounded-full"></span>}
                  </span>
                  
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                        {KALVIUM_SLIDE_MAPPING[slide.slide_number] || slide.title || `Slide ${slide.slide_number}`}
                        <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          Slide {slide.slide_number}
                        </span>
                      </h4>
                      {slide.rushed_warning && (
                        <p className="text-xs font-medium text-amber-600 flex items-center mt-1">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Rushed / Skipped Quickly
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-4 text-sm text-slate-500 shrink-0">
                      <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-100">
                        <Clock className="w-4 h-4 text-slate-400" />
                        <span className="font-medium">{slide.total_duration_seconds}s</span>
                      </div>
                      
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <Eye className="w-4 h-4 text-slate-400" />
                        <span>{(slide.intervals_formatted || []).join(', ')}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      
      </div>
    </TabsContent>
  );
};

export default SlideTimelineTab;
