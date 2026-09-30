import test from 'node:test';
import assert from 'node:assert/strict';
import { observeGrifballSpace } from './aiGrifballSpace';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const player = (id: string, x: number, z = 0, team: 'blue' | 'red' = 'blue', scripted = true): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted });
const snapshot = (players: GrifballTacticalPlayer[], holderId: string | null = null): GrifballTacticalSnapshot => ({
  round: 1, playing: true, ball: { x: 0, z: 0 }, holderId, players,
  goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, spacing: 4,
});
const plan = (input: GrifballTacticalSnapshot) => {
  const state = createGrifballTeamPlanState();
  updateGrifballTeamPlan(state, input, 0.016);
  return state;
};

const recoveryPlayer = (id: string, x: number, mobileIn = 0): GrifballTacticalPlayer => ({
  ...player(id, x), space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer'), mobileIn },
});

test('recovery hands off an airborne incumbent when a grounded teammate can arrive substantially sooner', () => {
  const input = snapshot([recoveryPlayer('a', -1), recoveryPlayer('b', -3)]), state = plan(input);
  assert.equal(state.assignments.get('a')?.role, 'retriever');
  input.players[0].space!.mobileIn = 2;
  updateGrifballTeamPlan(state, input, 0.25);
  assert.equal(state.assignments.get('b')?.role, 'retriever');
  assert.equal([...state.assignments.values()].filter(a => a.role === 'retriever').length, 1);
  updateGrifballTeamPlan(state, input, 0.25);
  assert.equal(state.assignments.get('b')?.role, 'retriever', 'the unavailable incumbent cannot reclaim recovery');
});

test('recovery accounts for approach speed but not weapon attack readiness', () => {
  const input = snapshot([recoveryPlayer('a', -4), recoveryPlayer('b', -6)]);
  input.players[0].space!.speed = 2;
  input.players[1].space!.speed = 8;
  input.players[1].space!.attackIn = 10;
  input.players[1].space!.phase = 'recovering';
  assert.equal(plan(input).assignments.get('b')?.role, 'retriever');
});

test('recovery retains a nearly landed closer bot and chooses a future retriever when everyone is airborne', () => {
  const input = snapshot([recoveryPlayer('a', -1, 0.05), recoveryPlayer('b', -3)]);
  assert.equal(plan(input).assignments.get('a')?.role, 'retriever');
  input.players[0].space!.mobileIn = 2;
  input.players[1].space!.mobileIn = 0.5;
  assert.equal(plan(input).assignments.get('b')?.role, 'retriever');
});

test('recovery availability preserves disabled-space and missing-observation distance fallbacks', () => {
  const input = snapshot([recoveryPlayer('a', -1, 2), recoveryPlayer('b', -3)]);
  input.tactics = defaultGrifballTactics(); input.tactics.defaults.spaceEnabled = false;
  assert.equal(plan(input).assignments.get('a')?.role, 'retriever');
  input.tactics.defaults.spaceEnabled = true;
  input.players.forEach(p => { delete p.space; });
  assert.equal(plan(input).assignments.get('a')?.role, 'retriever');
});

test('each all-bot team has one retriever and distinct support destinations', () => {
  const state = plan(snapshot([
    player('a', -1), player('b', -8, -4), player('c', -10, 4), player('d', -15),
    player('e', 1, 0, 'red'), player('f', 8, 4, 'red'),
  ]));
  for (const team of ['blue', 'red']) {
    const assignments = [...state.assignments.values()].filter(a => a.team === team);
    assert.equal(assignments.filter(a => a.role === 'retriever').length, 1);
    assert.equal(new Set(assignments.map(a => JSON.stringify(a.destination))).size, assignments.length);
  }
  assert.equal(state.assignments.get('a')?.role, 'retriever');
});

test('human carrier receives distinct lead, cover and safety with roster order independence', () => {
  const input = snapshot([player('human', 0, 0, 'blue', false), player('a', 6), player('b', 3, -4), player('c', -7)], 'human');
  const state = plan(input);
  const reordered = plan({ ...input, players: [...input.players].reverse() });
  assert.deepEqual([...state.assignments], [...reordered.assignments]);
  assert.deepEqual([...state.assignments.values()].map(a => a.role).sort(), ['cover', 'lead', 'safety']);
  assert.equal(state.assignments.has('human'), false);
  assert.ok(state.assignments.get('c')!.destination.x < 0);
});

test('small movement retains retriever and slots; a substantially better retriever can take over', () => {
  const input = snapshot([player('a', -3), player('b', -4), player('c', -10)]);
  const state = plan(input);
  input.players[1].pos.x = -2;
  updateGrifballTeamPlan(state, input, 0.25);
  assert.equal(state.assignments.get('a')?.role, 'retriever');
  input.players[0].pos.x = -20;
  updateGrifballTeamPlan(state, input, 0.25);
  assert.equal(state.assignments.get('b')?.role, 'retriever');
  assert.equal([...state.assignments.values()].filter(a => a.role === 'retriever').length, 1);
});

test('death, turnover and round phase invalidate immediately, even within the refresh interval', () => {
  const input = snapshot([player('a', -1), player('b', -4), player('enemy', 6, 0, 'red')]);
  const state = plan(input);
  updateGrifballTeamPlan(state, { ...input, players: input.players.slice(1) }, 0.001);
  assert.equal(state.assignments.has('a'), false);
  assert.equal(state.assignments.get('b')?.role, 'retriever');
  updateGrifballTeamPlan(state, { ...input, holderId: 'enemy' }, 0.001);
  assert.equal(state.assignments.get('enemy')?.role, 'runner');
  assert.equal([...state.assignments.values()].some(a => a.role === 'retriever'), false);
  assert.equal([...state.assignments.values()].filter(a => a.role === 'chaser').length, 1);
  updateGrifballTeamPlan(state, { ...input, round: 2, playing: false }, 0.001);
  assert.equal(state.assignments.size, 0);
});

test('idle humans do not prevent recovery; an actively collecting human gets supporting bots', () => {
  const input = snapshot([player('human', -3, 0, 'blue', false), player('a', -4), player('b', -10)]);
  assert.equal([...plan(input).assignments.values()].filter(a => a.role === 'retriever').length, 1);
  input.players[0].vel.x = 3;
  assert.equal([...plan(input).assignments.values()].filter(a => a.role === 'retriever').length, 0);
  input.players[0].vel.x = -3;
  assert.equal([...plan(input).assignments.values()].filter(a => a.role === 'retriever').length, 1);
  input.players[0].pos.x = -1;
  input.players[0].vel.x = 0;
  assert.equal([...plan(input).assignments.values()].filter(a => a.role === 'retriever').length, 1);
  input.players[0].pickupRequested = true;
  assert.equal([...plan(input).assignments.values()].filter(a => a.role === 'retriever').length, 0);
});

test('distant distractions cannot pull an escort away; local coverage and self threats allow combat', () => {
  const state = plan(snapshot([player('human', 0, 0, 'blue', false), player('escort', 6)], 'human'));
  const assignment = state.assignments.get('escort')!;
  assert.equal(selectGrifballAssignmentThreat(assignment, { x: -20, z: 0 }, [player('distraction', -15, 0, 'red')]), null);
  assert.equal(selectGrifballAssignmentThreat(assignment, { x: 6, z: 0 }, [player('threat', 9, 0, 'red')]), 'threat');
  assert.equal(selectGrifballAssignmentThreat(assignment, { x: -20, z: 0 }, [player('self-threat', -18, 0, 'red')]), 'self-threat');
});

test('new bots fill vacancies without stealing surviving support slots', () => {
  const input = snapshot([player('human', 0, 0, 'blue', false), player('a', 6), player('b', 3, -4)], 'human');
  const state = plan(input);
  const slots = [...state.assignments].map(([id, a]) => [id, a.slot] as const);
  updateGrifballTeamPlan(state, { ...input, players: [...input.players, player('new', 6.5)] }, 0.001);
  for (const [id, slot] of slots) assert.equal(state.assignments.get(id)?.slot, slot);
  assert.equal(state.assignments.get('new')?.role, 'safety');
});

test('large and uneven rosters have unique slots; missing goals and empty teams are safe', () => {
  const input = snapshot([player('human', 0, 0, 'blue', false), ...Array.from({ length: 8 }, (_, i) => player(`b${i}`, -i * 2))], 'human');
  const state = plan(input);
  assert.equal(new Set([...state.assignments.values()].map(a => JSON.stringify(a.destination))).size, 8);
  assert.equal(plan({ ...input, goals: { blue: null, red: null } }).assignments.size, 0);
  assert.equal(plan(snapshot([])).assignments.size, 0);
});

test('mirroring teams and field mirrors assignment destinations', () => {
  const input = snapshot([player('runner', 5), player('escort', 10)], 'runner');
  const normal = plan(input);
  const mirrored = plan({ ...input, players: input.players.map(p => ({ ...p, team: 'red', pos: { x: -p.pos.x, z: -p.pos.z } })) });
  const a = normal.assignments.get('escort')!.destination;
  const b = mirrored.assignments.get('escort')!.destination;
  assert.ok(Math.abs(a.x + b.x) < 0.001 && Math.abs(a.z + b.z) < 0.001);
});
