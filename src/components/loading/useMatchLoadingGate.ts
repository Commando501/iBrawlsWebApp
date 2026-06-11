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

  const resetMatchLoading = useCallback((stage = 'Preparing match') => {
    setGameLoadingState(createInitialGameLoadingState(stage));
    setMultiplayerLoadingRoster({});
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
    () => deriveMultiplayerLoadingSnapshot(multiplayerLoadingRoster, loadingGateNow, MATCH_LOADING_TIMEOUT_MS),
    [multiplayerLoadingRoster, loadingGateNow]
  );

  const isMatchLoadingActive = isPlaying && (
    isMultiplayer
      ? !multiplayerLoadingSnapshot.gateReleased
      : !gameLoadingState.ready
  );

  useEffect(() => {
    if (!isPlaying) {
      setGameLoadingState(INITIAL_GAME_LOADING_STATE);
      setMultiplayerLoadingRoster({});
      setGameplayClientId('');
      return;
    }
    resetMatchLoading(selectedReplayId ? 'Preparing replay' : 'Preparing match');
  }, [isPlaying, selectedReplayId, selectedMap, lobbyCustomMapData, resetMatchLoading, setGameplayClientId]);

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
      ready: gameLoadingState.ready,
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
    gameLoadingState.ready,
    upsertLoadingParticipantStatus,
  ]);

  useEffect(() => {
    if (!isPlaying || !isMultiplayer || !multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN || !gameplayClientId) {
      return;
    }
    multiplayerSocket.send(JSON.stringify({
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
      ready: gameLoadingState.ready,
    }));
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
    gameLoadingState.ready,
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
