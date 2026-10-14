import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Video, 
  Copy, 
  Check, 
  ArrowUpRight
} from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '../utils';
import { 
  KALVIUM_SLIDE_MAPPING, 
  formatHumanDuration 
} from './slideMapping';

export default function GoogleMeetViewer({ call, embedded = false }) {
  const segments = useMemo(() => {
    if (typeof call?.segments === 'string') {
      try {
        return JSON.parse(call.segments);
      } catch {
        return [];
      }
    }
    return call?.segments || [];
  }, [call?.segments]);

  const uniqueSpeakers = useMemo(() => {
    return [...new Set(segments.map(s => s.speaker))].filter(Boolean).sort();
  }, [segments]);

  const p1Id = uniqueSpeakers[0] || 'SPEAKER_00';

  // Toggle active view: 'dialogue' | 'slides'
  const [activeTab, setActiveTab] = useState('dialogue');
  const [activeSlideNumber, setActiveSlideNumber] = useState(null);
  const [filterMode, setFilterMode] = useState('presented'); // 'presented' | 'rushed' | 'all'
  const [highlightedSegmentIdx, setHighlightedSegmentIdx] = useState(null);
  const [speakerFilter, setSpeakerFilter] = useState('all'); // 'all' | 'advisor' | 'student'
  const [copiedTurnIdx, setCopiedTurnIdx] = useState(null);

  const segmentRefs = useRef({});
  const scrollAreaRef = useRef(null);

  // Extract visual timeline data
  const timeline = call?.visual_timeline;
  const facialAnalytics = timeline?.facial_analytics;
  const rawSlides = useMemo(() => Array.isArray(timeline?.slides) ? timeline.slides : [], [timeline?.slides]);
  const shownSlides = useMemo(() => rawSlides.filter(s => s.is_shown), [rawSlides]);
  const rushedSlides = useMemo(() => {
    return shownSlides.filter(s => s.rushed_warning || (s.total_duration_seconds > 0 && s.total_duration_seconds < 20));
  }, [shownSlides]);

  // Determine filtered slides
  const displaySlides = useMemo(() => {
    if (filterMode === 'rushed') return rushedSlides;
    if (filterMode === 'all') return rawSlides;
    return shownSlides.length > 0 ? shownSlides : rawSlides;
  }, [filterMode, shownSlides, rushedSlides, rawSlides]);

  // Jump to specific time in the transcript
  const scrollToTime = useCallback((targetSec) => {
    if (segments.length === 0) return;

    let closestIdx = -1;
    let minDiff = Infinity;

    segments.forEach((seg, idx) => {
      if (seg.start !== undefined) {
        if (seg.start <= targetSec && (seg.end === undefined || targetSec <= seg.end)) {
          closestIdx = idx;
          minDiff = 0;
        } else {
          const diff = Math.abs(seg.start - targetSec);
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = idx;
          }
        }
      }
    });

    if (closestIdx !== -1 && segmentRefs.current[closestIdx]) {
      segmentRefs.current[closestIdx].scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedSegmentIdx(closestIdx);
      setTimeout(() => {
        setHighlightedSegmentIdx(null);
      }, 3000);
    }
  }, [segments]);

  // Listen for jump-to-time events
  useEffect(() => {
    const handleJump = (e) => {
      if (e.detail?.start === undefined) return;
      if (e.detail.callId && String(e.detail.callId) !== String(call?.id)) return;

      setActiveTab('dialogue');
      setTimeout(() => {
        scrollToTime(Number(e.detail.start) || 0);
      }, 50);
    };
    window.addEventListener('jump-to-time', handleJump);
    return () => window.removeEventListener('jump-to-time', handleJump);
  }, [call?.id, scrollToTime]);

  const handleSlideClick = (slide) => {
    setActiveSlideNumber(slide.slide_number);
    const startSec = slide.intervals_raw?.[0]?.start_sec;
    if (startSec !== undefined) {
      scrollToTime(startSec);
      window.dispatchEvent(new CustomEvent('jump-to-time', {
        detail: { callId: call?.id, start: startSec }
      }));
      // Switch to dialogue so user can see dialogue for that slide
      setActiveTab('dialogue');
    }
  };

  // Filtered transcript turns by speaker
  const filteredSegments = useMemo(() => {
    return segments.map((seg, originalIdx) => ({ seg, originalIdx })).filter(({ seg }) => {
      const isAdvisor = seg.speaker === p1Id || seg.speaker === 'Advisor' || seg.speaker?.includes('Advisor');
      if (speakerFilter === 'advisor' && !isAdvisor) return false;
      if (speakerFilter === 'student' && isAdvisor) return false;
      return true;
    });
  }, [segments, p1Id, speakerFilter]);

  const handleCopyText = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedTurnIdx(idx);
    setTimeout(() => setCopiedTurnIdx(null), 1500);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white rounded-lg border shadow-sm min-h-0">
      
      {/* ── Top Header ── */}
      <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
            <Video className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900">Google Meet 1:1</span>
              <span className="text-xs font-mono font-medium text-slate-500 tabular-nums">
                {call?.duration_sec ? formatDuration(call.duration_sec) : '00:00'}
              </span>
            </div>
            <span className="text-[11px] text-slate-500">Video Demo Session</span>
          </div>
        </div>

        {/* Camera Status */}
        {facialAnalytics && (
          <div className="px-2.5 py-1 rounded-full text-xs font-semibold bg-white text-slate-700 border border-slate-200/80 shadow-2xs flex items-center gap-2">
            <span className={cn(
              "w-2 h-2 rounded-full",
              (facialAnalytics.associate_camera_active_pct || 0) >= 50 ? "bg-emerald-500" : "bg-amber-500"
            )} />
            <span>Camera {Math.round(facialAnalytics.associate_camera_active_pct)}%</span>
          </div>
        )}
      </div>

      {/* ── Heading Toggles on Top ── */}
      <div className="px-5 py-2.5 border-b border-slate-100 bg-white/50 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('dialogue')}
            className={cn(
              "px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer",
              activeTab === 'dialogue'
                ? "bg-slate-900 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            )}
          >
            Dialogue ({segments.length})
          </button>

          {rawSlides.length > 0 && (
            <button
              onClick={() => setActiveTab('slides')}
              className={cn(
                "px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer",
                activeTab === 'slides'
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              )}
            >
              Slides ({shownSlides.length})
            </button>
          )}
        </div>

        {/* View-specific sub-controls */}
        {activeTab === 'dialogue' && (
          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg text-xs">
            <button
              onClick={() => setSpeakerFilter('all')}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                speakerFilter === 'all' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              All
            </button>
            <button
              onClick={() => setSpeakerFilter('advisor')}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                speakerFilter === 'advisor' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Advisor
            </button>
            <button
              onClick={() => setSpeakerFilter('student')}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                speakerFilter === 'student' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
              )}
            >
              Student
            </button>
          </div>
        )}

        {activeTab === 'slides' && rawSlides.length > 0 && (
          <div className="inline-flex bg-slate-100 p-0.5 rounded-lg text-[11px]">
            <button
              onClick={() => setFilterMode('presented')}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                filterMode === 'presented' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
              )}
            >
              Shown ({shownSlides.length})
            </button>
            {rushedSlides.length > 0 && (
              <button
                onClick={() => setFilterMode('rushed')}
                className={cn(
                  "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                  filterMode === 'rushed' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Rushed ({rushedSlides.length})
              </button>
            )}
            <button
              onClick={() => setFilterMode('all')}
              className={cn(
                "px-2.5 py-1 rounded-md transition-colors cursor-pointer",
                filterMode === 'all' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
              )}
            >
              All ({rawSlides.length})
            </button>
          </div>
        )}
      </div>

      {/* ── Active View Body ── */}
      <div className="flex-1 min-h-0 overflow-hidden bg-white">
        
        {/* VIEW 1: DIALOGUE */}
        {activeTab === 'dialogue' && (
          <ScrollArea className="h-full" ref={scrollAreaRef}>
            <div className="p-5 flex flex-col space-y-4">
              {filteredSegments.length === 0 ? (
                <div className="text-center text-muted-foreground p-8">No dialogue matches.</div>
              ) : (
                filteredSegments.map(({ seg, originalIdx }) => {
                  const isP1 = seg.speaker === p1Id || seg.speaker === 'Advisor' || seg.speaker?.includes('Advisor');
                  const participantName = seg.speaker || (isP1 ? 'Advisor' : 'Student');
                  const isHighlighted = highlightedSegmentIdx === originalIdx;

                  return (
                    <div
                      key={originalIdx}
                      ref={(el) => (segmentRefs.current[originalIdx] = el)}
                      onClick={() => {
                        scrollToTime(seg.start);
                        if (seg.start !== undefined) {
                          window.dispatchEvent(new CustomEvent('jump-to-time', {
                            detail: { callId: call?.id, start: seg.start }
                          }));
                        }
                      }}
                      className={cn(
                        "flex w-full cursor-pointer group",
                        isP1 ? "justify-start" : "justify-end"
                      )}
                    >
                      <div className={cn(
                        "max-w-[85%] rounded-2xl px-5 py-3 transition-colors",
                        isP1 ? "bg-slate-100 rounded-tl-sm text-slate-900" : "bg-blue-50 text-slate-900 rounded-tr-sm",
                        isHighlighted 
                          ? "ring-2 ring-blue-500 shadow-md" 
                          : (isP1 ? "hover:bg-slate-200" : "hover:bg-blue-100")
                      )}>
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "font-bold text-[11px] uppercase tracking-wide",
                              isP1 ? "text-slate-500" : "text-blue-600/70"
                            )}>
                              {participantName}
                            </span>
                            {seg.start !== undefined && (
                              <span className="text-[10px] font-mono opacity-50 tabular-nums">
                                {formatDuration(seg.start)}{seg.end !== undefined ? ` - ${formatDuration(seg.end)}` : ''}
                              </span>
                            )}
                          </div>
                          
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyText(seg.text, originalIdx);
                            }}
                            className="text-slate-400 hover:text-slate-700 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded cursor-pointer"
                            title="Copy text"
                          >
                            {copiedTurnIdx === originalIdx ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>

                        <div className="text-sm leading-relaxed">
                          {seg.text}
                          {seg.text_en && seg.text_en !== seg.text && (
                            <div className={cn(
                              "mt-2 italic text-xs pt-2 border-t",
                              isP1 ? "text-slate-500 border-slate-200" : "text-blue-700/60 border-blue-200/50"
                            )}>
                              "{seg.text_en}"
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        )}

        {/* VIEW 2: SLIDES */}
        {activeTab === 'slides' && (
          <ScrollArea className="h-full">
            <div className="p-5 flex flex-col space-y-3">
              {displaySlides.map((slide) => {
                const isRushed = slide.rushed_warning || (slide.total_duration_seconds > 0 && slide.total_duration_seconds < 20);
                const isSelected = activeSlideNumber === slide.slide_number;
                const title = KALVIUM_SLIDE_MAPPING[slide.slide_number] || slide.title || `Slide ${slide.slide_number}`;

                return (
                  <div
                    key={slide.slide_number}
                    onClick={() => handleSlideClick(slide)}
                    className={cn(
                      "w-full text-left p-3.5 rounded-xl transition-all cursor-pointer border flex items-center justify-between gap-3 text-sm",
                      !slide.is_shown 
                        ? "bg-slate-50/40 border-dashed border-slate-200 opacity-60 hover:opacity-100" 
                        : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 hover:shadow-xs",
                      isSelected && "bg-blue-50/60 border-blue-300 ring-2 ring-blue-500 shadow-sm"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <span className="font-mono text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md shrink-0">
                        #{slide.slide_number}
                      </span>
                      <span className={cn(
                        "truncate font-medium",
                        !slide.is_shown ? "text-slate-400" : "text-slate-900"
                      )}>
                        {title}
                      </span>
                      {isRushed && (
                        <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 shrink-0 font-medium">
                          rushed (&lt;20s)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {slide.is_shown ? (
                        <>
                          <span className="font-mono text-xs font-semibold text-slate-600">
                            {formatHumanDuration(slide.total_duration_seconds)}
                          </span>
                          <span className="font-mono text-xs text-slate-400 flex items-center gap-0.5">
                            {slide.intervals_formatted?.[0] || '00:00'}
                            <ArrowUpRight className="w-3.5 h-3.5 opacity-60" />
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Skipped</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}

      </div>
    </div>
  );
}
