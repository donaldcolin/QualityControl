import { useState, useEffect } from 'react';
import { getQcMode, setQcMode } from '../api';
import { 
  Zap, 
  Layers, 
  CheckCircle2, 
  Info, 
  SlidersHorizontal,
  Coins,
  Clock,
  Sparkles,
  Laptop,
  Server,
  Cpu,
  ArrowRight,
  ShieldAlert,
  Loader2,
  Check,
  ChevronRight,
  Gauge
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
    const interval = setInterval(fetchMode, 6000);
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
        toast.success(`Pipeline switched to ${targetMode.toUpperCase()} Mode`, {
          description: targetMode === 'dev' 
            ? 'DEV Active: Instant evaluation (~8–10s), 1x serial intake, ₹0 cache fees.'
            : 'PROD Active: Shift batch autopilot, 4x parallel workers, 90% cached discount.'
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

  return (
    <>
      {/* ── PREMIUM NAVBAR PILL BUTTON ── */}
      <button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        className={cn(
          "group relative flex items-center gap-2.5 px-3 py-1.5 rounded-full border transition-all duration-200 cursor-pointer shadow-sm select-none",
          isDev
            ? "bg-amber-500/10 hover:bg-amber-500/15 border-amber-500/30 hover:border-amber-500/60 text-amber-900 dark:text-amber-200"
            : "bg-emerald-500/10 hover:bg-emerald-500/15 border-emerald-500/30 hover:border-emerald-500/60 text-emerald-900 dark:text-emerald-200"
        )}
        title="Click to view & switch QC execution pipeline"
      >
        {/* Glow indicator icon */}
        <div className={cn(
          "relative flex items-center justify-center w-6 h-6 rounded-full transition-transform group-hover:scale-105",
          isDev 
            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400" 
            : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
        )}>
          {isDev ? <Laptop className="w-3.5 h-3.5" /> : <Zap className="w-3.5 h-3.5 fill-current" />}
          <span className={cn(
            "absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-background",
            isDev ? "bg-amber-500" : "bg-emerald-500 animate-pulse"
          )} />
        </div>

        {/* Text details */}
        <div className="flex flex-col text-left leading-none pr-0.5">
          <div className="flex items-center gap-1.5">
            <span className="font-bold tracking-tight text-[11px]">
              {isDev ? "DEV MODE" : "PROD MODE"}
            </span>
            <span className={cn(
              "px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wide uppercase",
              isDev 
                ? "bg-amber-500/20 text-amber-700 dark:text-amber-300" 
                : "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            )}>
              {isDev ? "Instant" : "Autopilot"}
            </span>
          </div>
          <span className="text-[10px] text-muted-foreground font-medium mt-0.5">
            {isDev ? "1x Serial · ₹0 Storage" : "4x Parallel · 90% Off"}
          </span>
        </div>

        <SlidersHorizontal className="w-3 h-3 text-muted-foreground/70 group-hover:text-foreground transition-colors ml-0.5" />
      </button>

      {/* ── UPGRADED COMPARISON & SWITCHER MODAL ── */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-xl sm:max-w-2xl p-6">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-primary/10 text-primary">
                  <Gauge className="w-5 h-5" />
                </div>
                <div>
                  <DialogTitle className="text-base sm:text-lg font-bold tracking-tight">
                    QC Execution Pipeline
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                    Configure how incoming audio calls are ingested, transcribed, and evaluated by Gemini AI.
                  </DialogDescription>
                </div>
              </div>

              <Badge variant="outline" className={cn(
                "text-[10px] font-semibold uppercase px-2 py-0.5 shrink-0",
                isDev ? "border-amber-500/40 text-amber-600 bg-amber-500/5" : "border-emerald-500/40 text-emerald-600 bg-emerald-500/5"
              )}>
                {isDev ? "Active: DEV Mode" : "Active: PROD Mode"}
              </Badge>
            </div>
          </DialogHeader>

          {/* TWO MODE CARDS */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
            
            {/* DEV MODE CARD */}
            <div
              onClick={() => !isDev && handleToggle('dev')}
              className={cn(
                "relative p-4 rounded-xl border-2 transition-all flex flex-col justify-between select-none",
                isDev
                  ? "border-amber-500 bg-gradient-to-b from-amber-500/10 via-amber-500/5 to-transparent shadow-sm"
                  : "border-border hover:border-amber-500/50 bg-card hover:bg-muted/30 cursor-pointer"
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <Laptop className="w-4 h-4" />
                    <span className="font-bold text-xs uppercase tracking-wider">DEV Mode</span>
                  </div>
                  {isDev ? (
                    <Badge className="bg-amber-500 text-white hover:bg-amber-600 text-[10px] h-5 px-1.5 gap-1 shadow-none">
                      <Check className="w-3 h-3 stroke-[3]" /> Active
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5">
                      Switch <ChevronRight className="w-3 h-3" />
                    </span>
                  )}
                </div>

                <h4 className="font-semibold text-sm text-foreground mb-1">
                  Instant Results · Local Testing
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  Evaluates each call <strong>immediately on-the-fly (~8–10s)</strong>. Bypasses batch context caching so you pay <strong>₹0.00</strong> in Google RAM storage fees.
                </p>

                {/* Key feature pills */}
                <div className="space-y-1.5 text-[11px] bg-background/60 rounded-lg p-2.5 border border-border/60">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Evaluation:</span>
                    <span className="font-semibold text-foreground">Instant (~8–10s)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Queue Gate:</span>
                    <span className="font-medium text-amber-700 dark:text-amber-300">Gated (Run / Step)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Worker Load:</span>
                    <span className="font-medium text-foreground">1x Serial (M1 Safe)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Cache Storage Rent:</span>
                    <span className="font-bold text-emerald-600">₹0.00 / month</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Best For:</span>
                <span className="font-medium text-foreground">Coding, Prompt & Audio Testing</span>
              </div>
            </div>

            {/* PROD MODE CARD */}
            <div
              onClick={() => isDev && handleToggle('prod')}
              className={cn(
                "relative p-4 rounded-xl border-2 transition-all flex flex-col justify-between select-none",
                !isDev
                  ? "border-emerald-500 bg-gradient-to-b from-emerald-500/10 via-emerald-500/5 to-transparent shadow-sm"
                  : "border-border hover:border-emerald-500/50 bg-card hover:bg-muted/30 cursor-pointer"
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                    <Zap className="w-4 h-4 fill-current" />
                    <span className="font-bold text-xs uppercase tracking-wider">PROD Mode</span>
                  </div>
                  {!isDev ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-700 text-[10px] h-5 px-1.5 gap-1 shadow-none">
                      <Check className="w-3 h-3 stroke-[3]" /> Active
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground font-medium flex items-center gap-0.5">
                      Switch <ChevronRight className="w-3 h-3" />
                    </span>
                  )}
                </div>

                <h4 className="font-semibold text-sm text-foreground mb-1">
                  Shift Batch Autopilot · 90% Off
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed mb-3">
                  Calls ingest <strong>autonomously 24/7</strong>. Autopilot loads the 28K prompt into a 2-hr RAM cache, bulk-evaluates calls in parallel, and auto-kills cache on completion.
                </p>

                {/* Key feature pills */}
                <div className="space-y-1.5 text-[11px] bg-background/60 rounded-lg p-2.5 border border-border/60">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Evaluation:</span>
                    <span className="font-semibold text-emerald-600">Batch Autopilot (90% off)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Queue Gate:</span>
                    <span className="font-medium text-emerald-700 dark:text-emerald-300">Autonomous (No clicks)</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Worker Load:</span>
                    <span className="font-medium text-foreground">4x Parallel</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Cache Storage Rent:</span>
                    <span className="font-bold text-emerald-600">₹0.00 (Auto-Purged)</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-border/40 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Best For:</span>
                <span className="font-medium text-foreground">Live Operations (&lt; ₹2k/mo budget)</span>
              </div>
            </div>

          </div>

          {/* ── SIDE-BY-SIDE SUMMARY FOOTNOTE ── */}
          <div className="bg-muted/40 rounded-xl p-3 border border-border/50 text-[11px] space-y-1 text-muted-foreground">
            <div className="flex items-center gap-2 font-medium text-foreground">
              <Info className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>How Switching Works</span>
            </div>
            <p className="leading-relaxed pl-5">
              Clicking either card switches the system mode instantly in memory and persists to <code className="text-xs text-foreground bg-muted px-1 py-0.5 rounded font-mono">.env</code> with <strong>zero server downtime</strong>.
            </p>
          </div>

          <DialogFooter className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pt-2">
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <span>Active Model:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono text-primary text-[10px]">
                {modeData.model}
              </code>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant={isDev ? "default" : "outline"}
                size="sm"
                onClick={() => handleToggle(isDev ? 'prod' : 'dev')}
                disabled={switching}
                className={cn(
                  "gap-1.5 text-xs h-8 font-semibold",
                  isDev 
                    ? "bg-emerald-600 hover:bg-emerald-700 text-white" 
                    : "bg-amber-600 hover:bg-amber-700 text-white"
                )}
              >
                {switching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5" />
                )}
                Switch to {isDev ? "PROD Mode" : "DEV Mode"}
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsDialogOpen(false)}
                className="text-xs h-8"
              >
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
