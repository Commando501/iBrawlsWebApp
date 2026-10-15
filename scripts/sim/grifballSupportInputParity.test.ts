import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { stepSimulation } from '../../src/sim/step';
import { setSimCarrier } from '../../src/sim/grifball';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { defaultGrifballMap } from '../../src/sim/factory';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
function fixture(id = 'bot_2', escort = false, mirror = false, routed = false) {
  const map = structuredClone(defaultGrifballMap());
  if (routed) map.objects.push({ type: 'box', position: { x: mirror ? 4 : -4, y: 1, z: 0 },
    scale: { x: 2, y: 2, z: 5 }, isCollidable: true } as typeof map.objects[number]);
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', speedForward: 140, speedBackward: 25, speedSide: 50 }, 'target', map);
  const { sim, state, bot, target } = f;
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match); state.arenaRadius = sim.map.arenaRadius;
  state.grifballTactics = defaultGrifballTactics();
  const [self, other] = sim.combatants;
  self.id = bot.id; other.id = target.id;
  self.controller = bot.controller = 'ai'; other.controller = target.controller = 'remote';
  const sign = mirror ? -1 : 1;
  self.team = bot.team = mirror ? 'red' : 'blue'; other.team = target.team = escort ? self.team : (mirror ? 'blue' : 'red');
  self.pos = { x: -8 * sign, y: 0, z: 0 }; bot.pos.set(self.pos.x, 0, 0);
  other.pos = { x: (escort ? 0 : 30) * sign, y: 0, z: escort ? 0 : 15 }; target.pos.set(other.pos.x, 0, other.pos.z);
  for (const [actor, live] of [[self, bot], [other, target]] as const) {
    actor.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    actor.weapon = live.activeWeapon = 'hammer'; actor.weaponState = 'idle'; live.weaponState = 'ready';
    actor.hp = actor.maxHp = live.hp = live.maxHp = 1;
    actor.weaponReadyTimer = actor.invulnerabilityTimer = 0; actor.yaw = 0; live.yaw = Math.PI;
  }
  if (escort) {
    sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = other.id;
    setSimCarrier(other, true, sim.settings); setGrifballCarrierForState({ state, id: target.id, carrying: true });
  }
  const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)?.position ?? null;
  return { ...f, self, other, goal, scriptedBots: { [id]: 'normal' }, plan: createGrifballTeamPlanState() };
}

for (const id of ['bot_2', 'main_ai']) for (const escort of [false, true]) for (const mirror of [false, true]) for (const routed of [false, true])
  test(`own-state planner drives grounded support ${id}/escort=${escort}/mirror=${mirror}/routed=${routed}`, () => {
    const f = fixture(id, escort, mirror, routed), { sim, state, bot, self, plan, scriptedBots } = f;
    let pickupRequests: Record<string, boolean> = {}, moved = 0, pickupTick = 0, maxLateral = 0;
    const initial = { ...self.pos };
    for (let tick = 1; tick <= 180; tick++) {
      updateGrifballTeamPlanForState(state, dt, f.goal, f.map);
      updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, pickupRequests }), dt);
      assert.equal(state.aiMatchContext.grifballTeamPlan.assignments.get(id)?.role, plan.assignments.get(id)?.role);
      const input = resolveSimGrifballSupportInput(sim, plan, id, scriptedBots);
      if (!input) {
        assert.ok(pickupTick > 0 && self.hasBall, 'only completed retrieval may hand off to carrier control');
        break;
      }
      const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: bot.aiTimer ?? 0,
        dashRemaining: bot.aiDashRemaining ?? 0, slideActive: !!bot.aiSlideActive, weaponState: bot.weaponState ?? 'ready', pickupRequested: !!bot.pickupRequested };
      assert.equal(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: id, self: bot, frame,
        alliesList: f.target.team === bot.team ? [{ x: f.target.pos.x, z: f.target.pos.z }] : [], enemiesList: [], dt,
        canStartWeaponAction: false, triggerCombatantAttack: () => assert.fail('support must not invent an attack'), getEnemyGoalPos: f.goal,
        constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }), true);
      bot.yaw = frame.yaw; bot.pickupRequested = frame.pickupRequested;
      updateGrifballObjectiveForState({ state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'), pushStatsUpdate: () => {} });
      stepSimulation(sim, { [id]: input.action }, { settings: sim.settings, scriptedObjective: input.scriptedObjective });
      // Objective resolution consumes the one-frame request on both hosts.
      pickupRequests = { [id]: false };
      for (const axis of ['x', 'z'] as const) { near(bot.pos[axis], self.pos[axis], `${tick} position.${axis}`); near(bot.vel[axis], self.vel[axis], `${tick} velocity.${axis}`); }
      near(-Math.sin(bot.yaw), Math.sin(self.yaw), 'facing.x'); near(-Math.cos(bot.yaw), Math.cos(self.yaw), 'facing.z');
      assert.equal(state.grifball.ball.holderId, sim.match.ball.holderId);
      assert.equal(frame.pickupRequested, input.action.pickup);
      if (Math.hypot(self.vel.x, self.vel.z) > 0) moved++;
      maxLateral = Math.max(maxLateral, Math.abs(self.pos.z));
      if (self.hasBall && !pickupTick) pickupTick = tick;
    }
    assert.ok(moved > 20);
    assert.ok(Math.hypot(self.pos.x - initial.x, self.pos.z - initial.z) > 4);
    if (routed) assert.ok(maxLateral > 3, 'the route must walk around the authored wall');
    if (!escort) assert.ok(pickupTick > 0 && pickupTick < 180, 'retriever must actually earn possession');
    else assert.equal(sim.match.ball.holderId, f.other.id);
    if (!escort && !routed) assert.equal(pickupTick, Math.ceil((8 - 1.6) / (5.2 * 1.4 * dt)), 'independent unobstructed arrival time at the default pickup radius');
  });

test('support recovery keeps attack facing while moving and preserves live reload time', () => {
  const f = fixture('main_ai', true);
  f.self.weaponState = 'recovering'; f.self.yaw = .63;
  f.bot.weaponState = 'recovering'; f.bot.yaw = .63 + Math.PI;
  updateGrifballTeamPlanForState(f.state, dt, f.goal, f.map);
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  const input = resolveSimGrifballSupportInput(f.sim, f.plan, f.self.id, f.scriptedBots)!;
  const frame = { pos: f.bot.pos, vel: f.bot.vel, yaw: f.bot.yaw, aiState: 'COOLDOWN' as const, timer: .4,
    dashRemaining: 0, slideActive: false, weaponState: 'recovering', pickupRequested: false };
  assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state: f.state, botId: f.bot.id, self: f.bot, frame,
    alliesList: [f.target.pos], enemiesList: [], dt, canStartWeaponAction: false,
    triggerCombatantAttack: () => assert.fail('unexpected attack'), constrainCombatantToArena: () => {}, getEnemyGoalPos: f.goal }));
  stepSimulation(f.sim, { [f.self.id]: input.action }, { settings: f.sim.settings, scriptedObjective: input.scriptedObjective });
  assert.equal(frame.yaw, .63 + Math.PI); assert.equal(f.self.yaw, .63);
  assert.equal(frame.aiState, 'COOLDOWN'); near(frame.timer, .4 - dt, 'reload');
  near(frame.pos.x, f.self.pos.x, 'recovery displacement');
  assert.ok(f.self.vel.x > 0);
});

test('assigned close threat delegates to combat instead of generating a support command', () => {
  const f = fixture('bot_2', true);
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  f.plan.snapshot!.players.push({ id: 'threat', team: 'red', pos: { x: -7, z: 0 }, vel: { x: 0, z: 0 }, scripted: false });
  assert.equal(resolveSimGrifballSupportInput(f.sim, f.plan, f.self.id, f.scriptedBots), null);
});

test('sim support decision reads its own state without mutating physics or plan memory', () => {
  const f = fixture();
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  const before = structuredClone(f.sim), plan = structuredClone(f.plan);
  const first = resolveSimGrifballSupportInput(f.sim, f.plan, f.self.id, f.scriptedBots)!;
  assert.ok(first);
  assert.deepEqual(f.sim, before); assert.deepEqual(f.plan, plan);
  f.self.pos.z = 5;
  const second = resolveSimGrifballSupportInput(f.sim, f.plan, f.self.id, f.scriptedBots)!;
  assert.notDeepEqual(second.scriptedObjective.movement, first.scriptedObjective.movement);
  assert.equal(f.bot.pos.z, 0, 'headless perturbation must not alter live state');
});

for (const reason of ['airborne', 'dash', 'slide', 'flight', 'dead', 'remote', 'neural', 'unlisted', 'inactive', 'unassigned', 'carrier'] as const)
  test(`unsupported support control delegates explicitly: ${reason}`, () => {
    const f = fixture();
    updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
    if (reason === 'airborne') f.self.pos.y = 1;
    if (reason === 'dash') f.self.dashRemaining = .1;
    if (reason === 'slide') f.self.slideActive = true;
    if (reason === 'flight') f.self.isLunging = true;
    if (reason === 'dead') f.self.alive = false;
    if (reason === 'remote') f.self.controller = 'remote';
    if (reason === 'neural') f.scriptedBots[f.self.id] = 'neural-net';
    if (reason === 'unlisted') delete f.scriptedBots[f.self.id];
    if (reason === 'inactive') f.sim.match.phase = 'countdown';
    if (reason === 'unassigned') f.plan.assignments.clear();
    if (reason === 'carrier') f.self.hasBall = true;
    const before = structuredClone(f.sim);
    assert.equal(resolveSimGrifballSupportInput(f.sim, f.plan, f.self.id, f.scriptedBots), null);
    assert.deepEqual(f.sim, before);
  });
