import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_QUALITY_TIERS,
  type V3QualityTier,
} from './v3ModelTypes';
import {
  analyzeV3ExactSourceLodBudget,
  analyzeV3ExactSourceRuntimeBudget,
  deriveV3ExactSourceSlotBudget,
  getV3ExactSourceRenderableSlot,
} from './v3ExactSourceLod';
import {
  getV3BuiltinPartVoxels,
} from './VoxelModelsV3';
import { createV3AegisExactSourcePartVoxels } from './v3AegisSuitParts';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';

const RUNTIME_LOD_RATIO_CAPS: Record<V3QualityTier, number> = {
  mobileLow: 0.04,
  mobile: 0.07,
  desktop: 0.16,
  ultra: 0.24,
};

test('getV3ExactSourceRenderableSlot keeps explicit exact source while deriving runtime LODs for every tier', () => {
  const exactHelmet = getV3ExactSourceRenderableSlot('helmet', {
    qualityTier: 'desktop',
    sourceFidelity: 'exact',
  });

  assert.equal(exactHelmet.exact, true);
  assert.equal(exactHelmet.voxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.helmet.voxelCount);
  for (const qualityTier of V3_QUALITY_TIERS) {
    const runtimeSlot = getV3ExactSourceRenderableSlot('helmet', {
      qualityTier,
      sourceFidelity: 'runtimeLod',
    });

    assert.equal(runtimeSlot.exact, false, `${qualityTier} runtime LOD should be derived`);
    assert.ok(runtimeSlot.voxelCount < exactHelmet.voxelCount, `${qualityTier} should reduce source voxels`);
    assert.ok(runtimeSlot.runCount > 0, `${qualityTier} should preserve coverage`);
    assert.ok(runtimeSlot.retainedVoxelRatio > 0, `${qualityTier} should retain visible voxels`);
    assert.ok(
      runtimeSlot.retainedVoxelRatio <= RUNTIME_LOD_RATIO_CAPS[qualityTier],
      `${qualityTier} retained ${runtimeSlot.retainedVoxelRatio} above ${RUNTIME_LOD_RATIO_CAPS[qualityTier]}`
    );
  }
});

test('built-in V3 exact fidelity restores the accepted exact source while runtime LOD still reduces it', () => {
  const legacyExactDefault = createV3AegisExactSourcePartVoxels('helmet', {
    primary: '#3b82f6',
    secondary: '#1e3a8a',
    visor: '#facc15',
    accent: '#22d3ee',
    dark: '#111827',
    highlight: '#93c5fd',
  });
  const legacyRuntimeDesktop = createV3AegisExactSourcePartVoxels('helmet', {
    primary: '#3b82f6',
    secondary: '#1e3a8a',
    visor: '#facc15',
    accent: '#22d3ee',
    dark: '#111827',
    highlight: '#93c5fd',
  }, undefined, 'desktop', 'runtimeLod');
  const builtinExactDesktop = getV3BuiltinPartVoxels('helmet', undefined, undefined, {
    qualityTier: 'desktop',
    sourceFidelity: 'exact',
  });
  const builtinRuntimeDesktop = getV3BuiltinPartVoxels('helmet', undefined, undefined, {
    qualityTier: 'desktop',
    sourceFidelity: 'runtimeLod',
  });
  const builtinMobileLow = getV3BuiltinPartVoxels('helmet', undefined, undefined, {
    qualityTier: 'mobileLow',
    sourceFidelity: 'runtimeLod',
  });

  assert.equal(legacyExactDefault.length, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.slots.helmet.voxelCount);
  assert.ok(legacyRuntimeDesktop.length < legacyExactDefault.length);
  assert.equal(builtinExactDesktop.length, legacyExactDefault.length);
  assert.equal(builtinRuntimeDesktop.length, legacyRuntimeDesktop.length);
  assert.ok(builtinRuntimeDesktop.length < builtinExactDesktop.length);
  assert.ok(builtinMobileLow.length < builtinRuntimeDesktop.length);
  assert.ok(builtinMobileLow.some((voxel) => voxel.emissive === true));
});

test('analyzeV3ExactSourceLodBudget reports deterministic reductions for lower quality tiers', () => {
  const report = analyzeV3ExactSourceLodBudget();

  assert.equal(report.ready, true);
  assert.equal(report.exact.totalVoxelCount, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.metrics.totalVoxelCount);
  assert.ok(report.byTier.mobile.totalVoxelCount < report.exact.totalVoxelCount);
  assert.ok(report.byTier.mobileLow.totalVoxelCount < report.byTier.mobile.totalVoxelCount);
  for (const tier of V3_QUALITY_TIERS) {
    assert.equal(report.byTier[tier].exact, false, `${tier} runtime LOD should not be exact`);
    assert.ok(
      report.byTier[tier].retainedVoxelRatio <= RUNTIME_LOD_RATIO_CAPS[tier],
      `${tier} retained ${report.byTier[tier].retainedVoxelRatio}`
    );
  }
});

test('deriveV3ExactSourceSlotBudget measures the selected renderable slot and armor surface', () => {
  const exactHelmet = getV3ExactSourceRenderableSlot('helmet', {
    qualityTier: 'desktop',
    sourceFidelity: 'exact',
  });
  const mobileHelmet = getV3ExactSourceRenderableSlot('helmet', {
    qualityTier: 'mobileLow',
    sourceFidelity: 'runtimeLod',
  });
  const exactBudget = deriveV3ExactSourceSlotBudget('helmet', {
    qualityTier: 'desktop',
    sourceFidelity: 'exact',
  });
  const mobileBudget = deriveV3ExactSourceSlotBudget('helmet', {
    qualityTier: 'mobileLow',
    sourceFidelity: 'runtimeLod',
  });

  assert.equal(exactBudget.slot, 'helmet');
  assert.equal(exactBudget.qualityTier, 'desktop');
  assert.equal(exactBudget.sourceFidelity, 'exact');
  assert.equal(exactBudget.sourceVoxelCount, exactHelmet.voxelCount);
  assert.equal(exactBudget.exactSourceVoxelCount, exactHelmet.sourceVoxelCount);
  assert.equal(exactBudget.sourceRunCount, exactHelmet.runCount);
  assert.equal(exactBudget.surface.inputVoxelCount, exactHelmet.voxelCount);
  assert.equal(exactBudget.surface.uniqueVoxelCount, exactHelmet.voxelCount);
  assert.equal(exactBudget.mergedBoxCount, exactBudget.surface.panelCount);
  assert.equal(exactBudget.materialGroupCount, exactBudget.surface.materialGroupCount);
  assert.equal(exactBudget.drawCallEstimate, exactBudget.surface.materialGroupCount);

  assert.equal(mobileBudget.slot, 'helmet');
  assert.equal(mobileBudget.qualityTier, 'mobileLow');
  assert.equal(mobileBudget.sourceFidelity, 'runtimeLod');
  assert.equal(mobileBudget.sourceVoxelCount, mobileHelmet.voxelCount);
  assert.equal(mobileBudget.sourceRunCount, mobileHelmet.runCount);
  assert.ok(mobileBudget.sourceVoxelCount < exactBudget.sourceVoxelCount);
  assert.ok(mobileBudget.surface.panelCount < exactBudget.surface.panelCount);
});

test('analyzeV3ExactSourceRuntimeBudget proves exact retention and runtime source reductions', () => {
  const report = analyzeV3ExactSourceRuntimeBudget({
    qualityTier: 'mobile',
    sourceFidelity: 'runtimeLod',
  });
  const exactReport = analyzeV3ExactSourceRuntimeBudget({
    qualityTier: 'desktop',
    sourceFidelity: 'exact',
  });

  assert.equal(report.ready, true);
  assert.equal(report.sourceHash, V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.source.hash);
  assert.equal(report.exact.sourceVoxelCount, 101550);
  assert.equal(report.exact.exactSourceVoxelCount, 101550);
  assert.equal(report.exact.retainedVoxelRatio, 1);
  assert.equal(report.selected.qualityTier, 'mobile');
  assert.equal(report.selected.sourceFidelity, 'runtimeLod');
  assert.equal(report.selected.sourceVoxelCount, report.byTier.mobile.sourceVoxelCount);
  assert.ok(report.byTier.mobile.sourceVoxelCount < report.exact.sourceVoxelCount);
  assert.ok(report.byTier.mobileLow.sourceVoxelCount < report.byTier.mobile.sourceVoxelCount);
  for (const tier of V3_QUALITY_TIERS) {
    assert.equal(report.byTier[tier].sourceFidelity, 'runtimeLod');
    assert.equal(report.byTier[tier].exact, false);
    assert.ok(
      report.byTier[tier].retainedVoxelRatio <= RUNTIME_LOD_RATIO_CAPS[tier],
      `${tier} retained ${report.byTier[tier].retainedVoxelRatio}`
    );
  }
  assert.equal(exactReport.selected.sourceFidelity, 'exact');
  assert.equal(exactReport.selected.sourceVoxelCount, 101550);
  assert.ok(report.byTier.mobile.surfacePanelCount > 0);
  assert.ok(report.byTier.mobile.exposedFaceCount > report.byTier.mobile.surfacePanelCount);
});
