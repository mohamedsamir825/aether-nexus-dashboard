import { 
  Search, Home, Inbox, Layers, FileText, MessageSquare, 
  LayoutGrid, ChevronsUpDown, ArrowRight, MoreHorizontal
} from 'lucide-react';
import type { ReactNode } from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Sidebar() {
  return (
    <div className="w-[280px] sm:w-[260px] h-full flex flex-col bg-canvas border-r border-border-subtle shrink-0">
      {/* Workspace Switcher */}
      <div className="h-14 flex items-center justify-between px-4 mt-2">
        <button className="flex items-center gap-3 flex-1 hover:bg-surface-hover p-2 -ml-2 rounded-lg transition-colors group">
          <div className="w-8 h-8 rounded-md bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center border border-white/10 shrink-0">
            <Layers size={14} className="text-zinc-300" />
          </div>
          <div className="flex flex-col items-start flex-1 text-left min-w-0">
            <span className="text-[13px] font-medium leading-tight truncate w-full tracking-wide">Aether Nexus</span>
            <span className="text-[11px] text-text-secondary leading-tight mt-0.5 truncate w-full">Squadcon · 24 nodes</span>
          </div>
          <ChevronsUpDown size={14} className="text-text-tertiary group-hover:text-text-secondary transition-colors shrink-0" />
        </button>
      </div>

      {/* Search */}
      <div className="px-4 py-2">
        <button className="flex items-center gap-2 w-full h-8 px-2.5 bg-surface rounded-md border border-border-subtle text-text-tertiary hover:border-border-focus hover:text-text-primary transition-colors group shadow-sm">
          <Search size={14} />
          <span className="text-[13px] flex-1 text-left">Query AURA...</span>
          <div className="flex gap-1">
            <kbd className="h-5 px-1.5 flex items-center bg-white/5 border border-white/10 rounded-[4px] text-[10px] font-mono group-hover:border-white/20">Cmd</kbd>
            <kbd className="h-5 px-1.5 flex items-center bg-white/5 border border-white/10 rounded-[4px] text-[10px] font-mono group-hover:border-white/20">K</kbd>
          </div>
        </button>
      </div>

      {/* Main Nav */}
      <div className="px-2 py-2 flex-1 overflow-y-auto">
        <nav className="space-y-[2px]">
          <NavItem icon={<Home size={16} />} label="Core View" active />
          <NavItem icon={<Inbox size={16} />} label="Comms" badge="12" />
          <NavItem icon={<Layers size={16} />} label="Sectors" />
          <NavItem icon={<FileText size={16} />} label="Archives" />
          <NavItem icon={<MessageSquare size={16} />} label="Streams" />
          <NavItem icon={<LayoutGrid size={16} />} label="Modules" />
        </nav>

        {/* Projects section */}
        <div className="mt-8 mb-2 px-3">
          <h3 className="text-[11px] font-medium text-text-tertiary uppercase tracking-wider">Active Nodes</h3>
        </div>
        <div className="space-y-[2px]">
          <ProjectItem color="bg-sky-500" label="Q3 Launch · Stellar" />
          <ProjectItem color="bg-accent-green" label="Visual Overhaul" />
          <ProjectItem color="bg-yellow-500" label="Resource Allocation" />
          <ProjectItem color="bg-accent-purple" label="Data Vault" />
          <ProjectItem color="bg-text-tertiary" label="Core Directives" />
        </div>
      </div>

      {/* Footer Area */}
      <div className="p-4 border-t border-border-subtle flex flex-col gap-4">
        <div className="bg-surface rounded-lg p-3 border border-border-subtle flex flex-col gap-2">
          <h4 className="text-[13px] font-medium">Compute Allocation</h4>
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
              <div className="h-full bg-white/20 rounded-full w-[62%]" />
            </div>
            <span className="text-[12px] text-text-secondary">3,124 of 5,000 teraflops consumed</span>
          </div>
          <button className="text-[12px] text-accent-blue font-medium text-left flex items-center gap-1 hover:text-blue-400 mt-1 w-fit">
            Upgrade capacity <ArrowRight size={12} />
          </button>
        </div>

        <button className="flex items-center gap-2 hover:bg-surface-hover p-1.5 -mx-1.5 rounded-lg transition-colors group">
          <div className="w-7 h-7 rounded-full bg-cyan-900/40 text-cyan-400 flex items-center justify-center text-[12px] font-medium shrink-0 border border-cyan-500/20">
            NV
          </div>
          <span className="text-[13px] font-medium flex-1 text-left">Nova Vance</span>
          <MoreHorizontal size={14} className="text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      </div>
    </div>
  );
}

function NavItem({ icon, label, badge, active }: { icon: ReactNode, label: string, badge?: string, active?: boolean }) {
  return (
    <button className={cn(
      "w-full h-8 flex items-center gap-2.5 px-2.5 rounded-md transition-colors text-[13px]",
      active 
        ? "bg-surface-raised text-text-primary" 
        : "text-text-secondary hover:bg-surface hover:text-text-primary"
    )}>
      <span className={cn(active ? "text-text-secondary" : "text-text-tertiary")}>{icon}</span>
      <span className="flex-1 text-left font-medium">{label}</span>
      {badge && <span className="text-[11px] font-medium text-text-tertiary">{badge}</span>}
    </button>
  );
}

function ProjectItem({ color, label }: { color: string, label: string }) {
  return (
    <button className="w-full h-8 flex items-center gap-3 px-3 rounded-md transition-colors text-[13.5px] text-text-secondary hover:bg-surface hover:text-text-primary">
      <div className={cn("w-2 h-2 rounded-full", color)} />
      <span className="flex-1 text-left truncate">{label}</span>
    </button>
  );
}
