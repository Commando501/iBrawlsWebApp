import test from 'node:test';
import assert from 'node:assert/strict';
import { OBJECTIVE_INPUT_CASES, runObjectiveInputTrace, validateObjectiveInput } from './grifballObjectiveInputParity';
import { compactExecutionTraces } from './grifballParityEvidence';

test('objective input matrix retains directional rates, diagonals, both identities and views', () => {
  assert.equal(OBJECTIVE_INPUT_CASES.length, 32);
  assert.equal(new Set(OBJECTIVE_INPUT_CASES.map(s => JSON.stringify(s))).size, 32);
});
for (const spec of OBJECTIVE_INPUT_CASES) test(`objective steering ${JSON.stringify(spec)}`, () => {
  const trace = runObjectiveInputTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
for (const id of ['main_ai', 'bot_2']) for (const observer of [false, true]) test(`objective steering repeats ${id}/${observer}`, () => {
  const spec = OBJECTIVE_INPUT_CASES.find(s => s.id === id && s.observer === observer && s.forward === 140 && s.direction.z === -1)!;
  assert.deepEqual(runObjectiveInputTrace(spec), runObjectiveInputTrace(spec));
});
for (const field of ['position', 'velocity', 'facing', 'health', 'missing-frame', 'order'])
  test(`objective steering oracle rejects matching corrupted ${field}`, () => {
    const spec = OBJECTIVE_INPUT_CASES.find(s => s.direction.z === -1)!;
    const trace = structuredClone(runObjectiveInputTrace(spec));
    assert.equal(trace.differenceCount, 0);
    if (field === 'missing-frame') trace.frames.splice(4, 1);
    else if (field === 'order') trace.frames[4].tick = 4;
    else for (const side of ['live', 'headless'] as const) {
      const frame = trace.frames[4][side], motion = frame.motion![0];
      if (field === 'position') { if (Array.isArray(motion.pos)) motion.pos[2] += .1; else motion.pos.z += .1; }
      if (field === 'velocity') { if (Array.isArray(motion.vel)) motion.vel[2] = -1.3; else motion.vel.z = -1.3; }
      if (field === 'facing') motion.yaw = 0;
      if (field === 'health') frame.hp = 0;
    }
    assert.ok(validateObjectiveInput(trace, spec).differenceCount > 0);
  });
test('objective input compaction retains its version and complete history fingerprint', () => {
  const compact = compactExecutionTraces(OBJECTIVE_INPUT_CASES.map(runObjectiveInputTrace));
  assert.equal(compact.reduce((sum, t) => sum + t.frameCount, 0), 7680);
  for (const trace of compact) {
    assert.equal(trace.differenceCount, 0);
    assert.equal(trace.scenario.movementExecution, 'scripted-objective-v1');
    assert.equal(trace.frames.length, 8);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
});
