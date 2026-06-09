import type { CustomMapData } from '../types';
import type {
  MatchLobbyAccess,
  MatchLobbyConfig,
  MatchLobbyGameMode,
  MatchLobbySummary,
} from './protocol';

export const MAX_MATCH_LOBBY_PLAYERS = 8;
export const MIN_MATCH_LOBBY_PLAYERS = 1;
export const DEFAULT_IBRAWLS_KILL_TARGET = 25;
export const DEFAULT_GRIFBALL_GOAL_TARGET = 5;
export const DEFAULT_MATCH_TIMER_SECONDS = 522;
export const MIN_MATCH_TIMER_SECONDS = 60;
export const MAX_MATCH_TIMER_SECONDS = 60 * 60;
export const MIN_MATCH_WIN_TARGET = 1;
export const MAX_MATCH_WIN_TARGET = 100;

const VALID_ACCESS = new Set<MatchLobbyAccess>(['open', 'private', 'password']);
const VALID_GAME_MODES = new Set<MatchLobbyGameMode>(['sandbox', 'grifball']);

const clampInt = (value: unknown, fallback: number, min: number, max: number): number => {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(numeric)));
};

const normalizeString = (value: unknown, fallback: string, maxLength: number): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().slice(0, maxLength);
  return normalized.length > 0 ? normalized : fallback;
};

export const getDefaultWinTargetForMode = (gameMode: MatchLobbyGameMode): number => {
  return gameMode === 'grifball' ? DEFAULT_GRIFBALL_GOAL_TARGET : DEFAULT_IBRAWLS_KILL_TARGET;
};

export const normalizeMatchLobbyConfig = (
  input: Partial<MatchLobbyConfig> | null | undefined
): MatchLobbyConfig => {
  const rawAccess = input?.access;
  const access = VALID_ACCESS.has(rawAccess as MatchLobbyAccess)
    ? rawAccess as MatchLobbyAccess
    : 'open';

  const rawGameMode = input?.gameMode;
  const gameMode = VALID_GAME_MODES.has(rawGameMode as MatchLobbyGameMode)
    ? rawGameMode as MatchLobbyGameMode
    : 'sandbox';

  return {
    access,
    gameMode,
    selectedMap: normalizeString(input?.selectedMap, 'hangar', 64),
    customMap: input?.customMap ?? null,
    maxPlayers: clampInt(
      input?.maxPlayers,
      MAX_MATCH_LOBBY_PLAYERS,
      MIN_MATCH_LOBBY_PLAYERS,
      MAX_MATCH_LOBBY_PLAYERS
    ),
    allowObservers: input?.allowObservers !== false,
    matchTimerSeconds: clampInt(
      input?.matchTimerSeconds,
      DEFAULT_MATCH_TIMER_SECONDS,
      MIN_MATCH_TIMER_SECONDS,
      MAX_MATCH_TIMER_SECONDS
    ),
    winTarget: clampInt(
      input?.winTarget,
      getDefaultWinTargetForMode(gameMode),
      MIN_MATCH_WIN_TARGET,
      MAX_MATCH_WIN_TARGET
    ),
  };
};

export const sanitizeLobbyPassword = (password: unknown): string | undefined => {
  if (typeof password !== 'string') return undefined;
  const normalized = password.trim().slice(0, 64);
  return normalized.length > 0 ? normalized : undefined;
};

export const createMatchLobbySummary = (
  config: MatchLobbyConfig,
  {
    hasPassword = config.access === 'password',
    inProgress = false,
  }: {
    hasPassword?: boolean;
    inProgress?: boolean;
  } = {}
): MatchLobbySummary => ({
  access: config.access,
  gameMode: config.gameMode,
  selectedMap: config.selectedMap,
  customMapName: getCustomMapName(config.customMap),
  maxPlayers: config.maxPlayers,
  allowObservers: config.allowObservers,
  matchTimerSeconds: config.matchTimerSeconds,
  winTarget: config.winTarget,
  hasPassword,
  inProgress,
});

export const formatMatchTimerLabel = (seconds: number): string => {
  const clamped = clampInt(seconds, DEFAULT_MATCH_TIMER_SECONDS, 0, MAX_MATCH_TIMER_SECONDS);
  const minutes = Math.floor(clamped / 60);
  const remainingSeconds = clamped % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};

export const getMatchLobbyModeLabel = (gameMode: MatchLobbyGameMode): string => {
  return gameMode === 'grifball' ? 'Grifball' : 'iBrawls';
};

export const getMatchLobbyTargetLabel = (config: MatchLobbyConfig | MatchLobbySummary): string => {
  return config.gameMode === 'grifball'
    ? `${config.winTarget} goals`
    : `${config.winTarget} kills`;
};

const getCustomMapName = (customMap: CustomMapData | null | undefined): string | undefined => {
  if (!customMap || typeof customMap.name !== 'string') return undefined;
  const name = customMap.name.trim().slice(0, 64);
  return name.length > 0 ? name : undefined;
};
