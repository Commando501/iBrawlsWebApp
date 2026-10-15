import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLED_CONTACT_CASES, runSampledContactTrace, sampledContactExpectation, validateSampledContact } from './grifballSampledContactParity';
import { compactExecutionTraces } from './grifballParityEvidence';

test('sampled contact matrix retains 36 roster and 24 local encounters', () => {
  assert.equal(SAMPLED_CONTACT_CASES.filter(s => !s.player).length, 36);
  assert.equal(SAMPLED_CONTACT_CASES.filter(s => s.player).length, 24);
  assert.equal(new Set(SAMPLED_CONTACT_CASES.map(s => JSON.stringify(s))).size, 60);
});
test('sampled and swept contracts disagree only for the between-sample sentinel', () => {
  for (const spec of SAMPLED_CONTACT_CASES) {
    const expected = sampledContactExpectation(spec);
    assert.equal(expected.hitTick, spec.pose.name === 'sample-hit' ? 5 : 0);
    assert.equal(expected.finishTick, spec.pose.name === 'sample-hit' ? 5 : 41);
    assert.equal(expected.sweptPathIntersects, spec.pose.name !== 'outside-path');
  }
});
for (const spec of SAMPLED_CONTACT_CASES) test(`sampled contact ${JSON.stringify(spec)}`, () => {
  const trace = runSampledContactTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
for (const pose of ['sample-hit', 'between-samples', 'outside-path']) {
  for (const snapshotAt of [4, 5, 40, 41]) test(`sampled contact continuation ${pose}/${snapshotAt}`, () => {
    const spec = SAMPLED_CONTACT_CASES.find(s => s.player && s.mirror && s.reverse && s.pose.name === pose)!;
    const trace = runSampledContactTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
  });
  for (const player of [false, true]) test(`sampled contact exact repeat ${pose}/${player}`, () => {
    const spec = SAMPLED_CONTACT_CASES.find(s => s.player === player && s.pose.name === pose)!;
    assert.deepEqual(runSampledContactTrace(spec), runSampledContactTrace(spec));
  });
}
for (const player of [false, true]) for (const field of ['swept-hit', 'early-finish', 'position', 'missing-frame', 'order'] as const)
  test(`sampled oracle rejects matching corrupted ${player}/${field}`, () => {
    const spec = SAMPLED_CONTACT_CASES.find(s => s.player === player && s.pose.name === 'between-samples')!;
    const trace = structuredClone(runSampledContactTrace(spec));
    assert.equal(trace.differenceCount, 0);
    if (field === 'missing-frame') trace.frames.splice(4, 1);
    else if (field === 'order') trace.frames[4].tick = 4;
    else for (const side of ['live', 'headless'] as const) {
      if (field === 'swept-hit') trace.frames[5][side].targetHp--;
      if (field === 'early-finish') trace.frames[5][side].lunging = false;
      if (field === 'position') trace.frames[5][side].z += .1;
    }
    assert.ok(validateSampledContact(trace.frames, spec).differenceCount > 0);
  });
test('sampled contact compaction retains inputs, sampled/swept distinction and complete frame counts', () => {
  const compact = compactExecutionTraces(SAMPLED_CONTACT_CASES.map(s => runSampledContactTrace(s)));
  assert.equal(compact.length, 60);
  assert.equal(compact.reduce((n, t) => n + t.frameCount, 0), 13680);
  for (const trace of compact) {
    assert.equal(trace.differenceCount, 0);
    assert.equal(trace.frames.length, 8);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
});
