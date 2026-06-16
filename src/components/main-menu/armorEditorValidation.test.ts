import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomArmorPieceSnapshot, CustomArmorValidationResult } from '../customArmor';
import { buildArmorEditorValidationReport } from './armorEditorValidation';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';

const validation = (overrides: Partial<CustomArmorValidationResult> = {}): CustomArmorValidationResult => ({
  valid: true,
  errors: [],
  warnings: [],
  stats: {
    voxelCount: 4,
    payloadBytes: 400,
    components: 1,
    subpartCounts: {},
    anchorCluster: true,
    modelSystem: 'v3',
    v3Slot: 'helmet',
  },
  ...overrides,
});

const piece = (roles: Array<'primary' | 'secondary' | 'visor'>): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'draft',
  name: 'Draft',
  slot: 'helmet',
  modelSystem: 'v3',
  voxels: roles.map((role, index) => ({ x: index, y: 0, z: 0, role })),
  updatedAt: 1,
});

test('buildArmorEditorValidationReport reports role coverage and missing V3 recommended roles', () => {
  const report = buildArmorEditorValidationReport({
    draft: piece(['primary']),
    validation: validation(),
    builtInVoxelCount: 10,
    slotBudget: 780,
    recommendedRoles: ['primary', 'secondary', 'visor'],
  });

  assert.equal(report.budgetPercent, 1);
  assert.deepEqual(report.roleCounts, { primary: 1 });
  assert.deepEqual(report.missingRecommendedRoles, ['secondary', 'visor']);
  assert.equal(report.builtInVoxelDelta, -6);
});

test('buildArmorEditorValidationReport preserves advisory V3 visual QA without invalidating saves', () => {
  const visualQa: V3ArmorEditorVisualQaReport = {
    ready: false,
    score: 61,
    issues: [{
      code: 'dark_coverage_high',
      message: 'dark material coverage obscures silhouette readability',
      value: 0.9,
      threshold: 0.82,
    }],
    summary: {
      snapshotCount: 8,
      minOccupiedAreaRatio: 0.002,
      maxOccupiedAreaRatio: 0.004,
      minProjectedWidth: 0.18,
      minProjectedHeight: 0.22,
      maxDarkMaterialCoverage: 0.9,
      maxEmissiveMaterialCoverage: 0,
      panelCount: 12,
      materialGroupCount: 1,
      visibleImportantPartCount: 0,
      importantPartCount: 0,
    },
  };

  const report = buildArmorEditorValidationReport({
    draft: piece(['primary', 'secondary', 'visor']),
    validation: validation(),
    builtInVoxelCount: 10,
    slotBudget: 780,
    recommendedRoles: ['primary', 'secondary', 'visor'],
    visualQa,
  });

  assert.equal(report.status, 'warn');
  assert.equal(report.visualQa, visualQa);
});
