import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Clock, CheckCircle2, XCircle, Lightbulb, RefreshCw, MessageSquare } from 'lucide-react';
import { cn } from '../../../lib/utils';
import CallPlayer from '../media/CallPlayer';
import GoogleMeetViewer from '../media/GoogleMeetViewer';

export default function QualityCheckTab({ lead, activeCall, evaluatedCalls, mediaType, embedded, handleReEvaluate, isEvaluating, selectedCallIdx }) {
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
              <div className={cn("grid gap-6 h-full max-w-full", embedded ? "grid-cols-1 max-w-3xl mx-auto w-full" : "grid-cols-1 md:grid-cols-2")}>

                {/* LEFT PANE: Audio & Transcript */}
                {activeCall?.source === 'google_meet' ? (
                  <GoogleMeetViewer call={activeCall} embedded={embedded} />
                ) : (
                  <CallPlayer call={activeCall} embedded={embedded} />
                )}

                {/* RIGHT PANE: Summary / Insights / Quality */}
                <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden">
                  <Tabs defaultValue="quality" className="w-full flex-1 flex flex-col min-h-0">
                    <TabsList className={cn("bg-slate-100 p-1 h-12 rounded-lg mx-4 mt-4 mb-2", embedded ? "inline-flex w-fit" : "justify-between")}>
                      <TabsTrigger value="summary" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", !embedded && "flex-1")}>Summary</TabsTrigger>
                      <TabsTrigger value="insights" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", !embedded && "flex-1")}>Insights</TabsTrigger>
                      <TabsTrigger value="quality" className={cn("rounded-md px-4 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900", !embedded && "flex-1")}>Quality</TabsTrigger>
                    </TabsList>

                    <TabsContent value="quality" className="flex-1 overflow-hidden mt-0 p-0">
                      <ScrollArea className="h-full">
                        <div className="p-6 space-y-8">
                          <div className="flex justify-between items-center pb-4 border-b">
                            <div className="font-bold text-sm">
                              Overall Call Quality Score: <span className={(activeCall?.call_quality_score ?? 0) >= 60 ? "text-emerald-600" : (activeCall?.call_quality_score ?? 0) >= 40 ? "text-amber-600" : "text-rose-600"}>{activeCall?.call_quality_score ?? 0}%</span> <span className="text-slate-500 font-normal">({activeCall?.call_quality_raw?.replace(' [FATAL BREACH]', '') || '0/0'})</span>
                              {activeCall?.call_quality_raw?.includes('FATAL BREACH') ? (
                                <Badge variant="destructive" className="ml-3 uppercase tracking-wide animate-pulse">Fake Pitch</Badge>
                              ) : (activeCall?.call_quality_score ?? 0) >= 60 ? (
                                <Badge className="ml-3 bg-emerald-100 text-emerald-800 uppercase tracking-wide border-emerald-200 hover:bg-emerald-200">Good Pitch</Badge>
                              ) : (activeCall?.call_quality_score ?? 0) >= 40 ? (
                                <Badge className="ml-3 bg-amber-100 text-amber-800 uppercase tracking-wide border-amber-200 hover:bg-amber-200">Average Pitch</Badge>
                              ) : (
                                <Badge variant="destructive" className="ml-3 uppercase tracking-wide">Bad Pitch</Badge>
                              )}
                            </div>

                          </div>

                          {activeCall?.quality_data ? (
                            Object.entries(activeCall.quality_data)
                              .sort((a, b) => {
                                const isAna = a[1].status === 'Not Applicable' || a[1].status === 'NA';
                                const isBna = b[1].status === 'Not Applicable' || b[1].status === 'NA';
                                if (isAna && !isBna) return 1;
                                if (!isAna && isBna) return -1;
                                
                                const timeA = a[1].reason ? parseFloat((a[1].reason.match(/^\d+:\d+/) || ['9999:9999'])[0].replace(':', '.')) : 9999;
                                const timeB = b[1].reason ? parseFloat((b[1].reason.match(/^\d+:\d+/) || ['9999:9999'])[0].replace(':', '.')) : 9999;
                                return timeA - timeB;
                              })
                              .map(([param, data], idx) => {
                              return (
                                <div key={idx} className="space-y-4 pb-6 border-b border-dashed border-slate-200 last:border-0">
                                  <div className="flex justify-between items-start gap-4">
                                    <div className="flex items-start gap-3">
                                      {data.status !== 'Not Applicable' && data.status !== 'NA' && (
                                        <Badge className={cn("px-1.5 font-bold tabular-nums shadow-none border-transparent text-xs mt-0.5", 
                                          data.score === data.max_score ? "bg-emerald-100 text-emerald-700" : 
                                          data.score > 0 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
                                          {data.score}/{data.max_score}
                                        </Badge>
                                      )}
                                      <h4 className="font-bold text-sm text-slate-900 leading-tight">{param}</h4>
                                    </div>
                                    <span className={cn("text-[10px] font-bold uppercase tracking-wider shrink-0", 
                                      data.status === 'Done' ? "text-emerald-600" : 
                                      data.status === 'Partially Done' ? "text-amber-600" : 
                                      (data.status === 'Not Applicable' || data.status === 'NA') ? "text-slate-500" : 
                                      "text-rose-600")}>
                                      {data.status === 'Not Applicable' || data.status === 'NA' ? 'Not Applicable' : 
                                       data.status === 'Partially Done' ? 'Partially Done' : 
                                       data.status === 'Done' ? 'Done' : 'Needs Improvement'}
                                    </span>
                                  </div>

                                  {data.status !== 'Not Applicable' && data.status !== 'NA' && (
                                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3 flex gap-3 items-start mt-3">
                                      {data.reason && data.reason.match(/^\d+:\d+/) && (
                                        <button 
                                          onClick={() => {
                                            const timeStr = data.reason.match(/^\d+:\d+/)[0];
                                            const [mins, secs] = timeStr.split(':').map(Number);
                                            const timeInSeconds = mins * 60 + secs;
                                            window.dispatchEvent(new CustomEvent('jump-to-time', { detail: { callId: activeCall.id, start: timeInSeconds } }));
                                          }}
                                          className="flex items-center gap-1.5 px-2 py-1 bg-white border shadow-sm rounded-md hover:bg-slate-50 transition-colors shrink-0"
                                        >
                                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                                          <span className="text-xs font-mono font-bold text-slate-600">{data.reason.match(/^\d+:\d+/)[0]}</span>
                                        </button>
                                      )}
                                      <p className="text-sm text-slate-700 leading-relaxed pt-0.5">
                                        {data.reason ? data.reason.replace(/^\d+:\d+\s*-\s*/, '') : ''}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center text-muted-foreground p-8">No quality data available.</div>
                          )}
                        </div>
                      </ScrollArea>
                    </TabsContent>
                    <TabsContent value="summary" className="p-6">
                      {activeCall.summary_data ? (
                        <div className="space-y-6">
                          <div>
                            <h5 className="font-semibold text-sm mb-2">Call Summary</h5>
                            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
                              {activeCall.summary_data.call_summary?.map((pt, i) => <li key={i}>{pt}</li>)}
                            </ul>
                          </div>
                          <div>
                            <h5 className="font-semibold text-sm mb-2">Key Points</h5>
                            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-900">
                              {activeCall.summary_data.key_points?.map((pt, i) => <li key={i}>{pt}</li>)}
                            </ul>
                          </div>
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic">No summary generated yet.</div>
                      )}
                    </TabsContent>
                    <TabsContent value="insights" className="p-0 flex-1 overflow-hidden">
                      <ScrollArea className="h-full">
                        <div className="p-6 space-y-6">
                          {activeCall.coaching_report?.category_scores?.length > 0 ? (
                            [...activeCall.coaching_report.category_scores].sort((a, b) => {
                              const isAna = a.grade === 'NA' || a.grade === 'Not Applicable';
                              const isBna = b.grade === 'NA' || b.grade === 'Not Applicable';
                              if (isAna && !isBna) return 1;
                              if (!isAna && isBna) return -1;
                              return b.score - a.score;
                            }).map((cat, idx) => (
                              <div key={idx} className="bg-slate-50 border rounded-lg p-4">
                                <div className="flex justify-between items-center mb-4">
                                  <h4 className="font-bold text-sm text-slate-800">{cat.category}</h4>
                                  <Badge variant="outline" className="bg-white">{cat.score}% - Grade {cat.grade}</Badge>
                                </div>
                                <div className="space-y-4">
                                  {cat.grade !== 'NA' && cat.grade !== 'Not Applicable' && (
                                    <>
                                      {cat.what_went_wrong && (
                                        <div className="flex gap-3">
                                          <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                          <div>
                                            <span className="font-semibold text-rose-700 block mb-1 uppercase text-xs tracking-wide">What went wrong</span>
                                            <span className="text-sm text-slate-900">{cat.what_went_wrong}</span>
                                          </div>
                                        </div>
                                      )}
                                      {cat.coach_tip && (
                                        <div className="flex gap-3">
                                          <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                          <div>
                                            <span className="font-semibold text-amber-700 block mb-1 uppercase text-xs tracking-wide">How to fix (Coaching Tip)</span>
                                            <span className="text-sm text-slate-900">{cat.coach_tip}</span>
                                          </div>
                                        </div>
                                      )}
                                      {cat.what_went_well && (
                                        <div className="flex gap-3 pt-2 mt-2 border-t border-slate-200/60">
                                          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                          <div>
                                            <span className="font-semibold text-emerald-700 block mb-1 uppercase text-xs tracking-wide">What went well</span>
                                            <span className="text-sm text-slate-900">{cat.what_went_well}</span>
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="text-sm text-slate-500 italic text-center py-8">No insights available for this call.</div>
                          )}
                        </div>
                      </ScrollArea>
                    </TabsContent>
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