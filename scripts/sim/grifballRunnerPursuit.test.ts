import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat } from '../../src/game/aiGrifballTeamPlan';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { createLiveGrifballTacticalSnapshot } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { resolveSimGrifballTacticalWeaponChoice } from '../../src/sim/grifballTacticalWeaponChoice';
import { evaluateTacticalWeaponChoiceForState } from '../../src/components/grifball/aiTacticalWeaponRuntime';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { setSimCarrier } from '../../src/sim/grifball';
import { resolveSimGrifballTacticalWeaponSwapInput } from '../../src/sim/grifballTacticalWeaponSwapInput';
import { swapCombatantWeaponAction } from '../../src/components/grifball/combatantActions';
import { stepSimulation } from '../../src/sim/step';
import { createSuiteManifest } from '../../src/game/grifballValidation/profiles';
import { createSuitePlan } from '../../src/game/grifballValidation/plan';
import { createAutonomousValidationRuntime } from './grifballAutonomousRuntime';

for (const id of ['main_ai', 'bot_2']) for (const mirrored of [false, true]) for (const mixed of [false, true])
  test(`${id}/${mirrored}/local-${mixed}: actual snapshots, handoff, weapon choice, swap and readiness agree across hosts`, () => {
    const f = createBotParityFixture(id, !mixed, { aiDifficulty: 'normal' }, mixed ? 'player' : 'runner');
    const [self, runner] = f.sim.combatants, sign = mirrored ? 1 : -1;
    self.id = id; runner.id = f.target.id; self.controller = 'ai'; runner.controller = f.target.controller = 'remote';
    f.sim.combatExecution = mixed ? 'live-mixed-v1' : 'live-roster-v2'; f.sim.match.phase = 'playing';
    self.team = f.bot.team = mirrored ? 'red' : 'blue'; runner.team = f.target.team = mirrored ? 'blue' : 'red';
    self.pos = { x: 0, y: 0, z: 0 }; runner.pos = { x: sign * 8, y: 0, z: 0 }; runner.vel = { x: sign * 5.8, y: 0, z: 0 };
    f.bot.pos.set(0, 0, 0); f.target.pos.set(sign * 8, 0, 0); f.target.vel.set(sign * 5.8, 0, 0);
    for (const c of [self, runner]) c.invulnerabilityTimer = c.weaponReadyTimer = c.swapLockoutTimer = 0;
    f.bot.swapLockoutTimer = f.target.swapLockoutTimer = 0;
    if (mixed) {
      f.sim.localPlayerId = 'player'; f.state.otherPlayers.delete('player');
      f.state.playerPos.copy(f.target.pos); f.state.playerVel.copy(f.target.vel); f.state.localPlayerTeam = runner.team;
      f.state.playerInvulnerabilityTimer = 0; f.state.pWeaponState = 'ready'; f.state.pWeaponTimer = 0;
    }
    setSimCarrier(runner, true, f.sim.settings, f.sim); setGrifballCarrierForState({ state: f.state, id: runner.id, carrying: true });
    self.weapon = f.bot.activeWeapon = 'hammer';
    const support = { ...structuredClone(self), id: 'safety', pos: { x: sign * 35, y: 0, z: 0 } };
    f.sim.combatants.push(support);
    f.state.otherPlayers.set('safety', { ...f.bot, id: 'safety', pos: f.bot.pos.clone().set(sign * 35, 0, 0), vel: f.bot.vel.clone() });
    f.sim.match.ball.state = f.state.grifball.ball.state = 'held';
    f.sim.match.ball.holderId = f.state.grifball.ball.holderId = runner.id;
    const config = defaultGrifballTactics(); Object.assign(config.defaults, { runnerPursuitEnabled: true, stylesEnabled: false });
    f.state.grifballTactics = config;
    const owners = { [id]: 'normal', safety: 'normal' };
    const simPlan = createGrifballTeamPlanState(), livePlan = f.state.aiMatchContext.grifballTeamPlan;
    const liveSnapshot = createLiveGrifballTacticalSnapshot(f.state, team => f.sim.goalPlates.find(g => g.team !== team)!.position, f.map);
    const simSnapshot = createSimGrifballTacticalSnapshot(f.sim, { scriptedBots: owners, tactics: config });
    updateGrifballTeamPlan(livePlan, liveSnapshot, .1); updateGrifballTeamPlan(simPlan, simSnapshot, .1);
    const liveAssignment = livePlan.assignments.get(id)!, simAssignment = simPlan.assignments.get(id)!;
    assert.equal(liveAssignment.defense?.pursuit?.weapon, 'sword');
    assert.deepEqual(simAssignment.defense?.pursuit, liveAssignment.defense?.pursuit);
    assert.equal(selectGrifballAssignmentThreat(liveAssignment, f.bot.pos, liveSnapshot.players), runner.id);
    const target = getTacticalTargetByIdFromState(f.state, id, runner.id, [...f.state.otherPlayers.values()])!;
    const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: 80,
      playstyleFactor: .5, pressureAggression: 50, weaponSwapIQ: 0, weaponPrioritization: 50 };
    const memories = { [id]: { aiState: 'APPROACHING' as const, timer: 0, cooldownMultiplier: 1 } };
    const context = { random: () => 1, scoreContext: { scorePlayer: 0, scoreEnemy: 0 } };
    const simChoice = resolveSimGrifballTacticalWeaponChoice(f.sim, simPlan, id, owners, tuning, memories, context)!;
    const liveChoice = evaluateTacticalWeaponChoiceForState({ state: f.state, botId: id, target,
      mainAI: f.state.otherPlayers.get('main_ai'), difficulty: 'normal', pressureAggression: 50,
      scoreContext: context.scoreContext, context: { ...tuning, canStartWeaponAction: true, weaponState: 'ready' } });
    assert.deepEqual(liveChoice, simChoice.decision); assert.equal(liveChoice.weapon, 'sword');
    const restored = resolveSimGrifballTacticalWeaponChoice(JSON.parse(JSON.stringify(f.sim)), structuredClone(simPlan),
      id, owners, tuning, memories, context)!;
    assert.deepEqual(restored, simChoice);
    const action = resolveSimGrifballTacticalWeaponSwapInput(f.sim, id, owners, simChoice.decision.weapon!,
      { swordForbidden: false, hammerForbidden: false })!;
    assert.ok(action?.swapWeapon);
    swapCombatantWeaponAction({ self: f.bot, settings: f.state.settings, type: 'sword', setLockout: true, recordWeaponSwap: () => {} });
    stepSimulation(f.sim, { [id]: { ...action, attackSecondary: true } }, { settings: f.sim.settings });
    assert.equal(self.weapon, f.bot.activeWeapon); assert.ok(self.weaponReadyTimer > 0); assert.ok(f.bot.swapCooldownTimer! > 0);
    assert.equal(self.isLunging, false, 'a sword request cannot skip swap readiness');
  });

for (const mirrored of [false, true]) test(`full live AI swaps and lunges after an escaping runner: ${mirrored}`, async t => {
  const manifest = createSuiteManifest('quick');
  Object.assign(manifest.candidate.defaults, { runnerPursuitEnabled: true, stylesEnabled: false, runnerRiskWeight: 0 });
  manifest.mechanics.allowRunnerThrust = false;
  manifest.cases = [{ id: 'runner-pursuit', mode: 'match', scenario: null, mapId: 'championship_stadium',
    roster: 'scripted-4v4', difficulty: 'normal', seeds: [102], opponents: ['balanced'], mirrored: true,
    fixedHz: 60, simulationSeconds: 10, watchdogSeconds: 60 }];
  const suite = await createSuitePlan(manifest, { commit: 'a'.repeat(40), dirty: false, workingTreeHash: 'b'.repeat(64), scope: ['src'] });
  const job = suite.jobs.find(j => j.variant === 'candidate' && j.mirrored === mirrored)!;
  const host = createAutonomousValidationRuntime(suite.cases[0], job), s = host.state, sign = mirrored ? 1 : -1;
  const carrier = [...s.otherPlayers.values()].find(p => p.team !== job.focalTeam)!;
  const [defender, safety] = [...s.otherPlayers.values()].filter(p => p.team === job.focalTeam);
  for (const p of s.otherPlayers.values()) {
    p.invulnerabilityTimer = p.aiTimer = p.swapCooldownTimer = p.swapLockoutTimer = 0;
    p.weaponState = 'ready'; p.vel.set(0, 0, 0); p.aiState = 'APPROACHING';
    if (p !== carrier && p !== defender && p !== safety) { p.hp = 0; p.respawnTimer = 100; }
  }
  s.grifball.phase = 'playing'; s.grifball.ball.state = 'held'; s.grifball.ball.holderId = carrier.id;
  carrier.pos.set(8 * sign, 0, 0); defender.pos.set(1.5 * sign, 0, 0); safety.pos.set(35 * sign, 0, 0);
  carrier.vel.set(7.54 * sign, 0, 0); defender.activeWeapon = 'hammer';
  setGrifballCarrierForState({ state: s, id: carrier.id, carrying: true }); Object.assign(s.grifball.ball.pos, carrier.pos);
  let swap = 0, lunge = 0, opportunity = 0;
  try {
    for (let tick = 1; tick <= 120; tick++) {
      host.runtime.step();
      if (s.aiMatchContext.grifballTeamPlan.assignments.get(defender.id)?.defense?.pursuit?.weapon === 'sword') opportunity++;
      if (!swap && (defender.activeWeapon as string) === 'sword') swap = tick;
      if (defender.isLunging) { lunge = tick; break; }
    }
    assert.ok(opportunity > 0, 'the production planner identifies the chase');
    assert.ok(swap > 0 && swap <= 20, 'the AI responds with a real weapon swap');
    assert.ok(lunge > swap, 'normal readiness and combat arbitration lead to a real lunge');
    t.diagnostic(JSON.stringify({ mirrored, swap, lunge, opportunity }));
  } finally { host.runtime.dispose(); }
});
