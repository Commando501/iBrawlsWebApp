import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { runnerPursuitRules } from './aiGrifballRunnerPursuit';
import { resolveGrifballRunnerPursuitLaunch } from './aiGrifballRunnerPursuitLaunch';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { defaultGrifballTactics } from './grifballTacticsConfig';

function fixture() {
  const settings = { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' as const };
  const tactics = defaultGrifballTactics(); Object.assign(tactics.defaults, { runnerPursuitEnabled: true, stylesEnabled: false });
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, ball: { x: 8, z: 0 }, holderId: 'runner', spacing: 4,
    tactics, runnerPursuitRules: runnerPursuitRules(settings),
    geometry: { key: 'court', shape: 'rectangular', x: 60, z: 30, blockers: [] },
    goals: { blue: { x: 50, z: 0 }, red: { x: -50, z: 0 } }, players: [
      { id: 'defender', team: 'blue', scripted: true, difficulty: 'normal', pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, space: observeGrifballSpace(settings, 'sword') },
      { id: 'runner', team: 'red', scripted: false, pos: { x: 8, z: 0 }, vel: { x: 5.8, z: 5.8 }, space: observeGrifballSpace(settings, 'ball'), heading: { x: 1, z: 0 } },
      { id: 'safety', team: 'blue', scripted: true, pos: { x: 35, z: 0 }, vel: { x: 0, z: 0 }, space: observeGrifballSpace(settings, 'hammer') },
    ] };
  const plan = createGrifballTeamPlanState(); updateGrifballTeamPlan(plan, snapshot, .1);
  const assignment = plan.assignments.get('defender')!;
  assert.equal(assignment.defense?.pursuit?.weapon, 'sword');
  return { snapshot, assignment, run: () => resolveGrifballRunnerPursuitLaunch(assignment, snapshot, 'runner') };
}

test('crossing runner gets a finite center interception using current motion, without mutating the plan', () => {
  const f = fixture(), before = structuredClone({ snapshot: f.snapshot, assignment: f.assignment }), result = f.run();
  assert.equal(result.kind, 'intercept'); if (result.kind !== 'intercept') return;
  assert.ok(result.point.z > 2); assert.ok(result.point.x > 8);
  const rules = f.snapshot.runnerPursuitRules!;
  assert.ok(Math.abs(Math.hypot(result.point.x, result.point.z) - rules.lungeSpeed * result.seconds) < 1e-9);
  assert.ok(result.seconds < rules.lungeDistance / rules.lungeSpeed);
  assert.deepEqual(f.snapshot, before.snapshot); assert.deepEqual(f.assignment, before.assignment);
});

test('turning runner refreshes launch aim instead of reusing the planner intercept', () => {
  const f = fixture(), original = f.run();
  f.snapshot.players[1].vel.z = -5.8;
  const turned = f.run(); assert.equal(turned.kind, 'intercept');
  if (turned.kind !== 'intercept' || original.kind !== 'intercept') return;
  assert.equal(turned.point.z, -original.point.z); assert.equal(turned.seconds, original.seconds);
  assert.ok(f.assignment.defense!.pursuit!.intercept!.z > 0);
});

test('both team orientations use the same interception time and mirrored launch point', () => {
  const f = fixture(), original = f.run();
  f.assignment.team = 'red';
  for (const p of f.snapshot.players) { p.team = p.team === 'red' ? 'blue' : 'red'; p.pos.x *= -1; p.pos.z *= -1; p.vel.x *= -1; p.vel.z *= -1; }
  const mirror = f.run(); assert.equal(mirror.kind, 'intercept');
  if (mirror.kind !== 'intercept' || original.kind !== 'intercept') return;
  assert.equal(mirror.seconds, original.seconds); assert.equal(mirror.point.x, -original.point.x); assert.equal(mirror.point.z, -original.point.z);
});

test('launch readiness does not repeat the already completed swap delay', () => {
  const f = fixture(), original = f.run();
  f.snapshot.players[0].space!.attackIn += .4;
  assert.deepEqual(f.run(), original);
});

for (const change of ['wall', 'future-wall', 'fast', 'goal', 'punch', 'airborne', 'protected', 'dead', 'passed', 'stopped-match'] as const)
  test(`stale pursuit declines its uncommitted launch: ${change}`, () => {
    const f = fixture(), runner = f.snapshot.players[1];
    if (change === 'wall') f.snapshot.geometry!.blockers.push({ kind: 'box', x: 4, z: 0, hx: 1, hz: 8 });
    if (change === 'future-wall') f.snapshot.geometry!.blockers.push({ kind: 'box', x: 10, z: 2, hx: .1, hz: 1 });
    if (change === 'fast') runner.vel.x = 50;
    if (change === 'goal') f.snapshot.goals.blue = { x: 10, z: 0 };
    if (change === 'punch') { runner.space!.phase = 'swing_up'; runner.heading = { x: -1, z: 0 }; }
    if (change === 'airborne') runner.height = 1;
    if (change === 'protected') runner.invulnerabilityTimer = 1;
    if (change === 'dead') f.snapshot.players.splice(1, 1);
    if (change === 'passed') f.snapshot.holderId = 'other';
    if (change === 'stopped-match') f.snapshot.playing = false;
    assert.equal(f.run().kind, 'hold');
  });

test('ordinary cuts, disabled systems, unsupported ownership and other targets keep ordinary combat', () => {
  const f = fixture(); f.snapshot.players[1].vel = { x: -5.8, z: 0 };
  assert.equal(f.run().kind, 'ordinary', 'a new feasible hammer cut removes pursuit aiming');
  for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled', 'runnerPursuitEnabled'] as const) {
    const f = fixture(); f.snapshot.tactics!.defaults[key] = false; assert.equal(f.run().kind, 'ordinary', key);
  }
  const override = fixture(); override.snapshot.tactics!.teams.blue = { runnerPursuitEnabled: false };
  assert.equal(override.run().kind, 'ordinary');
  for (const change of ['easy', 'remote', 'coverage'] as const) {
    const f = fixture();
    if (change === 'easy') f.snapshot.players[0].difficulty = 'easy';
    if (change === 'remote') f.snapshot.players[0].scripted = false;
    if (change === 'coverage') { f.assignment.defense!.mode = 'contain'; f.assignment.defense!.pursuit!.weapon = null; }
    assert.equal(f.run().kind, 'ordinary');
  }
  assert.equal(resolveGrifballRunnerPursuitLaunch(undefined, f.snapshot, 'runner').kind, 'ordinary');
  assert.equal(resolveGrifballRunnerPursuitLaunch(f.assignment, f.snapshot, 'nearby-enemy').kind, 'ordinary');
});
