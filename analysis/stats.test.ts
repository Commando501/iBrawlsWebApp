import test from 'node:test';
import assert from 'node:assert/strict';
import {
  denormalizeCentroid,
  flagImbalances,
  kmeans,
  normalizeFeatures,
  summarizeValues,
  winRateByDimension,
  FINGERPRINT_FEATURES,
  type Row,
} from './stats';

function makeRow(overrides: Record<string, number | string> = {}): Row {
  const base: Row = {
    aiDifficulty: 'normal',
    aiArchetype: 'none',
    scorePlayer: 5,
    scoreEnemy: 3,
    avgLungeDistance: 8,
    lungeFrequency: 0.4,
    dodgeBiasX: 0,
    dodgeBiasZ: 0,
    counterRate: 0.2,
    approachSpeed: 0.5,
    edgeProximity: 0.35,
    reactionTime: 0.3,
  };
  return { ...base, ...overrides };
}

test('summarizeValues computes mean, std, min, max', () => {
  const s = summarizeValues([2, 4, 6]);
  assert.equal(s.mean, 4);
  assert.equal(s.min, 2);
  assert.equal(s.max, 6);
  assert.ok(Math.abs(s.std - Math.sqrt(8 / 3)) < 1e-9);
});

test('summarizeValues handles the empty set without NaN', () => {
  assert.deepEqual(summarizeValues([]), { mean: 0, std: 0, min: 0, max: 0 });
});

test('winRateByDimension groups by key and computes player win rate', () => {
  const rows: Row[] = [
    makeRow({ aiDifficulty: 'easy', scorePlayer: 5, scoreEnemy: 1 }), // win
    makeRow({ aiDifficulty: 'easy', scorePlayer: 5, scoreEnemy: 2 }), // win
    makeRow({ aiDifficulty: 'hard', scorePlayer: 1, scoreEnemy: 5 }), // loss
  ];
  const result = winRateByDimension(rows, 'aiDifficulty');
  const easy = result.find((r) => r.value === 'easy')!;
  const hard = result.find((r) => r.value === 'hard')!;
  assert.equal(easy.matches, 2);
  assert.equal(easy.winRate, 1);
  assert.equal(hard.winRate, 0);
  // Sorted by sample size descending.
  assert.equal(result[0].value, 'easy');
});

test('flagImbalances classifies weak / strong / balanced / low-sample', () => {
  const winRates = [
    { value: 'easy', matches: 100, playerWins: 80, winRate: 0.8, avgScoreDiff: 3 },
    { value: 'hard', matches: 100, playerWins: 20, winRate: 0.2, avgScoreDiff: -3 },
    { value: 'normal', matches: 100, playerWins: 50, winRate: 0.5, avgScoreDiff: 0 },
    { value: 'nightmare', matches: 5, playerWins: 1, winRate: 0.2, avgScoreDiff: -4 },
  ];
  const flags = flagImbalances(winRates, 'aiDifficulty');
  const byValue = Object.fromEntries(flags.map((f) => [f.value, f.verdict]));
  assert.equal(byValue.easy, 'ai-too-weak'); // players win too much → AI weak
  assert.equal(byValue.hard, 'ai-too-strong');
  assert.equal(byValue.normal, 'balanced');
  assert.equal(byValue.nightmare, 'low-sample');
});

test('normalizeFeatures + denormalizeCentroid round-trips feature means', () => {
  const rows = [
    makeRow({ lungeFrequency: 0.2, counterRate: 0.1 }),
    makeRow({ lungeFrequency: 0.8, counterRate: 0.5 }),
  ];
  const { points, means, stds } = normalizeFeatures(rows);
  // Two points, z-scored: each feature should be symmetric around 0.
  assert.equal(points.length, 2);
  // Denormalizing the per-feature mean (zero vector) returns the original means.
  const zero = new Array(FINGERPRINT_FEATURES.length).fill(0);
  const back = denormalizeCentroid(zero, means, stds);
  assert.ok(Math.abs(back.lungeFrequency - 0.5) < 1e-9);
  assert.ok(Math.abs(back.counterRate - 0.3) < 1e-9);
});

test('kmeans deterministically separates two well-spread clusters', () => {
  const aggressive: Row[] = Array.from({ length: 20 }, () =>
    makeRow({ lungeFrequency: 0.85, approachSpeed: 0.9, counterRate: 0.1, reactionTime: 0.15 }),
  );
  const defensive: Row[] = Array.from({ length: 20 }, () =>
    makeRow({ lungeFrequency: 0.15, approachSpeed: 0.2, counterRate: 0.5, reactionTime: 0.45 }),
  );
  const rows = [...aggressive, ...defensive];
  const { points } = normalizeFeatures(rows);

  const a = kmeans(points, 2);
  const b = kmeans(points, 2);
  // Deterministic across runs.
  assert.deepEqual(a.assignments, b.assignments);
  // The two true groups land in different clusters.
  const firstHalf = new Set(a.assignments.slice(0, 20));
  const secondHalf = new Set(a.assignments.slice(20));
  assert.equal(firstHalf.size, 1);
  assert.equal(secondHalf.size, 1);
  assert.notEqual([...firstHalf][0], [...secondHalf][0]);
  assert.deepEqual(a.sizes.slice().sort(), [20, 20]);
});

test('kmeans handles empty input gracefully', () => {
  const result = kmeans([], 3);
  assert.deepEqual(result.assignments, []);
  assert.deepEqual(result.centroids, []);
});
