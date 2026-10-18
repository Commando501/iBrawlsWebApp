import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { sfx } from '../AudioEngine';
import type { ChatMessage } from '../ChatOverlay';
import {
  MAX_MULTIPLAYER_PLAYERS,
  normalizePlayerName,
  type OnlineClient,
} from '../../network/onlineClients';
import type {
  ClientPresenceState,
  LobbyClientMessage,
  LobbyServerMessage,
  MatchLobbyConfig,
} from '../../network/protocol';
import { createMatchLobbySummary } from '../../network/matchLobbyConfig';
import {
  SIGNED_IN_ELSEWHERE_CLOSE_CODE,
  SIGNED_IN_ELSEWHERE_MESSAGE,
} from './multiplayerConnectionConstants';
import { normalizePublicRoomCode } from '../../network/roomCodePrivacy';

export type LobbyConnectionStatus = 'idle' | 'fetching_ip' | 'hosting' | 'connecting' | 'connected' | 'error';
export type LobbyQuickPlayStatus = 'idle' | 'searching' | 'matching';
type MultiplayerRole = 'host' | 'client' | 'observer' | null;

interface LobbyConfigChangedMessage {
  type: 'config_changed';
  version?: number;
}

type LobbyMessage = LobbyServerMessage | LobbyConfigChangedMessage;

interface UseLobbyConnectionOptions {
  isOnline: boolean;
  playerName: string;
  accountId?: string;
  multiplayerSocket: WebSocket | null;
  connectionStatus: LobbyConnectionStatus;
  hostIdCode: string;
  joinIpOrId: string;
  isPlaying: boolean;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  multiplayerPlayerCount: number;
  matchLobbyConfig: MatchLobbyConfig | null;
  buildLobbyWsUrl: (playerName: string) => string;
  redactWsUrl: (url: string) => string;
  refreshMultiplayerPreset: (serverVersion?: number) => void;
  setConnectionError: Dispatch<SetStateAction<string>>;
  handleQuickplayHostRef: MutableRefObject<(overrideCode?: string, lobbyConfig?: Partial<MatchLobbyConfig>, password?: string, connectionModeOverride?: 'relay' | 'local') => void>;
  handleQuickplayJoinRef: MutableRefObject<(target: string, isObserver?: boolean, password?: string, inviteToken?: string, connectionModeOverride?: 'relay' | 'local') => void>;
}

const isOpenSocket = (socket: WebSocket | null): socket is WebSocket => {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
};

/** A local mode change must leave the server queue as well as hide its UI. */
export function cancelQueuedQuickPlayIfIdle(
  status: LobbyQuickPlayStatus,
  socket: Pick<WebSocket, 'readyState' | 'send'> | null,
  requested: MutableRefObject<boolean>,
) {
  if (status !== 'idle' || !requested.current) return;
  requested.current = false;
  if (socket?.readyState === 1) {
    const packet: LobbyClientMessage = { type: 'quickplay_leave' };
    socket.send(JSON.stringify(packet));
  }
}

export function useLobbyConnection({
  isOnline,
  playerName,
  accountId,
  multiplayerSocket,
  connectionStatus,
  hostIdCode,
  joinIpOrId,
  isPlaying,
  isMultiplayer,
  multiplayerRole,
  multiplayerPlayerCount,
  matchLobbyConfig,
  buildLobbyWsUrl,
  redactWsUrl,
  refreshMultiplayerPreset,
  setConnectionError,
  handleQuickplayHostRef,
  handleQuickplayJoinRef,
}: UseLobbyConnectionOptions) {
  const [menuSocket, setMenuSocket] = useState<WebSocket | null>(null);
  const [clientId, setClientId] = useState<string>('');
  const clientIdRef = useRef<string>('');
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [onlineClients, setOnlineClients] = useState<OnlineClient[]>([]);
  const [activeInvite, setActiveInvite] = useState<{ fromId: string; roomCode: string; inviteToken?: string } | null>(null);
  const [inviteNotifications, setInviteNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number | undefined>(undefined);
  const [quickPlayStatus, setQuickPlayStatus] = useState<LobbyQuickPlayStatus>('idle');
  const quickPlayRequestedRef = useRef(false);
  const [lobbyChatMessages, setLobbyChatMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    cancelQueuedQuickPlayIfIdle(quickPlayStatus, menuSocket, quickPlayRequestedRef);
  }, [quickPlayStatus, menuSocket]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDestroyed = false;

    const clearConnectionState = () => {
      setMenuSocket(null);
      setClientId('');
      clientIdRef.current = '';
      setOnlineCount(0);
      setOnlineClients([]);
      setPing(undefined);
      // The queue belongs to the disconnected lobby client; reconnecting does
      // not restore it. Leaving "Searching" visible would strand Quick Play.
      setQuickPlayStatus('idle');
      quickPlayRequestedRef.current = false;
      setActiveInvite(null);
    };

    const connect = () => {
      if (isDestroyed) return;

      if (!navigator.onLine) {
        clearConnectionState();
        reconnectTimeout = setTimeout(connect, 5000);
        return;
      }

      const wsUrl = buildLobbyWsUrl(playerName);
      console.log('Connecting persistent lobby socket to:', redactWsUrl(wsUrl));
      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        console.log('Lobby network established.');
        if (isDestroyed || ws !== socket) {
          socket.close();
          return;
        }
        setMenuSocket(socket);
      };

      socket.onmessage = (event) => {
        if (isDestroyed || ws !== socket) return;
        try {
          const data = JSON.parse(event.data) as LobbyMessage;

          if (data.type === 'welcome') {
            setClientId(data.clientId);
            clientIdRef.current = data.clientId;
          } else if (data.type === 'presence') {
            setOnlineCount(data.onlineCount || 0);
            const others = (data.clients || []).filter((client): client is OnlineClient => {
              return typeof client?.id === 'string' && client.id !== clientIdRef.current;
            });
            setOnlineClients(others);
          } else if (data.type === 'pong') {
            const calculatedPing = Date.now() - data.timestamp;
            setPing(calculatedPing);
          } else if (data.type === 'receive_invite') {
            setActiveInvite({
              fromId: data.fromId,
              roomCode: data.roomCode,
              inviteToken: data.inviteToken,
            });
            sfx.playRespawn();
          } else if (data.type === 'invite_declined') {
            const declString = `Client ${data.fromId} declined your match invite.`;
            setInviteNotifications(prev => [...prev, declString]);
            setTimeout(() => {
              setInviteNotifications(prev => prev.filter(n => n !== declString));
            }, 5000);
          } else if (data.type === 'lobby_chat') {
            setLobbyChatMessages(prev => {
              if (prev.some(m => m.id === data.id)) return prev;
              return [...prev, {
                id: data.id,
                sender: data.sender,
                text: data.text,
                timestamp: data.timestamp,
                role: 'client',
                isLocal: data.clientId === clientIdRef.current,
              }];
            });
          } else if (data.type === 'quickplay_queued') {
            if (!quickPlayRequestedRef.current) return;
            setQuickPlayStatus('searching');
          } else if (data.type === 'quickplay_host') {
            if (!quickPlayRequestedRef.current) return;
            quickPlayRequestedRef.current = false;
            setQuickPlayStatus('matching');
            handleQuickplayHostRef.current(data.roomCode, { access: 'open' }, undefined, 'relay');
          } else if (data.type === 'quickplay_match_found') {
            if (!quickPlayRequestedRef.current) return;
            quickPlayRequestedRef.current = false;
            setQuickPlayStatus('idle');
            handleQuickplayJoinRef.current(data.roomCode, false, undefined, undefined, 'relay');
          } else if (data.type === 'signed_in_elsewhere') {
            setConnectionError(data.message || SIGNED_IN_ELSEWHERE_MESSAGE);
          } else if (data.type === 'config_changed') {
            refreshMultiplayerPreset(data.version);
          }
        } catch (e) {
          console.error('Lobby network parsing error:', e);
        }
      };

      socket.onclose = (event) => {
        if (isDestroyed || ws !== socket) return;
        clearConnectionState();
        if (event.code === SIGNED_IN_ELSEWHERE_CLOSE_CODE) {
          setConnectionError(event.reason || SIGNED_IN_ELSEWHERE_MESSAGE);
          setOnlineCount(0);
          setOnlineClients([]);
          return;
        }
        if (!isDestroyed) {
          reconnectTimeout = setTimeout(connect, 2000);
        }
      };

      socket.onerror = () => {
        if (isDestroyed || ws !== socket) return;
        socket.close();
      };
    };

    clearConnectionState();
    connect();

    return () => {
      isDestroyed = true;
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [
    isOnline,
    playerName,
    accountId,
    buildLobbyWsUrl,
    redactWsUrl,
    refreshMultiplayerPreset,
    setConnectionError,
    handleQuickplayHostRef,
    handleQuickplayJoinRef,
  ]);

  useEffect(() => {
    const pingInterval = setInterval(() => {
      const activeSock = isOpenSocket(multiplayerSocket)
        ? multiplayerSocket
        : isOpenSocket(menuSocket) ? menuSocket : null;

      if (activeSock) {
        try {
          const packet: LobbyClientMessage = {
            type: 'ping',
            timestamp: Date.now(),
          };
          activeSock.send(JSON.stringify(packet));
        } catch (e) {
          console.error('Error sending ping:', e);
        }
      }
    }, 2000);

    return () => clearInterval(pingInterval);
  }, [multiplayerSocket, menuSocket]);

  useEffect(() => {
    if (!isOpenSocket(menuSocket)) return;

    let status: ClientPresenceState = 'menu';
    let roomCode: string | undefined = undefined;
    let spaceAvailable = false;
    const maxPlayers = matchLobbyConfig?.maxPlayers ?? MAX_MULTIPLAYER_PLAYERS;

    if (isPlaying) {
      if (isMultiplayer) {
        status = 'multi';
        roomCode = normalizePublicRoomCode(multiplayerRole === 'host' ? hostIdCode : joinIpOrId);
        spaceAvailable = multiplayerRole !== 'observer'
          && Boolean(roomCode)
          && multiplayerPlayerCount < maxPlayers
          && matchLobbyConfig?.access !== 'private';
      } else {
        status = 'solo';
      }
    } else if (isMultiplayer && matchLobbyConfig && (connectionStatus === 'hosting' || connectionStatus === 'connected')) {
      status = 'multi';
      roomCode = normalizePublicRoomCode(multiplayerRole === 'host' ? hostIdCode : joinIpOrId);
      spaceAvailable = multiplayerRole === 'host'
        && Boolean(roomCode)
        && multiplayerPlayerCount < maxPlayers
        && matchLobbyConfig.access !== 'private';
    } else if (connectionStatus === 'connecting') {
      status = 'multi';
      roomCode = normalizePublicRoomCode(joinIpOrId);
      spaceAvailable = false;
    }

    const packet: LobbyClientMessage = {
      type: 'update_status',
      status,
      roomCode,
      spaceAvailable,
      playerCount: status === 'multi' ? multiplayerPlayerCount : undefined,
      maxPlayers: status === 'multi' ? maxPlayers : undefined,
      lobby: status === 'multi' && matchLobbyConfig
        ? createMatchLobbySummary(matchLobbyConfig, { inProgress: isPlaying })
        : undefined,
      name: normalizePlayerName(playerName),
    };

    menuSocket.send(JSON.stringify(packet));
  }, [
    menuSocket,
    isPlaying,
    isMultiplayer,
    connectionStatus,
    hostIdCode,
    joinIpOrId,
    multiplayerRole,
    multiplayerPlayerCount,
    matchLobbyConfig,
    playerName,
  ]);

  const sendLobbyChatMessage = useCallback((text: string) => {
    if (!isOpenSocket(menuSocket)) return;

    const packet: LobbyClientMessage = {
      type: 'lobby_chat',
      sender: playerName || `Client ${clientId}`,
      text,
    };

    menuSocket.send(JSON.stringify(packet));
  }, [menuSocket, playerName, clientId]);

  const handleQuickPlay = useCallback(() => {
    if (!isOpenSocket(menuSocket)) {
      setConnectionError('Matchmaker connection offline. Retrying...');
      return;
    }
    setConnectionError('');
    quickPlayRequestedRef.current = true;
    setQuickPlayStatus('searching');
    const packet: LobbyClientMessage = { type: 'quickplay_join' };
    menuSocket.send(JSON.stringify(packet));
  }, [menuSocket, setConnectionError]);

  const handleCancelQuickPlay = useCallback(() => {
    quickPlayRequestedRef.current = false;
    if (isOpenSocket(menuSocket)) {
      const packet: LobbyClientMessage = { type: 'quickplay_leave' };
      menuSocket.send(JSON.stringify(packet));
    }
    setQuickPlayStatus('idle');
  }, [menuSocket]);

  const closeMenuSocket = useCallback(() => {
    if (menuSocket) {
      menuSocket.close();
    }
  }, [menuSocket]);

  const clearActiveInvite = useCallback(() => {
    setActiveInvite(null);
  }, []);

  const declineInvite = useCallback((fromId: string) => {
    if (isOpenSocket(menuSocket)) {
      const packet: LobbyClientMessage = {
        type: 'decline_invite',
        targetId: fromId,
      };
      menuSocket.send(JSON.stringify(packet));
    }
    setActiveInvite(null);
  }, [menuSocket]);

  return {
    menuSocket,
    clientId,
    onlineCount,
    onlineClients,
    activeInvite,
    clearActiveInvite,
    inviteNotifications,
    setInviteNotifications,
    ping,
    quickPlayStatus,
    setQuickPlayStatus,
    lobbyChatMessages,
    sendLobbyChatMessage,
    handleQuickPlay,
    handleCancelQuickPlay,
    closeMenuSocket,
    declineInvite,
  };
}
