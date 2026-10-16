import { useState, useEffect } from 'react';
import { getQueue, getAssociates, sendToQC, bumpQueueItem, deleteQueueItem } from '../api';
import { Clock, RefreshCw, CheckCircle2, XCircle, Loader2, Play, ArrowUp, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import QCModeToggle from './QCModeToggle';
import BatchQCControl from './BatchQCControl';

export default function QueueView({ onRunStart }) {
  const [queue, setQueue] = useState([]);
  const [associates, setAssociates] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [queueData, assocData] = await Promise.all([
        getQueue(),
        getAssociates()
      ]);
      setQueue(queueData || []);
      setAssociates(assocData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(() => {
      getQueue().then(data => setQueue(data || []));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (status) => {
    if (status === 'completed') return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Completed</Badge>;
    if (status === 'ready_for_qc') return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 hover:bg-blue-500/20 border-blue-200"><Clock className="w-3 h-3 mr-1" /> Ready for Batch QC</Badge>;
    if (status === 'failed') return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    if (status === 'pending' || status === 'pending_manual_review') return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-200"><Clock className="w-3 h-3 mr-1" /> {status}</Badge>;
    
    // Process-oriented Active Status
    const msg = (status || '').toLowerCase();
    const steps = [
      { id: 1, label: 'Preparation', activeTerms: ['initializ', 'download', 'load', 'convert', 'trim'] },
      { id: 2, label: 'Speaker Diarization', activeTerms: ['diarization', 'merg'] },
      { id: 3, label: 'ASR Transcription', activeTerms: ['transcrib', 'saving', 'insert', 'saved'] },
      { id: 4, label: 'QC AI Evaluation', activeTerms: ['qc', 'evaluat'] }
    ];

    let currentLabel = "Processing";
    let progressPct = null;

    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].activeTerms.some(term => msg.includes(term))) {
        currentLabel = steps[i].label;
        break;
      }
    }

    if (msg.includes('transcribing segment')) {
      const match = msg.match(/(\d+)\/(\d+)/);
      if (match) {
        progressPct = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
      }
    }

    return (
      <Badge variant="secondary" className="text-primary border-primary/20 flex items-center gap-2 py-1 px-3 w-48 shadow-sm justify-start">
        <Loader2 className="w-4 h-4 animate-spin shrink-0" /> 
        <div className="flex flex-col w-full text-left">
          <span className="text-[10px] font-bold uppercase tracking-wider truncate leading-tight">{currentLabel}</span>
          <div className="flex items-center gap-2 w-full">
            <div className="flex-1 h-1.5 bg-primary/20 rounded-full overflow-hidden shrink-0 mt-0.5">
              {progressPct !== null ? (
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progressPct}%` }} />
              ) : (
                <div className="h-full bg-primary w-full animate-pulse" />
              )}
            </div>
            {progressPct !== null && <span className="text-[9px] font-mono leading-none">{progressPct}%</span>}
          </div>
        </div>
      </Badge>
    );
  };

  const formatDuration = (sec) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Processing Queue</h2>
          <p className="text-muted-foreground text-sm mt-1">
            Live monitor of audio files being processed by the AI pipeline.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <QCModeToggle />
          <Button 
            variant="outline"
            size="sm"
            onClick={() => { setLoading(true); fetchData(); }}
            className="gap-2"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* 2-HOUR BATCH QC & AUTOPILOT CONTROLLER */}
      <BatchQCControl onBatchComplete={fetchData} />

      <Card className="flex-1 flex flex-col min-h-0 shadow-sm">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="px-6 py-4">Time Added</TableHead>
                  <TableHead>Lead</TableHead>
                  <TableHead>Associate Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right px-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                        Loading queue data...
                      </div>
                    </TableCell>
                  </TableRow>
                ) : queue.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center text-muted-foreground">
                      The queue is currently empty. Push calls from the Team QC tab.
                    </TableCell>
                  </TableRow>
                ) : (
                  queue.map((item) => {
                    const assoc = associates.find(a => a.emp_number === item.emp_number);
                    return (
                      <TableRow 
                        key={item.id} 
                        className="cursor-pointer hover:bg-muted/50" 
                        onClick={() => { if (onRunStart) onRunStart(item.id); }}
                      >
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-6">
                          {new Date(item.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-medium text-sm truncate max-w-[150px]" title={item.prospect_name || 'Unknown Lead'}>
                              {item.prospect_name || 'Unknown Lead'}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground opacity-50 truncate max-w-[150px]" title={item.call_id}>
                              {item.call_id}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {assoc ? assoc.emp_name : (item.emp_number || 'Unknown')}
                        </TableCell>
                        <TableCell>
                          {item.call_type ? (
                            <Badge variant={item.call_type === 'Outbound' ? 'default' : 'secondary'} className="text-[10px] font-semibold tracking-wide uppercase">
                              {item.call_type}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground opacity-50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDuration(item.duration)}
                        </TableCell>
                        <TableCell>
                          {getStatusBadge(item.status)}
                        </TableCell>
                        <TableCell className="text-right px-6">
                          <div className="flex justify-end gap-2">
                            {item.status === 'pending' && (
                              <Button variant="outline" size="icon" className="h-8 w-8 text-primary hover:bg-primary/10" onClick={async (e) => { e.stopPropagation(); await sendToQC(item.id); if (onRunStart) onRunStart(item.id); fetchData(); }} title="Send to ASR">
                                <Play className="w-4 h-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={async (e) => { e.stopPropagation(); await bumpQueueItem(item.id); fetchData(); }} title="Bump Priority">
                              <ArrowUp className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={async (e) => { e.stopPropagation(); await deleteQueueItem(item.id); fetchData(); }} title="Delete">
                              <Trash2 className="w-4 h-4" />
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
