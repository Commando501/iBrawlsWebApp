import type { CustomMapData, ReplayFile } from '../../types';
import type { CharacterLoadout } from '../VoxelModels';

export type MatchLoadingMode = 'solo' | 'replay' | 'multiplayer';
export type MatchLoadingRole = 'host' | 'client' | 'observer';

export interface GameLoadingState {
  visible: boolean;
  progress: number;
  stage: string;
  detail?: string;
  ready: boolean;
  error?: string;
}

export interface MultiplayerLoadingParticipant {
  clientId: string;
  role: MatchLoadingRole;
  spawnSlot?: number;
  playerName: string;
  hue: number;
  loadout?: CharacterLoadout;
  progress: number;
  stage: string;
  ready: boolean;
  timedOut?: boolean;
  lastUpdatedAt: number;
}

export interface MultiplayerLoadingSnapshot {
  participants: MultiplayerLoadingParticipant[];
  gateReleased: boolean;
  waitingCount: number;
}

export interface MultiplayerLoadingSlotPayload {
  clientId: string;
  role: MatchLoadingRole;
  spawnSlot?: number;
  playerName?: string;
  hue?: number;
  loadout?: CharacterLoadout;
}

export interface MultiplayerLoadingStatusPayload {
  clientId?: string;
  role?: MatchLoadingRole;
  spawnSlot?: number;
  playerName?: string;
  hue?: number;
  loadout?: CharacterLoadout;
  progress?: number;
  stage?: string;
  ready?: boolean;
}

export interface TopDownMapPreviewInput {
  selectedMap: string;
  customMap?: CustomMapData | null;
  replayData?: ReplayFile | null;
}

export const INITIAL_GAME_LOADING_STATE: GameLoadingState = {
  visible: false,
  progress: 0,
  stage: 'Waiting',
  ready: false,
};
