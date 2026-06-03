/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { buildGravityHammerModel, buildVoxelSpartanModel, buildKatarSwordModel, buildPistolModel } from './VoxelModels';
import { AIBehaviorState, DeathEvent, DEFAULT_KEYBINDINGS, MedalInfo, Combatant, ReplayFrame, CustomMapData } from '../types';
import { cacheReplay } from '../game/theaterDatabase';
import { getSkyboxTexture } from '../game/skyboxTextures';
import { type AILungeOutcome, evaluateAICombatDecision } from '../game/aiCombatDecision';
import {
  getGrifballRole,
  getGrifballEscortTarget,
  getGrifballSpacingOffset,
  getGrifballRunnerSteering,
  type GrifballRole
} from '../game/aiGrifballRoles';
import { bakeNavMesh, findShortestPath } from '../game/mapNavigation';
import { getRectHalfExtents } from '../game/arenaDimensions';
import { GRIFBALL_TOTAL_AI } from '../game/grifballTeams';
import { resetAIMatchContext, tickFeintCooldown, getFeintCooldownRemaining, startFeintCooldown, isWeaponSwapFeintActive, startWeaponSwapFeint, tickWeaponSwapFeintTimer, tickBotPsychState, getBotComboState, setBotComboState, clearBotComboState } from '../game/aiMatchContext';
import {
  getAttackPhaseIndex,
  getEngagingBotIds,
  getPincerApproachOffset,
  registerBotEngagement,
  shouldDeferCoordinatedAttack,
  shouldPunisherHold,
} from '../game/aiBotCoordinator';
import {
  seedOfflineRoster,
} from '../game/aiOrchestrator';
import {
  comboBlocksTacticalSwap,
  createBotComboState,
  notifyComboAttackStarted,
  pickOpeningCombo,
  progressComboState,
  shouldAbortCombo,
} from '../game/aiComboEngine';
import { shouldAvoidCoinFlipTrade } from '../game/aiTuning';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { resolvePersonalityFlags } from '../game/aiPersonalities';
import {
  resolveKnobsFromRosterSlot,
  resolveDerivedFromRosterSlot,
  resolveRosterSlotForCombatant,
} from '../game/rosterSlotConfig';
import {
  DEFAULT_AI_TEAM,
  installLegacyTeamScoreBridges,
  localPlayerTeamFromRole,
} from '../game/teamScoring';
import {
  MAIN_AI_ID,
  getAICombatants,
  getDisplayOpponent,
  getMainAI,
  getRosterCombatant,
  removeMainAIFromRoster,
} from '../game/roster';
import {
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
  getPressureMaxRange,
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
  recordCalibrationDodgeAttempt,
  recordCalibrationDodgeFailed,
  tickCalibrationPendingCounter,
  tickCalibrationPendingDodge,
} from '../game/aiSkillCalibration';
import {
  applyLungeAimBias,
  getApproachLateralOffset,
  getTargetPlayerModelSnapshot,
  LOCAL_PLAYER_ID,
  observePlayerCounter,
  observePlayerDamageDealt,
  observePlayerDash,
  observePlayerHammerAttack,
  observePlayerLungeEnd,
  observePlayerLungeStart,
  observePlayerApproachSpeed,
  observePlayerPosition,
  observePlayerReaction,
  observePlayerWeaponSwap,
  recordCombatantModelObservation,
  recordLocalPlayerDamageDealtObservation,
  recordLocalPlayerDamageTakenObservation,
  recordLocalPlayerLungeEndObservation,
  recordLocalPlayerModelObservation,
  type PlayerModelObserver,
  type PlayerModelSnapshot,
} from './grifball/playerModelObservations';
import {
  blendSpatialHeading,
  getBulltrueHammerTriggerBand,
  getEvasionDashRollChance,
  getEvasionTimingScale,
  getHammerJumpEvasionChance,
  getSpatialMovementBias,
  getSpawnGuardAimAngle,
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
import {
  createDefaultSpawnPoints,
  getGrifballTeamSpawn,
  resolveActiveSpawnPoints,
} from './grifball/arenaSpawns';
import {
  getOptimalSpawnPointForArena,
  resizeArenaForPlayerCount,
} from './grifball/arenaRuntime';
import { enforceArenaFrameSyncForState } from './grifball/arenaFrameSync';
import {
  createGrifballAIOrchestratorEvents,
  createGrifballAIOrchestratorSpawnCallbacks,
  runGrifballAIOrchestratorForState,
} from './grifball/aiOrchestratorBridge';
import { constrainCombatantToArenaBounds } from './grifball/arenaBounds';
import { recoverCombatantAltitude as recoverCombatantAltitudeFromRunaway } from './grifball/altitudeRecovery';
import { updateAIRosterTick } from './grifball/aiRosterTick';
import {
  initializeCombatantAITickDefaults,
  tickCombatantInvulnerability,
} from './grifball/aiTickState';
import { resolvePlayerCombatantCollisionsForState } from './grifball/playerCollisionSync';
import { animateSpartanCombatantModel } from './grifball/combatantAnimation';
import {
  recordBotCalibrationCounterSuccessForState,
  recordBotCalibrationDeathForState,
  recordBotDamageTagForState,
} from './grifball/aiBookkeeping';
import {
  canStartAIHammerJumpForCombatant,
  startAIHammerJumpForCombatant,
  swapCombatantWeaponAction,
  triggerCombatantAttackAction,
  triggerCombatantLungeAction,
} from './grifball/combatantActions';
import {
  getCombatantMesh,
  getCombatantWeaponMeshes,
} from './grifball/combatantMeshLookup';
import { tryStartComboOnHitForState } from './grifball/combatantCombos';
import {
  rebuildEnemyCombatantModelForState,
  rebuildHostCombatantModelForState,
} from './grifball/combatantModelRebuild';
import { respawnAICombatant } from './grifball/combatantRespawn';
import { useGrifballDomPoolRefs, useGrifballInputRefs, usePausedPointerLockRef } from './grifball/inputRefs';
import {
  AI_HAMMER_JUMP_START_MAX_HEIGHT,
  AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON,
  GRAVITY_ACCELERATION,
  HAMMER_STRIKE_FORWARD_FACTOR,
  MELEE_EYE_HEIGHT,
  MELEE_HAMMER_SWIPE_REACH,
  MELEE_SWORD_SLASH_REACH,
  SWORD_SLASH_FORWARD_FACTOR,
  SWORD_SLASH_RADIUS,
  getCollisionResolvedCameraPos,
  getCombatBodyCenter,
  getInwardSpawnYaw,
  predictCombatantPosition,
  predictLandingPosition,
  type SwordLungeCurrentTrailStyle,
  type TacticalTargetCandidate,
} from './grifball/combatGeometry';
import { createHighFidelityObjectMesh, generateCustomTexture } from './grifball/customMapAssets';
import {
  getLocalPlayerFeedName as getLocalPlayerFeedNameFromState,
  recordDeathEvent as recordDeathEventOnState,
} from './grifball/deathFeed';
import { type GrifballGameProps } from './grifball/GrifballGameProps';
import { applyBotMeleeImpactForState } from './grifball/botMeleeImpactRuntime';
import { applyHammerStrikeImpactForState } from './grifball/hammerStrikeImpactRuntime';
import { applyMainAIHammerMeleeImpactForState } from './grifball/mainAIHammerMeleeRuntime';
import { applyMainAISwordSlashImpactForState } from './grifball/mainAISwordSlashRuntime';
import { applyPlayerHammerMeleeImpactForState } from './grifball/playerHammerMeleeRuntime';
import {
  executeCustomBotTradeForState,
  executeMainAITradeForState,
  type CombatTradeReason,
} from './grifball/tradeRuntime';
import { applyOutgoingMultiplayerHitForState } from './grifball/multiplayerHitRuntime';
import {
  areGrifballCombatantsHostileForState,
  ensureGrifballBallMeshForRefs,
  getGrifballCombatantRefForState,
  getGrifballEnemyGoalPosForMap,
  getGrifballTeamOfForState,
  setGrifballCarrierForState,
  throwPlayerGrifballPassForState,
  updateGrifballObjectiveForState,
} from './grifball/grifballObjectiveRuntime';
import { buildLegacyRosterProps } from './grifball/legacyRosterProps';
import {
  type LiveCameraFrameState,
} from './grifball/liveCamera';
import { resolveActiveCustomMap } from './grifball/mapSelection';
import { pushGrifballHudStatsUpdate } from './grifball/hudStatsRuntime';
import { updateGrifballMatchTimers } from './grifball/matchTimers';
import {
  updateFloatingNameplatesForState,
  updateRadarDomForState,
} from './grifball/overlayDom';
import { updateObserverCombatantVisualsForState } from './grifball/observerVisualSync';
import {
  clearCombatantPressureTarget,
  createMatchScoreContext,
  getEffectivePressureAggression,
  getPressureMatchMultipliers,
  tryEnterCombatantPressureState,
} from './grifball/matchPressure';
import {
  createInitialFpsCounter,
  useGrifballReplayRuntimeRefs,
  useLatestRef,
  useOfflineRosterPropRefs,
} from './grifball/runtimeRefs';
import {
  getReconstructedReplayState,
  hasReplayEntityStateChanged,
  type ReplayTargetCycleDirection,
} from './grifball/replayHelpers';
import { cycleReplayTargetForState } from './grifball/replayTargetRuntime';
import { createOrUpdateRemoteCombatantForState } from './grifball/remoteCombatantProvisioning';
import { renderLiveGrifballFrame } from './grifball/renderFrame';
import { updateRosterCombatantVisualsForState } from './grifball/rosterVisualSync';
import { evaluatePlayerKillMedalsForState } from './grifball/playerMedals';
import { recordBotPostKillPressure } from './grifball/postKillPressure';
import { resolveSpectateTargetData, type SpectateTargetRole } from './grifball/spectateTargets';
import {
  getEnemyAITargetFromTacticalTarget,
  getPlayerSwordLockTarget as getPlayerSwordLockTargetFromState,
} from './grifball/targetSelection';
import {
  buildPotentialTacticalTargets,
  getBestTacticalTargetFromState,
  getTacticalTargetByIdFromState,
  isTacticalTargetOnCooldown,
} from './grifball/tacticalTargets';
import { createInitialGrifballRuntimeState, type GrifballRuntimeState } from './grifball/runtimeState';
import { createInitialGrifballThreeRefs, type GrifballThreeRefs } from './grifball/threeRefs';
import {
  updateInvulnerabilityBlinking,
  type WeatherParticleFrameState,
} from './grifball/visualState';
import {
  swapPlayerWeaponForState,
  triggerPlayerHammerMeleeForState,
  triggerPlayerHammerSwingForState,
  triggerPlayerSwordLungeForState,
  triggerPlayerSwordSlashForState,
  type PlayerSwappableWeapon,
} from './grifball/playerWeaponActions';
import { triggerPlayerPistolFireForState } from './grifball/playerPistolRuntime';
import {
  disposeTransientVfxRefs,
  renderHammerSplashVfxForThreeRefs,
  renderSwordLungeTrailVfxForThreeRefs,
  resetTransientVfxRefs,
  spawnBurnDecalForThreeRefs,
  spawnVoxelShockwaveParticlesForThreeRefs,
} from './grifball/vfxSystems';
import { updateTransientVfxForFrame } from './grifball/vfxRuntime';

export { createHighFidelityObjectMesh } from './grifball/customMapAssets';

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
  const weatherParticleFrameRef = useRef<WeatherParticleFrameState>({});
  const liveCameraFrameRef = useRef<LiveCameraFrameState>({});

  const getActiveCustomMap = (): CustomMapData | null =>
    resolveActiveCustomMap({ customMap, replayData, selectedMap, gameMode: adminSettings.gameMode });
  // Phase 4: main_ai lives in otherPlayers with controller:'ai' â€” see roster.ts helpers.
  const requestRef = useRef<number | null>(null);
  const fpsRef = useRef(createInitialFpsCounter());

  // Grifball: ball render mesh + player Pass-charge tracking.
  const grifballBallMeshRef = useRef<THREE.Mesh | null>(null);
  const ballChargingRef = useRef(false);
  const ballChargeTimerRef = useRef(0);

  // Replay Recording Refs
  const {
    replayRecordingRef,
    lastRecordTimeRef,
    replayRecordingElapsedTimeRef,
    lastRecordedStateRef,
    replayTimeRef,
    replaySpeedRef,
    isReplayPausedRef,
    replayTargetIdRef,
    prevReplayFrameRef,
    replayPlayerIdsRef,
  } = useGrifballReplayRuntimeRefs();

  // Core Game State refs to avoid state-delay in the animation/render loop
  const stateRef = useRef<GrifballRuntimeState>(createInitialGrifballRuntimeState({
    debugMode,
    adminSettings,
    multiplayerRole,
    isMultiplayer,
  }));

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

  const {
    offlineBotCountRef,
    botDifficultiesRef,
    botColorsRef,
    botBehaviorsRef,
    botWeaponBehaviorsRef,
    botArchetypesRef,
  } = useOfflineRosterPropRefs({
    offlineBotCount: adminSettings.gameMode === 'grifball' ? GRIFBALL_TOTAL_AI : offlineBotCount,
    botDifficulties,
    botColors,
    botBehaviors,
    botWeaponBehaviors,
    botArchetypes,
  });

  const recordLocalPlayerObservation = (observe: PlayerModelObserver) => {
    recordLocalPlayerModelObservation(stateRef.current, observe);
  };

  // Adaptive learning producer: record an observation into the *acting AI combatant's*
  // own model (keyed by its id), built from that combatant's own actions and consumed by
  // whoever targets it via getTargetPlayerModel(botId). Unlike the local-player producer,
  // bots always record (no observer-mode guard). Callers fire this only from live-combat
  // action sites, so the actor is inherently alive and not respawning.
  const recordCombatantObservation = (botId: string, observe: PlayerModelObserver) => {
    recordCombatantModelObservation(stateRef.current, botId, observe);
  };

  const recordPlayerLungeEndObservation = (hit: boolean) => {
    recordLocalPlayerLungeEndObservation(stateRef.current, hit);
  };

  const recordPlayerDamageTaken = () => {
    recordLocalPlayerDamageTakenObservation(stateRef.current);
  };

  const recordPlayerDamageDealt = (targetWasCountering: boolean) => {
    recordLocalPlayerDamageDealtObservation(stateRef.current, targetWasCountering);
  };

  // Adaptive learning: return the learned profile for ANY combatant id that has
  // accumulated enough samples (default minSamples gate of 3), not just the human
  // player. For the player this is unchanged; for a bot target it returns a populated
  // profile once that bot has acted enough, letting opponents read its tendencies.
  const getTargetPlayerModel = (targetId: string) => {
    return getTargetPlayerModelSnapshot(stateRef.current, targetId);
  };

  const constrainCombatantToArena = (pos: THREE.Vector3, vel?: THREE.Vector3) => {
    const s = stateRef.current;
    const activeCustomMap = getActiveCustomMap();
    const result = constrainCombatantToArenaBounds({
      pos,
      vel,
      activeCustomMap,
      arenaRadius: s.arenaRadius,
    });

    // Handle custom grounding so spartan can stand and jump from objects!
    if (result.grounded) {
      if (pos === s.playerPos) {
        s.isJumping = false;
        s.pHammerJumpsInAir = 0;
      } else if (pos === mai()?.pos) {
        const m = mai();
        if (m) {
          m.isJumping = false;
          m.aiHammerJumpsInAir = 0;
        }
      } else {
        s.otherPlayers.forEach(bot => {
          if (bot.pos === pos) {
            bot.isJumping = false;
            bot.aiHammerJumpsInAir = 0;
          }
        });
      }
    }
  };

  const resolvePlayerCollisions = () => {
    resolvePlayerCombatantCollisionsForState({
      state: stateRef.current,
      mainAI: mai(),
    });
  };

  const enforceArenaBounds = (dt: number) => {
    enforceArenaFrameSyncForState({
      state: stateRef.current,
      refs: threeRef.current,
      dt,
      isMultiplayer,
      multiplayerRole,
      mainAI: mai(),
      opponentClientId,
      resolvePlayerCollisions,
      constrainCombatantToArena,
    });
  };

  const recoverCombatantAltitude = (self: any, pos: THREE.Vector3, vel: THREE.Vector3): boolean =>
    recoverCombatantAltitudeFromRunaway(stateRef.current.settings, self, pos, vel);

  const getLegacyRosterProps = () => buildLegacyRosterProps({
    opponentPlayerName,
    botDifficulties: botDifficultiesRef.current,
    botBehaviors: botBehaviorsRef.current,
    botWeaponBehaviors: botWeaponBehaviorsRef.current,
    botArchetypes: botArchetypesRef.current,
    botColors: botColorsRef.current,
  });

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
    return createMatchScoreContext(s, matchKillsToWin);
  };

  const getBotPressureAggression = (botId: string): number => {
    const baseAggression = resolveBotDerived(botId).pressureAggression;
    return getEffectivePressureAggression(stateRef.current.settings, getMatchScoreContext(), baseAggression);
  };

  const tryEnterPressureState = (
    botId: string,
    targetId: string,
    targetHp: number,
    targetInvuln: number
  ): boolean => {
    const personalityFlags = resolveBotFlags(botId);
    const pressureAggression = getBotPressureAggression(botId);
    const s = stateRef.current;
    return tryEnterCombatantPressureState({
      bot: rosterCombatant(botId),
      targetId,
      targetHp,
      targetInvuln,
      pressureAggression,
      skipPressure: personalityFlags.skipPressure,
      settings: s.settings,
      scoreContext: getMatchScoreContext(),
    });
  };

  const clearPressureTarget = (botId: string) => {
    clearCombatantPressureTarget(rosterCombatant(botId));
  };

  const tryStartComboOnHit = (
    botId: string,
    targetId: string,
    openingWeapon: 'hammer' | 'sword',
    opts: { targetRecovering?: boolean } = {}
  ) => {
    const s = stateRef.current;
    const knobs = resolveBotKnobs(botId);
    const candidate = getTacticalTargetById(botId, targetId);
    const bot = rosterCombatant(botId);
    tryStartComboOnHitForState({
      state: s,
      botId,
      targetId,
      openingWeapon,
      bot,
      candidate,
      knobs,
      targetRecovering: opts.targetRecovering,
    });
  };

  const recordBotPsychKill = (botId: string, victimId: string, wasLungeKill: boolean) => {
    const s = stateRef.current;
    const knobs = resolveBotKnobs(botId);
    const pressureAggression = getBotPressureAggression(botId);
    recordBotPostKillPressure({
      state: s,
      bot: rosterCombatant(botId),
      botId,
      victimId,
      difficulty: knobs.difficulty,
      pressureAggression,
      wasLungeKill,
      rosterAI: getRosterAI(),
      getOptimalSpawnPoint,
      nowSeconds: performance.now() / 1000,
    });
  };

  const recordBotCalibrationDeath = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    recordBotCalibrationDeathForState({
      state: stateRef.current,
      botId,
      difficulty: knobs.difficulty,
      nowSeconds: performance.now() / 1000,
    });
  };

  const tryRecordCalibrationCounterSuccess = (botId: string) => {
    const knobs = resolveBotKnobs(botId);
    recordBotCalibrationCounterSuccessForState({
      state: stateRef.current,
      botId,
      difficulty: knobs.difficulty,
    });
  };

  const recordBotDamageTag = (botId: string, targetId: string) => {
    recordBotDamageTagForState({
      state: stateRef.current,
      botId,
      targetId,
      isMultiplayer,
    });
  };

  function updateAI(dt: number) {
    if (isMultiplayer) return;
    updateAIRosterTick({
      refs: threeRef.current,
      rosterAI: getRosterAI(),
      dt,
      respawnCombatant,
      updateSingleAIEntity,
    });
  };

  function updateCharacterSkeletalAnimations(dt: number) {
    const s = stateRef.current;

    if (!replayData) {
      updateObserverCombatantVisualsForState({
        refs: threeRef.current,
        state: s,
        dt,
        multiplayerRole,
        keysPressed: keysPressed.current,
        keybindings: keybindingsRef.current,
        mainAI: mai(),
        getSpectateTargetData,
      });
    }

    updateRosterCombatantVisualsForState({
      refs: threeRef.current,
      state: s,
      dt,
      renderSwordLungeTrailVfx,
      applyBotMeleeImpact,
    });
  };

  const spawnBurnDecal = (pos: THREE.Vector3, radius: number) =>
    spawnBurnDecalForThreeRefs(threeRef.current, pos, radius);

  // ---- Grifball runtime (offline 4v4 neutral-ball objective loop) ----
  const grifballCombatantRef = (id: string): { pos: THREE.Vector3; alive: boolean } | null =>
    getGrifballCombatantRefForState(stateRef.current, id);

  const grifballTeamOf = (id: string): string | undefined =>
    getGrifballTeamOfForState(stateRef.current, id);

  // Phase 4: the world-space goal a carrier on `team` runs toward (enemy plate).
  const grifballEnemyGoalPos = (team: string | undefined): { x: number; z: number } | null =>
    getGrifballEnemyGoalPosForMap(team, getActiveCustomMap());

  // Team-based combat: in Grifball, friendly fire is OFF and AI only targets the
  // enemy team. Everywhere else combat stays free-for-all (everyone hostile).
  const areCombatantsHostile = (attackerId: string, victimId: string): boolean =>
    areGrifballCombatantsHostileForState(stateRef.current, attackerId, victimId);

  // Equip/holster the ball weapon on a combatant. The player additionally hides
  // their first-person weapon while carrying (the ball replaces the loadout).
  const setGrifballCarrier = (id: string, carrying: boolean) =>
    setGrifballCarrierForState({ state: stateRef.current, refs: threeRef.current, id, carrying });

  const ensureGrifballBallMesh = () =>
    ensureGrifballBallMeshForRefs({ refs: threeRef.current, ballMeshRef: grifballBallMeshRef });

  // Release a charged Pass: throw distance scales with how long alt-attack was held.
  const throwPlayerPass = () =>
    throwPlayerGrifballPassForState({
      state: stateRef.current,
      refs: threeRef.current,
      ballChargingRef,
      ballChargeTimerRef,
      playSwing: () => sfx.playSwing(),
    });

  const updateGrifball = (dt: number) =>
    updateGrifballObjectiveForState({
      state: stateRef.current,
      refs: threeRef.current,
      ballMeshRef: grifballBallMeshRef,
      ballChargingRef,
      ballChargeTimerRef,
      dt,
      isMultiplayer,
      activeCustomMap: getActiveCustomMap(),
      placeCombatantsAtGrifballSpawns,
      pushStatsUpdate,
    });

  function updateMatchTimers(dt: number) {
    updateGrifballMatchTimers(stateRef.current, mai(), dt);
  };

  function renderGame() {
    renderLiveGrifballFrame({
      state: stateRef.current,
      refs: threeRef.current,
      keysPressed: keysPressed.current,
      keybindings: keybindingsRef.current,
      liveCameraFrameState: liveCameraFrameRef.current,
      weatherParticleFrameState: weatherParticleFrameRef.current,
      opponentClientId,
      replayActive: Boolean(replayData),
      getSpectateTargetData,
      getActiveCustomMap,
    });
  };

  function pushStatsUpdate() {
    const s = stateRef.current;
    pushGrifballHudStatsUpdate({
      state: s,
      opponent: opponentDisplay(),
      onStatsUpdate: onStatsUpdateRef.current,
      isMultiplayer,
      multiplayerRole,
      multiplayerSocket,
      fps: fpsRef.current.value,
      getSpectateTargetData,
      opponentPlayerName: opponentNameRef.current || mai()?.playerName || undefined,
    });
  };

  function updateFloatingNameplate() {
    const s = stateRef.current;
    updateFloatingNameplatesForState({
      state: s,
      camera: threeRef.current.camera,
      container: containerRef.current,
      nameplateContainer: nameplateContainerRef.current,
      pool: nameplatePoolRef.current,
      isMultiplayer,
      opponentPlayerName,
      fallbackOpponentName: opponentNameRef.current,
    });
  };

  function updateRadarDOM() {
    updateRadarDomForState({
      state: stateRef.current,
      mainAI: mai(),
      radarDotPool: radarDotPoolRef.current,
    });
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
    animateSpartanCombatantModel({
      refs: threeRef.current,
      mesh,
      vel,
      yaw,
      hp,
      weaponState,
      weaponTimer,
      dt,
      isSliding,
      isSprinting,
      hammerReloadTime: stateRef.current.settings.hammerReloadTime ?? 0.6,
      hammerMeleeReload: stateRef.current.settings.hammerMeleeReload ?? 0.5,
    });
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
            if (data.hostClientId) {
              s.hostClientId = data.hostClientId;
            }
            if (data.clientClientId) {
              s.clientClientId = data.clientClientId;
            }
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

      // Update Sky Dome procedural texture in real-time
      if (threeRef.current.skyboxMesh && threeRef.current.skyboxMesh.material) {
        threeRef.current.skyboxMesh.visible = adminSettings.showSkybox !== false;
        let skyType = 'cyberpunk';
        const activeCustomMap = resolveActiveCustomMap({ customMap, replayData, selectedMap, gameMode: adminSettings.gameMode });
        const effectiveMapId = replayData ? replayData.mapType : selectedMap;
        const isHangar = effectiveMapId === 'hangar';

        if (activeCustomMap) {
          skyType = activeCustomMap.skyboxTexture || activeCustomMap.theme || 'cyberpunk';
          if (skyType === 'matched') {
            skyType = activeCustomMap.theme || 'cyberpunk';
          }
        } else if (isHangar) {
          skyType = 'hangar';
        }

        try {
          const newTex = getSkyboxTexture(skyType, hue, brightness, colorString);
          const mat = threeRef.current.skyboxMesh.material as THREE.MeshBasicMaterial;
          mat.map = newTex;
          mat.needsUpdate = true;
        } catch (err) {
          console.error('Failed to update skybox texture:', err);
        }
      }
    }
  }, [adminSettings, customMap, replayData, selectedMap]);

  useEffect(() => {
    resetAIMatchContext(stateRef.current.aiMatchContext);
  }, [aiMatchSessionKey]);

  const onStatsUpdateRef = useLatestRef(onStatsUpdate);

  // Mutable refs for isPaused and keybindings so the heavy Three.js mounting
  // useEffect does NOT re-run (destroy + recreate the WebGL canvas) every time
  // the user pauses/unpauses or changes keybindings.
  const isPausedRef = usePausedPointerLockRef(isPaused);

  const keybindingsRef = useLatestRef(keybindings);

  // Sprint toggle-mode state: when holdToSprint is false, tapping the sprint
  // button flips sprintToggleActiveRef. prevSprintInputRef tracks the previous
  // frame's raw sprint input so we only flip on the rising (press) edge.
  const sprintToggleActiveRef = useRef(false);
  const prevSprintInputRef = useRef(false);

  const {
    keysPressed,
    prevGamepadButtonsRef,
    grifbHoldTimerRef,
    secretAudioRef,
    isPointerLocked,
    isMouseDown,
    lastMousePos,
  } = useGrifballInputRefs();

  // References to THREE objects needed inside loop
  const threeRef = useRef<GrifballThreeRefs>(createInitialGrifballThreeRefs());

  // Track if mouse/pointer lock instructions should be displayed
  const [showPointerLockAlert, setShowPointerLockAlert] = useState(true);

  const {
    lastOpponentHue,
    radarDotPoolRef,
    nameplatePoolRef,
  } = useGrifballDomPoolRefs();
  const opponentNameRef = useLatestRef(opponentPlayerName || '');

  const updateBlinking = (group: THREE.Group | null, active: boolean) => {
    updateInvulnerabilityBlinking({
      group,
      active,
      skipMeshes: [threeRef.current.debugPlayerSphere, threeRef.current.debugEnemySphere],
    });
  };

  const getSpectateTargetData = (target: SpectateTargetRole) => resolveSpectateTargetData({
    target,
    state: stateRef.current,
    isMultiplayer,
    multiplayerRole,
    mainAI: mai(),
    opponentName: opponentNameRef.current,
    opponentClientId,
    lastOpponentHue: lastOpponentHue.current,
  });

  const cycleReplayTarget = (direction: ReplayTargetCycleDirection = 'next') => {
    const playerIds = replayPlayerIdsRef.current;
    if (!playerIds) return;
    cycleReplayTargetForState({
      state: stateRef.current,
      playerIds,
      currentTarget: replayTargetIdRef.current || 'free',
      setTarget: (targetId) => {
        replayTargetIdRef.current = targetId;
      },
      direction,
      pushStatsUpdate,
    });
  };

  const rebuildEnemyModel = (hue: number) => {
    rebuildEnemyCombatantModelForState({
      state: stateRef.current,
      refs: threeRef.current,
      hue,
      isMultiplayer,
      multiplayerRole,
      playerLoadout,
      mainAI: mai(),
    });
  };

  const rebuildHostModel = (hue: number) => {
    rebuildHostCombatantModelForState({
      state: stateRef.current,
      refs: threeRef.current,
      hue,
      isMultiplayer,
      multiplayerRole,
      playerLoadout,
    });
  };

  // Define 8 circular spawn points inside the 20m arena (base radius 13m)
  const SPAWN_POINTS = useRef<THREE.Vector3[]>(createDefaultSpawnPoints()).current;

  // Minimax proximity spawning algorithm to select spawn point farthest from threat
  const getOptimalSpawnPoint = (excludePositions: THREE.Vector3[]): THREE.Vector3 => {
    return getOptimalSpawnPointForArena({
      activeCustomMap: getActiveCustomMap(),
      spawnPoints: SPAWN_POINTS,
      excludePositions,
    });
  };

  // Grifball: reposition the player + every AI to their own team's base spawn cluster.
  // Used at roster seed and on round reset so each side starts behind its own goal.
  const placeCombatantsAtGrifballSpawns = () => {
    const s = stateRef.current;
    const gmap = getActiveCustomMap();
    const fallback = resolveActiveSpawnPoints(gmap, SPAWN_POINTS);
    const used: THREE.Vector3[] = [];

    const playerSpawn = getGrifballTeamSpawn(gmap, s.localPlayerTeam, fallback, used);
    s.playerPos.copy(playerSpawn);
    s.playerVel.set(0, 0, 0);
    s.yaw = getInwardSpawnYaw(playerSpawn);
    used.push(playerSpawn.clone());

    for (const bot of s.otherPlayers.values()) {
      if (bot.controller !== 'ai') continue;
      const team = bot.team || 'red';
      const spawn = getGrifballTeamSpawn(gmap, team, fallback, used);
      bot.pos.copy(spawn);
      bot.vel.set(0, 0, 0);
      bot.yaw = getInwardSpawnYaw(spawn);
      used.push(spawn.clone());
    }
  };

  // Dynamic arena resizing based on player count (12.5% for every 2 players, up to 50% max)
  const resizeArena = (playerCount: number) => {
    resizeArenaForPlayerCount({
      state: stateRef.current,
      refs: threeRef.current,
      spawnPoints: SPAWN_POINTS,
      playerCount,
    });
  };

  // Provisions any roster combatant into otherPlayerMeshes (shared rig for AI + remote).
  const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
    createOrUpdateRemoteCombatantForState({
      state: stateRef.current,
      refs: threeRef.current,
      clientId,
      data,
      opponentClientId,
      constrainCombatantToArena,
    });
  };

  const buildOrchestratorSpawnCallbacks = () => {
    const s = stateRef.current;
    return createGrifballAIOrchestratorSpawnCallbacks((exclude, team) => {
      if (s.settings.gameMode === 'grifball' && team) {
        const gmap = getActiveCustomMap();
        const fallback = resolveActiveSpawnPoints(gmap, SPAWN_POINTS);
        return getGrifballTeamSpawn(gmap, team, fallback, exclude);
      }
      return getOptimalSpawnPoint(exclude);
    });
  };

  const buildOrchestratorEvents = (opts?: { silentSpawn?: boolean }) =>
    createGrifballAIOrchestratorEvents({
      refs: threeRef.current,
      createOrUpdateRemotePlayer,
      resizeArena,
      pushStatsUpdate,
      playRespawn: () => sfx.playRespawn(),
      silentSpawn: opts?.silentSpawn,
    });

  const runAIOrchestrator = (dt: number) => {
    const s = stateRef.current;
    runGrifballAIOrchestratorForState({
      state: s,
      dt,
      isPlaying,
      legacy: getLegacyRosterProps(),
      offlineBotCount: offlineBotCountRef.current,
      spawnCallbacks: buildOrchestratorSpawnCallbacks(),
      events: buildOrchestratorEvents(),
    });
  };

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    // 1. INITIALIZE THREE.JS
    const scene = new THREE.Scene();
    threeRef.current.scene = scene;

    // Clear stale mesh references from any previous scene so createOrUpdateRemotePlayer
    // always builds fresh meshes in this scene rather than reusing orphaned ones.
    threeRef.current.otherPlayerMeshes.clear();
    resetTransientVfxRefs(threeRef.current);
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

    // Setup procedural sky dome
    let skyType = 'cyberpunk';
    let sHue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 280;
    let sBrightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 5;

    if (activeCustomMap) {
      skyType = activeCustomMap.skyboxTexture || activeCustomMap.theme || 'cyberpunk';
      if (skyType === 'matched') {
        skyType = activeCustomMap.theme || 'cyberpunk';
      }
      sHue = activeCustomMap.skyboxHue ?? sHue;
      sBrightness = activeCustomMap.skyboxBrightness ?? sBrightness;
    } else if (isHangar) {
      skyType = 'hangar';
      sHue = 220;
      sBrightness = 3;
    }

    try {
      const skyTexture = getSkyboxTexture(skyType, sHue, sBrightness, bgHex);
      const skyGeo = new THREE.SphereGeometry(250, 32, 15);
      const skyMat = new THREE.MeshBasicMaterial({
        map: skyTexture,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false
      });
      const skyMesh = new THREE.Mesh(skyGeo, skyMat);
      skyMesh.name = 'skybox_mesh';
      skyMesh.visible = adminSettings.showSkybox !== false;
      scene.add(skyMesh);
      threeRef.current.skyboxMesh = skyMesh;
    } catch (err) {
      console.error('Failed to create skybox mesh:', err);
    }

    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 400);
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
        const half = getRectHalfExtents(r, activeCustomMap.arenaHalfExtents);
        floorGeo = new THREE.BoxGeometry(half.x * 2, 0.2, half.z * 2);
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
        roughness: activeCustomMap.theme === 'winter_rink' ? 0.2 : (activeCustomMap.theme === 'grifball_stadium' ? 0.18 : 0.8),
        metalness: activeCustomMap.theme === 'winter_rink' ? 0.1 : (activeCustomMap.theme === 'grifball_stadium' ? 0.9 : 0.5),
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.position.y = -0.1;
      floor.receiveShadow = true;
      scene.add(floor);

      // Render Custom Obstacles/Objects!
      threeRef.current.customMapObjects = [];
      activeCustomMap.objects.forEach(obj => {
        const mesh = createHighFidelityObjectMesh(obj, THREE, generateCustomTexture);
        mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
        mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);

        scene.add(mesh);
        threeRef.current.customMapObjects!.push(mesh);
      });

      // Spawn Synthwave scenery if theme is synthwave
      if (activeCustomMap.theme === 'synthwave') {
        const synthwaveGroup = new THREE.Group();
        synthwaveGroup.name = 'synthwave_scenery';

        // 1. Striped Gradient Sunset Sun Disc
        const sunCanvas = document.createElement('canvas');
        sunCanvas.width = 2048;
        sunCanvas.height = 2048;
        const sunCtx = sunCanvas.getContext('2d')!;
        sunCtx.scale(4, 4);
        
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
          bCanvas.width = 512;
          bCanvas.height = 1024;
          const bCtx = bCanvas.getContext('2d')!;
          bCtx.scale(4, 4);
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
          bCanvas.width = 512;
          bCanvas.height = 1024;
          const bCtx = bCanvas.getContext('2d')!;
          bCtx.scale(4, 4);
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
        signCanvas.width = 1024;
        signCanvas.height = 1024;
        const sCtx = signCanvas.getContext('2d')!;
        sCtx.scale(8, 8);
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
            metalness: 0.1,
            roughness: 0.22,
            opacity: 0.8,
            transparent: true,
            emissive: new THREE.Color(idx % 2 === 0 ? '#3b82f6' : '#60a5fa'),
            emissiveIntensity: 0.8
          });

          const iceberg = new THREE.Mesh(iceGeo, iceMat);
          iceberg.position.set(pos.x, -1.0, pos.z);
          iceberg.rotation.y = Math.random() * Math.PI;
          iceberg.rotation.x = (Math.random() - 0.5) * 0.1;
          iceberg.castShadow = false;
          iceberg.receiveShadow = false;
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
          mesh.receiveShadow = false;
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
          trunk.castShadow = false;
          trunk.receiveShadow = false;
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
            pine.castShadow = false;
            pine.receiveShadow = false;
            tree.add(pine);

            // Snowy cap resting on top of branches
            const capGeo = new THREE.ConeGeometry(layer.r + 0.05, layer.snowH, 6);
            capGeo.translate(0, layer.snowH / 2, 0);
            const cap = new THREE.Mesh(capGeo, duneMat);
            cap.position.y = layer.y + layer.h - layer.snowH * 0.9;
            cap.castShadow = false;
            cap.receiveShadow = false;
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

        const half = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
        const bx = half.x;
        const bz = half.z;

        // 1. Spectator Stands (Tiers of Bleachers)
        // North Bleachers
        for (let tier = 0; tier < 4; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(bx * 1.8, 1.2, 2.5),
            new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(0, tier * 1.0 + 0.6, -bz - 6 - tier * 2.0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // South Bleachers
        for (let tier = 0; tier < 4; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(bx * 1.8, 1.2, 2.5),
            new THREE.MeshStandardMaterial({ color: '#111317', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(0, tier * 1.0 + 0.6, bz + 6 + tier * 2.0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // West Bleachers (Behind Blue Goal)
        for (let tier = 0; tier < 3; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 1.2, bz * 2.2),
            new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(-bx - 4 - tier * 2.0, tier * 1.0 + 0.6, 0);
          tierBox.castShadow = true;
          tierBox.receiveShadow = true;
          stadiumGroup.add(tierBox);
        }

        // East Bleachers (Behind Red Goal)
        for (let tier = 0; tier < 3; tier++) {
          const tierBox = new THREE.Mesh(
            new THREE.BoxGeometry(2.5, 1.2, bz * 2.2),
            new THREE.MeshStandardMaterial({ color: '#0c0d12', roughness: 0.8, metalness: 0.6 })
          );
          tierBox.position.set(bx + 4 + tier * 2.0, tier * 1.0 + 0.6, 0);
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

        stadiumGroup.add(buildLightTower(-bx - 2, -bz - 2, true)); // NW Blue
        stadiumGroup.add(buildLightTower(-bx - 2, bz + 2, true));  // SW Blue
        stadiumGroup.add(buildLightTower(bx + 2, -bz - 2, false)); // NE Red
        stadiumGroup.add(buildLightTower(bx + 2, bz + 2, false));  // SE Red

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

        stadiumGroup.add(buildBillboard(-bx * 0.4, -bz - 8, 'stadium_advertisement_sapphire'));
        stadiumGroup.add(buildBillboard(bx * 0.4, -bz - 8, 'stadium_advertisement_gauss'));
        stadiumGroup.add(buildBillboard(-bx * 0.4, bz + 8, 'stadium_advertisement_gauss'));
        stadiumGroup.add(buildBillboard(bx * 0.4, bz + 8, 'stadium_advertisement_sapphire'));

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

      // Procedural generation of 2048x2048 premium metallic textures
      const texSize = 2048;
      const logicalSize = 1024;
      const scaleFactor = texSize / logicalSize;

      // DIFFUSE/ALBEDO CANVAS
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = texSize;
      diffCanvas.height = texSize;
      const dCtx = diffCanvas.getContext('2d')!;
      dCtx.scale(scaleFactor, scaleFactor);

      // BUMP MAP CANVAS
      const bumpCanvas = document.createElement('canvas');
      bumpCanvas.width = texSize;
      bumpCanvas.height = texSize;
      const bCtx = bumpCanvas.getContext('2d')!;
      bCtx.scale(scaleFactor, scaleFactor);

      // ROUGHNESS MAP CANVAS
      const roughCanvas = document.createElement('canvas');
      roughCanvas.width = texSize;
      roughCanvas.height = texSize;
      const rCtx = roughCanvas.getContext('2d')!;
      rCtx.scale(scaleFactor, scaleFactor);

      if (isHangar) {
        // Fill base layers
        dCtx.fillStyle = '#161a22';
        dCtx.fillRect(0, 0, logicalSize, logicalSize);

        bCtx.fillStyle = '#808080'; // 128 height map baseline
        bCtx.fillRect(0, 0, logicalSize, logicalSize);

        rCtx.fillStyle = '#888888'; // base semi-matte metal
        rCtx.fillRect(0, 0, logicalSize, logicalSize);

        // Draw modular steel plate tiles (16x16 grid)
        const tileSize = 64; 
        for (let y = 0; y < logicalSize; y += tileSize) {
          for (let x = 0; x < logicalSize; x += tileSize) {
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
        dCtx.fillRect(gxStart, 0, grateWidth, logicalSize);
        
        // Bump trench channel (sunken)
        bCtx.fillStyle = '#101010';
        bCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

        // Roughness trench channel (very rough interior)
        rCtx.fillStyle = '#e2e8f0';
        rCtx.fillRect(gxStart, 0, grateWidth, logicalSize);

        // Frame borders for the trench
        dCtx.fillStyle = '#2d3748';
        dCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
        dCtx.fillRect(gxEnd, 0, 4, logicalSize);

        dCtx.fillStyle = '#4a5568';
        dCtx.fillRect(gxStart - 1, 0, 1, logicalSize);
        dCtx.fillRect(gxEnd + 3, 0, 1, logicalSize);

        bCtx.fillStyle = '#b8b8b8'; // raised frame
        bCtx.fillRect(gxStart - 4, 0, 4, logicalSize);
        bCtx.fillRect(gxEnd, 0, 4, logicalSize);

        // Horizontal steel grate bars
        const barSpacing = 16;
        const barThickness = 6;
        for (let gy = 0; gy < logicalSize; gy += barSpacing) {
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
          dCtx.fillRect(xStart, 0, stripeWidth, logicalSize);

          // Black diagonal bands
          dCtx.fillStyle = '#0f172a';
          for (let sy = -stripeWidth; sy < logicalSize; sy += stripeSpacing) {
            dCtx.beginPath();
            dCtx.moveTo(xStart, sy);
            dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth);
            dCtx.lineTo(xStart + stripeWidth, sy + stripeWidth + 10);
            dCtx.lineTo(xStart, sy + 10);
            dCtx.closePath();
            dCtx.fill();
          }

          bCtx.fillStyle = '#808080';
          bCtx.fillRect(xStart, 0, stripeWidth, logicalSize);

          rCtx.fillStyle = '#94a3b8'; // rough warning paint
          rCtx.fillRect(xStart, 0, stripeWidth, logicalSize);
        };

        drawHazardStripes(gxStart - 20);
        drawHazardStripes(gxEnd + 4);

        // Weathering scratches
        for (let i = 0; i < 150; i++) {
          const sx = Math.random() * logicalSize;
          const sy = Math.random() * logicalSize;
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
          const dx = Math.random() * logicalSize;
          const dy = Math.random() * logicalSize;
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
        dCtx.fillRect(0, 0, logicalSize, logicalSize);

        // Clean height map baseline
        bCtx.fillStyle = '#808080';
        bCtx.fillRect(0, 0, logicalSize, logicalSize);

        // Semi-glossy metallic surface roughness
        rCtx.fillStyle = '#333333';
        rCtx.fillRect(0, 0, logicalSize, logicalSize);

        // Draw clean neon cyan virtual space grid
        dCtx.strokeStyle = 'rgba(6, 182, 212, 0.4)'; // cyan
        dCtx.lineWidth = 3;
        const step = 64;
        for (let i = 0; i <= logicalSize; i += step) {
          dCtx.beginPath();
          dCtx.moveTo(i, 0);
          dCtx.lineTo(i, logicalSize);
          dCtx.stroke();

          dCtx.beginPath();
          dCtx.moveTo(0, i);
          dCtx.lineTo(logicalSize, i);
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
        for (let i = 0; i <= logicalSize; i += step) {
          bCtx.strokeRect(i - 1, -1, 2, logicalSize + 2);
          bCtx.strokeRect(-1, i - 1, logicalSize + 2, 2);
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
        // Blade is built along +y; -PI/2 points it toward -z (forward / visor
        // direction). +PI/2 would aim it backward. See positionSword().
        enemySword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8);
        enemySword.visible = false;
        if (enemyGroup.userData.upperTorso) {
          enemyGroup.userData.upperTorso.add(enemySword);
        } else {
          enemyGroup.add(enemySword);
        }
        threeRef.current.enemySword = enemySword;
      } else {
        // Offline: unified roster â€” main_ai + bot_* via orchestrator seed
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

        // Grifball: place the player and each AI at their own team's base spawns.
        if (s.settings.gameMode === 'grifball') {
          placeCombatantsAtGrifballSpawns();
        }
      }
    }

    // 5. FIRST-PERSON WEAPON CONTAINER
    const fpWeaponContainer = new THREE.Group();
    camera.add(fpWeaponContainer); // Anchored as camera child
    
    // Build the gravity hammer model
    const playerHammer = buildGravityHammerModel(adminSettings.playerHue, playerLoadout?.hammerPreset);
    // Neutral positioning (placed on right of screen, angled neatly forward)
    playerHammer.position.set(0.35, -0.38, -0.65);
    playerHammer.rotation.set(0.15, -0.3, -0.15); // standard idle poise
    fpWeaponContainer.add(playerHammer);
    threeRef.current.playerHammer = playerHammer;

    // Build the katar sword model
    const playerSword = buildKatarSwordModel(adminSettings.playerHue, playerLoadout?.swordPreset);
    // Neutral positioning (placed on right side, angled forward)
    playerSword.position.set(0.35, -0.38, -0.5);
    playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8); // Points forward, tilted slightly inwards
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
          const limit = s.settings.hammerJumpAirLimit ?? 1;
          const withinLimit = limit === 10 || (s.pHammerJumpsInAir ?? 0) < limit;

          if (s.pHammerJumpWindowTimer > 0 && limit > 0 && withinLimit) {
            // Check input gate if enabled
            const gate = s.settings.hammerJumpInputGate ?? 0;
            const elapsed = (s.settings.hammerJumpWindow ?? 0.6) - s.pHammerJumpWindowTimer;
            const passesGate = gate === 0 || (!e.repeat && elapsed <= gate);

            if (passesGate) {
              // Hammer jump boost!
              s.isJumping = true;
              s.playerVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
              s.pHammerJumpWindowTimer = 0; // Consume the window
              s.pHammerJumpsInAir = (s.pHammerJumpsInAir ?? 0) + 1;
              sfx.playJump();
              // Spawn beautiful fire/wind blast shockwave particles under feet
              spawnVoxelShockwaveParticles(s.playerPos, '#f59e0b');
              return;
            }
          }

          if (!s.isJumping) {
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
            const mainAi = mai();
            if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.weaponState === 'swing_up') {
              observePlayerReaction(model, mainAi.weaponTimer ?? 0);
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
        // PRIMARY ATTACK: Hammer Slam, Sword Lunge, Pistol Fire, or Ball Punch
        if (s.activeWeapon === 'ball') {
          // PUNCH: forward melee (reuses the hammer strike path).
          if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
            triggerPlayerHammerSwing();
          }
        } else if (s.activeWeapon === 'hammer') {
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
        // ALT ATTACK: Sword Slash, Hammer Melee, or begin Ball Pass charge
        if (s.activeWeapon === 'ball') {
          if (s.grifball.ball.holderId === 'player') {
            ballChargingRef.current = true;
            ballChargeTimerRef.current = 0;
          }
        } else if (s.activeWeapon === 'sword') {
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

    // Release a charged Pass when the alt-attack button comes up.
    const handleCanvasMouseUp = (e: MouseEvent) => {
      if (!isPlaying || isPausedRef.current) return;
      const mouseMap: Record<number, string> = { 0: 'lmb', 2: 'rmb', 1: 'mmb' };
      const releasedBtn = mouseMap[e.button] || '';
      if (releasedBtn === keybindingsRef.current.altAttack && ballChargingRef.current) {
        throwPlayerPass();
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
    window.addEventListener('mouseup', handleCanvasMouseUp);
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
      window.removeEventListener('mouseup', handleCanvasMouseUp);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
      window.removeEventListener('mobile-attack-primary', handleMobileAttackPrimary);
      window.removeEventListener('mobile-attack-alt', handleMobileAttackAlt);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('cycle-observer-mode', handleCycleObserverMode);
      window.removeEventListener('cycle-observer-target', handleCycleObserverTarget);

      disposeTransientVfxRefs(threeRef.current);

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (renderer) {
        renderer.dispose();
      }
    };
  }, [isPlaying, replayData, selectedMap, customMap]);

  const getReconstructedState = (playerType: 'player' | typeof MAIN_AI_ID | string, frameIdx: number) =>
    getReconstructedReplayState(replayData, playerType, frameIdx);

  const recordReplayFrame = (time: number) => {
    const s = stateRef.current;
    if (!replayRecordingRef.current) return;

    const frame: ReplayFrame = {
      time,
      otherPlayers: []
    };

    const hasPlayerChanged = (id: string, current: Parameters<typeof hasReplayEntityStateChanged>[0]) =>
      hasReplayEntityStateChanged(current, lastRecordedStateRef.current.get(id));

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

    // 2. Process roster combatants (main_ai + bots) via otherPlayers â€” legacy f.ai read only for old replays
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
      playerX: mainPlayer.pos?.x ?? 0,
      playerZ: mainPlayer.pos?.z ?? 0,
      playerYaw: mainPlayer.yaw ?? 0,
      enemyX: mainAI.pos?.x ?? 0,
      enemyZ: mainAI.pos?.z ?? 0,
      enemyYaw: mainAI.yaw ?? 0,
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
    updateTransientVfxForFrame(threeRef.current, playbackDt);
  };

  // Handle active game cycles
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    // 1. Initialize Replay Recorder if playing a normal match
    if (isPlaying && !replayData && !replayRecordingRef.current) {
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

      // â”€â”€â”€ Hidden Key Combo Hold Detection (GRIFB) â”€â”€â”€
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



      // Slowly rotate the sky dome
      if (threeRef.current.skyboxMesh) {
        threeRef.current.skyboxMesh.rotation.y += dt * 0.004;
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
        updateGrifball(dt);
        updateCharacterSkeletalAnimations(dt);
        updateTransientVfxForFrame(threeRef.current, dt);
        updateMatchTimers(dt);
        enforceArenaBounds(dt);

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
      // Replay is compiled and auto-saved only when the game is fully closed / unmounted.
    };
  }, [isPlaying, isPaused, isMultiplayer, multiplayerRole, multiplayerSocket, replayData]);

  // Save compiled replay on unmount of GrifballGame
  useEffect(() => {
    return () => {
      saveCompiledReplay();
    };
  }, []);

  const getPlayerSwordLockTarget = () => {
    return getPlayerSwordLockTargetFromState(stateRef.current, mai(), isMultiplayer);
  };

  const getEnemyAITarget = () => {
    const s = stateRef.current;
    const mainAi = mai();
    if (!mainAi) return null;
    // Resolve the main AI's *actual* engagement target via the same tactical
    // selector the movement FSM uses, so its hammer/slash impact lands where the
    // bot is facing. Previously this always returned the player whenever not in
    // observer mode, which meant the main AI's swings aimed at the player even
    // while it was fighting another bot â€” they'd visibly "swing in the wrong
    // direction" and could never damage a bot with a hammer or slash (only lunges,
    // which use getBestTacticalTarget, ever connected against bots).
    const difficulty = resolveRosterSlot('main_ai').difficulty || 'normal';
    const best = getBestTacticalTarget('main_ai', mainAi.pos, difficulty);
    return getEnemyAITargetFromTacticalTarget(best);
  };

  // Resolve a DoomBot's hammer/slash damage at its swing apex. DoomBots only
  // animated their swings (see the bot weapon state machine in the other-players
  // animation block) and only ever dealt damage through sword *lunges*, so a
  // hammer bot â€” or any bot forced to swing at close range instead of lunging â€”
  // could never actually hurt anyone. This mirrors the main AI's
  // applyHammerStrikeImpact: plant a damage sphere (radius attackRadius) ~attackRange
  // ahead along the bot's facing yaw and damage every other combatant inside it
  // (free-for-all). Singleplayer only; multiplayer resolves hits authoritatively
  // elsewhere.
  const applyBotMeleeImpact = (botId: string) => {
    return applyBotMeleeImpactForState({
      state: stateRef.current,
      botId,
      renderHammerSplashVfx,
      spawnVoxelShockwaveParticles,
      playExplosion: () => sfx.playExplosion(),
      playDeath: () => sfx.playDeath(),
      playSwing: () => sfx.playSwing(),
      recordBotPsychKill,
      recordBotCalibrationDeath,
    });
  };

  const sendPlayerWeaponSync = (payload: object): boolean => {
    if (isMultiplayer && multiplayerSocket && multiplayerSocket.readyState === WebSocket.OPEN) {
      multiplayerSocket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  // TRIGGERS PLAYER SWING
  const triggerPlayerHammerSwing = () =>
    triggerPlayerHammerSwingForState({
      state: stateRef.current,
      recordHammerAttack: () => recordLocalPlayerObservation((model) => observePlayerHammerAttack(model)),
      playSwing: () => sfx.playSwing(),
      sendSync: sendPlayerWeaponSync,
    });

  // TRIGGERS PLAYER HAMMER MELEE
  const triggerPlayerHammerMelee = () =>
    triggerPlayerHammerMeleeForState({
      state: stateRef.current,
      playSwing: () => sfx.playSwing(),
      sendSync: sendPlayerWeaponSync,
    });

  // TRIGGERS PLAYER PISTOL FIRE (HITSCAN)
  const triggerPlayerPistolFire = () =>
    triggerPlayerPistolFireForState({
      state: stateRef.current,
      refs: threeRef.current,
      isPaused,
      isPlaying,
      sendSync: sendPlayerWeaponSync,
      spawnVoxelShockwaveParticles,
      playImpact: () => sfx.playSwing(),
      playDeath: () => sfx.playDeath(),
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
    });

  // SWAPS PLAYER WEAPON
  const swapPlayerWeapon = (type: PlayerSwappableWeapon) =>
    swapPlayerWeaponForState({
      state: stateRef.current,
      refs: threeRef.current,
      type,
      isPaused,
      isPlaying,
      recordWeaponSwap: (weapon) => recordLocalPlayerObservation((model) => observePlayerWeaponSwap(model, weapon)),
      pushStatsUpdate,
    });

  // TRIGGERS PLAYER SWORD SLASH
  const triggerPlayerSwordSlash = () =>
    triggerPlayerSwordSlashForState({
      state: stateRef.current,
      playSwing: () => sfx.playSwing(),
      sendSync: sendPlayerWeaponSync,
    });

  // TRIGGERS PLAYER SWORD LUNGE
  const triggerPlayerSwordLunge = () =>
    triggerPlayerSwordLungeForState({
      state: stateRef.current,
      lockTarget: getPlayerSwordLockTarget(),
      recordLungeStart: (lungeDistance) =>
        recordLocalPlayerObservation((model) => observePlayerLungeStart(model, lungeDistance)),
      playDash: () => sfx.playDash(),
      sendSync: sendPlayerWeaponSync,
    });

  // TRIGGERS ENEMY AI SWING (offline main_ai or multiplayer remote opponent proxy)
  const enemyCombatProxy = (): Combatant | undefined => opponentDisplay() ?? mai();

  const triggerEnemyHammerSwing = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    triggerCombatantAttackAction({
      self: enemy,
      weapon: 'hammer',
      recordHammerAttack: () => {},
      playSwing: () => {},
    });
  };

  // TRIGGERS ENEMY AI HAMMER MELEE
  const triggerEnemyHammerMelee = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    triggerCombatantAttackAction({
      self: enemy,
      weapon: 'hammer',
      melee: true,
      recordHammerAttack: () => {},
      playSwing: () => sfx.playSwing(),
    });
  };

  // TRIGGERS ENEMY AI SWORD SLASH
  const triggerEnemySwordSlash = () => {
    const enemy = enemyCombatProxy();
    if (!enemy) return;
    if ((enemy.swapCooldownTimer ?? 0) > 0) return;
    if ((enemy.aiDashRemaining ?? 0) > 0) return;
    triggerCombatantAttackAction({
      self: enemy,
      weapon: 'sword',
      recordHammerAttack: () => {},
      playSwing: () => sfx.playSwing(),
    });
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
    return getLocalPlayerFeedNameFromState(s.settings.playerName, multiplayerRole);
  };

  const recordDeathEvent = (
    attacker: string, 
    victim: string, 
    medals?: MedalInfo[], 
    weapon?: 'sword' | 'hammer' | 'sword_vs_sword' | 'sword_vs_hammer' | 'hammer_vs_hammer'
  ) => {
    return recordDeathEventOnState(stateRef.current, attacker, victim, medals, weapon);
  };

  const applyOutgoingMultiplayerHitLocally = (targetId: string, damage: number = 1) =>
    applyOutgoingMultiplayerHitForState({
      state: stateRef.current,
      targetId,
      damage,
      evaluatePlayerKillMedals,
      recordDeathEvent,
      getLocalPlayerFeedName,
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
    });

  const executeCustomBotTrade = (
    attackerBot: Combatant,
    target: { id: string },
    reason: CombatTradeReason = 'sword_vs_sword'
  ) =>
    executeCustomBotTradeForState({
      state: stateRef.current,
      attackerBot,
      target,
      reason,
      rosterCombatant,
      evaluatePlayerKillMedals,
      recordDeathEvent,
      getLocalPlayerFeedName,
      playExplosion: () => sfx.playExplosion(),
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
      recordBotCalibrationDeath,
      pushStatsUpdate,
    });

  function evaluatePlayerKillMedals(victimId: string): MedalInfo[] {
    const s = stateRef.current;
    return evaluatePlayerKillMedalsForState({
      state: s,
      getState: () => stateRef.current,
      victimId,
      victim: rosterCombatant(victimId),
      playMedal: (medalId) => sfx.playMedal(medalId),
      onPopupExpired: pushStatsUpdate,
    });
  }

  // MUTUAL TRADING FUNCTIONALITY
  const executeTrade = (reason: CombatTradeReason) =>
    executeMainAITradeForState({
      state: stateRef.current,
      mainAi: mai(),
      reason,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
      playExplosion: () => sfx.playExplosion(),
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
      pushStatsUpdate,
    });

  // TRIGGER PROGRAMMATIC EXPLOSION (Voxel shockwave particles)
  const spawnVoxelShockwaveParticles = (impactCenter: THREE.Vector3, color: string) => {
    spawnVoxelShockwaveParticlesForThreeRefs(threeRef.current, impactCenter, color);
  };

  const renderHammerSplashVfx = (impactCenter: THREE.Vector3, color: string, radius: number) => {
    const s = stateRef.current;
    renderHammerSplashVfxForThreeRefs({
      refs: threeRef.current,
      impactCenter,
      color,
      radius,
      splashVfx: s.settings.hammerSplashVfx ?? 'current',
      enableBurnDecals: !!s.settings.enableBurnDecals,
    });
  };

  const renderSwordLungeTrailVfx = (
    trailPos: THREE.Vector3,
    color: string,
    direction?: THREE.Vector3,
    currentStyle: SwordLungeCurrentTrailStyle = 'localCube'
  ) => {
    renderSwordLungeTrailVfxForThreeRefs({
      refs: threeRef.current,
      trailPos,
      color,
      direction,
      currentStyle,
      swordLungeVfx: stateRef.current.settings.swordLungeVfx ?? 'current',
    });
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
        const gpAccel = keybindingsRef.current.gamepadAcceleration ?? 0.0;
        const baseSpeed = 2.4; 
        
        let targetYawOffset = 0;
        let targetPitchOffset = 0;

        const applyAccel = (val: number) => {
          if (gpAccel === 0) return val;
          const absVal = Math.abs(val);
          const sign = val < 0 ? -1 : 1;
          return sign * Math.pow(absVal, 1 + gpAccel * 0.5);
        };

        if (Math.abs(rx) > aimDeadzone) {
          targetYawOffset = applyAccel(rx) * baseSpeed * gpSens * dt;
        }
        if (Math.abs(ry) > aimDeadzone) {
          targetPitchOffset = applyAccel(ry) * baseSpeed * gpSens * dt;
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
          const limit = s.settings.hammerJumpAirLimit ?? 1;
          const withinLimit = limit === 10 || (s.pHammerJumpsInAir ?? 0) < limit;

          if (s.pHammerJumpWindowTimer > 0 && limit > 0 && withinLimit) {
            // Check input gate if enabled
            const gate = s.settings.hammerJumpInputGate ?? 0;
            const elapsed = (s.settings.hammerJumpWindow ?? 0.6) - s.pHammerJumpWindowTimer;
            const passesGate = gate === 0 || elapsed <= gate;

            if (passesGate) {
              s.isJumping = true;
              s.playerVel.y = 7.2 + (s.settings.hammerJumpPower ?? 6.5);
              s.pHammerJumpWindowTimer = 0; // Consume the window
              s.pHammerJumpsInAir = (s.pHammerJumpsInAir ?? 0) + 1;
              sfx.playJump();
              spawnVoxelShockwaveParticles(s.playerPos, '#f59e0b');
            } else if (!s.isJumping) {
              s.isJumping = true;
              s.playerVel.y = 7.2;
              sfx.playJump();
            }
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
            const mainAi = mai();
            if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.weaponState === 'swing_up') {
              observePlayerReaction(model, mainAi.weaponTimer ?? 0);
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
          } else if (s.activeWeapon === 'hammer') {
            if (s.pWeaponReady && s.pWeaponState === 'ready' && s.playerDashRemaining <= 0) {
              triggerPlayerHammerMelee();
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
        const mainAi = mai();
        if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING') {
          exclude.push(mainAi.pos);
        }
        
        const spawnPos = s.settings.gameMode === 'grifball'
          ? getGrifballTeamSpawn(getActiveCustomMap(), s.localPlayerTeam, resolveActiveSpawnPoints(getActiveCustomMap(), SPAWN_POINTS), exclude)
          : getOptimalSpawnPoint(exclude);
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
      s.pHammerJumpsInAir = 0;
      s.isCrouching = false;
      constrainCombatantToArena(s.playerPos, s.playerVel);

      // Spawn energy trail particles or selected lunge speed-line effect.
      const trailPos = s.playerPos.clone();
      trailPos.y += 0.5;
      renderSwordLungeTrailVfx(trailPos, '#22d3ee', s.lungeTargetDir, 'localCube');

      // Check distance to enemy torso center
      let closestTarget: any = null;
      let dist = Infinity;

      const mainAi = mai();
      if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING' && areCombatantsHostile('player', MAIN_AI_ID)) {
        closestTarget = { id: 'main_ai', pos: mainAi.pos, hp: mainAi.hp, name: 'Red (AI)' };
        dist = s.playerPos.distanceTo(mainAi.pos);
      }

      if (s.otherPlayers) {
        s.otherPlayers.forEach((other) => {
          if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0 && areCombatantsHostile('player', other.id)) {
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
                if (other.id === MAIN_AI_ID) {
                  s.scoreEnemy += 1;
                  s.enemyKills += 1;
                }
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
            const mainAi = mai();
            if (mainAi) {
              const swordThreshold = s.settings.swordTradeWindow ?? 350;
              const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;
              const isAISwordActiveAttack = s.settings.enableSwordTrade && mainAi.activeWeapon === 'sword' && (
                mainAi.aiState === 'LUNGING' || 
                mainAi.weaponState === 'swing_up' || 
                mainAi.weaponState === 'swing_down' || 
                (Date.now() - mainAi.lastSwordAttackTime <= swordThreshold)
              );
              const isAIHammerActiveAttack = s.settings.enableHammerSwordTrade && mainAi.activeWeapon === 'hammer' && (
                mainAi.weaponState === 'swing_up' || 
                mainAi.weaponState === 'swing_down' ||
                (Date.now() - mainAi.lastHammerAttackTime <= hammerThreshold)
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
              recordCalibrationDodgeFailed(stateRef.current.aiMatchContext, 'main_ai', resolveBehaviorTuning(stateRef.current.settings).calibrationWindowSize);
              mainAi.hp -= 1;
              if (mainAi.hp <= 0) {
                mainAi.hp = 0;
                mainAi.aiState = 'RESPAWNING';
                s.enemyRespawnTimer = 3.0;
                s.scorePlayer += 1;
                s.playerKills += 1;
                s.enemyDeaths += 1;
                recordBotCalibrationDeath('main_ai');
                sfx.playDeath();
                mainAi.weaponState = 'ready';
                mainAi.weaponTimer = 0;

                const medals = evaluatePlayerKillMedals('main_ai');
                const newDeath: DeathEvent = {
                  id: Math.random().toString(36).substring(2, 9),
                  attacker: s.settings.playerName || 'Blue (You)',
                  victim: 'Red (AI)',
                  medals,
                  weapon: 'sword',
                };
                s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');
              } else {
                sfx.playSwing();
              }
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
        const half = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
        const boundX = half.x - 0.6;
        const boundZ = half.z - 0.6;
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
      const sprintInputDown = !!(keysPressed.current[keybindingsRef.current.sprint] || gpSprint);
      // Resolve whether sprint is "engaged" based on the input mode. In hold mode
      // (default) sprint follows the raw input; in toggle mode a press flips a
      // persistent flag so the player can sprint without holding the button.
      let sprintEngaged: boolean;
      if (keybindingsRef.current.holdToSprint === false) {
        if (sprintInputDown && !prevSprintInputRef.current) {
          sprintToggleActiveRef.current = !sprintToggleActiveRef.current;
        }
        sprintEngaged = sprintToggleActiveRef.current;
      } else {
        sprintEngaged = sprintInputDown;
      }
      prevSprintInputRef.current = sprintInputDown;
      const isSprinting = s.settings.enableSprint && sprintEngaged && moveForward > 0 && !s.isCrouching && !s.isJumping && s.playerDashRemaining <= 0;
      const isSliding = s.playerSlideActive;

      // Movement speed coefficients
      let baseSpeed = 5.8;
      if (s.settings.gameMode === 'grifball' && s.activeWeapon === 'ball') {
        baseSpeed = 5.8 * 1.3; // Runner is faster!
      } else if (s.isCrouching) {
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
        s.pHammerJumpsInAir = 0;
      }
    } else {
      s.playerPos.y = 0;
      s.playerVel.y = 0;
    }
    }

    // (Main-AI gravity / altitude / arena-constraint is now integrated in-tick by
    // updateSingleAIEntity â€” the same path bots use â€” so the former external "Handle AI
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
    const mainAi = mai();
    if (mainAi) {
      if (mainAi.swapCooldownTimer > 0) {
        mainAi.swapCooldownTimer = Math.max(0, mainAi.swapCooldownTimer - dt);
      }
      if (mainAi.swapLockoutTimer > 0) {
        mainAi.swapLockoutTimer = Math.max(0, mainAi.swapLockoutTimer - dt);
      }
    }
    if (s.swapLockoutTimer > 0) {
      s.swapLockoutTimer = Math.max(0, s.swapLockoutTimer - dt);
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
        playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
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
            playerSword.rotation.set(-Math.PI / 2 - 0.15, 0, 0);
            
            s.pSwordReady = false;
            s.pSwordCooldown = 0.5;
          } 
          else if (s.pSwordState === 'ready') {
            // Neutral stance
            playerSword.position.set(0.35, -0.38 + idleYBob, -0.5 + idleXBob);
            playerSword.rotation.set(-Math.PI / 2, 0, -Math.PI / 8 + idleZRotBob);
            
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
            
            playerSword.rotation.x = -Math.PI / 2;
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
              const mainAi = mai();
              if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING' && (mainAi.invulnerabilityTimer ?? 0) <= 0 && areCombatantsHostile('player', MAIN_AI_ID)) {
                const enemyCenter = new THREE.Vector3(mainAi.pos.x, mainAi.pos.y + 0.825, mainAi.pos.z);
                const toEnemy = enemyCenter.clone().sub(eyePos);
                const dist = toEnemy.length();
                if (dist <= MELEE_SWORD_SLASH_REACH) {
                  const toEnemyDir = toEnemy.clone().normalize();
                  const dot = cameraLookDir.dot(toEnemyDir);
                  const angle = Math.acos(Math.max(-1.0, Math.min(1.0, dot)));
                  
                  if (angle <= 1.0) {
                    const swordThreshold = s.settings.swordTradeWindow ?? 350;
                    const isAISwordActiveAttack = s.settings.enableSwordTrade && mainAi.activeWeapon === 'sword' && (
                      mainAi.aiState === 'LUNGING' || 
                      mainAi.weaponState === 'swing_up' || 
                      mainAi.weaponState === 'swing_down' || 
                      (Date.now() - mainAi.lastSwordAttackTime <= swordThreshold)
                    );
                    if (isAISwordActiveAttack) {
                      executeTrade('sword_vs_sword');
                      return;
                    }

                    mainAi.hp -= 1;
                    sfx.playSwing();
                    spawnVoxelShockwaveParticles(mainAi.pos, '#22d3ee');
                    s.lastStrikePos = mainAi.pos.clone();
                    s.lastStrikeTick = 1.0;
                    if (mainAi.hp <= 0) {
                      mainAi.hp = 0;
                      mainAi.aiState = 'RESPAWNING';
                      s.enemyRespawnTimer = 3.0;
                      s.scorePlayer += 1;
                      s.playerKills += 1;
                      s.enemyDeaths += 1;
                      recordBotCalibrationDeath('main_ai');
                      sfx.playDeath();
                      mainAi.weaponState = 'ready';
                      mainAi.weaponTimer = 0;
                      
                      const medals = evaluatePlayerKillMedals('main_ai');
                      const newDeath: DeathEvent = {
                        id: Math.random().toString(36).substring(2, 9),
                        attacker: s.settings.playerName || 'Blue (You)',
                        victim: 'Red (AI)',
                        medals,
                        weapon: s.activeWeapon,
                      };
                      s.lastDeaths = [newDeath, ...s.lastDeaths].slice(0, 3);
                      spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');
                    }
                  }
                }
              }
 
              // Check other players/bots
              if (s.otherPlayers) {
                s.otherPlayers.forEach((other) => {
                  if (other.hp > 0 && !other.isObserver && other.respawnTimer <= 0 && (!other.invulnerabilityTimer || other.invulnerabilityTimer <= 0) && areCombatantsHostile('player', other.id)) {
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
            
            playerSword.rotation.x = -Math.PI / 2;
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
    const mainAiWeapons = getCombatantWeaponMeshes(threeRef.current, 'main_ai');
    const enemyHammerModel = mainAiWeapons?.hammer;
    const enemySwordModel = mainAiWeapons?.sword;

    // mainAi is already declared at the top of updateHammerAnimations
    if (!s.isMultiplayer && enemyHammerModel && enemySwordModel && mainAi) {
      enemyHammerModel.visible = mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING' && mainAi.activeWeapon === 'hammer';
      enemySwordModel.visible = mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING' && mainAi.activeWeapon === 'sword';

      if (mainAi.hp <= 0 || mainAi.aiState === 'RESPAWNING') {
        mainAi.weaponState = 'ready';
        mainAi.weaponTimer = 0;
        enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
        enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
        enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
      } else if (mainAi.activeWeapon === 'hammer') {
        if (mainAi.weaponState === 'ready') {
          enemyHammerModel.position.set(0.48, 1.08 - 0.64, -0.48);
          enemyHammerModel.rotation.set(0.2, 0.1, -0.15);
        } 
        else if (mainAi.weaponState === 'swing_up') {
          mainAi.weaponTimer += dt;
          const windup = 0.28; // player-parity hammer overhead windup (see pWeaponState swing_up)
          const pct = Math.min(1.0, mainAi.weaponTimer / windup);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.48, 0.4, pct),
            THREE.MathUtils.lerp(1.08, 1.8, pct) - 0.64, // high over head
            THREE.MathUtils.lerp(-0.48, -0.15, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(0.2, -1.3, pct); // swing back

          if (pct >= 1.0) {
            mainAi.weaponState = 'swing_down';
            mainAi.weaponTimer = 0;
          }
        } 
        else if (mainAi.weaponState === 'swing_down') {
          mainAi.weaponTimer += dt;
          const strike = 0.12; // player-parity hammer overhead strike (see pWeaponState swing_down)
          const pct = Math.min(1.0, mainAi.weaponTimer / strike);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.4, 0.2, pct),
            THREE.MathUtils.lerp(1.8, 0.6, pct) - 0.64, // smash hard down
            THREE.MathUtils.lerp(-0.15, -0.9, pct) // reach forward
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(-1.3, 1.1, pct);

          if (pct >= 1.0) {
            mainAi.weaponState = 'recovering';
            mainAi.weaponTimer = 0;

            // Perform Enemy damage check
            applyHammerStrikeImpact(false);
          }
        } 
        else if (mainAi.weaponState === 'recovering') {
          mainAi.weaponTimer += dt;
          const recover = s.settings.hammerReloadTime ?? 0.6;
          const pct = Math.min(1.0, mainAi.weaponTimer / recover);

          enemyHammerModel.position.set(
            THREE.MathUtils.lerp(0.2, 0.48, pct),
            THREE.MathUtils.lerp(0.6, 1.08, pct) - 0.64,
            THREE.MathUtils.lerp(-0.9, -0.48, pct)
          );
          enemyHammerModel.rotation.x = THREE.MathUtils.lerp(1.1, 0.2, pct);

          if (pct >= 1.0) {
            mainAi.weaponState = 'ready';
            mainAi.weaponTimer = 0;
          }
        }
        else if (mainAi.weaponState === 'melee_up') {
          mainAi.weaponTimer += dt;
          const windup = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.4 : 0.1;
          const pct = Math.min(1.0, mainAi.weaponTimer / windup);

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
            mainAi.weaponState = 'melee_down';
            mainAi.weaponTimer = 0;
          }
        }
        else if (mainAi.weaponState === 'melee_down') {
          mainAi.weaponTimer += dt;
          const strike = s.settings.hammerMeleeSpeed ? s.settings.hammerMeleeSpeed * 0.6 : 0.14;
          const pct = Math.min(1.0, mainAi.weaponTimer / strike);

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
            mainAi.weaponState = 'melee_recover';
            mainAi.weaponTimer = 0;

            // Perform Enemy Hammer Melee hit check
            applyEnemyHammerMeleeImpact();
          }
        }
        else if (mainAi.weaponState === 'melee_recover') {
          mainAi.weaponTimer += dt;
          const recover = s.settings.hammerMeleeReload ?? 0.5;
          const pct = Math.min(1.0, mainAi.weaponTimer / recover);

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
            mainAi.weaponState = 'ready';
            mainAi.weaponTimer = 0;
          }
        }
      } else if (mainAi.activeWeapon === 'sword') {
        // ENEMY KATAR SWORD WALK / STRIKE ANIMATION
        if (mainAi.aiState === 'LUNGING') {
          // Lunge forward poise: points straight forward, aligned centered
          enemySwordModel.position.set(0.0, 1.2 - 0.64, -0.75);
          enemySwordModel.rotation.set(Math.PI / 2 + 0.15, 0, 0);
        } else if (mainAi.weaponState === 'ready') {
          enemySwordModel.position.set(0.48, 1.08 - 0.64, -0.32);
          enemySwordModel.rotation.set(Math.PI / 2, 0, -Math.PI / 8);
        } 
        else if (mainAi.weaponState === 'swing_up') {
          mainAi.weaponTimer += dt;
          // Split 0.5/0.5 so the hit lands at mid-swing, exactly like the player's slash.
          const windup = (s.settings.swordSlashSpeed ?? 0.22) * 0.5;
          const pct = Math.min(1.0, mainAi.weaponTimer / windup);

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
            mainAi.weaponState = 'swing_down';
            mainAi.weaponTimer = 0;
            // Damage lands at mid-swing (0.5 * swordSlashSpeed), matching the player's slash.
            applyEnemySwordSlashImpact();
          }
        }
        else if (mainAi.weaponState === 'swing_down') {
          mainAi.weaponTimer += dt;
          const strike = (s.settings.swordSlashSpeed ?? 0.22) * 0.5;
          const pct = Math.min(1.0, mainAi.weaponTimer / strike);

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
            mainAi.weaponState = 'recovering';
            mainAi.weaponTimer = 0;
            // Damage already applied at mid-swing (end of swing_up); swing_down is follow-through.
          }
        }
        else if (mainAi.weaponState === 'recovering') {
          mainAi.weaponTimer += dt;
          const recover = s.settings.swordSlashReload ?? 0.6;
          const pct = Math.min(1.0, mainAi.weaponTimer / recover);

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
            mainAi.weaponState = 'ready';
            mainAi.weaponTimer = 0;
          }
        }
      }
    }
  };

  // COMBAT IMPACT: Spawns particle blast, plays heavy explosion audio, and inflicts damage in custom sphere check
  const applyHammerStrikeImpact = (isPlayerStriking: boolean) =>
    applyHammerStrikeImpactForState({
      state: stateRef.current,
      isPlayerStriking,
      mainAI: mai(),
      getEnemyAITarget,
      isMultiplayer,
      areCombatantsHostile,
      sendSync: sendPlayerWeaponSync,
      applyOutgoingMultiplayerHitLocally,
      renderHammerSplashVfx,
      spawnVoxelShockwaveParticles,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      playExplosion: () => sfx.playExplosion(),
      playSwing: () => sfx.playSwing(),
      playDeath: () => sfx.playDeath(),
      playJump: () => sfx.playJump(),
      pushStatsUpdate,
    });

  const applyEnemySwordSlashImpact = () => {
    return applyMainAISwordSlashImpactForState({
      state: stateRef.current,
      mainAI: mai(),
      target: getEnemyAITarget(),
      isMultiplayer,
      areCombatantsHostile,
      executeTrade,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      playSwing: () => sfx.playSwing(),
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      pushStatsUpdate,
    });
  };

  const applyPlayerHammerMeleeImpact = () =>
    applyPlayerHammerMeleeImpactForState({
      state: stateRef.current,
      mainAI: mai(),
      isMultiplayer,
      areCombatantsHostile,
      sendSync: sendPlayerWeaponSync,
      playSwing: () => sfx.playSwing(),
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
      evaluatePlayerKillMedals,
      recordBotCalibrationDeath,
    });

  const applyEnemyHammerMeleeImpact = () => {
    return applyMainAIHammerMeleeImpactForState({
      state: stateRef.current,
      mainAI: mai(),
      target: getEnemyAITarget(),
      isMultiplayer,
      areCombatantsHostile,
      recordPlayerDamageTaken,
      tryRecordCalibrationCounterSuccess,
      playSwing: () => sfx.playSwing(),
      playDeath: () => sfx.playDeath(),
      spawnVoxelShockwaveParticles,
      recordBotPsychKill,
      recordBotDamageTag,
      tryEnterPressureState,
      tryStartComboOnHit,
      pushStatsUpdate,
    });
  };

  // TACTICAL COMBAT COOLDOWN ENGINE
  const isTargetOnCooldown = (target: Pick<TacticalTargetCandidate, 'id'>) => {
    return isTacticalTargetOnCooldown(stateRef.current, mai(), target);
  };

  // ADVANCED TACTICAL TARGET SELECTION SCORING
  const buildPotentialTargets = (botId: string): TacticalTargetCandidate[] => {
    return buildPotentialTacticalTargets(stateRef.current, botId, getRosterAI());
  };

  const getTacticalTargetById = (botId: string, targetId: string): TacticalTargetCandidate | null => {
    return getTacticalTargetByIdFromState(stateRef.current, botId, targetId, getRosterAI());
  };

  const getBestTacticalTarget = (botId: string, botPos: THREE.Vector3, difficulty: string) => {
    return getBestTacticalTargetFromState({
      state: stateRef.current,
      botId,
      botPos,
      difficulty,
      mainAI: mai(),
      rosterAI: getRosterAI(),
      resolveBotKnobs,
      resolveBotDerived,
    });
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
    const tuning = resolveBehaviorTuning(s.settings);
    const baseAggression = resolveBotDerived(botId).pressureAggression;
    const matchMultipliers = getPressureMatchMultipliers(s.settings, getMatchScoreContext(), baseAggression);

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
        mechanicAwareIq: tuning.mechanicAwareIq,
        highIqOverride: tuning.highIqOverride,
        hammerWindupSeconds: tuning.hammerWindupSeconds,
      });
    }

    const mainAi = mai();
    const botState = botId === 'main_ai' ? null : s.otherPlayers.get(botId);
    const currentWeapon = botId === 'main_ai' ? (mainAi?.activeWeapon || 'hammer') : botState?.activeWeapon;
    const botHP = botId === 'main_ai' ? (mainAi?.hp || 1) : botState?.hp || 1;
    const botMaxHP = botId === 'main_ai' ? (mainAi?.maxHp || 1) : botState?.maxHp || 1;
    const botPos = botId === 'main_ai' ? (mainAi?.pos || new THREE.Vector3()) : (botState ? new THREE.Vector3(botState.pos.x, botState.pos.y, botState.pos.z) : new THREE.Vector3());

    const dist = context.distanceToTarget ?? botPos.distanceTo(target.pos);

    let nearbyEnemiesCount = 0;
    if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && botId !== 'player') {
      if (botPos.distanceTo(s.playerPos) < 6.0) nearbyEnemiesCount++;
    }
    if (botId !== 'main_ai' && mainAi && mainAi.hp > 0 && mainAi.aiState !== 'RESPAWNING') {
      if (botPos.distanceTo(mainAi.pos) < 6.0) nearbyEnemiesCount++;
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
      mechanicAwareIq: tuning.mechanicAwareIq,
      highIqOverride: tuning.highIqOverride,
      hammerWindupSeconds: tuning.hammerWindupSeconds,
    });
  };

  const canStartAIHammerJump = (self: any, pos: THREE.Vector3, vel: THREE.Vector3): boolean => {
    return canStartAIHammerJumpForCombatant(self, stateRef.current.settings);
  };

  const startAIHammerJump = (
    self: any,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    horizontalHeading?: THREE.Vector3,
    jumpType: 'offensive' | 'defensive' = 'offensive'
  ): boolean => {
    return startAIHammerJumpForCombatant({
      self,
      settings: stateRef.current.settings,
      vel,
      horizontalHeading,
      jumpType,
      onMainAIHammerSwing: triggerEnemyHammerSwing,
      playSwing: () => sfx.playSwing(),
      playJump: () => sfx.playJump(),
    });
  };

  // Start an attack for any combatant through the shared `self` accessor. Overhand
  // sword slashes and hammer swings use 'swing_up'; the hammer side-swipe melee uses
  // 'melee_up'. Records the matching attack timestamp and plays the swing sfx. Replaces
  // the per-combatant fork (main called triggerEnemySwordSlash/HammerSwing/HammerMelee;
  // bots set weaponState directly). Note: the main AI's old triggers also bailed during
  // weapon-swap cooldown / dash â€” those guards are dropped here since the call sites
  // already gate on weaponState === 'ready' and dash state.
  const triggerCombatantAttack = (self: any, weapon: 'hammer' | 'sword', melee = false) => {
    triggerCombatantAttackAction({
      self,
      weapon,
      melee,
      recordHammerAttack: (combatantId) => {
        // Adaptive learning: a hammer swing lowers this combatant's learned lunge-frequency
        // signal (mirrors observePlayerHammerAttack for the human).
        recordCombatantObservation(combatantId, (model) => observePlayerHammerAttack(model));
      },
      playSwing: () => sfx.playSwing(),
    });
  };

  // Initiate a sword lunge for any AI combatant (main AI or bot) through one path.
  // Callers have already biased + normalized lungeDir and rejected zero-length dirs.
  // The main-AI's lungeStartPos/lungeTargetDir bridge setters .copy() into the live
  // Vector3s; bots get plain {x,y,z}. Convergence vs the old main-only
  // triggerEnemySwordLunge: bots now set isJumping + record lastSwordAttackTime, and
  // the main AI no longer short-circuits on swap-cooldown/dash-remaining here (the
  // network-replay path at the lunge_sword handler still uses triggerEnemySwordLunge).
  const triggerCombatantLunge = (self: any, lungeDir: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3) => {
    triggerCombatantLungeAction({
      self,
      settings: stateRef.current.settings,
      lungeDir,
      pos,
      vel,
      playDash: () => sfx.playDash(),
    });
  };

  // Swap any AI combatant's active weapon + toggle its display meshes through one path.
  // `setLockout` arms BOTH post-swap timers, exactly mirroring the player's swap
  // (see swapPlayerWeapon): weaponSwapLockout gates the *next* swap, and weaponReadyTime
  // gates *attacking* after the swap (enforced via swapCooldownTimer in the AI tick's
  // canStartWeaponAction gate). The feint revert and spawn telegraph pass setLockout=false
  // so they don't pay the ready cost. This keeps the AI from swapping and attacking faster
  // than the player's configured mechanics allow.
  const swapCombatantWeapon = (self: any, type: 'hammer' | 'sword', setLockout = false) => {
    swapCombatantWeaponAction({
      self,
      settings: stateRef.current.settings,
      type,
      setLockout,
      weaponMeshes: getCombatantWeaponMeshes(threeRef.current, self.id),
      recordWeaponSwap: (combatantId, weaponType) => {
        // Adaptive learning: record this combatant's weapon preference (mirrors
        // observePlayerWeaponSwap for the human).
        recordCombatantObservation(combatantId, (model) => observePlayerWeaponSwap(model, weaponType));
      },
    });
  };

  // Respawn any AI combatant (main AI or bot) through one routine. Common state is
  // reset via the Combatant interface; the main AI's bespoke flat-only fields
  // (planned hammer jump, swap cooldown, jump flag, pressure target) are reset in a
  // small id-guarded block. Spawn point avoids the player and every other live
  // combatant. `mesh` is the combatant's render group in otherPlayerMeshes.
  const respawnCombatant = (c: Combatant, mesh: THREE.Object3D) => {
    const s = stateRef.current;
    respawnAICombatant({
      combatant: c,
      mesh,
      settings: s.settings,
      aiMatchContext: s.aiMatchContext,
      playerPos: s.playerPos,
      rosterAI: getRosterAI(),
      getOptimalSpawnPoint: (exclude) => {
        if (s.settings.gameMode === 'grifball') {
          const gmap = getActiveCustomMap();
          const fallback = resolveActiveSpawnPoints(gmap, SPAWN_POINTS);
          return getGrifballTeamSpawn(gmap, c.team || 'red', fallback, exclude);
        }
        return getOptimalSpawnPoint(exclude);
      },
      playRespawn: () => sfx.playRespawn(),
    });
  };

  const updateSingleAIEntity = (botId: string, dt: number) => {
    const s = stateRef.current;
    const tuning = resolveBehaviorTuning(s.settings);

    const self: any = s.otherPlayers.get(botId);
    if (!self || self.controller !== 'ai') return;

    const botMesh = getCombatantMesh(threeRef.current, botId);
    if (!botMesh) return;

    const hp = self.hp;
    if (hp <= 0) return;
    tickCombatantInvulnerability(self, dt);
    initializeCombatantAITickDefaults(self);

    const alliesList: { x: number; z: number }[] = [];
    const enemiesList: { x: number; z: number }[] = [];

    if (s.settings.gameMode === 'grifball') {
      if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
        if (s.localPlayerTeam === self.team) {
          alliesList.push({ x: s.playerPos.x, z: s.playerPos.z });
        } else {
          enemiesList.push({ x: s.playerPos.x, z: s.playerPos.z });
        }
      }
      s.otherPlayers.forEach((other, otherId) => {
        if (otherId === botId) return;
        if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
          if (other.team === self.team) {
            alliesList.push({ x: other.pos.x, z: other.pos.z });
          } else {
            enemiesList.push({ x: other.pos.x, z: other.pos.z });
          }
        }
      });
    }

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

    // The swap-ready cooldown (weaponReadyTime) gates attacking after a weapon swap,
    // exactly as it does for the player. `let` so a same-tick tactical swap can revoke it.
    let canStartWeaponAction =
      (state !== 'COOLDOWN' || timer <= 0) && (self.swapCooldownTimer ?? 0) <= 0;

    // Write the frame's working state back to the combatant through `self`. For the
    // main AI `self.pos`/`self.vel` already alias mai()!.pos/mai()!.vel (so copy is a no-op
    // self-copy); for a bot they copy the working vectors into the stored object. The
    // aiDashDir setter copies into the main AI's Vector3 but assigns a fresh object on
    // a bot â€” matching each backing store's representation.
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

      // Adaptive learning: record this combatant's lunge outcome â€” distance actually
      // travelled + hit/miss (mirrors observePlayerLungeEnd for the human).
      const lungeStart = self.lungeStartPos ?? pos;
      const lungeTraveled = Math.hypot(pos.x - lungeStart.x, pos.z - lungeStart.z);
      const lungeHit = outcome === 'hit';
      recordCombatantObservation(botId, (model) => observePlayerLungeEnd(model, lungeTraveled, lungeHit));

      let enteredPressure = false;
      if (outcome === 'hit' && targetId) {
        recordBotDamageTag(botId, targetId);
        recordCombatantObservation(botId, (model) => observePlayerDamageDealt(model));
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
    const matchMultipliers = getPressureMatchMultipliers(
      s.settings,
      getMatchScoreContext(),
      derivedParams.pressureAggression
    );
    const effectivePressureAggression = getEffectivePressureAggression(
      s.settings,
      getMatchScoreContext(),
      derivedParams.pressureAggression
    );
    const playstyleFactor = effectivePressureAggression / 100;

    const calibrationEnabled = isSkillCalibrationEnabled(difficulty);
    const calibrationMultipliers = calibrationEnabled
      ? computeCalibrationMultipliers(getOrCreateBotCalibrationState(s.aiMatchContext, botId), tuning.maxCalibrationDrift)
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
    const psychState = tickBotPsychState(s.aiMatchContext, botId, dt, tuning.tempoCycleDuration);
    const effectiveReactionLatency = getEffectiveReactionLatency(tunedReactionLatency, psychState, psychEnabled, tuning.tempoSlowMult, tuning.tempoFastMult);
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

    // ---- GRIFBALL OBJECTIVE MOVEMENT ----
    // Runner sprints to the enemy goal; everyone rushes a loose ball to contest it.
    // When the ball is held by someone else, fall through to normal team combat.
    if (s.settings.gameMode === 'grifball') {
      const ball = s.grifball.ball;
      const heldByMe = ball.state === 'held' && ball.holderId === botId;
      const heldByAnyone = ball.state === 'held' && !!ball.holderId;

      const alliesList: { x: number; z: number }[] = [];
      const enemiesList: { x: number; z: number }[] = [];

      if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
        if (s.localPlayerTeam === self.team) {
          alliesList.push({ x: s.playerPos.x, z: s.playerPos.z });
        } else {
          enemiesList.push({ x: s.playerPos.x, z: s.playerPos.z });
        }
      }

      s.otherPlayers.forEach((other, otherId) => {
        if (otherId === botId) return;
        if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
          if (other.team === self.team) {
            alliesList.push({ x: other.pos.x, z: other.pos.z });
          } else {
            enemiesList.push({ x: other.pos.x, z: other.pos.z });
          }
        }
      });

      if (heldByMe) {
        const goalPos = grifballEnemyGoalPos(self.team);
        if (goalPos) {
          // Self defense punch: if any enemy is within punch range, punch them!
          let closestEnemy: any = null;
          let closestDist = Infinity;

          if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && s.localPlayerTeam !== self.team) {
            const dist = pos.distanceTo(s.playerPos);
            if (dist < closestDist) {
              closestEnemy = { id: 'player', pos: s.playerPos, hp: s.playerHP };
              closestDist = dist;
            }
          }
          s.otherPlayers.forEach((other, otherId) => {
            if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
              const dist = pos.distanceTo(other.pos);
              if (dist < closestDist) {
                closestEnemy = { id: otherId, pos: other.pos, hp: other.hp };
                closestDist = dist;
              }
            }
          });

          if (closestEnemy && closestDist <= 2.2 && canStartWeaponAction && weaponState === 'ready') {
            const toEnemy = closestEnemy.pos.clone().sub(pos);
            yaw = Math.atan2(toEnemy.x, toEnemy.z);
            state = 'COOLDOWN';
            timer = weaponReloadTime('hammer') * cooldownMult;
            triggerCombatantAttack(self, 'hammer');
            weaponState = 'swing_up';
            syncStateAndMesh();
            return;
          }

          // Runner steering around blockers
          const steer = getGrifballRunnerSteering(
            { x: pos.x, z: pos.z },
            { x: goalPos.x, z: goalPos.z },
            enemiesList,
            8.0
          );

          yaw = Math.atan2(steer.x, steer.z);
          const speed = 5.8 * 1.3 * (s.settings.speedForward / 100);
          vel.set(steer.x * speed, 0, steer.z * speed);
          pos.x += vel.x * dt;
          pos.z += vel.z * dt;
          pos.y = 0;

          state = 'APPROACHING';
          timer = 0;
          dashRemaining = 0;
          slideActive = false;
          self.isLunging = false;

          constrainCombatantToArena(pos, vel);
          syncStateAndMesh();
          return;
        }
      } else if (!heldByAnyone) {
        // Loose / idle ball: rush it, but apply spacing repulsion so team doesn't bundle
        const spacing = getGrifballSpacingOffset({ x: pos.x, z: pos.z }, alliesList, s.settings.grifballEscortSpacing ?? 4.0);
        const ballPos = ball.pos;
        const toBall = new THREE.Vector3(ballPos.x - pos.x, 0, ballPos.z - pos.z);
        const d = toBall.length();

        let steerX = toBall.x;
        let steerZ = toBall.z;
        if (d > 0.01) {
          steerX = steerX / d + spacing.x;
          steerZ = steerZ / d + spacing.z;
        }

        const steerLen = Math.hypot(steerX, steerZ) || 1;
        const steerDirX = steerX / steerLen;
        const steerDirZ = steerZ / steerLen;

        yaw = Math.atan2(steerDirX, steerDirZ);
        const sp = 5.2 * (s.settings.speedForward / 100);
        vel.set(steerDirX * sp, 0, steerDirZ * sp);
        pos.x += vel.x * dt;
        pos.z += vel.z * dt;

        pos.y = 0;
        state = 'APPROACHING';
        timer = 0;
        dashRemaining = 0;
        slideActive = false;
        self.isLunging = false;
        constrainCombatantToArena(pos, vel);
        syncStateAndMesh();
        return;
      }
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
        // (multiplier 1) â€” see cooldownMult below.
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

      // GRIFBALL: no enemy in combat range, but the ball is in play — advance toward
      // the objective instead of orbiting spawn (Chaser hunts the carrier; Escort
      // pushes toward the enemy goal to support the runner).
      if (s.settings.gameMode === 'grifball') {
        const ball = s.grifball.ball;
        if (ball.state === 'held' && ball.holderId && ball.holderId !== botId) {
          // Check if there is an enemy close to us. If so, don't escort seek, let's fight!
          let closestEnemyDist = Infinity;
          if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode && s.localPlayerTeam !== self.team) {
            closestEnemyDist = pos.distanceTo(s.playerPos);
          }
          s.otherPlayers.forEach((other) => {
            if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && other.team !== self.team) {
              const dist = pos.distanceTo(other.pos);
              if (dist < closestEnemyDist) {
                closestEnemyDist = dist;
              }
            }
          });

          if (closestEnemyDist > 6.0) {
            const carrierTeam = grifballTeamOf(ball.holderId);
            const carrierRef = grifballCombatantRef(ball.holderId);

            if (carrierTeam && carrierTeam !== self.team && carrierRef) {
              // I am a Chaser! Chase the enemy carrier, applying spacing offset.
              const spacing = getGrifballSpacingOffset({ x: pos.x, z: pos.z }, alliesList, s.settings.grifballEscortSpacing ?? 4.0);
              const toCarrier = new THREE.Vector3(carrierRef.pos.x - pos.x, 0, carrierRef.pos.z - pos.z);
              const d = toCarrier.length();
              let steerX = toCarrier.x;
              let steerZ = toCarrier.z;
              if (d > 0.01) {
                steerX = steerX / d + spacing.x;
                steerZ = steerZ / d + spacing.z;
              }
              const steerLen = Math.hypot(steerX, steerZ) || 1;
              const steerDirX = steerX / steerLen;
              const steerDirZ = steerZ / steerLen;

              yaw = Math.atan2(steerDirX, steerDirZ);
              const sp = 4.8 * (s.settings.speedForward / 100);
              vel.set(steerDirX * sp, 0, steerDirZ * sp);
              pos.x += vel.x * dt;
              pos.z += vel.z * dt;
            } else if (carrierRef) {
              // I am an Escort! Teammate has the ball.
              // Find my escort index among living teammates (excluding the runner)
              let escortIndex = 0;
              const escortIds = Array.from(s.otherPlayers.values())
                .filter((other: any) => other.id !== botId && other.team === self.team && other.hp > 0 && (other.respawnTimer ?? 0) <= 0 && ball.holderId !== other.id)
                .map((other: any) => other.id);
              if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && s.localPlayerTeam === self.team && ball.holderId !== 'player') {
                escortIds.push('player');
              }
              escortIds.sort();
              const myIdx = escortIds.indexOf(botId);
              if (myIdx >= 0) escortIndex = myIdx; // 0, 1, 2...

              const goalPos = grifballEnemyGoalPos(self.team);
              if (goalPos) {
                const escortTarget = getGrifballEscortTarget(
                  { x: carrierRef.pos.x, y: carrierRef.pos.y, z: carrierRef.pos.z },
                  { x: goalPos.x, y: 0, z: goalPos.z },
                  escortIndex
                );

                const spacing = getGrifballSpacingOffset({ x: pos.x, z: pos.z }, alliesList, s.settings.grifballEscortSpacing ?? 4.0);
                const toTarget = new THREE.Vector3(escortTarget.x - pos.x, 0, escortTarget.z - pos.z);
                const d = toTarget.length();
                let steerX = toTarget.x;
                let steerZ = toTarget.z;
                if (d > 0.01) {
                  steerX = steerX / d + spacing.x;
                  steerZ = steerZ / d + spacing.z;
                }
                const steerLen = Math.hypot(steerX, steerZ) || 1;
                const steerDirX = steerX / steerLen;
                const steerDirZ = steerZ / steerLen;

                yaw = Math.atan2(steerDirX, steerDirZ);
                const sp = 4.8 * (s.settings.speedForward / 100);
                vel.set(steerDirX * sp, 0, steerDirZ * sp);
                pos.x += vel.x * dt;
                pos.z += vel.z * dt;
              }
            }
            pos.y = 0;
            state = 'APPROACHING';
            timer = 0;
            constrainCombatantToArena(pos, vel);
            syncStateAndMesh();
            return;
          }
        }
      }

      const livingPositions: THREE.Vector3[] = [];
      if (s.playerHP > 0 && s.playerRespawnTimer <= 0 && !s.isObserverMode) {
        livingPositions.push(s.playerPos);
      }
      const mainAi = mai();
      if (mainAi && mainAi.hp > 0 && botId !== 'main_ai' && mainAi.aiState !== 'RESPAWNING') {
        livingPositions.push(mainAi.pos);
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
        edgeInset: tuning.arenaEdgeInset,
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
    // but the bottom combat state machine has no SPAWN_GUARDING branch â€” so a stale value
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

    const anticipationBonus = tunedAnticipationFactor * tuning.predictionAnticipationBonus;
    const predictionLead = tunedAnticipationFactor > 0.1 ? effectiveReactionLatency + anticipationBonus : 0;
    const predictedTargetPos = predictCombatantPosition(target.pos, target.vel, predictionLead);
    const targetAirborne = predictedTargetPos.y > 0.35 || target.pos.y > 0.35 || (!!target.vel && Math.abs(target.vel.y) > 1.0);
    const targetLandingPos = predictLandingPosition(target.pos, target.vel, Math.min(1.5, predictionLead + tunedAnticipationFactor * tuning.predictionLandingWeight));
    
    const activeCustomMap = getActiveCustomMap();
    const radiusToUse = activeCustomMap ? activeCustomMap.arenaRadius : s.arenaRadius;
    const rectHalf = getRectHalfExtents(radiusToUse, activeCustomMap?.arenaHalfExtents);
    if (activeCustomMap?.mapShape === 'rectangular') {
      const boundX = rectHalf.x - 0.6;
      const boundZ = rectHalf.z - 0.6;
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
      const boundX = rectHalf.x - 0.6;
      const boundZ = rectHalf.z - 0.6;
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
    const targetIsProtected = target.invulnerabilityTimer > 0;
    const targetIsLunging = target.isLunging;

    if (calibrationEnabled) {
      tickCalibrationPendingDodge(s.aiMatchContext, botId, dt, targetIsLunging, tuning.dodgeResolveDelay, tuning.calibrationWindowSize);
      tickCalibrationPendingCounter(s.aiMatchContext, botId, dt, targetIsLunging, tuning.counterResolveDelay, tuning.calibrationWindowSize);
    }

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
    // at zero self-risk â€” a combatant never takes damage from its own sphere (true even
    // for a hammer whose blast overlaps itself). When an enemy is in this range the bot
    // must NOT hold spacing, dance, or hammer-jump: leaping points the sphere straight
    // down and whiffs (the group "jump / spin / miss" loop) when a simple ground swing
    // would connect. A small margin is shaved off so the target can't drift out of the
    // sphere during the swing wind-up. selfGrounded gates the commit so a bot only takes
    // the free swing while planted, not mid-leap.
    // Weapon-aware reach for a *stationary* swing â€” the distance at which the swing's
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
    // actually lands so it never commits an out-of-range bluff slash â€” when it is too far
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
        isInStandoffBand(distanceToTarget, resolvedDangerZone, tuning.standoffRangeMinOffset, tuning.standoffRangeMaxOffset),
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

    // Adaptive learning: sample this acting combatant's OWN position (edge proximity) and
    // approach speed into its own model, so opponents that target it can read those
    // tendencies. Both samplers self-throttle (position rate-limits to ~0.25s).
    {
      const nowSeconds = performance.now() / 1000;
      recordCombatantObservation(botId, (model) => {
        observePlayerPosition(model, pos.x, pos.z, s.arenaRadius, nowSeconds, getActiveCustomMap()?.mapShape);
        if (distanceToTarget < 15) {
          const speed = Math.hypot(vel.x, vel.z);
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
          const mainAi = mai();
          if (
            mainAi &&
            (mainAi.aiState === 'LUNGING' ||
              mainAi.weaponState === 'swing_up' ||
              mainAi.weaponState === 'swing_down')
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
      }, tuning.attackStaggerStep) ||
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
      startFeintCooldown(aiContext, botId, rollFeintCooldownDuration(undefined, tuning.feintCooldownMin, tuning.feintCooldownMax));
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
        // Adaptive learning: record this combatant's lunge initiation distance + frequency.
        recordCombatantObservation(botId, (model) => observePlayerLungeStart(model, lungeDistanceToTarget));
        commitComboAttackAdvance();
        return 'lunge';
      }

      if (attackDistanceToTarget <= stationarySwingReach) {
        state = 'COOLDOWN';
        // The hammer side-swipe only reaches MELEE_HAMMER_SWIPE_REACH (player parity), so
        // only pick it in that band â€” beyond it the wide overhead gravity hammer is used.
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
    const evasionTimingScale = getEvasionTimingScale(evasionPlayerModel, tuning.defaultReactionTime);
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
      // Adaptive learning: record this combatant's dodge-direction bias (mirrors
      // observePlayerDash for the human).
      recordCombatantObservation(botId, (model) => observePlayerDash(model, dashDir.x, dashDir.z));
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
        baitDistance: tuning.baitDodgeDistance,
        baitBand: tuning.baitDodgeBand,
      }) &&
      dashCooldownTimer <= 0
    ) {
      const mainAi = mai();
      const baitLunge = resolveTargetLungeDirection({
        targetId: target.id,
        toTargetX: toTarget.x,
        toTargetZ: toTarget.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        playerIsLunging: target.id === 'player' && s.isLunging,
        playerLungeDirX: s.lungeTargetDir.x,
        playerLungeDirZ: s.lungeTargetDir.z,
        mainAiIsLunging: target.id === 'main_ai' && mainAi?.aiState === 'LUNGING',
        mainAiLungeDirX: mainAi?.lungeTargetDir.x || 0,
        mainAiLungeDirZ: mainAi?.lungeTargetDir.z || 0,
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
        baseRange: tuning.baseEvasionDetectRange,
        jitterAmount: tuning.evasionTriggerJitter,
      }) &&
      difficulty !== 'easy'
    ) {
      const lookHeading = toTarget.clone().normalize();
      const sidewayHeading = new THREE.Vector3(-lookHeading.z, 0, lookHeading.x);
      let startedBulltrueCounter = false;
      const mainAi = mai();
      const incomingLunge = resolveTargetLungeDirection({
        targetId: target.id,
        toTargetX: toTarget.x,
        toTargetZ: toTarget.z,
        targetVelX: target.vel?.x,
        targetVelZ: target.vel?.z,
        playerIsLunging: target.id === 'player' && s.isLunging,
        playerLungeDirX: s.lungeTargetDir.x,
        playerLungeDirZ: s.lungeTargetDir.z,
        mainAiIsLunging: target.id === 'main_ai' && mainAi?.aiState === 'LUNGING',
        mainAiLungeDirX: mainAi?.lungeTargetDir.x || 0,
        mainAiLungeDirZ: mainAi?.lungeTargetDir.z || 0,
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
          hammerWindup: tuning.hammerWindupSeconds,
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

      if ((fallingIntoHammer || canReachBody) && Math.random() < tuning.hammerJumpReachBase + tunedAnticipationFactor * tuning.hammerJumpReachAnticipation) {
        state = 'COOLDOWN';
        timer = weaponReloadTime('hammer') * cooldownMult;
        triggerCombatantAttack(self, 'hammer');
      } else if (!enemyInKillRange && verticalDeltaToTarget > 2.0 && distanceToTarget <= resolvedDangerZone + 4.5 && Math.random() < tuning.hammerJumpVerticalBase + tunedAnticipationFactor * tuning.hammerJumpVerticalAnticipation) {
        if (startAIHammerJump(self, pos, vel, toTarget, 'offensive')) {
          weaponState = 'swing_up';
        }
      }
    }

    timer -= dt;
    swayTimer += dt;

    const savedVelY = vel.y;

    // Sword-lunge flight. Shared by the main AI and additional bots through the
    // `self` accessor â€” previously the main AI ran a separate copy of this in
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
      // bots 'shockwave' â€” converged to the main AI's team-colored cube trail).
      renderSwordLungeTrailVfx(trailPos, '#ef4444', targetDir, 'enemyCube');

      const dist = getCombatBodyCenter(pos, self.isCrouching).distanceTo(getCombatBodyCenter(target.pos, target.isCrouching));
      if (target.hp <= 0 || !areCombatantsHostile(botId, target.id)) {
        finishSwordLunge(cooldownMult, 'target_dead', target.id);
      } else if (dist <= 1.5) {
        const swordThreshold = s.settings.swordTradeWindow ?? 350;
        const hammerThreshold = s.settings.hammerSwordTradeWindow ?? 350;

        // Detect an active attack from the target we'd trade into â€” sword OR hammer.
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
          const mainAi = mai();
          if (mainAi) {
            if (s.settings.enableSwordTrade && mainAi.activeWeapon === 'sword' && (
              mainAi.aiState === 'LUNGING' || mainAi.weaponState === 'swing_up' || mainAi.weaponState === 'swing_down' || (Date.now() - mainAi.lastSwordAttackTime <= swordThreshold)
            )) {
              tradeReason = 'sword_vs_sword';
            } else if (s.settings.enableHammerSwordTrade && mainAi.activeWeapon === 'hammer' && (
              mainAi.weaponState === 'swing_up' || mainAi.weaponState === 'swing_down' || (Date.now() - mainAi.lastHammerAttackTime <= hammerThreshold)
            )) {
              tradeReason = 'sword_lunge_vs_hammer';
            }
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
            if (self.id === MAIN_AI_ID) {
              s.scoreEnemy += 1;
              s.enemyKills += 1;
            }
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
          const mainAi = mai();
          if (mainAi) {
            mainAi.hp -= 1;
            finishSwordLunge(cooldownMult, 'hit', target.id);
            sfx.playExplosion();
            spawnVoxelShockwaveParticles(mainAi.pos, '#ef4444');

            if (mainAi.hp <= 0) {
              mainAi.hp = 0;
              mainAi.aiState = 'RESPAWNING';
              s.enemyRespawnTimer = 3.0;
              self.score = (self.score || 0) + 1;
              self.kills = (self.kills || 0) + 1;
              if (self.id === MAIN_AI_ID) {
                s.scoreEnemy += 1;
                s.enemyKills += 1;
              }
              s.enemyDeaths += 1;
              recordBotCalibrationDeath('main_ai');
              sfx.playDeath();

              recordDeathEvent(self.playerName, 'Red (AI)', undefined, 'sword');
              recordBotPsychKill(botId, 'main_ai', true);
            }
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
              if (self.id === MAIN_AI_ID) {
                s.scoreEnemy += 1;
                s.enemyKills += 1;
              }
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
        const half = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
        const boundX = half.x - 0.65;
        const boundZ = half.z - 0.65;
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
      self.aiHammerJumpsInAir = 0;

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
      // Air-sway (unified, unreachable past the floor-pin above â€” see the matching note
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
        edgeInset: tuning.arenaEdgeInset,
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
        engageGap: tuning.sprintEngageGap,
        chaseTargetSpeed: tuning.sprintChaseTargetSpeed,
      });
      const sprintMult = isSprinting ? getSprintSpeedMultiplier(s.settings.speedSprint) : 1;

      // Sword Lunge Opportunity
      const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;
      const hasVerticalLungeLine = !targetAirborne || movementComplexity >= 60;


      // Guaranteed-kill commit (see enemyInKillRange above). Take the free level swing
      // instead of feinting/lunging/dancing. Running before that whole cautious chain is
      // what breaks the symmetric AI-vs-AI standoff â€” when the enemy is inside our own
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
        startWeaponSwapFeint(aiContext, botId, tuning.weaponSwapFeintDelay);
        commitFeint();
      }

      let feintLungeFakeout = false;
      if (canStartWeaponAction && activeWeapon === 'sword' && weaponState === 'ready' && hasVerticalLungeLine && lungeDistanceToTarget >= minLungeRange && lungeDistanceToTarget <= maxLungeRange && target.hp > 0 && !targetIsProtected) {
        let lungeChance = (targetAirborne ? tuning.lungeChanceAirborneBase + (tunedAnticipationFactor * tuning.lungeChanceAirborneAnticipation) : tuning.lungeChanceGroundBase + (tunedAnticipationFactor * tuning.lungeChanceGroundAnticipation)) * aggressiveLungeMult;
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
            timer = tuning.lungeFakeoutForwardTimer;
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
          // Adaptive learning: record this combatant's lunge initiation distance + frequency.
          recordCombatantObservation(botId, (model) => observePlayerLungeStart(model, lungeDistanceToTarget));
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
          minComplexity: tuning.slideMinComplexity,
          minGap: tuning.slideMinGap,
          maxGap: tuning.slideMaxGap,
          triggerChance: tuning.slideTriggerChance,
        })) {
          slideActive = true;
          slideDistanceTraveled = 0;
          isSprinting = false;
          sfx.playDash();
        }

        if (slideActive) {
          const slideSpeed = getSlideSpeed(s.settings.speedSlide, tuning.aiBaseGroundSpeed);
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
          const reactChance = tuning.reactChanceBase + (tunedAnticipationFactor * tuning.reactChanceAnticipation);
          
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
          timer = tuning.approachFeintBackTimer;
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
          timer = tuning.chargeAbortSidestepTimer;
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
            // Pressure re-swings reload at the configured rate â€” pressure aggression
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

      {/* Dynamic Instruction Overlay when Pointer Lock is not active.
          Suppressed on mobile/touch â€” those players look via touch swipe, so
          pointer lock is never acquired and the overlay would never clear. */}
      {showPointerLockAlert && isPlaying && !isPaused && !(deviceInfo.isMobile || forceMobileControls) && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none pointer-events-none transition-all duration-300">
          <div className="bg-slate-950/80 backdrop-blur-md border border-white/10 px-8 py-5 rounded-2xl text-center max-w-sm shadow-2xl">
            <h4 className="text-xl font-display font-black tracking-widest text-blue-400 uppercase mb-2">
              CLICK TO LOCK CURSOR
            </h4>
            <p className="text-sm font-sans text-white/70 leading-relaxed mb-4">
              Ensure you lock your pointer to look around in first-person like standard Grifball!
            </p>
            <div className="inline-flex items-center justify-center gap-2.5 text-[10px] font-mono text-white/60 uppercase border border-white/10 px-4 py-1.5 rounded-xl bg-white/5 shadow-inner">
              <span className="bg-slate-900 border border-white/20 px-1.5 py-0.5 rounded text-white font-black">LMB</span>
              <span>to Attack</span>
              <span className="text-white/25">•</span>
              <span className="bg-slate-900 border border-white/20 px-1.5 py-0.5 rounded text-white font-black">Mouse</span>
              <span>Look</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
