import { useRef, useState } from 'react';
import type {
  GameplayConnectionMode,
  GameplayConnectionStatus,
  GameplayMultiplayerRole,
} from './multiplayerConnectionConstants';

export interface MultiplayerSessionSnapshot {
  connectionMode: GameplayConnectionMode;
  isMultiplayer: boolean;
  multiplayerRole: GameplayMultiplayerRole;
  multiplayerSocket: WebSocket | null;
  connectionStatus: GameplayConnectionStatus;
  connectionError: string;
  opponentClientId: string;
  multiplayerPlayerCount: number;
  multiplayerSpawnSlot: number;
  gameplayClientId: string;
}

export function createInitialMultiplayerSessionSnapshot(): MultiplayerSessionSnapshot {
  return {
    connectionMode: 'relay',
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerSocket: null,
    connectionStatus: 'idle',
    connectionError: '',
    opponentClientId: '',
    multiplayerPlayerCount: 1,
    multiplayerSpawnSlot: 0,
    gameplayClientId: '',
  };
}

export function useMultiplayerSessionState() {
  const initial = createInitialMultiplayerSessionSnapshot();
  const [connectionMode, setConnectionMode] = useState<GameplayConnectionMode>(initial.connectionMode);
  const [isMultiplayer, setIsMultiplayer] = useState<boolean>(initial.isMultiplayer);
  const [multiplayerRole, setMultiplayerRole] = useState<GameplayMultiplayerRole>(initial.multiplayerRole);
  const [multiplayerSocket, setMultiplayerSocket] = useState<WebSocket | null>(initial.multiplayerSocket);
  const [connectionStatus, setConnectionStatus] = useState<GameplayConnectionStatus>(initial.connectionStatus);
  const [connectionError, setConnectionError] = useState<string>(initial.connectionError);
  const [opponentClientId, setOpponentClientId] = useState<string>(initial.opponentClientId);
  const [multiplayerPlayerCount, setMultiplayerPlayerCount] = useState<number>(initial.multiplayerPlayerCount);
  const [multiplayerSpawnSlot, setMultiplayerSpawnSlot] = useState<number>(initial.multiplayerSpawnSlot);
  const [gameplayClientId, setGameplayClientId] = useState<string>(initial.gameplayClientId);
  const handleHostGameRef = useRef<(overrideCode?: string) => void>(() => {});
  const handleJoinGameRef = useRef<(target: string) => void>(() => {});

  return {
    connectionMode,
    setConnectionMode,
    isMultiplayer,
    setIsMultiplayer,
    multiplayerRole,
    setMultiplayerRole,
    multiplayerSocket,
    setMultiplayerSocket,
    connectionStatus,
    setConnectionStatus,
    connectionError,
    setConnectionError,
    opponentClientId,
    setOpponentClientId,
    multiplayerPlayerCount,
    setMultiplayerPlayerCount,
    multiplayerSpawnSlot,
    setMultiplayerSpawnSlot,
    gameplayClientId,
    setGameplayClientId,
    handleHostGameRef,
    handleJoinGameRef,
  };
}
