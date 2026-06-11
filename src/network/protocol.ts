import { type RemotePlayerState, type CustomMapData } from '../types';
import { type CharacterLoadout } from '../components/VoxelModels';
import { type VisualModelPolicy } from '../model/modelSystem';

export type ClientPresenceState = 'menu' | 'solo' | 'multi';
export type GameRole = 'host' | 'client' | 'observer';
export type MatchLobbyAccess = 'open' | 'private' | 'password';
export type MatchLobbyGameMode = 'sandbox' | 'grifball';

export interface MatchLobbyConfig {
  access: MatchLobbyAccess;
  gameMode: MatchLobbyGameMode;
  selectedMap: string;
  customMap?: CustomMapData | null;
  maxPlayers: number;
  allowObservers: boolean;
  matchTimerSeconds: number;
  winTarget: number;
  visualModelPolicy: VisualModelPolicy;
}

export interface MatchLobbySummary {
  access: MatchLobbyAccess;
  gameMode: MatchLobbyGameMode;
  selectedMap: string;
  customMapName?: string;
  maxPlayers: number;
  allowObservers: boolean;
  matchTimerSeconds: number;
  winTarget: number;
  visualModelPolicy: VisualModelPolicy;
  hasPassword: boolean;
  inProgress?: boolean;
}

export interface GameplayPlayerSlotPayload {
  clientId: string;
  role: GameRole;
  spawnSlot?: number;
  playerName?: string;
  hue?: number;
  loadout?: CharacterLoadout;
}

export interface OnlineClientPayload {
  id: string;
  name?: string;
  publicDisplayName?: string;
  state: ClientPresenceState;
  roomCode?: string;
  spaceAvailable?: boolean;
  playerCount?: number;
  maxPlayers?: number;
  lobbyStartedAt?: number;
  lobby?: MatchLobbySummary;
}

export type LobbyServerMessage =
  | { type: 'welcome'; clientId: string; playerName?: string }
  | { type: 'presence'; onlineCount: number; clients: OnlineClientPayload[] }
  | { type: 'signed_in_elsewhere'; message: string }
  | { type: 'pong'; timestamp: number }
  | { type: 'receive_invite'; fromId: string; roomCode: string; inviteToken?: string }
  | { type: 'invite_declined'; fromId: string }
  | { type: 'lobby_chat'; id: string; sender: string; text: string; timestamp: string; clientId: string }
  | { type: 'quickplay_queued' }
  | { type: 'quickplay_host'; roomCode: string }
  | { type: 'quickplay_match_found'; roomCode: string }
  | { type: 'error'; message: string };

export type LobbyClientMessage =
  | { type: 'update_status'; status: ClientPresenceState; roomCode?: string; spaceAvailable: boolean; name?: string; playerCount?: number; maxPlayers?: number; accountId?: string; onlineInstanceId?: string; lobby?: MatchLobbySummary }
  | { type: 'lobby_chat'; sender: string; text: string }
  | { type: 'ping'; timestamp: number }
  | { type: 'send_invite'; targetId: string; roomCode: string }
  | { type: 'decline_invite'; targetId: string }
  | { type: 'quickplay_join' }
  | { type: 'quickplay_leave' };

export type GameplayServerMessage =
  | { type: 'hosted'; keys: string[]; clientId?: string; playerName?: string; role?: GameRole; spawnSlot?: number; lobbyConfig?: MatchLobbyConfig }
  | {
      type: 'connected';
      role: GameRole;
      clientId?: string;
      playerName?: string;
      hostClientId?: string;
      clientClientId?: string;
      participants?: GameplayPlayerSlotPayload[];
      otherPlayerIds?: string[];
      otherPlayers?: GameplayPlayerSlotPayload[];
      opponentPlayerName?: string;
      spawnSlot?: number;
      lobbyConfig?: MatchLobbyConfig;
      matchStarted?: boolean;
    }
  | { type: 'match_start'; lobbyConfig: MatchLobbyConfig }
  | { type: 'player_joined'; clientId: string; playerName?: string; role?: GameRole; spawnSlot?: number; hue?: number; loadout?: CharacterLoadout }
  | { type: 'player_left'; leftPlayerId: string; role?: GameRole }
  | { type: 'observer_joined'; observerId: string; playerName?: string; role?: GameRole; hue?: number; loadout?: CharacterLoadout }
  | { type: 'role_changed'; role: GameRole; spawnSlot?: number }
  | { type: 'opponent_role_changed'; clientId: string; role: GameRole }
  | { type: 'disconnected'; reason: string }
  | { type: 'error'; message: string }
  | GameplaySyncMessage;

export type GameplayClientMessage =
  | { type: 'host'; ip?: string; lanIp?: string; customId?: string; playerName?: string; hue?: number; loadout?: CharacterLoadout; lobbyConfig?: Partial<MatchLobbyConfig>; password?: string }
  | { type: 'join'; targetIpOrId: string; isObserver?: boolean; playerName?: string; hue?: number; loadout?: CharacterLoadout; password?: string; inviteToken?: string }
  | { type: 'start_match' }
  | { type: 'change_role'; role: GameRole }
  | GameplaySyncMessage;

export type GameplaySyncAction =
  | 'chat'
  | 'unlock_secret'
  | 'request_map'
  | 'sync_map'
  | 'match_loading_status'
  | 'match_end'
  | 'swing_hammer'
  | 'melee_hammer'
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
  progress?: number;
  stage?: string;
  ready?: boolean;
  loadout?: CharacterLoadout;
  selectedMap?: string;
  customMap?: CustomMapData | null;
  lobbyConfig?: MatchLobbyConfig;
  winner?: 'host' | 'client' | 'blue' | 'red' | 'draw';
  reason?: 'target' | 'timer' | 'host_ended';
}
