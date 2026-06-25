import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import {
  V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
  V3_MESH2MOTION_ARMOR_SLOT_SPECS,
  V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS,
  buildV3Mesh2MotionArmorRig,
  analyzeV3Mesh2MotionArmorRig,
} from './v3Mesh2MotionArmorRig';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';

type GeneratedArmorRigWithCalibration = typeof V3_MESH2MOTION_ARMOR_RIG & {
  calibration?: {
    sourceToTargetScale?: number;
  };
};

const tupleLength = (value: readonly number[]): number =>
  Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);

const quaternionFromTuple = (value: readonly number[]): THREE.Quaternion =>
  new THREE.Quaternion(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1).normalize();

const tupleCloseTo = (
  actual: readonly number[],
  expected: readonly number[],
  tolerance = 0.000001
): boolean => actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

const geometryWorldQuaternion = (placement: {
  pivotWorldQuaternion: readonly number[];
  geometry: { rotation: readonly number[] };
}): THREE.Quaternion => {
  const pivot = quaternionFromTuple(placement.pivotWorldQuaternion);
  const geometry = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    placement.geometry.rotation[0] ?? 0,
    placement.geometry.rotation[1] ?? 0,
    placement.geometry.rotation[2] ?? 0,
    'XYZ'
  ));
  return pivot.multiply(geometry).normalize();
};

describe('v3Mesh2MotionArmorRig', () => {
  it('ships a V3-owned generated Mesh2Motion armor rig contract without raw source payloads', () => {
    const serialized = JSON.stringify(V3_MESH2MOTION_ARMOR_RIG);

    assert.equal(V3_MESH2MOTION_ARMOR_RIG.schemaVersion, V3_MESH2MOTION_ARMOR_RIG_SCHEMA);
    assert.equal(V3_MESH2MOTION_ARMOR_RIG.source.fileName, 'exported-model.glb');
    assert.match(V3_MESH2MOTION_ARMOR_RIG.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.length >= 20, true);
    assert.deepEqual(Object.keys(V3_MESH2MOTION_ARMOR_RIG.slots).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    const sourceToTargetScale = (V3_MESH2MOTION_ARMOR_RIG as GeneratedArmorRigWithCalibration)
      .calibration?.sourceToTargetScale;
    assert.equal(Number.isFinite(sourceToTargetScale), true);
    assert.ok((sourceToTargetScale ?? 0) > 0.5 && (sourceToTargetScale ?? 0) < 1);
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('ArrayBuffer'), false);
    assert.equal(serialized.includes('"nodes"'), false);
    assert.equal(serialized.includes('"meshes"'), false);
    assert.equal(serialized.includes('"skins"'), false);
  });

  it('defines every V3 armor slot from Mesh2Motion TPose source and segment joints', () => {
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const spec = V3_MESH2MOTION_ARMOR_SLOT_SPECS[slot];
      const placement = V3_MESH2MOTION_ARMOR_RIG.slots[slot];

      assert.equal(placement.slot, slot);
      assert.equal(placement.sourceJointName, spec.sourceJointName);
      assert.equal(placement.endJointName, spec.endJointName);
      assert.deepEqual(placement.centerJointNames, spec.centerJointNames);
      assert.equal(placement.pivotCenter.length, 3);
      assert.equal(placement.pivotWorldPosition.length, 3);
      assert.equal(placement.pivotWorldQuaternion.length, 4);
      assert.equal(placement.basis.xAxis.length, 3);
      assert.equal(placement.basis.yAxis.length, 3);
      assert.equal(placement.basis.zAxis.length, 3);
      assert.equal(placement.basis.quaternion.length, 4);
      assert.equal(placement.geometry.position.length, 3);
      assert.equal(placement.geometry.rotation.length, 3);
      assert.equal(placement.geometry.scale.length, 3);
      assert.ok(Math.abs(tupleLength(placement.basis.xAxis) - 1) < 0.000001, `${slot} basis xAxis normalized`);
      assert.ok(Math.abs(tupleLength(placement.basis.yAxis) - 1) < 0.000001, `${slot} basis yAxis normalized`);
      assert.ok(Math.abs(tupleLength(placement.basis.zAxis) - 1) < 0.000001, `${slot} basis zAxis normalized`);
      assert.ok(tupleLength(placement.pivotWorldPosition) > 0 || slot === 'pelvis');
    }
  });

  it('builds a rest skeleton and slot pivots with non-inverted foot and mirrored limb bases', () => {
    const rig = buildV3Mesh2MotionArmorRig();
    const leftFoot = rig.slotPivots.footLeft;
    const rightFoot = rig.slotPivots.footRight;
    const leftArm = rig.slotPivots.upperArmLeft;
    const rightArm = rig.slotPivots.upperArmRight;

    const leftFootForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(leftFoot.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const rightFootForward = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(rightFoot.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const leftArmUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(leftArm.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const rightArmUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(rightArm.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();

    assert.ok(leftFootForward.z > 0.65, `left foot forward axis should point toward toes: ${leftFootForward.toArray()}`);
    assert.ok(rightFootForward.z > 0.65, `right foot forward axis should point toward toes: ${rightFootForward.toArray()}`);
    assert.ok(Math.abs(leftFootForward.y) < 0.35, `left foot forward axis should not point vertically: ${leftFootForward.toArray()}`);
    assert.ok(Math.abs(rightFootForward.y) < 0.35, `right foot forward axis should not point vertically: ${rightFootForward.toArray()}`);
    assert.ok(leftArmUp.x > 0.75, `left upper arm +Y should point down the left arm: ${leftArmUp.toArray()}`);
    assert.ok(rightArmUp.x < -0.75, `right upper arm +Y should point down the right arm: ${rightArmUp.toArray()}`);
    assert.ok(Math.abs(leftArmUp.y - rightArmUp.y) < 0.1);
  });

  it('keeps articulated limb slot geometry centered on Mesh2Motion-native pivots', () => {
    const rig = buildV3Mesh2MotionArmorRig();

    for (const slot of V3_MESH2MOTION_NATIVE_LIMB_CHAIN_SLOTS) {
      const generatedPlacement = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
      const runtimePlacement = rig.slotPivots[slot].userData.v3Mesh2MotionSlotPlacement as typeof generatedPlacement;

      assert.equal(tupleCloseTo(generatedPlacement.geometry.position, [0, 0, 0]), true, `${slot} generated offset`);
      assert.equal(tupleCloseTo(runtimePlacement.geometry.position, [0, 0, 0]), true, `${slot} runtime offset`);
      assert.ok(
        new THREE.Quaternion().angleTo(geometryWorldQuaternion(generatedPlacement)) <= 0.00001,
        `${slot} generated geometry rotation should cancel the Mesh2Motion rest pivot`
      );
      assert.ok(
        new THREE.Quaternion().angleTo(geometryWorldQuaternion(runtimePlacement)) <= 0.00001,
        `${slot} runtime geometry rotation should cancel the Mesh2Motion rest pivot`
      );
    }
  });

  it('reports a ready contract with normalized quaternions and no missing slots', () => {
    const report = analyzeV3Mesh2MotionArmorRig(V3_MESH2MOTION_ARMOR_RIG);

    assert.equal(report.ready, true, report.issues.join('; '));
    assert.equal(report.slotCount, V3_CHARACTER_SLOT_IDS.length);
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const quaternionLength = quaternionFromTuple(V3_MESH2MOTION_ARMOR_RIG.slots[slot].pivotWorldQuaternion).length();
      assert.ok(Math.abs(quaternionLength - 1) < 0.000001, `${slot} pivot quaternion should be normalized`);
    }
  });
});
