import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { sfx } from './AudioEngine';
import type {
  GameplayConnectionStatus,
  GameplayMultiplayerRole,
} from './multiplayer/multiplayerConnectionConstants';

type SinglePlayerMode = 'sandbox' | 'tournament';
type QuickPlayStatus = 'idle' | 'searching' | 'matching';

export interface LocalGameMultiplayerReset {
  isMultiplayer: false;
  multiplayerRole: null;
  multiplayerPlayerCount: 1;
  multiplayerSpawnSlot: 0;
  multiplayerSocket: null;
}

export interface ReturnToMainMultiplayerReset extends LocalGameMultiplayerReset {
  connectionStatus: 'idle';
  opponentClientId: '';
}

export function createLocalGameMultiplayerReset(): LocalGameMultiplayerReset {
  return {
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerPlayerCount: 1,
    multiplayerSpawnSlot: 0,
    multiplayerSocket: null,
  };
}

export function createReturnToMainMultiplayerReset(): ReturnToMainMultiplayerReset {
  return {
    ...createLocalGameMultiplayerReset(),
    connectionStatus: 'idle',
    opponentClientId: '',
  };
}

export function shouldShowTerminatedOverlayAfterClose(singlePlayerMode: SinglePlayerMode): boolean {
  return singlePlayerMode !== 'tournament';
}

interface SharedLifecycleOptions {
  multiplayerSocket: WebSocket | null;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setIsTerminated: Dispatch<SetStateAction<boolean>>;
  setMultiplayerPlayerCount: Dispatch<SetStateAction<number>>;
  setMultiplayerSpawnSlot: Dispatch<SetStateAction<number>>;
  setQuickPlayStatus: Dispatch<SetStateAction<QuickPlayStatus>>;
  closeGamePanels: () => void;
}

interface CloseTournamentGameOptions extends SharedLifecycleOptions {}

export function useCloseTournamentGameAction({
  multiplayerSocket,
  setIsPlaying,
  setIsPaused,
  setIsTerminated,
  setMultiplayerPlayerCount,
  setMultiplayerSpawnSlot,
  setQuickPlayStatus,
  closeGamePanels,
}: CloseTournamentGameOptions) {
  return useCallback(() => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsTerminated(false);
    setIsPlaying(false);
    setIsPaused(false);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    closeGamePanels();
    setQuickPlayStatus('idle');
  }, [
    closeGamePanels,
    multiplayerSocket,
    setIsPaused,
    setIsPlaying,
    setIsTerminated,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setQuickPlayStatus,
  ]);
}

interface UseAppLifecycleActionsOptions extends SharedLifecycleOptions {
  singlePlayerMode: SinglePlayerMode;
  setIsMultiplayer: Dispatch<SetStateAction<boolean>>;
  setMultiplayerRole: Dispatch<SetStateAction<GameplayMultiplayerRole>>;
  setMultiplayerSocket: Dispatch<SetStateAction<WebSocket | null>>;
  setConnectionStatus: Dispatch<SetStateAction<GameplayConnectionStatus>>;
  setOpponentClientId: Dispatch<SetStateAction<string>>;
  cancelHostOrJoin: () => void;
  applyMatchmakerUrl: () => boolean;
  resetMatchmakerUrl: () => boolean;
  closeMenuSocket: () => void;
}

export function useAppLifecycleActions({
  multiplayerSocket,
  singlePlayerMode,
  setIsPlaying,
  setIsPaused,
  setIsTerminated,
  setIsMultiplayer,
  setMultiplayerRole,
  setMultiplayerSocket,
  setConnectionStatus,
  setQuickPlayStatus,
  setMultiplayerPlayerCount,
  setMultiplayerSpawnSlot,
  setOpponentClientId,
  closeGamePanels,
  cancelHostOrJoin,
  applyMatchmakerUrl,
  resetMatchmakerUrl,
  closeMenuSocket,
}: UseAppLifecycleActionsOptions) {
  const handleCancelHostOrJoin = useCallback(() => {
    cancelHostOrJoin();
    setQuickPlayStatus('idle');
  }, [cancelHostOrJoin, setQuickPlayStatus]);

  const handleApplyMatchmakerUrl = useCallback(() => {
    if (applyMatchmakerUrl()) {
      closeMenuSocket();
    }
  }, [applyMatchmakerUrl, closeMenuSocket]);

  const handleResetMatchmakerUrl = useCallback(() => {
    if (resetMatchmakerUrl()) {
      closeMenuSocket();
    }
  }, [closeMenuSocket, resetMatchmakerUrl]);

  const handleStartGame = useCallback(() => {
    sfx.init();
    sfx.resume();
    sfx.playRespawn();

    const reset = createLocalGameMultiplayerReset();
    setIsMultiplayer(reset.isMultiplayer);
    setMultiplayerRole(reset.multiplayerRole);
    setMultiplayerPlayerCount(reset.multiplayerPlayerCount);
    setMultiplayerSpawnSlot(reset.multiplayerSpawnSlot);
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setMultiplayerSocket(reset.multiplayerSocket);

    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
    closeGamePanels();
  }, [
    closeGamePanels,
    multiplayerSocket,
    setIsMultiplayer,
    setIsPaused,
    setIsPlaying,
    setIsTerminated,
    setMultiplayerPlayerCount,
    setMultiplayerRole,
    setMultiplayerSocket,
    setMultiplayerSpawnSlot,
  ]);

  const handleCloseGame = useCallback(() => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setIsTerminated(shouldShowTerminatedOverlayAfterClose(singlePlayerMode));
    setIsPlaying(false);
    setIsPaused(false);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    closeGamePanels();
    setQuickPlayStatus('idle');
  }, [
    closeGamePanels,
    multiplayerSocket,
    setIsPaused,
    setIsPlaying,
    setIsTerminated,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setQuickPlayStatus,
    singlePlayerMode,
  ]);

  const handleResumeGame = useCallback(() => {
    sfx.resume();
    setIsPaused(false);
    closeGamePanels();
  }, [closeGamePanels, setIsPaused]);

  const handleResetMatch = useCallback(() => {
    sfx.playRespawn();
    window.location.reload();
  }, []);

  const handleReturnToMain = useCallback(() => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    const reset = createReturnToMainMultiplayerReset();
    setIsPlaying(false);
    setIsPaused(false);
    setIsMultiplayer(reset.isMultiplayer);
    setMultiplayerRole(reset.multiplayerRole);
    setMultiplayerSocket(reset.multiplayerSocket);
    setConnectionStatus(reset.connectionStatus);
    setQuickPlayStatus('idle');
    setMultiplayerPlayerCount(reset.multiplayerPlayerCount);
    setMultiplayerSpawnSlot(reset.multiplayerSpawnSlot);
    closeGamePanels();
    setOpponentClientId(reset.opponentClientId);
  }, [
    closeGamePanels,
    multiplayerSocket,
    setConnectionStatus,
    setIsMultiplayer,
    setIsPaused,
    setIsPlaying,
    setMultiplayerPlayerCount,
    setMultiplayerRole,
    setMultiplayerSocket,
    setMultiplayerSpawnSlot,
    setOpponentClientId,
    setQuickPlayStatus,
  ]);

  return {
    handleCancelHostOrJoin,
    handleApplyMatchmakerUrl,
    handleResetMatchmakerUrl,
    handleStartGame,
    handleCloseGame,
    handleResumeGame,
    handleResetMatch,
    handleReturnToMain,
  };
}
