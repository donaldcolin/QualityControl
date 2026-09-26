import { useState, useEffect, useRef } from 'react';
import { getQCLead, evaluateCall, evaluateLeadIntelligence, resendCallToASR } from '../api';
import { ArrowLeft, Play, FileAudio, CheckCircle2, XCircle, Clock, AlertCircle, BrainCircuit, Phone, Video, ChevronDown, ChevronUp, Lightbulb, TrendingUp, TrendingDown, Minus, MessageSquare, Loader2, RefreshCw, Star, PlayCircle, PauseCircle, Target, DollarSign, UserCheck, CalendarClock, Database, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Helpers
function scoreColor(score) {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-blue-500';
  if (score >= 40) return 'text-amber-500';
  return 'text-destructive';
}

function scoreBgColor(score) {
  if (score >= 80) return 'bg-emerald-500/15 text-emerald-700 border-transparent font-medium shadow-sm';
  if (score >= 60) return 'bg-blue-500/15 text-blue-700 border-transparent font-medium shadow-sm';
  if (score >= 40) return 'bg-amber-500/15 text-amber-700 border-transparent font-medium shadow-sm';
  return 'bg-destructive/15 text-destructive border-transparent font-medium shadow-sm';
}

function formatDuration(seconds) {
  if (!seconds) return '0 mins';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

// Conversation Audio Player & Transcript Component
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
        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setIsPlaying(true);
          }).catch(error => {
            console.error("Audio playback failed:", error);
            setIsPlaying(false);
          });
        } else {
          setIsPlaying(true);
        }
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
    <div className="flex flex-col gap-4 border rounded-lg p-4 bg-background">
      <div className="flex items-center gap-4 bg-muted/30 p-3 rounded-lg">
        <Button variant="outline" size="icon" onClick={togglePlay} className="h-10 w-10 shrink-0 rounded-full">
          {isPlaying ? <PauseCircle className="h-6 w-6" /> : <PlayCircle className="h-6 w-6" />}
        </Button>
        <div className="flex-1">
          <div className="text-sm font-medium mb-1">{call.filename || 'Audio Recording'}</div>
          <audio 
            ref={audioRef} 
            src={audioUrl} 
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            className="w-full h-8"
            controls
          />
        </div>
      </div>
      
      <ScrollArea className="h-[400px] pr-4" ref={segmentsContainerRef}>
        <div className="space-y-4">
          {segments.map((seg, idx) => {
            const isActive = currentTime >= seg.start && currentTime < seg.end;
            const isSpeaker0 = seg.speaker === 'SPEAKER_00';
            
            return (
              <div 
                key={idx} 
                ref={isActive ? activeSegmentRef : null}
                onClick={() => handleSegmentClick(seg.start)}
                className={cn(
                  "flex gap-3 text-sm transition-colors p-2 rounded-lg cursor-pointer",
                  isActive ? "bg-primary/10 border-primary/20" : "hover:bg-muted/50",
                  isSpeaker0 ? "pr-12" : "pl-12 flex-row-reverse"
                )}
              >
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0 text-xs font-semibold">
                  {isSpeaker0 ? 'S0' : 'S1'}
                </div>
                <div className={cn("flex flex-col", isSpeaker0 ? "" : "items-end text-right")}>
                  <div className="text-xs text-muted-foreground mb-1">
                    {formatDuration(seg.start)}
                  </div>
                  <div className="bg-muted/40 p-3 rounded-2xl rounded-tl-sm text-foreground">
                    {seg.text_en || seg.text}
                  </div>
                </div>
              </div>
            );
          })}
          {segments.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No transcript segments available.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}


export default function LeadDetails({ leadId, onBack }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [evaluatingCall, setEvaluatingCall] = useState(null);

  useEffect(() => {
    loadLeadDetails();
  }, [leadId]);

  const loadLeadDetails = () => {
    setLoading(true);
    getQCLead(leadId).then(data => {
      if (!data.error) setLead(data);
      setLoading(false);
    });
  };

  const handleRunQC = async (callId) => {
    setEvaluatingCall(callId);
    try {
      await evaluateCall(callId);
      await loadLeadDetails();
    } catch (error) {
      console.error("QC failed", error);
    }
    setEvaluatingCall(null);
  };

  if (loading || !lead) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p>Loading Lead History...</p>
      </div>
    );
  }

  // Aggregate metrics
  const totalDuration = lead.calls?.reduce((acc, c) => acc + (c.duration_sec || 0), 0) || 0;
  const intentScore = lead.intent_score || 0;
  const avgQuality = lead.avg_call_quality_score || 0;
  
  // Calculate average talk-to-listen from calls that have it
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
    avgTtl = `${Math.round(repSum/ttlCalls.length)}:${Math.round(custSum/ttlCalls.length)}`;
  }

  return (
    <div className="flex flex-col h-full bg-background min-h-screen">
      {/* Top Embedded Navigation/Header (Zipteams style) */}
      <div className="border-b border-border/50 px-8 py-5 bg-background/80 backdrop-blur-md flex flex-col md:flex-row justify-between items-start md:items-center gap-6 sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-gradient-to-br from-amber-400 to-amber-600 text-white rounded-full flex items-center justify-center text-2xl font-bold shadow-md ring-2 ring-background">
            {lead.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{lead.name}</h1>
            <div className="flex gap-4 text-sm text-muted-foreground mt-1">
              <span>{lead.phone || lead.email || 'No contact info'}</span>
              <span>Owner: <span className="font-medium text-foreground">{lead.owner || 'Hemalatha.rajendran'}</span></span>
            </div>
          </div>
        </div>

        <div className="flex gap-8 items-center bg-muted/30 p-3.5 px-6 rounded-2xl border border-border/50 shadow-sm">
          <div className="text-center">
            <div className="text-xl font-extrabold text-foreground">{formatDuration(totalDuration)}</div>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-1">Total Duration</div>
          </div>
          <div className="w-px h-10 bg-border/50"></div>
          <div className="text-center">
            <div className="text-xl font-extrabold text-foreground">{avgTtl}</div>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-1">Talk/Listen</div>
          </div>
          <div className="w-px h-10 bg-border/50"></div>
          <div className="text-center">
            <div className={cn("text-xl font-extrabold", scoreColor(intentScore))}>{intentScore}/100</div>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-1">Intent Score</div>
          </div>
          <div className="w-px h-10 bg-border/50"></div>
          <div className="text-center">
            <div className={cn("text-xl font-extrabold", scoreColor(avgQuality))}>{avgQuality}%</div>
            <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mt-1">Avg Quality</div>
          </div>
        </div>
      </div>

      <div className="p-8">
        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="mb-6 w-full justify-start border-b rounded-none h-12 bg-transparent p-0">
            <TabsTrigger value="insights" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 h-full data-[state=active]:shadow-none">Insights</TabsTrigger>
            <TabsTrigger value="conversations" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-6 h-full data-[state=active]:shadow-none">Conversations ({lead.calls?.length || 0})</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="mt-0">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              
              {/* LEFT COLUMN: Buying Intent & Objections */}
              <div className="lg:col-span-2 space-y-8">
                
                {/* Buying Intent Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <Target className="w-5 h-5 text-emerald-500" />
                    <h3 className="text-lg font-semibold">Buying Intent</h3>
                  </div>
                  
                  <Card className="shadow-md border-border/50 rounded-xl overflow-hidden">
                    <div className="p-4 border-b border-border/50 bg-muted/30 flex items-center gap-3">
                      <span className="font-semibold text-sm">Intent Level:</span>
                      <Badge className={cn("rounded-full px-3 py-0.5", scoreBgColor(intentScore))} variant="outline">
                        {intentScore >= 80 ? 'High Intent' : intentScore >= 50 ? 'Medium Intent' : 'Low Intent'} {intentScore}/100
                      </Badge>
                    </div>
                    <CardContent className="p-6 space-y-6">
                      
                      {/* High Intent Factors */}
                      <div>
                        <h4 className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mb-3">High Intent factors</h4>
                        <ul className="space-y-3">
                          {(lead.intent_factors || []).filter(f => f.type === 'high').map((factor, idx) => (
                            <li key={idx} className="flex gap-3 text-sm">
                              <TrendingUp className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <span className="text-muted-foreground">{factor.factor}</span>
                            </li>
                          ))}
                          {(!lead.intent_factors || lead.intent_factors.filter(f => f.type === 'high').length === 0) && (
                            <li className="text-sm text-muted-foreground italic">No high intent factors identified yet.</li>
                          )}
                        </ul>
                      </div>

                      {/* Low Intent Factors */}
                      <div>
                        <h4 className="text-sm font-semibold text-destructive mb-3">Low Intent factors</h4>
                        <ul className="space-y-3">
                          {(lead.intent_factors || []).filter(f => f.type === 'low').map((factor, idx) => (
                            <li key={idx} className="flex gap-3 text-sm">
                              <TrendingDown className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                              <span className="text-muted-foreground">{factor.factor}</span>
                            </li>
                          ))}
                          {(!lead.intent_factors || lead.intent_factors.filter(f => f.type === 'low').length === 0) && (
                            <li className="text-sm text-muted-foreground italic">No low intent factors identified yet.</li>
                          )}
                        </ul>
                      </div>

                    </CardContent>
                  </Card>
                </section>

                {/* BANT Qualification Section */}
                {lead.bant_insights && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Target className="w-5 h-5 text-blue-500" />
                      <h3 className="text-lg font-semibold">BANT Qualification</h3>
                    </div>
                    <Card className="shadow-md border-border/50 rounded-xl overflow-hidden">
                      <CardContent className="p-0">
                        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/50">
                          {Object.entries(lead.bant_insights).map(([key, val]) => {
                            let Icon = Target;
                            if (key === 'budget') Icon = DollarSign;
                            if (key === 'authority') Icon = UserCheck;
                            if (key === 'timeline') Icon = CalendarClock;

                            let statusColor = "text-muted-foreground bg-muted";
                            if (val.status === 'Qualified') statusColor = "text-emerald-700 bg-emerald-500/15";
                            if (val.status === 'Unqualified') statusColor = "text-destructive bg-destructive/15";
                            if (val.status === 'Uncertain') statusColor = "text-amber-700 bg-amber-500/15";

                            return (
                              <div key={key} className="p-5 hover:bg-muted/20 transition-colors">
                                <div className="flex justify-between items-start mb-2">
                                  <div className="flex items-center gap-2">
                                    <Icon className="w-4 h-4 text-muted-foreground" />
                                    <div className="text-xs uppercase font-bold text-muted-foreground tracking-wider">{key}</div>
                                  </div>
                                  <Badge className={cn("shadow-none border-transparent font-medium", statusColor)}>{val.status}</Badge>
                                </div>
                                <div className="text-sm mt-3 text-foreground leading-relaxed">{val.details}</div>
                              </div>
                            );
                          })}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Data Capture Section */}
                {lead.data_capture && (
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <Database className="w-5 h-5 text-indigo-500" />
                      <h3 className="text-lg font-semibold">Captured Data</h3>
                    </div>
                    
                    {lead.data_capture.missing_mandatory_fields?.length > 0 && (
                      <div className="mb-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex gap-3 items-start">
                        <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                        <div>
                          <h4 className="text-sm font-bold text-destructive mb-1">Missing Mandatory Information</h4>
                          <p className="text-sm text-destructive/80">
                            The following required fields have not been captured yet: <span className="font-semibold">{lead.data_capture.missing_mandatory_fields.join(', ')}</span>
                          </p>
                        </div>
                      </div>
                    )}

                    <Card className="shadow-md border-border/50 rounded-xl overflow-hidden">
                      <CardContent className="p-0">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-[1px] bg-border/50">
                          {lead.data_capture.extracted_fields?.map((field, idx) => (
                            <div key={idx} className="bg-card p-4">
                              <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">{field.field}</div>
                              <div className="text-sm font-semibold">{field.value}</div>
                              <div className={cn("text-[10px] mt-2 font-medium", 
                                field.confidence === 'High' ? 'text-emerald-500' : field.confidence === 'Medium' ? 'text-amber-500' : 'text-destructive'
                              )}>
                                {field.confidence} Confidence
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </section>
                )}

                {/* Objections Section */}
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <MessageSquare className="w-5 h-5 text-blue-500" />
                    <h3 className="text-lg font-semibold">Objections</h3>
                  </div>
                  
                  <div className="space-y-4">
                    {lead.calls?.map(call => {
                      const objections = call.insights_data?.objections || [];
                      return objections.map((obj, idx) => (
                        <Card key={`${call.id}-${idx}`} className="shadow-sm">
                          <CardContent className="p-5">
                            <div className="flex justify-between items-start mb-3">
                               <div className="font-semibold text-sm">Objection</div>
                               <Badge variant="outline" className="text-blue-600 bg-blue-500/10 border-blue-500/20">{obj.category || 'General'}</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground mb-4">{obj.objection}</p>
                            
                            <div className="font-semibold text-sm mb-1">How this objection was handled?</div>
                            <p className="text-sm text-muted-foreground mb-4">{obj.how_handled}</p>
                            
                            <div className="font-semibold text-sm mb-1">Was the customer satisfied with the salesperson's response?</div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                {obj.customer_satisfied ? <CheckCircle2 className="w-4 h-4 text-emerald-500"/> : <AlertCircle className="w-4 h-4 text-amber-500"/>}
                                {obj.customer_satisfied ? "Customer satisfied with response" : "Customer not fully convinced"}
                            </div>
                          </CardContent>
                        </Card>
                      ));
                    })}
                    {(!lead.calls || !lead.calls.some(c => c.insights_data?.objections?.length > 0)) && (
                      <div className="text-center p-8 bg-muted/10 border border-dashed rounded-lg text-muted-foreground">
                        No objections captured in the recent calls.
                      </div>
                    )}
                  </div>
                </section>

              </div>

              {/* RIGHT COLUMN: Path to Conversion & Coaching */}
              <div className="space-y-8">
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <BrainCircuit className="w-5 h-5 text-purple-500" />
                    <h3 className="text-lg font-semibold">Path to Conversion & Coaching</h3>
                  </div>

                  <Card className="shadow-sm bg-purple-500/5 border-purple-500/10">
                    <CardHeader className="pb-3 border-b border-purple-500/10">
                      <CardTitle className="text-sm">Previous Conversation Summary</CardTitle>
                    </CardHeader>
                    <CardContent className="p-5">
                      {lead.journey_summary ? (
                         <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                            {lead.journey_summary}
                         </div>
                      ) : (
                         <div className="text-sm text-muted-foreground italic">No journey summary available yet. Run a call evaluation to generate one.</div>
                      )}
                    </CardContent>
                  </Card>

                  <Card className="shadow-sm mt-6 border-blue-500/10">
                    <CardHeader className="pb-3 border-b bg-blue-500/5">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Lightbulb className="w-4 h-4 text-blue-500" /> What to do next?
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      {lead.next_process_step ? (
                        <div className="p-5">
                           <div className="font-semibold text-sm mb-4">{lead.next_process_step}</div>
                           
                           {/* Dig into the latest call's next_steps array to find the suggested script */}
                           {lead.calls?.[lead.calls.length - 1]?.insights_data?.next_steps?.map((step, idx) => (
                             <div key={idx} className="mb-4 last:mb-0">
                                <div className="text-sm font-medium mb-2">{idx + 1}. {step.title}</div>
                                {step.suggested_say && (
                                    <div className="flex gap-3 bg-muted/30 p-3 rounded-lg border">
                                        <MessageSquare className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                                        <div>
                                            <div className="text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">Say:</div>
                                            <div className="text-sm italic">"{step.suggested_say}"</div>
                                        </div>
                                    </div>
                                )}
                                <div className="flex gap-2 mt-2 items-start text-sm">
                                   <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                                   <span className="text-muted-foreground">{step.description}</span>
                                </div>
                             </div>
                           ))}
                        </div>
                      ) : (
                         <div className="p-5 text-sm text-muted-foreground italic">No recommended next steps.</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Golden Pitch / Prescriptive Coaching */}
                  {(() => {
                    const latestCall = lead.calls?.[lead.calls.length - 1];
                    const coaching = latestCall?.coaching_report?.prescriptive_coaching;
                    if (!coaching || coaching.length === 0) return null;

                    return (
                      <Card className="shadow-sm mt-6 border-emerald-500/20 bg-emerald-500/5">
                        <CardHeader className="pb-3 border-b border-emerald-500/10">
                          <CardTitle className="text-sm flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                            <Target className="w-4 h-4" /> Golden Pitch Corrections
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                          <div className="p-5 space-y-6">
                            {coaching.map((pc, idx) => (
                              <div key={idx} className="space-y-3">
                                <div className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{pc.situation}</div>
                                
                                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 relative">
                                  <div className="text-[10px] font-bold text-destructive uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <XCircle className="h-3 w-3" /> You said
                                  </div>
                                  <div className="text-sm italic">"{pc.what_associate_said}"</div>
                                </div>
                                
                                <div className="bg-emerald-500/15 border border-emerald-500/30 rounded-md p-3">
                                  <div className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-widest mb-1 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Golden Pitch
                                  </div>
                                  <div className="text-sm font-medium">"{pc.golden_pitch}"</div>
                                </div>
                                
                                <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded flex gap-2">
                                  <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                                  <span>{pc.why_it_works}</span>
                                </div>
                                {idx < coaching.length - 1 && <hr className="my-4 border-border/50" />}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })()}

                </section>
              </div>

            </div>
          </TabsContent>

          <TabsContent value="conversations" className="mt-0">
            <div className="space-y-6 max-w-4xl">
              {lead.calls?.map((call, index) => {
                const sourceIcon = call.source === 'google_meet' ? <Video className="w-4 h-4 text-purple-500" /> : <Phone className="w-4 h-4 text-blue-500" />;
                const sourceLabel = call.source === 'google_meet' ? 'Video Demo' : 'Phone Call';
                
                return (
                  <Card key={call.id} className="shadow-sm overflow-hidden border-l-4 border-l-border focus-within:border-l-primary transition-colors">
                    <div className="p-5 bg-muted/20 border-b flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                       <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-background border flex items-center justify-center shadow-sm">
                             {sourceIcon}
                          </div>
                          <div>
                             <h4 className="font-semibold text-base flex items-center gap-2">
                               {sourceLabel} #{index + 1}
                             </h4>
                             <div className="text-sm text-muted-foreground flex items-center gap-3 mt-1">
                                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5"/> {formatDuration(call.duration_sec)}</span>
                                {call.talk_to_listen_ratio && <span>• TTL: {call.talk_to_listen_ratio}</span>}
                             </div>
                          </div>
                       </div>
                       
                       <div className="flex items-center gap-3">
                          {call.call_quality_score != null && (
                             <Badge className={scoreBgColor(call.call_quality_score)} variant="outline">
                               Quality: {call.call_quality_score}%
                             </Badge>
                          )}
                          {call.qc_status === 'pending' ? (
                             <Button onClick={() => handleRunQC(call.id)} disabled={evaluatingCall === call.id} size="sm" variant="secondary" className="gap-2">
                               {evaluatingCall === call.id ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <Play className="w-3.5 h-3.5" />} Evaluate Call
                             </Button>
                          ) : (
                             <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"><CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Evaluated</Badge>
                          )}
                       </div>
                    </div>

                    <CardContent className="p-0">
                      <Tabs defaultValue="transcript" className="w-full">
                        <TabsList className="w-full justify-start border-b rounded-none h-10 bg-transparent px-2">
                          <TabsTrigger value="transcript" className="rounded-none data-[state=active]:bg-muted/50 data-[state=active]:shadow-none text-xs">Transcript & Audio</TabsTrigger>
                          <TabsTrigger value="summary" className="rounded-none data-[state=active]:bg-muted/50 data-[state=active]:shadow-none text-xs">Call Summary</TabsTrigger>
                          <TabsTrigger value="quality" className="rounded-none data-[state=active]:bg-muted/50 data-[state=active]:shadow-none text-xs">Quality Scores</TabsTrigger>
                        </TabsList>

                        <div className="p-5">
                          <TabsContent value="transcript" className="mt-0">
                             <CallPlayer call={call} />
                          </TabsContent>
                          
                          <TabsContent value="summary" className="mt-0">
                            {call.summary_data ? (
                              <div className="space-y-6">
                                <div>
                                   <h5 className="font-semibold text-sm mb-2">Call Summary</h5>
                                   <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                                     {call.summary_data.call_summary?.map((pt, i) => <li key={i}>{pt}</li>)}
                                   </ul>
                                </div>
                                <div>
                                   <h5 className="font-semibold text-sm mb-2">Key Points</h5>
                                   <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                                     {call.summary_data.key_points?.map((pt, i) => <li key={i}>{pt}</li>)}
                                   </ul>
                                </div>
                              </div>
                            ) : (
                               <div className="text-sm text-muted-foreground italic">No summary generated yet.</div>
                            )}
                          </TabsContent>

                          <TabsContent value="quality" className="mt-0">
                             {call.quality_data ? (
                               <div className="space-y-4">
                                  {Object.entries(call.quality_data).map(([paramName, data], idx) => (
                                     <div key={idx} className="p-4 border rounded-lg bg-muted/10">
                                        <div className="flex justify-between items-start mb-2">
                                           <div className="font-semibold text-sm">{paramName}</div>
                                           <div className="flex items-center gap-2">
                                              <span className={cn("text-xs font-bold", data.score === data.max_score ? "text-emerald-500" : data.score > 0 ? "text-amber-500" : "text-destructive")}>
                                                 {data.score} / {data.max_score}
                                              </span>
                                              <Badge variant="outline" className={data.status === 'Done' ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" : data.status === 'Not Applicable' ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive border-destructive/20"}>
                                                 {data.status}
                                              </Badge>
                                           </div>
                                        </div>
                                        <p className="text-sm text-muted-foreground">{data.reason}</p>
                                     </div>
                                  ))}
                               </div>
                             ) : (
                                <div className="text-sm text-muted-foreground italic">No quality scores generated yet.</div>
                             )}
                          </TabsContent>
                        </div>
                      </Tabs>
                    </CardContent>
                  </Card>
                );
              })}
              {(!lead.calls || lead.calls.length === 0) && (
                 <div className="text-center p-12 bg-muted/10 border border-dashed rounded-lg text-muted-foreground">
                    No calls recorded for this lead yet.
                 </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
