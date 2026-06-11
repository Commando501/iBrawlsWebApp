import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_CHARACTER_SLOT_IDS,
  V3_PAINT_ROLES,
  V3_QUALITY_TIERS,
  V3_WEAPON_IDS,
  validateV3AssetBudget,
  type V3AssetBudget,
} from './v3ModelTypes';

describe('V3 model taxonomy', () => {
  it('defines the required modular character slots', () => {
    assert.deepEqual(V3_CHARACTER_SLOT_IDS, [
      'helmet',
      'neck',
      'chest',
      'shoulderLeft',
      'shoulderRight',
      'upperArmLeft',
      'upperArmRight',
      'forearmLeft',
      'forearmRight',
      'handLeft',
      'handRight',
      'pelvis',
      'thighLeft',
      'thighRight',
      'shinLeft',
      'shinRight',
      'footLeft',
      'footRight',
      'back',
    ]);
  });

  it('defines V3 weapons from the start', () => {
    assert.deepEqual(V3_WEAPON_IDS, ['hammer', 'sword', 'pistol']);
  });

  it('defines canonical paint roles for modular V3 parts', () => {
    assert.deepEqual(V3_PAINT_ROLES, [
      'primary',
      'secondary',
      'accent',
      'undersuit',
      'visor',
      'emissive',
      'decal',
      'fixed',
    ]);
  });

  it('orders quality tiers from cheapest to richest', () => {
    assert.deepEqual(V3_QUALITY_TIERS, ['mobileLow', 'mobile', 'desktop', 'ultra']);
  });
});

describe('validateV3AssetBudget', () => {
  const validBudget: V3AssetBudget = {
    sourceVoxelCount: 1200,
    mergedBoxCount: 280,
    materialGroupCount: 5,
    drawCallEstimate: 5,
    lodCount: 3,
    memoryEstimateKb: 240,
  };

  it('accepts positive budget metadata', () => {
    assert.deepEqual(validateV3AssetBudget(validBudget), []);
  });

  it('reports non-positive budget fields', () => {
    const issues = validateV3AssetBudget({
      sourceVoxelCount: 0,
      mergedBoxCount: -1,
      materialGroupCount: 0,
      drawCallEstimate: -2,
      lodCount: 0,
      memoryEstimateKb: -20,
    });

    assert.match(issues.join('\n'), /sourceVoxelCount/);
    assert.match(issues.join('\n'), /mergedBoxCount/);
    assert.match(issues.join('\n'), /materialGroupCount/);
    assert.match(issues.join('\n'), /drawCallEstimate/);
    assert.match(issues.join('\n'), /lodCount/);
    assert.match(issues.join('\n'), /memoryEstimateKb/);
  });
});
