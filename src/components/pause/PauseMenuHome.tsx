import React from 'react';
import {
  Activity,
  Bot,
  Eye,
  Keyboard,
  LayoutDashboard,
  LogOut,
  Play,
  RotateCcw,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';

type MultiplayerRole = 'host' | 'client' | 'observer' | null;

interface PauseMenuHomeProps {
  multiplayerRole: MultiplayerRole;
  isMultiplayer: boolean;
  debugMode: boolean;
  isReplay: boolean;
  onResume: () => void;
  onJoinPlayer: () => void;
  onJoinObserver: () => void;
  onResetMatch: () => void;
  onOpenBotSetup: () => void;
  onOpenKeybindings: () => void;
  onOpenUiAdjustment: () => void;
  onOpenLighting: () => void;
  onOpenAdminPanel: () => void;
  onToggleDebugMode: () => void;
  onExitReplay: () => void;
  onReturnToMain: () => void;
}

interface PauseActionButtonProps {
  id: string;
  label: string;
  color: 'cyan' | 'amber' | 'blue';
  icon: React.ComponentType<{ className?: string }>;
  compact?: boolean;
  onClick: () => void;
}

function SectionHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase font-mono">{label}</span>
      <div className="h-[1px] bg-slate-800/80 flex-1" />
    </div>
  );
}

function PauseActionButton({
  id,
  label,
  color,
  icon: Icon,
  compact = false,
  onClick,
}: PauseActionButtonProps) {
  const palette = {
    cyan: {
      surface: 'hover:bg-cyan-950/10 hover:border-cyan-500/40',
      icon: 'bg-cyan-950/50 border-cyan-500/30 text-cyan-400',
      text: 'text-cyan-400 group-hover:text-cyan-200',
    },
    amber: {
      surface: 'hover:bg-amber-950/10 hover:border-amber-500/40',
      icon: 'bg-amber-950/50 border-amber-500/30 text-amber-400',
      text: 'text-amber-400 group-hover:text-amber-200',
    },
    blue: {
      surface: 'hover:bg-blue-950/10 hover:border-blue-500/40',
      icon: 'bg-blue-950/50 border-blue-500/30 text-blue-400',
      text: 'text-blue-400 group-hover:text-blue-300',
    },
  }[color];

  return (
    <button
      id={id}
      onClick={onClick}
      className={`group flex items-center gap-2.5 p-2.5 bg-slate-950/20 border border-white/5 ${palette.surface} transition-all duration-150 cursor-pointer rounded-xl text-left pointer-events-auto active:scale-[0.98]`}
    >
      <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${palette.icon}`}>
        <Icon className="w-4.5 h-4.5" />
      </div>
      <span className={`font-bold ${compact ? 'text-[10px]' : 'text-xs'} ${palette.text} tracking-wide uppercase leading-tight select-none`}>
        {label}
      </span>
    </button>
  );
}

export function PauseMenuHome({
  multiplayerRole,
  isMultiplayer,
  debugMode,
  isReplay,
  onResume,
  onJoinPlayer,
  onJoinObserver,
  onResetMatch,
  onOpenBotSetup,
  onOpenKeybindings,
  onOpenUiAdjustment,
  onOpenLighting,
  onOpenAdminPanel,
  onToggleDebugMode,
  onExitReplay,
  onReturnToMain,
}: PauseMenuHomeProps) {
  return (
    <div className="mobile-modal mobile-pause-modal relative bg-slate-950/80 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 w-[460px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100dvh-1.5rem)] shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex flex-col select-none overflow-hidden animate-in fade-in duration-200">
      <div className="absolute -top-10 -left-10 w-40 h-40 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="mobile-pause-header text-center mb-5 border-b border-white/10 pb-4 w-full relative z-10 shrink-0">
        <p className="text-[10px] text-blue-400 font-black tracking-[0.3em] uppercase mb-1 font-display">SIMULATION PAUSED</p>
        <h3 className="text-3xl font-sans font-black tracking-tighter italic uppercase text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-400">
          GRIFVX PROTO
        </h3>
      </div>

      <div className="mobile-pause-scroll w-full flex flex-col gap-4 pointer-events-auto relative z-10 min-h-0 overflow-y-auto overscroll-contain pr-1">
        <button
          id="resume-btn"
          onClick={onResume}
          className="w-full h-12 bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white font-black text-xs uppercase tracking-widest active:scale-[0.98] transition-all duration-200 cursor-pointer rounded-lg shadow-[0_4px_20px_rgba(6,182,212,0.25)] hover:shadow-[0_4px_25px_rgba(6,182,212,0.4)] flex items-center justify-center gap-2 border border-cyan-400/30"
        >
          <Play className="w-4 h-4 fill-current" />
          Resume Game
        </button>

        <div className="w-full mt-2 flex flex-col gap-2">
          <SectionHeading label="Match Operations" />
          <div className="grid grid-cols-2 gap-2 w-full">
            {multiplayerRole === 'observer' ? (
              <button
                id="join-player-btn"
                onClick={onJoinPlayer}
                className="h-10 bg-emerald-950/40 hover:bg-emerald-900/50 border border-emerald-500/30 text-emerald-400 hover:text-emerald-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
              >
                <UserRound className="w-3.5 h-3.5" />
                Join As Player
              </button>
            ) : (
              <button
                id="join-observer-btn"
                onClick={onJoinObserver}
                className="h-10 bg-amber-950/40 hover:bg-amber-900/50 border border-amber-500/30 text-amber-400 hover:text-amber-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
              >
                <Eye className="w-3.5 h-3.5" />
                Join Observer
              </button>
            )}

            <button
              id="reset-match-btn"
              onClick={onResetMatch}
              className="h-10 bg-slate-900/40 hover:bg-slate-800/60 border border-slate-700/40 text-slate-300 hover:text-white font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Match
            </button>
          </div>

          {!isMultiplayer && (
            <button
              id="bot-config-btn"
              onClick={onOpenBotSetup}
              className="w-full h-10 bg-blue-950/40 hover:bg-blue-900/50 border border-blue-500/30 text-blue-400 hover:text-blue-200 font-bold text-xs uppercase tracking-wide transition-all duration-150 cursor-pointer rounded-lg flex items-center justify-center gap-1.5"
            >
              <Bot className="w-3.5 h-3.5" />
              Bot Configuration
            </button>
          )}
        </div>

        <div className="w-full mt-2 flex flex-col gap-2">
          <SectionHeading label="Adjustments & Options" />
          <div className="grid grid-cols-2 gap-2.5 w-full">
            <PauseActionButton
              id="keybinds-btn"
              label="Hotkey Adjustments"
              color="cyan"
              icon={Keyboard}
              onClick={onOpenKeybindings}
            />
            <PauseActionButton
              id="ui-adjustment-btn"
              label="UI Adjustment"
              color="cyan"
              icon={LayoutDashboard}
              onClick={onOpenUiAdjustment}
            />
            <PauseActionButton
              id="lighting-controls-btn"
              label="Lighting & Shadows"
              color="amber"
              icon={Sun}
              onClick={onOpenLighting}
            />
            <PauseActionButton
              id="admin-controls-btn"
              label="Gameplay / Mechanics Options"
              color="blue"
              icon={Settings}
              compact
              onClick={onOpenAdminPanel}
            />
          </div>
        </div>

        <div className="w-full mt-2 flex flex-col gap-2">
          <SectionHeading label="System & Dev" />
          <button
            id="toggle-debug-btn"
            onClick={onToggleDebugMode}
            className={`w-full h-10 border rounded-lg font-bold text-xs uppercase tracking-widest transition-all duration-150 cursor-pointer flex items-center justify-between px-4 pointer-events-auto ${
              debugMode
                ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20'
                : 'bg-slate-950/20 border-white/5 text-white/50 hover:bg-white/5'
            }`}
          >
            <span className="select-none flex items-center gap-2">
              <Activity className="w-3.5 h-3.5" />
              Damage Traces
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-mono font-bold ${debugMode ? 'text-red-400' : 'text-white/30'}`}>
                {debugMode ? 'ENABLED' : 'DISABLED'}
              </span>
              <div className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                debugMode ? 'bg-red-500 border-red-400 shadow-[0_0_8px_rgba(239,68,68,0.5)]' : 'bg-transparent border-white/20'
              }`} />
            </div>
          </button>

          <button
            id="quit-btn"
            onClick={isReplay ? onExitReplay : onReturnToMain}
            className="w-full h-10 bg-red-950/20 border border-red-500/20 hover:bg-red-950/40 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-widest transition-all duration-150 cursor-pointer rounded-lg mt-1 pointer-events-auto active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <LogOut className="w-3.5 h-3.5" />
            {isReplay ? 'Exit Replay' : 'Quit to Title Screen'}
          </button>
        </div>
      </div>

      <p className="mobile-pause-footer mt-5 text-[9px] text-white/40 tracking-wider text-center relative z-10 shrink-0">
        Press <span className="font-mono text-[10px] text-blue-400 font-bold">ESC</span> inside game window to pause/unpause
      </p>
    </div>
  );
}
