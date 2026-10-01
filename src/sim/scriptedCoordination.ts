import type { BotCoordinatorState } from '../game/aiBotCoordinator';
import type { SimState } from './simState';

export interface ScriptedCoordination {
  version: 'scripted-coordination-v1';
  /** Shared with target selection, attack gates and lunge/damage feedback. */
  coordinator: BotCoordinatorState;
}

export function validateScriptedCoordination(state: SimState, owner: ScriptedCoordination | undefined,
  hasPlanner: boolean, feedbackCoordinator: BotCoordinatorState | undefined, dt: number): void {
  if (!owner) return;
  if (owner.version !== 'scripted-coordination-v1' || state.mode !== 'grifball' ||
    state.combatExecution !== 'live-mixed-v1' || !hasPlanner || !Number.isFinite(dt) || dt <= 0)
    throw new Error('Scripted coordination requires mixed Grifball planning and a positive timestep');
  const c = owner.coordinator;
  if (!c || !Number.isFinite(c.priorityAge) || c.priorityAge < 0 ||
    !(c.recentTags instanceof Map) || !(c.engagements instanceof Map) || !(c.tacticalEngagements instanceof Map))
    throw new Error('Invalid scripted coordinator memory');
  for (const tags of c.recentTags.values()) {
    if (!(tags instanceof Map) || [...tags.values()].some(t => !Number.isFinite(t) || t < 0))
      throw new Error('Invalid scripted coordinator damage tags');
  }
  for (const order of c.tacticalEngagements.values())
    if (!order || typeof order.targetId !== 'string' || !['pressure', 'flanker', 'punisher'].includes(order.role))
      throw new Error('Invalid scripted coordinator tactical order');
  if (feedbackCoordinator && feedbackCoordinator !== c)
    throw new Error('Scripted coordination and lunge feedback must share coordinator memory');
}
