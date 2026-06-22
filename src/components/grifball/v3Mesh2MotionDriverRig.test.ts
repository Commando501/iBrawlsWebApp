import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { buildCombatantRigForModel } from './combatantRig';
import { sampleV3AuthoredClip } from './v3AuthoredAnimationClips';
import {
  applyV3CleanRigPose,
  type V3CleanRigPose,
} from './v3CleanRig';
import {
  getV3Mesh2MotionDriverRig,
  resetV3Mesh2MotionDriverRigPose,
} from './v3Mesh2MotionDriverRig';
import { V3_MESH2MOTION_DEFAULT_CALIBRATION } from './v3Mesh2MotionCalibration';

const roundTuple = (value: readonly number[]): number[] =>
  value.map((component) => Number(component.toFixed(5)));

const worldPosition = (object: THREE.Object3D): number[] =>
  roundTuple(object.getWorldPosition(new THREE.Vector3()).toArray());

const worldBoxCenter = (object: THREE.Object3D): THREE.Vector3 =>
  new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

const createModel = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  model.updateMatrixWorld(true);
  return model;
};

describe('v3Mesh2MotionDriverRig', () => {
  it('builds a hidden Mesh2Motion driver skeleton with visible V3 part bindings', () => {
    const model = createModel();
    const rig = getV3Mesh2MotionDriverRig(model);

    assert.equal(rig.ready, true, rig.warnings.join(', '));
    assert.equal(rig.root.parent, model);
    assert.equal(rig.root.visible, false);
    assert.ok(rig.joints.pelvis?.object instanceof THREE.Group);
    assert.ok(rig.joints.hand_r?.object instanceof THREE.Group);
    assert.equal(rig.joints.pelvis.parentName, 'root');
    assert.equal(rig.partBindings.handRight?.sourceJointName, 'hand_r');
    assert.equal(rig.partBindings.chest?.sourceJointName, 'spine_03');
    assert.equal(rig.weaponSockets.rightHandGrip.sourceJointName, 'hand_r');
    assert.equal(rig.weaponSockets.leftHandGrip.sourceJointName, 'hand_l');
  });

  it('applies Mesh2Motion clips through the driver skeleton instead of rotating clean detail bones', () => {
    const model = createModel();
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const handRestLocal = roundTuple(partGroups.handRight.position.toArray());
    const handRestWorld = worldPosition(partGroups.handRight);
    const cleanBoneRest = roundTuple(detailBones.handRight.position.toArray());

    const sprint = sampleV3AuthoredClip('clean_sprint', { normalizedTime: 0.25 });
    assert.equal(sprint.motionSource, 'mesh2Motion');
    assert.ok(sprint.pose.mesh2MotionDriverPose);
    assert.ok(sprint.pose.mesh2MotionDriverPose.joints.hand_r);

    const applied = applyV3CleanRigPose(model, sprint.pose);
    assert.equal(applied.ready, true, applied.warnings.join(', '));
    assert.equal(model.userData.v3Mesh2MotionDriverActive, true);
    assert.deepEqual(roundTuple(detailBones.handRight.position.toArray()), cleanBoneRest);
    assert.notDeepEqual(roundTuple(partGroups.handRight.position.toArray()), handRestLocal);
    assert.notDeepEqual(worldPosition(partGroups.handRight), handRestWorld);

    const cleanIdle: V3CleanRigPose = {
      clipId: 'clean_idle',
      normalizedTime: 0,
      jointQuaternions: {},
    };
    const reset = applyV3CleanRigPose(model, cleanIdle);
    assert.equal(reset.ready, true, reset.warnings.join(', '));
    assert.equal(model.userData.v3Mesh2MotionDriverActive, false);
    assert.deepEqual(roundTuple(partGroups.handRight.position.toArray()), handRestLocal);
    assert.deepEqual(roundTuple(detailBones.handRight.position.toArray()), cleanBoneRest);
  });

  it('can reset a previously applied driver pose without requiring a clean-rig sample', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const chestRestLocal = roundTuple(partGroups.chest.position.toArray());
    const slide = sampleV3AuthoredClip('clean_slide', { normalizedTime: 0.5 });

    applyV3CleanRigPose(model, slide.pose);
    assert.equal(model.userData.v3Mesh2MotionDriverActive, true);
    assert.notDeepEqual(roundTuple(partGroups.chest.position.toArray()), chestRestLocal);

    resetV3Mesh2MotionDriverRigPose(model);
    assert.equal(model.userData.v3Mesh2MotionDriverActive, false);
    assert.deepEqual(roundTuple(partGroups.chest.position.toArray()), chestRestLocal);
  });

  it('keeps Mesh2Motion sprint arms laterally clear of the torso armor', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const sprint = sampleV3AuthoredClip('clean_sprint', { normalizedTime: 0.5 });

    applyV3CleanRigPose(model, sprint.pose);
    model.updateMatrixWorld(true);

    const chestCenter = worldBoxCenter(partGroups.chest);
    for (const slot of ['upperArmLeft', 'forearmLeft', 'handLeft', 'upperArmRight', 'forearmRight', 'handRight'] as const) {
      const gap = Math.abs(worldBoxCenter(partGroups[slot]).x - chestCenter.x);
      assert.ok(gap >= 0.18, `${slot} lateral gap ${gap.toFixed(4)} should keep sprint arms out of the chest`);
    }
  });

  it('applies Mesh2Motion arm calibration through the driver chain before visible part binding', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const restForearmHandDistance = worldBoxCenter(partGroups.forearmRight)
      .distanceTo(worldBoxCenter(partGroups.handRight));
    const slash = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.75 });

    applyV3CleanRigPose(model, slash.pose);
    model.updateMatrixWorld(true);

    const report = model.userData.v3Mesh2MotionDriverCalibrationReport as {
      calibrationVersion?: string;
      postBindPartAdjustments?: number;
      armSpread?: { left: number; right: number };
    } | undefined;
    const animatedForearmHandDistance = worldBoxCenter(partGroups.forearmRight)
      .distanceTo(worldBoxCenter(partGroups.handRight));

    assert.equal(report?.calibrationVersion, V3_MESH2MOTION_DEFAULT_CALIBRATION.version);
    assert.equal(report?.postBindPartAdjustments, 0);
    assert.equal(report?.armSpread?.right, V3_MESH2MOTION_DEFAULT_CALIBRATION.armSpread.right);
    assert.ok(
      animatedForearmHandDistance <= restForearmHandDistance + 0.16,
      `right forearm/hand center distance ${animatedForearmHandDistance.toFixed(4)} should stay close to rest ${restForearmHandDistance.toFixed(4)}`
    );
  });
});
