import { useState, useEffect } from 'react';
import { getQCLeads, seedQCDemo } from '../api';
import { ArrowLeft, Users, Activity, TrendingUp, TrendingDown, Minus, Calendar, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import OverviewDashboard from './OverviewDashboard';

function scoreColor(score) {
  if (score >= 80) return 'text-emerald-500';
  if (score >= 60) return 'text-amber-500';
  return 'text-destructive';
}

function scoreBgColor(score) {
  if (score >= 80) return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20';
  if (score >= 60) return 'bg-amber-500/10 text-amber-700 border-amber-500/20';
  return 'bg-destructive/10 text-destructive border-destructive/20';
}

export default function LeadsDashboard({ owner, onSelectLead, onBack }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeads();
  }, [owner]);

  const loadLeads = () => {
    setLoading(true);
    getQCLeads()
      .then(data => {
        if (data?.error) {
          console.error("Backend error:", data.error);
        }
        let fetchedLeads = Array.isArray(data) ? data : [];
        // If an owner was passed, ideally the API would filter it, but we can filter on the client for now 
        // assuming `owner` string matches `emp_name` or similar, but the backend doesn't officially tie leads to owners yet.
        // For demo purposes, if owner is passed, we just show all leads but act like they belong to them, 
        // OR we just display them. The screenshot requirement dictates this view.
        setLeads(fetchedLeads);
        setLoading(false);
      })
      .catch(e => {
        console.error("Failed to load leads", e);
        setLoading(false);
      });
  };

  const handleSeed = async () => {
    await seedQCDemo();
    loadLeads();
  };

  const getIntentBadge = (score) => {
    if (score == null) return <Badge variant="outline" className="text-muted-foreground bg-muted/50 font-medium text-[11px] px-2.5 py-0.5 rounded-full">Pending</Badge>;
    if (score >= 80) return <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-transparent shadow-none font-medium text-[11px] px-2.5 py-0.5 rounded-full transition-colors"><TrendingUp className="w-3 h-3 mr-1" /> High Intent</Badge>;
    if (score >= 50) return <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 border-transparent shadow-none font-medium text-[11px] px-2.5 py-0.5 rounded-full transition-colors"><Minus className="w-3 h-3 mr-1" /> Moderate</Badge>;
    return <Badge variant="destructive" className="bg-destructive/15 text-destructive hover:bg-destructive/25 border-transparent shadow-none font-medium text-[11px] px-2.5 py-0.5 rounded-full transition-colors"><TrendingDown className="w-3 h-3 mr-1" /> Low Intent</Badge>;
  }

  // Format date for "Last Conversation" (mocking it using created_at of last call, or just a static format for demo if missing)
  const formatDate = (isoString) => {
    if (!isoString) return '—';
    const d = new Date(isoString);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, ' ');
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            {onBack && (
              <Button variant="outline" size="icon" onClick={onBack} className="h-8 w-8 rounded-full shadow-sm text-muted-foreground hover:text-foreground transition-all hover:-translate-x-0.5">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            )}
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Leads {owner ? `for ${owner.emp_name}` : ''}</h2>
          </div>
          <p className="text-muted-foreground text-sm ml-11">Overview of pipeline and conversion predictions based on call history</p>
        </div>
        <Button variant="outline" onClick={handleSeed} className="gap-2 shadow-sm hover:shadow-md transition-all rounded-full px-5">
          <Activity className="w-4 h-4 text-primary" /> Seed Demo Lead
        </Button>
      </div>

      {!loading && leads.length > 0 && <OverviewDashboard leads={leads} />}

      <Card className="flex-1 flex flex-col min-h-0 shadow-md border-border/50 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/30 sticky top-0 z-10 text-xs uppercase tracking-wider text-muted-foreground">
                <TableRow className="border-b-border/50">
                  <TableHead className="px-6 py-4 font-semibold">Name</TableHead>
                  <TableHead className="font-semibold">Conversations</TableHead>
                  <TableHead className="font-semibold">Last Conversation</TableHead>
                  <TableHead className="max-w-[200px] font-semibold">Next Task Due Date</TableHead>
                  <TableHead className="font-semibold">Conversation owner</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Intent</TableHead>
                  <TableHead className="text-right px-6 font-semibold">Quality Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={8} className="h-48 text-center text-muted-foreground">Loading leads...</TableCell></TableRow>
                ) : leads.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="h-48 text-center text-muted-foreground">No leads found. Click "Seed Demo Lead".</TableCell></TableRow>
                ) : (
                  leads.map((l) => {
                    const callCount = l.calls?.length || l.total_calls || 0;
                    const lastCallDate = l.calls?.length > 0 ? l.calls[l.calls.length - 1].created_at : null;
                    const qs = l.avg_call_quality_score;
                    const intent = l.intent_score;

                    return (
                      <TableRow
                        key={l.id}
                        className="cursor-pointer hover:bg-muted/30 transition-all group border-b-border/50"
                        onClick={() => onSelectLead(l.id)}
                      >
                        <TableCell className="px-6 py-4 font-semibold text-sm group-hover:text-primary transition-colors">
                          {l.name}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                          {callCount} Conversations
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(lastCallDate)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={l.next_process_step}>
                          {l.next_process_step || '—'}
                        </TableCell>
                        <TableCell className="text-sm font-medium flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] uppercase shadow-sm">
                            {(owner?.emp_name || l.owner || 'U').substring(0, 1)}
                          </div>
                          <span className="text-muted-foreground">{owner?.emp_name || l.owner || 'Unassigned'}</span>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          In-Progress Calls
                        </TableCell>
                        <TableCell>
                          {getIntentBadge(intent)}
                        </TableCell>
                        <TableCell className="text-right px-6">
                          {qs != null ? (
                            <div className="flex items-center justify-end gap-2">
                              <span className={cn("text-sm font-bold", scoreColor(qs))}>{qs}%</span>
                              <div className="w-6 h-6 rounded-full border-2 flex items-center justify-center" style={{ borderColor: qs >= 80 ? '#10b981' : qs >= 60 ? '#f59e0b' : '#ef4444' }}>
                                {qs >= 80 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-destructive" />}
                              </div>
                            </div>
                          ) : <span className="text-muted-foreground text-sm">—</span>}
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
