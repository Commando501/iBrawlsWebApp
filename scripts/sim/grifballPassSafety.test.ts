import test from 'node:test';
import assert from 'node:assert/strict';
import { runPassContestTrace, validatePassContestTrace, validatePassSelections } from './grifballPassContest';
import { runPassMatchTrace, validatePassMatchTrace, postResetPassCoverage, type PostResetPassTrace } from './grifballPassMatch';

const blockedSpec = { opening: 'blocked-lane', team: 'blue', reverse: false, main: false } as const;
const closingSpec = { opening: 'closing-charge', seed: 43, team: 'blue', reverse: false, main: false } as const;
const blocked = runPassContestTrace(blockedSpec);
const closing = runPassMatchTrace(closingSpec);

test('unsafe opening can become a safe autonomous pass after its blocker dies', () => {
  assert.equal(blocked.failureCount, 0, JSON.stringify(blocked.failures));
  assert.equal(blocked.frames[0].pass?.charge, null);
  const release = blocked.passes[0];
  assert.ok(release);
  assert.ok(blocked.deaths.some(d => d.id === 'defender' && d.tick < release.tick));
  assert.equal(blocked.pickups.find(p => p.tick > release.tick)?.id, release.receiverId);
});

test('unsafe-opening validator rejects an opening selection, charge or release', () => {
  for (const mutation of ['selection', 'charge', 'release']) {
    const trace = structuredClone(blocked), pass = trace.passes[0];
    if (mutation === 'selection') trace.frames[0].pass!.selections[0].selected = { receiverId: pass.receiverId, speed: pass.speed };
    if (mutation === 'charge') trace.frames[0].pass!.charge = { carrierId: pass.carrierId, receiverId: pass.receiverId, speed: pass.speed, elapsed: 1 / 60 };
    if (mutation === 'release') trace.passes[0].tick = 1;
    validatePassContestTrace(trace, blockedSpec);
    assert.ok(trace.failures.some(f => f.field.startsWith('unsafe opening')), mutation);
  }
});

test('later release cannot reuse the opening decision or omit its current selection', () => {
  const trace = structuredClone(blocked), pass = trace.passes[0];
  trace.frames[pass.tick - 1].pass!.selections = [];
  validatePassSelections(trace);
  assert.ok(trace.failures.some(f => f.tick === pass.tick && f.field === 'release retains its selected receiver'));
});

test('charge and release cannot change receiver or speed without a matching selection', () => {
  for (const phase of ['charge', 'release']) for (const field of ['receiverId', 'speed'] as const) {
    const trace = structuredClone(blocked);
    const frame = phase === 'charge' ? trace.frames.find(f => f.pass?.charge)! : trace.frames[trace.passes[0].tick - 1];
    const selected = frame.pass!.selections.find(s => s.id === 'carrier')!.selected!;
    if (field === 'receiverId') selected.receiverId = 'cover';
    else selected.speed += 1;
    validatePassSelections(trace);
    assert.ok(trace.failures.some(f => f.tick === frame.tick && f.field.startsWith(phase + ' retains its selected')), `${phase}/${field}`);
  }
});

test('closing pressure can cancel and finish a full match without a later pass', () => {
  assert.equal(closing.failureCount, 0, JSON.stringify(closing.failures));
  assert.equal(closing.passes.length, 0);
  assert.ok(closing.cancellations.some(c => c.carrierId === 'carrier' && c.elapsed > 0));
  assert.equal(closing.frames.at(-1)!.phase, 'matchEnd');
  assert.equal(closing.goals.length, 2);
});

test('closing-pressure evidence must contain an actual cancellation', () => {
  const trace = structuredClone(closing);
  trace.cancellations = [];
  validatePassMatchTrace(trace, closingSpec);
  assert.ok(trace.failures.some(f => f.field === 'closing pressure cancels a real charge'));
});

test('cancellation must match the preceding real charge and clear it', () => {
  for (const mutation of ['elapsed', 'carrier', 'clear']) {
    const trace = structuredClone(closing), cancellation = trace.cancellations[0];
    const before = trace.frames[cancellation.tick - 2].pass!.charge!;
    if (mutation === 'elapsed') cancellation.elapsed += 1 / 60;
    if (mutation === 'carrier') before.carrierId = 'escort';
    if (mutation === 'clear') trace.frames[cancellation.tick - 1].pass!.charge = { ...before };
    validatePassMatchTrace(trace, closingSpec);
    assert.ok(trace.failureCount > 0, mutation);
  }
});

test('a cancellation cannot also publish a release', () => {
  const trace = structuredClone(closing), c = trace.cancellations[0];
  trace.passes.push({ tick: c.tick, carrierId: c.carrierId, receiverId: c.receiverId, speed: 13.25, chargeSeconds: c.elapsed });
  validatePassMatchTrace(trace, closingSpec);
  assert.ok(trace.failureCount > 0);
});

test('disabled passing still rejects the safe later release', () => {
  const trace = structuredClone(blocked);
  validatePassContestTrace(trace, { ...blockedSpec, opening: 'disabled' });
  assert.ok(trace.failures.some(f => f.field === 'disabled module never releases'));
});

test('post-reset coverage rejects missing, failed and no-pass groups', () => {
  const matrix: PostResetPassTrace[] = (['blue', 'red'] as const).flatMap(team => [false, true].map(main => ({
    name: `${team}/${main}`, scenario: { team, main }, passesAfterReset: 1, failureCount: 0,
  })));
  assert.deepEqual(postResetPassCoverage(matrix).missing, []);
  assert.equal(postResetPassCoverage([]).missing.length, 4);
  assert.deepEqual(postResetPassCoverage(matrix.slice(1)).missing, ['blue/false']);
  for (const mutation of ['failure', 'no-pass']) {
    const changed = structuredClone(matrix);
    if (mutation === 'failure') changed[3].failureCount = 1;
    else changed[3].passesAfterReset = 0;
    assert.deepEqual(postResetPassCoverage(changed).missing, ['red/true']);
  }
});
