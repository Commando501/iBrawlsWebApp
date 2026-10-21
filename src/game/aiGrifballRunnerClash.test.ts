import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics, validateGrifballTactics, resolveTeamTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { chooseRunnerPunchClash, type RunnerSwordThreat } from './aiGrifballRunnerClash';
import { resolveGrifballCarrierDecision } from './aiGrifballObjectiveSteering';
import type { GrifballAssignment } from './aiGrifballTeamPlan';
import { observeLiveRunnerSwordThreat } from '../components/grifball/runnerClashObservation';

function fixture() {
  const geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
    arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52);
  const config = defaultGrifballTactics(); config.defaults.runnerClashEnabled = true;
  const threat: RunnerSwordThreat = { id: 'sword', pos: { x: 2.5, y: 0, z: 0 }, vel: { x: 0, z: 0 },
    kind: 'slash', age: .07, impactIn: .04, bodyHeight: .825, radiusBonus: 0 };
  const input = { pos: { x: 0, y: 0, z: 0 }, threats: [threat], geometry,
    tuning: config.defaults, settings: { ...DEFAULT_ADMIN_SETTINGS }, canPunch: true, dt: 1 / 60 };
  return { input, threat, config, run: () => chooseRunnerPunchClash(input) };
}
test('timed punch covers an imminent slash beyond the old proximity threshold', () => {
  const f = fixture(); const result = f.run();
  assert.equal(result.action, 'punch'); assert.equal(result.targetId, 'sword');
  assert.deepEqual(result.heading, { x: 1, z: 0 });
});
test('reaction and counter window delay a punch without extending its active duration', () => {
  const f = fixture(); f.threat.age = .03; f.threat.impactIn = .08;
  assert.equal(f.run().action, 'track');
  f.threat.age = .07; f.threat.impactIn = .1;
  assert.equal(f.run().action, 'track');
  f.input.settings.hammerMeleeSpeed = .01; f.input.tuning.runnerClashLead = .3;
  const result = f.run(); assert.equal(result.action, 'none', 'contact beyond the short punch is not treated as protected');
  f.threat.impactIn = .03;
  assert.equal(f.run().action, 'track'); assert.ok(f.run().window < .03);
});
test('an approaching lunge is timed from visible travel, not instantaneous attack ETA', () => {
  const f = fixture(); Object.assign(f.threat, { kind: 'lunge', age: .1, impactIn: 0, vel: { x: -24, z: 0 } });
  const result = f.run(); assert.equal(result.action, 'punch');
  assert.ok(Math.abs(result.impactIn! - 1 / 24) < 1e-9);
  f.threat.vel.x = 24; assert.equal(f.run().action, 'none');
});

test('lunge contact respects model radius, height and a path that misses the runner', () => {
  const f = fixture(); Object.assign(f.threat, { kind: 'lunge', age: .1, impactIn: 0, vel: { x: -24, z: 0 } });
  const larger = chooseRunnerPunchClash({ ...f.input, runnerRadiusBonus: .3 });
  assert.ok(Math.abs(larger.impactIn! - .7 / 24) < 1e-9);
  f.threat.pos.y = 2;
  assert.equal(f.run().action, 'none');
  f.threat.pos.y = 0; f.threat.pos.z = 2;
  assert.equal(f.run().action, 'none', 'closing distance alone does not imply contact');
  f.threat.pos.x = 1; f.threat.pos.z = 0; f.threat.vel.x = 0;
  assert.equal(f.run().impactIn, 0, 'overlapping lunge is already at contact');
});
for (const reason of ['shield', 'high', 'distant', 'tiny-punch', 'spent', 'invalid', 'wall'] as const)
  test(`does not invent a clash against ${reason}`, () => {
    const f = fixture();
    if (reason === 'shield') f.threat.invulnerabilityTimer = 1;
    if (reason === 'high') f.threat.pos.y = 5;
    if (reason === 'distant') f.threat.pos.x = 8;
    if (reason === 'tiny-punch') f.input.settings.grifballPunchLungeDistance = 0;
    if (reason === 'spent') f.threat.impactIn = -.01;
    if (reason === 'invalid') f.threat.pos.x = NaN;
    if (reason === 'wall') f.input.geometry = buildGrifballSpaceGeometry({
      mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 },
      objects: [{ id: 'wall', type: 'box', position: { x: 1.2, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
        scale: { x: .5, y: 3, z: 10 }, isCollidable: true }],
    } as unknown as CustomMapData, 52);
    assert.equal(f.run().action, 'none');
  });
test('cooldown is never reset and a reachable goal before contact keeps priority', () => {
  const f = fixture(); f.input.canPunch = false; assert.equal(f.run().action, 'unavailable');
  f.input.canPunch = true;
  assert.equal(chooseRunnerPunchClash({ ...f.input, finishIn: .01 }).action, 'finish');
  assert.equal(chooseRunnerPunchClash({ ...f.input, finishIn: .1 }).action, 'punch');
});
test('earliest threat and ties are deterministic across roster order and mirroring', () => {
  const f = fixture(); f.input.threats.push({ ...structuredClone(f.threat), id: 'a' });
  assert.equal(f.run().targetId, 'a'); f.input.threats.reverse(); assert.equal(f.run().targetId, 'a');
  for (const threat of f.input.threats) threat.pos.x *= -1;
  assert.deepEqual(f.run().heading, { x: -1, z: 0 });
});
test('fresh live observations exclude ready, spent and recovering slashes', () => {
  const actor = { pos: { x: 2, y: 0, z: 0 }, activeWeapon: 'sword', weaponState: 'swing_up', weaponTimer: .07 };
  assert.ok(observeLiveRunnerSwordThreat('sword', actor, DEFAULT_ADMIN_SETTINGS));
  for (const weaponState of ['ready', 'swing_down', 'recovering'])
    assert.equal(observeLiveRunnerSwordThreat('sword', { ...actor, weaponState }, DEFAULT_ADMIN_SETTINGS), null);
  assert.equal(observeLiveRunnerSwordThreat('sword', { ...actor, weaponState: 'slashing', weaponTimer: .2 }, DEFAULT_ADMIN_SETTINGS), null);
});
test('schema 10 migrates timing off while keeping player preferences and team overrides', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 10;
  delete old.defaults.runnerClashEnabled; delete old.defaults.runnerClashLead; delete old.defaults.runnerClashReaction;
  old.defaults.passAgencyStrength = .8; old.botStyles.runner = 'guardian';
  const result = validateGrifballTactics(old);
  assert.equal(result.schemaVersion, 30); assert.equal(result.defaults.runnerClashEnabled, false);
  assert.equal(result.defaults.passAgencyStrength, .8); assert.equal(result.botStyles.runner, 'guardian');
  result.teams.red = { runnerClashEnabled: true, runnerClashReaction: .12 };
  assert.equal(resolveTeamTactics(result, 'red').runnerClashReaction, .12);
  assert.equal(resolveTeamTactics(result, 'blue').runnerClashEnabled, false);
  for (const patch of [{ runnerClashEnabled: 1 }, { runnerClashReaction: -.1 }, { runnerClashLead: .4 }])
    assert.throws(() => validateGrifballTactics({ ...result, teams: { red: patch } }));
});
for (const gate of ['runnerClashEnabled', 'enabled', 'spaceEnabled', 'runnerEnabled'] as const)
  test(`carrier respects the ${gate} gate`, () => {
    const f = fixture();
    const assignment: GrifballAssignment = { botId: 'runner', team: 'blue', role: 'runner', slot: 0,
      carrierId: 'runner', destination: { x: 10, z: 0 }, anchor: { x: 0, z: 0 }, reason: '',
      geometry: f.input.geometry, tuning: f.input.tuning };
    const input = { assignment, pos: f.input.pos, threats: [f.threat], clashThreats: [f.threat], players: [],
      avoidanceEnemies: [], goal: { x: 47, z: 0 }, weaponState: 'ready', canStartWeaponAction: true,
      settings: f.input.settings, dt: 1 / 60 };
    assert.equal(resolveGrifballCarrierDecision(input)!.kind, 'punch');
    f.input.tuning[gate] = false;
    assert.equal(resolveGrifballCarrierDecision(input)!.kind, 'move');
    assert.equal(resolveGrifballCarrierDecision(input)!.clash, undefined);
  });
