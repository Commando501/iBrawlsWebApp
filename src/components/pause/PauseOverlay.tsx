import React from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Check } from 'lucide-react';
import type { Keybindings, UniversalSettings } from '../../types';
import type { GameplayPreset } from '../../settings/useGameplayPresetControls';
import type { LiveConfig } from '../../services/liveConfig';
import type { GameplayMultiplayerRole } from '../multiplayer/multiplayerConnectionConstants';
import { MechanicsSettingsGrid } from '../settings/MechanicsSettingsGrid';
import { KeybindingSettingsModal } from '../settings/KeybindingSettingsModal';
import { LightingSettingsModal } from '../settings/LightingSettingsModal';
import { PauseMenuHome } from './PauseMenuHome';

type KeybindsModalTab = 'keyboard' | 'gamepad';

interface PauseOverlayProps {
  showAdminPanel: boolean;
  showLightingMenu: boolean;
  showKeybindsMenu: boolean;
  multiplayerRole: GameplayMultiplayerRole;
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
  selectedPresetName: string;
  gameplayPresets: GameplayPreset[];
  newPresetNameInput: string;
  setNewPresetNameInput: Dispatch<SetStateAction<string>>;
  officialPresetName: string;
  multiplayerPreset: LiveConfig | null;
  onSelectPreset: (name: string) => void;
  onSavePreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  collapsedSections: Record<string, boolean>;
  onToggleSection: (sectionId: string) => void;
  onCloseAdminPanel: () => void;
  keybindsModalTab: KeybindsModalTab;
  setKeybindsModalTab: Dispatch<SetStateAction<KeybindsModalTab>>;
  keybindings: Keybindings;
  setKeybindings: Dispatch<SetStateAction<Keybindings>>;
  rebindingAction: keyof Keybindings | null;
  setRebindingAction: Dispatch<SetStateAction<keyof Keybindings | null>>;
  forceMobileControls: boolean;
  setForceMobileControls: Dispatch<SetStateAction<boolean>>;
  gamepadConnected: boolean;
  gamepadName: string;
  holdingGpButton: { buttonIndex: number; name: string; progress: number } | null;
  unassignedButtonMap: number | null;
  setUnassignedButtonMap: Dispatch<SetStateAction<number | null>>;
  pressedGpButtons: boolean[];
  hoveredAction: string | null;
  setHoveredAction: Dispatch<SetStateAction<string | null>>;
  leftStickActive: boolean;
  rightStickActive: boolean;
  onCloseKeybindings: () => void;
  onCloseLighting: () => void;
}

export function PauseOverlay({
  showAdminPanel,
  showLightingMenu,
  showKeybindsMenu,
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
  selectedPresetName,
  gameplayPresets,
  newPresetNameInput,
  setNewPresetNameInput,
  officialPresetName,
  multiplayerPreset,
  onSelectPreset,
  onSavePreset,
  onDeletePreset,
  adminSettings,
  setAdminSettings,
  collapsedSections,
  onToggleSection,
  onCloseAdminPanel,
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
  onCloseKeybindings,
  onCloseLighting,
}: PauseOverlayProps) {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/80 backdrop-blur-xl transition-all duration-300 p-3">
      {!showAdminPanel && !showLightingMenu && !showKeybindsMenu ? (
        <PauseMenuHome
          multiplayerRole={multiplayerRole}
          isMultiplayer={isMultiplayer}
          debugMode={debugMode}
          isReplay={isReplay}
          onResume={onResume}
          onJoinPlayer={onJoinPlayer}
          onJoinObserver={onJoinObserver}
          onResetMatch={onResetMatch}
          onOpenBotSetup={onOpenBotSetup}
          onOpenKeybindings={onOpenKeybindings}
          onOpenUiAdjustment={onOpenUiAdjustment}
          onOpenLighting={onOpenLighting}
          onOpenAdminPanel={onOpenAdminPanel}
          onToggleDebugMode={onToggleDebugMode}
          onExitReplay={onExitReplay}
          onReturnToMain={onReturnToMain}
        />
      ) : showAdminPanel ? (
        <div className="mobile-modal bg-slate-950/95 border border-white/10 backdrop-blur-2xl rounded-2xl p-5 w-full max-w-[940px] xl:max-w-[1240px] 2xl:max-w-[1560px] shadow-2xl flex flex-col select-none max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden animate-in fade-in duration-200">
          <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
            <div className="flex flex-col items-start text-left">
              <p className="text-[9px] text-[#38bdf8] font-bold tracking-[0.3em] uppercase mb-0.5 font-display">SYSTEM OVERRIDE</p>
              <h3 className="text-xl font-sans font-black tracking-tight uppercase text-white">
                Gameplay / Mechanics Options
              </h3>
            </div>
            <div className="text-[10px] text-white/50 bg-white/5 px-2.5 py-1 rounded-full border border-white/10 font-mono">
              Press ESC to close
            </div>
          </div>

          <div className="mb-4 pointer-events-auto border border-white/10 rounded-xl p-3 bg-white/[0.02] backdrop-blur-md flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 text-left">
            <div className="flex flex-col min-w-[200px]">
              <span className="text-[10px] text-[#38bdf8] font-bold uppercase tracking-widest font-mono flex items-center gap-1.5 animate-pulse">
                Gameplay Presets
              </span>
              <span className="text-[9px] text-white/40">Load, save, or manage your custom rulesets</span>
            </div>

            <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 min-w-[200px]">
                <select
                  value={selectedPresetName}
                  onChange={(event) => onSelectPreset(event.target.value)}
                  className="w-full h-9 bg-black/60 border border-white/10 rounded px-2.5 text-xs text-[#38bdf8] font-bold uppercase outline-none focus:border-[#38bdf8] cursor-pointer transition-all font-sans"
                >
                  <option value="" disabled={!selectedPresetName}>
                    {gameplayPresets.length === 0
                      ? 'No Presets Saved'
                      : selectedPresetName
                        ? 'Custom/Modified Config'
                        : 'Select a Saved Preset...'}
                  </option>
                  {multiplayerPreset && (
                    <option value={officialPresetName}>
                      {officialPresetName.toUpperCase()} (READ-ONLY{multiplayerPreset.version ? ` - V${multiplayerPreset.version}` : ''})
                    </option>
                  )}
                  {gameplayPresets.map((preset) => (
                    <option key={preset.name} value={preset.name}>
                      {preset.name.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1.5 flex-1 max-w-sm">
                <input
                  type="text"
                  placeholder="Preset name..."
                  value={newPresetNameInput}
                  onChange={(event) => setNewPresetNameInput(event.target.value)}
                  className="flex-1 h-9 bg-black/60 border border-white/10 rounded px-3 text-xs text-white placeholder:text-white/30 focus:border-[#38bdf8]/50 outline-none transition-all"
                  maxLength={20}
                />
                <button
                  onClick={() => onSavePreset(newPresetNameInput)}
                  disabled={!newPresetNameInput.trim()}
                  className={`h-9 px-3 rounded text-xs font-sans font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1 shrink-0 ${
                    newPresetNameInput.trim()
                      ? 'bg-emerald-500/15 hover:bg-emerald-500/35 border border-emerald-500/40 text-emerald-400 cursor-pointer active:scale-95'
                      : 'bg-white/5 border border-white/5 text-white/20 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
              </div>

              {selectedPresetName === officialPresetName && (
                <span className="h-9 px-3 bg-amber-500/10 border border-amber-500/30 text-amber-300 font-bold text-[10px] uppercase tracking-wider rounded flex items-center justify-center gap-1 shrink-0">
                  Read-only - forced in multiplayer
                </span>
              )}

              {selectedPresetName && selectedPresetName !== officialPresetName && (
                <button
                  onClick={() => onDeletePreset(selectedPresetName)}
                  className="h-9 px-3 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 text-red-400 font-bold text-xs uppercase tracking-wider rounded cursor-pointer transition-all active:scale-[0.98] flex items-center justify-center gap-1 animate-fade-in"
                  title={`Delete "${selectedPresetName}" preset`}
                >
                  Delete
                </button>
              )}
            </div>
          </div>

          <button
            id="apply-admin-btn"
            onClick={onCloseAdminPanel}
            className="w-full h-11 mb-4 bg-white hover:bg-sky-400 hover:text-white text-slate-900 text-xs font-black uppercase tracking-widest rounded cursor-pointer transition-colors active:scale-98 flex items-center justify-center gap-2 shadow-lg pointer-events-auto"
          >
            <Check className="w-4 h-4" />
            Apply Changes & Resume Sandbox
          </button>

          <MechanicsSettingsGrid
            settings={adminSettings}
            setSettings={setAdminSettings}
            collapsedSections={collapsedSections}
            onToggleSection={onToggleSection}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 pointer-events-auto text-left"
          />
        </div>
      ) : showKeybindsMenu ? (
        <KeybindingSettingsModal
          keybindsModalTab={keybindsModalTab}
          setKeybindsModalTab={setKeybindsModalTab}
          keybindings={keybindings}
          setKeybindings={setKeybindings}
          rebindingAction={rebindingAction}
          setRebindingAction={setRebindingAction}
          forceMobileControls={forceMobileControls}
          setForceMobileControls={setForceMobileControls}
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
          onClose={onCloseKeybindings}
        />
      ) : (
        <LightingSettingsModal
          adminSettings={adminSettings}
          setAdminSettings={setAdminSettings}
          onClose={onCloseLighting}
        />
      )}
    </div>
  );
}
