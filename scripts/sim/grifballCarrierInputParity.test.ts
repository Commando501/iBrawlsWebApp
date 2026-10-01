import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { defaultGrifballMap } from '../../src/sim/factory';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { resolveSimGrifballCarrierInput } from '../../src/sim/grifballCarrierInput';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
function fixture(id: string, mirror: boolean, routed: boolean, pickup: boolean) {
  const map = structuredClone(defaultGrifballMap()), sign = mirror ? -1 : 1;
  if (routed) map.objects.push({ type: 'box', position: { x: -4 * sign, y: 1, z: 0 },
    scale: { x: 2, y: 2, z: 5 }, isCollidable: true } as typeof map.objects[number]);
  const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', speedForward: 140, speedBackward: 25, speedSide: 50 }, 'target', map);
  const { sim, state, bot, target } = f, [self, other] = sim.combatants;
  sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
  state.grifball = structuredClone(sim.match); state.grifballTactics = defaultGrifballTactics(); state.arenaRadius = sim.map.arenaRadius;
  self.id = id; other.id = target.id; self.controller = bot.controller = 'ai'; other.controller = target.controller = 'remote';
  self.team = bot.team = mirror ? 'red' : 'blue'; other.team = target.team = mirror ? 'blue' : 'red';
  self.pos = { x: -8 * sign, y: 0, z: 0 }; bot.pos.set(self.pos.x, 0, 0);
  other.pos = { x: 30 * sign, y: 0, z: 15 }; target.pos.set(other.pos.x, 0, other.pos.z);
  for (const [actor, live] of [[self, bot], [other, target]] as const) {
    actor.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    actor.weaponReadyTimer = actor.invulnerabilityTimer = 0; actor.yaw = 0; live.yaw = Math.PI;
    actor.hp = actor.maxHp = live.hp; actor.weaponState = 'idle';
  }
  if (!pickup) {
    sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = id;
    setSimCarrier(self, true, sim.settings); setGrifballCarrierForState({ state, id, carrying: true });
  }
  const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)?.position ?? null;
  return { ...f, self, other, goal, plan: createGrifballTeamPlanState(), scriptedBots: { [id]: 'normal' } };
}

for (const id of ['bot_2', 'main_ai']) for (const mirror of [false, true]) for (const routed of [false, true]) for (const pickup of [false, true])
  test(`independent planner carries to goal ${id}/mirror=${mirror}/routed=${routed}/pickup=${pickup}`, () => {
    const f = fixture(id, mirror, routed, pickup), { sim, state, self, bot, plan, scriptedBots } = f;
    let acquired = !pickup, goalTick = 0, maxLateral = 0, runnerTicks = 0;
    for (let tick = 1; tick <= 600; tick++) {
      updateGrifballTeamPlanForState(state, dt, f.goal, f.map);
      updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, pickupRequests: { [id]: false } }), dt);
      assert.equal(state.aiMatchContext.grifballTeamPlan.assignments.get(id)?.role, plan.assignments.get(id)?.role);
      const carrier = self.hasBall ? resolveSimGrifballCarrierInput(sim, plan, id, scriptedBots, true) : null;
      const input = self.hasBall ? carrier?.input : resolveSimGrifballSupportInput(sim, plan, id, scriptedBots);
      assert.ok(input, `unopposed route must produce executable movement, got ${carrier?.decision.kind}`);
      if (self.hasBall) runnerTicks++;
      const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: bot.aiTimer ?? 0,
        dashRemaining: bot.aiDashRemaining ?? 0, slideActive: !!bot.aiSlideActive, weaponState: bot.weaponState ?? 'ready', pickupRequested: !!bot.pickupRequested };
      assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: id, self: bot, frame,
        alliesList: [], enemiesList: [f.target.pos], dt, canStartWeaponAction: true,
        triggerCombatantAttack: () => assert.fail('unopposed carrier must not punch'), getEnemyGoalPos: f.goal,
        constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }));
      bot.yaw = frame.yaw; bot.pickupRequested = frame.pickupRequested;
      updateGrifballObjectiveForState({ state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset before first goal'), pushStatsUpdate: () => {} });
      stepSimulation(sim, { [id]: input.action }, { settings: sim.settings, scriptedObjective: input.scriptedObjective });
      for (const axis of ['x', 'y', 'z'] as const) {
        near(bot.pos[axis], self.pos[axis], `${tick} position.${axis}`); near(bot.vel[axis], self.vel[axis], `${tick} velocity.${axis}`);
        near(state.grifball.ball.pos[axis], sim.match.ball.pos[axis], `${tick} ball.${axis}`);
      }
      near(-Math.sin(bot.yaw), Math.sin(self.yaw), `${tick}/${sim.match.phase} facing.x`); near(-Math.cos(bot.yaw), Math.cos(self.yaw), `${tick}/${sim.match.phase} facing.z`);
      assert.equal(bot.hp, self.hp); assert.equal(state.grifball.phase, sim.match.phase);
      assert.equal(state.grifball.ball.holderId, sim.match.ball.holderId);
      for (const team of ['blue', 'red'] as const) assert.equal(state.teamScores[team].goals, sim.scores[team].goals);
      acquired ||= self.hasBall; maxLateral = Math.max(maxLateral, Math.abs(self.pos.z));
      if (sim.scores[self.team].goals) { goalTick = tick; break; }
    }
    assert.ok(acquired); assert.ok(runnerTicks > 200); assert.ok(goalTick > 0 && goalTick <= 600);
    assert.equal(sim.scores[self.team].goals, 1); assert.equal(sim.scores[f.other.team].goals, 0);
    if (routed) assert.ok(maxLateral > 3, 'carrier must take the obstacle detour');
  });

test('carrier requests a punch handoff without silently substituting a movement action', () => {
  const f = fixture('bot_2', false, false, false);
  f.other.pos = { x: -7, y: 0, z: 0 };
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  const before = structuredClone(f.sim), plan = structuredClone(f.plan);
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, true);
  assert.equal(result?.decision.kind, 'punch'); assert.equal(result?.input, null);
  assert.deepEqual(f.sim, before); assert.deepEqual(f.plan, plan);
});

test('carrier recovery holds attack facing while its own route advances', () => {
  const f = fixture('bot_2', false, false, false);
  f.self.weaponState = 'recovering'; f.self.yaw = .63;
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, false)!;
  assert.equal(result.decision.kind, 'move'); assert.equal(result.input!.action.aim, .63);
  assert.ok(result.input!.scriptedObjective.movement[f.self.id].x > 0);
  f.self.weaponState = 'windup';
  const committed = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, false)!;
  assert.equal(committed.decision.kind, 'committed-punch');
  assert.deepEqual(committed.input!.scriptedObjective.movement[f.self.id], { x: 0, z: 0 });
});

test('zero carrier steering retains the live zero-vector heading convention', () => {
  const f = fixture('bot_2', false, false, false);
  f.self.pos = { ...f.goal(f.self.team)!, y: 0 };
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, false)!;
  assert.equal(result.decision.kind, 'move');
  assert.deepEqual(result.input!.scriptedObjective.movement[f.self.id], { x: 0, z: 0 });
  assert.equal(result.input!.action.aim, -Math.PI);
});

test('selected carrier pass is an explicit handoff, not a silent idle command', () => {
  const f = fixture('bot_2', false, false, false);
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: f.scriptedBots }), dt);
  const assignment = f.plan.assignments.get(f.self.id)!;
  assignment.pass = { selected: { direction: { x: 1, z: 0 } } } as typeof assignment.pass;
  const result = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, true)!;
  assert.equal(result.decision.kind, 'pass'); assert.equal(result.input, null);
  assert.deepEqual(result.decision.heading, { x: 1, z: 0 });
});
