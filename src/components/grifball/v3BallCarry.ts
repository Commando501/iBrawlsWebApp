import * as THREE from 'three';
import type { V3CleanRigPose } from './v3CleanRig';
import { buildV3SkullBombModel } from '../v3/v3SkullBombModel';
import { V3_SKULL_BOMB } from '../v3/v3SkullBomb.generated';

/** Main bomb casing radius; gameplay collision remains separately owned. */
export const V3_BALL_RADIUS = .205 * .5;
export const V3_BALL_CONTACTS = { right: V3_SKULL_BOMB.grip } as const;

/** V3 runner prop; no gameplay physics. */
export function buildV3CarriedBallModel(): THREE.Group {
  const group = buildV3SkullBombModel();
  group.position.set(.29, 1.0315, -.3875);
  group.visible = false;
  return group;
}

/** Works with either a preview ball or the existing scene-level objective mesh. */
export function applyV3BallCarryPose(model: THREE.Object3D, ball: THREE.Object3D, pose: V3CleanRigPose, previewFlight = false): boolean {
  if (!pose.ballPose || !ball.parent) return false;
  ball.userData.v3BallReleased = pose.ballPose.released === true;
  if (pose.ballPose.released && !previewFlight) return false;
  model.updateWorldMatrix(true, false);
  ball.parent.updateWorldMatrix(true, false);
  const matrix = ball.parent.matrixWorld.clone().invert().multiply(model.matrixWorld).multiply(
    new THREE.Matrix4().compose(new THREE.Vector3(...pose.ballPose.position), new THREE.Quaternion(...pose.ballPose.quaternion), new THREE.Vector3(1, 1, 1))
  );
  matrix.decompose(ball.position, ball.quaternion, ball.scale);
  ball.updateMatrixWorld(true);
  return true;
}
