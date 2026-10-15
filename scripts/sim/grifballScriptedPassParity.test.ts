import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, SCRIPTED_PASS_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
for (const main of [false, true]) for (const mirror of [false, true]) for (const reverse of [false, true]) for (const charged of [false, true])
  test(`independent scripted pass release, settling and receipt main=${main}/mirror=${mirror}/reverse=${reverse}/charged=${charged}`, () => {
    const id = main ? 'main_ai' : 'carrier', sign = mirror ? -1 : 1;
    const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'receiver');
    const { sim, state, bot, target } = f, [actor, receiver] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
    state.grifballTactics = defaultGrifballTactics();
    actor.id = id; receiver.id = target.id;
    for (const [i, [c, live]] of ([[actor, bot], [receiver, target]] as const).entries()) {
      c.controller = live.controller = 'ai'; c.team = live.team = mirror ? 'red' : 'blue';
      c.pos = { x: (i ? -8 : -20) * sign, y: 0, z: 0 }; live.pos.set(c.pos.x, 0, 0);
      c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
      c.yaw = 0; live.yaw = Math.PI; c.hp = c.maxHp = live.hp;
      c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    }
    sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = id;
    setSimCarrier(actor, true, sim.settings); setGrifballCarrierForState({ state, id, carrying: true });
    if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
    const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION,
      scriptedBots: { [id]: 'normal', receiver: 'normal' }, plan: createGrifballTeamPlanState(),
      punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { [id]: 0, receiver: 0 } }, passControl: SCRIPTED_PASS_VERSION };
    const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)!.position;
    // Charged cases start from an independently earned nonzero-charge candidate.
    // Ordinary cases let the policy choose its preferred pass with no intervention.
    if (charged) {
      updateGrifballTeamPlanForState(state, dt, goal, f.map);
      updateGrifballTeamPlan(planner.plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots: planner.scriptedBots }), dt);
      for (const plan of [planner.plan, state.aiMatchContext.grifballTeamPlan]) {
        const pass = plan.assignments.get(id)!.pass!;
        pass.selected = pass.candidates.find(c => c.viable && c.chargeSeconds > 0)!;
        assert.ok(pass.selected);
        plan.passCharge = { carrierId: id, receiverId: pass.selected.receiverId, speed: pass.selected.speed, elapsed: 0 };
      }
    }
    let releaseTick = 0, receiptTick = 0, chargingFrames = 0;
    for (let tick = 1; tick <= 600; tick++) {
      f.weaponFrame(dt); f.respawns(dt); updateGrifballTeamPlanForState(state, dt, goal, f.map);
      for (const live of state.otherPlayers.values()) {
        const frame = { pos: live.pos, vel: live.vel, yaw: live.yaw, aiState: live.aiState, timer: live.aiTimer ?? 0,
          dashRemaining: 0, slideActive: false, weaponState: live.weaponState ?? 'ready', pickupRequested: !!live.pickupRequested };
        assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: live.id, self: live, frame,
          alliesList: [...state.otherPlayers.values()].filter(c => c !== live).map(c => c.pos), enemiesList: [], dt,
          canStartWeaponAction: true, triggerCombatantAttack: () => assert.fail('unopposed pass must not punch'), getEnemyGoalPos: goal,
          constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }));
        live.yaw = frame.yaw; live.aiState = frame.aiState; live.aiTimer = frame.timer; live.pickupRequested = frame.pickupRequested;
      }
      updateGrifballObjectiveForState({ state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'), pushStatsUpdate: () => {} });
      f.visuals(dt);
      const events = stepSimulation(sim, {}, { settings: sim.settings, scriptedPlanner: planner });
      if (events.scriptedPass?.kind === 'charging') chargingFrames++;
      assert.ok(events.plannerFrame!.decisions.every(d => d.kind === 'carrier' || d.kind === 'support'));
      assert.equal(sim.match.ball.state, state.grifball.ball.state, `${tick}/ball state`);
      assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId, `${tick}/holder`);
      for (const axis of ['x', 'y', 'z'] as const) {
        near(sim.match.ball.pos[axis], state.grifball.ball.pos[axis], `${tick}/ball position.${axis}`);
        near(sim.match.ball.vel[axis], state.grifball.ball.vel[axis], `${tick}/ball velocity.${axis}`);
      }
      assert.deepEqual(planner.plan.passCharge, state.aiMatchContext.grifballTeamPlan.passCharge, `${tick}/charge`);
      assert.deepEqual(planner.plan.passFlight, state.aiMatchContext.grifballTeamPlan.passFlight, `${tick}/receiver intent`);
      for (const c of sim.combatants) {
        const live = state.otherPlayers.get(c.id)!;
        for (const axis of ['x', 'y', 'z'] as const) { near(c.pos[axis], live.pos[axis], `${tick}/${c.id}/position.${axis}`); near(c.vel[axis], live.vel[axis], `${tick}/${c.id}/velocity.${axis}`); }
        near(Math.sin(c.yaw), -Math.sin(live.yaw), `${tick}/${c.id}/heading.x`); near(Math.cos(c.yaw), -Math.cos(live.yaw), `${tick}/${c.id}/heading.z`);
        assert.equal(c.hp, live.hp); assert.equal(c.maxHp, live.maxHp); assert.equal(c.weapon, live.activeWeapon);
      }
      if (events.scriptedPass?.kind === 'release') { assert.equal(releaseTick, 0); releaseTick = tick; }
      if (sim.match.ball.holderId === receiver.id) { receiptTick = tick; break; }
    }
    assert.ok(releaseTick > 0 && receiptTick > releaseTick, `release=${releaseTick}, receipt=${receiptTick}`);
    if (charged) assert.ok(chargingFrames > 0 && releaseTick >= 18, `charge=${chargingFrames}, release=${releaseTick}`);
    assert.equal(receiver.hasBall, true); assert.equal(actor.hasBall, false);
  });
