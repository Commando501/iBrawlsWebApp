/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { buildGravityHammerModel, buildVoxelSpartanModel, buildKatarSwordModel } from './VoxelModels';
import { GameStats, Stance, WeaponState, AIBehaviorState, UniversalSettings, DeathEvent, Keybindings, DEFAULT_KEYBINDINGS, DeviceInfo, AIBehaviorPreset, MedalInfo } from '../types';
import {
  AI_FORCED_DESCENT_SPEED,
  AI_MAX_AIRBORNE_HEIGHT,
  recoverAIFromRunawayAltitude as applyAIAltitudeRecovery,
} from '../game/aiAltitude';
import { type AILungeOutcome, type AITacticalTargetSnapshot, evaluateAICombatDecision } from '../game/aiCombatDecision';
import { evaluateKillMedals } from '../game/rewards';
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
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nameplateRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number | null>(null);
  const fpsRef = useRef({
    frameCount: 0,
    lastSampleTime: 0,
    value: 0,
  });

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
    activeWeapon: 'hammer' | 'sword';
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
    otherPlayers: Map<string, any>;
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
    otherPlayers: new Map<string, any>(),

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
    const maxRadius = Math.max(0, s.arenaRadius - 0.6);
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

  const recoverAIFromRunawayAltitude = (pos: THREE.Vector3, vel: THREE.Vector3, botState?: any) => {
    applyAIAltitudeRecovery(pos, vel, botState, {
      maxAirborneHeight: AI_MAX_AIRBORNE_HEIGHT,
      forcedDescentSpeed: AI_FORCED_DESCENT_SPEED,
      hammerJumpCooldown: AI_HAMMER_JUMP_COOLDOWN,
    });
  };

  const recoverMainAIFromRunawayAltitude = () => {
    const s = stateRef.current;
    if (s.aiPos.y <= AI_MAX_AIRBORNE_HEIGHT) return;

    recoverAIFromRunawayAltitude(s.aiPos, s.aiVel);
    s.aiIsJumping = true;
    s.aiHammerJumpPlanned = false;
    s.aiHammerJumpType = undefined;
    s.aiHammerJumpWindowTimer = 0;
    s.aiHammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
    if (s.aiWeaponState !== 'recovering') {
      s.aiWeaponState = 'ready';
      s.aiWeaponTimer = 0;
    }
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
      reactionLatency = adminSettings.aiReactionLatency ?? 0.25;
      anticipationFactor = adminSettings.aiAnticipationFactor ?? 0.40;
      movementComplexity = adminSettings.aiMovementComplexity ?? 50;
      weaponSwapIQ = adminSettings.aiWeaponSwapIQ ?? 50;
      aiPlaystyle = adminSettings.aiPlaystyle ?? 50;
      weaponPrioritization = adminSettings.aiWeaponPrioritization ?? 50;
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

  const finishMainAISwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string) => {
    const s = stateRef.current;
    s.aiWeaponState = 'ready';
    s.aiIsJumping = s.aiPos.y > 0.01 || Math.abs(s.aiVel.y) > 0.01;
    s.aiLastLungeOutcome = outcome;
    s.aiLastLungeTargetId = targetId;
    s.aiPostLungeDecisionTimer = outcome === 'miss_timeout' || outcome === 'miss_arena' ? 1.35 : 0.35;

    let enteredPressure = false;
    if (outcome === 'hit' && targetId) {
      recordBotDamageTag('main_ai', targetId);
      const targetHp = targetId === 'player'
        ? s.playerHP
        : targetId === 'main_ai'
          ? s.aiHP
          : (s.otherPlayers?.get(targetId)?.hp ?? 0);
      const targetInvuln = targetId === 'player'
        ? s.playerInvulnerabilityTimer
        : targetId === 'main_ai'
          ? s.aiInvulnerabilityTimer
          : (s.otherPlayers?.get(targetId)?.invulnerabilityTimer ?? 0);
      enteredPressure = tryEnterPressureState('main_ai', targetId, targetHp, targetInvuln);
      if (targetHp > 0) {
        tryStartComboOnHit('main_ai', targetId, 'sword');
      }
    }

    if (!enteredPressure) {
      s.aiState = 'COOLDOWN';
      s.aiTimer = (s.settings.swordLungeReload ?? 1.2) * cooldownMultiplier;
    }

    if (s.aiIsJumping) {
      s.aiVel.x = 0;
      s.aiVel.z = 0;
      s.aiVel.y = Math.min(s.aiVel.y, 0);
    } else {
      s.aiVel.set(0, 0, 0);
    }
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

    // Respawn timers for offline bots (combat updates run after main AI).
    if (s.otherPlayers) {
      s.otherPlayers.forEach((bot) => {
        if (!bot.id.startsWith('bot_')) return;
        const botMesh = threeRef.current.otherPlayerMeshes?.get(bot.id)?.group;
        if (!botMesh) return;

        if (bot.hp <= 0) {
          botMesh.visible = false;
          bot.respawnTimer = Math.max(0, bot.respawnTimer - dt);
          if (bot.respawnTimer <= 0) {
            bot.hp = bot.maxHp;

            const exclude: THREE.Vector3[] = [s.playerPos, s.aiPos];
            s.otherPlayers.forEach(o => {
              if (o.id !== bot.id && o.hp > 0 && o.respawnTimer <= 0) {
                exclude.push(new THREE.Vector3(o.pos.x, o.pos.y, o.pos.z));
              }
            });
            const spawnPos = getOptimalSpawnPoint(exclude);
            bot.pos.copy(spawnPos);
            bot.vel.set(0, 0, 0);
            bot.yaw = getInwardSpawnYaw(spawnPos);
            bot.weaponState = 'ready';
            bot.weaponTimer = 0;
            bot.aiHammerJumpCooldownTimer = 0;
            bot.invulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
            bot.spawnTime = Date.now();

            // Reset combat state so the respawned bot re-acquires and closes on
            // targets. Without this the bot keeps its pre-death micro-spacing
            // state (SIDE_STEPPING/COOLDOWN/etc), which never returns to
            // APPROACHING and only reacts once a target enters melee range.
            bot.aiState = 'APPROACHING';
            bot.aiTimer = 0;
            bot.isLunging = false;
            bot.aiDashRemaining = 0;
            bot.aiLastLungeOutcome = undefined;
            bot.aiLastLungeTargetId = undefined;
            bot.aiPostLungeDecisionTimer = 0;
            bot.aiPendingPostEvasionCharge = false;
            bot.aiCoordCommitTimer = 0;
            bot.swapLockoutTimer = 0;
            clearBotComboState(s.aiMatchContext, bot.id);
            clearPressureTarget(bot.id);

            botMesh.visible = true;
            sfx.playRespawn();
          }
        }
      });
    }

    // Is the enemy currently dead and counting down respawn?
    if (s.aiHP <= 0 || s.aiState === 'RESPAWNING') {
      // Hide model
      enemyMesh.visible = false;
      
      s.enemyRespawnTimer -= dt;
      if (s.enemyRespawnTimer <= 0) {
        s.aiHP = s.aiMaxHP;
        s.aiState = 'APPROACHING';
        
        const exclude: THREE.Vector3[] = [s.playerPos];
        if (s.otherPlayers) {
          s.otherPlayers.forEach((other) => {
            if (other.hp > 0 && other.respawnTimer <= 0) {
              exclude.push(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
            }
          });
        }
        
        const spawnPos = getOptimalSpawnPoint(exclude);
        s.aiPos.copy(spawnPos);
        s.aiVel.set(0, 0, 0);
        s.aiYaw = getInwardSpawnYaw(spawnPos);
        enemyMesh.visible = true;
        s.aiWeaponState = 'ready';
        s.aiHammerJumpPlanned = false;
        s.aiHammerJumpType = undefined;
        s.aiHammerJumpCooldownTimer = 0;
        s.aiLastLungeOutcome = undefined;
        s.aiLastLungeTargetId = undefined;
        s.aiPostLungeDecisionTimer = 0;
        s.aiPressureTargetId = undefined;
        s.aiInvulnerabilityTimer = s.settings.respawnInvulnerabilityDuration;
        s.aiSpawnTime = Date.now();
        s.aiSwapLockoutTimer = 0;
        s.aiSwapCooldownTimer = 0;
        s.aiTimer = 0;
        s.aiDashRemaining = 0;
        s.aiPendingPostEvasionCharge = false;
        s.aiCoordCommitTimer = 0;
        clearBotComboState(s.aiMatchContext, 'main_ai');
        sfx.playRespawn();

      }
    }
    // Main AI Sword Lunge state execution
    else if (s.aiState === 'LUNGING') {
      enemyMesh.visible = true;
      s.aiLungeTimer += dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      s.aiVel.x = s.aiLungeTargetDir.x * lungeSpeed;
      s.aiVel.z = s.aiLungeTargetDir.z * lungeSpeed;
      s.aiVel.y -= GRAVITY_ACCELERATION * dt;
      
      s.aiPos.addScaledVector(s.aiVel, dt);
      if (s.aiPos.y <= 0) {
        s.aiPos.y = 0;
        s.aiVel.y = 0;
      }
      constrainCombatantToArena(s.aiPos, s.aiVel);
      enemyMesh.position.copy(s.aiPos);
      
      const trailPos = s.aiPos.clone();
      trailPos.y += 0.825;
      renderSwordLungeTrailVfx(trailPos, '#ef4444', s.aiLungeTargetDir, 'enemyCube');
      
      const target = getBestTacticalTarget('main_ai', s.aiPos, (botDifficulties as any)?.main_ai || s.settings.aiDifficulty || 'normal');
      if (target) {
        const dist = getCombatBodyCenter(s.aiPos, s.aiIsCrouching).distanceTo(getCombatBodyCenter(target.pos, target.isCrouching));
        if (target.hp <= 0) {
          finishMainAISwordLunge(1, 'target_dead', target.id);
        } else if (dist <= 1.5) {
          const swordThreshold = s.settings.swordTradeWindow ?? 350;
          const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;
          const isPlayerSwordActiveAttack = s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
            s.isLunging ||
            s.pSwordState === 'slashing' ||
            (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
          );
          const isPlayerHammerActiveAttack = s.settings.enableHammerSwordTrade && s.activeWeapon === 'hammer' && (
            s.pWeaponState === 'swing_up' ||
            s.pWeaponState === 'swing_down' ||
            (Date.now() - s.lastPlayerHammerAttackTime <= hammerThreshold)
          );

          if (target.id === 'player' && isPlayerSwordActiveAttack) {
            executeTrade('sword_vs_sword');
          } else if (target.id === 'player' && isPlayerHammerActiveAttack) {
            executeTrade('sword_lunge_vs_hammer');
          } else {
            if (target.id === 'player') {
              recordPlayerDamageTaken();
              s.playerHP -= 1;
              finishMainAISwordLunge(1, 'hit', target.id);
              
              sfx.playExplosion();
              spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');
              
              s.lastAIStrikePos = s.playerPos.clone();
              s.lastAIStrikeTick = 1.2;
              
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
                  attacker: 'Red (AI) [Lunge]',
                  victim: 'Blue (You)',
                  weapon: 'sword',
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
                recordBotPsychKill('main_ai', 'player', true);
              } else {
                sfx.playSwing();
                spawnVoxelShockwaveParticles(s.playerPos, '#e2e8f0');
              }
            } else {
              const other = s.otherPlayers?.get(target.id);
              if (other) {
                other.hp -= 1;
                finishMainAISwordLunge(1, 'hit', target.id);
                
                sfx.playExplosion();
                spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                
                s.lastAIStrikePos = new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z);
                s.lastAIStrikeTick = 1.2;
                
                if (other.hp <= 0) {
                  other.hp = 0;
                  other.respawnTimer = 3.0;
                  s.scoreEnemy += 1;
                  s.enemyKills += 1;
                  other.deaths = (other.deaths || 0) + 1;
                  sfx.playDeath();
                  
                  const newDeath: DeathEvent = {
                    id: Math.random().toString(36).substring(2, 9),
                    attacker: 'Red (AI) [Lunge]',
                    victim: other.playerName,
                    weapon: 'sword'
                  };
                  s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                  spawnVoxelShockwaveParticles(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z), '#ef4444');
                  recordBotPsychKill('main_ai', target.id, true);
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

      if (s.aiState === 'LUNGING') {
        const startDist = s.aiPos.distanceTo(s.aiLungeStartPos);
        if (startDist > 16.0 || s.aiLungeTimer > 0.8) {
          finishMainAISwordLunge(1, 'miss_timeout', target?.id);
        }
        
        const distFromCenter = Math.sqrt(s.aiPos.x * s.aiPos.x + s.aiPos.z * s.aiPos.z);
        if (distFromCenter >= s.arenaRadius - 0.6) {
          constrainCombatantToArena(s.aiPos, s.aiVel);
          finishMainAISwordLunge(1, 'miss_arena', target?.id);
        }
      }
    }
    // Main AI Combat update (Standard)
    else {
      enemyMesh.visible = true;
      updateSingleAIEntity('main_ai', true, dt);
    }

    // ALWAYS update other players/bots!
    if (s.otherPlayers) {
      s.otherPlayers.forEach((bot) => {
        if (!bot.id.startsWith('bot_')) return;
        const botMesh = threeRef.current.otherPlayerMeshes?.get(bot.id)?.group;
        if (!botMesh) return;
        if (bot.hp <= 0) return;

        botMesh.visible = true;
        updateSingleAIEntity(bot.id, false, dt);
      });
    }
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
        camera.position.copy(cameraPos);
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
      weaponReady: s.activeWeapon === 'hammer' ? s.pWeaponReady : s.pSwordReady,
      weaponCooldown: s.activeWeapon === 'hammer' ? (s.pWeaponCooldown ?? 1.0) : s.pSwordCooldown,
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

    if (s.playerHP > 0 && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      const eyePos = new THREE.Vector3(
        s.playerPos.x,
        1.65 - s.crouchAmount + s.playerPos.y,
        s.playerPos.z
      );
      const enemyCenter = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 0.825, s.aiPos.z);
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
          const headPos = new THREE.Vector3(s.aiPos.x, s.aiPos.y + 1.75, s.aiPos.z);
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
      nameplate.textContent = isMultiplayer ? (opponentNameRef.current || opponentClientId || 'Opponent') : (opponentPlayerName || opponentNameRef.current || 'AI Bot');
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
    s.isObserverMode = (multiplayerRole === 'observer');

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
            if (data.action === 'swing_hammer') {
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
    otherPlayerMeshes: Map<string, {
      group: THREE.Group;
      hammer: THREE.Group;
      sword: THREE.Group;
    }>;
  }>({
    scene: null,
    camera: null,
    renderer: null,
    playerHammer: null,
    playerSword: null,
    enemyGroup: null,
    enemyHammer: null,
    enemySword: null,
    hostGroup: null,
    hostHammer: null,
    hostSword: null,
    otherPlayerMeshes: new Map(),

    debugPlayerSphere: null,
    debugEnemySphere: null,
    playerJumpZoneMesh: null,
    ambientLight: null,
    dirLight: null,
    damageExplosionParticles: [],
    hammerSplashFlashes: [],
    swordLungeSpeedLines: [],
    burnDecals: [],
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
    if (excludePositions.length === 0) {
      return SPAWN_POINTS[0].clone();
    }
    let bestPoint = SPAWN_POINTS[0];
    let bestMinDist = -1;
    for (const point of SPAWN_POINTS) {
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
      if (child instanceof THREE.Group && child.children.length === 2 && child.parent === scene) {
        const pos = child.position;
        const angle = Math.atan2(pos.z, pos.x);
        const targetRadius = 20.3 * scale;
        child.position.set(Math.cos(angle) * targetRadius, 2, Math.sin(angle) * targetRadius);
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

      meshes = { group, hammer, sword };
      threeRef.current.otherPlayerMeshes.set(clientId, meshes);
    }

    const { group, hammer, sword } = meshes;
    group.position.copy(playerState.pos);
    group.rotation.y = playerState.yaw;
    
    if (playerState.isCrouching) {
      group.scale.set(1, 0.65, 1);
    } else {
      group.scale.set(1, 1, 1);
    }

    hammer.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'hammer';
    sword.visible = playerState.hp > 0 && playerState.respawnTimer <= 0 && playerState.activeWeapon === 'sword';
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

    // Dark slate space background configured via skybox settings
    const initialHue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 224;
    const initialBrightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 4;
    const skyColorString = `hsl(${initialHue}, 70%, ${initialBrightness}%)`;
    scene.background = new THREE.Color(skyColorString); 
    scene.fog = new THREE.FogExp2(skyColorString, 0.025);

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

    // 2. SCENE LIGHTS
    const ambientLight = new THREE.AmbientLight('#1e293b', adminSettings.ambientLightIntensity !== undefined ? adminSettings.ambientLightIntensity : 0.82); // soft slate ambient fill
    scene.add(ambientLight);
    threeRef.current.ambientLight = ambientLight;

    const dirLight = new THREE.DirectionalLight('#ffffff', adminSettings.directLightIntensity !== undefined ? adminSettings.directLightIntensity : 1.6);
    dirLight.position.set(5, 20, 5);
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

    // Primary energy pole or central bright node
    const pointLight = new THREE.PointLight('#38bdf8', 2.0, 30);
    pointLight.position.set(0, 10, 0);
    scene.add(pointLight);

    // 3. ARENA CREATION
    // Let's create an elegant textured circle arena on the fly using standard HTML Canvas
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 512;
    gridCanvas.height = 512;
    const gCtx = gridCanvas.getContext('2d')!;
    
    // Fill background deep dark metal blue
    gCtx.fillStyle = '#050b1a';
    gCtx.fillRect(0, 0, 512, 512);

    // Radial grids with cyan/blue accents
    gCtx.strokeStyle = 'rgba(56, 189, 248, 0.4)'; // glowing sky blue
    gCtx.lineWidth = 4;
    const center = 256;
    
    // Draw concentric circles representing high-tech boundary lines
    for (let r = 50; r <= 250; r += 50) {
      gCtx.beginPath();
      gCtx.arc(center, center, r, 0, Math.PI * 2);
      gCtx.stroke();
    }

    // Radial fangs/directions
    gCtx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
    gCtx.lineWidth = 2;
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      gCtx.beginPath();
      gCtx.moveTo(center, center);
      gCtx.lineTo(
        center + Math.cos(angle) * 250,
        center + Math.sin(angle) * 250
      );
      gCtx.stroke();
    }

    // Outer boundary rim glow
    gCtx.strokeStyle = '#1d4ed8'; // blue border
    gCtx.lineWidth = 14;
    gCtx.beginPath();
    gCtx.arc(center, center, 248, 0, Math.PI * 2);
    gCtx.stroke();

    const gridTexture = new THREE.CanvasTexture(gridCanvas);
    gridTexture.wrapS = THREE.RepeatWrapping;
    gridTexture.wrapT = THREE.RepeatWrapping;

    // Floor Mesh
    const floorGeo = new THREE.CylinderGeometry(20, 20, 0.2, 64);
    const floorMat = new THREE.MeshStandardMaterial({
      map: gridTexture,
      roughness: 0.4,
      metalness: 0.85,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    scene.add(floor);

    // Simple vertical wall border or columns to make it look like a physical arena room
    const wallGroup = new THREE.Group();
    scene.add(wallGroup);

    // Make an outer particle glow system around the ring
    const columnGeo = new THREE.BoxGeometry(0.5, 4, 0.5);
    const columnMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      emissive: '#1e1b4b',
      roughness: 0.9,
    });

    const pillarLightMat = new THREE.MeshStandardMaterial({
      color: '#0284c7',
      emissive: '#38bdf8',
      emissiveIntensity: 1.0,
    });

    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 6) {
      const x = Math.cos(angle) * 20.3;
      const z = Math.sin(angle) * 20.3;
      
      const column = new THREE.Group();
      column.position.set(x, 2, z);
      column.userData.angle = angle; // Store angle for dynamic scaling!
      
      // Main pillar body
      const body = new THREE.Mesh(columnGeo, columnMat);
      body.castShadow = true;
      body.receiveShadow = true;
      column.add(body);

      // Programmatic Voxel energy detail on pillars
      const energyDet = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2, 0.6), pillarLightMat);
      energyDet.position.set(0, 0, -0.1);
      column.add(energyDet);

      column.lookAt(0, 2, 0); // Outward facing
      wallGroup.add(column);
    }

    // 4. PROGRAMMATIC VOXEL CHARACTER ENEMY
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
          s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
          console.log('Spectator Target cycled to:', s.observerTarget);
          pushStatsUpdate();
        }
        return;
      }

      if (s.playerHP <= 0) return;

      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const clickedBtn = mouseMap[e.button] || '';

      if (clickedBtn === keybindingsRef.current.attack) {
        // PRIMARY ATTACK: Hammer Slam or Sword Lunge
        if (s.activeWeapon === 'hammer') {
          if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
            triggerPlayerHammerSwing();
          }
        } else {
          // SWORD LUNGE
          if (s.crosshairColor === 'red' && s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordLunge();
          }
        }
      } else if (clickedBtn === keybindingsRef.current.altAttack) {
        // ALT ATTACK: Sword Slash
        if (s.activeWeapon === 'sword') {
          if (s.pSwordReady && s.pSwordState === 'ready' && !s.isLunging) {
            triggerPlayerSwordSlash();
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

    const handleCycleObserverTarget = () => {
      const s = stateRef.current;
      if (!s || !s.isObserverMode) return;
      s.observerTarget = s.observerTarget === 'host' ? 'client' : 'host';
      console.log('Spectator Target toggled to:', s.observerTarget);
      pushStatsUpdate();
    };

    window.addEventListener('cycle-observer-mode', handleCycleObserverMode);
    window.addEventListener('cycle-observer-target', handleCycleObserverTarget);

    // Trigger initial score stats update quickly
    pushStatsUpdate();

    // 7. INITIAL WORKSPACE DESTROY/CLEANUP SCOPING
    return () => {
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

  // Handle active game cycles
  useEffect(() => {
    if (!isPlaying || isPaused) return;

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

      // Lazy build Host Spartan model when entering spectator mode
      if (s.isObserverMode && !threeRef.current.hostGroup) {
        rebuildHostModel(s.hostHue);
      }

      // Execute game logics
      updatePhysics(dt);
      updateHammerAnimations(dt);
      updateAI(dt);
      updateCharacterSkeletalAnimations(dt);
      updateExplosionParticles(dt);
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

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
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
    if (!s.isObserverMode) {
      return {
        id: 'player',
        pos: s.playerPos,
        hp: s.playerHP,
        invuln: s.playerInvulnerabilityTimer,
        isLunging: s.isLunging,
        weaponState: s.pWeaponState,
        respawnTimer: s.playerRespawnTimer,
        vel: s.playerVel,
        isCrouching: s.isCrouching,
        isObserver: false,
        playerName: s.settings.playerName || 'Blue (You)'
      };
    }
    
    // Find closest bot
    let closestBot: any = null;
    let closestDist = Infinity;
    if (s.otherPlayers) {
      s.otherPlayers.forEach((other) => {
        if (other.hp > 0 && other.respawnTimer <= 0) {
          const dist = s.aiPos.distanceTo(new THREE.Vector3(other.pos.x, other.pos.y, other.pos.z));
          if (dist < closestDist) {
            closestDist = dist;
            closestBot = other;
          }
        }
      });
    }
    
    if (closestBot) {
      return {
        id: closestBot.id,
        pos: new THREE.Vector3(closestBot.pos.x, closestBot.pos.y, closestBot.pos.z),
        hp: closestBot.hp,
        invuln: 0,
        isLunging: closestBot.weaponState === 'swing_up' || closestBot.weaponState === 'swing_down',
        weaponState: closestBot.weaponState,
        respawnTimer: closestBot.respawnTimer,
        vel: new THREE.Vector3(closestBot.vel.x, closestBot.vel.y, closestBot.vel.z),
        isCrouching: closestBot.isCrouching || false,
        isObserver: false,
        playerName: closestBot.playerName
      };
    }
    
    return null;
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

  // SWAPS PLAYER WEAPON
  const swapPlayerWeapon = (type: 'hammer' | 'sword') => {
    const s = stateRef.current;
    if (s.playerHP <= 0 || isPaused || !isPlaying) return;
    if (s.isLunging) return; // cannot switch weapon during lunge

    if (s.swapLockoutTimer > 0) return;

    if (s.activeWeapon !== type) {
      s.activeWeapon = type;
      recordLocalPlayerObservation((model) => observePlayerWeaponSwap(model, type));
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
    if (hammer && sword) {
      if (type === 'hammer') {
        hammer.visible = true;
        sword.visible = false;
      } else {
        hammer.visible = false;
        sword.visible = true;
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

  // SWAPS ENEMY WEAPON
  const swapEnemyWeapon = (type: 'hammer' | 'sword') => {
    const s = stateRef.current;
    if (s.aiHP <= 0 || isPaused || !isPlaying) return;
    if (s.aiState === 'LUNGING') return;

    if (s.aiSwapLockoutTimer > 0) return;

    if (s.aiActiveWeapon !== type) {
      s.aiActiveWeapon = type;
      if (s.settings.weaponReadyTime > 0) {
        s.aiSwapCooldownTimer = s.settings.weaponReadyTime;
      }
      if (s.settings.weaponSwapLockout > 0) {
        s.aiSwapLockoutTimer = s.settings.weaponSwapLockout;
      }
    }

    const hammer = threeRef.current.enemyHammer;
    const sword = threeRef.current.enemySword;
    if (hammer && sword) {
      if (type === 'hammer') {
        hammer.visible = true;
        sword.visible = false;
      } else {
        hammer.visible = false;
        sword.visible = true;
      }
    }
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

  const executeCustomBotTrade = (attackerBot: any, target: any) => {
    const s = stateRef.current;
    const tradeText = 'Sword Trade';

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
        recordDeathEvent(`${getLocalPlayerFeedName()} [${tradeText}]`, attackerBot.playerName, medals, 'sword_vs_sword');
      } else if (target.id === 'main_ai') {
        s.scoreEnemy += 1;
        s.enemyKills += 1;
        recordDeathEvent(`Red (AI) [${tradeText}]`, attackerBot.playerName, undefined, 'sword_vs_sword');
      } else {
        const targetBot = s.otherPlayers.get(target.id);
        if (targetBot) {
          targetBot.score = (targetBot.score || 0) + 1;
          targetBot.kills = (targetBot.kills || 0) + 1;
          recordDeathEvent(`${targetBot.playerName} [${tradeText}]`, attackerBot.playerName, undefined, 'sword_vs_sword');
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
      recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, getLocalPlayerFeedName(), undefined, 'sword_vs_sword');
      spawnVoxelShockwaveParticles(s.playerPos, '#3b82f6');
    } else if (target.id === 'main_ai' && s.aiHP <= 0) {
      s.aiHP = 0;
      s.aiState = 'RESPAWNING';
      s.enemyRespawnTimer = 3.0;
      s.enemyDeaths += 1;
      recordBotCalibrationDeath('main_ai');
      attackerBot.score = (attackerBot.score || 0) + 1;
      attackerBot.kills = (attackerBot.kills || 0) + 1;
      recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, 'Red (AI)', undefined, 'sword_vs_sword');
      spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');
    } else if (target.id !== 'player' && target.id !== 'main_ai') {
      const targetBot = s.otherPlayers.get(target.id);
      if (targetBot && targetBot.hp <= 0) {
        targetBot.hp = 0;
        targetBot.respawnTimer = 3.0;
        targetBot.deaths = (targetBot.deaths || 0) + 1;
        attackerBot.score = (attackerBot.score || 0) + 1;
        attackerBot.kills = (attackerBot.kills || 0) + 1;
        recordDeathEvent(`${attackerBot.playerName} [${tradeText}]`, targetBot.playerName, undefined, 'sword_vs_sword');
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
        
        // Rise and Lower controls
        if (keysPressed.current[keybindings.jump] || keysPressed.current['spacebar']) moveUp += 1;
        if (keysPressed.current[keybindings.crouch]) moveUp -= 1;

        const speedMultiplier = keysPressed.current['shift'] ? 2.8 : 1.0;
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
      const isSprinting = s.settings.enableSprint && keysPressed.current[keybindingsRef.current.sprint] && moveForward > 0 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0;
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

    // Handle AI Gravity Physics
    if (s.aiIsJumping) {
      recoverMainAIFromRunawayAltitude();
      s.aiVel.y -= GRAVITY_ACCELERATION * dt;
      s.aiPos.y += s.aiVel.y * dt;
      
      // Integrate airborne horizontal velocities
      s.aiPos.x += s.aiVel.x * dt;
      s.aiPos.z += s.aiVel.z * dt;

      // Ground collision
      if (s.aiPos.y <= 0) {
        s.aiPos.y = 0;
        s.aiVel.set(0, 0, 0); // clear airborne velocities
        s.aiIsJumping = false;
      }
    } else if (s.aiState !== 'LUNGING') {
      s.aiPos.y = 0;
      s.aiVel.y = 0;
    }
    recoverMainAIFromRunawayAltitude();

    // Integrate absolute positions
    if (!playerIsDead) {
      s.playerPos.x += s.playerVel.x * dt;
      s.playerPos.z += s.playerVel.z * dt;
    }
    constrainCombatantToArena(s.aiPos, s.aiVel);

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
      } else {
        playerHammer.visible = false;
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

    if (botId !== 'main_ai' && s.aiHP > 0 && s.aiState !== 'RESPAWNING') {
      potentialTargets.push({
        id: 'main_ai',
        pos: s.aiPos,
        hp: s.aiHP,
        maxHp: s.aiMaxHP,
        invulnerabilityTimer: s.aiInvulnerabilityTimer,
        activeWeapon: s.aiActiveWeapon,
        weaponState: s.aiState === 'COOLDOWN' && s.aiTimer > 0 ? 'recovering' : s.aiWeaponState,
        isLunging: s.aiState === 'LUNGING',
        dashCooldownRemaining: s.aiDashCooldownTimer,
        swapLockoutRemaining: s.aiSwapLockoutTimer,
        vel: s.aiVel,
        isCrouching: s.aiIsCrouching,
        playerName: 'Red (AI)'
      });
    }

    if (s.otherPlayers) {
      s.otherPlayers.forEach((other) => {
        if (other.id !== botId && other.hp > 0 && other.respawnTimer <= 0) {
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
    }

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

  const canStartAIHammerJump = (isMainAI: boolean, botState: any, pos: THREE.Vector3, vel: THREE.Vector3): boolean => {
    const s = stateRef.current;
    const cooldown = isMainAI ? s.aiHammerJumpCooldownTimer : (botState?.aiHammerJumpCooldownTimer ?? 0);
    const isAirborne = isMainAI
      ? (s.aiIsJumping || pos.y > AI_HAMMER_JUMP_START_MAX_HEIGHT || Math.abs(s.aiVel.y) > AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON)
      : (pos.y > AI_HAMMER_JUMP_START_MAX_HEIGHT || Math.abs(vel.y) > AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON);

    return cooldown <= 0 && !isAirborne;
  };

  const startAIHammerJump = (
    isMainAI: boolean,
    botState: any,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType: 'offensive' | 'defensive' = 'offensive'
  ): boolean => {
    const s = stateRef.current;
    if (!canStartAIHammerJump(isMainAI, botState, pos, vel)) {
      return false;
    }

    if (isMainAI) {
      s.aiHammerJumpPlanned = true;
      s.aiHammerJumpType = jumpType;
      s.aiHammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
      triggerEnemyHammerSwing();
    } else {
      botState!.weaponState = 'swing_up';
      botState!.weaponTimer = 0;
      botState!.vel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
      vel.y = botState!.vel.y;
      if (horizontalHeading && horizontalHeading.lengthSq() > 0.0001) {
        const jumpHeading = horizontalHeading.clone().normalize();
        botState!.vel.x = jumpHeading.x * 6.5;
        botState!.vel.z = jumpHeading.z * 6.5;
        vel.x = botState!.vel.x;
        vel.z = botState!.vel.z;
      }
      botState!.aiHammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
      sfx.playSwing();
      sfx.playJump();
    }

    return true;
  };

  const updateSingleAIEntity = (botId: string, isMainAI: boolean, dt: number) => {
    const s = stateRef.current;
    const botState = isMainAI ? null : s.otherPlayers.get(botId);
    if (!isMainAI && !botState) return;

    const botMesh = isMainAI 
      ? threeRef.current.enemyGroup 
      : threeRef.current.otherPlayerMeshes?.get(botId)?.group;
    if (!botMesh) return;

    const hp = isMainAI ? s.aiHP : botState!.hp;
    if (hp <= 0) return;

    // Tick down invulnerability timer
    if (isMainAI) {
      if (s.aiInvulnerabilityTimer > 0) {
        s.aiInvulnerabilityTimer = Math.max(0, s.aiInvulnerabilityTimer - dt);
      }
    } else {
      if (botState!.invulnerabilityTimer && botState!.invulnerabilityTimer > 0) {
        botState!.invulnerabilityTimer = Math.max(0, botState!.invulnerabilityTimer - dt);
      }
    }

    if (isMainAI) {
      if (!s.aiState) s.aiState = 'APPROACHING';
      if (s.aiTimer === undefined) s.aiTimer = 0;
      if (s.aiSwayTimer === undefined) s.aiSwayTimer = 0;
      if (s.aiDashCooldownTimer === undefined) s.aiDashCooldownTimer = 0;
      if (s.aiDashRemaining === undefined) s.aiDashRemaining = 0;
      if (s.aiDashDir === undefined) s.aiDashDir = new THREE.Vector3();
      if (s.aiSlideActive === undefined) s.aiSlideActive = false;
      if (s.aiSlideDistanceTraveled === undefined) s.aiSlideDistanceTraveled = 0;
      if (s.aiSlideCooldownTimer === undefined) s.aiSlideCooldownTimer = 0;
      if (s.aiPostLungeDecisionTimer === undefined) s.aiPostLungeDecisionTimer = 0;
      if (s.aiPendingPostEvasionCharge === undefined) s.aiPendingPostEvasionCharge = false;
    } else {
      const b = botState!;
      if (!b.aiState) b.aiState = 'APPROACHING';
      if (b.aiTimer === undefined) b.aiTimer = 0;
      if (b.aiSwayTimer === undefined) b.aiSwayTimer = Math.random() * Math.PI;
      if (b.aiDashCooldownTimer === undefined) b.aiDashCooldownTimer = 0;
      if (b.aiDashRemaining === undefined) b.aiDashRemaining = 0;
      if (b.aiDashDir === undefined) b.aiDashDir = { x: 0, y: 0, z: 0 };
      if (b.aiSlideActive === undefined) b.aiSlideActive = false;
      if (b.aiSlideDistanceTraveled === undefined) b.aiSlideDistanceTraveled = 0;
      if (b.aiSlideCooldownTimer === undefined) b.aiSlideCooldownTimer = 0;
      if (b.aiHammerJumpCooldownTimer === undefined) b.aiHammerJumpCooldownTimer = 0;
      if (b.aiPostLungeDecisionTimer === undefined) b.aiPostLungeDecisionTimer = 0;
      if (b.aiPendingPostEvasionCharge === undefined) b.aiPendingPostEvasionCharge = false;
    }

    let pendingPostEvasionCharge = isMainAI
      ? (s.aiPendingPostEvasionCharge ?? false)
      : (botState!.aiPendingPostEvasionCharge ?? false);

    const pos = isMainAI ? s.aiPos : new THREE.Vector3(botState!.pos.x, botState!.pos.y, botState!.pos.z);
    const vel = isMainAI ? s.aiVel : new THREE.Vector3(botState!.vel.x, botState!.vel.y, botState!.vel.z);
    let yaw = isMainAI ? s.aiYaw : botState!.yaw;
    let activeWeapon = isMainAI ? s.aiActiveWeapon : botState!.activeWeapon;
    let weaponState = isMainAI ? s.aiWeaponState : (botState!.weaponState || 'ready');

    // Declare local state variables and sync them from global/bot state
    let state = isMainAI ? s.aiState : botState!.aiState;
    let timer = isMainAI ? s.aiTimer : botState!.aiTimer;
    let swayTimer = isMainAI ? s.aiSwayTimer : botState!.aiSwayTimer;
    let dashCooldownTimer = isMainAI ? s.aiDashCooldownTimer : botState!.aiDashCooldownTimer;
    let dashRemaining = isMainAI ? s.aiDashRemaining : botState!.aiDashRemaining;
    let slideActive = isMainAI ? (s.aiSlideActive ?? false) : (botState!.aiSlideActive ?? false);
    let slideDistanceTraveled = isMainAI ? (s.aiSlideDistanceTraveled ?? 0) : (botState!.aiSlideDistanceTraveled ?? 0);
    let slideCooldownTimer = isMainAI ? (s.aiSlideCooldownTimer ?? 0) : (botState!.aiSlideCooldownTimer ?? 0);
    let isSprinting = false;
    let coordCommitTimer = isMainAI ? (s.aiCoordCommitTimer ?? 0) : (botState!.aiCoordCommitTimer ?? 0);
    let hammerJumpCooldownTimer = isMainAI ? s.aiHammerJumpCooldownTimer : botState!.aiHammerJumpCooldownTimer;
    const dashDir = isMainAI
      ? s.aiDashDir.clone()
      : new THREE.Vector3(botState!.aiDashDir.x, botState!.aiDashDir.y, botState!.aiDashDir.z);

    const syncStateAndMesh = () => {
      if (isMainAI) {
        s.aiPos.copy(pos);
        s.aiVel.copy(vel);
        s.aiYaw = yaw;
        s.aiState = state;
        s.aiTimer = timer;
        s.aiSwayTimer = swayTimer;
        s.aiDashCooldownTimer = dashCooldownTimer;
        s.aiDashRemaining = dashRemaining;
        s.aiDashDir.copy(dashDir);
        s.aiSlideActive = slideActive;
        s.aiSlideDistanceTraveled = slideDistanceTraveled;
        s.aiSlideCooldownTimer = slideCooldownTimer;
        s.aiIsSprinting = isSprinting;
        s.aiHammerJumpCooldownTimer = hammerJumpCooldownTimer;
        s.aiPendingPostEvasionCharge = pendingPostEvasionCharge;
        s.aiCoordCommitTimer = coordCommitTimer;
      } else {
        botState!.pos.copy(pos);
        botState!.vel.copy(vel);
        botState!.yaw = yaw;
        botState!.aiState = state;
        botState!.aiTimer = timer;
        botState!.aiSwayTimer = swayTimer;
        botState!.aiDashCooldownTimer = dashCooldownTimer;
        botState!.aiDashRemaining = dashRemaining;
        botState!.aiDashDir = { x: dashDir.x, y: dashDir.y, z: dashDir.z };
        botState!.aiSlideActive = slideActive;
        botState!.aiSlideDistanceTraveled = slideDistanceTraveled;
        botState!.aiSlideCooldownTimer = slideCooldownTimer;
        botState!.aiIsSprinting = isSprinting;
        botState!.aiHammerJumpCooldownTimer = hammerJumpCooldownTimer;
        botState!.aiPendingPostEvasionCharge = pendingPostEvasionCharge;
        botState!.aiCoordCommitTimer = coordCommitTimer;
      }
      botMesh.position.copy(pos);
    };

    const finishBotSwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string) => {
      botState!.isLunging = false;
      botState!.weaponState = 'ready';
      botState!.aiLastLungeOutcome = outcome;
      botState!.aiLastLungeTargetId = targetId;
      botState!.aiPostLungeDecisionTimer = outcome === 'miss_timeout' || outcome === 'miss_arena' ? 1.35 : 0.35;

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
        timer = botState!.aiTimer ?? timer;
      }
      weaponState = 'ready';

      if (pos.y > 0.01 || Math.abs(vel.y) > 0.01) {
        vel.x = 0;
        vel.z = 0;
        vel.y = Math.min(vel.y, 0);
      } else {
        vel.set(0, 0, 0);
      }

      botState!.vel.copy(vel);
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

    if (isMainAI) {
      if (s.aiPostLungeDecisionTimer > 0) {
        s.aiPostLungeDecisionTimer = Math.max(0, s.aiPostLungeDecisionTimer - dt);
      }
    } else if (botState!.aiPostLungeDecisionTimer > 0) {
      botState!.aiPostLungeDecisionTimer = Math.max(0, botState!.aiPostLungeDecisionTimer - dt);
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
        if (isMainAI) {
          if (s.aiActiveWeapon !== 'sword') {
            swapEnemyWeapon('sword');
          }
          activeWeapon = 'sword';
        } else {
          if (botState!.activeWeapon !== 'sword') {
            botState!.activeWeapon = 'sword';
            const meshes = threeRef.current.otherPlayerMeshes?.get(botId);
            if (meshes) {
              meshes.hammer.visible = false;
              meshes.sword.visible = true;
            }
          }
          activeWeapon = 'sword';
        }
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

      if (isMainAI) {
        s.aiYaw = yaw;
        s.aiState = state;
        s.aiTimer = postKillPressure.timerRemaining;
        s.aiActiveWeapon = activeWeapon;
        s.aiSwayTimer = swayTimer;
      } else {
        botState!.yaw = yaw;
        botState!.aiState = state;
        botState!.aiTimer = postKillPressure.timerRemaining;
        botState!.activeWeapon = activeWeapon;
        botState!.aiSwayTimer = swayTimer;
        botState!.pos.copy(pos);
        botState!.vel.copy(vel);
      }
      botMesh.rotation.y = yaw;
      botMesh.position.copy(pos);
      return;
    }

    let target = getBestTacticalTarget(botId, pos, difficulty);
    const pressureTargetId = isMainAI ? s.aiPressureTargetId : botState!.aiPressureTargetId;
    if (state === 'PRESSURING' && pressureTargetId) {
      const lockedTarget = getTacticalTargetById(botId, pressureTargetId);
      if (lockedTarget) {
        target = lockedTarget;
      }
    }

    if (!target) {
      if (!isMainAI) {
        if (botState!.isLunging) {
          const localCooldownMult = (1.3 - 0.8 * playstyleFactor) * matchMultipliers.cooldownMult;
          finishBotSwordLunge(localCooldownMult, 'target_dead', undefined);
        }
        botState!.aiDashRemaining = 0;
      } else {
        s.aiDashRemaining = 0;
      }

      const isAirborneWithoutTarget = isMainAI
        ? (s.aiIsJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01)
        : (pos.y > 0.01 || Math.abs(vel.y) > 0.01);

      if (isAirborneWithoutTarget) {
        if (!isMainAI) {
          vel.y -= GRAVITY_ACCELERATION * dt;
          pos.addScaledVector(vel, dt);
          recoverAIFromRunawayAltitude(pos, vel, botState);
          if (pos.y <= 0) {
            pos.y = 0;
            vel.set(0, 0, 0);
          }
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

      if (isMainAI) {
        s.aiYaw = yaw;
        s.aiState = state;
        s.aiTimer = 0;
      } else {
        botState!.yaw = yaw;
        botState!.aiState = state;
        botState!.aiTimer = 0;
        botState!.pos.copy(pos);
        botState!.vel.copy(vel);
      }
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

    // Gravity Integration for Offline Bots
    if (!isMainAI) {
      if (vel.y !== 0 || pos.y > 0) {
        vel.y -= GRAVITY_ACCELERATION * dt; 
        pos.y += vel.y * dt;
        
        pos.x += vel.x * dt;
        pos.z += vel.z * dt;
        recoverAIFromRunawayAltitude(pos, vel, botState);

        if (pos.y <= 0) {
          pos.y = 0;
          vel.set(0, 0, 0);
        }
      } else {
        pos.y = 0;
        vel.y = 0;
      }
      constrainCombatantToArena(pos, vel);
    }

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
    if (isMainAI) {
      s.aiIsCrouching = isCrouching;
    } else {
      botState!.isCrouching = isCrouching;
    }

    const botBodyCenter = getCombatBodyCenter(pos, isCrouching);
    const targetBodyCenter = getCombatBodyCenter(predictedTargetPos, target.isCrouching);
    const combatDistanceToTarget = botBodyCenter.distanceTo(targetBodyCenter);
    const verticalDeltaToTarget = targetBodyCenter.y - botBodyCenter.y;
    const verticalThreat = Math.abs(verticalDeltaToTarget) > 1.1;
    const attackDistanceToTarget = verticalThreat ? combatDistanceToTarget : distanceToTarget;

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
    if (!isMainAI && (botState!.swapLockoutTimer ?? 0) > 0) {
      botState!.swapLockoutTimer = Math.max(0, (botState!.swapLockoutTimer ?? 0) - dt);
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
    const swapLockoutRemaining = isMainAI ? s.aiSwapLockoutTimer : (botState!.swapLockoutTimer ?? 0);

    const commitFeint = () => {
      startFeintCooldown(aiContext, botId, rollFeintCooldownDuration());
    };

    const tryFeintRoll = (rollScale = 1) => rollFeintAttempt({
      feintChance,
      feintCooldownRemaining: getFeintCooldownRemaining(aiContext, botId),
      playerModelMultiplier: feintPlayerMult,
      rollScale,
    });

    const recentLungeMemory = isMainAI
      ? (s.aiLastLungeOutcome ? {
          outcome: s.aiLastLungeOutcome,
          targetId: s.aiLastLungeTargetId,
          timeRemaining: s.aiPostLungeDecisionTimer,
        } : null)
      : (botState!.aiLastLungeOutcome ? {
          outcome: botState!.aiLastLungeOutcome,
          targetId: botState!.aiLastLungeTargetId,
          timeRemaining: botState!.aiPostLungeDecisionTimer || 0,
        } : null);

    const applyTacticalWeapon = (tacticalWeapon: 'hammer' | 'sword', force = false) => {
      if (tacticalWeapon === activeWeapon) return;
      if (tacticalWeapon === 'sword' && swordForbidden) return;
      if (tacticalWeapon === 'hammer' && hammerForbidden) return;
      if (isMainAI) {
        if (!force && s.aiSwapLockoutTimer > 0) return;
        swapEnemyWeapon(tacticalWeapon);
      } else {
        if (!force && (botState!.swapLockoutTimer ?? 0) > 0) return;
        botState!.activeWeapon = tacticalWeapon;
        if (s.settings.weaponSwapLockout > 0) {
          botState!.swapLockoutTimer = s.settings.weaponSwapLockout;
        }
        const meshes = threeRef.current.otherPlayerMeshes?.get(botId);
        if (meshes) {
          meshes.hammer.visible = tacticalWeapon === 'hammer';
          meshes.sword.visible = tacticalWeapon === 'sword';
        }
      }
      activeWeapon = tacticalWeapon;
      weaponState = 'ready';
    };

    const revertWeaponSwapFeint = () => {
      if (activeWeapon !== 'sword') return;
      if (isMainAI) {
        s.aiSwapLockoutTimer = 0;
        swapEnemyWeapon('hammer');
      } else {
        botState!.swapLockoutTimer = 0;
        botState!.activeWeapon = 'hammer';
        const meshes = threeRef.current.otherPlayerMeshes?.get(botId);
        if (meshes) {
          meshes.hammer.visible = true;
          meshes.sword.visible = false;
        }
      }
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

        if (isMainAI) {
          triggerEnemySwordLunge(lungeDir);
        } else {
          botState!.isLunging = true;
          botState!.lungeTimer = 0;
          botState!.lungeStartPos = { x: pos.x, y: pos.y, z: pos.z };
          botState!.lungeTargetDir = { x: lungeDir.x, y: lungeDir.y, z: lungeDir.z };
          const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
          vel.y = Math.max(vel.y, lungeDir.y * lungeSpeed);
          botState!.weaponState = 'ready';
          sfx.playDash();
        }
        commitComboAttackAdvance();
        return 'lunge';
      }

      if (attackDistanceToTarget <= resolvedAiReach) {
        state = 'COOLDOWN';
        timer = (activeWeapon === 'sword' ? (s.settings.swordSlashReload ?? 0.6) : 1.1) * cooldownMult;
        if (isMainAI) {
          if (activeWeapon === 'sword') {
            triggerEnemySwordSlash();
          } else {
            triggerEnemyHammerSwing();
          }
        } else {
          botState!.weaponState = 'swing_up';
          botState!.weaponTimer = 0;
          sfx.playSwing();
        }
        weaponState = 'swing_up';
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
        if (isMainAI) {
          triggerEnemyHammerSwing();
        } else {
          botState!.weaponState = 'swing_up';
          botState!.weaponTimer = 0;
          sfx.playSwing();
        }
        weaponState = 'swing_up';
        startedBulltrueCounter = true;
      } else if (tacticalDecision.bulltrueCounter === 'sword' && canStartWeaponAction && activeWeapon === 'sword' && weaponState === 'ready') {
        state = 'COOLDOWN';
        timer = (s.settings.swordSlashReload ?? 0.6) * cooldownMult;
        if (isMainAI) {
          triggerEnemySwordSlash();
        } else {
          botState!.weaponState = 'swing_up';
          botState!.weaponTimer = 0;
          sfx.playSwing();
        }
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
        if (startAIHammerJump(isMainAI, botState, pos, vel, undefined, 'defensive')) {
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
        if (isMainAI) {
          if (!s.aiIsJumping) {
            s.aiIsJumping = true;
            s.aiVel.y = 5.5;
            sfx.playJump();
          }
        } else if (vel.y === 0) {
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
          if (isMainAI) {
            triggerEnemyHammerSwing();
          } else {
            botState!.weaponState = 'swing_up';
            botState!.weaponTimer = 0;
            sfx.playSwing();
          }
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
        if (isMainAI) {
          triggerEnemyHammerSwing();
        } else {
          botState!.weaponState = 'swing_up';
          botState!.weaponTimer = 0;
          sfx.playSwing();
        }
      } else if (verticalDeltaToTarget > 2.0 && distanceToTarget <= resolvedDangerZone + 4.5 && Math.random() < 0.012 + tunedAnticipationFactor * 0.035) {
        if (startAIHammerJump(isMainAI, botState, pos, vel, toTarget, 'offensive')) {
          weaponState = 'swing_up';
          hammerJumpCooldownTimer = AI_HAMMER_JUMP_COOLDOWN;
        }
      }
    }

    timer -= dt;
    swayTimer += dt;

    if (isMainAI && s.aiState === 'LUNGING') {
      return;
    }

    // Bot Lunging state for additional bots!
    if (!isMainAI && botState!.isLunging) {
      botState!.lungeTimer = (botState!.lungeTimer || 0) + dt;
      const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
      const targetDir = new THREE.Vector3(botState!.lungeTargetDir!.x, botState!.lungeTargetDir!.y, botState!.lungeTargetDir!.z);
      
      vel.x = targetDir.x * lungeSpeed;
      vel.z = targetDir.z * lungeSpeed;
      vel.y -= GRAVITY_ACCELERATION * dt;
      pos.addScaledVector(vel, dt);
      recoverAIFromRunawayAltitude(pos, vel, botState);
      if (pos.y <= 0) {
        pos.y = 0;
        vel.y = 0;
      }
      constrainCombatantToArena(pos, vel);
      botState!.pos.copy(pos);
      botState!.vel.copy(vel);
      botMesh.position.copy(pos);

      const trailPos = pos.clone();
      trailPos.y += 0.825;
      renderSwordLungeTrailVfx(trailPos, '#ef4444', targetDir, 'shockwave');

      const dist = getCombatBodyCenter(pos, botState!.isCrouching).distanceTo(getCombatBodyCenter(target.pos, target.isCrouching));
      if (target.hp <= 0) {
        finishBotSwordLunge(cooldownMult, 'target_dead', target.id);
      } else if (dist <= 1.5) {
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        
        let targetIsAttacking = false;
        if (target.id === 'player') {
          targetIsAttacking = s.settings.enableSwordTrade && s.activeWeapon === 'sword' && (
            s.isLunging || s.pSwordState === 'slashing' || (Date.now() - s.lastPlayerSwordAttackTime <= swordThreshold)
          );
        } else if (target.id === 'main_ai') {
          targetIsAttacking = s.settings.enableSwordTrade && s.aiActiveWeapon === 'sword' && (
            s.aiState === 'LUNGING' || s.aiWeaponState === 'swing_up' || s.aiWeaponState === 'swing_down' || (Date.now() - s.lastAISwordAttackTime <= swordThreshold)
          );
        } else {
          const tBot = s.otherPlayers.get(target.id);
          if (tBot) {
            targetIsAttacking = s.settings.enableSwordTrade && tBot.activeWeapon === 'sword' && (
              tBot.isLunging || tBot.weaponState === 'swing_up' || tBot.weaponState === 'swing_down'
            );
          }
        }

        if (targetIsAttacking) {
          executeCustomBotTrade(botState!, target);
          return;
        }

        if (target.id === 'player') {
          recordPlayerDamageTaken();
          s.playerHP -= 1;
          finishBotSwordLunge(cooldownMult, 'hit', target.id);
          sfx.playExplosion();
          spawnVoxelShockwaveParticles(s.playerPos, '#ef4444');

          if (s.playerHP <= 0) {
            s.playerHP = 0;
            s.playerRespawnTimer = 3.0;
            s.playerDeaths += 1;
            botState!.score = (botState!.score || 0) + 1;
            botState!.kills = (botState!.kills || 0) + 1;
            sfx.playDeath();
            
            const newDeath: DeathEvent = {
              id: Math.random().toString(36).substring(2, 9),
              attacker: botState!.playerName,
              victim: s.settings.playerName || 'Blue (You)',
              weapon: 'sword',
            };
            s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
            recordBotPsychKill(botId, 'player', true);
          }
        } else if (target.id === 'main_ai') {
          s.aiHP -= 1;
          finishBotSwordLunge(cooldownMult, 'hit', target.id);
          sfx.playExplosion();
          spawnVoxelShockwaveParticles(s.aiPos, '#ef4444');

          if (s.aiHP <= 0) {
            s.aiHP = 0;
            s.aiState = 'RESPAWNING';
            s.enemyRespawnTimer = 3.0;
            botState!.score = (botState!.score || 0) + 1;
            botState!.kills = (botState!.kills || 0) + 1;
            s.enemyDeaths += 1;
            recordBotCalibrationDeath('main_ai');
            sfx.playDeath();
            
            recordDeathEvent(botState!.playerName, 'Red (AI)', undefined, 'sword');
            recordBotPsychKill(botId, 'main_ai', true);
          }
        } else {
          const oBot = s.otherPlayers.get(target.id);
          if (oBot) {
            oBot.hp -= 1;
            finishBotSwordLunge(cooldownMult, 'hit', target.id);
            sfx.playExplosion();
            spawnVoxelShockwaveParticles(oBot.pos, '#ef4444');

            if (oBot.hp <= 0) {
              oBot.hp = 0;
              oBot.respawnTimer = 3.0;
              botState!.score = (botState!.score || 0) + 1;
              botState!.kills = (botState!.kills || 0) + 1;
              oBot.deaths = (oBot.deaths || 0) + 1;
              sfx.playDeath();
              
              recordDeathEvent(botState!.playerName, oBot.playerName, undefined, 'sword');
              recordBotPsychKill(botId, target.id, true);
            }
          }
        }
        pushStatsUpdate();
      }

      const startDist = pos.distanceTo(new THREE.Vector3(botState!.lungeStartPos!.x, botState!.lungeStartPos!.y, botState!.lungeStartPos!.z));
      const distFromCenter = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
      if (distFromCenter >= s.arenaRadius - 0.65) {
        finishBotSwordLunge(cooldownMult, 'miss_arena', target.id);
      } else if (startDist > 16.0 || botState!.lungeTimer > 0.8) {
        finishBotSwordLunge(cooldownMult, 'miss_timeout', target.id);
      }
    } else {
      const isAirborneBeforeGroundMovement = isMainAI
        ? (s.aiIsJumping || pos.y > 0.01 || Math.abs(vel.y) > 0.01)
        : (pos.y > 0.01 || Math.abs(vel.y) > 0.01);

      if (isAirborneBeforeGroundMovement) {
        const airDamping = Math.max(0, 1 - 5 * dt);
        vel.x *= airDamping;
        vel.z *= airDamping;
        if (!isMainAI) {
          recoverAIFromRunawayAltitude(pos, vel, botState);
        } else {
          recoverMainAIFromRunawayAltitude();
        }
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
      }

      if (isMainAI && s.aiIsJumping && s.aiHP > 0) {
        if (movementComplexity >= 45) {
          const lookHeading = toTarget.clone().normalize();
          const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
          const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
          s.aiVel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
          s.aiVel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
        }
      }

      if (!isMainAI && vel.y > 0) {
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
      if (isMainAI && s.aiIsJumping && s.aiHP > 0) {
        if (movementComplexity >= 45) {
          const lookHeading = toTarget.clone().normalize();
          const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
          const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
          s.aiVel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
          s.aiVel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
        }
      }

      if (!isMainAI && vel.y > 0) {
        if (movementComplexity >= 45) {
          const lookHeading = toTarget.clone().normalize();
          const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
          const sideDir = Math.sin(swayTimer * 3.0) > 0 ? 1 : -1;
          vel.x += (sidewayHeading.x * 2.0 * sideDir + lookHeading.x * 0.4) * dt;
          vel.z += (sidewayHeading.z * 2.0 * sideDir + lookHeading.z * 0.4) * dt;
        }
      }

      const lookHeading = toTarget.clone().normalize();
      const spatialBias = getSpatialMovementBias({
        botX: pos.x,
        botZ: pos.z,
        targetX: movementTargetPos.x,
        targetZ: movementTargetPos.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        predictedTargetX: predictedTargetPos.x,
        predictedTargetZ: predictedTargetPos.z,
        arenaRadius: s.arenaRadius,
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

          if (isMainAI) {
            triggerEnemySwordLunge(lungeDir);
          } else {
            botState!.isLunging = true;
            botState!.lungeTimer = 0;
            botState!.lungeStartPos = { x: pos.x, y: pos.y, z: pos.z };
            botState!.lungeTargetDir = { x: lungeDir.x, y: lungeDir.y, z: lungeDir.z };
            const lungeSpeed = s.settings.swordLungeSpeed ?? 24.0;
            vel.y = Math.max(vel.y, lungeDir.y * lungeSpeed);
            botState!.weaponState = 'ready';
            sfx.playDash();
          }
          return;
          }
        }
      }

      const playerModel = getTargetPlayerModel(target.id);
      const approachLateral = getApproachLateralOffset(playerModel);
      const coordLateral = getPincerApproachOffset(coordRoleInput);
      const totalApproachLateral = approachLateral + coordLateral;

      if (weaponState === 'ready' && distanceToTarget > (resolvedDangerZone + 1.5) && distanceToTarget <= (resolvedDangerZone + 5.5) && Math.random() < 0.015 && (movementComplexity >= 40) && !targetIsProtected) {
        if (startAIHammerJump(isMainAI, botState, pos, vel, lookHeading, 'offensive')) {
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
        
        const desiredDist = activeWeapon === 'sword' ? (maxLungeRange * 0.7) : (resolvedDangerZone + 1.2);
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
          
          const myHP = isMainAI ? s.aiHP : botState!.hp;
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
          const myHP = isMainAI ? s.aiHP : botState!.hp;
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
            if (isMainAI) {
              if (activeWeapon === 'sword') {
                triggerEnemySwordSlash();
              } else {
                triggerEnemyHammerSwing();
              }
            } else {
              botState!.weaponState = 'swing_up';
              botState!.weaponTimer = 0;
              sfx.playSwing();
            }
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
            if (isMainAI) {
              if (activeWeapon === 'sword') {
                triggerEnemySwordSlash();
              } else {
                triggerEnemyHammerSwing();
              }
            } else {
              botState!.weaponState = 'swing_up';
              botState!.weaponTimer = 0;
              sfx.playSwing();
            }
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
    }

    constrainCombatantToArena(pos, vel);

    if (isMainAI && s.aiIsJumping && state !== 'LUNGING') {
      vel.y = s.aiVel.y;
    } else if (state !== 'LUNGING') {
      vel.y = 0;
    }

    const isAirborne = isMainAI 
      ? (s.aiIsJumping || s.aiPos.y > 0.01) 
      : (pos.y > 0.01 || Math.abs(vel.y) > 0.01);

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
