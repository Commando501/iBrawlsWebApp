import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getV3AnimationThrottleForTier,
  normalizeV3QualityTier,
  selectV3QualityTier,
} from './v3QualityTiers';

test('normalizeV3QualityTier accepts only canonical V3 tiers', () => {
  assert.equal(normalizeV3QualityTier('mobileLow'), 'mobileLow');
  assert.equal(normalizeV3QualityTier('mobile'), 'mobile');
  assert.equal(normalizeV3QualityTier('desktop'), 'desktop');
  assert.equal(normalizeV3QualityTier('ultra'), 'ultra');
  assert.equal(normalizeV3QualityTier('bad'), 'desktop');
});

test('mobile devices default no higher than mobile', () => {
  assert.equal(selectV3QualityTier({ isMobile: true, graphicsAccelerated: true, hardwareConcurrency: 8 }), 'mobile');
  assert.equal(selectV3QualityTier({ isMobile: true, graphicsAccelerated: true, hardwareConcurrency: 2 }), 'mobileLow');
  assert.equal(selectV3QualityTier({ forceMobileControls: true, graphicsAccelerated: true, hardwareConcurrency: 16 }), 'mobile');
});

test('unaccelerated graphics forces the safest tier', () => {
  assert.equal(selectV3QualityTier({ isMobile: false, graphicsAccelerated: false, hardwareConcurrency: 16 }), 'mobileLow');
});

test('desktop quality can recover and promote with strong signals', () => {
  assert.equal(selectV3QualityTier({ isMobile: false, graphicsAccelerated: true, hardwareConcurrency: 8 }), 'desktop');
  assert.equal(selectV3QualityTier({
    isMobile: false,
    graphicsAccelerated: true,
    hardwareConcurrency: 16,
    deviceMemoryGb: 8,
    fps: 95,
    previousTier: 'desktop',
  }), 'ultra');
});

test('low FPS demotes one tier at a time to avoid oscillation', () => {
  assert.equal(selectV3QualityTier({
    isMobile: false,
    graphicsAccelerated: true,
    hardwareConcurrency: 8,
    fps: 42,
    previousTier: 'ultra',
  }), 'desktop');
  assert.equal(selectV3QualityTier({
    isMobile: true,
    graphicsAccelerated: true,
    hardwareConcurrency: 8,
    fps: 24,
    previousTier: 'mobile',
  }), 'mobileLow');
});

test('animation throttles remote V3 work only on constrained tiers', () => {
  assert.deepEqual(getV3AnimationThrottleForTier('ultra'), { remoteAnimationIntervalMs: 0 });
  assert.deepEqual(getV3AnimationThrottleForTier('desktop'), { remoteAnimationIntervalMs: 0 });
  assert.deepEqual(getV3AnimationThrottleForTier('mobile'), { remoteAnimationIntervalMs: 33 });
  assert.deepEqual(getV3AnimationThrottleForTier('mobileLow'), { remoteAnimationIntervalMs: 50 });
});
