import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { createInitialBall, returnBallHome } from './grifballBall';
import { defaultGrifballTactics, validateGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  resetGrifballTeamPlan,
  selectGrifballAssignmentThreat,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry, fieldDistance } from './grifballSpaceGeometry';
import { resolveGrifballSupportSteering } from './aiGrifballObjectiveSteering';
import type { GrifballPlayerStyle } from './grifballPlayerStyles';
import { createSnapshotRouters } from './aiGrifballRunner';
import { applyGrifballTipoffPosition } from './aiGrifballTipoffPosition';

const actor = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({
  id,
  team,
  pos: { x, z },
  vel: { x: 0, z: 0 },
  scripted: true,
  space: {
    weapon: 'hammer',
    phase: 'ready',
    speed: 5.2,
    reach: 3,
    blastRadius: 2,
    attackIn: 0.3,
    lungeReach: 0,
    lungeSpeed: 0,
    mobileIn: 0,
  },
});
function fixture() {
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, {
    tipoffEnabled: true,
    stylesEnabled: false,
    passingEnabled: false,
  });
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: null,
    ball: { x: 0, z: 0 },
    ballPhysics: createInitialBall({ x: 0, y: 0.35, z: 0 }),
    spacing: 4,
    tactics,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: buildGrifballSpaceGeometry(
      {
        mapShape: 'rectangular',
        arenaRadius: 52,
        arenaHalfExtents: { x: 52, z: 23 },
        objects: [],
      } as unknown as CustomMapData,
      52,
    ),
    players: [
      actor('collector', 'blue', -8),
      actor('screen', 'blue', -8, -6),
      actor('support', 'blue', -10, 6),
      actor('reserve', 'blue', -16),
      actor('enemy', 'red', 8),
      actor('enemy-screen', 'red', 2, -6),
      actor('enemy-support', 'red', 10, 6),
      actor('enemy-back', 'red', 16),
    ],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return [...state.assignments.values()].filter((a) => a.team === 'blue');
  };
  return {
    tactics,
    snapshot,
    state,
    run,
    player: (id: string) => snapshot.players.find((p) => p.id === id)!,
  };
}
const steer = (f: ReturnType<typeof fixture>, id: string) =>
  resolveGrifballSupportSteering({
    assignment: f.state.assignments.get(id),
    pos: f.player(id).pos,
    allies: f.snapshot.players.filter((p) => p.team === 'blue' && p.id !== id).map((p) => p.pos),
    players: f.snapshot.players,
    ball: f.snapshot.ball,
    heldByAnyone: !!f.snapshot.holderId,
    separation: 4,
    speed: 5.2,
    dt: 1 / 60,
  });

function personalOpening(style: GrifballPlayerStyle, strength = 1) {
  const f = fixture();
  f.tactics.defaults.tipoffAgencyStrength = strength;
  f.tactics.botStyles = {
    collector: style,
    screen: style,
    support: style,
    reserve: style,
  };
  return f;
}
function pickupWindow(f: ReturnType<typeof fixture>, margin: number) {
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos = { x: 40, z: 0 }));
  const p = f.player('enemy'),
    o = p.space!;
  const arrival = fieldDistance(f.player('collector').pos, f.snapshot.ball) / f.player('collector').space!.speed;
  p.pos.x = o.reach + o.speed * (arrival + margin - o.attackIn);
}

for (const [style, gap, claim] of [
  ['enforcer', 0.3, true],
  ['balanced', 0.3, false],
  ['opportunist', 0.4, false],
  ['guardian', 0.5, false],
  ['balanced', 0.4, true],
  ['opportunist', 0.5, true],
  ['guardian', 0.65, true],
] as const)
  test(`${style} collector uses its own pickup caution at ${gap}s`, () => {
    const f = personalOpening(style);
    pickupWindow(f, gap);
    f.run();
    const a = f.state.assignments.get('collector')!;
    assert.equal(a.tipoff!.phase === 'claim', claim);
    assert.equal(a.role === 'retriever', claim);
    assert.equal(steer(f, 'collector')!.pickupRequested, claim);
    assert.equal(a.tipoff!.agency!.style, style);
    assert.equal(a.tipoff!.agency!.changedDecision, claim !== gap >= 0.35);
    assert.ok(f.state.assignments.get('reserve')!.tipoff?.job === 'reserve');
  });

for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const)
  test(`${style} screen challenges only within its own timing cushion`, () => {
    const f = personalOpening(style);
    f.run();
    const a = f.state.assignments.get('screen')!;
    assert.equal(a.tipoff!.attack, style === 'balanced' || style === 'enforcer');
    assert.equal(a.tipoff!.agency!.changedDecision, style === 'opportunist' || style === 'guardian');
    assert.ok(!f.state.assignments.get('reserve')!.tipoff!.agency);
    assert.ok(!f.state.assignments.get('support')!.tipoff!.agency);
    f.player('enemy-screen').space!.attackIn = 0.8;
    f.player('enemy-screen').space!.phase = 'hammer_recover';
    f.run();
    assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true, 'real recovery earns the challenge');
    assert.equal([...f.state.assignments.values()].filter((a) => a.team === 'blue' && a.tipoff?.attack).length, 1);
  });

test('personal opening timing blends and clamps without altering physical estimates', () => {
  const f = personalOpening('guardian', 0.5);
  pickupWindow(f, 0.5);
  f.run();
  const half = f.state.assignments.get('collector')!.tipoff!;
  assert.equal(half.phase, 'claim');
  assert.equal(half.agency!.pickupMargin, 0.475);
  f.tactics.defaults.tipoffAgencyStrength = 1;
  f.run(0);
  const full = f.state.assignments.get('collector')!.tipoff!;
  assert.equal(full.phase, 'contest');
  assert.equal(full.pickupETA, half.pickupETA);
  assert.equal(full.enemyAttackETA, half.enemyAttackETA);
  f.tactics.defaults.tipoffPickupMargin = 1.5;
  f.run(0);
  assert.equal(f.state.assignments.get('collector')!.tipoff!.agency!.pickupMargin, 1.5);
  f.tactics.botStyles.collector = 'enforcer';
  f.tactics.defaults.tipoffPickupMargin = 0.1;
  f.run(0);
  assert.equal(f.state.assignments.get('collector')!.tipoff!.agency!.pickupMargin, 0.1);
});

test('fresh pickup guard retains personal caution between planner refreshes', () => {
  const f = personalOpening('guardian');
  pickupWindow(f, 1);
  f.run();
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  pickupWindow(f, 0.5);
  assert.deepEqual(steer(f, 'collector'), {
    velocity: { x: 0, z: 0 },
    pickupRequested: false,
  });
});

test('a recovering screen target becoming ready revokes personal permission before refresh', () => {
  const f = personalOpening('guardian');
  f.run();
  f.player('screen').pos.x = -4;
  f.player('enemy-screen').space!.attackIn = 0.8;
  f.run();
  const a = f.state.assignments.get('screen')!;
  assert.equal(a.tipoff!.attack, true);
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy-screen');
  f.player('enemy-screen').space!.attackIn = 0.3;
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), null);
  f.player('enemy-screen').pos.x = -2;
  assert.equal(
    selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players),
    'enemy-screen',
    'self-defense takes priority',
  );
});

test('zero strength and unassigned styles restore team decisions without stale personal orders', () => {
  const f = personalOpening('guardian');
  pickupWindow(f, 0.5);
  f.run();
  f.tactics.defaults.tipoffAgencyStrength = 0;
  f.run(0);
  const baseline = fixture();
  pickupWindow(baseline, 0.5);
  baseline.run();
  const decisions = (x: ReturnType<typeof fixture>) =>
    [...x.state.assignments.values()].map((a) => ({
      id: a.botId,
      point: a.destination,
      role: a.role,
      tipoff: a.tipoff,
    }));
  assert.deepEqual(decisions(f), decisions(baseline));
  f.tactics.defaults.tipoffAgencyStrength = 1;
  f.tactics.botStyles = {};
  f.run(0);
  assert.equal(f.state.assignments.get('collector')!.tipoff!.agency!.style, 'balanced');
  assert.equal(f.state.assignments.get('collector')!.role, 'retriever');
  assert.equal(f.state.assignments.get('collector')!.tipoff!.agency!.changedDecision, false);
});

test('individual timing follows replacement collectors and ignores observed-player styles', () => {
  const f = personalOpening('guardian');
  f.tactics.botStyles.screen = 'enforcer';
  f.run();
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'collector');
  f.run(0);
  const replacement = [...f.state.assignments.values()].find(
    (a) => a.team === 'blue' && a.tipoff?.job === 'collector',
  )!;
  assert.equal(replacement.botId, 'screen');
  assert.equal(replacement.tipoff!.agency!.style, 'enforcer');
  const human = personalOpening('guardian');
  pickupWindow(human, 0.5);
  human.player('collector').scripted = false;
  human.player('collector').pickupRequested = true;
  human.player('collector').vel.x = 1;
  const orders = human.run();
  assert.equal(human.state.assignments.has('collector'), false);
  assert.ok(orders.every((a) => a.tipoff!.phase === 'claim'));
});

test('team overrides and stable roster styles survive mirrors, reorder and checkpoint continuation', () => {
  for (const mirror of [false, true])
    for (const reverse of [false, true]) {
      const f = personalOpening('enforcer');
      f.player('collector').id = 'main_ai';
      f.tactics.botStyles.main_ai = 'guardian';
      f.tactics.defaults.tipoffAgencyStrength = 0;
      const team = mirror ? 'red' : 'blue';
      f.tactics.teams[team] = { tipoffAgencyStrength: 1 };
      if (mirror)
        for (const p of f.snapshot.players) {
          p.team = p.team === 'blue' ? 'red' : 'blue';
          p.pos.x *= -1;
          p.pos.z *= -1;
        }
      if (reverse) f.snapshot.players.reverse();
      f.run();
      assert.equal(f.state.assignments.get('main_ai')!.tipoff!.agency!.style, 'guardian');
      assert.equal(f.state.assignments.get('main_ai')!.tipoff!.agency!.pickupMargin, 0.6);
      assert.ok([...f.state.assignments.values()].filter((a) => a.team !== team).every((a) => !a.tipoff?.agency));
      const restored = structuredClone(f.state);
      f.run();
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), 0.2);
      assert.deepEqual(restored, f.state);
    }
});

test('tip-off individuality migrates all older presets at zero and validates current controls', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.defaults.tipoffAgencyStrength, 0);
  for (let version = 1; version <= 29; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.tipoffAgencyStrength;
    old.defaults.tipoffEnabled = true;
    old.defaults.tipoffPickupMargin = 0.7;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { tipoffSpacing: 9 };
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.tipoffAgencyStrength, 0);
    assert.equal(migrated.defaults.tipoffEnabled, true);
    assert.equal(migrated.defaults.tipoffPickupMargin, 0.7);
    assert.equal(migrated.botStyles.main_ai, 'guardian');
    assert.equal(migrated.teams.red!.tipoffSpacing, 9);
  }
  current.defaults.tipoffAgencyStrength = 0.7;
  current.teams.red = { tipoffAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const value of [-0.1, 1.1, NaN, Infinity, '1', true])
    assert.throws(() =>
      validateGrifballTactics({
        ...current,
        teams: { red: { tipoffAgencyStrength: value } },
      }),
    );
  const incomplete = JSON.parse(JSON.stringify(current));
  delete incomplete.defaults.tipoffAgencyStrength;
  assert.throws(() => validateGrifballTactics(incomplete));
});

test('contested tip-off assigns one collector, one screen, spaced support and one reserve', () => {
  const f = fixture(),
    orders = f.run();
  assert.deepEqual(orders.map((a) => a.tipoff!.job).sort(), ['collector', 'reserve', 'screen', 'support']);
  assert.equal(orders.filter((a) => a.tipoff?.attack).length, 1);
  assert.ok(orders.every((a) => !a.defense && !a.escort && !a.receive));
  const c = orders.find((a) => a.tipoff?.job === 'collector')!,
    r = orders.find((a) => a.tipoff?.job === 'reserve')!;
  assert.equal(c.role, 'cover');
  assert.ok(c.destination.x < -3);
  assert.ok(r.destination.x < c.destination.x);
  assert.equal(steer(f, c.botId)!.pickupRequested, false);
  assert.ok(orders.every((a) => a.tipoff!.reserveId === r.botId));
  for (const a of orders.filter((a) => a !== r)) assert.ok(fieldDistance(a.destination, r.destination) >= 4.5);
});
test('a clear first pickup gets one requester and immediately becomes normal possession play', () => {
  const f = fixture();
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 40));
  const orders = f.run(),
    c = orders.find((a) => a.tipoff?.job === 'collector')!;
  assert.equal(c.role, 'retriever');
  assert.equal(c.tipoff!.phase, 'claim');
  assert.equal(steer(f, c.botId)!.pickupRequested, true);
  assert.equal(orders.filter((a) => a.role === 'retriever').length, 1);
  assert.ok(orders.every((a) => !a.tipoff!.attack));
  f.snapshot.holderId = c.botId;
  f.snapshot.ballPhysics!.holderId = c.botId;
  f.snapshot.ballPhysics!.state = 'held';
  f.run(0);
  assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff));
  assert.equal(f.state.assignments.get(c.botId)!.role, 'runner');
});
test('a newly closing threat cancels pickup between tactical refreshes', () => {
  const f = fixture();
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 40));
  f.run();
  f.player('enemy').pos = { x: 2, z: 0 };
  const movement = steer(f, 'collector')!;
  assert.equal(movement.pickupRequested, false);
  assert.deepEqual(movement.velocity, { x: 0, z: 0 });
});
test('screen combat permission uses existing threat handoff; supports and reserve do not chase', () => {
  const f = fixture();
  f.run();
  f.player('screen').pos.x = -3;
  for (const id of ['screen', 'support', 'reserve', 'collector']) {
    const target = selectGrifballAssignmentThreat(f.state.assignments.get(id)!, f.player(id).pos, f.snapshot.players);
    assert.equal(target, id === 'screen' ? 'enemy-screen' : null);
  }
  f.player('enemy-screen').pos.x = 40;
  assert.equal(
    selectGrifballAssignmentThreat(f.state.assignments.get('screen')!, f.player('screen').pos, f.snapshot.players),
    null,
  );
});
test('all jobs retain immediate self-defense and an observed wall blocks a target', () => {
  const f = fixture();
  f.run();
  f.player('enemy').pos = { x: -14, z: 0 };
  assert.equal(
    selectGrifballAssignmentThreat(f.state.assignments.get('reserve')!, f.player('reserve').pos, f.snapshot.players),
    'enemy',
  );
  f.state.assignments.get('reserve')!.geometry!.blockers.push({ kind: 'box', x: -15, z: 0, hx: 0.2, hz: 2 });
  assert.equal(
    selectGrifballAssignmentThreat(f.state.assignments.get('reserve')!, f.player('reserve').pos, f.snapshot.players),
    null,
  );
});
for (const strength of [0, 1])
  for (const mode of ['outnumbered', 'two-left', 'unready-reserve', 'clustered', 'recovery-screen'] as const)
    test(`${mode} cannot commit the whole opening team, individuality ${strength}`, () => {
      const f = personalOpening('enforcer', strength);
      if (mode === 'outnumbered') f.snapshot.players.push(actor('extra', 'red', 10, -9));
      if (mode === 'two-left')
        f.snapshot.players = f.snapshot.players.filter(
          (p) => p.team !== 'blue' || ['collector', 'screen'].includes(p.id),
        );
      if (mode === 'unready-reserve')
        f.snapshot.players
          .filter((p) => p.team === 'blue' && p.id !== 'collector')
          .forEach((p) => (p.space!.mobileIn = 4));
      if (mode === 'clustered') {
        f.run();
        f.player('screen').pos.x = -5;
        f.player('support').pos = { x: -5, z: -5.5 };
      }
      if (mode === 'recovery-screen') f.player('screen').space!.phase = 'hammer_recover';
      const orders = f.run();
      assert.ok(
        orders.every((a) => !a.tipoff!.attack),
        mode,
      );
      assert.ok(orders.filter((a) => a.tipoff?.job === 'reserve').length <= 1);
    });
test('large hammer blasts expand lanes and keep extra attackers out', () => {
  const f = fixture();
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.space!.blastRadius = 4));
  const orders = f.run();
  assert.ok(orders.every((a) => a.tipoff!.spacing === 8.75));
  assert.ok(orders.filter((a) => a.tipoff!.attack).length <= 1);
});
test('loss of the reserve immediately revokes a non-immediate screen challenge', () => {
  const f = fixture();
  f.run();
  f.player('screen').pos.x = -3;
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'reserve');
  assert.equal(
    selectGrifballAssignmentThreat(f.state.assignments.get('screen')!, f.player('screen').pos, f.snapshot.players),
    null,
  );
});
test('collector death rotates ownership while retaining a surviving reserve', () => {
  const f = fixture();
  f.run();
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'collector');
  const orders = f.run(0);
  assert.equal(orders.filter((a) => a.tipoff?.job === 'collector').length, 1);
  assert.ok(orders.every((a) => a.tipoff!.collectorId !== 'collector'));
  assert.equal(orders.find((a) => a.tipoff?.job === 'reserve')!.botId, 'reserve');
});
test('an observed human collector keeps priority without receiving an assignment', () => {
  const f = fixture();
  const p = f.player('collector');
  p.scripted = false;
  p.pos.x = -1;
  p.pickupRequested = true;
  const orders = f.run();
  assert.equal(f.state.assignments.has('collector'), false);
  assert.ok(orders.every((a) => a.tipoff?.collectorId === 'collector'));
  assert.equal(orders.filter((a) => a.tipoff?.job === 'reserve').length, 1);
});
test('unreachable destinations retain current positions instead of inventing straight routes', () => {
  const f = fixture();
  f.snapshot.geometry!.blockers.push({
    kind: 'box',
    x: -9,
    z: 0,
    hx: 1,
    hz: 1,
  });
  const orders = f.run();
  assert.ok(orders.every((a) => Number.isFinite(a.destination.x) && Number.isFinite(a.destination.z)));
  assert.ok(
    orders.every(
      (a) => a.space?.route.status !== 'blocked' || fieldDistance(a.destination, f.player(a.botId).pos) < 0.01,
    ),
  );
});
for (const mode of ['possession', 'displaced', 'thrown', 'late-import', 'inactive'] as const)
  test(`${mode} closes tip-off without reopening on an auto-return`, () => {
    const f = fixture();
    if (mode !== 'late-import') f.run();
    if (mode === 'possession') {
      f.snapshot.holderId = 'enemy';
      f.snapshot.ballPhysics!.state = 'held';
    }
    if (mode === 'displaced') f.snapshot.ballPhysics!.pos.x = 2;
    if (mode === 'thrown') f.snapshot.ballPhysics!.state = 'thrown';
    if (mode === 'late-import') f.snapshot.ballPhysics!.looseTimer = 3;
    if (mode === 'inactive') f.snapshot.playing = false;
    f.run(0);
    assert.equal(f.state.tipoff!.closed, true);
    f.snapshot.holderId = null;
    f.snapshot.playing = true;
    returnBallHome(f.snapshot.ballPhysics!);
    assert.ok(f.run().every((a) => !a.tipoff));
    f.snapshot.round++;
    assert.ok(f.run().every((a) => a.tipoff));
  });
test('countdown does not spend the opening budget and timeouts interrupt slow refreshes', () => {
  const f = fixture();
  f.snapshot.playing = false;
  f.run(10);
  assert.equal(f.state.tipoff!.elapsed, 0);
  f.snapshot.playing = true;
  f.tactics.defaults.tipoffSeconds = 2;
  f.tactics.defaults.refreshSeconds = 0.5;
  f.run(1.9);
  assert.ok(f.state.assignments.get('collector')!.tipoff);
  assert.ok(f.run(0.11).every((a) => !a.tipoff));
  f.tactics.defaults.tipoffSeconds = 3;
  f.run(0);
  assert.equal(f.state.tipoff!.elapsed, 2.01);
  assert.ok(f.state.assignments.get('collector')!.tipoff);
  resetGrifballTeamPlan(f.state);
  assert.equal(f.state.tipoff, undefined);
});
for (const key of ['tipoffEnabled', 'enabled', 'spaceEnabled'] as const)
  test(`tip-off requires ${key}`, () => {
    const f = personalOpening('enforcer');
    f.tactics.defaults[key] = false;
    assert.ok(f.run().every((a) => !a.tipoff));
  });
test('tip-off independently owns combat spacing when ordinary tanking and defense are off', () => {
  const f = fixture();
  f.tactics.defaults.tankingEnabled = f.tactics.defaults.defenseEnabled = false;
  const orders = f.run();
  assert.ok(orders.every((a) => a.tipoff));
  assert.equal(orders.filter((a) => a.tipoff?.attack).length, 1);
});
test('stable collector/reserve roles, mirrors, main_ai, team overrides and checkpoint continuation', () => {
  for (const mirror of [false, true])
    for (const reverse of [false, true]) {
      const f = fixture();
      f.player('collector').id = 'main_ai';
      if (mirror)
        for (const p of f.snapshot.players) {
          p.team = p.team === 'blue' ? 'red' : 'blue';
          p.pos.x *= -1;
          p.pos.z *= -1;
        }
      if (reverse) f.snapshot.players.reverse();
      const team = mirror ? 'red' : 'blue';
      f.tactics.teams[team] = { tipoffSpacing: 7 };
      f.run();
      const a = f.state.assignments.get('main_ai')!;
      assert.equal(a.tipoff!.job, 'collector');
      assert.equal(a.tipoff!.spacing, 7);
      const copy = structuredClone(f.state);
      f.run();
      updateGrifballTeamPlan(copy, structuredClone(f.snapshot), 0.2);
      assert.deepEqual(copy, f.state);
      assert.equal(f.state.assignments.get('main_ai')!.tipoff!.job, 'collector');
    }
});
test('schema migration defaults tip-off off and preserves other styles and team overrides', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 32);
  assert.equal(config.defaults.tipoffEnabled, false);
  for (let version = 1; version <= 28; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    for (const key of ['tipoffEnabled', 'tipoffSeconds', 'tipoffPickupMargin', 'tipoffSpacing'])
      delete old.defaults[key];
    old.defaults.safetyAgencyStrength = 0.8;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { safetyAgencyStrength: 0.4 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffEnabled, false);
    assert.equal(next.defaults.tipoffSeconds, 8);
    assert.equal(next.defaults.safetyAgencyStrength, 0.8);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(resolveTeamTactics(next, 'red').safetyAgencyStrength, 0.4);
  }
  config.teams.red = { tipoffEnabled: true, tipoffSpacing: 9 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [{ tipoffEnabled: 1 }, { tipoffSeconds: 0 }, { tipoffSpacing: 13 }, { tipoffPickupMargin: NaN }])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: bad } }));
});

function openingLanes(style: GrifballPlayerStyle, strength = 1) {
  const f = fixture();
  f.tactics.defaults.tipoffPositionAgencyStrength = strength;
  f.tactics.botStyles = { collector: style, screen: style, support: style, reserve: style };
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 40));
  return f;
}

for (const [style, x, z] of [
  ['enforcer', -3.75, 6],
  ['opportunist', -4.5, 7.25],
  ['guardian', -5.75, 6],
] as const)
  test(`${style} moves a passive opening support without changing collector or reserve`, () => {
    const f = openingLanes(style),
      orders = f.run(),
      a = f.state.assignments.get('support')!;
    const baseline = openingLanes(style, 0);
    baseline.run();
    assert.equal(a.tipoff!.positioning!.applied, true, a.tipoff!.positioning!.reason);
    assert.deepEqual(a.destination, { x, z });
    assert.equal(a.tipoff!.positioning!.collectorId, 'collector');
    for (const id of ['collector', 'reserve']) {
      assert.deepEqual(f.state.assignments.get(id)!.destination, baseline.state.assignments.get(id)!.destination);
      assert.equal(f.state.assignments.get(id)!.tipoff!.positioning, undefined);
    }
    assert.ok(orders.every((a) => !a.tipoff!.attack));
    assert.equal(steer(f, 'support')!.pickupRequested, false);
    assert.equal(steer(f, 'collector')!.pickupRequested, true);
  });

test('passive screen lanes vary independently of decision timing and team styles', () => {
  const f = openingLanes('opportunist');
  f.run();
  const a = f.state.assignments.get('screen')!;
  assert.equal(a.tipoff!.job, 'screen');
  assert.equal(a.tipoff!.positioning!.applied, true, a.tipoff!.positioning!.reason);
  assert.deepEqual(a.destination, { x: -2, z: -7.25 });
  assert.equal(a.tipoff!.agency, undefined);
  f.tactics.defaults.tipoffAgencyStrength = 1;
  f.tactics.botStyles.collector = 'guardian';
  f.run(0);
  assert.equal(f.state.assignments.get('collector')!.tipoff!.agency!.style, 'guardian');
  assert.equal(f.state.assignments.get('screen')!.tipoff!.positioning!.style, 'opportunist');
});

test('personal opening lanes blend, reset immediately and keep neutral styles neutral', () => {
  const f = openingLanes('guardian', 0.5);
  f.run();
  assert.deepEqual(f.state.assignments.get('support')!.destination, { x: -5.125, z: 6 });
  f.tactics.defaults.tipoffPositionAgencyStrength = 0;
  f.run(0);
  const baseline = openingLanes('guardian', 0);
  baseline.run();
  const shape = (x: ReturnType<typeof fixture>) =>
    [...x.state.assignments.values()].map((a) => ({
      id: a.botId,
      role: a.role,
      destination: a.destination,
      order: a.tipoff,
    }));
  assert.deepEqual(shape(f), shape(baseline));
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  f.tactics.botStyles = {};
  f.run(0);
  assert.equal(f.state.assignments.get('support')!.tipoff!.positioning!.style, 'balanced');
  assert.equal(f.state.assignments.get('support')!.tipoff!.positioning!.applied, false);
  assert.deepEqual(
    f.state.assignments.get('support')!.destination,
    baseline.state.assignments.get('support')!.destination,
  );
});

test('earned opening challenges retain their exact point and single attacker', () => {
  const f = fixture();
  f.run();
  const screen = structuredClone(f.state.assignments.get('screen')!);
  assert.equal(screen.tipoff!.attack, true);
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  f.tactics.botStyles.screen = 'opportunist';
  const orders = f.run(0),
    a = f.state.assignments.get('screen')!;
  assert.equal(a.tipoff!.attack, true);
  assert.deepEqual(a.destination, screen.destination);
  assert.match(a.tipoff!.positioning!.reason, /earned screen challenge/);
  assert.equal(orders.filter((a) => a.tipoff!.attack).length, 1);
});

for (const mode of ['outnumbered', 'airborne', 'lunging', 'recovering', 'immobile'] as const)
  test(`${mode} keeps the team opening lane`, () => {
    const f = openingLanes('guardian');
    if (mode === 'outnumbered')
      f.snapshot.players.filter((p) => p.team === 'blue' && p.id !== 'collector').forEach((p) => (p.pos.x = -30));
    if (mode === 'outnumbered') f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 16));
    if (mode === 'airborne') f.player('support').height = 2;
    if (mode === 'lunging') f.player('support').space!.phase = 'lunging';
    if (mode === 'recovering') f.player('support').space!.phase = 'hammer_recover';
    if (mode === 'immobile') f.player('support').space!.mobileIn = 0.5;
    const orders = f.run();
    assert.ok(orders.some((a) => a.tipoff!.positioning));
    const a = f.state.assignments.get('support')!;
    assert.equal(a.tipoff!.positioning!.applied, false);
    assert.deepEqual(a.destination, a.tipoff!.positioning!.teamPoint);
  });

test('visible threat exposure can reject a forward opening preference', () => {
  const f = fixture();
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  f.tactics.botStyles.support = 'enforcer';
  f.run();
  const p = f.state.assignments.get('support')!.tipoff!.positioning!;
  assert.equal(p.applied, false);
  assert.match(p.reason, /attack margin/);
  assert.ok(p.preferredAttackMargin < p.teamAttackMargin);
});

test('slow support cannot take a wider lane that arrives too late', () => {
  const f = openingLanes('opportunist');
  f.player('support').pos = { x: -4.5, z: 6 };
  f.player('support').space!.speed = 1;
  f.run();
  const p = f.state.assignments.get('support')!.tipoff!.positioning!;
  assert.equal(p.applied, false);
  assert.match(p.reason, /0.35 s later/);
});

test('unreachable personal lane stays at the reachable team position', () => {
  const f = openingLanes('opportunist');
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -4.5, z: 7.25, hx: 0.3, hz: 0.3 });
  f.run();
  const p = f.state.assignments.get('support')!.tipoff!.positioning!;
  assert.equal(p.applied, false);
  assert.match(p.reason, /blocked ground route/);
});

test('large hammer spacing and observed teammates constrain personal lanes', () => {
  const f = openingLanes('guardian', 0);
  f.run();
  const orders = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const a = f.state.assignments.get('support')!;
  a.tipoff!.spacing = 9;
  // The future cover is still more than ordinary separation (4m) from the
  // observed teammate, but it would worsen the 9m opening reservation.
  f.snapshot.players.push({ ...actor('human', 'blue', -12, 6), scripted: false });
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  applyGrifballTipoffPosition(f.snapshot, orders, f.tactics.defaults, createSnapshotRouters(f.snapshot), false);
  assert.equal(a.tipoff!.positioning!.applied, false);
  assert.match(a.tipoff!.positioning!.reason, /reserved teammate/);
});

test('collector detour clearance uses every route segment, not the direct chord', () => {
  const f = openingLanes('opportunist', 0);
  f.run();
  const orders = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const routers = createSnapshotRouters(f.snapshot),
    route = routers.get('collector')!;
  // A waypoint path bends beside the proposed wider lane. Both destinations
  // have ample clearance to the straight collector-to-ball chord.
  routers.set('collector', ((point, lengthOnly) => {
    const original = route(point, lengthOnly);
    return {
      ...original,
      points: [
        { x: -8, z: 10 },
        { x: 0, z: 10 },
        { x: 0, z: 0 },
      ],
      length: 28,
    };
  }) as typeof route);
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  applyGrifballTipoffPosition(f.snapshot, orders, f.tactics.defaults, routers, false);
  const p = f.state.assignments.get('support')!.tipoff!.positioning!;
  assert.equal(p.applied, false);
  assert.match(p.reason, /collector route/);
  assert.ok(p.preferredClearance < p.teamClearance);
});

test('missing reserve or collector route rejects personal lanes', () => {
  for (const missing of ['reserve', 'route'] as const) {
    const f = openingLanes('guardian', 0);
    f.run();
    const orders = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
    if (missing === 'reserve') f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'reserve');
    const routers = createSnapshotRouters(f.snapshot);
    if (missing === 'route') routers.delete('collector');
    f.tactics.defaults.tipoffPositionAgencyStrength = 1;
    applyGrifballTipoffPosition(f.snapshot, orders, f.tactics.defaults, routers, false);
    const p = f.state.assignments.get('support')!.tipoff!.positioning!;
    assert.equal(p.applied, false);
    assert.match(p.reason, missing === 'reserve' ? /rear reserve/ : /collector route/);
  }
});

test('observed collector receives no order while personal covers preserve its route', () => {
  const f = openingLanes('opportunist');
  f.player('collector').scripted = false;
  f.player('collector').vel.x = 1;
  const orders = f.run();
  assert.equal(f.state.assignments.has('collector'), false);
  assert.ok(orders.some((a) => a.tipoff!.positioning?.applied));
  for (const a of orders.filter((a) => a.tipoff!.positioning?.applied)) {
    const p = a.tipoff!.positioning!;
    assert.equal(p.collectorId, 'collector');
    assert.ok(p.preferredClearance >= Math.min(a.tipoff!.spacing, p.teamClearance));
  }
});

test('lane styles follow main_ai through mirror, roster reorder, team override and checkpoint', () => {
  for (const mirror of [false, true])
    for (const reverse of [false, true]) {
      const f = openingLanes('guardian', 0);
      f.player('support').id = 'main_ai';
      f.tactics.botStyles.main_ai = 'guardian';
      const team = mirror ? 'red' : 'blue';
      f.tactics.teams[team] = { tipoffPositionAgencyStrength: 1 };
      if (mirror)
        for (const p of f.snapshot.players) {
          p.team = p.team === 'blue' ? 'red' : 'blue';
          p.pos.x *= -1;
          p.pos.z *= -1;
        }
      if (reverse) f.snapshot.players.reverse();
      f.run();
      const a = f.state.assignments.get('main_ai')!;
      assert.equal(a.tipoff!.positioning!.applied, true, a.tipoff!.positioning!.reason);
      assert.equal(a.tipoff!.positioning!.style, 'guardian');
      assert.ok([...f.state.assignments.values()].filter((a) => a.team !== team).every((a) => !a.tipoff?.positioning));
      const restored = structuredClone(f.state);
      f.run();
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), 0.2);
      assert.deepEqual(restored, f.state);
    }
});

test('first possession, module off and round timeout clear personal opening lanes', () => {
  for (const mode of ['possession', 'disabled', 'timeout'] as const) {
    const f = openingLanes('guardian');
    f.run();
    if (mode === 'possession') {
      f.snapshot.holderId = 'collector';
      f.snapshot.ballPhysics!.holderId = 'collector';
      f.snapshot.ballPhysics!.state = 'held';
    }
    if (mode === 'disabled') f.tactics.defaults.tipoffEnabled = false;
    f.run(mode === 'timeout' ? 9 : 0);
    assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff?.positioning));
  }
});

test('opening lane preferences require coordination and space awareness', () => {
  for (const key of ['enabled', 'spaceEnabled'] as const) {
    const f = openingLanes('opportunist');
    f.tactics.defaults[key] = false;
    assert.ok(f.run().every((a) => !a.tipoff?.positioning));
  }
});

test('position individuality migrates old presets at zero while preserving opening decisions', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.defaults.tipoffPositionAgencyStrength, 0);
  for (let version = 1; version <= 30; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.tipoffPositionAgencyStrength;
    old.defaults.tipoffEnabled = true;
    old.defaults.tipoffAgencyStrength = 0.7;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { tipoffAgencyStrength: 0.4 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffPositionAgencyStrength, 0);
    assert.equal(next.defaults.tipoffEnabled, true);
    assert.equal(next.defaults.tipoffAgencyStrength, 0.7);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(next.teams.red!.tipoffAgencyStrength, 0.4);
  }
  current.defaults.tipoffPositionAgencyStrength = 0.6;
  current.teams.red = { tipoffPositionAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const value of [-0.1, 1.1, NaN, Infinity, '1', true])
    assert.throws(() =>
      validateGrifballTactics({ ...current, teams: { red: { tipoffPositionAgencyStrength: value } } }),
    );
  const incomplete = JSON.parse(JSON.stringify(current));
  delete incomplete.defaults.tipoffPositionAgencyStrength;
  assert.throws(() => validateGrifballTactics(incomplete));
});

function regroupFixture(seconds = 1) {
  const f = fixture();
  f.tactics.defaults.tipoffRegroupSeconds = seconds;
  f.tactics.defaults.refreshSeconds = 1;
  // After one loss the team can still contest on numbers alone, exposing the
  // difference between an explicit recovery interval and ordinary containment.
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'enemy-back');
  return f;
}
const lose = (f: ReturnType<typeof fixture>, id: string) => {
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== id);
};

test('opening loss withdraws the next challenge immediately, restores spaced lanes, then resumes', () => {
  const f = regroupFixture();
  assert.equal(f.run(0.05).filter((a) => a.tipoff!.attack).length, 1);
  const priorPoint = { ...f.state.assignments.get('screen')!.destination };
  lose(f, 'support');
  const orders = f.run(0);
  assert.ok(orders.every((a) => a.tipoff!.phase === 'regroup' && !a.tipoff!.attack));
  assert.deepEqual(orders.map((a) => a.tipoff!.job).sort(), ['collector', 'reserve', 'support']);
  assert.deepEqual(f.state.tipoff!.recovery!.blue.affectedIds, ['support']);
  assert.equal(f.state.assignments.get('collector')!.tipoff!.collectorId, 'collector');
  const screen = f.state.assignments.get('screen')!,
    reserve = f.state.assignments.get('reserve')!;
  assert.ok(screen.destination.x < priorPoint.x);
  assert.ok(fieldDistance(screen.destination, reserve.destination) >= screen.tipoff!.spacing);
  assert.equal(steer(f, 'collector')!.pickupRequested, false);
  assert.ok(f.run(0.99).every((a) => !a.tipoff!.attack));
  assert.equal(f.run(0.01).filter((a) => a.tipoff!.attack).length, 1, 'expiry must interrupt the 1 s planner throttle');
  assert.equal(f.state.tipoff!.recovery, undefined);
});

test('zero regroup time preserves the previous opening decisions exactly', () => {
  const f = regroupFixture(0);
  f.run(0.05);
  lose(f, 'support');
  const orders = f.run(0);
  assert.equal(orders.filter((a) => a.tipoff!.attack).length, 1);
  assert.ok(orders.every((a) => !a.tipoff!.recovery));
  assert.equal(f.state.tipoff!.recovery, undefined);
});

for (const id of ['collector', 'reserve'])
  for (const change of ['airborne', 'immobile', 'lunging'] as const)
    test(`${id} ${change} starts recovery before the next tactical refresh`, () => {
      const f = regroupFixture();
      f.run(0.05);
      if (change === 'airborne') f.player(id).height = 1;
      if (change === 'immobile') f.player(id).space!.mobileIn = 1;
      if (change === 'lunging') f.player(id).space!.phase = 'lunging';
      assert.ok(f.run(0).every((a) => a.tipoff!.phase === 'regroup' && !a.tipoff!.attack));
      assert.deepEqual(f.state.tipoff!.recovery!.blue.affectedIds, [id]);
      const start = f.state.tipoff!.recovery!.blue.startedAt;
      f.run(0.4);
      assert.equal(f.state.tipoff!.recovery!.blue.startedAt, start);
      f.run(0.6);
      assert.equal(f.state.tipoff!.recovery, undefined, 'persistent displacement must not restart recovery');
    });

test('screen attack commitment, enemy losses and newly arriving allies do not trigger regrouping', () => {
  const f = regroupFixture();
  f.run(0.05);
  f.player('screen').space!.phase = 'lunging';
  f.player('screen').height = 1;
  lose(f, 'enemy-support');
  f.snapshot.players.push(actor('newcomer', 'blue', -40));
  f.run(0.05);
  assert.equal(f.state.tipoff!.recovery?.blue, undefined);
  assert.deepEqual(f.state.tipoff!.recovery!.red.affectedIds, ['enemy-support']);
});

test('loss of collector or reserve chooses surviving owners during recovery', () => {
  for (const id of ['collector', 'reserve']) {
    const f = regroupFixture();
    f.run(0.05);
    lose(f, id);
    const orders = f.run(0);
    assert.ok(orders.every((a) => a.tipoff!.phase === 'regroup' && !a.tipoff!.attack));
    assert.equal(orders.filter((a) => a.tipoff!.job === 'collector').length, 1);
    assert.equal(orders.filter((a) => a.tipoff!.job === 'reserve').length, 1);
    assert.ok(orders.every((a) => a.tipoff!.collectorId !== id && a.tipoff!.reserveId !== id));
  }
});

test('regrouping still collects a clear pickup and retains immediate self-defense', () => {
  const f = regroupFixture();
  f.run(0.05);
  lose(f, 'support');
  f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 40));
  const orders = f.run(0);
  assert.ok(orders.every((a) => a.tipoff!.phase === 'regroup'));
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  assert.equal(orders.filter((a) => a.role === 'retriever').length, 1);
  for (const a of orders) {
    f.player('enemy').pos = { x: f.player(a.botId).pos.x + 1, z: f.player(a.botId).pos.z };
    assert.equal(selectGrifballAssignmentThreat(a, f.player(a.botId).pos, f.snapshot.players), 'enemy');
  }
});

test('observed collector is respected and its displacement can trigger support recovery', () => {
  const f = regroupFixture();
  const human = f.player('collector');
  human.scripted = false;
  human.vel.x = 5;
  f.run(0.05);
  human.height = 1;
  const orders = f.run(0);
  assert.equal(f.state.assignments.has('collector'), false);
  assert.ok(orders.every((a) => a.tipoff!.collectorId === 'collector' && a.tipoff!.recovery));
});

test('regroup lanes take priority over individual positioning', () => {
  const f = regroupFixture();
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  f.tactics.botStyles.screen = 'enforcer';
  f.run(0.05);
  lose(f, 'support');
  f.run(0);
  const decision = f.state.assignments.get('screen')!.tipoff!.positioning!;
  assert.equal(decision.applied, false);
  assert.match(decision.reason, /regrouping/);
});

test('new losses restart recovery but live duration increases never extend it', () => {
  const f = regroupFixture();
  f.run(0.05);
  lose(f, 'support');
  f.run(0);
  f.run(0.4);
  const start = f.state.tipoff!.recovery!.blue.startedAt;
  f.tactics.defaults.tipoffRegroupSeconds = 3;
  f.run(0);
  assert.equal(f.state.tipoff!.recovery!.blue.duration, 1);
  lose(f, 'screen');
  f.run(0);
  assert.ok(f.state.tipoff!.recovery!.blue.startedAt > start);
  assert.equal(f.state.tipoff!.recovery!.blue.duration, 3);
  assert.deepEqual(f.state.tipoff!.recovery!.blue.affectedIds, ['screen']);
  f.run(0.4);
  f.tactics.defaults.tipoffRegroupSeconds = 0.25;
  f.run(0);
  assert.equal(f.state.tipoff!.recovery, undefined);
});

for (const key of ['tipoffEnabled', 'enabled', 'spaceEnabled', 'tipoffRegroupSeconds'] as const)
  test(`disabling ${key} clears recovery and re-enabling does not replay losses`, () => {
    const f = regroupFixture();
    f.run(0.05);
    lose(f, 'support');
    f.run(0);
    Object.assign(f.tactics.defaults, { [key]: key === 'tipoffRegroupSeconds' ? 0 : false });
    f.run(0);
    assert.equal(f.state.tipoff!.recovery, undefined);
    Object.assign(f.tactics.defaults, { [key]: key === 'tipoffRegroupSeconds' ? 1 : true });
    f.run(0);
    assert.equal(f.state.tipoff!.recovery, undefined);
    assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff?.recovery));
  });

for (const end of ['possession', 'displacement', 'timeout', 'round', 'pause', 'reset'] as const)
  test(`${end} clears opening recovery`, () => {
    const f = regroupFixture(3);
    f.run(0.05);
    lose(f, 'support');
    f.run(0);
    if (end === 'reset') resetGrifballTeamPlan(f.state);
    else {
      if (end === 'possession') f.snapshot.holderId = 'collector';
      if (end === 'displacement') f.snapshot.ballPhysics!.pos.x = 2;
      if (end === 'round') f.snapshot.round++;
      if (end === 'pause') f.snapshot.playing = false;
      if (end === 'timeout') f.tactics.defaults.tipoffSeconds = 2;
      f.run(end === 'timeout' ? 2.01 : 0);
    }
    assert.equal(f.state.tipoff?.recovery, undefined);
    assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff?.recovery));
  });

test('team-scoped recovery follows main_ai through mirrored reorder and checkpoint continuation', () => {
  for (const mirror of [false, true]) {
    const f = regroupFixture(0),
      team = mirror ? 'red' : 'blue';
    f.player('collector').id = 'main_ai';
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.tactics.teams[team] = { tipoffRegroupSeconds: 1 };
    f.run(0.05);
    lose(f, 'support');
    f.run(0);
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.phase, 'regroup');
    assert.deepEqual(Object.keys(f.state.tipoff!.recovery!), [team]);
    const copy = structuredClone(f.state);
    f.run(0.5);
    updateGrifballTeamPlan(copy, structuredClone(f.snapshot), 0.5);
    assert.deepEqual(copy, f.state);
    f.run(0.5);
    updateGrifballTeamPlan(copy, structuredClone(f.snapshot), 0.5);
    assert.deepEqual(copy, f.state);
    assert.equal(f.state.tipoff!.recovery, undefined);
  }
});

test('v32 migrations disable regrouping without changing styles or existing opening controls', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 32);
  assert.equal(config.defaults.tipoffRegroupSeconds, 0);
  for (let v = 1; v < 32; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffRegroupSeconds;
    old.defaults.tipoffPositionAgencyStrength = 0.6;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { tipoffAgencyStrength: 0.8 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffRegroupSeconds, 0);
    assert.equal(next.defaults.tipoffPositionAgencyStrength, 0.6);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(next.teams.red!.tipoffAgencyStrength, 0.8);
  }
  config.defaults.tipoffRegroupSeconds = 1;
  config.teams.red = { tipoffRegroupSeconds: 2 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [-0.1, 3.1, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffRegroupSeconds: bad } } }));
  const incomplete = JSON.parse(JSON.stringify(config));
  delete incomplete.defaults.tipoffRegroupSeconds;
  assert.throws(() => validateGrifballTactics(incomplete));
});
