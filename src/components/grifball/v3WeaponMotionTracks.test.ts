import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  V3_WEAPON_MOTION_TRACKS,
  getV3WeaponMotionTrackDefinition,
  sampleV3WeaponMotionCarry,
  sampleV3WeaponMotionTrack,
} from './v3WeaponMotionTracks';

const finiteTuple = (values: readonly number[]): boolean => values.every(Number.isFinite);

const poseDistance = (
  left: { position: readonly number[]; rotation: readonly number[] },
  right: { position: readonly number[]; rotation: readonly number[] }
): number => {
  const distance = (a: readonly number[], b: readonly number[]) => Math.sqrt(
    a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0)
  );
  return distance(left.position, right.position) + distance(left.rotation, right.rotation);
};

const semanticForward = (rotation: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(0, 0, -1)
    .applyEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .normalize();

describe('V3 weapon motion tracks', () => {
  it('defines deterministic V3-only tracks for every current weapon action', () => {
    assert.deepEqual(
      V3_WEAPON_MOTION_TRACKS.map((track) => track.id),
      [
        'hammer_windup',
        'hammer_strike',
        'hammer_recover',
        'hammer_melee',
        'hammer_melee_recover',
        'sword_lunge',
        'sword_slash',
        'sword_recover',
        'pistol_fire',
        'pistol_recover',
      ]
    );
    assert.equal(getV3WeaponMotionTrackDefinition('hammer_strike').weapon, 'hammer');
    assert.equal(getV3WeaponMotionTrackDefinition('sword_slash').weapon, 'sword');
    assert.equal(getV3WeaponMotionTrackDefinition('pistol_fire').weapon, 'pistol');
  });

  it('samples carry poses with explicit grip constraints and finite chest-space transforms', () => {
    const hammer = sampleV3WeaponMotionCarry('hammer');
    const sword = sampleV3WeaponMotionCarry('sword');
    const pistol = sampleV3WeaponMotionCarry('pistol');

    assert.deepEqual(hammer.reference, { clipId: 'hammer_2hand_idle', normalizedTime: 0 });
    assert.deepEqual(sword.reference, { clipId: 'sword_outward_slash', normalizedTime: 0 });
    assert.equal(pistol.reference, undefined);
    assert.equal(hammer.gripConstraints.length, 2);
    assert.deepEqual(
      hammer.gripConstraints.map((constraint) => `${constraint.side}:${constraint.socketName}`).sort(),
      ['left:thirdPersonOffhandGrip', 'right:thirdPersonPrimaryGrip']
    );
    assert.deepEqual(sword.gripConstraints.map((constraint) => constraint.side), ['right']);
    assert.deepEqual(pistol.gripConstraints.map((constraint) => constraint.side), ['right']);

    for (const sample of [hammer, sword, pistol]) {
      assert.equal(
        sample.trackSource,
        sample.weapon === 'pistol' ? 'v3ConstrainedWeaponMotion' : 'v3MixamoWeaponReference'
      );
      assert.equal(finiteTuple(sample.weaponPose.position), true, `${sample.weapon} carry position`);
      assert.equal(finiteTuple(sample.weaponPose.rotation), true, `${sample.weapon} carry rotation`);
      assert.ok(Math.abs(sample.weaponPose.position[0]) < 0.8, `${sample.weapon} carry x readable`);
      assert.ok(Math.abs(sample.weaponPose.position[1]) < 0.8, `${sample.weapon} carry y readable`);
      assert.ok(Math.abs(sample.weaponPose.position[2]) < 0.8, `${sample.weapon} carry z readable`);
    }

    assert.ok(Math.abs(semanticForward(hammer.weaponPose.rotation).x) > 0.5);
    assert.ok(semanticForward(sword.weaponPose.rotation).z < -0.5);
    assert.ok(semanticForward(pistol.weaponPose.rotation).z < -0.94);
  });

  it('drives hammer and sword action samples from Mixamo reference timing', () => {
    const hammerWindup = sampleV3WeaponMotionTrack('hammer_windup', 0.5);
    const hammerStrike = sampleV3WeaponMotionTrack('hammer_strike', 0.5);
    const hammerMelee = sampleV3WeaponMotionTrack('hammer_melee', 0.5);
    const swordSlash = sampleV3WeaponMotionTrack('sword_slash', 0.5);

    assert.equal(hammerWindup.trackSource, 'v3MixamoWeaponReference');
    assert.equal(hammerStrike.trackSource, 'v3MixamoWeaponReference');
    assert.equal(hammerMelee.trackSource, 'v3MixamoWeaponReference');
    assert.equal(swordSlash.trackSource, 'v3MixamoWeaponReference');
    assert.equal(hammerWindup.reference?.clipId, 'hammer_heavy_swing');
    assert.equal(hammerStrike.reference?.clipId, 'hammer_heavy_swing');
    assert.equal(hammerMelee.reference?.clipId, 'hammer_melee_advance');
    assert.equal(swordSlash.reference?.clipId, 'sword_outward_slash');
  });

  it('returns recover tracks to carry and keeps action tracks visibly off carry at contact', () => {
    for (const track of V3_WEAPON_MOTION_TRACKS) {
      const carry = sampleV3WeaponMotionCarry(track.weapon);
      const start = sampleV3WeaponMotionTrack(track.id, 0);
      const contact = sampleV3WeaponMotionTrack(track.id, 1);

      assert.equal(start.trackId, track.id);
      assert.equal(contact.trackId, track.id);
      assert.equal(finiteTuple(contact.weaponPose.position), true, `${track.id} contact position`);
      assert.equal(finiteTuple(contact.weaponPose.rotation), true, `${track.id} contact rotation`);

      if (track.id.endsWith('_recover')) {
        assert.ok(poseDistance(contact.weaponPose, carry.weaponPose) < 1e-9, `${track.id} should end at carry`);
      } else if (track.id === 'hammer_strike') {
        assert.ok(poseDistance(start.weaponPose, carry.weaponPose) > 0.16, `${track.id} should start from Mixamo windup`);
        assert.equal(start.reference?.clipId, 'hammer_heavy_swing');
      } else {
        assert.ok(poseDistance(start.weaponPose, carry.weaponPose) < 1e-9, `${track.id} should start at carry`);
        assert.ok(poseDistance(contact.weaponPose, carry.weaponPose) > 0.16, `${track.id} should leave carry`);
      }
    }
  });

  it('authors hammer and sword attacks with readable sweep amplitude', () => {
    const hammerCarry = sampleV3WeaponMotionCarry('hammer');
    const hammerWindup = sampleV3WeaponMotionTrack('hammer_windup', 1);
    const hammerStrike = sampleV3WeaponMotionTrack('hammer_strike', 1);
    const hammerMelee = sampleV3WeaponMotionTrack('hammer_melee', 1);
    const swordCarry = sampleV3WeaponMotionCarry('sword');
    const swordSlash = sampleV3WeaponMotionTrack('sword_slash', 1);

    assert.ok(hammerWindup.weaponPose.position[1] > hammerCarry.weaponPose.position[1] + 0.16);
    assert.ok(hammerWindup.weaponPose.position[2] > hammerCarry.weaponPose.position[2] + 0.05);
    assert.ok(hammerStrike.weaponPose.position[1] < hammerCarry.weaponPose.position[1] - 0.14);
    assert.ok(poseDistance(hammerStrike.weaponPose, hammerWindup.weaponPose) > 1.5);
    assert.ok(Math.abs(hammerMelee.weaponPose.position[0] - hammerCarry.weaponPose.position[0]) > 0.12);
    assert.ok(swordSlash.weaponPose.position[0] > swordCarry.weaponPose.position[0] + 0.22);
    assert.ok(Math.abs(swordSlash.weaponPose.position[1] - swordCarry.weaponPose.position[1]) < 0.1);
  });

  it('links canonical weapon action keyframes to imported Mixamo reference clips', () => {
    const referenceByTrack = Object.fromEntries(
      V3_WEAPON_MOTION_TRACKS.map((track) => [
        track.id,
        track.keyframes
          .map((frame) => frame.reference?.clipId)
          .filter(Boolean),
      ])
    );

    assert.deepEqual(referenceByTrack.hammer_windup, ['hammer_2hand_idle', 'hammer_heavy_swing']);
    assert.deepEqual(referenceByTrack.hammer_strike, ['hammer_2hand_idle', 'hammer_heavy_swing', 'hammer_heavy_swing']);
    assert.deepEqual(referenceByTrack.hammer_recover, ['hammer_heavy_swing', 'hammer_2hand_idle']);
    assert.deepEqual(referenceByTrack.hammer_melee, ['hammer_2hand_idle', 'hammer_melee_advance']);
    assert.deepEqual(referenceByTrack.hammer_melee_recover, ['hammer_melee_advance', 'hammer_2hand_idle']);
    assert.deepEqual(referenceByTrack.sword_slash, ['sword_outward_slash', 'sword_outward_slash']);
    assert.deepEqual(referenceByTrack.sword_recover, ['sword_outward_slash', 'sword_outward_slash']);
  });
});
