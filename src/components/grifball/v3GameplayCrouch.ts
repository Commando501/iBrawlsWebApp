import * as THREE from 'three';
import { sampleV3ProductionClip, type V3AuthoredAnimationSample, type V3AuthoredClipId } from './v3AuthoredAnimationClips';

type Joints = NonNullable<V3AuthoredAnimationSample['pose']['mesh2MotionDriverPose']>['joints'];
const torso = ['root', 'pelvis', 'spine_01', 'spine_02', 'spine_03'];
const matrix = (joint: Joints[string]) => new THREE.Matrix4().compose(
  new THREE.Vector3(...joint.position), new THREE.Quaternion(...joint.quaternion), new THREE.Vector3(1, 1, 1));
const chain = (joints: Joints, names: string[]) => names.reduce((world, name) => world.multiply(matrix(joints[name])), new THREE.Matrix4());
const position = (world: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(world);
const rotation = (world: THREE.Matrix4) => new THREE.Quaternion().setFromRotationMatrix(world).normalize();

export function v3CrouchClip(weapon: string): V3AuthoredClipId {
  return weapon === 'hammer' || weapon === 'sword' || weapon === 'pistol' || weapon === 'ball'
    ? `clean_crouch_${weapon}` : 'clean_crouch';
}

export interface V3CrouchPlayback {
  frame: number;
  stage: 'entry' | 'hold' | 'exit';
}

/** Reverse an interrupted transition in place; never restart a held crouch. */
export function advanceV3Crouch(state: V3CrouchPlayback, held: boolean, dt: number): number {
  const frames = dt * 60;
  if (held) {
    if (state.stage === 'entry') {
      state.frame = Math.min(39, state.frame + frames);
      if (state.frame === 39) state.stage = 'hold';
    } else if (state.stage === 'exit') {
      state.frame = Math.max(78, state.frame - frames);
      if (state.frame === 78) { state.stage = 'hold'; state.frame = 39; }
    } else state.frame = 39 + ((state.frame - 39 + frames) % 39);
  } else if (state.stage === 'entry') {
    state.frame = Math.max(0, state.frame - frames);
  } else {
    if (state.stage === 'hold') { state.stage = 'exit'; state.frame = 78; }
    state.frame = Math.min(120, state.frame + frames);
    if (state.frame === 120) { state.stage = 'entry'; state.frame = 0; }
  }
  return state.frame;
}

export function getV3CrouchEyeOffset(sample: V3AuthoredAnimationSample): number {
  const joints = sample.pose.mesh2MotionDriverPose?.joints;
  const standing = sampleV3ProductionClip('clean_idle', { frame: 0 }).pose.mesh2MotionDriverPose?.joints;
  if (!joints || !standing) return 0;
  const head = [...torso, 'neck_01', 'head'];
  return position(chain(joints, head)).y - position(chain(standing, head)).y;
}

/** Re-solve the native legs to authored foot targets at the lowered hip height.
 * Copying standing thigh rotations into a crouch would drive the boots below
 * the floor. Rotations only: the skeleton's bone lengths never change.
 */
export function fitV3CrouchFeet(joints: Joints, targets: Joints, weight = 1, strideScale = 1): void {
  for (const side of ['l', 'r']) {
    const thigh = `thigh_${side}`, calf = `calf_${side}`, foot = `foot_${side}`;
    const pelvisWorld = chain(joints, ['root', 'pelvis']);
    const hipWorld = pelvisWorld.clone().multiply(matrix(joints[thigh]));
    const kneeWorld = hipWorld.clone().multiply(matrix(joints[calf]));
    const ankleWorld = kneeWorld.clone().multiply(matrix(joints[foot]));
    const targetWorld = chain(targets, ['root', 'pelvis', thigh, calf, foot]);
    const hip = position(hipWorld), knee = position(kneeWorld), ankle = position(ankleWorld);
    const target = position(targetWorld);
    target.x = THREE.MathUtils.lerp(ankle.x, target.x, strideScale);
    target.z = THREE.MathUtils.lerp(ankle.z, target.z, strideScale);
    target.lerpVectors(ankle, target, weight);
    const upperLength = new THREE.Vector3(...joints[calf].position).length();
    const lowerLength = new THREE.Vector3(...joints[foot].position).length();
    const axis = target.clone().sub(hip).normalize();
    const distance = THREE.MathUtils.clamp(hip.distanceTo(target), Math.abs(upperLength - lowerLength) + .00001, upperLength + lowerLength - .00001);
    const bend = knee.clone().sub(hip).addScaledVector(axis, -knee.clone().sub(hip).dot(axis));
    if (bend.lengthSq() < .000001) {
      bend.set(side === 'l' ? -.1 : .1, 0, -1).addScaledVector(axis, -bend.dot(axis));
    }
    bend.normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
    const solvedKnee = hip.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    const solvedAnkle = hip.clone().addScaledVector(axis, distance);
    const hipRotation = new THREE.Quaternion().setFromUnitVectors(knee.clone().sub(hip).normalize(), solvedKnee.clone().sub(hip).normalize()).multiply(rotation(hipWorld));
    const kneeRotation = new THREE.Quaternion().setFromUnitVectors(ankle.clone().sub(knee).normalize(), solvedAnkle.clone().sub(solvedKnee).normalize()).multiply(rotation(kneeWorld));
    joints[thigh].quaternion = rotation(pelvisWorld).invert().multiply(hipRotation).normalize().toArray();
    joints[calf].quaternion = hipRotation.clone().invert().multiply(kneeRotation).normalize().toArray();
    joints[foot].quaternion = kneeRotation.clone().invert().multiply(rotation(ankleWorld).slerp(rotation(targetWorld), weight)).normalize().toArray();
  }
}

/** Layer the Blender crouch onto an attack and transform the prop with the
 * chest, preserving both grips and the attack's original timer/release marker.
 */
export function applyV3CrouchToAction(sample: V3AuthoredAnimationSample, crouch: V3AuthoredAnimationSample): void {
  const joints = sample.pose.mesh2MotionDriverPose?.joints;
  const lowered = crouch.pose.mesh2MotionDriverPose?.joints;
  const neutral = sampleV3ProductionClip(crouch.clipId, { frame: 0 }).pose.mesh2MotionDriverPose?.joints;
  if (!joints || !lowered || !neutral) return;
  const before = chain(joints, torso);
  const feet = structuredClone(joints);
  joints.pelvis.position = new THREE.Vector3(...joints.pelvis.position)
    .add(new THREE.Vector3(...lowered.pelvis.position).sub(new THREE.Vector3(...neutral.pelvis.position))).toArray();
  for (const name of ['pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01']) {
    const delta = new THREE.Quaternion(...lowered[name].quaternion).multiply(new THREE.Quaternion(...neutral[name].quaternion).invert());
    joints[name].quaternion = delta.multiply(new THREE.Quaternion(...joints[name].quaternion)).normalize().toArray();
  }
  const transform = chain(joints, torso).multiply(before.invert());
  for (const prop of [sample.weaponPose, sample.pose.ballPose]) {
    if (!prop) continue;
    const q = 'weapon' in prop ? prop.modelSpaceQuaternion : prop.quaternion;
    if (!q) continue;
    prop.position = new THREE.Vector3(...prop.position).applyMatrix4(transform).toArray();
    const quaternion = rotation(transform).multiply(new THREE.Quaternion(...q)).normalize();
    if ('weapon' in prop) {
      prop.modelSpaceQuaternion = quaternion.toArray();
      const euler = new THREE.Euler().setFromQuaternion(quaternion);
      prop.rotation = [euler.x, euler.y, euler.z];
    } else {
      prop.quaternion = quaternion.toArray();
      if (prop.releaseVelocity) prop.releaseVelocity = new THREE.Vector3(...prop.releaseVelocity).applyQuaternion(rotation(transform)).toArray();
    }
  }
  fitV3CrouchFeet(joints, feet);
}
