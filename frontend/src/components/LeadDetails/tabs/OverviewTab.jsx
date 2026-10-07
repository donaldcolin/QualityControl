import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, BrainCircuit, Target, Minus, AlertTriangle, MessageSquare, Database, Clock, User, Smile, MessageSquareShare, ShieldAlert, Crosshair, Lightbulb, TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { TabsContent } from '@/components/ui/tabs';

export default function OverviewTab({ lead, callsToDisplay, evaluatedCalls, activeCall, embedded, intentScore }) {
  return (
          <TabsContent value="insights" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="max-w-5xl mx-auto space-y-8 pb-8 px-4">
                <section>
                  <div className="flex items-center gap-2 mb-4">

                  </div>



                  <Card className="shadow-md bg-purple-500/5 border-purple-500/10 overflow-hidden">
                    <CardHeader className="pb-3 border-b border-purple-500/10">
                      <CardTitle className="text-m">Overall Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                      {lead.journey_summary ? (
                        <div className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">
                          {lead.journey_summary}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic">No journey summary available yet.</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Buying Intent Analysis */}
                  {(() => {
                    const highIntent = [];
                    const lowIntent = [];
                    callsToDisplay.forEach((c) => {
                      const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                      const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                      (c.insights_data?.high_intent_factors || []).forEach(f => highIntent.push({ text: f, callLabel }));
                      (c.insights_data?.low_intent_factors || []).forEach(f => lowIntent.push({ text: f, callLabel }));
                    });
                    if (highIntent.length === 0 && lowIntent.length === 0) return null;
                    return (
                      <Card className="shadow-md mt-6 border-slate-200 overflow-hidden p-0 gap-0">
                        <CardHeader className="p-4 pb-3 border-b bg-slate-50 flex flex-row items-center justify-between">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-blue-500" /> Buying Intent Analysis
                          </CardTitle>
                          {intentScore !== undefined && (
                            <Badge variant="outline" className={cn("bg-white text-xs font-bold", intentScore > 70 ? "text-emerald-600 border-emerald-200" : intentScore > 40 ? "text-amber-600 border-amber-200" : "text-rose-600 border-rose-200")}>
                              Score: {intentScore}/100
                            </Badge>
                          )}
                        </CardHeader>
                        <CardContent className="p-5">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-600 mb-3 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" /> High Intent Factors</h4>
                              <ul className="space-y-2">
                                {highIntent.map((factor, idx) => (
                                  <li key={idx} className="flex gap-2 items-start text-sm">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                    <div className="text-slate-900">
                                      {factor.callLabel && <span className="font-bold text-xs text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded mr-2">{factor.callLabel}</span>}
                                      {factor.text}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-3 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5" /> Low Intent Factors</h4>
                              <ul className="space-y-2">
                                {lowIntent.map((factor, idx) => (
                                  <li key={idx} className="flex gap-2 items-start text-sm">
                                    <Minus className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                    <div className="text-slate-900">
                                      {factor.callLabel && <span className="font-bold text-xs text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded mr-2">{factor.callLabel}</span>}
                                      {factor.text}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}


                  {/* BANT Analysis */}
                  {(() => {
                    const bant = {};
                    callsToDisplay.forEach((c) => {
                      const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                      const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                      const cBant = c.insights_data?.bant;
                      if (cBant) {
                        Object.keys(cBant).forEach(k => {
                          // For BANT, since it's an object structure per key, we can append it
                          if (!bant[k]) bant[k] = [];
                          bant[k].push({ ...cBant[k], callLabel });
                        });
                      }
                    });
                    if (Object.keys(bant).length === 0) return null;
                    return (
                      <Card className="shadow-md mt-6 border-slate-200 overflow-hidden p-0 gap-0">
                        <CardHeader className="p-4 pb-3 border-b bg-slate-50">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Target className="w-4 h-4 text-indigo-500" /> BANT Analysis
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5">
                          <div className="grid grid-cols-2 gap-4">
                            {Object.entries(bant).map(([key, items]) => (
                              <div key={key} className="flex flex-col gap-2">
                                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 flex items-center justify-between border-b border-slate-100 pb-1.5">
                                  {key}
                                </div>
                                <div className="flex flex-col gap-3 mt-1">
                                  {items.map((data, i) => (
                                    <div key={i} className="text-sm text-slate-900">
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold", data.status === 'Qualified' ? 'bg-emerald-100 text-emerald-700' : data.status === 'Unqualified' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>{data.status}</span>
                                        {data.callLabel && <span className="text-[10px] font-bold text-slate-400">{data.callLabel}</span>}
                                      </div>
                                      <p className="leading-relaxed">{data.details}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Data Capture */}
                  {(() => {
                    const uniqueFields = {};
                    const allMissing = new Set();
                    callsToDisplay.forEach(c => {
                      const cDc = c.insights_data?.data_capture;
                      if (!cDc) return;
                      (cDc.extracted_fields || []).forEach(f => {
                        if (!uniqueFields[f.field] || (f.value !== 'N/A' && f.value !== 'Not mentioned')) {
                          uniqueFields[f.field] = f;
                        }
                      });
                      (cDc.missing_mandatory_fields || []).forEach(f => {
                        allMissing.add(f);
                      });
                    });

                    const extractedFields = Object.values(uniqueFields).filter(f => f.value && f.value !== 'N/A' && f.value !== 'Not mentioned');
                    extractedFields.forEach(f => allMissing.delete(f.field));

                    if (extractedFields.length === 0 && allMissing.size === 0) return null;

                    return (
                      <Card className="shadow-md mt-6 border-slate-200 overflow-hidden p-0 gap-0">
                        <CardHeader className="p-4 pb-3 border-b bg-slate-50">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Database className="w-4 h-4 text-blue-500" /> Data Capture
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5 space-y-4">
                          {extractedFields.length > 0 && (
                            <div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4 mt-2">
                                {extractedFields.map((f, i) => (
                                  <div key={i} className="flex flex-col gap-1 pb-3 border-b border-slate-100">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{f.field}</span>
                                    <div className="flex items-center justify-between">
                                      <span className="text-sm font-semibold text-slate-900">{f.value}</span>
                                      {f.timestamp && (
                                        <Badge variant="outline" className="bg-slate-50 text-slate-400 font-mono text-[9px] px-1.5 py-0 h-4 flex items-center shrink-0 border-slate-200">
                                          <Clock className="w-2.5 h-2.5 mr-1" /> {f.timestamp}
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {allMissing.size > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-2">Missing Mandatory Fields</h4>
                              <div className="flex gap-2 flex-wrap">
                                {Array.from(allMissing).map((f, i) => (
                                  <Badge key={i} variant="outline" className="bg-rose-50 text-rose-700 border-rose-200">{f}</Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Objections */}
                  {(() => {
                    const objections = callsToDisplay.flatMap((c) => {
                      const absoluteIdx = evaluatedCalls.findIndex(ec => ec.id === c.id);
                      const callLabel = callsToDisplay.length > 1 ? `Call ${absoluteIdx + 1}` : null;
                      return (c.insights_data?.objections || []).map(obj => ({ ...obj, callLabel }));
                    });
                    if (objections.length === 0) return null;
                    return (
                      <div className="mt-8">
                        <div className="flex items-center gap-2 mb-4">
                          <div className="bg-teal-100/50 p-1 rounded-md">
                            <MessageSquare className="w-4 h-4 text-teal-600" />
                          </div>
                          <h3 className="text-base font-bold text-slate-800">Objections</h3>
                        </div>

                        <div className="space-y-4">
                          {objections.map((obj, idx) => (
                            <div key={idx} className="border border-slate-100 rounded-xl p-5 bg-white space-y-5 shadow-sm">
                              <div className="flex justify-between items-start gap-4">
                                <div>
                                  <div className="font-bold text-sm text-slate-900 mb-1.5 flex items-center gap-2">
                                    Objection
                                    {obj.callLabel && <Badge variant="outline" className="text-[10px] h-5 bg-slate-50">{obj.callLabel}</Badge>}
                                  </div>
                                  <div className="text-sm text-slate-900 leading-relaxed">{obj.objection}</div>
                                </div>
                                {obj.category && (
                                  <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-100/50 whitespace-nowrap shrink-0 font-bold px-2.5 py-0.5 text-[11px] rounded-md">
                                    {obj.category}
                                  </Badge>
                                )}
                              </div>

                              <div>
                                <div className="font-bold text-sm text-slate-900 mb-1.5">How this objection was handled?</div>
                                <div className="text-sm text-slate-900 leading-relaxed">{obj.how_handled}</div>
                              </div>

                              <div>
                                <div className="font-bold text-sm text-slate-900 mb-1.5">Was the customer satisfied with the salesperson's response?</div>
                                <div className="flex items-center gap-1.5 text-sm text-slate-900">
                                  {obj.customer_satisfied ? (
                                    <CheckCircle2 className="w-4 h-4 text-slate-500 shrink-0" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-slate-500 shrink-0" />
                                  )}
                                  <span>{obj.customer_satisfied ? "Customer satisfied with salesperson's response" : "Customer not satisfied with salesperson's response"}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}



                </section>
              </div>
            </ScrollArea>
          </TabsContent>

  );
}