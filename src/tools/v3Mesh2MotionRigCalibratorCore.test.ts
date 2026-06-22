import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { animateV3CombatantModel, animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DRIVER_JOINT_NAMES,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  buildV3Mesh2MotionCalibrationDiagnostics,
  computeDriverJointAdjustmentFromWorldTransform,
  computePartBindingAdjustmentFromWorldTransform,
  computeV3Mesh2MotionSocketCalibrationFromWorldTransform,
  computeWeaponSocketAdjustmentFromWorldTransform,
  listV3Mesh2MotionCalibrationTargets,
  normalizeV3Mesh2MotionCalibration,
  parseV3Mesh2MotionCalibrationJson,
  serializeV3Mesh2MotionCalibration,
} from './v3Mesh2MotionRigCalibratorCore';
import { V3_CHARACTER_SLOT_IDS } from '../components/v3/v3ModelTypes';

describe('v3Mesh2MotionRigCalibratorCore', () => {
  it('normalizes v2 calibration values and round-trips editor JSON', () => {
    const normalized = normalizeV3Mesh2MotionCalibration({
      version: 'v3-mesh2motion-calibration/v2',
      armSpread: { left: 0.18, right: 0.16 },
      driverJoints: {
        upperarm_l: {
          position: [0.02, 0.01, -0.01],
          rotation: [0.2, -0.1, 0.05],
        },
        hand_r: {
          position: [-0.03, 0.02, 0.01],
          rotation: [0.1, 0.2, -0.1],
        },
      },
      partBindings: {
        handRight: {
          position: [0.01, -0.02, 0.03],
          rotation: [0.15, 0.25, -0.05],
        },
      },
      weaponSockets: {
        rightHandGrip: {
          position: [0.04, 0.01, -0.03],
          rotation: [0.2, -0.1, 0.3],
        },
        leftHandGrip: {
          position: [-0.02, 0.03, 0.01],
          rotation: [-0.1, 0.2, -0.3],
        },
      },
    });

    assert.equal(normalized.version, 'v3-mesh2motion-calibration/v2');
    assert.equal(normalized.armSpread.left, 0.18);
    assert.equal(normalized.armSpread.right, 0.16);
    assert.deepEqual(normalized.driverJoints.upperarm_l?.position, [0.02, 0.01, -0.01]);
    assert.deepEqual(normalized.driverJoints.upperarm_l?.rotation, [0.2, -0.1, 0.05]);
    assert.deepEqual(normalized.partBindings.handRight?.position, [0.01, -0.02, 0.03]);
    assert.deepEqual(normalized.weaponSockets.rightHandGrip.position, [0.04, 0.01, -0.03]);
    assert.deepEqual(normalized.weaponSockets.leftHandGrip.rotation, [-0.1, 0.2, -0.3]);

    const parsed = parseV3Mesh2MotionCalibrationJson(serializeV3Mesh2MotionCalibration(normalized));

    assert.deepEqual(parsed, normalized);
  });

  it('imports v1 joint offsets and right-hand weapon socket values into v2 calibration', () => {
    const normalized = normalizeV3Mesh2MotionCalibration({
      version: 'v3-mesh2motion-calibration/v1',
      armSpread: { left: 0.18, right: 0.16 },
      jointOffsets: {
        hand_r: [-0.03, 0.02, 0.01],
        unknown_joint: [0.2, 0.2, 0.2],
      },
      weaponSockets: {
        rightHandGrip: {
          position: [0.04, 0.01, -0.03],
          rotation: [0.2, -0.1, 0.3],
        },
      },
    });

    assert.equal(normalized.version, 'v3-mesh2motion-calibration/v2');
    assert.deepEqual(normalized.driverJoints.hand_r, {
      position: [-0.03, 0.02, 0.01],
      rotation: [0, 0, 0],
    });
    assert.equal('unknown_joint' in normalized.driverJoints, false);
    assert.deepEqual(normalized.weaponSockets.rightHandGrip.position, [0.04, 0.01, -0.03]);
    assert.deepEqual(normalized.weaponSockets.leftHandGrip, V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.leftHandGrip);
  });

  it('clamps extreme values and falls back for non-finite editor input', () => {
    const normalized = normalizeV3Mesh2MotionCalibration({
      armSpread: { left: Number.NaN, right: 999 },
      driverJoints: {
        lowerarm_l: {
          position: [Number.POSITIVE_INFINITY, 999, -999],
          rotation: [Number.NaN, 999, -999],
        },
        unknown_joint: {
          position: [0.1, 0.1, 0.1],
          rotation: [0.1, 0.1, 0.1],
        },
      },
      partBindings: {
        handRight: {
          position: [Number.NaN, 999, -999],
          rotation: [Number.NaN, 999, -999],
        },
      },
      weaponSockets: {
        rightHandGrip: {
          position: [Number.NaN, 999, -999],
          rotation: [Number.NaN, 999, -999],
        },
      },
    });

    assert.equal(normalized.armSpread.left, V3_MESH2MOTION_DEFAULT_CALIBRATION.armSpread.left);
    assert.equal(normalized.armSpread.right, V3_MESH2MOTION_CALIBRATION_LIMITS.maxArmSpread);
    assert.equal('unknown_joint' in normalized.driverJoints, false);
    assert.deepEqual(normalized.driverJoints.lowerarm_l?.position, [
      0,
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxDriverJointPosition,
      -V3_MESH2MOTION_CALIBRATION_LIMITS.maxDriverJointPosition,
    ]);
    assert.deepEqual(normalized.driverJoints.lowerarm_l?.rotation, [
      0,
      Math.PI,
      -Math.PI,
    ]);
    assert.deepEqual(normalized.partBindings.handRight?.position, [
      0,
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxPartBindingPosition,
      -V3_MESH2MOTION_CALIBRATION_LIMITS.maxPartBindingPosition,
    ]);
    assert.deepEqual(normalized.weaponSockets.rightHandGrip.position, [
      V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.rightHandGrip.position[0],
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketPosition,
      -V3_MESH2MOTION_CALIBRATION_LIMITS.maxSocketPosition,
    ]);
    assert.deepEqual(normalized.weaponSockets.rightHandGrip.rotation, [
      V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets.rightHandGrip.rotation[0],
      Math.PI,
      -Math.PI,
    ]);
  });

  it('lists all driver bones, V3 part bindings, and weapon sockets as selectable targets', () => {
    const targets = listV3Mesh2MotionCalibrationTargets();
    const driverTargets = targets.filter((target) => target.kind === 'driverJoint');
    const partTargets = targets.filter((target) => target.kind === 'partBinding');
    const socketTargets = targets.filter((target) => target.kind === 'weaponSocket');

    assert.equal(driverTargets.length, 56);
    assert.equal(driverTargets.length, V3_MESH2MOTION_DRIVER_JOINT_NAMES.length);
    assert.equal(partTargets.length, V3_CHARACTER_SLOT_IDS.length);
    assert.equal(socketTargets.length, 2);
    assert.ok(driverTargets.some((target) => target.id === 'index_03_l' && target.hasVisibleBinding === false));
    assert.ok(partTargets.some((target) => target.id === 'handRight' && target.sourceJointName === 'hand_r'));
    assert.deepEqual(socketTargets.map((target) => target.id).sort(), ['leftHandGrip', 'rightHandGrip']);
  });

  it('converts dragged world transforms into driver, part-binding, and weapon-socket adjustments', () => {
    const parent = new THREE.Group();
    parent.position.set(1.2, 0.4, -0.7);
    parent.quaternion.setFromEuler(new THREE.Euler(0.15, -0.55, 0.35));
    parent.updateWorldMatrix(true, false);

    const baseLocalPosition = new THREE.Vector3(0.08, 0.02, -0.04);
    const baseLocalQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0.15)).normalize();
    const desiredLocalOffset = new THREE.Vector3(0.03, -0.015, 0.07);
    const desiredLocalRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, -0.1, 0.4)).normalize();

    const driverHandle = new THREE.Group();
    driverHandle.position.copy(baseLocalPosition).add(desiredLocalOffset);
    driverHandle.quaternion.copy(baseLocalQuaternion).multiply(desiredLocalRotation).normalize();
    parent.add(driverHandle);
    driverHandle.updateWorldMatrix(true, false);

    const driver = computeDriverJointAdjustmentFromWorldTransform({
      parentWorldMatrix: parent.matrixWorld,
      handleWorldMatrix: driverHandle.matrixWorld,
      baseLocalPosition,
      baseLocalQuaternion,
    });

    assert.ok(driver.position.distanceTo(desiredLocalOffset) < 0.000001);
    assert.ok(Math.abs(driver.quaternion.dot(desiredLocalRotation)) > 0.999999);

    const baseBindingWorldMatrix = parent.matrixWorld.clone().multiply(
      new THREE.Matrix4().compose(
        new THREE.Vector3(0.2, 0.1, -0.05),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.2, 0.1)).normalize(),
        new THREE.Vector3(1, 1, 1)
      )
    );
    const partAdjustmentMatrix = new THREE.Matrix4().compose(
      desiredLocalOffset,
      desiredLocalRotation,
      new THREE.Vector3(1, 1, 1)
    );
    const part = computePartBindingAdjustmentFromWorldTransform({
      baseWorldMatrix: baseBindingWorldMatrix,
      handleWorldMatrix: baseBindingWorldMatrix.clone().multiply(partAdjustmentMatrix),
    });

    assert.ok(part.position.distanceTo(desiredLocalOffset) < 0.000001);
    assert.ok(Math.abs(part.quaternion.dot(desiredLocalRotation)) > 0.999999);

    const weapon = computeWeaponSocketAdjustmentFromWorldTransform({
      parentWorldMatrix: parent.matrixWorld,
      handleWorldMatrix: driverHandle.matrixWorld,
      restLocalPosition: baseLocalPosition,
    });

    assert.ok(weapon.position.distanceTo(desiredLocalOffset) < 0.000001);
    assert.ok(weapon.rotation.every(Number.isFinite));
  });

  it('reports live arm and sword socket diagnostics for Mesh2Motion preview rigs', () => {
    const scene = new THREE.Scene();
    const meshRig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });
    const refs = createInitialGrifballThreeRefs();
    refs.scene = scene;

    animateV3CombatantModel({
      refs,
      mesh: meshRig.group,
      vel: new THREE.Vector3(4, 0, 0),
      yaw: 0,
      hp: 100,
      activeWeapon: 'sword',
      weaponState: 'slashing',
      weaponTimer: 0.5,
      dt: 1,
      settings: {},
      animationClockMs: 500,
      isLocalV3Animation: true,
      v3PoseAlphaOverride: 1,
      v3AnimationAuthority: 'cleanRig',
      v3AuthoredClipId: 'clean_sword_slash',
      v3AuthoredNormalizedTime: 0.5,
    });
    animateV3WeaponMeshes({
      hammerModel: meshRig.hammer,
      swordModel: meshRig.sword,
      pistolModel: meshRig.pistol,
      activeWeapon: 'sword',
      weaponState: 'slashing',
      weaponTimer: 0.5,
      isLunging: false,
      dt: 1,
      settings: {},
      combatantModel: meshRig.group,
      v3AnimationAuthority: 'cleanRig',
      v3AuthoredClipId: 'clean_sword_slash',
      v3AuthoredNormalizedTime: 0.5,
    });

    const report = buildV3Mesh2MotionCalibrationDiagnostics(meshRig.group, meshRig.sword);

    assert.equal(report.kind, 'v3-mesh2motion-calibration-diagnostics');
    assert.ok(report.arms.left.chainLinks.length >= 3);
    assert.ok(report.arms.right.chainLinks.length >= 3);
    assert.equal(Number.isFinite(report.weapon?.primaryGripDrift), true);
    assert.equal(Number.isFinite(report.weapon?.forwardAxis.x), true);
  });

  it('converts a dragged world socket handle into hand-local calibration values', () => {
    const handParent = new THREE.Group();
    handParent.position.set(1.2, 0.4, -0.7);
    handParent.quaternion.setFromEuler(new THREE.Euler(0.15, -0.55, 0.35));
    handParent.updateWorldMatrix(true, false);

    const restLocalPosition = new THREE.Vector3(0.08, 0.02, -0.04);
    const desiredLocalOffset = new THREE.Vector3(0.03, -0.015, 0.07);
    const desiredLocalRotation = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(0.25, -0.1, 0.4))
      .normalize();

    const handle = new THREE.Group();
    handle.position.copy(restLocalPosition).add(desiredLocalOffset);
    handle.quaternion.copy(desiredLocalRotation);
    handParent.add(handle);
    handle.updateWorldMatrix(true, false);

    const result = computeV3Mesh2MotionSocketCalibrationFromWorldTransform({
      parentWorldMatrix: handParent.matrixWorld,
      handleWorldMatrix: handle.matrixWorld,
      restLocalPosition,
    });

    assert.ok(result.position.distanceTo(desiredLocalOffset) < 0.000001);
    assert.ok(Math.abs(result.quaternion.dot(desiredLocalRotation)) > 0.999999);
    assert.ok(result.rotation.every(Number.isFinite));
  });

  it('wires the standalone calibrator HTML into the browser build inputs', () => {
    const html = readFileSync('v3-mesh2motion-rig-calibrator.html', 'utf8');
    const viteConfig = readFileSync('vite.config.ts', 'utf8');

    assert.equal(html.includes('/src/tools/v3Mesh2MotionRigCalibrator.ts'), true);
    assert.equal(html.includes('Preview Animation'), true);
    assert.equal(html.includes('Edit Mode'), true);
    assert.equal(html.includes('Target'), true);
    assert.equal(html.includes('right-hand socket only'), false);
    assert.equal(viteConfig.includes('v3Mesh2MotionRigCalibrator'), true);
  });
});
