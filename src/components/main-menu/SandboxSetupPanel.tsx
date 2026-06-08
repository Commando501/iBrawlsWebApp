import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, UniversalSettings } from '../../types';
import { AiBehaviorEditorPanel } from './AiBehaviorEditorPanel';

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
        <button
          id="play-game-btn"
          onClick={onOpenBotSetup}
          className="group relative w-full h-16 bg-white hover:bg-sky-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-white/20 select-none pointer-events-auto"
        >
          <div className="absolute inset-0 bg-blue-600 translate-x-[-100%] group-hover:translate-x-0 transition-transform duration-300" />
          <span className="relative z-10 text-slate-900 font-sans font-black text-sm uppercase tracking-widest group-hover:text-white pointer-events-none flex items-center gap-2">
            Start Local Training
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
            </svg>
          </span>
        </button>
      </div>
    </div>
  );
}
