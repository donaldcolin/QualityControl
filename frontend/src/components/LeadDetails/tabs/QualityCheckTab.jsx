import { useMemo } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Check, 
  X, 
  AlertCircle, 
  AlertTriangle, 
  Lightbulb, 
  CheckCircle2,
  XCircle,
  MessageSquare, 
  Play 
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import CallPlayer from '../media/CallPlayer';
import GoogleMeetViewer from '../media/GoogleMeetViewer';
import SlideTimelineTab from './SlideTimelineTab';
import { getParamQuestion } from '../../../lib/parameterQuestions';

function extractTimestamp(text) {
  if (!text || typeof text !== 'string') return null;
  // Matches [HH:MM:SS], [MM:SS], HH:MM:SS, or MM:SS
  const match = text.match(/\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b/);
  if (!match) return null;

  const display = match[0];
  let seconds = 0;
  if (match[1] !== undefined) {
    seconds = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
  } else {
    seconds = parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
  }
  return { display, seconds };
}

function cleanReasonText(reason) {
  if (!reason || typeof reason !== 'string') return '';
  const trimmed = reason.trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'compliant' || lower === 'no violations detected') {
    return 'Clean execution — no policy violations detected.';
  }
  return trimmed
    .replace(/^\s*\[?\s*\b(?:(?:\d{1,2}:)?\d{1,2}:\d{2})\b\s*\]?\s*[\-\:\—]*\s*/, '')
    .replace(/^\[\s*\]\s*/, '')
    .trim();
}

function cleanQuestionText(q) {
  if (!q || typeof q !== 'string') return '';
  return q.replace(/keep associate talk-share/gi, 'keep their talk-share');
}

export default function QualityCheckTab({ lead, activeCall, evaluatedCalls, mediaType, embedded, selectedCallIdx }) {
  const isVideo = activeCall?.source === 'google_meet' || mediaType === 'demo';

  // Process & Sort Evaluation Entries Chronologically
  const qualityEntries = useMemo(() => {
    if (!activeCall?.quality_data) return [];
    return Object.entries(activeCall.quality_data)
      .map(([param, data]) => {
        const rawQuestion = data.question || getParamQuestion(param);
        return {
          param,
          data,
          question: cleanQuestionText(rawQuestion),
          ts: extractTimestamp(data.reason),
          cleanReason: cleanReasonText(data.reason)
        };
      })
      .sort((a, b) => {
        const isAna = a.data.status === 'Not Applicable' || a.data.status === 'NA';
        const isBna = b.data.status === 'Not Applicable' || b.data.status === 'NA';
        if (isAna && !isBna) return 1;
        if (!isAna && isBna) return -1;

        const timeA = a.ts ? a.ts.seconds : 999999;
        const timeB = b.ts ? b.ts.seconds : 999999;
        return timeA - timeB;
      });
  }, [activeCall?.quality_data]);

  const passedCount = qualityEntries.filter(e => e.data.status === 'Done').length;
  const needsImprovementCount = qualityEntries.filter(
    e => e.data.status !== 'Done' && e.data.status !== 'Not Applicable' && e.data.status !== 'NA'
  ).length;

  return (
    <TabsContent value="conversations" className="h-full mt-0">
      {selectedCallIdx === 'all' && evaluatedCalls.length > 1 ? (
        <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-slate-50 border rounded-xl m-6 border-dashed">
          <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm mb-4 border">
            <MessageSquare className="w-8 h-8 text-slate-400" />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">Select a Specific Call</h3>
          <p className="text-slate-500 max-w-md">To view the transcript, audio playback, and detailed quality scoring, please select a specific call from the dropdown in the top right.</p>
        </div>
      ) : lead.calls?.length > 0 ? (
        <div className={cn(
          "grid gap-6 h-full max-w-full min-h-0",
          embedded 
            ? (isVideo ? "grid-cols-1 md:grid-cols-2 w-full" : "grid-cols-1 max-w-3xl mx-auto w-full") 
            : "grid-cols-1 md:grid-cols-2"
        )}>

          {/* LEFT PANE: Audio & Transcript */}
          {activeCall?.source === 'google_meet' ? (
            <GoogleMeetViewer call={activeCall} embedded={embedded} />
          ) : (
            <CallPlayer call={activeCall} embedded={embedded} />
          )}

          {/* RIGHT PANE: Summary / Insights / Quality */}
          <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden min-h-0">
            <Tabs 
              defaultValue={isVideo ? "timeline" : "quality"} 
              key={activeCall?.id || (isVideo ? 'video' : 'audio')}
              className="w-full flex-1 flex flex-col min-h-0"
            >
              <TabsList className={cn("bg-slate-100 p-1 h-12 rounded-lg mx-4 mt-4 mb-2", (embedded && !isVideo) ? "inline-flex w-fit" : "justify-between")}>
                <TabsTrigger value="summary" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", (!embedded || isVideo) && "flex-1")}>Summary</TabsTrigger>
                <TabsTrigger value="insights" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", (!embedded || isVideo) && "flex-1")}>Insights</TabsTrigger>
                <TabsTrigger value="quality" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", (!embedded || isVideo) && "flex-1")}>Quality</TabsTrigger>
                {activeCall?.source === 'google_meet' && (
                  <TabsTrigger value="timeline" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", (!embedded || isVideo) && "flex-1")}>Timeline</TabsTrigger>
                )}
              </TabsList>

              {/* QUALITY EVALUATION TAB */}
              <TabsContent value="quality" className="flex-1 overflow-hidden mt-0 p-0 flex flex-col">
                <ScrollArea className="h-full">
                  <div className="p-5 space-y-3">

                    {/* MINIMAL HEADER */}
                    <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
                      <div className="flex items-center gap-2.5">
                        <span className={cn(
                          "text-xl font-bold font-mono tracking-tight",
                          (activeCall?.call_quality_score ?? 0) >= 60 
                            ? "text-emerald-700" 
                            : (activeCall?.call_quality_score ?? 0) >= 40 
                            ? "text-amber-700" 
                            : "text-rose-700"
                        )}>
                          {activeCall?.call_quality_score ?? 0}%
                        </span>
                        <span className="text-xs text-slate-400 font-medium">
                          ({activeCall?.call_quality_raw?.replace(/ \[FAKE PITCH DETECTED.*?\]/, '') || '0/0'})
                        </span>
                        {activeCall?.call_quality_raw?.includes('FAKE PITCH DETECTED') ? (
                          <Badge variant="destructive" className="text-[10px] uppercase font-bold animate-pulse">Fake Pitch</Badge>
                        ) : (activeCall?.call_quality_score ?? 0) >= 60 ? (
                          <Badge variant="outline" className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border-emerald-200">Good Pitch</Badge>
                        ) : (activeCall?.call_quality_score ?? 0) >= 40 ? (
                          <Badge variant="outline" className="text-[10px] font-semibold text-amber-700 bg-amber-50 border-amber-200">Average Pitch</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] font-semibold text-rose-700 bg-rose-50 border-rose-200">Bad Pitch</Badge>
                        )}
                      </div>

                      <div className="text-xs font-medium text-slate-400 flex items-center gap-2">
                        <span><strong className="text-emerald-700 font-semibold">{passedCount}</strong> / {qualityEntries.length} passed</span>
                        {needsImprovementCount > 0 && (
                          <span className="text-rose-700 font-medium">• {needsImprovementCount} to improve</span>
                        )}
                      </div>
                    </div>

                    {/* PARAMETER CARDS LIST */}
                    {qualityEntries.length > 0 ? (
                      <div className="space-y-2.5">
                        {qualityEntries.map(({ param, data, question, ts, cleanReason }, idx) => {
                          const isDone = data.status === 'Done';
                          const isPartiallyDone = data.status === 'Partially Done';
                          const isNa = data.status === 'Not Applicable' || data.status === 'NA';
                          const isBreach = Boolean(data.breach_flag || data.mark_fatal);

                          return (
                            <div 
                              key={idx} 
                              className="rounded-xl border border-slate-200/80 hover:border-slate-300 p-3.5 transition-colors bg-white shadow-2xs"
                            >
                              {/* Top Row: Canonical Parameter Name (Muted) + Status & Score */}
                              <div className="flex items-center justify-between gap-3 mb-1.5">
                                <span className="text-[11px] font-medium tracking-tight text-slate-400 truncate">
                                  {param}
                                </span>

                                <div className="flex items-center gap-2 shrink-0">
                                  {/* Score */}
                                  {!isNa && (
                                    <span className={cn(
                                      "text-xs font-mono font-medium",
                                      isDone 
                                        ? "text-emerald-700 font-semibold" 
                                        : isPartiallyDone 
                                        ? "text-amber-700 font-semibold" 
                                        : "text-rose-700 font-semibold"
                                    )}>
                                      {data.score}/{data.max_score}
                                    </span>
                                  )}

                                  {/* Status Pill */}
                                  <span className={cn(
                                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border",
                                    isDone 
                                      ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                                      : isPartiallyDone
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : isNa 
                                      ? "bg-slate-50 text-slate-400 border-slate-200" 
                                      : "bg-rose-50 text-rose-800 border-rose-200"
                                  )}>
                                    {isDone && <Check className="w-3 h-3 text-emerald-600" />}
                                    {isPartiallyDone && <AlertCircle className="w-3 h-3 text-amber-600" />}
                                    {!isDone && !isPartiallyDone && !isNa && <X className="w-3 h-3 text-rose-600" />}
                                    {isNa ? 'N/A' : isPartiallyDone ? 'Partial' : data.status}
                                  </span>
                                </div>
                              </div>

                              {/* Question Heading */}
                              <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                                {question}
                              </h4>

                              {/* Observation / Evidence Row */}
                              {!isNa && cleanReason && (
                                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-start gap-2.5">
                                  {/* Sleek Minimal Audio Jump Button (only when timestamp > 0) */}
                                  {ts && ts.seconds > 0 ? (
                                    <button 
                                      type="button"
                                      title={`Jump audio playback to ${ts.display}`}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        window.dispatchEvent(new CustomEvent('jump-to-time', { 
                                          detail: { callId: activeCall?.id, start: ts.seconds } 
                                        }));
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 transition-colors shrink-0 cursor-pointer shadow-2xs"
                                    >
                                      <Play className="w-2.5 h-2.5 fill-slate-600 text-slate-600" />
                                      <span>{ts.display}</span>
                                    </button>
                                  ) : (
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-2 shrink-0" />
                                  )}

                                  <p className="text-xs md:text-sm text-slate-600 leading-relaxed pt-0.5 flex-1">
                                    {cleanReason}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-center text-slate-400 py-12">
                        No quality data available for this call.
                      </div>
                    )}

                  </div>
                </ScrollArea>
              </TabsContent>

              {/* CALL SUMMARY TAB */}
              <TabsContent value="summary" className="p-6">
                {activeCall.summary_data ? (
                  <div className="space-y-6">
                    <div>
                      <h5 className="font-semibold text-sm mb-2 text-slate-900">Call Summary</h5>
                      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                        {activeCall.summary_data.call_summary?.map((pt, i) => <li key={i}>{pt}</li>)}
                      </ul>
                    </div>
                    <div>
                      <h5 className="font-semibold text-sm mb-2 text-slate-900">Key Points</h5>
                      <ul className="list-disc pl-5 space-y-1 text-sm text-slate-700">
                        {activeCall.summary_data.key_points?.map((pt, i) => <li key={i}>{pt}</li>)}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-500 italic">No summary generated yet.</div>
                )}
              </TabsContent>

              {/* COACHING INSIGHTS TAB */}
              <TabsContent value="insights" className="p-0 flex-1 overflow-hidden">
                <ScrollArea className="h-full">
                  <div className="p-6 space-y-4">
                    {activeCall.coaching_report?.category_scores?.length > 0 ? (
                      [...activeCall.coaching_report.category_scores].sort((a, b) => {
                        const isAna = a.grade === 'NA' || a.grade === 'Not Applicable';
                        const isBna = b.grade === 'NA' || b.grade === 'Not Applicable';
                        if (isAna && !isBna) return 1;
                        if (!isAna && isBna) return -1;
                        return b.score - a.score;
                      }).map((cat, idx) => (
                        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4">
                          <div className="flex justify-between items-center mb-3">
                            <h4 className="font-bold text-sm text-slate-800">{cat.category}</h4>
                            <Badge variant="outline" className="bg-slate-50 font-mono text-xs">{cat.score}% - Grade {cat.grade}</Badge>
                          </div>
                          <div className="space-y-3">
                            {cat.grade !== 'NA' && cat.grade !== 'Not Applicable' && (
                              <>
                                {cat.what_went_wrong && (
                                  <div className="flex gap-2.5">
                                    <XCircle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                    <div>
                                      <span className="font-semibold text-slate-700 block mb-0.5 uppercase text-[11px] tracking-wide">What went wrong</span>
                                      <span className="text-sm text-slate-600">{cat.what_went_wrong}</span>
                                    </div>
                                  </div>
                                )}
                                {cat.coach_tip && (
                                  <div className="flex gap-2.5">
                                    <Lightbulb className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                    <div>
                                      <span className="font-semibold text-slate-700 block mb-0.5 uppercase text-[11px] tracking-wide">How to fix (Coaching Tip)</span>
                                      <span className="text-sm text-slate-600">{cat.coach_tip}</span>
                                    </div>
                                  </div>
                                )}
                                {cat.what_went_well && (
                                  <div className="flex gap-2.5 pt-2 border-t border-slate-100">
                                    <CheckCircle2 className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                                    <div>
                                      <span className="font-semibold text-slate-700 block mb-0.5 uppercase text-[11px] tracking-wide">What went well</span>
                                      <span className="text-sm text-slate-600">{cat.what_went_well}</span>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400 italic text-center py-8">No insights available for this call.</div>
                    )}
                  </div>
                </ScrollArea>
              </TabsContent>
              
              {activeCall?.source === 'google_meet' && (
                <SlideTimelineTab activeCall={activeCall} />
              )}
            </Tabs>
          </div>

        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          No calls recorded for this lead yet.
        </div>
      )}
    </TabsContent>
  );
}