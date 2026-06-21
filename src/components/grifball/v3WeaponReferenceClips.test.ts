import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS,
  analyzeV3WeaponReferenceClip,
  fitV3WeaponPoseFromReferenceSample,
  getV3WeaponReferenceClip,
  sampleV3WeaponReferenceClip,
} from './v3WeaponReferenceClips';

const finiteTuple = (value: readonly number[]): boolean => value.every(Number.isFinite);

describe('v3WeaponReferenceClips', () => {
  it('exposes deterministic local-only Mixamo weapon reference clips', () => {
    assert.deepEqual(
      [...V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS],
      [
        'hammer_2hand_idle',
        'hammer_heavy_swing',
        'hammer_melee_advance',
        'sword_outward_slash',
        'hammer_smash_reference',
      ]
    );

    const first = getV3WeaponReferenceClip('hammer_2hand_idle');
    const second = getV3WeaponReferenceClip('hammer_2hand_idle');

    assert.deepEqual(second, first);
    assert.equal(first.source.fileName, 'hammer_2hand_idle.fbx');
    assert.match(first.source.sha256, /^[a-f0-9]{64}$/);
    assert.ok(first.frameCount > 1);
    assert.ok(first.duration > 0);
  });

  it('samples upper-body rotations and chest-space hand positions without non-finite transforms', () => {
    for (const clipId of V3_MIXAMO_WEAPON_REFERENCE_CLIP_IDS) {
      for (const normalizedTime of [0, 0.25, 0.5, 0.75, 1]) {
        const sample = sampleV3WeaponReferenceClip(clipId, { normalizedTime });

        assert.equal(sample.clipId, clipId);
        assert.equal(sample.ready, true);
        assert.equal(sample.joints.chest?.position.join(','), '0,0,0');
        assert.equal(finiteTuple(sample.joints.handRight?.position ?? []), true, `${clipId} right hand position`);
        assert.equal(finiteTuple(sample.joints.handLeft?.position ?? []), true, `${clipId} left hand position`);
        assert.equal(finiteTuple(sample.joints.handRight?.rotation ?? []), true, `${clipId} right hand rotation`);
        assert.equal(finiteTuple(sample.joints.handLeft?.rotation ?? []), true, `${clipId} left hand rotation`);
        assert.equal(finiteTuple(sample.joints.handRight?.quaternion ?? []), true, `${clipId} right hand quaternion`);
        assert.equal(sample.joints.handRight?.quaternion.length, 4, `${clipId} right hand quaternion length`);
      }
    }
  });

  it('exposes calibration metadata for Mixamo-to-V3 chest-space retargeting', () => {
    const clip = getV3WeaponReferenceClip('hammer_heavy_swing');

    assert.equal(clip.calibration?.sourceRestClip, 'T-Pose.fbx');
    assert.equal(clip.calibration?.space, 'v3Chest');
    assert.equal(finiteTuple(clip.calibration?.scale ?? []), true);
    assert.ok((clip.calibration?.shoulderSpan ?? 0) > 0.1);
    assert.ok((clip.calibration?.handSpan ?? 0) > 0.1);
    assert.equal(clip.restPose?.source.fileName, 'T-Pose.fbx');
    assert.equal(finiteTuple(clip.restPose?.joints.upperArmRight?.quaternion ?? []), true);
    assert.equal(finiteTuple(clip.restPose?.joints.handRight?.position ?? []), true);
  });

  it('reports useful reference motion metrics for hammer and sword clips', () => {
    const hammerIdle = analyzeV3WeaponReferenceClip('hammer_2hand_idle');
    const hammerSwing = analyzeV3WeaponReferenceClip('hammer_heavy_swing');
    const hammerMelee = analyzeV3WeaponReferenceClip('hammer_melee_advance');
    const swordSlash = analyzeV3WeaponReferenceClip('sword_outward_slash');
    const smash = analyzeV3WeaponReferenceClip('hammer_smash_reference');

    assert.equal(hammerIdle.ready, true);
    assert.equal(hammerSwing.ready, true);
    assert.equal(hammerMelee.ready, true);
    assert.equal(swordSlash.ready, true);
    assert.equal(smash.ready, true);
    assert.equal(smash.runtimeRole, 'analysisOnly');

    assert.ok(hammerIdle.metrics.handSeparation.mean > 0.14, 'hammer idle should have readable two-hand spacing');
    assert.ok(hammerSwing.metrics.handPathDistance.right > hammerIdle.metrics.handPathDistance.right);
    assert.ok(hammerMelee.metrics.handPathDistance.right > hammerIdle.metrics.handPathDistance.right);
    assert.ok(swordSlash.metrics.handPathDistance.right > 0.05);
    assert.equal(hammerSwing.issues, undefined);
  });

  it('fits Mixamo right-hand samples into V3 chest space without mirroring the weapon hand', () => {
    const hammerCarry = fitV3WeaponPoseFromReferenceSample('hammer_2hand_idle', {
      normalizedTime: 0,
      weapon: 'hammer',
      scale: 1,
    });
    const swordCarry = fitV3WeaponPoseFromReferenceSample('sword_outward_slash', {
      normalizedTime: 0,
      weapon: 'sword',
      scale: 1,
    });

    assert.ok(hammerCarry.weaponPose.position[0] < 0, `hammer right hand should stay on V3 right side: ${hammerCarry.weaponPose.position}`);
    assert.ok(swordCarry.weaponPose.position[0] < 0, `sword right hand should stay on V3 right side: ${swordCarry.weaponPose.position}`);
  });

  it('fits weapon orientation from reference hand motion instead of fixed authored rotations', () => {
    const hammerCarry = fitV3WeaponPoseFromReferenceSample('hammer_2hand_idle', {
      normalizedTime: 0,
      weapon: 'hammer',
      scale: 1,
    });
    const hammerSwing = fitV3WeaponPoseFromReferenceSample('hammer_heavy_swing', {
      normalizedTime: 0.55,
      weapon: 'hammer',
      scale: 1,
    });
    const swordStart = fitV3WeaponPoseFromReferenceSample('sword_outward_slash', {
      normalizedTime: 0.05,
      weapon: 'sword',
      scale: 1,
    });
    const swordSlash = fitV3WeaponPoseFromReferenceSample('sword_outward_slash', {
      normalizedTime: 0.65,
      weapon: 'sword',
      scale: 1,
    });

    const rotationDistance = (left: readonly number[], right: readonly number[]) => Math.hypot(
      left[0] - right[0],
      left[1] - right[1],
      left[2] - right[2]
    );

    assert.ok(rotationDistance(hammerCarry.weaponPose.rotation, hammerSwing.weaponPose.rotation) > 0.18);
    assert.ok(rotationDistance(swordStart.weaponPose.rotation, swordSlash.weaponPose.rotation) > 0.18);
  });
});
