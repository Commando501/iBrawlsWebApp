import test from 'node:test';
import assert from 'node:assert/strict';
import { MULTI_ACTOR_CASES, runMultiActorParityTrace } from './grifballMultiActorParity';
for (const spec of MULTI_ACTOR_CASES) test(`multi-actor ${Object.values(spec).join('/')}`, () => {
  const result = runMultiActorParityTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
