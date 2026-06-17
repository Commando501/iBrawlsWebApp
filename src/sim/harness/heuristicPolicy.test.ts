import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMatch } from '../factory';
import { createRng } from '../rng';
import { heuristicPolicy } from './heuristicPolicy';

test('heuristic fetcher requests pickup when chasing a free ball', () => {
  const state = createMatch({ seed: 91 });
  state.match.phase = 'playing';
  const self = state.combatants.find((c) => c.team === 'blue')!;
  const teammate = state.combatants.find((c) => c.team === 'blue' && c.id !== self.id)!;
  state.match.ball.state = 'idle';
  state.match.ball.holderId = null;
  state.match.ball.pos = { x: self.pos.x, y: 0.35, z: self.pos.z };
  teammate.pos = { x: self.pos.x + 12, y: 0, z: self.pos.z };

  const action = heuristicPolicy(state, self.id, createRng(1));

  assert.equal(action.pickup, true);
});
