import { useState, useEffect, useRef } from 'react';
import { Play, Pause, Video } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatDuration } from '../utils';

export default function GoogleMeetViewer({ call, embedded = false }) {
  const segments = typeof call.segments === 'string' ? JSON.parse(call.segments) : (call.segments || []);
  const uniqueSpeakers = [...new Set(segments.map(s => s.speaker))].sort();
  const p1Id = uniqueSpeakers[0] || 'SPEAKER_00';
  
  return (
    <div className={cn("flex flex-col overflow-hidden bg-white rounded-lg shadow-sm", embedded ? "shrink-0 w-full border" : "h-full border")}>
      {/* Meet Header */}
      <div className={cn("flex items-center gap-4 w-full", embedded ? "p-4 bg-white" : "p-5 bg-indigo-50 border-b border-indigo-100")}>
        <div className="flex items-center justify-center h-12 w-12 rounded-full bg-indigo-100 text-indigo-600 shadow-sm shrink-0">
          <Video className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-bold text-slate-900">Google Meet Session</h3>
          <p className="text-sm text-slate-500">Duration: {call.duration_sec ? formatDuration(call.duration_sec) : 'Unknown'}</p>
        </div>
      </div>

      {/* Transcript */}
      {!embedded && (
        <div className="flex-1 overflow-hidden bg-white">
          <div className="px-4 py-3 border-b border-slate-100 bg-white/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">Meeting Transcript</h3>
          </div>
          <ScrollArea className="h-[calc(100%-45px)]">
            <div className="p-5 flex flex-col space-y-4">
              {segments.map((seg, idx) => {
                const isP1 = seg.speaker === p1Id;
                const participantName = seg.speaker || (isP1 ? 'Participant 1' : 'Participant 2');

                return (
                  <div
                    key={idx}
                    className={cn(
                      "flex w-full group",
                      isP1 ? "justify-start" : "justify-end"
                    )}
                  >
                    <div className={cn(
                      "max-w-[85%] rounded-2xl px-5 py-3 transition-colors",
                      isP1 ? "bg-slate-100 rounded-tl-sm text-slate-900" : "bg-indigo-50 text-slate-900 rounded-tr-sm"
                    )}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={cn("font-bold text-[11px] uppercase tracking-wide", isP1 ? "text-slate-500" : "text-indigo-600/70")}>{participantName}</span>
                        {seg.start !== undefined && (
                          <span className="text-[10px] font-mono opacity-50">{formatDuration(seg.start)}-{formatDuration(seg.end)}</span>
                        )}
                      </div>
                      <div className="text-sm leading-relaxed">
                        {seg.text}
                        {seg.text_en && seg.text_en !== seg.text && (
                          <div className={cn("mt-2 italic text-xs pt-2 border-t", isP1 ? "text-slate-500 border-slate-200" : "text-indigo-700/60 border-indigo-200/50")}>
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
