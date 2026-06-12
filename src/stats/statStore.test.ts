import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  applyDeltaToProfile,
  createEmptyProfile,
  mergeDeltas,
  parseStoredDelta,
  parseStoredProfile,
  profileToDelta,
} from './statStore';
import { createEmptyDelta, isDeltaEmpty, type StatDelta } from './statTypes';

function delta(partial: Partial<StatDelta>): StatDelta {
  return { ...createEmptyDelta(), ...partial };
}

test('applyDeltaToProfile sums counters and folds personal bests with max', () => {
  const profile = createEmptyProfile(1000);
  applyDeltaToProfile(profile, delta({
    sums: { 'combat.kills': 5 },
    maxes: { 'best.killsInMatch': 5 },
    modes: { 'offline:sandbox': { sums: { 'combat.kills': 5 }, maxes: { 'best.killsInMatch': 5 } } },
  }));
  applyDeltaToProfile(profile, delta({
    sums: { 'combat.kills': 3 },
    maxes: { 'best.killsInMatch': 2 },
    modes: { 'offline:sandbox': { sums: { 'combat.kills': 3 }, maxes: { 'best.killsInMatch': 2 } } },
  }));

  assert.equal(profile.totals['combat.kills'], 8);
  assert.equal(profile.totals['best.killsInMatch'], 5);
  assert.equal(profile.modes['offline:sandbox']?.['combat.kills'], 8);
  assert.equal(profile.modes['offline:sandbox']?.['best.killsInMatch'], 5);
});

test('mergeDeltas combines pending deltas without losing either side', () => {
  const base = delta({ sums: { 'combat.kills': 2 }, maxes: { 'best.killingSpree': 4 } });
  mergeDeltas(base, delta({
    sums: { 'combat.kills': 1, 'combat.deaths': 3 },
    maxes: { 'best.killingSpree': 2 },
  }));

  assert.equal(base.sums['combat.kills'], 3);
  assert.equal(base.sums['combat.deaths'], 3);
  assert.equal(base.maxes['best.killingSpree'], 4);
});

test('profileToDelta splits counters and bests by merge strategy', () => {
  const profile = createEmptyProfile();
  profile.totals = { 'combat.kills': 10, 'best.killsInMatch': 7 };
  profile.modes['online:grifball'] = { 'combat.kills': 4, 'best.killsInMatch': 3 };

  const result = profileToDelta(profile);
  assert.equal(result.sums['combat.kills'], 10);
  assert.equal(result.maxes['best.killsInMatch'], 7);
  assert.equal(result.modes['online:grifball']?.sums['combat.kills'], 4);
  assert.equal(result.modes['online:grifball']?.maxes['best.killsInMatch'], 3);

  // Round trip: applying the delta to an empty profile reproduces the totals.
  const rebuilt = applyDeltaToProfile(createEmptyProfile(), result);
  assert.deepEqual(rebuilt.totals, profile.totals);
  assert.deepEqual(rebuilt.modes['online:grifball'], profile.modes['online:grifball']);
});

test('parseStoredProfile tolerates garbage and strips invalid counters', () => {
  assert.deepEqual(parseStoredProfile(null).totals, {});
  assert.deepEqual(parseStoredProfile('not json').totals, {});
  const parsed = parseStoredProfile(JSON.stringify({
    totals: { ok: 3, negative: -1, str: 'nope', inf: Infinity },
    modes: { 'offline:sandbox': { ok: 1 }, junk: 'nope' },
  }));
  assert.deepEqual(parsed.totals, { ok: 3 });
  assert.deepEqual(parsed.modes['offline:sandbox'], { ok: 1 });
});

test('parseStoredDelta tolerates garbage', () => {
  assert.equal(isDeltaEmpty(parseStoredDelta(null)), true);
  assert.equal(isDeltaEmpty(parseStoredDelta('{bad')), true);
  const parsed = parseStoredDelta(JSON.stringify({
    sums: { 'combat.kills': 2 },
    maxes: { 'best.winStreak': 4 },
    modes: { 'online:sandbox': { sums: { 'combat.kills': 2 }, maxes: {} } },
  }));
  assert.equal(parsed.sums['combat.kills'], 2);
  assert.equal(parsed.maxes['best.winStreak'], 4);
  assert.equal(parsed.modes['online:sandbox']?.sums['combat.kills'], 2);
});

test('isDeltaEmpty detects mode-only content', () => {
  assert.equal(isDeltaEmpty(createEmptyDelta()), true);
  assert.equal(
    isDeltaEmpty(delta({ modes: { 'offline:sandbox': { sums: { x: 1 }, maxes: {} } } })),
    false
  );
});
