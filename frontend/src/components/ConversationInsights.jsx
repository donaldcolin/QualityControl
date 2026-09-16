import { useState, useEffect } from 'react';
import { getAssociates, seedQCDemo } from '../api';
import { Users, ChevronRight, Activity, Target } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ConversationInsights({ onSelectOwner }) {
  const [owners, setOwners] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadOwners();
  }, []);

  const loadOwners = () => {
    setLoading(true);
    getAssociates().then(data => {
      setOwners(data || []);
      setLoading(false);
    }).catch(e => {
      console.error(e);
      setLoading(false);
    });
  };

  const handleSeed = async () => {
    await seedQCDemo();
    loadOwners();
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Conversations Insights</h2>
          <p className="text-muted-foreground text-sm mt-1">Select a Lead Owner to view their pipeline and conversation insights.</p>
        </div>
        <Button variant="outline" onClick={handleSeed} className="gap-2">
          <Activity className="w-4 h-4" /> Seed Demo Data
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-2">
        <Card className="bg-primary/5 border-primary/20 shadow-sm">
           <CardContent className="p-6">
              <div className="flex items-center gap-4">
                 <div className="p-3 bg-primary/10 rounded-full text-primary"><Users className="w-6 h-6"/></div>
                 <div>
                    <div className="text-3xl font-bold">{owners.length}</div>
                    <div className="text-sm font-medium text-muted-foreground">Active Lead Owners</div>
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
