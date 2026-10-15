import test from 'node:test';
import assert from 'node:assert/strict';
import { CARRIER_RECOVERY_CASES, runCarrierRecoveryTrace } from './grifballCarrierRecoveryParity';
for (const spec of CARRIER_RECOVERY_CASES) test(`carrier recovery ${JSON.stringify(spec)}`, () => {
  const trace = runCarrierRecoveryTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});

for (const motion of ['stationary', 'cross', 'retreat']) for (const lunge of [false, true]) for (const hp of [1, 2])
  for (const snapshotAt of [11, 12, 16, 17]) test(`carrier recovery snapshot ${motion}/${lunge}/${hp}/${snapshotAt}`, () => {
    const spec = CARRIER_RECOVERY_CASES.find(c => c.frame.player && c.frame.lunge === lunge && c.frame.hp === hp && c.frame.reverse && c.frame.mirror
      && c.crowd.recovery!.motion === motion && c.crowd.recovery!.escortHp === 3 && c.crowd.recovery!.attackAt === 12)!;
    const trace = runCarrierRecoveryTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
