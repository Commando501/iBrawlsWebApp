/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { buildGravityHammerModel, buildVoxelSpartanModel, buildKatarSwordModel, buildPistolModel, CharacterLoadout, AVAILABLE_PRESETS } from './VoxelModels';
import { GameStats, Stance, WeaponState, AIBehaviorState, UniversalSettings, DeathEvent, Keybindings, DEFAULT_KEYBINDINGS, DeviceInfo, AIBehaviorPreset, MedalInfo, Combatant, ReplayFrame, ReplayFile, CustomMapData, CustomMapObject } from '../types';
import { cacheReplay } from '../game/theaterDatabase';
import {
  AI_FORCED_DESCENT_SPEED,
  AI_MAX_AIRBORNE_HEIGHT,
  recoverAIFromRunawayAltitude as applyAIAltitudeRecovery,
} from '../game/aiAltitude';
import { type AILungeOutcome, type AITacticalTargetSnapshot, evaluateAICombatDecision } from '../game/aiCombatDecision';
import { evaluateKillMedals } from '../game/rewards';
import { resolveObstacleCollisions } from '../game/mapPhysics';
import { bakeNavMesh, findShortestPath } from '../game/mapNavigation';
import { PREMADE_MAPS } from '../game/premadeMaps';
import { createAIMatchContext, resetAIMatchContext, type AIMatchContext, tickFeintCooldown, getFeintCooldownRemaining, startFeintCooldown, isWeaponSwapFeintActive, startWeaponSwapFeint, tickWeaponSwapFeintTimer, getOrCreateBotPsychState, tickBotPsychState, getBotComboState, setBotComboState, clearBotComboState } from '../game/aiMatchContext';
import {
  getAttackPhaseIndex,
  getCoordinatedTargetBonus,
  getEngagingBotIds,
  getPincerApproachOffset,
  notifyBotDamageTag,
  registerBotEngagement,
  shouldDeferCoordinatedAttack,
  shouldPunisherHold,
} from '../game/aiBotCoordinator';
import {
  seedOfflineRoster,
  tickAIOrchestrator,
  type AIOrchestratorEvents,
  type AIOrchestratorSpawnCallbacks,
} from '../game/aiOrchestrator';
import {
  canUseWeaponCombos,
  comboBlocksTacticalSwap,
  createBotComboState,
  notifyComboAttackStarted,
  pickComboOnHit,
  pickOpeningCombo,
  progressComboState,
  shouldAbortCombo,
} from '../game/aiComboEngine';
import { deriveMatchStateMultipliers, shouldAvoidCoinFlipTrade, applyMatchAggression } from '../game/aiTuning';
import { resolvePersonalityFlags } from '../game/aiPersonalities';
import {
  resolveKnobsFromRosterSlot,
  resolveDerivedFromRosterSlot,
  resolveRosterSlotForCombatant,
  type LegacyRosterProps,
} from '../game/rosterSlotConfig';
import {
  DEFAULT_AI_TEAM,
  createEmptyTeamScores,
  installLegacyTeamScoreBridges,
  localPlayerTeamFromRole,
  type TeamScoresState,
  type TeamId,
} from '../game/teamScoring';
import {
  MAIN_AI_ID,
  createRemoteCombatant,
  getAICombatants,
  getDisplayOpponent,
  getMainAI,
  getPrimaryRemoteOpponent,
  getRosterCombatant,
  isAICombatReady,
  removeMainAIFromRoster,
} from '../game/roster';
import {
  APPROACH_FEINT_BACK_TIMER,
  CHARGE_ABORT_SIDESTEP_TIMER,
  LUNGE_FAKEOUT_FORWARD_TIMER,
  WEAPON_SWAP_FEINT_DELAY,
  canAttemptChargeAbortFeint,
  canAttemptLungeFakeout,
  canAttemptWeaponSwapFeint,
  getApproachFeintWindow,
  getPlayerFeintMultiplier,
  rollFeintAttempt,
  rollFeintCooldownDuration,
} from '../game/aiFeints';
import {
  getPressureApproachSpeed,
  getPressureDuration,
  getPressureMaxRange,
  shouldEnterPressure,
  shouldExitPressure,
  shouldPressurePreferLunge,
  shouldPressureReSwing,
} from '../game/aiPressure';
import {
  accumulateStandoffTimer,
  getActivePostKillPressure,
  getEffectiveReactionLatency,
  getPostKillApproachSpeed,
  getPostKillHoldDistance,
  isInStandoffBand,
  isPsychPressureEnabled,
  notifyBotKill,
  shouldForceStandoffCommit,
  shouldTelegraphSwordAtSpawn,
} from '../game/aiPsychologicalPressure';
import {
  applyCalibrationMultipliers,
  computeCalibrationMultipliers,
  getOrCreateBotCalibrationState,
  isSkillCalibrationEnabled,
  NEUTRAL_CALIBRATION_MULTIPLIERS,
  recordCalibrationCounterAttempt,
  recordCalibrationCounterSuccess,
  recordCalibrationDeath,
  recordCalibrationDodgeAttempt,
  recordCalibrationDodgeFailed,
  recordCalibrationKill,
  tickCalibrationPendingCounter,
  tickCalibrationPendingDodge,
} from '../game/aiSkillCalibration';
import {
  applyLungeAimBias,
  getApproachLateralOffset,
  getOrCreatePlayerModel,
  getPlayerModelSnapshot,
  LOCAL_PLAYER_ID,
  observePlayerCounter,
  observePlayerDamageDealt,
  observePlayerDamageReceived,
  observePlayerDash,
  observePlayerHammerAttack,
  observePlayerLungeEnd,
  observePlayerLungeStart,
  observePlayerApproachSpeed,
  observePlayerPosition,
  observePlayerReaction,
  observePlayerWeaponSwap,
  type PlayerModel,
  type PlayerModelSnapshot,
} from '../game/aiPlayerModel';
import {
  blendSpatialHeading,
  getBulltrueHammerTriggerBand,
  getEvasionDashRollChance,
  getEvasionTimingScale,
  getHammerJumpEvasionChance,
  getSpatialMovementBias,
  getSpawnGuardAimAngle,
  getTargetEdgeSelectionBonus,
  isInBulltrueHammerWindow,
  isWithinEvasionRange,
  pickPerpendicularDodgeDirection,
  resolveTargetLungeDirection,
  scorePosition,
  shouldAttemptBaitDodge,
  shouldCommitChargeAfterEvasion,
} from '../game/aiSpatialStrategy';
import {
  advanceAISlide,
  getSlideSpeed,
  getSprintSpeedMultiplier,
  getTargetRecedingSpeed,
  shouldAISprint,
  shouldStartAISlide,
} from '../game/aiMovementMechanics';

const whiteBlinkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

interface GrifballGameProps {
  isPlaying: boolean;
  isPaused: boolean;
  debugMode: boolean;
  adminSettings: UniversalSettings;
  onStatsUpdate: (stats: GameStats) => void;
  onPauseToggle: () => void;
  isMultiplayer?: boolean;
  multiplayerRole?: 'host' | 'client' | null;
  multiplayerSocket?: WebSocket | null;
  opponentClientId?: string;
  opponentPlayerName?: string;
  offlineBotCount?: number;
  botDifficulties?: Record<string, string>;
  botColors?: Record<string, number>;
  botBehaviors?: Record<string, AIBehaviorPreset>;
  botWeaponBehaviors?: Record<string, string>;
  botArchetypes?: Record<string, string>;
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

const getInwardSpawnYaw = (spawnPos: THREE.Vector3): number => {
  return Math.atan2(spawnPos.x, spawnPos.z);
};

type TacticalTargetCandidate = AITacticalTargetSnapshot & {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
};

const GRAVITY_ACCELERATION = 18.0;
const BODY_CENTER_HEIGHT = 0.825;
const CROUCH_BODY_CENTER_HEIGHT = 0.52;
const AI_HAMMER_JUMP_COOLDOWN = 2.25;
const AI_HAMMER_JUMP_START_MAX_HEIGHT = 0.08;
const AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON = 0.1;
// Stationary-swing geometry, shared by the hit resolver (applyBotMeleeImpact) and the
// AI commit gates so the two cannot drift. The hammer is a wide ground-pound planted
// ~attackRange ahead (radius attackRadius); the sword is a precise melee — a tight slash
// arc close to the wielder. Gating a sword swing on hammer reach is what made every AI
// "bluff slash": committing a stationary slash from ~6u away that whiffs and only burns
// the cooldown. The sword closes distance with its lunge, not a ranged stationary swing.
const HAMMER_STRIKE_FORWARD_FACTOR = 0.875;
const SWORD_SLASH_FORWARD_FACTOR = 0.3;
const SWORD_SLASH_RADIUS = 2.0;
// Standing eye height used as the origin of every stationary melee reach test, so the
// player and the AI measure their swings from the same point.
const MELEE_EYE_HEIGHT = 1.65;
// Stationary melee reach (eye -> target body-center), shared by the player and every AI
// combatant so neither out-ranges the other. The sword slash is a tight arc; the hammer
// side-swipe is slightly longer. Neither is the wide overhead gravity-hammer AoE, which is
// governed separately by attackRange/attackRadius.
const MELEE_SWORD_SLASH_REACH = 2.8;
const MELEE_HAMMER_SWIPE_REACH = 3.0;
type SwordLungeCurrentTrailStyle = 'localCube' | 'enemyCube' | 'shockwave';

const getCombatBodyCenter = (pos: THREE.Vector3, isCrouching = false): THREE.Vector3 => {
  return new THREE.Vector3(
    pos.x,
    pos.y + (isCrouching ? CROUCH_BODY_CENTER_HEIGHT : BODY_CENTER_HEIGHT),
    pos.z
  );
};

const predictCombatantPosition = (pos: THREE.Vector3, vel?: THREE.Vector3, leadTime = 0): THREE.Vector3 => {
  const predicted = pos.clone();
  if (vel && leadTime > 0) {
    predicted.x += vel.x * leadTime;
    predicted.z += vel.z * leadTime;
    predicted.y += vel.y * leadTime - 0.5 * GRAVITY_ACCELERATION * leadTime * leadTime;
  }
  predicted.y = Math.max(0, predicted.y);
  return predicted;
};

const predictLandingPosition = (pos: THREE.Vector3, vel?: THREE.Vector3, maxLeadTime = 1.25): THREE.Vector3 => {
  if (!vel || (pos.y <= 0.01 && Math.abs(vel.y) < 0.01)) {
    return pos.clone();
  }

  const fallTime = (vel.y + Math.sqrt(Math.max(0, vel.y * vel.y + 2 * GRAVITY_ACCELERATION * Math.max(0, pos.y)))) / GRAVITY_ACCELERATION;
  const leadTime = Math.max(0, Math.min(maxLeadTime, fallTime));
  const landing = pos.clone().addScaledVector(vel, leadTime);
  landing.y = 0;
  return landing;
};

const getCollisionResolvedCameraPos = (
  start: THREE.Vector3,
  end: THREE.Vector3,
  arenaRadius: number,
  objects: CustomMapObject[]
): THREE.Vector3 => {
  let t = 1.0;
  const dir = new THREE.Vector3().subVectors(end, start);
  const length = dir.length();
  if (length < 0.001) return end.clone();

  // 1. Floor collision check (min Y = 0.2m above floor)
  const minY = 0.2;
  if (start.y > minY && end.y < minY) {
    const t_floor = (minY - start.y) / (end.y - start.y);
    if (t_floor >= 0 && t_floor < t) {
      t = t_floor;
    }
  }

  // 2. Arena circular wall check
  const maxCamRadius = Math.max(0.5, arenaRadius - 0.3);
  const startDistSq = start.x * start.x + start.z * start.z;
  const endDistSq = end.x * end.x + end.z * end.z;

  if (startDistSq < maxCamRadius * maxCamRadius && endDistSq > maxCamRadius * maxCamRadius) {
    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (start.x * dir.x + start.z * dir.z);
    const c = start.x * start.x + start.z * start.z - maxCamRadius * maxCamRadius;
    if (a > 0.000001) {
      const disc = b * b - 4 * a * c;
      if (disc >= 0) {
        const u = (-b + Math.sqrt(disc)) / (2 * a);
        if (u >= 0 && u < t) {
          t = u;
        }
      }
    }
  }

  // 3. Custom Map Obstacle Collisions
  const clearance = 0.3;
  for (const obj of objects) {
    if (!obj.isCollidable) continue;

    const scaleX = obj.scale.x;
    const scaleY = obj.scale.y;
    const scaleZ = obj.scale.z;
    const posX = obj.position.x;
    const posY = obj.position.y;
    const posZ = obj.position.z;

    if (obj.type === 'box') {
      const bMinX = posX - scaleX / 2 - clearance;
      const bMaxX = posX + scaleX / 2 + clearance;
      const bMinY = posY - scaleY / 2 - clearance;
      const bMaxY = posY + scaleY / 2 + clearance;
      const bMinZ = posZ - scaleZ / 2 - clearance;
      const bMaxZ = posZ + scaleZ / 2 + clearance;

      let tNear = -Infinity;
      let tFar = Infinity;

      if (Math.abs(dir.x) < 0.000001) {
        if (start.x < bMinX || start.x > bMaxX) continue;
      } else {
        const t1 = (bMinX - start.x) / dir.x;
        const t2 = (bMaxX - start.x) / dir.x;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (Math.abs(dir.y) < 0.000001) {
        if (start.y < bMinY || start.y > bMaxY) continue;
      } else {
        const t1 = (bMinY - start.y) / dir.y;
        const t2 = (bMaxY - start.y) / dir.y;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (Math.abs(dir.z) < 0.000001) {
        if (start.z < bMinZ || start.z > bMaxZ) continue;
      } else {
        const t1 = (bMinZ - start.z) / dir.z;
        const t2 = (bMaxZ - start.z) / dir.z;
        tNear = Math.max(tNear, Math.min(t1, t2));
        tFar = Math.min(tFar, Math.max(t1, t2));
      }

      if (tFar >= tNear && tNear > 0 && tNear < t) {
        t = tNear;
      }
    } else if (obj.type === 'cylinder') {
      const radius = scaleX / 2 + clearance;
      const cMinY = posY - scaleY / 2 - clearance;
      const cMaxY = posY + scaleY / 2 + clearance;

      const dx = start.x - posX;
      const dz = start.z - posZ;
      const a = dir.x * dir.x + dir.z * dir.z;
      const b = 2 * (dx * dir.x + dz * dir.z);
      const c = dx * dx + dz * dz - radius * radius;

      if (a > 0.000001) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const u1 = (-b - Math.sqrt(disc)) / (2 * a);
          if (u1 >= 0 && u1 < t) {
            const intersectY = start.y + u1 * dir.y;
            if (intersectY >= cMinY && intersectY <= cMaxY) {
              t = u1;
            }
          }
        }
      }

      if (Math.abs(dir.y) > 0.000001) {
        const uTop = (cMaxY - start.y) / dir.y;
        if (uTop >= 0 && uTop < t) {
          const ix = start.x + uTop * dir.x;
          const iz = start.z + uTop * dir.z;
          const distSq = (ix - posX) * (ix - posX) + (iz - posZ) * (iz - posZ);
          if (distSq <= radius * radius) t = uTop;
        }

        const uBot = (cMinY - start.y) / dir.y;
        if (uBot >= 0 && uBot < t) {
          const ix = start.x + uBot * dir.x;
          const iz = start.z + uBot * dir.z;
          const distSq = (ix - posX) * (ix - posX) + (iz - posZ) * (iz - posZ);
          if (distSq <= radius * radius) t = uBot;
        }
      }
    } else if (obj.type === 'sphere') {
      const radius = scaleX / 2 + clearance;
      const dx = start.x - posX;
      const dy = start.y - posY;
      const dz = start.z - posZ;

      const a = dir.dot(dir);
      const b = 2 * (dx * dir.x + dy * dir.y + dz * dir.z);
      const c = dx * dx + dy * dy + dz * dz - radius * radius;

      if (a > 0.000001) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const u1 = (-b - Math.sqrt(disc)) / (2 * a);
          if (u1 >= 0 && u1 < t) {
            t = u1;
          }
        }
      }
    }
  }

  // Prevent camera from clipping inside target's head/body (min distance 0.65m)
  const minAllowedT = length > 0.001 ? Math.min(1.0, 0.65 / length) : 1.0;
  const finalT = Math.max(minAllowedT, t);

  return start.clone().addScaledVector(dir, finalT);
};

export const GrifballGame: React.FC<GrifballGameProps> = ({
  isPlaying,
  isPaused,
  debugMode,
  adminSettings,
  onStatsUpdate,
  onPauseToggle,
  isMultiplayer = false,
  multiplayerRole = null,
  multiplayerSocket = null,
  opponentClientId = '',
  opponentPlayerName = '',
  offlineBotCount = 3,
  botDifficulties = {},
  botColors = {},
  botBehaviors = {},
  botWeaponBehaviors = {},
  botArchetypes = {},
  aiPresets = [],
  aiMatchSessionKey = 'sandbox',
  matchKillsToWin,
  keybindings = DEFAULT_KEYBINDINGS,
  deviceInfo,
  forceMobileControls,
  mobileJoystickRef,
  mobileRightJoystickRef,
  mobileRightJoystickActiveRef,
  selectedMap = 'hangar',
  customMap,
  replayData = null,
  onExitReplay,
  playerLoadout,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameplateContainerRef = useRef<HTMLDivElement>(null);

  const getActiveCustomMap = (): CustomMapData | null => {
    if (customMap) return customMap;
    const mapId = replayData ? replayData.mapType : selectedMap;
    if (mapId !== 'hangar' && mapId !== 'circle') {
      const premade = PREMADE_MAPS.find(m => m.id === mapId);
      if (premade) return premade;
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(`map_${mapId}`);
        if (stored) {
          try {
            return JSON.parse(stored);
          } catch (e) {
            console.error("Error parsing local map", e);
          }
        }
      }
    }
    return null;
  };
  // Phase 4: main_ai lives in otherPlayers with controller:'ai' — see roster.ts helpers.
  const requestRef = useRef<number | null>(null);
  const fpsRef = useRef({
    frameCount: 0,
    lastSampleTime: 0,
    value: 0,
  });

  // Replay Recording Refs
  const replayRecordingRef = useRef<ReplayFile | null>(null);
  const lastRecordTimeRef = useRef<number>(0);
  const replayRecordingElapsedTimeRef = useRef<number>(0);
  // Keeps track of the last written tick state for each entity to optimize zero-movement checks
  const lastRecordedStateRef = useRef<Map<string, {
    pos: THREE.Vector3;
    vel: THREE.Vector3;
    yaw: number;
    hp: number;
    activeWeapon: string;
    weaponState: string;
    isCrouching: boolean;
    score: number;
    kills: number;
    deaths: number;
  }>>(new Map());

  // Replay Playback Refs
  const replayTimeRef = useRef<number>(0);
  const replaySpeedRef = useRef<number>(1.0);
  const isReplayPausedRef = useRef<boolean>(false);
  const replayTargetIdRef = useRef<string>('free');
  const prevReplayFrameRef = useRef<ReplayFrame | null>(null);
  const replayPlayerIdsRef = useRef<string[]>([]);

  // Core Game State refs to avoid state-delay in the animation/render loop
  const stateRef = useRef<{
    playerPos: THREE.Vector3;
    playerVel: THREE.Vector3;
    yaw: number;
    pitch: number;
    crouchAmount: number;
    isCrouching: boolean;
    isJumping: boolean;

    // Dash states
    playerDashRemaining: number;
    playerDashDir: THREE.Vector3;
    playerDashCooldownTimer: number;

    // Slide states
    playerSlideActive: boolean;
    playerSlideDistanceTraveled: number;
    playerSlideCooldownTimer: number;
    playerSlideLastPos: THREE.Vector3;

    // Hammer states
    pWeaponState: WeaponState;
    pWeaponTimer: number; // current phase time
    pWeaponCooldown?: number; // define optional cooldown tracking
    pWeaponReady: boolean;

    // Sword & Combat states
    activeWeapon: 'hammer' | 'sword' | 'pistol';
    crosshairColor: 'white' | 'red';
    isLunging: boolean;
    lungeTimer: number;
    lungeStartPos: THREE.Vector3;
    lungeTargetDir: THREE.Vector3;
    pSwordState: 'ready' | 'slashing' | 'recovering';
    pSwordTimer: number;
    pSwordReady: boolean;
    pSwordCooldown: number;
    pSwordRecoverDuration: number;

    // Pistol states
    pPistolState: 'ready' | 'firing' | 'recovering';
    pPistolTimer: number;
    pPistolReady: boolean;
    pPistolCooldown: number;
    lastPlayerSwordAttackTime: number;
    lastPlayerHammerAttackTime: number;
    swapCooldownTimer: number;
    swapCooldownDuration: number;
    swapLockoutTimer: number;

    // Player stats (legacy names bridged to teamScores — see installLegacyTeamScoreBridges)
    playerHP: number;
    playerMaxHP: number;
    teamScores: TeamScoresState;
    localPlayerTeam: TeamId;
    scorePlayer: number;
    scoreEnemy: number;
    playerKills: number;
    playerDeaths: number;
    enemyKills: number;
    enemyDeaths: number;
    showScoreboard: boolean;
    playerRespawnTimer: number;
    enemyRespawnTimer: number;
    playerInvulnerabilityTimer: number;
    playerSpawnTime: number;
    playerLastKillTime: number;
    playerMultikillCount: number;
    playerSpreeCount: number;
    activeMedalPopup: { medal: MedalInfo; key: number } | null;

    // Match timers
    gameTime: number;

    // Checking/Debug UI
    debugMode: boolean;
    lastStrikePos: THREE.Vector3 | null;
    lastStrikeTick: number; // visual timer
    lastAIStrikePos: THREE.Vector3 | null;
    lastAIStrikeTick: number;

    // Hammer Jumping States
    pHammerJumpWindowTimer: number;

    // Arena configs
    arenaRadius: number;
    settings: UniversalSettings;
    lastDeaths: DeathEvent[];

    // Spectator properties
    isObserverMode: boolean;
    observerCamMode: 'free' | 'third' | 'first';
    observerTarget: 'host' | 'client';
    observerOrbitDistance: number;
    hostPos: THREE.Vector3;
    hostVel: THREE.Vector3;
    hostYaw: number;
    hostPitch: number;
    hostHP: number;
    hostMaxHP: number;
    hostIsCrouching: boolean;
    hostActiveWeapon: 'hammer' | 'sword';
    hostRespawnTimer: number;
    hostPlayerName: string;
    hostHue: number;
    clientPos: THREE.Vector3;
    clientVel: THREE.Vector3;
    clientYaw: number;
    clientPitch: number;
    clientHP: number;
    clientMaxHP: number;
    clientIsCrouching: boolean;
    clientActiveWeapon: 'hammer' | 'sword';
    clientRespawnTimer: number;
    clientPlayerName: string;
    clientHue: number;
    otherPlayers: Map<string, Combatant>;
    isMultiplayer: boolean;
    multiplayerRole: 'host' | 'client' | 'observer' | undefined;
    aiMatchContext: AIMatchContext;
  }>({
    playerPos: new THREE.Vector3(0, 0, 12), // Start at z=12
    playerVel: new THREE.Vector3(0, 0, 0),
    yaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, 12)),
    pitch: 0,
    crouchAmount: 0,
    isCrouching: false,
    isJumping: false,
    otherPlayers: new Map<string, Combatant>(),

    // Dash states
    playerDashRemaining: 0,

    playerDashDir: new THREE.Vector3(0, 0, 0),
    playerDashCooldownTimer: 0,

    // Slide states
    playerSlideActive: false,
    playerSlideDistanceTraveled: 0,
    playerSlideCooldownTimer: 0,
    playerSlideLastPos: new THREE.Vector3(0, 0, 0),

    pWeaponState: 'ready',
    pWeaponTimer: 0,
    pWeaponReady: true,

    // Sword & Combat setups
    activeWeapon: 'hammer',
    crosshairColor: 'white',
    isLunging: false,
    lungeTimer: 0,
    lungeStartPos: new THREE.Vector3(),
    lungeTargetDir: new THREE.Vector3(),
    pSwordState: 'ready',
    pSwordTimer: 0,
    pSwordReady: true,
    pSwordCooldown: 1.0,
    pSwordRecoverDuration: 0.6,

    // Pistol states
    pPistolState: 'ready',
    pPistolTimer: 0,
    pPistolReady: true,
    pPistolCooldown: 1.0,
    lastPlayerSwordAttackTime: 0,
    lastPlayerHammerAttackTime: 0,
    swapCooldownTimer: 0,
    swapCooldownDuration: 0,
    swapLockoutTimer: 0,

    playerHP: 1,
    playerMaxHP: 1,
    teamScores: createEmptyTeamScores(),
    localPlayerTeam: localPlayerTeamFromRole(multiplayerRole),
    scorePlayer: 0,
    scoreEnemy: 0,
    playerKills: 0,
    playerDeaths: 0,
    enemyKills: 0,
    enemyDeaths: 0,
    showScoreboard: false,
    playerRespawnTimer: 0,
    enemyRespawnTimer: 0,
    playerInvulnerabilityTimer: 0,
    playerSpawnTime: Date.now(),
    playerLastKillTime: 0,
    playerMultikillCount: 0,
    playerSpreeCount: 0,
    activeMedalPopup: null,

    gameTime: 522, // 8:42 standard starting count (in seconds)

    debugMode: debugMode,
    lastStrikePos: null,
    lastStrikeTick: 0,
    lastAIStrikePos: null,
    lastAIStrikeTick: 0,

    pHammerJumpWindowTimer: 0,

    arenaRadius: 20, // 20m circle
    settings: adminSettings,
    lastDeaths: [],

    isObserverMode: false,
    observerCamMode: 'free',
    observerTarget: 'host',
    observerOrbitDistance: 5.0,
    hostPos: new THREE.Vector3(0, 0, 12),
    hostVel: new THREE.Vector3(0, 0, 0),
    hostYaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, 12)),
    hostPitch: 0,
    hostHP: 1,
    hostMaxHP: 1,
    hostIsCrouching: false,
    hostActiveWeapon: 'hammer',
    hostRespawnTimer: 0,
    hostPlayerName: 'Blue (Host)',
    hostHue: 200,
    clientPos: new THREE.Vector3(0, 0, -12),
    clientVel: new THREE.Vector3(0, 0, 0),
    clientYaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, -12)),
    clientPitch: 0,
    clientHP: 1,
    clientMaxHP: 1,
    clientIsCrouching: false,
    clientActiveWeapon: 'hammer',
    clientRespawnTimer: 0,
    clientPlayerName: 'Red (Guest)',
    clientHue: 200,
    isMultiplayer: isMultiplayer,
    multiplayerRole: multiplayerRole,
    aiMatchContext: createAIMatchContext(),
  });

  installLegacyTeamScoreBridges(stateRef.current);

  /** Offline main AI combatant (roster slot 0). */
  const mai = (): Combatant | undefined => getMainAI(stateRef.current.otherPlayers);

  /** All locally ticked AI combatants in the offline roster. */
  const getRosterAI = (): Combatant[] => getAICombatants(stateRef.current.otherPlayers);

  const rosterCombatant = (id: string): Combatant | undefined =>
    getRosterCombatant(stateRef.current.otherPlayers, id);

  /** Primary opponent for HUD / 1v1 display (main_ai offline, remote online). */
  const opponentDisplay = (): Combatant | undefined =>
    getDisplayOpponent(stateRef.current.otherPlayers, stateRef.current.isMultiplayer, opponentClientId);

  useEffect(() => {
    stateRef.current.localPlayerTeam = localPlayerTeamFromRole(multiplayerRole);
  }, [multiplayerRole]);

  const offlineBotCountRef = useRef(offlineBotCount);
  const botDifficultiesRef = useRef(botDifficulties);
  const botColorsRef = useRef(botColors);
  const botBehaviorsRef = useRef(botBehaviors);
  const botWeaponBehaviorsRef = useRef(botWeaponBehaviors);
  const botArchetypesRef = useRef(botArchetypes);
  useEffect(() => {
    offlineBotCountRef.current = offlineBotCount;
    botDifficultiesRef.current = botDifficulties;
    botColorsRef.current = botColors;
    botBehaviorsRef.current = botBehaviors;
    botWeaponBehaviorsRef.current = botWeaponBehaviors;
    botArchetypesRef.current = botArchetypes;
  }, [offlineBotCount, botDifficulties, botColors, botBehaviors, botWeaponBehaviors, botArchetypes]);

  const recordLocalPlayerObservation = (observe: (model: PlayerModel) => void) => {
    const s = stateRef.current;
    if (s.isObserverMode) return;
    observe(getOrCreatePlayerModel(s.aiMatchContext, LOCAL_PLAYER_ID));
  };

  const recordPlayerLungeEndObservation = (hit: boolean) => {
    const s = stateRef.current;
    const distanceTraveled = s.playerPos.distanceTo(s.lungeStartPos);
    recordLocalPlayerObservation((model) => observePlayerLungeEnd(model, distanceTraveled, hit));
  };

  const recordPlayerDamageTaken = () => {
    recordLocalPlayerObservation((model) => observePlayerDamageReceived(model));
  };

  const recordPlayerDamageDealt = (targetWasCountering: boolean) => {
    recordLocalPlayerObservation((model) => {
      observePlayerDamageDealt(model);
      if (targetWasCountering) {
        observePlayerCounter(model, true);
      }
    });
  };

  const getTargetPlayerModel = (targetId: string) => {
    if (targetId !== LOCAL_PLAYER_ID) return null;
    return getPlayerModelSnapshot(stateRef.current.aiMatchContext, LOCAL_PLAYER_ID);
  };

  const constrainCombatantToArena = (pos: THREE.Vector3, vel?: THREE.Vector3) => {
    const s = stateRef.current;
    const activeCustomMap = getActiveCustomMap();
    const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;

    if (activeCustomMap?.mapShape === 'rectangular') {
      const boundX = radiusToUse * 1.2 - 0.6;
      const boundZ = radiusToUse * 0.6 - 0.6;

      if (Math.abs(pos.x) > boundX) {
        const sign = Math.sign(pos.x);
        pos.x = sign * boundX;
        if (vel && vel.x * sign > 0) {
          vel.x = 0;
        }
      }

      if (Math.abs(pos.z) > boundZ) {
        const sign = Math.sign(pos.z);
        pos.z = sign * boundZ;
        if (vel && vel.z * sign > 0) {
          vel.z = 0;
        }
      }
    } else {
      const maxRadius = Math.max(0, radiusToUse - 0.6);
      const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

      if (distFromCenter > maxRadius && distFromCenter > 0) {
        const normalX = pos.x / distFromCenter;
        const normalZ = pos.z / distFromCenter;
        pos.x = normalX * maxRadius;
        pos.z = normalZ * maxRadius;

        if (vel) {
          const outwardSpeed = vel.x * normalX + vel.z * normalZ;
          if (outwardSpeed > 0) {
            vel.x -= normalX * outwardSpeed;
            vel.z -= normalZ * outwardSpeed;
          }
        }
      }
    }

    if (pos.y < 0) {
      pos.y = 0;
      if (vel && vel.y < 0) {
        vel.y = 0;
      }
    }

    // Resolve Custom Map Obstacle Collisions!
    if (activeCustomMap && activeCustomMap.objects && activeCustomMap.objects.length > 0 && vel) {
      const result = resolveObstacleCollisions(pos, vel, activeCustomMap.objects);
      pos.copy(result.position);
      vel.copy(result.velocity);

      // Handle custom grounding so spartan can stand and jump from objects!
      if (result.grounded) {
        if (pos === s.playerPos) {
          s.isJumping = false;
        } else if (pos === mai()!.pos) {
          mai()!.isJumping = false;
        } else {
          s.otherPlayers.forEach(bot => {
            if (bot.pos === pos) {
              bot.isJumping = false;
            }
          });
        }
      }
    }
  };

  const resolvePlayerCollisions = () => {
    const s = stateRef.current;
    if (s.isObserverMode) return;

    interface ColliderEntity {
      id: string;
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      isCrouching: boolean;
    }

    const colliders: ColliderEntity[] = [];

    // 1. Local Player
    const playerIsDead = s.playerHP <= 0;
    if (!playerIsDead) {
      colliders.push({
        id: 'player',
        pos: s.playerPos,
        vel: s.playerVel,
        isCrouching: !!s.isCrouching,
      });
    }

    // 2. Main AI (offline roster slot 0)
    const mainAiCollider = mai();
    const mainAIDead = !mainAiCollider || mainAiCollider.hp <= 0 || mainAiCollider.aiState === 'RESPAWNING';
    if (mainAiCollider && !mainAIDead && !s.isMultiplayer) {
      colliders.push({
        id: MAIN_AI_ID,
        pos: mainAiCollider.pos,
        vel: mainAiCollider.vel,
        isCrouching: !!mainAiCollider.isCrouching,
      });
    }

    // 3. Other players/bots and remote humans
    if (s.otherPlayers) {
      s.otherPlayers.forEach((bot, id) => {
        if (id === MAIN_AI_ID) return;
        if (bot.hp > 0 && bot.respawnTimer <= 0 && !bot.isObserver && bot.pos && bot.vel) {
          colliders.push({
            id,
            pos: bot.pos,
            vel: bot.vel,
            isCrouching: !!bot.isCrouching,
          });
        }
      });
    }

    if (colliders.length < 2) return;

    const COLLISION_RADIUS = 0.55;
    const MIN_DIST = COLLISION_RADIUS * 2;
    const MIN_DIST_SQ = MIN_DIST * MIN_DIST;
    const ITERATIONS = 3;

    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let i = 0; i < colliders.length; i++) {
        const A = colliders[i];
        for (let j = i + 1; j < colliders.length; j++) {
          const B = colliders[j];

          // Height ranges
          const heightA = A.isCrouching ? 1.2 : 1.8;
          const heightB = B.isCrouching ? 1.2 : 1.8;

          // Vertical overlap check
          const verticalOverlap = (A.pos.y < B.pos.y + heightB) && (B.pos.y < A.pos.y + heightA);
          if (!verticalOverlap) continue;

          // Horizontal distance check
          let dx = B.pos.x - A.pos.x;
          let dz = B.pos.z - A.pos.z;
          const distSq = dx * dx + dz * dz;

          if (distSq < MIN_DIST_SQ) {
            let dist = Math.sqrt(distSq);
            if (dist < 0.001) {
              // Choose a random direction if they are exactly on top of each other
              dx = 0.01;
              dz = 0.0;
              dist = 0.01;
            }

            const overlap = MIN_DIST - dist;
            const nx = dx / dist;
            const nz = dz / dist;

            // Kinematic push-apart (50% each)
            A.pos.x -= nx * overlap * 0.5;
            A.pos.z -= nz * overlap * 0.5;
            B.pos.x += nx * overlap * 0.5;
            B.pos.z += nz * overlap * 0.5;

            // Inelastic velocity response along collision normal
            const rvx = B.vel.x - A.vel.x;
            const rvz = B.vel.z - A.vel.z;
            const velAlongNormal = rvx * nx + rvz * nz;

            if (velAlongNormal < 0) {
              // Cancel relative velocity along collision normal
              const impulseX = nx * velAlongNormal * 0.5;
              const impulseZ = nz * velAlongNormal * 0.5;
              A.vel.x += impulseX;
              A.vel.z += impulseZ;
              B.vel.x -= impulseX;
              B.vel.z -= impulseZ;
            }
          }
        }
      }
    }
  };

  const enforceArenaBounds = () => {
    const s = stateRef.current;

    // First resolve player-to-player and player-to-AI collisions
    resolvePlayerCollisions();

    // Then constrain everyone to the arena bounds
    if (!s.isObserverMode) {
      constrainCombatantToArena(s.playerPos, s.playerVel);
    }

    const mainAiBounds = mai();
    if (mainAiBounds) {
      constrainCombatantToArena(mainAiBounds.pos, mainAiBounds.vel);
    }
    constrainCombatantToArena(s.hostPos, s.hostVel);
    constrainCombatantToArena(s.clientPos, s.clientVel);

    s.otherPlayers?.forEach((other) => {
      if (other.pos && other.vel) {
        constrainCombatantToArena(other.pos, other.vel);
      }
    });

    // Proactively synchronize group positions to visual meshes immediately to eliminate visual rendering lag
    if (s.otherPlayers && threeRef.current.otherPlayerMeshes) {
      s.otherPlayers.forEach((bot, id) => {
        const meshes = threeRef.current.otherPlayerMeshes.get(id);
        if (meshes && meshes.group && bot.pos) {
          meshes.group.position.copy(bot.pos);
        }
      });
    }
    if (s.isMultiplayer) {
      if (s.multiplayerRole === 'observer') {
        if (threeRef.current.enemyGroup) threeRef.current.enemyGroup.position.copy(s.clientPos);
        if (threeRef.current.hostGroup) threeRef.current.hostGroup.position.copy(s.hostPos);
      } else {
        const remote = getPrimaryRemoteOpponent(s.otherPlayers, opponentClientId);
        if (threeRef.current.enemyGroup && remote) {
          threeRef.current.enemyGroup.position.copy(remote.pos);
        }
        if (threeRef.current.hostGroup) threeRef.current.hostGroup.position.copy(s.playerPos);
      }
    }
  };

  const recoverAIFromRunawayAltitude = (pos: THREE.Vector3, vel: THREE.Vector3, botState?: any): boolean =>
    applyAIAltitudeRecovery(pos, vel, botState, {
      maxAirborneHeight: AI_MAX_AIRBORNE_HEIGHT,
      forcedDescentSpeed: AI_FORCED_DESCENT_SPEED,
      hammerJumpCooldown: AI_HAMMER_JUMP_COOLDOWN,
    });

  // Altitude recovery for any AI combatant in the unified in-tick gravity model. Runs the
  // shared clamp/forced-descent (which also resets weaponState/timer + hammer-jump cooldown
  // via `self`), then for the main AI re-asserts its airborne flag and cancels any planned
  // hammer jump — the extra flat-state cleanup the old recoverMainAIFromRunawayAltitude did
  // before the main AI was folded into this path.
  const recoverCombatantAltitude = (self: any, pos: THREE.Vector3, vel: THREE.Vector3): boolean => {
    const recovered = recoverAIFromRunawayAltitude(pos, vel, self);
    if (recovered && self.id === MAIN_AI_ID) {
      self.isJumping = true;
      self.hammerJumpPlanned = false;
      self.hammerJumpType = undefined;
      self.hammerJumpWindowTimer = 0;
    }
    return recovered;
  };

  const getLegacyRosterProps = (): LegacyRosterProps => {
    const names: Record<string, string> = {
      main_ai: opponentPlayerName || 'DoomBot',
    };
    const offlineBotNames = [
      'DoomBot Green',
      'DoomBot Purple',
      'DoomBot Orange',
      'DoomBot Yellow',
      'DoomBot Magenta',
      'DoomBot Cyan',
    ];
    offlineBotNames.forEach((name, i) => {
      names[`bot_${i + 2}`] = name;
    });

    return {
      botDifficulties: botDifficultiesRef.current,
      botBehaviors: botBehaviorsRef.current,
      botWeaponBehaviors: botWeaponBehaviorsRef.current,
      botArchetypes: botArchetypesRef.current,
      botColors: botColorsRef.current,
      botNames: names,
    };
  };

  const resolveRosterSlot = (botId: string) =>
    resolveRosterSlotForCombatant(botId, stateRef.current.settings, getLegacyRosterProps());

  const resolveBotArchetype = (botId: string): string | undefined => {
    const slot = resolveRosterSlot(botId);
    return slot.archetype && slot.archetype !== 'none' ? slot.archetype : undefined;
  };

  const resolveBotKnobs = (botId: string) => {
    const s = stateRef.current;
    return resolveKnobsFromRosterSlot(resolveRosterSlot(botId), aiPresets, s.settings);
  };

  const resolveBotDerived = (botId: string) => {
    const s = stateRef.current;
    return resolveDerivedFromRosterSlot(resolveRosterSlot(botId), aiPresets, s.settings);
  };

  const resolveBotFlags = (botId: string) => {
    const s = stateRef.current;
    const slot = resolveRosterSlot(botId);
    return resolvePersonalityFlags(
      slot.archetype && slot.archetype !== 'none' ? slot.archetype : undefined,
      {
        spacingBand: slot.spacingBand ?? s.settings.aiSpacingBand,
        skipPressure: slot.skipPressure ?? s.settings.aiSkipPressure,
      }
    );
  };

  const getMatchScoreContext = () => {
    const s = stateRef.current;
    return {
      scorePlayer: s.scorePlayer,
      scoreEnemy: s.scoreEnemy,
      killsToWin: matchKillsToWin,
    };
  };

  const getBotPressureAggression = (botId: string): number => {
    const baseAggression = resolveBotDerived(botId).pressureAggression;
    const matchMultipliers = deriveMatchStateMultipliers(
      getMatchScoreContext(),
      baseAggression / 100
    );
    return applyMatchAggression(baseAggression, matchMultipliers);
  };

  const tryEnterPressureState = (
    botId: string,
    targetId: string,
    targetHp: number,
    targetInvuln: number
  ): boolean => {
    const personalityFlags = resolveBotFlags(botId);
    if (personalityFlags.skipPressure) {
      return false;
    }

    const pressureAggression = getBotPressureAggression(botId);
    if (!shouldEnterPressure({ pressureAggression, targetHp, targetInvuln })) {
      return false;
    }

    const s = stateRef.current;
    const duration = getPressureDuration(pressureAggression) *
      deriveMatchStateMultipliers(getMatchScoreContext(), pressureAggression / 100).pressureDurationMult;
    const bot = rosterCombatant(botId);
    if (!bot || bot.controller !== 'ai') return false;
    bot.aiState = 'PRESSURING';
    bot.aiTimer = duration;
    bot.aiPressureTargetId = targetId;
    return true;
  };

  const clearPressureTarget = (botId: string) => {
    const bot = rosterCombatant(botId);
    if (bot) bot.aiPressureTargetId = undefined;
  };

  const tryStartComboOnHit = (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts: { targetRecovering?: boolean } = {}
  ) => {
    const s = stateRef.current;
    if (getBotComboState(s.aiMatchContext, botId)) {
      return;
    }

    const knobs = resolveBotKnobs(botId);
    if (!canUseWeaponCombos(knobs.difficulty, knobs.weaponSwapIQ)) {
      return;
    }

    const candidate = getTacticalTargetById(botId, targetId);
    if (!candidate || candidate.hp <= 0) {
      return;
    }

    const bot = rosterCombatant(botId);
    if (!bot) return;
    const botPos = new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z);

    const dist = botPos.distanceTo(candidate.pos);
    const dangerZone = s.settings.attackRange + s.settings.attackRadius * 0.85;
    const minLungeRange = dangerZone * 0.85;
    const maxLungeRange = Math.min(18.0, s.settings.swordLungeDistance ?? 14.5);

    const comboId = pickComboOnHit({
      difficulty: knobs.difficulty,
      weaponSwapIQ: knobs.weaponSwapIQ,
      weaponPrioritization: knobs.weaponPrioritization,
      openingWeapon,
      distanceToTarget: dist,
      minLungeRange,
      maxLungeRange,
      targetRecovering: opts.targetRecovering ?? candidate.weaponState === 'recovering',
    });

    if (comboId) {
      setBotComboState(s.aiMatchContext, botId, createBotComboState(comboId, targetId));
    }
  };

  const computeVictimSpawnPoint = (victimId: string): THREE.Vector3 => {
    const s = stateRef.current;
    const exclude: THREE.Vector3[] = [];
    if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && victimId !== 'player' && !s.isObserverMode) {
      exclude.push(s.playerPos);
    }
    getRosterAI().forEach((c) => {
      if (c.id !== victimId && c.hp > 0 && (c.respawnTimer ?? 0) <= 0) {
        exclude.push(new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z));
      }
    });
    s.otherPlayers?.forEach((other) => {
      if (other.controller === 'remote' && other.id !== victimId && other.hp > 0 && other.respawnTimer <= 0) {
        exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
      }
    });
    return getOptimalSpawnPoint(exclude);
  };

  const recordBotPsychKill = (botId: string, victimId: string, wasLungeKill: boolean) => {
    const s = stateRef.current;
    const knobs = resolveBotKnobs(botId);
    if (isSkillCalibrationEnabled(knobs.difficulty)) {
      recordCalibrationKill(s.aiMatchContext, botId, performance.now() / 1000);
    }
    const pressureAggression = getBotPressureAggression(botId);
    if (!isPsychPressureEnabled(knobs.difficulty, pressureAggression)) {
      return;
    }
    const spawnPos = computeVictimSpawnPoint(victimId);
    notifyBotKill(getOrCreateBotPsychState(s.aiMatchContext, botId), {
      victimId,
      spawnX: spawnPos.x,
      spawnZ: spawnPos.z,
      lungeKill: wasLungeKill,
    });
    const bot = rosterCombatant(botId);
    if (bot?.controller === 'ai') {
      if (bot.id === MAIN_AI_ID) {
        clearPressureTarget(botId);
      } else {
        bot.aiPressureTargetId = undefined;
        bot.aiState = 'APPROACHING';
      }
    }
  };

  const recordBotCalibrationDeath = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    if (!isSkillCalibrationEnabled(knobs.difficulty)) {
      return;
    }
    recordCalibrationDeath(
      stateRef.current.aiMatchContext,
      botId,
      performance.now() / 1000
    );
  };

  const tryRecordCalibrationCounterSuccess = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    if (!isSkillCalibrationEnabled(knobs.difficulty)) {
      return;
    }
    recordCalibrationCounterSuccess(stateRef.current.aiMatchContext, botId);
  };

  const recordBotDamageTag = (botId: string, targetId: string) => {
    if (isMultiplayer) return;
    notifyBotDamageTag(stateRef.current.aiMatchContext.coordinator, botId, targetId);
  };

  function updateAI(dt: number) {
    const s = stateRef.current;

    if (isMultiplayer) return;
    if (getRosterAI().length === 0) return;

    // Respawn handling for every AI combatant in one loop. Dead combatants hide their
    // mesh and tick respawnTimer; on expiry they respawn via respawnCombatant.
    getRosterAI().forEach((c) => {
      if (c.controller !== 'ai') return;
      const mesh = getCombatantMesh(c.id);
      if (!mesh) return;
      if (c.hp > 0) return;
      mesh.visible = false;
      c.respawnTimer = Math.max(0, (c.respawnTimer ?? 0) - dt);
      if (c.respawnTimer <= 0) {
        respawnCombatant(c, mesh);
      }
    });

    // Unified update dispatch: tick every alive AI combatant through updateSingleAIEntity.
    getRosterAI().forEach((c) => {
      if (c.controller !== 'ai') return;
      const mesh = getCombatantMesh(c.id);
      if (!mesh) return;
      if (c.hp <= 0) return;
      mesh.visible = true;
      updateSingleAIEntity(c.id, dt);
    });
  };

  function updateCharacterSkeletalAnimations(dt: number) {
    const s = stateRef.current;

    if (s.isObserverMode && !replayData) {
      // Animate Host Group (Blue Spartan)
      if (threeRef.current.hostGroup) {
        const hostData = getSpectateTargetData('host');
        const hostVel = multiplayerRole === 'observer' ? s.hostVel : s.playerVel;
        const hostSpeed = hostVel.length();
        let moveForward = 0;
        if (keysPressed.current[keybindingsRef.current.moveForward] || keysPressed.current['arrowup']) moveForward += 1;
        if (keysPressed.current[keybindingsRef.current.moveBackward] || keysPressed.current['arrowdown']) moveForward -= 1;
        
        const isHostSprinting = s.settings.enableSprint && (multiplayerRole === 'observer' ? hostSpeed > 6.0 : keysPressed.current[keybindingsRef.current.sprint] && moveForward > 0 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0);
        const isHostSliding = s.settings.enableSlide && (multiplayerRole === 'observer' ? hostSpeed > 3.0 && hostData.isCrouching : s.playerSlideActive);

        animateSpartanModel(
          threeRef.current.hostGroup,
          hostVel,
          hostData.yaw,
          hostData.hp,
          (multiplayerRole === 'observer' && s.hostActiveWeapon === 'sword') ? 'ready' : s.pWeaponState,
          (multiplayerRole === 'observer') ? 0 : s.pWeaponTimer,
          dt,
          isHostSliding,
          isHostSprinting
        );
      }

      // Animate Client Group (Red Spartan)
      if (threeRef.current.enemyGroup) {
        const clientData = getSpectateTargetData('client');
        const enemyVel = multiplayerRole === 'observer' ? s.clientVel : mai()!.vel;
        const enemySpeed = enemyVel.length();
        const isClientSprinting = s.settings.enableSprint && (multiplayerRole === 'observer' ? enemySpeed > 6.0 : mai()!.aiState === 'APPROACHING' && enemySpeed > 4.5 && !mai()!.isCrouching);
        const isClientSliding = s.settings.enableSlide && (multiplayerRole === 'observer' ? enemySpeed > 3.0 && clientData.isCrouching : mai()!.isCrouching && mai()!.aiState === 'APPROACHING' && enemySpeed > 2.0);

        animateSpartanModel(
          threeRef.current.enemyGroup,
          enemyVel,
          clientData.yaw,
          clientData.hp,
          (multiplayerRole === 'observer' && s.clientActiveWeapon === 'sword') ? 'ready' : mai()!.weaponState,
          (multiplayerRole === 'observer') ? 0 : mai()!.weaponTimer,
          dt,
          isClientSliding,
          isClientSprinting
        );
      }
    }

    // Animate roster combatants (AI + remote) and drive bot weapon impact resolution.
    if (threeRef.current.otherPlayerMeshes && s.otherPlayers) {
      s.otherPlayers.forEach((player, clientId) => {
        const meshes = threeRef.current.otherPlayerMeshes.get(clientId);
        if (meshes && meshes.group) {
          let wState = player.weaponState || 'ready';
          let wTimer = player.weaponTimer || 0;

          // Opponent sword lunge VFX trail
          if (player.isLunging) {
            player.lungeTimer = (player.lungeTimer || 0) + dt;
            const trailPos = new THREE.Vector3(player.pos.x, player.pos.y + 0.825, player.pos.z);
            const trailDir = new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z);
            renderSwordLungeTrailVfx(trailPos, '#ef4444', trailDir, 'shockwave');
            if (player.lungeTimer > 0.8) {
              player.isLunging = false;
            }
          }

          // Swing timing mirrors the player exactly. Sword: split 0.5/0.5 with the hit at
          // mid-swing (end of swing_up), scaling with swordSlashSpeed. Hammer overhead:
          // player-parity 0.28/0.12 with the hit at the slam (end of swing_down). Previously
          // hardcoded 0.15/0.15 with the hit always at swing_down end, ignoring the settings.
          const swingIsSword = player.activeWeapon === 'sword';
          if (wState === 'swing_up') {
            wTimer += dt;
            const windup = swingIsSword ? (s.settings.swordSlashSpeed ?? 0.22) * 0.5 : 0.28;
            if (wTimer >= windup) {
              wState = 'swing_down';
              wTimer = 0;
              // Sword hit lands at mid-swing, like the player's slash.
              if (swingIsSword) applyBotMeleeImpact(clientId);
            }
          } else if (wState === 'swing_down') {
            wTimer += dt;
            const strike = swingIsSword ? (s.settings.swordSlashSpeed ?? 0.22) * 0.5 : 0.12;
            if (wTimer >= strike) {
              wState = 'recovering';
              wTimer = 0;
              // Hammer overhead slams at the end of swing_down, like the player.
              if (!swingIsSword) applyBotMeleeImpact(clientId);
            }
          } else if (wState === 'melee_swing') {
            wTimer += dt;
            const speed = s.settings.hammerMeleeSpeed ?? 0.24;
            if (wTimer >= speed) {
              wState = 'melee_recover';
              wTimer = 0;
              applyBotMeleeImpact(clientId);
            }
          } else if (wState === 'melee_recover') {
            wTimer += dt;
            const reload = s.settings.hammerMeleeReload ?? 0.5;
            if (wTimer >= reload) {
              wState = 'ready';
              wTimer = 0;
            }
          } else if (wState === 'recovering') {
            wTimer += dt;
            // Recovery mirrors the player/main-AI exactly (sword slash → swordSlashReload,
            // hammer overhead → hammerReloadTime). Previously hardcoded 0.3s, which let bots
            // recover in roughly half the configured time and re-swing ~2x faster than the
            // player. Never hardcode this — it must track the gameplay mechanic settings.
            const reload = swingIsSword
              ? (s.settings.swordSlashReload ?? 0.6)
              : (s.settings.hammerReloadTime ?? 0.6);
            if (wTimer >= reload) {
              wState = 'ready';
              wTimer = 0;
            }
          }
          player.weaponState = wState;
          player.weaponTimer = wTimer;

          const pVel = new THREE.Vector3(player.vel.x, player.vel.y, player.vel.z);
          const pSpeed = pVel.length();
          // Bots expose their real sprint/slide state; remote humans fall back to a speed heuristic.
          const isPlayerSprinting = s.settings.enableSprint && (player.aiIsSprinting ?? (pSpeed > 5.5 && !(player.isCrouching || false)));
          const isPlayerSliding = s.settings.enableSlide && (player.aiSlideActive ?? (pSpeed > 2.5 && (player.isCrouching || false)));

          animateSpartanModel(
            meshes.group,
            pVel,
            player.yaw,
            player.hp,
            wState,
            wTimer,
            dt,
            isPlayerSliding,
            isPlayerSprinting
          );

          // Update remote player weapon visibility continuously at 60fps to prevent multiplayer desync
          if (meshes.hammer) {
            meshes.hammer.visible = player.hp > 0 && player.respawnTimer <= 0 && player.activeWeapon === 'hammer';
          }
          if (meshes.sword) {
            meshes.sword.visible = player.hp > 0 && player.respawnTimer <= 0 && player.activeWeapon === 'sword';
          }
          if (meshes.pistol) {
            meshes.pistol.visible = player.hp > 0 && player.respawnTimer <= 0 && player.activeWeapon === 'pistol';
          }
        }
      });
    }
  };

  function spawnBurnDecal(pos: THREE.Vector3, radius: number) {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const decalGeo = new THREE.PlaneGeometry(2, 2);
    decalGeo.rotateX(-Math.PI / 2);

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, 256, 256);

      const coreGrad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
      coreGrad.addColorStop(0, 'rgba(6, 182, 212, 0.45)');
      coreGrad.addColorStop(0.3, 'rgba(56, 189, 248, 0.22)');
      coreGrad.addColorStop(0.7, 'rgba(56, 189, 248, 0.08)');
      coreGrad.addColorStop(0.85, 'rgba(6, 182, 212, 0.6)');
      coreGrad.addColorStop(0.93, 'rgba(255, 255, 255, 0.9)');
      coreGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(128, 128, 124, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(128, 128, 90, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(128, 128, 50, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(6, 182, 212, 0.45)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        const startRad = 20;
        const endRad = 115;
        const xStart = 128 + Math.cos(angle) * startRad;
        const yStart = 128 + Math.sin(angle) * startRad;
        const xEnd = 128 + Math.cos(angle) * endRad;
        const yEnd = 128 + Math.sin(angle) * endRad;
        ctx.beginPath();
        ctx.moveTo(xStart, yStart);
        ctx.lineTo(xEnd, yEnd);
        ctx.stroke();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    const decalMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 1.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    });

    const mesh = new THREE.Mesh(decalGeo, decalMat);
    mesh.position.set(pos.x, 0.012 + Math.random() * 0.005, pos.z);
    mesh.scale.set(radius, 1, radius);

    scene.add(mesh);

    threeRef.current.burnDecals.push({
      mesh,
      life: 0,
      maxLife: 3.5,
    });
  };

  function updateBurnDecals(dt: number) {
    const list = threeRef.current.burnDecals;
    const scene = threeRef.current.scene;
    if (!scene || !list) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life += dt;

      if (d.life >= d.maxLife) {
        scene.remove(d.mesh);
        d.mesh.geometry.dispose();
        if (Array.isArray(d.mesh.material)) {
          d.mesh.material.forEach((m: any) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        } else {
          const m = d.mesh.material as THREE.MeshBasicMaterial;
          if (m.map) m.map.dispose();
          m.dispose();
        }
        list.splice(i, 1);
      } else {
        const ratio = 1.0 - (d.life / d.maxLife);
        const mat = d.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = ratio;
      }
    }
  };

  const playPistolSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.15);
      
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (err) {
      console.error("Failed to play pistol sound:", err);
    }
  };

  function updateTracers(dt: number) {
    const list = threeRef.current.tracers;
    const scene = threeRef.current.scene;
    if (!list || !scene) return;
    
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      t.life += dt;
      if (t.life >= t.maxLife) {
        scene.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.material.dispose();
        list.splice(i, 1);
      } else {
        const ratio = 1.0 - (t.life / t.maxLife);
        if ('opacity' in t.material) {
          t.material.opacity = ratio;
        }
      }
    }
  }

  function updateExplosionParticles(dt: number) {
    const list = threeRef.current.damageExplosionParticles;
    const scene = threeRef.current.scene;

    if (!scene) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      p.life += dt;

      if (p.life >= p.maxLife) {
        // Clean from screen
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        list.splice(i, 1);
      } else {
        // Accelerate downwards (Gravity pulling voxel chunks back to arena)
        p.velocity.y -= 15 * dt;

        // Apply translations
        p.mesh.position.addScaledVector(p.velocity, dt);

        // Voxel shrink size decay
        const ratio = 1.0 - p.life / p.maxLife;
        p.mesh.scale.set(ratio, ratio, ratio);
      }
    }
  };

  function updateHammerSplashFlashes(dt: number) {
    const list = threeRef.current.hammerSplashFlashes;
    const scene = threeRef.current.scene;

    if (!scene) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const flash = list[i];
      flash.life += dt;

      if (flash.life >= flash.maxLife) {
        scene.remove(flash.mesh);
        flash.mesh.geometry.dispose();
        if (Array.isArray(flash.mesh.material)) {
          flash.mesh.material.forEach((m: any) => m.dispose());
        } else {
          flash.mesh.material.dispose();
        }
        list.splice(i, 1);
      } else {
        const pct = flash.life / flash.maxLife;
        const eased = 1 - Math.pow(1 - pct, 3);
        const scale = THREE.MathUtils.lerp(flash.targetRadius * 0.12, flash.targetRadius, eased);
        flash.mesh.scale.setScalar(scale);

        const mat = flash.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.9 * Math.pow(1 - pct, 2);
      }
    }
  };

  function updateSwordLungeSpeedLines(dt: number) {
    const list = threeRef.current.swordLungeSpeedLines;
    const scene = threeRef.current.scene;

    if (!scene) return;

    for (let i = list.length - 1; i >= 0; i--) {
      const line = list[i];
      line.life += dt;

      if (line.life >= line.maxLife) {
        scene.remove(line.mesh);
        line.mesh.geometry.dispose();
        if (Array.isArray(line.mesh.material)) {
          line.mesh.material.forEach((m: any) => m.dispose());
        } else {
          line.mesh.material.dispose();
        }
        list.splice(i, 1);
      } else {
        const pct = line.life / line.maxLife;
        line.mesh.position.addScaledVector(line.drift, dt);
        line.mesh.scale.z = Math.max(0.18, 1 - pct * 0.72);

        const mat = line.mesh.material as THREE.MeshBasicMaterial;
        mat.opacity = line.startOpacity * Math.pow(1 - pct, 1.55);
      }
    }
  };

  function updateMatchTimers(dt: number) {
    const s = stateRef.current;
    
    // Decrement remaining game timer count (08:42 to start)
    s.gameTime -= dt;
    if (s.gameTime < 0) s.gameTime = 0;

    // Decrement trace visuals linger
    if (s.lastStrikeTick > 0) s.lastStrikeTick -= dt * 1.5;
    if (s.lastAIStrikeTick > 0) s.lastAIStrikeTick -= dt * 1.5;

    // Decrement hammer jump windows
    if (s.pHammerJumpWindowTimer > 0) s.pHammerJumpWindowTimer = Math.max(0, s.pHammerJumpWindowTimer - dt);
    if (mai()!.hammerJumpWindowTimer > 0) mai()!.hammerJumpWindowTimer = Math.max(0, mai()!.hammerJumpWindowTimer - dt);

    // Decrement other players' respawn and invulnerability timers
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other) => {
        if (other.respawnTimer > 0) {
          other.respawnTimer = Math.max(0, other.respawnTimer - dt);
        }
        if (other.invulnerabilityTimer > 0) {
          other.invulnerabilityTimer = Math.max(0, other.invulnerabilityTimer - dt);
        }
      });
    }
  };

  function renderGame() {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const renderer = threeRef.current.renderer;
    const scene = threeRef.current.scene;

    if (!camera || !renderer || !scene) return;

    // Smooth FOV interpolation based on sprint and slide states
    const fovNow = performance.now();
    if ((renderGame as any).lastTime === undefined) {
      (renderGame as any).lastTime = fovNow;
    }
    const fovDt = Math.min(0.1, (fovNow - (renderGame as any).lastTime) / 1000);
    (renderGame as any).lastTime = fovNow;

    let targetFov = 75;
    if (!s.isObserverMode && s.playerHP > 0) {
      let moveForward = 0;
      if (keysPressed.current[keybindingsRef.current.moveForward] || keysPressed.current['arrowup']) moveForward += 1;
      if (keysPressed.current[keybindingsRef.current.moveBackward] || keysPressed.current['arrowdown']) moveForward -= 1;
      
      const isSprinting = s.settings.enableSprint && keysPressed.current[keybindingsRef.current.sprint] && moveForward > 0 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0;
      const isSliding = s.settings.enableSlide && s.playerSlideActive;
      
      targetFov = isSprinting ? 86 : (isSliding ? 78 : 75);
    }
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * 8.0 * fovDt;
      camera.updateProjectionMatrix();
    }

    // Update blinking transitions during invulnerability windows
    const blinkCycle = Math.floor(performance.now() / 120) % 2 === 0;

    const updateBlinking = (group: THREE.Group | null, active: boolean) => {
      if (!group) return;
      
      const isAlreadyBlinking = group.userData.isBlinking === true;
      const shouldShowBlink = active && blinkCycle;
      
      if (!active && !isAlreadyBlinking) {
        return;
      }
      
      group.userData.isBlinking = active;
      
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          // Skip general helper meshes
          if (child === threeRef.current.debugPlayerSphere || child === threeRef.current.debugEnemySphere) {
            return;
          }
          
          if (!child.userData.originalMaterial) {
            child.userData.originalMaterial = child.material;
          }
          
          if (shouldShowBlink) {
            child.material = whiteBlinkMaterial;
          } else {
            child.material = child.userData.originalMaterial;
          }
        }
      });
    };

    if (s.isObserverMode && !replayData) {
      const remote = getPrimaryRemoteOpponent(s.otherPlayers, opponentClientId);
      updateBlinking(threeRef.current.enemyGroup, (remote?.invulnerabilityTimer ?? 0) > 0);
    }
    updateBlinking(threeRef.current.playerHammer, s.playerInvulnerabilityTimer > 0);

    if (threeRef.current.otherPlayerMeshes && s.otherPlayers) {
      s.otherPlayers.forEach((player, id) => {
        const meshes = threeRef.current.otherPlayerMeshes.get(id);
        if (meshes && meshes.group) {
          updateBlinking(meshes.group, (player.invulnerabilityTimer || 0) > 0);
        }
      });
    }

    // Manage spectator model visibility to prevent camera head clipping
    if (s.isObserverMode && !replayData) {
      const hostData = getSpectateTargetData('host');
      const clientData = getSpectateTargetData('client');
      
      if (threeRef.current.hostGroup) {
        threeRef.current.hostGroup.visible = (s.observerCamMode !== 'first' || s.observerTarget !== 'host') && (hostData.hp > 0);
        
        // Update host weapons visibility
        const hammer = threeRef.current.hostHammer;
        const sword = threeRef.current.hostSword;
        if (hammer && sword) {
          hammer.visible = hostData.activeWeapon === 'hammer';
          sword.visible = hostData.activeWeapon === 'sword';
        }
      }
      
      if (threeRef.current.enemyGroup) {
        threeRef.current.enemyGroup.visible = (s.observerCamMode !== 'first' || s.observerTarget !== 'client') && (clientData.hp > 0);
        
        // Update client weapons visibility
        const hammer = threeRef.current.enemyHammer;
        const sword = threeRef.current.enemySword;
        if (hammer && sword) {
          hammer.visible = clientData.activeWeapon === 'hammer';
          sword.visible = clientData.activeWeapon === 'sword';
        }
      }
    }

    // Apply Camera transforms based on Observer Mode and Camera Mode settings
    if (!replayData) {
      if (s.isObserverMode) {
        if (s.observerCamMode === 'free') {
          // Free Camera spectator mode
          const lookTarget = new THREE.Vector3(0, 0, -1);
          lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
          lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
          
          camera.position.copy(s.playerPos);
          const centerLookAt = camera.position.clone().add(lookTarget);
          camera.lookAt(centerLookAt);
        } else if (s.observerCamMode === 'third') {
          // Third Person orbital spectator mode
          const targetData = getSpectateTargetData(s.observerTarget);
          const targetEyePos = targetData.pos.clone();
          targetEyePos.y += 1.65 - (targetData.isCrouching ? 0.72 : 0); // Eye height level

          // Compute orbit offset using s.yaw and s.pitch as orbit angles
          const offset = new THREE.Vector3(0, 0, s.observerOrbitDistance);
          offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
          offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

          const cameraPos = targetEyePos.clone().add(offset);
          
          // Resolve wall/obstacle collisions to prevent clipping
          const activeCustomMap = getActiveCustomMap();
          const customMapObjects = (activeCustomMap && activeCustomMap.objects) || [];
          const arenaRadius = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
          const resolvedPos = getCollisionResolvedCameraPos(targetEyePos, cameraPos, arenaRadius, customMapObjects);

          camera.position.copy(resolvedPos);
          camera.lookAt(targetEyePos);
        } else if (s.observerCamMode === 'first') {
          // First Person spectator mode in sync with player being spectated
          const targetData = getSpectateTargetData(s.observerTarget);
          const currentCameraY = 1.65 - (targetData.isCrouching ? 0.72 : 0) + targetData.pos.y;
          camera.position.set(targetData.pos.x, currentCameraY, targetData.pos.z);

          const lookTarget = new THREE.Vector3(0, 0, -1);
          lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), targetData.pitch);
          lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), targetData.yaw);

          const centerLookAt = camera.position.clone().add(lookTarget);
          camera.lookAt(centerLookAt);
        }
      } else {
        // Standard local Player First Person view
        const lookTarget = new THREE.Vector3(0, 0, -1);
        lookTarget.applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch);
        lookTarget.applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
        
        const currentCameraY = 1.65 - s.crouchAmount + s.playerPos.y;
        camera.position.set(s.playerPos.x, currentCameraY, s.playerPos.z);
        
        const centerLookAt = camera.position.clone().add(lookTarget);
        camera.lookAt(centerLookAt);
      }
    }

    // Sync Debug Mode Traces (wireframe red impact zone circles)
    const playerSphere = threeRef.current.debugPlayerSphere;
    if (playerSphere) {
      if (s.debugMode && s.lastStrikePos && s.lastStrikeTick > 0) {
        playerSphere.visible = true;
        playerSphere.position.copy(s.lastStrikePos);
        
        // Pulse ring scale & opacity fading
        const fade = Math.max(0, s.lastStrikeTick);
        const mat = playerSphere.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * 0.45;
        
        // Scale the sphere mesh based on our custom attackRadius versus default radius
        const scaleFactor = s.settings.attackRadius / 4.5;
        playerSphere.scale.setScalar(scaleFactor);
      } else {
        playerSphere.visible = false;
      }
    }

    const enemySphere = threeRef.current.debugEnemySphere;
    if (enemySphere) {
      if (s.debugMode && s.lastAIStrikePos && s.lastAIStrikeTick > 0) {
        enemySphere.visible = true;
        enemySphere.position.copy(s.lastAIStrikePos);
        const fade = Math.max(0, s.lastAIStrikeTick);
        const mat = enemySphere.material as THREE.MeshBasicMaterial;
        mat.opacity = fade * 0.45;
        
        const scaleFactor = s.settings.attackRadius / 4.5;
        enemySphere.scale.setScalar(scaleFactor);
      } else {
        enemySphere.visible = false;
      }
    }

    // Sync Hammer Jump Zone Visualizer
    const jumpZoneMesh = threeRef.current.playerJumpZoneMesh;
    if (jumpZoneMesh) {
      if (s.settings.visualizeJumpZone && s.playerHP > 0) {
        jumpZoneMesh.visible = true;
        // Position flatly on the ground floor beneath player
        jumpZoneMesh.position.set(s.playerPos.x, 0.02, s.playerPos.z);
        // Scale matched perfectly to the trigger radius slider
        const triggerRad = s.settings.hammerJumpTriggerRadius ?? 3.5;
        jumpZoneMesh.scale.set(triggerRad, 1, triggerRad);

        const mat = jumpZoneMesh.material as THREE.MeshBasicMaterial;
        if (s.pHammerJumpWindowTimer > 0) {
          // Inside jump window! Fast bright flashing glow alert
          const flash = 0.6 + Math.sin(performance.now() * 0.016) * 0.25;
          mat.opacity = flash;
          mat.color.setHex(0xfca5a5); // glow warm pinkish/gold for alert highlight
        } else {
          // Neutral state: soft warm aesthetic glow
          const pulse = 0.22 + Math.sin(performance.now() * 0.003) * 0.07;
          mat.opacity = pulse;
          mat.color.setHex(0xf59e0b); // warm amber
        }
      } else {
        jumpZoneMesh.visible = false;
      }
    }

    // Dynamic emissive glow pulsing: pulses visor and weapons in sync
    const elapsed = performance.now() / 1000;
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((mat) => {
          if (
            'emissive' in mat &&
            mat.emissive &&
            ((mat.emissive as THREE.Color).r > 0 ||
              (mat.emissive as THREE.Color).g > 0 ||
              (mat.emissive as THREE.Color).b > 0)
          ) {
            const standardMat = mat as THREE.MeshStandardMaterial;
            // Skip the white blinking material if it's active during invulnerability flashing
            if (mat !== whiteBlinkMaterial) {
              standardMat.emissiveIntensity = 2.0 + Math.sin(elapsed * 4.0) * 0.8;
            }
          }
        });
      }
    });

    // Animate rain particles in Rainy Streets theme if present
    const rainObj = scene.getObjectByName('rain_particles');
    if (rainObj && rainObj instanceof THREE.Points) {
      const rainNow = performance.now();
      if ((renderGame as any).lastRainTime === undefined) {
        (renderGame as any).lastRainTime = rainNow;
      }
      const rainDt = Math.min(0.1, (rainNow - (renderGame as any).lastRainTime) / 1000);
      (renderGame as any).lastRainTime = rainNow;

      const positions = rainObj.geometry.attributes.position.array as Float32Array;
      const velocities = rainObj.userData.velocities;
      const arenaRadius = rainObj.userData.arenaRadius || 20;
      const count = positions.length / 3;

      for (let i = 0; i < count; i++) {
        // Update positions with velocities
        positions[i * 3] += velocities[i].x * rainDt;
        positions[i * 3 + 1] += velocities[i].y * rainDt;
        positions[i * 3 + 2] += velocities[i].z * rainDt;

        // Reset particle if it falls below the floor (y <= 0)
        if (positions[i * 3 + 1] <= 0.05) {
          positions[i * 3] = (Math.random() - 0.5) * arenaRadius * 3;
          positions[i * 3 + 1] = 25; // Reset to top height
          positions[i * 3 + 2] = (Math.random() - 0.5) * arenaRadius * 2;
        }
      }
      rainObj.geometry.attributes.position.needsUpdate = true;
    }

    // Animate snow particles in Winter theme if present
    const snowObj = scene.getObjectByName('snow_particles');
    if (snowObj && snowObj instanceof THREE.Points) {
      const snowNow = performance.now();
      if ((renderGame as any).lastSnowTime === undefined) {
        (renderGame as any).lastSnowTime = snowNow;
      }
      const snowDt = Math.min(0.1, (snowNow - (renderGame as any).lastSnowTime) / 1000);
      (renderGame as any).lastSnowTime = snowNow;

      const positions = snowObj.geometry.attributes.position.array as Float32Array;
      const velocities = snowObj.userData.velocities;
      const arenaRadius = snowObj.userData.arenaRadius || 20;
      const count = positions.length / 3;

      for (let i = 0; i < count; i++) {
        // Update positions with velocities
        positions[i * 3] += velocities[i].x * snowDt;
        positions[i * 3 + 1] += velocities[i].y * snowDt;
        positions[i * 3 + 2] += velocities[i].z * snowDt;

        // Reset particle if it falls below the floor (y <= 0.05) or drifts too far
        if (positions[i * 3 + 1] <= 0.05) {
          positions[i * 3] = (Math.random() - 0.5) * arenaRadius * 3.2;
          positions[i * 3 + 1] = 25; // Reset to top height
          positions[i * 3 + 2] = (Math.random() - 0.5) * arenaRadius * 2.2;
        }
      }
      snowObj.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
  };

  function pushStatsUpdate() {
    const s = stateRef.current;

    // Translate stance string for HUD feedback
    let computedStance: Stance = 'STANDING';
    if (s.isJumping) computedStance = 'JUMPING';
    else if (s.isCrouching) computedStance = 'CROUCHING';

    const opp = opponentDisplay();
    onStatsUpdateRef.current({
      playerHP: s.playerHP,
      playerMaxHP: s.playerMaxHP,
      enemyHP: opp?.hp ?? 0,
      enemyMaxHP: opp?.maxHp ?? s.settings.maxHP,
      scorePlayer: s.scorePlayer,
      scoreEnemy: s.scoreEnemy,
      otherPlayers: s.otherPlayers ? Array.from(s.otherPlayers.values())
        .filter((p: Combatant) => p.id !== MAIN_AI_ID)
        .map((p: Combatant) => ({
        id: p.id,
        playerName: p.playerName,
        pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
        vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
        yaw: p.yaw,
        pitch: p.pitch,
        hp: p.hp,
        maxHp: p.maxHp,
        isCrouching: p.isCrouching,
        activeWeapon: p.activeWeapon,
        respawnTimer: p.respawnTimer,
        hue: p.hue,
        score: p.score ?? 0,
        kills: p.kills ?? 0,
        deaths: p.deaths ?? 0,
        isObserver: p.isObserver
      })) : undefined,
      gameTime: s.gameTime,
      debugMode: s.debugMode,
      debugDamageRadius: s.settings.attackRadius, // Show actual damage radius
      weaponReady: s.activeWeapon === 'hammer' 
        ? s.pWeaponReady 
        : s.activeWeapon === 'pistol' 
          ? s.pPistolReady 
          : s.pSwordReady,
      weaponCooldown: s.activeWeapon === 'hammer' 
        ? (s.pWeaponCooldown ?? 1.0) 
        : s.activeWeapon === 'pistol' 
          ? s.pPistolCooldown 
          : s.pSwordCooldown,
      activeWeapon: s.activeWeapon,
      crosshairColor: s.crosshairColor,
      lastStrikePos: s.lastStrikePos ? [s.lastStrikePos.x, s.lastStrikePos.y, s.lastStrikePos.z] : null,
      lastStrikeTick: s.lastStrikeTick,
      isCrouching: s.isCrouching,
      isJumping: s.isJumping,
      playerRespawnTimer: s.playerHP <= 0 ? s.playerRespawnTimer : 0,
      enemyRespawnTimer: (opp?.hp ?? 0) <= 0 ? s.enemyRespawnTimer : 0,
      playerDashCooldownTimer: s.playerDashCooldownTimer,
      playerDashReady: s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0,
      settings: s.settings, // Propagate the current admin settings to HUD
      lastDeaths: [...s.lastDeaths],
      playerX: s.playerPos.x,
      playerZ: s.playerPos.z,
      playerYaw: s.yaw,
      enemyX: opp?.pos.x ?? 0,
      enemyZ: opp?.pos.z ?? 0,
      enemyYaw: opp?.yaw ?? 0,
      enemyIsCrouching: opp?.isCrouching ?? false,
      playerIsCrouchMoving: s.isCrouching && s.playerVel.length() > 0.15,
      enemyIsCrouchMoving: (opp?.isCrouching ?? false) && ((opp?.vel.length() ?? 0) > 0.15),
      isMultiplayer: isMultiplayer,
      multiplayerRole: multiplayerRole,
      opponentConnected: isMultiplayer && multiplayerSocket?.readyState === WebSocket.OPEN,
      fps: fpsRef.current.value,
      showScoreboard: s.showScoreboard,
      isObserverMode: s.isObserverMode,
      observerCamMode: s.observerCamMode,
      observerTargetName: getSpectateTargetData(s.observerTarget).name,
      observerTargetRole: s.observerTarget,
      playerKills: s.playerKills,
      playerDeaths: s.playerDeaths,
      enemyKills: s.enemyKills,
      enemyDeaths: s.enemyDeaths,
      opponentPlayerName: opponentNameRef.current || mai()?.playerName || undefined,
      activeMedalPopup: s.activeMedalPopup,
    });
  };

  function updateFloatingNameplate() {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const container = containerRef.current;
    const nameplateContainer = nameplateContainerRef.current;

    if (!s || !camera || !container || !nameplateContainer) return;

    const pool = nameplatePoolRef.current;
    const activeIds = new Set<string>();

    if (s.playerHP > 0) {
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );

      const appDist = s.settings.nameVisibilityDistance !== undefined ? s.settings.nameVisibilityDistance : 15.0;

      s.otherPlayers.forEach((combatant, id) => {
        if (combatant.hp <= 0 || (combatant.respawnTimer ?? 0) > 0 || combatant.aiState === 'RESPAWNING') return;

        const enemyPos = combatant.pos;
        const enemyCenter = new THREE.Vector3(enemyPos.x, enemyPos.y + 0.825, enemyPos.z);
        const toEnemy = enemyCenter.clone().sub(eyePos);
        const dist = toEnemy.length();

        if (dist <= appDist) {
          const toEnemyDir = toEnemy.clone().normalize();
          
          const cameraLookDir = new THREE.Vector3(0, 0, -1)
            .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
            .normalize();
            
          const dot = cameraLookDir.dot(toEnemyDir);
          const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
          
          // Holding crosshair over them
          if (angle < 0.12) {
            // Calculate projected 2D coordinates
            const headPos = new THREE.Vector3(enemyPos.x, enemyPos.y + 1.75, enemyPos.z);
            headPos.project(camera);
            
            // Check if in front of camera
            if (headPos.z <= 1) {
              const widthHalf = container.clientWidth / 2;
              const heightHalf = container.clientHeight / 2;
              const screenX = (headPos.x * widthHalf) + widthHalf;
              const screenY = -(headPos.y * heightHalf) + heightHalf;

              let plate = pool.get(id);
              if (!plate) {
                plate = document.createElement('div');
                plate.style.position = 'absolute';
                plate.style.transform = 'translate(-50%, -100%)';
                plate.style.fontWeight = 'black';
                plate.style.fontFamily = 'monospace';
                plate.style.pointerEvents = 'none';
                plate.style.textShadow = '0 0 4px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.5)';
                plate.style.zIndex = '10';
                plate.style.whiteSpace = 'nowrap';
                plate.style.transition = 'color 0.15s, font-size 0.15s, opacity 0.15s';
                nameplateContainer.appendChild(plate);
                pool.set(id, plate);
              }

              // Re-attach if detached (e.g. after React full re-render)
              if (plate.parentElement !== nameplateContainer) {
                nameplateContainer.appendChild(plate);
              }

              // Set styles
              plate.style.display = 'block';
              plate.style.left = `${screenX}px`;
              plate.style.top = `${screenY}px`;
              plate.style.color = s.settings.nameVisibilityColor || '#00ffff';
              plate.style.opacity = (s.settings.nameVisibilityOpacity !== undefined ? s.settings.nameVisibilityOpacity : 0.8).toString();
              plate.style.fontSize = `${s.settings.nameVisibilityFontSize || 16}px`;

              // Get actual display name
              let name = combatant.playerName;
              if (id === MAIN_AI_ID && !isMultiplayer) {
                name = opponentPlayerName || opponentNameRef.current || combatant.playerName || 'DoomBot';
              }
              plate.textContent = name;
              activeIds.add(id);
            }
          }
        }
      });
    }

    // Hide all plates not active
    pool.forEach((plate, id) => {
      if (!activeIds.has(id)) {
        plate.style.display = 'none';
      }
    });
  };

  function updateRadarDOM() {
    const s = stateRef.current;
    if (!s) return;

    const isPlayerAlive = s.playerHP > 0;

    // 1. Compass Rotation — use transform:translate (GPU-composited, no layout thrash, no transition lag)
    const nElem = document.getElementById('radar-compass-n');
    const eElem = document.getElementById('radar-compass-e');
    const sElem = document.getElementById('radar-compass-s');
    const wElem = document.getElementById('radar-compass-w');

    if (nElem || eElem || sElem || wElem) {
      const cosYaw = Math.cos(s.yaw);
      const sinYaw = Math.sin(s.yaw);
      const r = 58;
      const center = 72;

      if (nElem) nElem.style.transform = `translate(${center + r * sinYaw - 3.5}px, ${center - r * cosYaw - 5}px)`;
      if (eElem) eElem.style.transform = `translate(${center + r * cosYaw - 3.5}px, ${center + r * sinYaw - 5}px)`;
      if (sElem) sElem.style.transform = `translate(${center - r * sinYaw - 3.5}px, ${center + r * cosYaw - 5}px)`;
      if (wElem) wElem.style.transform = `translate(${center - r * cosYaw - 3.5}px, ${center - r * sinYaw - 5}px)`;
    }

    // 2. Multi-enemy dot rendering with element pooling
    const enemiesContainer = document.getElementById('radar-enemies-container');
    if (enemiesContainer) {
      const maxRange = 25;
      const radarRadius = 72;
      const scale = radarRadius / maxRange;
      const forward_x = -Math.sin(s.yaw);
      const forward_z = -Math.cos(s.yaw);
      const right_x = Math.cos(s.yaw);
      const right_z = -Math.sin(s.yaw);

      // Build the full enemy list: main AI + all otherPlayers bots
      type RadarEnemy = { id: string; pos: THREE.Vector3; hp: number; vel: THREE.Vector3 | null; isCrouching: boolean };
      const enemies: RadarEnemy[] = [];
      if (!s.isMultiplayer) {
        enemies.push({ id: 'main_ai', pos: mai()!.pos, hp: mai()!.hp, vel: mai()!.vel, isCrouching: mai()!.isCrouching });
        s.otherPlayers.forEach((bot, id) => {
          enemies.push({ id, pos: bot.pos, hp: bot.hp, vel: bot.vel, isCrouching: bot.isCrouching });
        });
      } else {
        s.otherPlayers.forEach((player, id) => {
          enemies.push({ id, pos: player.pos, hp: player.hp, vel: player.vel, isCrouching: player.isCrouching || false });
        });
      }

      const pool = radarDotPoolRef.current;
      const activeIds = new Set<string>();

      for (const enemy of enemies) {
        if (!isPlayerAlive || enemy.hp <= 0) continue;

        const dx = enemy.pos.x - s.playerPos.x;
        const dz = enemy.pos.z - s.playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        const velLength = enemy.vel ? enemy.vel.length() : 0;
        const isCrouchMoving = enemy.isCrouching && velLength > 0.15;
        if (isCrouchMoving || dist > maxRange) continue;

        const local_x = dx * right_x + dz * right_z;
        const local_y = dx * forward_x + dz * forward_z;
        const ex = local_x * scale;
        const ey = -local_y * scale;
        const left = radarRadius + ex - 6;
        const top = radarRadius + ey - 6;

        let dot = pool.get(enemy.id);
        if (!dot) {
          dot = document.createElement('div');
          dot.className = 'absolute w-3 h-3 bg-red-500 rounded-full border border-white/40 shadow-[0_0_12px_#ef4444] animate-pulse z-30 flex items-center justify-center';
          dot.style.willChange = 'transform';
          const inner = document.createElement('div');
          inner.className = 'w-1.5 h-1.5 bg-white rounded-full';
          dot.appendChild(inner);
          pool.set(enemy.id, dot);
        }
        // Re-append if detached (happens when React re-renders the container after e.g. escape menu)
        if (dot.parentElement !== enemiesContainer) {
          enemiesContainer.appendChild(dot);
        }

        // Use transform:translate for GPU-composited, zero-layout positioning
        dot.style.transform = `translate(${left}px, ${top}px)`;
        dot.style.display = 'flex';
        activeIds.add(enemy.id);
      }

      // Hide dots for enemies that are dead, out of range, or no longer in the game
      pool.forEach((dot, id) => {
        if (!activeIds.has(id)) dot.style.display = 'none';
      });
    }

    // 3. Update center player arrow visibility and crouch-cloaking styles
    const playerArrow = document.getElementById('radar-player-arrow');
    if (playerArrow) {
      if (!isPlayerAlive) {
        playerArrow.style.display = 'none';
      } else {
        playerArrow.style.display = 'block';
        const playerVelLength = s.playerVel ? s.playerVel.length() : 0;
        const playerIsCrouchMoving = s.isCrouching && playerVelLength > 0.15;

        if (playerIsCrouchMoving) {
          playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-white/20 z-20');
          playerArrow.setAttribute('fill', 'none');
          playerArrow.setAttribute('stroke', 'currentColor');
          playerArrow.setAttribute('stroke-width', '2');
        } else {
          playerArrow.setAttribute('class', 'absolute w-3.5 h-3.5 text-[#22d3ee] drop-shadow-[0_0_4px_rgba(34,211,238,0.7)] z-20');
          playerArrow.setAttribute('fill', 'currentColor');
          playerArrow.removeAttribute('stroke');
          playerArrow.removeAttribute('stroke-width');
        }
      }
    }

    // 4. Update status indicator badges and text node names
    const badgeText = document.getElementById('radar-status-text');
    const badgeContainer = document.getElementById('radar-status-badge');
    if (badgeText && badgeContainer) {
      const playerVelLength = s.playerVel ? s.playerVel.length() : 0;
      const playerIsCrouchMoving = s.isCrouching && playerVelLength > 0.15;

      if (!isPlayerAlive) {
        badgeText.textContent = 'OFFLINE';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-slate-900/40 text-slate-500 border-slate-500/20';
      } else if (playerIsCrouchMoving) {
        badgeText.textContent = 'SIGNAL STEALTH';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-amber-950/40 text-amber-400 border-amber-500/20';
      } else {
        badgeText.textContent = 'ACTIVE';
        badgeContainer.className = 'text-[8px] font-mono font-bold px-1.5 py-0.5 rounded border bg-cyan-950/40 text-cyan-400 border-cyan-500/20';
      }
    }
  };

  const spawnFrictionSparkParticle = (pos: THREE.Vector3) => {
    const scene = threeRef.current.scene;
    if (!scene) return;
    const voxelGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'), // cyanish friction glow
    });
    const cube = new THREE.Mesh(voxelGeo, mat);
    cube.position.copy(pos);
    cube.position.y += 0.05; // close to floor
    cube.position.x += (Math.random() - 0.5) * 0.4;
    cube.position.z += (Math.random() - 0.5) * 0.4;

    const particle = {
      mesh: cube,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 2 + 1, (Math.random() - 0.5) * 2),
      life: 0,
      maxLife: 0.4,
    };
    scene.add(cube);
    threeRef.current.damageExplosionParticles.push(particle as any);
  };

  const spawnSprintDustParticle = (pos: THREE.Vector3) => {
    const scene = threeRef.current.scene;
    if (!scene) return;
    const voxelGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#e2e8f0'), // white dust cloud
      transparent: true,
      opacity: 0.6,
    });
    const cube = new THREE.Mesh(voxelGeo, mat);
    cube.position.copy(pos);
    cube.position.y += 0.05; // close to floor

    const particle = {
      mesh: cube,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1, Math.random() * 0.5 + 0.2, (Math.random() - 0.5) * 1),
      life: 0,
      maxLife: 0.5,
    };
    scene.add(cube);
    threeRef.current.damageExplosionParticles.push(particle as any);
  };

  function animateSpartanModel(
    mesh: THREE.Group | null,
    vel: THREE.Vector3,
    yaw: number,
    hp: number,
    weaponState: string,
    weaponTimer: number,
    dt: number,
    isSliding = false,
    isSprinting = false
  ) {
    if (!mesh) return;

    const lowerTorso = mesh.userData.lowerTorso as THREE.Group | undefined;
    const upperTorso = mesh.userData.upperTorso as THREE.Group | undefined;
    const leftLeg = mesh.userData.leftLeg as THREE.Group | undefined;
    const rightLeg = mesh.userData.rightLeg as THREE.Group | undefined;

    if (!lowerTorso || !upperTorso || !leftLeg || !rightLeg) return;

    // 1. Dynamic Feet & Leg Walk-Sprint Cycles
    const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

    if (hp > 0) {
      if (isSliding) {
        // Sliding pose: droop torso low, lean torso back, slide legs forward
        lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, -0.48, dt * 10.0);
        lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, -0.24, dt * 10.0);

        leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, -1.2, dt * 10.0);
        rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, -0.9, dt * 10.0);
        leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, -0.12, dt * 10.0);
        rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0.12, dt * 10.0);

        if (Math.random() < 0.28) {
          spawnFrictionSparkParticle(mesh.position);
        }
      } else if (isSprinting && speed > 0.15) {
        // Sprinting pose: lean torso forward, fast high-frequency leg cycle
        lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0.28, dt * 10.0);

        if (mesh.userData.walkPhase === undefined) {
          mesh.userData.walkPhase = 0;
        }

        const frequency = 8.5 * (speed / 5.8);
        mesh.userData.walkPhase += dt * frequency * Math.PI * 2;

        const phase = mesh.userData.walkPhase;
        const maxSwing = 0.68; // wider swing when sprinting

        leftLeg.rotation.x = Math.sin(phase) * maxSwing;
        rightLeg.rotation.x = -Math.sin(phase) * maxSwing;
        leftLeg.rotation.z = Math.cos(phase) * 0.06;
        rightLeg.rotation.z = -Math.cos(phase) * 0.06;

        const bobAmount = Math.abs(Math.sin(phase)) * 0.05;
        lowerTorso.position.y = -bobAmount;

        if (Math.random() < 0.18) {
          const footPos = mesh.position.clone();
          footPos.x += (Math.random() - 0.5) * 0.3;
          footPos.z += (Math.random() - 0.5) * 0.3;
          spawnSprintDustParticle(footPos);
        }
      } else if (speed > 0.15) {
        // Standard walk cycle
        lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0, dt * 10.0);

        if (mesh.userData.walkPhase === undefined) {
          mesh.userData.walkPhase = 0;
        }

        const frequency = 5.2 * (speed / 4.0);
        mesh.userData.walkPhase += dt * frequency * Math.PI * 2;

        const phase = mesh.userData.walkPhase;
        const maxSwing = 0.52; // max leg angle (~30 degrees)

        leftLeg.rotation.x = Math.sin(phase) * maxSwing;
        rightLeg.rotation.x = -Math.sin(phase) * maxSwing;
        leftLeg.rotation.z = Math.cos(phase) * 0.05;
        rightLeg.rotation.z = -Math.cos(phase) * 0.05;

        const bobAmount = Math.abs(Math.sin(phase)) * 0.04;
        lowerTorso.position.y = -bobAmount;
      } else {
        // Standing neutral
        lowerTorso.rotation.x = THREE.MathUtils.lerp(lowerTorso.rotation.x, 0, dt * 10.0);
        leftLeg.rotation.x = THREE.MathUtils.lerp(leftLeg.rotation.x, 0, dt * 10.0);
        leftLeg.rotation.z = THREE.MathUtils.lerp(leftLeg.rotation.z, 0, dt * 10.0);
        rightLeg.rotation.x = THREE.MathUtils.lerp(rightLeg.rotation.x, 0, dt * 10.0);
        rightLeg.rotation.z = THREE.MathUtils.lerp(rightLeg.rotation.z, 0, dt * 10.0);
        lowerTorso.position.y = THREE.MathUtils.lerp(lowerTorso.position.y, 0, dt * 10.0);
        mesh.userData.walkPhase = 0;
      }
    } else {
      // Dead pose
      lowerTorso.rotation.x = 0;
      leftLeg.rotation.x = 0;
      leftLeg.rotation.z = 0;
      rightLeg.rotation.x = 0;
      rightLeg.rotation.z = 0;
      lowerTorso.position.y = 0;
    }

    // 2. Cohesion Lower Torso Directional Rotation
    let targetLowerTorsoYaw = 0;
    if (speed > 0.15 && hp > 0) {
      const moveYaw = Math.atan2(vel.x, vel.z);
      let diff = moveYaw - yaw;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));

      const maxTwist = Math.PI / 3;
      if (Math.abs(diff) > maxTwist) {
        targetLowerTorsoYaw = Math.sign(diff) * maxTwist;
      } else {
        targetLowerTorsoYaw = diff;
      }
    }

    lowerTorso.rotation.y = THREE.MathUtils.lerp(
      lowerTorso.rotation.y,
      targetLowerTorsoYaw,
      dt * 9.0
    );

    // 3. Cohesion Upper Torso (Aiming & Shoulder weapon swing twists)
    let targetUpperTorsoYaw = 0;
    let targetUpperTorsoPitch = 0;
    let targetUpperTorsoRoll = 0;

    if (hp > 0) {
      if (weaponState === 'swing_up') {
        targetUpperTorsoYaw = -0.32;
        targetUpperTorsoPitch = -0.12;
      } else if (weaponState === 'swing_down') {
        targetUpperTorsoYaw = 0.42;
        targetUpperTorsoPitch = 0.22;
        targetUpperTorsoRoll = -0.08;
      } else if (weaponState === 'recovering') {
        const recoveryDuration = stateRef.current.settings.hammerReloadTime ?? 0.6;
        const recoveredPct = Math.min(1.0, weaponTimer / recoveryDuration);
        targetUpperTorsoYaw = THREE.MathUtils.lerp(0.42, 0, recoveredPct);
        targetUpperTorsoPitch = THREE.MathUtils.lerp(0.22, 0, recoveredPct);
      } else if (weaponState === 'melee_swing' || weaponState === 'melee_up') {
        targetUpperTorsoYaw = 0.5;
        targetUpperTorsoPitch = 0.05;
        targetUpperTorsoRoll = 0.1;
      } else if (weaponState === 'melee_recover' || weaponState === 'melee_down') {
        const recoveryDuration = stateRef.current.settings.hammerMeleeReload ?? 0.5;
        const recoveredPct = Math.min(1.0, weaponTimer / recoveryDuration);
        targetUpperTorsoYaw = THREE.MathUtils.lerp(0.5, 0, recoveredPct);
        targetUpperTorsoPitch = THREE.MathUtils.lerp(0.05, 0, recoveredPct);
        targetUpperTorsoRoll = THREE.MathUtils.lerp(0.1, 0, recoveredPct);
      }
    }

    upperTorso.rotation.y = THREE.MathUtils.lerp(upperTorso.rotation.y, targetUpperTorsoYaw, dt * 10.0);
    upperTorso.rotation.x = THREE.MathUtils.lerp(upperTorso.rotation.x, targetUpperTorsoPitch, dt * 10.0);
    upperTorso.rotation.z = THREE.MathUtils.lerp(upperTorso.rotation.z, targetUpperTorsoRoll, dt * 10.0);
  };















  // Keep debug mode ref in sync
  useEffect(() => {
    stateRef.current.debugMode = debugMode;
  }, [debugMode]);

  // Handle multiplayer game synchronization logic
  useEffect(() => {
    const s = stateRef.current;
    s.isObserverMode = (multiplayerRole === 'observer') || !!replayData;

    // Clean up or configure first person weapons
    if (s.isObserverMode) {
      if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = false;
      if (threeRef.current.playerSword) threeRef.current.playerSword.visible = false;
      
      // Default observer vantage point overlooking the center of the arena
      s.playerPos.set(0, 6, 17);
      s.yaw = getInwardSpawnYaw(s.playerPos);
      s.pitch = -0.3;
    } else {
      if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = s.activeWeapon === 'hammer';
      if (threeRef.current.playerSword) threeRef.current.playerSword.visible = s.activeWeapon === 'sword';
      
      // Remove hostGroup if transitioning back to active player
      const scene = threeRef.current.scene;
      if (scene && threeRef.current.hostGroup) {
        scene.remove(threeRef.current.hostGroup);
        threeRef.current.hostGroup = null;
      }
    }

    if (isMultiplayer) {
      removeMainAIFromRoster(s.otherPlayers);
      if (multiplayerRole === 'client') {
        s.playerPos.set(0, 0, -12);
        s.yaw = getInwardSpawnYaw(s.playerPos);
      } else if (multiplayerRole === 'host') {
        s.playerPos.set(0, 0, 12);
        s.yaw = getInwardSpawnYaw(s.playerPos);
      }
    }

    if (isMultiplayer && multiplayerSocket) {
      const handleWsMessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const s = stateRef.current;

          if (data.type === 'connected') {
            if (data.otherPlayerIds && Array.isArray(data.otherPlayerIds)) {
              data.otherPlayerIds.forEach((id: string) => {
                if (id !== data.clientClientId) {
                  createOrUpdateRemotePlayer(id, { hp: 1 });
                }
              });
              resizeArena(1 + s.otherPlayers.size);
              pushStatsUpdate();
            }
          } else if (data.type === 'player_joined') {
            createOrUpdateRemotePlayer(data.clientId, data);
            resizeArena(1 + s.otherPlayers.size);
            pushStatsUpdate();
          } else if (data.type === 'player_left') {
            const scene = threeRef.current.scene;
            const clientId = data.leftPlayerId;
            if (s.otherPlayers.has(clientId)) {
              s.otherPlayers.delete(clientId);
            }
            const meshes = threeRef.current.otherPlayerMeshes.get(clientId);
            if (meshes) {
              if (scene && meshes.group) {
                scene.remove(meshes.group);
              }
              threeRef.current.otherPlayerMeshes.delete(clientId);
            }
            resizeArena(1 + s.otherPlayers.size);
            pushStatsUpdate();
          } else if (data.type === 'sync') {
            if (data.action === 'unlock_secret') {
              if (secretAudioRef.current) {
                secretAudioRef.current.pause();
              }
              const audio = new Audio('/Saudi Smurf Allah.mp3');
              audio.volume = 0.55;
              audio.play().catch(e => console.error("Error playing secret song:", e));
              secretAudioRef.current = audio;

              if (data.senderId && s.otherPlayers.has(data.senderId)) {
                const p = s.otherPlayers.get(data.senderId);
                if (p) {
                  p.activeWeapon = 'pistol';
                  const meshes = threeRef.current.otherPlayerMeshes.get(data.senderId);
                  if (meshes) {
                    meshes.hammer.visible = false;
                    meshes.sword.visible = false;
                  }
                  const announcement: DeathEvent = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: "SECRET UNLOCKED",
                    victim: `${p.playerName || 'Blue'} equipped GRIFB Pistol!`,
                    weapon: 'sword'
                  };
                  s.lastDeaths = [announcement, ...s.lastDeaths].slice(0, 3);
                  spawnVoxelShockwaveParticles(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), '#38bdf8');
                  spawnVoxelShockwaveParticles(new THREE.Vector3(p.pos.x, p.pos.y, p.pos.z), '#fffa00');
                }
              }
              pushStatsUpdate();
            }
            else if (data.action === 'swing_hammer') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'swing_up';
                  player.weaponTimer = 0;
                  player.lastHammerAttackTime = Date.now();
                  sfx.playSwing();
                }
              } else {
                triggerEnemyHammerSwing();
              }
            } else if (data.action === 'melee_hammer') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'melee_swing';
                  player.weaponTimer = 0;
                  player.lastHammerAttackTime = Date.now();
                  sfx.playSwing();

                  const lookHeading = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).normalize();
                  const eyePos = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
                  const meleePos = eyePos.clone().addScaledVector(lookHeading, 1.8);
                  spawnVoxelShockwaveParticles(meleePos, '#38bdf8');
                }
              } else {
                triggerEnemyHammerMelee();
              }
            } else if (data.action === 'hammer_impact') {
              if (data.pos) {
                const impactPos = new THREE.Vector3(
                  Number(data.pos.x) || 0,
                  Number(data.pos.y) || 0,
                  Number(data.pos.z) || 0
                );
                const radius = typeof data.radius === 'number' ? data.radius : (s.settings.attackRadius ?? 4.5);
                renderHammerSplashVfx(impactPos, '#f97316', radius);
              }
            } else if (data.action === 'slash_sword') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'swing_up';
                  player.weaponTimer = 0;
                  player.lastSwordAttackTime = Date.now();
                  sfx.playSwing();
                  
                  // Spawn red slash energy burst VFX for opposing players
                  const lookHeading = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw).normalize();
                  const eyePos = new THREE.Vector3(player.pos.x, player.pos.y + 1.2, player.pos.z);
                  const slashPos = eyePos.clone().addScaledVector(lookHeading, 1.8);
                  
                  spawnVoxelShockwaveParticles(slashPos, '#ef4444'); // Red slash energy burst!
                }
              } else {
                triggerEnemySwordSlash();
              }
            } else if (data.action === 'lunge_sword') {
              if (data.senderId) {
                const player = s.otherPlayers.get(data.senderId);
                if (player) {
                  player.weaponState = 'ready';
                  player.weaponTimer = 0;
                  player.isLunging = true;
                  player.lungeTimer = 0;
                  player.lastSwordAttackTime = Date.now();
                  sfx.playDash();
                }
              } else {
                const lungeDir = data.dir ? new THREE.Vector3(data.dir.x, data.dir.y, data.dir.z) : undefined;
                triggerEnemySwordLunge(lungeDir);
              }
            } else if (data.action === 'hit_taken') {
              // Differentiate target
              if (data.targetId && s.otherPlayers.has(data.targetId)) {
                const targetPlayer = s.otherPlayers.get(data.targetId);
                if (targetPlayer) {
                  targetPlayer.hp = Math.max(0, targetPlayer.hp - (data.damage || 1));
                  if (targetPlayer.hp <= 0) {
                    targetPlayer.hp = 0;
                    targetPlayer.respawnTimer = 3.0;
                    targetPlayer.deaths += 1;
                    if (data.senderId) {
                      const attacker = s.otherPlayers.get(data.senderId);
                      if (attacker) {
                        attacker.score = (attacker.score || 0) + 1;
                        attacker.kills = (attacker.kills || 0) + 1;
                      } else {
                        s.scorePlayer += 1;
                        s.playerKills += 1;
                      }
                    }
                    sfx.playDeath();
                    const newDeath: DeathEvent = {
                      id: Math.random().toString(36).substring(2, 9),
                      attacker: data.senderId ? (s.otherPlayers.get(data.senderId)?.playerName || s.settings.playerName || 'Blue (You)') : 'Player',
                      victim: targetPlayer.playerName,
                      weapon: data.weapon || 'sword',
                    };
                    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                    spawnVoxelShockwaveParticles(new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z), '#ef4444');
                  } else {
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(new THREE.Vector3(targetPlayer.pos.x, targetPlayer.pos.y, targetPlayer.pos.z), '#e2e8f0');
                  }
                }
              } else {
                // Otherwise targeted at the local player!
                if (s.playerHP > 0 && s.playerInvulnerabilityTimer <= 0) {
                  recordPlayerDamageTaken();
                  s.playerHP -= data.damage || 1;
                  if (s.playerHP <= 0) {
                    s.playerHP = 0;
                    s.playerRespawnTimer = 3.0;
                    s.playerDeaths += 1;
                    s.scoreEnemy += 1;
                    s.enemyKills += 1;
                    if (data.senderId) {
                      const attacker = s.otherPlayers.get(data.senderId);
                      if (attacker) {
                        attacker.score = (attacker.score || 0) + 1;
                        attacker.kills = (attacker.kills || 0) + 1;
                      }
                    }
                    sfx.playDeath();
                    const newDeath: DeathEvent = {
                      id: Math.random().toString(36).substring(2, 9),
                      attacker: data.senderId ? (s.otherPlayers.get(data.senderId)?.playerName || 'Player') : 'Player',
                      victim: s.settings.playerName || 'Blue (You)',
                      weapon: data.weapon || 'sword',
                    };
                    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                    spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');
                  } else {
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
                  }
                }
              }
              pushStatsUpdate();
            } else {
              if (multiplayerRole === 'observer') {
                if (data.senderRole === 'host') {
                  if (data.pos) s.hostPos.set(data.pos.x, data.pos.y, data.pos.z);
                  if (data.vel) s.hostVel.set(data.vel.x, data.vel.y, data.vel.z);
                  if (data.yaw !== undefined) s.hostYaw = data.yaw;
                  if (data.pitch !== undefined) s.hostPitch = data.pitch;
                  if (data.hp !== undefined) s.hostHP = data.hp;
                  if (data.maxHp !== undefined) s.hostMaxHP = data.maxHp;
                  if (data.isCrouching !== undefined) s.hostIsCrouching = data.isCrouching;
                  if (data.activeWeapon !== undefined) s.hostActiveWeapon = data.activeWeapon;
                  if (data.respawnTimer !== undefined) s.hostRespawnTimer = data.respawnTimer;
                  if (data.playerName !== undefined) s.hostPlayerName = data.playerName;
                  if (data.hue !== undefined && data.hue !== s.hostHue) {
                    s.hostHue = data.hue;
                    rebuildHostModel(data.hue);
                  }

                  // Scoreboard syncing from authoritative Host to Spectator
                  if (data.scoreHost !== undefined) s.scorePlayer = data.scoreHost;
                  if (data.scoreClient !== undefined) s.scoreEnemy = data.scoreClient;
                  if (data.killsHost !== undefined) s.playerKills = data.killsHost;
                  if (data.deathsHost !== undefined) s.playerDeaths = data.deathsHost;
                  if (data.killsClient !== undefined) s.enemyKills = data.killsClient;
                  if (data.deathsClient !== undefined) s.enemyDeaths = data.deathsClient;
                  if (data.gameTime !== undefined) s.gameTime = data.gameTime;
                } else if (data.senderRole === 'client') {
                  if (data.pos) s.clientPos.set(data.pos.x, data.pos.y, data.pos.z);
                  if (data.vel) s.clientVel.set(data.vel.x, data.vel.y, data.vel.z);
                  if (data.yaw !== undefined) s.clientYaw = data.yaw;
                  if (data.pitch !== undefined) s.clientPitch = data.pitch;
                  if (data.hp !== undefined) s.clientHP = data.hp;
                  if (data.maxHp !== undefined) s.clientMaxHP = data.maxHp;
                  if (data.isCrouching !== undefined) s.clientIsCrouching = data.isCrouching;
                  if (data.activeWeapon !== undefined) s.clientActiveWeapon = data.activeWeapon;
                  if (data.respawnTimer !== undefined) s.clientRespawnTimer = data.respawnTimer;
                  if (data.playerName !== undefined) s.clientPlayerName = data.playerName;
                  if (data.hue !== undefined && data.hue !== s.clientHue) {
                    s.clientHue = data.hue;
                    rebuildEnemyModel(data.hue); // Client is Red (EnemyGroup)
                  }
                }
              } else {
                // Gameplay coordinates synchronization packet
                if (data.senderId) {
                  createOrUpdateRemotePlayer(data.senderId, data);
                }

                // Override local scores from Host (single authoritative master index)
                if (multiplayerRole === 'client') {
                  if (data.scoreHost !== undefined) s.scoreEnemy = data.scoreHost;
                  if (data.scoreClient !== undefined) s.scorePlayer = data.scoreClient;
                  if (data.killsHost !== undefined) s.enemyKills = data.killsHost;
                  if (data.deathsHost !== undefined) s.enemyDeaths = data.deathsHost;
                  if (data.killsClient !== undefined) s.playerKills = data.killsClient;
                  if (data.deathsClient !== undefined) s.playerDeaths = data.deathsClient;
                  if (data.gameTime !== undefined) s.gameTime = data.gameTime;
                }
              }
            }
          } else if (data.type === 'disconnected') {
            alert(data.reason || 'Opponent disconnected from match.');
            onPauseToggle();
          }
        } catch (err) {
          console.error('Error handling WebSocket synchronization logic:', err);
        }
      };

      multiplayerSocket.addEventListener('message', handleWsMessage);
      return () => {
        multiplayerSocket.removeEventListener('message', handleWsMessage);
      };
    }
  }, [isMultiplayer, multiplayerRole, multiplayerSocket]);

  // Keep isMultiplayer and multiplayerRole in sync with props
  useEffect(() => {
    const s = stateRef.current;
    if (s) {
      s.isMultiplayer = isMultiplayer;
      s.multiplayerRole = multiplayerRole;
      if (isMultiplayer) {
        removeMainAIFromRoster(s.otherPlayers);
      }
    }
  }, [isMultiplayer, multiplayerRole]);

  // Keep admin settings in sync with real-time reactive sliding parameters
  useEffect(() => {
    const s = stateRef.current;
    
    // Scale current player/enemy HP if they were at full status
    const prevMax = s.playerMaxHP;
    s.playerMaxHP = adminSettings.maxHP;
    if (s.playerHP === prevMax) {
      s.playerHP = adminSettings.maxHP;
    } else {
      s.playerHP = Math.min(s.playerHP, adminSettings.maxHP);
    }

    const mainAi = mai();
    if (mainAi) {
      mainAi.maxHp = adminSettings.maxHP;
      if (mainAi.hp === prevMax) {
        mainAi.hp = adminSettings.maxHP;
      } else {
        mainAi.hp = Math.min(mainAi.hp, adminSettings.maxHP);
      }
    }

    s.settings = adminSettings;

    if (threeRef.current.ambientLight) {
      threeRef.current.ambientLight.intensity = adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : 0.82;
    }
    if (threeRef.current.dirLight) {
      threeRef.current.dirLight.intensity = adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 1.6;
    }
    if (threeRef.current.scene) {
      const hue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 224;
      const brightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 4;
      const colorString = `hsl(${hue}, 70%, ${brightness}%)`;
      const finalColor = new THREE.Color(colorString);
      threeRef.current.scene.background = finalColor;
      if (threeRef.current.scene.fog) {
        threeRef.current.scene.fog.color.copy(finalColor);
      }
    }
  }, [adminSettings]);

  useEffect(() => {
    resetAIMatchContext(stateRef.current.aiMatchContext);
  }, [aiMatchSessionKey]);

  const onStatsUpdateRef = useRef(onStatsUpdate);
  useEffect(() => {
    onStatsUpdateRef.current = onStatsUpdate;
  }, [onStatsUpdate]);

  // Mutable refs for isPaused and keybindings so the heavy Three.js mounting
  // useEffect does NOT re-run (destroy + recreate the WebGL canvas) every time
  // the user pauses/unpauses or changes keybindings.
  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
    if (isPaused) {
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }
    }
  }, [isPaused]);

  const keybindingsRef = useRef(keybindings);
  useEffect(() => {
    keybindingsRef.current = keybindings;
  }, [keybindings]);

  // Keys active dictionary
  const keysPressed = useRef<{ [key: string]: boolean }>({});
  const prevGamepadButtonsRef = useRef<boolean[]>([]);
  const grifbHoldTimerRef = useRef<number>(0);
  const secretAudioRef = useRef<HTMLAudioElement | null>(null);
  
  // Custom Fallback Mouse support (Drag to view if Pointer Lock fails or is denied)
  const isPointerLocked = useRef<boolean>(false);
  const isMouseDown = useRef<boolean>(false);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // References to THREE objects needed inside loop
  const threeRef = useRef<{
    scene: THREE.Scene | null;
    camera: THREE.PerspectiveCamera | null;
    renderer: THREE.WebGLRenderer | null;
    playerHammer: THREE.Group | null;
    playerSword: THREE.Group | null;
    playerPistol: THREE.Group | null;
    enemyGroup: THREE.Group | null;
    enemyHammer: THREE.Group | null;
    enemySword: THREE.Group | null;
    hostGroup: THREE.Group | null;
    hostHammer: THREE.Group | null;
    hostSword: THREE.Group | null;
    debugPlayerSphere: THREE.Mesh | null;
    debugEnemySphere: THREE.Mesh | null;
    playerJumpZoneMesh: THREE.Mesh | null;
    ambientLight: THREE.AmbientLight | null;
    dirLight: THREE.DirectionalLight | null;
    damageExplosionParticles: {
      mesh: THREE.Mesh;
      velocity: THREE.Vector3;
      life: number;
      maxLife: number;
    }[];
    hammerSplashFlashes: {
      mesh: THREE.Mesh;
      life: number;
      maxLife: number;
      targetRadius: number;
    }[];
    swordLungeSpeedLines: {
      mesh: THREE.Mesh;
      drift: THREE.Vector3;
      life: number;
      maxLife: number;
      startOpacity: number;
    }[];
    burnDecals: {
      mesh: THREE.Mesh;
      life: number;
      maxLife: number;
    }[];
    tracers: {
      mesh: THREE.Line | THREE.Mesh;
      life: number;
      maxLife: number;
      material: THREE.Material;
    }[];
    otherPlayerMeshes: Map<string, {
      group: THREE.Group;
      hammer: THREE.Group;
      sword: THREE.Group;
      pistol?: THREE.Group;
    }>;
    navMesh?: any;
    customMapObjects?: THREE.Object3D[];
  }>({
    scene: null,
    camera: null,
    renderer: null,
    playerHammer: null,
    playerSword: null,
    playerPistol: null,
    enemyGroup: null,
    enemyHammer: null,
    enemySword: null,
    hostGroup: null,
    hostHammer: null,
    hostSword: null,
    otherPlayerMeshes: new Map(),
    customMapObjects: [],

    debugPlayerSphere: null,
    debugEnemySphere: null,
    playerJumpZoneMesh: null,
    ambientLight: null,
    dirLight: null,
    damageExplosionParticles: [],
    hammerSplashFlashes: [],
    swordLungeSpeedLines: [],
    burnDecals: [],
    tracers: [],
  });

  // Track if mouse/pointer lock instructions should be displayed
  const [showPointerLockAlert, setShowPointerLockAlert] = useState(true);

  // Track opponent's custom hue for rebuilding their Spartan model dynamically
  const lastOpponentHue = useRef<number | null>(null);
  const opponentNameRef = useRef<string>('');
  const radarDotPoolRef = useRef<Map<string, HTMLElement>>(new Map());
  const nameplatePoolRef = useRef<Map<string, HTMLElement>>(new Map());

  useEffect(() => {
    opponentNameRef.current = opponentPlayerName || '';
  }, [opponentPlayerName]);

  const updateBlinking = (group: THREE.Group | null, active: boolean) => {
    if (!group) return;
    const blinkCycle = Math.floor(performance.now() / 120) % 2 === 0;
    const isAlreadyBlinking = group.userData.isBlinking === true;
    const shouldShowBlink = active && blinkCycle;
    
    if (!active && !isAlreadyBlinking) {
      return;
    }
    
    group.userData.isBlinking = active;
    
    group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        // Skip general helper meshes
        if (child === threeRef.current.debugPlayerSphere || child === threeRef.current.debugEnemySphere) {
          return;
        }
        
        if (!child.userData.originalMaterial) {
          child.userData.originalMaterial = child.material;
        }
        
        if (shouldShowBlink) {
          child.material = whiteBlinkMaterial;
        } else {
          child.material = child.userData.originalMaterial;
        }
      }
    });
  };

  const getSpectateTargetData = (target: 'host' | 'client') => {
    const s = stateRef.current;
    if (isMultiplayer) {
      if (multiplayerRole === 'observer') {
        // Connected as observer from title screen
        if (target === 'host') {
          return {
            pos: s.hostPos,
            yaw: s.hostYaw,
            pitch: s.hostPitch,
            name: s.hostPlayerName || 'Blue (Host)',
            hp: s.hostHP,
            hue: s.hostHue,
            isCrouching: s.hostIsCrouching,
            activeWeapon: s.hostActiveWeapon
          };
        } else {
          return {
            pos: s.clientPos,
            yaw: s.clientYaw,
            pitch: s.clientPitch,
            name: s.clientPlayerName || 'Red (Guest)',
            hp: s.clientHP,
            hue: s.clientHue,
            isCrouching: s.clientIsCrouching,
            activeWeapon: s.clientActiveWeapon
          };
        }
      } else if (multiplayerRole === 'host') {
        // Host playing or spectating
        if (target === 'host') {
          return {
            pos: s.playerPos,
            yaw: s.yaw,
            pitch: s.pitch,
            name: s.settings.playerName || 'Blue (You - Host)',
            hp: s.playerHP,
            hue: s.settings.playerHue ?? 200,
            isCrouching: s.isCrouching,
            activeWeapon: s.activeWeapon
          };
        } else {
          return {
            pos: mai()!.pos,
            yaw: mai()!.yaw,
            pitch: mai()!.pitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Red (Guest)',
            hp: mai()!.hp,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: mai()!.isCrouching,
            activeWeapon: mai()!.activeWeapon
          };
        }
      } else if (multiplayerRole === 'client') {
        // Client playing or spectating
        if (target === 'host') {
          return {
            pos: mai()!.pos,
            yaw: mai()!.yaw,
            pitch: mai()!.pitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Blue (Host)',
            hp: mai()!.hp,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: mai()!.isCrouching,
            activeWeapon: mai()!.activeWeapon
          };
        } else {
          return {
            pos: s.playerPos,
            yaw: s.yaw,
            pitch: s.pitch,
            name: s.settings.playerName || 'Red (You - Guest)',
            hp: s.playerHP,
            hue: s.settings.playerHue ?? 200,
            isCrouching: s.isCrouching,
            activeWeapon: s.activeWeapon
          };
        }
      }
    } else {
      // Singleplayer
      if (target === 'host') {
        return {
          pos: s.playerPos,
          yaw: s.yaw,
          pitch: s.pitch,
          name: s.settings.playerName || 'Spartan (You)',
          hp: s.playerHP,
          hue: s.settings.playerHue ?? 200,
          isCrouching: s.isCrouching,
          activeWeapon: s.activeWeapon
        };
      } else {
        return {
          pos: mai()!.pos,
          yaw: mai()!.yaw,
          pitch: 0,
          name: 'AI Bot',
          hp: mai()!.hp,
          hue: 0,
          isCrouching: mai()!.isCrouching,
          activeWeapon: mai()!.activeWeapon
        };
      }
    }
    
    // Fallback
    return {
      pos: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      name: 'Unknown',
      hp: 1,
      hue: 200,
      isCrouching: false,
      activeWeapon: 'hammer' as const
    };
  };

  const cycleReplayTarget = (direction: 'next' | 'prev' = 'next') => {
    const playerIds = replayPlayerIdsRef.current;
    if (!playerIds || playerIds.length === 0) return;

    // Cycle includes 'free', then all player IDs
    const targets = ['free', ...playerIds];
    const currentTarget = replayTargetIdRef.current || 'free';
    
    let currentIndex = targets.indexOf(currentTarget);
    if (currentIndex === -1) currentIndex = 0;

    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % targets.length;
    } else {
      nextIndex = (currentIndex - 1 + targets.length) % targets.length;
    }

    const nextTarget = targets[nextIndex];
    replayTargetIdRef.current = nextTarget;
    console.log('Replay target cycled to:', nextTarget);
    
    // Also auto-switch from free to third-person orbital camera if locking onto a player
    const s = stateRef.current;
    if (s && nextTarget !== 'free' && s.observerCamMode === 'free') {
      s.observerCamMode = 'third';
    }

    pushStatsUpdate();
  };

  const rebuildEnemyModel = (hue: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene || !threeRef.current.enemyGroup) return;

    // Remove old group
    scene.remove(threeRef.current.enemyGroup);

    // Build new spartan with custom hue.
    const isEnemyBot = !isMultiplayer;
    const isLocalClient = isMultiplayer && multiplayerRole === 'client';
    const enemyGroup = buildVoxelSpartanModel(isEnemyBot, hue, isLocalClient ? playerLoadout : undefined);
    enemyGroup.position.copy(multiplayerRole === 'observer' ? s.clientPos : mai()!.pos);
    scene.add(enemyGroup);
    threeRef.current.enemyGroup = enemyGroup;

    // Rebuild & attach hammer
    const enemyHammer = buildGravityHammerModel(isEnemyBot ? undefined : hue);
    enemyHammer.scale.set(0.6, 0.6, 0.6);
    enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4);
    enemyHammer.rotation.set(Math.PI / 2, 0, 0);
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemyHammer);
    } else {
      enemyGroup.add(enemyHammer);
    }
    threeRef.current.enemyHammer = enemyHammer;

    // Rebuild & attach sword
    const enemySword = buildKatarSwordModel(isEnemyBot ? undefined : hue);
    enemySword.scale.set(0.6, 0.6, 0.6);
    enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
    enemySword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    
    const activeWeapon = (multiplayerRole === 'observer') ? s.clientActiveWeapon : mai()!.activeWeapon;
    enemySword.visible = activeWeapon === 'sword';
    enemyHammer.visible = activeWeapon === 'hammer';
    
    if (enemyGroup.userData.upperTorso) {
      enemyGroup.userData.upperTorso.add(enemySword);
    } else {
      enemyGroup.add(enemySword);
    }
    threeRef.current.enemySword = enemySword;
  };

  const rebuildHostModel = (hue: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    if (threeRef.current.hostGroup) {
      scene.remove(threeRef.current.hostGroup);
    }

    // Build Blue team spartan model for Host
    const isLocalHost = !isMultiplayer || multiplayerRole === 'host';
    const hostGroup = buildVoxelSpartanModel(false, hue, isLocalHost ? playerLoadout : undefined);
    hostGroup.position.copy(multiplayerRole === 'observer' ? s.hostPos : s.playerPos);
    scene.add(hostGroup);
    threeRef.current.hostGroup = hostGroup;

    // Rebuild & attach hammer
    const hostHammer = buildGravityHammerModel(hue);
    hostHammer.scale.set(0.6, 0.6, 0.6);
    hostHammer.position.set(0.5, 1.0 - 0.64, -0.4);
    hostHammer.rotation.set(Math.PI / 2, 0, 0);
    if (hostGroup.userData.upperTorso) {
      hostGroup.userData.upperTorso.add(hostHammer);
    } else {
      hostGroup.add(hostHammer);
    }
    threeRef.current.hostHammer = hostHammer;

    // Rebuild & attach sword
    const hostSword = buildKatarSwordModel(hue);
    hostSword.scale.set(0.6, 0.6, 0.6);
    hostSword.position.set(0.5, 1.0 - 0.64, -0.32);
    hostSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    
    const activeWeapon = (multiplayerRole === 'observer') ? s.hostActiveWeapon : s.activeWeapon;
    hostSword.visible = activeWeapon === 'sword';
    hostHammer.visible = activeWeapon === 'hammer';
    
    if (hostGroup.userData.upperTorso) {
      hostGroup.userData.upperTorso.add(hostSword);
    } else {
      hostGroup.add(hostSword);
    }
    threeRef.current.hostSword = hostSword;
  };

  // Define 8 circular spawn points inside the 20m arena (base radius 13m)
  const SPAWN_POINTS = useRef<THREE.Vector3[]>(
    Array.from({ length: 8 }).map((_, i) => {
      const angle = (i * 2 * Math.PI) / 8;
      return new THREE.Vector3(13 * Math.cos(angle), 0, 13 * Math.sin(angle));
    })
  ).current;

  // Minimax proximity spawning algorithm to select spawn point farthest from threat
  const getOptimalSpawnPoint = (excludePositions: THREE.Vector3[]): THREE.Vector3 => {
    const activeCustomMap = getActiveCustomMap();
    const activeSpawns = activeCustomMap && activeCustomMap.spawnPoints && activeCustomMap.spawnPoints.length > 0
      ? activeCustomMap.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z))
      : SPAWN_POINTS;

    if (activeSpawns.length === 0) {
      return new THREE.Vector3(0, 0, 0);
    }

    if (excludePositions.length === 0) {
      return activeSpawns[0].clone();
    }
    let bestPoint = activeSpawns[0];
    let bestMinDist = -1;
    for (const point of activeSpawns) {
      let minDist = Infinity;
      for (const entityPos of excludePositions) {
        const d = point.distanceTo(entityPos);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestPoint = point;
      }
    }
    return bestPoint.clone();
  };

  // Dynamic arena resizing based on player count (12.5% for every 2 players, up to 50% max)
  const resizeArena = (playerCount: number) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    const scale = 1.0 + Math.min(0.50, Math.floor((playerCount - 1) / 2) * 0.125);
    s.arenaRadius = 20 * scale;

    // Scale floor cylinder mesh
    scene.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry instanceof THREE.CylinderGeometry) {
        const params = (child.geometry as any).parameters;
        if (params && params.radialSegments === 64 && params.height === 0.2) {
          child.scale.set(scale, 1, scale);
        }
      }
    });

    // Relocate outer pillars
    scene.traverse((child) => {
      if (child instanceof THREE.Group && child.children.length === 2 && child.parent === scene && child.userData.angle !== undefined) {
        const pos = child.position;
        const angle = Math.atan2(pos.z, pos.x);
        const targetRadius = 20.3 * scale;
        child.position.set(Math.cos(angle) * targetRadius, 2, Math.sin(angle) * targetRadius);
      }
    });

    // Scale hangar walls
    scene.traverse((child) => {
      if (child instanceof THREE.Group && child.name === 'hangarWallGroup') {
        child.scale.set(scale, 1, scale);
      }
    });

    // Recalculate spawn points
    const baseSpawnRadius = 13.0;
    const spawnRadius = baseSpawnRadius * scale;
    SPAWN_POINTS.forEach((p, i) => {
      const angle = (i * 2 * Math.PI) / 8;
      p.set(spawnRadius * Math.cos(angle), 0, spawnRadius * Math.sin(angle));
    });

    console.log(`Arena dynamically scaled for ${playerCount} players. Factor: ${scale}, Radius: ${s.arenaRadius}`);
  };

  type CombatantMeshRig = {
    group: THREE.Group;
    hammer: THREE.Group;
    sword: THREE.Group;
    pistol?: THREE.Group;
  };

  const getRandomLoadout = (): CharacterLoadout => {
    const helmets = AVAILABLE_PRESETS.helmet;
    const torsos = AVAILABLE_PRESETS.torso;
    const arms = AVAILABLE_PRESETS.arm;
    const legs = AVAILABLE_PRESETS.leg;
    return {
      helmet: helmets[Math.floor(Math.random() * helmets.length)],
      torso: torsos[Math.floor(Math.random() * torsos.length)],
      arm: arms[Math.floor(Math.random() * arms.length)],
      leg: legs[Math.floor(Math.random() * legs.length)],
    };
  };

  const buildCombatantMeshRig = (scene: THREE.Scene, hue: number, isEnemyBot = false): CombatantMeshRig => {
    const botLoadout = isEnemyBot ? getRandomLoadout() : undefined;
    const group = buildVoxelSpartanModel(isEnemyBot, hue, botLoadout);
    group.userData.appliedHue = hue;
    scene.add(group);

    const hammer = buildGravityHammerModel(hue);
    hammer.scale.set(0.6, 0.6, 0.6);
    hammer.position.set(0.5, 1.0 - 0.64, -0.4);
    hammer.rotation.set(Math.PI / 2, 0, 0);
    if (group.userData.upperTorso) {
      group.userData.upperTorso.add(hammer);
    } else {
      group.add(hammer);
    }

    const sword = buildKatarSwordModel(hue);
    sword.scale.set(0.6, 0.6, 0.6);
    sword.position.set(0.5, 1.0 - 0.64, -0.32);
    sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
    sword.visible = false;
    if (group.userData.upperTorso) {
      group.userData.upperTorso.add(sword);
    } else {
      group.add(sword);
    }

    const pistol = buildPistolModel(hue);
    pistol.scale.set(0.6, 0.6, 0.6);
    pistol.position.set(0.5, 1.0 - 0.64, -0.32);
    pistol.rotation.set(Math.PI / 2, 0, 0);
    pistol.visible = false;
    if (group.userData.upperTorso) {
      group.userData.upperTorso.add(pistol);
    } else {
      group.add(pistol);
    }

    return { group, hammer, sword, pistol };
  };

  // Provisions any roster combatant into otherPlayerMeshes (shared rig for AI + remote).
  const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    let playerState = s.otherPlayers.get(clientId);
    if (!playerState) {
      const isHostPlayer = (s.multiplayerRole === 'client' && clientId === opponentClientId) || (s.multiplayerRole === 'observer' && data.role === 'host');
      const spawnZ = isHostPlayer ? 12 : -12;
      playerState = createRemoteCombatant({
        id: clientId,
        playerName: data.playerName,
        spawnZ,
        settings: s.settings,
        data: {
          hp: data.hp,
          maxHp: data.maxHp,
          hue: data.hue,
          isCrouching: data.isCrouching,
          activeWeapon: data.activeWeapon,
          respawnTimer: data.respawnTimer,
          invulnerabilityTimer: data.invulnerabilityTimer,
        },
      });
      playerState.yaw = getInwardSpawnYaw(playerState.pos);
      s.otherPlayers.set(clientId, playerState);
    }

    if (data.pos) playerState.pos.set(data.pos.x, data.pos.y, data.pos.z);
    if (data.vel) playerState.vel.set(data.vel.x, data.vel.y, data.vel.z);
    constrainCombatantToArena(playerState.pos, playerState.vel);
    if (data.yaw !== undefined) playerState.yaw = data.yaw;
    if (data.pitch !== undefined) playerState.pitch = data.pitch;
    if (data.hp !== undefined) playerState.hp = data.hp;
    if (data.maxHp !== undefined) playerState.maxHp = data.maxHp;
    if (data.isCrouching !== undefined) playerState.isCrouching = data.isCrouching;
    if (data.activeWeapon !== undefined) playerState.activeWeapon = data.activeWeapon;
    if (data.respawnTimer !== undefined) playerState.respawnTimer = data.respawnTimer;
    if (data.hue !== undefined) playerState.hue = data.hue;
    if (data.playerName) playerState.playerName = data.playerName;
    if (data.invulnerabilityTimer !== undefined) playerState.invulnerabilityTimer = data.invulnerabilityTimer;

    let meshes = threeRef.current.otherPlayerMeshes.get(clientId);
    const hue = data.hue ?? playerState.hue;
    if (!meshes || meshes.group.userData.appliedHue !== hue) {
      if (meshes?.group) scene.remove(meshes.group);
      meshes = buildCombatantMeshRig(scene, hue, false);
      threeRef.current.otherPlayerMeshes.set(clientId, meshes);
      playerState.hue = hue;
    }

    const { group, hammer, sword, pistol } = meshes;
    group.position.copy(playerState.pos);
    group.rotation.y = playerState.yaw;
    
    if (playerState.isCrouching) {
      group.scale.set(1, 0.65, 1);
    } else {
      group.scale.set(1, 1, 1);
    }

    hammer.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'hammer';
    sword.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'sword';
    if (pistol) {
      pistol.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'pistol';
    }
    group.visible = playerState.hp > 0 && playerState.respawnTimer <= 0;
  };

  const buildOrchestratorSpawnCallbacks = (): AIOrchestratorSpawnCallbacks => ({
    getOptimalSpawnPoint,
    getInwardSpawnYaw,
  });

  const buildOrchestratorEvents = (opts?: { silentSpawn?: boolean }): AIOrchestratorEvents => {
    const scene = threeRef.current.scene;
    return {
      onBotSpawned: (botId, bot) => {
        createOrUpdateRemotePlayer(botId, bot);
        if (!opts?.silentSpawn) {
          sfx.playRespawn();
        }
      },
      onBotDespawned: (botId) => {
        if (!scene) return;
        const meshes = threeRef.current.otherPlayerMeshes.get(botId);
        if (meshes) {
          if (meshes.group) scene.remove(meshes.group);
          threeRef.current.otherPlayerMeshes.delete(botId);
        }
      },
      onMainAICreated: (mainAi) => {
        createOrUpdateRemotePlayer(MAIN_AI_ID, mainAi);
      },
      onHueChanged: (combatantId, combatant) => {
        if (!scene) return;
        const oldMeshes = threeRef.current.otherPlayerMeshes.get(combatantId);
        if (oldMeshes?.group) scene.remove(oldMeshes.group);
        threeRef.current.otherPlayerMeshes.delete(combatantId);
        createOrUpdateRemotePlayer(combatantId, combatant);
      },
      onRosterLayoutChanged: (totalCombatants) => {
        resizeArena(totalCombatants);
        pushStatsUpdate();
      },
    };
  };

  const runAIOrchestrator = (dt: number) => {
    const s = stateRef.current;
    if (s.isMultiplayer) return;

    tickAIOrchestrator(
      {
        roster: s.otherPlayers,
        settings: s.settings,
        legacy: getLegacyRosterProps(),
        offlineBotCount: offlineBotCountRef.current,
        playerPos: s.playerPos,
        isPlaying,
        coordinator: s.aiMatchContext.coordinator,
      },
      dt,
      buildOrchestratorSpawnCallbacks(),
      buildOrchestratorEvents()
    );
  };

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // 1. INITIALIZE THREE.JS
    const scene = new THREE.Scene();
    threeRef.current.scene = scene;

    // Clear stale mesh references from any previous scene so createOrUpdateRemotePlayer
    // always builds fresh meshes in this scene rather than reusing orphaned ones.
    threeRef.current.otherPlayerMeshes.clear();
    threeRef.current.damageExplosionParticles = [];
    threeRef.current.hammerSplashFlashes = [];
    threeRef.current.swordLungeSpeedLines = [];
    threeRef.current.burnDecals = [];
    threeRef.current.hostGroup = null;
    threeRef.current.hostHammer = null;
    threeRef.current.hostSword = null;

    const activeCustomMap = getActiveCustomMap();
    const effectiveMapId = replayData ? replayData.mapType : selectedMap;
    const isHangar = effectiveMapId === 'hangar';

    // 1. SETUP ATMOSPHERICS (SKYBOX & FOG)
    let bgHex = isHangar ? '#07090d' : '#030712';
    let fogDensity = isHangar ? 0.028 : 0.015;

    if (activeCustomMap) {
      bgHex = activeCustomMap.fogColor || '#030712';
      fogDensity = activeCustomMap.fogDensity ?? 0.015;
    }

    const skyColor = new THREE.Color(bgHex);
    scene.background = skyColor; 
    scene.fog = new THREE.FogExp2(bgHex, fogDensity); 

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 100);
    threeRef.current.camera = camera;
    scene.add(camera);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
    });
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    
    threeRef.current.renderer = renderer;

    // Helper: Create custom procedural textures dynamically using 2D HTML Canvas
    const generateCustomTexture = (type: string, baseColorHex: string): THREE.Texture => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d')!;

      // Background fill
      ctx.fillStyle = baseColorHex;
      ctx.fillRect(0, 0, 512, 512);

      if (type === 'none') {
        // Plain matte texture, add subtle boundary bevel highlights
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 4;
        ctx.strokeRect(0, 0, 512, 512);
      } else if (type === 'nature_grass') {
        // Grass blades on rich loam soil
        ctx.fillStyle = '#064e3b';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // light green blades
        ctx.lineWidth = 2;
        for (let i = 0; i < 400; i++) {
          const x = Math.random() * 512;
          const y = Math.random() * 512;
          const len = 6 + Math.random() * 14;
          const tilt = -4 + Math.random() * 8;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + tilt, y - len);
          ctx.stroke();
        }
      } else if (type === 'nature_mossy_stone') {
        // Granite slate with green moss patches
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(0, 0, 512, 512);
        // Stone ridges
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 3;
        for (let i = 0; i < 15; i++) {
          ctx.strokeRect(Math.random() * 512, Math.random() * 512, 60 + Math.random() * 120, 60 + Math.random() * 120);
        }
        // Mossy vegetative growth overlays
        ctx.fillStyle = baseColorHex;
        for (let i = 0; i < 20; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 512, 18 + Math.random() * 35, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'nature_wood') {
        // Wood grain bark
        ctx.fillStyle = '#3e2723';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // light beige grain
        ctx.lineWidth = 4;
        for (let r = 24; r < 700; r += 28) {
          ctx.beginPath();
          ctx.arc(256, 256, r, 0.2, Math.PI * 2 - 0.2);
          ctx.stroke();
        }
      } else if (type === 'space_alloy') {
        // Starbase titanium hull plates
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // cyan grid line seams
        ctx.lineWidth = 2.5;
        for (let idx = 0; idx <= 512; idx += 128) {
          ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
        }
        ctx.fillStyle = '#475569'; // steel rivets
        for (let rx = 16; rx < 512; rx += 128) {
          for (let ry = 16; ry < 512; ry += 128) {
            ctx.beginPath(); ctx.arc(rx, ry, 3.5, 0, Math.PI * 2); ctx.fill();
          }
        }
      } else if (type === 'space_meteorite') {
        // Dark meteor mineral with glowing veins
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 3.5;
        ctx.shadowColor = baseColorHex;
        ctx.shadowBlur = 12;
        for (let i = 0; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(Math.random() * 512, 0);
          ctx.bezierCurveTo(Math.random() * 512, 170, Math.random() * 512, 340, Math.random() * 512, 512);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else if (type === 'space_lunar_dust') {
        // Lunar soil with fine craters
        ctx.fillStyle = '#334155';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = baseColorHex;
        for (let i = 0; i < 40; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 512, 6 + Math.random() * 16, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (type === 'futuristic_carbon') {
        // Threaded carbon fiber weave
        ctx.fillStyle = '#090d16';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 1;
        for (let i = 0; i < 512; i += 6) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        }
      } else if (type === 'futuristic_hex') {
        // Cyan hexagonal grid
        ctx.fillStyle = '#050811';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 2;
        const hexSizeVal = 32;
        const hexHeightVal = hexSizeVal * Math.sqrt(3);
        for (let y = 0; y < 512 + hexHeightVal; y += hexHeightVal) {
          for (let x = 0; x < 512 + hexSizeVal * 3; x += hexSizeVal * 3) {
            ctx.beginPath();
            for (let a = 0; a < 6; a++) {
              const angle = (a * Math.PI) / 3;
              const px = x + hexSizeVal * Math.cos(angle);
              const py = y + hexSizeVal * Math.sin(angle);
              if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.stroke();

            ctx.beginPath();
            for (let a = 0; a < 6; a++) {
              const angle = (a * Math.PI) / 3;
              const px = x + hexSizeVal * 1.5 + hexSizeVal * Math.cos(angle);
              const py = y + hexHeightVal / 2 + hexSizeVal * Math.sin(angle);
              if (a === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath(); ctx.stroke();
          }
        }
      } else if (type === 'futuristic_shield') {
        // Glowing circular shield emitter
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 3.5;
        for (let r = 80; r <= 320; r += 80) {
          ctx.beginPath(); ctx.arc(256, 256, r, 0, Math.PI * 2); ctx.stroke();
        }
      } else if (type === 'city_asphalt') {
        // Rough dark tarmac asphalt
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 512, 512);
        ctx.fillStyle = baseColorHex; // gravel speckles
        for (let i = 0; i < 1500; i++) {
          ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.5, 2.5);
        }
      } else if (type === 'city_brick') {
        // Red industrial bricks
        ctx.fillStyle = '#7c2d12';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // mortar seams
        ctx.lineWidth = 2.5;
        const bH = 24;
        const bW = 56;
        for (let y = 0; y < 512; y += bH) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
          const offset = (y / bH) % 2 === 0 ? 0 : bW / 2;
          for (let x = offset; x < 512 + bW; x += bW) {
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bH); ctx.stroke();
          }
        }
      } else if (type === 'city_concrete') {
        // Grey aggregate concrete slabs with cracks
        ctx.fillStyle = '#64748b';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // cracks/joints
        ctx.lineWidth = 1.5;
        ctx.strokeRect(0, 0, 512, 512);
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(Math.random() * 512, 0);
          ctx.lineTo(Math.random() * 512, 160);
          ctx.lineTo(Math.random() * 512, 360);
          ctx.lineTo(Math.random() * 512, 512);
          ctx.stroke();
        }
      } else if (type === 'fantasy_runed_stone') {
        // Glowing runic ancient carvings
        ctx.fillStyle = '#27272a';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // glow paint
        ctx.lineWidth = 5;
        ctx.shadowColor = baseColorHex;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(256, 80);
        ctx.lineTo(130, 390);
        ctx.lineTo(382, 390);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(256, 270, 70, 0, Math.PI * 2);
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (type === 'fantasy_cobble') {
        // Interlocking castle stones
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 3;
        for (let i = 0; i < 60; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 512, 22 + Math.random() * 32, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (type === 'fantasy_gold') {
        // Scroll-worked highly reflective gold plates
        ctx.fillStyle = '#ca8a04';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 3.5;
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 512, 50 + Math.random() * 90, 0.4, 3.4);
          ctx.stroke();
        }
      } else if (type === 'forerunner_panel') {
        // Dark forerunner metallic alloy plates with golden circuit runs
        ctx.fillStyle = '#17191e';
        ctx.fillRect(0, 0, 512, 512);
        // Dark plate joints
        ctx.strokeStyle = '#282b35';
        ctx.lineWidth = 3.5;
        for (let idx = 0; idx <= 512; idx += 128) {
          ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
        }
        // Glowing gold circuit paths
        ctx.strokeStyle = baseColorHex;
        ctx.lineWidth = 2.2;
        ctx.shadowColor = baseColorHex;
        ctx.shadowBlur = 8;
        for (let rx = 64; rx < 512; rx += 128) {
          for (let ry = 64; ry < 512; ry += 128) {
            ctx.strokeRect(rx - 22, ry - 22, 44, 44);
            ctx.beginPath();
            ctx.arc(rx, ry, 6, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;
      } else if (type === 'forerunner_gold') {
        // Brushed forerunner gold plates with fine runic lines
        ctx.fillStyle = '#a16207'; // deep gold-bronze
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex; // bright glowing gold
        ctx.lineWidth = 2.8;
        ctx.shadowColor = baseColorHex;
        ctx.shadowBlur = 9;
        for (let i = 32; i < 512; i += 64) {
          ctx.beginPath();
          ctx.moveTo(i, 0); ctx.lineTo(i, 512);
          ctx.moveTo(0, i); ctx.lineTo(512, i);
          ctx.stroke();
        }
        for (let x = 64; x < 512; x += 128) {
          for (let y = 64; y < 512; y += 128) {
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.shadowBlur = 0;
      } else if (type === 'synthwave_grid') {
        // Glowing cyan/pink grid
        ctx.fillStyle = '#06020f'; // deep black purple
        ctx.fillRect(0, 0, 512, 512);
        // Draw grid lines
        ctx.strokeStyle = '#06b6d4'; // neon cyan
        ctx.lineWidth = 3.5;
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 10;
        for (let i = 0; i <= 512; i += 64) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        }
        // Sub-grid highlights
        ctx.strokeStyle = '#ec4899'; // neon pink
        ctx.lineWidth = 1.0;
        ctx.shadowColor = '#ec4899';
        ctx.shadowBlur = 4;
        for (let i = 32; i < 512; i += 64) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else if (type === 'synthwave_neon_laser') {
        // Neon energy lines
        ctx.fillStyle = '#080214';
        ctx.fillRect(0, 0, 512, 512);
        ctx.strokeStyle = baseColorHex || '#ec4899';
        ctx.lineWidth = 4.0;
        ctx.shadowColor = baseColorHex || '#ec4899';
        ctx.shadowBlur = 12;
        // Drawing diagonal neon laser strips
        for (let i = -256; i < 512; i += 128) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + 256, 512);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else if (type === 'synthwave_chrome') {
        // Horizon line chrome gradient
        const grad = ctx.createLinearGradient(0, 0, 0, 512);
        grad.addColorStop(0, '#06b6d4'); // cyber cyan sky
        grad.addColorStop(0.48, '#08041d'); // deep sky horizon border
        grad.addColorStop(0.5, '#ffffff'); // blinding horizon shine
        grad.addColorStop(0.52, '#d946ef'); // neon pink ground reflection
        grad.addColorStop(1, '#1e1b4b'); // deep reflection base
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 512, 512);
        // Add subtle horizontal metal grooves
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 1.5;
        for (let y = 32; y < 512; y += 48) {
          if (Math.abs(y - 256) > 20) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
          }
        }
      } else if (type === 'rainy_streets_asphalt') {
        // Wet dark slate/charcoal grey tarmac asphalt
        ctx.fillStyle = '#0f121a';
        ctx.fillRect(0, 0, 512, 512);
        
        // Add gravel texture speckling
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        for (let i = 0; i < 2000; i++) {
          ctx.fillRect(Math.random() * 512, Math.random() * 512, 1.5, 1.5);
        }
        
        // Shiny water puddles (slick specular maps)
        ctx.fillStyle = 'rgba(6, 182, 212, 0.05)'; // faint cyan water reflections
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.ellipse(Math.random() * 512, Math.random() * 512, 45 + Math.random() * 55, 20 + Math.random() * 25, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(244, 63, 94, 0.04)'; // faint red/orange reflections
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.ellipse(Math.random() * 512, Math.random() * 512, 35 + Math.random() * 45, 15 + Math.random() * 20, Math.random() * Math.PI, 0, Math.PI * 2);
          ctx.fill();
        }
        
        // Rain droplets ripple rings
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 12; i++) {
          ctx.beginPath();
          ctx.arc(Math.random() * 512, Math.random() * 512, 4 + Math.random() * 20, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Dark road slab panel seams
        ctx.strokeStyle = '#05070a';
        ctx.lineWidth = 4;
        for (let idx = 0; idx <= 512; idx += 256) {
          ctx.beginPath(); ctx.moveTo(idx, 0); ctx.lineTo(idx, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, idx); ctx.lineTo(512, idx); ctx.stroke();
        }
      } else if (type === 'rainy_streets_neon_glow') {
        // Heavy steel block with orange/amber glowing neon hazard borders
        ctx.fillStyle = '#1c1917';
        ctx.fillRect(0, 0, 512, 512);
        
        ctx.strokeStyle = '#ea580c'; // glowing sodium orange
        ctx.lineWidth = 4;
        ctx.shadowColor = '#ea580c';
        ctx.shadowBlur = 10;
        
        // Draw neon industrial warning bands
        ctx.strokeRect(20, 20, 472, 472);
        ctx.strokeRect(80, 80, 352, 352);
        
        // Diagonal warning stripes inside
        for (let i = 0; i < 512; i += 64) {
          ctx.beginPath();
          ctx.moveTo(i, 20);
          ctx.lineTo(i + 40, 80);
          ctx.stroke();
          
          ctx.beginPath();
          ctx.moveTo(i, 432);
          ctx.lineTo(i + 40, 492);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
      } else if (type === 'rainy_streets_dog_billboard') {
        // High-tech glowing blue dog hologram billboard screen
        ctx.fillStyle = '#020617';
        ctx.fillRect(0, 0, 512, 512);
        
        // Cyber scanlines
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
        ctx.lineWidth = 1;
        for (let y = 0; y < 512; y += 8) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
        }
        
        // Draw the cute cybernetic geometric dog
        ctx.strokeStyle = '#06b6d4'; // neon cyan
        ctx.lineWidth = 5;
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 15;
        
        ctx.beginPath();
        // Head outline
        ctx.moveTo(190, 190);
        ctx.lineTo(322, 190);
        ctx.lineTo(340, 235);
        ctx.lineTo(322, 270);
        ctx.lineTo(190, 270);
        ctx.lineTo(172, 235);
        ctx.closePath();
        
        // Snout
        ctx.moveTo(322, 220);
        ctx.lineTo(365, 220);
        ctx.lineTo(365, 250);
        ctx.lineTo(322, 250);
        
        // Tech Collar
        ctx.moveTo(200, 270);
        ctx.lineTo(200, 295);
        ctx.lineTo(260, 295);
        ctx.lineTo(260, 270);
        
        // Pointy ears
        ctx.moveTo(200, 190);
        ctx.lineTo(175, 125);
        ctx.lineTo(225, 190);
        
        ctx.moveTo(312, 190);
        ctx.lineTo(337, 125);
        ctx.lineTo(287, 190);
        ctx.stroke();
        
        // Glowing Eye (white starburst/circle)
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.arc(295, 215, 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Neon banner texts
        ctx.shadowBlur = 12;
        ctx.shadowColor = '#ec4899'; // magenta pink
        ctx.fillStyle = '#f472b6';
        ctx.font = '900 38px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('UPGRADE', 256, 410);
        
        ctx.shadowColor = '#06b6d4';
        ctx.fillStyle = '#22d3ee';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText("BRAWL'S BEST FRIEND", 256, 95);
        
        ctx.shadowBlur = 0;
      } else if (type === 'winter_ice') {
        // Pristine ice hockey rink layout
        ctx.fillStyle = '#e0f2fe'; // ice light blue
        ctx.fillRect(0, 0, 512, 512);

        // Skate scratch marks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.42)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 50; i++) {
          ctx.beginPath();
          ctx.arc(
            Math.random() * 512, 
            Math.random() * 512, 
            15 + Math.random() * 45, 
            Math.random() * Math.PI, 
            Math.random() * Math.PI * 2
          );
          ctx.stroke();
        }

        // Red Goal Lines (at x = 45 and x = 512 - 45)
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(45, 0); ctx.lineTo(45, 512);
        ctx.moveTo(512 - 45, 0); ctx.lineTo(512 - 45, 512);
        ctx.stroke();

        // Red Goal Creases (semi-circles facing inwards, radius 20)
        ctx.beginPath();
        ctx.arc(45, 256, 20, -Math.PI / 2, Math.PI / 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(512 - 45, 256, 20, Math.PI / 2, -Math.PI / 2);
        ctx.stroke();

        // Blue Lines (at x = 170 and x = 342)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(170, 0); ctx.lineTo(170, 512);
        ctx.moveTo(342, 0); ctx.lineTo(342, 512);
        ctx.stroke();

        // Red Center Line (at x = 256)
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(256, 0); ctx.lineTo(256, 512);
        ctx.stroke();

        // Blue Center Face-off Circle (radius 40, red dot)
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(256, 256, 40, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(256, 256, 5, 0, Math.PI * 2);
        ctx.fill();

        // Four Red Corner Face-off Circles with inner spots
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2.5;
        const spots = [[115, 120], [115, 392], [397, 120], [397, 392]];
        spots.forEach(([cx, cy]) => {
          ctx.beginPath();
          ctx.arc(cx, cy, 25, 0, Math.PI * 2);
          ctx.stroke();
          // Inner spot
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fill();
        });
      } else if (type === 'winter_snow') {
        // Powdery snow-covered surface
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, 512, 512);
        // Crystal ice sparkles
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < 500; i++) {
          ctx.fillRect(Math.random() * 512, Math.random() * 512, 2.5, 2.5);
        }
        // Soft blue wind drifts
        ctx.fillStyle = 'rgba(186, 230, 253, 0.25)'; // very soft sky-blue
        for (let i = 0; i < 15; i++) {
          ctx.beginPath();
          ctx.ellipse(
            Math.random() * 512, 
            Math.random() * 512, 
            50 + Math.random() * 80, 
            12 + Math.random() * 20, 
            Math.random() * 0.2 - 0.1, 
            0, 
            Math.PI * 2
          );
          ctx.fill();
        }
      } else if (type === 'winter_glacier_glass') {
        // Translucent glacier frost glass
        ctx.fillStyle = 'rgba(147, 197, 253, 0.45)';
        ctx.fillRect(0, 0, 512, 512);
        // Fine crystal ice cracks
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 10; i++) {
          ctx.beginPath();
          ctx.moveTo(Math.random() * 512, 0);
          ctx.lineTo(Math.random() * 512, 140);
          ctx.lineTo(Math.random() * 512, 370);
          ctx.lineTo(Math.random() * 512, 512);
          ctx.stroke();
        }
      } else if (type === 'stadium_steel_grid') {
        // High-tech dark-grey industrial steel grid floor with team markings
        ctx.fillStyle = '#111318'; // Sleek dark metallic charcoal
        ctx.fillRect(0, 0, 512, 512);

        // Draw brushed steel plate seams (4x4 grids)
        ctx.strokeStyle = '#08090c';
        ctx.lineWidth = 3;
        for (let i = 0; i <= 512; i += 128) {
          ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 512); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(512, i); ctx.stroke();
        }

        // Draw diamond steel plating / tread plate indicators
        ctx.strokeStyle = '#2d3748'; // Steel grey rivets/treads
        ctx.lineWidth = 1.5;
        for (let x = 16; x < 512; x += 32) {
          for (let y = 16; y < 512; y += 32) {
            // Draw small diagonal slash marks
            ctx.beginPath();
            ctx.moveTo(x - 4, y - 4);
            ctx.lineTo(x + 4, y + 4);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x + 4, y - 4);
            ctx.lineTo(x - 4, y + 4);
            ctx.stroke();
          }
        }

        // Add sleek team floor lines: Blue West, Red East (split at center x = 256)
        // Draw blue hazard accents on left half
        ctx.strokeStyle = 'rgba(0, 136, 255, 0.4)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(32, 64); ctx.lineTo(192, 256); ctx.lineTo(32, 448);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0, 136, 255, 0.08)';
        ctx.beginPath();
        ctx.moveTo(32, 64); ctx.lineTo(192, 256); ctx.lineTo(32, 448);
        ctx.closePath();
        ctx.fill();

        // Draw red hazard accents on right half
        ctx.strokeStyle = 'rgba(255, 51, 68, 0.4)';
        ctx.beginPath();
        ctx.moveTo(480, 64); ctx.lineTo(320, 256); ctx.lineTo(480, 448);
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 51, 68, 0.08)';
        ctx.beginPath();
        ctx.moveTo(480, 64); ctx.lineTo(320, 256); ctx.lineTo(480, 448);
        ctx.closePath();
        ctx.fill();

        // Outer white safety border
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 6;
        ctx.strokeRect(6, 6, 500, 500);

        // Middle division line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(256, 6); ctx.lineTo(256, 506);
        ctx.stroke();

        // Octagonal center plate
        ctx.fillStyle = '#1e222b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        const cx = 256, cy = 256, r = 70;
        for (let i = 0; i < 8; i++) {
          const angle = (i * Math.PI) / 4;
          const px = cx + Math.cos(angle) * r;
          const py = cy + Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner glowing core ring in the center
        ctx.strokeStyle = '#00ccff';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(256, 256, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = '#ff0055';
        ctx.beginPath();
        ctx.arc(256, 256, 6, 0, Math.PI * 2);
        ctx.fill();
      } else if (type === 'stadium_scoreboard_screen') {
        // Championship Central Scoreboard Screen
        ctx.fillStyle = '#06080e';
        ctx.fillRect(0, 0, 512, 512);

        // Draw left side blue, right side red
        const grad = ctx.createLinearGradient(0, 0, 512, 0);
        grad.addColorStop(0, '#002244');
        grad.addColorStop(0.45, '#001122');
        grad.addColorStop(0.5, '#05070a');
        grad.addColorStop(0.55, '#220011');
        grad.addColorStop(1, '#440022');
        ctx.fillStyle = grad;
        ctx.fillRect(10, 10, 492, 492);

        // Tech Grid overlay
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.05)';
        ctx.lineWidth = 1.5;
        for (let i = 20; i < 500; i += 24) {
          ctx.beginPath(); ctx.moveTo(i, 10); ctx.lineTo(i, 502); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(10, i); ctx.lineTo(502, i); ctx.stroke();
        }

        // Tech Scanlines
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        for (let y = 10; y < 502; y += 4) {
          ctx.fillRect(10, y, 492, 2);
        }

        // Draw glowing yellow Spartan silhouette in the center!
        ctx.strokeStyle = '#eab308'; // Glowing gold yellow
        ctx.lineWidth = 4;
        ctx.shadowColor = '#eab308';
        ctx.shadowBlur = 15;
        
        ctx.beginPath();
        // Head / Helmet
        ctx.moveTo(246, 130); ctx.lineTo(266, 130); ctx.lineTo(274, 144); ctx.lineTo(266, 160); ctx.lineTo(246, 160); ctx.lineTo(238, 144); ctx.closePath();
        // Visor line
        ctx.moveTo(242, 142); ctx.lineTo(270, 142);
        // Chest / Shoulders
        ctx.moveTo(216, 180); ctx.lineTo(296, 180); ctx.lineTo(310, 204); ctx.lineTo(280, 250); ctx.lineTo(232, 250); ctx.lineTo(202, 204); ctx.closePath();
        // Left arm (Sword raise)
        ctx.moveTo(216, 180); ctx.lineTo(176, 160); ctx.lineTo(160, 186); ctx.lineTo(202, 204);
        // Right arm (Hammer carry)
        ctx.moveTo(296, 180); ctx.lineTo(336, 196); ctx.lineTo(346, 226); ctx.lineTo(280, 250);
        // Legs base
        ctx.moveTo(232, 250); ctx.lineTo(220, 310); ctx.lineTo(190, 380); ctx.lineTo(226, 380); ctx.lineTo(246, 310); ctx.lineTo(256, 270);
        ctx.moveTo(280, 250); ctx.lineTo(292, 310); ctx.lineTo(322, 380); ctx.lineTo(286, 380); ctx.lineTo(266, 310);
        ctx.stroke();

        // Energy Sword blade in left hand
        ctx.strokeStyle = '#00ffff';
        ctx.shadowColor = '#00ffff';
        ctx.shadowBlur = 20;
        ctx.beginPath();
        ctx.moveTo(160, 186); ctx.lineTo(110, 150); ctx.lineTo(136, 172); ctx.lineTo(160, 186);
        ctx.moveTo(160, 186); ctx.lineTo(102, 166); ctx.lineTo(136, 178); ctx.lineTo(160, 186);
        ctx.stroke();

        // Glowing Scoreboard stats
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00ffff';
        ctx.fillStyle = '#22d3ee';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('BLUE', 36, 80);
        ctx.font = 'bold 64px monospace';
        ctx.fillText('99', 42, 150);

        ctx.shadowColor = '#ff0055';
        ctx.fillStyle = '#ff2a6d';
        ctx.textAlign = 'right';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText('RED', 476, 80);
        ctx.font = 'bold 64px monospace';
        ctx.fillText('88', 470, 150);

        // Center Championship text
        ctx.shadowColor = '#eab308';
        ctx.fillStyle = '#facc15';
        ctx.font = '900 24px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GRIFBALL ARENA', 256, 440);
        ctx.font = 'bold 14px sans-serif';
        ctx.fillText('CHAMPIONSHIP SERIES V', 256, 470);
        
        ctx.shadowBlur = 0;
      } else if (type === 'stadium_advertisement_sapphire') {
        // Sapphire Burger holographic advertisement banner
        ctx.fillStyle = '#05040a';
        ctx.fillRect(0, 0, 512, 512);

        // Grid scanlines
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.05)';
        ctx.lineWidth = 1;
        for (let y = 0; y < 512; y += 8) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
        }

        // Draw glowing Hamburger outline
        ctx.strokeStyle = '#f59e0b'; // golden yellow bun
        ctx.lineWidth = 5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur = 14;
        
        // Top bun
        ctx.beginPath();
        ctx.arc(256, 210, 100, Math.PI, 0, false);
        ctx.lineTo(356, 210);
        ctx.quadraticCurveTo(256, 240, 156, 210);
        ctx.closePath();
        ctx.stroke();

        // Patty
        ctx.strokeStyle = '#ca8a04';
        ctx.beginPath();
        ctx.moveTo(150, 230);
        ctx.lineTo(362, 230);
        ctx.quadraticCurveTo(362, 256, 350, 256);
        ctx.lineTo(162, 256);
        ctx.quadraticCurveTo(150, 256, 150, 230);
        ctx.closePath();
        ctx.stroke();

        // Lettuce / cheese layers
        ctx.strokeStyle = '#22c55e'; // green lettuce
        ctx.beginPath();
        ctx.moveTo(156, 220);
        ctx.bezierCurveTo(180, 210, 210, 230, 256, 220);
        ctx.bezierCurveTo(300, 210, 330, 230, 356, 220);
        ctx.stroke();

        // Bottom Bun
        ctx.strokeStyle = '#f59e0b';
        ctx.beginPath();
        ctx.moveTo(160, 266);
        ctx.quadraticCurveTo(256, 250, 352, 266);
        ctx.quadraticCurveTo(352, 300, 330, 300);
        ctx.lineTo(182, 300);
        ctx.quadraticCurveTo(160, 300, 160, 266);
        ctx.closePath();
        ctx.stroke();

        // Ad texts
        ctx.shadowColor = '#06b6d4'; // bright cyan
        ctx.fillStyle = '#22d3ee';
        ctx.font = '900 48px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('SAPPHIRE BURGER', 256, 90);
        
        ctx.shadowColor = '#ec4899';
        ctx.fillStyle = '#f472b6';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('THE CHOICE OF CHAMPIONS', 256, 370);
        ctx.fillText('TASTY • ENERGIZING • PREMIUM', 256, 410);

        ctx.shadowBlur = 0;
      } else if (type === 'stadium_advertisement_gauss') {
        // Gauss Soda / Energy Drink advertisement
        ctx.fillStyle = '#060402';
        ctx.fillRect(0, 0, 512, 512);

        // Tech lines
        ctx.strokeStyle = 'rgba(234, 88, 12, 0.05)';
        ctx.lineWidth = 1;
        for (let x = 0; x < 512; x += 16) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 512); ctx.stroke();
        }

        // Draw soda can outline
        ctx.strokeStyle = '#ea580c'; // glowing neon orange
        ctx.lineWidth = 5;
        ctx.shadowColor = '#ea580c';
        ctx.shadowBlur = 14;

        ctx.strokeRect(200, 160, 112, 200); // can body
        ctx.strokeRect(216, 146, 80, 14);  // tab/lip top

        // Lightning bolt icon on can
        ctx.strokeStyle = '#eab308';
        ctx.shadowColor = '#eab308';
        ctx.beginPath();
        ctx.moveTo(266, 180);
        ctx.lineTo(230, 250);
        ctx.lineTo(260, 250);
        ctx.lineTo(246, 330);
        ctx.lineTo(282, 260);
        ctx.lineTo(252, 260);
        ctx.closePath();
        ctx.stroke();

        // Ad texts
        ctx.shadowColor = '#ea580c';
        ctx.fillStyle = '#ff7700';
        ctx.font = '900 56px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('GAUSS SODA', 256, 95);

        ctx.shadowColor = '#eab308';
        ctx.fillStyle = '#facc15';
        ctx.font = 'bold 24px sans-serif';
        ctx.fillText('HYPER-ACCELERATED ENERGY', 256, 420);
        ctx.font = 'italic 16px sans-serif';
        ctx.fillText('Warning: May cause anti-gravity physics side effects.', 256, 460);

        ctx.shadowBlur = 0;
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      if (type === 'winter_ice' || type === 'stadium_scoreboard_screen' || type === 'stadium_advertisement_sapphire' || type === 'stadium_advertisement_gauss') {
        texture.repeat.set(1, 1); // Stretched exactly once
      } else if (type === 'stadium_steel_grid') {
        texture.repeat.set(3, 3); // Beautiful steel grid tile repetition
      } else if (type === 'winter_snow' || type === 'winter_glacier_glass') {
        texture.repeat.set(2, 2); // Nice repeating details
      } else {
        texture.repeat.set(4, 4); // Tiled nicely
      }
      return texture;
    };

    // 2. SCENE LIGHTING DESIGN
    if (activeCustomMap) {
      // Custom Lights
      const ambientLight = new THREE.AmbientLight(
        activeCustomMap.lighting.ambientColor || '#0a0f1d',
        activeCustomMap.lighting.ambientIntensity ?? 0.85
      );
      scene.add(ambientLight);
      threeRef.current.ambientLight = ambientLight;

      const dirLight = new THREE.DirectionalLight(
        activeCustomMap.lighting.directColor || '#e0f2fe',
        activeCustomMap.lighting.directIntensity ?? 2.2
      );
      const dp = activeCustomMap.lighting.directPosition || { x: 6, y: 22, z: 6 };
      dirLight.position.set(dp.x, dp.y, dp.z);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 40;
      dirLight.shadow.camera.left = -22;
      dirLight.shadow.camera.right = 22;
      dirLight.shadow.camera.top = 22;
      dirLight.shadow.camera.bottom = -22;
      dirLight.shadow.bias = -0.0005;
      scene.add(dirLight);
      threeRef.current.dirLight = dirLight;

      // Spawn Point Lights
      if (activeCustomMap.lighting.pointLights) {
        activeCustomMap.lighting.pointLights.forEach(pl => {
          const pointLight = new THREE.PointLight(pl.color, pl.intensity, pl.distance, pl.decay);
          pointLight.position.set(pl.position.x, pl.position.y, pl.position.z);
          scene.add(pointLight);
        });
      }

      // Render Dynamic Custom Floor
      const r = activeCustomMap.arenaRadius;
      let floorGeo: THREE.BufferGeometry;
      if (activeCustomMap.mapShape === 'rectangular') {
        floorGeo = new THREE.BoxGeometry(r * 2.4, 0.2, r * 1.2);
      } else {
        floorGeo = new THREE.CylinderGeometry(r, r, 0.2, 64);
      }
      
      // Select appropriate theme floor texture
      let floorTexType: any = 'futuristic_hex';
      let floorColor = '#06b6d4';
      if (activeCustomMap.theme === 'hangar') {
        floorTexType = 'space_alloy';
        floorColor = '#475569';
      } else if (activeCustomMap.theme === 'rust') {
        floorTexType = 'city_concrete';
        floorColor = '#ea580c';
      } else if (activeCustomMap.theme === 'nature') {
        floorTexType = 'nature_grass';
        floorColor = '#34d399';
      } else if (activeCustomMap.theme === 'space') {
        floorTexType = 'space_lunar_dust';
        floorColor = '#94a3b8';
      } else if (activeCustomMap.theme === 'fantasy') {
        floorTexType = 'fantasy_cobble';
        floorColor = '#9ca3af';
      } else if (activeCustomMap.theme === 'forerunner') {
        floorTexType = 'forerunner_panel';
        floorColor = '#d97706';
      } else if (activeCustomMap.theme === 'synthwave') {
        floorTexType = 'synthwave_grid';
        floorColor = '#ec4899';
      } else if (activeCustomMap.theme === 'rainy_streets') {
        floorTexType = 'rainy_streets_asphalt';
        floorColor = '#0f121a';
      } else if (activeCustomMap.theme === 'winter_rink') {
        floorTexType = 'winter_ice';
        floorColor = '#e0f2fe';
      } else if (activeCustomMap.theme === 'grifball_stadium') {
        floorTexType = 'stadium_steel_grid';
        floorColor = '#1e222b';
      }

      const floorTexture = generateCustomTexture(floorTexType, '#0f172a');
      const floorMat = new THREE.MeshStandardMaterial({
        map: floorTexture,
        bumpMap: floorTexture,
        bumpScale: activeCustomMap.theme === 'winter_rink' ? 0.005 : (activeCustomMap.theme === 'grifball_stadium' ? 0.015 : 0.02),
        roughness: activeCustomMap.theme === 'winter_rink' ? 0.08 : (activeCustomMap.theme === 'grifball_stadium' ? 0.18 : 0.8),
        metalness: activeCustomMap.theme === 'winter_rink' ? 0.95 : (activeCustomMap.theme === 'grifball_stadium' ? 0.9 : 0.5),
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.position.y = -0.1;
      floor.receiveShadow = true;
      scene.add(floor);

      // Render Custom Obstacles/Objects!
      threeRef.current.customMapObjects = [];
      activeCustomMap.objects.forEach(obj => {
        let geo: THREE.BufferGeometry;
        const sx = obj.scale.x;
        const sy = obj.scale.y;
        const sz = obj.scale.z;

        if (obj.type === 'box') {
          geo = new THREE.BoxGeometry(sx, sy, sz);
        } else if (obj.type === 'cylinder') {
          geo = new THREE.CylinderGeometry(sx / 2, sx / 2, sy, 32);
        } else {
          geo = new THREE.SphereGeometry(sx / 2, 32, 32);
        }

        const hasTexture = obj.texture && obj.texture !== 'none';
        const texture = hasTexture ? generateCustomTexture(obj.texture, obj.color) : null;
        if (texture) {
          texture.needsUpdate = true;
        }
        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          color: hasTexture ? new THREE.Color('#ffffff') : new THREE.Color(obj.color),
          metalness: obj.metalness,
          roughness: obj.roughness,
          opacity: obj.opacity,
          transparent: obj.transparent,
        });

        if (obj.emissive && obj.emissive !== '#000000') {
          mat.emissive = new THREE.Color(obj.emissive);
          mat.emissiveIntensity = obj.emissiveIntensity;
        }

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
        mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        scene.add(mesh);
        threeRef.current.customMapObjects!.push(mesh);
      });

      // Spawn Synthwave scenery if theme is synthwave
      if (activeCustomMap.theme === 'synthwave') {
        const synthwaveGroup = new THREE.Group();
        synthwaveGroup.name = 'synthwave_scenery';

        // 1. Striped Gradient Sunset Sun Disc
        const sunCanvas = document.createElement('canvas');
        sunCanvas.width = 512;
        sunCanvas.height = 512;
        const sunCtx = sunCanvas.getContext('2d')!;
        
        const sunGrad = sunCtx.createLinearGradient(0, 50, 0, 462);
        sunGrad.addColorStop(0, '#ffe066'); // Golden yellow top
        sunGrad.addColorStop(0.5, '#ff007f'); // Neon pink middle
        sunGrad.addColorStop(1, '#9400d3'); // Purple violet bottom
        
        sunCtx.fillStyle = sunGrad;
        sunCtx.beginPath();
        sunCtx.arc(256, 256, 230, 0, Math.PI * 2);
        sunCtx.fill();

        // Horizontal slices (Outrun style)
        sunCtx.fillStyle = '#0a0518'; // Blends with atmospheric fog/sky
        for (let y = 250; y < 512; y += 18) {
          const thickness = Math.max(1.5, (y - 250) / 7.5);
          sunCtx.fillRect(0, y, 512, thickness);
        }

        const sunTexture = new THREE.CanvasTexture(sunCanvas);
        const sunMat = new THREE.MeshBasicMaterial({
          map: sunTexture,
          transparent: true,
          side: THREE.DoubleSide
        });
        const sunGeo = new THREE.PlaneGeometry(55, 55);
        const sunMesh = new THREE.Mesh(sunGeo, sunMat);
        sunMesh.position.set(0, 16, -72);
        synthwaveGroup.add(sunMesh);

        // 2. Skyscrapers Skyline Silhouettes
        const cityWidths = [12, 8, 14, 10, 6, 16, 9, 11, 13, 7, 15, 10];
        const cityHeights = [18, 28, 22, 34, 15, 20, 26, 32, 19, 29, 24, 17];
        const numBuildings = cityWidths.length;
        
        for (let i = 0; i < numBuildings; i++) {
          const w = cityWidths[i];
          const h = cityHeights[i];
          const d = 6;
          const x = -48 + (i * 9) + (Math.random() - 0.5) * 1.5;
          const y = h / 2 - 2;
          const z = -60 + (Math.random() - 0.5) * 2;

          const bGeo = new THREE.BoxGeometry(w, h, d);
          
          const bCanvas = document.createElement('canvas');
          bCanvas.width = 128;
          bCanvas.height = 256;
          const bCtx = bCanvas.getContext('2d')!;
          bCtx.fillStyle = '#05020c';
          bCtx.fillRect(0, 0, 128, 256);
          
          bCtx.fillStyle = i % 2 === 0 ? '#06b6d4' : '#ec4899';
          for (let wy = 24; wy < 240; wy += 20) {
            for (let wx = 12; wx < 116; wx += 16) {
              if (Math.random() < 0.6) {
                bCtx.fillRect(wx, wy, 6, 10);
              }
            }
          }

          const bTexture = new THREE.CanvasTexture(bCanvas);
          const bMat = new THREE.MeshStandardMaterial({
            map: bTexture,
            roughness: 0.9,
            metalness: 0.1,
            emissive: i % 2 === 0 ? '#06b6d4' : '#ec4899',
            emissiveIntensity: 0.2
          });

          const building = new THREE.Mesh(bGeo, bMat);
          building.position.set(x, y, z);
          synthwaveGroup.add(building);
        }

        // 3. Glowing Laser Beams
        const laserColors = ['#ec4899', '#06b6d4', '#eab308'];
        for (let i = 0; i < 9; i++) {
          const lGeo = new THREE.CylinderGeometry(0.12, 0.12, 100, 6);
          const col = laserColors[i % laserColors.length];
          const lMat = new THREE.MeshBasicMaterial({
            color: col,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending
          });
          const laser = new THREE.Mesh(lGeo, lMat);
          const lx = -45 + (i * 11.25);
          laser.position.set(lx, 40, -68);
          synthwaveGroup.add(laser);
        }

        // 4. Low-Poly Neon Palm Trees
        const buildSynthwavePalmTree = (leafColor: string, trunkColor: string) => {
          const treeGroup = new THREE.Group();
          const numSegments = 5;
          const trunkMat = new THREE.MeshStandardMaterial({
            color: '#08041d',
            roughness: 0.7,
            metalness: 0.8,
            emissive: trunkColor,
            emissiveIntensity: 1.5
          });

          let currentParent: THREE.Group | THREE.Mesh = treeGroup;
          for (let j = 0; j < numSegments; j++) {
            const segGeo = new THREE.CylinderGeometry(0.18 - j * 0.02, 0.23 - j * 0.02, 1.3, 8);
            const segment = new THREE.Mesh(segGeo, trunkMat);
            segment.position.y = j === 0 ? 0.65 : 1.2;
            segment.rotation.z = 0.08;
            currentParent.add(segment);
            currentParent = segment;
          }

          const leafMat = new THREE.MeshStandardMaterial({
            color: leafColor,
            emissive: leafColor,
            emissiveIntensity: 2.2,
            roughness: 0.3,
            metalness: 0.5,
            side: THREE.DoubleSide
          });

          const numLeaves = 7;
          for (let j = 0; j < numLeaves; j++) {
            const angle = (j * Math.PI * 2) / numLeaves;
            const leafGeo = new THREE.BoxGeometry(2.4, 0.06, 0.5);
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.geometry.translate(1.2, 0, 0);
            leaf.position.set(0, 0.65, 0);
            leaf.rotation.y = angle;
            leaf.rotation.z = 0.22;
            currentParent.add(leaf);
          }

          return treeGroup;
        };

        const palmPositionsZ = [-16, -6, 4, 14];
        palmPositionsZ.forEach((pz, idx) => {
          const leftPalm = buildSynthwavePalmTree('#ec4899', '#06b6d4');
          leftPalm.position.set(-23.5, 0, pz);
          leftPalm.scale.set(1.1, 1.1, 1.1);
          leftPalm.rotation.y = Math.PI / 4 + idx;
          synthwaveGroup.add(leftPalm);

          const rightPalm = buildSynthwavePalmTree('#06b6d4', '#ec4899');
          rightPalm.position.set(23.5, 0, pz + 1.0);
          rightPalm.scale.set(1.1, 1.1, 1.1);
          rightPalm.rotation.y = -Math.PI / 4 + idx;
          synthwaveGroup.add(rightPalm);
        });

        scene.add(synthwaveGroup);
        threeRef.current.customMapObjects!.push(synthwaveGroup);
      }

      // Spawn Rainy Streets scenery if theme is rainy_streets
      if (activeCustomMap.theme === 'rainy_streets') {
        const rainyGroup = new THREE.Group();
        rainyGroup.name = 'rainy_streets_scenery';

        // 1. Framing Skyscrapers Backdrop
        const buildingWidths = [14, 18, 16, 12, 20, 15, 12, 16];
        const buildingHeights = [32, 28, 42, 36, 25, 30, 48, 35];
        const buildingPositions = [
          { x: -32, z: -25 },
          { x: -32, z: 0 },
          { x: -32, z: 25 },
          { x: 32, z: -25 },
          { x: 32, z: 0 },
          { x: 32, z: 25 },
          { x: 0, z: -35 },
          { x: 15, z: -35 }
        ];

        buildingPositions.forEach((pos, idx) => {
          const w = buildingWidths[idx % buildingWidths.length];
          const h = buildingHeights[idx % buildingHeights.length];
          const d = 10;
          const bGeo = new THREE.BoxGeometry(w, h, d);
          
          const bCanvas = document.createElement('canvas');
          bCanvas.width = 128;
          bCanvas.height = 256;
          const bCtx = bCanvas.getContext('2d')!;
          bCtx.fillStyle = '#06080d';
          bCtx.fillRect(0, 0, 128, 256);
          
          bCtx.fillStyle = '#f97316';
          for (let wy = 20; wy < 240; wy += 24) {
            for (let wx = 12; wx < 116; wx += 16) {
              if (Math.random() < 0.25) {
                bCtx.fillRect(wx, wy, 8, 12);
              }
            }
          }
          
          const bTexture = new THREE.CanvasTexture(bCanvas);
          const bMat = new THREE.MeshStandardMaterial({
            map: bTexture,
            color: new THREE.Color('#0c0d12'),
            roughness: 0.1,
            metalness: 0.9,
            emissive: '#f97316',
            emissiveIntensity: 0.15
          });

          const building = new THREE.Mesh(bGeo, bMat);
          building.position.set(pos.x, h / 2 - 2, pos.z);
          if (pos.x < 0) building.rotation.y = 0.15;
          if (pos.x > 0) building.rotation.y = -0.15;
          
          rainyGroup.add(building);
        });

        // 2. Colossal Tech Dog Billboard on the top right
        const boardGeo = new THREE.BoxGeometry(10, 7, 0.4);
        const boardTexture = generateCustomTexture('rainy_streets_dog_billboard', '#06b6d4');
        const boardMat = new THREE.MeshBasicMaterial({
          map: boardTexture,
          transparent: true,
          side: THREE.DoubleSide
        });
        const boardMesh = new THREE.Mesh(boardGeo, boardMat);
        boardMesh.position.set(20, 15, -20);
        boardMesh.rotation.y = -Math.PI / 6;
        rainyGroup.add(boardMesh);

        // 3. Glowing Neon Green Sign on the Left Building
        const signCanvas = document.createElement('canvas');
        signCanvas.width = 128;
        signCanvas.height = 128;
        const sCtx = signCanvas.getContext('2d')!;
        sCtx.fillStyle = 'rgba(0,0,0,0)';
        sCtx.clearRect(0,0,128,128);
        sCtx.strokeStyle = '#22c55e';
        sCtx.lineWidth = 8;
        sCtx.shadowColor = '#22c55e';
        sCtx.shadowBlur = 15;
        sCtx.beginPath(); sCtx.arc(44, 64, 25, 0, Math.PI * 2); sCtx.stroke();
        sCtx.beginPath(); sCtx.arc(84, 64, 25, 0, Math.PI * 2); sCtx.stroke();
        sCtx.shadowBlur = 0;
        
        const signTexture = new THREE.CanvasTexture(signCanvas);
        const signMat = new THREE.MeshBasicMaterial({
          map: signTexture,
          transparent: true,
          side: THREE.DoubleSide
        });
        const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), signMat);
        signMesh.position.set(-20, 14, -10);
        signMesh.rotation.y = Math.PI / 4;
        rainyGroup.add(signMesh);

        // 4. Low-Poly Neon Green Palm Trees next to the court
        const buildGreenPalmTree = () => {
          const treeGroup = new THREE.Group();
          const numSegments = 5;
          const trunkMat = new THREE.MeshStandardMaterial({
            color: '#090514',
            roughness: 0.8,
            metalness: 0.9,
            emissive: '#166534',
            emissiveIntensity: 0.8
          });

          let currentParent = treeGroup as any;
          for (let j = 0; j < numSegments; j++) {
            const segGeo = new THREE.CylinderGeometry(0.18 - j * 0.02, 0.23 - j * 0.02, 1.3, 8);
            const segment = new THREE.Mesh(segGeo, trunkMat);
            segment.position.y = j === 0 ? 0.65 : 1.2;
            segment.rotation.z = 0.08;
            currentParent.add(segment);
            currentParent = segment;
          }

          const leafMat = new THREE.MeshStandardMaterial({
            color: '#22c55e',
            emissive: '#22c55e',
            emissiveIntensity: 2.2,
            roughness: 0.3,
            metalness: 0.5,
            side: THREE.DoubleSide
          });

          const numLeaves = 7;
          for (let j = 0; j < numLeaves; j++) {
            const angle = (j * Math.PI * 2) / numLeaves;
            const leafGeo = new THREE.BoxGeometry(2.4, 0.06, 0.5);
            const leaf = new THREE.Mesh(leafGeo, leafMat);
            leaf.geometry.translate(1.2, 0, 0);
            leaf.position.set(0, 0.65, 0);
            leaf.rotation.y = angle;
            leaf.rotation.z = 0.22;
            currentParent.add(leaf);
          }

          return treeGroup;
        };

        const treeZPositions = [-12, 0, 12];
        treeZPositions.forEach((tz) => {
          const leftTree = buildGreenPalmTree();
          leftTree.position.set(-21.5, 0, tz);
          leftTree.rotation.y = Math.random() * Math.PI;
          rainyGroup.add(leftTree);

          const rightTree = buildGreenPalmTree();
          rightTree.position.set(21.5, 0, tz + 2);
          rightTree.rotation.y = Math.random() * Math.PI;
          rainyGroup.add(rightTree);
        });

        // 5. Rain Particle System
        const rainCount = 1500;
        const rainGeo = new THREE.BufferGeometry();
        const rainPositions = new Float32Array(rainCount * 3);
        const rainVelocities = [];

        for (let i = 0; i < rainCount; i++) {
          const rx = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 3;
          const ry = Math.random() * 25 + 0.1;
          const rz = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2;
          
          rainPositions[i * 3] = rx;
          rainPositions[i * 3 + 1] = ry;
          rainPositions[i * 3 + 2] = rz;
          
          rainVelocities.push({
            x: -1 + Math.random() * 0.5,
            y: -15 - Math.random() * 8,
            z: (Math.random() - 0.5) * 0.4
          });
        }

        rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
        const rainMat = new THREE.PointsMaterial({
          color: '#a5f3fc',
          size: 0.18,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });

        const rainParticles = new THREE.Points(rainGeo, rainMat);
        rainParticles.name = 'rain_particles';
        rainParticles.userData = { velocities: rainVelocities, arenaRadius: activeCustomMap.arenaRadius };
        
        rainyGroup.add(rainParticles);

        scene.add(rainyGroup);
        threeRef.current.customMapObjects!.push(rainyGroup);
      }

      // Spawn Winter/Glacier scenery if theme is winter_rink
      if (activeCustomMap.theme === 'winter_rink') {
        const winterGroup = new THREE.Group();
        winterGroup.name = 'winter_scenery';

        const snowTexture = generateCustomTexture('winter_snow', '#ffffff');
        const glassTexture = generateCustomTexture('winter_glacier_glass', '#93c5fd');

        // 1. Giant Low-Poly Icebergs / Glaciers in the background
        const icebergPositions = [
          { x: -38, z: -40 },
          { x: -15, z: -48 },
          { x: 12, z: -45 },
          { x: 35, z: -38 },
          { x: -45, z: 5 },
          { x: 45, z: -5 }
        ];

        icebergPositions.forEach((pos, idx) => {
          const radius = 6 + Math.random() * 6;
          const height = 15 + Math.random() * 20;
          const iceGeo = new THREE.ConeGeometry(radius, height, 4); // 4-sided pyramid
          iceGeo.translate(0, height / 2, 0); // rest base on ground
          
          const iceMat = new THREE.MeshStandardMaterial({
            map: glassTexture,
            color: new THREE.Color('#93c5fd'),
            metalness: 0.95,
            roughness: 0.08,
            opacity: 0.8,
            transparent: true,
            emissive: new THREE.Color(idx % 2 === 0 ? '#3b82f6' : '#60a5fa'),
            emissiveIntensity: 1.8
          });

          const iceberg = new THREE.Mesh(iceGeo, iceMat);
          iceberg.position.set(pos.x, -1.0, pos.z);
          iceberg.rotation.y = Math.random() * Math.PI;
          iceberg.rotation.x = (Math.random() - 0.5) * 0.1;
          iceberg.castShadow = true;
          iceberg.receiveShadow = true;
          winterGroup.add(iceberg);
        });

        // 2. Snow Dunes / Banks surrounding the rink
        const duneGeo = new THREE.SphereGeometry(1, 16, 12);
        const duneMat = new THREE.MeshStandardMaterial({
          map: snowTexture,
          color: new THREE.Color('#ffffff'),
          roughness: 0.95,
          metalness: 0.05
        });

        const dunePositions = [
          { x: -26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
          { x: 26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
          { x: -26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
          { x: 26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
          { x: 0, y: -1.0, z: -15, sx: 35, sy: 2.0, sz: 14 },
          { x: 0, y: -1.0, z: 15, sx: 35, sy: 2.0, sz: 14 }
        ];

        dunePositions.forEach(d => {
          const mesh = new THREE.Mesh(duneGeo, duneMat);
          mesh.position.set(d.x, d.y, d.z);
          mesh.scale.set(d.sx, d.sy, d.sz);
          mesh.receiveShadow = true;
          winterGroup.add(mesh);
        });

        // 3. Snowy Pine Trees
        const buildSnowyPineTree = () => {
          const tree = new THREE.Group();

          // Trunk (nature_wood texture)
          const woodTexture = generateCustomTexture('nature_wood', '#451a03');
          const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 3.5, 8);
          const trunkMat = new THREE.MeshStandardMaterial({
            map: woodTexture,
            color: new THREE.Color('#3f2512'),
            roughness: 0.9,
            metalness: 0.1
          });
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.y = 1.75;
          trunk.castShadow = true;
          trunk.receiveShadow = true;
          tree.add(trunk);

          // Canopy Layers (Forest green branches + snow caps stacked)
          const pineMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#0f5132'), // dark green needles
            roughness: 0.95,
            metalness: 0.05
          });

          const canopyLayers = [
            { r: 2.4, h: 2.2, y: 3.2, snowH: 0.4 },
            { r: 1.8, h: 1.8, y: 4.6, snowH: 0.35 },
            { r: 1.2, h: 1.4, y: 5.8, snowH: 0.3 }
          ];

          canopyLayers.forEach(layer => {
            // Pine cone branches
            const pineGeo = new THREE.ConeGeometry(layer.r, layer.h, 6);
            pineGeo.translate(0, layer.h / 2, 0);
            const pine = new THREE.Mesh(pineGeo, pineMat);
            pine.position.y = layer.y;
            pine.castShadow = true;
            pine.receiveShadow = true;
            tree.add(pine);

            // Snowy cap resting on top of branches
            const capGeo = new THREE.ConeGeometry(layer.r + 0.05, layer.snowH, 6);
            capGeo.translate(0, layer.snowH / 2, 0);
            const cap = new THREE.Mesh(capGeo, duneMat);
            cap.position.y = layer.y + layer.h - layer.snowH * 0.9;
            cap.castShadow = true;
            cap.receiveShadow = true;
            tree.add(cap);
          });

          return tree;
        };

        const treePositions = [
          { x: -23, z: -15 },
          { x: -27, z: -5 },
          { x: -25, z: 8 },
          { x: 23, z: -16 },
          { x: 27, z: -4 },
          { x: 25, z: 9 },
          { x: -14, z: -17 },
          { x: 14, z: -17 }
        ];

        treePositions.forEach(pos => {
          const t = buildSnowyPineTree();
          t.position.set(pos.x, -0.2, pos.z);
          t.scale.set(0.9 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.3);
          t.rotation.y = Math.random() * Math.PI;
          winterGroup.add(t);
        });

        // 4. Soft Drifting Snow Weather Particles
        const snowCount = 1500;
        const snowGeo = new THREE.BufferGeometry();
        const snowPositions = new Float32Array(snowCount * 3);
        const snowVelocities = [];

        for (let i = 0; i < snowCount; i++) {
          const rx = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 3.2;
          const ry = Math.random() * 25 + 0.1;
          const rz = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.2;

          snowPositions[i * 3] = rx;
          snowPositions[i * 3 + 1] = ry;
          snowPositions[i * 3 + 2] = rz;

          snowVelocities.push({
            x: (Math.random() - 0.5) * 0.6,
            y: -1.8 - Math.random() * 1.6, // gentle fall speed
            z: (Math.random() - 0.5) * 0.6
          });
        }

        snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
        const snowMat = new THREE.PointsMaterial({
          color: '#ffffff',
          size: 0.34, // fluffy snow
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });

        const snowParticles = new THREE.Points(snowGeo, snowMat);
        snowParticles.name = 'snow_particles';
        snowParticles.userData = { velocities: snowVelocities, arenaRadius: activeCustomMap.arenaRadius };
        winterGroup.add(snowParticles);

      }
      
      // Spawn Winter/Glacier scenery if theme is winter_rink
      if (activeCustomMap.theme === 'winter_rink') {
        const winterGroup = new THREE.Group();
        winterGroup.name = 'winter_scenery';

        const snowTexture = generateCustomTexture('winter_snow', '#ffffff');
        const glassTexture = generateCustomTexture('winter_glacier_glass', '#93c5fd');

        // 1. Giant Low-Poly Icebergs / Glaciers in the background
        const icebergPositions = [
          { x: -38, z: -40 },
          { x: -15, z: -48 },
          { x: 12, z: -45 },
          { x: 35, z: -38 },
          { x: -45, z: 5 },
          { x: 45, z: -5 }
        ];

        icebergPositions.forEach((pos, idx) => {
          const radius = 6 + Math.random() * 6;
          const height = 15 + Math.random() * 20;
          const iceGeo = new THREE.ConeGeometry(radius, height, 4); // 4-sided pyramid
          iceGeo.translate(0, height / 2, 0); // rest base on ground
          
          const iceMat = new THREE.MeshStandardMaterial({
            map: glassTexture,
            color: new THREE.Color('#93c5fd'),
            metalness: 0.95,
            roughness: 0.08,
            opacity: 0.8,
            transparent: true,
            emissive: new THREE.Color(idx % 2 === 0 ? '#3b82f6' : '#60a5fa'),
            emissiveIntensity: 1.8
          });

          const iceberg = new THREE.Mesh(iceGeo, iceMat);
          iceberg.position.set(pos.x, -1.0, pos.z);
          iceberg.rotation.y = Math.random() * Math.PI;
          iceberg.rotation.x = (Math.random() - 0.5) * 0.1;
          iceberg.castShadow = true;
          iceberg.receiveShadow = true;
          winterGroup.add(iceberg);
        });

        // 2. Snow Dunes / Banks surrounding the rink
        const duneGeo = new THREE.SphereGeometry(1, 16, 12);
        const duneMat = new THREE.MeshStandardMaterial({
          map: snowTexture,
          color: new THREE.Color('#ffffff'),
          roughness: 0.95,
          metalness: 0.05
        });

        const dunePositions = [
          { x: -26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
          { x: 26, y: -0.6, z: -14, sx: 18, sy: 1.5, sz: 12 },
          { x: -26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
          { x: 26, y: -0.6, z: 14, sx: 18, sy: 1.5, sz: 12 },
          { x: 0, y: -1.0, z: -15, sx: 35, sy: 2.0, sz: 14 },
          { x: 0, y: -1.0, z: 15, sx: 35, sy: 2.0, sz: 14 }
        ];

        dunePositions.forEach(d => {
          const mesh = new THREE.Mesh(duneGeo, duneMat);
          mesh.position.set(d.x, d.y, d.z);
          mesh.scale.set(d.sx, d.sy, d.sz);
          mesh.receiveShadow = true;
          winterGroup.add(mesh);
        });

        // 3. Snowy Pine Trees
        const buildSnowyPineTree = () => {
          const tree = new THREE.Group();

          // Trunk (nature_wood texture)
          const woodTexture = generateCustomTexture('nature_wood', '#451a03');
          const trunkGeo = new THREE.CylinderGeometry(0.2, 0.35, 3.5, 8);
          const trunkMat = new THREE.MeshStandardMaterial({
            map: woodTexture,
            color: new THREE.Color('#3f2512'),
            roughness: 0.9,
            metalness: 0.1
          });
          const trunk = new THREE.Mesh(trunkGeo, trunkMat);
          trunk.position.y = 1.75;
          trunk.castShadow = true;
          trunk.receiveShadow = true;
          tree.add(trunk);

          // Canopy Layers (Forest green branches + snow caps stacked)
          const pineMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color('#0f5132'), // dark green needles
            roughness: 0.95,
            metalness: 0.05
          });

          const canopyLayers = [
            { r: 2.4, h: 2.2, y: 3.2, snowH: 0.4 },
            { r: 1.8, h: 1.8, y: 4.6, snowH: 0.35 },
            { r: 1.2, h: 1.4, y: 5.8, snowH: 0.3 }
          ];

          canopyLayers.forEach(layer => {
            // Pine cone branches
            const pineGeo = new THREE.ConeGeometry(layer.r, layer.h, 6);
            pineGeo.translate(0, layer.h / 2, 0);
            const pine = new THREE.Mesh(pineGeo, pineMat);
            pine.position.y = layer.y;
            pine.castShadow = true;
            pine.receiveShadow = true;
            tree.add(pine);

            // Snowy cap resting on top of branches
            const capGeo = new THREE.ConeGeometry(layer.r + 0.05, layer.snowH, 6);
            capGeo.translate(0, layer.snowH / 2, 0);
            const cap = new THREE.Mesh(capGeo, duneMat);
            cap.position.y = layer.y + layer.h - layer.snowH * 0.9;
            cap.castShadow = true;
            cap.receiveShadow = true;
            tree.add(cap);
          });

          return tree;
        };

        const treePositions = [
          { x: -23, z: -15 },
          { x: -27, z: -5 },
          { x: -25, z: 8 },
          { x: 23, z: -16 },
          { x: 27, z: -4 },
          { x: 25, z: 9 },
          { x: -14, z: -17 },
          { x: 14, z: -17 }
        ];

        treePositions.forEach(pos => {
          const t = buildSnowyPineTree();
          t.position.set(pos.x, -0.2, pos.z);
          t.scale.set(0.9 + Math.random() * 0.3, 0.8 + Math.random() * 0.4, 0.9 + Math.random() * 0.3);
          t.rotation.y = Math.random() * Math.PI;
          winterGroup.add(t);
        });

        // 4. Soft Drifting Snow Weather Particles
        const snowCount = 1500;
        const snowGeo = new THREE.BufferGeometry();
        const snowPositions = new Float32Array(snowCount * 3);
        const snowVelocities = [];

        for (let i = 0; i < snowCount; i++) {
          const rx = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 3.2;
          const ry = Math.random() * 25 + 0.1;
          const rz = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.2;

          snowPositions[i * 3] = rx;
          snowPositions[i * 3 + 1] = ry;
          snowPositions[i * 3 + 2] = rz;

          snowVelocities.push({
            x: (Math.random() - 0.5) * 0.6,
            y: -1.8 - Math.random() * 1.6, // gentle fall speed
            z: (Math.random() - 0.5) * 0.6
          });
        }

        snowGeo.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
        const snowMat = new THREE.PointsMaterial({
          color: '#ffffff',
          size: 0.34, // fluffy snow
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });

        const snowParticles = new THREE.Points(snowGeo, snowMat);
        snowParticles.name = 'snow_particles';
        snowParticles.userData = { velocities: snowVelocities, arenaRadius: activeCustomMap.arenaRadius };
        winterGroup.add(snowParticles);

        scene.add(winterGroup);
        threeRef.current.customMapObjects!.push(winterGroup);
      }

      // Spawn Championship Stadium Scenery if theme is grifball_stadium
      if (activeCustomMap.theme === 'grifball_stadium') {
        const stadiumGroup = new THREE.Group();
        stadiumGroup.name = 'stadium_scenery';

        // 1. Spectator Stands (Tiers of Bleachers)
        // North Bleachers
        for (let tier = 0; tier < 4; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(48, 1.2, 2.5),
            new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(0, tier * 1.0 + 0.6, -18 - tier * 2.0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // South Bleachers
        for (let tier = 0; tier < 4; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(48, 1.2, 2.5),
            new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(0, tier * 1.0 + 0.6, 18 + tier * 2.0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // West Bleachers (Behind Blue Goal)
        for (let tier = 0; tier < 3; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 1.2, 24),
            new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(-28 - tier * 2.0, tier * 1.0 + 0.6, 0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // East Bleachers (Behind Red Goal)
        for (let tier = 0; tier < 3; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 1.2, 24),
            new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(28 + tier * 2.0, tier * 1.0 + 0.6, 0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // 2. Corner Spotlight Towers with Glowing additive light cones
        const buildLightTower = (tx: number, tz: number, isBlue: boolean) => {
          const tower = new THREE.Group();
          
          // Structural truss pole
          const pillar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.45, 13, 8),
            new THREE.MeshStandardMaterial({ color: '#2d3748', metalness: 0.8, roughness: 0.25 })
          );
          pillar.position.y = 6.5;
          pillar.castShadow = true;
          pillar.receiveShadow = true;
          tower.add(pillar);

          // Head block for holding floodlight clusters
          const panelMat = new THREE.MeshStandardMaterial({
            color: '#1a202c',
            metalness: 0.9,
            roughness: 0.1,
            emissive: isBlue ? '#00ccff' : '#ff3344',
            emissiveIntensity: 2.2
          });
          const panel = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.2, 1.2), panelMat);
          panel.position.set(0, 13, 0);
          panel.rotation.x = Math.PI / 5; // Tilted down
          panel.rotation.y = tx < 0 ? -Math.PI / 4 : Math.PI / 4;
          tower.add(panel);

          // Glowing light panel emitter (white bulb area)
          const emitter = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.8, 0.1),
            new THREE.MeshBasicMaterial({ color: '#ffffff' })
          );
          emitter.position.set(0, 12.9, 0.55);
          emitter.rotation.copy(panel.rotation);
          tower.add(emitter);

          // Volumetric cone effect (Translucent additive blending)
          const coneGeo = new THREE.ConeGeometry(4.0, 18, 16, 1, true);
          coneGeo.translate(0, -9, 0); // rest apex at emitter
          const coneMat = new THREE.MeshBasicMaterial({
            color: isBlue ? '#00e5ff' : '#ff1744',
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
          });
          const cone = new THREE.Mesh(coneGeo, coneMat);
          cone.position.set(0, 13, 0);
          
          // Point beam towards center
          cone.lookAt(new THREE.Vector3(tx * 0.5, 0.5, tz * 0.5));
          tower.add(cone);

          tower.position.set(tx, 0, tz);
          return tower;
        };

        stadiumGroup.add(buildLightTower(-24, -14, true)); // NW Blue
        stadiumGroup.add(buildLightTower(-24, 14, true));  // SW Blue
        stadiumGroup.add(buildLightTower(24, -14, false)); // NE Red
        stadiumGroup.add(buildLightTower(24, 14, false));  // SE Red

        // 3. Colossal Floating Central Scoreboard
        const scoreboardBox = new THREE.Group();
        
        // Steel structural support cables / truss
        const supportTruss = new THREE.Mesh(
          new THREE.CylinderGeometry(0.35, 0.35, 12, 8),
          new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.85, roughness: 0.2 })
        );
        supportTruss.position.set(0, 21, 0);
        scoreboardBox.add(supportTruss);

        // Core score box shape
        const boxFrame = new THREE.Mesh(
          new THREE.BoxGeometry(6.4, 4.0, 6.4),
          new THREE.MeshStandardMaterial({ color: '#090d16', metalness: 0.95, roughness: 0.15 })
        );
        boxFrame.position.set(0, 15, 0);
        boxFrame.castShadow = true;
        boxFrame.receiveShadow = true;
        scoreboardBox.add(boxFrame);

        // Scoreboard upper/lower gold neon trims
        const trimMat = new THREE.MeshStandardMaterial({
          color: '#1a1f2c',
          emissive: '#eab308',
          emissiveIntensity: 2.2
        });
        const trimTop = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 6.6), trimMat);
        trimTop.position.set(0, 17, 0);
        scoreboardBox.add(trimTop);
        const trimBot = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 6.6), trimMat);
        trimBot.position.set(0, 13, 0);
        scoreboardBox.add(trimBot);

        // Scoreboard Screens
        const screenTexture = generateCustomTexture('stadium_scoreboard_screen', '#06080e');
        const screenMat = new THREE.MeshBasicMaterial({
          map: screenTexture,
          side: THREE.DoubleSide
        });

        // 4 Scoreboard Screens (facing N, S, E, W)
        const screenN = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
        screenN.position.set(0, 15, -3.22);
        screenN.rotation.y = Math.PI;
        scoreboardBox.add(screenN);

        const screenS = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
        screenS.position.set(0, 15, 3.22);
        scoreboardBox.add(screenS);

        const screenE = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
        screenE.position.set(3.22, 15, 0);
        screenE.rotation.y = Math.PI / 2;
        scoreboardBox.add(screenE);

        const screenW = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 3.2), screenMat);
        screenW.position.set(-3.22, 15, 0);
        screenW.rotation.y = -Math.PI / 2;
        scoreboardBox.add(screenW);

        stadiumGroup.add(scoreboardBox);

        // 4. Advertising Holographic Billboards (Sapphire Burger & Gauss Soda)
        const buildBillboard = (bx: number, bz: number, textureType: string) => {
          const billboard = new THREE.Group();
          
          // Metallic truss support pillars
          const poleLeft = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 12, 8),
            new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.3 })
          );
          poleLeft.position.set(-4.5, 6, 0);
          billboard.add(poleLeft);

          const poleRight = new THREE.Mesh(
            new THREE.CylinderGeometry(0.16, 0.16, 12, 8),
            new THREE.MeshStandardMaterial({ color: '#1e293b', metalness: 0.8, roughness: 0.3 })
          );
          poleRight.position.set(4.5, 6, 0);
          billboard.add(poleRight);

          // Screen back board
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(10.4, 5.4, 0.4),
            new THREE.MeshStandardMaterial({ color: '#0f121a', metalness: 0.9, roughness: 0.15 })
          );
          frame.position.set(0, 11, 0);
          billboard.add(frame);

          // Ad Banner Screen mesh
          const adTex = generateCustomTexture(textureType, '#000000');
          const adMat = new THREE.MeshBasicMaterial({
            map: adTex,
            side: THREE.DoubleSide
          });
          const screen = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 4.8), adMat);
          screen.position.set(0, 11, 0.22);
          billboard.add(screen);

          billboard.position.set(bx, 0, bz);
          if (bz < 0) {
            billboard.rotation.y = 0.1; // Angled slightly inside
          } else {
            billboard.rotation.y = Math.PI - 0.1;
          }

          return billboard;
        };

        stadiumGroup.add(buildBillboard(-14, -20, 'stadium_advertisement_sapphire'));
        stadiumGroup.add(buildBillboard(14, -20, 'stadium_advertisement_gauss'));
        stadiumGroup.add(buildBillboard(-14, 20, 'stadium_advertisement_gauss'));
        stadiumGroup.add(buildBillboard(14, 20, 'stadium_advertisement_sapphire'));

        // 5. Atmospheric Floating Dust Motes (Glowing energy sparkles in stadium)
        const dustCount = 400;
        const dustGeo = new THREE.BufferGeometry();
        const dustPositions = new Float32Array(dustCount * 3);
        for (let i = 0; i < dustCount; i++) {
          dustPositions[i * 3] = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.8;
          dustPositions[i * 3 + 1] = Math.random() * 12 + 0.1;
          dustPositions[i * 3 + 2] = (Math.random() - 0.5) * activeCustomMap.arenaRadius * 2.0;
        }
        dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
        const dustMat = new THREE.PointsMaterial({
          color: '#eab308',
          size: 0.14,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
        const dust = new THREE.Points(dustGeo, dustMat);
        dust.name = 'stadium_dust_particles';
        stadiumGroup.add(dust);

        scene.add(stadiumGroup);
        threeRef.current.customMapObjects!.push(stadiumGroup);
      }

      // Clear any pre-existing navigation mesh, force A* engine to rebuild on the fly
      threeRef.current.navMesh = undefined;

    } else {
      // BAKE ORIGINAL DEFAULT HANGAR/HOLODECK SCENE & LIGHTING
      // Deep slate blue ambient shadow fill
      const ambientColor = isHangar ? '#111827' : '#0a0f1d';
      const ambientLight = new THREE.AmbientLight(ambientColor, adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : (isHangar ? 0.65 : 0.85)); 
      scene.add(ambientLight);
      threeRef.current.ambientLight = ambientLight;

      // Warm high-bay directional sun light / cool holodeck directional light
      const dirLightColor = isHangar ? '#fffbeb' : '#e0f2fe';
      const dirLight = new THREE.DirectionalLight(dirLightColor, adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 2.2);
      dirLight.position.set(6, 22, 6);
      dirLight.castShadow = true;
      dirLight.shadow.mapSize.width = 1024;
      dirLight.shadow.mapSize.height = 1024;
      dirLight.shadow.camera.near = 0.5;
      dirLight.shadow.camera.far = 40;
      dirLight.shadow.camera.left = -22;
      dirLight.shadow.camera.right = 22;
      dirLight.shadow.camera.top = 22;
      dirLight.shadow.camera.bottom = -22;
      dirLight.shadow.bias = -0.0005;
      scene.add(dirLight);
      threeRef.current.dirLight = dirLight;

      // Primary warm amber central industrial pendant light / holographic core light
      const pointLightColor = isHangar ? '#ea580c' : '#06b6d4';
      const pointLight = new THREE.PointLight(pointLightColor, 2.5, 35);
      pointLight.position.set(0, 14, 0);
      scene.add(pointLight);

      // Procedural generation of 1024x1024 premium metallic textures
      const texSize = 1024;

      // DIFFUSE/ALBEDO CANVAS
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = texSize;
      diffCanvas.height = texSize;
      const dCtx = diffCanvas.getContext('2d')!;

      // BUMP MAP CANVAS
      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = texSize;
      bumpCanvas.height = texSize;
      const bCtx = bumpCanvas.getContext('2d')!;

      // ROUGHNESS MAP CANVAS
      const roughCanvas = document.createElement('canvas');
      roughCanvas.width = texSize;
      roughCanvas.height = texSize;
      const rCtx = roughCanvas.getContext('2d')!;

      if (isHangar) {
        // Fill base layers
        dCtx.fillStyle = '#161a22';
        dCtx.fillRect(0, 0, texSize, texSize);

        bCtx.fillStyle = '#808080'; // 128 height map baseline
        bCtx.fillRect(0, 0, texSize, texSize);

        rCtx.fillStyle = '#888888'; // base semi-matte metal
        rCtx.fillRect(0, 0, texSize, texSize);

        // Draw modular steel plate tiles (16x16 grid)
        const tileSize = 64; 
        for (let y = 0; y < texSize; y += tileSize) {
          for (let x = 0; x < texSize; x += tileSize) {
            // Organic slate color variation per plate
            const hueVal = 216 + Math.random() * 8;
            const satVal = 12 + Math.random() * 6;
            const lightVal = 10 + Math.random() * 5;
            dCtx.fillStyle = `hsl(${hueVal}, ${satVal}%, ${lightVal}%)`;
            dCtx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);

            // Diffuse bevel shadows
            dCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            dCtx.lineWidth = 1.5;
            dCtx.beginPath();
            dCtx.moveTo(x + tileSize - 1, y + 1);
            dCtx.lineTo(x + 1, y + 1);
            dCtx.lineTo(x + 1, y + tileSize - 1);
            dCtx.stroke();

            dCtx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
            dCtx.beginPath();
            dCtx.moveTo(x + tileSize - 1, y + 1);
            dCtx.lineTo(x + tileSize - 1, y + tileSize - 1);
            dCtx.lineTo(x + 1, y + tileSize - 1);
            dCtx.stroke();

            // Bump map seams (sunken)
            bCtx.strokeStyle = '#484848';
            bCtx.lineWidth = 2;
            bCtx.strokeRect(x + 0.5, y + 0.5, tileSize - 1, tileSize - 1);

            // Roughness map seams
            rCtx.fillStyle = '#a0a0a0';
            rCtx.fillRect(x, y, tileSize, 1);
            rCtx.fillRect(x, y, 1, tileSize);

            // Add plate corner rivets
            const offsets = [5, tileSize - 5];
            offsets.forEach(ox => {
              offsets.forEach(oy => {
                const rx = x + ox;
                const ry = y + oy;

                // Diffuse: shiny metal bolt head
                dCtx.fillStyle = '#374151';
                dCtx.beginPath();
                dCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
                dCtx.fill();
                dCtx.fillStyle = '#9ca3af';
                dCtx.beginPath();
                dCtx.arc(rx - 0.5, ry - 0.5, 0.8, 0, Math.PI * 2);
                dCtx.fill();

                // Bump map: rivets are raised
                bCtx.fillStyle = '#ffffff';
                bCtx.beginPath();
                bCtx.arc(rx, ry, 2.5, 0, Math.PI * 2);
                bCtx.fill();

                // Roughness map: rivets are polished and highly reflective
                rCtx.fillStyle = '#222222';
                rCtx.beginPath();
                rCtx.arc(rx, ry, 3.0, 0, Math.PI * 2);
                rCtx.fill();
              });
            });
          }
        }

        // Central drainage/ventilation trench grate running along Z-axis (middle X)
        const grateWidth = 96; 
        const gxStart = 512 - grateWidth / 2;
        const gxEnd = 512 + grateWidth / 2;

        // Diffuse trench channel
        dCtx.fillStyle = '#090c12';
        dCtx.fillRect(gxStart, 0, grateWidth, texSize);
        
        // Bump trench channel (sunken)
        bCtx.fillStyle = '#101010';
        bCtx.fillRect(gxStart, 0, grateWidth, texSize);

        // Roughness trench channel (very rough interior)
        rCtx.fillStyle = '#e2e8f0';
        rCtx.fillRect(gxStart, 0, grateWidth, texSize);

        // Frame borders for the trench
        dCtx.fillStyle = '#2d3748';
        dCtx.fillRect(gxStart - 4, 0, 4, texSize);
        dCtx.fillRect(gxEnd, 0, 4, texSize);

        dCtx.fillStyle = '#4a5568';
        dCtx.fillRect(gxStart - 1, 0, 1, texSize);
        dCtx.fillRect(gxEnd + 3, 0, 1, texSize);

        bCtx.fillStyle = '#b8b8b8'; // raised frame
        bCtx.fillRect(gxStart - 4, 0, 4, texSize);
        bCtx.fillRect(gxEnd, 0, 4, texSize);

        // Horizontal steel grate bars
        const barSpacing = 16;
        const barThickness = 6;
        for (let gy = 0; gy < texSize; gy += barSpacing) {
          // Diffuse steel bar
          dCtx.fillStyle = '#3f4b5e';
          dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);
          
          dCtx.fillStyle = '#5c6c84'; // bar highlights
          dCtx.fillRect(gxStart + 4, gy, grateWidth - 8, 1.5);

          // Rusty patches on grate bars
          if (Math.random() < 0.45) {
            dCtx.fillStyle = 'rgba(130, 60, 15, 0.5)'; // rust paint
            dCtx.fillRect(gxStart + 4 + Math.random() * (grateWidth - 24), gy + 1, 14, barThickness - 2);
          }

          // Bump: raised bars
          bCtx.fillStyle = '#a8a8a8';
          bCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);

          // Roughness: slightly reflective
          rCtx.fillStyle = '#475569';
          rCtx.fillRect(gxStart + 4, gy, grateWidth - 8, barThickness);
        }

        // Yellow & Black industrial hazard safety stripes alongside central trench
        const stripeWidth = 16;
        const stripeSpacing = 24;

        const drawHazardStripes = (xStart: number) => {
          // Yellow base
          dCtx.fillStyle = '#ca8a04';
          dCtx.fillRect(xStart, 0, stripeWidth, texSize);

          // Black diagonal bands
          dCtx.fillStyle = '#0f172a';
          for (let sy = -stripeWidth; sy < texSize; sy += stripeSpacing) {
            dCtx.beginPath();
            dCtx.moveTo(xStart, sy);
            dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth);
            dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth + 10);
            dCtx.lineTo(xStart, sy + 10);
            dCtx.closePath();
            dCtx.fill();
          }

          bCtx.fillStyle = '#808080';
          bCtx.fillRect(xStart, 0, stripeWidth, texSize);

          rCtx.fillStyle = '#94a3b8'; // rough warning paint
          rCtx.fillRect(xStart, 0, stripeWidth, texSize);
        };

        drawHazardStripes(gxStart - 20);
        drawHazardStripes(gxEnd + 4);

        // Weathering scratches
        for (let i = 0; i < 150; i++) {
          const sx = Math.random() * texSize;
          const sy = Math.random() * texSize;
          const len = 8 + Math.random() * 25;
          const angle = Math.random() * Math.PI * 2;
          const ex = sx + Math.cos(angle) * len;
          const ey = sy + Math.sin(angle) * len;

          dCtx.strokeStyle = 'rgba(0,0,0,0.3)';
          dCtx.lineWidth = 1.0;
          dCtx.beginPath();
          dCtx.moveTo(sx, sy);
          dCtx.lineTo(ex, ey);
          dCtx.stroke();

          dCtx.strokeStyle = 'rgba(255,255,255,0.06)';
          dCtx.beginPath();
          dCtx.moveTo(sx + 0.5, sy + 0.5);
          dCtx.lineTo(ex + 0.5, ey + 0.5);
          dCtx.stroke();

          bCtx.strokeStyle = '#585858';
          bCtx.lineWidth = 1;
          bCtx.beginPath();
          bCtx.moveTo(sx, sy);
          bCtx.lineTo(ex, ey);
          bCtx.stroke();

          rCtx.strokeStyle = '#111111'; // polished scratches are highly specular
          rCtx.lineWidth = 1;
          rCtx.beginPath();
          rCtx.moveTo(sx, sy);
          rCtx.lineTo(ex, ey);
          rCtx.stroke();
        }

        // Dirt and soot spray overlays
        for (let i = 0; i < 45; i++) {
          const dx = Math.random() * texSize;
          const dy = Math.random() * texSize;
          const rad = 25 + Math.random() * 75;

          const alGrad = dCtx.createRadialGradient(dx, dy, 0, dx, dy, rad);
          alGrad.addColorStop(0, 'rgba(40, 25, 12, 0.22)');
          alGrad.addColorStop(1, 'rgba(40, 25, 12, 0)');
          dCtx.fillStyle = alGrad;
          dCtx.beginPath();
          dCtx.arc(dx, dy, rad, 0, Math.PI * 2);
          dCtx.fill();

          const roGrad = rCtx.createRadialGradient(dx, dy, 0, dx, dy, rad);
          roGrad.addColorStop(0, 'rgba(200, 200, 200, 0.45)');
          roGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
          rCtx.fillStyle = roGrad;
          rCtx.beginPath();
          rCtx.arc(dx, dy, rad, 0, Math.PI * 2);
          rCtx.fill();
        }
      } else {
        // NEON CYAN HOLODECK PROCEDURAL TEXTURES
        // Deep slate space-blue floor
        dCtx.fillStyle = '#0a0f1d';
        dCtx.fillRect(0, 0, texSize, texSize);

        // Clean height map baseline
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, texSize, texSize);

        // Semi-glossy metallic surface roughness
        rCtx.fillStyle = '#333333';
        rCtx.fillRect(0, 0, texSize, texSize);

        // Draw clean neon cyan virtual space grid
        dCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)'; // cyan
        dCtx.lineWidth = 3;
        const step = 64;
        for (let i = 0; i <= texSize; i += step) {
          dCtx.beginPath();
          dCtx.moveTo(i, 0);
          dCtx.lineTo(i, texSize);
          dCtx.stroke();

          dCtx.beginPath();
          dCtx.moveTo(0, i);
          dCtx.lineTo(texSize, i);
          dCtx.stroke();
        }

        // Draw glowing concentric rings in center
        dCtx.strokeStyle = '#06b6d4';
        dCtx.lineWidth = 10;
        dCtx.beginPath();
        dCtx.arc(512, 512, 160, 0, Math.PI * 2);
        dCtx.stroke();

        dCtx.strokeStyle = 'rgba(6, 182, 212, 0.25)';
        dCtx.lineWidth = 32;
        dCtx.beginPath();
        dCtx.arc(512, 512, 160, 0, Math.PI * 2);
        dCtx.stroke();

        // Outer neon border ring
        dCtx.strokeStyle = '#06b6d4';
        dCtx.lineWidth = 14;
        dCtx.beginPath();
        dCtx.arc(512, 512, 500, 0, Math.PI * 2);
        dCtx.stroke();

        dCtx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
        dCtx.lineWidth = 40;
        dCtx.beginPath();
        dCtx.arc(512, 512, 500, 0, Math.PI * 2);
        dCtx.stroke();
        
        // Bump map highlights for grid seams
        bCtx.strokeStyle = '#606060';
        bCtx.lineWidth = 3;
        for (let i = 0; i <= texSize; i += step) {
          bCtx.strokeRect(i - 1, -1, 2, texSize + 2);
          bCtx.strokeRect(-1, i - 1, texSize + 2, 2);
        }
      }

      // Create textures
      const floorTexture = new THREE.CanvasTexture(diffCanvas);
      floorTexture.wrapS = THREE.RepeatWrapping;
      floorTexture.wrapT = THREE.RepeatWrapping;

      const floorBumpMap = new THREE.CanvasTexture(bumpCanvas);
      floorBumpMap.wrapS = THREE.RepeatWrapping;
      floorBumpMap.wrapT = THREE.RepeatWrapping;

      const floorRoughnessMap = new THREE.CanvasTexture(roughCanvas);
      floorRoughnessMap.wrapS = THREE.RepeatWrapping;
      floorRoughnessMap.wrapT = THREE.RepeatWrapping;

      // Floor Mesh
      const floorGeo = new THREE.CylinderGeometry(20, 20, 0.2, 64);
      const floorMat = new THREE.MeshStandardMaterial({
        map: floorTexture,
        bumpMap: floorBumpMap,
        bumpScale: 0.04,
        roughnessMap: floorRoughnessMap,
        roughness: 1.0,
        metalness: 0.8,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.position.y = -0.1;
      floor.receiveShadow = true;
      scene.add(floor);

      if (isHangar) {
        // CONTINUOUS PERIMETER WALL ENCLOSURE
        const wallGroup = new THREE.Group();
        wallGroup.name = 'hangarWallGroup';
        scene.add(wallGroup);

        const wallPlateMat = new THREE.MeshStandardMaterial({
          color: '#1e2530', // dark metal plating
          roughness: 0.6,
          metalness: 0.75,
        });

        const trimMat = new THREE.MeshStandardMaterial({
          color: '#92400e', // rusty hazard orange
          roughness: 0.8,
          metalness: 0.4,
        });

        const darkMetalMat = new THREE.MeshStandardMaterial({
          color: '#111827', // frame components
          roughness: 0.9,
          metalness: 0.8,
        });

        // 12 sides wall generation
        const wallRadius = 20.6;
        for (let i = 0; i < 12; i++) {
          const angle = (i * Math.PI) / 6;
          const midAngle = angle + Math.PI / 12;
          const wx = Math.cos(midAngle) * wallRadius;
          const wz = Math.sin(midAngle) * wallRadius;

          const panel = new THREE.Group();
          panel.position.set(wx, 6, wz);

          // Main structural plate (10.68m width spans perfectly between columns)
          const plate = new THREE.Mesh(new THREE.BoxGeometry(10.68, 12, 0.15), wallPlateMat);
          plate.receiveShadow = true;
          plate.castShadow = true;
          panel.add(plate);

          // Rusty horizontal framing rails
          const topRail = new THREE.Mesh(new THREE.BoxGeometry(10.68, 0.3, 0.28), trimMat);
          topRail.position.y = 3.5;
          panel.add(topRail);

          const bottomRail = new THREE.Mesh(new THREE.BoxGeometry(10.68, 0.3, 0.28), trimMat);
          bottomRail.position.y = -3.5;
          panel.add(bottomRail);

          // Central exhaust air vent
          const ventFrame = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 0.2), darkMetalMat);
          ventFrame.position.y = 1.0;
          panel.add(ventFrame);

          const ventSlatGeo = new THREE.BoxGeometry(2.0, 0.1, 0.22);
          for (let vy = 0.4; vy >= -0.4; vy -= 0.25) {
            const slat = new THREE.Mesh(ventSlatGeo, wallPlateMat);
            slat.position.set(0, 1.0 + vy, 0.02);
            slat.rotation.x = 0.3; // tilted ventilation slats
            panel.add(slat);
          }

          // Horizontal metal pipeline running along the wall base
          const pipeGeo = new THREE.CylinderGeometry(0.12, 0.12, 10.68, 8);
          pipeGeo.rotateZ(Math.PI / 2); // orient horizontal
          const conduitPipe = new THREE.Mesh(pipeGeo, darkMetalMat);
          conduitPipe.position.set(0, -2.5, 0.2);
          panel.add(conduitPipe);

          panel.lookAt(0, 6, 0); // rotate to perfectly face arena center
          wallGroup.add(panel);
        }

        // MASSIVE H-BEAM STRUCTURAL SUPPORT COLUMNS (12 pillars)
        const girderMat = new THREE.MeshStandardMaterial({
          color: '#8f4f1f', // rusty industrial orange/brown
          roughness: 0.85,
          metalness: 0.5,
        });

        const steelGreyMat = new THREE.MeshStandardMaterial({
          color: '#374151', // structural steel
          roughness: 0.7,
          metalness: 0.8,
        });

        const pillarLightMat = new THREE.MeshStandardMaterial({
          color: '#f59e0b',
          emissive: '#d97706',
          emissiveIntensity: 1.2,
        });

        for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
          const cx = Math.cos(angle) * 20.3;
          const cz = Math.sin(angle) * 20.3;

          const column = new THREE.Group();
          column.position.set(cx, 2, cz);
          column.userData.angle = angle; // Store angle for dynamic scaling relocation!

          // Column structural assembly
          const structGroup = new THREE.Group();
          column.add(structGroup);

          // Heavy base plate
          const basePlate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 1.5), steelGreyMat);
          basePlate.position.y = -1.85;
          basePlate.receiveShadow = true;
          structGroup.add(basePlate);

          // H-beam Web plate
          const web = new THREE.Mesh(new THREE.BoxGeometry(0.1, 12, 0.8), girderMat);
          web.position.y = 4.0;
          web.castShadow = true;
          web.receiveShadow = true;
          structGroup.add(web);

          // H-beam Flange plates
          const flangeFront = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.1), girderMat);
          flangeFront.position.set(0, 4.0, 0.4);
          flangeFront.castShadow = true;
          flangeFront.receiveShadow = true;
          structGroup.add(flangeFront);

          const flangeBack = new THREE.Mesh(new THREE.BoxGeometry(0.8, 12, 0.1), girderMat);
          flangeBack.position.set(0, 4.0, -0.4);
          flangeBack.castShadow = true;
          flangeBack.receiveShadow = true;
          structGroup.add(flangeBack);

          // Horizontal reinforcing cuffs
          [0.0, 3.5, 7.0].forEach(cy => {
            const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.15, 0.95), steelGreyMat);
            cuff.position.y = cy - 1.5;
            structGroup.add(cuff);
          });

          // Energy and Indicator details
          const indicatorGroup = new THREE.Group();
          column.add(indicatorGroup);

          // Glowing dome
          const warningDome = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), pillarLightMat);
          warningDome.position.set(0, 2.5, 0.52);
          indicatorGroup.add(warningDome);

          // PointLight on cross pillars
          if (Math.abs(angle % (Math.PI / 2)) < 0.1) {
            const columnLight = new THREE.PointLight('#f59e0b', 3.0, 16);
            columnLight.position.set(0, 2.5, 0.8);
            indicatorGroup.add(columnLight);
          }

          column.lookAt(0, 2, 0); // Outward facing
          scene.add(column);
        }

        // CEILING TRUSSES & OVERHEAD HEAVY INDUSTRIAL STRUCTURAL GIRDERS
        const girderGroup = new THREE.Group();
        scene.add(girderGroup);

        const gridPositions = [-15, 0, 15];

        // Z-axis spanning girders
        gridPositions.forEach(zOffset => {
          const truss = new THREE.Group();
          truss.position.set(0, 11, zOffset);

          const topChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
          topChord.position.y = 0.5;
          topChord.castShadow = true;
          topChord.receiveShadow = true;
          truss.add(topChord);

          const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
          bottomChord.position.y = -0.5;
          bottomChord.castShadow = true;
          bottomChord.receiveShadow = true;
          truss.add(bottomChord);

          for (let tx = -24; tx <= 24; tx += 4) {
            const dLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
            dLeft.position.set(tx - 0.9, 0, 0);
            dLeft.rotation.z = Math.PI / 4;
            dLeft.castShadow = true;
            truss.add(dLeft);

            const dRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
            dRight.position.set(tx + 0.9, 0, 0);
            dRight.rotation.z = -Math.PI / 4;
            dRight.castShadow = true;
            truss.add(dRight);
          }
          girderGroup.add(truss);
        });

        // X-axis spanning girders
        gridPositions.forEach(xOffset => {
          const truss = new THREE.Group();
          truss.position.set(xOffset, 11.2, 0);
          truss.rotation.y = Math.PI / 2;

          const topChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
          topChord.position.y = 0.5;
          topChord.castShadow = true;
          topChord.receiveShadow = true;
          truss.add(topChord);

          const bottomChord = new THREE.Mesh(new THREE.BoxGeometry(50, 0.25, 0.4), girderMat);
          bottomChord.position.y = -0.5;
          bottomChord.castShadow = true;
          bottomChord.receiveShadow = true;
          truss.add(bottomChord);

          for (let tz = -24; tz <= 24; tz += 4) {
            const dLeft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
            dLeft.position.set(tz - 0.9, 0, 0);
            dLeft.rotation.z = Math.PI / 4;
            dLeft.castShadow = true;
            truss.add(dLeft);

            const dRight = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.25, 0.3), steelGreyMat);
            dRight.position.set(tz + 0.9, 0, 0);
            dRight.rotation.z = -Math.PI / 4;
            dRight.castShadow = true;
            truss.add(dRight);
          }
          girderGroup.add(truss);
        });

        // VOLUMETRIC LIGHT SHAFTS / GOD RAYS
        const rayGroup = new THREE.Group();
        scene.add(rayGroup);

        const rayGeo = new THREE.CylinderGeometry(0.6, 3.8, 25, 16, 1, true);
        const rayMat = new THREE.MeshBasicMaterial({
          color: '#ffdfa9', // warm golden sun rays
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        });

        const rayOffsets = [
          { x: -9, z: -9 },
          { x: 5, z: 7 },
          { x: -2, z: 1 }
        ];

        rayOffsets.forEach(offset => {
          const ray = new THREE.Mesh(rayGeo, rayMat);
          ray.position.set(offset.x + 3.0, 9.5, offset.z + 3.0);
          ray.rotation.x = 0.24;
          ray.rotation.z = -0.24;
          rayGroup.add(ray);
        });
      }
    }

    // 4. PROGRAMMATIC VOXEL CHARACTER ENEMY
    if (!replayData) {
      if (isMultiplayer) {
        // Multiplayer: enemyGroup renders the remote client (Red) in observer mode;
        // hidden for host/client roles. Not used for main_ai offline bot rendering.
        const enemyGroup = buildVoxelSpartanModel(true, botColors['main_ai']);
        enemyGroup.position.copy(new THREE.Vector3(0, 0, -12));
        enemyGroup.userData.appliedHue = botColors['main_ai'];
        scene.add(enemyGroup);
        threeRef.current.enemyGroup = enemyGroup;
        enemyGroup.visible = false;

        const enemyHammer = buildGravityHammerModel();
        enemyHammer.scale.set(0.6, 0.6, 0.6);
        enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4);
        enemyHammer.rotation.set(Math.PI / 2, 0, 0);
        if (enemyGroup.userData.upperTorso) {
          enemyGroup.userData.upperTorso.add(enemyHammer);
        } else {
          enemyGroup.add(enemyHammer);
        }
        threeRef.current.enemyHammer = enemyHammer;

        const enemySword = buildKatarSwordModel();
        enemySword.scale.set(0.6, 0.6, 0.6);
        enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
        enemySword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        enemySword.visible = false;
        if (enemyGroup.userData.upperTorso) {
          enemyGroup.userData.upperTorso.add(enemySword);
        } else {
          enemyGroup.add(enemySword);
        }
        threeRef.current.enemySword = enemySword;
      } else {
        // Offline: unified roster — main_ai + bot_* via orchestrator seed
        const s = stateRef.current;
        seedOfflineRoster(
          {
            roster: s.otherPlayers,
            settings: s.settings,
            legacy: getLegacyRosterProps(),
            offlineBotCount: offlineBotCountRef.current,
            playerPos: s.playerPos,
            isPlaying: true,
            coordinator: s.aiMatchContext.coordinator,
            mainAiParams: {},
          },
          buildOrchestratorSpawnCallbacks(),
          {
            ...buildOrchestratorEvents({ silentSpawn: true }),
            onPlayerPositioned: (yaw) => {
              s.yaw = yaw;
            },
          }
        );
      }
    }

    // 5. FIRST-PERSON WEAPON CONTAINER
    const fpWeaponContainer = new THREE.Group();
    camera.add(fpWeaponContainer); // Anchored as camera child
    
    // Build the gravity hammer model
    const playerHammer = buildGravityHammerModel(adminSettings.playerHue);
    // Neutral positioning (placed on right of screen, angled neatly forward)
    playerHammer.position.set(0.35, -0.38, -0.65);
    playerHammer.rotation.set(0.15, -0.3, -0.15); // standard idle poise
    fpWeaponContainer.add(playerHammer);
    threeRef.current.playerHammer = playerHammer;

    // Build the katar sword model
    const playerSword = buildKatarSwordModel(adminSettings.playerHue);
    // Neutral positioning (placed on right side, angled forward)
    playerSword.position.set(0.35, -0.38, -0.5);
    playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8); // Points forward, tilted slightly inwards
    playerSword.visible = false; // Initially inactive (starts with hammer)
    fpWeaponContainer.add(playerSword);
    threeRef.current.playerSword = playerSword;

    // Build the secret pistol model
    const playerPistol = buildPistolModel(adminSettings.playerHue);
    // Neutral positioning (placed on right side, pointing forward)
    playerPistol.position.set(0.25, -0.28, -0.4);
    playerPistol.rotation.set(0, 0, 0); // pointing straight
    playerPistol.visible = false;
    fpWeaponContainer.add(playerPistol);
    threeRef.current.playerPistol = playerPistol;

    // 6. DEBUG TRACE SHIELD/SPHERE MESH
    const debugGeo = new THREE.SphereGeometry(4.5, 32, 16);
    const debugPlayerMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const debugPlayerSphere = new THREE.Mesh(debugGeo, debugPlayerMat);
    scene.add(debugPlayerSphere);
    threeRef.current.debugPlayerSphere = debugPlayerSphere;

    const debugEnemyMat = new THREE.MeshBasicMaterial({
      color: 0xef4444, // red for damage check
      wireframe: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const debugEnemySphere = new THREE.Mesh(debugGeo, debugEnemyMat);
    scene.add(debugEnemySphere);
    threeRef.current.debugEnemySphere = debugEnemySphere;

    // 7. HAMMER JUMP ZONE VISUALIZER (Amber flat glowing ring on the ground)
    const jumpZoneGeo = new THREE.RingGeometry(0.96, 1.0, 64);
    // Orient it flat on ground plane
    jumpZoneGeo.rotateX(-Math.PI / 2);
    const jumpZoneMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b, // beautiful golden amber
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0, // updated in render loop
      depthWrite: false,
    });
    const playerJumpZoneMesh = new THREE.Mesh(jumpZoneGeo, jumpZoneMat);
    scene.add(playerJumpZoneMesh);
    threeRef.current.playerJumpZoneMesh = playerJumpZoneMesh;

    // Setup input listeners
    const handleKeyDown = (e: KeyboardEvent) => {
      // Handle Enter key for multiplayer chat activation
      if (e.key === 'Enter') {
        const chatInput = document.getElementById('chat-input-field') as HTMLInputElement | null;
        if (chatInput) {
          if (document.activeElement === chatInput) {
            // Already active, click the send button to broadcast
            const sendBtn = document.getElementById('chat-send-btn');
            if (sendBtn) sendBtn.click();
          } else {
            // Remove pointer-lock with backward-compatibility safety
            if (document.exitPointerLock) {
              document.exitPointerLock();
            }
            chatInput.focus();
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      }

      // Block any further action if they are focused in the input element typing
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const key = e.key.toLowerCase();
      keysPressed.current[key] = true;

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (key === 'v') {
          const modes: ('free' | 'third' | 'first')[] = ['free', 'third', 'first'];
          const currentIdx = modes.indexOf(s.observerCamMode);
          const nextMode = modes[(currentIdx + 1) % modes.length];
          s.observerCamMode = nextMode;
          console.log('Spectator Camera mode cycled to:', nextMode);
          s.yaw = Math.PI;
          s.pitch = -0.2;
          pushStatsUpdate();
          return;
        }

        if (key === 'arrowleft' || key === 'arrowright' || key === '1' || key === '2') {
          if (replayData) {
            if (key === 'arrowleft' || key === 'arrowright') {
              cycleReplayTarget(key === 'arrowleft' ? 'prev' : 'next');
              return;
            } else {
              const playerIds = replayPlayerIdsRef.current;
              const idx = key === '1' ? 0 : 1;
              if (playerIds && playerIds[idx]) {
                replayTargetIdRef.current = playerIds[idx];
                if (s.observerCamMode === 'free') {
                  s.observerCamMode = 'third';
                }
                console.log('Replay Cam Target set to:', replayTargetIdRef.current);
                pushStatsUpdate();
              }
              return;
            }
          }

          if (key === '1') {
            s.observerTarget = 'host';
          } else if (key === '2') {
            s.observerTarget = 'client';
          } else {
            s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
          }
          console.log('Spectator Target toggled to:', s.observerTarget);
          pushStatsUpdate();
          return;
        }

        // Allow ESC to fall through for pausing
        if (e.key === 'Escape') {
          onPauseToggle();
        }

        // Allow Space and C to fall through to keysPressed for flying rises/descends
        if (key === keybindingsRef.current.crouch || key === keybindingsRef.current.jump || key === 'spacebar' || key === keybindingsRef.current.moveForward || key === keybindingsRef.current.moveLeft || key === keybindingsRef.current.moveBackward || key === keybindingsRef.current.moveRight || key === 'shift') {
          // let flyer keys pass
        } else {
          return; // Ignore other standard hotkeys
        }
      }

      // Handle Escape toggle directly
      if (e.key === 'Escape') {
        onPauseToggle();
      }

      // Crouch toggles
      if (key === keybindingsRef.current.crouch) {
        stateRef.current.isCrouching = true;
        sfx.playCrouch();
      }

      // Scoreboard toggles (holding U)
      if (key === keybindingsRef.current.scoreboard) {
        stateRef.current.showScoreboard = true;
        pushStatsUpdate();
      }

      // Weapon swapping hotkeys
      if (key === keybindingsRef.current.weapon1) {
        swapPlayerWeapon('hammer');
      }
      if (key === keybindingsRef.current.weapon2) {
        swapPlayerWeapon('sword');
      }

      // Jump initiates
      if (key === keybindingsRef.current.jump || key === 'spacebar') {
        const s = stateRef.current;
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying) {
          if (s.pHammerJumpWindowTimer > 0) {
            // Hammer jump boost!
            s.isJumping = true;
            s.playerVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
            s.pHammerJumpWindowTimer = 0; // Consume the window
            sfx.playJump();
            // Spawn beautiful fire/wind blast shockwave particles under feet
            spawnVoxelShockwaveParticles(s.playerPos, '#f59e0b');
          } else if (!s.isJumping) {
            // Standard jump
            s.isJumping = true;
            s.playerVel.y = 7.2;
            sfx.playJump();
          }
        }
      }

      // Dash initiates
      if (key === keybindingsRef.current.dash) {
        const s = stateRef.current;
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying && s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0) {
          let fMove = 0;
          let rMove = 0;
          if (keysPressed.current[keybindingsRef.current.moveForward] || keysPressed.current['arrowup']) fMove += 1;
          if (keysPressed.current[keybindingsRef.current.moveBackward] || keysPressed.current['arrowdown']) fMove -= 1;
          if (keysPressed.current[keybindingsRef.current.moveRight] || keysPressed.current['arrowright']) rMove += 1;
          if (keysPressed.current[keybindingsRef.current.moveLeft] || keysPressed.current['arrowleft']) rMove -= 1;

          const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
          const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

          const dDir = new THREE.Vector3(0, 0, 0);
          if (fMove !== 0 || rMove !== 0) {
            dDir.addScaledVector(forwardDir, fMove).addScaledVector(rightDir, rMove).normalize();
          } else {
            dDir.copy(forwardDir).normalize();
          }

          s.playerDashDir.copy(dDir);
          s.playerDashRemaining = s.settings.dashDuration || 0.25;
          s.playerDashCooldownTimer = s.settings.dashCooldown || 2.0;
          recordLocalPlayerObservation((model) => {
            observePlayerDash(model, dDir.x, dDir.z);
            if (!isMultiplayer && mai()!.hp > 0 && mai()!.weaponState === 'swing_up') {
              observePlayerReaction(model, mai()!.weaponTimer ?? 0);
            }
          });
          sfx.playDash();
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }
      const key = e.key.toLowerCase();
      keysPressed.current[key] = false;

      if (key === keybindingsRef.current.crouch) {
        stateRef.current.isCrouching = false;
      }

      if (key === keybindingsRef.current.scoreboard) {
        stateRef.current.showScoreboard = false;
        pushStatsUpdate();
      }
    };

    // Pointer Lock Handlers
    const handleCanvasMouseDown = (e: MouseEvent) => {
      if (!isPlaying || isPausedRef.current) return;

      // Request pointer lock on container
      if (renderer.domElement.requestPointerLock) {
        renderer.domElement.requestPointerLock();
      }

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (e.button === 0) {
          if (replayData) {
            cycleReplayTarget('next');
          } else {
            s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
            console.log('Spectator Target cycled to:', s.observerTarget);
            pushStatsUpdate();
          }
        }
        return;
      }

      if (s.playerHP <= 0) return;

      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const clickedBtn = mouseMap[e.button] || '';

      if (clickedBtn === keybindingsRef.current.attack) {
        // PRIMARY ATTACK: Hammer Slam, Sword Lunge, or Pistol Fire
        if (s.activeWeapon === 'hammer') {
          if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
            triggerPlayerHammerSwing();
          }
        } else if (s.activeWeapon === 'pistol') {
          if (s.pPistolReady && s.pPistolState === 'ready') {
            triggerPlayerPistolFire();
          }
        } else {
          // SWORD LUNGE
          if (s.crosshairColor === 'red' && s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordLunge();
          }
        }
      } else if (clickedBtn === keybindingsRef.current.altAttack) {
        // ALT ATTACK: Sword Slash or Hammer Melee
        if (s.activeWeapon === 'sword') {
          if (s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordSlash();
          }
        } else if (s.activeWeapon === 'hammer') {
          if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
            triggerPlayerHammerMelee();
          }
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (!isPlaying || isPausedRef.current) return;

      const s = stateRef.current;
      if (s.isObserverMode) {
        if (s.observerCamMode === 'third') {
          // Adjust orbital camera distance
          const zoomSpeed = 0.55;
          s.observerOrbitDistance = Math.max(2.0, Math.min(22.0, s.observerOrbitDistance + (e.deltaY > 0 ? zoomSpeed : -zoomSpeed)));
          pushStatsUpdate();
        }
        return;
      }

      if (s.playerHP <= 0 || s.isLunging) return;

      const current = s.activeWeapon;
      const next = current === 'hammer' ? 'sword' : 'hammer';
      swapPlayerWeapon(next);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handlePointerLockChange = () => {
      const doc = document as any;
      if (doc.pointerLockElement === renderer.domElement) {
        isPointerLocked.current = true;
        setShowPointerLockAlert(false);
      } else {
        isPointerLocked.current = false;
        setShowPointerLockAlert(true);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPlaying || isPausedRef.current) return;

      if (isPointerLocked.current) {
        // Pointer Lock movement (standard FPS mouse feel)
        const baseSens = 0.0022 * (keybindingsRef.current.mouseSensitivity ?? 1.0);
        const accel = keybindingsRef.current.mouseAcceleration ?? 0.0;
        const applyAccel = (delta: number) => {
          if (accel === 0) return delta * baseSens;
          const sign = delta < 0 ? -1 : 1;
          return sign * Math.pow(Math.abs(delta), 1 + accel * 0.5) * baseSens;
        };
        stateRef.current.yaw -= applyAccel(e.movementX);
        stateRef.current.pitch -= applyAccel(e.movementY);

        // Constraint pitch (cannot look fully upside down or inside floor)
        stateRef.current.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, stateRef.current.pitch));
      } else if (isMouseDown.current) {
        // Fallback: Drag to look around
        const dx = e.clientX - lastMousePos.current.x;
        const dy = e.clientY - lastMousePos.current.y;

        const dragSensitivity = 0.005 * (keybindingsRef.current.mouseSensitivity ?? 1.0);
        stateRef.current.yaw -= dx * dragSensitivity;
        stateRef.current.pitch -= dy * dragSensitivity;
        stateRef.current.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, stateRef.current.pitch));

        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseDownFallback = (e: MouseEvent) => {
      if (!isPointerLocked.current) {
        isMouseDown.current = true;
        lastMousePos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUpFallback = () => {
      isMouseDown.current = false;
    };

    // Touch swipe-to-aim look around on the right side of the screen
    let lookTouchId: number | null = null;
    let lastTouchX = 0;
    let lastTouchY = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (isPausedRef.current || !isPlaying) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        // If it starts on the right half of the screen
        if (touch.clientX > window.innerWidth / 2) {
          if (lookTouchId === null) {
            lookTouchId = touch.identifier;
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
          }
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isPausedRef.current || !isPlaying || lookTouchId === null) return;
      for (let i = 0; i < e.touches.length; i++) {
        const touch = e.touches[i];
        if (touch.identifier === lookTouchId) {
          const dx = touch.clientX - lastTouchX;
          const dy = touch.clientY - lastTouchY;

          // Swipe sensitivity tracks keybindings
          const swipeSens = 0.003 * (keybindingsRef.current.mouseSensitivity ?? 1.0);
          stateRef.current.yaw -= dx * swipeSens;
          stateRef.current.pitch -= dy * swipeSens;
          stateRef.current.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, stateRef.current.pitch));

          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (lookTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === lookTouchId) {
          lookTouchId = null;
        }
      }
    };

    // Mobile attack handlers triggered by custom overlay events
    const handleMobileAttackPrimary = () => {
      const s = stateRef.current;
      if (s.playerHP <= 0 || !isPlaying || isPausedRef.current) return;

      if (s.activeWeapon === 'hammer') {
        if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
          triggerPlayerHammerSwing();
        }
      } else if (s.activeWeapon === 'pistol') {
        if (s.pPistolReady && s.pPistolState === 'ready') {
          triggerPlayerPistolFire();
        }
      } else {
        if (s.crosshairColor === 'red' && s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
          triggerPlayerSwordLunge();
        }
      }
    };

    const handleMobileAttackAlt = () => {
      const s = stateRef.current;
      if (s.playerHP <= 0 || !isPlaying || isPausedRef.current) return;

      if (s.activeWeapon === 'sword') {
        if (s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
          triggerPlayerSwordSlash();
        }
      } else if (s.activeWeapon === 'hammer') {
        if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
          triggerPlayerHammerMelee();
        }
      }
    };

    // Window events setup
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    renderer.domElement.addEventListener('mousedown', handleCanvasMouseDown);
    renderer.domElement.addEventListener('wheel', handleWheel);
    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDownFallback);
    window.addEventListener('mouseup', handleMouseUpFallback);
    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
    window.addEventListener('mobile-attack-primary', handleMobileAttackPrimary);
    window.addEventListener('mobile-attack-alt', handleMobileAttackAlt);

    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const handleCycleObserverMode = () => {
      const s = stateRef.current;
      if (!s || !s.isObserverMode) return;
      const modes: ('free' | 'third' | 'first')[] = ['free', 'third', 'first'];
      const currentIdx = modes.indexOf(s.observerCamMode);
      const nextMode = modes[(currentIdx + 1) % modes.length];
      s.observerCamMode = nextMode;
      s.yaw = Math.PI;
      s.pitch = -0.2;
      console.log('Spectator Camera mode cycled to:', nextMode);
      pushStatsUpdate();
    };

    const handleCycleObserverTarget = (e?: Event) => {
      const s = stateRef.current;
      if (!s || !s.isObserverMode) return;
      if (replayData) {
        const customEvent = e as CustomEvent;
        const direction = (customEvent?.detail?.direction === 'prev') ? 'prev' : 'next';
        cycleReplayTarget(direction);
      } else {
        s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
        console.log('Spectator Target toggled to:', s.observerTarget);
        pushStatsUpdate();
      }
    };

    window.addEventListener('cycle-observer-mode', handleCycleObserverMode);
    window.addEventListener('cycle-observer-target', handleCycleObserverTarget);

    // Trigger initial score stats update quickly
    pushStatsUpdate();

    // 7. INITIAL WORKSPACE DESTROY/CLEANUP SCOPING
    return () => {
      if (secretAudioRef.current) {
        secretAudioRef.current.pause();
        secretAudioRef.current = null;
      }
      if (document.exitPointerLock) {
        document.exitPointerLock();
      }
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (renderer?.domElement) {
        renderer.domElement.removeEventListener('mousedown', handleCanvasMouseDown);
        renderer.domElement.removeEventListener('wheel', handleWheel);
        renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
      }
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDownFallback);
      window.removeEventListener('mouseup', handleMouseUpFallback);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('mobile-attack-primary', handleMobileAttackPrimary);
      window.removeEventListener('mobile-attack-alt', handleMobileAttackAlt);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('cycle-observer-mode', handleCycleObserverMode);
      window.removeEventListener('cycle-observer-target', handleCycleObserverTarget);

      if (threeRef.current.burnDecals) {
        threeRef.current.burnDecals.forEach(decal => {
          if (scene) scene.remove(decal.mesh);
          decal.mesh.geometry.dispose();
          if (Array.isArray(decal.mesh.material)) {
            decal.mesh.material.forEach((m: any) => m.dispose());
          } else {
            decal.mesh.material.dispose();
          }
        });
        threeRef.current.burnDecals = [];
      }

      if (threeRef.current.hammerSplashFlashes) {
        threeRef.current.hammerSplashFlashes.forEach(flash => {
          if (scene) scene.remove(flash.mesh);
          flash.mesh.geometry.dispose();
          if (Array.isArray(flash.mesh.material)) {
            flash.mesh.material.forEach((m: any) => m.dispose());
          } else {
            flash.mesh.material.dispose();
          }
        });
        threeRef.current.hammerSplashFlashes = [];
      }

      if (threeRef.current.swordLungeSpeedLines) {
        threeRef.current.swordLungeSpeedLines.forEach(line => {
          if (scene) scene.remove(line.mesh);
          line.mesh.geometry.dispose();
          if (Array.isArray(line.mesh.material)) {
            line.mesh.material.forEach((m: any) => m.dispose());
          } else {
            line.mesh.material.dispose();
          }
        });
        threeRef.current.swordLungeSpeedLines = [];
      }

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isPlaying, replayData]);

  // Helper to reconstruct player state at any target frame index in replayData.frames (Delta Compression recovery)
  const getReconstructedState = (playerType: 'player' | 'main_ai' | string, frameIdx: number) => {
    if (!replayData) return null;
    const frames = replayData.frames;
    
    // Scan backwards from frameIdx to find the most recent frame containing the state for this playerType
    for (let i = frameIdx; i >= 0; i--) {
      const f = frames[i];
      if (playerType === 'player' && f.player) return f.player;
      if (playerType !== 'player' && f.otherPlayers) {
        const found = f.otherPlayers.find(p => p.id === playerType);
        if (found) return found;
      }
      // Legacy replays recorded main_ai only in f.ai
      if (playerType === MAIN_AI_ID && f.ai) return f.ai;
    }
    // Fallback to first frame if not found anywhere (should not happen)
    const f0 = frames[0];
    if (playerType === 'player') return f0.player;
    if (f0.otherPlayers) {
      const found = f0.otherPlayers.find(p => p.id === playerType);
      if (found) return found;
    }
    if (playerType === MAIN_AI_ID) return f0.ai;
    return null;
  };

  const recordReplayFrame = (time: number) => {
    const s = stateRef.current;
    if (!replayRecordingRef.current) return;

    const frame: ReplayFrame = {
      time,
      otherPlayers: []
    };

    // Helper to evaluate if a player has moved or changed state compared to last tick
    const hasPlayerChanged = (id: string, current: {
      pos: THREE.Vector3;
      vel: THREE.Vector3;
      yaw: number;
      hp: number;
      activeWeapon: string;
      weaponState: string;
      isCrouching: boolean;
      score: number;
      kills: number;
      deaths: number;
    }) => {
      const prev = lastRecordedStateRef.current.get(id);
      if (!prev) return true; // Always write first frame

      const posDiff = current.pos.distanceTo(prev.pos);
      const velDiff = current.vel.distanceTo(prev.vel);
      const yawDiff = Math.abs(current.yaw - prev.yaw);
      
      const changed = 
        posDiff >= 0.001 || 
        velDiff >= 0.001 || 
        yawDiff >= 0.005 || 
        current.hp !== prev.hp || 
        current.activeWeapon !== prev.activeWeapon || 
        current.weaponState !== prev.weaponState || 
        current.isCrouching !== prev.isCrouching || 
        current.score !== prev.score || 
        current.kills !== prev.kills || 
        current.deaths !== prev.deaths;

      return changed;
    };

    // 1. Process Local Player
    const pSpeed = s.playerVel.length();
    const playerState = {
      pos: { x: s.playerPos.x, y: s.playerPos.y, z: s.playerPos.z },
      vel: { x: s.playerVel.x, y: s.playerVel.y, z: s.playerVel.z },
      yaw: s.yaw,
      pitch: s.pitch,
      hp: s.playerHP,
      isCrouching: s.isCrouching,
      isJumping: s.isJumping || false,
      isLunging: s.isLunging || false,
      isDashing: s.playerDashRemaining > 0,
      isSprinting: s.settings.enableSprint && (pSpeed > 5.5 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0),
      isSliding: s.playerSlideActive || false,
      weaponTimer: s.activeWeapon === 'hammer' ? s.pWeaponTimer : s.pSwordTimer,
      activeWeapon: s.activeWeapon,
      weaponState: s.pWeaponState === 'ready' && s.pSwordState !== 'ready' ? s.pSwordState : s.pWeaponState,
      score: s.scorePlayer,
      kills: s.playerKills ?? 0,
      deaths: s.playerDeaths ?? 0,
      respawnTimer: s.playerRespawnTimer,
      invulnerabilityTimer: s.playerInvulnerabilityTimer
    };

    const playerCompState = {
      pos: s.playerPos,
      vel: s.playerVel,
      yaw: s.yaw,
      hp: s.playerHP,
      activeWeapon: playerState.activeWeapon,
      weaponState: playerState.weaponState,
      isCrouching: playerState.isCrouching,
      score: playerState.score,
      kills: playerState.kills,
      deaths: playerState.deaths
    };

    if (hasPlayerChanged('player', playerCompState)) {
      frame.player = playerState;
      lastRecordedStateRef.current.set('player', {
        pos: s.playerPos.clone(),
        vel: s.playerVel.clone(),
        yaw: s.yaw,
        hp: s.playerHP,
        activeWeapon: playerState.activeWeapon,
        weaponState: playerState.weaponState,
        isCrouching: playerState.isCrouching,
        score: playerState.score,
        kills: playerState.kills,
        deaths: playerState.deaths
      });
    }

    // 2. Process roster combatants (main_ai + bots) via otherPlayers — legacy f.ai read only for old replays
    if (!isMultiplayer) {
      s.otherPlayers.forEach((bot, id) => {
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
          score: id === MAIN_AI_ID ? s.scoreEnemy : (bot.score ?? 0),
          kills: id === MAIN_AI_ID ? (s.enemyKills ?? 0) : (bot.kills ?? 0),
          deaths: id === MAIN_AI_ID ? (s.enemyDeaths ?? 0) : (bot.deaths ?? 0),
          respawnTimer: id === MAIN_AI_ID ? s.enemyRespawnTimer : (bot.respawnTimer ?? 0),
          invulnerabilityTimer: bot.invulnerabilityTimer ?? 0
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
          deaths: botState.deaths
        };

        if (hasPlayerChanged(id, botCompState)) {
          frame.otherPlayers!.push(botState);
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
            deaths: botState.deaths
          });
        }
      });
    }

    // 3. Process remote players in multiplayer replays
    if (isMultiplayer) {
    s.otherPlayers.forEach((bot, id) => {
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
        invulnerabilityTimer: bot.invulnerabilityTimer ?? 0
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
        deaths: botState.deaths
      };

      if (hasPlayerChanged(id, botCompState)) {
        frame.otherPlayers!.push(botState);
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
          deaths: botState.deaths
        });
      }
    });
    }

    replayRecordingRef.current.frames.push(frame);
  };

  const saveCompiledReplay = async () => {
    const recording = replayRecordingRef.current;
    if (!recording || recording.frames.length === 0) return;

    // Prevent double-saving
    replayRecordingRef.current = null;

    // Calculate final duration
    recording.duration = replayRecordingElapsedTimeRef.current;

    try {
      await cacheReplay(recording);
      console.log('Match replay compiled and auto-saved successfully! Total frames:', recording.frames.length);
    } catch (err) {
      console.error('Failed to auto-save compiled replay:', err);
    }
  };

  const runReplayPlaybackLoop = (dt: number) => {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const scene = threeRef.current.scene;
    if (!replayData || !camera || !scene) return;

    const frames = replayData.frames;
    if (frames.length === 0) return;

    // 1. Advance Playback Time
    if (!isReplayPausedRef.current) {
      replayTimeRef.current += dt * replaySpeedRef.current;
      if (replayTimeRef.current > replayData.duration) {
        replayTimeRef.current = replayData.duration;
        isReplayPausedRef.current = true; // Auto-pause at end
      }
    }

    const t = replayTimeRef.current;

    // 2. Find nearest enclosing frames A and B
    let indexA = 0;
    let indexB = 0;
    
    for (let i = 0; i < frames.length; i++) {
      if (frames[i].time <= t) {
        indexA = i;
      } else {
        indexB = i;
        break;
      }
    }
    
    if (indexB === 0) indexB = indexA;

    const frameA = frames[indexA];
    const frameB = frames[indexB];

    const timeA = frameA.time;
    const timeB = frameB.time;
    const alpha = timeB === timeA ? 0 : (t - timeA) / (timeB - timeA);

    // 3. Helper to reconstruct and interpolate a player state
    const interpolatePlayer = (id: string, name: string, hue: number) => {
      const stateA = getReconstructedState(id, indexA);
      const stateB = getReconstructedState(id, indexB);
      if (!stateA || !stateB) return null;

      // Linear interpolation of coordinates
      const pos = new THREE.Vector3(
        stateA.pos.x + (stateB.pos.x - stateA.pos.x) * alpha,
        stateA.pos.y + (stateB.pos.y - stateA.pos.y) * alpha,
        stateA.pos.z + (stateB.pos.z - stateA.pos.z) * alpha
      );

      const vel = new THREE.Vector3(
        stateA.vel.x + (stateB.vel.x - stateA.vel.x) * alpha,
        stateA.vel.y + (stateB.vel.y - stateA.vel.y) * alpha,
        stateA.vel.z + (stateB.vel.z - stateA.vel.z) * alpha
      );

      // Shortest path angle interpolation for Yaw
      const yawA = stateA.yaw;
      const yawB = stateB.yaw;
      let diffYaw = yawB - yawA;
      diffYaw = Math.atan2(Math.sin(diffYaw), Math.cos(diffYaw));
      const yaw = yawA + diffYaw * alpha;

      // Interpolate Pitch
      const pitchA = stateA.pitch || 0;
      const pitchB = stateB.pitch || 0;
      const pitch = pitchA + (pitchB - pitchA) * alpha;

      // Crouch scale interpolation
      const crouchA = stateA.isCrouching ? 0.65 : 1.0;
      const crouchB = stateB.isCrouching ? 0.65 : 1.0;
      const crouchScaleY = crouchA + (crouchB - crouchA) * alpha;

      // Discrete properties (read from A or the nearest frame)
      const useNearest = alpha > 0.5;
      const nearestState = useNearest ? stateB : stateA;

      return {
        pos,
        vel,
        yaw,
        pitch,
        crouchScaleY,
        hp: nearestState.hp,
        activeWeapon: nearestState.activeWeapon,
        weaponState: nearestState.weaponState,
        isCrouching: nearestState.isCrouching,
        isLunging: nearestState.isLunging || false,
        isDashing: nearestState.isDashing || false,
        isSprinting: nearestState.isSprinting || false,
        isSliding: nearestState.isSliding || false,
        weaponTimer: nearestState.weaponTimer || 0,
        score: nearestState.score,
        kills: nearestState.kills,
        deaths: nearestState.deaths,
        respawnTimer: nearestState.respawnTimer,
        invulnerabilityTimer: nearestState.invulnerabilityTimer
      };
    };

    // 4. Interpolate and update all 3D spartan models
    const updatedPlayers = new Map<string, any>();

    // Recorded Local Player (Blue)
    const pInterp = interpolatePlayer('player', replayData.playerName, replayData.playerHue);
    const isRecordedObserver = replayData.recordedAsObserver === true || 
      (replayData.mode === 'multiplayer' && 
       replayData.frames.some(f => f.otherPlayers && f.otherPlayers.length >= 2 && f.otherPlayers.some(p => p.playerName.includes('(Host)')) && f.otherPlayers.some(p => p.playerName.includes('(Guest)'))));

    if (pInterp && !isRecordedObserver) {
      updatedPlayers.set('player', { ...pInterp, name: replayData.playerName, hue: replayData.playerHue });
    }

    // Recorded roster combatants (main_ai + bots offline; remotes in multiplayer)
    const allBotIds = new Set<string>();
    if (replayData.mode !== 'multiplayer') {
      allBotIds.add(MAIN_AI_ID);
    }
    frames.forEach(f => {
      if (f.otherPlayers) f.otherPlayers.forEach(p => allBotIds.add(p.id));
      if (f.ai && replayData.mode !== 'multiplayer') allBotIds.add(MAIN_AI_ID);
    });

    allBotIds.forEach(id => {
      let name = id === MAIN_AI_ID ? replayData.opponentName : 'Bot';
      let hue = id === MAIN_AI_ID ? (botColors[MAIN_AI_ID] ?? 0) : 0;
      for (const f of frames) {
        const found = f.otherPlayers?.find(p => p.id === id);
        if (found) {
          name = found.playerName;
          hue = found.hue;
          break;
        }
      }

      const botInterp = interpolatePlayer(id, name, hue);
      if (botInterp) {
        updatedPlayers.set(id, { ...botInterp, name, hue });
      }
    });

    // Sync the player IDs present in the replay
    replayPlayerIdsRef.current = Array.from(updatedPlayers.keys());

    // Read the current replay camera target ID (needed for first-person model hiding)
    const targetId = replayTargetIdRef.current;

    // 5. Update threeRef meshes using updatedPlayers map
    updatedPlayers.forEach((player, id) => {
      let meshes = threeRef.current.otherPlayerMeshes.get(id);
      if (!meshes) {
        const group = buildVoxelSpartanModel(id === 'main_ai' || id.startsWith('bot_'), player.hue);
        scene.add(group);

        const hammer = buildGravityHammerModel(player.hue);
        hammer.scale.set(0.6, 0.6, 0.6);
        hammer.position.set(0.5, 1.0 - 0.64, -0.4);
        hammer.rotation.set(Math.PI / 2, 0, 0);
        if (group.userData.upperTorso) group.userData.upperTorso.add(hammer);
        else group.add(hammer);

        const sword = buildKatarSwordModel(player.hue);
        sword.scale.set(0.6, 0.6, 0.6);
        sword.position.set(0.5, 1.0 - 0.64, -0.32);
        sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        sword.visible = false;
        if (group.userData.upperTorso) group.userData.upperTorso.add(sword);
        else group.add(sword);

        const pistol = buildPistolModel(player.hue);
        pistol.scale.set(0.6, 0.6, 0.6);
        pistol.position.set(0.5, 1.0 - 0.64, -0.32);
        pistol.rotation.set(Math.PI / 2, 0, 0);
        pistol.visible = false;
        if (group.userData.upperTorso) group.userData.upperTorso.add(pistol);
        else group.add(pistol);

        meshes = { group, hammer, sword, pistol };
        threeRef.current.otherPlayerMeshes.set(id, meshes);
      }

      const { group, hammer, sword, pistol } = meshes;

      // Sync Position, Yaw and Crouch scale y
      group.position.copy(player.pos);
      group.rotation.y = player.yaw;
      group.scale.set(1, player.crouchScaleY, 1);

      // Call standard skeletal/joint animations for replays (running, walking, torso twists, swings)
      animateSpartanModel(
        group,
        player.vel,
        player.yaw,
        player.hp,
        player.weaponState,
        player.weaponTimer || 0,
        dt,
        player.isSliding || false,
        player.isSprinting || false
      );

      // Sync Weapon Visibilities
      const alive = player.hp > 0 && player.respawnTimer <= 0;
      const isSpectatedInFirstPerson = s.observerCamMode === 'first' && targetId === id;
      group.visible = alive && !isSpectatedInFirstPerson;
      hammer.visible = alive && player.activeWeapon === 'hammer';
      sword.visible = alive && player.activeWeapon === 'sword';
      if (pistol) pistol.visible = alive && player.activeWeapon === 'pistol';

      // Procedural weapon swinging animations
      if (player.weaponState !== 'ready') {
        if (player.activeWeapon === 'hammer') {
          if (player.weaponState === 'swing_up') {
            hammer.rotation.set(Math.PI / 3, 0, 0);
          } else if (player.weaponState === 'swing_down') {
            hammer.rotation.set(Math.PI / 1.1, 0, 0);
          } else if (player.weaponState === 'recovering') {
            hammer.rotation.set(Math.PI / 1.8, 0, 0);
          } else if (player.weaponState === 'melee_swing') {
            hammer.rotation.set(Math.PI / 2, 0, Math.PI / 4);
          }
        } else if (player.activeWeapon === 'sword') {
          if (player.weaponState === 'slashing') {
            sword.rotation.set(Math.PI / 3, 0, -Math.PI / 4);
          } else if (player.weaponState === 'recovering') {
            sword.rotation.set(Math.PI / 1.8, 0, -Math.PI / 8);
          }
        }
      } else {
        hammer.rotation.set(Math.PI / 2, 0, 0);
        sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      }

      // Sword lunge speed lines or cube trail VFX replication
      if (player.isLunging && alive && dt > 0) {
        const trailPos = player.pos.clone();
        trailPos.y += 0.825; // Body center y height
        const trailDir = player.vel.clone();
        const style: 'localCube' | 'enemyCube' = (id === 'player' || player.playerName === replayData.playerName) ? 'localCube' : 'enemyCube';
        const color = (id === 'player' || player.playerName === replayData.playerName) ? '#22d3ee' : '#ef4444';
        renderSwordLungeTrailVfx(trailPos, color, trailDir, style);
      }

      // Evasion dash trail particles replication
      if (player.isDashing && alive && dt > 0 && Math.random() > 0.15) {
        const trailPos = player.pos.clone();
        trailPos.y += 0.5; // midway
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const colorHex = (id === 'player' || player.playerName === replayData.playerName)
            ? '#38bdf8'
            : (player.activeWeapon === 'hammer' ? '#f97316' : '#ef4444');
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(colorHex),
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          mesh.position.x += (Math.random() - 0.5) * 0.3;
          mesh.position.y += (Math.random() - 0.5) * 0.5;
          mesh.position.z += (Math.random() - 0.5) * 0.3;
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
            life: 0.0,
            maxLife: 0.25 + Math.random() * 0.15,
          });
        }
      }

      updateBlinking(group, player.invulnerabilityTimer > 0);
    });

    // Hide unused meshes
    threeRef.current.otherPlayerMeshes.forEach((meshes, id) => {
      if (!updatedPlayers.has(id)) {
        meshes.group.visible = false;
      }
    });

    if (threeRef.current.enemyGroup) threeRef.current.enemyGroup.visible = false;
    if (threeRef.current.hostGroup) threeRef.current.hostGroup.visible = false;

    // 6. Camera Coordination
    if (targetId === 'free') {
      s.observerCamMode = 'free';

      // Read movement inputs to fly the camera
      const forwardDir = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
        .normalize();
      const rightDir = new THREE.Vector3(1, 0, 0)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
        .normalize();
      const upDir = new THREE.Vector3(0, 1, 0);

      let moveForward = 0;
      let moveRight = 0;
      let moveUp = 0;

      if (keysPressed.current[keybindingsRef.current.moveForward] || keysPressed.current['arrowup']) moveForward += 1;
      if (keysPressed.current[keybindingsRef.current.moveBackward] || keysPressed.current['arrowdown']) moveForward -= 1;
      if (keysPressed.current[keybindingsRef.current.moveRight] || keysPressed.current['arrowright']) moveRight += 1;
      if (keysPressed.current[keybindingsRef.current.moveLeft] || keysPressed.current['arrowleft']) moveRight -= 1;

      // Gamepad inputs
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      let gamepad = null;
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i]) {
          gamepad = gamepads[i];
          break;
        }
      }

      if (gamepad) {
        const lx = gamepad.axes[0];
        const ly = gamepad.axes[1];
        const moveDeadzone = 0.18;
        if (Math.abs(ly) > moveDeadzone) moveForward -= ly;
        if (Math.abs(lx) > moveDeadzone) moveRight += lx;
      }

      // Rise/Lower
      const gpJump = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadJump ?? 0]?.pressed : false;
      const gpCrouch = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadCrouch ?? 1]?.pressed : false;

      if (keysPressed.current[keybindingsRef.current.jump] || keysPressed.current['spacebar'] || gpJump) moveUp += 1;
      if (keysPressed.current[keybindingsRef.current.crouch] || gpCrouch) moveUp -= 1;

      const gpSprint = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadSprint ?? 10]?.pressed : false;
      const speedMultiplier = (keysPressed.current['shift'] || gpSprint) ? 2.8 : 1.0;
      const flySpeed = 11.0 * speedMultiplier * dt;

      s.playerPos.addScaledVector(forwardDir, moveForward * flySpeed);
      s.playerPos.addScaledVector(rightDir, moveRight * flySpeed);
      s.playerPos.addScaledVector(upDir, moveUp * flySpeed);

      const lookTarget = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
        .normalize();
      camera.position.copy(s.playerPos);
      camera.lookAt(camera.position.clone().add(lookTarget));
    } else {
      const targetData = updatedPlayers.get(targetId);
      if (targetData) {
        const eyeHeight = 1.65 - (targetData.isCrouching ? 0.72 : 0);
        const targetEyePos = targetData.pos.clone().setY(targetData.pos.y + eyeHeight);

        if (s.observerCamMode === 'first') {
          camera.position.copy(targetEyePos);
          const lookTarget = new THREE.Vector3(0, 0, -1)
            .applyAxisAngle(new THREE.Vector3(1, 0, 0), targetData.pitch)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), targetData.yaw)
            .normalize();
          camera.lookAt(camera.position.clone().add(lookTarget));
        } else if (s.observerCamMode === 'third') {
          const offset = new THREE.Vector3(0, 0, s.observerOrbitDistance)
            .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
            .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
          const cameraPos = targetEyePos.clone().add(offset);

          // Resolve wall/obstacle collisions to prevent clipping in replay mode
          const activeCustomMap = getActiveCustomMap();
          const customMapObjects = (activeCustomMap && activeCustomMap.objects) || [];
          const arenaRadius = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
          const resolvedPos = getCollisionResolvedCameraPos(targetEyePos, cameraPos, arenaRadius, customMapObjects);

          camera.position.copy(resolvedPos);
          camera.lookAt(targetEyePos);
        }
      }
    }

    // 6b. Update first person weapon visibilities for spectated players
    let fpWeaponToShow: 'hammer' | 'sword' | 'pistol' | 'none' = 'none';
    if (s.observerCamMode === 'first' && targetId !== 'free') {
      const spectatedData = updatedPlayers.get(targetId);
      if (spectatedData && spectatedData.hp > 0 && spectatedData.respawnTimer <= 0) {
        fpWeaponToShow = spectatedData.activeWeapon;
      }
    }

    if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = fpWeaponToShow === 'hammer';
    if (threeRef.current.playerSword) threeRef.current.playerSword.visible = fpWeaponToShow === 'sword';
    if (threeRef.current.playerPistol) threeRef.current.playerPistol.visible = fpWeaponToShow === 'pistol';

    // 7. Render scene
    renderGame();

    // 8. Event State Transitions (Audio & Particle cues)
    if (!isReplayPausedRef.current && dt > 0 && dt < 0.2 && prevReplayFrameRef.current) {
      const timeDiff = t - prevReplayFrameRef.current.time;
      if (timeDiff > 0 && timeDiff < 0.2) {
        updatedPlayers.forEach((player, id) => {
          let prevState = null;
          for (let i = indexA - 1; i >= 0; i--) {
            const f = frames[i];
            if (id === 'player' && f.player) { prevState = f.player; break; }
            if (f.otherPlayers) {
              const found = f.otherPlayers.find(p => p.id === id);
              if (found) { prevState = found; break; }
            }
            if (id === MAIN_AI_ID && f.ai) { prevState = f.ai; break; }
          }

          if (prevState) {
            if (player.hp < prevState.hp) {
              spawnVoxelShockwaveParticles(player.pos, '#ef4444');
              if (player.hp <= 0) {
                sfx.playDeath();
                spawnVoxelShockwaveParticles(player.pos, '#ef4444');
                spawnVoxelShockwaveParticles(player.pos, '#ff4d4d');
              } else {
                sfx.playSwing();
              }
            }

            if (player.hp > 0 && prevState.hp <= 0) {
              sfx.playRespawn();
              spawnVoxelShockwaveParticles(player.pos, '#38bdf8');
            }

            if (player.weaponState !== 'ready' && prevState.weaponState === 'ready') {
              sfx.playSwing();
            }

            if (player.isLunging && !prevState.isLunging) {
              sfx.playDash();
            }

            if (player.isDashing && !prevState.isDashing) {
              sfx.playDash();
            }

            const wasSwingingDown = prevState.weaponState === 'swing_down' || prevState.weaponState === 'melee_swing';
            const isSwingingDownNow = player.weaponState === 'swing_down' || player.weaponState === 'melee_swing';
            if (wasSwingingDown && !isSwingingDownNow && player.activeWeapon === 'hammer' && prevState.activeWeapon === 'hammer') {
              sfx.playExplosion();
              const eyeHeight = 1.65 - (player.isCrouching ? 0.72 : 0);
              const eyePos = new THREE.Vector3(player.pos.x, eyeHeight + player.pos.y, player.pos.z);
              const lookHeading = new THREE.Vector3(0, 0, -1)
                .applyAxisAngle(new THREE.Vector3(1, 0, 0), player.pitch || 0)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), player.yaw)
                .normalize();
              const impactPos = eyePos.clone().addScaledVector(lookHeading, s.settings.attackRange || 4.0);
              const impactRadius = s.settings.attackRadius ?? 4.5;
              renderHammerSplashVfx(impactPos, (id === 'player' || player.playerName === replayData.playerName) ? '#38bdf8' : '#ef4444', impactRadius);
            }
          }
        });
      }
    }

    prevReplayFrameRef.current = frameA;

    // 9. Sync HUD stats
    const playerList = Array.from(updatedPlayers.entries()).map(([id, p]) => ({
      id,
      name: p.name,
      hue: p.hue
    }));

    const mainPlayer = updatedPlayers.get('player') || { hp: 1, maxHp: 1, score: 0, kills: 0, deaths: 0 };
    const mainAI = updatedPlayers.get('main_ai') || { hp: 1, maxHp: 1, score: 0, kills: 0, deaths: 0 };

    const spectatedName = targetId === 'free' ? 'Free Cam' : (updatedPlayers.get(targetId)?.name || 'Spartan');
    const spectatedRole = targetId === 'player' ? 'host' : 'client';

    onStatsUpdate({
      playerHP: mainPlayer.hp,
      playerMaxHP: mainPlayer.maxHp !== undefined ? mainPlayer.maxHp : 5,
      enemyHP: mainAI.hp,
      enemyMaxHP: mainAI.maxHp !== undefined ? mainAI.maxHp : 5,
      scorePlayer: mainPlayer.score,
      scoreEnemy: mainAI.score,
      gameTime: t,
      debugMode: false,
      debugDamageRadius: 4.5,
      weaponReady: true,
      weaponCooldown: 1.0,
      lastStrikePos: null,
      lastStrikeTick: 0,
      isCrouching: false,
      isJumping: false,
      playerRespawnTimer: 0,
      enemyRespawnTimer: 0,
      playerDashCooldownTimer: 0,
      playerDashReady: true,
      settings: adminSettings,
      lastDeaths: [],
      playerX: mainPlayer.pos.x,
      playerZ: mainPlayer.pos.z,
      playerYaw: mainPlayer.yaw,
      enemyX: mainAI.pos.x,
      enemyZ: mainAI.pos.z,
      enemyYaw: mainAI.yaw,
      enemyIsCrouching: false,
      playerIsCrouchMoving: false,
      enemyIsCrouchMoving: false,
      activeWeapon: 'hammer',
      crosshairColor: 'white',
      playerKills: mainPlayer.kills,
      playerDeaths: mainPlayer.deaths,
      enemyKills: mainAI.kills,
      enemyDeaths: mainAI.deaths,
      isReplayMode: true,
      replayElapsedTime: t,
      replayDuration: replayData.duration,
      replayIsPlaying: !isReplayPausedRef.current,
      replaySpeedMultiplier: replaySpeedRef.current,
      replayPlayerList: playerList,
      replayCurrentTargetId: targetId,
      isObserverMode: true,
      observerCamMode: s.observerCamMode,
      observerTargetName: spectatedName,
      observerTargetRole: spectatedRole
    });

    // 10. Update visual effects particles during replay
    const playbackDt = isReplayPausedRef.current ? 0 : dt * replaySpeedRef.current;
    updateExplosionParticles(playbackDt);
    updateTracers(playbackDt);
    updateHammerSplashFlashes(playbackDt);
    updateSwordLungeSpeedLines(playbackDt);
    updateBurnDecals(playbackDt);
  };

  // Handle active game cycles
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    // 1. Initialize Replay Recorder if playing a normal match
    if (isPlaying && !replayData) {
      const s = stateRef.current;
      const isTournament = aiMatchSessionKey && aiMatchSessionKey.startsWith('tournament');
      const initialOpponentName = opponentPlayerName || 'Red (AI)';

      replayRecordingRef.current = {
        id: Math.random().toString(36).substring(2, 9),
        name: `Match Replay - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        description: '',
        date: new Date().toISOString(),
        duration: 0,
        playerHue: adminSettings.playerHue ?? 200,
        playerName: adminSettings.playerName || 'Blue (You)',
        opponentName: initialOpponentName,
        mapType: selectedMap || 'hangar',
        mode: isTournament ? 'tournament' : 'sandbox',
        maxScore: isTournament ? (matchKillsToWin ?? 25) : 25,
        recordedAsObserver: s.isObserverMode,
        frames: []
      };
      lastRecordTimeRef.current = 0;
      replayRecordingElapsedTimeRef.current = 0;
      lastRecordedStateRef.current.clear();
      console.log('Match Replay Recording initialized successfully!');
    }

    // Replay playback event listeners
    const handleReplayTogglePlay = () => {
      isReplayPausedRef.current = !isReplayPausedRef.current;
      console.log('Replay Toggle Play/Pause:', !isReplayPausedRef.current);
    };

    const handleReplaySeek = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.time === 'number') {
        replayTimeRef.current = Math.min(replayData?.duration || 0, Math.max(0, customEvent.detail.time));
        prevReplayFrameRef.current = null; // Reset sfx trigger
        console.log('Replay Seek to:', replayTimeRef.current);
      }
    };

    const handleReplayChangeSpeed = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.speed === 'number') {
        replaySpeedRef.current = customEvent.detail.speed;
        console.log('Replay Speed changed to:', replaySpeedRef.current);
      }
    };

    const handleReplayChangeTarget = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.id === 'string') {
        replayTargetIdRef.current = customEvent.detail.id;
        console.log('Replay Cam Target changed to:', replayTargetIdRef.current);
      }
    };

    const handleReplayChangeCamMode = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && typeof customEvent.detail.mode === 'string') {
        const s = stateRef.current;
        s.observerCamMode = customEvent.detail.mode as any;
        console.log('Replay Cam Mode changed to:', s.observerCamMode);
      }
    };

    if (replayData) {
      window.addEventListener('replay-toggle-play', handleReplayTogglePlay);
      window.addEventListener('replay-seek', handleReplaySeek);
      window.addEventListener('replay-change-speed', handleReplayChangeSpeed);
      window.addEventListener('replay-change-target', handleReplayChangeTarget);
      window.addEventListener('replay-change-cam-mode', handleReplayChangeCamMode);
    }

    let lastTime = performance.now();

    const loop = (time: number) => {
      const s = stateRef.current;
      // Calculate delta time
      let dt = (time - lastTime) / 1000;
      lastTime = time;

      const fpsSample = fpsRef.current;
      if (fpsSample.lastSampleTime === 0) {
        fpsSample.lastSampleTime = time;
      }
      fpsSample.frameCount += 1;
      const fpsElapsed = time - fpsSample.lastSampleTime;
      if (fpsElapsed >= 500) {
        fpsSample.value = Math.round((fpsSample.frameCount * 1000) / fpsElapsed);
        fpsSample.frameCount = 0;
        fpsSample.lastSampleTime = time;
      }

      // Anti-jump lag spike limit
      if (dt > 0.1) dt = 0.1;

      // ─── Hidden Key Combo Hold Detection (GRIFB) ───
      const requiredKeys = ['g', 'r', 'i', 'f', 'b'];
      const activeKeys = Object.keys(keysPressed.current).filter(k => keysPressed.current[k]);
      const isHoldingOnlyGRIFB = activeKeys.length === 5 && requiredKeys.every(k => activeKeys.includes(k));
      
      if (isHoldingOnlyGRIFB && s.playerHP > 0 && isPlaying && !isPausedRef.current) {
        grifbHoldTimerRef.current += dt;
        if (grifbHoldTimerRef.current >= 2.0) {
          grifbHoldTimerRef.current = 0;
          requiredKeys.forEach(k => { keysPressed.current[k] = false; });
          
          if (s.activeWeapon !== 'pistol') {
            s.activeWeapon = 'pistol';
            
            if (threeRef.current.playerHammer) threeRef.current.playerHammer.visible = false;
            if (threeRef.current.playerSword) threeRef.current.playerSword.visible = false;
            if (threeRef.current.playerPistol) threeRef.current.playerPistol.visible = true;
            
            spawnVoxelShockwaveParticles(s.playerPos, '#38bdf8');
            spawnVoxelShockwaveParticles(s.playerPos, '#fffa00');
            
            sfx.playRespawn();

            // Play secret song!
            if (secretAudioRef.current) {
              secretAudioRef.current.pause();
            }
            const audio = new Audio('/Saudi Smurf Allah.mp3');
            audio.volume = 0.55;
            audio.play().catch(e => console.error("Error playing secret song:", e));
            secretAudioRef.current = audio;

            // Sync with other players in match
            if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
              multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'unlock_secret' }));
            }
            
            const secretAnnouncement: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: "SECRET",
              victim: "UNLOCKED: GRIFB Pistol!",
              weapon: "sword"
            };
            s.lastDeaths = [secretAnnouncement, ...s.lastDeaths].slice(0, 3);
            pushStatsUpdate();
          }
        }
      } else {
        grifbHoldTimerRef.current = 0;
      }



      // Lazy build Host Spartan model when entering spectator mode
      if (s.isObserverMode && !threeRef.current.hostGroup && !replayData) {
        rebuildHostModel(s.hostHue);
      }

      if (!replayData) {
        // Execute game logics
        updatePhysics(dt);
        updateHammerAnimations(dt);
        if (!isMultiplayer) {
          runAIOrchestrator(dt);
        }
        updateAI(dt);
        updateCharacterSkeletalAnimations(dt);
        updateExplosionParticles(dt);
        updateTracers(dt);
        updateHammerSplashFlashes(dt);
        updateSwordLungeSpeedLines(dt);
        updateBurnDecals(dt);
        updateMatchTimers(dt);
        enforceArenaBounds();

        // Render loop
        renderGame();

        // Update floating nameplate positioning and appearance
        updateFloatingNameplate();

        // Trigger stats sync
        pushStatsUpdate();

        // Synchronously update HUD Radar elements directly at 60fps 
        updateRadarDOM();

        // Emit multiplayer synchronization payload
        if (isMultiplayer && multiplayerRole !== 'observer' && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          const s = stateRef.current;
          multiplayerSocket.send(JSON.stringify({
            type: 'sync',
            pos: { x: s.playerPos.x, y: s.playerPos.y, z: s.playerPos.z },
            vel: { x: s.playerVel.x, y: s.playerVel.y, z: s.playerVel.z },
            yaw: s.yaw,
            pitch: s.pitch,
            hp: s.playerHP,
            maxHp: s.playerMaxHP,
            isCrouching: s.isCrouching,
            activeWeapon: s.activeWeapon,
            respawnTimer: s.playerRespawnTimer,
            invulnerabilityTimer: s.playerInvulnerabilityTimer,
            hue: s.settings.playerHue,
            playerName: s.settings.playerName, // Send custom name!
            
            ...(multiplayerRole === 'host' ? {
              scoreHost: s.scorePlayer,
              scoreClient: s.scoreEnemy,
              killsHost: s.playerKills,
              deathsHost: s.playerDeaths,
              killsClient: s.enemyKills,
              deathsClient: s.enemyDeaths,
              gameTime: s.gameTime
            } : {
              clientHP: s.playerHP
            })
          }));
        }

        // Capture Replay Frame every 50ms (20Hz)
        if (replayRecordingRef.current) {
          replayRecordingElapsedTimeRef.current += dt;
          const currentMatchTime = replayRecordingElapsedTimeRef.current;
          if (currentMatchTime - lastRecordTimeRef.current >= 0.05) {
            lastRecordTimeRef.current = currentMatchTime;
            recordReplayFrame(currentMatchTime);
          }
        }
      } else {
        // Run Replay Playback simulation
        runReplayPlaybackLoop(dt);
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (replayData) {
        window.removeEventListener('replay-toggle-play', handleReplayTogglePlay);
        window.removeEventListener('replay-seek', handleReplaySeek);
        window.removeEventListener('replay-change-speed', handleReplayChangeSpeed);
        window.removeEventListener('replay-change-target', handleReplayChangeTarget);
        window.removeEventListener('replay-change-cam-mode', handleReplayChangeCamMode);
      }
      // Save compiled replay on unmount
      saveCompiledReplay();
    };
  }, [isPlaying, isPaused, isMultiplayer, multiplayerRole, multiplayerSocket, replayData]);

  const getPlayerSwordLockTarget = () => {
    const s = stateRef.current;
    if (s.playerHP <= 0) return null;

    const eyePos = new THREE.Vector3(
      s.playerPos.x,
      1.65 - s.crouchAmount + s.playerPos.y,
      s.playerPos.z
    );
    const cameraLookDir = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
      .normalize();
    const maxDistance = s.settings.swordLungeDistance ?? 14.5;
    const maxAngle = 0.12;
    let bestTarget: { pos: THREE.Vector3; dist: number; angle: number } | null = null;

    const considerTarget = (pos: THREE.Vector3) => {
      const center = new THREE.Vector3(pos.x, pos.y + 0.825, pos.z);
      const toTarget = center.clone().sub(eyePos);
      const dist = toTarget.length();
      if (dist <= 0.001 || dist > maxDistance) return;

      const dot = cameraLookDir.dot(toTarget.normalize());
      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
      if (angle > maxAngle) return;

      if (!bestTarget || angle < bestTarget.angle || (Math.abs(angle - bestTarget.angle) < 0.01 && dist < bestTarget.dist)) {
        bestTarget = { pos: pos.clone(), dist, angle };
      }
    };

    if ((!isMultiplayer || s.otherPlayers.size === 0) && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING') {
      considerTarget(mai()!.pos);
    }

    s.otherPlayers.forEach((other) => {
      if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
        considerTarget(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
      }
    });

    return bestTarget;
  };

  const getEnemyAITarget = () => {
    const s = stateRef.current;
    // Resolve the main AI's *actual* engagement target via the same tactical
    // selector the movement FSM uses, so its hammer/slash impact lands where the
    // bot is facing. Previously this always returned the player whenever not in
    // observer mode, which meant the main AI's swings aimed at the player even
    // while it was fighting another bot — they'd visibly "swing in the wrong
    // direction" and could never damage a bot with a hammer or slash (only lunges,
    // which use getBestTacticalTarget, ever connected against bots).
    const difficulty = resolveRosterSlot('main_ai').difficulty || 'normal';
    const best = getBestTacticalTarget('main_ai', mai()!.pos, difficulty);
    if (!best) {
      return null;
    }
    return {
      id: best.id,
      pos: best.pos instanceof THREE.Vector3
        ? best.pos.clone()
        : new THREE.Vector3((best.pos as any).x, (best.pos as any).y, (best.pos as any).z),
      hp: best.hp,
      invuln: best.invulnerabilityTimer ?? 0,
      isLunging: best.isLunging,
      weaponState: best.weaponState,
      respawnTimer: 0,
      vel: best.vel,
      isCrouching: best.isCrouching,
      isObserver: false,
      playerName: best.playerName,
    };
  };

  // Resolve a DoomBot's hammer/slash damage at its swing apex. DoomBots only
  // animated their swings (see the bot weapon state machine in the other-players
  // animation block) and only ever dealt damage through sword *lunges*, so a
  // hammer bot — or any bot forced to swing at close range instead of lunging —
  // could never actually hurt anyone. This mirrors the main AI's
  // applyHammerStrikeImpact: plant a damage sphere (radius attackRadius) ~attackRange
  // ahead along the bot's facing yaw and damage every other combatant inside it
  // (free-for-all). Singleplayer only; multiplayer resolves hits authoritatively
  // elsewhere.
  const applyBotMeleeImpact = (botId: string) => {
    const s = stateRef.current;
    if (s.isMultiplayer) return;
    const bot = s.otherPlayers?.get(botId);
    if (!bot || bot.hp <= 0 || (bot.respawnTimer ?? 0) > 0) return;

    const weapon = bot.activeWeapon === 'sword' ? 'sword' : 'hammer';
    // The hammer is the AoE weapon: a wide ground-pound (radius attackRadius, planted
    // ~attackRange ahead). The sword is a precise melee — a tight slash arc close to the
    // wielder, NOT a hammer-sized ranged AoE. Sharing the hammer's forward/radius let a
    // sword-only AI land hammer-radius hits from ~7u away (and render the hammer splash),
    // so it looked and played like a hammer despite the sword-only preset. Sword closes
    // distance with its lunge; this stationary swing is only a short-range slash.
    const isHammer = weapon === 'hammer';
    // Hammer overhead plants its sphere at the full attackRange, matching the player and
    // main AI (applyHammerStrikeImpact). The sword slash stays a tight close-range arc.
    const forward = isHammer
      ? (s.settings.attackRange ?? 3.2)
      : (s.settings.attackRange ?? 3.2) * SWORD_SLASH_FORWARD_FACTOR;
    const radius = isHammer ? (s.settings.attackRadius ?? 4.5) : SWORD_SLASH_RADIUS;

    const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.2, bot.pos.z);
    const heading = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();
    const impactPos = eye.clone().addScaledVector(heading, forward);

    if (isHammer) {
      renderHammerSplashVfx(impactPos, '#f97316', radius);
    } else {
      // Sword slash burst — red energy, no hammer ground-splash.
      spawnVoxelShockwaveParticles(impactPos, '#ef4444');
    }
    sfx.playExplosion();

    const creditKill = (victimId: string, victimName: string) => {
      bot.score = (bot.score || 0) + 1;
      bot.kills = (bot.kills || 0) + 1;
      sfx.playDeath();
      recordDeathEvent(bot.playerName, victimName, undefined, weapon);
      recordBotPsychKill(botId, victimId, false);
    };

    // Player
    if (
      !s.isObserverMode &&
      s.playerHP > 0 &&
      s.playerRespawnTimer <= 0 &&
      s.playerInvulnerabilityTimer <= 0 &&
      impactPos.distanceTo(getCombatBodyCenter(s.playerPos, s.isCrouching)) <= radius
    ) {
      recordPlayerDamageTaken();
      s.playerHP -= 1;
      spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');
      if (s.playerHP <= 0) {
        s.playerHP = 0;
        s.playerRespawnTimer = 3.0;
        s.playerDeaths += 1;
        s.pWeaponState = 'ready'; s.pWeaponTimer = 0; s.pWeaponReady = true;
        s.pSwordState = 'ready'; s.pSwordTimer = 0; s.pSwordReady = true;
        s.isLunging = false; s.lungeTimer = 0;
        creditKill('player', s.settings.playerName || 'Blue (You)');
      } else {
        sfx.playSwing();
        recordBotDamageTag(botId, 'player');
      }
    }

    // Main AI ("Red") — handled by unified roster loop below

    // All roster combatants (main_ai + bots), excluding self
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other, otherId) => {
        if (otherId === botId) return;
        if (other.controller !== 'ai') return;
        if (!isAICombatReady(other)) return;
        const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
        if (impactPos.distanceTo(getCombatBodyCenter(otherPos, other.isCrouching || false)) > radius) return;
        other.hp -= 1;
        spawnVoxelShockwaveParticles(otherPos, '#ef4444');
        if (other.hp <= 0) {
          other.hp = 0;
          other.respawnTimer = 3.0;
          if (other.controller === 'ai') {
            other.aiState = 'RESPAWNING';
            other.weaponState = 'ready';
            other.weaponTimer = 0;
            if (other.id === MAIN_AI_ID) {
              s.enemyDeaths += 1;
              recordBotCalibrationDeath(other.id);
            } else {
              other.deaths = (other.deaths || 0) + 1;
            }
          } else {
            other.deaths = (other.deaths || 0) + 1;
          }
          creditKill(otherId, other.playerName);
        } else {
          sfx.playSwing();
          recordBotDamageTag(botId, otherId);
        }
      });
    }
  };


  // TRIGGERS PLAYER SWING
  const triggerPlayerHammerSwing = () => {
    const s = stateRef.current;
    if (s.swapCooldownTimer > 0) return;
    if (s.playerDashRemaining > 0) return; // Attacks cannot take place during the dash movement
    s.pWeaponState = 'swing_up';
    s.pWeaponTimer = 0;
    s.pWeaponReady = false;
    s.lastPlayerHammerAttackTime = Date.now();
    recordLocalPlayerObservation((model) => observePlayerHammerAttack(model));
    
    // Play sci-fi mechanical swing whoosh sound!
    sfx.playSwing();

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'swing_hammer' }));
    }
  };

  // TRIGGERS PLAYER HAMMER MELEE
  const triggerPlayerHammerMelee = () => {
    const s = stateRef.current;
    if (s.swapCooldownTimer > 0) return;
    if (s.playerDashRemaining > 0) return;
    s.pWeaponState = 'melee_swing';
    s.pWeaponTimer = 0;
    s.pWeaponReady = false;
    s.lastPlayerHammerAttackTime = Date.now();
    sfx.playSwing();

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'melee_hammer' }));
    }
  };

  // TRIGGERS PLAYER PISTOL FIRE (HITSCAN)
  const triggerPlayerPistolFire = () => {
    const s = stateRef.current;
    if (s.playerHP <= 0 || isPaused || !isPlaying) return;
    if (!s.pPistolReady || s.pPistolState !== 'ready') return;

    s.pPistolState = 'firing';
    s.pPistolTimer = 0;
    s.pPistolReady = false;

    // 1. Play Synthesized Sleek Audio
    playPistolSound();

    // 2. Compute Ray origin & direction from crosshair
    const camera = threeRef.current.camera;
    const scene = threeRef.current.scene;
    if (!camera || !scene) return;

    const eyePos = new THREE.Vector3(s.playerPos.x, 1.65 - s.crouchAmount + s.playerPos.y, s.playerPos.z);
    
    // Look direction matching crosshair pitch and yaw
    const cameraLookDir = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
      .normalize();

    // Estimate Gun Muzzle World Position
    const camRight = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).normalize();
    const camUp = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw).normalize();
    const muzzlePos = eyePos.clone()
      .addScaledVector(camRight, 0.15)
      .addScaledVector(camUp, -0.15)
      .addScaledVector(cameraLookDir, 0.35);

    // 3. Mathematical Bounding Sphere Hitscan Intersection
    let closestTarget: any = null;
    let closestDist = Infinity;
    let closestHitPoint = new THREE.Vector3();

    // Check roster combatants (main_ai + bots + remotes)
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other, otherId) => {
        if (other.hp > 0 && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
          const C = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
          const toEnemy = C.clone().sub(eyePos);
          const proj = toEnemy.dot(cameraLookDir);
          if (proj > 0) {
            const closestPointOnRay = eyePos.clone().addScaledVector(cameraLookDir, proj);
            const distToRay = closestPointOnRay.distanceTo(C);
            if (distToRay <= 0.65) {
              const hitDist = eyePos.distanceTo(C);
              if (hitDist < closestDist) {
                closestDist = hitDist;
                closestTarget = { type: 'other', id: otherId, data: other, pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z) };
                closestHitPoint.copy(closestPointOnRay);
              }
            }
          }
        }
      });
    }

    // Determine Final Hit Position
    const hasHit = closestTarget !== null;
    const finalHitPos = hasHit ? closestHitPoint : eyePos.clone().addScaledVector(cameraLookDir, 100);

    // Apply Damage & Particle Sparks on hit
    if (hasHit) {
      // Spawn sparkly explosion of impact chunks
      spawnVoxelShockwaveParticles(finalHitPos, '#fffa00');
      spawnVoxelShockwaveParticles(finalHitPos, '#ef4444');
      sfx.playSwing(); // impact audio cue

      if (closestTarget.type === 'other') {
        if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify({ 
            type: 'sync', 
            action: 'hit_taken', 
            damage: 1, 
            targetId: closestTarget.id,
            weapon: 'sword'
          }));
        } else {
          const bot = closestTarget.data;
          bot.hp = Math.max(0, bot.hp - 1);
          s.lastStrikePos = bot.pos.clone ? bot.pos.clone() : new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z);
          s.lastStrikeTick = 1.0;
          if (bot.hp <= 0) {
            bot.hp = 0;
            bot.respawnTimer = 3.0;
            if (bot.controller === 'ai') {
              bot.aiState = 'RESPAWNING';
              bot.weaponState = 'ready';
              bot.weaponTimer = 0;
              if (bot.id === MAIN_AI_ID) {
                s.scorePlayer += 1;
                s.playerKills += 1;
                s.enemyDeaths += 1;
                recordBotCalibrationDeath(bot.id);
              } else {
                bot.deaths += 1;
                s.scorePlayer += 1;
                s.playerKills += 1;
              }
            } else {
              bot.deaths += 1;
              s.scorePlayer += 1;
              s.playerKills += 1;
            }
            sfx.playDeath();
            const medals = evaluatePlayerKillMedals(bot.id);
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: bot.playerName || (bot.id === MAIN_AI_ID ? 'Red (AI)' : 'AI Bot'),
              medals,
              weapon: 'sword'
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(closestTarget.pos, '#ef4444');
          }
        }
      }
    }

    // 4. Render Laser Tracer Beam
    const traceGeo = new THREE.BufferGeometry().setFromPoints([muzzlePos, finalHitPos]);
    const tracerColor = s.settings.playerHue !== undefined 
      ? `hsl(${s.settings.playerHue}, 95%, 65%)` 
      : '#ffea00';
    const traceMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(tracerColor),
      transparent: true,
      opacity: 1.0,
    });
    const traceLine = new THREE.Line(traceGeo, traceMat);
    scene.add(traceLine);

    threeRef.current.tracers.push({
      mesh: traceLine,
      life: 0,
      maxLife: 0.15, // fast 150ms fade
      material: traceMat,
    });

    // 5. Render Bright Muzzle Flash Sphere
    const flashGeo = new THREE.SphereGeometry(0.04, 8, 8);
    const flashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(tracerColor),
      transparent: true,
      opacity: 0.85,
    });
    const flashMesh = new THREE.Mesh(flashGeo, flashMat);
    flashMesh.position.copy(muzzlePos);
    scene.add(flashMesh);

    threeRef.current.tracers.push({
      mesh: flashMesh,
      life: 0,
      maxLife: 0.05, // extremely brief muzzle glow (50ms)
      material: flashMat,
    });
  };

  // SWAPS PLAYER WEAPON
  const swapPlayerWeapon = (type: 'hammer' | 'sword' | 'pistol') => {
    const s = stateRef.current;
    if (s.playerHP <= 0 || isPaused || !isPlaying) return;
    if (s.isLunging) return; // cannot switch weapon during lunge

    if (s.activeWeapon === 'pistol') return; // once secret is unlocked, pistol replaces weapons
    if (s.swapLockoutTimer > 0) return;

    if (s.activeWeapon !== type) {
      s.activeWeapon = type;
      if (type !== 'pistol') {
        recordLocalPlayerObservation((model) => observePlayerWeaponSwap(model, type));
      }
      if (s.settings.weaponReadyTime > 0) {
        s.swapCooldownTimer = s.settings.weaponReadyTime;
        s.swapCooldownDuration = s.settings.weaponReadyTime;
        s.pWeaponReady = false;
        s.pSwordReady = false;
        s.pWeaponCooldown = 0.0;
        s.pSwordCooldown = 0.0;
      }
      if (s.settings.weaponSwapLockout > 0) {
        s.swapLockoutTimer = s.settings.weaponSwapLockout;
      }
    }

    const hammer = threeRef.current.playerHammer;
    const sword = threeRef.current.playerSword;
    const pistol = threeRef.current.playerPistol;
    if (hammer && sword) {
      if (type === 'hammer') {
        hammer.visible = true;
        sword.visible = false;
        if (pistol) pistol.visible = false;
      } else if (type === 'pistol') {
        hammer.visible = false;
        sword.visible = false;
        if (pistol) pistol.visible = true;
      } else {
        hammer.visible = false;
        sword.visible = true;
        if (pistol) pistol.visible = false;
      }
    }
    // Update stats immediately on swap
    pushStatsUpdate();
  };

  // TRIGGERS PLAYER SWORD SLASH
  const triggerPlayerSwordSlash = () => {
    const s = stateRef.current;
    if (s.swapCooldownTimer > 0) return;
    if (s.playerDashRemaining > 0) return;
    s.pSwordState = 'slashing';
    s.pSwordTimer = 0;
    s.pSwordReady = false;
    s.lastPlayerSwordAttackTime = Date.now();
    sfx.playSwing();

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'slash_sword' }));
    }
  };

  // TRIGGERS PLAYER SWORD LUNGE
  const triggerPlayerSwordLunge = () => {
    const s = stateRef.current;
    if (s.swapCooldownTimer > 0) return;
    if (s.playerDashRemaining > 0) return;
    const lockTarget = getPlayerSwordLockTarget();
    if (!lockTarget) return;
    const lungeDir = lockTarget.pos.clone().sub(s.playerPos);
    lungeDir.y = 0;
    if (lungeDir.lengthSq() <= 0.0001) return;
    const lungeDistance = lungeDir.length();

    s.isLunging = true;
    s.lungeTimer = 0;
    s.lungeStartPos.copy(s.playerPos);
    s.lungeTargetDir.copy(lungeDir).normalize();
    recordLocalPlayerObservation((model) => observePlayerLungeStart(model, lungeDistance));
    s.pSwordState = 'ready'; // reset weapon timing states during lunge glide
    s.lastPlayerSwordAttackTime = Date.now();
    sfx.playDash(); // play speed dash trail sound

    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'lunge_sword', dir: { x: s.lungeTargetDir.x, y: s.lungeTargetDir.y, z: s.lungeTargetDir.z } }));
    }
  };

  // TRIGGERS ENEMY AI SWING (offline main_ai or multiplayer remote opponent proxy)
  const enemyCombatProxy = (): Combatant | undefined => opponentDisplay() ?? mai();

  const triggerEnemyHammerSwing = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    enemy.weaponState = 'swing_up';
    enemy.weaponTimer = 0;
    enemy.lastHammerAttackTime = Date.now();
  };

  // TRIGGERS ENEMY AI HAMMER MELEE
  const triggerEnemyHammerMelee = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    enemy.weaponState = 'melee_up';
    enemy.weaponTimer = 0;
    enemy.lastHammerAttackTime = Date.now();
    sfx.playSwing();
  };

  // TRIGGERS ENEMY AI SWORD SLASH
  const triggerEnemySwordSlash = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    enemy.weaponState = 'swing_up';
    enemy.weaponTimer = 0;
    enemy.lastSwordAttackTime = Date.now();
    sfx.playSwing();
  };

  // TRIGGERS ENEMY AI SWORD LUNGE
  const triggerEnemySwordLunge = (customDir?: THREE.Vector3) => {
    const s = stateRef.current;
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    enemy.aiState = 'LUNGING';
    enemy.lungeTimer = 0;
    const lungeStart = enemy.lungeStartPos instanceof THREE.Vector3
      ? enemy.lungeStartPos
      : new THREE.Vector3();
    const lungeDir = enemy.lungeTargetDir instanceof THREE.Vector3
      ? enemy.lungeTargetDir
      : new THREE.Vector3();
    if (!(enemy.lungeStartPos instanceof THREE.Vector3)) enemy.lungeStartPos = lungeStart;
    if (!(enemy.lungeTargetDir instanceof THREE.Vector3)) enemy.lungeTargetDir = lungeDir;
    lungeStart.copy(enemy.pos);
    if (customDir) {
      lungeDir.copy(customDir);
    } else {
      const target = getEnemyAITarget();
      const targetPos = target ? target.pos.clone() : s.playerPos.clone();
      const targetAirborne = target ? (target.pos.y > 0.35 || (target.vel && Math.abs(target.vel.y) > 1.0)) : (s.playerPos.y > 0.35 || Math.abs(s.playerVel.y) > 1.0);
      lungeDir.copy(targetPos).sub(enemy.pos);
      if (!targetAirborne) {
        lungeDir.y = 0;
      }
    }
    if (lungeDir.lengthSq() <= 0.0001) {
      enemy.aiState = 'APPROACHING';
      return;
    }
    lungeDir.normalize();
    const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
    enemy.vel.y = Math.max(enemy.vel.y, lungeDir.y * lungeSpeed);
    enemy.isJumping = enemy.pos.y > 0.01 || enemy.vel.y > 0.01;
    enemy.weaponState = 'ready';
    enemy.lastSwordAttackTime = Date.now();
    sfx.playDash();
  };

  const getLocalPlayerFeedName = () => {
    const s = stateRef.current;
    if (s.settings.playerName) return s.settings.playerName;
    return multiplayerRole === 'client' ? 'Red (You)' : 'Blue (You)';
  };

  const recordDeathEvent = (
    attacker: string, 
    victim: string, 
    medals?: MedalInfo[], 
    weapon?: 'sword' | 'hammer' | 'sword_vs_sword' | 'sword_vs_hammer' | 'hammer_vs_hammer'
  ) => {
    const s = stateRef.current;
    const newDeath: DeathEvent = {
      id: Math.random().toString(36).substring(2, 9),
      attacker,
      victim,
      medals,
      weapon,
    };
    s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
    return newDeath;
  };

  const applyOutgoingMultiplayerHitLocally = (targetId: string, damage: number = 1) => {
    const s = stateRef.current;
    const target = s.otherPlayers.get(targetId);
    if (!target || target.hp <= 0 || target.respawnTimer > 0) return;

    target.hp = Math.max(0, target.hp - damage);
    if (target.hp <= 0) {
      target.hp = 0;
      target.respawnTimer = 3.0;
      target.deaths = (target.deaths || 0) + 1;
      s.scorePlayer += 1;
      s.playerKills += 1;
      sfx.playDeath();
      const medals = evaluatePlayerKillMedals(targetId);
      recordDeathEvent(getLocalPlayerFeedName(), target.playerName, medals, s.activeWeapon);
      spawnVoxelShockwaveParticles(new THREE.Vector3(target.pos.x, target.pos.y, target.pos.z), '#ef4444');
    }
  };

  const executeCustomBotTrade = (attackerBot: any, target: any, reason: 'sword_vs_sword' | 'sword_lunge_vs_hammer' = 'sword_vs_sword') => {
    const s = stateRef.current;
    const tradeText = reason === 'sword_vs_sword' ? 'Sword Trade' : 'Lunge/Hammer Trade';
    const tradeWeapon: DeathEvent['weapon'] = reason === 'sword_vs_sword' ? 'sword_vs_sword' : 'sword_vs_hammer';

    attackerBot.hp = Math.max(0, attackerBot.hp - 1);
    const targetCombatant = target.id === 'player' ? undefined : rosterCombatant(target.id);
    if (target.id === 'player') {
      s.playerHP = Math.max(0, s.playerHP - 1);
    } else if (targetCombatant) {
      targetCombatant.hp = Math.max(0, targetCombatant.hp - 1);
    }

    sfx.playExplosion();
    sfx.playDeath();

    if (attackerBot.hp <= 0) {
      attackerBot.hp = 0;
      attackerBot.respawnTimer = 3.0;
      attackerBot.deaths = (attackerBot.deaths || 0) + 1;

      if (target.id === 'player') {
        s.scorePlayer += 1;
        s.playerKills += 1;
        const medals = evaluatePlayerKillMedals(attackerBot.id);
        recordDeathEvent(`${getLocalPlayerFeedName()} [${tradeText}]`, attackerBot.playerName, medals, tradeWeapon);
      } else if (targetCombatant) {
        if (targetCombatant.id === MAIN_AI_ID) {
          s.scoreEnemy += 1;
          s.enemyKills += 1;
        } else {
          targetCombatant.score = (targetCombatant.score || 0) + 1;
          targetCombatant.kills = (targetCombatant.kills || 0) + 1;
        }
        recordDeathEvent(
          `${targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id)} [${tradeText}]`,
          attackerBot.playerName,
          undefined,
          tradeWeapon
        );
      }
      spawnVoxelShockwaveParticles(new THREE.Vector3(attackerBot.pos.x, attackerBot.pos.y, attackerBot.pos.z), '#ef4444');
    }

    if (target.id === 'player' && s.playerHP <= 0) {
      s.playerHP = 0;
      s.playerRespawnTimer = 3.0;
      s.playerDeaths += 1;
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, getLocalPlayerFeedName(), undefined, tradeWeapon);
      spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
    } else if (targetCombatant && targetCombatant.hp <= 0) {
      targetCombatant.hp = 0;
      targetCombatant.respawnTimer = 3.0;
      if (targetCombatant.controller === 'ai') {
        targetCombatant.aiState = 'RESPAWNING';
      }
      if (targetCombatant.id === MAIN_AI_ID) {
        s.enemyDeaths += 1;
        recordBotCalibrationDeath(targetCombatant.id);
      } else {
        targetCombatant.deaths = (targetCombatant.deaths || 0) + 1;
      }
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      recordDeathEvent(
        `${attackerBot.playerName} [${tradeText}]`,
        targetCombatant.playerName || (targetCombatant.id === MAIN_AI_ID ? 'Red (AI)' : targetCombatant.id),
        undefined,
        tradeWeapon
      );
      spawnVoxelShockwaveParticles(new THREE.Vector3(targetCombatant.pos.x, targetCombatant.pos.y, targetCombatant.pos.z), '#ef4444');
    }

    attackerBot.isLunging = false;
    attackerBot.weaponState = 'ready';
    pushStatsUpdate();
  };

  function evaluatePlayerKillMedals(victimId: string): MedalInfo[] {
    const s = stateRef.current;
    const now = Date.now();

    let isLunging = false;
    let spawnTime = 0;

    const victim = victimId === 'player' ? undefined : rosterCombatant(victimId);
    if (victim) {
      isLunging = victim.aiState === 'LUNGING' || victim.isLunging || victim.weaponState === 'swing_up' || victim.weaponState === 'swing_down';
      spawnTime = victim.spawnTime || 0;
    }

    const result = evaluateKillMedals({
      isVictimLunging: isLunging,
      victimSpawnTime: spawnTime,
      playerHP: s.playerHP,
      playerMaxHP: s.playerMaxHP,
      playerLastKillTime: s.playerLastKillTime,
      playerMultikillCount: s.playerMultikillCount,
      playerSpreeCount: s.playerSpreeCount,
      activeWeapon: s.activeWeapon,
      now,
    });
    s.playerLastKillTime = result.playerLastKillTime;
    s.playerMultikillCount = result.playerMultikillCount;
    s.playerSpreeCount = result.playerSpreeCount;
    const medals = result.medals;

    // Trigger visual + audio chimes for medals!
    if (result.priorityMedal) {
      const priorityMedal = result.priorityMedal;
      sfx.playMedal(priorityMedal.id);
      s.activeMedalPopup = {
        medal: priorityMedal,
        key: Math.random()
      };

      // Reset active medal popup after 2.5 seconds
      setTimeout(() => {
        const innerS = stateRef.current;
        if (innerS && innerS.activeMedalPopup && innerS.activeMedalPopup.medal.id === priorityMedal.id) {
          innerS.activeMedalPopup = null;
          pushStatsUpdate();
        }
      }, 2500);
    }

    return medals;
  }

  // MUTUAL TRADING FUNCTIONALITY
  const executeTrade = (reason: 'sword_vs_sword' | 'sword_lunge_vs_hammer') => {
    const s = stateRef.current;

    // Reset both of their positions/movement states and inflict 1 damage
    s.playerHP = Math.max(0, s.playerHP - 1);
    mai()!.hp = Math.max(0, mai()!.hp - 1);

    // Audio cues
    sfx.playExplosion();
    sfx.playDeath();

    // Spawns beautiful particle visual feedback for both characters
    spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6'); // Blue player shockwave
    spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');    // Red AI shockwave

    // Render debug positions
    s.lastStrikePos = mai()!.pos.clone();
    s.lastStrikeTick = 1.2;
    s.lastAIStrikePos = s.playerPos.clone();
    s.lastAIStrikeTick = 1.2;

    // Handle Player death state
    if (s.playerHP <= 0) {
      s.playerHP = 0;
      s.playerRespawnTimer = 3.0;
      s.scoreEnemy += 1;
      s.playerDeaths += 1;
      s.enemyKills += 1;
    }
    s.pWeaponState = 'ready';
    s.pWeaponTimer = 0;
    s.pWeaponReady = true;
    s.pSwordState = 'ready';
    s.pSwordTimer = 0;
    s.pSwordReady = true;
    s.isLunging = false;
    s.lungeTimer = 0;

    // Handle AI death state
    let playerMedals: MedalInfo[] | undefined = undefined;
    if (mai()!.hp <= 0) {
      mai()!.hp = 0;
      mai()!.aiState = 'RESPAWNING';
      s.enemyRespawnTimer = 3.0;
      s.scorePlayer += 1;
      s.playerKills += 1;
      s.enemyDeaths += 1;
      recordBotCalibrationDeath('main_ai');
      playerMedals = evaluatePlayerKillMedals('main_ai');
    }
    mai()!.weaponState = 'ready';
    mai()!.weaponTimer = 0;

    // Record death events for the kill feed (last 3 entries)
    const attackerText = reason === 'sword_vs_sword' ? 'Sword Trade' : 'Lunge/Hammer Trade';
    const tradeWeapon = reason === 'sword_vs_sword' ? 'sword_vs_sword' : 'sword_vs_hammer';
    const newDeath1: DeathEvent = {
      id: Math.random().toString(36).substring(2, 9),
      attacker: `Blue (You) [${attackerText}]`,
      victim: 'Red (AI)',
      medals: playerMedals,
      weapon: tradeWeapon,
    };
    const newDeath2: DeathEvent = {
      id: Math.random().toString(36).substring(2, 9),
      attacker: `Red (AI) [${attackerText}]`,
      victim: 'Blue (You)',
      weapon: tradeWeapon,
    };

    s.lastDeaths = [newDeath1, newDeath2, ...s.lastDeaths].slice(0, 3);

    pushStatsUpdate();
  };

  // TRIGGER PROGRAMMATIC EXPLOSION (Voxel shockwave particles)
  const spawnVoxelShockwaveParticles = (impactCenter: THREE.Vector3, color: string) => {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const count = 35; // particle count
    const voxelGeo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
    const voxelMatCache = new Map<string, THREE.Material>();

    for (let i = 0; i < count; i++) {
      // Random shades matching the blast theme (e.g. glowing solar cyan for player, glowing orange for AI)
      const isGlow = Math.random() > 0.35;
      const shadeHex = color;
      
      let mat = voxelMatCache.get(shadeHex);
      if (!mat) {
        mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(shadeHex),
          emissive: isGlow ? new THREE.Color(shadeHex) : undefined,
          emissiveIntensity: isGlow ? 1.5 : 0.0,
          roughness: 0.5,
          metalness: 0.1
        });
        voxelMatCache.set(shadeHex, mat);
      }

      const cube = new THREE.Mesh(voxelGeo, mat);
      
      // Position slightly offset around the floor impact point
      cube.position.copy(impactCenter);
      cube.position.x += (Math.random() - 0.5) * 0.4;
      cube.position.y += Math.random() * 0.3; // start close to surface
      cube.position.z += (Math.random() - 0.5) * 0.4;

      // Rapid vector velocities flying upwards and outwards
      const angle = Math.random() * Math.PI * 2;
      const speedHorizon = Math.random() * 5.5 + 2.5; 
      const vx = Math.cos(angle) * speedHorizon;
      const vz = Math.sin(angle) * speedHorizon;
      const vy = Math.random() * 5.0 + 3.2; // explosive jump speed

      const particleData = {
        mesh: cube,
        velocity: new THREE.Vector3(vx, vy, vz),
        life: 0.0,
        maxLife: Math.random() * 0.5 + 0.45, // lifespan around 0.5-1s
      };

      scene.add(cube);
      threeRef.current.damageExplosionParticles.push(particleData);
    }
  };

  const spawnNeonBlueHammerFlash = (impactCenter: THREE.Vector3, radius: number) => {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const flashGeo = new THREE.SphereGeometry(1, 32, 16);
    const flashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#38bdf8'),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(flashGeo, flashMat);
    flash.position.copy(impactCenter);
    flash.scale.setScalar(Math.max(0.05, radius * 0.12));
    scene.add(flash);

    threeRef.current.hammerSplashFlashes.push({
      mesh: flash,
      life: 0,
      maxLife: 0.42,
      targetRadius: Math.max(0.1, radius),
    });
  };

  const renderHammerSplashVfx = (impactCenter: THREE.Vector3, color: string, radius: number) => {
    const s = stateRef.current;
    const splashVfx = s.settings.hammerSplashVfx ?? 'current';

    if (splashVfx === 'neonBlueFlash') {
      spawnNeonBlueHammerFlash(impactCenter, radius);
      return;
    }

    spawnVoxelShockwaveParticles(impactCenter, color);

    if (s.settings.enableBurnDecals) {
      const H = impactCenter.y;
      if (Math.abs(H) <= radius) {
        spawnBurnDecal(impactCenter, radius);
      }
    }
  };

  const spawnCurrentSwordLungeCubeTrail = (
    trailPos: THREE.Vector3,
    color: string,
    style: Extract<SwordLungeCurrentTrailStyle, 'localCube' | 'enemyCube'>
  ) => {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const size = style === 'localCube' ? 0.08 : 0.12;
    const opacity = style === 'localCube' ? 0.8 : 0.75;
    const geo = new THREE.BoxGeometry(size, size, size);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(trailPos);
    scene.add(mesh);
    threeRef.current.damageExplosionParticles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.1, Math.random() * 0.15, (Math.random() - 0.5) * 0.1),
      life: 0.0,
      maxLife: 0.18,
    });
  };

  const getSwordLungeTrailDirection = (direction?: THREE.Vector3) => {
    const dir = direction?.clone() ?? new THREE.Vector3(0, 0, -1);
    if (dir.lengthSq() <= 0.0001) {
      dir.set(0, 0, -1);
    }
    return dir.normalize();
  };

  const spawnSwordLungeSpeedLines = (trailPos: THREE.Vector3, color: string, direction?: THREE.Vector3) => {
    const scene = threeRef.current.scene;
    if (!scene) return;

    const dir = getSwordLungeTrailDirection(direction);
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir);
    if (side.lengthSq() <= 0.0001) {
      side.set(1, 0, 0);
    } else {
      side.normalize();
    }

    const lineCount = 2 + Math.floor(Math.random() * 2);
    const highlightColor = color === '#22d3ee' ? '#a5f3fc' : '#fb923c';

    for (let i = 0; i < lineCount; i++) {
      const length = 0.75 + Math.random() * 0.95;
      const width = 0.018 + Math.random() * 0.025;
      const startOpacity = 0.72 + Math.random() * 0.18;
      const geo = new THREE.BoxGeometry(width, width, length);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(i === 0 ? highlightColor : color),
        transparent: true,
        opacity: startOpacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(trailPos);
      mesh.position.addScaledVector(dir, -length * (0.45 + Math.random() * 0.35));
      mesh.position.addScaledVector(side, (Math.random() - 0.5) * 0.72);
      mesh.position.y += (Math.random() - 0.5) * 0.36;
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      scene.add(mesh);

      threeRef.current.swordLungeSpeedLines.push({
        mesh,
        drift: dir.clone().multiplyScalar(-1.8 - Math.random() * 1.4),
        life: 0,
        maxLife: 0.14 + Math.random() * 0.08,
        startOpacity,
      });
    }
  };

  const renderSwordLungeTrailVfx = (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle: SwordLungeCurrentTrailStyle = 'localCube'
  ) => {
    if (Math.random() <= 0.1) return;

    const lungeVfx = stateRef.current.settings.swordLungeVfx ?? 'current';
    if (lungeVfx === 'speedLineTrail') {
      spawnSwordLungeSpeedLines(trailPos, color, direction);
      return;
    }

    if (currentStyle === 'shockwave') {
      spawnVoxelShockwaveParticles(trailPos, color);
      return;
    }

    spawnCurrentSwordLungeCubeTrail(trailPos, color, currentStyle);
  };

  // PHYSICS UPDATE (Player relative to WASD & Crouch heights)
  const updatePhysics = (dt: number) => {
    const s = stateRef.current;

    // Right Joystick continuous aim/look around (frame-rate-independent aiming)
    if ((deviceInfo.isMobile || forceMobileControls) && mobileRightJoystickActiveRef.current && mobileRightJoystickRef.current) {
      const baseAimSens = 2.4 * (keybindings.mouseSensitivity ?? 1.0);
      s.yaw -= mobileRightJoystickRef.current.x * baseAimSens * dt;
      s.pitch -= mobileRightJoystickRef.current.y * baseAimSens * dt;
      s.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, s.pitch));
    }

    // Gamepad connection & Right Stick continuous look aiming
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gamepad = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i]) {
        gamepad = gamepads[i];
        break;
      }
    }

    if (gamepad) {
      const rx = gamepad.axes[2];
      const ry = gamepad.axes[3];
      const aimDeadzone = 0.18;
      if (Math.abs(rx) > aimDeadzone || Math.abs(ry) > aimDeadzone) {
        const gpSens = keybindingsRef.current.gamepadSensitivity ?? 3.0;
        const baseSpeed = 2.4; 
        
        let targetYawOffset = 0;
        let targetPitchOffset = 0;

        if (Math.abs(rx) > aimDeadzone) {
          targetYawOffset = rx * baseSpeed * gpSens * dt;
        }
        if (Math.abs(ry) > aimDeadzone) {
          targetPitchOffset = ry * baseSpeed * gpSens * dt;
        }

        s.yaw -= targetYawOffset;
        s.pitch -= targetPitchOffset;
        s.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, s.pitch));
      }

      // Process edge-triggered gamepad buttons
      const curButtons = gamepad.buttons.map(b => b.pressed);
      const prevButtons = prevGamepadButtonsRef.current;

      const isNewlyPressed = (btnIndex: number) => {
        return curButtons[btnIndex] && !prevButtons[btnIndex];
      };
      const isNewlyReleased = (btnIndex: number) => {
        return !curButtons[btnIndex] && prevButtons[btnIndex];
      };

      // Jump
      const jumpBtn = keybindingsRef.current.gamepadJump ?? 0;
      if (isNewlyPressed(jumpBtn)) {
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying) {
          if (s.pHammerJumpWindowTimer > 0) {
            s.isJumping = true;
            s.playerVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
            s.pHammerJumpWindowTimer = 0; // Consume the window
            sfx.playJump();
            spawnVoxelShockwaveParticles(s.playerPos, '#f59e0b');
          } else if (!s.isJumping) {
            s.isJumping = true;
            s.playerVel.y = 7.2;
            sfx.playJump();
          }
        }
      }

      // Dash
      const dashBtn = keybindingsRef.current.gamepadDash ?? 2;
      if (isNewlyPressed(dashBtn)) {
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying && s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0) {
          let lx = gamepad.axes[0];
          let ly = gamepad.axes[1];
          const moveDeadzone = 0.18;
          
          let fMove = 0;
          let rMove = 0;
          if (keysPressed.current[keybindingsRef.current.moveForward] || keysPressed.current['arrowup']) fMove += 1;
          if (keysPressed.current[keybindingsRef.current.moveBackward] || keysPressed.current['arrowdown']) fMove -= 1;
          if (keysPressed.current[keybindingsRef.current.moveRight] || keysPressed.current['arrowright']) rMove += 1;
          if (keysPressed.current[keybindingsRef.current.moveLeft] || keysPressed.current['arrowleft']) rMove -= 1;

          if (Math.abs(ly) > moveDeadzone) fMove -= ly;
          if (Math.abs(lx) > moveDeadzone) rMove += lx;

          const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
          const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

          const dDir = new THREE.Vector3(0, 0, 0);
          if (fMove !== 0 || rMove !== 0) {
            dDir.addScaledVector(forwardDir, fMove).addScaledVector(rightDir, rMove).normalize();
          } else {
            dDir.copy(forwardDir).normalize();
          }

          s.playerDashDir.copy(dDir);
          s.playerDashRemaining = s.settings.dashDuration || 0.25;
          s.playerDashCooldownTimer = s.settings.dashCooldown || 2.0;
          recordLocalPlayerObservation((model) => {
            observePlayerDash(model, dDir.x, dDir.z);
            if (!isMultiplayer && mai()!.hp > 0 && mai()!.weaponState === 'swing_up') {
              observePlayerReaction(model, mai()!.weaponTimer ?? 0);
            }
          });
          sfx.playDash();
        }
      }

      // Crouch
      const crouchBtn = keybindingsRef.current.gamepadCrouch ?? 1;
      if (isNewlyPressed(crouchBtn)) {
        s.isCrouching = true;
        sfx.playCrouch();
      } else if (isNewlyReleased(crouchBtn)) {
        s.isCrouching = false;
      }

      // Swap Weapon
      const swapBtn = keybindingsRef.current.gamepadSwapWeapon ?? 3;
      if (isNewlyPressed(swapBtn)) {
        if (s.playerHP > 0 && !s.isLunging) {
          const current = s.activeWeapon;
          const next = current === 'hammer' ? 'sword' : 'hammer';
          swapPlayerWeapon(next);
        }
      }

      // Attack (RT)
      const attackBtn = keybindingsRef.current.gamepadAttack ?? 7;
      if (isNewlyPressed(attackBtn)) {
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying) {
          if (s.activeWeapon === 'hammer') {
            if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
              triggerPlayerHammerSwing();
            }
          } else {
            if (s.crosshairColor === 'red' && s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
              triggerPlayerSwordLunge();
            }
          }
        }
      }

      // Alt Attack (RB)
      const altAttackBtn = keybindingsRef.current.gamepadAltAttack ?? 5;
      if (isNewlyPressed(altAttackBtn)) {
        if (s.playerHP > 0 && !isPausedRef.current && isPlaying) {
          if (s.activeWeapon === 'sword') {
            if (s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
              triggerPlayerSwordSlash();
            }
          }
        }
      }

      // Scoreboard
      const scoreboardBtn = keybindingsRef.current.gamepadScoreboard ?? 8;
      if (isNewlyPressed(scoreboardBtn)) {
        s.showScoreboard = true;
        pushStatsUpdate();
      } else if (isNewlyReleased(scoreboardBtn)) {
        s.showScoreboard = false;
        pushStatsUpdate();
      }

      // Pause
      const pauseBtn = keybindingsRef.current.gamepadPause ?? 9;
      if (isNewlyPressed(pauseBtn)) {
        onPauseToggle();
      }

      prevGamepadButtonsRef.current = curButtons;
    } else {
      prevGamepadButtonsRef.current = [];
    }

    // Handle Observer Spectator movement controls
    if (s.isObserverMode) {
      if (s.observerCamMode === 'free') {
        const forwardDir = new THREE.Vector3(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
        const rightDir = new THREE.Vector3(1, 0, 0)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
          .normalize();
        const upDir = new THREE.Vector3(0, 1, 0);

        let moveForward = 0;
        let moveRight = 0;
        let moveUp = 0;
        if (keysPressed.current[keybindings.moveForward] || keysPressed.current['arrowup']) moveForward += 1;
        if (keysPressed.current[keybindings.moveBackward] || keysPressed.current['arrowdown']) moveForward -= 1;
        if (keysPressed.current[keybindings.moveRight] || keysPressed.current['arrowright']) moveRight += 1;
        if (keysPressed.current[keybindings.moveLeft] || keysPressed.current['arrowleft']) moveRight -= 1;
        
        // Gamepad Left Stick in observer mode
        if (gamepad) {
          const lx = gamepad.axes[0];
          const ly = gamepad.axes[1];
          const moveDeadzone = 0.18;
          if (Math.abs(ly) > moveDeadzone) moveForward -= ly;
          if (Math.abs(lx) > moveDeadzone) moveRight += lx;
        }

        // Rise and Lower controls
        const gpJump = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadJump ?? 0]?.pressed : false;
        const gpCrouch = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadCrouch ?? 1]?.pressed : false;

        if (keysPressed.current[keybindings.jump] || keysPressed.current['spacebar'] || gpJump) moveUp += 1;
        if (keysPressed.current[keybindings.crouch] || gpCrouch) moveUp -= 1;

        const gpSprint = gamepad ? gamepad.buttons[keybindingsRef.current.gamepadSprint ?? 10]?.pressed : false;
        const speedMultiplier = (keysPressed.current['shift'] || gpSprint) ? 2.8 : 1.0;
        const flySpeed = 11.0 * speedMultiplier * dt;

        s.playerPos.addScaledVector(forwardDir, moveForward * flySpeed);
        s.playerPos.addScaledVector(rightDir, moveRight * flySpeed);
        s.playerPos.addScaledVector(upDir, moveUp * flySpeed);
      }
      return; // Skip normal player physics entirely
    }
    
    // Check if player is alive. If dead, countdown respawn timer
    const playerIsDead = s.playerHP <= 0;
    if (playerIsDead) {
      s.playerSpreeCount = 0; // Reset killing spree when dead!
      s.playerRespawnTimer -= dt;
      if (s.playerRespawnTimer <= 0) {
        s.playerHP = s.playerMaxHP;
        const exclude: THREE.Vector3[] = [];
        if (s.otherPlayers) {
          s.otherPlayers.forEach((other) => {
            if (other.hp > 0 && other.respawnTimer <= 0) {
              exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            }
          });
        }
        if (!isMultiplayer && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING') {
          exclude.push(mai()!.pos);
        }
        
        const spawnPos = getOptimalSpawnPoint(exclude);
        s.playerPos.copy(spawnPos);
        s.yaw = getInwardSpawnYaw(spawnPos);
        s.playerVel.set(0, 0, 0);
        s.pitch = 0;
        s.playerInvulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
        s.playerSpawnTime = Date.now();
        s.swapLockoutTimer = 0;
        s.swapCooldownTimer = 0;
        sfx.playRespawn();
      }
    }

    if (!playerIsDead) {
      // If player is currently lunging, glide directly towards the enemy on a locked linear path
    if (s.isLunging) {
      s.lungeTimer += dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      s.playerVel.copy(s.lungeTargetDir).multiplyScalar(lungeSpeed);
      
      s.playerPos.x += s.playerVel.x * dt;
      s.playerPos.z += s.playerVel.z * dt;
      s.playerPos.y = 0;
      s.playerVel.y = 0;
      s.isJumping = false;
      s.isCrouching = false;
      constrainCombatantToArena(s.playerPos, s.playerVel);

      // Spawn energy trail particles or selected lunge speed-line effect.
      const trailPos = s.playerPos.clone();
      trailPos.y += 0.5;
      renderSwordLungeTrailVfx(trailPos, '#22d3ee', s.lungeTargetDir, 'localCube');

      // Check distance to enemy torso center
      let closestTarget: any = null;
      let dist = Infinity;

      if (!isMultiplayer && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING') {
        closestTarget = { id: 'main_ai', pos: mai()!.pos, hp: mai()!.hp, name: 'Red (AI)' };
        dist = s.playerPos.distanceTo(mai()!.pos);
      }
      
      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0) {
            const d = s.playerPos.distanceTo(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            if (d < dist) {
              dist = d;
              closestTarget = { id: other.id, pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), hp: other.hp, name: other.playerName };
            }
          }
        });
      }

      if (!closestTarget) {
        s.isLunging = false;
        recordPlayerLungeEndObservation(false);
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      } else if (dist <= 1.5) {
        s.isLunging = false;
        recordPlayerLungeEndObservation(true);
        sfx.playExplosion();
        spawnVoxelShockwaveParticles(closestTarget.pos, '#22d3ee');
        s.lastStrikePos = closestTarget.pos.clone();
        s.lastStrikeTick = 1.2;

        if (s.isMultiplayer) {
          const other = s.otherPlayers.get(closestTarget.id);
          const swordThreshold = s.settings.swordTradeWindow ?? 350;
          const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;

          const isOtherSwordActiveAttack = other && s.settings.enableSwordTrade && other.activeWeapon === 'sword' && (
            other.isLunging || 
            other.weaponState === 'swing_up' || 
            other.weaponState === 'swing_down' ||
            (other.lastSwordAttackTime && (Date.now() - other.lastSwordAttackTime <= swordThreshold))
          );
          const isOtherHammerActiveAttack = other && s.settings.enableHammerSwordTrade && other.activeWeapon === 'hammer' && (
            other.weaponState === 'swing_up' || 
            other.weaponState === 'swing_down' ||
            (other.lastHammerAttackTime && (Date.now() - other.lastHammerAttackTime <= hammerThreshold))
          );

          if (isOtherSwordActiveAttack || isOtherHammerActiveAttack) {
            // TRADE DETECTED!
            s.playerHP = Math.max(0, s.playerHP - 1);
            sfx.playExplosion();
            sfx.playDeath();
            spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
            
            if (s.playerHP <= 0) {
              s.playerHP = 0;
              s.playerRespawnTimer = 3.0;
              s.playerDeaths += 1;
              
              if (other) {
                other.score = (other.score || 0) + 1;
                other.kills = (other.kills || 0) + 1;
              }
              
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: (other && other.playerName) || 'Player',
                victim: s.settings.playerName || 'Blue (You)',
                weapon: isOtherSwordActiveAttack ? 'sword_vs_sword' : 'sword_vs_hammer',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            }
            
            // Notify the remote player that they took damage too
            if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
              multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: closestTarget.id, weapon: s.activeWeapon }));
              applyOutgoingMultiplayerHitLocally(closestTarget.id, 1);
            }
            
            pushStatsUpdate();
            return;
          }

          if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
            multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: closestTarget.id }));
            applyOutgoingMultiplayerHitLocally(closestTarget.id, 1);
          }
        } else {
          if (closestTarget.id === 'main_ai') {
            const swordThreshold = s.settings.swordTradeWindow ?? 350;
            const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;
            const isAISwordActiveAttack = s.settings.enableSwordTrade && mai()!.activeWeapon === 'sword' && (
              mai()!.aiState === 'LUNGING' || 
              mai()!.weaponState === 'swing_up' || 
              mai()!.weaponState === 'swing_down' || 
              (Date.now() - mai()!.lastSwordAttackTime <= swordThreshold)
            );
            const isAIHammerActiveAttack = s.settings.enableHammerSwordTrade && mai()!.activeWeapon === 'hammer' && (
              mai()!.weaponState === 'swing_up' || 
              mai()!.weaponState === 'swing_down' ||
              (Date.now() - mai()!.lastHammerAttackTime <= hammerThreshold)
            );

            if (isAISwordActiveAttack) {
              executeTrade('sword_vs_sword');
              recordLocalPlayerObservation((model) => observePlayerCounter(model, true));
              return;
            } else if (isAIHammerActiveAttack) {
              executeTrade('sword_lunge_vs_hammer');
              recordLocalPlayerObservation((model) => observePlayerCounter(model, true));
              return;
            }

            recordPlayerDamageDealt(isAISwordActiveAttack || isAIHammerActiveAttack);
            recordCalibrationDodgeFailed(stateRef.current.aiMatchContext, 'main_ai');
            mai()!.hp -= 1;
            if (mai()!.hp <= 0) {
              mai()!.hp = 0;
              mai()!.aiState = 'RESPAWNING';
              s.enemyRespawnTimer = 3.0;
              s.scorePlayer += 1;
              s.playerKills += 1;
              s.enemyDeaths += 1;
              recordBotCalibrationDeath('main_ai');
              sfx.playDeath();
              mai()!.weaponState = 'ready';
              mai()!.weaponTimer = 0;

              const medals = evaluatePlayerKillMedals('main_ai');
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: s.settings.playerName || 'Blue (You)',
                victim: 'Red (AI)',
                medals,
                weapon: 'sword',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');
            } else {
              sfx.playSwing();
            }
          } else {
            const other = s.otherPlayers.get(closestTarget.id);
            if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
              other.hp -= 1;
              if (other.hp <= 0) {
                other.hp = 0;
                other.respawnTimer = 3.0;
                s.scorePlayer += 1;
                s.playerKills += 1;
                other.deaths += 1;
                sfx.playDeath();

                const medals = evaluatePlayerKillMedals(closestTarget.id);
                const newDeath: DeathEvent = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: s.settings.playerName || 'Blue (You)',
                  victim: other.playerName,
                  medals,
                  weapon: 'sword',
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(closestTarget.pos, '#ef4444');
              } else {
                sfx.playSwing();
              }
            }
          }
        }

        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
        pushStatsUpdate();
      }

      // Safeguard limits to break out of lunge
      const startDist = s.playerPos.distanceTo(s.lungeStartPos);
      if (startDist > 16.0 || s.lungeTimer > 0.8) {
        s.isLunging = false;
        recordPlayerLungeEndObservation(false);
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      }

      // Arena constraints
      let hitsBoundary = false;
      const activeCustomMap = getActiveCustomMap();
      if (activeCustomMap?.mapShape === 'rectangular') {
        const boundX = (activeCustomMap.arenaRadius * 1.2) - 0.6;
        const boundZ = (activeCustomMap.arenaRadius * 0.6) - 0.6;
        hitsBoundary = Math.abs(s.playerPos.x) >= boundX || Math.abs(s.playerPos.z) >= boundZ;
      } else {
        const distFromCenter = Math.sqrt(s.playerPos.x * s.playerPos.x + s.playerPos.z * s.playerPos.z);
        const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
        hitsBoundary = distFromCenter >= radiusToUse - 0.6;
      }

      if (hitsBoundary) {
        constrainCombatantToArena(s.playerPos, s.playerVel);
        s.isLunging = false;
        recordPlayerLungeEndObservation(false);
        s.pSwordState = 'recovering';
        s.pSwordTimer = 0;
        s.pSwordReady = false;
        s.pSwordRecoverDuration = s.settings.swordLungeReload ?? 1.2;
      }

      return; // Skip standard movement input calculations
    }

    // Tick down player invulnerability timer
    if (s.playerInvulnerabilityTimer > 0) {
      s.playerInvulnerabilityTimer = Math.max(0, s.playerInvulnerabilityTimer - dt);
    }

    // Process dash timers
    if (s.playerDashCooldownTimer > 0) {
      s.playerDashCooldownTimer = Math.max(0, s.playerDashCooldownTimer - dt);
    }

    // Process slide cooldown
    if (s.playerSlideCooldownTimer > 0) {
      s.playerSlideCooldownTimer = Math.max(0, s.playerSlideCooldownTimer - dt);
    }

    const isPlayerDashing = s.playerDashRemaining > 0;
    if (isPlayerDashing) {
      s.playerDashRemaining = Math.max(0, s.playerDashRemaining - dt);
      
      const speed = s.settings.dashDistance / (s.settings.dashDuration || 0.25);
      s.playerVel.x = s.playerDashDir.x * speed;
      s.playerVel.z = s.playerDashDir.z * speed;

      // Spawn beautiful cyber cyan tail particles
      if (Math.random() > 0.15) {
        const trailPos = s.playerPos.clone();
        trailPos.y += 0.5; // midway
        const scene = threeRef.current.scene;
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color('#38bdf8'),
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          mesh.position.x += (Math.random() - 0.5) * 0.3;
          mesh.position.y += (Math.random() - 0.5) * 0.5;
          mesh.position.z += (Math.random() - 0.5) * 0.3;
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
            life: 0.0,
            maxLife: 0.25 + Math.random() * 0.15,
          });
        }
      }
    } else {
      // Crouch height interpolation
      const targetCrouch = s.isCrouching ? 0.72 : 0.0;
      s.crouchAmount += (targetCrouch - s.crouchAmount) * 12.0 * dt;

      const forwardDir = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
      const rightDir = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);

      const moveDirection = new THREE.Vector3(0, 0, 0);
      
      let moveForward = 0;
      let moveRight = 0;
      if (keysPressed.current[keybindings.moveForward] || keysPressed.current['arrowup']) moveForward += 1;
      if (keysPressed.current[keybindings.moveBackward] || keysPressed.current['arrowdown']) moveForward -= 1;
      if (keysPressed.current[keybindings.moveRight] || keysPressed.current['arrowright']) moveRight += 1;
      if (keysPressed.current[keybindings.moveLeft] || keysPressed.current['arrowleft']) moveRight -= 1;

      // Gamepad Left Stick movement
      const gamepadsList = navigator.getGamepads ? navigator.getGamepads() : [];
      let activeGp = null;
      for (let i = 0; i < gamepadsList.length; i++) {
        if (gamepadsList[i]) { activeGp = gamepadsList[i]; break; }
      }
      if (activeGp) {
        const lx = activeGp.axes[0];
        const ly = activeGp.axes[1];
        const moveDeadzone = 0.18;
        if (Math.abs(ly) > moveDeadzone) moveForward -= ly;
        if (Math.abs(lx) > moveDeadzone) moveRight += lx;
      }

      // Mobile joystick movement overrides keyboard
      if ((deviceInfo.isMobile || forceMobileControls) && mobileJoystickRef.current) {
        moveForward += mobileJoystickRef.current.y;
        moveRight += mobileJoystickRef.current.x;
      }

      // Check raw sliding conditions
      const rawSlideConditionsMet = s.settings.enableSlide && s.isCrouching && moveForward > 0 && !s.isJumping && s.playerDashRemaining <= 0;

      // Process Sliding State Machine
      if (!s.playerSlideActive) {
        if (rawSlideConditionsMet && s.playerSlideCooldownTimer <= 0) {
          s.playerSlideActive = true;
          s.playerSlideDistanceTraveled = 0.0;
          s.playerSlideLastPos.copy(s.playerPos);
        }
      } else {
        if (!rawSlideConditionsMet) {
          s.playerSlideActive = false;
          s.playerSlideCooldownTimer = s.settings.slideCooldown ?? 1.5;
        } else {
          // Measure horizontal distance traveled (ignore Y dimension)
          const dist = new THREE.Vector2(s.playerPos.x, s.playerPos.z).distanceTo(new THREE.Vector2(s.playerSlideLastPos.x, s.playerSlideLastPos.z));
          s.playerSlideDistanceTraveled += dist;
          s.playerSlideLastPos.copy(s.playerPos);

          if (s.playerSlideDistanceTraveled >= (s.settings.slideDistance ?? 8.0)) {
            s.playerSlideActive = false;
            s.playerSlideCooldownTimer = s.settings.slideCooldown ?? 1.5;
          }
        }
      }

      // Check sprint & slide states
      const gpSprint = activeGp ? activeGp.buttons[keybindingsRef.current.gamepadSprint ?? 10]?.pressed : false;
      const isSprinting = s.settings.enableSprint && (keysPressed.current[keybindingsRef.current.sprint] || gpSprint) && moveForward > 0 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0;
      const isSliding = s.playerSlideActive;

      // Movement speed coefficients
      let baseSpeed = 5.8;
      if (s.isCrouching) {
        if (isSliding) {
          baseSpeed = 5.8 * (s.settings.speedSlide / 100);
        } else {
          baseSpeed = 2.5;
        }
      } else {
        if (isSprinting) {
          baseSpeed = 5.8 * (s.settings.speedSprint / 100);
        } else {
          baseSpeed = 5.8;
        }
      }

      // Normalise movement input first so diagonals aren't faster
      let inputLength = Math.sqrt(moveForward * moveForward + moveRight * moveRight);
      if (inputLength > 0) {
        const normForward = moveForward / inputLength;
        const normRight = moveRight / inputLength;

        // Apply modifiers specific to each component
        const fMultiplier = normForward > 0 
          ? s.settings.speedForward / 100 
          : (normForward < 0 ? s.settings.speedBackward / 100 : 1.0);
        
        const sMultiplier = s.settings.speedSide / 100;

        // Analog scaling: Deflecting the virtual analog stick slightly walks slower
        const analogScale = ((deviceInfo.isMobile || forceMobileControls) && inputLength < 1.0) ? inputLength : 1.0;

        // Combine vectors with their respective multipliers
        moveDirection.addScaledVector(forwardDir, normForward * fMultiplier * baseSpeed * analogScale);
        moveDirection.addScaledVector(rightDir, normRight * sMultiplier * baseSpeed * analogScale);
      }

      // Set horizontal velocities with dynamic response friction
      s.playerVel.x = moveDirection.x;
      s.playerVel.z = moveDirection.z;
    }

    // Handle Gravity Physics if jumping
    if (s.isJumping) {
      s.playerVel.y -= GRAVITY_ACCELERATION * dt;
      s.playerPos.y += s.playerVel.y * dt;

      // Ground collision
      if (s.playerPos.y <= 0) {
        s.playerPos.y = 0;
        s.playerVel.y = 0;
        s.isJumping = false;
      }
    } else {
      s.playerPos.y = 0;
      s.playerVel.y = 0;
    }
    }

    // (Main-AI gravity / altitude / arena-constraint is now integrated in-tick by
    // updateSingleAIEntity — the same path bots use — so the former external "Handle AI
    // Gravity Physics" block was removed here as part of the vertical-physics unification.)

    // Integrate absolute positions
    if (!playerIsDead) {
      s.playerPos.x += s.playerVel.x * dt;
      s.playerPos.z += s.playerVel.z * dt;
    }

    if (!playerIsDead) {
      // Circular arena boundary restraint (Snap inside radius)
      constrainCombatantToArena(s.playerPos, s.playerVel);
    }
  };

  // HAMMER & SWORD ANIMATIONS & DAMAGE APPLICATION
  const updateHammerAnimations = (dt: number) => {
    const s = stateRef.current;
    
    // Decrement swap timers
    if (s.swapCooldownTimer > 0) {
      s.swapCooldownTimer = Math.max(0, s.swapCooldownTimer - dt);
    }
    if (mai()!.swapCooldownTimer > 0) {
      mai()!.swapCooldownTimer = Math.max(0, mai()!.swapCooldownTimer - dt);
    }
    if (s.swapLockoutTimer > 0) {
      s.swapLockoutTimer = Math.max(0, s.swapLockoutTimer - dt);
    }
    if (mai()!.swapLockoutTimer > 0) {
      mai()!.swapLockoutTimer = Math.max(0, mai()!.swapLockoutTimer - dt);
    }

    const playerHammer = threeRef.current.playerHammer;
    const playerSword = threeRef.current.playerSword;
    const camera = threeRef.current.camera;

    if (!playerHammer || !camera) return;

    if (s.isObserverMode) {
      if (playerHammer) playerHammer.visible = false;
      if (playerSword) playerSword.visible = false;
      return;
    }

    // Bobbing/Sway configurations
    const isMoving = Math.sqrt(s.playerVel.x * s.playerVel.x + s.playerVel.z * s.playerVel.z) > 0.5;
    const speedCoeff = s.isCrouching ? 0.5 : 1.0;
    const timeScale = performance.now() * 0.005 * speedCoeff;
    
    let idleXBob = 0;
    let idleYBob = 0;
    let idleZRotBob = 0;

    if (isMoving && !s.isJumping) {
      // Gentle walk sway
      idleXBob = Math.sin(timeScale * 2.5) * 0.04;
      idleYBob = Math.cos(timeScale * 5) * 0.03;
      idleZRotBob = Math.sin(timeScale * 2.5) * 0.05;
    } else {
      // Breathe idle bob
      idleYBob = Math.sin(timeScale * 1.5) * 0.008;
    }

    // 1. DYNAMIC WEAPON TARGET HOVER DETECTION (White to Red Lock-on)
    s.crosshairColor = getPlayerSwordLockTarget() ? 'red' : 'white';

    // 2. KATAR SWORD MULTI-ATTACK & GRAVITY HAMMER ANIMATION STATE MACHINE
    if (s.playerHP <= 0) {
      s.pWeaponState = 'ready';
      s.pWeaponTimer = 0;
      s.pWeaponReady = true;
      s.pSwordState = 'ready';
      s.pSwordTimer = 0;
      s.pSwordReady = true;
      s.isLunging = false;
      s.lungeTimer = 0;

      if (playerHammer) {
        playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
        playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
        playerHammer.visible = false;
      }
      if (playerSword) {
        playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
        playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
        playerSword.visible = false;
      }
    } else {
      // 2. KATAR SWORD MULTI-ATTACK ANIMATION STATE MACHINE
      if (playerSword) {
        if (s.activeWeapon === 'sword') {
          playerSword.visible = true;
          playerHammer.visible = false;
          
          if (s.isLunging) {
            // Pointed straight forward, centered
            playerSword.position.set(0.0, -0.22 + idleYBob, -0.7 + idleXBob);
            playerSword.rotation.set(Math.PI / 2 + 0.15, 0, 0);
            
            s.pSwordReady = false;
            s.pSwordCooldown = 0.5;
          } 
          else if (s.pSwordState === 'ready') {
            // Neutral stance
            playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
            playerSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
            
            if (s.swapCooldownTimer > 0) {
              s.pSwordReady = false;
              s.pSwordCooldown = s.swapCooldownDuration > 0 ? (1.0 - s.swapCooldownTimer / s.swapCooldownDuration) : 1.0;
            } else {
              s.pSwordReady = true;
              s.pSwordCooldown = 1.0;
            }
          }
          else if (s.pSwordState === 'slashing') {
            s.pSwordTimer += dt;
            const duration = s.settings.swordSlashSpeed ?? 0.22;
            const pct = Math.min(1.0, s.pSwordTimer / duration);
            
            // Sweep horizontally left to right
            playerSword.position.x = THREE.MathUtils.lerp(-0.45, 0.45, pct);
            playerSword.position.y = THREE.MathUtils.lerp(-0.35, -0.28, pct) + idleYBob;
            playerSword.position.z = THREE.MathUtils.lerp(-0.4, -0.75, pct) + (pct < 0.5 ? -0.15 : 0.15);
            
            playerSword.rotation.x = Math.PI / 2;
            playerSword.rotation.y = THREE.MathUtils.lerp(-1.2, 1.2, pct);
            playerSword.rotation.z = THREE.MathUtils.lerp(0.6, -1.5, pct);
            
            s.pSwordCooldown = 1.0 - pct * 0.4;
            
            // Apply horizontal slash swing damage trace precisely at midpoint
            if (pct >= 0.5 && (s.pSwordTimer - dt) < duration * 0.5) {
              const eyePos = new THREE.Vector3(s.playerPos.x, 1.65 - s.crouchAmount + s.playerPos.y, s.playerPos.z);
              const cameraLookDir = new THREE.Vector3(0, 0, -1)
                .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
                .normalize();

              // Check main AI bot in single player
              if (!isMultiplayer && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING' && mai()!.invulnerabilityTimer <= 0) {
                const enemyCenter = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + 0.825, mai()!.pos.z);
                const toEnemy = enemyCenter.clone().sub(eyePos);
                const dist = toEnemy.length();
                if (dist <= MELEE_SWORD_SLASH_REACH) {
                  const toEnemyDir = toEnemy.clone().normalize();
                  const dot = cameraLookDir.dot(toEnemyDir);
                  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                  
                  if (angle <= 1.0) {
                    const swordThreshold = s.settings.swordTradeWindow ?? 350;
                    const isAISwordActiveAttack = s.settings.enableSwordTrade && mai()!.activeWeapon === 'sword' && (
                      mai()!.aiState === 'LUNGING' || 
                      mai()!.weaponState === 'swing_up' || 
                      mai()!.weaponState === 'swing_down' || 
                      (Date.now() - mai()!.lastSwordAttackTime <= swordThreshold)
                    );
                    if (isAISwordActiveAttack) {
                      executeTrade('sword_vs_sword');
                      return;
                    }

                    mai()!.hp -= 1;
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(mai()!.pos, '#22d3ee');
                    s.lastStrikePos = mai()!.pos.clone();
                    s.lastStrikeTick = 1.0;
                                       if (mai()!.hp <= 0) {
                      mai()!.hp = 0;
                      mai()!.aiState = 'RESPAWNING';
                      s.enemyRespawnTimer = 3.0;
                      s.scorePlayer += 1;
                      s.playerKills += 1;
                      s.enemyDeaths += 1;
                      recordBotCalibrationDeath('main_ai');
                      sfx.playDeath();
                      mai()!.weaponState = 'ready';
                      mai()!.weaponTimer = 0;
                      
                      const medals = evaluatePlayerKillMedals('main_ai');
                      const newDeath: DeathEvent = {
                        id: Math.random().toString(36).substring(2, 9),
                        attacker: s.settings.playerName || 'Blue (You)',
                        victim: 'Red (AI)',
                        medals,
                        weapon: s.activeWeapon,
                      };
                      s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                      spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');
                    }
                  }
                }
              }
 
              // Check other players/bots
              if (s.otherPlayers) {
                s.otherPlayers.forEach((other) => {
                  if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
                    const otherCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
                    const toOther = otherCenter.clone().sub(eyePos);
                    const dist = toOther.length();

                    if (dist <= MELEE_SWORD_SLASH_REACH) {
                      const toOtherDir = toOther.clone().normalize();
                      const dot = cameraLookDir.dot(toOtherDir);
                      const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                      
                      if (angle <= 1.0) {
                        if (isMultiplayer) {
                          sfx.playSwing();
                          spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                          s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                          s.lastStrikeTick = 1.0;
                          
                          if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
                            multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id }));
                            applyOutgoingMultiplayerHitLocally(other.id, 1);
                          }
                        } else {
                          other.hp -= 1;
                          sfx.playSwing();
                          spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                          s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                          s.lastStrikeTick = 1.0;
                          
                          if (other.hp <= 0) {
                            other.hp = 0;
                            other.respawnTimer = 3.0;
                            s.scorePlayer += 1;
                            s.playerKills += 1;
                            other.deaths += 1;
                            sfx.playDeath();
                            
                            const medals = evaluatePlayerKillMedals(other.id);
                            const newDeath: DeathEvent = {
                              id: Math.random().toString(36).substring(2, 9),
                              attacker: s.settings.playerName || 'Blue (You)',
                              victim: other.playerName,
                              medals,
                              weapon: s.activeWeapon
                            };
                            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                            spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                          }
                        }
                      }
                    }
                  }
                });
              }
            }
            
            if (pct >= 1.0) {
              s.pSwordState = 'recovering';
              s.pSwordTimer = 0;
              s.pSwordRecoverDuration = s.settings.swordSlashReload ?? 0.6;
            }
          }
          else if (s.pSwordState === 'recovering') {
            s.pSwordTimer += dt;
            const recover = s.pSwordRecoverDuration ?? 0.6;
            const pct = Math.min(1.0, s.pSwordTimer / recover);
            
            playerSword.position.x = THREE.MathUtils.lerp(0.45, 0.35, pct);
            playerSword.position.y = THREE.MathUtils.lerp(-0.28, -0.38, pct) + idleYBob;
            playerSword.position.z = THREE.MathUtils.lerp(-0.75, -0.5, pct);
            
            playerSword.rotation.x = Math.PI / 2;
            playerSword.rotation.y = THREE.MathUtils.lerp(1.2, 0, pct);
            playerSword.rotation.z = THREE.MathUtils.lerp(-1.5, -Math.PI / 8, pct);
            
            s.pSwordCooldown = 0.2 + pct * 0.8;
            
            if (pct >= 1.0) {
              s.pSwordState = 'ready';
              s.pSwordReady = true;
              s.pSwordCooldown = 1.0;
            }
          }
        } else {
          playerSword.visible = false;
        }
      }

      // 3. GRAVITY HAMMER MOTION STATE MACHINE
      if (s.activeWeapon === 'hammer') {
        playerHammer.visible = true;

        if (s.pWeaponState === 'ready') {
          // Place at neutral pose
          playerHammer.position.set(0.35, -0.38 + idleYBob, -0.65 + idleXBob);
          playerHammer.rotation.set(0.15, -0.3, -0.15 + idleZRotBob);
          if (s.swapCooldownTimer > 0) {
            s.pWeaponReady = false;
            s.pWeaponCooldown = s.swapCooldownDuration > 0 ? (1.0 - s.swapCooldownTimer / s.swapCooldownDuration) : 1.0;
          } else {
            s.pWeaponReady = true;
            s.pWeaponCooldown = 1.0;
          }
        } 
        else if (s.pWeaponState === 'swing_up') {
          s.pWeaponTimer += dt;
          const windupDuration = 0.28; // 0.28 seconds windup
          const pct = Math.min(1.0, s.pWeaponTimer / windupDuration);
          
          // Pull hammer back and raise it high over head
          const targetY = -0.1;
          const targetZ = -0.4;
          const targetXRot = -1.13; // pull way back
          const targetYRot = -0.5;

          playerHammer.position.y = THREE.MathUtils.lerp(-0.38, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(-0.65, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(0.15, targetXRot, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-0.3, targetYRot, pct);

          s.pWeaponCooldown = 1.0 - (pct * 0.3); // cooldown gauge goes down during swing preparation

          if (pct >= 1.0) {
            s.pWeaponState = 'swing_down';
            s.pWeaponTimer = 0;
          }
        } 
        else if (s.pWeaponState === 'swing_down') {
          s.pWeaponTimer += dt;
          const strikeDuration = 0.12; // massive rapid 0.12s slam down
          const pct = Math.min(1.0, s.pWeaponTimer / strikeDuration);

          // Rapidly slam forward
          const startXRot = -1.13;
          const targetXRot = 0.95; // Fully smashed down
          const targetY = -0.48;
          const targetZ = -0.85; // extended slam forward

          playerHammer.position.y = THREE.MathUtils.lerp(-0.1, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(-0.4, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);

          s.pWeaponCooldown = 0.7 - (pct * 0.5);

          if (pct >= 1.0) {
            // HAMMER SLAMS THE GROUND AT PEAK DOWNWARD SWING
            s.pWeaponState = 'recovering';
            s.pWeaponTimer = 0;

            // Perform combat shockwave triggers
            applyHammerStrikeImpact(true);
          }
        } 
        else if (s.pWeaponState === 'recovering') {
          s.pWeaponTimer += dt;
          const recoveryDuration = s.settings.hammerReloadTime ?? 0.6; // recovery time back to idle poise
          const pct = Math.min(1.0, s.pWeaponTimer / recoveryDuration);

          // Return gracefully to neutral pose
          const startXRot = 0.95;
          const targetXRot = 0.15;
          const startY = -0.48;
          const targetY = -0.38;
          const startZ = -0.85;
          const targetZ = -0.65;

          playerHammer.position.y = THREE.MathUtils.lerp(startY, targetY, pct);
          playerHammer.position.z = THREE.MathUtils.lerp(startXRot === 0.95 ? startZ : playerHammer.position.z, targetZ, pct);
          playerHammer.rotation.x = THREE.MathUtils.lerp(startXRot, targetXRot, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-0.5, -0.3, pct);

          s.pWeaponCooldown = 0.2 + (pct * 0.8);

          if (pct >= 1.0) {
            s.pWeaponState = 'ready';
            s.pWeaponCooldown = 1.0;
            s.pWeaponReady = true;
          }
        }
        else if (s.pWeaponState === 'melee_swing') {
          s.pWeaponTimer += dt;
          const duration = s.settings.hammerMeleeSpeed ?? 0.24;
          const pct = Math.min(1.0, s.pWeaponTimer / duration);

          // Programmatically animate the Hammer Melee diagonal side-swipe (right-to-left)
          playerHammer.position.x = THREE.MathUtils.lerp(0.35, -0.45, pct);
          playerHammer.position.y = THREE.MathUtils.lerp(-0.38, -0.28, pct) + idleYBob;
          playerHammer.position.z = THREE.MathUtils.lerp(-0.65, -0.85, pct) + (pct < 0.5 ? -0.1 : 0.1);

          playerHammer.rotation.x = THREE.MathUtils.lerp(0.15, 0.45, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-0.3, -1.8, pct);
          playerHammer.rotation.z = THREE.MathUtils.lerp(-0.15, -0.8, pct);

          s.pWeaponCooldown = 1.0 - pct * 0.4;

          // Apply quick forward sweep damage trace precisely at midpoint
          if (pct >= 0.5 && (s.pWeaponTimer - dt) < duration * 0.5) {
            applyPlayerHammerMeleeImpact();
          }

          if (pct >= 1.0) {
            s.pWeaponState = 'melee_recover';
            s.pWeaponTimer = 0;
          }
        }
        else if (s.pWeaponState === 'melee_recover') {
          s.pWeaponTimer += dt;
          const recoveryDuration = s.settings.hammerMeleeReload ?? 0.5;
          const pct = Math.min(1.0, s.pWeaponTimer / recoveryDuration);

          // Return gracefully to neutral pose
          playerHammer.position.x = THREE.MathUtils.lerp(-0.45, 0.35, pct);
          playerHammer.position.y = THREE.MathUtils.lerp(-0.28, -0.38, pct) + idleYBob;
          playerHammer.position.z = THREE.MathUtils.lerp(-0.85, -0.65, pct);

          playerHammer.rotation.x = THREE.MathUtils.lerp(0.45, 0.15, pct);
          playerHammer.rotation.y = THREE.MathUtils.lerp(-1.8, -0.3, pct);
          playerHammer.rotation.z = THREE.MathUtils.lerp(-0.8, -0.15, pct);

          s.pWeaponCooldown = 0.6 + pct * 0.4;

          if (pct >= 1.0) {
            s.pWeaponState = 'ready';
            s.pWeaponCooldown = 1.0;
            s.pWeaponReady = true;
          }
        }
      } else {
        playerHammer.visible = false;
      }

      // 4. SECRET PISTOL MOTION STATE MACHINE
      const playerPistol = threeRef.current.playerPistol;
      if (playerPistol) {
        if (s.activeWeapon === 'pistol') {
          playerPistol.visible = true;
          if (playerHammer) playerHammer.visible = false;
          if (playerSword) playerSword.visible = false;

          if (s.pPistolState === 'ready') {
            playerPistol.position.set(0.25, -0.28 + idleYBob, -0.4 + idleXBob);
            playerPistol.rotation.set(0, 0, idleZRotBob);
            s.pPistolReady = true;
            s.pPistolCooldown = 1.0;
          }
          else if (s.pPistolState === 'firing') {
            s.pPistolTimer += dt;
            const fireDuration = 0.08;
            const pct = Math.min(1.0, s.pPistolTimer / fireDuration);
            playerPistol.position.x = 0.25;
            playerPistol.position.y = THREE.MathUtils.lerp(-0.28, -0.22, pct) + idleYBob;
            playerPistol.position.z = THREE.MathUtils.lerp(-0.4, -0.3, pct) + idleXBob;
            playerPistol.rotation.x = THREE.MathUtils.lerp(0, -0.4, pct);
            playerPistol.rotation.y = 0;
            playerPistol.rotation.z = idleZRotBob;

            s.pPistolCooldown = 1.0 - (pct * 0.4);

            if (pct >= 1.0) {
              s.pPistolState = 'recovering';
              s.pPistolTimer = 0;
            }
          }
          else if (s.pPistolState === 'recovering') {
            s.pPistolTimer += dt;
            const recoverDuration = 0.15;
            const pct = Math.min(1.0, s.pPistolTimer / recoverDuration);
            playerPistol.position.x = 0.25;
            playerPistol.position.y = THREE.MathUtils.lerp(-0.22, -0.28, pct) + idleYBob;
            playerPistol.position.z = THREE.MathUtils.lerp(-0.3, -0.4, pct) + idleXBob;
            playerPistol.rotation.x = THREE.MathUtils.lerp(-0.4, 0, pct);
            playerPistol.rotation.y = 0;
            playerPistol.rotation.z = idleZRotBob;

            s.pPistolCooldown = pct;

            if (pct >= 1.0) {
              s.pPistolState = 'ready';
              s.pPistolCooldown = 1.0;
              s.pPistolReady = true;
            }
          }
        } else {
          playerPistol.visible = false;
        }
      }
    }

    // ENEMY AI WEAPON ANIMATION AND VISIBILITY (main_ai via unified mesh rig)
    const mainAiWeapons = getCombatantWeaponMeshes('main_ai');
    const enemyHammerModel = mainAiWeapons?.hammer;
    const enemySwordModel = mainAiWeapons?.sword;

    if (!s.isMultiplayer && enemyHammerModel && enemySwordModel) {
      enemyHammerModel.visible = mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING' && mai()!.activeWeapon === 'hammer';
      enemySwordModel.visible = mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING' && mai()!.activeWeapon === 'sword';

      if (mai()!.hp <= 0 || mai()!.aiState === 'RESPAWNING') {
        mai()!.weaponState = 'ready';
        mai()!.weaponTimer = 0;
        enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
        enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
        enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      } else if (mai()!.activeWeapon === 'hammer') {
        if (mai()!.weaponState === 'ready') {
          enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
          enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        } 
        else if (mai()!.weaponState === 'swing_up') {
          mai()!.weaponTimer += dt;
          const windup = 0.28; // player-parity hammer overhead windup (see pWeaponState swing_up)
          const pct = Math.min(1.0, mai()!.weaponTimer / windup);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.4, pct),
            THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64, // high over head
            THREE.MathUtils.lerp(-0.48, -0.15, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(0.2, -1.3, pct); // swing back

          if (pct >= 1.0) {
            mai()!.weaponState = 'swing_down';
            mai()!.weaponTimer = 0;
          }
        } 
        else if (mai()!.weaponState === 'swing_down') {
          mai()!.weaponTimer += dt;
          const strike = 0.12; // player-parity hammer overhead strike (see pWeaponState swing_down)
          const pct = Math.min(1.0, mai()!.weaponTimer / strike);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.4, 0.2, pct),
            THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64, // smash hard down
            THREE.MathUtils.lerp(-0.15, -0.9, pct) // reach forward
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(-1.3, 1.1, pct);

          if (pct >= 1.0) {
            mai()!.weaponState = 'recovering';
            mai()!.weaponTimer = 0;

            // Perform Enemy damage check
            applyHammerStrikeImpact(false);
          }
        } 
        else if (mai()!.weaponState === 'recovering') {
          mai()!.weaponTimer += dt;
          const recover = s.settings.hammerReloadTime ?? 0.6;
          const pct = Math.min(1.0, mai()!.weaponTimer / recover);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.9, -0.48, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(1.1, 0.2, pct);

          if (pct >= 1.0) {
            mai()!.weaponState = 'ready';
            mai()!.weaponTimer = 0;
          }
        }
        else if (mai()!.weaponState === 'melee_up') {
          mai()!.weaponTimer += dt;
          const windup = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.4 : 0.1;
          const pct = Math.min(1.0, mai()!.weaponTimer / windup);

          // Diagonal sweep windup: pull right and back slightly low
          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.58, pct),
            THREE.MathUtils.lerp(1.08, 0.90, pct) - 0.64,
            THREE.MathUtils.lerp(-0.48, -0.3, pct)
          );
          enemyHammerModel.rotation.set(
            THREE.MathUtils.lerp(0.2, 0.35, pct),
            THREE.MathUtils.lerp(0.1, 0.4, pct),
            THREE.MathUtils.lerp(-0.15, -0.25, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'melee_down';
            mai()!.weaponTimer = 0;
          }
        }
        else if (mai()!.weaponState === 'melee_down') {
          mai()!.weaponTimer += dt;
          const strike = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.6 : 0.14;
          const pct = Math.min(1.0, mai()!.weaponTimer / strike);

          // Diagonal sweep strike: slash across diagonally up and left
          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.58, 0.18, pct),
            THREE.MathUtils.lerp(0.90, 1.20, pct) - 0.64,
            THREE.MathUtils.lerp(-0.3, -0.8, pct)
          );
          enemyHammerModel.rotation.set(
            THREE.MathUtils.lerp(0.35, 0.55, pct),
            THREE.MathUtils.lerp(0.4, -0.8, pct),
            THREE.MathUtils.lerp(-0.25, -0.5, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'melee_recover';
            mai()!.weaponTimer = 0;

            // Perform Enemy Hammer Melee hit check
            applyEnemyHammerMeleeImpact();
          }
        }
        else if (mai()!.weaponState === 'melee_recover') {
          mai()!.weaponTimer += dt;
          const recover = s.settings.hammerMeleeReload ?? 0.5;
          const pct = Math.min(1.0, mai()!.weaponTimer / recover);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.18, 0.48, pct),
            THREE.MathUtils.lerp(1.20, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.8, -0.48, pct)
          );
          enemyHammerModel.rotation.set(
            THREE.MathUtils.lerp(0.55, 0.2, pct),
            THREE.MathUtils.lerp(-0.8, 0.1, pct),
            THREE.MathUtils.lerp(-0.5, -0.15, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'ready';
            mai()!.weaponTimer = 0;
          }
        }
      } else if (mai()!.activeWeapon === 'sword') {
        // ENEMY KATAR SWORD WALK / STRIKE ANIMATION
        if (mai()!.aiState === 'LUNGING') {
          // Lunge forward poise: points straight forward, aligned centered
          enemySwordModel.position.set(0.0, 1.2 - 0.64, -0.75);
          enemySwordModel.rotation.set(Math.PI / 2 + 0.15, 0, 0);
        } else if (mai()!.weaponState === 'ready') {
          enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
          enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        } 
        else if (mai()!.weaponState === 'swing_up') {
          mai()!.weaponTimer += dt;
          // Split 0.5/0.5 so the hit lands at mid-swing, exactly like the player's slash.
          const windup = (s.settings.swordSlashSpeed ?? 0.22) * 0.5;
          const pct = Math.min(1.0, mai()!.weaponTimer / windup);

          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.62, pct),
            THREE.MathUtils.lerp(1.08, 1.2, pct) - 0.64,
            THREE.MathUtils.lerp(-0.32, -0.15, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(0, 0.6, pct),
            THREE.MathUtils.lerp(-Math.PI / 8, Math.PI / 4, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'swing_down';
            mai()!.weaponTimer = 0;
            // Damage lands at mid-swing (0.5 * swordSlashSpeed), matching the player's slash.
            applyEnemySwordSlashImpact();
          }
        }
        else if (mai()!.weaponState === 'swing_down') {
          mai()!.weaponTimer += dt;
          const strike = (s.settings.swordSlashSpeed ?? 0.22) * 0.5;
          const pct = Math.min(1.0, mai()!.weaponTimer / strike);

          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.62, 0.2, pct),
            THREE.MathUtils.lerp(1.2, 0.9, pct) - 0.64,
            THREE.MathUtils.lerp(-0.15, -0.75, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(0.6, -0.8, pct),
            THREE.MathUtils.lerp(Math.PI / 4, -Math.PI / 3, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'recovering';
            mai()!.weaponTimer = 0;
            // Damage already applied at mid-swing (end of swing_up); swing_down is follow-through.
          }
        }
        else if (mai()!.weaponState === 'recovering') {
          mai()!.weaponTimer += dt;
          const recover = s.settings.swordSlashReload ?? 0.6;
          const pct = Math.min(1.0, mai()!.weaponTimer / recover);

          enemySwordModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.9, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.75, -0.32, pct)
          );
          enemySwordModel.rotation.set(
            Math.PI / 2,
            THREE.MathUtils.lerp(-0.8, 0, pct),
            THREE.MathUtils.lerp(-Math.PI / 3, -Math.PI / 8, pct)
          );

          if (pct >= 1.0) {
            mai()!.weaponState = 'ready';
            mai()!.weaponTimer = 0;
          }
        }
      }
    }
  };

  // COMBAT IMPACT: Spawns particle blast, plays heavy explosion audio, and inflicts damage in custom sphere check
  const applyHammerStrikeImpact = (isPlayerStriking: boolean) => {
    const s = stateRef.current;
    
    // Play colossal explosion thump & sparks sound
    sfx.playExplosion();

    if (isPlayerStriking) {
      if (s.playerHP <= 0) return; // Prevent dead players' attacks from executing
      // 1. Calculate impact center point at the 3D location of the cursor (using yaw and pitch from eye height)
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      
      const lookHeading = new THREE.Vector3(0, 0, -1)
        .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
        .normalize();
      
      const impactPos = eyePos.clone().addScaledVector(lookHeading, s.settings.attackRange);

      s.lastStrikePos = impactPos;
      s.lastStrikeTick = 1.5; // linger visual debugger for 1.5s

      // Check for Hammer Jump eligibility (ground distance check within settings.hammerJumpTriggerRadius)
      if (s.activeWeapon === 'hammer') {
        const distToBase = impactPos.distanceTo(s.playerPos);
        if (distToBase <= (s.settings.hammerJumpTriggerRadius ?? 3.5)) {
          s.pHammerJumpWindowTimer = s.settings.hammerJumpWindow ?? 0.6;
        }
      }

      const impactRadius = s.settings.attackRadius ?? 4.5;
      renderHammerSplashVfx(impactPos, '#38bdf8', impactRadius);

      if (s.isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
        multiplayerSocket.send(JSON.stringify({
          type: 'sync',
          action: 'hammer_impact',
          pos: { x: impactPos.x, y: impactPos.y, z: impactPos.z },
          radius: impactRadius
        }));
      }

      // 2. Damage Application Check: Check main AI bot in singleplayer
      if (!isMultiplayer && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING' && mai()!.invulnerabilityTimer <= 0) {
        const enemyBodyCenter = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + 0.825, mai()!.pos.z);
        const dist = impactPos.distanceTo(enemyBodyCenter);
        
        if (dist <= s.settings.attackRadius) {
          mai()!.hp -= 1;
          sfx.playSwing();
          spawnVoxelShockwaveParticles(mai()!.pos, '#22d3ee');
          s.lastStrikePos = mai()!.pos.clone();
          s.lastStrikeTick = 1.0;
          
          if (mai()!.hp <= 0) {
            mai()!.hp = 0;
            mai()!.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            s.scorePlayer += 1;
            s.playerKills += 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();
            mai()!.weaponState = 'ready';
            mai()!.weaponTimer = 0;
            
            const medals = evaluatePlayerKillMedals('main_ai');
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: 'Red (AI)',
              medals,
              weapon: s.activeWeapon,
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');
          }
        }
      }

      // Check other players/bots in room
      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
            const otherBodyCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
            const dist = impactPos.distanceTo(otherBodyCenter);
            
            if (dist <= s.settings.attackRadius) {
              if (isMultiplayer) {
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
                s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                s.lastStrikeTick = 1.0;
                
                if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
                  multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id }));
                  applyOutgoingMultiplayerHitLocally(other.id, 1);
                }
              } else {
                other.hp -= 1;
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#22d3ee');
                s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                s.lastStrikeTick = 1.0;
                
                if (other.hp <= 0) {
                  other.hp = 0;
                  other.respawnTimer = 3.0;
                  s.scorePlayer += 1;
                  s.playerKills += 1;
                  other.deaths += 1;
                  sfx.playDeath();
                  
                  const medals = evaluatePlayerKillMedals(other.id);
                  const newDeath: DeathEvent = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: s.settings.playerName || 'Blue (You)',
                    victim: other.playerName,
                    medals,
                    weapon: s.activeWeapon,
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                  spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                }
              }
            }
          }
        });
      }
    } else {
      if (isMultiplayer) return; // In multiplayer, we do not run AI strike simulations!
      if (mai()!.hp <= 0 || mai()!.aiState === 'RESPAWNING') return; // Prevent dead enemies' attacks from executing
      // ENEMY AI IS STRIKING
      // The AI tracks the resolved target in 3D, OR aims beneath itself for a hammer jump!
      const target = getEnemyAITarget();
      if (!target) return;

      const aiEyePos = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + 1.2, mai()!.pos.z);
      const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
      
      let aiHeading3D: THREE.Vector3;
      if (mai()!.hammerJumpPlanned) {
        aiHeading3D = new THREE.Vector3(0, -1, 0);
      } else {
        aiHeading3D = targetBodyCenter.clone().sub(aiEyePos).normalize();
      }
      
      const impactPos = aiEyePos.clone().addScaledVector(aiHeading3D, s.settings.attackRange * 0.875);

      s.lastAIStrikePos = impactPos;
      s.lastAIStrikeTick = 1.5;

      // Check for Hammer Jump eligibility for AI (distance check)
      const distToBase = impactPos.distanceTo(mai()!.pos);
      if (distToBase <= (s.settings.hammerJumpTriggerRadius ?? 3.5)) {
        mai()!.hammerJumpWindowTimer = s.settings.hammerJumpWindow ?? 0.6;
        if (mai()!.hammerJumpPlanned) {
          mai()!.isJumping = true;
          mai()!.vel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
          sfx.playJump();
          spawnVoxelShockwaveParticles(mai()!.pos, '#f59e0b');
        }
      }
      mai()!.hammerJumpPlanned = false;
      mai()!.hammerJumpType = undefined;

      renderHammerSplashVfx(impactPos, '#f97316', s.settings.attackRadius ?? 4.5);

      // Damage target check: Compare strike sphere coordinate with target's 3D body center
      if (target.hp > 0 && target.invuln <= 0) {
        const dist = impactPos.distanceTo(targetBodyCenter);

        if (dist <= s.settings.attackRadius) {
          if (target.id === 'player') {
            // Reduce player health
            recordPlayerDamageTaken();
            tryRecordCalibrationCounterSuccess('main_ai');
            s.playerHP -= 1;
            if (s.playerHP <= 0) {
              s.playerHP = 0;
              s.playerRespawnTimer = 3.0;
              s.scoreEnemy += 1;
              s.playerDeaths += 1;
              s.enemyKills += 1;
              sfx.playDeath();
              s.pWeaponState = 'ready';
              s.pWeaponTimer = 0;
              s.pWeaponReady = true;
              s.pSwordState = 'ready';
              s.pSwordTimer = 0;
              s.pSwordReady = true;
              s.isLunging = false;
              s.lungeTimer = 0;

              // Record death event (last 3 entries)
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: 'Red (AI)',
                victim: 'Blue (You)',
                weapon: mai()!.activeWeapon,
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);

              // Spawn death particles on player
              spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
              recordBotPsychKill('main_ai', 'player', false);
            } else {
              // Non-lethal player hit
              sfx.playSwing();
              spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
              recordBotDamageTag('main_ai', 'player');
              tryEnterPressureState('main_ai', 'player', s.playerHP, s.playerInvulnerabilityTimer);
              tryStartComboOnHit('main_ai', 'player', mai()!.activeWeapon);
            }
          } else {
            // Target is another bot!
            const other = s.otherPlayers?.get(target.id);
            if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
              other.hp -= 1;
              if (other.hp <= 0) {
                other.hp = 0;
                other.respawnTimer = 3.0;
                s.scoreEnemy += 1;
                s.enemyKills += 1;
                other.deaths = (other.deaths || 0) + 1;
                sfx.playDeath();

                const newDeath: DeathEvent = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: 'Red (AI)',
                  victim: other.playerName,
                  weapon: mai()!.activeWeapon,
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                recordBotPsychKill('main_ai', target.id, false);
              } else {
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
                recordBotDamageTag('main_ai', target.id);
                tryEnterPressureState('main_ai', target.id, other.hp, other.invulnerabilityTimer || 0);
                tryStartComboOnHit('main_ai', target.id, mai()!.activeWeapon);
              }
              pushStatsUpdate();
            }
          }
        }
      }
    }
  };

  const applyEnemySwordSlashImpact = () => {
    const s = stateRef.current;
    if (mai()!.hp <= 0 || mai()!.aiState === 'RESPAWNING') return;
    
    const target = getEnemyAITarget();
    if (!target) return;

    // Reach is measured eye -> target body-center, identical to the player's stationary
    // slash (see triggerPlayerSwordSlash impact). The forward point below is VFX-only and
    // must NOT extend the hit range, or the AI would out-reach the player.
    const aiEyePos = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + MELEE_EYE_HEIGHT, mai()!.pos.z);
    const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
    const lookHeading = targetBodyCenter.clone().sub(aiEyePos).normalize();
    const vfxPos = aiEyePos.clone().addScaledVector(lookHeading, 1.0);

    s.lastAIStrikePos = vfxPos;
    s.lastAIStrikeTick = 1.0;

    sfx.playSwing();
    spawnVoxelShockwaveParticles(vfxPos, '#ef4444');

    if (isMultiplayer) return; // In multiplayer, we do not run AI damage checks against local player!

    if (target.hp > 0 && target.invuln <= 0) {
      const dist = aiEyePos.distanceTo(targetBodyCenter);

      if (dist <= MELEE_SWORD_SLASH_REACH) {
        // Evaluate trades FIRST
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        const isPlayerSwordActiveAttack = s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
          s.isLunging ||
          s.pSwordState === 'slashing' ||
          (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
        );

        if (target.id === 'player' && isPlayerSwordActiveAttack) {
          executeTrade('sword_vs_sword');
          return;
        }

        // Red team AI hits the target!
        if (target.id === 'player') {
          recordPlayerDamageTaken();
          tryRecordCalibrationCounterSuccess('main_ai');
          s.playerHP -= 1;
          if (s.playerHP <= 0) {
            s.playerHP = 0;
            s.playerRespawnTimer = 3.0;
            s.scoreEnemy += 1;
            s.playerDeaths += 1;
            s.enemyKills += 1;
            sfx.playDeath();
            s.pWeaponState = 'ready';
            s.pWeaponTimer = 0;
            s.pWeaponReady = true;
            s.pSwordState = 'ready';
            s.pSwordTimer = 0;
            s.pSwordReady = true;
            s.isLunging = false;
            s.lungeTimer = 0;
            
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: 'Red (AI) [Slash]',
              victim: 'Blue (You)',
              weapon: 'sword',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
            recordBotPsychKill('main_ai', 'player', false);
          } else {
            sfx.playSwing();
            spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
            recordBotDamageTag('main_ai', 'player');
            tryEnterPressureState('main_ai', 'player', s.playerHP, s.playerInvulnerabilityTimer);
            tryStartComboOnHit('main_ai', 'player', 'sword', { targetRecovering: true });
          }
        } else {
          // Target is another bot!
          const other = s.otherPlayers?.get(target.id);
          if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
            other.hp -= 1;
            if (other.hp <= 0) {
              other.hp = 0;
              other.respawnTimer = 3.0;
              s.scoreEnemy += 1;
              s.enemyKills += 1;
              other.deaths = (other.deaths || 0) + 1;
              sfx.playDeath();
              
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: 'Red (AI) [Slash]',
                victim: other.playerName,
                weapon: 'sword',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
              recordBotPsychKill('main_ai', target.id, false);
            } else {
              sfx.playSwing();
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
              recordBotDamageTag('main_ai', target.id);
              tryEnterPressureState('main_ai', target.id, other.hp, other.invulnerabilityTimer || 0);
              tryStartComboOnHit('main_ai', target.id, 'sword', { targetRecovering: true });
            }
            pushStatsUpdate();
          }
        }
      }
    }
  };

  const applyPlayerHammerMeleeImpact = () => {
    const s = stateRef.current;
    if (s.playerHP <= 0) return;

    const eyePos = new THREE.Vector3(s.playerPos.x, 1.65 - s.crouchAmount + s.playerPos.y, s.playerPos.z);
    const cameraLookDir = new THREE.Vector3(0, 0, -1)
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), s.pitch)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw)
      .normalize();

    // Check main AI bot in single player
    if (!isMultiplayer && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING' && mai()!.invulnerabilityTimer <= 0) {
      const enemyCenter = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + 0.825, mai()!.pos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();
      if (dist <= MELEE_HAMMER_SWIPE_REACH) {
        const toEnemyDir = toEnemy.clone().normalize();
        const dot = cameraLookDir.dot(toEnemyDir);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

        if (angle <= 1.0) {
          mai()!.hp -= 1;
          sfx.playSwing();
          spawnVoxelShockwaveParticles(mai()!.pos, '#38bdf8');
          s.lastStrikePos = mai()!.pos.clone();
          s.lastStrikeTick = 1.0;

          if (mai()!.hp <= 0) {
            mai()!.hp = 0;
            mai()!.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            s.scorePlayer += 1;
            s.playerKills += 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();
            mai()!.weaponState = 'ready';
            mai()!.weaponTimer = 0;

            const medals = evaluatePlayerKillMedals('main_ai');
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: 'Red (AI)',
              medals,
              weapon: 'hammer',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');
          }
        }
      }
    }

    // Check other players/bots in multiplayer/FFA
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other) => {
        if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
          const otherBodyCenter = new THREE.Vector3(other.pos.x, other.pos.y + 0.825, other.pos.z);
          const toOther = otherBodyCenter.clone().sub(eyePos);
          const dist = toOther.length();
          if (dist <= MELEE_HAMMER_SWIPE_REACH) {
            const toOtherDir = toOther.clone().normalize();
            const dot = cameraLookDir.dot(toOtherDir);
            const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

            if (angle <= 1.0) {
              sfx.playSwing();
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#38bdf8');
              s.lastStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
              s.lastStrikeTick = 1.0;

              if (isMultiplayer) {
                if (multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
                  multiplayerSocket.send(JSON.stringify({ type: 'sync', action: 'hit_taken', damage: 1, targetId: other.id }));
                }
              } else {
                // local other bots FFA
                other.hp -= 1;
                if (other.hp <= 0) {
                  other.hp = 0;
                  other.respawnTimer = 3.0;
                  s.scorePlayer += 1;
                  s.playerKills += 1;
                  other.deaths = (other.deaths || 0) + 1;
                  sfx.playDeath();

                  const medals = evaluatePlayerKillMedals(other.id);
                  const newDeath: DeathEvent = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: s.settings.playerName || 'Blue (You)',
                    victim: other.playerName,
                    medals,
                    weapon: 'hammer',
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                  spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                }
              }
            }
          }
        }
      });
    }
  };

  const applyEnemyHammerMeleeImpact = () => {
    const s = stateRef.current;
    if (mai()!.hp <= 0 || mai()!.aiState === 'RESPAWNING') return;

    const target = getEnemyAITarget();
    if (!target) return;

    // Reach is measured eye -> target body-center, identical to the player's hammer
    // side-swipe (see applyPlayerHammerMeleeImpact). The forward point is VFX-only.
    const aiEyePos = new THREE.Vector3(mai()!.pos.x, mai()!.pos.y + MELEE_EYE_HEIGHT, mai()!.pos.z);
    const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
    const lookHeading = targetBodyCenter.clone().sub(aiEyePos).normalize();
    const vfxPos = aiEyePos.clone().addScaledVector(lookHeading, 1.0);

    s.lastAIStrikePos = vfxPos;
    s.lastAIStrikeTick = 1.0;

    sfx.playSwing();
    spawnVoxelShockwaveParticles(vfxPos, '#38bdf8');

    if (isMultiplayer) return;

    if (target.hp > 0 && target.invuln <= 0) {
      const dist = aiEyePos.distanceTo(targetBodyCenter);

      if (dist <= MELEE_HAMMER_SWIPE_REACH) {
        if (target.id === 'player') {
          recordPlayerDamageTaken();
          tryRecordCalibrationCounterSuccess('main_ai');
          s.playerHP -= 1;
          if (s.playerHP <= 0) {
            s.playerHP = 0;
            s.playerRespawnTimer = 3.0;
            s.scoreEnemy += 1;
            s.playerDeaths += 1;
            s.enemyKills += 1;
            sfx.playDeath();
            s.pWeaponState = 'ready';
            s.pWeaponTimer = 0;
            s.pWeaponReady = true;
            s.pSwordState = 'ready';
            s.pSwordTimer = 0;
            s.pSwordReady = true;
            s.isLunging = false;
            s.lungeTimer = 0;

            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: 'Red (AI) [Melee]',
              victim: 'Blue (You)',
              weapon: 'hammer',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
            recordBotPsychKill('main_ai', 'player', false);
          } else {
            sfx.playSwing();
            spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
            recordBotDamageTag('main_ai', 'player');
            tryEnterPressureState('main_ai', 'player', s.playerHP, s.playerInvulnerabilityTimer);
            tryStartComboOnHit('main_ai', 'player', 'hammer', { targetRecovering: true });
          }
        } else {
          // Target is another bot!
          const other = s.otherPlayers?.get(target.id);
          if (other && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0)) {
            other.hp -= 1;
            if (other.hp <= 0) {
              other.hp = 0;
              other.respawnTimer = 3.0;
              s.scoreEnemy += 1;
              s.enemyKills += 1;
              other.deaths = (other.deaths || 0) + 1;
              sfx.playDeath();

              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: 'Red (AI) [Melee]',
                victim: other.playerName,
                weapon: 'hammer',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
              recordBotPsychKill('main_ai', target.id, false);
            } else {
              sfx.playSwing();
              spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
              recordBotDamageTag('main_ai', target.id);
              tryEnterPressureState('main_ai', target.id, other.hp, other.invulnerabilityTimer || 0);
              tryStartComboOnHit('main_ai', target.id, 'hammer', { targetRecovering: true });
            }
            pushStatsUpdate();
          }
        }
      }
    }
  };

  // TACTICAL COMBAT COOLDOWN ENGINE
  const isTargetOnCooldown = (target: Pick<TacticalTargetCandidate, 'id'>) => {
    const s = stateRef.current;
    if (target.id === 'player') {
      if (s.activeWeapon === 'hammer') {
        return s.pWeaponState === 'recovering' || s.pWeaponState === 'swing_up' || s.pWeaponState === 'swing_down';
      } else {
        return s.pSwordState === 'recovering' || s.pSwordState === 'slashing' || s.isLunging;
      }
    } else if (target.id === 'main_ai') {
      return mai()!.weaponState === 'recovering' || mai()!.weaponState === 'swing_up' || mai()!.weaponState === 'swing_down' || mai()!.aiState === 'LUNGING' || (mai()!.aiState === 'COOLDOWN' && mai()!.aiTimer > 0);
    } else {
      const other = s.otherPlayers.get(target.id);
      if (other) {
        return other.weaponState === 'recovering' || other.weaponState === 'swing_up' || other.weaponState === 'swing_down' || other.isLunging || (other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0);
      }
    }
    return false;
  };

  // ADVANCED TACTICAL TARGET SELECTION SCORING
  const buildPotentialTargets = (botId: string): TacticalTargetCandidate[] => {
    const s = stateRef.current;
    const potentialTargets: TacticalTargetCandidate[] = [];

    if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
      potentialTargets.push({
        id: 'player',
        pos: s.playerPos,
        hp: s.playerHP,
        maxHp: s.playerMaxHP,
        invulnerabilityTimer: s.playerInvulnerabilityTimer,
        activeWeapon: s.activeWeapon,
        weaponState: s.activeWeapon === 'hammer' ? s.pWeaponState : s.pSwordState,
        isLunging: s.isLunging,
        dashCooldownRemaining: s.playerDashCooldownTimer,
        swapLockoutRemaining: s.swapLockoutTimer,
        vel: s.playerVel,
        isCrouching: s.isCrouching,
        playerName: s.settings.playerName || 'Blue (You)'
      });
    }

    // Every AI combatant is sourced uniformly from getRosterAI.
    getRosterAI().forEach((other) => {
      if (other.id !== botId && other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
        potentialTargets.push({
          id: other.id,
          pos: new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z),
          hp: other.hp,
          maxHp: other.maxHp,
          invulnerabilityTimer: other.invulnerabilityTimer || 0,
          activeWeapon: other.activeWeapon,
          weaponState: other.aiState === 'COOLDOWN' && (other.aiTimer || 0) > 0 ? 'recovering' : (other.weaponState || 'ready'),
          isLunging: other.isLunging || other.weaponState === 'swing_up' || other.weaponState === 'swing_down',
          dashCooldownRemaining: other.aiDashCooldownTimer || 0,
          swapLockoutRemaining: other.swapLockoutTimer || 0,
          vel: new THREE.Vector3(other.vel.x, other.vel.y, other.vel.z),
          isCrouching: other.isCrouching || false,
          playerName: other.playerName
        });
      }
    });

    return potentialTargets;
  };

  const getTacticalTargetById = (botId: string, targetId: string): TacticalTargetCandidate | null => {
    return buildPotentialTargets(botId).find((candidate) => candidate.id === targetId) ?? null;
  };

  const getBestTacticalTarget = (botId: string, botPos: THREE.Vector3, difficulty: string) => {
    const s = stateRef.current;
    const playstyleVal = resolveBotKnobs(botId).aiPlaystyle;
    const playstyleFactor = playstyleVal / 100;
    const recoveringTargetBonus = (1.0 - Math.abs(playstyleFactor - 0.5) * 2.0) * 200.0;
    const targetSelectionSpatialIQ = resolveBotDerived(botId).spatialIQ;

    let bestTarget: TacticalTargetCandidate | null = null;
    let bestScore = -Infinity;

    const potentialTargets = buildPotentialTargets(botId);

    potentialTargets.forEach((target) => {
      const dist = botPos.distanceTo(target.pos);
      let score = 1000;

      if (difficulty === 'easy') {
        score -= dist * 20;
        if (target.invulnerabilityTimer > 0) {
          score -= 300;
        }
      } 
      else if (difficulty === 'normal') {
        score -= dist * 15;
        score += (target.maxHp - target.hp) * 50;
        if (target.invulnerabilityTimer > 0) {
          score -= 2000;
        }
        if (target.weaponState === 'recovering') {
          score += 150 + Math.max(0, recoveringTargetBonus);
        }
      } 
      else {
        score -= dist * 10;
        score += (target.maxHp - target.hp) * 150;

        if (target.invulnerabilityTimer > 0) {
          score -= 99999;
        }

        if (target.weaponState === 'recovering') {
          score += 350 + Math.max(0, recoveringTargetBonus); 
        } else if (target.weaponState === 'swing_up' || target.weaponState === 'swing_down') {
          score += 100;
        }

        const myActiveWeapon = botId === 'main_ai' ? mai()!.activeWeapon : s.otherPlayers.get(botId)?.activeWeapon;
        if (myActiveWeapon === 'sword') {
          if (target.activeWeapon === 'hammer') {
            score += 100; 
          }
        }

        let nearbyEnemiesCount = 0;
        potentialTargets.forEach((otherT) => {
          if (otherT.id !== target.id) {
            if (target.pos.distanceTo(otherT.pos) < 6.0) {
              nearbyEnemiesCount++;
            }
          }
        });

        if (myActiveWeapon === 'hammer') {
          score += nearbyEnemiesCount * 80;
        } else {
          score -= nearbyEnemiesCount * 120;
        }

        score += getTargetEdgeSelectionBonus({
          botX: botPos.x,
          botZ: botPos.z,
          targetX: target.pos.x,
          targetZ: target.pos.z,
          arenaRadius: s.arenaRadius,
          spatialIQ: targetSelectionSpatialIQ,
        });

        score += getCoordinatedTargetBonus({
          coordinator: s.aiMatchContext.coordinator,
          botId,
          targetId: target.id,
          difficulty,
        });
      }

      if (score > bestScore) {
        bestScore = score;
        bestTarget = target;
      }
    });

    return bestTarget;
  };

  // DYNAMIC WEAPON SWAPPING ENGINE
  const evaluateTacticalWeaponChoice = (
    botId: string,
    target: TacticalTargetCandidate,
    difficulty: string,
    context: {
      distanceToTarget?: number;
      combatDistanceToTarget?: number;
      canStartWeaponAction?: boolean;
      weaponState?: string;
      weaponSwapIQ?: number;
      recentLungeMemory?: { outcome: AILungeOutcome; targetId?: string; timeRemaining: number } | null;
      weaponPrioritization?: number;
      playerModel?: PlayerModelSnapshot | null;
    } = {}
  ) => {
    const s = stateRef.current;
    const baseAggression = resolveBotDerived(botId).pressureAggression;
    const matchMultipliers = deriveMatchStateMultipliers(getMatchScoreContext(), baseAggression / 100);
    
    if (difficulty === 'easy') {
      return evaluateAICombatDecision({
        difficulty,
        weaponSwapIQ: context.weaponSwapIQ ?? s.settings.aiWeaponSwapIQ ?? 50,
        currentWeapon: 'hammer',
        botHP: 1,
        botMaxHP: 1,
        distanceToTarget: Infinity,
        nearbyEnemiesCount: 0,
        target,
        attackRange: s.settings.attackRange,
        attackRadius: s.settings.attackRadius,
        swordLungeDistance: s.settings.swordLungeDistance ?? 14.5,
        swordLungeSpeed: s.settings.swordLungeSpeed ?? 24.0,
        swordTradeWindowMs: s.settings.swordTradeWindow ?? 350,
        canStartWeaponAction: false,
        weaponState: 'ready',
        weaponPrioritization: context.weaponPrioritization ?? 50,
        playerModel: context.playerModel,
        matchMultipliers,
      });
    }

    const botState = botId === 'main_ai' ? null : s.otherPlayers.get(botId);
    const currentWeapon = botId === 'main_ai' ? mai()!.activeWeapon : botState?.activeWeapon;
    const botHP = botId === 'main_ai' ? mai()!.hp : botState?.hp || 1;
    const botMaxHP = botId === 'main_ai' ? mai()!.maxHp : botState?.maxHp || 1;
    const botPos = botId === 'main_ai' ? mai()!.pos : (botState ? new THREE.Vector3(botState.pos.x, botState.pos.y, botState.pos.z) : new THREE.Vector3());

    const dist = context.distanceToTarget ?? botPos.distanceTo(target.pos);

    let nearbyEnemiesCount = 0;
    if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && botId !== 'player') {
      if (botPos.distanceTo(s.playerPos) < 6.0) nearbyEnemiesCount++;
    }
    if (botId !== 'main_ai' && mai()!.hp > 0 && mai()!.aiState !== 'RESPAWNING') {
      if (botPos.distanceTo(mai()!.pos) < 6.0) nearbyEnemiesCount++;
    }
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other) => {
        if (other.id !== botId && other.hp > 0 && other.respawnTimer <= 0) {
          const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
          if (botPos.distanceTo(otherPos) < 6.0) nearbyEnemiesCount++;
        }
      });
    }

    return evaluateAICombatDecision({
      difficulty,
      weaponSwapIQ: context.weaponSwapIQ ?? s.settings.aiWeaponSwapIQ ?? 50,
      currentWeapon: currentWeapon ?? 'hammer',
      botHP,
      botMaxHP,
      distanceToTarget: dist,
      combatDistanceToTarget: context.combatDistanceToTarget,
      nearbyEnemiesCount,
      target: {
        id: target.id,
        hp: target.hp,
        activeWeapon: target.activeWeapon,
        weaponState: target.weaponState,
        isLunging: target.isLunging,
        invulnerabilityTimer: target.invulnerabilityTimer,
        dashCooldownRemaining: target.dashCooldownRemaining,
        swapLockoutRemaining: target.swapLockoutRemaining,
      },
      attackRange: s.settings.attackRange,
      attackRadius: s.settings.attackRadius,
      swordLungeDistance: s.settings.swordLungeDistance ?? 14.5,
      swordLungeSpeed: s.settings.swordLungeSpeed ?? 24.0,
      swordTradeWindowMs: s.settings.swordTradeWindow ?? 350,
      canStartWeaponAction: context.canStartWeaponAction ?? true,
      weaponState: context.weaponState ?? 'ready',
      recentLungeMemory: context.recentLungeMemory,
      weaponPrioritization: context.weaponPrioritization ?? 50,
      playerModel: context.playerModel,
      matchMultipliers,
    });
  };

  const canStartAIHammerJump = (self: any, pos: THREE.Vector3, vel: THREE.Vector3): boolean => {
    // Parity with the player: a hammer jump needs a READY hammer (so its frequency is
    // capped by the natural hammer swing cadence, exactly like the player, rather than an
    // artificial AI-only cooldown) and a grounded combatant. Requiring 'ready' also stops
    // the main AI from re-planning a jump every frame while a planned swing is in flight.
    const isAirborne =
      self.isJumping ||
      pos.y > AI_HAMMER_JUMP_START_MAX_HEIGHT ||
      Math.abs(vel.y) > AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON;

    return self.weaponState === 'ready' && !isAirborne;
  };

  const startAIHammerJump = (
    self: any,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType: 'offensive' | 'defensive' = 'offensive'
  ): boolean => {
    const s = stateRef.current;
    if (!canStartAIHammerJump(self, pos, vel)) {
      return false;
    }

    if (self.id === 'main_ai') {
      // The main AI plans the jump and lifts off when its hammer swing connects. Frequency
      // is capped by the natural swing cadence (weaponState gate above), not a cooldown.
      mai()!.hammerJumpPlanned = true;
      mai()!.hammerJumpType = jumpType;
      triggerEnemyHammerSwing();
    } else {
      // Bots lift off immediately.
      self.weaponState = 'swing_up';
      self.weaponTimer = 0;
      vel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
      self.isJumping = true;
      if (horizontalHeading && horizontalHeading.lengthSq() > 0.0001) {
        const jumpHeading = horizontalHeading.clone().normalize();
        vel.x = jumpHeading.x * 6.5;
        vel.z = jumpHeading.z * 6.5;
      }
      sfx.playSwing();
      sfx.playJump();
    }

    return true;
  };

  // The render mesh for a combatant. All AI combatants (main_ai + bots) use
  // otherPlayerMeshes; enemyGroup is reserved for multiplayer client/observer rendering.
  const getCombatantMesh = (id: string): THREE.Object3D | undefined =>
    threeRef.current.otherPlayerMeshes?.get(id)?.group;

  // The (hammer, sword) display-mesh pair for a combatant.
  const getCombatantWeaponMeshes = (id: string): { hammer?: THREE.Object3D; sword?: THREE.Object3D } | undefined =>
    threeRef.current.otherPlayerMeshes?.get(id);

  // Start an attack for any combatant through the shared `self` accessor. Overhand
  // sword slashes and hammer swings use 'swing_up'; the hammer side-swipe melee uses
  // 'melee_up'. Records the matching attack timestamp and plays the swing sfx. Replaces
  // the per-combatant fork (main called triggerEnemySwordSlash/HammerSwing/HammerMelee;
  // bots set weaponState directly). Note: the main AI's old triggers also bailed during
  // weapon-swap cooldown / dash — those guards are dropped here since the call sites
  // already gate on weaponState === 'ready' and dash state.
  const triggerCombatantAttack = (self: any, weapon: 'hammer' | 'sword', melee = false) => {
    self.weaponState = melee ? 'melee_up' : 'swing_up';
    self.weaponTimer = 0;
    if (weapon === 'sword') {
      self.lastSwordAttackTime = Date.now();
    } else {
      self.lastHammerAttackTime = Date.now();
    }
    sfx.playSwing();
  };

  // Initiate a sword lunge for any AI combatant (main AI or bot) through one path.
  // Callers have already biased + normalized lungeDir and rejected zero-length dirs.
  // The main-AI's lungeStartPos/lungeTargetDir bridge setters .copy() into the live
  // Vector3s; bots get plain {x,y,z}. Convergence vs the old main-only
  // triggerEnemySwordLunge: bots now set isJumping + record lastSwordAttackTime, and
  // the main AI no longer short-circuits on swap-cooldown/dash-remaining here (the
  // network-replay path at the lunge_sword handler still uses triggerEnemySwordLunge).
  const triggerCombatantLunge = (self: any, lungeDir: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3) => {
    const s = stateRef.current;
    self.isLunging = true;
    self.lungeTimer = 0;
    self.lungeStartPos = { x: pos.x, y: pos.y, z: pos.z };
    self.lungeTargetDir = { x: lungeDir.x, y: lungeDir.y, z: lungeDir.z };
    const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
    vel.y = Math.max(vel.y, lungeDir.y * lungeSpeed);
    self.isJumping = pos.y > 0.01 || vel.y > 0.01;
    self.weaponState = 'ready';
    self.lastSwordAttackTime = Date.now();
    sfx.playDash();
  };

  // Swap any AI combatant's active weapon + toggle its display meshes through one path.
  // `setLockout` arms BOTH post-swap timers, exactly mirroring the player's swap
  // (see swapPlayerWeapon): weaponSwapLockout gates the *next* swap, and weaponReadyTime
  // gates *attacking* after the swap (enforced via swapCooldownTimer in the AI tick's
  // canStartWeaponAction gate). The feint revert and spawn telegraph pass setLockout=false
  // so they don't pay the ready cost. This keeps the AI from swapping and attacking faster
  // than the player's configured mechanics allow.
  const swapCombatantWeapon = (self: any, type: 'hammer' | 'sword', setLockout = false) => {
    const s = stateRef.current;
    self.activeWeapon = type;
    if (setLockout) {
      if (s.settings.weaponSwapLockout > 0) {
        self.swapLockoutTimer = s.settings.weaponSwapLockout;
      }
      if (s.settings.weaponReadyTime > 0) {
        self.swapCooldownTimer = s.settings.weaponReadyTime;
      }
    }
    const meshes = getCombatantWeaponMeshes(self.id);
    if (meshes && meshes.hammer && meshes.sword) {
      meshes.hammer.visible = type === 'hammer';
      meshes.sword.visible = type === 'sword';
    }
  };

  // Respawn any AI combatant (main AI or bot) through one routine. Common state is
  // reset via the Combatant interface; the main AI's bespoke flat-only fields
  // (planned hammer jump, swap cooldown, jump flag, pressure target) are reset in a
  // small id-guarded block. Spawn point avoids the player and every other live
  // combatant. `mesh` is the combatant's render group in otherPlayerMeshes.
  const respawnCombatant = (c: Combatant, mesh: THREE.Object3D) => {
    const s = stateRef.current;
    c.hp = c.maxHp;

    const exclude: THREE.Vector3[] = [s.playerPos];
    getRosterAI().forEach((o) => {
      if (o.id !== c.id && o.hp > 0 && (o.respawnTimer ?? 0) <= 0) {
        exclude.push(new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z));
      }
    });
    const spawnPos = getOptimalSpawnPoint(exclude);
    c.pos.copy(spawnPos);
    c.vel.set(0, 0, 0);
    c.yaw = getInwardSpawnYaw(spawnPos);

    c.weaponState = 'ready';
    c.weaponTimer = 0;
    c.aiHammerJumpCooldownTimer = 0;
    c.invulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
    c.spawnTime = Date.now();

    // Reset combat state so the respawned combatant re-acquires and closes on targets
    // instead of keeping pre-death micro-spacing state.
    c.isLunging = false;
    c.aiState = 'APPROACHING';
    c.aiTimer = 0;
    c.aiDashRemaining = 0;
    c.aiLastLungeOutcome = undefined;
    c.aiLastLungeTargetId = undefined;
    c.aiPostLungeDecisionTimer = 0;
    c.aiPendingPostEvasionCharge = false;
    c.aiCoordCommitTimer = 0;
    c.swapLockoutTimer = 0;
    clearBotComboState(s.aiMatchContext, c.id);
    clearPressureTarget(c.id);

    // Main-AI-only extras on the combatant object.
    if (c.id === MAIN_AI_ID) {
      c.isJumping = false;
      c.hammerJumpPlanned = false;
      c.hammerJumpType = undefined;
      c.swapCooldownTimer = 0;
      c.aiPressureTargetId = undefined;
    }

    mesh.visible = true;
    sfx.playRespawn();
  };

  const updateSingleAIEntity = (botId: string, dt: number) => {
    const s = stateRef.current;

    const self: any = s.otherPlayers.get(botId);
    if (!self || self.controller !== 'ai') return;

    const botMesh = getCombatantMesh(botId);
    if (!botMesh) return;

    const hp = self.hp;
    if (hp <= 0) return;

    // Tick down invulnerability timer
    if ((self.invulnerabilityTimer ?? 0) > 0) {
      self.invulnerabilityTimer = Math.max(0, self.invulnerabilityTimer - dt);
    }

    // Initialize AI sub-state defaults on first tick (no-op for the main AI, whose
    // Combatant is seeded from its flat state).
    if (!self.aiState) self.aiState = 'APPROACHING';
    if (self.aiTimer === undefined) self.aiTimer = 0;
    if (self.aiSwayTimer === undefined) self.aiSwayTimer = Math.random() * Math.PI;
    if (self.aiDashCooldownTimer === undefined) self.aiDashCooldownTimer = 0;
    if (self.aiDashRemaining === undefined) self.aiDashRemaining = 0;
    if (self.aiDashDir === undefined) self.aiDashDir = { x: 0, y: 0, z: 0 };
    if (self.aiSlideActive === undefined) self.aiSlideActive = false;
    if (self.aiSlideDistanceTraveled === undefined) self.aiSlideDistanceTraveled = 0;
    if (self.aiSlideCooldownTimer === undefined) self.aiSlideCooldownTimer = 0;
    if (self.aiHammerJumpCooldownTimer === undefined) self.aiHammerJumpCooldownTimer = 0;
    if (self.aiPostLungeDecisionTimer === undefined) self.aiPostLungeDecisionTimer = 0;
    if (self.aiPendingPostEvasionCharge === undefined) self.aiPendingPostEvasionCharge = false;

    let pendingPostEvasionCharge = self.aiPendingPostEvasionCharge ?? false;

    // pos/vel keep the working-copy vs live-ref distinction: the main AI mutates its
    // flat vectors in place (self.pos/self.vel alias mai()!.pos/mai()!.vel), while a bot edits
    // a copy of self.pos/self.vel that syncStateAndMesh writes back.
    const pos = self.pos;
    const vel = self.vel;
    let yaw = self.yaw;
    let activeWeapon = self.activeWeapon;
    let weaponState = self.weaponState || 'ready';

    // Declare local state variables and sync them from the combatant state
    let state = self.aiState;
    let timer = self.aiTimer;
    let swayTimer = self.aiSwayTimer;
    let dashCooldownTimer = self.aiDashCooldownTimer;
    let dashRemaining = self.aiDashRemaining;
    let slideActive = self.aiSlideActive ?? false;
    let slideDistanceTraveled = self.aiSlideDistanceTraveled ?? 0;
    let slideCooldownTimer = self.aiSlideCooldownTimer ?? 0;
    let isSprinting = false;
    let coordCommitTimer = self.aiCoordCommitTimer ?? 0;
    let hammerJumpCooldownTimer = self.aiHammerJumpCooldownTimer;
    const dashDir = new THREE.Vector3(self.aiDashDir.x, self.aiDashDir.y, self.aiDashDir.z);

    // Write the frame's working state back to the combatant through `self`. For the
    // main AI `self.pos`/`self.vel` already alias mai()!.pos/mai()!.vel (so copy is a no-op
    // self-copy); for a bot they copy the working vectors into the stored object. The
    // aiDashDir setter copies into the main AI's Vector3 but assigns a fresh object on
    // a bot — matching each backing store's representation.
    const syncStateAndMesh = () => {
      self.pos.copy(pos);
      self.vel.copy(vel);
      self.yaw = yaw;
      self.aiState = state;
      self.aiTimer = timer;
      self.aiSwayTimer = swayTimer;
      self.aiDashCooldownTimer = dashCooldownTimer;
      self.aiDashRemaining = dashRemaining;
      self.aiDashDir = { x: dashDir.x, y: dashDir.y, z: dashDir.z };
      self.aiSlideActive = slideActive;
      self.aiSlideDistanceTraveled = slideDistanceTraveled;
      self.aiSlideCooldownTimer = slideCooldownTimer;
      self.aiIsSprinting = isSprinting;
      self.aiHammerJumpCooldownTimer = hammerJumpCooldownTimer;
      self.aiPendingPostEvasionCharge = pendingPostEvasionCharge;
      self.aiCoordCommitTimer = coordCommitTimer;
      botMesh.position.copy(pos);
      botMesh.rotation.y = yaw;
      botMesh.scale.set(1, self.isCrouching ? 0.65 : 1, 1);
    };

    const finishSwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string) => {
      self.isLunging = false;
      self.weaponState = 'ready';
      self.aiLastLungeOutcome = outcome;
      self.aiLastLungeTargetId = targetId;
      self.aiPostLungeDecisionTimer = outcome === 'miss_timeout' || outcome === 'miss_arena' ? 1.35 : 0.35;

      let enteredPressure = false;
      if (outcome === 'hit' && targetId) {
        recordBotDamageTag(botId, targetId);
        const sRef = stateRef.current;
        const targetHp = targetId === 'player'
          ? sRef.playerHP
          : targetId === 'main_ai'
            ? sRef.aiHP
            : (sRef.otherPlayers?.get(targetId)?.hp ?? 0);
        const targetInvuln = targetId === 'player'
          ? sRef.playerInvulnerabilityTimer
          : targetId === 'main_ai'
            ? sRef.aiInvulnerabilityTimer
            : (sRef.otherPlayers?.get(targetId)?.invulnerabilityTimer ?? 0);
        enteredPressure = tryEnterPressureState(botId, targetId, targetHp, targetInvuln);
        if (targetHp > 0) {
          tryStartComboOnHit(botId, targetId, 'sword');
        }
      }

      if (!enteredPressure) {
        state = 'COOLDOWN';
        timer = (s.settings.swordLungeReload ?? 1.2) * cooldownMultiplier;
      } else {
        state = 'PRESSURING';
        timer = self.aiTimer ?? timer;
      }
      weaponState = 'ready';

      if (pos.y > 0.01 || Math.abs(vel.y) > 0.01) {
        vel.x = 0;
        vel.z = 0;
        vel.y = Math.min(vel.y, 0);
        self.isJumping = true;
      } else {
        vel.set(0, 0, 0);
        self.isJumping = false;
      }

      self.vel.copy(vel);
    };

    // Resolve difficulty and specific parameters
    const resolvedKnobs = resolveBotKnobs(botId);
    const difficulty = resolvedKnobs.difficulty;
    const reactionLatency = resolvedKnobs.reactionLatency;
    const anticipationFactor = resolvedKnobs.anticipationFactor;
    const movementComplexity = resolvedKnobs.movementComplexity;
    const weaponSwapIQ = resolvedKnobs.weaponSwapIQ;
    const aiPlaystyle = resolvedKnobs.aiPlaystyle;
    const weaponPrioritization = resolvedKnobs.weaponPrioritization;
    const swordForbidden = weaponPrioritization <= 0;
    const hammerForbidden = weaponPrioritization >= 100;

    if ((self.aiPostLungeDecisionTimer ?? 0) > 0) {
      self.aiPostLungeDecisionTimer = Math.max(0, self.aiPostLungeDecisionTimer - dt);
    }

    // Playstyle calculations (hybrid tuning layer)
    const derivedParams = resolveBotDerived(botId);
    const personalityFlags = resolveBotFlags(botId);
    const matchMultipliers = deriveMatchStateMultipliers(
      {
        scorePlayer: s.scorePlayer,
        scoreEnemy: s.scoreEnemy,
        killsToWin: matchKillsToWin,
      },
      derivedParams.pressureAggression / 100
    );
    const effectivePressureAggression = applyMatchAggression(
      derivedParams.pressureAggression,
      matchMultipliers
    );
    const playstyleFactor = effectivePressureAggression / 100;

    const calibrationEnabled = isSkillCalibrationEnabled(difficulty);
    const calibrationMultipliers = calibrationEnabled
      ? computeCalibrationMultipliers(getOrCreateBotCalibrationState(s.aiMatchContext, botId))
      : NEUTRAL_CALIBRATION_MULTIPLIERS;
    const calibratedKnobs = applyCalibrationMultipliers({
      reactionLatency,
      anticipationFactor,
      aggressiveLungeMult: 1,
      multipliers: calibrationMultipliers,
    });
    const tunedReactionLatency = calibratedKnobs.reactionLatency;
    const tunedAnticipationFactor = calibratedKnobs.anticipationFactor;

    const psychEnabled = isPsychPressureEnabled(difficulty, effectivePressureAggression);
    const psychState = tickBotPsychState(s.aiMatchContext, botId, dt);
    const effectiveReactionLatency = getEffectiveReactionLatency(tunedReactionLatency, psychState, psychEnabled);
    const postKillPressure = psychEnabled ? getActivePostKillPressure(psychState) : undefined;

    if (postKillPressure) {
      // A lunge-kill can leave us airborne; the post-kill spawn-guard below is a ground
      // behavior that only moves horizontally, so without this it would strafe in mid-air
      // ("run on air"). Fall to the floor first, mirroring the no-target airborne block.
      // (The old external AI-gravity block used to pull the main AI down here every frame;
      // in the unified in-tick model that descent must happen inline.)
      if (self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01) {
        vel.y -= GRAVITY_ACCELERATION * dt;
        pos.addScaledVector(vel, dt);
        recoverCombatantAltitude(self, pos, vel);
        if (pos.y <= 0) {
          pos.y = 0;
          vel.set(0, 0, 0);
          self.isJumping = false;
        }
        const airDamping = Math.max(0, 1 - 5 * dt);
        vel.x *= airDamping;
        vel.z *= airDamping;
        constrainCombatantToArena(pos, vel);
        state = 'SPAWN_GUARDING';
        timer = postKillPressure.timerRemaining;
        swayTimer += dt;
        syncStateAndMesh();
        return;
      }

      const spawnPoint = new THREE.Vector3(postKillPressure.spawnX, 0, postKillPressure.spawnZ);
      const toSpawn = spawnPoint.clone().sub(pos);
      toSpawn.y = 0;
      const spawnDist = toSpawn.length();
      const spawnSpatialIQ = derivedParams.spatialIQ;
      const holdDistance = getPostKillHoldDistance();

      // This path returns early, so it never reaches the normal sway tick below.
      // Advance it here so the post-kill strafe direction keeps changing.
      swayTimer += dt;

      if (spawnDist > 0.1) {
        yaw = getSpawnGuardAimAngle({
          botX: pos.x,
          botZ: pos.z,
          spawnX: spawnPoint.x,
          spawnZ: spawnPoint.z,
          spatialIQ: spawnSpatialIQ,
        });
      }

      if (!swordForbidden && shouldTelegraphSwordAtSpawn(postKillPressure.lungeKill, spawnDist)) {
        if (self.activeWeapon !== 'sword') {
          swapCombatantWeapon(self, 'sword');
        }
        activeWeapon = 'sword';
      }

      state = 'SPAWN_GUARDING';

      if (spawnDist > holdDistance + 1.2) {
        const moveHeading = toSpawn.clone().normalize();
        const approachSpeed = getPostKillApproachSpeed(postKillPressure.lungeKill, effectivePressureAggression);
        vel.copy(moveHeading).multiplyScalar(approachSpeed * (s.settings.speedForward / 100));
        pos.addScaledVector(vel, dt);
      } else if (spawnDist < holdDistance - 0.8) {
        const moveHeading = toSpawn.clone().normalize();
        vel.copy(moveHeading).multiplyScalar(-2.0 * (s.settings.speedBackward / 100));
        pos.addScaledVector(vel, dt);
      } else {
        // Stay mobile inside the hold band: orbit the spawn point with a periodic
        // strafe-direction flip plus a small radial correction, so the AI keeps the
        // player guessing instead of standing still.
        const guardHeading = spawnDist > 0.001 ? toSpawn.clone().normalize() : new THREE.Vector3(1, 0, 0);
        const strafeDir = new THREE.Vector3(-guardHeading.z, 0, guardHeading.x);
        const sideSign = Math.sin(swayTimer * 2.4) > 0 ? 1 : -1;
        const strafeSpeed = 3.2 * (s.settings.speedSide / 100);
        const radialCorrection = Math.max(-1, Math.min(1, spawnDist - holdDistance));
        vel.copy(strafeDir).multiplyScalar(strafeSpeed * sideSign);
        vel.addScaledVector(guardHeading, radialCorrection * 1.5 * (s.settings.speedForward / 100));
        pos.addScaledVector(vel, dt);
      }
      constrainCombatantToArena(pos, vel);

      self.yaw = yaw;
      self.aiState = state;
      self.aiTimer = postKillPressure.timerRemaining;
      self.activeWeapon = activeWeapon;
      self.aiSwayTimer = swayTimer;
      self.pos.copy(pos);
      self.vel.copy(vel);
      botMesh.rotation.y = yaw;
      botMesh.position.copy(pos);
      return;
    }

    let target = getBestTacticalTarget(botId, pos, difficulty);
    const pressureTargetId = self.aiPressureTargetId;
    if (state === 'PRESSURING' && pressureTargetId) {
      const lockedTarget = getTacticalTargetById(botId, pressureTargetId);
      if (lockedTarget) {
        target = lockedTarget;
      }
    }

    if (!target) {
      if (self.isLunging) {
        // Reload/recovery mirrors the player's configured mechanic settings exactly
        // (multiplier 1) — see cooldownMult below.
        finishSwordLunge(1, 'target_dead', undefined);
      }
      self.aiDashRemaining = 0;

      const isAirborneWithoutTarget = self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01;

      if (isAirborneWithoutTarget) {
        vel.y -= GRAVITY_ACCELERATION * dt;
        pos.addScaledVector(vel, dt);
        recoverCombatantAltitude(self, pos, vel);
        if (pos.y <= 0) {
          pos.y = 0;
          vel.set(0, 0, 0);
          self.isJumping = false;
        }
        const airDamping = Math.max(0, 1 - 5 * dt);
        vel.x *= airDamping;
        vel.z *= airDamping;
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
      }

      const livingPositions: THREE.Vector3[] = [];
      if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
        livingPositions.push(s.playerPos);
      }
      if (mai()!.hp > 0 && botId !== 'main_ai' && mai()!.aiState !== 'RESPAWNING') {
        livingPositions.push(mai()!.pos);
      }
      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.id !== botId && other.hp > 0 && other.respawnTimer <= 0) {
            livingPositions.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
          }
        });
      }

      const anticipatedSpawn = getOptimalSpawnPoint(livingPositions);
      const toSpawn = anticipatedSpawn.clone().sub(pos);
      toSpawn.y = 0;
      const spawnDist = toSpawn.length();
      const spawnSpatialIQ = derivedParams.spatialIQ;

      if (spawnDist > 0.1) {
        yaw = getSpawnGuardAimAngle({
          botX: pos.x,
          botZ: pos.z,
          spawnX: anticipatedSpawn.x,
          spawnZ: anticipatedSpawn.z,
          spatialIQ: spawnSpatialIQ,
        });
      }

      state = 'SPAWN_GUARDING';

      const activeMap = getActiveCustomMap();
      const spawnPosScore = scorePosition({
        botX: pos.x,
        botZ: pos.z,
        targetX: anticipatedSpawn.x,
        targetZ: anticipatedSpawn.z,
        arenaRadius: activeMap ? activeMap.arenaRadius : s.arenaRadius,
        mapShape: activeMap?.mapShape,
      });

      if (spawnDist > 6.0) {
        const moveHeading = toSpawn.clone().normalize();
        if (spawnPosScore.centerRepositionStrength > 0.3 && spawnSpatialIQ >= 25) {
          const centerBlend = spawnPosScore.centerRepositionStrength * (spawnSpatialIQ / 100) * 0.4;
          const toCenter = new THREE.Vector3(-pos.x, 0, -pos.z).normalize();
          moveHeading.lerp(toCenter, centerBlend).normalize();
        }
        vel.copy(moveHeading).multiplyScalar(3.5 * (s.settings.speedForward / 100));
        pos.addScaledVector(vel, dt);
      } else if (spawnDist < 5.0) {
        const moveHeading = toSpawn.clone().normalize();
        vel.copy(moveHeading).multiplyScalar(-2.5 * (s.settings.speedBackward / 100));
        pos.addScaledVector(vel, dt);
      } else {
        vel.set(0, 0, 0);
      }
      constrainCombatantToArena(pos, vel);

      self.yaw = yaw;
      self.aiState = state;
      self.aiTimer = 0;
      self.pos.copy(pos);
      self.vel.copy(vel);
      botMesh.rotation.y = yaw;
      botMesh.position.copy(pos);
      return;
    }

    registerBotEngagement(s.aiMatchContext.coordinator, botId, target.id);

    // SPAWN_GUARDING is only driven by the post-kill-pressure / no-target early-return
    // paths above. If we reach here we have a live target and those holds have expired,
    // but the bottom combat state machine has no SPAWN_GUARDING branch — so a stale value
    // would leave the AI frozen with no movement or transition (notably after a lunge
    // kill in low-HP modes). Reset it back into normal engagement.
    if (state === 'SPAWN_GUARDING') {
      state = 'APPROACHING';
      timer = 0;
    }

    // Gravity Integration (main AI + bots, unified in-tick model)
    if (vel.y !== 0 || pos.y > 0) {
      vel.y -= GRAVITY_ACCELERATION * dt;
      pos.y += vel.y * dt;

      pos.x += vel.x * dt;
      pos.z += vel.z * dt;
      recoverCombatantAltitude(self, pos, vel);

      if (pos.y <= 0) {
        pos.y = 0;
        vel.set(0, 0, 0);
        self.isJumping = false;
      }
    } else {
      pos.y = 0;
      vel.y = 0;
      self.isJumping = false;
    }
    constrainCombatantToArena(pos, vel);

    const anticipationBonus = tunedAnticipationFactor * 0.42;
    const predictionLead = tunedAnticipationFactor > 0.1 ? effectiveReactionLatency + anticipationBonus : 0;
    const predictedTargetPos = predictCombatantPosition(target.pos, target.vel, predictionLead);
    const targetAirborne = predictedTargetPos.y > 0.35 || target.pos.y > 0.35 || (!!target.vel && Math.abs(target.vel.y) > 1.0);
    const targetLandingPos = predictLandingPosition(target.pos, target.vel, Math.min(1.5, predictionLead + tunedAnticipationFactor * 0.65));
    
    const activeCustomMap = getActiveCustomMap();
    const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
    if (activeCustomMap?.mapShape === 'rectangular') {
      const boundX = radiusToUse * 1.2 - 0.6;
      const boundZ = radiusToUse * 0.6 - 0.6;
      predictedTargetPos.x = Math.max(-boundX, Math.min(boundX, predictedTargetPos.x));
      predictedTargetPos.z = Math.max(-boundZ, Math.min(boundZ, predictedTargetPos.z));
    } else {
      const predDistFromCenter = Math.sqrt(predictedTargetPos.x * predictedTargetPos.x + predictedTargetPos.z * predictedTargetPos.z);
      if (predDistFromCenter > radiusToUse - 0.6) {
        const angle = Math.atan2(predictedTargetPos.z, predictedTargetPos.x);
        predictedTargetPos.x = Math.cos(angle) * (radiusToUse - 0.6);
        predictedTargetPos.z = Math.sin(angle) * (radiusToUse - 0.6);
      }
    }

    const movementTargetPos = targetAirborne && movementComplexity >= 50
      ? ((target.vel?.y ?? 0) < -0.75 ? targetLandingPos : predictedTargetPos)
      : predictedTargetPos;

    if (activeCustomMap?.mapShape === 'rectangular') {
      const boundX = radiusToUse * 1.2 - 0.6;
      const boundZ = radiusToUse * 0.6 - 0.6;
      movementTargetPos.x = Math.max(-boundX, Math.min(boundX, movementTargetPos.x));
      movementTargetPos.z = Math.max(-boundZ, Math.min(boundZ, movementTargetPos.z));
    } else {
      const landingDistFromCenter = Math.sqrt(movementTargetPos.x * movementTargetPos.x + movementTargetPos.z * movementTargetPos.z);
      if (landingDistFromCenter > radiusToUse - 0.6) {
        const angle = Math.atan2(movementTargetPos.z, movementTargetPos.x);
        movementTargetPos.x = Math.cos(angle) * (radiusToUse - 0.6);
        movementTargetPos.z = Math.sin(angle) * (radiusToUse - 0.6);
      }
    }

    const toTarget = movementTargetPos.clone().sub(pos);
    toTarget.y = 0;
    const distanceToTarget = toTarget.length();

    yaw = Math.atan2(toTarget.x, toTarget.z);
    botMesh.rotation.y = yaw;

    const playerDangerZone = s.settings.attackRange + s.settings.attackRadius * 0.85;
    const aiReach = s.settings.attackRange + s.settings.attackRadius * 0.75;

    // Playstyle combat spacing adjustments
    const spacingFactor =
      (1.35 - 0.60 * playstyleFactor) *
      matchMultipliers.spacingMult *
      personalityFlags.spacingBand;
    const resolvedDangerZone = playerDangerZone * spacingFactor;
    const resolvedAiReach = aiReach * (0.8 + 0.4 * playstyleFactor);
    const minLungeRange = resolvedDangerZone * 0.85;
    const maxLungeRange = Math.min(18.0, s.settings.swordLungeDistance ?? 14.5);

    // Evasion, lunge and recovery/cooldown playstyle modifiers
    const defensiveEvasionMult = difficulty !== 'easy' ? (1.5 - Math.abs(playstyleFactor - 0.5) * 1.0) : 1.0;
    const baseAggressiveLungeMult = 0.4 + 1.6 * playstyleFactor;
    const aggressiveLungeMult = applyCalibrationMultipliers({
      reactionLatency: 1,
      anticipationFactor: 1,
      aggressiveLungeMult: baseAggressiveLungeMult,
      multipliers: calibrationMultipliers,
    }).aggressiveLungeMult;
    // AI swing/lunge reload mirrors the player's configured mechanic settings
    // exactly. Playstyle and score state no longer scale reload speed, so the AI
    // can never reload faster than the values the user has set. (Playstyle still
    // shapes spacing, aggression and lunge range — just not raw reload timing.)
    const cooldownMult = 1;

    // Single source of truth for AI attack reloads. Always the player's configured
    // mechanic settings (mirrors the player exactly) so no attack path can ever swing
    // faster than the user's gameplay dials. Never hardcode a reload literal — route it
    // through here. Hammer side-swipe (melee) reloads on hammerMeleeReload; the wide
    // overhead/level hammer and sword use hammerReloadTime / swordSlashReload.
    const weaponReloadTime = (weapon: 'hammer' | 'sword', isMelee = false): number => {
      if (weapon === 'sword') return s.settings.swordSlashReload ?? 0.6;
      if (isMelee) return s.settings.hammerMeleeReload ?? 0.5;
      return s.settings.hammerReloadTime ?? 0.6;
    };

    const targetIsProtected = target.invulnerabilityTimer > 0;
    const targetIsLunging = target.isLunging;

    if (calibrationEnabled) {
      tickCalibrationPendingDodge(s.aiMatchContext, botId, dt, targetIsLunging);
      tickCalibrationPendingCounter(s.aiMatchContext, botId, dt, targetIsLunging);
    }
    // The swap-ready cooldown (weaponReadyTime) gates attacking after a weapon swap,
    // exactly as it does for the player. `let` so a same-tick tactical swap can revoke it.
    let canStartWeaponAction =
      (state !== 'COOLDOWN' || timer <= 0) && (self.swapCooldownTimer ?? 0) <= 0;

    const isTacticalState = state === 'SIDE_STEPPING' || state === 'COOLDOWN';
    const crouchCycle = (swayTimer % 4.0) < 1.5;
    // Sliding forces a crouch posture, like the player's slide.
    const isCrouching = slideActive || (isTacticalState && crouchCycle && (movementComplexity > 30));

    if (isCrouching) {
      botMesh.scale.set(1, 0.65, 1);
    } else {
      botMesh.scale.set(1, 1, 1);
    }
    self.isCrouching = isCrouching;

    const botBodyCenter = getCombatBodyCenter(pos, isCrouching);
    const targetBodyCenter = getCombatBodyCenter(predictedTargetPos, target.isCrouching);
    const combatDistanceToTarget = botBodyCenter.distanceTo(targetBodyCenter);
    const verticalDeltaToTarget = targetBodyCenter.y - botBodyCenter.y;
    const verticalThreat = Math.abs(verticalDeltaToTarget) > 1.1;
    const attackDistanceToTarget = verticalThreat ? combatDistanceToTarget : distanceToTarget;

    // Guaranteed-kill-range detection (shared, weapon-aware). A forward-facing swing
    // plants its damage sphere (radius attackRadius) ~attackRange ahead of the bot
    // (the hammer slightly nearer, 0.875x), so any enemy within (forward offset +
    // radius) along the bot's facing is fully inside it. Since the bot's yaw is locked
    // onto its target every frame, an enemy inside this range is a near-guaranteed hit
    // at zero self-risk — a combatant never takes damage from its own sphere (true even
    // for a hammer whose blast overlaps itself). When an enemy is in this range the bot
    // must NOT hold spacing, dance, or hammer-jump: leaping points the sphere straight
    // down and whiffs (the group "jump / spin / miss" loop) when a simple ground swing
    // would connect. A small margin is shaved off so the target can't drift out of the
    // sphere during the swing wind-up. selfGrounded gates the commit so a bot only takes
    // the free swing while planted, not mid-leap.
    // Weapon-aware reach for a *stationary* swing — the distance at which the swing's
    // damage sphere actually covers the target (see applyBotMeleeImpact). The sword's
    // slash is a tight arc; gating it on hammer reach made the AI whiff-slash from far
    // out. A sword bot beyond this band should lunge or keep closing, never bluff-slash.
    const weaponForwardReach =
      (s.settings.attackRange ?? 3.2) *
      (activeWeapon === 'hammer' ? HAMMER_STRIKE_FORWARD_FACTOR : SWORD_SLASH_FORWARD_FACTOR);
    const weaponStrikeRadius = activeWeapon === 'hammer' ? (s.settings.attackRadius ?? 4.5) : SWORD_SLASH_RADIUS;
    const guaranteedKillRange = weaponForwardReach + weaponStrikeRadius * 0.8;
    const enemyInKillRange =
      target.hp > 0 && !targetIsProtected && attackDistanceToTarget <= guaranteedKillRange;
    const selfGrounded = pos.y <= 0.05 && !self.isJumping && Math.abs(vel.y) <= 0.01;

    // Distance at which a stationary swing may be *committed*. The hammer keeps its
    // spacing-tuned reach (its sphere is wide). The sword is clamped to where its slash
    // actually lands so it never commits an out-of-range bluff slash — when it is too far
    // to connect but inside the lunge band, the lunge path closes the gap instead.
    const stationarySwingReach =
      activeWeapon === 'hammer' ? resolvedAiReach : Math.min(resolvedAiReach, guaranteedKillRange);

    const inCoordCommitBand =
      attackDistanceToTarget <= resolvedAiReach + 0.5 &&
      weaponState === 'ready' &&
      !targetIsProtected &&
      target.hp > 0;
    if (inCoordCommitBand) {
      coordCommitTimer += dt;
    } else {
      coordCommitTimer = 0;
    }

    if (psychEnabled) {
      psychState.standoffTimer = accumulateStandoffTimer(
        psychState.standoffTimer,
        isInStandoffBand(distanceToTarget, resolvedDangerZone),
        dt
      );
    }

    if (target.id === LOCAL_PLAYER_ID) {
      const nowSeconds = performance.now() / 1000;
      recordLocalPlayerObservation((model) => {
        observePlayerPosition(model, s.playerPos.x, s.playerPos.z, s.arenaRadius, nowSeconds, getActiveCustomMap()?.mapShape);
        if (distanceToTarget < 15) {
          const speed = Math.hypot(s.playerVel.x, s.playerVel.z);
          const maxSpeed = (s.settings.speedForward / 100) * 5.0;
          observePlayerApproachSpeed(model, speed, maxSpeed);
        }
      });
    }

    if (dashCooldownTimer > 0) {
      dashCooldownTimer = Math.max(0, dashCooldownTimer - dt);
    }
    if (slideCooldownTimer > 0) {
      slideCooldownTimer = Math.max(0, slideCooldownTimer - dt);
    }
    if (botId !== MAIN_AI_ID && (self.swapLockoutTimer ?? 0) > 0) {
      self.swapLockoutTimer = Math.max(0, (self.swapLockoutTimer ?? 0) - dt);
    }
    if (botId !== MAIN_AI_ID && (self.swapCooldownTimer ?? 0) > 0) {
      self.swapCooldownTimer = Math.max(0, (self.swapCooldownTimer ?? 0) - dt);
    }
    if (hammerJumpCooldownTimer > 0) {
      hammerJumpCooldownTimer = Math.max(0, hammerJumpCooldownTimer - dt);
    }

    const aiContext = s.aiMatchContext;
    tickFeintCooldown(aiContext, botId, dt);

    const coordRoleInput = {
      coordinator: aiContext.coordinator,
      botId,
      targetId: target.id,
      difficulty,
    };

    const isAllyAttacking = () => {
      const engaging = getEngagingBotIds(aiContext.coordinator, target.id);
      const myPhase = getAttackPhaseIndex(coordRoleInput);
      for (const allyId of engaging) {
        if (allyId === botId) continue;
        const allyPhase = getAttackPhaseIndex({
          coordinator: aiContext.coordinator,
          botId: allyId,
          targetId: target.id,
          difficulty,
        });
        if (allyPhase >= myPhase) continue;
        if (allyId === 'main_ai') {
          if (
            mai()!.aiState === 'LUNGING' ||
            mai()!.weaponState === 'swing_up' ||
            mai()!.weaponState === 'swing_down'
          ) {
            return true;
          }
        } else {
          const ally = s.otherPlayers?.get(allyId);
          if (
            ally &&
            (ally.isLunging ||
              ally.weaponState === 'swing_up' ||
              ally.weaponState === 'swing_down')
          ) {
            return true;
          }
        }
      }
      return false;
    };

    const isCoordAttackBlocked = () =>
      shouldDeferCoordinatedAttack({
        ...coordRoleInput,
        commitTimer: coordCommitTimer,
        allyAttacking: isAllyAttacking(),
      }) ||
      shouldPunisherHold({
        ...coordRoleInput,
        targetWeaponState: target.weaponState,
        targetRecovering: target.weaponState === 'recovering',
      });

    const feintPlayerMult = getPlayerFeintMultiplier(getTargetPlayerModel(target.id));
    const feintChance = derivedParams.feintChance;
    const swapFeintActive = isWeaponSwapFeintActive(aiContext, botId);
    const swapLockoutRemaining = self.swapLockoutTimer ?? 0;

    const commitFeint = () => {
      startFeintCooldown(aiContext, botId, rollFeintCooldownDuration());
    };

    const tryFeintRoll = (rollScale = 1) => rollFeintAttempt({
      feintChance,
      feintCooldownRemaining: getFeintCooldownRemaining(aiContext, botId),
      playerModelMultiplier: feintPlayerMult,
      rollScale,
    });

    const recentLungeMemory = self.aiLastLungeOutcome ? {
      outcome: self.aiLastLungeOutcome,
      targetId: self.aiLastLungeTargetId,
      timeRemaining: self.aiPostLungeDecisionTimer || 0,
    } : null;

    const applyTacticalWeapon = (tacticalWeapon: 'hammer' | 'sword', force = false) => {
      if (tacticalWeapon === activeWeapon) return;
      if (tacticalWeapon === 'sword' && swordForbidden) return;
      if (tacticalWeapon === 'hammer' && hammerForbidden) return;
      if (!force && (self.swapLockoutTimer ?? 0) > 0) return;
      swapCombatantWeapon(self, tacticalWeapon, true);
      activeWeapon = tacticalWeapon;
      weaponState = 'ready';
      // Just swapped: the weaponReadyTime gate applies immediately, so no attack can
      // fire this tick (mirrors the player's post-swap swapCooldownTimer).
      if (s.settings.weaponReadyTime > 0) canStartWeaponAction = false;
    };

    const revertWeaponSwapFeint = () => {
      if (activeWeapon !== 'sword') return;
      if (hammerForbidden) return;
      self.swapLockoutTimer = 0;
      swapCombatantWeapon(self, 'hammer');
      activeWeapon = 'hammer';
      weaponState = 'ready';
    };

    if (tickWeaponSwapFeintTimer(aiContext, botId, dt)) {
      revertWeaponSwapFeint();
    }

    const tacticalDecision = evaluateTacticalWeaponChoice(botId, target, difficulty, {
      distanceToTarget,
      combatDistanceToTarget,
      canStartWeaponAction,
      weaponState,
      weaponSwapIQ,
      recentLungeMemory,
      weaponPrioritization,
      playerModel: getTargetPlayerModel(target.id),
    });

    if (tacticalDecision.weapon && !swapFeintActive && !comboBlocksTacticalSwap(getBotComboState(aiContext, botId))) {
      applyTacticalWeapon(tacticalDecision.weapon);
    }

    let comboState = getBotComboState(aiContext, botId);
    const targetCommitted =
      target.weaponState === 'swing_up' ||
      target.weaponState === 'swing_down' ||
      targetIsLunging;

    if (comboState) {
      if (shouldAbortCombo({
        targetId: target.id,
        targetHp: target.hp,
        targetInvuln: target.invulnerabilityTimer,
        targetIsLunging,
        targetWeaponState: target.weaponState,
        lockedTargetId: comboState.targetId,
        abortOnTargetCommit: comboState.comboId === 'bait_smash',
        targetCommitted,
      })) {
        clearBotComboState(aiContext, botId);
        comboState = undefined;
      }
    }

    if (
      !comboState &&
      canStartWeaponAction &&
      weaponState === 'ready' &&
      !swapFeintActive &&
      !targetIsProtected &&
      difficulty !== 'easy'
    ) {
      const openingCombo = pickOpeningCombo({
        difficulty,
        weaponSwapIQ,
        weaponPrioritization,
        distanceToTarget: attackDistanceToTarget,
        minLungeRange,
        maxLungeRange,
        targetRecovering: target.weaponState === 'recovering',
      });
      if (openingCombo) {
        setBotComboState(aiContext, botId, createBotComboState(openingCombo, target.id));
        comboState = getBotComboState(aiContext, botId);
        state = 'CHARGE_ATTACK';
        timer = Math.max(timer, 0.25);
      }
    }

    const commitComboAttackAdvance = () => {
      if (!comboState) return;
      const next = notifyComboAttackStarted(comboState);
      setBotComboState(aiContext, botId, next);
      comboState = next ?? undefined;
    };

    const executeComboStrike = (preferLunge: boolean): 'lunge' | 'melee' | false => {
      if (!comboState || !canStartWeaponAction || weaponState !== 'ready' || targetIsProtected || target.hp <= 0) {
        return false;
      }

      const hasVerticalLungeLine = !targetAirborne || movementComplexity >= 60;
      const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;

      if (
        preferLunge &&
        activeWeapon === 'sword' &&
        hasVerticalLungeLine &&
        lungeDistanceToTarget >= minLungeRange &&
        lungeDistanceToTarget <= maxLungeRange
      ) {
        let lungeDir = target.pos.clone().sub(pos);
        if (!targetAirborne) lungeDir.y = 0;
        if (lungeDir.lengthSq() <= 0.0001) return false;

        const playerModel = getTargetPlayerModel(target.id);
        if (playerModel) {
          const biased = applyLungeAimBias(lungeDir.x, lungeDir.z, playerModel);
          lungeDir.x = biased.x;
          lungeDir.z = biased.z;
          if (!targetAirborne) lungeDir.y = 0;
        }
        lungeDir.normalize();

        triggerCombatantLunge(self, lungeDir, pos, vel);
        commitComboAttackAdvance();
        return 'lunge';
      }

      if (attackDistanceToTarget <= stationarySwingReach) {
        state = 'COOLDOWN';
        // The hammer side-swipe only reaches MELEE_HAMMER_SWIPE_REACH (player parity), so
        // only pick it in that band — beyond it the wide overhead gravity hammer is used.
        const isHammerMelee = activeWeapon === 'hammer' &&
          attackDistanceToTarget <= MELEE_HAMMER_SWIPE_REACH &&
          Math.random() < 0.4;
        
        timer = weaponReloadTime(activeWeapon, isHammerMelee) * cooldownMult;

        triggerCombatantAttack(self, activeWeapon, isHammerMelee);
        weaponState = isHammerMelee ? 'melee_up' : 'swing_up';
        commitComboAttackAdvance();
        return 'melee';
      }

      return false;
    };

    if (comboState) {
      const comboResult = progressComboState({
        state: comboState,
        activeWeapon,
        weaponReady: weaponState === 'ready',
        swapLockoutRemaining,
        swapFeintActive,
        distanceToTarget: attackDistanceToTarget,
        minLungeRange,
        maxLungeRange,
        inMeleeRange: attackDistanceToTarget <= resolvedAiReach + 0.5,
        dt,
      });
      setBotComboState(aiContext, botId, comboResult.state);
      comboState = comboResult.state ?? undefined;

      if (comboResult.command.kind === 'swap' && comboResult.command.weapon) {
        applyTacticalWeapon(comboResult.command.weapon);
      } else if (comboResult.command.kind === 'attack') {
        const strikeResult = executeComboStrike(!!comboResult.command.preferLunge);
        if (strikeResult === 'lunge') {
          syncStateAndMesh();
          return;
        }
        if (!strikeResult) {
          if (state !== 'PRESSURING' && state !== 'CHARGE_ATTACK' && state !== 'LUNGING') {
            state = 'CHARGE_ATTACK';
            timer = Math.max(timer, 0.2);
          }
        }
      } else if (comboResult.command.kind === 'complete') {
        clearBotComboState(aiContext, botId);
        comboState = undefined;
      }
    }

    if (tacticalDecision.postMissSpacing && !targetIsLunging && state !== 'COOLDOWN' && state !== 'PRESSURING') {
      state = 'DANCING_BACKWARD';
      timer = Math.max(timer, 0.45);
    }

    const spatialIQ = derivedParams.spatialIQ;
    const evasionPlayerModel = getTargetPlayerModel(target.id);
    const evasionTimingScale = getEvasionTimingScale(evasionPlayerModel);
    const targetOtherBot =
      target.id !== 'player' && target.id !== 'main_ai' ? s.otherPlayers.get(target.id) : undefined;
    const evasionRollInput = { difficulty, defensiveEvasionMult, spatialIQ };

    const startSpatialDodge = (lungeDirX: number, lungeDirZ: number, trackPostEvasion = true) => {
      const dodgePick = pickPerpendicularDodgeDirection({
        botPosX: pos.x,
        botPosZ: pos.z,
        lungeDirX,
        lungeDirZ,
        arenaRadius: s.arenaRadius,
        playerModel: evasionPlayerModel,
      });
      dashDir.set(dodgePick.x, 0, dodgePick.z).normalize();
      dashRemaining = s.settings.dashDuration || 0.25;
      dashCooldownTimer = s.settings.dashCooldown || 2.0;
      sfx.playDash();
      if (calibrationEnabled) {
        recordCalibrationDodgeAttempt(s.aiMatchContext, botId);
      }
      if (trackPostEvasion) {
        pendingPostEvasionCharge = shouldCommitChargeAfterEvasion({
          targetWeaponState: target.weaponState,
          attackDistanceToTarget: combatDistanceToTarget,
          resolvedAiReach,
          targetProtected: targetIsProtected,
          spatialIQ,
          weaponReady: weaponState === 'ready',
        });
      }
      return true;
    };

    let isEvadingLunge = false;

    if (
      shouldAttemptBaitDodge({
        distanceToTarget,
        combatDistanceToTarget,
        spatialIQ,
        targetIsLunging,
        targetActiveWeapon: target.activeWeapon,
        dashCooldownRemaining: dashCooldownTimer,
        difficulty,
      }) &&
      dashCooldownTimer <= 0
    ) {
      const baitLunge = resolveTargetLungeDirection({
        targetId: target.id,
        toTargetX: toTarget.x,
        toTargetZ: toTarget.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        playerIsLunging: target.id === 'player' && s.isLunging,
        playerLungeDirX: s.lungeTargetDir.x,
        playerLungeDirZ: s.lungeTargetDir.z,
        mainAiIsLunging: target.id === 'main_ai' && mai()!.aiState === 'LUNGING',
        mainAiLungeDirX: mai()!.lungeTargetDir.x,
        mainAiLungeDirZ: mai()!.lungeTargetDir.z,
        botIsLunging: !!targetOtherBot?.isLunging,
        botLungeDirX: targetOtherBot?.lungeTargetDir?.x,
        botLungeDirZ: targetOtherBot?.lungeTargetDir?.z,
      });
      if (startSpatialDodge(baitLunge.x, baitLunge.z, false)) {
        isEvadingLunge = true;
      }
    }

    // LUNGE DETECTION, COUNTER-KILLING (BULLTRUE) & EVASIVE DODGES
    if (
      targetIsLunging &&
      isWithinEvasionRange({
        distanceToTarget: distanceToTarget / evasionTimingScale,
        combatDistanceToTarget: combatDistanceToTarget / evasionTimingScale,
        spatialIQ,
        swayPhase: swayTimer,
      }) &&
      difficulty !== 'easy'
    ) {
      const lookHeading = toTarget.clone().normalize();
      const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
      let startedBulltrueCounter = false;
      const incomingLunge = resolveTargetLungeDirection({
        targetId: target.id,
        toTargetX: toTarget.x,
        toTargetZ: toTarget.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        playerIsLunging: target.id === 'player' && s.isLunging,
        playerLungeDirX: s.lungeTargetDir.x,
        playerLungeDirZ: s.lungeTargetDir.z,
        mainAiIsLunging: target.id === 'main_ai' && mai()!.aiState === 'LUNGING',
        mainAiLungeDirX: mai()!.lungeTargetDir.x,
        mainAiLungeDirZ: mai()!.lungeTargetDir.z,
        botIsLunging: !!targetOtherBot?.isLunging,
        botLungeDirX: targetOtherBot?.lungeTargetDir?.x,
        botLungeDirZ: targetOtherBot?.lungeTargetDir?.z,
      });

      if (tacticalDecision.bulltrueCounter === 'hammer' && canStartWeaponAction && activeWeapon === 'hammer' && weaponState === 'ready') {
        state = 'COOLDOWN';
        timer = weaponReloadTime('hammer') * cooldownMult;
        triggerCombatantAttack(self, 'hammer');
        weaponState = 'swing_up';
        startedBulltrueCounter = true;
      } else if (tacticalDecision.bulltrueCounter === 'sword' && canStartWeaponAction && activeWeapon === 'sword' && weaponState === 'ready') {
        state = 'COOLDOWN';
        timer = weaponReloadTime('sword') * cooldownMult;
        triggerCombatantAttack(self, 'sword');
        weaponState = 'swing_up';
        startedBulltrueCounter = true;
      }

      if (startedBulltrueCounter && calibrationEnabled) {
        recordCalibrationCounterAttempt(s.aiMatchContext, botId);
      }

      if (
        !startedBulltrueCounter &&
        dashCooldownTimer <= 0 &&
        Math.random() < getEvasionDashRollChance(evasionRollInput)
      ) {
        if (startSpatialDodge(incomingLunge.x, incomingLunge.z)) {
          isEvadingLunge = true;
        }
      } else if (
        !startedBulltrueCounter &&
        canStartWeaponAction &&
        activeWeapon === 'hammer' &&
        weaponState === 'ready' &&
        Math.random() < getHammerJumpEvasionChance(evasionRollInput)
      ) {
        if (startAIHammerJump(self, pos, vel, undefined, 'defensive')) {
          weaponState = 'swing_up';
          spawnVoxelShockwaveParticles(pos, '#f59e0b');
          isEvadingLunge = true;
        }
      } else if (!startedBulltrueCounter) {
        const dodgePick = pickPerpendicularDodgeDirection({
          botPosX: pos.x,
          botPosZ: pos.z,
          lungeDirX: incomingLunge.x,
          lungeDirZ: incomingLunge.z,
          arenaRadius: s.arenaRadius,
          playerModel: evasionPlayerModel,
        });
        vel.set(dodgePick.x * 7.5, vel.y, dodgePick.z * 7.5);
        if (!self.isJumping) {
          self.isJumping = true;
          vel.y = 5.5;
          sfx.playJump();
        }
        pos.addScaledVector(vel, dt);
        isEvadingLunge = true;
      }

      if (!startedBulltrueCounter && canStartWeaponAction && activeWeapon === 'hammer' && weaponState === 'ready') {
        const bulltrueBand = getBulltrueHammerTriggerBand({
          distanceToTarget,
          lungeSpeed: s.settings.swordLungeSpeed ?? 24.0,
          attackRadius: s.settings.attackRadius,
          timingScale: evasionTimingScale,
        });
        if (isInBulltrueHammerWindow(distanceToTarget, bulltrueBand)) {
          triggerCombatantAttack(self, 'hammer');
        }
      }
    }

    if (
      targetAirborne &&
      difficulty !== 'easy' &&
      movementComplexity >= 50 &&
      canStartWeaponAction &&
      activeWeapon === 'hammer' &&
      weaponState === 'ready' &&
      target.hp > 0 &&
      !targetIsProtected
    ) {
      const fallingIntoHammer = (target.vel?.y ?? 0) <= 0.75 && distanceToTarget <= resolvedDangerZone + 2.5;
      const canReachBody = combatDistanceToTarget <= resolvedAiReach + tunedAnticipationFactor * 1.5;

      if ((fallingIntoHammer || canReachBody) && Math.random() < 0.18 + tunedAnticipationFactor * 0.42) {
        state = 'COOLDOWN';
        timer = weaponReloadTime('hammer') * cooldownMult;
        triggerCombatantAttack(self, 'hammer');
      } else if (!enemyInKillRange && verticalDeltaToTarget > 2.0 && distanceToTarget <= resolvedDangerZone + 4.5 && Math.random() < 0.012 + tunedAnticipationFactor * 0.035) {
        if (startAIHammerJump(self, pos, vel, toTarget, 'offensive')) {
          weaponState = 'swing_up';
        }
      }
    }

    timer -= dt;
    swayTimer += dt;

    const savedVelY = vel.y;

    // Sword-lunge flight. Shared by the main AI and additional bots through the
    // `self` accessor — previously the main AI ran a separate copy of this in
    // updateAI() while bots ran this block, which let the two drift apart.
    if (self.isLunging) {
      self.lungeTimer = (self.lungeTimer || 0) + dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      const targetDir = new THREE.Vector3(self.lungeTargetDir!.x, self.lungeTargetDir!.y, self.lungeTargetDir!.z);

      vel.x = targetDir.x * lungeSpeed;
      vel.z = targetDir.z * lungeSpeed;
      vel.y -= GRAVITY_ACCELERATION * dt;
      pos.addScaledVector(vel, dt);
      recoverCombatantAltitude(self, pos, vel);
      if (pos.y <= 0) {
        pos.y = 0;
        vel.y = 0;
      }
      constrainCombatantToArena(pos, vel);
      self.pos.copy(pos);
      self.vel.copy(vel);
      botMesh.position.copy(pos);

      const trailPos = pos.clone();
      trailPos.y += 0.825;
      // Every AI-team lunge uses the red 'enemyCube' trail (was: main AI 'enemyCube',
      // bots 'shockwave' — converged to the main AI's team-colored cube trail).
      renderSwordLungeTrailVfx(trailPos, '#ef4444', targetDir, 'enemyCube');

      const dist = getCombatBodyCenter(pos, self.isCrouching).distanceTo(getCombatBodyCenter(target.pos, target.isCrouching));
      if (target.hp <= 0) {
        finishSwordLunge(cooldownMult, 'target_dead', target.id);
      } else if (dist <= 1.5) {
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;

        // Detect an active attack from the target we'd trade into — sword OR hammer.
        // Detecting the hammer case for every combatant preserves the main AI's old
        // lunge-vs-hammer trade and extends it to bots, instead of the previous
        // sword-only bot check.
        let tradeReason: 'sword_vs_sword' | 'sword_lunge_vs_hammer' | null = null;
        if (target.id === 'player') {
          if (s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
            s.isLunging || s.pSwordState === 'slashing' || (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
          )) {
            tradeReason = 'sword_vs_sword';
          } else if (s.settings.enableHammerSwordTrade && s.activeWeapon === 'hammer' && (
            s.pWeaponState === 'swing_up' || s.pWeaponState === 'swing_down' || (Date.now() - s.lastPlayerHammerAttackTime <= hammerThreshold)
          )) {
            tradeReason = 'sword_lunge_vs_hammer';
          }
        } else if (target.id === 'main_ai') {
          if (s.settings.enableSwordTrade && mai()!.activeWeapon === 'sword' && (
            mai()!.aiState === 'LUNGING' || mai()!.weaponState === 'swing_up' || mai()!.weaponState === 'swing_down' || (Date.now() - mai()!.lastSwordAttackTime <= swordThreshold)
          )) {
            tradeReason = 'sword_vs_sword';
          } else if (s.settings.enableHammerSwordTrade && mai()!.activeWeapon === 'hammer' && (
            mai()!.weaponState === 'swing_up' || mai()!.weaponState === 'swing_down' || (Date.now() - mai()!.lastHammerAttackTime <= hammerThreshold)
          )) {
            tradeReason = 'sword_lunge_vs_hammer';
          }
        } else {
          const tBot = s.otherPlayers.get(target.id);
          if (tBot) {
            if (s.settings.enableSwordTrade && tBot.activeWeapon === 'sword' && (
              tBot.isLunging || tBot.weaponState === 'swing_up' || tBot.weaponState === 'swing_down'
            )) {
              tradeReason = 'sword_vs_sword';
            } else if (s.settings.enableHammerSwordTrade && tBot.activeWeapon === 'hammer' && (
              tBot.weaponState === 'swing_up' || tBot.weaponState === 'swing_down'
            )) {
              tradeReason = 'sword_lunge_vs_hammer';
            }
          }
        }

        if (tradeReason) {
          executeCustomBotTrade(self, target, tradeReason);
          return;
        }

        if (target.id === 'player') {
          recordPlayerDamageTaken();
          s.playerHP -= 1;
          finishSwordLunge(cooldownMult, 'hit', target.id);
          sfx.playExplosion();
          spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');

          if (s.playerHP <= 0) {
            s.playerHP = 0;
            s.playerRespawnTimer = 3.0;
            s.playerDeaths += 1;
            self.score = (self.score || 0) + 1;
            self.kills = (self.kills || 0) + 1;
            sfx.playDeath();

            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: self.playerName,
              victim: s.settings.playerName || 'Blue (You)',
              weapon: 'sword',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            recordBotPsychKill(botId, 'player', true);
          }
        } else if (target.id === 'main_ai') {
          mai()!.hp -= 1;
          finishSwordLunge(cooldownMult, 'hit', target.id);
          sfx.playExplosion();
          spawnVoxelShockwaveParticles(mai()!.pos, '#ef4444');

          if (mai()!.hp <= 0) {
            mai()!.hp = 0;
            mai()!.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            self.score = (self.score || 0) + 1;
            self.kills = (self.kills || 0) + 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();

            recordDeathEvent(self.playerName, 'Red (AI)', undefined, 'sword');
            recordBotPsychKill(botId, 'main_ai', true);
          }
        } else {
          const oBot = s.otherPlayers.get(target.id);
          if (oBot) {
            oBot.hp -= 1;
            finishSwordLunge(cooldownMult, 'hit', target.id);
            sfx.playExplosion();
            spawnVoxelShockwaveParticles(oBot.pos, '#ef4444');

            if (oBot.hp <= 0) {
              oBot.hp = 0;
              oBot.respawnTimer = 3.0;
              self.score = (self.score || 0) + 1;
              self.kills = (self.kills || 0) + 1;
              oBot.deaths = (oBot.deaths || 0) + 1;
              sfx.playDeath();

              recordDeathEvent(self.playerName, oBot.playerName, undefined, 'sword');
              recordBotPsychKill(botId, target.id, true);
            }
          }
        }
        pushStatsUpdate();
      }

      const startDist = pos.distanceTo(new THREE.Vector3(self.lungeStartPos!.x, self.lungeStartPos!.y, self.lungeStartPos!.z));
      let hitsBoundary = false;
      const activeCustomMap = getActiveCustomMap();
      if (activeCustomMap?.mapShape === 'rectangular') {
        const boundX = (activeCustomMap.arenaRadius * 1.2) - 0.65;
        const boundZ = (activeCustomMap.arenaRadius * 0.6) - 0.65;
        hitsBoundary = Math.abs(pos.x) >= boundX || Math.abs(pos.z) >= boundZ;
      } else {
        const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
        const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
        hitsBoundary = distFromCenter >= radiusToUse - 0.65;
      }

      if (hitsBoundary) {
        finishSwordLunge(cooldownMult, 'miss_arena', target.id);
      } else if (startDist > 16.0 || self.lungeTimer > 0.8) {
        finishSwordLunge(cooldownMult, 'miss_timeout', target.id);
      }
    } else {
      const isAirborneBeforeGroundMovement = self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01;

      if (isAirborneBeforeGroundMovement) {
        const airDamping = Math.max(0, 1 - 5 * dt);
        vel.x *= airDamping;
        vel.z *= airDamping;
        recoverCombatantAltitude(self, pos, vel);
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
      }

      // Defensive floor pin: past the airborne early-return above, every combatant is
      // grounded (isJumping false, pos.y <= 0.01, |vel.y| <= 0.01). Snap any residual
      // height to the floor so a combatant can never get stuck "running in the air"
      // through the ground-movement state machine below, regardless of how it got there.
      // (A new hop/lunge later this frame re-sets these, so jump arcs are unaffected.)
      pos.y = 0;
      vel.y = 0;
      self.isJumping = false;

      // Air-sway is unreachable here for every combatant: the defensive floor-pin above
      // forces vel.y to 0, so vel.y > 0 is never true past this point. Kept (now unified,
      // no main/bot fork) in case the pin is ever relaxed.
      if (vel.y > 0) {
        if (movementComplexity >= 45) {
          const lookHeading = toTarget.clone().normalize();
          const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
          const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
          vel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
          vel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
        }
        syncStateAndMesh();
        return;
      }

    if (isEvadingLunge && dashRemaining <= 0) {
      syncStateAndMesh();
      return;
    }

    const isAIDashing = dashRemaining > 0;
    if (isAIDashing) {
      // A dash overrides any in-progress slide so the two never stack.
      if (slideActive) {
        slideActive = false;
        slideCooldownTimer = s.settings.slideCooldown ?? 1.5;
      }
      isSprinting = false;
      dashRemaining = Math.max(0, dashRemaining - dt);
      const speed = s.settings.dashDistance / (s.settings.dashDuration || 0.25);
      vel.copy(dashDir).multiplyScalar(speed);
      pos.addScaledVector(vel, dt);

      if (dashRemaining <= 0 && pendingPostEvasionCharge) {
        if (
          shouldCommitChargeAfterEvasion({
            targetWeaponState: target.weaponState,
            attackDistanceToTarget: combatDistanceToTarget,
            resolvedAiReach,
            targetProtected: targetIsProtected,
            spatialIQ,
            weaponReady: weaponState === 'ready',
          })
        ) {
          state = 'CHARGE_ATTACK';
          pendingPostEvasionCharge = false;
        } else {
          pendingPostEvasionCharge = false;
        }
      }

      if (Math.random() > 0.15) {
        const trailPos = pos.clone();
        trailPos.y += 0.5;
        const scene = threeRef.current.scene;
        if (scene) {
          const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);
          const mat = new THREE.MeshBasicMaterial({
            color: new THREE.Color(activeWeapon === 'hammer' ? '#f97316' : '#ef4444'),
            transparent: true,
            opacity: 0.75,
          });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.copy(trailPos);
          scene.add(mesh);
          threeRef.current.damageExplosionParticles.push({
            mesh,
            velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4),
            life: 0.0,
            maxLife: 0.25 + Math.random() * 0.15,
          });
        }
      }
    } else {
      // Air-sway (unified, unreachable past the floor-pin above — see the matching note
      // in the non-dashing branch). Kept in case the pin is ever relaxed.
      if (vel.y > 0) {
        if (movementComplexity >= 45) {
          const lookHeading = toTarget.clone().normalize();
          const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
          const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
          vel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
          vel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
        }
      }

      const lookHeading = toTarget.clone().normalize();

      // Inject A* Pathfinding if custom map is active!
      const activeCustomMap = getActiveCustomMap();
      if (activeCustomMap) {
        if (!threeRef.current.navMesh) {
          threeRef.current.navMesh = bakeNavMesh(activeCustomMap);
        }
        const path = findShortestPath(pos, movementTargetPos, threeRef.current.navMesh, activeCustomMap.objects);
        if (path && path.length > 0) {
          lookHeading.copy(path[0]).sub(pos);
          lookHeading.y = 0;
          lookHeading.normalize();
        }
      }

      const spatialBias = getSpatialMovementBias({
        botX: pos.x,
        botZ: pos.z,
        targetX: movementTargetPos.x,
        targetZ: movementTargetPos.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        predictedTargetX: predictedTargetPos.x,
        predictedTargetZ: predictedTargetPos.z,
        arenaRadius: activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius,
        spatialIQ,
        mapShape: activeCustomMap?.mapShape,
      });
      const blendedHeading = blendSpatialHeading(lookHeading.x, lookHeading.z, spatialBias);
      const spatialLookHeading = new THREE.Vector3(blendedHeading.x, 0, blendedHeading.z);
      const sidewayHeading = new THREE.Vector3(-spatialLookHeading.z, 0, spatialLookHeading.x);

      // Optional locomotion mechanics (sprint / slide). Reads live from settings so
      // the player's toggles and speed/distance/cooldown tuning take effect instantly.
      // Dash takes priority and is handled in the isAIDashing branch above, so this
      // path always runs with isDashing = false.
      const targetRecedingSpeed = getTargetRecedingSpeed(
        pos.x,
        pos.z,
        target.pos.x,
        target.pos.z,
        target.vel?.x ?? 0,
        target.vel?.z ?? 0,
      );
      isSprinting = shouldAISprint({
        enableSprint: s.settings.enableSprint,
        state,
        distanceToTarget,
        engageRange: resolvedDangerZone,
        isCrouching,
        isDashing: false,
        isSliding: slideActive,
        targetRecedingSpeed,
      });
      const sprintMult = isSprinting ? getSprintSpeedMultiplier(s.settings.speedSprint) : 1;

      // Sword Lunge Opportunity
      const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;
      const hasVerticalLungeLine = !targetAirborne || movementComplexity >= 60;


      // Guaranteed-kill commit (see enemyInKillRange above). Take the free level swing
      // instead of feinting/lunging/dancing. Running before that whole cautious chain is
      // what breaks the symmetric AI-vs-AI standoff — when the enemy is inside our own
      // weapon's sphere, holding spacing accomplishes nothing, so the correct play is
      // simply to swing.
      if (
        enemyInKillRange &&
        selfGrounded &&
        canStartWeaponAction &&
        weaponState === 'ready' &&
        !slideActive
      ) {
        vel.x = 0;
        vel.z = 0;
        state = 'COOLDOWN';
        timer = weaponReloadTime(activeWeapon) * cooldownMult;
        triggerCombatantAttack(self, activeWeapon);
        weaponState = 'swing_up';
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
      }

      if (
        !swordForbidden &&
        canAttemptWeaponSwapFeint({
          activeWeapon,
          weaponReady: weaponState === 'ready',
          swapLockoutRemaining,
          distanceToTarget: lungeDistanceToTarget,
          minLungeRange,
          maxLungeRange,
          swapFeintActive: isWeaponSwapFeintActive(aiContext, botId),
          state,
          feintEligible: feintChance > 0,
        }) &&
        !getBotComboState(aiContext, botId) &&
        tryFeintRoll(0.5)
      ) {
        applyTacticalWeapon('sword');
        startWeaponSwapFeint(aiContext, botId, WEAPON_SWAP_FEINT_DELAY);
        commitFeint();
      }

      let feintLungeFakeout = false;
      if (canStartWeaponAction && activeWeapon === 'sword' && weaponState === 'ready' && hasVerticalLungeLine && lungeDistanceToTarget >= minLungeRange && lungeDistanceToTarget <= maxLungeRange && target.hp > 0 && !targetIsProtected) {
        let lungeChance = (targetAirborne ? 0.08 + (tunedAnticipationFactor * 0.18) : 0.04 + (tunedAnticipationFactor * 0.08)) * aggressiveLungeMult;
        if (state === 'PRESSURING' && shouldPressurePreferLunge({
          activeWeapon,
          distanceToTarget: lungeDistanceToTarget,
          aiReach: resolvedAiReach,
          minLungeRange,
          maxLungeRange,
          weaponReady: true,
          targetProtected: targetIsProtected,
        })) {
          lungeChance = Math.max(lungeChance, 0.72 + playstyleFactor * 0.2);
        }
        if (Math.random() < lungeChance) {
          const lungeFakeoutEligible = canAttemptLungeFakeout({
            activeWeapon,
            weaponReady: weaponState === 'ready',
            inLungeRange: true,
            targetProtected: targetIsProtected,
            feintEligible: feintChance > 0,
          });
          if (lungeFakeoutEligible && tryFeintRoll(0.55)) {
            commitFeint();
            feintLungeFakeout = true;
            state = 'DANCING_FORWARD';
            timer = LUNGE_FAKEOUT_FORWARD_TIMER;
          } else {
          let lungeDir = target.pos.clone().sub(pos);
          if (!targetAirborne) lungeDir.y = 0;
          if (lungeDir.lengthSq() <= 0.0001) return;

          const playerModel = getTargetPlayerModel(target.id);
          if (playerModel) {
            const biased = applyLungeAimBias(lungeDir.x, lungeDir.z, playerModel);
            lungeDir.x = biased.x;
            lungeDir.z = biased.z;
            if (!targetAirborne) lungeDir.y = 0;
          }
          lungeDir.normalize();

          triggerCombatantLunge(self, lungeDir, pos, vel);
          return;
          }
        }
      }

      const playerModel = getTargetPlayerModel(target.id);
      const approachLateral = getApproachLateralOffset(playerModel);
      const coordLateral = getPincerApproachOffset(coordRoleInput);
      const totalApproachLateral = approachLateral + coordLateral;

      if (weaponState === 'ready' && distanceToTarget > (resolvedDangerZone + 1.5) && distanceToTarget <= (resolvedDangerZone + 5.5) && Math.random() < 0.015 && (movementComplexity >= 40) && !targetIsProtected) {
        if (startAIHammerJump(self, pos, vel, lookHeading, 'offensive')) {
          weaponState = 'swing_up';
        }
      }

      if (state === 'APPROACHING') {
        // Begin a slide as a committed ground gap-closer when conditions allow.
        if (!slideActive && shouldStartAISlide({
          enableSlide: s.settings.enableSlide,
          slideCooldownRemaining: slideCooldownTimer,
          state,
          distanceToTarget,
          engageRange: resolvedDangerZone,
          movementComplexity,
          isDashing: false,
          isSliding: slideActive,
          targetProtected: targetIsProtected,
        })) {
          slideActive = true;
          slideDistanceTraveled = 0;
          isSprinting = false;
          sfx.playDash();
        }

        if (slideActive) {
          const slideSpeed = getSlideSpeed(s.settings.speedSlide);
          vel.copy(spatialLookHeading).multiplyScalar(slideSpeed);
          pos.addScaledVector(vel, dt);
          const advanced = advanceAISlide({
            distanceTraveled: slideDistanceTraveled,
            slideSpeed,
            dt,
            maxSlideDistance: s.settings.slideDistance ?? 8.0,
          });
          slideDistanceTraveled = advanced.distanceTraveled;
          // End the slide if it is exhausted, the toggle was turned off, or we have
          // closed into engage range.
          if (advanced.finished || !s.settings.enableSlide || distanceToTarget <= (resolvedDangerZone + 1.5)) {
            slideActive = false;
            slideCooldownTimer = s.settings.slideCooldown ?? 1.5;
          }
        } else {
          vel.copy(spatialLookHeading).multiplyScalar(4.0 * (s.settings.speedForward / 100) * spatialBias.aggressionMult * sprintMult);
          if (totalApproachLateral !== 0) {
            vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.9);
          }
          pos.addScaledVector(vel, dt);
        }

        if (!slideActive && distanceToTarget <= (resolvedDangerZone + 3.2)) {
          state = 'SIDE_STEPPING';
          timer = Math.random() * 0.7 + 0.3;
        }
      }
      else if (state === 'SIDE_STEPPING') {
        const dir = Math.sin(swayTimer * 2.2) > 0 ? 1 : -1;
        vel.copy(sidewayHeading).multiplyScalar(3.2 * (s.settings.speedSide / 100) * dir);
        
        // Hold inside our own weapon's hit range, not just outside the enemy danger
        // zone. With a hammer, resolvedDangerZone + 1.2 (~8.6m default) sits *beyond*
        // the hammer's own ~7m sphere reach, so two hammer bots would otherwise park
        // where neither can land a blow and circle forever. Capping to just inside
        // guaranteedKillRange makes them close until a swing actually connects.
        const desiredDist = activeWeapon === 'sword'
          ? (maxLungeRange * 0.7)
          : Math.min(resolvedDangerZone + 1.2, guaranteedKillRange - 0.6);
        const approachBias = distanceToTarget > desiredDist ? 0.35 : -0.45;
        const approachSpeed = approachBias * 1.5 * (approachBias > 0 ? (s.settings.speedForward / 100) : (s.settings.speedBackward / 100));
        const approachAggression = approachBias > 0 ? spatialBias.aggressionMult : 1;
        vel.addScaledVector(spatialLookHeading, approachSpeed * approachAggression);
        if (totalApproachLateral !== 0) {
          vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.35);
        }
        
        if (isCrouching) {
          vel.multiplyScalar(0.45);
        }
        pos.addScaledVector(vel, dt);

        if (dashCooldownTimer <= 0 && distanceToTarget < (resolvedDangerZone + 2.0) && Math.random() < 0.015 && (movementComplexity >= 40)) {
          const sideDir = Math.random() > 0.5 ? 1 : -1;
          dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
          dashRemaining = s.settings.dashDuration || 0.25;
          dashCooldownTimer = s.settings.dashCooldown || 2.0;
          sfx.playDash();
        }

        if (target.weaponState === 'swing_up' && !targetIsProtected) {
          const reactChance = 0.45 + (tunedAnticipationFactor * 0.4);
          
          const myHP = self.hp;
          const targetHP = target.hp;
          const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
            difficulty,
            playstyleFactor,
            botHP: myHP,
            targetHP,
            multipliers: matchMultipliers,
          });

          if (shouldAvoidTrade || Math.random() < reactChance) {
            state = 'DANCING_BACKWARD';
            timer = effectiveReactionLatency + 0.35;

            if (dashCooldownTimer <= 0) {
              dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
              dashRemaining = s.settings.dashDuration || 0.25;
              dashCooldownTimer = s.settings.dashCooldown || 2.0;
              sfx.playDash();
            }
          }
        }

        if (targetIsProtected) {
          state = 'DANCING_BACKWARD';
          timer = 0.5;
        }

        if (timer <= 0) {
          const forceStandoffCommit = psychEnabled && shouldForceStandoffCommit(
            psychState.standoffTimer,
            playstyleFactor,
            matchMultipliers,
            Math.random()
          );
          if (forceStandoffCommit && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
            state = 'CHARGE_ATTACK';
            psychState.standoffTimer = 0;
          } else if (attackDistanceToTarget <= (resolvedAiReach + 0.5) && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
            state = 'CHARGE_ATTACK';
          } else {
            state = 'DANCING_FORWARD';
            timer = Math.random() * 0.5 + 0.25;
          }
        }
      } 
      else if (state === 'DANCING_FORWARD') {
        const approachFeintWindow = getApproachFeintWindow({
          timerRemaining: timer,
          targetProtected: targetIsProtected,
          feintEligible: feintChance > 0,
        });
        if (approachFeintWindow !== null && tryFeintRoll(approachFeintWindow)) {
          state = 'DANCING_BACKWARD';
          timer = APPROACH_FEINT_BACK_TIMER;
          commitFeint();
          vel.copy(lookHeading).multiplyScalar(-6.2 * (s.settings.speedBackward / 100));
          pos.addScaledVector(vel, dt);
        } else {
        const forwardSpeed = feintLungeFakeout ? 6.2 : 5.0;
        vel.copy(lookHeading).multiplyScalar(forwardSpeed * (s.settings.speedForward / 100) * sprintMult);
        if (totalApproachLateral !== 0) {
          vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.5);
        }
        pos.addScaledVector(vel, dt);

        if (target.weaponState === 'swing_up' && !targetIsProtected) {
          state = 'DANCING_BACKWARD';
          timer = 0.65;
          if (dashCooldownTimer <= 0 && Math.random() < 0.7) {
            dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }
        } else if (attackDistanceToTarget <= resolvedAiReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
          state = 'CHARGE_ATTACK';
        }

        if (targetIsProtected) {
          state = 'DANCING_BACKWARD';
          timer = 0.5;
        }

        if (timer <= 0) {
          state = 'SIDE_STEPPING';
          timer = Math.random() * 0.7 + 0.3;
        }
        }
      } 
      else if (state === 'DANCING_BACKWARD') {
        vel.copy(lookHeading).multiplyScalar(-6.2 * (s.settings.speedBackward / 100));
        pos.addScaledVector(vel, dt);

        if (target.weaponState === 'recovering' && attackDistanceToTarget <= (resolvedAiReach + 2.5) && !targetIsProtected) {
          state = 'CHARGE_ATTACK';
        }

        if (timer <= 0) {
          state = 'SIDE_STEPPING';
          timer = 0.4;
        }
      } 
      else if (state === 'CHARGE_ATTACK') {
        if (
          canAttemptChargeAbortFeint({
            targetWeaponState: target.weaponState,
            dashCooldownRemaining: dashCooldownTimer,
            targetProtected: targetIsProtected,
            feintEligible: feintChance > 0,
          }) &&
          tryFeintRoll(0.7)
        ) {
          const sideDir = Math.random() > 0.5 ? 1 : -1;
          dashDir.copy(sidewayHeading).multiplyScalar(sideDir).normalize();
          dashRemaining = s.settings.dashDuration || 0.25;
          dashCooldownTimer = s.settings.dashCooldown || 2.0;
          sfx.playDash();
          state = 'SIDE_STEPPING';
          timer = CHARGE_ABORT_SIDESTEP_TIMER;
          commitFeint();
        } else {
        if (dashCooldownTimer <= 0 && (movementComplexity >= 40) && !targetIsProtected) {
          dashDir.copy(lookHeading).normalize();
          dashRemaining = s.settings.dashDuration || 0.25;
          dashCooldownTimer = s.settings.dashCooldown || 2.0;
          sfx.playDash();
        }

        vel.copy(lookHeading).multiplyScalar(6.5 * (s.settings.speedForward / 100));
        pos.addScaledVector(vel, dt);

        if (attackDistanceToTarget <= stationarySwingReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
          if (isCoordAttackBlocked()) {
            state = 'SIDE_STEPPING';
            timer = 0.25;
          } else {
          const myHP = self.hp;
          const targetHP = target.hp;
          const shouldAvoidTrade = shouldAvoidCoinFlipTrade({
            difficulty,
            playstyleFactor,
            botHP: myHP,
            targetHP,
            multipliers: matchMultipliers,
            requireTargetOnCooldown: true,
            targetOnCooldown: isTargetOnCooldown(target),
          });
          const targetIsSwinging = target.weaponState === 'swing_up' || target.weaponState === 'swing_down';

          if (shouldAvoidTrade && targetIsSwinging) {
            state = 'DANCING_BACKWARD';
            timer = 0.6;
            if (dashCooldownTimer <= 0) {
              dashDir.copy(lookHeading).multiplyScalar(-1).normalize();
              dashRemaining = s.settings.dashDuration || 0.25;
              dashCooldownTimer = s.settings.dashCooldown || 2.0;
              sfx.playDash();
            }
          } else {
            state = 'COOLDOWN';
            timer = weaponReloadTime(activeWeapon) * cooldownMult;
            triggerCombatantAttack(self, activeWeapon);
          }
          }
        } else if (attackDistanceToTarget > (resolvedAiReach + 2.0) || targetIsProtected) {
          state = 'SIDE_STEPPING';
          timer = 0.4;
        }
        }
      }
      else if (state === 'PRESSURING') {
        const maxPressureRange = getPressureMaxRange(resolvedAiReach, maxLungeRange);
        const targetMatchesLock = !pressureTargetId || target.id === pressureTargetId;

        if (shouldExitPressure({
          targetHp: target.hp,
          targetInvuln: target.invulnerabilityTimer,
          distanceToTarget: attackDistanceToTarget,
          maxPressureRange,
          timerRemaining: timer,
          targetMatchesLock,
        })) {
          state = 'SIDE_STEPPING';
          timer = 0.35;
          clearPressureTarget(botId);
        } else {
          const pressureSpeed = getPressureApproachSpeed(effectivePressureAggression);
          const approachScale = weaponState === 'ready' ? 1 : 0.55;
          vel.copy(lookHeading).multiplyScalar(pressureSpeed * approachScale * (s.settings.speedForward / 100) * sprintMult);
          if (totalApproachLateral !== 0 && weaponState === 'ready') {
            vel.addScaledVector(sidewayHeading, totalApproachLateral * 0.4);
          }
          pos.addScaledVector(vel, dt);

          if (dashCooldownTimer <= 0 && attackDistanceToTarget > resolvedAiReach + 0.8 && Math.random() < 0.06 * playstyleFactor) {
            dashDir.copy(lookHeading).normalize();
            dashRemaining = s.settings.dashDuration || 0.25;
            dashCooldownTimer = s.settings.dashCooldown || 2.0;
            sfx.playDash();
          }

          const pressureAttack = {
            activeWeapon,
            distanceToTarget: attackDistanceToTarget,
            // Sword re-swings only at its true slash reach; out of range it relies on the
            // lunge path (shouldPressurePreferLunge) to close, not a stationary bluff slash.
            aiReach: stationarySwingReach,
            minLungeRange,
            maxLungeRange,
            weaponReady: weaponState === 'ready',
            targetProtected: targetIsProtected,
          };

          if (canStartWeaponAction && shouldPressureReSwing(pressureAttack) && !isCoordAttackBlocked()) {
            // Pressure re-swings reload at the configured rate — pressure aggression
            // no longer shortens reload below the player's mechanic settings.
            const baseCooldown = weaponReloadTime(activeWeapon);
            timer = Math.max(timer, baseCooldown);
            triggerCombatantAttack(self, activeWeapon);
            weaponState = 'swing_up';
          }
        }
      }
      else if (state === 'COOLDOWN') {
        vel.copy(lookHeading).multiplyScalar(-1.5 * (s.settings.speedBackward / 100));
        if (isCrouching) {
          vel.multiplyScalar(0.45);
        }
        pos.addScaledVector(vel, dt);

        if (timer <= 0) {
          state = 'SIDE_STEPPING';
          timer = 0.7;
        }
      }

      // Restore vertical velocity after FSM horizontal movement calculations
      vel.y = savedVelY;
    }

    constrainCombatantToArena(pos, vel);

    // Unified vertical handling for every combatant: while airborne we keep the
    // integrated vel.y; once grounded (and not lunging) we zero it and clear the jump
    // flag. (For the main AI vel === mai()!.vel, so this is the same data either way.)
    if (state !== 'LUNGING' && !(self.isJumping || pos.y > 0.01)) {
      vel.y = 0;
      self.isJumping = false;
    }

    const isAirborne = self.isJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01;

    if (isAirborne && state !== 'LUNGING') {
      // Heavily restrict horizontal movement in the air so they don't "walk across the air"
      vel.x *= 0.05;
      vel.z *= 0.05;
    }

    syncStateAndMesh();
  };
  };

  // ENEMY AI PATHFINDING & FENCING STRATEGY


  // PROCEDURAL SKELETAL JOINTS ANIMATIONS (Torso Twist, Walk Jog Leg/Foot Swing, Spine Bend)



  // TICK EXPLOSION VOXEL PARTICLES (Gravity, Physics translation and sizing decay)

  // TICK GAME CLOCK TIMERS

  // RENDER STEP

  // PROPAGATE STATS UPDATE BACK TO CENTRAL HUD CORES


  // Direct high-performance HUD Radar Syncing method

  return (
    <div className="absolute inset-0 z-0 w-full h-full" style={{ outline: 'none' }}>
      {/* Floating Nameplate Overlays Container */}
      <div 
        ref={nameplateContainerRef}
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />

      {/* 3D Render Canvas container */}
      <div 
        ref={containerRef} 
        id="canvas-viewport" 
        className="w-full h-full cursor-crosshair selection:bg-transparent"
        style={{ outline: 'none' }}
      >
        <canvas ref={canvasRef} id="game-canvas" />
      </div>

      {/* Dynamic Instruction Overlay when Pointer Lock is not active */}
      {showPointerLockAlert && isPlaying && !isPaused && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none pointer-events-none transition-all duration-300">
          <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center max-w-sm shadow-2xl">
            <h4 className="text-xl font-display font-black tracking-widest text-blue-400 uppercase mb-2">
              CLICK TO LOCK CURSOR
            </h4>
            <p className="text-sm font-sans text-white/70 leading-relaxed mb-4 leading-relaxed">
              Ensure you lock your pointer to look around in first-person like standard Grifball!
            </p>
            <div className="inline-flex gap-2 text-[10px] font-mono text-white/50 uppercase border border-white/10 px-3 py-1 rounded bg-white/5">
              <span>LMB to Attack</span>
              <span>•</span>
              <span>Mouse Look</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
