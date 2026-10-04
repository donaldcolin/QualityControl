import { useState, useEffect, useRef } from 'react';
import { getQCLead, getCoachingTemplates, evaluateCall } from '../api';
import { ArrowLeft, Play, Pause, FileAudio, CheckCircle2, XCircle, BrainCircuit, Phone, Video, ChevronDown, ChevronUp, Lightbulb, TrendingUp, TrendingDown, Minus, MessageSquare, Loader2, RefreshCw, Star, PlayCircle, PauseCircle, Target, DollarSign, UserCheck, CalendarClock, Database, AlertTriangle, Share2, Trash2, Edit2, PlaySquare, SkipForward, FastForward, Info, Clock, Sparkles, User, Smile, MessageSquareShare, ShieldAlert, Crosshair } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const audioUrl = `/api/calls/${call.id}/audio`;

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden">
      {/* Audio Player */}
      <div className="p-5 bg-slate-50 border-b">
        <div className="flex items-center gap-4">
          <button onClick={togglePlay} className="flex items-center justify-center h-12 w-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white shadow-sm transition-colors shrink-0">
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-1" />}
          </button>
          <div className="text-sm font-medium tabular-nums text-slate-900">{formatDuration(currentTime)}</div>

          <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative cursor-pointer" onClick={(e) => {
            if (audioRef.current && call.duration_sec) {
              const rect = e.currentTarget.getBoundingClientRect();
              const percent = (e.clientX - rect.left) / rect.width;
              audioRef.current.currentTime = percent * call.duration_sec;
            }
          }}>
            <div
              className="absolute top-0 left-0 h-full bg-slate-400"
              style={{ width: `${call.duration_sec ? (currentTime / call.duration_sec) * 100 : 0}%` }}
            />
          </div>
          <div className="text-sm font-medium tabular-nums text-slate-900">{formatDuration(call.duration_sec)}</div>
          <audio ref={audioRef} src={audioUrl} onTimeUpdate={handleTimeUpdate} onEnded={() => setIsPlaying(false)} className="hidden" />
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-hidden bg-white">
        <div className="px-4 py-3 border-b border-slate-100 bg-white/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Call Transcript</h3>
        </div>
        <ScrollArea className="h-[calc(100%-45px)]" ref={segmentsContainerRef}>
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
                    isActive ? "bg-slate-100 border-slate-300 shadow-sm" : "bg-slate-50 hover:bg-slate-100 border-slate-200"
                  )}
                >
                  <div className="text-sm">
                    <span className="text-slate-500 font-mono mr-3 text-xs">{formatDuration(seg.start)}-{formatDuration(seg.end)}</span>
                    <span className="font-bold text-slate-900 mr-2">{participantName} :</span>
                    <span className="text-slate-900 leading-relaxed">
                      {seg.text}
                      {seg.text_en && seg.text_en !== seg.text && (
                        <div className="mt-1 text-slate-500 italic">Translated: "{seg.text_en}"</div>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
            {segments.length === 0 && (
              <div className="text-center text-muted-foreground p-8">No transcript available.</div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default function LeadDetails({ leadId, onBack, embedded = false }) {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedCallIdx, setSelectedCallIdx] = useState('all');

  const fetchLead = () => {
    getQCLead(leadId).then((leadData) => {
      if (!leadData.error) setLead(leadData);
      setLoading(false);
      setIsEvaluating(false);
    });
  };

  useEffect(() => {
    fetchLead();
  }, [leadId]);

  const handleReEvaluate = async () => {
    // Include 'processing' so they don't disappear if a previous run was interrupted
    const evCalls = (lead?.calls || []).filter(c => c.qc_status === 'evaluated' || c.qc_status === 'completed' || c.qc_status === 'processing' || c.coaching_report);
    if (evCalls.length === 0) return;

    setIsEvaluating(true);
    try {
      // Trigger background evaluation for ALL calls in parallel
      await Promise.all(evCalls.map(c => evaluateCall(c.id)));

      // Poll until ALL calls' qc_status is no longer 'processing'
      // Wait a moment first since evaluateCall is async
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        const leadData = await getQCLead(leadId);

        const anyProcessing = (leadData?.calls || []).some(c =>
          evCalls.find(ec => ec.id === c.id) && c.qc_status === 'processing'
        );

        if (!anyProcessing && attempts > 1) { // ensure at least one check passed after status was set to processing
          clearInterval(pollInterval);
          setLead(leadData);
          setIsEvaluating(false);
        } else if (attempts >= 40) {
          // Timeout after ~80 seconds
          clearInterval(pollInterval);
          fetchLead();
          setIsEvaluating(false);
        }
      }, 2000);

    } catch (e) {
      console.error(e);
      setIsEvaluating(false);
    }
  };

  if (loading || !lead) {
    return <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /><p>Loading Lead History...</p></div>;
  }

  const evaluatedCalls = (lead.calls || []).filter(c => c.qc_status === 'evaluated' || c.qc_status === 'completed' || c.qc_status === 'processing' || c.qc_status === 'pending' || c.coaching_report);

  if (evaluatedCalls.length === 0) {
    return (
      <div className="flex flex-col h-full bg-slate-50 min-h-screen text-slate-900 items-center justify-center p-8">
        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
          <Phone className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">No Analyzed Calls Found</h2>
        <p className="text-slate-500 mb-6 text-center max-w-md">This lead has no calls that have been evaluated by the AI yet. Once a call is uploaded and evaluated, its insights will appear here.</p>
        {!embedded && <Button onClick={onBack} variant="outline"><ArrowLeft className="w-4 h-4 mr-2" /> Go Back</Button>}
      </div>
    );
  }

  const activeCall = (selectedCallIdx === 'all' && evaluatedCalls.length > 1) ? null : (selectedCallIdx === 'all' ? evaluatedCalls[0] : evaluatedCalls[selectedCallIdx]);
  const callsToDisplay = selectedCallIdx === 'all' ? evaluatedCalls : (activeCall ? [activeCall] : []);

  const totalDuration = callsToDisplay.reduce((acc, c) => acc + (c.duration_sec || 0), 0) || 0;

  const intentScore = selectedCallIdx === 'all'
    ? (lead.intent_score || 0)
    : (activeCall?.insights_data?.overall_score?.score || activeCall?.insights_data?.intent_score || 0);

  const avgQuality = selectedCallIdx === 'all'
    ? (lead.avg_call_quality_score || 0)
    : (activeCall?.coaching_report?.quality?.overall_score || 0);

  const ttlCalls = callsToDisplay.filter(c => c.talk_to_listen_ratio);
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

  const sqlStatus = (() => {
    const allFields = callsToDisplay.flatMap(c => c.insights_data?.data_capture?.extracted_fields || []);

    const gradeFields = allFields.filter(f => f.field.toLowerCase().includes('grade') || f.field.toLowerCase().includes('class'));
    const streamFields = allFields.filter(f => f.field.toLowerCase().includes('stream') || f.field.toLowerCase().includes('group') || f.field.toLowerCase().includes('subject'));

    const notMentionedKeywords = ['not mentioned', 'n/a', 'none', 'null', 'unknown', ''];

    const validGrade = gradeFields.find(f => !notMentionedKeywords.includes(String(f.value).toLowerCase().trim()));
    const validStream = streamFields.find(f => !notMentionedKeywords.includes(String(f.value).toLowerCase().trim()));

    if (!validGrade || !validStream) return 'Not Mentioned';

    const gradeVal = String(validGrade.value).toLowerCase();
    const streamVal = String(validStream.value).toLowerCase();

    const is12 = gradeVal.includes('12') || gradeVal.includes('twelfth');
    const isPCM = streamVal.includes('pcm') || streamVal.includes('science');

    return (is12 && isPCM) ? 'SQL' : 'No SQL';
  })();

  return (
    <div className="flex flex-col h-full bg-white min-h-screen text-slate-900">
      {/* HEADER SECTION - ZIPTEAMS CLONE */}
      {!embedded ? (
        <div className="border-b px-8 py-4 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-400 text-white rounded-full flex items-center justify-center text-xl font-bold shadow-sm">
              {lead.name?.charAt(0).toUpperCase() || '?'}
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight mb-1 flex items-center gap-2">
                {lead.name}
                {sqlStatus === 'SQL' && (
                  <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 ml-2 border-emerald-200">
                    <Star className="w-3 h-3 mr-1 fill-emerald-500" /> Sales Qualified Lead
                  </Badge>
                )}
                {sqlStatus === 'No SQL' && (
                  <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-200 ml-2 border-rose-200">
                    No SQL
                  </Badge>
                )}
                {sqlStatus === 'Not Mentioned' && (
                  <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-200 ml-2 border-slate-200">
                    Not Mentioned
                  </Badge>
                )}
              </h1>
              <div className="flex gap-4 text-xs text-muted-foreground items-center">
                <span className="flex items-center gap-1.5"><Database className="w-3.5 h-3.5" /> {lead.phone || lead.email || '—'}</span>
                <span className="flex items-center gap-1.5"><UserCheck className="w-3.5 h-3.5" /> Owner Name: <span className="font-semibold text-foreground">{lead.owner || 'Unassigned'}</span></span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
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
      ) : (
        <div className="bg-slate-50/80 border-b px-8 py-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">

            {/* Lead Status Card */}
            <Card className={`shadow-md ${sqlStatus === 'SQL' ? 'border-emerald-200 bg-emerald-50/30' : sqlStatus === 'No SQL' ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'}`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-3.5">
                <CardTitle className={`text-[10px] font-bold uppercase tracking-wider ${sqlStatus === 'SQL' ? 'text-emerald-700' : sqlStatus === 'No SQL' ? 'text-rose-700' : 'text-slate-500'}`}>
                  Lead Status
                </CardTitle>
                {sqlStatus === 'SQL' ? <Star className="w-3.5 h-3.5 text-emerald-500 fill-emerald-500" /> : sqlStatus === 'No SQL' ? <XCircle className="w-3.5 h-3.5 text-rose-500" /> : <Info className="w-3.5 h-3.5 text-slate-400" />}
              </CardHeader>
              <CardContent className="px-3.5 pb-3">
                <div className={`text-[15px] font-bold leading-tight ${sqlStatus === 'SQL' ? 'text-emerald-800' : sqlStatus === 'No SQL' ? 'text-rose-800' : 'text-slate-900'}`}>
                  {sqlStatus === 'SQL' ? 'Sales Qualified Lead' : sqlStatus === 'No SQL' ? 'No SQL' : 'Not Mentioned'}
                </div>
              </CardContent>
            </Card>

            {/* Total Duration Card */}
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-3.5">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Duration</CardTitle>
                <Clock className="w-3.5 h-3.5 text-blue-500" />
              </CardHeader>
              <CardContent className="px-3.5 pb-3">
                <div className="text-xl font-bold text-slate-800">{Math.ceil(totalDuration / 60)} mins</div>
              </CardContent>
            </Card>

            {/* Talk-to-Listen Ratio Card */}
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-3.5">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rep : Cust Ratio</CardTitle>
                <MessageSquare className="w-3.5 h-3.5 text-indigo-500" />
              </CardHeader>
              <CardContent className="px-3.5 pb-3">
                <div className="text-xl font-bold text-slate-800">{avgTtl}</div>
              </CardContent>
            </Card>

            {/* Intent Score Card */}
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-3.5">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Intent Score</CardTitle>
                <Target className="w-3.5 h-3.5 text-amber-500" />
              </CardHeader>
              <CardContent className="px-3.5 pb-3">
                <div className="text-xl font-bold text-slate-800">{intentScore}/100</div>
              </CardContent>
            </Card>

            {/* Avg. Call Quality Score Card */}
            <Card className="shadow-md">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1.5 pt-3 px-3.5">
                <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Avg Quality</CardTitle>
                <Star className="w-3.5 h-3.5 text-purple-500" />
              </CardHeader>
              <CardContent className="px-3.5 pb-3">
                <div className="text-xl font-bold text-slate-800">{avgQuality}%</div>
              </CardContent>
            </Card>

          </div>
        </div>
      )}

      {/* TABS & MAIN CONTENT WRAPPER */}
      <Tabs defaultValue="conversations" className="flex-1 flex flex-col min-h-0 w-full" id="top-tabs" onValueChange={() => { }}>
        <div className="px-8 py-4 border-b bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <TabsList className="bg-slate-200/70 p-1 h-11 rounded-lg self-start md:self-auto">
            <TabsTrigger value="insights" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-900 hover:text-slate-900">Insights</TabsTrigger>
            <TabsTrigger value="conversations" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-900 hover:text-slate-900">Conversations</TabsTrigger>
            <TabsTrigger value="coaching" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-900 hover:text-slate-900">Coaching</TabsTrigger>
          </TabsList>

          <div className="flex items-center gap-3 self-end md:self-auto">
            {!embedded && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReEvaluate}
                disabled={isEvaluating || evaluatedCalls.length === 0}
                className="h-11 bg-white border-slate-200 text-slate-900 hover:bg-slate-50 font-bold px-4 rounded-lg shadow-sm"
              >
                {isEvaluating ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {isEvaluating ? 'Evaluating...' : (evaluatedCalls.length > 1 ? 'Re-Evaluate All' : 'Re-Evaluate')}
              </Button>
            )}
            {evaluatedCalls.length > 1 && (
              <Select
                value={selectedCallIdx.toString()}
                onValueChange={(val) => setSelectedCallIdx(val === 'all' ? 'all' : parseInt(val))}
              >
                <SelectTrigger className="w-[200px] bg-white border-slate-200 text-slate-900 font-bold h-11 rounded-lg shadow-sm">
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <SelectValue placeholder="Select a call" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All Calls <span className="text-muted-foreground ml-2 text-xs">({evaluatedCalls.length})</span>
                  </SelectItem>
                  {evaluatedCalls.map((c, idx) => (
                    <SelectItem key={idx} value={idx.toString()}>
                      Call {idx + 1} <span className="text-muted-foreground ml-2 text-xs">({c.duration_sec ? formatDuration(c.duration_sec) : '00:00'})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* MAIN TWO-COLUMN CONTENT */}
        <div className="flex-1 p-6 overflow-hidden">
          <TabsContent value="insights" className="h-full mt-0">
            <ScrollArea className="h-full">
              <div className="max-w-5xl mx-auto space-y-8 pb-8 px-4">
                <section>
                  <div className="flex items-center gap-2 mb-4">
                    <BrainCircuit className="w-5 h-5 text-purple-500" />
                    <h3 className="text-lg font-semibold">Path to Conversion</h3>
                  </div>

                  <Card className="shadow-md bg-purple-500/5 border-purple-500/10 overflow-hidden">
                    <CardHeader className="pb-3 border-b border-purple-500/10">
                      <CardTitle className="text-sm">Conversation Summary</CardTitle>
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
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full max-w-full">

                {/* LEFT PANE: Audio & Transcript */}
                <CallPlayer call={activeCall} />

                {/* RIGHT PANE: Summary / Insights / Quality */}
                <div className="flex flex-col h-full bg-white rounded-lg border shadow-sm overflow-hidden">
                  <Tabs defaultValue="quality" className="w-full flex-1 flex flex-col min-h-0">
                    <TabsList className="w-full justify-between border-b rounded-none h-14 bg-slate-50 px-4">
                      <TabsTrigger value="summary" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-slate-300 data-[state=active]:shadow-none data-[state=active]:bg-slate-200/50 bg-transparent text-sm font-bold text-slate-900 data-[state=active]:text-slate-900">Summary</TabsTrigger>
                      <TabsTrigger value="insights" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-slate-300 data-[state=active]:shadow-none data-[state=active]:bg-slate-200/50 bg-transparent text-sm font-bold text-slate-900 data-[state=active]:text-slate-900">Insights</TabsTrigger>
                      <TabsTrigger value="quality" className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-blue-500 data-[state=active]:shadow-none data-[state=active]:bg-blue-50 bg-transparent text-sm font-bold text-slate-900 data-[state=active]:text-blue-700">Quality</TabsTrigger>
                    </TabsList>

                    <TabsContent value="quality" className="flex-1 overflow-hidden mt-0 p-0">
                      <ScrollArea className="h-full">
                        <div className="p-6 space-y-8">
                          <div className="flex justify-between items-center pb-4 border-b">
                            <div className="font-bold text-sm">
                              Overall Call Quality Score: <span className="text-emerald-600">{activeCall?.call_quality_score ?? 0}%</span> <span className="text-slate-500 font-normal">({Math.round(((activeCall?.call_quality_score ?? 0) / 100) * 124)}/124)</span>
                            </div>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-400 hover:text-slate-900 hover:bg-slate-100"><RefreshCw className="w-4 h-4" /></Button>
                            </div>
                          </div>

                          {activeCall?.quality_data ? (
                            Object.entries(activeCall.quality_data).map(([param, data], idx) => {
                              let badgeClass = "bg-slate-100 text-slate-900";
                              if (data.status === 'Done') badgeClass = "bg-emerald-50 text-emerald-700";
                              else if (data.status === 'Missed') badgeClass = "bg-rose-50 text-rose-700";
                              else if (data.status === 'Partially Done') badgeClass = "bg-amber-50 text-amber-700";

                              return (
                                <div key={idx} className="space-y-3 pb-6 border-b border-dashed last:border-0">
                                  <div className="flex justify-between items-center">
                                    <h4 className="font-bold text-sm text-slate-900">{param}</h4>
                                  </div>
                                  <div className="flex gap-2 items-center">
                                    <Badge className={cn("px-2 font-bold tabular-nums hover:opacity-90 shadow-none border-transparent", data.score === data.max_score ? "bg-emerald-100 text-emerald-700" : data.score > 0 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
                                      {data.score}/{data.max_score}
                                    </Badge>
                                    <span className={cn("text-xs font-bold", data.status === 'Done' ? "text-emerald-600" : data.status === 'Missed' ? "text-rose-600" : "text-amber-600")}>
                                      {data.status}
                                    </span>
                                    {data.breach_flag && (
                                      <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 h-5 font-bold animate-pulse">GUARDRAIL BREACH</Badge>
                                    )}
                                  </div>
                                  <p className="text-sm text-slate-900 leading-relaxed">
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
                            activeCall.coaching_report.category_scores.map((cat, idx) => (
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
            <ScrollArea className="h-full">
              <div className="max-w-5xl mx-auto space-y-8 pb-8 px-4 pt-4">
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
        </div>
      </Tabs>
    </div>
  );
}

