import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { V3_DETAIL_BONE_NAMES, V3_DETAIL_BONE_SPECS } from '../v3/v3RigDetail';
import { buildCombatantRigForModel } from './combatantRig';
import { sampleV3AuthoredClip } from './v3AuthoredAnimationClips';
import {
  analyzeV3CleanRigContinuity,
  applyV3CleanRigPose,
  getV3CleanRig,
  type V3CleanRigPose,
} from './v3CleanRig';

const createModel = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  return model;
};

const tupleFinite = (value: readonly number[]) => value.every(Number.isFinite);

describe('v3CleanRig', () => {
  it('builds a complete finite clean hierarchy from the accepted V3 detail bones', () => {
    const model = createModel();
    const rig = getV3CleanRig(model);

    assert.equal(rig.ready, true);
    assert.deepEqual(Object.keys(rig.joints).sort(), [...V3_DETAIL_BONE_NAMES].sort());

    for (const jointName of V3_DETAIL_BONE_NAMES) {
      const joint = rig.joints[jointName];
      const spec = V3_DETAIL_BONE_SPECS[jointName];
      assert.equal(joint.parent, spec.parent ?? null, `${jointName} parent should match clean rig spec`);
      assert.equal(tupleFinite(joint.restLocalPosition), true, `${jointName} rest local position must be finite`);
      assert.equal(tupleFinite(joint.restWorldPosition), true, `${jointName} rest world position must be finite`);
      assert.equal(tupleFinite(joint.restLocalQuaternion), true, `${jointName} rest local quaternion must be finite`);
      assert.equal(tupleFinite(joint.axes.forward), true, `${jointName} forward axis must be finite`);
    }
  });

  it('restores a broken legacy pose and reports connected idle arm seams', () => {
    const model = createModel();
    getV3CleanRig(model);
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;

    detailBones.upperArmLeft.rotation.set(1.4, -0.9, 0.8);
    detailBones.forearmLeft.position.add(new THREE.Vector3(-0.4, 0.5, 0.2));
    detailBones.handLeft.rotation.set(-1.2, 0.4, -0.7);
    model.updateMatrixWorld(true);

    const cleanIdle: V3CleanRigPose = {
      clipId: 'clean_idle',
      normalizedTime: 0,
      jointQuaternions: {},
    };
    const applied = applyV3CleanRigPose(model, cleanIdle);
    assert.equal(applied.ready, true);

    const report = analyzeV3CleanRigContinuity(model);
    assert.equal(report.ready, true, report.warnings.join(', '));
    assert.equal(report.jointSeamWarnings.length, 0);
    assert.ok(detailBones.upperArmLeft.quaternion.angleTo(new THREE.Quaternion()) < 0.0001);
    assert.ok(detailBones.handLeft.quaternion.angleTo(new THREE.Quaternion()) < 0.0001);
  });

  it('applies Mesh2Motion driver poses through visible part bindings and clears them on the next clean pose', () => {
    const model = createModel();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const handRest = partGroups.handRight.position.toArray();
    const detailBoneRest = detailBones.handRight.position.toArray();

    const sprint = sampleV3AuthoredClip('clean_sprint', { normalizedTime: 0.25 });
    assert.equal(sprint.motionSource, 'mesh2Motion');
    assert.ok(sprint.pose.mesh2MotionDriverPose);

    const appliedSprint = applyV3CleanRigPose(model, sprint.pose);
    assert.equal(appliedSprint.ready, true);
    assert.notDeepEqual(
      partGroups.handRight.position.toArray().map((value) => Number(value.toFixed(5))),
      handRest.map((value) => Number(value.toFixed(5)))
    );
    assert.deepEqual(
      detailBones.handRight.position.toArray().map((value) => Number(value.toFixed(5))),
      detailBoneRest.map((value) => Number(value.toFixed(5)))
    );

    const cleanIdle: V3CleanRigPose = {
      clipId: 'clean_idle',
      normalizedTime: 0,
      jointQuaternions: {},
    };
    const appliedIdle = applyV3CleanRigPose(model, cleanIdle);
    assert.equal(appliedIdle.ready, true);
    assert.deepEqual(
      partGroups.handRight.position.toArray().map((value) => Number(value.toFixed(5))),
      handRest.map((value) => Number(value.toFixed(5)))
    );
  });

  it('treats Mesh2Motion driver joint offsets as expected continuity distances', () => {
    for (const [clipId, normalizedTime] of [
      ['clean_sprint', 0.25],
      ['clean_slide', 0.5],
      ['clean_sword_lunge', 0.5],
      ['clean_sword_slash', 0.5],
    ] as const) {
      const model = createModel();
      const sample = sampleV3AuthoredClip(clipId, { normalizedTime });
      assert.equal(sample.motionSource, 'mesh2Motion');

      applyV3CleanRigPose(model, sample.pose);
      const report = analyzeV3CleanRigContinuity(model);

      assert.equal(report.ready, true, `${clipId}: ${report.warnings.join(', ')}`);
      assert.ok(report.maxJointSeamGap < 0.001, `${clipId}: seam gap ${report.maxJointSeamGap}`);
    }
  });
});
