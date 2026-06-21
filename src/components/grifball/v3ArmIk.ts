import * as THREE from 'three';
import type { V3SocketName } from '../v3/v3ModelTypes';
import { getCombatantRig, type CombatantDetailBoneMap } from './combatantRig';
import type { V3GripConstraint } from './v3WeaponMotionTracks';
import { getV3WeaponSocketWorldPosition } from './v3WeaponSocketBasis';

export type V3ArmIkSide = 'left' | 'right';

export interface V3ArmIkTarget {
  side: V3ArmIkSide;
  targetWorldPosition: THREE.Vector3;
  poleWorldDirection?: THREE.Vector3;
  alpha?: number;
}

export interface V3ArmIkResult {
  ready: boolean;
  side: V3ArmIkSide;
  reachClamped: boolean;
  clampDistance: number;
  drift: number;
  clavicleAssistRotation: number;
  shoulderSeamDistance: number;
  upperArmWorldLength: number;
  lowerArmWorldLength: number;
  clavicleWorldPosition: THREE.Vector3;
  shoulderWorldPosition: THREE.Vector3;
  elbowWorldPosition: THREE.Vector3;
  targetWorldPosition: THREE.Vector3;
  actualGripWorldPosition: THREE.Vector3;
}

export interface V3WeaponGripConstraintResult extends V3ArmIkResult {
  socketName: V3SocketName;
  required: boolean;
  maxDrift: number;
}

export interface V3WeaponGripConstraintReport {
  ready: boolean;
  maxGripDrift: number;
  maxShoulderSeamDistance: number;
  reachClampCount: number;
  results: readonly V3WeaponGripConstraintResult[];
}

interface V3ArmIkChain {
  clavicle: THREE.Group;
  upperArm: THREE.Group;
  forearm: THREE.Group;
  hand: THREE.Group;
  grip: THREE.Group;
}

const CHAIN_NAMES = {
  left: {
    clavicle: 'clavicleLeft',
    upperArm: 'upperArmLeft',
    forearm: 'forearmLeft',
    hand: 'handLeft',
    grip: 'gripLeft',
  },
  right: {
    clavicle: 'clavicleRight',
    upperArm: 'upperArmRight',
    forearm: 'forearmRight',
    hand: 'handRight',
    grip: 'gripRight',
  },
} as const;

const EMPTY_VECTOR = new THREE.Vector3();

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const getDetailBones = (model: THREE.Group): CombatantDetailBoneMap | undefined => {
  const rig = getCombatantRig(model);
  const detailBones = rig?.detailBones ?? model.userData.v3DetailBones ?? model.userData.detailBones;
  return detailBones && typeof detailBones === 'object'
    ? detailBones as CombatantDetailBoneMap
    : undefined;
};

const getArmChain = (model: THREE.Group, side: V3ArmIkSide): V3ArmIkChain | null => {
  const detailBones = getDetailBones(model);
  if (!detailBones) return null;
  const names = CHAIN_NAMES[side];
  const clavicle = detailBones[names.clavicle];
  const upperArm = detailBones[names.upperArm];
  const forearm = detailBones[names.forearm];
  const hand = detailBones[names.hand];
  const grip = detailBones[names.grip];
  if (!clavicle || !upperArm || !forearm || !hand || !grip) return null;
  return { clavicle, upperArm, forearm, hand, grip };
};

const worldPosition = (object: THREE.Object3D): THREE.Vector3 =>
  object.getWorldPosition(new THREE.Vector3());

const safeUnit = (value: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 => {
  if (value.lengthSq() > 1e-8) return value.clone().normalize();
  return fallback.clone().normalize();
};

const sideFallbackPole = (side: V3ArmIkSide): THREE.Vector3 =>
  side === 'left'
    ? new THREE.Vector3(1, 0.15, -0.1)
    : new THREE.Vector3(-1, 0.15, -0.1);

const projectOnPlane = (value: THREE.Vector3, normal: THREE.Vector3): THREE.Vector3 =>
  value.clone().sub(normal.clone().multiplyScalar(value.dot(normal)));

const setWorldQuaternion = (
  object: THREE.Object3D,
  worldQuaternion: THREE.Quaternion,
  alpha: number
): void => {
  const parentWorldQuaternion = object.parent
    ? object.parent.getWorldQuaternion(new THREE.Quaternion())
    : new THREE.Quaternion();
  const localQuaternion = parentWorldQuaternion.invert().multiply(worldQuaternion);
  if (alpha >= 1) {
    object.quaternion.copy(localQuaternion);
  } else {
    object.quaternion.slerp(localQuaternion, Math.max(0, Math.min(1, alpha)));
  }
};

const alignBoneVector = (
  bone: THREE.Object3D,
  currentVector: THREE.Vector3,
  targetVector: THREE.Vector3,
  alpha: number
): void => {
  const current = safeUnit(currentVector, new THREE.Vector3(0, -1, 0));
  const target = safeUnit(targetVector, current);
  const delta = new THREE.Quaternion().setFromUnitVectors(current, target);
  const currentWorldQuaternion = bone.getWorldQuaternion(new THREE.Quaternion());
  const targetWorldQuaternion = delta.multiply(currentWorldQuaternion).normalize();
  setWorldQuaternion(bone, targetWorldQuaternion, alpha);
};

const emptyResult = (side: V3ArmIkSide, target: THREE.Vector3): V3ArmIkResult => ({
  ready: false,
  side,
  reachClamped: false,
  clampDistance: 0,
  drift: Number.POSITIVE_INFINITY,
  clavicleAssistRotation: 0,
  shoulderSeamDistance: 0,
  upperArmWorldLength: 0,
  lowerArmWorldLength: 0,
  clavicleWorldPosition: EMPTY_VECTOR.clone(),
  shoulderWorldPosition: EMPTY_VECTOR.clone(),
  elbowWorldPosition: EMPTY_VECTOR.clone(),
  targetWorldPosition: target.clone(),
  actualGripWorldPosition: EMPTY_VECTOR.clone(),
});

const applyClavicleAssist = (
  chain: V3ArmIkChain,
  target: V3ArmIkTarget,
  alpha: number
): number => {
  const clavicleWorldPosition = worldPosition(chain.clavicle);
  const gripWorldPosition = worldPosition(chain.grip);
  const currentAim = safeUnit(
    gripWorldPosition.clone().sub(clavicleWorldPosition),
    sideFallbackPole(target.side)
  );
  const targetAim = safeUnit(
    target.targetWorldPosition.clone().sub(clavicleWorldPosition),
    currentAim
  );
  const angle = currentAim.angleTo(targetAim);
  if (!Number.isFinite(angle) || angle < 0.0001) return 0;
  const assistAlpha = Math.max(0, Math.min(1, alpha * 0.34));
  alignBoneVector(chain.clavicle, currentAim, targetAim, assistAlpha);
  return roundMetric(angle * assistAlpha);
};

export function getV3ArmIkGripWorldPosition(model: THREE.Group, side: V3ArmIkSide): THREE.Vector3 {
  model.updateWorldMatrix(true, true);
  const chain = getArmChain(model, side);
  return chain ? worldPosition(chain.grip) : EMPTY_VECTOR.clone();
}

export function applyV3ArmIkTarget(model: THREE.Group, target: V3ArmIkTarget): V3ArmIkResult {
  model.updateWorldMatrix(true, true);
  const chain = getArmChain(model, target.side);
  if (!chain) return emptyResult(target.side, target.targetWorldPosition);

  const alpha = Math.max(0, Math.min(1, target.alpha ?? 1));
  const clavicleAssistRotation = applyClavicleAssist(chain, target, alpha);
  model.updateWorldMatrix(true, true);
  const clavicleWorldPosition = worldPosition(chain.clavicle);
  const shoulderWorldPosition = worldPosition(chain.upperArm);
  const elbowWorldPosition = worldPosition(chain.forearm);
  const gripWorldPosition = worldPosition(chain.grip);
  const upperArmWorldLength = Math.max(0.0001, shoulderWorldPosition.distanceTo(elbowWorldPosition));
  const lowerArmWorldLength = Math.max(0.0001, elbowWorldPosition.distanceTo(gripWorldPosition));
  const shoulderToTarget = target.targetWorldPosition.clone().sub(shoulderWorldPosition);
  const rawDistance = shoulderToTarget.length();
  const maxReach = Math.max(0.0001, upperArmWorldLength + lowerArmWorldLength - 0.01);
  const minReach = Math.max(0.02, Math.abs(upperArmWorldLength - lowerArmWorldLength) + 0.005);
  const solvedDistance = Math.max(minReach, Math.min(maxReach, rawDistance || minReach));
  const direction = safeUnit(shoulderToTarget, new THREE.Vector3(0, -1, 0));
  const solvedTarget = shoulderWorldPosition.clone().add(direction.clone().multiplyScalar(solvedDistance));
  const rawClampDistance = Math.abs(solvedDistance - rawDistance);
  const reachClamped = rawClampDistance > 0.012;
  const clampDistance = reachClamped ? target.targetWorldPosition.distanceTo(solvedTarget) : 0;
  const alongDistance = (
    upperArmWorldLength * upperArmWorldLength -
    lowerArmWorldLength * lowerArmWorldLength +
    solvedDistance * solvedDistance
  ) / (2 * solvedDistance);
  const elbowHeight = Math.sqrt(Math.max(0, upperArmWorldLength * upperArmWorldLength - alongDistance * alongDistance));
  const poleInput = target.poleWorldDirection ?? sideFallbackPole(target.side);
  const pole = safeUnit(projectOnPlane(poleInput, direction), sideFallbackPole(target.side));
  const solvedElbow = shoulderWorldPosition.clone()
    .add(direction.clone().multiplyScalar(alongDistance))
    .add(pole.multiplyScalar(elbowHeight));

  alignBoneVector(
    chain.upperArm,
    elbowWorldPosition.clone().sub(shoulderWorldPosition),
    solvedElbow.clone().sub(shoulderWorldPosition),
    alpha
  );
  model.updateWorldMatrix(true, true);

  const updatedElbow = worldPosition(chain.forearm);
  const updatedGrip = worldPosition(chain.grip);
  alignBoneVector(
    chain.forearm,
    updatedGrip.clone().sub(updatedElbow),
    solvedTarget.clone().sub(updatedElbow),
    alpha
  );
  model.updateWorldMatrix(true, true);

  const actualGripWorldPosition = worldPosition(chain.grip);
  const finalElbowWorldPosition = worldPosition(chain.forearm);
  const finalClavicleWorldPosition = worldPosition(chain.clavicle);
  const finalShoulderWorldPosition = worldPosition(chain.upperArm);

  return {
    ready: true,
    side: target.side,
    reachClamped,
    clampDistance: roundMetric(clampDistance),
    drift: roundMetric(actualGripWorldPosition.distanceTo(target.targetWorldPosition)),
    clavicleAssistRotation,
    shoulderSeamDistance: roundMetric(finalClavicleWorldPosition.distanceTo(finalShoulderWorldPosition)),
    upperArmWorldLength: roundMetric(upperArmWorldLength),
    lowerArmWorldLength: roundMetric(lowerArmWorldLength),
    clavicleWorldPosition: finalClavicleWorldPosition,
    shoulderWorldPosition: finalShoulderWorldPosition,
    elbowWorldPosition: finalElbowWorldPosition,
    targetWorldPosition: target.targetWorldPosition.clone(),
    actualGripWorldPosition,
  };
}

const poleToWorld = (model: THREE.Group, poleDirection: readonly number[]): THREE.Vector3 => {
  model.updateWorldMatrix(true, false);
  return new THREE.Vector3(
    poleDirection[0] ?? 0,
    poleDirection[1] ?? 0,
    poleDirection[2] ?? 0
  ).applyQuaternion(model.getWorldQuaternion(new THREE.Quaternion())).normalize();
};

export function applyV3WeaponGripConstraints(
  model: THREE.Group | null | undefined,
  weaponModel: THREE.Object3D | null | undefined,
  constraints: readonly V3GripConstraint[]
): V3WeaponGripConstraintReport | null {
  if (!model || !weaponModel || constraints.length === 0) return null;
  const results: V3WeaponGripConstraintResult[] = [];

  for (const constraint of constraints) {
    const targetWorldPosition = getV3WeaponSocketWorldPosition(weaponModel, constraint.socketName);
    if (!targetWorldPosition) continue;
    const result = applyV3ArmIkTarget(model, {
      side: constraint.side,
      targetWorldPosition,
      poleWorldDirection: poleToWorld(model, constraint.poleDirection),
      alpha: 1,
    });
    results.push({
      ...result,
      socketName: constraint.socketName,
      required: constraint.required,
      maxDrift: constraint.maxDrift,
    });
  }

  const maxGripDrift = roundMetric(Math.max(0, ...results.map((result) => result.drift)));
  const maxShoulderSeamDistance = roundMetric(Math.max(0, ...results.map((result) => result.shoulderSeamDistance)));
  const reachClampCount = results.filter((result) => result.reachClamped).length;
  const report: V3WeaponGripConstraintReport = {
    ready: results.every((result) => (
      result.ready &&
      (!result.required || result.drift <= result.maxDrift || result.reachClamped)
    )),
    maxGripDrift,
    maxShoulderSeamDistance,
    reachClampCount,
    results,
  };
  model.userData.v3WeaponGripConstraintReport = report;
  return report;
}
