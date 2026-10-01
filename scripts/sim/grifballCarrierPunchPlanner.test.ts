import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { canStartAIWeaponAction } from '../../src/components/grifball/aiWeaponTimingRuntime';
import { tickAIEngagementCooldowns } from '../../src/components/grifball/aiEngagementFrameRuntime';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
for (const main of [false, true]) for (const mirror of [false, true]) for (const tuned of [false, true])
  test(`own-state carrier punch, recovery and reattack main=${main}/mirror=${mirror}/tuned=${tuned}`, () => {
    const id = main ? 'main_ai' : 'carrier', sign = mirror ? -1 : 1;
    const f = createBotParityFixture(id, true, { aiDifficulty: 'normal', grifballAllowThrowing: false,
      speedForward: 20, grifballRunnerSpeedForward: 20, ...(tuned ? { hammerMeleeSpeed: .37, grifballPunchCooldown: .75 } : {}) });
    const { state, sim, bot, target } = f, [actor, other] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
    state.grifballTactics = defaultGrifballTactics();
    actor.id = id; other.id = target.id; actor.controller = bot.controller = other.controller = target.controller = 'ai';
    // Observed but not scripted: the stationary opponent supplies no AI input.
    target.difficulty = 'neural-net';
    actor.team = bot.team = mirror ? 'red' : 'blue'; other.team = target.team = mirror ? 'blue' : 'red';
    actor.pos = { x: 0, y: 0, z: 0 }; bot.pos.set(0, 0, 0);
    other.pos = { x: 1.8 * sign, y: 0, z: 0 }; target.pos.set(other.pos.x, 0, 0);
    for (const [c, live] of [[actor, bot], [other, target]] as const) {
      c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
      c.yaw = 0; live.yaw = Math.PI; c.hp = c.maxHp = live.hp;
      c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    }
    sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = id;
    setSimCarrier(actor, true, sim.settings); setGrifballCarrierForState({ state, id, carrying: true });
    bot.aiState = 'COOLDOWN'; bot.aiTimer = .08; bot.swapCooldownTimer = actor.weaponReadyTimer = .05;
    const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION, scriptedBots: { [id]: 'normal' },
      plan: createGrifballTeamPlanState(), punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { [id]: .08 } } };
    const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)!.position;
    const liveAttacks: number[] = [], simAttacks: number[] = [], impacts: number[] = [];
    let damageTicks = 0, previousHp = target.hp;
    for (let tick = 1; tick <= 240; tick++) {
      f.weaponFrame(dt); f.respawns(dt);
      updateGrifballTeamPlanForState(state, dt, goal, f.map);
      const frame = { pos: bot.pos, vel: bot.vel, yaw: bot.yaw, aiState: bot.aiState, timer: bot.aiTimer ?? 0,
        dashRemaining: 0, slideActive: false, weaponState: bot.weaponState ?? 'ready', pickupRequested: false,
        dashCooldownTimer: 0, slideCooldownTimer: 0, hammerJumpCooldownTimer: 0 };
      tickAIEngagementCooldowns({ frame, self: bot, botId: id, mainAIId: 'main_ai', dt });
      assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: id, self: bot, frame,
        alliesList: [], enemiesList: [target.pos], dt,
        canStartWeaponAction: canStartAIWeaponAction({ aiState: frame.aiState, timer: frame.timer, swapCooldownTimer: bot.swapCooldownTimer }),
        triggerCombatantAttack: () => { f.attack(); liveAttacks.push(tick); }, getEnemyGoalPos: goal,
        constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }));
      bot.yaw = frame.yaw; bot.aiState = frame.aiState; bot.aiTimer = frame.timer; bot.pickupRequested = frame.pickupRequested;
      updateGrifballObjectiveForState({ state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'), pushStatsUpdate: () => {} });
      f.visuals(dt);
      const event = stepSimulation(sim, {}, { settings: sim.settings, scriptedPlanner: planner });
      const decision = event.plannerFrame!.decisions[0];
      assert.equal(decision.kind, 'carrier');
      if (decision.action!.attackPrimary) simAttacks.push(tick);
      assert.deepEqual(simAttacks, liveAttacks, `attack commitment tick ${tick}`);
      near(planner.punchControl!.cooldowns[id], bot.aiState === 'COOLDOWN' ? bot.aiTimer ?? 0 : 0, `${tick}/AI reload`);
      const phase = bot.weaponState === 'ready' ? 'idle' : bot.weaponState === 'swing_up' ? 'windup' : bot.weaponState === 'swing_down' ? 'active' : 'recovering';
      assert.equal(actor.weaponState, phase, `${tick}/phase`);
      near(actor.weaponPhaseElapsed ?? 0, bot.weaponTimer ?? 0, `${tick}/animation clock`);
      for (const axis of ['x', 'y', 'z'] as const) { near(actor.pos[axis], bot.pos[axis], `${tick}/position.${axis}`); near(actor.vel[axis], bot.vel[axis], `${tick}/velocity.${axis}`); }
      near(Math.sin(actor.yaw), -Math.sin(bot.yaw), `${tick}/heading.x`); near(Math.cos(actor.yaw), -Math.cos(bot.yaw), `${tick}/heading.z`);
      assert.equal(other.hp, target.hp, `${tick}/damage`); assert.equal(actor.hp, bot.hp);
      assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId); assert.equal(sim.match.phase, state.grifball.phase);
      if (target.hp < previousHp) { damageTicks++; previousHp = target.hp; impacts.push(tick); }
    }
    assert.equal(liveAttacks[0], 6, 'five handled decisions spend the initial .08-second reload; readiness is sampled before spending');
    // Independent integer-frame oracle: default .24/.12/.5 clocks take 15/8/31
    // additions; tuned .37/.185/.75 take 23/12/45. The first attack spends a tick.
    assert.deepEqual(liveAttacks, tuned ? [6, 86, 166] : [6, 60, 114, 168, 222]);
    assert.deepEqual(impacts, tuned ? [40, 120, 200] : [28, 82, 136, 190]);
    assert.ok(liveAttacks.length >= 3 && damageTicks >= 3, `${liveAttacks.length} commitments/${damageTicks} impacts`);
    assert.equal(20 - target.hp, damageTicks);
  });
