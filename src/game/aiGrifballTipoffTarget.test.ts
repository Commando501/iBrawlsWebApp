import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTipoffTarget, type TipoffTargetCandidate, type TipoffTargetDecision } from './aiGrifballTipoffTarget';
import type { GrifballPlayerStyle } from './grifballPlayerStyles';

const candidate = (targetId: string, eta: number): TipoffTargetCandidate => ({
  targetId,
  eta,
  response: 2,
  rejection: null,
  contestsBall: false,
  threatensCollector: false,
  recovering: false,
});
function choose(
  candidates: TipoffTargetCandidate[],
  elapsed: number,
  previous?: TipoffTargetDecision,
  seconds = 0.6,
  style: GrifballPlayerStyle = 'balanced',
  strength = 1,
) {
  return chooseTipoffTarget(candidates, strength, { screen: style }, 'screen', { elapsed, seconds, previous });
}

test('bounded commitment holds a safe target through a small score reversal then expires', () => {
  const first = choose([candidate('a', 1), candidate('b', 1.1)], 0.2);
  const reversed = [candidate('a', 1), candidate('b', 0.95)];
  const held = choose(reversed, 0.4, first);
  assert.equal(held.selectedId, 'a');
  assert.equal(held.commitment!.preferredId, 'b');
  assert.equal(held.commitment!.retained, true);
  assert.equal(held.changedByStyle, false);
  assert.equal(held.commitment!.deadline, 0.8);
  const expired = choose(reversed, 0.8, held);
  assert.equal(expired.selectedId, 'b');
  assert.equal(expired.commitment!.startedAt, 0.8);
  assert.match(expired.commitment!.reason, /expired/);
});

test('staying on the same target does not restart a commitment before or after expiry', () => {
  const same = [candidate('a', 1), candidate('b', 1.1)];
  let previous = choose(same, 0);
  for (const time of [0.1, 0.6, 0.7, 1, 2]) {
    previous = choose(same, time, previous);
    assert.equal(previous.commitment!.deadline, 0.6);
    assert.equal(previous.commitment!.startedAt, 0);
  }
  assert.equal(choose([candidate('a', 1), candidate('b', 0.95)], 2.1, previous).selectedId, 'b');
});

test('live duration increases cannot extend a hold and decreases can shorten it', () => {
  const candidates = [candidate('a', 1), candidate('b', 1.1)];
  const first = choose(candidates, 0);
  const longer = choose(candidates, 0.1, first, 1.5);
  assert.equal(longer.commitment!.deadline, 0.6);
  const shorter = choose(candidates, 0.2, longer, 0.25);
  assert.equal(shorter.commitment!.deadline, 0.25);
  const later = choose([candidate('a', 1), candidate('b', 0.95)], 0.25, shorter, 1.5);
  assert.equal(later.selectedId, 'b');
});

for (const condition of [
  'unavailable',
  'unsafe',
  'outside-window',
  'better',
  'recovery-ended',
  'style-edit',
  'strength-edit',
] as const)
  test(condition + ' releases an opening target commitment', () => {
    const a = { ...candidate('a', 1), recovering: true };
    const b = { ...candidate('b', 1.1), threatensCollector: true };
    const first = choose([a, b], 0, undefined, 0.6, condition === 'recovery-ended' ? 'opportunist' : 'balanced');
    let candidates = [{ ...a }, { ...b }];
    if (condition === 'unavailable') candidates = [b];
    if (condition === 'unsafe') candidates[0].rejection = 'Spacing is unsafe';
    if (condition === 'outside-window') candidates[0].eta = 1.5;
    if (condition === 'better') candidates[1].eta = 0.79;
    if (condition === 'recovery-ended') {
      candidates[0].recovering = false;
      candidates[1].eta = 0.95;
    }
    if (condition === 'strength-edit') candidates[1].eta = 0.95;
    const next = choose(
      candidates,
      0.1,
      first,
      0.6,
      condition === 'style-edit' ? 'guardian' : condition === 'recovery-ended' ? 'opportunist' : 'balanced',
      condition === 'strength-edit' ? 0.5 : 1,
    );
    assert.equal(next.selectedId, 'b');
    assert.equal(next.commitment!.retained, false);
    assert.equal(next.commitment!.startedAt, 0.1);
  });

test('an ended recovery cannot silently rearm a hold even if that opponent is still best', () => {
  const a = { ...candidate('a', 0.9), recovering: true },
    b = candidate('b', 1);
  const first = choose([a, b], 0, undefined, 0.6, 'opportunist');
  a.recovering = false;
  const ended = choose([a, b], 0.1, first, 0.6, 'opportunist');
  assert.equal(ended.selectedId, 'a');
  assert.equal(ended.commitment!.remaining, 0);
  assert.equal(choose([a, { ...b, eta: 0.85 }], 0.2, ended, 0.6, 'opportunist').selectedId, 'b');
});

test('zero duration preserves independent ranking and zero strength cannot carry commitment', () => {
  const candidates = [candidate('a', 1), candidate('b', 1.1)];
  const first = choose(candidates, 0);
  const reversed = [candidate('a', 1), candidate('b', 0.95)];
  assert.deepEqual(choose(reversed, 0.1, first, 0), chooseTipoffTarget(reversed, 1, { screen: 'balanced' }, 'screen'));
  assert.ok(!choose(reversed, 0.1, first, 0.6, 'balanced', 0).commitment);
});

test('all unsafe candidates clear the commitment and deterministic JSON continuation keeps deadlines', () => {
  const candidates = [candidate('a', 1), candidate('b', 1.1)];
  const first = choose(candidates, 0.1);
  const restored = JSON.parse(JSON.stringify(first));
  assert.deepEqual(choose(candidates, 0.2, first), choose([...candidates].reverse(), 0.2, restored));
  const cleared = choose(
    candidates.map((c) => ({ ...c, rejection: 'Unsafe' })),
    0.2,
    first,
  );
  assert.equal(cleared.selectedId, null);
  assert.equal(cleared.commitment!.remaining, 0);
  const resumed = choose(candidates, 0.3, cleared);
  assert.equal(resumed.commitment!.previousId, null);
  assert.equal(resumed.commitment!.startedAt, 0.3);
});
