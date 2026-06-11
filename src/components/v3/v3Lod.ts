import {
  V3_QUALITY_TIERS,
  type V3AssetBudget,
  type V3LodLevel,
  type V3QualityTier,
  validateV3AssetBudget,
} from './v3ModelTypes';

export interface V3LodSelectionInput {
  lods: readonly V3LodLevel[];
  qualityTier: V3QualityTier;
  distance: number;
}

const SAFE_FALLBACK_BUDGET: V3AssetBudget = {
  sourceVoxelCount: 1,
  mergedBoxCount: 1,
  materialGroupCount: 1,
  drawCallEstimate: 1,
  lodCount: 1,
  memoryEstimateKb: 1,
};

const SAFE_FALLBACK_LOD: V3LodLevel = {
  id: 'v3-lod:fallback-mobile-low',
  sourceId: 'v3-lod:fallback-source',
  qualityTier: 'mobileLow',
  maxDistance: 9999,
  budget: SAFE_FALLBACK_BUDGET,
};

const copyBudget = (budget: V3AssetBudget): V3AssetBudget => ({ ...budget });

const copyLod = (lod: V3LodLevel): V3LodLevel => ({
  ...lod,
  budget: copyBudget(lod.budget),
});

export function getV3QualityTierRank(tier: V3QualityTier): number {
  return V3_QUALITY_TIERS.indexOf(tier);
}

const isKnownQualityTier = (tier: unknown): tier is V3QualityTier =>
  typeof tier === 'string' && V3_QUALITY_TIERS.includes(tier as V3QualityTier);

const isValidLod = (lod: V3LodLevel): boolean =>
  Boolean(lod.id) &&
  Boolean(lod.sourceId) &&
  isKnownQualityTier(lod.qualityTier) &&
  Number.isFinite(lod.maxDistance) &&
  lod.maxDistance > 0 &&
  validateV3AssetBudget(lod.budget).length === 0;

const compareByRichestQuality = (a: V3LodLevel, b: V3LodLevel): number => {
  const qualityDelta = getV3QualityTierRank(b.qualityTier) - getV3QualityTierRank(a.qualityTier);
  if (qualityDelta !== 0) {
    return qualityDelta;
  }

  const distanceDelta = a.maxDistance - b.maxDistance;
  if (distanceDelta !== 0) {
    return distanceDelta;
  }

  return a.sourceId.localeCompare(b.sourceId);
};

const compareByCheapestQuality = (a: V3LodLevel, b: V3LodLevel): number => {
  const qualityDelta = getV3QualityTierRank(a.qualityTier) - getV3QualityTierRank(b.qualityTier);
  if (qualityDelta !== 0) {
    return qualityDelta;
  }

  const distanceDelta = b.maxDistance - a.maxDistance;
  if (distanceDelta !== 0) {
    return distanceDelta;
  }

  return a.sourceId.localeCompare(b.sourceId);
};

export function selectV3LodLevel(input: V3LodSelectionInput): V3LodLevel {
  const validLods = input.lods.filter(isValidLod);
  if (validLods.length === 0) {
    return copyLod(SAFE_FALLBACK_LOD);
  }

  const distance = Number.isFinite(input.distance) ? Math.max(0, input.distance) : Number.POSITIVE_INFINITY;
  const distanceEligibleLods = validLods.filter((lod) => distance <= lod.maxDistance);
  const distanceCandidates = distanceEligibleLods.length > 0 ? distanceEligibleLods : validLods;
  const requestedQualityRank = getV3QualityTierRank(input.qualityTier);
  const qualityEligibleLods = distanceCandidates.filter(
    (lod) => getV3QualityTierRank(lod.qualityTier) <= requestedQualityRank
  );

  if (qualityEligibleLods.length > 0) {
    return copyLod([...qualityEligibleLods].sort(compareByRichestQuality)[0]);
  }

  return copyLod([...distanceCandidates].sort(compareByCheapestQuality)[0]);
}
