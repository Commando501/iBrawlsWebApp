import test from 'node:test';
import assert from 'node:assert/strict';
import { blendFingerprint } from './theaterDatabase';
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

test('blendFingerprint moves each feature toward the newer match by alpha', () => {
  const next: PlayerModelSnapshot = { ...base, avgLungeDistance: 5.0, counterRate: 0.15 };
  const blended = blendFingerprint(base, next, 0.34);

  // EMA: prev + alpha * (next - prev)
  assert.ok(Math.abs(blended.avgLungeDistance - (12.5 + 0.34 * (5.0 - 12.5))) < 1e-9);
  assert.ok(Math.abs(blended.counterRate - (0.55 + 0.34 * (0.15 - 0.55))) < 1e-9);
  // Value lands strictly between the two matches (a stable prior, not a jump).
  assert.ok(blended.avgLungeDistance < base.avgLungeDistance);
  assert.ok(blended.avgLungeDistance > next.avgLungeDistance);
});

test('blendFingerprint tracks the latest in-match sampleCount', () => {
  const next: PlayerModelSnapshot = { ...base, sampleCount: 7 };
  assert.equal(blendFingerprint(base, next, 0.34).sampleCount, 7);
});

test('repeated blending of a consistent profile converges toward it', () => {
  let acc = base;
  const target: PlayerModelSnapshot = { ...base, avgLungeDistance: 6.0 };
  for (let i = 0; i < 25; i += 1) {
    acc = blendFingerprint(acc, target, 0.34);
  }
  assert.ok(Math.abs(acc.avgLungeDistance - 6.0) < 0.1);
});
