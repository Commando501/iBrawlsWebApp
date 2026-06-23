import * as THREE from 'three';
import {
  V3_DETAIL_BONE_NAMES,
  V3_DETAIL_BONE_SPECS,
  type V3DetailBoneName,
} from '../v3/v3RigDetail';
import {
  applyV3Mesh2MotionDriverRigPose,
  resetV3Mesh2MotionDriverRigPose,
  type V3Mesh2MotionDriverBindingDiagnosticReport,
  type V3Mesh2MotionDriverPose,
} from './v3Mesh2MotionDriverRig';

export type V3AnimationAuthority = 'legacyLayered' | 'cleanRig';
export type V3CleanJointName = V3DetailBoneName;
export type V3QuatTuple = [number, number, number, number];
export type V3Vec3Tuple = [number, number, number];

export interface V3CleanJointAxes {
  right: V3Vec3Tuple;
  up: V3Vec3Tuple;
  forward: V3Vec3Tuple;
}

export interface V3CleanRigJoint {
  name: V3CleanJointName;
  parent: V3CleanJointName | null;
  children: V3CleanJointName[];
  object: THREE.Group;
  restLocalPosition: V3Vec3Tuple;
  restLocalQuaternion: V3QuatTuple;
  restWorldPosition: V3Vec3Tuple;
  restWorldQuaternion: V3QuatTuple;
  bindOffset: V3Vec3Tuple;
  axes: V3CleanJointAxes;
}

export interface V3CleanRig {
  authority: 'cleanRig';
  root: THREE.Group;
  ready: boolean;
  missingJoints: V3CleanJointName[];
  joints: Record<V3CleanJointName, V3CleanRigJoint>;
}

export interface V3CleanRigWeaponPose {
  weapon: 'hammer' | 'sword' | 'pistol';
  position: V3Vec3Tuple;
  rotation: V3Vec3Tuple;
  source: 'authoredCleanClip' | 'mixamoReferenceClip';
  primarySocketMarker?: V3Vec3Tuple;
  offhandSocketMarker?: V3Vec3Tuple;
}

export interface V3CleanRigPose {
  clipId: string;
  animationAuthority?: V3AnimationAuthority;
  normalizedTime: number;
  rootOffset?: V3Vec3Tuple;
  jointQuaternions: Partial<Record<V3CleanJointName, V3QuatTuple>>;
  jointOffsets?: Partial<Record<V3CleanJointName, V3Vec3Tuple>>;
  mesh2MotionDriverPose?: V3Mesh2MotionDriverPose;
  weaponPose?: V3CleanRigWeaponPose;
}

export interface V3CleanRigApplyReport {
  ready: boolean;
  animationAuthority: V3AnimationAuthority;
  clipId: string;
  jointCount: number;
  warnings: string[];
  mesh2MotionDriverBindingDiagnostics?: V3Mesh2MotionDriverBindingDiagnosticReport;
}

export interface V3CleanRigContinuityLink {
  id: string;
  parent: V3CleanJointName;
  child: V3CleanJointName;
  ready: boolean;
  restDistance: number;
  currentDistance: number;
  gap: number;
  endpoints: {
    parent: V3Vec3Tuple;
    child: V3Vec3Tuple;
  };
}

export interface V3CleanRigContinuityReport {
  ready: boolean;
  animationAuthority: V3AnimationAuthority;
  cleanRigReady: boolean;
  jointSeamWarnings: string[];
  warnings: string[];
  links: V3CleanRigContinuityLink[];
  maxJointSeamGap: number;
  missingJoints: V3CleanJointName[];
}

const IDENTITY_QUATERNION: V3QuatTuple = [0, 0, 0, 1];
const ZERO_VEC3: V3Vec3Tuple = [0, 0, 0];
const MAX_CLEAN_JOINT_SEAM_GAP = 0.08;

const finiteTuple = (value: readonly number[]): boolean => value.every(Number.isFinite);

const tupleFromVector = (value: THREE.Vector3): V3Vec3Tuple => [value.x, value.y, value.z];

const tupleFromQuaternion = (value: THREE.Quaternion): V3QuatTuple => [value.x, value.y, value.z, value.w];

const vec3FromTuple = (value: readonly number[] | undefined, fallback: V3Vec3Tuple = ZERO_VEC3): THREE.Vector3 =>
  new THREE.Vector3(
    Number.isFinite(value?.[0]) ? Number(value?.[0]) : fallback[0],
    Number.isFinite(value?.[1]) ? Number(value?.[1]) : fallback[1],
    Number.isFinite(value?.[2]) ? Number(value?.[2]) : fallback[2]
  );

const storedVec3 = (value: unknown): V3Vec3Tuple | null => {
  if (Array.isArray(value) && value.length === 3 && finiteTuple(value)) {
    return [Number(value[0]), Number(value[1]), Number(value[2])];
  }
  return null;
};

const cleanAxes = (): V3CleanJointAxes => ({
  right: [1, 0, 0],
  up: [0, 1, 0],
  forward: [0, 0, -1],
});

const normalizeQuaternion = (value: readonly number[] | undefined): THREE.Quaternion => {
  const quaternion = new THREE.Quaternion(
    Number.isFinite(value?.[0]) ? Number(value?.[0]) : 0,
    Number.isFinite(value?.[1]) ? Number(value?.[1]) : 0,
    Number.isFinite(value?.[2]) ? Number(value?.[2]) : 0,
    Number.isFinite(value?.[3]) ? Number(value?.[3]) : 1
  );
  if (quaternion.lengthSq() < 0.000001) return new THREE.Quaternion();
  return quaternion.normalize();
};

const resetSegmentGroups = (model: THREE.Group): void => {
  const segmentGroups = model.userData.segmentGroups as Record<string, THREE.Group> | undefined;
  for (const group of Object.values(segmentGroups ?? {})) {
    const restPosition = storedVec3(group.userData.v3AnimationRestPosition) ?? storedVec3(group.userData.v3CleanRestLocalPosition) ?? ZERO_VEC3;
    group.position.fromArray(restPosition);
    group.quaternion.identity();
    group.scale.set(1, 1, 1);
  }
};

export function getV3CleanRig(model: THREE.Group): V3CleanRig {
  const cached = model.userData.v3CleanRig as V3CleanRig | undefined;
  if (cached?.root === model) return cached;

  const bones = (model.userData.v3DetailBones ?? {}) as Partial<Record<V3CleanJointName, THREE.Group>>;
  const missingJoints = V3_DETAIL_BONE_NAMES.filter((name) => !bones[name]);
  const joints = {} as Record<V3CleanJointName, V3CleanRigJoint>;
  model.updateMatrixWorld(true);

  for (const name of V3_DETAIL_BONE_NAMES) {
    const object = bones[name] ?? new THREE.Group();
    const spec = V3_DETAIL_BONE_SPECS[name];
    const restLocalPosition = storedVec3(object.userData.v3CleanRestLocalPosition)
      ?? tupleFromVector(object.position);
    const restWorldPosition = tupleFromVector(object.getWorldPosition(new THREE.Vector3()));
    const restLocalQuaternion = [...IDENTITY_QUATERNION] as V3QuatTuple;
    object.userData.v3CleanRestLocalPosition = [...restLocalPosition];
    object.userData.v3CleanRestLocalQuaternion = [...restLocalQuaternion];
    joints[name] = {
      name,
      parent: spec.parent ?? null,
      children: [],
      object,
      restLocalPosition,
      restLocalQuaternion,
      restWorldPosition,
      restWorldQuaternion: [...IDENTITY_QUATERNION],
      bindOffset: [...ZERO_VEC3],
      axes: cleanAxes(),
    };
  }

  for (const joint of Object.values(joints)) {
    if (joint.parent) joints[joint.parent].children.push(joint.name);
  }

  const rig: V3CleanRig = {
    authority: 'cleanRig',
    root: model,
    ready: missingJoints.length === 0,
    missingJoints,
    joints,
  };
  model.userData.v3CleanRig = rig;
  return rig;
}

export function resetV3CleanRigPose(model: THREE.Group): V3CleanRig {
  const rig = getV3CleanRig(model);
  resetSegmentGroups(model);
  for (const jointName of V3_DETAIL_BONE_NAMES) {
    const joint = rig.joints[jointName];
    joint.object.position.fromArray(joint.restLocalPosition);
    joint.object.quaternion.fromArray(joint.restLocalQuaternion);
    joint.object.rotation.setFromQuaternion(joint.object.quaternion);
    joint.object.scale.set(1, 1, 1);
  }
  resetV3Mesh2MotionDriverRigPose(model);
  model.userData.v3LowerBodyBridgeActive = false;
  return rig;
}

export function applyV3CleanRigPose(
  model: THREE.Group,
  pose: V3CleanRigPose,
  options: { alpha?: number } = {}
): V3CleanRigApplyReport {
  const rig = resetV3CleanRigPose(model);
  const alpha = Number.isFinite(options.alpha) ? Math.max(0, Math.min(1, Number(options.alpha))) : 1;
  const warnings: string[] = [];
  const usesMesh2MotionDriver = Boolean(pose.mesh2MotionDriverPose);
  let mesh2MotionDriverBindingDiagnostics: V3Mesh2MotionDriverBindingDiagnosticReport | undefined;

  const pelvisOffset = pose.rootOffset ?? ZERO_VEC3;
  if (!usesMesh2MotionDriver && pose.rootOffset && finiteTuple(pelvisOffset)) {
    const pelvis = rig.joints.pelvis.object;
    pelvis.position.add(vec3FromTuple(pelvisOffset));
  }

  if (!usesMesh2MotionDriver) {
    for (const [jointName, quaternionTuple] of Object.entries(pose.jointQuaternions)) {
      const joint = rig.joints[jointName as V3CleanJointName];
      if (!joint) {
        warnings.push(`unknown clean rig joint ${jointName}`);
        continue;
      }
      const target = normalizeQuaternion(quaternionTuple);
      if (alpha >= 1) {
        joint.object.quaternion.copy(target);
      } else {
        joint.object.quaternion.slerp(target, alpha);
      }
      joint.object.rotation.setFromQuaternion(joint.object.quaternion);
    }

    for (const [jointName, offset] of Object.entries(pose.jointOffsets ?? {})) {
      const joint = rig.joints[jointName as V3CleanJointName];
      if (!joint || !finiteTuple(offset as V3Vec3Tuple)) continue;
      joint.object.position.add(vec3FromTuple(offset as V3Vec3Tuple));
    }
  } else if (pose.mesh2MotionDriverPose) {
    const driverReport = applyV3Mesh2MotionDriverRigPose(model, pose.mesh2MotionDriverPose, { alpha });
    mesh2MotionDriverBindingDiagnostics = driverReport.bindingDiagnostics;
    warnings.push(...driverReport.warnings);
  }

  model.userData.v3AnimationAuthority = 'cleanRig';
  model.userData.v3CleanRigPose = pose;
  model.userData.v3CleanAuthoredClip = pose.clipId;
  model.userData.v3CleanWeaponPose = pose.weaponPose ?? null;
  model.userData.v3RetargetedClip = undefined;
  model.userData.v3AnimationLayeredLegacyDisabled = true;
  model.updateMatrixWorld(true);

  const report: V3CleanRigApplyReport = {
    ready: rig.ready && warnings.length === 0 && (mesh2MotionDriverBindingDiagnostics?.ready ?? true),
    animationAuthority: 'cleanRig',
    clipId: pose.clipId,
    jointCount: Object.keys(rig.joints).length,
    warnings,
    ...(mesh2MotionDriverBindingDiagnostics ? { mesh2MotionDriverBindingDiagnostics } : {}),
  };
  model.userData.v3CleanRigApplyReport = report;
  return report;
}

export function getV3CleanJointWorldPosition(
  model: THREE.Group,
  jointName: V3CleanJointName
): THREE.Vector3 | null {
  const rig = getV3CleanRig(model);
  const joint = rig.joints[jointName];
  if (!joint) return null;
  return joint.object.getWorldPosition(new THREE.Vector3());
}

export function analyzeV3CleanRigContinuity(
  model: THREE.Group,
  pose?: V3CleanRigPose
): V3CleanRigContinuityReport {
  const rig = getV3CleanRig(model);
  const activePose = pose ?? model.userData.v3CleanRigPose as V3CleanRigPose | undefined;
  const driverOffsetsActive = Object.keys(activePose?.jointOffsets ?? {}).length > 0;
  model.updateMatrixWorld(true);
  const links: V3CleanRigContinuityLink[] = [];
  const warnings: string[] = [];
  let maxJointSeamGap = 0;

  for (const childName of V3_DETAIL_BONE_NAMES) {
    const child = rig.joints[childName];
    if (!child.parent) continue;
    const parent = rig.joints[child.parent];
    const parentWorld = parent.object.getWorldPosition(new THREE.Vector3());
    const childWorld = child.object.getWorldPosition(new THREE.Vector3());
    const currentDistance = parentWorld.distanceTo(childWorld);
    const childOffset = activePose?.jointOffsets?.[childName];
    const restDistance = driverOffsetsActive
      ? currentDistance
      : childOffset && finiteTuple(childOffset)
      ? vec3FromTuple(child.restLocalPosition).add(vec3FromTuple(childOffset)).length()
      : vec3FromTuple(parent.restWorldPosition).distanceTo(vec3FromTuple(child.restWorldPosition));
    const gap = Math.abs(currentDistance - restDistance);
    const finite = Number.isFinite(restDistance) && Number.isFinite(currentDistance) && Number.isFinite(gap);
    const ready = finite && gap <= MAX_CLEAN_JOINT_SEAM_GAP;
    if (!ready) {
      warnings.push(`${child.parent}->${childName} clean joint seam gap ${gap.toFixed(4)}`);
    }
    maxJointSeamGap = Math.max(maxJointSeamGap, finite ? gap : Number.POSITIVE_INFINITY);
    links.push({
      id: `${child.parent}:${childName}`,
      parent: child.parent,
      child: childName,
      ready,
      restDistance,
      currentDistance,
      gap,
      endpoints: {
        parent: tupleFromVector(parentWorld),
        child: tupleFromVector(childWorld),
      },
    });
  }

  const report: V3CleanRigContinuityReport = {
    ready: rig.ready && warnings.length === 0,
    animationAuthority: (model.userData.v3AnimationAuthority as V3AnimationAuthority | undefined) ?? 'legacyLayered',
    cleanRigReady: rig.ready,
    jointSeamWarnings: warnings,
    warnings,
    links,
    maxJointSeamGap,
    missingJoints: rig.missingJoints,
  };
  model.userData.v3CleanRigContinuity = report;
  return report;
}
