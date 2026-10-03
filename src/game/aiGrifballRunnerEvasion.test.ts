import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGrifballRunnerEvasion } from './aiGrifballRunnerEvasion';
import { observeGrifballSpace } from './aiGrifballSpace';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import type { GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { RunnerCandidate } from './aiGrifballRunner';

function fixture(sign = 1) {
  const point = (x: number, z: number) => ({ x: x * sign, z: z * sign });
  const carrier: GrifballTacticalPlayer = { id: 'carrier', team: 'blue', pos: point(0, 0), vel: point(7.54, 0), scripted: true,
    space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'ball') };
  const hammer: GrifballTacticalPlayer = { id: 'hammer', team: 'red', pos: point(-6, 0), vel: point(5.2, 0), scripted: true,
    space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer'), phase: 'swing_up', attackIn: .1, reach: 7.7 } };
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: carrier.id, ball: carrier.pos,
    goals: { blue: point(-47, 0), red: point(47, 0) }, spacing: 4, tactics: defaultGrifballTactics(),
    geometry: { shape: 'rectangular', x: 51.4, z: 22.4, blockers: [], key: 'runner-evasion-test' }, players: [carrier, hammer] };
  const selected: RunnerCandidate = { action: 'advance', destination: point(6, 0), route: { status: 'direct', points: [point(6, 0)], length: 6 },
    score: 1, risk: 1, supportETA: 2, progress: 6 };
  const assignment: GrifballAssignment = { botId: carrier.id, team: carrier.team, role: 'runner', slot: 0,
    destination: selected.destination, anchor: carrier.pos, carrierId: carrier.id, reason: 'Advance toward goal',
    runner: { carrierId: carrier.id, origin: carrier.pos, heading: point(1, 0), selected, candidates: [selected],
      reason: 'Advance', forcedProgress: false, waitUsed: 0, stalledSeconds: 0 } };
  const input = { snapshot, assignment, botId: carrier.id, origin: carrier.pos, movement: carrier.vel, distance: 6, duration: .25 };
  return { input, snapshot, assignment, carrier, hammer, point };
}

for (const sign of [1, -1]) test(`runner escapes a closing windup while preserving goal progress (${sign})`, () => {
  const f = fixture(sign), before = structuredClone(f.input), result = selectGrifballRunnerEvasion(f.input);
  assert.ok(result); assert.ok(Math.abs(result.x - sign) < 1e-12); assert.ok(Math.abs(result.z) < 1e-12);
  assert.deepEqual(f.input, before, 'Selecting an intent cannot mutate any engine or planning state');
  f.snapshot.players.reverse(); assert.deepEqual(selectGrifballRunnerEvasion(f.input), result);
});

for (const condition of ['disabled', 'space-off', 'runner-off', 'team-off', 'human-self', 'different-holder', 'missing-order',
  'stale-order', 'wrong-team', 'support-order', 'no-runner-plan', 'no-geometry', 'missing-threat-observation', 'not-playing', 'no-goal'] as const)
  test(`runner evasion delegates when ${condition}`, () => {
    const f = fixture();
    if (condition === 'disabled') f.snapshot.tactics!.defaults.enabled = false;
    if (condition === 'space-off') f.snapshot.tactics!.defaults.spaceEnabled = false;
    if (condition === 'runner-off') f.snapshot.tactics!.defaults.runnerEnabled = false;
    if (condition === 'team-off') f.snapshot.tactics!.teams.blue = { enabled: false };
    if (condition === 'human-self') f.carrier.scripted = false;
    if (condition === 'different-holder') f.snapshot.holderId = 'other';
    if (condition === 'missing-order') return assert.equal(selectGrifballRunnerEvasion({ ...f.input, assignment: undefined }), null);
    if (condition === 'stale-order') f.assignment.carrierId = 'previous';
    if (condition === 'wrong-team') f.assignment.team = 'red';
    if (condition === 'support-order') f.assignment.role = 'cover';
    if (condition === 'no-runner-plan') delete f.assignment.runner;
    if (condition === 'no-geometry') delete f.snapshot.geometry;
    if (condition === 'missing-threat-observation') delete f.hammer.space;
    if (condition === 'not-playing') f.snapshot.playing = false;
    if (condition === 'no-goal') f.snapshot.goals.red = null;
    assert.equal(selectGrifballRunnerEvasion(f.input), null);
  });

test('a ready enemy does not by itself spend the runner thrust', () => {
  const f = fixture(); f.hammer.space!.phase = 'ready';
  assert.equal(selectGrifballRunnerEvasion(f.input), null);
});

test('a distant windup does not interrupt safe running', () => {
  const f = fixture(); f.hammer.pos.x = -30;
  assert.equal(selectGrifballRunnerEvasion(f.input), null);
});

test('visible impact after thrust release still influences escape selection', () => {
  const f = fixture(); f.hammer.space!.attackIn = .4;
  const result = selectGrifballRunnerEvasion(f.input);
  assert.ok(result && result.x > .999 && Math.abs(result.z) < 1e-9);
});

test('a crossing lunge rules out the forward dash even when it escapes the hammer', () => {
  const f = fixture();
  f.snapshot.players.push({ id: 'crossfire', team: 'red', pos: { x: 6.5, z: 0 }, vel: { x: -10, z: 0 }, scripted: true,
    space: { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'sword'), phase: 'lunging', attackIn: 0, reach: 2 } });
  const result = selectGrifballRunnerEvasion(f.input);
  assert.ok(result && result.x > 0 && Math.abs(result.z) > .5);
});

for (const boundary of ['walls', 'arena'] as const) test(`runner cannot escape through ${boundary}`, () => {
  const f = fixture();
  if (boundary === 'arena') Object.assign(f.snapshot.geometry!, { x: .5, z: .5 });
  else for (const [x, z, hx, hz] of [[.5, 0, .01, 2], [-.5, 0, .01, 2], [0, .5, 2, .01], [0, -.5, 2, .01]])
    f.snapshot.geometry!.blockers.push({ kind: 'box', x, z, hx, hz });
  assert.equal(selectGrifballRunnerEvasion(f.input), null);
});

test('the supplied normal movement is the comparison, including an intentional stop', () => {
  const f = fixture();
  f.input.movement = { x: 30, z: 0 };
  assert.equal(selectGrifballRunnerEvasion(f.input), null, 'Already escaping safely');
  f.input.movement = { x: 0, z: 0 };
  assert.ok(selectGrifballRunnerEvasion(f.input));
});

test('invalid launch data cannot produce a direction', () => {
  const f = fixture();
  for (const value of [0, -1, NaN, Infinity]) {
    assert.equal(selectGrifballRunnerEvasion({ ...f.input, distance: value }), null);
    assert.equal(selectGrifballRunnerEvasion({ ...f.input, duration: value }), null);
  }
});
