import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomArmorPieceSnapshot, CustomArmorValidationResult } from '../customArmor';
import { buildArmorEditorValidationReport } from './armorEditorValidation';

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
