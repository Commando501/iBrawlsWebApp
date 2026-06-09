import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyHammerSlamTimingLockChange,
  applyHammerSlamTimingSliderChange,
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_TIMING_LOCKED,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from './hammerSlamTiming';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

test('hammer slam timing resolves legacy-safe defaults', () => {
  assert.deepEqual(resolveHammerSlamTiming({}), {
    windupTime: DEFAULT_HAMMER_SLAM_WINDUP_TIME,
    attackTime: DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  });
  assert.equal(DEFAULT_ADMIN_SETTINGS.hammerSlamTimingLocked, DEFAULT_HAMMER_SLAM_TIMING_LOCKED);
});

test('locked hammer slam windup edits preserve the default phase ratio', () => {
  const next = applyHammerSlamTimingSliderChange(
    DEFAULT_ADMIN_SETTINGS,
    'hammerSlamWindupTime',
    0.56
  );

  assert.equal(next.hammerSlamWindupTime, 0.56);
  assert.equal(next.hammerSlamAttackTime, 0.24);
});

test('locked hammer slam attack edits preserve the default phase ratio', () => {
  const next = applyHammerSlamTimingSliderChange(
    DEFAULT_ADMIN_SETTINGS,
    'hammerSlamAttackTime',
    0.24
  );

  assert.equal(next.hammerSlamWindupTime, 0.56);
  assert.equal(next.hammerSlamAttackTime, 0.24);
});

test('unlocked hammer slam timing edits only the selected phase', () => {
  const unlocked = {
    ...DEFAULT_ADMIN_SETTINGS,
    hammerSlamTimingLocked: false,
  };

  const next = applyHammerSlamTimingSliderChange(unlocked, 'hammerSlamWindupTime', 0.56);

  assert.equal(next.hammerSlamWindupTime, 0.56);
  assert.equal(next.hammerSlamAttackTime, DEFAULT_HAMMER_SLAM_ATTACK_TIME);
});

test('locking hammer slam timing resyncs from the current windup value', () => {
  const unlocked = {
    ...DEFAULT_ADMIN_SETTINGS,
    hammerSlamTimingLocked: false,
    hammerSlamWindupTime: 0.7,
    hammerSlamAttackTime: 0.2,
  };

  const next = applyHammerSlamTimingLockChange(unlocked, true);

  assert.equal(next.hammerSlamTimingLocked, true);
  assert.equal(next.hammerSlamWindupTime, 0.7);
  assert.equal(next.hammerSlamAttackTime, 0.3);
});
