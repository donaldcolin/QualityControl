import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Clock, Eye, AlertTriangle, Monitor, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabsContent } from "@/components/ui/tabs";

const SlideTimelineTab = ({ activeCall }) => {
  const visualTimeline = activeCall?.insights_data?.visual_timeline;

  if (!visualTimeline) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500">
        <Monitor className="w-12 h-12 mb-4 text-slate-300" />
        <h3 className="text-lg font-bold">No Visual Timeline Available</h3>
        <p className="mt-2 text-sm text-center max-w-sm">
          This call does not have visual timeline data. This might be an audio-only call or the video analysis was not completed.
        </p>
      </div>
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
                        {slide.title || `Slide ${slide.slide_number}`}
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
