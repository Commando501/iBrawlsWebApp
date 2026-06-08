import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { CustomMapData } from '../../types';
import {
  MAX_MULTIPLAYER_PLAYERS,
  getConnectedMatchPlayerCount,
  getMultiplayerSpawnSlotFromMessage,
} from '../../network/onlineClients';
import { sfx } from '../AudioEngine';
import type { ChatMessage } from '../ChatOverlay';
import type { CharacterLoadout } from '../VoxelModels';
import type {
  MultiplayerLoadingSlotPayload,
  MultiplayerLoadingStatusPayload,
} from '../loading/loadingTypes';
import {
  SIGNED_IN_ELSEWHERE_CLOSE_CODE,
  SIGNED_IN_ELSEWHERE_MESSAGE,
  type GameplayConnectionMode,
  type GameplayConnectionStatus,
  type GameplayMultiplayerRole,
} from './multiplayerConnectionConstants';

interface UseGameplayConnectionOptions {
  connectionMode: GameplayConnectionMode;
  userIp: string;
  lanIp: string;
  hostIdCode: string;
  setHostIdCode: Dispatch<SetStateAction<string>>;
  setJoinIpOrId: Dispatch<SetStateAction<string>>;
  playerName: string;
  playerHue: number;
  playerLoadout: CharacterLoadout;
  selectedMap: string;
  setSelectedMap: Dispatch<SetStateAction<string>>;
  lobbyCustomMapData: CustomMapData | null;
  setLobbyCustomMapData: Dispatch<SetStateAction<CustomMapData | null>>;
  isMultiplayer: boolean;
  multiplayerSocket: WebSocket | null;
  multiplayerRole: GameplayMultiplayerRole;
  gameplayClientId: string;
  getWsUrl: () => string;
  buildGameplayWsUrl: (baseUrl: string, includeAccountToken?: boolean) => string;
  redactWsUrl: (url: string) => string;
  setConnectionStatus: Dispatch<SetStateAction<GameplayConnectionStatus>>;
  setConnectionError: Dispatch<SetStateAction<string>>;
  setChatMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setMultiplayerSocket: Dispatch<SetStateAction<WebSocket | null>>;
  setIsMultiplayer: Dispatch<SetStateAction<boolean>>;
  setMultiplayerRole: Dispatch<SetStateAction<GameplayMultiplayerRole>>;
  setGameplayClientId: Dispatch<SetStateAction<string>>;
  setOpponentClientId: Dispatch<SetStateAction<string>>;
  setMultiplayerPlayerCount: Dispatch<SetStateAction<number>>;
  setMultiplayerSpawnSlot: Dispatch<SetStateAction<number>>;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
  setIsTerminated: Dispatch<SetStateAction<boolean>>;
  mergeLoadingParticipants: (slots: MultiplayerLoadingSlotPayload[] | undefined) => void;
  upsertLoadingParticipantSlot: (slot: MultiplayerLoadingSlotPayload) => void;
  upsertLoadingParticipantStatus: (
    status: MultiplayerLoadingStatusPayload,
    fallbackClientId?: string
  ) => void;
  removeLoadingParticipantById: (clientId: string | undefined) => void;
}

export function useGameplayConnection({
  connectionMode,
  userIp,
  lanIp,
  hostIdCode,
  setHostIdCode,
  setJoinIpOrId,
  playerName,
  playerHue,
  playerLoadout,
  selectedMap,
  setSelectedMap,
  lobbyCustomMapData,
  setLobbyCustomMapData,
  isMultiplayer,
  multiplayerSocket,
  multiplayerRole,
  gameplayClientId,
  getWsUrl,
  buildGameplayWsUrl,
  redactWsUrl,
  setConnectionStatus,
  setConnectionError,
  setChatMessages,
  setMultiplayerSocket,
  setIsMultiplayer,
  setMultiplayerRole,
  setGameplayClientId,
  setOpponentClientId,
  setMultiplayerPlayerCount,
  setMultiplayerSpawnSlot,
  setIsPlaying,
  setIsPaused,
  setIsTerminated,
  mergeLoadingParticipants,
  upsertLoadingParticipantSlot,
  upsertLoadingParticipantStatus,
  removeLoadingParticipantById,
}: UseGameplayConnectionOptions) {
  useEffect(() => {
    if (!multiplayerSocket) return;

    const handleMultiplayerMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'sync' && data.action === 'chat') {
          setChatMessages(prev => {
            if (prev.some(m => m.id === data.id)) return prev;
            return [...prev, {
              id: data.id,
              sender: data.sender || 'Opponent',
              text: data.text || '',
              timestamp: data.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              role: data.role || 'client',
              isLocal: false,
            }];
          });
        } else if (data.type === 'connected') {
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount(data, data.role || multiplayerRole));
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role || multiplayerRole));
          if (typeof data.clientId === 'string') {
            setGameplayClientId(data.clientId);
          }
          mergeLoadingParticipants(data.participants ?? data.otherPlayers);
        } else if (data.type === 'player_joined') {
          upsertLoadingParticipantSlot({
            clientId: data.clientId,
            role: data.role || 'client',
            spawnSlot: data.spawnSlot,
            playerName: data.playerName,
            hue: data.hue,
            loadout: data.loadout,
          });
          setMultiplayerPlayerCount(count => Math.min(MAX_MULTIPLAYER_PLAYERS, Math.max(2, count + 1)));
        } else if (data.type === 'observer_joined') {
          upsertLoadingParticipantSlot({
            clientId: data.observerId,
            role: 'observer',
            playerName: data.playerName,
            hue: data.hue,
            loadout: data.loadout,
          });
        } else if (data.type === 'player_left') {
          removeLoadingParticipantById(data.leftPlayerId);
          setMultiplayerPlayerCount(count => Math.max(1, count - 1));
        } else if (data.type === 'sync' && data.action === 'match_loading_status') {
          upsertLoadingParticipantStatus({
            clientId: data.senderId,
            role: data.senderRole,
            spawnSlot: data.spawnSlot,
            playerName: data.playerName,
            hue: data.hue,
            loadout: data.loadout,
            progress: data.progress,
            stage: data.stage,
            ready: data.ready,
          }, data.senderId);
        } else if (data.type === 'sync' && data.action === 'request_map') {
          if (multiplayerRole === 'host') {
            console.log('Received request for map sync. Sending selectedMap:', selectedMap);
            multiplayerSocket.send(JSON.stringify({
              type: 'sync',
              action: 'sync_map',
              selectedMap,
              customMap: lobbyCustomMapData,
            }));
          }
        } else if (data.type === 'sync' && data.action === 'sync_map') {
          console.log('Received map sync packet from host:', data.selectedMap);
          if (data.selectedMap) {
            setSelectedMap(data.selectedMap);
          }
          if (data.customMap) {
            setLobbyCustomMapData(data.customMap);
          }
        } else if (data.type === 'role_changed') {
          console.log('Role authoritatively updated to:', data.role);
          if (gameplayClientId) {
            upsertLoadingParticipantSlot({
              clientId: gameplayClientId,
              role: data.role || 'client',
              spawnSlot: data.spawnSlot,
              playerName,
              hue: playerHue,
              loadout: playerLoadout,
            });
          }
          setMultiplayerPlayerCount(count => {
            if (data.role === 'observer' && multiplayerRole !== 'observer') {
              return Math.max(0, count - 1);
            }
            if (data.role === 'client' && multiplayerRole === 'observer') {
              return Math.min(MAX_MULTIPLAYER_PLAYERS, count + 1);
            }
            return count;
          });
          setMultiplayerRole(data.role);
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role));
          if (data.role === 'observer') {
            setIsPaused(false);
          }
        } else if (data.type === 'opponent_role_changed') {
          console.log('Opponent role updated to:', data.role);
          upsertLoadingParticipantSlot({
            clientId: data.clientId,
            role: data.role || 'observer',
          });
          if (data.role === 'observer') {
            setMultiplayerPlayerCount(count => Math.max(1, count - 1));
            setOpponentClientId('Opponent (Spectating)');
          } else {
            setMultiplayerPlayerCount(count => Math.min(MAX_MULTIPLAYER_PLAYERS, count + 1));
            setOpponentClientId('Opponent');
          }
        } else if (data.type === 'error') {
          alert(data.message);
        }
      } catch {
        // Ignore malformed gameplay socket packets.
      }
    };

    multiplayerSocket.addEventListener('message', handleMultiplayerMessage);
    return () => {
      multiplayerSocket.removeEventListener('message', handleMultiplayerMessage);
    };
  }, [
    multiplayerSocket,
    multiplayerRole,
    selectedMap,
    lobbyCustomMapData,
    mergeLoadingParticipants,
    upsertLoadingParticipantSlot,
    upsertLoadingParticipantStatus,
    removeLoadingParticipantById,
    gameplayClientId,
    playerName,
    playerHue,
    playerLoadout,
    setChatMessages,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setGameplayClientId,
    setSelectedMap,
    setLobbyCustomMapData,
    setMultiplayerRole,
    setIsPaused,
    setOpponentClientId,
  ]);

  const sendChatMessage = useCallback((text: string) => {
    if (!multiplayerSocket || multiplayerSocket.readyState !== WebSocket.OPEN) return;

    const baseSender = multiplayerRole === 'host' ? 'Blue (Host)' : 'Red (Guest)';
    const senderName = playerName ? `${playerName} (${multiplayerRole === 'host' ? 'Host' : 'Guest'})` : baseSender;
    const msgId = Math.random().toString(36).substring(2, 9);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const packet = {
      type: 'sync',
      action: 'chat',
      id: msgId,
      sender: senderName,
      text,
      timestamp,
      role: multiplayerRole,
    };

    multiplayerSocket.send(JSON.stringify(packet));

    setChatMessages(prev => [
      ...prev,
      {
        id: msgId,
        sender: `${senderName} (You)`,
        text,
        timestamp,
        role: multiplayerRole!,
        isLocal: true,
      },
    ]);
  }, [multiplayerSocket, multiplayerRole, playerName, setChatMessages]);

  const handleHostGame = useCallback((overrideCode?: string) => {
    setConnectionError('');
    setConnectionStatus('hosting');
    setChatMessages([]);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);

    const activeCode = overrideCode || hostIdCode;
    if (overrideCode) {
      setHostIdCode(overrideCode);
    }

    const baseWsUrl = connectionMode === 'relay'
      ? getWsUrl()
      : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;
    const gameplayWsUrl = buildGameplayWsUrl(baseWsUrl, connectionMode === 'relay');
    console.log('WS Host connection target URL resolved to:', redactWsUrl(gameplayWsUrl));
    const ws = new WebSocket(gameplayWsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Registering host...');
      ws.send(JSON.stringify({
        type: 'host',
        ip: userIp,
        lanIp,
        customId: activeCode,
        playerName,
        hue: playerHue,
        loadout: playerLoadout,
      }));
    };

    const handleHostMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hosted') {
          console.log('Successfully hosted lobby inside room of keys:', data.keys);
        } else if (data.type === 'connected') {
          ws.removeEventListener('message', handleHostMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole('host');
          if (typeof data.clientId === 'string') {
            setGameplayClientId(data.clientId);
          }
          mergeLoadingParticipants(data.participants ?? data.otherPlayers);
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, 'host'));
          setConnectionStatus('connected');
          setOpponentClientId(data.clientClientId || 'Opponent');
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount({ ...data, role: 'host' }, 'host'));

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (err) {
        console.error('Error parsing onmessage host data:', err);
      }
    };

    ws.addEventListener('message', handleHostMessage);

    ws.onclose = (event) => {
      console.log('Host socket disconnected.');
      if (event.code === SIGNED_IN_ELSEWHERE_CLOSE_CODE) {
        setConnectionError(event.reason || SIGNED_IN_ELSEWHERE_MESSAGE);
        setConnectionStatus('error');
      } else {
        setConnectionStatus('idle');
      }
      setMultiplayerSocket(null);
      setMultiplayerSpawnSlot(0);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Host Error:', err);
      setConnectionError('Matchmaker registration failed.');
      setConnectionStatus('error');
    };
  }, [
    setConnectionError,
    setConnectionStatus,
    setChatMessages,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    hostIdCode,
    setHostIdCode,
    connectionMode,
    getWsUrl,
    buildGameplayWsUrl,
    redactWsUrl,
    userIp,
    lanIp,
    playerName,
    playerHue,
    playerLoadout,
    setMultiplayerSocket,
    setIsMultiplayer,
    setMultiplayerRole,
    setGameplayClientId,
    mergeLoadingParticipants,
    setOpponentClientId,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
  ]);

  const handleJoinGame = useCallback((target: string, isObserver: boolean = false) => {
    if (!target) {
      setConnectionError('Please provide a Host IP address or Room Code.');
      return;
    }
    setJoinIpOrId(target);
    setConnectionError('');
    setConnectionStatus('connecting');
    setChatMessages([]);
    setMultiplayerPlayerCount(isObserver ? 0 : 1);

    const cleanTarget = target.trim().replace(/^(hw|http|https|ws|wss):\/\//i, '');
    const isDirectAddress = cleanTarget.includes('.') || cleanTarget.includes(':') || isNaN(Number(cleanTarget));

    const protocol = (window.location.protocol === 'https:' || connectionMode === 'relay') ? 'wss:' : 'ws:';
    let baseWsUrl = '';

    if (connectionMode === 'relay') {
      baseWsUrl = getWsUrl();
    } else if (isDirectAddress) {
      let hostWithPort = cleanTarget;
      if (!hostWithPort.includes(':')) {
        hostWithPort = `${hostWithPort}:3000`;
      }
      const directProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      baseWsUrl = `${directProtocol}//${hostWithPort}`;
    } else {
      baseWsUrl = `${protocol}//${window.location.host}`;
    }

    const gameplayWsUrl = buildGameplayWsUrl(baseWsUrl, connectionMode === 'relay');
    console.log('WS Join connection target URL resolved to:', redactWsUrl(gameplayWsUrl), 'isObserver:', isObserver);
    const ws = new WebSocket(gameplayWsUrl);

    ws.onopen = () => {
      console.log('WS Connection opened. Joining:', target, 'isObserver:', isObserver);
      ws.send(JSON.stringify({
        type: 'join',
        targetIpOrId: target.trim(),
        isObserver,
        playerName,
        hue: playerHue,
        loadout: playerLoadout,
      }));
    };

    const handleJoinMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') {
          ws.removeEventListener('message', handleJoinMessage);

          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole(data.role || 'client');
          if (typeof data.clientId === 'string') {
            setGameplayClientId(data.clientId);
          }
          mergeLoadingParticipants(data.participants ?? data.otherPlayers);
          setMultiplayerSpawnSlot(getMultiplayerSpawnSlotFromMessage(data, data.role || 'client'));
          setConnectionStatus('connected');
          setOpponentClientId(data.hostClientId || 'Opponent');
          setMultiplayerPlayerCount(getConnectedMatchPlayerCount(data, data.role || 'client'));

          sfx.init();
          sfx.resume();
          sfx.playRespawn();

          setIsPlaying(true);
          setIsPaused(false);
          setIsTerminated(false);

          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              console.log('Sending request_map to host...');
              ws.send(JSON.stringify({
                type: 'sync',
                action: 'request_map',
              }));
            }
          }, 100);
        } else if (data.type === 'error') {
          setConnectionError(data.message);
          setConnectionStatus('error');
          ws.close();
        }
      } catch (e) {
        console.error(e);
      }
    };

    ws.addEventListener('message', handleJoinMessage);

    ws.onclose = (event) => {
      console.log('Guest join socket disconnected.');
      if (event.code === SIGNED_IN_ELSEWHERE_CLOSE_CODE) {
        setConnectionError(event.reason || SIGNED_IN_ELSEWHERE_MESSAGE);
        setConnectionStatus('error');
      } else {
        setConnectionStatus('idle');
      }
      setMultiplayerSocket(null);
      setMultiplayerSpawnSlot(0);
    };

    ws.onerror = (err) => {
      console.error('WebSocket Join Error:', err);
      setConnectionError('Matching connection failed.');
      setConnectionStatus('error');
    };
  }, [
    setConnectionError,
    setJoinIpOrId,
    setConnectionStatus,
    setChatMessages,
    setMultiplayerPlayerCount,
    connectionMode,
    getWsUrl,
    buildGameplayWsUrl,
    redactWsUrl,
    playerName,
    playerHue,
    playerLoadout,
    setMultiplayerSocket,
    setIsMultiplayer,
    setMultiplayerRole,
    setGameplayClientId,
    mergeLoadingParticipants,
    setMultiplayerSpawnSlot,
    setOpponentClientId,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
  ]);

  const cancelHostOrJoin = useCallback(() => {
    if (multiplayerSocket) {
      multiplayerSocket.close();
    }
    setConnectionStatus('idle');
    setConnectionError('');
    setMultiplayerSocket(null);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
  }, [
    multiplayerSocket,
    setConnectionStatus,
    setConnectionError,
    setMultiplayerSocket,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
  ]);

  const handleJoinObserver = useCallback(() => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'observer',
      }));
    } else {
      setMultiplayerRole('observer');
      setMultiplayerPlayerCount(0);
      setMultiplayerSpawnSlot(0);
      setIsPaused(false);
    }
  }, [
    isMultiplayer,
    multiplayerSocket,
    setMultiplayerRole,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setIsPaused,
  ]);

  const handleJoinPlayer = useCallback(() => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({
        type: 'change_role',
        role: 'player',
      }));
    } else {
      setMultiplayerRole(null);
      setMultiplayerPlayerCount(1);
      setMultiplayerSpawnSlot(0);
      setIsPaused(false);
    }
  }, [
    isMultiplayer,
    multiplayerSocket,
    setMultiplayerRole,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setIsPaused,
  ]);

  return {
    sendChatMessage,
    handleHostGame,
    handleJoinGame,
    cancelHostOrJoin,
    handleJoinObserver,
    handleJoinPlayer,
  };
}
