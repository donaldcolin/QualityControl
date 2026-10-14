import React, { useState, useMemo, useCallback } from 'react';
import { 
  X, 
  ArrowUpRight,
  AlertCircle,
  Video,
  Layers,
  Clock,
  Zap,
  ShieldAlert,
  Search,
  CheckCircle2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
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
      <TabsContent value="timeline" className="h-full min-h-0 overflow-hidden mt-0">
        <div className="flex flex-col items-center justify-center p-12 text-slate-400 h-full">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <Layers className="w-6 h-6 text-slate-400" />
          </div>
          <p className="text-sm font-semibold text-slate-700">No visual timeline available</p>
          <p className="text-xs text-slate-400 mt-1 text-center max-w-sm">This call does not contain video or slide tracking data.</p>
        </div>
      </TabsContent>
    );
  }

  return (
    <TabsContent value="timeline" className="h-full min-h-0 overflow-hidden mt-0">
      <div className="p-5 overflow-y-auto h-full space-y-4">
        
        {/* ── Metric Cards ── */}
        <div className="grid grid-cols-3 gap-3">
          
          {/* Card 1: Camera */}
          <div className="bg-gradient-to-br from-emerald-50/70 via-white to-white rounded-xl p-3.5 border border-emerald-100 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                <Video className="w-3.5 h-3.5" />
              </div>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                facialAnalytics?.trust_metric_passed
                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                  : "bg-amber-100 text-amber-800 border-amber-200"
              )}>
                {facialAnalytics?.trust_metric_passed ? 'Verified' : 'Low (<50%)'}
              </span>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {Math.round(facialAnalytics?.associate_camera_active_pct || 0)}%
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                Camera Active
              </div>
            </div>
          </div>

          {/* Card 2: Slides Covered */}
          <div className="bg-gradient-to-br from-blue-50/70 via-white to-white rounded-xl p-3.5 border border-blue-100 shadow-2xs flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <div className="w-7 h-7 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <Layers className="w-3.5 h-3.5" />
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                {Math.round((presentedCount / totalDeckCount) * 100)}% Deck
              </span>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {presentedCount} <span className="text-xs font-semibold text-slate-400">/ {totalDeckCount}</span>
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                {totalDeckCount - presentedCount} slides skipped
              </div>
            </div>
          </div>

          {/* Card 3: Pacing */}
          <div className={cn(
            "rounded-xl p-3.5 border shadow-2xs flex flex-col justify-between",
            rushedSlides.length > 0 
              ? "bg-gradient-to-br from-amber-50/70 via-white to-white border-amber-200/80" 
              : "bg-gradient-to-br from-slate-50/70 via-white to-white border-slate-200"
          )}>
            <div className="flex items-center justify-between">
              <div className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center shrink-0",
                rushedSlides.length > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
              )}>
                <Clock className="w-3.5 h-3.5" />
              </div>
              <span className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full border",
                rushedSlides.length > 0 
                  ? "bg-amber-100 text-amber-800 border-amber-200" 
                  : "bg-emerald-100 text-emerald-800 border-emerald-200"
              )}>
                {rushedSlides.length > 0 ? `${rushedSlides.length} Rushed` : 'Pacing Good'}
              </span>
            </div>
            <div className="mt-2">
              <div className="text-2xl font-black text-slate-900 tracking-tight">
                {rushedSlides.length} <span className="text-xs font-semibold text-slate-400">(&lt;20s)</span>
              </div>
              <div className="text-[11px] font-medium text-slate-500 mt-0.5">
                {rushedSlides.length > 0 ? 'Under 20s threshold' : 'Optimal duration'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Compliance Breaches Alert ── */}
        {fatalBreaches.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 space-y-3 shadow-2xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-rose-800 text-xs font-bold tracking-wide uppercase">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0" />
                <span>Pitch Compliance Violation</span>
              </div>
              <Badge variant="destructive" className="text-[10px] uppercase font-bold animate-pulse">
                Breach Flagged
              </Badge>
            </div>
            {fatalBreaches.map(([param, data], idx) => {
              const timeMatch = data.reason?.match(/\b\d+:\d{2}\b/);
              let timeSec = null;
              if (timeMatch) {
                const [m, s] = timeMatch[0].split(':').map(Number);
                timeSec = m * 60 + s;
              }

              return (
                <div key={idx} className="bg-white p-3.5 rounded-lg border border-rose-100 shadow-2xs flex items-start justify-between gap-3 text-xs">
                  <div>
                    <span className="font-bold text-slate-900">{param}</span>
                    <p className="text-slate-600 mt-1 leading-relaxed">
                      {data.reason ? data.reason.replace(/\s*\b\d+:\d{2}\b\s*[-:]*\s*/, ' ').trim() : ''}
                    </p>
                  </div>
                  {timeMatch && (
                    <button
                      onClick={() => handleJumpToTime(timeSec)}
                      className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md font-mono text-xs font-bold shrink-0 transition-colors flex items-center gap-1 shadow-2xs cursor-pointer"
                    >
                      <span>{timeMatch[0]}</span>
                      <ArrowUpRight className="w-3 h-3 text-rose-600" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Slide Breakdown Card ── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
          
          {/* Header & Filter Controls */}
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">
                Slide Breakdown
              </span>
              <Badge variant="outline" className="bg-white text-slate-700 border-slate-200 text-[11px] font-mono px-2 py-0">
                {filteredSlides.length} of {rawSlides.length}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter slides..."
                  className="pl-8 pr-7 py-1 text-xs w-32 rounded-lg bg-white border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-2xs text-slate-800 placeholder:text-slate-400"
                />
                {searchQuery && (
                  <button 
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* View Filters */}
              <div className="inline-flex bg-slate-200/70 p-0.5 rounded-lg text-xs font-medium">
                <button
                  onClick={() => setFilterMode('presented')}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all cursor-pointer",
                    filterMode === 'presented' ? "bg-white font-bold text-blue-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  Presented ({shownSlides.length})
                </button>
                {rushedSlides.length > 0 && (
                  <button
                    onClick={() => setFilterMode('rushed')}
                    className={cn(
                      "px-2.5 py-1 rounded-md transition-all cursor-pointer",
                      filterMode === 'rushed' ? "bg-white font-bold text-amber-700 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                    )}
                  >
                    Rushed ({rushedSlides.length})
                  </button>
                )}
                <button
                  onClick={() => setFilterMode('all')}
                  className={cn(
                    "px-2.5 py-1 rounded-md transition-all cursor-pointer",
                    filterMode === 'all' ? "bg-white font-bold text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  All ({rawSlides.length})
                </button>
              </div>
            </div>
          </div>

          {/* Slide Rows */}
          <div className="divide-y divide-slate-100">
            {filteredSlides.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                <Search className="w-6 h-6 text-slate-300" />
                <p>No slides match your search query.</p>
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
                    onClick={() => {
                      if (firstInterval) {
                        handleJumpToTime(firstInterval.start_sec, slide.slide_number);
                      }
                    }}
                    className={cn(
                      "px-4 py-3 flex items-center justify-between gap-3 text-xs transition-all cursor-pointer group",
                      !slide.is_shown 
                        ? "opacity-50 hover:opacity-80 bg-slate-50/20" 
                        : isSelected 
                          ? "bg-blue-50/80 border-l-4 border-l-blue-600" 
                          : "hover:bg-slate-50/80"
                    )}
                  >
                    {/* Left: Number + Title + Badges */}
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className={cn(
                        "font-mono text-xs font-bold px-2 py-0.5 rounded-md min-w-[36px] text-center shrink-0",
                        !slide.is_shown 
                          ? "bg-slate-100 text-slate-400" 
                          : isRushed 
                            ? "bg-amber-100 text-amber-800 border border-amber-200/80" 
                            : "bg-blue-50 text-blue-700 border border-blue-200/80"
                      )}>
                        #{slide.slide_number}
                      </span>

                      <span className={cn(
                        "truncate font-semibold text-sm",
                        !slide.is_shown ? "text-slate-400" : "text-slate-900 group-hover:text-blue-700 transition-colors"
                      )}>
                        {title}
                      </span>

                      {isRushed && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200 shrink-0">
                          <Zap className="w-2.5 h-2.5 text-amber-600 fill-amber-500" />
                          rushed ({formatHumanDuration(slide.total_duration_seconds)})
                        </span>
                      )}
                    </div>

                    {/* Right: Duration & Jump Timestamp */}
                    <div className="flex items-center gap-2.5 shrink-0">
                      {slide.is_shown ? (
                        <>
                          <span className="text-xs font-mono font-bold text-slate-600 tabular-nums">
                            {formatHumanDuration(slide.total_duration_seconds)}
                          </span>

                          {firstInterval && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleJumpToTime(firstInterval.start_sec, slide.slide_number);
                              }}
                              title="Jump to this slide in dialogue"
                              className="px-2.5 py-1 rounded-md font-mono text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200/70 transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                            >
                              <span>{slide.intervals_formatted?.[0] || '00:00'}</span>
                              <ArrowUpRight className="w-3 h-3 text-blue-600" />
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-xs font-medium text-slate-400 italic">Skipped</span>
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
