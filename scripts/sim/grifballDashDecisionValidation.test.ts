import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { validateDashDecisionTrace } from './grifballDashDecisionValidation';

test('dash audit rejects corrupted movement, timers, request evidence and cancellation', () => {
  const trace = runOpposedDecisionTrace({ mode: 'contested', team: 'blue', reverse: true, main: true, seed: 8 }, 'mobility');
  assert.equal(validateDashDecisionTrace(trace).failureCount, 0);
  const samples = trace.dashSamples!;
  const step = samples.find(s => !s.requested && s.target && s.before.remaining > 0 &&
    !s.before.jumping && !s.after.jumping && s.before.pos[1] === 0 && s.after.pos[1] === 0)!;
  const cancelled = samples.find(s => !s.target && s.before.remaining > 0)!;
  const started = samples.find(s => s.requested)!;
  assert.ok(step && cancelled && started, 'independent corruption witnesses must exist');
  for (const [sample, mutate, field] of [
    [step, (s: typeof step) => { s.after.pos[0] += .1; }, 'displacement'],
    [step, (s: typeof step) => { s.after.remaining = s.before.remaining; }, 'duration'],
    [step, (s: typeof step) => { s.after.cooldown = s.before.cooldown; }, 'cooldown'],
    [started, (s: typeof step) => { s.requested = false; }, 'unobserved'],
    [cancelled, (s: typeof step) => { s.after.remaining = s.before.remaining; }, 'target loss'],
  ] as const) {
    const corrupted = structuredClone(sample); mutate(corrupted);
    const result = validateDashDecisionTrace({ ...trace, dashSamples: samples.map(s => s === sample ? corrupted : s) });
    assert.ok(result.failures.some(f => f.field.includes(field)), `must reject ${field}`);
  }
  assert.ok(validateDashDecisionTrace({ ...trace, dashSamples: [] }).failureCount > 0);
});
