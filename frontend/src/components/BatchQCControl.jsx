import { useState, useEffect } from 'react';
import { 
  getBatchQCStatus, 
  startBatchQC, 
  stopBatchQC, 
  purgeQCCache,
  getQcMode 
} from '../api';
import { 
  Zap, 
  Loader2, 
  CheckCircle2, 
  StopCircle, 
  Clock, 
  Coins, 
  Cpu, 
  Trash2, 
  AlertCircle,
  Sparkles,
  Bot
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export default function BatchQCControl({ onBatchComplete }) {
  const [statusData, setStatusData] = useState(null);
  const [modeData, setModeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [stopping, setStopping] = useState(false);

  const fetchStatus = async () => {
    try {
      const [batchRes, modeRes] = await Promise.all([
        getBatchQCStatus(),
        getQcMode()
      ]);
      if (batchRes && batchRes.success) {
        setStatusData(batchRes);
      }
      if (modeRes && modeRes.success) {
        setModeData(modeRes);
      }
    } catch (err) {
      console.warn('Batch status check error:', err.message);
    }
  };

  useEffect(() => {
    fetchStatus();
    // Poll more frequently if a batch is actively running (every 2.5s), else every 6s
    const isRunning = statusData?.batch?.isRunning;
    const interval = setInterval(fetchStatus, isRunning ? 2500 : 6000);
    return () => clearInterval(interval);
  }, [statusData?.batch?.isRunning]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const res = await startBatchQC(4);
      if (res && res.success) {
        toast.success('Batch QC Started', {
          description: `Spun up 2-hour Gemini cache. Evaluating ${res.total} calls in parallel.`
        });
        fetchStatus();
      } else {
        toast.error('Failed to start batch', { description: res?.message || 'Unknown error' });
      }
    } catch (err) {
      toast.error('Error starting batch', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    setStopping(true);
    try {
      const res = await stopBatchQC();
      toast.info('Stopping Batch', { description: res?.message || 'Stop signal sent' });
      fetchStatus();
    } catch (err) {
      toast.error('Failed to stop batch', { description: err.message });
    } finally {
      setStopping(false);
    }
  };

  const handleManualPurge = async () => {
    try {
      const res = await purgeQCCache();
      if (res && res.purged) {
        toast.success('Cache Purged Early', {
          description: `Evicted ${res.cacheName} from Google RAM. Storage billing stopped.`
        });
      } else {
        toast.info('No active cache', { description: res?.message });
      }
      fetchStatus();
    } catch (err) {
      toast.error('Failed to purge cache', { description: err.message });
    }
  };

  const batch = statusData?.batch || {};
  const cache = statusData?.cache || {};
  const autopilot = statusData?.autopilot || {};
  const readyCount = modeData?.counts?.ready_for_qc || 0;
  const isProd = modeData?.mode === 'prod';

  // DEV Mode: Do not show Batch QC Control at all (instant on-the-fly evaluations in dev)
  if (!isProd && !batch.isRunning) {
    return null;
  }

  const progressPercent = batch.total > 0
    ? Math.round(((batch.completed + batch.failed) / batch.total) * 100)
    : 0;

  const formatSec = (sec) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  // ── ACTIVE BATCH RUNNING VIEW ─────────────────────────────────────────────
  if (batch.isRunning) {
    return (
      <div className="rounded-xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 shadow-sm animate-in fade-in duration-300">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/20 text-primary">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-sm text-foreground">
                  Running Shift Batch QC
                </h4>
                <Badge className="bg-primary text-primary-foreground text-[10px] h-5">
                  Concurrency: 4x
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluating {batch.completed} of {batch.total} calls • Active Cache Window: {formatSec(batch.cacheRemainingSec)} left
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
              className="gap-1.5 h-8 text-xs font-semibold"
            >
              <StopCircle className="w-3.5 h-3.5" />
              {stopping ? 'Stopping...' : 'Stop Batch'}
            </Button>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div className="space-y-1.5 mb-3">
          <div className="flex justify-between text-xs font-medium">
            <span className="text-primary font-bold">{progressPercent}% Completed</span>
            <span className="text-muted-foreground">
              {batch.completed} done {batch.failed > 0 && `(${batch.failed} failed)`}
            </span>
          </div>
          <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-primary to-indigo-500 transition-all duration-500 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* METRICS ROW */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/50 text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5 text-primary" />
            <span>Elapsed: <strong>{formatSec(batch.elapsedSec)}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Coins className="w-3.5 h-3.5 text-emerald-600" />
            <span>Est. Spend: <strong>₹{batch.estimatedSpendINR}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Cpu className="w-3.5 h-3.5 text-indigo-500" />
            <span className="truncate">Cache: <strong>{batch.cacheName ? 'Active (90% off)' : 'Creating...'}</strong></span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Bot className="w-3.5 h-3.5 text-violet-500" />
            <span>Auto-Kill: <strong>On Completion</strong></span>
          </div>
        </div>
      </div>
    );
  }

  // ── IDLE STATE (DEV OR PROD) ──────────────────────────────────────────────
  return (
    <div className="rounded-xl border border-border/70 bg-card/60 backdrop-blur-sm p-4 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div className="flex items-start gap-3">
        <div className={cn(
          "p-2.5 rounded-xl shrink-0 mt-0.5",
          isProd ? "bg-violet-500/10 text-violet-600 dark:text-violet-400" : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        )}>
          {isProd ? <Zap className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-sm tracking-tight text-foreground">
              {isProd ? "Shift Batch QC & Caching Autopilot" : "Developer Pipeline Active"}
            </h4>
            <Badge variant="outline" className={cn(
              "text-[10px] h-5",
              isProd ? "border-violet-500/30 text-violet-600" : "border-amber-500/30 text-amber-600"
            )}>
              {isProd ? "PROD Autopilot" : "DEV (Instant)"}
            </Badge>
          </div>

          <p className="text-xs text-muted-foreground mt-1 max-w-2xl leading-relaxed">
            {isProd ? (
              readyCount > 0 ? (
                <span>
                  <strong>{readyCount} call(s)</strong> are queued and waiting. Autopilot will auto-launch when ASR completes (or launch now manually with 90% discounted cached tokens).
                </span>
              ) : (
                <span>
                  Calls from daytime shifts automatically queue here. Autopilot monitors ASR and triggers batch caching with automatic cache termination upon completion.
                </span>
              )
            ) : (
              <span>
                You are currently in <strong>DEV Mode</strong> (instant on-the-fly evaluations in ~8–10s, ₹0 storage fees). To queue calls for bulk batch evaluations with context caching, switch to <strong>PROD Mode</strong>.
              </span>
            )}
          </p>

          {/* Last batch summary if available */}
          {batch.lastSummary && (
            <div className="flex items-center gap-3 text-[11px] text-emerald-600 dark:text-emerald-400 mt-2">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>
                Last Batch: {batch.lastSummary.completed} evaluated in {formatSec(batch.lastSummary.durationSec)} (Spend: ₹{batch.lastSummary.spendINR}) • Cache auto-killed
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end">
        {cache.isAlive && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleManualPurge}
            title="Purge active Gemini cache to stop storage billing immediately"
            className="text-xs text-destructive hover:bg-destructive/10 border-destructive/30"
          >
            <Trash2 className="w-3.5 h-3.5 mr-1" />
            Purge Cache
          </Button>
        )}

        <Button
          onClick={handleStart}
          disabled={loading || readyCount === 0}
          className={cn(
            "font-semibold text-xs shadow-sm gap-1.5 h-9",
            readyCount > 0 
              ? "bg-violet-600 hover:bg-violet-700 text-white" 
              : "bg-muted text-muted-foreground"
          )}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
          ) : (
            <Zap className="w-3.5 h-3.5 mr-1" />
          )}
          Run 2-Hour Batch QC ({readyCount} Ready)
        </Button>
      </div>
    </div>
  );
}
