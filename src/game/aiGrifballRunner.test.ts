import test from 'node:test';
import assert from 'node:assert/strict';
import type { CustomMapData } from '../types';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { observeGrifballSpace } from './aiGrifballSpace';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, resetGrifballTeamPlan, type GrifballTacticalPlayer, type GrifballTacticalSnapshot } from './aiGrifballTeamPlan';
import { buildGrifballSpaceGeometry, isSpaceSegmentOpen } from './grifballSpaceGeometry';
import { defaultGrifballTactics, validateGrifballTactics, TACTICS_FIELDS } from './grifballTacticsConfig';
import { createRunnerEscortPlanner, createSnapshotRouters, planGrifballRunner, tickRunnerMemory } from './aiGrifballRunner';

const p = (id: string, team: string, x: number, z: number): GrifballTacticalPlayer => ({ id, team, pos: { x, z }, vel: { x: 0, z: 0 }, scripted: true, space: observeGrifballSpace(DEFAULT_ADMIN_SETTINGS, id === 'runner' ? 'ball' : 'hammer', 'ready') });

// Winter tick 5245: the same centerline threat produces lateral projections
// -6.66e-16 and +7.77e-16 in the two hosts. Escort slots must not flip sides.
const winterEscortPoses = [
  { carrier: { x: -45.5391318150339, z: -.09351286985509971 },
    target: { x: -46.572921518664714, z: .28235791734031307 },
    heading: { x: -.9398088214825641, z: .3417007156321948 } },
  { carrier: { x: -45.5391318150339, z: -.09351286985510078 },
    target: { x: -46.572921518664714, z: .2823579173403149 },
    heading: { x: -.9398088214825632, z: .34170071563219706 } },
];

function centerlineEscort(capture: typeof winterEscortPoses[number], sign: number, slot: number) {
  const s = scene(), team = sign === 1 ? 'red' : 'blue', enemy = team === 'red' ? 'blue' : 'red';
  const carrier = p('runner', team, sign * capture.carrier.x, sign * capture.carrier.z);
  carrier.scripted = false;
  carrier.heading = { x: sign * capture.heading.x, z: sign * capture.heading.z };
  const bot = p('escort', team, -17 * sign, 2.6 * sign);
  // Three supports keep the ordinary lead/cover slots distinct from rear cover.
  s.players = [carrier, bot, p('ally-1', team, 20 * sign, 5), p('ally-2', team, 20 * sign, -5),
    p('threat', enemy, sign * capture.target.x, sign * capture.target.z)];
  const tuning = { ...defaultGrifballTactics().defaults, safetyFirst: false, escortLaneWidth: 2.5735153765656893 };
  const routers = createSnapshotRouters(s);
  const play = planGrifballRunner(s, carrier, tuning,
    tickRunnerMemory(undefined, carrier, s.goals[enemy]!, 0), routers);
  const order = createRunnerEscortPlanner(s, carrier, play, tuning, routers)(bot, slot === 0 ? 'lead' : 'cover', slot);
  const lateral = (order.destination.x - carrier.pos.x) * -play.heading.z +
    (order.destination.z - carrier.pos.z) * play.heading.x;
  return { order, lateral, width: tuning.escortLaneWidth };
}

for (const sign of [1, -1]) for (const slot of [0, 1]) {
  test(`captured centerline threat preserves escort side ${sign}/${slot}`, () => {
    const results = winterEscortPoses.map(pose => centerlineEscort(pose, sign, slot));
    for (const result of results) {
      assert.equal(result.order.targetId, 'threat');
      assert.equal(result.order.kind, 'intercept');
      assert.ok(Math.abs(result.lateral - (slot ? -1 : 1) * result.width) < 1e-9);
    }
    assert.ok(Math.hypot(results[0].order.destination.x - results[1].order.destination.x,
      results[0].order.destination.z - results[1].order.destination.z) < 1e-9);
  });
}

for (const slot of [0, 1]) test(`escort respects real threat side outside centerline tolerance ${slot}`, () => {
  for (const lateral of [-.5, -2e-9, -1e-12, 0, 1e-12, 2e-9, .5]) {
    const result = centerlineEscort({ carrier: { x: 0, z: 0 }, target: { x: 2, z: lateral },
      heading: { x: 1, z: 0 } }, 1, slot);
    const side = Math.abs(lateral) <= 1e-9 ? slot ? -1 : 1 : Math.sign(lateral);
    assert.equal(result.order.targetId, 'threat');
    assert.ok(Math.abs(result.lateral - side * result.width) < 1e-9, `lateral ${lateral}`);
  }
});

for (const team of ['blue', 'red'] as const)
  for (const scenario of ['reachable', 'weapon-range-only', 'blocked', 'recovering', 'spent-budget', 'human', 'already-close'] as const)
    test(`runner waits for a reachable ready escort within remaining budget: ${team}/${scenario}`, () => {
      const s = scene(), sign = team === 'blue' ? 1 : -1;
      // The positive case must rendezvous before the enemy's 1.4s attack ETA.
      const allyDistance = scenario === 'weapon-range-only' ? 12 : scenario === 'already-close' ? 1.5 : scenario === 'reachable' ? 3 : 9;
      s.players = [p('runner', team, 0, 0), p('ally', team, -allyDistance * sign, 0), p('enemy', team === 'blue' ? 'red' : 'blue', 6 * sign, 0)];
      if (scenario !== 'weapon-range-only') Object.assign(s.players[1].space!, { reach: 2, speed: 5, attackIn: .4 });
      Object.assign(s.players[2].space!, { reach: 3, speed: 3, attackIn: .4 });
      if (scenario === 'human') s.players[1].scripted = false;
      if (scenario === 'recovering') Object.assign(s.players[1].space!, { phase: 'recovering', attackIn: 5 });
      if (scenario === 'blocked') s.geometry = buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52,
        arenaHalfExtents: { x: 52, z: 23 }, objects: [{ type: 'box', position: { x: -2.5 * sign, y: 2, z: 0 },
          scale: { x: 1, y: 4, z: 46 }, isCollidable: true }] } as CustomMapData, 52);
      const tuning = { ...defaultGrifballTactics().defaults, runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 };
      const memory = tickRunnerMemory(undefined, s.players[0], s.goals[team === 'blue' ? 'red' : 'blue']!, 0);
      if (scenario === 'spent-budget') memory.waitUsed = tuning.runnerMaxWait - .25;
      const plan = planGrifballRunner(s, s.players[0], tuning, memory, createSnapshotRouters(s));
      if (scenario === 'weapon-range-only') {
        const wait = plan.candidates.find(c => c.action === 'wait')!;
        assert.ok(allyDistance / s.players[1].space!.speed > tuning.runnerMaxWait, 'body cannot rendezvous in time');
        assert.ok(wait.supportETA <= tuning.runnerMaxWait, 'weapon can cover the runner in time');
      }
      if (scenario === 'reachable') assert.equal(plan.selected.action, 'wait');
      else assert.notEqual(plan.selected.action, 'wait', scenario);
    });
function scene(): GrifballTacticalSnapshot {
  return { round: 1, playing: true, holderId: 'runner', ball: { x: 0, z: 0 }, spacing: 4,
    goals: { blue: { x: -47, z: 0 }, red: { x: 47, z: 0 } }, tactics: { ...defaultGrifballTactics(), teams: { blue: { tankingEnabled: false }, red: { tankingEnabled: false } } },
    geometry: buildGrifballSpaceGeometry({ mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [] } as unknown as CustomMapData, 52),
    players: [p('runner', 'blue', 0, 0), p('a', 'blue', 3, 4), p('b', 'blue', 1, -4), p('c', 'blue', -3, 0), p('enemy', 'red', 30, 0)] };
}

for (const team of ['blue', 'red'] as const) for (const reverse of [false, true])
  for (const timing of ['early-rendezvous', 'late-rendezvous', 'late-pressure', 'timely-pressure', 'clear'] as const)
    test(`wait risk covers the rendezvous interval and first threat contact: ${team}/${reverse}/${timing}`, () => {
      const s = scene(), sign = team === 'blue' ? 1 : -1, enemy = team === 'blue' ? 'red' : 'blue';
      const carrier = p('runner', team, 0, 0), threat = p('threat', enemy, 6 * sign, 0);
      const escort = p('escort', team, (timing === 'early-rendezvous' ? -5 : -9) * sign, 0);
      Object.assign(threat.space!, { reach: 3, speed: 3, attackIn: .4 });
      Object.assign(escort.space!, { reach: 2, speed: 5, attackIn: .4 });
      if (timing === 'late-pressure' || timing === 'timely-pressure') {
        escort.pos = { x: 6 * sign, z: 6.5 * sign };
        Object.assign(escort.space!, { reach: 7.7, attackIn: timing === 'late-pressure' ? 1.6 : .4 });
      }
      s.players = timing === 'clear' ? [carrier, escort] : [carrier, escort, threat];
      if (reverse) s.players.reverse();
      const tuning = { ...defaultGrifballTactics().defaults, runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 };
      const plan = planGrifballRunner(s, carrier, tuning, tickRunnerMemory(undefined, carrier, s.goals[enemy]!, 0), createSnapshotRouters(s));
      const wait = plan.candidates.find(c => c.action === 'wait')!;
      // The threat reaches this stationary carrier in (6 - 3) / 3 + .4 = 1.4s.
      // The early escort rendezvous takes 5 / 5 = 1s; the late one takes 1.8s.
      const expected = timing === 'clear' ? 0 : timing === 'early-rendezvous' ? 1 / 3 : timing === 'timely-pressure' ? .55 : 1;
      assert.ok(Math.abs(wait.risk - expected) < 1e-10, `${timing}: expected ${expected}, got ${wait.risk}`);
      if (timing === 'early-rendezvous') assert.ok(Number.isFinite(wait.score), 'safe rendezvous remains eligible alongside a safer retreat');
      if (timing === 'late-rendezvous' || timing === 'late-pressure') {
        assert.equal(wait.score, -Infinity, 'an enemy can attack before coverage; remaining still is not a safe rendezvous');
        assert.notEqual(plan.selected.action, 'wait');
      }
    });

for (const team of ['blue', 'red'] as const) for (const reverse of [false, true])
  test(`runner coverage must reach the threatening opponent: ${team}/${reverse}`, () => {
    const s = scene(), sign = team === 'blue' ? 1 : -1, enemy = team === 'blue' ? 'red' : 'blue';
    const carrier = p('runner', team, 0, 0), threat = p('threat', enemy, 8.5 * sign, 0);
    const escort = p('escort', team, -5.5 * sign, 0);
    for (const actor of [threat, escort]) Object.assign(actor.space!, { reach: 7.7, speed: 5.2, attackIn: .12 });
    const tuning = { ...defaultGrifballTactics().defaults, runnerLookahead: 3 };
    const advance = (players: GrifballTacticalPlayer[]) => {
      s.players = reverse ? [...players].reverse() : players;
      return planGrifballRunner(s, carrier, tuning, tickRunnerMemory(undefined, carrier, s.goals[enemy]!, 0),
        createSnapshotRouters(s)).candidates.find(c => c.action === 'advance')!;
    };
    const alone = advance([carrier, threat]), behind = advance([carrier, threat, escort]);
    assert.equal(alone.risk, 1, 'runner route enters the ready hammer threat');
    assert.ok(behind.supportETA < .3, 'escort can reach a route point quickly');
    assert.equal(behind.risk, alone.risk, 'reaching the runner route does not establish timely pressure on its opponent');
    escort.pos = { x: 6 * sign, z: 5 };
    const covered = advance([carrier, threat, escort]);
    assert.ok(covered.risk < alone.risk, 'timely pressure on the actual threat supplies coverage');
    const flanker = p('flanker', enemy, 9 * sign, -7);
    Object.assign(flanker.space!, { reach: 7.7, speed: 5.2, attackIn: .12 });
    assert.ok(advance([carrier, threat, escort, flanker]).risk > covered.risk, 'covering one opponent does not cover a second threat');
    for (const unavailable of ['recovering', 'airborne'] as const) {
      const original = { ...escort.space! };
      if (unavailable === 'recovering') Object.assign(escort.space!, { phase: 'recovering', attackIn: 3 });
      else escort.space!.mobileIn = 3;
      assert.equal(advance([carrier, threat, escort]).risk, alone.risk, unavailable);
      escort.space = original;
    }
  });

for (const team of ['blue', 'red'] as const) for (const reverse of [false, true])
  for (const timing of ['late-support', 'timely-support', 'delayed-threat'] as const)
    test(`runner coverage arrives before predicted contact: ${team}/${reverse}/${timing}`, () => {
      const s = scene(), sign = team === 'blue' ? 1 : -1, enemy = team === 'blue' ? 'red' : 'blue';
      const carrier = p('runner', team, 0, 0), threat = p('threat', enemy, 6 * sign, 0);
      const escort = p('escort', team, 6 * sign, 5);
      Object.assign(threat.space!, { phase: 'swing_down', attackIn: timing === 'delayed-threat' ? .5 : .13333333333333333 });
      escort.space!.attackIn = timing === 'timely-support' ? .1 : .4;
      s.players = [carrier, threat, escort];
      if (reverse) s.players.reverse();
      const tuning = defaultGrifballTactics().defaults;
      const plan = planGrifballRunner(s, carrier, tuning, tickRunnerMemory(undefined, carrier, s.goals[enemy]!, 0), createSnapshotRouters(s));
      const advance = plan.candidates.find(c => c.action === 'advance')!;
      const firstArrival = advance.route.length * .25 / carrier.space!.speed;
      assert.ok(firstArrival < .2 && firstArrival + .25 > .4, 'fixture exposes the old grace-period credit');
      if (timing === 'late-support') assert.equal(advance.risk, 1, 'support after contact cannot reduce a fully exposed route');
      else assert.ok(advance.risk > 0 && advance.risk < 1,
        'timely pressure reduces risk without guaranteeing safety, including a threat that arrives after the runner');
    });

test('clear lane advances, reachable goal finishes, and escorts advance after breakthrough', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'advance');
  const before = state.assignments.get('a')!.destination.x;
  const runner = s.players[0]; runner.pos.x = 12; s.players[4].pos.x = -15;
  updateGrifballTeamPlan(state, s, 0.8);
  assert.ok(state.assignments.get('a')!.destination.x > before + 5);
  for (const a of state.assignments.values()) if (a.team === 'blue' && a.role !== 'runner') assert.ok(a.escort);
  runner.pos.x = 44; updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'finish');
  assert.deepEqual(state.assignments.get('runner')!.destination, s.goals.red);
});

test('cuts away from forward pressure and commits across small observation changes', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players = [s.players[0], p('enemy', 'red', 5, -2)];
  Object.assign(s.players[1].space!, { reach: 3, speed: 3, attackIn: 0.4 });
  s.tactics!.defaults.runnerCutWidth = 6;
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'cut-left');
  const target = { ...state.runnerPlans.blue.selected.destination };
  s.players[1].pos.z += 0.1; updateGrifballTeamPlan(state, s, 0.2);
  assert.deepEqual(state.runnerPlans.blue.selected.destination, target);
  const reversed = createGrifballTeamPlanState(); updateGrifballTeamPlan(reversed, { ...s, players: [...s.players].reverse() }, 0.2);
  assert.equal(reversed.runnerPlans.blue.selected.action, 'cut-left');
});

test('coverage wait and retreat are bounded by actual progress, even with an immobile carrier', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players = [s.players[0], p('ally', 'blue', -3, 0), p('enemy', 'red', 6, 0)];
  Object.assign(s.players[1].space!, { reach: 2, speed: 5, attackIn: 0.4 });
  Object.assign(s.players[2].space!, { reach: 3, speed: 3, attackIn: 0.4 });
  Object.assign(s.tactics!.defaults, { runnerMaxWait: 2, runnerCutWidth: 1, runnerRiskWeight: 20 });
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerPlans.blue.selected.action, 'wait');
  const actions = new Set<string>();
  for (let i = 0; i < 25; i++) { updateGrifballTeamPlan(state, s, 0.2); actions.add(state.runnerPlans.blue.selected.action); }
  assert.ok(actions.has('retreat'));
  assert.equal(state.runnerPlans.blue.forcedProgress, true);
  assert.equal(state.runnerPlans.blue.selected.action, 'advance');
  assert.ok(state.runnerMemory.blue.waitUsed <= 2.21);
  s.players[0].pos.x = 3; updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.runnerMemory.blue.stalledSeconds, 0);
  assert.equal(state.runnerMemory.blue.waitUsed, 0);
});

test('a solo runner never waits for nonexistent coverage', () => {
  const s = scene(), state = createGrifballTeamPlanState(); s.players = [s.players[0], p('enemy', 'red', 5, 0)];
  updateGrifballTeamPlan(state, s, 0.2);
  assert.notEqual(state.runnerPlans.blue.selected.action, 'wait');
});

test('rear pursuit is assigned to safety and escort screens leave the route corridor clear', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players.push(p('rear', 'red', -7, 0)); updateGrifballTeamPlan(state, s, 0.2);
  const safety = [...state.assignments.values()].find(a => a.team === 'blue' && a.role === 'safety')!;
  assert.equal(safety.escort!.kind, 'rear-guard'); assert.equal(safety.escort!.targetId, 'rear');
  const targets = [...state.assignments.values()].filter(a => a.team === 'blue').flatMap(a => a.escort?.targetId ? [a.escort.targetId] : []);
  assert.equal(new Set(targets).size, targets.length);
  for (const a of state.assignments.values()) if (a.team === 'blue' && ['lead', 'cover'].includes(a.role)) assert.ok(Math.abs(a.destination.z) >= s.tactics!.defaults.escortLaneWidth - 0.001);
});

test('human heading and velocity lead escorts without assigning orders to the human', () => {
  const s = scene(), state = createGrifballTeamPlanState();
  s.players[0].scripted = false; s.players[0].vel = { x: 0, z: 5 };
  updateGrifballTeamPlan(state, s, 0.2);
  assert.equal(state.assignments.has('runner'), false);
  assert.equal(state.runnerPlans.blue.selected.action, 'observed');
  assert.ok(state.runnerPlans.blue.selected.destination.z > 0);
  assert.ok(state.assignments.get('a')!.destination.z > 0);
  s.players[0].vel.z = 0; s.players[0].heading = { x: 0, z: -1 }; updateGrifballTeamPlan(state, s, 0.2);
  assert.ok(state.runnerPlans.blue.selected.destination.z < 0);
});

test('new obstacle invalidates a committed push and every replacement route remains reachable', () => {
  const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
  const old = state.runnerPlans.blue.selected.destination;
  const map = { mapShape: 'rectangular', arenaRadius: 52, arenaHalfExtents: { x: 52, z: 23 }, objects: [
    { type: 'box', position: { x: 4, y: 1, z: 0 }, scale: { x: 1, y: 2, z: 8 }, isCollidable: true },
  ] } as CustomMapData;
  s.geometry = buildGrifballSpaceGeometry(map, 52); updateGrifballTeamPlan(state, s, 0.2);
  const route = state.runnerPlans.blue.selected.route;
  assert.notDeepEqual(state.runnerPlans.blue.selected.destination, old);
  assert.notEqual(route.status, 'blocked');
  route.points.forEach((point, i) => assert.ok(isSpaceSegmentOpen(s.geometry!, i ? route.points[i - 1] : s.players[0].pos, point)));
});

test('disable, thrown ball, carrier death and round reset clear runner and escort memory immediately', () => {
  for (const event of ['disable', 'space-off', 'throw', 'death', 'round'] as const) {
    const s = scene(), state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, s, 0.2);
    if (event === 'disable') s.tactics!.teams.blue = { runnerEnabled: false };
    if (event === 'space-off') s.tactics!.teams.blue = { spaceEnabled: false };
    if (event === 'throw') s.holderId = null;
    if (event === 'death') s.players.shift();
    if (event === 'round') s.playing = false;
    updateGrifballTeamPlan(state, s, 0.001);
    assert.equal(state.runnerPlans.blue, undefined); assert.equal(state.runnerMemory.blue, undefined);
    assert.ok([...state.assignments.values()].every(a => !a.runner && !a.escort));
  }
  const state = createGrifballTeamPlanState(); updateGrifballTeamPlan(state, scene(), 0.2); resetGrifballTeamPlan(state);
  assert.deepEqual(state.runnerPlans, {}); assert.deepEqual(state.runnerMemory, {});
});

test('v2 presets migrate runner defaults and retain existing explicit overrides', () => {
  const old: any = defaultGrifballTactics(); old.schemaVersion = 2; delete old.defaults.runnerEnabled;
  for (const [key, field] of Object.entries(TACTICS_FIELDS)) if (field.module === 'runner') delete old.defaults[key];
  old.teams.red = { spaceEnabled: false, lateralSpacing: 5 };
  const migrated = validateGrifballTactics(old);
  assert.equal(migrated.schemaVersion, 14); assert.equal(migrated.defaults.runnerEnabled, true);
  assert.deepEqual(migrated.teams.red, old.teams.red);
  assert.throws(() => validateGrifballTactics({ ...migrated, teams: { blue: { runnerMaxWait: -1 } } }));
});


test('short-handed teams still cover rear pursuit without a dedicated safety slot', () => {
  for (const escorts of [1, 2]) {
    const s = scene(), state = createGrifballTeamPlanState();
    s.players = [s.players[0], ...s.players.slice(1, escorts + 1), p('rear', 'red', -7, 0)];
    updateGrifballTeamPlan(state, s, 0.2);
    const rearGuard = [...state.assignments.values()].filter(a => a.escort?.kind === 'rear-guard');
    assert.equal(rearGuard.length, 1);
    assert.equal(rearGuard[0].escort!.targetId, 'rear');
    assert.ok(rearGuard[0].escort!.destination.x < s.players[0].pos.x);
  }
});
