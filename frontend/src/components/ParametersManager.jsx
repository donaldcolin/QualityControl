import { useState, useEffect } from 'react';
import { getQCParameters, createQCParameter, updateQCParameter, deleteQCParameter, getDataCaptureQuestions, createDataCaptureQuestion, updateDataCaptureQuestion, deleteDataCaptureQuestion, getPlaybook, updatePlaybook } from '../api';
import { Settings, Plus, Trash2, Save, Edit2, RefreshCw, HelpCircle, CheckSquare, BookOpen } from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('quality_checks'); // 'quality_checks' or 'data_capture'
  const [sourceFilter, setSourceFilter] = useState('phone_call'); // 'phone_call' or 'google_meet'
  
  const [qcParams, setQcParams] = useState([]);
  const [dcQuestions, setDcQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Form state for QC Params
  const [isAddingQC, setIsAddingQC] = useState(false);
  const [editingQCId, setEditingQCId] = useState(null);
  const qcDefaults = { category: '', parameter: '', description: '', check_question: '', max_score: 10, param_id: '', category_weight_pct: 0, scale: '', polarity: 'positive', embedded_breach_flag: false, evidence_required: '' };
  const [qcFormData, setQcFormData] = useState(qcDefaults);

  // Form state for DC Questions
  const [isAddingDC, setIsAddingDC] = useState(false);
  const [editingDCId, setEditingDCId] = useState(null);
  const [dcFormData, setDcFormData] = useState({ category: 'Data Capture', label: '', question: '', description: '' });

  // Playbook state
  const [playbookContent, setPlaybookContent] = useState('');
  const [isSavingPlaybook, setIsSavingPlaybook] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      if (activeTab === 'quality_checks') {
        const data = await getQCParameters(sourceFilter);
        setQcParams(data || []);
      } else if (activeTab === 'data_capture') {
        const data = await getDataCaptureQuestions(sourceFilter);
        setDcQuestions(data || []);
      } else if (activeTab === 'playbook') {
        const data = await getPlaybook();
        setPlaybookContent(data.content || '');
      }
    } catch (e) {
      console.error("Failed to fetch data", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, sourceFilter]);

  // --- QC Handlers ---
  const handleSaveQC = async () => {
    if (!qcFormData.category || !qcFormData.parameter) return alert("Category and Parameter Name are required.");
    const payload = { ...qcFormData, source: sourceFilter };
    try {
      if (editingQCId) await updateQCParameter(editingQCId, payload);
      else await createQCParameter(payload);
      setQcFormData(qcDefaults);
      setIsAddingQC(false);
      setEditingQCId(null);
      fetchData();
    } catch (e) { alert("Error saving"); }
  };

  const handleDeleteQC = async (id) => {
    if (!confirm("Delete this parameter?")) return;
    await deleteQCParameter(id);
    fetchData();
  };

  const handleEditQC = (p) => {
    setEditingQCId(p.id);
    setQcFormData({ category: p.category, parameter: p.parameter, description: p.description, check_question: p.check_question || '', max_score: p.max_score || 10, param_id: p.param_id || '', category_weight_pct: p.category_weight_pct || 0, scale: p.scale || '', polarity: p.polarity || 'positive', embedded_breach_flag: p.embedded_breach_flag || false, evidence_required: p.evidence_required || '' });
    setIsAddingQC(true);
  };

  // --- DC Handlers ---
  const handleSaveDC = async () => {
    if (!dcFormData.label || !dcFormData.question) return alert("Label and Question are required.");
    const payload = { ...dcFormData, source: sourceFilter };
    try {
      if (editingDCId) await updateDataCaptureQuestion(editingDCId, payload);
      else await createDataCaptureQuestion(payload);
      setDcFormData({ category: 'Data Capture', label: '', question: '', description: '' });
      setIsAddingDC(false);
      setEditingDCId(null);
      fetchData();
    } catch (e) { alert("Error saving"); }
  };

  const handleDeleteDC = async (id) => {
    if (!confirm("Delete this question?")) return;
    await deleteDataCaptureQuestion(id);
    fetchData();
  };

  const handleEditDC = (q) => {
    setEditingDCId(q.id);
    setDcFormData({ category: q.category || 'Data Capture', label: q.label, question: q.question, description: q.description || '' });
    setIsAddingDC(true);
  };

  const handleSavePlaybook = async () => {
    setIsSavingPlaybook(true);
    try {
      await updatePlaybook(playbookContent);
      alert("Playbook saved successfully!");
    } catch (e) {
      alert("Error saving playbook");
    } finally {
      setIsSavingPlaybook(false);
    }
  };

  // Grouping
  const groupedQC = qcParams.reduce((acc, p) => {
    acc[p.category] = acc[p.category] || [];
    acc[p.category].push(p);
    return acc;
  }, {});

  const groupedDC = dcQuestions.reduce((acc, q) => {
    acc[q.category || 'Data Capture'] = acc[q.category || 'Data Capture'] || [];
    acc[q.category || 'Data Capture'].push(q);
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full gap-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Configuration Engine</h2>
          <p className="text-muted-foreground text-sm mt-1">Manage quality checks and data capture questions.</p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="quality_checks" className="gap-2"><CheckSquare className="w-4 h-4"/> Quality Checks</TabsTrigger>
          <TabsTrigger value="data_capture" className="gap-2"><HelpCircle className="w-4 h-4"/> Data Capture Questions</TabsTrigger>
          <TabsTrigger value="playbook" className="gap-2"><BookOpen className="w-4 h-4"/> BD Playbook</TabsTrigger>
        </TabsList>

        <div className="flex items-center justify-between mb-4 bg-muted/30 p-2 rounded-lg border">
            <Tabs value={sourceFilter} onValueChange={setSourceFilter} className="w-[300px]">
                <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="phone_call">Phone Calls</TabsTrigger>
                <TabsTrigger value="google_meet">Video Demos</TabsTrigger>
                </TabsList>
            </Tabs>
            
            {activeTab === 'quality_checks' && !isAddingQC && (
                <Button onClick={() => setIsAddingQC(true)} size="sm" className="gap-2"><Plus className="w-4 h-4"/> Add QC Parameter</Button>
            )}
            {activeTab === 'data_capture' && !isAddingDC && (
                <Button onClick={() => setIsAddingDC(true)} size="sm" className="gap-2"><Plus className="w-4 h-4"/> Add Question</Button>
            )}
            {activeTab === 'playbook' && (
                <Button onClick={handleSavePlaybook} disabled={isSavingPlaybook} size="sm" className="gap-2">
                  {isSavingPlaybook ? <RefreshCw className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>} 
                  Save Playbook
                </Button>
            )}
        </div>

        {/* Quality Checks Tab */}
        <TabsContent value="quality_checks" className="mt-0 space-y-4">
          {isAddingQC && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">{editingQCId ? 'Edit Parameter' : 'Add New QC Parameter'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Category</label>
                    <Input placeholder="e.g. Greeting" value={qcFormData.category} onChange={e => setQcFormData({...qcFormData, category: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Parameter Name</label>
                    <Input placeholder="e.g. Warm Welcome" value={qcFormData.parameter} onChange={e => setQcFormData({...qcFormData, parameter: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Param ID</label>
                    <Input placeholder="e.g. DP-01" value={qcFormData.param_id} onChange={e => setQcFormData({...qcFormData, param_id: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Weight (%)</label>
                    <Input type="number" value={qcFormData.category_weight_pct} onChange={e => setQcFormData({...qcFormData, category_weight_pct: parseFloat(e.target.value) || 0})} />
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Scale / Max Score</label>
                    <Input placeholder="e.g. 2=done,1=partial,0=absent" value={qcFormData.scale || qcFormData.max_score} onChange={e => setQcFormData({...qcFormData, scale: e.target.value, max_score: parseInt(e.target.value) || qcFormData.max_score})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Polarity</label>
                    <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={qcFormData.polarity} onChange={e => setQcFormData({...qcFormData, polarity: e.target.value})}>
                        <option value="positive">Positive</option>
                        <option value="guardrail_negative">Guardrail (Negative)</option>
                    </select>
                  </div>
                  <div className="space-y-2 flex items-center gap-2 mt-8">
                    <input type="checkbox" id="breach" checked={qcFormData.embedded_breach_flag} onChange={e => setQcFormData({...qcFormData, embedded_breach_flag: e.target.checked})} />
                    <label htmlFor="breach" className="text-sm font-medium">Breach Flag Enabled</label>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Evidence Required</label>
                  <Input placeholder="e.g. timestamp + verbatim quote" value={qcFormData.evidence_required} onChange={e => setQcFormData({...qcFormData, evidence_required: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <label className="text-sm font-medium">Scoring Prompt / Check Question</label>
                    <Input placeholder="Did the agent do X?" value={qcFormData.description || qcFormData.check_question} onChange={e => setQcFormData({...qcFormData, description: e.target.value})} />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-0">
                <Button variant="ghost" onClick={() => { setIsAddingQC(false); setEditingQCId(null); setQcFormData(qcDefaults); }}>Cancel</Button>
                <Button onClick={handleSaveQC} className="gap-2"><Save className="w-4 h-4" /> Save Parameter</Button>
              </CardFooter>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center p-12 text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>
              ) : Object.keys(groupedQC).length === 0 ? (
                <div className="text-center p-12 text-muted-foreground">No quality parameters found for {sourceFilter}.</div>
              ) : (
                <ScrollArea className="h-[calc(100vh-320px)]">
                  {Object.entries(groupedQC).map(([category, params]) => (
                    <div key={category} className="mb-6">
                      <div className="bg-muted/50 px-6 py-2 border-y sticky top-0 z-10 font-semibold text-sm flex gap-2 items-center">
                        {category} <Badge variant="secondary" className="text-xs">{params.length}</Badge>
                      </div>
                      <Table>
                        <TableBody>
                          {params.map(p => (
                            <TableRow key={p.id}>
                              <TableCell className="w-[200px] font-medium align-top py-4 pl-6">
                                <div className="flex gap-2 items-center mb-1">
                                    {p.param_id && <Badge variant="outline">{p.param_id}</Badge>}
                                    {p.parameter}
                                </div>
                                <div className="text-xs text-muted-foreground font-normal">
                                    {p.scale ? `Scale: ${p.scale}` : `Max: ${p.max_score}`}
                                    {p.category_weight_pct > 0 && ` | Weight: ${p.category_weight_pct}%`}
                                </div>
                                {p.polarity === 'guardrail_negative' && <Badge variant="destructive" className="mt-2 text-[10px]">Guardrail</Badge>}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground align-top py-4">
                                <strong className="text-foreground text-xs block mb-1">{p.check_question || p.description}</strong>
                                {p.check_question ? p.description : ''}
                                {p.evidence_required && <div className="text-xs mt-2 p-2 bg-muted rounded"><strong>Evidence:</strong> {p.evidence_required}</div>}
                              </TableCell>
                              <TableCell className="text-right align-top py-4 pr-6 w-[100px]">
                                <Button variant="ghost" size="icon" onClick={() => handleEditQC(p)}><Edit2 className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteQC(p.id)}><Trash2 className="w-4 h-4" /></Button>
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
        </TabsContent>

        {/* Data Capture Questions Tab */}
        <TabsContent value="data_capture" className="mt-0 space-y-4">
          {isAddingDC && (
            <Card className="border-primary/20 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-base">{editingDCId ? 'Edit Question' : 'Add New Data Capture Question'}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Category</label>
                    <Input placeholder="e.g. Data Capture" value={dcFormData.category} onChange={e => setDcFormData({...dcFormData, category: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Label (Short Name)</label>
                    <Input placeholder="e.g. Customer Location" value={dcFormData.label} onChange={e => setDcFormData({...dcFormData, label: e.target.value})} />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">The Question to Answer</label>
                  <Input placeholder="e.g. What is the customer's location (city/district)?" value={dcFormData.question} onChange={e => setDcFormData({...dcFormData, question: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Instructions (Optional)</label>
                  <Textarea placeholder="Any specific rules for answering this question." rows={2} value={dcFormData.description} onChange={e => setDcFormData({...dcFormData, description: e.target.value})} />
                </div>
              </CardContent>
              <CardFooter className="flex justify-end gap-3 pt-0">
                <Button variant="ghost" onClick={() => { setIsAddingDC(false); setEditingDCId(null); setDcFormData({category:'Data Capture',label:'',question:'',description:''}); }}>Cancel</Button>
                <Button onClick={handleSaveDC} className="gap-2"><Save className="w-4 h-4" /> Save Question</Button>
              </CardFooter>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardContent className="p-0">
              {loading ? (
                <div className="flex justify-center p-12 text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>
              ) : Object.keys(groupedDC).length === 0 ? (
                <div className="text-center p-12 text-muted-foreground">No data capture questions found for {sourceFilter}.</div>
              ) : (
                <ScrollArea className="h-[calc(100vh-320px)]">
                  {Object.entries(groupedDC).map(([category, qs]) => (
                    <div key={category} className="mb-6">
                      <div className="bg-muted/50 px-6 py-2 border-y sticky top-0 z-10 font-semibold text-sm flex gap-2 items-center">
                        {category} <Badge variant="secondary" className="text-xs">{qs.length}</Badge>
                      </div>
                      <Table>
                        <TableBody>
                          {qs.map(q => (
                            <TableRow key={q.id}>
                              <TableCell className="w-[200px] font-medium align-top py-4 pl-6">
                                {q.label}
                              </TableCell>
                              <TableCell className="text-sm text-muted-foreground align-top py-4">
                                <strong className="text-foreground text-xs block mb-1">{q.question}</strong>
                                {q.description}
                              </TableCell>
                              <TableCell className="text-right align-top py-4 pr-6 w-[100px]">
                                <Button variant="ghost" size="icon" onClick={() => handleEditDC(q)}><Edit2 className="w-4 h-4" /></Button>
                                <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDeleteDC(q.id)}><Trash2 className="w-4 h-4" /></Button>
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
        </TabsContent>

        {/* Playbook Tab */}
        <TabsContent value="playbook" className="mt-0 h-[calc(100vh-250px)]">
          <Card className="h-full flex flex-col shadow-sm">
            <CardHeader className="pb-4 shrink-0">
              <CardTitle className="text-base">BD Playbook Configuration</CardTitle>
              <CardDescription>This text is injected directly into the LLM prompt to guide the AI's coaching logic. Edit carefully.</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-0 px-6 pb-6 relative">
              {loading ? (
                <div className="flex justify-center p-12 text-muted-foreground"><RefreshCw className="w-6 h-6 animate-spin" /></div>
              ) : (
                <Textarea 
                  className="w-full h-full font-mono text-sm resize-none bg-slate-50 border-slate-200 focus-visible:ring-1" 
                  value={playbookContent}
                  onChange={(e) => setPlaybookContent(e.target.value)}
                  placeholder="Enter playbook instructions..."
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
