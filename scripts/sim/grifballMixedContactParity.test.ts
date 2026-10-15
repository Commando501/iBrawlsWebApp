import test from 'node:test';
import assert from 'node:assert/strict';
import { MIXED_CONTACT_CASES, AIRBORNE_MIXED_CONTACT_CASES, runMixedContactParityTrace,
  runAirborneMixedContactTrace, validateAirborneMixedContact, runMixedContactParity } from './grifballMixedContactParity';
import { compactExecutionTraces } from './grifballParityEvidence';
for (const spec of MIXED_CONTACT_CASES) test(`mixed contact ${Object.values(spec).join('/')}`, () => {
  const result = runMixedContactParityTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
for (const spec of AIRBORNE_MIXED_CONTACT_CASES) test(`airborne mixed contact ${Object.values(spec).join('/')}`, () => {
  const result = runAirborneMixedContactTrace(spec);
  assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
});
for (const motion of ['rising', 'falling'] as const) for (const attack of ['slash', 'slam', 'swipe'] as const) {
  for (const snapshotAt of [6, 7]) test(`airborne ${motion}/${attack} snapshot after tick ${snapshotAt}`, () => {
    const spec = { kind: 'double-flight-three', motion, attack, mainRole: 'lunger', reverse: true, observer: true } as const;
    const result = runAirborneMixedContactTrace(spec, snapshotAt);
    assert.equal(result.differenceCount, 0, JSON.stringify(result.differences.slice(0, 8)));
    assert.deepEqual(result.frames, runAirborneMixedContactTrace(spec).frames);
  });
}
test('airborne oracle rejects matching flattened, missing and incorrect ballistic evidence', () => {
  const original = runAirborneMixedContactTrace(AIRBORNE_MIXED_CONTACT_CASES[0]);
  const mutations = [
    (t: typeof original) => { t.frames.length = 0; },
    (t: typeof original) => { t.frames[0].live.length = t.frames[0].headless.length = 0; },
    (t: typeof original) => { t.frames[0].tick = 2; },
    (t: typeof original) => { t.frames[0].live[0].pos[1] = t.frames[0].headless[0].pos.y = 0; },
    (t: typeof original) => { t.frames[0].live[0].vel[1] = t.frames[0].headless[0].vel.y = 0; },
    (t: typeof original) => { t.frames[4].live[2].pos[1] = t.frames[4].headless[2].pos.y = NaN; },
  ];
  for (const mutate of mutations) {
    const trace = structuredClone(original); mutate(trace);
    assert.ok(validateAirborneMixedContact(trace).differenceCount > 0);
  }
  assert.throws(() => validateAirborneMixedContact({ ...original, scenario: MIXED_CONTACT_CASES[0] }), /requires a motion/);
});
test('mixed-contact aggregate retains all validated grounded and airborne cases', () => {
  const traces = compactExecutionTraces(runMixedContactParity());
  assert.equal(traces.length, 972);
  assert.equal(new Set(traces.map(t => t.name)).size, 972);
  for (const motion of [undefined, 'rising', 'falling']) assert.equal(
    traces.filter(t => t.scenario.motion === motion).length, 324);
  assert.ok(traces.every(t => t.differenceCount === 0 && t.frameCount === 120
    && t.frameEvidence.fullTraceSHA256.length === 64));
});
