import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { idleAction } from './actions';
import { stepSimulation, SIM_DT } from './step';
import { setSimCarrier } from './grifball';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, type ScriptedObjectivePlanner } from './scriptedObjectivePlanner';

function fixture() {
  const state = createMatch({ seed: 63, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 1 }, settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const [actor, other] = state.combatants;
  actor.id = 'walker'; actor.controller = 'ai'; other.controller = 'remote';
  actor.pos = { x: -10, y: 0, z: 0 }; other.pos = { x: 25, y: 0, z: 15 };
  actor.weaponReadyTimer = actor.invulnerabilityTimer = 0;
  const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION, scriptedBots: { walker: 'normal' }, plan: createGrifballTeamPlanState() };
  return { state, actor, other, planner };
}

for (const failure of ['version', 'legacy', 'combat', 'unknown', 'duplicate', 'remote', 'local', 'neural', 'global-neural',
  'effective-neural', 'readiness-type', 'readiness-owner', 'memory', 'dt', 'both-inputs'] as const)
  test(`scripted planner rejects ${failure} before state or plan mutation`, () => {
    const f = fixture(), settings = { ...f.state.settings };
    if (failure === 'version') (f.planner as { version: string }).version = 'unknown';
    if (failure === 'legacy') f.state.combatExecution = 'legacy-v1';
    if (failure === 'combat') f.state.mode = 'combat';
    if (failure === 'unknown') f.planner.scriptedBots = { absent: 'normal' };
    if (failure === 'duplicate') f.state.combatants.push(structuredClone(f.actor));
    if (failure === 'remote') f.actor.controller = 'remote';
    if (failure === 'local') f.state.localPlayerId = f.actor.id;
    if (failure === 'neural') f.planner.scriptedBots = { walker: 'neural-net' };
    if (failure === 'global-neural') f.state.settings.aiDifficulty = 'neural-net';
    if (failure === 'effective-neural') settings.aiDifficulty = 'neural-net';
    if (failure === 'readiness-type') f.planner.weaponReady = { walker: 'yes' as unknown as boolean };
    if (failure === 'readiness-owner') f.planner.weaponReady = { absent: true };
    if (failure === 'memory') f.planner.plan.assignments = {} as typeof f.planner.plan.assignments;
    const before = structuredClone(f.state), plan = structuredClone(f.planner.plan);
    assert.throws(() => stepSimulation(f.state, {}, { settings, scriptedPlanner: f.planner,
      dt: failure === 'dt' ? NaN : SIM_DT,
      ...(failure === 'both-inputs' ? { scriptedObjective: { version: 'scripted-objective-v1' as const, scriptedBots: {}, movement: {} } } : {}) }));
    assert.deepEqual(f.state, before); assert.deepEqual(f.planner.plan, plan);
  });

test('planner observes a newly revived actor before choosing its movement', () => {
  const f = fixture(); f.actor.alive = false; f.actor.hp = 0; f.actor.respawnTimer = SIM_DT / 2;
  const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedPlanner: f.planner });
  assert.ok(f.actor.alive);
  assert.ok(f.planner.plan.snapshot!.players.some(p => p.id === f.actor.id));
  assert.ok(!f.planner.plan.snapshot!.respawns!.some(p => p.id === f.actor.id));
  assert.equal(event.plannerFrame!.decisions[0].kind, 'support');
  assert.ok(Math.hypot(f.actor.vel.x, f.actor.vel.z) > 0);
});

test('mixed local input executes before the planner snapshot and stays outside scripted ownership', () => {
  const f = fixture(); f.state.combatExecution = 'live-mixed-v1'; f.state.localPlayerId = f.other.id;
  const before = f.other.pos.z;
  const event = stepSimulation(f.state, { [f.other.id]: { ...idleAction(), moveZ: 1 } }, { settings: f.state.settings, scriptedPlanner: f.planner });
  assert.ok(f.other.pos.z > before);
  assert.equal(f.planner.plan.snapshot!.players.find(p => p.id === f.other.id)!.pos.z, f.other.pos.z);
  assert.deepEqual(event.plannerFrame!.decisions.map(d => d.id), [f.actor.id]);
});

test('effective settings apply consistently to observations and generated movement without changing stored settings', () => {
  const f = fixture(), settings = { ...f.state.settings, speedForward: 50 }, stored = structuredClone(f.state.settings);
  stepSimulation(f.state, {}, { settings, scriptedPlanner: f.planner });
  assert.equal(f.actor.vel.x, 2.6); assert.equal(f.planner.plan.snapshot!.players.find(p => p.id === f.actor.id)!.space!.speed, 2.6);
  assert.deepEqual(f.state.settings, stored);
});

test('inactive planned actors do not execute fallback movement, attack or pickup', () => {
  const f = fixture(); f.state.match.phase = 'countdown'; f.state.match.phaseTimer = 1;
  const before = { ...f.actor.pos };
  const event = stepSimulation(f.state, { walker: { ...idleAction(), moveZ: 1, attackPrimary: true, pickup: true } }, { settings: f.state.settings, scriptedPlanner: f.planner });
  assert.deepEqual(f.actor.pos, before); assert.equal(f.actor.weaponState, 'idle');
  assert.deepEqual(event.plannerFrame!.decisions, [{ id: 'walker', kind: 'inactive' }]);
});

test('pausing objective decisions does not freeze an already committed roster animation', () => {
  const f = fixture(); f.state.match.phase = 'countdown'; f.state.match.phaseTimer = 1;
  f.actor.weapon = 'sword'; f.actor.attackKind = 'slash'; f.actor.weaponState = 'windup';
  f.actor.weaponTimer = .22; f.actor.weaponPhaseElapsed = 0;
  const ordinary = structuredClone(f.state);
  stepSimulation(f.state, {}, { settings: f.state.settings, scriptedPlanner: f.planner });
  stepSimulation(ordinary, {}, { settings: ordinary.settings });
  assert.ok(ordinary.combatants[0].weaponPhaseElapsed! > 0);
  assert.equal(f.actor.weaponState, ordinary.combatants[0].weaponState);
  assert.equal(f.actor.weaponPhaseElapsed, ordinary.combatants[0].weaponPhaseElapsed);
  assert.equal(f.actor.weaponTimer, ordinary.combatants[0].weaponTimer);
});

test('missing readiness and punch decisions are explicit handoffs, preserving separately supplied fallback input', () => {
  const f = fixture(); setSimCarrier(f.actor, true, f.state.settings);
  f.state.match.ball.state = 'held'; f.state.match.ball.holderId = f.actor.id;
  f.other.pos = { x: -9, y: 0, z: 0 };
  const missing = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedPlanner: f.planner });
  assert.deepEqual(missing.plannerFrame!.decisions, [{ id: 'walker', kind: 'handoff', reason: 'carrier-readiness-missing' }]);
  f.planner.weaponReady = { walker: true };
  const actions = { walker: { ...idleAction(), attackPrimary: true, aim: Math.PI / 2 } }, before = structuredClone(actions);
  const punch = stepSimulation(f.state, actions, { settings: f.state.settings, scriptedPlanner: f.planner });
  assert.deepEqual(punch.plannerFrame!.decisions, [{ id: 'walker', kind: 'handoff', reason: 'punch' }]);
  assert.equal(f.actor.attackKind, 'punch'); assert.deepEqual(actions, before);
});

test('inherited ownership does not issue decisions and omitted planning retains ordinary input', () => {
  const f = fixture(), baseline = structuredClone(f.state);
  f.planner.scriptedBots = Object.create({ walker: 'normal' });
  const actions = { walker: { ...idleAction(), moveZ: 1 } };
  const event = stepSimulation(f.state, actions, { settings: f.state.settings, scriptedPlanner: f.planner });
  const plain = stepSimulation(baseline, actions, { settings: baseline.settings });
  assert.deepEqual(event.plannerFrame!.decisions, []); assert.equal(plain.plannerFrame, undefined);
  assert.deepEqual(f.state, baseline);
});

test('recorded ground commands reproduce the same independent simulator continuation', () => {
  const f = fixture(), replay = JSON.parse(JSON.stringify(f.state));
  for (let tick = 0; tick < 60; tick++) {
    const event = stepSimulation(f.state, {}, { settings: f.state.settings, scriptedPlanner: f.planner });
    const frame = JSON.parse(JSON.stringify(event.plannerFrame!));
    assert.ok(frame.decisions.every((d: any) => d.kind === 'support'));
    stepSimulation(replay, Object.fromEntries(frame.decisions.map((d: any) => [d.id, d.action])), { settings: replay.settings,
      scriptedObjective: { version: 'scripted-objective-v1', scriptedBots: f.planner.scriptedBots,
        movement: Object.fromEntries(frame.decisions.map((d: any) => [d.id, d.movement])) } });
    assert.deepEqual(f.state, replay);
  }
});
