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

const lodModuloForTier = (qualityTier: V3QualityTier): number => {
  if (qualityTier === 'mobileLow') return 3;
  if (qualityTier === 'mobile') return 2;
  return 1;
};

const runVoxelCount = (run: V3ExactSourceRun): number => Math.max(0, run[4] - run[3] + 1);

const countRunVoxels = (runs: readonly V3ExactSourceRun[]): number =>
  runs.reduce((total, run) => total + runVoxelCount(run), 0);

const compactRunXs = (
  template: V3ExactSourceRun,
  xs: readonly number[]
): V3ExactSourceRun[] => {
  if (xs.length === 0) return [];
  const sorted = [...new Set(xs)].sort((left, right) => left - right);
  const runs: V3ExactSourceRun[] = [];
  let start = sorted[0];
  let previous = sorted[0];

  for (const x of sorted.slice(1)) {
    if (x === previous + 1) {
      previous = x;
      continue;
    }
    runs.push([
      template[0],
      template[1],
      template[2],
      start,
      previous,
      ...(template[5] === 1 ? [1] : []),
    ] as V3ExactSourceRun);
    start = x;
    previous = x;
  }

  runs.push([
    template[0],
    template[1],
    template[2],
    start,
    previous,
    ...(template[5] === 1 ? [1] : []),
  ] as V3ExactSourceRun);
  return runs;
};

function filterRunForTier(
  source: V3ExactSource,
  run: V3ExactSourceRun,
  modulo: number
): V3ExactSourceRun[] {
  if (modulo <= 1) return [[...run] as V3ExactSourceRun];

  const role = source.rolePalette[run[0]];
  if (ROLE_PRIORITY_KEEP.has(role) || run[5] === 1) {
    return [[...run] as V3ExactSourceRun];
  }

  const kept: number[] = [];
  for (let x = run[3]; x <= run[4]; x += 1) {
    const seed = x + run[1] * 3 + run[2] * 5 + run[0] * 7;
    if (seed % modulo === 0) {
      kept.push(x);
    }
  }
  if (kept.length === 0 && run[4] >= run[3]) {
    kept.push(Math.round((run[3] + run[4]) / 2));
  }
  return compactRunXs(run, kept);
}

export function getV3ExactSourceRenderableSlot(
  slot: V3CharacterSlotId,
  qualityTier: V3QualityTier,
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceRenderableSlot {
  const sourceSlot = source.slots[slot];
  const exact = EXACT_TIERS.has(qualityTier);
  const modulo = lodModuloForTier(qualityTier);
  const runs = exact
    ? sourceSlot.runs.map((run) => [...run] as V3ExactSourceRun)
    : sourceSlot.runs.flatMap((run) => filterRunForTier(source, run, modulo));
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
