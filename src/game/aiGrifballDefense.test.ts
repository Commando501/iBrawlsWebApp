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
test('1v1 last defender holds coverage then contests a goal emergency', () => {
  const s = scene(); s.players = [p('a', 'blue', -20), p('runner', 'red', 0)];
  assert.equal(blue(run(s))[0].defense?.mode, 'last-defender');
  s.players[1].pos.x = -43; s.players[0].pos.x = -46;
  const a = blue(run(s))[0]; assert.equal(a.defense?.emergency, true);
  assert.equal(selectGrifballAssignmentThreat(a, s.players[0].pos, s.players), 'runner');
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
