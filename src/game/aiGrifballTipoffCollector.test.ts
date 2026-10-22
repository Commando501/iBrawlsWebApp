import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTipoffCollector, type TipoffCollectorCandidate } from './aiGrifballTipoffCollector';

const candidate = (botId: string, arrival: number, rejection: string | null = null): TipoffCollectorCandidate => ({
  botId,
  arrival,
  rejection,
});

test('collector handoff ignores the ordinary choice and small arrival changes while the incumbent remains eligible', () => {
  const bids = [candidate('a', 1), candidate('b', 0.7)];
  assert.equal(chooseTipoffCollector(bids, 'b', 'a', 0.35).selectedId, 'a');
  bids[1].arrival = 0.65;
  assert.equal(chooseTipoffCollector(bids, 'b', 'a', 0.35).selectedId, 'a');
  bids[1].arrival = 0.64;
  const next = chooseTipoffCollector(bids, 'b', 'a', 0.35);
  assert.equal(next.selectedId, 'b');
  assert.equal(next.changed, true);
  bids[0].arrival = 0.6;
  assert.equal(chooseTipoffCollector(bids, 'a', 'b', 0.35).selectedId, 'b');
});

test('an unavailable collector yields without a time advantage; rejected candidates cannot win', () => {
  for (const rejection of ['Airborne', 'Active attack', 'Blocked route', 'Human priority']) {
    const next = chooseTipoffCollector(
      [candidate('a', 0.5, rejection), candidate('b', 2), candidate('reserve', 0.1, 'Reserve')],
      'a',
      'a',
      2,
    );
    assert.equal(next.selectedId, 'b');
    assert.match(next.reason, /unavailable/);
  }
  assert.equal(chooseTipoffCollector([candidate('b', 2)], 'b', 'dead', 2).selectedId, 'b');
});

test('no eligible collector leaves selection empty and first selection is deterministic', () => {
  assert.equal(
    chooseTipoffCollector([candidate('a', 0, 'Busy'), candidate('b', Infinity)], 'a', 'a', 0.35).selectedId,
    null,
  );
  const bids = [candidate('b', 1), candidate('a', 1)];
  const first = chooseTipoffCollector(bids, 'b', null, 0.35);
  assert.equal(first.selectedId, 'a');
  assert.equal(first.changed, false);
  assert.deepEqual(chooseTipoffCollector([...bids].reverse(), 'b', null, 0.35), first);
  assert.equal(chooseTipoffCollector(bids, 'a', 'b', 0).selectedId, 'b');
});
