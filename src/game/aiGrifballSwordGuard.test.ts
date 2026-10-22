import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { chooseGrifballSwordGuard, runnerPunchClock } from './aiGrifballSwordGuard';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import type { GrifballAssignment } from './aiGrifballTeamPlan';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';

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
  assert.equal(migrated.schemaVersion, 41); assert.equal(migrated.defaults.swordGuardEnabled, false);
  assert.equal(migrated.defaults.runnerClashAgencyStrength, .8); assert.equal(migrated.botStyles.runner, 'guardian');
  migrated.teams.red = { swordGuardEnabled: true, swordGuardReaction: .12 };
  const copy = validateGrifballTactics(JSON.parse(JSON.stringify(migrated)));
  assert.equal(resolveTeamTactics(copy, 'red').swordGuardReaction, .12);
  assert.equal(resolveTeamTactics(copy, 'blue').swordGuardEnabled, false);
  assert.throws(() => validateGrifballTactics({ ...copy, teams: { red: { swordGuardReaction: -1 } } }));
  assert.throws(() => validateGrifballTactics({ ...copy, teams: { red: { swordGuardEnabled: 1 } } }));
});

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
for (const style of styles) {
  test(`${style} at zero strength is exactly the team sword response`, () => {
    const f = fixture(), baseline = f.run(); f.input.playerStyle = style;
    assert.deepEqual(f.run(), baseline);
    f.config.defaults.swordGuardAgencyStrength = 1;
    const result = f.run()!;
    assert.equal(result.individuality!.style, style);
    if (style === 'balanced') { const { individuality, ...decision } = result; assert.deepEqual(decision, baseline); }
  });
  test(`${style} preserves ownership, geometry, final punch frame and goal urgency at full strength`, () => {
    const f = fixture(); f.input.playerStyle = style; f.config.defaults.swordGuardAgencyStrength = 1;
    f.input.punch!.age = .1; f.input.punch!.remaining = .001;
    assert.equal(f.run()?.action, 'space');
    f.input.punch!.remaining = 0; assert.equal(f.run()?.action, 'continue'); f.input.punch!.remaining = .2;
    f.input.eligible = false; assert.equal(f.run(), null); f.input.eligible = true;
    for (const key of ['enabled', 'spaceEnabled', 'defenseEnabled', 'swordGuardEnabled'] as const) {
      f.config.defaults[key] = false; assert.equal(f.run(), null); f.config.defaults[key] = true;
    }
    f.input.assignment!.geometry!.x = 2.52; assert.deepEqual(f.run()?.velocity, { x: 0, z: 0 });
    f.input.assignment!.geometry!.x = 50;
    f.input.punch!.heading.x = -1; assert.equal(f.run()?.action, 'continue'); f.input.punch!.heading.x = 1;
    f.input.ownGoals = [{ team: 'blue', position: { x: -6, y: 0, z: 0 }, halfExtents: { x: 5, z: 2 } }];
    assert.equal(f.run()?.action, 'continue'); assert.match(f.run()!.reason, /goal threat/);
  });
}

test('reaction preferences blend, clamp at the team range, and change recognition rather than punch duration', () => {
  const f = fixture(); f.config.defaults.swordGuardAgencyStrength = 1;
  f.input.playerStyle = 'enforcer'; assert.equal(f.run()?.action, 'continue'); assert.equal(f.run()?.reaction, .08);
  f.input.punch!.age = .08; assert.equal(f.run()?.action, 'space');
  f.input.playerStyle = 'guardian'; f.input.punch!.age = .045; assert.equal(f.run()?.action, 'space');
  f.config.defaults.swordGuardAgencyStrength = .5; assert.equal(f.run()?.action, 'continue');
  assert.ok(Math.abs(f.run()!.reaction - .05) < 1e-9);
  f.config.defaults.swordGuardReaction = 0; assert.equal(f.run()?.reaction, 0);
  f.config.defaults.swordGuardReaction = .3; f.input.playerStyle = 'enforcer'; assert.equal(f.run()?.reaction, .3);
});

test('spacing preferences alter actual displacement, scale smoothly, and retain positive clearance and speed limits', () => {
  const f = fixture(); f.input.pos.x = 3.52; f.input.punch!.age = .1;
  f.input.settings.speedBackward = f.input.settings.speedForward = 100;
  const team = f.run()!.velocity!.x;
  f.config.defaults.swordGuardAgencyStrength = 1;
  f.input.playerStyle = 'opportunist'; assert.equal(f.run()!.velocity!.x, 0);
  f.input.playerStyle = 'guardian'; assert.ok(f.run()!.velocity!.x > team);
  assert.ok(f.run()!.velocity!.x <= 5.2);
  f.input.pos.x = 3.31; f.input.playerStyle = 'opportunist';
  const full = f.run()!.individuality!.clearance;
  assert.ok(full > 0); f.config.defaults.swordGuardAgencyStrength = .5;
  assert.ok(Math.abs(f.run()!.individuality!.clearance - (.25 + full) / 2) < 1e-9);
  const original = structuredClone(f.input), result = f.run()!;
  assert.deepEqual(chooseGrifballSwordGuard(structuredClone(original)), result); assert.deepEqual(f.input, original);
  f.input.pos.x *= -1; f.input.punch!.heading.x *= -1;
  assert.equal(f.run()!.velocity!.x, -result.velocity!.x);
  f.input.settings.speedForward = 0; assert.equal(Math.abs(f.run()!.velocity!.x), 0);
});

test('v13 imports leave sword individuality off while preserving awareness, styles and independent team overrides', () => {
  const legacy = JSON.parse(JSON.stringify(defaultGrifballTactics())); legacy.schemaVersion = 13;
  delete legacy.defaults.swordGuardAgencyStrength;
  Object.assign(legacy.defaults, { swordGuardEnabled: true, swordGuardReaction: .12, runnerClashAgencyStrength: .8 });
  legacy.botStyles.sword = 'opportunist'; legacy.teams.red = { swordGuardReaction: .2 };
  const config = validateGrifballTactics(legacy);
  assert.equal(config.schemaVersion, 41); assert.equal(config.defaults.swordGuardAgencyStrength, 0);
  assert.equal(config.defaults.swordGuardEnabled, true); assert.equal(config.defaults.swordGuardReaction, .12);
  assert.equal(config.defaults.runnerClashAgencyStrength, .8); assert.equal(config.botStyles.sword, 'opportunist');
  assert.deepEqual(config.teams, legacy.teams);
  config.teams.red!.swordGuardAgencyStrength = .7;
  assert.equal(resolveTeamTactics(config, 'red').swordGuardAgencyStrength, .7);
  assert.equal(resolveTeamTactics(config, 'blue').swordGuardAgencyStrength, 0);
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const value of [-.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { swordGuardAgencyStrength: value } } }));
  delete (config.defaults as Partial<typeof config.defaults>).swordGuardAgencyStrength;
  assert.throws(() => validateGrifballTactics(config), /incomplete/);
});
