import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorValidationResult,
} from '../customArmor';

export interface ArmorEditorValidationReportInput {
  draft: CustomArmorPieceSnapshot;
  validation: CustomArmorValidationResult;
  builtInVoxelCount: number;
  slotBudget: number;
  recommendedRoles: CustomArmorMaterialRole[];
}

export interface ArmorEditorValidationReport {
  budgetPercent: number;
  roleCounts: Partial<Record<CustomArmorMaterialRole, number>>;
  missingRecommendedRoles: CustomArmorMaterialRole[];
  builtInVoxelDelta: number;
  status: 'pass' | 'warn';
}

export function buildArmorEditorValidationReport(
  input: ArmorEditorValidationReportInput
): ArmorEditorValidationReport {
  const roleCounts: Partial<Record<CustomArmorMaterialRole, number>> = {};
  for (const voxel of input.draft.voxels) {
    roleCounts[voxel.role] = (roleCounts[voxel.role] ?? 0) + 1;
  }

  return {
    budgetPercent: Math.round((input.validation.stats.voxelCount / Math.max(1, input.slotBudget)) * 100),
    roleCounts,
    missingRecommendedRoles: input.recommendedRoles.filter((role) => !roleCounts[role]),
    builtInVoxelDelta: input.validation.stats.voxelCount - input.builtInVoxelCount,
    status: input.validation.valid ? 'pass' : 'warn',
  };
}
