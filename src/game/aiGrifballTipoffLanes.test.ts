import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { createInitialBall } from './grifballBall';
import { defaultGrifballTactics, validateGrifballTactics } from './grifballTacticsConfig';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  type GrifballTacticalSnapshot,
  type GrifballTacticalPlayer,
} from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { resolveGrifballSupportSteering } from './aiGrifballObjectiveSteering';
import { chooseTipoffLanes, planTipoffLanes, type TipoffLaneCandidate } from './aiGrifballTipoffLanes';
import { createSnapshotRouters } from './aiGrifballRunner';

function fixture(enabled = true) {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, {
    tipoffEnabled: true,
    tipoffScreenHandoffEnabled: true,
    tipoffReserveHandoffEnabled: true,
    tipoffLaneContinuityEnabled: enabled,
    stylesEnabled: false,
    passingEnabled: false,
  });
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
      player('screen', 'blue', -8),
      player('support', 'blue', -8.1),
      player('reserve', 'blue', -16),
      player('enemy', 'red', 40, -6),
      player('enemy-support', 'red', 40, 6),
    ],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return [...state.assignments.values()].filter((a) => a.team === 'blue');
  };
  const p = (id: string) => snapshot.players.find((p) => p.id === id)!;
  const a = (id = 'screen') => state.assignments.get(id)!;
  return { config, snapshot, state, run, p, a };
}

test('lane continuity prevents a screen handoff from exchanging lateral destinations', () => {
  const off = fixture(false),
    on = fixture();
  for (const f of [off, on]) {
    f.run();
    assert.equal(f.a().destination.z, -6);
    f.p('screen').space!.phase = 'recovering';
    f.run();
    f.run();
    assert.equal(f.a('support').tipoff!.job, 'screen');
  }
  assert.equal(off.a().destination.z, 6, 'baseline sort order exchanges the lanes');
  assert.equal(on.a().destination.z, -6, 'the previous screen retains its lateral lane');
  assert.equal(on.a('support').destination.z, 6);
});

const option = (lane: number, arrival = 1, rejection: string | null = null) => ({
  lane,
  point: { x: -4, z: -lane * 6 },
  arrival,
  rejection,
});
const candidate = (
  botId: string,
  baselineLane: number,
  previousLane: number | null,
  options = [option(1), option(-1)],
): TipoffLaneCandidate => ({ botId, baselineLane, previousLane, options });

test('retained lanes and replacement bids are deterministic, unique and do not mutate observations', () => {
  const bids = [candidate('b', 1, -1), candidate('a', -1, 1)],
    copy = structuredClone(bids);
  const result = chooseTipoffLanes(bids);
  assert.equal(result.get('a')!.selectedLane, 1);
  assert.equal(result.get('b')!.selectedLane, -1);
  assert.ok([...result.values()].every((d) => d.retained && d.changed));
  assert.deepEqual(
    chooseTipoffLanes([...bids].reverse().map((c) => ({ ...c, options: [...c.options].reverse() }))),
    result,
  );
  assert.deepEqual(bids, copy);
  const replacement = chooseTipoffLanes([
    candidate('a', 1, 1),
    candidate('new', -1, null, [option(1, 0.1), option(-1, 1.2)]),
  ]);
  assert.equal(replacement.get('new')!.selectedLane, -1);
});

test('unreachable and out-of-range old lanes release; incomplete plans never partially overwrite formation', () => {
  const released = chooseTipoffLanes([
    candidate('a', 1, -1, [option(1), option(-1, Infinity, 'Blocked')]),
    candidate('b', -1, 3),
  ]);
  assert.equal(released.get('a')!.selectedLane, 1);
  assert.match(released.get('a')!.previousRejection!, /Blocked/);
  assert.equal(released.get('b')!.selectedLane, -1);
  assert.match(released.get('b')!.previousRejection!, /outside/);
  const fallback = chooseTipoffLanes([
    candidate('a', 1, -1),
    candidate('b', -1, null, [option(1, Infinity, 'Blocked'), option(-1)]),
  ]);
  assert.equal(fallback.get('a')!.selectedLane, 1);
  assert.equal(fallback.get('b')!.selectedLane, -1);
  assert.ok([...fallback.values()].every((d) => !d.retained && !d.changed && /complete safe/.test(d.reason)));
  assert.equal(new Set([...fallback.values()].map((d) => d.selectedLane)).size, 2);
  assert.deepEqual(chooseTipoffLanes([]), new Map());
});

test('duplicate imported reservations are resolved by stable ID without double booking', () => {
  const result = chooseTipoffLanes([candidate('b', -1, 1), candidate('a', 1, 1)]);
  assert.equal(result.get('a')!.selectedLane, 1);
  assert.equal(result.get('b')!.selectedLane, -1);
  assert.match(result.get('b')!.previousRejection!, /could not be reserved/);
});

test('a shrinking lateral roster preserves a usable flank and never absorbs collector or reserve jobs', () => {
  const f = fixture();
  f.run();
  const lane = f.a('support').tipoff!.laneSelection!.selectedLane;
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'screen');
  f.run();
  assert.equal(f.a('support').tipoff!.laneSelection!.selectedLane, lane);
  assert.equal(f.a('support').tipoff!.laneSelection!.retained, true);
  assert.equal(f.a('collector').tipoff!.job, 'collector');
  assert.equal(f.a('reserve').tipoff!.job, 'reserve');
  assert.equal(f.a('collector').tipoff!.laneSelection, undefined);
  assert.equal(f.a('reserve').tipoff!.laneSelection, undefined);
});

test('continuity keeps containment and personal regroup depth authoritative', () => {
  const f = fixture();
  f.config.defaults.tipoffRegroupSeconds = 0.5;
  f.run();
  const lane = f.a().tipoff!.laneSelection!.selectedLane;
  f.p('reserve').height = 1;
  f.run(0.01);
  const screen = f.a();
  assert.equal(screen.tipoff!.phase, 'regroup');
  assert.equal(screen.tipoff!.attack, false);
  if (screen.tipoff!.job === 'support') {
    assert.equal(screen.destination.x, -9);
    assert.equal(screen.tipoff!.laneSelection!.selectedLane, lane);
  }
  assert.ok(f.run(0.01).every((a) => !a.tipoff!.attack));
});

test('lane selection preserves collector clearance, attack margins, arrival limits and observed teammate reservations', () => {
  const f = fixture();
  f.run();
  const assignments = f.run(),
    remaining = [f.a('screen'), f.a('support')];
  const previous = new Map(structuredClone([...f.state.assignments]));
  previous.get('screen')!.tipoff!.laneSelection!.selectedLane = -1;
  previous.get('support')!.tipoff!.laneSelection!.selectedLane = 1;
  const point = (depth: number, side: number) => ({ x: -depth, z: -side });
  const slots = () => new Map(assignments.map((a) => [a, { ...a.destination }]));
  const run = () =>
    planTipoffLanes({
      snapshot: f.snapshot,
      remaining,
      slots: slots(),
      previous,
      tuning: f.config.defaults,
      routers: createSnapshotRouters(f.snapshot),
      collectorId: 'collector',
      spacing: 6,
      firstSide: 1,
      point,
      depth: (a) => (a.botId === 'screen' ? 2 : 4.5),
    });
  f.p('screen').pos = { x: -2, z: -6 };
  let d = run().get('screen')!;
  assert.equal(d.selectedLane, 1);
  assert.match(d.previousRejection!, /0.35 s/);
  f.p('screen').pos = { x: -8, z: 0 };
  f.p('enemy').pos = { x: 0, z: 6 };
  d = run().get('screen')!;
  assert.equal(d.selectedLane, 1);
  assert.match(d.previousRejection!, /attack margin/);
  f.p('enemy').pos = { x: 40, z: -6 };
  const human = structuredClone(f.p('support'));
  human.id = 'human';
  human.scripted = false;
  human.pos = { x: -2, z: 7 };
  f.snapshot.players.push(human);
  d = run().get('screen')!;
  assert.equal(d.selectedLane, 1);
  assert.match(d.previousRejection!, /reserved teammate/);
  f.snapshot.players = f.snapshot.players.filter((p) => p.id !== 'human');
  f.p('collector').pos = { x: -2, z: 7 };
  d = run().get('screen')!;
  assert.equal(d.selectedLane, 1);
  assert.match(d.previousRejection!, /collector route/);
});

test('blocked lane routes fall back together and issue no unreachable movement target', () => {
  const f = fixture();
  f.run();
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -2, z: 6, hx: 0.2, hz: 0.2 });
  f.snapshot.geometry!.key += '-lane-block';
  f.p('screen').space!.phase = 'recovering';
  f.run();
  const orders = f.run();
  assert.ok(
    orders
      .filter((a) => a.tipoff!.laneSelection)
      .every((a) => Number.isFinite(a.destination.x) && Number.isFinite(a.destination.z)),
  );
  for (const a of orders) {
    const route = createSnapshotRouters(f.snapshot).get(a.botId)!(a.destination);
    assert.ok(route.status !== 'blocked' || JSON.stringify(a.destination) === JSON.stringify(f.p(a.botId).pos));
  }
});

test('live steering follows retained lanes while pickup and role ownership stay unchanged', () => {
  const trace = (enabled: boolean) => {
    const f = fixture(enabled);
    f.run();
    f.p('screen').space!.phase = 'recovering';
    f.run();
    f.run();
    const a = f.a('support'),
      p = f.p('support');
    const movement = resolveGrifballSupportSteering({
      assignment: a,
      pos: p.pos,
      allies: f.snapshot.players.filter((q) => q.team === p.team && q.id !== p.id).map((q) => q.pos),
      players: f.snapshot.players,
      ball: f.snapshot.ball,
      heldByAnyone: false,
      separation: 4,
      speed: 5.2,
      dt: 1 / 60,
    });
    assert.equal(movement!.pickupRequested, false);
    assert.equal(a.tipoff!.attack, false);
    return movement!.velocity;
  };
  assert.notDeepEqual(trace(true), trace(false));
});

test('mirrored main_ai follows its team override and JSON continuation preserves lanes', () => {
  const f = fixture(false);
  f.p('support').id = 'main_ai';
  f.config.teams.red = { tipoffLaneContinuityEnabled: true };
  for (const p of f.snapshot.players) {
    p.team = p.team === 'blue' ? 'red' : 'blue';
    p.pos.x *= -1;
    p.pos.z *= -1;
  }
  f.run();
  f.p('screen').space!.phase = 'recovering';
  f.run();
  const oldLane = f.a('main_ai').tipoff!.laneSelection!.selectedLane;
  const restored = JSON.parse(JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }));
  restored.assignments = new Map(restored.assignments);
  for (const dt of [0.2, 0.1, 0.3]) {
    f.snapshot.players.reverse();
    f.run(dt);
    updateGrifballTeamPlan(restored, structuredClone(f.snapshot), dt);
    assert.equal(
      JSON.stringify({ ...restored, assignments: [...restored.assignments] }),
      JSON.stringify({ ...f.state, assignments: [...f.state.assignments] }),
    );
    assert.equal(f.a('main_ai').tipoff!.laneSelection!.selectedLane, oldLane);
  }
});

test('disabled continuity restores ordinary lanes and dependencies/lifecycle clear reservations', () => {
  const f = fixture(),
    off = fixture(false);
  for (const g of [f, off]) {
    g.run();
    g.p('screen').space!.phase = 'recovering';
    g.run();
    g.run();
  }
  f.config.defaults.tipoffLaneContinuityEnabled = false;
  f.run(0);
  off.run(0);
  assert.deepEqual([...f.state.assignments], [...off.state.assignments]);
  for (const key of ['tipoffEnabled', 'enabled', 'spaceEnabled'] as const) {
    const g = fixture();
    g.run();
    g.config.defaults[key] = false;
    assert.ok(g.run(0).every((a) => !a.tipoff?.laneSelection));
  }
  for (const end of ['possession', 'displacement', 'timeout', 'round'] as const) {
    const g = fixture();
    g.run();
    if (end === 'possession') g.snapshot.holderId = 'collector';
    if (end === 'displacement') g.snapshot.ballPhysics!.pos.x = 1;
    if (end === 'round') g.snapshot.round++;
    const orders = g.run(end === 'timeout' ? 9 : 0.2);
    if (end === 'round') assert.ok(orders.every((a) => !a.tipoff?.laneSelection?.previousLane));
    else assert.ok(orders.every((a) => !a.tipoff?.laneSelection));
  }
});

test('schema 44 migrates continuity off without altering reserve settings or sparse team overrides', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 44);
  assert.equal(config.defaults.tipoffLaneContinuityEnabled, false);
  for (let version = 1; version < 44; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.tipoffLaneContinuityEnabled;
    old.defaults.tipoffReservePositionAgencyStrength = 0.7;
    old.teams.red = { tipoffReserveAgencyStrength: 0.5 };
    old.botStyles = { main_ai: 'guardian' };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.tipoffLaneContinuityEnabled, false);
    assert.equal(next.defaults.tipoffReservePositionAgencyStrength, 0.7);
    assert.deepEqual(next.teams, old.teams);
    assert.deepEqual(next.botStyles, old.botStyles);
  }
  config.defaults.tipoffLaneContinuityEnabled = true;
  config.teams.red = { tipoffLaneContinuityEnabled: false };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const bad of [0, 1, 'true', null, {}]) {
    assert.throws(() =>
      validateGrifballTactics({ ...config, defaults: { ...config.defaults, tipoffLaneContinuityEnabled: bad } }),
    );
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { tipoffLaneContinuityEnabled: bad } } }));
  }
  const missing = JSON.parse(JSON.stringify(config));
  delete missing.defaults.tipoffLaneContinuityEnabled;
  assert.throws(() => validateGrifballTactics(missing));
});
