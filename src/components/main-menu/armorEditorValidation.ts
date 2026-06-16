import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorValidationResult,
} from '../customArmor';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';

export interface ArmorEditorValidationReportInput {
  draft: CustomArmorPieceSnapshot;
  validation: CustomArmorValidationResult;
  builtInVoxelCount: number;
  slotBudget: number;
  recommendedRoles: CustomArmorMaterialRole[];
  visualQa?: V3ArmorEditorVisualQaReport;
}

export interface ArmorEditorValidationReport {
  budgetPercent: number;
  roleCounts: Partial<Record<CustomArmorMaterialRole, number>>;
  missingRecommendedRoles: CustomArmorMaterialRole[];
  builtInVoxelDelta: number;
  status: 'pass' | 'warn';
  visualQa?: V3ArmorEditorVisualQaReport;
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
    status: input.validation.valid && input.visualQa?.ready !== false ? 'pass' : 'warn',
    visualQa: input.visualQa,
  };
}
