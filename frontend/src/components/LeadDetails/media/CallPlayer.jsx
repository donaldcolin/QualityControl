import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Video } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '../utils';

export default function CallPlayer({ call, embedded = false }) {
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
    const handleJump = (e) => {
      if (e.detail?.callId === call.id && e.detail?.start !== undefined) {
        if (audioRef.current) {
          audioRef.current.currentTime = e.detail.start;
          if (audioRef.current.paused) {
            audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
          }
        }
      }
    };
    window.addEventListener('jump-to-time', handleJump);
    return () => window.removeEventListener('jump-to-time', handleJump);
  }, [call.id]);

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
    <div className={cn("flex flex-col overflow-hidden bg-white rounded-lg shadow-sm", embedded ? "shrink-0 w-full border" : "h-full border")}>
      {/* Audio Player */}
      <div className={cn("w-full", embedded ? "p-4 bg-white" : "p-5 bg-slate-50 border-b")}>
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
      {!embedded && (
        <div className="flex-1 overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-slate-100 bg-white/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Call Transcript</h3>
          </div>
          <ScrollArea className="h-[calc(100%-45px)]" ref={segmentsContainerRef}>
            <div className="p-5 flex flex-col space-y-4">
              {segments.map((seg, idx) => {
                const isActive = currentTime >= seg.start && currentTime < seg.end;
                const isP1 = seg.speaker === p1Id;
                const participantName = seg.speaker || (isP1 ? 'Participant 1' : 'Participant 2');

                return (
                  <div
                    key={idx}
                    ref={isActive ? activeSegmentRef : null}
                    onClick={() => handleSegmentClick(seg.start)}
                    className={cn(
                      "flex w-full cursor-pointer group",
                      isP1 ? "justify-start" : "justify-end"
                    )}
                  >
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-3 transition-colors",
                      isP1 ? "bg-slate-100 rounded-tl-sm text-slate-900" : "bg-blue-50 text-slate-900 rounded-tr-sm",
                      isActive ? "ring-2 ring-blue-500 shadow-md" : (isP1 ? "hover:bg-slate-200" : "hover:bg-blue-100")
                    )}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn("font-bold text-[11px] uppercase tracking-wide", isP1 ? "text-slate-500" : "text-blue-600/70")}>{participantName}</span>
                        <span className="text-[10px] font-mono opacity-50">{formatDuration(seg.start)}-{formatDuration(seg.end)}</span>
                      </div>
                      <div className="text-sm leading-relaxed">
                        {seg.text}
                        {seg.text_en && seg.text_en !== seg.text && (
                          <div className={cn("mt-2 italic text-xs pt-2 border-t", isP1 ? "text-slate-500 border-slate-200" : "text-blue-700/60 border-blue-200/50")}>
                            "{seg.text_en}"
                          </div>
                        )}
                      </div>
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
      )}
    </div>
  );
}
