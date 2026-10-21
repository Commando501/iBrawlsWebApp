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
  assert.equal(config.schemaVersion, 30);
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
