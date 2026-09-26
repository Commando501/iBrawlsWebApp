import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as THREE from 'three';
import { resolveV3GameplayAction, sampleV3GameplayAnimation, applyV3GameplayHitReact } from './v3GameplayAnimation';
import { animateSpartanCombatantModel, animateCombatantWeaponMeshes } from './combatantAnimation';
import { createCombatantMeshRig } from './combatantModels';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { getV3Mesh2MotionDriverWeaponSocketWorldPosition } from './v3Mesh2MotionDriverRig';
import { getV3WeaponSocketWorldPosition } from './v3WeaponSocketBasis';
import { sampleV3ProductionClip } from './v3AuthoredAnimationClips';
import { updateV3GameplayBall } from './v3GameplayBall';
import type { GrifballRuntimeState } from './runtimeState';
import { buildLocalPlayerViewForRefs } from './localPlayerViewRuntime';
import { updateWeaponAnimationFrameForState } from './weaponAnimationFrameRuntime';

const ready = { activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0 };

it('normalizes elapsed gameplay seconds, including bot split attacks and ball recovery', () => {
  const cases: [string, string, number, string, number][] = [
    ['hammer', 'swing_up', .14, 'clean_hammer_windup', .5],
    ['hammer', 'swing_down', .06, 'clean_hammer_strike', .5],
    ['hammer', 'recovering', .3, 'clean_hammer_recover', .5],
    ['hammer', 'melee_swing', .12, 'clean_hammer_melee', .5],
    ['hammer', 'melee_up', .1, 'clean_hammer_melee', .35],
    ['hammer', 'melee_down', .14, 'clean_hammer_melee', 1],
    ['hammer', 'melee_recover', .25, 'clean_hammer_melee_recover', .5],
    ['sword', 'swing_up', .11, 'clean_sword_slash', .5],
    ['sword', 'swing_down', .11, 'clean_sword_slash', 1],
    ['sword', 'slashing', .11, 'clean_sword_slash', .5],
    ['pistol', 'firing', .08, 'clean_pistol_fire', .4],
    ['pistol', 'recovering', .15, 'clean_pistol_fire', 1],
    ['ball', 'melee_swing', .24, 'clean_ball_punch', 26 / 72],
    ['ball', 'recovering', .5, 'clean_ball_punch', 1],
  ];
  for (const [activeWeapon, weaponState, weaponTimer, clipId, time] of cases) {
    const actual = resolveV3GameplayAction({ activeWeapon, weaponState, weaponTimer });
    assert.equal(actual.clipId, clipId);
    assert.ok(Math.abs(actual.time! - time) < 1e-6, `${activeWeapon}:${weaponState}`);
  }
});

it('loops locomotion independently of ready timers and preserves two-handed carry', () => {
  const model = new THREE.Group();
  const first = sampleV3GameplayAnimation(model, { ...ready, velocityLength: 3 }, .1);
  const second = sampleV3GameplayAnimation(model, { ...ready, velocityLength: 3 }, .2);
  assert.notDeepEqual(first.pose.mesh2MotionDriverPose!.joints.thigh_l, second.pose.mesh2MotionDriverPose!.joints.thigh_l);
  assert.deepEqual(second.pose.mesh2MotionDriverPose!.joints.hand_l, sampleV3ProductionClip('clean_hammer_carry', { normalizedTime: second.normalizedTime }).pose.mesh2MotionDriverPose!.joints.hand_l);
  assert.equal(sampleV3GameplayAnimation(model, { ...ready, activeWeapon: 'ball', velocityLength: 6, isSprinting: true }, .1).clipId, 'clean_ball_sprint');
});

it('keeps actual visible leg articulation moving during weapon attacks and recovery', () => {
  const refs = createInitialGrifballThreeRefs();
  const rig = createCombatantMeshRig(new THREE.Scene(), 192, false, { modelSystem: 'v3' });
  for (const [activeWeapon, weaponState] of [['hammer', 'swing_up'], ['hammer', 'recovering'], ['sword', 'slashing'], ['pistol', 'firing'], ['ball', 'melee_swing']] as const) {
    const input = { refs, mesh: rig.group, vel: new THREE.Vector3(0, 0, -5), yaw: 0, hp: 100, activeWeapon, weaponState, weaponTimer: .05, dt: .1, isLocalV3Animation: true };
    animateSpartanCombatantModel(input);
    const thigh = rig.group.userData.v3PartGroups.thighLeft as THREE.Group;
    const before = thigh.getWorldQuaternion(new THREE.Quaternion());
    animateSpartanCombatantModel(input);
    const after = thigh.getWorldQuaternion(new THREE.Quaternion());
    assert.ok(before.angleTo(after) > .02, `${activeWeapon}:${weaponState} visible thigh froze`);
    assert.equal(rig.group.userData.v3GameplayLocomotion, 'clean_sprint');
  }
});

it('advances the gait by travelled distance rather than a fixed preview timer', () => {
  const slow = new THREE.Group(), fast = new THREE.Group();
  sampleV3GameplayAnimation(slow, { ...ready, velocityLength: 1 }, .1);
  sampleV3GameplayAnimation(fast, { ...ready, velocityLength: 2 }, .1);
  assert.equal(fast.userData.v3GameplayPlayback.locomotionPhase, slow.userData.v3GameplayPlayback.locomotionPhase * 2);
});

it('holds each weapon slide until physics ends, then finishes standing up once', () => {
  for (const weapon of ['hammer', 'sword', 'pistol', 'ball']) {
    const model = new THREE.Group();
    const input = { ...ready, activeWeapon: weapon, isSliding: true };
    sampleV3GameplayAnimation(model, input, .016);
    const held = sampleV3GameplayAnimation(model, input, 2);
    assert.equal(held.clipId, `clean_slide_${weapon}`);
    assert.ok(Math.abs(held.normalizedTime - 48 / 84) < 1e-9);
    const exit = sampleV3GameplayAnimation(model, { ...input, isSliding: false }, .016);
    assert.equal(exit.normalizedTime, held.normalizedTime);
    const rise = sampleV3GameplayAnimation(model, { ...input, isSliding: false }, .3);
    assert.ok(rise.normalizedTime > exit.normalizedTime && rise.normalizedTime < 1);
    assert.equal(sampleV3GameplayAnimation(model, { ...input, isSliding: false }, .4).clipId, `clean_${weapon}_carry`);
  }
});

it('holds the lunge extension and plays the side cut after contact before returning', () => {
  const model = new THREE.Group();
  const input = { ...ready, activeWeapon: 'sword', isLunging: true };
  sampleV3GameplayAnimation(model, input, .016);
  assert.equal(sampleV3GameplayAnimation(model, input, 1).normalizedTime, 33 / 60);
  const end = { ...input, isLunging: false, weaponState: 'recovering' };
  assert.equal(sampleV3GameplayAnimation(model, end, .016).normalizedTime, 33 / 60);
  const cut = sampleV3GameplayAnimation(model, end, .2);
  assert.equal(cut.clipId, 'clean_sword_lunge');
  assert.ok(cut.normalizedTime > 33 / 60);
  assert.equal(sampleV3GameplayAnimation(model, { ...ready, activeWeapon: 'sword' }, .5).clipId, 'clean_sword_carry');
});

it('shared gameplay entry points apply Blender poses and keep weapon contacts aligned', () => {
  const scene = new THREE.Scene();
  const rig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' });
  const refs = createInitialGrifballThreeRefs();
  for (const [activeWeapon, weaponState, timer] of [['hammer', 'ready', 0], ['hammer', 'swing_up', .14], ['hammer', 'swing_down', .06], ['sword', 'slashing', .11], ['pistol', 'firing', .04]] as const) {
    animateSpartanCombatantModel({ refs, mesh: rig.group, vel: new THREE.Vector3(3, 0, 0), yaw: 0, hp: 100, activeWeapon, weaponState, weaponTimer: timer, dt: .1, isLocalV3Animation: true });
    animateCombatantWeaponMeshes({ hammerModel: rig.hammer, swordModel: rig.sword, pistolModel: rig.pistol, combatantModel: rig.group, activeWeapon, weaponState, weaponTimer: timer, isLunging: false, dt: .1, settings: {} });
    assert.equal(rig.group.userData.v3AnimationAuthority, 'cleanRig');
    assert.equal(rig.group.userData.v3CleanMotionSource, 'blenderAuthored');
    const weapon = rig[activeWeapon]!;
    assert.equal(weapon.userData.v3CleanAuthoredClip, rig.group.userData.v3CleanAuthoredClip);
    const hand = getV3Mesh2MotionDriverWeaponSocketWorldPosition(rig.group, 'rightHandGrip')!;
    const grip = getV3WeaponSocketWorldPosition(weapon, 'thirdPersonPrimaryGrip')!;
    assert.ok(hand.distanceTo(grip) < .015, `${activeWeapon} primary: ${hand.distanceTo(grip)}`);
    if (activeWeapon !== 'sword') {
      const left = getV3Mesh2MotionDriverWeaponSocketWorldPosition(rig.group, 'leftHandGrip')!;
      const offhand = getV3WeaponSocketWorldPosition(weapon, 'thirdPersonOffhandGrip')!;
      assert.ok(left.distanceTo(offhand) < .015, `${activeWeapon} offhand: ${left.distanceTo(offhand)}`);
    }
  }
  animateSpartanCombatantModel({ refs, mesh: rig.group, vel: new THREE.Vector3(), yaw: 0, hp: 0, ...ready, dt: .1 });
  assert.equal(rig.group.userData.v3GameplayPlayback, undefined);
});

it('flinch moves the chest and weapon together without mutating future baked samples', () => {
  const sample = sampleV3ProductionClip('clean_hammer_carry');
  const original = JSON.stringify(sample);
  applyV3GameplayHitReact(sample, .5);
  assert.notEqual(JSON.stringify(sample), original);
  assert.equal(JSON.stringify(sampleV3ProductionClip('clean_hammer_carry')), original);
});

it('the objective uses the runner bake while held and relinquishes transforms at release', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.hostGroup = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.32), new THREE.MeshStandardMaterial());
  const state = { grifball: { ball: { state: 'held', holderId: 'player' } }, otherPlayers: new Map(), playerPos: new THREE.Vector3(2, 0, 3), playerVel: new THREE.Vector3(), yaw: .7, pWeaponState: 'ready', pWeaponTimer: 0, grifballPassCharge: 0, settings: {} } as unknown as GrifballRuntimeState;
  assert.equal(updateV3GameplayBall(state, refs, mesh, .016, 'v3'), true);
  assert.equal(refs.hostGroup.userData.v3RunnerSample.clipId, 'clean_ball_carry');
  assert.equal(mesh.material.visible, false);
  state.grifballPassCharge = .8;
  updateV3GameplayBall(state, refs, mesh, .016, 'v3');
  assert.equal(refs.hostGroup.userData.v3RunnerSample.clipId, 'clean_ball_throw');
  state.grifball.ball.state = 'thrown';
  state.grifball.ball.holderId = null;
  const position = mesh.position.clone();
  assert.equal(updateV3GameplayBall(state, refs, mesh, .016, 'v3'), false);
  assert.deepEqual(mesh.position, position);
  updateV3GameplayBall(state, refs, mesh, 1, 'v3');
  assert.equal(refs.hostGroup.userData.v3RunnerSample, undefined);
});

it('the full first-person frame uses baked attacks, keeps lunge follow-through and resets on death', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  refs.camera = new THREE.PerspectiveCamera();
  buildLocalPlayerViewForRefs({ refs, scene: refs.scene, camera: refs.camera, adminSettings: {}, playerLoadout: { modelSystem: 'v3' } });
  const state = {
    activeWeapon: 'sword', pSwordState: 'ready', pSwordTimer: 0, pSwordRecoverDuration: .6,
    pWeaponState: 'ready', pWeaponTimer: 0, pPistolState: 'ready', pPistolTimer: 0,
    playerHP: 100, playerVel: new THREE.Vector3(), settings: {}, isLunging: true,
    lungeTimer: 0, crouchAmount: 0,
  } as unknown as GrifballRuntimeState;
  const tick = (dt: number) => updateWeaponAnimationFrameForState({ state, refs, dt, mainAI: undefined,
    getPlayerSwordLockTarget: () => null, applyHammerStrikeImpact: () => {}, applyPlayerHammerMeleeImpact: () => {},
    applyPlayerSwordSlashImpact: () => false, applyEnemyHammerMeleeImpact: () => {}, applyEnemySwordSlashImpact: () => {},
  });
  tick(.016);
  tick(.3);
  state.isLunging = false;
  state.pSwordState = 'recovering';
  tick(.016);
  tick(.15);
  assert.equal(refs.playerSword!.userData.v3GameplaySample.clipId, 'clean_sword_lunge');
  assert.ok(refs.playerSword!.userData.v3GameplaySample.normalizedTime > 33 / 60);
  assert.equal(refs.playerSword!.userData.v3WeaponSocketBasis.socketName, 'thirdPersonPrimaryGrip');
  state.activeWeapon = 'hammer';
  state.pWeaponState = 'swing_up';
  tick(.14);
  assert.equal(refs.playerHammer!.userData.v3GameplaySample.clipId, 'clean_hammer_windup');
  assert.equal(refs.playerHammer!.userData.v3GameplaySample.normalizedTime, .5);
  state.playerHP = 0;
  tick(.016);
  assert.equal(refs.playerHammer!.userData.v3GameplayPlayback, undefined);
  assert.equal(refs.playerSword!.userData.v3GameplayPlayback, undefined);
});
