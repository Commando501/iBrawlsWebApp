import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRBORNE_FOCUS_CASES, runAirborneFocusTrace, validateAirborneFocus } from './grifballAirborneFocusParity';
import { compactExecutionTraces } from './grifballParityEvidence';

test('airborne focus retains four poses, two weapons, three health levels and both orders', () => {
  assert.equal(AIRBORNE_FOCUS_CASES.length, 48);
  assert.equal(new Set(AIRBORNE_FOCUS_CASES.map(s => JSON.stringify(s))).size, 48);
  assert.equal(new Set(AIRBORNE_FOCUS_CASES.map(s => s.pose)).size, 4);
});
for (const spec of AIRBORNE_FOCUS_CASES) test(`airborne focus ${JSON.stringify(spec)}`, () => {
  const trace = runAirborneFocusTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
for (const pose of ['rising-runner', 'both-airborne', 'overhead-miss'] as const) {
  for (const reverse of [false, true]) for (const snapshotAt of [3, 4, 5, 6])
    test(`airborne focus continuation ${pose}/${reverse}/${snapshotAt}`, () => {
      const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === pose && s.reverse === reverse && s.hp === 2 && s.secondAttack === 'lunge')!;
      const trace = runAirborneFocusTrace(spec, snapshotAt);
      assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
    });
  test(`airborne focus exact repeat ${pose}`, () => {
    const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === pose && s.hp === 3)!;
    assert.deepEqual(runAirborneFocusTrace(spec), runAirborneFocusTrace(spec));
  });
}
test('rising carrier receives late flight damage after the earlier slash', () => {
  const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === 'rising-runner' && s.hp === 2 && s.secondAttack === 'slash' && !s.reverse)!;
  const trace = runAirborneFocusTrace(spec);
  assert.equal(trace.differenceCount, 0);
  assert.deepEqual(trace.expectedContacts, [{ tick: 4, id: 'support', lethal: false }, { tick: 6, id: 'attacker', lethal: true }]);
  for (const side of ['live', 'headless'] as const) {
    assert.equal(trace.frames[4][side].hp, 1);
    assert.equal(trace.frames[5][side].hp, 0);
    assert.equal(trace.frames[5][side].ball.holderId, null);
  }
});
test('overhead flight misses while the grounded support damages the moving carrier', () => {
  const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === 'overhead-miss' && s.hp === 3 && s.secondAttack === 'lunge' && !s.reverse)!;
  const trace = runAirborneFocusTrace(spec);
  assert.equal(trace.differenceCount, 0);
  assert.deepEqual(trace.expectedContacts, [{ tick: 5, id: 'support', lethal: false }]);
  assert.equal(trace.frames[119].live.hp, 2);
});
test('simultaneous flights award only the lethal attacker across roster orders', () => {
  for (const reverse of [false, true]) {
    const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === 'rising-runner' && s.hp === 1 && s.secondAttack === 'lunge' && s.reverse === reverse)!;
    const trace = runAirborneFocusTrace(spec);
    assert.equal(trace.differenceCount, 0);
    assert.deepEqual(trace.expectedContacts, [{ tick: 6, id: reverse ? 'support' : 'attacker', lethal: true }]);
  }
});
for (const field of ['health', 'holder', 'ball-state', 'height', 'attacker-height', 'credit', 'flight', 'missing-frame', 'order', 'missing-actor'] as const)
  test(`airborne focus oracle rejects matching corrupted ${field}`, () => {
    const spec = AIRBORNE_FOCUS_CASES.find(s => s.pose === 'rising-runner' && s.hp === 2 && s.secondAttack === 'slash' && !s.reverse)!;
    const trace = structuredClone(runAirborneFocusTrace(spec));
    assert.equal(trace.differenceCount, 0);
    if (field === 'missing-frame') trace.frames.splice(5, 1);
    else if (field === 'order') trace.frames[5].tick = 5;
    else for (const side of ['live', 'headless'] as const) {
      const frame = trace.frames[6];
      const crowd = side === 'live' ? frame.liveCrowd! : frame.simCrowd!;
      const attacker = crowd.find(c => c.id === 'attacker')!;
      if (field === 'health') frame[side].hp = 2;
      if (field === 'holder') frame[side].ball.holderId = 'player';
      if (field === 'ball-state') frame[side].ball.state = 'held';
      if (field === 'height') frame[side].runnerPos[1] += .1;
      if (field === 'attacker-height') attacker.pos[1] += .1;
      if (field === 'credit') attacker.kills = 0;
      if (field === 'flight') attacker.lunging = true;
      if (field === 'missing-actor') crowd.splice(crowd.indexOf(attacker), 1);
    }
    assert.ok(validateAirborneFocus(trace, spec).differenceCount > 0);
  });
test('airborne focus compaction preserves every authored input and full history fingerprint', () => {
  const compact = compactExecutionTraces(AIRBORNE_FOCUS_CASES.map(s => runAirborneFocusTrace(s)));
  assert.equal(compact.length, 48);
  assert.equal(compact.reduce((n, t) => n + t.frameCount, 0), 5760);
  for (const trace of compact) {
    assert.equal(trace.differenceCount, 0);
    assert.ok(trace.scenario.pose);
    assert.equal(trace.frames.length, 8);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
});
