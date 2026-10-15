import test from 'node:test';
import assert from 'node:assert/strict';
import { MIXED_LIFECYCLE_CASES, runMixedLifecycleTrace } from './grifballMixedLifecycleParity';

for (const spec of MIXED_LIFECYCLE_CASES) test(`incoming mixed lifecycle ${JSON.stringify(spec)}`, () => {
  const trace = runMixedLifecycleTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const kind of ['hit-one', 'sword-two', 'hammer-one', 'double-respawn'] as const) test(`mixed lifecycle snapshot: ${kind}`, () => {
  const trace = runMixedLifecycleTrace({ kind, main: true, mirror: true, reverse: true }, kind === 'double-respawn' ? 1 : kind.endsWith('two') ? 2 : 180);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
