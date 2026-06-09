import React from 'react';
import { Check } from 'lucide-react';
import { DEFAULT_KEYBINDINGS, type Keybindings } from '../../types';
import {
  CompactKeybindList,
  KeyboardVisualizer,
} from '../main-menu/KeybindingControls';
import { VisualGamepadMapper } from '../main-menu/VisualGamepadMapper';

type KeybindsModalTab = 'keyboard' | 'gamepad';

interface KeybindingSettingsModalProps {
  keybindsModalTab: KeybindsModalTab;
  setKeybindsModalTab: React.Dispatch<React.SetStateAction<KeybindsModalTab>>;
  keybindings: Keybindings;
  setKeybindings: React.Dispatch<React.SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: React.Dispatch<React.SetStateAction<keyof Keybindings | null>>;
  forceMobileControls: boolean;
  setForceMobileControls: React.Dispatch<React.SetStateAction<boolean>>;
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
  onClose: () => void;
}

const persistKeybindings = (keybindings: Keybindings) => {
  try {
    localStorage.setItem('grifball_keybindings', JSON.stringify(keybindings));
  } catch {
    /* local persistence is optional */
  }
};

export function KeybindingSettingsModal({
  keybindsModalTab,
  setKeybindsModalTab,
  keybindings,
  setKeybindings,
  rebindingAction,
  setRebindingAction,
  forceMobileControls,
  setForceMobileControls,
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
  onClose,
}: KeybindingSettingsModalProps) {
  const toggleRebinding = (action: keyof Keybindings) => {
    setRebindingAction((current) => (current === action ? null : action));
  };

  return (
    <div className={`mobile-modal mobile-keybind-modal bg-slate-950/95 border border-white/10 backdrop-blur-2xl rounded-2xl p-6 max-w-[95vw] shadow-2xl flex flex-col select-none max-h-[95vh] overflow-y-auto transition-all duration-300 ${
      keybindsModalTab === 'gamepad' ? 'w-[1040px]' : 'w-[1180px] xl:w-[1280px]'
    }`}>
      <div className="flex items-center justify-between mb-5 border-b border-white/5 pb-4 shrink-0">
        <div className="flex flex-col items-start text-left">
          <p className="text-[9px] text-cyan-400 font-bold tracking-[0.3em] uppercase mb-0.5 font-display">INPUT CONFIG</p>
          <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">⌨ Hotkey Adjustments</h3>
        </div>
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="hidden sm:block text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-mono">
            Press ESC to close
          </div>
          <button
            onClick={onClose}
            className="h-9 px-4 bg-white hover:bg-cyan-400 hover:text-white text-slate-900 text-xs font-black uppercase tracking-widest rounded-lg cursor-pointer transition-all active:scale-[0.98] flex items-center justify-center gap-1.5 shadow-lg"
          >
            <Check className="w-3.5 h-3.5" />
            Save & Return
          </button>
        </div>
      </div>

      <div className="flex border-b border-white/10 mb-5 gap-2 pointer-events-auto shrink-0">
        <button
          onClick={() => {
            setKeybindsModalTab('keyboard');
            setRebindingAction(null);
          }}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all duration-150 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
            keybindsModalTab === 'keyboard'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20'
              : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
          }`}
        >
          ⌨ Keyboard & Mouse
        </button>
        <button
          onClick={() => {
            setKeybindsModalTab('gamepad');
            setRebindingAction(null);
          }}
          className={`flex-1 py-2 text-xs font-black uppercase tracking-wider transition-all duration-150 border-b-2 flex items-center justify-center gap-2 cursor-pointer ${
            keybindsModalTab === 'gamepad'
              ? 'border-cyan-400 text-cyan-400 bg-cyan-950/20'
              : 'border-transparent text-white/50 hover:text-white/80 hover:bg-white/[0.02]'
          }`}
        >
          🎮 Gamepad Controller
        </button>
      </div>

      {keybindsModalTab === 'keyboard' ? (
        <>
          <CompactKeybindList
            bindings={keybindings}
            rebinding={rebindingAction}
            onPick={toggleRebinding}
          />
          <div className="pointer-events-auto mb-5">
            <div className="desktop-keyboard-visualizer">
              <KeyboardVisualizer
                bindings={keybindings}
                rebinding={rebindingAction}
                onPick={toggleRebinding}
              />
            </div>
          </div>

          <div className="pointer-events-auto border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-4 mb-5">
            <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-2 font-mono">🖱 Mouse Settings</p>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                <span>Sensitivity</span>
                <span className="text-cyan-400 font-mono">{(keybindings.mouseSensitivity ?? 1.0).toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="5.0"
                step="0.1"
                value={keybindings.mouseSensitivity ?? 1.0}
                onChange={(event) => {
                  const value = parseFloat(event.target.value);
                  setKeybindings((prev) => {
                    const updated = { ...prev, mouseSensitivity: value };
                    persistKeybindings(updated);
                    return updated;
                  });
                }}
                className="w-full accent-cyan-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[9px] text-white/35 font-mono">0.1 (slow) - 5.0 (fast). Default: 1.0</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[11px] font-bold uppercase tracking-wider text-white/80">
                <span>Acceleration</span>
                <span className={`font-mono ${(keybindings.mouseAcceleration ?? 0) > 0 ? 'text-amber-400' : 'text-white/40'}`}>
                  {(keybindings.mouseAcceleration ?? 0.0).toFixed(1)}{(keybindings.mouseAcceleration ?? 0) === 0 ? ' (OFF)' : ''}
                </span>
              </div>
              <input
                type="range"
                min="0.0"
                max="2.0"
                step="0.1"
                value={keybindings.mouseAcceleration ?? 0.0}
                onChange={(event) => {
                  const value = parseFloat(event.target.value);
                  setKeybindings((prev) => {
                    const updated = { ...prev, mouseAcceleration: value };
                    persistKeybindings(updated);
                    return updated;
                  });
                }}
                className="w-full accent-amber-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
              />
              <span className="text-[9px] text-white/35 font-mono">0.0 = linear (off). Higher = faster as you move faster.</span>
            </div>
          </div>

          <div className="pointer-events-auto border border-white/10 rounded-xl p-4 bg-white/[0.02] flex flex-col gap-4 mb-5">
            <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-widest border-b border-white/5 pb-2 font-mono">📱 Mobile Touch controls</p>
            <div className="flex items-center justify-between">
              <div className="flex flex-col text-left">
                <span className="text-[11px] font-bold uppercase tracking-wider text-white/80">Force Gamepad Overlay</span>
                <span className="text-[9px] text-white/35 font-mono">Force show touch joysticks & buttons on desktop</span>
              </div>
              <button
                id="force-mobile-controls-toggle"
                type="button"
                onClick={() => setForceMobileControls((prev) => !prev)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out outline-none ${
                  forceMobileControls ? 'bg-cyan-500' : 'bg-slate-800'
                }`}
                style={{
                  position: 'relative',
                  display: 'inline-flex',
                  height: '24px',
                  width: '44px',
                  cursor: 'pointer',
                  borderRadius: '9999px',
                  borderWidth: '2px',
                  borderColor: 'transparent',
                  transitionProperty: 'color, background-color, border-color, text-decoration-color, fill, stroke',
                  transitionDuration: '200ms',
                  outline: 'none',
                  backgroundColor: forceMobileControls ? '#06b6d4' : '#1e293b',
                }}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    forceMobileControls ? 'translate-x-5' : 'translate-x-0'
                  }`}
                  style={{
                    pointerEvents: 'none',
                    display: 'inline-block',
                    height: '20px',
                    width: '20px',
                    transform: forceMobileControls ? 'translateX(20px)' : 'translateX(0)',
                    borderRadius: '9999px',
                    backgroundColor: '#ffffff',
                    transitionProperty: 'transform',
                    transitionDuration: '200ms',
                  }}
                />
              </button>
            </div>
            <p className="text-[9.5px] text-white/40 leading-normal text-left font-mono">
              💡 <span className="text-[#38bdf8] font-bold">Custom HUD Editor</span>: Go in-game, tap <span className="text-amber-400 font-bold">PAUSE [ESC]</span> &gt; <span className="text-cyan-400 font-bold">HUD CANVAS ADJUSTER</span>. Drag the Left Analog stick and Right Button pads to layout your custom mobile gamepad position!
            </p>
          </div>

          <div className="pointer-events-auto flex items-center justify-between px-1 mb-5 text-[10px] font-mono text-white/40">
            <button
              onClick={() => {
                setKeybindings({ ...DEFAULT_KEYBINDINGS });
                setRebindingAction(null);
                persistKeybindings(DEFAULT_KEYBINDINGS);
              }}
              className="text-amber-400/70 hover:text-amber-400 font-bold uppercase tracking-wider cursor-pointer transition-colors bg-transparent border-none p-0"
            >
              ↻ Reset All Keybinds & Mouse
            </button>
          </div>
        </>
      ) : (
        <VisualGamepadMapper
          keybindings={keybindings}
          setKeybindings={setKeybindings}
          rebindingAction={rebindingAction}
          setRebindingAction={setRebindingAction}
          gamepadConnected={gamepadConnected}
          gamepadName={gamepadName}
          holdingGpButton={holdingGpButton}
          unassignedButtonMap={unassignedButtonMap}
          setUnassignedButtonMap={setUnassignedButtonMap}
          pressedGpButtons={pressedGpButtons}
          hoveredAction={hoveredAction}
          setHoveredAction={setHoveredAction}
          leftStickActive={leftStickActive}
          rightStickActive={rightStickActive}
        />
      )}
    </div>
  );
}
