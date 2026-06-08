import type { Dispatch, SetStateAction } from 'react';
import type { AIPreset } from '../../types';
import {
  TOURNAMENT_MAX_KILLS_TO_WIN,
  TOURNAMENT_MAX_ROUND_COUNT,
  TOURNAMENT_MIN_KILLS_TO_WIN,
  TOURNAMENT_MIN_ROUND_COUNT,
  getTournamentBotCount,
  type TournamentDifficulty,
} from '../../features/tournament/tournament';
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
    difficulty: TournamentDifficulty | 'custom',
    killsToWin?: number,
    roundCount?: number,
    selectedPresets?: AIPreset[]
  ) => void;
}

const STANDARD_TOURNAMENT_DIFFICULTIES: Array<{
  id: TournamentDifficulty;
  label: string;
  color: string;
  desc: string;
}> = [
  {
    id: 'easy',
    label: 'Easy',
    color: 'text-emerald-400 border-emerald-500/20 bg-emerald-950/20 hover:bg-emerald-950/40 shadow-[0_0_8px_rgba(16,185,129,0.1)]',
    desc: 'Sub-Normal combat reflex latency, simple spacing behavior.',
  },
  {
    id: 'normal',
    label: 'Normal',
    color: 'text-cyan-400 border-cyan-500/20 bg-cyan-950/20 hover:bg-cyan-950/40 shadow-[0_0_8px_rgba(6,182,212,0.1)]',
    desc: 'Standard combat matrix dials, average anticipation calculations.',
  },
  {
    id: 'hard',
    label: 'Hard',
    color: 'text-amber-400 border-amber-500/20 bg-amber-950/20 hover:bg-amber-950/40 shadow-[0_0_8px_rgba(245,158,11,0.1)]',
    desc: 'Calibrated prediction systems, fast pacing and evading.',
  },
  {
    id: 'nightmare',
    label: 'Nightmare',
    color: 'text-purple-400 border-purple-500/20 bg-purple-950/20 hover:bg-purple-950/40 shadow-[0_0_8px_rgba(168,85,247,0.1)]',
    desc: 'Hyper-responsive matrix overrides. Zero anticipation errors.',
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
  const handleStartCustomTournament = () => {
    const presetsToUse = aiPresets.filter((preset) => selectedTournamentPresets.includes(preset.id));
    onInitializeTournament('custom', tournamentKillsToWin, tournamentRoundCount, presetsToUse);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="w-2 h-4 bg-emerald-500" />
        <h2 className="text-sm uppercase font-bold tracking-[0.25em] text-white">
          Tournament Difficulty
        </h2>
      </div>
      <p className="text-white/60 text-xs leading-normal bg-white/5 border border-white/5 rounded-lg p-3.5 leading-normal">
        Advance through a simulated 1v1 elimination bracket across {tournamentRoundCount} {tournamentRoundCount === 1 ? 'round' : 'rounds'} ({getTournamentBotCount(tournamentRoundCount) + 1} brawlers). Each match is first to {tournamentKillsToWin} kills. If you lose, it's Game Over! AI bots are procedurally customized each playthrough.
      </p>
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
        <div className="flex flex-col gap-2.5 bg-white/5 border border-white/5 rounded-xl p-3.5 pointer-events-auto">
          <div className="flex items-center gap-2 mb-1 justify-between">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-3.5 bg-sky-400" />
              <span className="text-xs uppercase font-bold tracking-wider text-white">
                Custom AI Presets
              </span>
            </div>
            <span className="text-[10px] font-mono text-white/40">
              {selectedTournamentPresets.length} selected
            </span>
          </div>

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

          {selectedTournamentPresets.length > 0 && (
            <button
              onClick={handleStartCustomTournament}
              className="group relative w-full h-11 mt-1 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-[0_0_15px_rgba(16,185,129,0.3)] border border-emerald-400/20 select-none pointer-events-auto active:scale-[0.99]"
            >
              <span className="text-white font-sans font-black text-[11px] uppercase tracking-widest pointer-events-none flex items-center gap-1.5">
                Start Tournament
                <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </span>
            </button>
          )}
        </div>
      )}

      {aiPresets.length > 0 && selectedTournamentPresets.length === 0 && (
        <div className="flex items-center gap-3 py-1">
          <div className="h-[1px] flex-1 bg-white/5" />
          <span className="text-[9px] font-mono uppercase tracking-widest text-white/30 font-bold">OR SELECT Standard Difficulty</span>
          <div className="h-[1px] flex-1 bg-white/5" />
        </div>
      )}

      <div className="flex flex-col gap-3 pointer-events-auto">
        {STANDARD_TOURNAMENT_DIFFICULTIES.map((diff) => (
          <button
            key={diff.id}
            onClick={() => onInitializeTournament(diff.id, tournamentKillsToWin, tournamentRoundCount)}
            className={`group text-left p-4.5 rounded-xl border transition-all duration-300 cursor-pointer flex justify-between items-center ${diff.color} hover:scale-[1.01] hover:border-white/20`}
          >
            <div className="flex flex-col gap-1 pr-4">
              <span className="text-base font-black uppercase tracking-wider">{diff.label}</span>
              <span className="text-[10px] text-white/50 lowercase leading-normal">{diff.desc}</span>
            </div>
            <span className="text-[10px] font-mono font-black tracking-widest uppercase opacity-40 group-hover:opacity-100 group-hover:text-white transition-opacity shrink-0">
              SELECT &rarr;
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
