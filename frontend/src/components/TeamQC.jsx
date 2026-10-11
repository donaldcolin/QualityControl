import { useState, useEffect } from 'react';
import { getAssociates, syncAssociates, addAssociate, removeAssociate, getLeadsForAssociate, getActivitiesForLead, pushActivityToQC, pushDemoToQC, searchLeadsByPhone, getDriveTranscript } from '../api';
import { RefreshCw, Trash2, Plus, PhoneCall, Headphones, Clock, ArrowRight, Play, Users, Search, User, CheckCircle2, ExternalLink, FileText } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';

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
  const [searchQuery, setSearchQuery] = useState('');

  // Level 3: Activities
  const [activities, setActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [pushingId, setPushingId] = useState(null);
  const [fetchingTranscriptId, setFetchingTranscriptId] = useState(null);
  const [pushingDemoId, setPushingDemoId] = useState(null);
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
                  } else if ((t.toLowerCase() === 'conversion call' && a.resource_url) || t.toLowerCase() === 'demo conducted') {
                    // Demo conducted = Conversion call with Recording Link, OR explicit Demo Conducted activity
                    counts.meetings++;
                  }
                  // Knet check across all activity types
                  if (String(a.data?.ApplicationPaymentStatus || a.data?.['Application Payment Status'] || a.data?.mx_Custom_16 || a.data?.['16'] || '').toLowerCase() === 'completed') {
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

  const handleGlobalSearch = async (e) => {
    if (e.key === 'Enter' && searchQuery.trim()) {
      try {
        setLoadingLeads(true);
        const res = await searchLeadsByPhone(searchQuery.trim());
        if (res && res.length > 0) {
          // Merge with existing leads, removing duplicates
          setLeads(prev => {
            const newLeads = res.filter(newLead => !prev.some(p => p.prospect_id === newLead.prospect_id));
            return [...newLeads, ...prev];
          });
          
          toast.success("Lead found and loaded!");

          // Fetch activity counts for newly added leads
          for (const l of res) {
            const acts = await getActivitiesForLead(l.prospect_id);
            if (Array.isArray(acts)) {
              const counts = { calls: 0, meetings: 0, knet: 0 };
              acts.forEach(a => {
                const t = a.type || '';
                if (t === 'Inbound' || t === 'Outbound') {
                  const status = (a.status || '').toLowerCase();
                  if (status === 'complete' || status === 'answered') counts.calls++;
                } else if (t.toLowerCase() === 'conversion call' || t.toLowerCase() === 'demo conducted') {
                  counts.meetings++;
                }
                if (String(a.data?.ApplicationPaymentStatus || a.data?.['Application Payment Status'] || a.data?.mx_Custom_16 || a.data?.['16'] || a.data?.mx_Custom_3 || a.data?.['3'] || '').toLowerCase() === 'completed') {
                  counts.knet++;
                }
              });
              setLeadActivityCounts(prev => ({ ...prev, [l.prospect_id]: counts }));
            }
          }
        } else {
          toast.error("No lead found globally with that phone number.");
        }
      } catch (err) {
        console.error("Global search failed:", err);
        toast.error("Search failed. Please try again.");
      } finally {
        setLoadingLeads(false);
      }
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

  const handleFetchTranscript = async (activity) => {
    try {
      setFetchingTranscriptId(activity.activity_id);
      const res = await getDriveTranscript(selectedLeadObj.phone, selectedLeadObj.name);
      if (res.webViewLink) {
        window.open(res.webViewLink, '_blank');
      }
    } catch (err) {
      toast.error(err.message || 'Transcript not found in Google Drive');
    } finally {
      setFetchingTranscriptId(null);
    }
  };

  const handlePushDemoToQC = async (activity) => {
    setPushingDemoId(activity.activity_id);
    try {
      const lead = leads.find(l => l.prospect_id === selectedLead);
      const associate = associates.find(a => a.emp_number === selectedEmp);

      let lang = 'hi';
      if (associate && associate.emp_tags) {
        const match = associate.emp_tags.match(/\|lang:([a-z]{2})/);
        if (match) lang = match[1];
      }

      const res = await pushDemoToQC({
        prospect_id: activity.prospect_id,
        phone: lead?.phone || '',
        name: lead?.name || '',
        emp_number: selectedEmp,
        lead_name: lead?.name || 'Unknown',
        lead_source: lead?.source || 'Phone',
        language: lang
      });

      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success('Google Meet video queued for ASR processing!');
      }
    } catch (err) {
      toast.error('Failed to push demo transcript to QC');
    } finally {
      setPushingDemoId(null);
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
        lead_source: lead?.source || 'Phone',
        call_date: activity.created_on
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
  // Filter activities: strictly whitelist Application Status, Conversion call, Demo Conducted, and completed calls
  const filteredActivities = activities.filter(a => {
    const t = (a.type || '').toLowerCase();
    if (t === 'inbound' || t === 'outbound') {
      const status = (a.status || '').toLowerCase();
      return status === 'complete' || status === 'answered';
    }
    return t === 'application status' || t === 'conversion call' || t === 'demo conducted';
  });

  const selectedAssoc = associates.find(a => a.emp_number === selectedEmp);
  const selectedLeadObj = leads.find(l => l.prospect_id === selectedLead);

  const displayLeads = [...leads]
    .filter(l => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase().trim();
      const digitsOnly = q.replace(/\D/g, '');
      return (l.name || '').toLowerCase().includes(q) || 
             (l.phone || '').toLowerCase().includes(q) ||
             (digitsOnly && (l.phone || '').replace(/\D/g, '').includes(digitsOnly));
    })
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
      // Show if they have calls OR meetings OR knet, or if they searched for it explicitly
      return c && (c.calls > 0 || c.meetings > 0 || c.knet > 0 || searchQuery);
    });


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
          <CardHeader className="pb-4 space-y-3">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                New Leads
              </CardTitle>
              <CardDescription>
                {selectedAssoc ? `For ${selectedAssoc.emp_name}` : "Select an associate"}
              </CardDescription>
            </div>
            {selectedEmp && (
              <div className="relative">
                <Search className="w-4 h-4 absolute left-2.5 top-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search name or phone... (Press Enter for global search)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleGlobalSearch}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}
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
                ) : displayLeads.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm border border-dashed rounded-lg bg-muted/30">
                    No leads match your search criteria.
                  </div>
                ) : (
                  displayLeads.map((l) => {
                    const c = leadActivityCounts[l.prospect_id] || { calls: 0, meetings: 0, knet: 0 };
                    return (
                    <div
                      key={l.prospect_id}
                      onClick={() => selectLead(l.prospect_id)}
                      className={cn(
                        "flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer transition-all duration-200",
                        selectedLead === l.prospect_id 
                          ? "border-primary bg-primary/5 shadow-sm" 
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <div className="font-semibold text-sm text-foreground truncate pr-2">{l.name || 'Unknown Lead'}</div>
                      
                      <div className="flex flex-wrap items-center gap-1.5">
                        {c.calls > 0 && (
                          <Badge variant="secondary" className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                            {c.calls} Calls
                          </Badge>
                        )}
                        {c.meetings > 0 && (
                          <Badge variant="secondary" className="bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                            Demo
                          </Badge>
                        )}
                        {c.knet > 0 && (
                          <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border-emerald-200 text-[10px] px-1.5 py-0 h-4 font-medium">
                            KNET Reg
                          </Badge>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground font-mono">{l.phone}</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider truncate border-l border-border pl-2">
                          {l.source}
                        </span>
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
          <CardHeader className="pb-4 flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <PhoneCall className="w-5 h-5 text-primary" />
                Call Activities
              </CardTitle>
              <CardDescription className="mt-1.5">
                {selectedLeadObj ? `${selectedLeadObj.name} (${selectedLeadObj.phone})` : "Select a lead"}
              </CardDescription>
            </div>
            {selectedLeadObj && (
              <Button 
                variant="outline" 
                size="sm" 
                className="gap-2 h-8 text-xs text-muted-foreground hover:text-primary shrink-0"
                onClick={() => window.open(`https://app-in21.leadsquared.com/LeadDetails?LeadID=${selectedLeadObj.prospect_id}`, '_blank')}
              >
                <ExternalLink className="w-3.5 h-3.5" />
                View in LSQ
              </Button>
            )}
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
                    <div key={a.activity_id} className="relative pl-10 py-3 group">
                      {/* Vertical Line */}
                      <div className="absolute left-[19px] top-8 bottom-[-12px] w-[2px] bg-border group-last:hidden" />
                      
                      {/* Icon */}
                      <div className="absolute left-1 top-4 w-9 h-9 rounded-full bg-background border-2 border-muted flex items-center justify-center text-muted-foreground group-hover:border-primary group-hover:text-primary transition-colors z-10 shadow-sm">
                        {a.type === 'Conversion call' ? (
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-sm" />
                        ) : a.type === 'Inbound' || a.type === 'Outbound' ? (
                          <PhoneCall className="w-4 h-4" />
                        ) : (
                          <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
                        )}
                      </div>
                      
                      {/* Content Row */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-transparent group-hover:bg-muted/30 p-3 -ml-2 rounded-lg transition-colors">
                        <div className="flex flex-col gap-1.5">
                          {/* Title and Badges */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-foreground">{a.type}</span>
                            {((a.type === 'Conversion call' && a.resource_url) || a.type === 'Demo Conducted') && (
                              <Badge variant="secondary" className="bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200 text-[10px] h-5">
                                Demo Conducted ✓
                              </Badge>
                            )}
                            {a.type === 'Conversion call' && !a.resource_url && (
                              <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200 text-[10px] h-5">
                                Conversion Call
                              </Badge>
                            )}
                            {a.data && (String(a.data.ApplicationPaymentStatus || a.data['Application Payment Status'] || a.data.mx_Custom_16 || a.data['16'] || a.data.mx_Custom_3 || a.data['3'] || '').toLowerCase() === 'completed') && (
                              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-emerald-200 text-[10px] h-5">
                                KNET Registered
                              </Badge>
                            )}
                          </div>
                          
                          {/* Sub-info (Timestamp, Status, Duration, Agent) inline */}
                          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-4 gap-y-1">
                            <span className="font-medium">{new Date(a.created_on).toLocaleString()}</span>
                            {(a.type === 'Inbound' || a.type === 'Outbound' || a.type === 'Conversion call' || a.type === 'Demo Conducted') && (
                              <>
                                {a.status && (
                                  <span className="flex items-center gap-1.5 capitalize"><CheckCircle2 className="w-3.5 h-3.5 opacity-70" /> {a.status}</span>
                                )}
                                {a.duration > 0 && (
                                  <span className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5 opacity-70" /> {formatDuration(a.duration)}</span>
                                )}
                                {a.caller && (
                                  <span className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 opacity-70" /> {a.caller}</span>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                        
                        {/* Action Buttons */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Fetch Transcript Button (No resource_url required, searches Drive by phone/name) */}
                          {(a.type === 'Conversion call' || a.type === 'Demo Conducted') && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 shadow-sm text-xs gap-1.5"
                              onClick={() => handleFetchTranscript(a)}
                              disabled={fetchingTranscriptId === a.activity_id}
                            >
                              {fetchingTranscriptId === a.activity_id ? (
                                <><RefreshCw className="w-3 h-3 animate-spin" /> Finding...</>
                              ) : (
                                <><FileText className="w-3 h-3" /> Transcript</>
                              )}
                            </Button>
                          )}

                          {/* Push Demo transcript to QC (fetches from Drive, evaluates directly) */}
                          {(a.type === 'Conversion call' || a.type === 'Demo Conducted') && (
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 shadow-sm text-xs gap-1.5 bg-purple-600 hover:bg-purple-700"
                              onClick={() => handlePushDemoToQC(a)}
                              disabled={pushingDemoId === a.activity_id}
                            >
                              {pushingDemoId === a.activity_id ? (
                                <><RefreshCw className="w-3 h-3 animate-spin" /> Evaluating...</>
                              ) : (
                                <>Push to QC <ArrowRight className="w-3 h-3" /></>
                              )}
                            </Button>
                          )}

                          {/* View Recording (if resource_url exists for demos) */}
                          {(a.type === 'Conversion call' || a.type === 'Demo Conducted') && a.resource_url && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-8 shadow-sm text-xs gap-1.5"
                              onClick={() => window.open(a.resource_url, '_blank')}
                            >
                              <Play className="w-3 h-3" /> View Recording
                            </Button>
                          )}

                          {/* Push audio call to QC (Requires resource_url) */}
                          {(a.type === 'Inbound' || a.type === 'Outbound') && a.resource_url && (
                            <Button
                              size="sm"
                              variant="default"
                              className="h-8 shadow-sm text-xs gap-1.5"
                              onClick={() => handlePushToQC(a)}
                              disabled={pushingId === a.activity_id || a.duration < 60}
                            >
                              {pushingId === a.activity_id ? (
                                <><RefreshCw className="w-3 h-3 animate-spin" /> Pushing</>
                              ) : (
                                <>Push <ArrowRight className="w-3 h-3" /></>
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
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
