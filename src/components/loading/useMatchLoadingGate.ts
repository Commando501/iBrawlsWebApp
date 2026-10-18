import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CustomMapData } from '../../types';
import type { VisualModelPolicy } from '../../model/modelSystem';
import type { CharacterLoadout } from '../VoxelModels';
import {
  MATCH_LOADING_TIMEOUT_MS,
  createInitialGameLoadingState,
  deriveMultiplayerLoadingSnapshot,
  normalizeLoadingRole,
  removeLoadingParticipant,
  restartLoadingParticipantTimeouts,
  upsertLoadingSlot,
  upsertLoadingSlots,
  upsertLoadingStatus,
} from './matchLoadingState';
import {
  INITIAL_GAME_LOADING_STATE,
  type GameLoadingState,
  type MatchLoadingRole,
  type MultiplayerLoadingParticipant,
  type MultiplayerLoadingSlotPayload,
  type MultiplayerLoadingStatusPayload,
} from './loadingTypes';

interface UseMatchLoadingGateOptions {
  isPlaying: boolean;
  isMultiplayer: boolean;
  multiplayerRole: MatchLoadingRole | null;
  multiplayerSpawnSlot: number;
  multiplayerSocket: WebSocket | null;
  gameplayClientId: string;
  setGameplayClientId: (clientId: string) => void;
  playerName: string;
  playerHue: number;
  playerLoadout: CharacterLoadout;
  visualModelPolicy?: VisualModelPolicy | null;
  selectedReplayId?: string | null;
  selectedMap: string;
  lobbyCustomMapData: CustomMapData | null;
}

export function useMatchLoadingGate({
  isPlaying,
  isMultiplayer,
  multiplayerRole,
  multiplayerSpawnSlot,
  multiplayerSocket,
  gameplayClientId,
  setGameplayClientId,
  playerName,
  playerHue,
  playerLoadout,
  visualModelPolicy,
  selectedReplayId,
  selectedMap,
  lobbyCustomMapData,
}: UseMatchLoadingGateOptions) {
  const [gameLoadingState, setGameLoadingState] = useState<GameLoadingState>(INITIAL_GAME_LOADING_STATE);
  const [multiplayerLoadingRoster, setMultiplayerLoadingRoster] = useState<Record<string, MultiplayerLoadingParticipant>>({});
  const [loadingGateNow, setLoadingGateNow] = useState(() => Date.now());

  const localLoadingRole = normalizeLoadingRole(multiplayerRole);
  const activeCustomMap = selectedMap === 'custom_file' ? lobbyCustomMapData : null;

  const resetMatchLoading = useCallback((stage = 'Preparing match') => {
    setGameLoadingState(createInitialGameLoadingState(stage));
    // A peer can finish before this client handles match_start. Keep both the
    // staged roster and any readiness already received, and start the timeout
    // for waiting peers now rather than counting time spent in the lobby.
    setMultiplayerLoadingRoster(roster => restartLoadingParticipantTimeouts(roster, Date.now()));
  }, []);

  const mergeLoadingParticipants = useCallback((slots: MultiplayerLoadingSlotPayload[] | undefined) => {
    if (!slots?.length) return;
    const now = Date.now();
    setMultiplayerLoadingRoster((roster) => upsertLoadingSlots(roster, slots, now));
  }, []);

  const upsertLoadingParticipantSlot = useCallback((slot: MultiplayerLoadingSlotPayload) => {
    setMultiplayerLoadingRoster((roster) => upsertLoadingSlot(roster, slot, Date.now()));
  }, []);

  const upsertLoadingParticipantStatus = useCallback((
    status: MultiplayerLoadingStatusPayload,
    fallbackClientId?: string
  ) => {
    setMultiplayerLoadingRoster((roster) => upsertLoadingStatus(roster, status, fallbackClientId, Date.now()));
  }, []);

  const removeLoadingParticipantById = useCallback((clientId: string | undefined) => {
    setMultiplayerLoadingRoster((roster) => removeLoadingParticipant(roster, clientId));
  }, []);

  const handleGameLoadingStateChange = useCallback((state: GameLoadingState) => {
    setGameLoadingState(state);
  }, []);

  const multiplayerLoadingSnapshot = useMemo(
    () => deriveMultiplayerLoadingSnapshot(multiplayerLoadingRoster, loadingGateNow, MATCH_LOADING_TIMEOUT_MS, gameplayClientId),
    [multiplayerLoadingRoster, loadingGateNow, gameplayClientId]
  );

  const isLocalSceneReady = gameLoadingState.ready && !gameLoadingState.error;
  const isMatchLoadingActive = isPlaying && (
    !isLocalSceneReady
    || (isMultiplayer && !multiplayerLoadingSnapshot.gateReleased)
  );

  useEffect(() => {
    if (!isPlaying) {
      setGameLoadingState(INITIAL_GAME_LOADING_STATE);
      return;
    }
    resetMatchLoading(selectedReplayId ? 'Preparing replay' : 'Preparing match');
  }, [isPlaying, selectedReplayId, selectedMap, activeCustomMap, resetMatchLoading]);

  // The socket identity is also needed by objective ownership after leaving the lobby.
  useEffect(() => {
    if (!multiplayerSocket) {
      setGameplayClientId('');
      setMultiplayerLoadingRoster({});
    }
  }, [multiplayerSocket, setGameplayClientId]);

  useEffect(() => {
    if (!isPlaying || !isMultiplayer || !isMatchLoadingActive) return;
    const interval = window.setInterval(() => setLoadingGateNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [isPlaying, isMultiplayer, isMatchLoadingActive]);

  useEffect(() => {
    if (!isPlaying || !isMultiplayer || !gameplayClientId) return;
    upsertLoadingParticipantStatus({
      clientId: gameplayClientId,
      role: localLoadingRole,
      spawnSlot: multiplayerSpawnSlot,
      playerName,
      hue: playerHue,
      loadout: playerLoadout,
      visualModelPolicy: visualModelPolicy ?? undefined,
      progress: gameLoadingState.progress,
      stage: gameLoadingState.stage,
      ready: isLocalSceneReady,
    }, gameplayClientId);
  }, [
    isPlaying,
    isMultiplayer,
    gameplayClientId,
    localLoadingRole,
    multiplayerSpawnSlot,
    playerName,
    playerHue,
    playerLoadout,
    visualModelPolicy,
    gameLoadingState.progress,
    gameLoadingState.stage,
    isLocalSceneReady,
    upsertLoadingParticipantStatus,
  ]);

  useEffect(() => {
    if (!isPlaying || !isMultiplayer || !multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN || !gameplayClientId) {
      return;
    }
    const packet = JSON.stringify({
      type: 'sync',
      action: 'match_loading_status',
      role: localLoadingRole,
      spawnSlot: multiplayerSpawnSlot,
      playerName,
      hue: playerHue,
      loadout: playerLoadout,
      visualModelPolicy: visualModelPolicy ?? undefined,
      progress: gameLoadingState.progress,
      stage: gameLoadingState.stage,
      ready: isLocalSceneReady,
    });
    multiplayerSocket.send(packet);

    if (!isLocalSceneReady) return;
    // Players who join an active match missed our final status. Their first
    // loading update requests a single ready reply, without a heartbeat or a
    // ready-to-ready reply loop that could keep refreshing peer deadlines.
    const repliedTo = new Set<string>();
    const handleLoadingStatus = (event: MessageEvent) => {
      let data: { type?: string; action?: string; senderId?: string; ready?: boolean };
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!data || data.type !== 'sync' || data.action !== 'match_loading_status'
        || typeof data.senderId !== 'string' || !data.senderId || data.senderId === gameplayClientId) return;
      if (data.ready === true) {
        repliedTo.delete(data.senderId);
      } else if (data.ready === false && !repliedTo.has(data.senderId) && multiplayerSocket.readyState === WebSocket.OPEN) {
        repliedTo.add(data.senderId);
        multiplayerSocket.send(packet);
      }
    };
    multiplayerSocket.addEventListener('message', handleLoadingStatus);
    return () => multiplayerSocket.removeEventListener('message', handleLoadingStatus);
  }, [
    isPlaying,
    isMultiplayer,
    multiplayerSocket,
    gameplayClientId,
    localLoadingRole,
    multiplayerSpawnSlot,
    playerName,
    playerHue,
    playerLoadout,
    visualModelPolicy,
    gameLoadingState.progress,
    gameLoadingState.stage,
    isLocalSceneReady,
  ]);

  return {
    gameLoadingState,
    multiplayerLoadingSnapshot,
    isMatchLoadingActive,
    resetMatchLoading,
    mergeLoadingParticipants,
    upsertLoadingParticipantSlot,
    upsertLoadingParticipantStatus,
    removeLoadingParticipantById,
    handleGameLoadingStateChange,
  };
}
