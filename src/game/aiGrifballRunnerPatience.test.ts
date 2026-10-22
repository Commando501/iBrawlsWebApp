import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createSnapshotRouters, planGrifballRunner, tickRunnerMemory } from './aiGrifballRunner';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

function fixture(style: GrifballPlayerStyle = 'balanced') {
  const actor = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({
    id,
    team,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    scripted: true,
    space: {
      ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer'),
      reach: 2,
      blastRadius: 1,
      speed: 5,
      attackIn: 0.4,
      mobileIn: 0,
      lungeReach: 0,
    },
  });
  const config = defaultGrifballTactics();
  config.botStyles.runner = style;
  Object.assign(config.defaults, {
    runnerAgencyStrength: 0,
    runnerPatienceAgencyStrength: 1,
    stylesEnabled: false,
    passingEnabled: false,
  });
  const carrier = actor('runner', 'blue', 0, 0),
    enemy = actor('enemy', 'red', 8, 0);
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: carrier.id,
    ball: { x: 0, z: 0 },
    spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    tactics: config,
    geometry: buildGrifballSpaceGeometry(
      { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData,
      52,
    ),
    players: [carrier, enemy],
  };
  const tuning = config.defaults,
    memory = tickRunnerMemory(undefined, carrier, snapshot.goals.red!, 0);
  const run = () => planGrifballRunner(snapshot, carrier, tuning, memory, createSnapshotRouters(snapshot), undefined, new Map());
  return { config, carrier, enemy, snapshot, tuning, memory, run, actor };
}

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b);
const budgets = { balanced: 2, enforcer: 1.3, opportunist: 1.7, guardian: 2.5 };
function rendezvous(style: GrifballPlayerStyle = 'balanced') {
  const f = fixture(style),
    escort = f.actor('escort', 'blue', -3, 0);
  f.enemy.pos = { x: 6, z: 0 };
  Object.assign(f.enemy.space!, { reach: 3, speed: 3 });
  Object.assign(f.tuning, { runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 });
  f.snapshot.players.push(escort);
  return { ...f, escort };
}
for (const style of styles) {
  test(style + ' owns patience independently of route scoring and support styles', () => {
    const f = rendezvous(style);
    f.config.botStyles.escort = 'guardian';
    const plan = f.run();
    assert.equal(plan.selected.action, 'wait');
    assert.equal(plan.individuality, undefined);
    assert.equal(plan.patience!.style, style);
    close(plan.patience!.maxWait, budgets[style]);
    close(plan.patience!.rendezvousETA, 0.6);
    assert.equal(plan.patience!.teamMaxWait, 2);
    assert.equal(f.tuning.runnerMaxWait, 2);
    assert.equal(f.tuning.agencyStrength, 0);
  });
  for (const spent of [0.9, 1.2, 1.6])
    test(style + ' changes the actual wait decision after ' + spent + ' seconds', () => {
      const f = rendezvous(style);
      f.memory.waitUsed = spent;
      const p = f.run();
      assert.equal(p.selected.action === 'wait', budgets[style] - spent >= 0.6);
      assert.equal(Number.isFinite(p.candidates.find((c) => c.action === 'wait')!.score), budgets[style] - spent >= 0.6);
      assert.equal(f.memory.waitUsed, spent);
    });
  test(style + ' applies the same allowance to retreat without resetting either counter', () => {
    const f = rendezvous(style);
    f.memory.waitUsed = 10;
    f.memory.retreatUsed = 1.8;
    const p = f.run();
    assert.equal(Number.isFinite(p.candidates.find((c) => c.action === 'retreat')!.score), budgets[style] > 1.8);
    assert.equal(f.memory.waitUsed, 10);
    assert.equal(f.memory.retreatUsed, 1.8);
  });
  test(style + ' zero strength retains complete baseline plans and memory', () => {
    const a = rendezvous(style),
      b = rendezvous();
    a.tuning.runnerPatienceAgencyStrength = 0;
    b.tuning.runnerPatienceAgencyStrength = 0;
    for (let i = 0; i < 18; i++) {
      assert.deepEqual(a.run(), b.run());
      assert.deepEqual(a.memory, b.memory);
      for (const f of [a, b]) tickRunnerMemory(f.memory, f.carrier, f.snapshot.goals.red!, 0.2);
    }
  });
  test(style + ' blends intermediate strengths and respects zero and maximum limits', () => {
    const f = rendezvous(style);
    f.tuning.runnerPatienceAgencyStrength = 0.5;
    close(f.run().patience!.maxWait, (2 + budgets[style]) / 2);
    f.tuning.runnerMaxWait = 0;
    const zero = f.run();
    assert.equal(zero.patience!.maxWait, 0);
    assert.equal(zero.candidates.find((c) => c.action === 'wait')!.score, -Infinity);
    assert.equal(zero.candidates.find((c) => c.action === 'retreat')!.score, -Infinity);
    f.tuning.runnerMaxWait = 4;
    f.tuning.runnerPatienceAgencyStrength = 1;
    close(f.run().patience!.maxWait, Math.min(4, 2 * budgets[style]));
  });
  test(style + ' keeps a reachable finish and the shared progress deadline', () => {
    const f = rendezvous(style);
    f.memory.stalledSeconds = f.tuning.runnerProgressTimeout;
    const p = f.run();
    assert.equal(p.forcedProgress, true);
    assert.equal(p.selected.action, 'advance');
    assert.equal(p.patience!.progressRemaining, 0);
    for (const c of p.candidates.filter((c) => ['wait', 'retreat'].includes(c.action))) assert.equal(c.score, -Infinity);
    f.carrier.pos.x = 43;
    f.enemy.pos.x = -20;
    assert.equal(f.run().selected.action, 'finish');
  });
}
for (const condition of ['solo', 'human-escort', 'late', 'blocked', 'clear-forward', 'immediate-danger'] as const)
  test('Guardian cannot wait through ' + condition, () => {
    const f = rendezvous('guardian');
    if (condition === 'solo') f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'escort');
    if (condition === 'human-escort') f.escort.scripted = false;
    if (condition === 'late') f.escort.space!.attackIn = 5;
    if (condition === 'blocked')
      f.snapshot.geometry = buildGrifballSpaceGeometry(
        {
          mapShape: 'rectangular',
          arenaRadius: 52,
          arenaHalfExtents: { x: 52, z: 23 },
          objects: [{ type: 'box', position: { x: 0, y: 2, z: 0 }, scale: { x: 20, y: 4, z: 20 }, isCollidable: true }],
        } as CustomMapData,
        52,
      );
    if (condition === 'clear-forward') f.enemy.pos.x = 40;
    if (condition === 'immediate-danger') f.enemy.pos.x = 1;
    assert.equal(f.run().candidates.find((c) => c.action === 'wait')!.score, -Infinity);
  });
test('style/strength edits preserve spent time, and only net progress replenishes patience', () => {
  const f = rendezvous('guardian');
  f.run();
  tickRunnerMemory(f.memory, f.carrier, f.snapshot.goals.red!, 0.9);
  assert.equal(f.memory.waitUsed, 0.9);
  f.memory.retreatUsed = 0.4;
  f.config.botStyles.runner = 'enforcer';
  assert.notEqual(f.run().selected.action, 'wait');
  f.config.botStyles.runner = 'guardian';
  assert.equal(f.run().selected.action, 'wait');
  f.tuning.runnerPatienceAgencyStrength = 0;
  assert.equal(f.run().patience, undefined);
  assert.equal(f.memory.waitUsed, 0.9);
  assert.equal(f.memory.retreatUsed, 0.4);
  assert.equal(f.memory.stalledSeconds, 0.9);
  f.carrier.pos.x = -2;
  tickRunnerMemory(f.memory, f.carrier, f.snapshot.goals.red!, 0);
  assert.equal(f.memory.waitUsed, 0.9);
  f.carrier.pos.x = 0;
  tickRunnerMemory(f.memory, f.carrier, f.snapshot.goals.red!, 0);
  assert.equal(f.memory.waitUsed, 0.9);
  f.carrier.pos.x = 2;
  tickRunnerMemory(f.memory, f.carrier, f.snapshot.goals.red!, 0);
  assert.equal(f.memory.waitUsed, 0);
  assert.equal(f.memory.retreatUsed, 0);
  assert.equal(f.memory.stalledSeconds, 0);
});
for (const gate of ['enabled', 'spaceEnabled', 'runnerEnabled'] as const)
  test('patience requires ' + gate, () => {
    const f = rendezvous('guardian');
    f.tuning[gate] = false;
    assert.equal(f.run().patience, undefined);
    const state = createGrifballTeamPlanState();
    updateGrifballTeamPlan(state, f.snapshot, 0.2);
    assert.equal(state.runnerPlans.blue, undefined);
  });
test('human/neural carriers remain observed; support timing never assigns them orders', () => {
  const f = rendezvous('guardian');
  f.carrier.scripted = false;
  f.carrier.vel.z = 3;
  const on = f.run();
  f.tuning.runnerPatienceAgencyStrength = 0;
  assert.deepEqual(on, f.run());
  assert.equal(on.selected.action, 'observed');
  assert.equal(on.patience, undefined);
});
test('team scope, main_ai, mirrored rosters and restored continuation retain the carrier identity', () => {
  for (const style of styles)
    for (const mirror of [false, true])
      for (const reverse of [false, true])
        for (const main of [false, true]) {
          const f = rendezvous(style),
            team = mirror ? 'red' : 'blue',
            id = main ? 'main_ai' : 'runner';
          f.carrier.id = id;
          f.snapshot.holderId = id;
          f.config.botStyles = { [id]: style, escort: 'guardian' };
          if (mirror)
            for (const p of f.snapshot.players) {
              p.team = p.team === 'blue' ? 'red' : 'blue';
              p.pos.x *= -1;
              p.pos.z *= -1;
            }
          if (reverse) f.snapshot.players.reverse();
          f.config.teams[team] = { runnerPatienceAgencyStrength: 0.5 };
          const state = createGrifballTeamPlanState();
          updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
          assert.equal(state.runnerPlans[team].patience!.style, style);
          close(state.runnerPlans[team].patience!.maxWait, (2 + budgets[style]) / 2);
          const restored = structuredClone(state);
          for (const p of [state, restored]) updateGrifballTeamPlan(p, structuredClone(f.snapshot), 0.2);
          assert.deepEqual(state, restored);
        }
});
test('carrier changes transfer style and reset possession memory; inactive play removes the decision', () => {
  const f = rendezvous('enforcer');
  f.config.botStyles.escort = 'guardian';
  const state = createGrifballTeamPlanState();
  updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
  state.runnerMemory.blue.waitUsed = 1;
  f.snapshot.holderId = 'escort';
  updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
  assert.equal(state.runnerPlans.blue.patience!.style, 'guardian');
  assert.equal(state.runnerMemory.blue.waitUsed, 0);
  f.snapshot.holderId = null;
  updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
  assert.deepEqual(state.runnerPlans, {});
  f.snapshot.playing = false;
  updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
  assert.deepEqual(state.runnerMemory, {});
});
test('v1–23 imports migrate patience off while preserving older settings and styles', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.schemaVersion, 34);
  assert.equal(current.defaults.runnerPatienceAgencyStrength, 0);
  for (let version = 1; version <= 23; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.runnerPatienceAgencyStrength;
    old.defaults.engagementAgencyStrength = 0.8;
    old.botStyles.runner = 'guardian';
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.runnerPatienceAgencyStrength, 0);
    assert.equal(next.defaults.engagementAgencyStrength, 0.8);
    assert.equal(next.botStyles.runner, 'guardian');
  }
  current.teams.red = { runnerPatienceAgencyStrength: 0.7 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const value of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { runnerPatienceAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current));
  delete invalid.defaults.runnerPatienceAgencyStrength;
  assert.throws(() => validateGrifballTactics(invalid));
});
