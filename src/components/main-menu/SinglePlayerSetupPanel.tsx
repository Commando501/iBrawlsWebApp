import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset, TournamentState, UniversalSettings } from '../../types';
import type { TournamentDifficulty } from '../../features/tournament/tournament';
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { SandboxSetupPanel } from './SandboxSetupPanel';
import { AiBehaviorEditorPanel } from './AiBehaviorEditorPanel';
import { TournamentBracketPanel } from '../tournament/TournamentBracketPanel';
import { TournamentSetupPanel } from '../tournament/TournamentSetupPanel';

type SinglePlayerMode = 'sandbox' | 'tournament' | 'ai-editor';

interface SinglePlayerSetupPanelProps {
  singlePlayerMode: SinglePlayerMode;
  setSinglePlayerMode: Dispatch<SetStateAction<SinglePlayerMode>>;
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
  tournamentState: TournamentState | null;
  selectedTournamentPresets: string[];
  setSelectedTournamentPresets: Dispatch<SetStateAction<string[]>>;
  tournamentKillsToWin: number;
  setTournamentKillsToWin: Dispatch<SetStateAction<number>>;
  tournamentRoundCount: number;
  setTournamentRoundCount: Dispatch<SetStateAction<number>>;
  onInitializeTournament: (
    difficulty: TournamentDifficulty | 'custom',
    killsToWin?: number,
    roundCount?: number,
    selectedPresets?: AIPreset[]
  ) => void;
  playerName: string;
  playerHue: number;
  isPlaying: boolean;
  onStartTournamentMatch: () => void;
  onResetTournament: () => void;
}

export function SinglePlayerSetupPanel({
  singlePlayerMode,
  setSinglePlayerMode,
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
  tournamentState,
  selectedTournamentPresets,
  setSelectedTournamentPresets,
  tournamentKillsToWin,
  setTournamentKillsToWin,
  tournamentRoundCount,
  setTournamentRoundCount,
  onInitializeTournament,
  playerName,
  playerHue,
  isPlaying,
  onStartTournamentMatch,
  onResetTournament,
}: SinglePlayerSetupPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 justify-between">
      <div className="flex bg-black/50 p-1.5 rounded-xl border border-white/10 gap-2 shrink-0 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] mb-4 select-none">
        <button
          onClick={() => setSinglePlayerMode('sandbox')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            singlePlayerMode === 'sandbox'
              ? 'bg-gradient-to-b from-[#22d3ee] to-[#0891b2] text-white shadow-[0_0_10px_rgba(34,211,238,0.4)] font-black'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          Sandbox Mode
        </button>
        <button
          onClick={() => setSinglePlayerMode('tournament')}
          className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            singlePlayerMode === 'tournament'
              ? 'bg-gradient-to-b from-emerald-400 to-emerald-600 text-slate-955 font-black text-white shadow-[0_0_10px_rgba(16,185,129,0.4)]'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          Tournament Mode
        </button>
        <button
          onClick={() => {
            setSinglePlayerMode('ai-editor');
            onSelectAIPreset('custom');
          }}
          className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all duration-200 cursor-pointer ${
            singlePlayerMode === 'ai-editor'
              ? 'bg-gradient-to-b from-[#38bdf8] to-[#2563eb] text-white shadow-[0_0_10px_rgba(56,189,248,0.35)] font-black'
              : 'text-white/40 hover:text-white/70'
          }`}
        >
          AI Behavior
        </button>
      </div>

      {singlePlayerMode === 'sandbox' ? (
        <SandboxSetupPanel
          visualModelPolicy={normalizeVisualModelPolicy(adminSettings.visualModelPolicy)}
          onVisualModelPolicyChange={(visualModelPolicy: VisualModelPolicy) => {
            setAdminSettings((previous) => ({ ...previous, visualModelPolicy }));
          }}
          onOpenBotSetup={onOpenBotSetup}
        />
      ) : singlePlayerMode === 'ai-editor' ? (
        <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-0.5">
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
      ) : (
        <div className="flex flex-col h-full min-h-0 justify-between">
          {!tournamentState ? (
            <TournamentSetupPanel
              aiPresets={aiPresets}
              selectedTournamentPresets={selectedTournamentPresets}
              setSelectedTournamentPresets={setSelectedTournamentPresets}
              tournamentKillsToWin={tournamentKillsToWin}
              setTournamentKillsToWin={setTournamentKillsToWin}
              tournamentRoundCount={tournamentRoundCount}
              setTournamentRoundCount={setTournamentRoundCount}
              onInitializeTournament={onInitializeTournament}
            />
          ) : (
            <TournamentBracketPanel
              tournamentState={tournamentState}
              playerName={playerName}
              playerHue={playerHue}
              isPlaying={isPlaying}
              onStartTournamentMatch={onStartTournamentMatch}
              onResetTournament={onResetTournament}
            />
          )}
        </div>
      )}
    </div>
  );
}
