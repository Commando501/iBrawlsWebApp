import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_CARRIER_FOCUS_CASES, runAICarrierFocusTrace, validateAICarrierFocus } from './grifballAICarrierFocusParity';
import { compactExecutionTraces } from './grifballParityEvidence';

test('AI carrier focus fire retains 56 distinct phase-order, health and counter cases', () => {
  assert.equal(AI_CARRIER_FOCUS_CASES.length, 56);
  assert.equal(new Set(AI_CARRIER_FOCUS_CASES.map(s => JSON.stringify(s))).size, 56);
});
for (const spec of AI_CARRIER_FOCUS_CASES) test(`AI carrier focus fire ${JSON.stringify(spec)}`, () => {
  const trace = runAICarrierFocusTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
});
for (const reverse of [false, true]) for (const hp of [1, 3]) for (const snapshotAt of [3, 4, 7, 8])
  test(`AI carrier focus continuation ${reverse}/${hp}/${snapshotAt}`, () => {
    const spec = AI_CARRIER_FOCUS_CASES.find(s => s.hp === hp && s.reverse === reverse && s.mirror
      && s.runner.attack === 'lunge' && s.runner.secondAttack === 'slash')!;
    const trace = runAICarrierFocusTrace(spec, snapshotAt);
    assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 8)));
  });
for (const reverse of [false, true]) test(`AI carrier focus repeat ${reverse}`, () => {
  const spec = AI_CARRIER_FOCUS_CASES.find(s => s.hp === 3 && s.reverse === reverse && !s.mirror)!;
  assert.deepEqual(runAICarrierFocusTrace(spec), runAICarrierFocusTrace(spec));
});
test('moving before a lunge delays its damage one tick while a committed counter prevents that escape', () => {
  for (const reverse of [false, true]) {
    const spec = AI_CARRIER_FOCUS_CASES.find(s => !s.runner.counter && s.reverse === reverse)!;
    const trace = runAICarrierFocusTrace(spec);
    assert.equal(trace.differenceCount, 0);
    for (const side of ['live', 'headless'] as const) {
      assert.equal(trace.frames[3][side].hp, reverse ? 2 : 1);
      assert.equal(trace.frames[4][side].hp, 1);
    }
    for (const snapshotAt of [3, 4]) assert.equal(runAICarrierFocusTrace(spec, snapshotAt).differenceCount, 0);
  }
});
test('a lethal earlier roster flight prevents a counter, while a later flight permits its commitment', () => {
  for (const reverse of [false, true]) {
    const spec = AI_CARRIER_FOCUS_CASES.find(s => s.hp === 1 && !s.mirror && s.reverse === reverse
      && s.runner.attack === 'lunge' && s.runner.secondAttack === 'slash')!;
    const trace = runAICarrierFocusTrace(spec);
    assert.equal(trace.differenceCount, 0);
    assert.equal(trace.counters, Number(reverse));
  }
});
test('AI carrier focus aggregate preserves every scenario and full trace fingerprints', () => {
  const compact = compactExecutionTraces(AI_CARRIER_FOCUS_CASES.map(s => runAICarrierFocusTrace(s)));
  assert.equal(compact.length, 56);
  assert.equal(compact.reduce((n, t) => n + t.frameCount, 0), 6720);
  for (const trace of compact) {
    assert.equal(trace.differenceCount, 0);
    assert.ok(trace.scenario.runner.secondAttack);
    assert.equal(trace.frames.length, 8);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
});
for (const field of ['health', 'holder', 'ball-state', 'position', 'credit', 'counter', 'missing-frame', 'order'] as const)
  test(`AI carrier oracle rejects matching corrupted ${field}`, () => {
    const spec = AI_CARRIER_FOCUS_CASES.find(s => s.hp === 3 && !s.reverse && !s.mirror)!;
    const trace = structuredClone(runAICarrierFocusTrace(spec));
    assert.equal(trace.differenceCount, 0);
    const frame = trace.frames[8];
    if (field === 'counter') trace.counters = 0;
    else if (field === 'missing-frame') trace.frames.splice(5, 1);
    else if (field === 'order') trace.frames[5].tick = 5;
    else for (const side of ['live', 'headless'] as const) {
      if (field === 'health') frame[side].hp = 3;
      if (field === 'holder') frame[side].ball.holderId = null;
      if (field === 'ball-state') frame[side].ball.state = 'idle';
      if (field === 'position') frame[side].runnerPos[2] += .1;
      if (field === 'credit') (side === 'live' ? frame.liveRunner! : frame.simRunner!).kills = 0;
    }
    assert.ok(validateAICarrierFocus(trace, spec).differenceCount > 0);
  });
