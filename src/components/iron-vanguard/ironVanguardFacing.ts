import * as THREE from "three";
import { worldPositionFromMatrix, worldQuaternionFromMatrix } from "./ironVanguardWorldPose";
import {
  solveLimb,
  type VanguardMovementInput,
  type VanguardMovementState,
} from "./ironVanguardMovement";

type Foot = { position: THREE.Vector3; rotation: THREE.Quaternion };
export interface VanguardFacingState {
  bodyYaw?: number;
  aimYaw?: number;
  lastRoot?: THREE.Vector3;
  feet?: Foot[];
  nextFoot?: number;
  turn?: {
    from: number;
    to: number;
    time: number;
    first: number;
    feet: Foot[];
    goals: Foot[];
  };
}
const up = new THREE.Vector3(0, 1, 0);
const angleDelta = (to: number, from: number) =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from));
const finite = (value: number | undefined) =>
  Number.isFinite(value) ? value! : 0;
const TURN_DURATION = 0.48;
const MAX_TWIST = Math.PI / 3;

/** Visual heading only: authoritative actor yaw, velocity and combat clocks are untouched. */
export function updateVanguardFacing(
  root: THREE.Group,
  movement: VanguardMovementState,
  input: VanguardMovementInput,
): number {
  const state = movement.facing;
  const yaw = finite(input.yaw);
  const dt = THREE.MathUtils.clamp(finite(input.dt), 0, 0.1);
  const position = root.getWorldPosition(new THREE.Vector3());
  const speed = Math.hypot(input.vel?.x ?? 0, input.vel?.z ?? 0);
  const reset =
    state.bodyYaw === undefined ||
    input.previewClip ||
    (input.hp ?? 100) <= 0 ||
    (state.lastRoot && state.lastRoot.distanceTo(position) > 1);
  if (reset) {
    state.bodyYaw = yaw;
    state.aimYaw = 0;
    state.turn = undefined;
    state.feet = undefined;
  }
  state.lastRoot = position.clone();
  const airborne =
    input.isJumping ??
    (Math.abs(input.vel?.y ?? 0) > 0.15 || movement.airborne);
  const slide =
    !!input.isSliding ||
    (movement.clip.startsWith("slide") && movement.slideWeight > 0.01);
  if (input.previewClip || (input.hp ?? 100) <= 0) return state.bodyYaw!;
  if (slide || speed > 0.15 || airborne) {
    state.turn = undefined;
    state.feet = undefined;
    let target = yaw;
    if (slide) {
      const travelYaw =
        speed > 0.15
          ? Math.atan2(-input.vel!.x, -input.vel!.z)
          : state.bodyYaw!;
      // Gather into facing-relative locomotion as the pelvis rises.
      const weight = input.isSliding ? 1 : movement.slideWeight;
      target = travelYaw + angleDelta(yaw, travelYaw) * (1 - weight);
    }
    state.bodyYaw! += THREE.MathUtils.clamp(
      angleDelta(target, state.bodyYaw!),
      -8 * dt,
      8 * dt,
    );
  } else {
    if (
      !state.turn &&
      state.feet &&
      ["idle", "crouch"].includes(movement.clip) &&
      movement.transition >= 1 &&
      Math.abs(angleDelta(yaw, state.bodyYaw!)) > Math.PI / 5
    ) {
      const change = THREE.MathUtils.clamp(
        angleDelta(yaw, state.bodyYaw!),
        -MAX_TWIST,
        MAX_TWIST,
      );
      const rotation = new THREE.Quaternion().setFromAxisAngle(up, change);
      const feet = state.feet.map((f) => ({
        position: f.position.clone(),
        rotation: f.rotation.clone(),
      }));
      state.turn = {
        from: state.bodyYaw!,
        to: state.bodyYaw! + change,
        time: 0,
        first: state.nextFoot ?? (change > 0 ? 0 : 1),
        feet,
        goals: feet.map((f) => ({
          position: f.position
            .clone()
            .sub(position)
            .applyQuaternion(rotation)
            .add(position),
          rotation: f.rotation.clone().premultiply(rotation),
        })),
      };
      state.nextFoot = 1 - state.turn.first;
    }
    if (state.turn) {
      state.turn.time = Math.min(TURN_DURATION, state.turn.time + dt);
      const t = THREE.MathUtils.smoothstep(
        state.turn.time / TURN_DURATION,
        0,
        1,
      );
      state.bodyYaw = THREE.MathUtils.lerp(state.turn.from, state.turn.to, t);
    }
  }
  // At the rear, exchange sides through a bounded turn instead of winding the spine.
  const desiredAim = THREE.MathUtils.clamp(
    angleDelta(yaw, state.bodyYaw!),
    -Math.PI / 2,
    Math.PI / 2,
  );
  const previous = state.aimYaw ?? 0;
  state.aimYaw =
    dt > 0
      ? previous + THREE.MathUtils.clamp(desiredAim - previous, -6 * dt, 6 * dt)
      : desiredAim;
  root.userData.ironVanguardBodyYaw = state.bodyYaw;
  root.userData.ironVanguardTurnStep = !!state.turn;
  return state.bodyYaw!;
}

/** One boot supports each half-step; the other lifts and settles into the new heading. */
export function applyVanguardTurnFeet(
  frame: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  state: VanguardFacingState,
) {
  frame.updateWorldMatrix(true, true);
  const turn = state.turn;
  if (turn) {
    for (const [i, side] of ["Left", "Right"].entries()) {
      const phase = THREE.MathUtils.clamp(
        (turn.time / TURN_DURATION) * 2 - (i === turn.first ? 0 : 1),
        0,
        1,
      );
      const ease = THREE.MathUtils.smoothstep(phase, 0, 1);
      const target = turn.feet[i].position
        .clone()
        .lerp(turn.goals[i].position, ease);
      target.y += Math.sin(phase * Math.PI) * 0.065;
      const rotation = turn.feet[i].rotation
        .clone()
        .slerp(turn.goals[i].rotation, ease);
      solveLimb(
        frame,
        bones[side + "UpLeg"],
        bones[side + "Leg"],
        bones[side + "Foot"],
        target,
        rotation,
        worldPositionFromMatrix(bones[side + "Leg"]),
      );
    }
  }
  state.feet = ["LeftFoot", "RightFoot"].map((name) => ({
    position: worldPositionFromMatrix(bones[name]),
    rotation: worldQuaternionFromMatrix(bones[name]),
  }));
  if (turn && turn.time >= TURN_DURATION) state.turn = undefined;
}

function rotateBone(
  bone: THREE.Object3D,
  axis: THREE.Vector3,
  angle: number,
  weapon?: THREE.Object3D,
) {
  if (Math.abs(angle) < 1e-8) return;
  const before = bone.matrixWorld.clone().invert();
  const parent = worldQuaternionFromMatrix(bone.parent!).invert();
  bone.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(
      axis.clone().applyQuaternion(parent),
      angle,
    ),
  );
  bone.updateWorldMatrix(false, true);
  if (weapon) {
    // Hammer is an independent root. Give it exactly the same rigid chest delta.
    const matrix = weapon
      .parent!.matrixWorld.clone()
      .invert()
      .multiply(bone.matrixWorld.clone().multiply(before))
      .multiply(weapon.matrixWorld);
    matrix.decompose(weapon.position, weapon.quaternion, weapon.scale);
    weapon.updateWorldMatrix(false, true);
  }
}

export function applyVanguardAim(
  frame: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  state: VanguardFacingState,
  pitch: number,
) {
  frame.updateWorldMatrix(true, true);
  const twist = THREE.MathUtils.clamp(state.aimYaw ?? 0, -MAX_TWIST, MAX_TWIST);
  const lookPitch = THREE.MathUtils.clamp(
    finite(pitch),
    -Math.PI / 3,
    Math.PI / 3,
  );
  const torsoPitch = lookPitch * 0.5;
  const right = new THREE.Vector3(1, 0, 0)
    .applyQuaternion(worldQuaternionFromMatrix(frame))
    .applyAxisAngle(up, twist);
  for (const [name, weight] of [
    ["Spine02", 0.35],
    ["Spine01", 0.35],
    ["Spine", 0.3],
  ] as const) {
    rotateBone(bones[name], up, twist * weight, bones.weapon_hammer);
    rotateBone(bones[name], right, torsoPitch * weight, bones.weapon_hammer);
  }
  rotateBone(
    bones.neck,
    up,
    THREE.MathUtils.clamp(
      (state.aimYaw ?? 0) - twist,
      -Math.PI / 6,
      Math.PI / 6,
    ),
  );
  rotateBone(bones.neck, right, lookPitch - torsoPitch);
}
