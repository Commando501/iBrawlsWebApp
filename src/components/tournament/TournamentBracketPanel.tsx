import type { TournamentMatch, TournamentState } from '../../types';
import {
  TOURNAMENT_DEFAULT_KILLS_TO_WIN,
  getTournamentRoundLabels,
} from '../../features/tournament/tournament';

interface TournamentBracketPanelProps {
  tournamentState: TournamentState;
  playerName: string;
  playerHue: number;
  isPlaying: boolean;
  onStartTournamentMatch: () => void;
  onResetTournament: () => void;
}

interface TournamentMatchCardProps {
  key?: string;
  match: TournamentMatch;
  playerName: string;
  playerHue: number;
  tournamentState: TournamentState;
}

function TournamentMatchCard({
  match,
  playerName,
  playerHue,
  tournamentState,
}: TournamentMatchCardProps) {
  const isPlayerMatch = match.opponent1 === 'player' || match.opponent2 === 'player';
  const opp1Name = match.opponent1 === 'player'
    ? `${playerName} (You)`
    : (tournamentState.opponents[match.opponent1]?.name || 'TBD');
  const opp2Name = tournamentState.opponents[match.opponent2]?.name || 'TBD';

  const opp1Hue = match.opponent1 === 'player'
    ? playerHue
    : (tournamentState.opponents[match.opponent1]?.hue ?? 0);
  const opp2Hue = tournamentState.opponents[match.opponent2]?.hue ?? 0;

  const isCompleted = match.isCompleted;
  const winnerId = match.winner;

  return (
    <div
      className={`bg-slate-950/60 rounded-xl p-3 border transition-all flex flex-col gap-2.5 relative select-none ${
        isPlayerMatch && !isCompleted
          ? 'border-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.15)] bg-slate-900/30'
          : 'border-white/10'
      }`}
    >
      {isPlayerMatch && !isCompleted && (
        <span className="absolute -top-2.5 right-4 bg-emerald-500 text-slate-950 text-[8px] font-black uppercase px-2 py-0.5 rounded tracking-widest shadow-md">
          YOUR MATCH
        </span>
      )}

      <div className="flex justify-between items-center text-left">
        <div className="flex items-center gap-2 max-w-[70%]">
          <div
            className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner shrink-0"
            style={{ backgroundColor: `hsl(${opp1Hue}, 80%, 50%)` }}
          />
          <span className={`text-xs font-black truncate uppercase ${winnerId === match.opponent1 ? 'text-white' : winnerId ? 'text-white/30' : 'text-white/80'}`}>
            {opp1Name}
          </span>
        </div>
        <span className="text-xs font-mono font-black tracking-tight tabular-nums">
          {isCompleted ? match.score1 : '-'}
        </span>
      </div>

      <div className="h-[1px] bg-white/5 flex items-center justify-center">
        <span className="text-[7.5px] font-mono font-bold tracking-widest text-white/25 px-2 bg-slate-950 uppercase shrink-0">VS</span>
      </div>

      <div className="flex justify-between items-center text-left">
        <div className="flex items-center gap-2 max-w-[70%]">
          <div
            className="w-3.5 h-3.5 rounded-full border border-white/20 shadow-inner shrink-0"
            style={{ backgroundColor: `hsl(${opp2Hue}, 80%, 50%)` }}
          />
          <span className={`text-xs font-black truncate uppercase ${winnerId === match.opponent2 ? 'text-white' : winnerId ? 'text-white/30' : 'text-white/80'}`}>
            {opp2Name}
          </span>
        </div>
        <span className="text-xs font-mono font-black tracking-tight tabular-nums">
          {isCompleted ? match.score2 : '-'}
        </span>
      </div>
    </div>
  );
}

function TournamentGameOverPanel({
  tournamentState,
  onResetTournament,
}: Pick<TournamentBracketPanelProps, 'tournamentState' | 'onResetTournament'>) {
  const playerMatch = tournamentState.rounds[tournamentState.currentRound]?.[0];
  const eliminatorName = playerMatch
    ? tournamentState.opponents[playerMatch.opponent2]?.name
    : undefined;

  return (
    <div className="text-center py-6 flex flex-col items-center gap-4 bg-red-950/20 border border-red-500/20 rounded-xl p-5 shadow-inner">
      <div className="w-12 h-12 rounded-full border border-red-500/30 flex items-center justify-center bg-red-950/40 animate-pulse">
        <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h3 className="text-xl font-black uppercase tracking-wider text-red-400 font-display">SIMULATION OVER</h3>
      <p className="text-xs text-white/60 leading-relaxed max-w-xs select-text">
        You were eliminated in Round {tournamentState.currentRound + 1} by <span className="text-red-400 font-bold uppercase">{eliminatorName}</span>. The tournament data has closed.
      </p>
      <button
        onClick={onResetTournament}
        className="mt-2 w-full h-12 bg-red-600 hover:bg-red-500 text-white font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-lg"
      >
        Restart Tournament
      </button>
    </div>
  );
}

function TournamentVictoryPanel({
  onResetTournament,
}: Pick<TournamentBracketPanelProps, 'onResetTournament'>) {
  return (
    <div className="text-center py-6 flex flex-col items-center gap-4 bg-amber-950/20 border border-amber-500/20 rounded-xl p-5 shadow-inner">
      <div className="w-14 h-14 rounded-full border border-amber-500/30 flex items-center justify-center bg-amber-950/40 shadow-[0_0_15px_rgba(245,158,11,0.25)] animate-pulse">
        <span className="text-2xl">WIN</span>
      </div>
      <h3 className="text-xl font-black uppercase tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200 font-display">CHAMPION DECREED</h3>
      <p className="text-xs text-white/60 leading-relaxed max-w-xs select-text">
        Congratulations! You have completed the iBrawls simulated tournament brackets and asserted yourself as the Grifball Champion.
      </p>

      <div className="w-full text-left bg-black/40 border border-white/5 rounded-lg p-3 flex flex-col gap-2">
        <span className="text-[9px] font-mono font-bold tracking-widest uppercase text-amber-400">Teased Rewards Unlocked:</span>
        <div className="flex flex-col gap-1.5 font-mono text-[9.5px]">
          <div className="flex justify-between border-b border-white/5 pb-1">
            <span className="text-white/60">TITLE:</span>
            <span className="text-amber-300 font-extrabold">ARENA CHAMPION</span>
          </div>
          <div className="flex justify-between border-b border-white/5 pb-1">
            <span className="text-white/60">ARMOR:</span>
            <span className="text-indigo-300 font-extrabold">CENTURION VOXEL</span>
          </div>
          <div className="flex justify-between">
            <span className="text-white/60">VFX TRAIL:</span>
            <span className="text-cyan-300 font-extrabold">CRIMSON PLASMA</span>
          </div>
        </div>
        <span className="text-[8.5px] text-white/30 text-center italic mt-1 uppercase">Rewards will be equipable in sandbox in the next build!</span>
      </div>

      <button
        onClick={onResetTournament}
        className="w-full h-12 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded transition-all active:scale-[0.98] cursor-pointer pointer-events-auto shadow-lg"
      >
        Begin New Run
      </button>
    </div>
  );
}

function TournamentRoundPanel({
  tournamentState,
  playerName,
  playerHue,
}: Pick<TournamentBracketPanelProps, 'tournamentState' | 'playerName' | 'playerHue'>) {
  const roundLabels = getTournamentRoundLabels(tournamentState.roundCount ?? tournamentState.rounds.length);
  const currentRoundMatches = tournamentState.rounds[tournamentState.currentRound] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2 font-mono text-[10px] select-none uppercase font-bold shrink-0">
        {roundLabels.map((roundName, roundIndex) => (
          <div
            key={roundName}
            className={`flex-1 text-center py-1.5 rounded border transition-colors ${
              tournamentState.currentRound === roundIndex
                ? 'bg-emerald-600/10 text-emerald-400 border-emerald-500/30'
                : roundIndex < tournamentState.currentRound
                  ? 'bg-white/5 text-white/60 border-white/5'
                  : 'text-white/20 border-white/5'
            }`}
          >
            {roundName}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3.5 shrink-0">
        {currentRoundMatches.map((match, matchIndex) => (
          <TournamentMatchCard
            key={`${match.opponent1}-${match.opponent2}-${matchIndex}`}
            match={match}
            playerName={playerName}
            playerHue={playerHue}
            tournamentState={tournamentState}
          />
        ))}
      </div>
    </div>
  );
}

export function TournamentBracketPanel({
  tournamentState,
  playerName,
  playerHue,
  isPlaying,
  onStartTournamentMatch,
  onResetTournament,
}: TournamentBracketPanelProps) {
  return (
    <div className="flex flex-col h-full min-h-0 justify-between">
      <div className="flex flex-col gap-4 min-h-0 overflow-y-auto pr-0.5">
        <div className="flex justify-between items-center pb-2 border-b border-white/5 shrink-0">
          <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5 font-display">simulated bracket</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded uppercase font-black">{tournamentState.difficulty}</span>
            <span className="text-[10px] font-mono text-white/50 bg-white/5 border border-white/10 px-2 py-0.5 rounded uppercase font-black">
              FT{tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN}
            </span>
          </div>
        </div>

        {tournamentState.status === 'gameover' ? (
          <TournamentGameOverPanel
            tournamentState={tournamentState}
            onResetTournament={onResetTournament}
          />
        ) : tournamentState.status === 'victory' ? (
          <TournamentVictoryPanel onResetTournament={onResetTournament} />
        ) : (
          <TournamentRoundPanel
            tournamentState={tournamentState}
            playerName={playerName}
            playerHue={playerHue}
          />
        )}
      </div>

      {(tournamentState.status === 'bracket' || (tournamentState.status === 'playing' && !isPlaying)) && (
        <div className="flex flex-col gap-3 mt-auto shrink-0 pt-4">
          <button
            id="start-tournament-match-btn"
            onClick={onStartTournamentMatch}
            className="group relative w-full h-16 bg-emerald-500 hover:bg-emerald-400 transition-all duration-300 flex items-center justify-center overflow-hidden cursor-pointer rounded shadow-2xl border border-emerald-400/20 select-none pointer-events-auto"
          >
            <span className="relative z-10 text-slate-950 font-sans font-black text-sm uppercase tracking-widest pointer-events-none flex items-center gap-2">
              {tournamentState.status === 'playing' ? 'Resume Match' : 'Start Next Match'}
              <svg className="w-5 h-5 text-slate-950" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
            </span>
          </button>

          <button
            onClick={onResetTournament}
            className="w-full h-12 bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 hover:border-white/20 active:scale-[0.99] transition-all cursor-pointer rounded pointer-events-auto select-none"
          >
            <span className="text-white/40 font-sans font-bold text-xs uppercase tracking-widest pointer-events-none">
              Reset Tournament
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
