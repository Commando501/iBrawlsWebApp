import type React from 'react';
import {
  type AIBehaviorPreset,
  type CharacterModelType,
  type CustomMapData,
  type DeviceInfo,
  type GameStats,
  type Keybindings,
  type ReplayFile,
  type UniversalSettings,
} from '../../types';
import { type GameLoadingState } from '../loading/loadingTypes';
import { type CharacterLoadout } from '../VoxelModels';

export interface GrifballGameProps {
  isPlaying: boolean;
  isPaused: boolean;
  debugMode: boolean;
  adminSettings: UniversalSettings;
  onStatsUpdate: (stats: GameStats) => void;
  onLoadingStateChange?: (state: GameLoadingState) => void;
  onPauseToggle: () => void;
  isMultiplayer?: boolean;
  multiplayerRole?: 'host' | 'client' | 'observer' | null;
  multiplayerSocket?: WebSocket | null;
  multiplayerSpawnSlot?: number;
  opponentClientId?: string;
  opponentPlayerName?: string;
  offlineBotCount?: number;
  botDifficulties?: Record<string, string>;
  botColors?: Record<string, number>;
  botBehaviors?: Record<string, AIBehaviorPreset>;
  botWeaponBehaviors?: Record<string, string>;
  botArchetypes?: Record<string, string>;
  botModelTypes?: Record<string, CharacterModelType>;
  aiPresets?: any[];
  /** Changes when a new match session starts (sandbox or tournament round). */
  aiMatchSessionKey?: string;
  /** First-to-N kills for tournament match-point awareness; omit in sandbox. */
  matchKillsToWin?: number;
  keybindings?: Keybindings;
  deviceInfo: DeviceInfo;
  forceMobileControls: boolean;
  mobileJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickRef: React.MutableRefObject<{ x: number; y: number }>;
  mobileRightJoystickActiveRef: React.MutableRefObject<boolean>;
  selectedMap?: string;
  customMap?: CustomMapData;
  replayData?: ReplayFile | null;
  onExitReplay?: () => void;
  playerLoadout?: CharacterLoadout;
}
