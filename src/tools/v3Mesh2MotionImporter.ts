import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import * as THREE from 'three';
import type {
  V3CleanJointName,
  V3QuatTuple,
  V3Vec3Tuple,
} from '../components/grifball/v3CleanRig';
import {
  V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
  V3_MESH2MOTION_PART_BINDING_SPECS,
  isV3Mesh2MotionNativeArmChainSlot,
  type V3Mesh2MotionArmorRigArtifact,
  type V3Mesh2MotionArmorSlotPlacement,
} from '../components/v3/v3Mesh2MotionArmorRigContract';
import { deriveV3CanonicalRigContract } from '../components/v3/v3CanonicalRigContract';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
} from '../components/v3/v3ModelTypes';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  type V3DetailBoneName,
} from '../components/v3/v3RigDetail';

export const V3_MESH2MOTION_CLIP_SET_SCHEMA = 'v3-mesh2motion-clip-set/v3';

export const V3_MESH2MOTION_SOURCE_CLIP_NAMES = [
  'Slide_Exit',
  'Slide_Loop',
  'Slide_Start',
  'Sprint_Loop',
  'Sword_Dash_RM',
  'Sword_Idle',
  'Sword_Regular_B',
  'TPose',
  'Throw Object',
] as const;

export type V3Mesh2MotionSourceClipName = (typeof V3_MESH2MOTION_SOURCE_CLIP_NAMES)[number];

export const V3_MESH2MOTION_CLEAN_CLIP_BINDINGS = {
  clean_sprint: 'Sprint_Loop',
  clean_slide: 'Slide_Loop',
  clean_sword_carry: 'Sword_Idle',
  clean_sword_lunge: 'Sword_Dash_RM',
  clean_sword_slash: 'Sword_Regular_B',
} as const satisfies Partial<Record<V3CleanJointName | string, V3Mesh2MotionSourceClipName>>;

export interface V3Mesh2MotionSourceSummary {
  kind: 'mesh2motion-glb';
  fileName: string;
  sha256: string;
  generator: string | null;
}

export interface V3Mesh2MotionSkeletonJoint {
  name: string;
  parent: string | null;
  targetJoints: V3DetailBoneName[];
  role: 'direct' | 'virtualAttachment' | 'ignored';
  restLocalPosition: V3Vec3Tuple;
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
  restLocalQuaternion: V3QuatTuple;
}

export interface V3Mesh2MotionSkeletonArtifact {
  sourceJointCount: number;
  joints: V3Mesh2MotionSkeletonJoint[];
}

export interface V3Mesh2MotionPartBindingArtifact {
  slot: V3CharacterSlotId;
  sourceJointName: string;
  centerJointNames: string[];
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
}

export interface V3Mesh2MotionJointCalibration {
  targetJoint: V3DetailBoneName;
  sourceNodeName: string;
  sourceParentName: string | null;
  targetParent: V3DetailBoneName | null;
  role: 'direct' | 'virtualAttachment';
  basisQuaternion: V3QuatTuple;
  sourceRestWorldPosition: V3Vec3Tuple;
  sourceRestWorldQuaternion: V3QuatTuple;
  sourceRestLocalQuaternion: V3QuatTuple;
  targetRestWorldPosition: V3Vec3Tuple;
  targetRestLocalPosition: V3Vec3Tuple;
}

export interface V3Mesh2MotionCalibrationArtifact {
  kind: 'mesh2motion-v3-driver-calibration';
  version: 1;
  sourceRestClip: 'TPose';
  sourceToTargetScale: number;
  joints: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointCalibration>>;
}

export interface V3Mesh2MotionJointTrack {
  joint: V3DetailBoneName;
  quaternions: V3QuatTuple[];
}

export interface V3Mesh2MotionJointOffsetTrack {
  joint: V3DetailBoneName;
  offsets: V3Vec3Tuple[];
}

export interface V3Mesh2MotionDriverJointTrack {
  joint: string;
  positions: V3Vec3Tuple[];
  quaternions: V3QuatTuple[];
}

export interface V3Mesh2MotionRootMotionReport {
  horizontalStripped: true;
  maxSourceHorizontalOffset: number;
  maxHorizontalOffset: 0;
  verticalRange: [number, number];
}

export interface V3Mesh2MotionClipArtifact {
  sourceClipName: V3Mesh2MotionSourceClipName;
  cleanClipIds: string[];
  durationSeconds: number;
  fps: number;
  frameCount: number;
  normalizedTimes: number[];
  rootOffsets: V3Vec3Tuple[];
  rootMotion: V3Mesh2MotionRootMotionReport;
  joints: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointTrack>>;
  jointOffsets: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointOffsetTrack>>;
  driverJoints: Record<string, V3Mesh2MotionDriverJointTrack>;
  metrics: {
    sourceChannelCount: number;
    mappedJointCount: number;
    driverJointCount: number;
    sourceFrameCount: number;
    maxAbsRotation: number;
    maxAbsJointOffset: number;
  };
}

export interface V3Mesh2MotionRestPoseArtifact {
  sourceClipName: 'TPose';
  pelvisTranslation: V3Vec3Tuple;
  joints: Partial<Record<V3DetailBoneName, V3QuatTuple>>;
  jointOffsets: Partial<Record<V3DetailBoneName, V3Vec3Tuple>>;
}

export interface V3Mesh2MotionDiagnostics {
  mappedJointCount: number;
  virtualAttachmentCount: number;
  unmappedSourceJoints: string[];
  unmappedV3Joints: V3DetailBoneName[];
  maxTposePositionDrift: number;
  maxTposeRotationDrift: number;
}

export interface V3Mesh2MotionClipSetArtifact {
  schemaVersion: typeof V3_MESH2MOTION_CLIP_SET_SCHEMA;
  version: 3;
  source: V3Mesh2MotionSourceSummary;
  skeleton: V3Mesh2MotionSkeletonArtifact;
  partBindings: Record<V3CharacterSlotId, V3Mesh2MotionPartBindingArtifact>;
  calibration: V3Mesh2MotionCalibrationArtifact;
  restPose: V3Mesh2MotionRestPoseArtifact;
  cleanClipBindings: typeof V3_MESH2MOTION_CLEAN_CLIP_BINDINGS;
  clips: V3Mesh2MotionClipArtifact[];
  diagnostics: V3Mesh2MotionDiagnostics;
  metrics: {
    sourceFileCount: 1;
    clipCount: number;
    mappedJointCount: number;
    totalKeyframes: number;
    maxClipFrameCount: number;
  };
}

export interface BuildV3Mesh2MotionClipSetOptions {
  filePath: string;
  fps?: number;
}

export interface GenerateV3Mesh2MotionClipsOptions extends BuildV3Mesh2MotionClipSetOptions {
  outputPath: string;
  exportName?: string;
}

export interface GenerateV3Mesh2MotionArmorRigOptions extends BuildV3Mesh2MotionClipSetOptions {
  outputPath: string;
  exportName?: string;
}

export interface GenerateV3Mesh2MotionImporterCliOptions extends GenerateV3Mesh2MotionClipsOptions {
  rigOutputPath: string;
  rigExportName?: string;
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
    min?: number[];
    max?: number[];
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
  skins?: Array<{ joints?: number[] }>;
  animations?: Array<{
    name?: string;
    channels: Array<{
      sampler: number;
      target: {
        node: number;
        path: 'translation' | 'rotation' | 'scale' | 'weights';
      };
    }>;
    samplers: Array<{
      input: number;
      output: number;
      interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    }>;
  }>;
};

type ParsedGlb = {
  json: GltfJson;
  bin: Buffer;
  source: V3Mesh2MotionSourceSummary;
};

type ChannelTrack = {
  nodeIndex: number;
  nodeName: string;
  path: 'translation' | 'rotation' | 'scale';
  interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
  times: number[];
  values: number[][];
};

type ClipChannels = {
  name: V3Mesh2MotionSourceClipName;
  channels: ChannelTrack[];
};

type LocalTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  matrix: THREE.Matrix4;
};

type SourcePose = {
  locals: LocalTransform[];
  worlds: THREE.Matrix4[];
  worldPositions: THREE.Vector3[];
  worldQuaternions: THREE.Quaternion[];
};

type BuildContext = {
  parsed: ParsedGlb;
  clipChannels: ClipChannels[];
  tPose: ClipChannels;
  sourceRestPose: SourcePose;
  parentBySourceIndex: Map<number, number>;
  sourceIndexByName: Map<string, number>;
  sourceJointIndexes: number[];
  targetRestWorldPositions: Record<V3DetailBoneName, THREE.Vector3>;
  targetRestLocalPositions: Record<V3DetailBoneName, THREE.Vector3>;
  targetChildren: Partial<Record<V3DetailBoneName, V3DetailBoneName[]>>;
  calibration: V3Mesh2MotionCalibrationArtifact;
};

type FrameSample = {
  rootOffset: V3Vec3Tuple;
  jointQuaternions: Partial<Record<V3DetailBoneName, V3QuatTuple>>;
  jointOffsets: Partial<Record<V3DetailBoneName, V3Vec3Tuple>>;
  maxAbsRotation: number;
  maxAbsJointOffset: number;
};

type DriverLocalTransform = {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
};

type DriverFrameSample = {
  joints: Record<string, {
    position: V3Vec3Tuple;
    quaternion: V3QuatTuple;
  }>;
  localTransformsByIndex: Map<number, DriverLocalTransform>;
};

const DIRECT_MESH2MOTION_TO_V3_JOINTS: Record<string, V3DetailBoneName> = {
  pelvis: 'pelvis',
  spine_01: 'spine1',
  spine_02: 'spine2',
  spine_03: 'spine3',
  neck_01: 'neck',
  head: 'head',
  clavicle_l: 'clavicleLeft',
  upperarm_l: 'upperArmLeft',
  lowerarm_l: 'forearmLeft',
  hand_l: 'handLeft',
  clavicle_r: 'clavicleRight',
  upperarm_r: 'upperArmRight',
  lowerarm_r: 'forearmRight',
  hand_r: 'handRight',
  thigh_l: 'thighLeft',
  calf_l: 'calfLeft',
  foot_l: 'footLeft',
  ball_l: 'toeLeft',
  thigh_r: 'thighRight',
  calf_r: 'calfRight',
  foot_r: 'footRight',
  ball_r: 'toeRight',
};

const VIRTUAL_MESH2MOTION_ATTACHMENTS: Record<
  Extract<V3DetailBoneName, 'chest' | 'helmet' | 'collar' | 'backpack' | 'gripLeft' | 'gripRight'>,
  string
> = {
  chest: 'spine_03',
  helmet: 'head',
  collar: 'neck_01',
  backpack: 'spine_03',
  gripLeft: 'hand_l',
  gripRight: 'hand_r',
};

const TARGET_TO_SOURCE_NODE = Object.freeze({
  ...Object.fromEntries(Object.entries(DIRECT_MESH2MOTION_TO_V3_JOINTS).map(([source, target]) => [target, source])),
  ...VIRTUAL_MESH2MOTION_ATTACHMENTS,
}) as Record<V3DetailBoneName, string>;

const IDENTITY_QUATERNION: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];
const MAX_VERTICAL_ROOT_OFFSET = 0.4;

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

const inverseQuaternionEulerTuple = (quaternion: THREE.Quaternion): V3Vec3Tuple => {
  const inverse = quaternion.clone().invert().normalize();
  const euler = new THREE.Euler().setFromQuaternion(inverse, 'XYZ');
  return tupleVec3([euler.x, euler.y, euler.z]);
};

const vectorFromTuple = (value: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);

const sourceSummary = (filePath: string, buffer: Buffer, json: GltfJson): V3Mesh2MotionSourceSummary => ({
  kind: 'mesh2motion-glb',
  fileName: basename(filePath),
  sha256: createHash('sha256').update(buffer).digest('hex'),
  generator: json.asset?.generator ?? null,
});

const parseGlb = (filePath: string): ParsedGlb => {
  const buffer = readFileSync(filePath);
  if (buffer.toString('utf8', 0, 4) !== 'glTF') {
    throw new Error(`Mesh2Motion source is not a GLB file: ${filePath}`);
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
  if (!json || !bin) {
    throw new Error('Mesh2Motion GLB must contain JSON and BIN chunks.');
  }
  return {
    json,
    bin,
    source: sourceSummary(filePath, buffer, json),
  };
};

const accessorComponentCount = (type: string): number => {
  if (type === 'SCALAR') return 1;
  if (type === 'VEC2') return 2;
  if (type === 'VEC3') return 3;
  if (type === 'VEC4') return 4;
  if (type === 'MAT4') return 16;
  throw new Error(`Unsupported Mesh2Motion accessor type: ${type}`);
};

const readAccessorRows = (parsed: ParsedGlb, accessorIndex: number): number[][] => {
  const accessor = parsed.json.accessors?.[accessorIndex];
  if (!accessor) throw new Error(`Missing Mesh2Motion accessor ${accessorIndex}`);
  if (accessor.componentType !== 5126) {
    throw new Error(`Unsupported Mesh2Motion accessor component type: ${accessor.componentType}`);
  }
  const bufferView = parsed.json.bufferViews?.[accessor.bufferView];
  if (!bufferView) throw new Error(`Missing Mesh2Motion bufferView ${accessor.bufferView}`);
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

const nodeName = (json: GltfJson, nodeIndex: number): string =>
  json.nodes?.[nodeIndex]?.name ?? `node_${nodeIndex}`;

const collectParentMap = (json: GltfJson): Map<number, number> => {
  const parents = new Map<number, number>();
  for (const [index, node] of (json.nodes ?? []).entries()) {
    for (const child of node.children ?? []) {
      parents.set(child, index);
    }
  }
  return parents;
};

const collectSourceJointIndexes = (json: GltfJson): number[] =>
  [...new Set((json.skins ?? []).flatMap((skin) => skin.joints ?? []))]
    .filter((index) => Number.isInteger(index) && Boolean(json.nodes?.[index]))
    .sort((left, right) => left - right);

const collectClipChannels = (parsed: ParsedGlb): ClipChannels[] => {
  const byName = new Map<string, ClipChannels>();
  for (const animation of parsed.json.animations ?? []) {
    const name = animation.name;
    if (!V3_MESH2MOTION_SOURCE_CLIP_NAMES.includes(name as V3Mesh2MotionSourceClipName)) {
      continue;
    }
    const clip: ClipChannels = {
      name: name as V3Mesh2MotionSourceClipName,
      channels: [],
    };
    for (const channel of animation.channels) {
      if (channel.target.path !== 'rotation' && channel.target.path !== 'translation' && channel.target.path !== 'scale') {
        continue;
      }
      const sampler = animation.samplers[channel.sampler];
      if (!sampler) continue;
      const targetNodeName = nodeName(parsed.json, channel.target.node);
      clip.channels.push({
        nodeIndex: channel.target.node,
        nodeName: targetNodeName,
        path: channel.target.path,
        interpolation: sampler.interpolation ?? 'LINEAR',
        times: readAccessorRows(parsed, sampler.input).map((row) => row[0] ?? 0),
        values: readAccessorRows(parsed, sampler.output),
      });
    }
    byName.set(clip.name, clip);
  }

  return V3_MESH2MOTION_SOURCE_CLIP_NAMES.map((name) => {
    const clip = byName.get(name);
    if (!clip) throw new Error(`Mesh2Motion GLB is missing required animation clip: ${name}`);
    return clip;
  });
};

const findChannel = (
  clip: ClipChannels,
  nodeNameValue: string,
  path: 'translation' | 'rotation' | 'scale'
): ChannelTrack | undefined =>
  clip.channels.find((channel) => channel.nodeName === nodeNameValue && channel.path === path);

const findChannelByIndex = (
  clip: ClipChannels | undefined,
  nodeIndex: number,
  path: 'translation' | 'rotation' | 'scale'
): ChannelTrack | undefined =>
  clip?.channels.find((channel) => channel.nodeIndex === nodeIndex && channel.path === path);

const channelValueAt = (channel: ChannelTrack, index: number): number[] => {
  if (channel.interpolation === 'CUBICSPLINE') {
    return channel.values[index * 3 + 1] ?? channel.values[index * 3] ?? [];
  }
  return channel.values[index] ?? [];
};

const sampleVectorRaw = (
  channel: ChannelTrack | undefined,
  time: number,
  fallback: THREE.Vector3
): THREE.Vector3 => {
  if (!channel || channel.times.length === 0 || channel.values.length === 0) return fallback.clone();
  if (time <= channel.times[0]) return vectorFromTuple(channelValueAt(channel, 0));
  const lastIndex = channel.times.length - 1;
  if (time >= channel.times[lastIndex]) return vectorFromTuple(channelValueAt(channel, lastIndex));
  const nextIndex = channel.times.findIndex((candidate) => candidate >= time);
  const previousIndex = Math.max(0, nextIndex - 1);
  const fromTime = channel.times[previousIndex];
  const toTime = channel.times[nextIndex];
  const amount = channel.interpolation === 'STEP' || toTime === fromTime ? 0 : (time - fromTime) / (toTime - fromTime);
  return vectorFromTuple(channelValueAt(channel, previousIndex))
    .lerp(vectorFromTuple(channelValueAt(channel, nextIndex)), amount);
};

const quaternionFromRow = (row: readonly number[] | undefined): THREE.Quaternion => {
  if (!row || row.length < 4) return new THREE.Quaternion();
  const quaternion = new THREE.Quaternion(row[0], row[1], row[2], row[3]);
  return quaternion.lengthSq() > 0.000001 ? quaternion.normalize() : new THREE.Quaternion();
};

const sampleQuaternionRaw = (
  channel: ChannelTrack | undefined,
  time: number,
  fallback: THREE.Quaternion
): THREE.Quaternion => {
  if (!channel || channel.times.length === 0 || channel.values.length === 0) return fallback.clone().normalize();
  if (time <= channel.times[0]) return quaternionFromRow(channelValueAt(channel, 0));
  const lastIndex = channel.times.length - 1;
  if (time >= channel.times[lastIndex]) return quaternionFromRow(channelValueAt(channel, lastIndex));
  const nextIndex = channel.times.findIndex((candidate) => candidate >= time);
  const previousIndex = Math.max(0, nextIndex - 1);
  const fromTime = channel.times[previousIndex];
  const toTime = channel.times[nextIndex];
  const amount = channel.interpolation === 'STEP' || toTime === fromTime ? 0 : (time - fromTime) / (toTime - fromTime);
  return quaternionFromRow(channelValueAt(channel, previousIndex))
    .slerp(quaternionFromRow(channelValueAt(channel, nextIndex)), amount)
    .normalize();
};

const decomposeNodeTransform = (node: NonNullable<GltfJson['nodes']>[number]): LocalTransform => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  if (Array.isArray(node.matrix)) {
    new THREE.Matrix4().fromArray(node.matrix).decompose(position, quaternion, scale);
  } else {
    position.fromArray(node.translation ?? [0, 0, 0]);
    quaternion.fromArray(node.rotation ?? [0, 0, 0, 1]).normalize();
    scale.fromArray(node.scale ?? [1, 1, 1]);
  }
  return {
    position,
    quaternion,
    scale,
    matrix: new THREE.Matrix4().compose(position, quaternion, scale),
  };
};

const composeTransform = (
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scale: THREE.Vector3
): LocalTransform => ({
  position: position.clone(),
  quaternion: quaternion.clone().normalize(),
  scale: scale.clone(),
  matrix: new THREE.Matrix4().compose(position, quaternion, scale),
});

const sampleSourcePose = (
  parsed: ParsedGlb,
  restClip: ClipChannels,
  clip: ClipChannels,
  time: number,
  parentBySourceIndex: Map<number, number>
): SourcePose => {
  const jsonNodes = parsed.json.nodes ?? [];
  const locals = jsonNodes.map((node, nodeIndex) => {
    const base = decomposeNodeTransform(node);
    const restTranslation = sampleVectorRaw(findChannelByIndex(restClip, nodeIndex, 'translation'), 0, base.position);
    const restRotation = sampleQuaternionRaw(findChannelByIndex(restClip, nodeIndex, 'rotation'), 0, base.quaternion);
    const restScale = sampleVectorRaw(findChannelByIndex(restClip, nodeIndex, 'scale'), 0, base.scale);
    const position = sampleVectorRaw(findChannelByIndex(clip, nodeIndex, 'translation'), time, restTranslation);
    const quaternion = sampleQuaternionRaw(findChannelByIndex(clip, nodeIndex, 'rotation'), time, restRotation);
    const scale = sampleVectorRaw(findChannelByIndex(clip, nodeIndex, 'scale'), time, restScale);
    return composeTransform(position, quaternion, scale);
  });

  const worlds: THREE.Matrix4[] = new Array(jsonNodes.length);
  const sceneRoots = parsed.json.scenes?.[parsed.json.scene ?? 0]?.nodes;
  const roots = sceneRoots?.length
    ? sceneRoots
    : jsonNodes.map((_, index) => index).filter((index) => !parentBySourceIndex.has(index));
  const visit = (nodeIndex: number, parentMatrix: THREE.Matrix4 | null) => {
    worlds[nodeIndex] = parentMatrix
      ? parentMatrix.clone().multiply(locals[nodeIndex].matrix)
      : locals[nodeIndex].matrix.clone();
    for (const child of jsonNodes[nodeIndex]?.children ?? []) {
      visit(child, worlds[nodeIndex]);
    }
  };
  for (const root of roots) visit(root, null);

  const worldPositions = worlds.map((matrix) => {
    const position = new THREE.Vector3();
    return position.setFromMatrixPosition(matrix ?? new THREE.Matrix4());
  });
  const worldQuaternions = worlds.map((matrix) => {
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    (matrix ?? new THREE.Matrix4()).decompose(position, quaternion, scale);
    return quaternion.normalize();
  });

  return { locals, worlds, worldPositions, worldQuaternions };
};

const createCanonicalDetailBonePositions = (): Record<V3DetailBoneName, THREE.Vector3> => {
  const contract = deriveV3CanonicalRigContract();
  const pelvis = vectorFromTuple(contract.joints.pelvis.position);
  const chest = vectorFromTuple(contract.joints.chest.position);
  const lerp = (from: THREE.Vector3, to: THREE.Vector3, amount: number): THREE.Vector3 =>
    from.clone().lerp(to, amount);
  return {
    pelvis,
    spine1: lerp(pelvis, chest, 0.25),
    spine2: lerp(pelvis, chest, 0.52),
    spine3: lerp(pelvis, chest, 0.78),
    chest,
    neck: vectorFromTuple(contract.joints.neck.position),
    head: vectorFromTuple(contract.joints.head.position),
    helmet: vectorFromTuple(contract.slotPivots.helmet.position),
    collar: vectorFromTuple(contract.slotPivots.neck.position),
    backpack: vectorFromTuple(contract.slotPivots.back.position),
    clavicleLeft: vectorFromTuple(contract.joints.shoulderLeft.position),
    upperArmLeft: vectorFromTuple(contract.joints.shoulderLeft.position),
    forearmLeft: vectorFromTuple(contract.joints.elbowLeft.position),
    handLeft: vectorFromTuple(contract.joints.wristLeft.position),
    gripLeft: vectorFromTuple(contract.joints.gripLeft.position),
    clavicleRight: vectorFromTuple(contract.joints.shoulderRight.position),
    upperArmRight: vectorFromTuple(contract.joints.shoulderRight.position),
    forearmRight: vectorFromTuple(contract.joints.elbowRight.position),
    handRight: vectorFromTuple(contract.joints.wristRight.position),
    gripRight: vectorFromTuple(contract.joints.gripRight.position),
    thighLeft: vectorFromTuple(contract.joints.hipLeft.position),
    calfLeft: vectorFromTuple(contract.joints.kneeLeft.position),
    footLeft: vectorFromTuple(contract.joints.ankleLeft.position),
    toeLeft: vectorFromTuple(contract.joints.toeLeft.position),
    thighRight: vectorFromTuple(contract.joints.hipRight.position),
    calfRight: vectorFromTuple(contract.joints.kneeRight.position),
    footRight: vectorFromTuple(contract.joints.ankleRight.position),
    toeRight: vectorFromTuple(contract.joints.toeRight.position),
  };
};

const createTargetChildren = (): Partial<Record<V3DetailBoneName, V3DetailBoneName[]>> => {
  const children: Partial<Record<V3DetailBoneName, V3DetailBoneName[]>> = {};
  for (const joint of V3_DETAIL_BONE_NAMES) {
    const parent = V3_DETAIL_BONE_SPECS[joint].parent;
    if (!parent) continue;
    children[parent] = [...(children[parent] ?? []), joint];
  }
  return children;
};

const createTargetLocalRestPositions = (
  targetRestWorldPositions: Record<V3DetailBoneName, THREE.Vector3>
): Record<V3DetailBoneName, THREE.Vector3> => Object.fromEntries(
  V3_DETAIL_BONE_NAMES.map((joint) => {
    const parent = V3_DETAIL_BONE_SPECS[joint].parent;
    const world = targetRestWorldPositions[joint];
    return [
      joint,
      parent ? world.clone().sub(targetRestWorldPositions[parent]) : world.clone(),
    ];
  })
) as Record<V3DetailBoneName, THREE.Vector3>;

const safeUnit = (vector: THREE.Vector3, fallback = new THREE.Vector3(0, 1, 0)): THREE.Vector3 =>
  vector.lengthSq() > 1e-8 ? vector.clone().normalize() : fallback.clone().normalize();

const restDirection = (
  joint: V3DetailBoneName,
  positions: Partial<Record<V3DetailBoneName, THREE.Vector3>>,
  targetChildren: Partial<Record<V3DetailBoneName, V3DetailBoneName[]>>
): THREE.Vector3 => {
  const origin = positions[joint];
  if (!origin) return new THREE.Vector3(0, 1, 0);
  for (const child of targetChildren[joint] ?? []) {
    const childPosition = positions[child];
    if (childPosition && childPosition.distanceToSquared(origin) > 1e-8) {
      return childPosition.clone().sub(origin);
    }
  }
  const parent = V3_DETAIL_BONE_SPECS[joint].parent;
  const parentPosition = parent ? positions[parent] : undefined;
  if (parentPosition && origin.distanceToSquared(parentPosition) > 1e-8) {
    return origin.clone().sub(parentPosition);
  }
  return new THREE.Vector3(0, 1, 0);
};

const basisForJoint = (
  joint: V3DetailBoneName,
  sourcePositions: Partial<Record<V3DetailBoneName, THREE.Vector3>>,
  targetPositions: Record<V3DetailBoneName, THREE.Vector3>,
  targetChildren: Partial<Record<V3DetailBoneName, V3DetailBoneName[]>>
): THREE.Quaternion => {
  const sourceDirection = safeUnit(restDirection(joint, sourcePositions, targetChildren));
  const targetDirection = safeUnit(restDirection(joint, targetPositions, targetChildren), sourceDirection);
  return new THREE.Quaternion().setFromUnitVectors(sourceDirection, targetDirection).normalize();
};

const sourceHeight = (pose: SourcePose, sourceIndexByName: Map<string, number>): number => {
  const head = pose.worldPositions[sourceIndexByName.get('head') ?? -1];
  const leftFoot = pose.worldPositions[sourceIndexByName.get('foot_l') ?? -1];
  const rightFoot = pose.worldPositions[sourceIndexByName.get('foot_r') ?? -1];
  if (!head || !leftFoot || !rightFoot) return 1;
  const foot = leftFoot.clone().add(rightFoot).multiplyScalar(0.5);
  return Math.max(0.0001, Math.abs(head.y - foot.y));
};

const targetHeight = (targetPositions: Record<V3DetailBoneName, THREE.Vector3>): number => {
  const foot = targetPositions.footLeft.clone().add(targetPositions.footRight).multiplyScalar(0.5);
  return Math.max(0.0001, Math.abs(targetPositions.head.y - foot.y));
};

const buildCalibration = (
  parsed: ParsedGlb,
  sourceRestPose: SourcePose,
  parentBySourceIndex: Map<number, number>,
  sourceIndexByName: Map<string, number>,
  targetRestWorldPositions: Record<V3DetailBoneName, THREE.Vector3>,
  targetRestLocalPositions: Record<V3DetailBoneName, THREE.Vector3>,
  targetChildren: Partial<Record<V3DetailBoneName, V3DetailBoneName[]>>
): V3Mesh2MotionCalibrationArtifact => {
  const sourcePositionsByTarget: Partial<Record<V3DetailBoneName, THREE.Vector3>> = {};
  for (const targetJoint of V3_DETAIL_BONE_NAMES) {
    const sourceName = TARGET_TO_SOURCE_NODE[targetJoint];
    const sourceIndex = sourceIndexByName.get(sourceName);
    if (sourceIndex === undefined) continue;
    sourcePositionsByTarget[targetJoint] = sourceRestPose.worldPositions[sourceIndex].clone();
  }

  const joints: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointCalibration>> = {};
  for (const targetJoint of V3_DETAIL_BONE_NAMES) {
    const sourceNodeName = TARGET_TO_SOURCE_NODE[targetJoint];
    const sourceIndex = sourceIndexByName.get(sourceNodeName);
    if (sourceIndex === undefined) continue;
    const sourceParentIndex = parentBySourceIndex.get(sourceIndex);
    const basisQuaternion = basisForJoint(targetJoint, sourcePositionsByTarget, targetRestWorldPositions, targetChildren);
    const directTarget = DIRECT_MESH2MOTION_TO_V3_JOINTS[sourceNodeName];
    joints[targetJoint] = {
      targetJoint,
      sourceNodeName,
      sourceParentName: sourceParentIndex === undefined ? null : nodeName(parsed.json, sourceParentIndex),
      targetParent: V3_DETAIL_BONE_SPECS[targetJoint].parent ?? null,
      role: directTarget === targetJoint ? 'direct' : 'virtualAttachment',
      basisQuaternion: tupleQuat(basisQuaternion),
      sourceRestWorldPosition: tupleVec3(sourceRestPose.worldPositions[sourceIndex]),
      sourceRestWorldQuaternion: tupleQuat(sourceRestPose.worldQuaternions[sourceIndex]),
      sourceRestLocalQuaternion: tupleQuat(sourceRestPose.locals[sourceIndex].quaternion),
      targetRestWorldPosition: tupleVec3(targetRestWorldPositions[targetJoint]),
      targetRestLocalPosition: tupleVec3(targetRestLocalPositions[targetJoint]),
    };
  }

  return {
    kind: 'mesh2motion-v3-driver-calibration',
    version: 1,
    sourceRestClip: 'TPose',
    sourceToTargetScale: roundMetric(targetHeight(targetRestWorldPositions) / sourceHeight(sourceRestPose, sourceIndexByName)),
    joints,
  };
};

const buildSkeletonArtifact = (
  context: BuildContext
): V3Mesh2MotionSkeletonArtifact => {
  const targetsBySource = new Map<string, V3DetailBoneName[]>();
  for (const [targetJoint, jointCalibration] of Object.entries(context.calibration.joints) as [V3DetailBoneName, V3Mesh2MotionJointCalibration][]) {
    targetsBySource.set(jointCalibration.sourceNodeName, [
      ...(targetsBySource.get(jointCalibration.sourceNodeName) ?? []),
      targetJoint,
    ]);
  }
  const driverRest = buildDriverLocalTransforms(context, context.tPose, 0);
  const driverWorlds = composeDriverWorldTransforms(context, driverRest.localTransformsByIndex);

  return {
    sourceJointCount: context.sourceJointIndexes.length,
    joints: context.sourceJointIndexes.map((sourceIndex) => {
      const name = nodeName(context.parsed.json, sourceIndex);
      const parentIndex = context.parentBySourceIndex.get(sourceIndex);
      const targetJoints = [...(targetsBySource.get(name) ?? [])].sort((left, right) => left.localeCompare(right));
      const direct = targetJoints.some((targetJoint) => context.calibration.joints[targetJoint]?.role === 'direct');
      const driverRestJoint = driverRest.joints[name];
      const driverWorld = driverWorlds.get(sourceIndex);
      return {
        name,
        parent: parentIndex === undefined ? null : nodeName(context.parsed.json, parentIndex),
        targetJoints,
        role: targetJoints.length === 0 ? 'ignored' : direct ? 'direct' : 'virtualAttachment',
        restLocalPosition: driverRestJoint?.position ?? ZERO_VEC3,
        restWorldPosition: driverWorld ? tupleVec3(driverWorld.position) : ZERO_VEC3,
        restWorldQuaternion: driverWorld ? tupleQuat(driverWorld.quaternion) : IDENTITY_QUATERNION,
        restLocalQuaternion: driverRestJoint?.quaternion ?? IDENTITY_QUATERNION,
      };
    }),
  };
};

const buildPartBindingArtifact = (
  context: BuildContext
): Record<V3CharacterSlotId, V3Mesh2MotionPartBindingArtifact> => {
  const driverRest = buildDriverLocalTransforms(context, context.tPose, 0);
  const driverWorlds = composeDriverWorldTransforms(context, driverRest.localTransformsByIndex);
  const bindings = {} as Record<V3CharacterSlotId, V3Mesh2MotionPartBindingArtifact>;
  const worldForJoint = (jointName: string) => {
    const sourceIndex = context.sourceIndexByName.get(jointName);
    const world = sourceIndex === undefined ? undefined : driverWorlds.get(sourceIndex);
    if (!world) throw new Error(`Missing Mesh2Motion TPose world transform for ${jointName}`);
    return world;
  };

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const spec = V3_MESH2MOTION_PART_BINDING_SPECS[slot];
    const center = new THREE.Vector3();
    for (const jointName of spec.centerJointNames) {
      center.add(worldForJoint(jointName).position);
    }
    center.multiplyScalar(1 / spec.centerJointNames.length);
    bindings[slot] = {
      slot,
      sourceJointName: spec.sourceJointName,
      centerJointNames: [...spec.centerJointNames],
      restWorldPosition: tupleVec3(center),
      restWorldQuaternion: tupleQuat(worldForJoint(spec.sourceJointName).quaternion),
    };
  }

  return bindings;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WORLD_FORWARD = new THREE.Vector3(0, 0, 1);
const WORLD_RIGHT = new THREE.Vector3(1, 0, 0);

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

const slotBasisTuple = (
  xAxis: THREE.Vector3,
  yAxis: THREE.Vector3,
  zAxis: THREE.Vector3
): V3Mesh2MotionArmorSlotPlacement['basis'] => {
  const normalizedX = normalizedVector(xAxis.clone(), WORLD_RIGHT);
  const normalizedY = normalizedVector(yAxis.clone(), WORLD_UP);
  const normalizedZ = normalizedVector(zAxis.clone(), WORLD_FORWARD);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(normalizedX, normalizedY, normalizedZ)
  ).normalize();
  return {
    xAxis: tupleVec3(normalizedX),
    yAxis: tupleVec3(normalizedY),
    zAxis: tupleVec3(normalizedZ),
    quaternion: tupleQuat(quaternion),
  };
};

const slotSegmentDirection = (
  spec: { centerJointNames: readonly string[] },
  worldForJoint: (jointName: string) => Pick<LocalTransform, 'position' | 'quaternion'>
): THREE.Vector3 | null => {
  if (spec.centerJointNames.length < 2) return null;
  const from = worldForJoint(spec.centerJointNames[0]).position;
  const to = worldForJoint(spec.centerJointNames[1]).position;
  const direction = to.clone().sub(from);
  return direction.lengthSq() > 0.000001 ? direction.normalize() : null;
};

const AXIAL_ARMOR_SLOTS = new Set<V3CharacterSlotId>([
  'helmet',
  'neck',
  'chest',
  'pelvis',
  'back',
]);

const buildSlotBasis = (
  slot: V3CharacterSlotId,
  spec: { sourceJointName: string; centerJointNames: readonly string[] },
  worldForJoint: (jointName: string) => Pick<LocalTransform, 'position' | 'quaternion'>
): V3Mesh2MotionArmorSlotPlacement['basis'] => {
  if (AXIAL_ARMOR_SLOTS.has(slot)) {
    return slotBasisTuple(WORLD_RIGHT, WORLD_UP, WORLD_FORWARD);
  }

  const segment = slotSegmentDirection(spec, worldForJoint);
  if ((slot === 'footLeft' || slot === 'footRight') && segment) {
    const horizontal = segment.clone();
    horizontal.y = 0;
    const zAxis = normalizedVector(horizontal, WORLD_FORWARD);
    const yAxis = projectedAxis(WORLD_UP, zAxis, WORLD_UP);
    const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
    return slotBasisTuple(xAxis, yAxis, zAxis);
  }

  if (segment) {
    const yAxis = segment;
    const zAxis = projectedAxis(WORLD_FORWARD, yAxis, WORLD_UP);
    const xAxis = normalizedVector(yAxis.clone().cross(zAxis), WORLD_RIGHT);
    return slotBasisTuple(xAxis, yAxis, zAxis);
  }

  const quaternion = worldForJoint(spec.sourceJointName).quaternion.clone().normalize();
  return slotBasisTuple(
    WORLD_RIGHT.clone().applyQuaternion(quaternion),
    WORLD_UP.clone().applyQuaternion(quaternion),
    WORLD_FORWARD.clone().applyQuaternion(quaternion)
  );
};

const buildArmorRigSkeletonArtifact = (
  skeleton: V3Mesh2MotionSkeletonArtifact
): V3Mesh2MotionArmorRigArtifact['skeleton'] => ({
  sourceJointCount: skeleton.sourceJointCount,
  joints: skeleton.joints.map((joint) => ({
    name: joint.name,
    parent: joint.parent,
    restLocalPosition: [...joint.restLocalPosition],
    restWorldPosition: [...joint.restWorldPosition],
    restWorldQuaternion: [...joint.restWorldQuaternion],
    restLocalQuaternion: [...joint.restLocalQuaternion],
  })),
});

const buildArmorSlotPlacementArtifact = (
  context: BuildContext
): Record<V3CharacterSlotId, V3Mesh2MotionArmorSlotPlacement> => {
  const driverRest = buildDriverLocalTransforms(context, context.tPose, 0);
  const driverWorlds = composeDriverWorldTransforms(context, driverRest.localTransformsByIndex);
  const canonicalContract = deriveV3CanonicalRigContract();
  const placements = {} as Record<V3CharacterSlotId, V3Mesh2MotionArmorSlotPlacement>;
  const worldForJoint = (jointName: string) => {
    const sourceIndex = context.sourceIndexByName.get(jointName);
    const world = sourceIndex === undefined ? undefined : driverWorlds.get(sourceIndex);
    if (!world) throw new Error(`Missing Mesh2Motion TPose world transform for ${jointName}`);
    return world;
  };

  for (const slot of V3_CHARACTER_SLOT_IDS) {
    const spec = V3_MESH2MOTION_PART_BINDING_SPECS[slot];
    const center = new THREE.Vector3();
    for (const jointName of spec.centerJointNames) {
      center.add(worldForJoint(jointName).position);
    }
    center.multiplyScalar(1 / spec.centerJointNames.length);
    const basis = buildSlotBasis(slot, spec, worldForJoint);
    const pivotWorldQuaternion = basis.quaternion;
    const pivotQuaternion = new THREE.Quaternion(...pivotWorldQuaternion).normalize();
    const nativeArmChainSlot = isV3Mesh2MotionNativeArmChainSlot(slot);
    const geometryWorldCenter = nativeArmChainSlot
      ? center.clone()
      : new THREE.Vector3().fromArray(canonicalContract.slotGeometryOffsets[slot].geometryCenter);
    const geometryLocalPosition = geometryWorldCenter
      .sub(center)
      .applyQuaternion(pivotQuaternion.clone().invert());
    const geometryLocalRotation = nativeArmChainSlot
      ? inverseQuaternionEulerTuple(pivotQuaternion)
      : ZERO_VEC3;
    placements[slot] = {
      slot,
      sourceJointName: spec.sourceJointName,
      endJointName: spec.endJointName,
      centerJointNames: [...spec.centerJointNames],
      pivotCenter: tupleVec3(center),
      pivotWorldPosition: tupleVec3(center),
      pivotWorldQuaternion,
      basis,
      geometry: {
        position: tupleVec3(geometryLocalPosition),
        rotation: geometryLocalRotation,
        scale: [1, 1, 1],
      },
    };
  }

  return placements;
};

const clipDuration = (clip: ClipChannels): number => Math.max(
  0,
  ...clip.channels.flatMap((channel) => channel.times)
);

const sampleTimesForClip = (clip: ClipChannels): number[] => {
  const preferred = findChannel(clip, 'pelvis', 'rotation')
    ?? clip.channels.find((channel) => channel.path === 'rotation')
    ?? clip.channels[0];
  if (!preferred) return [0];
  return preferred.times.length > 0 ? preferred.times : [0];
};

const cleanClipIdsForSource = (sourceClipName: V3Mesh2MotionSourceClipName): string[] =>
  Object.entries(V3_MESH2MOTION_CLEAN_CLIP_BINDINGS)
    .filter(([, candidate]) => candidate === sourceClipName)
    .map(([cleanClipId]) => cleanClipId);

const sourcePelvisDelta = (
  context: BuildContext,
  pose: SourcePose
): THREE.Vector3 => {
  const pelvisIndex = context.sourceIndexByName.get('pelvis');
  if (pelvisIndex === undefined) return new THREE.Vector3();
  return pose.worldPositions[pelvisIndex].clone().sub(context.sourceRestPose.worldPositions[pelvisIndex]);
};

const driverPelvisLocalPosition = (
  context: BuildContext,
  pose: SourcePose
): THREE.Vector3 | null => {
  const pelvisIndex = context.sourceIndexByName.get('pelvis');
  if (pelvisIndex === undefined) return null;
  const pelvisDelta = sourcePelvisDelta(context, pose);
  const inverseScale = context.calibration.sourceToTargetScale > 0
    ? 1 / context.calibration.sourceToTargetScale
    : 1;
  const verticalOffset = THREE.MathUtils.clamp(
    pelvisDelta.y,
    -MAX_VERTICAL_ROOT_OFFSET * inverseScale,
    MAX_VERTICAL_ROOT_OFFSET * inverseScale
  );
  const desiredWorldPosition = context.sourceRestPose.worldPositions[pelvisIndex]
    .clone()
    .add(new THREE.Vector3(0, verticalOffset, 0));
  const parentIndex = context.parentBySourceIndex.get(pelvisIndex);
  if (parentIndex === undefined) return desiredWorldPosition;
  const parentWorld = pose.worlds[parentIndex];
  if (!parentWorld) return pose.locals[pelvisIndex].position.clone();
  return desiredWorldPosition.applyMatrix4(parentWorld.clone().invert());
};

const buildDriverLocalTransforms = (
  context: BuildContext,
  clip: ClipChannels,
  time: number,
  sourceJointIndexes: readonly number[] = context.sourceJointIndexes
): DriverFrameSample => {
  const pose = sampleSourcePose(context.parsed, context.tPose, clip, time, context.parentBySourceIndex);
  const scale = context.calibration.sourceToTargetScale;
  const pelvisIndex = context.sourceIndexByName.get('pelvis');
  const pelvisLocalPosition = driverPelvisLocalPosition(context, pose);
  const localTransformsByIndex = new Map<number, DriverLocalTransform>();
  const joints: DriverFrameSample['joints'] = {};

  for (const sourceIndex of sourceJointIndexes) {
    const sourceName = nodeName(context.parsed.json, sourceIndex);
    const local = pose.locals[sourceIndex];
    const position = sourceIndex === pelvisIndex && pelvisLocalPosition
      ? pelvisLocalPosition.clone()
      : local.position.clone();
    position.multiplyScalar(scale);
    const quaternion = local.quaternion.clone().normalize();
    localTransformsByIndex.set(sourceIndex, { position, quaternion });
    joints[sourceName] = {
      position: tupleVec3(position),
      quaternion: tupleQuat(quaternion),
    };
  }

  return { joints, localTransformsByIndex };
};

const collectRuntimeDriverJointIndexes = (context: BuildContext): number[] => {
  const requiredIndexes = new Set<number>();
  const addWithAncestors = (sourceIndex: number | undefined) => {
    if (sourceIndex === undefined || requiredIndexes.has(sourceIndex)) return;
    requiredIndexes.add(sourceIndex);
    addWithAncestors(context.parentBySourceIndex.get(sourceIndex));
  };
  for (const sourceNodeName of new Set(Object.values(TARGET_TO_SOURCE_NODE))) {
    addWithAncestors(context.sourceIndexByName.get(sourceNodeName));
  }
  return context.sourceJointIndexes.filter((sourceIndex) => requiredIndexes.has(sourceIndex));
};

const composeDriverWorldTransforms = (
  context: BuildContext,
  localTransformsByIndex: Map<number, DriverLocalTransform>
): Map<number, { matrix: THREE.Matrix4; position: THREE.Vector3; quaternion: THREE.Quaternion }> => {
  const worlds = new Map<number, { matrix: THREE.Matrix4; position: THREE.Vector3; quaternion: THREE.Quaternion }>();
  const visiting = new Set<number>();
  const compose = (sourceIndex: number) => {
    const existing = worlds.get(sourceIndex);
    if (existing) return existing;
    if (visiting.has(sourceIndex)) {
      throw new Error(`Mesh2Motion source skeleton contains a parent cycle at ${nodeName(context.parsed.json, sourceIndex)}`);
    }
    visiting.add(sourceIndex);
    const local = localTransformsByIndex.get(sourceIndex);
    if (!local) throw new Error(`Missing Mesh2Motion driver local transform for ${nodeName(context.parsed.json, sourceIndex)}`);
    const localMatrix = new THREE.Matrix4().compose(
      local.position,
      local.quaternion,
      new THREE.Vector3(1, 1, 1)
    );
    const parentIndex = context.parentBySourceIndex.get(sourceIndex);
    const parentWorld = parentIndex === undefined || !localTransformsByIndex.has(parentIndex)
      ? null
      : compose(parentIndex).matrix;
    const matrix = parentWorld ? parentWorld.clone().multiply(localMatrix) : localMatrix;
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    matrix.decompose(position, quaternion, scale);
    const world = { matrix, position, quaternion: quaternion.normalize() };
    worlds.set(sourceIndex, world);
    visiting.delete(sourceIndex);
    return world;
  };

  for (const sourceIndex of context.sourceJointIndexes) compose(sourceIndex);
  return worlds;
};

const buildFrameSample = (
  context: BuildContext,
  clip: ClipChannels,
  time: number
): FrameSample => {
  const pose = sampleSourcePose(context.parsed, context.tPose, clip, time, context.parentBySourceIndex);
  const pelvisDelta = sourcePelvisDelta(context, pose);
  const scale = context.calibration.sourceToTargetScale;
  const verticalOffset = THREE.MathUtils.clamp(pelvisDelta.y * scale, -MAX_VERTICAL_ROOT_OFFSET, MAX_VERTICAL_ROOT_OFFSET);
  const horizontalPelvisDelta = new THREE.Vector3(pelvisDelta.x, 0, pelvisDelta.z);

  const desiredWorldPositions: Partial<Record<V3DetailBoneName, THREE.Vector3>> = {};
  const localQuaternions: Partial<Record<V3DetailBoneName, THREE.Quaternion>> = {};
  let maxAbsRotation = 0;

  for (const jointName of V3_DETAIL_BONE_NAMES) {
    const jointCalibration = context.calibration.joints[jointName];
    if (!jointCalibration) continue;
    const sourceIndex = context.sourceIndexByName.get(jointCalibration.sourceNodeName);
    if (sourceIndex === undefined) continue;

    const sourceRestPosition = context.sourceRestPose.worldPositions[sourceIndex];
    const sourceAnimatedPosition = pose.worldPositions[sourceIndex];
    const positionDelta = sourceAnimatedPosition.clone()
      .sub(sourceRestPosition)
      .sub(horizontalPelvisDelta)
      .multiplyScalar(scale);
    desiredWorldPositions[jointName] = context.targetRestWorldPositions[jointName].clone().add(positionDelta);

    const sourceRestLocal = context.sourceRestPose.locals[sourceIndex].quaternion.clone().normalize();
    const sourceAnimatedLocal = pose.locals[sourceIndex].quaternion.clone().normalize();
    const sourceDelta = sourceRestLocal.invert().multiply(sourceAnimatedLocal).normalize();
    const basis = new THREE.Quaternion(...jointCalibration.basisQuaternion).normalize();
    const localQuaternion = basis.clone()
      .multiply(sourceDelta)
      .multiply(basis.clone().invert())
      .normalize();
    localQuaternions[jointName] = localQuaternion;
    maxAbsRotation = Math.max(maxAbsRotation, localQuaternion.angleTo(new THREE.Quaternion()));
  }

  const jointQuaternions: Partial<Record<V3DetailBoneName, V3QuatTuple>> = {};
  const jointOffsets: Partial<Record<V3DetailBoneName, V3Vec3Tuple>> = {};
  const worldPositions: Partial<Record<V3DetailBoneName, THREE.Vector3>> = {};
  const worldRotations: Partial<Record<V3DetailBoneName, THREE.Quaternion>> = {};
  let maxAbsJointOffset = 0;

  for (const jointName of V3_DETAIL_BONE_NAMES) {
    const jointCalibration = context.calibration.joints[jointName];
    if (!jointCalibration) continue;
    const parent = V3_DETAIL_BONE_SPECS[jointName].parent;
    const localQuaternion = localQuaternions[jointName] ?? new THREE.Quaternion();
    const parentWorldPosition = parent ? worldPositions[parent] : undefined;
    const parentWorldRotation = parent ? worldRotations[parent] : undefined;
    const targetWorldPosition = desiredWorldPositions[jointName] ?? context.targetRestWorldPositions[jointName].clone();
    const targetLocalPosition = parentWorldPosition && parentWorldRotation
      ? targetWorldPosition.clone()
        .sub(parentWorldPosition)
        .applyQuaternion(parentWorldRotation.clone().invert())
      : targetWorldPosition.clone();
    const localOffset = jointName === 'pelvis'
      ? new THREE.Vector3()
      : targetLocalPosition.sub(context.targetRestLocalPositions[jointName]);
    const worldRotation = parentWorldRotation
      ? parentWorldRotation.clone().multiply(localQuaternion).normalize()
      : localQuaternion.clone().normalize();

    worldPositions[jointName] = targetWorldPosition;
    worldRotations[jointName] = worldRotation;
    jointQuaternions[jointName] = tupleQuat(localQuaternion);
    jointOffsets[jointName] = tupleVec3(localOffset);
    maxAbsJointOffset = Math.max(maxAbsJointOffset, Math.abs(localOffset.x), Math.abs(localOffset.y), Math.abs(localOffset.z));
  }

  return {
    rootOffset: [0, roundMetric(verticalOffset), 0],
    jointQuaternions,
    jointOffsets,
    maxAbsRotation: roundMetric(maxAbsRotation),
    maxAbsJointOffset: roundMetric(maxAbsJointOffset),
  };
};

const measureSourceHorizontalOffset = (
  context: BuildContext,
  clip: ClipChannels,
  sampleTimes: readonly number[]
): number => {
  const pelvisIndex = context.sourceIndexByName.get('pelvis');
  if (pelvisIndex === undefined) return 0;
  let maxSourceHorizontalOffset = 0;
  for (const time of sampleTimes) {
    const pose = sampleSourcePose(context.parsed, context.tPose, clip, time, context.parentBySourceIndex);
    const delta = pose.worldPositions[pelvisIndex].clone().sub(context.sourceRestPose.worldPositions[pelvisIndex]);
    maxSourceHorizontalOffset = Math.max(maxSourceHorizontalOffset, Math.sqrt(delta.x * delta.x + delta.z * delta.z));
  }
  return roundMetric(maxSourceHorizontalOffset * context.calibration.sourceToTargetScale);
};

const buildRestPose = (
  context: BuildContext,
  tPose: ClipChannels
): V3Mesh2MotionRestPoseArtifact => {
  const restFrame = buildFrameSample(context, tPose, 0);
  const pelvisChannel = findChannel(tPose, 'pelvis', 'translation');
  const pelvisTranslation = pelvisChannel
    ? tupleVec3(sampleVectorRaw(pelvisChannel, 0, new THREE.Vector3()))
    : ZERO_VEC3;
  return {
    sourceClipName: 'TPose',
    pelvisTranslation,
    joints: restFrame.jointQuaternions,
    jointOffsets: restFrame.jointOffsets,
  };
};

const buildClipArtifact = (
  context: BuildContext,
  clip: ClipChannels,
  fps: number
): V3Mesh2MotionClipArtifact => {
  const durationSeconds = clipDuration(clip);
  const sampleTimes = sampleTimesForClip(clip);
  const normalizedTimes = sampleTimes.map((time) => (
    durationSeconds > 0 ? roundMetric(time / durationSeconds) : 0
  ));
  const frameSamples = sampleTimes.map((time) => buildFrameSample(context, clip, time));
  const runtimeDriverJointIndexes = collectRuntimeDriverJointIndexes(context);
  const driverFrameSamples = sampleTimes.map((time) => buildDriverLocalTransforms(
    context,
    clip,
    time,
    runtimeDriverJointIndexes
  ));
  const rootOffsets = frameSamples.map((sample) => sample.rootOffset);
  const verticalValues = rootOffsets.map((offset) => offset[1]);
  const joints: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointTrack>> = {};
  const jointOffsets: Partial<Record<V3DetailBoneName, V3Mesh2MotionJointOffsetTrack>> = {};
  const driverJoints: Record<string, V3Mesh2MotionDriverJointTrack> = {};

  for (const jointName of V3_DETAIL_BONE_NAMES) {
    joints[jointName] = {
      joint: jointName,
      quaternions: frameSamples.map((sample) => sample.jointQuaternions[jointName] ?? IDENTITY_QUATERNION),
    };
    jointOffsets[jointName] = {
      joint: jointName,
      offsets: frameSamples.map((sample) => sample.jointOffsets[jointName] ?? ZERO_VEC3),
    };
  }
  for (const sourceIndex of runtimeDriverJointIndexes) {
    const sourceJointName = nodeName(context.parsed.json, sourceIndex);
    driverJoints[sourceJointName] = {
      joint: sourceJointName,
      positions: driverFrameSamples.map((sample) => sample.joints[sourceJointName]?.position ?? ZERO_VEC3),
      quaternions: driverFrameSamples.map((sample) => sample.joints[sourceJointName]?.quaternion ?? IDENTITY_QUATERNION),
    };
  }

  return {
    sourceClipName: clip.name,
    cleanClipIds: cleanClipIdsForSource(clip.name),
    durationSeconds: roundMetric(durationSeconds),
    fps,
    frameCount: sampleTimes.length,
    normalizedTimes,
    rootOffsets,
    rootMotion: {
      horizontalStripped: true,
      maxSourceHorizontalOffset: measureSourceHorizontalOffset(context, clip, sampleTimes),
      maxHorizontalOffset: 0,
      verticalRange: [
        roundMetric(Math.min(0, ...verticalValues)),
        roundMetric(Math.max(0, ...verticalValues)),
      ],
    },
    joints,
    jointOffsets,
    driverJoints,
    metrics: {
      sourceChannelCount: clip.channels.length,
      mappedJointCount: Object.keys(joints).length,
      driverJointCount: Object.keys(driverJoints).length,
      sourceFrameCount: sampleTimes.length,
      maxAbsRotation: roundMetric(Math.max(...frameSamples.map((sample) => sample.maxAbsRotation))),
      maxAbsJointOffset: roundMetric(Math.max(...frameSamples.map((sample) => sample.maxAbsJointOffset))),
    },
  };
};

const buildContext = (parsed: ParsedGlb): BuildContext => {
  const clipChannels = collectClipChannels(parsed);
  const tPose = clipChannels.find((clip) => clip.name === 'TPose');
  if (!tPose) throw new Error('Mesh2Motion GLB is missing required TPose clip.');
  const parentBySourceIndex = collectParentMap(parsed.json);
  const sourceIndexByName = new Map((parsed.json.nodes ?? []).map((source, index) => [source.name ?? `node_${index}`, index]));
  const sourceJointIndexes = collectSourceJointIndexes(parsed.json);
  const sourceRestPose = sampleSourcePose(parsed, tPose, tPose, 0, parentBySourceIndex);
  const targetRestWorldPositions = createCanonicalDetailBonePositions();
  const targetRestLocalPositions = createTargetLocalRestPositions(targetRestWorldPositions);
  const targetChildren = createTargetChildren();
  const calibration = buildCalibration(
    parsed,
    sourceRestPose,
    parentBySourceIndex,
    sourceIndexByName,
    targetRestWorldPositions,
    targetRestLocalPositions,
    targetChildren
  );
  return {
    parsed,
    clipChannels,
    tPose,
    sourceRestPose,
    parentBySourceIndex,
    sourceIndexByName,
    sourceJointIndexes,
    targetRestWorldPositions,
    targetRestLocalPositions,
    targetChildren,
    calibration,
  };
};

const buildDiagnostics = (
  context: BuildContext,
  skeleton: V3Mesh2MotionSkeletonArtifact,
  tPoseClip: V3Mesh2MotionClipArtifact
): V3Mesh2MotionDiagnostics => {
  const mappedSourceNames = new Set(Object.values(context.calibration.joints)
    .map((joint) => joint?.sourceNodeName)
    .filter((value): value is string => Boolean(value)));
  const unmappedSourceJoints = skeleton.joints
    .map((joint) => joint.name)
    .filter((name) => !mappedSourceNames.has(name));
  return {
    mappedJointCount: Object.keys(context.calibration.joints).length,
    virtualAttachmentCount: Object.values(context.calibration.joints)
      .filter((joint) => joint?.role === 'virtualAttachment').length,
    unmappedSourceJoints,
    unmappedV3Joints: V3_DETAIL_BONE_NAMES.filter((joint) => !context.calibration.joints[joint]),
    maxTposePositionDrift: tPoseClip.metrics.maxAbsJointOffset,
    maxTposeRotationDrift: tPoseClip.metrics.maxAbsRotation,
  };
};

export function buildV3Mesh2MotionClipSetArtifact(
  options: BuildV3Mesh2MotionClipSetOptions
): V3Mesh2MotionClipSetArtifact {
  const parsed = parseGlb(options.filePath);
  const context = buildContext(parsed);
  const fps = options.fps ?? 30;
  const skeleton = buildSkeletonArtifact(context);
  const partBindings = buildPartBindingArtifact(context);
  const restPose = buildRestPose(context, context.tPose);
  const clips = context.clipChannels.map((clip) => buildClipArtifact(context, clip, fps));
  const tPoseClip = clips.find((clip) => clip.sourceClipName === 'TPose') ?? clips[0];
  return {
    schemaVersion: V3_MESH2MOTION_CLIP_SET_SCHEMA,
    version: 3,
    source: parsed.source,
    skeleton,
    partBindings,
    calibration: context.calibration,
    restPose,
    cleanClipBindings: V3_MESH2MOTION_CLEAN_CLIP_BINDINGS,
    clips,
    diagnostics: buildDiagnostics(context, skeleton, tPoseClip),
    metrics: {
      sourceFileCount: 1,
      clipCount: clips.length,
      mappedJointCount: Math.max(...clips.map((clip) => clip.metrics.mappedJointCount)),
      totalKeyframes: clips.reduce((total, clip) => total + clip.frameCount, 0),
      maxClipFrameCount: Math.max(...clips.map((clip) => clip.frameCount)),
    },
  };
}

export function buildV3Mesh2MotionArmorRigArtifact(
  options: BuildV3Mesh2MotionClipSetOptions
): V3Mesh2MotionArmorRigArtifact {
  const parsed = parseGlb(options.filePath);
  const context = buildContext(parsed);
  const skeleton = buildSkeletonArtifact(context);
  return {
    schemaVersion: V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
    version: 1,
    source: parsed.source,
    skeleton: buildArmorRigSkeletonArtifact(skeleton),
    slots: buildArmorSlotPlacementArtifact(context),
  };
}

export function buildV3Mesh2MotionGeneratedSource(
  artifact: V3Mesh2MotionClipSetArtifact,
  exportName = 'V3_MESH2MOTION_CLIP_SET'
): string {
  const serialized = JSON.stringify(artifact);
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/[A-Za-z]:\\/, 'absolute Windows path'],
    [/\/Users\/|\\Users\\|\/home\/|\/tmp\//, 'private absolute path'],
    [/bufferView|accessors|meshes|skins|nodes|ArrayBuffer/i, 'raw GLB payload'],
  ];
  const issues = forbiddenPatterns
    .filter(([pattern]) => pattern.test(serialized))
    .map(([, label]) => label);
  if (issues.length > 0) {
    throw new Error(`Refusing to generate unsanitized V3 Mesh2Motion clips: ${issues.join(', ')}`);
  }
  return [
    '/* eslint-disable */',
    '// Generated by src/tools/generateV3Mesh2MotionClips.ts. Do not edit by hand.',
    '// Source Mesh2Motion GLB files stay private/local; this file contains sanitized animation data only.',
    `export const ${exportName} = ${JSON.stringify(artifact, null, 2)} as const;`,
    '',
  ].join('\n');
}

export function buildV3Mesh2MotionArmorRigGeneratedSource(
  artifact: V3Mesh2MotionArmorRigArtifact,
  exportName = 'V3_MESH2MOTION_ARMOR_RIG'
): string {
  const serialized = JSON.stringify(artifact);
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/[A-Za-z]:\\/, 'absolute Windows path'],
    [/\/Users\/|\\Users\\|\/home\/|\/tmp\//, 'private absolute path'],
    [/bufferView|accessors|meshes|skins|nodes|ArrayBuffer/i, 'raw GLB payload'],
  ];
  const issues = forbiddenPatterns
    .filter(([pattern]) => pattern.test(serialized))
    .map(([, label]) => label);
  if (issues.length > 0) {
    throw new Error(`Refusing to generate unsanitized V3 Mesh2Motion armor rig: ${issues.join(', ')}`);
  }
  return [
    '/* eslint-disable */',
    '// Generated by src/tools/v3Mesh2MotionImporter.ts. Do not edit by hand.',
    '// Source Mesh2Motion GLB files stay private/local; this file contains sanitized TPose armor rig data only.',
    `export const ${exportName} = ${JSON.stringify(artifact, null, 2)} as const;`,
    '',
  ].join('\n');
}

export function generateV3Mesh2MotionClipsSourceFile(
  options: GenerateV3Mesh2MotionClipsOptions
): V3Mesh2MotionClipSetArtifact {
  const artifact = buildV3Mesh2MotionClipSetArtifact(options);
  writeFileSync(
    options.outputPath,
    buildV3Mesh2MotionGeneratedSource(artifact, options.exportName),
    'utf8'
  );
  return artifact;
}

export function generateV3Mesh2MotionArmorRigSourceFile(
  options: GenerateV3Mesh2MotionArmorRigOptions
): V3Mesh2MotionArmorRigArtifact {
  const artifact = buildV3Mesh2MotionArmorRigArtifact(options);
  writeFileSync(
    options.outputPath,
    buildV3Mesh2MotionArmorRigGeneratedSource(artifact, options.exportName),
    'utf8'
  );
  return artifact;
}

export function parseV3Mesh2MotionImporterCliArgs(argv: readonly string[]): GenerateV3Mesh2MotionImporterCliOptions {
  const inputIndex = argv.indexOf('--input');
  const outputIndex = argv.indexOf('--out');
  const rigOutputIndex = argv.indexOf('--rig-out');
  const filePath = inputIndex >= 0
    ? argv[inputIndex + 1]
    : 'reference/mesh2motion-v3/exported-model.glb';
  const outputPath = outputIndex >= 0
    ? argv[outputIndex + 1]
    : 'src/components/grifball/v3Mesh2MotionClips.generated.ts';
  const rigOutputPath = rigOutputIndex >= 0
    ? argv[rigOutputIndex + 1]
    : 'src/components/v3/v3Mesh2MotionArmorRig.generated.ts';
  if (!filePath || !outputPath || !rigOutputPath) {
    throw new Error('Usage: node --import tsx src/tools/v3Mesh2MotionImporter.ts --input <mesh2motion glb> --out <clips generated ts path> --rig-out <armor rig generated ts path>');
  }
  readFileSync(resolve(filePath));
  return {
    filePath: resolve(filePath),
    outputPath: resolve(outputPath),
    rigOutputPath: resolve(rigOutputPath),
    fps: 30,
  };
}

if (process.argv[1]?.endsWith('v3Mesh2MotionImporter.ts')) {
  const args = parseV3Mesh2MotionImporterCliArgs(process.argv.slice(2));
  const artifact = generateV3Mesh2MotionClipsSourceFile(args);
  const armorRig = generateV3Mesh2MotionArmorRigSourceFile({
    filePath: args.filePath,
    outputPath: args.rigOutputPath,
    exportName: args.rigExportName,
    fps: args.fps,
  });
  // eslint-disable-next-line no-console
  console.log(`Generated ${artifact.metrics.clipCount} V3 Mesh2Motion driver clips (${artifact.metrics.totalKeyframes} keyframes).`);
  // eslint-disable-next-line no-console
  console.log(`Generated V3 Mesh2Motion armor rig with ${armorRig.skeleton.joints.length} joints and ${Object.keys(armorRig.slots).length} slots.`);
}
