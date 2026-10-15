import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBORNE_CARRIER_FLIGHT_CASES, runAirborneCarrierFlightTrace } from './grifballAirborneCarrierFlightParity';

test('airborne carrier flights cover 64 distinct configurations', () => {
  assert.equal(AIRBORNE_CARRIER_FLIGHT_CASES.length, 64);
  assert.equal(new Set(AIRBORNE_CARRIER_FLIGHT_CASES.map(s => JSON.stringify(s))).size, 64);
});
for (const spec of AIRBORNE_CARRIER_FLIGHT_CASES) test(`airborne pickup ${JSON.stringify(spec)}`, () => {
  const trace = runAirborneCarrierFlightTrace(spec, 2);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  for (const side of ['live', 'headless', 'liveBot', 'simBot'] as const) {
    assert.equal(trace.frames[1][side].lunging, true, 'pickup occurs while both flights are committed');
  }
  assert.ok(trace.frames[1].liveBot.pos[1] > 0, 'roster flight is airborne at pickup');
});
for (const motion of ['roster-rising', 'roster-falling'] as const) {
  const spec = AIRBORNE_CARRIER_FLIGHT_CASES.find(s => s.motion === motion && s.actor === 'player'
    && s.hp === 2 && s.trade && s.main && s.first === 'player')!;
  for (const checkpoint of [1, 8, 180]) test(`airborne carrier continuation ${motion}/${checkpoint}`, () => {
    const trace = runAirborneCarrierFlightTrace(spec, checkpoint);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`airborne carrier repeat ${motion}`, () => {
    assert.deepEqual(runAirborneCarrierFlightTrace(spec), runAirborneCarrierFlightTrace(spec));
  });
}
