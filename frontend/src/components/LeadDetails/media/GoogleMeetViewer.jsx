import { useState, useEffect, useRef } from 'react';
import { Video, Presentation, AlertTriangle, Clock, CheckCircle2, Camera } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '../utils';

function formatHumanDuration(seconds) {
  if (!seconds || seconds <= 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

export default function GoogleMeetViewer({ call, embedded = false }) {
  const segments = typeof call?.segments === 'string' ? JSON.parse(call.segments) : (call?.segments || []);
  const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))].sort();
  const p1Id = uniqueSpeakers[0] || 'SPEAKER_00';

  const [activeSlideNumber, setActiveSlideNumber] = useState(null);
  const [filterMode, setFilterMode] = useState('presented'); // 'presented' | 'rushed' | 'all'
  const [highlightedSegmentIdx, setHighlightedSegmentIdx] = useState(null);

  const segmentRefs = useRef({});
  const scrollAreaRef = useRef(null);

  // Extract visual timeline data
  const timeline = call?.visual_timeline;
  const facialAnalytics = timeline?.facial_analytics;
  const rawSlides = Array.isArray(timeline?.slides) ? timeline.slides : [];
  const shownSlides = rawSlides.filter(s => s.is_shown);
  const rushedSlides = shownSlides.filter(s => s.rushed_warning || (s.total_duration_seconds > 0 && s.total_duration_seconds < 20));

  // Determine which slides to display based on filter
  let displaySlides = shownSlides;
  if (filterMode === 'rushed') {
    displaySlides = rushedSlides;
  } else if (filterMode === 'all') {
    displaySlides = rawSlides;
  } else if (shownSlides.length === 0 && rawSlides.length > 0) {
    displaySlides = rawSlides;
  }

  // Jump to specific time in the transcript
  const scrollToTime = (targetSec) => {
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
  };

  // Listen for jump-to-time events (e.g. from Quality parameters tab)
  useEffect(() => {
    const handleJump = (e) => {
      if (e.detail?.callId === call?.id && e.detail?.start !== undefined) {
        scrollToTime(e.detail.start);
      }
    };
    window.addEventListener('jump-to-time', handleJump);
    return () => window.removeEventListener('jump-to-time', handleJump);
  }, [call?.id, segments]);

  const handleSlideClick = (slide) => {
    setActiveSlideNumber(slide.slide_number);
    const startSec = slide.intervals_raw?.[0]?.start_sec;
    if (startSec !== undefined) {
      scrollToTime(startSec);
      window.dispatchEvent(new CustomEvent('jump-to-time', {
        detail: { callId: call?.id, start: startSec }
      }));
    }
  };

  return (
    <div className={cn("flex flex-col overflow-hidden bg-white rounded-lg shadow-sm", embedded ? "shrink-0 w-full border" : "h-full border")}>
      {/* Meet Header */}
      <div className={cn("flex items-center justify-between gap-4 w-full border-b", embedded ? "p-4 bg-white" : "p-4 bg-indigo-50/60 border-indigo-100")}>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center h-10 w-10 rounded-full bg-indigo-100 text-indigo-600 shadow-sm shrink-0">
            <Video className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-slate-900">Google Meet 1:1 Session</h3>
            <p className="text-xs text-slate-500">Duration: {call?.duration_sec ? formatDuration(call.duration_sec) : 'Unknown'}</p>
          </div>
        </div>

        {/* Camera / Trust Metric Pill in header */}
        {facialAnalytics && (
          <div className={cn(
            "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border shadow-xs",
            facialAnalytics.trust_metric_passed
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-amber-50 text-amber-800 border-amber-200"
          )}>
            <Camera className="w-3.5 h-3.5" />
            <span>Camera: {Math.round(facialAnalytics.associate_camera_active_pct)}% Active</span>
            <span className="opacity-40">•</span>
            <span>{facialAnalytics.trust_metric_passed ? 'Trust Metric Passed ✓' : 'Camera Low ⚠️'}</span>
          </div>
        )}
      </div>

      {/* Visual Slide Strip / Timeline */}
      {rawSlides.length > 0 && (
        <div className="border-b border-slate-200/80 bg-slate-50/70 p-3 space-y-2.5">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-md bg-indigo-100 text-indigo-700">
                <Presentation className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-900 uppercase tracking-wide">Slide Strip</span>
              <span className="text-[11px] font-medium text-slate-500">
                ({shownSlides.length} presented of {rawSlides.length})
              </span>
            </div>

            {/* Badges & Filters */}
            <div className="flex items-center gap-2 flex-wrap">
              {rushedSlides.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                  {rushedSlides.length} {rushedSlides.length === 1 ? 'Slide' : 'Slides'} Rushed (&lt;20s)
                </span>
              )}

              {/* View filters */}
              {rawSlides.length > shownSlides.length && (
                <div className="flex items-center bg-slate-200/70 p-0.5 rounded-lg text-[10px] font-semibold">
                  <button
                    onClick={() => setFilterMode('presented')}
                    className={cn(
                      "px-2 py-0.5 rounded-md transition-all cursor-pointer",
                      filterMode === 'presented' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    Presented ({shownSlides.length})
                  </button>
                  {rushedSlides.length > 0 && (
                    <button
                      onClick={() => setFilterMode('rushed')}
                      className={cn(
                        "px-2 py-0.5 rounded-md transition-all cursor-pointer",
                        filterMode === 'rushed' ? "bg-rose-600 text-white shadow-xs" : "text-rose-700 hover:text-rose-900"
                      )}
                    >
                      Rushed ({rushedSlides.length})
                    </button>
                  )}
                  <button
                    onClick={() => setFilterMode('all')}
                    className={cn(
                      "px-2 py-0.5 rounded-md transition-all cursor-pointer",
                      filterMode === 'all' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    All Deck ({rawSlides.length})
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Horizontal Slide Carousel */}
          <div className="flex gap-2.5 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
            {displaySlides.map((slide) => {
              const isRushed = slide.rushed_warning || (slide.total_duration_seconds > 0 && slide.total_duration_seconds < 20);
              const isSelected = activeSlideNumber === slide.slide_number;

              return (
                <button
                  key={slide.slide_number}
                  onClick={() => handleSlideClick(slide)}
                  title={isRushed ? `Rushed: Shown for only ${formatHumanDuration(slide.total_duration_seconds)} (< 20s)` : `Presented for ${formatHumanDuration(slide.total_duration_seconds)}`}
                  className={cn(
                    "group text-left shrink-0 w-[195px] p-2.5 rounded-xl border transition-all cursor-pointer relative flex flex-col justify-between",
                    !slide.is_shown
                      ? "bg-slate-100/50 border-dashed border-slate-200 opacity-60 hover:opacity-100 hover:bg-slate-100"
                      : isRushed
                        ? "bg-rose-50/70 border-rose-300 hover:border-rose-500 hover:bg-rose-50 shadow-xs"
                        : "bg-white border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/30 hover:shadow-xs",
                    isSelected && (isRushed ? "ring-2 ring-rose-500 border-transparent shadow-xs" : "ring-2 ring-indigo-500 border-transparent shadow-xs")
                  )}
                >
                  {/* Top row: Slide number + duration / rushed badge */}
                  <div className="flex items-center justify-between gap-1 w-full mb-1">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                      !slide.is_shown
                        ? "text-slate-500 bg-slate-200/60"
                        : isRushed
                          ? "text-rose-700 bg-rose-200/80"
                          : "text-indigo-700 bg-indigo-100/80"
                    )}>
                      Slide {slide.slide_number}
                    </span>

                    {slide.is_shown ? (
                      isRushed ? (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-100 px-1.5 py-0.5 rounded-full border border-rose-200">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {formatHumanDuration(slide.total_duration_seconds)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200">
                          <Clock className="w-2.5 h-2.5" />
                          {formatHumanDuration(slide.total_duration_seconds)}
                        </span>
                      )
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">Not shown</span>
                    )}
                  </div>

                  {/* Slide Title */}
                  <div className="font-semibold text-xs text-slate-800 line-clamp-2 leading-tight group-hover:text-indigo-600 transition-colors my-1">
                    {slide.title || `Slide ${slide.slide_number}`}
                  </div>

                  {/* Bottom Row */}
                  {slide.is_shown && (
                    <div className="mt-1 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                      <span className="font-mono text-[10px] text-slate-600">
                        ⏱️ {slide.intervals_formatted?.[0] || `${formatDuration(slide.intervals_raw?.[0]?.start_sec || 0)}`}
                      </span>
                      <span className="text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition-opacity">
                        Jump →
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Transcript */}
      {!embedded && (
        <div className="flex-1 overflow-hidden bg-white flex flex-col">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-white/70 flex items-center justify-between shrink-0">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Meeting Transcript</h3>
            <span className="text-[11px] text-slate-500">{segments.length} dialogue turns</span>
          </div>
          <ScrollArea className="flex-1 h-full" ref={scrollAreaRef}>
            <div className="p-4 flex flex-col space-y-3.5">
              {segments.map((seg, idx) => {
                const isP1 = seg.speaker === p1Id || seg.speaker === 'Advisor' || seg.speaker?.includes('Advisor');
                const participantName = seg.speaker || (isP1 ? 'Advisor' : 'Family');
                const isHighlighted = highlightedSegmentIdx === idx;

                return (
                  <div
                    key={idx}
                    ref={(el) => (segmentRefs.current[idx] = el)}
                    className={cn(
                      "flex w-full group transition-all duration-300",
                      isP1 ? "justify-start" : "justify-end"
                    )}
                  >
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-4 py-2.5 transition-all",
                      isP1 ? "bg-slate-100 rounded-tl-xs text-slate-900" : "bg-indigo-50/90 text-slate-900 rounded-tr-xs",
                      isHighlighted && "ring-2 ring-indigo-500 shadow-md scale-[1.01]"
                    )}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "font-bold text-[11px] uppercase tracking-wide",
                          isP1 ? "text-slate-600" : "text-indigo-700"
                        )}>
                          {participantName}
                        </span>
                        {seg.start !== undefined && (
                          <span className="text-[10px] font-mono opacity-50">
                            {formatDuration(seg.start)}-{formatDuration(seg.end)}
                          </span>
                        )}
                      </div>
                      <div className="text-sm leading-relaxed">
                        {seg.text}
                        {seg.text_en && seg.text_en !== seg.text && (
                          <div className={cn(
                            "mt-1.5 italic text-xs pt-1.5 border-t",
                            isP1 ? "text-slate-500 border-slate-200" : "text-indigo-700/70 border-indigo-200/50"
                          )}>
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
