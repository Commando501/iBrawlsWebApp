import * as THREE from 'three';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  exportV3AuthoredClipToJson,
  normalizeV3AuthoredClipExport as normalizeAuthoredClipExport,
  sampleV3AuthoredClipData,
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

export interface V3CleanEditorHistory {
  past: V3AuthoredClipExport[];
  present: V3AuthoredClipExport;
  future: V3AuthoredClipExport[];
  savedJson: string;
  dirty: boolean;
}

export interface V3CleanEditorLoopRange {
  inFrame: number;
  outFrame: number;
}

export interface V3CleanEditorPosePreset {
  id: string;
  label: string;
  clipId: V3AuthoredClipId;
  normalizedTime: number;
}

export interface V3CleanEditorCustomClipRecord {
  storageId: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  sourceClipId: V3AuthoredClipId;
  clip: V3AuthoredClipExport;
}

export type V3CleanEditorValidationSeverity = 'info' | 'warning' | 'error';

export interface V3CleanEditorValidationItem {
  severity: V3CleanEditorValidationSeverity;
  code: string;
  frame?: number;
  target?: string;
  message: string;
}

export interface V3CleanEditorValidationReport {
  ok: boolean;
  summary: string;
  items: V3CleanEditorValidationItem[];
}

const JOINT_NAMES = new Set<string>(V3_DETAIL_BONE_NAMES);
const IDENTITY_QUAT: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];

export const V3_CLEAN_EDITOR_POSE_LIBRARY: V3CleanEditorPosePreset[] = [
  { id: 'guard', label: 'Guard', clipId: 'clean_sword_carry', normalizedTime: 0 },
  { id: 'hammer-windup', label: 'Windup', clipId: 'clean_hammer_windup', normalizedTime: 1 },
  { id: 'hammer-strike', label: 'Strike', clipId: 'clean_hammer_strike', normalizedTime: 0.58 },
  { id: 'recoil', label: 'Recoil', clipId: 'clean_hammer_recover', normalizedTime: 0 },
  { id: 'reload', label: 'Reload', clipId: 'clean_pistol_carry', normalizedTime: 0 },
  { id: 'idle-hands', label: 'Idle Hands', clipId: 'clean_idle', normalizedTime: 0 },
];

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

const serializedClip = (clip: V3AuthoredClipExport): string => JSON.stringify(cloneClip(clip));

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

export function createV3CleanEditorHistory(clip: V3AuthoredClipExport): V3CleanEditorHistory {
  const present = cloneClip(clip);
  const savedJson = serializedClip(present);
  return {
    past: [],
    present,
    future: [],
    savedJson,
    dirty: false,
  };
}

export function commitV3CleanEditorHistory(
  history: V3CleanEditorHistory,
  nextClip: V3AuthoredClipExport
): V3CleanEditorHistory {
  const present = cloneClip(history.present);
  const nextPresent = cloneClip(nextClip);
  const nextJson = serializedClip(nextPresent);
  if (nextJson === serializedClip(present)) {
    return {
      ...history,
      present: nextPresent,
      dirty: nextJson !== history.savedJson,
    };
  }
  return {
    past: [...history.past.map(cloneClip), present].slice(-80),
    present: nextPresent,
    future: [],
    savedJson: history.savedJson,
    dirty: nextJson !== history.savedJson,
  };
}

export function undoV3CleanEditorHistory(history: V3CleanEditorHistory): V3CleanEditorHistory {
  if (history.past.length === 0) return history;
  const present = cloneClip(history.past[history.past.length - 1]);
  const past = history.past.slice(0, -1).map(cloneClip);
  return {
    past,
    present,
    future: [cloneClip(history.present), ...history.future.map(cloneClip)],
    savedJson: history.savedJson,
    dirty: serializedClip(present) !== history.savedJson,
  };
}

export function redoV3CleanEditorHistory(history: V3CleanEditorHistory): V3CleanEditorHistory {
  if (history.future.length === 0) return history;
  const present = cloneClip(history.future[0]);
  return {
    past: [...history.past.map(cloneClip), cloneClip(history.present)].slice(-80),
    present,
    future: history.future.slice(1).map(cloneClip),
    savedJson: history.savedJson,
    dirty: serializedClip(present) !== history.savedJson,
  };
}

export function markV3CleanEditorHistorySaved(history: V3CleanEditorHistory): V3CleanEditorHistory {
  const present = cloneClip(history.present);
  return {
    ...history,
    present,
    savedJson: serializedClip(present),
    dirty: false,
  };
}

export function clampV3CleanEditorLoopRange(
  clip: V3AuthoredClipExport,
  range: V3CleanEditorLoopRange
): V3CleanEditorLoopRange {
  const normalized = cloneClip(clip);
  const maxFrame = Math.max(0, normalized.durationFrames);
  const first = Math.max(0, Math.min(maxFrame, Math.round(Number.isFinite(range.inFrame) ? range.inFrame : 0)));
  const second = Math.max(0, Math.min(maxFrame, Math.round(Number.isFinite(range.outFrame) ? range.outFrame : maxFrame)));
  return {
    inFrame: Math.min(first, second),
    outFrame: Math.max(first, second),
  };
}

export function retimeV3CleanEditorKeyframe(
  clip: V3AuthoredClipExport,
  input: { fromFrame: number; toFrame: number }
): V3AuthoredClipExport {
  const normalized = cloneClip(clip);
  const fromFrame = clampFrame(normalized, input.fromFrame);
  const toFrame = clampFrame(normalized, input.toFrame);
  if (fromFrame === toFrame) return normalized;
  const moving = findKeyframe(normalized, fromFrame);
  if (!moving) return normalized;
  return normalizeAuthoredClipExport({
    ...normalized,
    keyframes: [
      ...normalized.keyframes.filter((keyframe) => keyframe.frame !== fromFrame && keyframe.frame !== toFrame),
      { ...cloneKeyframe(moving), frame: toFrame },
    ],
  });
}

export function applyV3CleanEditorPosePreset(
  clip: V3AuthoredClipExport,
  input: { frame: number; presetId: string }
): V3AuthoredClipExport {
  const preset = V3_CLEAN_EDITOR_POSE_LIBRARY.find((candidate) => candidate.id === input.presetId);
  if (!preset) throw new Error(`Unknown V3 clean editor pose preset: ${input.presetId}`);
  const sourceClip = exportV3AuthoredClipToJson(preset.clipId);
  const sample = sampleV3AuthoredClipData(sourceClip, { normalizedTime: preset.normalizedTime });
  return pasteV3CleanEditorFrame(clip, {
    frame: input.frame,
    keyframe: {
      frame: input.frame,
      ...(sample.pose.rootOffset ? { rootOffset: cloneVec3(sample.pose.rootOffset) } : {}),
      jointQuaternions: Object.fromEntries(
        Object.entries(sample.pose.jointQuaternions).map(([joint, quaternion]) => [
          joint,
          cloneQuat(quaternion),
        ])
      ) as Partial<Record<V3CleanJointName, V3QuatTuple>>,
      ...(sample.weaponPose ? {
        weaponPose: {
          ...sample.weaponPose,
          position: cloneVec3(sample.weaponPose.position),
          rotation: cloneVec3(sample.weaponPose.rotation),
          ...(sample.weaponPose.primarySocketMarker ? {
            primarySocketMarker: cloneVec3(sample.weaponPose.primarySocketMarker),
          } : {}),
          ...(sample.weaponPose.offhandSocketMarker ? {
            offhandSocketMarker: cloneVec3(sample.weaponPose.offhandSocketMarker),
          } : {}),
        },
      } : {}),
    },
  });
}

const defaultCustomStorageId = (clip: V3AuthoredClipExport): string =>
  `custom_${clip.id}_${Date.now().toString(36)}`;

export function duplicateV3CleanEditorCustomClip(
  clip: V3AuthoredClipExport,
  input: { storageId?: string; label?: string; now?: string } = {}
): V3CleanEditorCustomClipRecord {
  const now = input.now ?? new Date().toISOString();
  const duplicated = normalizeAuthoredClipExport({
    ...cloneClip(clip),
    label: input.label ?? `${clip.label} Copy`,
  });
  return {
    storageId: input.storageId ?? defaultCustomStorageId(clip),
    label: duplicated.label,
    createdAt: now,
    updatedAt: now,
    sourceClipId: clip.id,
    clip: duplicated,
  };
}

export function newV3CleanEditorClipFromCurrentFrame(
  clip: V3AuthoredClipExport,
  input: { frame: number; storageId?: string; label?: string; now?: string } = { frame: 0 }
): V3CleanEditorCustomClipRecord {
  const now = input.now ?? new Date().toISOString();
  const draft = getV3CleanEditorFrameDraft(clip, input.frame).keyframe;
  const created = normalizeAuthoredClipExport({
    ...cloneClip(clip),
    label: input.label ?? `${clip.label} Pose Clip`,
    keyframes: [{ ...cloneKeyframe(draft), frame: 0 }],
  });
  return {
    storageId: input.storageId ?? defaultCustomStorageId(clip),
    label: created.label,
    createdAt: now,
    updatedAt: now,
    sourceClipId: clip.id,
    clip: created,
  };
}

const tupleHasNonFinite = (value: readonly number[] | undefined, length: number): boolean =>
  !Array.isArray(value) || value.length !== length || value.some((component) => !Number.isFinite(component));

export function buildV3CleanEditorValidationReport(
  clip: V3AuthoredClipExport
): V3CleanEditorValidationReport {
  const items: V3CleanEditorValidationItem[] = [];
  const add = (item: V3CleanEditorValidationItem): void => {
    items.push(item);
  };
  if (!Number.isFinite(clip.durationFrames) || clip.durationFrames < 1) {
    add({
      severity: 'error',
      code: 'invalid-duration',
      message: 'Clip duration must be at least one finite frame.',
    });
  }
  if (!Array.isArray(clip.keyframes) || clip.keyframes.length === 0) {
    add({
      severity: 'error',
      code: 'missing-keyframes',
      message: 'Clip must contain at least one keyframe.',
    });
  }

  const frameCounts = new Map<number, number>();
  for (const keyframe of clip.keyframes ?? []) {
    frameCounts.set(keyframe.frame, (frameCounts.get(keyframe.frame) ?? 0) + 1);
    if (!Number.isFinite(keyframe.frame)) {
      add({
        severity: 'error',
        code: 'non-finite-frame',
        message: 'Keyframe frame index must be finite.',
      });
    } else if (keyframe.frame < 0 || keyframe.frame > clip.durationFrames) {
      add({
        severity: 'error',
        code: 'keyframe-out-of-range',
        frame: keyframe.frame,
        message: `Frame ${keyframe.frame} is outside the clip range 0-${clip.durationFrames}.`,
      });
    }

    if (keyframe.rootOffset && tupleHasNonFinite(keyframe.rootOffset, 3)) {
      add({
        severity: 'error',
        code: 'non-finite-root-offset',
        frame: keyframe.frame,
        target: 'root',
        message: 'Root offset must contain three finite numbers.',
      });
    }

    for (const [jointName, quaternion] of Object.entries(keyframe.jointQuaternions ?? {})) {
      if (!JOINT_NAMES.has(jointName)) {
        add({
          severity: 'error',
          code: 'unknown-joint',
          frame: keyframe.frame,
          target: jointName,
          message: `Unknown V3 clean rig joint: ${jointName}.`,
        });
        continue;
      }
      if (tupleHasNonFinite(quaternion as readonly number[], 4)) {
        add({
          severity: 'error',
          code: 'non-finite-joint-quaternion',
          frame: keyframe.frame,
          target: jointName,
          message: `${jointName} quaternion must contain four finite numbers.`,
        });
      }
    }

    const pose = keyframe.weaponPose;
    if (pose) {
      if (pose.weapon !== 'hammer' && pose.weapon !== 'sword' && pose.weapon !== 'pistol') {
        add({
          severity: 'error',
          code: 'invalid-weapon',
          frame: keyframe.frame,
          target: 'weapon',
          message: `Unsupported weapon pose: ${String(pose.weapon)}.`,
        });
      }
      if (tupleHasNonFinite(pose.position, 3)) {
        add({
          severity: 'error',
          code: 'non-finite-weapon-position',
          frame: keyframe.frame,
          target: 'weapon',
          message: 'Weapon position must contain three finite numbers.',
        });
      }
      if (tupleHasNonFinite(pose.rotation, 3)) {
        add({
          severity: 'error',
          code: 'non-finite-weapon-rotation',
          frame: keyframe.frame,
          target: 'weapon',
          message: 'Weapon rotation must contain three finite numbers.',
        });
      }
      if (pose.primarySocketMarker && tupleHasNonFinite(pose.primarySocketMarker, 3)) {
        add({
          severity: 'error',
          code: 'non-finite-primary-socket',
          frame: keyframe.frame,
          target: 'primarySocketMarker',
          message: 'Primary socket marker must contain three finite numbers.',
        });
      }
      if (pose.offhandSocketMarker && tupleHasNonFinite(pose.offhandSocketMarker, 3)) {
        add({
          severity: 'error',
          code: 'non-finite-offhand-socket',
          frame: keyframe.frame,
          target: 'offhandSocketMarker',
          message: 'Offhand socket marker must contain three finite numbers.',
        });
      }
    }
  }

  for (const [frame, count] of frameCounts.entries()) {
    if (count > 1) {
      add({
        severity: 'warning',
        code: 'duplicate-keyframe',
        frame,
        message: `Frame ${frame} has ${count} keyframes; export normalization will keep one.`,
      });
    }
  }

  const sortedFrames = [...frameCounts.keys()].filter(Number.isFinite).sort((a, b) => a - b);
  if (sortedFrames[0] !== 0) {
    add({
      severity: 'warning',
      code: 'missing-start-keyframe',
      frame: 0,
      message: 'Clip does not have an explicit frame 0 keyframe.',
    });
  }
  if (sortedFrames.length > 0 && sortedFrames[sortedFrames.length - 1] < clip.durationFrames) {
    add({
      severity: 'info',
      code: 'missing-end-keyframe',
      frame: clip.durationFrames,
      message: 'Clip has no explicit key at the duration endpoint.',
    });
  }

  try {
    normalizeAuthoredClipExport(clip);
  } catch (error) {
    add({
      severity: 'error',
      code: 'normalization-error',
      message: error instanceof Error ? error.message : 'Clip export normalization failed.',
    });
  }

  const errors = items.filter((item) => item.severity === 'error').length;
  const warnings = items.filter((item) => item.severity === 'warning').length;
  return {
    ok: errors === 0,
    summary: errors === 0 && warnings === 0
      ? 'No blocking validation issues.'
      : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}.`,
    items,
  };
}

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
