import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseGrifballHammerDefense, hammerDefenseImpactTicks, resolveGrifballHammerDefense } from './aiGrifballHammerDefense';
import { createGrifballTeamPlanState, resetGrifballTeamPlan, updateGrifballTeamPlan, type GrifballAssignment, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { createInitialBall } from './grifballBall';
import { defaultGrifballTactics, validateGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

function fixture() {
  const config = defaultGrifballTactics(); config.defaults.hammerDefenseEnabled = true;
  const assignment: GrifballAssignment = { botId: 'hammer', team: 'blue', role: 'safety', slot: 0, destination: { x: 0, z: 0 },
    anchor: { x: 0, z: 0 }, carrierId: null, reason: '', tuning: config.defaults,
    geometry: { key: 'court', shape: 'rectangular', x: 50, z: 20, blockers: [] } };
  const ball = createInitialBall({ x: 0, y: 0, z: 0 });
  Object.assign(ball, { state: 'thrown', pos: { x: 8, y: 3, z: 0 }, vel: { x: -10, y: 0, z: 0 } });
  const input: Parameters<typeof chooseGrifballHammerDefense>[0] = { assignment, settings: { ...DEFAULT_ADMIN_SETTINGS }, dt: 1 / 60,
    pos: { x: 0, y: 0, z: 0 }, team: 'blue', ball, bounds: { mapShape: 'rectangular', arenaRadius: 50 },
    ownGoal: { x: -45, z: 0 }, observedThrow: { team: 'red', carrierId: 'thrower', age: .1 }, eligible: true, nearbyEnemy: false };
  return { config, input, run: () => chooseGrifballHammerDefense(input) };
}
test('incoming enemy pass earns an ordinary stationary strike using actual phase timing', () => {
  const f = fixture(), before = structuredClone(f.input), result = f.run()!;
  assert.equal(result.action, 'strike'); assert.deepEqual(result.heading, { x: 1, z: 0 });
  assert.equal(hammerDefenseImpactTicks(f.input.settings, f.input.dt), 25);
  assert.ok(Math.abs(result.predictedBall!.x - (8 - 10 * 25 / 60)) < 1e-9);
  assert.deepEqual(f.input, before); assert.deepEqual(chooseGrifballHammerDefense(structuredClone(f.input)), result);
  f.input.pos.x *= -1; f.input.ball.pos.x *= -1; f.input.ball.vel.x *= -1; f.input.ownGoal!.x *= -1;
  assert.equal(f.run()!.heading!.x, -1);
});
for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled', 'hammerDefenseEnabled'] as const)
  test(`${key} off leaves normal combat and objective ownership`, () => {
    const f = fixture(); f.config.defaults[key] = false; assert.equal(f.run(), null);
  });
test('readiness, friendly/unknown throws, observation latency and nearby combat gate interception', () => {
  const f = fixture(); f.input.eligible = false; assert.equal(f.run(), null); f.input.eligible = true;
  f.input.observedThrow = undefined; assert.equal(f.run()?.action, 'continue');
  f.input.observedThrow = { team: 'blue', carrierId: 'friend', age: 2 }; assert.equal(f.run()?.action, 'continue');
  f.input.observedThrow.team = 'red'; f.input.observedThrow.age = .02; assert.equal(f.run()?.action, 'continue');
  f.input.observedThrow.age = .08; assert.equal(f.run()?.action, 'strike');
  f.input.nearbyEnemy = true; assert.equal(f.run()?.action, 'continue');
});
test('disabled mechanics, stationary/settled balls, high arcs, outgoing passes and own-goal redirects are rejected', () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.input.settings.hammerBallDeflectionEnabled = false; },
    (f: ReturnType<typeof fixture>) => { f.input.settings.hammerBallDeflectionStrength = 0; },
    (f: ReturnType<typeof fixture>) => { f.input.ball.state = 'loose'; },
    (f: ReturnType<typeof fixture>) => { f.input.ball.vel.x = 0; },
    (f: ReturnType<typeof fixture>) => { f.input.ball.pos.y = 20; },
    (f: ReturnType<typeof fixture>) => { f.input.ball.vel.x = 10; },
    (f: ReturnType<typeof fixture>) => { f.input.ball.pos.x = -2; },
  ]) { const f = fixture(); change(f); assert.equal(f.run()?.action, 'continue'); }
});
test('blocked flight and strike paths cannot be intercepted through cover', () => {
  for (const x of [2, 6]) {
    const f = fixture(); f.input.assignment!.geometry!.blockers.push({ kind: 'box', x, z: 0, hx: .2, hz: 3 });
    assert.equal(f.run()?.action, 'continue'); assert.match(f.run()!.reason, /blocked/);
  }
});
test('committed strike survives tuning edits but ends on recovery, death/flight or reset', () => {
  const f = fixture(), plan = createGrifballTeamPlanState(); plan.assignments.set('hammer', f.input.assignment!);
  const first = resolveGrifballHammerDefense(plan, 'hammer', true, false, f.input)!; assert.equal(first.action, 'strike');
  f.config.defaults.hammerDefenseEnabled = false; f.input.ball.vel.x = 20;
  const restored = structuredClone(plan);
  const continuation = resolveGrifballHammerDefense(restored, 'hammer', true, true, f.input)!;
  assert.equal(continuation.action, 'committed'); assert.equal(continuation.impactIn, first.impactIn - f.input.dt);
  assert.deepEqual(resolveGrifballHammerDefense(plan, 'hammer', true, true, f.input)?.heading, first.heading);
  assert.equal(resolveGrifballHammerDefense(plan, 'hammer', true, false, f.input), null);
  assert.equal(plan.hammerDefenseCommitments?.hammer, undefined);
  assert.equal(resolveGrifballHammerDefense(restored, 'hammer', false, true, f.input), null);
  resetGrifballTeamPlan(plan); assert.equal(plan.hammerDefenseCommitments, undefined); assert.equal(plan.observedThrow, undefined);
});
test('throw team and age come from public possession history, survive ID clearance, and clear on new play', () => {
  const f = fixture(), plan = createGrifballTeamPlanState();
  const snapshot: GrifballTacticalSnapshot = { round: 1, playing: true, holderId: 'thrower',
    ball: { x: 8, z: 0 }, ballPhysics: { ...f.input.ball, state: 'held', holderId: 'thrower' },
    players: [{ id: 'thrower', team: 'red', pos: { x: 8, z: 0 }, vel: { x: 0, z: 0 }, scripted: false }],
    goals: { blue: { x: -45, z: 0 }, red: { x: 45, z: 0 } }, spacing: 4, tactics: f.config };
  updateGrifballTeamPlan(plan, snapshot, .1);
  const thrown = { ...snapshot, holderId: null, ballPhysics: f.input.ball };
  updateGrifballTeamPlan(plan, thrown, .1); assert.deepEqual(plan.observedThrow, { team: 'red', carrierId: 'thrower', age: 0 });
  updateGrifballTeamPlan(plan, thrown, .1); assert.equal(plan.observedThrow!.age, .1);
  const unknown = createGrifballTeamPlanState(); updateGrifballTeamPlan(unknown, thrown, .1); assert.equal(unknown.observedThrow, undefined);
  updateGrifballTeamPlan(plan, { ...thrown, round: 2 }, .1); assert.equal(plan.observedThrow, undefined);
});
test('v14 migration preserves sword styles and overrides, with hammer pass defense disabled', () => {
  const old = JSON.parse(JSON.stringify(defaultGrifballTactics())); old.schemaVersion = 14;
  delete old.defaults.hammerDefenseEnabled; delete old.defaults.hammerDefenseReaction;
  old.defaults.swordGuardAgencyStrength = .8; old.botStyles.hammer = 'guardian'; old.teams.red = { swordGuardAgencyStrength: .5 };
  const config = validateGrifballTactics(old); assert.equal(config.schemaVersion, 15);
  assert.equal(config.defaults.hammerDefenseEnabled, false); assert.equal(config.defaults.hammerDefenseReaction, .08);
  assert.equal(config.defaults.swordGuardAgencyStrength, .8); assert.equal(config.botStyles.hammer, 'guardian');
  config.teams.red!.hammerDefenseEnabled = true; config.teams.red!.hammerDefenseReaction = .12;
  assert.equal(resolveTeamTactics(config, 'red').hammerDefenseReaction, .12); assert.equal(resolveTeamTactics(config, 'blue').hammerDefenseEnabled, false);
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const value of [-.1, .4, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { hammerDefenseReaction: value } } }));
});
