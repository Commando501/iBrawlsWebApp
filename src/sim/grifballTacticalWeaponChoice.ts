import { remainingDecisionSwapTime, type ScriptedDecisionClockPhase } from './scriptedActorDecision';
import { evaluateTacticalWeaponChoice, type TacticalWeaponActor } from '../game/aiTacticalWeaponChoice';
import { canStartAIWeaponAction } from '../game/aiWeaponTiming';
import type { AILungeMemory, PlayerModelSnapshot } from '../game/aiCombatDecision';
import type { AIMatchScoreContext } from '../game/aiTuning';
import type { GrifballTeamPlanState } from '../game/aiGrifballTeamPlan';
import type { AIBehaviorState } from '../types';
import { isMixedPlayer, type SimCombatant, type SimState } from './simState';
import { resolveSimGrifballAssignedCombatInput, type AssignedCombatTuning } from './grifballAssignedCombatInput';

export interface TacticalAIMemory { aiState: AIBehaviorState | undefined; timer: number | undefined; cooldownMultiplier: number }

/** Translate animation names, not attack timing: tactical target selection sees
 * committed swing phases even when space planning treats follow-through as spent. */
export function observeSimTacticalWeaponTarget(state: SimState, actor: SimCombatant, memory?: TacticalAIMemory) {
  const local = isMixedPlayer(state, actor), swipe = actor.attackKind === 'swipe';
  const phase = actor.weaponState === 'idle' ? 'ready'
    : actor.weaponState === 'windup' ? local && actor.weapon === 'sword' ? 'slashing'
      : swipe ? local ? 'melee_swing' : 'melee_up' : 'swing_up'
    : actor.weaponState === 'active' ? swipe ? local ? 'melee_swing' : 'melee_down' : 'swing_down'
    : actor.weaponState === 'recovering' ? swipe ? 'melee_recover' : 'recovering' : actor.weaponState;
  return { id: actor.id, pos: { ...actor.pos }, hp: actor.hp, activeWeapon: actor.weapon,
    weaponState: !local && phase === 'ready' && memory?.aiState === 'COOLDOWN' && (memory.timer ?? 0) > 0 ? 'recovering' : phase,
    isLunging: actor.isLunging || !local && actor.weapon !== 'ball' && (phase === 'swing_up' || phase === 'swing_down'),
    invulnerabilityTimer: actor.invulnerabilityTimer, dashCooldownRemaining: actor.dashCooldownTimer,
    swapLockoutRemaining: actor.swapLockoutTimer };
}

/** Shared tactical intent, before combo/feint/evasion/swap execution. The caller
 * owns every AI reload observation and the explicit deterministic random stream.
 * Missing AI target memory hands off instead of fabricating a ready opponent. */
export function resolveSimGrifballTacticalWeaponChoice(state: SimState, plan: GrifballTeamPlanState,
  botId: string, scriptedBots: Readonly<Record<string, string>>,
  tuning: AssignedCombatTuning & { weaponSwapIQ: number; weaponPrioritization: number; pressureAggression: number },
  memories: Readonly<Record<string, TacticalAIMemory>>, context: {
    random: () => number;
    scoreContext: AIMatchScoreContext;
    recentLungeMemory?: AILungeMemory | null;
    playerModel?: PlayerModelSnapshot | null;
  }, dt = 1 / 60, clockPhase: ScriptedDecisionClockPhase = 'before-swap-tick') {
  if (typeof context.random !== 'function') throw new Error('Tactical weapon decisions require a caller-owned random stream');
  if (!Object.hasOwn(memories, botId)) return null;
  const observation = resolveSimGrifballAssignedCombatInput(state, plan, botId, scriptedBots, tuning, memories[botId], dt, clockPhase);
  if (!observation) return null;
  const self = state.combatants.find(c => c.id === botId)!, target = state.combatants.find(c => c.id === observation.targetId)!;
  if (target.controller === 'ai' && !isMixedPlayer(state, target) && !Object.hasOwn(memories, target.id)) return null;
  const observed = observeSimTacticalWeaponTarget(state, target, memories[target.id]);
  const actor = (c: SimCombatant): TacticalWeaponActor => ({ id: c.id, team: c.team, pos: c.pos,
    hp: c.alive ? c.hp : 0, maxHp: c.maxHp, respawnTimer: c.respawnTimer, activeWeapon: c.weapon });
  const canStartWeaponAction = canStartAIWeaponAction({ ...memories[botId], swapCooldownTimer: remainingDecisionSwapTime(self.weaponReadyTimer, dt, clockPhase) });
  const decision = evaluateTacticalWeaponChoice({ settings: state.settings, self: actor(self), actors: state.combatants.map(actor),
    target: observed, difficulty: scriptedBots[botId], pressureAggression: tuning.pressureAggression,
    scoreContext: context.scoreContext, random: context.random,
    context: { distanceToTarget: observation.prediction.distanceToTarget, combatDistanceToTarget: observation.range.combatDistanceToTarget,
      canStartWeaponAction, weaponState: self.weaponState === 'idle' ? 'ready' : observeSimTacticalWeaponTarget(state, self).weaponState,
      weaponSwapIQ: tuning.weaponSwapIQ, weaponPrioritization: tuning.weaponPrioritization,
      recentLungeMemory: context.recentLungeMemory, playerModel: context.playerModel } });
  return { target: observed, prediction: observation.prediction, range: observation.range, decision };
}
