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
import { PlaySquare, X } from 'lucide-react';
import { cn } from './lib/utils';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';

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
    const leadIdParam = urlParams.get('leadId') || urlParams.get('LeadID') || urlParams.get('leadid') || urlParams.get('id');
    
    if (leadIdParam) {
      // LeadSquared sometimes wraps the ID in @{uuid} format, so we strip those characters
      const cleanId = leadIdParam.replace(/[@{}]/g, '');
      setIsEmbedded(true);
      setEmbeddedLeadId(cleanId);
    }
  }, []);

  // If embedded in an iframe (like LeadSquared), ONLY render the Lead Details view
  if (isEmbedded && embeddedLeadId) {
    // LeadSquared might still pass the literal unreplaced tag if the lead is missing an ID, 
    // but a real UUID will now be cleaned (e.g., d4786b13-ba85-45d3-9bc3-838ce4751f39)
    if (embeddedLeadId === 'Lead:ProspectID' || embeddedLeadId === 'Lead.ProspectID') {
      return (
        <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground font-sans p-8 text-center">
          <div>
            <h2 className="text-xl font-bold text-red-600 mb-2">Configuration Error</h2>
            <p>LeadSquared did not replace the merge field. Check your Custom Tab URL setup.</p>
          </div>
        </div>
      );
    }

    return (
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground font-sans">
        <LeadDetails leadId={embeddedLeadId} onBack={() => { }} embedded={true} />
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground font-sans">

      {/* LEFT SIDEBAR (Collapsible Component) */}
      <Sidebar currentView={currentView} setCurrentView={setCurrentView} />

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-muted/10 relative">


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
        <div className="w-[320px] flex-shrink-0 border-l bg-muted/10 h-screen overflow-y-auto animate-in slide-in-from-right-1/4 duration-300 shadow-2xl relative">
          <Button
            onClick={() => setIsRunPanelOpen(false)}
            size="icon"
            variant="ghost"
            className="absolute top-4 right-4 z-50 h-8 w-8 rounded-full bg-background/50 backdrop-blur-sm hover:bg-background"
          >
            <X className="h-4 w-4" />
          </Button>
          <RunPanel isSidebar={true} activeQueueId={activeQueueId} />
        </div>
      )}

      {/* Floating Toggle Button */}
      {!isRunPanelOpen && (
        <Button
          onClick={() => setIsRunPanelOpen(true)}
          size="lg"
          className="fixed bottom-6 right-6 shadow-xl gap-2 rounded-full z-50 px-6 py-6 animate-in fade-in zoom-in duration-300 bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <PlaySquare className="w-5 h-5" />

        </Button>
      )}

    </div>
  );
}

export default function App() {
  return (
    <>
      <AppContent />
      <Toaster position="bottom-right" richColors />
    </>
  );
}
