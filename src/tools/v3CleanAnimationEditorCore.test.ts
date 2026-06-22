import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  exportV3AuthoredClipToJson,
  sampleV3AuthoredClipData,
  type V3AuthoredClipExport,
} from '../components/grifball/v3AuthoredAnimationClips';
import {
  createV3CleanEditorDocument,
  deleteV3CleanEditorKeyframe,
  mirrorV3CleanRigPoseFrame,
  normalizeV3AuthoredClipExport,
  resetV3CleanEditorFrame,
  resetV3CleanEditorJoint,
  setV3CleanEditorJointEuler,
} from './v3CleanAnimationEditorCore';

const quatFromEuler = (x: number, y: number, z: number) => {
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ')).normalize();
  return [quat.x, quat.y, quat.z, quat.w] as [number, number, number, number];
};

const lengthOfQuat = (value: readonly number[]) => Math.hypot(value[0], value[1], value[2], value[3]);

const assertQuatClose = (actual: readonly number[] | undefined, expected: readonly number[]) => {
  assert.ok(actual);
  const actualQuat = new THREE.Quaternion(actual[0], actual[1], actual[2], actual[3]).normalize();
  const expectedQuat = new THREE.Quaternion(expected[0], expected[1], expected[2], expected[3]).normalize();
  assert.ok(actualQuat.angleTo(expectedQuat) < 0.000001);
};

const manualClip = (): V3AuthoredClipExport => ({
  version: ATLAS_EDITOR_EXPORT_VERSION,
  id: 'clean_hammer_strike',
  label: 'Manual Hammer Strike',
  durationFrames: 12,
  fps: 60,
  loop: false,
  animationAuthority: 'cleanRig',
  keyframes: [
    {
      frame: 0,
      jointQuaternions: {
        upperArmRight: quatFromEuler(0.25, 0.1, -0.2),
      },
      weaponPose: {
        weapon: 'hammer',
        position: [1, 2, 3],
        rotation: [0.1, 0.2, 0.3],
        source: 'authoredCleanClip',
      },
    },
    {
      frame: 12,
      jointQuaternions: {
        upperArmRight: quatFromEuler(0.75, 0.1, -0.2),
      },
      weaponPose: {
        weapon: 'hammer',
        position: [3, 2, 1],
        rotation: [0.3, 0.2, 0.1],
        source: 'authoredCleanClip',
      },
    },
  ],
  metadata: {
    authoringSurface: 'v3AnimationAtlasCleanRigEditor',
    sanitized: true,
    mixamoRuntimeAuthority: false,
  },
});

describe('v3CleanAnimationEditorCore', () => {
  it('normalizes editor clip JSON and samples it without Mixamo override', () => {
    const normalized = normalizeV3AuthoredClipExport({
      ...manualClip(),
      keyframes: [
        manualClip().keyframes[1],
        {
          ...manualClip().keyframes[0],
          jointQuaternions: {
            upperArmRight: [0, 0, 0, 10],
          },
        },
      ],
    });

    assert.deepEqual(normalized.keyframes.map((keyframe) => keyframe.frame), [0, 12]);
    assert.ok(Math.abs(lengthOfQuat(normalized.keyframes[0].jointQuaternions.upperArmRight!) - 1) < 0.0001);

    const manualSample = sampleV3AuthoredClipData(normalized, { normalizedTime: 0.5 });
    const runtimeSample = sampleV3AuthoredClipData(exportV3AuthoredClipToJson('clean_hammer_strike'), {
      normalizedTime: 0.5,
      useMixamoFallback: true,
    });

    assert.equal(manualSample.motionSource, 'atlasAuthored');
    assert.equal(manualSample.mixamoClipId, undefined);
    assert.equal(runtimeSample.motionSource, 'mixamoWeaponReference');
    assert.equal(manualSample.weaponPose?.position[0], 2);
  });

  it('creates editor documents and edits selected joint keyframes deterministically', () => {
    const document = createV3CleanEditorDocument('clean_idle');
    const edited = setV3CleanEditorJointEuler(document.clip, {
      frame: 8,
      joint: 'upperArmRight',
      euler: [0.2, 0.3, -0.4],
    });

    const keyframe = edited.keyframes.find((candidate) => candidate.frame === 8);
    assert.ok(keyframe);
    assert.ok(keyframe.jointQuaternions.upperArmRight);
    assert.ok(Math.abs(lengthOfQuat(keyframe.jointQuaternions.upperArmRight) - 1) < 0.0001);

    const resetJoint = resetV3CleanEditorJoint(edited, { frame: 8, joint: 'upperArmRight' });
    assert.equal(resetJoint.keyframes.find((candidate) => candidate.frame === 8)?.jointQuaternions.upperArmRight, undefined);

    const deleted = deleteV3CleanEditorKeyframe(edited, 8);
    assert.equal(deleted.keyframes.some((candidate) => candidate.frame === 8), false);

    const resetFrame = resetV3CleanEditorFrame(edited, 8);
    assert.deepEqual(resetFrame.keyframes.find((candidate) => candidate.frame === 8)?.jointQuaternions, {});
  });

  it('mirrors left and right joints while preserving center joints', () => {
    const mirrored = mirrorV3CleanRigPoseFrame({
      frame: 6,
      jointQuaternions: {
        chest: quatFromEuler(0.1, 0.2, 0.3),
        upperArmLeft: quatFromEuler(0.4, 0.2, 0.1),
        handRight: quatFromEuler(-0.2, -0.1, 0.3),
      },
    });

    assertQuatClose(mirrored.jointQuaternions.chest, quatFromEuler(0.1, -0.2, -0.3));
    assertQuatClose(mirrored.jointQuaternions.upperArmRight, quatFromEuler(0.4, -0.2, -0.1));
    assertQuatClose(mirrored.jointQuaternions.handLeft, quatFromEuler(-0.2, 0.1, -0.3));
  });

  it('rejects invalid imported editor JSON with readable errors', () => {
    assert.throws(
      () => normalizeV3AuthoredClipExport({
        ...manualClip(),
        keyframes: [{ frame: 0, jointQuaternions: { nope: [0, 0, 0, 1] } }],
      }),
      /Unknown V3 clean rig joint/
    );
  });

});
