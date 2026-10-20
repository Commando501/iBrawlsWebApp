import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createSnapshotRouters, planGrifballRunner, tickRunnerMemory } from './aiGrifballRunner';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, validateGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import { type GrifballPlayerStyle } from './grifballPlayerStyles';

function fixture(style: GrifballPlayerStyle = 'balanced') {
  const actor = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({
    id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
    space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer'),
      reach: 2, blastRadius: 1, speed: 5, attackIn: .4, mobileIn: 0, lungeReach: 0 },
  });
  const config = defaultGrifballTactics(); config.botStyles.runner = style;
  Object.assign(config.defaults, { runnerAgencyStrength: 1, stylesEnabled: false, passingEnabled: false });
  const carrier = actor('runner', 'blue', 0, 0), enemy = actor('enemy', 'red', 8, 0);
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: carrier.id, ball: { x: 0, z: 0 }, spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, tactics: config,
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52), players: [carrier, enemy] };
  const tuning = config.defaults, memory = tickRunnerMemory(undefined, carrier, snapshot.goals.red!, 0);
  const run = () => planGrifballRunner(snapshot, carrier, tuning, memory, createSnapshotRouters(snapshot), undefined, new Map());
  return { config, carrier, enemy, snapshot, tuning, memory, run, actor };
}

test('schema 7 keeps support styles and team overrides while migrating runner individuality off', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 7; delete old.defaults.runnerAgencyStrength;
  old.defaults.agencyStrength = .8; old.teams.red = { agencyStrength: .3 }; old.botStyles.runner = 'guardian';
  const config = validateGrifballTactics(old);
  assert.equal(config.schemaVersion, 18); assert.equal(config.defaults.runnerAgencyStrength, 0);
  assert.equal(config.defaults.agencyStrength, .8); assert.equal(config.botStyles.runner, 'guardian');
  assert.equal(resolveTeamTactics(config, 'red').agencyStrength, .3);
  for (const runnerAgencyStrength of [-.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { blue: { runnerAgencyStrength } } }));
  const incomplete = structuredClone(config); delete (incomplete.defaults as any).runnerAgencyStrength;
  assert.throws(() => validateGrifballTactics(incomplete));
});

for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const) {
  test(`zero strength preserves the existing runner plan for ${style}`, () => {
    const off = fixture(style), baseline = fixture();
    off.tuning.runnerAgencyStrength = 0; baseline.tuning.runnerAgencyStrength = 0;
    assert.deepEqual(off.run(), baseline.run()); assert.deepEqual(off.memory, baseline.memory);
  });
  test(`${style} cannot turn an ineligible wait or retreat into a route`, () => {
    const f = fixture(style); f.enemy.pos = { x: 30, z: 0 };
    const plan = f.run(); assert.equal(plan.selected.action, 'advance');
    assert.equal(plan.candidates.find(c => c.action === 'wait')!.score, -Infinity);
    assert.equal(plan.candidates.find(c => c.action === 'retreat')!.score, -Infinity);
    assert.ok(plan.candidates.every(c => !c.individuality || Math.abs(c.individuality.bonus) <= 3));
  });
  test(`${style} retains finishing and progress timeouts`, () => {
    const f = fixture(style); f.carrier.pos.x = 43; f.enemy.pos.x = -20;
    assert.equal(f.run().selected.action, 'finish');
    f.carrier.pos.x = 0; f.enemy.pos.x = 5; f.memory.stalledSeconds = f.tuning.runnerProgressTimeout;
    const plan = f.run(); assert.equal(plan.forcedProgress, true); assert.equal(plan.selected.action, 'advance');
    assert.equal(plan.candidates.find(c => c.action === 'wait')!.score, -Infinity);
    assert.equal(plan.candidates.find(c => c.action === 'retreat')!.score, -Infinity);
  });
  test(`${style} cannot cross an enclosing obstacle`, () => {
    const f = fixture(style); f.snapshot.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 }, objects: [{ type: 'box', position: { x: 0, y: 2, z: 0 },
        scale: { x: 20, y: 4, z: 20 }, isCollidable: true }] } as CustomMapData, 52);
    const plan = f.run(); assert.equal(plan.selected.route.status, 'blocked');
    assert.ok(plan.candidates.every(c => c.score === -Infinity));
  });
}

test('human and neural carriers retain observed motion without individuality', () => {
  const f = fixture('enforcer'); f.carrier.scripted = false; f.carrier.vel = { x: 0, z: 3 };
  const enabled = f.run(); f.tuning.runnerAgencyStrength = 0;
  assert.deepEqual(enabled, f.run()); assert.equal(enabled.selected.action, 'observed'); assert.equal(enabled.individuality, undefined);
});

for (const disabled of ['enabled', 'spaceEnabled', 'runnerEnabled'] as const)
  test(`runner individuality respects disabled ${disabled}`, () => {
    const f = fixture('enforcer'); f.tuning[disabled] = false;
    const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, f.snapshot, .2);
    assert.equal(state.runnerPlans.blue, undefined); assert.equal(f.run().individuality, undefined);
  });

test('runner preferences operate independently of support initiative and tanking', () => {
  const f = fixture('guardian'); f.tuning.agencyStrength = 0; f.tuning.tankingEnabled = false;
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, f.snapshot, .2);
  assert.equal(state.runnerPlans.blue.individuality?.style, 'guardian');
  assert.ok(state.runnerPlans.blue.candidates.some(c => c.individuality?.bonus !== 0));
});

test('team overrides control runner strength while the player style follows the carrier', () => {
  const f = fixture('enforcer'); f.config.teams = { blue: { runnerAgencyStrength: 0 }, red: { runnerAgencyStrength: .6 } };
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, f.snapshot, .2);
  assert.equal(state.runnerPlans.blue.individuality, undefined);
  f.carrier.team = 'red'; f.enemy.team = 'blue'; updateGrifballTeamPlan(state, f.snapshot, .01);
  assert.equal(state.runnerPlans.red.individuality?.style, 'enforcer');
  assert.equal(state.runnerPlans.red.individuality?.strength, .6);
  assert.equal(state.runnerPlans.blue, undefined);
});

test('editing or disabling individuality releases commitments without renewing patience', () => {
  const f = fixture('enforcer'); f.run(); f.memory.commitRemaining = 2;
  f.memory.waitUsed = .9; f.memory.retreatUsed = .4; f.memory.stalledSeconds = 2;
  f.config.botStyles.runner = 'guardian'; f.run();
  assert.equal(f.memory.individualityKey, 'guardian:1');
  f.tuning.runnerAgencyStrength = 0; const off = f.run();
  const fresh = fixture(); fresh.tuning.runnerAgencyStrength = 0;
  Object.assign(fresh.memory, { waitUsed: .9, retreatUsed: .4, stalledSeconds: 2 });
  assert.deepEqual(off, fresh.run()); assert.equal(f.memory.individualityKey, undefined);
  assert.equal(f.memory.waitUsed, .9); assert.equal(f.memory.retreatUsed, .4); assert.equal(f.memory.stalledSeconds, 2);
});

test('runner individuality follows a new carrier and clears on possession loss', () => {
  const f = fixture('enforcer'), ally = f.actor('ally', 'blue', -3, 4); f.snapshot.players.push(ally);
  f.config.botStyles.ally = 'guardian'; const state = createGrifballTeamPlanState();
  updateGrifballTeamPlan(state, f.snapshot, .2); assert.equal(state.runnerPlans.blue.individuality?.style, 'enforcer');
  f.snapshot.holderId = ally.id; updateGrifballTeamPlan(state, f.snapshot, .01);
  assert.equal(state.runnerPlans.blue.individuality?.style, 'guardian'); assert.equal(state.runnerMemory.blue.waitUsed, 0);
  f.snapshot.holderId = null; updateGrifballTeamPlan(state, f.snapshot, .01); assert.deepEqual(state.runnerPlans, {});
});

for (const sign of [1, -1]) for (const reverse of [false, true])
  test(`Enforcer presses forward while Guardian chooses lower exposure ${sign}/${reverse}`, () => {
    const plans = (['enforcer', 'guardian'] as const).map(style => {
      const f = fixture(style); f.enemy.pos = { x: 11, z: 2 }; f.enemy.space!.attackIn = 1;
      if (sign === -1) for (const actor of f.snapshot.players) {
        actor.pos.x *= -1; actor.pos.z *= -1; actor.team = actor.team === 'blue' ? 'red' : 'blue';
      }
      if (reverse) f.snapshot.players.reverse();
      const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, f.snapshot, .2);
      const plan = state.runnerPlans[f.carrier.team];
      const restored = structuredClone(state);
      updateGrifballTeamPlan(state, f.snapshot, .2); updateGrifballTeamPlan(restored, f.snapshot, .2);
      assert.deepEqual(state, restored, 'checkpoint continuation preserves style and route memory');
      return plan;
    });
    assert.equal(plans[0].selected.action, 'advance'); assert.equal(plans[1].selected.action, 'cut-left');
    assert.ok(plans[0].selected.progress > plans[1].selected.progress);
    assert.ok(plans[0].selected.risk > plans[1].selected.risk);
  });

test('Opportunist takes a visible recovery opening and releases it when the window closes', () => {
  const f = fixture('opportunist'); f.enemy.pos.x = 14.5;
  const recovering = f.actor('recovering', 'red', 6, -4);
  Object.assign(recovering.space!, { phase: 'recovering', attackIn: 2 }); f.snapshot.players.push(recovering);
  const plan = f.run(); assert.equal(plan.selected.action, 'cut-right');
  assert.ok(plan.selected.individuality!.recoveryOpening > 0); assert.ok(plan.selected.individuality!.bonus > 0);
  const baseline = fixture('balanced'); baseline.enemy.pos.x = 14.5; baseline.snapshot.players.push(structuredClone(recovering));
  assert.equal(baseline.run().selected.action, 'advance');
  Object.assign(recovering.space!, { phase: 'ready', attackIn: .4 });
  const closed = f.run(); assert.notEqual(closed.selected.action, 'cut-right', 'new danger overrides a committed opening');
  assert.ok(closed.candidates.every(c => !c.individuality?.recoveryOpening));
});

test('Opportunist does not detour toward a recovering opponent when the forward route is clear', () => {
  const f = fixture('opportunist'); f.enemy.pos.x = 30;
  const recovering = f.actor('recovering', 'red', 6, -4);
  Object.assign(recovering.space!, { phase: 'recovering', attackIn: 3 }); f.snapshot.players.push(recovering);
  const plan = f.run(); assert.equal(plan.selected.action, 'advance');
  assert.equal(plan.candidates.find(c => c.action === 'cut-right')!.individuality!.bonus, 0);
});

for (const condition of ['ready', 'late', 'human', 'spent-budget'] as const)
  test(`Guardian rendezvous still requires real timely coverage: ${condition}`, () => {
    const f = fixture('guardian'), escort = f.actor('escort', 'blue', -3, 0);
    f.enemy.pos = { x: 6, z: 0 }; Object.assign(f.enemy.space!, { reach: 3, speed: 3 });
    f.snapshot.players.push(escort); Object.assign(f.tuning, { runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 });
    if (condition === 'late') escort.space!.attackIn = 5;
    if (condition === 'human') escort.scripted = false;
    if (condition === 'spent-budget') f.memory.waitUsed = 1.9;
    const plan = f.run();
    assert.equal(plan.selected.action === 'wait', condition === 'ready');
  });

test('individuality does not invent pressure credit for idle supports', () => {
  const f = fixture('guardian'), escort = f.actor('escort', 'blue', 6, 5);
  f.enemy.pos = { x: 6, z: 0 }; f.snapshot.players.push(escort);
  for (const actor of [escort, f.enemy]) Object.assign(actor.space!, { reach: 7.7, speed: 5.2, attackIn: .12 });
  const plan = f.run();
  assert.equal(plan.candidates.find(c => c.action === 'advance')!.risk, 1, 'empty published intent ledger offers no protection');
});
