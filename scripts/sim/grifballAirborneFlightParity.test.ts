import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBORNE_FLIGHT_CASES, runAirborneFlightTrace } from './grifballAirborneFlightParity';

test('airborne opposing flights cover 512 distinct configurations', () => {
  assert.equal(AIRBORNE_FLIGHT_CASES.length, 512);
  assert.equal(new Set(AIRBORNE_FLIGHT_CASES.map(s => JSON.stringify(s))).size, 512);
});
for (const spec of AIRBORNE_FLIGHT_CASES) test(`airborne opposing flight ${JSON.stringify(spec)}`, () => {
  const trace = runAirborneFlightTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const motion of [...new Set(AIRBORNE_FLIGHT_CASES.map(s => s.motion))]) {
  for (const hp of [1, 2]) test(`airborne snapshot ${motion}/${hp} HP`, () => {
    const spec = AIRBORNE_FLIGHT_CASES.find(s => s.motion === motion && s.hp === hp && s.trade && s.main && s.mirror && s.reverse && s.first === 'roster')!;
    const trace = runAirborneFlightTrace(spec, hp === 1 ? 180 : 3);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
  test(`airborne exact repeat ${motion}`, () => {
    const spec = AIRBORNE_FLIGHT_CASES.find(s => s.motion === motion && s.hp === 2 && s.trade && s.main && s.mirror && s.reverse && s.first === 'roster')!;
    assert.deepEqual(runAirborneFlightTrace(spec), runAirborneFlightTrace(spec));
  });
}
