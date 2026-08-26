import { useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { MainContent } from './components/MainContent';
import { AIPanel } from './components/AIPanel';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  return (
    <div className="flex h-[100dvh] w-full bg-canvas text-text-primary overflow-hidden selection:bg-accent-blue/30 relative">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden transition-opacity" 
          onClick={() => setSidebarOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <div className={cn(
        "fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ease-out lg:relative lg:transform-none shadow-2xl lg:shadow-none",
        sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
      )}>
        <Sidebar />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 border-l border-r border-border-subtle relative h-full">
        <MainContent 
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenAIPanel={() => setAiPanelOpen(true)}
        />
      </div>

      {/* Mobile/Tablet AI Panel Overlay */}
      {aiPanelOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 xl:hidden transition-opacity" 
          onClick={() => setAiPanelOpen(false)}
        />
      )}

      {/* AI Panel */}
      <div className={cn(
        "fixed inset-y-0 right-0 z-50 transform transition-transform duration-300 ease-out xl:relative xl:transform-none shadow-2xl xl:shadow-none",
        aiPanelOpen ? "translate-x-0" : "translate-x-full xl:translate-x-0"
      )}>
        <AIPanel onClose={() => setAiPanelOpen(false)} />
      </div>
    </div>
  );
}
