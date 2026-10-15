import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballSupportInput } from '../../src/sim/grifballSupportInput';
import { stepSimulation } from '../../src/sim/step';
import { SCRIPTED_OBJECTIVE_PLANNER_VERSION, type ScriptedObjectivePlanner } from '../../src/sim/scriptedObjectivePlanner';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolvePrimaryGrifballAIObjectiveMovementForCombatant } from '../../src/components/grifball/grifballAIObjectiveMovement';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';

const dt = 1 / 60;
const near = (a: number, b: number, label: string) => assert.ok(Math.abs(a - b) < 1e-6, `${label}: ${a} != ${b}`);
function fixture(main = false, reverse = false, mirror = false) {
  const f = createBotParityFixture(main ? 'main_ai' : 'collector', true, { aiDifficulty: 'normal' }, 'cover');
  f.sim.combatExecution = 'live-roster-v2'; f.sim.match.phase = 'playing';
  f.state.grifball = structuredClone(f.sim.match); f.state.grifballTactics = defaultGrifballTactics();
  const sign = mirror ? -1 : 1;
  f.sim.match.ball.pos.x = f.state.grifball.ball.pos.x = 8 * sign;
  for (const [i, live] of [f.bot, f.target].entries()) {
    const c = f.sim.combatants[i]; c.id = live.id; c.controller = live.controller = 'ai'; c.team = live.team = mirror ? 'red' : 'blue';
    c.pos = { x: (i ? 0 : 1) * sign, y: 0, z: 0 }; live.pos.set(c.pos.x, 0, 0);
    c.vel = { x: 0, y: 0, z: 0 }; live.vel.set(0, 0, 0);
    c.weaponReadyTimer = c.invulnerabilityTimer = 0; c.hp = c.maxHp = live.hp;
    c.yaw = 0; live.yaw = Math.PI;
  }
  if (reverse) { f.sim.combatants.reverse(); f.state.otherPlayers = new Map([...f.state.otherPlayers].reverse()); }
  const planner: ScriptedObjectivePlanner = { version: SCRIPTED_OBJECTIVE_PLANNER_VERSION, plan: createGrifballTeamPlanState(),
    scriptedBots: { [f.bot.id]: 'normal', [f.target.id]: 'normal' }, weaponReady: { [f.bot.id]: true, [f.target.id]: true } };
  const goal = (team: string | undefined) => f.sim.goalPlates.find(p => p.team !== team)!.position;
  const liveStep = () => {
    updateGrifballTeamPlanForState(f.state, dt, goal, f.map);
    for (const live of f.state.otherPlayers.values()) {
      const frame = { pos: live.pos, vel: live.vel, yaw: live.yaw, aiState: live.aiState, timer: live.aiTimer ?? 0,
        dashRemaining: 0, slideActive: false, weaponState: live.weaponState ?? 'ready', pickupRequested: !!live.pickupRequested };
      assert.ok(resolvePrimaryGrifballAIObjectiveMovementForCombatant({ state: f.state, botId: live.id, self: live, frame,
        alliesList: [...f.state.otherPlayers.values()].filter(c => c.id !== live.id).map(c => c.pos), enemiesList: [], dt,
        canStartWeaponAction: true, triggerCombatantAttack: () => assert.fail('unopposed frame must not attack'), getEnemyGoalPos: goal,
        constrainCombatantToArena: (pos, vel) => constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: f.map, arenaRadius: f.state.arenaRadius }) }));
      live.yaw = frame.yaw; live.pickupRequested = frame.pickupRequested; live.aiState = frame.aiState; live.aiTimer = frame.timer;
    }
    updateGrifballObjectiveForState({ state: f.state, refs: f.refs, ballMeshRef: { current: null }, ballChargingRef: { current: false },
      ballChargeTimerRef: { current: 0 }, dt, isMultiplayer: false, activeCustomMap: f.map,
      placeCombatantsAtGrifballSpawns: () => assert.fail('unexpected reset'), pushStatsUpdate: () => {} });
  };
  return { ...f, planner, liveStep };
}

test('actor-turn planning fixes the reproduced stale teammate separation', () => {
  const f = fixture(), precomputed = structuredClone(f.sim), oldPlan = createGrifballTeamPlanState();
  updateGrifballTeamPlan(oldPlan, createSimGrifballTacticalSnapshot(precomputed, { scriptedBots: f.planner.scriptedBots }), dt);
  const oldInputs = precomputed.combatants.map(c => resolveSimGrifballSupportInput(precomputed, oldPlan, c.id, f.planner.scriptedBots)!);
  stepSimulation(precomputed, Object.fromEntries(precomputed.combatants.map((c, i) => [c.id, oldInputs[i].action])), {
    settings: precomputed.settings, scriptedObjective: { ...oldInputs[0].scriptedObjective,
      movement: Object.assign({}, ...oldInputs.map(i => i.scriptedObjective.movement)) } });
  f.liveStep();
  const events = stepSimulation(f.sim, {}, { settings: f.sim.settings, scriptedPlanner: f.planner });
  assert.deepEqual(events.plannerFrame!.decisions.map(d => [d.id, d.kind]), [['collector', 'support'], ['cover', 'support']]);
  for (const c of f.sim.combatants) near(c.pos.x, f.state.otherPlayers.get(c.id)!.pos.x, c.id);
  near(Math.abs(f.target.pos.x - precomputed.combatants[1].pos.x), .004131111111111113, 'known precomputed-input error');
  assert.notEqual(events.plannerFrame!.decisions[1].movement!.x, oldInputs[1].scriptedObjective.movement.cover.x);
});

for (const main of [false, true]) for (const reverse of [false, true]) for (const mirror of [false, true])
  test(`own-state sequential retrieval and escort main=${main}/reverse=${reverse}/mirror=${mirror}`, () => {
    const f = fixture(main, reverse, mirror);
    let goalTick = 0, carrierFrames = 0;
    for (let tick = 1; tick <= 600; tick++) {
      f.liveStep();
      const events = stepSimulation(f.sim, {}, { settings: f.sim.settings, scriptedPlanner: f.planner });
      assert.deepEqual(events.plannerFrame!.decisions.map(d => d.id), f.sim.combatants.map(c => c.id));
      assert.ok(events.plannerFrame!.decisions.every(d => d.kind === 'support' || d.kind === 'carrier'), JSON.stringify(events.plannerFrame));
      if (events.plannerFrame!.decisions.some(d => d.kind === 'carrier')) carrierFrames++;
      assert.equal(f.planner.plan.revision, f.state.aiMatchContext.grifballTeamPlan.revision);
      for (const c of f.sim.combatants) {
        const live = f.state.otherPlayers.get(c.id)!;
        for (const axis of ['x', 'y', 'z'] as const) { near(c.pos[axis], live.pos[axis], `${tick}/${c.id}/position.${axis}`); near(c.vel[axis], live.vel[axis], `${tick}/${c.id}/velocity.${axis}`); }
        near(Math.sin(c.yaw), -Math.sin(live.yaw), `${tick}/${c.id}/heading.x`);
        near(Math.cos(c.yaw), -Math.cos(live.yaw), `${tick}/${c.id}/heading.z`);
        assert.equal(c.hp, live.hp);
      }
      assert.equal(f.sim.match.ball.holderId, f.state.grifball.ball.holderId);
      assert.equal(f.sim.match.phase, f.state.grifball.phase);
      for (const team of ['blue', 'red'] as const) assert.equal(f.sim.scores[team].goals, f.state.teamScores[team].goals);
      if (f.sim.scores[f.bot.team!].goals > 0) { goalTick = tick; break; }
    }
    assert.ok(goalTick > 0 && carrierFrames > 200);
    assert.equal(f.sim.scores[f.bot.team!].goals, 1);
  });
