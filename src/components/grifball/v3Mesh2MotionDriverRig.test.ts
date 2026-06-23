import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3SpartanModel } from '../v3/VoxelModelsV3';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../v3/v3ModelTypes';
import { buildCombatantRigForModel } from './combatantRig';
import { sampleV3AuthoredClip } from './v3AuthoredAnimationClips';
import {
  applyV3CleanRigPose,
  type V3CleanRigPose,
} from './v3CleanRig';
import {
  applyV3Mesh2MotionDriverRigPose,
  buildV3Mesh2MotionDriverBindingDiagnostics,
  getV3Mesh2MotionDriverRig,
  getV3Mesh2MotionDriverWeaponSocketWorldTransform,
  resetV3Mesh2MotionDriverRigPose,
  type V3Mesh2MotionDriverPose,
} from './v3Mesh2MotionDriverRig';
import {
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  normalizeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
} from './v3Mesh2MotionCalibration';
import { V3_MESH2MOTION_CLIP_SET } from './v3Mesh2MotionClips.generated';

const roundTuple = (value: readonly number[]): number[] =>
  value.map((component) => Number(component.toFixed(5)));

const worldPosition = (object: THREE.Object3D): number[] =>
  roundTuple(object.getWorldPosition(new THREE.Vector3()).toArray());

const worldBoxCenter = (object: THREE.Object3D): THREE.Vector3 =>
  new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());

const worldMatrix = (object: THREE.Object3D): THREE.Matrix4 => {
  object.updateWorldMatrix(true, false);
  return object.matrixWorld.clone();
};

const assertWorldMatrixClose = (
  actual: THREE.Matrix4,
  expected: THREE.Matrix4,
  label: string,
  tolerance = 0.000001
): void => {
  const actualPosition = new THREE.Vector3();
  const actualQuaternion = new THREE.Quaternion();
  const actualScale = new THREE.Vector3();
  actual.decompose(actualPosition, actualQuaternion, actualScale);

  const expectedPosition = new THREE.Vector3();
  const expectedQuaternion = new THREE.Quaternion();
  const expectedScale = new THREE.Vector3();
  expected.decompose(expectedPosition, expectedQuaternion, expectedScale);

  assert.ok(
    actualPosition.distanceTo(expectedPosition) <= tolerance,
    `${label} pivot position drift ${actualPosition.distanceTo(expectedPosition).toFixed(8)}`
  );
  assert.ok(
    1 - Math.abs(actualQuaternion.dot(expectedQuaternion)) <= tolerance,
    `${label} pivot rotation drift ${(1 - Math.abs(actualQuaternion.dot(expectedQuaternion))).toFixed(8)}`
  );
  assert.ok(
    actualScale.distanceTo(expectedScale) <= tolerance,
    `${label} pivot scale drift ${actualScale.distanceTo(expectedScale).toFixed(8)}`
  );
};

const assertFiniteSlotTransform = (slot: V3CharacterSlotId, object: THREE.Object3D): void => {
  object.updateWorldMatrix(true, false);
  const position = object.getWorldPosition(new THREE.Vector3());
  const scale = object.getWorldScale(new THREE.Vector3());
  assert.equal(position.toArray().every(Number.isFinite), true, `${slot} world position should be finite`);
  assert.equal(scale.toArray().every((value) => Number.isFinite(value) && value > 0), true, `${slot} world scale should be finite and positive`);
  assert.ok(object.matrixWorld.determinant() > 0, `${slot} world matrix should not be mirrored or inverted`);
};

const generatedDriverPose = (sourceClipName: string): V3Mesh2MotionDriverPose => {
  const clip = V3_MESH2MOTION_CLIP_SET.clips.find((candidate) => candidate.sourceClipName === sourceClipName);
  assert.ok(clip, `expected generated Mesh2Motion clip ${sourceClipName}`);
  return {
    sourceClipName,
    sourceNormalizedTime: 0,
    joints: Object.fromEntries(
      Object.entries(clip.driverJoints).map(([jointName, track]) => [
        jointName,
        {
          position: track.positions[0],
          quaternion: track.quaternions[0],
        },
      ])
    ),
  };
};

const createModel = () => {
  const model = buildV3SpartanModel({ isEnemy: false, customHue: 192 });
  buildCombatantRigForModel(model);
  model.updateMatrixWorld(true);
  return model;
};

describe('v3Mesh2MotionDriverRig', () => {
  afterEach(() => {
    setV3Mesh2MotionCalibrationOverride(null);
  });

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

  it('reports clean Mesh2Motion-native binding diagnostics for every visible V3 slot pivot', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<V3CharacterSlotId, THREE.Group>;
    const geometryGroups = model.userData.v3PartGeometryGroups as Record<V3CharacterSlotId, THREE.Group>;
    const rig = getV3Mesh2MotionDriverRig(model);
    const report = buildV3Mesh2MotionDriverBindingDiagnostics(rig);

    assert.equal(report.ready, true, report.items.map((item) => `${item.slot}:${item.code}`).join(', '));
    assert.equal(rig.bindingDiagnostics.ready, true);
    assert.equal(model.userData.v3Mesh2MotionDriverBindingDiagnostics.ready, true);
    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const binding = rig.partBindings[slot];
      assert.ok(binding, `missing ${slot} binding`);
      assert.equal(binding.sourceJointName, partGroups[slot].userData.v3Mesh2MotionSlotPlacement.sourceJointName);
      assert.equal(binding.geometryGroup, geometryGroups[slot]);
      assert.equal(binding.geometryGroup?.parent, partGroups[slot]);
      assert.ok(binding.sourceSegmentLength === null || binding.sourceSegmentLength >= 0, `${slot} segment length`);
      assert.ok(binding.restSegmentLocalOffset?.every(Number.isFinite), `${slot} rest segment-local offset`);
      assert.equal(binding.bindMatrix.elements.every(Number.isFinite), true, `${slot} bind matrix should be finite`);
    }
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

  it('binds Mesh2Motion TPose visible limb part pivots to driver joint matrices', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const pose = generatedDriverPose('TPose');
    const applied = applyV3Mesh2MotionDriverRigPose(model, pose);
    const rig = getV3Mesh2MotionDriverRig(model);

    assert.equal(applied.ready, true, applied.warnings.join(', '));

    const assertSlotPivot = (slot: keyof typeof rig.partBindings) => {
      const binding = rig.partBindings[slot];
      assert.ok(binding, `missing Mesh2Motion part binding ${slot}`);
      const joint = rig.joints[binding.sourceJointName];
      assert.ok(joint, `missing Mesh2Motion joint ${binding.sourceJointName}`);
      const expectedWorldMatrix = joint.object.matrixWorld.clone().multiply(binding.bindMatrix);
      assertWorldMatrixClose(
        worldMatrix(partGroups[slot]),
        expectedWorldMatrix,
        `${slot} pivot`
      );
    };

    assertSlotPivot('upperArmLeft');
    assertSlotPivot('forearmLeft');
    assertSlotPivot('upperArmRight');
    assertSlotPivot('forearmRight');
    assertSlotPivot('thighLeft');
    assertSlotPivot('shinLeft');
    assertSlotPivot('thighRight');
    assertSlotPivot('shinRight');
  });

  it('does not infer forearm placement from hand detail bones or lowerarm-to-hand segment centers', () => {
    const model = createModel();
    const partGroups = model.userData.v3PartGroups as Record<string, THREE.Group>;
    const detailBones = model.userData.v3DetailBones as Record<string, THREE.Group>;
    const pose = generatedDriverPose('TPose');
    const baseline = applyV3Mesh2MotionDriverRigPose(model, pose);
    const rig = getV3Mesh2MotionDriverRig(model);

    assert.equal(baseline.ready, true, baseline.warnings.join(', '));

    const baselineForearmWorldMatrix = worldMatrix(partGroups.forearmRight);
    const baselineHandWorldMatrix = worldMatrix(partGroups.handRight);
    const detailHandRestLocal = roundTuple(detailBones.handRight.position.toArray());
    const lowerarmWorld = rig.joints.lowerarm_r.object.getWorldPosition(new THREE.Vector3());
    const handWorld = rig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());
    const baselineSegmentCenter = lowerarmWorld.clone().add(handWorld).multiplyScalar(0.5);

    const movedHandQuaternion = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.2, -0.35, 0.5, 'XYZ'))
      .normalize()
      .toArray() as [number, number, number, number];
    const movedPose: V3Mesh2MotionDriverPose = {
      ...pose,
      joints: {
        ...pose.joints,
        hand_r: {
          position: [
            pose.joints.hand_r.position[0] + 0.42,
            pose.joints.hand_r.position[1] - 0.11,
            pose.joints.hand_r.position[2] + 0.27,
          ],
          quaternion: movedHandQuaternion,
        },
      },
    };

    const moved = applyV3Mesh2MotionDriverRigPose(model, movedPose);
    assert.equal(moved.ready, true, moved.warnings.join(', '));
    model.updateMatrixWorld(true);

    const movedSegmentCenter = lowerarmWorld
      .copy(rig.joints.lowerarm_r.object.getWorldPosition(new THREE.Vector3()))
      .add(rig.joints.hand_r.object.getWorldPosition(new THREE.Vector3()))
      .multiplyScalar(0.5);
    assert.ok(
      movedSegmentCenter.distanceTo(baselineSegmentCenter) > 0.2,
      'test setup should move the lowerarm-to-hand inferred segment center'
    );

    assertWorldMatrixClose(
      worldMatrix(partGroups.forearmRight),
      baselineForearmWorldMatrix,
      'forearmRight pivot after isolated hand_r movement'
    );
    assert.ok(
      worldMatrix(partGroups.handRight).elements.some((component, index) =>
        Math.abs(component - baselineHandWorldMatrix.elements[index]) > 0.000001
      ),
      'handRight pivot should move with the Mesh2Motion hand_r joint'
    );

    const handBinding = rig.partBindings.handRight;
    assert.ok(handBinding);
    const expectedHandWorldMatrix = rig.joints.hand_r.object.matrixWorld.clone().multiply(handBinding.bindMatrix);
    assertWorldMatrixClose(
      worldMatrix(partGroups.handRight),
      expectedHandWorldMatrix,
      'handRight pivot after isolated hand_r movement'
    );
    assert.deepEqual(roundTuple(detailBones.handRight.position.toArray()), detailHandRestLocal);
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

  it('keeps sprint, slide, and sword Mesh2Motion animations bound to native V3 slot pivots', () => {
    const cases = [
      ['clean_sprint', 0.5],
      ['clean_slide', 0.5],
      ['clean_sword_carry', 0.25],
      ['clean_sword_lunge', 0.5],
      ['clean_sword_slash', 0.5],
    ] as const;
    const seamPairs = [
      ['shoulderLeft', 'upperArmLeft'],
      ['upperArmLeft', 'forearmLeft'],
      ['forearmLeft', 'handLeft'],
      ['shoulderRight', 'upperArmRight'],
      ['upperArmRight', 'forearmRight'],
      ['forearmRight', 'handRight'],
      ['thighLeft', 'shinLeft'],
      ['shinLeft', 'footLeft'],
      ['thighRight', 'shinRight'],
      ['shinRight', 'footRight'],
    ] as const;

    for (const [clipId, normalizedTime] of cases) {
      const model = createModel();
      const partGroups = model.userData.v3PartGroups as Record<V3CharacterSlotId, THREE.Group>;
      const geometryGroups = model.userData.v3PartGeometryGroups as Record<V3CharacterSlotId, THREE.Group>;
      const sample = sampleV3AuthoredClip(clipId, { normalizedTime });
      assert.equal(sample.motionSource, 'mesh2Motion', `${clipId} should use Mesh2Motion`);

      const applied = applyV3CleanRigPose(model, sample.pose);
      const rig = getV3Mesh2MotionDriverRig(model);
      assert.equal(applied.ready, true, `${clipId} apply warnings: ${applied.warnings.join(', ')}`);
      assert.equal(applied.mesh2MotionDriverBindingDiagnostics?.ready, true, `${clipId} binding diagnostics`);
      assert.equal(rig.bindingDiagnostics.ready, true, `${clipId} rig binding diagnostics`);

      for (const slot of V3_CHARACTER_SLOT_IDS) {
        const binding = rig.partBindings[slot];
        assert.ok(binding, `${clipId} missing ${slot} binding`);
        assert.equal(binding.sourceJointName, partGroups[slot].userData.v3Mesh2MotionSlotPlacement.sourceJointName, `${clipId} ${slot} source joint`);
        assert.equal(geometryGroups[slot].parent, partGroups[slot], `${clipId} ${slot} geometry should stay under slot pivot`);
        assertFiniteSlotTransform(slot, partGroups[slot]);
      }

      for (const [from, to] of seamPairs) {
        const distance = worldBoxCenter(partGroups[from]).distanceTo(worldBoxCenter(partGroups[to]));
        assert.ok(
          distance <= 1.25,
          `${clipId} ${from}/${to} seam distance ${distance.toFixed(4)} should stay connected`
        );
      }
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

  it('applies driver-joint position and rotation adjustments in joint-local space before binding descendants', () => {
    const baseline = createModel();
    const adjusted = createModel();
    const slash = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.75 });

    setV3Mesh2MotionCalibrationOverride(null);
    applyV3CleanRigPose(baseline, slash.pose);
    baseline.updateMatrixWorld(true);
    const baselineRig = getV3Mesh2MotionDriverRig(baseline);
    const baselineHand = baselineRig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());

    setV3Mesh2MotionCalibrationOverride({
      ...V3_MESH2MOTION_DEFAULT_CALIBRATION,
      driverJoints: {
        ...V3_MESH2MOTION_DEFAULT_CALIBRATION.driverJoints,
        upperarm_r: {
          position: [0.04, -0.02, 0.01],
          rotation: [0.1, -0.05, 0.35],
        },
      },
    });
    applyV3CleanRigPose(adjusted, slash.pose);
    adjusted.updateMatrixWorld(true);
    const adjustedRig = getV3Mesh2MotionDriverRig(adjusted);
    const adjustedHand = adjustedRig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());
    const report = adjusted.userData.v3Mesh2MotionDriverCalibrationReport as {
      driverJointAdjustmentCount?: number;
      calibratedJointOffsetCount?: number;
    } | undefined;

    assert.ok(adjustedHand.distanceTo(baselineHand) > 0.02);
    assert.equal(report?.driverJointAdjustmentCount, 2);
    assert.equal(report?.calibratedJointOffsetCount, report?.driverJointAdjustmentCount);
  });

  it('applies part-binding adjustment only to the selected visible V3 part', () => {
    const baseline = createModel();
    const adjusted = createModel();
    const slash = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.5 });

    setV3Mesh2MotionCalibrationOverride(null);
    applyV3CleanRigPose(baseline, slash.pose);
    baseline.updateMatrixWorld(true);
    const baselineGroups = baseline.userData.v3PartGroups as Record<string, THREE.Group>;
    const baselineRig = getV3Mesh2MotionDriverRig(baseline);
    const baselineHandPart = worldBoxCenter(baselineGroups.handRight);
    const baselineForearmPart = worldBoxCenter(baselineGroups.forearmRight);
    const baselineHandJoint = baselineRig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());

    setV3Mesh2MotionCalibrationOverride({
      ...V3_MESH2MOTION_DEFAULT_CALIBRATION,
      partBindings: {
        handRight: {
          position: [0.18, 0.02, -0.01],
          rotation: [0.15, 0.05, -0.1],
        },
      },
    });
    applyV3CleanRigPose(adjusted, slash.pose);
    adjusted.updateMatrixWorld(true);
    const adjustedGroups = adjusted.userData.v3PartGroups as Record<string, THREE.Group>;
    const adjustedRig = getV3Mesh2MotionDriverRig(adjusted);
    const adjustedHandPart = worldBoxCenter(adjustedGroups.handRight);
    const adjustedForearmPart = worldBoxCenter(adjustedGroups.forearmRight);
    const adjustedHandJoint = adjustedRig.joints.hand_r.object.getWorldPosition(new THREE.Vector3());
    const report = adjusted.userData.v3Mesh2MotionDriverCalibrationReport as {
      partBindingAdjustmentCount?: number;
      postBindPartAdjustments?: number;
    } | undefined;

    assert.ok(adjustedHandPart.distanceTo(baselineHandPart) > 0.05);
    assert.ok(adjustedForearmPart.distanceTo(baselineForearmPart) < 0.000001);
    assert.ok(adjustedHandJoint.distanceTo(baselineHandJoint) < 0.000001);
    assert.equal(report?.partBindingAdjustmentCount, 1);
    assert.equal(report?.postBindPartAdjustments, 1);
  });

  it('applies part-binding scale calibration only to the selected visible V3 part', () => {
    const baseline = createModel();
    const adjusted = createModel();
    const slash = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.5 });

    setV3Mesh2MotionCalibrationOverride(null);
    applyV3CleanRigPose(baseline, slash.pose);
    baseline.updateMatrixWorld(true);
    const baselineGroups = baseline.userData.v3PartGroups as Record<string, THREE.Group>;
    const baselineHandSize = new THREE.Box3().setFromObject(baselineGroups.handRight).getSize(new THREE.Vector3());
    const baselineForearmSize = new THREE.Box3().setFromObject(baselineGroups.forearmRight).getSize(new THREE.Vector3());

    setV3Mesh2MotionCalibrationOverride(normalizeV3Mesh2MotionCalibration({
      ...V3_MESH2MOTION_DEFAULT_CALIBRATION,
      partBindings: {
        handRight: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1.4, 0.75, 1.2],
        },
      },
    }));
    applyV3CleanRigPose(adjusted, slash.pose);
    adjusted.updateMatrixWorld(true);
    const adjustedGroups = adjusted.userData.v3PartGroups as Record<string, THREE.Group>;
    const adjustedHandSize = new THREE.Box3().setFromObject(adjustedGroups.handRight).getSize(new THREE.Vector3());
    const adjustedForearmSize = new THREE.Box3().setFromObject(adjustedGroups.forearmRight).getSize(new THREE.Vector3());

    assert.ok(adjustedHandSize.distanceTo(baselineHandSize) > 0.02);
    assert.ok(adjustedForearmSize.distanceTo(baselineForearmSize) < 0.000001);
  });

  it('applies right and left weapon socket adjustments under their source hand joints', () => {
    const baseline = createModel();
    const adjusted = createModel();
    const carry = sampleV3AuthoredClip('clean_sword_carry', { normalizedTime: 0.25 });

    setV3Mesh2MotionCalibrationOverride(null);
    applyV3CleanRigPose(baseline, carry.pose);
    baseline.updateMatrixWorld(true);
    const baselineRight = getV3Mesh2MotionDriverWeaponSocketWorldTransform(baseline, 'rightHandGrip');
    const baselineLeft = getV3Mesh2MotionDriverWeaponSocketWorldTransform(baseline, 'leftHandGrip');

    setV3Mesh2MotionCalibrationOverride(normalizeV3Mesh2MotionCalibration({
      ...V3_MESH2MOTION_DEFAULT_CALIBRATION,
      weaponSockets: {
        rightHandGrip: {
          position: [0.08, -0.01, 0.02],
          rotation: [0.2, 0.1, -0.05],
        },
        leftHandGrip: {
          position: [-0.03, 0.06, 0.01],
          rotation: [-0.1, 0.15, 0.2],
        },
      },
    }));
    applyV3CleanRigPose(adjusted, carry.pose);
    adjusted.updateMatrixWorld(true);
    const adjustedRight = getV3Mesh2MotionDriverWeaponSocketWorldTransform(adjusted, 'rightHandGrip');
    const adjustedLeft = getV3Mesh2MotionDriverWeaponSocketWorldTransform(adjusted, 'leftHandGrip');

    assert.ok(baselineRight && adjustedRight);
    assert.ok(baselineLeft && adjustedLeft);
    assert.ok(adjustedRight.position.distanceTo(baselineRight.position) > 0.03);
    assert.ok(adjustedLeft.position.distanceTo(baselineLeft.position) > 0.03);
    assert.ok(Math.abs(adjustedRight.quaternion.dot(baselineRight.quaternion)) < 0.999);
    assert.ok(Math.abs(adjustedLeft.quaternion.dot(baselineLeft.quaternion)) < 0.999);
  });
});
