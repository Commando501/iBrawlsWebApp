import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAYER_LUNGE_PARITY_CASES, runPlayerLungeParityTrace } from './grifballPlayerLungeParity';
import { createMatch } from '../../src/sim/factory';
import { stepSimulation } from '../../src/sim/step';
import { hashState } from '../../src/sim/hash';

for (const spec of PLAYER_LUNGE_PARITY_CASES) test(`mixed player parity ${JSON.stringify(spec)}`, () => {
  const trace = runPlayerLungeParityTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 12)));
});

test('mixed execution rejects missing, unknown and ambiguous local player identities before stepping', () => {
  const state = createMatch({ seed: 17, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  for (const identity of [undefined, 'absent', state.combatants[0].id]) {
    state.localPlayerId = identity;
    if (identity === state.combatants[0].id) state.combatants[1].id = identity;
    const before = structuredClone(state);
    assert.throws(() => stepSimulation(state, {}), /exactly one explicit localPlayerId/);
    assert.deepEqual(state, before);
  }
});

test('mixed actor identity, flight direction and trade history affect the state hash without changing legacy hashes', () => {
  const state = createMatch({ seed: 17, combatExecution: 'live-mixed-v1', teamSizes: { blue: 1, red: 1 } });
  state.localPlayerId = state.combatants[0].id;
  for (const mutate of [
    (s: typeof state) => { s.localPlayerId = s.combatants[1].id; },
    (s: typeof state) => { s.combatants[0].lungeDir.x += 1; },
    (s: typeof state) => { s.combatants[0].lastSwordAttackTimeMs = 10; },
  ]) {
    const changed = structuredClone(state); mutate(changed);
    assert.notEqual(hashState(changed), hashState(state));
  }
  state.combatExecution = 'legacy-v1';
  const before = hashState(state); delete state.combatExecution; delete state.localPlayerId;
  assert.equal(hashState(state), before);
});

for (const kind of ['hit-one', 'sword-trade-two', 'killed-flight'] as const) test(`mixed snapshot continuation: ${kind}`, () => {
  const trace = runPlayerLungeParityTrace({ kind, mainTarget: true, reverse: true, mirror: true }, 'live-mixed-v1', kind.includes('trade') ? 1 : 5);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences));
});

test('prior player execution remains an explicit incompatible diagnostic', () => {
  const trace = runPlayerLungeParityTrace(PLAYER_LUNGE_PARITY_CASES[0], 'live-player-v1');
  assert.ok(trace.differenceCount > 0);
});
