import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from '../components/v3/v3AegisObjSurfaceVoxels.generated';
import type { V3CharacterSlotId, V3PaintRole, V3Vec3Tuple } from '../components/v3/v3ModelTypes';
import {
  V3_REFERENCE_LIMB_VOXEL_SCHEMA,
  type V3ReferenceLimbVoxelArtifact,
  type V3ReferenceLimbVoxelRun,
  type V3ReferenceLimbVoxelSlot,
} from '../components/v3/v3ReferenceLimbVoxelContract';
import { V3_REFERENCE_SOURCE_BIND } from '../components/v3/v3ReferenceSourceBind.generated';

export { V3_REFERENCE_LIMB_VOXEL_SCHEMA } from '../components/v3/v3ReferenceLimbVoxelContract';

export interface BuildV3ReferenceLimbVoxelOptions {
  filePath: string;
}

export interface GenerateV3ReferenceLimbVoxelOptions extends BuildV3ReferenceLimbVoxelOptions {
  outputPath: string;
  exportName?: string;
}

type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  normalized?: boolean;
};

type GltfJson = {
  asset?: { generator?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  accessors?: GltfAccessor[];
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  materials?: Array<{ name?: string }>;
  meshes?: Array<{
    name?: string;
    primitives: Array<{
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }>;
  }>;
  nodes?: Array<{
    name?: string;
    children?: number[];
    matrix?: number[];
    mesh?: number;
    skin?: number;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }>;
  skins?: Array<{
    name?: string;
    joints?: number[];
    inverseBindMatrices?: number;
  }>;
};

type ParsedGlb = {
  json: GltfJson;
  bin: Buffer;
  source: V3ReferenceLimbVoxelArtifact['source'];
};

type LimbSide = 'left' | 'right';

type SlotSample = {
  roleIndex: number;
  emissive: boolean;
};

type SlotAccumulator = {
  slot: V3CharacterSlotId;
  sourceObjectName: string;
  mirrorOf: V3CharacterSlotId | null;
  voxels: Map<string, SlotSample>;
};

type LimbSlotName = (typeof LEFT_LIMB_SLOTS)[number] | (typeof RIGHT_LIMB_SLOTS)[number];

const LEFT_LIMB_SLOTS = ['shoulderLeft', 'upperArmLeft', 'forearmLeft', 'handLeft'] as const;
const RIGHT_LIMB_SLOTS = ['shoulderRight', 'upperArmRight', 'forearmRight', 'handRight'] as const;
const ALL_LIMB_SLOTS = [
  ...LEFT_LIMB_SLOTS,
  ...RIGHT_LIMB_SLOTS,
] as const satisfies readonly V3CharacterSlotId[];

const ROLE_PALETTE = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.rolePalette satisfies readonly V3PaintRole[];

const TARGET_HEIGHT_VOXELS = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.options.targetHeightVoxels;
const VOXEL_SCALE = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;
const TRIANGLES = 4;
const WORLD_ZERO = new THREE.Vector3(0, 0, 0);

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const tupleVec3 = (value: THREE.Vector3 | readonly number[]): V3Vec3Tuple => {
  if (value instanceof THREE.Vector3) {
    return [roundMetric(value.x), roundMetric(value.y), roundMetric(value.z)];
  }
  return [
    roundMetric(value[0] ?? 0),
    roundMetric(value[1] ?? 0),
    roundMetric(value[2] ?? 0),
  ];
};

const sourceSummary = (
  filePath: string,
  buffer: Buffer,
  json: GltfJson
): V3ReferenceLimbVoxelArtifact['source'] => ({
  kind: 'blender-reference-glb',
  fileName: basename(filePath),
  sha256: createHash('sha256').update(buffer).digest('hex'),
  generator: json.asset?.generator ?? null,
});

const parseGlb = (filePath: string): ParsedGlb => {
  const buffer = readFileSync(filePath);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`V3 reference limb voxel input is not a GLB file: ${filePath}`);
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version}; expected glTF 2.0.`);
  }

  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString('utf8', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + chunkLength;
    if (chunkType === 'JSON') {
      json = JSON.parse(buffer.toString('utf8', start, end)) as GltfJson;
    } else if (chunkType === 'BIN\0') {
      bin = buffer.subarray(start, end);
    }
    offset = end;
  }
  if (!json || !bin) throw new Error('V3 reference limb voxel GLB must contain JSON and BIN chunks.');
  return { json, bin, source: sourceSummary(filePath, buffer, json) };
};

const accessorComponentCount = (type: string): number => {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC2') return 2;
  if (type === 'VEC3') return 3;
  if (type === 'VEC4') return 4;
  if (type === 'MAT4') return 16;
  throw new Error(`Unsupported V3 reference limb accessor type: ${type}`);
};

const componentByteSize = (componentType: number): number => {
  if (componentType === 5120 || componentType === 5121) return 1;
  if (componentType === 5122 || componentType === 5123) return 2;
  if (componentType === 5125 || componentType === 5126) return 4;
  throw new Error(`Unsupported V3 reference limb component type: ${componentType}`);
};

const readComponent = (buffer: Buffer, offset: number, componentType: number): number => {
  if (componentType === 5120) return buffer.readInt8(offset);
  if (componentType === 5121) return buffer.readUInt8(offset);
  if (componentType === 5122) return buffer.readInt16LE(offset);
  if (componentType === 5123) return buffer.readUInt16LE(offset);
  if (componentType === 5125) return buffer.readUInt32LE(offset);
  if (componentType === 5126) return buffer.readFloatLE(offset);
  throw new Error(`Unsupported V3 reference limb component type: ${componentType}`);
};

const normalizeComponent = (value: number, componentType: number, normalized: boolean | undefined): number => {
  if (!normalized) return value;
  if (componentType === 5120) return Math.max(value / 127, -1);
  if (componentType === 5121) return value / 255;
  if (componentType === 5122) return Math.max(value / 32767, -1);
  if (componentType === 5123) return value / 65535;
  return value;
};

const readAccessorRows = (parsed: ParsedGlb, accessorIndex: number): number[][] => {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing V3 reference limb accessor ${accessorIndex}`);
  if (accessor.bufferView === undefined) {
    throw new Error(`V3 reference limb accessor ${accessorIndex} has no bufferView.`);
  }
  const bufferView = parsed.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Missing V3 reference limb buffer view ${accessor.bufferView}`);
  const componentCount = accessorComponentCount(accessor.type);
  const componentSize = componentByteSize(accessor.componentType);
  const byteStride = bufferView.byteStride ?? componentCount * componentSize;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: number[][] = [];
  for (let rowIndex = 0; rowIndex < accessor.count; rowIndex += 1) {
    const row: number[] = [];
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      const offset = start + rowIndex * byteStride + componentIndex * componentSize;
      row.push(normalizeComponent(
        readComponent(parsed.bin, offset, accessor.componentType),
        accessor.componentType,
        accessor.normalized
      ));
    }
    rows.push(row);
  }
  return rows;
};

const readAccessorScalars = (parsed: ParsedGlb, accessorIndex: number): number[] =>
  readAccessorRows(parsed, accessorIndex).map((row) => row[0] ?? 0);

const nodeLocalMatrix = (node: NonNullable<GltfJson['nodes']>[number]): THREE.Matrix4 => {
  const matrix = new THREE.Matrix4();
  if (node.matrix) return matrix.fromArray(node.matrix);
  return matrix.compose(
    new THREE.Vector3(...tupleVec3(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])).normalize(),
    new THREE.Vector3(...tupleVec3(node.scale ?? [1, 1, 1]))
  );
};

const buildParentIndexByNode = (json: GltfJson): Map<number, number> => {
  const parents = new Map<number, number>();
  json.nodes?.forEach((node, index) => {
    for (const childIndex of node.children ?? []) parents.set(childIndex, index);
  });
  return parents;
};

const buildWorldMatrixForNode = (
  json: GltfJson,
  parentByNode: Map<number, number>
): ((nodeIndex: number) => THREE.Matrix4) => {
  const cache = new Map<number, THREE.Matrix4>();
  const worldForNode = (nodeIndex: number): THREE.Matrix4 => {
    const cached = cache.get(nodeIndex);
    if (cached) return cached.clone();
    const node = json.nodes?.[nodeIndex];
    if (!node) throw new Error(`Missing V3 reference limb node ${nodeIndex}`);
    const parentIndex = parentByNode.get(nodeIndex);
    const matrix = parentIndex === undefined
      ? new THREE.Matrix4()
      : worldForNode(parentIndex);
    matrix.multiply(nodeLocalMatrix(node));
    cache.set(nodeIndex, matrix.clone());
    return matrix;
  };
  return worldForNode;
};

const detectLimbSide = (nodeName: string, meshName: string): LimbSide | null => {
  const name = `${nodeName} ${meshName}`.toLowerCase();
  if (/\barm\s*l\b|_l\b|\.l\b/.test(name)) return 'left';
  if (/\barm\s*r\b|_r\b|\.r\b/.test(name)) return 'right';
  return null;
};

const roleForMaterial = (materialName: string | undefined): {
  role: V3PaintRole;
  emissive: boolean;
} => {
  const normalized = (materialName ?? '').toLowerCase();
  if (normalized.includes('shield') || normalized.includes('emissive')) {
    return { role: 'emissive', emissive: true };
  }
  if (normalized.includes('decal')) return { role: 'decal', emissive: false };
  if (normalized.includes('rubber') || normalized.includes('glove')) {
    return { role: 'undersuit', emissive: false };
  }
  if (normalized.includes('fp_armor')) return { role: 'secondary', emissive: false };
  return { role: 'primary', emissive: false };
};

const roleIndexFor = (role: V3PaintRole): number => {
  const index = (ROLE_PALETTE as readonly V3PaintRole[]).indexOf(role);
  return index >= 0 ? index : 0;
};

const vectorFromTuple = (tuple: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0);

const sideSlots = (side: LimbSide): readonly LimbSlotName[] =>
  side === 'left' ? LEFT_LIMB_SLOTS : RIGHT_LIMB_SLOTS;

const slotMirror = (slot: LimbSlotName): V3CharacterSlotId | null => {
  if (slot === 'shoulderLeft') return 'shoulderRight';
  if (slot === 'upperArmLeft') return 'upperArmRight';
  if (slot === 'forearmLeft') return 'forearmRight';
  if (slot === 'handLeft') return 'handRight';
  return null;
};

const sideRoot = (side: LimbSide): THREE.Vector3 =>
  vectorFromTuple(V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'shoulderLeft' : 'shoulderRight']?.sourceRestWorldPosition ?? [0, 0, 0]);

const sideGrip = (side: LimbSide): THREE.Vector3 =>
  vectorFromTuple(V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'handLeft' : 'handRight']?.sourceEndRestWorldPosition ?? [0, 0, 0]);

const signedDistanceAlongSide = (
  point: THREE.Vector3,
  side: LimbSide,
  root: THREE.Vector3,
  axis: THREE.Vector3
): number => point.clone().sub(root).dot(axis) * (side === 'left' ? 1 : 1);

const buildSlotThresholds = (side: LimbSide): {
  root: THREE.Vector3;
  axis: THREE.Vector3;
  shoulderUpper: number;
  upperForearm: number;
  forearmHand: number;
} => {
  const root = sideRoot(side);
  const grip = sideGrip(side);
  const axis = grip.clone().sub(root);
  if (axis.lengthSq() <= 0.000001) axis.copy(side === 'left' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(-1, 0, 0));
  axis.normalize();
  const upperStart = vectorFromTuple(
    V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'upperArmLeft' : 'upperArmRight']?.sourceRestWorldPosition ?? root.toArray()
  );
  const forearmStart = vectorFromTuple(
    V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'forearmLeft' : 'forearmRight']?.sourceRestWorldPosition ?? upperStart.toArray()
  );
  const handStart = vectorFromTuple(
    V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'handLeft' : 'handRight']?.sourceRestWorldPosition ?? forearmStart.toArray()
  );
  const handEnd = vectorFromTuple(
    V3_REFERENCE_SOURCE_BIND.slots[side === 'left' ? 'handLeft' : 'handRight']?.sourceEndRestWorldPosition ?? handStart.toArray()
  );
  const upperDistance = signedDistanceAlongSide(upperStart, side, root, axis);
  const forearmDistance = signedDistanceAlongSide(forearmStart, side, root, axis);
  const handDistance = signedDistanceAlongSide(handStart, side, root, axis);
  const gripDistance = signedDistanceAlongSide(handEnd, side, root, axis);
  return {
    root,
    axis,
    shoulderUpper: upperDistance + (forearmDistance - upperDistance) * 0.45,
    upperForearm: forearmDistance,
    forearmHand: handDistance + (gripDistance - handDistance) * 0.15,
  };
};

const classifyPointToSlot = (
  point: THREE.Vector3,
  side: LimbSide,
  thresholdsBySide: Record<LimbSide, ReturnType<typeof buildSlotThresholds>>,
  materialName: string | undefined
): LimbSlotName => {
  const thresholds = thresholdsBySide[side];
  const distance = signedDistanceAlongSide(point, side, thresholds.root, thresholds.axis);
  const normalizedMaterialName = (materialName ?? '').toLowerCase();
  if (normalizedMaterialName.includes('glove') && distance >= thresholds.forearmHand - (VOXEL_SCALE * 5)) {
    return side === 'left' ? 'handLeft' : 'handRight';
  }
  if (distance <= thresholds.shoulderUpper) return side === 'left' ? 'shoulderLeft' : 'shoulderRight';
  if (distance <= thresholds.upperForearm) return side === 'left' ? 'upperArmLeft' : 'upperArmRight';
  if (distance <= thresholds.forearmHand) return side === 'left' ? 'forearmLeft' : 'forearmRight';
  return side === 'left' ? 'handLeft' : 'handRight';
};

const voxelKey = (x: number, y: number, z: number): string => `${x}:${y}:${z}`;

const parseVoxelKey = (key: string): [number, number, number] => {
  const [x, y, z] = key.split(':').map(Number);
  return [x ?? 0, y ?? 0, z ?? 0];
};

const addVoxel = (
  accumulator: SlotAccumulator,
  point: THREE.Vector3,
  sample: SlotSample
): void => {
  const x = Math.round(point.x / VOXEL_SCALE);
  const y = Math.round(point.y / VOXEL_SCALE);
  const z = Math.round(point.z / VOXEL_SCALE);
  const key = voxelKey(x, y, z);
  const current = accumulator.voxels.get(key);
  if (!current || sample.emissive || sample.roleIndex < current.roleIndex) {
    accumulator.voxels.set(key, sample);
  }
};

const sampleTriangle = (
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  callback: (point: THREE.Vector3) => void
): void => {
  const maxEdge = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  const steps = Math.max(1, Math.min(18, Math.ceil((maxEdge / VOXEL_SCALE) * 1.25)));
  const normal = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
  if (normal.lengthSq() > 0.00000001) normal.normalize();
  const normalOffsets = normal.lengthSq() > 0 ? [-0.35, 0, 0.35] : [0];
  for (let row = 0; row <= steps; row += 1) {
    for (let col = 0; col <= steps - row; col += 1) {
      const u = row / steps;
      const v = col / steps;
      const w = 1 - u - v;
      const point = new THREE.Vector3(
        a.x * w + b.x * u + c.x * v,
        a.y * w + b.y * u + c.y * v,
        a.z * w + b.z * u + c.z * v
      );
      for (const offset of normalOffsets) {
        callback(offset === 0 ? point : point.clone().addScaledVector(normal, VOXEL_SCALE * offset));
      }
    }
  }
};

const createAccumulators = (): Record<LimbSlotName, SlotAccumulator> => Object.fromEntries(
  ALL_LIMB_SLOTS.map((slot) => [
    slot,
    {
      slot,
      sourceObjectName: slot.endsWith('Left') ? 'Male Arm L' : 'Male Arm R',
      mirrorOf: slotMirror(slot),
      voxels: new Map<string, SlotSample>(),
    },
  ])
) as Record<LimbSlotName, SlotAccumulator>;

const packSlotRuns = (
  voxels: Map<string, SlotSample>
): V3ReferenceLimbVoxelRun[] => {
  const rows = new Map<string, { roleIndex: number; y: number; z: number; emissive: boolean; xs: number[] }>();
  for (const [key, sample] of voxels) {
    const [x, y, z] = parseVoxelKey(key);
    const rowKey = `${sample.roleIndex}:${sample.emissive ? 1 : 0}:${y}:${z}`;
    const row = rows.get(rowKey) ?? {
      roleIndex: sample.roleIndex,
      y,
      z,
      emissive: sample.emissive,
      xs: [],
    };
    row.xs.push(x);
    rows.set(rowKey, row);
  }

  const runs: V3ReferenceLimbVoxelRun[] = [];
  for (const row of rows.values()) {
    const xs = [...new Set(row.xs)].sort((left, right) => left - right);
    let start = xs[0];
    let previous = xs[0];
    for (let index = 1; index <= xs.length; index += 1) {
      const next = xs[index];
      if (next === previous + 1) {
        previous = next;
        continue;
      }
      if (start !== undefined && previous !== undefined) {
        runs.push(row.emissive
          ? [row.roleIndex, row.y, row.z, start, previous, 1]
          : [row.roleIndex, row.y, row.z, start, previous]);
      }
      start = next;
      previous = next;
    }
  }
  return runs.sort((left, right) => (
    left[1] - right[1] ||
    left[2] - right[2] ||
    left[0] - right[0] ||
    left[3] - right[3] ||
    left[4] - right[4]
  ));
};

const countRunVoxels = (run: V3ReferenceLimbVoxelRun): number =>
  Math.max(0, run[4] - run[3] + 1);

const buildSlotArtifact = (accumulator: SlotAccumulator): V3ReferenceLimbVoxelSlot => {
  const keys = [...accumulator.voxels.keys()];
  const coordinates = keys.map(parseVoxelKey);
  const min = coordinates.reduce((current, coordinate) => [
    Math.min(current[0], coordinate[0]),
    Math.min(current[1], coordinate[1]),
    Math.min(current[2], coordinate[2]),
  ], [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]);
  const max = coordinates.reduce((current, coordinate) => [
    Math.max(current[0], coordinate[0]),
    Math.max(current[1], coordinate[1]),
    Math.max(current[2], coordinate[2]),
  ], [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]);
  const safeMin = min.every(Number.isFinite) ? min : [0, 0, 0];
  const safeMax = max.every(Number.isFinite) ? max : [0, 0, 0];
  const runs = packSlotRuns(accumulator.voxels);
  const roleHintIndexes = [...new Set([...accumulator.voxels.values()].map((voxel) => voxel.roleIndex))]
    .sort((left, right) => left - right);
  const voxelCount = runs.reduce((total, run) => total + countRunVoxels(run), 0);
  const worldMin = new THREE.Vector3(
    safeMin[0] * VOXEL_SCALE,
    safeMin[1] * VOXEL_SCALE,
    safeMin[2] * VOXEL_SCALE
  );
  const worldMax = new THREE.Vector3(
    safeMax[0] * VOXEL_SCALE,
    safeMax[1] * VOXEL_SCALE,
    safeMax[2] * VOXEL_SCALE
  );
  const worldCenter = keys.length > 0
    ? coordinates.reduce((sum, coordinate) => {
      sum.x += coordinate[0] * VOXEL_SCALE;
      sum.y += coordinate[1] * VOXEL_SCALE;
      sum.z += coordinate[2] * VOXEL_SCALE;
      return sum;
    }, new THREE.Vector3()).divideScalar(keys.length)
    : WORLD_ZERO.clone();

  return {
    slot: accumulator.slot,
    sourceObjectName: accumulator.sourceObjectName,
    mirrorOf: accumulator.mirrorOf,
    bounds: {
      min: tupleVec3(safeMin),
      max: tupleVec3(safeMax),
      size: tupleVec3([
        safeMax[0] - safeMin[0] + 1,
        safeMax[1] - safeMin[1] + 1,
        safeMax[2] - safeMin[2] + 1,
      ]),
    },
    worldBounds: {
      min: tupleVec3(worldMin),
      max: tupleVec3(worldMax),
      size: tupleVec3(worldMax.clone().sub(worldMin).addScalar(VOXEL_SCALE)),
    },
    worldCenter: tupleVec3(worldCenter),
    roleHintIndexes,
    voxelCount,
    runCount: runs.length,
    runs,
  };
};

export function buildV3ReferenceLimbVoxelArtifact(
  options: BuildV3ReferenceLimbVoxelOptions
): V3ReferenceLimbVoxelArtifact {
  const parsed = parseGlb(options.filePath);
  const skin = parsed.json.skins?.[0];
  if (!skin) throw new Error('V3 reference limb voxel GLB must contain a skin.');
  const parentByNode = buildParentIndexByNode(parsed.json);
  const worldForNode = buildWorldMatrixForNode(parsed.json, parentByNode);
  const jointNameBySkinIndex = (skin.joints ?? []).map((nodeIndex) => parsed.json.nodes?.[nodeIndex]?.name ?? '');
  const accumulators = createAccumulators();
  const expectedObjectNames = ['Male Arm L', 'Male Arm R'];
  const sourceObjectNames: string[] = [];
  let unassignedTriangleCount = 0;
  const thresholdsBySide = {
    left: buildSlotThresholds('left'),
    right: buildSlotThresholds('right'),
  };

  parsed.json.nodes?.forEach((node, nodeIndex) => {
    if (node.mesh === undefined) return;
    const mesh = parsed.json.meshes?.[node.mesh];
    if (!mesh) return;
    const nodeName = node.name ?? `mesh-object-${nodeIndex}`;
    const meshName = mesh.name ?? `mesh-${node.mesh}`;
    const side = detectLimbSide(nodeName, meshName);
    if (!side) return;
    sourceObjectNames.push(nodeName);
    const worldMatrix = worldForNode(nodeIndex);

    for (const primitive of mesh.primitives) {
      if ((primitive.mode ?? TRIANGLES) !== TRIANGLES) continue;
      const positionAccessor = primitive.attributes.POSITION;
      const jointAccessor = primitive.attributes.JOINTS_0;
      const weightAccessor = primitive.attributes.WEIGHTS_0;
      if (positionAccessor === undefined || jointAccessor === undefined || weightAccessor === undefined) {
        continue;
      }
      const materialName = primitive.material === undefined
        ? undefined
        : parsed.json.materials?.[primitive.material]?.name;
      const materialRole = roleForMaterial(materialName);
      const sample: SlotSample = {
        roleIndex: roleIndexFor(materialRole.role),
        emissive: materialRole.emissive,
      };
      const positions = readAccessorRows(parsed, positionAccessor).map((row) =>
        new THREE.Vector3(row[0] ?? 0, row[1] ?? 0, row[2] ?? 0).applyMatrix4(worldMatrix)
      );
      const joints = readAccessorRows(parsed, jointAccessor);
      const weights = readAccessorRows(parsed, weightAccessor);
      const indices = primitive.indices === undefined
        ? positions.map((_, index) => index)
        : readAccessorScalars(parsed, primitive.indices);

      for (let index = 0; index + 2 < indices.length; index += 3) {
        const aIndex = indices[index] ?? 0;
        const bIndex = indices[index + 1] ?? 0;
        const cIndex = indices[index + 2] ?? 0;
        const a = positions[aIndex];
        const b = positions[bIndex];
        const c = positions[cIndex];
        if (!a || !b || !c) {
          unassignedTriangleCount += 1;
          continue;
        }
        const dominantJointNames = [aIndex, bIndex, cIndex].map((vertexIndex) => {
          const vertexJoints = joints[vertexIndex] ?? [];
          const vertexWeights = weights[vertexIndex] ?? [];
          let bestJoint = 0;
          let bestWeight = Number.NEGATIVE_INFINITY;
          for (let weightIndex = 0; weightIndex < vertexJoints.length; weightIndex += 1) {
            const weight = vertexWeights[weightIndex] ?? 0;
            if (weight > bestWeight) {
              bestWeight = weight;
              bestJoint = vertexJoints[weightIndex] ?? 0;
            }
          }
          return jointNameBySkinIndex[bestJoint] ?? '';
        });
        const triangleSide = dominantJointNames.some((name) => name.includes('_r_'))
          ? 'right'
          : dominantJointNames.some((name) => name.includes('_l_'))
            ? 'left'
            : side;
        sampleTriangle(a, b, c, (point) => {
          const pointSide = point.x < 0 ? 'right' : triangleSide;
          const slot = classifyPointToSlot(point, pointSide, thresholdsBySide, materialName);
          addVoxel(accumulators[slot], point, sample);
        });
      }
    }
  });

  const missingArmMeshNodes = expectedObjectNames.filter((name) => !sourceObjectNames.includes(name));
  const slots = Object.fromEntries(ALL_LIMB_SLOTS.map((slot) => [
    slot,
    buildSlotArtifact(accumulators[slot]),
  ])) as Record<LimbSlotName, V3ReferenceLimbVoxelSlot>;
  const totalVoxelCount = Object.values(slots).reduce((total, slot) => total + slot.voxelCount, 0);
  const totalRunCount = Object.values(slots).reduce((total, slot) => total + slot.runCount, 0);
  const maxSlotVoxelCount = Math.max(...Object.values(slots).map((slot) => slot.voxelCount), 0);

  return {
    schemaVersion: V3_REFERENCE_LIMB_VOXEL_SCHEMA,
    version: 1,
    source: parsed.source,
    coordinateSystem: {
      authoringSpace: 'mesh2motion-native-v3',
      targetHeightVoxels: TARGET_HEIGHT_VOXELS,
      voxelScale: VOXEL_SCALE,
      pivot: [0, 0, 0],
    },
    rolePalette: ROLE_PALETTE,
    slots,
    metrics: {
      slotCount: Object.keys(slots).length,
      totalVoxelCount,
      totalRunCount,
      maxSlotVoxelCount,
    },
    diagnostics: {
      missingArmMeshNodes,
      unassignedTriangleCount,
      sourceObjectNames: sourceObjectNames.sort((left, right) => left.localeCompare(right)),
    },
  };
}

export function buildV3ReferenceLimbVoxelGeneratedSource(
  artifact: V3ReferenceLimbVoxelArtifact,
  exportName = 'V3_REFERENCE_LIMB_VOXELS'
): string {
  return [
    '/* eslint-disable */',
    '// Generated by src/tools/v3ReferenceLimbVoxelImporter.ts. Do not edit by hand.',
    '// Source Blender GLB files stay private/local; this file contains sanitized V3 limb voxel data only.',
    `export const ${exportName} = ${JSON.stringify(artifact, null, 2)} as const;`,
    '',
  ].join('\n');
}

export function generateV3ReferenceLimbVoxelArtifact(
  options: GenerateV3ReferenceLimbVoxelOptions
): V3ReferenceLimbVoxelArtifact {
  const artifact = buildV3ReferenceLimbVoxelArtifact(options);
  writeFileSync(
    options.outputPath,
    buildV3ReferenceLimbVoxelGeneratedSource(artifact, options.exportName),
    'utf8'
  );
  return artifact;
}

export function parseV3ReferenceLimbVoxelImporterCliArgs(
  args: readonly string[]
): GenerateV3ReferenceLimbVoxelOptions {
  let filePath: string | null = null;
  let outputPath: string | null = null;
  let exportName: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') filePath = args[++index] ?? null;
    else if (arg === '--out') outputPath = args[++index] ?? null;
    else if (arg === '--export-name') exportName = args[++index];
    else throw new Error(`Unknown V3 reference limb voxel importer argument: ${arg}`);
  }
  if (!filePath) throw new Error('Missing required --input <reference-tpose.glb>');
  if (!outputPath) throw new Error('Missing required --out <generated.ts>');
  return {
    filePath,
    outputPath: resolve(outputPath),
    exportName,
  };
}

const isDirectRun = (): boolean => {
  if (!process.argv[1]) return false;
  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
};

if (isDirectRun()) {
  generateV3ReferenceLimbVoxelArtifact(
    parseV3ReferenceLimbVoxelImporterCliArgs(process.argv.slice(2))
  );
}
