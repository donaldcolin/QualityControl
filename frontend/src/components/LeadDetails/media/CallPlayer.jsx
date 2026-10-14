import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '../utils';

export default function CallPlayer({ call, embedded = false }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [highlightedSegmentIdx, setHighlightedSegmentIdx] = useState(null);
  const audioRef = useRef(null);
  const segmentRefs = useRef({});
  const pendingSeekTimeRef = useRef(null);
  const lastActiveTurnIdxRef = useRef(-1);

  const segments = useMemo(() => {
    if (!call?.segments) return [];
    if (typeof call.segments === 'string') {
      try {
        return JSON.parse(call.segments);
      } catch (e) {
        console.warn('Failed to parse call segments:', e);
        return [];
      }
    }
    return Array.isArray(call.segments) ? call.segments : [];
  }, [call?.segments]);

  const uniqueSpeakers = useMemo(() => {
    return [...new Set(segments.map(s => s.speaker))].filter(Boolean).sort();
  }, [segments]);

  const p1Id = uniqueSpeakers[0] || 'SPEAKER_00';
  const audioUrl = call?.id ? `/api/calls/${call.id}/audio` : '';

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play().then(() => setIsPlaying(true)).catch((err) => {
          console.warn('Playback blocked or failed:', err);
          setIsPlaying(false);
        });
      }
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  // Scroll to a specific dialogue turn by second timestamp
  const scrollToTurn = useCallback((targetSec, flashHighlight = true) => {
    if (!segments || segments.length === 0) return;

    let closestIdx = -1;
    let minDiff = Infinity;

    segments.forEach((seg, idx) => {
      const segStart = Number(seg.start) || 0;
      const segEnd = Number(seg.end) || segStart;
      if (segStart <= targetSec && targetSec <= segEnd) {
        closestIdx = idx;
        minDiff = 0;
      } else {
        const diff = Math.abs(segStart - targetSec);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = idx;
        }
      }
    });

    if (closestIdx !== -1 && segmentRefs.current[closestIdx]) {
      try {
        segmentRefs.current[closestIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (e) {
        console.warn('scrollIntoView failed:', e);
      }

      if (flashHighlight) {
        setHighlightedSegmentIdx(closestIdx);
        setTimeout(() => {
          setHighlightedSegmentIdx((prev) => (prev === closestIdx ? null : prev));
        }, 3500);
      }
    }
  }, [segments]);

  const handleSegmentClick = (start) => {
    const targetTime = Number(start) || 0;
    setCurrentTime(targetTime);
    if (audioRef.current) {
      try {
        audioRef.current.currentTime = targetTime;
      } catch (err) {
        pendingSeekTimeRef.current = targetTime;
      }
      if (!isPlaying) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(console.error);
      }
    }
    scrollToTurn(targetTime, true);
  };

  // Listen for global jump-to-time events (from QualityCheckTab, SlideTimelineTab, etc.)
  useEffect(() => {
    const handleJump = (e) => {
      if (e.detail?.start === undefined) return;
      // Allow jump if callId is not specified OR matches call.id loosely
      if (e.detail.callId && String(e.detail.callId) !== String(call?.id)) {
        return;
      }

      const targetTime = Math.max(0, Number(e.detail.start) || 0);
      setCurrentTime(targetTime);

      if (audioRef.current) {
        try {
          audioRef.current.currentTime = targetTime;
        } catch (err) {
          console.warn('Could not immediately seek audio:', err);
          pendingSeekTimeRef.current = targetTime;
        }

        const playPromise = audioRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => setIsPlaying(true))
            .catch((err) => {
              console.warn('Autoplay prevented or media not ready:', err);
            });
        }
      } else {
        pendingSeekTimeRef.current = targetTime;
      }

      scrollToTurn(targetTime, true);
    };

    window.addEventListener('jump-to-time', handleJump);
    return () => window.removeEventListener('jump-to-time', handleJump);
  }, [call?.id, scrollToTurn]);

  // Handle when audio element metadata loads
  const handleLoadedMetadata = () => {
    if (pendingSeekTimeRef.current !== null && audioRef.current) {
      try {
        audioRef.current.currentTime = pendingSeekTimeRef.current;
      } catch (e) {}
      pendingSeekTimeRef.current = null;
    }
  };

  // Natural scroll while playing: smoothly align to new speaker turn when active turn transitions
  useEffect(() => {
    if (!isPlaying || segments.length === 0) return;
    const activeIdx = segments.findIndex(s => currentTime >= s.start && currentTime < s.end);
    if (activeIdx !== -1 && activeIdx !== lastActiveTurnIdxRef.current) {
      lastActiveTurnIdxRef.current = activeIdx;
      if (segmentRefs.current[activeIdx]) {
        segmentRefs.current[activeIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [currentTime, isPlaying, segments]);

  return (
    <div className={cn("flex flex-col overflow-hidden bg-white rounded-lg shadow-sm", embedded ? "shrink-0 w-full border" : "h-full border")}>
      {/* Audio Player Bar */}
      <div className={cn("w-full", embedded ? "p-4 bg-white" : "p-5 bg-slate-50 border-b")}>
        <div className="flex items-center gap-4">
          <button 
            type="button"
            onClick={togglePlay} 
            className="flex items-center justify-center h-12 w-12 rounded-full bg-slate-800 hover:bg-slate-700 text-white shadow-sm transition-colors shrink-0 cursor-pointer"
            title={isPlaying ? "Pause audio" : "Play audio"}
          >
            {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-1" />}
          </button>
          <div className="text-sm font-medium tabular-nums text-slate-900">{formatDuration(currentTime)}</div>

          <div 
            className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden relative cursor-pointer" 
            onClick={(e) => {
              if (call?.duration_sec) {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const newTime = percent * call.duration_sec;
                setCurrentTime(newTime);
                if (audioRef.current) {
                  try {
                    audioRef.current.currentTime = newTime;
                  } catch (err) {}
                }
                scrollToTurn(newTime, true);
              }
            }}
          >
            <div
              className="absolute top-0 left-0 h-full bg-slate-600 transition-all duration-100"
              style={{ width: `${call?.duration_sec ? (currentTime / call.duration_sec) * 100 : 0}%` }}
            />
          </div>
          <div className="text-sm font-medium tabular-nums text-slate-900">{formatDuration(call?.duration_sec)}</div>
          <audio 
            ref={audioRef} 
            src={audioUrl} 
            onTimeUpdate={handleTimeUpdate} 
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)} 
            onLoadedMetadata={handleLoadedMetadata}
            className="hidden" 
          />
        </div>
      </div>

      {/* Transcript */}
      {!embedded && (
        <div className="flex-1 overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-slate-100 bg-white/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Call Transcript</h3>
          </div>
          <ScrollArea className="h-[calc(100%-45px)]">
            <div className="p-5 flex flex-col space-y-4">
              {segments.map((seg, idx) => {
                const isPlayingActive = currentTime >= seg.start && currentTime < seg.end;
                const isJumpHighlighted = highlightedSegmentIdx === idx;
                const isActive = isPlayingActive || isJumpHighlighted;
                const isP1 = seg.speaker === p1Id;
                const participantName = seg.speaker || (isP1 ? 'Participant 1' : 'Participant 2');

                return (
                  <div
                    key={idx}
                    ref={(el) => { segmentRefs.current[idx] = el; }}
                    onClick={() => handleSegmentClick(seg.start)}
                    className={cn(
                      "flex w-full cursor-pointer group transition-all",
                      isP1 ? "justify-start" : "justify-end"
                    )}
                  >
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-3 transition-all",
                      isP1 ? "bg-slate-100 rounded-tl-sm text-slate-900" : "bg-blue-50 text-slate-900 rounded-tr-sm",
                      isJumpHighlighted 
                        ? "ring-2 ring-blue-600 ring-offset-2 shadow-lg bg-blue-100/70" 
                        : isActive 
                        ? "ring-2 ring-blue-500 shadow-md" 
                        : (isP1 ? "hover:bg-slate-200" : "hover:bg-blue-100")
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
