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
