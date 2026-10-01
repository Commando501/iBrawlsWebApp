import type { AIMatchContext } from '../game/aiMatchContext';
import type { SimTargetEngagementMemory } from './grifballTargetEngagement';
import type { LungeAIMemory } from './scriptedLungeFeedback';
import type { ScriptedActorDecision } from './scriptedActorDecision';
import { resolveSimGrifballTacticalComboInput } from './grifballTacticalComboInput';
import { resolveSimGrifballEvasionInput } from './grifballEvasionInput';
import { observeSimTacticalWeaponTarget } from './grifballTacticalWeaponChoice';

type ComboArgs = Parameters<typeof resolveSimGrifballTacticalComboInput>;
type EvasionContext = Parameters<typeof resolveSimGrifballEvasionInput>[4];
export interface SimCombatPriorityMemory extends SimTargetEngagementMemory, LungeAIMemory {
  pendingPostEvasionCharge: boolean;
}

/** Scheduled engagement priorities, after target observation and before physical
 * recovery/ground steering. Owns combo/feint/state clocks and memory adoption.
 * The caller still owns target selection, adaptive preparation, model feedback,
 * ground movement and committed flight. No physical state is mutated here. */
export function resolveSimGrifballCombatPriorities(state: ComboArgs[0], botId: string,
  scriptedBots: ComboArgs[3], tuning: ComboArgs[4], memories: Record<string, SimCombatPriorityMemory>,
  context: Pick<ComboArgs[6], 'observation' | 'scoreContext' | 'random' | 'playerModel'> & {
    matchContext: AIMatchContext; defensiveEvasionMult: number; spatialIQ: number; resolvedDangerZone: number;
  }, dt = 1 / 60) {
  const memory = memories[botId];
  if (!memory) return null;
  if (![memory.swayTimer, memory.timer ?? 0, context.defensiveEvasionMult, context.spatialIQ, context.resolvedDangerZone].every(Number.isFinite) ||
    context.spatialIQ < 0 || context.spatialIQ > 100 || context.resolvedDangerZone < 0 ||
    typeof memory.pendingPostEvasionCharge !== 'boolean') throw new Error('Invalid combat priority memory or tuning');
  const ai = context.matchContext;
  if (!(ai?.comboState instanceof Map) || !(ai.feintCooldowns instanceof Map) || !(ai.weaponSwapFeintTimers instanceof Map))
    throw new Error('Combat priorities require shared combo and feint memory');
  const combo = resolveSimGrifballTacticalComboInput(state, ai.grifballTeamPlan, botId, scriptedBots, tuning, memories, {
    ...context, comboState: ai.comboState.get(botId) ?? null,
    recentLungeMemory: memory.lastLungeOutcome ? { outcome: memory.lastLungeOutcome,
      targetId: memory.lastLungeTargetId, timeRemaining: memory.postLungeDecisionTimer ?? 0 } : null,
    weaponFeintMemory: { cooldownRemaining: ai.feintCooldowns.get(botId), swapRemaining: ai.weaponSwapFeintTimers.get(botId) },
  }, dt, 'after-swap-tick');
  if (!combo) return null;
  const next = { ...memory, aiState: combo.frame.aiState, timer: combo.frame.timer };
  let decision: Extract<ScriptedActorDecision, { kind: 'handled' }> = { kind: 'handled', action: combo.action,
    ...(context.observation?.committedFlight ? { flightTargetId: combo.targetId } : {}),
    commands: combo.scriptedCombat.commands[botId], commandVersion: 'scripted-combat-v6' };
  let evasion: ReturnType<typeof resolveSimGrifballEvasionInput> = null;
  // A combo lunge returns before evasion, airborne opportunities and timer/sway
  // advancement. The scheduler commits its flight without integrating it yet.
  if (combo.frame.mode !== 'sync_return') {
    const target = state.combatants.find(c => c.id === combo.targetId)!;
    const threat = observeSimTacticalWeaponTarget(state, target).isLunging;
    if (combo.tactical.decision.postMissSpacing && !threat && next.aiState !== 'COOLDOWN' && next.aiState !== 'PRESSURING') {
      next.aiState = 'DANCING_BACKWARD'; next.timer = Math.max(next.timer ?? 0, .45);
    }
    const { observation } = context;
    const evasionContext: EvasionContext = { motionPhase: 'after-engagement-gravity', observation,
      weaponFrame: combo.weaponFrame, pendingPostEvasionCharge: next.pendingPostEvasionCharge,
      bulltrueCounter: combo.tactical.decision.bulltrueCounter, defensiveEvasionMult: context.defensiveEvasionMult,
      spatialIQ: context.spatialIQ, swayTimer: next.swayTimer, random: context.random, playerModel: context.playerModel,
      airborneOpportunity: { targetAirborne: observation.prediction.targetAirborne,
        movementComplexity: tuning.movementComplexity, resolvedDangerZone: context.resolvedDangerZone,
        tunedAnticipationFactor: tuning.tunedAnticipationFactor, enemyInKillRange: observation.range.enemyInKillRange,
        verticalDeltaToTarget: observation.range.verticalDeltaToTarget } };
    evasion = resolveSimGrifballEvasionInput(state, botId, scriptedBots, { ...memories, [botId]: next }, evasionContext, dt);
    if (!evasion) throw new Error('Evasion ownership changed within the combat turn');
    Object.assign(next, { aiState: evasion.frame.aiState, timer: (evasion.frame.timer ?? 0) - dt,
      swayTimer: next.swayTimer + dt, pendingPostEvasionCharge: evasion.frame.pendingPostEvasionCharge });
    decision = { ...decision, commands: [...decision.commands!, ...evasion.commands],
      ...(evasion.mobility ? { mobility: evasion.mobility, mobilityAfterCommands: decision.commands!.length } : {}),
      ...(evasion.dash ? { dash: evasion.dash } : {}), holdAfterEvasion: evasion.holdAfterEvasion };
  }
  // Adopt only after all decisions have resolved. The policy RNG is consumed in
  // place; callback failures do not promise a random-stream rollback.
  Object.assign(memory, next);
  if (combo.comboState) ai.comboState.set(botId, combo.comboState); else ai.comboState.delete(botId);
  for (const [map, value] of [[ai.feintCooldowns, combo.weaponFeintMemory!.cooldownRemaining],
    [ai.weaponSwapFeintTimers, combo.weaponFeintMemory!.swapRemaining]] as const) {
    if (value === undefined) map.delete(botId); else map.set(botId, value);
  }
  return { actorId: botId, tick: state.tick, decision, combo, evasion, weaponFrame: evasion?.weaponFrame ?? combo.weaponFrame,
    mode: combo.frame.mode, targetId: combo.targetId };
}
