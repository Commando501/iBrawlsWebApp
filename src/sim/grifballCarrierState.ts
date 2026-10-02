import type { SimCombatant, SimState } from './simState';

/** A combat fallback may retain the runner's ball, but cannot invent possession
 * from just one of the physical/objective representations. Sword flight remains
 * incompatible with carrying. Ordinary armed actors need no possession owner. */
export function hasCoherentSimCarrierState(state: SimState, actor: SimCombatant): boolean {
  const held = state.match.ball.holderId === actor.id;
  if (!actor.hasBall && actor.weapon !== 'ball' && !held) return true;
  return actor.hasBall && actor.weapon === 'ball' && held && state.match.ball.state === 'held' && !actor.isLunging;
}
