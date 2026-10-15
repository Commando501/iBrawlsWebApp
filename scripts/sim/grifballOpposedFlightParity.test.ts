import test from 'node:test';
import assert from 'node:assert/strict';
import { OPPOSED_FLIGHT_CASES, runOpposedFlightTrace } from './grifballOpposedFlightParity';

for (const spec of OPPOSED_FLIGHT_CASES) test(`opposed player/roster flight ${JSON.stringify(spec)}`, () => {
  const trace = runOpposedFlightTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const first of ['player', 'roster'] as const) for (const hp of [1, 2]) test(`opposed snapshot: ${first}, ${hp} HP`, () => {
  const spec = OPPOSED_FLIGHT_CASES.find(c => c.main && c.mirror && c.reverse && c.opposed.first === first
    && c.opposed.playerHp === hp && c.opposed.botHp === hp && c.opposed.trade)!;
  const trace = runOpposedFlightTrace(spec, hp === 1 ? 180 : 3);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
