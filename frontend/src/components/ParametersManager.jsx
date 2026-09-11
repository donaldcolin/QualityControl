import { useState, useEffect } from 'react';
import { Settings, Plus, Trash2, Save, Edit2, X, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function ParametersManager() {
  const [parameters, setParameters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sourceFilter, setSourceFilter] = useState('phone_call'); // 'phone_call' or 'google_meet'
  
  // Form state
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ category: '', parameter: '', description: '' });

  const fetchParameters = async () => {
    setLoading(true);
    try {
      const res = await fetch(`http://localhost:3000/api/parameters?source=${sourceFilter}`);
      if (res.ok) {
        const data = await res.json();
        setParameters(data);
      }
    } catch (e) {
      console.error("Failed to fetch parameters", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchParameters();
  }, [sourceFilter]);

  const handleSave = async () => {
    if (!formData.category || !formData.parameter || !formData.description) {
      alert("All fields are required.");
      return;
    }

    try {
      const payload = { ...formData, source: sourceFilter };
      let res;
      
      if (editingId) {
        res = await fetch(`http://localhost:3000/api/parameters/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      } else {
        res = await fetch(`http://localhost:3000/api/parameters`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }

      if (res.ok) {
        setFormData({ category: '', parameter: '', description: '' });
        setIsAdding(false);
        setEditingId(null);
        fetchParameters();
      } else {
        alert("Failed to save parameter");
      }
    } catch (e) {
      console.error(e);
      alert("Error saving parameter");
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Are you sure you want to delete this parameter?")) return;
    try {
      const res = await fetch(`http://localhost:3000/api/parameters/${id}`, {
        method: 'DELETE'
      });
      if (res.ok) fetchParameters();
    } catch (e) {
      console.error(e);
      alert("Failed to delete parameter");
    }
  };

  const handleEdit = (param) => {
    setEditingId(param.id);
    setFormData({
      category: param.category,
      parameter: param.parameter,
      description: param.description
    });
    setIsAdding(true);
  };

  const cancelEdit = () => {
    setIsAdding(false);
    setEditingId(null);
    setFormData({ category: '', parameter: '', description: '' });
  };

  // Group parameters by category for better display
  const groupedParameters = parameters.reduce((acc, param) => {
    if (!acc[param.category]) acc[param.category] = [];
    acc[param.category].push(param);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">QC Parameters Engine</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage the specific traits the AI looks for during evaluation.</p>
        </div>
        {!isAdding && (
          <Button onClick={() => setIsAdding(true)} className="gap-2">
            <Plus className="w-4 h-4" /> Add Parameter
          </Button>
        )}
      </div>

      <Tabs value={sourceFilter} onValueChange={setSourceFilter} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="phone_call">Phone Calls</TabsTrigger>
          <TabsTrigger value="google_meet">Video Demos</TabsTrigger>
        </TabsList>

        {isAdding && (
          <Card className="mb-6 border-primary/20 shadow-md">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">{editingId ? 'Edit Parameter' : 'Add New Parameter'}</CardTitle>
              <CardDescription>
                Define a new rule for the AI to check in {sourceFilter === 'phone_call' ? 'phone calls' : 'video demos'}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Category</label>
                  <Input 
                    placeholder="e.g. Greeting, Objection Handling"
                    value={formData.category}
                    onChange={(e) => setFormData({...formData, category: e.target.value})}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium leading-none">Parameter Name</label>
                  <Input 
                    placeholder="e.g. Warm Welcome"
                    value={formData.parameter}
                    onChange={(e) => setFormData({...formData, parameter: e.target.value})}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">Description & Prompt Instructions</label>
                <Textarea 
                  placeholder="Explain exactly what the AI should listen for. The more detailed, the better the AI can evaluate it."
                  rows={3}
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                />
              </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-3 pt-0">
              <Button variant="ghost" onClick={cancelEdit}>Cancel</Button>
              <Button onClick={handleSave} className="gap-2">
                <Save className="w-4 h-4" /> Save Parameter
              </Button>
            </CardFooter>
          </Card>
        )}

        <Card className="flex-1 flex flex-col min-h-0 shadow-sm">
          <CardContent className="p-0 flex flex-col flex-1 min-h-0">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
                <RefreshCw className="w-8 h-8 animate-spin text-primary" />
                <p>Loading parameters...</p>
              </div>
            ) : Object.keys(groupedParameters).length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground p-8">
                <Settings className="w-12 h-12 mb-4 opacity-20" />
                <p className="text-lg font-medium text-foreground">No parameters configured</p>
                <p className="max-w-sm mt-2">Add parameters to define what the AI should evaluate during quality control checks.</p>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-280px)]">
                {Object.entries(groupedParameters).map(([category, params]) => (
                  <div key={category} className="mb-6 last:mb-0">
                    <div className="bg-muted/50 px-6 py-2 border-y sticky top-0 z-10 backdrop-blur-sm">
                      <h3 className="font-semibold text-sm text-foreground/80 flex items-center gap-2">
                        <Badge variant="outline" className="bg-background">{category}</Badge>
                        <span className="text-xs font-normal text-muted-foreground">{params.length} rules</span>
                      </h3>
                    </div>
                    <Table>
                      <TableHeader className="hidden">
                        <TableRow>
                          <TableHead className="w-[200px]">Parameter</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-[100px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {params.map((p) => (
                          <TableRow key={p.id}>
                            <TableCell className="w-[250px] align-top font-medium px-6 py-4">
                              {p.parameter}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-sm align-top py-4">
                              {p.description}
                            </TableCell>
                            <TableCell className="text-right align-top px-6 py-4">
                              <div className="flex justify-end gap-2 opacity-50 hover:opacity-100 transition-opacity">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-primary hover:bg-primary/10" onClick={() => handleEdit(p)}>
                                  <Edit2 className="w-4 h-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10" onClick={() => handleDelete(p.id)}>
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ))}
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </Tabs>
    </div>
  );
}
