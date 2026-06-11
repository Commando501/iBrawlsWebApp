import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL_SYSTEM,
  DEFAULT_VISUAL_MODEL_POLICY,
  MODEL_SYSTEMS,
  isModelSystem,
  normalizeModelSystem,
  normalizeVisualModelPolicy,
} from './modelSystem';

test('model system helpers accept v1, v2, and v3 only', () => {
  assert.deepEqual(MODEL_SYSTEMS, ['v1', 'v2', 'v3']);
  assert.equal(isModelSystem('v1'), true);
  assert.equal(isModelSystem('v2'), true);
  assert.equal(isModelSystem('v3'), true);
  assert.equal(isModelSystem('v4'), false);
  assert.equal(isModelSystem(undefined), false);
});

test('normalizeModelSystem falls back to the configured default', () => {
  assert.equal(DEFAULT_MODEL_SYSTEM, 'v3');
  assert.equal(normalizeModelSystem('v1'), 'v1');
  assert.equal(normalizeModelSystem('v2'), 'v2');
  assert.equal(normalizeModelSystem('v3'), 'v3');
  assert.equal(normalizeModelSystem('bad'), DEFAULT_MODEL_SYSTEM);
});

test('normalizeVisualModelPolicy preserves visual-only policy choices', () => {
  assert.equal(DEFAULT_VISUAL_MODEL_POLICY, 'v3');
  assert.equal(normalizeVisualModelPolicy('v1'), 'v1');
  assert.equal(normalizeVisualModelPolicy('v2'), 'v2');
  assert.equal(normalizeVisualModelPolicy('v3'), 'v3');
  assert.equal(normalizeVisualModelPolicy(null), DEFAULT_VISUAL_MODEL_POLICY);
});
