import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation, SIM_DT as dt } from './step';
import { resolveSimGrifballGroundAttackInput } from './grifballGroundAttackInput';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { ScriptedActorDecisionOwner } from './scriptedActorDecision';

function fixture() {
  const state = createMatch({ seed: 1, combatExecution: 'live-mixed-v1', teamSizes: { blue: 2, red: 1 }, settings: { aiDifficulty: 'normal' } });
  const [first, second, player] = state.combatants; state.localPlayerId = player.id = 'player'; player.controller = 'remote';
  first.id = 'ordinary'; second.id = 'main_ai'; first.controller = second.controller = 'ai';
  state.match.phase = 'playing';
  for (const [i, c] of [first, second, player].entries()) {
    c.pos = { x: i * 10, y: 0, z: 0 }; c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
  }
  const owner: ScriptedActorDecisionOwner = { version: 'scripted-actor-decision-v1', scriptedBots: { ordinary: 'normal', main_ai: 'normal' },
    resolve: () => ({ kind: 'handoff', reason: 'unowned combat movement' }) };
  return { state, first, second, player, owner };
}

for (const reverse of [false, true]) test(`later decisions observe earlier commitments and current own clocks: ${reverse}`, () => {
  const f = fixture(); if (reverse) f.state.combatants.splice(0, 2, f.second, f.first);
  const order = f.state.combatants.filter(c => c !== f.player), calls: string[] = [];
  for (const c of order) { c.weaponReadyTimer = dt / 2; c.swapLockoutTimer = dt / 2; c.invulnerabilityTimer = dt * 2; c.dashCooldownTimer = dt * 2; }
  f.owner.resolve = ({ state, actorId, clockPhase }) => {
    const self = state.combatants.find(c => c.id === actorId)!;
    assert.equal(clockPhase, 'after-swap-tick'); assert.equal(self.weaponReadyTimer, 0); assert.equal(self.swapLockoutTimer, 0);
    assert.equal(self.invulnerabilityTimer, dt); assert.equal(self.dashCooldownTimer, dt);
    if (calls.length) { assert.equal(order[0].weaponState, 'windup'); assert.equal(order[0].weaponPhaseElapsed, 0, 'melee animation waits until after all decisions'); }
    else assert.equal(order[1].invulnerabilityTimer, 2 * dt, 'later shield has not ticked');
    calls.push(actorId);
    const input = resolveSimGrifballGroundAttackInput(state, actorId, f.owner.scriptedBots,
      { enemyInKillRange: true, aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 }, dt, clockPhase)!;
    assert.ok(input);
    return { kind: 'handled', action: input.action, movement: input.scriptedObjective.movement[actorId] };
  };
  const result = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.deepEqual(calls, order.map(c => c.id)); assert.ok(result.actorDecisionFrame!.decisions.every(d => d.kind === 'handled'));
  for (const c of order) { assert.equal(c.dashCooldownTimer, dt); assert.equal(c.invulnerabilityTimer, dt); assert.equal(c.weaponPhaseElapsed, dt); }
});

for (const id of ['ordinary', 'main_ai']) test(`ground policy does not spend an advanced readiness clock twice: ${id}`, () => {
  const f = fixture(), self = f.state.combatants.find(c => c.id === id)!;
  self.weaponReadyTimer = dt * 1.5; f.owner.scriptedBots = { [id]: 'normal' };
  f.owner.resolve = ({ state, actorId, clockPhase }) => {
    const input = resolveSimGrifballGroundAttackInput(state, actorId, f.owner.scriptedBots,
      { enemyInKillRange: true, aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 }, dt, clockPhase);
    return input ? { kind: 'handled', action: input.action } : { kind: 'handoff', reason: 'not ready' };
  };
  assert.equal(stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }).actorDecisionFrame!.decisions[0].kind, 'handoff');
  assert.equal(self.weaponState, 'idle');
  assert.equal(stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }).actorDecisionFrame!.decisions[0].kind, 'handled');
  assert.equal(self.weaponState, 'windup');
});

for (const phase of ['countdown', 'scored', 'matchEnd'] as const) test(`inactive ${phase} never invokes decision memory owner`, () => {
  const f = fixture(); f.state.match.phase = phase; f.state.match.phaseTimer = 0;
  f.owner.prepare = () => assert.fail('inactive preparation must not run');
  f.owner.resolve = () => assert.fail('inactive policy must not run');
  f.first.dashCooldownTimer = 1; f.first.invulnerabilityTimer = 1;
  const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.ok(event.actorDecisionFrame!.decisions.every(d => d.kind === 'inactive'));
  assert.equal(f.first.dashCooldownTimer, 1); assert.equal(f.first.invulnerabilityTimer, 1 - dt);
});

test('explicit handoff preserves fallback movement and leaves inputs unchanged', () => {
  const f = fixture(), before = f.first.pos.z, actions = { ordinary: { ...idleAction(), moveZ: 1 } }, copy = structuredClone(actions);
  const event = stepSimulation(f.state, actions, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.ok(f.first.pos.z > before); assert.deepEqual(actions, copy);
  assert.deepEqual(event.actorDecisionFrame!.decisions[0], { id: 'ordinary', kind: 'handoff', reason: 'unowned combat movement' });
});

test('objective planner has priority and shares the advanced clock boundary', () => {
  const f = fixture(); f.first.pos.x = -15; f.second.pos.x = 15;
  f.owner.prepare = () => assert.fail('handled objective must not run engagement preparation');
  f.owner.resolve = () => assert.fail('handled objective must not run combat fallback');
  const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner,
    scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owner.scriptedBots, plan: createGrifballTeamPlanState() } });
  assert.ok(event.actorDecisionFrame!.decisions.every(d => d.kind === 'objective'));
});

for (const defect of ['version', 'resolver', 'profile', 'mode', 'dt', 'local', 'remote', 'unknown', 'duplicate', 'neural', 'global-neural', 'effective-neural', 'authority-array', 'combat-packet', 'movement-packet'])
  test(`decision owner rejects ${defect} before engine mutation`, () => {
    const f = fixture(), owner = f.owner as any, settings = { ...f.state.settings };
    if (defect === 'version') owner.version = 'bad'; if (defect === 'resolver') owner.resolve = null;
    if (defect === 'profile') f.state.combatExecution = 'live-roster-v2'; if (defect === 'mode') f.state.mode = 'combat';
    if (defect === 'local') owner.scriptedBots.player = 'normal'; if (defect === 'remote') f.first.controller = 'remote';
    if (defect === 'unknown') owner.scriptedBots.absent = 'normal'; if (defect === 'duplicate') f.state.combatants.push(structuredClone(f.first));
    if (defect === 'neural') owner.scriptedBots.ordinary = 'neural-net'; if (defect === 'global-neural') f.state.settings.aiDifficulty = 'neural-net';
    if (defect === 'effective-neural') settings.aiDifficulty = 'neural-net'; if (defect === 'authority-array') owner.scriptedBots = [];
    const before = structuredClone(f.state);
    assert.throws(() => stepSimulation(f.state, {}, { settings, dt: defect === 'dt' ? NaN : dt, scriptedActorDecisions: owner,
      ...(defect === 'combat-packet' ? { scriptedCombat: { version: 'scripted-combat-v1' as const, scriptedBots: {}, commands: {} } } : {}),
      ...(defect === 'movement-packet' ? { scriptedObjective: { version: 'scripted-objective-v1' as const, scriptedBots: {}, movement: {} } } : {}),
    })); assert.deepEqual(f.state, before);
  });

for (const defect of ['kind', 'reason', 'aim', 'jump', 'pitch', 'movement', 'commands']) test(`invalid runtime ${defect} aborts before that actor's actuation`, () => {
  const f = fixture();
  f.owner.resolve = ({ actorId }) => {
    if (actorId === 'ordinary') return { kind: 'handled', action: { ...idleAction(), attackPrimary: true } };
    const decision: any = { kind: 'handled', action: idleAction() };
    if (defect === 'kind') decision.kind = 'invalid'; if (defect === 'reason') return { kind: 'handoff', reason: '' };
    if (defect === 'aim') decision.action.aim = NaN; if (defect === 'jump') decision.action.jump = 1;
    if (defect === 'pitch') decision.action.aimPitch = Infinity;
    if (defect === 'movement') decision.movement = { x: 2, z: 0 }; if (defect === 'commands') decision.commands = [{ kind: 'invalid' }];
    return decision;
  };
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }));
  assert.equal(f.first.weaponState, 'windup', 'prior actor has already committed; this is not an atomic frame');
  assert.equal(f.second.weaponState, 'idle'); assert.equal(f.state.tick, 0);
});

test('earlier lethal flight prevents the victim decision from running', () => {
  const f = fixture(); f.first.team = 'blue'; f.second.team = 'red';
  f.first.weapon = 'sword'; f.first.pos = { x: 0, y: 0, z: 0 }; f.second.pos = { x: 0, y: 0, z: 1.7 };
  f.first.isLunging = true; f.first.lungeTargetId = f.second.id; f.first.lungeDir = { x: 0, y: 0, z: 1 }; f.first.lungeStartPos = { ...f.first.pos };
  f.second.hp = 1; const calls: string[] = [];
  f.owner.resolve = ({ actorId }) => { calls.push(actorId); return { kind: 'handoff', reason: 'committed flight owns motion' }; };
  const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.deepEqual(calls, ['ordinary']); assert.equal(f.second.alive, false);
  assert.deepEqual(event.actorDecisionFrame!.decisions[1], { id: 'main_ai', kind: 'inactive' });
  assert.equal(event.kills[0].victimId, f.second.id);
});

test('revival happens before current-life decisions and exactly-once shield sampling', () => {
  const f = fixture(); f.first.alive = false; f.first.hp = 0; f.first.respawnTimer = dt / 2;
  f.first.aiHammerJumpCooldownTimer = 3;
  let observed = false;
  f.owner.resolve = ({ state, actorId }) => {
    if (actorId === 'ordinary') {
      const c = state.combatants.find(c => c.id === actorId)!;
      assert.ok(c.alive); assert.equal(c.hp, c.maxHp); assert.equal(c.respawnTimer, 0);
      assert.equal(c.aiHammerJumpCooldownTimer, 0, 'new life clears altitude recovery cooldown');
      assert.equal(c.invulnerabilityTimer, state.settings.respawnInvulnerabilityDuration - dt); observed = true;
    }
    return { kind: 'handoff', reason: 'revival memory remains external' };
  };
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.ok(observed); assert.equal(f.first.invulnerabilityTimer, f.state.settings.respawnInvulnerabilityDuration - dt);
});

test('later decision observes resolved earlier movement using effective settings', () => {
  const f = fixture(), settings = { ...f.state.settings, speedForward: 50 }, stored = structuredClone(f.state.settings);
  f.owner.resolve = ({ state, actorId }) => {
    assert.equal(state.settings.speedForward, 50);
    if (actorId === 'main_ai') assert.equal(state.combatants.find(c => c.id === 'ordinary')!.pos.z, 2.6 * dt);
    return { kind: 'handled', action: idleAction(), movement: { x: 0, z: 1 } };
  };
  stepSimulation(f.state, {}, { settings, scriptedActorDecisions: f.owner }); assert.deepEqual(f.state.settings, stored);
});

test('objective/combat difficulty conflicts reject before either owner runs', () => {
  const f = fixture(), before = structuredClone(f.state);
  f.owner.resolve = () => assert.fail('conflicting policy must not run');
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner,
    scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: { ordinary: 'hard' }, plan: createGrifballTeamPlanState() } }), /disagree/);
  assert.deepEqual(f.state, before);
});

test('scheduled sword secondary requires an explicit target-locked command', () => {
  const f = fixture(); f.first.weapon = 'sword'; f.owner.resolve = () => ({ kind: 'handled', action: { ...idleAction(), attackSecondary: true } });
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /target-locked/);
  assert.equal(f.first.isLunging, false);
});

test('empty and inherited decision ownership preserve ordinary execution', () => {
  for (const scriptedBots of [{}, Object.create({ ordinary: 'normal' })]) {
    const f = fixture(), plain = structuredClone(f.state); f.owner.scriptedBots = scriptedBots;
    f.owner.resolve = () => assert.fail('inherited owner must not run');
    const actions = { ordinary: { ...idleAction(), moveZ: 1, attackPrimary: true } };
    stepSimulation(plain, actions, { settings: plain.settings });
    const event = stepSimulation(f.state, actions, { settings: f.state.settings, scriptedActorDecisions: f.owner });
    assert.deepEqual(f.state, plain); assert.deepEqual(event.actorDecisionFrame!.decisions, []);
  }
});

for (const blocked of [false, true]) test(`scheduled lunge commit precedes walking; blocked=${blocked}`, () => {
  const f = fixture(); f.first.weapon = 'sword'; f.first.team = 'blue'; f.second.team = 'red';
  f.first.vel = { x: 1, y: 0, z: 2 }; f.second.pos = { x: 0, y: 0, z: 8 };
  f.first.weaponReadyTimer = blocked ? 1 : 0;
  f.owner.scriptedBots = { ordinary: 'normal' };
  f.owner.resolve = () => ({ kind: 'handled', action: { ...idleAction(), moveX: 1, aim: Math.PI / 2 },
    commands: [{ kind: 'lunge', targetId: f.second.id, direction: { x: 0, y: 0, z: 1 } }] });
  const before = structuredClone(f.first.pos);
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.equal(f.first.isLunging, !blocked); assert.equal(f.first.yaw, Math.PI / 2);
  if (blocked) assert.notDeepEqual(f.first.pos, before, 'rejected lunge still executes supplied movement');
  else { assert.deepEqual(f.first.pos, before); assert.deepEqual(f.first.vel, { x: 1, y: 0, z: 2 }); assert.equal(f.first.lungeTimer, 0); }
});

for (const invalid of [null, undefined, 'air', 1]) test(`invalid preparation result rejects before gravity: ${String(invalid)}`, () => {
  const f = fixture(); f.first.pos.y = 2; f.first.vel.y = -3; f.first.isJumping = true;
  f.owner.prepare = () => invalid as never;
  const before = structuredClone(f.first.pos);
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /Invalid actor preparation/);
  assert.deepEqual(f.first.pos, before);
});

test('invalid preparation configuration rejects before any frame changes', () => {
  const f = fixture(); f.owner.prepare = 1 as never; const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, {}, { scriptedActorDecisions: f.owner }), /preparation callback/);
  assert.deepEqual(f.state, before);
});

test('engagement preparation refuses carriers and generic player jump ownership', () => {
  const f = fixture(); f.owner.prepare = () => 'engagement'; f.first.hasBall = true;
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /Carrier movement/);
  f.first.hasBall = false; f.owner.resolve = () => ({ kind: 'handled', action: { ...idleAction(), jump: true } });
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /scripted AI jump owner/);
  f.owner.resolve = () => ({ kind: 'handoff', reason: 'fallback jump is also unowned' });
  assert.throws(() => stepSimulation(f.state, { ordinary: { ...idleAction(), jump: true } },
    { settings: f.state.settings, scriptedActorDecisions: f.owner }), /scripted AI jump owner/);
});

test('landing preparation permits the same-turn ground attack and advances recovery clocks once', () => {
  const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => 'engagement';
  f.first.pos = { x: 0, y: .01, z: 0 }; f.first.vel = { x: 0, y: -3, z: 0 }; f.first.isJumping = true;
  f.first.hammerJumpsInAir = 1; f.first.aiHammerJumpCooldownTimer = 2 * dt;
  f.second.team = 'red'; f.first.team = 'blue'; f.second.pos = { x: 0, y: 0, z: 2 };
  f.second.hp = f.second.maxHp = 20;
  f.owner.resolve = ({ state, actorId, clockPhase, motionPhase }) => {
    const actor = state.combatants.find(c => c.id === actorId)!;
    assert.equal(motionPhase, 'after-engagement-gravity'); assert.equal(actor.isJumping, false); assert.equal(actor.hammerJumpsInAir, 0);
    const input = resolveSimGrifballGroundAttackInput(state, actorId, f.owner.scriptedBots,
      { enemyInKillRange: true, aiState: 'APPROACHING', timer: 0, cooldownMultiplier: 1 }, dt, clockPhase);
    return input ? { kind: 'handled', action: input.action, movement: input.scriptedObjective.movement[actorId] }
      : { kind: 'handoff', reason: 'committed weapon recovery' };
  };
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.equal(f.first.weaponState, 'windup'); assert.equal(f.first.aiHammerJumpCooldownTimer, dt);
  for (let i = 0; i < 40; i++) stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.ok(f.second.hp < 20, 'landing-follow-up must produce real damage'); assert.equal(f.first.aiHammerJumpCooldownTimer, 0);
});
