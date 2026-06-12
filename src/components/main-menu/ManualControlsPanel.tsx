import React from 'react';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '../../types';
import {
  CompactKeybindList,
  KeyboardVisualizer,
  SprintModeToggle,
} from './KeybindingControls';

interface ManualControlsPanelProps {
  keybindings: Keybindings;
  setKeybindings: React.Dispatch<React.SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: React.Dispatch<React.SetStateAction<keyof Keybindings | null>>;
}

const KEYBINDINGS_STORAGE_KEY = 'grifball_keybindings';

function persistKeybindings(keybindings: Keybindings) {
  try {
    localStorage.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(keybindings));
  } catch {
    // Local persistence is best-effort; the live in-memory setting still updates.
  }
}

function formatBindingValue(value: Keybindings[keyof Keybindings]): string {
  if (typeof value === 'string') {
    return value === ' ' ? 'SPACE' : value.toUpperCase();
  }
  if (typeof value === 'number') {
    return String(value);
  }
  return value ? 'ON' : 'OFF';
}

export function ManualControlsPanel({
  keybindings,
  setKeybindings,
  rebindingAction,
  setRebindingAction,
}: ManualControlsPanelProps) {
  const toggleRebinding = (action: keyof Keybindings) => {
    setRebindingAction((current) => (current === action ? null : action));
  };

  const updateKeybindings = (patch: Partial<Keybindings>) => {
    setKeybindings((previous) => {
      const updated = { ...previous, ...patch };
      persistKeybindings(updated);
      return updated;
    });
  };

  const resetKeybindings = () => {
    setKeybindings({ ...DEFAULT_KEYBINDINGS });
    setRebindingAction(null);
    persistKeybindings(DEFAULT_KEYBINDINGS);
  };

  return (
    <div className="flex flex-col gap-4">
      <CompactKeybindList
        bindings={keybindings}
        rebinding={rebindingAction}
        onPick={toggleRebinding}
      />

      <div className="desktop-keyboard-visualizer">
        <KeyboardVisualizer
          bindings={keybindings}
          rebinding={rebindingAction}
          onPick={toggleRebinding}
        />
      </div>

      <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', display: 'block', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          Mouse Settings
        </span>
        <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.70)' }}>
              <span>Sensitivity</span>
              <span style={{ color: '#22d3ee' }}>{(keybindings.mouseSensitivity ?? 1.0).toFixed(1)}x</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5.0"
              step="0.1"
              value={keybindings.mouseSensitivity ?? 1.0}
              onChange={(event) => updateKeybindings({ mouseSensitivity: parseFloat(event.target.value) })}
              className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              0.1 (slow) - 5.0 (fast). Default: 1.0
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.70)' }}>
              <span>Acceleration</span>
              <span style={{ color: (keybindings.mouseAcceleration ?? 0) > 0 ? '#fbbf24' : 'rgba(255,255,255,0.40)' }}>
                {(keybindings.mouseAcceleration ?? 0.0).toFixed(1)}{(keybindings.mouseAcceleration ?? 0) === 0 ? ' (OFF)' : ''}
              </span>
            </div>
            <input
              type="range"
              min="0.0"
              max="2.0"
              step="0.1"
              value={keybindings.mouseAcceleration ?? 0.0}
              onChange={(event) => updateKeybindings({ mouseAcceleration: parseFloat(event.target.value) })}
              className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
            />
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
              0.0 = linear (off). Higher = faster as you move faster.
            </span>
          </div>
        </div>
      </div>

      <div style={{ background: 'rgba(2,6,23,0.45)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18, boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.30)' }}>
        <span style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: '#38bdf8', display: 'block', marginBottom: 14, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          Movement Settings
        </span>
        <SprintModeToggle keybindings={keybindings} setKeybindings={setKeybindings} />
      </div>

      <div className="flex items-center justify-between px-2 py-1.5 border-t border-white/5 font-mono text-xs text-white/40">
        <button
          type="button"
          onClick={resetKeybindings}
          className="text-[10px] text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-none p-0"
        >
          Reset All Keybinds
        </button>
      </div>

      <div className="flex flex-col gap-3 font-sans text-sm">
        <div className="hidden">
          <div className="flex items-center gap-2 px-2 py-1.5 bg-amber-500/5 border border-amber-500/15 rounded text-[11px] text-amber-400/80 font-medium select-none">
            <span>!</span>
            <span>Click any key below to rebind. Press <kbd className="bg-black/40 px-1.5 py-0.5 rounded border border-white/10 text-[10px] font-mono font-bold">ESC</kbd> to cancel.</span>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-lg p-4">
            <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arena Navigation</p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
              {([
                { action: 'moveForward' as keyof Keybindings, label: 'Move Forward' },
                { action: 'moveLeft' as keyof Keybindings, label: 'Move Left' },
                { action: 'moveBackward' as keyof Keybindings, label: 'Move Backward' },
                { action: 'moveRight' as keyof Keybindings, label: 'Move Right' },
                { action: 'jump' as keyof Keybindings, label: 'Jump (Boost)' },
                { action: 'dash' as keyof Keybindings, label: 'Sonic Dash' },
                { action: 'crouch' as keyof Keybindings, label: 'Crouch / Slide' },
                { action: 'sprint' as keyof Keybindings, label: 'Sprint' },
                { action: 'scoreboard' as keyof Keybindings, label: 'Scoreboard' },
              ]).map(({ action, label }) => (
                <div key={action} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleRebinding(action)}
                    className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                      rebindingAction === action
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                        : 'bg-black/50 border-white/20 text-[#38bdf8] hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10'
                    }`}
                  >
                    {rebindingAction === action ? '...' : formatBindingValue(keybindings[action])}
                  </button>
                  <span className="text-white/60 text-xs font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-lg p-4">
            <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Arsenal Control & Swapping</p>
            <div className="grid grid-cols-2 gap-y-3 gap-x-4 text-white/80">
              {([
                { action: 'weapon1' as keyof Keybindings, label: 'Grav Hammer', color: 'text-cyan-400' },
                { action: 'weapon2' as keyof Keybindings, label: 'Energy Sword', color: 'text-purple-400' },
              ]).map(({ action, label, color }) => (
                <div key={action} className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleRebinding(action)}
                    className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-bold text-xs border cursor-pointer transition-all select-none ${
                      rebindingAction === action
                        ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                        : `bg-black/50 border-white/20 ${color} hover:border-[#38bdf8]/50 hover:bg-[#38bdf8]/10`
                    }`}
                  >
                    {rebindingAction === action ? '...' : formatBindingValue(keybindings[action])}
                  </button>
                  <span className="text-white/60 text-xs font-medium">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-2.5 col-span-2 border-t border-white/5 pt-2.5 mt-1">
                <span className="text-amber-400 font-mono text-[10px] uppercase tracking-widest mr-1.5">Switch:</span>
                <span className="text-white/70 text-xs">Use <kbd className="bg-black/30 px-1.5 py-0.5 border border-white/10 rounded font-bold text-xs">SCROLL WHEEL</kbd> to cycle weapons</span>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-lg p-4">
            <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Combat Techniques</p>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-3 text-white/70">
                <button
                  type="button"
                  onClick={() => toggleRebinding('attack')}
                  className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                    rebindingAction === 'attack'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                      : 'bg-cyan-950/40 border-cyan-500/30 text-cyan-400 hover:border-cyan-400/60 hover:bg-cyan-500/15'
                  }`}
                >
                  {rebindingAction === 'attack' ? '...' : keybindings.attack.toUpperCase()}
                </button>
                <div>
                  <p className="text-xs text-white/90 font-bold"><strong className="text-cyan-400">Grav Slam</strong> (With Hammer) / <strong className="text-red-400">Assault Lunge</strong> (Sword)</p>
                  <p className="text-[11px] text-white/55 leading-normal">Primary attack - context-sensitive by equipped weapon.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 text-white/70 border-t border-white/5 pt-2.5">
                <button
                  type="button"
                  onClick={() => toggleRebinding('altAttack')}
                  className={`min-w-[3rem] h-7 rounded flex items-center justify-center font-mono font-black text-[10px] border cursor-pointer transition-all select-none shrink-0 ${
                    rebindingAction === 'altAttack'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-400 animate-pulse shadow-[0_0_12px_rgba(245,158,11,0.3)]'
                      : 'bg-purple-950/40 border-purple-500/30 text-purple-400 hover:border-purple-400/60 hover:bg-purple-500/15'
                  }`}
                >
                  {rebindingAction === 'altAttack' ? '...' : keybindings.altAttack.toUpperCase()}
                </button>
                <div>
                  <p className="text-xs text-white/90 font-bold"><strong className="text-purple-400">Quick Slash</strong> (With Sword)</p>
                  <p className="text-[11px] text-white/55 leading-normal">Swift front slash for immediate counter attacks.</p>
                </div>
              </div>

              <div className="flex items-center gap-2.5 border-t border-amber-500/10 bg-amber-500/5 p-2.5 rounded mt-1">
                <span className="text-amber-500 text-xs font-bold select-none">Combo:</span>
                <span className="text-white/80 text-[11px] leading-relaxed">
                  <strong>Hammer Jump</strong>: {keybindings.attack.toUpperCase()} then immediately press <kbd className="bg-black/30 px-1.5 py-0.5 font-bold rounded text-[10px]">{keybindings.jump === ' ' ? 'SPACE' : keybindings.jump.toUpperCase()}</kbd> to launch high!
                </span>
              </div>
            </div>
          </div>

          <div className="bg-white/5 border border-white/5 rounded-lg p-4">
            <p className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider mb-3">Mouse Controls</p>
            <div className="flex items-center justify-center gap-6">
              <div className="relative w-20 h-28 flex flex-col rounded-[2rem] border-2 border-white/15 bg-black/40 overflow-hidden select-none">
                <div className={`flex-1 flex items-center justify-center border-b border-r border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors ${
                  keybindings.attack === 'lmb' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/5 text-white/30'
                }`}>
                  {keybindings.attack === 'lmb' ? 'ATK' : ''}
                </div>
                <div className={`flex-1 flex items-center justify-center border-b border-l border-white/10 text-[9px] font-mono font-black uppercase tracking-wider transition-colors absolute top-0 right-0 w-1/2 h-1/2 ${
                  keybindings.altAttack === 'rmb' ? 'bg-purple-500/15 text-purple-400' : 'bg-white/5 text-white/30'
                }`}>
                  {keybindings.altAttack === 'rmb' ? 'ALT' : ''}
                </div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-5 bg-white/10 rounded-full border border-white/20" />
                <div className="flex-1" />
              </div>
              <div className="flex flex-col gap-1.5 text-[11px] text-white/60">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-cyan-500/60" />
                  <span>Left Click - <span className="text-cyan-400 font-bold">Attack</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-purple-500/60" />
                  <span>Right Click - <span className="text-purple-400 font-bold">Alt Attack</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-amber-500/60" />
                  <span>Scroll Wheel - <span className="text-amber-400 font-bold">Swap Weapon</span></span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-white/30" />
                  <span>Mouse Move - <span className="text-white/80 font-bold">Aim / Look</span></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
