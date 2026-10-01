import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation, SIM_DT as dt } from './step';
import { resolveSimGrifballGroundAttackInput } from './grifballGroundAttackInput';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { ScriptedActorDecisionOwner } from './scriptedActorDecision';

for (const reverse of [false, true]) for (const stepDt of [1 / 30, 1 / 60])
  test(`turn completion memory and checkpoints preserve roster ordering: ${reverse}/${stepDt}`, () => {
    const f = fixture(); if (reverse) f.state.combatants.splice(0, 2, f.second, f.first);
    type Memory = Record<string, { turns: number; priorTurns: number; z: number }>;
    let state = f.state, restored = structuredClone(state);
    let memory: Memory = {}, restoredMemory: Memory = {};
    const run = (current: typeof state, owned: Memory) => {
      const order = current.combatants.filter(c => c.controller === 'ai').map(c => c.id), calls: string[] = [];
      const owner: ScriptedActorDecisionOwner = { ...f.owner,
        beginTurn: ({ actorId }) => { calls.push(`begin:${actorId}`); },
        resolve: ({ actorId }) => {
          calls.push(`resolve:${actorId}`);
          const prior = order.indexOf(actorId) === 1 ? order[0] : undefined;
          if (prior) assert.equal(owned[prior].turns, current.tick + 1, 'earlier completion must be adopted before later resolve');
          return { kind: 'handled', action: idleAction(), movement: { x: 0, z: prior ? .5 : 1 } };
        },
        completeTurn: ({ actorId, state: view, dt: actualDt, record }) => {
          calls.push(`complete:${actorId}`);
          assert.equal(actualDt, stepDt); assert.equal(view.tick, current.tick);
          assert.equal(record.id, actorId); assert.equal(record.kind, 'handled');
          const prior = order.indexOf(actorId) === 1 ? order[0] : undefined;
          owned[actorId] = { turns: (owned[actorId]?.turns ?? 0) + 1,
            priorTurns: prior ? owned[prior].turns : 0, z: view.combatants.find(c => c.id === actorId)!.pos.z };
        },
      };
      const events = stepSimulation(current, {}, { settings: current.settings, dt: stepDt, scriptedActorDecisions: owner });
      assert.deepEqual(calls, order.flatMap(id => [`begin:${id}`, `resolve:${id}`, `complete:${id}`]));
      return events;
    };
    for (let frame = 0; frame < 60; frame++) {
      assert.deepEqual(run(state, memory), run(restored, restoredMemory));
      assert.deepEqual(state, restored); assert.deepEqual(memory, restoredMemory);
      if ([1, 20, 45].includes(frame)) { restored = structuredClone(restored); restoredMemory = structuredClone(restoredMemory); }
    }
  });

for (const branch of ['handoff', 'handled', 'command-lunge', 'existing-flight', 'air-recovery', 'dash'] as const)
  test(`turn completion observes ${branch} before later actor and animation`, () => {
    const f = fixture(), calls: string[] = [], settings = { ...f.state.settings, speedForward: 51 };
    f.owner.prepare = ({ actorId }) => actorId === 'ordinary' && ['air-recovery', 'dash'].includes(branch) ? 'engagement' : 'default';
    if (branch === 'command-lunge' || branch === 'existing-flight') {
      f.first.weapon = 'sword'; f.second.team = 'red'; f.second.pos = { x: 0, y: 0, z: 8 };
      if (branch === 'existing-flight') {
        f.first.isLunging = true; f.first.lungeTargetId = f.second.id; f.first.lungeDir = { x: 0, y: 0, z: 1 };
        f.first.lungeStartPos = { ...f.first.pos };
      }
    }
    if (branch === 'air-recovery') { f.first.pos.y = 2; f.first.isJumping = true; f.first.vel.y = -1; }
    if (branch === 'dash') { f.first.dashRemaining = .01; f.first.dashDir = { x: 1, y: 0, z: 0 }; }
    f.owner.resolve = ({ actorId }) => {
      if (actorId === 'main_ai') {
        assert.deepEqual(calls, ['ordinary'], 'earlier turn must have completed');
        return { kind: 'handoff', reason: 'observe prior memory' };
      }
      if (branch === 'handoff' || branch === 'existing-flight') return { kind: 'handoff', reason: 'fallback or committed motion' };
      return { kind: 'handled', action: { ...idleAction(), attackPrimary: branch === 'handled' },
        ...(branch === 'command-lunge' ? { commands: [{ kind: 'lunge' as const, targetId: f.second.id, direction: { x: 0, y: 0, z: 1 } }] } : {}),
        ...(branch === 'dash' ? { dash: { version: 'scripted-ai-dash-v1' as const, aiState: 'SIDE_STEPPING' as const, pendingPostEvasionCharge: true,
          target: { targetWeaponState: 'recovering' as const, attackDistanceToTarget: 2, resolvedAiReach: 3, spatialIQ: 80, targetProtected: false, weaponReady: true } } } : {}) };
    };
    f.owner.completeTurn = ({ state, actorId, record, dt: actualDt }) => {
      assert.equal(state.settings, settings); assert.equal(actualDt, dt); assert.equal(state.tick, 0);
      assert.equal(actorId, record.id); calls.push(actorId);
      if (actorId !== 'ordinary') return;
      if (branch === 'handled') { assert.equal(f.first.weaponState, 'windup'); assert.equal(f.first.weaponPhaseElapsed, 0); }
      if (branch === 'command-lunge') { assert.equal(f.first.isLunging, true); assert.equal(f.first.lungeTimer, 0); assert.equal(f.first.pos.z, 0); }
      if (branch === 'existing-flight') { assert.ok(f.first.pos.z > 0); assert.equal(f.first.lungeTimer, dt); }
      if (branch === 'air-recovery') assert.ok(f.first.pos.y < 2);
      if (branch === 'dash') {
        assert.equal(f.first.dashRemaining, 0);
        assert.deepEqual(record.dash, { aiState: 'CHARGE_ATTACK', pendingPostEvasionCharge: false });
      }
    };
    stepSimulation(f.state, {}, { settings, scriptedActorDecisions: f.owner });
    assert.deepEqual(calls, ['ordinary', 'main_ai']); assert.notEqual(f.state.settings, settings);
  });

for (const phase of ['countdown', 'scored', 'matchEnd', 'dead', 'unowned'] as const)
  test(`turn completion excludes ${phase} actors`, () => {
    const f = fixture();
    if (phase === 'dead') for (const c of [f.first, f.second]) { c.alive = false; c.hp = 0; c.respawnTimer = 10; }
    else if (phase === 'unowned') f.owner.scriptedBots = {};
    else f.state.match.phase = phase;
    f.owner.completeTurn = () => assert.fail('inactive actor cannot complete');
    stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  });

test('turn completion includes objective ownership before the next beginTurn', () => {
  const f = fixture(), completed: string[] = [];
  f.first.pos.x = -15; f.second.pos.x = 15;
  f.owner.resolve = () => assert.fail('objective must own these turns');
  f.owner.beginTurn = ({ actorId }) => { if (actorId === 'main_ai') assert.deepEqual(completed, ['ordinary']); };
  f.owner.completeTurn = ({ actorId, record }) => { assert.equal(record.kind, 'objective'); completed.push(actorId); };
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner,
    scriptedPlanner: { version: 'scripted-objective-planner-v1', scriptedBots: f.owner.scriptedBots, plan: createGrifballTeamPlanState() } });
  assert.deepEqual(completed, ['ordinary', 'main_ai']);
});

test('invalid completion callback rejects before frame mutation', () => {
  const f = fixture(); f.owner.completeTurn = null as never; const before = structuredClone(f.state);
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /complete-turn callback/);
  assert.deepEqual(f.state, before);
});

test('failed decision never completes and completion errors stop later actors without rollback', () => {
  for (const failAt of ['resolve', 'complete'] as const) {
    const f = fixture(), calls: string[] = [];
    f.owner.resolve = ({ actorId }) => {
      assert.equal(actorId, 'ordinary');
      if (failAt === 'resolve') throw new Error('decision failed');
      return { kind: 'handled', action: { ...idleAction(), attackPrimary: true } };
    };
    f.owner.completeTurn = ({ actorId }) => { calls.push(actorId); throw new Error('completion failed'); };
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /failed/);
    assert.deepEqual(calls, failAt === 'resolve' ? [] : ['ordinary']);
    assert.equal(f.first.weaponState, failAt === 'resolve' ? 'idle' : 'windup'); assert.equal(f.state.tick, 0);
    assert.equal(f.second.weaponState, 'idle');
  }
});

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
  assert.throws(() => stepSimulation(f.state, { ordinary: { ...idleAction(), dash: true } },
    { settings: f.state.settings, scriptedActorDecisions: f.owner }), /scripted AI dash owner/);
  f.owner.resolve = () => ({ kind: 'handled', action: { ...idleAction(), dash: true } });
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /scripted AI dash owner/);
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

for (const defect of ['version', 'kind', 'direction', 'zero', 'length', 'nonfinite', 'phase', 'flight', 'dash-active', 'slide-active',
  'jump', 'dash', 'attack', 'swap', 'move', 'objective', 'commands', 'pickup', 'pass'])
  test(`emergency hop rejects unsupported ${defect}`, () => {
    const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => defect === 'phase' ? 'default' : 'engagement';
    if (defect === 'flight') f.first.isLunging = true;
    if (defect === 'dash-active') f.first.dashRemaining = .2;
    if (defect === 'slide-active') f.first.slideActive = true;
    f.owner.resolve = () => {
      const decision: any = { kind: 'handled', action: idleAction(), mobility: {
        version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: 1, z: 0 } } };
      if (defect === 'version') decision.mobility.version = 'invalid';
      if (defect === 'kind') decision.mobility.kind = 'dash';
      if (defect === 'direction') decision.mobility.direction = null;
      if (defect === 'zero') decision.mobility.direction.x = 0;
      if (defect === 'length') decision.mobility.direction.x = 2;
      if (defect === 'nonfinite') decision.mobility.direction.x = NaN;
      if (defect === 'jump') decision.action.jump = true;
      if (defect === 'dash') decision.action.dash = true;
      if (defect === 'attack') decision.action.attackPrimary = true;
      if (defect === 'swap') decision.action.swapWeapon = true;
      if (defect === 'move') decision.action.moveX = 1;
      if (defect === 'pickup') decision.action.pickup = true;
      if (defect === 'pass') decision.action.passCharge = .5;
      if (defect === 'objective') decision.movement = { x: 0, z: 0 };
      if (defect === 'commands') decision.commands = [{ kind: 'melee', weapon: 'hammer', swipe: false }];
      return decision;
    };
    const before = { ...f.first.pos };
    assert.throws(() => stepSimulation(f.state, {}, { scriptedActorDecisions: f.owner }), /AI mobility|AI dash/);
    assert.deepEqual(f.first.pos, before, 'invalid command must not actuate the hop');
    assert.equal(f.first.isJumping, false);
  });

test('emergency hop execution preserves the validated packet and does not consume simulation RNG', () => {
  const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => 'engagement';
  const decision = { kind: 'handled' as const, action: idleAction(), mobility: {
    version: 'scripted-ai-mobility-v1' as const, kind: 'emergency-hop' as const, direction: { x: 1, z: 0 } } };
  const before = structuredClone(decision), rng = f.state.rngState;
  f.owner.resolve = () => decision;
  const events = stepSimulation(f.state, {}, { scriptedActorDecisions: f.owner });
  assert.deepEqual(decision, before); assert.equal(f.state.rngState, rng);
  assert.equal(events.actorDecisionFrame!.decisions[0].mobility, 'emergency-hop');
  assert.equal(f.first.pos.x, 7.5 * dt); assert.equal(f.first.pos.y, 5.5 * dt);
  assert.equal(f.first.vel.x, 7.5 * (1 - 5 * dt)); assert.ok(f.first.isJumping);
});

for (const id of ['ordinary', 'main_ai']) for (const reason of ['eligible', 'target-ready', 'protected', 'far', 'low-iq', 'unready', 'no-intent', 'new-window'])
  test(`dash completion uses current observations and clears intent: ${id}/${reason}`, () => {
    const f = fixture(); f.owner.scriptedBots = { [id]: 'normal' }; f.owner.prepare = () => 'engagement';
    const actor = f.state.combatants.find(c => c.id === id)!, target = id === 'ordinary' ? f.second : f.first;
    actor.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 0, y: 0, z: 2 }; target.team = 'red'; actor.team = 'blue';
    f.state.settings.dashDistance = .3; f.state.settings.dashDuration = 2.5 * dt;
    actor.dashDir = { x: 1, y: 0, z: 0 }; actor.dashRemaining = f.state.settings.dashDuration;
    actor.slideActive = true; actor.isSprinting = true;
    let memory = { aiState: 'SIDE_STEPPING' as import('../types').AIBehaviorState | undefined, pendingPostEvasionCharge: reason !== 'no-intent' };
    let last: typeof memory | undefined;
    for (let tick = 1; tick <= 3; tick++) {
      const final = tick === 3;
      target.weaponState = reason === 'new-window' && !final || reason === 'target-ready' && final ? 'idle' : 'recovering';
      target.weaponTimer = 100;
      target.invulnerabilityTimer = reason === 'protected' && final ? 1 : 0;
      target.pos.z = reason === 'far' && final ? 12 : 2;
      f.owner.resolve = ({ state }) => {
        const own = state.combatants.find(c => c.id === id)!, enemy = state.combatants.find(c => c.id === target.id)!;
        return { kind: 'handled', action: { ...idleAction(), aim: own.yaw }, dash: { version: 'scripted-ai-dash-v1', ...memory,
          target: { targetWeaponState: enemy.weaponState === 'recovering' ? 'recovering' : 'ready',
            attackDistanceToTarget: Math.hypot(enemy.pos.x - own.pos.x, enemy.pos.z - own.pos.z), resolvedAiReach: 3,
            targetProtected: enemy.invulnerabilityTimer > 0, spatialIQ: reason === 'low-iq' && final ? 34 : 80,
            weaponReady: !(reason === 'unready' && final) } } };
      };
      const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
      last = event.actorDecisionFrame!.decisions[0].dash!; assert.ok(last);
      memory = { ...last };
      assert.equal(actor.slideActive, false); assert.equal(actor.isSprinting, false);
      if (!final) { assert.equal(memory.aiState, 'SIDE_STEPPING'); assert.equal(memory.pendingPostEvasionCharge, reason !== 'no-intent'); }
    }
    assert.equal(actor.dashRemaining, 0); assert.equal(last!.pendingPostEvasionCharge, false);
    assert.equal(last!.aiState, reason === 'eligible' || reason === 'new-window' ? 'CHARGE_ATTACK' : 'SIDE_STEPPING');
    assert.ok(Math.abs(actor.pos.x - .36) < 1e-10, 'the final partial timer still executes a full live movement frame');
    assert.ok(Math.abs(actor.slideCooldownTimer - (f.state.settings.slideCooldown - 2 * dt)) < 1e-10, 'slide cancellation clock ticks once per following engagement');
  });

for (const defect of ['missing', 'handoff', 'version', 'state', 'pending', 'target', 'distance', 'reach', 'iq', 'protection', 'readiness', 'action', 'restart', 'cooldown', 'old-mobility-version', 'missing-start-observation', 'idle-with-dash', 'phase'])
  test(`dash contract rejects unsupported ${defect}`, () => {
    const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => defect === 'phase' ? 'default' : 'engagement';
    f.first.dashRemaining = .2; f.first.dashDir = { x: 1, y: 0, z: 0 };
    if (['old-mobility-version', 'missing-start-observation', 'idle-with-dash'].includes(defect)) f.first.dashRemaining = 0;
    if (defect === 'cooldown') { f.first.dashRemaining = 0; f.first.dashCooldownTimer = 1; }
    f.owner.resolve = () => {
      if (defect === 'handoff') return { kind: 'handoff', reason: 'dash still needs an owner' };
      const decision: any = { kind: 'handled', action: idleAction(), dash: { version: 'scripted-ai-dash-v1', aiState: 'SIDE_STEPPING',
        pendingPostEvasionCharge: true, target: { targetWeaponState: 'recovering', attackDistanceToTarget: 2, resolvedAiReach: 3,
          spatialIQ: 80, targetProtected: false, weaponReady: true } } };
      if (defect === 'missing') delete decision.dash;
      if (defect === 'version') decision.dash.version = 'bad';
      if (defect === 'state') decision.dash.aiState = 'bad';
      if (defect === 'pending') decision.dash.pendingPostEvasionCharge = 1;
      if (defect === 'target') decision.dash.target = null;
      if (defect === 'distance') decision.dash.target.attackDistanceToTarget = NaN;
      if (defect === 'reach') decision.dash.target.resolvedAiReach = -1;
      if (defect === 'iq') decision.dash.target.spatialIQ = Infinity;
      if (defect === 'protection') decision.dash.target.targetProtected = 1;
      if (defect === 'readiness') decision.dash.target.weaponReady = 'true';
      if (defect === 'action') decision.action.attackPrimary = true;
      if (defect === 'restart' || defect === 'cooldown') decision.mobility = { version: 'scripted-ai-mobility-v2', kind: 'spatial-dodge', direction: { x: 0, z: 1 } };
      if (defect === 'old-mobility-version' || defect === 'missing-start-observation') {
        decision.mobility = { version: defect === 'old-mobility-version' ? 'scripted-ai-mobility-v1' : 'scripted-ai-mobility-v2', kind: 'spatial-dodge', direction: { x: 1, z: 0 } };
        if (defect === 'missing-start-observation') delete decision.dash;
      }
      return decision;
    };
    const before = { ...f.first.pos }, remaining = f.first.dashRemaining;
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /AI dash|AI mobility/);
    assert.deepEqual(f.first.pos, before); assert.equal(f.first.dashRemaining, remaining);
  });

for (const version of ['scripted-combat-v1', 'scripted-combat-v2', 'scripted-combat-v3'] as const)
  test(`airborne melee requires prepared v3 ownership: ${version}`, () => {
    const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' };
    f.owner.prepare = () => version === 'scripted-combat-v3' ? 'default' : 'engagement';
    f.first.pos.y = 1; f.first.isJumping = true;
    f.owner.resolve = () => ({ kind: 'handled', action: idleAction(), commands: [{ kind: 'melee', weapon: 'hammer', swipe: false }], commandVersion: version });
    assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /grounded walker|prepared engagement/);
    assert.equal(f.first.weaponState, 'idle');
  });

for (const withDash of [false, true]) test(`v3 lunge cannot share evasion actuation: ${withDash}`, () => {
  const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => 'engagement';
  f.first.weapon = 'sword'; f.first.team = 'blue'; f.second.team = 'red';
  f.owner.resolve = () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v3',
    commands: [{ kind: 'lunge', targetId: f.second.id, direction: { x: 1, y: 0, z: 0 } }],
    mobility: withDash ? { version: 'scripted-ai-mobility-v2', kind: 'spatial-dodge', direction: { x: 1, z: 0 } }
      : { version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: 1, z: 0 } },
    ...(withDash ? { dash: { version: 'scripted-ai-dash-v1', aiState: 'APPROACHING', pendingPostEvasionCharge: false,
      target: { targetWeaponState: 'ready', attackDistanceToTarget: 10, resolvedAiReach: 3, spatialIQ: 80, targetProtected: false, weaponReady: true } } } : {}) });
  const before = { ...f.first.pos };
  assert.throws(() => stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner }), /share an evasion movement owner/);
  assert.deepEqual(f.first.pos, before); assert.equal(f.first.isJumping, false); assert.equal(f.first.isLunging, false);
});

for (const unready of [false, true]) test(`v3 prefix, hop and melee preserve readiness and one clock tick: ${unready}`, () => {
  const f = fixture(); f.owner.prepare = ({ actorId }) => actorId === 'ordinary' ? 'engagement' : 'default';
  f.state.settings.weaponReadyTime = 0; f.first.weapon = 'sword'; f.first.weaponState = 'recovering'; f.first.attackKind = 'slash';
  f.first.weaponTimer = 1; f.first.attackCooldown = 3 * dt; f.first.hammerJumpWindowTimer = 4 * dt;
  f.first.weaponReadyTimer = unready ? 3 * dt : 0;
  const changes: { weapon: string; x: number; y: number }[] = []; let physicalWeapon = f.first.weapon;
  Object.defineProperty(f.first, 'weapon', { enumerable: true, configurable: true, get: () => physicalWeapon,
    set: value => { changes.push({ weapon: value, x: f.first.pos.x, y: f.first.pos.y }); physicalWeapon = value; } });
  f.owner.resolve = ({ state, actorId }) => {
    if (actorId === 'main_ai') {
      const prior = state.combatants.find(c => c.id === 'ordinary')!;
      assert.equal(prior.weaponState, unready ? 'recovering' : 'windup'); assert.ok(prior.isJumping);
      assert.ok(Math.abs(prior.pos.x - 7.5 * dt) < 1e-10, 'later actor sees the hop and counter commit');
      return { kind: 'handoff', reason: 'observation-only actor' };
    }
    return { kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v3',
      commands: [{ kind: 'revert-weapon-feint' }, { kind: 'swap', weapon: 'sword' }, { kind: 'melee', weapon: 'sword', swipe: false }],
      mobility: { version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: 1, z: 0 } } };
  };
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.deepEqual(changes, [{ weapon: 'hammer', x: 0, y: 0 }, { weapon: 'sword', x: 0, y: 0 }], 'prefixes execute before hop displacement');
  assert.equal(f.first.weaponReadyTimer, unready ? 3 * dt - dt : 0);
  assert.ok(Math.abs(f.first.hammerJumpWindowTimer - 3 * dt) < 1e-10, 'weapon intent clocks advance once');
  if (!unready) { assert.equal(f.first.attackKind, 'slash'); assert.equal(f.first.weaponPhaseElapsed, dt); }
});

for (const committed of ['windup', 'active'] as const) test(`v3 moving melee cannot restart a committed ${committed}`, () => {
  const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => 'engagement';
  f.first.weaponState = committed; f.first.weaponPhaseElapsed = .01; f.first.attackKind = 'strike';
  f.owner.resolve = () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v3',
    commands: [{ kind: 'melee', weapon: 'hammer', swipe: false }], mobility: { version: 'scripted-ai-mobility-v1', kind: 'emergency-hop', direction: { x: 1, z: 0 } } });
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.equal(f.first.weaponState, committed); assert.equal(f.first.weaponPhaseElapsed, .01 + dt); assert.ok(f.first.isJumping);
});

test('a counter committed before a later lethal flight cannot deal posthumous melee damage', () => {
  const f = fixture(); f.owner.scriptedBots = { ordinary: 'normal' }; f.owner.prepare = () => 'engagement';
  f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = false;
  f.first.team = 'blue'; f.first.hp = 1; f.second.team = 'red'; f.second.hp = f.second.maxHp = 20;
  f.second.pos = { x: 0, y: 0, z: 1.7 }; f.second.weapon = 'sword'; f.second.isLunging = true;
  f.second.lungeDir = { x: 0, y: 0, z: -1 }; f.second.lungeTargetId = f.first.id; f.second.lungeStartPos = { ...f.second.pos };
  f.owner.resolve = () => ({ kind: 'handled', action: idleAction(), commandVersion: 'scripted-combat-v3',
    commands: [{ kind: 'melee', weapon: 'hammer', swipe: false }] });
  const events = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedActorDecisions: f.owner });
  assert.equal(events.actorDecisionFrame!.decisions[0].kind, 'handled'); assert.equal(f.first.alive, false);
  assert.equal(events.kills[0].victimId, f.first.id); assert.equal(f.first.weaponState, 'idle');
  for (let tick = 0; tick < 20; tick++) stepSimulation(f.state, {}, { settings: f.state.settings });
  assert.equal(f.second.hp, 20);
});
