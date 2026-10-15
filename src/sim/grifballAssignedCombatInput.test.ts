import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from './factory';
import { createGrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from './grifballTacticalAdapter';
import { resolveSimGrifballAssignedCombatInput } from './grifballAssignedCombatInput';

const tuning = { effectiveReactionLatency: .1, tunedAnticipationFactor: .5, movementComplexity: 80, playstyleFactor: .5 };
const memory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
function fixture() {
  const state = createMatch({ seed: 33, combatExecution: 'live-roster-v2', teamSizes: { blue: 1, red: 2 }, settings: { aiDifficulty: 'normal' } });
  state.match.phase = 'playing';
  const [self, target, other] = state.combatants;
  target.team = other.team = self.team === 'blue' ? 'red' : 'blue';
  self.controller = 'ai'; self.weapon = 'sword'; self.weaponReadyTimer = 0;
  self.pos = { x: 0, y: 0, z: 0 }; target.pos = { x: 2, y: 0, z: 0 }; other.pos = { x: 0, y: 0, z: 6 };
  for (const c of state.combatants) { c.invulnerabilityTimer = 0; c.vel = { x: 0, y: 0, z: 0 }; }
  const owners = { [self.id]: 'normal' }, plan = createGrifballTeamPlanState();
  plan.snapshot = createSimGrifballTacticalSnapshot(state, { scriptedBots: owners });
  plan.assignments.set(self.id, { botId: self.id, team: self.team, role: 'lead', slot: 0,
    destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, carrierId: null, reason: 'Ground-combat boundary' });
  const read = () => resolveSimGrifballAssignedCombatInput(state, plan, self.id, owners, tuning, memory);
  return { state, self, target, other, owners, plan, read };
}

test('assigned threat selects from its own snapshot but aims and measures its current pose', () => {
  const f = fixture();
  f.target.pos = { x: 0, y: 0, z: 2 };
  const before = structuredClone({ state: f.state, plan: f.plan });
  const decision = f.read()!;
  assert.equal(decision.targetId, f.target.id);
  assert.ok(decision.input); assert.ok(Math.cos(decision.input.action.aim) > .999);
  assert.deepEqual(decision.prediction.predictedTargetPos, { x: 0, y: 0, z: 2 });
  assert.equal(decision.range.enemyInKillRange, true);
  assert.deepEqual(JSON.parse(JSON.stringify(decision)), decision, 'detached JSON decision');
  decision.prediction.predictedTargetPos.z = 100;
  decision.input.scriptedObjective.movement[f.self.id].x = 1;
  assert.deepEqual({ state: f.state, plan: f.plan }, before);
});

test('current motion and configured anticipation can reject a formerly close target', () => {
  const f = fixture(); f.target.vel.x = 10;
  const decision = f.read()!;
  assert.equal(decision.targetId, f.target.id);
  assert.ok(Math.abs(decision.prediction.predictedTargetPos.x - 5.1) < 1e-12);
  assert.equal(decision.range.enemyInKillRange, false); assert.equal(decision.input, null);
  const noLead = resolveSimGrifballAssignedCombatInput(f.state, f.plan, f.self.id, f.owners,
    { ...tuning, tunedAnticipationFactor: 0 }, memory)!;
  assert.ok(noLead.input);
});

test('committed melee aims at current target while retaining predicted movement', () => {
  const f = fixture(); f.self.weaponState = 'windup'; f.target.vel = { x: -20, y: 0, z: 0 };
  const d = f.read()!;
  assert.ok(d.prediction.movementTargetPos.x < 0);
  assert.ok(Math.sin(d.prediction.aim) > .999);
  assert.equal(d.input, null, 'committed weapon cannot restart');
});

for (const invalid of ['dead', 'zero-hp', 'respawning', 'ally', 'missing', 'duplicate', 'receive', 'retriever', 'unassigned'] as const)
  test(`stale or unsupported ${invalid} target selection hands back control`, () => {
    const f = fixture();
    if (invalid === 'dead') f.target.alive = false;
    if (invalid === 'zero-hp') f.target.hp = 0;
    if (invalid === 'respawning') f.target.respawnTimer = 1;
    if (invalid === 'ally') f.target.team = f.self.team;
    if (invalid === 'missing') f.state.combatants.splice(1, 1);
    if (invalid === 'duplicate') f.state.combatants.push(structuredClone(f.target));
    if (invalid === 'receive') f.plan.assignments.get(f.self.id)!.receive = { carrierId: null, point: { x: 0, z: 0 }, seconds: 1 };
    if (invalid === 'retriever') f.plan.assignments.get(f.self.id)!.role = 'retriever';
    if (invalid === 'unassigned') f.plan.assignments.clear();
    const before = structuredClone({ state: f.state, plan: f.plan });
    assert.equal(f.read(), null); assert.deepEqual({ state: f.state, plan: f.plan }, before);
  });

test('current invulnerability suppresses commitment without inventing another target', () => {
  const f = fixture(); f.target.invulnerabilityTimer = .01;
  const d = f.read()!;
  assert.equal(d.targetId, f.target.id); assert.equal(d.range.enemyInKillRange, false); assert.equal(d.input, null);
  f.target.invulnerabilityTimer = 0;
  assert.ok(f.read()!.input);
});

test('a refreshed plan selects the surviving threat and keeps the dead identity out of the command', () => {
  const f = fixture(); f.target.alive = false; f.target.hp = 0; f.target.respawnTimer = 3;
  f.other.pos = { x: 0, y: 0, z: 2 };
  assert.equal(f.read(), null, 'a stale selected identity is not silently replaced');
  f.plan.snapshot = createSimGrifballTacticalSnapshot(f.state, { scriptedBots: f.owners });
  const d = f.read()!;
  assert.equal(d.targetId, f.other.id); assert.ok(d.input);
  assert.ok(Math.cos(d.input.action.aim) > .999);
});

test('airborne body distance can veto a horizontally close target', () => {
  const f = fixture(); f.target.pos.y = 3;
  const d = f.read()!;
  const height = 3 - .5 * 18 * .31 * .31;
  assert.ok(Math.abs(d.range.verticalDeltaToTarget - height) < 1e-12);
  assert.ok(Math.abs(d.range.attackDistanceToTarget - Math.sqrt(4 + height * height)) < 1e-12);
  assert.equal(d.range.enemyInKillRange, false); assert.equal(d.input, null);
});

for (const shape of ['circle', 'rectangular'] as const) test(`prediction uses the current ${shape} arena boundary`, () => {
  const f = fixture(); f.state.map.mapShape = shape; f.state.map.arenaRadius = 10;
  f.state.map.arenaHalfExtents = { x: 8, z: 6 }; f.target.vel.x = 100;
  const d = f.read()!;
  assert.ok(Math.abs(d.prediction.predictedTargetPos.x - (shape === 'circle' ? 9.4 : 7.4)) < 1e-12);
  assert.equal(d.range.enemyInKillRange, false); assert.equal(d.input, null);
});

test('a mixed local enemy is observable without granting it scripted control', () => {
  const f = fixture(); f.state.combatExecution = 'live-mixed-v1'; f.state.localPlayerId = f.target.id;
  f.target.controller = 'remote';
  f.plan.snapshot = createSimGrifballTacticalSnapshot(f.state, { scriptedBots: f.owners });
  assert.equal(f.read()!.targetId, f.target.id); assert.ok(f.read()!.input);
  assert.equal(resolveSimGrifballAssignedCombatInput(f.state, f.plan, f.target.id,
    { ...f.owners, [f.target.id]: 'normal' }, tuning, memory), null);
});
