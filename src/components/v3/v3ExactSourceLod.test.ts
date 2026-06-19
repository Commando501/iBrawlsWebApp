import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeV3ExactSourceLodBudget,
  getV3ExactSourceRenderableSlot,
} from './v3ExactSourceLod';
import {
  getV3BuiltinPartVoxels,
} from './VoxelModelsV3';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';

test('getV3ExactSourceRenderableSlot keeps desktop exact while deriving smaller mobile LODs', () => {
  const exactHelmet = getV3ExactSourceRenderableSlot('helmet', 'desktop');
  const mobileHelmet = getV3ExactSourceRenderableSlot('helmet', 'mobileLow');

  assert.equal(exactHelmet.exact, true);
  assert.equal(exactHelmet.voxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.helmet.voxelCount);
  assert.equal(mobileHelmet.exact, false);
  assert.ok(mobileHelmet.voxelCount < exactHelmet.voxelCount);
  assert.ok(mobileHelmet.runCount > 0);
  assert.ok(mobileHelmet.retainedVoxelRatio > 0);
});

test('getV3BuiltinPartVoxels routes built-in exact-source parts through quality-tier LODs without changing default exact output', () => {
  const exactDefault = getV3BuiltinPartVoxels('helmet');
  const exactDesktop = getV3BuiltinPartVoxels('helmet', undefined, undefined, { qualityTier: 'desktop' });
  const mobileLow = getV3BuiltinPartVoxels('helmet', undefined, undefined, { qualityTier: 'mobileLow' });

  assert.equal(exactDefault.length, exactDesktop.length);
  assert.ok(mobileLow.length < exactDesktop.length);
  assert.ok(mobileLow.some((voxel) => voxel.emissive === true));
});

test('analyzeV3ExactSourceLodBudget reports deterministic reductions for lower quality tiers', () => {
  const report = analyzeV3ExactSourceLodBudget();

  assert.equal(report.ready, true);
  assert.equal(report.exact.totalVoxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.metrics.totalVoxelCount);
  assert.ok(report.byTier.mobile.totalVoxelCount < report.exact.totalVoxelCount);
  assert.ok(report.byTier.mobileLow.totalVoxelCount < report.byTier.mobile.totalVoxelCount);
  assert.ok(report.byTier.desktop.exact);
  assert.ok(report.byTier.ultra.exact);
});
