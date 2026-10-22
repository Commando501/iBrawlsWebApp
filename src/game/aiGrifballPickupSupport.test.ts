import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { applyGrifballPickupSupport } from './aiGrifballPickupSupport';
import { createSnapshotRouters } from './aiGrifballRunner';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall } from './grifballBall';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

const actor = (id: string, x: number, z = 0, team = 'blue'): GrifballTacticalPlayer => ({
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
const geometry = (objects: Partial<CustomMapData['objects'][number]>[] = []) =>
  buildGrifballSpaceGeometry(
    { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects } as CustomMapData,
    52,
  );
function fixture(style: GrifballPlayerStyle = 'guardian') {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, {
    pickupSupportAgencyStrength: 1,
    stylesEnabled: false,
    tankingEnabled: false,
    passingEnabled: false,
  });
  config.botStyles.cover = style;
  const cover = actor('cover', -4, -7),
    retriever = actor('a', -3),
    enemy = actor('enemy', 25, 0, 'red');
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: null,
    ball: { x: 0, z: 0 },
    ballPhysics: createInitialBall({ x: 0, y: 0.35, z: 0 }),
    spacing: 4,
    tactics: config,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: geometry(),
    players: [retriever, actor('back', -12), cover, actor('other', -4, 7), enemy],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return state.assignments.get(cover.id)!;
  };
  return { config, snapshot, state, cover, retriever, enemy, run };
}
function prepared(style: GrifballPlayerStyle = 'guardian') {
  const f = fixture(style);
  f.config.defaults.pickupSupportAgencyStrength = 0;
  const a = f.run();
  f.config.defaults.pickupSupportAgencyStrength = 1;
  const assignments = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const apply = (reservedPass = false) =>
    applyGrifballPickupSupport(f.snapshot, assignments, f.config.defaults, createSnapshotRouters(f.snapshot), reservedPass);
  return { ...f, a, assignments, apply };
}
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
for (const style of styles)
  test(`${style} changes only its lateral pickup support position`, () => {
    const f = fixture(style),
      a = f.run(),
      d = a.defense!.pickupSupport!;
    assert.equal(a.defense!.mode, 'recover');
    assert.equal(d.style, style);
    assert.equal(d.retrieverId, 'a');
    assert.equal(d.applied, style !== 'balanced', d.reason);
    assert.deepEqual(d.teamPoint, { x: -4, z: -4 });
    assert.deepEqual(a.destination, a.defense!.intercept);
    near(a.destination.x, style === 'enforcer' ? -3.25 : style === 'guardian' ? -5.25 : -4);
    near(a.destination.z, style === 'opportunist' ? -5.25 : -4);
    const off = fixture(style);
    off.config.defaults.pickupSupportAgencyStrength = 0;
    off.run();
    for (const id of ['a', 'back'])
      assert.deepEqual(
        f.state.assignments.get(id),
        off.state.assignments.get(id) && { ...off.state.assignments.get(id)!, tuning: a.tuning },
      );
    assert.equal(f.state.assignments.get('a')!.role, 'retriever');
    assert.equal(f.state.assignments.get('back')!.defense?.mode, 'last-defender');
  });
test('zero strength preserves complete assignments and missing styles use Balanced', () => {
  const off = fixture('balanced');
  off.config.defaults.pickupSupportAgencyStrength = 0;
  off.run();
  for (const style of styles) {
    const f = fixture(style);
    f.config.defaults.pickupSupportAgencyStrength = 0;
    f.run();
    assert.deepEqual(f.state.assignments, off.state.assignments);
  }
  const f = fixture();
  delete f.config.botStyles.cover;
  const a = f.run();
  assert.equal(a.defense!.pickupSupport!.style, 'balanced');
  assert.equal(a.defense!.pickupSupport!.applied, false);
});
test('fractional strength blends positions and a live edit does not accumulate offsets', () => {
  const f = fixture();
  f.config.defaults.pickupSupportAgencyStrength = 0.4;
  for (let i = 0; i < 10; i++) near(f.run().destination.x, -4.5);
  f.config.botStyles.cover = 'enforcer';
  near(f.run(0).destination.x, -3.7);
  f.config.defaults.pickupSupportAgencyStrength = 0;
  const a = f.run(0);
  near(a.destination.x, -4);
  assert.equal(a.defense!.pickupSupport, undefined);
});
for (const mode of ['emergency', 'outnumbered', 'turnover', 'containment', 'reinforcements'] as const)
  test(`${mode} retains the team support position`, () => {
    const f = prepared();
    if (mode === 'emergency') f.snapshot.goals.blue = { x: -7, z: 0 };
    if (mode === 'outnumbered') f.a.defense!.advantage = -1;
    if (mode === 'turnover') f.a.defense!.transitioning = true;
    if (mode === 'containment') f.config.defaults.defensePressure = 0.2;
    if (mode === 'reinforcements') {
      f.a.defense!.reinforcementIn = 0.1;
      f.a.defense!.advantage = 0;
    }
    const before = { ...f.a.destination };
    f.apply();
    assert.equal(f.a.defense!.pickupSupport!.applied, false);
    assert.deepEqual(f.a.destination, before);
  });
for (const mode of ['airborne', 'lunging', 'mobile-delay'] as const)
  test(`${mode} support retains movement ownership`, () => {
    const f = prepared();
    if (mode === 'airborne') f.cover.height = 1;
    if (mode === 'lunging') f.cover.space!.phase = 'lunging';
    if (mode === 'mobile-delay') f.cover.space!.mobileIn = 0.2;
    f.apply();
    assert.equal(f.a.defense!.pickupSupport!.applied, false);
    assert.match(f.a.defense!.pickupSupport!.reason, /Committed/);
  });
test('blocked destinations and late arrivals reject a preference', () => {
  const f = prepared();
  f.snapshot.geometry = geometry([
    { type: 'box', position: { x: -5.25, y: 2, z: -4 }, scale: { x: 0.1, y: 4, z: 0.1 }, isCollidable: true },
  ]);
  f.apply();
  assert.match(f.a.defense!.pickupSupport!.reason, /blocked/);
  assert.equal(f.a.defense!.pickupSupport!.applied, false);
  const slow = prepared();
  slow.cover.space!.speed = 0.1;
  slow.apply();
  assert.match(slow.a.defense!.pickupSupport!.reason, /0.35/);
  assert.equal(slow.a.defense!.pickupSupport!.applied, false);
});
test('closer support cannot trade away the visible attack margin', () => {
  const f = prepared('enforcer');
  f.enemy.pos = { x: 1, z: -4 };
  f.apply();
  assert.match(f.a.defense!.pickupSupport!.reason, /attack margin/);
  assert.equal(f.a.defense!.pickupSupport!.applied, false);
});
test('reserved destinations and observed teammates retain separation', () => {
  for (const observed of [false, true]) {
    const f = prepared();
    if (observed) {
      const human = actor('human', -5.25, -4);
      human.scripted = false;
      f.snapshot.players.push(human);
    } else f.assignments.find((a) => a.botId === 'back')!.destination = { x: -5.25, z: -4 };
    f.apply();
    assert.match(f.a.defense!.pickupSupport!.reason, /crowds a reserved/);
    assert.equal(f.a.defense!.pickupSupport!.applied, false);
  }
});
test('the retriever approach cannot lose existing clearance, including routed segments', () => {
  const f = prepared();
  f.retriever.pos = { x: -6, z: -4 };
  f.apply();
  assert.match(f.a.defense!.pickupSupport!.reason, /retriever route/);
  assert.equal(f.a.defense!.pickupSupport!.applied, false);
  const bent = prepared();
  bent.retriever.pos = { x: -8, z: -4 };
  const routers = createSnapshotRouters(bent.snapshot);
  routers.set('a', () => ({
    status: 'routed',
    length: 12,
    points: [
      { x: -5.25, z: -4 },
      { x: -5.25, z: 0 },
      { x: 0, z: 0 },
    ],
  }));
  applyGrifballPickupSupport(bent.snapshot, bent.assignments, bent.config.defaults, routers, false);
  const d = bent.a.defense!.pickupSupport!;
  near(d.teamClearance, 1.25);
  near(d.preferredClearance, 0);
  assert.equal(d.applied, false);
});
for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled'] as const)
  test(`pickup support requires ${key}`, () => {
    const f = fixture();
    f.config.defaults[key] = false;
    f.run();
    assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.pickupSupport));
  });
test('passing, tanking and pickup bidding strengths are independent', () => {
  const f = fixture();
  const a = f.run();
  assert.equal(a.defense!.pickupSupport!.applied, true);
  assert.equal(a.pickupAgency, undefined);
  f.config.defaults.pickupAgencyStrength = 1;
  assert.equal(f.run(0).defense!.pickupSupport!.applied, true);
});
for (const mode of [
  'held',
  'thrown',
  'airborne-ball',
  'rising-ball',
  'unknown',
  'inactive',
  'reserved-pass',
  'observed-pickup',
  'airborne-retriever',
  'missing-safety',
] as const)
  test(`${mode} leaves pickup support individuality inactive`, () => {
    const f = prepared();
    if (mode === 'held') f.snapshot.holderId = 'enemy';
    if (mode === 'thrown') f.snapshot.ballPhysics!.state = 'thrown';
    if (mode === 'airborne-ball') f.snapshot.ballPhysics!.pos.y = 2;
    if (mode === 'rising-ball') f.snapshot.ballPhysics!.vel.y = 1;
    if (mode === 'unknown') delete f.snapshot.ballPhysics;
    if (mode === 'inactive') f.snapshot.playing = false;
    if (mode === 'observed-pickup') f.retriever.scripted = false;
    if (mode === 'airborne-retriever') f.retriever.height = 1;
    if (mode === 'missing-safety')
      f.assignments.splice(
        f.assignments.findIndex((a) => a.botId === 'back'),
        1,
      );
    f.apply(mode === 'reserved-pass');
    assert.equal(f.a.defense!.pickupSupport, undefined);
  });
test('a live pass reservation keeps its receiver and support owner even with passing disabled', () => {
  const f = fixture();
  f.snapshot.ballPhysics!.state = 'loose';
  f.run();
  f.state.passFlight = { team: 'blue', receiverId: 'a', carrierId: 'other' };
  f.run();
  assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.pickupSupport));
});
test('human pickup priority does not turn observed participants into scripted retrievers', () => {
  const f = fixture();
  const human = actor('human', 1);
  human.scripted = false;
  human.pickupRequested = true;
  f.snapshot.players.push(human);
  f.run();
  assert.ok(
    [...f.state.assignments.values()]
      .filter((a) => a.team === 'blue')
      .every((a) => a.role !== 'retriever' && !a.defense?.pickupSupport),
  );
  assert.equal(f.state.assignments.has('human'), false);
});
test('pass landing covers and earned tanking assignments retain their owners', () => {
  for (const mode of ['pass', 'receive', 'tank'] as const) {
    const f = prepared();
    const before = structuredClone(f.a);
    if (mode === 'pass') f.a.defense!.passSupport = { receiverId: 'a', point: { x: 0, z: 0 }, settleIn: 0 };
    if (mode === 'receive') f.a.receive = { carrierId: 'other', point: { x: 0, z: 0 }, seconds: 0 };
    if (mode === 'tank') f.a.tanking = {} as NonNullable<typeof f.a.tanking>;
    f.apply();
    assert.equal(f.a.defense!.pickupSupport, undefined);
    assert.deepEqual(f.a.destination, before.destination);
  }
});
test('mirrored teams, roster order, main_ai, scoped strength and checkpoint continuation agree', () => {
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true]) {
        const f = fixture();
        if (main) {
          f.cover.id = 'main_ai';
          f.config.botStyles = { main_ai: 'guardian' };
        }
        if (mirror)
          for (const p of f.snapshot.players) {
            p.team = p.team === 'blue' ? 'red' : 'blue';
            p.pos.x *= -1;
            p.pos.z *= -1;
          }
        if (reverse) f.snapshot.players.reverse();
        f.config.teams[f.cover.team] = { pickupSupportAgencyStrength: 0.8 };
        const a = f.run(),
          d = a.defense!.pickupSupport!;
        assert.equal(d.strength, 0.8);
        assert.equal(d.applied, true, d.reason);
        near(a.destination.x, mirror ? 5 : -5);
        near(a.destination.z, mirror ? 4 : -4);
        const copy = structuredClone(f.state);
        for (const state of [f.state, copy]) updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0.2);
        assert.deepEqual(copy, f.state);
        f.config.teams[f.cover.team] = { pickupSupportAgencyStrength: 0 };
        assert.equal(f.run(0).defense!.pickupSupport, undefined);
      }
});
test('possession and round changes clear old support decisions', () => {
  const f = fixture();
  f.run();
  f.snapshot.holderId = 'a';
  f.snapshot.ballPhysics!.state = 'held';
  f.run();
  assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.pickupSupport));
  f.snapshot.round++;
  f.snapshot.holderId = null;
  f.snapshot.ballPhysics!.state = 'idle';
  assert.equal(f.run().defense!.pickupSupport!.applied, true);
});
test('schema 1–26 imports default support individuality off while preserving styles and earlier strengths', () => {
  const config = defaultGrifballTactics();
  assert.equal(config.schemaVersion, 39);
  assert.equal(config.defaults.pickupSupportAgencyStrength, 0);
  for (let version = 1; version <= 26; version++) {
    const old = JSON.parse(JSON.stringify(config));
    old.schemaVersion = version;
    delete old.defaults.pickupSupportAgencyStrength;
    old.defaults.pickupAgencyStrength = 0.7;
    old.teams.red = { pickupAgencyStrength: 0.4 };
    old.botStyles.main_ai = 'guardian';
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.pickupSupportAgencyStrength, 0);
    assert.equal(next.defaults.pickupAgencyStrength, 0.7);
    assert.equal(resolveTeamTactics(next, 'red').pickupAgencyStrength, 0.4);
    assert.equal(next.botStyles.main_ai, 'guardian');
  }
  config.teams.blue = { pickupSupportAgencyStrength: 0.6 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const value of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { blue: { pickupSupportAgencyStrength: value } } }));
});
