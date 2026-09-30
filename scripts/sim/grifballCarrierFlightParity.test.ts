import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_FLIGHT_CASES, runCarrierFlightTrace } from './grifballCarrierFlightParity';

for (const spec of CARRIER_FLIGHT_CASES) test(`pickup during opposing flights ${JSON.stringify(spec)}`, () => {
  const trace = runCarrierFlightTrace(spec, 2);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  const holder = spec.opposed.pickup.actor === 'player' ? 'player' : spec.main ? 'main_ai' : 'attacker';
  for (const side of ['liveBall', 'simBall'] as const) {
    assert.equal(trace.frames[0][side]!.holderId, null, 'no pickup before the request');
    assert.equal(trace.frames[1][side]!.holderId, holder, 'physical pickup on tick two');
  }
  for (const side of spec.opposed.pickup.actor === 'player' ? ['live', 'headless'] as const : ['liveBot', 'simBot'] as const) {
    assert.equal(trace.frames[1][side].lunging, true, 'pickup occurs before flight contact');
    assert.equal(trace.frames[1][side].hp, spec.opposed.pickup.hp, 'pickup applies runner health');
}
});

for (const actor of ['player', 'roster'] as const) for (const checkpoint of [1, 6]) test(`carrier flight snapshot ${actor} at ${checkpoint}`, () => {
  const spec = CARRIER_FLIGHT_CASES.find(c => c.main && c.opposed.pickup.actor === actor && c.opposed.pickup.hp === 1 && c.opposed.trade)!;
  const trace = runCarrierFlightTrace(spec, checkpoint);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
