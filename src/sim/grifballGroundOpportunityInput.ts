import * as THREE from 'three';
import { resolveAIGroundAttackOpportunityForCombatant, type AITacticalWeaponApplyResult } from '../components/grifball/aiGroundAttackOpportunityRuntime';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { resolveAICombatDangerZone, type PlayerModelSnapshot } from '../game/aiCombatDecision';
import { getPlayerFeintMultiplier, isFeintEligible, rollFeintAttempt, rollFeintCooldownDuration } from '../game/aiFeints';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { canApplyAITacticalWeaponSwap, resolveAIWeaponSwapTimers } from '../game/aiTacticalWeaponSwap';
import { resolveSimGrifballAssignedCombatInput, type AssignedCombatTuning } from './grifballAssignedCombatInput';
import type { SimWeaponFeintMemory } from './grifballComboInput';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import type { ScriptedCombatCommand, ScriptedCombatInput } from './scriptedCombatInput';
import type { SimState } from './simState';
import { idleAction } from './actions';
import { normalizeYaw } from './physics';

/** Local weapon state from preceding priorities. Live AI retains its original
 * readiness decision and captured lockout even if later branches spend clocks
 * or revert/swap the physical weapon. Do not recompute these from AI timer here. */
export interface GroundOpportunityWeaponFrame extends AITacticalWeaponApplyResult {
  observedSwapLockout: number;
  currentSwapLockout: number;
  readinessRemaining: number;
}

/** Own-state ground opportunity AFTER combo/evasion/airborne/recovery priorities.
 * Does not tick clocks or choose missing movement. Adopt returned AI/feint memory
 * and commands; a continue result still needs the movement-state owner. */
export function resolveSimGrifballGroundOpportunityInput(state: SimState, plan: GrifballTeamPlanState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, tuning: AssignedCombatTuning & {
    weaponPrioritization: number; spacingFactor: number; aggressiveLungeMult: number; feintChance: number;
  }, memory: TacticalAIMemory, context: {
    weaponFrame: GroundOpportunityWeaponFrame; comboActive: boolean; feints: SimWeaponFeintMemory;
    random: () => number; playerModel?: PlayerModelSnapshot | null;
  }, dt = 1 / 60) {
  if (typeof context.random !== 'function') throw new Error('Ground opportunities require a caller-owned random stream');
  for (const value of [context.weaponFrame.observedSwapLockout, context.weaponFrame.currentSwapLockout, context.weaponFrame.readinessRemaining,
    context.feints.cooldownRemaining ?? 0, context.feints.swapRemaining ?? 0])
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid ground opportunity clock');
  if (typeof context.weaponFrame.canStartWeaponAction !== 'boolean' || typeof context.comboActive !== 'boolean') throw new Error('Invalid ground opportunity readiness');
  if (context.weaponFrame.activeWeapon !== 'hammer' && context.weaponFrame.activeWeapon !== 'sword') throw new Error('Ground opportunities require an armed weapon frame');
  const observation = resolveSimGrifballAssignedCombatInput(state, plan, botId, scriptedBots, tuning, memory, dt, 'after-swap-tick');
  if (!observation) return null;
  const self = state.combatants.find(c => c.id === botId)!, target = state.combatants.find(c => c.id === observation.targetId)!;
  const behavior = resolveBehaviorTuning(state.settings), feints = { ...context.feints };
  const point = (v: { x: number; y: number; z: number }) => new THREE.Vector3(v.x, v.y, v.z);
  const commands: ScriptedCombatCommand[] = [];
  let activeWeapon = context.weaponFrame.activeWeapon, weaponState = context.weaponFrame.weaponState;
  let canStartWeaponAction = context.weaponFrame.canStartWeaponAction;
  let lockout = context.weaponFrame.currentSwapLockout, readiness = context.weaponFrame.readinessRemaining;
  let lungeObservation: { distance: number } | null = null;
  const lungeDistance = observation.prediction.targetAirborne ? observation.range.combatDistanceToTarget : observation.prediction.distanceToTarget;
  const frame = resolveAIGroundAttackOpportunityForCombatant({ state, self, botId,
    target: { ...observeSimTacticalWeaponTarget(state, target), pos: point(target.pos), vel: point(target.vel), maxHp: target.maxHp,
      isCrouching: target.isCrouching, playerName: target.id, modelType: target.modelType },
    frame: { pos: point(self.pos), vel: point(self.vel), aiState: memory.aiState, timer: memory.timer, weaponState },
    activeWeapon, canStartWeaponAction, targetAirborne: observation.prediction.targetAirborne, targetProtected: target.invulnerabilityTimer > 0,
    enemyInKillRange: observation.range.enemyInKillRange, selfGrounded: true, slideActive: false, cooldownMultiplier: memory.cooldownMultiplier,
    swordForbidden: tuning.weaponPrioritization <= 0, swapLockoutRemaining: context.weaponFrame.observedSwapLockout,
    swapFeintActive: (feints.swapRemaining ?? 0) > 0, comboActive: context.comboActive, feintChance: tuning.feintChance,
    lungeDistanceToTarget: lungeDistance, hasVerticalLungeLine: !observation.prediction.targetAirborne || tuning.movementComplexity >= 60,
    minLungeRange: resolveAICombatDangerZone(state.settings, target.weapon) * tuning.spacingFactor * .85,
    maxLungeRange: Math.min(18, state.settings.swordLungeDistance ?? 14.5),
    combatDistanceToTarget: observation.range.combatDistanceToTarget, distanceToTarget: observation.prediction.distanceToTarget,
    resolvedAiReach: (state.settings.attackRange + state.settings.attackRadius * .75) * (.8 + .4 * tuning.playstyleFactor),
    aggressiveLungeMult: tuning.aggressiveLungeMult, tunedAnticipationFactor: tuning.tunedAnticipationFactor, playstyleFactor: tuning.playstyleFactor,
    tuning: behavior, random: context.random,
    // A stationary commit emits zero steering; real simulation movement applies
    // the same arena constraint. Decision construction never mutates the pose.
    constrainCombatantToArena: () => {},
    triggerCombatantAttack: (_self, weapon) => commands.push({ kind: 'melee', weapon, swipe: false }),
    applyTacticalWeapon: requestedWeapon => {
      if (canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon, weaponState, swapLockoutTimer: lockout,
        swordForbidden: tuning.weaponPrioritization <= 0, hammerForbidden: tuning.weaponPrioritization >= 100 })) {
        commands.push({ kind: 'swap', weapon: requestedWeapon }); activeWeapon = requestedWeapon; weaponState = 'ready';
        const timers = resolveAIWeaponSwapTimers(state.settings, lockout, readiness); lockout = timers.lockout; readiness = timers.readiness;
        if (state.settings.weaponReadyTime > 0) canStartWeaponAction = false;
      }
      return { activeWeapon, weaponState, canStartWeaponAction };
    },
    startWeaponSwapFeintTimer: () => { feints.swapRemaining = behavior.weaponSwapFeintDelay; },
    commitFeint: () => { feints.cooldownRemaining = rollFeintCooldownDuration(context.random(), behavior.feintCooldownMin, behavior.feintCooldownMax); },
    tryFeintRoll: (rollScale = 1) => {
      const input = { feintChance: tuning.feintChance, feintCooldownRemaining: feints.cooldownRemaining ?? 0,
        playerModelMultiplier: getPlayerFeintMultiplier(context.playerModel), rollScale };
      return isFeintEligible(input) && rollFeintAttempt({ ...input, rng: context.random() });
    },
    getTargetPlayerModel: () => context.playerModel ?? null,
    triggerCombatantLunge: (_self, dir) => commands.push({ kind: 'lunge', targetId: target.id, direction: { x: dir.x, y: dir.y, z: dir.z } }),
    recordCombatantObservation: () => { lungeObservation = { distance: lungeDistance }; },
  });
  const aim = normalizeYaw(observation.prediction.aim);
  const scriptedCombat: ScriptedCombatInput = { version: 'scripted-combat-v2', scriptedBots, commands: { [botId]: commands } };
  return { targetId: target.id, frame, feints, lungeObservation,
    weaponFrame: { ...frame, observedSwapLockout: context.weaponFrame.observedSwapLockout, currentSwapLockout: lockout, readinessRemaining: readiness },
    needsMovement: frame.mode === 'continue', movement: frame.mode === 'sync_return' ? { x: 0, z: 0 } : undefined,
    action: { ...idleAction(), aim: aim === 0 ? 0 : aim, crouch: self.isCrouching }, scriptedCombat };
}
