import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARGE_COMBAT_CASES, runChargeCombatTrace } from './grifballChargeCombatParity';
for (const recovery of ['hold', 'repress'] as const) for (const snapshotAt of [186, 190]) test(`recovery input snapshot ${recovery}/${snapshotAt}`, () => {
  const trace = runChargeCombatTrace(CHARGE_COMBAT_CASES.find(c => c.charge.recovery === recovery && c.frame.lunge && c.charge.moving)!, snapshotAt);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const spec of CHARGE_COMBAT_CASES) test(`charge combat ${JSON.stringify(spec)}`, () => {
  const trace = runChargeCombatTrace(spec); assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const lunge of [false, true]) for (const snapshotAt of [1, 180]) test(`charge combat snapshot ${lunge}/${snapshotAt}`, () => {
  const trace = runChargeCombatTrace(CHARGE_COMBAT_CASES.find(c => c.frame.lunge === lunge && c.frame.hp === 1 && c.frame.mirror && c.charge.releaseAt === null && !c.charge.shield && c.charge.moving)!, snapshotAt);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
