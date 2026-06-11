import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, UniversalSettings } from '../../types';
import { AiBehaviorEditorPanel } from './AiBehaviorEditorPanel';
import { HeroCtaButton } from './HeroCtaButton';

interface SandboxSetupPanelProps {
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  aiPresets: AIPreset[];
  newAiPresetNameInput: string;
  setNewAiPresetNameInput: Dispatch<SetStateAction<string>>;
  onSelectAIPreset: (id: string) => void;
  onDeleteAIPreset: (id: string) => void;
  onSelectAIArchetype: (id: string) => void;
  onSaveAIPreset: (name: string) => void;
  onOpenBotSetup: () => void;
}

export function SandboxSetupPanel({
  adminSettings,
  setAdminSettings,
  aiPresets,
  newAiPresetNameInput,
  setNewAiPresetNameInput,
  onSelectAIPreset,
  onDeleteAIPreset,
  onSelectAIArchetype,
  onSaveAIPreset,
  onOpenBotSetup,
}: SandboxSetupPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 justify-between">
      <div className="flex flex-col gap-5 min-h-0 overflow-y-auto pr-0.5">
        <div className="flex items-center gap-2.5 mb-1 shrink-0">
          <span className="w-2 h-4 bg-blue-500" />
          <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
            Training Sandbox Setup
          </h2>
        </div>
        <p className="text-white/60 text-xs leading-relaxed bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal select-text shrink-0">
          This is a Grifball iBrawls simulator. The game can be played solo against AI or online against other players. All Gameplay/Mechanics Options only impact you, so coordinate with your opponent on the dials you want to match.
        </p>

        <AiBehaviorEditorPanel
          adminSettings={adminSettings}
          setAdminSettings={setAdminSettings}
          aiPresets={aiPresets}
          newAiPresetNameInput={newAiPresetNameInput}
          setNewAiPresetNameInput={setNewAiPresetNameInput}
          onSelectAIPreset={onSelectAIPreset}
          onDeleteAIPreset={onDeleteAIPreset}
          onSelectAIArchetype={onSelectAIArchetype}
          onSaveAIPreset={onSaveAIPreset}
        />
      </div>

      <div className="flex flex-col gap-3.5 mt-auto shrink-0 pt-4">
        <HeroCtaButton
          id="play-game-btn"
          label="Start Local Training"
          variant="sky"
          onClick={onOpenBotSetup}
        />
      </div>
    </div>
  );
}
