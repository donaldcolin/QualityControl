import { useState, useEffect } from 'react';
import { getQCLeads, seedQCDemo } from '../api';
import { ArrowLeft, Users, Activity, TrendingUp, TrendingDown, Minus, Calendar, CheckCircle2, Star } from 'lucide-react';
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
        if (owner) {
          fetchedLeads = fetchedLeads.filter(l => l.owner === owner.emp_name);
        }
        setLeads(fetchedLeads);
        setLoading(false);
      })
      .catch(e => {
        console.error("Failed to load leads", e);
        setLoading(false);
      });
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
                  <TableHead className="font-semibold">Conversation owner</TableHead>
                  <TableHead className="font-semibold">Status</TableHead>
                  <TableHead className="font-semibold">Intent</TableHead>
                  <TableHead className="text-right px-6 font-semibold">Quality Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="h-48 text-center text-muted-foreground">Loading leads...</TableCell></TableRow>
                ) : leads.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-48 text-center text-muted-foreground">No leads found.</TableCell></TableRow>
                ) : (
                  leads.map((l) => {
                    const callCount = l.calls?.length || l.total_calls || 0;
                    const lastCallDate = l.calls?.length > 0 ? l.calls[l.calls.length - 1].created_at : null;
                    const qs = l.avg_call_quality_score;
                    const intent = l.intent_score;

                    const sqlStatus = (() => {
                      const allFields = [
                        ...(l.data_capture?.extracted_fields || []),
                        ...((l.calls || []).flatMap(c => c.insights_data?.data_capture?.extracted_fields || []))
                      ];
                      if (l.stream && !allFields.some(f => (f.field || '').toLowerCase().includes('stream'))) {
                        allFields.push({ field: 'Stream', value: l.stream });
                      }

                      const isScienceOrMathStream = (str) => {
                        if (!str) return false;
                        const s = String(str).toLowerCase();
                        return (
                          s.includes('pcm') ||
                          s.includes('pcmc') ||
                          s.includes('pcmb') ||
                          s.includes('mpc') ||
                          s.includes('pcms') ||
                          s.includes('pmcs') ||
                          s.includes('science') ||
                          s.includes('bio-math') ||
                          s.includes('biomath') ||
                          s.includes('bio math') ||
                          s.includes('biology-math') ||
                          s.includes('biology math') ||
                          s.includes('biology-mathematics') ||
                          s.includes('biology mathematics') ||
                          s.includes('biology with math') ||
                          s.includes('biology and math') ||
                          s.includes('biology') ||
                          s.includes('bio') ||
                          s.includes('math') ||
                          s.includes('computer') ||
                          s.includes('cs') ||
                          s.includes('bpc') ||
                          s.includes('non-medical') ||
                          s.includes('non medical')
                        );
                      };

                      const is12th = (grade) => {
                        if (!grade) return false;
                        const g = String(grade).toLowerCase();
                        return g.includes('12') || g.includes('twelfth') || g.includes('xii') || g.includes('plus two') || g.includes('+2');
                      };

                      const gradeFields = allFields.filter(f => f.field.toLowerCase().includes('grade') || f.field.toLowerCase().includes('class'));
                      const streamFields = allFields.filter(f => f.field.toLowerCase().includes('stream') || f.field.toLowerCase().includes('group') || f.field.toLowerCase().includes('subject'));

                      const notMentionedKeywords = ['not mentioned', 'n/a', 'none', 'null', 'unknown', ''];
                      const validGrade = gradeFields.find(f => !notMentionedKeywords.includes(String(f.value).toLowerCase().trim()));
                      const validStream = streamFields.find(f => !notMentionedKeywords.includes(String(f.value).toLowerCase().trim()));

                      if (validGrade && validStream) {
                        const is12 = is12th(validGrade.value);
                        const isPCM = isScienceOrMathStream(validStream.value);
                        return (is12 && isPCM) ? 'SQL' : 'No SQL';
                      }

                      // Fallback for V3 Video Calls or Phone Calls with quality_data
                      for (const call of (l.calls || [])) {
                        const qData = call.quality_data || {};
                        const classParam = qData['Class, Stream, Board and Location Captured'] || qData['DP-04'];
                        if (classParam && classParam.reason) {
                          const reason = classParam.reason.toLowerCase();
                          const is12 = is12th(reason);
                          const isPCM = isScienceOrMathStream(reason);
                          if (is12 || isPCM) {
                            return (is12 && isPCM) ? 'SQL' : 'No SQL';
                          }
                        }
                      }

                      return 'Not Mentioned';
                    })();

                    return (
                      <TableRow
                        key={l.id}
                        className="cursor-pointer hover:bg-muted/30 transition-all group border-b-border/50"
                        onClick={() => onSelectLead(l.id)}
                      >
                        <TableCell className="px-6 py-4 font-semibold text-sm group-hover:text-primary transition-colors flex items-center gap-2">
                          {l.name}
                          {sqlStatus === 'SQL' && (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200 py-0 h-5 px-1.5 text-[10px]">
                              <Star className="w-2.5 h-2.5 mr-1 fill-emerald-500" /> SQL
                            </Badge>
                          )}
                          {sqlStatus === 'No SQL' && (
                            <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-200 border-rose-200 py-0 h-5 px-1.5 text-[10px]">
                              No SQL
                            </Badge>
                          )}
                          {sqlStatus === 'Not Mentioned' && (
                            <Badge className="bg-slate-100 text-slate-500 hover:bg-slate-200 border-slate-200 py-0 h-5 px-1.5 text-[10px]">
                              Not Mentioned
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors">
                          {callCount} Conversations
                        </TableCell>
                        <TableCell className="text-sm font-medium flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-[10px] uppercase shadow-sm">
                            {(l.owner || 'U').substring(0, 1)}
                          </div>
                          <span className="text-muted-foreground">{l.owner || 'Unassigned'}</span>
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
