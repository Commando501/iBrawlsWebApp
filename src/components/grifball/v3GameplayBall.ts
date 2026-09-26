import * as THREE from 'three';
import type { GrifballRuntimeState } from './runtimeState';
import type { GrifballThreeRefs } from './threeRefs';
import { buildV3SkullBombModel } from '../v3/v3SkullBombModel';
import { sampleV3GameplayAnimation } from './v3GameplayAnimation';

/** Visual-only bridge. Possession, release, damage and projectile physics stay authoritative. */
export function updateV3GameplayBall(state: GrifballRuntimeState, refs: GrifballThreeRefs, mesh: THREE.Mesh, dt: number, localModelSystem: unknown): boolean {
  const ball = state.grifball.ball;
  const holderId = ball.state === 'held' ? ball.holderId : null;
  const bodyFor = (id: string | null) => id === 'player' ? refs.hostGroup : id ? refs.otherPlayerMeshes.get(id)?.group : undefined;
  const previous = mesh.userData.v3BallHolder as string | undefined;
  if (previous && previous !== holderId) {
    const oldBody = bodyFor(previous);
    if (oldBody) {
      delete oldBody.userData.v3RunnerSample;
      oldBody.userData.v3GameplayPlayback = mesh.userData.v3GameplayPlayback;
    }
    if (mesh.userData.v3BallCharging) {
      const clock = new THREE.Object3D();
      clock.userData.v3GameplayPlayback = mesh.userData.v3GameplayPlayback;
      mesh.userData.v3ThrowFollowThrough = { id: previous, time: .5, clock };
    }
    delete mesh.userData.v3GameplayPlayback;
  }
  const follow = mesh.userData.v3ThrowFollowThrough as { id: string; time: number; clock: THREE.Object3D } | undefined;
  if (follow) {
    follow.time += Math.max(0, dt) / 1.5;
    const oldBody = bodyFor(follow.id);
    if (oldBody) oldBody.userData.v3RunnerSample = follow.time < 1
      ? sampleV3GameplayAnimation(follow.clock, {
        activeWeapon: 'ball', weaponState: 'throwing', weaponTimer: follow.time * 1.5,
        isCrouching: follow.id === 'player' ? state.isCrouching : state.otherPlayers.get(follow.id)?.isCrouching,
      }, dt) : undefined;
    if (follow.time >= 1) delete mesh.userData.v3ThrowFollowThrough;
  }
  const body = bodyFor(holderId);
  if (holderId && holderId !== previous && body?.userData.v3GameplayPlayback) {
    mesh.userData.v3GameplayPlayback = structuredClone(body.userData.v3GameplayPlayback);
  }
  const v3 = holderId === 'player' ? localModelSystem === 'v3' : holderId ? body?.userData.modelSystem === 'v3' : localModelSystem === 'v3';
  let skull = mesh.getObjectByName('v3SkullBomb');
  if (v3 && !skull) { skull = buildV3SkullBombModel(); mesh.add(skull); }
  if (skull) skull.visible = v3;
  const material = mesh.material as THREE.MeshStandardMaterial;
  material.visible = !v3;
  mesh.userData.v3BallHolder = holderId;
  if (!v3 || !holderId) { mesh.userData.v3BallCharging = false; return false; }
  const local = holderId === 'player';
  const bot = local ? undefined : state.otherPlayers.get(holderId);
  const charge = local ? state.grifballPassCharge : bot?.grifballPassCharge ?? 0;
  mesh.userData.v3BallCharging = charge > 0;
  const vel = local ? state.playerVel : bot?.vel;
  const speed = vel ? Math.hypot(vel.x, vel.z) : 0;
  const sample = sampleV3GameplayAnimation(mesh, {
      activeWeapon: 'ball', weaponState: charge > 0 ? 'throwing' : local ? state.pWeaponState : bot?.weaponState ?? 'ready',
      weaponTimer: charge > 0 ? Math.min(.75, charge * .75) : local ? state.pWeaponTimer : bot?.weaponTimer ?? 0,
      velocityLength: speed, isSprinting: speed > 5.5,
      isSliding: local ? state.playerSlideActive : bot?.aiSlideActive,
      isCrouching: local ? state.isCrouching : bot?.isCrouching,
      settings: state.settings,
    }, dt);
  if (body) {
    body.userData.v3RunnerSample = sample;
    body.userData.v3GameplayPlayback = structuredClone(mesh.userData.v3GameplayPlayback);
  }
  const pose = sample.pose.ballPose;
  if (!pose) return false;
  const pos = local ? state.playerPos : bot?.pos;
  if (!pos) return false;
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), local ? state.yaw : bot?.yaw ?? 0);
  mesh.position.copy(new THREE.Vector3(...pose.position).applyQuaternion(rotation).add(pos));
  mesh.quaternion.copy(rotation.multiply(new THREE.Quaternion(...pose.quaternion)));
  return true;
}
