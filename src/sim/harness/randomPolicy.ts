/**
 * Masked-random baseline: samples a uniform action from the factorized discrete space
 * and decodes it. It exercises the exact `decodeAction` path the learner uses, so it is a
 * faithful "do random legal things" floor — the benchmark the heuristic and learner must
 * beat decisively (plan Verification #6).
 */

import { type Policy } from './policy';
import { ACTION_NVEC, decodeAction } from '../env/action';
import { idleAction } from '../actions';

const _factors = new Int32Array(ACTION_NVEC.length);

export const randomPolicy: Policy = (state, agentId, rng) => {
  const self = state.combatants.find((c) => c.id === agentId);
  if (!self || !self.alive) return idleAction();
  for (let i = 0; i < ACTION_NVEC.length; i++) {
    _factors[i] = rng.int(0, ACTION_NVEC[i] - 1);
  }
  return decodeAction(_factors, state, agentId);
};
