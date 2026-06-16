import * as THREE from 'three';
import type {
  CustomArmorColors,
  CustomArmorGridScale,
  CustomArmorPieceSnapshot,
} from '../customArmor';
import { customArmorPieceToVoxels } from '../customArmor';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  V3_ARMOR_SURFACE_BASE_VOXEL_SCALE,
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from '../v3/v3VoxelArmorSurface';
import {
  buildV3VisualQaReport,
  type V3VisualQaIssue,
  type V3VisualQaSummary,
  type V3VisualQaThresholds,
} from '../../tools/v3VisualQa';

export interface V3ArmorEditorVisualQaInput {
  draft: CustomArmorPieceSnapshot;
  colors: CustomArmorColors;
  slot: V3CharacterSlotId;
  gridScale: CustomArmorGridScale;
}

export interface V3ArmorEditorVisualQaReport {
  ready: boolean;
  score: number;
  issues: V3VisualQaIssue[];
  summary: V3VisualQaSummary;
}

export const V3_ARMOR_EDITOR_VISUAL_QA_THRESHOLDS = {
  minOccupiedAreaRatio: 0.015,
  maxOccupiedAreaRatio: 0.82,
  maxDarkMaterialCoverage: 0.88,
  maxEmissiveMaterialCoverage: 0.38,
  minPanelCount: 12,
  minMaterialGroupCount: 1,
} as const satisfies V3VisualQaThresholds;

const clampScore = (score: number): number => Math.max(0, Math.min(100, Math.round(score)));

function getSlotPivot(slot: V3CharacterSlotId, gridScale: CustomArmorGridScale): [number, number, number] {
  const dimensions = getV3CharacterPartBounds(slot).maxDimensions;
  return [
    ((dimensions.x * gridScale) - 1) / 2,
    ((dimensions.y * gridScale) - 1) / 2,
    ((dimensions.z * gridScale) - 1) / 2,
  ];
}

function getSlotFrameHeight(slot: V3CharacterSlotId, gridScale: CustomArmorGridScale): number {
  const dimensions = getV3CharacterPartBounds(slot).maxDimensions;
  return dimensions.y * gridScale * (V3_ARMOR_SURFACE_BASE_VOXEL_SCALE / gridScale) * 1.18;
}

function disposeTemporaryGroup(group: THREE.Group): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    if (object.userData.v3CachedMaterial) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.dispose());
  });
}

export function scoreV3ArmorEditorVisualQa(issues: readonly V3VisualQaIssue[]): number {
  const uniqueIssueCodes = new Set(issues.map((issue) => issue.code)).size;
  return clampScore(100 - (uniqueIssueCodes * 14) - (issues.length * 3));
}

export function buildV3ArmorEditorVisualQa(
  input: V3ArmorEditorVisualQaInput
): V3ArmorEditorVisualQaReport {
  const renderVoxels = customArmorPieceToVoxels(input.draft, input.colors);
  const group = createV3VoxelArmorGroup(renderVoxels, {
    ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
    renderStyle: 'armorSurface',
    qualityTier: 'desktop',
    voxelScale: V3_ARMOR_SURFACE_BASE_VOXEL_SCALE / input.gridScale,
    pivot: getSlotPivot(input.slot, input.gridScale),
  });
  const report = buildV3VisualQaReport(group, {
    thresholds: V3_ARMOR_EDITOR_VISUAL_QA_THRESHOLDS,
    importantPartIds: [],
    frameHeight: getSlotFrameHeight(input.slot, input.gridScale),
  });
  disposeTemporaryGroup(group);

  return {
    ready: report.ready,
    score: scoreV3ArmorEditorVisualQa(report.issues),
    issues: report.issues,
    summary: report.summary,
  };
}
