import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { animateV3CombatantModel, animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import {
  V3_MESH2MOTION_CALIBRATION_LIMITS,
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  buildV3Mesh2MotionCalibrationDiagnostics,
  computeV3Mesh2MotionSocketCalibrationFromWorldTransform,
  normalizeV3Mesh2MotionCalibration,
  parseV3Mesh2MotionCalibrationJson,
  serializeV3Mesh2MotionCalibration,
} from './v3Mesh2MotionRigCalibratorCore';

describe('v3Mesh2MotionRigCalibratorCore', () => {
  it('normalizes finite calibration values and round-trips editor JSON', () => {
    const normalized = normalizeV3Mesh2MotionCalibration({
      version: 'v3-mesh2motion-calibration/v1',
      armSpread: { left: 0.18, right: 0.16 },
      jointOffsets: {
        upperarm_l: [0.02, 0.01, -0.01],
        hand_r: [-0.03, 0.02, 0.01],
      },
      weaponSockets: {
        rightHandGrip: {
          position: [0.04, 0.01, -0.03],
          rotation: [0.2, -0.1, 0.3],
        },
      },
    });

    assert.equal(normalized.armSpread.left, 0.18);
    assert.equal(normalized.armSpread.right, 0.16);
    assert.deepEqual(normalized.jointOffsets.upperarm_l, [0.02, 0.01, -0.01]);
    assert.deepEqual(normalized.weaponSockets.rightHandGrip.position, [0.04, 0.01, -0.03]);

    const parsed = parseV3Mesh2MotionCalibrationJson(serializeV3Mesh2MotionCalibration(normalized));

    assert.deepEqual(parsed, normalized);
  });

  it('clamps extreme values and falls back for non-finite editor input', () => {
    const normalized = normalizeV3Mesh2MotionCalibration({
      armSpread: { left: Number.NaN, right: 999 },
      jointOffsets: {
        lowerarm_l: [Number.POSITIVE_INFINITY, 999, -999],
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
    assert.deepEqual(normalized.jointOffsets.lowerarm_l, [
      0,
      V3_MESH2MOTION_CALIBRATION_LIMITS.maxJointOffset,
      -V3_MESH2MOTION_CALIBRATION_LIMITS.maxJointOffset,
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
    assert.equal(viteConfig.includes('v3Mesh2MotionRigCalibrator'), true);
  });
});
