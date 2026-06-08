import React from 'react';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '../../types';
import { SprintModeToggle, getGamepadButtonName } from './KeybindingControls';

interface VisualGamepadMapperProps {
  keybindings: Keybindings;
  setKeybindings: React.Dispatch<React.SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: React.Dispatch<React.SetStateAction<keyof Keybindings | null>>;
  gamepadConnected: boolean;
  gamepadName: string;
  holdingGpButton: { buttonIndex: number; name: string; progress: number } | null;
  unassignedButtonMap: number | null;
  setUnassignedButtonMap: React.Dispatch<React.SetStateAction<number | null>>;
  pressedGpButtons: boolean[];
  hoveredAction: string | null;
  setHoveredAction: React.Dispatch<React.SetStateAction<string | null>>;
  leftStickActive: boolean;
  rightStickActive: boolean;
}

export function VisualGamepadMapper({
  keybindings,
  setKeybindings,
  rebindingAction,
  setRebindingAction,
  gamepadConnected,
  gamepadName,
  holdingGpButton,
  unassignedButtonMap,
  setUnassignedButtonMap,
  pressedGpButtons,
  hoveredAction,
  setHoveredAction,
  leftStickActive,
  rightStickActive,
}: VisualGamepadMapperProps) {
  const getActionKeyForButton = (idx: number): keyof Keybindings | null => {
    const keys: (keyof Keybindings)[] = [
      'gamepadJump', 'gamepadCrouch', 'gamepadDash', 'gamepadSwapWeapon',
      'gamepadAttack', 'gamepadAltAttack', 'gamepadSprint', 'gamepadScoreboard', 'gamepadPause'
    ];
    return keys.find(k => keybindings[k] === idx) || null;
  };

  const getLineColor = (btnIndex: number, actionKey: string | null) => {
    const isHeld = holdingGpButton?.buttonIndex === btnIndex;
    const isPressed = pressedGpButtons[btnIndex];
    const isRebinding = actionKey && rebindingAction === actionKey;
    const isHovered = actionKey && hoveredAction === actionKey;

    if (isRebinding) return '#e0f2fe';
    if (isHeld) return '#f59e0b';
    if (isPressed || isHovered) return '#22d3ee';
    return 'rgba(125, 211, 252, 0.55)';
  };

  const getLineOpacity = (btnIndex: number, actionKey: string | null) => {
    const isHeld = holdingGpButton?.buttonIndex === btnIndex;
    const isPressed = pressedGpButtons[btnIndex];
    const isRebinding = actionKey && rebindingAction === actionKey;
    const isHovered = actionKey && hoveredAction === actionKey;

    if (isRebinding || isHeld || isPressed || isHovered) return 1.0;
    return 0.6;
  };

  return (
    <div className="w-full relative overflow-hidden bg-slate-950/40 border border-white/10 rounded-xl p-4 flex flex-col items-center">
      {/* Connection & Look Sensitivity panel */}
      <div className={`p-2 mb-4 rounded-xl border flex flex-col sm:flex-row items-center justify-between text-left gap-3 transition-all w-full pointer-events-auto ${
        gamepadConnected
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.06)]'
          : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
      }`}>
        {gamepadConnected ? (
          <div className="flex items-center gap-2 truncate">
            <span className="text-sm">🎮</span>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest block leading-tight">Gamepad Connected</span>
              <span className="text-[8.5px] font-mono text-white/50 block truncate max-w-[280px]">
                {gamepadName}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm animate-pulse">⚠️</span>
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest block leading-tight">No Gamepad Detected</span>
              <span className="text-[9px] text-white/50 leading-tight block">
                Connect controller & press any button to link.
              </span>
            </div>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto justify-end">
          <button
            onClick={() => {
              setKeybindings(prev => {
                const updated = {
                  ...prev,
                  gamepadSensitivity: 3.0,
                  gamepadAcceleration: 0.0,
                  gamepadJump: 0,
                  gamepadCrouch: 1,
                  gamepadDash: 2,
                  gamepadSwapWeapon: 3,
                  gamepadAttack: 7,
                  gamepadAltAttack: 5,
                  gamepadSprint: 10,
                  gamepadScoreboard: 8,
                  gamepadPause: 9,
                };
                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                return updated;
              });
              setRebindingAction(null);
            }}
            className="px-2.5 h-7 border border-amber-500/20 hover:border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[9px] font-bold uppercase tracking-wider rounded-lg cursor-pointer transition-all duration-150 active:scale-95 flex items-center justify-center gap-1"
          >
            ↻ Reset
          </button>
        </div>
      </div>

      {/* Mapper Canvas */}
      <div className="relative w-full overflow-x-auto flex justify-center items-center py-2 select-none">
        <div className="relative min-w-[1000px] w-[1000px] h-[480px] overflow-visible">
          {/* SVG Elements (connecting lines, controller image, and buttons) */}
          <svg width="1000" height="480" viewBox="0 0 1000 480" className="absolute inset-0 pointer-events-none z-10 overflow-visible">
            <defs>
              <filter id="glow-cyan" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Connecting Lines */}
            {/* Left Side Lines */}
            <path
              d="M 220,50 L 320,50 L 320,115 L 376,115"
              fill="none"
              stroke={getLineColor(6, getActionKeyForButton(6))}
              strokeWidth={hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(6, getActionKeyForButton(6))}
              filter={hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 220,110 L 340,110 L 340,139 L 389,139"
              fill="none"
              stroke={getLineColor(4, getActionKeyForButton(4))}
              strokeWidth={hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(4, getActionKeyForButton(4))}
              filter={hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 220,170 L 430,170 L 430,234 L 462,234"
              fill="none"
              stroke={getLineColor(8, 'gamepadScoreboard')}
              strokeWidth={hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(8, 'gamepadScoreboard')}
              filter={hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 220,230 L 330,230 L 330,243 L 395,243"
              fill="none"
              stroke={getLineColor(10, 'gamepadSprint')}
              strokeWidth={hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(10, 'gamepadSprint')}
              filter={hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 220,290 L 315,290 L 315,243 L 395,243"
              fill="none"
              stroke={leftStickActive || hoveredAction === 'moveCharacter' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
              strokeWidth={leftStickActive || hoveredAction === 'moveCharacter' ? "2.5" : "1.5"}
              strokeOpacity={leftStickActive || hoveredAction === 'moveCharacter' ? 1.0 : 0.6}
              filter={leftStickActive || hoveredAction === 'moveCharacter' ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 220,350 L 360,350 L 360,299 L 445,299"
              fill="none"
              stroke={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
              strokeWidth={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "2.5" : "1.5"}
              strokeOpacity={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? 1.0 : 0.6}
              filter={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad' ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            {/* Right Side Lines */}
            <path
              d="M 780,50 L 700,50 L 700,115 L 622,115"
              fill="none"
              stroke={getLineColor(7, 'gamepadAttack')}
              strokeWidth={hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(7, 'gamepadAttack')}
              filter={hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,105 L 690,105 L 690,139 L 611,139"
              fill="none"
              stroke={getLineColor(5, 'gamepadAltAttack')}
              strokeWidth={hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(5, 'gamepadAltAttack')}
              filter={hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,160 L 546,160 L 546,234"
              fill="none"
              stroke={getLineColor(9, 'gamepadPause')}
              strokeWidth={hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(9, 'gamepadPause')}
              filter={hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,215 L 690,215 L 690,190 L 616,190 L 616,208"
              fill="none"
              stroke={getLineColor(3, 'gamepadSwapWeapon')}
              strokeWidth={hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(3, 'gamepadSwapWeapon')}
              filter={hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,270 L 705,270 L 705,300 L 560,300 L 560,235 L 584,235"
              fill="none"
              stroke={getLineColor(2, 'gamepadDash')}
              strokeWidth={hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(2, 'gamepadDash')}
              filter={hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,325 L 700,325 L 700,232 L 646,232"
              fill="none"
              stroke={getLineColor(1, 'gamepadCrouch')}
              strokeWidth={hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(1, 'gamepadCrouch')}
              filter={hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,380 L 670,380 L 670,260 L 613,260"
              fill="none"
              stroke={getLineColor(0, 'gamepadJump')}
              strokeWidth={hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0] ? "2.5" : "1.5"}
              strokeOpacity={getLineOpacity(0, 'gamepadJump')}
              filter={hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0] ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            <path
              d="M 780,435 L 690,435 L 690,296 L 550,296"
              fill="none"
              stroke={rightStickActive || hoveredAction === 'lookAim' ? "#22d3ee" : "rgba(125,211,252,0.55)"}
              strokeWidth={rightStickActive || hoveredAction === 'lookAim' ? "2.5" : "1.5"}
              strokeOpacity={rightStickActive || hoveredAction === 'lookAim' ? 1.0 : 0.6}
              filter={rightStickActive || hoveredAction === 'lookAim' ? "url(#glow-cyan)" : ""}
              className="transition-all duration-200"
            />

            {/* High-Fidelity Controller Image */}
            <image href="/controller.png" x="290" y="90" width="420" height="294" />

            {/* Glowing Interactive Circles on top of controller buttons */}
            {/* Left Side Buttons */}
            <circle cx="376" cy="115" r="12" fill={pressedGpButtons[6] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[6] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="389" cy="139" r="12" fill={pressedGpButtons[4] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[4] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="462" cy="234" r="8" fill={pressedGpButtons[8] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[8] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="395" cy="243" r="24" fill={leftStickActive ? 'rgba(34, 211, 238, 0.25)' : pressedGpButtons[10] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={leftStickActive || pressedGpButtons[10] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="445" cy="299" r="20" fill={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] ? 'rgba(34, 211, 238, 0.35)' : 'transparent'} stroke={pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />

            {/* Right Side Buttons */}
            <circle cx="622" cy="115" r="12" fill={pressedGpButtons[7] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[7] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="611" cy="139" r="12" fill={pressedGpButtons[5] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[5] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="546" cy="234" r="8" fill={pressedGpButtons[9] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={pressedGpButtons[9] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />
            <circle cx="616" cy="208" r="11" fill={pressedGpButtons[3] ? 'rgba(250, 204, 21, 0.4)' : hoveredAction === 'gamepadSwapWeapon' ? 'rgba(250, 204, 21, 0.2)' : 'transparent'} stroke={pressedGpButtons[3] || hoveredAction === 'gamepadSwapWeapon' ? '#facc15' : 'transparent'} strokeWidth="1.5" />
            <circle cx="584" cy="235" r="11" fill={pressedGpButtons[2] ? 'rgba(96, 165, 250, 0.4)' : hoveredAction === 'gamepadDash' ? 'rgba(96, 165, 250, 0.2)' : 'transparent'} stroke={pressedGpButtons[2] || hoveredAction === 'gamepadDash' ? '#60a5fa' : 'transparent'} strokeWidth="1.5" />
            <circle cx="646" cy="232" r="11" fill={pressedGpButtons[1] ? 'rgba(248, 113, 113, 0.4)' : hoveredAction === 'gamepadCrouch' ? 'rgba(248, 113, 113, 0.2)' : 'transparent'} stroke={pressedGpButtons[1] || hoveredAction === 'gamepadCrouch' ? '#f87171' : 'transparent'} strokeWidth="1.5" />
            <circle cx="613" cy="260" r="11" fill={pressedGpButtons[0] ? 'rgba(74, 222, 128, 0.4)' : hoveredAction === 'gamepadJump' ? 'rgba(74, 222, 128, 0.2)' : 'transparent'} stroke={pressedGpButtons[0] || hoveredAction === 'gamepadJump' ? '#4ade80' : 'transparent'} strokeWidth="1.5" />
            <circle cx="550" cy="296" r="24" fill={rightStickActive ? 'rgba(34, 211, 238, 0.25)' : pressedGpButtons[11] ? 'rgba(34, 211, 238, 0.4)' : 'transparent'} stroke={rightStickActive || pressedGpButtons[11] ? '#22d3ee' : 'transparent'} strokeWidth="1.5" />

            {/* Render HTML label boxes directly inside the SVG viewBox using foreignObject */}
            {/* Left Column Labels */}
            {/* LT */}
            <foreignObject x="20" y="25" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction(getActionKeyForButton(6))}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => {
                  const act = getActionKeyForButton(6);
                  if (act) setRebindingAction(act);
                  else setUnassignedButtonMap(6);
                }}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                  hoveredAction === getActionKeyForButton(6) || rebindingAction === getActionKeyForButton(6) || pressedGpButtons[6]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  {getActionKeyForButton(6) ? getActionKeyForButton(6)!.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim() : 'Unassigned (LT)'}
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  {getActionKeyForButton(6) ? '[LEFT TRIGGER]' : '[LT UNASSIGNED]'}
                </span>
              </div>
            </foreignObject>

            {/* LB */}
            <foreignObject x="20" y="85" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction(getActionKeyForButton(4))}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => {
                  const act = getActionKeyForButton(4);
                  if (act) setRebindingAction(act);
                  else setUnassignedButtonMap(4);
                }}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                  hoveredAction === getActionKeyForButton(4) || rebindingAction === getActionKeyForButton(4) || pressedGpButtons[4]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  {getActionKeyForButton(4) ? getActionKeyForButton(4)!.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim() : 'Unassigned (LB)'}
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  {getActionKeyForButton(4) ? '[LEFT BUMPER]' : '[LB UNASSIGNED]'}
                </span>
              </div>
            </foreignObject>

            {/* View/Back */}
            <foreignObject x="20" y="145" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadScoreboard')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadScoreboard')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                  hoveredAction === 'gamepadScoreboard' || rebindingAction === 'gamepadScoreboard' || pressedGpButtons[8]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Scoreboard
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadScoreboard)}]
                </span>
              </div>
            </foreignObject>

            {/* LS Click / Sprint */}
            <foreignObject x="20" y="205" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadSprint')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadSprint')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-end text-right select-none ${
                  hoveredAction === 'gamepadSprint' || rebindingAction === 'gamepadSprint' || pressedGpButtons[10]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Sprint
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadSprint)}]
                </span>
              </div>
            </foreignObject>

            {/* LS Move (Non-rebindable) */}
            <foreignObject x="20" y="265" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('moveCharacter')}
                onMouseLeave={() => setHoveredAction(null)}
                className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-end text-right select-none ${
                  leftStickActive || hoveredAction === 'moveCharacter'
                    ? 'border-cyan-500/35 bg-slate-900/60'
                    : 'border-white/5'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white/70">
                  Move Character
                </span>
                <span className="text-[8px] font-mono text-[#38bdf8]/60 font-bold bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [LEFT STICK]
                </span>
              </div>
            </foreignObject>

            {/* Dpad diagnostics */}
            <foreignObject x="20" y="325" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('dpad')}
                onMouseLeave={() => setHoveredAction(null)}
                className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-end text-right select-none ${
                  pressedGpButtons[12] || pressedGpButtons[13] || pressedGpButtons[14] || pressedGpButtons[15] || hoveredAction === 'dpad'
                    ? 'border-cyan-500/35 bg-slate-900/60 shadow-[0_0_8px_rgba(34,211,238,0.15)]'
                    : 'border-white/5'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white/50">
                  Unassigned D-pad
                </span>
                <span className="text-[8px] font-mono text-white/30 bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [D-PAD DIRECTION]
                </span>
              </div>
            </foreignObject>

            {/* Right Column Labels */}
            {/* RT */}
            <foreignObject x="780" y="25" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadAttack')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadAttack')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadAttack' || rebindingAction === 'gamepadAttack' || pressedGpButtons[7]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Primary Attack
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadAttack)}]
                </span>
              </div>
            </foreignObject>

            {/* RB */}
            <foreignObject x="780" y="80" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadAltAttack')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadAltAttack')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadAltAttack' || rebindingAction === 'gamepadAltAttack' || pressedGpButtons[5]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Secondary Attack
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadAltAttack)}]
                </span>
              </div>
            </foreignObject>

            {/* Start/Menu */}
            <foreignObject x="780" y="135" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadPause')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadPause')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadPause' || rebindingAction === 'gamepadPause' || pressedGpButtons[9]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Pause / Menu
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadPause)}]
                </span>
              </div>
            </foreignObject>

            {/* Y */}
            <foreignObject x="780" y="190" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadSwapWeapon')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadSwapWeapon')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadSwapWeapon' || rebindingAction === 'gamepadSwapWeapon' || pressedGpButtons[3]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Swap Weapon
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadSwapWeapon)}]
                </span>
              </div>
            </foreignObject>

            {/* X */}
            <foreignObject x="780" y="245" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadDash')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadDash')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadDash' || rebindingAction === 'gamepadDash' || pressedGpButtons[2]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Thrust / Dash
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadDash)}]
                </span>
              </div>
            </foreignObject>

            {/* B */}
            <foreignObject x="780" y="300" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadCrouch')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadCrouch')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadCrouch' || rebindingAction === 'gamepadCrouch' || pressedGpButtons[1]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Crouch / Slide
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadCrouch)}]
                </span>
              </div>
            </foreignObject>

            {/* A */}
            <foreignObject x="780" y="355" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('gamepadJump')}
                onMouseLeave={() => setHoveredAction(null)}
                onClick={() => setRebindingAction('gamepadJump')}
                className={`group w-[200px] h-[50px] bg-slate-900/50 hover:bg-cyan-950/20 border transition-all duration-200 rounded-xl p-2 cursor-pointer flex flex-col justify-center items-start text-left select-none ${
                  hoveredAction === 'gamepadJump' || rebindingAction === 'gamepadJump' || pressedGpButtons[0]
                    ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(34,211,238,0.15)] bg-slate-900/80'
                    : 'border-white/5 hover:border-cyan-500/30'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white group-hover:text-cyan-400">
                  Jump / Slide-up
                </span>
                <span className="text-[8px] font-mono text-cyan-400/70 group-hover:text-cyan-300 font-bold bg-cyan-950/40 border border-cyan-500/20 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [{getGamepadButtonName(keybindings.gamepadJump)}]
                </span>
              </div>
            </foreignObject>

            {/* RS Move (Non-rebindable) */}
            <foreignObject x="780" y="410" width="200" height="50" className="overflow-visible pointer-events-auto">
              <div
                onMouseEnter={() => setHoveredAction('lookAim')}
                onMouseLeave={() => setHoveredAction(null)}
                className={`group w-[200px] h-[50px] bg-slate-950/20 border transition-all duration-200 rounded-xl p-2 flex flex-col justify-center items-start text-left select-none ${
                  rightStickActive || hoveredAction === 'lookAim'
                    ? 'border-cyan-500/35 bg-slate-900/60'
                    : 'border-white/5'
                }`}
              >
                <span className="text-[10px] font-black uppercase tracking-wider text-white/70">
                  Look & Aim Camera
                </span>
                <span className="text-[8px] font-mono text-[#38bdf8]/60 font-bold bg-black/45 border border-white/5 px-1.5 py-0.5 rounded mt-0.5 uppercase tracking-wide">
                  [RIGHT STICK]
                </span>
              </div>
            </foreignObject>
          </svg>

          {/* Hold progress and unassigned selection overlays inside the visual mapper */}
          {/* Rebind prompt overlay */}
          {rebindingAction && rebindingAction.startsWith('gamepad') && (
            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-200 rounded-2xl pointer-events-auto">
              <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 max-w-sm w-full shadow-2xl text-center flex flex-col items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center text-lg text-cyan-400 animate-pulse">
                  🎮
                </div>
                <div>
                  <h4 className="text-white font-black text-sm uppercase tracking-tight">Rebinding Action</h4>
                  <p className="text-cyan-400 font-bold uppercase tracking-wider text-xs mt-0.5">
                    {rebindingAction.replace('gamepad', '').replace(/([A-Z])/g, ' $1').trim()}
                  </p>
                </div>
                <p className="text-white/60 text-[10.5px] leading-relaxed">
                  Press any button on controller to assign it to this action.<br/>
                  Press <kbd className="bg-black/60 border border-white/10 px-1 py-0.5 rounded text-[9px] text-white">ESC</kbd> or click Cancel to exit.
                </p>
                <button
                  onClick={() => setRebindingAction(null)}
                  className="mt-1 px-4 py-2 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/70 border border-white/10 hover:border-red-500/35 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer active:scale-95"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Holding timer circle overlay */}
          {holdingGpButton && (
            <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] flex items-center justify-center z-45 pointer-events-none rounded-2xl">
              <div className="bg-slate-900/95 border border-amber-500/30 rounded-2xl p-4 flex flex-col items-center gap-1.5 shadow-2xl">
                <div className="relative w-12 h-12 flex items-center justify-center">
                  <svg className="w-12 h-12 transform -rotate-90">
                    <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.05)" strokeWidth="3" fill="transparent" />
                    <circle cx="24" cy="24" r="20" stroke="#f59e0b" strokeWidth="3" fill="transparent"
                      strokeDasharray={125.6}
                      strokeDashoffset={125.6 - (125.6 * holdingGpButton.progress) / 100}
                      strokeLinecap="round"
                      className="transition-all duration-75"
                    />
                  </svg>
                  <span className="absolute font-mono font-black text-amber-400 text-[9px]">
                    {Math.round(holdingGpButton.progress)}%
                  </span>
                </div>
                <span className="text-[9px] font-black text-amber-400 uppercase tracking-widest">
                  HOLDING {holdingGpButton.name}...
                </span>
                <span className="text-[8px] text-white/50">
                  Keep holding to rebind
                </span>
              </div>
            </div>
          )}

          {/* Unassigned button actions picker */}
          {unassignedButtonMap !== null && (
            <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-200 rounded-2xl pointer-events-auto">
              <div className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-5 max-w-xs w-full shadow-2xl text-center flex flex-col gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-950/50 border border-cyan-500/30 flex items-center justify-center text-lg text-cyan-400 mx-auto animate-pulse">
                  ⚙️
                </div>
                <div>
                  <h4 className="text-white font-black text-sm uppercase tracking-tight">Assign Action to Button</h4>
                  <p className="text-cyan-400 font-bold uppercase tracking-wider text-xs mt-0.5">
                    {getGamepadButtonName(unassignedButtonMap)}
                  </p>
                </div>
                <div className="flex flex-col gap-1 max-h-[180px] overflow-y-auto pr-1">
                  {([
                    { key: 'gamepadJump', label: 'Jump' },
                    { key: 'gamepadCrouch', label: 'Crouch / Slide' },
                    { key: 'gamepadDash', label: 'Thrust (Dash)' },
                    { key: 'gamepadSwapWeapon', label: 'Swap Weapon' },
                    { key: 'gamepadAttack', label: 'Primary Attack' },
                    { key: 'gamepadAltAttack', label: 'Secondary Attack' },
                    { key: 'gamepadSprint', label: 'Sprint' },
                    { key: 'gamepadScoreboard', label: 'Scoreboard' },
                    { key: 'gamepadPause', label: 'Pause / Menu' },
                  ]).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setKeybindings(prev => {
                          const updated = { ...prev, [key]: unassignedButtonMap };
                          try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                          return updated;
                        });
                        setUnassignedButtonMap(null);
                      }}
                      className="w-full py-1.5 px-2 bg-white/5 hover:bg-cyan-500/20 text-white hover:text-cyan-200 border border-white/5 hover:border-cyan-500/30 rounded-lg text-[10.5px] font-bold text-left transition-all cursor-pointer flex justify-between items-center"
                    >
                      <span>{label}</span>
                      <span className="text-[8px] font-mono text-white/30">
                        {keybindings[key as keyof Keybindings] !== undefined ? `[${getGamepadButtonName(keybindings[key as keyof Keybindings] as number)}]` : 'Unbound'}
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setUnassignedButtonMap(null)}
                  className="w-full py-1.5 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/70 border border-white/10 hover:border-red-500/30 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer active:scale-95"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Look Sensitivity & Acceleration sliders — anchored to bottom of frame */}
      <div className="w-full mt-4 flex flex-col sm:flex-row items-stretch gap-3">
        {/* Look Sensitivity */}
        <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Look Sensitivity</span>
            <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadSensitivity ?? 3.0).toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="10.0"
            step="0.5"
            value={keybindings.gamepadSensitivity ?? 3.0}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setKeybindings(prev => {
                const updated = { ...prev, gamepadSensitivity: val };
                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                return updated;
              });
            }}
            className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-[8px] text-white/35 leading-tight">Overall turn speed of the right stick when aiming.</span>
        </div>

        {/* Look Acceleration */}
        <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Look Acceleration</span>
            <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadAcceleration ?? 0.0) === 0 ? 'OFF' : `${(keybindings.gamepadAcceleration ?? 0.0).toFixed(1)}x`}</span>
          </div>
          <input
            type="range"
            min="0.0"
            max="2.0"
            step="0.1"
            value={keybindings.gamepadAcceleration ?? 0.0}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setKeybindings(prev => {
                const updated = { ...prev, gamepadAcceleration: val };
                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                return updated;
              });
            }}
            className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-[8px] text-white/35 leading-tight">Ramps turn speed the further the stick is pushed — like mouse acceleration. 0 = linear / 1:1.</span>
        </div>

        {/* Controller Cursor Speed */}
        <div className="flex-1 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-wider text-white/50">Controller Cursor Speed</span>
            <span className="text-[#38bdf8] font-bold font-mono text-[11px] min-w-[28px] text-right">{(keybindings.gamepadCursorSpeed ?? 1.0).toFixed(1)}x</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="4.0"
            step="0.1"
            value={keybindings.gamepadCursorSpeed ?? 1.0}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              setKeybindings(prev => {
                const updated = { ...prev, gamepadCursorSpeed: val };
                try { localStorage.setItem('grifball_keybindings', JSON.stringify(updated)); } catch (_) {}
                return updated;
              });
            }}
            className="w-full accent-[#38bdf8] h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-[8px] text-white/35 leading-tight">Movement speed of the controller cursor on menus (Right Stick).</span>
        </div>
      </div>

      {/* Hold to Sprint toggle */}
      <div className="w-full mt-3 bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3">
        <SprintModeToggle keybindings={keybindings} setKeybindings={setKeybindings} />
      </div>
    </div>
  );
}
