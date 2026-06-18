import { createHash } from 'node:crypto';
import {
  V3_AEGIS_PART_SPECS,
  type V3BuiltinPartGridScale,
} from '../components/v3/v3AegisSuitParts';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3PaintRole,
} from '../components/v3/v3ModelTypes';
import {
  parseV3ObjMetadata,
  type V3Bounds,
  type V3ObjMetadata,
  type V3ObjTriangleMetadata,
  type V3Vec3,
} from './v3ObjParser';

export type V3ObjVoxelRole = V3PaintRole;

export interface V3ObjVoxelizerInput {
  objText?: string;
  metadata?: V3ObjMetadata;
  fileName?: string;
  gridScale?: number;
}

export interface V3ObjVoxelRun {
  y: number;
  z: number;
  xStart: number;
  xEnd: number;
  role: V3ObjVoxelRole;
  emissive?: true;
}

export interface V3ObjVoxel {
  x: number;
  y: number;
  z: number;
  role: V3ObjVoxelRole;
  emissive?: true;
}

export interface V3ObjVoxelSlotArtifact {
  slot: V3CharacterSlotId;
  gridScale: number;
  dimensions: [number, number, number];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  roleHints: V3ObjVoxelRole[];
  voxelCount: number;
  runCount: number;
  runs: V3ObjVoxelRun[];
}

export interface V3ObjVoxelizationArtifact {
  schemaVersion: 'v3-obj-voxelization/v1';
  version: 1;
  source: {
    kind: 'obj';
    fileName: string | null;
    hash: string;
    objectCount: number;
    triangleCountEstimate: number;
    materialCount: number;
  };
  gridScale: number;
  slots: Record<V3CharacterSlotId, V3ObjVoxelSlotArtifact>;
  metrics: {
    slotCount: number;
    totalVoxelCount: number;
    totalRunCount: number;
    maxSlotVoxelCount: number;
    sourceTriangleCount: number;
  };
}

export interface V3ObjVoxelArtifactSummary {
  slotCount: number;
  gridScale: number;
  totalVoxelCount: number;
  totalRunCount: number;
  sourceHash: string;
}

type MutableSlot = {
  slot: V3CharacterSlotId;
  dimensions: [number, number, number];
  samples: V3VoxelSample[];
};

type V3VoxelSample = {
  point: V3Vec3;
  role: V3ObjVoxelRole;
  emissive?: true;
};

const DEFAULT_GRID_SCALE = 4;
const SAMPLE_STEPS = 2;
const PAIR_SLOTS = new Set<V3CharacterSlotId>([
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'footLeft',
  'footRight',
]);

export function buildV3ObjVoxelizationArtifact(input: V3ObjVoxelizerInput): V3ObjVoxelizationArtifact {
  const metadata = input.metadata ?? parseV3ObjMetadata(input.objText ?? '');
  const gridScale = normalizeGridScale(input.gridScale);
  const sourceHash = hashMetadata(metadata);
  const slots = createMutableSlots(gridScale);
  const referenceBounds = metadata.bounds;
  const referenceHeight = safePositive(boundsSize(referenceBounds, 1));

  for (const triangle of metadata.triangles) {
    for (const sample of sampleTriangle(triangle)) {
      const slot = resolveSlotForSample(triangle, sample, referenceBounds, referenceHeight);
      const mutableSlot = slots.get(slot);
      if (!mutableSlot) continue;
      mutableSlot.samples.push({
        point: sample,
        role: resolveRoleForTriangle(triangle),
        emissive: isEmissiveTriangle(triangle) ? true : undefined,
      });
    }
  }

  const artifacts = Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => {
    const mutableSlot = slots.get(slot);
    if (!mutableSlot) throw new Error(`Missing V3 OBJ voxel slot ${slot}`);
    const slotArtifact = buildSlotArtifact(mutableSlot);
    return [slot, slotArtifact];
  })) as Record<V3CharacterSlotId, V3ObjVoxelSlotArtifact>;

  const totalVoxelCount = Object.values(artifacts).reduce((sum, slot) => sum + slot.voxelCount, 0);
  const totalRunCount = Object.values(artifacts).reduce((sum, slot) => sum + slot.runCount, 0);
  const maxSlotVoxelCount = Math.max(...Object.values(artifacts).map((slot) => slot.voxelCount), 0);

  return {
    schemaVersion: 'v3-obj-voxelization/v1',
    version: 1,
    source: {
      kind: 'obj',
      fileName: sanitizeFileName(input.fileName),
      hash: sourceHash,
      objectCount: metadata.objects.length,
      triangleCountEstimate: metadata.triangleCountEstimate,
      materialCount: metadata.materials.length,
    },
    gridScale,
    slots: artifacts,
    metrics: {
      slotCount: V3_CHARACTER_SLOT_IDS.length,
      totalVoxelCount,
      totalRunCount,
      maxSlotVoxelCount,
      sourceTriangleCount: metadata.triangleCountEstimate,
    },
  };
}

export function expandV3ObjVoxelRuns(slot: V3ObjVoxelSlotArtifact): V3ObjVoxel[] {
  const voxels: V3ObjVoxel[] = [];
  for (const run of slot.runs) {
    for (let x = run.xStart; x <= run.xEnd; x += 1) {
      voxels.push({
        x,
        y: run.y,
        z: run.z,
        role: run.role,
        emissive: run.emissive,
      });
    }
  }
  return voxels;
}

export function summarizeV3ObjVoxelArtifact(
  artifact: V3ObjVoxelizationArtifact
): V3ObjVoxelArtifactSummary {
  return {
    slotCount: Object.keys(artifact.slots).length,
    gridScale: artifact.gridScale,
    totalVoxelCount: artifact.metrics.totalVoxelCount,
    totalRunCount: artifact.metrics.totalRunCount,
    sourceHash: artifact.source.hash,
  };
}

function createMutableSlots(gridScale: number): Map<V3CharacterSlotId, MutableSlot> {
  return new Map(V3_CHARACTER_SLOT_IDS.map((slot) => {
    const spec = V3_AEGIS_PART_SPECS[slot];
    return [slot, {
      slot,
      dimensions: [
        spec.dimensions[0] * gridScale,
        spec.dimensions[1] * gridScale,
        spec.dimensions[2] * gridScale,
      ],
      samples: [],
    }];
  }));
}

function buildSlotArtifact(slot: MutableSlot): V3ObjVoxelSlotArtifact {
  const samples = slot.samples.length > 0 ? slot.samples : [{
    point: [0, 0, 0] as V3Vec3,
    role: 'undersuit' as V3ObjVoxelRole,
  }];
  const sampleBounds = boundsFromSamples(samples);
  const voxelMap = new Map<string, V3ObjVoxel>();

  for (const sample of samples) {
    const base = mapSampleToSlotVoxel(sample.point, sampleBounds, slot);
    for (const voxel of dilateVoxel(base, slot.dimensions, sample.role, sample.emissive)) {
      setPreferredVoxel(voxelMap, voxel);
    }
  }

  const decoratedMap = new Map<string, V3ObjVoxel>();
  for (const voxel of voxelMap.values()) {
    setPreferredVoxel(decoratedMap, decorateSlotVoxel(slot.slot, voxel, slot.dimensions));
  }

  const voxels = [...decoratedMap.values()].sort(compareVoxels);
  const bounds = boundsFromVoxels(voxels, slot.dimensions);
  const runs = encodeRuns(voxels);
  const roleHints = [...new Set(voxels.map((voxel) => voxel.role))].sort() as V3ObjVoxelRole[];

  return {
    slot: slot.slot,
    gridScale: slot.dimensions[0] / V3_AEGIS_PART_SPECS[slot.slot].dimensions[0],
    dimensions: slot.dimensions,
    bounds,
    roleHints,
    voxelCount: voxels.length,
    runCount: runs.length,
    runs,
  };
}

function sampleTriangle(triangle: V3ObjTriangleMetadata): V3Vec3[] {
  const samples: V3Vec3[] = [];
  for (let i = 0; i <= SAMPLE_STEPS; i += 1) {
    for (let j = 0; j <= SAMPLE_STEPS - i; j += 1) {
      const u = i / SAMPLE_STEPS;
      const v = j / SAMPLE_STEPS;
      const w = 1 - u - v;
      samples.push([
        triangle.a[0] * u + triangle.b[0] * v + triangle.c[0] * w,
        triangle.a[1] * u + triangle.b[1] * v + triangle.c[1] * w,
        triangle.a[2] * u + triangle.b[2] * v + triangle.c[2] * w,
      ]);
    }
  }
  return samples;
}

function resolveSlotForSample(
  triangle: V3ObjTriangleMetadata,
  point: V3Vec3,
  referenceBounds: V3Bounds | null,
  referenceHeight: number
): V3CharacterSlotId {
  const objectName = triangle.objectName.toLowerCase();
  const materialName = (triangle.materialName ?? '').toLowerCase();
  const yRatio = referenceBounds
    ? (point[1] - referenceBounds.min[1]) / referenceHeight
    : 0.5;
  const isLeft = point[0] >= 0;

  if (objectName.includes('helmet')) return 'helmet';
  if (objectName.includes('equipment') || objectName.includes('pack')) return 'back';
  if (objectName.includes('knee')) return isLeft ? 'shinLeft' : 'shinRight';
  if (objectName.includes('arm')) {
    if (materialName.includes('glove') || yRatio < 0.5) return isLeft ? 'handLeft' : 'handRight';
    if (yRatio < 0.62) return isLeft ? 'forearmLeft' : 'forearmRight';
    if (yRatio < 0.78) return isLeft ? 'upperArmLeft' : 'upperArmRight';
    return isLeft ? 'shoulderLeft' : 'shoulderRight';
  }

  if (yRatio >= 0.86) return 'neck';
  if (yRatio >= 0.66) return point[2] < -0.12 ? 'back' : 'chest';
  if (yRatio >= 0.52) return 'pelvis';
  if (yRatio >= 0.34) return isLeft ? 'thighLeft' : 'thighRight';
  if (yRatio >= 0.15) return isLeft ? 'shinLeft' : 'shinRight';
  return isLeft ? 'footLeft' : 'footRight';
}

function resolveRoleForTriangle(triangle: V3ObjTriangleMetadata): V3ObjVoxelRole {
  const materialName = (triangle.materialName ?? '').toLowerCase();
  if (materialName.includes('visor')) return 'visor';
  if (materialName.includes('rubber') || materialName.includes('interior')) return 'undersuit';
  if (materialName.includes('decal')) return 'decal';
  if (materialName.includes('shield') || materialName.includes('display')) return 'emissive';
  if (materialName.includes('equipment') || materialName.includes('knife') || materialName.includes('robot')) return 'fixed';
  if (materialName.includes('aug') || materialName.includes('fp_armor')) return 'secondary';
  if (materialName.includes('glove')) return 'fixed';
  return 'primary';
}

function isEmissiveTriangle(triangle: V3ObjTriangleMetadata): boolean {
  const materialName = (triangle.materialName ?? '').toLowerCase();
  return materialName.includes('visor') || materialName.includes('shield') || materialName.includes('display');
}

function mapSampleToSlotVoxel(
  point: V3Vec3,
  sampleBounds: V3Bounds,
  slot: MutableSlot
): [number, number, number] {
  const [width, height, depth] = slot.dimensions;
  const xRatio = normalizedAxis(point[0], sampleBounds, 0);
  const yRatio = normalizedAxis(point[1], sampleBounds, 1);
  const zRatio = normalizedAxis(point[2], sampleBounds, 2);
  const x = PAIR_SLOTS.has(slot.slot) && slot.slot.endsWith('Right')
    ? width - 1 - toGridIndex(xRatio, width)
    : toGridIndex(xRatio, width);

  return [
    x,
    toGridIndex(yRatio, height),
    toGridIndex(zRatio, depth),
  ];
}

function dilateVoxel(
  base: [number, number, number],
  dimensions: [number, number, number],
  role: V3ObjVoxelRole,
  emissive?: true
): V3ObjVoxel[] {
  const voxels: V3ObjVoxel[] = [];
  const radius = role === 'visor' || role === 'emissive' ? 0 : 1;
  for (let dx = -radius; dx <= radius; dx += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) continue;
        const x = base[0] + dx;
        const y = base[1] + dy;
        const z = base[2] + dz;
        if (
          x < 0 || x >= dimensions[0] ||
          y < 0 || y >= dimensions[1] ||
          z < 0 || z >= dimensions[2]
        ) continue;
        voxels.push({ x, y, z, role, emissive });
      }
    }
  }
  return voxels;
}

function encodeRuns(voxels: V3ObjVoxel[]): V3ObjVoxelRun[] {
  const runs: V3ObjVoxelRun[] = [];
  const sorted = [...voxels].sort(compareVoxels);
  let current: V3ObjVoxelRun | undefined;

  for (const voxel of sorted) {
    if (
      current &&
      current.y === voxel.y &&
      current.z === voxel.z &&
      current.role === voxel.role &&
      current.emissive === voxel.emissive &&
      current.xEnd + 1 === voxel.x
    ) {
      current.xEnd = voxel.x;
      continue;
    }

    current = {
      y: voxel.y,
      z: voxel.z,
      xStart: voxel.x,
      xEnd: voxel.x,
      role: voxel.role,
      emissive: voxel.emissive,
    };
    runs.push(current);
  }

  return runs;
}

function compareVoxels(left: V3ObjVoxel, right: V3ObjVoxel): number {
  return (
    left.role.localeCompare(right.role) ||
    Number(left.emissive === true) - Number(right.emissive === true) ||
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x
  );
}

function boundsFromSamples(samples: readonly V3VoxelSample[]): V3Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const sample of samples) {
    minX = Math.min(minX, sample.point[0]);
    minY = Math.min(minY, sample.point[1]);
    minZ = Math.min(minZ, sample.point[2]);
    maxX = Math.max(maxX, sample.point[0]);
    maxY = Math.max(maxY, sample.point[1]);
    maxZ = Math.max(maxZ, sample.point[2]);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function boundsFromVoxels(
  voxels: readonly V3ObjVoxel[],
  dimensions: [number, number, number]
): V3ObjVoxelSlotArtifact['bounds'] {
  if (voxels.length === 0) {
    return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const voxel of voxels) {
    min[0] = Math.min(min[0], voxel.x);
    min[1] = Math.min(min[1], voxel.y);
    min[2] = Math.min(min[2], voxel.z);
    max[0] = Math.max(max[0], voxel.x);
    max[1] = Math.max(max[1], voxel.y);
    max[2] = Math.max(max[2], voxel.z);
  }
  return {
    min,
    max,
    size: [
      Math.min(dimensions[0], max[0] - min[0] + 1),
      Math.min(dimensions[1], max[1] - min[1] + 1),
      Math.min(dimensions[2], max[2] - min[2] + 1),
    ],
  };
}

function normalizedAxis(value: number, bounds: V3Bounds, axis: 0 | 1 | 2): number {
  const min = bounds.min[axis];
  const max = bounds.max[axis];
  const span = max - min;
  if (!Number.isFinite(span) || Math.abs(span) < 0.000001) return 0.5;
  return clamp((value - min) / span, 0, 1);
}

function toGridIndex(ratio: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.round(ratio * (size - 1))));
}

function voxelKey(voxel: V3ObjVoxel): string {
  return `${voxel.x}:${voxel.y}:${voxel.z}`;
}

function setPreferredVoxel(map: Map<string, V3ObjVoxel>, voxel: V3ObjVoxel): void {
  const key = voxelKey(voxel);
  const current = map.get(key);
  if (!current || rolePriority(voxel) >= rolePriority(current)) {
    map.set(key, voxel);
  }
}

function rolePriority(voxel: V3ObjVoxel): number {
  if (voxel.emissive === true || voxel.role === 'visor' || voxel.role === 'emissive') return 8;
  if (voxel.role === 'fixed') return 7;
  if (voxel.role === 'decal') return 6;
  if (voxel.role === 'accent') return 5;
  if (voxel.role === 'secondary') return 4;
  if (voxel.role === 'undersuit') return 3;
  return 2;
}

function decorateSlotVoxel(
  slot: V3CharacterSlotId,
  voxel: V3ObjVoxel,
  dimensions: [number, number, number]
): V3ObjVoxel {
  if (voxel.emissive === true || voxel.role === 'visor' || voxel.role === 'emissive' || voxel.role === 'decal') {
    return voxel;
  }

  const [width, height, depth] = dimensions;
  const sideBand = Math.max(1, Math.floor(width * 0.16));
  const rearBand = Math.max(1, Math.floor(depth * 0.16));
  const frontBand = Math.max(1, Math.floor(depth * 0.16));
  const isSide = voxel.x <= sideBand || voxel.x >= width - 1 - sideBand;
  const isRear = voxel.z <= rearBand;
  const isFront = voxel.z >= depth - 1 - frontBand;
  const isUpper = voxel.y >= Math.floor(height * 0.62);
  const isLower = voxel.y <= Math.floor(height * 0.28);
  const isCenterStripe = Math.abs(voxel.x - (width - 1) / 2) <= Math.max(0.5, width * 0.08);

  if (slot === 'handLeft' || slot === 'handRight') {
    if (isSide || isRear) return { ...voxel, role: 'undersuit', emissive: undefined };
    if (isUpper && isFront) return { ...voxel, role: 'accent', emissive: undefined };
    return { ...voxel, role: 'fixed', emissive: undefined };
  }

  if (slot === 'forearmLeft' || slot === 'forearmRight') {
    if (isSide || isRear) return { ...voxel, role: 'undersuit', emissive: undefined };
    if (isLower && isFront) return { ...voxel, role: 'accent', emissive: undefined };
    if (isUpper && isFront) return { ...voxel, role: 'secondary', emissive: undefined };
    return voxel;
  }

  if (slot === 'shoulderLeft' || slot === 'shoulderRight') {
    if (isSide || isRear) return { ...voxel, role: 'accent', emissive: undefined };
    if (isUpper && isFront) return { ...voxel, role: 'secondary', emissive: undefined };
    return voxel;
  }

  if (
    slot === 'upperArmLeft' ||
    slot === 'upperArmRight' ||
    slot === 'thighLeft' ||
    slot === 'thighRight' ||
    slot === 'shinLeft' ||
    slot === 'shinRight' ||
    slot === 'footLeft' ||
    slot === 'footRight'
  ) {
    if (isSide || isRear) return { ...voxel, role: 'undersuit', emissive: undefined };
    if (isCenterStripe && isFront) return { ...voxel, role: 'accent', emissive: undefined };
    if (isUpper && isFront) return { ...voxel, role: 'secondary', emissive: undefined };
  }

  return voxel;
}

function normalizeGridScale(value: number | undefined): V3BuiltinPartGridScale {
  const rounded = Math.max(3, Math.min(6, Math.round(value ?? DEFAULT_GRID_SCALE)));
  return Math.min(4, rounded) as V3BuiltinPartGridScale;
}

function hashMetadata(metadata: V3ObjMetadata): string {
  const safeSummary = {
    objectCount: metadata.objects.length,
    materialCount: metadata.materials.length,
    vertexCount: metadata.vertexCount,
    faceCount: metadata.faceCount,
    triangleCountEstimate: metadata.triangleCountEstimate,
    bounds: metadata.bounds,
    objects: metadata.objects.map((object) => ({
      name: object.name,
      materialNames: object.materialNames,
      faceCount: object.faceCount,
      bounds: object.bounds,
    })),
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(safeSummary)).digest('hex')}`;
}

function sanitizeFileName(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/').split('/').pop()?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function boundsSize(bounds: V3Bounds | null, axis: 0 | 1 | 2): number {
  if (!bounds) return 0;
  return bounds.max[axis] - bounds.min[axis];
}

function safePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
