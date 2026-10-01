import * as THREE from 'three';
import { resolveAIComboOrchestrationForCombatant, type AIComboOrchestrationFrame } from '../components/grifball/aiComboOrchestrationRuntime';
import { resolveAICombatDangerZone, type AICombatWeapon, type PlayerModelSnapshot } from '../game/aiCombatDecision';
import { type BotComboState } from '../game/aiComboEngine';
import { canApplyAITacticalWeaponSwap, resolveAIWeaponSwapTimers } from '../game/aiTacticalWeaponSwap';
import { canStartAIWeaponAction } from '../game/aiWeaponTiming';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import { resolveSimGrifballAssignedCombatInput, type AssignedCombatTuning } from './grifballAssignedCombatInput';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { idleAction } from './actions';
import { normalizeYaw } from './physics';
import { isMixedPlayer, type SimState } from './simState';
import { type ScriptedCombatCommand, type ScriptedCombatInput } from './scriptedCombatInput';

/** Run the production combo owner against this engine's target and clocks.
 * The caller resolves earlier objective/feint priorities and tactical intent,
 * then adopts the returned memory and commands. Simulation, plan and input
 * memory remain untouched; only the explicitly supplied RNG advances. */
export function resolveSimGrifballComboInput(state: SimState, plan: GrifballTeamPlanState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, tuning: AssignedCombatTuning & {
    weaponSwapIQ: number; weaponPrioritization: number; spacingFactor: number;
  }, memories: Readonly<Record<string, TacticalAIMemory>>, context: {
    comboState: BotComboState | null; tacticalWeapon: AICombatWeapon | null; swapFeintActive: boolean;
    random: () => number; playerModel?: PlayerModelSnapshot | null;
  }, dt = 1 / 60) {
  if (typeof context.random !== 'function') throw new Error('Combo decisions require a caller-owned random stream');
  if (!Object.hasOwn(memories, botId)) return null;
  const observation = resolveSimGrifballAssignedCombatInput(state, plan, botId, scriptedBots, tuning, memories[botId], dt);
  if (!observation) return null;
  const self = state.combatants.find(c => c.id === botId)!, target = state.combatants.find(c => c.id === observation.targetId)!;
  if (target.controller === 'ai' && !isMixedPlayer(state, target) && !Object.hasOwn(memories, target.id)) return null;
  const observed = observeSimTacticalWeaponTarget(state, target, memories[target.id]);
  const point = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z);
  const commands: ScriptedCombatCommand[] = [];
  const aiContext = { comboState: new Map(context.comboState ? [[botId, { ...context.comboState }]] : []) };
  let activeWeapon = self.weapon, weaponState = observeSimTacticalWeaponTarget(state, self).weaponState as AIComboOrchestrationFrame['weaponState'];
  let lockout = Math.max(0, self.swapLockoutTimer - dt), readiness = Math.max(0, self.weaponReadyTimer - dt);
  let canStartWeaponAction = canStartAIWeaponAction({ ...memories[botId], swapCooldownTimer: readiness });
  const assignment = plan.assignments.get(botId)!;
  const interception = !!state.match.ball.holderId && assignment.tuning?.enabled === true &&
    assignment.defense?.targetId === state.match.ball.holderId &&
    (assignment.defense.mode === 'intercept' || assignment.defense.mode === 'last-defender' || assignment.defense.emergency);
  let lungeObservation: { distance: number } | null = null;
  const frame = resolveAIComboOrchestrationForCombatant({ state, self, aiContext, botId,
    target: { ...observed, pos: point(target.pos), vel: point(target.vel), maxHp: target.maxHp,
      isCrouching: target.isCrouching, playerName: target.id, modelType: target.modelType },
    frame: { pos: point(self.pos), vel: point(self.vel), ...memories[botId], weaponState },
    activeWeapon, canStartWeaponAction, tacticalWeapon: context.tacticalWeapon,
    preserveReadyStrike: interception && target.id === state.match.ball.holderId && observation.range.enemyInKillRange,
    swapFeintActive: context.swapFeintActive, targetProtected: target.invulnerabilityTimer > 0,
    targetAirborne: observation.prediction.targetAirborne,
    hasVerticalLungeLine: !observation.prediction.targetAirborne || tuning.movementComplexity >= 60,
    targetIsLunging: observed.isLunging, dt, difficulty: scriptedBots[botId], ...tuning,
    ...observation.range, distanceToTarget: observation.prediction.distanceToTarget,
    minLungeRange: resolveAICombatDangerZone(state.settings, target.weapon) * tuning.spacingFactor * .85,
    maxLungeRange: Math.min(18, state.settings.swordLungeDistance ?? 14.5),
    resolvedAiReach: (state.settings.attackRange + state.settings.attackRadius * .75) * (.8 + .4 * tuning.playstyleFactor),
    swapLockoutRemaining: lockout, cooldownMultiplier: memories[botId].cooldownMultiplier,
    getTargetPlayerModel: () => context.playerModel ?? null, random: context.random,
    applyTacticalWeapon: requestedWeapon => {
      if (canApplyAITacticalWeaponSwap({ activeWeapon, requestedWeapon, weaponState, swapLockoutTimer: lockout,
        swordForbidden: tuning.weaponPrioritization <= 0, hammerForbidden: tuning.weaponPrioritization >= 100 })) {
        commands.push({ kind: 'swap', weapon: requestedWeapon });
        activeWeapon = requestedWeapon; weaponState = 'ready';
        const timers = resolveAIWeaponSwapTimers(state.settings, lockout, readiness);
        lockout = timers.lockout; readiness = timers.readiness;
        if (state.settings.weaponReadyTime > 0) canStartWeaponAction = false;
      }
      return { activeWeapon, weaponState, canStartWeaponAction };
    },
    triggerCombatantAttack: (_self, weapon, swipe = false) => commands.push({ kind: 'melee', weapon, swipe }),
    triggerCombatantLunge: (_self, dir) => commands.push({ kind: 'lunge', targetId: target.id, direction: { x: dir.x, y: dir.y, z: dir.z } }),
    recordCombatantObservation: () => { lungeObservation = { distance: observation.prediction.targetAirborne
      ? observation.range.combatDistanceToTarget : observation.prediction.distanceToTarget }; },
  });
  const scriptedCombat: ScriptedCombatInput = { version: 'scripted-combat-v1', scriptedBots, commands: { [botId]: commands } };
  const aim = normalizeYaw(observation.prediction.aim);
  return { targetId: target.id, frame, comboState: aiContext.comboState.get(botId) ?? null, lungeObservation,
    // JSON persistence canonicalizes signed zero. Normalize the command before
    // flight freezes its heading so restored and uninterrupted state stay exact.
    action: { ...idleAction(), aim: aim === 0 ? 0 : aim, crouch: self.isCrouching }, scriptedCombat };
}
