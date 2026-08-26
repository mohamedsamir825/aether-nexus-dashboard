import type { ReactNode } from 'react';
import { X, FileText, Check, ArrowRight, Settings2, Plus, RefreshCw } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function AIPanel({ onClose }: { onClose?: () => void }) {
  return (
    <div className="w-[100vw] sm:w-[380px] h-full flex flex-col bg-surface border-l border-border-subtle shrink-0">
      
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-border-subtle shrink-0">
        <div className="flex gap-3 items-center">
          <div className="flex-col flex">
            <h2 className="text-[14px] font-semibold text-white leading-tight flex items-center gap-1.5">
              <div className="w-3.5 h-3.5 bg-sky-400 rounded-sm" /> 
              AURA
            </h2>
            <p className="text-[12px] text-text-tertiary leading-tight mt-0.5">Thinking with Nexus context</p>
          </div>
        </div>
        <button aria-label="Close AURA panel" onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface-raised text-text-tertiary hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
        
        {/* Context Chip */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border-focus bg-canvas w-fit mt-2">
          <FileText size={12} className="text-text-tertiary" />
          <span className="text-[12px] text-text-primary">
            <span className="text-text-secondary">Context:</span> <span className="font-mono">/nexus/narrative</span> · 4 root nodes
          </span>
        </div>

        {/* User Prompt */}
        <div className="self-end max-w-[85%] bg-surface-raised border border-border-subtle rounded-2xl rounded-tr-sm px-4 py-3">
          <p className="text-[14px] text-text-secondary leading-relaxed">
            Pull the open anomalies from the launch narrative and draft a 5-bullet diagnostic.
          </p>
        </div>

        {/* AI Response Area */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-white">AURA</span>
            <span className="text-[11px] text-text-tertiary font-mono">· 2.1s</span>
          </div>
          
          <p className="text-[14px] text-text-primary leading-relaxed">
            Here's a draft synthesizing the log narrative, the open threads in <span className="font-semibold text-white">#nexus-core</span>, and last cycle's log:
          </p>

          {/* Generated Document Card */}
          <div className="border border-border-subtle bg-canvas rounded-xl flex flex-col overflow-hidden my-1">
            <div className="px-4 py-3 border-b border-border-subtle flex justify-between items-center bg-surface-raised/30">
              <span className="text-[11px] font-semibold text-text-secondary tracking-widest uppercase">Diagnostic · Nexus · Cycle 14</span>
            </div>
            
            <div className="flex flex-col py-2 px-4 gap-3 bg-canvas">
              <BulletRow num="01" text={<>Resource Tier 4 locked &mdash; protocols moving to security audit</>} risk="stable" />
              <BulletRow num="02" text={<>Boot sequence rev.3 queued for authorization (compiled this cycle)</>} risk="awaiting auth" highlightRisk />
              <BulletRow num="03" text={<>Quantum Streams beta deployed &mdash; 38 connections, 2 critical anomalies</>} risk="elevated" />
              <BulletRow num="04" text={<>Visual overhaul delayed 4 cycles; Rhea suggests reducing render fidelity</>} risk="requires link" />
              <BulletRow num="05" text={<>Sector Alpha initialization pending &mdash; parameters undocumented in vault</>} risk="action req" highlightRisk />
            </div>

            <div className="px-4 py-3 flex gap-2 border-t border-border-subtle bg-surface-raised/30 flex-wrap mt-2">
               <Tag label="syslog.md" />
               <Tag label="diagnostics/2026" />
               <Tag label="#nexus-core" />
               <Tag label="resource-v4" />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-2 gap-2 mt-2 w-full">
            <button className="col-span-2 justify-center flex items-center gap-1.5 px-3 py-1.5 bg-white text-black hover:bg-gray-200 rounded-[6px] text-[12.5px] font-medium transition-colors shadow-sm whitespace-nowrap">
               <Check size={14} /> Commit to log
            </button>
            <button className="col-span-1 justify-center flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised border border-border-subtle text-text-primary hover:bg-surface-hover rounded-[6px] text-[12.5px] font-medium transition-colors truncate">
              Broadcast
            </button>
            <button className="col-span-1 justify-center flex items-center gap-1.5 px-3 py-1.5 bg-surface-raised border border-border-subtle text-text-primary hover:bg-surface-hover rounded-[6px] text-[12.5px] font-medium transition-colors whitespace-nowrap">
              Recalculate
            </button>
          </div>
        </div>

      </div>

      {/* Composer */}
      <div className="p-4 border-t border-border-subtle bg-surface">
        <div className="border border-border-focus bg-canvas rounded-xl p-3 flex flex-col gap-3 focus-within:border-white/30 transition-colors shadow-sm">
          <textarea 
             className="bg-transparent border-none text-[14px] text-text-primary resize-none outline-none min-h-[40px] placeholder:text-text-tertiary"
             aria-label="Query AURA"
             placeholder="Query AURA or @-mention a node..."
          />
          <div className="flex justify-between items-center">
            <div className="flex gap-1">
              <button aria-label="Attach context" className="w-7 h-7 rounded-md hover:bg-surface-raised flex items-center justify-center text-text-tertiary transition-colors border border-transparent hover:border-border-subtle">
                <Plus size={14} />
              </button>
              <button aria-label="Refresh context" className="w-7 h-7 rounded-md hover:bg-surface-raised flex items-center justify-center text-text-tertiary transition-colors border border-transparent hover:border-border-subtle">
                <RefreshCw size={13} />
              </button>
              <button aria-label="Open AURA settings" className="w-7 h-7 rounded-md hover:bg-surface-raised flex items-center justify-center text-text-tertiary transition-colors border border-transparent hover:border-border-subtle">
                <Settings2 size={14} />
              </button>
            </div>
            
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-text-tertiary font-mono">aura-1.5 · linked</span>
              <button className="flex items-center gap-1 bg-sky-500 text-white px-3 py-1.5 rounded-lg text-[13px] font-medium hover:bg-sky-400 transition-colors shadow-sm">
                Transmit <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helpers
type BulletRowProps = {
  num: string;
  text: ReactNode;
  risk: string;
  highlightRisk?: boolean;
};

function BulletRow({ num, text, risk, highlightRisk }: BulletRowProps) {
  return (
    <div className="flex items-start gap-4 p-1">
      <span className="text-[12px] text-text-tertiary font-mono w-4 shrink-0 pt-0.5">{num}</span>
      <p className="text-[13px] text-text-primary flex-1 leading-snug">{text}</p>
      <span className={cn(
        "text-[10px] font-mono whitespace-nowrap shrink-0 pt-0.5 mt-0.5 uppercase tracking-wide",
        highlightRisk ? "text-text-secondary" : "text-text-tertiary"
      )}>
        {risk}
      </span>
    </div>
  )
}

function Tag({ label }: { label: string }) {
  return (
    <span className="px-2 py-0.5 rounded-[4px] bg-white/5 border border-white/10 text-text-secondary text-[11px] font-mono hover:bg-white/10 cursor-pointer transition-colors">
      {label}
    </span>
  )
}
