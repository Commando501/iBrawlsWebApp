import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { applyGrifballSafetyPosition } from './aiGrifballSafetyPosition';
import { applyGrifballDefense } from './aiGrifballDefense';
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
  Object.assign(config.defaults, { safetyAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false, passingEnabled: false });
  config.botStyles.back = style;
  const carrier = actor('runner', 'red', 10),
    back = actor('back', 'blue', -8),
    escort = actor('escort', 'red', 12, -10);
  carrier.vel.x = -5.2;
  carrier.space!.weapon = 'ball';
  carrier.space!.reach = 1.8;
  const snapshot: GrifballTacticalSnapshot = {
    round: 1,
    playing: true,
    holderId: carrier.id,
    ball: { ...carrier.pos },
    spacing: 4,
    tactics: config,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: geometry(),
    players: [actor('pressure', 'blue', 6), back, actor('marker', 'blue', 6, -10), carrier, escort],
  };
  const state = createGrifballTeamPlanState();
  const run = (dt = 0.2) => {
    updateGrifballTeamPlan(state, structuredClone(snapshot), dt);
    return state.assignments.get(back.id)!;
  };
  return { config, snapshot, carrier, back, escort, state, run };
}
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function prepared(style: GrifballPlayerStyle = 'guardian') {
  const f = fixture(style);
  f.config.defaults.safetyAgencyStrength = 0;
  const a = f.run();
  f.config.defaults.safetyAgencyStrength = 1;
  const assignments = [...f.state.assignments.values()].filter((a) => a.team === 'blue');
  const apply = (contain = false, protectedCut = false, routers = createSnapshotRouters(f.snapshot)) =>
    applyGrifballSafetyPosition(f.snapshot, assignments, f.config.defaults, routers, contain, protectedCut);
  return { ...f, a, assignments, apply };
}
for (const style of styles)
  test(`${style} changes only the reserved last defender and retains a timely shared cut`, () => {
    const f = fixture(style),
      a = f.run(),
      d = a.defense!.safetyPosition!;
    assert.equal(a.defense!.mode, 'last-defender');
    assert.equal(a.role, 'safety');
    assert.equal(d.style, style);
    assert.equal(d.applied, style !== 'balanced', d.reason);
    near(a.destination.x, d.teamPoint.x + (style === 'enforcer' ? 0.75 : style === 'guardian' ? -1.25 : 0));
    near(a.destination.z, style === 'opportunist' ? -0.75 : 0);
    assert.deepEqual(a.defense!.intercept, a.destination);
    near(fieldDistance(d.cutPoint!, d.teamPoint), 0);
    assert.ok(d.teamReady < d.carrierETA && d.preferredReady < d.carrierETA);
    const off = fixture(style);
    off.config.defaults.safetyAgencyStrength = 0;
    off.run();
    for (const id of ['pressure', 'marker']) {
      const next = f.state.assignments.get(id)!,
        original = off.state.assignments.get(id)!;
      assert.deepEqual(next.defense, original.defense);
      assert.deepEqual(next.destination, original.destination);
      assert.equal(next.role, original.role);
    }
  });
test('zero strength preserves assignments and missing style uses Balanced', () => {
  const f = fixture('balanced');
  f.config.defaults.safetyAgencyStrength = 0;
  f.run();
  for (const style of styles) {
    const next = fixture(style);
    next.config.defaults.safetyAgencyStrength = 0;
    next.run();
    assert.deepEqual(next.state.assignments, f.state.assignments);
  }
  const missing = fixture();
  delete missing.config.botStyles.back;
  assert.equal(missing.run().defense!.safetyPosition!.style, 'balanced');
});
for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled'] as const)
  test(`last-defender preference requires ${key}`, () => {
    const f = fixture();
    f.config.defaults[key] = false;
    f.run();
    assert.ok([...f.state.assignments.values()].every((a) => !a.defense?.safetyPosition));
  });
for (const mode of [
  'contain',
  'transition',
  'emergency',
  'protected',
  'lone',
  'airborne',
  'lunge',
  'mobile',
  'late',
  'blocked',
  'deadline',
  'reach',
  'threat',
  'spacing',
  'observed-spacing',
  'goal-side',
] as const)
  test(`${mode} retains the team position`, () => {
    const f = prepared();
    if (mode === 'transition') f.a.defense!.transitioning = true;
    if (mode === 'emergency') f.a.defense!.emergency = true;
    if (mode === 'lone') f.assignments.splice(0, f.assignments.length, f.a);
    if (mode === 'airborne') f.back.height = 1;
    if (mode === 'lunge') f.back.space!.phase = 'lunging';
    if (mode === 'mobile') f.back.space!.mobileIn = 0.2;
    if (mode === 'late') {
      f.back.pos = { ...f.a.destination };
      f.back.space!.speed = 1;
    }
    if (mode === 'blocked')
      f.snapshot.geometry = geometry([
        { type: 'box', position: { x: -6.05, y: 2, z: 0 }, scale: { x: 0.4, y: 4, z: 0.4 }, isCollidable: true },
      ]);
    if (mode === 'deadline') f.back.space!.attackIn = 5;
    if (mode === 'reach') f.back.space!.reach = 0.5;
    if (mode === 'threat') {
      f.back.pos = { ...f.a.destination };
      f.snapshot.players.push(actor('extra', 'red', -10, 0));
    }
    if (mode === 'spacing') f.assignments.find((a) => a.botId === 'marker')!.destination = { x: -7, z: 0 };
    if (mode === 'observed-spacing') {
      const p = actor('human', 'blue', -7);
      p.scripted = false;
      f.snapshot.players.push(p);
    }
    if (mode === 'goal-side') f.snapshot.goals.blue = { x: -5, z: 0 };
    const before = structuredClone(f.a);
    f.apply(mode === 'contain', mode === 'protected');
    assert.equal(f.a.defense!.safetyPosition!.applied, false, `${mode}: ${f.a.defense!.safetyPosition!.reason}`);
    assert.deepEqual(f.a.destination, before.destination);
    assert.deepEqual(f.a.defense!.intercept, before.defense!.intercept);
    assert.equal(f.a.defense!.arrivalETA, before.defense!.arrivalETA);
    assert.equal(f.a.defense!.targetId, before.defense!.targetId);
    assert.match(
      f.a.defense!.safetyPosition!.reason,
      mode === 'deadline'
        ? /ready before/
        : mode === 'reach'
          ? /out-of-reach/
          : mode === 'threat'
            ? /attack margin/
            : mode.includes('spacing')
              ? /crowds/
              : mode === 'late'
                ? /0.35 s/
                : /team|position/,
    );
  });
test('Opportunist shades a visible nearby escort deterministically, and does not invent a flank', () => {
  const f = prepared('opportunist');
  f.escort.pos.z = 10;
  f.apply();
  near(f.a.destination.z, 0.75);
  assert.equal(f.a.defense!.safetyPosition!.shadeTargetId, 'escort');
  for (const absent of [false, true]) {
    const next = prepared('opportunist');
    if (absent) next.snapshot.players = next.snapshot.players.filter((p) => p !== next.escort);
    else next.escort.pos.z = 0;
    next.apply();
    assert.equal(next.a.defense!.safetyPosition!.applied, false);
    assert.match(next.a.defense!.safetyPosition!.reason, /No nearby escort/);
  }
});
test('bent runner paths use segment travel time and reject blocked responses across the bend', () => {
  const f = prepared();
  f.a.destination = { x: -8, z: 8 };
  f.back.pos = { x: -9, z: 8 };
  const routers = createSnapshotRouters(f.snapshot),
    original = routers.get('runner')!;
  routers.set('runner', (point, lengthOnly) =>
    point === f.snapshot.goals.blue
      ? ({
          status: 'routed',
          length: 73,
          points: [
            { x: 10, z: 8 },
            { x: -10, z: 8 },
            { x: -10, z: 0 },
            { x: -47, z: 0 },
          ],
        } as ReturnType<typeof original>)
      : original(point, lengthOnly),
  );
  f.apply(false, false, routers);
  assert.deepEqual(f.a.defense!.safetyPosition!.cutPoint, { x: -8, z: 8 });
  near(f.a.defense!.safetyPosition!.carrierETA, 26 / 5.2);
  assert.equal(f.a.defense!.safetyPosition!.applied, true, f.a.defense!.safetyPosition!.reason);
  const blocked = prepared();
  blocked.snapshot.geometry = geometry([
    { type: 'box', position: { x: -5.4, y: 2, z: 0 }, scale: { x: 0.1, y: 4, z: 1 }, isCollidable: true },
  ]);
  blocked.apply();
  assert.equal(blocked.a.defense!.safetyPosition!.applied, false);
});
test('no full carrier ground route leaves the team position intact', () => {
  const f = prepared(),
    routers = createSnapshotRouters(f.snapshot),
    original = routers.get('runner')!;
  routers.set('runner', (point, lengthOnly) =>
    point === f.snapshot.goals.blue ? { status: 'blocked', length: Infinity, points: [] } : original(point, lengthOnly),
  );
  f.apply(false, false, routers);
  assert.equal(f.a.defense!.safetyPosition!.applied, false);
  assert.match(f.a.defense!.safetyPosition!.reason, /No ground-route cut/);
});
test('approaching-runner cut stays fixed even with a non-Balanced safety style', () => {
  const f = fixture();
  f.back.pos.x = 5;
  f.snapshot.players.find((p) => p.id === 'pressure')!.pos.x = 8;
  const a = f.run();
  assert.equal(a.defense!.mode, 'last-defender');
  assert.deepEqual(a.destination, f.back.pos);
  assert.equal(a.defense!.safetyPosition!.applied, false);
  assert.match(a.defense!.safetyPosition!.reason, /held interception/);
});
test('an earned carrier tank keeps its separately timed last-defender backup exact', () => {
  const f = prepared();
  f.carrier.space!.phase = 'hammer_recover';
  f.carrier.space!.attackIn = 5;
  const primary = f.assignments.find((a) => a.botId === 'pressure')!,
    partner = f.assignments.find((a) => a.botId === 'marker')!;
  primary.tanking = {
    mode: 'engage',
    attack: true,
    targetId: 'runner',
    partnerId: null,
    recoveryId: 'back',
    doubleCommit: false,
    reason: 'earned',
    candidates: [],
  };
  partner.tanking = { ...primary.tanking, mode: 'punish', partnerId: primary.botId };
  applyGrifballDefense(f.snapshot, f.assignments, f.config.defaults, createSnapshotRouters(f.snapshot), new Map(), 0);
  assert.equal(primary.tanking?.mode, 'engage');
  assert.equal(partner.tanking?.mode, 'punish');
  assert.equal(f.a.defense!.safetyPosition!.applied, false);
  assert.match(f.a.defense!.safetyPosition!.reason, /earned tank backup/);
  assert.deepEqual(f.a.destination, f.a.defense!.safetyPosition!.teamPoint);
});
test('outnumbered, respawn and turnover containment remain authoritative', () => {
  for (const mode of ['numbers', 'respawn', 'turnover']) {
    const f = fixture();
    if (mode === 'numbers') f.snapshot.players.push(actor('extra1', 'red', 30), actor('extra2', 'red', 32));
    if (mode === 'respawn') {
      f.snapshot.players.push(actor('extra', 'red', 30));
      f.snapshot.respawns = [{ id: 'returning', team: 'blue', pos: { x: 12, z: 0 }, seconds: 0.1, speed: 5.2 }];
    }
    if (mode === 'turnover') {
      f.snapshot.holderId = f.back.id;
      f.run();
      f.snapshot.holderId = f.carrier.id;
    }
    const a = f.run();
    assert.equal(a.defense!.safetyPosition!.applied, false);
    assert.match(a.defense!.safetyPosition!.reason, /containment/);
  }
});
test('live edits scale fresh team offsets without accumulating, including scopes, mirrors, roster identity and checkpoints', () => {
  for (const main of [false, true])
    for (const mirror of [false, true])
      for (const reverse of [false, true]) {
        const f = fixture(),
          id = main ? 'main_ai' : 'back',
          team = mirror ? 'red' : 'blue';
        f.back.id = id;
        f.config.botStyles = { [id]: 'guardian' };
        f.config.teams[team] = { safetyAgencyStrength: 0.5 };
        if (mirror)
          for (const p of f.snapshot.players) {
            p.team = p.team === 'blue' ? 'red' : 'blue';
            p.pos.x *= -1;
            p.pos.z *= -1;
            p.vel.x *= -1;
            p.vel.z *= -1;
          }
        if (reverse) f.snapshot.players.reverse();
        const a = f.run(),
          first = { ...a.destination };
        near(fieldDistance(a.destination, a.defense!.safetyPosition!.teamPoint), 0.625);
        for (let i = 0; i < 4; i++) assert.deepEqual(f.run(0).destination, first);
        const restored = structuredClone(f.state);
        f.config.botStyles[id] = 'enforcer';
        for (const state of [f.state, restored]) updateGrifballTeamPlan(state, structuredClone(f.snapshot), 0);
        assert.deepEqual(f.state, restored);
        assert.equal(f.state.assignments.get(id)!.defense!.safetyPosition!.style, 'enforcer');
        f.config.teams[team] = { safetyAgencyStrength: 0 };
        assert.equal(f.run(0).defense!.safetyPosition, undefined);
      }
});
test('possession, inactive round, observed players and non-safety roles do not receive stale safety preferences', () => {
  for (const mode of ['loose', 'friendly', 'inactive', 'observed']) {
    const f = fixture();
    assert.ok(f.run().defense!.safetyPosition);
    if (mode === 'loose') f.snapshot.holderId = null;
    if (mode === 'friendly') f.snapshot.holderId = f.back.id;
    if (mode === 'inactive') f.snapshot.playing = false;
    if (mode === 'observed') f.back.scripted = false;
    f.run();
    assert.equal(f.state.assignments.get(f.back.id)?.defense?.safetyPosition, undefined);
  }
});
test('schemas 1–27 migrate safety preference off and preserve existing settings', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.schemaVersion, 38);
  assert.equal(current.defaults.safetyAgencyStrength, 0);
  for (let version = 1; version <= 27; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.safetyAgencyStrength;
    old.defaults.pickupSupportAgencyStrength = 0.7;
    old.botStyles.main_ai = 'guardian';
    old.teams.red = { pickupSupportAgencyStrength: 0.3 };
    const next = validateGrifballTactics(old);
    assert.equal(next.defaults.safetyAgencyStrength, 0);
    assert.equal(next.defaults.pickupSupportAgencyStrength, 0.7);
    assert.equal(next.botStyles.main_ai, 'guardian');
    assert.equal(resolveTeamTactics(next, 'red').pickupSupportAgencyStrength, 0.3);
  }
  current.teams.red = { safetyAgencyStrength: 0.8 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  for (const v of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { safetyAgencyStrength: v } } }));
  const missing = JSON.parse(JSON.stringify(current));
  delete missing.defaults.safetyAgencyStrength;
  assert.throws(() => validateGrifballTactics(missing));
});
