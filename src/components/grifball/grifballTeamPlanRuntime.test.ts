import { tickScriptedGrifballPassForState, updateGrifballObjectiveForState } from './grifballObjectiveRuntime';
import { defaultGrifballTactics } from '../../game/grifballTacticsConfig';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { resetAIMatchContext } from '../../game/aiMatchContext';
import type { Combatant } from '../../types';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { updateGrifballTeamPlanForState } from './grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant, type GrifballAIObjectiveFrame } from './grifballAIObjectiveMovement';
import { createAISingleEntityUpdaterForState } from './aiSingleEntityRuntime';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { updateAIRosterTick } from './aiRosterTick';
import { buildGrifballHudStats } from './hudStats';
import { isSpaceSegmentOpen } from '../../game/grifballSpaceGeometry';
import type { CustomMapData } from '../../types';

const goal = (team: string | undefined) => ({ x: team === 'blue' ? 47 : -47, z: 0 });

test('planned runner direction overrides local avoidance without gaining movement speed', () => {
  const state = setup(), runner = state.otherPlayers.get('a')!;
  runner.pos.set(0, 0, 0); runner.activeWeapon = 'ball';
  state.otherPlayers.get('enemy')!.pos.set(5, 0, 0);
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'a';
  state.grifballTactics = defaultGrifballTactics(); state.grifballTactics.defaults.runnerRiskWeight = 0;
  updateGrifballTeamPlanForState(state, 0.2, goal);
  assert.equal(state.aiMatchContext.grifballTeamPlan.runnerPlans.blue.selected.action, 'advance');
  const result = move(state, 'a', {}, [{ x: 5, z: 0 }]);
  assert.ok(result.frame.pos.x > 0); assert.equal(result.frame.pos.z, 0);
  assert.ok(result.frame.vel.length() <= 5.8 * (state.settings.speedForward / 100) * (state.settings.grifballRunnerSpeedForward! / 100) + 0.001);
});

test('coverage waiting preserves reload and leaves committed airborne movement with its executor', () => {
  const state = setup(), runner = state.otherPlayers.get('a')!;
  runner.pos.set(0, 0, 0); runner.activeWeapon = 'ball';
  state.otherPlayers.get('b')!.pos.set(-9, 0, 0); state.otherPlayers.get('enemy')!.pos.set(6, 0, 0);
  state.settings.attackRange = 1; state.settings.attackRadius = 2;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'a';
  state.grifballTactics = defaultGrifballTactics(); Object.assign(state.grifballTactics.defaults, { runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 });
  updateGrifballTeamPlanForState(state, 0.2, goal);
  assert.equal(state.aiMatchContext.grifballTeamPlan.runnerPlans.blue.selected.action, 'wait');
  const result = move(state, 'a', { aiState: 'COOLDOWN', timer: 0.6, weaponState: 'recovering' });
  assert.equal(result.frame.vel.length(), 0); assert.equal(result.frame.timer, 0.5);
  runner.isJumping = true; runner.vel.y = 4;
  assert.equal(move(state, 'a').handled, false); assert.equal(runner.vel.y, 4);
});

test('objective movement follows a custom-map detour and holds when the route is sealed', () => {
  const state = setup(); state.otherPlayers.get('a')!.pos.x = -8;
  state.grifball.ball.pos = { x: 8, y: 0, z: 0 };
  const map = { mapShape: 'rectangular', arenaRadius: 60, arenaHalfExtents: { x: 52, z: 23 }, objects: [
    { type: 'box', position: { x: 0, y: 1, z: 0 }, scale: { x: 0.05, y: 2, z: 8 }, isCollidable: true },
  ] } as CustomMapData;
  for (let i = 0; i < 150; i++) {
    updateGrifballTeamPlanForState(state, 0.1, goal, map);
    const before = state.otherPlayers.get('a')!.pos.clone(); const result = move(state, 'a');
    assert.ok(isSpaceSegmentOpen(state.aiMatchContext.grifballTeamPlan.snapshot!.geometry!, before, result.frame.pos));
  }
  assert.ok(state.otherPlayers.get('a')!.pos.distanceTo(new THREE.Vector3(8, 0, 0)) < 1);
  state.otherPlayers.get('a')!.pos.set(-8, 0, 0); map.objects[0].scale.z = 60;
  updateGrifballTeamPlanForState(state, 0.1, goal, map);
  const result = move(state, 'a');
  assert.equal(state.aiMatchContext.grifballTeamPlan.assignments.get('a')!.space!.route.status, 'blocked');
  assert.equal(result.frame.vel.length(), 0); assert.equal(result.frame.pos.x, -8);
});
function setup() {
  const state = createInitialGrifballRuntimeState({ debugMode: true, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' }, isMultiplayer: false, multiplayerRole: null });
  state.grifball.phase = 'playing';
  state.arenaRadius = 60;
  state.isObserverMode = true;
  state.otherPlayers.clear();
  const bot = (id: string, x: number, team: 'blue' | 'red' = 'blue'): Combatant => ({
    id, playerName: id, controller: 'ai', difficulty: 'normal', team,
    pos: new THREE.Vector3(x, 0, 0), vel: new THREE.Vector3(), yaw: 0,
    hp: 1, maxHp: 1, isCrouching: false, activeWeapon: 'hammer', weaponState: 'ready',
    respawnTimer: 0, hue: 0, score: 0, kills: 0, deaths: 0,
  });
  state.otherPlayers.set('a', bot('a', -2));
  state.otherPlayers.set('b', bot('b', -10));
  state.otherPlayers.set('enemy', bot('enemy', 30, 'red'));
  return state;
}
function move(state: ReturnType<typeof setup>, id: string, overrides: Partial<GrifballAIObjectiveFrame> = {}, enemiesList: { x: number; z: number }[] = [], canStartWeaponAction = false) {
  const self = state.otherPlayers.get(id)!;
  const frame: GrifballAIObjectiveFrame = { pos: self.pos, vel: self.vel, yaw: 0, aiState: 'APPROACHING', timer: 0, dashRemaining: 0, slideActive: false, weaponState: 'ready', pickupRequested: false, ...overrides };
  let attacks = 0;
  const handled = resolvePrimaryGrifballAIObjectiveMovementForCombatant({
    state, botId: id, self, frame, alliesList: [], enemiesList, dt: 0.1,
    canStartWeaponAction, triggerCombatantAttack: () => { attacks++; },
    constrainCombatantToArena: () => {}, getEnemyGoalPos: goal,
  });
  return { handled, frame, attacks };
}

test('live adapter copies positions and excludes dead, respawning, neural and remote bots from assignments', () => {
  const state = setup();
  const a = state.otherPlayers.get('a')!;
  state.otherPlayers.set('remote', { ...a, id: 'remote', controller: 'remote', pos: new THREE.Vector3(-20, 0, 0) });
  state.otherPlayers.set('neural', { ...a, id: 'neural', difficulty: 'neural-net', pos: new THREE.Vector3(-20, 0, 0) });
  state.otherPlayers.set('dead', { ...a, id: 'dead', hp: 0 });
  state.otherPlayers.set('respawning', { ...a, id: 'respawning', respawnTimer: 2 });
  state.otherPlayers.set('observer', { ...a, id: 'observer', isObserver: true });
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const plan = state.aiMatchContext.grifballTeamPlan;
  for (const id of ['remote', 'neural', 'dead', 'respawning', 'observer', 'player']) assert.equal(plan.assignments.has(id), false);
  a.pos.x = 100;
  assert.equal(plan.snapshot!.players.find(p => p.id === 'a')!.pos.x, -2);
  resetAIMatchContext(state.aiMatchContext);
  assert.equal(plan.assignments.size, 0);
  assert.equal(plan.snapshot, null);
});

test('only the assigned retriever requests a pickup while teammates move to support', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const a = move(state, 'a');
  const b = move(state, 'b');
  assert.equal(a.frame.pickupRequested, true);
  assert.equal(b.frame.pickupRequested, false);
  assert.equal(a.handled, true);
  assert.equal(b.handled, true);
  assert.ok(b.frame.pos.x > -10);
});

test('escort moves despite an unrelated nearby enemy and hands relevant threats to combat', () => {
  const state = setup();
  state.grifball.ball.state = 'held';
  state.grifball.ball.holderId = 'a';
  state.otherPlayers.get('a')!.pos.x = 10;
  state.otherPlayers.get('b')!.pos.x = -20;
  state.otherPlayers.get('enemy')!.pos.x = -10;
  updateGrifballTeamPlanForState(state, 0.016, goal);
  assert.equal(move(state, 'b').handled, true);
  state.otherPlayers.get('b')!.pos.x = 16;
  state.otherPlayers.get('enemy')!.pos.x = 19;
  updateGrifballTeamPlanForState(state, 0.25, goal);
  assert.equal(move(state, 'b').handled, false);
});

test('arrival holds a destination without overshoot and objective movement preserves reload', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const destination = state.aiMatchContext.grifballTeamPlan.assignments.get('b')!.destination;
  const bot = state.otherPlayers.get('b')!;
  bot.pos.set(destination.x, 0, destination.z);
  const result = move(state, 'b', { aiState: 'COOLDOWN', timer: 0.6, weaponState: 'recovering' });
  assert.equal(result.handled, true);
  assert.equal(result.frame.aiState, 'COOLDOWN');
  assert.ok(Math.abs(result.frame.timer - 0.5) < 0.001);
  assert.equal(result.frame.pos.x, destination.x);
  assert.equal(result.frame.vel.length(), 0);
});

test('objective steering defers committed movement and never snaps an airborne bot to the floor', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const bot = state.otherPlayers.get('b')!;
  bot.pos.y = 2;
  bot.vel.y = 3;
  assert.equal(move(state, 'b').handled, false);
  assert.equal(bot.pos.y, 2);
  assert.equal(bot.vel.y, 3);
  bot.pos.y = 0;
  bot.vel.y = 0;
  assert.equal(move(state, 'b', { dashRemaining: 0.2 }).handled, false);
  bot.isLunging = true;
  assert.equal(move(state, 'b').handled, false);
});

test('non-Grifball, multiplayer and ended rounds clear tactical assignments', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  state.grifball.phase = 'scored';
  updateGrifballTeamPlanForState(state, 0.001, goal);
  assert.equal(state.aiMatchContext.grifballTeamPlan.assignments.size, 0);
  state.grifball.phase = 'playing';
  state.arenaRadius = 60;
  state.settings.gameMode = 'sandbox';
  updateGrifballTeamPlanForState(state, 0.001, goal);
  assert.equal(state.aiMatchContext.grifballTeamPlan.snapshot, null);
  state.settings.gameMode = 'grifball';
  state.isMultiplayer = true;
  updateGrifballTeamPlanForState(state, 0.001, goal);
  assert.equal(state.aiMatchContext.grifballTeamPlan.snapshot, null);
});

function liveUpdater(state: ReturnType<typeof setup>) {
  const refs = createInitialGrifballThreeRefs();
  for (const bot of state.otherPlayers.values()) {
    refs.otherPlayerMeshes.set(bot.id, { group: new THREE.Group() } as never);
  }
  const update = createAISingleEntityUpdaterForState({
    stateRef: { current: state }, threeRef: { current: refs }, mai: () => undefined,
    resolveBotKnobs: () => ({ difficulty: 'easy', movementComplexity: 0, weaponSwapIQ: 0, weaponPrioritization: 0, reactionLatency: 0.2, anticipationFactor: 0 }),
    resolveBotDerived: () => ({ pressureAggression: 50 }), resolveBotFlags: () => ({}),
    getMatchScoreContext: () => ({ ownScore: 0, opponentScore: 0, scoreToWin: 25 }),
    grifballEnemyGoalPos: goal, constrainCombatantToArena: () => {},
    getBestTacticalTarget: () => { throw new Error('generic combat must not override team positioning'); },
    triggerCombatantAttack: () => { throw new Error('unexpected attack'); },
    playDash: () => {}, playJump: () => {}, playExplosion: () => {}, playDeath: () => {},
  });
  return { refs, update };
}

test('real bot updater positions support before generic targeting and ticks cooldowns once', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const bot = state.otherPlayers.get('b')!;
  bot.aiState = 'COOLDOWN';
  bot.aiTimer = 0.6;
  bot.aiDashCooldownTimer = 1;
  bot.swapCooldownTimer = 0.5;
  bot.weaponState = 'recovering';
  const { update } = liveUpdater(state);
  update('b', 0.1);
  assert.ok(bot.pos.x > -10);
  assert.ok(Math.abs(bot.aiTimer! - 0.5) < 0.001);
  assert.ok(Math.abs(bot.aiDashCooldownTimer! - 0.9) < 0.001);
  assert.ok(Math.abs(bot.swapCooldownTimer! - 0.4) < 0.001);
  assert.equal(bot.pickupRequested, false);
});

test('real updater holds scripted bots during countdown and clears stale pickup intent', () => {
  const state = setup();
  state.grifball.phase = 'countdown';
  const bot = state.otherPlayers.get('a')!;
  bot.pickupRequested = true;
  bot.vel.x = 5;
  liveUpdater(state).update('a', 0.1);
  assert.equal(bot.pos.x, -2);
  assert.equal(bot.vel.length(), 0);
  assert.equal(bot.pickupRequested, false);
});

test('roster plans after respawns and before updates, using one snapshot for every bot', () => {
  const state = setup();
  const { refs } = liveUpdater(state);
  const bot = state.otherPlayers.get('b')!;
  bot.hp = 0;
  bot.respawnTimer = 0;
  let revision = -1;
  updateAIRosterTick({
    refs, rosterAI: [...state.otherPlayers.values()], dt: 0.1,
    respawnCombatant: combatant => { combatant.hp = 1; },
    beforeUpdate: () => { updateGrifballTeamPlanForState(state, 0.1, goal); revision = state.aiMatchContext.grifballTeamPlan.revision; },
    updateSingleAIEntity: id => {
      assert.ok(state.aiMatchContext.grifballTeamPlan.assignments.has('b'));
      assert.equal(state.aiMatchContext.grifballTeamPlan.revision, revision);
      state.otherPlayers.get(id)!.pos.x += 100;
      assert.ok(state.aiMatchContext.grifballTeamPlan.snapshot!.players.every(p => p.pos.x < 100));
    },
  });
  assert.ok(revision > 0);
});

test('debug HUD exposes current roles and destinations only when enabled', () => {
  const state = setup();
  updateGrifballTeamPlanForState(state, 0.016, goal);
  const stats = () => buildGrifballHudStats({ state, opponent: undefined, isMultiplayer: false, multiplayerRole: null, opponentConnected: false, fps: 60, observerTargetName: '', opponentPlayerName: undefined });
  assert.equal(stats().grifballTacticsDebug?.length, 3);
  assert.ok(stats().grifballTacticsDebug!.some(line => line.includes('retriever ->')));
  state.debugMode = false;
  assert.equal(stats().grifballTacticsDebug, undefined);
});


test('live tanking owns coordinator targets before combat and releases them when disabled', () => {
  const state = setup(); state.isObserverMode = false;
  state.playerHP = 100; state.playerRespawnTimer = 0; state.localPlayerTeam = 'blue'; state.playerPos.set(0, 0, 0); state.yaw = -Math.PI / 2; state.activeWeapon = 'ball';
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player';
  state.settings.attackRange = 1.5; state.settings.attackRadius = 1.5; state.settings.hammerReloadTime = 2;
  state.otherPlayers.get('a')!.pos.set(3, 0, -3); state.otherPlayers.get('b')!.pos.set(3, 0, 3);
  const c = { ...state.otherPlayers.get('a')!, id: 'c', pos: new THREE.Vector3(-8, 0, 0), vel: new THREE.Vector3() };
  state.otherPlayers.set('c', c);
  const enemy = state.otherPlayers.get('enemy')!; enemy.pos.set(6, 0, 0); enemy.weaponState = 'recovering'; enemy.weaponTimer = 0;
  state.grifballTactics = defaultGrifballTactics(); Object.assign(state.grifballTactics.defaults, { tankMinimumScore: 0, tankDoubleThreshold: 0, tankProtectionWeight: 10, tankOpeningWeight: 10 });
  updateGrifballTeamPlanForState(state, 0.2, goal);
  const plan = state.aiMatchContext.grifballTeamPlan;
  const primary = [...plan.assignments.values()].find(a => a.team === 'blue' && a.tanking?.mode === 'engage')!;
  assert.ok(primary);
  assert.equal(state.aiMatchContext.coordinator.tacticalEngagements.get(primary.botId)?.targetId, 'enemy');
  assert.equal(move(state, primary.botId).handled, false); // Hand off to the normal combat executor.
  const cover = [...plan.assignments.values()].find(a => a.botId === primary.tanking!.recoveryId)!;
  const result = move(state, cover.botId, { aiState: 'COOLDOWN', timer: 0.6, weaponState: 'recovering' });
  assert.equal(result.handled, true); assert.equal(result.frame.weaponState, 'recovering'); assert.equal(result.frame.timer, 0.5);
  state.grifballTactics.teams.blue = { tankingEnabled: false };
  updateGrifballTeamPlanForState(state, 0.001, goal);
  assert.ok([...plan.assignments.values()].filter(a => a.team === 'blue').every(a => !a.tanking));
  assert.equal(state.aiMatchContext.coordinator.tacticalEngagements.has(primary.botId), false);
  state.settings.gameMode = 'sandbox'; updateGrifballTeamPlanForState(state, 0.01, goal);
  assert.equal(state.aiMatchContext.coordinator.tacticalEngagements.size, 0);
});

function passingSetup() {
  const state = setup(), carrier = state.otherPlayers.get('a')!;
  carrier.pos.set(-20, 0, 0); carrier.activeWeapon = 'ball';
  state.otherPlayers.get('b')!.pos.set(-8, 0, 0);
  state.otherPlayers.get('enemy')!.pos.set(-45, 0, 18);
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'a';
  state.grifballTactics = defaultGrifballTactics();
  updateGrifballTeamPlanForState(state, 0.2, goal);
  return state;
}
test('scripted pass honors charge time, releases once and restores normal carrier health/weapon', () => {
  const state = passingSetup(), plan = state.aiMatchContext.grifballTeamPlan, refs = createInitialGrifballThreeRefs();
  const pass = plan.assignments.get('a')!.pass!;
  const selected = pass.candidates.find(c => c.viable && c.chargeSeconds > 0)!; assert.ok(selected); pass.selected = selected;
  const carrier = state.otherPlayers.get('a')!; carrier.maxHp = 2; carrier.hp = 2;
  const result = move(state, 'a', {}, [], true); assert.equal(result.frame.vel.length(), 0);
  assert.equal(tickScriptedGrifballPassForState(state, refs, selected.chargeSeconds / 2), false);
  assert.equal(state.grifball.ball.state, 'held'); assert.ok(carrier.grifballPassCharge! > 0);
  assert.equal(tickScriptedGrifballPassForState(state, refs, selected.chargeSeconds / 2), true);
  assert.equal(state.grifball.ball.state, 'thrown'); assert.equal(state.grifball.ball.holderId, null);
  assert.equal(carrier.activeWeapon, 'hammer'); assert.equal(carrier.maxHp, state.settings.maxHP);
  assert.equal(carrier.hp, state.settings.maxHP); assert.equal(plan.passCharge, null); assert.equal(carrier.grifballPassCharge, 0);
  const velocity = { ...state.grifball.ball.vel }; assert.equal(tickScriptedGrifballPassForState(state, refs, 1), false);
  assert.deepEqual(state.grifball.ball.vel, velocity);
});
test('release rechecks receiver death, pressure, module/rule changes and human/neural ownership', () => {
  for (const block of ['death', 'pressure', 'throwing', 'module', 'neural', 'remote', 'cooldown', 'airborne', 'phase'] as const) {
    const state = passingSetup(), refs = createInitialGrifballThreeRefs(), carrier = state.otherPlayers.get('a')!;
    const plan = state.aiMatchContext.grifballTeamPlan; assert.ok(plan.assignments.get('a')!.pass!.selected);
    plan.passCharge = { carrierId: 'a', receiverId: 'b', speed: 9, elapsed: 1 }; carrier.grifballPassCharge = 0.5;
    if (block === 'death') state.otherPlayers.get('b')!.hp = 0;
    if (block === 'pressure') state.otherPlayers.get('enemy')!.pos.copy(carrier.pos);
    if (block === 'throwing') state.settings.grifballAllowThrowing = false;
    if (block === 'module') state.grifballTactics.defaults.passingEnabled = false;
    if (block === 'neural') carrier.difficulty = 'neural-net';
    if (block === 'remote') carrier.controller = 'remote';
    if (block === 'cooldown') { carrier.aiState = 'COOLDOWN'; carrier.aiTimer = 1; }
    if (block === 'airborne') carrier.pos.y = 1;
    if (block === 'phase') state.grifball.phase = 'round_over' as any;
    assert.equal(tickScriptedGrifballPassForState(state, refs, 2), false, block);
    assert.equal(state.grifball.ball.state, 'held', block); assert.equal(plan.passCharge, null, block);
    if (block !== 'neural' && block !== 'remote') assert.equal(carrier.grifballPassCharge, 0, block);
  }
});
test('a complete scripted pass settles and is picked up by its receiver using live objective rules', () => {
  const state = passingSetup(), refs = createInitialGrifballThreeRefs();
  const ballMeshRef = { current: null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  // Keep the opponent observed and far away while exercising real movement, ball physics and pickup.
  state.otherPlayers.get('enemy')!.controller = 'remote';
  let released = false, received = false;
  for (let i = 0; i < 360; i++) {
    updateGrifballTeamPlanForState(state, 1 / 60, goal);
    for (const id of ['a', 'b']) { const result = move(state, id, {}, [], true); state.otherPlayers.get(id)!.pickupRequested = result.frame.pickupRequested; }
    updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
      isMultiplayer: false, activeCustomMap: null, placeCombatantsAtGrifballSpawns: () => {}, pushStatsUpdate: () => {} });
    if (state.grifball.ball.state === 'thrown') released = true;
    if (released && state.grifball.ball.holderId === 'b') { received = true; break; }
  }
  assert.ok(released, 'pass released'); assert.ok(received, 'intended receiver picked up settled ball');
});
test('respawn observations are copied separately and never issue orders to dead teammates', () => {
  const state = setup(); const bot = state.otherPlayers.get('b')!; bot.hp = 0; bot.respawnTimer = 1.5;
  updateGrifballTeamPlanForState(state, 0.2, goal);
  const snapshot = state.aiMatchContext.grifballTeamPlan.snapshot!;
  assert.ok(snapshot.respawns!.some(p => p.id === 'b' && p.seconds === 1.5));
  assert.ok(!snapshot.players.some(p => p.id === 'b')); assert.ok(!state.aiMatchContext.grifballTeamPlan.assignments.has('b'));
  bot.respawnTimer = 0; assert.equal(snapshot.respawns!.find(p => p.id === 'b')!.seconds, 1.5);
});
