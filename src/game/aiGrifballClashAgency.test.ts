import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import type { CustomMapData } from '../types';
import { GRIFBALL_PLAYER_STYLES, type GrifballPlayerStyle } from './grifballPlayerStyles';
import { defaultGrifballTactics, validateGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import { chooseRunnerPunchClash, type RunnerSwordThreat } from './aiGrifballRunnerClash';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { resolveGrifballCarrierDecision } from './aiGrifballObjectiveSteering';
import type { GrifballAssignment } from './aiGrifballTeamPlan';

const styles = Object.keys(GRIFBALL_PLAYER_STYLES) as GrifballPlayerStyle[];
function fixture() {
  const config = defaultGrifballTactics(); config.defaults.runnerClashEnabled = true;
  const geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52);
  const threat: RunnerSwordThreat = { id: 'sword', pos: { x: 2.5, y: 0, z: 0 }, vel: { x: 0, z: 0 },
    kind: 'slash', age: .08, impactIn: .1, bodyHeight: .825, radiusBonus: 0 };
  const input = { pos: { x: 0, y: 0, z: 0 }, threats: [threat], geometry, tuning: config.defaults,
    settings: { ...DEFAULT_ADMIN_SETTINGS }, canPunch: true, dt: 1 / 60 };
  return { input, threat, config, run: (playerStyle: GrifballPlayerStyle) => chooseRunnerPunchClash({ ...input, playerStyle }) };
}

test('zero counter individuality preserves the entire decision for every style and other agency strength', () => {
  const f = fixture(); Object.assign(f.config.defaults, { agencyStrength: 1, runnerAgencyStrength: 1, defenseAgencyStrength: 1, passAgencyStrength: 1 });
  const baseline = f.run('balanced');
  for (const style of styles) assert.deepEqual(f.run(style), baseline);
  assert.equal(baseline.individuality, undefined);
});

test('style timing produces distinct early, late and recognition decisions from identical visible attacks', () => {
  const f = fixture(); f.config.defaults.runnerClashAgencyStrength = 1;
  assert.equal(f.run('enforcer').action, 'punch'); assert.equal(f.run('balanced').action, 'track');
  f.threat.impactIn = .07;
  assert.equal(f.run('balanced').action, 'punch'); assert.equal(f.run('opportunist').action, 'track');
  f.threat.age = .05; f.threat.impactIn = .06;
  assert.equal(f.run('guardian').action, 'punch'); assert.equal(f.run('balanced').action, 'track');
  assert.equal(f.run('enforcer').action, 'track', 'wider window does not bypass recognition');
  const { individuality, ...balanced } = f.run('balanced');
  f.config.defaults.runnerClashAgencyStrength = 0;
  assert.deepEqual(balanced, f.run('balanced'), 'Balanced keeps team decisions at any strength');
});

test('strength blends timing, respecting configuration limits and the actual punch duration', () => {
  const f = fixture(); f.config.defaults.runnerClashAgencyStrength = .5;
  assert.equal(f.run('enforcer').action, 'track'); assert.ok(Math.abs(f.run('enforcer').window - .095) < 1e-9);
  assert.ok(Math.abs(f.run('guardian').reaction - .05) < 1e-9);
  Object.assign(f.config.defaults, { runnerClashAgencyStrength: 1, runnerClashLead: .3, runnerClashReaction: .01 });
  assert.equal(f.run('enforcer').window, .3); assert.equal(f.run('guardian').reaction, 0);
  f.config.defaults.runnerClashLead = .02;
  assert.equal(f.run('opportunist').window, .02);
  f.input.settings.hammerMeleeSpeed = .01; f.config.defaults.runnerClashLead = .3;
  const result = f.run('enforcer');
  assert.ok(result.window < .03); assert.equal(result.individuality!.preferredWindow, .3);
  assert.equal(result.action, 'none', 'style never extends the physical counter duration');
});

for (const style of styles) test(`${style} preserves contact, readiness, imminent-goal and active-punch guards`, () => {
  const f = fixture(); f.config.defaults.runnerClashAgencyStrength = 1;
  f.threat.age = .1; f.threat.impactIn = .04;
  assert.equal(f.run(style).action, 'punch');
  f.input.canPunch = false; assert.equal(f.run(style).action, 'unavailable'); f.input.canPunch = true;
  assert.equal(chooseRunnerPunchClash({ ...f.input, playerStyle: style, finishIn: .01 }).action, 'finish');
  f.threat.pos.x = 8; assert.equal(f.run(style).action, 'none'); f.threat.pos.x = 2.5;
  f.threat.invulnerabilityTimer = 1; assert.equal(f.run(style).action, 'none'); f.threat.invulnerabilityTimer = 0;
  const assignment: GrifballAssignment = { botId: 'runner', team: 'blue', role: 'runner', slot: 0,
    carrierId: 'runner', destination: { x: 10, z: 0 }, anchor: { x: 0, z: 0 }, reason: '',
    geometry: f.input.geometry, tuning: f.input.tuning, runnerClash: f.run(style) };
  const committed = resolveGrifballCarrierDecision({ ...f.input, assignment, threats: [f.threat], clashThreats: [f.threat],
    players: [], avoidanceEnemies: [], goal: { x: 47, z: 0 }, weaponState: 'swing_up', canStartWeaponAction: true,
    playerStyle: style === 'guardian' ? 'enforcer' : 'guardian' })!;
  assert.equal(committed.kind, 'committed-punch'); assert.equal(committed.heading, undefined);
  assert.deepEqual(committed.clash, assignment.runnerClash, 'a style edit cannot retime a committed punch');
});

for (const gate of ['runnerClashEnabled', 'enabled', 'spaceEnabled', 'runnerEnabled'] as const)
  test(`counter individuality cannot bypass ${gate}`, () => {
    const f = fixture(); f.config.defaults.runnerClashAgencyStrength = 1;
    const assignment: GrifballAssignment = { botId: 'runner', team: 'blue', role: 'runner', slot: 0,
      carrierId: 'runner', destination: { x: 10, z: 0 }, anchor: { x: 0, z: 0 }, reason: '', geometry: f.input.geometry, tuning: f.input.tuning };
    const input = { ...f.input, assignment, threats: [f.threat], clashThreats: [f.threat], players: [], avoidanceEnemies: [],
      goal: { x: 47, z: 0 }, weaponState: 'ready', canStartWeaponAction: true, playerStyle: 'enforcer' as const };
    assert.equal(resolveGrifballCarrierDecision(input)!.kind, 'punch');
    f.config.defaults[gate] = false;
    assert.equal(resolveGrifballCarrierDecision(input)!.kind, 'move');
    assert.equal(resolveGrifballCarrierDecision(input)!.clash, undefined);
  });

test('v11 migration retains enabled timing, styles and overrides while counter individuality starts at zero', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 11; delete old.defaults.runnerClashAgencyStrength;
  Object.assign(old.defaults, { runnerClashEnabled: true, runnerClashReaction: .12, runnerClashLead: .14, runnerAgencyStrength: .8 });
  old.botStyles.runner = 'opportunist'; old.teams.red = { runnerClashReaction: .2 };
  const config = validateGrifballTactics(old);
  assert.equal(config.schemaVersion, 13); assert.equal(config.defaults.runnerClashAgencyStrength, 0);
  assert.equal(config.defaults.runnerClashEnabled, true); assert.equal(config.defaults.runnerClashReaction, .12);
  assert.equal(config.defaults.runnerClashLead, .14); assert.equal(config.defaults.runnerAgencyStrength, .8);
  assert.equal(config.botStyles.runner, 'opportunist'); assert.deepEqual(config.teams, old.teams);
  config.teams.red!.runnerClashAgencyStrength = .7;
  assert.equal(resolveTeamTactics(config, 'red').runnerClashAgencyStrength, .7);
  assert.equal(resolveTeamTactics(config, 'blue').runnerClashAgencyStrength, 0);
  assert.deepEqual(validateGrifballTactics(JSON.parse(JSON.stringify(config))), config);
  for (const value of [-.1, 1.1, NaN, '1']) assert.throws(() => validateGrifballTactics({ ...config, teams: { red: { runnerClashAgencyStrength: value } } }));
});

test('style decisions repeat after cloning and mirroring without consuming randomness', () => {
  const f = fixture(); f.config.defaults.runnerClashAgencyStrength = 1;
  const original = chooseRunnerPunchClash({ ...f.input, playerStyle: 'enforcer' });
  const restored = chooseRunnerPunchClash({ ...structuredClone(f.input), playerStyle: 'enforcer' });
  assert.deepEqual(restored, original);
  f.threat.pos.x *= -1;
  const mirror = f.run('enforcer');
  assert.deepEqual({ ...mirror, heading: original.heading }, original);
  assert.deepEqual(mirror.heading, { x: -1, z: 0 });
});
