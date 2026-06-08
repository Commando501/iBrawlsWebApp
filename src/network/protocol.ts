import { RemotePlayerState } from '../types';

export type ClientPresenceState = 'menu' | 'solo' | 'multi';
export type GameRole = 'host' | 'client' | 'observer';

export interface GameplayPlayerSlotPayload {
  clientId: string;
  role: GameRole;
  spawnSlot: number;
  playerName?: string;
}

export interface OnlineClientPayload {
  id: string;
  name?: string;
  state: ClientPresenceState;
  roomCode?: string;
  spaceAvailable?: boolean;
  playerCount?: number;
  maxPlayers?: number;
  lobbyStartedAt?: number;
}

export type LobbyServerMessage =
  | { type: 'welcome'; clientId: string }
  | { type: 'presence'; onlineCount: number; clients: OnlineClientPayload[] }
  | { type: 'signed_in_elsewhere'; message: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'receive_invite'; fromId: string; roomCode: string }
  | { type: 'invite_declined'; fromId: string }
  | { type: 'lobby_chat'; id: string; sender: string; text: string; timestamp: string; clientId: string }
  | { type: 'quickplay_queued' }
  | { type: 'quickplay_host'; roomCode: string }
  | { type: 'quickplay_match_found'; roomCode: string }
  | { type: 'error'; message: string };

export type LobbyClientMessage =
  | { type: 'update_status'; status: ClientPresenceState; roomCode?: string; spaceAvailable: boolean; name?: string; playerCount?: number; maxPlayers?: number; accountId?: string; onlineInstanceId?: string }
  | { type: 'lobby_chat'; sender: string; text: string }
  | { type: 'ping'; timestamp: number }
  | { type: 'send_invite'; targetId: string; roomCode: string }
  | { type: 'decline_invite'; targetId: string }
  | { type: 'quickplay_join' }
  | { type: 'quickplay_leave' };

export type GameplayServerMessage =
  | { type: 'hosted'; keys: string[] }
  | {
      type: 'connected';
      role: GameRole;
      clientId?: string;
      hostClientId?: string;
      clientClientId?: string;
      otherPlayerIds?: string[];
      otherPlayers?: GameplayPlayerSlotPayload[];
      opponentPlayerName?: string;
      spawnSlot?: number;
    }
  | { type: 'player_joined'; clientId: string; playerName?: string; role?: GameRole; spawnSlot?: number }
  | { type: 'player_left'; leftPlayerId: string }
  | { type: 'observer_joined'; observerId: string }
  | { type: 'role_changed'; role: GameRole; spawnSlot?: number }
  | { type: 'opponent_role_changed'; clientId: string; role: GameRole }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; message: string }
  | GameplaySyncMessage;

export type GameplayClientMessage =
  | { type: 'host'; ip?: string; lanIp?: string; customId?: string }
  | { type: 'join'; targetIpOrId: string; isObserver?: boolean }
  | { type: 'change_role'; role: GameRole }
  | GameplaySyncMessage;

export type GameplaySyncAction =
  | 'chat'
  | 'swing_hammer'
  | 'hammer_impact'
  | 'slash_sword'
  | 'lunge_sword'
  | 'hit_taken';

export interface GameplaySyncMessage {
  type: 'sync';
  action?: GameplaySyncAction;
  senderId?: string;
  senderRole?: GameRole;
  targetId?: string;
  damage?: number;
  id?: string;
  sender?: string;
  text?: string;
  timestamp?: string;
  role?: GameRole | null;
  dir?: { x: number; y: number; z: number };
  pos?: RemotePlayerState['pos'];
  vel?: RemotePlayerState['vel'];
  yaw?: number;
  pitch?: number;
  hp?: number;
  maxHp?: number;
  isCrouching?: boolean;
  activeWeapon?: RemotePlayerState['activeWeapon'];
  respawnTimer?: number;
  invulnerabilityTimer?: number;
  hue?: number;
  playerName?: string;
  scoreHost?: number;
  scoreClient?: number;
  killsHost?: number;
  deathsHost?: number;
  killsClient?: number;
  deathsClient?: number;
  gameTime?: number;
  clientHP?: number;
  radius?: number;
}
