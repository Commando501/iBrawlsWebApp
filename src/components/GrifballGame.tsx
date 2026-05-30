/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { buildGravityHammerModel, buildVoxelSpartanModel, buildKatarSwordModel, buildPistolModel } from './VoxelModels';
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
  clearBotEngagements,
  getAttackPhaseIndex,
  getCoordinatedTargetBonus,
  getEngagingBotIds,
  getPincerApproachOffset,
  notifyBotDamageTag,
  registerBotEngagement,
  shouldDeferCoordinatedAttack,
  shouldPunisherHold,
  tickBotCoordinator,
} from '../game/aiBotCoordinator';
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
import { applyPersonalityKnobs, getPersonalityFlags, resolveDerivedAIParams, getArchetypeDef } from '../game/aiPersonalities';
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
  getPressureAttackCooldown,
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameplateRef = useRef<HTMLDivElement>(null);

  const getActiveCustomMap = (): CustomMapData | null => {
    if (customMap) return customMap;
    if (selectedMap !== 'hangar' && selectedMap !== 'circle') {
      const premade = PREMADE_MAPS.find(m => m.id === selectedMap);
      if (premade) return premade;
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(`map_${selectedMap}`);
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
  // Persistent Combatant view over the main AI's flat s.aiXxx state. Created once
  // (see getMainAICombatant) so the main AI is a single, durable Combatant object —
  // the same shape as the bots — rather than an adapter rebuilt every frame. This is
  // the object that will eventually live in the otherPlayers map alongside the bots.
  const mainAICombatantRef = useRef<Combatant | null>(null);
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

    aiDashRemaining: number;
    aiDashDir: THREE.Vector3;
    aiDashCooldownTimer: number;

    // AI slide/sprint states
    aiSlideActive: boolean;
    aiSlideDistanceTraveled: number;
    aiSlideCooldownTimer: number;
    aiIsSprinting: boolean;

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
    lastAISwordAttackTime: number;
    lastPlayerHammerAttackTime: number;
    lastAIHammerAttackTime: number;
    swapCooldownTimer: number;
    swapCooldownDuration: number;
    aiSwapCooldownTimer: number;
    swapLockoutTimer: number;
    aiSwapLockoutTimer: number;

    // AI states
    aiPos: THREE.Vector3;
    aiVel: THREE.Vector3;
    aiYaw: number;
    aiHP: number;
    aiMaxHP: number;
    aiState: AIBehaviorState;
    aiTimer: number; // for fencing actions
    aiSwayTimer: number;
    aiWeaponState: WeaponState;
    aiWeaponTimer: number;
    aiIsCrouching: boolean;
    aiActiveWeapon: 'hammer' | 'sword';
    aiSwordState: 'ready' | 'slashing' | 'recovering';
    aiSwordTimer: number;
    aiSwordReady: boolean;
    aiIsLunging: boolean;
    aiLungeTimer: number;
    aiLungeStartPos: THREE.Vector3;
    aiLungeTargetDir: THREE.Vector3;
    aiLastLungeOutcome?: AILungeOutcome;
    aiLastLungeTargetId?: string;
    aiPostLungeDecisionTimer?: number;
    aiPendingPostEvasionCharge?: boolean;
    aiPressureTargetId?: string;

    // Player stats
    playerHP: number;
    playerMaxHP: number;
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
    aiInvulnerabilityTimer: number;
    playerSpawnTime: number;
    aiSpawnTime: number;
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
    aiHammerJumpWindowTimer: number;
    aiIsJumping: boolean;
    aiHammerJumpPlanned: boolean;
    aiHammerJumpType?: 'offensive' | 'defensive';
    aiHammerJumpCooldownTimer: number;

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

    aiDashRemaining: 0,
    aiDashDir: new THREE.Vector3(0, 0, 0),
    aiDashCooldownTimer: 0,

    aiSlideActive: false,
    aiSlideDistanceTraveled: 0,
    aiSlideCooldownTimer: 0,
    aiIsSprinting: false,

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
    lastAISwordAttackTime: 0,
    lastPlayerHammerAttackTime: 0,
    lastAIHammerAttackTime: 0,
    swapCooldownTimer: 0,
    swapCooldownDuration: 0,
    aiSwapCooldownTimer: 0,
    swapLockoutTimer: 0,
    aiSwapLockoutTimer: 0,

    aiPos: new THREE.Vector3(0, 0, -12), // Start opposite side
    aiVel: new THREE.Vector3(0, 0, 0),
    aiYaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, -12)),
    aiHP: 1,
    aiMaxHP: 1,
    aiState: 'APPROACHING',
    aiTimer: 0,
    aiSwayTimer: 0,
    aiWeaponState: 'ready',
    aiWeaponTimer: 0,
    aiIsCrouching: false,
    aiActiveWeapon: 'hammer',
    aiSwordState: 'ready',
    aiSwordTimer: 0,
    aiSwordReady: true,
    aiIsLunging: false,
    aiLungeTimer: 0,
    aiLungeStartPos: new THREE.Vector3(),
    aiLungeTargetDir: new THREE.Vector3(),
    aiLastLungeOutcome: undefined,
    aiLastLungeTargetId: undefined,
    aiPostLungeDecisionTimer: 0,
    aiPendingPostEvasionCharge: false,
    aiPressureTargetId: undefined,

    playerHP: 1,
    playerMaxHP: 1,
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
    aiInvulnerabilityTimer: 0,
    playerSpawnTime: Date.now(),
    aiSpawnTime: Date.now(),
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
    aiHammerJumpWindowTimer: 0,
    aiIsJumping: false,
    aiHammerJumpPlanned: false,
    aiHammerJumpCooldownTimer: 0,

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
        } else if (pos === s.aiPos) {
          s.aiIsJumping = false;
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

    // 2. Main AI
    const mainAIDead = s.aiHP <= 0 || s.aiState === 'RESPAWNING';
    if (!mainAIDead && !s.isMultiplayer) {
      colliders.push({
        id: 'main_ai',
        pos: s.aiPos,
        vel: s.aiVel,
        isCrouching: !!s.aiIsCrouching,
      });
    }

    // 3. Other players/bots
    if (s.otherPlayers) {
      s.otherPlayers.forEach((bot, id) => {
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

    constrainCombatantToArena(s.aiPos, s.aiVel);
    constrainCombatantToArena(s.hostPos, s.hostVel);
    constrainCombatantToArena(s.clientPos, s.clientVel);

    s.otherPlayers?.forEach((other) => {
      if (other.pos && other.vel) {
        constrainCombatantToArena(other.pos, other.vel);
      }
    });

    // Proactively synchronize group positions to visual meshes immediately to eliminate visual rendering lag
    if (threeRef.current.enemyGroup && !s.isMultiplayer) {
      threeRef.current.enemyGroup.position.copy(s.aiPos);
    }
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
        if (threeRef.current.enemyGroup) threeRef.current.enemyGroup.position.copy(s.aiPos);
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
    if (recovered && self.id === 'main_ai') {
      const s = stateRef.current;
      self.isJumping = true;
      s.aiHammerJumpPlanned = false;
      s.aiHammerJumpType = undefined;
      s.aiHammerJumpWindowTimer = 0;
    }
    return recovered;
  };

  const resolveBotArchetype = (botId: string): string | undefined => {
    if (botId === 'main_ai') {
      const archetype = stateRef.current.settings.aiArchetype;
      if (archetype && archetype !== 'none') return archetype;
    }
    const archetype = botArchetypes?.[botId];
    return archetype && archetype !== 'none' ? archetype : undefined;
  };

  const resolveBotKnobs = (botId: string) => {
    const s = stateRef.current;
    const difficulty = botId === 'main_ai'
      ? (s.settings.aiDifficulty || 'normal')
      : (botDifficulties[botId] || 'normal');

    let reactionLatency = 0.25;
    let anticipationFactor = 0.40;
    let movementComplexity = 50;
    let weaponSwapIQ = 50;
    let aiPlaystyle = 50;
    let weaponPrioritization = 50;

    if (difficulty === 'custom') {
      // Read the live settings off stateRef (kept in sync via the [adminSettings]
      // effect) rather than the captured `adminSettings` prop. The animation loop
      // only re-captures this closure when isPlaying/isPaused/multiplayer change,
      // so reading the prop here leaves stale knob values (e.g. Weapon
      // Prioritization) that ignore slider edits made after the loop started.
      reactionLatency = s.settings.aiReactionLatency ?? 0.25;
      anticipationFactor = s.settings.aiAnticipationFactor ?? 0.40;
      movementComplexity = s.settings.aiMovementComplexity ?? 50;
      weaponSwapIQ = s.settings.aiWeaponSwapIQ ?? 50;
      aiPlaystyle = s.settings.aiPlaystyle ?? 50;
      weaponPrioritization = s.settings.aiWeaponPrioritization ?? 50;
    } else if (['easy', 'normal', 'hard', 'nightmare'].includes(difficulty)) {
      if (difficulty === 'easy') {
        reactionLatency = 0.55;
        anticipationFactor = 0.05;
        movementComplexity = 15;
        weaponSwapIQ = 10;
      } else if (difficulty === 'normal') {
        reactionLatency = 0.25;
        anticipationFactor = 0.40;
        movementComplexity = 50;
        weaponSwapIQ = 50;
      } else if (difficulty === 'hard') {
        reactionLatency = 0.12;
        anticipationFactor = 0.70;
        movementComplexity = 80;
        weaponSwapIQ = 80;
      } else if (difficulty === 'nightmare') {
        reactionLatency = 0.02;
        anticipationFactor = 0.95;
        movementComplexity = 95;
        weaponSwapIQ = 95;
      }

      const botArchetype = resolveBotArchetype(botId);
      if (botArchetype) {
        aiPlaystyle = 50;
        weaponPrioritization = 50;
      } else {
        const behavior = botBehaviors[botId] || 'defensive';
        if (behavior === 'passive') aiPlaystyle = 0;
        else if (behavior === 'defensive') aiPlaystyle = 50;
        else if (behavior === 'aggressive') aiPlaystyle = 100;

        const wBehavior = botWeaponBehaviors?.[botId] || 'balanced';
        if (wBehavior === 'sword_75_25') {
          weaponPrioritization = 75;
        } else if (wBehavior === 'hammer_75_25') {
          weaponPrioritization = 25;
        } else {
          weaponPrioritization = 50;
        }
      }
    } else {
      const preset = aiPresets.find(p => p.id === difficulty);
      if (preset) {
        reactionLatency = preset.tuning.aiReactionLatency ?? 0.25;
        anticipationFactor = preset.tuning.aiAnticipationFactor ?? 0.40;
        movementComplexity = preset.tuning.aiMovementComplexity ?? 50;
        weaponSwapIQ = preset.tuning.aiWeaponSwapIQ ?? 50;
        aiPlaystyle = preset.tuning.aiPlaystyle ?? 50;
        weaponPrioritization = preset.tuning.aiWeaponPrioritization ?? 50;
      }
    }

    const baseKnobs = {
      difficulty,
      reactionLatency,
      anticipationFactor,
      movementComplexity,
      weaponSwapIQ,
      aiPlaystyle,
      weaponPrioritization,
    };

    // In custom mode the explicit slider values are authoritative. Selecting an
    // archetype already bakes its knobs into the sliders (applyArchetypeToSettings),
    // so re-applying them here would silently override manual edits made afterward
    // (e.g. dragging Weapon Prioritization to 0 after picking a sword-heavy archetype).
    if (difficulty === 'custom') {
      return baseKnobs;
    }

    return applyPersonalityKnobs(baseKnobs, resolveBotArchetype(botId));
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
    const s = stateRef.current;
    const knobs = resolveBotKnobs(botId);
    const baseAggression = resolveDerivedAIParams(
      s.settings,
      knobs,
      resolveBotArchetype(botId)
    ).pressureAggression;
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
    const personalityFlags = getPersonalityFlags(resolveBotArchetype(botId));
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
    if (botId === 'main_ai') {
      s.aiState = 'PRESSURING';
      s.aiTimer = duration;
      s.aiPressureTargetId = targetId;
    } else {
      const bot = s.otherPlayers?.get(botId);
      if (!bot) return false;
      bot.aiState = 'PRESSURING';
      bot.aiTimer = duration;
      bot.aiPressureTargetId = targetId;
    }
    return true;
  };

  const clearPressureTarget = (botId: string) => {
    const s = stateRef.current;
    if (botId === 'main_ai') {
      s.aiPressureTargetId = undefined;
    } else {
      const bot = s.otherPlayers?.get(botId);
      if (bot) bot.aiPressureTargetId = undefined;
    }
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

    const botPos = botId === 'main_ai'
      ? s.aiPos
      : (() => {
          const bot = s.otherPlayers?.get(botId);
          return bot ? new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z) : null;
        })();
    if (!botPos) {
      return;
    }

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
    if (s.aiHP > 0 && victimId !== 'main_ai') {
      exclude.push(s.aiPos);
    }
    s.otherPlayers?.forEach((other) => {
      if (other.id !== victimId && other.hp > 0 && other.respawnTimer <= 0) {
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
    if (botId === 'main_ai') {
      clearPressureTarget(botId);
    } else {
      const bot = s.otherPlayers?.get(botId);
      if (bot) {
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
    const enemyMesh = threeRef.current.enemyGroup;

    if (!enemyMesh) return;

    if (isMultiplayer) {
      enemyMesh.visible = false;
      return;
    }

    tickBotCoordinator(s.aiMatchContext.coordinator, dt);
    clearBotEngagements(s.aiMatchContext.coordinator);

    // Respawn handling for every AI combatant (main AI + bots) in one loop. Dead
    // combatants hide their mesh and tick their respawn timer; on expiry they respawn
    // via respawnCombatant. (Death itself sets respawnTimer — for the main AI that's
    // enemyRespawnTimer via the bridge — so the countdown starts the frame after a kill.)
    getAllCombatants().forEach((c) => {
      const isMain = c.id === 'main_ai';
      if (!isMain && !c.id.startsWith('bot_')) return;
      const mesh = getCombatantMesh(c.id);
      if (!mesh) return;
      if (c.hp > 0) return;
      mesh.visible = false;
      c.respawnTimer = Math.max(0, (c.respawnTimer ?? 0) - dt);
      if (c.respawnTimer <= 0) {
        respawnCombatant(c, mesh);
      }
    });

    // Unified update dispatch: tick every alive AI combatant (main AI + bots) through
    // the same updateSingleAIEntity path, in one loop over getAllCombatants(). The
    // main AI is ticked first (it's pushed first). Dead combatants were handled above.
    getAllCombatants().forEach((c) => {
      if (c.id !== 'main_ai' && !c.id.startsWith('bot_')) return;
      const mesh = getCombatantMesh(c.id);
      if (!mesh) return;
      if (c.hp <= 0) return;
      mesh.visible = true;
      updateSingleAIEntity(c.id, dt);
    });
  };

  function updateCharacterSkeletalAnimations(dt: number) {
    const s = stateRef.current;

    if (s.isObserverMode) {
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
        const enemyVel = multiplayerRole === 'observer' ? s.clientVel : s.aiVel;
        const enemySpeed = enemyVel.length();
        const isClientSprinting = s.settings.enableSprint && (multiplayerRole === 'observer' ? enemySpeed > 6.0 : s.aiState === 'APPROACHING' && enemySpeed > 4.5 && !s.aiIsCrouching);
        const isClientSliding = s.settings.enableSlide && (multiplayerRole === 'observer' ? enemySpeed > 3.0 && clientData.isCrouching : s.aiIsCrouching && s.aiState === 'APPROACHING' && enemySpeed > 2.0);

        animateSpartanModel(
          threeRef.current.enemyGroup,
          enemyVel,
          clientData.yaw,
          clientData.hp,
          (multiplayerRole === 'observer' && s.clientActiveWeapon === 'sword') ? 'ready' : s.aiWeaponState,
          (multiplayerRole === 'observer') ? 0 : s.aiWeaponTimer,
          dt,
          isClientSliding,
          isClientSprinting
        );
      }
    } else {
      // Standard Player vs Bot animation — driven by the AI's real sprint/slide state.
      const isAiSprinting = s.settings.enableSprint && (s.aiIsSprinting ?? false);
      const isAiSliding = s.settings.enableSlide && (s.aiSlideActive ?? false);

      animateSpartanModel(
        threeRef.current.enemyGroup,
        s.aiVel,
        s.aiYaw,
        s.aiHP,
        s.aiWeaponState,
        s.aiWeaponTimer,
        dt,
        isAiSliding,
        isAiSprinting
      );
    }

    // Animate custom other players / bots
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

          if (wState === 'swing_up') {
            wTimer += dt;
            if (wTimer >= 0.15) {
              wState = 'swing_down';
              wTimer = 0;
            }
          } else if (wState === 'swing_down') {
            wTimer += dt;
            if (wTimer >= 0.15) {
              wState = 'recovering';
              wTimer = 0;
              // Strike apex: resolve this bot's hammer/slash damage sphere. Without
              // this a DoomBot's swing is animation-only and deals no damage.
              applyBotMeleeImpact(clientId);
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
            if (wTimer >= 0.3) {
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
    if (s.aiHammerJumpWindowTimer > 0) s.aiHammerJumpWindowTimer = Math.max(0, s.aiHammerJumpWindowTimer - dt);

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

    updateBlinking(threeRef.current.enemyGroup, s.aiInvulnerabilityTimer > 0);
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
    if (s.isObserverMode) {
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
    } else {
      if (threeRef.current.enemyGroup) {
        threeRef.current.enemyGroup.visible = !isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING';
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

    renderer.render(scene, camera);
  };

  function pushStatsUpdate() {
    const s = stateRef.current;

    // Translate stance string for HUD feedback
    let computedStance: Stance = 'STANDING';
    if (s.isJumping) computedStance = 'JUMPING';
    else if (s.isCrouching) computedStance = 'CROUCHING';

    onStatsUpdateRef.current({
      playerHP: s.playerHP,
      playerMaxHP: s.playerMaxHP,
      enemyHP: s.aiHP,
      enemyMaxHP: s.aiMaxHP,
      scorePlayer: s.scorePlayer,
      scoreEnemy: s.scoreEnemy,
      otherPlayers: s.otherPlayers ? Array.from(s.otherPlayers.values()).map((p: any) => ({
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
      enemyRespawnTimer: s.aiHP <= 0 ? s.enemyRespawnTimer : 0,
      playerDashCooldownTimer: s.playerDashCooldownTimer,
      playerDashReady: s.playerDashCooldownTimer <= 0 && s.playerDashRemaining <= 0,
      settings: s.settings, // Propagate the current admin settings to HUD
      lastDeaths: [...s.lastDeaths],
      playerX: s.playerPos.x,
      playerZ: s.playerPos.z,
      playerYaw: s.yaw,
      enemyX: s.aiPos.x,
      enemyZ: s.aiPos.z,
      enemyYaw: s.aiYaw,
      enemyIsCrouching: s.aiIsCrouching,
      playerIsCrouchMoving: s.isCrouching && s.playerVel.length() > 0.15,
      enemyIsCrouchMoving: s.aiIsCrouching && s.aiVel.length() > 0.15,
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
      opponentPlayerName: opponentNameRef.current || undefined,
      activeMedalPopup: s.activeMedalPopup,
    });
  };

  function updateFloatingNameplate() {
    const s = stateRef.current;
    const camera = threeRef.current.camera;
    const container = containerRef.current;
    const nameplate = nameplateRef.current;

    if (!s || !camera || !container || !nameplate) return;

    let showNameplate = false;
    const nameplateScreenPos = { x: 0, y: 0 };

    let enemyPos = s.aiPos;
    let enemyHP = s.aiHP;
    let enemyCrouching = s.aiIsCrouching;
    let enemyState = s.aiState;
    let enemyName = opponentPlayerName || opponentNameRef.current || 'AI Bot';

    if (isMultiplayer) {
      // In multiplayer, track the actual remote opponent spartan
      const remotePlayer = s.otherPlayers.get(opponentClientId) || Array.from(s.otherPlayers.values())[0];
      if (remotePlayer) {
        enemyPos = remotePlayer.pos;
        enemyHP = remotePlayer.hp;
        enemyCrouching = remotePlayer.isCrouching;
        enemyState = remotePlayer.respawnTimer > 0 ? 'RESPAWNING' : 'ALIVE';
        enemyName = remotePlayer.playerName || opponentNameRef.current || 'Opponent';
      }
    }

    if (s.playerHP > 0 && enemyHP > 0 && enemyState !== 'RESPAWNING') {
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      const enemyCenter = new THREE.Vector3(enemyPos.x, enemyPos.y + 0.825, enemyPos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();
      
      const appDist = s.settings.nameVisibilityDistance !== undefined ? s.settings.nameVisibilityDistance : 15.0;
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
          showNameplate = true;
          
          // Calculate projected 2D coordinates
          const headPos = new THREE.Vector3(enemyPos.x, enemyPos.y + 1.75, enemyPos.z);
          headPos.project(camera);
          
          // Check if in front of camera
          if (headPos.z <= 1) {
            const widthHalf = container.clientWidth / 2;
            const heightHalf = container.clientHeight / 2;
            nameplateScreenPos.x = (headPos.x * widthHalf) + widthHalf;
            nameplateScreenPos.y = -(headPos.y * heightHalf) + heightHalf;
          } else {
            showNameplate = false;
          }
        }
      }
    }

    if (showNameplate) {
      nameplate.style.display = 'block';
      nameplate.style.left = `${nameplateScreenPos.x}px`;
      nameplate.style.top = `${nameplateScreenPos.y}px`;
      nameplate.style.color = s.settings.nameVisibilityColor || '#00ffff';
      nameplate.style.opacity = (s.settings.nameVisibilityOpacity !== undefined ? s.settings.nameVisibilityOpacity : 0.8).toString();
      nameplate.style.fontSize = `${s.settings.nameVisibilityFontSize || 16}px`;
      nameplate.textContent = enemyName;
    } else {
      nameplate.style.display = 'none';
    }
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
        enemies.push({ id: 'main_ai', pos: s.aiPos, hp: s.aiHP, vel: s.aiVel, isCrouching: s.aiIsCrouching });
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
      if (multiplayerRole === 'client') {
        s.playerPos.set(0, 0, -12);
        s.yaw = getInwardSpawnYaw(s.playerPos);
        s.aiPos.set(0, 0, 12);
        s.aiYaw = getInwardSpawnYaw(s.aiPos);
      } else if (multiplayerRole === 'host') {
        s.playerPos.set(0, 0, 12);
        s.yaw = getInwardSpawnYaw(s.playerPos);
        s.aiPos.set(0, 0, -12);
        s.aiYaw = getInwardSpawnYaw(s.aiPos);
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

    s.aiMaxHP = adminSettings.maxHP;
    if (s.aiHP === prevMax) {
      s.aiHP = adminSettings.maxHP;
    } else {
      s.aiHP = Math.min(s.aiHP, adminSettings.maxHP);
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

  // Dynamically synchronize the offline bot count and difficulties mid-game
  useEffect(() => {
    if (isMultiplayer) return;
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene || !isPlaying) return;

    const targetCustomBotCount = Math.max(0, offlineBotCount - 1);
    
    // 1. Calculate how many custom bots are currently spawned
    let currentCustomBotCount = 0;
    s.otherPlayers.forEach((bot, id) => {
      if (id.startsWith('bot_')) {
        currentCustomBotCount++;
      }
    });

    const botHues = [120, 280, 45, 60, 320, 180];
    const botNames = ["DoomBot Green", "DoomBot Purple", "DoomBot Orange", "DoomBot Yellow", "DoomBot Magenta", "DoomBot Cyan"];

    // 2. If we need to ADD bots
    if (targetCustomBotCount > currentCustomBotCount) {
      const exclude: THREE.Vector3[] = [s.playerPos, s.aiPos];
      s.otherPlayers.forEach((bot) => {
        if (bot.hp > 0 && bot.respawnTimer <= 0) {
          exclude.push(new THREE.Vector3(bot.pos.x, bot.pos.y, bot.pos.z));
        }
      });

      for (let i = currentCustomBotCount; i < targetCustomBotCount; i++) {
        const botId = `bot_${i+2}`;
        const hue = botColors[botId] ?? botHues[i % botHues.length];
        const name = botNames[i % botNames.length];
        const diff = botDifficulties[botId] || 'normal';
        
        const spawnPos = getOptimalSpawnPoint(exclude);
        exclude.push(spawnPos);

        const newBotState = {
          id: botId,
          playerName: name,
          pos: spawnPos.clone(),
          vel: new THREE.Vector3(0, 0, 0),
          yaw: getInwardSpawnYaw(spawnPos),
          pitch: 0,
          hp: 1,
          maxHp: 1,
          isCrouching: false,
          activeWeapon: 'hammer' as const,
          respawnTimer: 0,
          hue: hue,
          difficulty: diff,
          score: 0,
          kills: 0,
          deaths: 0,
          aiHammerJumpCooldownTimer: 0,
          spawnTime: Date.now()
        };

        s.otherPlayers.set(botId, newBotState);

        // Build Three.js meshes immediately for the new bot
        createOrUpdateRemotePlayer(botId, newBotState);
        sfx.playRespawn();
      }
    } 
    // 3. If we need to REMOVE bots
    else if (targetCustomBotCount < currentCustomBotCount) {
      for (let i = currentCustomBotCount - 1; i >= targetCustomBotCount; i--) {
        const botId = `bot_${i+2}`;
        if (s.otherPlayers.has(botId)) {
          s.otherPlayers.delete(botId);
        }
        const meshes = threeRef.current.otherPlayerMeshes.get(botId);
        if (meshes) {
          if (meshes.group) scene.remove(meshes.group);
          threeRef.current.otherPlayerMeshes.delete(botId);
        }
      }
    }

    // 4. Update the difficulty level of all active bots reactively
    s.otherPlayers.forEach((bot, id) => {
      if (id.startsWith('bot_') || id === 'main_ai') {
        bot.difficulty = botDifficulties[id] || 'normal';
      }
    });

    // 5. Resize the arena for the new combatant count
    resizeArena(1 + offlineBotCount);
    pushStatsUpdate();

  }, [offlineBotCount, botDifficulties, isMultiplayer, isPlaying]);

  // Reactive effect: rebuild bot meshes when colors change while game is running
  useEffect(() => {
    if (isMultiplayer || !isPlaying) return;
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    // Rebuild custom bot (otherPlayers) meshes whose hue changed
    s.otherPlayers.forEach((bot, id) => {
      const newHue = botColors[id];
      if (newHue !== undefined && newHue !== bot.hue) {
        bot.hue = newHue;
        const oldMeshes = threeRef.current.otherPlayerMeshes.get(id);
        if (oldMeshes?.group) scene.remove(oldMeshes.group);
        threeRef.current.otherPlayerMeshes.delete(id);
        createOrUpdateRemotePlayer(id, bot);
      }
    });

    // Rebuild main AI mesh if its hue changed
    const mainAiHue = botColors['main_ai'];
    const oldEnemy = threeRef.current.enemyGroup;
    if (mainAiHue !== undefined && oldEnemy && oldEnemy.userData.appliedHue !== mainAiHue) {
      const pos = oldEnemy.position.clone();
      const visible = oldEnemy.visible;
      scene.remove(oldEnemy);

      const newEnemy = buildVoxelSpartanModel(true, mainAiHue);
      newEnemy.position.copy(pos);
      newEnemy.visible = visible;
      newEnemy.userData.appliedHue = mainAiHue;
      scene.add(newEnemy);
      threeRef.current.enemyGroup = newEnemy;

      const newHammer = buildGravityHammerModel(mainAiHue);
      newHammer.scale.set(0.6, 0.6, 0.6);
      newHammer.position.set(0.5, 1.0 - 0.64, -0.4);
      newHammer.rotation.set(Math.PI / 2, 0, 0);
      if (newEnemy.userData.upperTorso) {
        newEnemy.userData.upperTorso.add(newHammer);
      } else {
        newEnemy.add(newHammer);
      }
      threeRef.current.enemyHammer = newHammer;

      const prevSwordVisible = threeRef.current.enemySword?.visible ?? false;
      const newSword = buildKatarSwordModel(mainAiHue);
      newSword.scale.set(0.6, 0.6, 0.6);
      newSword.position.set(0.5, 1.0 - 0.64, -0.32);
      newSword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      newSword.visible = prevSwordVisible;
      if (newEnemy.userData.upperTorso) {
        newEnemy.userData.upperTorso.add(newSword);
      } else {
        newEnemy.add(newSword);
      }
      threeRef.current.enemySword = newSword;
    }
  }, [botColors, isPlaying, isMultiplayer]);

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
            pos: s.aiPos,
            yaw: s.aiYaw,
            pitch: s.aiPitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Red (Guest)',
            hp: s.aiHP,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: s.aiIsCrouching,
            activeWeapon: s.aiActiveWeapon
          };
        }
      } else if (multiplayerRole === 'client') {
        // Client playing or spectating
        if (target === 'host') {
          return {
            pos: s.aiPos,
            yaw: s.aiYaw,
            pitch: s.aiPitch || 0,
            name: opponentNameRef.current || opponentClientId || 'Blue (Host)',
            hp: s.aiHP,
            hue: lastOpponentHue.current ?? 200,
            isCrouching: s.aiIsCrouching,
            activeWeapon: s.aiActiveWeapon
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
          pos: s.aiPos,
          yaw: s.aiYaw,
          pitch: 0,
          name: 'AI Bot',
          hp: s.aiHP,
          hue: 0,
          isCrouching: s.aiIsCrouching,
          activeWeapon: s.aiActiveWeapon
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
    const enemyGroup = buildVoxelSpartanModel(isEnemyBot, hue);
    enemyGroup.position.copy(multiplayerRole === 'observer' ? s.clientPos : s.aiPos);
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
    
    const activeWeapon = (multiplayerRole === 'observer') ? s.clientActiveWeapon : s.aiActiveWeapon;
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
    const hostGroup = buildVoxelSpartanModel(false, hue);
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

  // Dynamically maintain multiple opponent Spartan models keyed by clientId/senderId
  const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
    const s = stateRef.current;
    const scene = threeRef.current.scene;
    if (!scene) return;

    let playerState = s.otherPlayers.get(clientId);
    if (!playerState) {
      const isHostPlayer = (s.multiplayerRole === 'client' && clientId === opponentClientId) || (s.multiplayerRole === 'observer' && data.role === 'host');
      const spawnZ = isHostPlayer ? 12 : -12;
      playerState = {
        id: clientId,
        playerName: data.playerName || `Player ${clientId.substring(0, 4)}`,
        pos: new THREE.Vector3(0, 0, spawnZ),
        vel: new THREE.Vector3(0, 0, 0),
        yaw: getInwardSpawnYaw(new THREE.Vector3(0, 0, spawnZ)),
        pitch: 0,
        hp: data.hp !== undefined ? data.hp : 1,
        maxHp: data.maxHp !== undefined ? data.maxHp : 1,
        isCrouching: data.isCrouching || false,
        activeWeapon: data.activeWeapon || 'hammer',
        respawnTimer: data.respawnTimer || 0,
        hue: data.hue !== undefined ? data.hue : Math.floor(Math.random() * 360),
        score: 0,
        kills: 0,
        deaths: 0,
        invulnerabilityTimer: data.invulnerabilityTimer !== undefined ? data.invulnerabilityTimer : s.settings.respawnInvulnerabilityDuration,
        lastSwordAttackTime: 0,
        lastHammerAttackTime: 0,
        spawnTime: Date.now()
      };
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
    if (!meshes) {
      const group = buildVoxelSpartanModel(false, playerState.hue);
      scene.add(group);

      const hammer = buildGravityHammerModel(playerState.hue);
      hammer.scale.set(0.6, 0.6, 0.6);
      hammer.position.set(0.5, 1.0 - 0.64, -0.4);
      hammer.rotation.set(Math.PI / 2, 0, 0);
      if (group.userData.upperTorso) {
        group.userData.upperTorso.add(hammer);
      } else {
        group.add(hammer);
      }

      const sword = buildKatarSwordModel(playerState.hue);
      sword.scale.set(0.6, 0.6, 0.6);
      sword.position.set(0.5, 1.0 - 0.64, -0.32);
      sword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      sword.visible = false;
      if (group.userData.upperTorso) {
        group.userData.upperTorso.add(sword);
      } else {
        group.add(sword);
      }

      const pistol = buildPistolModel(playerState.hue);
      pistol.scale.set(0.6, 0.6, 0.6);
      pistol.position.set(0.5, 1.0 - 0.64, -0.32);
      pistol.rotation.set(Math.PI / 2, 0, 0);
      pistol.visible = false;
      if (group.userData.upperTorso) {
        group.userData.upperTorso.add(pistol);
      } else {
        group.add(pistol);
      }

      meshes = { group, hammer, sword, pistol };
      threeRef.current.otherPlayerMeshes.set(clientId, meshes);
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
    const isHangar = selectedMap === 'hangar';

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
      }

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(4, 4); // tiled nicely
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
      const floorGeo = new THREE.CylinderGeometry(r, r, 0.2, 64);
      
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
      }

      const floorTexture = generateCustomTexture(floorTexType, '#0f172a');
      const floorMat = new THREE.MeshStandardMaterial({
        map: floorTexture,
        bumpMap: floorTexture,
        bumpScale: 0.02,
        roughness: 0.8,
        metalness: 0.5,
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

        const texture = generateCustomTexture(obj.texture, obj.color);
        const mat = new THREE.MeshStandardMaterial({
          map: texture,
          color: new THREE.Color(obj.color),
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
      const enemyGroup = buildVoxelSpartanModel(true, botColors['main_ai']);
      enemyGroup.position.copy(stateRef.current.aiPos);
      enemyGroup.userData.appliedHue = botColors['main_ai'];
      scene.add(enemyGroup);
      threeRef.current.enemyGroup = enemyGroup;

      if (isMultiplayer) {
        enemyGroup.visible = false; // Hide main singleplayer bot mesh in multiplayer
      } else {
        // In singleplayer, initialize additional custom AI bots and set positions based on offlineBotCount
        const s = stateRef.current;
        const botHues = [120, 280, 45, 60, 320, 180]; 
        const botNames = ["DoomBot Green", "DoomBot Purple", "DoomBot Orange", "DoomBot Yellow", "DoomBot Magenta", "DoomBot Cyan"];
        s.otherPlayers.clear();
        
        const customBotCount = Math.max(0, offlineBotCount - 1);
        for (let i = 0; i < customBotCount; i++) {
          const botId = `bot_${i+2}`;
          const name = botNames[i % botNames.length];
          const hue = botColors[botId] ?? botHues[i % botHues.length];
          const diff = botDifficulties[botId] || 'normal';

          s.otherPlayers.set(botId, {
            id: botId,
            playerName: name,
            pos: new THREE.Vector3(0, 0, 0),
            vel: new THREE.Vector3(0, 0, 0),
            yaw: 0,
            pitch: 0,
            hp: 1,
            maxHp: 1,
            isCrouching: false,
            activeWeapon: 'hammer',
            respawnTimer: 0,
            hue: hue,
            difficulty: diff,
            score: 0,
            kills: 0,
            deaths: 0,
            invulnerabilityTimer: s.settings.respawnInvulnerabilityDuration,
            aiHammerJumpCooldownTimer: 0,
            spawnTime: Date.now()
          });
        }

        // Safe minimax dynamic spawning at mount time
        s.playerPos.copy(getOptimalSpawnPoint([]));
        s.yaw = getInwardSpawnYaw(s.playerPos);
        
        const exclude: THREE.Vector3[] = [s.playerPos];
        s.aiPos.copy(getOptimalSpawnPoint(exclude));
        s.aiYaw = getInwardSpawnYaw(s.aiPos);
        exclude.push(s.aiPos);
        
        s.otherPlayers.forEach((bot) => {
          const spawnPos = getOptimalSpawnPoint(exclude);
          bot.pos.copy(spawnPos);
          bot.yaw = getInwardSpawnYaw(spawnPos);
          exclude.push(spawnPos);
        });

        // Build Three.js meshes for all bots now that positions are set
        s.otherPlayers.forEach((bot) => {
          createOrUpdateRemotePlayer(bot.id, bot);
        });

        // Resize arena dynamically for total player count
        resizeArena(1 + offlineBotCount);
      }

      // Enemy Weapon: Smaller gravity hammer held by Spartan
      const enemyHammer = buildGravityHammerModel();
      enemyHammer.scale.set(0.6, 0.6, 0.6); // Slightly smaller scale for ease
      enemyHammer.position.set(0.5, 1.0 - 0.64, -0.4); // Hold positioned (adjusted for upper body pivot)
      enemyHammer.rotation.set(Math.PI / 2, 0, 0); // forward weapon pose
      
      // Attach gravity hammer to the upper torso group so it rotates with chest aiming & swings
      if (enemyGroup.userData.upperTorso) {
        enemyGroup.userData.upperTorso.add(enemyHammer);
      } else {
        enemyGroup.add(enemyHammer);
      }
      threeRef.current.enemyHammer = enemyHammer;

      // Enemy Weapon: Smaller katar energy sword held by Spartan
      const enemySword = buildKatarSwordModel();
      enemySword.scale.set(0.6, 0.6, 0.6);
      enemySword.position.set(0.5, 1.0 - 0.64, -0.32);
      enemySword.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      enemySword.visible = false; // Starts with hammer
      if (enemyGroup.userData.upperTorso) {
        enemyGroup.userData.upperTorso.add(enemySword);
      } else {
        enemyGroup.add(enemySword);
      }
      threeRef.current.enemySword = enemySword;
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
            if (!isMultiplayer && s.aiHP > 0 && s.aiWeaponState === 'swing_up') {
              observePlayerReaction(model, s.aiWeaponTimer ?? 0);
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
  }, [isPlaying]);

  // Helper to reconstruct player state at any target frame index in replayData.frames (Delta Compression recovery)
  const getReconstructedState = (playerType: 'player' | 'main_ai' | string, frameIdx: number) => {
    if (!replayData) return null;
    const frames = replayData.frames;
    
    // Scan backwards from frameIdx to find the most recent frame containing the state for this playerType
    for (let i = frameIdx; i >= 0; i--) {
      const f = frames[i];
      if (playerType === 'player' && f.player) return f.player;
      if (playerType === 'main_ai' && f.ai) return f.ai;
      if (playerType !== 'player' && playerType !== 'main_ai' && f.otherPlayers) {
        const found = f.otherPlayers.find(p => p.id === playerType);
        if (found) return found;
      }
    }
    // Fallback to first frame if not found anywhere (should not happen)
    const f0 = frames[0];
    if (playerType === 'player') return f0.player;
    if (playerType === 'main_ai') return f0.ai;
    return f0.otherPlayers?.find(p => p.id === playerType) || null;
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

    // 2. Process Main AI Bot (only if not multiplayer)
    if (!isMultiplayer) {
      const aiState = {
        pos: { x: s.aiPos.x, y: s.aiPos.y, z: s.aiPos.z },
        vel: { x: s.aiVel.x, y: s.aiVel.y, z: s.aiVel.z },
        yaw: s.aiYaw,
        pitch: s.aiPitch || 0,
        hp: s.aiHP,
        isCrouching: s.aiIsCrouching,
        isLunging: s.aiState === 'LUNGING' || s.aiIsLunging || false,
        isDashing: s.aiDashRemaining > 0,
        isSprinting: s.aiIsSprinting || false,
        isSliding: s.aiSlideActive || false,
        weaponTimer: s.aiWeaponTimer || 0,
        activeWeapon: s.aiActiveWeapon,
        weaponState: s.aiWeaponState,
        score: s.scoreEnemy,
        kills: s.enemyKills ?? 0,
        deaths: s.enemyDeaths ?? 0,
        respawnTimer: s.enemyRespawnTimer,
        invulnerabilityTimer: s.aiInvulnerabilityTimer
      };

      const aiCompState = {
        pos: s.aiPos,
        vel: s.aiVel,
        yaw: s.aiYaw,
        hp: s.aiHP,
        activeWeapon: aiState.activeWeapon,
        weaponState: aiState.weaponState,
        isCrouching: aiState.isCrouching,
        score: aiState.score,
        kills: aiState.kills,
        deaths: aiState.deaths
      };

      if (hasPlayerChanged('main_ai', aiCompState)) {
        frame.ai = aiState;
        lastRecordedStateRef.current.set('main_ai', {
          pos: s.aiPos.clone(),
          vel: s.aiVel.clone(),
          yaw: s.aiYaw,
          hp: s.aiHP,
          activeWeapon: aiState.activeWeapon,
          weaponState: aiState.weaponState,
          isCrouching: aiState.isCrouching,
          score: aiState.score,
          kills: aiState.kills,
          deaths: aiState.deaths
        });
      }
    }

    // 3. Process other players/bots in the room
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

    // Recorded Main AI (Red)
    if (replayData.mode !== 'multiplayer') {
      const aiInterp = interpolatePlayer('main_ai', replayData.opponentName, botColors['main_ai'] ?? 0);
      if (aiInterp) {
        updatedPlayers.set('main_ai', { ...aiInterp, name: replayData.opponentName, hue: botColors['main_ai'] ?? 0 });
      }
    }

    // Recorded Other Players / Bots
    const allBotIds = new Set<string>();
    frames.forEach(f => {
      if (f.otherPlayers) f.otherPlayers.forEach(p => allBotIds.add(p.id));
    });

    allBotIds.forEach(id => {
      let name = 'Bot';
      let hue = 0;
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
            if (id === 'main_ai' && f.ai) { prevState = f.ai; break; }
            if (id !== 'player' && id !== 'main_ai' && f.otherPlayers) {
              const found = f.otherPlayers.find(p => p.id === id);
              if (found) { prevState = found; break; }
            }
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
  }, [isPlaying, isPaused, isMultiplayer, multiplayerRole, multiplayerSocket]);

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

    if ((!isMultiplayer || s.otherPlayers.size === 0) && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      considerTarget(s.aiPos);
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
    const difficulty =
      (botDifficulties as Record<string, string>)?.main_ai || s.settings.aiDifficulty || 'normal';
    const best = getBestTacticalTarget('main_ai', s.aiPos, difficulty);
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
    const forward = (s.settings.attackRange ?? 3.2) * (weapon === 'hammer' ? 0.875 : 1.0);
    const radius = s.settings.attackRadius ?? 4.5;

    const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + 1.2, bot.pos.z);
    const heading = new THREE.Vector3(Math.sin(bot.yaw), 0, Math.cos(bot.yaw));
    if (heading.lengthSq() < 1e-6) heading.set(0, 0, 1);
    heading.normalize();
    const impactPos = eye.clone().addScaledVector(heading, forward);

    renderHammerSplashVfx(impactPos, weapon === 'hammer' ? '#f97316' : '#ef4444', radius);
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

    // Main AI ("Red")
    if (
      s.aiHP > 0 &&
      s.aiState !== 'RESPAWNING' &&
      s.aiInvulnerabilityTimer <= 0 &&
      impactPos.distanceTo(getCombatBodyCenter(s.aiPos, s.aiIsCrouching)) <= radius
    ) {
      s.aiHP -= 1;
      spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
      if (s.aiHP <= 0) {
        s.aiHP = 0;
        s.aiState = 'RESPAWNING';
        s.enemyRespawnTimer = 3.0;
        s.enemyDeaths += 1;
        s.aiWeaponState = 'ready'; s.aiWeaponTimer = 0;
        recordBotCalibrationDeath('main_ai');
        creditKill('main_ai', 'Red (AI)');
      } else {
        sfx.playSwing();
        recordBotDamageTag(botId, 'main_ai');
      }
    }

    // Other bots (free-for-all), excluding self
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other, otherId) => {
        if (otherId === botId) return;
        if (other.hp <= 0 || (other.respawnTimer ?? 0) > 0) return;
        if ((other.invulnerabilityTimer ?? 0) > 0) return;
        const otherPos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
        if (impactPos.distanceTo(getCombatBodyCenter(otherPos, other.isCrouching || false)) > radius) return;
        other.hp -= 1;
        spawnVoxelShockwaveParticles(otherPos, '#ef4444');
        if (other.hp <= 0) {
          other.hp = 0;
          other.respawnTimer = 3.0;
          other.deaths = (other.deaths || 0) + 1;
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

    // Check main AI bot in single-player
    if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
      const C = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
      const toEnemy = C.clone().sub(eyePos);
      const proj = toEnemy.dot(cameraLookDir);
      if (proj > 0) {
        const closestPointOnRay = eyePos.clone().addScaledVector(cameraLookDir, proj);
        const distToRay = closestPointOnRay.distanceTo(C);
        if (distToRay <= 0.65) {
          const hitDist = eyePos.distanceTo(C);
          if (hitDist < closestDist) {
            closestDist = hitDist;
            closestTarget = { type: 'main_ai', pos: s.aiPos, hp: s.aiHP };
            closestHitPoint.copy(closestPointOnRay);
          }
        }
      }
    }

    // Check other players/bots in multiplayer or multi-bot rooms
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

      if (closestTarget.type === 'main_ai') {
        s.aiHP = Math.max(0, s.aiHP - 1);
        s.lastStrikePos = s.aiPos.clone();
        s.lastStrikeTick = 1.0;

        if (s.aiHP <= 0) {
          s.aiHP = 0;
          s.aiState = 'RESPAWNING';
          s.enemyRespawnTimer = 3.0;
          s.scorePlayer += 1;
          s.playerKills += 1;
          s.enemyDeaths += 1;
          recordBotCalibrationDeath('main_ai');
          sfx.playDeath();
          s.aiWeaponState = 'ready';
          s.aiWeaponTimer = 0;

          const medals = evaluatePlayerKillMedals('main_ai');
          const newDeath: DeathEvent = {
            id: Math.random().toString(36).substring(2, 9),
            attacker: s.settings.playerName || 'Blue (You)',
            victim: 'Red (AI)',
            medals,
            weapon: 'sword', // standard field mapped to UI
          };
          s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
          spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
        }
      }
      else if (closestTarget.type === 'other') {
        // Send impact sync package to server in multiplayer
        if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
          multiplayerSocket.send(JSON.stringify({ 
            type: 'sync', 
            action: 'hit_taken', 
            damage: 1, 
            targetId: closestTarget.id,
            weapon: 'sword'
          }));
        } else {
          // Local room bot
          const bot = closestTarget.data;
          bot.hp = Math.max(0, bot.hp - 1);
          if (bot.hp <= 0) {
            bot.hp = 0;
            bot.respawnTimer = 3.0;
            bot.deaths += 1;
            s.scorePlayer += 1;
            s.playerKills += 1;
            sfx.playDeath();
            
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: bot.playerName || 'AI Bot',
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

  // TRIGGERS ENEMY AI SWING
  const triggerEnemyHammerSwing = () => {
    const s = stateRef.current;
    if (s.aiSwapCooldownTimer > 0) return;
    if (s.aiDashRemaining > 0) return; // Attacks cannot take place during the dash movement
    s.aiWeaponState = 'swing_up';
    s.aiWeaponTimer = 0;
    s.lastAIHammerAttackTime = Date.now();
  };

  // TRIGGERS ENEMY AI HAMMER MELEE
  const triggerEnemyHammerMelee = () => {
    const s = stateRef.current;
    if (s.aiSwapCooldownTimer > 0) return;
    if (s.aiDashRemaining > 0) return;
    s.aiWeaponState = 'melee_up';
    s.aiWeaponTimer = 0;
    s.lastAIHammerAttackTime = Date.now();
    sfx.playSwing();
  };

  // TRIGGERS ENEMY AI SWORD SLASH
  const triggerEnemySwordSlash = () => {
    const s = stateRef.current;
    if (s.aiSwapCooldownTimer > 0) return;
    if (s.aiDashRemaining > 0) return;
    s.aiWeaponState = 'swing_up';
    s.aiWeaponTimer = 0;
    s.lastAISwordAttackTime = Date.now();
    sfx.playSwing();
  };

  // TRIGGERS ENEMY AI SWORD LUNGE
  const triggerEnemySwordLunge = (customDir?: THREE.Vector3) => {
    const s = stateRef.current;
    if (s.aiSwapCooldownTimer > 0) return;
    if (s.aiDashRemaining > 0) return;
    s.aiState = 'LUNGING';
    s.aiLungeTimer = 0;
    s.aiLungeStartPos.copy(s.aiPos);
    if (customDir) {
      s.aiLungeTargetDir.copy(customDir);
    } else {
      const target = getEnemyAITarget();
      const targetPos = target ? target.pos.clone() : s.playerPos.clone();
      const targetAirborne = target ? (target.pos.y > 0.35 || (target.vel && Math.abs(target.vel.y) > 1.0)) : (s.playerPos.y > 0.35 || Math.abs(s.playerVel.y) > 1.0);
      s.aiLungeTargetDir.copy(targetPos).sub(s.aiPos);
      if (!targetAirborne) {
        s.aiLungeTargetDir.y = 0;
      }
    }
    if (s.aiLungeTargetDir.lengthSq() <= 0.0001) {
      s.aiState = 'APPROACHING';
      return;
    }
    s.aiLungeTargetDir.normalize();
    const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
    s.aiVel.y = Math.max(s.aiVel.y, s.aiLungeTargetDir.y * lungeSpeed);
    s.aiIsJumping = s.aiPos.y > 0.01 || s.aiVel.y > 0.01;
    s.aiWeaponState = 'ready';
    s.lastAISwordAttackTime = Date.now();
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
    if (target.id === 'player') {
      s.playerHP = Math.max(0, s.playerHP - 1);
    } else if (target.id === 'main_ai') {
      s.aiHP = Math.max(0, s.aiHP - 1);
    } else {
      const targetBot = s.otherPlayers.get(target.id);
      if (targetBot) {
        targetBot.hp = Math.max(0, targetBot.hp - 1);
      }
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
      } else if (target.id === 'main_ai') {
        s.scoreEnemy += 1;
        s.enemyKills += 1;
        recordDeathEvent(`Red (AI) [${tradeText}]`, attackerBot.playerName, undefined, tradeWeapon);
      } else {
        const targetBot = s.otherPlayers.get(target.id);
        if (targetBot) {
          targetBot.score = (targetBot.score || 0) + 1;
          targetBot.kills = (targetBot.kills || 0) + 1;
          recordDeathEvent(`${targetBot.playerName} [${tradeText}]`, attackerBot.playerName, undefined, tradeWeapon);
        }
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
    } else if (target.id === 'main_ai' && s.aiHP <= 0) {
      s.aiHP = 0;
      s.aiState = 'RESPAWNING';
      s.enemyRespawnTimer = 3.0;
      s.enemyDeaths += 1;
      recordBotCalibrationDeath('main_ai');
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, 'Red (AI)', undefined, tradeWeapon);
      spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
    } else if (target.id !== 'player' && target.id !== 'main_ai') {
      const targetBot = s.otherPlayers.get(target.id);
      if (targetBot && targetBot.hp <= 0) {
        targetBot.hp = 0;
        targetBot.respawnTimer = 3.0;
        targetBot.deaths = (targetBot.deaths || 0) + 1;
        attackerBot.score = (attackerBot.score || 0) + 1;
        attackerBot.kills = (attackerBot.kills || 0) + 1;
        recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, targetBot.playerName, undefined, tradeWeapon);
        spawnVoxelShockwaveParticles(new THREE.Vector3(targetBot.pos.x, targetBot.pos.y, targetBot.pos.z), '#ef4444');
      }
    }

    attackerBot.isLunging = false;
    attackerBot.weaponState = 'ready';
    pushStatsUpdate();
  };

  function evaluatePlayerKillMedals(victimId: 'main_ai' | string): MedalInfo[] {
    const s = stateRef.current;
    const now = Date.now();

    let isLunging = false;
    let spawnTime = 0;

    if (victimId === 'main_ai') {
      isLunging = s.aiState === 'LUNGING';
      spawnTime = s.aiSpawnTime || 0;
    } else {
      const other = s.otherPlayers.get(victimId);
      if (other) {
        isLunging = other.isLunging || other.aiState === 'LUNGING' || other.weaponState === 'swing_up' || other.weaponState === 'swing_down';
        spawnTime = other.spawnTime || 0;
      }
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
    s.aiHP = Math.max(0, s.aiHP - 1);

    // Audio cues
    sfx.playExplosion();
    sfx.playDeath();

    // Spawns beautiful particle visual feedback for both characters
    spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6'); // Blue player shockwave
    spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');    // Red AI shockwave

    // Render debug positions
    s.lastStrikePos = s.aiPos.clone();
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
    if (s.aiHP <= 0) {
      s.aiHP = 0;
      s.aiState = 'RESPAWNING';
      s.enemyRespawnTimer = 3.0;
      s.scorePlayer += 1;
      s.playerKills += 1;
      s.enemyDeaths += 1;
      recordBotCalibrationDeath('main_ai');
      playerMedals = evaluatePlayerKillMedals('main_ai');
    }
    s.aiWeaponState = 'ready';
    s.aiWeaponTimer = 0;

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
            if (!isMultiplayer && s.aiHP > 0 && s.aiWeaponState === 'swing_up') {
              observePlayerReaction(model, s.aiWeaponTimer ?? 0);
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
        if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
          exclude.push(s.aiPos);
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

      if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
        closestTarget = { id: 'main_ai', pos: s.aiPos, hp: s.aiHP, name: 'Red (AI)' };
        dist = s.playerPos.distanceTo(s.aiPos);
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
            const isAISwordActiveAttack = s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
              s.aiState === 'LUNGING' || 
              s.aiWeaponState === 'swing_up' || 
              s.aiWeaponState === 'swing_down' || 
              (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
            );
            const isAIHammerActiveAttack = s.settings.enableHammerSwordTrade && s.aiActiveWeapon === 'hammer' && (
              s.aiWeaponState === 'swing_up' || 
              s.aiWeaponState === 'swing_down' ||
              (Date.now() - s.lastAIHammerAttackTime <= hammerThreshold)
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
            s.aiHP -= 1;
            if (s.aiHP <= 0) {
              s.aiHP = 0;
              s.aiState = 'RESPAWNING';
              s.enemyRespawnTimer = 3.0;
              s.scorePlayer += 1;
              s.playerKills += 1;
              s.enemyDeaths += 1;
              recordBotCalibrationDeath('main_ai');
              sfx.playDeath();
              s.aiWeaponState = 'ready';
              s.aiWeaponTimer = 0;

              const medals = evaluatePlayerKillMedals('main_ai');
              const newDeath: DeathEvent = {
                id: Math.random().toString(36).substring(2, 9),
                attacker: s.settings.playerName || 'Blue (You)',
                victim: 'Red (AI)',
                medals,
                weapon: 'sword',
              };
              s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
              spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
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
      const distFromCenter = Math.sqrt(s.playerPos.x * s.playerPos.x + s.playerPos.z * s.playerPos.z);
      if (distFromCenter >= s.arenaRadius - 0.6) {
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
    if (s.aiSwapCooldownTimer > 0) {
      s.aiSwapCooldownTimer = Math.max(0, s.aiSwapCooldownTimer - dt);
    }
    if (s.swapLockoutTimer > 0) {
      s.swapLockoutTimer = Math.max(0, s.swapLockoutTimer - dt);
    }
    if (s.aiSwapLockoutTimer > 0) {
      s.aiSwapLockoutTimer = Math.max(0, s.aiSwapLockoutTimer - dt);
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
              if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
                const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
                const toEnemy = enemyCenter.clone().sub(eyePos);
                const dist = toEnemy.length();
                if (dist <= 2.8) {
                  const toEnemyDir = toEnemy.clone().normalize();
                  const dot = cameraLookDir.dot(toEnemyDir);
                  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                  
                  if (angle <= 1.0) {
                    const swordThreshold = s.settings.swordTradeWindow ?? 350;
                    const isAISwordActiveAttack = s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
                      s.aiState === 'LUNGING' || 
                      s.aiWeaponState === 'swing_up' || 
                      s.aiWeaponState === 'swing_down' || 
                      (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
                    );
                    if (isAISwordActiveAttack) {
                      executeTrade('sword_vs_sword');
                      return;
                    }

                    s.aiHP -= 1;
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(s.aiPos, '#22d3ee');
                    s.lastStrikePos = s.aiPos.clone();
                    s.lastStrikeTick = 1.0;
                                       if (s.aiHP <= 0) {
                      s.aiHP = 0;
                      s.aiState = 'RESPAWNING';
                      s.enemyRespawnTimer = 3.0;
                      s.scorePlayer += 1;
                      s.playerKills += 1;
                      s.enemyDeaths += 1;
                      recordBotCalibrationDeath('main_ai');
                      sfx.playDeath();
                      s.aiWeaponState = 'ready';
                      s.aiWeaponTimer = 0;
                      
                      const medals = evaluatePlayerKillMedals('main_ai');
                      const newDeath: DeathEvent = {
                        id: Math.random().toString(36).substring(2, 9),
                        attacker: s.settings.playerName || 'Blue (You)',
                        victim: 'Red (AI)',
                        medals,
                        weapon: s.activeWeapon,
                      };
                      s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                      spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
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
                    
                    if (dist <= 2.8) {
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

    // ENEMY AI WEAPON ANIMATION AND VISIBILITY
    const enemyHammerModel = threeRef.current.enemyHammer;
    const enemySwordModel = threeRef.current.enemySword;

    if (enemyHammerModel) {
      enemyHammerModel.visible = s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiActiveWeapon === 'hammer';
    }
    if (enemySwordModel) {
      enemySwordModel.visible = s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiActiveWeapon === 'sword';
    }

    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') {
      s.aiWeaponState = 'ready';
      s.aiWeaponTimer = 0;
      if (enemyHammerModel) {
        enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
        enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
      }
      if (enemySwordModel) {
        enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
        enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      }
    } else {
      if (s.aiActiveWeapon === 'hammer' && enemyHammerModel) {
        if (s.aiWeaponState === 'ready') {
          enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
          enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        } 
        else if (s.aiWeaponState === 'swing_up') {
          s.aiWeaponTimer += dt;
          const windup = 0.32;
          const pct = Math.min(1.0, s.aiWeaponTimer / windup);
          
          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.4, pct),
            THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64, // high over head
            THREE.MathUtils.lerp(-0.48, -0.15, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(0.2, -1.3, pct); // swing back

          if (pct >= 1.0) {
            s.aiWeaponState = 'swing_down';
            s.aiWeaponTimer = 0;
          }
        } 
        else if (s.aiWeaponState === 'swing_down') {
          s.aiWeaponTimer += dt;
          const strike = 0.13;
          const pct = Math.min(1.0, s.aiWeaponTimer / strike);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.4, 0.2, pct),
            THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64, // smash hard down
            THREE.MathUtils.lerp(-0.15, -0.9, pct) // reach forward
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(-1.3, 1.1, pct);

          if (pct >= 1.0) {
            s.aiWeaponState = 'recovering';
            s.aiWeaponTimer = 0;

            // Perform Enemy damage check
            applyHammerStrikeImpact(false);
          }
        } 
        else if (s.aiWeaponState === 'recovering') {
          s.aiWeaponTimer += dt;
          const recover = s.settings.hammerReloadTime ?? 0.6;
          const pct = Math.min(1.0, s.aiWeaponTimer / recover);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.9, -0.48, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(1.1, 0.2, pct);

          if (pct >= 1.0) {
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
          }
        }
        else if (s.aiWeaponState === 'melee_up') {
          s.aiWeaponTimer += dt;
          const windup = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.4 : 0.1;
          const pct = Math.min(1.0, s.aiWeaponTimer / windup);

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
            s.aiWeaponState = 'melee_down';
            s.aiWeaponTimer = 0;
          }
        }
        else if (s.aiWeaponState === 'melee_down') {
          s.aiWeaponTimer += dt;
          const strike = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.6 : 0.14;
          const pct = Math.min(1.0, s.aiWeaponTimer / strike);

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
            s.aiWeaponState = 'melee_recover';
            s.aiWeaponTimer = 0;

            // Perform Enemy Hammer Melee hit check
            applyEnemyHammerMeleeImpact();
          }
        }
        else if (s.aiWeaponState === 'melee_recover') {
          s.aiWeaponTimer += dt;
          const recover = s.settings.hammerMeleeReload ?? 0.5;
          const pct = Math.min(1.0, s.aiWeaponTimer / recover);

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
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
          }
        }
      } else if (s.aiActiveWeapon === 'sword' && enemySwordModel) {
        // ENEMY KATAR SWORD WALK / STRIKE ANIMATION
        if (s.aiState === 'LUNGING') {
          // Lunge forward poise: points straight forward, aligned centered
          enemySwordModel.position.set(0.0, 1.2 - 0.64, -0.75);
          enemySwordModel.rotation.set(Math.PI / 2 + 0.15, 0, 0);
        } else if (s.aiWeaponState === 'ready') {
          enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
          enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        } 
        else if (s.aiWeaponState === 'swing_up') {
          s.aiWeaponTimer += dt;
          const windup = s.settings.swordSlashSpeed ? s.settings.swordSlashSpeed * 0.4 : 0.1;
          const pct = Math.min(1.0, s.aiWeaponTimer / windup);
          
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
            s.aiWeaponState = 'swing_down';
            s.aiWeaponTimer = 0;
          }
        } 
        else if (s.aiWeaponState === 'swing_down') {
          s.aiWeaponTimer += dt;
          const strike = s.settings.swordSlashSpeed ? s.settings.swordSlashSpeed * 0.6 : 0.12;
          const pct = Math.min(1.0, s.aiWeaponTimer / strike);

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
            s.aiWeaponState = 'recovering';
            s.aiWeaponTimer = 0;

            // Perform Enemy Sword Slash hit check
            applyEnemySwordSlashImpact();
          }
        } 
        else if (s.aiWeaponState === 'recovering') {
          s.aiWeaponTimer += dt;
          const recover = s.settings.swordSlashReload ?? 0.6;
          const pct = Math.min(1.0, s.aiWeaponTimer / recover);

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
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
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
      if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
        const enemyBodyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
        const dist = impactPos.distanceTo(enemyBodyCenter);
        
        if (dist <= s.settings.attackRadius) {
          s.aiHP -= 1;
          sfx.playSwing();
          spawnVoxelShockwaveParticles(s.aiPos, '#22d3ee');
          s.lastStrikePos = s.aiPos.clone();
          s.lastStrikeTick = 1.0;
          
          if (s.aiHP <= 0) {
            s.aiHP = 0;
            s.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            s.scorePlayer += 1;
            s.playerKills += 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;
            
            const medals = evaluatePlayerKillMedals('main_ai');
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: 'Red (AI)',
              medals,
              weapon: s.activeWeapon,
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
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
      if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return; // Prevent dead enemies' attacks from executing
      // ENEMY AI IS STRIKING
      // The AI tracks the resolved target in 3D, OR aims beneath itself for a hammer jump!
      const target = getEnemyAITarget();
      if (!target) return;

      const aiEyePos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.2, s.aiPos.z);
      const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
      
      let aiHeading3D: THREE.Vector3;
      if (s.aiHammerJumpPlanned) {
        aiHeading3D = new THREE.Vector3(0, -1, 0);
      } else {
        aiHeading3D = targetBodyCenter.clone().sub(aiEyePos).normalize();
      }
      
      const impactPos = aiEyePos.clone().addScaledVector(aiHeading3D, s.settings.attackRange * 0.875);

      s.lastAIStrikePos = impactPos;
      s.lastAIStrikeTick = 1.5;

      // Check for Hammer Jump eligibility for AI (distance check)
      const distToBase = impactPos.distanceTo(s.aiPos);
      if (distToBase <= (s.settings.hammerJumpTriggerRadius ?? 3.5)) {
        s.aiHammerJumpWindowTimer = s.settings.hammerJumpWindow ?? 0.6;
        if (s.aiHammerJumpPlanned) {
          s.aiIsJumping = true;
          s.aiVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
          sfx.playJump();
          spawnVoxelShockwaveParticles(s.aiPos, '#f59e0b');
        }
      }
      s.aiHammerJumpPlanned = false;
      s.aiHammerJumpType = undefined;

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
                weapon: s.aiActiveWeapon,
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
              tryStartComboOnHit('main_ai', 'player', s.aiActiveWeapon);
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
                  weapon: s.aiActiveWeapon,
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                recordBotPsychKill('main_ai', target.id, false);
              } else {
                sfx.playSwing();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#e2e8f0');
                recordBotDamageTag('main_ai', target.id);
                tryEnterPressureState('main_ai', target.id, other.hp, other.invulnerabilityTimer || 0);
                tryStartComboOnHit('main_ai', target.id, s.aiActiveWeapon);
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
    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return;
    
    const target = getEnemyAITarget();
    if (!target) return;

    // Slash trace centering forward in front of the AI, including airborne targets.
    const aiEyePos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.2, s.aiPos.z);
    const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
    const lookHeading = targetBodyCenter.clone().sub(aiEyePos).normalize();
    const impactPos = aiEyePos.clone().addScaledVector(lookHeading, 2.2); // sweet spot distance
    
    s.lastAIStrikePos = impactPos;
    s.lastAIStrikeTick = 1.0;
    
    sfx.playSwing();
    spawnVoxelShockwaveParticles(impactPos, '#ef4444');
    
    if (isMultiplayer) return; // In multiplayer, we do not run AI damage checks against local player!
    
    if (target.hp > 0 && target.invuln <= 0) {
      const dist = impactPos.distanceTo(targetBodyCenter);
      
      if (dist <= 2.8) {
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
    if (!isMultiplayer && s.aiHP > 0 && s.aiState !== 'RESPAWNING' && s.aiInvulnerabilityTimer <= 0) {
      const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
      const toEnemy = enemyCenter.clone().sub(eyePos);
      const dist = toEnemy.length();
      if (dist <= 3.0) {
        const toEnemyDir = toEnemy.clone().normalize();
        const dot = cameraLookDir.dot(toEnemyDir);
        const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));

        if (angle <= 1.0) {
          s.aiHP -= 1;
          sfx.playSwing();
          spawnVoxelShockwaveParticles(s.aiPos, '#38bdf8');
          s.lastStrikePos = s.aiPos.clone();
          s.lastStrikeTick = 1.0;

          if (s.aiHP <= 0) {
            s.aiHP = 0;
            s.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            s.scorePlayer += 1;
            s.playerKills += 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();
            s.aiWeaponState = 'ready';
            s.aiWeaponTimer = 0;

            const medals = evaluatePlayerKillMedals('main_ai');
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: s.settings.playerName || 'Blue (You)',
              victim: 'Red (AI)',
              medals,
              weapon: 'hammer',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
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
          if (dist <= 3.0) {
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
    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') return;

    const target = getEnemyAITarget();
    if (!target) return;

    const aiEyePos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.2, s.aiPos.z);
    const targetBodyCenter = getCombatBodyCenter(target.pos, target.isCrouching);
    const lookHeading = targetBodyCenter.clone().sub(aiEyePos).normalize();
    const impactPos = aiEyePos.clone().addScaledVector(lookHeading, 2.2);

    s.lastAIStrikePos = impactPos;
    s.lastAIStrikeTick = 1.0;

    sfx.playSwing();
    spawnVoxelShockwaveParticles(impactPos, '#38bdf8');

    if (isMultiplayer) return;

    if (target.hp > 0 && target.invuln <= 0) {
      const dist = impactPos.distanceTo(targetBodyCenter);

      if (dist <= 3.0) {
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
      return s.aiWeaponState === 'recovering' || s.aiWeaponState === 'swing_up' || s.aiWeaponState === 'swing_down' || s.aiState === 'LUNGING' || (s.aiState === 'COOLDOWN' && s.aiTimer > 0);
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

    // Every AI combatant (main AI + bots) is sourced uniformly from getAllCombatants
    // — no main-AI special case. The querying combatant excludes itself by id.
    getAllCombatants().forEach((other) => {
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
    let playstyleVal = 50;
    if (['easy', 'normal', 'hard', 'nightmare'].includes(difficulty)) {
      const botArchetype = resolveBotArchetype(botId);
      if (botArchetype) {
        const def = getArchetypeDef(botArchetype);
        const playstyleKnob = def?.knobOverrides?.aiPlaystyle;
        playstyleVal = playstyleKnob !== undefined ? playstyleKnob : 50;
      } else {
        const behavior = botBehaviors[botId] || 'defensive';
        if (behavior === 'passive') playstyleVal = 0;
        else if (behavior === 'defensive') playstyleVal = 50;
        else if (behavior === 'aggressive') playstyleVal = 100;
      }
    } else if (difficulty === 'custom') {
      playstyleVal = s.settings.aiPlaystyle ?? 50;
    } else {
      const preset = aiPresets.find(p => p.id === difficulty);
      if (preset) playstyleVal = preset.tuning.aiPlaystyle ?? 50;
    }
    const playstyleFactor = playstyleVal / 100;
    const recoveringTargetBonus = (1.0 - Math.abs(playstyleFactor - 0.5) * 2.0) * 200.0;
    const targetSelectionSpatialIQ = resolveDerivedAIParams(
      s.settings,
      resolveBotKnobs(botId),
      resolveBotArchetype(botId)
    ).spatialIQ;

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

        const myActiveWeapon = botId === 'main_ai' ? s.aiActiveWeapon : s.otherPlayers.get(botId)?.activeWeapon;
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
    const knobs = resolveBotKnobs(botId);
    const baseAggression = resolveDerivedAIParams(
      s.settings,
      knobs,
      resolveBotArchetype(botId)
    ).pressureAggression;
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
    const currentWeapon = botId === 'main_ai' ? s.aiActiveWeapon : botState?.activeWeapon;
    const botHP = botId === 'main_ai' ? s.aiHP : botState?.hp || 1;
    const botMaxHP = botId === 'main_ai' ? s.aiMaxHP : botState?.maxHp || 1;
    const botPos = botId === 'main_ai' ? s.aiPos : (botState ? new THREE.Vector3(botState.pos.x, botState.pos.y, botState.pos.z) : new THREE.Vector3());

    const dist = context.distanceToTarget ?? botPos.distanceTo(target.pos);

    let nearbyEnemiesCount = 0;
    if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && botId !== 'player') {
      if (botPos.distanceTo(s.playerPos) < 6.0) nearbyEnemiesCount++;
    }
    if (botId !== 'main_ai' && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      if (botPos.distanceTo(s.aiPos) < 6.0) nearbyEnemiesCount++;
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
    const cooldown = self.aiHammerJumpCooldownTimer ?? 0;
    const isAirborne =
      self.isJumping ||
      pos.y > AI_HAMMER_JUMP_START_MAX_HEIGHT ||
      Math.abs(vel.y) > AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON;

    return cooldown <= 0 && !isAirborne;
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
      // The main AI plans the jump and lifts off when its hammer swing connects.
      s.aiHammerJumpPlanned = true;
      s.aiHammerJumpType = jumpType;
      s.aiHammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
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
      self.aiHammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
      sfx.playSwing();
      sfx.playJump();
    }

    return true;
  };

  // The main AI as a single, durable Combatant that OWNS its scalar combat state
  // (the source-of-truth flip). Each flat s.aiXxx SCALAR field is redefined as a
  // forwarder into this object, so the ~506 existing readers of s.aiXxx keep working
  // unchanged while the canonical value now lives on the Combatant. Vectors
  // (pos/vel/lunge dirs/dash dir) and the team-score fields stay canonical on
  // stateRef and are exposed here via accessors (vectors are shared instances; the
  // dash-dir setter copies into the live Vector3). Created and installed once, cached.
  const getMainAICombatant = (): Combatant => {
    if (mainAICombatantRef.current) return mainAICombatantRef.current;
    const s = stateRef.current;

    // Canonical scalar state, seeded from the current flat values before the flip.
    const c: any = {
      id: 'main_ai',
      playerName: 'Red (AI)',
      hp: s.aiHP,
      maxHp: s.aiMaxHP,
      yaw: s.aiYaw,
      isCrouching: s.aiIsCrouching,
      isJumping: s.aiIsJumping,
      activeWeapon: s.aiActiveWeapon,
      weaponState: s.aiWeaponState,
      weaponTimer: s.aiWeaponTimer,
      aiState: s.aiState,
      aiTimer: s.aiTimer,
      aiSwayTimer: s.aiSwayTimer,
      aiDashCooldownTimer: s.aiDashCooldownTimer,
      aiDashRemaining: s.aiDashRemaining,
      aiSlideActive: s.aiSlideActive,
      aiSlideDistanceTraveled: s.aiSlideDistanceTraveled,
      aiSlideCooldownTimer: s.aiSlideCooldownTimer,
      aiIsSprinting: s.aiIsSprinting,
      aiHammerJumpCooldownTimer: s.aiHammerJumpCooldownTimer,
      aiCoordCommitTimer: s.aiCoordCommitTimer,
      aiPendingPostEvasionCharge: s.aiPendingPostEvasionCharge,
      aiPostLungeDecisionTimer: s.aiPostLungeDecisionTimer,
      aiLastLungeOutcome: s.aiLastLungeOutcome,
      aiLastLungeTargetId: s.aiLastLungeTargetId,
      aiPressureTargetId: s.aiPressureTargetId,
      swapLockoutTimer: s.aiSwapLockoutTimer,
      invulnerabilityTimer: s.aiInvulnerabilityTimer,
      spawnTime: s.aiSpawnTime,
      lungeTimer: s.aiLungeTimer,
    };

    // Vectors remain canonical on stateRef (shared instances), exposed here. aiDashDir
    // is stored as a Vector3 on stateRef but presented as {x,y,z}; its setter copies in.
    Object.defineProperty(c, 'pos', { get: () => stateRef.current.aiPos, enumerable: true });
    Object.defineProperty(c, 'vel', { get: () => stateRef.current.aiVel, enumerable: true });
    Object.defineProperty(c, 'lungeStartPos', {
      get: () => stateRef.current.aiLungeStartPos,
      set: (v: any) => { stateRef.current.aiLungeStartPos.copy(v); },
      enumerable: true,
    });
    Object.defineProperty(c, 'lungeTargetDir', {
      get: () => stateRef.current.aiLungeTargetDir,
      set: (v: any) => { stateRef.current.aiLungeTargetDir.copy(v); },
      enumerable: true,
    });
    Object.defineProperty(c, 'aiDashDir', {
      get: () => stateRef.current.aiDashDir,
      set: (v: any) => { stateRef.current.aiDashDir.copy(v); },
      enumerable: true,
    });

    // isLunging derives from this object's own aiState.
    Object.defineProperty(c, 'isLunging', {
      get: () => c.aiState === 'LUNGING',
      set: (v: boolean) => { if (v) { c.aiState = 'LUNGING'; } else if (c.aiState === 'LUNGING') { c.aiState = 'COOLDOWN'; } },
      enumerable: true,
    });

    // Team-level scoring stays canonical on stateRef; the main AI forwards to it.
    Object.defineProperty(c, 'score', { get: () => stateRef.current.scoreEnemy, set: (v: number) => { stateRef.current.scoreEnemy = v; }, enumerable: true });
    Object.defineProperty(c, 'kills', { get: () => stateRef.current.enemyKills, set: (v: number) => { stateRef.current.enemyKills = v; }, enumerable: true });
    Object.defineProperty(c, 'deaths', { get: () => stateRef.current.enemyDeaths, set: (v: number) => { stateRef.current.enemyDeaths = v; }, enumerable: true });
    Object.defineProperty(c, 'respawnTimer', {
      get: () => stateRef.current.enemyRespawnTimer,
      set: (v: number) => { stateRef.current.enemyRespawnTimer = v; if (v > 0) c.aiState = 'RESPAWNING'; },
      enumerable: true,
    });
    // Attack timestamps live in the main AI's flat lastAI* fields; forward to them.
    Object.defineProperty(c, 'lastSwordAttackTime', { get: () => stateRef.current.lastAISwordAttackTime, set: (v: number) => { stateRef.current.lastAISwordAttackTime = v; }, enumerable: true });
    Object.defineProperty(c, 'lastHammerAttackTime', { get: () => stateRef.current.lastAIHammerAttackTime, set: (v: number) => { stateRef.current.lastAIHammerAttackTime = v; }, enumerable: true });

    // The flip: redefine each flat scalar field as a forwarder into the Combatant so
    // every existing reader of s.aiXxx now sees the Combatant-owned value.
    const scalarMap: [string, string][] = [
      ['aiHP', 'hp'], ['aiMaxHP', 'maxHp'], ['aiYaw', 'yaw'], ['aiIsCrouching', 'isCrouching'],
      ['aiIsJumping', 'isJumping'], ['aiActiveWeapon', 'activeWeapon'], ['aiWeaponState', 'weaponState'],
      ['aiWeaponTimer', 'weaponTimer'], ['aiState', 'aiState'], ['aiTimer', 'aiTimer'],
      ['aiSwayTimer', 'aiSwayTimer'], ['aiDashCooldownTimer', 'aiDashCooldownTimer'],
      ['aiDashRemaining', 'aiDashRemaining'], ['aiSlideActive', 'aiSlideActive'],
      ['aiSlideDistanceTraveled', 'aiSlideDistanceTraveled'], ['aiSlideCooldownTimer', 'aiSlideCooldownTimer'],
      ['aiIsSprinting', 'aiIsSprinting'], ['aiHammerJumpCooldownTimer', 'aiHammerJumpCooldownTimer'],
      ['aiCoordCommitTimer', 'aiCoordCommitTimer'], ['aiPendingPostEvasionCharge', 'aiPendingPostEvasionCharge'],
      ['aiPostLungeDecisionTimer', 'aiPostLungeDecisionTimer'], ['aiLastLungeOutcome', 'aiLastLungeOutcome'],
      ['aiLastLungeTargetId', 'aiLastLungeTargetId'], ['aiPressureTargetId', 'aiPressureTargetId'],
      ['aiSwapLockoutTimer', 'swapLockoutTimer'], ['aiInvulnerabilityTimer', 'invulnerabilityTimer'],
      ['aiSpawnTime', 'spawnTime'], ['aiLungeTimer', 'lungeTimer'],
    ];
    for (const [flat, key] of scalarMap) {
      Object.defineProperty(stateRef.current, flat, {
        get() { return c[key]; },
        set(v) { c[key] = v; },
        configurable: true,
        enumerable: true,
      });
    }

    mainAICombatantRef.current = c as Combatant;
    return c as Combatant;
  };

  // The single source of truth for "every AI-driven combatant" — the main AI plus
  // all additional bots — as one uniform Combatant list. AI/combat code (targeting,
  // coordination, damage) iterates this instead of special-casing the main AI vs the
  // otherPlayers map. The main AI is only an AI combatant offline; in multiplayer the
  // local AI doesn't run and the map holds remote players instead. Rendering,
  // collision and networking keep using the raw otherPlayers map (the main AI has a
  // bespoke mesh and is intentionally not a member there).
  const getAllCombatants = (): Combatant[] => {
    const s = stateRef.current;
    const list: Combatant[] = [];
    if (!s.isMultiplayer) list.push(getMainAICombatant());
    s.otherPlayers.forEach((c) => list.push(c));
    return list;
  };

  // The render mesh for a combatant. The main AI uses the bespoke enemyGroup; bots
  // use their entry in the otherPlayerMeshes map. This is the one intentional
  // per-combatant difference (the main AI's model rig is built separately).
  const getCombatantMesh = (id: string): THREE.Object3D | undefined =>
    id === 'main_ai'
      ? threeRef.current.enemyGroup
      : threeRef.current.otherPlayerMeshes?.get(id)?.group;

  // The (hammer, sword) display-mesh pair for a combatant. The main AI swaps the
  // bespoke enemyGroup rig (enemyHammer/enemySword); bots toggle the hammer/sword
  // sub-meshes on their otherPlayerMeshes entry.
  const getCombatantWeaponMeshes = (id: string): { hammer?: THREE.Object3D; sword?: THREE.Object3D } | undefined =>
    id === 'main_ai'
      ? { hammer: threeRef.current.enemyHammer, sword: threeRef.current.enemySword }
      : threeRef.current.otherPlayerMeshes?.get(id);

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
  // `setLockout` re-arms the swap-lockout timer (the tactical-swap site does; the feint
  // revert and spawn telegraph don't). Convergence vs the old main-only swapEnemyWeapon:
  // the main AI no longer sets the weaponReadyTime swap cooldown (aiSwapCooldownTimer) —
  // that field is inert in the unified attack/lunge tick (only the network-replay
  // triggers still read it) — and drops the HP/paused/LUNGING guards (these call sites
  // are already inside the live AI tick, gated on lockout where it matters).
  const swapCombatantWeapon = (self: any, type: 'hammer' | 'sword', setLockout = false) => {
    const s = stateRef.current;
    self.activeWeapon = type;
    if (setLockout && s.settings.weaponSwapLockout > 0) {
      self.swapLockoutTimer = s.settings.weaponSwapLockout;
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
  // combatant. `mesh` is the combatant's render group (enemyGroup / otherPlayerMeshes).
  const respawnCombatant = (c: Combatant, mesh: THREE.Object3D) => {
    const s = stateRef.current;
    c.hp = c.maxHp;

    const exclude: THREE.Vector3[] = [s.playerPos];
    getAllCombatants().forEach((o) => {
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

    // Main-AI-only flat fields with no bot equivalent.
    if (c.id === 'main_ai') {
      s.aiIsJumping = false;
      s.aiHammerJumpPlanned = false;
      s.aiHammerJumpType = undefined;
      s.aiSwapCooldownTimer = 0;
      s.aiPressureTargetId = undefined;
    }

    mesh.visible = true;
    sfx.playRespawn();
  };

  const updateSingleAIEntity = (botId: string, dt: number) => {
    const s = stateRef.current;
    const isMainAI = botId === 'main_ai';

    // Unified combatant accessor. For additional bots this is the bot state object from
    // otherPlayers; for the main AI it is the persistent Combatant that owns the flat
    // s.aiXxx fields (see getMainAICombatant). All per-entity state flows through `self`
    // (loosely typed so optional Combatant fields don't trip "possibly undefined"),
    // which is what lets one code path serve both instead of `isMainAI ? ... : ...`.
    const self: any = isMainAI ? getMainAICombatant() : s.otherPlayers.get(botId);
    if (!self) return;

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
    // flat vectors in place (self.pos/self.vel alias s.aiPos/s.aiVel), while a bot edits
    // a copy of self.pos/self.vel that syncStateAndMesh writes back.
    const pos = isMainAI ? self.pos : new THREE.Vector3().copy(self.pos);
    const vel = isMainAI ? self.vel : new THREE.Vector3().copy(self.vel);
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
    // main AI `self.pos`/`self.vel` already alias s.aiPos/s.aiVel (so copy is a no-op
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
    const botArchetype = resolveBotArchetype(botId);
    const derivedParams = resolveDerivedAIParams(s.settings, {
      difficulty,
      reactionLatency,
      anticipationFactor,
      movementComplexity,
      weaponSwapIQ,
      aiPlaystyle,
      weaponPrioritization,
    }, botArchetype);
    const personalityFlags = getPersonalityFlags(botArchetype);
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
        const localCooldownMult = (1.3 - 0.8 * playstyleFactor) * matchMultipliers.cooldownMult;
        finishSwordLunge(localCooldownMult, 'target_dead', undefined);
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
      if (s.aiHP > 0 && botId !== 'main_ai' && s.aiState !== 'RESPAWNING') {
        livingPositions.push(s.aiPos);
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

      const spawnPosScore = scorePosition({
        botX: pos.x,
        botZ: pos.z,
        targetX: anticipatedSpawn.x,
        targetZ: anticipatedSpawn.z,
        arenaRadius: s.arenaRadius,
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
    
    const predDistFromCenter = Math.sqrt(predictedTargetPos.x * predictedTargetPos.x + predictedTargetPos.z * predictedTargetPos.z);
    if (predDistFromCenter > s.arenaRadius - 0.6) {
      const angle = Math.atan2(predictedTargetPos.z, predictedTargetPos.x);
      predictedTargetPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
      predictedTargetPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
    }

    const movementTargetPos = targetAirborne && movementComplexity >= 50
      ? ((target.vel?.y ?? 0) < -0.75 ? targetLandingPos : predictedTargetPos)
      : predictedTargetPos;

    const landingDistFromCenter = Math.sqrt(movementTargetPos.x * movementTargetPos.x + movementTargetPos.z * movementTargetPos.z);
    if (landingDistFromCenter > s.arenaRadius - 0.6) {
      const angle = Math.atan2(movementTargetPos.z, movementTargetPos.x);
      movementTargetPos.x = Math.cos(angle) * (s.arenaRadius - 0.6);
      movementTargetPos.z = Math.sin(angle) * (s.arenaRadius - 0.6);
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
    const cooldownMult = (1.3 - 0.8 * playstyleFactor) * matchMultipliers.cooldownMult;

    const targetIsProtected = target.invulnerabilityTimer > 0;
    const targetIsLunging = target.isLunging;

    if (calibrationEnabled) {
      tickCalibrationPendingDodge(s.aiMatchContext, botId, dt, targetIsLunging);
      tickCalibrationPendingCounter(s.aiMatchContext, botId, dt, targetIsLunging);
    }
    const canStartWeaponAction = state !== 'COOLDOWN' || timer <= 0;

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
    const weaponForwardReach =
      (s.settings.attackRange ?? 3.2) * (activeWeapon === 'hammer' ? 0.875 : 1.0);
    const guaranteedKillRange = weaponForwardReach + (s.settings.attackRadius ?? 4.5) * 0.8;
    const enemyInKillRange =
      target.hp > 0 && !targetIsProtected && attackDistanceToTarget <= guaranteedKillRange;
    const selfGrounded = pos.y <= 0.05 && !self.isJumping && Math.abs(vel.y) <= 0.01;

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
        observePlayerPosition(model, s.playerPos.x, s.playerPos.z, s.arenaRadius, nowSeconds);
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
    if (!isMainAI && (self.swapLockoutTimer ?? 0) > 0) {
      self.swapLockoutTimer = Math.max(0, (self.swapLockoutTimer ?? 0) - dt);
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
            s.aiState === 'LUNGING' ||
            s.aiWeaponState === 'swing_up' ||
            s.aiWeaponState === 'swing_down'
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
    };

    const revertWeaponSwapFeint = () => {
      if (activeWeapon !== 'sword') return;
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

      if (attackDistanceToTarget <= resolvedAiReach) {
        state = 'COOLDOWN';
        const isHammerMelee = activeWeapon === 'hammer' && Math.random() < 0.4;
        
        if (activeWeapon === 'sword') {
          timer = (s.settings.swordSlashReload ?? 0.6) * cooldownMult;
        } else if (isHammerMelee) {
          timer = (s.settings.hammerMeleeReload ?? 0.5) * cooldownMult;
        } else {
          timer = (s.settings.hammerReloadTime ?? 0.6) * cooldownMult;
        }

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
        mainAiIsLunging: target.id === 'main_ai' && s.aiState === 'LUNGING',
        mainAiLungeDirX: s.aiLungeTargetDir.x,
        mainAiLungeDirZ: s.aiLungeTargetDir.z,
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
        mainAiIsLunging: target.id === 'main_ai' && s.aiState === 'LUNGING',
        mainAiLungeDirX: s.aiLungeTargetDir.x,
        mainAiLungeDirZ: s.aiLungeTargetDir.z,
        botIsLunging: !!targetOtherBot?.isLunging,
        botLungeDirX: targetOtherBot?.lungeTargetDir?.x,
        botLungeDirZ: targetOtherBot?.lungeTargetDir?.z,
      });

      if (tacticalDecision.bulltrueCounter === 'hammer' && canStartWeaponAction && activeWeapon === 'hammer' && weaponState === 'ready') {
        state = 'COOLDOWN';
        timer = (s.settings.hammerReloadTime ?? 1.1) * cooldownMult;
        triggerCombatantAttack(self, 'hammer');
        weaponState = 'swing_up';
        startedBulltrueCounter = true;
      } else if (tacticalDecision.bulltrueCounter === 'sword' && canStartWeaponAction && activeWeapon === 'sword' && weaponState === 'ready') {
        state = 'COOLDOWN';
        timer = (s.settings.swordSlashReload ?? 0.6) * cooldownMult;
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
          hammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
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
        timer = 1.0 * cooldownMult;
        triggerCombatantAttack(self, 'hammer');
      } else if (!enemyInKillRange && verticalDeltaToTarget > 2.0 && distanceToTarget <= resolvedDangerZone + 4.5 && Math.random() < 0.012 + tunedAnticipationFactor * 0.035) {
        if (startAIHammerJump(self, pos, vel, toTarget, 'offensive')) {
          weaponState = 'swing_up';
          hammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
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
          if (s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
            s.aiState === 'LUNGING' || s.aiWeaponState === 'swing_up' || s.aiWeaponState === 'swing_down' || (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
          )) {
            tradeReason = 'sword_vs_sword';
          } else if (s.settings.enableHammerSwordTrade && s.aiActiveWeapon === 'hammer' && (
            s.aiWeaponState === 'swing_up' || s.aiWeaponState === 'swing_down' || (Date.now() - s.lastAIHammerAttackTime <= hammerThreshold)
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
          s.aiHP -= 1;
          finishSwordLunge(cooldownMult, 'hit', target.id);
          sfx.playExplosion();
          spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');

          if (s.aiHP <= 0) {
            s.aiHP = 0;
            s.aiState = 'RESPAWNING';
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
      const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (distFromCenter >= s.arenaRadius - 0.65) {
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
        timer = (activeWeapon === 'sword' ? (s.settings.swordSlashReload ?? 0.6) : 1.1) * cooldownMult;
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
          hammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
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

        if (attackDistanceToTarget <= resolvedAiReach && weaponState === 'ready' && target.hp > 0 && !targetIsProtected) {
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
            timer = (activeWeapon === 'sword' ? (s.settings.swordSlashReload ?? 0.6) : 1.1) * cooldownMult;
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
            aiReach: resolvedAiReach,
            minLungeRange,
            maxLungeRange,
            weaponReady: weaponState === 'ready',
            targetProtected: targetIsProtected,
          };

          if (canStartWeaponAction && shouldPressureReSwing(pressureAttack) && !isCoordAttackBlocked()) {
            const baseCooldown = activeWeapon === 'sword'
              ? (s.settings.swordSlashReload ?? 0.6)
              : 1.1;
            timer = Math.max(timer, getPressureAttackCooldown(effectivePressureAggression, baseCooldown));
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
    // flag. (For the main AI vel === s.aiVel, so this is the same data either way.)
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
      {/* Floating Nameplate Overlay (New!) */}
      <div 
        ref={nameplateRef}
        style={{
          position: 'absolute',
          display: 'none',
          transform: 'translate(-50%, -100%)',
          fontWeight: 'black',
          fontFamily: 'monospace',
          pointerEvents: 'none',
          textShadow: '0 0 4px rgba(0,0,0,0.85), 0 0 10px rgba(0,0,0,0.5)',
          zIndex: 10,
          whiteSpace: 'nowrap',
          transition: 'color 0.15s, font-size 0.15s, opacity 0.15s'
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
