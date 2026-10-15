import test from 'node:test';
import assert from 'node:assert/strict';
import { RELATIVE_HEIGHT_CONTACT_CASES, runRelativeHeightContactTrace, validateRelativeHeightContact } from './grifballRelativeHeightContactParity';
import { compactExecutionTraces } from './grifballParityEvidence';

test('relative-height matrix retains nine poses, three weapons and both actor orders', () => {
  assert.equal(RELATIVE_HEIGHT_CONTACT_CASES.length, 54);
  assert.equal(new Set(RELATIVE_HEIGHT_CONTACT_CASES.map(s => JSON.stringify(s))).size, 54);
  assert.equal(new Set(RELATIVE_HEIGHT_CONTACT_CASES.map(s => s.profile)).size, 9);
  assert.equal(new Set(RELATIVE_HEIGHT_CONTACT_CASES.map(s => s.mainRole)).size, 3);
});
for (const spec of RELATIVE_HEIGHT_CONTACT_CASES) test(`relative-height contact ${JSON.stringify(spec)}`, () => {
  const trace = runRelativeHeightContactTrace(spec);
  assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
});
test('falling through contact height changes the impact phase and sole kill owner across roster orders', () => {
  for (const reverse of [false, true]) {
    const spec = RELATIVE_HEIGHT_CONTACT_CASES.find(s => s.profile === 'falling-order-boundary' && s.attack === 'slash' && s.reverse === reverse)!;
    const trace = runRelativeHeightContactTrace(spec);
    assert.equal(trace.differenceCount, 0);
    assert.equal(trace.expected.contact, reverse ? 7 : 8);
    for (const side of ['live', 'headless'] as const) {
      const frame = trace.frames[7][side];
      assert.equal(frame.find(c => c.id === 'lunger')!.kills, Number(!reverse));
      assert.equal(frame.find(c => c.id === 'main_ai')!.kills, Number(reverse));
    }
  }
});
test('vertical travel counts toward missed-flight distance and a raised target can evade both attacks', () => {
  for (const [profile, finish, hp] of [['raised-target', 41, 2], ['raised-lunger', 40, 1]] as const) {
    const trace = runRelativeHeightContactTrace(RELATIVE_HEIGHT_CONTACT_CASES.find(s => s.profile === profile)!);
    assert.equal(trace.differenceCount, 0);
    assert.equal(trace.expected.contact, 0);
    assert.equal(trace.expected.finish, finish);
    assert.equal(trace.expected.targetHp, hp);
  }
});
for (const profile of ['raised-lunger', 'opposed-vertical', 'landing-group', 'falling-order-boundary']) {
  for (const reverse of [false, true]) for (const snapshotAt of [6, 7, 8, 40])
    test(`relative-height continuation ${profile}/${reverse}/${snapshotAt}`, () => {
      const spec = RELATIVE_HEIGHT_CONTACT_CASES.find(s => s.profile === profile && s.attack === 'slam' && s.reverse === reverse)!;
      const trace = runRelativeHeightContactTrace(spec, snapshotAt);
      assert.equal(trace.differenceCount, 0, JSON.stringify(trace.differences.slice(0, 6)));
    });
  test(`relative-height exact repeat ${profile}`, () => {
    const spec = RELATIVE_HEIGHT_CONTACT_CASES.find(s => s.profile === profile && s.attack === 'swipe')!;
    assert.deepEqual(runRelativeHeightContactTrace(spec), runRelativeHeightContactTrace(spec));
  });
}
for (const field of ['height', 'velocity', 'health', 'credit', 'outcome', 'missing-frame', 'order', 'missing-actor'] as const)
  test(`relative-height oracle rejects matching corrupted ${field}`, () => {
    const spec = RELATIVE_HEIGHT_CONTACT_CASES.find(s => s.profile === 'falling-order-boundary' && s.reverse)!;
    const trace = structuredClone(runRelativeHeightContactTrace(spec));
    assert.equal(trace.differenceCount, 0);
    if (field === 'missing-frame') trace.frames.splice(5, 1);
    else if (field === 'order') trace.frames[5].tick = 5;
    else for (const side of ['live', 'headless'] as const) {
      const actor = trace.frames[8][side].find(c => c.id === 'lunger')!;
      if (field === 'height') { if (Array.isArray(actor.pos)) actor.pos[1] += 1; else actor.pos.y += 1; }
      if (field === 'velocity') { if (Array.isArray(actor.vel)) actor.vel[1] = 30; else actor.vel.y = 30; }
      if (field === 'health') actor.hp = 0;
      if (field === 'credit') actor.kills = 1;
      if (field === 'outcome') actor.outcome = 'miss_timeout';
      if (field === 'missing-actor') trace.frames[8][side] = trace.frames[8][side].filter(c => c.id !== 'lunger') as typeof trace.frames[8][typeof side];
    }
    assert.ok(validateRelativeHeightContact(trace, spec).differenceCount > 0);
  });
test('relative-height compaction retains all inputs, full frame counts and fingerprints', () => {
  const compact = compactExecutionTraces(RELATIVE_HEIGHT_CONTACT_CASES.map(s => runRelativeHeightContactTrace(s)));
  assert.equal(compact.reduce((n, t) => n + t.frameCount, 0), 6480);
  for (const trace of compact) {
    assert.equal(trace.differenceCount, 0);
    assert.ok(trace.vertical.target);
    assert.equal(trace.frames.length, 8);
    assert.match(trace.frameEvidence.fullTraceSHA256, /^[a-f0-9]{64}$/);
  }
});
