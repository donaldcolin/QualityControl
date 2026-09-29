import { useState, useEffect } from 'react';
import RunPanel from './components/RunPanel';

import TeamQC from './components/TeamQC';
import QueueView from './components/QueueView';
import LeadsDashboard from './components/LeadsDashboard';
import LeadDetails from './components/LeadDetails';
import MeetSyncView from './components/MeetSyncView';
import ConversationInsights from './components/ConversationInsights';
import ParametersManager from './components/ParametersManager';
import Sidebar from './components/Sidebar';
import { PlaySquare } from 'lucide-react';
import { cn } from './lib/utils';
import { Button } from '@/components/ui/button';

function AppContent() {
  const [currentView, setCurrentView] = useState('teamqc');
  const [selectedCall, setSelectedCall] = useState(null);
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [activeQueueId, setActiveQueueId] = useState(null);
  const [isRunPanelOpen, setIsRunPanelOpen] = useState(true);
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [embeddedLeadId, setEmbeddedLeadId] = useState(null);

  useEffect(() => {
    // Check if we are embedded in an iframe (e.g., LeadSquared)
    const urlParams = new URLSearchParams(window.location.search);
    const leadIdParam = urlParams.get('leadId');
    // If LeadSquared passes the ID, it might look like ?leadId=@Lead.Id
    if (leadIdParam && !leadIdParam.startsWith('@')) {
      setIsEmbedded(true);
      setEmbeddedLeadId(leadIdParam);
    }
  }, []);



  // If embedded in an iframe (like LeadSquared), ONLY render the Lead Details view
  if (isEmbedded && embeddedLeadId) {
    return (
      <div className="h-screen w-screen overflow-y-auto bg-background text-foreground font-sans">
        <LeadDetails leadId={embeddedLeadId} onBack={() => {}} />
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground font-sans">
      
      {/* LEFT SIDEBAR (Collapsible Component) */}
      <Sidebar currentView={currentView} setCurrentView={setCurrentView} />

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-muted/10 relative">
        {/* Top Header to Toggle Run Panel */}
        <header className="h-16 border-b flex items-center justify-between px-6 flex-shrink-0 bg-background/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
          <div className="text-sm font-medium text-muted-foreground">
             {/* Simple breadcrumb or empty space */}
          </div>
          <Button 
            variant={isRunPanelOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setIsRunPanelOpen(!isRunPanelOpen)}
            className="gap-2 h-9 shadow-sm transition-all"
          >
            <PlaySquare className={cn("w-4 h-4", isRunPanelOpen ? "text-primary" : "")} />
            {isRunPanelOpen ? "Hide Runner" : "Show Runner"}
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-6 md:p-8 scrollbar-thin">
          <div className="max-w-7xl mx-auto pb-12 animate-in fade-in duration-500">
            {currentView === 'teamqc' && (
              <TeamQC 
                onPushToQueue={(queueId) => {
                  setActiveQueueId(queueId);
                  setIsRunPanelOpen(true);
                }} 
              />
            )}
            {currentView === 'queue' && (
              <QueueView 
                onRunStart={(queueId) => {
                  setActiveQueueId(queueId);
                  setIsRunPanelOpen(true);
                }} 
              />
            )}

            {currentView === 'insights_owners' && (
              <ConversationInsights onSelectOwner={(owner) => { setSelectedOwner(owner); setCurrentView('leads'); }} />
            )}
            {currentView === 'leads' && (
              <LeadsDashboard 
                owner={selectedOwner}
                onSelectLead={(id) => { setSelectedCall(id); setCurrentView('lead_details'); }} 
                onBack={() => setCurrentView('insights_owners')}
              />
            )}
            {currentView === 'lead_details' && (
              <LeadDetails leadId={selectedCall} onBack={() => setCurrentView('leads')} />
            )}

            {currentView === 'parameters' && <ParametersManager />}
            {currentView === 'meet_sync' && <MeetSyncView />}
          </div>
        </main>
      </div>

      {/* RIGHT SIDEBAR (Run Panel) */}
      {isRunPanelOpen && (
        <div className="w-[320px] flex-shrink-0 border-l bg-muted/10 h-screen overflow-y-auto animate-in slide-in-from-right-1/4 duration-300 shadow-2xl">
          <RunPanel isSidebar={true} activeQueueId={activeQueueId} />
        </div>
      )}
      
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
