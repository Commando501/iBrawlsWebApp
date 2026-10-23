import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { createInitialBall } from './grifballBall';
import { defaultGrifballTactics, validateGrifballTactics } from './grifballTacticsConfig';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  selectGrifballAssignmentThreat,
  type GrifballTacticalSnapshot,
  type GrifballTacticalPlayer,
} from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { createSnapshotRouters } from './aiGrifballRunner';
import { applyGrifballTipoffReservePosition } from './aiGrifballTipoffReservePosition';
import { isTipoffReserveCovering } from './aiGrifballTipoffReserve';
import { resolveGrifballSupportSteering } from './aiGrifballObjectiveSteering';
import type { GrifballPlayerStyle } from './grifballPlayerStyles';

function fixture(style: GrifballPlayerStyle = 'guardian', strength = 1) {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, {
    tipoffEnabled: true,
    tipoffReserveHandoffEnabled: true,
    tipoffReservePositionAgencyStrength: strength,
    stylesEnabled: false,
    passingEnabled: false,
  });
  config.botStyles.reserve = style;
  const player = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({
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
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: null,
    ball: { x: 0, z: 0 },
    ballPhysics: createInitialBall({ x: 0, y: 0.35, z: 0 }),
    spacing: 4,
    tactics: config,
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
      player('collector', 'blue', -2),
      player('screen', 'blue', -8, -6),
      player('support', 'blue', -10, 6),
      player('reserve', 'blue', -16),
      player('enemy', 'red', 18, 0),
      player('enemy-screen', 'red', 40, -5.5),
      player('enemy-support', 'red', 40, 6),
    ],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return [...state.assignments.values()].filter((a) => a.team === 'blue');
  };
  const p = (id: string) => snapshot.players.find((p) => p.id === id)!;
  const a = () => state.assignments.get('reserve')!;
  const d = () => a().tipoff!.reservePosition!;
  const steer = () =>
    resolveGrifballSupportSteering({
      assignment: a(),
      pos: p('reserve').pos,
      allies: snapshot.players.filter((p) => p.team === 'blue' && p.id !== 'reserve').map((p) => p.pos),
      players: snapshot.players,
      ball: snapshot.ball,
      heldByAnyone: !!snapshot.holderId,
      separation: 4,
      speed: 5.2,
      dt: 1 / 60,
    });
  return { config, snapshot, state, run, p, a, d, steer };
}

for (const [style, x, z] of [
  ['balanced', -10.5, 0],
  ['enforcer', -9.75, 0],
  ['guardian', -11.5, 0],
  ['opportunist', -10.5, -1],
] as const)
  test(`${style} reserve chooses a bounded position without changing roles or coverage geometry`, () => {
    const f = fixture(style);
    f.p('reserve').pos.z = -0.5;
    if (style === 'opportunist') {
      f.p('screen').pos.x = f.p('support').pos.x = -2;
    }
    f.run();
    assert.equal(f.d().applied, style !== 'balanced', f.d().reason);
    assert.deepEqual(f.a().destination, { x, z });
    assert.deepEqual(f.a().tipoff!.reserveSelection!.point, { x: -10.5, z: 0 });
    assert.equal(f.a().tipoff!.reserveSelection!.covered, true);
    assert.equal(f.a().role, 'safety');
    assert.equal(f.steer()!.pickupRequested, false);
    assert.ok(f.d().routeCovered);
    assert.ok(
      f
        .run()
        .filter((a) => a.botId !== 'reserve')
        .every((a) => !a.tipoff!.reservePosition),
    );
  });

test('zero preserves complete orders and gradual strength changes actual steering', () => {
  const baseline = fixture('balanced', 0);
  baseline.run();
  for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const) {
    const f = fixture(style, 0);
    f.run();
    assert.deepEqual([...f.state.assignments], [...baseline.state.assignments]);
  }
  const f = fixture('guardian', 0.5);
  f.p('reserve').pos = { x: -10.5, z: 0 };
  f.run();
  assert.equal(f.a().destination.x, -11);
  assert.equal(f.d().teamArrival, 0);
  assert.ok(f.steer()!.velocity.x < 0);
  f.config.defaults.tipoffReservePositionAgencyStrength = 1;
  f.run(0);
  assert.equal(f.a().destination.x, -11.5);
  f.config.defaults.tipoffReservePositionAgencyStrength = 0;
  f.run(0);
  assert.equal(f.a().destination.x, -10.5);
  assert.equal(f.d(), undefined);
});

test('centered Opportunists shade a nearby occupied flank, with stable ordering and no arbitrary empty flank', () => {
  const f = fixture('opportunist');
  f.p('screen').pos.x = f.p('support').pos.x = -2;
  f.run();
  assert.equal(f.d().applied, false);
  assert.match(f.d().reason, /No occupied/);
  f.p('enemy').pos = { x: 16, z: 2 };
  f.run();
  assert.equal(f.a().destination.z, 1);
  f.snapshot.players.reverse();
  f.run();
  assert.equal(f.a().destination.z, 1);
  f.p('reserve').pos.z = -0.5;
  f.run();
  assert.equal(f.a().destination.z, -1, 'existing flank takes priority');
});

test('pending reserve handoffs retain the team point until actual coverage is restored', () => {
  const f = fixture();
  f.run();
  f.p('reserve').space!.phase = 'recovering';
  f.p('reserve').pos.x = -20;
  f.config.botStyles.support = 'guardian';
  let orders = f.run(),
    reserve = orders.find((a) => a.tipoff!.job === 'reserve')!;
  assert.equal(reserve.botId, 'support');
  assert.equal(reserve.tipoff!.reservePosition!.applied, false);
  assert.ok(orders.every((a) => !a.tipoff!.attack));
  f.p('support').pos = { ...reserve.tipoff!.reserveSelection!.point };
  orders = f.run();
  reserve = orders.find((a) => a.tipoff!.job === 'reserve')!;
  assert.equal(reserve.tipoff!.reservePosition!.applied, true, reserve.tipoff!.reservePosition!.reason);
  f.p('reserve').space!.phase = 'ready';
  f.run();
  assert.equal(f.state.assignments.get('support')!.tipoff!.job, 'reserve');
});

test('regrouping, containment and earned screen challenges keep the exact reserve position', () => {
  const f = fixture();
  f.run();
  const apply = () =>
    applyGrifballTipoffReservePosition(
      f.snapshot,
      [...f.state.assignments.values()].filter((a) => a.team === 'blue'),
      f.config.defaults,
      createSnapshotRouters(f.snapshot),
      false,
    );
  f.a().destination = { ...f.d().teamPoint };
  f.a().tipoff!.phase = 'regroup';
  apply();
  assert.equal(f.d().applied, false);
  assert.match(f.d().reason, /Regrouping/);
  f.a().tipoff!.phase = 'contain';
  apply();
  assert.equal(f.d().applied, false);
  f.a().tipoff!.phase = 'claim';
  f.state.assignments.get('screen')!.tipoff!.attack = true;
  apply();
  assert.equal(f.d().applied, false);
  assert.match(f.d().reason, /earned screen/);
  // The live combat adapter still withdraws a planned challenge as soon as
  // physical rear coverage is lost, regardless of the reserve's preference.
  const screen = f.state.assignments.get('screen')!;
  screen.tipoff!.targetId = 'enemy';
  screen.destination = { ...f.p('screen').pos };
  f.p('reserve').pos.x = 0;
  assert.equal(selectGrifballAssignmentThreat(screen, f.p('screen').pos, f.snapshot.players), null);
});

test('readiness and full planned route must retain the original coverage strip', () => {
  const f = fixture();
  f.run();
  const orders = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const point = { ...f.d().teamPoint };
  for (const phase of ['recovering', 'swing_up', 'lunging']) {
    f.p('reserve').space!.phase = phase;
    f.a().destination = { ...point };
    applyGrifballTipoffReservePosition(f.snapshot, orders, f.config.defaults, createSnapshotRouters(f.snapshot), false);
    assert.equal(f.d().applied, false);
    assert.match(f.d().reason, /ready rear coverage/);
  }
  f.p('reserve').space!.phase = 'ready';
  f.a().destination = { ...point };
  const routers = createSnapshotRouters(f.snapshot),
    original = routers.get('reserve')!;
  routers.set('reserve', (end, distanceOnly) =>
    distanceOnly ? original(end, true) : { status: 'routed', points: [{ x: -8, z: 4 }, end], length: 10 },
  );
  applyGrifballTipoffReservePosition(f.snapshot, orders, f.config.defaults, routers, false);
  assert.equal(f.d().applied, false);
  assert.equal(f.d().routeCovered, false);
  assert.match(f.d().reason, /ground route leaves/);
});

test('collector routes, actual teammates, blocked positions and delayed arrival reject preferences', () => {
  const crowd = fixture('enforcer');
  crowd.p('collector').pos.x = -8;
  crowd.run();
  assert.equal(crowd.d().applied, false);
  assert.match(crowd.d().reason, /collector route/);
  const teammate = fixture();
  teammate.p('support').pos = { x: -17, z: 0 };
  teammate.run();
  assert.equal(teammate.d().applied, false);
  assert.match(teammate.d().reason, /reserved teammate/);
  const blocked = fixture();
  blocked.snapshot.geometry!.blockers.push({ kind: 'box', x: -11.5, z: 0, hx: 0.1, hz: 0.1 });
  blocked.run();
  assert.equal(blocked.d().applied, false);
  assert.match(blocked.d().reason, /ground route/);
  const slow = fixture();
  slow.p('reserve').pos = { x: -10.5, z: 0 };
  slow.p('reserve').space!.speed = 0.5;
  slow.run();
  assert.equal(slow.d().applied, false);
  assert.match(slow.d().reason, /0.35 s/);
});

test('visible attack margin cannot be traded for a personal reserve position', () => {
  const f = fixture('guardian');
  f.run();
  const orders = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  f.a().destination = { ...f.d().teamPoint };
  f.p('reserve').pos = { ...f.d().teamPoint };
  f.p('enemy').pos = { x: -17, z: 3 };
  applyGrifballTipoffReservePosition(f.snapshot, orders, f.config.defaults, createSnapshotRouters(f.snapshot), false);
  assert.equal(f.d().applied, false);
  assert.match(f.d().reason, /attack margin/);
});

test('mirrored main_ai overrides and JSON continuation preserve deterministic reserve movement', () => {
  const f = fixture('guardian', 0);
  f.p('reserve').id = 'main_ai';
  f.config.botStyles = { main_ai: 'guardian' };
  f.config.teams.red = { tipoffReservePositionAgencyStrength: 1 };
  for (const p of f.snapshot.players) {
    p.team = p.team === 'blue' ? 'red' : 'blue';
    p.pos.x *= -1;
    p.pos.z *= -1;
  }
  f.run();
  const a = f.state.assignments.get('main_ai')!;
  assert.equal(a.destination.x, 11.5);
  assert.ok(a.tipoff!.reservePosition!.applied);
  const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
  restored.assignments = new Map(restored.assignments);
  for (const dt of [0.1, 0.2, 0.3]) {
    f.run(dt);
    updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
    assert.equal(
      JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
      JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
    );
  }
  const r = a.tipoff!.reserveSelection!;
  assert.ok(isTipoffReserveCovering({ ...f.p('main_ai'), pos: a.destination }, f.snapshot.ball, r.point, r.halfWidth));
});

test('disabling dependencies and ending the opening clear reserve position diagnostics', () => {
  for (const key of ['enabled', 'spaceEnabled', 'tipoffEnabled', 'tipoffReserveHandoffEnabled'] as const) {
    const f = fixture();
    f.run();
    f.config.defaults[key] = false;
    assert.ok(f.run(0).every((a) => !a.tipoff?.reservePosition));
  }
  for (const end of ['possession', 'displacement', 'timeout', 'round'] as const) {
    const f = fixture();
    f.run();
    if (end === 'possession') f.snapshot.holderId = 'collector';
    if (end === 'displacement') f.snapshot.ballPhysics!.pos.x = 1;
    if (end === 'round') f.snapshot.round++;
    const orders = f.run(end === 'timeout' ? 9 : 0.2);
    if (end === 'round') assert.equal(f.a().tipoff!.reserveSelection!.previousId, null);
    else assert.ok(orders.every((a) => !a.tipoff?.reservePosition));
  }
});

test('schema 43 preserves prior settings and migrates reserve positioning at zero', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 43);
  assert.equal(config.defaults.tipoffReservePositionAgencyStrength, 0);
  for (let version = 1; version < 43; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.tipoffReservePositionAgencyStrength;
    old.defaults.tipoffReserveHandoffEnabled = true;
    old.defaults.tipoffReserveAgencyStrength = 0.7;
    old.teams.red = { tipoffReserveAgencyStrength: 0.5 };
    old.botStyles = { main_ai: 'guardian' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffReservePositionAgencyStrength, 0);
    assert.equal(next.defaults.tipoffReserveHandoffEnabled, true);
    assert.equal(next.defaults.tipoffReserveAgencyStrength, 0.7);
    assert.deepEqual(next.teams, old.teams);
    assert.deepEqual(next.botStyles, old.botStyles);
  }
  config.defaults.tipoffReservePositionAgencyStrength = 0.5;
  config.teams.red = { tipoffReservePositionAgencyStrength: 1 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [-0.1, 1.1, NaN, Infinity, '1', true]) {
    assert.throws(() =>
      validateGrifballTactics({
        ...config,
        defaults: { ...config.defaults, tipoffReservePositionAgencyStrength: bad },
      }),
    );
    assert.throws(() =>
      validateGrifballTactics({ ...config, teams: { red: { tipoffReservePositionAgencyStrength: bad } } }),
    );
  }
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffReservePositionAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});
