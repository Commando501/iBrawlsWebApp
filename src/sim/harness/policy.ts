/**
 * A `Policy` maps the full {@link SimState} (+ which agent it controls) to an
 * {@link ActionInput}. Baseline policies (random, heuristic) implement this so they can
 * serve as both the **bootstrap opponent** and the **benchmark** for the learner, on
 * either side of a self-play match.
 *
 * Policies receive the injected {@link Rng} so any stochastic choice stays inside the
 * sim's determinism contract (no `Math.random`).
 */

import { type SimState } from '../simState';
import { type ActionInput } from '../actions';
import { type Rng } from '../rng';

export type Policy = (state: SimState, agentId: string, rng: Rng) => ActionInput;

/** Build an `ActionsById` for a whole roster from a single policy. */
export function rolloutActions(state: SimState, policy: Policy, rng: Rng): Record<string, ActionInput> {
  const out: Record<string, ActionInput> = {};
  for (const c of state.combatants) out[c.id] = policy(state, c.id, rng);
  return out;
}

/** Per-agent policy assignment (e.g. learner vs frozen opponent). Falls back to `def`. */
export function rolloutMixedActions(
  state: SimState,
  byAgent: Record<string, Policy>,
  def: Policy,
  rng: Rng
): Record<string, ActionInput> {
  const out: Record<string, ActionInput> = {};
  for (const c of state.combatants) {
    out[c.id] = (byAgent[c.id] ?? def)(state, c.id, rng);
  }
  return out;
}
