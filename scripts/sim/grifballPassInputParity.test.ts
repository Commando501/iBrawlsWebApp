import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_INPUT_CASES, runPassInputTrace } from './grifballPassInputParity';
import { createMatch } from '../../src/sim/factory';
import { hashState } from '../../src/sim/hash';
for (const field of ['passInputHeld', 'passCharging'] as const) test(`mixed pass snapshot hash includes ${field}`, () => {
  const state = createMatch({ seed: 2, combatExecution: 'live-mixed-v1' });
  state.localPlayerId = state.combatants[0].id;
  const before = hashState(state); state.combatants[0][field] = true;
  assert.notEqual(hashState(state), before);
  const restored = JSON.parse(JSON.stringify(state)); assert.equal(hashState(restored), hashState(state));
  state.combatExecution = 'legacy-v1'; const legacy = hashState(state);
  state.combatants[0][field] = false; assert.equal(hashState(state), legacy);
});
for (const spec of PASS_INPUT_CASES) test(`pointer pass frame ${JSON.stringify(spec)}`, () => {
  const trace = runPassInputTrace(spec); assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
for (const kind of ['overcharge', 'pickup-held', 'disable-reenable'] as const) test(`pass snapshot ${kind}`, () => {
  const trace = runPassInputTrace(PASS_INPUT_CASES.find(c => c.kind === kind && c.mirror)!, 4);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
