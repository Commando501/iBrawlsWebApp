import test from 'node:test';
import assert from 'node:assert/strict';
import { selectGrifballEscortEvasion } from './aiGrifballEvasion';
import { observeGrifballSpace } from './aiGrifballSpace';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import type { GrifballAssignment, GrifballTacticalPlayer, GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

function fixture(sign = 1) {
  const point = (x: number, z: number) => ({ x: x * sign, z: z * sign });
  const player = (id: string, team: 'blue' | 'red', x: number, z: number, vx = 0, vz = 0): GrifballTacticalPlayer =>
    ({ id, team, pos: point(x, z), vel: point(vx, vz), scripted: true,
      space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer') });
  // Recorded Stadium/201 escort reaction, rounded only for a compact fixture.
  const self = player('escort', 'blue', -2.1361, -.4717, 3.8852, .9514);
  const carrier = player('carrier', 'blue', 4.8764, -.9922, 7.5343, .2933);
  const hammer = player('hammer', 'red', 5.2615, 1.3481, -.5713, .3595);
  hammer.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer', 'swing_up', 1 / 30);
  const rear = player('rear', 'blue', -5.724, 1.1592, 5.0902, -1.0631);
  const swordA = player('sword-a', 'red', 9.7009, -1.9999, 5.0414, -.1564);
  const swordB = player('sword-b', 'red', 10.4979, 1.6964, .1119, .5391);
  for (const sword of [swordA, swordB]) sword.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'sword');
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: carrier.id, ball: carrier.pos,
    goals: { blue: point(-47, 0), red: point(47, 0) }, spacing: 4, tactics: defaultGrifballTactics(),
    geometry: { shape: 'rectangular', x: 51.4, z: 22.4, blockers: [], key: 'evasion-test' }, players: [self, carrier, hammer, rear, swordA, swordB] };
  const assignment: GrifballAssignment = { botId: self.id, team: 'blue', role: 'lead', slot: 0,
    destination: point(1.3745, -.9441), anchor: point(4.3739, -1.0026), carrierId: carrier.id, reason: 'Preserve recovery coverage' };
  const fallback = point(-.9621505553784973, -.27251845586097395);
  const input = { snapshot, assignment, botId: self.id, origin: self.pos, fallback, distance: 6, duration: .25 };
  return { input, snapshot, assignment, self, carrier, hammer, rear, point, player };
}

for (const sign of [1, -1]) test(`recorded escort reaction preserves coverage through the away-side escape (${sign})`, () => {
  const f = fixture(sign), before = structuredClone(f.input), result = selectGrifballEscortEvasion(f.input);
  assert.ok(Math.abs(result.x + f.input.fallback.z) < 1e-12 && Math.abs(result.z - f.input.fallback.x) < 1e-12);
  assert.deepEqual(f.input, before, 'The selector cannot mutate combat, tactical memory, or observations');
  f.snapshot.players.reverse();
  assert.deepEqual(selectGrifballEscortEvasion(f.input), result, 'Roster ordering does not pick an escape');
});

for (const condition of ['disabled', 'spacing-off', 'space-off', 'runner-off', 'team-off', 'human-self', 'missing-carrier', 'enemy-carrier', 'stale-order', 'no-geometry', 'missing-threat-observation', 'not-playing'] as const)
  test(`retain combat escape when ${condition}`, () => {
    const f = fixture();
    if (condition === 'disabled') f.snapshot.tactics!.defaults.enabled = false;
    if (condition === 'spacing-off') f.snapshot.tactics!.defaults.spacingEnabled = false;
    if (condition === 'space-off') f.snapshot.tactics!.defaults.spaceEnabled = false;
    if (condition === 'runner-off') f.snapshot.tactics!.defaults.runnerEnabled = false;
    if (condition === 'team-off') f.snapshot.tactics!.teams.blue = { enabled: false };
    if (condition === 'human-self') f.self.scripted = false;
    if (condition === 'missing-carrier') f.snapshot.players = f.snapshot.players.filter(p => p !== f.carrier);
    if (condition === 'enemy-carrier') f.carrier.team = 'red';
    if (condition === 'stale-order') f.assignment.carrierId = 'previous';
    if (condition === 'no-geometry') delete f.snapshot.geometry;
    if (condition === 'missing-threat-observation') delete f.hammer.space;
    if (condition === 'not-playing') f.snapshot.playing = false;
    assert.equal(selectGrifballEscortEvasion(f.input), f.input.fallback);
  });

test('a human carrier can receive escort support without becoming controlled', () => {
  const f = fixture(); f.carrier.scripted = false;
  assert.notDeepEqual(selectGrifballEscortEvasion(f.input), f.input.fallback);
  assert.equal(f.carrier.scripted, false);
});

for (const obstacle of ['wall', 'circle', 'edge'] as const) test(`escape rejects a swept ${obstacle} crossing`, () => {
  const f = fixture();
  if (obstacle === 'wall') f.snapshot.geometry!.blockers.push({ kind: 'box', x: -1.3, z: -3.2, hx: 2, hz: .03 });
  if (obstacle === 'circle') f.snapshot.geometry!.blockers.push({ kind: 'circle', x: -1.3, z: -3.2, radius: 1 });
  if (obstacle === 'edge') f.snapshot.geometry!.z = 2;
  // Block the opposite side too, so this asserts the fallback instead of an arbitrary side choice.
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -3, z: 2.2, hx: 2, hz: .03 });
  assert.equal(selectGrifballEscortEvasion(f.input), f.input.fallback);
});

test('a crossing active sword lunge rejects a tempting escort lane', () => {
  const f = fixture();
  const crossing = f.player('crossfire', 'red', 5, -3.4, -55, 0);
  crossing.space = { ...observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'sword'), phase: 'lunging', attackIn: 0, reach: 1 };
  f.snapshot.players.push(crossing);
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -3, z: 2.2, hx: 2, hz: .03 });
  assert.equal(selectGrifballEscortEvasion(f.input), f.input.fallback);
});

test('an escort does not dash through a teammate to shorten its carrier gap', () => {
  const f = fixture();
  f.rear.pos = { x: -1.3, z: -3.2 }; f.rear.vel = { x: 0, z: 0 };
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -3, z: 2.2, hx: 2, hz: .03 });
  assert.equal(selectGrifballEscortEvasion(f.input), f.input.fallback);
});

test('a windup hitting after dash release still rules out its unsafe landing', () => {
  const f = fixture();
  f.hammer.pos = { x: -.5, z: -6.2 }; f.hammer.vel = { x: 0, z: 0 };
  f.hammer.space = { ...f.hammer.space!, phase: 'swing_up', attackIn: .4, reach: 2 };
  f.snapshot.geometry!.blockers.push({ kind: 'box', x: -3, z: 2.2, hx: 2, hz: .03 });
  assert.equal(selectGrifballEscortEvasion(f.input), f.input.fallback);
});

test('the selector uses the launch origin after ground walking, not the earlier snapshot position', () => {
  const f = fixture();
  f.self.pos = { x: -30, z: 0 };
  f.input.origin = { x: -2.1361, z: -.4717 };
  const result = selectGrifballEscortEvasion(f.input);
  assert.ok(result.x > 0 && result.z < 0);
});
