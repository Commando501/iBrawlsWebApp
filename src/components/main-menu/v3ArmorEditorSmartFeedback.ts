import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import {
  dedupeCustomArmorVoxels,
  getCustomArmorBounds,
} from '../customArmor';

export interface V3SmartAuthoringFeedback {
  currentScore: number;
  previewScore: number;
  delta: number;
  labels: string[];
}

interface V3ReadabilityMetrics {
  score: number;
  boundsFill: number;
  projectionCoverage: number;
  roleDiversity: number;
  darkRatio: number;
  emissiveRatio: number;
  negativeSpace: number;
}

const DARK_ROLES = new Set<CustomArmorMaterialRole>(['dark', 'undersuit']);
const EMISSIVE_ROLES = new Set<CustomArmorMaterialRole>(['emissive', 'visor']);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreRange(value: number, min: number, ideal: number, max: number): number {
  if (value <= min || value >= max) return 0;
  if (value === ideal) return 1;
  if (value < ideal) return clamp01((value - min) / Math.max(0.0001, ideal - min));
  return clamp01((max - value) / Math.max(0.0001, max - ideal));
}

function roleRatio(
  voxels: readonly CustomArmorVoxel[],
  roles: ReadonlySet<CustomArmorMaterialRole>,
  includeEmissiveFlag = false
): number {
  return voxels.filter((voxel) => (
    roles.has(voxel.role) || (includeEmissiveFlag && voxel.emissive === true)
  )).length / Math.max(1, voxels.length);
}

function measureProjectionCoverage(voxels: readonly CustomArmorVoxel[]): number {
  const bounds = getCustomArmorBounds([...voxels]);
  if (!bounds) return 0;
  const sizeX = bounds.maxX - bounds.minX + 1;
  const sizeY = bounds.maxY - bounds.minY + 1;
  const sizeZ = bounds.maxZ - bounds.minZ + 1;
  const xy = new Set<string>();
  const xz = new Set<string>();
  const yz = new Set<string>();

  for (const voxel of voxels) {
    xy.add(`${voxel.x}:${voxel.y}`);
    xz.add(`${voxel.x}:${voxel.z}`);
    yz.add(`${voxel.y}:${voxel.z}`);
  }

  return (
    (xy.size / Math.max(1, sizeX * sizeY)) +
    (xz.size / Math.max(1, sizeX * sizeZ)) +
    (yz.size / Math.max(1, sizeY * sizeZ))
  ) / 3;
}

function measureReadability(draft: CustomArmorPieceSnapshot): V3ReadabilityMetrics {
  const voxels = dedupeCustomArmorVoxels(draft.voxels);
  const bounds = getCustomArmorBounds(voxels);
  if (!bounds || voxels.length === 0) {
    return {
      score: 0,
      boundsFill: 0,
      projectionCoverage: 0,
      roleDiversity: 0,
      darkRatio: 0,
      emissiveRatio: 0,
      negativeSpace: 1,
    };
  }

  const volume = (
    (bounds.maxX - bounds.minX + 1) *
    (bounds.maxY - bounds.minY + 1) *
    (bounds.maxZ - bounds.minZ + 1)
  );
  const boundsFill = voxels.length / Math.max(1, volume);
  const projectionCoverage = measureProjectionCoverage(voxels);
  const roleDiversity = new Set(voxels.map((voxel) => voxel.role)).size;
  const darkRatio = roleRatio(voxels, DARK_ROLES);
  const emissiveRatio = roleRatio(voxels, EMISSIVE_ROLES, true);
  const negativeSpace = 1 - boundsFill;
  const score = (
    scoreRange(boundsFill, 0.04, 0.28, 0.82) * 22 +
    clamp01((projectionCoverage - 0.08) / 0.5) * 22 +
    clamp01((roleDiversity - 1) / 4) * 20 +
    (1 - clamp01((darkRatio - 0.12) / 0.5)) * 18 +
    (1 - clamp01((emissiveRatio - 0.04) / 0.24)) * 8 +
    scoreRange(negativeSpace, 0.16, 0.68, 0.96) * 10
  );

  return {
    score: clampScore(score),
    boundsFill,
    projectionCoverage,
    roleDiversity,
    darkRatio,
    emissiveRatio,
    negativeSpace,
  };
}

function buildLabels(current: V3ReadabilityMetrics, preview: V3ReadabilityMetrics): string[] {
  const labels: string[] = [];

  if (preview.score > current.score) labels.push('readability improved');
  if (preview.darkRatio <= current.darkRatio - 0.05) labels.push('lower dark coverage');
  if (preview.roleDiversity > current.roleDiversity) labels.push('stronger role diversity');
  if (preview.projectionCoverage >= current.projectionCoverage + 0.04) labels.push('stronger projection coverage');
  if (
    current.negativeSpace < 0.22 &&
    preview.negativeSpace >= current.negativeSpace + 0.04
  ) {
    labels.push('more negative space');
  }
  if (preview.emissiveRatio <= current.emissiveRatio - 0.05) labels.push('lower emissive coverage');
  if (labels.length === 0) labels.push('no clear readability gain');

  return labels;
}

export function buildV3SmartAuthoringFeedback(
  currentDraft: CustomArmorPieceSnapshot,
  previewDraft: CustomArmorPieceSnapshot
): V3SmartAuthoringFeedback {
  const current = measureReadability(currentDraft);
  const preview = measureReadability(previewDraft);

  return {
    currentScore: current.score,
    previewScore: preview.score,
    delta: preview.score - current.score,
    labels: buildLabels(current, preview),
  };
}
