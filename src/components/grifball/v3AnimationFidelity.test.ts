import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_ANIMATION_PROFILE_VERSION,
  getV3AnimationTrackDefinition,
  sampleV3ProceduralWeaponTrackPose,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
  sampleV3WeaponCarryPose,
} from './v3AnimationFidelity';

const finiteTuple = (tuple: readonly number[]) => tuple.every(Number.isFinite);

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

const upperBodyDistance = (
  a: ReturnType<typeof sampleV3UpperBodyWeaponPose>,
  b: ReturnType<typeof sampleV3UpperBodyWeaponPose>
) => tupleDistance(upperBodyValues(a), upperBodyValues(b));

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
  const values = upperBodyValues(pose);
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
      weaponTimer: 0.2,
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

    assert.equal(hammer.rightArmRotation[0] < -0.6, true);
    assert.equal(hammer.leftArmRotation[0] < -0.35, true);
    assert.equal(Math.abs(hammer.headRotation[1]) > 0.02, true);
    assert.equal(sword.upperTorsoRotation[0] > 0.1, true);
    assert.equal(sword.rightArmRotation[0] < -0.6, true);
  });

  it('defines finite weapon-specific carry poses for V3 third-person movement', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const carry = sampleV3WeaponCarryPose(weapon);

      assertReadableWeaponPose(carry.weaponPose, `${weapon} carry weapon`);
      assertReadableUpperBodyPose(carry.upperBodyPose, `${weapon} carry upper-body`);
      assert.equal(carry.trackSource, 'v3ProceduralCarry');
      assert.equal(carry.weapon, weapon);
    }

    const hammer = sampleV3WeaponCarryPose('hammer');
    const sword = sampleV3WeaponCarryPose('sword');
    const pistol = sampleV3WeaponCarryPose('pistol');
    assert.ok(upperBodyDistance(hammer.upperBodyPose, sword.upperBodyPose) > 0.15);
    assert.ok(upperBodyDistance(sword.upperBodyPose, pistol.upperBodyPose) > 0.15);
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
        assert.ok(upperBodyDistance(end.upperBodyPose, carry.upperBodyPose) < 1e-9, `${trackId} upper-body should end at carry`);
      } else {
        assert.ok(poseDistance(start.weaponPose, carry.weaponPose) < 1e-9, `${trackId} should start at carry`);
        assert.ok(upperBodyDistance(start.upperBodyPose, carry.upperBodyPose) < 1e-9, `${trackId} upper-body should start at carry`);
        assert.ok(
          poseDistance(mid.weaponPose, carry.weaponPose) + upperBodyDistance(mid.upperBodyPose, carry.upperBodyPose) > 0.1,
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
    assert.equal(strike.upperTorsoRotation[0] > windup.upperTorsoRotation[0] + 0.2, true);
    assert.equal(upperBodyDistance(recover, ready) < upperBodyDistance(strike, ready), true);
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

    assertReadableUpperBodyPose(fire, 'pistol upper-body fire');
    assertReadableUpperBodyPose(recovered, 'pistol upper-body recovered');
    assert.equal(upperBodyDistance(recovered, ready) < 1e-9, true);
    assert.equal(Math.abs(fire.rightArmRotation[0]) > Math.abs(recovered.rightArmRotation[0]) + 0.25, true);
  });
});
