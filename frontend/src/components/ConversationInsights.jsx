import { useState, useEffect } from 'react';
import { getAssociates, getDashboardKPIs, seedQCDemo } from '../api';
import { Users, ChevronRight, Activity, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ConversationInsights({ onSelectOwner }) {
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState({
    active_associates: 0,
    avg_qc_score: null,
    avg_talk_listen: '50:50',
    calls_today: 0
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    setLoading(true);
    Promise.allSettled([getAssociates(), getDashboardKPIs()])
      .then(([assocResult, kpiResult]) => {
        if (assocResult.status === 'fulfilled' && Array.isArray(assocResult.value)) {
          setOwners(assocResult.value);
        }
        if (kpiResult.status === 'fulfilled' && kpiResult.value && !kpiResult.value.error) {
          setKpis(kpiResult.value);
        }
        setLoading(false);
      })
      .catch(e => {
        console.error(e);
        setLoading(false);
      });
  };


  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Conversations Insights</h2>
          <p className="text-muted-foreground text-sm mt-1">Select a Lead Owner to view their pipeline and conversation insights.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-2">
        <Card className="bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border-indigo-500/20 shadow-sm relative overflow-hidden">
           <div className="absolute -right-4 -top-4 w-24 h-24 bg-indigo-500/10 rounded-full blur-xl"></div>
           <CardContent className="p-5">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-indigo-500/10 rounded-xl text-indigo-600 shadow-inner"><Users className="w-5 h-5"/></div>
                 <div>
                    <div className="text-2xl font-black text-slate-800">{kpis.active_associates || owners.length}</div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-0.5">Active Associates</div>
                 </div>
              </div>
           </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20 shadow-sm relative overflow-hidden">
           <div className="absolute -right-4 -top-4 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl"></div>
           <CardContent className="p-5">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-600 shadow-inner"><Target className="w-5 h-5"/></div>
                 <div>
                    <div className="text-2xl font-black text-slate-800">
                      {kpis.avg_qc_score != null && kpis.avg_qc_score > 0 ? `${kpis.avg_qc_score}%` : 'N/A'}
                    </div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-0.5">Avg QC Score</div>
                 </div>
              </div>
           </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20 shadow-sm relative overflow-hidden">
           <div className="absolute -right-4 -top-4 w-24 h-24 bg-amber-500/10 rounded-full blur-xl"></div>
           <CardContent className="p-5">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-amber-500/10 rounded-xl text-amber-600 shadow-inner"><Activity className="w-5 h-5"/></div>
                 <div>
                    <div className="text-2xl font-black text-slate-800">{kpis.avg_talk_listen || '50:50'}</div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-0.5">Avg Talk:Listen</div>
                 </div>
              </div>
           </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-rose-500/10 to-pink-500/10 border-rose-500/20 shadow-sm relative overflow-hidden">
           <div className="absolute -right-4 -top-4 w-24 h-24 bg-rose-500/10 rounded-full blur-xl"></div>
           <CardContent className="p-5">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-rose-500/10 rounded-xl text-rose-600 shadow-inner"><Activity className="w-5 h-5"/></div>
                 <div>
                    <div className="text-2xl font-black text-slate-800">{kpis.calls_today ?? 0}</div>
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mt-0.5">Calls Analyzed Today</div>
                 </div>
              </div>
           </CardContent>
        </Card>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 shadow-md border-border/50 rounded-xl overflow-hidden bg-background/50 backdrop-blur-sm">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/30 sticky top-0 z-10 text-xs uppercase tracking-wider text-muted-foreground">
                <TableRow className="border-b-border/50">
                  <TableHead className="px-6 py-4 font-semibold">Lead Owner (Associate)</TableHead>
                  <TableHead className="font-semibold">Employee ID</TableHead>
                  <TableHead className="font-semibold">Languages</TableHead>
                  <TableHead className="text-right px-6 font-semibold">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={4} className="h-48 text-center text-muted-foreground">Loading owners...</TableCell></TableRow>
                ) : owners.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="h-48 text-center text-muted-foreground">No lead owners found.</TableCell></TableRow>
                ) : (
                  owners.map((owner) => (
                    <TableRow 
                      key={owner.emp_number} 
                      className="cursor-pointer hover:bg-muted/30 transition-all group border-b-border/50"
                      onClick={() => onSelectOwner(owner)}
                    >
                      <TableCell className="px-6 font-semibold py-4 group-hover:text-primary transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm uppercase shadow-sm">
                            {owner.emp_name.substring(0, 2)}
                          </div>
                          {owner.emp_name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{owner.emp_number}</TableCell>
                      <TableCell className="text-muted-foreground text-sm font-medium">{owner.language || 'English'}</TableCell>
                      <TableCell className="text-right px-6">
                        <Button variant="ghost" className="gap-2 text-primary hover:text-primary hover:bg-primary/10 transition-colors rounded-full px-5">
                          View Leads <ChevronRight className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
