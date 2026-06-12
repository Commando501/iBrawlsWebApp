import * as THREE from 'three';
import {
  V3_QUALITY_TIERS,
  type V3AssetBudget,
  type V3QualityTier,
} from './v3ModelTypes';

export interface V3RenderBudgetSummary extends V3AssetBudget {
  modelCount: number;
  partCount: number;
  qualityTiers: Record<V3QualityTier, number>;
}

export const createEmptyV3RenderBudget = (): V3RenderBudgetSummary => ({
  modelCount: 0,
  partCount: 0,
  sourceVoxelCount: 0,
  mergedBoxCount: 0,
  materialGroupCount: 0,
  drawCallEstimate: 0,
  lodCount: 0,
  memoryEstimateKb: 0,
  qualityTiers: Object.fromEntries(V3_QUALITY_TIERS.map((tier) => [tier, 0])) as Record<V3QualityTier, number>,
});

const isV3QualityTier = (value: unknown): value is V3QualityTier =>
  typeof value === 'string' && V3_QUALITY_TIERS.includes(value as V3QualityTier);

export function collectV3RenderBudget(root: THREE.Object3D): V3RenderBudgetSummary {
  const summary = createEmptyV3RenderBudget();

  root.traverse((object) => {
    if (object.userData?.modelSystem === 'v3' && object.userData?.v3CharacterLoadout) {
      summary.modelCount += 1;
    }

    const selectedLod = object.userData?.v3SelectedLod as {
      qualityTier?: unknown;
      budget?: V3AssetBudget;
    } | undefined;
    if (!selectedLod?.budget || !isV3QualityTier(selectedLod.qualityTier)) {
      return;
    }

    summary.partCount += 1;
    summary.sourceVoxelCount += selectedLod.budget.sourceVoxelCount;
    summary.mergedBoxCount += selectedLod.budget.mergedBoxCount;
    summary.materialGroupCount += selectedLod.budget.materialGroupCount;
    summary.drawCallEstimate += selectedLod.budget.drawCallEstimate;
    summary.lodCount += selectedLod.budget.lodCount;
    summary.memoryEstimateKb += selectedLod.budget.memoryEstimateKb;
    summary.qualityTiers[selectedLod.qualityTier] += 1;
  });

  return summary;
}

export const summarizeV3SceneRenderBudget = collectV3RenderBudget;
