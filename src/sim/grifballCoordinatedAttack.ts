import { shouldBlockCoordinatedAttackForFrame } from '../game/aiCoordinatedAttack';
import { resolveBehaviorTuning } from '../game/aiBehaviorTuning';
import { getEngagingBotIds, type BotCoordinatorState } from '../game/aiBotCoordinator';
import { retainSimGrifballCombatObservation, type SimGrifballCombatObservation } from './grifballCombatObservation';
import { observeSimTacticalWeaponTarget, type TacticalAIMemory } from './grifballTacticalWeaponChoice';
import { isMixedPlayer, type SimState } from './simState';

/** Evaluate at the attack decision, after this frame's registrations and earlier
 * actors' completion callbacks. Current physical swing/flight and caller-owned
 * AI states both matter. No clocks, registration, RNG or memory mutation occurs. */
export function resolveSimGrifballCoordinatedAttack(state: SimState, botId: string,
  scriptedBots: Readonly<Record<string, string>>, observation: SimGrifballCombatObservation,
  context: { coordinator: BotCoordinatorState; memories: Readonly<Record<string, TacticalAIMemory>>;
    commitTimer: number }, dt = 1 / 60): { blocked: boolean } | null {
  if (!Number.isFinite(context.commitTimer) || context.commitTimer < 0 ||
    !(context.coordinator?.engagements instanceof Map) || !(context.coordinator?.tacticalEngagements instanceof Map))
    throw new Error('Invalid coordinated attack owner');
  const retained = retainSimGrifballCombatObservation(state, botId, scriptedBots, observation, dt);
  if (!retained) return null;
  const project = (id: string) => {
    const matches = state.combatants.filter(c => c.id === id);
    if (matches.length > 1) throw new Error(`Ambiguous coordinated attack actor: ${id}`);
    const actor = matches[0];
    if (!actor) return undefined;
    const memory = Object.hasOwn(context.memories, id) ? context.memories[id] : undefined;
    if (actor.controller === 'ai' && !isMixedPlayer(state, actor) && !memory)
      throw new Error(`Coordinated attack requires current AI memory: ${id}`);
    return { ...observeSimTacticalWeaponTarget(state, actor, memory), aiState: memory?.aiState };
  };
  const target = project(retained.targetId)!;
  const roster = new Map<string, NonNullable<ReturnType<typeof project>>>();
  for (const id of getEngagingBotIds(context.coordinator, retained.targetId)) {
    const actor = project(id);
    if (actor) roster.set(id, actor);
  }
  return { blocked: shouldBlockCoordinatedAttackForFrame({ coordinator: context.coordinator,
    botId, targetId: retained.targetId, difficulty: scriptedBots[botId], commitTimer: context.commitTimer,
    attackStaggerStep: resolveBehaviorTuning(state.settings).attackStaggerStep,
    targetWeaponState: target.weaponState, targetRecovering: target.weaponState === 'recovering',
    mainAI: roster.get('main_ai'), otherPlayers: roster,
  }) };
}
