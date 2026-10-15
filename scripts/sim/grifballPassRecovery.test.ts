import test from 'node:test';
import assert from 'node:assert/strict';
import { PASS_RECOVERY_CASES, runPassRecoveryTrace } from './grifballPassRecovery';

for (const spec of PASS_RECOVERY_CASES) test(`released pass recovery ${spec.opening}/${spec.team}/${spec.reverse}/${spec.main}`, () => {
  const trace = runPassRecoveryTrace(spec);
  assert.equal(trace.failureCount, 0, JSON.stringify(trace.failures));
  assert.equal(trace.frames.length, 600);
  assert.equal(trace.boundary, 'live-pass-recovery');
});
test('recovery matrix covers four openings, mirrored teams, orders and main/ordinary opposing recoverers', () => {
  assert.equal(PASS_RECOVERY_CASES.length, 32);
  assert.equal(new Set(PASS_RECOVERY_CASES.map(s => `${s.opening}/${s.team}/${s.reverse}/${s.main}`)).size, 32);
});
for (const opening of ['interception', 'overthrow', 'distant-opponent', 'short-pass'] as const) test(`pass recovery exact repeat: ${opening}`, () => {
  const spec = PASS_RECOVERY_CASES.find(s => s.opening === opening && s.main)!;
  assert.deepEqual(runPassRecoveryTrace(spec), runPassRecoveryTrace(spec));
});
