import * as THREE from 'three';
import { V3_BLENDER_ANIMATIONS } from './v3BlenderAnimationClips.generated';
import type { V3BlenderTransformTrack } from './v3BlenderAnimationTypes';
import type { V3CleanRigPose, V3CleanRigWeaponPose, V3QuatTuple, V3Vec3Tuple } from './v3CleanRig';

const sampleTransform = (track: V3BlenderTransformTrack, frame: number) => {
  const previous = Math.floor(frame), next = Math.ceil(frame), amount = frame - previous;
  const p0 = track.positions[Math.min(previous, track.positions.length - 1)];
  const p1 = track.positions[Math.min(next, track.positions.length - 1)];
  const q0 = track.quaternions[Math.min(previous, track.quaternions.length - 1)];
  const q1 = track.quaternions[Math.min(next, track.quaternions.length - 1)];
  const q = new THREE.Quaternion().fromArray(q0).normalize().slerp(new THREE.Quaternion().fromArray(q1).normalize(), amount);
  return {
    position: p0.map((value, index) => value + (p1[index] - value) * amount) as V3Vec3Tuple,
    quaternion: q.toArray() as V3QuatTuple,
  };
};

export function sampleV3BlenderAnimation(clipId: string, normalizedTime: number): V3CleanRigPose | null {
  const clip = V3_BLENDER_ANIMATIONS.clips[clipId];
  if (!clip) return null;
  const time = Number.isFinite(normalizedTime) ? Math.max(0, Math.min(1, normalizedTime)) : 0;
  const frame = time * clip.durationFrames;
  let weaponPose: V3CleanRigWeaponPose | undefined;
  if (clip.weapon && clip.weapon !== 'ball' && clip.weaponTrack) {
    const weapon = sampleTransform(clip.weaponTrack, frame);
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(weapon.quaternion));
    weaponPose = {
      weapon: clip.weapon, position: weapon.position,
      rotation: [euler.x, euler.y, euler.z], source: 'authoredCleanClip',
      modelSpaceQuaternion: weapon.quaternion,
      ...(clip.offhandPositions ? { modelSpaceOffhandSocket: sampleTransform({
        positions: clip.offhandPositions, quaternions: [[0, 0, 0, 1]],
      }, frame).position } : {}),
    };
  }
  return {
    clipId, animationAuthority: 'cleanRig', normalizedTime: time, jointQuaternions: {},
    mesh2MotionDriverPose: {
      sourceClipName: clipId, sourceNormalizedTime: time, bakedCalibration: true,
      joints: Object.fromEntries(Object.entries(clip.joints).map(([name, track]) => [name, sampleTransform(track, frame)])),
    },
    ...(weaponPose ? { weaponPose } : {}),
    ...(clip.weapon === 'ball' && clip.weaponTrack ? { ballPose: {
      ...sampleTransform(clip.weaponTrack, frame),
      ...(clip.releaseFrame !== undefined ? {
        released: frame >= clip.releaseFrame,
        releaseVelocity: sampleTransform(clip.weaponTrack, clip.releaseFrame).position.map((value, i) =>
          (value - sampleTransform(clip.weaponTrack!, clip.releaseFrame! - 1).position[i]) * 60) as V3Vec3Tuple,
      } : {}),
    } } : {}),
  };
}

const gripRotations = new Map<string, THREE.Quaternion>();

/** Carry the active weapon on the moving hand during walk/sprint/slide. */
export function getV3BlenderWeaponGripRotation(weapon: 'hammer' | 'sword' | 'pistol'): THREE.Quaternion {
  const cached = gripRotations.get(weapon);
  if (cached) return cached.clone();
  const clip = V3_BLENDER_ANIMATIONS.clips[`clean_${weapon}_carry`];
  const hand = new THREE.Quaternion();
  for (const name of ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03', 'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r']) {
    hand.multiply(new THREE.Quaternion().fromArray(clip.joints[name].quaternions[0]).normalize());
  }
  const relative = hand.invert().multiply(new THREE.Quaternion().fromArray(clip.weaponTrack!.quaternions[0]).normalize());
  gripRotations.set(weapon, relative);
  return relative.clone();
}
