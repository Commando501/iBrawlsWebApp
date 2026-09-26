import * as THREE from 'three';
import type { UniversalSettings } from '../../types';
import { resolveHammerSlamTiming } from '../../game/hammerSlamTiming';
import { mapV3RuntimeStateToAuthoredClip, sampleV3ProductionClip, type V3AuthoredClipId } from './v3AuthoredAnimationClips';
import { V3_BLENDER_ANIMATIONS } from './v3BlenderAnimationClips.generated';
import { advanceV3Crouch, applyV3CrouchToAction, fitV3CrouchFeet, getV3CrouchEyeOffset, v3CrouchClip, type V3CrouchPlayback } from './v3GameplayCrouch';

export interface V3GameplayAnimationInput {
  activeWeapon: string;
  weaponState: string;
  weaponTimer: number;
  settings?: Partial<UniversalSettings>;
  isLunging?: boolean;
  isSliding?: boolean;
  isSprinting?: boolean;
  isCrouching?: boolean;
  /** Recorded posture, for deterministic replay seeking. */
  crouchProgress?: number;
  velocityLength?: number;
  eyeHeight?: number;
}

const clamp = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
const progress = (time: number, duration: number) => clamp(time / Math.max(.001, duration));

/** Combat timers are elapsed seconds, not normalized clip positions. */
export function resolveV3GameplayAction(input: V3GameplayAnimationInput): { clipId: V3AuthoredClipId; time?: number } {
  const { activeWeapon: weapon, weaponTimer: t, settings: s = {} } = input;
  const state = input.weaponState.toLowerCase();
  const clipId = mapV3RuntimeStateToAuthoredClip(input);
  const hammer = resolveHammerSlamTiming(s);
  if (weapon === 'hammer') {
    if (state === 'swing_up') return { clipId, time: progress(t, hammer.windupTime) };
    if (state === 'swing_down') return { clipId, time: progress(t, hammer.attackTime) };
    if (state === 'recovering') return { clipId, time: progress(t, s.hammerReloadTime ?? .6) };
    if (state === 'melee_swing') return { clipId: 'clean_hammer_melee', time: progress(t, s.hammerMeleeSpeed ?? .24) };
    if (state === 'melee_up') return { clipId: 'clean_hammer_melee', time: .35 * progress(t, s.hammerMeleeSpeed ? s.hammerMeleeSpeed * .4 : .1) };
    if (state === 'melee_down') return { clipId: 'clean_hammer_melee', time: .35 + .65 * progress(t, s.hammerMeleeSpeed ? s.hammerMeleeSpeed * .6 : .14) };
    if (state === 'melee_recover') return { clipId, time: progress(t, s.hammerMeleeReload ?? .5) };
  }
  if (weapon === 'sword') {
    if (input.isLunging) return { clipId: 'clean_sword_lunge', time: progress(t, .3) * 33 / V3_BLENDER_ANIMATIONS.clips.clean_sword_lunge.durationFrames };
    if (state === 'swing_up') return { clipId: 'clean_sword_slash', time: .5 * progress(t, (s.swordSlashSpeed ?? .22) * .5) };
    if (state === 'swing_down') return { clipId: 'clean_sword_slash', time: .5 + .5 * progress(t, (s.swordSlashSpeed ?? .22) * .5) };
    if (state === 'slashing') return { clipId, time: progress(t, s.swordSlashSpeed ?? .22) };
    if (state === 'recovering') return { clipId, time: progress(t, s.swordSlashReload ?? .6) };
  }
  if (weapon === 'pistol') {
    if (['firing', 'fire', 'shooting'].includes(state)) return { clipId: 'clean_pistol_fire', time: .4 * progress(t, .08) };
    if (state === 'recovering') return { clipId: 'clean_pistol_fire', time: .4 + .6 * progress(t, .15) };
  }
  if (weapon === 'ball') {
    const hit = 26 / 72;
    if (state === 'swing_up' || state === 'melee_up') return { clipId: 'clean_ball_punch', time: hit * .35 * progress(t, s.hammerMeleeSpeed ?? .24) };
    if (state === 'swing_down' || state === 'melee_down') return { clipId: 'clean_ball_punch', time: hit * (.35 + .65 * progress(t, Math.max(.03, (s.hammerMeleeSpeed ?? .24) * .5))) };
    if (['melee_swing', 'punch', 'punching'].includes(state)) return { clipId: 'clean_ball_punch', time: hit * progress(t, s.hammerMeleeSpeed ?? .24) };
    if (state === 'recovering' || state === 'melee_recover') return { clipId: 'clean_ball_punch', time: hit + (1 - hit) * progress(t, s.grifballPunchCooldown ?? .5) };
    if (state === 'throwing' || state === 'throw') return { clipId: 'clean_ball_throw', time: progress(t, 1.5) };
  }
  return { clipId };
}

interface Playback {
  elapsed: number;
  sliding: boolean;
  slideTime: number;
  lunging: boolean;
  lungeTime: number;
  lungeExit: number;
  weapon: string;
  locomotionPhase?: number;
  locomotionWeight?: number;
  crouch?: V3CrouchPlayback;
}

/** One clock per character. Slide and lunge recovery outlive the physics flags. */
export function sampleV3GameplayAnimation(model: THREE.Object3D, input: V3GameplayAnimationInput, dt: number) {
  const step = Math.max(0, Number.isFinite(dt) ? dt : 0);
  const old = model.userData.v3GameplayPlayback as Playback | undefined;
  const p: Playback = old ?? { elapsed: 0, sliding: false, slideTime: 0, lunging: false, lungeTime: 0, lungeExit: -1, weapon: input.activeWeapon };
  if (p.weapon !== input.activeWeapon) { p.lungeExit = -1; p.lunging = false; p.weapon = input.activeWeapon; }
  p.elapsed += step;
  const speed = Math.max(0, input.velocityLength ?? 0);
  // One cycle contains two steps. Match cadence to distance travelled instead
  // of replaying a 1.5-second preview loop at every possible gameplay speed.
  const running = !input.isCrouching && !p.crouch?.frame && (input.isSprinting || speed > 4);
  p.locomotionPhase = ((p.locomotionPhase ?? 0) + step * speed / (running ? 2.8 : 1.6)) % 1;
  const action = resolveV3GameplayAction({ ...input, isSprinting: running });
  let clipId = action.clipId;
  let time = action.time;
  if (input.isSliding) {
    p.slideTime = p.sliding ? Math.min(48 / 60, p.slideTime + step) : 0;
  } else if (p.sliding) {
    p.slideTime = 48 / 60;
  } else if (p.slideTime > 0) p.slideTime = Math.min(84 / 60, p.slideTime + step);
  p.sliding = !!input.isSliding;
  if (input.isSliding || (p.slideTime > 0 && p.slideTime < 84 / 60 && action.time === undefined)) {
    clipId = mapV3RuntimeStateToAuthoredClip({ ...input, isSliding: true });
    time = p.slideTime / (84 / 60);
  }
  if (input.activeWeapon === 'sword' && !input.isSliding) {
    if (input.isLunging) {
      p.lungeTime = p.lunging ? p.lungeTime + step : 0;
      p.lungeExit = -1;
      clipId = 'clean_sword_lunge';
      time = Math.min(33, p.lungeTime * 110) / V3_BLENDER_ANIMATIONS.clips[clipId].durationFrames;
    } else if (p.lunging) p.lungeExit = 0;
    else if (p.lungeExit >= 0) p.lungeExit += step;
    // Contact/end of travel starts the lateral cut, followed by the baked return.
    if (!input.isLunging && p.lungeExit >= 0 && p.lungeExit < .6 && ['ready', 'recovering'].includes(input.weaponState)) {
      clipId = 'clean_sword_lunge';
      const frames = V3_BLENDER_ANIMATIONS.clips[clipId].durationFrames;
      time = (33 + (frames - 33) * progress(p.lungeExit, .6)) / frames;
    }
  }
  p.lunging = !!input.isLunging;
  const clip = V3_BLENDER_ANIMATIONS.clips[clipId];
  time ??= clip?.loop ? (p.elapsed % (clip.durationFrames / 60)) / (clip.durationFrames / 60) : 0;
  if (/^clean_(ball_)?(walk|sprint)$/.test(clipId)) time = p.locomotionPhase;
  let sample = sampleV3ProductionClip(clipId, { normalizedTime: time });
  // Keep the authored upper body and both grip contacts intact while moving.
  // Only leg-local transforms are replaced; pelvis/chest/weapon share one pose.
  const planted = clipId.startsWith('clean_slide') || clipId === 'clean_sword_lunge';
  p.crouch ??= { frame: 0, stage: 'entry' };
  const crouchFrame = planted ? 0 : input.crouchProgress !== undefined
    ? 39 * clamp(input.crouchProgress)
    : advanceV3Crouch(p.crouch, !!input.isCrouching, step);
  if (planted) p.crouch = { frame: 0, stage: 'entry' };
  model.userData.v3CrouchEyeOffset = 0;
  if (crouchFrame > 0) {
    const crouch = sampleV3ProductionClip(v3CrouchClip(input.activeWeapon), { frame: crouchFrame });
    model.userData.v3CrouchEyeOffset = getV3CrouchEyeOffset(crouch);
    if (action.time === undefined) sample = crouch;
    else applyV3CrouchToAction(sample, crouch);
  }
  const moveWeight = speed > .1 && !planted ? 1 : 0;
  p.locomotionWeight = planted ? 0 : THREE.MathUtils.lerp(p.locomotionWeight ?? 0, moveWeight, 1 - Math.exp(-step * 18));
  if (p.locomotionWeight > .001 && !planted) {
    const locomotionId = running ? 'clean_sprint' : 'clean_walk';
    const locomotion = sampleV3ProductionClip(locomotionId, { normalizedTime: p.locomotionPhase });
    const joints = sample.pose.mesh2MotionDriverPose?.joints;
    const legs = locomotion.pose.mesh2MotionDriverPose?.joints;
    if (joints && legs && crouchFrame > 0) fitV3CrouchFeet(joints, legs, p.locomotionWeight, .65);
    else if (joints && legs) for (const name of Object.keys(legs)) {
      if (/^(thigh|calf|foot|ball|toe)_/.test(name) && joints[name]) {
        joints[name] = {
          position: new THREE.Vector3(...joints[name].position).lerp(new THREE.Vector3(...legs[name].position), p.locomotionWeight).toArray(),
          quaternion: new THREE.Quaternion(...joints[name].quaternion).slerp(new THREE.Quaternion(...legs[name].quaternion), p.locomotionWeight).normalize().toArray(),
        };
      }
    }
    model.userData.v3GameplayLocomotion = locomotionId;
  } else delete model.userData.v3GameplayLocomotion;
  model.userData.v3GameplayPlayback = p;
  model.userData.v3GameplaySample = sample;
  return sample;
}

/** Project the same baked weapon track into the camera's eye-height space. */
export function sampleV3GameplayFirstPersonWeaponPose(input: V3GameplayAnimationInput, model?: THREE.Object3D, dt = 0) {
  const action = resolveV3GameplayAction(input);
  const sample = model ? sampleV3GameplayAnimation(model, input, dt) : sampleV3ProductionClip(action.clipId, { normalizedTime: action.time ?? 0 });
  const pose = sample.weaponPose;
  const eyeHeight = (input.eyeHeight ?? 1.65) + (model?.userData.v3CrouchEyeOffset ?? 0);
  return pose ? { position: [pose.position[0], pose.position[1] - eyeHeight, pose.position[2]] as THREE.Vector3Tuple, rotation: pose.rotation } : { position: [.3, -.4, -.5] as THREE.Vector3Tuple, rotation: [0, 0, 0] as THREE.Vector3Tuple };
}

/** Add the authored torso flinch in chest space, moving both grips together. */
export function applyV3GameplayHitReact(sample: ReturnType<typeof sampleV3ProductionClip>, time: number): void {
  const joints = sample.pose.mesh2MotionDriverPose?.joints;
  if (!joints) return;
  const hit = sampleV3ProductionClip('clean_hit_react', { normalizedTime: time }).pose.mesh2MotionDriverPose?.joints;
  const idle = sampleV3ProductionClip('clean_idle', { normalizedTime: 0 }).pose.mesh2MotionDriverPose?.joints;
  if (!hit || !idle) return;
  const before = new THREE.Matrix4();
  const matrix = (j: typeof joints[string]) => new THREE.Matrix4().compose(new THREE.Vector3(...j.position), new THREE.Quaternion(...j.quaternion), new THREE.Vector3(1, 1, 1));
  for (const name of ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03']) before.multiply(matrix(joints[name]));
  const base = joints.spine_03;
  const delta = new THREE.Quaternion(...idle.spine_03.quaternion).invert().multiply(new THREE.Quaternion(...hit.spine_03.quaternion));
  base.quaternion = new THREE.Quaternion(...base.quaternion).multiply(delta).toArray();
  const transform = before.clone().multiply(new THREE.Matrix4().makeRotationFromQuaternion(delta)).multiply(before.clone().invert());
  for (const prop of [sample.weaponPose, sample.pose.ballPose]) {
    if (!prop) continue;
    const q = 'modelSpaceQuaternion' in prop ? prop.modelSpaceQuaternion : 'quaternion' in prop ? prop.quaternion : undefined;
    if (!q) continue;
    const p = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    transform.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...prop.position), new THREE.Quaternion(...q), new THREE.Vector3(1, 1, 1))).decompose(p, rotation, scale);
    prop.position = p.toArray();
    if ('weapon' in prop) {
      prop.modelSpaceQuaternion = rotation.toArray();
      const e = new THREE.Euler().setFromQuaternion(rotation);
      prop.rotation = [e.x, e.y, e.z];
    } else prop.quaternion = rotation.toArray();
  }
}
