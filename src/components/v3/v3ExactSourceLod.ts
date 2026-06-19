import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import type { VoxelData } from '../VoxelModels';
import {
  V3_QUALITY_TIERS,
  V3_CHARACTER_SLOT_IDS,
  type V3AssetBudget,
  type V3CharacterSlotId,
  type V3QualityTier,
} from './v3ModelTypes';
import { normalizeV3QualityTier } from './v3QualityTiers';
import type { V3SourceFidelity } from './v3QualityTiers';
import {
  analyzeV3ArmorSurface,
  type V3ArmorSurfaceOptions,
  type V3ArmorSurfaceReport,
} from './v3VoxelArmorSurface';

export type V3ExactSource = typeof V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
type V3ExactSourceSlot = V3ExactSource['slots'][V3CharacterSlotId];
export type V3ExactSourceRun = readonly [number, number, number, number, number, 1?];
export type V3ExactSourceFidelity = V3SourceFidelity;

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

export interface V3ExactSourceBudgetOptions extends Pick<
  V3ArmorSurfaceOptions,
  'renderStyle' | 'panelCornerStyle' | 'panelDepthStyle'
> {
  qualityTier?: V3QualityTier;
  sourceFidelity?: V3ExactSourceFidelity;
  source?: V3ExactSource;
}

export interface V3ExactSourceRenderableOptions {
  qualityTier?: V3QualityTier;
  sourceFidelity?: V3ExactSourceFidelity;
}

export interface V3ExactSourceSlotBudget extends V3AssetBudget {
  slot: V3CharacterSlotId;
  qualityTier: V3QualityTier;
  renderableQualityTier: V3QualityTier;
  sourceFidelity: V3ExactSourceFidelity;
  exact: boolean;
  exactSourceVoxelCount: number;
  sourceRunCount: number;
  exactSourceRunCount: number;
  retainedVoxelRatio: number;
  surface: V3ArmorSurfaceReport;
}

export interface V3ExactSourceRuntimeTierBudget extends V3AssetBudget {
  qualityTier: V3QualityTier;
  sourceFidelity: V3ExactSourceFidelity;
  exact: boolean;
  slotCount: number;
  exactSourceVoxelCount: number;
  sourceRunCount: number;
  exactSourceRunCount: number;
  retainedVoxelRatio: number;
  surfacePanelCount: number;
  exposedFaceCount: number;
  emissivePanelCount: number;
}

export interface V3ExactSourceRuntimeBudgetReport {
  kind: 'v3-exact-source-runtime-budget';
  version: 1;
  ready: boolean;
  sourceHash: string;
  selected: V3ExactSourceRuntimeTierBudget;
  exact: V3ExactSourceRuntimeTierBudget;
  byTier: Record<V3QualityTier, V3ExactSourceRuntimeTierBudget>;
  issues: string[];
}

const ROLE_PRIORITY_KEEP = new Set(['visor', 'emissive']);
export const V3_EXACT_SOURCE_RUNTIME_RETAINED_RATIO_CAPS: Record<V3QualityTier, number> = {
  mobileLow: 0.04,
  mobile: 0.07,
  desktop: 0.16,
  ultra: 0.24,
};

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
      xModulo: 11,
      priorityRowModulo: 1,
      priorityXModulo: 5,
    };
  }
  if (qualityTier === 'desktop') {
    return {
      rowModulo: 3,
      xModulo: 5,
      priorityRowModulo: 1,
      priorityXModulo: 2,
    };
  }
  return {
    rowModulo: 2,
    xModulo: 4,
    priorityRowModulo: 1,
    priorityXModulo: 2,
  };
};

const runVoxelCount = (run: V3ExactSourceRun): number => Math.max(0, run[4] - run[3] + 1);

const countRunVoxels = (runs: readonly V3ExactSourceRun[]): number =>
  runs.reduce((total, run) => total + runVoxelCount(run), 0);

const roundRatio = (value: number): number => Number(value.toFixed(6));

const estimateMeasuredMemoryKb = (voxelCount: number, surface: V3ArmorSurfaceReport): number =>
  Math.max(1, Math.ceil((
    voxelCount * 24 +
    surface.panelCount * 64 +
    surface.materialGroupCount * 256
  ) / 1024));

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

const normalizeV3ExactSourceFidelity = (value: unknown): V3ExactSourceFidelity =>
  value === 'exact' ? 'exact' : 'runtimeLod';

const normalizeRenderableOptions = (
  qualityTierOrOptions: V3QualityTier | V3ExactSourceRenderableOptions | undefined
): Required<V3ExactSourceRenderableOptions> => {
  if (typeof qualityTierOrOptions === 'object' && qualityTierOrOptions !== null) {
    return {
      qualityTier: normalizeV3QualityTier(qualityTierOrOptions.qualityTier),
      sourceFidelity: normalizeV3ExactSourceFidelity(qualityTierOrOptions.sourceFidelity),
    };
  }

  return {
    qualityTier: normalizeV3QualityTier(qualityTierOrOptions),
    sourceFidelity: 'runtimeLod',
  };
};

const runsToSurfaceVoxels = (
  source: V3ExactSource,
  runs: readonly V3ExactSourceRun[]
): VoxelData[] => {
  const voxels: VoxelData[] = [];
  for (const run of runs) {
    const color = source.rolePalette[run[0]] ?? 'primary';
    const emissive = run[5] === 1;
    for (let x = run[3]; x <= run[4]; x += 1) {
      voxels.push({
        x,
        y: run[1],
        z: run[2],
        color,
        emissive: emissive || undefined,
      });
    }
  }
  return voxels;
};

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
  qualityTierOrOptions: V3QualityTier | V3ExactSourceRenderableOptions = 'desktop',
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceRenderableSlot {
  const { qualityTier, sourceFidelity } = normalizeRenderableOptions(qualityTierOrOptions);
  const sourceSlot = source.slots[slot];
  const exact = sourceFidelity === 'exact';
  const profile = exact ? undefined : lodProfileForTier(qualityTier);
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

export function deriveV3ExactSourceSlotBudget(
  slot: V3CharacterSlotId,
  options: V3ExactSourceBudgetOptions = {}
): V3ExactSourceSlotBudget {
  const source = options.source ?? V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
  const qualityTier = normalizeV3QualityTier(options.qualityTier);
  const sourceFidelity = normalizeV3ExactSourceFidelity(options.sourceFidelity);
  const renderable = getV3ExactSourceRenderableSlot(slot, { qualityTier, sourceFidelity }, source);
  const surface = analyzeV3ArmorSurface(runsToSurfaceVoxels(source, renderable.runs), options);
  const sourceSlot = source.slots[slot];
  const sourceVoxelCount = renderable.voxelCount;

  return {
    slot,
    qualityTier,
    renderableQualityTier: renderable.qualityTier,
    sourceFidelity,
    exact: renderable.exact,
    sourceVoxelCount,
    exactSourceVoxelCount: renderable.sourceVoxelCount,
    mergedBoxCount: surface.panelCount,
    materialGroupCount: surface.materialGroupCount,
    drawCallEstimate: surface.materialGroupCount,
    lodCount: 1,
    memoryEstimateKb: estimateMeasuredMemoryKb(sourceVoxelCount, surface),
    sourceRunCount: renderable.runCount,
    exactSourceRunCount: sourceSlot.runCount,
    retainedVoxelRatio: renderable.retainedVoxelRatio,
    surface,
  };
}

const aggregateV3ExactSourceTierBudget = (
  qualityTier: V3QualityTier,
  sourceFidelity: V3ExactSourceFidelity,
  options: V3ExactSourceBudgetOptions
): V3ExactSourceRuntimeTierBudget => {
  const slots = V3_CHARACTER_SLOT_IDS.map((slot) =>
    deriveV3ExactSourceSlotBudget(slot, {
      ...options,
      qualityTier,
      sourceFidelity,
    }));
  const sourceVoxelCount = slots.reduce((total, slot) => total + slot.sourceVoxelCount, 0);
  const exactSourceVoxelCount = slots.reduce((total, slot) => total + slot.exactSourceVoxelCount, 0);
  const mergedBoxCount = slots.reduce((total, slot) => total + slot.mergedBoxCount, 0);
  const materialGroupCount = slots.reduce((total, slot) => total + slot.materialGroupCount, 0);
  const drawCallEstimate = slots.reduce((total, slot) => total + slot.drawCallEstimate, 0);
  const lodCount = slots.reduce((total, slot) => total + slot.lodCount, 0);
  const memoryEstimateKb = slots.reduce((total, slot) => total + slot.memoryEstimateKb, 0);
  const sourceRunCount = slots.reduce((total, slot) => total + slot.sourceRunCount, 0);
  const exactSourceRunCount = slots.reduce((total, slot) => total + slot.exactSourceRunCount, 0);
  const exposedFaceCount = slots.reduce((total, slot) => total + slot.surface.exposedFaceCount, 0);
  const emissivePanelCount = slots.reduce((total, slot) => total + slot.surface.emissivePanelCount, 0);

  return {
    qualityTier,
    sourceFidelity,
    exact: slots.every((slot) => slot.exact),
    slotCount: slots.length,
    sourceVoxelCount,
    exactSourceVoxelCount,
    mergedBoxCount,
    materialGroupCount,
    drawCallEstimate,
    lodCount,
    memoryEstimateKb,
    sourceRunCount,
    exactSourceRunCount,
    retainedVoxelRatio: exactSourceVoxelCount > 0 ? roundRatio(sourceVoxelCount / exactSourceVoxelCount) : 0,
    surfacePanelCount: mergedBoxCount,
    exposedFaceCount,
    emissivePanelCount,
  };
};

export function analyzeV3ExactSourceRuntimeBudget(
  options: V3ExactSourceBudgetOptions = {}
): V3ExactSourceRuntimeBudgetReport {
  const source = options.source ?? V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE;
  const qualityTier = normalizeV3QualityTier(options.qualityTier);
  const sourceFidelity = normalizeV3ExactSourceFidelity(options.sourceFidelity);
  const optionsWithSource = { ...options, source };
  const byTier = Object.fromEntries(V3_QUALITY_TIERS.map((tier) => [
    tier,
    aggregateV3ExactSourceTierBudget(tier, 'runtimeLod', optionsWithSource),
  ])) as Record<V3QualityTier, V3ExactSourceRuntimeTierBudget>;
  const exact = aggregateV3ExactSourceTierBudget('desktop', 'exact', optionsWithSource);
  const selected = sourceFidelity === 'exact'
    ? aggregateV3ExactSourceTierBudget(qualityTier, 'exact', optionsWithSource)
    : byTier[qualityTier];
  const issues: string[] = [];

  if (exact.sourceVoxelCount !== exact.exactSourceVoxelCount) {
    issues.push('exact source budget does not retain every source voxel');
  }
  if (byTier.mobile.sourceVoxelCount >= exact.sourceVoxelCount) {
    issues.push('mobile exact-source runtime budget does not reduce source voxel count');
  }
  if (byTier.mobileLow.sourceVoxelCount >= byTier.mobile.sourceVoxelCount) {
    issues.push('mobileLow exact-source runtime budget is not smaller than mobile');
  }
  for (const tier of V3_QUALITY_TIERS) {
    if (byTier[tier].exact) {
      issues.push(`${tier} runtime LOD budget unexpectedly retains exact source`);
    }
    if (byTier[tier].retainedVoxelRatio > V3_EXACT_SOURCE_RUNTIME_RETAINED_RATIO_CAPS[tier]) {
      issues.push(
        `${tier} runtime LOD retained ratio ${byTier[tier].retainedVoxelRatio} exceeds ${V3_EXACT_SOURCE_RUNTIME_RETAINED_RATIO_CAPS[tier]}`
      );
    }
  }

  return {
    kind: 'v3-exact-source-runtime-budget',
    version: 1,
    ready: issues.length === 0,
    sourceHash: source.source.hash,
    selected,
    exact,
    byTier,
    issues,
  };
}

export function analyzeV3ExactSourceLodBudget(
  source: V3ExactSource = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE
): V3ExactSourceLodBudgetReport {
  const runtime = analyzeV3ExactSourceRuntimeBudget({ source });
  const byTier = Object.fromEntries(V3_QUALITY_TIERS.map((qualityTier) => {
    const tier = runtime.byTier[qualityTier];
    return [qualityTier, {
      qualityTier,
      exact: tier.exact,
      totalVoxelCount: tier.sourceVoxelCount,
      totalRunCount: tier.sourceRunCount,
      retainedVoxelRatio: tier.retainedVoxelRatio,
    }];
  })) as Record<V3QualityTier, V3ExactSourceLodTierBudget>;

  return {
    ready: runtime.ready,
    exact: {
      qualityTier: 'desktop',
      exact: true,
      totalVoxelCount: runtime.exact.sourceVoxelCount,
      totalRunCount: runtime.exact.sourceRunCount,
      retainedVoxelRatio: 1,
    },
    byTier,
    issues: runtime.issues,
  };
}
