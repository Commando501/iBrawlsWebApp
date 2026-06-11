import { TOURNAMENT_DEFAULT_KILLS_TO_WIN } from '../../features/tournament/tournament';
import type { TournamentState } from '../../types';

export interface TournamentScoreSnapshot {
  scorePlayer: number;
  scoreEnemy: number;
}

export interface TournamentPlayerWinMatchResult {
  winner: 'player';
  opponentName: string;
  playerScore: number;
  opponentScore: number;
}

export type TournamentStatsResult =
  | { outcome: 'none' }
  | { outcome: 'player_win'; matchResult: TournamentPlayerWinMatchResult }
  | { outcome: 'opponent_win'; playerScore: number; opponentScore: number };

interface ResolveTournamentStatsResultOptions {
  singlePlayerMode: 'sandbox' | 'tournament' | 'ai-editor';
  tournamentState: TournamentState | null;
  hasPendingMatchResult: boolean;
  stats: TournamentScoreSnapshot;
}

export function resolveTournamentStatsResult({
  singlePlayerMode,
  tournamentState,
  hasPendingMatchResult,
  stats,
}: ResolveTournamentStatsResultOptions): TournamentStatsResult {
  if (singlePlayerMode !== 'tournament' || !tournamentState || tournamentState.status !== 'playing') {
    return { outcome: 'none' };
  }

  const killsToWin = tournamentState.killsToWin ?? TOURNAMENT_DEFAULT_KILLS_TO_WIN;
  if (stats.scorePlayer >= killsToWin && !hasPendingMatchResult) {
    const currentMatch = tournamentState.rounds[tournamentState.currentRound]?.[tournamentState.currentMatchIndex];
    const opponentId = currentMatch?.opponent2;
    const opponentName = opponentId ? tournamentState.opponents[opponentId]?.name : undefined;

    return {
      outcome: 'player_win',
      matchResult: {
        winner: 'player',
        opponentName: opponentName || 'AI Bot',
        playerScore: stats.scorePlayer,
        opponentScore: stats.scoreEnemy,
      },
    };
  }

  if (stats.scoreEnemy >= killsToWin) {
    return {
      outcome: 'opponent_win',
      playerScore: stats.scorePlayer,
      opponentScore: stats.scoreEnemy,
    };
  }

  return { outcome: 'none' };
}
