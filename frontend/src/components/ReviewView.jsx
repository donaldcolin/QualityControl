import { useState, useEffect, useRef } from 'react';
import { getCall, getCalls, rateCall } from '../api';
import { ArrowLeft, Save, FileAudio, Keyboard, MessageSquare, Star, ChevronLeft, ChevronRight, CheckCircle2, Download, Languages, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ReviewView({ callId, onBack }) {
  const [call, setCall] = useState(null);
  const [callsList, setCallsList] = useState([]);
  const [rating, setRating] = useState('');
  const [notes, setNotes] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [saving, setSaving] = useState(false);
  const [showEnglish, setShowEnglish] = useState(false);
  
  const audioRef = useRef(null);
  const segmentsContainerRef = useRef(null);
  const activeSegmentRef = useRef(null);

  useEffect(() => {
    getCall(callId).then(data => {
      setCall(data);
      setRating(data.rating || '');
      setNotes(data.notes || '');
    });
  }, [callId]);

  useEffect(() => {
    getCalls().then(setCallsList);
  }, []);

  useEffect(() => {
    const handleKeyDown = async (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'INPUT')) {
        return;
      }

      if (e.key === ' ') {
        e.preventDefault();
        if (audioRef.current) {
          if (audioRef.current.paused) audioRef.current.play();
          else audioRef.current.pause();
        }
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        await handleSave(); 
        if (callsList.length > 0 && call) {
          const idx = callsList.findIndex(c => c.id === call.id);
          if (e.key === 'ArrowRight' && idx < callsList.length - 1) {
            getCall(callsList[idx + 1].id).then(updateCallData);
          } else if (e.key === 'ArrowLeft' && idx > 0) {
            getCall(callsList[idx - 1].id).then(updateCallData);
          }
        }
      } else if (['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault();
        const ratingsMap = { '1': 'Correct', '2': 'Minor errors', '3': 'Major errors', '4': 'Unusable' };
        setRating(ratingsMap[e.key]);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [call, callsList, rating, notes]); 

  const updateCallData = (data) => {
    setCall(data);
    setRating(data.rating || '');
    setNotes(data.notes || '');
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = `http://localhost:3000/api/calls/${data.id}/audio`;
      audioRef.current.load();
    }
  };

  useEffect(() => {
    if (activeSegmentRef.current && segmentsContainerRef.current) {
      const container = segmentsContainerRef.current;
      const el = activeSegmentRef.current;
      const containerRect = container.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();

      if (elRect.top < containerRect.top || elRect.bottom > containerRect.bottom) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime]);

  const handleSave = async () => {
    if (!call) return;
    setSaving(true);
    await rateCall(call.id, rating, notes);
    setTimeout(() => setSaving(false), 500);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
  };

  const handleSegmentClick = (start) => {
    if (audioRef.current) {
      audioRef.current.currentTime = start;
      audioRef.current.play();
    }
  };

  const handleDownloadTranscript = () => {
    if (!call || !call.segments) return;
    let text = `Transcript for ${call.filename}\nLanguage: ${call.language}\nDuration: ${call.duration_sec?.toFixed(1)}s\n\n`;
    call.segments.forEach(seg => {
      text += `[${seg.start.toFixed(1)}s - ${seg.end.toFixed(1)}s] ${seg.speaker}:\n`;
      text += `${seg.text}\n`;
      if (seg.text_en) {
        text += `(EN: ${seg.text_en})\n`;
      }
      text += `\n`;
    });
    
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${call.filename}_transcript.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleBack = async () => {
    await handleSave();
    onBack();
  };

  if (!call) return (
    <div className="flex justify-center items-center h-64 text-muted-foreground">
      Loading evaluation details...
    </div>
  );

  return (
    <div className="flex flex-col h-full gap-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" onClick={handleBack} title="Go Back">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileAudio className="w-5 h-5 text-primary" />
              {call.filename}
            </h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
              <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">{call.language}</Badge>
              <span>•</span>
              <span>{call.duration_sec?.toFixed(1)}s</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => {
              if (callsList.length > 0 && call) {
                const idx = callsList.findIndex(c => c.id === call.id);
                if (idx > 0) getCall(callsList[idx - 1].id).then(updateCallData);
              }
            }} 
            title="Previous Call"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button 
            variant="outline" 
            size="icon"
            onClick={() => {
              if (callsList.length > 0 && call) {
                const idx = callsList.findIndex(c => c.id === call.id);
                if (idx < callsList.length - 1) getCall(callsList[idx + 1].id).then(updateCallData);
              }
            }} 
            title="Next Call"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2 ml-2 min-w-[100px]">
            {saving ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saved' : 'Save'}
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        
        {/* Left Column: Audio and Transcript */}
        <div className="lg:col-span-2 flex flex-col gap-6 min-h-0">
          <Card className="shadow-sm">
            <CardContent className="p-4">
              <audio 
                ref={audioRef}
                controls 
                className="w-full h-12 outline-none"
                src={`http://localhost:3000/api/calls/${call.id}/audio`} 
                onTimeUpdate={handleTimeUpdate}
              />
            </CardContent>
          </Card>
          
          <Card className="flex flex-col flex-1 min-h-[400px] shadow-sm">
            <div className="bg-muted/50 border-b p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <h3 className="font-semibold flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Transcript Segments
              </h3>
              <div className="flex items-center gap-2">
                {call.segments?.some(seg => seg.text_en) && (
                  <Button 
                    variant={showEnglish ? "default" : "outline"}
                    size="sm"
                    onClick={() => setShowEnglish(!showEnglish)}
                    className="h-8 gap-1.5"
                    title={showEnglish ? "Show Native Text" : "Show English Translation"}
                  >
                    <Languages className="w-3.5 h-3.5" />
                    {showEnglish ? 'EN' : 'Native'}
                  </Button>
                )}
                <Button 
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTranscript}
                  className="h-8 gap-1.5"
                  title="Download Transcript"
                >
                  <Download className="w-3.5 h-3.5" />
                  Export
                </Button>
                <Badge variant="secondary">{call.segments?.length || 0} segments</Badge>
              </div>
            </div>
            
            <ScrollArea 
              ref={segmentsContainerRef}
              className="flex-1 p-4"
            >
              <div className="space-y-3 pb-4">
                {call.segments?.map((seg, i) => {
                  const isActive = currentTime >= seg.start && currentTime <= seg.end;
                  return (
                    <div 
                      key={i} 
                      ref={isActive ? activeSegmentRef : null}
                      onClick={() => handleSegmentClick(seg.start)}
                      className={cn(
                        "p-4 rounded-lg border cursor-pointer transition-all duration-200",
                        isActive 
                          ? "bg-primary/5 border-primary/30 shadow-sm" 
                          : "bg-background border-border hover:border-primary/50 hover:shadow-sm"
                      )}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <strong className={cn(
                          "text-xs font-bold uppercase tracking-wider",
                          isActive ? "text-primary" : "text-muted-foreground"
                        )}>
                          {seg.speaker}
                        </strong>
                        <span className="text-[11px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {seg.start.toFixed(1)}s - {seg.end.toFixed(1)}s
                        </span>
                      </div>
                      <p className={cn(
                        "text-sm leading-relaxed",
                        isActive ? "text-foreground" : "text-muted-foreground"
                      )}>
                        {showEnglish && seg.text_en ? seg.text_en : seg.text}
                        {showEnglish && !seg.text_en && (
                          <span className="text-muted-foreground/50 italic text-xs ml-2">(no translation)</span>
                        )}
                      </p>
                    </div>
                  );
                })}
                {(!call.segments || call.segments.length === 0) && (
                  <div className="text-center py-12 text-muted-foreground">
                    No transcript segments found for this call.
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>
        </div>

        {/* Right Column: Rating and Notes */}
        <div className="flex flex-col gap-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Star className="w-5 h-5 text-primary" />
                Evaluation
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-medium leading-none">Overall Rating</label>
                <Select value={rating} onValueChange={setRating}>
                  <SelectTrigger>
                    <SelectValue placeholder="-- Select Rating --" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Correct">Correct</SelectItem>
                    <SelectItem value="Minor errors">Minor errors</SelectItem>
                    <SelectItem value="Major errors">Major errors</SelectItem>
                    <SelectItem value="Unusable">Unusable</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium leading-none flex items-center gap-2">
                  <FileText className="w-4 h-4" /> Notes
                </label>
                <Textarea 
                  placeholder="Add review notes here..." 
                  value={notes} 
                  onChange={e => setNotes(e.target.value)} 
                  className="min-h-[150px] resize-y"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-muted/30 border-dashed shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Keyboard className="w-4 h-4" />
                Keyboard Shortcuts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-xs space-y-3 text-muted-foreground">
                <li className="flex items-center justify-between">
                  <span>Play / Pause</span>
                  <kbd className="px-2 py-1 bg-background rounded-md border font-mono shadow-sm">Space</kbd>
                </li>
                <li className="flex items-center justify-between">
                  <span>Prev / Next Call</span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-2 py-1 bg-background rounded-md border font-mono shadow-sm">←</kbd>
                    <kbd className="px-2 py-1 bg-background rounded-md border font-mono shadow-sm">→</kbd>
                  </span>
                </li>
                <li className="flex items-center justify-between">
                  <span>Set Rating</span>
                  <span className="flex items-center gap-1">
                    <kbd className="px-2 py-1 bg-background rounded-md border font-mono shadow-sm">1</kbd>
                    <span>-</span>
                    <kbd className="px-2 py-1 bg-background rounded-md border font-mono shadow-sm">4</kbd>
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
