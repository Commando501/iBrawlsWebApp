import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL_SYSTEM,
  DEFAULT_VISUAL_MODEL_POLICY,
  MODEL_SYSTEMS,
  VISUAL_MODEL_POLICY_OPTIONS,
  getSelectableVisualModelPolicyOptions,
  getRecommendedVisualModelPolicy,
  getVisualModelPolicyLabel,
  isModelSystem,
  isRecommendedVisualModelPolicy,
  normalizeModelSystem,
  normalizeSelectableVisualModelPolicy,
  normalizeVisualModelPolicy,
  resolveSessionVisualModelPolicy,
} from './modelSystem';

const V3_LABEL = 'Version 3 Iron Vanguard';

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

test('normalizeVisualModelPolicy preserves valid visual policies', () => {
  assert.equal(DEFAULT_VISUAL_MODEL_POLICY, 'v3');
  assert.equal(normalizeVisualModelPolicy('v1'), 'v1');
  assert.equal(normalizeVisualModelPolicy('v2'), 'v2');
  assert.equal(normalizeVisualModelPolicy('v3'), 'v3');
  assert.equal(normalizeVisualModelPolicy('bad', 'v3'), 'v3');
  assert.equal(normalizeVisualModelPolicy(null), DEFAULT_VISUAL_MODEL_POLICY);
});

test('visual model policy labels expose every supported visual policy', () => {
  assert.deepEqual(VISUAL_MODEL_POLICY_OPTIONS, [
    {
      value: 'v1',
      label: 'Version 1 Classic',
      recommended: false,
    },
    {
      value: 'v2',
      label: 'Version 2 Rigged',
      recommended: false,
    },
    {
      value: 'v3',
      label: V3_LABEL,
      recommended: true,
    },
  ]);

  assert.equal(getRecommendedVisualModelPolicy(), 'v3');
  assert.equal(isRecommendedVisualModelPolicy('v2'), false);
  assert.equal(isRecommendedVisualModelPolicy('v3'), true);
  assert.equal(isRecommendedVisualModelPolicy('v1'), false);
  assert.equal(isRecommendedVisualModelPolicy('bad'), false);
  assert.equal(getVisualModelPolicyLabel('v1'), 'Version 1 Classic');
  assert.equal(getVisualModelPolicyLabel('v2'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('v3'), V3_LABEL);
  assert.equal(getVisualModelPolicyLabel('bad'), V3_LABEL);
});

test('variants are locked to v3 by default and restored only when enabled', () => {
  assert.deepEqual(getSelectableVisualModelPolicyOptions().map(option => option.value), ['v3']);
  assert.deepEqual(getSelectableVisualModelPolicyOptions(true).map(option => option.value), ['v1', 'v2', 'v3']);
  for (const context of ['standard', 'trainingSandbox'] as const) {
    for (const value of ['v1', 'v2', 'v3', 'invalid']) {
      assert.equal(normalizeSelectableVisualModelPolicy(value, false, 'v1', context), 'v3');
      assert.equal(normalizeSelectableVisualModelPolicy(value, true, 'v3', context), value === 'invalid' ? 'v3' : value);
    }
  }
});

test('saved local and lobby policies cannot bypass the lock, even for admins', () => {
  for (const isAdmin of [false, true]) {
    for (const isMultiplayer of [false, true]) {
      const input = { localPolicy: 'v1', lobbyPolicy: 'v2', isLocalTraining: true, isMultiplayer, isReplay: false, isAdmin };
      assert.equal(resolveSessionVisualModelPolicy(input), 'v3');
      assert.equal(resolveSessionVisualModelPolicy({ ...input, allowModelVariants: true }), isMultiplayer ? 'v2' : 'v1');
      assert.equal(resolveSessionVisualModelPolicy({ ...input, isReplay: true }), 'v3');
    }
  }
});
