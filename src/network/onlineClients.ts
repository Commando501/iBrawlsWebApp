import { normalizePublicRoomCode } from './roomCodePrivacy';
import type { MatchLobbySummary } from './protocol';

export const MAX_PLAYER_NAME_LENGTH = 10;
const MAX_MULTIPLAYER_CLIENTS = 7;
export const MAX_MULTIPLAYER_PLAYERS = 1 + MAX_MULTIPLAYER_CLIENTS;

export interface OnlineClient {
  id: string;
  name?: string;
  state: 'menu' | 'solo' | 'multi';
  roomCode?: string;
  spaceAvailable?: boolean;
  playerCount?: number;
  maxPlayers?: number;
  lobbyStartedAt?: number;
  lobby?: MatchLobbySummary;
}

export interface ActiveLobby {
  roomCode: string;
  members: OnlineClient[];
  playerCount: number;
  maxPlayers: number;
  isOpen: boolean;
  startedAt?: number;
  lobby?: MatchLobbySummary;
}

type MultiplayerRole = 'host' | 'client' | 'observer' | null;

export const normalizePlayerName = (name: unknown): string | undefined => {
  if (typeof name !== 'string') return undefined;
  const normalized = name.trim().substring(0, MAX_PLAYER_NAME_LENGTH);
  return normalized.length > 0 ? normalized : undefined;
};

export const getOnlineClientDisplayName = (client: OnlineClient): string => {
  return normalizePlayerName(client.name) || `Client ${client.id}`;
};

const getNumericClientValue = (value: unknown): number | undefined => {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const buildActiveLobbies = (onlineClients: OnlineClient[]): ActiveLobby[] => {
  const lobbiesByCode = new Map<string, OnlineClient[]>();

  onlineClients.forEach(client => {
    const roomCode = normalizePublicRoomCode(client.roomCode);
    if (client.state !== 'multi' || !roomCode) return;

    const members = lobbiesByCode.get(roomCode) ?? [];
    members.push(client);
    lobbiesByCode.set(roomCode, members);
  });

  return Array.from(lobbiesByCode.entries())
    .map(([roomCode, members]) => {
      const maxPlayerValues = members
        .map(client => getNumericClientValue(client.maxPlayers))
        .filter((value): value is number => value !== undefined && value > 0);
      const maxPlayers = maxPlayerValues.length > 0 ? Math.max(...maxPlayerValues) : MAX_MULTIPLAYER_PLAYERS;
      const reportedPlayerCount = members.reduce((max, client) => {
        return Math.max(max, getNumericClientValue(client.playerCount) ?? 0);
      }, 0);
      const playerCount = Math.max(members.length, reportedPlayerCount);
      const startedAtValues = members
        .map(client => getNumericClientValue(client.lobbyStartedAt))
        .filter((value): value is number => value !== undefined && value > 0);
      const startedAt = startedAtValues.length > 0 ? Math.min(...startedAtValues) : undefined;
      const lobby = members.find(member => member.lobby)?.lobby;
      const allowsPlayerJoin = lobby
        ? lobby.access !== 'private' && playerCount < maxPlayers
        : playerCount < maxPlayers;

      return {
        roomCode,
        members: [...members].sort((a, b) => getOnlineClientDisplayName(a).localeCompare(getOnlineClientDisplayName(b))),
        playerCount,
        maxPlayers,
        isOpen: members.some(client => client.spaceAvailable) && allowsPlayerJoin,
        startedAt,
        lobby,
      };
    })
    .sort((a, b) => {
      if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1;
      return (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
    });
};

export const formatLobbyDuration = (startedAt: number | undefined, now: number): string => {
  if (!startedAt) return 'Duration unavailable';

  const elapsedMs = Math.max(0, now - startedAt);
  const totalMinutes = Math.floor(elapsedMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return 'Under 1m';
};

export const getLobbyMemberStatusLabel = (client: OnlineClient): string => {
  if (client.state === 'solo') return 'Solo training';
  if (client.state === 'menu') return 'In menu';
  return client.spaceAvailable ? 'Open lobby' : 'In match';
};

export const getConnectedMatchPlayerCount = (message: any, localRole: MultiplayerRole): number => {
  const remotePlayerIds = new Set<string>();
  if (Array.isArray(message?.otherPlayerIds)) {
    message.otherPlayerIds.forEach((id: unknown) => {
      if (typeof id === 'string' && id.length > 0) {
        remotePlayerIds.add(id);
      }
    });
  }
  const resolvedLocalRole = message?.role ?? localRole;
  return remotePlayerIds.size + (resolvedLocalRole === 'observer' ? 0 : 1);
};

export const getMultiplayerSpawnSlotFromMessage = (
  message: any,
  localRole: MultiplayerRole
): number => {
  if (typeof message?.spawnSlot === 'number' && Number.isFinite(message.spawnSlot)) {
    return Math.max(0, Math.floor(message.spawnSlot));
  }
  const resolvedLocalRole = message?.role ?? localRole;
  return resolvedLocalRole === 'client' ? 1 : 0;
};
