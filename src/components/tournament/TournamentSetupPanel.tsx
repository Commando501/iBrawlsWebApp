import { useState, type Dispatch, type SetStateAction } from 'react';
import type { AIPreset } from '../../types';
import {
  TOURNAMENT_MAX_KILLS_TO_WIN,
  TOURNAMENT_MAX_ROUND_COUNT,
  TOURNAMENT_MIN_KILLS_TO_WIN,
  TOURNAMENT_MIN_ROUND_COUNT,
  getTournamentBotCount,
  type TournamentAISelection,
  type TournamentDifficulty,
} from '../../features/tournament/tournament';
import {
  DEFAULT_NEURAL_BRAIN_ID,
  NEURAL_BRAIN_DEFINITIONS,
  NEURAL_NET_DIFFICULTY,
  type NeuralBrainId,
} from '../../game/neuralBrains';
import { AdvancedSection } from '../main-menu/AdvancedSection';
import { HeroCtaButton } from '../main-menu/HeroCtaButton';
import { getPresetDescription } from '../main-menu/aiMenuContent';

interface TournamentSetupPanelProps {
  aiPresets: AIPreset[];
  selectedTournamentPresets: string[];
  setSelectedTournamentPresets: Dispatch<SetStateAction<string[]>>;
  tournamentKillsToWin: number;
  setTournamentKillsToWin: Dispatch<SetStateAction<number>>;
  tournamentRoundCount: number;
  setTournamentRoundCount: Dispatch<SetStateAction<number>>;
  onInitializeTournament: (
    difficulty: TournamentAISelection,
    killsToWin?: number,
    roundCount?: number,
    selectedPresets?: AIPreset[],
    neuralBrainId?: NeuralBrainId | string
  ) => void;
}

const STANDARD_TOURNAMENT_DIFFICULTIES: Array<{
  id: TournamentDifficulty | typeof NEURAL_NET_DIFFICULTY;
  label: string;
  color: string;
  selectedColor: string;
  desc: string;
}> = [
  {
    id: 'easy',
    label: 'Easy',
    color: 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-950/40',
    selectedColor: 'text-emerald-300 border-emerald-400/70 bg-emerald-950/50 shadow-[0_0_14px_rgba(16,185,129,0.25)]',
    desc: 'Sub-Normal combat reflex latency, simple spacing behavior.',
  },
  {
    id: 'normal',
    label: 'Normal',
    color: 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/40',
    selectedColor: 'text-cyan-300 border-cyan-400/70 bg-cyan-950/50 shadow-[0_0_14px_rgba(6,182,212,0.25)]',
    desc: 'Standard combat matrix dials, average anticipation calculations.',
  },
  {
    id: 'hard',
    label: 'Hard',
    color: 'text-amber-400 border-amber-500/20 bg-amber-950/20 hover:bg-amber-950/40',
    selectedColor: 'text-amber-300 border-amber-400/70 bg-amber-950/50 shadow-[0_0_14px_rgba(245,158,11,0.25)]',
    desc: 'Calibrated prediction systems, fast pacing and evading.',
  },
  {
    id: 'nightmare',
    label: 'Nightmare',
    color: 'text-purple-400 border-purple-500/20 bg-purple-950/20 hover:bg-purple-950/40',
    selectedColor: 'text-purple-300 border-purple-400/70 bg-purple-950/50 shadow-[0_0_14px_rgba(168,85,247,0.25)]',
    desc: 'Hyper-responsive matrix overrides. Zero anticipation errors.',
  },
  {
    id: NEURAL_NET_DIFFICULTY,
    label: 'NeuralNet',
    color: 'text-fuchsia-300 border-fuchsia-500/20 bg-fuchsia-950/20 hover:bg-fuchsia-950/40',
    selectedColor: 'text-fuchsia-200 border-fuchsia-300/70 bg-fuchsia-950/50 shadow-[0_0_14px_rgba(217,70,239,0.25)]',
    desc: 'Runs the exported CombatDRV2 reinforcement-learning brain.',
  },
];

export function TournamentSetupPanel({
  aiPresets,
  selectedTournamentPresets,
  setSelectedTournamentPresets,
  tournamentKillsToWin,
  setTournamentKillsToWin,
  tournamentRoundCount,
  setTournamentRoundCount,
  onInitializeTournament,
}: TournamentSetupPanelProps) {
  const [selectedDifficulty, setSelectedDifficulty] = useState<TournamentDifficulty | typeof NEURAL_NET_DIFFICULTY>('normal');
  const [selectedNeuralBrainId, setSelectedNeuralBrainId] = useState<NeuralBrainId | string>(DEFAULT_NEURAL_BRAIN_ID);
  const usingCustomLineup = selectedTournamentPresets.length > 0;

  const handleStartTournament = () => {
    if (usingCustomLineup) {
      const presetsToUse = aiPresets.filter((preset) => selectedTournamentPresets.includes(preset.id));
      onInitializeTournament('custom', tournamentKillsToWin, tournamentRoundCount, presetsToUse);
      return;
    }
    onInitializeTournament(
      selectedDifficulty,
      tournamentKillsToWin,
      tournamentRoundCount,
      undefined,
      selectedDifficulty === NEURAL_NET_DIFFICULTY ? selectedNeuralBrainId : undefined
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 justify-between gap-4">
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-0.5">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-4 bg-emerald-500" />
          <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
            Tournament Setup
          </h2>
        </div>
        <p className="text-white/60 text-xs leading-normal bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal">
          Advance through a simulated 1v1 elimination bracket across {tournamentRoundCount} {tournamentRoundCount === 1 ? 'round' : 'rounds'} ({getTournamentBotCount(tournamentRoundCount) + 1} brawlers). Each match is first to {tournamentKillsToWin} kills. If you lose, it's Game Over! AI bots are procedurally customized each playthrough.
        </p>

        <div className={`grid grid-cols-2 gap-2.5 pointer-events-auto ${usingCustomLineup ? 'opacity-40 pointer-events-none' : ''}`}>
          {STANDARD_TOURNAMENT_DIFFICULTIES.map((diff) => {
            const isSelected = !usingCustomLineup && selectedDifficulty === diff.id;
            return (
              <button
                key={diff.id}
                onClick={() => setSelectedDifficulty(diff.id)}
                className={`group text-left p-3.5 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-1 ${
                  isSelected ? diff.selectedColor : diff.color
                }`}
                aria-pressed={isSelected}
                title={diff.desc}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black uppercase tracking-wider">{diff.label}</span>
                  <span className={`w-3 h-3 rounded-full border transition-all shrink-0 ${
                    isSelected ? 'bg-current border-current' : 'border-white/25'
                  }`} />
                </span>
                <span className="text-[10px] text-white/50 lowercase leading-normal">{diff.desc}</span>
              </button>
            );
          })}
        </div>

        {!usingCustomLineup && selectedDifficulty === NEURAL_NET_DIFFICULTY && (
          <div className="flex flex-col gap-1.5 bg-white/5 border border-fuchsia-400/20 rounded-lg p-3.5 pointer-events-auto">
            <label className="text-xs font-mono uppercase tracking-wider text-white/60" htmlFor="tournament-neural-brain">
              NeuralNet Brain
            </label>
            <select
              id="tournament-neural-brain"
              value={selectedNeuralBrainId}
              onChange={(e) => setSelectedNeuralBrainId(e.target.value)}
              className="w-full bg-black/50 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-fuchsia-300"
            >
              {NEURAL_BRAIN_DEFINITIONS.map((brain) => (
                <option key={brain.id} value={brain.id}>
                  {brain.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {usingCustomLineup && (
          <p className="text-[10px] text-sky-300/80 font-mono uppercase tracking-widest text-center">
            Custom AI lineup active — standard difficulty disabled
          </p>
        )}

        <div className="flex flex-col gap-1.5 bg-white/5 border border-white/5 rounded-lg p-3.5 pointer-events-auto">
          <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
            <span>Tournament Rounds</span>
            <span className="text-emerald-400 font-bold">{tournamentRoundCount}</span>
          </div>
          <input
            type="range"
            min={TOURNAMENT_MIN_ROUND_COUNT}
            max={TOURNAMENT_MAX_ROUND_COUNT}
            step="1"
            value={tournamentRoundCount}
            onChange={(e) => setTournamentRoundCount(parseInt(e.target.value, 10))}
            className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-[9px] font-mono text-white/35 uppercase tracking-widest">
            {TOURNAMENT_MIN_ROUND_COUNT} - {TOURNAMENT_MAX_ROUND_COUNT} elimination rounds
          </span>
        </div>
        <div className="flex flex-col gap-1.5 bg-white/5 border border-white/5 rounded-lg p-3.5 pointer-events-auto">
          <div className="flex justify-between text-xs font-mono uppercase tracking-wider text-white/60">
            <span>Kills to Win</span>
            <span className="text-emerald-400 font-bold">{tournamentKillsToWin}</span>
          </div>
          <input
            type="range"
            min={TOURNAMENT_MIN_KILLS_TO_WIN}
            max={TOURNAMENT_MAX_KILLS_TO_WIN}
            step="1"
            value={tournamentKillsToWin}
            onChange={(e) => setTournamentKillsToWin(parseInt(e.target.value, 10))}
            className="w-full accent-emerald-400 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-[9px] font-mono text-white/35 uppercase tracking-widest">
            {TOURNAMENT_MIN_KILLS_TO_WIN} - {TOURNAMENT_MAX_KILLS_TO_WIN} kills per match
          </span>
        </div>

        {aiPresets.length > 0 && (
          <AdvancedSection
            sectionId="tournament-custom-lineup"
            title="Custom AI Lineup"
            badge={usingCustomLineup ? `${selectedTournamentPresets.length} selected` : undefined}
          >
            <p className="text-[10px] text-white/40 leading-snug">
              Hand-pick saved AI presets to seed the bracket instead of a standard difficulty. The bracket fills remaining slots from your selection.
            </p>
            <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
              {aiPresets.map((preset) => {
                const isSelected = selectedTournamentPresets.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setSelectedTournamentPresets((prev) =>
                        prev.includes(preset.id)
                          ? prev.filter((id) => id !== preset.id)
                          : [...prev, preset.id]
                      );
                    }}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-left transition-all cursor-pointer font-sans ${
                      isSelected
                        ? 'bg-sky-500/10 border-sky-400/50 hover:bg-sky-500/15 text-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.15)]'
                        : 'bg-black/40 border-white/5 text-white/70 hover:bg-black/60 hover:border-white/10 hover:text-white'
                    }`}
                    title={getPresetDescription(preset.id, aiPresets)}
                  >
                    <div className="flex flex-col min-w-0 pr-2">
                      <span className="text-xs font-bold truncate">{preset.name}</span>
                      <span className="text-[9px] text-white/40 font-mono">
                        RL: {preset.tuning.aiReactionLatency?.toFixed(2)}s
                      </span>
                    </div>
                    <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all shrink-0 ${
                      isSelected ? 'border-sky-400 bg-sky-400 text-slate-900' : 'border-white/20 bg-transparent'
                    }`}>
                      {isSelected && (
                        <svg className="w-2.5 h-2.5 font-bold" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </AdvancedSection>
        )}
      </div>

      <div className="flex flex-col gap-3 mt-auto shrink-0 pt-4">
        <HeroCtaButton
          id="start-tournament-btn"
          label={usingCustomLineup ? 'Start Custom Tournament' : `Start ${selectedDifficulty === NEURAL_NET_DIFFICULTY ? 'NeuralNet' : selectedDifficulty} Tournament`}
          variant="emerald"
          onClick={handleStartTournament}
        />
      </div>
    </div>
  );
}
