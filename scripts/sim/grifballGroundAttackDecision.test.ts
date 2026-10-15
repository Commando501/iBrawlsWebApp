import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { resolveSimGrifballGroundAttackInput } from '../../src/sim/grifballGroundAttackInput';
import { idleAction } from '../../src/sim/actions';
import { stepSimulation } from '../../src/sim/step';
import type { AIBehaviorState } from '../../src/types';
import { resolveSimGrifballAssignedCombatInput } from '../../src/sim/grifballAssignedCombatInput';
import { createGrifballTeamPlanState, updateGrifballTeamPlan, selectGrifballAssignmentThreat } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { updateGrifballTeamPlanForState } from '../../src/components/grifball/grifballTeamPlanRuntime';
import { getTacticalTargetByIdFromState } from '../../src/components/grifball/tacticalTargets';
import { resolveAITargetPredictionFrame } from '../../src/components/grifball/aiTargetPredictionRuntime';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { setSimCarrier } from '../../src/sim/grifball';
import { setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';

const dt = 1 / 60;
const unexpected = () => { throw new Error('Stationary commitment must not invoke another attack branch'); };

for (const assigned of [false, true]) for (const id of ['main_ai', 'bot_2']) for (const weapon of ['hammer', 'sword'] as const)
  for (const multiplier of [.75, 1.25]) test(`${assigned ? 'assigned' : 'authored'}/${id}/${weapon}/${multiplier}: independent readiness to commitment, impact and recovery`, () => {
    const f = createBotParityFixture(id, true);
    const { sim, bot, target } = f, [self, rival] = sim.combatants;
    sim.combatExecution = 'live-roster-v2'; sim.match.phase = 'playing';
    self.id = id; self.controller = 'ai'; rival.id = target.id;
    self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: 2 };
    self.weapon = bot.activeWeapon = weapon; self.yaw = 0;
    self.invulnerabilityTimer = rival.invulnerabilityTimer = rival.weaponReadyTimer = 0;
    self.weaponReadyTimer = bot.swapCooldownTimer = 3 * dt;
    rival.hp = rival.maxHp = target.hp;
    const plan = createGrifballTeamPlanState();
    const owners = { [id]: 'normal' };
    const tuning = { effectiveReactionLatency: .1, tunedAnticipationFactor: .5, movementComplexity: 80, playstyleFactor: .5 };
    const behavior = resolveBehaviorTuning(sim.settings);
    const goal = (team: string | undefined) => sim.goalPlates.find(p => p.team !== team)?.position ?? null;
    if (assigned) {
      // The selected threat is off the initial facing axis; a missing aim
      // translation must miss these real impacts rather than pass by accident.
      rival.pos = { x: 2, y: 0, z: 0 }; target.pos.set(2, 0, 0);
      const ally = { ...bot, id: 'runner', pos: bot.pos.clone().set(10, 0, 0), vel: bot.vel.clone().set(0, 0, 0), controller: 'remote' as const };
      f.state.otherPlayers.set(ally.id, ally);
      const runner = { ...structuredClone(self), id: ally.id, pos: { x: 10, y: 0, z: 0 }, controller: 'remote' as const };
      sim.combatants.push(runner);
      f.state.grifball = structuredClone(sim.match); f.state.arenaRadius = sim.map.arenaRadius;
      sim.match.ball.state = f.state.grifball.ball.state = 'held';
      sim.match.ball.holderId = f.state.grifball.ball.holderId = runner.id;
      setSimCarrier(runner, true, sim.settings); setGrifballCarrierForState({ state: f.state, id: ally.id, carrying: true });
    }
    let liveMemory: { aiState: AIBehaviorState; timer: number } = { aiState: 'COOLDOWN', timer: dt / 2 };
    let simMemory = { ...liveMemory };
    let liveCommit = 0, simCommit = 0, liveHit = 0, simHit = 0;
    let liveAttacks = 0, simAttacks = 0;
    let continuation: typeof sim | undefined;
    let continuationPlan: typeof plan | undefined;
    let continuationMemory: typeof simMemory | undefined;
    for (let tick = 1; tick <= 180; tick++) {
      // Each host owns its plan, observations, readiness and AI memory. Only
      // the original cases author range; assigned cases use current target data.
      let liveTargetId: string | null = null;
      let livePrediction: ReturnType<typeof resolveAITargetPredictionFrame> | undefined;
      let liveRange: ReturnType<typeof resolveAICombatRangeFrame> | undefined;
      f.frame(false, false, () => {
        // The main actor's swap clock belongs to weaponFrame; ordinary roster
        // readiness belongs to its AI prelude. Never advance either twice.
        if (id !== 'main_ai') bot.swapCooldownTimer = Math.max(0, bot.swapCooldownTimer! - dt);
        if (assigned) {
          updateGrifballTeamPlanForState(f.state, dt, goal, f.map);
          const livePlan = f.state.aiMatchContext.grifballTeamPlan;
          const assignment = livePlan.assignments.get(id)!;
          liveTargetId = selectGrifballAssignmentThreat(assignment, bot.pos, livePlan.snapshot!.players);
          assert.equal(liveTargetId, target.id);
          const observed = getTacticalTargetByIdFromState(f.state, id, liveTargetId!, [...f.state.otherPlayers.values()])!;
          livePrediction = resolveAITargetPredictionFrame({ ...tuning, botPos: bot.pos, target: observed,
            predictionAnticipationBonus: behavior.predictionAnticipationBonus, predictionLandingWeight: behavior.predictionLandingWeight,
            aimAtCurrentTarget: ['swing_up', 'swing_down', 'melee_up', 'melee_down'].includes(bot.weaponState!),
            activeCustomMap: f.map, arenaRadius: f.state.arenaRadius });
          bot.yaw = livePrediction.yaw;
          liveRange = resolveAICombatRangeFrame({ botPos: bot.pos, botVel: bot.vel, botIsCrouching: !!bot.isCrouching,
            botIsJumping: !!bot.isJumping, targetIsCrouching: observed.isCrouching, targetHp: observed.hp,
            targetProtected: (observed.invulnerabilityTimer ?? 0) > 0,
            predictedTargetPos: livePrediction.predictedTargetPos, distanceToTarget: livePrediction.distanceToTarget,
            activeWeapon: weapon, attackRange: f.state.settings.attackRange, attackRadius: f.state.settings.attackRadius,
            resolvedAiReach: (f.state.settings.attackRange + f.state.settings.attackRadius * .75) * (.8 + .4 * tuning.playstyleFactor) });
        }
        const frame = { pos: bot.pos, vel: bot.vel, ...liveMemory, weaponState: bot.weaponState! };
        const result = resolveAIGroundAttackOpportunityForCombatant({
          state: f.state, self: bot, frame, botId: id,
          target: { ...target, weaponState: target.weaponState ?? 'ready', isLunging: !!target.isLunging,
            isCrouching: !!target.isCrouching },
          targetAirborne: false, targetProtected: false, activeWeapon: weapon,
          canStartWeaponAction: canStartAIWeaponAction({ ...liveMemory, swapCooldownTimer: bot.swapCooldownTimer }),
          enemyInKillRange: assigned ? liveRange!.enemyInKillRange : !liveCommit,
          selfGrounded: assigned ? liveRange!.selfGrounded : true, slideActive: false, cooldownMultiplier: multiplier,
          swordForbidden: true, swapLockoutRemaining: 0, swapFeintActive: false, comboActive: false, feintChance: 0,
          lungeDistanceToTarget: 2, hasVerticalLungeLine: false, minLungeRange: 10, maxLungeRange: 15,
          combatDistanceToTarget: 2, distanceToTarget: 2, resolvedAiReach: 3, aggressiveLungeMult: 1,
          tunedAnticipationFactor: 0, playstyleFactor: .5,
          tuning: { weaponSwapFeintDelay: 0, lungeChanceAirborneBase: 0, lungeChanceAirborneAnticipation: 0,
            lungeChanceGroundBase: 0, lungeChanceGroundAnticipation: 0, lungeFakeoutForwardTimer: 0 },
          constrainCombatantToArena: () => {}, triggerCombatantAttack: () => f.attack(),
          applyTacticalWeapon: unexpected, startWeaponSwapFeintTimer: unexpected, commitFeint: unexpected,
          tryFeintRoll: unexpected, getTargetPlayerModel: unexpected, triggerCombatantLunge: unexpected,
          recordCombatantObservation: unexpected,
        });
        if (result.mode === 'sync_return') {
          liveCommit ||= tick; liveAttacks++; liveMemory = { aiState: result.aiState!, timer: result.timer! };
          assert.deepEqual([frame.vel.x, frame.vel.z], [0, 0]);
        } else liveMemory.timer = Math.max(0, liveMemory.timer - dt);
      });
      if (assigned) updateGrifballTeamPlan(plan, createSimGrifballTacticalSnapshot(sim, { scriptedBots: owners }), dt);
      const decision = assigned ? resolveSimGrifballAssignedCombatInput(sim, plan, id, owners, tuning,
        { ...simMemory, cooldownMultiplier: multiplier }) : null;
      if (assigned) {
        assert.equal(decision?.targetId, liveTargetId);
        assert.deepEqual(decision!.range, liveRange);
        assert.equal(decision!.prediction.aim, livePrediction!.yaw - Math.PI);
      }
      const input = assigned ? decision!.input : resolveSimGrifballGroundAttackInput(sim, id, owners,
        { ...simMemory, enemyInKillRange: !simCommit, cooldownMultiplier: multiplier });
      const actions = { [id]: input?.action ?? { ...idleAction(), aim: decision?.prediction.aim ?? self.yaw } };
      const options = input ? { scriptedObjective: input.scriptedObjective } : {};
      if (input) { simCommit ||= tick; simAttacks++; simMemory = { aiState: input.aiState, timer: input.timer }; }
      else simMemory.timer = Math.max(0, simMemory.timer - dt);
      stepSimulation(sim, actions, options);
      if (continuation) {
        if (assigned) {
          updateGrifballTeamPlan(continuationPlan!, createSimGrifballTacticalSnapshot(continuation, { scriptedBots: owners }), dt);
          const restored = resolveSimGrifballAssignedCombatInput(continuation, continuationPlan!, id, owners, tuning,
            { ...continuationMemory!, cooldownMultiplier: multiplier });
          assert.deepEqual(restored, decision, `restored decision at ${tick}`);
          const command = restored!.input;
          if (command) continuationMemory = { aiState: command.aiState, timer: command.timer };
          else continuationMemory!.timer = Math.max(0, continuationMemory!.timer - dt);
          stepSimulation(continuation, { [id]: command?.action ?? { ...idleAction(), aim: restored!.prediction.aim } },
            command ? { scriptedObjective: command.scriptedObjective } : {});
          assert.deepEqual(continuationMemory, simMemory);
          // JSON persistence canonicalizes signed zero and omits undefined.
          // Compare the complete persisted plan, including Map entries, while
          // actual decisions, AI memory and engine state stay strict below.
          const persisted = (p: typeof plan) => JSON.stringify({ ...p, assignments: [...p.assignments] });
          assert.equal(persisted(continuationPlan!), persisted(plan));
        } else stepSimulation(continuation, actions, options);
        assert.deepEqual(continuation, sim);
      }
      if (tick === 4) {
        continuation = JSON.parse(JSON.stringify(sim));
        const restoredPlan = JSON.parse(JSON.stringify({ ...plan, assignments: [...plan.assignments] }));
        continuationPlan = { ...restoredPlan, assignments: new Map(restoredPlan.assignments) };
        continuationMemory = JSON.parse(JSON.stringify(simMemory));
      }
      if (!liveHit && target.hp < 20) liveHit = tick;
      if (!simHit && rival.hp < 20) simHit = tick;
      assert.deepEqual(simMemory, liveMemory, `AI memory at ${tick}`);
      const phase = bot.weaponState === 'ready' ? 'idle' : bot.weaponState === 'swing_up' ? 'windup'
        : bot.weaponState === 'swing_down' ? 'active' : 'recovering';
      assert.equal(self.weaponState, phase, `weapon phase at ${tick}`);
      assert.ok(Math.abs((self.weaponPhaseElapsed ?? 0) - (bot.weaponTimer ?? 0)) < 1e-6, `phase clock at ${tick}`);
      assert.equal(rival.hp, target.hp, `target health at ${tick}`);
      assert.deepEqual(self.pos, { x: bot.pos.x, y: bot.pos.y, z: bot.pos.z });
    }
    // Repeated subtraction leaves a positive floating-point remainder on tick 3.
    assert.equal(liveCommit, 4); assert.equal(simCommit, 4);
    assert.ok(liveHit > liveCommit); assert.equal(simHit, liveHit);
    assert.equal(simAttacks, liveAttacks);
    if (assigned) { assert.ok(liveAttacks >= 2); assert.ok(target.hp <= 18); }
    else { assert.equal(target.hp, 19); assert.equal(rival.hp, 19); assert.equal(self.weaponState, 'idle'); }
  });
