import { useState, useEffect } from 'react';
import { 
  getQueue, 
  getAssociates, 
  sendToQC, 
  bumpQueueItem, 
  deleteQueueItem,
  retryQueueItem,
  getGovernorStatus,
  playQueueGate,
  pauseQueueGate,
  stepQueueGate,
  clearQueueGate,
  toggleGovernorKillswitch,
  getScannerStatus,
  pauseScanner,
  resumeScanner
} from '../api';
import { 

  RefreshCw, 


  Loader2, 
  Play, 
  Pause,
  FastForward,
  RotateCcw,
  ArrowUp, 
  Trash2,
  ShieldAlert,
  AlertOctagon,
  Phone,
  Video,
  Database,
  CircleDot
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import BatchQCControl from './BatchQCControl';

export default function QueueView({ onRunStart }) {
  const [queue, setQueue] = useState([]);
  const [associates, setAssociates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('all');
  const [actionLoading, setActionLoading] = useState(false);
  const [govStatus, setGovStatus] = useState({
    mode: 'dev',
    gateState: 'paused',
    emergencyKillswitch: false,
    counts: { total: 0, active: 0, paused: 0, completed: 0, rejected: 0, dead_letter: 0, p1_urgent: 0, p2_standard: 0, p3_backfill: 0 },
    watermark: 'NORMAL',
    thermalPacing: 'Nominal',
    concurrency: 1
  });

  const [scannerPaused, setScannerPaused] = useState(false);
  const [scannerLoading, setScannerLoading] = useState(false);

  const fetchData = async () => {
    try {
      const [queueData, assocData, statusData, scannerRes] = await Promise.all([
        getQueue(),
        getAssociates(),
        getGovernorStatus().catch(() => null),
        getScannerStatus().catch(() => null)
      ]);
      setQueue(queueData || []);
      setAssociates(assocData || []);
      if (statusData) setGovStatus(statusData);
      if (scannerRes?.status?.paused !== undefined) {
        setScannerPaused(scannerRes.status.paused);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, []);

  // Gate actions
  const gateAction = async (action, label) => {
    setActionLoading(true);
    try {
      const res = await action();
      toast.success(label, { description: res?.message || 'Done' });
      fetchData();
    } catch (err) {
      toast.error(`Failed: ${label}`, { description: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetry = async (id) => {
    try {
      await retryQueueItem(id);
      toast.success("Queued for retry");
      fetchData();
    } catch (err) {
      toast.error("Retry failed", { description: err.message });
    }
  };

  const handleToggleScanner = async () => {
    setScannerLoading(true);
    try {
      if (scannerPaused) {
        await resumeScanner();
        setScannerPaused(false);
        toast.success("Auto-Queuing resumed", { description: "Scanner will periodically fetch from LeadSquared" });
      } else {
        await pauseScanner();
        setScannerPaused(true);
        toast.info("Auto-Queuing paused", { description: "Automatic ingestion halted" });
      }
      fetchData();
    } catch (err) {
      toast.error("Failed to toggle auto-queuing", { description: err.message });
    } finally {
      setScannerLoading(false);
    }
  };

  const handleToggleKillswitch = async () => {
    setActionLoading(true);
    try {
      const res = await toggleGovernorKillswitch(!govStatus.emergencyKillswitch);
      toast[res?.enabled ? 'error' : 'success'](
        res?.enabled ? "Killswitch ACTIVATED" : "Killswitch deactivated"
      );
      fetchData();
    } catch (err) {
      toast.error("Killswitch failed", { description: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Priority logic — call_type overrides DB default
  const getEffectivePriority = (item) => {
    if (item.call_type === 'Video Demo' || item.source_type === 'google_meet') return 1;
    if (item.priority === 3) return 3;
    return 2;
  };

  // Tab filters
  const p1Items = queue.filter(q => getEffectivePriority(q) === 1);
  const p2Items = queue.filter(q => getEffectivePriority(q) === 2 && q.status !== 'dead_letter');
  const p3Items = queue.filter(q => getEffectivePriority(q) === 3 && q.status !== 'dead_letter');
  const dlqItems = queue.filter(q => q.status === 'dead_letter' || (q.attempt_count && q.attempt_count >= 3));

  let filteredQueue = queue;
  if (activeTab === 'p1') filteredQueue = p1Items;
  else if (activeTab === 'p2') filteredQueue = p2Items;
  else if (activeTab === 'p3') filteredQueue = p3Items;
  else if (activeTab === 'dlq') filteredQueue = dlqItems;

  const isDev = govStatus.mode === 'dev';
  const isRunning = govStatus.gateState === 'running';

  // Clean status rendering — dot + text, no clutter
  const getStatusDisplay = (item) => {
    const s = item.status || '';

    if (s === 'completed') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Completed
      </span>
    );
    if (s === 'ready_for_qc') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" /> Ready for QC
      </span>
    );
    if (s === 'failed') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Failed
      </span>
    );
    if (s === 'dead_letter') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 font-semibold">
        <span className="w-1.5 h-1.5 rounded-full bg-red-600" /> Quarantined
      </span>
    );
    if (s === 'rejected') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" /> Rejected
      </span>
    );
    if (s === 'paused') return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Paused
      </span>
    );
    if (s === 'pending' || s === 'pending_manual_review') return (
      <span className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium",
        item.is_gated_admitted ? "text-emerald-600" : "text-amber-600"
      )}>
        <span className={cn("w-1.5 h-1.5 rounded-full", item.is_gated_admitted ? "bg-emerald-500" : "bg-amber-500")} />
        {item.is_gated_admitted ? 'Admitted' : 'Pending'}
      </span>
    );

    // Active processing — show progress
    const msg = s.toLowerCase();
    let label = 'Processing';
    if (msg.includes('diarization') || msg.includes('merg')) label = 'Diarization';
    else if (msg.includes('transcrib') || msg.includes('saving') || msg.includes('insert')) label = 'Transcribing';
    else if (msg.includes('qc') || msg.includes('evaluat')) label = 'Evaluating';
    else if (msg.includes('download') || msg.includes('convert') || msg.includes('load')) label = 'Preparing';

    let pct = null;
    if (msg.includes('transcribing segment')) {
      const match = msg.match(/(\d+)\/(\d+)/);
      if (match) pct = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
    }

    return (
      <div className="flex items-center gap-2 min-w-[120px]">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
        <div className="flex flex-col gap-0.5 flex-1">
          <span className="text-xs font-medium text-primary">{label}</span>
          <div className="h-1 bg-muted rounded-full overflow-hidden w-full">
            {pct !== null ? (
              <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
            ) : (
              <div className="h-full bg-primary/60 rounded-full w-full animate-pulse" />
            )}
          </div>
        </div>
        {pct !== null && <span className="text-[10px] font-mono text-muted-foreground">{pct}%</span>}
      </div>
    );
  };

  const getPriorityLabel = (item) => {
    const p = getEffectivePriority(item);
    if (p === 1) return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-600">
        <Video className="w-3 h-3" /> P1
      </span>
    );
    if (p === 3) return (
      <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
        <Database className="w-3 h-3" /> P3
      </span>
    );
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Phone className="w-3 h-3" /> P2
      </span>
    );
  };

  const formatDuration = (sec) => {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const formatTime = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', ' + 
           d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const tabs = [
    { id: 'all', label: 'All', count: queue.length },
    { id: 'p1', label: 'Urgent', count: p1Items.length, color: 'text-rose-600' },
    { id: 'p2', label: 'Standard', count: p2Items.length },
    { id: 'p3', label: 'Backfill', count: p3Items.length },
    { id: 'dlq', label: 'Dead Letter', count: dlqItems.length, color: 'text-red-600', right: true },
  ];

  return (
    <div className="flex flex-col h-full gap-4">
      {/* ── HEADER ── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Processing Queue</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isDev ? 'Dev · Serial · Gated' : 'Prod · Parallel · Autonomous'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="ghost"
            size="sm"
            onClick={() => { setLoading(true); fetchData(); }}
            className="gap-1.5 text-muted-foreground"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* ── CONTROLS BAR ── */}
      <div className="flex items-center justify-between gap-4 py-2 px-3 bg-muted/40 rounded-lg border">
        {isDev ? (
          <>
            <div className="flex items-center gap-1.5">
              <Button 
                size="sm" 
                onClick={() => gateAction(playQueueGate, 'Queue started')} 
                disabled={actionLoading || isRunning}
                className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
              >
                <Play className="w-3 h-3 fill-current" /> Run
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => gateAction(pauseQueueGate, 'Queue paused')} 
                disabled={actionLoading || !isRunning}
                className="h-7 px-3 text-xs gap-1"
              >
                <Pause className="w-3 h-3" /> Pause
              </Button>
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => gateAction(stepQueueGate, 'Processing 1 file')} 
                disabled={actionLoading}
                className="h-7 px-3 text-xs gap-1"
              >
                <FastForward className="w-3 h-3" /> Step
              </Button>
              <div className="w-px h-5 bg-border mx-1" />
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => gateAction(() => clearQueueGate(['completed', 'rejected']), 'Cleared')} 
                disabled={actionLoading}
                className="h-7 px-3 text-xs text-muted-foreground gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear Done
              </Button>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full", isRunning ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                {isRunning ? 'Running' : 'Paused'}
              </span>
              <span>Serial</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Autonomous
              </span>
              <span className="text-xs text-muted-foreground">4 workers · {govStatus.watermark}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button 
                size="sm" 
                variant={scannerPaused ? "default" : "outline"}
                onClick={handleToggleScanner}
                disabled={scannerLoading}
                className={cn(
                  "h-7 px-3 text-xs gap-1.5 transition-colors",
                  scannerPaused 
                    ? "bg-amber-600 hover:bg-amber-700 text-white font-medium" 
                    : "text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800"
                )}
              >
                {scannerLoading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : scannerPaused ? (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    Resume Queuing
                  </>
                ) : (
                  <>
                    <Pause className="w-3 h-3" />
                    Pause Queuing
                  </>
                )}
              </Button>
              <Button 
                size="sm" 
                variant={govStatus.emergencyKillswitch ? "destructive" : "outline"}
                onClick={handleToggleKillswitch}
                disabled={actionLoading}
                className={cn("h-7 px-3 text-xs gap-1", govStatus.emergencyKillswitch && "animate-pulse")}
              >
                <ShieldAlert className="w-3 h-3" />
                {govStatus.emergencyKillswitch ? "Kill Active" : "Killswitch"}
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={() => gateAction(() => clearQueueGate(['completed', 'rejected']), 'Cleared')}
                className="h-7 px-3 text-xs text-muted-foreground gap-1"
              >
                <Trash2 className="w-3 h-3" /> Clear
              </Button>
            </div>
          </>
        )}
      </div>

      {/* Batch QC Control */}
      <BatchQCControl onBatchComplete={fetchData} />

      {/* ── TAB BAR ── */}
      <div className="flex items-center gap-1 border-b">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px",
              tab.right && "ml-auto",
              activeTab === tab.id 
                ? "border-foreground text-foreground" 
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
            )}
          >
            <span className={tab.color}>{tab.label}</span>
            {tab.count > 0 && (
              <span className={cn(
                "ml-1.5 text-[10px] font-mono px-1.5 py-0.5 rounded-full",
                activeTab === tab.id ? "bg-foreground/10" : "bg-muted"
              )}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── TABLE ── */}
      <Card className="flex-1 flex flex-col min-h-0 border shadow-none">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/30 sticky top-0 z-10">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[140px]">Added</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[60px]">Pri</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Lead</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Associate</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[90px]">Type</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[80px]">Duration</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-[160px]">Status</TableHead>
                  <TableHead className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-40 text-center text-muted-foreground">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-muted-foreground" />
                      <span className="text-sm">Loading…</span>
                    </TableCell>
                  </TableRow>
                ) : filteredQueue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-40 text-center text-sm text-muted-foreground">
                      {activeTab === 'dlq' ? 'No quarantined items.' : 'No items match this filter.'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredQueue.map((item) => {
                    const assoc = associates.find(a => a.emp_number === item.emp_number);
                    const isDLQ = item.status === 'dead_letter' || (item.attempt_count && item.attempt_count >= 3);
                    const isFailed = item.status === 'failed';
                    
                    return (
                      <TableRow 
                        key={item.id} 
                        className={cn(
                          "cursor-pointer group",
                          isDLQ && "bg-red-50/50 dark:bg-red-950/10",
                          isFailed && "bg-red-50/30 dark:bg-red-950/5"
                        )} 
                        onClick={() => { if (onRunStart) onRunStart(item.id); }}
                      >
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatTime(item.created_at)}
                        </TableCell>
                        <TableCell>
                          {getPriorityLabel(item)}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-sm font-medium truncate max-w-[160px]" title={item.prospect_name || 'Unknown'}>
                              {item.prospect_name || 'Unknown'}
                            </span>
                            <span className="text-[10px] text-muted-foreground/50 font-mono truncate max-w-[160px]" title={item.call_id}>
                              {item.call_id}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {assoc ? assoc.emp_name : (item.emp_number || '—')}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground uppercase tracking-wide">
                            {item.call_type || '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">
                          {formatDuration(item.duration)}
                        </TableCell>
                        <TableCell>
                          {getStatusDisplay(item)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            {(isDLQ || isFailed) && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/20" 
                                onClick={async (e) => { e.stopPropagation(); await handleRetry(item.id); }} 
                                title="Retry"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                              </Button>
                            )}
                            
                            {isDev && item.status === 'paused' && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-7 w-7 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/20" 
                                onClick={async (e) => { e.stopPropagation(); await sendToQC(item.id); fetchData(); }} 
                                title="Admit"
                              >
                                <Play className="w-3.5 h-3.5 fill-current" />
                              </Button>
                            )}

                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-muted-foreground hover:text-foreground" 
                              onClick={async (e) => { e.stopPropagation(); await bumpQueueItem(item.id); fetchData(); }} 
                              title="Bump"
                            >
                              <ArrowUp className="w-3.5 h-3.5" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10" 
                              onClick={async (e) => { e.stopPropagation(); await deleteQueueItem(item.id); fetchData(); }} 
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
