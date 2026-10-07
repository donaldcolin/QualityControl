import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Target, TrendingUp, TrendingDown, Crosshair, Sparkles, User, Smile, MessageSquareShare, CheckCircle2, ShieldAlert, Lightbulb, AlertTriangle, BrainCircuit, Clock, Map, Star, XCircle } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';

export default function CoachingTab({ lead, coaching, embedded, selectedCallIdx, activeCall, evaluatedCalls, callsToDisplay }) {
  return (
          <TabsContent value="coaching" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="max-w-5xl mx-auto space-y-8 pb-8 px-4 pt-4">
                {selectedCallIdx === 'all' && lead.journey_coaching && (
                  <Card className="shadow-md bg-fuchsia-500/5 border-fuchsia-500/20 overflow-hidden mb-8">
                    <CardHeader className="pb-3 border-b border-fuchsia-500/10 bg-fuchsia-500/10">
                      <CardTitle className="text-sm flex items-center gap-2 text-fuchsia-900">
                        <Map className="w-4 h-4 text-fuchsia-600" /> Holistic Journey Coaching
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-5 grid grid-cols-1 md:grid-cols-3 gap-6">
                      <div>
                        <h4 className="text-xs font-bold text-fuchsia-800 uppercase tracking-wider mb-2 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> Improvements Noted</h4>
                        <p className="text-sm text-slate-900 leading-relaxed bg-white/50 p-3 rounded-lg border border-fuchsia-100/50">{lead.journey_coaching.improvements_noted}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-rose-800 uppercase tracking-wider mb-2 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Recurring Mistakes</h4>
                        <p className="text-sm text-slate-900 leading-relaxed bg-white/50 p-3 rounded-lg border border-rose-100/50">{lead.journey_coaching.recurring_mistakes}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-blue-800 uppercase tracking-wider mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Next Touchpoint Strategy</h4>
                        <p className="text-sm text-slate-900 leading-relaxed bg-white/50 p-3 rounded-lg border border-blue-100/50">{lead.journey_coaching.next_touchpoint_strategy}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Top Strengths */}
                {(() => {
                  // FIX: Aggregate strengths & improvements across ALL evaluated calls like an array
                  const strengths = callsToDisplay.flatMap((c) => {
                    const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                    const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                    return (c.coaching_report?.top_strengths || []).map(s => ({ text: s, callLabel }));
                  });
                  const improvements = callsToDisplay.flatMap((c) => {
                    const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                    const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                    return (c.coaching_report?.critical_improvements || []).map(imp => ({ text: imp, callLabel }));
                  });
                  if (strengths.length === 0 && improvements.length === 0) return null;
                  return (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                      <Card className="shadow-[0_2px_15px_-3px_rgba(16,185,129,0.15)] border-emerald-500/20 bg-gradient-to-br from-white to-emerald-50/30 overflow-hidden relative">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                        <CardHeader className="pb-3 border-b border-emerald-100/50 bg-white/50 backdrop-blur-sm">
                          <CardTitle className="text-sm flex items-center gap-2 text-emerald-800 font-bold uppercase tracking-wider">
                            <Star className="w-4 h-4 fill-emerald-500 text-emerald-500" /> Top Strengths
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5">
                          <ul className="space-y-4">
                            {strengths.map((s, idx) => (
                              <li key={idx} className="flex gap-3 items-start text-sm group">
                                <div className="bg-emerald-100/80 p-1 rounded-full shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                </div>
                                <div className="text-slate-900 leading-relaxed font-medium">
                                  {s.callLabel && <span className="font-bold text-[10px] uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded mr-2">{s.callLabel}</span>}
                                  {s.text}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>

                      <Card className="shadow-[0_2px_15px_-3px_rgba(239,68,68,0.15)] border-rose-500/20 bg-gradient-to-br from-white to-rose-50/30 overflow-hidden relative">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-rose-400/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                        <CardHeader className="pb-3 border-b border-rose-100/50 bg-white/50 backdrop-blur-sm">
                          <CardTitle className="text-sm flex items-center gap-2 text-rose-800 font-bold uppercase tracking-wider">
                            <AlertTriangle className="w-4 h-4 text-rose-500" /> Critical Improvements
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5">
                          <ul className="space-y-4">
                            {improvements.map((imp, idx) => (
                              <li key={idx} className="flex gap-3 items-start text-sm group">
                                <div className="bg-rose-100/80 p-1 rounded-full shrink-0 mt-0.5 group-hover:scale-110 transition-transform">
                                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                                </div>
                                <div className="text-slate-900 leading-relaxed font-medium">
                                  {imp.callLabel && <span className="font-bold text-[10px] uppercase tracking-wide text-rose-700 bg-rose-50 border border-rose-100 px-1.5 py-0.5 rounded mr-2">{imp.callLabel}</span>}
                                  {imp.text}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })()}

                {/* Advanced AI Coaching */}
                {(() => {
                  // FIX: Aggregate rewrites across ALL evaluated calls
                  let allRewrites = [];
                  callsToDisplay.forEach((c) => {
                    const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                    const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                    let coaching = c.coaching_report?.advanced_coaching;
                    if (!coaching && c.coaching_report?.prescriptive_coaching) {
                      coaching = {
                        context_aware_rewrites: c.coaching_report.prescriptive_coaching.map(pc => ({
                          what_they_said: pc.what_associate_said || 'Quote not available',
                          why_it_failed: pc.situation,
                          golden_rewrite: pc.golden_pitch
                        }))
                      };
                    }
                    if (coaching?.context_aware_rewrites) {
                      allRewrites.push(...coaching.context_aware_rewrites.map(rw => ({ ...rw, callLabel })));
                    }
                  });

                  allRewrites.sort((a, b) => {
                    const timeA = parseFloat((a.timestamp || '0').split('-')[0].replace(/[^0-9.]/g, ''));
                    const timeB = parseFloat((b.timestamp || '0').split('-')[0].replace(/[^0-9.]/g, ''));
                    return timeA - timeB;
                  });

                  if (allRewrites.length === 0) return (
                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 border-2 border-dashed rounded-xl mt-8">
                      <Target className="w-10 h-10 mb-4 opacity-50" />
                      <p className="font-medium">No advanced coaching generated for this lead's calls.</p>
                    </div>
                  );

                  const coaching = activeCall?.coaching_report?.advanced_coaching || {};

                  return (
                    <div className="space-y-6 mb-8">
                      {/* Context-Aware Rewrites */}
                      {allRewrites.length > 0 && (
                        <Card className="shadow-sm border-indigo-500/20 bg-indigo-50/30">
                          <CardHeader className="pb-3 border-b border-indigo-500/10">
                            <CardTitle className="text-sm flex items-center gap-2 text-indigo-700">
                              <Target className="w-4 h-4" /> Context-Aware Rewrites (All Calls)
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-5 space-y-8">
                            {allRewrites.map((c, idx) => (
                              <div key={idx} className="relative pl-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100 space-y-4">
                                {/* What they said */}
                                <div className="relative group">
                                  <div className="absolute -left-[29px] top-1 w-6 h-6 rounded-full bg-rose-100 border-2 border-white flex items-center justify-center z-10">
                                    <XCircle className="w-3 h-3 text-rose-600" />
                                  </div>
                                  <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none p-4 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] hover:shadow-md transition-shadow">
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Associate Said</span>
                                        {c.callLabel && <Badge variant="outline" className="text-[9px] h-4 px-1 text-slate-500 bg-slate-50">{c.callLabel}</Badge>}
                                      </div>
                                      {c.timestamp && (
                                        <Badge variant="secondary" className="bg-slate-100 text-slate-500 font-mono text-[10px] px-1.5 py-0 h-5">
                                          <Clock className="w-3 h-3 mr-1 inline-block" />{c.timestamp}
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-sm text-slate-900 italic leading-relaxed">"{c.what_they_said}"</p>
                                    <div className="mt-3 pt-3 border-t border-dashed border-slate-200">
                                      <p className="text-xs text-rose-600 font-medium leading-relaxed">
                                        <span className="uppercase font-bold tracking-wider opacity-70 block mb-0.5">Why it failed:</span>
                                        {c.why_it_failed}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* Golden Rewrite */}
                                <div className="relative group">
                                  <div className="absolute -left-[29px] top-1 w-6 h-6 rounded-full bg-emerald-100 border-2 border-white flex items-center justify-center z-10">
                                    <Sparkles className="w-3 h-3 text-emerald-600" />
                                  </div>
                                  <div className="bg-gradient-to-br from-emerald-50/50 to-teal-50/30 border border-emerald-100 rounded-2xl rounded-tl-none p-4 shadow-[0_2px_10px_-4px_rgba(16,185,129,0.1)] relative overflow-hidden">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-400/5 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
                                    <div className="flex items-center mb-2">
                                      <span className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Golden Rewrite
                                      </span>
                                    </div>
                                    <p className="text-sm text-emerald-950 font-medium relative z-10 leading-relaxed">"{c.golden_rewrite}"</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </CardContent>
                        </Card>
                      )}

                      {/* Behavioral Insights */}
                      <Card className="shadow-[0_2px_20px_-5px_rgba(59,130,246,0.1)] border-blue-500/20 bg-white overflow-hidden">
                        <CardHeader className="pb-4 border-b border-blue-100 bg-gradient-to-r from-blue-50/50 to-transparent">
                          <CardTitle className="text-sm flex items-center gap-2 text-blue-800 font-bold uppercase tracking-wider">
                            <BrainCircuit className="w-4 h-4 text-blue-600" /> Behavioral Insights
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-6">
                            {coaching.prospect_persona && (
                              <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-blue-200 hover:shadow-sm transition-all group">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                  <User className="w-3.5 h-3.5 text-blue-500 group-hover:scale-110 transition-transform" /> Prospect Persona
                                </div>
                                <div className="text-sm text-slate-900 leading-relaxed font-medium">{coaching.prospect_persona}</div>
                              </div>
                            )}
                            {coaching.tone_and_empathy && (
                              <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-indigo-200 hover:shadow-sm transition-all group">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                  <Smile className="w-3.5 h-3.5 text-indigo-500 group-hover:scale-110 transition-transform" /> Tone & Empathy
                                </div>
                                <div className="text-sm text-slate-900 leading-relaxed font-medium">{coaching.tone_and_empathy}</div>
                              </div>
                            )}
                            {coaching.conversational_dynamics && (
                              <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-violet-200 hover:shadow-sm transition-all group md:col-span-2">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                  <MessageSquareShare className="w-3.5 h-3.5 text-violet-500 group-hover:scale-110 transition-transform" /> Conversational Dynamics
                                </div>
                                <div className="text-sm text-slate-900 leading-relaxed font-medium">{coaching.conversational_dynamics}</div>
                              </div>
                            )}
                            {coaching.micro_agreements && (
                              <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-teal-200 hover:shadow-sm transition-all group">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-teal-500 group-hover:scale-110 transition-transform" /> Micro-Agreements
                                </div>
                                <div className="text-sm text-slate-900 leading-relaxed font-medium">{coaching.micro_agreements}</div>
                              </div>
                            )}
                            {coaching.competitor_deflection && (
                              <div className="bg-slate-50/80 rounded-xl p-4 border border-slate-100 hover:border-orange-200 hover:shadow-sm transition-all group">
                                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                                  <ShieldAlert className="w-3.5 h-3.5 text-orange-500 group-hover:scale-110 transition-transform" /> Competitor Deflection
                                </div>
                                <div className="text-sm text-slate-900 leading-relaxed font-medium">{coaching.competitor_deflection}</div>
                              </div>
                            )}
                          </div>
                        </CardContent>
                      </Card>

                      {/* Missed Opportunities */}
                      {coaching.missed_opportunities && coaching.missed_opportunities.length > 0 && (
                        <Card className="shadow-sm border-amber-500/20 bg-gradient-to-r from-amber-50/40 to-white relative overflow-hidden mt-8">
                          <div className="absolute top-0 right-0 w-48 h-48 bg-amber-400/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>
                          <CardHeader className="pb-3 border-b border-amber-100/50 bg-white/50 backdrop-blur-sm">
                            <CardTitle className="text-sm flex items-center gap-2 text-amber-800 font-bold uppercase tracking-wider">
                              <Crosshair className="w-4 h-4 text-amber-500" /> Missed Opportunities
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="p-6">
                            <ul className="space-y-4">
                              {coaching.missed_opportunities.map((mo, idx) => (
                                <li key={idx} className="flex gap-4 items-start text-sm group p-3 rounded-lg hover:bg-white hover:shadow-sm transition-all border border-transparent hover:border-amber-100">
                                  <div className="bg-amber-100/80 p-1.5 rounded-md shrink-0 mt-0.5 shadow-inner border border-amber-200">
                                    <Lightbulb className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
                                  </div>
                                  <span className="text-slate-900 leading-relaxed font-medium">{mo}</span>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  );
                })()}
              </div>
            </ScrollArea>
          </TabsContent>
  );
}