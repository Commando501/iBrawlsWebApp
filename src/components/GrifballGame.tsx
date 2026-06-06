/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { sfx } from './AudioEngine';
import { DEFAULT_KEYBINDINGS, CustomMapData } from '../types';
import { GRIFBALL_TOTAL_AI } from '../game/grifballTeams';
import {
  installLegacyTeamScoreBridges,
  localPlayerTeamFromRole,
} from '../game/teamScoring';
import {
  createPlayerModelObservationCallbacksForState,
  resetAndWarmStartLocalPlayerModelForState,
} from './grifball/playerModelObservations';
import {
  createDefaultSpawnPoints,
} from './grifball/arenaSpawns';
import { advanceGrifballFrameForState } from './grifball/activeFrameRuntime';
import { createGameFrameCallbacksForState } from './grifball/gameFrameCallbacks';
import { createArenaCollisionCallbacksForState } from './grifball/arenaCollisionCallbacks';
import { createArenaOrchestratorCallbacksForState } from './grifball/arenaOrchestratorCallbacks';
import { createAIRosterCallbacksForState } from './grifball/aiRosterCallbacks';
import { createCombatantActionCallbacksForState } from './grifball/combatantActionCallbacks';
import { createAICombatBookkeepingCallbacksForState } from './grifball/aiCombatBookkeepingCallbacks';
import { useGrifballDomPoolRefs, useGrifballInputRefs, usePausedPointerLockRef } from './grifball/inputRefs';
import { type GrifballGameProps } from './grifball/GrifballGameProps';
import { createCombatImpactCallbacksForState } from './grifball/combatImpactCallbacks';
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
import { initializeGrifballMountSceneForState } from './grifball/mountSceneRuntime';
import { createGrifballInputHandlersForState } from './grifball/inputHandlersRuntime';
import { registerGrifballInputEventListeners } from './grifball/inputEventListenersRuntime';
import { createAISingleEntityUpdaterForState } from './grifball/aiSingleEntityRuntime';
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
      camera,
      renderer,
    } = initializeGrifballMountSceneForState({
      state: stateRef.current,
      refs: threeRef.current,
      container: containerRef.current,
      canvas: canvasRef.current,
      activeCustomMap,
      selectedMap,
      replayData,
      adminSettings,
      isMultiplayer,
      mainAIHue: botColors['main_ai'],
      playerLoadout,
      resetTransientVfx,
      getLegacyRosterProps,
      getOfflineBotCount: () => offlineBotCountRef.current,
      buildOrchestratorSpawnCallbacks,
      buildSilentOrchestratorEvents: () => buildOrchestratorEvents({ silentSpawn: true }),
      placeCombatantsAtGrifballSpawns,
    });

    const inputHandlers = createGrifballInputHandlersForState({
      canvas: renderer.domElement,
      camera,
      renderer,
      getContainer: () => containerRef.current,
      stateRef,
      keysPressed,
      keybindingsRef,
      isPausedRef,
      isPlaying,
      isMultiplayer,
      replayData,
      replayPlayerIdsRef,
      replayTargetIdRef,
      isPointerLocked,
      isMouseDown,
      lastMousePos,
      setShowPointerLockAlert,
      getMainAI: mai,
      cycleReplayTarget,
      pushStatsUpdate,
      onPauseToggle,
      swapPlayerWeapon,
      recordLocalPlayerObservation,
      spawnVoxelShockwaveParticles,
      ballChargingRef,
      ballChargeTimerRef,
      triggerPlayerHammerSwing,
      triggerPlayerHammerMelee,
      triggerPlayerPistolFire,
      triggerPlayerSwordSlash,
      triggerPlayerSwordLunge,
      throwPlayerPass,
      playCrouch: () => sfx.playCrouch(),
      playJump: () => sfx.playJump(),
      playDash: () => sfx.playDash(),
    });

    const unregisterInputEventListeners = registerGrifballInputEventListeners({
      canvas: renderer.domElement,
      handlers: inputHandlers,
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
  const updateSingleAIEntity = createAISingleEntityUpdaterForState({
    stateRef,
    threeRef,
    mai,
    resolveBotKnobs,
    resolveBotDerived,
    resolveBotFlags,
    getMatchScoreContext,
    recordCombatantObservation,
    recordBotDamageTag,
    tryEnterPressureState,
    tryStartComboOnHit,
    recoverCombatantAltitude,
    constrainCombatantToArena,
    swapCombatantWeapon,
    triggerCombatantAttack,
    grifballEnemyGoalPos,
    getBestTacticalTarget,
    getTacticalTargetById,
    getActiveCustomMap,
    getOptimalSpawnPoint,
    grifballTeamOf,
    grifballCombatantRef,
    getTargetPlayerModel,
    evaluateTacticalWeaponChoice,
    startAIHammerJump,
    triggerCombatantLunge,
    spawnVoxelShockwaveParticles,
    areCombatantsHostile,
    executeCustomBotTrade,
    renderSwordLungeTrailVfx,
    recordPlayerDamageTaken,
    recordDeathEvent,
    recordBotPsychKill,
    recordBotCalibrationDeath,
    pushStatsUpdate,
    isTargetOnCooldown,
    clearPressureTarget,
    playDash: () => sfx.playDash(),
    playJump: () => sfx.playJump(),
    playExplosion: () => sfx.playExplosion(),
    playDeath: () => sfx.playDeath(),
  });

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
