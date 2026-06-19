import { createHash } from 'node:crypto';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
  type V3PaintRole,
} from '../components/v3/v3ModelTypes';
import {
  parseV3ObjMetadata,
  type V3Bounds,
  type V3MtlMaterialSummary,
  type V3ObjMetadata,
  type V3ObjTriangleMetadata,
  type V3Vec3,
} from './v3ObjParser';
import {
  classifyV3ReferencePart,
  type V3CandidateSlot,
} from './v3VoxelPartClassifier';

export const V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA = 'v3-obj-surface-voxels/v1' as const;
export const V3_OBJ_SURFACE_DEFAULT_TARGET_HEIGHT_VOXELS = 192;
export const V3_OBJ_SURFACE_DEFAULT_THICKNESS_VOXELS = 1;
export const V3_OBJ_SURFACE_WORLD_HEIGHT = 1.84;

export type V3ObjSurfaceVoxelRole = V3PaintRole;

export interface V3ObjSurfaceVoxelizerInput {
  objText?: string;
  mtlText?: string;
  metadata?: V3ObjMetadata;
  fileName?: string;
}

export interface V3ObjSurfaceVoxelizationOptions {
  targetHeightVoxels?: number;
  surfaceThicknessVoxels?: 0 | 1 | 2;
  includeUnknownObjects?: boolean;
}

export interface V3ObjSurfaceVoxelRun {
  y: number;
  z: number;
  xStart: number;
  xEnd: number;
  role: V3ObjSurfaceVoxelRole;
  emissive?: true;
}

export interface V3ObjSurfaceVoxel {
  x: number;
  y: number;
  z: number;
  slot: V3CharacterSlotId;
  role: V3ObjSurfaceVoxelRole;
  emissive?: true;
}

export interface V3ObjSurfaceVoxelSlotArtifact {
  slot: V3CharacterSlotId;
  voxelCount: number;
  runCount: number;
  roleHints: V3ObjSurfaceVoxelRole[];
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  };
  runs: V3ObjSurfaceVoxelRun[];
}

export interface V3ObjSurfaceVoxelizationArtifact {
  schemaVersion: typeof V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA;
  version: 1;
  source: {
    kind: 'obj';
    fileName: string | null;
    hash: string;
    objectCount: number;
    triangleCountEstimate: number;
    materialCount: number;
  };
  options: {
    targetHeightVoxels: number;
    surfaceThicknessVoxels: 0 | 1 | 2;
    includeUnknownObjects: boolean;
  };
  coordinateSystem: {
    targetHeightVoxels: number;
    voxelScale: number;
    dimensions: [number, number, number];
    origin: [number, number, number];
    pivot: [number, number, number];
    normalizedBounds: {
      min: [number, number, number];
      max: [number, number, number];
      size: [number, number, number];
    };
  };
  rolePalette: V3ObjSurfaceVoxelRole[];
  slots: Record<V3CharacterSlotId, V3ObjSurfaceVoxelSlotArtifact>;
  metrics: {
    slotCount: number;
    totalVoxelCount: number;
    totalRunCount: number;
    maxSlotVoxelCount: number;
    sourceTriangleCount: number;
    bodyObjectCount: number;
    excludedObjectCount: number;
  };
  excludedObjects: string[];
}

export interface V3ObjSurfaceVoxelArtifactSummary {
  schemaVersion: typeof V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA;
  slotCount: number;
  targetHeightVoxels: number;
  surfaceThicknessVoxels: number;
  voxelScale: number;
  totalVoxelCount: number;
  totalRunCount: number;
  sourceHash: string;
}

type MutableSurfaceVoxel = V3ObjSurfaceVoxel;

type SurfaceVoxelKey = `${number}:${number}:${number}`;

const ROLE_PRIORITY: Record<V3ObjSurfaceVoxelRole, number> = {
  primary: 0,
  decal: 1,
  accent: 2,
  secondary: 3,
  fixed: 4,
  undersuit: 5,
  emissive: 6,
  visor: 7,
};

const NON_BODY_SLOT_SET = new Set<V3CandidateSlot>(['weapon', 'hammer', 'sword', 'pistol', 'unknown']);

export function buildV3ObjSurfaceVoxelizationArtifact(
  input: V3ObjSurfaceVoxelizerInput,
  options: V3ObjSurfaceVoxelizationOptions = {}
): V3ObjSurfaceVoxelizationArtifact {
  const metadata = input.metadata ?? parseV3ObjMetadata(input.objText ?? '', input.mtlText);
  const normalizedOptions = normalizeSurfaceOptions(options);
  const bounds = metadata.bounds ?? createFallbackBounds();
  const dimensions = buildVoxelDimensions(bounds, normalizedOptions.targetHeightVoxels);
  const scale = normalizedOptions.targetHeightVoxels / safePositive(boundsSize(bounds, 1));
  const voxelScale = V3_OBJ_SURFACE_WORLD_HEIGHT / normalizedOptions.targetHeightVoxels;
  const pivot: [number, number, number] = [
    (dimensions[0] - 1) / 2,
    0,
    (dimensions[2] - 1) / 2,
  ];
  const materialEmissive = new Map(
    metadata.materialSummaries.map((summary) => [summary.name, materialSummaryIsEmissive(summary)])
  );
  const voxels = new Map<SurfaceVoxelKey, MutableSurfaceVoxel>();
  const excludedObjects = new Set<string>();
  const bodyObjects = new Set<string>();

  for (const triangle of metadata.triangles) {
    const sourceClassification = classifyTriangle(triangle);
    const objectName = sanitizeObjectName(triangle.objectName);
    if (shouldExcludeTriangle(triangle, sourceClassification.slot, normalizedOptions.includeUnknownObjects)) {
      excludedObjects.add(objectName);
      continue;
    }
    bodyObjects.add(objectName);
    voxelizeTriangleSurface({
      triangle,
      bounds,
      dimensions,
      scale,
      surfaceThicknessVoxels: normalizedOptions.surfaceThicknessVoxels,
      materialEmissive,
      target: voxels,
      classifiedSlot: sourceClassification.slot,
    });
  }

  const slotVoxels = Object.fromEntries(
    V3_CHARACTER_SLOT_IDS.map((slot) => [slot, [] as V3ObjSurfaceVoxel[]])
  ) as Record<V3CharacterSlotId, V3ObjSurfaceVoxel[]>;
  for (const voxel of voxels.values()) {
    slotVoxels[voxel.slot].push(voxel);
  }

  const slots = Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
    slot,
    buildSlotArtifact(slot, slotVoxels[slot], dimensions),
  ])) as Record<V3CharacterSlotId, V3ObjSurfaceVoxelSlotArtifact>;
  const rolePalette = [...new Set([...voxels.values()].map((voxel) => voxel.role))].sort() as V3ObjSurfaceVoxelRole[];
  const totalVoxelCount = Object.values(slots).reduce((sum, slot) => sum + slot.voxelCount, 0);
  const totalRunCount = Object.values(slots).reduce((sum, slot) => sum + slot.runCount, 0);

  return {
    schemaVersion: V3_OBJ_SURFACE_VOXEL_ARTIFACT_SCHEMA,
    version: 1,
    source: {
      kind: 'obj',
      fileName: sanitizeFileName(input.fileName),
      hash: hashInput(input, metadata),
      objectCount: metadata.objects.length,
      triangleCountEstimate: metadata.triangleCountEstimate,
      materialCount: metadata.materials.length,
    },
    options: normalizedOptions,
    coordinateSystem: {
      targetHeightVoxels: normalizedOptions.targetHeightVoxels,
      voxelScale,
      dimensions,
      origin: [-bounds.min[0] * scale, -bounds.min[1] * scale, -bounds.min[2] * scale],
      pivot,
      normalizedBounds: {
        min: [0, 0, 0],
        max: [dimensions[0] - 1, dimensions[1] - 1, dimensions[2] - 1],
        size: dimensions,
      },
    },
    rolePalette,
    slots,
    metrics: {
      slotCount: V3_CHARACTER_SLOT_IDS.length,
      totalVoxelCount,
      totalRunCount,
      maxSlotVoxelCount: Math.max(...Object.values(slots).map((slot) => slot.voxelCount), 0),
      sourceTriangleCount: metadata.triangleCountEstimate,
      bodyObjectCount: bodyObjects.size,
      excludedObjectCount: excludedObjects.size,
    },
    excludedObjects: [...excludedObjects].sort(),
  };
}

export function expandV3ObjSurfaceVoxelRuns(
  artifactOrSlot: V3ObjSurfaceVoxelizationArtifact | V3ObjSurfaceVoxelSlotArtifact
): V3ObjSurfaceVoxel[] {
  if ('slots' in artifactOrSlot) {
    return V3_CHARACTER_SLOT_IDS.flatMap((slot) =>
      expandSlotRuns(artifactOrSlot.slots[slot], slot)
    ).sort(compareSurfaceVoxels);
  }

  return expandSlotRuns(artifactOrSlot, artifactOrSlot.slot).sort(compareSurfaceVoxels);
}

export function summarizeV3ObjSurfaceVoxelArtifact(
  artifact: V3ObjSurfaceVoxelizationArtifact
): V3ObjSurfaceVoxelArtifactSummary {
  return {
    schemaVersion: artifact.schemaVersion,
    slotCount: artifact.metrics.slotCount,
    targetHeightVoxels: artifact.options.targetHeightVoxels,
    surfaceThicknessVoxels: artifact.options.surfaceThicknessVoxels,
    voxelScale: artifact.coordinateSystem.voxelScale,
    totalVoxelCount: artifact.metrics.totalVoxelCount,
    totalRunCount: artifact.metrics.totalRunCount,
    sourceHash: artifact.source.hash,
  };
}

function normalizeSurfaceOptions(
  options: V3ObjSurfaceVoxelizationOptions
): V3ObjSurfaceVoxelizationArtifact['options'] {
  const targetHeightVoxels = Math.max(
    16,
    Math.min(320, Math.round(options.targetHeightVoxels ?? V3_OBJ_SURFACE_DEFAULT_TARGET_HEIGHT_VOXELS))
  );
  const surfaceThicknessVoxels = (
    options.surfaceThicknessVoxels === 0 ||
    options.surfaceThicknessVoxels === 2
      ? options.surfaceThicknessVoxels
      : V3_OBJ_SURFACE_DEFAULT_THICKNESS_VOXELS
  ) as 0 | 1 | 2;

  return {
    targetHeightVoxels,
    surfaceThicknessVoxels,
    includeUnknownObjects: options.includeUnknownObjects === true,
  };
}

function createFallbackBounds(): V3Bounds {
  return { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] };
}

function buildVoxelDimensions(bounds: V3Bounds, targetHeightVoxels: number): [number, number, number] {
  const height = safePositive(boundsSize(bounds, 1));
  const scale = targetHeightVoxels / height;
  return [
    Math.max(1, Math.ceil(boundsSize(bounds, 0) * scale) + 1),
    targetHeightVoxels,
    Math.max(1, Math.ceil(boundsSize(bounds, 2) * scale) + 1),
  ];
}

function classifyTriangle(triangle: V3ObjTriangleMetadata): {
  slot: V3CandidateSlot;
  role: V3ObjSurfaceVoxelRole;
} {
  const classification = classifyV3ReferencePart({
    objectName: triangle.objectName,
    groupNames: triangle.groupNames,
    materialNames: [triangle.materialName ?? ''],
  });
  return {
    slot: classification.slot,
    role: normalizeRole(classification.paintRoles[0]),
  };
}

function shouldExcludeTriangle(
  triangle: V3ObjTriangleMetadata,
  classifiedSlot: V3CandidateSlot,
  includeUnknownObjects: boolean
): boolean {
  const source = normalizeName([triangle.objectName, ...triangle.groupNames, triangle.materialName ?? ''].join(' '));
  if (/\b(hammer|sword|pistol|magnum|rifle|weapon|knife|grenade|holster)\b/.test(source)) return true;
  if (NON_BODY_SLOT_SET.has(classifiedSlot) && !(includeUnknownObjects && classifiedSlot === 'unknown')) return true;
  return false;
}

function voxelizeTriangleSurface(input: {
  triangle: V3ObjTriangleMetadata;
  bounds: V3Bounds;
  dimensions: [number, number, number];
  scale: number;
  surfaceThicknessVoxels: 0 | 1 | 2;
  materialEmissive: ReadonlyMap<string, boolean>;
  target: Map<SurfaceVoxelKey, MutableSurfaceVoxel>;
  classifiedSlot: V3CandidateSlot;
}): void {
  const a = pointToVoxelSpace(input.triangle.a, input.bounds, input.scale);
  const b = pointToVoxelSpace(input.triangle.b, input.bounds, input.scale);
  const c = pointToVoxelSpace(input.triangle.c, input.bounds, input.scale);
  const radius = 0.55 + input.surfaceThicknessVoxels * 0.55;
  const min: [number, number, number] = [
    clampInt(Math.floor(Math.min(a[0], b[0], c[0]) - radius), 0, input.dimensions[0] - 1),
    clampInt(Math.floor(Math.min(a[1], b[1], c[1]) - radius), 0, input.dimensions[1] - 1),
    clampInt(Math.floor(Math.min(a[2], b[2], c[2]) - radius), 0, input.dimensions[2] - 1),
  ];
  const max: [number, number, number] = [
    clampInt(Math.ceil(Math.max(a[0], b[0], c[0]) + radius), 0, input.dimensions[0] - 1),
    clampInt(Math.ceil(Math.max(a[1], b[1], c[1]) + radius), 0, input.dimensions[1] - 1),
    clampInt(Math.ceil(Math.max(a[2], b[2], c[2]) + radius), 0, input.dimensions[2] - 1),
  ];
  const radiusSquared = radius * radius;
  const role = resolveRoleForTriangle(input.triangle, input.materialEmissive);
  const emissive = isEmissiveRole(role, input.triangle, input.materialEmissive) ? true : undefined;

  for (let y = min[1]; y <= max[1]; y += 1) {
    for (let z = min[2]; z <= max[2]; z += 1) {
      for (let x = min[0]; x <= max[0]; x += 1) {
        const point: V3Vec3 = [x, y, z];
        if (pointTriangleDistanceSquared(point, a, b, c) > radiusSquared) continue;
        const slot = resolveSlotForVoxel(input.triangle, input.classifiedSlot, point, input.dimensions);
        setPreferredSurfaceVoxel(input.target, {
          x,
          y,
          z,
          slot,
          role,
          emissive,
        });
      }
    }
  }
}

function resolveSlotForVoxel(
  triangle: V3ObjTriangleMetadata,
  classifiedSlot: V3CandidateSlot,
  voxelPoint: V3Vec3,
  dimensions: [number, number, number]
): V3CharacterSlotId {
  const yRatio = dimensions[1] <= 1 ? 0.5 : voxelPoint[1] / (dimensions[1] - 1);
  const xCenter = (dimensions[0] - 1) / 2;
  const zCenter = (dimensions[2] - 1) / 2;
  const isLeft = resolveLeftSide(triangle, voxelPoint[0], xCenter);
  const isBack = voxelPoint[2] < zCenter - dimensions[2] * 0.08;
  const broadBody = /\b(body|torso|chest)\b/.test(normalizeName(triangle.objectName));
  const isCenterline = Math.abs(voxelPoint[0] - xCenter) <= dimensions[0] * 0.18;
  const materialName = normalizeName(triangle.materialName ?? '');

  if (materialName.includes('glove')) {
    return isLeft ? 'handLeft' : 'handRight';
  }

  if (broadBody && yRatio >= 0.79 && yRatio < 0.88 && isCenterline && !isBack) {
    return 'neck';
  }

  switch (classifiedSlot) {
    case 'helmet':
      return 'helmet';
    case 'neck':
      return 'neck';
    case 'back':
      return 'back';
    case 'shoulder':
      return isLeft ? 'shoulderLeft' : 'shoulderRight';
    case 'upperArm':
      return resolveArmSlot(yRatio, isLeft);
    case 'forearm':
      return isLeft ? 'forearmLeft' : 'forearmRight';
    case 'hand':
      return isLeft ? 'handLeft' : 'handRight';
    case 'pelvis':
      return 'pelvis';
    case 'thigh':
      return isLeft ? 'thighLeft' : 'thighRight';
    case 'shin':
      return isLeft ? 'shinLeft' : 'shinRight';
    case 'foot':
      return isLeft ? 'footLeft' : 'footRight';
    case 'chest':
      if (!broadBody) return isBack ? 'back' : 'chest';
      return resolveBodyBandSlot(yRatio, isLeft, isBack);
    case 'weapon':
    case 'hammer':
    case 'sword':
    case 'pistol':
    case 'unknown':
      return resolveBodyBandSlot(yRatio, isLeft, isBack);
    default:
      return resolveBodyBandSlot(yRatio, isLeft, isBack);
  }
}

function resolveArmSlot(yRatio: number, isLeft: boolean): V3CharacterSlotId {
  if (yRatio >= 0.76) return isLeft ? 'shoulderLeft' : 'shoulderRight';
  if (yRatio >= 0.64) return isLeft ? 'upperArmLeft' : 'upperArmRight';
  if (yRatio >= 0.43) return isLeft ? 'forearmLeft' : 'forearmRight';
  return isLeft ? 'handLeft' : 'handRight';
}

function resolveBodyBandSlot(yRatio: number, isLeft: boolean, isBack: boolean): V3CharacterSlotId {
  if (yRatio >= 0.88) return 'helmet';
  if (yRatio >= 0.78) return isBack ? 'back' : 'chest';
  if (yRatio >= 0.64) return isBack ? 'back' : 'chest';
  if (yRatio >= 0.49) return 'pelvis';
  if (yRatio >= 0.30) return isLeft ? 'thighLeft' : 'thighRight';
  if (yRatio >= 0.11) return isLeft ? 'shinLeft' : 'shinRight';
  return isLeft ? 'footLeft' : 'footRight';
}

function resolveLeftSide(triangle: V3ObjTriangleMetadata, x: number, xCenter: number): boolean {
  const source = normalizeName([triangle.objectName, ...triangle.groupNames].join(' '));
  if (/(^| )l($| )|(^| )left($| )/.test(source)) return true;
  if (/(^| )r($| )|(^| )right($| )/.test(source)) return false;
  return x >= xCenter;
}

function resolveRoleForTriangle(
  triangle: V3ObjTriangleMetadata,
  materialEmissive: ReadonlyMap<string, boolean>
): V3ObjSurfaceVoxelRole {
  const materialName = normalizeName(triangle.materialName ?? '');
  if (materialName.includes('visor')) return 'visor';
  if (materialName.includes('shield display') || materialEmissive.get(triangle.materialName ?? '') === true) return 'emissive';
  if (materialName.includes('rubber') || materialName.includes('interior') || materialName.includes('undersuit') || materialName.includes('suit')) return 'undersuit';
  if (materialName.includes('equipment') || materialName.includes('glove') || materialName.includes('robot')) return 'fixed';
  if (materialName.includes('aug') || materialName.includes('fp armor')) return 'secondary';
  if (materialName.includes('trim') || materialName.includes('accent')) return 'accent';
  if (materialName.includes('decal')) return 'decal';
  return 'primary';
}

function isEmissiveRole(
  role: V3ObjSurfaceVoxelRole,
  triangle: V3ObjTriangleMetadata,
  materialEmissive: ReadonlyMap<string, boolean>
): boolean {
  return role === 'visor' || role === 'emissive' || materialEmissive.get(triangle.materialName ?? '') === true;
}

function normalizeRole(role: string | undefined): V3ObjSurfaceVoxelRole {
  if (
    role === 'primary' ||
    role === 'secondary' ||
    role === 'accent' ||
    role === 'undersuit' ||
    role === 'visor' ||
    role === 'emissive' ||
    role === 'decal' ||
    role === 'fixed'
  ) {
    return role;
  }
  return 'primary';
}

function setPreferredSurfaceVoxel(
  target: Map<SurfaceVoxelKey, MutableSurfaceVoxel>,
  voxel: MutableSurfaceVoxel
): void {
  const key = `${voxel.x}:${voxel.y}:${voxel.z}` as SurfaceVoxelKey;
  const current = target.get(key);
  if (!current) {
    target.set(key, voxel);
    return;
  }
  const currentScore = ROLE_PRIORITY[current.role] + (current.emissive ? 0.5 : 0);
  const nextScore = ROLE_PRIORITY[voxel.role] + (voxel.emissive ? 0.5 : 0);
  if (nextScore >= currentScore) target.set(key, voxel);
}

function buildSlotArtifact(
  slot: V3CharacterSlotId,
  voxels: readonly V3ObjSurfaceVoxel[],
  dimensions: [number, number, number]
): V3ObjSurfaceVoxelSlotArtifact {
  const sorted = [...voxels].sort(compareSurfaceVoxels);
  const runs = encodeRuns(sorted);
  const roleHints = [...new Set(sorted.map((voxel) => voxel.role))].sort() as V3ObjSurfaceVoxelRole[];
  return {
    slot,
    voxelCount: sorted.length,
    runCount: runs.length,
    roleHints,
    bounds: boundsFromSurfaceVoxels(sorted, dimensions),
    runs,
  };
}

function expandSlotRuns(slot: V3ObjSurfaceVoxelSlotArtifact, fallbackSlot: V3CharacterSlotId): V3ObjSurfaceVoxel[] {
  const voxels: V3ObjSurfaceVoxel[] = [];
  for (const run of slot.runs) {
    for (let x = run.xStart; x <= run.xEnd; x += 1) {
      voxels.push({
        x,
        y: run.y,
        z: run.z,
        slot: slot.slot ?? fallbackSlot,
        role: run.role,
        emissive: run.emissive,
      });
    }
  }
  return voxels;
}

function encodeRuns(voxels: readonly V3ObjSurfaceVoxel[]): V3ObjSurfaceVoxelRun[] {
  const runs: V3ObjSurfaceVoxelRun[] = [];
  let current: V3ObjSurfaceVoxelRun | undefined;
  for (const voxel of [...voxels].sort(compareSurfaceVoxels)) {
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

function compareSurfaceVoxels(left: V3ObjSurfaceVoxel, right: V3ObjSurfaceVoxel): number {
  return (
    left.slot.localeCompare(right.slot) ||
    left.role.localeCompare(right.role) ||
    Number(left.emissive === true) - Number(right.emissive === true) ||
    left.y - right.y ||
    left.z - right.z ||
    left.x - right.x
  );
}

function boundsFromSurfaceVoxels(
  voxels: readonly V3ObjSurfaceVoxel[],
  dimensions: [number, number, number]
): V3ObjSurfaceVoxelSlotArtifact['bounds'] {
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

function pointToVoxelSpace(point: V3Vec3, bounds: V3Bounds, scale: number): V3Vec3 {
  return [
    (point[0] - bounds.min[0]) * scale,
    (point[1] - bounds.min[1]) * scale,
    (point[2] - bounds.min[2]) * scale,
  ];
}

function pointTriangleDistanceSquared(point: V3Vec3, a: V3Vec3, b: V3Vec3, c: V3Vec3): number {
  const ab = subtractVec3(b, a);
  const ac = subtractVec3(c, a);
  const ap = subtractVec3(point, a);
  const d1 = dotVec3(ab, ap);
  const d2 = dotVec3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return lengthSquared(ap);

  const bp = subtractVec3(point, b);
  const d3 = dotVec3(ab, bp);
  const d4 = dotVec3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return lengthSquared(bp);

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return lengthSquared(subtractVec3(point, addVec3(a, scaleVec3(ab, v))));
  }

  const cp = subtractVec3(point, c);
  const d5 = dotVec3(ab, cp);
  const d6 = dotVec3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return lengthSquared(cp);

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return lengthSquared(subtractVec3(point, addVec3(a, scaleVec3(ac, w))));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return lengthSquared(subtractVec3(point, addVec3(b, scaleVec3(subtractVec3(c, b), w))));
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const projection = addVec3(a, addVec3(scaleVec3(ab, v), scaleVec3(ac, w)));
  return lengthSquared(subtractVec3(point, projection));
}

function subtractVec3(left: V3Vec3, right: V3Vec3): V3Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

function addVec3(left: V3Vec3, right: V3Vec3): V3Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

function scaleVec3(value: V3Vec3, scalar: number): V3Vec3 {
  return [value[0] * scalar, value[1] * scalar, value[2] * scalar];
}

function dotVec3(left: V3Vec3, right: V3Vec3): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function lengthSquared(value: V3Vec3): number {
  return dotVec3(value, value);
}

function boundsSize(bounds: V3Bounds, axis: 0 | 1 | 2): number {
  return bounds.max[axis] - bounds.min[axis];
}

function safePositive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function materialSummaryIsEmissive(summary: V3MtlMaterialSummary): boolean {
  if (!summary.emissive) return false;
  return summary.emissive.some((value) => Number.isFinite(value) && value > 0.05);
}

function normalizeName(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_:.[\](){}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function sanitizeFileName(value: string | undefined): string | null {
  if (!value) return null;
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
}

function sanitizeObjectName(value: string): string {
  return value.replace(/[^\w .:[\]()-]+/g, '').slice(0, 80);
}

function hashInput(input: V3ObjSurfaceVoxelizerInput, metadata: V3ObjMetadata): string {
  const hash = createHash('sha256');
  if (input.objText !== undefined) hash.update(input.objText);
  if (input.mtlText !== undefined) hash.update('\n--mtl--\n').update(input.mtlText);
  if (input.objText === undefined && input.mtlText === undefined) {
    hash.update(JSON.stringify({
      vertexCount: metadata.vertexCount,
      faceCount: metadata.faceCount,
      triangleCountEstimate: metadata.triangleCountEstimate,
      objectNames: metadata.objects.map((object) => object.name),
      materialNames: metadata.materials,
      bounds: metadata.bounds,
    }));
  }
  return `sha256:${hash.digest('hex')}`;
}
