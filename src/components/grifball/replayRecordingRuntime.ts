import { cacheReplay, savePlayerFingerprint } from '../../game/theaterDatabase';
import {
  getMatchBehaviorStats,
  getPlayerModelSnapshot,
  LOCAL_PLAYER_ID,
} from '../../game/aiPlayerModel';
import { MAIN_AI_ID } from '../../game/roster';
import { maybeSendMatchTelemetry } from '../../services/matchTelemetry';
import { maybeContributeReplay } from '../../services/replayUpload';
import { type ReplayFile, type ReplayFrame, type UniversalSettings } from '../../types';
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
import type { CharacterLoadout } from '../VoxelModels';
import {
  hasReplayEntityStateChanged,
  type ReplayEntityComparisonState,
} from './replayHelpers';
import {
  ensureReplayHeatmapData,
  flushReplayHeatmapEventsForState,
} from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type LastRecordedReplayEntityState } from './runtimeRefs';

type MutableRef<T> = { current: T };

type ReplayParticipantFrame = NonNullable<ReplayFrame['otherPlayers']>[number];

export function initializeReplayRecordingForState({
  state,
  replayData,
  replayRecordingRef,
  lastRecordTimeRef,
  replayRecordingElapsedTimeRef,
  lastRecordedStateRef,
  aiMatchSessionKey,
  opponentPlayerName,
  adminSettings,
  selectedMap,
  matchKillsToWin,
  visualModelPolicy,
  playerLoadout,
}: {
  state: GrifballRuntimeState;
  replayData: ReplayFile | null;
  replayRecordingRef: MutableRef<ReplayFile | null>;
  lastRecordTimeRef: MutableRef<number>;
  replayRecordingElapsedTimeRef: MutableRef<number>;
  lastRecordedStateRef: MutableRef<Map<string, LastRecordedReplayEntityState>>;
  aiMatchSessionKey?: string;
  opponentPlayerName?: string;
  adminSettings: UniversalSettings;
  selectedMap?: string;
  matchKillsToWin?: number;
  visualModelPolicy?: VisualModelPolicy | null;
  playerLoadout?: CharacterLoadout;
}): void {
  if (replayData || replayRecordingRef.current) return;

  const isTournament = !!aiMatchSessionKey && aiMatchSessionKey.startsWith('tournament');
  const initialOpponentName = opponentPlayerName || 'Red (AI)';
  const replayVisualModelPolicy = normalizeVisualModelPolicy(visualModelPolicy ?? adminSettings.visualModelPolicy);
  const playerVisualLoadout = sanitizeCharacterLoadoutForNetwork(playerLoadout) as Record<string, unknown> | undefined;

  replayRecordingRef.current = {
    id: Math.random().toString(36).substring(2, 9),
    name: `Match Replay - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
    description: '',
    date: new Date().toISOString(),
    duration: 0,
    playerHue: adminSettings.playerHue ?? 200,
    playerName: adminSettings.playerName || 'Blue (You)',
    opponentName: initialOpponentName,
    mapType: (selectedMap || 'hangar') as ReplayFile['mapType'],
    mode: isTournament ? 'tournament' : 'sandbox',
    gameMode: adminSettings.gameMode ?? 'sandbox',
    maxScore: isTournament ? (matchKillsToWin ?? 25) : 25,
    visualModelPolicy: replayVisualModelPolicy,
    visualLoadouts: playerVisualLoadout ? { player: playerVisualLoadout } : {},
    recordedAsObserver: state.isObserverMode,
    frames: [],
    heatmap: { version: 1, events: [] },
  };
  ensureReplayHeatmapData(replayRecordingRef.current);
  state.replayHeatmapRecordingActive = true;
  state.replayHeatmapElapsedTime = 0;
  state.pendingReplayHeatmapEvents = [];
  lastRecordTimeRef.current = 0;
  replayRecordingElapsedTimeRef.current = 0;
  lastRecordedStateRef.current.clear();
  console.log('Match Replay Recording initialized successfully!');
}

export function recordReplayFrameForState({
  state,
  time,
  replayRecordingRef,
  lastRecordedStateRef,
  isMultiplayer,
}: {
  state: GrifballRuntimeState;
  time: number;
  replayRecordingRef: MutableRef<ReplayFile | null>;
  lastRecordedStateRef: MutableRef<Map<string, LastRecordedReplayEntityState>>;
  isMultiplayer: boolean;
}): void {
  if (!replayRecordingRef.current) return;

  flushReplayHeatmapEventsForState({ state, replayRecordingRef });

  const frame: ReplayFrame = {
    time,
    otherPlayers: [],
  };

  const hasPlayerChanged = (id: string, current: ReplayEntityComparisonState) =>
    hasReplayEntityStateChanged(current, lastRecordedStateRef.current.get(id));

  const pSpeed = state.playerVel.length();
  const playerState = {
    pos: { x: state.playerPos.x, y: state.playerPos.y, z: state.playerPos.z },
    vel: { x: state.playerVel.x, y: state.playerVel.y, z: state.playerVel.z },
    yaw: state.yaw,
    pitch: state.pitch,
    hp: state.playerHP,
    isCrouching: state.isCrouching,
    isJumping: state.isJumping || false,
    isLunging: state.isLunging || false,
    isDashing: state.playerDashRemaining > 0,
    isSprinting: state.settings.enableSprint && (pSpeed > 5.5 && !state.isCrouching && !state.isJumping && state.playerDashRemaining <= 0),
    isSliding: state.playerSlideActive || false,
    weaponTimer: state.activeWeapon === 'hammer' ? state.pWeaponTimer : state.pSwordTimer,
    activeWeapon: state.activeWeapon,
    weaponState: state.pWeaponState === 'ready' && state.pSwordState !== 'ready' ? state.pSwordState : state.pWeaponState,
    score: state.scorePlayer,
    kills: state.playerKills ?? 0,
    deaths: state.playerDeaths ?? 0,
    respawnTimer: state.playerRespawnTimer,
    invulnerabilityTimer: state.playerInvulnerabilityTimer,
  };

  const playerCompState = {
    pos: state.playerPos,
    vel: state.playerVel,
    yaw: state.yaw,
    hp: state.playerHP,
    activeWeapon: playerState.activeWeapon,
    weaponState: playerState.weaponState,
    isCrouching: playerState.isCrouching,
    score: playerState.score,
    kills: playerState.kills,
    deaths: playerState.deaths,
  };

  if (hasPlayerChanged('player', playerCompState)) {
    frame.player = playerState as ReplayFrame['player'];
    lastRecordedStateRef.current.set('player', {
      pos: state.playerPos.clone(),
      vel: state.playerVel.clone(),
      yaw: state.yaw,
      hp: state.playerHP,
      activeWeapon: playerState.activeWeapon,
      weaponState: playerState.weaponState,
      isCrouching: playerState.isCrouching,
      score: playerState.score,
      kills: playerState.kills,
      deaths: playerState.deaths,
    });
  }

  if (!isMultiplayer) {
    state.otherPlayers.forEach((bot, id) => {
      if (bot.controller !== 'ai') return;
      const botState = {
        id,
        playerName: bot.playerName,
        hue: bot.hue,
        pos: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z },
        vel: { x: bot.vel.x, y: bot.vel.y, z: bot.vel.z },
        yaw: bot.yaw,
        pitch: bot.pitch || 0,
        hp: bot.hp,
        isCrouching: bot.isCrouching,
        isLunging: bot.isLunging || bot.aiState === 'LUNGING' || false,
        isDashing: (bot.aiDashRemaining || 0) > 0,
        isSprinting: bot.aiIsSprinting || false,
        isSliding: bot.aiSlideActive || false,
        weaponTimer: bot.weaponTimer ?? 0,
        activeWeapon: bot.activeWeapon,
        weaponState: bot.weaponState || 'ready',
        score: id === MAIN_AI_ID ? state.scoreEnemy : (bot.score ?? 0),
        kills: id === MAIN_AI_ID ? (state.enemyKills ?? 0) : (bot.kills ?? 0),
        deaths: id === MAIN_AI_ID ? (state.enemyDeaths ?? 0) : (bot.deaths ?? 0),
        respawnTimer: id === MAIN_AI_ID ? state.enemyRespawnTimer : (bot.respawnTimer ?? 0),
        invulnerabilityTimer: bot.invulnerabilityTimer ?? 0,
      };

      const botCompState = {
        pos: bot.pos,
        vel: bot.vel,
        yaw: bot.yaw,
        hp: bot.hp,
        activeWeapon: botState.activeWeapon,
        weaponState: botState.weaponState,
        isCrouching: botState.isCrouching,
        score: botState.score,
        kills: botState.kills,
        deaths: botState.deaths,
      };

      if (hasPlayerChanged(id, botCompState)) {
        const visualLoadout = sanitizeCharacterLoadoutForNetwork((bot as { loadout?: unknown }).loadout);
        if (visualLoadout) {
          replayRecordingRef.current!.visualLoadouts = {
            ...(replayRecordingRef.current!.visualLoadouts ?? {}),
            [id]: visualLoadout as Record<string, unknown>,
          };
        }
        frame.otherPlayers!.push(botState as ReplayParticipantFrame);
        lastRecordedStateRef.current.set(id, {
          pos: bot.pos.clone(),
          vel: bot.vel.clone(),
          yaw: bot.yaw,
          hp: bot.hp,
          activeWeapon: botState.activeWeapon,
          weaponState: botState.weaponState,
          isCrouching: botState.isCrouching,
          score: botState.score,
          kills: botState.kills,
          deaths: botState.deaths,
        });
      }
    });
  }

  if (isMultiplayer) {
    state.otherPlayers.forEach((bot, id) => {
      const botState = {
        id,
        playerName: bot.playerName,
        hue: bot.hue,
        pos: { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z },
        vel: { x: bot.vel.x, y: bot.vel.y, z: bot.vel.z },
        yaw: bot.yaw,
        pitch: bot.pitch || 0,
        hp: bot.hp,
        isCrouching: bot.isCrouching,
        isLunging: bot.isLunging || bot.aiState === 'LUNGING' || false,
        isDashing: (bot.aiDashRemaining || 0) > 0,
        isSprinting: bot.aiIsSprinting || false,
        isSliding: bot.aiSlideActive || false,
        weaponTimer: bot.weaponTimer ?? 0,
        activeWeapon: bot.activeWeapon,
        weaponState: bot.weaponState || 'ready',
        score: bot.score ?? 0,
        kills: bot.kills ?? 0,
        deaths: bot.deaths ?? 0,
        respawnTimer: bot.respawnTimer ?? 0,
        invulnerabilityTimer: bot.invulnerabilityTimer ?? 0,
      };

      const botCompState = {
        pos: bot.pos,
        vel: bot.vel,
        yaw: bot.yaw,
        hp: bot.hp,
        activeWeapon: botState.activeWeapon,
        weaponState: botState.weaponState,
        isCrouching: botState.isCrouching,
        score: botState.score,
        kills: botState.kills,
        deaths: botState.deaths,
      };

      if (hasPlayerChanged(id, botCompState)) {
        const visualLoadout = sanitizeCharacterLoadoutForNetwork((bot as { loadout?: unknown }).loadout);
        if (visualLoadout) {
          replayRecordingRef.current!.visualLoadouts = {
            ...(replayRecordingRef.current!.visualLoadouts ?? {}),
            [id]: visualLoadout as Record<string, unknown>,
          };
        }
        frame.otherPlayers!.push(botState as ReplayParticipantFrame);
        lastRecordedStateRef.current.set(id, {
          pos: bot.pos.clone(),
          vel: bot.vel.clone(),
          yaw: bot.yaw,
          hp: bot.hp,
          activeWeapon: botState.activeWeapon,
          weaponState: botState.weaponState,
          isCrouching: botState.isCrouching,
          score: botState.score,
          kills: botState.kills,
          deaths: botState.deaths,
        });
      }
    });
  }

  replayRecordingRef.current.frames.push(frame);
}

export async function saveCompiledReplayForRefs({
  state,
  replayRecordingRef,
  replayRecordingElapsedTimeRef,
}: {
  state: GrifballRuntimeState;
  replayRecordingRef: MutableRef<ReplayFile | null>;
  replayRecordingElapsedTimeRef: MutableRef<number>;
}): Promise<void> {
  const recording = replayRecordingRef.current;
  if (!recording || recording.frames.length === 0) return;

  flushReplayHeatmapEventsForState({ state, replayRecordingRef });
  replayRecordingRef.current = null;
  recording.duration = replayRecordingElapsedTimeRef.current;
  state.replayHeatmapRecordingActive = false;

  try {
    await cacheReplay(recording);
    console.log('Match replay compiled and auto-saved successfully! Total frames:', recording.frames.length);
  } catch (err) {
    console.error('Failed to auto-save compiled replay:', err);
  }

  void maybeContributeReplay(recording);
}

export function persistLocalPlayerFingerprintForState({
  state,
  replayActive,
}: {
  state: GrifballRuntimeState;
  replayActive: boolean;
}): void {
  if (state.isObserverMode || replayActive) return;
  const snapshot = getPlayerModelSnapshot(state.aiMatchContext, LOCAL_PLAYER_ID, 5);
  if (!snapshot) return;
  savePlayerFingerprint(LOCAL_PLAYER_ID, snapshot).catch(() => {
    /* player-memory persistence is best-effort; ignore storage failures */
  });
}

export function emitMatchTelemetryForState({
  state,
  replayActive,
  selectedMap,
  aiMatchSessionKey,
  durationSeconds,
}: {
  state: GrifballRuntimeState;
  replayActive: boolean;
  selectedMap: unknown;
  aiMatchSessionKey: string;
  durationSeconds: number;
}): void {
  if (state.isObserverMode || replayActive) return;
  const player = getPlayerModelSnapshot(state.aiMatchContext, LOCAL_PLAYER_ID, 5);
  if (!player) return;
  const behavior = getMatchBehaviorStats(state.aiMatchContext, LOCAL_PLAYER_ID);
  void maybeSendMatchTelemetry({
    map: String(selectedMap ?? ''),
    mode: aiMatchSessionKey && aiMatchSessionKey.startsWith('tournament') ? 'tournament' : 'sandbox',
    aiDifficulty: String(state.settings.aiDifficulty ?? ''),
    aiArchetype: String(state.settings.aiArchetype ?? 'none'),
    gameMode: String(state.settings.gameMode ?? 'sandbox'),
    scorePlayer: state.scorePlayer ?? 0,
    scoreEnemy: state.scoreEnemy ?? 0,
    playerKills: state.playerKills ?? 0,
    playerDeaths: state.playerDeaths ?? 0,
    durationSeconds,
    isMultiplayer: state.isMultiplayer ? 1 : 0,
    opponentCount: state.otherPlayers?.size ?? 0,
    multikills: state.playerMultikillCount ?? 0,
    sprees: state.playerSpreeCount ?? 0,
    lungeAttempts: behavior?.lungeAttempts ?? 0,
    lungeHits: behavior?.lungeHits ?? 0,
    hammerAttacks: behavior?.hammerAttacks ?? 0,
    weaponSwaps: behavior?.weaponSwaps ?? 0,
    dashes: behavior?.dashes ?? 0,
    countersAttempted: behavior?.countersAttempted ?? 0,
    countersLanded: behavior?.countersLanded ?? 0,
    damageDealtCount: behavior?.damageDealtCount ?? 0,
    damageReceivedCount: behavior?.damageReceivedCount ?? 0,
    player,
  });
}
