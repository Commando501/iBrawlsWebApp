import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { resolveTournamentStatsResult } from './tournament/tournamentStatsResult';
import type { AppMatchResult } from './useAppSessionState';
import type { GameStats, TournamentState } from '../types';
import type { GameplayMultiplayerRole } from './multiplayer/multiplayerConnectionConstants';

type SinglePlayerMode = 'sandbox' | 'tournament';

interface CurrentStatsConnectionSnapshot {
  isMultiplayer: boolean;
  multiplayerRole: GameplayMultiplayerRole;
  multiplayerSocket: WebSocket | null;
  ping: number;
  clientId: string;
  opponentClientId: string;
}

export function buildCurrentStatsSnapshot(
  stats: GameStats,
  {
    isMultiplayer,
    multiplayerRole,
    multiplayerSocket,
    ping,
    clientId,
    opponentClientId,
  }: CurrentStatsConnectionSnapshot,
): GameStats {
  return {
    ...stats,
    isMultiplayer,
    multiplayerRole,
    opponentConnected: isMultiplayer && !!multiplayerSocket,
    ping,
    playerClientId: clientId || 'Player',
    opponentClientId: opponentClientId || 'Opponent',
  };
}

interface UseAppStatsUpdateHandlerOptions extends CurrentStatsConnectionSnapshot {
  singlePlayerMode: SinglePlayerMode;
  tournamentState: TournamentState | null;
  matchResult: AppMatchResult | null;
  setMatchResult: Dispatch<SetStateAction<AppMatchResult | null>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  handleCompleteTournamentMatch: (playerWon: boolean, playerScore: number, opponentScore: number) => void;
  trackEdgeLowFps: (fps: number) => void;
  setCurrentStats: Dispatch<SetStateAction<GameStats>>;
}

export function useAppStatsUpdateHandler({
  singlePlayerMode,
  tournamentState,
  matchResult,
  setMatchResult,
  setIsPaused,
  handleCompleteTournamentMatch,
  trackEdgeLowFps,
  setCurrentStats,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  ping,
  clientId,
  opponentClientId,
}: UseAppStatsUpdateHandlerOptions) {
  return useCallback((stats: GameStats) => {
    const tournamentStatsResult = resolveTournamentStatsResult({
      singlePlayerMode,
      tournamentState,
      hasPendingMatchResult: matchResult !== null,
      stats,
    });
    if (tournamentStatsResult.outcome === 'player_win') {
      setMatchResult(tournamentStatsResult.matchResult);
      setIsPaused(true);
      return;
    }
    if (tournamentStatsResult.outcome === 'opponent_win') {
      handleCompleteTournamentMatch(false, tournamentStatsResult.playerScore, tournamentStatsResult.opponentScore);
      return;
    }

    trackEdgeLowFps(stats.fps);

    setCurrentStats(buildCurrentStatsSnapshot(stats, {
      isMultiplayer,
      multiplayerRole,
      multiplayerSocket,
      ping,
      clientId,
      opponentClientId,
    }));
  }, [
    clientId,
    handleCompleteTournamentMatch,
    isMultiplayer,
    matchResult,
    multiplayerRole,
    multiplayerSocket,
    opponentClientId,
    ping,
    setCurrentStats,
    setIsPaused,
    setMatchResult,
    singlePlayerMode,
    tournamentState,
    trackEdgeLowFps,
  ]);
}
