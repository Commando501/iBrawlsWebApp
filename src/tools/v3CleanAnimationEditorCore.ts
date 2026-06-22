import * as THREE from 'three';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  exportV3AuthoredClipToJson,
  normalizeV3AuthoredClipExport as normalizeAuthoredClipExport,
  type V3AuthoredClipExport,
  type V3AuthoredClipId,
  type V3AuthoredKeyframe,
} from '../components/grifball/v3AuthoredAnimationClips';
import type {
  V3CleanJointName,
  V3QuatTuple,
  V3Vec3Tuple,
} from '../components/grifball/v3CleanRig';
import { V3_DETAIL_BONE_NAMES } from '../components/v3/v3RigDetail';

export interface V3CleanEditorSelection {
  target: 'joint' | 'root' | 'weapon' | 'socketMarker';
  joint?: V3CleanJointName;
  socketMarker?: 'primary' | 'offhand';
}

export interface V3CleanEditorFrameDraft {
  frame: number;
  keyframe: V3AuthoredKeyframe;
}

export interface V3CleanEditorDocument {
  version: typeof ATLAS_EDITOR_EXPORT_VERSION;
  clip: V3AuthoredClipExport;
  selection: V3CleanEditorSelection;
  clipboardFrame?: V3AuthoredKeyframe;
}

const JOINT_NAMES = new Set<string>(V3_DETAIL_BONE_NAMES);
const IDENTITY_QUAT: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];

const cloneVec3 = (value: readonly number[] | undefined, fallback: V3Vec3Tuple = ZERO_VEC3): V3Vec3Tuple => [
  Number.isFinite(value?.[0]) ? Number(value?.[0]) : fallback[0],
  Number.isFinite(value?.[1]) ? Number(value?.[1]) : fallback[1],
  Number.isFinite(value?.[2]) ? Number(value?.[2]) : fallback[2],
];

const cloneQuat = (value: readonly number[] | undefined): V3QuatTuple => {
  const quaternion = new THREE.Quaternion(
    Number.isFinite(value?.[0]) ? Number(value?.[0]) : 0,
    Number.isFinite(value?.[1]) ? Number(value?.[1]) : 0,
    Number.isFinite(value?.[2]) ? Number(value?.[2]) : 0,
    Number.isFinite(value?.[3]) ? Number(value?.[3]) : 1
  );
  if (quaternion.lengthSq() < 0.000001) return [...IDENTITY_QUAT];
  quaternion.normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const eulerToQuat = (euler: readonly [number, number, number]): V3QuatTuple => {
  const quaternion = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(euler[0], euler[1], euler[2], 'XYZ'))
    .normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w];
};

const quatToEuler = (quaternion: readonly number[]): [number, number, number] => {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]).normalize(),
    'XYZ'
  );
  return [euler.x, euler.y, euler.z];
};

const validateJoint = (joint: V3CleanJointName): void => {
  if (!JOINT_NAMES.has(joint)) {
    throw new Error(`Unknown V3 clean rig joint: ${joint}`);
  }
};

const cloneKeyframe = (keyframe: V3AuthoredKeyframe): V3AuthoredKeyframe => ({
  frame: keyframe.frame,
  ...(keyframe.label ? { label: keyframe.label } : {}),
  ...(keyframe.rootOffset ? { rootOffset: cloneVec3(keyframe.rootOffset) } : {}),
  jointQuaternions: Object.fromEntries(
    Object.entries(keyframe.jointQuaternions).map(([joint, quaternion]) => [
      joint,
      cloneQuat(quaternion),
    ])
  ) as Partial<Record<V3CleanJointName, V3QuatTuple>>,
  ...(keyframe.weaponPose ? {
    weaponPose: {
      ...keyframe.weaponPose,
      position: cloneVec3(keyframe.weaponPose.position),
      rotation: cloneVec3(keyframe.weaponPose.rotation),
      ...(keyframe.weaponPose.primarySocketMarker ? {
        primarySocketMarker: cloneVec3(keyframe.weaponPose.primarySocketMarker),
      } : {}),
      ...(keyframe.weaponPose.offhandSocketMarker ? {
        offhandSocketMarker: cloneVec3(keyframe.weaponPose.offhandSocketMarker),
      } : {}),
    },
  } : {}),
  ...(keyframe.socketLockMarkers ? {
    socketLockMarkers: {
      ...(keyframe.socketLockMarkers.primary ? {
        primary: cloneVec3(keyframe.socketLockMarkers.primary),
      } : {}),
      ...(keyframe.socketLockMarkers.offhand ? {
        offhand: cloneVec3(keyframe.socketLockMarkers.offhand),
      } : {}),
    },
  } : {}),
});

const cloneClip = (clip: V3AuthoredClipExport): V3AuthoredClipExport =>
  normalizeAuthoredClipExport({
    ...clip,
    keyframes: clip.keyframes.map(cloneKeyframe),
  });

const clampFrame = (clip: V3AuthoredClipExport, frame: number): number =>
  Math.max(0, Math.min(clip.durationFrames, Math.round(Number.isFinite(frame) ? frame : 0)));

const findKeyframe = (clip: V3AuthoredClipExport, frame: number): V3AuthoredKeyframe | undefined =>
  clip.keyframes.find((keyframe) => keyframe.frame === frame);

const frameAtOrBefore = (clip: V3AuthoredClipExport, frame: number): V3AuthoredKeyframe =>
  [...clip.keyframes].reverse().find((keyframe) => keyframe.frame <= frame) ?? clip.keyframes[0];

const upsertKeyframe = (
  clip: V3AuthoredClipExport,
  frame: number,
  mutate: (keyframe: V3AuthoredKeyframe) => V3AuthoredKeyframe
): V3AuthoredClipExport => {
  const normalized = cloneClip(clip);
  const safeFrame = clampFrame(normalized, frame);
  const base = findKeyframe(normalized, safeFrame)
    ?? { ...cloneKeyframe(frameAtOrBefore(normalized, safeFrame)), frame: safeFrame };
  const edited = mutate(cloneKeyframe(base));
  const keyedByFrame = new Map(normalized.keyframes.map((keyframe) => [keyframe.frame, keyframe]));
  keyedByFrame.set(safeFrame, { ...edited, frame: safeFrame });
  return normalizeAuthoredClipExport({
    ...normalized,
    keyframes: [...keyedByFrame.values()],
  });
};

const mirrorJointName = (joint: V3CleanJointName): V3CleanJointName => {
  if (joint.endsWith('Left')) return joint.replace(/Left$/, 'Right') as V3CleanJointName;
  if (joint.endsWith('Right')) return joint.replace(/Right$/, 'Left') as V3CleanJointName;
  return joint;
};

const mirrorQuaternion = (quaternion: readonly number[]): V3QuatTuple => {
  const euler = quatToEuler(quaternion);
  return eulerToQuat([euler[0], -euler[1], -euler[2]]);
};

export const normalizeV3AuthoredClipExport = normalizeAuthoredClipExport;

export function createV3CleanEditorDocument(clipId: V3AuthoredClipId): V3CleanEditorDocument {
  const clip = normalizeAuthoredClipExport(exportV3AuthoredClipToJson(clipId));
  return {
    version: ATLAS_EDITOR_EXPORT_VERSION,
    clip,
    selection: {
      target: 'joint',
      joint: 'chest',
    },
  };
}

export function getV3CleanEditorFrameDraft(
  clip: V3AuthoredClipExport,
  frame: number
): V3CleanEditorFrameDraft {
  const normalized = cloneClip(clip);
  const safeFrame = clampFrame(normalized, frame);
  const keyframe = findKeyframe(normalized, safeFrame)
    ?? { ...cloneKeyframe(frameAtOrBefore(normalized, safeFrame)), frame: safeFrame };
  return { frame: safeFrame, keyframe };
}

export function setV3CleanEditorJointEuler(
  clip: V3AuthoredClipExport,
  input: { frame: number; joint: V3CleanJointName; euler: [number, number, number] }
): V3AuthoredClipExport {
  validateJoint(input.joint);
  return upsertKeyframe(clip, input.frame, (keyframe) => ({
    ...keyframe,
    jointQuaternions: {
      ...keyframe.jointQuaternions,
      [input.joint]: eulerToQuat(input.euler),
    },
  }));
}

export function setV3CleanEditorRootOffset(
  clip: V3AuthoredClipExport,
  input: { frame: number; rootOffset: V3Vec3Tuple }
): V3AuthoredClipExport {
  return upsertKeyframe(clip, input.frame, (keyframe) => ({
    ...keyframe,
    rootOffset: cloneVec3(input.rootOffset),
  }));
}

export function setV3CleanEditorWeaponPose(
  clip: V3AuthoredClipExport,
  input: {
    frame: number;
    weapon: 'hammer' | 'sword' | 'pistol';
    position: V3Vec3Tuple;
    rotation: V3Vec3Tuple;
    primarySocketMarker?: V3Vec3Tuple;
    offhandSocketMarker?: V3Vec3Tuple;
  }
): V3AuthoredClipExport {
  return upsertKeyframe(clip, input.frame, (keyframe) => ({
    ...keyframe,
    weaponPose: {
      weapon: input.weapon,
      position: cloneVec3(input.position),
      rotation: cloneVec3(input.rotation),
      source: 'authoredCleanClip',
      ...(input.primarySocketMarker ? { primarySocketMarker: cloneVec3(input.primarySocketMarker) } : {}),
      ...(input.offhandSocketMarker ? { offhandSocketMarker: cloneVec3(input.offhandSocketMarker) } : {}),
    },
  }));
}

export function clearV3CleanEditorWeaponPose(
  clip: V3AuthoredClipExport,
  frame: number
): V3AuthoredClipExport {
  return upsertKeyframe(clip, frame, (keyframe) => {
    const next = cloneKeyframe(keyframe);
    delete next.weaponPose;
    return next;
  });
}

export function resetV3CleanEditorJoint(
  clip: V3AuthoredClipExport,
  input: { frame: number; joint: V3CleanJointName }
): V3AuthoredClipExport {
  validateJoint(input.joint);
  return upsertKeyframe(clip, input.frame, (keyframe) => {
    const jointQuaternions = { ...keyframe.jointQuaternions };
    delete jointQuaternions[input.joint];
    return { ...keyframe, jointQuaternions };
  });
}

export function resetV3CleanEditorFrame(
  clip: V3AuthoredClipExport,
  frame: number
): V3AuthoredClipExport {
  return upsertKeyframe(clip, frame, (keyframe) => ({
    frame: keyframe.frame,
    ...(keyframe.label ? { label: keyframe.label } : {}),
    jointQuaternions: {},
  }));
}

export function deleteV3CleanEditorKeyframe(
  clip: V3AuthoredClipExport,
  frame: number
): V3AuthoredClipExport {
  const normalized = cloneClip(clip);
  const safeFrame = clampFrame(normalized, frame);
  const nextKeyframes = normalized.keyframes.filter((keyframe) => keyframe.frame !== safeFrame);
  return normalizeAuthoredClipExport({
    ...normalized,
    keyframes: nextKeyframes.length > 0 ? nextKeyframes : [{ frame: 0, jointQuaternions: {} }],
  });
}

export function copyV3CleanEditorFrame(
  clip: V3AuthoredClipExport,
  frame: number
): V3AuthoredKeyframe {
  return cloneKeyframe(getV3CleanEditorFrameDraft(clip, frame).keyframe);
}

export function pasteV3CleanEditorFrame(
  clip: V3AuthoredClipExport,
  input: { frame: number; keyframe: V3AuthoredKeyframe }
): V3AuthoredClipExport {
  return upsertKeyframe(clip, input.frame, () => ({
    ...cloneKeyframe(input.keyframe),
    frame: clampFrame(clip, input.frame),
  }));
}

export function mirrorV3CleanRigPoseFrame(keyframe: V3AuthoredKeyframe): V3AuthoredKeyframe {
  const mirroredJoints: Partial<Record<V3CleanJointName, V3QuatTuple>> = {};
  for (const [jointName, quaternion] of Object.entries(keyframe.jointQuaternions)) {
    const joint = jointName as V3CleanJointName;
    validateJoint(joint);
    mirroredJoints[mirrorJointName(joint)] = mirrorQuaternion(quaternion as V3QuatTuple);
  }
  return {
    ...cloneKeyframe(keyframe),
    ...(keyframe.rootOffset ? {
      rootOffset: [-keyframe.rootOffset[0], keyframe.rootOffset[1], keyframe.rootOffset[2]] as V3Vec3Tuple,
    } : {}),
    jointQuaternions: mirroredJoints,
    ...(keyframe.weaponPose ? {
      weaponPose: {
        ...keyframe.weaponPose,
        position: [-keyframe.weaponPose.position[0], keyframe.weaponPose.position[1], keyframe.weaponPose.position[2]],
        rotation: [
          keyframe.weaponPose.rotation[0],
          -keyframe.weaponPose.rotation[1],
          -keyframe.weaponPose.rotation[2],
        ],
      },
    } : {}),
  };
}

export function mirrorV3CleanEditorFrame(
  clip: V3AuthoredClipExport,
  frame: number
): V3AuthoredClipExport {
  const draft = getV3CleanEditorFrameDraft(clip, frame);
  return pasteV3CleanEditorFrame(clip, {
    frame: draft.frame,
    keyframe: mirrorV3CleanRigPoseFrame(draft.keyframe),
  });
}
