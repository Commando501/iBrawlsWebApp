import * as THREE from 'three';
import { DEFAULT_KEYBINDINGS } from '../../src/types';
import type { FrozenCase, ValidationJob } from '../../src/game/grifballValidation/types';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { GrifballValidationRuntime } from '../../src/components/grifball/grifballValidationRuntime';
import { createAIRosterCallbacksForState } from '../../src/components/grifball/aiRosterCallbacks';
import { createPlayerModelObservationCallbacksForState } from '../../src/components/grifball/playerModelObservations';
import { createArenaCollisionCallbacksForState } from '../../src/components/grifball/arenaCollisionCallbacks';
import { createArenaOrchestratorCallbacksForState } from '../../src/components/grifball/arenaOrchestratorCallbacks';
import { createTacticalTargetCallbacksForState } from '../../src/components/grifball/tacticalTargetCallbacks';
import { createAICombatBookkeepingCallbacksForState } from '../../src/components/grifball/aiCombatBookkeepingCallbacks';
import { createCombatResolutionCallbacksForState } from '../../src/components/grifball/combatResolutionCallbacks';
import { createWeaponActionCallbacksForState } from '../../src/components/grifball/weaponActionCallbacks';
import { createCombatImpactCallbacksForState } from '../../src/components/grifball/combatImpactCallbacks';
import { createPlayerFrameCallbacksForState } from '../../src/components/grifball/playerFrameCallbacks';
import { createCombatantActionCallbacksForState } from '../../src/components/grifball/combatantActionCallbacks';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { createGameFrameCallbacksForState } from '../../src/components/grifball/gameFrameCallbacks';
import { advanceGrifballFrameForState } from '../../src/components/grifball/activeFrameRuntime';
import { buildCombatantRigForModel } from '../../src/components/grifball/combatantRig';
import { updateGrifballMatchTimers } from '../../src/components/grifball/matchTimers';
import { applyValidationLocalInput } from '../../src/components/grifball/validationLocalInputRuntime';
import { areGrifballCombatantsHostileForState, getGrifballCombatantRefForState, getGrifballTeamOfForState,
  getGrifballEnemyGoalPosForMap, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';


export interface AutonomousJumpObservation {
  id: string; accepted: boolean; dash: number; swap: number;
  jumpType: 'offensive' | 'defensive'; plannedBefore: boolean; phaseBefore: string;
  plannedAfter: boolean;
}
export interface AutonomousTradeActorObservation {
  id: string; hp: number; phase: string; planned: boolean;
  jumpType?: string; vy: number; budget: number;
}
export interface AutonomousTradeObservation {
  attackerId: string; targetId: string; reason: string;
  before: AutonomousTradeActorObservation | null;
  after: AutonomousTradeActorObservation | null;
}
/** Optional validation-only observations. Payloads contain copied scalar values,
 * never mutable actors; callbacks do not select or replace production actions. */
export interface AutonomousDashActorObservation {
  pos: number[]; vel: number[]; hp: number; weapon: string;
  remaining: number; cooldown: number; direction: { x: number; y: number; z: number };
  jumping: boolean; lunging: boolean; role: string | null;
}
export interface AutonomousDashObservation {
  id: string; requested: boolean; target: string | null; incomingThreat: boolean;
  before: AutonomousDashActorObservation; after: AutonomousDashActorObservation;
}
export interface AutonomousActionObservers {
  dashUpdate?: (sample: Readonly<AutonomousDashObservation>) => void;
  hammerJump?: (sample: Readonly<AutonomousJumpObservation>) => void;
  trade?: (sample: Readonly<AutonomousTradeObservation>) => void;
}

export const AUTONOMOUS_RUNTIME_PROTOCOL = 'production-runtime-node-v1';
const noop = () => {};
const ref = <T>(current: T) => ({ current });

/** Production gameplay owners without a renderer, DOM, audio or network.
 * This is an explicit validation host, not a replacement for stepSimulation or
 * an execution/schema change for any existing trained policy. */
export function createAutonomousValidationRuntime(fixture: FrozenCase, job: ValidationJob,
  observeState?: (canonicalState: string) => void, actionObservers?: AutonomousActionObservers) {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: fixture.mechanics,
    isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs();
  refs.camera = new THREE.PerspectiveCamera();
  refs.playerHammer = new THREE.Group(); refs.playerSword = new THREE.Group(); refs.playerPistol = new THREE.Group();
  const keysPressed = ref<Record<string, boolean>>({});
  const ballMeshRef = ref<THREE.Mesh | null>(null), ballChargingRef = ref(false), ballChargeTimerRef = ref(0);
  const common = { getState: () => state, getRefs: () => refs, getActiveCustomMap: () => fixture.map,
    isMultiplayer: false, multiplayerRole: null, multiplayerSocket: null, opponentClientId: '', isPlaying: true,
    spawnPoints: fixture.map.spawnPoints.map(p => new THREE.Vector3(p.x, p.y, p.z)) };
  const effects = { spawnVoxelShockwaveParticles: noop, renderHammerSplashVfx: noop, renderSwordLungeTrailVfx: noop,
    pushStatsUpdate: noop, playSwing: noop, playJump: noop, playDash: noop, playRespawn: noop,
    playDeath: noop, playExplosion: noop, playMedal: noop, playImpact: noop, playCrouch: noop };
  const roster = createAIRosterCallbacksForState({ ...common, opponentPlayerName: '', aiPresets: [],
    botDifficultiesRef: ref({}), botBehaviorsRef: ref({}), botWeaponBehaviorsRef: ref({}),
    botArchetypesRef: ref({}), botModelTypesRef: ref({}), botColorsRef: ref({}) });
  const observations = createPlayerModelObservationCallbacksForState(common);
  const collision = createArenaCollisionCallbacksForState({ ...common, getMainAI: roster.mai });
  const arena = createArenaOrchestratorCallbacksForState({ ...common, ...effects, ...collision,
    getLegacyRosterProps: roster.getLegacyRosterProps, getOfflineBotCount: () => fixture.roster.length,
    getVisualModelPolicy: () => 'v2' });
  const targets = createTacticalTargetCallbacksForState({ ...common, ...roster, getMainAI: roster.mai });
  const bookkeeping = createAICombatBookkeepingCallbacksForState({ ...common, ...roster, ...targets,
    getOptimalSpawnPoint: arena.getOptimalSpawnPoint });
  const resolution = createCombatResolutionCallbacksForState({ ...common, ...effects, ...roster, ...bookkeeping,
    getMainAI: roster.mai });
  if (actionObservers?.trade) {
    const observe = actionObservers.trade, execute = resolution.executeCustomBotTrade;
    const snapshot = (id: string): AutonomousTradeActorObservation | null => {
      const actor = state.otherPlayers.get(id);
      return actor ? { id, hp: actor.hp, phase: actor.weaponState ?? 'ready',
        planned: !!actor.hammerJumpPlanned, jumpType: actor.hammerJumpType,
        vy: actor.vel.y, budget: actor.aiHammerJumpsInAir ?? 0 } : null;
    };
    resolution.executeCustomBotTrade = (attacker, target, reason) => {
      const before = snapshot(target.id), result = execute(attacker, target, reason);
      observe({ attackerId: attacker.id, targetId: target.id,
        reason: reason ?? 'sword_vs_sword', before, after: snapshot(target.id) });
      return result;
    };
  }
  const weapons = createWeaponActionCallbacksForState({ ...common, ...effects, ...observations, ...bookkeeping,
    ...resolution, ...targets, getMainAI: roster.mai, getOpponentDisplay: roster.opponentDisplay,
    getIsPaused: () => false, getIsPlaying: () => true });
  const areCombatantsHostile = (a: string, b: string) => areGrifballCombatantsHostileForState(state, a, b);
  const impacts = createCombatImpactCallbacksForState({ ...common, ...effects, ...observations, ...bookkeeping,
    ...resolution, ...targets, areCombatantsHostile, getMainAI: roster.mai, sendSync: weapons.sendPlayerWeaponSync });
  const player = createPlayerFrameCallbacksForState({ ...common, ...effects, ...observations, ...bookkeeping,
    ...resolution, ...weapons, ...impacts, ...collision, areCombatantsHostile, getMainAI: roster.mai,
    recordPlayerLungeEnd: observations.recordPlayerLungeEndObservation,
    getIsPaused: () => false, getKeyboardKeybindings: () => DEFAULT_KEYBINDINGS,
    getActionKeybindings: () => DEFAULT_KEYBINDINGS, getKeysPressed: () => keysPressed.current,
    prevGamepadButtonsRef: ref([]), sprintToggleActiveRef: ref(false), prevSprintInputRef: ref(false),
    getMobileJoystick: () => ({ x: 0, y: 0 }), getMobileRightJoystick: () => ({ x: 0, y: 0 }),
    getMobileRightJoystickActive: () => false, deviceIsMobile: false, forceMobileControls: false, onPauseToggle: noop });
  const actions = createCombatantActionCallbacksForState({ ...common, ...effects, ...observations, ...roster,
    getOptimalSpawnPoint: arena.getOptimalSpawnPoint, onMainAIHammerSwing: weapons.triggerEnemyHammerSwing });
  if (actionObservers?.hammerJump) {
    const observe = actionObservers.hammerJump, start = actions.startAIHammerJump;
    actions.startAIHammerJump = (actor, pos, vel, heading, jumpType = 'offensive') => {
      const before = { id: actor.id, dash: actor.aiDashRemaining ?? 0,
        swap: actor.swapCooldownTimer ?? 0, plannedBefore: !!actor.hammerJumpPlanned,
        phaseBefore: actor.weaponState ?? 'ready' };
      const accepted = start(actor, pos, vel, heading, jumpType);
      observe({ ...before, accepted, jumpType, plannedAfter: !!actor.hammerJumpPlanned });
      return accepted;
    };
  }
  const goal = (team: string | undefined) => getGrifballEnemyGoalPosForMap(team, fixture.map);
  let dashRequests = 0, observedTarget: string | null = null, observedIncomingThreat = false;
  const observedTargets = actionObservers?.dashUpdate ? {
    ...targets,
    getBestTacticalTarget: (...args: Parameters<typeof targets.getBestTacticalTarget>) => {
      const target = targets.getBestTacticalTarget(...args);
      observedTarget = target?.id ?? null; observedIncomingThreat = !!target?.isLunging;
      return target;
    },
    getTacticalTargetById: (...args: Parameters<typeof targets.getTacticalTargetById>) => {
      const target = targets.getTacticalTargetById(...args);
      observedTarget = target?.id ?? null; observedIncomingThreat = !!target?.isLunging;
      return target;
    },
  } : targets;
  const dashSnapshot = (id: string): AutonomousDashActorObservation => {
    const actor = state.otherPlayers.get(id)!;
    return { pos: actor.pos.toArray(), vel: actor.vel.toArray(), hp: actor.hp, weapon: actor.activeWeapon,
      remaining: actor.aiDashRemaining ?? 0, cooldown: actor.aiDashCooldownTimer ?? 0,
      direction: { x: actor.aiDashDir?.x ?? 0, y: actor.aiDashDir?.y ?? 0, z: actor.aiDashDir?.z ?? 0 },
      jumping: !!actor.isJumping, lunging: !!actor.isLunging,
      role: state.aiMatchContext.grifballTeamPlan.assignments.get(id)?.role ?? null };
  };
  const updateSingleAIEntity = createAISingleEntityUpdaterForState({ ...common, ...effects, ...observations,
    ...roster, ...bookkeeping, ...resolution, ...observedTargets, ...collision, ...actions,
    playDash: actionObservers?.dashUpdate ? () => { dashRequests++; effects.playDash(); } : effects.playDash,
    stateRef: ref(state), threeRef: ref(refs), grifballEnemyGoalPos: goal, areCombatantsHostile,
    getOptimalSpawnPoint: arena.getOptimalSpawnPoint,
    grifballTeamOf: (id: string) => getGrifballTeamOfForState(state, id),
    grifballCombatantRef: (id: string) => getGrifballCombatantRefForState(state, id) });
  const observedUpdate: typeof updateSingleAIEntity = actionObservers?.dashUpdate ? (id, dt) => {
    const before = dashSnapshot(id), requestsBefore = dashRequests;
    observedTarget = null; observedIncomingThreat = false;
    const result = updateSingleAIEntity(id, dt);
    actionObservers.dashUpdate!({ id, requested: dashRequests > requestsBefore, target: observedTarget,
      incomingThreat: observedIncomingThreat, before, after: dashSnapshot(id) });
    return result;
  } : updateSingleAIEntity;
  const frame = createGameFrameCallbacksForState({ ...common, ...effects, ...roster, ...actions, ...player,
    getMainAI: roster.mai, getReplayActive: () => false, getKeysPressed: () => keysPressed.current,
    getKeybindings: () => DEFAULT_KEYBINDINGS, getEnemyGoalPos: goal, updateSingleAIEntity: observedUpdate,
    getSpectateTargetData: () => { throw new Error('Headless validation has no spectate target'); } });
  const tick = (dt: number) => advanceGrifballFrameForState({ ...common, ...effects, ...player, ...frame,
    ...collision, state, refs, dt, ballMeshRef, ballChargingRef, ballChargeTimerRef,
    isPausedRef: ref(false), replayData: null, keysPressed, grifbHoldTimerRef: ref(0), secretAudioRef: ref(null),
    replayRecordingRef: ref(null), replayRecordingElapsedTimeRef: ref(0), lastRecordTimeRef: ref(0),
    rebuildHostModel: noop, runAIOrchestrator: arena.runAIOrchestrator,
    updateGrifball: delta => updateGrifballObjectiveForState({ state, refs, dt: delta, ballMeshRef, ballChargingRef,
      ballChargeTimerRef, isMultiplayer: false, activeCustomMap: fixture.map,
      placeCombatantsAtGrifballSpawns: arena.placeCombatantsAtGrifballSpawns, pushStatsUpdate: noop }),
    updateMatchTimers: delta => updateGrifballMatchTimers(state, roster.mai(), delta),
    renderGame: noop, updateFloatingNameplate: noop, updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop });
  const runtime = new GrifballValidationRuntime({ state, tick, observeState,
    resetControls: () => { keysPressed.current = {}; ballChargingRef.current = false; ballChargeTimerRef.current = 0; },
    removeActor: id => { refs.otherPlayerMeshes.delete(id); },
    provisionActor: actor => {
      const group = new THREE.Group(); group.userData.modelSystem = 'v2';
      group.position.copy(actor.pos); group.rotation.y = actor.yaw;
      refs.otherPlayerMeshes.set(actor.id, { group, hammer: new THREE.Group(), sword: new THREE.Group(),
        rig: buildCombatantRigForModel(group) });
    },
    hasActorMesh: id => refs.otherPlayerMeshes.has(id),
    applyLocalInput: input => applyValidationLocalInput(state, keysPressed.current, input, weapons),
  }, fixture, job);
  return { protocol: AUTONOMOUS_RUNTIME_PROTOCOL, runtime, state, refs };
}

export async function runAutonomousValidationTrial(fixture: FrozenCase, job: ValidationJob,
  observeState?: (canonicalState: string) => void) {
  const host = createAutonomousValidationRuntime(fixture, job, observeState);
  try {
    for (let i = 0; i < job.simulationTicks; i++) host.runtime.step();
    return await host.runtime.done;
  } finally { host.runtime.dispose(); }
}
