import { useState, useEffect, useRef } from 'react';
import { getQCLead, getCoachingTemplates } from '../api';
import { ArrowLeft, Play, FileAudio, CheckCircle2, XCircle, BrainCircuit, Phone, Video, ChevronDown, ChevronUp, Lightbulb, TrendingUp, TrendingDown, Minus, MessageSquare, Loader2, RefreshCw, Star, PlayCircle, PauseCircle, Target, DollarSign, UserCheck, CalendarClock, Database, AlertTriangle, Share2, Trash2, Edit2, PlaySquare, SkipForward, FastForward, Info } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function formatDuration(seconds) {
  if (!seconds) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function CallPlayer({ call }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const audioRef = useRef(null);
  const segmentsContainerRef = useRef(null);
  const activeSegmentRef = useRef(null);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleSegmentClick = (start) => {
    if (audioRef.current) {
      audioRef.current.currentTime = start;
      if (!isPlaying) {
        audioRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  useEffect(() => {
    if (activeSegmentRef.current && segmentsContainerRef.current) {
      activeSegmentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentTime]);

  const segments = typeof call.segments === 'string' ? JSON.parse(call.segments) : (call.segments || []);
  const audioUrl = `http://localhost:3000/api/calls/${call.id}/audio`;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b">
        <div>
          <div className="font-semibold text-foreground flex items-center gap-2">
            Sep 07, 2026 | 03:30 PM
          </div>
          <div className="text-sm text-muted-foreground font-medium mt-0.5">Source: External Recordings</div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="text-muted-foreground"><Share2 className="w-4 h-4" /></Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground"><Trash2 className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Audio Player */}
      <div className="p-4 bg-slate-50 border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={togglePlay} className="h-10 w-10 shrink-0 text-slate-700 hover:text-slate-900">
            {isPlaying ? <PauseCircle className="h-8 w-8 fill-slate-700 text-white" /> : <PlayCircle className="h-8 w-8 fill-slate-700 text-white" />}
          </Button>
          <div className="text-sm font-medium tabular-nums">{formatDuration(currentTime)}</div>

          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative">
            <div
              className="absolute top-0 left-0 h-full bg-slate-400"
              style={{ width: `${call.duration_sec ? (currentTime / call.duration_sec) * 100 : 0}%` }}
            />
          </div>
          <div className="text-sm font-medium tabular-nums">{formatDuration(call.duration_sec)}</div>
          <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Badge variant="outline" className="text-xs bg-white text-slate-600">0.5x</Badge>
          <Badge variant="default" className="text-xs bg-slate-700">1x</Badge>
          <Badge variant="outline" className="text-xs bg-white text-slate-600">1.5x</Badge>
          <Badge variant="outline" className="text-xs bg-white text-slate-600">2x</Badge>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="transcript" className="w-full flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent px-4 gap-6">
          <TabsTrigger value="timeline" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent px-0 text-sm font-medium text-muted-foreground data-[state=active]:text-primary">Timeline View</TabsTrigger>
          <TabsTrigger value="transcript" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent px-0 text-sm font-medium text-muted-foreground data-[state=active]:text-primary">Transcript View</TabsTrigger>
        </TabsList>

        <TabsContent value="transcript" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full" ref={segmentsContainerRef}>
            <div className="p-4 space-y-3">
              {segments.map((seg, idx) => {
                const isActive = currentTime >= seg.start && currentTime < seg.end;
                const participantName = seg.speaker === 'SPEAKER_00' ? 'Participant 1' : 'Participant 2';

                return (
                  <div
                    key={idx}
                    ref={isActive ? activeSegmentRef : null}
                    onClick={() => handleSegmentClick(seg.start)}
                    className={cn(
                      "flex justify-between items-start p-4 rounded-lg border transition-colors cursor-pointer",
                      isActive ? "bg-slate-100 border-slate-300" : "bg-slate-50 hover:bg-slate-100 border-slate-200"
                    )}
                  >
                    <div className="text-sm">
                      <span className="text-slate-500 font-mono mr-3 text-xs">{formatDuration(seg.start)}-{formatDuration(seg.end)}</span>
                      <span className="font-bold text-slate-900 mr-2">{participantName} :</span>
                      <span className="text-slate-700 leading-relaxed">
                        {seg.text}
                        {seg.text_en && seg.text_en !== seg.text && (
                          <div className="mt-1 text-slate-500 italic">Translated: "{seg.text_en}"</div>
                        )}
                      </span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-600 shrink-0"><Edit2 className="w-3.5 h-3.5" /></Button>
                  </div>
                );
              })}
              {segments.length === 0 && (
                <div className="text-center text-muted-foreground p-8">No transcript available.</div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function LeadDetails({ leadId, onBack }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState([]);

  useEffect(() => {
    Promise.all([
      getQCLead(leadId),
      getCoachingTemplates()
    ]).then(([leadData, templatesData]) => {
      if (!leadData.error) setLead(leadData);
      setTemplates(templatesData || []);
      setLoading(false);
    });
  }, [leadId]);

  if (loading || !lead) {
    return <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /><p>Loading Lead History...</p></div>;
  }

  const totalDuration = lead.calls?.reduce((acc, c) => acc + (c.duration_sec || 0), 0) || 0;
  const intentScore = lead.intent_score || 0;
  const avgQuality = lead.avg_call_quality_score || 0;

  const ttlCalls = lead.calls?.filter(c => c.talk_to_listen_ratio) || [];
  let avgTtl = "0:0";
  if (ttlCalls.length > 0) {
    let repSum = 0, custSum = 0;
    ttlCalls.forEach(c => {
      const [rep, cust] = c.talk_to_listen_ratio.split(':').map(Number);
      if (!isNaN(rep) && !isNaN(cust)) {
        repSum += rep;
        custSum += cust;
      }
    });
    avgTtl = `${Math.round(repSum / ttlCalls.length)}:${Math.round(custSum / ttlCalls.length)}`;
  }

  return (
    <div className="flex flex-col h-full bg-white min-h-screen text-slate-900">
      {/* HEADER SECTION - ZIPTEAMS CLONE */}
      <div className="border-b px-8 py-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-amber-400 text-white rounded-full flex items-center justify-center text-xl font-bold shadow-sm">
            {lead.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight mb-1 flex items-center gap-2">
              {lead.name}
            </h1>
            <div className="flex gap-4 text-xs text-muted-foreground items-center">
              <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {lead.phone || lead.email || '—'}</span>
              <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Owner Name: <span className="font-semibold text-foreground">{lead.owner || 'Unassigned'}</span></span>
            </div>
          </div>
        </div>

        <div className="flex gap-4">
          {[
            { value: `${Math.ceil(totalDuration / 60)} mins`, label: 'Total Conversation Duration' },
            { value: avgTtl, label: 'Talk-to-Listen Ratio', icon: <Info className="w-3 h-3 text-muted-foreground inline-block ml-1" /> },
            { value: `${intentScore}/100`, label: 'Intent Score' },
            { value: `${avgQuality}%`, label: 'Avg. Call Quality Score' },
          ].map((stat, i) => (
            <div key={i} className="bg-slate-100 rounded-lg p-3 px-4 min-w-[140px]">
              <div className="text-lg font-bold">{stat.value}</div>
              <div className="text-xs text-slate-500 mt-1 whitespace-nowrap">{stat.label}{stat.icon}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TABS & MAIN CONTENT WRAPPER */}
      <Tabs defaultValue="conversations" className="flex-1 flex flex-col min-h-0 w-full" id="top-tabs" onValueChange={() => { }}>
        <div className="px-8 border-b flex justify-between items-center bg-white">
          <TabsList className="w-[500px] justify-start h-12 bg-transparent p-0 gap-6">
            <TabsTrigger value="insights" className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-800 data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent px-0 text-sm font-semibold text-slate-500 data-[state=active]:text-slate-900">Insights</TabsTrigger>
            <TabsTrigger value="conversations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-800 data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent px-0 text-sm font-semibold text-slate-500 data-[state=active]:text-slate-900">Conversations</TabsTrigger>
            <TabsTrigger value="coaching" className="rounded-none border-b-2 border-transparent data-[state=active]:border-slate-800 data-[state=active]:shadow-none bg-transparent data-[state=active]:bg-transparent px-0 text-sm font-semibold text-slate-500 data-[state=active]:text-slate-900">Coaching</TabsTrigger>
          </TabsList>

          
        </div>

        {/* MAIN TWO-COLUMN CONTENT */}
        <div className="flex-1 p-6 overflow-hidden">
          <TabsContent value="insights" className="h-full mt-0">
            <ScrollArea className="h-full pr-4">
              <div className="max-w-4xl space-y-8 pb-8">
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <BrainCircuit className="w-5 h-5 text-purple-500" />
                    <h3 className="text-lg font-semibold">Path to Conversion</h3>
                  </div>

                  <Card className="shadow-sm bg-purple-500/5 border-purple-500/10">
                    <CardHeader className="pb-3 border-b border-purple-500/10">
                      <CardTitle className="text-sm">Conversation Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                      {lead.journey_summary ? (
                        <div className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                          {lead.journey_summary}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-500 italic">No journey summary available yet.</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Buying Intent Analysis */}
                  {(() => {
                    const latestCall = lead.calls?.[lead.calls.length - 1];
                    const intentScore = latestCall?.insights_data?.intent_score;
                    const highIntent = latestCall?.insights_data?.high_intent_factors;
                    const lowIntent = latestCall?.insights_data?.low_intent_factors;
                    if (!highIntent && !lowIntent) return null;
                    return (
                      <Card className="shadow-sm mt-6 border-slate-200">
                        <CardHeader className="pb-3 border-b bg-slate-50 flex flex-row items-center justify-between">
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
                                {highIntent?.map((factor, idx) => (
                                  <li key={idx} className="flex gap-2 items-start text-sm">
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                    <span className="text-slate-600">{factor}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-3 flex items-center gap-1.5"><TrendingDown className="w-3.5 h-3.5" /> Low Intent Factors</h4>
                              <ul className="space-y-2">
                                {lowIntent?.map((factor, idx) => (
                                  <li key={idx} className="flex gap-2 items-start text-sm">
                                    <Minus className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                    <span className="text-slate-600">{factor}</span>
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
                    const latestCall = lead.calls?.[lead.calls.length - 1];
                    const bant = latestCall?.insights_data?.bant;
                    if (!bant) return null;
                    return (
                      <Card className="shadow-sm mt-6 border-slate-200">
                        <CardHeader className="pb-3 border-b bg-slate-50">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Target className="w-4 h-4 text-indigo-500" /> BANT Analysis
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5">
                          <div className="grid grid-cols-2 gap-4">
                            {Object.entries(bant).map(([key, data]) => (
                              <div key={key} className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1 flex justify-between">
                                  {key}
                                  <span className={cn("px-1.5 py-0.5 rounded text-[10px] font-bold", data.status === 'Qualified' ? 'bg-emerald-100 text-emerald-700' : data.status === 'Unqualified' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>{data.status}</span>
                                </div>
                                <div className="text-sm text-slate-700">{data.details}</div>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Data Capture */}
                  {(() => {
                    const latestCall = lead.calls?.[lead.calls.length - 1];
                    const dc = latestCall?.insights_data?.data_capture;
                    if (!dc) return null;
                    return (
                      <Card className="shadow-sm mt-6 border-slate-200">
                        <CardHeader className="pb-3 border-b bg-slate-50">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Database className="w-4 h-4 text-blue-500" /> Data Capture
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-5 space-y-4">
                          {dc.extracted_fields?.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Captured Fields</h4>
                              <div className="grid grid-cols-2 gap-2">
                                {dc.extracted_fields.map((f, i) => (
                                  <div key={i} className="flex justify-between items-center text-sm p-2 bg-slate-50 border rounded-md">
                                    <span className="font-medium text-slate-700">{f.field}</span>
                                    <span className="text-slate-900 font-medium">{f.value}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {dc.missing_mandatory_fields?.length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-rose-500 uppercase tracking-wide mb-2">Missing Mandatory Fields</h4>
                              <div className="flex gap-2 flex-wrap">
                                {dc.missing_mandatory_fields.map((f, i) => (
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
                    const latestCall = lead.calls?.[lead.calls.length - 1];
                    const objections = latestCall?.insights_data?.objections;
                    if (!objections || objections.length === 0) return null;
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
                                  <div className="font-bold text-sm text-slate-900 mb-1.5">Objection</div>
                                  <div className="text-sm text-slate-600 leading-relaxed">{obj.objection}</div>
                                </div>
                                {obj.category && (
                                  <Badge variant="outline" className="bg-teal-50 text-teal-700 border-teal-100/50 whitespace-nowrap shrink-0 font-bold px-2.5 py-0.5 text-[11px] rounded-md">
                                    {obj.category}
                                  </Badge>
                                )}
                              </div>

                              <div>
                                <div className="font-bold text-sm text-slate-900 mb-1.5">How this objection was handled?</div>
                                <div className="text-sm text-slate-600 leading-relaxed">{obj.how_handled}</div>
                              </div>

                              <div>
                                <div className="font-bold text-sm text-slate-900 mb-1.5">Was the customer satisfied with the salesperson's response?</div>
                                <div className="flex items-center gap-1.5 text-sm text-slate-600">
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

          <TabsContent value="conversations" className="h-full mt-0">
            {lead.calls?.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full max-w-full">

                {/* LEFT PANE: Audio & Transcript */}
                <CallPlayer call={lead.calls[0]} />

                {/* RIGHT PANE: Summary / Insights / Quality */}
                <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden">
                  <Tabs defaultValue="quality" className="w-full flex-1 flex flex-col min-h-0">
                    <TabsList className="w-full justify-between border-b rounded-none h-14 bg-slate-50 px-4">
                      <TabsTrigger value="summary" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-slate-300 data-[state=active]:shadow-none data-[state=active]:bg-slate-200/50 bg-transparent text-sm font-bold text-slate-600 data-[state=active]:text-slate-900">Summary</TabsTrigger>
                      <TabsTrigger value="insights" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-slate-300 data-[state=active]:shadow-none data-[state=active]:bg-slate-200/50 bg-transparent text-sm font-bold text-slate-600 data-[state=active]:text-slate-900">Insights</TabsTrigger>
                      <TabsTrigger value="quality" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:shadow-none data-[state=active]:bg-blue-50 bg-transparent text-sm font-bold text-slate-600 data-[state=active]:text-blue-700">Quality</TabsTrigger>
                    </TabsList>

                    <TabsContent value="quality" className="flex-1 overflow-hidden mt-0 p-0">
                      <ScrollArea className="h-full">
                        <div className="p-6 space-y-8">
                          <div className="flex justify-between items-center pb-4 border-b">
                            <div className="font-bold text-sm">
                              Overall Call Quality Score: <span className="text-emerald-600">{lead.calls[0].call_quality_score}%</span> <span className="text-slate-500 font-normal">({Math.round((lead.calls[0].call_quality_score / 100) * 124)}/124)</span>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400"><RefreshCw className="w-4 h-4" /></Button>
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400"><Edit2 className="w-4 h-4" /></Button>
                            </div>
                          </div>

                          {lead.calls[0].quality_data ? (
                            Object.entries(lead.calls[0].quality_data).map(([param, data], idx) => {
                              let badgeClass = "bg-slate-100 text-slate-600";
                              if (data.status === 'Done') badgeClass = "bg-emerald-50 text-emerald-700";
                              else if (data.status === 'Missed') badgeClass = "bg-rose-50 text-rose-700";
                              else if (data.status === 'Partially Done') badgeClass = "bg-amber-50 text-amber-700";

                              return (
                                <div key={idx} className="space-y-3 pb-6 border-b border-dashed last:border-0">
                                  <div className="flex justify-between items-center">
                                    <h4 className="font-bold text-sm text-slate-900">{param}</h4>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400"><Edit2 className="w-3.5 h-3.5" /></Button>
                                      <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400"><PlayCircle className="w-3.5 h-3.5" /></Button>
                                    </div>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                    <Badge className={cn("px-2 font-bold tabular-nums hover:opacity-90 shadow-none border-transparent", data.score === data.max_score ? "bg-emerald-100 text-emerald-700" : data.score > 0 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
                                      {data.score}/{data.max_score}
                                    </Badge>
                                    <span className={cn("text-xs font-bold", data.status === 'Done' ? "text-emerald-600" : data.status === 'Missed' ? "text-rose-600" : "text-amber-600")}>
                                      {data.status}
                                    </span>
                                  </div>
                                  <p className="text-sm text-slate-600 leading-relaxed">
                                    {data.reason}
                                  </p>
                                  <div className="flex gap-2 mt-2 items-center text-xs font-bold">
                                    <span className="text-slate-900 mr-2">Mark</span>
                                    <Badge variant="outline" className={cn("cursor-pointer", data.status === 'Done' ? 'bg-emerald-50' : 'bg-white text-slate-500')}>Done</Badge>
                                    <Badge variant="outline" className={cn("cursor-pointer", data.status === 'Partially Done' ? 'bg-amber-50' : 'bg-white text-slate-500')}>Needs Improvement</Badge>
                                    <Badge variant="outline" className={cn("cursor-pointer", data.status === 'Not Applicable' ? 'bg-slate-100' : 'bg-white text-slate-500')}>Not Applicable</Badge>
                                  </div>
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
                      {lead.calls[0].summary_data ? (
                        <div className="space-y-6">
                          <div>
                            <h5 className="font-semibold text-sm mb-2">Call Summary</h5>
                            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                              {lead.calls[0].summary_data.call_summary?.map((pt, i) => <li key={i}>{pt}</li>)}
                            </ul>
                          </div>
                          <div>
                            <h5 className="font-semibold text-sm mb-2">Key Points</h5>
                            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
                              {lead.calls[0].summary_data.key_points?.map((pt, i) => <li key={i}>{pt}</li>)}
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
                          {lead.calls[0].coaching_report?.category_scores?.length > 0 ? (
                            lead.calls[0].coaching_report.category_scores.map((cat, idx) => (
                              <div key={idx} className="bg-slate-50 border rounded-lg p-4">
                                <div className="flex justify-between items-center mb-4">
                                  <h4 className="font-bold text-sm text-slate-800">{cat.category}</h4>
                                  <Badge variant="outline" className="bg-white">{cat.score}% - Grade {cat.grade}</Badge>
                                </div>
                                <div className="space-y-4">
                                  {cat.what_went_wrong && (
                                    <div className="flex gap-3">
                                      <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                                      <div>
                                        <span className="font-semibold text-rose-700 block mb-1 uppercase text-xs tracking-wide">What went wrong</span>
                                        <span className="text-sm text-slate-600">{cat.what_went_wrong}</span>
                                      </div>
                                    </div>
                                  )}
                                  {cat.coach_tip && (
                                    <div className="flex gap-3">
                                      <Lightbulb className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                                      <div>
                                        <span className="font-semibold text-amber-700 block mb-1 uppercase text-xs tracking-wide">How to fix (Coaching Tip)</span>
                                        <span className="text-sm text-slate-600">{cat.coach_tip}</span>
                                      </div>
                                    </div>
                                  )}
                                  {cat.what_went_well && (
                                    <div className="flex gap-3 pt-2 mt-2 border-t border-slate-200/60">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                      <div>
                                        <span className="font-semibold text-emerald-700 block mb-1 uppercase text-xs tracking-wide">What went well</span>
                                        <span className="text-sm text-slate-600">{cat.what_went_well}</span>
                                      </div>
                                    </div>
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

          <TabsContent value="coaching" className="h-full mt-0">
            <div className="h-full flex flex-col pt-4">
              <ScrollArea className="flex-1 pr-4">
                {/* Top Strengths */}
                {(() => {
                  const latestCall = lead.calls?.[lead.calls.length - 1];
                  const strengths = latestCall?.coaching_report?.top_strengths;
                  if (!strengths || strengths.length === 0) return null;
                  return (
                    <Card className="shadow-sm mb-6 border-emerald-500/10 bg-emerald-500/5">
                      <CardHeader className="pb-3 border-b border-emerald-500/10">
                        <CardTitle className="text-sm flex items-center gap-2 text-emerald-700">
                          <Star className="w-4 h-4" /> Top Strengths
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-5">
                        <ul className="space-y-2">
                          {strengths.map((s, idx) => (
                            <li key={idx} className="flex gap-2 items-start text-sm">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <span className="text-slate-600">{s}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Critical Improvements */}
                {(() => {
                  const latestCall = lead.calls?.[lead.calls.length - 1];
                  const improvements = latestCall?.coaching_report?.critical_improvements;
                  if (!improvements || improvements.length === 0) return null;
                  return (
                    <Card className="shadow-sm mb-8 border-destructive/10 bg-destructive/5">
                      <CardHeader className="pb-3 border-b border-destructive/10">
                        <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                          <AlertTriangle className="w-4 h-4" /> Critical Improvements
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-5">
                        <ul className="space-y-2">
                          {improvements.map((imp, idx) => (
                            <li key={idx} className="flex gap-2 items-start text-sm">
                              <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                              <span className="text-slate-600">{imp}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* Prescriptive Coaching (Actionable Coaching Templates) */}
                {(() => {
                  const latestCall = lead.calls?.[lead.calls.length - 1];
                  const coaching = latestCall?.coaching_report?.prescriptive_coaching;
                  if (!coaching || coaching.length === 0) return (
                    <div className="flex flex-col items-center justify-center p-12 text-slate-400 border-2 border-dashed rounded-xl mt-8">
                      <Target className="w-10 h-10 mb-4 opacity-50" />
                      <p className="font-medium">No coaching templates generated for this call.</p>
                    </div>
                  );
                  return (
                    <Card className="shadow-sm mb-8 border-amber-500/20 bg-amber-50/50">
                      <CardHeader className="pb-3 border-b border-amber-500/10">
                        <CardTitle className="text-sm flex items-center gap-2 text-amber-700">
                          <Target className="w-4 h-4" /> Actionable Coaching Templates
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-5 space-y-6">
                        {coaching.map((c, idx) => (
                          <div key={idx} className="space-y-3">
                            <div className="font-semibold text-sm text-slate-800">{c.situation}</div>

                            <div className="flex gap-3 bg-rose-50/50 p-3 rounded-lg border border-rose-100">
                              <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                              <div>
                                <div className="text-xs font-semibold text-rose-700 mb-1 uppercase tracking-wide">What went wrong</div>
                                <div className="text-sm text-slate-700 italic">"{c.what_associate_said}"</div>
                              </div>
                            </div>

                            <div className="flex gap-3 bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <div>
                                <div className="text-xs font-semibold text-emerald-700 mb-1 uppercase tracking-wide">Golden Pitch (How to fix)</div>
                                <div className="text-sm text-slate-900 font-medium mb-2">"{c.golden_pitch}"</div>
                                <div className="text-xs text-emerald-700 font-medium bg-emerald-100/50 p-2 rounded">Why it works: {c.why_it_works}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })()}
              </ScrollArea>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

