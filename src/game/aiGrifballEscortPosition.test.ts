import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { applyGrifballEscortPosition } from './aiGrifballEscortPosition';
import { createSnapshotRouters } from './aiGrifballRunner';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall } from './grifballBall';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

const p = (id: string, x: number, z = 0, team = 'blue'): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: id === 'runner' ? 'ball' : 'hammer', phase: 'ready', speed: 5.2, mobileIn: 0, reach: 3, blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0 } });
function scene(style: GrifballPlayerStyle = 'balanced'): GrifballTacticalSnapshot {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, { escortAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false, passingEnabled: false });
  tactics.botStyles = { a: style, b: style, c: style, runner: 'opportunist' };
  const ball = createInitialBall({ x: 0, y: .35, z: 0 }); ball.state = 'held'; ball.holderId = 'runner';
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, ballPhysics: ball, holderId: 'runner', spacing: 4, tactics,
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('runner', 0), p('a', 4, 2.5), p('b', 4, -2.5), p('c', -3, 2.5)] };
}
function run(s: GrifballTacticalSnapshot) {
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, structuredClone(s), .2); return state;
}
/** Exercise a late owner after the earlier owners have produced their orders. */
function prepared(style: GrifballPlayerStyle = 'opportunist') {
  const s = scene(style); s.tactics!.defaults.escortAgencyStrength = 0;
  const state = run(s), assignments = [...state.assignments.values()], play = state.runnerPlans.blue;
  s.tactics!.defaults.escortAgencyStrength = 1;
  const apply = () => applyGrifballEscortPosition(s, assignments, play, s.tactics!.defaults, createSnapshotRouters(s));
  return { s, state, assignments, play, a: state.assignments.get('a')!, apply };
}
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const points = { balanced: { x: 4, z: 2.5 }, enforcer: { x: 5, z: 2.5 }, opportunist: { x: 4, z: 4 }, guardian: { x: 3.25, z: 2.5 } };
for (const style of styles) {
  test(`${style} gives passive escorts their own eligible positions without taking another role`, () => {
    const state = run(scene(style)), a = state.assignments.get('a')!;
    assert.deepEqual(a.destination, points[style]); assert.deepEqual(a.escort!.destination, a.destination);
    assert.equal(a.escortPosition!.style, style); assert.equal(a.escortPosition!.applied, style !== 'balanced');
    assert.equal(a.role, 'lead'); assert.equal(a.escort!.targetId, null);
    assert.equal(state.assignments.get('c')!.escortPosition, undefined);
    assert.equal(state.assignments.get('c')!.escort!.kind, 'rear-guard');
    assert.equal(state.assignments.get('runner')!.escortPosition, undefined);
  });
  test(`${style} at zero preserves exact team assignments and intermediate strengths blend offsets`, () => {
    const s = scene(style); s.tactics!.defaults.escortAgencyStrength = 0; const baseline = run(s);
    s.tactics!.botStyles.a = 'balanced'; s.tactics!.botStyles.b = 'balanced'; s.tactics!.botStyles.c = 'balanced';
    assert.deepEqual(run(s).assignments, baseline.assignments);
    s.tactics!.botStyles.a = style; s.tactics!.defaults.escortAgencyStrength = .5;
    assert.deepEqual(run(s).assignments.get('a')!.destination, { x: (4 + points[style].x) / 2, z: (2.5 + points[style].z) / 2 });
  });
  test(`${style} works with passive tanking cover while preserving its recovery reserve`, () => {
    const s = scene(style); s.tactics!.defaults.tankingEnabled = true;
    const state = run(s), a = state.assignments.get('a')!, reserve = state.assignments.get(a.tanking!.recoveryId!)!;
    assert.deepEqual(a.destination, points[style]); assert.equal(a.tanking!.mode, 'cover'); assert.equal(a.escort, undefined);
    assert.equal(reserve.escortPosition, undefined); assert.equal(reserve.tanking!.attack, false);
  });
}
for (const key of ['enabled', 'spaceEnabled', 'runnerEnabled'] as const) test(`escort preferences require ${key}`, () => {
  const s = scene('guardian'); s.tactics!.defaults[key] = false;
  assert.ok([...run(s).assignments.values()].every(a => !a.escortPosition));
});
test('each escort owns its preference independently of the carrier, teammates and other strengths', () => {
  const s = scene('enforcer'); s.tactics!.botStyles.b = 'guardian'; s.tactics!.botStyles.c = 'opportunist';
  const state = run(s); assert.deepEqual(state.assignments.get('a')!.destination, points.enforcer);
  assert.deepEqual(state.assignments.get('b')!.destination, { x: 3.25, z: -2.5 });
  delete s.tactics!.botStyles.a; assert.equal(run(s).assignments.get('a')!.escortPosition!.style, 'balanced');
  assert.equal(s.tactics!.defaults.agencyStrength, 0); assert.equal(s.tactics!.defaults.runnerAgencyStrength, 0);
  assert.equal(s.tactics!.defaults.passSupportAgencyStrength, 0);
});
test('observed carriers get escort support without receiving scripted movement orders', () => {
  const s = scene('enforcer'); s.players[0].scripted = false; s.players[0].vel.x = 5;
  const state = run(s); assert.equal(state.assignments.has('runner'), false);
  assert.ok(state.assignments.get('a')!.escortPosition); assert.equal(state.runnerPlans.blue.selected.action, 'observed');
});
for (const mode of ['receive', 'rear', 'intercept', 'recovery', 'engage', 'punish', 'release', 'initiative'] as const)
  test(`${mode} ownership cannot be replaced by a personal escort position`, () => {
    const f = prepared();
    if (mode === 'receive') f.a.receive = { carrierId: 'runner', point: { x: 10, z: 2 }, seconds: 1 };
    if (mode === 'rear') f.a.escort!.kind = 'rear-guard';
    if (mode === 'intercept') { f.a.escort!.kind = 'intercept'; f.a.escort!.targetId = 'enemy'; }
    if (['recovery', 'engage', 'punish', 'release'].includes(mode)) {
      delete f.a.escort;
      f.a.tanking = { mode: mode === 'recovery' ? 'cover' : mode as 'engage' | 'punish' | 'release', attack: mode === 'engage',
        targetId: null, recoveryId: mode === 'recovery' ? f.a.botId : 'c', partnerId: null, doubleCommit: false, candidates: [], reason: 'Earlier owner' };
    }
    if (mode === 'initiative') f.a.agency = { style: 'opportunist', choice: 'initiative', reason: 'Earlier owner', alternatives: [] };
    const before = structuredClone(f.a); f.apply(); assert.deepEqual(f.a, before);
  });
test('completed passes release landing support and establish new escort preferences for the new carrier', () => {
  const s = scene('guardian'); s.holderId = null; s.ballPhysics!.holderId = null; s.ballPhysics!.state = 'loose';
  s.tactics!.defaults.passSupportEnabled = s.tactics!.defaults.passingEnabled = true;
  const state = run(s); state.passFlight = { carrierId: 'a', receiverId: 'runner', team: 'blue' };
  updateGrifballTeamPlan(state, structuredClone(s), .2);
  assert.ok([...state.assignments.values()].some(a => a.defense?.passSupport));
  s.holderId = s.ballPhysics!.holderId = 'runner'; s.ballPhysics!.state = 'held'; s.tactics!.defaults.passingEnabled = false;
  updateGrifballTeamPlan(state, structuredClone(s), .01);
  assert.equal(state.passFlight, null); assert.ok([...state.assignments.values()].every(a => !a.defense?.passSupport));
  assert.equal(state.assignments.get('runner')!.role, 'runner'); assert.ok(state.assignments.get('a')!.escortPosition);
});
test('new pass receiving orders take priority when passing is enabled', () => {
  const s = scene('enforcer'); s.tactics!.defaults.passingEnabled = true; s.players[2].pos = { x: 14, z: 0 };
  const state = run(s), receivers = [...state.assignments.values()].filter(a => a.receive);
  assert.ok(receivers.length); assert.ok(receivers.every(a => !a.escortPosition));
});
for (const mode of ['airborne', 'lunging', 'blocked', 'late', 'threat', 'spacing', 'corridor', 'finish'] as const)
  test(`${mode} can reject a preferred escort position`, () => {
    const f = prepared(), player = f.s.players.find(p => p.id === 'a')!;
    if (mode === 'airborne') player.height = 2;
    if (mode === 'lunging') player.space!.phase = 'lunging';
    if (mode === 'blocked') f.s.geometry!.blockers.push({ kind: 'box', x: 4, z: 4, hx: .3, hz: .3 });
    if (mode === 'late') player.space!.speed = 1;
    if (mode === 'threat') f.s.players.push(p('enemy', 4, 7, 'red'));
    if (mode === 'spacing') f.state.assignments.get('b')!.destination = { x: 4, z: 4.5 };
    if (mode === 'corridor') f.play.selected.route.points = [{ x: 6, z: 5 }];
    if (mode === 'finish') f.play.selected.action = 'finish';
    const before = { ...f.a.destination }; f.apply();
    assert.equal(f.a.escortPosition!.applied, false); assert.deepEqual(f.a.destination, before);
    assert.match(f.a.escortPosition!.reason, mode === 'airborne' || mode === 'lunging' ? /Committed/ : mode === 'blocked' ? /blocked/ : mode === 'late' ? /0.35/ : mode === 'threat' ? /attack margin/ : mode === 'spacing' ? /crowds/ : mode === 'corridor' ? /corridor/ : /scoring/);
  });
test('style changes, team scopes, mirrors, roster order and checkpoints remain deterministic', () => {
  for (const style of styles) for (const mirror of [false, true]) for (const reverse of [false, true]) {
    const s = scene(style), team = mirror ? 'red' : 'blue', sign = mirror ? -1 : 1;
    if (mirror) for (const player of s.players) { player.team = team; player.pos.x *= -1; player.pos.z *= -1; }
    if (reverse) s.players.reverse();
    s.tactics!.teams[team] = { escortAgencyStrength: .5 }; const state = run(s), a = state.assignments.get('a')!;
    assert.ok(Math.abs(a.destination.x - (4 + points[style].x) / 2 * sign) < 1e-9);
    assert.ok(Math.abs(a.destination.z - (2.5 + points[style].z) / 2 * sign) < 1e-9);
    const restored = structuredClone(state); s.tactics!.botStyles.a = 'guardian';
    for (const plan of [state, restored]) updateGrifballTeamPlan(plan, structuredClone(s), .2);
    assert.deepEqual(restored.assignments, state.assignments);
  }
});
test('loose balls, opponents, inactive rounds and disabled strength clear escort diagnostics', () => {
  for (const mode of ['loose', 'opponent', 'inactive', 'strength'] as const) {
    const s = scene('guardian'), state = run(s); assert.ok(state.assignments.get('a')!.escortPosition);
    if (mode === 'loose') { s.holderId = null; s.ballPhysics!.holderId = null; s.ballPhysics!.state = 'loose'; }
    if (mode === 'opponent') s.players[0].team = 'red';
    if (mode === 'inactive') s.playing = false;
    if (mode === 'strength') s.tactics!.defaults.escortAgencyStrength = 0;
    updateGrifballTeamPlan(state, structuredClone(s), .2);
    assert.ok([...state.assignments.values()].every(a => !a.escortPosition));
  }
});
test('v1–20 presets migrate off, preserve styles and validate the new scoped strength', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 32); assert.equal(current.defaults.escortAgencyStrength, 0);
  for (let version = 1; version <= 20; version++) {
    const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = version; delete old.defaults.escortAgencyStrength;
    old.defaults.passSupportAgencyStrength = .8; old.botStyles.a = 'enforcer';
    const migrated = validateGrifballTactics(old); assert.equal(migrated.defaults.escortAgencyStrength, 0);
    assert.equal(migrated.defaults.passSupportAgencyStrength, .8); assert.equal(migrated.botStyles.a, 'enforcer');
  }
  current.teams.red = { escortAgencyStrength: .7 }; assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').escortAgencyStrength, 0);
  for (const value of [-.1, 1.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { escortAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current)); delete invalid.defaults.escortAgencyStrength; assert.throws(() => validateGrifballTactics(invalid));
});
