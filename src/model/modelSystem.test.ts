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
} from './modelSystem';

const V3_INTERNAL_PROTOTYPE_LABEL = 'V3 Internal Prototype - Not Player Ready';

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
  assert.equal(DEFAULT_VISUAL_MODEL_POLICY, 'v2');
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
      recommended: true,
    },
    {
      value: 'v3',
      label: V3_INTERNAL_PROTOTYPE_LABEL,
      recommended: false,
    },
  ]);

  assert.equal(getRecommendedVisualModelPolicy(), 'v2');
  assert.equal(isRecommendedVisualModelPolicy('v2'), true);
  assert.equal(isRecommendedVisualModelPolicy('v3'), false);
  assert.equal(isRecommendedVisualModelPolicy('v1'), false);
  assert.equal(isRecommendedVisualModelPolicy('bad'), false);
  assert.equal(getVisualModelPolicyLabel('v1'), 'Version 1 Classic');
  assert.equal(getVisualModelPolicyLabel('v2'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('v3'), V3_INTERNAL_PROTOTYPE_LABEL);
  assert.equal(getVisualModelPolicyLabel('bad'), 'Version 2 Rigged');
});

test('selectable visual model policies hide V3 from player-facing selection', () => {
  assert.deepEqual(
    getSelectableVisualModelPolicyOptions(false).map((option) => option.value),
    ['v1', 'v2']
  );
  assert.deepEqual(
    getSelectableVisualModelPolicyOptions(true).map((option) => option.value),
    ['v1', 'v2']
  );

  assert.equal(normalizeSelectableVisualModelPolicy('v3', false), 'v2');
  assert.equal(normalizeSelectableVisualModelPolicy('v3', true), 'v2');
  assert.equal(normalizeSelectableVisualModelPolicy('bad', false, 'v3'), 'v2');
  assert.equal(normalizeSelectableVisualModelPolicy('bad', true, 'v3'), 'v2');
});
