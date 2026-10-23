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
import { updateGrifballTeamPlanForState, createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { selectGrifballRunnerEvasion } from '../../src/game/aiGrifballRunnerEvasion';
import { resolveHammerSlamTiming } from '../../src/game/hammerSlamTiming';
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

for (const id of ['bot_2', 'main_ai']) for (const mirror of [false, true]) for (const routed of [false, true])
  test(`crouching carrier slows exactly once and resumes standing speed ${id}/${mirror}/${routed}`, () => {
    const f = fixture(id, mirror, routed, false), { sim, state, self, bot, plan, scriptedBots } = f;
    for (const crouch of [false, true, false]) for (let tick = 0; tick < 12; tick++) {
      self.isCrouching = bot.isCrouching = crouch;
      updateGrifballTeamPlanForState(state, dt, f.goal, f.map);
      updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics: state.grifballTactics }), dt);
      const result = resolveSimGrifballCarrierInput(sim, plan, id, scriptedBots, false)!;
      assert.equal(result.decision.kind, 'move'); assert.ok(result.input);
      const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: 0,
        dashRemaining: 0, slideActive: false, weaponState: 'ready', pickupRequested: false };
      const before = bot.pos.clone();
      assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: id, self: bot, frame,
        alliesList: [], enemiesList: [f.target.pos], dt, canStartWeaponAction: false,
        triggerCombatantAttack: () => assert.fail('No attack expected'), getEnemyGoalPos: f.goal,
        constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }));
      bot.yaw = frame.yaw;
      stepSimulation(sim, { [id]: result.input.action }, { settings: sim.settings, scriptedObjective: result.input.scriptedObjective });
      const expectedSpeed = 5.8 * 1.4 * 1.3 * (crouch ? .45 : 1);
      near(Math.hypot(bot.vel.x, bot.vel.z), expectedSpeed, 'live crouch speed');
      near(Math.hypot(self.vel.x, self.vel.z), expectedSpeed, 'sim crouch speed');
      near(bot.pos.distanceTo(before), expectedSpeed * dt, 'travel distance');
      for (const axis of ['x', 'y', 'z'] as const) {
        near(bot.pos[axis], self.pos[axis], `position.${axis}`);
        near(bot.vel[axis], self.vel[axis], `velocity.${axis}`);
      }
    }
  });

function runnerWindup(id = 'bot_2', mirror = false) {
  const f = fixture(id, mirror, false, false), sign = mirror ? -1 : 1;
  updateGrifballTeamPlanForState(f.state, .2, f.goal, f.map);
  updateGrifballTeamPlan(f.plan, createSimGrifballTacticalSnapshot(f.sim,
    { scriptedBots: f.scriptedBots, tactics: f.state.grifballTactics }), .2);
  // The cached team snapshot still sees a distant, ready enemy. A runner's
  // immediate escape must instead observe the newly started nearby windup.
  f.other.pos = { x: f.self.pos.x - 6 * sign, y: 0, z: 0 };
  f.target.pos.set(f.other.pos.x, 0, 0);
  f.other.vel = { x: 5.2 * sign, y: 0, z: 0 }; f.target.vel.set(f.other.vel.x, 0, 0);
  f.other.weapon = f.target.activeWeapon = 'hammer';
  f.other.weaponState = 'windup'; f.other.attackKind = 'strike'; f.other.weaponTimer = .02;
  f.target.weaponState = 'swing_up'; f.target.weaponTimer = resolveHammerSlamTiming(f.state.settings).windupTime - .02;
  f.self.dashCooldownTimer = f.self.dashRemaining = 0;
  return f;
}

for (const id of ['bot_2', 'main_ai']) for (const mirror of [false, true])
  test(`fresh runner evasion hands the same launch to both physical owners ${id}/${mirror}`, () => {
    const f = runnerWindup(id, mirror), before = structuredClone(f.sim);
    const result = resolveSimGrifballCarrierInput(f.sim, f.plan, id, f.scriptedBots, true, dt, { evasion: true });
    assert.ok(result?.evasion, 'Fresh windup must request an escape');
    assert.equal(result.input, null, 'The physical owner must commit and advance the dash');
    assert.deepEqual(f.sim, before, 'Decision adapter is read-only');
    const frame = { pos: f.bot.pos, vel: f.bot.vel, yaw: f.bot.yaw, aiState: f.bot.aiState, timer: 0,
      dashRemaining: 0, slideActive: false, weaponState: 'ready', pickupRequested: false };
    const start = f.bot.pos.clone(); let calls = 0;
    const handled = resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state: f.state, botId: id, self: f.bot, frame,
      alliesList: [], enemiesList: [f.target.pos], dt, canStartWeaponAction: true,
      triggerCombatantAttack: () => assert.fail('No punch expected'), getEnemyGoalPos: f.goal,
      constrainCombatantToArena: () => assert.fail('Dash owner must integrate and constrain'),
      tryRunnerEvasion: movement => {
        calls++;
        const direction = selectGrifballRunnerEvasion({ snapshot: createLiveGrifballTacticalSnapshot(f.state, f.goal, f.map),
          assignment: f.state.aiMatchContext.grifballTeamPlan.assignments.get(id), botId: id, origin: f.bot.pos, movement,
          distance: f.state.settings.dashDistance, duration: f.state.settings.dashDuration });
        assert.ok(direction); near(direction.x, result.evasion.x, 'Escape x'); near(direction.z, result.evasion.z, 'Escape z');
        return true;
      } });
    assert.equal(calls, 1); assert.equal(handled, false); assert.deepEqual(f.bot.pos, start);
  });

for (const condition of ['not-owned', 'thrust-off', 'cooldown', 'reload', 'recovering', 'punching', 'airborne', 'sliding', 'already-dashing', 'pass', 'punch'] as const)
  test(`runner input cannot replace ${condition} with an escape`, () => {
    const f = runnerWindup();
    if (condition === 'thrust-off') f.sim.settings.grifballAllowRunnerThrust = false;
    if (condition === 'cooldown') f.self.dashCooldownTimer = .1;
    if (condition === 'recovering') f.self.weaponState = 'recovering';
    if (condition === 'punching') f.self.weaponState = 'windup';
    if (condition === 'airborne') f.self.pos.y = 1;
    if (condition === 'sliding') f.self.slideActive = true;
    if (condition === 'already-dashing') f.self.dashRemaining = .1;
    if (condition === 'pass') f.plan.assignments.get(f.self.id)!.pass = { selected: { direction: { x: 1, z: 0 } } } as any;
    if (condition === 'punch') f.other.pos.x = f.self.pos.x + 1;
    const result = resolveSimGrifballCarrierInput(f.sim, f.plan, f.self.id, f.scriptedBots, condition !== 'reload', dt,
      { evasion: condition !== 'not-owned' });
    assert.ok(!result?.evasion);
    if (condition === 'pass' || condition === 'punch') assert.equal(result?.decision.kind, condition);
  });

for (const id of ['bot_2', 'main_ai']) for (const mirror of [false, true]) for (const routed of [false, true]) for (const pickup of [false, true]) for (const coordinated of [false, true])
  test(`independent planner carries to goal ${id}/mirror=${mirror}/routed=${routed}/pickup=${pickup}/coordinated=${coordinated}`, () => {
    const f = fixture(id, mirror, routed, pickup), { sim, state, self, bot, plan, scriptedBots } = f;
    state.grifballTactics.defaults.enabled = coordinated;
    let acquired = !pickup, goalTick = 0, maxLateral = 0, runnerTicks = 0;
    for (let tick = 1; tick <= 600; tick++) {
      updateGrifballTeamPlanForState(state, dt, f.goal, f.map);
      updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, pickupRequests: { [id]: false }, tactics: state.grifballTactics }), dt);
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

for (const id of ['bot_2', 'main_ai']) for (const mirror of [false, true])
  for (const location of ['front', 'flank', 'rear', 'far-flank'] as const)
  test(`planned local blocker avoidance agrees across hosts ${id}/mirror=${mirror}/${location}`, () => {
    const f = fixture(id, mirror, false, false), { sim, state, self, bot, plan, scriptedBots } = f;
    state.grifballTactics.defaults.stylesEnabled = false;
    updateGrifballTeamPlanForState(state, .2, f.goal, f.map);
    updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots, tactics: state.grifballTactics }), .2);
    const sign = mirror ? -1 : 1;
    f.other.pos = { x: self.pos.x + (location === 'front' ? 5 : -1) * sign, y: 0,
      z: (location === 'front' ? .5 : location === 'flank' ? 2.5 : location === 'rear' ? 0 : 6) * sign };
    f.target.pos.set(f.other.pos.x, 0, f.other.pos.z);
    const carrier = resolveSimGrifballCarrierInput(sim, plan, id, scriptedBots, false)!;
    assert.equal(carrier.decision.kind, 'move');
    if (location === 'front' || location === 'flank') assert.ok(carrier.decision.velocity.z * sign < -.01, 'simulation must open clearance from the nearby threat');
    else near(carrier.decision.velocity.z, 0, 'straight pursuit or distant flank keeps the direct route');
    const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: 0,
      dashRemaining: 0, slideActive: false, weaponState: 'ready', pickupRequested: false };
    assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: id, self: bot, frame,
      alliesList: [], enemiesList: [f.target.pos], dt, canStartWeaponAction: false,
      triggerCombatantAttack: () => assert.fail('avoidance must not start an attack'), getEnemyGoalPos: f.goal,
      constrainCombatantToArena: () => {} }));
    stepSimulation(sim, { [id]: carrier.input!.action }, { settings: sim.settings, scriptedObjective: carrier.input!.scriptedObjective });
    for (const axis of ['x', 'y', 'z'] as const) {
      near(bot.pos[axis], self.pos[axis], `position.${axis}`);
      near(bot.vel[axis], self.vel[axis], `velocity.${axis}`);
    }
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
