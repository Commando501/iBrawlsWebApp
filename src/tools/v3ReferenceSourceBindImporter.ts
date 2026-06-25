import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import {
  V3_REFERENCE_SOURCE_BIND_SCHEMA,
  type V3ReferenceSourceBindArtifact,
  type V3ReferenceSourceBindBasis,
  type V3ReferenceSourceBindBone,
  type V3ReferenceSourceBindSlot,
} from '../components/v3/v3ReferenceSourceBindContract';
import type { V3CharacterSlotId, V3QuatTuple, V3Vec3Tuple } from '../components/v3/v3ModelTypes';

export { V3_REFERENCE_SOURCE_BIND_SCHEMA } from '../components/v3/v3ReferenceSourceBindContract';

export interface BuildV3ReferenceSourceBindOptions {
  filePath: string;
}

export interface GenerateV3ReferenceSourceBindOptions extends BuildV3ReferenceSourceBindOptions {
  outputPath: string;
  exportName?: string;
}

type GltfJson = {
  asset?: { generator?: string };
  scene?: number;
  scenes?: Array<{ nodes?: number[] }>;
  accessors?: Array<{
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  }>;
  bufferViews?: Array<{
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }>;
  nodes?: Array<{
    name?: string;
    children?: number[];
    matrix?: number[];
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
  source: V3ReferenceSourceBindArtifact['source'];
};

const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);

const SOURCE_SLOT_BONES = {
  shoulderLeft: ['b_l_clav', 'b_l_upperarm', 'clavicle_l', 'upperarm_l'],
  upperArmLeft: ['b_l_upperarm', 'b_l_forearm', 'upperarm_l', 'lowerarm_l'],
  forearmLeft: ['b_l_forearm', 'b_l_hand', 'lowerarm_l', 'hand_l'],
  handLeft: ['b_l_hand', 'b_l_grip', 'hand_l', 'index_01_l'],
  thighLeft: ['b_l_thigh', 'b_l_calf', 'thigh_l', 'calf_l'],
  shinLeft: ['b_l_calf', 'b_l_foot', 'calf_l', 'foot_l'],
  footLeft: ['b_l_foot', 'b_l_toe', 'foot_l', 'ball_l'],
  shoulderRight: ['b_r_clav', 'b_r_upperarm', 'clavicle_r', 'upperarm_r'],
  upperArmRight: ['b_r_upperarm', 'b_r_forearm', 'upperarm_r', 'lowerarm_r'],
  forearmRight: ['b_r_forearm', 'b_r_hand', 'lowerarm_r', 'hand_r'],
  handRight: ['b_r_hand', 'b_r_grip', 'hand_r', 'index_01_r'],
  thighRight: ['b_r_thigh', 'b_r_calf', 'thigh_r', 'calf_r'],
  shinRight: ['b_r_calf', 'b_r_foot', 'calf_r', 'foot_r'],
  footRight: ['b_r_foot', 'b_r_toe', 'foot_r', 'ball_r'],
} as const satisfies Partial<Record<
  V3CharacterSlotId,
  readonly [string, string, string, string]
>>;

const REQUIRED_SOURCE_BONES = Array.from(new Set(
  Object.values(SOURCE_SLOT_BONES).flatMap(([source, end]) => [source, end])
)).sort((left, right) => left.localeCompare(right));

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const roundQuat = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(9));
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

const tupleQuat = (quaternion: THREE.Quaternion): V3QuatTuple => {
  const normalized = quaternion.lengthSq() > 0.000001
    ? quaternion.clone().normalize()
    : new THREE.Quaternion();
  return [
    roundQuat(normalized.x),
    roundQuat(normalized.y),
    roundQuat(normalized.z),
    roundQuat(normalized.w),
  ];
};

const tupleMatrix = (matrix: THREE.Matrix4): readonly number[] =>
  matrix.toArray().map(roundMetric);

const sourceSummary = (
  filePath: string,
  buffer: Buffer,
  json: GltfJson
): V3ReferenceSourceBindArtifact['source'] => ({
  kind: 'blender-reference-glb',
  fileName: basename(filePath),
  sha256: createHash('sha256').update(buffer).digest('hex'),
  generator: json.asset?.generator ?? null,
});

const parseGlb = (filePath: string): ParsedGlb => {
  const buffer = readFileSync(filePath);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`V3 reference source bind input is not a GLB file: ${filePath}`);
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
  if (!json || !bin) throw new Error('V3 reference source bind GLB must contain JSON and BIN chunks.');
  return { json, bin, source: sourceSummary(filePath, buffer, json) };
};

const accessorComponentCount = (type: string): number => {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC2') return 2;
  if (type === 'VEC3') return 3;
  if (type === 'VEC4') return 4;
  if (type === 'MAT4') return 16;
  throw new Error(`Unsupported V3 reference source bind accessor type: ${type}`);
};

const readAccessorRows = (parsed: ParsedGlb, accessorIndex: number): number[][] => {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing V3 reference source bind accessor ${accessorIndex}`);
  if (accessor.componentType !== 5126) {
    throw new Error(`Unsupported V3 reference source bind accessor component type: ${accessor.componentType}`);
  }
  const bufferView = parsed.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Missing V3 reference source bind buffer view ${accessor.bufferView}`);
  const componentCount = accessorComponentCount(accessor.type);
  const componentSize = 4;
  const byteStride = bufferView.byteStride ?? componentCount * componentSize;
  const start = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const rows: number[][] = [];
  for (let rowIndex = 0; rowIndex < accessor.count; rowIndex += 1) {
    const row: number[] = [];
    for (let componentIndex = 0; componentIndex < componentCount; componentIndex += 1) {
      row.push(parsed.bin.readFloatLE(start + rowIndex * byteStride + componentIndex * componentSize));
    }
    rows.push(row);
  }
  return rows;
};

const nodeLocalMatrix = (node: NonNullable<GltfJson['nodes']>[number]): THREE.Matrix4 => {
  const matrix = new THREE.Matrix4();
  if (node.matrix) return matrix.fromArray(node.matrix);
  return matrix.compose(
    new THREE.Vector3(...tupleVec3(node.translation ?? [0, 0, 0])),
    new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1])).normalize(),
    new THREE.Vector3(...tupleVec3(node.scale ?? [1, 1, 1]))
  );
};

const normalizedVector = (
  value: THREE.Vector3,
  fallback: THREE.Vector3
): THREE.Vector3 => value.lengthSq() > 0.000001 ? value.normalize() : fallback.clone().normalize();

const projectedAxis = (
  reference: THREE.Vector3,
  normal: THREE.Vector3,
  fallback: THREE.Vector3
): THREE.Vector3 => {
  const projected = reference.clone().sub(normal.clone().multiplyScalar(reference.dot(normal)));
  return normalizedVector(projected, fallback);
};

const basisFromAxes = (
  xAxis: THREE.Vector3,
  yAxis: THREE.Vector3,
  zAxis: THREE.Vector3
): V3ReferenceSourceBindBasis => {
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
  ).normalize();
  return {
    xAxis: tupleVec3(xAxis),
    yAxis: tupleVec3(yAxis),
    zAxis: tupleVec3(zAxis),
    quaternion: tupleQuat(quaternion),
  };
};

const basisFromSourceBone = (
  sourceBone: V3ReferenceSourceBindBone,
  source: THREE.Vector3,
  end: THREE.Vector3
): V3ReferenceSourceBindBasis => {
  const sourceQuaternion = new THREE.Quaternion(...sourceBone.restWorldQuaternion).normalize();
  const yAxis = normalizedVector(end.clone().sub(source), WORLD_UP);
  const boneZAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(sourceQuaternion);
  const zAxis = projectedAxis(boneZAxis, yAxis, WORLD_FORWARD);
  const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
  return basisFromAxes(xAxis, yAxis, zAxis);
};

const footBasisFromSegment = (source: THREE.Vector3, end: THREE.Vector3): V3ReferenceSourceBindBasis => {
  const horizontal = end.clone().sub(source);
  horizontal.y = 0;
  const zAxis = normalizedVector(horizontal, WORLD_FORWARD);
  const yAxis = projectedAxis(WORLD_UP, zAxis, WORLD_UP);
  const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
  return basisFromAxes(xAxis, yAxis, zAxis);
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
    if (!node) throw new Error(`Missing V3 reference source bind node ${nodeIndex}`);
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

const decomposeMatrix = (matrix: THREE.Matrix4): {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
} => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion: quaternion.normalize() };
};

const buildBones = (
  parsed: ParsedGlb,
  skin: NonNullable<GltfJson['skins']>[number],
  parentByNode: Map<number, number>,
  worldForNode: (nodeIndex: number) => THREE.Matrix4
): Record<string, V3ReferenceSourceBindBone> => {
  const inverseBindRows = skin.inverseBindMatrices === undefined
    ? []
    : readAccessorRows(parsed, skin.inverseBindMatrices);
  const bones: Record<string, V3ReferenceSourceBindBone> = {};
  const jointIndexes = skin.joints ?? [];
  for (let jointOrder = 0; jointOrder < jointIndexes.length; jointOrder += 1) {
    const nodeIndex = jointIndexes[jointOrder];
    const node = parsed.json.nodes?.[nodeIndex];
    const name = node?.name;
    if (!name) continue;
    const parentIndex = parentByNode.get(nodeIndex);
    const parentName = parentIndex === undefined ? null : parsed.json.nodes?.[parentIndex]?.name ?? null;
    const local = decomposeMatrix(nodeLocalMatrix(node));
    const worldMatrix = worldForNode(nodeIndex);
    const world = decomposeMatrix(worldMatrix);
    const inverseBindRow = inverseBindRows[jointOrder];
    bones[name] = {
      name,
      parent: parentName,
      restLocalPosition: tupleVec3(local.position),
      restLocalQuaternion: tupleQuat(local.quaternion),
      restWorldPosition: tupleVec3(world.position),
      restWorldQuaternion: tupleQuat(world.quaternion),
      restWorldMatrix: tupleMatrix(worldMatrix),
      inverseBindMatrix: inverseBindRow ? inverseBindRow.map(roundMetric) : null,
    };
  }
  return Object.fromEntries(Object.entries(bones).sort(([left], [right]) => left.localeCompare(right)));
};

const buildSlot = (
  slot: V3CharacterSlotId,
  spec: readonly [string, string, string, string],
  bones: Readonly<Record<string, V3ReferenceSourceBindBone>>
): V3ReferenceSourceBindSlot | null => {
  const [sourceBoneName, endBoneName, mesh2MotionJointName, mesh2MotionEndJointName] = spec;
  const sourceBone = bones[sourceBoneName];
  const endBone = bones[endBoneName];
  if (!sourceBone || !endBone) return null;
  const source = new THREE.Vector3(...sourceBone.restWorldPosition);
  const end = new THREE.Vector3(...endBone.restWorldPosition);
  return {
    slot,
    sourceBoneName,
    endBoneName,
    mesh2MotionJointName,
    mesh2MotionEndJointName,
    sourceRestWorldPosition: sourceBone.restWorldPosition,
    sourceEndRestWorldPosition: endBone.restWorldPosition,
    sourceRestWorldQuaternion: sourceBone.restWorldQuaternion,
    sourceSegmentAxis: tupleVec3(normalizedVector(end.clone().sub(source), WORLD_UP)),
    sourceBasis: slot === 'footLeft' || slot === 'footRight'
      ? footBasisFromSegment(source, end)
      : basisFromSourceBone(sourceBone, source, end),
  };
};

const armChainMaxVerticalDelta = (
  slots: Partial<Record<V3CharacterSlotId, V3ReferenceSourceBindSlot>>
): number => {
  let maxDelta = 0;
  for (const slot of [
    'upperArmLeft',
    'forearmLeft',
    'handLeft',
    'upperArmRight',
    'forearmRight',
    'handRight',
  ] as const) {
    const sourceSlot = slots[slot];
    if (!sourceSlot) continue;
    maxDelta = Math.max(
      maxDelta,
      Math.abs(sourceSlot.sourceEndRestWorldPosition[1] - sourceSlot.sourceRestWorldPosition[1])
    );
  }
  return roundMetric(maxDelta);
};

export function buildV3ReferenceSourceBindArtifact(
  options: BuildV3ReferenceSourceBindOptions
): V3ReferenceSourceBindArtifact {
  const parsed = parseGlb(options.filePath);
  const skin = parsed.json.skins?.[0];
  if (!skin) throw new Error('V3 reference source bind GLB must contain a skin.');
  const parentByNode = buildParentIndexByNode(parsed.json);
  const worldForNode = buildWorldMatrixForNode(parsed.json, parentByNode);
  const bones = buildBones(parsed, skin, parentByNode, worldForNode);
  const slots = Object.fromEntries(
    Object.entries(SOURCE_SLOT_BONES).flatMap(([slot, spec]) => {
      const sourceSlot = buildSlot(slot as V3CharacterSlotId, spec, bones);
      return sourceSlot ? [[slot, sourceSlot]] : [];
    })
  ) as Partial<Record<V3CharacterSlotId, V3ReferenceSourceBindSlot>>;
  const missingRequiredBones = REQUIRED_SOURCE_BONES.filter((boneName) => !bones[boneName]);

  return {
    schemaVersion: V3_REFERENCE_SOURCE_BIND_SCHEMA,
    version: 1,
    source: parsed.source,
    skeleton: {
      skinName: skin.name ?? null,
      skinJointCount: skin.joints?.length ?? 0,
      bones,
    },
    slots,
    diagnostics: {
      missingRequiredBones,
      armChainMaxVerticalDelta: armChainMaxVerticalDelta(slots),
    },
  };
}

export function buildV3ReferenceSourceBindGeneratedSource(
  artifact: V3ReferenceSourceBindArtifact,
  exportName = 'V3_REFERENCE_SOURCE_BIND'
): string {
  return [
    '/* eslint-disable */',
    '// Generated by src/tools/v3ReferenceSourceBindImporter.ts. Do not edit by hand.',
    '// Source Blender GLB files stay private/local; this file contains sanitized V3 source bind data only.',
    `export const ${exportName} = ${JSON.stringify(artifact, null, 2)} as const;`,
    '',
  ].join('\n');
}

export function generateV3ReferenceSourceBindArtifact(
  options: GenerateV3ReferenceSourceBindOptions
): V3ReferenceSourceBindArtifact {
  const artifact = buildV3ReferenceSourceBindArtifact(options);
  writeFileSync(
    options.outputPath,
    buildV3ReferenceSourceBindGeneratedSource(artifact, options.exportName),
    'utf8'
  );
  return artifact;
}

export function parseV3ReferenceSourceBindImporterCliArgs(
  args: readonly string[]
): GenerateV3ReferenceSourceBindOptions {
  let filePath: string | null = null;
  let outputPath: string | null = null;
  let exportName: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') filePath = args[++index] ?? null;
    else if (arg === '--out') outputPath = args[++index] ?? null;
    else if (arg === '--export-name') exportName = args[++index];
    else throw new Error(`Unknown V3 reference source bind importer argument: ${arg}`);
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
  generateV3ReferenceSourceBindArtifact(
    parseV3ReferenceSourceBindImporterCliArgs(process.argv.slice(2))
  );
}
