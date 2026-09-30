import { useState, useEffect } from 'react';
import { getAssociates, syncAssociates, addAssociate, removeAssociate, getLeadsForAssociate, getActivitiesForLead, pushActivityToQC } from '../api';
import { RefreshCw, Trash2, Plus, PhoneCall, Headphones, Clock, ArrowRight, Play, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
  const [leadActivityCounts, setLeadActivityCounts] = useState({});

  // Level 3: Activities
  const [activities, setActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [pushingId, setPushingId] = useState(null);
  const [syncLanguages, setSyncLanguages] = useState({});


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
      setLeadActivityCounts({});
      
      // Fire background requests to get activity counts sequentially to strictly respect LSQ rate limits
      if (data && data.length > 0) {
        const processSequential = async () => {
          for (const l of data) {
            try {
              const acts = await getActivitiesForLead(l.prospect_id);
              if (Array.isArray(acts)) {
                // Compute separate counts: calls connected, demo conducted, knet registered
                const counts = { calls: 0, meetings: 0, knet: 0 };
                acts.forEach(a => {
                  const t = a.type || '';
                  if (t === 'Inbound' || t === 'Outbound') {
                    const status = (a.status || '').toLowerCase();
                    if (status === 'complete' || status === 'answered') counts.calls++;
                  } else if (t.toLowerCase() === 'conversion call' && a.resource_url) {
                    // Demo conducted = Conversion call with Recording Link of Demo populated
                    counts.meetings++;
                  }
                  // Knet check across all activity types
                  if (String(a.data?.ApplicationPaymentStatus || a.data?.['Application Payment Status'] || a.data?.mx_Custom_16 || '').toLowerCase() === 'completed') {
                    counts.knet++;
                  }
                });
                setLeadActivityCounts(prev => ({ ...prev, [l.prospect_id]: counts }));
              }
            } catch (e) {
              console.error(e);
            }
            // Strict 500ms delay between requests to guarantee we stay under the API limits
            await new Promise(r => setTimeout(r, 500));
          }
        };
        processSequential();
      }
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
      setActivities(Array.isArray(data) ? data : []);
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
        language: lang,
        lead_name: lead?.name || 'Unknown',
        lead_source: lead?.source || 'Phone'
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
  // Filter activities: strictly whitelist BDA Activity, Application Status, Conversion call, and completed calls
  const filteredActivities = activities.filter(a => {
    const t = (a.type || '').toLowerCase();
    if (t === 'inbound' || t === 'outbound') {
      const status = (a.status || '').toLowerCase();
      return status === 'complete' || status === 'answered';
    }
    return t === 'bda activity' || t === 'application status' || t === 'conversion call';
  });

  const selectedAssoc = associates.find(a => a.emp_number === selectedEmp);
  const selectedLeadObj = leads.find(l => l.prospect_id === selectedLead);


  return (
    <div className="flex flex-col h-[calc(100vh-140px)] gap-6">


      {/* Team Selection Toolbar */}
      <Card className="flex-shrink-0 shadow-sm z-10">
        <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[300px]">
             <span className="text-sm font-medium text-muted-foreground">QC Team Associate:</span>
             <select 
               value={selectedEmp || ""} 
               onChange={(e) => selectAssociate(e.target.value)}
               className="w-[300px] h-9 flex text-sm rounded-md border border-input bg-transparent px-3 py-1 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
             >
                 <option value="" disabled>Select an associate...</option>
                 {associates.map(a => (
                   <option key={a.emp_number} value={a.emp_number}>
                     {a.emp_name} ({a.emp_number})
                   </option>
                 ))}
                 {associates.length === 0 && (
                   <option value="" disabled>No associates tracked</option>
                 )}
             </select>
             
             {selectedEmp && (
               <Button variant="ghost" size="icon" onClick={() => handleRemove(selectedEmp)} className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove tracking for this associate">
                 <Trash2 className="w-4 h-4" />
               </Button>
             )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleSyncClick} disabled={syncing} className="gap-2 h-9">
               <RefreshCw className={cn("w-4 h-4", syncing && "animate-spin")} />
               Manage / Sync Team
            </Button>
            
            <Dialog open={showSyncModal} onOpenChange={setShowSyncModal}>
              <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[85vh] flex flex-col overflow-hidden p-0">
                <DialogHeader className="px-6 py-4 border-b bg-muted/30 flex-shrink-0">
                  <DialogTitle className="flex items-center gap-2 text-xl">
                    <Users className="w-5 h-5 text-primary" />
                    Select Associates to Track
                  </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto p-0 min-h-0">
                  <Table className="w-full">
                    <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                      <TableRow>
                        <TableHead className="px-6 w-[35%]">Name</TableHead>
                        <TableHead className="w-[35%]">Role / Groups</TableHead>
                        <TableHead className="w-[15%]">Language</TableHead>
                        <TableHead className="text-right px-6 w-[15%]">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {syncedList.map((emp) => {
                        const isAdded = associates.some(a => a.emp_number === emp.emp_number);
                        const empLang = syncLanguages[emp.emp_number] || 'hi';
                        return (
                          <TableRow key={emp.emp_number}>
                            <TableCell className="px-6 font-medium whitespace-nowrap">{emp.emp_name}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={emp.emp_tags}>{emp.emp_tags}</TableCell>
                            <TableCell>
                              <select
                                disabled={isAdded}
                                value={empLang}
                                onChange={(e) => setSyncLanguages({...syncLanguages, [emp.emp_number]: e.target.value})}
                                className="w-[120px] h-8 text-xs flex rounded-md border border-input bg-transparent px-3 py-1 shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                  <option value="" disabled>Language</option>
                                  <option value="hi">Hindi</option>
                                  <option value="ta">Tamil</option>
                                  <option value="kn">Kannada</option>
                                  <option value="te">Telugu</option>
                                  <option value="ml">Malayalam</option>
                              </select>
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
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col md:flex-row flex-1 gap-6 min-h-0">
        {/* Panel 2: Leads for selected Associate */}
        <Card className="w-full md:w-[320px] flex-shrink-0 flex flex-col min-h-0 shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              New Leads
            </CardTitle>
            <CardDescription>
              {selectedAssoc ? `For ${selectedAssoc.emp_name}` : "Select an associate"}
            </CardDescription>
          </CardHeader>

          <CardContent className="flex-1 min-h-0 p-4 pt-0">
            <ScrollArea className="h-full -mx-4 px-4">
              <div className="space-y-2 pb-4">
                {loadingLeads ? (
                  <div className="flex justify-center py-12">
                    <RefreshCw className="w-6 h-6 text-primary animate-spin" />
                  </div>
                ) : !selectedEmp ? (
                  <div className="h-32 flex flex-col gap-2 items-center justify-center text-center text-sm text-muted-foreground p-6 border border-dashed rounded-lg bg-muted/30">
                    <span>↑</span>
                    <span>Select an associate from the top bar to view their assigned leads.</span>
                  </div>
                ) : leads.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-lg bg-muted/30">
                    No leads found in "New Lead" stage for this associate.
                  </div>
                ) : (
                  [...leads]
                    .sort((a, b) => {
                      const ca = leadActivityCounts[a.prospect_id] || { calls: 0, meetings: 0, knet: 0 };
                      const cb = leadActivityCounts[b.prospect_id] || { calls: 0, meetings: 0, knet: 0 };
                      // Sort: knet > meetings > calls
                      if (cb.knet !== ca.knet) return cb.knet - ca.knet;
                      if (cb.meetings !== ca.meetings) return cb.meetings - ca.meetings;
                      return cb.calls - ca.calls;
                    })
                    .filter(l => {
                      const c = leadActivityCounts[l.prospect_id];
                      return c && c.calls > 0;
                    })
                    .map((l) => {
                    const c = leadActivityCounts[l.prospect_id] || { calls: 0, meetings: 0, knet: 0 };
                    return (
                    <div
                      key={l.prospect_id}
                      onClick={() => selectLead(l.prospect_id)}
                      className={cn(
                        "p-3 rounded-lg border cursor-pointer transition-all duration-200 relative",
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
                      
                      <div className="flex items-center gap-1.5 absolute top-2.5 right-3">
                        {c.calls > 0 && (
                          <Badge className="bg-blue-500 hover:bg-blue-600 text-[10px] px-1.5 py-0">
                            {c.calls} Calls
                          </Badge>
                        )}
                        {c.meetings > 0 && (
                          <Badge className="bg-purple-500 hover:bg-purple-600 text-[10px] px-1.5 py-0">
                            Meeting
                          </Badge>
                        )}
                        {c.knet > 0 && (
                          <Badge className="bg-emerald-500 hover:bg-emerald-600 text-[10px] px-1.5 py-0">
                            Knet ✓
                          </Badge>
                        )}
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Panel 3: Activities for selected Lead */}
        <Card className="flex-1 flex flex-col min-h-0 overflow-hidden shadow-sm">
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
                <p>← Select a lead from the left panel to view their call history.</p>
                <p className="mt-2 text-xs opacity-70">Only calls with recordings &gt; 60s can be pushed to QC.</p>
              </div>
            ) : loadingActivities ? (
              <div className="flex justify-center items-center h-full border-t">
                <RefreshCw className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : filteredActivities.length === 0 ? (
              <div className="flex justify-center items-center h-full text-sm text-muted-foreground border-t">
                No activities found for this lead.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto border-t bg-muted/5">
                <div className="p-6 space-y-4">
                  {filteredActivities.map((a) => (
                    <div key={a.activity_id} className="relative pl-8 before:absolute before:left-[15px] before:top-2 before:bottom-[-32px] last:before:hidden before:w-[2px] before:bg-border group">
                      <div className="absolute left-0 top-1.5 w-[32px] h-[32px] rounded-full bg-background border-2 border-primary/20 flex items-center justify-center shadow-sm z-10 group-hover:border-primary group-hover:scale-110 transition-all">
                        {a.type === 'Conversion call' ? (
                          <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                        ) : a.type === 'Inbound' || a.type === 'Outbound' ? (
                          <PhoneCall className="w-4 h-4 text-primary" />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                        )}
                      </div>
                      
                      <Card className="shadow-sm border border-border/50 hover:shadow-md transition-shadow bg-background">
                        <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0 bg-muted/20 border-b border-border/50">
                          <div>
                            <CardTitle className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                              {a.type}
                              {a.type === 'Conversion call' && a.resource_url && (
                                <Badge variant="secondary" className="bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200 text-[10px] h-5">
                                  Demo Conducted ✓
                                </Badge>
                              )}
                              {a.type === 'Conversion call' && !a.resource_url && (
                                <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 text-[10px] h-5">
                                  Conversion Call
                                </Badge>
                              )}
                              {a.data && (String(a.data.ApplicationPaymentStatus || a.data['Application Payment Status'] || a.data.mx_Custom_16 || '').toLowerCase() === 'completed') && (
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200 text-[10px] h-5">
                                  Knet Registered
                                </Badge>
                              )}
                            </CardTitle>
                            <CardDescription className="text-xs mt-1 text-foreground/70">
                              {new Date(a.created_on).toLocaleString()}
                            </CardDescription>
                          </div>
                          
                          {/* Action Button for Audio/Meet calls */}
                          {(a.type === 'Inbound' || a.type === 'Outbound' || a.type === 'Conversion call') && a.resource_url && (
                            <div className="flex flex-col items-end gap-2">
                              <Button
                                size="sm"
                                variant={a.type === 'Conversion call' ? 'outline' : 'default'}
                                className="h-8 shadow-sm text-xs gap-1.5"
                                onClick={() => {
                                  if (a.type === 'Conversion call') {
                                    window.open(a.resource_url, '_blank');
                                  } else {
                                    handlePushToQC(a);
                                  }
                                }}
                                disabled={pushingId === a.activity_id || (a.type !== 'Conversion call' && a.duration < 60)}
                              >
                                {pushingId === a.activity_id ? (
                                  <><RefreshCw className="w-3 h-3 animate-spin" /> Pushing</>
                                ) : a.type === 'Conversion call' ? (
                                  <><Play className="w-3 h-3" /> View Recording</>
                                ) : (
                                  <>Push <ArrowRight className="w-3 h-3" /></>
                                )}
                              </Button>
                            </div>
                          )}
                        </CardHeader>
                        <CardContent className="py-3 px-4 text-sm flex flex-col gap-2">
                          <div className="flex flex-wrap gap-x-6 gap-y-2">
                            {a.status && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Status</span>
                                <span className="font-medium capitalize text-sm">{a.status}</span>
                              </div>
                            )}
                            {a.duration > 0 && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Duration</span>
                                <span className="font-medium text-sm flex items-center gap-1.5">
                                  <Clock className="w-3.5 h-3.5 opacity-70" />
                                  {formatDuration(a.duration)}
                                </span>
                              </div>
                            )}
                            {a.caller && (
                              <div className="flex flex-col">
                                <span className="text-[10px] text-muted-foreground uppercase font-semibold tracking-wider">Agent</span>
                                <span className="font-medium text-sm">{a.caller}</span>
                              </div>
                            )}
                          </div>
                          
                          {/* Raw Data Attributes for non-call events */}
                          {a.data && Object.keys(a.data).length > 0 && a.type !== 'Inbound' && a.type !== 'Outbound' && (
                            <div className="mt-2 p-3 bg-muted/40 rounded-md border border-border/50 grid grid-cols-2 gap-3">
                              {Object.entries(a.data)
                                .filter(([k,v]) => v && k !== 'ActivityType' && k !== 'Duration' && k !== 'CallType' && k !== 'Conversioncallstatus' && k !== 'ResourceUrl' && k !== 'ResourceURL')
                                .slice(0, 8)
                                .map(([key, value]) => (
                                <div key={key} className="flex flex-col truncate">
                                  <span className="text-[10px] text-muted-foreground font-semibold tracking-wider uppercase truncate">
                                    {key.replace(/mx_Custom_/, '').replace(/([A-Z])/g, ' $1').trim()}
                                  </span>
                                  <span className="font-medium text-sm truncate" title={String(value)}>{String(value)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
