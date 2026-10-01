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

test('dash audit rejects corrupted suspended flight and landing state', () => {
  const trace = runOpposedDecisionTrace({ mode: 'contested', team: 'blue', reverse: true, main: true, seed: 8 }, 'mobility');
  const samples = trace.dashSamples!;
  const flight = samples.find(s => !s.requested && s.target && !s.incomingThreat && s.before.remaining > 0 &&
    s.before.pos[1] > 1 && s.after.pos[1] > 1 && Math.hypot(s.before.vel[0], s.before.vel[2]) > .1)!;
  const landing = samples.find(s => !s.requested && s.target && !s.incomingThreat && s.before.remaining > 0 &&
    s.before.pos[1] > 0 && s.after.pos[1] === 0)!;
  assert.ok(flight && landing, 'autonomous suspended flight and landing witnesses must exist');
  assert.equal(validateDashDecisionTrace(trace).failureCount, 0);
  for (const [sample, mutate, field] of [
    [flight, (s: typeof flight) => { s.after.remaining -= 1 / 60; }, 'suspended dash duration'],
    [flight, (s: typeof flight) => { s.after.direction.x! += .1; }, 'direction'],
    [flight, (s: typeof flight) => { s.after.pos[1] += .1; }, 'vertical displacement'],
    [flight, (s: typeof flight) => { s.after.vel[1] += .1; }, 'vertical velocity'],
    [flight, (s: typeof flight) => { s.after.pos[0] += .1; }, 'drift x displacement'],
    [flight, (s: typeof flight) => { s.after.vel[0] += .1; }, 'drift x velocity'],
    [flight, (s: typeof flight) => { s.after.pos[1] = 0; s.after.jumping = false; }, 'vertical displacement'],
    [flight, (s: typeof flight) => { delete (s as Partial<typeof s>).incomingThreat; }, 'threat observation'],
    [landing, (s: typeof flight) => { s.after.remaining = s.before.remaining; }, 'landing dash duration'],
    [landing, (s: typeof flight) => { s.after.pos[0] += .1; }, 'landing x displacement'],
    [landing, (s: typeof flight) => { s.after.jumping = true; }, 'landing clears airborne'],
  ] as const) {
    const corrupted = structuredClone(sample); mutate(corrupted);
    const result = validateDashDecisionTrace({ ...trace, dashSamples: samples.map(s => s === sample ? corrupted : s) });
    assert.ok(result.failures.some(f => f.field.includes(field)), `must reject ${field}`);
  }
});
