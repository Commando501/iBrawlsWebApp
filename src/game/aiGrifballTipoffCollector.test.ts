import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseTipoffCollector, type TipoffCollectorCandidate } from './aiGrifballTipoffCollector';
import type { GrifballPlayerStyle } from './grifballPlayerStyles';

const candidate = (botId: string, arrival: number, rejection: string | null = null): TipoffCollectorCandidate => ({
  botId,
  arrival,
  rejection,
});

const preferences = (styles: Record<string, GrifballPlayerStyle>, strength = 1) => ({ styles, strength });
const safe = (botId: string, arrival: number, pickupSafe = true): TipoffCollectorCandidate => ({
  ...candidate(botId, arrival),
  pickupSafe,
});

test('zero collector individuality preserves the full decision for every style', () => {
  const bids = [safe('a', 1), safe('b', 1.1)];
  for (const style of ['balanced', 'enforcer', 'opportunist', 'guardian'] as const)
    for (const previous of [null, 'a', 'missing'])
      assert.deepEqual(
        chooseTipoffCollector(bids, 'a', previous, 0.35, preferences({ a: style, b: style }, 0)),
        chooseTipoffCollector(bids, 'a', previous, 0.35),
      );
});

test('collector styles blend bounded bids without changing actual arrival or candidate input', () => {
  const bids = [safe('a', 1), safe('b', 1.2)];
  const before = structuredClone(bids);
  for (const [style, expected] of [
    ['balanced', 'a'],
    ['enforcer', 'a'],
    ['opportunist', 'b'],
    ['guardian', 'a'],
  ] as const) {
    const result = chooseTipoffCollector(bids, 'a', null, 0.35, preferences({ b: style }));
    assert.equal(result.selectedId, expected);
    assert.equal(result.agency!.baselineId, 'a');
    assert.equal(result.agency!.bids.find((c) => c.botId === 'b')!.arrival, 1.2);
  }
  for (const style of ['enforcer', 'guardian'] as const)
    assert.equal(
      chooseTipoffCollector([safe('a', 1), safe('b', 1.1)], 'a', null, 0.35, preferences({ a: style })).selectedId,
      'b',
    );
  assert.equal(chooseTipoffCollector(bids, 'a', null, 0.35, preferences({ b: 'opportunist' }, 0.5)).selectedId, 'a');
  assert.equal(
    chooseTipoffCollector(bids, 'a', null, 0.35, preferences({ b: 'opportunist' })).agency!.changedChoice,
    true,
  );
  assert.deepEqual(bids, before);
});

test('an opportunist only volunteers for a real safe pickup and cannot erase the fastest safe margin', () => {
  const bids = [safe('a', 1), safe('b', 1.1, false)];
  const p = preferences({ a: 'guardian', b: 'opportunist' });
  const result = chooseTipoffCollector(bids, 'a', null, 0.35, p);
  assert.equal(result.selectedId, 'a');
  assert.equal(result.agency!.bids[1].adjustment, 0);
  assert.match(result.agency!.bids[1].rejection!, /safe pickup/);
  bids[0].pickupSafe = false;
  assert.equal(chooseTipoffCollector(bids, 'a', null, 0.35, preferences({ b: 'opportunist' })).selectedId, 'a');
});

test('style cannot start a handoff or replace an incumbent without the actual margin', () => {
  const p = preferences({ a: 'guardian', b: 'opportunist', c: 'opportunist' });
  const bids = [safe('a', 1), safe('b', 0.66), safe('c', 0.65)];
  const held = chooseTipoffCollector(bids, 'b', 'a', 0.35, p);
  assert.equal(held.selectedId, 'a');
  assert.deepEqual(held.agency!.bids, []);
  bids.push(safe('fast', 0.6));
  const result = chooseTipoffCollector(bids, 'fast', 'a', 0.35, p);
  assert.equal(result.selectedId, 'fast');
  assert.match(result.agency!.bids.find((c) => c.botId === 'c')!.rejection!, /handoff margin/);
  bids[2].arrival = 0.64;
  const switched = chooseTipoffCollector(bids, 'fast', 'a', 0.35, p);
  assert.equal(switched.selectedId, 'c');
  assert.equal(chooseTipoffCollector(bids, 'fast', 'c', 0.35, p).selectedId, 'c');
});

test('collector bids honor the arrival window, all eligibility rejections, missing players and stable ties', () => {
  const p = preferences({ a: 'guardian', b: 'opportunist' });
  for (const rejection of ['Reserve', 'Active screen', 'Regroup', 'Human priority', 'Blocked route', 'Not ready']) {
    const result = chooseTipoffCollector([safe('a', 1), { ...safe('b', 0.8), rejection }], 'a', 'gone', 0.35, p);
    assert.equal(result.selectedId, 'a');
    assert.equal(result.agency!.bids[1].rejection, rejection);
  }
  assert.equal(chooseTipoffCollector([safe('a', 1), safe('b', 1.35)], 'a', null, 0.35, p).selectedId, 'b');
  const far = chooseTipoffCollector([safe('a', 1), safe('b', 1.351)], 'a', null, 0.35, p);
  assert.equal(far.selectedId, 'a');
  assert.match(far.agency!.bids[1].rejection!, /arrival window/);
  const tied = [safe('b', 1), safe('a', 1)];
  assert.deepEqual(
    chooseTipoffCollector(tied, 'b', null, 0.35, preferences({})),
    chooseTipoffCollector([...tied].reverse(), 'b', null, 0.35, preferences({})),
  );
  assert.equal(chooseTipoffCollector([candidate('a', Infinity)], 'a', null, 0.35, p).selectedId, null);
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
