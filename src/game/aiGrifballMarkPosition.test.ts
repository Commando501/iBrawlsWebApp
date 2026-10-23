import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { applyGrifballMarkPosition } from './aiGrifballMarkPosition';
import { createSnapshotRouters } from './aiGrifballRunner';
import { buildGrifballSpaceGeometry, fieldDistance } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import {
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

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
const geometry = (objects: Partial<CustomMapData['objects'][number]>[] = []) =>
  buildGrifballSpaceGeometry(
    {
      mapShape: 'rectangular',
      arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 },
      objects,
    } as CustomMapData,
    52,
  );
function fixture(style: GrifballPlayerStyle = 'guardian') {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, { markAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false, passingEnabled: false });
  config.botStyles.marker = style;
  const carrier = actor('runner', 'red', 10);
  carrier.vel.x = -5.2;
  carrier.space!.weapon = 'ball';
  carrier.space!.reach = 1.8;
  const target = actor('escort', 'red', 2, -8),
    marker = actor('marker', 'blue', -1.5, -8);
  // A tighter mark can preserve the attack margin when approached along its
  // goal-side line. Off that line the exposure check may correctly reject it.
  if (style === 'enforcer') marker.pos = { x: 2 - (49 / Math.hypot(49, 8)) * 3.5, z: -8 + (8 / Math.hypot(49, 8)) * 3.5 };
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: carrier.id,
    ball: { ...carrier.pos },
    spacing: 4,
    tactics: config,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: geometry(),
    players: [actor('pressure', 'blue', 6), actor('back', 'blue', -8), marker, carrier, target],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return state.assignments.get(marker.id)!;
  };
  return { config, snapshot, marker, target, carrier, state, run };
}
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function prepared(style: GrifballPlayerStyle = 'guardian') {
  const f = fixture(style);
  f.config.defaults.markAgencyStrength = 0;
  const a = f.run();
  f.config.defaults.markAgencyStrength = 1;
  const assignments = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const apply = (contain = false) =>
    applyGrifballMarkPosition(f.snapshot, assignments, f.config.defaults, createSnapshotRouters(f.snapshot), contain);
  return { ...f, a, assignments, apply };
}

for (const style of styles)
  test(`${style} varies only its reserved mark and keeps synchronized movement and combat destinations`, () => {
    const f = fixture(style),
      a = f.run(),
      d = a.defense!.positioning!;
    assert.equal(a.defense!.mode, 'mark');
    assert.equal(a.defense!.targetId, 'escort');
    assert.equal(d.style, style);
    assert.equal(d.strength, 1);
    assert.deepEqual(a.destination, a.defense!.intercept);
    assert.equal(d.applied, style !== 'balanced', d.reason);
    const depth = style === 'enforcer' ? 4.25 : style === 'guardian' ? 6.25 : 5;
    const dx = -49 / Math.hypot(49, 8),
      dz = 8 / Math.hypot(49, 8),
      width = style === 'opportunist' ? 1.25 : 0;
    near(a.destination.x, 2 + dx * depth - dz * width);
    near(a.destination.z, -8 + dz * depth + dx * width);
    const off = fixture(style);
    off.config.defaults.markAgencyStrength = 0;
    off.run();
    for (const id of ['pressure', 'back']) {
      const before = off.state.assignments.get(id)!,
        after = f.state.assignments.get(id)!;
      assert.equal(after.defense?.positioning, undefined);
      assert.equal(after.defense?.mode, before.defense?.mode);
      assert.deepEqual(after.destination, before.destination);
      assert.equal(after.defense?.targetId, before.defense?.targetId);
    }
  });

test('zero strength preserves full assignments across styles and missing styles use Balanced', () => {
  const baseline = fixture('balanced');
  baseline.config.defaults.markAgencyStrength = 0;
  baseline.run();
  for (const style of styles) {
    const f = fixture(style);
    f.config.defaults.markAgencyStrength = 0;
    f.marker.pos = { ...baseline.marker.pos };
    f.run();
    assert.deepEqual(f.state.assignments, baseline.state.assignments);
  }
  const f = fixture();
  delete f.config.botStyles.marker;
  assert.equal(f.run().defense!.positioning!.style, 'balanced');
});

for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled'] as const)
  test(`marking preference requires ${key}`, () => {
    const f = fixture();
    f.config.defaults[key] = false;
    f.run();
    assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.positioning));
  });

test('half strength blends offsets independently of defensive job and carrier styles', () => {
  const f = fixture();
  f.config.defaults.markAgencyStrength = 0.5;
  f.config.botStyles.runner = 'enforcer';
  f.config.botStyles.pressure = 'opportunist';
  const a = f.run();
  near(fieldDistance(a.destination, a.defense!.positioning!.teamPoint), 0.625);
  assert.equal(a.defense!.individuality, undefined);
});

for (const mode of [
  'contain',
  'transition',
  'emergency',
  'airborne',
  'lunging',
  'late',
  'threat',
  'spacing',
  'blocked',
  'response',
  'corridor',
] as const)
  test(`${mode} rejects a preferred mark without changing the reserved job`, () => {
    const f = prepared('opportunist');
    if (mode === 'transition') f.a.defense!.transitioning = true;
    if (mode === 'emergency') f.a.defense!.emergency = true;
    if (mode === 'airborne') f.marker.height = 1;
    if (mode === 'lunging') f.marker.space!.phase = 'lunging';
    if (mode === 'late') f.marker.space!.speed = 0.1;
    if (mode === 'threat') f.snapshot.players.push(actor('extra', 'red', -3, -11));
    if (mode === 'spacing') f.assignments.find((a) => a.botId === 'back')!.destination = { x: -3.2, z: -8.5 };
    if (mode === 'blocked')
      f.snapshot.geometry = geometry([
        { type: 'box', position: { x: -3.14, y: 2, z: -8.43 }, scale: { x: 0.4, y: 4, z: 0.4 }, isCollidable: true },
      ]);
    if (mode === 'response')
      f.snapshot.geometry = geometry([
        { type: 'box', position: { x: -0.5, y: 2, z: -8.2 }, scale: { x: 0.4, y: 4, z: 0.4 }, isCollidable: true },
      ]);
    if (mode === 'corridor') f.carrier.pos = { x: 15, z: 0 };
    const before = structuredClone(f.a);
    f.apply(mode === 'contain');
    const decision = f.a.defense!.positioning!;
    assert.equal(decision.applied, false, `${mode}: ${decision.reason}`);
    assert.deepEqual(f.a.destination, before.destination);
    assert.equal(f.a.defense!.targetId, before.defense!.targetId);
    assert.deepEqual(f.a.defense!.intercept, before.defense!.intercept);
    assert.match(
      decision.reason,
      mode === 'contain' || mode === 'transition'
        ? /containment/
        : mode === 'emergency'
          ? /emergency/
          : mode === 'airborne' || mode === 'lunging'
            ? /Committed/
            : mode === 'late'
              ? /0.35/
              : mode === 'threat'
                ? /attack margin/
                : mode === 'spacing'
                  ? /crowds/
                  : mode === 'corridor'
                    ? /corridor/
                    : /blocked/,
    );
  });

for (const mode of ['last-defender', 'intercept', 'recover', 'contain', 'human', 'receive', 'tanking'] as const)
  test(`${mode} ownership cannot be replaced by a marking position`, () => {
    const f = prepared();
    if (['last-defender', 'intercept', 'recover', 'contain'].includes(mode)) f.a.defense!.mode = mode as 'contain';
    if (mode === 'human') f.marker.scripted = false;
    if (mode === 'receive') f.a.receive = { carrierId: 'runner', point: { x: 0, z: 0 }, seconds: 1 };
    if (mode === 'tanking')
      f.a.tanking = {
        mode: 'engage',
        attack: true,
        targetId: 'escort',
        partnerId: null,
        recoveryId: 'back',
        doubleCommit: false,
        reason: 'earned',
        candidates: [],
      };
    const before = structuredClone(f.a);
    f.apply();
    assert.deepEqual(f.a, before);
  });

test('live edits, team scope, mirrored teams, roster order and checkpoints retain identity and determinism', () => {
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true]) {
        const f = fixture();
        const id = main ? 'main_ai' : 'marker',
          team = mirror ? 'red' : 'blue';
        f.marker.id = id;
        f.config.botStyles = { [id]: 'guardian' };
        if (mirror)
          for (const p of f.snapshot.players) {
            p.team = p.team === 'blue' ? 'red' : 'blue';
            p.pos.x *= -1;
            p.pos.z *= -1;
            p.vel.x *= -1;
            p.vel.z *= -1;
          }
        if (reverse) f.snapshot.players.reverse();
        f.config.teams[team] = { markAgencyStrength: 0.5 };
        const a = f.run();
        assert.equal(a.defense!.positioning!.strength, 0.5);
        assert.equal(a.defense!.positioning!.style, 'guardian');
        near(fieldDistance(a.destination, a.defense!.positioning!.teamPoint), 0.625);
        const restored = structuredClone(f.state);
        f.config.botStyles[id] = 'enforcer';
        for (const state of [f.state, restored]) updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0);
        assert.deepEqual(f.state, restored);
        assert.equal(f.state.assignments.get(id)!.defense!.positioning!.style, 'enforcer');
        f.config.teams[team] = { markAgencyStrength: 0 };
        assert.equal(f.run(0).defense!.positioning, undefined);
      }
});

test('possession and round boundaries clear old marking decisions', () => {
  for (const mode of ['loose', 'friendly', 'inactive'] as const) {
    const f = fixture();
    assert.ok(f.run().defense!.positioning);
    if (mode === 'loose') f.snapshot.holderId = null;
    if (mode === 'friendly') f.snapshot.holderId = f.marker.id;
    if (mode === 'inactive') f.snapshot.playing = false;
    f.run();
    assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.positioning));
  }
});

test('a slow marker cannot trade away response time for a deeper position', () => {
  const f = prepared();
  f.marker.space!.speed = 1;
  f.marker.pos = { ...f.a.destination };
  f.apply();
  assert.equal(f.a.defense!.positioning!.applied, false);
  assert.match(f.a.defense!.positioning!.reason, /respond more than 0.35/);
});

test('bounded depth retains ordinary reach clearance and never overshoots the goal', () => {
  const tight = prepared('enforcer');
  const dx = -49 / Math.hypot(49, 8),
    dz = 8 / Math.hypot(49, 8);
  tight.a.destination = { x: 2 + dx * 3.5, z: -8 + dz * 3.5 };
  tight.apply();
  near(fieldDistance(tight.target.pos, tight.a.defense!.positioning!.preferredPoint), 3.25);
  const nearGoal = prepared();
  nearGoal.snapshot.goals.blue = { x: -2, z: -8 };
  nearGoal.apply();
  assert.deepEqual(nearGoal.a.defense!.positioning!.preferredPoint, nearGoal.snapshot.goals.blue);
});

test('repeat planning starts from the team slot without accumulating personal offsets', () => {
  const f = fixture(),
    first = structuredClone(f.run().destination);
  for (let i = 0; i < 5; i++) assert.deepEqual(f.run().destination, first);
  f.config.botStyles.marker = 'balanced';
  const a = f.run(0);
  assert.deepEqual(a.destination, a.defense!.positioning!.teamPoint);
});

test('outnumbered defense keeps team marks even when marking strength is enabled', () => {
  const f = fixture();
  f.snapshot.players.push(actor('extra1', 'red', 20, 12), actor('extra2', 'red', 20, -12));
  const a = f.run();
  assert.equal(a.defense!.mode, 'mark');
  assert.equal(a.defense!.positioning!.applied, false);
  assert.match(a.defense!.positioning!.reason, /containment/);
  assert.deepEqual(a.destination, a.defense!.positioning!.teamPoint);
});

test('observed markers receive no orders and other bots retain their own styles', () => {
  const f = fixture();
  f.marker.scripted = false;
  f.run();
  assert.equal(f.state.assignments.has('marker'), false);
  assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.positioning));
});

test('schemas 1–24 migrate marking off and preserve existing controls and styles', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.schemaVersion, 43);
  assert.equal(current.defaults.markAgencyStrength, 0);
  for (let version = 1; version <= 24; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.markAgencyStrength;
    old.defaults.runnerPatienceAgencyStrength = 0.7;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { runnerPatienceAgencyStrength: 0.3 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.markAgencyStrength, 0);
    assert.equal(next.defaults.runnerPatienceAgencyStrength, 0.7);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(resolveTeamTactics(next, 'red').runnerPatienceAgencyStrength, 0.3);
  }
  current.teams.red = { markAgencyStrength: 0.8 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const v of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { markAgencyStrength: v } } }));
  const bad = JSON.parse(JSON.stringify(current));
  delete bad.defaults.markAgencyStrength;
  assert.throws(() => validateGrifballTactics(bad));
});
