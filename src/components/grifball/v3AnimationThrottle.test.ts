import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  consumeV3AnimationThrottle,
  getV3AnimationThrottleState,
} from './v3AnimationThrottle';

test('desktop V3 animation is never throttled', () => {
  const mesh = new THREE.Group();
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'desktop',
    isLocal: false,
    nowMs: 0,
    dt: 0.016,
  }).shouldAnimate, true);
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'desktop',
    isLocal: false,
    nowMs: 1,
    dt: 0.016,
  }).shouldAnimate, true);
});

test('mobileLow throttles remote V3 animation and accumulates dt', () => {
  const mesh = new THREE.Group();
  const first = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 0,
    dt: 0.016,
  });
  const second = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 20,
    dt: 0.016,
  });
  const third = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 52,
    dt: 0.016,
  });

  assert.equal(first.shouldAnimate, true);
  assert.equal(second.shouldAnimate, false);
  assert.equal(third.shouldAnimate, true);
  assert.equal(third.dt > 0.03, true);
  assert.equal(getV3AnimationThrottleState(mesh).lastAnimationMs, 52);
});

test('local V3 animation is not throttled even on mobileLow', () => {
  const mesh = new THREE.Group();
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: true,
    nowMs: 0,
    dt: 0.016,
  }).shouldAnimate, true);
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: true,
    nowMs: 10,
    dt: 0.016,
  }).shouldAnimate, true);
});
