import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  V3_AUTHORED_ANIMATION_CLIP_IDS,
  exportV3AuthoredClipToJson,
  mapV3AtlasCaseToAuthoredClip,
  parseV3AuthoredClipJson,
  sampleV3AuthoredClip,
} from './v3AuthoredAnimationClips';
import { sampleV3RetargetedClip } from './v3RetargetedAnimationClips';
import { sampleV3RetargetedUpperBodyPose } from './v3MixamoRetarget';

const assertQuat = (value: readonly number[], label: string) => {
  assert.equal(value.length, 4, `${label} should be a quaternion tuple`);
  assert.equal(value.every(Number.isFinite), true, `${label} must be finite`);
  const length = Math.hypot(value[0], value[1], value[2], value[3]);
  assert.ok(Math.abs(length - 1) < 0.001, `${label} should be normalized, got ${length}`);
};

const quatFromEuler = (rotation: readonly [number, number, number]) => {
  const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2], 'XYZ')).normalize();
  return [quaternion.x, quaternion.y, quaternion.z, quaternion.w] as const;
};

const assertQuatClose = (
  actual: readonly number[] | undefined,
  expected: readonly number[],
  label: string
) => {
  assert.ok(actual, `${label} should exist`);
  const actualQuaternion = new THREE.Quaternion(actual[0], actual[1], actual[2], actual[3]).normalize();
  const expectedQuaternion = new THREE.Quaternion(expected[0], expected[1], expected[2], expected[3]).normalize();
  assert.ok(
    actualQuaternion.angleTo(expectedQuaternion) < 0.0005,
    `${label} should match Mixamo source; angle=${actualQuaternion.angleTo(expectedQuaternion)}`
  );
};

describe('v3AuthoredAnimationClips', () => {
  it('samples all authored clean clips deterministically with finite normalized quaternions', () => {
    for (const clipId of V3_AUTHORED_ANIMATION_CLIP_IDS) {
      const first = sampleV3AuthoredClip(clipId, { normalizedTime: 0.42 });
      const second = sampleV3AuthoredClip(clipId, { normalizedTime: 0.42 });

      assert.deepEqual(first, second, `${clipId} should sample deterministically`);
      assert.equal(first.pose.clipId, clipId);
      assert.equal(first.pose.animationAuthority, 'cleanRig');
      for (const [jointName, quaternion] of Object.entries(first.pose.jointQuaternions)) {
        assertQuat(quaternion, `${clipId}:${jointName}`);
      }
      if (first.weaponPose) {
        assert.equal(first.weaponPose.position.every(Number.isFinite), true, `${clipId} weapon position must be finite`);
        assert.equal(first.weaponPose.rotation.every(Number.isFinite), true, `${clipId} weapon rotation must be finite`);
      }
    }
  });

  it('maps atlas cases to clean authored clips and preserves sanitized export/import state', () => {
    assert.equal(mapV3AtlasCaseToAuthoredClip('idle'), 'clean_idle');
    assert.equal(mapV3AtlasCaseToAuthoredClip('walk', 'hammer'), 'clean_hammer_carry');
    assert.equal(mapV3AtlasCaseToAuthoredClip('hammerStrike'), 'clean_hammer_strike');
    assert.equal(mapV3AtlasCaseToAuthoredClip('swordSlash'), 'clean_sword_slash');

    const exported = exportV3AuthoredClipToJson('clean_hammer_strike');
    assert.equal(exported.version, ATLAS_EDITOR_EXPORT_VERSION);
    assert.equal(JSON.stringify(exported).includes('reference/mixamo-v3'), false);
    assert.equal(JSON.stringify(exported).includes('.fbx'), false);

    const parsed = parseV3AuthoredClipJson(JSON.stringify(exported));
    assert.equal(parsed.id, 'clean_hammer_strike');
    assert.deepEqual(parsed.keyframes, exported.keyframes);
  });

  it('samples clean locomotion clips from generated Mixamo retargeted full-body motion', () => {
    const sample = sampleV3AuthoredClip('clean_walk', { normalizedTime: 0.25 });
    const mixamo = sampleV3RetargetedClip('walk', { normalizedTime: 0.25 });
    const thigh = mixamo.joints.thighLeft?.rotation;
    const calf = mixamo.joints.calfLeft?.rotation;
    assert.ok(thigh);
    assert.ok(calf);

    assert.equal(sample.motionSource, 'retargetedMixamo');
    assert.equal(sample.mixamoClipId, 'walk');
    assertQuatClose(sample.pose.jointQuaternions.thighLeft, quatFromEuler(thigh), 'clean walk left thigh');
    assertQuatClose(sample.pose.jointQuaternions.calfLeft, quatFromEuler(calf), 'clean walk left calf');
  });

  it('uses generated Mesh2Motion clips for the first-pass replacement set', () => {
    const sprint = sampleV3AuthoredClip('clean_sprint', { normalizedTime: 0.25 });
    assert.equal(sprint.motionSource, 'mesh2Motion');
    assert.equal(sprint.mixamoClipId, 'Sprint_Loop');
    assert.equal(sprint.pose.mesh2MotionDriverPose?.sourceClipName, 'Sprint_Loop');
    assert.equal(sprint.pose.mesh2MotionDriverPose?.cleanup?.trackId, 'clean_sprint:Sprint_Loop');
    assert.equal(sprint.pose.mesh2MotionDriverPose?.cleanup?.driverJointAdjustmentCount, 0);
    assert.ok(sprint.pose.mesh2MotionDriverPose?.joints.pelvis);
    assert.ok(sprint.pose.mesh2MotionDriverPose?.joints.hand_r);
    assert.ok(sprint.pose.jointQuaternions.thighLeft);
    assert.ok(sprint.pose.jointQuaternions.calfRight);
    assert.ok(sprint.pose.jointOffsets?.upperArmRight);
    assert.equal(sprint.pose.jointOffsets.upperArmRight.every(Number.isFinite), true);
    assert.equal(Math.max(...sprint.pose.jointOffsets.upperArmRight.map(Math.abs)) < 1, true);
    assert.equal(sprint.pose.rootOffset?.[0] ?? 0, 0);
    assert.equal(sprint.pose.rootOffset?.[2] ?? 0, 0);

    const slide = sampleV3AuthoredClip('clean_slide', { normalizedTime: 0.5 });
    assert.equal(slide.motionSource, 'mesh2Motion');
    assert.equal(slide.mixamoClipId, 'Slide_Loop');
    assert.equal(slide.pose.mesh2MotionDriverPose?.cleanup?.trackId, 'clean_slide:Slide_Loop');
    assert.ok(slide.pose.jointQuaternions.pelvis);
    assert.ok(slide.pose.jointOffsets?.spine3);
    assert.ok((slide.pose.rootOffset?.[1] ?? 0) < 0);

    const carry = sampleV3AuthoredClip('clean_sword_carry', { normalizedTime: 0.25 });
    assert.equal(carry.motionSource, 'mesh2Motion');
    assert.equal(carry.mixamoClipId, 'Sword_Idle');
    assert.equal(carry.pose.mesh2MotionDriverPose?.cleanup?.trackId, 'clean_sword_carry:Sword_Idle');
    assert.equal(carry.weaponPose?.source, 'mixamoReferenceClip');

    const lunge = sampleV3AuthoredClip('clean_sword_lunge', { normalizedTime: 0.5 });
    assert.equal(lunge.motionSource, 'mesh2Motion');
    assert.equal(lunge.mixamoClipId, 'Sword_Dash_RM');
    assert.ok(lunge.pose.jointQuaternions.upperArmRight);
    assert.ok(lunge.pose.jointOffsets?.handRight);

    const slash = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.5 });
    assert.equal(slash.motionSource, 'mesh2Motion');
    assert.equal(slash.mixamoClipId, 'Sword_Regular_B');
    assert.ok(slash.pose.jointQuaternions.handRight);
  });

  it('samples hammer weapon clips from generated Mixamo references and keeps sword weapon poses on Mesh2Motion body clips', () => {
    const hammer = sampleV3AuthoredClip('clean_hammer_strike', { normalizedTime: 0.5 });
    const hammerReference = sampleV3RetargetedUpperBodyPose('hammer_heavy_swing', 0.375);

    assert.equal(hammer.motionSource, 'mixamoWeaponReference');
    assert.equal(hammer.mixamoClipId, 'hammer_heavy_swing');
    assert.equal(hammer.sourceNormalizedTime, 0.375);
    assert.equal(hammer.weaponPose?.source, 'mixamoReferenceClip');
    assertQuatClose(
      hammer.pose.jointQuaternions.upperArmRight,
      hammerReference.detailBoneQuaternions.upperArmRight ?? [0, 0, 0, 1],
      'clean hammer strike right upper arm'
    );

    const sword = sampleV3AuthoredClip('clean_sword_slash', { normalizedTime: 0.5 });
    assert.equal(sword.motionSource, 'mesh2Motion');
    assert.equal(sword.mixamoClipId, 'Sword_Regular_B');
    assert.equal(sword.weaponPose?.source, 'mixamoReferenceClip');
    assert.ok(sword.pose.jointQuaternions.upperArmRight);
  });
});
