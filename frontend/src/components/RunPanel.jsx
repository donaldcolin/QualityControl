import { useState, useEffect } from 'react';
import { startRun, startUploadRun, getRunStatus, getQueueItemStatus } from '../api';
import { Folder, Upload, Play, AlertCircle, CheckCircle2, Loader2, Download, Languages, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';

export default function RunPanel({ activeQueueId, isSidebar = false }) {
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState([]);
  const [language, setLanguage] = useState('hi');
  const [batchId, setBatchId] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [runType, setRunType] = useState('upload'); // 'upload' or 'folder'

  const [isAddMode, setIsAddMode] = useState(false);

  useEffect(() => {
    if (activeQueueId) {
      setBatchId(null);
      setStatus(null);
      setIsAddMode(false);
    }
  }, [activeQueueId]);

  useEffect(() => {
    const targetId = activeQueueId || batchId;
    if (!targetId) return;

    let interval;
    const fetchStatus = async () => {
      try {
        let res;
        if (activeQueueId) {
          const qItem = await getQueueItemStatus(activeQueueId);
          res = {
            status: (qItem.status === 'completed' || qItem.status === 'failed' || qItem.status === 'pending') ? qItem.status : 'processing',
            progress_msg: qItem.status === 'completed' ? 'Processing finished' : qItem.status,
            errors: Array.isArray(qItem.errors) ? qItem.errors : (typeof qItem.errors === 'string' ? [qItem.errors] : (qItem.errors ? [JSON.stringify(qItem.errors)] : [])),
            done_files: qItem.status === 'completed' ? 1 : 0,
            total_files: 1,
            segments: qItem.segments
          };
        } else {
          res = await getRunStatus(batchId);
        }
        setStatus(res);
        if (res.status === 'completed' || res.status === 'failed') {
          clearInterval(interval);
        }
      } catch (e) {
        console.error("Error fetching status", e);
      }
    };

    fetchStatus();
    interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [batchId, activeQueueId]);

  const handleRun = async () => {
    setLoading(true);
    try {
      let res;
      if (runType === 'upload' && files.length > 0) {
        res = await startUploadRun(files, language);
      } else {
        res = await startRun(folder, language);
      }
      setBatchId(res.batch_id);
      setIsAddMode(false);
    } catch (e) {
      console.error(e);
      alert('Failed to start run');
    } finally {
      setLoading(false);
    }
  };

  const isReadyToRun = runType === 'upload' ? files.length > 0 : folder.trim().length > 0;

  return (
    <div className={cn("flex flex-col h-full bg-background", isSidebar ? "p-4" : "p-8 max-w-xl mx-auto")}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold">Evaluation Runner</h2>
          <p className="text-sm text-muted-foreground">Monitor progress or start new runs</p>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsAddMode(!isAddMode)} 
          title={isAddMode ? 'Cancel' : 'New Run'}
        >
          <Plus className={cn("w-5 h-5 transition-transform", isAddMode && "rotate-45")} />
        </Button>
      </div>

      {isAddMode && (
        <Tabs value={runType} onValueChange={setRunType} className="flex-none flex flex-col mb-6">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="w-4 h-4" /> Upload
            </TabsTrigger>
            <TabsTrigger value="folder" className="flex items-center gap-2">
              <Folder className="w-4 h-4" /> Local Path
            </TabsTrigger>
          </TabsList>

          <TabsContent value="upload" className="flex-none space-y-4 m-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Upload Audio Files</CardTitle>
                <CardDescription>Select .wav or .mp3 files to analyze.</CardDescription>
              </CardHeader>
              <CardContent>
                <Input 
                  id="files" 
                  type="file" 
                  multiple 
                  accept="audio/*,video/*"
                  onChange={(e) => setFiles(Array.from(e.target.files))}
                  className="cursor-pointer file:text-primary file:bg-primary/10 file:border-0 file:rounded-md file:px-4 file:py-1 hover:file:bg-primary/20"
                />
                {files.length > 0 && (
                  <div className="mt-2 text-xs font-medium text-muted-foreground bg-muted/50 p-2 rounded-md">
                    {files.length} file(s) selected
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="folder" className="flex-none space-y-4 m-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Local Server Path</CardTitle>
                <CardDescription>Path on the backend server containing audio files.</CardDescription>
              </CardHeader>
              <CardContent>
                <Input 
                  placeholder="/path/to/audio/folder" 
                  value={folder} 
                  onChange={(e) => setFolder(e.target.value)}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <div className="mt-4 flex-none space-y-4">
            <div className="space-y-2">
              <Label>Transcription Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hi">Hindi / Hinglish</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="te">Telugu</SelectItem>
                  <SelectItem value="bn">Bengali</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button 
              className="w-full" 
              size="lg" 
              onClick={handleRun} 
              disabled={loading || !isReadyToRun}
            >
              {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
              {loading ? "Starting..." : "Run Pipeline"}
            </Button>
          </div>
        </Tabs>
      )}

      {/* Status Section */}
      {status ? (
        <ScrollArea className="flex-1 border rounded-lg bg-card/50">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-semibold text-sm">Status</h3>
              {status.status === 'completed' && <Badge variant="default" className="bg-green-500 hover:bg-green-600"><CheckCircle2 className="w-3 h-3 mr-1"/> Done</Badge>}
              {status.status === 'failed' && <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1"/> Failed</Badge>}
              {status.status === 'processing' && <Badge variant="secondary" className="animate-pulse"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Processing</Badge>}
              {status.status === 'pending' && <Badge variant="outline">Pending</Badge>}
            </div>

            {(() => {
              const msg = (status.progress_msg || '').toLowerCase();
              
              const steps = [
                { id: 1, label: 'Preparation & Audio Download', activeTerms: ['initializ', 'download', 'load', 'convert', 'trim'] },
                { id: 2, label: 'Speaker Diarization', activeTerms: ['diarization', 'merg'] },
                { id: 3, label: 'ASR Transcription', activeTerms: ['transcrib', 'saving', 'insert', 'saved'] },
                { id: 4, label: 'QC AI Evaluation', activeTerms: ['qc', 'evaluat'] }
              ];

              let currentStep = 0;
              if (status.status === 'completed') {
                currentStep = 5;
              } else if (status.status === 'failed') {
                currentStep = -1; // Keep whatever it was, maybe show error
              } else {
                for (let i = steps.length - 1; i >= 0; i--) {
                  if (steps[i].activeTerms.some(term => msg.includes(term))) {
                    currentStep = steps[i].id;
                    break;
                  }
                }
                // Fallback if not matched
                if (currentStep === 0 && msg) currentStep = 1;
              }

              return (
                <div className="space-y-4">
                  <div className="text-sm">
                    <span className="text-muted-foreground font-medium text-xs uppercase tracking-wider block mb-1">Current Process</span>
                    <p className="bg-muted p-2 rounded-md font-mono text-xs text-primary font-semibold">{status.progress_msg}</p>
                  </div>
                  
                  <div className="relative border-l-2 border-muted ml-3 space-y-6 mt-6 pb-2">
                    {steps.map((step) => {
                      const isCompleted = currentStep > step.id || currentStep === 5;
                      const isActive = currentStep === step.id;
                      const isPending = currentStep !== 5 && currentStep < step.id;
                      
                      return (
                        <div key={step.id} className="relative pl-6">
                          <div className={cn(
                            "absolute -left-[9px] top-0.5 w-4 h-4 rounded-full border-2 bg-background flex items-center justify-center transition-colors",
                            isCompleted ? "border-green-500 bg-green-500" :
                            isActive ? "border-primary shadow-[0_0_8px_rgba(59,130,246,0.5)]" : 
                            "border-muted"
                          )}>
                            {isCompleted && <CheckCircle2 className="w-3 h-3 text-white" />}
                            {isActive && <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />}
                          </div>
                          <div className={cn(
                            "text-sm font-medium transition-colors",
                            isCompleted ? "text-foreground" :
                            isActive ? "text-primary" : 
                            "text-muted-foreground"
                          )}>
                            {step.label}
                          </div>
                          {isActive && msg.includes('transcribing segment') && (
                            <div className="mt-2 w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                              {(() => {
                                const match = msg.match(/(\d+)\/(\d+)/);
                                const pct = match ? (parseInt(match[1]) / parseInt(match[2])) * 100 : 10;
                                return <div className="h-full bg-primary transition-all duration-300" style={{ width: `${pct}%` }} />
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {status.errors && status.errors.length > 0 && !(status.errors.length === 1 && status.errors[0] === '[]') && (
              <div className="space-y-1">
                <span className="text-destructive font-medium text-xs uppercase tracking-wider block mb-1">Errors</span>
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md border border-destructive/20 space-y-1">
                  {status.errors.map((err, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span className="break-words font-mono text-xs">{err}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        !isAddMode && (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg p-8 bg-muted/10 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <AlertCircle className="w-6 h-6 opacity-50" />
            </div>
            <p>No active evaluation run.</p>
            <p className="text-xs opacity-70">Queue an audio file from the Team QC view, or start a manual run.</p>
            <Button variant="outline" size="sm" onClick={() => setIsAddMode(true)} className="mt-2 gap-1.5">
              <Plus className="w-3.5 h-3.5" /> Queue Something
            </Button>
          </div>
        )
      )}
    </div>
  );
}
