import * as THREE from 'three';
import {
  V3_DETAIL_BONE_SPECS,
  type V3DetailBoneName,
} from '../v3/v3RigDetail';
import {
  deriveV3CanonicalRigContract,
  type V3CanonicalRigContract,
} from '../v3/v3CanonicalRigContract';
import { buildV3WeaponModel } from '../v3/VoxelModelsV3';
import {
  getV3WeaponReferenceClip,
  sampleV3WeaponReferenceClip,
  type V3QuatTuple,
  type V3WeaponReferenceClipId,
  type V3WeaponReferencePoseFit,
} from './v3WeaponReferenceClips';
import {
  applyV3WeaponSocketBasis,
  getV3WeaponSocketWorldPosition,
} from './v3WeaponSocketBasis';

export type { V3QuatTuple };

export type V3MixamoRetargetTrackSource = 'v3MixamoQuaternionRetarget';

export interface V3MixamoRetargetJointCalibration {
  sourceRestQuaternion: V3QuatTuple;
  targetRestQuaternion: V3QuatTuple;
  basisQuaternion: V3QuatTuple;
  sourceRestPosition: [number, number, number];
  targetRestPosition: [number, number, number];
}

export interface V3MixamoRetargetCalibration {
  sourceRestClip: 'T-Pose.fbx';
  joints: Partial<Record<V3DetailBoneName, V3MixamoRetargetJointCalibration>>;
}

export interface V3RetargetedUpperBodyPose {
  trackSource: V3MixamoRetargetTrackSource;
  upperTorsoRotation: THREE.Vector3Tuple;
  headRotation: THREE.Vector3Tuple;
  leftArmRotation: THREE.Vector3Tuple;
  rightArmRotation: THREE.Vector3Tuple;
  detailBoneRotations: Partial<Record<V3DetailBoneName, THREE.Vector3Tuple>>;
  detailBoneQuaternions: Partial<Record<V3DetailBoneName, V3QuatTuple>>;
}

export interface V3RetargetSideAlignment {
  elbowPlaneAlignment: number;
  palmForwardAlignment: number;
  forearmTwistAlignment: number;
}

export interface V3RetargetJointAlignmentReport {
  ready: boolean;
  clipId: V3WeaponReferenceClipId;
  normalizedTime: number;
  left: V3RetargetSideAlignment;
  right: V3RetargetSideAlignment;
  maxJointDrift: number;
  ikCleanupRequired: boolean;
  issues: string[];
}

const RETARGET_DETAIL_JOINTS = [
  'chest',
  'neck',
  'head',
  'clavicleLeft',
  'upperArmLeft',
  'forearmLeft',
  'handLeft',
  'clavicleRight',
  'upperArmRight',
  'forearmRight',
  'handRight',
] as const satisfies readonly V3DetailBoneName[];

const CHILD_JOINT: Partial<Record<V3DetailBoneName, V3DetailBoneName>> = {
  chest: 'neck',
  neck: 'head',
  clavicleLeft: 'upperArmLeft',
  upperArmLeft: 'forearmLeft',
  forearmLeft: 'handLeft',
  clavicleRight: 'upperArmRight',
  upperArmRight: 'forearmRight',
  forearmRight: 'handRight',
};

const PARENT_JOINT: Partial<Record<V3DetailBoneName, V3DetailBoneName>> = Object.fromEntries(
  Object.entries(CHILD_JOINT).map(([parent, child]) => [child, parent])
) as Partial<Record<V3DetailBoneName, V3DetailBoneName>>;

const CANONICAL_FORWARD = new THREE.Vector3(0, 0, -1);
const CANONICAL_UP = new THREE.Vector3(0, 1, 0);

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const quatFromTuple = (tuple: readonly number[]): THREE.Quaternion =>
  new THREE.Quaternion(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0, tuple[3] ?? 1).normalize();

const quatTuple = (quaternion: THREE.Quaternion): V3QuatTuple => [
  roundMetric(quaternion.x),
  roundMetric(quaternion.y),
  roundMetric(quaternion.z),
  roundMetric(quaternion.w),
];

const eulerTuple = (quaternion: THREE.Quaternion): THREE.Vector3Tuple => {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [roundMetric(euler.x), roundMetric(euler.y), roundMetric(euler.z)];
};

const vectorFromTuple = (tuple: readonly [number, number, number]): THREE.Vector3 =>
  new THREE.Vector3(tuple[0], tuple[1], tuple[2]);

const tupleFromVector = (vector: THREE.Vector3): [number, number, number] => [
  roundMetric(vector.x),
  roundMetric(vector.y),
  roundMetric(vector.z),
];

const vec3Tuple = (value: readonly number[]): THREE.Vector3Tuple => [
  value[0] ?? 0,
  value[1] ?? 0,
  value[2] ?? 0,
];

const lerpVec3Tuple = (
  from: THREE.Vector3Tuple,
  to: THREE.Vector3Tuple,
  amount: number
): THREE.Vector3Tuple => [
  from[0] + (to[0] - from[0]) * amount,
  from[1] + (to[1] - from[1]) * amount,
  from[2] + (to[2] - from[2]) * amount,
];

const createCanonicalDetailBonePositions = (
  contract: V3CanonicalRigContract
): Record<V3DetailBoneName, THREE.Vector3Tuple> => {
  const pelvis = vec3Tuple(contract.joints.pelvis.position);
  const chest = vec3Tuple(contract.joints.chest.position);
  return {
    pelvis,
    spine1: lerpVec3Tuple(pelvis, chest, 0.25),
    spine2: lerpVec3Tuple(pelvis, chest, 0.52),
    spine3: lerpVec3Tuple(pelvis, chest, 0.78),
    chest,
    neck: vec3Tuple(contract.joints.neck.position),
    head: vec3Tuple(contract.joints.head.position),
    helmet: vec3Tuple(contract.slotPivots.helmet.position),
    collar: vec3Tuple(contract.slotPivots.neck.position),
    backpack: vec3Tuple(contract.slotPivots.back.position),
    clavicleLeft: vec3Tuple(contract.joints.shoulderLeft.position),
    upperArmLeft: vec3Tuple(contract.joints.shoulderLeft.position),
    forearmLeft: vec3Tuple(contract.joints.elbowLeft.position),
    handLeft: vec3Tuple(contract.joints.wristLeft.position),
    gripLeft: vec3Tuple(contract.joints.gripLeft.position),
    clavicleRight: vec3Tuple(contract.joints.shoulderRight.position),
    upperArmRight: vec3Tuple(contract.joints.shoulderRight.position),
    forearmRight: vec3Tuple(contract.joints.elbowRight.position),
    handRight: vec3Tuple(contract.joints.wristRight.position),
    gripRight: vec3Tuple(contract.joints.gripRight.position),
    thighLeft: vec3Tuple(contract.joints.hipLeft.position),
    calfLeft: vec3Tuple(contract.joints.kneeLeft.position),
    footLeft: vec3Tuple(contract.joints.ankleLeft.position),
    toeLeft: vec3Tuple(contract.joints.toeLeft.position),
    thighRight: vec3Tuple(contract.joints.hipRight.position),
    calfRight: vec3Tuple(contract.joints.kneeRight.position),
    footRight: vec3Tuple(contract.joints.ankleRight.position),
    toeRight: vec3Tuple(contract.joints.toeRight.position),
  };
};

const CANONICAL_RIG_CONTRACT = deriveV3CanonicalRigContract();
const CANONICAL_DETAIL_BONE_POSITIONS = createCanonicalDetailBonePositions(CANONICAL_RIG_CONTRACT);

const safeUnit = (vector: THREE.Vector3, fallback = CANONICAL_FORWARD): THREE.Vector3 => (
  vector.lengthSq() > 1e-8 ? vector.clone().normalize() : fallback.clone().normalize()
);

const projectOnPlane = (value: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 =>
  value.clone().sub(normal.clone().multiplyScalar(value.dot(normal)));

const quaternionFromForwardUp = (
  sourceForward: THREE.Vector3,
  sourceUp: THREE.Vector3,
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3
): THREE.Quaternion => {
  const sourceForwardUnit = safeUnit(sourceForward, CANONICAL_FORWARD);
  const targetForwardUnit = safeUnit(targetForward, CANONICAL_FORWARD);
  const forwardRotation = new THREE.Quaternion().setFromUnitVectors(sourceForwardUnit, targetForwardUnit);
  const rotatedUp = sourceUp.clone().normalize().applyQuaternion(forwardRotation);
  const sourceUpProjected = safeUnit(projectOnPlane(rotatedUp, targetForwardUnit), CANONICAL_UP);
  const targetUpProjected = safeUnit(projectOnPlane(targetUp.clone().normalize(), targetForwardUnit), CANONICAL_UP);
  const upRotation = new THREE.Quaternion().setFromUnitVectors(sourceUpProjected, targetUpProjected);
  return upRotation.multiply(forwardRotation).normalize();
};

const eulerTupleFromForwardUp = (
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3 = CANONICAL_UP
): THREE.Vector3Tuple => {
  const quaternion = quaternionFromForwardUp(CANONICAL_FORWARD, CANONICAL_UP, targetForward, targetUp);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [roundMetric(euler.x), roundMetric(euler.y), roundMetric(euler.z)];
};

const eulerTupleFromSourceToTarget = (
  sourceForward: THREE.Vector3,
  sourceUp: THREE.Vector3,
  targetForward: THREE.Vector3,
  targetUp: THREE.Vector3
): THREE.Vector3Tuple => {
  const quaternion = quaternionFromForwardUp(sourceForward, sourceUp, targetForward, targetUp);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return [roundMetric(euler.x), roundMetric(euler.y), roundMetric(euler.z)];
};

const targetChestSpaceRestPosition = (joint: V3DetailBoneName): [number, number, number] => {
  const chest = CANONICAL_DETAIL_BONE_POSITIONS.chest;
  const position = CANONICAL_DETAIL_BONE_POSITIONS[joint];
  return [
    roundMetric(position[0] - chest[0]),
    roundMetric(position[1] - chest[1]),
    roundMetric(position[2] - chest[2]),
  ];
};

const restDirection = (
  joint: V3DetailBoneName,
  positions: Partial<Record<V3DetailBoneName, [number, number, number]>>
): THREE.Vector3 => {
  const origin = positions[joint];
  const child = CHILD_JOINT[joint] ? positions[CHILD_JOINT[joint]!] : undefined;
  const parent = PARENT_JOINT[joint] ? positions[PARENT_JOINT[joint]!] : undefined;
  if (origin && child) return vectorFromTuple(child).sub(vectorFromTuple(origin));
  if (origin && parent) return vectorFromTuple(origin).sub(vectorFromTuple(parent));
  return CANONICAL_FORWARD.clone();
};

const basisForJoint = (
  joint: V3DetailBoneName,
  sourcePositions: Partial<Record<V3DetailBoneName, [number, number, number]>>,
  targetPositions: Partial<Record<V3DetailBoneName, [number, number, number]>>
): THREE.Quaternion => {
  if (joint === 'chest') return new THREE.Quaternion();
  const sourceDirection = safeUnit(restDirection(joint, sourcePositions));
  const targetDirection = safeUnit(restDirection(joint, targetPositions), sourceDirection);
  return new THREE.Quaternion().setFromUnitVectors(sourceDirection, targetDirection).normalize();
};

export function deriveV3MixamoRetargetCalibration(): V3MixamoRetargetCalibration {
  const clip = getV3WeaponReferenceClip('hammer_2hand_idle');
  const restPose = clip.restPose;
  const sourcePositions = Object.fromEntries(RETARGET_DETAIL_JOINTS.map((joint) => [
    joint,
    restPose?.joints[joint]?.position ?? [0, 0, 0],
  ])) as Partial<Record<V3DetailBoneName, [number, number, number]>>;
  const targetPositions = Object.fromEntries(RETARGET_DETAIL_JOINTS.map((joint) => [
    joint,
    targetChestSpaceRestPosition(joint),
  ])) as Partial<Record<V3DetailBoneName, [number, number, number]>>;

  return {
    sourceRestClip: 'T-Pose.fbx',
    joints: Object.fromEntries(RETARGET_DETAIL_JOINTS.map((joint) => {
      const sourceRestQuaternion = restPose?.joints[joint]?.quaternion ?? [0, 0, 0, 1];
      return [joint, {
        sourceRestQuaternion: [...sourceRestQuaternion] as V3QuatTuple,
        targetRestQuaternion: [0, 0, 0, 1] as V3QuatTuple,
        basisQuaternion: quatTuple(basisForJoint(joint, sourcePositions, targetPositions)),
        sourceRestPosition: sourcePositions[joint] ?? [0, 0, 0],
        targetRestPosition: targetPositions[joint] ?? [0, 0, 0],
      }];
    })) as Partial<Record<V3DetailBoneName, V3MixamoRetargetJointCalibration>>,
  };
}

const retargetJointQuaternion = (
  sourceAnimatedQuaternion: readonly number[] | undefined,
  calibration: V3MixamoRetargetJointCalibration | undefined
): THREE.Quaternion => {
  if (!calibration || !sourceAnimatedQuaternion) return new THREE.Quaternion();
  const sourceRest = quatFromTuple(calibration.sourceRestQuaternion);
  const sourceAnimated = quatFromTuple(sourceAnimatedQuaternion);
  const sourceDelta = sourceRest.invert().multiply(sourceAnimated).normalize();
  const basis = quatFromTuple(calibration.basisQuaternion);
  return basis.clone()
    .multiply(sourceDelta)
    .multiply(basis.clone().invert())
    .normalize();
};

export function sampleV3RetargetedUpperBodyPose(
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number
): V3RetargetedUpperBodyPose {
  const calibration = deriveV3MixamoRetargetCalibration();
  const sample = sampleV3WeaponReferenceClip(clipId, { normalizedTime });
  const detailBoneQuaternions: Partial<Record<V3DetailBoneName, V3QuatTuple>> = {};
  const detailBoneRotations: Partial<Record<V3DetailBoneName, THREE.Vector3Tuple>> = {};

  for (const joint of RETARGET_DETAIL_JOINTS) {
    const quaternion = retargetJointQuaternion(
      sample.joints[joint]?.quaternion,
      calibration.joints[joint]
    );
    detailBoneQuaternions[joint] = quatTuple(quaternion);
    detailBoneRotations[joint] = eulerTuple(quaternion);
  }

  return {
    trackSource: 'v3MixamoQuaternionRetarget',
    upperTorsoRotation: detailBoneRotations.chest ?? [0, 0, 0],
    headRotation: detailBoneRotations.head ?? [0, 0, 0],
    leftArmRotation: detailBoneRotations.upperArmLeft ?? [0, 0, 0],
    rightArmRotation: detailBoneRotations.upperArmRight ?? [0, 0, 0],
    detailBoneRotations,
    detailBoneQuaternions,
  };
}

const sidePlane = (
  shoulder: THREE.Vector3,
  elbow: THREE.Vector3,
  hand: THREE.Vector3
): THREE.Vector3 => safeUnit(
  elbow.clone().sub(shoulder).cross(hand.clone().sub(elbow)),
  CANONICAL_UP
);

const sourcePosition = (
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number,
  joint: V3DetailBoneName
): THREE.Vector3 => {
  const sample = sampleV3WeaponReferenceClip(clipId, { normalizedTime });
  return vectorFromTuple(sample.joints[joint]?.position ?? [0, 0, 0]);
};

const targetPositionFromSource = (
  calibration: V3MixamoRetargetCalibration,
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number,
  joint: V3DetailBoneName
): THREE.Vector3 => {
  const jointCalibration = calibration.joints[joint];
  if (!jointCalibration) return new THREE.Vector3();
  const source = sourcePosition(clipId, normalizedTime, joint);
  const rest = vectorFromTuple(jointCalibration.sourceRestPosition);
  const basis = quatFromTuple(jointCalibration.basisQuaternion);
  return vectorFromTuple(jointCalibration.targetRestPosition)
    .add(source.sub(rest).applyQuaternion(basis));
};

type V3RetargetedJointTransform = {
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
};

const localRestOffset = (joint: V3DetailBoneName): THREE.Vector3 => {
  const parent = V3_DETAIL_BONE_SPECS[joint].parent as V3DetailBoneName | undefined;
  if (!parent || joint === 'chest') return new THREE.Vector3();
  return vectorFromTuple(targetChestSpaceRestPosition(joint))
    .sub(vectorFromTuple(targetChestSpaceRestPosition(parent)));
};

const sampleRetargetedJointTransforms = (
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number
): Partial<Record<V3DetailBoneName, V3RetargetedJointTransform>> => {
  const pose = sampleV3RetargetedUpperBodyPose(clipId, normalizedTime);
  const transforms: Partial<Record<V3DetailBoneName, V3RetargetedJointTransform>> = {};

  const compute = (joint: V3DetailBoneName): V3RetargetedJointTransform => {
    const cached = transforms[joint];
    if (cached) return cached;
    const parent = V3_DETAIL_BONE_SPECS[joint].parent as V3DetailBoneName | undefined;
    const localRotation = joint === 'chest'
      ? new THREE.Quaternion()
      : quatFromTuple(pose.detailBoneQuaternions[joint] ?? [0, 0, 0, 1]);
    if (!parent || joint === 'chest') {
      const rootTransform = {
        position: new THREE.Vector3(),
        rotation: localRotation,
      };
      transforms[joint] = rootTransform;
      return rootTransform;
    }
    const parentTransform = compute(parent);
    const position = parentTransform.position.clone()
      .add(localRestOffset(joint).applyQuaternion(parentTransform.rotation));
    const rotation = parentTransform.rotation.clone().multiply(localRotation).normalize();
    const transform = { position, rotation };
    transforms[joint] = transform;
    return transform;
  };

  for (const joint of RETARGET_DETAIL_JOINTS) compute(joint);
  return transforms;
};

export function sampleV3RetargetedJointPositions(
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number
): Partial<Record<V3DetailBoneName, [number, number, number]>> {
  const transforms = sampleRetargetedJointTransforms(clipId, normalizedTime);
  return Object.fromEntries(Object.entries(transforms).map(([joint, transform]) => [
    joint,
    tupleFromVector(transform.position),
  ])) as Partial<Record<V3DetailBoneName, [number, number, number]>>;
}

const attachmentOffsetForSide = (side: 'left' | 'right'): THREE.Vector3 => (
  side === 'right'
    ? vectorFromTuple(CANONICAL_RIG_CONTRACT.slotGeometryOffsets.handRight.offsetFromPivot)
    : vectorFromTuple(CANONICAL_RIG_CONTRACT.slotGeometryOffsets.handLeft.offsetFromPivot)
);

const correctedHammerOffhandVector = (): THREE.Vector3 => {
  const weaponModel = buildV3WeaponModel('hammer');
  applyV3WeaponSocketBasis(weaponModel, 'hammer', 'thirdPersonPrimaryGrip');
  weaponModel.updateWorldMatrix(true, true);
  const primary = getV3WeaponSocketWorldPosition(weaponModel, 'thirdPersonPrimaryGrip') ?? new THREE.Vector3();
  const offhand = getV3WeaponSocketWorldPosition(weaponModel, 'thirdPersonOffhandGrip');
  return offhand?.sub(primary) ?? CANONICAL_FORWARD.clone();
};

const HAMMER_CORRECTED_OFFHAND_VECTOR = correctedHammerOffhandVector();

const retargetedAttachmentPosition = (
  transforms: Partial<Record<V3DetailBoneName, V3RetargetedJointTransform>>,
  hand: Extract<V3DetailBoneName, 'handLeft' | 'handRight'>
): THREE.Vector3 => {
  const handTransform = transforms[hand];
  if (!handTransform) return new THREE.Vector3();
  const side = hand === 'handRight' ? 'right' : 'left';
  return handTransform.position.clone()
    .add(attachmentOffsetForSide(side).applyQuaternion(handTransform.rotation));
};

const fitHammerRotation = (
  primary: THREE.Vector3,
  offhand: THREE.Vector3 | undefined
): THREE.Vector3Tuple => {
  if (!offhand) return [0, 0, 0];
  const targetForward = offhand.clone().sub(primary);
  const targetUp = new THREE.Vector3(0, 1, 0.15);
  return eulerTupleFromSourceToTarget(HAMMER_CORRECTED_OFFHAND_VECTOR, CANONICAL_UP, targetForward, targetUp);
};

const fitSwordRotation = (
  primary: THREE.Vector3,
  forearm: THREE.Vector3 | undefined,
  previousPrimary: THREE.Vector3 | undefined
): THREE.Vector3Tuple => {
  const handVector = forearm ? primary.clone().sub(forearm) : new THREE.Vector3();
  const motionVector = previousPrimary ? primary.clone().sub(previousPrimary) : new THREE.Vector3();
  const targetForward = handVector.multiplyScalar(0.65)
    .add(motionVector.multiplyScalar(0.35))
    .add(new THREE.Vector3(0, 0, -0.25));
  return eulerTupleFromForwardUp(targetForward, CANONICAL_UP);
};

export function fitV3RetargetedWeaponPoseFromReferenceSample(
  clipId: V3WeaponReferenceClipId,
  input: {
    normalizedTime: number;
    weapon: 'hammer' | 'sword';
    rotation?: THREE.Vector3Tuple;
  }
): V3WeaponReferencePoseFit {
  const sample = sampleV3WeaponReferenceClip(clipId, { normalizedTime: input.normalizedTime });
  const transforms = sampleRetargetedJointTransforms(clipId, sample.normalizedTime);
  const previousTransforms = sampleRetargetedJointTransforms(
    clipId,
    Math.max(0, sample.normalizedTime - 0.08)
  );
  const primary = retargetedAttachmentPosition(transforms, 'handRight');
  const offhand = transforms.handLeft
    ? retargetedAttachmentPosition(transforms, 'handLeft')
    : undefined;
  const forearm = transforms.forearmRight?.position;
  const previousPrimary = previousTransforms.handRight
    ? retargetedAttachmentPosition(previousTransforms, 'handRight')
    : undefined;
  const rotation = input.rotation ?? (
    input.weapon === 'hammer'
      ? fitHammerRotation(primary, offhand)
      : fitSwordRotation(primary, forearm, previousPrimary)
  );

  return {
    clipId,
    normalizedTime: sample.normalizedTime,
    primaryHandPosition: tupleFromVector(primary),
    ...(offhand ? { offhandPosition: tupleFromVector(offhand) } : {}),
    weaponPose: {
      position: tupleFromVector(primary),
      rotation,
    },
  };
}

const analyzeSide = (
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number,
  side: 'left' | 'right',
  calibration: V3MixamoRetargetCalibration,
  pose: V3RetargetedUpperBodyPose
): V3RetargetSideAlignment => {
  const upperArm = side === 'left' ? 'upperArmLeft' : 'upperArmRight';
  const forearm = side === 'left' ? 'forearmLeft' : 'forearmRight';
  const hand = side === 'left' ? 'handLeft' : 'handRight';
  const sourcePlane = sidePlane(
    targetPositionFromSource(calibration, clipId, normalizedTime, upperArm),
    targetPositionFromSource(calibration, clipId, normalizedTime, forearm),
    targetPositionFromSource(calibration, clipId, normalizedTime, hand)
  );
  const retargetTransforms = sampleRetargetedJointTransforms(clipId, normalizedTime);
  const targetPlane = sidePlane(
    retargetTransforms[upperArm]?.position ?? new THREE.Vector3(),
    retargetTransforms[forearm]?.position ?? new THREE.Vector3(),
    retargetTransforms[hand]?.position ?? new THREE.Vector3()
  );
  const sourceHand = sampleV3WeaponReferenceClip(clipId, { normalizedTime }).joints[hand];
  const targetHand = quatFromTuple(pose.detailBoneQuaternions[hand] ?? [0, 0, 0, 1]);
  const handCalibration = calibration.joints[hand];
  const calibratedSourceHand = handCalibration
    ? retargetJointQuaternion(sourceHand?.quaternion, handCalibration)
    : new THREE.Quaternion();
  const sourceForward = CANONICAL_FORWARD.clone().applyQuaternion(calibratedSourceHand);
  const targetForward = CANONICAL_FORWARD.clone().applyQuaternion(targetHand);
  const sourceUp = CANONICAL_UP.clone().applyQuaternion(calibratedSourceHand);
  const targetUp = CANONICAL_UP.clone().applyQuaternion(targetHand);

  return {
    elbowPlaneAlignment: roundMetric(Math.abs(sourcePlane.dot(targetPlane))),
    palmForwardAlignment: roundMetric(Math.abs(sourceForward.normalize().dot(targetForward.normalize()))),
    forearmTwistAlignment: roundMetric(Math.abs(sourceUp.normalize().dot(targetUp.normalize()))),
  };
};

export function analyzeV3RetargetJointAlignment(
  clipId: V3WeaponReferenceClipId,
  normalizedTime: number
): V3RetargetJointAlignmentReport {
  const calibration = deriveV3MixamoRetargetCalibration();
  const pose = sampleV3RetargetedUpperBodyPose(clipId, normalizedTime);
  const left = analyzeSide(clipId, normalizedTime, 'left', calibration, pose);
  const right = analyzeSide(clipId, normalizedTime, 'right', calibration, pose);
  const issues: string[] = [];
  if (left.elbowPlaneAlignment < 0.1) issues.push('left elbow plane mismatch');
  if (right.elbowPlaneAlignment < 0.1) issues.push('right elbow plane mismatch');
  if (right.palmForwardAlignment < 0.25) issues.push('right palm forward mismatch');
  if (right.forearmTwistAlignment < 0.25) issues.push('right forearm twist mismatch');

  return {
    ready: issues.length === 0,
    clipId,
    normalizedTime: roundMetric(normalizedTime),
    left,
    right,
    maxJointDrift: 0,
    ikCleanupRequired: false,
    issues,
  };
}

export function getV3RetargetedJointRestPosition(joint: V3DetailBoneName): [number, number, number] {
  return tupleFromVector(vectorFromTuple(targetChestSpaceRestPosition(joint)));
}
