import * as THREE from 'three';

export const V3_READINESS_COMPARISON_TARGET_HEIGHT = 1.8;

export interface V3ReadinessComparisonWeaponRig {
  group: THREE.Object3D;
  hammer?: THREE.Object3D | null;
  sword?: THREE.Object3D | null;
  pistol?: THREE.Object3D | null;
}

export interface V3ReadinessComparisonNormalizeOptions {
  targetHeight?: number;
}

export interface V3ReadinessComparisonNormalizeResult {
  sourceHeight: number;
  normalizedHeight: number;
  scale: number;
}

function hideWeaponGroup(group: THREE.Object3D | null | undefined): void {
  if (!group) return;
  group.visible = false;
  group.userData.v3ReadinessComparisonHidden = true;
}

export function hideV3ReadinessComparisonWeapons(
  rig: V3ReadinessComparisonWeaponRig
): void {
  hideWeaponGroup(rig.hammer);
  hideWeaponGroup(rig.sword);
  hideWeaponGroup(rig.pistol);
}

export function normalizeV3ReadinessComparisonSubject(
  subject: THREE.Object3D,
  options: V3ReadinessComparisonNormalizeOptions = {}
): V3ReadinessComparisonNormalizeResult {
  const targetHeight = options.targetHeight ?? V3_READINESS_COMPARISON_TARGET_HEIGHT;
  subject.updateWorldMatrix(true, true);
  const sourceBounds = new THREE.Box3().setFromObject(subject);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceHeight = Math.max(0.0001, sourceSize.y);
  const scale = targetHeight / sourceHeight;

  subject.scale.setScalar(scale);
  subject.updateWorldMatrix(true, true);

  const scaledBounds = new THREE.Box3().setFromObject(subject);
  const scaledCenter = scaledBounds.getCenter(new THREE.Vector3());
  subject.position.x -= scaledCenter.x;
  subject.position.y -= scaledBounds.min.y;
  subject.position.z -= scaledCenter.z;
  subject.updateWorldMatrix(true, true);

  const normalizedBounds = new THREE.Box3().setFromObject(subject);
  const normalizedHeight = normalizedBounds.getSize(new THREE.Vector3()).y;

  return {
    sourceHeight,
    normalizedHeight,
    scale,
  };
}
