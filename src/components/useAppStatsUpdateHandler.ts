import { useCallback, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { resolveTournamentStatsResult } from './tournament/tournamentStatsResult';
import type { AppMatchResult } from './useAppSessionState';
import type { GameStats, TournamentState } from '../types';
import type { GameplayMultiplayerRole } from './multiplayer/multiplayerConnectionConstants';
import type { MatchLobbyConfig } from '../network/protocol';

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
  matchLobbyConfig: MatchLobbyConfig | null;
}

export interface MultiplayerMatchEndResult {
  winner: 'host' | 'client' | 'blue' | 'red' | 'draw';
  reason: 'target' | 'timer';
}

export function resolveMultiplayerMatchEnd(
  stats: GameStats,
  config: MatchLobbyConfig | null
): MultiplayerMatchEndResult | null {
  if (!config) return null;

  const target = config.winTarget;
  const isTimerExpired = (stats.gameTime ?? 0) <= 0;

  if (config.gameMode === 'grifball') {
    const blueScore = stats.grifball?.blueGoals ?? stats.scorePlayer ?? 0;
    const redScore = stats.grifball?.redGoals ?? stats.scoreEnemy ?? 0;
    if (blueScore >= target || redScore >= target) {
      if (blueScore === redScore) return { winner: 'draw', reason: 'target' };
      return { winner: blueScore > redScore ? 'blue' : 'red', reason: 'target' };
    }
    if (isTimerExpired) {
      if (blueScore === redScore) return { winner: 'draw', reason: 'timer' };
      return { winner: blueScore > redScore ? 'blue' : 'red', reason: 'timer' };
    }
    return null;
  }

  const hostScore = stats.scorePlayer ?? 0;
  const clientScore = stats.scoreEnemy ?? 0;
  if (hostScore >= target || clientScore >= target) {
    if (hostScore === clientScore) return { winner: 'draw', reason: 'target' };
    return { winner: hostScore > clientScore ? 'host' : 'client', reason: 'target' };
  }
  if (isTimerExpired) {
    if (hostScore === clientScore) return { winner: 'draw', reason: 'timer' };
    return { winner: hostScore > clientScore ? 'host' : 'client', reason: 'timer' };
  }
  return null;
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
  matchLobbyConfig,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  ping,
  clientId,
  opponentClientId,
}: UseAppStatsUpdateHandlerOptions) {
  const multiplayerMatchEndSentRef = useRef(false);

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

    if (!isMultiplayer || multiplayerRole !== 'host' || !matchLobbyConfig) {
      multiplayerMatchEndSentRef.current = false;
    } else {
      const matchEnd = resolveMultiplayerMatchEnd(stats, matchLobbyConfig);
      if (matchEnd && !multiplayerMatchEndSentRef.current) {
        multiplayerMatchEndSentRef.current = true;
        if (multiplayerSocket?.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify({
            type: 'sync',
            action: 'match_end',
            winner: matchEnd.winner,
            reason: matchEnd.reason,
          }));
        }
        setIsPaused(true);
      }
      if (!matchEnd && stats.gameTime > 0 && stats.scorePlayer === 0 && stats.scoreEnemy === 0) {
        multiplayerMatchEndSentRef.current = false;
      }
    }

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
    matchLobbyConfig,
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
