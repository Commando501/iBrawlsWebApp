import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';
import {
  resetGrifballTeamPlan,
  createGrifballTeamPlanState,
  updateGrifballTeamPlan,
  selectGrifballAssignmentThreat,
  type GrifballTacticalPlayer,
  type GrifballTacticalSnapshot,
} from './aiGrifballTeamPlan';

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
function scene(style: GrifballPlayerStyle = 'balanced'): GrifballTacticalSnapshot {
  const tactics = defaultGrifballTactics();
  Object.assign(tactics.defaults, {
    engagementAgencyStrength: 1,
    stylesEnabled: false,
    passingEnabled: false,
    defenseEnabled: false,
  });
  tactics.botStyles = { a: style, b: style, c: style, runner: 'opportunist' };
  const p = (id: string, x: number, z: number, team = 'blue'): GrifballTacticalPlayer => ({
    id,
    team,
    pos: { x, z },
    vel: { x: 0, z: 0 },
    scripted: true,
    space: {
      ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer', 'ready'),
      ...(id === 'enemy' ? { attackIn: 2 } : {}),
    },
  });
  return {
    round: 1,
    playing: true,
    holderId: 'runner',
    ball: { x: 0, z: 0 },
    spacing: 4,
    tactics,
    geometry: buildGrifballSpaceGeometry(
      { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData,
      52,
    ),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('runner', 0, 0), p('a', 5, -7), p('b', 5, 7), p('c', -10, 0), p('enemy', 5, 0, 'red')],
  };
}
const run = (s: GrifballTacticalSnapshot) => {
  const state = createGrifballTeamPlanState();
  updateGrifballTeamPlan(state, structuredClone(s), 0.2);
  return state;
};

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b);
const advance = (state: ReturnType<typeof run>, s: GrifballTacticalSnapshot, dt: number) =>
  updateGrifballTeamPlan(state, structuredClone(s), dt);
const durations = { balanced: [0.8, 0.6], enforcer: [1.2, 0.45], opportunist: [0.4, 0.75], guardian: [0.6, 0.9] };
for (const style of styles) {
  test(style + ' owns primary timing and changes real rotation at the commitment boundary', () => {
    const s = scene(style),
      state = run(s),
      owner = state.tankingMemory.blue.primaryId!;
    assert.equal(owner, 'b');
    close(state.tankingMemory.blue.commitment, durations[style][0]);
    assert.equal(state.assignments.get(owner)!.tanking!.persistence!.style, style);
    s.players.find((p) => p.id === owner)!.pos.z = 12;
    advance(state, s, 0.5);
    assert.equal(state.tankingMemory.blue.primaryId, style === 'opportunist' ? 'a' : 'b');
    advance(state, s, 0.2);
    assert.equal(state.tankingMemory.blue.primaryId, style === 'opportunist' || style === 'guardian' ? 'a' : 'b');
    advance(state, s, 0.2);
    assert.equal(state.tankingMemory.blue.primaryId, style === 'enforcer' ? 'b' : 'a');
    advance(state, s, 0.4);
    assert.equal(state.tankingMemory.blue.primaryId, 'a');
  });
  test(style + ' waits its own coverage break before re-entering a useful engagement', () => {
    const s = scene(style);
    s.players = s.players.filter((p) => p.id !== 'b');
    s.tactics!.defaults.safetyFirst = true;
    const state = run(s),
      owner = state.tankingMemory.blue.primaryId!;
    assert.equal(owner, 'a');
    s.players.find((p) => p.id === 'enemy')!.pos.x = -30;
    advance(state, s, 0.2);
    assert.equal(state.assignments.get(owner)!.tanking!.mode, 'release');
    close(state.tankingMemory.blue.releaseRemaining[owner], durations[style][1]);
    close(state.assignments.get(owner)!.tanking!.persistence!.releaseRemaining, durations[style][1]);
    s.players.find((p) => p.id === 'enemy')!.pos.x = 5;
    advance(state, s, 0.5);
    assert.equal(state.assignments.get(owner)!.tanking!.attack, style === 'enforcer');
    advance(state, s, 0.2);
    assert.equal(state.assignments.get(owner)!.tanking!.attack, style === 'enforcer' || style === 'balanced');
    advance(state, s, 0.3);
    assert.equal(state.assignments.get(owner)!.tanking!.attack, true);
  });
  test(style + ' zero strength preserves the complete tactical output and memory', () => {
    const s = scene(style);
    s.tactics!.defaults.engagementAgencyStrength = 0;
    const a = run(s);
    s.tactics!.botStyles = {};
    const b = run(s);
    assert.deepEqual(a.assignments, b.assignments);
    assert.deepEqual(a.tankingMemory, b.tankingMemory);
    for (const x of [-30, 5, 5]) {
      s.players.find((p) => p.id === 'enemy')!.pos.x = x;
      advance(a, s, 0.3);
      advance(b, s, 0.3);
      assert.deepEqual(a, b);
    }
  });
  test(style + ' blends strength and respects zero/maximum team durations', () => {
    const s = scene(style);
    s.tactics!.defaults.engagementAgencyStrength = 0.5;
    const d = run(s).assignments.get('b')!.tanking!.persistence!;
    close(d.commitSeconds, (0.8 + durations[style][0]) / 2);
    close(d.releaseSeconds, (0.6 + durations[style][1]) / 2);
    for (const value of [0, 3]) {
      Object.assign(s.tactics!.defaults, { tankCommitSeconds: value, tankReleaseSeconds: value, engagementAgencyStrength: 1 });
      const d = run(s).assignments.get('b')!.tanking!.persistence!;
      assert.ok(d.commitSeconds >= 0 && d.commitSeconds <= 3 && d.releaseSeconds >= 0 && d.releaseSeconds <= 3);
      if (value === 0) {
        assert.equal(d.commitSeconds, 0);
        assert.equal(d.releaseSeconds, 0);
      }
    }
  });
}
test('live style changes and disablement preserve elapsed individualized commitment', () => {
  const s = scene('enforcer'),
    state = run(s);
  advance(state, s, 0.2);
  close(state.tankingMemory.blue.commitment, 1);
  s.tactics!.botStyles.b = 'guardian';
  advance(state, s, 0);
  close(state.tankingMemory.blue.commitment, 0.4);
  s.tactics!.defaults.engagementAgencyStrength = 0;
  advance(state, s, 0);
  close(state.tankingMemory.blue.commitment, 0.6);
  assert.equal(state.tankingMemory.blue.individualDurations, undefined);
  assert.equal(state.assignments.get('b')!.tanking!.persistence, undefined);
});
test('live coverage duration changes preserve elapsed time and expired windows never restart', () => {
  const s = scene('guardian');
  s.players = s.players.filter((p) => p.id !== 'b');
  s.tactics!.defaults.safetyFirst = true;
  const state = run(s);
  s.players.find((p) => p.id === 'enemy')!.pos.x = -30;
  advance(state, s, 0.2);
  advance(state, s, 0.2);
  close(state.tankingMemory.blue.releaseRemaining.a, 0.7);
  s.tactics!.botStyles.a = 'enforcer';
  advance(state, s, 0);
  close(state.tankingMemory.blue.releaseRemaining.a, 0.25);
  s.tactics!.defaults.engagementAgencyStrength = 0;
  advance(state, s, 0);
  close(state.tankingMemory.blue.releaseRemaining.a, 0.4);
  advance(state, s, 0.6);
  assert.equal(state.tankingMemory.blue.releaseRemaining.a, undefined);
  s.tactics!.defaults.engagementAgencyStrength = 1;
  advance(state, s, 0);
  assert.equal(state.tankingMemory.blue.releaseRemaining.a, undefined);
});
test('enabling applies to new windows and does not restart an old commitment', () => {
  const s = scene('enforcer');
  s.tactics!.defaults.engagementAgencyStrength = 0;
  const state = run(s);
  advance(state, s, 0.2);
  s.tactics!.defaults.engagementAgencyStrength = 1;
  advance(state, s, 0);
  close(state.tankingMemory.blue.commitment, 0.6);
  advance(state, s, 1);
  assert.equal(state.tankingMemory.blue.commitment, 0);
  s.tactics!.botStyles.b = 'guardian';
  advance(state, s, 0);
  assert.equal(state.tankingMemory.blue.commitment, 0);
});
for (const gate of ['enabled', 'spaceEnabled', 'tankingEnabled'] as const)
  test('requires ' + gate, () => {
    const s = scene('enforcer'),
      state = run(s);
    s.tactics!.defaults[gate] = false;
    advance(state, s, 0.2);
    assert.equal(state.tankingMemory.blue, undefined);
    assert.ok([...state.assignments.values()].every((a) => !a.tanking?.persistence));
  });
for (const event of ['lost-purpose', 'recovery', 'death', 'observed', 'possession', 'loose', 'round', 'inactive'] as const)
  test('Enforcer respects ' + event, () => {
    const s = scene('enforcer'),
      state = run(s);
    assert.equal(state.tankingMemory.blue.primaryId, 'b');
    if (event === 'lost-purpose') s.players.find((p) => p.id === 'enemy')!.pos.x = -30;
    if (event === 'recovery') Object.assign(s.players.find((p) => p.id === 'b')!.space!, { phase: 'recovering', attackIn: 4 });
    if (event === 'death') s.players = s.players.filter((p) => p.id !== 'b');
    s.tactics!.defaults.safetyFirst = true;
    if (event === 'observed') s.players.find((p) => p.id === 'b')!.scripted = false;
    if (event === 'possession') s.holderId = 'enemy';
    if (event === 'loose') s.holderId = null;
    if (event === 'round') s.round++;
    if (event === 'inactive') s.playing = false;
    advance(state, s, 0.2);
    if (['lost-purpose', 'recovery', 'death', 'observed'].includes(event))
      assert.notEqual(state.tankingMemory.blue.primaryId, 'b');
    if (['possession', 'loose', 'inactive'].includes(event))
      assert.ok([...state.assignments.values()].filter((a) => a.team === 'blue').every((a) => !a.tanking?.persistence));
    if (event === 'round') close(state.tankingMemory.blue.commitment, 1.2);
    if (event === 'death' || event === 'observed') assert.equal(state.assignments.has('b'), false);
    resetGrifballTeamPlan(state);
    assert.deepEqual(state.tankingMemory, {});
  });
test('coverage breaks retain immediate self-defense', () => {
  const s = scene('guardian');
  s.players = s.players.filter((p) => p.id !== 'b');
  s.tactics!.defaults.safetyFirst = true;
  const state = run(s);
  s.players.find((p) => p.id === 'enemy')!.pos.x = -30;
  advance(state, s, 0.2);
  const a = state.assignments.get('a')!,
    bot = s.players.find((p) => p.id === 'a')!,
    enemy = s.players.find((p) => p.id === 'enemy')!;
  enemy.pos = { x: bot.pos.x + 1, z: bot.pos.z };
  enemy.space!.attackIn = 0;
  assert.equal(a.tanking!.attack, false);
  assert.equal(selectGrifballAssignmentThreat(a, bot.pos, s.players), 'enemy');
});
test('scope, own bot identity, mirrored teams, main_ai, roster ordering and restored continuation', () => {
  for (const style of styles)
    for (const mirror of [false, true])
      for (const reverse of [false, true])
        for (const main of [false, true]) {
          const s = scene(style),
            team = mirror ? 'red' : 'blue',
            id = main ? 'main_ai' : 'b';
          s.players[2].id = id;
          s.tactics!.botStyles = { [id]: style, a: 'balanced', runner: 'guardian' };
          if (mirror)
            for (const p of s.players) {
              p.team = p.team === 'blue' ? 'red' : 'blue';
              p.pos.x *= -1;
              p.pos.z *= -1;
            }
          if (reverse) s.players.reverse();
          s.tactics!.teams[team] = { engagementAgencyStrength: 0.5 };
          const state = run(s),
            owner = state.assignments.get(id)!;
          assert.equal(state.tankingMemory[team].primaryId, id);
          assert.equal(owner.tanking!.persistence!.style, style);
          close(state.tankingMemory[team].commitment, (0.8 + durations[style][0]) / 2);
          const restored = structuredClone(state);
          advance(state, s, 0.2);
          advance(restored, s, 0.2);
          assert.deepEqual(state, restored);
        }
});
test('v1–22 imports preserve older settings and migrate persistence off; current imports require valid strength', () => {
  const current = defaultGrifballTactics();
  assert.equal(current.schemaVersion, 45);
  assert.equal(current.defaults.engagementAgencyStrength, 0);
  for (let version = 1; version <= 22; version++) {
    const old = JSON.parse(JSON.stringify(current));
    old.schemaVersion = version;
    delete old.defaults.engagementAgencyStrength;
    old.defaults.doubleTeamAgencyStrength = 0.8;
    old.botStyles.a = 'guardian';
    const migrated = validateGrifballTactics(old);
    assert.equal(migrated.defaults.engagementAgencyStrength, 0);
    assert.equal(migrated.defaults.doubleTeamAgencyStrength, 0.8);
    assert.equal(migrated.botStyles.a, 'guardian');
  }
  current.teams.red = { engagementAgencyStrength: 0.7 };
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(current))), current);
  assert.equal(resolveTeamTactics(current, 'blue').engagementAgencyStrength, 0);
  for (const value of [-0.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...current, teams: { red: { engagementAgencyStrength: value } } }));
  const invalid = JSON.parse(JSON.stringify(current));
  delete invalid.defaults.engagementAgencyStrength;
  assert.throws(() => validateGrifballTactics(invalid));
});
