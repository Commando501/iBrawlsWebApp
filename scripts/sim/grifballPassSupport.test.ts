import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { deflectBallWithHammer } from '../../src/game/hammerBallDeflection';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, SCRIPTED_CARRIER_PUNCH_VERSION, SCRIPTED_PASS_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { setGrifballCarrierForState, updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { createOfflineBotCombatant } from '../../src/game/roster';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
for (const redirect of [false, true])
for (const enabled of [false, true]) for (const main of [false, true]) for (const mirror of [false, true]) for (const reverse of [false, true])
  test(`live/sim pass landing support redirect=${redirect}/enabled=${enabled}/main=${main}/mirror=${mirror}/reverse=${reverse}`, () => {
    const id = main ? 'main_ai' : 'carrier', sign = mirror ? -1 : 1;
    const f = createBotParityFixture(id, true, { aiDifficulty: 'normal' }, 'receiver');
    const { sim, state, bot, target } = f, [actor, receiver] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing'; state.grifball = structuredClone(sim.match);
    state.grifballTactics = defaultGrifballTactics();
    Object.assign(state.grifballTactics.defaults, { passSupportEnabled: enabled, passRecoveryEnabled: true, stylesEnabled: false });
    state.grifballTactics.teams.red = { passSupportDepth: 6 };
    actor.id = id; receiver.id = target.id;
    for (const [i, [c, live]] of ([[actor, bot], [receiver, target]] as const).entries()) {
      c.controller = live.controller = 'ai'; c.team = live.team = mirror ? 'red' : 'blue';
      c.pos = { x: (i ? -8 : -20) * sign, y: 0, z: 0 }; live.pos.set(c.pos.x, 0, 0);
      c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
      c.yaw = 0; live.yaw = Math.PI; c.hp = c.maxHp = live.hp;
      c.weaponReadyTimer = c.invulnerabilityTimer = 0;
    }
    const support = structuredClone(receiver); support.id = 'support';
    support.pos = { x: -22 * sign, y: 0, z: 8 * sign }; sim.combatants.push(support);
    const liveSupport = createOfflineBotCombatant({ id: support.id, playerName: 'Support', team: target.team,
      spawnPos: target.pos.clone().set(support.pos.x, 0, support.pos.z), yaw: Math.PI, hue: 0, difficulty: 'normal', settings: state.settings });
    liveSupport.invulnerabilityTimer = 0; liveSupport.weaponState = 'ready'; liveSupport.weaponTimer = 0;
    state.otherPlayers.set(liveSupport.id, liveSupport);
    sim.match.ball.state = state.grifball.ball.state = 'held'; sim.match.ball.holderId = state.grifball.ball.holderId = id;
    setSimCarrier(actor, true, sim.settings); setGrifballCarrierForState({ state, id, carrying: true });
    if (reverse) { sim.combatants.reverse(); state.otherPlayers = new Map([...state.otherPlayers].reverse()); }
    const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION,
      scriptedBots: { [id]: 'normal', receiver: 'normal', support: 'normal' }, plan: createGrifballTeamPlanState(),
      tactics: structuredClone(state.grifballTactics),
      punchControl: { version: SCRIPTED_CARRIER_PUNCH_VERSION, cooldowns: { [id]: 0, receiver: 0, support: 0 } }, passControl: SCRIPTED_PASS_VERSION };
    const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)!.position;
    let releaseTick = 0, receiptTick = 0, handoff = false, deflected = false, supportTicks = 0;
    const landingPoints = new Set<string>();
    for (let tick = 1; tick <= 600; tick++) {
      // Apply the same real hammer contact independently to each engine's ball,
      // after an earned release. No assignment or recovery result is injected.
      if (redirect && releaseTick && !deflected) {
        for (const ball of [state.grifball.ball, sim.match.ball]) assert.ok(deflectBallWithHammer(ball,
          { x: ball.pos.x + sign, y: ball.pos.y, z: ball.pos.z }, { ...ball.pos }, 2,
          { hammerBallDeflectionEnabled: true, hammerBallDeflectionStrength: 1 }));
        deflected = true;
      }
      f.weaponFrame(dt); f.respawns(dt); updateGrifballTeamPlanForState(state, dt, goal, f.map);
      for (const live of state.otherPlayers.values()) {
        const frame = { pos: live.pos, vel: live.vel, yaw: live.yaw, aiState: live.aiState, timer: live.aiTimer ?? 0,
          dashRemaining: 0, slideActive: false, weaponState: live.weaponState ?? 'ready', pickupRequested: !!live.pickupRequested };
        assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state, botId: live.id, self: live, frame,
          alliesList: [...state.otherPlayers.values()].filter(c => c !== live).map(c => c.pos), enemiesList: [], dt,
          canStartWeaponAction: true, triggerCombatantAttack: () => assert.fail('unopposed recovery must not punch'), getEnemyGoalPos: goal,
          constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: state.arenaRadius }) }));
        live.yaw = frame.yaw; live.aiState = frame.aiState; live.aiTimer = frame.timer; live.pickupRequested = frame.pickupRequested;
      }
      updateGrifballObjectiveForState({ state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
        ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
        placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'), pushStatsUpdate: () => {} });
      f.visuals(dt);
      const events = stepSimulation(sim, {}, { settings: sim.settings, scriptedPlanner: planner });
      assert.equal(sim.match.ball.state, state.grifball.ball.state, `${tick}/ball state`);
      assert.equal(sim.match.ball.holderId, state.grifball.ball.holderId, `${tick}/holder`);
      for (const axis of ['x', 'y', 'z'] as const) {
        near(sim.match.ball.pos[axis], state.grifball.ball.pos[axis], `${tick}/ball position.${axis}`);
        near(sim.match.ball.vel[axis], state.grifball.ball.vel[axis], `${tick}/ball velocity.${axis}`);
      }
      assert.deepEqual(planner.plan.passFlight, state.aiMatchContext.grifballTeamPlan.passFlight, `${tick}/reservation`);
      for (const c of sim.combatants) {
        const live = state.otherPlayers.get(c.id)!;
        for (const axis of ['x', 'y', 'z'] as const) near(c.pos[axis], live.pos[axis], `${tick}/${c.id}/position.${axis}`);
        const a = planner.plan.assignments.get(c.id), liveAssignment = state.aiMatchContext.grifballTeamPlan.assignments.get(c.id);
        assert.deepEqual(a?.defense, liveAssignment?.defense, tick + '/' + c.id + '/defense');
        assert.deepEqual(a?.destination, liveAssignment?.destination, tick + '/' + c.id + '/destination');
        if (a?.defense?.passSupport) {
          assert.ok(enabled); supportTicks++;
          const receiverOrder = [...planner.plan.assignments.values()].find(order => order.role === 'retriever');
          assert.ok(receiverOrder); assert.equal(a.defense.passSupport.receiverId, receiverOrder.botId);
          assert.deepEqual(a.anchor, receiverOrder.receive!.point);
          landingPoints.add(a.anchor.x.toFixed(1));
        }
      }
      const orders = [...planner.plan.assignments.values()], supporting = orders.filter(a => a.defense?.passSupport);
      if (supporting.length) {
        assert.equal(supporting.length, 2);
        assert.equal(supporting.filter(a => a.defense?.mode === 'last-defender').length, 1);
        assert.equal(supporting.filter(a => a.defense?.mode === 'recover').length, 1);
        assert.ok(orders.filter(a => a.role === 'retriever').every(a => !a.defense));
      }
      if (events.scriptedPass?.kind === 'release') { assert.equal(releaseTick, 0); releaseTick = tick; }
      if (planner.plan.passFlight?.receiverId === id) handoff = true;
      if (releaseTick && sim.match.ball.holderId) { receiptTick = tick; break; }
    }
    assert.ok(receiptTick > releaseTick, `release=${releaseTick}, receipt=${receiptTick}`);
    assert.equal(deflected, redirect); assert.equal(supportTicks > 0, enabled);
    if (redirect) assert.ok(handoff, 'redirected pass must exercise a receiver handoff');
    if (enabled && redirect) assert.ok(landingPoints.size > 1, 'support must update after the changed trajectory');
    // Possession clears landing support at the next shared planner update.
    updateGrifballTeamPlanForState(state, dt, goal, f.map);
    assert.ok([...state.aiMatchContext.grifballTeamPlan.assignments.values()].every(a => !a.defense?.passSupport));
  });
