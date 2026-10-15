import test from 'node:test';
import assert from 'node:assert/strict';
import { TURNING_FLIGHT_CASES, runTurningFlightTrace } from './grifballTurningFlightParity';

test('turning flight matrix covers ground/rising/falling, both pickups, contact orders, trades and paired identities', () => {
  assert.equal(TURNING_FLIGHT_CASES.length, 48);
  assert.equal(new Set(TURNING_FLIGHT_CASES.map(s => JSON.stringify(s))).size, 48);
});
for (const s of TURNING_FLIGHT_CASES) test(`turn during opposing flight ${JSON.stringify(s)}`, () => {
  const trace = runTurningFlightTrace(s, 2);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const kind of ['grounded', 'airborne'] as const) {
  const s = TURNING_FLIGHT_CASES.find(s => s.kind === kind && s.spec.main)!;
  for (const checkpoint of [1, 8, 180]) test(`turning flight continuation ${kind}/${checkpoint}`, () => {
    const trace = runTurningFlightTrace(s, checkpoint);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`turning flight repeats ${kind}`, () => assert.deepEqual(runTurningFlightTrace(s), runTurningFlightTrace(s)));
}
