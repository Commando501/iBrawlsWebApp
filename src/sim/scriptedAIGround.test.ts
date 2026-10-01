import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation } from './step';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { NEUTRAL_MATCH_MULTIPLIERS } from '../game/aiTuning';
import type { ScriptedAIGroundRequest } from './scriptedAIGround';
import type { ScriptedActorDecision, ScriptedActorDecisionOwner } from './scriptedActorDecision';

function fixture(id = 'ordinary') {
  const state = createMatch({ seed: 4, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 }, settings: { maxHP: 20, aiDifficulty: 'normal' } });
  const [actor, target, player] = state.combatants;
  actor.id = id; target.id = 'target'; target.team = 'red'; actor.controller = target.controller = 'ai';
  player.id = state.localPlayerId = 'player'; player.controller = 'remote'; player.pos = { x: 30, y: 0, z: 30 };
  state.match.phase = 'playing'; actor.pos = { x: 0, y: 0, z: 0 }; actor.vel = { x: 0, y: 0, z: 0 }; actor.yaw = 0;
  target.pos = { x: 0, y: 0, z: 2 }; actor.dashCooldownTimer = 2;
  for (const c of [actor, target]) c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  let draws = 0, calls = 0;
  const request: ScriptedAIGroundRequest = { targetId: target.id, targetMemory: { aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 },
    memory: { aiState: 'CHARGE_ATTACK', timer: .5, weaponState: 'ready', isSprinting: false },
    policy: { pressureTargetId: target.id, distanceToTarget: 2, attackDistanceToTarget: 2, resolvedDangerZone: 3,
      resolvedAiReach: 3, guaranteedKillRange: 3, maxLungeRange: 10, minLungeRange: 4, stationarySwingReach: 3,
      activeWeapon: 'hammer', canStartWeaponAction: true, targetIsProtected: false, difficulty: 'normal', movementComplexity: 80,
      playstyleFactor: 1, tunedAnticipationFactor: .5, effectiveReactionLatency: .1, effectivePressureAggression: 50,
      cooldownMult: 1, swayTimer: 1, lookHeading: new THREE.Vector3(0, 0, 1), spatialLookHeading: new THREE.Vector3(0, 0, 1),
      sidewayHeading: new THREE.Vector3(-1, 0, 0), spatialBias: { aggressionMult: 1 }, totalApproachLateral: 0,
      sprintMult: 1, isCrouching: false, feintChance: 0, feintLungeFakeout: false, psychEnabled: false,
      psychState: { standoffTimer: 1 }, matchMultipliers: { ...NEUTRAL_MATCH_MULTIPLIERS }, tuning: resolveBehaviorTuning(state.settings),
      tryFeintRoll: () => false, commitFeint: () => {}, isTargetOnCooldown: () => false,
      isCoordAttackBlocked: () => false, clearPressureTarget: () => {}, random: () => { draws++; return .99; } } };
  const decision: Extract<ScriptedActorDecision, { kind: 'handled' }> = { kind: 'handled', action: idleAction(),
    ground: { version: 'scripted-ai-ground-v1', resolve: () => { calls++; return request; } } };
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: { [id]: 'normal' },
    prepare: () => 'engagement', resolve: () => decision };
  const step = () => stepSimulation(state, {}, { settings: state.settings, scriptedActorDecisions: owner });
  return { state, actor, target, owner, decision, request, step, draws: () => draws, calls: () => calls };
}
type Fixture = ReturnType<typeof fixture>;
for (const id of ['main_ai', 'ordinary']) {
  test(`ground movement reaches callbacks and later roster actors before animation: ${id}`, () => {
    const f = fixture(id); let observed = false;
    f.request.policy.isCoordAttackBlocked = () => {
      assert.equal(f.actor.pos.z, 6.5 / 60); assert.equal(f.actor.weaponState, 'idle'); return false;
    };
    f.owner.scriptedBots = { [id]: 'normal', target: 'normal' };
    f.owner.prepare = ({ actorId }) => actorId === id ? 'engagement' : 'default';
    f.owner.resolve = ({ actorId }) => {
      if (actorId === id) return f.decision;
      observed = true; assert.equal(f.actor.pos.z, 6.5 / 60); assert.equal(f.actor.weaponState, 'windup');
      assert.equal(f.actor.weaponPhaseElapsed, 0); return { kind: 'handled', action: idleAction() };
    };
    const events = f.step(); assert.ok(observed); assert.equal(f.actor.weaponPhaseElapsed, 1 / 60);
    assert.deepEqual(events.actorDecisionFrame!.decisions[0].ground!.actions, ['attack-hammer']);
    assert.equal(f.calls(), 1); assert.equal(f.draws(), 0);
  });
  for (const phase of ['windup', 'active', 'recovering'] as const) test(`ground refuses stale cached readiness ${id}/${phase}`, () => {
    const f = fixture(id); f.actor.weaponState = phase; f.actor.attackKind = 'strike'; f.actor.weaponPhaseElapsed = .03;
    assert.throws(f.step, /pre-existing attack/); assert.equal(f.draws(), 0); assert.equal(f.actor.weaponPhaseElapsed, .03);
  });
  test(`ground follows accepted early hammer callback without repeating clocks: ${id}`, () => {
    const f = fixture(id); f.actor.dashCooldownTimer = 1;
    f.decision.commandVersion = 'scripted-combat-v6'; f.decision.commands = [{ kind: 'melee', weapon: 'hammer', swipe: false }];
    f.request.policy.isCoordAttackBlocked = () => { assert.equal(f.actor.weaponState, 'windup'); assert.equal(f.actor.pos.z, 6.5 / 60); return false; };
    f.step(); assert.equal(f.actor.dashCooldownTimer, 1 - 1 / 60); assert.equal(f.actor.weaponPhaseElapsed, 1 / 60);
  });
  test(`refused early commands cannot authorize stale ground readiness: ${id}`, () => {
    const f = fixture(id); f.actor.weaponState = 'windup'; f.actor.attackKind = 'strike'; f.actor.weaponPhaseElapsed = .03;
    f.decision.commandVersion = 'scripted-combat-v6'; f.decision.commands = [{ kind: 'hammer-jump', jumpType: 'offensive' }];
    assert.throws(f.step, /pre-existing attack/); assert.equal(f.draws(), 0); assert.equal(f.actor.weaponPhaseElapsed, .03);
  });
  test(`later lethal flight cancels ground windup without posthumous damage: ${id}`, () => {
    const f = fixture(id); f.actor.hp = 1; f.target.weapon = 'sword'; f.target.isLunging = true;
    f.target.pos = { x: 0, y: 0, z: 3 }; f.target.lungeStartPos = { ...f.target.pos };
    f.target.lungeDir = { x: 0, y: 0, z: -1 }; f.target.lungeTargetId = id;
    Object.assign(f.state.settings, { swordLungeSpeed: 120, enableSwordTrade: false, enableHammerSwordTrade: false });
    const events = f.step(); assert.equal(f.actor.alive, false); assert.equal(f.target.hp, 20);
    assert.deepEqual(events.actorDecisionFrame!.decisions[0].ground!.actions, ['attack-hammer']);
    assert.equal(events.kills.length, 1);
  });
}
const badRequests: [string, (f: Fixture) => void][] = [
  ['missing target memory', f => { delete f.request.targetMemory; }],
  ['nonfinite target timer', f => { f.request.targetMemory!.timer = NaN; }],
  ['absent target', f => { f.request.targetId = 'missing'; }],
  ['allied target', f => { f.target.team = f.actor.team; }],
  ['nonfinite clock', f => { f.request.memory.timer = NaN; }],
  ['wrong weapon', f => { f.request.policy.activeWeapon = 'sword'; }],
  ['invalid state', f => { f.request.memory.aiState = 'invalid' as never; }],
  ['invalid phase', f => { f.request.memory.weaponState = 'invalid' as never; }],
  ['invalid sprint flag', f => { f.request.memory.isSprinting = 1 as never; }],
  ['nonfinite range', f => { f.request.policy.distanceToTarget = Infinity; }],
  ['nonfinite heading', f => { f.request.policy.lookHeading.x = NaN; }],
  ['missing heading', f => { f.request.policy.sidewayHeading = undefined as never; }],
  ['nonfinite tuning', f => { f.request.policy.tuning.slideMinGap = NaN; }],
  ['invalid protection', f => { f.request.policy.targetIsProtected = 1 as never; }],
  ['missing RNG owner', f => { f.request.policy.random = undefined as never; }],
];
for (const [name, mutate] of badRequests) test(`ground rejects ${name} before policy effects`, () => {
  const f = fixture(); mutate(f); const pos = { ...f.actor.pos };
  assert.throws(f.step, /ground|Ground/); assert.equal(f.draws(), 0); assert.deepEqual(f.actor.pos, pos);
  assert.equal(f.actor.weaponState, 'idle');
});
const conflicts: [string, (f: Fixture) => void][] = [
  ['unprepared frame', f => { f.owner.prepare = () => 'default'; }],
  ['old combat sequence', f => { f.decision.commandVersion = 'scripted-combat-v1'; f.decision.commands = [{ kind: 'melee', weapon: 'hammer', swipe: false }]; }],
  ['objective walk', f => { f.decision.movement = { x: 1, z: 0 }; }],
  ...(['jump', 'dash', 'attackPrimary', 'attackSecondary', 'swapWeapon', 'pickup'] as const).map(key => [key, (f: Fixture) => { f.decision.action[key] = true; }] as [string, (f: Fixture) => void]),
  ['generic walk', f => { f.decision.action.moveX = 1; }],
  ['pass', f => { f.decision.action.passCharge = 1; }],
  ['invalid version', f => { f.decision.ground!.version = 'bad' as never; }],
];
for (const [name, mutate] of conflicts) test(`ground refuses ${name} before calling its owner`, () => {
  const f = fixture(); mutate(f); assert.throws(f.step); assert.equal(f.calls(), 0); assert.equal(f.draws(), 0);
});

function opportunity(f: Fixture) {
  f.request.opportunity = { targetAirborne: false, enemyInKillRange: false, selfGrounded: true,
    swordForbidden: false, hammerForbidden: false, swapLockoutRemaining: 0, swapFeintActive: false, comboActive: false,
    lungeDistanceToTarget: 6, hasVerticalLungeLine: true, combatDistanceToTarget: 6, aggressiveLungeMult: 1,
    tuning: resolveBehaviorTuning(f.state.settings), startWeaponSwapFeintTimer: () => {},
    getTargetPlayerModel: () => null, recordCombatantObservation: () => {} };
  return f.request.opportunity;
}
for (const id of ['main_ai', 'ordinary']) {
  test(`stationary opportunity stops FSM and exposes zero movement to later actors: ${id}`, () => {
    const f = fixture(id); opportunity(f).enemyInKillRange = true;
    f.request.policy.isCoordAttackBlocked = () => assert.fail('stationary commit must not enter FSM');
    const events = f.step();
    assert.equal(f.actor.pos.z, 0); assert.equal(f.actor.vel.z, 0);
    assert.equal(f.actor.weaponPhaseElapsed, 1 / 60);
    assert.equal(events.actorDecisionFrame!.decisions[0].ground!.opportunity!.mode, 'sync_return');
    assert.deepEqual(events.actorDecisionFrame!.decisions[0].ground!.actions, ['attack-hammer']);
  });
  test(`lunge opportunity starts without travelling or running ground callbacks: ${id}`, () => {
    const f = fixture(id); opportunity(f);
    f.actor.weapon = f.request.policy.activeWeapon = 'sword'; f.request.policy.random = () => 0;
    f.request.policy.isCoordAttackBlocked = () => assert.fail('lunge must not enter FSM');
    const events = f.step();
    assert.equal(f.actor.isLunging, true); assert.equal(f.actor.pos.z, 0); assert.equal(f.actor.lungeTimer, 0);
    assert.equal(f.actor.lastSwordAttackTimeMs, 1000 / 60);
    assert.deepEqual(events.actorDecisionFrame!.decisions[0].ground!.actions, ['lunge']);
    f.step(); assert.ok(f.actor.pos.z > 0); assert.equal(f.actor.lungeTimer, 1 / 60);
  });
  test(`zero direction lunge declines and still stops the FSM: ${id}`, () => {
    const f = fixture(id); opportunity(f); f.target.pos = { ...f.actor.pos };
    f.actor.weapon = f.request.policy.activeWeapon = 'sword'; f.request.policy.random = () => 0;
    f.request.policy.isCoordAttackBlocked = () => assert.fail('declined lunge must return');
    const result = f.step().actorDecisionFrame!.decisions[0].ground!;
    assert.equal(result.opportunity!.mode, 'return'); assert.deepEqual(result.actions, []);
    assert.equal(f.actor.isLunging, false); assert.equal(f.actor.pos.z, 0);
  });
  test(`swap delay enters FSM once with retained range and readiness: ${id}`, () => {
    const f = fixture(id); const o = opportunity(f); let feints = 0;
    f.state.settings.weaponReadyTime = .3; f.state.settings.weaponSwapLockout = .4;
    f.request.memory.aiState = 'APPROACHING'; f.request.policy.feintChance = 1;
    f.request.policy.tryFeintRoll = scale => scale === .5; f.request.policy.commitFeint = () => { feints++; };
    o.startWeaponSwapFeintTimer = () => assert.equal(f.actor.weapon, 'sword');
    const result = f.step().actorDecisionFrame!.decisions[0].ground!;
    assert.deepEqual(result.actions, ['swap-sword']); assert.equal(feints, 1);
    assert.equal(result.opportunity!.canStartWeaponAction, false); assert.equal(result.opportunity!.mode, 'continue');
    assert.equal(f.actor.weaponReadyTimer, .3); assert.equal(f.actor.swapLockoutTimer, .4);
    assert.ok(f.actor.pos.z > 0); assert.equal(f.actor.weaponState, 'idle');
  });
  test(`current lockout refuses a swap despite the retained unlocked observation: ${id}`, () => {
    const f = fixture(id); opportunity(f); f.actor.swapLockoutTimer = .5;
    f.request.memory.aiState = 'APPROACHING'; f.request.policy.feintChance = 1;
    let feints = 0; f.request.policy.tryFeintRoll = scale => scale === .5; f.request.policy.commitFeint = () => { feints++; };
    const result = f.step().actorDecisionFrame!.decisions[0].ground!;
    assert.equal(f.actor.weapon, 'hammer'); assert.equal(feints, 1); assert.deepEqual(result.actions, []);
    assert.equal(f.actor.swapLockoutTimer, .5 - 1 / 60);
  });
  test(`lunge fakeout passes its new state and speed to the FSM: ${id}`, () => {
    const f = fixture(id); opportunity(f); f.actor.weapon = f.request.policy.activeWeapon = 'sword';
    f.request.policy.feintChance = 1; f.request.policy.random = () => 0;
    f.request.policy.tryFeintRoll = scale => scale === .55;
    const result = f.step().actorDecisionFrame!.decisions[0].ground!;
    assert.equal(result.opportunity!.feintLungeFakeout, true); assert.equal(f.actor.isLunging, false);
    assert.ok(Math.abs(f.actor.pos.z - 6.2 * f.state.settings.speedForward / 100 / 60) < 1e-10);
  });
  test(`ground opportunity uses effective step settings: ${id}`, () => {
    const f = fixture(id); opportunity(f).enemyInKillRange = true;
    const settings = { ...f.state.settings, hammerSlamWindupTime: .9 };
    f.decision.ground!.resolve = ({ state }) => { assert.equal(state.settings, settings); return f.request; };
    stepSimulation(f.state, {}, { settings, scriptedActorDecisions: f.owner });
    assert.equal(f.actor.weaponState, 'windup'); assert.ok(f.actor.weaponTimer > .8);
  });
}
for (const [name, mutate] of [
  ['nonfinite range', (o: NonNullable<ScriptedAIGroundRequest['opportunity']>) => { o.lungeDistanceToTarget = NaN; }],
  ['missing model owner', (o: NonNullable<ScriptedAIGroundRequest['opportunity']>) => { o.getTargetPlayerModel = undefined as never; }],
  ['bad readiness flag', (o: NonNullable<ScriptedAIGroundRequest['opportunity']>) => { o.selfGrounded = 1 as never; }],
  ['bad tuning', (o: NonNullable<ScriptedAIGroundRequest['opportunity']>) => { o.tuning.lungeChanceGroundBase = Infinity; }],
] as const) test(`ground opportunity rejects ${name} before effects`, () => {
  const f = fixture(); mutate(opportunity(f)); assert.throws(f.step, /ground opportunity/);
  assert.equal(f.draws(), 0); assert.equal(f.actor.weaponState, 'idle');
});
for (const id of ['main_ai', 'ordinary']) for (const prefix of [false, true]) test(`ground lunge intent clocks advance once ${id}/${prefix}`, () => {
  const f = fixture(id); opportunity(f); f.actor.weapon = f.request.policy.activeWeapon = 'sword';
  f.request.policy.random = () => 0; f.actor.hammerJumpWindowTimer = .7;
  if (prefix) { f.decision.commandVersion = 'scripted-combat-v6'; f.decision.commands = [{ kind: 'swap', weapon: 'sword' }]; }
  f.step(); assert.equal(f.actor.hammerJumpWindowTimer, .7 - 1 / 60); assert.equal(f.actor.lungeTimer, 0);
});
