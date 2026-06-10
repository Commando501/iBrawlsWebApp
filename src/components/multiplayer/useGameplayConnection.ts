import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { CustomMapData, UniversalSettings } from '../../types';
import type { MatchLobbyConfig } from '../../network/protocol';
import { normalizeMatchLobbyConfig } from '../../network/matchLobbyConfig';
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
  adminSettings: UniversalSettings;
  setAdminSettings: Dispatch<SetStateAction<UniversalSettings>>;
  matchLobbyConfig: MatchLobbyConfig | null;
  setMatchLobbyConfig: Dispatch<SetStateAction<MatchLobbyConfig | null>>;
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
  adminSettings,
  setAdminSettings,
  matchLobbyConfig,
  setMatchLobbyConfig,
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
  const multiplayerSocketRef = useRef(multiplayerSocket);
  const multiplayerRoleRef = useRef(multiplayerRole);

  useEffect(() => {
    multiplayerSocketRef.current = multiplayerSocket;
    multiplayerRoleRef.current = multiplayerRole;
  }, [multiplayerRole, multiplayerSocket]);

  const applyLobbyConfig = useCallback((incoming: Partial<MatchLobbyConfig> | null | undefined) => {
    const normalized = normalizeMatchLobbyConfig(incoming);
    setMatchLobbyConfig(normalized);
    setSelectedMap(normalized.selectedMap);
    setLobbyCustomMapData(normalized.customMap ?? null);
    setAdminSettings(prev => ({
      ...prev,
      gameMode: normalized.gameMode,
      grifballGoalTarget: normalized.gameMode === 'grifball' ? normalized.winTarget : prev.grifballGoalTarget,
      iBrawlsKillTarget: normalized.gameMode === 'sandbox' ? normalized.winTarget : prev.iBrawlsKillTarget,
      matchTimerSeconds: normalized.matchTimerSeconds,
    }));
    return normalized;
  }, [
    setAdminSettings,
    setLobbyCustomMapData,
    setMatchLobbyConfig,
    setSelectedMap,
  ]);

  const beginMatchFromLobbyConfig = useCallback((incoming: Partial<MatchLobbyConfig> | null | undefined) => {
    applyLobbyConfig(incoming);
    sfx.init();
    sfx.resume();
    sfx.playRespawn();
    setConnectionStatus('connected');
    setIsPlaying(true);
    setIsPaused(false);
    setIsTerminated(false);
  }, [
    applyLobbyConfig,
    setConnectionStatus,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
  ]);

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
          if (data.lobbyConfig) {
            applyLobbyConfig(data.lobbyConfig);
          }
          mergeLoadingParticipants(data.participants ?? data.otherPlayers);
          if (data.matchStarted && data.lobbyConfig) {
            beginMatchFromLobbyConfig(data.lobbyConfig);
          }
        } else if (data.type === 'match_start') {
          beginMatchFromLobbyConfig(data.lobbyConfig);
        } else if (data.type === 'sync' && data.action === 'match_end') {
          const winnerLabel = data.winner === 'draw'
            ? 'Match ended in a draw.'
            : `Match ended. Winner: ${data.winner || 'unknown'}.`;
          setChatMessages(prev => [
            ...prev,
            {
              id: `match-end-${Date.now()}`,
              sender: 'Match Director',
              text: winnerLabel,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              role: 'host',
              isLocal: false,
            },
          ]);
          setIsPaused(true);
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
              lobbyConfig: matchLobbyConfig,
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
          if (data.lobbyConfig) {
            applyLobbyConfig(data.lobbyConfig);
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
    matchLobbyConfig,
    applyLobbyConfig,
    beginMatchFromLobbyConfig,
    mergeLoadingParticipants,
    upsertLoadingParticipantSlot,
    upsertLoadingParticipantStatus,
    removeLoadingParticipantById,
    gameplayClientId,
    playerName,
    playerHue,
    playerLoadout,
    setChatMessages,
    setIsPaused,
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

  const handleHostGame = useCallback((
    overrideCode?: string,
    lobbyConfigOverride?: Partial<MatchLobbyConfig>,
    password?: string
  ) => {
    setConnectionError('');
    setConnectionStatus('hosting');
    setChatMessages([]);
    setMultiplayerPlayerCount(1);
    setMultiplayerSpawnSlot(0);
    setIsMultiplayer(true);
    setMultiplayerRole('host');

    const activeCode = overrideCode || hostIdCode;
    if (overrideCode) {
      setHostIdCode(overrideCode);
    }
    const outgoingLobbyConfig = normalizeMatchLobbyConfig({
      ...matchLobbyConfig,
      gameMode: adminSettings.gameMode ?? 'sandbox',
      matchTimerSeconds: adminSettings.matchTimerSeconds,
      winTarget: adminSettings.gameMode === 'grifball'
        ? adminSettings.grifballGoalTarget
        : adminSettings.iBrawlsKillTarget,
      ...lobbyConfigOverride,
      selectedMap: lobbyConfigOverride?.selectedMap ?? selectedMap,
      customMap: lobbyConfigOverride?.customMap ?? lobbyCustomMapData,
    });
    setMatchLobbyConfig(outgoingLobbyConfig);

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
        lobbyConfig: outgoingLobbyConfig,
        password,
      }));
    };

    const handleHostMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'hosted') {
          console.log('Successfully hosted lobby inside room of keys:', data.keys);
          setMultiplayerSocket(ws);
          setIsMultiplayer(true);
          setMultiplayerRole('host');
          setConnectionStatus('hosting');
          if (typeof data.clientId === 'string') {
            setGameplayClientId(data.clientId);
          }
          applyLobbyConfig(data.lobbyConfig ?? outgoingLobbyConfig);
          mergeLoadingParticipants([{
            clientId: typeof data.clientId === 'string' ? data.clientId : 'host',
            role: 'host',
            spawnSlot: 0,
            playerName: data.playerName || playerName,
            hue: playerHue,
            loadout: playerLoadout,
          }]);
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
          if (data.lobbyConfig) {
            applyLobbyConfig(data.lobbyConfig);
          }
          if (data.matchStarted && data.lobbyConfig) {
            beginMatchFromLobbyConfig(data.lobbyConfig);
          }
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
      setMatchLobbyConfig(null);
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
    setIsMultiplayer,
    setMultiplayerRole,
    hostIdCode,
    setHostIdCode,
    matchLobbyConfig,
    adminSettings,
    selectedMap,
    lobbyCustomMapData,
    setMatchLobbyConfig,
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
    applyLobbyConfig,
    beginMatchFromLobbyConfig,
    mergeLoadingParticipants,
    setOpponentClientId,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
  ]);

  const handleJoinGame = useCallback((
    target: string,
    isObserver: boolean = false,
    password?: string,
    inviteToken?: string,
    connectionModeOverride?: GameplayConnectionMode
  ) => {
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

    const activeConnectionMode = connectionModeOverride ?? connectionMode;
    const protocol = (window.location.protocol === 'https:' || activeConnectionMode === 'relay') ? 'wss:' : 'ws:';
    let baseWsUrl = '';

    if (activeConnectionMode === 'relay') {
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

    const gameplayWsUrl = buildGameplayWsUrl(baseWsUrl, activeConnectionMode === 'relay');
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
        password,
        inviteToken,
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
          if (data.lobbyConfig) {
            applyLobbyConfig(data.lobbyConfig);
          }
          if (data.matchStarted && data.lobbyConfig) {
            beginMatchFromLobbyConfig(data.lobbyConfig);
          }

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
      setMatchLobbyConfig(null);
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
    applyLobbyConfig,
    beginMatchFromLobbyConfig,
    mergeLoadingParticipants,
    setMultiplayerSpawnSlot,
    setOpponentClientId,
    setIsPlaying,
    setIsPaused,
    setIsTerminated,
    setMatchLobbyConfig,
  ]);

  const startHostedMatch = useCallback(() => {
    const activeSocket = multiplayerSocketRef.current;
    const activeRole = multiplayerRoleRef.current;
    if (!activeSocket || activeSocket.readyState !== WebSocket.OPEN || activeRole !== 'host') {
      setConnectionError('Only the active host can start this lobby.');
      return;
    }
    console.log('Host requested staged match start.');
    activeSocket.send(JSON.stringify({ type: 'start_match' }));
  }, [
    setConnectionError,
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
    setIsMultiplayer(false);
    setMultiplayerRole(null);
    setMatchLobbyConfig(null);
  }, [
    multiplayerSocket,
    setConnectionStatus,
    setConnectionError,
    setMultiplayerSocket,
    setMultiplayerPlayerCount,
    setMultiplayerSpawnSlot,
    setIsMultiplayer,
    setMultiplayerRole,
    setMatchLobbyConfig,
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
    startHostedMatch,
    cancelHostOrJoin,
    handleJoinObserver,
    handleJoinPlayer,
  };
}
