import { useState, useEffect } from 'react';
import { getQCLeads, seedQCDemo } from '../api';
import { Users, Activity, TrendingUp, TrendingDown, HelpCircle, ChevronRight, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function LeadsDashboard({ onSelectLead }) {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLeads();
  }, []);

  const loadLeads = () => {
    setLoading(true);
    getQCLeads()
      .then(data => {
         if (!data.error) setLeads(data);
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

  const getPredictionIcon = (prediction) => {
    if (prediction === true) return <TrendingUp className="w-4 h-4 text-emerald-500" />;
    if (prediction === false) return <TrendingDown className="w-4 h-4 text-destructive" />;
    return <HelpCircle className="w-4 h-4 text-muted-foreground" />;
  };

  const getPredictionBadge = (prediction) => {
    if (prediction === true) return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200">Will Pay</Badge>;
    if (prediction === false) return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20">Unlikely to Pay</Badge>;
    return <Badge variant="outline" className="text-muted-foreground bg-muted">Pending Evaluation</Badge>;
  }

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Leads Intelligence</h2>
          <p className="text-muted-foreground text-sm mt-1">Overview of Lead Conversion Predictions based on Call History</p>
        </div>
        <Button 
          variant="outline"
          onClick={handleSeed}
          className="gap-2"
        >
          <Activity className="w-4 h-4" />
          Seed Demo Lead
        </Button>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 shadow-sm">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="px-6 py-4">Lead Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Calls Logged</TableHead>
                  <TableHead>Intelligence Prediction</TableHead>
                  <TableHead className="text-right px-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                      Loading leads... (Is Supabase connected?)
                    </TableCell>
                  </TableRow>
                ) : leads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center text-muted-foreground">
                      No leads found. Click "Seed Demo Lead" to generate test data.
                    </TableCell>
                  </TableRow>
                ) : (
                  leads.map((l) => (
                    <TableRow 
                      key={l.id} 
                      className="cursor-pointer hover:bg-muted/50 transition-colors"
                      onClick={() => onSelectLead(l.id)}
                    >
                      <TableCell className="px-6 font-medium">
                        <div className="flex items-center gap-2">
                          <Users className="w-4 h-4 text-primary shrink-0" />
                          {l.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{l.phone || '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {l.total_calls} calls
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getPredictionIcon(l.overall_prediction)}
                          {getPredictionBadge(l.overall_prediction)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary">
                          <ChevronRight className="w-4 h-4" />
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
