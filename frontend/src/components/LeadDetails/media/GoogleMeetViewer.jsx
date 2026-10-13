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
      if (e.detail?.callId === call?.id && e.detail?.start !== undefined) {
        scrollToTime(e.detail.start);
      }
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
    <div className={cn("flex flex-col overflow-hidden bg-white rounded-lg border border-slate-200", embedded ? "shrink-0 w-full" : "h-full")}>
      
      {/* ── Top Header ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
            <Video className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-xs text-slate-900">Google Meet 1:1</span>
            <span className="font-mono text-xs text-slate-400">
              {call?.duration_sec ? formatDuration(call.duration_sec) : '90:04'}
            </span>
          </div>
        </div>

        {/* Camera Status */}
        {facialAnalytics && (
          <div className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 text-slate-600 border border-slate-200 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
            <span>Camera {Math.round(facialAnalytics.associate_camera_active_pct)}%</span>
          </div>
        )}
      </div>

      {/* ── Heading Toggles on Top (Click to Show) ── */}
      <div className="flex items-center justify-between border-b border-slate-200 px-4 bg-white shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setActiveTab('dialogue')}
            className={cn(
              "py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors cursor-pointer",
              activeTab === 'dialogue'
                ? "border-slate-900 text-slate-900"
                : "border-transparent text-slate-400 hover:text-slate-700"
            )}
          >
            Dialogue ({segments.length})
          </button>

          {rawSlides.length > 0 && (
            <button
              onClick={() => setActiveTab('slides')}
              className={cn(
                "py-2.5 text-xs font-semibold border-b-2 -mb-px transition-colors cursor-pointer",
                activeTab === 'slides'
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-400 hover:text-slate-700"
              )}
            >
              Slides ({shownSlides.length})
            </button>
          )}
        </div>

        {/* View-specific sub-controls */}
        {activeTab === 'dialogue' && (
          <div className="inline-flex bg-slate-100 p-0.5 rounded text-[11px]">
            <button
              onClick={() => setSpeakerFilter('all')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors cursor-pointer",
                speakerFilter === 'all' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-600"
              )}
            >
              All
            </button>
            <button
              onClick={() => setSpeakerFilter('advisor')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors cursor-pointer",
                speakerFilter === 'advisor' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-600"
              )}
            >
              Advisor
            </button>
            <button
              onClick={() => setSpeakerFilter('student')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors cursor-pointer",
                speakerFilter === 'student' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-600"
              )}
            >
              Student
            </button>
          </div>
        )}

        {activeTab === 'slides' && rawSlides.length > 0 && (
          <div className="inline-flex bg-slate-100 p-0.5 rounded text-[10px]">
            <button
              onClick={() => setFilterMode('presented')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors cursor-pointer",
                filterMode === 'presented' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
              )}
            >
              Shown ({shownSlides.length})
            </button>
            {rushedSlides.length > 0 && (
              <button
                onClick={() => setFilterMode('rushed')}
                className={cn(
                  "px-2 py-0.5 rounded transition-colors cursor-pointer",
                  filterMode === 'rushed' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Rushed ({rushedSlides.length})
              </button>
            )}
            <button
              onClick={() => setFilterMode('all')}
              className={cn(
                "px-2 py-0.5 rounded transition-colors cursor-pointer",
                filterMode === 'all' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
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
            <div className="p-4 space-y-2.5">
              {filteredSegments.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  No dialogue matches.
                </div>
              ) : (
                filteredSegments.map(({ seg, originalIdx }) => {
                  const isP1 = seg.speaker === p1Id || seg.speaker === 'Advisor' || seg.speaker?.includes('Advisor');
                  const speakerName = isP1 ? 'Advisor' : 'Student';
                  const isHighlighted = highlightedSegmentIdx === originalIdx;

                  return (
                    <div
                      key={originalIdx}
                      ref={(el) => (segmentRefs.current[originalIdx] = el)}
                      className={cn(
                        "rounded-md p-2.5 transition-colors text-xs leading-relaxed group border",
                        isP1 ? "bg-white border-slate-200/90 text-slate-800" : "bg-slate-50/70 border-slate-200/60 text-slate-800",
                        isHighlighted && "ring-1 ring-slate-900 bg-slate-100"
                      )}
                    >
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-semibold text-slate-700">
                          {speakerName}
                        </span>
                        
                        <div className="flex items-center gap-1.5">
                          {seg.start !== undefined && (
                            <button
                              onClick={() => scrollToTime(seg.start)}
                              className="font-mono text-[10px] text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              {formatDuration(seg.start)}
                            </button>
                          )}
                          <button
                            onClick={() => handleCopyText(seg.text, originalIdx)}
                            className="text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                            title="Copy text"
                          >
                            {copiedTurnIdx === originalIdx ? (
                              <Check className="w-3 h-3 text-slate-700" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="text-[13px] text-slate-800">
                        {seg.text}
                      </div>

                      {seg.text_en && seg.text_en !== seg.text && (
                        <div className="mt-1 text-slate-500 italic text-xs">
                          "{seg.text_en}"
                        </div>
                      )}
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
            <div className="p-4 space-y-1.5">
              {displaySlides.map((slide) => {
                const isRushed = slide.rushed_warning || (slide.total_duration_seconds > 0 && slide.total_duration_seconds < 20);
                const isSelected = activeSlideNumber === slide.slide_number;
                const title = KALVIUM_SLIDE_MAPPING[slide.slide_number] || slide.title || `Slide ${slide.slide_number}`;

                return (
                  <div
                    key={slide.slide_number}
                    onClick={() => handleSlideClick(slide)}
                    className={cn(
                      "w-full text-left p-3 rounded-md transition-all cursor-pointer border flex items-center justify-between gap-3 text-xs",
                      !slide.is_shown 
                        ? "bg-white border-dashed border-slate-200 opacity-50" 
                        : "bg-white border-slate-200 hover:border-slate-400 hover:bg-slate-50/50",
                      isSelected && "bg-slate-100 border-slate-900 ring-1 ring-slate-900"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-[11px] font-semibold text-slate-400 w-7 text-right shrink-0">
                        #{slide.slide_number}
                      </span>
                      <span className={cn(
                        "truncate",
                        !slide.is_shown ? "text-slate-400" : "text-slate-800 font-medium"
                      )}>
                        {title}
                      </span>
                      {isRushed && (
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200 shrink-0 font-mono">
                          rushed (&lt;20s)
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {slide.is_shown ? (
                        <>
                          <span className="font-mono text-[11px] text-slate-500">
                            {formatHumanDuration(slide.total_duration_seconds)}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 flex items-center gap-0.5">
                            {slide.intervals_formatted?.[0] || '00:00'}
                            <ArrowUpRight className="w-3 h-3 opacity-60" />
                          </span>
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-300">Skipped</span>
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
