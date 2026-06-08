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
} from '../../network/protocol';
import {
  SIGNED_IN_ELSEWHERE_CLOSE_CODE,
  SIGNED_IN_ELSEWHERE_MESSAGE,
} from './multiplayerConnectionConstants';

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
  buildLobbyWsUrl: (playerName: string) => string;
  redactWsUrl: (url: string) => string;
  refreshMultiplayerPreset: (serverVersion?: number) => void;
  setConnectionError: Dispatch<SetStateAction<string>>;
  handleQuickplayHostRef: MutableRefObject<(overrideCode?: string) => void>;
  handleQuickplayJoinRef: MutableRefObject<(target: string) => void>;
}

const isOpenSocket = (socket: WebSocket | null): socket is WebSocket => {
  return Boolean(socket && socket.readyState === WebSocket.OPEN);
};

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
  const [activeInvite, setActiveInvite] = useState<{ fromId: string; roomCode: string } | null>(null);
  const [inviteNotifications, setInviteNotifications] = useState<string[]>([]);
  const [ping, setPing] = useState<number | undefined>(undefined);
  const [quickPlayStatus, setQuickPlayStatus] = useState<LobbyQuickPlayStatus>('idle');
  const [lobbyChatMessages, setLobbyChatMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let isDestroyed = false;

    const connect = () => {
      if (isDestroyed) return;

      if (!navigator.onLine) {
        setMenuSocket(null);
        setOnlineCount(0);
        setOnlineClients([]);
        reconnectTimeout = setTimeout(connect, 5000);
        return;
      }

      const wsUrl = buildLobbyWsUrl(playerName);
      console.log('Connecting persistent lobby socket to:', redactWsUrl(wsUrl));
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('Lobby network established.');
        if (isDestroyed) {
          ws?.close();
          return;
        }
        setMenuSocket(ws);
      };

      ws.onmessage = (event) => {
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
            setQuickPlayStatus('searching');
          } else if (data.type === 'quickplay_host') {
            setQuickPlayStatus('matching');
            handleQuickplayHostRef.current(data.roomCode);
          } else if (data.type === 'quickplay_match_found') {
            setQuickPlayStatus('idle');
            handleQuickplayJoinRef.current(data.roomCode);
          } else if (data.type === 'signed_in_elsewhere') {
            setConnectionError(data.message || SIGNED_IN_ELSEWHERE_MESSAGE);
          } else if (data.type === 'config_changed') {
            refreshMultiplayerPreset(data.version);
          }
        } catch (e) {
          console.error('Lobby network parsing error:', e);
        }
      };

      ws.onclose = (event) => {
        setMenuSocket(null);
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

      ws.onerror = () => {
        ws?.close();
      };
    };

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

    if (isPlaying) {
      if (isMultiplayer) {
        status = 'multi';
        roomCode = multiplayerRole === 'host' ? hostIdCode : joinIpOrId;
        spaceAvailable = multiplayerRole !== 'observer'
          && Boolean(roomCode)
          && multiplayerPlayerCount < MAX_MULTIPLAYER_PLAYERS;
      } else {
        status = 'solo';
      }
    } else if (connectionStatus === 'hosting') {
      status = 'multi';
      roomCode = hostIdCode;
      spaceAvailable = true;
    } else if (connectionStatus === 'connecting') {
      status = 'multi';
      roomCode = joinIpOrId;
      spaceAvailable = false;
    }

    const packet: LobbyClientMessage = {
      type: 'update_status',
      status,
      roomCode,
      spaceAvailable,
      playerCount: status === 'multi' ? multiplayerPlayerCount : undefined,
      maxPlayers: status === 'multi' ? MAX_MULTIPLAYER_PLAYERS : undefined,
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
    setQuickPlayStatus('searching');
    const packet: LobbyClientMessage = { type: 'quickplay_join' };
    menuSocket.send(JSON.stringify(packet));
  }, [menuSocket, setConnectionError]);

  const handleCancelQuickPlay = useCallback(() => {
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
