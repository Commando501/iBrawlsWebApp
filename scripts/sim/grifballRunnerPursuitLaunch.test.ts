import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { createGrifballTeamPlanState, updateGrifballTeamPlan } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { resolveGrifballRunnerPursuitLaunch } from '../../src/game/aiGrifballRunnerPursuitLaunch';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballGroundOpportunityInput } from '../../src/sim/grifballGroundOpportunityInput';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { stepSimulation } from '../../src/sim/step';

const noop = () => {}, dt = 1 / 60;
function fixture(id = 'bot_2', sign = 1) {
  const f = attachLungeRuntime(createBotParityFixture(id, true, { aiDifficulty: 'normal', enableSwordTrade: false,
    enableHammerSwordTrade: false, weaponReadyTime: .2 }, 'runner'));
  const [self, runner] = f.sim.combatants;
  self.id = id; runner.id = f.target.id; self.controller = 'ai'; runner.controller = f.target.controller = 'remote';
  f.sim.combatExecution = 'live-roster-v2'; f.sim.match.phase = 'playing';
  self.team = f.bot.team = sign > 0 ? 'red' : 'blue'; runner.team = f.target.team = sign > 0 ? 'blue' : 'red';
  self.pos = { x: 0, y: 0, z: 0 }; f.bot.pos.set(0, 0, 0);
  runner.pos = { x: 8 * sign, y: 0, z: 0 }; f.target.pos.set(8 * sign, 0, 0);
  runner.vel = { x: 5.8 * sign, y: 0, z: 5.8 * sign }; f.target.vel.set(5.8 * sign, 0, 5.8 * sign);
  self.weapon = f.bot.activeWeapon = 'sword';
  for (const actor of [self, runner]) actor.invulnerabilityTimer = actor.weaponReadyTimer = actor.swapLockoutTimer = 0;
  f.bot.swapLockoutTimer = f.target.swapLockoutTimer = 0;
  setSimCarrier(runner, true, f.sim.settings, f.sim); setGrifballCarrierForState({ state: f.state, id: runner.id, carrying: true });
  f.sim.match.ball.state = f.state.grifball.ball.state = 'held';
  f.sim.match.ball.holderId = f.state.grifball.ball.holderId = runner.id;
  f.sim.combatants.push({ ...structuredClone(self), id: 'safety', pos: { x: 35 * sign, y: 0, z: 0 } });
  f.state.otherPlayers.set('safety', { ...f.bot, id: 'safety', pos: f.bot.pos.clone().set(35 * sign, 0, 0), vel: f.bot.vel.clone() });
  const tactics = defaultGrifballTactics(); Object.assign(tactics.defaults, { runnerPursuitEnabled: true, stylesEnabled: false });
  f.state.grifballTactics = tactics;
  const owners = { [id]: 'normal', safety: 'normal' };
  const liveSnapshot = () => createLiveGrifballTacticalSnapshot(f.state, team => f.sim.goalPlates.find(g => g.team !== team)!.position, f.map);
  const livePlan = f.state.aiMatchContext.grifballTeamPlan, simPlan = createGrifballTeamPlanState();
  updateGrifballTeamPlan(livePlan, liveSnapshot(), .1);
  updateGrifballTeamPlan(simPlan, createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: owners, tactics }), .1);
  assert.equal(livePlan.assignments.get(id)!.defense!.pursuit!.weapon, 'sword');
  const memory = { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 };
  const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80, playstyleFactor: .5,
    weaponPrioritization: 50, spacingFactor: 1, aggressiveLungeMult: 1, feintChance: 0 };
  let callbacks = 0, observations = 0, draws = 0;
  const launch = (patch: Partial<Parameters<typeof resolveAIGroundAttackOpportunityForCombatant>[0]> = {}) =>
    resolveAIGroundAttackOpportunityForCombatant({ state: f.state, self: f.bot, botId: id,
      target: getTacticalTargetByIdFromState(f.state, id, runner.id, [...f.state.otherPlayers.values()])!,
      frame: { pos: f.bot.pos, vel: f.bot.vel, ...memory, weaponState: 'ready' },
      activeWeapon: 'sword', canStartWeaponAction: true, targetAirborne: false, targetProtected: false,
      enemyInKillRange: false, selfGrounded: true, slideActive: false, cooldownMultiplier: 1,
      swordForbidden: false, swapLockoutRemaining: 0, swapFeintActive: false, comboActive: false, feintChance: 0,
      lungeDistanceToTarget: 8, hasVerticalLungeLine: true, minLungeRange: 3, maxLungeRange: 14.5,
      combatDistanceToTarget: 8, distanceToTarget: 8, resolvedAiReach: 3, aggressiveLungeMult: 1,
      tunedAnticipationFactor: 0, playstyleFactor: .5, tuning: resolveBehaviorTuning(f.state.settings),
      constrainCombatantToArena: noop, triggerCombatantAttack: noop,
      applyTacticalWeapon: () => assert.fail('No extra swap'), startWeaponSwapFeintTimer: noop,
      commitFeint: noop, tryFeintRoll: () => false, getTargetPlayerModel: () => null,
      random: () => { draws++; return 0; },
      resolveRunnerPursuitLaunch: () => { callbacks++; return resolveGrifballRunnerPursuitLaunch(livePlan.assignments.get(id), liveSnapshot(), runner.id); },
      triggerCombatantLunge: () => assert.fail('Use a typed lunge callback'),
      recordCombatantObservation: () => { observations++; }, ...patch,
    });
  return { ...f, self, runner, tactics, owners, livePlan, simPlan, memory, tuning, launch,
    counts: () => ({ callbacks, observations, draws }) };
}

for (const id of ['main_ai', 'bot_2']) for (const sign of [-1, 1]) for (const enabled of [false, true])
  test(`crossing runner actual launch and contact: ${id}/${sign}/pursuit-${enabled}`, () => {
    const f = fixture(id, sign);
    f.tactics.defaults.runnerPursuitEnabled = enabled;
    f.simPlan.snapshot!.tactics!.defaults.runnerPursuitEnabled = enabled;
    // The runner turns after planning; both launch owners must use fresh velocity.
    f.runner.vel.z *= -1; f.target.vel.z *= -1;
    const before = structuredClone(f.sim);
    const simContext = { weaponFrame: { activeWeapon: 'sword' as const, weaponState: 'ready' as const,
      canStartWeaponAction: true, observedSwapLockout: 0, currentSwapLockout: 0, readinessRemaining: 0 },
      comboActive: false, feints: {}, random: () => 0 };
    const result = resolveSimGrifballGroundOpportunityInput(f.sim, f.simPlan, id, f.owners, f.tuning, f.memory, simContext)!;
    assert.ok(result);
    assert.deepEqual(f.sim, before);
    assert.deepEqual(resolveSimGrifballGroundOpportunityInput(JSON.parse(JSON.stringify(f.sim)), structuredClone(f.simPlan),
      id, f.owners, f.tuning, f.memory, simContext), result, 'restored own-state decisions are identical');
    const live = f.launch({ triggerCombatantLunge: (_self, dir) => triggerCombatantLungeAction({ self: f.bot,
      settings: f.state.settings, lungeDir: dir, pos: f.bot.pos, vel: f.bot.vel, playDash: noop }) });
    assert.deepEqual(live, result.frame);
    const command = result.scriptedCombat.commands[id][0]; assert.equal(command?.kind, 'lunge');
    if (command?.kind !== 'lunge') return;
    assert.deepEqual(command.direction, f.bot.lungeTargetDir);
    assert.equal(Math.sign(command.direction.z), enabled ? -sign : 0);
    for (let tick = 1; tick <= 55; tick++) {
      // Authored constant motion isolates the flight/contact owners from the
      // runner's own AI decisions. All collision and damage remain production code.
      const seconds = (tick - 1) * dt;
      if (f.target.hp > 0) f.target.pos.set(sign * (8 + 5.8 * seconds), 0, -sign * 5.8 * seconds);
      if (f.runner.alive) Object.assign(f.runner.pos, f.target.pos);
      if (tick > 1) f.flight(dt);
      stepSimulation(f.sim, tick === 1 ? { [id]: result.action } : {}, { settings: f.sim.settings, dt,
        ...(tick === 1 ? { scriptedCombat: result.scriptedCombat } : {}) });
      if (tick > 1) assert.equal(f.runner.hp, f.target.hp, `damage tick ${tick}`);
      if (f.target.hp <= 0) break;
    }
    if (enabled) { assert.equal(f.target.hp, 0); assert.equal(f.runner.alive, false); assert.ok(f.outcomes.includes('hit')); }
    else { assert.ok(f.target.hp > 0); assert.ok(f.runner.alive); assert.ok(f.outcomes.includes('miss_timeout')); }
  });

test('pursuit launch cannot bypass readiness, protection, chance or a selected feint', () => {
  for (const patch of [{ canStartWeaponAction: false }, { targetProtected: true },
    { random: () => 1 }, { feintChance: 1, tryFeintRoll: () => true }]) {
    const f = fixture(); f.launch(patch);
    assert.equal(f.counts().callbacks, 0); assert.equal(f.counts().observations, 0); assert.equal(!!f.bot.isLunging, false);
  }
});

test('a newly protected runner cancels the pending chase at the final launch boundary', () => {
  const f = fixture(); f.target.invulnerabilityTimer = 1;
  const result = f.launch();
  assert.equal(result.mode, 'continue'); assert.equal(f.counts().callbacks, 1); assert.equal(f.counts().observations, 0);
});
