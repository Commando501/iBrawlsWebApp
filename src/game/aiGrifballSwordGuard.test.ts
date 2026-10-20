import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { chooseGrifballSwordGuard, runnerPunchClock } from './aiGrifballSwordGuard';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import type { GrifballAssignment } from './aiGrifballTeamPlan';

function fixture() {
  const config = defaultGrifballTactics(); config.defaults.swordGuardEnabled = true;
  const assignment: GrifballAssignment = { botId: 'sword', team: 'blue', role: 'chaser', slot: 0,
    carrierId: 'runner', destination: { x: 0, z: 0 }, anchor: { x: 0, z: 0 }, reason: '', tuning: config.defaults,
    geometry: { key: 'court', shape: 'rectangular', x: 50, z: 20, blockers: [] } };
  const input: Parameters<typeof chooseGrifballSwordGuard>[0] = { assignment, settings: { ...DEFAULT_ADMIN_SETTINGS },
    dt: 1 / 60, pos: { x: 2.5, y: 0, z: 0 }, bodyHeight: .825, radiusBonus: 0, eligible: true,
    punch: { id: 'runner', pos: { x: 0, y: 0, z: 0 }, heading: { x: 1, y: 0, z: 0 },
      bodyHeight: .825, radiusBonus: 0, originHeight: 1.2, age: .07, remaining: .29 } };
  return { config, input, run: () => chooseGrifballSwordGuard(input) };
}
test('front-facing active punch causes ordinary backward spacing and immediate release on recovery', () => {
  const f = fixture(); assert.equal(f.run()?.action, 'space'); assert.ok(f.run()!.velocity!.x > 0);
  assert.ok(f.run()!.velocity!.x <= 5.2 * f.input.settings.speedBackward / 100);
  f.input.punch!.remaining = 0; assert.equal(f.run()?.action, 'continue');
});
for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled', 'swordGuardEnabled'] as const)
  test(`off switch ${key} hands back unchanged combat ownership`, () => {
    const f = fixture(); f.config.defaults[key] = false; assert.equal(f.run(), null);
  });
test('unready/committed ownership does not respond; reaction is not instantaneous', () => {
  const f = fixture(); f.input.eligible = false; assert.equal(f.run(), null);
  f.input.eligible = true; f.input.punch!.age = .02; assert.equal(f.run()?.action, 'continue');
});
test('side/back and pitched-away punches leave the ordinary attack opportunity open', () => {
  for (const heading of [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }]) {
    const f = fixture(); f.input.punch!.heading = heading; assert.equal(f.run()?.action, 'continue');
  }
});
test('short remaining punch permits distant approach while imminent lunge contact waits', () => {
  const f = fixture(); f.input.pos.x = 6; f.input.punch!.remaining = .03;
  assert.equal(f.run()?.action, 'continue'); f.input.punch!.remaining = .3;
  assert.equal(f.run()?.action, 'space'); assert.equal(f.run()?.velocity!.x, 0);
  f.input.pos.x = 25; assert.equal(f.run()?.action, 'continue');
});
test('close defender waits through the last punch frame, since a punch cancels sword windup too', () => {
  const f = fixture(); f.input.punch!.remaining = .001;
  assert.equal(f.run()?.action, 'space');
  f.input.punch!.remaining = 0; assert.equal(f.run()?.action, 'continue');
});
test('unusual movement tuning keeps retreat within the shared walk budget, including zero speed', () => {
  const f = fixture(); f.input.settings.speedBackward = 200; f.input.settings.speedForward = 20;
  assert.ok(f.run()!.velocity!.x <= 1.04);
  f.input.settings.speedForward = 0; assert.equal(f.run()?.velocity!.x, 0);
});
test('blocked approach skips response; blocked retreat holds without crossing a wall', () => {
  const f = fixture(), geometry = f.input.assignment!.geometry!;
  geometry.blockers.push({ kind: 'box', x: 1, z: 0, hx: .2, hz: 3 }); assert.equal(f.run()?.action, 'continue');
  geometry.blockers = []; geometry.x = 2.52;
  assert.equal(f.run()?.action, 'space'); assert.deepEqual(f.run()?.velocity, { x: 0, z: 0 });
});
test('imminent scoring on a scaled goal overrides patience', () => {
  const f = fixture(); f.input.ownGoals = [{ team: 'blue', position: { x: -6, y: 0, z: 0 }, halfExtents: { x: 5, z: 2 } }];
  assert.match(f.run()!.reason, /goal threat/); assert.equal(f.run()?.action, 'continue');
});
test('mirrored and cloned observations preserve response with mirrored movement', () => {
  const f = fixture(), copy = structuredClone(f.input), before = structuredClone(f.input);
  assert.deepEqual(chooseGrifballSwordGuard(copy), f.run()); assert.deepEqual(f.input, before);
  copy.pos.x *= -1; copy.punch!.heading.x *= -1;
  assert.equal(chooseGrifballSwordGuard(copy)?.velocity!.x, -f.run()!.velocity!.x);
});
test('punch clocks cover both active phases and release at recovery', () => {
  assert.deepEqual(runnerPunchClock('swing_up', .07, DEFAULT_ADMIN_SETTINGS), { age: .07, remaining: .29 });
  const down = runnerPunchClock('swing_down', .05, DEFAULT_ADMIN_SETTINGS);
  assert.equal(down.age, .29); assert.ok(Math.abs(down.remaining - .07) < 1e-9);
  assert.equal(runnerPunchClock('recovering', 0, DEFAULT_ADMIN_SETTINGS).remaining, 0);
});
test('schema 12 migrates awareness off, retaining all prior individuality; overrides and JSON round trip', () => {
  const legacy = JSON.parse(JSON.stringify(defaultGrifballTactics())); legacy.schemaVersion = 12;
  delete legacy.defaults.swordGuardEnabled; delete legacy.defaults.swordGuardReaction;
  legacy.defaults.runnerClashAgencyStrength = .8; legacy.botStyles.runner = 'guardian';
  const migrated = validateGrifballTactics(legacy);
  assert.equal(migrated.schemaVersion, 13); assert.equal(migrated.defaults.swordGuardEnabled, false);
  assert.equal(migrated.defaults.runnerClashAgencyStrength, .8); assert.equal(migrated.botStyles.runner, 'guardian');
  migrated.teams.red = { swordGuardEnabled: true, swordGuardReaction: .12 };
  const copy = validateGrifballTactics(JSON.parse(JSON.stringify(migrated)));
  assert.equal(resolveTeamTactics(copy, 'red').swordGuardReaction, .12);
  assert.equal(resolveTeamTactics(copy, 'blue').swordGuardEnabled, false);
  assert.throws(() => validateGrifballTactics({ ...copy, teams: { red: { swordGuardReaction: -1 } } }));
  assert.throws(() => validateGrifballTactics({ ...copy, teams: { red: { swordGuardEnabled: 1 } } }));
});
