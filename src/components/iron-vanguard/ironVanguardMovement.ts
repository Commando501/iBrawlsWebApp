import * as THREE from "three";
import {
  createVanguardAirState,
  shapeVanguardAirPose,
  movingVanguardLanding,
  type VanguardAirState,
} from "./ironVanguardAirborne";
import type { VanguardFacingState } from "./ironVanguardFacing";
import { IRON_VANGUARD_MOVEMENT } from "./ironVanguardMovement.generated";

export interface VanguardMovementInput {
  dt: number;
  vel?: THREE.Vector3;
  yaw?: number;
  hp?: number;
  isJumping?: boolean;
  isCrouching?: boolean;
  isSliding?: boolean;
  isSprinting?: boolean;
  lungeBlend?: number;
  weaponState: string;
  activeWeapon?: string;
  /** Isolated review tool: sample a baked clip directly. */
  previewClip?: string;
  previewTime?: number;
}
const clips = Object.fromEntries(
  Object.entries(IRON_VANGUARD_MOVEMENT.clips).map(([name, clip]) => [
    name,
    {
      ...clip,
      tracks: clip.tracks.map((track) => {
        const quaternion = track.name.endsWith(".quaternion");
        const keyframes = quaternion
          ? new THREE.QuaternionKeyframeTrack(
              track.name,
              track.times,
              track.values,
            )
          : track.name === "Slide.weight"
            ? new THREE.NumberKeyframeTrack(
                track.name,
                track.times,
                track.values,
              )
            : new THREE.VectorKeyframeTrack(
                track.name,
                track.times,
                track.values,
              );
        return {
          name: track.name,
          bone: track.name.split(".")[0],
          quaternion,
          interpolant: keyframes.InterpolantFactoryMethodLinear(),
        };
      }),
    },
  ]),
);
export const VANGUARD_MOVEMENT_CLIPS = Object.keys(clips);
type Pose = Record<string, number[]>;
export interface VanguardMovementState {
  facing: VanguardFacingState;
  clip: string;
  clock: number;
  phase: number;
  transition: number;
  airborne: boolean;
  quietVerticalTime: number;
  landing: number;
  air: VanguardAirState;
  landingBlend: number;
  slideWeight: number;
  transitioningFromSlide: boolean;
  recoveryVelocity: THREE.Vector3;
  recoveryBlend: number;
  support?: {
    side?: "Left" | "Right";
    reachRatio?: number;
    position: THREE.Vector3;
    rotation: THREE.Quaternion;
    origin: THREE.Vector3;
    age: number;
    release: number;
  };
  lastRightFoot?: { position: THREE.Vector3; rotation: THREE.Quaternion };
  lastRoot?: THREE.Vector3;
  pose: Pose;
  from: Pose;
}
function sample(name: string, time: number): Pose {
  const clip = clips[name];
  const t = clip.loop
    ? ((time % clip.duration) + clip.duration) % clip.duration
    : THREE.MathUtils.clamp(time, 0, clip.duration);
  return Object.fromEntries(
    clip.tracks.map((tk) => [tk.name, Array.from(tk.interpolant.evaluate(t))]),
  );
}
const reference = sample("idle", 0);
export function createVanguardMovementState(): VanguardMovementState {
  return {
    facing: {},
    clip: "idle",
    clock: 0,
    phase: 0,
    transition: 1,
    airborne: false,
    quietVerticalTime: 0,
    landing: 0,
    air: createVanguardAirState(),
    landingBlend: 0,
    slideWeight: 0,
    transitioningFromSlide: false,
    recoveryVelocity: new THREE.Vector3(),
    recoveryBlend: 0,
    pose: structuredClone(reference),
    from: {},
  };
}
const quaternionA = new THREE.Quaternion(),
  quaternionB = new THREE.Quaternion();
function blend(from: Pose, to: Pose, alpha: number): Pose {
  for (const [name, value] of Object.entries(to)) {
    const start = from[name];
    if (!start) continue;
    if (name.endsWith(".quaternion")) {
      quaternionA
        .fromArray(start)
        .slerp(quaternionB.fromArray(value), alpha)
        .normalize()
        .toArray(value);
    } else
      for (let i = 0; i < value.length; i++)
        value[i] = THREE.MathUtils.lerp(start[i], value[i], alpha);
  }
  return to;
}
/** Match both adjacent directions at diagonals instead of snapping at 45 degrees. */
function locomotionPose(input: VanguardMovementInput, phase: number): Pose {
  const speed = Math.hypot(input.vel?.x ?? 0, input.vel?.z ?? 0);
  if (speed < 0.15) return sample(input.isCrouching ? "crouch" : "idle", 0);
  const yaw = input.yaw ?? 0;
  const x = Math.cos(yaw) * input.vel!.x - Math.sin(yaw) * input.vel!.z;
  const z = Math.sin(yaw) * input.vel!.x + Math.cos(yaw) * input.vel!.z;
  const gait = input.isCrouching
    ? "crouch-walk"
    : input.isSprinting || speed > 5.5
      ? "run"
      : "walk";
  const sideways = `${gait}-${x > 0 ? "right" : "left"}`;
  const longitudinal = `${gait}-${z > 0 ? "backward" : "forward"}`;
  return blend(
    sample(longitudinal, phase * clips[longitudinal].duration),
    sample(sideways, phase * clips[sideways].duration),
    Math.abs(x) / (Math.abs(x) + Math.abs(z)),
  );
}

/** Direction is relative to the facing character, not the world or observer camera. */
export function selectVanguardMovement(
  input: VanguardMovementInput,
  state: VanguardMovementState,
): string {
  if (input.previewClip && clips[input.previewClip]) return input.previewClip;
  if ((input.hp ?? 100) <= 0) return "idle";
  if (state.airborne) return (input.vel?.y ?? 0) > 0.1 ? "jump" : "fall";
  if (input.isSliding) {
    if (state.clip === "slide") return "slide";
    if (
      state.clip === "slide-enter" &&
      state.clock >= clips["slide-enter"].duration - 1e-6
    )
      return "slide";
    return "slide-enter";
  }
  if (state.clip === "slide" || state.clip === "slide-enter")
    return "slide-exit";
  if (
    state.clip === "slide-exit" &&
    state.clock < clips["slide-exit"].duration - 1e-6
  )
    return "slide-exit";
  if (state.landing > 0) return "land";
  const speed = Math.hypot(input.vel?.x ?? 0, input.vel?.z ?? 0);
  if (speed < 0.15) return input.isCrouching ? "crouch" : "idle";
  const yaw = input.yaw ?? 0,
    vx = input.vel?.x ?? 0,
    vz = input.vel?.z ?? 0;
  const x = Math.cos(yaw) * vx - Math.sin(yaw) * vz,
    z = Math.sin(yaw) * vx + Math.cos(yaw) * vz;
  const direction =
    Math.abs(x) > Math.abs(z)
      ? x > 0
        ? "right"
        : "left"
      : z > 0
        ? "backward"
        : "forward";
  const gait = input.isCrouching
    ? "crouch-walk"
    : input.isSprinting || speed > 5.5
      ? "run"
      : "walk";
  return `${gait}-${direction}`;
}

export function applyVanguardMovement(
  root: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  state: VanguardMovementState,
  input: VanguardMovementInput,
) {
  const dt = Number.isFinite(input.dt)
    ? THREE.MathUtils.clamp(input.dt, 0, 0.1)
    : 0;
  const movingVertically = Math.abs(input.vel?.y ?? 0) > 0.15;
  state.quietVerticalTime = movingVertically ? 0 : state.quietVerticalTime + dt;
  const airborne =
    input.isJumping ??
    (movingVertically || (state.airborne && state.quietVerticalTime < 0.12));
  const tookOff = !state.airborne && airborne;
  const touchedDown = state.airborne && !airborne;
  if (touchedDown) state.landing = clips.land.duration;
  else state.landing = Math.max(0, state.landing - dt);
  state.airborne = airborne;
  const speed = Math.hypot(input.vel?.x ?? 0, input.vel?.z ?? 0);
  const rootPosition = root.getWorldPosition(new THREE.Vector3());
  const discontinuity =
    state.lastRoot && rootPosition.distanceTo(state.lastRoot) > 1;
  if (
    input.previewClip ||
    airborne ||
    (input.hp ?? 100) <= 0 ||
    discontinuity ||
    input.isSliding
  ) {
    state.support = undefined;
    state.recoveryBlend = 0;
  }
  if (discontinuity || (input.hp ?? 100) <= 0 || input.previewClip) {
    state.air = createVanguardAirState();
    state.landing = 0;
  }
  if (airborne) {
    const velocity = (input.vel ?? new THREE.Vector3()).clone().setY(0);
    if (tookOff) {
      state.air.time = 0;
      state.air.velocity.copy(velocity);
      const local = velocity
        .clone()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), -(input.yaw ?? 0));
      state.air.lead =
        Math.abs(local.x) > Math.abs(local.z)
          ? local.x > 0
            ? "Right"
            : "Left"
          : state.phase < 0.5
            ? "Left"
            : "Right";
    } else state.air.velocity.lerp(velocity, 1 - Math.exp(-dt / 0.09));
    state.air.time += dt;
    state.landing = 0;
  }
  if (touchedDown && !discontinuity)
    state.phase = state.air.lead === "Left" ? 0 : 0.5;
  const name = selectVanguardMovement(input, state);
  if (name !== state.clip) {
    const wasLanding = state.clip === "land";
    state.from = state.pose;
    const wasSliding = state.clip.startsWith("slide");
    state.transitioningFromSlide = wasSliding;
    state.clip = name;
    state.clock = 0;
    // A released or retriggered short slide starts its next phase at the current depth.
    if (wasSliding && (name === "slide-enter" || name === "slide-exit")) {
      const weight = clips[name].tracks.find((t) => t.name === "Slide.weight")!;
      let best = Infinity;
      for (let i = 0; i <= 100; i++) {
        const t = (clips[name].duration * i) / 100;
        const distance = Math.abs(
          weight.interpolant.evaluate(t)[0] - state.slideWeight,
        );
        if (distance < best) {
          best = distance;
          state.clock = t;
        }
      }
    }
    state.transition =
      wasLanding && /^(walk|run|crouch-walk)-/.test(name) ? 1 : 0;
    if (name === "slide-exit" && !input.previewClip) {
      state.recoveryVelocity.copy(input.vel ?? new THREE.Vector3()).setY(0);
      state.recoveryBlend = 0;
      // Gather the leading leg late in its swing; the right swing follows push-off.
      state.phase = 0.9;
      if (speed > 0.15 && state.lastRightFoot && !discontinuity) {
        state.support = {
          position: state.lastRightFoot.position.clone(),
          rotation: state.lastRightFoot.rotation.clone(),
          origin: rootPosition.clone(),
          age: 0,
          release: 0,
        };
      }
    }
  }
  // Only the recovery clock accelerates. Combat timing and simulation stay independent.
  const recoveryRate =
    name === "slide-exit" && !input.previewClip
      ? 1 + THREE.MathUtils.smoothstep(speed, 0.15, 6)
      : 1;
  state.clock += dt * recoveryRate;
  const gaitClip = /^(walk|run|crouch-walk)-/.test(name);
  const rate = THREE.MathUtils.clamp(
    speed /
      (name === "slide-exit" || name === "land"
        ? input.isCrouching
          ? 2
          : input.isSprinting || speed > 5.5
            ? 6
            : 4
        : name.startsWith("run")
          ? 6
          : name.startsWith("crouch-walk")
            ? 2
            : 4),
    0.5,
    1.5,
  );
  const gaitDuration = input.isCrouching
    ? 1.2
    : input.isSprinting || speed > 5.5
      ? 0.7
      : 1;
  if (!airborne)
    state.phase =
      (state.phase +
        (dt * rate) /
          (["slide-exit", "land"].includes(name)
            ? gaitDuration
            : clips[name].duration)) %
      1;
  const time =
    input.previewTime ??
    (clips[name].loop && name.includes("-")
      ? state.phase * clips[name].duration
      : state.clock);
  state.transition = Math.min(
    1,
    state.transition +
      dt / (name === "land" ? 0.08 : name.startsWith("slide") ? 0.1 : 0.16),
  );
  const alpha = input.previewClip
    ? 1
    : state.transition * state.transition * (3 - 2 * state.transition);
  let targetPose =
    !input.previewClip && gaitClip
      ? locomotionPose(input, state.phase)
      : sample(name, time);
  state.landingBlend = 0;
  if (!input.previewClip && airborne && (input.hp ?? 100) > 0) {
    shapeVanguardAirPose(
      targetPose,
      reference,
      state.air,
      input.yaw ?? 0,
      input.vel?.y ?? 0,
    );
  }
  if (!input.previewClip && name === "land") {
    const weight = THREE.MathUtils.smoothstep(speed, 0.15, 1.5);
    // Add a small impact dip to the running/crouched pelvis, while feet keep their stride.
    targetPose = movingVanguardLanding(
      targetPose,
      locomotionPose(input, state.phase),
      reference,
      weight,
    );
    state.landingBlend = weight * alpha;
  }
  root.userData.ironVanguardLandingBlend = state.landingBlend;
  if (name !== "slide-exit") state.recoveryBlend = 0;
  if (!input.previewClip && name === "slide-exit") {
    state.recoveryVelocity
      .lerp(input.vel ?? new THREE.Vector3(), 1 - Math.exp(-dt / 0.06))
      .setY(0);
    const travelSpeed = state.recoveryVelocity.length();
    state.recoveryBlend =
      THREE.MathUtils.smoothstep(time / clips[name].duration, 0.08, 0.8) *
      THREE.MathUtils.smoothstep(travelSpeed, 0.15, 1.5);
    const slideWeight = targetPose["Slide.weight"].slice();
    targetPose = blend(
      targetPose,
      locomotionPose({ ...input, vel: state.recoveryVelocity }, state.phase),
      state.recoveryBlend,
    );
    // Retain pelvis anchoring through the rise even while the legs begin stepping.
    targetPose["Slide.weight"] = slideWeight;
  }
  state.pose = blend(state.from, targetPose, alpha);
  const lungeBlend = (input.hp ?? 100) > 0 ? (input.lungeBlend ?? 0) : 0;
  if (lungeBlend > 0) {
    const glide = sample("crouch", 0);
    // Source pelvis positions are centimetres in the imported Z-up rig.
    glide["Hips.position"][2] -= 8;
    glide["Hips.position"][1] -= 8;
    glide["RightFootTarget.position"] = [
      0.19,
      reference["RightFootTarget.position"][1],
      -0.43,
    ];
    glide["LeftFootTarget.position"] = [
      -0.19,
      reference["LeftFootTarget.position"][1],
      0.36,
    ];
    glide["RightKneeTarget.position"] = [0.21, 0.43, -0.6];
    glide["LeftKneeTarget.position"] = [-0.21, 0.39, -0.07];
    state.pose = blend(state.pose, glide, lungeBlend);
    state.support = undefined;
  }
  root.userData.ironVanguardLungeBlend = lungeBlend;
  state.slideWeight = state.pose["Slide.weight"][0];
  const slideCarry =
    state.slideWeight > 0.00001 &&
    input.activeWeapon === "hammer" &&
    input.weaponState === "ready";
  // Keep the source grip offsets exact while carry poses blend into/out of the slide.
  root.updateWorldMatrix(true, true);
  const gripOffsets = slideCarry
    ? ["Left", "Right"].map((side) =>
        bones.weapon_hammer.matrixWorld
          .clone()
          .invert()
          .multiply(bones[side + "Hand"].matrixWorld),
      )
    : [];
  root.userData.ironVanguardMovement = name;
  root.userData.ironVanguardMovementTime = time;
  root.scale.y = 1; // Use articulated crouch even when a legacy caller scaled the shell.
  // The native attack and all shoulder correctives remain exact when stationary.
  if (
    !input.previewClip &&
    input.activeWeapon === "hammer" &&
    input.weaponState !== "ready" &&
    name === "idle"
  )
    return;
  // Apply the same rigid transform to pelvis and independent weapon root. This
  // preserves the accepted hand contacts even while leaning during an attack.
  const referenceMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(reference["Hips.position"]),
    new THREE.Quaternion().fromArray(reference["Hips.quaternion"]),
    new THREE.Vector3(1, 1, 1),
  );
  const delta = new THREE.Matrix4()
    .compose(
      new THREE.Vector3().fromArray(state.pose["Hips.position"]),
      new THREE.Quaternion().fromArray(state.pose["Hips.quaternion"]),
      new THREE.Vector3(1, 1, 1),
    )
    .multiply(referenceMatrix.invert());
  const rotation = new THREE.Quaternion().setFromRotationMatrix(delta);
  for (const bone of [bones.Hips, bones.weapon_hammer]) {
    bone.position.applyMatrix4(delta);
    bone.quaternion.premultiply(rotation).normalize();
  }
  // A standing attack pitches/turns the pelvis. Fade that motion out for the low
  // slide and apply the identical correction to the independent hammer root.
  // Upper-body attack curves and their two hand contacts remain in sync.
  if (state.slideWeight > 0.00001) {
    const current = new THREE.Matrix4().compose(
      bones.Hips.position,
      bones.Hips.quaternion,
      new THREE.Vector3(1, 1, 1),
    );
    const anchored = new THREE.Matrix4().compose(
      bones.Hips.position
        .clone()
        .lerp(
          new THREE.Vector3().fromArray(state.pose["Hips.position"]),
          state.slideWeight,
        ),
      bones.Hips.quaternion
        .clone()
        .slerp(
          new THREE.Quaternion().fromArray(state.pose["Hips.quaternion"]),
          state.slideWeight,
        ),
      new THREE.Vector3(1, 1, 1),
    );
    const correction = anchored.multiply(current.invert());
    const correctionRotation = new THREE.Quaternion().setFromRotationMatrix(
      correction,
    );
    for (const bone of [bones.Hips, bones.weapon_hammer]) {
      bone.position.applyMatrix4(correction);
      bone.quaternion.premultiply(correctionRotation).normalize();
    }
  }
  for (const track of clips[name].tracks) {
    if (track.bone === "Hips") continue;
    const bone = bones[track.bone];
    if (!bone) continue;
    const carry =
      track.bone === "weapon_hammer" ||
      /^(Left|Right)(Arm|ForeArm|Hand)$/.test(track.bone);
    // Carry curves shape the slide grip. Combat continues to own the accepted attack.
    if (carry && !slideCarry) continue;
    if (track.quaternion)
      bone.quaternion.fromArray(state.pose[track.name]).normalize();
    else if (/^(Left|Right)(UpLeg|Leg|Foot|ToeBase)$/.test(track.bone))
      bone.position.lerp(
        new THREE.Vector3().fromArray(state.pose[track.name]),
        state.slideWeight,
      );
    else bone.position.fromArray(state.pose[track.name]);
  }
  if (slideCarry) {
    root.updateWorldMatrix(true, true);
    ["Left", "Right"].forEach((side, i) => {
      const goal = bones.weapon_hammer.matrixWorld
        .clone()
        .multiply(gripOffsets[i]);
      solveLimb(
        root,
        bones[side + "Arm"],
        bones[side + "ForeArm"],
        bones[side + "Hand"],
        new THREE.Vector3().setFromMatrixPosition(goal),
        new THREE.Quaternion().setFromRotationMatrix(
          new THREE.Matrix4().extractRotation(goal),
        ),
      );
    });
  }
  if (
    lungeBlend > 0 ||
    state.slideWeight > 0.00001 ||
    name === "slide-exit" ||
    (!input.previewClip && (gaitClip || airborne || name === "land")) ||
    !!state.support ||
    (state.transitioningFromSlide && state.transition < 1) ||
    (input.activeWeapon === "hammer" && input.weaponState !== "ready")
  )
    placeMovementFeet(
      root,
      bones,
      state.pose,
      state,
      dt,
      name === "land" && touchedDown && speed > 0.15 && !discontinuity
        ? state.air.lead
        : undefined,
    );
  root.updateWorldMatrix(true, true);
  state.lastRightFoot = {
    position: bones.RightFoot.getWorldPosition(new THREE.Vector3()),
    rotation: bones.RightFoot.getWorldQuaternion(new THREE.Quaternion()),
  };
  state.lastRoot = rootPosition;
  root.userData.ironVanguardRecoveryBlend = state.recoveryBlend;
  root.userData.ironVanguardSupportPlanted =
    !!state.support && state.support.release === 0;
}

/** Keep feet on their baked goals through slide transitions and native attack pelvis tilt. */
function placeMovementFeet(
  root: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  pose: Pose,
  state: VanguardMovementState,
  dt: number,
  landingSide?: "Left" | "Right",
) {
  root.updateWorldMatrix(true, true);
  for (const side of ["Left", "Right"]) {
    const thigh = bones[side + "UpLeg"],
      shin = bones[side + "Leg"],
      foot = bones[side + "Foot"];
    const target = root.localToWorld(
      new THREE.Vector3().fromArray(pose[side + "FootTarget.position"]),
    );
    const rotation = root
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(
        new THREE.Quaternion().fromArray(pose[side + "FootTarget.quaternion"]),
      );
    const kneeGoal = root.localToWorld(
      new THREE.Vector3().fromArray(pose[side + "KneeTarget.position"]),
    );
    if (side === landingSide) {
      const hip = thigh.getWorldPosition(new THREE.Vector3());
      const reach =
        hip.distanceTo(shin.getWorldPosition(new THREE.Vector3())) +
        shin
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(foot.getWorldPosition(new THREE.Vector3()));
      const contact = target.clone();
      contact.y = root.localToWorld(
        new THREE.Vector3().fromArray(reference[side + "FootTarget.position"]),
      ).y;
      // Establish contact from the blended pose, within reach of the current hip.
      // A landing can be nearly extended; compression supplies bend on the next frames.
      const vertical = hip.y - contact.y;
      if (Math.abs(vertical) < reach * 0.98) {
        const horizontal = new THREE.Vector2(
          contact.x - hip.x,
          contact.z - hip.z,
        );
        const maxHorizontal = Math.sqrt((reach * 0.98) ** 2 - vertical ** 2);
        if (horizontal.length() > maxHorizontal)
          horizontal.setLength(maxHorizontal);
        contact.x = hip.x + horizontal.x;
        contact.z = hip.z + horizontal.y;
        state.support = {
          side: landingSide,
          reachRatio: 0.99,
          position: contact,
          rotation: rotation.clone(),
          origin: root.getWorldPosition(new THREE.Vector3()),
          age: 0,
          release: 0,
        };
      }
    }
    if (state.support && side === (state.support.side ?? "Right")) {
      const support = state.support;
      support.age += dt;
      const hip = thigh.getWorldPosition(new THREE.Vector3());
      const reach =
        hip.distanceTo(shin.getWorldPosition(new THREE.Vector3())) +
        shin
          .getWorldPosition(new THREE.Vector3())
          .distanceTo(foot.getWorldPosition(new THREE.Vector3()));
      // Push off briefly, then release before the moving pelvis can overextend the leg.
      if (
        support.release > 0 ||
        support.age >= 0.09 ||
        hip.distanceTo(support.position) >
          reach * (support.reachRatio ?? 0.94) ||
        root.getWorldPosition(new THREE.Vector3()).distanceTo(support.origin) >
          0.28
      )
        support.release = Math.min(1, support.release + dt / 0.12);
      const release = THREE.MathUtils.smoothstep(support.release, 0, 1);
      target.lerp(support.position, 1 - release);
      target.y += 0.09 * Math.sin(Math.PI * support.release);
      rotation.slerp(support.rotation, 1 - release);
      if (support.release === 1) state.support = undefined;
    }
    // Preserve floor clearance if a moving support point approaches full extension.
    // Solve in the horizontal plane first instead of clamping the ankle up/down.
    const hip = thigh.getWorldPosition(new THREE.Vector3());
    const reach =
      hip.distanceTo(shin.getWorldPosition(new THREE.Vector3())) +
      shin
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(foot.getWorldPosition(new THREE.Vector3()));
    const maxHorizontal = Math.sqrt(
      Math.max(0, (reach - 0.0002) ** 2 - (hip.y - target.y) ** 2),
    );
    const horizontal = new THREE.Vector2(target.x - hip.x, target.z - hip.z);
    if (horizontal.length() > maxHorizontal) {
      horizontal.setLength(maxHorizontal);
      target.x = hip.x + horizontal.x;
      target.z = hip.z + horizontal.y;
    }
    solveLimb(root, thigh, shin, foot, target, rotation, kneeGoal);
  }
}

export function solveLimb(
  root: THREE.Group,
  thigh: THREE.Object3D,
  shin: THREE.Object3D,
  foot: THREE.Object3D,
  target: THREE.Vector3,
  rotation: THREE.Quaternion,
  pole?: THREE.Vector3,
) {
  const hip = thigh.getWorldPosition(new THREE.Vector3()),
    knee = shin.getWorldPosition(new THREE.Vector3()),
    ankle = foot.getWorldPosition(new THREE.Vector3());
  const upperLength = hip.distanceTo(knee),
    lowerLength = knee.distanceTo(ankle);
  const direction = target.clone().sub(hip);
  const distance = THREE.MathUtils.clamp(
    direction.length(),
    Math.abs(upperLength - lowerLength) + 0.0001,
    upperLength + lowerLength - 0.0001,
  );
  direction.normalize();
  target.copy(hip).addScaledVector(direction, distance);
  const along =
    (upperLength ** 2 - lowerLength ** 2 + distance ** 2) / (2 * distance);
  const bend = (pole ?? knee).clone().sub(hip);
  bend.addScaledVector(direction, -bend.dot(direction));
  if (bend.lengthSq() < 1e-10)
    bend
      .set(0, 0, -1)
      .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  bend.normalize();
  const kneeTarget = hip
    .clone()
    .addScaledVector(direction, along)
    .addScaledVector(
      bend,
      Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)),
    );
  const aim = (
    bone: THREE.Object3D,
    child: THREE.Object3D,
    goal: THREE.Vector3,
  ) => {
    const start = bone.getWorldPosition(new THREE.Vector3());
    const from = child
      .getWorldPosition(new THREE.Vector3())
      .sub(start)
      .normalize();
    const to = goal.clone().sub(start).normalize();
    const world = new THREE.Quaternion()
      .setFromUnitVectors(from, to)
      .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    bone.quaternion.copy(
      bone
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(world),
    );
    bone.updateWorldMatrix(false, true);
  };
  aim(thigh, shin, kneeTarget);
  aim(shin, foot, target);
  foot.quaternion.copy(
    foot
      .parent!.getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(rotation),
  );
  foot.updateWorldMatrix(false, true);
}
