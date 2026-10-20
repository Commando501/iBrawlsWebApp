import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry } from './grifballSpaceGeometry';
import { planGrifballPass, type BallRecovery } from './aiGrifballPassing';
import { findPassDeflectionThreat } from './aiGrifballPassDeflection';
import { createSnapshotRouters } from './aiGrifballRunner';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';

const actor = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({
  id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: id === 'runner' ? 'ball' : 'hammer', phase: 'ready', speed: 5.2, reach: 3,
    blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 },
});
function fixture() {
  const bounds = { mapShape: 'rectangular' as const, arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 } };
  const config = defaultGrifballTactics(); config.defaults.passAgencyStrength = 1; config.defaults.stylesEnabled = false;
  const carrier = actor('runner', 'blue', -20), enemy = actor('enemy', 'red', -44, 15);
  const snapshot: GrifballTacticalSnapshot = {
    round: 1, playing: true, ball: { x: -20, z: 0 }, holderId: carrier.id, spacing: 4, tactics: config,
    geometry: buildGrifballSpaceGeometry({ ...bounds, objects: [] } as unknown as CustomMapData, 52),
    passing: { allowed: true, minSpeed: 9, maxSpeed: 26, chargeMax: 1.2, pickupRadius: 1.6, bounds },
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [carrier, actor('a', 'blue', -8), enemy],
  };
  const run = () => planGrifballPass(snapshot, carrier, resolveTeamTactics(config, carrier.team), createSnapshotRouters(snapshot));
  return { snapshot, config, carrier, enemy, run };
}
function deflectionFixture() {
  const f = fixture(); f.enemy.pos = { x: -13, z: 3 }; f.enemy.space!.speed = .1; f.enemy.space!.reach = 5;
  f.snapshot.passing!.hammerDeflection = true;
  return f;
}
const witnesses = {
  enforcer: [[5.949214968830347, -5.466282238718122], [7.074428305029869, 1.8300458933226764], [12.857741897460073, -4.375238246284425]],
  opportunist: [[5.2091600857675076, .6430451315827668], [-3.4041715785861015, -6.773411011788994], [27.814744387287647, -1.3843711791560054]],
  guardian: [[3.155353404581547, -2.7814556644298136], [-2.3208153657615185, .3517028675414622], [28.364721555262804, -17.260028296150267]],
} as const;

for (const style of ['enforcer', 'opportunist', 'guardian'] as const)
  test(`${style} chooses a different useful pass from the same field`, () => {
    const f = fixture(), [a, b, e] = witnesses[style];
    f.snapshot.players = [f.carrier, actor('a', 'blue', a[0], a[1]), actor('b', 'blue', b[0], b[1]), f.enemy];
    f.enemy.pos = { x: e[0], z: e[1] };
    const before = f.run(); f.config.botStyles.runner = style; const after = f.run();
    assert.ok(before.selected && after.selected); assert.notEqual(after.selected.receiverId, before.selected.receiverId);
    assert.ok(after.selected.viable); assert.equal(after.individuality!.style, style);
    if (style === 'enforcer') assert.ok(after.selected.progress > before.selected.progress);
    if (style === 'opportunist') assert.ok(after.selected.chargeSeconds < before.selected.chargeSeconds);
    if (style === 'guardian') {
      assert.ok(after.selected.individuality!.pickupMargin > before.selected.individuality!.pickupMargin);
      assert.ok(after.selected.individuality!.attackMargin > before.selected.individuality!.attackMargin);
    }
    assert.ok(after.candidates.every(c => Math.abs(c.individuality!.bonus) <= 3));
  });

test('a hammer closing on the flight keeps its observed momentum in the reach check', () => {
  const f = deflectionFixture(); f.enemy.pos = { x: 0, z: 2 };
  Object.assign(f.enemy.space!, { speed: .1, reach: .1, attackIn: 0 });
  const path: BallRecovery = { point: { x: 1, z: 0 }, seconds: .1, settled: true,
    path: [{ x: 0, y: 1, z: 0 }, { x: 1, y: 1, z: 0 }] };
  const routers = createSnapshotRouters(f.snapshot);
  assert.equal(findPassDeflectionThreat(f.snapshot, f.carrier, path, .2, routers), undefined);
  f.enemy.vel = { x: 0, z: -10 };
  assert.equal(findPassDeflectionThreat(f.snapshot, f.carrier, path, .2, routers)?.botId, 'enemy');
});

test('schema 9 preserves the other strengths and migrates passing off', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 9; delete old.defaults.passAgencyStrength;
  Object.assign(old.defaults, { agencyStrength: .8, runnerAgencyStrength: .7, defenseAgencyStrength: .6 });
  old.botStyles.runner = 'guardian'; old.teams.red = { defenseAgencyStrength: .3 };
  const migrated = validateGrifballTactics(old);
  assert.equal(migrated.schemaVersion, 12); assert.equal(migrated.defaults.passAgencyStrength, 0);
  assert.equal(migrated.defaults.agencyStrength, .8); assert.equal(migrated.defaults.runnerAgencyStrength, .7);
  assert.equal(migrated.defaults.defenseAgencyStrength, .6); assert.equal(migrated.botStyles.runner, 'guardian');
  assert.equal(resolveTeamTactics(migrated, 'red').defenseAgencyStrength, .3);
  for (const passAgencyStrength of [-.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...migrated, teams: { blue: { passAgencyStrength } } }));
  delete (migrated.defaults as any).passAgencyStrength; assert.throws(() => validateGrifballTactics(migrated));
});

for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const) {
  test(`${style} at zero strength preserves the team pass plan`, () => {
    const f = fixture(); f.config.defaults.passAgencyStrength = 0;
    const baseline = f.run(); f.config.botStyles.runner = style; assert.deepEqual(f.run(), baseline);
  });
  test(`${style} never revives a rejected landing or charging opportunity`, () => {
    const f = fixture(); f.config.botStyles.runner = style; f.enemy.pos = { x: 2, z: 0 };
    const active = f.run(); f.config.defaults.passAgencyStrength = 0; const base = f.run();
    assert.deepEqual(active.candidates.map(c => c.viable), base.candidates.map(c => c.viable));
    assert.ok(active.candidates.some(c => !c.viable));
    assert.ok(active.candidates.filter(c => !c.viable).every(c => c.individuality?.bonus === 0));
  });
  test(`${style} cannot prefer a pass through a reachable hostile hammer blast`, () => {
    const f = deflectionFixture(); f.config.botStyles.runner = style; const pass = f.run();
    assert.equal(pass.selected, null); assert.ok(pass.candidates.some(c => c.deflection));
    assert.ok(pass.candidates.filter(c => c.deflection).every(c => !c.viable && c.individuality?.bonus === 0));
  });
}

test('flight danger rejects a pass whose eventual landing is otherwise uncontested', () => {
  const f = deflectionFixture(); f.snapshot.passing!.hammerDeflection = false; const before = f.run();
  assert.ok(before.selected); assert.ok(before.selected.opponentETA > 100);
  f.snapshot.passing!.hammerDeflection = true; const after = f.run();
  const candidate = after.candidates.find(c => c.speed === before.selected!.speed)!;
  assert.ok(candidate.deflection); assert.equal(candidate.viable, false);
  assert.ok(candidate.deflection.attackIn <= candidate.deflection.ballIn);
  assert.match(candidate.reason, /deflect/);
});

for (const blocked of ['recovering', 'airborne', 'sword', 'wall', 'disabled'] as const)
  test(`no invented hammer deflection when ${blocked}`, () => {
    const f = deflectionFixture();
    if (blocked === 'recovering') { f.enemy.space!.phase = 'recovering'; f.enemy.space!.attackIn = 100; }
    if (blocked === 'airborne') { f.enemy.height = 10; f.enemy.space!.mobileIn = 100; }
    if (blocked === 'sword') f.enemy.space!.weapon = 'sword';
    if (blocked === 'disabled') f.snapshot.passing!.hammerDeflection = false;
    if (blocked === 'wall') f.snapshot.geometry = buildGrifballSpaceGeometry({ ...f.snapshot.passing!.bounds,
      objects: [{ type: 'box', position: { x: -13, y: 2, z: 3 }, scale: { x: 2, y: 4, z: 2 }, isCollidable: true }] } as CustomMapData, 52);
    const pass = f.run(); assert.ok(pass.selected); assert.ok(pass.candidates.every(c => !c.deflection));
  });

test('swept flight checks catch a blast between the path samples, but ignore a high arc', () => {
  const f = deflectionFixture(); f.enemy.pos = { x: 0, z: 0 }; f.enemy.space!.reach = .1; f.enemy.space!.attackIn = 0;
  const recovery: BallRecovery = { point: { x: 10, z: 0 }, seconds: .1, settled: true,
    path: [{ x: -10, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }] };
  const run = () => findPassDeflectionThreat(f.snapshot, f.carrier, recovery, 0, createSnapshotRouters(f.snapshot));
  assert.ok(run()); recovery.path.forEach(p => { p.y = 100; }); assert.equal(run(), undefined);
});

test('charging exposes the runner to a lethal sword hit; an active punch cannot also throw', () => {
  const f = fixture(); f.enemy.pos = { x: -15, z: 0 }; f.enemy.space!.weapon = 'sword'; f.enemy.space!.attackIn = .01;
  const pass = f.run(); assert.ok(pass.candidates.some(c => /lethal sword/.test(c.reason)));
  assert.ok(pass.candidates.filter(c => /lethal sword/.test(c.reason)).every(c => !c.viable));
  for (const phase of ['swing_up', 'swing_down', 'recovering']) {
    f.carrier.space!.phase = phase; assert.equal(f.run().selected, null); assert.equal(f.run().individuality, undefined);
  }
});

for (const disabled of ['enabled', 'spaceEnabled', 'passingEnabled'] as const)
  test(`passing individuality respects disabled ${disabled}`, () => {
    const f = fixture(); f.config.defaults[disabled] = false; f.config.botStyles.runner = 'enforcer';
    assert.equal(f.run().selected, null); assert.equal(f.run().individuality, undefined);
  });

test('scoring run, unavailable carrier, observed players and throwing rules remain authoritative', () => {
  const f = fixture(); f.carrier.pos.x = 45; assert.equal(f.run().selected, null);
  f.carrier.pos.x = -20; f.carrier.height = 2; assert.equal(f.run().selected, null);
  f.carrier.height = 0; f.carrier.scripted = false; assert.equal(f.run().selected, null);
  f.carrier.scripted = true; f.snapshot.players[1].scripted = false; assert.equal(f.run().selected, null);
  f.snapshot.players[1].scripted = true; f.snapshot.passing!.allowed = false; assert.equal(f.run().selected, null);
});

test('team overrides, mirrored positions and roster order retain passing preferences', () => {
  const f = fixture(); f.config.botStyles.runner = 'guardian';
  f.config.teams.blue = { passAgencyStrength: .6 }; const before = f.run();
  assert.equal(before.individuality!.strength, .6); f.config.teams.red = { passAgencyStrength: .6 };
  for (const p of f.snapshot.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.pos.z *= -1; }
  f.snapshot.players.reverse(); const after = f.run();
  assert.equal(after.selected!.receiverId, before.selected!.receiverId); assert.equal(after.selected!.speed, before.selected!.speed);
  assert.ok(Math.abs(after.selected!.point.x + before.selected!.point.x) < 1e-8);
  f.config.teams.red.passAgencyStrength = 0; assert.equal(f.run().individuality, undefined);
});

test('checkpoint restores a committed pass and a newly visible deflection threat cancels it', () => {
  const f = deflectionFixture(); f.snapshot.passing!.hammerDeflection = false;
  const state = createGrifballTeamPlanState(); const update = () => updateGrifballTeamPlan(state, structuredClone(f.snapshot), .2);
  update(); const selected = state.passPlans.blue.selected!;
  state.passCharge = { carrierId: f.carrier.id, receiverId: selected.receiverId, speed: selected.speed, elapsed: .1 };
  f.config.botStyles.runner = 'opportunist'; update();
  assert.equal(state.passPlans.blue.selected!.speed, selected.speed, 'a still-safe charge keeps its commitment');
  const restored = structuredClone(state); f.snapshot.passing!.hammerDeflection = true;
  update(); updateGrifballTeamPlan(restored, structuredClone(f.snapshot), .2);
  assert.deepEqual(state, restored); assert.equal(state.passPlans.blue.selected, null);
  assert.ok([...state.assignments.values()].every(a => !a.receive), 'do not publish a receiver for the rejected pass');
});
