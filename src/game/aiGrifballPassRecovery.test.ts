import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { chooseGrifballPassRecovery } from './aiGrifballPassRecovery';
import { createSnapshotRouters } from './aiGrifballRunner';
import { predictBallRecovery } from './aiGrifballPassing';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { createInitialBall, throwBall } from './grifballBall';
import { deflectBallWithHammer } from './hammerBallDeflection';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

const player = (id: string, x: number, team = 'blue'): GrifballTacticalPlayer => ({ id, team, pos: { x, z: 0 }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5, mobileIn: 0, reach: 3, blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0 } });
function scene(): GrifballTacticalSnapshot {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, { passRecoveryEnabled: true, stylesEnabled: false, tankingEnabled: false });
  const ball = createInitialBall({ x: 0, y: .35, z: 0 }); ball.state = 'loose';
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, ballPhysics: ball, holderId: null, spacing: 4, tactics,
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [player('original', 20), player('backup', 0), player('enemy', -30, 'red')] };
}
const run = (s: GrifballTacticalSnapshot, receiverId = 'original', team = 'blue') => chooseGrifballPassRecovery({ snapshot: s, team, receiverId,
  tuning: resolveTeamTactics(s.tactics!, team), routers: createSnapshotRouters(s),
  recovery: s.ballPhysics?.state === 'thrown' ? predictBallRecovery(s.ballPhysics, s.passing!.bounds) : undefined });
function flight(s: GrifballTacticalSnapshot) {
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, structuredClone(s), .2);
  state.passFlight = { team: 'blue', carrierId: 'thrower', receiverId: 'original' };
  updateGrifballTeamPlan(state, structuredClone(s), .2); return state;
}
const retrievers = (state: ReturnType<typeof flight>) => [...state.assignments.values()].filter(a => a.team === 'blue' && a.role === 'retriever');

test('hands recovery to the earliest scripted teammate, with useful arrival diagnostics', () => {
  const s = scene(), result = run(s)!;
  assert.equal(result.action, 'handoff'); assert.equal(result.receiverId, 'backup');
  assert.equal(result.previousReceiverId, 'original'); assert.equal(result.requiredAdvantage, .5);
  assert.ok(result.candidates.find(c => c.id === 'original')!.pickupETA > 3);
  assert.deepEqual(result.candidates.map(c => c.id), ['backup', 'original']);
});
for (const key of ['passRecoveryEnabled', 'enabled', 'spaceEnabled', 'passingEnabled'] as const) test(`recovery respects ${key}`, () => {
  const s = scene(); s.tactics!.defaults[key] = false; assert.equal(run(s), null);
});
test('preserves a timely receiver even when a teammate arrives first, because flight must finish', () => {
  const s = scene(); s.players[0].pos.x = 3;
  throwBall(s.ballPhysics!, { x: 0, y: 1.1, z: 0 }, { x: 1, y: 0, z: 0 }, 9);
  const recovery = predictBallRecovery(s.ballPhysics!, s.passing!.bounds);
  s.players[0].pos.x = recovery.point.x + 1; s.players[1].pos.x = recovery.point.x;
  const decision = run(s)!;
  assert.equal(decision.action, 'retain'); assert.equal(decision.receiverId, 'original');
  assert.equal(decision.candidates[0].pickupETA, decision.candidates[1].pickupETA);
  assert.ok(decision.settleIn > 0);
});
test('handoff uses a strict configurable collection advantage and accounts for mobility delay', () => {
  const s = scene(); s.players[0].pos.x = 3.46; // (3.46 - .96) / 5 = .5 seconds
  assert.equal(run(s)!.action, 'retain'); s.players[0].pos.x += .1;
  assert.equal(run(s)!.action, 'handoff');
  s.players[1].space!.mobileIn = 1; assert.equal(run(s)!.action, 'retain');
  s.players[0].space!.mobileIn = 2; assert.equal(run(s)!.action, 'handoff');
});
for (const kind of ['dead', 'observed', 'airborne', 'lunging', 'blocked'] as const) test(`replaces an unavailable ${kind} receiver`, () => {
  const s = scene(); s.players[0].pos.x = 0;
  if (kind === 'dead') s.players.shift();
  if (kind === 'observed') s.players[0].scripted = false;
  if (kind === 'airborne') s.players[0].height = 1;
  if (kind === 'lunging') s.players[0].space!.phase = 'lunging';
  if (kind === 'blocked') {
    s.players[0].pos.x = 20;
    s.geometry!.blockers.push({ kind: 'box', x: 10, z: 0, hx: 1, hz: 30 });
  }
  const result = run(s)!; assert.equal(result.receiverId, 'backup'); assert.match(result.reason, /unavailable/);
});
test('does not award the reservation to humans/neural actors, enemies, or unavailable candidates', () => {
  const s = scene(); s.players[1].scripted = false; s.players[2].pos.x = 0;
  assert.equal(run(s)!.receiverId, 'original');
  s.players[0].height = 2; assert.equal(run(s)!.receiverId, null); assert.equal(run(s)!.action, 'unavailable');
});
test('both teams and roster orders produce the same physical handoff', () => {
  const base = run(scene());
  for (const mirror of [false, true]) for (const reverse of [false, true]) {
    const s = scene(); if (reverse) s.players.reverse();
    if (mirror) for (const p of s.players) p.pos.x *= -1;
    assert.equal(run(s)!.receiverId, base!.receiverId);
  }
});
test('unknown trajectories, missing geometry, possessed and idle balls do not change a reservation', () => {
  const s = scene(); s.ballPhysics!.state = 'idle'; assert.equal(run(s), null);
  s.ballPhysics!.state = 'held'; s.holderId = 'original'; assert.equal(run(s), null);
  s.ballPhysics!.state = 'thrown'; s.holderId = null;
  const input = { snapshot: s, team: 'blue', receiverId: 'original', tuning: s.tactics!.defaults, routers: createSnapshotRouters(s), recovery: undefined };
  assert.equal(chooseGrifballPassRecovery(input), null);
  s.ballPhysics!.state = 'loose'; s.geometry = undefined;
  assert.equal(chooseGrifballPassRecovery(input), null);
});
test('real hammer redirection changes the recovery target and releases a stale receiver reservation', () => {
  const s = scene(); throwBall(s.ballPhysics!, { x: 0, y: 1.1, z: 0 }, { x: 1, y: 0, z: 0 }, 18);
  const before = predictBallRecovery(s.ballPhysics!, s.passing!.bounds);
  s.players[0].pos = { ...before.point }; s.players[1].pos = { x: -15, z: 0 };
  const state = flight(s); assert.equal(state.passFlight!.receiverId, 'original');
  assert.ok(deflectBallWithHammer(s.ballPhysics!, { x: 1, y: 1.1, z: 0 }, s.ballPhysics!.pos, 2,
    { hammerBallDeflectionEnabled: true, hammerBallDeflectionStrength: 1 }));
  const after = predictBallRecovery(s.ballPhysics!, s.passing!.bounds);
  assert.ok(after.point.x < 0 && before.point.x > 0);
  s.ball = { ...s.ballPhysics!.pos }; updateGrifballTeamPlan(state, s, .2);
  assert.equal(state.passFlight!.receiverId, 'backup');
  assert.equal(retrievers(state).length, 1); assert.deepEqual(retrievers(state)[0].receive!.point, after.point);
  assert.equal(state.assignments.get('original')!.passRecovery!.action, 'handoff');
  assert.notEqual(state.assignments.get('original')!.role, 'retriever');
});
test('handoff retains the replacement, survives a checkpoint, and does not reclaim on small reversals', () => {
  const s = scene(), state = flight(s);
  assert.equal(state.passFlight!.receiverId, 'backup'); assert.equal(retrievers(state)[0].botId, 'backup');
  s.players[0].pos.x = 0; s.players[1].pos.x = 2;
  const restored = structuredClone(state);
  for (const p of [state, restored]) {
    updateGrifballTeamPlan(p, s, .2); assert.equal(p.passFlight!.receiverId, 'backup');
    assert.equal(retrievers(p)[0].passRecovery!.action, 'retain');
  }
  assert.deepEqual(restored.assignments, state.assignments);
});
test('feature off preserves the original reservation and team overrides stay independent', () => {
  const s = scene(); s.tactics!.defaults.passRecoveryEnabled = false;
  assert.equal(flight(s).passFlight!.receiverId, 'original');
  assert.equal(retrievers(flight(s))[0].botId, 'original');
  s.tactics!.teams.red = { passRecoveryEnabled: true }; assert.equal(flight(s).passFlight!.receiverId, 'original');
  s.tactics!.teams.blue = { passRecoveryEnabled: true }; assert.equal(flight(s).passFlight!.receiverId, 'backup');
});
test('ordinary loose balls and enemy passes do not acquire a friendly pass reservation', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, .2);
  assert.ok([...state.assignments.values()].every(a => !a.passRecovery));
  state.passFlight = { team: 'red', receiverId: 'enemy', carrierId: 'other' }; updateGrifballTeamPlan(state, s, .2);
  assert.ok([...state.assignments.values()].filter(a => a.team === 'blue').every(a => !a.passRecovery));
});
test('observed human pickup yields without changing the receiver reservation', () => {
  const s = scene(); s.players.push({ ...player('human', 0), scripted: false, pickupRequested: true });
  const state = flight(s); assert.equal(state.passFlight!.receiverId, 'original'); assert.equal(retrievers(state).length, 0);
  assert.ok([...state.assignments.values()].every(a => !a.passRecovery));
});
test('possession, round changes, idle reset, and explicit reset clear recovery diagnostics', () => {
  for (const mode of ['possession', 'round', 'idle', 'reset'] as const) {
    const s = scene(), state = flight(s);
    if (mode === 'possession') { s.holderId = 'backup'; s.ballPhysics!.holderId = 'backup'; s.ballPhysics!.state = 'held'; }
    if (mode === 'round') s.round++;
    if (mode === 'idle') s.ballPhysics!.state = 'idle';
    if (mode === 'reset') resetGrifballTeamPlan(state); else updateGrifballTeamPlan(state, s, .2);
    assert.equal(state.passFlight, null); assert.ok([...state.assignments.values()].every(a => !a.passRecovery));
  }
});
test('v1–16 presets migrate with adaptive recovery off; v17 validates controls and scoped overrides', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 34);
  assert.equal(current.defaults.passRecoveryEnabled, false); assert.equal(current.defaults.passRecoveryAdvantage, .5);
  for (let version = 1; version <= 16; version++) {
    const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = version;
    delete old.defaults.passRecoveryEnabled; delete old.defaults.passRecoveryAdvantage;
    old.defaults.hammerDefenseEnabled = true; old.botStyles.original = 'guardian';
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.passRecoveryEnabled, false); assert.equal(migrated.defaults.passRecoveryAdvantage, .5);
    assert.equal(migrated.defaults.hammerDefenseEnabled, true); assert.equal(migrated.botStyles.original, 'guardian');
  }
  current.teams.red = { passRecoveryEnabled: true, passRecoveryAdvantage: 1.2 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').passRecoveryEnabled, false);
  for (const value of [-.1, 3.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passRecoveryAdvantage: value } } }));
  assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passRecoveryEnabled: 1 } } }));
  const invalid = JSON.parse(JSON.stringify(current)); delete invalid.defaults.passRecoveryEnabled;
  assert.throws(() => validateGrifballTactics(invalid));
});

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
const margins = { balanced: .5, enforcer: .75, opportunist: .35, guardian: .25 };
for (const style of styles) {
  test(`${style} at zero recovery strength preserves the exact team decision`, () => {
    const s = scene(), baseline = run(s); s.tactics!.botStyles.original = style;
    assert.deepEqual(run(s), baseline);
  });
  test(`${style} changes marginal handoffs without changing physical candidate estimates`, () => {
    for (const advantage of [.3, .4, .6]) {
      const s = scene(); s.players[0].pos.x = .96 + advantage * 5;
      const base = run(s)!;
      s.tactics!.defaults.passRecoveryAgencyStrength = 1; s.tactics!.botStyles.original = style;
      const chosen = run(s)!;
      assert.equal(chosen.requiredAdvantage, margins[style]);
      assert.equal(chosen.action, advantage > margins[style] ? 'handoff' : 'retain');
      assert.deepEqual(chosen.candidates, base.candidates);
      assert.equal(chosen.individuality!.style, style); assert.equal(chosen.individuality!.teamAdvantage, .5);
      assert.equal(chosen.individuality!.strength, 1);
    }
  });
  test(`${style} blends its recovery preference and clamps the effective margin`, () => {
    const s = scene(); s.tactics!.botStyles.original = style; s.tactics!.defaults.passRecoveryAgencyStrength = .5;
    assert.ok(Math.abs(run(s)!.requiredAdvantage - (.5 + (margins[style] - .5) / 2)) < 1e-9);
    s.tactics!.defaults.passRecoveryAgencyStrength = 1;
    for (const base of [0, 3]) {
      s.tactics!.defaults.passRecoveryAdvantage = base;
      assert.equal(run(s)!.requiredAdvantage, Math.max(0, Math.min(3, base + margins[style] - .5)));
    }
  });
  test(`${style} never keeps an unavailable receiver or assigns an observed player`, () => {
    for (const kind of ['dead', 'observed', 'airborne', 'lunging', 'blocked'] as const) {
      const s = scene(); s.tactics!.defaults.passRecoveryAgencyStrength = 1;
      s.tactics!.defaults.passRecoveryAdvantage = 3; s.tactics!.botStyles.original = style;
      if (kind === 'dead') s.players.shift();
      if (kind === 'observed') s.players[0].scripted = false;
      if (kind === 'airborne') s.players[0].height = 2;
      if (kind === 'lunging') s.players[0].space!.phase = 'lunging';
      if (kind === 'blocked') s.geometry!.blockers.push({ kind: 'box', x: 10, z: 0, hx: 1, hz: 30 });
      assert.equal(run(s)!.receiverId, 'backup');
      assert.match(run(s)!.reason, /unavailable/);
    }
  });
}
for (const key of ['enabled', 'spaceEnabled', 'passingEnabled', 'passRecoveryEnabled'] as const)
  test(`full recovery individuality cannot bypass ${key}`, () => {
    const s = scene(); s.tactics!.defaults.passRecoveryAgencyStrength = 1; s.tactics!.botStyles.original = 'enforcer';
    s.tactics!.defaults[key] = false; assert.equal(run(s), null);
  });
test('styles follow the receiver ID across team mirrors and roster order, independent of other individuality strengths', () => {
  for (const mirror of [false, true]) for (const reverse of [false, true]) {
    const s = scene(); s.tactics!.defaults.passRecoveryAgencyStrength = 1;
    s.tactics!.botStyles = { original: 'guardian', backup: 'enforcer', thrower: 'enforcer' };
    const team = mirror ? 'red' : 'blue';
    if (mirror) for (const p of s.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; }
    if (reverse) s.players.reverse();
    const result = run(s, 'original', team)!;
    assert.equal(result.individuality!.style, 'guardian'); assert.equal(result.requiredAdvantage, .25);
    // This slice works with every other individuality strength and team styles off.
    assert.equal(s.tactics!.defaults.stylesEnabled, false);
    assert.equal(s.tactics!.defaults.passAgencyStrength, 0); assert.equal(s.tactics!.defaults.agencyStrength, 0);
    s.tactics!.teams[team] = { passRecoveryAgencyStrength: 0 };
    assert.equal(run(s, 'original', team)!.individuality, undefined);
    assert.equal(run(s, 'original', team)!.requiredAdvantage, .5);
  }
});
test('an unconfigured receiver stays balanced and challenger styles do not choose the handoff margin', () => {
  const s = scene(); s.tactics!.defaults.passRecoveryAgencyStrength = 1;
  s.tactics!.botStyles = { backup: 'guardian', thrower: 'enforcer' };
  assert.equal(run(s)!.individuality!.style, 'balanced'); assert.equal(run(s)!.requiredAdvantage, .5);
});
test('after handoff the replacement owns its style, and edits apply at the next tactical refresh', () => {
  const s = scene(); s.tactics!.defaults.passRecoveryAgencyStrength = 1;
  s.tactics!.botStyles = { original: 'guardian', backup: 'enforcer' };
  const state = flight(s); assert.equal(state.passFlight!.receiverId, 'backup');
  assert.equal(retrievers(state)[0].passRecovery!.individuality!.style, 'guardian');
  s.players[0].pos.x = 0; s.players[1].pos.x = 2.96; // Original could collect .4 s sooner.
  const checkpoint = structuredClone(state);
  for (const plan of [state, checkpoint]) {
    updateGrifballTeamPlan(plan, structuredClone(s), .2);
    assert.equal(plan.passFlight!.receiverId, 'backup');
    assert.equal(retrievers(plan)[0].passRecovery!.individuality!.style, 'enforcer');
    assert.equal(retrievers(plan)[0].passRecovery!.requiredAdvantage, .75);
  }
  assert.deepEqual(checkpoint.assignments, state.assignments);
  s.tactics!.botStyles.backup = 'guardian';
  updateGrifballTeamPlan(state, structuredClone(s), .01);
  assert.equal(state.passFlight!.receiverId, 'original');
  assert.equal(retrievers(state)[0].passRecovery!.requiredAdvantage, .25);
});
test('v1–17 migration leaves recovery individuality off and retains existing recovery controls', () => {
  for (let version = 1; version <= 17; version++) {
    const old = JSON.parse(JSON.stringify(defaultGrifballTactics())); old.schemaVersion = version;
    delete old.defaults.passRecoveryAgencyStrength;
    old.defaults.passRecoveryEnabled = true; old.defaults.passRecoveryAdvantage = 1.2;
    old.botStyles.original = 'enforcer'; old.teams.red = { passRecoveryAdvantage: .8 };
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.schemaVersion, 34); assert.equal(migrated.defaults.passRecoveryAgencyStrength, 0);
    assert.equal(migrated.defaults.passRecoveryEnabled, true); assert.equal(migrated.defaults.passRecoveryAdvantage, 1.2);
    assert.equal(migrated.botStyles.original, 'enforcer'); assert.deepEqual(migrated.teams.red, { passRecoveryAdvantage: .8 });
  }
  const current = defaultGrifballTactics(); current.defaults.passRecoveryAgencyStrength = .8;
  current.teams.red = { passRecoveryAgencyStrength: .4 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'red').passRecoveryAgencyStrength, .4);
  assert.equal(resolveTeamTactics(current, 'blue').passRecoveryAgencyStrength, .8);
  for (const value of [-.1, 1.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { passRecoveryAgencyStrength: value } } }));
  const incomplete = JSON.parse(JSON.stringify(current)); delete incomplete.defaults.passRecoveryAgencyStrength;
  assert.throws(() => validateGrifballTactics(incomplete));
});
