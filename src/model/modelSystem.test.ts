import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL_SYSTEM,
  DEFAULT_VISUAL_MODEL_POLICY,
  MODEL_SYSTEMS,
  VISUAL_MODEL_POLICY_OPTIONS,
  getRecommendedVisualModelPolicy,
  getVisualModelPolicyLabel,
  isModelSystem,
  isRecommendedVisualModelPolicy,
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

test('normalizeVisualModelPolicy locks v3 gameplay policy to v2', () => {
  assert.equal(DEFAULT_VISUAL_MODEL_POLICY, 'v2');
  assert.equal(normalizeVisualModelPolicy('v1'), 'v1');
  assert.equal(normalizeVisualModelPolicy('v2'), 'v2');
  assert.equal(normalizeVisualModelPolicy('v3'), 'v2');
  assert.equal(normalizeVisualModelPolicy(null), DEFAULT_VISUAL_MODEL_POLICY);
});

test('visual model policy labels expose only gameplay-ready policies', () => {
  assert.deepEqual(VISUAL_MODEL_POLICY_OPTIONS, [
    {
      value: 'v1',
      label: 'Version 1 Classic',
      recommended: false,
    },
    {
      value: 'v2',
      label: 'Version 2 Rigged',
      recommended: true,
    },
  ]);

  assert.equal(getRecommendedVisualModelPolicy(), 'v2');
  assert.equal(isRecommendedVisualModelPolicy('v2'), true);
  assert.equal(isRecommendedVisualModelPolicy('v3'), false);
  assert.equal(isRecommendedVisualModelPolicy('v1'), false);
  assert.equal(isRecommendedVisualModelPolicy('bad'), false);
  assert.equal(getVisualModelPolicyLabel('v1'), 'Version 1 Classic');
  assert.equal(getVisualModelPolicyLabel('v2'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('v3'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('bad'), 'Version 2 Rigged');
});
