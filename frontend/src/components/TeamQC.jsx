import { useState, useEffect } from 'react';
import { getAssociates, syncAssociates, addAssociate, removeAssociate, getLeadsForAssociate, getActivitiesForLead, pushActivityToQC, scanAll, triggerMeetSync } from '../api';
import { RefreshCw, Trash2, Plus, PhoneCall, Headphones, Clock, ArrowRight, UserPlus, Play, Users, Zap, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function TeamQC({ onPushToQueue }) {
  // Level 1: Associates
  const [associates, setAssociates] = useState([]);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncedList, setSyncedList] = useState([]);
  const [showSyncModal, setShowSyncModal] = useState(false);

  // Level 2: Leads
  const [leads, setLeads] = useState([]);
  const [selectedLead, setSelectedLead] = useState(null);
  const [loadingLeads, setLoadingLeads] = useState(false);

  // Level 3: Activities
  const [activities, setActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [pushingId, setPushingId] = useState(null);
  const [syncLanguages, setSyncLanguages] = useState({});

  // Automation
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [syncingMeet, setSyncingMeet] = useState(false);

  useEffect(() => {
    fetchAssociates();
  }, []);

  const fetchAssociates = async () => {
    try {
      const data = await getAssociates();
      setAssociates(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncClick = async () => {
    setSyncing(true);
    try {
      const res = await syncAssociates();
      if (res.data) {
        setSyncedList(res.data);
        setShowSyncModal(true);
      } else {
        alert(res.error || "Failed to fetch associates from LeadSquared");
      }
    } catch (err) {
      alert("Error syncing associates");
    } finally {
      setSyncing(false);
    }
  };

  const handleAddAssociate = async (emp) => {
    try {
      const lang = syncLanguages[emp.emp_number] || 'hi';
      const res = await addAssociate(emp.emp_number, emp.emp_name, emp.emp_tags || '', lang);
      if (res.error) {
        alert(res.error);
      } else {
        fetchAssociates();
      }
    } catch (err) {
      alert("Error adding associate");
    }
  };

  const handleRemove = async (emp_number) => {
    if (!confirm("Remove this associate? Their leads won't be tracked.")) return;
    try {
      await removeAssociate(emp_number);
      if (selectedEmp === emp_number) {
        setSelectedEmp(null);
        setLeads([]);
        setSelectedLead(null);
        setActivities([]);
      }
      fetchAssociates();
    } catch (err) {
      alert("Error removing associate");
    }
  };

  const selectAssociate = async (emp_number) => {
    setSelectedEmp(emp_number);
    setSelectedLead(null);
    setActivities([]);
    setLoadingLeads(true);
    try {
      const data = await getLeadsForAssociate(emp_number);
      setLeads(data || []);
    } catch (err) {
      console.error(err);
      setLeads([]);
    } finally {
      setLoadingLeads(false);
    }
  };

  const selectLead = async (prospectId) => {
    setSelectedLead(prospectId);
    setLoadingActivities(true);
    try {
      const data = await getActivitiesForLead(prospectId);
      setActivities(data || []);
    } catch (err) {
      console.error(err);
      setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  };

  const handlePushToQC = async (activity) => {
    setPushingId(activity.activity_id);
    try {
      const lead = leads.find(l => l.prospect_id === selectedLead);
      const associate = associates.find(a => a.emp_number === selectedEmp);
      
      let lang = 'hi';
      if (associate && associate.emp_tags) {
        const match = associate.emp_tags.match(/\|lang:([a-z]{2})/);
        if (match) lang = match[1];
      }

      const res = await pushActivityToQC({
        activity_id: activity.activity_id,
        resource_url: activity.resource_url,
        duration: activity.duration,
        type: activity.type,
        prospect_id: activity.prospect_id,
        emp_number: selectedEmp,
        client_number: lead?.phone || '',
        language: lang
      });
      if (res.error) {
        alert(res.error);
      } else {
        selectLead(selectedLead);
        if (onPushToQueue) {
          onPushToQueue(res.queue_id);
        }
      }
    } catch (err) {
      alert("Error pushing to QC");
    } finally {
      setPushingId(null);
    }
  };

  const formatDuration = (sec) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Filter activities to only show 'Complete' ones
  const filteredActivities = activities.filter(a => (a.status || '').toLowerCase() === 'complete');

  const selectedAssoc = associates.find(a => a.emp_number === selectedEmp);
  const selectedLeadObj = leads.find(l => l.prospect_id === selectedLead);

  const handleScanAll = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await scanAll();
      setScanResult(result.summary || result);
    } catch (err) {
      console.error('Scan All failed:', err);
      setScanResult({ error: err.message });
    } finally {
      setScanning(false);
    }
  };

  const handleMeetSync = async () => {
    setSyncingMeet(true);
    setScanResult(null);
    try {
      const res = await triggerMeetSync();
      setScanResult({ message: `Meet Sync: ${res.results.processed} processed, ${res.results.skipped} skipped.` });
    } catch (err) {
      console.error('Meet Sync failed:', err);
      setScanResult({ error: err.message });
    } finally {
      setSyncingMeet(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] gap-6">

      {/* Automation Bar */}
      <Card className="shadow-sm">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="bg-amber-100 dark:bg-amber-900/30 p-2 rounded-full">
              <Zap className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h3 className="font-semibold text-sm">Auto-Scan Pipeline</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Scan all associates → leads → queue all recordings to ASR + QC</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {scanResult && !scanResult.error && (
              <div className="flex items-center gap-4 text-xs mr-4 bg-muted px-3 py-1.5 rounded-md">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  {scanResult.associates_scanned} associates
                </span>
                <span className="text-muted-foreground">{scanResult.leads_found} leads</span>
                <span className="font-medium text-emerald-600">{scanResult.calls_queued} queued</span>
                {scanResult.calls_skipped > 0 && (
                  <span className="text-muted-foreground">{scanResult.calls_skipped} skipped</span>
                )}
              </div>
            )}
            {scanResult?.error && (
              <span className="text-xs text-destructive mr-4">{scanResult.error}</span>
            )}
            <Button
              onClick={handleScanAll}
              disabled={scanning || syncingMeet}
              className="gap-2"
            >
              {scanning ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Scanning...</>
              ) : (
                <><Zap className="w-4 h-4" /> Scan All</>
              )}
            </Button>
            <Button
              variant="outline"
              onClick={handleMeetSync}
              disabled={scanning || syncingMeet}
              className="gap-2"
            >
              {syncingMeet ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> Syncing...</>
              ) : (
                <><Play className="w-4 h-4" /> Sync Meet</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col md:flex-row flex-1 gap-6 min-h-0">
        
        {/* Panel 1: Associates Sidebar */}
        <Card className={cn(
          "flex-shrink-0 flex flex-col transition-all duration-300 relative shadow-sm",
          sidebarOpen ? "w-full md:w-[320px]" : "w-full md:w-[80px] items-center"
        )}>
          {/* Toggle Button */}
          <Button 
            variant="outline"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="absolute -right-4 top-6 z-10 w-8 h-8 rounded-full hidden md:flex shadow-sm bg-background"
            title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            <ArrowRight className={cn("w-4 h-4 transition-transform duration-300", sidebarOpen ? "rotate-180" : "")} />
          </Button>

          <CardHeader className={cn("pb-4", sidebarOpen ? "" : "px-2")}>
            <div className={cn("flex items-center", sidebarOpen ? "justify-between w-full" : "justify-center")}>
              <CardTitle className="text-lg flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" />
                {sidebarOpen && "QC Team"}
              </CardTitle>
              {sidebarOpen && (
                <Badge variant="secondary">{associates.length}</Badge>
              )}
            </div>
          </CardHeader>
          
          <CardContent className="flex flex-col flex-1 min-h-0 p-4 pt-0 gap-4">
            {sidebarOpen ? (
              <>
              <Button 
                variant="outline"
                className="w-full gap-2"
                onClick={handleSyncClick} 
                disabled={syncing}
              >
                <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
                {syncing ? 'Syncing...' : 'Add / Sync Associate'}
              </Button>
              <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
                
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0">
                  <DialogHeader className="px-6 py-4 border-b bg-muted/30">
                    <DialogTitle className="flex items-center gap-2 text-xl">
                      <Users className="w-5 h-5 text-primary" />
                      Select Associates to Track
                    </DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="flex-1 p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="px-6">Name</TableHead>
                          <TableHead>Role / Groups</TableHead>
                          <TableHead>Language</TableHead>
                          <TableHead className="text-right px-6">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {syncedList.map((emp) => {
                          const isAdded = associates.some(a => a.emp_number === emp.emp_number);
                          const empLang = syncLanguages[emp.emp_number] || 'hi';
                          return (
                            <TableRow key={emp.emp_number}>
                              <TableCell className="px-6 font-medium">{emp.emp_name}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={emp.emp_tags}>{emp.emp_tags}</TableCell>
                              <TableCell>
                                <Select
                                  disabled={isAdded}
                                  value={empLang}
                                  onValueChange={(val) => setSyncLanguages({...syncLanguages, [emp.emp_number]: val})}
                                >
                                  <SelectTrigger className="w-[120px] h-8 text-xs">
                                    <SelectValue placeholder="Language" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="hi">Hindi</SelectItem>
                                    <SelectItem value="ta">Tamil</SelectItem>
                                    <SelectItem value="kn">Kannada</SelectItem>
                                    <SelectItem value="te">Telugu</SelectItem>
                                    <SelectItem value="ml">Malayalam</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                              <TableCell className="text-right px-6">
                                <Button
                                  size="sm"
                                  disabled={isAdded}
                                  onClick={() => handleAddAssociate(emp)}
                                  variant={isAdded ? "secondary" : "default"}
                                  className="h-8 gap-1.5"
                                >
                                  {isAdded ? 'Added' : <><Plus className="w-3 h-3" /> Add</>}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </DialogContent>
              </Dialog>
              </>
            ) : (
              <Button 
                variant="outline"
                size="icon"
                onClick={handleSyncClick} 
                disabled={syncing}
                title="Sync LeadSquared"
              >
                <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
              </Button>
            )}

            <ScrollArea className="flex-1 -mx-1 px-1">
              <div className="space-y-2">
                {associates.map((a) => (
                  <div
                    key={a.emp_number}
                    onClick={() => selectAssociate(a.emp_number)}
                    title={!sidebarOpen ? a.emp_name : ""}
                    className={cn(
                      "group rounded-lg border cursor-pointer transition-all duration-200 flex items-center",
                      sidebarOpen ? "p-3" : "p-2 justify-center aspect-square",
                      selectedEmp === a.emp_number 
                        ? "border-primary bg-primary/5 shadow-sm" 
                        : "border-transparent hover:border-border hover:bg-muted"
                    )}
                  >
                    {sidebarOpen ? (
                      <div className="flex justify-between items-start w-full">
                        <div className="min-w-0">
                          <div className={cn("font-medium text-sm truncate", selectedEmp === a.emp_number ? "text-primary" : "")}>
                            {a.emp_name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 truncate">
                            {a.emp_number}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive hover:bg-destructive/10 -mr-1 -mt-1"
                          onClick={(e) => { e.stopPropagation(); handleRemove(a.emp_number); }}
                          title="Remove"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className={cn(
                        "font-bold text-sm w-8 h-8 rounded-full flex items-center justify-center uppercase",
                        selectedEmp === a.emp_number ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground"
                      )}>
                        {a.emp_name.charAt(0)}
                      </div>
                    )}
                  </div>
                ))}
                {associates.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    {sidebarOpen ? <><span className="block mb-1">No associates tracked.</span>Sync from LeadSquared to start.</> : "-"}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 2: Leads for selected Associate */}
        <Card className="w-full md:w-[320px] flex-shrink-0 flex flex-col shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              New Leads
            </CardTitle>
            <CardDescription>
              {selectedAssoc ? `For ${selectedAssoc.emp_name}` : "Select an associate"}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-h-0 overflow-hidden flex flex-col p-4 pt-0">
            <ScrollArea className="flex-1 -mx-4 px-4">
              <div className="space-y-2 pb-4">
                {loadingLeads ? (
                  <div className="flex justify-center py-12">
                    <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : !selectedEmp ? (
                  <div className="h-32 flex items-center justify-center text-center text-sm text-muted-foreground p-6 border border-dashed rounded-lg bg-muted/30">
                    ← Select an associate from the left panel to view their assigned leads.
                  </div>
                ) : leads.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-lg bg-muted/30">
                    No leads found in "New Lead" stage for this associate.
                  </div>
                ) : (
                  leads.map((l) => (
                    <div
                      key={l.prospect_id}
                      onClick={() => selectLead(l.prospect_id)}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all duration-200",
                        selectedLead === l.prospect_id 
                          ? "border-primary bg-primary/5 shadow-sm" 
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="font-medium text-sm">{l.name}</div>
                      <div className="flex items-center gap-2 mt-2">
                        <Badge variant="outline" className="font-mono text-[10px] py-0">{l.phone}</Badge>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate">
                          {l.source}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 3: Activities for selected Lead */}
        <Card className="flex-1 flex flex-col overflow-hidden shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <PhoneCall className="w-5 h-5 text-primary" />
              Call Activities
            </CardTitle>
            <CardDescription>
              {selectedLeadObj ? `${selectedLeadObj.name} (${selectedLeadObj.phone})` : "Select a lead"}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-h-0 p-0 flex flex-col">
            {!selectedLead ? (
              <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground p-8 bg-muted/10 border-t">
                <div className="bg-muted p-4 rounded-full mb-4">
                  <Headphones className="w-10 h-10 text-muted-foreground/50" />
                </div>
                <p>Select a lead from the middle panel to view their call history.</p>
                <p className="mt-2 text-xs opacity-70">Only calls with recordings &gt; 60s can be pushed to QC.</p>
              </div>
            ) : loadingActivities ? (
              <div className="flex justify-center items-center h-full border-t">
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="flex justify-center items-center h-full text-sm text-muted-foreground border-t">
                No completed phone call activities found for this lead.
              </div>
            ) : (
              <ScrollArea className="flex-1 border-t">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0">
                    <TableRow>
                      <TableHead className="whitespace-nowrap px-6">Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Audio</TableHead>
                      <TableHead className="text-right px-6">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActivities.map((a) => (
                      <TableRow key={a.activity_id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap px-6">
                          {new Date(a.created_on).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={a.type === 'Outbound' ? 'default' : 'secondary'} className="text-[10px] font-semibold tracking-wide uppercase">
                            {a.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          <div className="flex items-center gap-1.5 text-xs">
                            <Clock className="w-3.5 h-3.5 opacity-70" />
                            {formatDuration(a.duration)}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs capitalize">
                          {a.status}
                        </TableCell>
                        <TableCell>
                          {a.resource_url ? (
                            <a href={a.resource_url} target="_blank" rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 text-xs font-medium bg-primary/10 px-2 py-1 rounded-md transition-colors">
                              <Play className="w-3 h-3 fill-current" /> Play
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground opacity-50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right px-6">
                          {a.resource_url && a.duration > 60 ? (
                            <Button
                              size="sm"
                              onClick={() => handlePushToQC(a)}
                              disabled={pushingId === a.activity_id}
                              className="h-8 text-xs gap-1"
                            >
                              {pushingId === a.activity_id ? (
                                <><RefreshCw className="w-3 h-3 animate-spin" /> Pushing</>
                              ) : (
                                <>Push <ArrowRight className="w-3 h-3" /></>
                              )}
                            </Button>
                          ) : a.resource_url ? (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground bg-muted/50">Too short</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">No Audio</span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
