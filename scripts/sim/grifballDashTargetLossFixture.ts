import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createAISingleEntityUpdaterForState } from '../../src/components/grifball/aiSingleEntityRuntime';
import { createOfflineBotCombatant } from '../../src/game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { getOrCreatePlayerModel } from '../../src/game/aiPlayerModel';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';
import { integrateTargetEngagementGravityForCombatant, tickAIEngagementCooldowns } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { resolvePreGroundMovementRecoveryForCombatant } from '../../src/components/grifball/aiAirborneRecoveryRuntime';
import { resolveAIDashMovementForCombatant } from '../../src/components/grifball/aiDashMovementRuntime';

/** A committed dash whose target has disappeared. The production updater must
 * cancel it; observing this boundary must not depend on a match seed producing it. */
export function runDashTargetLossFixture(id = 'ordinary', airborne = false) {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs();
  state.isObserverMode = true; state.grifball.phase = 'playing'; state.otherPlayers.clear();
  const actor = createOfflineBotCombatant({ id, playerName: id, team: 'blue',
    spawnPos: new THREE.Vector3(0, airborne ? 2 : 0, 0), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  Object.assign(actor, { controller: 'ai', weaponState: 'ready', invulnerabilityTimer: 0,
    aiDashRemaining: .1, aiDashCooldownTimer: 1, aiDashDir: { x: 1, y: 0, z: 0 }, isJumping: airborne });
  state.otherPlayers.set(id, actor); refs.otherPlayerMeshes.set(id, { group: new THREE.Group() } as never);
  const observe = () => ({ remaining: actor.aiDashRemaining!, cooldown: actor.aiDashCooldownTimer!,
    direction: { ...actor.aiDashDir! }, jumping: !!actor.isJumping, pos: actor.pos.toArray(), vel: actor.vel.toArray(),
    hp: actor.hp, weapon: actor.activeWeapon, role: null });
  let requested = false;
  const noop = () => {};
  const update = createAISingleEntityUpdaterForState({ stateRef: { current: state }, threeRef: { current: refs },
    mai: () => state.otherPlayers.get('main_ai'),
    resolveBotKnobs: () => ({ difficulty: 'normal', movementComplexity: 0, weaponSwapIQ: 0,
      weaponPrioritization: 0, reactionLatency: .2, anticipationFactor: 0 }),
    resolveBotDerived: () => ({ pressureAggression: 50, spatialIQ: 50 }), resolveBotFlags: () => ({}),
    getMatchScoreContext: () => ({ scorePlayer: 0, scoreEnemy: 0, killsToWin: 25 }),
    getBestTacticalTarget: () => null, getTacticalTargetById: () => null,
    getActiveCustomMap: () => null, getOptimalSpawnPoint: () => new THREE.Vector3(),
    grifballEnemyGoalPos: () => ({ x: 30, z: 0 }), constrainCombatantToArena: noop, recoverCombatantAltitude: () => false,
    recordCombatantObservation: (botId, record) => record(getOrCreatePlayerModel(state.aiMatchContext, botId)),
    playDash: () => { requested = true; }, playJump: noop, playExplosion: noop, playDeath: noop });
  const before = observe();
  withSimulationRandom(seededRandom(1), 0, () => update(id, 1 / 60));
  return { dashSettings: { distance: state.settings.dashDistance, duration: state.settings.dashDuration, cooldown: state.settings.dashCooldown },
    dashSamples: [{ tick: 1, id, requested, target: null, incomingThreat: false, before, after: observe() }] };
}

/** Physical boundary fixtures use the live gravity, recovery and dash owners in
 * production order. They validate the auditor independently of tactical choices. */
export function runDashFlightFixture(kind: 'flight' | 'landing', id = 'ordinary') {
  const state = createInitialGrifballRuntimeState({ debugMode: false,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  const refs = createInitialGrifballThreeRefs(), noop = () => {};
  const actor = createOfflineBotCombatant({ id, playerName: id, team: 'blue',
    spawnPos: new THREE.Vector3(0, kind === 'flight' ? 2 : .01, 0), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
  actor.isJumping = true; actor.vel.set(2, -3, 1);
  const frame = { pos: actor.pos, vel: actor.vel, dashDir: new THREE.Vector3(1, 0, 0),
    aiState: actor.aiState, timer: 0, dashRemaining: .1, dashCooldownTimer: 1, slideCooldownTimer: 0,
    hammerJumpCooldownTimer: 0, slideActive: false, pendingPostEvasionCharge: false, isSprinting: false };
  const observe = () => ({ pos: actor.pos.toArray(), vel: actor.vel.toArray(), hp: actor.hp, weapon: actor.activeWeapon,
    remaining: frame.dashRemaining, cooldown: frame.dashCooldownTimer, direction: { x: 1, y: 0, z: 0 }, jumping: !!actor.isJumping, role: null });
  const before = observe(), dt = 1 / 60;
  tickAIEngagementCooldowns({ frame, self: actor, botId: id, mainAIId: 'main_ai', dt });
  integrateTargetEngagementGravityForCombatant({ self: actor, dt, gravityAcceleration: 18, frame,
    recoverCombatantAltitude: () => false, constrainCombatantToArena: noop });
  if (resolvePreGroundMovementRecoveryForCombatant({ self: actor, pos: actor.pos, vel: actor.vel, dt,
    movementComplexity: 0, swayTimer: 0, toTarget: new THREE.Vector3(), recoverCombatantAltitude: () => false,
    constrainCombatantToArena: noop }) === 'continue')
    resolveAIDashMovementForCombatant({ state, refs, frame, dt, activeWeapon: 'hammer', targetWeaponState: 'ready',
      attackDistanceToTarget: 20, resolvedAiReach: 3, targetProtected: false, spatialIQ: 0, weaponReady: true });
  return { scenario: { boundary: kind, id }, dashSettings: { distance: state.settings.dashDistance,
    duration: state.settings.dashDuration, cooldown: state.settings.dashCooldown },
    dashSamples: [{ tick: 1, id, requested: false, target: 'observed-target', incomingThreat: false, before, after: observe() }] };
}
