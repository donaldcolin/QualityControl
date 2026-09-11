import { useState, useEffect } from 'react';
import RunPanel from './components/RunPanel';
import Dashboard from './components/Dashboard';
import ReviewView from './components/ReviewView';
import TeamQC from './components/TeamQC';
import QueueView from './components/QueueView';
import LeadsDashboard from './components/LeadsDashboard';
import LeadDetails from './components/LeadDetails';
import ParametersManager from './components/ParametersManager';
import { Users, PlaySquare, LayoutDashboard, ListOrdered, Target, Settings, ChevronRight } from 'lucide-react';
import { cn } from './lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

function AppContent() {
  const [currentView, setCurrentView] = useState('teamqc');
  const [selectedCall, setSelectedCall] = useState(null);
  const [activeQueueId, setActiveQueueId] = useState(null);
  const [isRunPanelOpen, setIsRunPanelOpen] = useState(true);

  const handleSelectCall = (id) => {
    setSelectedCall(id);
    setCurrentView('review');
  };

  const NavButton = ({ id, label, icon: Icon }) => (
    <Button
      variant={currentView === id ? "secondary" : "ghost"}
      className={cn(
        "w-full justify-start gap-3 h-11 px-4 text-sm font-medium transition-all duration-200",
        currentView === id ? "bg-muted shadow-sm" : "hover:bg-muted/50"
      )}
      onClick={() => {
        if (id !== 'review') setCurrentView(id);
      }}
    >
      <Icon className={cn("w-4 h-4", currentView === id ? "text-primary" : "text-muted-foreground")} />
      <span className={currentView === id ? "font-semibold" : ""}>{label}</span>
      {currentView === id && <ChevronRight className="w-4 h-4 ml-auto text-muted-foreground opacity-50" />}
    </Button>
  );

  return (
    <div className="h-screen flex overflow-hidden bg-background text-foreground font-sans">
      
      {/* LEFT SIDEBAR (Navigation) */}
      <div className="w-[260px] flex-shrink-0 flex flex-col border-r bg-muted/20">
        <div className="h-14 border-b flex items-center px-6">
          <h1 className="text-lg font-bold tracking-tight">
            QC <span className="text-primary">Bake-off</span>
          </h1>
        </div>
        <div className="p-4 space-y-1.5 flex-1 overflow-y-auto">
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3 px-2 mt-2">
            Workspace
          </div>
          <NavButton id="teamqc" label="Team QC" icon={Users} />
          <NavButton id="queue" label="Queue" icon={ListOrdered} />
          <NavButton id="dashboard" label="Dashboard" icon={LayoutDashboard} />
          
          <Separator className="my-4" />
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3 px-2">
            Intelligence
          </div>
          <NavButton id="leads" label="Leads QC" icon={Target} />
          
          <Separator className="my-4" />
          <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase mb-3 px-2">
            Settings
          </div>
          <NavButton id="parameters" label="Parameters" icon={Settings} />
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden bg-background relative">
        {/* Top Header to Toggle Run Panel */}
        <header className="h-14 border-b flex items-center justify-end px-4 flex-shrink-0 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
          <Button 
            variant={isRunPanelOpen ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setIsRunPanelOpen(!isRunPanelOpen)}
            className="gap-2 h-9"
          >
            <PlaySquare className={cn("w-4 h-4", isRunPanelOpen ? "text-primary" : "")} />
            {isRunPanelOpen ? "Hide Runner" : "Show Runner"}
          </Button>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          <div className="max-w-6xl mx-auto pb-12 animate-in fade-in duration-500">
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
            {currentView === 'dashboard' && <Dashboard onSelectCall={handleSelectCall} />}
            {currentView === 'leads' && (
              <LeadsDashboard onSelectLead={(id) => { setSelectedCall(id); setCurrentView('lead_details'); }} />
            )}
            {currentView === 'lead_details' && (
              <LeadDetails leadId={selectedCall} onBack={() => setCurrentView('leads')} />
            )}
            {currentView === 'review' && (
              <ReviewView callId={selectedCall} onBack={() => setCurrentView('dashboard')} />
            )}
            {currentView === 'parameters' && <ParametersManager />}
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
