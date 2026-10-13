import React, { useState, useMemo, useCallback } from 'react';
import { 
  X, 
  ArrowUpRight,
  AlertCircle
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TabsContent } from "@/components/ui/tabs";
import { 
  KALVIUM_SLIDE_MAPPING, 
  formatHumanDuration 
} from '../media/slideMapping';

const SlideTimelineTab = ({ activeCall }) => {
  const [filterMode, setFilterMode] = useState('presented'); // 'presented' | 'rushed' | 'all'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSlideNumber, setSelectedSlideNumber] = useState(null);

  const visualTimeline = activeCall?.visual_timeline || activeCall?.insights_data?.visual_timeline;
  const facialAnalytics = visualTimeline?.facial_analytics;
  const slides = visualTimeline?.slides;

  const rawSlides = useMemo(() => Array.isArray(slides) ? slides : [], [slides]);
  
  const shownSlides = useMemo(() => {
    return rawSlides.filter(s => s.is_shown);
  }, [rawSlides]);

  const rushedSlides = useMemo(() => {
    return shownSlides.filter(s => s.rushed_warning || (s.total_duration_seconds > 0 && s.total_duration_seconds < 20));
  }, [shownSlides]);

  // Overall statistics
  const totalDeckCount = rawSlides.length || 135;
  const presentedCount = shownSlides.length;

  // Extract fatal breaches
  const fatalBreaches = useMemo(() => {
    return Object.entries(activeCall?.quality_data || {}).filter(
      ([, data]) => data.mark_fatal && data.score === 0
    );
  }, [activeCall?.quality_data]);

  // Jump to specific time in call
  const handleJumpToTime = useCallback((seconds, slideNum = null) => {
    if (slideNum) setSelectedSlideNumber(slideNum);
    window.dispatchEvent(new CustomEvent('jump-to-time', { 
      detail: { callId: activeCall?.id, start: seconds } 
    }));
  }, [activeCall?.id]);

  // Filter slides
  const filteredSlides = useMemo(() => {
    let list = shownSlides;
    if (filterMode === 'rushed') {
      list = rushedSlides;
    } else if (filterMode === 'all') {
      list = rawSlides;
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      return list.filter(slide => {
        const title = (KALVIUM_SLIDE_MAPPING[slide.slide_number] || slide.title || '').toLowerCase();
        const numStr = String(slide.slide_number);
        return title.includes(q) || numStr.includes(q);
      });
    }

    return list;
  }, [filterMode, shownSlides, rushedSlides, rawSlides, searchQuery]);

  if (!visualTimeline) {
    return (
      <TabsContent value="timeline" className="h-full mt-0">
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full">
          <p className="text-sm font-medium text-slate-600">No visual timeline available</p>
          <p className="text-xs text-slate-400 mt-1">This call does not contain video or slide tracking data.</p>
        </div>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="timeline" className="h-full mt-0">
      <div className="p-5 overflow-y-auto h-full space-y-4">
        
        {/* ── Minimalist Monochrome Metric Cards ── */}
        <div className="grid grid-cols-3 gap-3">
          
          {/* Card 1: Camera */}
          <div className="bg-white rounded-lg p-3.5 border border-slate-200">
            <div className="text-xs font-medium text-slate-500">Camera Active</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tracking-tight">
              {Math.round(facialAnalytics?.associate_camera_active_pct || 0)}%
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {facialAnalytics?.trust_metric_passed ? 'Verified (≥50%)' : 'Low camera (<50%)'}
            </div>
          </div>

          {/* Card 2: Slides Covered */}
          <div className="bg-white rounded-lg p-3.5 border border-slate-200">
            <div className="text-xs font-medium text-slate-500">Slides Presented</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tracking-tight">
              {presentedCount} <span className="text-xs font-normal text-slate-400">/ {totalDeckCount}</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {totalDeckCount - presentedCount} slides skipped
            </div>
          </div>

          {/* Card 3: Pacing */}
          <div className="bg-white rounded-lg p-3.5 border border-slate-200">
            <div className="text-xs font-medium text-slate-500">Rushed Slides</div>
            <div className="mt-1 text-2xl font-bold text-slate-900 tracking-tight">
              {rushedSlides.length} <span className="text-xs font-normal text-slate-400">(&lt;20s)</span>
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              {rushedSlides.length > 0 ? `${rushedSlides.length} under 20s threshold` : 'Normal pacing'}
            </div>
          </div>
        </div>

        {/* ── Compliance Breaches (Clean Monochrome Alert) ── */}
        {fatalBreaches.length > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-slate-800 text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Pitch Compliance Violation</span>
            </div>
            {fatalBreaches.map(([param, data], idx) => {
              const timeMatch = data.reason?.match(/\b\d+:\d{2}\b/);
              let timeSec = null;
              if (timeMatch) {
                const [m, s] = timeMatch[0].split(':').map(Number);
                timeSec = m * 60 + s;
              }

              return (
                <div key={idx} className="bg-white p-3 rounded-md border border-slate-200 flex items-start justify-between gap-3 text-xs">
                  <div>
                    <span className="font-semibold text-slate-900">{param}</span>
                    <p className="text-slate-600 mt-0.5 leading-relaxed">
                      {data.reason ? data.reason.replace(/\s*\b\d+:\d{2}\b\s*[-:]*\s*/, ' ').trim() : ''}
                    </p>
                  </div>
                  {timeMatch && (
                    <button
                      onClick={() => handleJumpToTime(timeSec)}
                      className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded font-mono text-[11px] font-medium shrink-0 cursor-pointer transition-colors"
                    >
                      {timeMatch[0]} ↗
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Slide Breakdown (Clean Minimalist Table) ── */}
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          
          {/* Header & Filter Controls */}
          <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
            <span className="text-xs font-semibold text-slate-900">
              Slides ({shownSlides.length})
            </span>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter slides..."
                  className="pl-2.5 pr-6 py-1 text-xs w-28 rounded bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:border-slate-400"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* View Filters */}
              <div className="inline-flex bg-slate-100 p-0.5 rounded text-[11px]">
                <button
                  onClick={() => setFilterMode('presented')}
                  className={cn(
                    "px-2 py-0.5 rounded transition-colors cursor-pointer",
                    filterMode === 'presented' ? "bg-white font-medium text-slate-900 shadow-2xs" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  Presented ({shownSlides.length})
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
            </div>
          </div>

          {/* Minimalist Slide Rows */}
          <div className="divide-y divide-slate-100">
            {filteredSlides.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                No slides match your search.
              </div>
            ) : (
              filteredSlides.map((slide) => {
                const isRushed = slide.rushed_warning || (slide.total_duration_seconds > 0 && slide.total_duration_seconds < 20);
                const title = KALVIUM_SLIDE_MAPPING[slide.slide_number] || slide.title || `Slide ${slide.slide_number}`;
                const isSelected = selectedSlideNumber === slide.slide_number;
                const firstInterval = slide.intervals_raw?.[0];

                return (
                  <div
                    key={slide.slide_number}
                    className={cn(
                      "px-4 py-2 flex items-center justify-between gap-3 text-xs transition-colors",
                      isSelected ? "bg-slate-100/70" : "hover:bg-slate-50/70"
                    )}
                  >
                    {/* Left: Number + Title */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-[11px] font-semibold w-7 text-right shrink-0 text-slate-400">
                        #{slide.slide_number}
                      </span>

                      <span className={cn(
                        "truncate",
                        !slide.is_shown ? "text-slate-400" : "text-slate-800 font-medium"
                      )}>
                        {title}
                      </span>

                      {isRushed && (
                        <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200 shrink-0">
                          rushed ({formatHumanDuration(slide.total_duration_seconds)})
                        </span>
                      )}
                    </div>

                    {/* Right: Duration & Jump Timestamp */}
                    <div className="flex items-center gap-2 shrink-0">
                      {slide.is_shown ? (
                        <>
                          <span className="text-[11px] font-mono text-slate-500">
                            {formatHumanDuration(slide.total_duration_seconds)}
                          </span>

                          {firstInterval && (
                            <button
                              onClick={() => handleJumpToTime(firstInterval.start_sec, slide.slide_number)}
                              title="Jump to this slide in transcript"
                              className="px-2 py-0.5 rounded text-[11px] font-mono text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors flex items-center gap-0.5 cursor-pointer"
                            >
                              <span>{slide.intervals_formatted?.[0] || '00:00'}</span>
                              <ArrowUpRight className="w-2.5 h-2.5 opacity-60" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] text-slate-300">Skipped</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>
    </TabsContent>
  );
};

export default SlideTimelineTab;
