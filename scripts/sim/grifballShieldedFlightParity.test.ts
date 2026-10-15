import test from 'node:test';
import assert from 'node:assert/strict';
import { SHIELDED_FLIGHT_CASES, runShieldedFlightTrace } from './grifballShieldedFlightParity';

test('shielded flights cover six shield profiles and 384 distinct configurations', () => {
  assert.equal(SHIELDED_FLIGHT_CASES.length, 384);
  assert.equal(new Set(SHIELDED_FLIGHT_CASES.map(s => JSON.stringify(s))).size, 384);
});
for (const spec of SHIELDED_FLIGHT_CASES) test(`shielded opposed flight ${JSON.stringify(spec)}`, () => {
  const trace = runShieldedFlightTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const shield of [...new Set(SHIELDED_FLIGHT_CASES.map(s => s.shield))]) {
  for (const hp of [1, 2]) test(`shielded snapshot ${shield}/${hp} HP`, () => {
    const spec = SHIELDED_FLIGHT_CASES.find(s => s.shield === shield && s.hp === hp && s.trade && s.main && s.mirror && s.reverse && s.first === 'roster')!;
    const trace = runShieldedFlightTrace(spec, hp === 1 ? 180 : 3);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`shielded exact repeat ${shield}`, () => {
    const spec = SHIELDED_FLIGHT_CASES.find(s => s.shield === shield && s.hp === 1 && s.trade && s.main && s.mirror && s.reverse)!;
    assert.deepEqual(runShieldedFlightTrace(spec), runShieldedFlightTrace(spec));
  });
}
