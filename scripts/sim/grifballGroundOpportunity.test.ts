import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { attachLungeRuntime } from './grifballLungeFixture';
import { resolveAIGroundAttackOpportunityForCombatant } from '../../src/components/grifball/aiGroundAttackOpportunityRuntime';
import { resolveAICombatRangeFrame } from '../../src/components/grifball/aiCombatRangeRuntime';
import { resolveAITargetPredictionFrame } from '../../src/components/grifball/aiTargetPredictionRuntime';
import { swapCombatantWeaponAction, triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { resolveBehaviorTuning } from '../../src/game/aiBehaviorTuning';
import { resolveAICombatDangerZone } from '../../src/game/aiCombatDecision';
import { isFeintEligible, rollFeintAttempt, rollFeintCooldownDuration } from '../../src/game/aiFeints';
import { canStartAIWeaponAction } from '../../src/game/aiWeaponTiming';
import { createGrifballTeamPlanState } from '../../src/game/aiGrifballTeamPlan';
import { createSimGrifballTacticalSnapshot } from '../../src/sim/grifballTacticalAdapter';
import { resolveSimGrifballGroundOpportunityInput } from '../../src/sim/grifballGroundOpportunityInput';
import { stepSimulation } from '../../src/sim/step';
import { defaultGrifballTactics } from '../../src/game/grifballTacticsConfig';

const dt = 1 / 60, noop = () => {};
const cases = ['hammer-strike', 'sword-strike', 'lunge', 'moving-lunge', 'feint', 'swap-lunge', 'fakeout', 'decline', 'reload', 'readiness', 'shield', 'far', 'combo', 'airborne', 'vertical-block'] as const;
for (const id of ['main_ai', 'bot_2']) for (const mirror of [false, true]) for (const kind of cases)
  test(`ground opportunity ${id}/${mirror}/${kind}`, () => {
    const f = attachLungeRuntime(createBotParityFixture(id, true, { aiDifficulty: 'normal', weaponReadyTime: kind === 'swap-lunge' ? 0 : .08,
      enableSwordTrade: false, enableHammerSwordTrade: false }));
    const { state, sim, bot, target } = f, [self, rival] = sim.combatants;
    const sign = mirror ? -1 : 1, distance = kind.endsWith('strike') ? 2 : kind === 'far' ? 15 : 8;
    sim.combatExecution = 'live-mixed-v1'; sim.localPlayerId = 'player'; sim.match.phase = 'playing';
    self.id = id; rival.id = target.id; self.controller = rival.controller = 'ai';
    self.weapon = bot.activeWeapon = kind === 'hammer-strike' || kind === 'feint' || kind === 'swap-lunge' || kind === 'combo' ? 'hammer' : 'sword';
    self.pos = { x: 0, y: 0, z: 0 }; rival.pos = { x: 0, y: 0, z: sign * distance }; target.pos.set(0, 0, sign * distance);
    self.yaw = mirror ? Math.PI : 0; bot.yaw = self.yaw + Math.PI;
    self.invulnerabilityTimer = rival.invulnerabilityTimer = self.weaponReadyTimer = rival.weaponReadyTimer = self.swapLockoutTimer = bot.swapLockoutTimer = 0;
    self.hp = self.maxHp = bot.hp = bot.maxHp = rival.hp = rival.maxHp = target.hp = target.maxHp = 20;
    if (mirror) { self.team = bot.team = 'red'; rival.team = target.team = 'blue'; }
    if (kind === 'readiness') self.weaponReadyTimer = bot.swapCooldownTimer = .1;
    if (kind === 'shield') rival.invulnerabilityTimer = target.invulnerabilityTimer = 10;
    if (kind === 'moving-lunge') { self.vel = { x: 1.2, y: 0, z: 2 * sign }; bot.vel.set(1.2, 0, 2 * sign); }
    const airborne = kind === 'airborne' || kind === 'vertical-block';
    if (airborne) { target.pos.y = rival.pos.y = 2; target.isJumping = rival.isJumping = true; rival.grounded = false; }
    sim.combatants.push({ ...structuredClone(rival), id: 'player', team: self.team, controller: 'remote', pos: { x: 40, y: 0, z: 0 }, isJumping: false });
    const tuning = { effectiveReactionLatency: 0, tunedAnticipationFactor: 0, movementComplexity: kind === 'vertical-block' ? 20 : 80,
      playstyleFactor: .5, weaponPrioritization: 50, spacingFactor: 1, aggressiveLungeMult: 1,
      feintChance: ['feint', 'swap-lunge', 'fakeout', 'combo'].includes(kind) ? 100 : 0 };
    const memory = { aiState: kind === 'reload' ? 'COOLDOWN' as const : 'APPROACHING' as const, timer: kind === 'reload' ? 1 : 0, cooldownMultiplier: .75 };
    const owners = { [id]: 'normal' }, behavior = resolveBehaviorTuning(sim.settings);
    let liveDraws = 0, simDraws = 0, replayDraws = 0;
    const draw = () => kind === 'decline' ? .99 : .01;
    const feints: { cooldownRemaining?: number; swapRemaining?: number } = {};
    let liveDecision!: ReturnType<typeof resolveAIGroundAttackOpportunityForCombatant>;
    let liveLungeDistance: number | undefined;
    const makePlan = (current: typeof sim) => {
      const plan = createGrifballTeamPlanState(); plan.snapshot = createSimGrifballTacticalSnapshot(current, { scriptedBots: owners });
      plan.assignments.set(id, { botId: id, team: self.team, role: 'lead', slot: 0, destination: { x: 0, z: sign * 7 }, anchor: { x: 0, z: 0 }, carrierId: null,
        tuning: { ...defaultGrifballTactics().defaults, engagementDistance: 15 }, reason: 'Ground opportunity within configured engagement area' });
      return plan;
    };
    const restored = JSON.parse(JSON.stringify(sim));
    for (let tick = 1; tick <= 65; tick++) {
      f.frame(false, false, () => {
        if (id !== 'main_ai') { bot.swapCooldownTimer = Math.max(0, (bot.swapCooldownTimer ?? 0) - dt); bot.swapLockoutTimer = Math.max(0, (bot.swapLockoutTimer ?? 0) - dt); }
        if (tick === 1) {
          const prediction = resolveAITargetPredictionFrame({ ...tuning, botPos: bot.pos, target,
            predictionAnticipationBonus: behavior.predictionAnticipationBonus, predictionLandingWeight: behavior.predictionLandingWeight,
            aimAtCurrentTarget: false, activeCustomMap: f.map, arenaRadius: f.map.arenaRadius });
          bot.yaw = prediction.yaw;
          const range = resolveAICombatRangeFrame({ botPos: bot.pos, botVel: bot.vel, botIsCrouching: false, botIsJumping: false,
            targetIsCrouching: false, targetHp: target.hp, targetProtected: target.invulnerabilityTimer > 0,
            predictedTargetPos: prediction.predictedTargetPos, distanceToTarget: prediction.distanceToTarget,
            activeWeapon: bot.activeWeapon as 'hammer' | 'sword', attackRange: state.settings.attackRange, attackRadius: state.settings.attackRadius,
            resolvedAiReach: state.settings.attackRange + state.settings.attackRadius * .75 });
          let activeWeapon = bot.activeWeapon, weaponState = bot.weaponState!;
          let ready = canStartAIWeaponAction({ ...memory, swapCooldownTimer: bot.swapCooldownTimer });
          const random = () => { liveDraws++; return draw(); };
          const lungeDistance = prediction.targetAirborne ? range.combatDistanceToTarget : prediction.distanceToTarget;
          liveDecision = resolveAIGroundAttackOpportunityForCombatant({ state, self: bot, botId: id,
            target: { ...target, weaponState: target.weaponState!, isLunging: false, isCrouching: false },
            frame: { pos: bot.pos, vel: bot.vel, ...memory, weaponState }, activeWeapon, canStartWeaponAction: ready,
            targetAirborne: prediction.targetAirborne, targetProtected: target.invulnerabilityTimer > 0, ...range, slideActive: false,
            cooldownMultiplier: memory.cooldownMultiplier, swordForbidden: false, swapLockoutRemaining: bot.swapLockoutTimer ?? 0,
            swapFeintActive: false, comboActive: kind === 'combo', feintChance: tuning.feintChance,
            lungeDistanceToTarget: lungeDistance, hasVerticalLungeLine: !prediction.targetAirborne || tuning.movementComplexity >= 60,
            minLungeRange: resolveAICombatDangerZone(state.settings, target.activeWeapon) * .85, maxLungeRange: Math.min(18, state.settings.swordLungeDistance),
            distanceToTarget: prediction.distanceToTarget, resolvedAiReach: state.settings.attackRange + state.settings.attackRadius * .75,
            aggressiveLungeMult: 1, tunedAnticipationFactor: 0, playstyleFactor: .5, tuning: behavior, random,
            constrainCombatantToArena: noop, triggerCombatantAttack: () => f.attack(),
            applyTacticalWeapon: requested => { swapCombatantWeaponAction({ self: bot, settings: state.settings, type: requested, setLockout: true, recordWeaponSwap: noop });
              activeWeapon = requested; weaponState = 'ready'; if (state.settings.weaponReadyTime > 0) ready = false;
              return { activeWeapon, weaponState, canStartWeaponAction: ready }; },
            startWeaponSwapFeintTimer: () => { feints.swapRemaining = behavior.weaponSwapFeintDelay; },
            commitFeint: () => { feints.cooldownRemaining = rollFeintCooldownDuration(random(), behavior.feintCooldownMin, behavior.feintCooldownMax); },
            tryFeintRoll: (rollScale = 1) => { const input = { feintChance: tuning.feintChance, feintCooldownRemaining: feints.cooldownRemaining ?? 0, rollScale };
              return isFeintEligible(input) && rollFeintAttempt({ ...input, rng: random() }); },
            getTargetPlayerModel: () => null,
            triggerCombatantLunge: (_self, dir) => triggerCombatantLungeAction({ self: bot, settings: state.settings, lungeDir: dir, pos: bot.pos, vel: bot.vel, playDash: noop }),
            recordCombatantObservation: () => { liveLungeDistance = lungeDistance; },
          });
        } else if (bot.isLunging) f.flight();
        else if (bot.isJumping || bot.pos.y > 0) f.gravityPrelude(bot);
        if (airborne) f.gravityPrelude(target);
      });
      const advance = (current: typeof sim, replay: boolean) => {
        let result: ReturnType<typeof resolveSimGrifballGroundOpportunityInput>;
        const events = stepSimulation(current, {}, { settings: current.settings, ...(tick === 1 ? { scriptedActorDecisions: {
          version: 'scripted-actor-decision-v1' as const, scriptedBots: owners, resolve: ({ state: own }: { state: typeof sim }) => {
            const actor = own.combatants.find(c => c.id === id)!;
            const before = structuredClone(own);
            result = resolveSimGrifballGroundOpportunityInput(own, makePlan(own), id, owners, tuning, memory,
              { weaponFrame: { activeWeapon: actor.weapon, weaponState: 'ready', canStartWeaponAction: canStartAIWeaponAction({ ...memory, swapCooldownTimer: actor.weaponReadyTimer }),
                observedSwapLockout: actor.swapLockoutTimer, currentSwapLockout: actor.swapLockoutTimer, readinessRemaining: actor.weaponReadyTimer },
                comboActive: kind === 'combo', swapFeintActive: false, feints: {}, random: () => { if (replay) replayDraws++; else simDraws++; return draw(); } })!;
            assert.deepEqual(own, before);
            return { kind: 'handled' as const, action: result.action, commands: result.scriptedCombat.commands[id], commandVersion: result.scriptedCombat.version, movement: result.movement };
          },
        } } : {}) });
        return { events, result: result! };
      };
      const result = advance(sim, false), replay = advance(restored, true);
      assert.deepEqual(restored, sim); assert.deepEqual(replay, result); assert.equal(replayDraws, simDraws);
      if (tick === 1) {
        assert.deepEqual(result.result!.frame, liveDecision); assert.deepEqual(result.result!.feints, feints); assert.equal(simDraws, liveDraws);
        assert.equal(result.result!.lungeObservation?.distance, liveLungeDistance);
        const commands = result.result!.scriptedCombat.commands[id];
        if (kind.endsWith('strike')) assert.equal(commands[0]?.kind, 'melee');
        else if (['lunge', 'moving-lunge', 'airborne'].includes(kind)) assert.equal(commands[0]?.kind, 'lunge');
        else if (kind === 'feint') { assert.deepEqual(commands.map(c => c.kind), ['swap']); assert.equal(feints.swapRemaining, behavior.weaponSwapFeintDelay); }
        else if (kind === 'swap-lunge') assert.deepEqual(commands.map(c => c.kind), ['swap', 'lunge']);
        else assert.equal(commands.length, 0);
        if (kind === 'fakeout') { assert.equal(liveDecision.aiState, 'DANCING_FORWARD'); assert.equal(result.result!.needsMovement, true); }
      }
      assert.equal(self.weapon, bot.activeWeapon); assert.equal(rival.hp, target.hp, `damage ${tick}`); assert.equal(self.isLunging, !!bot.isLunging);
      assert.equal(self.weaponReadyTimer, bot.swapCooldownTimer); assert.equal(self.swapLockoutTimer, bot.swapLockoutTimer);
      for (const axis of ['x', 'y', 'z'] as const) { assert.ok(Math.abs(self.pos[axis] - bot.pos[axis]) < 1e-6, `position ${tick}/${axis}`); assert.ok(Math.abs(self.vel[axis] - bot.vel[axis]) < 1e-6, `velocity ${tick}/${axis}`); }
    }
    if (kind.endsWith('strike') || ['lunge', 'moving-lunge', 'swap-lunge', 'airborne'].includes(kind)) assert.equal(target.hp, 19, 'selected attack must reach real contact');
    else assert.equal(target.hp, 20);
  });
