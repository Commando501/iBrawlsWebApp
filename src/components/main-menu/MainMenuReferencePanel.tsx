import React from 'react';
import type { UniversalSettings, Keybindings } from '../../types';
import type { CharacterLoadout } from '../VoxelModels';
import type { CustomArmorCatalog } from '../customArmor';
import { ManualControlsPanel } from './ManualControlsPanel';
import { VisualGamepadMapper } from './VisualGamepadMapper';
import {
  CustomizationPanel,
  type PreviewWeapon,
  type SaveSystemStatus,
} from './CustomizationPanel';

export type MainMenuReferenceTab = 'manual' | 'gamepad' | 'customize';

interface MainMenuReferencePanelProps {
  rightPanelTab: MainMenuReferenceTab;
  setRightPanelTab: React.Dispatch<React.SetStateAction<MainMenuReferenceTab>>;
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
  isPainting: boolean;
  playerLoadout: CharacterLoadout;
  customArmorCatalog: CustomArmorCatalog;
  playerHue?: number;
  customizerWeapon: PreviewWeapon;
  playerName: string;
  saveSystemStatus: SaveSystemStatus;
  saveCodeImportInput: string;
  setPlayerLoadout: React.Dispatch<React.SetStateAction<CharacterLoadout>>;
  setIsPainting: React.Dispatch<React.SetStateAction<boolean>>;
  setCustomizerWeapon: React.Dispatch<React.SetStateAction<PreviewWeapon>>;
  setAdminSettings: React.Dispatch<React.SetStateAction<UniversalSettings>>;
  onPlayerNameChange: (value: string) => void;
  onExportSaveCode: () => void;
  onResetAllSettings: () => void;
  onSaveCodeImportInputChange: (value: string) => void;
  onImportSaveCode: (value: string) => void;
}

const REFERENCE_TABS: Array<{ id: MainMenuReferenceTab; label: string }> = [
  { id: 'manual', label: 'Controls' },
  { id: 'gamepad', label: 'Gamepad' },
  { id: 'customize', label: 'Armor' },
];

export function MainMenuReferencePanel({
  rightPanelTab,
  setRightPanelTab,
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
  isPainting,
  playerLoadout,
  customArmorCatalog,
  playerHue,
  customizerWeapon,
  playerName,
  saveSystemStatus,
  saveCodeImportInput,
  setPlayerLoadout,
  setIsPainting,
  setCustomizerWeapon,
  setAdminSettings,
  onPlayerNameChange,
  onExportSaveCode,
  onResetAllSettings,
  onSaveCodeImportInputChange,
  onImportSaveCode,
}: MainMenuReferencePanelProps) {
  return (
    <div className="mobile-reference-panel flex flex-col h-full min-h-0 overflow-y-auto gap-4">
      <div className="flex bg-black/40 p-1.5 rounded-lg border border-white/5 gap-1.5 select-none shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]">
        {REFERENCE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setRightPanelTab(tab.id)}
            className={`flex-1 py-2 text-xs font-bold font-display uppercase tracking-wider rounded transition-all cursor-pointer text-center flex items-center justify-center gap-1 shrink-0 ${
              rightPanelTab === tab.id
                ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-slate-950 shadow-md font-black'
                : 'text-white/40 hover:text-white/70'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {rightPanelTab === 'manual' && (
        <ManualControlsPanel
          keybindings={keybindings}
          setKeybindings={setKeybindings}
          rebindingAction={rebindingAction}
          setRebindingAction={setRebindingAction}
        />
      )}

      {rightPanelTab === 'gamepad' && (
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

      {rightPanelTab === 'customize' && (
        <CustomizationPanel
          isPainting={isPainting}
          playerLoadout={playerLoadout}
          customArmorCatalog={customArmorCatalog}
          playerHue={playerHue}
          customizerWeapon={customizerWeapon}
          playerName={playerName}
          saveSystemStatus={saveSystemStatus}
          saveCodeImportInput={saveCodeImportInput}
          setPlayerLoadout={setPlayerLoadout}
          setIsPainting={setIsPainting}
          setCustomizerWeapon={setCustomizerWeapon}
          setAdminSettings={setAdminSettings}
          onPlayerNameChange={onPlayerNameChange}
          onExportSaveCode={onExportSaveCode}
          onResetAllSettings={onResetAllSettings}
          onSaveCodeImportInputChange={onSaveCodeImportInputChange}
          onImportSaveCode={onImportSaveCode}
        />
      )}
    </div>
  );
}
