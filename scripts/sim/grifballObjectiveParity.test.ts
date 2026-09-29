import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVE_PARITY_CASES, runObjectiveParityTrace } from './grifballObjectiveParity';

for (const spec of OBJECTIVE_PARITY_CASES) test(`objective boundary ${spec.kind}/${spec.carrier}/${spec.mirror}/${spec.reverse}/${spec.map?.id ?? 'default'}`, () => {
  const result = runObjectiveParityTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
for (const kind of ['pass-full', 'pass-catch', 'winner', 'round-reset'] as const) test(`objective snapshot ${kind}`, () => {
  const result = runObjectiveParityTrace(OBJECTIVE_PARITY_CASES.find(c => c.kind === kind && c.reverse && c.mirror)!, 1);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
