import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as THREE from 'three';
import { sampleV3GameplayAnimation, sampleV3GameplayFirstPersonWeaponPose } from './v3GameplayAnimation';
import { sampleV3ProductionClip } from './v3AuthoredAnimationClips';
import { createCombatantMeshRig } from './combatantModels';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { animateSpartanCombatantModel, animateCombatantWeaponMeshes } from './combatantAnimation';
import { getV3Mesh2MotionDriverWeaponSocketWorldPosition } from './v3Mesh2MotionDriverRig';
import { getV3WeaponSocketWorldPosition } from './v3WeaponSocketBasis';
import { updateV3GameplayBall } from './v3GameplayBall';
import type { GrifballRuntimeState } from './runtimeState';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant } from '../../game/roster';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import { updateReplayCombatantVisualsForFrame } from './replayPlaybackVisuals';
import type { ReplayInterpolatedPlayer } from './replayHelpers';
import type { ReplayFile } from '../../types';

const ready = { activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, isCrouching: true };
const joints = (sample: ReturnType<typeof sampleV3GameplayAnimation>) => sample.pose.mesh2MotionDriverPose!.joints;
const hipY = (sample: ReturnType<typeof sampleV3GameplayAnimation>) => new THREE.Vector3(...joints(sample).pelvis.position).applyQuaternion(new THREE.Quaternion(...joints(sample).root.quaternion)).y;
function foot(sample: ReturnType<typeof sampleV3GameplayAnimation>, side: string) {
  const world = new THREE.Matrix4();
  for (const name of ['root', 'pelvis', `thigh_${side}`, `calf_${side}`, `foot_${side}`]) {
    const j = joints(sample)[name];
    world.multiply(new THREE.Matrix4().compose(new THREE.Vector3(...j.position), new THREE.Quaternion(...j.quaternion), new THREE.Vector3(1, 1, 1)));
  }
  return new THREE.Vector3().setFromMatrixPosition(world);
}

it('enters, holds indefinitely, switches all carried items, and rises only on release', () => {
  const model = new THREE.Group();
  const standing = hipY(sampleV3GameplayAnimation(model, { ...ready, isCrouching: false }, 0));
  const entry = sampleV3GameplayAnimation(model, ready, .3);
  assert.ok(hipY(entry) < standing && hipY(entry) > standing - .34);
  for (const activeWeapon of ['hammer', 'sword', 'pistol', 'ball', 'unarmed']) {
    const sample = sampleV3GameplayAnimation(model, { ...ready, activeWeapon }, 3);
    assert.equal(sample.clipId, activeWeapon === 'unarmed' ? 'clean_crouch' : `clean_crouch_${activeWeapon}`);
    assert.ok(hipY(sample) < standing - .3);
    assert.ok(model.userData.v3GameplayPlayback.crouch.frame >= 39 && model.userData.v3GameplayPlayback.crouch.frame <= 78);
  }
  const exit = sampleV3GameplayAnimation(model, { ...ready, isCrouching: false }, .2);
  assert.ok(hipY(exit) < standing);
  assert.equal(sampleV3GameplayAnimation(model, { ...ready, isCrouching: false }, 1).clipId, 'clean_hammer_carry');
});

it('reverses interrupted entry and recovery without restarting the pose', () => {
  const model = new THREE.Group();
  const entry = sampleV3GameplayAnimation(model, ready, .3);
  const reverse = sampleV3GameplayAnimation(model, { ...ready, isCrouching: false }, 0);
  assert.equal(hipY(entry), hipY(reverse));
  sampleV3GameplayAnimation(model, ready, 1);
  const exit = sampleV3GameplayAnimation(model, { ...ready, isCrouching: false }, .25);
  assert.equal(hipY(sampleV3GameplayAnimation(model, ready, 0)), hipY(exit));
});

it('keeps crouch-walking feet above the authored ground and preserves native bone lengths', () => {
  const model = new THREE.Group();
  sampleV3GameplayAnimation(model, ready, 1);
  let previous: THREE.Vector3 | undefined, distance = 0;
  const neutral = joints(sampleV3ProductionClip('clean_walk'));
  for (let i = 0; i < 100; i++) {
    const sample = sampleV3GameplayAnimation(model, { ...ready, velocityLength: 2 }, 1 / 60);
    assert.ok(hipY(sample) < .8);
    for (const side of ['l', 'r']) {
      assert.ok(foot(sample, side).y > -.02, `${side} foot ${foot(sample, side).y}`);
      for (const name of [`calf_${side}`, `foot_${side}`]) assert.deepEqual(joints(sample)[name].position, neutral[name].position);
    }
    const current = foot(sample, 'l');
    if (previous) distance += current.distanceTo(previous);
    previous = current;
  }
  assert.ok(distance > .3, 'feet must take steps');
});

it('crouched attacks keep their timers and both weapon contacts on the visible rig', () => {
  const refs = createInitialGrifballThreeRefs();
  const rig = createCombatantMeshRig(new THREE.Scene(), 192, false, { modelSystem: 'v3' });
  for (const [activeWeapon, weaponState, weaponTimer] of [['hammer', 'swing_down', .06], ['sword', 'slashing', .11], ['pistol', 'firing', .04]] as const) {
    rig.group.scale.y = .65;
    animateSpartanCombatantModel({ refs, mesh: rig.group, vel: new THREE.Vector3(2, 0, 0), yaw: 0, hp: 100, activeWeapon, weaponState, weaponTimer, isCrouching: true, crouchProgress: 1, dt: .1, isLocalV3Animation: true });
    animateCombatantWeaponMeshes({ hammerModel: rig.hammer, swordModel: rig.sword, pistolModel: rig.pistol, combatantModel: rig.group, activeWeapon, weaponState, weaponTimer, isLunging: false, dt: .1, settings: {} });
    assert.equal(rig.group.scale.y, 1);
    assert.ok(hipY(rig.group.userData.v3GameplaySample) < hipY(sampleV3ProductionClip(rig.group.userData.v3GameplaySample.clipId, { normalizedTime: rig.group.userData.v3GameplaySample.normalizedTime })) - .3);
    const hand = getV3Mesh2MotionDriverWeaponSocketWorldPosition(rig.group, 'rightHandGrip')!;
    const weapon = rig[activeWeapon]!;
    assert.ok(hand.distanceTo(getV3WeaponSocketWorldPosition(weapon, 'thirdPersonPrimaryGrip')!) < .015);
    if (activeWeapon !== 'sword') assert.ok(getV3Mesh2MotionDriverWeaponSocketWorldPosition(rig.group, 'leftHandGrip')!.distanceTo(getV3WeaponSocketWorldPosition(weapon, 'thirdPersonOffhandGrip')!) < .015);
  }
});

it('recorded posture is deterministic while paused and seeking backwards', () => {
  const model = new THREE.Group();
  const first = sampleV3GameplayAnimation(model, { ...ready, crouchProgress: .5 }, 0);
  sampleV3GameplayAnimation(model, { ...ready, crouchProgress: 1 }, 3);
  const seek = sampleV3GameplayAnimation(model, { ...ready, crouchProgress: .5 }, 0);
  assert.deepEqual(joints(first), joints(seek));
});

it('slide and sword lunge retain their authored leg poses over crouch', () => {
  const model = new THREE.Group();
  sampleV3GameplayAnimation(model, ready, 1);
  assert.equal(sampleV3GameplayAnimation(model, { ...ready, isSliding: true }, .1).clipId, 'clean_slide_hammer');
  assert.equal(sampleV3GameplayAnimation(new THREE.Group(), { ...ready, activeWeapon: 'sword', isLunging: true }, .1).clipId, 'clean_sword_lunge');
});

it('first-person crouching keeps carried weapons below the eye line', () => {
  for (const activeWeapon of ['hammer', 'sword', 'pistol']) {
    const pose = sampleV3GameplayFirstPersonWeaponPose({ ...ready, activeWeapon }, new THREE.Group(), 1);
    assert.ok(pose.position[1] < -.05 && pose.position[1] > -.8, `${activeWeapon}: ${pose.position[1]}`);
  }
});

it('held ball and throw follow-through use crouch while projectile transforms stay authoritative', () => {
  const refs = createInitialGrifballThreeRefs();
  refs.hostGroup = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(.32), new THREE.MeshStandardMaterial());
  const state = { grifball: { ball: { state: 'held', holderId: 'player' } }, otherPlayers: new Map(), playerPos: new THREE.Vector3(), playerVel: new THREE.Vector3(), yaw: 0, pWeaponState: 'ready', pWeaponTimer: 0, grifballPassCharge: 0, isCrouching: true, settings: {} } as unknown as GrifballRuntimeState;
  updateV3GameplayBall(state, refs, mesh, 1, 'v3');
  assert.equal(refs.hostGroup.userData.v3RunnerSample.clipId, 'clean_crouch_ball');
  state.grifballPassCharge = .8;
  updateV3GameplayBall(state, refs, mesh, .1, 'v3');
  state.grifball.ball.state = 'thrown'; state.grifball.ball.holderId = null;
  const position = mesh.position.clone();
  updateV3GameplayBall(state, refs, mesh, .1, 'v3');
  assert.deepEqual(mesh.position, position);
  const sample = refs.hostGroup.userData.v3RunnerSample;
  assert.equal(sample.clipId, 'clean_ball_throw');
  assert.ok(hipY(sample) < hipY(sampleV3ProductionClip('clean_ball_throw', { normalizedTime: sample.normalizedTime })) - .3);
});

it('the bot roster routes actual crouch input without mistaking crouch-walking for slide', () => {
  const state = createInitialGrifballRuntimeState({ debugMode: false, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, enableSlide: true }, multiplayerRole: null, isMultiplayer: false });
  const refs = createInitialGrifballThreeRefs();
  refs.scene = new THREE.Scene();
  const bot = createOfflineBotCombatant({ id: 'main_ai', playerName: 'Test', team: 'red', spawnPos: new THREE.Vector3(), yaw: 0, hue: 120, difficulty: 'normal', settings: state.settings });
  bot.isCrouching = true; bot.aiSlideActive = false; bot.vel.set(3, 0, 0);
  state.otherPlayers.set(bot.id, bot);
  const rig = createCombatantMeshRig(refs.scene, 120, false, { modelSystem: 'v3' });
  refs.otherPlayerMeshes.set(bot.id, rig);
  updateRosterCombatantVisualsForState({ refs, state, dt: 1, renderSwordLungeTrailVfx: () => {}, applyBotMeleeImpact: () => {} });
  assert.equal(rig.group.userData.v3GameplaySample.clipId, 'clean_crouch_hammer');
  assert.equal(rig.group.scale.y, 1);
});

it('replay visuals apply recorded crouch to V3 bodies without legacy squashing', () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const player: ReplayInterpolatedPlayer = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, crouchScaleY: .65, hp: 100, activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, isCrouching: true, isLunging: false, isDashing: false, isSprinting: false, isSliding: false, respawnTimer: 0, invulnerabilityTimer: 0, hue: 120, name: 'Test', score: 0, kills: 0, deaths: 0 };
  const replayData = { visualModelPolicy: 'v3' } as ReplayFile;
  const update = () => updateReplayCombatantVisualsForFrame({ refs, replayData, updatedPlayers: new Map([['player', player]]), targetId: 'free', observerCamMode: 'free', replayPlayerName: 'Test', dt: 0, animateSpartanModel: () => assert.fail('V3 must use recorded posture'), renderSwordLungeTrailVfx: () => {}, updateBlinking: () => {} });
  update();
  const group = refs.otherPlayerMeshes.get('player')!.group;
  assert.equal(group.scale.y, 1);
  assert.equal(group.userData.v3GameplaySample.clipId, 'clean_crouch_hammer');
  player.crouchScaleY = 1; player.isCrouching = false;
  update();
  assert.equal(group.userData.v3GameplaySample.clipId, 'clean_hammer_carry');
});
