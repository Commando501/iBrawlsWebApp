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
import { chooseTipoffScreen } from './aiGrifballTipoffScreen';
import { chooseTipoffTarget } from './aiGrifballTipoffTarget';

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
  assert.equal(config.schemaVersion, 41);
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
  assert.equal(config.schemaVersion, 41);
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

function personalRegroup(style: GrifballPlayerStyle, strength = 1) {
  const f = regroupFixture(0.5);
  f.tactics.defaults.tipoffRecoveryAgencyStrength = strength;
  f.tactics.botStyles = { screen: style, collector: 'guardian', reserve: 'guardian' };
  return f;
}
function startPersonalRegroup(f: ReturnType<typeof fixture>) {
  f.run(0.05);
  lose(f, 'support');
  f.run(0);
}

for (const [style, extra] of [
  ['balanced', 0],
  ['enforcer', 0],
  ['opportunist', 0.25],
  ['guardian', 0.5],
] as const)
  test(`${style} resumes only after its own bounded recovery interval`, () => {
    const f = personalRegroup(style);
    startPersonalRegroup(f);
    const initial = f.state.assignments.get('screen')!.tipoff!.recoveryAgency!;
    assert.equal(initial.style, style);
    assert.equal(initial.teamDuration, 0.5);
    assert.equal(initial.duration, 0.5 + extra);
    assert.ok(
      f.run(0.49).every((a) => !a.tipoff!.attack),
      'no style may leave the shared recovery early',
    );
    f.run(0.01);
    const a = f.state.assignments.get('screen')!;
    assert.equal(a.tipoff!.attack, extra === 0);
    assert.equal(
      f.state.assignments.get('collector')!.tipoff!.phase,
      'contest',
      'shared expiry interrupts slow refresh',
    );
    assert.equal(a.tipoff!.phase, extra > 0 ? 'regroup' : 'contest');
    assert.equal(a.tipoff!.recovery, undefined, 'personal wait must not extend the shared interval');
    if (extra) {
      assert.equal(a.tipoff!.job, 'support');
      assert.equal(a.tanking!.mode, 'delay');
      f.run(extra - 0.01);
      assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, false);
      f.run(0.01);
      assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true, 'personal expiry interrupts slow refresh');
    }
    assert.equal(f.state.assignments.get('collector')!.tipoff!.recoveryAgency, undefined);
    assert.equal(f.state.assignments.get('reserve')!.tipoff!.recoveryAgency, undefined);
  });

test('recovery preference blends independently of opening timing, lanes and team style', () => {
  const f = personalRegroup('guardian', 0.5);
  startPersonalRegroup(f);
  f.run(0.5);
  const a = f.state.assignments.get('screen')!;
  assert.equal(a.tipoff!.recoveryAgency!.duration, 0.75);
  assert.ok(a.tipoff!.recoveryAgency!.remaining > 0.24 && a.tipoff!.recoveryAgency!.remaining < 0.26);
  assert.equal(f.tactics.defaults.stylesEnabled, false);
  assert.equal(a.tipoff!.agency, undefined);
  assert.equal(a.tipoff!.positioning, undefined);
  f.run(0.25);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true);
});

test('another eligible teammate screens while a cautious bot keeps its personal recovery lane', () => {
  const f = personalRegroup('guardian');
  f.snapshot.players.push(actor('backup', 'blue', -12, 12));
  f.tactics.botStyles.backup = 'enforcer';
  startPersonalRegroup(f);
  f.run(0.5);
  const waiting = f.state.assignments.get('screen')!,
    backup = f.state.assignments.get('backup')!;
  assert.equal(waiting.tipoff!.job, 'support');
  assert.equal(waiting.tipoff!.phase, 'regroup');
  assert.equal(backup.tipoff!.job, 'screen');
  assert.equal(backup.tipoff!.phase, 'contest');
  assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
  assert.equal(f.state.assignments.get('collector')!.tipoff!.job, 'collector');
  assert.ok([...f.state.assignments.values()].filter((a) => a.team === 'blue' && a.tipoff!.attack).length <= 1);
  assert.ok(fieldDistance(waiting.destination, backup.destination) >= waiting.tipoff!.spacing);
});

test('extra recovery never blocks a safe pickup, observed collector, or immediate defense', () => {
  for (const human of [false, true]) {
    const f = personalRegroup('guardian');
    if (human) {
      f.player('collector').scripted = false;
      f.player('collector').vel.x = 5;
    }
    startPersonalRegroup(f);
    f.snapshot.players.filter((p) => p.team === 'red').forEach((p) => (p.pos.x = 40));
    f.run(0.5);
    if (!human) assert.equal(steer(f, 'collector')!.pickupRequested, true);
    else assert.equal(f.state.assignments.has('collector'), false);
    const a = f.state.assignments.get('screen')!;
    assert.equal(a.tipoff!.collectorId, 'collector');
    assert.equal(a.tipoff!.phase, 'regroup');
    f.player('enemy').pos = { x: f.player('screen').pos.x + 1, z: f.player('screen').pos.z };
    assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy');
  }
});

test('regroup individuality cannot override containment, missing reserve or positioning protection', () => {
  const f = personalRegroup('guardian');
  f.tactics.defaults.tipoffPositionAgencyStrength = 1;
  startPersonalRegroup(f);
  f.run(0.5);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.positioning!.applied, false);
  assert.match(f.state.assignments.get('screen')!.tipoff!.positioning!.reason, /regrouping/);
  lose(f, 'reserve');
  f.run(0);
  f.run(1.1);
  assert.ok(
    f.run(0.2).every((a) => !a.tipoff!.attack),
    'two survivors cannot re-enter as a full contest',
  );
});

test('zero individuality and neutral style preserve shared recovery behavior', () => {
  const baseline = personalRegroup('guardian', 0),
    neutral = personalRegroup('balanced', 1);
  for (const f of [baseline, neutral]) {
    f.tactics.botStyles.collector = 'balanced';
    f.tactics.botStyles.reserve = 'balanced';
    startPersonalRegroup(f);
  }
  for (const dt of [0.2, 0.3, 0.25]) {
    baseline.run(dt);
    neutral.run(dt);
    for (const id of ['collector', 'screen', 'reserve']) {
      const a = baseline.state.assignments.get(id)!,
        b = neutral.state.assignments.get(id)!;
      assert.deepEqual(a.destination, b.destination);
      assert.equal(a.tipoff!.job, b.tipoff!.job);
      assert.equal(a.tipoff!.attack, b.tipoff!.attack);
      assert.equal(a.tipoff!.recoveryAgency, undefined);
    }
  }
});

test('live strength and style changes can shorten but cannot extend captured waits', () => {
  for (const change of ['strength', 'style'] as const) {
    const f = personalRegroup('opportunist', 0.5);
    startPersonalRegroup(f);
    const cap = f.state.tipoff!.recovery!.blue.personal!.screen;
    if (change === 'strength') f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
    else f.tactics.botStyles.screen = 'guardian';
    f.run(0.5);
    assert.equal(f.state.tipoff!.recovery!.blue.personal!.screen, cap);
    f.run(0.125);
    assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
  }
  const f = personalRegroup('guardian');
  startPersonalRegroup(f);
  f.run(0.6);
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 0.1;
  f.run(0);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
  f.run(0);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen', 'a released wait cannot restart');
});

test('shortening shared duration keeps spent time and increasing it cannot prolong personal recovery', () => {
  const f = personalRegroup('guardian');
  startPersonalRegroup(f);
  f.run(0.5);
  f.tactics.defaults.tipoffRegroupSeconds = 0.25;
  f.run(0);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.recoveryAgency!.duration, 0.75);
  f.tactics.defaults.tipoffRegroupSeconds = 3;
  f.run(0);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.recoveryAgency!.duration, 0.75);
  f.run(0.25);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
});

test('enabling individuality mid-recovery and joining late cannot invent personal waits', () => {
  const f = personalRegroup('guardian', 0);
  startPersonalRegroup(f);
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
  f.snapshot.players.push(actor('late', 'blue', -14, 12));
  f.tactics.botStyles.late = 'guardian';
  f.run(0.5);
  assert.equal(f.state.tipoff!.recovery, undefined);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
  assert.equal(f.state.assignments.get('late')!.tipoff!.recoveryAgency, undefined);
});

test('a new disruption captures new preferences; continuous unavailability does not restart them', () => {
  const f = personalRegroup('opportunist', 0.5);
  startPersonalRegroup(f);
  f.run(0.4);
  f.tactics.botStyles.screen = 'guardian';
  f.player('collector').height = 1;
  f.run(0);
  const start = f.state.tipoff!.recovery!.blue.startedAt;
  assert.equal(f.state.tipoff!.recovery!.blue.personal!.screen, 0.75);
  f.run(0.3);
  assert.equal(f.state.tipoff!.recovery!.blue.startedAt, start);
  f.run(0.45);
  assert.equal(f.state.tipoff!.recovery, undefined);
});

for (const key of [
  'tipoffRecoveryAgencyStrength',
  'tipoffRegroupSeconds',
  'tipoffEnabled',
  'enabled',
  'spaceEnabled',
] as const)
  test(`${key} off clears personal recovery immediately without replay`, () => {
    const f = personalRegroup('guardian');
    startPersonalRegroup(f);
    f.run(0.5);
    const prior = f.tactics.defaults[key];
    Object.assign(f.tactics.defaults, { [key]: typeof prior === 'number' ? 0 : false });
    f.run(0);
    assert.equal(f.state.tipoff!.recovery, undefined);
    assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff?.recoveryAgency));
    Object.assign(f.tactics.defaults, { [key]: prior });
    f.run(0);
    assert.equal(f.state.tipoff!.recovery, undefined);
  });

for (const ending of ['possession', 'displaced', 'round', 'timeout', 'reset'] as const)
  test(`${ending} clears personal recovery after the team interval`, () => {
    const f = personalRegroup('guardian');
    startPersonalRegroup(f);
    f.run(0.5);
    if (ending === 'reset') resetGrifballTeamPlan(f.state);
    else {
      if (ending === 'possession') f.snapshot.holderId = 'collector';
      if (ending === 'displaced') f.snapshot.ballPhysics!.pos.x = 2;
      if (ending === 'round') f.snapshot.round++;
      f.run(ending === 'timeout' ? 8 : 0);
    }
    assert.equal(f.state.tipoff?.recovery, undefined);
    assert.ok([...f.state.assignments.values()].every((a) => !a.tipoff?.recoveryAgency));
  });

test('personal recovery survives JSON continuation and follows main_ai under mirrored team overrides', () => {
  for (const mirror of [false, true])
    for (const reverse of [false, true]) {
      const f = personalRegroup('guardian', 0),
        team = mirror ? 'red' : 'blue';
      f.player('screen').id = 'main_ai';
      f.tactics.botStyles.main_ai = 'guardian';
      f.tactics.teams[team] = { tipoffRecoveryAgencyStrength: 1 };
      if (mirror)
        for (const p of f.snapshot.players) {
          p.team = p.team === 'blue' ? 'red' : 'blue';
          p.pos.x *= -1;
          p.pos.z *= -1;
        }
      if (reverse) f.snapshot.players.reverse();
      startPersonalRegroup(f);
      f.run(0.5);
      assert.equal(f.state.assignments.get('main_ai')!.tipoff!.recoveryAgency!.style, 'guardian');
      const saved = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
      const restored = { ...saved, assignments: new Map(saved.assignments) };
      const persisted = (s: typeof f.state) => JSON.stringify({ ...s, assignments: [...s.assignments] });
      for (const dt of [0.2, 0.3]) {
        f.run(dt);
        updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
        assert.equal(persisted(restored), persisted(f.state));
      }
      assert.equal(f.state.assignments.get('main_ai')!.tipoff!.job, 'screen');
    }
});

test('v33 migration disables recovery individuality and preserves regroup and style settings', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffRecoveryAgencyStrength, 0);
  for (let v = 1; v <= 32; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffRecoveryAgencyStrength;
    old.defaults.tipoffRegroupSeconds = 1.25;
    old.defaults.tipoffPositionAgencyStrength = 0.6;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { tipoffRegroupSeconds: 2 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffRecoveryAgencyStrength, 0);
    assert.equal(next.defaults.tipoffRegroupSeconds, 1.25);
    assert.equal(next.defaults.tipoffPositionAgencyStrength, 0.6);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(next.teams.red!.tipoffRegroupSeconds, 2);
  }
  config.defaults.tipoffRecoveryAgencyStrength = 0.7;
  config.teams.red = { tipoffRecoveryAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffRecoveryAgencyStrength: bad } } }));
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffRecoveryAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});

function handoffFixture() {
  const f = fixture();
  f.tactics.defaults.tipoffScreenHandoffEnabled = true;
  f.tactics.defaults.refreshSeconds = 1;
  // Three nearby enemies allow a displaced fourth ally without weakening containment.
  f.player('enemy-back').pos.x = 40;
  return f;
}

for (const condition of ['airborne', 'movement-locked', 'recovering', 'missing-observation'] as const)
  test(`tip-off hands off a ${condition} screen immediately and retains the replacement`, () => {
    const f = handoffFixture();
    f.run(0.01);
    assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
    const revision = f.state.revision;
    const p = f.player('screen'),
      original = structuredClone(p);
    if (condition === 'airborne') p.height = 1;
    if (condition === 'movement-locked') p.space!.mobileIn = 0.5;
    if (condition === 'recovering') p.space!.phase = 'hammer_recover';
    if (condition === 'missing-observation') delete p.space;
    f.run(0);
    assert.ok(f.state.revision > revision);
    const a = f.state.assignments.get('support')!;
    assert.equal(a.tipoff!.job, 'screen');
    assert.equal(a.tipoff!.screenSelection!.previousId, 'screen');
    assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'support');
    assert.equal(f.state.assignments.get('collector')!.tipoff!.job, 'collector');
    assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
    assert.ok([...f.state.assignments.values()].filter((a) => a.team === 'blue' && a.tipoff?.attack).length <= 1);
    Object.assign(p, original);
    f.run(0);
    assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'screen', 'no automatic take-back');
    const stableRevision = f.state.revision;
    f.run(0.01);
    assert.equal(f.state.revision, stableRevision, 'unchanged readiness retains ordinary refresh throttling');
  });

for (const phase of [
  'swing_up',
  'swing_down',
  'slashing',
  'melee_up',
  'melee_down',
  'melee_swing',
  'lunging',
  'windup',
  'active',
])
  test(`tip-off waits for an incumbent ${phase} before handoff`, () => {
    const f = handoffFixture();
    f.run(0.01);
    f.player('screen').space!.phase = phase;
    f.run(0);
    assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
    assert.ok(f.run(0).every((a) => !a.tipoff?.attack));
    assert.match(f.state.assignments.get('support')!.tipoff!.screenSelection!.reason, /finish its visible attack/);
    f.player('screen').space!.phase = 'hammer_recover';
    f.run(0);
    assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'screen');
  });

test('tip-off handoff leaves no screen when both supports are unavailable, then resumes immediately', () => {
  const f = handoffFixture();
  f.run(0.01);
  for (const id of ['screen', 'support']) f.player(id).space!.phase = 'hammer_recover';
  assert.ok(f.run(0).every((a) => a.tipoff?.job !== 'screen'));
  assert.match(f.state.assignments.get('support')!.tipoff!.screenSelection!.reason, /No ready support/);
  f.player('support').space!.phase = 'ready';
  f.run(0);
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'screen');
});

test('screen handoff toggle off preserves the old role selection and omits diagnostics', () => {
  const f = handoffFixture();
  f.tactics.defaults.tipoffScreenHandoffEnabled = false;
  f.run();
  f.player('screen').space!.phase = 'hammer_recover';
  f.run(1);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.job, 'screen');
  assert.ok(f.run().every((a) => !a.tipoff?.screenSelection));
  f.tactics.defaults.tipoffScreenHandoffEnabled = true;
  f.run(0);
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'screen');
  f.tactics.defaults.tipoffScreenHandoffEnabled = false;
  assert.ok(f.run(0).every((a) => !a.tipoff?.screenSelection));
});

test('screen handoff cannot draft the collector or reserve, bypass containment, or interrupt safe pickup', () => {
  const f = handoffFixture();
  f.player('screen').height = 1;
  f.player('enemy-back').pos.x = 16;
  assert.ok(
    f.run().every((a) => a.tipoff?.job !== 'screen'),
    'local numbers still require containment',
  );
  f.player('enemy-back').pos.x = 40;
  f.player('support').height = 1;
  assert.ok(
    f.run().every((a) => a.tipoff?.job !== 'screen'),
    'only collector/reserve available',
  );
  f.player('screen').height = 0;
  f.player('support').height = 0;
  pickupWindow(f, 1);
  f.run();
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  f.player('collector').scripted = false;
  f.player('collector').pickupRequested = true;
  f.player('collector').pos.x = -1;
  f.run(0);
  assert.ok(!f.state.assignments.has('collector'));
  assert.ok(f.run().every((a) => a.tipoff!.collectorId === 'collector'));
});

test('screen handoff respects shared and personal recovery and immediate defense', () => {
  const f = handoffFixture();
  f.tactics.defaults.tipoffRegroupSeconds = 0.5;
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
  f.tactics.botStyles.support = 'guardian';
  f.snapshot.players.push(actor('extra', 'blue', -12, 12));
  f.run(0.01);
  lose(f, 'extra');
  assert.ok(f.run(0).every((a) => a.tipoff?.job !== 'screen'));
  f.player('screen').space!.phase = 'hammer_recover';
  assert.ok(
    f.run(0.5).every((a) => a.tipoff?.job !== 'screen'),
    'Guardian still holds its personal lane',
  );
  const held = f.state.assignments.get('support')!;
  const nearby = structuredClone(f.snapshot.players);
  nearby.find((p) => p.id === 'enemy')!.pos = { x: f.player('support').pos.x + 1, z: f.player('support').pos.z };
  assert.equal(selectGrifballAssignmentThreat(held, f.player('support').pos, nearby), 'enemy');
  f.run(0.5);
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'screen');
});

test('screen selection skips unreachable candidates and holds an in-flight commitment even during personal recovery', () => {
  const p = actor('screen', 'blue', -8),
    q = actor('support', 'blue', -10, 6);
  const candidates = [
    { player: p, reachable: false, holding: false },
    { player: q, reachable: true, holding: false },
  ];
  assert.equal(chooseTipoffScreen(candidates, 'screen', true).selectedId, 'support');
  q.space!.phase = 'hammer_recover';
  assert.equal(chooseTipoffScreen(candidates, 'screen', true).selectedId, null);
  q.space!.phase = 'ready';
  p.space!.phase = 'swing_up';
  candidates[0].holding = true;
  assert.equal(chooseTipoffScreen(candidates, 'screen', true).selectedId, null);
  assert.equal(
    chooseTipoffScreen(candidates, null, true).selectedId,
    null,
    'a cleared role cannot hide the active strike',
  );
});

test('screen handoff depends on enabled opening controls and stops at possession, timeout and reset', () => {
  for (const key of ['enabled', 'spaceEnabled', 'tipoffEnabled'] as const) {
    const f = handoffFixture();
    f.run();
    f.tactics.defaults[key] = false;
    assert.ok(f.run(0).every((a) => !a.tipoff?.screenSelection));
  }
  const f = handoffFixture();
  f.run();
  f.snapshot.holderId = 'collector';
  assert.ok(f.run(0).every((a) => !a.tipoff));
  f.snapshot.holderId = null;
  assert.ok(f.run(0).every((a) => !a.tipoff));
  f.snapshot.round++;
  assert.ok(f.run(0).every((a) => a.tipoff?.screenSelection));
  assert.ok(f.run(9).every((a) => !a.tipoff));
  resetGrifballTeamPlan(f.state);
  assert.ok(f.run(0).every((a) => a.tipoff?.screenSelection));
});

test('screen handoff is deterministic across mirroring, roster order, main_ai and serialized continuation', () => {
  for (const mirror of [false, true]) {
    const f = handoffFixture();
    f.player('support').id = 'main_ai';
    if (mirror) {
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
      f.snapshot.players.reverse();
    }
    f.tactics.teams[mirror ? 'blue' : 'red'] = { tipoffScreenHandoffEnabled: false };
    f.run(0.01);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('screen').space!.phase = 'hammer_recover';
    for (const dt of [0, 0.2]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.job, 'screen');
  }
});

test('v34 screen handoff migration, overrides and strict boolean validation', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffScreenHandoffEnabled, false);
  for (let version = 1; version < 34; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.tipoffScreenHandoffEnabled;
    old.defaults.tipoffRecoveryAgencyStrength = 0.7;
    old.teams.red = { tipoffRegroupSeconds: 1.25 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffScreenHandoffEnabled, false);
    assert.equal(next.defaults.tipoffRecoveryAgencyStrength, 0.7);
    assert.equal(next.teams.red!.tipoffRegroupSeconds, 1.25);
  }
  config.defaults.tipoffScreenHandoffEnabled = true;
  config.teams.red = { tipoffScreenHandoffEnabled: false };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'red').tipoffScreenHandoffEnabled, false);
  for (const bad of [0, 1, 'true', null, {}])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffScreenHandoffEnabled: bad } } }));
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffScreenHandoffEnabled;
  assert.throws(() => validateGrifballTactics(missing));
});

test('a replacement earns its own challenge and uses its own Grifball style', () => {
  const f = handoffFixture();
  f.run(0.01);
  f.player('screen').space!.phase = 'hammer_recover';
  f.player('support').pos = { x: -4, z: 6 };
  f.player('enemy-screen').pos = { x: 2, z: 6 };
  f.run(0);
  let a = f.state.assignments.get('support')!;
  assert.equal(a.tipoff!.job, 'screen');
  assert.equal(a.tipoff!.attack, true, 'the replacement can earn a real challenge');
  assert.equal(selectGrifballAssignmentThreat(a, f.player('support').pos, f.snapshot.players), 'enemy-screen');
  f.tactics.defaults.tipoffAgencyStrength = 1;
  f.tactics.botStyles = { screen: 'enforcer', support: 'guardian' };
  f.run(0);
  a = f.state.assignments.get('support')!;
  assert.equal(a.tipoff!.agency!.style, 'guardian');
  assert.equal(a.tipoff!.attack, false, 'the old screen cannot lend its less cautious timing');
  f.tactics.defaults.tipoffAgencyStrength = 0;
  f.player('collector').pos = { x: -4, z: 3 };
  f.run(0);
  assert.equal(
    f.state.assignments.get('support')!.tipoff!.attack,
    false,
    'shared hammer exposure still blocks the replacement',
  );
});

function screenAgencyFixture(style: GrifballPlayerStyle, strength = 1) {
  const f = handoffFixture();
  f.tactics.defaults.tipoffScreenAgencyStrength = strength;
  f.player('support').pos.x = -9;
  f.tactics.botStyles.support = style;
  return f;
}
const screenChoice = (f: ReturnType<typeof fixture>) => f.state.assignments.get('support')!.tipoff!.screenSelection!;

for (const [style, expected] of [
  ['balanced', 'screen'],
  ['enforcer', 'support'],
  ['opportunist', 'screen'],
  ['guardian', 'screen'],
] as const)
  test(`${style} bids for a vacant opening screen within the nearby arrival window`, () => {
    const f = screenAgencyFixture(style);
    f.run();
    const choice = screenChoice(f),
      agency = choice.agency!;
    assert.equal(choice.selectedId, expected);
    assert.equal(agency.baselineId, 'screen');
    assert.equal(agency.changedChoice, expected !== 'screen');
    assert.deepEqual(
      agency.bids.map((b) => b.botId),
      ['screen', 'support'],
    );
    const bid = agency.bids.find((b) => b.botId === 'support')!;
    assert.ok(bid.withinWindow);
    assert.equal(bid.style, style);
    assert.equal(bid.adjustment, style === 'enforcer' ? -0.25 : style === 'guardian' ? 0.25 : 0);
    assert.equal(f.state.assignments.get('collector')!.tipoff!.job, 'collector');
    assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
    assert.ok(f.run().filter((a) => a.tipoff?.attack).length <= 1);
  });

test('a Guardian can yield an opening screen to a nearby Balanced teammate', () => {
  const f = screenAgencyFixture('balanced');
  f.tactics.botStyles.screen = 'guardian';
  f.run();
  assert.equal(screenChoice(f).selectedId, 'support');
  assert.equal(screenChoice(f).agency!.changedChoice, true);
});

test('screen individuality blends preferences without changing physical arrival estimates', () => {
  const half = screenAgencyFixture('enforcer', 0.5),
    full = screenAgencyFixture('enforcer', 1),
    off = screenAgencyFixture('enforcer', 0);
  half.run();
  full.run();
  off.run();
  assert.equal(screenChoice(half).selectedId, 'screen');
  assert.equal(screenChoice(full).selectedId, 'support');
  assert.equal(screenChoice(off).selectedId, 'screen');
  assert.ok(!screenChoice(off).agency);
  assert.equal(screenChoice(half).agency!.bids[1].adjustment, -0.125);
  assert.equal(screenChoice(half).agency!.bids[1].arrival, screenChoice(full).agency!.bids[1].arrival);
  assert.equal(full.player('support').space!.speed, 5.2);
});

test('screen individuality cannot call a farther bot even when its bid beats a Guardian', () => {
  const f = screenAgencyFixture('enforcer');
  f.tactics.botStyles.screen = 'guardian';
  const radius = 10 + 5.2 * 0.4;
  f.player('support').pos.x = -Math.sqrt(radius * radius - 36);
  f.run();
  const agency = screenChoice(f).agency!,
    preferred = agency.bids.find((b) => b.botId === 'support')!;
  assert.equal(preferred.withinWindow, false);
  assert.ok(preferred.score < agency.bids[0].score);
  assert.equal(screenChoice(f).selectedId, 'screen');
});

test('Opportunist volunteers only for a reachable and timely visible recovery', () => {
  for (const condition of ['ready', 'recovery', 'distant', 'too-late'] as const) {
    const f = screenAgencyFixture('opportunist'),
      p = f.player('enemy-support');
    p.pos = { x: 2, z: 6 };
    p.space!.phase = condition === 'ready' ? 'ready' : 'recovering';
    p.space!.attackIn = 0.8;
    if (condition === 'distant') p.pos.x = 40;
    if (condition === 'too-late') p.space!.attackIn = 0;
    f.run();
    const bid = screenChoice(f).agency!.bids.find((b) => b.botId === 'support')!;
    assert.equal(bid.recoveryOpening, condition === 'recovery');
    assert.equal(bid.adjustment, condition === 'recovery' ? -0.25 : 0);
    assert.equal(screenChoice(f).selectedId, condition === 'recovery' ? 'support' : 'screen');
  }
});

test('styles do not displace a ready incumbent or hurry an active strike', () => {
  const f = screenAgencyFixture('balanced');
  f.run();
  f.tactics.botStyles.support = 'enforcer';
  f.tactics.botStyles.screen = 'guardian';
  f.run(0);
  assert.equal(screenChoice(f).selectedId, 'screen');
  assert.deepEqual(screenChoice(f).agency!.bids, []);
  f.player('screen').space!.phase = 'swing_up';
  f.run(0);
  assert.equal(screenChoice(f).selectedId, 'screen');
  assert.deepEqual(screenChoice(f).agency!.bids, []);
  f.player('screen').space!.phase = 'recovering';
  f.run(0);
  assert.equal(screenChoice(f).selectedId, 'support');
  assert.equal(screenChoice(f).agency!.bids[0].style, 'enforcer');
});

test('a vacancy ranks only ready supports outside their personal recovery wait', () => {
  const old = actor('old', 'blue', -8),
    plain = actor('plain', 'blue', -9),
    preferred = actor('preferred', 'blue', -10);
  old.space!.phase = 'recovering';
  const candidates = [
    { player: old, reachable: true, holding: false, arrival: 0.8 },
    { player: plain, reachable: true, holding: false, arrival: 1 },
    { player: preferred, reachable: true, holding: false, arrival: 1.15 },
  ];
  const options = { strength: 1, styles: { preferred: 'enforcer' as const } };
  assert.equal(chooseTipoffScreen(candidates, 'old', true, options).selectedId, 'preferred');
  candidates[2].holding = true;
  assert.equal(chooseTipoffScreen(candidates, 'old', true, options).selectedId, 'plain');
  candidates[2].holding = false;
  candidates[2].reachable = false;
  assert.equal(chooseTipoffScreen(candidates, 'old', true, options).selectedId, 'plain');
  candidates[2].reachable = true;
  preferred.height = 1;
  assert.equal(chooseTipoffScreen(candidates, 'old', true, options).selectedId, 'plain');
  preferred.height = 0;
  preferred.space!.mobileIn = 0.2;
  assert.equal(chooseTipoffScreen(candidates, 'old', true, options).selectedId, 'plain');
  assert.equal(chooseTipoffScreen(candidates, 'old', false, options).selectedId, null);
});

test('screen individuality requires its dependencies and cannot bypass local numbers or human control', () => {
  for (const key of ['enabled', 'spaceEnabled', 'tipoffEnabled', 'tipoffScreenHandoffEnabled'] as const) {
    const f = screenAgencyFixture('enforcer');
    f.tactics.defaults[key] = false;
    assert.ok(f.run().every((a) => !a.tipoff?.screenSelection?.agency));
  }
  const f = screenAgencyFixture('enforcer');
  f.player('screen').height = 1;
  f.player('enemy-back').pos.x = 16;
  assert.ok(f.run().every((a) => a.tipoff?.job !== 'screen'));
  const human = screenAgencyFixture('enforcer');
  human.player('support').scripted = false;
  human.run();
  assert.ok(!human.state.assignments.has('support'));
  assert.ok(
    human.state.assignments.get('screen')!.tipoff!.screenSelection!.agency!.bids.every((b) => b.botId !== 'support'),
  );
});

test('screen individuality keeps safe pickup, reserve positions and challenge caution authoritative', () => {
  const f = screenAgencyFixture('enforcer');
  f.tactics.botStyles.collector = 'enforcer';
  f.tactics.botStyles.reserve = 'enforcer';
  pickupWindow(f, 1);
  f.run();
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  assert.deepEqual(
    screenChoice(f).agency!.bids.map((b) => b.botId),
    ['screen', 'support'],
  );
  assert.ok(f.run().every((a) => !a.tipoff!.attack));
  const cautious = screenAgencyFixture('enforcer');
  cautious.tactics.defaults.tipoffAgencyStrength = 1;
  cautious.tactics.botStyles.screen = 'guardian';
  cautious.tactics.botStyles.support = 'opportunist';
  cautious.player('enemy-support').pos = { x: 2, z: 6 };
  cautious.player('enemy-support').space!.phase = 'recovering';
  cautious.player('enemy-support').space!.attackIn = 0.8;
  cautious.run();
  const a = cautious.state.assignments.get('support')!;
  assert.equal(a.tipoff!.agency!.style, 'opportunist');
  assert.equal(a.tipoff!.agency!.challengeCushion, 0.15);
});

test('screen preferences remain deterministic across main_ai, mirrors, reordering and JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = screenAgencyFixture('enforcer');
    f.player('support').id = 'main_ai';
    f.tactics.botStyles = { main_ai: 'enforcer' };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.tactics.teams[mirror ? 'blue' : 'red'] = { tipoffScreenAgencyStrength: 0 };
    f.run();
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.job, 'screen');
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    for (const dt of [0, 0.2, 1]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
    f.snapshot.holderId = 'collector';
    assert.ok(f.run().every((a) => !a.tipoff));
  }
});

test('v35 migration defaults screen individuality off while preserving handoff and other preferences', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffScreenAgencyStrength, 0);
  for (let v = 1; v < 35; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffScreenAgencyStrength;
    old.defaults.tipoffScreenHandoffEnabled = true;
    old.defaults.tipoffRecoveryAgencyStrength = 0.7;
    old.teams.red = { tipoffScreenHandoffEnabled: false };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffScreenAgencyStrength, 0);
    assert.equal(next.defaults.tipoffScreenHandoffEnabled, true);
    assert.equal(next.defaults.tipoffRecoveryAgencyStrength, 0.7);
    assert.equal(next.teams.red!.tipoffScreenHandoffEnabled, false);
  }
  config.defaults.tipoffScreenAgencyStrength = 0.4;
  config.teams.red = { tipoffScreenAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'red').tipoffScreenAgencyStrength, 1);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffScreenAgencyStrength: bad } } }));
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffScreenAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});

function targetFixture(style: GrifballPlayerStyle = 'balanced', strength = 1) {
  const f = fixture();
  f.tactics.defaults.tipoffTargetAgencyStrength = strength;
  f.tactics.botStyles.screen = style;
  f.player('enemy').pos = { x: 3, z: -2.5 };
  f.player('enemy-screen').pos = { x: 2.5, z: -5.5 };
  return f;
}
const targetOrder = (f: ReturnType<typeof fixture>) => f.state.assignments.get('screen')!.tipoff!;

test('a screen can skip an unsafe nearest opponent for a safely spaced challenge', () => {
  const off = targetFixture('balanced', 0),
    on = targetFixture();
  for (const f of [off, on]) {
    f.player('enemy').pos = { x: 0, z: -2 };
    f.run();
  }
  assert.equal(targetOrder(off).targetId, 'enemy');
  assert.equal(targetOrder(off).attack, false);
  assert.ok(!targetOrder(off).targetSelection);
  assert.equal(targetOrder(on).targetId, 'enemy-screen');
  assert.equal(targetOrder(on).attack, true);
  const choice = targetOrder(on).targetSelection!;
  assert.equal(choice.baselineId, 'enemy');
  assert.equal(choice.teamId, 'enemy-screen');
  assert.equal(choice.changedChoice, true);
  assert.equal(choice.changedByStyle, false);
  assert.match(choice.candidates.find((c) => c.targetId === 'enemy')!.rejection!, /spacing/);
  assert.deepEqual(
    on.state.assignments.get('collector')!.destination,
    off.state.assignments.get('collector')!.destination,
  );
  assert.deepEqual(on.state.assignments.get('reserve')!.destination, off.state.assignments.get('reserve')!.destination);
  assert.equal(on.run().filter((a) => a.tipoff?.attack).length, 1);
});

for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const)
  test(style + ' selects its own safe near-tie opening target', () => {
    const f = targetFixture(style);
    if (style === 'opportunist') {
      f.player('enemy').space!.phase = 'recovering';
      f.player('enemy').space!.attackIn = 0.8;
    }
    if (style === 'guardian') f.tactics.defaults.threatHorizon = 2;
    f.run();
    const a = targetOrder(f),
      choice = a.targetSelection!;
    assert.equal(a.attack, true);
    assert.equal(a.targetId, style === 'balanced' ? 'enemy-screen' : 'enemy');
    assert.equal(choice.teamId, 'enemy-screen');
    assert.equal(choice.changedByStyle, style !== 'balanced');
    assert.equal(choice.style, style);
    assert.ok(choice.candidates.find((c) => c.targetId === a.targetId)!.withinWindow);
    const steering = steer(f, 'screen')!;
    assert.ok(steering.velocity.x !== 0 || steering.velocity.z !== 0);
  });

test('target preferences blend without changing attack estimates or rewarding an expired recovery', () => {
  const half = targetFixture('enforcer', 0.5),
    full = targetFixture('enforcer');
  half.run();
  full.run();
  assert.equal(targetOrder(half).targetId, 'enemy-screen');
  assert.equal(targetOrder(full).targetId, 'enemy');
  const a = targetOrder(half).targetSelection!.candidates.find((c) => c.targetId === 'enemy')!;
  const b = targetOrder(full).targetSelection!.candidates.find((c) => c.targetId === 'enemy')!;
  assert.equal(a.adjustment, -0.125);
  assert.equal(a.eta, b.eta);
  assert.equal(a.response, b.response);
  const opportunist = targetFixture('opportunist');
  opportunist.run();
  assert.equal(targetOrder(opportunist).targetId, 'enemy-screen');
  opportunist.player('enemy').space!.phase = 'recovering';
  opportunist.player('enemy').space!.attackIn = 0;
  opportunist.run();
  assert.notEqual(targetOrder(opportunist).targetId, 'enemy');
  assert.match(
    targetOrder(opportunist).targetSelection!.candidates.find((c) => c.targetId === 'enemy')!.rejection!,
    /before/,
  );
});

test('target scoring never selects an unsafe or remote recovery, and ties are stable', () => {
  const c = {
    targetId: 'near',
    eta: 1,
    response: 2,
    rejection: null,
    contestsBall: false,
    threatensCollector: false,
    recovering: false,
  };
  const far = { ...c, targetId: 'far', eta: 1.36, recovering: true };
  const unsafe = { ...c, targetId: 'unsafe', eta: 0.5, recovering: true, rejection: 'Unsafe spacing' };
  const unreachable = { ...c, targetId: 'blocked', eta: Infinity, rejection: 'Blocked route' };
  const choose = (cs: (typeof c)[]) => chooseTipoffTarget(cs, 1, { screen: 'opportunist' }, 'screen');
  assert.equal(choose([far, unsafe, unreachable, c]).selectedId, 'near');
  assert.equal(choose([far, unsafe, unreachable, c]).candidates.find((c) => c.targetId === 'far')!.withinWindow, false);
  assert.equal(choose([unsafe, unreachable]).selectedId, null);
  assert.deepEqual(choose([c, { ...c, targetId: 'a' }]), choose([{ ...c, targetId: 'a' }, c]));
});

test('a target preference cannot waive personal challenge caution or readiness', () => {
  const f = targetFixture('guardian');
  f.tactics.defaults.threatHorizon = 2;
  f.tactics.defaults.tipoffAgencyStrength = 1;
  f.run();
  assert.equal(targetOrder(f).attack, false);
  assert.equal(targetOrder(f).targetId, null);
  assert.ok(targetOrder(f).targetSelection!.candidates.some((c) => /personal/.test(c.rejection ?? '')));
  f.tactics.defaults.tipoffAgencyStrength = 0;
  f.player('screen').space!.phase = 'swing_up';
  f.run();
  assert.equal(targetOrder(f).attack, false);
  assert.equal(targetOrder(f).targetId, null);
  f.player('screen').space!.phase = 'ready';
  f.player('collector').pos = { x: -8, z: -3 };
  f.run();
  assert.ok(
    f.run().every((a) => !a.tipoff?.attack),
    'shared hammer exposure blocks every alternative',
  );
});

test('target individuality respects disabled dependencies, safe pickups, humans and opening lifecycle', () => {
  for (const key of ['enabled', 'spaceEnabled', 'tipoffEnabled'] as const) {
    const f = targetFixture();
    f.tactics.defaults[key] = false;
    assert.ok(f.run().every((a) => !a.tipoff?.targetSelection));
  }
  const safe = targetFixture();
  pickupWindow(safe, 1);
  assert.ok(safe.run().every((a) => !a.tipoff?.targetSelection && !a.tipoff?.attack));
  const human = targetFixture();
  human.player('screen').scripted = false;
  human.run();
  assert.ok(!human.state.assignments.has('screen'));
  const sparse = targetFixture();
  sparse.snapshot.players = sparse.snapshot.players.filter((p) => p.id !== 'support');
  assert.ok(sparse.run().every((a) => !a.tipoff?.targetSelection && !a.tipoff?.attack));
  const f = targetFixture();
  f.run();
  f.snapshot.holderId = 'collector';
  assert.ok(f.run().every((a) => !a.tipoff));
  f.snapshot.holderId = null;
  assert.ok(f.run().every((a) => !a.tipoff));
});

test('target preferences cannot select a blocked challenge point or crowd an observed human', () => {
  const baseline = targetFixture('enforcer');
  baseline.run();
  const point = baseline.state.assignments.get('screen')!.destination;
  for (const obstacle of ['wall', 'human'] as const) {
    const f = targetFixture('enforcer');
    if (obstacle === 'wall')
      f.snapshot.geometry!.blockers.push({ kind: 'box', x: point.x, z: point.z, hx: 0.3, hz: 0.3 });
    else f.snapshot.players.push({ ...actor('human', 'blue', point.x, point.z), scripted: false });
    f.run();
    assert.notEqual(targetOrder(f).targetId, 'enemy');
    const rejected = targetOrder(f).targetSelection!.candidates.find((c) => c.targetId === 'enemy');
    assert.ok(!rejected || rejected.rejection);
    assert.ok(!f.state.assignments.has('human'));
  }
});

test('regroup waits and the opening timeout suppress alternative target selection', () => {
  const f = targetFixture('enforcer');
  f.tactics.defaults.tipoffRegroupSeconds = 0.5;
  f.run();
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'support');
  // Keep local numbers favorable so the captured recovery interval owns the hold.
  f.player('enemy-support').pos.x = 40;
  f.player('enemy-back').pos.x = 40;
  const orders = f.run();
  assert.ok(orders.every((a) => a.tipoff?.phase === 'regroup'));
  assert.ok(orders.every((a) => !a.tipoff?.targetSelection && !a.tipoff?.attack));
  assert.ok(f.run(f.tactics.defaults.tipoffSeconds + 1).every((a) => !a.tipoff));
});

test('live target use rechecks a disappearing timing advantage while preserving immediate self-defense', () => {
  const f = targetFixture('opportunist');
  f.player('enemy').pos = { x: 3, z: -2.5 };
  f.player('enemy').space!.phase = 'recovering';
  f.player('enemy').space!.attackIn = 0.8;
  f.run();
  const a = f.state.assignments.get('screen')!;
  // Bring the actors within live engagement distance without refreshing the order.
  f.player('screen').pos = { x: -2, z: -4 };
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy');
  f.player('enemy').space!.phase = 'ready';
  f.player('enemy').space!.attackIn = 0;
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), null);
  f.player('enemy').pos = { x: -1, z: -4 };
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy');
});

test('target preferences preserve main_ai, mirrored teams, deterministic order and JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = targetFixture('enforcer');
    f.player('screen').id = 'main_ai';
    f.tactics.botStyles = { main_ai: 'enforcer' };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.tactics.teams[mirror ? 'blue' : 'red'] = { tipoffTargetAgencyStrength: 0 };
    f.run();
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.targetId, 'enemy');
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    for (const dt of [0, 0.2, 1]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('v36 migration defaults target individuality off and preserves existing tip-off controls', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffTargetAgencyStrength, 0);
  for (let v = 1; v < 36; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffTargetAgencyStrength;
    old.defaults.tipoffScreenAgencyStrength = 0.7;
    old.defaults.tipoffScreenHandoffEnabled = true;
    old.teams.red = { tipoffScreenAgencyStrength: 0.5 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffTargetAgencyStrength, 0);
    assert.equal(next.defaults.tipoffScreenAgencyStrength, 0.7);
    assert.equal(next.defaults.tipoffScreenHandoffEnabled, true);
    assert.equal(next.teams.red!.tipoffScreenAgencyStrength, 0.5);
  }
  config.defaults.tipoffTargetAgencyStrength = 0.4;
  config.teams.red = { tipoffTargetAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'red').tipoffTargetAgencyStrength, 1);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffTargetAgencyStrength: bad } } }));
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffTargetAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});

test('a screen retains a safe target through timing jitter and expiry interrupts slow refreshes', () => {
  const f = targetFixture();
  f.tactics.defaults.tipoffTargetCommitSeconds = 0.6;
  f.tactics.defaults.refreshSeconds = 1;
  f.run(0.01);
  assert.equal(targetOrder(f).targetId, 'enemy-screen');
  f.player('enemy-screen').pos.x = 4;
  f.run(0.01);
  assert.equal(targetOrder(f).targetSelection!.commitment!.preferredId, 'enemy');
  assert.equal(targetOrder(f).targetId, 'enemy-screen');
  assert.equal(targetOrder(f).targetSelection!.commitment!.retained, true);
  const revision = f.state.revision;
  f.run(0.59);
  assert.ok(f.state.revision > revision);
  assert.equal(targetOrder(f).targetId, 'enemy');
  assert.equal(targetOrder(f).targetSelection!.commitment!.startedAt, 0.61);
});

test('live recovery transitions release an Opportunist hold before a slow tactical refresh', () => {
  const f = targetFixture('opportunist');
  f.tactics.defaults.tipoffTargetCommitSeconds = 1;
  f.tactics.defaults.refreshSeconds = 1;
  f.player('enemy').space!.phase = 'recovering';
  f.player('enemy').space!.attackIn = 0.8;
  f.run(0.01);
  f.run(0.01);
  assert.equal(targetOrder(f).targetId, 'enemy');
  const revision = f.state.revision;
  f.player('enemy').space!.phase = 'ready';
  f.player('enemy').space!.attackIn = 0.3;
  f.run(0.01);
  assert.ok(f.state.revision > revision);
  assert.equal(targetOrder(f).targetId, 'enemy-screen');
  assert.match(targetOrder(f).targetSelection!.commitment!.reason, /recovery opening ended/);
});

test('commitment cannot rescue an unsafe target or suppress immediate self-defense', () => {
  const f = targetFixture('enforcer');
  f.tactics.defaults.tipoffTargetCommitSeconds = 1;
  f.run();
  f.player('enemy').pos = { x: 0, z: -2 };
  f.run();
  assert.equal(targetOrder(f).targetId, 'enemy-screen');
  assert.match(targetOrder(f).targetSelection!.commitment!.reason, /unsafe/);
  const a = f.state.assignments.get('screen')!;
  f.player('enemy').pos = { x: -7, z: -6 };
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy');
});

test('opening role handoffs, disabled dependencies and possession clear inherited target commitment', () => {
  for (const key of [
    'enabled',
    'spaceEnabled',
    'tipoffEnabled',
    'tipoffTargetAgencyStrength',
    'tipoffTargetCommitSeconds',
  ] as const) {
    const f = targetFixture();
    f.tactics.defaults.tipoffTargetCommitSeconds = 0.6;
    f.run();
    Object.assign(f.tactics.defaults, { [key]: key.endsWith('Strength') || key.endsWith('Seconds') ? 0 : false });
    assert.ok(f.run().every((a) => !a.tipoff?.targetSelection?.commitment));
  }
  const f = targetFixture();
  f.tactics.defaults.tipoffTargetCommitSeconds = 0.6;
  f.tactics.defaults.tipoffScreenHandoffEnabled = true;
  f.run();
  f.player('screen').space!.phase = 'recovering';
  f.run();
  const replacement = f.state.assignments.get('support')!.tipoff!;
  assert.equal(replacement.job, 'screen');
  assert.equal(replacement.targetSelection!.commitment!.previousId, null);
  f.snapshot.holderId = 'collector';
  assert.ok(f.run().every((a) => !a.tipoff));
  f.snapshot.holderId = null;
  f.snapshot.round++;
  f.player('screen').space!.phase = 'ready';
  f.run();
  assert.equal(targetOrder(f).targetSelection!.commitment!.previousId, null);
});

test('target commitment follows main_ai, team overrides, mirrors and JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = targetFixture();
    f.player('screen').id = 'main_ai';
    f.tactics.teams[mirror ? 'red' : 'blue'] = { tipoffTargetCommitSeconds: 0.6 };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.run(0.01);
    assert.ok(f.state.assignments.get('main_ai')!.tipoff!.targetSelection!.commitment);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('enemy-screen').pos.x = mirror ? -4 : 4;
    for (const dt of [0.2, 0.2, 0.2, 0.2]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('a changed rear reserve or regroup interval clears a screen target hold', () => {
  for (const regroup of [false, true]) {
    const f = targetFixture();
    f.tactics.defaults.tipoffTargetCommitSeconds = 1;
    f.tactics.defaults.tipoffRegroupSeconds = regroup ? 0.25 : 0;
    f.player('enemy-support').pos.x = 40;
    f.player('enemy-back').pos.x = 40;
    f.run(0.01);
    assert.equal(targetOrder(f).reserveId, 'reserve');
    f.player('reserve').height = 1;
    f.run(0.2);
    if (regroup) {
      assert.ok(f.run(0.01).every((a) => !a.tipoff?.targetSelection?.commitment));
      f.player('reserve').height = 0;
      f.run(0.3);
    }
    const order = targetOrder(f);
    assert.equal(order.job, 'screen');
    if (!regroup) assert.equal(order.reserveId, 'support');
    assert.equal(order.targetSelection!.commitment!.previousId, null);
  }
});

test('v37 imports leave commitment off while preserving target styles and prior controls', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffTargetCommitSeconds, 0);
  for (let v = 1; v < 37; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffTargetCommitSeconds;
    old.defaults.tipoffTargetAgencyStrength = 0.7;
    old.teams.red = { tipoffTargetAgencyStrength: 0.4 };
    old.botStyles = { main_ai: 'enforcer' };
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.tipoffTargetCommitSeconds, 0);
    assert.equal(migrated.defaults.tipoffTargetAgencyStrength, 0.7);
    assert.equal(migrated.teams.red!.tipoffTargetAgencyStrength, 0.4);
    assert.equal(migrated.botStyles.main_ai, 'enforcer');
  }
  config.defaults.tipoffTargetCommitSeconds = 0.6;
  config.teams.red = { tipoffTargetCommitSeconds: 1.5 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'red').tipoffTargetCommitSeconds, 1.5);
  for (const bad of [-0.1, 1.6, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffTargetCommitSeconds: bad } } }));
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffTargetCommitSeconds;
  assert.throws(() => validateGrifballTactics(missing));
});

for (const [style, duration] of [
  ['balanced', 0.6],
  ['enforcer', 0.85],
  ['opportunist', 0.45],
  ['guardian', 0.35],
] as const)
  test(style + ' personal target expiry interrupts a slow planner refresh', () => {
    const f = targetFixture(style, 0.01);
    Object.assign(f.tactics.defaults, {
      tipoffTargetCommitSeconds: 0.6,
      tipoffTargetCommitAgencyStrength: 1,
      refreshSeconds: 1,
    });
    f.run(0.01);
    assert.equal(targetOrder(f).targetId, 'enemy-screen');
    assert.ok(Math.abs(targetOrder(f).targetSelection!.commitment!.deadline - (0.01 + duration)) < 1e-9);
    f.player('enemy-screen').pos.x = 4;
    f.run(0.01);
    assert.equal(targetOrder(f).targetSelection!.commitment!.preferredId, 'enemy');
    assert.equal(targetOrder(f).targetId, 'enemy-screen');
    f.run(duration - 0.02);
    assert.equal(targetOrder(f).targetId, 'enemy-screen');
    const revision = f.state.revision;
    f.run(0.01);
    assert.ok(f.state.revision > revision);
    assert.equal(targetOrder(f).targetId, 'enemy');
    assert.match(targetOrder(f).targetSelection!.commitment!.reason, /expired/);
  });

test('personal commitment follows roster IDs and team overrides through mirrored JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = targetFixture('balanced', 0.01);
    f.player('screen').id = 'main_ai';
    f.tactics.botStyles = { main_ai: 'enforcer' };
    f.tactics.defaults.tipoffTargetCommitSeconds = 0.6;
    f.tactics.teams[mirror ? 'red' : 'blue'] = { tipoffTargetCommitAgencyStrength: 1 };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.run(0.01);
    const order = f.state.assignments.get('main_ai')!.tipoff!;
    assert.equal(order.targetSelection!.commitment!.agency!.seconds, 0.85);
    assert.equal(resolveTeamTactics(f.tactics, mirror ? 'blue' : 'red').tipoffTargetCommitAgencyStrength, 0);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('enemy-screen').pos.x = mirror ? -4 : 4;
    for (const dt of [0.2, 0.2, 0.2, 0.3]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('commitment individuality stays behind dependencies, safety and screen handoff', () => {
  for (const key of [
    'enabled',
    'spaceEnabled',
    'tipoffEnabled',
    'tipoffTargetAgencyStrength',
    'tipoffTargetCommitSeconds',
  ] as const) {
    const f = targetFixture('enforcer');
    Object.assign(f.tactics.defaults, { tipoffTargetCommitSeconds: 0.6, tipoffTargetCommitAgencyStrength: 1 });
    f.run();
    Object.assign(f.tactics.defaults, { [key]: key.endsWith('Strength') || key.endsWith('Seconds') ? 0 : false });
    assert.ok(f.run().every((a) => !a.tipoff?.targetSelection?.commitment?.agency));
  }
  const f = targetFixture('enforcer');
  Object.assign(f.tactics.defaults, {
    tipoffTargetCommitSeconds: 0.6,
    tipoffTargetCommitAgencyStrength: 1,
    tipoffScreenHandoffEnabled: true,
  });
  f.run();
  f.player('enemy').pos = { x: 0, z: -2 };
  f.run();
  assert.equal(targetOrder(f).targetId, 'enemy-screen');
  assert.match(targetOrder(f).targetSelection!.commitment!.reason, /unsafe/);
  const a = f.state.assignments.get('screen')!;
  f.player('enemy').pos = { x: -7, z: -6 };
  assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy');
  f.player('enemy').pos = { x: 3, z: -2.5 };
  f.player('screen').space!.phase = 'recovering';
  f.tactics.botStyles.support = 'guardian';
  f.run();
  const replacement = f.state.assignments.get('support')!.tipoff!;
  assert.equal(replacement.job, 'screen');
  assert.equal(replacement.targetSelection!.commitment!.previousId, null);
  assert.equal(replacement.targetSelection!.commitment!.agency!.seconds, 0.35);
  f.snapshot.holderId = 'collector';
  assert.ok(f.run().every((a) => !a.tipoff));
});

test('v38 migration leaves commitment individuality off and preserves earlier preferences', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffTargetCommitAgencyStrength, 0);
  for (let v = 1; v < 38; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffTargetCommitAgencyStrength;
    old.defaults.tipoffTargetCommitSeconds = 0.6;
    old.defaults.tipoffTargetAgencyStrength = 0.7;
    old.teams.red = { tipoffTargetCommitSeconds: 1, tipoffTargetAgencyStrength: 0.4 };
    old.botStyles = { main_ai: 'enforcer' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffTargetCommitAgencyStrength, 0);
    assert.equal(next.defaults.tipoffTargetCommitSeconds, 0.6);
    assert.equal(next.defaults.tipoffTargetAgencyStrength, 0.7);
    assert.deepEqual(next.teams.red, old.teams.red);
    assert.equal(next.botStyles.main_ai, 'enforcer');
  }
  config.defaults.tipoffTargetCommitAgencyStrength = 0.4;
  config.teams.red = { tipoffTargetCommitAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  assert.equal(resolveTeamTactics(config, 'red').tipoffTargetCommitAgencyStrength, 1);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true]) {
    assert.throws(() =>
      validateGrifballTactics({ ...config, teams: { red: { tipoffTargetCommitAgencyStrength: bad } } }),
    );
    assert.throws(() =>
      validateGrifballTactics({ ...config, defaults: { ...config.defaults, tipoffTargetCommitAgencyStrength: bad } }),
    );
  }
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffTargetCommitAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});

function collectorFixture(clear = true) {
  const f = fixture();
  f.tactics.defaults.tipoffCollectorHandoffEnabled = true;
  if (clear) for (const p of f.snapshot.players.filter((p) => p.team === 'red')) p.pos.x = 40;
  return f;
}
const collectorDecision = (f: ReturnType<typeof fixture>) =>
  [...f.state.assignments.values()].find((a) => a.team === 'blue' && a.tipoff)?.tipoff?.collectorSelection;

test('collector handoff changes actual pickup movement only after beating the arrival margin', () => {
  const f = collectorFixture();
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'collector');
  f.player('support').pos = { x: -4, z: 6 };
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'collector');
  f.player('support').pos = { x: -1, z: 4 };
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'support');
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'collector');
  assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
  assert.equal(f.state.assignments.get('collector')!.tipoff!.job === 'collector', false);
  assert.deepEqual(f.state.assignments.get('support')!.destination, f.snapshot.ball);
  assert.equal(steer(f, 'support')!.pickupRequested, true);
  assert.equal(steer(f, 'collector')!.pickupRequested, false);
  f.player('collector').pos = { x: -1, z: 3.5 };
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'support');
});

for (const phase of ['recovering', 'swing_up', 'lunging', 'airborne', 'immobile'] as const)
  test('collector ' + phase + ' interrupts slow refresh and hands off to a ready teammate', () => {
    const f = collectorFixture();
    f.tactics.defaults.refreshSeconds = 1;
    f.run(0.01);
    f.run(0.01);
    const revision = f.state.revision;
    if (phase === 'airborne') f.player('collector').height = 1;
    else if (phase === 'immobile') f.player('collector').space!.mobileIn = 0.5;
    else f.player('collector').space!.phase = phase;
    f.run(0.01);
    assert.ok(f.state.revision > revision);
    assert.equal(collectorDecision(f)!.selectedId, 'screen');
    assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
    assert.equal(steer(f, 'collector')!.pickupRequested, false);
  });

test('collector handoff excludes rear reserve, screen challenge and personal regroup holds', () => {
  const f = collectorFixture(false);
  f.player('enemy-screen').pos = { x: 2.5, z: -5.5 };
  f.run();
  assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true);
  f.player('collector').space!.phase = 'recovering';
  f.player('reserve').pos = { x: -0.5, z: 0 };
  f.run();
  const d = collectorDecision(f)!;
  assert.equal(d.selectedId, 'support');
  assert.match(d.candidates.find((c) => c.botId === 'reserve')!.rejection!, /reserve/);
  assert.match(d.candidates.find((c) => c.botId === 'screen')!.rejection!, /screen/);
  assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
  assert.equal(steer(f, 'support')!.pickupRequested, false, 'handoff cannot bypass contested pickup safety');
  f.tactics.defaults.tipoffRegroupSeconds = 1;
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
  f.tactics.botStyles.collector = 'guardian';
  f.run(0.01);
  f.player('collector').space!.phase = 'ready';
  f.player('support').height = 1;
  f.run();
  assert.match(collectorDecision(f)!.candidates.find((c) => c.botId === 'collector')!.rejection!, /regroup/);
});

test('no eligible collector holds all lanes and preserves a ready reserve', () => {
  const f = collectorFixture();
  f.run();
  for (const p of f.snapshot.players.filter((p) => p.team === 'blue' && p.id !== 'reserve'))
    p.space!.phase = 'recovering';
  const orders = f.run();
  assert.equal(collectorDecision(f)!.selectedId, null);
  assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
  assert.ok(orders.every((a) => a.tipoff!.job !== 'collector' && !a.tipoff!.attack && a.tipoff!.phase === 'contain'));
  assert.ok(orders.every((a) => !steer(f, a.botId)!.pickupRequested));
  f.player('support').space!.phase = 'ready';
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'support');
});

test('an active attack revokes a stale collector pickup request before the next planner refresh', () => {
  const f = collectorFixture();
  f.run();
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  f.player('collector').space!.phase = 'swing_up';
  assert.equal(steer(f, 'collector')!.pickupRequested, false);
});

test('blocked routes cannot produce a collector handoff or a pickup order', () => {
  const f = collectorFixture();
  f.run();
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: 0, z: 0, hx: 1, hz: 1 });
  const orders = f.run();
  assert.equal(collectorDecision(f)!.selectedId, null);
  assert.ok(collectorDecision(f)!.candidates.every((c) => c.rejection?.includes('route')));
  assert.ok(orders.every((a) => !a.tipoff!.attack && a.tipoff!.job !== 'collector'));
});

test('observed human or neural pickup pursuit keeps priority over opening handoffs', () => {
  const f = collectorFixture();
  f.run();
  f.player('collector').scripted = false;
  f.player('collector').pos = { x: -1, z: 0 };
  f.player('collector').pickupRequested = true;
  const orders = f.run();
  assert.ok(!f.state.assignments.has('collector'));
  assert.ok(
    orders.every(
      (a) => a.tipoff!.collectorId === 'collector' && a.tipoff!.job !== 'collector' && !a.tipoff!.collectorSelection,
    ),
  );
});

test('a handoff candidate separately yields to human pursuit even when the incumbent has priority', () => {
  const f = collectorFixture();
  f.player('collector').pos = { x: -1, z: 0 };
  f.run();
  f.tactics.defaults.reassignmentAdvantage = 4;
  f.player('collector').space!.speed = 0.5;
  f.player('support').pos = { x: -2, z: 3 };
  f.snapshot.players.push({ ...actor('human', 'blue', -4), scripted: false, vel: { x: 1, z: 0 } });
  f.run();
  const decision = collectorDecision(f)!;
  assert.equal(decision.baselineId, 'collector');
  assert.equal(decision.selectedId, 'collector');
  assert.match(decision.candidates.find((c) => c.botId === 'support')!.rejection!, /human or neural/);
  assert.ok(!f.state.assignments.has('human'));
});

test('collector changes clear inherited screen target holds', () => {
  const f = targetFixture();
  Object.assign(f.tactics.defaults, { tipoffCollectorHandoffEnabled: true, tipoffTargetCommitSeconds: 1 });
  f.run();
  assert.ok(targetOrder(f).targetSelection!.commitment);
  f.player('collector').space!.phase = 'recovering';
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'support');
  assert.equal(targetOrder(f).targetSelection!.commitment!.previousId, null);
});

test('collector handoff lifecycle restores ordinary selection after disabling and ends with the opening', () => {
  for (const key of ['tipoffCollectorHandoffEnabled', 'tipoffEnabled', 'spaceEnabled', 'enabled'] as const) {
    const f = collectorFixture();
    f.run();
    f.tactics.defaults[key] = false;
    assert.ok(f.run().every((a) => !a.tipoff?.collectorSelection));
  }
  for (const end of ['possession', 'displacement', 'timeout', 'round'] as const) {
    const f = collectorFixture();
    f.run();
    if (end === 'possession') f.snapshot.holderId = 'collector';
    if (end === 'displacement') f.snapshot.ballPhysics!.pos.x = 1;
    if (end === 'round') f.snapshot.round++;
    const orders = f.run(end === 'timeout' ? 9 : 0.2);
    if (end === 'round') assert.equal(collectorDecision(f)!.previousId, null);
    else assert.ok(orders.every((a) => !a.tipoff));
  }
});

test('collector handoff follows main_ai, mirrors, overrides and JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = collectorFixture();
    f.player('collector').id = 'main_ai';
    f.tactics.defaults.tipoffCollectorHandoffEnabled = false;
    f.tactics.teams[mirror ? 'red' : 'blue'] = { tipoffCollectorHandoffEnabled: true, tipoffCollectorAdvantage: 0.5 };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.run();
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.collectorSelection!.selectedId, 'main_ai');
    assert.equal(resolveTeamTactics(f.tactics, mirror ? 'blue' : 'red').tipoffCollectorHandoffEnabled, false);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('main_ai').space!.phase = 'recovering';
    for (const dt of [0.2, 0.2, 0.2]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('v39 migration leaves collector handoff off with a .35 s advantage', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffCollectorHandoffEnabled, false);
  assert.equal(config.defaults.tipoffCollectorAdvantage, 0.35);
  for (let v = 1; v < 39; v++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = v;
    delete old.defaults.tipoffCollectorHandoffEnabled;
    delete old.defaults.tipoffCollectorAdvantage;
    old.defaults.tipoffTargetCommitAgencyStrength = 0.7;
    old.teams.red = { tipoffTargetCommitSeconds: 0.6 };
    old.botStyles = { main_ai: 'guardian' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffCollectorHandoffEnabled, false);
    assert.equal(next.defaults.tipoffCollectorAdvantage, 0.35);
    assert.equal(next.defaults.tipoffTargetCommitAgencyStrength, 0.7);
    assert.deepEqual(next.teams.red, old.teams.red);
    assert.deepEqual(next.botStyles, old.botStyles);
  }
  config.defaults.tipoffCollectorHandoffEnabled = true;
  config.teams.red = { tipoffCollectorAdvantage: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [-0.1, 2.1, NaN, Infinity, '1', true])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffCollectorAdvantage: bad } } }));
  assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffCollectorHandoffEnabled: 1 } } }));
  for (const key of ['tipoffCollectorHandoffEnabled', 'tipoffCollectorAdvantage']) {
    const missing = JSON.parse(JSON.stringify(config));
    delete missing.defaults[key];
    assert.throws(() => validateGrifballTactics(missing));
  }
});

function collectorAgencyFixture(strength = 1) {
  const f = collectorFixture();
  f.tactics.defaults.tipoffCollectorAgencyStrength = strength;
  f.tactics.botStyles.screen = 'opportunist';
  f.player('screen').pos = { x: -8, z: -4 };
  return f;
}

test('collector individuality changes the real initial pickup owner, then keeps it stable', () => {
  const zero = collectorAgencyFixture(0),
    personal = collectorAgencyFixture();
  zero.run();
  personal.run();
  assert.equal(collectorDecision(zero)!.selectedId, 'collector');
  const d = collectorDecision(personal)!;
  assert.equal(d.selectedId, 'screen');
  assert.equal(d.agency!.baselineId, 'collector');
  assert.equal(d.agency!.changedChoice, true);
  assert.equal(steer(personal, 'screen')!.pickupRequested, true);
  assert.equal(steer(personal, 'collector')!.pickupRequested, false);
  assert.equal(personal.state.assignments.get('reserve')!.tipoff!.job, 'reserve');
  assert.deepEqual(personal.state.assignments.get('screen')!.destination, personal.snapshot.ball);
  personal.tactics.botStyles.screen = 'guardian';
  personal.run();
  assert.equal(collectorDecision(personal)!.selectedId, 'screen');
  assert.deepEqual(collectorDecision(personal)!.agency!.bids, []);
  personal.player('screen').space!.phase = 'swing_up';
  assert.equal(steer(personal, 'screen')!.pickupRequested, false);
});

test('collector individuality preserves actual safe pickups including personal pickup margins', () => {
  for (const caution of [0, 1]) {
    const f = collectorAgencyFixture();
    f.tactics.defaults.tipoffAgencyStrength = caution;
    // Put a visible attack deadline between the two real pickup arrivals.
    const enemy = f.player('enemy');
    enemy.pos = { x: 0, z: 0 };
    enemy.space!.attackIn = 2;
    f.run();
    const d = collectorDecision(f)!;
    assert.equal(d.selectedId, 'collector');
    assert.equal(d.candidates.find((c) => c.botId === 'collector')!.pickupSafe, true);
    assert.equal(d.candidates.find((c) => c.botId === 'screen')!.pickupSafe, false);
    assert.match(d.agency!.bids.find((c) => c.botId === 'screen')!.rejection!, /safe pickup/);
    assert.equal(f.state.assignments.get('collector')!.tipoff!.phase, 'claim');
    assert.equal(steer(f, 'collector')!.pickupRequested, true);
  }
});

test('collector individuality selects a close replacement on unavailability without poaching the reserve', () => {
  const f = collectorAgencyFixture(0);
  f.run();
  f.tactics.defaults.tipoffCollectorAgencyStrength = 1;
  f.tactics.botStyles = { screen: 'guardian', support: 'opportunist', reserve: 'opportunist' };
  f.player('support').pos = { x: -8, z: 5 };
  f.player('reserve').pos = { x: -0.5, z: 0 };
  f.player('collector').space!.phase = 'recovering';
  f.run();
  const d = collectorDecision(f)!;
  assert.equal(d.selectedId, 'support');
  assert.equal(d.agency!.baselineId, 'screen');
  assert.match(d.agency!.bids.find((c) => c.botId === 'reserve')!.rejection!, /reserve/);
  assert.match(d.agency!.bids.find((c) => c.botId === 'collector')!.rejection!, /ready weapon/);
  assert.equal(steer(f, 'support')!.pickupRequested, true);
});

test('collector preferences cannot steal an active screen, a personal regroup or observed human pursuit', () => {
  const f = collectorFixture(false);
  f.tactics.defaults.tipoffCollectorAgencyStrength = 1;
  f.tactics.botStyles = { screen: 'opportunist', reserve: 'opportunist', support: 'guardian' };
  f.player('enemy-screen').pos = { x: 2.5, z: -5.5 };
  f.run();
  assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true);
  f.player('collector').space!.phase = 'recovering';
  f.run();
  assert.equal(collectorDecision(f)!.selectedId, 'support');
  assert.match(collectorDecision(f)!.agency!.bids.find((c) => c.botId === 'screen')!.rejection!, /screen/);
  assert.equal(steer(f, 'support')!.pickupRequested, false);
  f.tactics.defaults.tipoffRegroupSeconds = 1;
  f.tactics.defaults.tipoffRecoveryAgencyStrength = 1;
  f.tactics.botStyles.collector = 'guardian';
  f.run(0.01);
  f.player('collector').space!.phase = 'ready';
  f.player('support').height = 1;
  f.run();
  assert.match(collectorDecision(f)!.candidates.find((c) => c.botId === 'collector')!.rejection!, /regroup/);

  const h = collectorAgencyFixture(0);
  h.player('collector').pos = { x: -1, z: 0 };
  h.run();
  h.tactics.defaults.tipoffCollectorAgencyStrength = 1;
  h.tactics.defaults.reassignmentAdvantage = 4;
  h.player('collector').space!.speed = 0.5;
  h.player('screen').pos = { x: -2, z: 3 };
  h.snapshot.players.push({ ...actor('human', 'blue', -4), scripted: false, vel: { x: 1, z: 0 } });
  h.run();
  assert.equal(collectorDecision(h)!.selectedId, 'collector');
  assert.match(collectorDecision(h)!.candidates.find((c) => c.botId === 'screen')!.rejection!, /human or neural/);
});

test('collector individuality handles unavailable rosters, blocked routes and disabled dependencies', () => {
  const f = collectorAgencyFixture();
  f.run();
  for (const p of f.snapshot.players.filter((p) => p.team === 'blue' && p.id !== 'reserve'))
    p.space!.phase = 'recovering';
  assert.ok(f.run().every((a) => a.tipoff!.job !== 'collector' && !a.tipoff!.attack));
  assert.equal(collectorDecision(f)!.selectedId, null);
  const blocked = collectorAgencyFixture();
  blocked.snapshot.geometry!.blockers.push({ kind: 'box', x: 0, z: 0, hx: 1, hz: 1 });
  blocked.run();
  assert.equal(collectorDecision(blocked)!.selectedId, null);
  for (const key of ['tipoffCollectorHandoffEnabled', 'tipoffEnabled', 'enabled', 'spaceEnabled'] as const) {
    const off = collectorAgencyFixture();
    off.tactics.defaults[key] = false;
    assert.ok(off.run().every((a) => !a.tipoff?.collectorSelection?.agency));
  }
});

test('collector individuality mirrors main_ai, uses team overrides and survives JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = collectorAgencyFixture(0),
      team = mirror ? 'red' : 'blue';
    f.player('screen').id = 'main_ai';
    f.tactics.botStyles = { main_ai: 'opportunist' };
    f.tactics.teams[team] = { tipoffCollectorAgencyStrength: 1 };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.run();
    assert.equal(f.state.assignments.get('main_ai')!.tipoff!.collectorSelection!.selectedId, 'main_ai');
    assert.equal(resolveTeamTactics(f.tactics, mirror ? 'blue' : 'red').tipoffCollectorAgencyStrength, 0);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('main_ai').space!.phase = 'recovering';
    for (const dt of [0.2, 0.2, 0.2]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('collector individuality ends with the opening and starts fresh on the next round', () => {
  for (const end of ['possession', 'displacement', 'timeout', 'round'] as const) {
    const f = collectorAgencyFixture();
    f.run();
    if (end === 'possession') f.snapshot.holderId = 'screen';
    if (end === 'displacement') f.snapshot.ballPhysics!.pos.x = 1;
    if (end === 'round') f.snapshot.round++;
    const orders = f.run(end === 'timeout' ? 9 : 0.2);
    if (end === 'round') assert.equal(collectorDecision(f)!.previousId, null);
    else assert.ok(orders.every((a) => !a.tipoff));
  }
});

test('schema 40 migrates collector individuality at zero without changing existing handoff settings', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffCollectorAgencyStrength, 0);
  for (let version = 1; version < 40; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.tipoffCollectorAgencyStrength;
    old.defaults.tipoffCollectorHandoffEnabled = true;
    old.defaults.tipoffCollectorAdvantage = 0.6;
    old.teams.red = { tipoffCollectorAdvantage: 0.8 };
    old.botStyles = { main_ai: 'opportunist' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffCollectorAgencyStrength, 0);
    assert.equal(next.defaults.tipoffCollectorHandoffEnabled, true);
    assert.equal(next.defaults.tipoffCollectorAdvantage, 0.6);
    assert.deepEqual(next.teams, old.teams);
    assert.deepEqual(next.botStyles, old.botStyles);
  }
  config.defaults.tipoffCollectorAgencyStrength = 0.4;
  config.teams.red = { tipoffCollectorAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true]) {
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffCollectorAgencyStrength: bad } } }));
    assert.throws(() =>
      validateGrifballTactics({ ...config, defaults: { ...config.defaults, tipoffCollectorAgencyStrength: bad } }),
    );
  }
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffCollectorAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});

function reserveFixture(clear = false) {
  const f = clear ? collectorFixture() : targetFixture();
  f.tactics.defaults.tipoffReserveHandoffEnabled = true;
  return f;
}
const reserveDecision = (f: ReturnType<typeof fixture>) =>
  [...f.state.assignments.values()].find((a) => a.team === 'blue' && a.tipoff)?.tipoff?.reserveSelection;

test('reserve handoff assigns actual rear movement and holds challenges until coverage arrives', () => {
  const f = reserveFixture();
  f.run();
  assert.equal(reserveDecision(f)!.selectedId, 'reserve');
  assert.equal(reserveDecision(f)!.covered, true);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true);
  f.player('reserve').space!.phase = 'recovering';
  f.run();
  const d = reserveDecision(f)!;
  assert.equal(d.selectedId, 'support');
  assert.equal(d.covered, false);
  assert.match(d.candidates.find((c) => c.botId === 'screen')!.rejection!, /screen challenge/);
  assert.match(d.candidates.find((c) => c.botId === 'collector')!.rejection!, /collector/);
  assert.deepEqual(f.state.assignments.get('support')!.destination, d.point);
  assert.equal(f.state.assignments.get('support')!.role, 'safety');
  assert.ok(f.run().every((a) => !a.tipoff!.attack));
  assert.ok(steer(f, 'support'));
  assert.equal(steer(f, 'support')!.pickupRequested, false);
  f.player('support').pos = { ...d.point };
  f.run();
  assert.equal(reserveDecision(f)!.covered, true);
  assert.equal(f.state.assignments.get('screen')!.tipoff!.attack, true);
  f.player('reserve').space!.phase = 'ready';
  f.run();
  assert.equal(reserveDecision(f)!.selectedId, 'support');
  assert.equal(f.state.assignments.get('reserve')!.tipoff!.job, 'support');
});

for (const phase of ['recovering', 'swing_up', 'lunging', 'airborne', 'immobile', 'missing'] as const)
  test('reserve ' + phase + ' interrupts slow refresh and starts a rear handoff', () => {
    const f = reserveFixture();
    f.tactics.defaults.refreshSeconds = 1;
    f.run(0.01);
    f.run(0.01);
    const revision = f.state.revision;
    if (phase === 'missing') f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'reserve');
    else if (phase === 'airborne') f.player('reserve').height = 1;
    else if (phase === 'immobile') f.player('reserve').space!.mobileIn = 0.5;
    else f.player('reserve').space!.phase = phase;
    f.run(0.01);
    assert.ok(f.state.revision > revision);
    assert.equal(reserveDecision(f)!.selectedId, 'support');
    assert.ok([...f.state.assignments.values()].filter((a) => a.team === 'blue').every((a) => !a.tipoff!.attack));
  });

test('rear lane boundary crossings interrupt slow refresh without swapping a ready reserve', () => {
  const f = reserveFixture();
  f.tactics.defaults.refreshSeconds = 1;
  f.run(0.01);
  f.run(0.01);
  let revision = f.state.revision;
  f.player('reserve').pos.z = reserveDecision(f)!.halfWidth + 0.1;
  f.run(0.01);
  assert.ok(f.state.revision > revision);
  assert.equal(reserveDecision(f)!.covered, false);
  assert.equal(reserveDecision(f)!.selectedId, 'reserve');
  f.run(0.01);
  revision = f.state.revision;
  f.player('reserve').pos = { ...reserveDecision(f)!.point };
  f.run(0.01);
  assert.ok(f.state.revision > revision);
  assert.equal(reserveDecision(f)!.covered, true);
});

test('lost rear readiness or position revokes stale challenge permission but never immediate defense', () => {
  for (const loss of ['recovery', 'lateral', 'forward', 'missing'] as const) {
    const f = personalOpening('guardian');
    f.tactics.defaults.tipoffReserveHandoffEnabled = true;
    f.run();
    f.player('screen').pos.x = -4;
    f.player('enemy-screen').space!.attackIn = 0.8;
    f.run();
    const a = f.state.assignments.get('screen')!;
    assert.equal(a.tipoff!.attack, true);
    assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy-screen');
    if (loss === 'recovery') f.player('reserve').space!.phase = 'recovering';
    if (loss === 'lateral') f.player('reserve').pos.z = 4;
    if (loss === 'forward') f.player('reserve').pos.x = -2;
    if (loss === 'missing') f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'reserve');
    assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), null);
    f.player('enemy-screen').pos.x = -2;
    assert.equal(selectGrifballAssignmentThreat(a, f.player('screen').pos, f.snapshot.players), 'enemy-screen');
  }
});

test('no eligible rear reserve contains while leaving safe collector pickups available', () => {
  const f = reserveFixture(true);
  f.run();
  for (const id of ['screen', 'support', 'reserve']) f.player(id).space!.phase = 'recovering';
  const orders = f.run();
  assert.equal(reserveDecision(f)!.selectedId, null);
  assert.ok(orders.every((a) => a.tipoff!.job !== 'reserve' && !a.tipoff!.attack));
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
  f.player('support').space!.phase = 'ready';
  f.run();
  assert.equal(reserveDecision(f)!.selectedId, 'support');
});

test('reserve handoffs reject unreachable rear routes and never issue observed-player orders', () => {
  const f = reserveFixture();
  f.run();
  const point = reserveDecision(f)!.point;
  f.snapshot.geometry!.blockers.push({ kind: 'box', ...point, hx: 1, hz: 1 });
  f.run();
  assert.equal(reserveDecision(f)!.selectedId, null);
  assert.ok(
    reserveDecision(f)!
      .candidates.filter((c) => c.botId !== 'collector')
      .every((c) => c.rejection?.includes('route')),
  );
  const h = reserveFixture();
  h.player('reserve').scripted = false;
  h.run();
  assert.ok(!h.state.assignments.has('reserve'));
  assert.ok(reserveDecision(h)!.candidates.every((c) => c.botId !== 'reserve'));
});

test('rear coverage can be restored during personal regroup without granting a screen challenge', () => {
  const f = reserveFixture(true);
  Object.assign(f.tactics.defaults, { tipoffRegroupSeconds: 0.5, tipoffRecoveryAgencyStrength: 1 });
  f.tactics.botStyles.support = 'guardian';
  f.run();
  f.player('reserve').height = 1;
  f.run(0.01);
  assert.equal(reserveDecision(f)!.selectedId, 'support');
  f.player('support').pos = { ...reserveDecision(f)!.point };
  assert.ok(f.run(0.01).every((a) => !a.tipoff!.attack));
  assert.equal(reserveDecision(f)!.covered, true);
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'reserve');
  assert.equal(steer(f, 'collector')!.pickupRequested, true);
});

test('reserve handoffs clear target holds and restore normal behavior when disabled', () => {
  const f = reserveFixture();
  f.tactics.defaults.tipoffTargetCommitSeconds = 1;
  f.run();
  assert.ok(f.state.assignments.get('screen')!.tipoff!.targetSelection!.commitment);
  f.player('reserve').space!.phase = 'recovering';
  f.run();
  assert.ok(!f.state.assignments.get('screen')!.tipoff!.targetSelection);
  f.player('support').pos = { ...reserveDecision(f)!.point };
  f.run();
  assert.equal(f.state.assignments.get('screen')!.tipoff!.targetSelection!.commitment!.previousId, null);
  for (const key of ['tipoffReserveHandoffEnabled', 'tipoffEnabled', 'spaceEnabled', 'enabled'] as const) {
    const off = reserveFixture();
    off.run();
    off.tactics.defaults[key] = false;
    assert.ok(off.run().every((a) => !a.tipoff?.reserveSelection));
  }
});

test('reserve handoff follows main_ai, team overrides, mirrored worlds and JSON continuation', () => {
  for (const mirror of [false, true]) {
    const f = reserveFixture(),
      team = mirror ? 'red' : 'blue';
    f.player('support').id = 'main_ai';
    f.tactics.defaults.tipoffReserveHandoffEnabled = false;
    f.tactics.teams[team] = { tipoffReserveHandoffEnabled: true };
    if (mirror)
      for (const p of f.snapshot.players) {
        p.team = p.team === 'blue' ? 'red' : 'blue';
        p.pos.x *= -1;
        p.pos.z *= -1;
      }
    f.snapshot.players.reverse();
    f.run();
    f.player('reserve').space!.phase = 'recovering';
    f.run();
    const d = f.state.assignments.get('main_ai')!.tipoff!.reserveSelection!;
    assert.equal(d.selectedId, 'main_ai');
    assert.equal(resolveTeamTactics(f.tactics, mirror ? 'blue' : 'red').tipoffReserveHandoffEnabled, false);
    const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
    restored.assignments = new Map(restored.assignments);
    f.player('main_ai').pos = { ...d.point };
    for (const dt of [0.2, 0.2, 0.2]) {
      f.run(dt);
      updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
      assert.equal(
        JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
        JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
      );
    }
  }
});

test('reserve handoff lifecycle ends at possession, displacement or timeout and resets by round', () => {
  for (const end of ['possession', 'displacement', 'timeout', 'round'] as const) {
    const f = reserveFixture();
    f.run();
    if (end === 'possession') f.snapshot.holderId = 'collector';
    if (end === 'displacement') f.snapshot.ballPhysics!.pos.x = 1;
    if (end === 'round') f.snapshot.round++;
    const orders = f.run(end === 'timeout' ? 9 : 0.2);
    if (end === 'round') assert.equal(reserveDecision(f)!.previousId, null);
    else assert.ok(orders.every((a) => !a.tipoff));
  }
});

test('schema 41 migrates reserve handoff off and preserves existing collector settings', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 41);
  assert.equal(config.defaults.tipoffReserveHandoffEnabled, false);
  for (let version = 1; version < 41; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.tipoffReserveHandoffEnabled;
    old.defaults.tipoffCollectorAgencyStrength = 0.7;
    old.teams.red = { tipoffCollectorHandoffEnabled: true };
    old.botStyles = { main_ai: 'guardian' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffReserveHandoffEnabled, false);
    assert.equal(next.defaults.tipoffCollectorAgencyStrength, 0.7);
    assert.deepEqual(next.teams, old.teams);
    assert.deepEqual(next.botStyles, old.botStyles);
  }
  config.defaults.tipoffReserveHandoffEnabled = true;
  config.teams.red = { tipoffReserveHandoffEnabled: false };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [0, 1, 'true', null, {}]) {
    assert.throws(() =>
      validateGrifballTactics({ ...config, defaults: { ...config.defaults, tipoffReserveHandoffEnabled: bad } }),
    );
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffReserveHandoffEnabled: bad } } }));
  }
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffReserveHandoffEnabled;
  assert.throws(() => validateGrifballTactics(missing));
});
