import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import {
  dedupeCustomArmorVoxels,
  getCustomArmorBounds,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  validateCustomArmorPiece,
} from '../customArmor';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
} from '../v3/v3ModelTypes';

export type V3ArmorSmartToolId =
  | 'panelStripe'
  | 'edgeAccent'
  | 'carveSeam'
  | 'trimCorners'
  | 'taperMass'
  | 'mirrorLocalX';

export type V3SmartAuthoringAxis = 'x' | 'y' | 'z';

export type V3SmartAuthoringStrength = 'light' | 'normal' | 'heavy';

export interface V3SmartAuthoringOptions {
  strength?: V3SmartAuthoringStrength;
  panelStripe?: { thickness?: number; overwriteExisting?: boolean };
  edgeAccent?: {
    coverageRatio?: number;
    minVoxels?: number;
    edgeMode?: 'exposed-or-bounds' | 'bounds-only' | 'exposed-only';
  };
  carveSeam?: { preserveRatio?: number; minVoxels?: number };
  trimCorners?: {
    removeRatio?: number;
    preserveRatio?: number;
    cornerThreshold?: 2 | 3;
  };
  taperMass?: {
    axis?: V3SmartAuthoringAxis | 'auto';
    side?: 'cursor' | 'min' | 'max';
    depthRatio?: number;
    removeRatio?: number;
    preserveRatio?: number;
  };
  mirrorLocalX?: { scope?: 'piece' | 'cursorVolume'; overwriteExisting?: boolean };
}

export interface V3SmartAuthoringContext {
  cursor: { x: number; y: number; z: number };
  size: { x: number; y: number; z: number };
  axis: V3SmartAuthoringAxis;
  role: CustomArmorMaterialRole;
  fixedColor: string;
  emissive: boolean;
  now?: number;
}

export type V3SmartAuthoringVoxelDiff = Pick<
  CustomArmorVoxel,
  'x' | 'y' | 'z' | 'role' | 'color' | 'emissive'
>;

export interface V3SmartAuthoringVoxelRemapDiff {
  before: V3SmartAuthoringVoxelDiff;
  after: V3SmartAuthoringVoxelDiff;
}

export interface V3SmartAuthoringPreview {
  toolId: V3ArmorSmartToolId;
  previewDraft: CustomArmorPieceSnapshot;
  changed: boolean;
  added: V3SmartAuthoringVoxelDiff[];
  removed: V3SmartAuthoringVoxelDiff[];
  remapped: V3SmartAuthoringVoxelRemapDiff[];
}

interface EditableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

interface NormalizedV3SmartAuthoringOptions {
  strength: V3SmartAuthoringStrength;
  panelStripe: { thickness: number; overwriteExisting: boolean };
  edgeAccent: {
    coverageRatio: number;
    minVoxels: number;
    edgeMode: 'exposed-or-bounds' | 'bounds-only' | 'exposed-only';
  };
  carveSeam: { preserveRatio: number; minVoxels: number; customized: boolean };
  trimCorners: { removeRatio: number; preserveRatio: number; cornerThreshold: 2 | 3 };
  taperMass: {
    axis: V3SmartAuthoringAxis | 'auto';
    side: 'cursor' | 'min' | 'max';
    depthRatio: number;
    removeRatio: number;
    preserveRatio: number;
  };
  mirrorLocalX: { scope: 'piece' | 'cursorVolume'; overwriteExisting: boolean };
}

const AXES: V3SmartAuthoringAxis[] = ['x', 'y', 'z'];
const SLOT_SET = new Set<string>(V3_CHARACTER_SLOT_IDS);
const EDGE_MODES = new Set(['exposed-or-bounds', 'bounds-only', 'exposed-only']);

const STRENGTH_DEFAULTS: Record<V3SmartAuthoringStrength, {
  panelStripeThickness: number;
  edgeCoverageRatio: number;
  edgeMinVoxels: number;
  carvePreserveRatio: number;
  carveMinVoxels: number;
  trimRemoveRatio: number;
  trimPreserveRatio: number;
  taperDepthRatio: number;
  taperRemoveRatio: number;
  taperPreserveRatio: number;
}> = {
  light: {
    panelStripeThickness: 1,
    edgeCoverageRatio: 0.25,
    edgeMinVoxels: 6,
    carvePreserveRatio: 0.85,
    carveMinVoxels: 24,
    trimRemoveRatio: 0.04,
    trimPreserveRatio: 0.92,
    taperDepthRatio: 0.18,
    taperRemoveRatio: 0.06,
    taperPreserveRatio: 0.9,
  },
  normal: {
    panelStripeThickness: 1,
    edgeCoverageRatio: 0.5,
    edgeMinVoxels: 12,
    carvePreserveRatio: 0.7,
    carveMinVoxels: 24,
    trimRemoveRatio: 0.08,
    trimPreserveRatio: 0.85,
    taperDepthRatio: 0.25,
    taperRemoveRatio: 0.12,
    taperPreserveRatio: 0.8,
  },
  heavy: {
    panelStripeThickness: 3,
    edgeCoverageRatio: 0.75,
    edgeMinVoxels: 18,
    carvePreserveRatio: 0.55,
    carveMinVoxels: 16,
    trimRemoveRatio: 0.14,
    trimPreserveRatio: 0.78,
    taperDepthRatio: 0.35,
    taperRemoveRatio: 0.2,
    taperPreserveRatio: 0.72,
  },
};

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

const cloneVoxel = (voxel: CustomArmorVoxel): CustomArmorVoxel => ({ ...voxel });

const cloneDraft = (draft: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot => ({
  ...draft,
  voxels: draft.voxels.map(cloneVoxel),
});

function clampFloat(value: number | undefined, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.round(clampFloat(value, min, max, fallback));
}

function normalizeStrength(strength: V3SmartAuthoringOptions['strength']): V3SmartAuthoringStrength {
  return strength === 'light' || strength === 'heavy' ? strength : 'normal';
}

function normalizeAxisOption(
  axis: V3SmartAuthoringAxis | 'auto' | undefined
): V3SmartAuthoringAxis | 'auto' {
  return axis === 'x' || axis === 'y' || axis === 'z' ? axis : 'auto';
}

function normalizeSmartAuthoringOptions(
  options?: V3SmartAuthoringOptions
): NormalizedV3SmartAuthoringOptions {
  const strength = normalizeStrength(options?.strength);
  const defaults = STRENGTH_DEFAULTS[strength];
  const cornerThreshold = options?.trimCorners?.cornerThreshold === 3 ? 3 : 2;
  const edgeMode = EDGE_MODES.has(options?.edgeAccent?.edgeMode ?? '')
    ? options?.edgeAccent?.edgeMode ?? 'exposed-or-bounds'
    : 'exposed-or-bounds';
  const side = options?.taperMass?.side === 'min' || options?.taperMass?.side === 'max'
    ? options.taperMass.side
    : 'cursor';
  const scope = options?.mirrorLocalX?.scope === 'cursorVolume' ? 'cursorVolume' : 'piece';
  const hasCustomCarveSeam = options?.carveSeam?.preserveRatio !== undefined
    || options?.carveSeam?.minVoxels !== undefined;

  return {
    strength,
    panelStripe: {
      thickness: clampInteger(
        options?.panelStripe?.thickness,
        1,
        16,
        defaults.panelStripeThickness
      ),
      overwriteExisting: options?.panelStripe?.overwriteExisting ?? true,
    },
    edgeAccent: {
      coverageRatio: clampFloat(
        options?.edgeAccent?.coverageRatio,
        0,
        1,
        defaults.edgeCoverageRatio
      ),
      minVoxels: clampInteger(
        options?.edgeAccent?.minVoxels,
        0,
        100000,
        defaults.edgeMinVoxels
      ),
      edgeMode,
    },
    carveSeam: {
      preserveRatio: clampFloat(
        options?.carveSeam?.preserveRatio,
        0,
        1,
        defaults.carvePreserveRatio
      ),
      minVoxels: clampInteger(
        options?.carveSeam?.minVoxels,
        0,
        100000,
        defaults.carveMinVoxels
      ),
      customized: hasCustomCarveSeam,
    },
    trimCorners: {
      removeRatio: clampFloat(
        options?.trimCorners?.removeRatio,
        0,
        1,
        defaults.trimRemoveRatio
      ),
      preserveRatio: clampFloat(
        options?.trimCorners?.preserveRatio,
        0,
        1,
        defaults.trimPreserveRatio
      ),
      cornerThreshold,
    },
    taperMass: {
      axis: normalizeAxisOption(options?.taperMass?.axis),
      side,
      depthRatio: clampFloat(
        options?.taperMass?.depthRatio,
        0,
        1,
        defaults.taperDepthRatio
      ),
      removeRatio: clampFloat(
        options?.taperMass?.removeRatio,
        0,
        1,
        defaults.taperRemoveRatio
      ),
      preserveRatio: clampFloat(
        options?.taperMass?.preserveRatio,
        0,
        1,
        defaults.taperPreserveRatio
      ),
    },
    mirrorLocalX: {
      scope,
      overwriteExisting: options?.mirrorLocalX?.overwriteExisting ?? false,
    },
  };
}

function isV3Draft(draft: CustomArmorPieceSnapshot): boolean {
  return getCustomArmorPieceModelSystem(draft) === 'v3' && SLOT_SET.has(draft.slot);
}

function getSlotBounds(draft: CustomArmorPieceSnapshot): EditableBounds | undefined {
  if (!isV3Draft(draft)) return undefined;
  const gridScale = getCustomArmorGridScale(draft);
  const dimensions = getV3CharacterPartBounds(draft.slot as V3CharacterSlotId).maxDimensions;
  return {
    minX: 0,
    maxX: (dimensions.x * gridScale) - 1,
    minY: 0,
    maxY: (dimensions.y * gridScale) - 1,
    minZ: 0,
    maxZ: (dimensions.z * gridScale) - 1,
  };
}

function getAxisMin(bounds: EditableBounds, axis: V3SmartAuthoringAxis): number {
  return axis === 'x' ? bounds.minX : axis === 'y' ? bounds.minY : bounds.minZ;
}

function getAxisMax(bounds: EditableBounds, axis: V3SmartAuthoringAxis): number {
  return axis === 'x' ? bounds.maxX : axis === 'y' ? bounds.maxY : bounds.maxZ;
}

function getCoord(
  voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>,
  axis: V3SmartAuthoringAxis
): number {
  return axis === 'x' ? voxel.x : axis === 'y' ? voxel.y : voxel.z;
}

function isInBounds(
  bounds: EditableBounds,
  voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>
): boolean {
  return voxel.x >= bounds.minX && voxel.x <= bounds.maxX
    && voxel.y >= bounds.minY && voxel.y <= bounds.maxY
    && voxel.z >= bounds.minZ && voxel.z <= bounds.maxZ;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
}

function sizeForAxis(
  context: V3SmartAuthoringContext,
  axis: V3SmartAuthoringAxis
): number {
  const value = axis === 'x' ? context.size.x : axis === 'y' ? context.size.y : context.size.z;
  return Math.max(1, Math.round(Number.isFinite(value) ? Math.abs(value) : 1));
}

function cursorForAxis(
  context: V3SmartAuthoringContext,
  axis: V3SmartAuthoringAxis
): number {
  return axis === 'x' ? context.cursor.x : axis === 'y' ? context.cursor.y : context.cursor.z;
}

function boundedRange(
  cursor: number,
  length: number,
  min: number,
  max: number
): [number, number] {
  const safeLength = Math.max(1, Math.round(length));
  const start = Math.round(cursor) - Math.floor((safeLength - 1) / 2);
  return [
    clamp(start, min, max),
    clamp(start + safeLength - 1, min, max),
  ];
}

function getSelectionBounds(
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  mode: 'line' | 'volume',
  lineThickness = 1
): EditableBounds {
  const ranges = new Map<V3SmartAuthoringAxis, [number, number]>();
  for (const axis of AXES) {
    const length = mode === 'line' && axis !== context.axis
      ? lineThickness
      : sizeForAxis(context, axis);
    ranges.set(axis, boundedRange(
      cursorForAxis(context, axis),
      length,
      getAxisMin(bounds, axis),
      getAxisMax(bounds, axis)
    ));
  }
  const x = ranges.get('x') ?? [bounds.minX, bounds.minX];
  const y = ranges.get('y') ?? [bounds.minY, bounds.minY];
  const z = ranges.get('z') ?? [bounds.minZ, bounds.minZ];
  return {
    minX: x[0],
    maxX: x[1],
    minY: y[0],
    maxY: y[1],
    minZ: z[0],
    maxZ: z[1],
  };
}

function isInsideSelection(
  selection: EditableBounds,
  voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>
): boolean {
  return voxel.x >= selection.minX && voxel.x <= selection.maxX
    && voxel.y >= selection.minY && voxel.y <= selection.maxY
    && voxel.z >= selection.minZ && voxel.z <= selection.maxZ;
}

function forEachCoord(
  selection: EditableBounds,
  callback: (coord: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>) => void
): void {
  for (let y = selection.minY; y <= selection.maxY; y++) {
    for (let z = selection.minZ; z <= selection.maxZ; z++) {
      for (let x = selection.minX; x <= selection.maxX; x++) {
        callback({ x, y, z });
      }
    }
  }
}

function activeVoxel(
  coord: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>,
  context: V3SmartAuthoringContext
): CustomArmorVoxel {
  const voxel: CustomArmorVoxel = {
    x: coord.x,
    y: coord.y,
    z: coord.z,
    role: context.role,
  };
  if (context.role === 'fixed') {
    voxel.color = context.fixedColor;
  }
  if (context.emissive) {
    voxel.emissive = true;
  }
  return voxel;
}

function withActiveRole(
  voxel: CustomArmorVoxel,
  context: V3SmartAuthoringContext
): CustomArmorVoxel {
  return activeVoxel(voxel, context);
}

function buildVoxelMap(voxels: readonly CustomArmorVoxel[]): Map<string, CustomArmorVoxel> {
  const map = new Map<string, CustomArmorVoxel>();
  for (const voxel of voxels) {
    map.set(coordKey(voxel), cloneVoxel(voxel));
  }
  return map;
}

function normalizeVoxels(
  voxels: readonly CustomArmorVoxel[],
  bounds: EditableBounds
): CustomArmorVoxel[] {
  return dedupeCustomArmorVoxels(voxels.filter((voxel) => isInBounds(bounds, voxel)).map(cloneVoxel));
}

function sameVoxels(a: readonly CustomArmorVoxel[], b: readonly CustomArmorVoxel[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.z !== right.z ||
      left.role !== right.role ||
      left.color !== right.color ||
      left.emissive !== right.emissive
    ) {
      return false;
    }
  }
  return true;
}

function sameVoxelMaterial(a: CustomArmorVoxel, b: CustomArmorVoxel): boolean {
  return a.role === b.role && a.color === b.color && a.emissive === b.emissive;
}

function toVoxelDiff(voxel: CustomArmorVoxel): V3SmartAuthoringVoxelDiff {
  const diff: V3SmartAuthoringVoxelDiff = {
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    role: voxel.role,
  };
  if (voxel.color !== undefined) {
    diff.color = voxel.color;
  }
  if (voxel.emissive !== undefined) {
    diff.emissive = voxel.emissive;
  }
  return diff;
}

function buildVoxelDiff(
  before: readonly CustomArmorVoxel[],
  after: readonly CustomArmorVoxel[]
): Pick<V3SmartAuthoringPreview, 'changed' | 'added' | 'removed' | 'remapped'> {
  const beforeMap = buildVoxelMap(before);
  const afterMap = buildVoxelMap(after);
  const added: V3SmartAuthoringVoxelDiff[] = [];
  const removed: V3SmartAuthoringVoxelDiff[] = [];
  const remapped: V3SmartAuthoringVoxelRemapDiff[] = [];

  for (const [key, afterVoxel] of afterMap) {
    const beforeVoxel = beforeMap.get(key);
    if (!beforeVoxel) {
      added.push(toVoxelDiff(afterVoxel));
    } else if (!sameVoxelMaterial(beforeVoxel, afterVoxel)) {
      remapped.push({
        before: toVoxelDiff(beforeVoxel),
        after: toVoxelDiff(afterVoxel),
      });
    }
  }

  for (const [key, beforeVoxel] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(toVoxelDiff(beforeVoxel));
    }
  }

  added.sort(stableVoxelSort);
  removed.sort(stableVoxelSort);
  remapped.sort((a, b) => stableVoxelSort(a.after, b.after));

  return {
    changed: added.length > 0 || removed.length > 0 || remapped.length > 0,
    added,
    removed,
    remapped,
  };
}

function commitVoxels(
  draft: CustomArmorPieceSnapshot,
  voxels: readonly CustomArmorVoxel[],
  context: V3SmartAuthoringContext,
  bounds: EditableBounds
): CustomArmorPieceSnapshot {
  const current = normalizeVoxels(draft.voxels, bounds);
  const next = normalizeVoxels(voxels, bounds);
  if (sameVoxels(current, next)) return draft;

  const candidate: CustomArmorPieceSnapshot = {
    ...draft,
    voxels: next,
    updatedAt: context.now ?? draft.updatedAt,
  };

  if (validateCustomArmorPiece(draft).valid && !validateCustomArmorPiece(candidate).valid) {
    return draft;
  }

  return candidate;
}

function exposureScore(
  voxel: CustomArmorVoxel,
  occupied: ReadonlySet<string>,
  bounds: EditableBounds
): number {
  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;

  return neighbors.reduce((score, [dx, dy, dz]) => {
    const neighbor = { x: voxel.x + dx, y: voxel.y + dy, z: voxel.z + dz };
    return !isInBounds(bounds, neighbor) || !occupied.has(coordKey(neighbor)) ? score + 1 : score;
  }, 0);
}

function isBoundsEdge(voxel: CustomArmorVoxel, bounds: EditableBounds): boolean {
  return voxel.x === bounds.minX || voxel.x === bounds.maxX
    || voxel.y === bounds.minY || voxel.y === bounds.maxY
    || voxel.z === bounds.minZ || voxel.z === bounds.maxZ;
}

function distanceToCursor(
  voxel: CustomArmorVoxel,
  context: V3SmartAuthoringContext
): number {
  return Math.abs(voxel.x - context.cursor.x)
    + Math.abs(voxel.y - context.cursor.y)
    + Math.abs(voxel.z - context.cursor.z);
}

function stableVoxelSort(a: CustomArmorVoxel, b: CustomArmorVoxel): number {
  return a.y !== b.y ? a.y - b.y : a.z !== b.z ? a.z - b.z : a.x - b.x;
}

function panelStripe(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const selection = getSelectionBounds(context, bounds, 'line', options.panelStripe.thickness);
  const map = buildVoxelMap(draft.voxels);
  forEachCoord(selection, (coord) => {
    if (!options.panelStripe.overwriteExisting && map.has(coordKey(coord))) return;
    map.set(coordKey(coord), activeVoxel(coord, context));
  });
  return commitVoxels(draft, [...map.values()], context, bounds);
}

function edgeAccent(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const voxels = normalizeVoxels(draft.voxels, bounds);
  const selection = getSelectionBounds(context, bounds, 'volume');
  const occupied = new Set(voxels.map(coordKey));
  const candidates = voxels
    .filter((voxel) => isInsideSelection(selection, voxel))
    .filter((voxel) => {
      const boundsEdge = isBoundsEdge(voxel, bounds);
      const exposed = exposureScore(voxel, occupied, bounds) > 0;
      switch (options.edgeAccent.edgeMode) {
        case 'bounds-only':
          return boundsEdge;
        case 'exposed-only':
          return exposed;
        default:
          return boundsEdge || exposed;
      }
    })
    .sort((a, b) => (
      (isBoundsEdge(b, bounds) ? 1 : 0) - (isBoundsEdge(a, bounds) ? 1 : 0) ||
      exposureScore(b, occupied, bounds) - exposureScore(a, occupied, bounds) ||
      distanceToCursor(a, context) - distanceToCursor(b, context) ||
      stableVoxelSort(a, b)
    ));

  if (candidates.length === 0) {
    if (options.edgeAccent.edgeMode !== 'exposed-or-bounds') return draft;
    const fallback = getSelectionBounds({
      ...context,
      size: {
        x: context.axis === 'x' ? Math.max(2, Math.min(4, sizeForAxis(context, 'x'))) : 1,
        y: context.axis === 'y' ? Math.max(2, Math.min(4, sizeForAxis(context, 'y'))) : 1,
        z: context.axis === 'z' ? Math.max(2, Math.min(4, sizeForAxis(context, 'z'))) : 1,
      },
    }, bounds, 'line');
    const map = buildVoxelMap(voxels);
    forEachCoord(fallback, (coord) => {
      map.set(coordKey(coord), activeVoxel(coord, context));
    });
    return commitVoxels(draft, [...map.values()], context, bounds);
  }

  const remapTarget = Math.max(
    options.edgeAccent.minVoxels,
    Math.ceil(candidates.length * options.edgeAccent.coverageRatio)
  );
  const remapCount = Math.min(candidates.length, remapTarget);
  if (remapCount <= 0) return draft;
  const selected = new Set(candidates.slice(0, remapCount).map(coordKey));
  return commitVoxels(
    draft,
    voxels.map((voxel) => selected.has(coordKey(voxel)) ? withActiveRole(voxel, context) : voxel),
    context,
    bounds
  );
}

function carveSeam(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const voxels = normalizeVoxels(draft.voxels, bounds);
  const selection = getSelectionBounds(context, bounds, 'volume');
  const removable = voxels.filter((voxel) => isInsideSelection(selection, voxel));
  if (removable.length === 0) return draft;

  const safeFloor = Math.max(
    options.carveSeam.minVoxels,
    Math.ceil(voxels.length * options.carveSeam.preserveRatio)
  );
  if (!options.carveSeam.customized) {
    const next = voxels.filter((voxel) => !isInsideSelection(selection, voxel));
    if (next.length < safeFloor || next.length === voxels.length) return draft;
    return commitVoxels(draft, next, context, bounds);
  }

  const removeCount = Math.min(removable.length, Math.max(0, voxels.length - safeFloor));
  if (removeCount <= 0) return draft;

  const removeKeys = new Set(removable.sort(stableVoxelSort).slice(0, removeCount).map(coordKey));
  return commitVoxels(draft, voxels.filter((voxel) => !removeKeys.has(coordKey(voxel))), context, bounds);
}

function cornerScore(
  voxel: CustomArmorVoxel,
  bounds: NonNullable<ReturnType<typeof getCustomArmorBounds>>
): number {
  return (
    (voxel.x === bounds.minX || voxel.x === bounds.maxX ? 1 : 0) +
    (voxel.y === bounds.minY || voxel.y === bounds.maxY ? 1 : 0) +
    (voxel.z === bounds.minZ || voxel.z === bounds.maxZ ? 1 : 0)
  );
}

function trimCorners(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const voxels = normalizeVoxels(draft.voxels, bounds);
  const draftBounds = getCustomArmorBounds(voxels);
  if (!draftBounds || voxels.length < 16) return draft;
  const safeFloor = Math.ceil(voxels.length * options.trimCorners.preserveRatio);
  const removable = voxels
    .filter((voxel) => cornerScore(voxel, draftBounds) >= options.trimCorners.cornerThreshold)
    .sort((a, b) => (
      cornerScore(b, draftBounds) - cornerScore(a, draftBounds) ||
      b.y - a.y ||
      b.z - a.z ||
      a.x - b.x
    ));
  const removeTarget = options.trimCorners.removeRatio <= 0
    ? 0
    : Math.max(1, Math.ceil(voxels.length * options.trimCorners.removeRatio));
  const removeCount = Math.min(
    removable.length,
    voxels.length - safeFloor,
    removeTarget
  );
  if (removeCount <= 0) return draft;

  const removeKeys = new Set(removable.slice(0, removeCount).map(coordKey));
  return commitVoxels(draft, voxels.filter((voxel) => !removeKeys.has(coordKey(voxel))), context, bounds);
}

function largestSpanAxis(
  bounds: NonNullable<ReturnType<typeof getCustomArmorBounds>>
): V3SmartAuthoringAxis {
  const spans = {
    x: bounds.maxX - bounds.minX + 1,
    y: bounds.maxY - bounds.minY + 1,
    z: bounds.maxZ - bounds.minZ + 1,
  };
  return AXES.reduce((best, axis) => (spans[axis] > spans[best] ? axis : best), 'x');
}

function taperMass(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const voxels = normalizeVoxels(draft.voxels, bounds);
  const draftBounds = getCustomArmorBounds(voxels);
  if (!draftBounds || voxels.length < 16) return draft;

  const axis = options.taperMass.axis === 'auto'
    ? largestSpanAxis(draftBounds)
    : options.taperMass.axis;
  const min = getAxisMin(draftBounds, axis);
  const max = getAxisMax(draftBounds, axis);
  const span = max - min + 1;
  const center = (min + max) / 2;
  const removeFromMax = options.taperMass.side === 'max'
    || (options.taperMass.side === 'cursor' && cursorForAxis(context, axis) >= center);
  const depth = Math.max(1, Math.floor(span * options.taperMass.depthRatio));
  const safeFloor = Math.ceil(voxels.length * options.taperMass.preserveRatio);
  const perpendicular = AXES.filter((candidate) => candidate !== axis);

  const centerFor = (candidate: V3SmartAuthoringAxis): number => (
    (getAxisMin(draftBounds, candidate) + getAxisMax(draftBounds, candidate)) / 2
  );
  const candidates = voxels
    .filter((voxel) => (
      removeFromMax
        ? getCoord(voxel, axis) >= max - depth + 1
        : getCoord(voxel, axis) <= min + depth - 1
    ))
    .sort((a, b) => {
      const axisDistanceA = removeFromMax ? max - getCoord(a, axis) : getCoord(a, axis) - min;
      const axisDistanceB = removeFromMax ? max - getCoord(b, axis) : getCoord(b, axis) - min;
      const edgeDistanceA = perpendicular.reduce((score, candidate) => (
        score + Math.abs(getCoord(a, candidate) - centerFor(candidate))
      ), 0);
      const edgeDistanceB = perpendicular.reduce((score, candidate) => (
        score + Math.abs(getCoord(b, candidate) - centerFor(candidate))
      ), 0);
      return axisDistanceA - axisDistanceB ||
        edgeDistanceB - edgeDistanceA ||
        b.y - a.y ||
        b.z - a.z ||
        a.x - b.x;
    });
  const removeTarget = options.taperMass.removeRatio <= 0
    ? 0
    : Math.max(1, Math.ceil(voxels.length * options.taperMass.removeRatio));
  const removeCount = Math.min(
    candidates.length,
    voxels.length - safeFloor,
    removeTarget
  );
  if (removeCount <= 0) return draft;

  const removeKeys = new Set(candidates.slice(0, removeCount).map(coordKey));
  return commitVoxels(draft, voxels.filter((voxel) => !removeKeys.has(coordKey(voxel))), context, bounds);
}

function mirrorLocalX(
  draft: CustomArmorPieceSnapshot,
  context: V3SmartAuthoringContext,
  bounds: EditableBounds,
  options: NormalizedV3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  const voxels = normalizeVoxels(draft.voxels, bounds);
  const map = buildVoxelMap(voxels);
  const selection = options.mirrorLocalX.scope === 'cursorVolume'
    ? getSelectionBounds(context, bounds, 'volume')
    : undefined;
  const source = selection
    ? voxels.filter((voxel) => isInsideSelection(selection, voxel))
    : voxels;
  for (const voxel of source) {
    const mirrored: CustomArmorVoxel = {
      ...voxel,
      x: bounds.minX + bounds.maxX - voxel.x,
    };
    const key = coordKey(mirrored);
    if (options.mirrorLocalX.overwriteExisting || !map.has(key)) {
      map.set(key, mirrored);
    }
  }
  return commitVoxels(draft, [...map.values()], context, bounds);
}

export function applyV3SmartAuthoringTool(
  draft: CustomArmorPieceSnapshot,
  toolId: V3ArmorSmartToolId,
  context: V3SmartAuthoringContext,
  options?: V3SmartAuthoringOptions
): CustomArmorPieceSnapshot {
  if (!isV3Draft(draft)) {
    return cloneDraft(draft);
  }

  const bounds = getSlotBounds(draft);
  if (!bounds) return draft;
  const normalizedOptions = normalizeSmartAuthoringOptions(options);

  switch (toolId) {
    case 'panelStripe':
      return panelStripe(draft, context, bounds, normalizedOptions);
    case 'edgeAccent':
      return edgeAccent(draft, context, bounds, normalizedOptions);
    case 'carveSeam':
      return carveSeam(draft, context, bounds, normalizedOptions);
    case 'trimCorners':
      return trimCorners(draft, context, bounds, normalizedOptions);
    case 'taperMass':
      return taperMass(draft, context, bounds, normalizedOptions);
    case 'mirrorLocalX':
      return mirrorLocalX(draft, context, bounds, normalizedOptions);
    default:
      return draft;
  }
}

export function buildV3SmartAuthoringPreview(
  draft: CustomArmorPieceSnapshot,
  toolId: V3ArmorSmartToolId,
  context: V3SmartAuthoringContext,
  options?: V3SmartAuthoringOptions
): V3SmartAuthoringPreview {
  const applied = applyV3SmartAuthoringTool(draft, toolId, context, options);
  const previewDraft: CustomArmorPieceSnapshot = {
    ...applied,
    voxels: applied.voxels.map(cloneVoxel),
    updatedAt: draft.updatedAt,
  };
  const diff = buildVoxelDiff(draft.voxels, previewDraft.voxels);

  return {
    toolId,
    previewDraft,
    ...diff,
  };
}
