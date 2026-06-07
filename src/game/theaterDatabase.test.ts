import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FINGERPRINT_SAMPLE_COUNT_CAP,
  normalizeFingerprintSnapshot,
} from './theaterDatabase';
import type { PlayerModelSnapshot } from './aiPlayerModel';

const base: PlayerModelSnapshot = {
  avgLungeDistance: 12.5,
  lungeFrequency: 0.7,
  dodgeBiasX: 0.6,
  dodgeBiasZ: -0.2,
  counterRate: 0.55,
  approachSpeed: 0.8,
  edgeProximity: 0.4,
  reactionTime: 0.22,
  sampleCount: 120,
};

test('normalizeFingerprintSnapshot preserves learned feature values', () => {
  const normalized = normalizeFingerprintSnapshot(base);

  assert.deepEqual(normalized, base);
});

test('normalizeFingerprintSnapshot caps persisted sample confidence', () => {
  const normalized = normalizeFingerprintSnapshot({
    ...base,
    sampleCount: FINGERPRINT_SAMPLE_COUNT_CAP + 500,
  });

  assert.equal(normalized.sampleCount, FINGERPRINT_SAMPLE_COUNT_CAP);
});

test('normalizeFingerprintSnapshot floors invalid sample confidence', () => {
  const negative = normalizeFingerprintSnapshot({ ...base, sampleCount: -10 });
  const nonFinite = normalizeFingerprintSnapshot({ ...base, sampleCount: Number.POSITIVE_INFINITY });

  assert.equal(negative.sampleCount, 0);
  assert.equal(nonFinite.sampleCount, 0);
});
