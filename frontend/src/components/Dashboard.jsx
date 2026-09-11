import { useState, useEffect } from 'react';
import { getCalls, getAssociates } from '../api';
import { Download, FileAudio, ExternalLink, Play, Search, Star, Clock, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Dashboard({ onSelectCall }) {
  const [calls, setCalls] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getCalls();
      setCalls(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredCalls = calls.filter(c => 
    (c.filename || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.notes || '').toLowerCase().includes(search.toLowerCase())
  );

  const getRatingBadge = (rating) => {
    const r = (rating || '').toLowerCase();
    if (r.includes('good') || r.includes('excellent') || r.includes('high')) {
      return <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200"><Star className="w-3 h-3 mr-1" /> {rating}</Badge>;
    }
    if (r.includes('bad') || r.includes('poor') || r.includes('low')) {
      return <Badge variant="destructive" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20"><Star className="w-3 h-3 mr-1" /> {rating}</Badge>;
    }
    if (r.includes('pending')) {
      return <Badge variant="outline" className="bg-muted text-muted-foreground"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
    return <Badge variant="secondary"><Star className="w-3 h-3 mr-1" /> {rating || 'Unrated'}</Badge>;
  };

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Evaluations Dashboard</h2>
          <p className="text-muted-foreground text-sm mt-1">Overview of all processed calls and QC ratings</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by filename or notes..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button asChild variant="outline" className="gap-2">
            <a href="http://localhost:8000/api/export.csv" target="_blank" rel="noreferrer">
              <Download className="w-4 h-4" />
              Export CSV
            </a>
          </Button>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0 shadow-sm">
        <CardContent className="p-0 flex flex-col flex-1 min-h-0">
          <ScrollArea className="flex-1">
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="px-6 py-4">Filename</TableHead>
                  <TableHead>Language</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Rating</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right px-6">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                      Loading data...
                    </TableCell>
                  </TableRow>
                ) : filteredCalls.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-48 text-center text-muted-foreground">
                      No calls match your criteria.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCalls.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="px-6 font-medium">
                        <div className="flex items-center gap-2">
                          <FileAudio className="w-4 h-4 text-primary shrink-0" />
                          <span className="truncate max-w-[200px]" title={c.filename}>{c.filename}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-mono text-[10px] uppercase tracking-wider">{c.language}</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <div className="flex items-center gap-1.5 text-xs">
                          <Clock className="w-3.5 h-3.5 opacity-70" />
                          {c.duration_sec?.toFixed(1)}s
                        </div>
                      </TableCell>
                      <TableCell>
                        {getRatingBadge(c.rating)}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs max-w-[250px] truncate" title={c.notes}>
                        {c.notes || (
                          <span className="opacity-50 flex items-center gap-1"><FileText className="w-3 h-3" /> No notes provided</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <Button 
                          size="sm"
                          onClick={() => onSelectCall(c.id)}
                          className="gap-1.5 h-8"
                        >
                          Review <ExternalLink className="w-3 h-3" />
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
