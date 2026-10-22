import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { chooseGrifballPassSupportPosition } from './aiGrifballPassSupport';
import { createSnapshotRouters } from './aiGrifballRunner';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall } from './grifballBall';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

const player = (id: string, x: number, z = 0, team = 'blue'): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5, mobileIn: 0, reach: 3, blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0 } });
function scene(style: GrifballPlayerStyle = 'balanced'): GrifballTacticalSnapshot {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, { passSupportEnabled: true, passSupportAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false });
  tactics.botStyles = { cover: style, receiver: 'guardian', safety: 'enforcer' };
  const ball = createInitialBall({ x: 0, y: .35, z: 0 }); ball.state = 'loose';
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, ballPhysics: ball, holderId: null, spacing: 4, tactics,
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [player('receiver', 0), player('safety', -7), player('cover', -4, -4)] };
}
function input(s: GrifballTacticalSnapshot) {
  return { snapshot: s, botId: 'cover', support: { receiverId: 'receiver', point: { ...s.ball }, settleIn: 1 },
    tuning: s.tactics!.defaults, routers: createSnapshotRouters(s), teamPoint: { x: -4, z: -4 }, goal: s.goals.blue!, side: 4,
    reserved: [{ x: 0, z: 0 }, { x: -7, z: 0 }] };
}
const run = (s: GrifballTacticalSnapshot) => chooseGrifballPassSupportPosition(input(s));
function flight(s: GrifballTacticalSnapshot, team = 'blue') {
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, structuredClone(s), .2);
  state.passFlight = { team, carrierId: 'safety', receiverId: 'receiver' };
  updateGrifballTeamPlan(state, structuredClone(s), .2); return state;
}
const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const destinations = { balanced: { x: -4, z: -4 }, enforcer: { x: -3, z: -4 }, opportunist: { x: -4, z: -5.5 }, guardian: { x: -5.5, z: -4 } };
for (const style of styles) {
  test(`${style} selects its bounded cover preference with useful diagnostics`, () => {
    const result = run(scene(style)); assert.deepEqual(result.point, destinations[style]);
    assert.equal(result.individuality!.style, style); assert.equal(result.individuality!.strength, 1);
    assert.equal(result.individuality!.applied, style !== 'balanced');
    assert.deepEqual(result.individuality!.teamPoint, { x: -4, z: -4 });
  });
  test(`${style} at zero strength preserves exact team behavior`, () => {
    const s = scene(style); s.tactics!.defaults.passSupportAgencyStrength = 0;
    assert.deepEqual(run(s), { point: { x: -4, z: -4 } });
    const state = flight(s); s.tactics!.botStyles.cover = 'balanced';
    assert.deepEqual(flight(s).assignments, state.assignments);
  });
  test(`${style} blends position preferences while keeping the receiver and last defender`, () => {
    const s = scene(style); s.tactics!.defaults.passSupportAgencyStrength = .5;
    const expected = { x: (-4 + destinations[style].x) / 2, z: (-4 + destinations[style].z) / 2 };
    assert.deepEqual(run(s).point, expected);
    const state = flight(s), cover = state.assignments.get('cover')!;
    assert.deepEqual(cover.destination, expected); assert.equal(cover.defense!.mode, 'recover');
    assert.equal(state.assignments.get('receiver')!.role, 'retriever');
    assert.equal(state.assignments.get('receiver')!.defense, undefined);
    assert.equal(state.assignments.get('safety')!.defense!.mode, 'last-defender');
    assert.equal(state.assignments.get('safety')!.defense!.passSupport!.individuality, undefined);
    assert.deepEqual(state.assignments.get('safety')!.destination, { x: -7, z: 0 });
  });
}
for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled', 'passingEnabled', 'passSupportEnabled'] as const)
  test(`full individuality cannot bypass ${key}`, () => {
    const s = scene('guardian'); s.tactics!.defaults[key] = false;
    assert.deepEqual(run(s), { point: { x: -4, z: -4 } });
    assert.ok([...flight(s).assignments.values()].every(a => !a.defense?.passSupport?.individuality));
  });
test('unconfigured styles stay balanced and other bots do not choose a cover preference', () => {
  const s = scene('guardian'), base = run(s); s.tactics!.botStyles.receiver = 'enforcer'; s.tactics!.botStyles.safety = 'opportunist';
  assert.deepEqual(run(s), base); delete s.tactics!.botStyles.cover;
  assert.equal(run(s).individuality!.style, 'balanced'); assert.equal(run(s).individuality!.applied, false);
});
test('arrival guard compares collection-time coverage, allowing the wait for settling', () => {
  const s = scene('opportunist'); s.players[2].space!.speed = 1;
  const i = input(s); i.support.settleIn = 0;
  assert.match(chooseGrifballPassSupportPosition(i).individuality!.reason, /0.35 s/);
  i.support.settleIn = 2;
  assert.equal(chooseGrifballPassSupportPosition(i).individuality!.applied, true);
});
test('nearby visible attacks can reject a preference but distant threats do not remove all individuality', () => {
  const s = scene('opportunist'); s.players.push(player('enemy', -4, -8, 'red'));
  const rejected = run(s); assert.equal(rejected.individuality!.applied, false); assert.match(rejected.individuality!.reason, /attack margin/);
  assert.ok(rejected.individuality!.preferredAttackMargin < rejected.individuality!.teamAttackMargin);
  s.players.at(-1)!.pos.z = -22; assert.equal(run(s).individuality!.applied, true);
});
for (const kind of ['airborne', 'lunging', 'blocked'] as const) test(`${kind} movement retains team cover`, () => {
  const s = scene('opportunist');
  if (kind === 'airborne') s.players[2].height = 1;
  if (kind === 'lunging') s.players[2].space!.phase = 'lunging';
  if (kind === 'blocked') s.geometry!.blockers.push({ kind: 'box', x: -4, z: -5.5, hx: .5, hz: .3 });
  const chosen = run(s); assert.equal(chosen.individuality!.applied, false); assert.deepEqual(chosen.point, { x: -4, z: -4 });
  assert.match(chosen.individuality!.reason, kind === 'blocked' ? /blocked/ : /Committed/);
});
test('preferences preserve separation from every reserved teammate position', () => {
  const s = scene('opportunist'), i = input(s); i.reserved.push({ x: -4, z: -6 });
  const chosen = chooseGrifballPassSupportPosition(i);
  assert.equal(chosen.individuality!.applied, false); assert.match(chosen.individuality!.reason, /crowds/);
});
test('depth limits keep aggressive and defensive preferences inside the lab range', () => {
  for (const [style, depth] of [['enforcer', 2], ['guardian', 10]] as const) {
    const s = scene(style), i = input(s); i.tuning.passSupportDepth = depth; i.teamPoint.x = -depth;
    assert.deepEqual(chooseGrifballPassSupportPosition(i).point, i.teamPoint);
  }
});
test('the cover style and mirrored positions survive roster reversal and checkpoints', () => {
  for (const style of styles) for (const mirror of [false, true]) for (const reverse of [false, true]) {
    const s = scene(style);
    if (mirror) for (const p of s.players) { p.team = 'red'; p.pos.x *= -1; p.pos.z *= -1; }
    if (reverse) s.players.reverse();
    const state = flight(s, mirror ? 'red' : 'blue'), cover = state.assignments.get('cover')!;
    assert.ok(Math.abs(cover.destination.x - destinations[style].x * (mirror ? -1 : 1)) < 1e-9);
    assert.ok(Math.abs(cover.destination.z - destinations[style].z * (mirror ? -1 : 1)) < 1e-9);
    const restored = structuredClone(state);
    updateGrifballTeamPlan(state, structuredClone(s), .2); updateGrifballTeamPlan(restored, structuredClone(s), .2);
    assert.deepEqual(restored.assignments, state.assignments);
  }
});
test('multiple covers keep distinct reserved positions and a separate last defender', () => {
  const s = scene('guardian'); s.players.push(player('cover2', -4, 4), player('cover3', -4, -8));
  s.tactics!.botStyles.cover2 = 'enforcer'; s.tactics!.botStyles.cover3 = 'opportunist';
  const state = flight(s), positions = [...state.assignments.values()];
  assert.equal(positions.filter(a => a.defense?.mode === 'last-defender').length, 1);
  assert.equal(positions.filter(a => a.role === 'retriever').length, 1);
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++)
    assert.ok(Math.hypot(positions[i].destination.x - positions[j].destination.x, positions[i].destination.z - positions[j].destination.z) >= 4 - 1e-9);
});
test('disabling the feature or acquiring possession clears its diagnostics on refresh', () => {
  for (const disable of [true, false]) {
    const s = scene('guardian'), state = flight(s); assert.ok(state.assignments.get('cover')!.defense!.passSupport!.individuality);
    if (disable) s.tactics!.defaults.passSupportAgencyStrength = 0;
    else { s.holderId = 'receiver'; s.ballPhysics!.state = 'held'; s.ballPhysics!.holderId = 'receiver'; }
    updateGrifballTeamPlan(state, structuredClone(s), .2);
    assert.ok([...state.assignments.values()].every(a => !a.defense?.passSupport?.individuality));
  }
});
test('team overrides isolate strength while each cover retains its own player style', () => {
  const s = scene('guardian'); s.tactics!.defaults.passSupportAgencyStrength = 0;
  s.tactics!.teams.red = { passSupportAgencyStrength: 1 }; assert.equal(flight(s).assignments.get('cover')!.defense!.passSupport!.individuality, undefined);
  s.tactics!.teams.blue = { passSupportAgencyStrength: .5 };
  const decision = flight(s).assignments.get('cover')!.defense!.passSupport!.individuality!;
  assert.equal(decision.strength, .5); assert.equal(decision.style, 'guardian');
});
test('v1–19 presets migrate with support individuality off and preserve existing settings', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 39); assert.equal(current.defaults.passSupportAgencyStrength, 0);
  for (let version = 1; version <= 19; version++) {
    const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = version; delete old.defaults.passSupportAgencyStrength;
    old.defaults.passSupportEnabled = true; old.defaults.passSupportDepth = 6; old.botStyles.cover = 'guardian';
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.passSupportAgencyStrength, 0); assert.equal(migrated.defaults.passSupportEnabled, true);
    assert.equal(migrated.defaults.passSupportDepth, 6); assert.equal(migrated.botStyles.cover, 'guardian');
  }
  current.teams.red = { passSupportAgencyStrength: .7 }; assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').passSupportAgencyStrength, 0);
  for (const value of [-.1, 1.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passSupportAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current)); delete invalid.defaults.passSupportAgencyStrength;
  assert.throws(() => validateGrifballTactics(invalid));
});
