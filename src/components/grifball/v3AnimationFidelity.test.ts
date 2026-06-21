import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  V3_ANIMATION_PROFILE_VERSION,
  getV3AnimationTrackDefinition,
  sampleV3ProceduralWeaponTrackPose,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
  sampleV3WeaponCarryMotion,
  sampleV3WeaponCarryPose,
} from './v3AnimationFidelity';

const finiteTuple = (tuple: readonly number[]) => tuple.every(Number.isFinite);

const semanticForwardForWeaponPose = (
  pose: { rotation: readonly number[] }
): THREE.Vector3 => {
  const rotation = pose.rotation as [number, number, number];
  return new THREE.Vector3(0, 0, -1)
    .applyEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2]))
    .normalize();
};

const tupleDistance = (a: readonly number[], b: readonly number[]) => Math.sqrt(
  a.reduce((sum, value, index) => sum + (value - b[index]) ** 2, 0)
);

const poseDistance = (
  a: { position: readonly number[]; rotation: readonly number[] },
  b: { position: readonly number[]; rotation: readonly number[] }
) => tupleDistance(a.position, b.position) + tupleDistance(a.rotation, b.rotation);

const upperBodyValues = (pose: ReturnType<typeof sampleV3UpperBodyWeaponPose>) => [
  ...pose.upperTorsoRotation,
  ...pose.headRotation,
  ...pose.leftArmRotation,
  ...pose.rightArmRotation,
];

const detailedUpperBodyValues = (pose: ReturnType<typeof sampleV3UpperBodyWeaponPose>) => [
  ...upperBodyValues(pose),
  ...Object.values(pose.detailBoneRotations ?? {}).flatMap((rotation) => rotation ?? []),
];

const upperBodyDistance = (
  a: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  b: ReturnType<typeof sampleV3UpperBodyWeaponPose>
) => tupleDistance(upperBodyValues(a), upperBodyValues(b));

const detailedUpperBodyDistance = (
  a: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  b: ReturnType<typeof sampleV3UpperBodyWeaponPose>
) => tupleDistance(detailedUpperBodyValues(a), detailedUpperBodyValues(b));

const assertReadableWeaponPose = (
  pose: { position: readonly number[]; rotation: readonly number[] },
  label: string
) => {
  assert.equal(finiteTuple(pose.position), true, `${label} position must stay finite`);
  assert.equal(finiteTuple(pose.rotation), true, `${label} rotation must stay finite`);
  for (const value of pose.position) {
    assert.equal(Math.abs(value) <= 1.5, true, `${label} position ${value} exceeded readable range`);
  }
  for (const value of pose.rotation) {
    assert.equal(Math.abs(value) <= Math.PI, true, `${label} rotation ${value} exceeded readable range`);
  }
};

const assertReadableUpperBodyPose = (
  pose: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  label: string
) => {
  const values = detailedUpperBodyValues(pose);
  assert.equal(values.every(Number.isFinite), true, `${label} upper-body rotations must stay finite`);
  for (const value of values) {
    assert.equal(Math.abs(value) <= 1.6, true, `${label} upper-body rotation ${value} exceeded readable range`);
  }
};

describe('V3 animation fidelity profiles', () => {
  it('declares a stable profile version and known editor track ids', () => {
    assert.equal(V3_ANIMATION_PROFILE_VERSION, 2);
    assert.equal(getV3AnimationTrackDefinition('hammer_windup').weapon, 'hammer');
    assert.equal(getV3AnimationTrackDefinition('sword_lunge').weapon, 'sword');
    assert.equal(getV3AnimationTrackDefinition('pistol_fire').weapon, 'pistol');
  });

  it('samples synchronized first-person and third-person pistol recoil curves', () => {
    const firstPerson = sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const thirdPerson = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const recovered = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.18,
      isLunging: false,
      settings: {},
    });

    assert.equal(finiteTuple(firstPerson.position), true);
    assert.equal(finiteTuple(firstPerson.rotation), true);
    assert.equal(firstPerson.rotation[0] < -0.1, true);
    assert.equal(thirdPerson.rotation[0] < recovered.rotation[0], true);
    assert.equal(thirdPerson.position[2] > recovered.position[2], true);
  });

  it('samples expressive upper-body poses without lower-body data', () => {
    const hammer = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.45,
      isLunging: false,
      settings: { hammerSlamWindupTime: 0.45, hammerSlamAttackTime: 0.3 },
    });
    const sword = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.08,
      isLunging: true,
      settings: {},
    });

    assert.equal(Math.abs(hammer.rightArmRotation[1]) > 0.5, true);
    assert.equal(Math.abs(hammer.leftArmRotation[2]) > 0.4, true);
    assert.equal(Math.abs(hammer.headRotation[1]) > 0.1, true);
    assert.equal(sword.upperTorsoRotation[0] > 0.1, true);
    assert.equal(sword.rightArmRotation[0] < -0.6, true);
  });

  it('defines finite weapon-specific carry poses for V3 third-person movement', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const carry = sampleV3WeaponCarryPose(weapon);
      const motion = sampleV3WeaponCarryMotion(weapon);

      assertReadableWeaponPose(carry.weaponPose, `${weapon} carry weapon`);
      assertReadableUpperBodyPose(carry.upperBodyPose, `${weapon} carry upper-body`);
      assert.equal(carry.trackSource, 'v3ProceduralCarry');
      assert.equal(carry.weapon, weapon);
      assert.equal(
        motion.trackSource,
        weapon === 'pistol' ? 'v3ConstrainedWeaponMotion' : 'v3MixamoWeaponReference'
      );
    }

    const hammer = sampleV3WeaponCarryPose('hammer');
    const sword = sampleV3WeaponCarryPose('sword');
    const pistol = sampleV3WeaponCarryPose('pistol');
    assert.ok(poseDistance(hammer.weaponPose, sword.weaponPose) > 0.2);
    assert.ok(poseDistance(sword.weaponPose, pistol.weaponPose) > 0.2);
  });

  it('samples procedural weapon tracks from carry and back to carry', () => {
    const tracks = [
      'hammer_windup',
      'hammer_strike',
      'hammer_recover',
      'sword_lunge',
      'sword_slash',
      'sword_recover',
      'pistol_fire',
      'pistol_recover',
    ] as const;

    for (const trackId of tracks) {
      const definition = getV3AnimationTrackDefinition(trackId);
      const carry = sampleV3WeaponCarryPose(definition.weapon);
      const start = sampleV3ProceduralWeaponTrackPose(trackId, 0);
      const mid = sampleV3ProceduralWeaponTrackPose(trackId, 0.5);
      const end = sampleV3ProceduralWeaponTrackPose(trackId, 1);

      assert.equal(start.trackId, trackId);
      assert.equal(start.trackSource, 'v3ProceduralWeaponTrack');
      assertReadableWeaponPose(mid.weaponPose, `${trackId} mid weapon`);
      assertReadableUpperBodyPose(mid.upperBodyPose, `${trackId} mid upper-body`);
      if (trackId.endsWith('_recover')) {
        assert.ok(poseDistance(end.weaponPose, carry.weaponPose) < 1e-9, `${trackId} should end at carry`);
        assert.ok(detailedUpperBodyDistance(end.upperBodyPose, carry.upperBodyPose) < 1e-9, `${trackId} upper-body should end at carry`);
      } else if (trackId === 'hammer_strike') {
        assert.ok(poseDistance(start.weaponPose, carry.weaponPose) > 0.16, `${trackId} should start from Mixamo windup`);
        assert.ok(detailedUpperBodyDistance(start.upperBodyPose, carry.upperBodyPose) > 0.16, `${trackId} upper-body should start from Mixamo windup`);
      } else {
        assert.ok(poseDistance(start.weaponPose, carry.weaponPose) < 1e-9, `${trackId} should start at carry`);
        assert.ok(detailedUpperBodyDistance(start.upperBodyPose, carry.upperBodyPose) < 1e-9, `${trackId} upper-body should start at carry`);
        assert.ok(
          poseDistance(mid.weaponPose, carry.weaponPose) + detailedUpperBodyDistance(mid.upperBodyPose, carry.upperBodyPose) > 0.1,
          `${trackId} should visibly leave carry at midpoint`
        );
      }
    }
  });

  it('keeps hammer windup strike and recover samples finite and readable', () => {
    const settings = {
      hammerSlamWindupTime: 0.45,
      hammerSlamAttackTime: 0.3,
      hammerReloadTime: 0.6,
    };
    const makeInput = (weaponState: string, weaponTimer: number) => ({
      activeWeapon: 'hammer' as const,
      weaponState,
      weaponTimer,
      isLunging: false,
      settings,
    });

    for (const sample of [sampleV3FirstPersonWeaponPose, sampleV3ThirdPersonWeaponPose]) {
      const ready = sample(makeInput('ready', 0));
      const windup = sample(makeInput('swing_up', settings.hammerSlamWindupTime));
      const strike = sample(makeInput('swing_down', settings.hammerSlamAttackTime));
      const recover = sample(makeInput('recovering', settings.hammerReloadTime));

      assertReadableWeaponPose(windup, 'hammer windup');
      assertReadableWeaponPose(strike, 'hammer strike');
      assertReadableWeaponPose(recover, 'hammer recover');
      assert.equal(strike.position[1] < windup.position[1] - 0.05, true);
      assert.equal(strike.position[2] < windup.position[2] - 0.04, true);
      assert.equal(poseDistance(recover, ready) < poseDistance(strike, ready), true);
    }

    const ready = sampleV3UpperBodyWeaponPose(makeInput('ready', 0));
    const windup = sampleV3UpperBodyWeaponPose(makeInput('swing_up', settings.hammerSlamWindupTime));
    const strike = sampleV3UpperBodyWeaponPose(makeInput('swing_down', settings.hammerSlamAttackTime));
    const recover = sampleV3UpperBodyWeaponPose(makeInput('recovering', settings.hammerReloadTime));

    assertReadableUpperBodyPose(windup, 'hammer upper-body windup');
    assertReadableUpperBodyPose(strike, 'hammer upper-body strike');
    assertReadableUpperBodyPose(recover, 'hammer upper-body recover');
    assert.equal(detailedUpperBodyDistance(strike, windup) > 0.4, true);
    assert.equal(detailedUpperBodyDistance(recover, ready) < detailedUpperBodyDistance(strike, ready), true);
  });

  it('models hammer as a two-handed pickaxe-style slam and right-to-left melee swing', () => {
    const settings = {
      hammerSlamWindupTime: 0.45,
      hammerSlamAttackTime: 0.3,
      hammerReloadTime: 0.6,
      hammerMeleeSpeed: 0.24,
    };
    const readyInput = {
      activeWeapon: 'hammer' as const,
      weaponState: 'ready',
      weaponTimer: 0,
      isLunging: false,
      settings,
    };
    const carry = sampleV3WeaponCarryPose('hammer');
    const windup = sampleV3ProceduralWeaponTrackPose('hammer_windup', 1);
    const strike = sampleV3ProceduralWeaponTrackPose('hammer_strike', 1);
    const recover = sampleV3ProceduralWeaponTrackPose('hammer_recover', 1);
    const melee = sampleV3ProceduralWeaponTrackPose('hammer_melee', 1);
    const runtimeCarry = sampleV3UpperBodyWeaponPose(readyInput);
    const carryForward = semanticForwardForWeaponPose(carry.weaponPose);

    assertReadableWeaponPose(windup.weaponPose, 'hammer pickaxe windup');
    assertReadableWeaponPose(strike.weaponPose, 'hammer ground strike');
    assertReadableWeaponPose(melee.weaponPose, 'hammer melee swing');
    assertReadableUpperBodyPose(runtimeCarry, 'hammer two-hand carry');
    assert.ok(Math.abs(carryForward.x) > 0.5);
    assert.equal(sampleV3WeaponCarryMotion('hammer').gripConstraints.length, 2);
    assert.ok(windup.weaponPose.position[1] > carry.weaponPose.position[1] + 0.09);
    assert.ok(windup.weaponPose.position[2] > carry.weaponPose.position[2] + 0.025);
    assert.ok(strike.weaponPose.position[1] < carry.weaponPose.position[1] - 0.18);
    assert.ok(poseDistance(strike.weaponPose, windup.weaponPose) > 1.5);
    assert.ok(detailedUpperBodyDistance(strike.upperBodyPose, carry.upperBodyPose) > 1.0);
    assert.ok(Math.abs(melee.weaponPose.position[0] - carry.weaponPose.position[0]) > 0.12);
    assert.ok(detailedUpperBodyDistance(melee.upperBodyPose, carry.upperBodyPose) > 0.5);
    assert.ok(poseDistance(recover.weaponPose, carry.weaponPose) < 1e-9);
  });

  it('keeps sword lunge and slash samples finite without extreme upper-body rotations', () => {
    const readyInput = {
      activeWeapon: 'sword' as const,
      weaponState: 'ready',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    };
    const lungeInput = {
      ...readyInput,
      weaponTimer: 0.18,
      isLunging: true,
    };
    const slashInput = {
      ...readyInput,
      weaponState: 'swing_up',
      weaponTimer: 0.22,
    };

    for (const sample of [sampleV3FirstPersonWeaponPose, sampleV3ThirdPersonWeaponPose]) {
      const ready = sample(readyInput);
      const lunge = sample(lungeInput);
      const slash = sample(slashInput);

      assertReadableWeaponPose(lunge, 'sword lunge');
      assertReadableWeaponPose(slash, 'sword slash');
      assert.equal(lunge.position[2] < ready.position[2] - 0.05, true);
    }

    const lungeUpper = sampleV3UpperBodyWeaponPose(lungeInput);
    const slashUpper = sampleV3UpperBodyWeaponPose(slashInput);

    assertReadableUpperBodyPose(lungeUpper, 'sword upper-body lunge');
    assertReadableUpperBodyPose(slashUpper, 'sword upper-body slash');
    assert.equal(Math.abs(lungeUpper.upperTorsoRotation[0]) <= 0.35, true);
    assert.equal(Math.abs(lungeUpper.rightArmRotation[0]) <= 0.9, true);
    assert.equal(Math.abs(lungeUpper.leftArmRotation[1]) <= 0.4, true);
  });

  it('models sword as a one-handed carry with a right-to-left horizontal slash', () => {
    const carry = sampleV3WeaponCarryPose('sword');
    const slash = sampleV3ProceduralWeaponTrackPose('sword_slash', 1);
    const recover = sampleV3ProceduralWeaponTrackPose('sword_recover', 1);
    const carryForward = semanticForwardForWeaponPose(carry.weaponPose);

    assertReadableWeaponPose(slash.weaponPose, 'sword horizontal slash');
    assertReadableUpperBodyPose(slash.upperBodyPose, 'sword horizontal slash upper-body');
    assert.ok(carryForward.z < -0.5);
    assert.ok(carryForward.y < -0.4);
    assert.equal(sampleV3WeaponCarryMotion('sword').gripConstraints.length, 1);
    assert.ok(slash.weaponPose.position[0] > carry.weaponPose.position[0] + 0.22);
    assert.ok(slash.upperBodyPose.upperTorsoRotation[1] > carry.upperBodyPose.upperTorsoRotation[1] + 0.28);
    assert.ok(Math.abs(slash.upperBodyPose.rightArmRotation[2]) > 0.5);
    assert.ok(Math.abs(slash.weaponPose.position[1] - carry.weaponPose.position[1]) < 0.08);
    assert.ok(poseDistance(recover.weaponPose, carry.weaponPose) < 1e-9);
  });

  it('keeps pistol fire samples finite and decays recoil by timer 0.18', () => {
    const makeInput = (weaponTimer: number) => ({
      activeWeapon: 'pistol' as const,
      weaponState: 'firing',
      weaponTimer,
      isLunging: false,
      settings: {},
    });

    for (const sample of [sampleV3FirstPersonWeaponPose, sampleV3ThirdPersonWeaponPose]) {
      const ready = sample({ ...makeInput(0), weaponState: 'ready' });
      const fire = sample(makeInput(0));
      const recovered = sample(makeInput(0.18));

      assertReadableWeaponPose(fire, 'pistol fire');
      assertReadableWeaponPose(recovered, 'pistol recovered');
      assert.equal(poseDistance(recovered, ready) < 1e-9, true);
      assert.equal(Math.abs(fire.rotation[0]) > Math.abs(recovered.rotation[0]) + 0.1, true);
    }

    const ready = sampleV3UpperBodyWeaponPose({ ...makeInput(0), weaponState: 'ready' });
    const fire = sampleV3UpperBodyWeaponPose(makeInput(0));
    const recovered = sampleV3UpperBodyWeaponPose(makeInput(0.18));
    const carryForward = semanticForwardForWeaponPose(sampleV3WeaponCarryPose('pistol').weaponPose);

    assertReadableUpperBodyPose(fire, 'pistol upper-body fire');
    assertReadableUpperBodyPose(recovered, 'pistol upper-body recovered');
    assert.ok(carryForward.z < -0.95);
    assert.ok(Math.abs(carryForward.y) < 0.08);
    assert.equal(upperBodyDistance(recovered, ready) < 1e-9, true);
    assert.equal(Math.abs(fire.rightArmRotation[0]) > Math.abs(recovered.rightArmRotation[0]) + 0.25, true);
  });
});
