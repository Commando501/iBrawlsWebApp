import type { AIBehaviorState } from '../types';

/** An assigned bot does not invent an unrelated duel. Finishing committed
 * movement uses ordinary tactical selection; pressure locks apply only without
 * a team assignment, and an unavailable lock preserves the selected fallback. */
export function selectAIEngagementTarget<T>(input: {
  hasAssignment: boolean;
  assignmentThreat: string | null;
  finishingMovement: boolean;
  aiState: AIBehaviorState | undefined;
  pressureTargetId: string | undefined;
  getById: (id: string) => T | null;
  getBest: () => T | null;
}): T | null {
  let target = input.hasAssignment && !input.finishingMovement
    ? input.assignmentThreat ? input.getById(input.assignmentThreat) : null
    : input.getBest();
  if (input.aiState === 'PRESSURING' && input.pressureTargetId && !input.hasAssignment) {
    const locked = input.getById(input.pressureTargetId);
    if (locked) target = locked;
  }
  return target;
}
