/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { DEFAULT_KEYBINDINGS, Combatant, CustomMapData } from '../types';
import { type AILungeOutcome } from '../game/aiCombatDecision';
import { GRIFBALL_TOTAL_AI } from '../game/grifballTeams';
import { tickFeintCooldown, getFeintCooldownRemaining, startFeintCooldown, isWeaponSwapFeintActive, startWeaponSwapFeint, tickWeaponSwapFeintTimer, getBotComboState, setBotComboState, clearBotComboState } from '../game/aiMatchContext';
import {
  getPincerApproachOffset,
  registerBotEngagement,
} from '../game/aiBotCoordinator';
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
import {
  DEFAULT_AI_TEAM,
  installLegacyTeamScoreBridges,
  localPlayerTeamFromRole,
} from '../game/teamScoring';
import { MAIN_AI_ID } from '../game/roster';
import {
  canAttemptChargeAbortFeint,
  getApproachFeintWindow,
  getPlayerFeintMultiplier,
  rollFeintAttempt,
  rollFeintCooldownDuration,
} from '../game/aiFeints';
import {
  accumulateStandoffTimer,
  isInStandoffBand,
  shouldForceStandoffCommit,
} from '../game/aiPsychologicalPressure';
import {
  applyCalibrationMultipliers,
  recordCalibrationDodgeFailed,
  tickCalibrationPendingCounter,
  tickCalibrationPendingDodge,
} from '../game/aiSkillCalibration';
import {
  createPlayerModelObservationCallbacksForState,
  getApproachLateralOffset,
  LOCAL_PLAYER_ID,
  observePlayerDash,
  observePlayerReaction,
  recordAIEngagementApproachObservations,
  resetAndWarmStartLocalPlayerModelForState,
} from './grifball/playerModelObservations';
import {
  advanceAISlide,
  getSlideSpeed,
  shouldStartAISlide,
} from '../game/aiMovementMechanics';
import {
  createDefaultSpawnPoints,
} from './grifball/arenaSpawns';
import { advanceGrifballFrameForState } from './grifball/activeFrameRuntime';
import { createGameFrameCallbacksForState } from './grifball/gameFrameCallbacks';
import { createArenaCollisionCallbacksForState } from './grifball/arenaCollisionCallbacks';
import { createArenaOrchestratorCallbacksForState } from './grifball/arenaOrchestratorCallbacks';
import { initializeGrifballSceneForRefs } from './grifball/arenaSceneInitializationRuntime';
import { resolveAIAirborneHammerOpportunityForCombatant } from './grifball/aiAirborneHammerOpportunityRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from './grifball/aiAirborneRecoveryRuntime';
import { resolveAIComboMeleeStrikeForCombatant } from './grifball/aiComboStrikeRuntime';
import {
  syncAICombatantFrameToState,
  syncAICombatantPoseAndState,
} from './grifball/aiCombatantFrameSync';
import { resolveAICombatTuningPreludeForCombatant } from './grifball/aiCombatTuningPreludeRuntime';
import { resolveAIGroundAttackOpportunityForCombatant } from './grifball/aiGroundAttackOpportunityRuntime';
import { resolveAILungeEvasionForCombatant } from './grifball/aiLungeEvasionRuntime';
import { resolveNoTargetAIFrameForCombatant } from './grifball/aiNoTargetRuntime';
import {
  resolvePostKillPressureForCombatant,
  type AIPostKillPressureFrame,
} from './grifball/aiPostKillPressureRuntime';
import {
  resolveAIPressureStateForCombatant,
} from './grifball/aiPressureStateRuntime';
import { createAIRosterCallbacksForState } from './grifball/aiRosterCallbacks';
import {
  initializeCombatantAITickDefaults,
  tickCombatantInvulnerability,
} from './grifball/aiTickState';
import {
  canStartAIWeaponAction,
  resolveScaledAIWeaponReloadTime,
} from './grifball/aiWeaponTimingRuntime';
import { createCombatantActionCallbacksForState } from './grifball/combatantActionCallbacks';
import { createAICombatBookkeepingCallbacksForState } from './grifball/aiCombatBookkeepingCallbacks';
import { getCombatantMesh } from './grifball/combatantMeshLookup';
import { useGrifballDomPoolRefs, useGrifballInputRefs, usePausedPointerLockRef } from './grifball/inputRefs';
import {
  AI_HAMMER_JUMP_START_MAX_HEIGHT,
  AI_HAMMER_JUMP_VERTICAL_VELOCITY_EPSILON,
  GRAVITY_ACCELERATION,
  MELEE_EYE_HEIGHT,
  type TacticalTargetCandidate,
} from './grifball/combatGeometry';
import { type GrifballGameProps } from './grifball/GrifballGameProps';
import { resolveAICombatRangeFrame } from './grifball/aiCombatRangeRuntime';
import { shouldBlockCoordinatedAttackForFrame } from './grifball/aiCoordinationRuntime';
import { resolveAIDashMovementForCombatant } from './grifball/aiDashMovementRuntime';
import { resolveAIGroundMovementPreludeForCombatant } from './grifball/aiGroundMovementPreludeRuntime';
import {
  handleChatInputKeyboardFocus,
  isTextInputElementActive,
} from './grifball/chatInputRuntime';
import {
  integrateTargetEngagementGravityForCombatant,
  normalizeTargetEngagementFrameState,
  resolveCombatantCrouchPose,
  tickAIEngagementCooldowns,
  type AIEngagementFrame,
} from './grifball/aiEngagementFrameRuntime';
import { tryStartAISwordLungeForCombatant } from './grifball/aiSwordLungeStartRuntime';
import { finishAISwordLungeFrameForCombatant } from './grifball/aiSwordLungeFinishRuntime';
import { resolveAISwordLungeFlightForCombatant } from './grifball/aiSwordLungeFlightRuntime';
import { resolveAITargetPredictionFrame } from './grifball/aiTargetPredictionRuntime';
import { createCombatImpactCallbacksForState } from './grifball/combatImpactCallbacks';
import {
  type CombatTradeReason,
} from './grifball/tradeRuntime';
import { createCombatResolutionCallbacksForState } from './grifball/combatResolutionCallbacks';
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
import { buildGrifballTeamAwarenessForCombatant } from './grifball/grifballAITeamAwareness';
import {
  resolvePrimaryGrifballAIObjectiveMovementForCombatant,
  type GrifballAIObjectiveFrame,
} from './grifball/grifballAIObjectiveMovement';
import {
  type LiveCameraFrameState,
} from './grifball/liveCamera';
import { resolveActiveCustomMap } from './grifball/mapSelection';
import { createMatchFrameCallbacksForState } from './grifball/matchFrameCallbacks';
import {
  syncMultiplayerPropsForState,
  syncMultiplayerRuntimeModeForState,
} from './grifball/multiplayerStateRuntime';
import { createMultiplayerSyncMessageHandler } from './grifball/multiplayerSyncRuntime';
import {
  createInitialFpsCounter,
  useGrifballReplayRuntimeRefs,
  useLatestRef,
  useOfflineRosterPropRefs,
} from './grifball/runtimeRefs';
import { createReplayRuntimeCallbacksForState } from './grifball/replayRuntimeCallbacks';
import { createTacticalTargetCallbacksForState } from './grifball/tacticalTargetCallbacks';
import { createInitialGrifballRuntimeState, type GrifballRuntimeState } from './grifball/runtimeState';
import { createInitialGrifballThreeRefs, type GrifballThreeRefs } from './grifball/threeRefs';
import { createViewTargetCallbacksForState } from './grifball/viewTargetCallbacks';
import { buildCustomMapBaseArenaForRefs } from './grifball/customMapArenaRuntime';
import { buildCustomMapRainyStreetsSceneryForRefs } from './grifball/customMapRainyStreetsSceneryRuntime';
import { buildCustomMapStadiumSceneryForRefs } from './grifball/customMapStadiumSceneryRuntime';
import { buildCustomMapSynthwaveSceneryForRefs } from './grifball/customMapSynthwaveSceneryRuntime';
import { buildCustomMapWinterSceneryForRefs } from './grifball/customMapWinterSceneryRuntime';
import { buildDefaultArenaSceneForRefs } from './grifball/defaultArenaSceneRuntime';
import { buildLocalPlayerViewForRefs } from './grifball/localPlayerViewRuntime';
import { registerGrifballInputEventListeners } from './grifball/inputEventListenersRuntime';
import { buildMultiplayerEnemyViewForRefs } from './grifball/multiplayerEnemyViewRuntime';
import {
  cycleObserverCameraModeForState,
  cycleObserverTargetForState,
  handleObserverKeyboardInputForState,
} from './grifball/observerInputRuntime';
import { seedInitialOfflineRosterForState } from './grifball/offlineRosterInitializationRuntime';
import {
  cyclePlayerWheelWeaponForState,
  createPlayerLookInputHandlersForState,
  handlePlayerKeyboardActionForState,
  handlePlayerKeyboardReleaseForState,
  handlePointerPlayerActionInputForState,
  handlePointerPlayerActionReleaseForState,
  triggerMobileAltPlayerActionForState,
  triggerMobilePrimaryPlayerActionForState,
} from './grifball/playerInputRuntime';
import { createPlayerFrameCallbacksForState } from './grifball/playerFrameCallbacks';
import {
  syncAdminSettingsVisualStateForState,
  type WeatherParticleFrameState,
} from './grifball/visualState';
import { createVisualUpdateCallbacksForState } from './grifball/visualUpdateCallbacks';
import { createWeaponActionCallbacksForState } from './grifball/weaponActionCallbacks';
import { createVfxCallbacksForState } from './grifball/vfxCallbacks';

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

  const {
    mai,
    getRosterAI,
    rosterCombatant,
    opponentDisplay,
    getLegacyRosterProps,
    resolveRosterSlot,
    resolveBotArchetype,
    resolveBotKnobs,
    resolveBotDerived,
    resolveBotFlags,
    getMatchScoreContext,
  } = createAIRosterCallbacksForState({
    getState: () => stateRef.current,
    opponentClientId,
    opponentPlayerName,
    botDifficultiesRef,
    botBehaviorsRef,
    botWeaponBehaviorsRef,
    botArchetypesRef,
    botColorsRef,
    aiPresets,
    matchKillsToWin,
  });

  const {
    recordLocalPlayerObservation,
    recordCombatantObservation,
    recordPlayerLungeEndObservation,
    recordPlayerDamageTaken,
    recordPlayerDamageDealt,
    getTargetPlayerModel,
  } = createPlayerModelObservationCallbacksForState({
    getState: () => stateRef.current,
  });

  const {
    constrainCombatantToArena,
    resolvePlayerCollisions,
    enforceArenaBounds,
    recoverCombatantAltitude,
  } = createArenaCollisionCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getActiveCustomMap,
    getMainAI: mai,
    isMultiplayer,
    multiplayerRole,
    opponentClientId,
  });

  const {
    getEnemyAITarget,
    isTargetOnCooldown,
    getTacticalTargetById,
    getBestTacticalTarget,
    evaluateTacticalWeaponChoice,
  } = createTacticalTargetCallbacksForState({
    getState: () => stateRef.current,
    getMainAI: mai,
    getRosterAI,
    resolveRosterSlot,
    resolveBotKnobs,
    resolveBotDerived,
    getMatchScoreContext,
  });

  const {
    updateAI,
    updateCharacterSkeletalAnimations,
  } = createGameFrameCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getRosterAI,
    getMainAI: mai,
    getReplayActive: () => Boolean(replayData),
    getKeysPressed: () => keysPressed.current,
    getKeybindings: () => keybindingsRef.current,
    isMultiplayer,
    multiplayerRole,
    respawnCombatant: (combatant, mesh) => respawnCombatant(combatant, mesh),
    updateSingleAIEntity: (combatantId, dt) => updateSingleAIEntity(combatantId, dt),
    getSpectateTargetData: (target) => getSpectateTargetData(target),
    renderSwordLungeTrailVfx: (pos, color, dir, style) =>
      renderSwordLungeTrailVfx(pos, color, dir, style),
    applyBotMeleeImpact: (botId) => applyBotMeleeImpact(botId),
  });

  const {
    spawnBurnDecal,
    resetTransientVfx,
    disposeTransientVfx,
    spawnVoxelShockwaveParticles,
    renderHammerSplashVfx,
    renderSwordLungeTrailVfx,
  } = createVfxCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
  });

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

  const {
    updateMatchTimers,
    renderGame,
    pushStatsUpdate,
  } = createMatchFrameCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getMainAI: mai,
    getOpponent: opponentDisplay,
    getKeysPressed: () => keysPressed.current,
    getKeybindings: () => keybindingsRef.current,
    liveCameraFrameRef,
    weatherParticleFrameRef,
    opponentClientId,
    getReplayActive: () => Boolean(replayData),
    getSpectateTargetData: (target) => getSpectateTargetData(target),
    getActiveCustomMap,
    getOnStatsUpdate: () => onStatsUpdateRef.current,
    isMultiplayer,
    multiplayerRole,
    getMultiplayerSocket: () => multiplayerSocket,
    getFps: () => fpsRef.current.value,
    getOpponentPlayerName: () => opponentNameRef.current || mai()?.playerName || undefined,
  });













  // Keep debug mode ref in sync
  useEffect(() => {
    stateRef.current.debugMode = debugMode;
  }, [debugMode]);

  // Handle multiplayer game synchronization logic
  useEffect(() => {
    const s = stateRef.current;
    syncMultiplayerRuntimeModeForState({
      state: s,
      refs: threeRef.current,
      isMultiplayer,
      multiplayerRole,
      replayActive: !!replayData,
    });

    if (isMultiplayer && multiplayerSocket) {
      const handleWsMessage = createMultiplayerSyncMessageHandler({
        stateRef,
        refs: threeRef.current,
        multiplayerRole,
        secretAudioRef,
        createOrUpdateRemotePlayer,
        resizeArena,
        pushStatsUpdate,
        rebuildHostModel,
        rebuildEnemyModel,
        spawnVoxelShockwaveParticles,
        renderHammerSplashVfx,
        triggerEnemyHammerSwing,
        triggerEnemyHammerMelee,
        triggerEnemySwordSlash,
        triggerEnemySwordLunge,
        recordPlayerDamageTaken,
        playSwing: () => sfx.playSwing(),
        playDash: () => sfx.playDash(),
        playDeath: () => sfx.playDeath(),
        onPauseToggle,
      });

      multiplayerSocket.addEventListener('message', handleWsMessage);
      return () => {
        multiplayerSocket.removeEventListener('message', handleWsMessage);
      };
    }
  }, [isMultiplayer, multiplayerRole, multiplayerSocket]);

  // Keep isMultiplayer and multiplayerRole in sync with props
  useEffect(() => {
    syncMultiplayerPropsForState({
      state: stateRef.current,
      isMultiplayer,
      multiplayerRole,
    });
  }, [isMultiplayer, multiplayerRole]);

  // Keep admin settings in sync with runtime and visual state.
  useEffect(() => {
    syncAdminSettingsVisualStateForState({
      state: stateRef.current,
      refs: threeRef.current,
      adminSettings,
      mainAI: mai(),
      customMap,
      replayData,
      selectedMap,
    });
  }, [adminSettings, customMap, replayData, selectedMap]);

  useEffect(() => {
    return resetAndWarmStartLocalPlayerModelForState({
      state: stateRef.current,
      replayActive: !!replayData,
    });
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

  const {
    updateFloatingNameplate,
    updateRadarDOM,
    animateSpartanModel,
    updateBlinking,
  } = createVisualUpdateCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getMainAI: mai,
    getContainer: () => containerRef.current,
    getNameplateContainer: () => nameplateContainerRef.current,
    radarDotPoolRef,
    nameplatePoolRef,
    isMultiplayer,
    opponentPlayerName,
    getFallbackOpponentName: () => opponentNameRef.current,
  });

  const {
    getSpectateTargetData,
    cycleReplayTarget,
    rebuildEnemyModel,
    rebuildHostModel,
  } = createViewTargetCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getMainAI: mai,
    replayPlayerIdsRef,
    replayTargetIdRef,
    lastOpponentHue,
    getOpponentName: () => opponentNameRef.current,
    opponentClientId,
    isMultiplayer,
    multiplayerRole,
    playerLoadout,
    pushStatsUpdate,
  });

  // Define 8 circular spawn points inside the 20m arena (base radius 13m)
  const SPAWN_POINTS = useRef<THREE.Vector3[]>(createDefaultSpawnPoints()).current;

  const {
    getOptimalSpawnPoint,
    placeCombatantsAtGrifballSpawns,
    resizeArena,
    createOrUpdateRemotePlayer,
    buildOrchestratorSpawnCallbacks,
    buildOrchestratorEvents,
    runAIOrchestrator,
  } = createArenaOrchestratorCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    spawnPoints: SPAWN_POINTS,
    getActiveCustomMap,
    getLegacyRosterProps,
    getOfflineBotCount: () => offlineBotCountRef.current,
    isPlaying,
    opponentClientId,
    constrainCombatantToArena,
    pushStatsUpdate,
    playRespawn: () => sfx.playRespawn(),
  });

  const {
    getBotPressureAggression,
    tryEnterPressureState,
    clearPressureTarget,
    tryStartComboOnHit,
    recordBotPsychKill,
    recordBotCalibrationDeath,
    tryRecordCalibrationCounterSuccess,
    recordBotDamageTag,
  } = createAICombatBookkeepingCallbacksForState({
    getState: () => stateRef.current,
    isMultiplayer,
    getRosterAI,
    rosterCombatant,
    resolveBotKnobs,
    resolveBotDerived,
    resolveBotFlags,
    getMatchScoreContext,
    getTacticalTargetById,
    getOptimalSpawnPoint,
  });

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const activeCustomMap = getActiveCustomMap();
    const {
      scene,
      camera,
      renderer,
      isHangar,
    } = initializeGrifballSceneForRefs({
      refs: threeRef.current,
      container: containerRef.current,
      canvas: canvasRef.current,
      activeCustomMap,
      selectedMap,
      replayMapType: replayData?.mapType,
      adminSettings,
      resetTransientVfx,
    });

    if (activeCustomMap) {
      buildCustomMapBaseArenaForRefs({
        refs: threeRef.current,
        activeCustomMap,
      });

      buildCustomMapSynthwaveSceneryForRefs({
        refs: threeRef.current,
        activeCustomMap,
      });

      buildCustomMapRainyStreetsSceneryForRefs({
        refs: threeRef.current,
        activeCustomMap,
      });

      buildCustomMapWinterSceneryForRefs({
        refs: threeRef.current,
        activeCustomMap,
      });

      buildCustomMapStadiumSceneryForRefs({
        refs: threeRef.current,
        activeCustomMap,
      });

      // Clear any pre-existing navigation mesh, force A* engine to rebuild on the fly
      threeRef.current.navMesh = undefined;

    } else {
      buildDefaultArenaSceneForRefs({
        refs: threeRef.current,
        isHangar,
        adminSettings,
      });
    }

    // 4. PROGRAMMATIC VOXEL CHARACTER ENEMY
    if (!replayData) {
      if (isMultiplayer) {
        buildMultiplayerEnemyViewForRefs({
          refs: threeRef.current,
          scene,
          mainAIHue: botColors['main_ai'],
        });
      } else {
        // Offline: unified roster â€” main_ai + bot_* via orchestrator seed
        seedInitialOfflineRosterForState({
          state: stateRef.current,
          legacy: getLegacyRosterProps(),
          offlineBotCount: offlineBotCountRef.current,
          spawnCallbacks: buildOrchestratorSpawnCallbacks(),
          events: buildOrchestratorEvents({ silentSpawn: true }),
          placeCombatantsAtGrifballSpawns,
        });
      }
    }

    buildLocalPlayerViewForRefs({
      refs: threeRef.current,
      scene,
      camera,
      adminSettings,
      playerLoadout,
    });

    // Setup input listeners
    const handleKeyDown = (e: KeyboardEvent) => {
      if (handleChatInputKeyboardFocus(e)) return;

      // Block any further action if they are focused in the input element typing
      if (isTextInputElementActive()) {
        return;
      }

      const key = e.key.toLowerCase();
      keysPressed.current[key] = true;

      const s = stateRef.current;
      if (handleObserverKeyboardInputForState({
        state: s,
        key,
        rawKey: e.key,
        keybindings: keybindingsRef.current,
        replayActive: !!replayData,
        replayPlayerIdsRef,
        replayTargetIdRef,
        cycleReplayTarget,
        pushStatsUpdate,
        onPauseToggle,
      })) return;

      handlePlayerKeyboardActionForState({
        state: stateRef.current,
        key,
        rawKey: e.key,
        repeat: e.repeat,
        keybindings: keybindingsRef.current,
        keysPressed: keysPressed.current,
        isPaused: isPausedRef.current,
        isPlaying,
        callbacks: {
          onPauseToggle,
          swapPlayerWeapon,
          recordDashObservation: (dashDir) => {
            recordLocalPlayerObservation((model) => {
              observePlayerDash(model, dashDir.x, dashDir.z);
              const mainAi = mai();
              if (!isMultiplayer && mainAi && mainAi.hp > 0 && mainAi.weaponState === 'swing_up') {
                observePlayerReaction(model, mainAi.weaponTimer ?? 0);
              }
            });
          },
          spawnVoxelShockwaveParticles,
          pushStatsUpdate,
          playCrouch: () => sfx.playCrouch(),
          playJump: () => sfx.playJump(),
          playDash: () => sfx.playDash(),
        },
      });
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (isTextInputElementActive()) {
        return;
      }
      const key = e.key.toLowerCase();
      keysPressed.current[key] = false;

      handlePlayerKeyboardReleaseForState({
        state: stateRef.current,
        key,
        keybindings: keybindingsRef.current,
        pushStatsUpdate,
      });
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

      handlePointerPlayerActionInputForState({
        state: s,
        button: e.button,
        keybindings: keybindingsRef.current,
        ballChargingRef,
        ballChargeTimerRef,
        callbacks: {
          triggerPlayerHammerSwing,
          triggerPlayerHammerMelee,
          triggerPlayerPistolFire,
          triggerPlayerSwordSlash,
          triggerPlayerSwordLunge,
        },
      });
    };

    // Release a charged Pass when the alt-attack button comes up.
    const handleCanvasMouseUp = (e: MouseEvent) => {
      if (!isPlaying || isPausedRef.current) return;
      handlePointerPlayerActionReleaseForState({
        button: e.button,
        keybindings: keybindingsRef.current,
        ballChargingRef,
        throwPlayerPass,
      });
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

      cyclePlayerWheelWeaponForState({
        state: s,
        swapPlayerWeapon,
      });
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const {
      handlePointerLockChange,
      handleMouseMove,
      handleMouseDownFallback,
      handleMouseUpFallback,
      handleTouchStart,
      handleTouchMove,
      handleTouchEnd,
    } = createPlayerLookInputHandlersForState({
      canvas: renderer.domElement,
      getState: () => stateRef.current,
      getKeybindings: () => keybindingsRef.current,
      isPlaying: () => isPlaying,
      isPaused: () => isPausedRef.current,
      isPointerLocked,
      isMouseDown,
      lastMousePos,
      setShowPointerLockAlert,
    });

    // Mobile attack handlers triggered by custom overlay events
    const handleMobileAttackPrimary = () => {
      if (!isPlaying || isPausedRef.current) return;
      triggerMobilePrimaryPlayerActionForState({
        state: stateRef.current,
        callbacks: {
          triggerPlayerHammerSwing,
          triggerPlayerPistolFire,
          triggerPlayerSwordLunge,
        },
      });
    };

    const handleMobileAttackAlt = () => {
      if (!isPlaying || isPausedRef.current) return;
      triggerMobileAltPlayerActionForState({
        state: stateRef.current,
        callbacks: {
          triggerPlayerSwordSlash,
          triggerPlayerHammerMelee,
        },
      });
    };

    const handleResize = () => {
      if (!containerRef.current || !renderer || !camera) return;
      const w = containerRef.current.clientWidth || window.innerWidth;
      const h = containerRef.current.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const handleCycleObserverMode = () => {
      cycleObserverCameraModeForState({
        state: stateRef.current,
        pushStatsUpdate,
      });
    };

    const handleCycleObserverTarget = (e?: Event) => {
      cycleObserverTargetForState({
        state: stateRef.current,
        replayActive: !!replayData,
        event: e,
        cycleReplayTarget,
        pushStatsUpdate,
      });
    };

    const unregisterInputEventListeners = registerGrifballInputEventListeners({
      canvas: renderer.domElement,
      handlers: {
        handleKeyDown,
        handleKeyUp,
        handleCanvasMouseDown,
        handleCanvasMouseUp,
        handleWheel,
        handleContextMenu,
        handlePointerLockChange,
        handleMouseMove,
        handleMouseDownFallback,
        handleMouseUpFallback,
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        handleMobileAttackPrimary,
        handleMobileAttackAlt,
        handleResize,
        handleCycleObserverMode,
        handleCycleObserverTarget,
      },
    });

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
      unregisterInputEventListeners();

      disposeTransientVfx();

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      if (renderer) {
        renderer.dispose();
      }
    };
  }, [isPlaying, replayData, selectedMap, customMap]);

  const {
    initializeReplayRecording,
    registerReplayPlaybackEvents,
    recordReplayFrame,
    saveCompiledReplay,
    persistLocalPlayerFingerprint,
    emitMatchTelemetry,
    runReplayPlaybackLoop,
  } = createReplayRuntimeCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    replayData,
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
    keysPressed,
    getKeybindings: () => keybindingsRef.current,
    botColors,
    adminSettings,
    selectedMap,
    aiMatchSessionKey,
    opponentPlayerName,
    matchKillsToWin,
    isMultiplayer,
    getActiveCustomMap,
    animateSpartanModel,
    renderSwordLungeTrailVfx,
    updateBlinking,
    renderGame,
    spawnVoxelShockwaveParticles,
    renderHammerSplashVfx,
    onStatsUpdate,
    playDeath: () => sfx.playDeath(),
    playSwing: () => sfx.playSwing(),
    playRespawn: () => sfx.playRespawn(),
    playDash: () => sfx.playDash(),
    playExplosion: () => sfx.playExplosion(),
  });

  // Handle active game cycles
  useEffect(() => {
    if (!isPlaying || isPaused) return;

    initializeReplayRecording();

    const unregisterReplayPlaybackEvents = registerReplayPlaybackEvents();

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
      advanceGrifballFrameForState({
        state: s,
        refs: threeRef.current,
        dt,
        isPlaying,
        isPausedRef,
        replayData,
        keysPressed,
        grifbHoldTimerRef,
        secretAudioRef,
        isMultiplayer,
        multiplayerRole,
        multiplayerSocket,
        replayRecordingRef,
        replayRecordingElapsedTimeRef,
        lastRecordTimeRef,
        spawnVoxelShockwaveParticles,
        rebuildHostModel,
        updatePhysics,
        updateHammerAnimations,
        runAIOrchestrator,
        updateAI,
        updateGrifball,
        updateCharacterSkeletalAnimations,
        updateMatchTimers,
        enforceArenaBounds,
        renderGame,
        updateFloatingNameplate,
        pushStatsUpdate,
        updateRadarDOM,
        runReplayPlaybackLoop,
        recordReplayFrame,
        playRespawn: () => sfx.playRespawn(),
      });

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      unregisterReplayPlaybackEvents();
      // Replay is compiled and auto-saved only when the game is fully closed / unmounted.
    };
  }, [isPlaying, isPaused, isMultiplayer, multiplayerRole, multiplayerSocket, replayData]);

  // Save compiled replay on unmount of GrifballGame
  useEffect(() => {
    return () => {
      saveCompiledReplay();
      persistLocalPlayerFingerprint();
      emitMatchTelemetry();
    };
  }, []);

  const {
    recordDeathEvent,
    applyOutgoingMultiplayerHitLocally,
    executeCustomBotTrade,
    evaluatePlayerKillMedals,
    executeTrade,
  } = createCombatResolutionCallbacksForState({
    getState: () => stateRef.current,
    getMainAI: mai,
    multiplayerRole,
    rosterCombatant,
    recordBotCalibrationDeath,
    spawnVoxelShockwaveParticles,
    pushStatsUpdate,
    playDeath: () => sfx.playDeath(),
    playExplosion: () => sfx.playExplosion(),
    playMedal: (medalId) => sfx.playMedal(medalId),
  });

  const {
    getPlayerSwordLockTarget,
    sendPlayerWeaponSync,
    triggerPlayerHammerSwing,
    triggerPlayerHammerMelee,
    triggerPlayerPistolFire,
    swapPlayerWeapon,
    triggerPlayerSwordSlash,
    triggerPlayerSwordLunge,
    triggerEnemyHammerSwing,
    triggerEnemyHammerMelee,
    triggerEnemySwordSlash,
    triggerEnemySwordLunge,
  } = createWeaponActionCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getMainAI: mai,
    getOpponentDisplay: opponentDisplay,
    getEnemyAITarget,
    isMultiplayer,
    multiplayerSocket,
    isPaused,
    isPlaying,
    recordLocalPlayerObservation,
    spawnVoxelShockwaveParticles,
    evaluatePlayerKillMedals,
    recordBotCalibrationDeath,
    pushStatsUpdate,
    playSwing: () => sfx.playSwing(),
    playDash: () => sfx.playDash(),
    playImpact: () => sfx.playSwing(),
    playDeath: () => sfx.playDeath(),
  });

  const {
    applyHammerStrikeImpact,
    applyEnemySwordSlashImpact,
    applyPlayerHammerMeleeImpact,
    applyPlayerSwordSlashImpact,
    applyEnemyHammerMeleeImpact,
  } = createCombatImpactCallbacksForState({
    getState: () => stateRef.current,
    getMainAI: mai,
    getEnemyAITarget,
    isMultiplayer,
    areCombatantsHostile,
    executeTrade,
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

  const {
    applyBotMeleeImpact,
    updatePhysics,
    updateHammerAnimations,
  } = createPlayerFrameCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    getMainAI: mai,
    getIsPaused: () => isPausedRef.current,
    getKeyboardKeybindings: () => keybindings,
    getActionKeybindings: () => keybindingsRef.current,
    getKeysPressed: () => keysPressed.current,
    prevGamepadButtonsRef,
    sprintToggleActiveRef,
    prevSprintInputRef,
    getMobileJoystick: () => mobileJoystickRef.current,
    getMobileRightJoystick: () => mobileRightJoystickRef.current,
    getMobileRightJoystickActive: () => mobileRightJoystickActiveRef.current,
    getActiveCustomMap,
    spawnPoints: SPAWN_POINTS,
    isMultiplayer,
    isPlaying,
    deviceIsMobile: deviceInfo.isMobile,
    forceMobileControls,
    multiplayerSocket,
    areCombatantsHostile,
    constrainCombatantToArena,
    renderHammerSplashVfx,
    renderSwordLungeTrailVfx,
    spawnVoxelShockwaveParticles,
    recordLocalPlayerObservation,
    recordPlayerLungeEnd: recordPlayerLungeEndObservation,
    recordPlayerDamageDealt,
    recordBotPsychKill,
    recordBotCalibrationDeath,
    evaluatePlayerKillMedals,
    executeTrade,
    applyOutgoingMultiplayerHitLocally,
    getPlayerSwordLockTarget,
    triggerPlayerHammerSwing,
    triggerPlayerHammerMelee,
    triggerPlayerSwordSlash,
    triggerPlayerSwordLunge,
    swapPlayerWeapon,
    applyHammerStrikeImpact,
    applyPlayerHammerMeleeImpact,
    applyPlayerSwordSlashImpact,
    applyEnemyHammerMeleeImpact,
    applyEnemySwordSlashImpact,
    playJump: () => sfx.playJump(),
    playDash: () => sfx.playDash(),
    playCrouch: () => sfx.playCrouch(),
    playRespawn: () => sfx.playRespawn(),
    playExplosion: () => sfx.playExplosion(),
    playDeath: () => sfx.playDeath(),
    playSwing: () => sfx.playSwing(),
    pushStatsUpdate,
    onPauseToggle,
  });

  const {
    startAIHammerJump,
    triggerCombatantAttack,
    triggerCombatantLunge,
    swapCombatantWeapon,
    respawnCombatant,
  } = createCombatantActionCallbacksForState({
    getState: () => stateRef.current,
    getRefs: () => threeRef.current,
    spawnPoints: SPAWN_POINTS,
    getRosterAI,
    getActiveCustomMap,
    getOptimalSpawnPoint,
    recordCombatantObservation,
    onMainAIHammerSwing: triggerEnemyHammerSwing,
    playSwing: () => sfx.playSwing(),
    playJump: () => sfx.playJump(),
    playDash: () => sfx.playDash(),
    playRespawn: () => sfx.playRespawn(),
  });

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

    const { alliesList, enemiesList } = s.settings.gameMode === 'grifball'
      ? buildGrifballTeamAwarenessForCombatant(s, botId, self.team)
      : { alliesList: [], enemiesList: [] };

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
    // faster than the user's gameplay dials.
    // Hammer side-swipe (melee) reloads on hammerMeleeReload; the wide
    // overhead/level hammer and sword use hammerReloadTime / swordSlashReload.
    // The swap-ready cooldown (weaponReadyTime) gates attacking after a weapon swap,
    // exactly as it does for the player. `let` so a same-tick tactical swap can revoke it.
    let canStartWeaponAction = canStartAIWeaponAction({
      aiState: state,
      timer,
      swapCooldownTimer: self.swapCooldownTimer,
    });

    // Write the frame's working state back to the combatant through `self`. For the
    // main AI `self.pos`/`self.vel` already alias mai()!.pos/mai()!.vel (so copy is a no-op
    // self-copy); for a bot they copy the working vectors into the stored object. The
    // aiDashDir setter copies into the main AI's Vector3 but assigns a fresh object on
    // a bot â€” matching each backing store's representation.
    const syncStateAndMesh = () => {
      syncAICombatantFrameToState({
        self,
        mesh: botMesh,
        pos,
        vel,
        yaw,
        aiState: state,
        timer,
        swayTimer,
        dashCooldownTimer,
        dashRemaining,
        dashDir,
        slideActive,
        slideDistanceTraveled,
        slideCooldownTimer,
        isSprinting,
        hammerJumpCooldownTimer,
        pendingPostEvasionCharge,
        coordCommitTimer,
      });
    };

    const createGrifballAIObjectiveFrame = (): GrifballAIObjectiveFrame => ({
      pos,
      vel,
      yaw,
      aiState: state,
      timer,
      dashRemaining,
      slideActive,
      weaponState,
    });

    const applyGrifballAIObjectiveFrame = (frame: GrifballAIObjectiveFrame) => {
      yaw = frame.yaw;
      state = frame.aiState;
      timer = frame.timer;
      dashRemaining = frame.dashRemaining;
      slideActive = frame.slideActive;
      weaponState = frame.weaponState;
    };

    const createAIPostKillPressureFrame = (): AIPostKillPressureFrame => ({
      pos,
      vel,
      yaw,
      aiState: state,
      timer,
      swayTimer,
      activeWeapon,
    });

    const applyAIPostKillPressureFrame = (frame: AIPostKillPressureFrame) => {
      yaw = frame.yaw;
      state = frame.aiState;
      timer = frame.timer;
      swayTimer = frame.swayTimer;
      activeWeapon = frame.activeWeapon;
    };

    const createAIEngagementFrame = (): AIEngagementFrame => ({
      pos,
      vel,
      aiState: state,
      timer,
      dashCooldownTimer,
      slideCooldownTimer,
      hammerJumpCooldownTimer,
    });

    const applyAIEngagementFrame = (frame: AIEngagementFrame) => {
      state = frame.aiState;
      timer = frame.timer;
      dashCooldownTimer = frame.dashCooldownTimer;
      slideCooldownTimer = frame.slideCooldownTimer;
      hammerJumpCooldownTimer = frame.hammerJumpCooldownTimer;
    };

    const finishSwordLunge = (cooldownMultiplier = 1, outcome: AILungeOutcome = 'miss_timeout', targetId?: string) => {
      const lungeFinishFrame = finishAISwordLungeFrameForCombatant({
        state: s,
        self,
        pos,
        vel,
        aiState: state,
        timer,
        weaponState,
        botId,
        cooldownMultiplier,
        outcome,
        targetId,
        recordCombatantObservation,
        recordBotDamageTag,
        tryEnterPressureState,
        tryStartComboOnHit,
      });

      state = lungeFinishFrame.aiState;
      timer = lungeFinishFrame.timer;
      weaponState = lungeFinishFrame.weaponState;
    };

    const {
      difficulty,
      movementComplexity,
      weaponSwapIQ,
      weaponPrioritization,
      swordForbidden,
      hammerForbidden,
      derivedParams,
      personalityFlags,
      matchMultipliers,
      effectivePressureAggression,
      playstyleFactor,
      calibrationEnabled,
      calibrationMultipliers,
      tunedAnticipationFactor,
      psychEnabled,
      psychState,
      effectiveReactionLatency,
      postKillPressure,
    } = resolveAICombatTuningPreludeForCombatant({
      state: s,
      self,
      botId,
      dt,
      tuning,
      resolveBotKnobs,
      resolveBotDerived,
      resolveBotFlags,
      getMatchScoreContext,
    });

    if (postKillPressure) {
      const postKillPressureFrame = createAIPostKillPressureFrame();
      const postKillPressureMode = resolvePostKillPressureForCombatant({
        state: s,
        self,
        frame: postKillPressureFrame,
        pressure: postKillPressure,
        spatialIQ: derivedParams.spatialIQ,
        effectivePressureAggression,
        swordForbidden,
        dt,
        gravityAcceleration: GRAVITY_ACCELERATION,
        recoverCombatantAltitude,
        constrainCombatantToArena,
        swapCombatantWeapon,
      });
      applyAIPostKillPressureFrame(postKillPressureFrame);

      if (postKillPressureMode === 'airborne') {
        syncStateAndMesh();
        return;
      }

      syncAICombatantPoseAndState({
        self,
        mesh: botMesh,
        pos,
        vel,
        yaw,
        aiState: state,
        timer,
        activeWeapon,
        swayTimer,
      });
      return;
    }

    const primaryGrifballFrame = createGrifballAIObjectiveFrame();
    if (resolvePrimaryGrifballAIObjectiveMovementForCombatant({
      state: s,
      botId,
      self,
      frame: primaryGrifballFrame,
      alliesList,
      enemiesList,
      dt,
      canStartWeaponAction,
      weaponReloadTime: (weapon, isMelee) => resolveScaledAIWeaponReloadTime(s.settings, weapon, cooldownMult, isMelee),
      triggerCombatantAttack,
      constrainCombatantToArena,
      getEnemyGoalPos: grifballEnemyGoalPos,
    })) {
      applyGrifballAIObjectiveFrame(primaryGrifballFrame);
      syncStateAndMesh();
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
      const noTargetFrame = createGrifballAIObjectiveFrame();
      const noTargetMode = resolveNoTargetAIFrameForCombatant({
        state: s,
        botId,
        self,
        frame: noTargetFrame,
        mainAI: mai(),
        alliesList,
        spatialIQ: derivedParams.spatialIQ,
        edgeInset: tuning.arenaEdgeInset,
        dt,
        activeCustomMap: getActiveCustomMap(),
        gravityAcceleration: GRAVITY_ACCELERATION,
        finishSwordLungeTargetDead: () => {
          // Reload/recovery mirrors the player's configured mechanic settings exactly
          // (multiplier 1) - see cooldownMult below.
          finishSwordLunge(1, 'target_dead', undefined);
        },
        recoverCombatantAltitude,
        constrainCombatantToArena,
        getOptimalSpawnPoint,
        getCombatantTeam: grifballTeamOf,
        getCombatantRef: grifballCombatantRef,
        getEnemyGoalPos: grifballEnemyGoalPos,
      });
      applyGrifballAIObjectiveFrame(noTargetFrame);

      if (noTargetMode === 'airborne' || noTargetMode === 'support_objective') {
        syncStateAndMesh();
        return;
      }

      syncAICombatantPoseAndState({
        self,
        mesh: botMesh,
        pos,
        vel,
        yaw,
        aiState: state,
        timer: 0,
      });
      return;
    }

    registerBotEngagement(s.aiMatchContext.coordinator, botId, target.id);

    // SPAWN_GUARDING is only driven by the post-kill-pressure / no-target early-return
    // paths above. If we reach here we have a live target and those holds have expired,
    // but the bottom combat state machine has no SPAWN_GUARDING branch â€” so a stale value
    // would leave the AI frozen with no movement or transition (notably after a lunge
    // kill in low-HP modes). Reset it back into normal engagement.
    const engagementFrame = createAIEngagementFrame();
    normalizeTargetEngagementFrameState(engagementFrame);
    applyAIEngagementFrame(engagementFrame);

    // Gravity Integration (main AI + bots, unified in-tick model)
    integrateTargetEngagementGravityForCombatant({
      self,
      frame: engagementFrame,
      dt,
      gravityAcceleration: GRAVITY_ACCELERATION,
      recoverCombatantAltitude,
      constrainCombatantToArena,
    });

    const activeCustomMap = getActiveCustomMap();
    const {
      predictedTargetPos,
      targetAirborne,
      movementTargetPos,
      toTarget,
      distanceToTarget,
      yaw: targetYaw,
    } = resolveAITargetPredictionFrame({
      botPos: pos,
      target,
      effectiveReactionLatency,
      tunedAnticipationFactor,
      predictionAnticipationBonus: tuning.predictionAnticipationBonus,
      predictionLandingWeight: tuning.predictionLandingWeight,
      movementComplexity,
      activeCustomMap,
      arenaRadius: s.arenaRadius,
    });

    yaw = targetYaw;
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

    // Sliding forces a crouch posture, like the player's slide.
    const isCrouching = resolveCombatantCrouchPose({
      aiState: state,
      swayTimer,
      slideActive,
      movementComplexity,
    });

    if (isCrouching) {
      botMesh.scale.set(1, 0.65, 1);
    } else {
      botMesh.scale.set(1, 1, 1);
    }
    self.isCrouching = isCrouching;

    // Resolve weapon-aware body distance and stationary swing commit bands.
    const {
      combatDistanceToTarget,
      verticalDeltaToTarget,
      attackDistanceToTarget,
      guaranteedKillRange,
      enemyInKillRange,
      selfGrounded,
      stationarySwingReach,
    } = resolveAICombatRangeFrame({
      botPos: pos,
      botVel: vel,
      botIsCrouching: isCrouching,
      botIsJumping: self.isJumping,
      targetIsCrouching: target.isCrouching,
      targetHp: target.hp,
      targetProtected: targetIsProtected,
      predictedTargetPos,
      distanceToTarget,
      activeWeapon,
      attackRange: s.settings.attackRange,
      attackRadius: s.settings.attackRadius,
      resolvedAiReach,
    });

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

    // Adaptive learning: sample this acting combatant's OWN position (edge proximity) and
    // approach speed into its own model, so opponents that target it can read those
    // tendencies. Both samplers self-throttle (position rate-limits to ~0.25s).
    recordAIEngagementApproachObservations({
      state: s,
      botId,
      botPos: pos,
      botVel: vel,
      targetId: target.id,
      distanceToTarget,
      nowSeconds: performance.now() / 1000,
      mapShape: activeCustomMap?.mapShape,
    });

    const cooldownFrame = createAIEngagementFrame();
    tickAIEngagementCooldowns({
      frame: cooldownFrame,
      self,
      botId,
      mainAIId: MAIN_AI_ID,
      dt,
    });
    applyAIEngagementFrame(cooldownFrame);

    const aiContext = s.aiMatchContext;
    tickFeintCooldown(aiContext, botId, dt);

    const coordRoleInput = {
      coordinator: aiContext.coordinator,
      botId,
      targetId: target.id,
      difficulty,
    };

    const isCoordAttackBlocked = () =>
      shouldBlockCoordinatedAttackForFrame({
        coordinator: aiContext.coordinator,
        botId,
        targetId: target.id,
        difficulty,
        commitTimer: coordCommitTimer,
        attackStaggerStep: tuning.attackStaggerStep,
        targetWeaponState: target.weaponState,
        targetRecovering: target.weaponState === 'recovering',
        mainAI: mai(),
        otherPlayers: s.otherPlayers,
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
        if (!tryStartAISwordLungeForCombatant({
          self,
          target,
          pos,
          vel,
          targetAirborne,
          playerModel: getTargetPlayerModel(target.id),
          botId,
          lungeDistanceToTarget,
          triggerCombatantLunge,
          recordCombatantObservation,
        })) return false;
        commitComboAttackAdvance();
        return 'lunge';
      }

      if (attackDistanceToTarget <= stationarySwingReach) {
        state = 'COOLDOWN';
        // The hammer side-swipe only reaches MELEE_HAMMER_SWIPE_REACH (player parity), so
        // only pick it in that band â€” beyond it the wide overhead gravity hammer is used.
        const meleeStrikeFrame = resolveAIComboMeleeStrikeForCombatant({
          state: s,
          self,
          activeWeapon,
          attackDistanceToTarget,
          cooldownMultiplier: cooldownMult,
          triggerCombatantAttack,
        });
        timer = meleeStrikeFrame.timer;
        weaponState = meleeStrikeFrame.weaponState;
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
    const lungeEvasionFrame = resolveAILungeEvasionForCombatant({
      state: s,
      self,
      frame: {
        pos,
        vel,
        dashDir,
        aiState: state,
        timer,
        dashRemaining,
        dashCooldownTimer,
        pendingPostEvasionCharge,
        weaponState,
      },
      botId,
      target,
      toTarget,
      distanceToTarget,
      combatDistanceToTarget,
      resolvedAiReach,
      targetIsProtected,
      targetIsLunging,
      dt,
      difficulty,
      defensiveEvasionMult,
      spatialIQ,
      swayTimer,
      activeWeapon,
      canStartWeaponAction,
      cooldownMultiplier: cooldownMult,
      calibrationEnabled,
      bulltrueCounter: tacticalDecision.bulltrueCounter,
      getTargetPlayerModel,
      mainAI: mai(),
      triggerCombatantAttack,
      startAIHammerJump,
      spawnVoxelShockwaveParticles,
      recordCombatantObservation,
      playDash: () => sfx.playDash(),
      playJump: () => sfx.playJump(),
      tuning,
    });
    state = lungeEvasionFrame.aiState;
    timer = lungeEvasionFrame.timer;
    dashRemaining = lungeEvasionFrame.dashRemaining;
    dashCooldownTimer = lungeEvasionFrame.dashCooldownTimer;
    pendingPostEvasionCharge = lungeEvasionFrame.pendingPostEvasionCharge;
    weaponState = lungeEvasionFrame.weaponState;
    const isEvadingLunge = lungeEvasionFrame.isEvadingLunge;

    const airborneHammerFrame = resolveAIAirborneHammerOpportunityForCombatant({
      state: s,
      self,
      frame: {
        pos,
        vel,
        aiState: state,
        timer,
        weaponState,
      },
      target,
      toTarget,
      targetAirborne,
      targetProtected: targetIsProtected,
      difficulty,
      movementComplexity,
      canStartWeaponAction,
      activeWeapon,
      distanceToTarget,
      resolvedDangerZone,
      combatDistanceToTarget,
      resolvedAiReach,
      tunedAnticipationFactor,
      enemyInKillRange,
      verticalDeltaToTarget,
      cooldownMultiplier: cooldownMult,
      tuning,
      triggerCombatantAttack,
      startAIHammerJump,
    });
    state = airborneHammerFrame.aiState;
    timer = airborneHammerFrame.timer;
    weaponState = airborneHammerFrame.weaponState;

    timer -= dt;
    swayTimer += dt;

    const savedVelY = vel.y;

    // Sword-lunge flight. Shared by the main AI and additional bots through the
    // `self` accessor â€” previously the main AI ran a separate copy of this in
    // updateAI() while bots ran this block, which let the two drift apart.
    if (self.isLunging) {
      const lungeFlightResult = resolveAISwordLungeFlightForCombatant({
        state: s,
        self,
        target,
        mainAi: target.id === MAIN_AI_ID ? mai() : undefined,
        botId,
        botMesh,
        pos,
        vel,
        dt,
        cooldownMult,
        activeCustomMap: getActiveCustomMap(),
        gravityAcceleration: GRAVITY_ACCELERATION,
        recoverCombatantAltitude,
        constrainCombatantToArena,
        areCombatantsHostile,
        finishSwordLunge,
        executeCustomBotTrade: (
          attackerBot: Combatant,
          tradeTarget: { id: string },
          reason: CombatTradeReason
        ) => executeCustomBotTrade(attackerBot, tradeTarget, reason),
        renderSwordLungeTrailVfx,
        recordPlayerDamageTaken,
        playExplosion: () => sfx.playExplosion(),
        playDeath: () => sfx.playDeath(),
        spawnVoxelShockwaveParticles,
        recordDeathEvent,
        recordBotPsychKill,
        recordBotCalibrationDeath,
        pushStatsUpdate,
      });

      if (lungeFlightResult === 'trade_return') {
        return;
      }
    } else {
      if (resolvePreGroundMovementRecoveryForCombatant({
        self,
        pos,
        vel,
        dt,
        movementComplexity,
        swayTimer,
        toTarget,
        recoverCombatantAltitude,
        constrainCombatantToArena,
      }) === 'sync_return') {
        syncStateAndMesh();
        return;
      }

    if (isEvadingLunge && dashRemaining <= 0) {
      syncStateAndMesh();
      return;
    }

    const isAIDashing = dashRemaining > 0;
    if (isAIDashing) {
      const dashMovementFrame = {
        pos,
        vel,
        dashDir,
        aiState: state,
        dashRemaining,
        slideActive,
        slideCooldownTimer,
        pendingPostEvasionCharge,
        isSprinting,
      };
      resolveAIDashMovementForCombatant({
        state: s,
        refs: threeRef.current,
        frame: dashMovementFrame,
        dt,
        activeWeapon,
        targetWeaponState: target.weaponState,
        attackDistanceToTarget: combatDistanceToTarget,
        resolvedAiReach,
        targetProtected: targetIsProtected,
        spatialIQ,
        weaponReady: weaponState === 'ready',
      });
      state = dashMovementFrame.aiState;
      dashRemaining = dashMovementFrame.dashRemaining;
      slideActive = dashMovementFrame.slideActive;
      slideCooldownTimer = dashMovementFrame.slideCooldownTimer;
      pendingPostEvasionCharge = dashMovementFrame.pendingPostEvasionCharge;
      isSprinting = dashMovementFrame.isSprinting;
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

      const groundMovementPrelude = resolveAIGroundMovementPreludeForCombatant({
        state: s,
        refs: threeRef.current,
        pos,
        movementTargetPos,
        target,
        predictedTargetPos,
        activeCustomMap: getActiveCustomMap(),
        spatialIQ,
        edgeInset: tuning.arenaEdgeInset,
        aiState: state,
        distanceToTarget,
        resolvedDangerZone,
        isCrouching,
        slideActive,
        sprintEngageGap: tuning.sprintEngageGap,
        sprintChaseTargetSpeed: tuning.sprintChaseTargetSpeed,
      });
      const lookHeading = groundMovementPrelude.lookHeading;
      const spatialBias = groundMovementPrelude.spatialBias;
      const spatialLookHeading = groundMovementPrelude.spatialLookHeading;
      const sidewayHeading = groundMovementPrelude.sidewayHeading;
      isSprinting = groundMovementPrelude.isSprinting;
      const sprintMult = groundMovementPrelude.sprintMult;

      // Sword Lunge Opportunity
      const lungeDistanceToTarget = targetAirborne ? combatDistanceToTarget : distanceToTarget;
      const hasVerticalLungeLine = !targetAirborne || movementComplexity >= 60;

      const groundAttackOpportunity = resolveAIGroundAttackOpportunityForCombatant({
        state: s,
        self,
        frame: {
          pos,
          vel,
          aiState: state,
          timer,
          weaponState,
        },
        botId,
        target,
        targetAirborne,
        targetProtected: targetIsProtected,
        activeWeapon,
        canStartWeaponAction,
        enemyInKillRange,
        selfGrounded,
        slideActive,
        cooldownMultiplier: cooldownMult,
        swordForbidden,
        swapLockoutRemaining,
        swapFeintActive: isWeaponSwapFeintActive(aiContext, botId),
        comboActive: !!getBotComboState(aiContext, botId),
        feintChance,
        lungeDistanceToTarget,
        hasVerticalLungeLine,
        minLungeRange,
        maxLungeRange,
        combatDistanceToTarget,
        distanceToTarget,
        resolvedAiReach,
        aggressiveLungeMult,
        tunedAnticipationFactor,
        playstyleFactor,
        tuning,
        constrainCombatantToArena,
        triggerCombatantAttack,
        applyTacticalWeapon: (tacticalWeapon) => {
          applyTacticalWeapon(tacticalWeapon);
          return {
            activeWeapon,
            canStartWeaponAction,
            weaponState,
          };
        },
        startWeaponSwapFeintTimer: () => startWeaponSwapFeint(aiContext, botId, tuning.weaponSwapFeintDelay),
        commitFeint,
        tryFeintRoll,
        getTargetPlayerModel,
        triggerCombatantLunge,
        recordCombatantObservation,
      });
      activeWeapon = groundAttackOpportunity.activeWeapon;
      canStartWeaponAction = groundAttackOpportunity.canStartWeaponAction;
      state = groundAttackOpportunity.aiState;
      timer = groundAttackOpportunity.timer;
      weaponState = groundAttackOpportunity.weaponState;
      const feintLungeFakeout = groundAttackOpportunity.feintLungeFakeout;
      if (groundAttackOpportunity.mode === 'sync_return') {
        syncStateAndMesh();
        return;
      }
      if (groundAttackOpportunity.mode === 'return') {
        return;
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
            timer = resolveScaledAIWeaponReloadTime(s.settings, activeWeapon, cooldownMult);
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
        const pressureFrame = resolveAIPressureStateForCombatant({
          state: s,
          frame: {
            pos,
            vel,
            dashDir,
            aiState: state,
            timer,
            dashRemaining,
            dashCooldownTimer,
            weaponState,
          },
          botId,
          target,
          pressureTargetId,
          attackDistanceToTarget,
          resolvedAiReach,
          maxLungeRange,
          effectivePressureAggression,
          lookHeading,
          sidewayHeading,
          totalApproachLateral,
          dt,
          sprintMult,
          activeWeapon,
          stationarySwingReach,
          minLungeRange,
          targetProtected: targetIsProtected,
          canStartWeaponAction,
          cooldownMultiplier: cooldownMult,
          playstyleFactor,
          clearPressureTarget,
          isCoordAttackBlocked,
          triggerCombatantAttack: (weapon) => triggerCombatantAttack(self, weapon),
          playDash: () => sfx.playDash(),
        });
        state = pressureFrame.aiState;
        timer = pressureFrame.timer;
        dashRemaining = pressureFrame.dashRemaining;
        dashCooldownTimer = pressureFrame.dashCooldownTimer;
        weaponState = pressureFrame.weaponState;
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
