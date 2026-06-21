import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { V3DetailBoneName } from '../components/v3/v3RigDetail';

export const V3_MIXAMO_CLIP_ARTIFACT_SCHEMA = 'v3-retargeted-mixamo-clips/v1';

export const V3_MIXAMO_DEFAULT_SOURCE_FILE_NAMES = {
  idle: 'Idle.fbx',
  walk: 'Walking.fbx',
  run: 'Running.fbx',
  tPose: 'T-Pose.fbx',
} as const;

export const V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS = [
  'hammer_2hand_idle',
  'hammer_heavy_swing',
  'hammer_melee_advance',
  'sword_outward_slash',
  'hammer_smash_reference',
] as const;

export const V3_MIXAMO_WEAPON_REFERENCE_SOURCE_FILE_NAMES = {
  hammer_2hand_idle: 'hammer_2hand_idle.fbx',
  hammer_heavy_swing: 'hammer_heavy_swing.fbx',
  hammer_melee_advance: 'hammer_melee_advance.fbx',
  sword_outward_slash: 'sword_outward_slash.fbx',
  hammer_smash_reference: 'Smash.fbx',
} as const satisfies Record<V3MixamoWeaponReferenceClipId, string>;

export type V3MixamoRetargetedClipId = 'idle' | 'walk' | 'run';
export type V3MixamoWeaponReferenceClipId = (typeof V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS)[number];
export type V3MixamoWeaponReferenceRuntimeRole = 'runtimeReference' | 'analysisOnly';
export type V3MixamoQuaternionTuple = [number, number, number, number];

export interface V3MixamoJointKeyframe {
  t: number;
  rotation: [number, number, number];
  offset?: [number, number, number];
}

export interface V3MixamoJointTrack {
  joint: V3DetailBoneName;
  keyframes: V3MixamoJointKeyframe[];
}

export interface V3MixamoClipRootMotion {
  horizontalStripped: boolean;
  originalHorizontalDistance: number;
  maxRetainedHorizontalOffset: number;
  verticalRange: [number, number];
}

export interface V3MixamoClipMetrics {
  sourceTrackCount: number;
  mappedJointCount: number;
  maxAbsRotation: number;
  maxAbsPelvisOffset: number;
}

export interface V3MixamoRetargetedClip {
  id: V3MixamoRetargetedClipId;
  label: string;
  source: 'mixamo';
  sourceFileName: string;
  sourceHash: string;
  durationSeconds: number;
  fps: number;
  frameCount: number;
  rootMotion: V3MixamoClipRootMotion;
  joints: Partial<Record<V3DetailBoneName, V3MixamoJointTrack>>;
  metrics: V3MixamoClipMetrics;
}

export interface V3MixamoClipArtifact {
  schemaVersion: typeof V3_MIXAMO_CLIP_ARTIFACT_SCHEMA;
  version: 1;
  source: {
    kind: 'mixamo-fbx';
    sourceFiles: Record<V3MixamoRetargetedClipId | 'tPose', string>;
    tPoseHash: string;
    tPoseBoneCount: number;
  };
  clips: Record<V3MixamoRetargetedClipId, V3MixamoRetargetedClip>;
  metrics: {
    clipCount: number;
    totalKeyframes: number;
    maxClipFrameCount: number;
  };
}

export interface V3MixamoSanitizationReport {
  ready: boolean;
  issues: string[];
}

export interface V3MixamoWeaponReferenceJointFrame {
  rotation: [number, number, number];
  quaternion: V3MixamoQuaternionTuple;
  position: [number, number, number];
}

export interface V3MixamoWeaponReferenceJointTrack {
  rotations: [number, number, number][];
  quaternions: V3MixamoQuaternionTuple[];
  positions: [number, number, number][];
}

export interface V3MixamoWeaponReferenceRestJoint {
  quaternion: V3MixamoQuaternionTuple;
  position: [number, number, number];
}

export interface V3MixamoWeaponReferenceRestPoseArtifact {
  source: V3MixamoSourceSummary;
  joints: Partial<Record<V3DetailBoneName, V3MixamoWeaponReferenceRestJoint>>;
  metrics: {
    mappedJointCount: number;
    nonFiniteTransformCount: number;
  };
}

export interface V3MixamoWeaponReferenceClipMetrics {
  sourceTrackCount: number;
  sourceFrameCount: number;
  mappedJointCount: number;
  droppedTrackCount: number;
  handPathDistance: {
    left: number;
    right: number;
  };
  handSeparation: {
    min: number;
    max: number;
    mean: number;
  };
  shoulderMotion: {
    left: number;
    right: number;
  };
  forwardSweep: number;
  upSweep: number;
  nonFiniteTransformCount: number;
}

export interface V3MixamoWeaponReferenceClipArtifact {
  schemaVersion: 'v3-mixamo-weapon-reference-clip/v1';
  clipId: V3MixamoWeaponReferenceClipId;
  label: string;
  runtimeRole: V3MixamoWeaponReferenceRuntimeRole;
  source: V3MixamoSourceSummary;
  duration: number;
  fps: number;
  frameCount: number;
  normalizedTimes: number[];
  keyframes: Array<{
    time: number;
    normalizedTime: number;
    joints: Partial<Record<V3DetailBoneName, V3MixamoWeaponReferenceJointFrame>>;
  }>;
  joints: Partial<Record<V3DetailBoneName, V3MixamoWeaponReferenceJointTrack>>;
  metrics: V3MixamoWeaponReferenceClipMetrics;
}

export interface V3MixamoWeaponReferenceSetArtifact {
  schemaVersion: 'v3-mixamo-weapon-reference-set/v1';
  fps: number;
  sources: Record<V3MixamoWeaponReferenceClipId, V3MixamoSourceSummary>;
  restPose: V3MixamoWeaponReferenceRestPoseArtifact;
  clips: V3MixamoWeaponReferenceClipArtifact[];
  metrics: {
    sourceFileCount: 5;
    clipCount: 5;
    analysisOnlyClipCount: number;
    totalKeyframes: number;
    maxClipFrameCount: number;
  };
}

export interface BuildV3MixamoWeaponReferenceClipOptions {
  clipId: V3MixamoWeaponReferenceClipId;
  filePath: string;
  fps?: number;
}

export interface BuildV3MixamoWeaponReferenceSetOptions {
  sourceFiles: Record<V3MixamoWeaponReferenceClipId, string>;
  tPoseFilePath?: string;
  fps?: number;
}

const MIXAMO_TO_V3_JOINTS: Record<string, V3DetailBoneName> = {
  Hips: 'pelvis',
  Spine: 'spine1',
  Spine1: 'spine2',
  Spine2: 'chest',
  Neck: 'neck',
  Head: 'head',
  LeftShoulder: 'clavicleLeft',
  LeftArm: 'upperArmLeft',
  LeftForeArm: 'forearmLeft',
  LeftHand: 'handLeft',
  RightShoulder: 'clavicleRight',
  RightArm: 'upperArmRight',
  RightForeArm: 'forearmRight',
  RightHand: 'handRight',
  LeftUpLeg: 'thighLeft',
  LeftLeg: 'calfLeft',
  LeftFoot: 'footLeft',
  LeftToeBase: 'toeLeft',
  RightUpLeg: 'thighRight',
  RightLeg: 'calfRight',
  RightFoot: 'footRight',
  RightToeBase: 'toeRight',
};

const CLIP_LABELS: Record<V3MixamoRetargetedClipId, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
};

const WEAPON_REFERENCE_LABELS: Record<V3MixamoWeaponReferenceClipId, string> = {
  hammer_2hand_idle: 'Hammer 2H Idle',
  hammer_heavy_swing: 'Hammer Heavy Swing',
  hammer_melee_advance: 'Hammer Melee Advance',
  sword_outward_slash: 'Sword Outward Slash',
  hammer_smash_reference: 'Hammer Smash Reference',
};

const WEAPON_REFERENCE_RUNTIME_ROLES: Record<
  V3MixamoWeaponReferenceClipId,
  V3MixamoWeaponReferenceRuntimeRole
> = {
  hammer_2hand_idle: 'runtimeReference',
  hammer_heavy_swing: 'runtimeReference',
  hammer_melee_advance: 'runtimeReference',
  sword_outward_slash: 'runtimeReference',
  hammer_smash_reference: 'analysisOnly',
};

const WEAPON_REFERENCE_JOINTS = {
  Spine2: 'chest',
  Neck: 'neck',
  Head: 'head',
  LeftShoulder: 'clavicleLeft',
  LeftArm: 'upperArmLeft',
  LeftForeArm: 'forearmLeft',
  LeftHand: 'handLeft',
  RightShoulder: 'clavicleRight',
  RightArm: 'upperArmRight',
  RightForeArm: 'forearmRight',
  RightHand: 'handRight',
} as const satisfies Partial<Record<string, V3DetailBoneName>>;

const HIPS_MIXAMO_BONE = 'Hips';
const MIXAMO_UNIT_SCALE = 0.01;
const MAX_VERTICAL_PELVIS_OFFSET = 0.085;

type TrackMap = Map<string, THREE.KeyframeTrack>;

const round = (value: number, digits = 6): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const sha256 = (buffer: Buffer): string => (
  `sha256:${createHash('sha256').update(buffer).digest('hex')}`
);

const bufferToArrayBuffer = (buffer: Buffer): ArrayBuffer => (
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
);

const parseFbxBuffer = (buffer: Buffer): THREE.Group => (
  new FBXLoader().parse(bufferToArrayBuffer(buffer), '')
);

const trackKey = (bone: string, property: string): string => `${bone}.${property}`;

const mapAnimationTracks = (clip: THREE.AnimationClip): TrackMap => {
  const tracks = new Map<string, THREE.KeyframeTrack>();
  for (const track of clip.tracks) {
    const [rawBone, property] = track.name.split('.');
    const bone = rawBone?.replace(/^mixamorig/, '');
    if (!bone || !property) continue;
    tracks.set(trackKey(bone, property), track);
  }
  return tracks;
};

const quaternionAt = (track: THREE.KeyframeTrack, frameIndex: number): THREE.Quaternion => {
  const index = Math.min(Math.max(0, frameIndex), track.times.length - 1) * 4;
  return new THREE.Quaternion(
    Number(track.values[index] ?? 0),
    Number(track.values[index + 1] ?? 0),
    Number(track.values[index + 2] ?? 0),
    Number(track.values[index + 3] ?? 1)
  ).normalize();
};

const quaternionTuple = (quaternion: THREE.Quaternion): V3MixamoQuaternionTuple => [
  round(quaternion.x),
  round(quaternion.y),
  round(quaternion.z),
  round(quaternion.w),
];

const vectorAt = (track: THREE.KeyframeTrack, frameIndex: number): THREE.Vector3 => {
  const index = Math.min(Math.max(0, frameIndex), track.times.length - 1) * 3;
  return new THREE.Vector3(
    Number(track.values[index] ?? 0),
    Number(track.values[index + 1] ?? 0),
    Number(track.values[index + 2] ?? 0)
  );
};

const estimateFps = (clip: THREE.AnimationClip, frameCount: number): number => {
  if (clip.duration <= 0 || frameCount <= 1) return 30;
  return Math.max(1, Math.round((frameCount - 1) / clip.duration));
};

const buildPelvisOffset = (
  positionTrack: THREE.KeyframeTrack | undefined,
  frameIndex: number
): [number, number, number] | undefined => {
  if (!positionTrack || positionTrack.times.length === 0) return undefined;
  const base = vectorAt(positionTrack, 0);
  const current = vectorAt(positionTrack, frameIndex);
  const vertical = THREE.MathUtils.clamp(
    (current.y - base.y) * MIXAMO_UNIT_SCALE,
    -MAX_VERTICAL_PELVIS_OFFSET,
    MAX_VERTICAL_PELVIS_OFFSET
  );
  return [0, round(vertical), 0];
};

const measureOriginalHorizontalDistance = (
  positionTrack: THREE.KeyframeTrack | undefined
): number => {
  if (!positionTrack || positionTrack.times.length <= 1) return 0;
  let distance = 0;
  let previous = vectorAt(positionTrack, 0);
  for (let i = 1; i < positionTrack.times.length; i += 1) {
    const current = vectorAt(positionTrack, i);
    const dx = (current.x - previous.x) * MIXAMO_UNIT_SCALE;
    const dz = (current.z - previous.z) * MIXAMO_UNIT_SCALE;
    distance += Math.sqrt(dx * dx + dz * dz);
    previous = current;
  }
  return round(distance);
};

const buildJointTrack = (
  v3Joint: V3DetailBoneName,
  mixamoBone: string,
  rotationTrack: THREE.KeyframeTrack,
  pelvisPositionTrack: THREE.KeyframeTrack | undefined,
  durationSeconds: number
): V3MixamoJointTrack => {
  const base = quaternionAt(rotationTrack, 0).invert();
  const keyframes: V3MixamoJointKeyframe[] = [];
  for (let i = 0; i < rotationTrack.times.length; i += 1) {
    const delta = base.clone().multiply(quaternionAt(rotationTrack, i)).normalize();
    const euler = new THREE.Euler().setFromQuaternion(delta, 'XYZ');
    const frame: V3MixamoJointKeyframe = {
      t: durationSeconds > 0 ? round(Number(rotationTrack.times[i] ?? 0) / durationSeconds) : 0,
      rotation: [round(euler.x), round(euler.y), round(euler.z)],
    };
    if (mixamoBone === HIPS_MIXAMO_BONE) {
      const offset = buildPelvisOffset(pelvisPositionTrack, i);
      if (offset) frame.offset = offset;
    }
    keyframes.push(frame);
  }
  return { joint: v3Joint, keyframes };
};

const measureVerticalRange = (
  pelvisTrack: V3MixamoJointTrack | undefined
): [number, number] => {
  const values = pelvisTrack?.keyframes
    .map((frame) => frame.offset?.[1])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? [];
  if (values.length === 0) return [0, 0];
  return [round(Math.min(...values)), round(Math.max(...values))];
};

const maxAbs = (values: number[]): number => (
  values.length === 0 ? 0 : round(Math.max(...values.map((value) => Math.abs(value))))
);

const buildClip = (
  id: V3MixamoRetargetedClipId,
  fileName: string,
  buffer: Buffer
): V3MixamoRetargetedClip => {
  const root = parseFbxBuffer(buffer);
  const animation = root.animations[0];
  if (!animation) {
    throw new Error(`Mixamo FBX ${fileName} did not contain an animation clip.`);
  }
  const tracks = mapAnimationTracks(animation);
  const joints: Partial<Record<V3DetailBoneName, V3MixamoJointTrack>> = {};
  const pelvisPositionTrack = tracks.get(trackKey(HIPS_MIXAMO_BONE, 'position'));
  let maxFrameCount = 0;

  for (const [mixamoBone, v3Joint] of Object.entries(MIXAMO_TO_V3_JOINTS)) {
    const rotationTrack = tracks.get(trackKey(mixamoBone, 'quaternion'));
    if (!rotationTrack) continue;
    maxFrameCount = Math.max(maxFrameCount, rotationTrack.times.length);
    joints[v3Joint] = buildJointTrack(v3Joint, mixamoBone, rotationTrack, pelvisPositionTrack, animation.duration);
  }

  const allRotations = Object.values(joints).flatMap((joint) => (
    joint?.keyframes.flatMap((frame) => frame.rotation) ?? []
  ));
  const allOffsets = Object.values(joints).flatMap((joint) => (
    joint?.keyframes.flatMap((frame) => frame.offset ?? []) ?? []
  ));
  const pelvis = joints.pelvis;

  return {
    id,
    label: CLIP_LABELS[id],
    source: 'mixamo',
    sourceFileName: basename(fileName),
    sourceHash: sha256(buffer),
    durationSeconds: round(animation.duration),
    fps: estimateFps(animation, maxFrameCount),
    frameCount: maxFrameCount,
    rootMotion: {
      horizontalStripped: true,
      originalHorizontalDistance: measureOriginalHorizontalDistance(pelvisPositionTrack),
      maxRetainedHorizontalOffset: 0,
      verticalRange: measureVerticalRange(pelvis),
    },
    joints,
    metrics: {
      sourceTrackCount: animation.tracks.length,
      mappedJointCount: Object.keys(joints).length,
      maxAbsRotation: maxAbs(allRotations),
      maxAbsPelvisOffset: maxAbs(allOffsets),
    },
  };
};

const countUniqueMixamoBones = (buffer: Buffer): number => {
  const root = parseFbxBuffer(buffer);
  const names = new Set<string>();
  root.traverse((child) => {
    if (child.name?.startsWith('mixamorig')) names.add(child.name.replace(/^mixamorig/, ''));
  });
  return names.size;
};

export function buildV3MixamoClipArtifactFromBuffers(
  input: Record<V3MixamoRetargetedClipId | 'tPose', { fileName: string; buffer: Buffer }>
): V3MixamoClipArtifact {
  const clips: Record<V3MixamoRetargetedClipId, V3MixamoRetargetedClip> = {
    idle: buildClip('idle', input.idle.fileName, input.idle.buffer),
    walk: buildClip('walk', input.walk.fileName, input.walk.buffer),
    run: buildClip('run', input.run.fileName, input.run.buffer),
  };
  const allKeyframes = Object.values(clips).flatMap((clip) => (
    Object.values(clip.joints).flatMap((joint) => joint?.keyframes ?? [])
  ));

  return {
    schemaVersion: V3_MIXAMO_CLIP_ARTIFACT_SCHEMA,
    version: 1,
    source: {
      kind: 'mixamo-fbx',
      sourceFiles: {
        idle: basename(input.idle.fileName),
        walk: basename(input.walk.fileName),
        run: basename(input.run.fileName),
        tPose: basename(input.tPose.fileName),
      },
      tPoseHash: sha256(input.tPose.buffer),
      tPoseBoneCount: countUniqueMixamoBones(input.tPose.buffer),
    },
    clips,
    metrics: {
      clipCount: Object.keys(clips).length,
      totalKeyframes: allKeyframes.length,
      maxClipFrameCount: Math.max(...Object.values(clips).map((clip) => clip.frameCount)),
    },
  };
}

export function buildV3MixamoClipArtifactFromDirectory(
  directory: string
): V3MixamoClipArtifact {
  const readSource = (key: keyof typeof V3_MIXAMO_DEFAULT_SOURCE_FILE_NAMES) => {
    const fileName = V3_MIXAMO_DEFAULT_SOURCE_FILE_NAMES[key];
    return {
      fileName,
      buffer: readFileSync(join(directory, fileName)),
    };
  };
  return buildV3MixamoClipArtifactFromBuffers({
    idle: readSource('idle'),
    walk: readSource('walk'),
    run: readSource('run'),
    tPose: readSource('tPose'),
  });
}

export function validateV3MixamoClipArtifactSanitization(
  artifact: V3MixamoClipArtifact
): V3MixamoSanitizationReport {
  const serialized = JSON.stringify(artifact);
  const issues: string[] = [];
  const forbiddenPatterns: Array<[RegExp, string]> = [
    [/[A-Za-z]:\\/, 'absolute Windows path'],
    [/\/Users\/|\\Users\\|\/home\/|\/tmp\//, 'private absolute path'],
    [/mixamorig/i, 'raw Mixamo bone names'],
    [/FBXHeaderExtension|Objects:|Geometry:|Vertices:/i, 'raw FBX payload'],
    [/"(?:scene|mesh|meshes|geometry|vertices|faces|buffer|bytes|payload|raw)"/i, 'raw scene or geometry key'],
  ];
  for (const [pattern, label] of forbiddenPatterns) {
    if (pattern.test(serialized)) issues.push(`artifact contains ${label}`);
  }
  for (const clip of Object.values(artifact.clips)) {
    if (clip.rootMotion.horizontalStripped !== true) {
      issues.push(`${clip.id} did not strip horizontal root motion`);
    }
    if (!/^sha256:[0-9a-f]{64}$/.test(clip.sourceHash)) {
      issues.push(`${clip.id} source hash is invalid`);
    }
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(artifact.source.tPoseHash)) {
    issues.push('T-pose source hash is invalid');
  }
  return {
    ready: issues.length === 0,
    issues,
  };
}

export function buildV3MixamoGeneratedSource(artifact: V3MixamoClipArtifact): string {
  const validation = validateV3MixamoClipArtifactSanitization(artifact);
  if (!validation.ready) {
    throw new Error(`Refusing to generate unsanitized V3 Mixamo clip source: ${validation.issues.join(', ')}`);
  }
  return [
    '/* eslint-disable */',
    '// Generated by src/tools/generateV3MixamoClips.ts.',
    '// Source Mixamo FBX files stay private/local; this file contains sanitized retargeted clip data only.',
    '',
    `export const V3_MIXAMO_CLIP_ARTIFACT = ${JSON.stringify(artifact)} as const;`,
    '',
  ].join('\n');
}

export type V3MixamoClipId = V3MixamoRetargetedClipId;

export interface V3MixamoSourceSummary {
  fileName: string;
  sha256: string;
  byteLength: number;
}

export interface V3MixamoSingleJointTrack {
  rotations: [number, number, number][];
  offsets?: [number, number, number][];
}

export interface V3MixamoSingleClipArtifact {
  schemaVersion: 'v3-mixamo-clip/v1';
  clipId: V3MixamoClipId;
  source: V3MixamoSourceSummary;
  duration: number;
  fps: number;
  frameCount: number;
  normalizedTimes: number[];
  keyframes: Array<{
    time: number;
    normalizedTime: number;
    joints: Partial<Record<V3DetailBoneName, {
      rotation: [number, number, number];
      offset?: [number, number, number];
    }>>;
  }>;
  joints: Partial<Record<V3DetailBoneName, V3MixamoSingleJointTrack>>;
  metrics: {
    sourceTrackCount: number;
    sourceFrameCount: number;
    mappedJointCount: number;
    droppedTrackCount: number;
    rootMotion: {
      horizontalStripped: boolean;
      strippedAxes: ['x', 'z'];
      maxSourceHorizontalOffset: number;
      maxHorizontalOffset: number;
      maxVerticalPelvisOffset: number;
    };
  };
}

export interface V3MixamoClipSetArtifact {
  schemaVersion: 'v3-mixamo-clip-set/v1';
  fps: number;
  sources: Record<V3MixamoClipId | 'tPose', V3MixamoSourceSummary>;
  clips: V3MixamoSingleClipArtifact[];
  metrics: {
    sourceFileCount: 4;
    clipCount: 3;
    tPoseDeduped: boolean;
    tPoseFrameCount: number;
    tPoseDuration: number;
  };
}

export interface BuildV3MixamoClipOptions {
  clipId: V3MixamoClipId;
  filePath: string;
  fps?: number;
}

export interface BuildV3MixamoClipSetOptions {
  sourceFiles: Record<V3MixamoClipId | 'tPose', string>;
  fps?: number;
}

const sourceSummary = (filePath: string, buffer: Buffer): V3MixamoSourceSummary => ({
  fileName: basename(filePath),
  sha256: createHash('sha256').update(buffer).digest('hex'),
  byteLength: buffer.byteLength,
});

const maxVerticalOffset = (
  joints: Partial<Record<V3DetailBoneName, V3MixamoSingleJointTrack>>
): number => {
  const offsets = Object.values(joints).flatMap((joint) => joint?.offsets?.map((offset) => offset[1]) ?? []);
  return maxAbs(offsets);
};

const toSingleClipArtifact = (
  clip: V3MixamoRetargetedClip,
  source: V3MixamoSourceSummary,
  fps: number
): V3MixamoSingleClipArtifact => {
  const joints = Object.fromEntries(
    Object.entries(clip.joints).map(([jointName, jointTrack]) => [
      jointName,
      {
        rotations: jointTrack?.keyframes.map((frame) => frame.rotation) ?? [],
        ...(jointTrack?.keyframes.some((frame) => frame.offset)
          ? { offsets: jointTrack.keyframes.map((frame) => frame.offset ?? [0, 0, 0]) }
          : {}),
      },
    ])
  ) as Partial<Record<V3DetailBoneName, V3MixamoSingleJointTrack>>;
  const pelvisTimes = clip.joints.pelvis?.keyframes.map((frame) => frame.t) ?? [];

  return {
    schemaVersion: 'v3-mixamo-clip/v1',
    clipId: clip.id,
    source,
    duration: clip.durationSeconds,
    fps,
    frameCount: clip.frameCount,
    normalizedTimes: pelvisTimes,
    keyframes: pelvisTimes.map((normalizedTime, frameIndex) => {
      const frameJoints: V3MixamoSingleClipArtifact['keyframes'][number]['joints'] = {};
      for (const [jointName, jointTrack] of Object.entries(clip.joints) as [V3DetailBoneName, V3MixamoJointTrack][]) {
        const frame = jointTrack.keyframes[Math.min(frameIndex, jointTrack.keyframes.length - 1)];
        if (!frame) continue;
        frameJoints[jointName] = frame.offset
          ? { rotation: frame.rotation, offset: frame.offset }
          : { rotation: frame.rotation };
      }
      return {
        time: round(normalizedTime * clip.durationSeconds),
        normalizedTime,
        joints: frameJoints,
      };
    }),
    joints,
    metrics: {
      sourceTrackCount: clip.metrics.sourceTrackCount,
      sourceFrameCount: clip.frameCount,
      mappedJointCount: clip.metrics.mappedJointCount,
      droppedTrackCount: Math.max(0, clip.metrics.sourceTrackCount - clip.metrics.mappedJointCount - 1),
      rootMotion: {
        horizontalStripped: clip.rootMotion.horizontalStripped,
        strippedAxes: ['x', 'z'],
        maxSourceHorizontalOffset: clip.rootMotion.originalHorizontalDistance,
        maxHorizontalOffset: clip.rootMotion.maxRetainedHorizontalOffset,
        maxVerticalPelvisOffset: maxVerticalOffset(joints),
      },
    },
  };
};

export function buildV3MixamoClipArtifact(options: BuildV3MixamoClipOptions): V3MixamoSingleClipArtifact {
  const buffer = readFileSync(options.filePath);
  const clip = buildClip(options.clipId, options.filePath, buffer);
  return toSingleClipArtifact(clip, sourceSummary(options.filePath, buffer), options.fps ?? clip.fps);
}

export function buildV3MixamoClipSetArtifact(options: BuildV3MixamoClipSetOptions): V3MixamoClipSetArtifact {
  const fps = options.fps ?? 30;
  const clips = [
    buildV3MixamoClipArtifact({ clipId: 'idle', filePath: options.sourceFiles.idle, fps }),
    buildV3MixamoClipArtifact({ clipId: 'walk', filePath: options.sourceFiles.walk, fps }),
    buildV3MixamoClipArtifact({ clipId: 'run', filePath: options.sourceFiles.run, fps }),
  ];
  const tPoseBuffer = readFileSync(options.sourceFiles.tPose);
  const tPoseRoot = parseFbxBuffer(tPoseBuffer);
  const tPoseClip = tPoseRoot.animations[0];

  return {
    schemaVersion: 'v3-mixamo-clip-set/v1',
    fps,
    sources: {
      idle: clips[0].source,
      walk: clips[1].source,
      run: clips[2].source,
      tPose: sourceSummary(options.sourceFiles.tPose, tPoseBuffer),
    },
    clips,
    metrics: {
      sourceFileCount: 4,
      clipCount: 3,
      tPoseDeduped: true,
      tPoseFrameCount: tPoseClip?.tracks[0]?.times.length ?? 0,
      tPoseDuration: round(tPoseClip?.duration ?? 0),
    },
  };
}

const collectMixamoBones = (root: THREE.Object3D): Map<string, THREE.Object3D> => {
  const bones = new Map<string, THREE.Object3D>();
  root.traverse((child) => {
    const name = child.name?.replace(/^mixamorig/, '');
    if (name) bones.set(name, child);
  });
  return bones;
};

const normalizedFrameTimes = (animation: THREE.AnimationClip, tracks: TrackMap): number[] => {
  const preferredTrack = tracks.get(trackKey('Spine2', 'quaternion')) ?? animation.tracks[0];
  const times = preferredTrack?.times;
  if (!times || times.length === 0) return [0];
  return Array.from(times, (time) => (
    animation.duration > 0 ? round(Number(time) / animation.duration) : 0
  ));
};

const quaternionAtNormalizedTime = (
  track: THREE.KeyframeTrack | undefined,
  normalizedTime: number
): THREE.Quaternion => {
  if (!track || track.times.length === 0) return new THREE.Quaternion();
  const index = Math.max(0, Math.min(track.times.length - 1, Math.round(normalizedTime * (track.times.length - 1))));
  return quaternionAt(track, index);
};

const finiteTuple = (values: readonly number[]): boolean => values.every(Number.isFinite);

const pathLength = (positions: readonly (readonly [number, number, number])[]): number => {
  let distance = 0;
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1];
    const current = positions[index];
    distance += Math.sqrt(
      (current[0] - previous[0]) ** 2 +
      (current[1] - previous[1]) ** 2 +
      (current[2] - previous[2]) ** 2
    );
  }
  return round(distance);
};

const rotationPathLength = (rotations: readonly (readonly [number, number, number])[]): number => {
  let distance = 0;
  for (let index = 1; index < rotations.length; index += 1) {
    const previous = rotations[index - 1];
    const current = rotations[index];
    distance += Math.sqrt(
      (current[0] - previous[0]) ** 2 +
      (current[1] - previous[1]) ** 2 +
      (current[2] - previous[2]) ** 2
    );
  }
  return round(distance);
};

const axisRange = (
  positions: readonly (readonly [number, number, number])[],
  axisIndex: 0 | 1 | 2
): number => {
  if (positions.length === 0) return 0;
  const values = positions.map((position) => position[axisIndex]);
  return round(Math.max(...values) - Math.min(...values));
};

const measureHandSeparation = (
  left: readonly (readonly [number, number, number])[],
  right: readonly (readonly [number, number, number])[]
): V3MixamoWeaponReferenceClipMetrics['handSeparation'] => {
  const count = Math.min(left.length, right.length);
  if (count === 0) return { min: 0, max: 0, mean: 0 };
  const distances: number[] = [];
  for (let index = 0; index < count; index += 1) {
    distances.push(Math.sqrt(
      (left[index][0] - right[index][0]) ** 2 +
      (left[index][1] - right[index][1]) ** 2 +
      (left[index][2] - right[index][2]) ** 2
    ));
  }
  return {
    min: round(Math.min(...distances)),
    max: round(Math.max(...distances)),
    mean: round(distances.reduce((total, value) => total + value, 0) / distances.length),
  };
};

const countNonFiniteReferenceTransforms = (
  keyframes: V3MixamoWeaponReferenceClipArtifact['keyframes']
): number => {
  let count = 0;
  for (const keyframe of keyframes) {
    for (const joint of Object.values(keyframe.joints)) {
      if (!joint) continue;
      if (!finiteTuple(joint.position) || !finiteTuple(joint.rotation) || !finiteTuple(joint.quaternion)) count += 1;
    }
  }
  return count;
};

const buildWeaponReferenceRestPose = (
  filePath: string,
  buffer: Buffer
): V3MixamoWeaponReferenceRestPoseArtifact => {
  const root = parseFbxBuffer(buffer);
  const animation = root.animations[0];
  if (animation) {
    const mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(animation).play();
    mixer.setTime(0);
  }
  root.updateMatrixWorld(true);
  const bones = collectMixamoBones(root);
  const chest = bones.get('Spine2');
  const chestWorldPosition = chest?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const inverseChestWorldQuaternion = (chest?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion())
    .invert();
  const joints: V3MixamoWeaponReferenceRestPoseArtifact['joints'] = {};

  for (const [mixamoBone, v3Joint] of Object.entries(WEAPON_REFERENCE_JOINTS) as [string, V3DetailBoneName][]) {
    const bone = bones.get(mixamoBone);
    if (!bone) continue;
    const worldPosition = bone.getWorldPosition(new THREE.Vector3());
    const chestSpace = mixamoBone === 'Spine2'
      ? new THREE.Vector3()
      : worldPosition.sub(chestWorldPosition).applyQuaternion(inverseChestWorldQuaternion).multiplyScalar(MIXAMO_UNIT_SCALE);
    joints[v3Joint] = {
      quaternion: quaternionTuple(bone.quaternion.clone().normalize()),
      position: [round(chestSpace.x), round(chestSpace.y), round(chestSpace.z)],
    };
  }

  const nonFiniteTransformCount = Object.values(joints).filter((joint) => (
    !joint ||
    !finiteTuple(joint.position) ||
    !finiteTuple(joint.quaternion)
  )).length;

  return {
    source: sourceSummary(filePath, buffer),
    joints,
    metrics: {
      mappedJointCount: Object.keys(joints).length,
      nonFiniteTransformCount,
    },
  };
};

const buildWeaponReferenceClipFromBuffer = (
  clipId: V3MixamoWeaponReferenceClipId,
  filePath: string,
  buffer: Buffer,
  fps: number | undefined
): V3MixamoWeaponReferenceClipArtifact => {
  const root = parseFbxBuffer(buffer);
  const animation = root.animations[0];
  if (!animation) {
    throw new Error(`Mixamo weapon reference FBX ${filePath} did not contain an animation clip.`);
  }

  const tracks = mapAnimationTracks(animation);
  const bones = collectMixamoBones(root);
  const normalizedTimes = normalizedFrameTimes(animation, tracks);
  const frameTimes = normalizedTimes.map((normalizedTime) => normalizedTime * animation.duration);
  const mixer = new THREE.AnimationMixer(root);
  mixer.clipAction(animation).play();
  const baseQuaternions = new Map<string, THREE.Quaternion>();
  for (const mixamoBone of Object.keys(WEAPON_REFERENCE_JOINTS)) {
    baseQuaternions.set(
      mixamoBone,
      quaternionAtNormalizedTime(tracks.get(trackKey(mixamoBone, 'quaternion')), 0).invert()
    );
  }

  const keyframes: V3MixamoWeaponReferenceClipArtifact['keyframes'] = [];
  for (let frameIndex = 0; frameIndex < normalizedTimes.length; frameIndex += 1) {
    const normalizedTime = normalizedTimes[frameIndex];
    const time = frameTimes[frameIndex];
    mixer.setTime(time);
    root.updateMatrixWorld(true);

    const chest = bones.get('Spine2');
    const chestWorldPosition = chest?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
    const inverseChestWorldQuaternion = (chest?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion())
      .invert();
    const joints: V3MixamoWeaponReferenceClipArtifact['keyframes'][number]['joints'] = {};

    for (const [mixamoBone, v3Joint] of Object.entries(WEAPON_REFERENCE_JOINTS) as [string, V3DetailBoneName][]) {
      const bone = bones.get(mixamoBone);
      const rotationTrack = tracks.get(trackKey(mixamoBone, 'quaternion'));
      if (!bone || !rotationTrack) continue;
      const delta = (baseQuaternions.get(mixamoBone) ?? new THREE.Quaternion())
        .clone()
        .multiply(quaternionAtNormalizedTime(rotationTrack, normalizedTime))
        .normalize();
      const sourceQuaternion = quaternionAtNormalizedTime(rotationTrack, normalizedTime);
      const euler = new THREE.Euler().setFromQuaternion(delta, 'XYZ');
      const worldPosition = bone.getWorldPosition(new THREE.Vector3());
      const chestSpace = mixamoBone === 'Spine2'
        ? new THREE.Vector3()
        : worldPosition.sub(chestWorldPosition).applyQuaternion(inverseChestWorldQuaternion).multiplyScalar(MIXAMO_UNIT_SCALE);
      joints[v3Joint] = {
        rotation: [round(euler.x), round(euler.y), round(euler.z)],
        quaternion: quaternionTuple(sourceQuaternion),
        position: [round(chestSpace.x), round(chestSpace.y), round(chestSpace.z)],
      };
    }

    keyframes.push({
      time: round(time),
      normalizedTime,
      joints,
    });
  }

  const joints = {} as Partial<Record<V3DetailBoneName, V3MixamoWeaponReferenceJointTrack>>;
  for (const v3Joint of Object.values(WEAPON_REFERENCE_JOINTS)) {
    const frames = keyframes
      .map((keyframe) => keyframe.joints[v3Joint])
      .filter((frame): frame is V3MixamoWeaponReferenceJointFrame => frame !== undefined);
    if (frames.length === 0) continue;
    joints[v3Joint] = {
      rotations: frames.map((frame) => frame.rotation),
      quaternions: frames.map((frame) => frame.quaternion),
      positions: frames.map((frame) => frame.position),
    };
  }

  const leftHandPositions = joints.handLeft?.positions ?? [];
  const rightHandPositions = joints.handRight?.positions ?? [];
  const rightHandForwardRange = axisRange(rightHandPositions, 2);
  const rightHandUpRange = axisRange(rightHandPositions, 1);

  return {
    schemaVersion: 'v3-mixamo-weapon-reference-clip/v1',
    clipId,
    label: WEAPON_REFERENCE_LABELS[clipId],
    runtimeRole: WEAPON_REFERENCE_RUNTIME_ROLES[clipId],
    source: sourceSummary(filePath, buffer),
    duration: round(animation.duration),
    fps: fps ?? estimateFps(animation, normalizedTimes.length),
    frameCount: normalizedTimes.length,
    normalizedTimes,
    keyframes,
    joints,
    metrics: {
      sourceTrackCount: animation.tracks.length,
      sourceFrameCount: normalizedTimes.length,
      mappedJointCount: Object.keys(joints).length,
      droppedTrackCount: Math.max(0, animation.tracks.length - Object.keys(joints).length),
      handPathDistance: {
        left: pathLength(leftHandPositions),
        right: pathLength(rightHandPositions),
      },
      handSeparation: measureHandSeparation(leftHandPositions, rightHandPositions),
      shoulderMotion: {
        left: rotationPathLength(joints.clavicleLeft?.rotations ?? []),
        right: rotationPathLength(joints.clavicleRight?.rotations ?? []),
      },
      forwardSweep: rightHandForwardRange,
      upSweep: rightHandUpRange,
      nonFiniteTransformCount: countNonFiniteReferenceTransforms(keyframes),
    },
  };
};

export function buildV3MixamoWeaponReferenceClipArtifact(
  options: BuildV3MixamoWeaponReferenceClipOptions
): V3MixamoWeaponReferenceClipArtifact {
  const buffer = readFileSync(options.filePath);
  return buildWeaponReferenceClipFromBuffer(options.clipId, options.filePath, buffer, options.fps);
}

export function buildV3MixamoWeaponReferenceSetArtifact(
  options: BuildV3MixamoWeaponReferenceSetOptions
): V3MixamoWeaponReferenceSetArtifact {
  const fps = options.fps ?? 30;
  const firstSourcePath = options.sourceFiles[V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS[0]];
  const tPoseFilePath = options.tPoseFilePath ?? join(dirname(firstSourcePath), V3_MIXAMO_DEFAULT_SOURCE_FILE_NAMES.tPose);
  const tPoseBuffer = readFileSync(tPoseFilePath);
  const restPose = buildWeaponReferenceRestPose(tPoseFilePath, tPoseBuffer);
  const clips = V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS.map((clipId) => (
    buildV3MixamoWeaponReferenceClipArtifact({
      clipId,
      filePath: options.sourceFiles[clipId],
      fps,
    })
  ));
  return {
    schemaVersion: 'v3-mixamo-weapon-reference-set/v1',
    fps,
    sources: Object.fromEntries(clips.map((clip) => [clip.clipId, clip.source])) as Record<
      V3MixamoWeaponReferenceClipId,
      V3MixamoSourceSummary
    >,
    restPose,
    clips,
    metrics: {
      sourceFileCount: 5,
      clipCount: 5,
      analysisOnlyClipCount: clips.filter((clip) => clip.runtimeRole === 'analysisOnly').length,
      totalKeyframes: clips.reduce((total, clip) => total + clip.keyframes.length, 0),
      maxClipFrameCount: Math.max(0, ...clips.map((clip) => clip.frameCount)),
    },
  };
}
