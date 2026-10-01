import * as THREE from 'three';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { getPincerApproachOffset } from '../game/aiBotCoordinator';
import { getPlayerFeintMultiplier, isFeintEligible, rollFeintAttempt, rollFeintCooldownDuration } from '../game/aiFeints';
import { resolveAIGroundMovementPrelude } from '../game/aiGroundMovementPrelude';
import { getApproachLateralOffset, getOrCreatePlayerModel, type PlayerModelSnapshot } from '../game/aiPlayerModel';
import { applyCalibrationMultipliers } from '../game/aiSkillCalibration';
import type { AIMatchContext } from '../game/aiMatchContext';
import type { resolveSimGrifballAdaptiveTuning } from './grifballAdaptiveTuning';
import type { resolveSimGrifballCombatPriorities, SimCombatPriorityMemory } from './grifballCombatPriorities';
import { retainSimGrifballCombatObservation, type SimGrifballCombatObservation } from './grifballCombatObservation';
import { resolveSimGrifballCoordinatedAttack } from './grifballCoordinatedAttack';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';
import type { ScriptedAIGroundOwner } from './scriptedAIGround';
import type { ScriptedActorDecisionRecord } from './scriptedActorDecision';
import { isMixedPlayer, type SimState } from './simState';

type Adaptive = NonNullable<ReturnType<typeof resolveSimGrifballAdaptiveTuning>>;
type Priorities = NonNullable<ReturnType<typeof resolveSimGrifballCombatPriorities>>;
const point = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);

/** Match the live target-cooldown callback, including main AI's state-based
 * lunge check and the separate local sword/swipe animation names. */
export function isSimGrifballTargetOnCooldown(state: SimState, targetId: string,
  memories: Readonly<Record<string, SimCombatPriorityMemory>>): boolean {
  const target = state.combatants.find(c => c.id === targetId);
  if (!target) return false;
  const phase = observeSimTacticalWeaponTarget(state, target).weaponState;
  if (isMixedPlayer(state, target)) return target.weapon === 'hammer' || target.weapon === 'ball'
    ? ['recovering', 'swing_up', 'swing_down'].includes(phase) || target.weapon === 'ball' && target.isLunging
    : phase === 'recovering' || target.weaponState === 'windup' || target.weaponState === 'active' || target.isLunging;
  const memory = memories[targetId];
  if (!memory) throw new Error(`Ground cooldown observation requires AI memory: ${targetId}`);
  return ['recovering', 'swing_up', 'swing_down'].includes(phase) ||
    (targetId === 'main_ai' ? memory.aiState === 'LUNGING' : target.isLunging) ||
    memory.aiState === 'COOLDOWN' && (memory.timer ?? 0) > 0;
}

/** Attach to the composed decision. Navigation is resolved lazily, only if
 * recovery/evasion/dash/early-lunge branches allow ground execution. The caller
 * owns and invalidates the navigation cache when its map changes. */
export function createSimGrifballGroundOwner(botId: string, scriptedBots: Readonly<Record<string, string>>,
  memories: Record<string, SimCombatPriorityMemory>, context: {
    adaptive: Adaptive; priorities: Priorities; observation: SimGrifballCombatObservation;
    matchContext: AIMatchContext; resolvedDangerZone: number; random: () => number;
    playerModel?: PlayerModelSnapshot | null;
    navigation: Parameters<typeof resolveAIGroundMovementPrelude>[0]['navigation'];
  }): ScriptedAIGroundOwner {
  return { version: 'scripted-ai-ground-v1', resolve: ({ state, actorId, dt }) => {
    const { adaptive: a, priorities, observation: o, matchContext: ai } = context;
    if (actorId !== botId || priorities.actorId !== botId || priorities.tick !== state.tick ||
      priorities.mode !== 'continue' || priorities.targetId !== o.targetId ||
      !retainSimGrifballCombatObservation(state, botId, scriptedBots, o, dt) ||
      a.psychState !== ai.psychState.get(botId) || typeof context.random !== 'function' ||
      !Number.isFinite(context.resolvedDangerZone) || context.resolvedDangerZone < 0)
      throw new Error('Ground policy requires this turn\'s composed engagement and shared adaptive context');
    const self = state.combatants.find(c => c.id === botId)!, target = state.combatants.find(c => c.id === o.targetId)!;
    const memory = memories[botId], targetMemory = memories[target.id], weapon = priorities.weaponFrame;
    if (!memory || !targetMemory && !isMixedPlayer(state, target)) throw new Error('Ground policy requires current AI memory');
    const tuning = resolveBehaviorTuning(state.settings);
    const navigation = resolveAIGroundMovementPrelude({ settings: state.settings, arenaRadius: state.map.arenaRadius,
      navigation: context.navigation, pos: point(self.pos), movementTargetPos: point(o.prediction.movementTargetPos),
      target: { pos: point(target.pos), vel: point(target.vel) }, predictedTargetPos: point(o.prediction.predictedTargetPos),
      activeCustomMap: state.map, spatialIQ: a.derivedParams.spatialIQ, edgeInset: tuning.arenaEdgeInset,
      aiState: memory.aiState, distanceToTarget: o.prediction.distanceToTarget, resolvedDangerZone: context.resolvedDangerZone,
      isCrouching: self.isCrouching, slideActive: self.slideActive, sprintEngageGap: tuning.sprintEngageGap,
      sprintChaseTargetSpeed: tuning.sprintChaseTargetSpeed });
    return { targetId: target.id, targetMemory,
      memory: { aiState: memory.aiState, timer: memory.timer, weaponState: weapon.weaponState, isSprinting: navigation.isSprinting },
      policy: { pressureTargetId: memory.pressureTargetId, ...o.range,
        distanceToTarget: o.prediction.distanceToTarget, resolvedDangerZone: context.resolvedDangerZone, resolvedAiReach: o.resolvedAiReach,
        minLungeRange: context.resolvedDangerZone * .85, maxLungeRange: Math.min(18, state.settings.swordLungeDistance ?? 14.5),
        activeWeapon: weapon.activeWeapon as 'hammer' | 'sword', canStartWeaponAction: weapon.canStartWeaponAction,
        targetIsProtected: o.targetProtected, difficulty: scriptedBots[botId], movementComplexity: a.movementComplexity,
        playstyleFactor: a.playstyleFactor, tunedAnticipationFactor: a.tunedAnticipationFactor,
        effectiveReactionLatency: a.effectiveReactionLatency, effectivePressureAggression: a.effectivePressureAggression,
        cooldownMult: memory.cooldownMultiplier, swayTimer: memory.swayTimer, ...navigation,
        totalApproachLateral: getApproachLateralOffset(context.playerModel) + getPincerApproachOffset({
          coordinator: ai.coordinator, botId, targetId: target.id, difficulty: scriptedBots[botId] }),
        isCrouching: self.isCrouching, feintChance: a.derivedParams.feintChance, feintLungeFakeout: false,
        psychEnabled: a.psychEnabled, psychState: a.psychState, matchMultipliers: a.matchMultipliers, tuning, random: context.random,
        tryFeintRoll: (rollScale = 1) => {
          const input = { feintChance: a.derivedParams.feintChance, feintCooldownRemaining: ai.feintCooldowns.get(botId) ?? 0,
            playerModelMultiplier: getPlayerFeintMultiplier(context.playerModel), rollScale };
          return isFeintEligible(input) && rollFeintAttempt({ ...input, rng: context.random() });
        },
        commitFeint: () => ai.feintCooldowns.set(botId, rollFeintCooldownDuration(context.random(), tuning.feintCooldownMin, tuning.feintCooldownMax)),
        isTargetOnCooldown: () => isSimGrifballTargetOnCooldown(state, target.id, memories),
        isCoordAttackBlocked: () => {
          const result = resolveSimGrifballCoordinatedAttack(state, botId, scriptedBots, o,
            { coordinator: ai.coordinator, memories, commitTimer: memory.coordCommitTimer }, dt);
          if (!result) throw new Error('Coordination ownership changed within ground execution');
          return result.blocked;
        },
        clearPressureTarget: id => { if (memories[id]) delete memories[id].pressureTargetId; },
      },
      opportunity: { targetAirborne: o.prediction.targetAirborne, enemyInKillRange: o.range.enemyInKillRange,
        selfGrounded: o.range.selfGrounded, swordForbidden: a.swordForbidden, hammerForbidden: a.hammerForbidden,
        swapLockoutRemaining: weapon.observedSwapLockout, swapFeintActive: (ai.weaponSwapFeintTimers.get(botId) ?? 0) > 0,
        comboActive: priorities.combo.frame.comboActive, lungeDistanceToTarget: o.prediction.targetAirborne
          ? o.range.combatDistanceToTarget : o.prediction.distanceToTarget,
        hasVerticalLungeLine: !o.prediction.targetAirborne || a.movementComplexity >= 60,
        combatDistanceToTarget: o.range.combatDistanceToTarget,
        aggressiveLungeMult: applyCalibrationMultipliers({ reactionLatency: 1, anticipationFactor: 1,
          aggressiveLungeMult: .4 + 1.6 * a.playstyleFactor, multipliers: a.calibrationMultipliers }).aggressiveLungeMult,
        tuning, startWeaponSwapFeintTimer: () => ai.weaponSwapFeintTimers.set(botId, tuning.weaponSwapFeintDelay),
        getTargetPlayerModel: () => context.playerModel ?? null,
        recordCombatantObservation: (id, observe) => observe(getOrCreatePlayerModel(ai, id, {
          emaAlpha: tuning.playerModelEmaAlpha, defaultLungeDistance: tuning.defaultLungeDistance,
          defaultReactionTime: tuning.defaultReactionTime })),
      },
    };
  } };
}

/** Call at completeTurn so later roster decisions see the finished ground/dash
 * state. Neither branch spends an additional clock or replaces lunge feedback. */
export function adoptSimGrifballMovementFeedback(record: Readonly<ScriptedActorDecisionRecord>,
  memories: Record<string, SimCombatPriorityMemory>, matchContext: AIMatchContext): void {
  if (!record.ground && !record.dash) return;
  const memory = memories[record.id];
  if (!memory) throw new Error(`Missing movement feedback owner: ${record.id}`);
  if (record.dash) Object.assign(memory, record.dash);
  if (record.ground) {
    const psych = matchContext.psychState.get(record.id);
    if (!psych) throw new Error(`Missing ground psychological memory: ${record.id}`);
    memory.aiState = record.ground.aiState; memory.timer = record.ground.timer;
    psych.standoffTimer = record.ground.standoffTimer;
  }
}
