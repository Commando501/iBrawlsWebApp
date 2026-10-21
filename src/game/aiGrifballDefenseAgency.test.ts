import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics, resolveTeamTactics, validateGrifballTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry, createSpaceRouter } from './grifballSpaceGeometry';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { applyGrifballDefense } from './aiGrifballDefense';

const actor = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({
  id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5.2, reach: 3, blastRadius: 2, attackIn: .3, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 },
});
function fixture() {
  const config = defaultGrifballTactics();
  Object.assign(config.defaults, { defenseAgencyStrength: 1, stylesEnabled: false, tankingEnabled: false, passingEnabled: false });
  const carrier = actor('runner', 'red', 0); carrier.vel.x = -5.2; carrier.space!.weapon = 'ball'; carrier.space!.reach = 1.8;
  const snapshot: GrifballTacticalSnapshot = {
    round: 1, playing: true, holderId: carrier.id, ball: { x: 0, z: 0 }, spacing: 4, tactics: config,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
      arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    players: [actor('a', 'blue', -4, 2), actor('back', 'blue', -16), actor('c', 'blue', -4, -2), carrier, actor('escort', 'red', 2, -6)],
  };
  const state = createGrifballTeamPlanState();
  const orders = () => [...state.assignments.values()].filter(a => a.team === 'blue');
  const run = (dt = .2) => { updateGrifballTeamPlan(state, structuredClone(snapshot), dt); return orders(); };
  return { config, carrier, snapshot, state, orders, run };
}
// Compare decisions, excluding tuning/diagnostic payloads which intentionally expose the new setting.
const decisions = (orders: ReturnType<ReturnType<typeof fixture>['run']>) => orders.map(a => ({
  id: a.botId, role: a.role, destination: a.destination, reason: a.reason, tanking: a.tanking,
  defense: a.defense && { ...a.defense, individuality: undefined },
})).sort((a, b) => a.id.localeCompare(b.id));
const primary = (f: ReturnType<typeof fixture>) => f.orders().find(a => a.defense?.mode === 'intercept')!;

test('schemas 1–8 migrate defense off and retain existing strengths, styles and overrides', () => {
  for (let version = 1; version <= 8; version++) {
    const old: any = defaultGrifballTactics(); old.schemaVersion = version; delete old.defaults.defenseAgencyStrength;
    old.defaults.agencyStrength = .8; old.defaults.runnerAgencyStrength = .7;
    old.botStyles.a = 'guardian'; old.teams.red = { runnerAgencyStrength: .4 };
    const config = validateGrifballTactics(old);
    assert.equal(config.schemaVersion, 30); assert.equal(config.defaults.defenseAgencyStrength, 0);
    assert.equal(config.defaults.agencyStrength, .8); assert.equal(config.defaults.runnerAgencyStrength, .7);
    assert.equal(config.botStyles.a, 'guardian'); assert.equal(resolveTeamTactics(config, 'red').runnerAgencyStrength, .4);
  }
  const config = defaultGrifballTactics();
  for (const defenseAgencyStrength of [-.1, 1.1, NaN, '1'])
    assert.throws(() => validateGrifballTactics({ ...config, teams: { blue: { defenseAgencyStrength } } }));
  delete (config.defaults as any).defenseAgencyStrength;
  assert.throws(() => validateGrifballTactics(config));
});

for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const) {
  test(`zero defense strength preserves every team order for ${style}`, () => {
    const off = fixture(), base = fixture(); off.config.defaults.defenseAgencyStrength = base.config.defaults.defenseAgencyStrength = 0;
    for (const p of off.snapshot.players) off.config.botStyles[p.id] = style;
    assert.deepEqual(off.run(), base.run());
  });
  for (const guard of ['emergency', 'outnumbered', 'turnover', 'low-pressure', 'reinforcement', 'solo', 'loose-ball', 'friendly-possession'] as const)
    test(`${style} preserves ${guard} decisions`, () => {
      const f = fixture();
      f.config.botStyles = { a: 'guardian', c: style, back: 'enforcer' };
      if (guard === 'emergency') f.snapshot.goals.blue = { x: -7, z: 0 };
      if (guard === 'outnumbered') f.snapshot.players.push(actor('e2', 'red', 4, 10), actor('e3', 'red', 4, -10));
      if (guard === 'low-pressure') f.config.defaults.defensePressure = .3;
      if (guard === 'reinforcement') { f.snapshot.players.push(actor('e2', 'red', 4, 10)); f.snapshot.respawns = [{ id: 'returning', team: 'blue', pos: { x: -2, z: 0 }, speed: 5, seconds: .5 }]; }
      if (guard === 'solo') f.snapshot.players = f.snapshot.players.filter(p => p.team !== 'blue' || p.id === 'back');
      if (guard === 'loose-ball') f.snapshot.holderId = null;
      if (guard === 'friendly-possession') f.carrier.team = 'blue';
      if (guard === 'turnover') {
        f.snapshot.holderId = 'a'; f.run(); f.snapshot.holderId = 'runner';
      }
      const baseline = structuredClone(f.snapshot); baseline.tactics!.defaults.defenseAgencyStrength = 0;
      const baseState = structuredClone(f.state); updateGrifballTeamPlan(baseState, baseline, .2);
      const expected = [...baseState.assignments.values()].filter(a => a.team === 'blue');
      assert.deepEqual(decisions(f.run()), decisions(expected));
      if (guard === 'turnover') assert.ok(f.orders().every(a => a.defense?.transitioning));
    });
}

test('Enforcer takes a timely cut while Guardian covers the escort, without moving the safety', () => {
  const f = fixture(); f.config.botStyles = { a: 'guardian', c: 'enforcer', back: 'enforcer' };
  const baseline = fixture(); baseline.run(); f.run();
  assert.equal(primary(baseline).botId, 'a'); assert.equal(primary(f).botId, 'c');
  assert.equal(f.orders().find(a => a.botId === 'a')!.defense!.mode, 'mark');
  assert.deepEqual(decisions(f.orders().filter(a => a.botId === 'back')), decisions(baseline.orders().filter(a => a.botId === 'back')));
  assert.ok(primary(f).defense!.individuality!.pressureCandidates!.filter(c => c.eligible).length > 1);
});

test('Opportunist pressure requires a reachable recovery window and releases when it closes', () => {
  const f = fixture(); f.config.botStyles = { a: 'enforcer', c: 'opportunist' };
  f.run(); assert.equal(primary(f).botId, 'a');
  f.carrier.space!.phase = 'recovering'; f.carrier.space!.attackIn = 1.3;
  f.run(); assert.equal(primary(f).botId, 'c');
  const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
  assert.equal(candidate.recoveryOpening, true); assert.equal(candidate.bonus, .25);
  f.carrier.space!.attackIn = .4;
  f.run(); assert.equal(primary(f).botId, 'a');
  assert.equal(primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!.recoveryOpening, false);
});

test('Opportunist cannot claim a window that closes before the runner reaches the cut', () => {
  const f = fixture(); f.config.botStyles = { a: 'enforcer', c: 'opportunist' };
  f.config.defaults.defenseLookahead = 3;
  for (const p of f.snapshot.players.filter(p => p.team === 'blue')) p.space!.speed = 100;
  f.snapshot.players.find(p => p.id === 'back')!.pos.x = -40;
  Object.assign(f.carrier.space!, { speed: 24, phase: 'recovering', attackIn: .45 }); f.carrier.vel.x = -24;
  f.run(); assert.equal(primary(f).botId, 'a');
  const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
  assert.equal(candidate.eligible, true, 'the cut itself remains timely');
  assert.equal(candidate.recoveryOpening, false, 'the runner is ready by the time it reaches that cut');
});

for (const delay of ['later-cut', 'airborne', 'reload', 'blocked'] as const)
  test(`Enforcer cannot replace the only timely interceptor with a ${delay} defender`, () => {
    const f = fixture(); f.config.botStyles = { a: 'guardian', c: 'enforcer' };
    const c = f.snapshot.players.find(p => p.id === 'c')!;
    if (delay === 'later-cut') c.pos = { x: -6, z: -5 };
    if (delay === 'airborne') c.space!.mobileIn = 2;
    if (delay === 'reload') c.space!.attackIn = 2;
    if (delay === 'blocked') {
      c.pos = { x: 20, z: 10 };
      f.snapshot.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 },
        objects: [{ type: 'box', position: { x: 20, y: 2, z: 10 }, scale: { x: 4, y: 4, z: 4 }, isCollidable: true }] } as CustomMapData, 52);
    }
    f.run(); assert.equal(primary(f).botId, 'a');
    const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
    assert.equal(candidate.eligible, false); assert.equal(candidate.bonus, 0);
  });

test('Guardian takes a nearby escort mark but cannot displace much closer coverage', () => {
  const f = fixture();
  f.snapshot.players.find(p => p.id === 'a')!.pos = { x: -5, z: -7 };
  const c = f.snapshot.players.find(p => p.id === 'c')!; c.pos = { x: -5, z: -3 };
  f.snapshot.players.push(actor('pressure', 'blue', -1));
  f.run(); assert.equal(f.orders().find(a => a.defense?.mode === 'mark')!.botId, 'a');
  f.config.botStyles.c = 'guardian'; f.state.assignments.clear(); f.run();
  assert.equal(f.orders().find(a => a.defense?.mode === 'mark')!.botId, 'c');
  assert.equal(f.orders().find(a => a.botId === 'c')!.defense!.individuality!.marking!.bonus, 2);
  c.pos = { x: -20, z: 15 }; f.state.assignments.clear(); f.run();
  assert.equal(f.orders().find(a => a.defense?.mode === 'mark')!.botId, 'a');
});

test('a preferred interceptor must still beat the scoring deadline outside the emergency range', () => {
  const f = fixture(); f.config.botStyles = { a: 'guardian', c: 'enforcer' };
  f.snapshot.goals.blue = { x: -9, z: 0 }; f.carrier.space!.speed = 24;
  f.snapshot.players.find(p => p.id === 'back')!.pos.x = -9;
  f.snapshot.players.find(p => p.id === 'c')!.pos.z = -2.1;
  f.run(); assert.equal(primary(f).botId, 'a');
  const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
  assert.equal(candidate.eligible, false); assert.match(candidate.reason, /scoring deadline/);
});

test('a same-cut preference cannot surrender a substantial readiness advantage', () => {
  const f = fixture(); f.config.botStyles = { a: 'guardian', c: 'enforcer' }; f.config.defaults.defenseLookahead = 3;
  f.snapshot.players.find(p => p.id === 'a')!.space!.attackIn = .01;
  f.snapshot.players.find(p => p.id === 'c')!.space!.attackIn = .5;
  f.run(); assert.equal(primary(f).botId, 'a');
  const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
  assert.equal(candidate.eligible, false); assert.match(candidate.reason, /0.25 s/);
});

test('Opportunist marking drops its recovery discount as the target becomes ready', () => {
  const f = fixture(); f.config.botStyles.c = 'opportunist';
  f.snapshot.players.find(p => p.id === 'a')!.pos = { x: -5, z: -7 };
  f.snapshot.players.find(p => p.id === 'c')!.pos = { x: -5, z: -3 };
  f.snapshot.players.push(actor('pressure', 'blue', -1));
  const escort = f.snapshot.players.find(p => p.id === 'escort')!;
  escort.space!.phase = 'recovering'; escort.space!.attackIn = 3;
  f.run(); const marker = f.orders().find(a => a.defense?.mode === 'mark')!;
  assert.equal(marker.botId, 'c'); assert.equal(marker.defense!.individuality!.marking!.bonus, 1.5);
  escort.space!.phase = 'ready'; escort.space!.attackIn = .3; f.run();
  assert.equal(f.orders().find(a => a.defense?.mode === 'mark')!.defense!.individuality!.marking!.bonus, 0);
});

test('Opportunist marking includes travel to its coverage position in the recovery deadline', () => {
  const f = fixture(); f.config.botStyles.c = 'opportunist';
  f.snapshot.players.find(p => p.id === 'a')!.pos = { x: -7.1, z: -5.4 };
  f.snapshot.players.find(p => p.id === 'c')!.pos = { x: 2, z: -8 };
  f.snapshot.players.push(actor('pressure', 'blue', -1));
  const escort = f.snapshot.players.find(p => p.id === 'escort')!;
  escort.space!.phase = 'recovering'; escort.space!.attackIn = .6;
  f.run();
  assert.equal(f.orders().find(a => a.defense?.mode === 'mark')!.botId, 'a',
    'a nearby current target is insufficient when the assigned goal-side approach outlives its recovery');
});

test('Opportunist cannot claim a recovery window through a wall', () => {
  const f = fixture(); f.config.botStyles.c = 'opportunist'; f.carrier.space!.phase = 'recovering'; f.carrier.space!.attackIn = 10;
  f.snapshot.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 },
    objects: [{ type: 'box', position: { x: -2, y: 2, z: -1 }, scale: { x: .5, y: 4, z: 1 }, isCollidable: true }] } as CustomMapData, 52);
  f.run();
  const candidate = primary(f).defense!.individuality!.pressureCandidates!.find(c => c.botId === 'c')!;
  assert.equal(candidate.recoveryOpening, false); assert.equal(candidate.bonus, 0);
});

test('live style edits and team overrides take effect on the next update without waiting for refresh', () => {
  const f = fixture(); f.run(); assert.equal(primary(f).botId, 'a');
  f.config.botStyles.c = 'enforcer'; f.run(0); assert.equal(primary(f).botId, 'c');
  f.config.teams.blue = { defenseAgencyStrength: 0 }; f.run(0); assert.equal(primary(f).botId, 'a');
  assert.ok(f.orders().every(a => !a.defense?.individuality));
  f.config.teams.blue = { defenseAgencyStrength: .6 }; f.run(0);
  assert.equal(primary(f).defense!.individuality!.strength, .6);
});

for (const disabled of ['enabled', 'spaceEnabled', 'defenseEnabled'] as const)
  test(`defense individuality respects disabled ${disabled}`, () => {
    const f = fixture(); f.config.defaults[disabled] = false; f.config.botStyles.c = 'enforcer';
    const baseline = structuredClone(f.snapshot); baseline.tactics!.defaults.defenseAgencyStrength = 0;
    const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, baseline, .2);
    assert.deepEqual(decisions(f.run()), decisions([...state.assignments.values()].filter(a => a.team === 'blue')));
    assert.ok(f.orders().every(a => !a.defense?.individuality));
  });

test('observed human and neural teammates never receive individual defensive orders', () => {
  const f = fixture(); f.snapshot.players.find(p => p.id === 'c')!.scripted = false; f.config.botStyles.c = 'enforcer';
  f.run(); assert.equal(f.state.assignments.has('c'), false); assert.equal(primary(f).botId, 'a');
});

test('a defensive checkpoint reproduces decisions and recovery-window expiry', () => {
  const f = fixture(); f.config.botStyles = { a: 'enforcer', c: 'opportunist' };
  f.carrier.space!.phase = 'recovering'; f.carrier.space!.attackIn = 1.3; f.run();
  const restored = structuredClone(f.state);
  f.carrier.space!.attackIn = .4; f.run(); updateGrifballTeamPlan(restored, structuredClone(f.snapshot), .2);
  assert.deepEqual(f.state, restored);
});

test('mirroring teams and reversing roster order retain individual jobs', () => {
  const f = fixture(); f.config.botStyles = { a: 'guardian', c: 'enforcer' }; const expected = f.run();
  const mirrored = structuredClone(f.snapshot);
  for (const p of mirrored.players) { p.team = p.team === 'blue' ? 'red' : 'blue'; p.pos.x *= -1; p.pos.z *= -1; p.vel.x *= -1; p.vel.z *= -1; }
  mirrored.players.reverse(); const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, mirrored, .2);
  for (const a of expected) {
    const b = state.assignments.get(a.botId)!;
    assert.equal(b.defense?.mode, a.defense?.mode); assert.equal(b.defense?.targetId, a.defense?.targetId);
    assert.ok(Math.abs(b.destination.x + a.destination.x) < 1e-8); assert.ok(Math.abs(b.destination.z + a.destination.z) < 1e-8);
  }
});

test('style preferences cannot bypass an earned tanking pair', () => {
  const f = fixture(); const orders = f.run();
  const tank = orders.find(a => a.botId === 'a')!, partner = orders.find(a => a.botId === 'c')!;
  f.snapshot.players.find(p => p.id === 'a')!.pos = { x: -2, z: 0 };
  f.carrier.space!.phase = 'recovering'; f.carrier.space!.attackIn = 2;
  tank.tanking = { mode: 'engage', attack: true, targetId: 'runner', partnerId: 'c', recoveryId: 'back', doubleCommit: true, reason: 'earned', candidates: [] };
  partner.tanking = { ...tank.tanking, mode: 'punish', partnerId: 'a' };
  const routers = new Map(f.snapshot.players.map(p => [p.id, createSpaceRouter(f.snapshot.geometry!, p.pos)]));
  f.config.botStyles = { back: 'enforcer', a: 'guardian', c: 'guardian' };
  applyGrifballDefense(f.snapshot, orders, f.config.defaults, routers, new Map(), 0);
  assert.equal(tank.tanking?.mode, 'engage'); assert.equal(partner.tanking?.mode, 'punish');
  assert.equal(orders.find(a => a.botId === 'back')!.defense!.mode, 'last-defender');
});
