import { useState, useEffect, useRef } from 'react';
import LeadSidebar from './LeadSidebar';
import OverviewTab from './tabs/OverviewTab';
import QualityCheckTab from './tabs/QualityCheckTab';
import CoachingTab from './tabs/CoachingTab';
import { getQCLead, getCoachingTemplates, evaluateCall } from '../../api';
import { ArrowLeft, Play, Pause, Phone, Loader2, RefreshCw, } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))].sort();
  const p1Id = uniqueSpeakers[0] || 'SPEAKER_00';
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
  const [mediaType, setMediaType] = useState('audio'); // 'audio' or 'demo'

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

  useEffect(() => {
    if (embedded) {
      document.documentElement.style.fontSize = '12.5px';
    } else {
      document.documentElement.style.fontSize = '16px';
    }
    return () => {
      document.documentElement.style.fontSize = '16px';
    };
  }, [embedded]);

  const handleReEvaluate = async () => {
    // Include 'processing' so they don't disappear if a previous run was interrupted
    const evCalls = (lead?.calls || []).filter(c => c.qc_status === 'evaluated' || c.qc_status === 'completed' || c.qc_status === 'processing' || c.qc_status === 'failed' || c.qc_status === 'rejected' || c.qc_status === 'fatal_audit_failure' || c.coaching_report);
    if (evCalls.length === 0) return;

    setIsEvaluating(true);
    try {
      // Trigger background evaluation for ALL calls in parallel
      await Promise.all(evCalls.map(c => evaluateCall(c.id)));

      // Poll until ALL calls' qc_status is no longer 'processing'
      let attempts = 0;
      const pollInterval = setInterval(async () => {
        attempts++;
        try {
          const leadData = await getQCLead(leadId);

          const anyProcessing = (leadData?.calls || []).some(c =>
            evCalls.find(ec => ec.id === c.id) && c.qc_status === 'processing'
          );

          if (!anyProcessing && attempts > 1) { 
            clearInterval(pollInterval);
            setLead(leadData);
            setIsEvaluating(false);
          } else if (attempts >= 40) {
            clearInterval(pollInterval);
            fetchLead();
            setIsEvaluating(false);
          }
        } catch (pollErr) {
          console.error('Polling error:', pollErr);
          clearInterval(pollInterval);
          fetchLead();
          setIsEvaluating(false);
        }
      }, 2000);

    } catch (e) {
      console.error(e);
      fetchLead();
      setIsEvaluating(false);
    }
  };

  if (loading) {
    return <div className="flex flex-col items-center justify-center h-[60vh] gap-3 text-muted-foreground"><Loader2 className="w-8 h-8 animate-spin" /><p>Loading Lead History...</p></div>;
  }

  const allEvaluatedCalls = (lead?.calls || []).filter(c => c.qc_status === 'evaluated' || c.qc_status === 'completed' || c.qc_status === 'processing' || c.qc_status === 'pending' || c.qc_status === 'failed' || c.qc_status === 'rejected' || c.qc_status === 'fatal_audit_failure' || c.coaching_report);
  const evaluatedCalls = allEvaluatedCalls.filter(c => mediaType === 'audio' ? c.source !== 'google_meet' : c.source === 'google_meet');

  if (!lead || allEvaluatedCalls.length === 0) {
    return (
      <div className="flex flex-col h-full bg-slate-50 min-h-screen text-slate-900 items-center justify-center p-8">
        <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
          <Phone className="w-8 h-8 text-slate-400" />
        </div>
        <h2 className="text-xl font-bold mb-2">
          {embedded ? "QC Pending" : "No Analyzed Calls Found"}
        </h2>
        <p className="text-slate-500 mb-6 text-center max-w-md">
          {embedded 
            ? "QC is not done. Please wait for 4-5 hrs for the AI to process the calls." 
            : "This lead has no calls that have been evaluated by the AI yet. Once a call is uploaded and evaluated, its insights will appear here."}
        </p>
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

    if (validGrade && validStream) {
      const gradeVal = String(validGrade.value).toLowerCase();
      const streamVal = String(validStream.value).toLowerCase();
      const is12 = gradeVal.includes('12') || gradeVal.includes('twelfth');
      const isPCM = streamVal.includes('pcm') || streamVal.includes('science') || streamVal.includes('bio') || streamVal.includes('math') || streamVal.includes('computer science') || streamVal.includes('computer');
      return (is12 && isPCM) ? 'SQL' : 'No SQL';
    }

    // Fallback for V3 Video Calls
    for (const call of callsToDisplay) {
      const qData = call.quality_data || {};
      const classParam = qData['Class, Stream, Board and Location Captured'];
      if (classParam && classParam.reason) {
        const reason = classParam.reason.toLowerCase();
        const is12 = reason.includes('12') || reason.includes('twelfth');
        const isPCM = reason.includes('pcm') || reason.includes('science') || reason.includes('bio') || reason.includes('math') || reason.includes('computer');
        if (is12 || isPCM) {
          return (is12 && isPCM) ? 'SQL' : 'No SQL';
        }
      }
    }

    return 'Not Mentioned';
  })();

  const coaching = activeCall?.coaching_report || {};

  return (
    <div className={cn("flex flex-col bg-white text-slate-900", embedded ? "h-screen overflow-hidden" : "h-full min-h-screen")}>
      <LeadSidebar lead={lead} embedded={embedded} sqlStatus={sqlStatus} totalDuration={totalDuration} avgTtl={avgTtl} intentScore={intentScore} avgQuality={avgQuality} />
      <Tabs defaultValue="insights" className="flex-1 flex flex-col min-h-0 w-full" id="top-tabs" onValueChange={() => { }}>
        <div className="px-8 py-4 border-b-2 border-slate-200 bg-slate-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <TabsList className="bg-slate-200/70 p-1 h-11 rounded-lg self-start md:self-auto">
            <TabsTrigger value="insights" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900">Overview</TabsTrigger>
            <TabsTrigger value="conversations" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900">Quality Check</TabsTrigger>
            <TabsTrigger value="coaching" className="rounded-md px-6 py-2 text-sm font-bold transition-all data-[state=active]:bg-white data-[state=active]:text-blue-700 data-[state=active]:shadow-sm text-slate-600 hover:text-slate-900">Coaching</TabsTrigger>
          </TabsList>

                  <div className="flex items-center gap-3 self-end md:self-auto">
            <div className="flex items-center bg-slate-200/70 p-1 rounded-lg h-11 shrink-0 mr-2">
               <button 
                 onClick={() => { setMediaType('audio'); setSelectedCallIdx('all'); }} 
                 className={cn("px-4 py-1.5 h-full text-sm font-bold rounded-md transition-all", mediaType === 'audio' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}
               >
                 Audio Calls
               </button>
               <button 
                 onClick={() => { setMediaType('demo'); setSelectedCallIdx('all'); }} 
                 className={cn("px-4 py-1.5 h-full text-sm font-bold rounded-md transition-all", mediaType === 'demo' ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900")}
               >
                 Video Demos
               </button>
            </div>
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
          {evaluatedCalls.length === 0 ? (
            <div className="flex flex-col h-full text-slate-900 items-center justify-center p-8">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Phone className="w-8 h-8 text-slate-400" />
              </div>
              <h2 className="text-xl font-bold mb-2">No {mediaType === 'audio' ? 'Audio Calls' : 'Video Demos'} Found</h2>
              <p className="text-slate-500 mb-6 text-center max-w-md">This lead has no {mediaType === 'audio' ? 'telephony calls' : 'Google Meet sessions'} that have been evaluated by the AI yet.</p>
            </div>
          ) : (
            <>
        <OverviewTab lead={lead} callsToDisplay={callsToDisplay} evaluatedCalls={evaluatedCalls} activeCall={activeCall} embedded={embedded} intentScore={intentScore} />
        <QualityCheckTab lead={lead} activeCall={activeCall} evaluatedCalls={evaluatedCalls} mediaType={mediaType} embedded={embedded} handleReEvaluate={handleReEvaluate} isEvaluating={isEvaluating} selectedCallIdx={selectedCallIdx} />
        <CoachingTab lead={lead} coaching={coaching} embedded={embedded} selectedCallIdx={selectedCallIdx} activeCall={activeCall} evaluatedCalls={evaluatedCalls} callsToDisplay={callsToDisplay} />
            </>
          )}
        </div>
      </Tabs>
      {embedded && (
        <div className="text-center pb-4 text-xs">
          <a href="mailto:bug@kalvium.com" className="text-slate-400 hover:text-slate-600 underline">Report a Bug</a>
        </div>
      )}
    </div>
  );
}