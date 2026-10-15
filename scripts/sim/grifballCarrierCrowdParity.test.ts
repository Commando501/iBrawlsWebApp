import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_CROWD_CASES, runCarrierCrowdTrace } from './grifballCarrierCrowdParity';
for (const spec of CARRIER_CROWD_CASES) test(`carrier crowd ${JSON.stringify(spec)}`, () => {
  const trace = runCarrierCrowdTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const player of [false, true]) for (const mode of ['slash', 'lunge', 'mixed']) for (const snapshotAt of [1, 2]) test(`carrier crowd snapshot ${player}/${mode}/${snapshotAt}`, () => {
  const trace = runCarrierCrowdTrace(CARRIER_CROWD_CASES.find(c => c.frame.player === player && c.frame.lunge === (mode === 'lunge') && c.crowd.secondLunge === (mode !== 'slash') && c.frame.hp === 2 && c.frame.reverse && !c.crowd.shield && c.crowd.pickup === 'tie')!, snapshotAt);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
