import { throwBall, tickBallPhysics } from '../game/grifballBall';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createMatch } from './factory';
import { createSimGrifballTacticalSnapshot, observeSimGrifballSpace } from './grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../components/grifball/grifballTeamPlanRuntime';
import { createInitialGrifballRuntimeState } from '../components/grifball/runtimeState';
import { createOfflineBotCombatant } from '../game/roster';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../game/grifballTacticsConfig';
import { resolveHammerSlamTiming } from '../game/hammerSlamTiming';

test('individual Grifball styles are copied equally by live and simulation observations', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  sim.combatExecution = 'live-roster-v2';
  for (const actor of sim.combatants) {
    if (actor.id === 'player') live.yaw = actor.yaw + Math.PI;
    else live.otherPlayers.get(actor.id)!.yaw = actor.yaw + Math.PI;
  }
  const tactics = defaultGrifballTactics(); tactics.defaults.agencyStrength = .8; tactics.defaults.runnerAgencyStrength = .7;
  tactics.defaults.defenseAgencyStrength = .6; tactics.defaults.passAgencyStrength = .5;
  for (const id of Object.keys(scriptedBots)) tactics.botStyles[id] = 'enforcer';
  const carrier = sim.combatants.find(c => c.controller === 'ai')!;
  carrier.weapon = 'ball'; live.otherPlayers.get(carrier.id)!.activeWeapon = 'ball';
  Object.assign(sim.match.ball, { state: 'held', holderId: carrier.id });
  Object.assign(live.grifball.ball, { state: 'held', holderId: carrier.id });
  live.grifballTactics = tactics;
  const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics });
  const b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  const normalize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'number' ? Math.round(item * 1e9) / 1e9 : item));
  assert.deepEqual(normalize(a), normalize(b), 'live yaw convention differs by pi; allow trigonometric roundoff');
  const first = createGrifballTeamPlanState(), second = createGrifballTeamPlanState();
  updateGrifballTeamPlan(first, a, .2); updateGrifballTeamPlan(second, b, .2);
  assert.deepEqual(first.assignments, second.assignments);
  assert.deepEqual(first.runnerPlans, second.runnerPlans);
  assert.deepEqual([...first.assignments.values()].map(a => a.pass), [...second.assignments.values()].map(a => a.pass));
  assert.equal(a.tactics!.defaults.passAgencyStrength, .5);
  assert.equal(b.tactics!.defaults.passAgencyStrength, .5);
  assert.equal(first.runnerPlans[carrier.team].individuality?.style, 'enforcer');
  assert.equal(first.runnerPlans[carrier.team].individuality?.strength, .7);
  const defenders = [...first.assignments.values()].filter(a => a.defense);
  assert.ok(defenders.length > 0);
  assert.ok(defenders.every(a => a.defense!.individuality?.strength === .6));
  const id = Object.keys(scriptedBots)[0]; tactics.botStyles[id] = 'guardian';
  assert.equal(a.tactics!.botStyles[id], 'enforcer'); assert.equal(b.tactics!.botStyles[id], 'enforcer');
});

for (const [enabled, strength, expected] of [
  [undefined, undefined, true], [true, 1, true], [false, 1, false], [true, 0, false], [true, .1, true],
] as const) test(`live and simulation share hammer deflection rules: ${enabled}/${strength}`, () => {
  const { sim, live, scriptedBots, goals } = fixture();
  for (const settings of [sim.settings, live.settings]) {
    settings.hammerBallDeflectionEnabled = enabled;
    settings.hammerBallDeflectionStrength = strength;
  }
  const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  const b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.equal(a.passing!.hammerDeflection, expected);
  assert.deepEqual(a.passing, b.passing);
  live.settings.hammerBallDeflectionEnabled = !expected;
  assert.equal(b.passing!.hammerDeflection, expected, 'snapshot does not alias current mechanics');
});

for (const execution of ['live-player-v1', 'live-roster-v1', 'live-roster-v2', 'live-mixed-v1'] as const) {
  for (const yaw of [0, Math.PI / 2, Math.PI, -.73]) test(`${execution}: tactical heading matches actual world aim ${yaw}`, () => {
    const { sim, live, scriptedBots, goals } = fixture();
    sim.combatExecution = execution; sim.localPlayerId = 'player';
    live.yaw = yaw + Math.PI;
    for (const c of sim.combatants) {
      c.yaw = yaw;
      if (c.id !== 'player') live.otherPlayers.get(c.id)!.yaw = yaw + Math.PI;
    }
    const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
    const b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
    for (const c of a.players) {
      const expected = b.players.find(p => p.id === c.id)!;
      assert.ok(Math.abs(c.heading!.x - Math.sin(yaw)) < 1e-10, 'simulation forward x');
      assert.ok(Math.abs(c.heading!.z - Math.cos(yaw)) < 1e-10, 'simulation forward z');
      assert.ok(Math.abs(c.heading!.x - expected.heading!.x) < 1e-10);
      assert.ok(Math.abs(c.heading!.z - expected.heading!.z) < 1e-10);
    }
    const first = createGrifballTeamPlanState(), second = createGrifballTeamPlanState();
    updateGrifballTeamPlan(first, a, 1 / 60); updateGrifballTeamPlan(second, b, 1 / 60);
    const normalize = (plan: typeof first) => JSON.stringify([...plan.assignments], (_key, value) =>
      typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value);
    assert.equal(normalize(first), normalize(second), 'independent observations produce equivalent assignments');
  });
}

function fixture() {
  const sim = createMatch({ seed: 17, settings: { aiDifficulty: 'normal' } });
  sim.match.phase = 'playing';
  const live = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: sim.settings, isMultiplayer: false, multiplayerRole: null });
  live.isObserverMode = false; live.arenaRadius = sim.map.arenaRadius;
  live.grifball = structuredClone(sim.match); live.grifballTactics = defaultGrifballTactics();
  live.otherPlayers.clear();
  for (const c of sim.combatants) {
    if (c.id === 'player') {
      live.localPlayerTeam = c.team; live.playerPos.set(c.pos.x, c.pos.y, c.pos.z); live.playerVel.set(c.vel.x, c.vel.y, c.vel.z);
      live.yaw = c.yaw; live.playerHP = c.hp; live.playerRespawnTimer = 0; live.activeWeapon = 'hammer';
      live.pWeaponState = 'ready'; live.pWeaponTimer = 0; live.swapLockoutTimer = 0; live.playerPickupRequested = undefined;
      live.playerInvulnerabilityTimer = c.invulnerabilityTimer;
      continue;
    }
    const bot = createOfflineBotCombatant({ id: c.id, playerName: c.id, team: c.team, spawnPos: new THREE.Vector3(c.pos.x, c.pos.y, c.pos.z),
      yaw: c.yaw, hue: 0, difficulty: 'normal', settings: sim.settings });
    Object.assign(bot, { controller: c.controller, activeWeapon: c.weapon, weaponState: 'ready', weaponTimer: 0, respawnTimer: 0, swapLockoutTimer: 0, pickupRequested: undefined });
    bot.invulnerabilityTimer = c.invulnerabilityTimer;
    live.otherPlayers.set(c.id, bot);
  }
  const scriptedBots = Object.fromEntries(sim.combatants.filter(c => c.controller === 'ai').map(c => [c.id, 'normal']));
  const goals = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)?.position ?? null;
  return { sim, live, scriptedBots, goals };
}

for (const team of ['blue', 'red'] as const) for (const control of [
  { name: 'request', request: true, distance: 1, yield: true },
  { name: 'released', request: false, distance: 1, yield: false },
  { name: 'unknown', request: undefined, distance: 1, yield: false },
  { name: 'out-of-range', request: true, distance: 1.51, yield: false },
]) test(`pickup observation preserves human handoff ${team}/${control.name}`, () => {
  const { sim, live, scriptedBots, goals } = fixture();
  for (const c of sim.combatants) {
    if (team === 'red') c.team = c.team === 'blue' ? 'red' : 'blue';
    c.vel = { x: 0, y: 0, z: 0 };
    c.pos = { x: c.id === 'player' ? control.distance : c.team === team ? 4 : -15, y: 0, z: 0 };
    if (c.id === 'player') {
      live.localPlayerTeam = c.team; live.playerPos.set(c.pos.x, 0, 0); live.playerVel.set(0, 0, 0);
      live.playerPickupRequested = control.request;
    } else {
      const bot = live.otherPlayers.get(c.id)!; bot.team = c.team;
      bot.pos.set(c.pos.x, 0, 0); bot.vel.set(0, 0, 0);
    }
  }
  const options = { scriptedBots, pickupRequests: { player: control.request } };
  const a = createSimGrifballTacticalSnapshot(sim, options), b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.deepEqual(a, b);
  const first = createGrifballTeamPlanState(), second = createGrifballTeamPlanState();
  updateGrifballTeamPlan(first, a, 1 / 60); updateGrifballTeamPlan(second, b, 1 / 60);
  assert.deepEqual(first, second);
  assert.equal([...first.assignments.values()].filter(p => p.team === team && p.role === 'retriever').length, control.yield ? 0 : 1);
  assert.equal(first.assignments.has('player'), false);
});

test('explicit scripted participants cannot authorize control of a remote actor', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const inputs = { ...scriptedBots, player: 'normal' };
  const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots: inputs });
  const b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.equal(a.players.find(p => p.id === 'player')!.scripted, false);
  assert.deepEqual(a, b);
});

test('global neural selection revokes scripted ownership despite per-slot authorization', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  sim.settings.aiDifficulty = live.settings.aiDifficulty = 'neural-net';
  const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  const b = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.ok(a.players.every(p => !p.scripted));
  assert.deepEqual(a, b);
  const plan = createGrifballTeamPlanState(); updateGrifballTeamPlan(plan, a, 1 / 60);
  assert.equal(plan.assignments.size, 0);
});

test('per-slot neural selection stays outside scripted ownership', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const bot = sim.combatants.find(c => c.controller === 'ai')!;
  scriptedBots[bot.id] = 'neural-net'; live.otherPlayers.get(bot.id)!.difficulty = 'neural-net';
  const a = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  assert.equal(a.players.find(p => p.id === bot.id)!.scripted, false);
  assert.deepEqual(a, createLiveGrifballTacticalSnapshot(live, goals, sim.map));
});

for (const execution of ['legacy-v1', 'live-mixed-v1'] as const)
  test(`${execution}: pickup observations remain detached, explicit and do not execute controls`, () => {
    const { sim, scriptedBots } = fixture();
    sim.combatExecution = execution; sim.localPlayerId = 'player';
    const before = JSON.stringify(sim), requests = { player: true };
    const observed = () => createSimGrifballTacticalSnapshot(sim, { scriptedBots, pickupRequests: requests });
    const first = observed();
    requests.player = false;
    assert.equal(first.players.find(p => p.id === 'player')!.pickupRequested, true);
    assert.equal(observed().players.find(p => p.id === 'player')!.pickupRequested, false);
    const inherited = createSimGrifballTacticalSnapshot(sim, { scriptedBots, pickupRequests: Object.create({ player: true }) });
    assert.equal(inherited.players.find(p => p.id === 'player')!.pickupRequested, undefined);
    assert.equal(createSimGrifballTacticalSnapshot(sim, { scriptedBots }).players.find(p => p.id === 'player')!.pickupRequested, undefined);
    assert.equal(JSON.stringify(sim), before);
  });

test('equivalent ready-hammer live/headless fixtures produce identical versioned observations and team plans', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  const runtime = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
  assert.deepEqual(headless, runtime);
  assert.equal(headless.contractVersion, 1);
  const a = createGrifballTeamPlanState(), b = createGrifballTeamPlanState();
  for (let tick = 0; tick < 8; tick++) {
    const c = sim.combatants[1]; c.pos.x += 0.2; c.vel.x = 2;
    live.otherPlayers.get(c.id)!.pos.x = c.pos.x; live.otherPlayers.get(c.id)!.vel.x = 2;
    updateGrifballTeamPlan(a, createSimGrifballTacticalSnapshot(sim, { scriptedBots }), 1 / 60);
    updateGrifballTeamPlan(b, createLiveGrifballTacticalSnapshot(live, goals, sim.map), 1 / 60);
    assert.deepEqual(a, b);
  }
});

test('snapshot data is detached and headless ownership defaults to observation-only', () => {
  const { sim, scriptedBots } = fixture(); const tactics = defaultGrifballTactics();
  const snapshot = createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics });
  const original = structuredClone(snapshot);
  sim.combatants[0].pos.x += 50; sim.match.ball.pos.z += 40; tactics.defaults.styleAggression = 1;
  assert.deepEqual(snapshot, original);
  assert.ok(createSimGrifballTacticalSnapshot(sim, { scriptedBots: {} }).players.every(p => !p.scripted));
  sim.mode = 'combat'; assert.throws(() => createSimGrifballTacticalSnapshot(sim, { scriptedBots }), /Grifball/);
});

test('headless remaining timers reflect its execution model, including known sword and punch timing differences', () => {
  const { sim } = fixture(); const c = sim.combatants[1]; const timing = resolveHammerSlamTiming(sim.settings);
  c.weaponState = 'windup'; c.weaponTimer = 0.17; c.attackKind = 'strike';
  assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, 0.17);
  c.weaponState = 'recovering'; c.weaponTimer = 0.3; c.attackCooldown = 0.3;
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings).attackIn - (0.3 + timing.windupTime + timing.attackTime)) < 1e-10);
  c.weaponState = 'idle'; c.attackCooldown = 0; c.weaponReadyTimer = 0.5; c.swapLockoutTimer = 10;
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings).attackIn - (0.5 + timing.windupTime + timing.attackTime)) < 1e-10);
  c.weaponReadyTimer = 0; c.weapon = 'sword';
  assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, sim.settings.swordSlashSpeed);
  c.weapon = 'ball'; assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, sim.settings.hammerMeleeSpeed);
  c.isLunging = true; assert.equal(observeSimGrifballSpace(c, sim.settings).attackIn, 0);
  c.pos.y = 2; c.vel.y = 4; assert.ok(observeSimGrifballSpace(c, sim.settings).mobileIn > 0.7);
});

test('dead members retain roster identity and use the actual headless respawn slot', () => {
  const { sim, scriptedBots } = fixture(); const c = sim.combatants[1];
  const before = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  c.alive = false; c.hp = 0; c.respawnTimer = 2;
  const after = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
  assert.equal(before.rosterKey, after.rosterKey); assert.ok(!after.players.some(p => p.id === c.id));
  const index = sim.combatants.filter(p => p.team === c.team).indexOf(c);
  const spawn = sim.spawns[c.team][index % sim.spawns[c.team].length];
  assert.deepEqual(after.respawns![0].pos, { x: spawn.x, z: spawn.z }); assert.equal(after.respawns![0].seconds, 2);
});

test('roster timing observes future impact and does not count slash follow-through as another hit', () => {
  const { sim } = fixture(); const c = sim.combatants[0];
  c.weapon = 'sword'; c.attackKind = 'slash'; c.weaponState = 'windup'; c.weaponTimer = .05;
  assert.equal(observeSimGrifballSpace(c, sim.settings, 'live-roster-v1').attackIn, .05);
  c.weaponState = 'active';
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings, 'live-roster-v1').attackIn
    - (.05 + sim.settings.swordSlashReload + sim.settings.swordSlashSpeed * .5)) < 1e-10);
  c.weapon = 'hammer'; c.attackKind = 'swipe'; c.weaponState = 'windup';
  assert.ok(Math.abs(observeSimGrifballSpace(c, sim.settings, 'live-roster-v1').attackIn
    - (.05 + sim.settings.hammerMeleeSpeed * .6)) < 1e-10);
  c.weaponState = 'active'; assert.equal(observeSimGrifballSpace(c, sim.settings, 'live-roster-v1').attackIn, .05);
});


test('contract parity survives countdown, scored hold, round changes and terminal state', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const a = createGrifballTeamPlanState(), b = createGrifballTeamPlanState();
  for (const phase of ['countdown', 'playing', 'scored', 'countdown', 'playing', 'scored', 'matchEnd'] as const) {
    if (phase === 'countdown' && sim.match.phase === 'scored') sim.match.roundNumber++;
    sim.match.phase = phase; live.grifball = structuredClone(sim.match);
    const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
    const runtime = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
    assert.deepEqual(headless, runtime, phase);
    updateGrifballTeamPlan(a, headless, 1 / 60); updateGrifballTeamPlan(b, runtime, 1 / 60);
    assert.deepEqual(a, b, phase);
    if (phase !== 'playing') assert.equal(a.assignments.size, 0, phase);
  }
});

test('shared thrown-ball observations and recovery plans stay equal through settling and auto-return', () => {
  const { sim, live, scriptedBots, goals } = fixture();
  const a = createGrifballTeamPlanState(), b = createGrifballTeamPlanState();
  throwBall(sim.match.ball, { x: 0, y: 1.1, z: 0 }, { x: 1, y: 0, z: 0 }, 9);
  live.grifball.ball = structuredClone(sim.match.ball);
  const seen = new Set<string>();
  for (let i = 0; i < 660; i++) {
    tickBallPhysics(sim.match.ball, 1 / 60, 8, sim.map);
    tickBallPhysics(live.grifball.ball, 1 / 60, 8, sim.map);
    seen.add(sim.match.ball.state);
    const headless = createSimGrifballTacticalSnapshot(sim, { scriptedBots });
    const runtime = createLiveGrifballTacticalSnapshot(live, goals, sim.map);
    assert.deepEqual(headless, runtime);
    updateGrifballTeamPlan(a, headless, 1 / 60); updateGrifballTeamPlan(b, runtime, 1 / 60);
    assert.deepEqual(a, b);
  }
  assert.ok(seen.has('thrown')); assert.ok(seen.has('loose')); assert.ok(seen.has('idle'));
  assert.deepEqual(sim.match.ball, live.grifball.ball);
});

for (const kind of ['none', 'strike', 'slash'] as const) test(`ready roster threat ignores retained AI backoff (${kind})`, () => {
  const { sim, live, scriptedBots, goals } = fixture();
  sim.combatExecution = 'live-roster-v2';
  const actor = sim.combatants.find(c => c.controller === 'ai')!;
  actor.weaponState = 'idle'; actor.attackKind = kind; actor.attackCooldown = 1.2; actor.weaponReadyTimer = .15;
  const bot = live.otherPlayers.get(actor.id)!; bot.swapCooldownTimer = .15;
  const actual = createSimGrifballTacticalSnapshot(sim, { scriptedBots }).players.find(p => p.id === actor.id)!;
  const expected = createLiveGrifballTacticalSnapshot(live, goals, sim.map).players.find(p => p.id === actor.id)!;
  assert.deepEqual(actual.space, expected.space, 'ready animation keeps only mechanical swap readiness');
  assert.equal(actor.attackCooldown, 1.2, 'observation preserves decision backoff');
  assert.ok(observeSimGrifballSpace(actor, sim.settings, 'legacy-v1').attackIn > actual.space!.attackIn,
    'legacy training retains its original mechanical cooldown');
});
