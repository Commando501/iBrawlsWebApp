import test from 'node:test';
import assert from 'node:assert/strict';
import { MIXED_CONTACT_CASES, runMixedContactParityTrace } from './grifballMixedContactParity';
for (const spec of MIXED_CONTACT_CASES) test(`mixed contact ${Object.values(spec).join('/')}`, () => {
  const result = runMixedContactParityTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
