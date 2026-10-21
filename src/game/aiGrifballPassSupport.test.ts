import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { resolveGrifballPassSupport } from './aiGrifballPassSupport';
import { createSnapshotRouters } from './aiGrifballRunner';
import { predictBallRecovery } from './aiGrifballPassing';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall, throwBall } from './grifballBall';
import { deflectBallWithHammer } from './hammerBallDeflection';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan,
  type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const player = (id: string, x: number, z = 0, team = 'blue'): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5, mobileIn: 0, reach: 3, blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0 } });
function scene(): GrifballTacticalSnapshot {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, { passSupportEnabled: true, stylesEnabled: false, tankingEnabled: false });
  const ball = createInitialBall({ x: 0, y: 1.1, z: 0 });
  throwBall(ball, ball.pos, { x: 1, y: 0, z: 0 }, 18);
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, ballPhysics: ball, holderId: null, spacing: 4, tactics,
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [player('receiver', 20), player('thrower', -10, 4), player('cover', 3, -4), player('enemy', 40, 12, 'red')] };
}
const landing = (s: GrifballTacticalSnapshot) => predictBallRecovery(s.ballPhysics!, s.passing!.bounds);
function flight(s: GrifballTacticalSnapshot, team = 'blue', receiverId = 'receiver') {
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, structuredClone(s), .2);
  state.passFlight = { team, carrierId: 'thrower', receiverId };
  updateGrifballTeamPlan(state, structuredClone(s), .2); return state;
}
const assignments = (state: ReturnType<typeof flight>, team = 'blue') => [...state.assignments.values()].filter(a => a.team === team);
const supported = (state: ReturnType<typeof flight>) => [...state.assignments.values()].filter(a => a.defense?.passSupport);
function input(s: GrifballTacticalSnapshot) {
  return { snapshot: s, team: 'blue', assignments: assignments(flight(s)), flight: { team: 'blue' },
    tuning: s.tactics!.defaults, routers: createSnapshotRouters(s), recovery: landing(s) };
}

test('prepares separate last-defender and lateral cover positions around the predicted landing, preserving the receiver', () => {
  const s = scene(), result = flight(s), a = assignments(result), prediction = landing(s);
  assert.ok(prediction.point.x > s.ball.x + 5);
  const receiver = a.find(a => a.role === 'retriever')!, safety = a.find(a => a.defense?.mode === 'last-defender')!, cover = a.find(a => a.defense?.mode === 'recover')!;
  assert.equal(receiver.botId, 'receiver'); assert.equal(receiver.defense, undefined);
  assert.deepEqual(receiver.receive!.point, prediction.point);
  assert.equal(supported(result).length, 2);
  for (const support of [safety, cover]) {
    assert.deepEqual(support.anchor, prediction.point);
    assert.deepEqual(support.defense!.passSupport, { receiverId: receiver.botId, point: prediction.point, settleIn: prediction.seconds });
    assert.ok(support.destination.x < prediction.point.x); assert.equal(support.defense!.targetId, null);
    assert.equal(support.tanking, undefined); assert.equal(support.escort, undefined);
    assert.equal(support.space!.route.status, 'direct');
  }
  assert.equal(safety.destination.z, 0); assert.equal(Math.abs(cover.destination.z), s.tactics!.defaults.lateralSpacing);
  assert.equal(prediction.point.x - cover.destination.x, 4);
  assert.equal(prediction.point.x - safety.destination.x, s.tactics!.defaults.defenseSafetyDepth);
});
for (const key of ['passSupportEnabled', 'enabled', 'spaceEnabled', 'defenseEnabled', 'passingEnabled'] as const)
  test(`pass support respects ${key}`, () => {
    const s = scene(); s.tactics!.defaults[key] = false;
    assert.equal(supported(flight(s)).length, 0); assert.equal(resolveGrifballPassSupport(input(s)), undefined);
  });
test('disabled support retains exact established assignments regardless of its cover depth', () => {
  const s = scene(); s.tactics!.defaults.passSupportEnabled = false;
  const base = flight(s); s.tactics!.defaults.passSupportDepth = 10;
  const changed = flight(s);
  for (const a of assignments(changed)) {
    const before = base.assignments.get(a.botId)!;
    assert.deepEqual({ ...a, tuning: undefined }, { ...before, tuning: undefined });
  }
  assert.ok(assignments(base).filter(a => a.defense).every(a => a.anchor.x === s.ball.x));
});
test('cover depth changes lateral support without moving the receiver or changing last-defender depth', () => {
  const s = scene(), base = flight(s); s.tactics!.defaults.passSupportDepth = 8;
  const changed = flight(s);
  for (const a of assignments(changed)) {
    const before = base.assignments.get(a.botId)!;
    assert.equal(a.role, before.role);
    if (a.role === 'cover') { assert.equal(before.destination.x - a.destination.x, 4); assert.equal(a.destination.z, before.destination.z); }
    else assert.deepEqual(a.destination, before.destination);
  }
});
test('no support is added for an unreserved ball, an enemy pass or an unknown trajectory', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, .2);
  assert.equal(supported(state).length, 0); assert.equal(supported(flight(s, 'red', 'enemy')).length, 0);
  const i = input(s);
  assert.equal(resolveGrifballPassSupport({ ...i, flight: null }), undefined);
  assert.equal(resolveGrifballPassSupport({ ...i, recovery: undefined }), undefined);
  assert.equal(resolveGrifballPassSupport({ ...i, recovery: { ...i.recovery, settled: false } }), undefined);
});
for (const kind of ['dead', 'observed', 'airborne', 'lunging', 'blocked'] as const)
  test(`an unavailable ${kind} assigned receiver cannot activate support`, () => {
    const s = scene(), i = input(s), receiver = s.players[0];
    if (kind === 'dead') s.players.shift();
    if (kind === 'observed') receiver.scripted = false;
    if (kind === 'airborne') receiver.height = 2;
    if (kind === 'lunging') receiver.space!.phase = 'lunging';
    if (kind === 'blocked') { receiver.pos.x = -20; s.geometry!.blockers.push({ kind: 'box', x: 0, z: 0, hx: 1, hz: 30 }); }
    i.routers = createSnapshotRouters(s);
    assert.equal(resolveGrifballPassSupport(i), undefined);
  });
test('uses the actual replacement when the original receiver disappears, even with adaptive recovery off', () => {
  const s = scene(); s.players.shift();
  const state = flight(s), retriever = assignments(state).find(a => a.role === 'retriever')!;
  assert.notEqual(retriever.botId, 'receiver'); assert.equal(supported(state).length, 1);
  assert.equal(supported(state)[0].defense!.passSupport!.receiverId, retriever.botId);
});
test('a real hammer deflection refreshes the landing anchor and follows an adaptive receiver handoff', () => {
  const s = scene(); s.tactics!.defaults.passRecoveryEnabled = true;
  s.players[0].pos = { ...landing(s).point }; const state = flight(s), before = supported(state)[0].anchor.x;
  assert.ok(deflectBallWithHammer(s.ballPhysics!, { x: 1, y: 1.1, z: 0 }, s.ballPhysics!.pos, 2,
    { hammerBallDeflectionEnabled: true, hammerBallDeflectionStrength: 1 }));
  s.ball = { x: s.ballPhysics!.pos.x, z: s.ballPhysics!.pos.z };
  updateGrifballTeamPlan(state, structuredClone(s), .2);
  const receiver = assignments(state).find(a => a.role === 'retriever')!;
  assert.notEqual(receiver.botId, 'receiver'); assert.equal(state.passFlight!.receiverId, receiver.botId);
  assert.ok(supported(state)[0].anchor.x < before);
  for (const a of supported(state)) {
    assert.deepEqual(a.anchor, landing(s).point); assert.equal(a.defense!.passSupport!.receiverId, receiver.botId);
  }
});
test('settled own passes retain landing support until possession, using the current loose-ball position', () => {
  const s = scene(), state = flight(s); s.ballPhysics!.state = 'loose'; s.ball = { x: 6, z: 3 };
  s.ballPhysics!.pos = { ...s.ball, y: .35 }; updateGrifballTeamPlan(state, structuredClone(s), .2);
  assert.equal(supported(state).length, 2);
  for (const a of supported(state)) { assert.deepEqual(a.anchor, s.ball); assert.equal(a.defense!.passSupport!.settleIn, 0); }
});
test('human/neural pickup priority suppresses support and never creates an order for the observed player', () => {
  const s = scene(); s.ballPhysics!.state = 'loose';
  s.players.push({ ...player('human', 0), scripted: false, pickupRequested: true });
  const state = flight(s); assert.equal(supported(state).length, 0);
  assert.ok(!assignments(state).some(a => a.role === 'retriever')); assert.equal(state.assignments.has('human'), false);
});
for (const mode of ['possession', 'enemy possession', 'round', 'idle', 'inactive', 'reset'] as const)
  test(`${mode} clears pass support and releases the old formation`, () => {
    const s = scene(), state = flight(s); assert.equal(supported(state).length, 2);
    if (mode.includes('possession')) { s.holderId = mode === 'possession' ? 'receiver' : 'enemy'; s.ballPhysics!.holderId = s.holderId; s.ballPhysics!.state = 'held'; }
    if (mode === 'round') s.round++;
    if (mode === 'idle') s.ballPhysics!.state = 'idle';
    if (mode === 'inactive') s.playing = false;
    if (mode === 'reset') resetGrifballTeamPlan(state); else updateGrifballTeamPlan(state, structuredClone(s), .2);
    assert.equal(supported(state).length, 0); assert.equal(state.passFlight, null);
  });
test('a checkpoint, reversed roster, and mirrored teams preserve the same separate coverage jobs', () => {
  const s = scene(), base = flight(s), saved = structuredClone(base);
  updateGrifballTeamPlan(base, structuredClone(s), .2); updateGrifballTeamPlan(saved, structuredClone(s), .2);
  assert.deepEqual(saved.assignments, base.assignments);
  for (const mirror of [false, true]) for (const reverse of [false, true]) {
    const next = scene();
    if (reverse) next.players.reverse();
    if (mirror) {
      for (const p of next.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.pos.z *= -1; }
      next.ballPhysics!.vel.x *= -1;
    }
    const result = flight(next, mirror ? 'red' : 'blue');
    for (const a of assignments(result, mirror ? 'red' : 'blue')) {
      const before = base.assignments.get(a.botId)!; assert.equal(a.role, before.role);
      assert.ok(Math.abs(a.destination.x - before.destination.x * (mirror ? -1 : 1)) < 1e-6);
      assert.ok(Math.abs(a.destination.z - before.destination.z * (mirror ? -1 : 1)) < 1e-6);
    }
  }
});
test('team overrides enable only that team and keep the landing depth independent', () => {
  const s = scene(); s.tactics!.defaults.passSupportEnabled = false;
  s.tactics!.teams.red = { passSupportEnabled: true, passSupportDepth: 8 }; assert.equal(supported(flight(s)).length, 0);
  s.tactics!.teams.blue = { passSupportEnabled: true, passSupportDepth: 6 };
  const cover = assignments(flight(s)).find(a => a.role === 'cover')!;
  assert.equal(cover.anchor.x - cover.destination.x, 6);
});
test('v1–18 presets migrate off without losing existing recovery settings; v19 validates both controls', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 26);
  assert.equal(current.defaults.passSupportEnabled, false); assert.equal(current.defaults.passSupportDepth, 4);
  for (let version = 1; version <= 18; version++) {
    const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = version;
    delete old.defaults.passSupportEnabled; delete old.defaults.passSupportDepth;
    old.defaults.passRecoveryEnabled = true; old.defaults.passRecoveryAgencyStrength = .7; old.botStyles.receiver = 'guardian';
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.passSupportEnabled, false); assert.equal(migrated.defaults.passSupportDepth, 4);
    assert.equal(migrated.defaults.passRecoveryEnabled, true); assert.equal(migrated.defaults.passRecoveryAgencyStrength, .7);
    assert.equal(migrated.botStyles.receiver, 'guardian');
  }
  current.teams.red = { passSupportEnabled: true, passSupportDepth: 7 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').passSupportEnabled, false);
  for (const value of [1.9, 10.1, NaN, '4']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passSupportDepth: value } } }));
  assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passSupportEnabled: 1 } } }));
  for (const key of ['passSupportEnabled', 'passSupportDepth']) {
    const invalid = JSON.parse(JSON.stringify(current)); delete invalid.defaults[key]; assert.throws(() => validateGrifballTactics(invalid));
  }
});
