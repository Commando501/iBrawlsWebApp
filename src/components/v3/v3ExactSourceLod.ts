import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3QualityTier,
} from './v3ModelTypes';

type V3ExactSource = typeof V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
type V3ExactSourceSlot = V3ExactSource['slots'][V3CharacterSlotId];
export type V3ExactSourceRun = readonly [number, number, number, number, number, 1?];

export interface V3ExactSourceRenderableSlot {
  slot: V3CharacterSlotId;
  qualityTier: V3QualityTier;
  exact: boolean;
  runs: V3ExactSourceRun[];
  roleHintIndexes: readonly number[];
  bounds: V3ExactSourceSlot['bounds'];
  voxelCount: number;
  runCount: number;
  sourceVoxelCount: number;
  retainedVoxelRatio: number;
}

export interface V3ExactSourceLodTierBudget {
  qualityTier: V3QualityTier;
  exact: boolean;
  totalVoxelCount: number;
  totalRunCount: number;
  retainedVoxelRatio: number;
}

export interface V3ExactSourceLodBudgetReport {
  ready: boolean;
  exact: V3ExactSourceLodTierBudget;
  byTier: Record<V3QualityTier, V3ExactSourceLodTierBudget>;
  issues: string[];
}

const EXACT_TIERS = new Set<V3QualityTier>(['desktop', 'ultra']);
const ROLE_PRIORITY_KEEP = new Set(['visor', 'emissive']);

interface V3ExactSourceLodProfile {
  rowModulo: number;
  xModulo: number;
  priorityRowModulo: number;
  priorityXModulo: number;
}

const lodProfileForTier = (qualityTier: V3QualityTier): V3ExactSourceLodProfile | undefined => {
  if (qualityTier === 'mobileLow') {
    return {
      rowModulo: 10,
      xModulo: 14,
      priorityRowModulo: 2,
      priorityXModulo: 5,
    };
  }
  if (qualityTier === 'mobile') {
    return {
      rowModulo: 6,
      xModulo: 10,
      priorityRowModulo: 1,
      priorityXModulo: 4,
    };
  }
  return undefined;
};

const runVoxelCount = (run: V3ExactSourceRun): number => Math.max(0, run[4] - run[3] + 1);

const countRunVoxels = (runs: readonly V3ExactSourceRun[]): number =>
  runs.reduce((total, run) => total + runVoxelCount(run), 0);

const createRun = (
  template: V3ExactSourceRun,
  startX: number,
  endX: number
): V3ExactSourceRun => (
  template[5] === 1
    ? [template[0], template[1], template[2], startX, endX, 1]
    : [template[0], template[1], template[2], startX, endX]
);

const cloneRun = (run: V3ExactSourceRun): V3ExactSourceRun =>
  createRun(run, run[3], run[4]);

function filterRunForTier(
  source: V3ExactSource,
  run: V3ExactSourceRun,
  profile: V3ExactSourceLodProfile | undefined
): V3ExactSourceRun[] {
  if (!profile) return [cloneRun(run)];

  const role = source.rolePalette[run[0]];
  const priority = ROLE_PRIORITY_KEEP.has(role) || run[5] === 1;
  const rowSeed = Math.abs(run[1] * 3 + run[2] * 5 + run[0] * 7);
  const rowModulo = priority ? profile.priorityRowModulo : profile.rowModulo;
  if (rowModulo > 1 && rowSeed % rowModulo !== 0) {
    return [];
  }

  const length = runVoxelCount(run);
  if (length <= 0) return [];

  const xModulo = priority ? profile.priorityXModulo : profile.xModulo;
  const keptLength = Math.max(1, Math.ceil(length / Math.max(1, xModulo)));
  const maxOffset = Math.max(0, length - keptLength);
  const offset = maxOffset > 0 ? rowSeed % (maxOffset + 1) : 0;
  const startX = run[3] + offset;
  return [createRun(run, startX, startX + keptLength - 1)];
}

export function getV3ExactSourceRenderableSlot(
  slot: V3CharacterSlotId,
  qualityTier: V3QualityTier,
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceRenderableSlot {
  const sourceSlot = source.slots[slot];
  const exact = EXACT_TIERS.has(qualityTier);
  const profile = lodProfileForTier(qualityTier);
  const filteredRuns = exact
    ? sourceSlot.runs.map((run) => cloneRun(run))
    : sourceSlot.runs.flatMap((run) => filterRunForTier(source, run, profile));
  const runs = filteredRuns.length > 0
    ? filteredRuns
    : sourceSlot.runs.slice(0, 1).map((run) => cloneRun(run));
  const voxelCount = countRunVoxels(runs);
  const sourceVoxelCount = sourceSlot.voxelCount;

  return {
    slot,
    qualityTier,
    exact,
    runs,
    roleHintIndexes: sourceSlot.roleHintIndexes,
    bounds: sourceSlot.bounds,
    voxelCount,
    runCount: runs.length,
    sourceVoxelCount,
    retainedVoxelRatio: sourceVoxelCount > 0 ? Number((voxelCount / sourceVoxelCount).toFixed(6)) : 0,
  };
}

export function analyzeV3ExactSourceLodBudget(
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceLodBudgetReport {
  const byTier = Object.fromEntries((['mobileLow', 'mobile', 'desktop', 'ultra'] as const).map((qualityTier) => {
    const slots = V3_CHARACTER_SLOT_IDS.map((slot) => getV3ExactSourceRenderableSlot(slot, qualityTier, source));
    const totalVoxelCount = slots.reduce((total, slot) => total + slot.voxelCount, 0);
    const totalRunCount = slots.reduce((total, slot) => total + slot.runCount, 0);
    return [qualityTier, {
      qualityTier,
      exact: EXACT_TIERS.has(qualityTier),
      totalVoxelCount,
      totalRunCount,
      retainedVoxelRatio: source.metrics.totalVoxelCount > 0
        ? Number((totalVoxelCount / source.metrics.totalVoxelCount).toFixed(6))
        : 0,
    }];
  })) as Record<V3QualityTier, V3ExactSourceLodTierBudget>;

  const issues: string[] = [];
  if (byTier.mobile.totalVoxelCount >= source.metrics.totalVoxelCount) {
    issues.push('mobile exact-source LOD does not reduce voxel count');
  }
  if (byTier.mobileLow.totalVoxelCount >= byTier.mobile.totalVoxelCount) {
    issues.push('mobileLow exact-source LOD is not smaller than mobile');
  }

  return {
    ready: issues.length === 0,
    exact: {
      qualityTier: 'desktop',
      exact: true,
      totalVoxelCount: source.metrics.totalVoxelCount,
      totalRunCount: source.metrics.totalRunCount,
      retainedVoxelRatio: 1,
    },
    byTier,
    issues,
  };
}
