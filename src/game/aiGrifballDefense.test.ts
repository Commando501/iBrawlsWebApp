import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { defaultGrifballTactics } from './grifballTacticsConfig';
import { buildGrifballSpaceGeometry, createSpaceRouter, fieldDistance, isSpacePointOpen } from './grifballSpaceGeometry';
import { pointAlongRunnerRoute } from './aiGrifballRunner';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, selectGrifballAssignmentThreat, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import type { GrifballAssignment } from './aiGrifballTeamPlan';
import { observeGrifballSpace } from './aiGrifballSpace';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { createInitialBall } from './grifballBall';
import { applyGrifballDefense } from './aiGrifballDefense';

const p = (id: string, team: string, x: number, z = 0): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true,
  space: { weapon: 'hammer', phase: 'ready', speed: 5.2, reach: 3, blastRadius: 2, attackIn: 0.3, lungeReach: 0, lungeSpeed: 0, mobileIn: 0 } });
function scene(): GrifballTacticalSnapshot {
  return { round: 1, playing: true, ball: { x: 0, z: 0 }, holderId: 'runner', spacing: 4, tactics: defaultGrifballTactics(),
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } },
    players: [p('a', 'blue', -8, 2), p('b', 'blue', -20), p('c', 'blue', -6, -6), p('runner', 'red', 0), p('escort', 'red', 2, -6)] };
}
const run = (s: GrifballTacticalSnapshot) => { const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2); return state; };
const blue = (state: ReturnType<typeof run>) => [...state.assignments.values()].filter(a => a.team === 'blue');

function looseScreenScene(enemyX = 1): GrifballTacticalSnapshot {
  const s = scene(); s.holderId = null; s.tactics!.defaults.stylesEnabled = false;
  s.players = [p('retriever', 'blue', 0), p('left', 'blue', 3, -7), p('right', 'blue', 3, 7),
    p('back', 'blue', -10), p('enemy', 'red', enemyX)];
  for (const actor of s.players) actor.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'hammer', actor.id === 'enemy' ? 'recovering' : 'ready');
  return s;
}

function carrierScreenScene(): GrifballTacticalSnapshot {
  const s = looseScreenScene(); s.holderId = 'enemy';
  const carrier = s.players.find(p => p.id === 'enemy')!;
  carrier.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'ball', 'recovering');
  carrier.vel.x = -carrier.space.speed;
  return s;
}

for (const mirror of [false, true]) for (const reverse of [false, true])
  test(`carrier defense preserves earned tanking with timely goal-side coverage: ${mirror}/${reverse}`, () => {
    const s = carrierScreenScene(), team = mirror ? 'red' : 'blue';
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1; actor.vel.x *= -1;
    }
    if (reverse) s.players.reverse();
    const control = structuredClone(s); control.tactics!.defaults.defenseEnabled = false;
    const earned = [...run(control).assignments.values()].filter(a => a.team === team);
    const primary = earned.find(a => a.tanking?.mode === 'engage' && a.tanking.attack)!;
    assert.ok(primary); assert.equal(primary.tanking!.targetId, 'enemy');
    const group = earned.filter(a => a === primary || a.tanking?.mode === 'punish' && a.tanking.partnerId === primary.botId);
    const actual = [...run(s).assignments.values()].filter(a => a.team === team);
    for (const expected of group) {
      const order = actual.find(a => a.botId === expected.botId)!;
      assert.deepEqual(order.tanking, expected.tanking);
      assert.deepEqual(order.destination, expected.destination);
      assert.equal(order.defense, undefined);
    }
    const safety = actual.find(a => a.defense?.mode === 'last-defender')!;
    assert.ok(safety && !group.some(a => a.botId === safety.botId));
    const defender = s.players.find(p => p.id === safety.botId)!, carrier = s.players.find(p => p.id === 'enemy')!;
    const goal = s.goals[team]!;
    assert.ok((defender.pos.x - carrier.pos.x) * (goal.x - carrier.pos.x) +
      (defender.pos.z - carrier.pos.z) * (goal.z - carrier.pos.z) > 0);
    assert.ok(fieldDistance(defender.pos, safety.destination) / defender.space!.speed <=
      fieldDistance(carrier.pos, safety.destination) / carrier.space!.speed);
    assert.ok(actual.every(a => a.defense?.mode !== 'intercept'), 'do not add an uncoordinated third carrier attacker');
  });

test('a carrier recovery commitment returns to interception when the opening closes', () => {
  const s = carrierScreenScene(), state = run(s);
  assert.ok(blue(state).some(a => a.tanking?.mode === 'engage' && a.tanking.attack));
  const carrier = s.players.find(p => p.id === 'enemy')!;
  carrier.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, 'ball', 'ready');
  updateGrifballTeamPlan(state, s, 1);
  const orders = blue(state);
  assert.ok(orders.every(a => !a.tanking), 'a remembered commitment cannot outlive the visible opening');
  assert.equal(orders.filter(a => a.defense?.mode === 'intercept').length, 1);
  assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
});

test('a safety backing an earned carrier attack is not treated as a lone defender', () => {
  const s = carrierScreenScene(); s.tactics!.defaults.stylesEnabled = false;
  s.tactics!.defaults.defenseLookahead = 1.5;
  s.players.find(p => p.id === 'enemy')!.space!.attackIn = 2;
  const control = structuredClone(s); control.tactics!.defaults.defenseEnabled = false;
  const earned = blue(run(control)), primary = earned.find(a => a.tanking?.mode === 'engage' && a.tanking.attack)!;
  assert.ok(primary, 'fixture has an earned primary attack');
  const group = earned.filter(a => a === primary || a.tanking?.mode === 'punish' && a.tanking.partnerId === primary.botId);
  assert.equal(group.length, 2, 'fixture has a coordinated pair');
  s.players = s.players.filter(p => p.team !== 'blue' || p.id === 'back' || group.some(a => a.botId === p.id));
  assert.equal(s.players.filter(p => p.team === 'blue').length, 3, 'pair plus one safety');
  // Keep the earned pair while testing the defense layer's remaining coverage.
  const orders = earned.filter(a => a.botId === 'back' || group.includes(a));
  const routers = new Map(s.players.map(p => [p.id, createSpaceRouter(s.geometry!, p.pos)]));
  applyGrifballDefense(s, orders, s.tactics!.defaults, routers, new Map(), 0);
  const safety = orders.find(a => a.defense?.mode === 'last-defender')!;
  assert.equal(orders.filter(a => a.tanking).length, 2, 'retain the earned pair');
  assert.equal(safety.botId, 'back');
  assert.doesNotMatch(safety.reason, /hold the goal-side cut/);
});

for (const cause of ['airborne-backup', 'reloading-backup', 'combined-delay', 'late-backup', 'sealed-backup', 'containment', 'emergency', 'ready-carrier', 'closing-window', 'turnover'] as const)
  test(`carrier tanking yields to defense when coverage is unavailable: ${cause}`, () => {
    const s = carrierScreenScene();
    const control = structuredClone(s); control.tactics!.defaults.defenseEnabled = false;
    const earned = blue(run(control));
    const primary = earned.find(a => a.tanking?.mode === 'engage' && a.tanking.attack)!;
    assert.ok(primary, 'admission control must start with an earned engagement');
    const group = earned.filter(a => a === primary || a.tanking?.mode === 'punish' && a.tanking.partnerId === primary.botId);
    const backups = s.players.filter(p => p.team === 'blue' && !group.some(a => a.botId === p.id));
    assert.ok(backups.length > 0);
    const safety = blue(run(s)).find(a => a.defense?.mode === 'last-defender')!;
    const carrier = s.players.find(p => p.id === 'enemy')!;
    const carrierETA = fieldDistance(carrier.pos, safety.destination) / carrier.space!.speed;
    if (cause === 'containment') s.tactics!.defaults.defensePressure = .2;
    if (cause === 'emergency') s.players.find(p => p.id === 'enemy')!.pos.x = -44;
    if (cause === 'ready-carrier') s.players.find(p => p.id === 'enemy')!.space!.phase = 'ready';
    if (cause === 'closing-window') s.players.find(p => p.id === 'enemy')!.space!.attackIn = .01;
    if (cause === 'sealed-backup') s.geometry!.blockers = [{ kind: 'box', x: -6, z: 0, hx: .5, hz: 30 }];
    for (const actor of backups) {
      if (cause === 'airborne-backup') actor.space!.mobileIn = 20;
      if (cause === 'reloading-backup') actor.space!.attackIn = 20;
      if (cause === 'combined-delay') {
        actor.space!.mobileIn = carrierETA * .6; actor.space!.attackIn = carrierETA * .6;
      }
      if (cause === 'late-backup') actor.pos.x = 25;
    }
    const routers = new Map(s.players.map(p => [p.id, createSpaceRouter(s.geometry!, p.pos)]));
    applyGrifballDefense(s, earned, s.tactics!.defaults, routers, new Map(), cause === 'turnover' ? 1 : 0);
    assert.ok(earned.every(a => !a.tanking));
    assert.equal(earned.filter(a => a.defense?.mode === 'last-defender').length, 1);
  });

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const enemyX of [1, 2, 4])
  test(`loose-ball defense preserves earned screening with a separate safety: ${mirror}/${reverse}/${enemyX}`, () => {
    const s = looseScreenScene(enemyX), team = mirror ? 'red' : 'blue';
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1;
    }
    if (reverse) s.players.reverse();
    const control = structuredClone(s); control.tactics!.defaults.defenseEnabled = false;
    const earned = [...run(control).assignments.values()].filter(a => a.team === team);
    const primary = earned.find(a => a.tanking?.mode === 'engage' && a.tanking.attack)!;
    assert.ok(primary, 'control must earn an engagement through the tanking module');
    const screen = earned.filter(a => a === primary || a.tanking?.mode === 'punish' && a.tanking.partnerId === primary.botId);
    assert.equal(screen.length, enemyX === 4 ? 1 : 2);
    assert.equal(primary.tanking!.doubleCommit, enemyX === 1);
    const actual = [...run(s).assignments.values()].filter(a => a.team === team);
    for (const expected of screen) {
      const order = actual.find(a => a.botId === expected.botId)!;
      assert.deepEqual(order.tanking, expected.tanking, 'defense must not erase an earned screen or its waiting partner');
      assert.deepEqual(order.destination, expected.destination);
      assert.equal(order.defense, undefined);
    }
    assert.equal(actual.filter(a => a.role === 'retriever').length, 1);
    const safety = actual.filter(a => a.defense?.mode === 'last-defender');
    assert.equal(safety.length, 1); assert.equal(safety[0].botId, 'back');
    assert.ok(!screen.some(a => a.botId === safety[0].botId));
  });

for (const cause of ['no-backup', 'sealed-backup', 'containment', 'outnumbered', 'turnover', 'thrown'] as const)
  test(`loose-ball screening keeps defensive precedence for ${cause}`, () => {
    const s = looseScreenScene();
    if (cause === 'no-backup') s.players = s.players.filter(a => a.id !== 'back');
    if (cause === 'sealed-backup') {
      s.players.find(a => a.id === 'back')!.pos = { x: 10, z: 20 };
      s.geometry = { ...s.geometry!, key: 'sealed-screen-backup', blockers: [{ kind: 'box', x: -5, z: 0, hx: .5, hz: 30 }] };
    }
    if (cause === 'thrown') s.ballPhysics = { ...createInitialBall({ x: 0, y: .35, z: 0 }), state: 'thrown', vel: { x: 5, y: 2, z: 0 } };
    if (cause === 'containment') s.tactics!.defaults.defensePressure = .2;
    if (cause === 'outnumbered') for (let i = 0; i < 4; i++) s.players.push(p(`far-${i}`, 'red', 35, i * 3));
    const state = run(cause === 'turnover' ? { ...s, holderId: 'retriever' } : s);
    if (cause === 'turnover') updateGrifballTeamPlan(state, s, .01);
    const orders = blue(state);
    assert.ok(orders.every(a => !a.tanking));
    assert.equal(orders.filter(a => a.role === 'retriever').length, 1);
    assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
  });

for (const mirror of [false, true]) for (const reverse of [false, true])
  for (const cause of ['pressure', 'outnumbered', 'reinforcement', 'turnover'] as const)
    test(`containment keeps a separate goal-side safety: ${mirror}/${reverse}/${cause}`, () => {
      const s = scene(), team = mirror ? 'red' : 'blue';
      s.tactics!.defaults.stylesEnabled = false;
      // Long hostile reach made both roles choose the same goal-side point in
      // the Stadium seed-102 opening trace (candidate, mirrored, tick 832).
      s.players.find(a => a.id === 'escort')!.space!.lungeReach = 15;
      if (cause === 'pressure') s.tactics!.defaults.defensePressure = .2;
      if (cause === 'outnumbered' || cause === 'reinforcement') s.players.push(p('extra', 'red', 5));
      if (cause === 'outnumbered') s.players.push(p('extra2', 'red', 6));
      if (cause === 'reinforcement') s.respawns = [{ id: 'returning', team: 'blue', seconds: .5, pos: { x: -2, z: 0 }, speed: 5.2 }];
      if (mirror) {
        for (const actor of s.players) { actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1; }
        for (const actor of s.respawns ?? []) { actor.team = 'red'; actor.pos.x *= -1; }
      }
      if (reverse) s.players.reverse();
      const state = run(cause === 'turnover' ? { ...s, holderId: 'a' } : s);
      if (cause === 'turnover') updateGrifballTeamPlan(state, s, .01);
      const orders = [...state.assignments.values()].filter(a => a.team === team);
      const safety = orders.find(a => a.defense?.mode === 'last-defender')!;
      const contain = orders.find(a => a.defense?.mode === 'contain')!;
      assert.ok(safety && contain);
      const goal = s.goals[team]!;
      assert.ok(fieldDistance(safety.destination, goal) < fieldDistance(contain.destination, goal), 'safety stays behind containment');
      assert.ok(fieldDistance(safety.destination, contain.destination) >= s.tactics!.defaults.lateralSpacing - 1e-8, 'distinct defensive layers');
      assert.ok(isSpacePointOpen(s.geometry!, safety.destination));
      assert.equal(orders.filter(a => a.role === 'safety').length, 1);
    });

for (const scenario of ['lone', 'emergency', 'pressure', 'loose'] as const)
  test(`containment spacing preserves existing ${scenario} coverage`, () => {
    const s = scene();
    s.tactics!.defaults.stylesEnabled = false;
    s.tactics!.defaults.defensePressure = scenario === 'pressure' ? 1 : .2;
    s.players.find(a => a.id === 'escort')!.space!.lungeReach = 15;
    if (scenario === 'lone') s.players = s.players.filter(a => a.team !== 'blue' || a.id === 'b');
    if (scenario === 'emergency') s.players.find(a => a.id === 'runner')!.pos.x = -43;
    if (scenario === 'loose') s.holderId = null;
    const safety = () => blue(run(s)).find(a => a.defense?.mode === 'last-defender')!.defense!.intercept;
    const original = safety();
    s.tactics!.defaults.lateralSpacing = 8;
    assert.deepEqual(safety(), original, 'extra depth applies only with a separate containment defender');
    if (scenario === 'emergency') assert.deepEqual(original, s.players.find(a => a.id === 'runner')!.pos);
  });

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const motion of ['paused', 'blocked', 'visible'] as const)
  test(`carrier cuts follow time along a route: ${mirror}/${reverse}/${motion}`, () => {
    const s = scene(), sign = mirror ? -1 : 1, team = mirror ? 'red' : 'blue';
    s.tactics!.defaults.stylesEnabled = false;
    s.geometry = { key: `route-cut/${mirror}`, shape: 'rectangular', x: 52, z: 23,
      blockers: [{ kind: 'box', x: 5 * sign, z: 0, hx: 2, hz: 3 }] };
    s.players = [p('front', 'blue', 8, -3), p('safety', 'blue', -8, 5), p('support', 'blue', -4, -5), p('runner', 'red', 8)];
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1;
    }
    const carrier = s.players[3], front = s.players[0];
    carrier.vel = motion === 'blocked' ? { x: -5.2 * sign, z: 0 } : motion === 'visible' ? { x: 0, z: 5.2 * sign } : { x: 0, z: 0 };
    const route = createSpaceRouter(s.geometry!, carrier.pos)(s.goals[team]!);
    assert.equal(route.status, 'routed');
    const expected = motion === 'visible' ? { x: carrier.pos.x, z: carrier.pos.z + 1.3 * sign } : pointAlongRunnerRoute(carrier.pos, route, 1.3);
    front.pos = { ...expected };
    if (reverse) s.players.reverse();
    const orders = [...run(s).assignments.values()];
    const intercept = orders.find(a => a.defense?.mode === 'intercept')!;
    assert.equal(intercept.botId, 'front');
    assert.equal(intercept.defense!.carrierETA, .25, 'nearby ready defender takes the first route sample');
    assert.ok(fieldDistance(intercept.defense!.intercept, expected) < 1e-8, 'intercept follows timed carrier path');
    assert.ok(isSpacePointOpen(s.geometry!, intercept.defense!.intercept));
    assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
  });

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const human of [false, true])
  test(`a persistent blocked carrier expires the motion forecast, but a brief pause does not: ${mirror}/${reverse}/${human}`, () => {
    const s = scene(), sign = mirror ? -1 : 1;
    s.tactics!.defaults.stylesEnabled = false;
    s.players = [p('front', 'blue', 2, 4), p('safety', 'blue', -8, 5), p('support', 'blue', -4, -5), p('runner', 'red', 8)];
    s.players[3].scripted = !human;
    s.geometry = { key: `persistent-carrier-cover/${mirror}`, shape: 'rectangular', x: 52, z: 23,
      blockers: [{ kind: 'box', x: 5 * sign, z: 0, hx: 2, hz: 3 }] };
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1;
    }
    if (reverse) s.players.reverse();
    const carrier = s.players.find(a => a.id === 'runner')!, state = run(s);
    const interceptor = () => [...state.assignments.values()].find(a => a.defense?.mode === 'intercept')!;
    for (let i = 0; i < 5; i++) updateGrifballTeamPlan(state, s, .25);
    assert.equal(state.carrierMotion!.stationarySeconds, 1.25);
    assert.notDeepEqual(interceptor().defense!.intercept, carrier.pos);
    updateGrifballTeamPlan(state, s, .25);
    assert.deepEqual(interceptor().defense!.intercept, carrier.pos);
    assert.equal(interceptor().space!.route.status, 'routed');
    assert.ok(Number.isFinite(interceptor().space!.route.length));
    assert.match(interceptor().reason, /stationary carrier/);
    assert.equal([...state.assignments.values()].filter(a => a.defense?.mode === 'last-defender').length, 1);
    if (human) assert.equal(state.assignments.has(carrier.id), false);
    carrier.pos.x += 2 * sign;
    updateGrifballTeamPlan(state, s, .25);
    assert.equal(state.carrierMotion!.stationarySeconds, 0, 'observed movement restores prediction');
  });

test('carrier motion observations reset across ownership, rounds, disabled defense and match reset', () => {
  const s = scene(), state = run(s);
  updateGrifballTeamPlan(state, s, .25);
  assert.equal(state.carrierMotion!.stationarySeconds, .25);
  updateGrifballTeamPlan(state, { ...s, holderId: 'escort' }, .25);
  assert.equal(state.carrierMotion!.carrierId, 'escort'); assert.equal(state.carrierMotion!.stationarySeconds, 0);
  updateGrifballTeamPlan(state, { ...s, round: 2 }, .25);
  assert.equal(state.carrierMotion!.stationarySeconds, 0);
  updateGrifballTeamPlan(state, { ...s, holderId: null }, .25);
  assert.equal(state.carrierMotion, null);
  updateGrifballTeamPlan(state, s, .25);
  updateGrifballTeamPlan(state, { ...s, playing: false }, .25);
  assert.equal(state.carrierMotion, null);
  s.tactics!.defaults.defenseEnabled = false;
  updateGrifballTeamPlan(state, s, .25); assert.equal(state.carrierMotion, null);
  s.tactics!.defaults.defenseEnabled = true;
  updateGrifballTeamPlan(state, s, .25); assert.equal(state.carrierMotion!.stationarySeconds, 0);
  resetGrifballTeamPlan(state); assert.equal(state.carrierMotion, null);
});

for (const team of ['blue', 'red'] as const) for (const id of ['defender', 'main_ai'])
  test(`goal-side safety can counter an approaching carrier within its own reach: ${team}/${id}`, () => {
    const sign = team === 'blue' ? 1 : -1, self = p(id, team, 0);
    self.space!.reach = 6;
    const carrier = p('carrier', team === 'blue' ? 'red' : 'blue', 5 * sign);
    carrier.space!.weapon = 'ball'; carrier.space!.reach = 3.3; carrier.vel.x = -7.54 * sign;
    const intercept = { x: -10 * sign, z: 0 };
    const order: GrifballAssignment = { botId: id, team, carrierId: carrier.id, role: 'safety', slot: 0,
      destination: intercept, anchor: { ...carrier.pos }, reason: 'Guard the goal side', tuning: { ...defaultGrifballTactics().defaults },
      defense: { mode: 'last-defender', targetId: carrier.id, intercept, arrivalETA: .4, carrierETA: 1,
        advantage: -1, reinforcementIn: Infinity, emergency: false, transitioning: false } };
    assert.equal(selectGrifballAssignmentThreat(order, self.pos, [self, carrier]), carrier.id);
    for (const boundary of ['away', 'stationary', 'outside-reach', 'engagement-limit', 'behind', 'airborne', 'recovering', 'not-carrier', 'blocked']) {
      const a = structuredClone(order), defender = structuredClone(self), enemy = structuredClone(carrier);
      if (boundary === 'away') enemy.vel.x *= -1;
      if (boundary === 'stationary') enemy.vel.x = 0;
      if (boundary === 'outside-reach') defender.space!.reach = 4;
      if (boundary === 'engagement-limit') a.tuning!.engagementDistance = 4;
      if (boundary === 'behind') { defender.pos.x = 10 * sign; a.defense!.intercept = { x: -10 * sign, z: 0 }; }
      if (boundary === 'airborne') defender.space!.mobileIn = .2;
      if (boundary === 'recovering') defender.space!.phase = 'recovering';
      if (boundary === 'not-carrier') a.carrierId = 'other';
      if (boundary === 'blocked') a.geometry = { key: 'blocked-safety', shape: 'rectangular', x: 52, z: 23,
        blockers: [{ kind: 'box', x: 2 * sign, z: 0, hx: .5, hz: 10 }] };
      assert.equal(selectGrifballAssignmentThreat(a, defender.pos, [defender, enemy]), null, boundary);
    }
  });

for (const team of ['blue', 'red'] as const) for (const id of ['defender', 'main_ai'])
  for (const scenario of ['own-reach', 'enemy-reach', 'approaching-cut', 'distant-cut', 'engagement-limit', 'safety', 'blocked'] as const)
    test(`defensive combat handoff respects reach and establishes the cut: ${team}/${id}/${scenario}`, () => {
      const sign = team === 'blue' ? 1 : -1;
      const self = p(id, team, 0), enemy = p('carrier', team === 'blue' ? 'red' : 'blue', 5.5 * sign);
      self.space!.reach = scenario === 'enemy-reach' ? 2 : 6;
      enemy.space!.reach = scenario === 'enemy-reach' ? 6 : 2;
      enemy.space!.weapon = 'ball';
      const intercept = { x: (scenario === 'distant-cut' ? 10 : ['enemy-reach', 'approaching-cut'].includes(scenario) ? 5.5 : 1.5) * sign, z: 0 };
      const a: GrifballAssignment = { botId: id, team, carrierId: enemy.id, role: 'chaser', slot: 0,
        destination: intercept, anchor: { ...enemy.pos }, reason: 'Authored cut', tuning: { ...defaultGrifballTactics().defaults },
        defense: { mode: scenario === 'safety' ? 'last-defender' : 'intercept', targetId: enemy.id, intercept,
          arrivalETA: .4, carrierETA: .5, advantage: 0, reinforcementIn: Infinity, emergency: false, transitioning: false } };
      if (scenario === 'engagement-limit') a.tuning!.engagementDistance = 4;
      if (scenario === 'blocked') a.geometry = { key: 'blocked-cut', shape: 'rectangular', x: 52, z: 23,
        blockers: [{ kind: 'box', x: 3 * sign, z: 0, hx: .5, hz: 10 }] };
      assert.equal(selectGrifballAssignmentThreat(a, self.pos, [self, enemy]), scenario === 'own-reach' ? enemy.id : null);
    });

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const frontId of ['front', 'main_ai'])
  test(`the only reachable interceptor is not reserved as safety: ${mirror}/${reverse}/${frontId}`, () => {
    const s = scene();
    s.players = [p(frontId, 'blue', -6), p('late-a', 'blue', 3, 1), p('late-b', 'blue', 5, -1), p('late-c', 'blue', 8),
      p('runner', 'red', 0), p('escort-a', 'red', 6, 6), p('escort-b', 'red', 8, -6), p('escort-c', 'red', 10)];
    const runner = s.players.find(a => a.id === 'runner')!;
    runner.vel.x = -7.54; runner.space!.speed = 7.54;
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue';
      actor.pos.x *= -1; actor.pos.z *= -1; actor.vel.x *= -1;
    }
    if (reverse) s.players.reverse();
    const state = run(s), team = mirror ? 'red' : 'blue';
    const orders = [...state.assignments.values()].filter(a => a.team === team);
    const intercept = orders.find(a => a.defense?.mode === 'intercept')!;
    assert.equal(intercept.botId, frontId, 'trailing teammates cannot catch the faster carrier within the horizon');
    assert.ok(intercept.defense!.arrivalETA <= intercept.defense!.carrierETA + intercept.tuning!.defensePressure * .25);
    assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
    assert.notEqual(orders.find(a => a.defense?.mode === 'last-defender')!.botId, frontId);
    const before = orders.map(a => [a.botId, a.defense!.mode]);
    updateGrifballTeamPlan(state, s, 1);
    assert.deepEqual([...state.assignments.values()].filter(a => a.team === team).map(a => [a.botId, a.defense!.mode]), before);
  });
for (const mirror of [false, true]) for (const reverse of [false, true]) for (const nearId of ['near', 'main_ai'])
  for (const scenario of ['earlier-cut', 'same-time-cut'] as const)
    test(`interceptor uses the first reachable cut instead of the final projection: ${mirror}/${reverse}/${nearId}/${scenario}`, () => {
      const s = scene();
      if (scenario === 'earlier-cut') {
        s.players = [p('safety', 'blue', -20), p(nearId, 'blue', -2), p('late', 'blue', -10), p('runner', 'red', 0)];
        s.players[3].vel.x = -7.54; s.players[3].space!.speed = 7.54;
      } else {
        // Rounded positions from the retained Stadium pickup at tick 715.
        s.players = [p(nearId, 'blue', -1.55, -.3), p('wide-a', 'blue', -4.25, -4.09),
          p('wide-b', 'blue', -4.25, 4.08), p('safety', 'blue', -7.1, .08), p('runner', 'red', 1.55, -.3),
          p('escort-a', 'red', 4.32, -3.68), p('escort-b', 'red', 4.28, 3.63), p('rear', 'red', 7.1, .07)];
        for (const actor of s.players) actor.space = observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, actor.id === 'runner' ? 'ball' : 'hammer', 'ready');
        s.players.find(actor => actor.id === 'runner')!.vel = { x: -5.11, z: .98 };
      }
      if (mirror) for (const actor of s.players) {
        actor.team = actor.team === 'blue' ? 'red' : 'blue';
        actor.pos.x *= -1; actor.pos.z *= -1; actor.vel.x *= -1; actor.vel.z *= -1;
      }
      if (reverse) s.players.reverse();
      const state = run(s), team = mirror ? 'red' : 'blue';
      const orders = [...state.assignments.values()].filter(a => a.team === team);
      assert.equal(orders.find(a => a.defense?.mode === 'intercept')!.botId, nearId);
      assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'safety');
      const intercept = orders.find(a => a.botId === nearId)!.defense!;
      assert.equal(intercept.carrierETA, .25);
      updateGrifballTeamPlan(state, s, 1);
      assert.equal([...state.assignments.values()].find(a => a.team === team && a.defense?.mode === 'intercept')!.botId, nearId);
    });

test('interceptor readiness takes precedence over proximity to the projected carrier', () => {
  const s = scene();
  s.players = [p('safety', 'blue', -18), p('ready', 'blue', -6), p('recovering', 'blue', -10), p('runner', 'red', 0)];
  s.players[2].space!.mobileIn = 10;
  s.players[3].vel.x = -7.54; s.players[3].space!.speed = 7.54;
  const orders = blue(run(s));
  assert.equal(orders.find(a => a.defense?.mode === 'intercept')!.botId, 'ready');
  assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'safety');
});

test('a sealed route cannot make a nearby defender a feasible interceptor', () => {
  const s = scene();
  s.geometry = { key: 'sealed-defense', shape: 'rectangular', x: 52, z: 23,
    blockers: [{ kind: 'box', x: -3, z: 0, hx: .5, hz: 30 }] };
  s.players = [p('blocked', 'blue', -6), p('reachable', 'blue', 2), p('runner', 'red', 0)];
  s.players[2].vel.x = -7.54; s.players[2].space!.speed = 7.54;
  const orders = blue(run(s));
  const intercept = orders.find(a => a.defense?.mode === 'intercept')!;
  assert.equal(intercept.botId, 'reachable');
  assert.ok(Number.isFinite(intercept.defense!.arrivalETA));
  assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'blocked');
});

test('containment keeps the front defender as safety even when it alone could intercept', () => {
  const s = scene();
  s.players = [p('front', 'blue', -6), p('late', 'blue', 8), p('runner', 'red', 0)];
  s.players[2].vel.x = -7.54; s.players[2].space!.speed = 7.54;
  s.tactics!.defaults.defensePressure = 0;
  const orders = blue(run(s));
  assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'front');
  assert.equal(orders.find(a => a.defense?.mode === 'contain')!.botId, 'late');
});

test('multiple feasible interceptors preserve the existing goal-side safety', () => {
  const s = scene();
  s.players = [p('front', 'blue', -6), p('second', 'blue', -3), p('runner', 'red', 0)];
  s.players[2].vel.x = -7.54; s.players[2].space!.speed = 7.54;
  const orders = blue(run(s));
  assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'front');
  assert.equal(orders.find(a => a.defense?.mode === 'intercept')!.botId, 'second');
});

test('a carrier retreating away from the goal does not pull the safety into pursuit', () => {
  const s = scene();
  s.players = [p('front', 'blue', 6), p('late', 'blue', -15), p('runner', 'red', 0)];
  s.players[2].vel.x = 7.54; s.players[2].space!.speed = 7.54;
  const orders = blue(run(s));
  assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'front');
});

function flankDefenseScene(): GrifballTacticalSnapshot {
  const s = scene(); s.tactics!.defaults.stylesEnabled = false;
  s.players = [p('safety', 'blue', -20), p('interceptor', 'blue', -2), p('left', 'blue', -6, -6),
    p('right', 'blue', -6, 6), p('runner', 'red', 0), p('escort-left', 'red', 2, -6), p('escort-right', 'red', 1, 6)];
  return s;
}

for (const mirror of [false, true]) for (const reverse of [false, true])
  test(`defenders mark reachable escorts on their own flank: ${mirror}/${reverse}`, () => {
    const s = flankDefenseScene();
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1;
    }
    if (reverse) s.players.reverse();
    const orders = [...run(s).assignments.values()].filter(a => a.team === (mirror ? 'red' : 'blue'));
    for (const id of ['left', 'right']) {
      const order = orders.find(a => a.botId === id)!;
      assert.equal(order.defense?.mode, 'mark');
      assert.equal(order.defense.targetId, `escort-${id}`, 'do not cross the carrier lane to exchange flank marks');
      assert.ok(order.destination.z * s.players.find(p => p.id === id)!.pos.z > 0);
    }
    assert.equal(orders.find(a => a.defense?.mode === 'intercept')!.botId, 'interceptor');
    assert.equal(orders.find(a => a.defense?.mode === 'last-defender')!.botId, 'safety');
  });

test('marking retains an incumbent through a small distance reversal', () => {
  const s = flankDefenseScene(), state = run(s);
  s.players.find(p => p.id === 'left')!.pos.z = .2;
  s.players.find(p => p.id === 'right')!.pos.z = -.2;
  assert.equal(blue(run(s)).find(a => a.botId === 'left')!.defense!.targetId, 'escort-right',
    'without history the other mark must actually be nearer');
  updateGrifballTeamPlan(state, s, 1);
  for (const id of ['left', 'right']) assert.equal(blue(state).find(a => a.botId === id)!.defense!.targetId, `escort-${id}`);
});

test('an unreachable incumbent cannot reserve an escort mark', () => {
  const s = flankDefenseScene(), state = run(s);
  s.geometry!.blockers = [
    { kind: 'box', x: -7.5, z: -6, hx: .2, hz: 1.5 },
    { kind: 'box', x: -4.5, z: -6, hx: .2, hz: 1.5 },
    { kind: 'box', x: -6, z: -7.5, hx: 1.5, hz: .2 },
    { kind: 'box', x: -6, z: -4.5, hx: 1.5, hz: .2 },
  ];
  updateGrifballTeamPlan(state, s, 1);
  const orders = blue(state);
  assert.equal(orders.find(a => a.botId === 'left')!.defense!.mode, 'recover');
  const marks = orders.filter(a => a.defense?.mode === 'mark');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].botId, 'right');
  assert.equal(marks[0].defense!.targetId, 'escort-right', 'cover the most advanced reachable escort first');
});

test('an irrelevant distant escort cannot consume the only available marker', () => {
  const s = scene(); s.tactics!.defaults.stylesEnabled = false;
  s.players = [p('safety', 'blue', -20), p('interceptor', 'blue', -2), p('marker', 'blue', -6, 6),
    p('runner', 'red', 0), p('distant', 'red', -30, 20), p('nearby', 'red', 2, 6)];
  const order = blue(run(s)).find(a => a.botId === 'marker')!;
  assert.equal(order.defense?.mode, 'mark');
  assert.equal(order.defense.targetId, 'nearby');
});

test('defenders intercept a visible cut, reserve one safety and assign distinct marks deterministically', () => {
  const s = scene(); s.players[3].vel = { x: -3, z: 3 };
  const state = run(s), orders = blue(state);
  assert.equal(orders.filter(a => a.defense?.mode === 'last-defender').length, 1);
  assert.equal(orders.filter(a => a.role === 'safety').length, 1);
  const intercept = orders.find(a => a.defense?.mode === 'intercept')!;
  assert.ok(intercept.destination.x < 0 && intercept.destination.z > 0);
  assert.ok(orders.some(a => a.defense?.mode === 'mark' && a.defense.targetId === 'escort'));
  assert.ok(orders.every(a => !a.tanking && !a.escort));
  assert.deepEqual(blue(run({ ...s, players: [...s.players].reverse() })), orders);
  const safety = orders.find(a => a.defense?.mode === 'last-defender')!;
  assert.equal(selectGrifballAssignmentThreat(safety, { x: -10, z: 0 }, [p('side', 'red', -10, 5)]), null);
});
for (const mirror of [false, true]) for (const reverse of [false, true]) for (const id of ['guard', 'main_ai'])
  test(`lone ready defender holds an approaching goal-side cut: ${mirror}/${reverse}/${id}`, () => {
    const s = scene(), sign = mirror ? -1 : 1, team = mirror ? 'red' : 'blue', enemy = mirror ? 'blue' : 'red';
    s.tactics!.defaults.stylesEnabled = false;
    s.tactics!.defaults.defenseLookahead = 1.5;
    s.tactics!.defaults.defensePressure = .7;
    s.players = [p(id, team, -6 * sign), p('runner', enemy, 0), p('distant-support', enemy, 15 * sign, 15)];
    const self = s.players[0], carrier = s.players[1];
    carrier.space!.weapon = 'ball'; carrier.vel.x = -5 * sign;
    if (reverse) s.players.reverse();
    const order = run(s).assignments.get(id)!;
    assert.equal(order.defense?.mode, 'last-defender');
    assert.equal(order.role, 'safety');
    assert.deepEqual(order.destination, self.pos, 'hold the cut instead of moving it backward every refresh');
    assert.ok(Math.abs(order.defense!.carrierETA - 1.2) < 1e-9, 'crossing time follows observed carrier velocity');
    assert.match(order.reason, /hold the goal-side cut/);
    assert.equal(selectGrifballAssignmentThreat(order, self.pos, s.players), null, 'keep the cut until strike reach');
    carrier.pos.x = -4 * sign;
    assert.equal(selectGrifballAssignmentThreat(order, self.pos, s.players), carrier.id, 'counter the arriving runner');
  });

for (const defect of ['stationary', 'retreating', 'lateral', 'behind', 'distant', 'wide', 'recovering', 'airborne', 'slow', 'cautious', 'blocked', 'not-carrier', 'late-landing'] as const)
  test(`last defender does not hold an unsafe or unavailable cut: ${defect}`, () => {
    const s = scene(); s.tactics!.defaults.stylesEnabled = false;
    s.tactics!.defaults.defenseLookahead = 1.5; s.tactics!.defaults.defensePressure = .7;
    s.players = [p('guard', 'blue', -6), p('runner', 'red', 0)];
    const [self, carrier] = s.players; carrier.space!.weapon = 'ball'; carrier.vel.x = -5;
    if (defect === 'stationary') carrier.vel.x = 0;
    if (defect === 'retreating') carrier.vel.x = 5;
    if (defect === 'lateral') carrier.vel = { x: 0, z: 5 };
    if (defect === 'behind') self.pos.x = 6;
    if (defect === 'distant') self.pos.x = -25;
    if (defect === 'wide') self.pos.z = 10;
    if (defect === 'recovering') self.space!.phase = 'recovering';
    if (defect === 'airborne') self.space!.mobileIn = .5;
    if (defect === 'slow') self.space!.attackIn = 3;
    if (defect === 'cautious') s.tactics!.defaults.defensePressure = .2;
    if (defect === 'not-carrier') carrier.space!.weapon = 'hammer';
    if (defect === 'late-landing') carrier.space!.mobileIn = 2;
    if (defect === 'blocked') s.geometry = { key: 'blocked-cut', shape: 'rectangular', x: 52, z: 23,
      blockers: [{ kind: 'box', x: -3, z: 0, hx: .5, hz: 3 }] };
    assert.doesNotMatch(run(s).assignments.get('guard')!.reason, /hold the goal-side cut/);
  });

test('a lone defender abandons a stale moving forecast when the carrier is actually stationary', () => {
  const s = scene(); s.tactics!.defaults.stylesEnabled = false;
  s.tactics!.defaults.defenseLookahead = 1.5; s.tactics!.defaults.defensePressure = .7;
  s.players = [p('guard', 'blue', -6), p('runner', 'red', 0)];
  s.players[1].space!.weapon = 'ball'; s.players[1].vel.x = -5;
  const state = run(s);
  assert.match(state.assignments.get('guard')!.reason, /hold the goal-side cut/);
  for (let i = 0; i < 9; i++) updateGrifballTeamPlan(state, s, .2);
  assert.doesNotMatch(state.assignments.get('guard')!.reason, /hold the goal-side cut/);
});

test('1v1 last defender holds coverage then contests a goal emergency', () => {
  const s = scene(); s.players = [p('a', 'blue', -20), p('runner', 'red', 0)];
  assert.equal(blue(run(s))[0].defense?.mode, 'last-defender');
  s.players[1].pos.x = -43; s.players[0].pos.x = -46;
  const a = blue(run(s))[0]; assert.equal(a.defense?.emergency, true);
  assert.equal(selectGrifballAssignmentThreat(a, s.players[0].pos, s.players), 'runner');
});

for (const mirror of [false, true]) for (const reverse of [false, true]) for (const delay of ['recovery', 'airborne'] as const)
  test(`goal emergency assigns the ready defender before delayed closer defenders: ${mirror}/${reverse}/${delay}`, () => {
    const s = scene(); s.tactics!.defaults.stylesEnabled = false;
    s.players = [p('safety', 'blue', -47), p('delayed', 'blue', -46, 1), p('ready', 'blue', -40, 2),
      p('distant', 'blue', -36, -6), p('runner', 'red', -43), p('escort-left', 'red', -40, -8), p('escort-right', 'red', -40, 8)];
    s.players.find(a => a.id === 'runner')!.vel.x = -5.8;
    for (const actor of s.players.filter(a => ['safety', 'delayed'].includes(a.id))) {
      if (delay === 'recovery') { actor.space!.phase = 'recovering'; actor.space!.attackIn = 4; }
      else actor.space!.mobileIn = 4;
    }
    if (mirror) for (const actor of s.players) {
      actor.team = actor.team === 'blue' ? 'red' : 'blue'; actor.pos.x *= -1; actor.pos.z *= -1; actor.vel.x *= -1;
    }
    if (reverse) s.players.reverse();
    const state = run(s), ready = state.assignments.get('ready')!;
    assert.equal(ready.defense?.emergency, true);
    assert.equal(ready.defense?.mode, 'intercept', 'the only timely challenger must not be sent to mark an escort');
    assert.equal(ready.defense.targetId, 'runner');
    assert.equal(selectGrifballAssignmentThreat(ready, s.players.find(a => a.id === 'ready')!.pos, s.players), 'runner');
    assert.equal([...state.assignments.values()].filter(a => a.team === ready.team && a.defense?.mode === 'last-defender').length, 1);
  });
for (const allLate of [false, true])
  test(`goal emergency retains its goal-side challenger unless a missed deadline can be rescued: allLate=${allLate}`, () => {
    const s = scene(); s.tactics!.defaults.stylesEnabled = false;
    s.players = [p('safety', 'blue', -47), p('goal-side', 'blue', -46, 1), p('quicker', 'blue', -40, 2),
      p('runner', 'red', -43), p('escort', 'red', -40, 8)];
    s.players.find(a => a.id === 'runner')!.vel.x = -5.8;
    s.players.find(a => a.id === 'goal-side')!.space!.attackIn = allLate ? 4 : .3;
    s.players.find(a => a.id === 'quicker')!.space!.attackIn = allLate ? 3 : .1;
    const state = run(s);
    assert.equal(state.assignments.get('goal-side')!.defense?.mode, 'intercept');
    assert.notEqual(state.assignments.get('quicker')!.defense?.mode, 'intercept');
  });

for (const cause of ['blocked-route', 'unknown-readiness'] as const)
  test(`goal emergency excludes an unusable challenger: ${cause}`, () => {
    const s = scene(); s.tactics!.defaults.stylesEnabled = false;
    s.players = [p('safety', 'blue', -47), p('delayed', 'blue', -46, 1), p('ready', 'blue', -40, 2),
      p('runner', 'red', -43), p('escort', 'red', -40, 8)];
    s.players.find(a => a.id === 'runner')!.vel.x = -5.8;
    for (const actor of s.players.filter(a => ['safety', 'delayed'].includes(a.id))) actor.space!.attackIn = 4;
    assert.equal(run(s).assignments.get('ready')!.defense?.mode, 'intercept', 'control must offer the faster challenger');
    if (cause === 'blocked-route') {
      // A changed layout needs its own static navigation-cache identity.
      s.geometry = { ...s.geometry!, key: 'emergency-ready-sealed' };
      s.geometry!.blockers = [
        { kind: 'box', x: -41.5, z: 2, hx: .2, hz: 1.5 }, { kind: 'box', x: -38.5, z: 2, hx: .2, hz: 1.5 },
        { kind: 'box', x: -40, z: .5, hx: 1.5, hz: .2 }, { kind: 'box', x: -40, z: 3.5, hx: 1.5, hz: .2 },
      ];
      assert.equal(createSpaceRouter(s.geometry!, s.players.find(a => a.id === 'ready')!.pos)(s.players.find(a => a.id === 'runner')!.pos, true).status, 'blocked');
    } else delete s.players.find(a => a.id === 'ready')!.space;
    const state = run(s);
    assert.equal(state.assignments.get('delayed')!.defense?.mode, 'intercept');
    assert.notEqual(state.assignments.get('ready')!.defense?.mode, 'intercept');
  });

test('numbers, pressure preference and reachable reinforcements control containment', () => {
  const s = scene(); s.players.push(p('extra1', 'red', 4), p('extra2', 'red', 5));
  assert.ok(blue(run(s)).some(a => a.defense?.mode === 'contain'));
  s.players = s.players.filter(p => !p.id.startsWith('extra')); s.tactics!.defaults.defensePressure = 0;
  assert.ok(blue(run(s)).some(a => a.defense?.mode === 'contain'));
  s.tactics!.defaults.defensePressure = 1; s.players.push(p('extra1', 'red', 4));
  s.respawns = [{ id: 'returning', team: 'blue', seconds: 1, pos: { x: -2, z: 0 }, speed: 5.2 }];
  const state = run(s); assert.ok(blue(state).some(a => a.defense?.mode === 'contain'));
  assert.ok(blue(state).every(a => a.defense!.reinforcementIn < 2));
  assert.equal(state.assignments.has('returning'), false);
  s.respawns[0].seconds = 10; assert.ok(blue(run(s)).some(a => a.defense?.mode === 'intercept'));
});
test('turnover immediately recovers shape, losing a safety replaces it, and round reset clears memory', () => {
  const s = scene(); const state = run({ ...s, holderId: 'a' });
  updateGrifballTeamPlan(state, s, 0.01);
  assert.ok(blue(state).every(a => a.defense?.transitioning));
  const safety = blue(state).find(a => a.defense?.mode === 'last-defender')!;
  updateGrifballTeamPlan(state, { ...s, players: s.players.filter(p => p.id !== safety.botId) }, 0.01);
  assert.ok(blue(state).some(a => a.defense?.mode === 'last-defender'));
  updateGrifballTeamPlan(state, { ...s, round: 2 }, 0.01); assert.equal(state.transition.blue, 0);
  resetGrifballTeamPlan(state); assert.deepEqual(state.transition, {});
});
test('loose-ball recovery preserves retriever and safety; observed players and disabled module receive no defense orders', () => {
  const s = scene(); s.holderId = null; const state = run(s);
  assert.equal(blue(state).filter(a => a.role === 'retriever').length, 1);
  assert.equal(blue(state).filter(a => a.defense?.mode === 'last-defender').length, 1);
  s.players[0].scripted = false; assert.equal(run(s).assignments.has('a'), false);
  s.tactics!.defaults.defenseEnabled = false; assert.ok(blue(run(s)).every(a => !a.defense));
  s.tactics!.defaults.defenseEnabled = true; s.tactics!.defaults.spaceEnabled = false; assert.ok(blue(run(s)).every(a => !a.defense));
});
