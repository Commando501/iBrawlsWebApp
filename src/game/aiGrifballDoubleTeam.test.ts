import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace, estimateSpaceAttackTime } from './aiGrifballSpace';
import { buildGrifballSpaceGeometry, fieldDistance } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
function scene(style: GrifballPlayerStyle = 'balanced'): GrifballTacticalSnapshot {
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, { doubleTeamAgencyStrength: 1, stylesEnabled: false, passingEnabled: false, defenseEnabled: false });
  tactics.botStyles = { a: style, b: style, c: style, runner: 'opportunist' };
  const p = (id: string, x: number, z: number, team = 'blue'): GrifballTacticalPlayer => ({ id, team,
    pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
    space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer', id === 'enemy' ? 'recovering' : 'ready'),
      ...(id === 'enemy' ? { attackIn: 2 } : {}) } });
  return { round: 1, playing: true, holderId: 'runner', ball: { x: 0, z: 0 }, spacing: 4, tactics,
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('runner', 0, 0), p('a', 5, -7), p('b', 5, 7), p('c', -10, 0), p('enemy', 5, 0, 'red')] };
}
const run = (s: GrifballTacticalSnapshot) => { const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, structuredClone(s), .2); return state; };
const secondary = (state: ReturnType<typeof run>) => [...state.assignments.values()].find(a => a.tanking?.mode === 'punish')!;
const enemy = (s: GrifballTacticalSnapshot) => s.players.find(p => p.id === 'enemy')!;

for (const style of styles) {
  test(`${style} owns the supporting tank's threshold and leaves primary and recovery jobs intact`, () => {
    const s = scene(style), state = run(s), a = secondary(state), d = a.tanking!.doubleTeam!;
    assert.ok(d); assert.equal(d.style, style); assert.equal(d.strength, 1);
    assert.equal(d.threshold, s.tactics!.defaults.tankDoubleThreshold + (style === 'enforcer' ? -.75 : style === 'guardian' ? .75 : 0));
    assert.equal(d.recoveryMargin, style === 'opportunist' ? .25 : style === 'guardian' ? .2 : .1);
    assert.equal(state.assignments.get(a.tanking!.partnerId!)!.tanking!.mode, 'engage');
    assert.equal(state.assignments.get(a.tanking!.partnerId!)!.tanking!.doubleTeam, undefined);
    assert.equal(state.assignments.get(a.tanking!.recoveryId!)!.tanking!.attack, false);
    assert.equal(state.assignments.get('runner')!.tanking, undefined);
  });
  test(`${style} has an exact zero-strength fallback and blends intermediate strengths`, () => {
    const s = scene(style); s.tactics!.defaults.doubleTeamAgencyStrength = 0;
    const before = run(s); s.tactics!.botStyles = {}; const after = run(s);
    assert.deepEqual(after.assignments, before.assignments); assert.deepEqual(after.tankingMemory, before.tankingMemory);
    assert.deepEqual(after.runnerPlans, before.runnerPlans);
    s.tactics!.botStyles = { a: style, b: style }; s.tactics!.defaults.doubleTeamAgencyStrength = .5;
    const d = secondary(run(s)).tanking!.doubleTeam!;
    assert.equal(d.threshold, 4.5 + (style === 'enforcer' ? -.375 : style === 'guardian' ? .375 : 0));
    assert.equal(d.recoveryMargin, .1 + (style === 'opportunist' ? .075 : style === 'guardian' ? .05 : 0));
  });
  test(`${style} changes actual join/cover behavior at a value boundary`, () => {
    const s = scene(style), initial = secondary(run(s)), score = initial.tanking!.doubleTeam!.score;
    s.tactics!.defaults.tankDoubleThreshold = score + .5;
    const a = secondary(run(s)); assert.equal(a.tanking!.attack, style === 'enforcer');
    assert.equal(a.tanking!.doubleCommit, style === 'enforcer');
    const partner = run(s).assignments.get(a.tanking!.partnerId!)!; assert.equal(partner.tanking!.attack, true);
  });
  test(`${style} changes actual join/cover behavior at a recovery boundary`, () => {
    const s = scene(style), initial = secondary(run(s)); s.tactics!.defaults.tankDoubleThreshold = 0;
    enemy(s).space!.attackIn = initial.tanking!.doubleTeam!.attackETA + .18;
    const a = secondary(run(s)); assert.equal(a.tanking!.attack, style === 'balanced' || style === 'enforcer');
  });
}

test('a secondary uses its own style, independently of the primary, runner and other strengths', () => {
  const s = scene(), a = secondary(run(s));
  s.tactics!.botStyles = { [a.botId]: 'enforcer', [a.tanking!.partnerId!]: 'guardian', runner: 'opportunist' };
  const d = secondary(run(s)).tanking!.doubleTeam!; assert.equal(d.style, 'enforcer');
  assert.equal(d.threshold, 3.75); assert.equal(d.recoveryMargin, .1);
  assert.equal(s.tactics!.defaults.agencyStrength, 0); assert.equal(s.tactics!.defaults.escortAgencyStrength, 0);
  delete s.tactics!.botStyles[a.botId]; assert.equal(secondary(run(s)).tanking!.doubleTeam!.style, 'balanced');
});

for (const gate of ['enabled', 'spaceEnabled', 'tankingEnabled'] as const) test(`double-team individuality requires ${gate}`, () => {
  const s = scene('enforcer'); s.tactics!.defaults[gate] = false;
  assert.ok([...run(s).assignments.values()].every(a => !a.tanking?.doubleTeam));
});
for (const guard of ['ready', 'short-window', 'shared-blast', 'late-cover', 'blocked-primary', 'blocked-secondary', 'no-reserve'] as const)
  test(`Enforcer cannot bypass ${guard}`, () => {
    const s = scene('enforcer'); s.tactics!.defaults.tankDoubleThreshold = 0;
    const before = run(s), a = secondary(before); assert.ok(a.tanking!.attack);
    if (guard === 'ready') enemy(s).space!.phase = 'ready';
    if (guard === 'short-window') enemy(s).space!.attackIn = a.tanking!.doubleTeam!.attackETA + .09;
    if (guard === 'shared-blast') Object.assign(enemy(s).space!, { blastRadius: 12, attackIn: 1.2 });
    if (guard === 'late-cover') s.players.find(p => p.id === a.tanking!.recoveryId)!.pos.x = -40;
    if (guard === 'no-reserve') s.players = s.players.filter(p => p.id !== a.tanking!.recoveryId);
    if (guard.startsWith('blocked-')) {
      const point = before.assignments.get(guard === 'blocked-primary' ? a.tanking!.partnerId! : a.botId)!.destination;
      s.geometry!.blockers.push({ kind: 'box', ...point, hx: .1, hz: .1 });
    }
    assert.ok([...run(s).assignments.values()].every(a => !a.tanking?.doubleCommit));
  });

test('cached punish selection rechecks the personal recovery cushion and retains immediate self-defense', () => {
  const s = scene('guardian'); s.tactics!.defaults.tankDoubleThreshold = 0;
  const a = secondary(run(s)), bot = s.players.find(p => p.id === a.botId)!, target = enemy(s);
  assert.equal(a.tanking!.attack, true); bot.pos.z *= .75;
  const eta = estimateSpaceAttackTime(bot, target.pos, fieldDistance(bot.pos, target.pos));
  target.space!.attackIn = eta + .21;
  assert.equal(selectGrifballAssignmentThreat(a, bot.pos, s.players), 'enemy');
  target.space!.attackIn = eta + .15;
  assert.equal(selectGrifballAssignmentThreat(a, bot.pos, s.players), null);
  const balanced = structuredClone(a); delete balanced.tanking!.doubleTeam;
  assert.equal(selectGrifballAssignmentThreat(balanced, bot.pos, s.players), 'enemy');
  target.pos = { x: bot.pos.x + 1, z: bot.pos.z };
  assert.equal(selectGrifballAssignmentThreat(a, bot.pos, s.players), 'enemy');
});

test('threshold extremes remain bounded without weakening the recovery cushion', () => {
  for (const [style, threshold, expected] of [['enforcer', 0, 0], ['guardian', 15, 15]] as const) {
    const s = scene(style); s.tactics!.defaults.tankDoubleThreshold = threshold;
    const d = secondary(run(s)).tanking!.doubleTeam!; assert.equal(d.threshold, expected); assert.ok(d.recoveryMargin >= .1);
  }
});

test('team scopes, mirrored fields, roster ordering and restored continuation keep the supporting bot identity', () => {
  for (const style of styles) for (const mirror of [false, true]) for (const reverse of [false, true]) for (const main of [false, true]) {
    const s = scene(style), team = mirror ? 'red' : 'blue';
    if (main) { s.players[2].id = 'main_ai'; s.tactics!.botStyles.main_ai = style; }
    if (mirror) for (const p of s.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.pos.z *= -1; }
    if (reverse) s.players.reverse();
    s.tactics!.teams[team] = { doubleTeamAgencyStrength: .5 };
    const state = run(s), a = secondary(state); assert.equal(a.team, team); assert.equal(a.tanking!.doubleTeam!.strength, .5);
    const restored = structuredClone(state); s.tactics!.botStyles[a.botId] = 'guardian';
    for (const plan of [state, restored]) updateGrifballTeamPlan(plan, structuredClone(s), .2);
    assert.deepEqual(state, restored); assert.equal(secondary(state).tanking!.doubleTeam!.style, 'guardian');
  }
});

test('possession changes, loss of partner, disabled strength and inactive play clear preference diagnostics', () => {
  for (const change of ['opponent', 'loose', 'inactive', 'death', 'strength'] as const) {
    const s = scene('enforcer'), state = run(s); assert.ok(secondary(state).tanking!.doubleTeam);
    if (change === 'opponent') s.holderId = 'enemy';
    if (change === 'loose') s.holderId = null;
    if (change === 'inactive') s.playing = false;
    if (change === 'death') s.players = s.players.filter(p => p.id !== secondary(state).botId);
    if (change === 'strength') s.tactics!.defaults.doubleTeamAgencyStrength = 0;
    updateGrifballTeamPlan(state, s, .2);
    assert.ok([...state.assignments.values()].filter(a => a.team === 'blue').every(a => !a.tanking?.doubleTeam));
  }
});

test('human/neural carriers are observed while their own orders remain unassigned', () => {
  const s = scene('enforcer'); s.players[0].scripted = false; s.players[0].vel.x = 5;
  const state = run(s); assert.equal(state.assignments.has('runner'), false); assert.ok(secondary(state).tanking!.doubleTeam);
  const id = secondary(state).botId; s.players.find(p => p.id === id)!.scripted = false;
  assert.equal(run(s).assignments.has(id), false);
});

test('v1–21 presets migrate double-team individuality off without resetting older strengths', () => {
  const current = defaultGrifballTactics(); assert.equal(current.schemaVersion, 39); assert.equal(current.defaults.doubleTeamAgencyStrength, 0);
  for (let version = 1; version <= 21; version++) {
    const old = JSON.parse(JSON.stringify(current)); old.schemaVersion = version; delete old.defaults.doubleTeamAgencyStrength;
    old.defaults.escortAgencyStrength = .8; old.botStyles.a = 'enforcer';
    const migrated = validateGrifballTactics(old); assert.equal(migrated.defaults.doubleTeamAgencyStrength, 0);
    assert.equal(migrated.defaults.escortAgencyStrength, .8); assert.equal(migrated.botStyles.a, 'enforcer');
  }
  current.teams.red = { doubleTeamAgencyStrength: .7 }; assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').doubleTeamAgencyStrength, 0);
  for (const value of [-.1, 1.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { doubleTeamAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current)); delete invalid.defaults.doubleTeamAgencyStrength; assert.throws(() => validateGrifballTactics(invalid));
});
