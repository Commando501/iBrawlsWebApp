import test from 'node:test';
import assert from 'node:assert/strict';
import { runOpposedDecisionTrace } from './grifballOpposedDecisionIntegration';
import { validateDashDecisionTrace } from './grifballDashDecisionValidation';
import { MOBILITY_DECISION_CASES } from './grifballMobilityDecisionIntegration';

type Trace = ReturnType<typeof runOpposedDecisionTrace>;
type Sample = NonNullable<Trace['dashSamples']>[number];
const predicates = {
  step: (s: Sample) => !s.requested && !!s.target && s.before.remaining > 0 &&
    !s.before.jumping && !s.after.jumping && s.before.pos[1] === 0 && s.after.pos[1] === 0,
  cancelled: (s: Sample) => !s.target && s.before.remaining > 0,
  started: (s: Sample) => s.requested,
  flight: (s: Sample) => !s.requested && !!s.target && !s.incomingThreat && s.before.remaining > 0 &&
    s.before.pos[1] > 1 && s.after.pos[1] > 1 && Math.hypot(s.before.vel[0], s.before.vel[2]) > .1,
  landing: (s: Sample) => !s.requested && !!s.target && !s.incomingThreat && s.before.remaining > 0 &&
    s.before.pos[1] > 0 && s.after.pos[1] === 0,
};
type Witnesses = Record<keyof typeof predicates, {trace: Trace; sample: Sample}>;
let cached: Witnesses | undefined;
function corruptionWitnesses(): Witnesses {
  if (cached) return cached;
  const found = {} as Witnesses;
  // Validate every original case, then select the first observed example of
  // each required behavior. No outcome or seed is excluded from the audit.
  for (const spec of MOBILITY_DECISION_CASES) {
    const trace = runOpposedDecisionTrace(spec, 'mobility');
    assert.equal(trace.failureCount, 0, JSON.stringify({spec, failures:trace.failures}));
    const audit = validateDashDecisionTrace(trace);
    assert.equal(audit.failureCount, 0, JSON.stringify({spec, failures:audit.failures}));
    for (const kind of Object.keys(predicates) as (keyof Witnesses)[]) {
      if (found[kind]) continue;
      const sample = trace.dashSamples!.find(predicates[kind]);
      if (sample) found[kind] = {trace, sample};
    }
  }
  for (const kind of Object.keys(predicates) as (keyof Witnesses)[])
    assert.ok(found[kind], `fixed mobility matrix must contain a ${kind} corruption witness`);
  return cached = found;
}

test('dash audit rejects corrupted movement, timers, request evidence and cancellation', (t) => {
  const witnesses = corruptionWitnesses();
  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(witnesses).map(([kind, w]) =>
    [kind, {scenario:w.trace.scenario, tick:w.sample.tick, actor:w.sample.id}]))));
  for (const [witness, mutate, field] of [
    [witnesses.step, (s: Sample) => { s.after.pos[0] += .1; }, 'displacement'],
    [witnesses.step, (s: Sample) => { s.after.remaining = s.before.remaining; }, 'duration'],
    [witnesses.step, (s: Sample) => { s.after.cooldown = s.before.cooldown; }, 'cooldown'],
    [witnesses.started, (s: Sample) => { s.requested = false; }, 'unobserved'],
    [witnesses.cancelled, (s: Sample) => { s.after.remaining = s.before.remaining; }, 'target loss'],
  ] as const) {
    const {trace, sample} = witness, samples = trace.dashSamples!;
    const corrupted = structuredClone(sample); mutate(corrupted);
    const result = validateDashDecisionTrace({ ...trace, dashSamples: samples.map(s => s === sample ? corrupted : s) });
    assert.ok(result.failures.some(f => f.field.includes(field)), `must reject ${field}`);
  }
  assert.ok(validateDashDecisionTrace({ ...witnesses.step.trace, dashSamples: [] }).failureCount > 0);
});

test('dash audit rejects corrupted suspended flight and landing state', () => {
  const {flight, landing} = corruptionWitnesses();
  for (const [witness, mutate, field] of [
    [flight, (s: Sample) => { s.after.remaining -= 1 / 60; }, 'suspended dash duration'],
    [flight, (s: Sample) => { s.after.direction.x! += .1; }, 'direction'],
    [flight, (s: Sample) => { s.after.pos[1] += .1; }, 'vertical displacement'],
    [flight, (s: Sample) => { s.after.vel[1] += .1; }, 'vertical velocity'],
    [flight, (s: Sample) => { s.after.pos[0] += .1; }, 'drift x displacement'],
    [flight, (s: Sample) => { s.after.vel[0] += .1; }, 'drift x velocity'],
    [flight, (s: Sample) => { s.after.pos[1] = 0; s.after.jumping = false; }, 'vertical displacement'],
    [flight, (s: Sample) => { delete (s as Partial<typeof s>).incomingThreat; }, 'threat observation'],
    [landing, (s: Sample) => { s.after.remaining = s.before.remaining; }, 'landing dash duration'],
    [landing, (s: Sample) => { s.after.pos[0] += .1; }, 'landing x displacement'],
    [landing, (s: Sample) => { s.after.jumping = true; }, 'landing clears airborne'],
  ] as const) {
    const {trace, sample} = witness, samples = trace.dashSamples!;
    const corrupted = structuredClone(sample); mutate(corrupted);
    const result = validateDashDecisionTrace({ ...trace, dashSamples: samples.map(s => s === sample ? corrupted : s) });
    assert.ok(result.failures.some(f => f.field.includes(field)), `must reject ${field}`);
  }
});
