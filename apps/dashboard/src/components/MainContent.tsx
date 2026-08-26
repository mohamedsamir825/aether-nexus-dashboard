import type { ReactNode } from 'react';
import { 
  Menu, Sparkles, Sun, Bell, Plus, TrendingUp, TrendingDown,
  FileText, CheckSquare, MessageCircle, File
} from 'lucide-react';
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Chart Dummy Data
const workspaceData = [
  { name: 'APR 30', manual: 40, ai: 20 },
  { name: 'MAY 03', manual: 55, ai: 30 },
  { name: 'MAY 06', manual: 45, ai: 60 },
  { name: 'MAY 09', manual: 60, ai: 85 },
  { name: 'MAY 11', manual: 70, ai: 112 },
  { name: 'MAY 12', manual: 55, ai: 85 },
];

const sparklineData1 = [{v: 10}, {v: 12}, {v: 25}, {v: 20}, {v: 35}, {v: 42}];
const sparklineData2 = [{v: 5}, {v: 10}, {v: 12}, {v: 18}, {v: 17}, {v: 18.4}];
const sparklineData3 = [{v: 40}, {v: 38}, {v: 39}, {v: 37}, {v: 37}, {v: 37}];
const sparklineData4 = [{v: 15}, {v: 14}, {v: 12}, {v: 11}, {v: 10}, {v: 9}];

export function MainContent({ onOpenSidebar, onOpenAIPanel }: { onOpenSidebar?: () => void, onOpenAIPanel?: () => void }) {
  return (
    <div className="h-full flex flex-col overflow-y-auto overflow-x-hidden bg-canvas">
      {/* Header */}
      <header className="h-14 flex items-center px-4 md:px-8 border-b border-border-subtle shrink-0 justify-between sticky top-0 bg-canvas/80 backdrop-blur-md z-20">
        <div className="flex items-center gap-3">
          {/* Mobile menu button */}
            <button aria-label="Open sidebar" onClick={onOpenSidebar} className="lg:hidden p-1.5 -ml-1.5 text-text-tertiary hover:text-text-primary rounded-md hover:bg-surface transition-colors">
              <Menu size={18} />
            </button>
          
          <div className="text-[13px] text-text-secondary items-center gap-2 hidden sm:flex font-mono">
            <span>Aether Nexus</span>
            <span className="text-border-focus">/</span>
            <span>Core</span>
            <span className="text-border-focus">/</span>
            <span className="text-text-primary">Current Cycle</span>
          </div>
          <div className="text-[13px] text-text-primary sm:hidden font-medium">Core</div>
        </div>
        
        <div className="flex items-center gap-2 md:gap-4">
          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-surface border border-border-subtle rounded-full cursor-default">
            <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            <span className="text-[12px] text-text-secondary">All systems nominal</span>
          </div>
          
          <div className="flex items-center space-x-1 md:space-x-2">
            <button aria-label="Toggle theme" className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md hover:bg-surface transition-colors text-text-tertiary hover:text-text-primary">
              <Sun size={14} />
            </button>
            <button aria-label="Open notifications" className="hidden sm:flex w-8 h-8 items-center justify-center rounded-md hover:bg-surface transition-colors text-text-tertiary hover:text-text-primary relative">
              <Bell size={14} />
            </button>
            
            {/* Mobile AI Panel button */}
            <button aria-label="Open AURA panel" onClick={onOpenAIPanel} className="xl:hidden w-8 h-8 flex items-center justify-center rounded-md hover:bg-surface transition-colors text-text-primary">
              <Sparkles size={16} className="text-accent-blue" />
            </button>

            <div className="hidden sm:block w-[1px] h-4 bg-border-subtle mx-1 md:mx-2" />
            <button className="h-8 px-2 md:px-3 flex items-center gap-1.5 bg-white text-black hover:bg-gray-200 rounded-md text-[13px] font-medium transition-colors">
              <Plus size={14} /> <span className="hidden sm:inline">Add Node</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Body */}
      <div className="p-[clamp(1rem,3vw,2rem)] lg:p-8 max-w-[1200px] w-full mx-auto flex flex-col gap-4 md:gap-6">
        
        {/* Hero */}
        <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-white">Systems active, Nova</h1>
            <p className="text-[13px] sm:text-[14px] text-text-secondary">4 anomalies detected. 2 logs synthesized last cycle.</p>
          </div>
          
          <div className="flex items-center gap-4 sm:gap-6 w-full sm:w-auto justify-between sm:justify-end">
            <div className="text-[12px] sm:text-[13px] text-text-tertiary hidden sm:block font-mono">
              Cycle 13 · Sector 7 · 14:14
            </div>
            
            {/* Segmented Control */}
            <div className="flex p-0.5 bg-surface border border-border-subtle rounded-lg w-full sm:w-auto overflow-x-auto hide-scrollbar">
              {['Cycle', 'Phase', 'Orbit', 'Epoch'].map((tab) => (
                <button
                  key={tab}
                  className={cn(
                    "flex-1 sm:flex-none px-3 py-1 rounded-md text-[12px] sm:text-[13px] font-medium transition-all whitespace-nowrap",
                    tab === 'Phase' 
                      ? "bg-white/10 text-white shadow-sm" 
                      : "text-text-tertiary hover:text-text-primary"
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          <KpiCard title="Active Streams" metric="42" suffix="nodes" trend="up" trendVal="8 this cycle" data={sparklineData1} sparklineColor="#0ea5e9" />
          <KpiCard title="Time saved by AURA" metric="18.4" suffix="hrs" trend="up" trendVal="22%" data={sparklineData2} sparklineColor="#828691" />
          <KpiCard title="Nodes Compiled" metric="37" trend="neutral" trendVal="same" data={sparklineData3} sparklineColor="#828691" />
          <KpiCard title="Deltas Logged" metric="9" trend="down" trendVal="3 vs last cycle" data={sparklineData4} sparklineColor="#828691" />
        </div>

        {/* Middle Row: Chart + Queue */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4">
          
          {/* Main Chart */}
          <div className="lg:col-span-12 xl:col-span-7 bg-surface border border-border-subtle rounded-xl p-4 md:p-5 flex flex-col overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                <h3 className="text-[14px] font-medium text-white shadow-sm">Network Throughput</h3>
                <p className="text-[13px] text-text-secondary mt-1">Last 14 cycles · global nodes</p>
              </div>
              <div className="flex gap-4 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 hide-scrollbar shrink-0">
                {['Telemetry', 'Yield', 'Diagnostics'].map((tab) => (
                  <button key={tab} className={cn(
                    "text-[13px] pb-1 border-b-2 transition-colors",
                    tab === 'Telemetry' ? "border-white text-white" : "border-transparent text-text-tertiary hover:text-text-secondary"
                  )}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex-1 min-h-[220px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={workspaceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAi" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.15}/>
                      <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#ffffff08" vertical={false} />
                  <XAxis dataKey="name" stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} tickMargin={12} minTickGap={30} />
                  <YAxis stroke="#6b7280" fontSize={10} tickLine={false} axisLine={false} ticks={[30, 60, 90, 120]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#12141a', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
                    itemStyle={{ color: '#fff' }}
                    cursor={{ stroke: 'rgba(255,255,255,0.1)', strokeWidth: 1, strokeDasharray: '4 4' }}
                  />
                  <Area type="monotone" dataKey="ai" stroke="#0ea5e9" strokeWidth={2} fillOpacity={1} fill="url(#colorAi)" activeDot={{ r: 4, fill: '#0ea5e9', stroke: '#12141a', strokeWidth: 2 }} />
                  <Area type="monotone" dataKey="manual" stroke="#6b7280" strokeWidth={1.5} fill="none" activeDot={{ r: 4, fill: '#6b7280', stroke: '#12141a', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            
            <div className="flex justify-between items-center mt-4">
              <div className="flex gap-4">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-[2px] bg-sky-500" />
                  <span className="text-[11px] text-text-secondary uppercase">AURA-assisted</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-[2px] bg-text-tertiary" />
                  <span className="text-[11px] text-text-secondary uppercase">Manual</span>
                </div>
              </div>
              <span className="text-[10px] tracking-wider text-text-tertiary uppercase">Updated 14:11</span>
            </div>
          </div>

          {/* Review Queue */}
          <div className="lg:col-span-12 xl:col-span-5 bg-surface border border-border-subtle rounded-xl p-4 md:p-5 flex flex-col overflow-hidden">
            <div className="flex justify-between items-start mb-5 gap-2">
              <div>
                <h3 className="text-[14px] font-medium text-white shadow-sm">Priority Tasks</h3>
                <p className="text-[13px] text-text-secondary mt-1">Drafted by AURA · awaiting your clearance</p>
              </div>
              <span className="text-[13px] font-medium text-text-tertiary">6 items</span>
            </div>
            
            <div className="flex flex-col gap-[2px]">
              <ReviewRow label="Authorize protocol update" badges={[{t:'AI · 92%', c:'bg-blue-500/10 text-blue-400 border-blue-500/20'}]} avatars={[{c:'bg-blue-700', i:'EM'}]} />
              <ReviewRow label="Spec: Quantum Streams — verify" badges={[{t:'REVIEW', c:'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'}]} avatars={[{c:'bg-purple-700', i:'JC'}, {c:'bg-green-700', i:'NL'}]} />
              <ReviewRow label='Resolve 3 deadlocks on "Core' badges={[{t:'DOC', c:'bg-white/10 text-text-secondary border-white/10'}]} avatars={[{c:'bg-red-800', i:'RA'}]} />
              <ReviewRow label="Phase 2 retro — merge pipeline" badges={[{t:'AI · 87%', c:'bg-sky-500/10 text-sky-400 border-sky-500/20'}]} avatars={[{c:'bg-sky-700', i:'EM'}]} />
              <ReviewRow label="Triage incoming anomaly report" badges={[{t:'URGENT', c:'bg-red-500/10 text-red-400 border-red-500/20'}]} avatars={[{c:'bg-yellow-700', i:'KO'}]} />
            </div>
          </div>
        </div>

        {/* Bottom Row */}
        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-4">
          
          {/* Recent in Atlas */}
          <div className="lg:col-span-12 xl:col-span-7 bg-surface border border-border-subtle rounded-xl p-4 md:p-5 flex flex-col overflow-hidden">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6 gap-4">
              <div>
                <h3 className="text-[14px] font-medium text-white shadow-sm">Recent in Hub</h3>
                <p className="text-[13px] text-text-secondary mt-1">Sector 7 environment</p>
              </div>
              <div className="flex gap-4 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0 hide-scrollbar shrink-0">
                {['Global', 'Archives', 'Streams', 'Grids'].map((tab) => (
                  <button key={tab} className={cn(
                    "text-[13px] pb-1 border-b-2 transition-colors",
                    tab === 'Global' ? "border-white text-white" : "border-transparent text-text-tertiary hover:text-text-secondary"
                  )}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <RecentItem 
                icon={<FileText size={14} />} 
                title="Initialization sequence — v0.4"
                subtitle="Updated by AURA · 6 cycles ago · 12 deltas"
                rightText="/nexus/narrative"
              />
              <RecentItem 
                icon={<MessageCircle size={14} />} 
                title="Stream: communication protocols — pass 2"
                subtitle="14 packets · Jaya, Noor +5"
                rightText="14:02"
              />
              <RecentItem 
                icon={<File size={14} />} 
                title="Resource matrix — latency sheet"
                subtitle="Linked from Resource Alloc · auto-synced"
                rightText="13:48"
              />
              <RecentItem 
                icon={<CheckSquare size={14} />} 
                title="Directive: bypass manual tier"
                subtitle="Logged by Elena · metadata attached"
                rightText="12:30"
              />
              <RecentItem 
                icon={<CheckSquare size={14} className="text-text-tertiary" />} 
                title="Node transmission — Sector Alpha"
                subtitle="AURA parsed 7 signals, 3 objectives"
                rightText="Yesterday"
                dim
              />
            </div>
          </div>

          {/* Team Activity */}
          <div className="lg:col-span-12 xl:col-span-5 bg-surface border border-border-subtle rounded-xl p-4 md:p-5 flex flex-col overflow-hidden">
             <div className="flex justify-between items-start mb-6 gap-2">
              <div>
                <h3 className="text-[14px] font-medium text-white shadow-sm">Grid Activity</h3>
                <p className="text-[13px] text-text-secondary mt-1">Across all sectors</p>
              </div>
              <span className="text-[12px] text-text-tertiary font-medium">live</span>
            </div>

            <div className="flex flex-col gap-4">
              <ActivityItem avatar="NL" color="bg-green-700" name="Noor" action="cleared 4 deadlocks on" target="Initialization sequence" time="2m" />
              <ActivityItem avatar="JD" color="bg-purple-700" name="Jaya" action="initiated a stream in" target="Resource Allocation" time="11m" />
              <ActivityItem avatar="AU" color="bg-sky-600" name="AURA" action="drafted a status update for" target="Nexus Core" time="26m" />
              <ActivityItem avatar="KO" color="bg-yellow-700" name="Kai" action="injected 2 data points into" target="Data Vault" time="1h" />
              <ActivityItem avatar="RA" color="bg-red-800" name="Rhea" action="deployed" target="Quantum Streams beta" time="3h" />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ------ Helper Components ------

type SparklinePoint = {
  v: number;
};

type Trend = 'up' | 'down' | 'neutral';

type KpiCardProps = {
  title: string;
  metric: string;
  suffix?: string;
  trend: Trend;
  trendVal: string;
  data: SparklinePoint[];
  sparklineColor?: string;
};

function KpiCard({ title, metric, suffix, trend, trendVal, data, sparklineColor = '#828691' }: KpiCardProps) {
  return (
    <div className="bg-surface border border-border-subtle rounded-xl p-4 flex flex-col gap-3 relative overflow-hidden group hover:border-border-focus transition-colors">
      <div className="flex flex-col gap-1 z-10">
        <h4 className="text-[13px] font-medium text-text-secondary">{title}</h4>
        <div className="flex items-baseline gap-1 mt-1">
          <span className="text-3xl font-semibold tracking-tight text-white">{metric}</span>
          {suffix && <span className="text-[13px] text-text-tertiary font-medium">{suffix}</span>}
        </div>
      </div>
      
      <div className="flex items-center gap-2 z-10">
        <div className={cn(
          "px-1.5 py-0.5 rounded-[4px] text-[11px] font-medium border flex items-center gap-1",
          trend === 'up' ? "bg-green-500/10 text-green-400 border-green-500/20" :
          trend === 'down' ? "bg-red-500/10 text-red-500 border-red-500/20" :
          "bg-white/5 text-text-secondary border-white/10"
        )}>
          {trend === 'up' && <TrendingUp size={10} />}
          {trend === 'down' && <TrendingDown size={10} />}
          {trend === 'neutral' && <span>-</span>}
          {trendVal}
        </div>
      </div>
      
      {/* Absolute strict positioning for the sparkline to avoid bleeding */}
      <div className="absolute right-4 bottom-4 w-24 h-8 opacity-40 group-hover:opacity-100 transition-opacity">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
             <Line type="monotone" dataKey="v" stroke={sparklineColor} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

type Badge = {
  t: string;
  c: string;
};

type Avatar = {
  c: string;
  i: string;
};

type ReviewRowProps = {
  label: string;
  badges: Badge[];
  avatars: Avatar[];
};

function ReviewRow({ label, badges, avatars }: ReviewRowProps) {
  return (
    <button className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-surface-hover transition-colors group cursor-pointer -mx-2 text-left">
      <div className="flex items-center gap-3">
        <div className="w-[14px] h-[14px] rounded-[3px] border border-border-focus flex-shrink-0 group-hover:border-text-secondary transition-colors" />
        <span className="text-[13px] md:text-[13.5px] font-medium text-text-primary truncate max-w-[180px] sm:max-w-xs">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {badges.map((b, i) => (
          <span key={i} className={cn("px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide uppercase border", b.c)}>
            {b.t}
          </span>
        ))}
        <div className="flex -space-x-1 border-l border-border-subtle pl-2 ml-1">
           {avatars.map((a, i) => (
             <div key={i} className={cn("w-[18px] h-[18px] rounded-full flex items-center justify-center text-[8px] font-bold text-white border border-surface relative z-10", a.c)}>
               {a.i}
             </div>
           ))}
        </div>
      </div>
    </button>
  );
}

type RecentItemProps = {
  icon: ReactNode;
  title: string;
  subtitle: string;
  rightText: string;
  dim?: boolean;
};

function RecentItem({ icon, title, subtitle, rightText, dim }: RecentItemProps) {
  return (
    <button className={cn(
      "w-full text-left flex items-start gap-4 p-2.5 rounded-lg hover:bg-surface-hover transition-colors cursor-pointer border border-transparent hover:border-border-subtle",
      dim ? "opacity-60" : ""
    )}>
      <div className="w-8 h-8 rounded-md bg-surface-raised border border-border-subtle flex items-center justify-center text-text-secondary shrink-0 mt-0.5">
        {icon}
      </div>
      <div className="flex-1 flex flex-col min-w-0">
        <h4 className="text-[14px] font-medium text-white truncate">{title}</h4>
        <p className="text-[12px] text-text-tertiary truncate mt-0.5">{subtitle}</p>
      </div>
      <span className="text-[12px] text-text-tertiary font-mono shrink-0 pl-4 pt-0.5">{rightText}</span>
    </button>
  )
}

type ActivityItemProps = {
  avatar: string;
  color: string;
  name: string;
  action: string;
  target: string;
  time: string;
};

function ActivityItem({ avatar, color, name, action, target, time }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3">
      <div className={cn("w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5", color)}>
        {avatar}
      </div>
      <div className="flex-1 leading-snug">
        <p className="text-[13px]">
          <span className="font-semibold text-white">{name}</span>{' '}
          <span className="text-text-secondary">{action}</span>{' '}
          <button className="text-accent-blue hover:underline cursor-pointer">{target}</button>
        </p>
      </div>
      <span className="text-[12px] text-text-tertiary shrink-0">{time}</span>
    </div>
  )
}
