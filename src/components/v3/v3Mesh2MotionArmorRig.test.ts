import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import {
  V3_MESH2MOTION_ARMOR_RIG_SCHEMA,
  V3_MESH2MOTION_ARMOR_SLOT_SPECS,
  buildV3Mesh2MotionArmorRig,
  analyzeV3Mesh2MotionArmorRig,
} from './v3Mesh2MotionArmorRig';
import { V3_CHARACTER_SLOT_IDS } from './v3ModelTypes';

const tupleLength = (value: readonly number[]): number =>
  Math.hypot(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);

const quaternionFromTuple = (value: readonly number[]): THREE.Quaternion =>
  new THREE.Quaternion(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1);

const tupleIsFinite = (value: readonly number[] | undefined, length = 3): value is readonly number[] =>
  Array.isArray(value) && value.length === length && value.every(Number.isFinite);

const assertValidEnvelope = (
  slot: string,
  envelope: {
    min?: readonly number[];
    max?: readonly number[];
    size?: readonly number[];
  } | undefined,
  geometryPosition: readonly number[]
): void => {
  assert.ok(envelope, `${slot} localEnvelope should be present`);
  assert.equal(tupleIsFinite(envelope.min), true, `${slot} localEnvelope min should be finite`);
  assert.equal(tupleIsFinite(envelope.max), true, `${slot} localEnvelope max should be finite`);
  assert.equal(tupleIsFinite(envelope.size), true, `${slot} localEnvelope size should be finite`);

  for (let index = 0; index < 3; index += 1) {
    const min = envelope.min[index];
    const max = envelope.max[index];
    const size = envelope.size[index];
    assert.ok(max > min, `${slot} localEnvelope axis ${index} should have positive extent`);
    assert.ok(Math.abs(size - (max - min)) < 0.000001, `${slot} localEnvelope axis ${index} size should match max-min`);
    assert.ok(geometryPosition[index] >= min - 0.000001, `${slot} geometry center should be inside envelope min`);
    assert.ok(geometryPosition[index] <= max + 0.000001, `${slot} geometry center should be inside envelope max`);
  }
};

const EXPECTED_MIRROR_OF = {
  helmet: null,
  neck: null,
  chest: null,
  shoulderLeft: null,
  shoulderRight: 'shoulderLeft',
  upperArmLeft: null,
  upperArmRight: 'upperArmLeft',
  forearmLeft: null,
  forearmRight: 'forearmLeft',
  handLeft: null,
  handRight: 'handLeft',
  pelvis: null,
  thighLeft: null,
  thighRight: 'thighLeft',
  shinLeft: null,
  shinRight: 'shinLeft',
  footLeft: null,
  footRight: 'footLeft',
  back: null,
} as const;

describe('v3Mesh2MotionArmorRig', () => {
  it('ships a V3-owned generated Mesh2Motion armor rig contract without raw source payloads', () => {
    const serialized = JSON.stringify(V3_MESH2MOTION_ARMOR_RIG);

    assert.equal(V3_MESH2MOTION_ARMOR_RIG.schemaVersion, V3_MESH2MOTION_ARMOR_RIG_SCHEMA);
    assert.equal(V3_MESH2MOTION_ARMOR_RIG.source.fileName, 'exported-model.glb');
    assert.match(V3_MESH2MOTION_ARMOR_RIG.source.sha256, /^[a-f0-9]{64}$/);
    assert.equal(V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.length >= 20, true);
    assert.deepEqual(Object.keys(V3_MESH2MOTION_ARMOR_RIG.slots).sort(), [...V3_CHARACTER_SLOT_IDS].sort());
    assert.equal(serialized.includes(process.cwd()), false);
    assert.equal(serialized.includes('C:'), false);
    assert.equal(serialized.includes('G:'), false);
    assert.equal(serialized.includes('ArrayBuffer'), false);
    assert.equal(serialized.includes('"nodes"'), false);
    assert.equal(serialized.includes('"meshes"'), false);
    assert.equal(serialized.includes('"skins"'), false);
  });

  it('defines every V3 armor slot from Mesh2Motion TPose source and segment joints', () => {
    const jointByName = new Map(V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.map((joint) => [joint.name, joint]));

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const spec = V3_MESH2MOTION_ARMOR_SLOT_SPECS[slot];
      const placement = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
      const sourceJoint = jointByName.get(placement.sourceJointName);
      const endJoint = placement.endJointName ? jointByName.get(placement.endJointName) : null;

      assert.equal(placement.slot, slot);
      assert.equal(placement.sourceJointName, spec.sourceJointName);
      assert.equal(placement.endJointName, spec.endJointName);
      assert.deepEqual(placement.centerJointNames, spec.centerJointNames);
      assert.ok(sourceJoint, `${slot} source joint should exist`);
      if (placement.endJointName) assert.ok(endJoint, `${slot} end joint should exist`);
      for (const centerJointName of placement.centerJointNames) {
        assert.ok(jointByName.has(centerJointName), `${slot} center joint ${centerJointName} should exist`);
      }
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
      assert.ok(Math.abs(quaternionFromTuple(placement.basis.quaternion).length() - 1) < 0.000001, `${slot} basis quaternion normalized`);
      assert.ok(Math.abs(quaternionFromTuple(placement.pivotWorldQuaternion).length() - 1) < 0.000001, `${slot} pivot quaternion normalized`);
      assert.ok(tupleLength(placement.pivotWorldPosition) > 0 || slot === 'pelvis');

      assert.equal(Number.isFinite(placement.segmentLength), true, `${slot} segmentLength should be finite`);
      if (sourceJoint && endJoint) {
        const expectedSegmentLength = tupleLength([
          endJoint.restWorldPosition[0] - sourceJoint.restWorldPosition[0],
          endJoint.restWorldPosition[1] - sourceJoint.restWorldPosition[1],
          endJoint.restWorldPosition[2] - sourceJoint.restWorldPosition[2],
        ]);
        assert.ok(placement.segmentLength > 0, `${slot} segmentLength should be positive`);
        assert.ok(
          Math.abs(placement.segmentLength - expectedSegmentLength) < 0.000001,
          `${slot} segmentLength should match source-to-end joint distance`
        );
      } else {
        assert.equal(placement.segmentLength, 0, `${slot} unsegmented slot should declare zero segmentLength`);
      }

      assert.equal(placement.localVoxelGridDimensions.length, 3);
      for (const dimension of placement.localVoxelGridDimensions) {
        assert.equal(Number.isInteger(dimension), true, `${slot} local voxel grid dimension should be an integer`);
        assert.ok(dimension > 0, `${slot} local voxel grid dimension should be positive`);
      }
      assert.equal(Number.isFinite(placement.jointClearance), true, `${slot} jointClearance should be finite`);
      assert.ok(placement.jointClearance > 0, `${slot} jointClearance should be positive`);
      assert.equal(placement.mirrorOf, EXPECTED_MIRROR_OF[slot], `${slot} mirrorOf should be deterministic`);
      if (placement.mirrorOf) {
        assert.ok(V3_CHARACTER_SLOT_IDS.includes(placement.mirrorOf), `${slot} mirrorOf should reference a V3 slot`);
        assert.notEqual(placement.mirrorOf, slot, `${slot} mirrorOf should not reference itself`);
      }
      assertValidEnvelope(slot, placement.localEnvelope, placement.geometry.position);
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
