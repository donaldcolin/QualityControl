import { useState } from 'react';
import { 
  Users, 
  ListOrdered, 
  Settings, 
  ChevronRight, 
  ChevronLeft,
  BarChart3,
  Video
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import LogoLarge from '../assets/LogoLarge.png';
import LogoSmall from '../assets/LogoSmall.png';

export default function Sidebar({ currentView, setCurrentView }) {
  const [isHovered, setIsHovered] = useState(false);
  
  const isCollapsed = !isHovered;

  const NavButton = ({ id, label, icon: Icon }) => (
    <Button
      variant={currentView === id ? "secondary" : "ghost"}
      className={cn(
        "justify-start h-11 transition-all duration-200 group relative",
        isCollapsed ? "w-11 px-0 mx-auto flex items-center justify-center" : "w-full px-4 gap-3",
        currentView === id 
          ? "bg-primary/10 text-primary hover:bg-primary/20" 
          : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
      )}
      onClick={() => {
        if (id !== 'review') setCurrentView(id);
      }}
      title={isCollapsed ? label : undefined}
    >
      <Icon className={cn("flex-shrink-0 transition-colors", isCollapsed ? "w-5 h-5" : "w-4 h-4")} />
      {!isCollapsed && (
        <>
          <span className={cn("text-sm transition-all", currentView === id ? "font-semibold" : "font-medium")}>
            {label}
          </span>
          {currentView === id && <ChevronRight className="w-4 h-4 ml-auto opacity-50" />}
        </>
      )}
    </Button>
  );

  return (
    <div 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        "flex-shrink-0 flex flex-col border-r bg-background/50 backdrop-blur-xl transition-all duration-300 ease-in-out relative shadow-sm z-20 overflow-hidden",
        isCollapsed ? "w-[72px]" : "w-[260px]"
      )}
    >


      {/* Header */}
      <div className={cn("h-16 flex items-center border-b border-border/50 transition-all", isCollapsed ? "justify-center px-0" : "px-4")}>
        <div className="flex items-center w-full justify-center">
          {isCollapsed ? (
            <img src={LogoSmall} alt="Logo" className="h-8 w-8 object-contain animate-in fade-in" />
          ) : (
            <img src={LogoLarge} alt="Quality Control" className="h-8 object-contain animate-in fade-in mr-auto" />
          )}
        </div>
      </div>
      
      {/* Navigation Links */}
      <div className="p-3 space-y-1.5 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {!isCollapsed && (
          <div className="text-[11px] font-bold text-muted-foreground tracking-wider uppercase mb-3 px-3 mt-4">
            Workspace
          </div>
        )}
        <NavButton id="teamqc" label="Team QC" icon={Users} />
        <NavButton id="queue" label="Queue" icon={ListOrdered} />
        <NavButton id="meet_sync" label="Meet Sync" icon={Video} />

        
        <Separator className="my-4 opacity-50 mx-2" />
        
        {!isCollapsed && (
          <div className="text-[11px] font-bold text-muted-foreground tracking-wider uppercase mb-3 px-3">
            Intelligence
          </div>
        )}
        <NavButton id="insights_owners" label="Conversation Insights" icon={BarChart3} />
        
        <Separator className="my-4 opacity-50 mx-2" />
        
        {!isCollapsed && (
          <div className="text-[11px] font-bold text-muted-foreground tracking-wider uppercase mb-3 px-3">
            Settings
          </div>
        )}
        <NavButton id="parameters" label="Parameters" icon={Settings} />
      </div>

      {/* Footer Profile area (mocked) */}
      <div className="p-4 border-t border-border/50">
         <div className={cn("flex items-center", isCollapsed ? "justify-center" : "gap-3")}>
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-sm font-bold border border-border shadow-sm text-muted-foreground">
               U
            </div>
            {!isCollapsed && (
               <div className="flex flex-col overflow-hidden animate-in fade-in">
                  <span className="text-sm font-semibold truncate">Demo User</span>
                  <span className="text-xs text-muted-foreground truncate">admin@kalvium.com</span>
               </div>
            )}
         </div>
      </div>
    </div>
  );
}
