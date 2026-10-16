import { useState, useEffect } from 'react';
import { getQcMode, setQcMode } from '../api';
import { 
  Zap, 
  Layers, 
  RefreshCw, 
  CheckCircle2, 
  Info, 
  SlidersHorizontal,
  Coins,
  Clock,
  Sparkles
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export default function QCModeToggle({ compact = false }) {
  const [modeData, setModeData] = useState({
    mode: 'dev',
    model: 'gemini-3.1-flash-lite',
    isCachingEnabled: false,
    counts: { ready_for_qc: 0, processing: 0, evaluated: 0 }
  });
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const fetchMode = async () => {
    try {
      const data = await getQcMode();
      if (data && data.success) {
        setModeData(data);
      }
    } catch (err) {
      console.warn('Could not fetch QC mode:', err);
    }
  };

  useEffect(() => {
    fetchMode();
    const interval = setInterval(fetchMode, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleToggle = async (targetMode) => {
    if (switching || targetMode === modeData.mode) return;
    setSwitching(true);
    try {
      const res = await setQcMode(targetMode);
      if (res && res.success) {
        setModeData(prev => ({
          ...prev,
          mode: targetMode,
          isCachingEnabled: targetMode === 'prod'
        }));
        toast.success(`Switched to ${targetMode.toUpperCase()} Mode`, {
          description: targetMode === 'dev' 
            ? 'Instant evaluations active (8-10s). Zero cache storage fees.'
            : 'Shift batch autopilot active. Calls will queue for bulk cache evaluation.'
        });
        setIsDialogOpen(false);
        fetchMode();
      } else {
        toast.error('Failed to change mode', { description: res?.error || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Error updating QC mode', { description: err.message });
    } finally {
      setSwitching(false);
    }
  };

  const isDev = modeData.mode === 'dev';

  if (compact) {
    return (
      <button
        onClick={() => setIsDialogOpen(true)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 shadow-sm",
          isDev 
            ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20" 
            : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
        )}
        title="Click to switch QC execution mode"
      >
        <span className={cn(
          "w-2 h-2 rounded-full animate-pulse",
          isDev ? "bg-amber-500" : "bg-emerald-500"
        )} />
        <span className="font-semibold tracking-wide">
          {isDev ? "DEV MODE" : "PROD MODE"}
        </span>
        <span className="text-[10px] opacity-75 hidden sm:inline">
          {isDev ? "(Instant)" : `(${modeData.counts?.ready_for_qc || 0} queued)`}
        </span>
      </button>
    );
  }

  return (
    <>
      {/* Mode Status Pill with Click-to-Manage */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className={cn(
            "group flex items-center gap-2.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all shadow-sm cursor-pointer",
            isDev
              ? "bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border-amber-500/30 text-amber-800 dark:text-amber-200 hover:border-amber-500/60"
              : "bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-emerald-500/30 text-emerald-800 dark:text-emerald-200 hover:border-emerald-500/60"
          )}
        >
          <div className={cn(
            "p-1 rounded-md shrink-0 transition-colors",
            isDev ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
          )}>
            {isDev ? <Zap className="w-3.5 h-3.5" /> : <Layers className="w-3.5 h-3.5" />}
          </div>

          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1.5">
              <span className="font-bold tracking-tight text-[11px]">
                {isDev ? "DEV MODE" : "PROD MODE"}
              </span>
              <span className={cn(
                "w-1.5 h-1.5 rounded-full animate-ping",
                isDev ? "bg-amber-500" : "bg-emerald-500"
              )} />
            </div>
            <span className="text-[10px] text-muted-foreground font-normal leading-tight">
              {isDev 
                ? "Instant QC • ₹0 Storage" 
                : `${modeData.counts?.ready_for_qc || 0} calls waiting for batch`}
            </span>
          </div>

          <SlidersHorizontal className="w-3 h-3 ml-1 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
        </button>
      </div>

      {/* Switcher Modal Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <SlidersHorizontal className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-lg font-bold">QC Execution Pipeline</DialogTitle>
                <DialogDescription className="text-xs">
                  Switch between instant developer evaluation and cost-optimized production batch caching.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 py-3">
            {/* DEV MODE CARD */}
            <div
              onClick={() => handleToggle('dev')}
              className={cn(
                "relative p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between",
                isDev
                  ? "border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/10"
                  : "border-border hover:border-muted-foreground/40 bg-card hover:bg-muted/30"
              )}
            >
              {isDev && (
                <div className="absolute top-2.5 right-2.5">
                  <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-[10px] h-5 px-1.5 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ACTIVE
                  </Badge>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 mb-2">
                  <Zap className="w-5 h-5" />
                  <span className="font-bold text-sm">DEV Mode</span>
                </div>
                <h4 className="font-semibold text-sm mb-1">Instant Results</h4>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  Fast on-the-fly evaluation (~8–10s). Bypasses context caching, so you pay <strong>₹0.00</strong> in cache storage fees during development.
                </p>
              </div>

              <div className="pt-2 border-t border-border/50 text-[11px] space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Latency:</span>
                  <span className="font-medium text-foreground">~8–10 sec</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Cache Fee:</span>
                  <span className="font-semibold text-emerald-600">₹0 / month</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Model:</span>
                  <span className="font-medium text-foreground">3.1 Flash-Lite</span>
                </div>
              </div>
            </div>

            {/* PROD MODE CARD */}
            <div
              onClick={() => handleToggle('prod')}
              className={cn(
                "relative p-4 rounded-xl border-2 transition-all cursor-pointer flex flex-col justify-between",
                !isDev
                  ? "border-emerald-500 bg-emerald-500/5 shadow-md shadow-emerald-500/10"
                  : "border-border hover:border-muted-foreground/40 bg-card hover:bg-muted/30"
              )}
            >
              {!isDev && (
                <div className="absolute top-2.5 right-2.5">
                  <Badge className="bg-emerald-500 text-white hover:bg-emerald-600 text-[10px] h-5 px-1.5 gap-1">
                    <CheckCircle2 className="w-3 h-3" /> ACTIVE
                  </Badge>
                </div>
              )}

              <div>
                <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 mb-2">
                  <Layers className="w-5 h-5" />
                  <span className="font-bold text-sm">PROD Mode</span>
                </div>
                <h4 className="font-semibold text-sm mb-1">Shift Batch Autopilot</h4>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  Inbound calls queue during office hours. At shift end, spins up a 2-hr cache, evaluates all ~200 calls in bulk, and auto-kills cache on completion.
                </p>
              </div>

              <div className="pt-2 border-t border-border/50 text-[11px] space-y-1">
                <div className="flex justify-between text-muted-foreground">
                  <span>Calls Queued:</span>
                  <span className="font-bold text-emerald-600">{modeData.counts?.ready_for_qc || 0} waiting</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Input Discount:</span>
                  <span className="font-semibold text-emerald-600">90% off ($0.025/1M)</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Target Budget:</span>
                  <span className="font-medium text-foreground">&lt; ₹2,000 / month</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-muted/40 rounded-lg p-3 text-xs flex items-start gap-2.5">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="text-muted-foreground text-[11px] leading-relaxed">
              <strong>Seamless Switching:</strong> Toggling mode immediately takes effect for all future incoming calls and audio transcriptions without requiring a server restart.
            </div>
          </div>

          <DialogFooter className="flex sm:justify-between items-center pt-2">
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span>Active Model:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-primary text-[10px]">
                {modeData.model}
              </code>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsDialogOpen(false)}
              disabled={switching}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
