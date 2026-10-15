import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import type { UniversalSettings } from "../../types";
import { VANGUARD_SWORD_IDLE } from "./ironVanguardSword.generated";
import { solveLimb } from "./ironVanguardMovement";

export const VANGUARD_SWORD_URL = "/assets/iron-vanguard/sword-v001.glb";
let source: GLTF | undefined;
let pending: Promise<GLTF> | undefined;
export function preloadVanguardSword(): Promise<GLTF> {
  return source
    ? Promise.resolve(source)
    : (pending ??= new GLTFLoader()
        .setMeshoptDecoder(MeshoptDecoder)
        .loadAsync(VANGUARD_SWORD_URL)
        .then((value) => (source = value))
        .catch((error) => {
          pending = undefined;
          throw error;
        }));
}
const gripMatrix = new THREE.Matrix4().fromArray(
  VANGUARD_SWORD_IDLE.gripMatrix,
);
const referenceRotation = new THREE.Quaternion();
const referencePosition = new THREE.Vector3();
gripMatrix.decompose(referencePosition, referenceRotation, new THREE.Vector3());
// The exported prop is in canonical world metres. Strip the rig's centimetre scale.
const gripInverse = new THREE.Matrix4()
  .compose(referencePosition, referenceRotation, new THREE.Vector3(1, 1, 1))
  .invert();
export function createVanguardSword(asset?: GLTF): THREE.Group {
  const root = new THREE.Group();
  root.name = "Iron Vanguard sword";
  root.userData.ironVanguardSword = true;
  const attach = (value: GLTF) => {
    if (root.userData.disposed) return;
    const model = value.scene.clone(true);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry = object.geometry.clone();
        object.material = Array.isArray(object.material)
          ? object.material.map((m) => m.clone())
          : object.material.clone();
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    model.applyMatrix4(gripInverse);
    root.add(model);
    root.userData.assetStatus = "ready";
  };
  if (asset ?? source) attach((asset ?? source)!);
  else if (typeof window !== "undefined") {
    root.userData.assetStatus = "loading";
    root.userData.assetReady = preloadVanguardSword()
      .then(attach)
      .catch((error) => {
        root.userData.assetStatus = "error";
        console.error("Could not load Iron Vanguard sword", error);
      });
  }
  // Geometry/materials are instance-owned and disposed by the containing model/view.
  root.addEventListener("removed", () => {
    root.userData.disposed = true;
  });
  return root;
}
export function attachVanguardSword(model: THREE.Group, sword: THREE.Group) {
  (model.userData.ironVanguardSwordGrip as THREE.Group).add(sword);
}
export interface VanguardSwordInput {
  weaponState: string;
  weaponTimer: number;
  isLunging?: boolean;
  /** Elapsed flight/release time when supplied by a player clock or preview. */
  lungeTime?: number;
  lungeReleaseTime?: number;
  /** Contact result from gameplay; only successful contact finishes with a cut. */
  lungeHit?: boolean;
  settings?: Partial<UniversalSettings>;
  localRecovery?: boolean;
}
const ease = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);
// Wrist travel, view shoulder arc / rigid-prop rotation, torso/shoulder turn, lift and guard.
// The cut travels from outside the right shoulder to the opposite hip. The
// thrust stays on its forward lane, with the elbow folding behind the hand.
const guard = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const windup = [0.22, 0.3, 0.01, 1.2, -0.55, -0.25, -0.26, -0.12, 0.06, 1];
const contact = [-0.1, 0.28, -0.2, 1, 0.3, 0.15, 0.08, 0.08, 0.04, 1];
const follow = [-0.4, 0.18, -0.03, 0.6, 1.2, 0.4, 0.32, 0.14, 0, 0.8];
const chamber = [-0.03, 0.22, 0.06, 0.3, 0, 0, -0.08, -0.06, 0, 0.7];
const thrust = [-0.04, 0.33, -0.28, 1.1, 0, 0, 0.1, 0.13, 0.02, 1];
const mix = (a: number[], b: number[], t: number) =>
  a.map((v, i) => THREE.MathUtils.lerp(v, b[i], ease(t)));
// First-person cross slash: move the arm rig from the right side of the view
// to the left while the shoulder turns through depth. Offsets are camera-rig
// travel for this profile; the other profiles use wrist targets. Translation
// and shoulder yaw carry the grip across the view as the blade turns diagonally.
const viewWindup = [0.08, 0.12, 0.02, -0.35, -0.5, -0.35, 0, 0, 0, 1];
const viewContact = [-0.07, 0.17, -0.02, -0.6, 0.1, 0.6, 0, 0, 0, 1];
const viewFollow = [-0.25, 0.18, 0.02, -0.55, 0.35, 0.95, 0, 0, 0, 0.8];
const viewReturn = [-0.04, -0.12, 0.04, -0.15, 0, 0.2, 0, 0, 0, 0.4];
const cut = (u: number, start: number[], hit: number[], end: number[]) =>
  start.map((v, i) => {
    const control = 2 * hit[i] - (v + end[i]) / 2;
    return (1 - u) ** 2 * v + 2 * (1 - u) * u * control + u * u * end[i];
  });
// One continuous cut through contact: nonzero velocity at the hit, zero at
// either end. Both combat clocks cross the same curve at their own hit time.
function cutProgress(time: number, hit: number, end: number) {
  const first = time <= hit;
  const duration = first ? hit : end - hit;
  const t = THREE.MathUtils.clamp((time - (first ? 0 : hit)) / duration, 0, 1);
  const slope = duration / end;
  return first
    ? (-2 * t ** 3 + 3 * t * t) * 0.5 + (t ** 3 - t * t) * slope
    : 0.5 + (-2 * t ** 3 + 3 * t * t) * 0.5 + (t ** 3 - 2 * t * t + t) * slope;
}
/** Visual only: preserve local half-slash and bot end-of-swing-down hits. */
export function sampleVanguardSword(
  input: VanguardSwordInput,
  viewCut = false,
) {
  const start = viewCut ? viewWindup : windup;
  const hit = viewCut ? viewContact : contact;
  const end = viewCut ? viewFollow : follow;
  const sweep = (u: number) => cut(u, start, hit, end);
  const slash = Math.max(0.001, input.settings?.swordSlashSpeed ?? 0.22);
  const recover = Math.max(0.001, input.settings?.swordSlashReload ?? 0.6);
  const t = Math.max(0, input.weaponTimer || 0);
  let values = guard;
  let phase = "guard";
  if (input.isLunging) {
    const flight = Math.max(0, input.lungeTime ?? t);
    values =
      flight < 0.04
        ? mix(guard, chamber, flight / 0.04)
        : mix(chamber, thrust, (flight - 0.04) / 0.1);
    phase = "lunge";
  } else if (input.weaponState === "swing_up") {
    values = mix(guard, start, t / (slash * 0.5));
    phase = "wind-up";
  } else if (input.weaponState === "swing_down") {
    values = sweep(
      cutProgress(
        Math.min(t, slash * 0.5),
        slash * 0.5,
        slash * 0.5 + recover * 0.2,
      ),
    );
    phase = "strike";
  } else if (input.weaponState === "slashing") {
    values =
      t < slash * 0.25
        ? mix(guard, start, t / (slash * 0.25))
        : sweep(cutProgress(t - slash * 0.25, slash * 0.25, slash * 0.75));
    phase =
      t < slash * 0.25
        ? "wind-up"
        : t < slash * 0.5
          ? "strike"
          : "follow-through";
  } else if (input.weaponState === "recovering") {
    values = input.localRecovery
      ? viewCut
        ? cut(ease(t / recover), end, viewReturn, guard)
        : mix(end, guard, t / recover)
      : t < recover * 0.2
        ? sweep(
            cutProgress(
              slash * 0.5 + t,
              slash * 0.5,
              slash * 0.5 + recover * 0.2,
            ),
          )
        : mix(end, guard, (t - recover * 0.2) / (recover * 0.8));
    phase = "recovery";
  }
  return {
    offset: new THREE.Vector3(...values.slice(0, 3)),
    rotation: new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...values.slice(3, 6)),
    ),
    torsoYaw: values[6],
    shoulderYaw: values[7],
    shoulderLift: values[8],
    guardWeight: values[9],
    phase,
  };
}
const idleTracks = VANGUARD_SWORD_IDLE.tracks.map((track) => ({
  bone: track.name.replace(".quaternion", ""),
  sampler: new THREE.QuaternionKeyframeTrack(
    track.name,
    track.times,
    track.values,
  ).InterpolantFactoryMethodLinear(),
}));
export const createVanguardSwordState = () => ({
  clock: 0,
  localRecovery: false,
  lungeWeight: 0,
  lungeElapsed: 0,
  lungeRelease: 0,
  wasLunging: false,
  lungeRecovery: false,
  lungeContact: false,
  lungeArmPose: undefined as Record<string, THREE.Quaternion> | undefined,
});
export type VanguardSwordState = ReturnType<typeof createVanguardSwordState>;
/** Advance visual flight/contact once per frame, before movement and arm posing. */
export function updateVanguardSwordLunge(
  state: VanguardSwordState,
  input: VanguardSwordInput & { dt: number; hp?: number },
) {
  if (input.weaponState === "slashing") state.localRecovery = true;
  else if (["swing_up", "swing_down", "ready"].includes(input.weaponState))
    state.localRecovery = false;
  if (
    ["slashing", "swing_up", "swing_down"].includes(input.weaponState) &&
    !input.isLunging
  ) {
    state.lungeRecovery = false;
    state.lungeContact = false;
    state.lungeArmPose = undefined;
    state.lungeWeight = 0;
  }
  if (input.isLunging) {
    state.lungeRecovery = true;
    state.lungeContact = false;
    if (!state.wasLunging) state.lungeArmPose = undefined;
    state.lungeElapsed =
      input.lungeTime ??
      (state.wasLunging ? state.lungeElapsed + Math.max(0, input.dt) : 0);
    state.lungeRelease = 0;
    state.lungeWeight = 1;
  } else {
    if (state.wasLunging || input.lungeReleaseTime !== undefined)
      state.lungeContact = !!input.lungeHit;
    state.lungeRelease =
      input.lungeReleaseTime ?? state.lungeRelease + Math.max(0, input.dt);
    state.lungeWeight =
      input.lungeReleaseTime !== undefined || state.lungeWeight > 0
        ? 1 - ease(state.lungeRelease / 0.22)
        : 0;
    if (input.lungeTime !== undefined) state.lungeElapsed = input.lungeTime;
    if (input.lungeReleaseTime !== undefined) state.lungeRecovery = true;
  }
  state.wasLunging = !!input.isLunging;
  if ((input.hp ?? 100) <= 0) {
    state.lungeWeight = 0;
    state.lungeContact = false;
    state.lungeRecovery = false;
    state.lungeArmPose = undefined;
  }
}
export function vanguardLungeBodyWeight(state: VanguardSwordState) {
  if (!state.lungeRecovery) return 0;
  const entry = ease(state.lungeElapsed / 0.12);
  return (
    entry *
    (state.wasLunging
      ? 1
      : 1 - ease(state.lungeRelease / (state.lungeContact ? 0.38 : 0.22)))
  );
}
export function applyVanguardSword(
  root: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  state: VanguardSwordState,
  input: VanguardSwordInput & {
    dt: number;
    previewTime?: number;
    isSliding?: boolean;
    hp?: number;
    viewHandOffset?: THREE.Vector3;
  },
) {
  if ((input.hp ?? 100) <= 0) return;
  state.clock += Math.max(0, input.dt);
  const time =
    (input.previewTime ?? state.clock) % VANGUARD_SWORD_IDLE.duration;
  for (const track of idleTracks)
    bones[track.bone]?.quaternion
      .fromArray(track.sampler.evaluate(time))
      .normalize();
  // A hit consumes the existing slash path visually. Damage remains owned by
  // the lunge collision; this does not create a second gameplay attack.
  const finishing = state.lungeContact && !input.isLunging;
  if (
    finishing &&
    (!state.lungeArmPose || input.lungeReleaseTime !== undefined)
  ) {
    const flightState = {
      ...state,
      lungeContact: false,
      lungeWeight: 1,
      lungeRecovery: true,
    };
    applyVanguardSword(root, bones, flightState, {
      ...input,
      dt: 0,
      isLunging: true,
    });
    state.lungeArmPose = flightState.lungeArmPose;
    for (const track of idleTracks)
      bones[track.bone]?.quaternion
        .fromArray(track.sampler.evaluate(time))
        .normalize();
    root.updateWorldMatrix(true, true);
  }
  const slash = Math.max(0.001, input.settings?.swordSlashSpeed ?? 0.22);
  const finishTime = state.lungeRelease + slash * 0.25;
  const contactBlend = ease(state.lungeRelease / Math.min(0.065, slash * 0.3));
  const viewCut = !!input.viewHandOffset && (!state.lungeRecovery || finishing);
  const pose = sampleVanguardSword(
    {
      ...input,
      isLunging: false,
      weaponState: finishing
        ? finishTime < slash
          ? "slashing"
          : "recovering"
        : state.lungeRecovery
          ? "ready"
          : input.weaponState,
      weaponTimer: finishing
        ? finishTime < slash
          ? finishTime
          : finishTime - slash
        : input.weaponTimer,
      localRecovery: finishing || (input.localRecovery ?? state.localRecovery),
    },
    viewCut,
  );
  if (finishing)
    pose.phase =
      finishTime < slash
        ? "lunge-slash"
        : finishTime < slash + (input.settings?.swordSlashReload ?? 0.6)
          ? "lunge-recovery"
          : "guard";
  if (state.lungeWeight > 0 && !finishing) {
    const lungePose = sampleVanguardSword({
      ...input,
      isLunging: true,
      lungeTime: state.lungeElapsed,
    });
    pose.offset.lerp(lungePose.offset, state.lungeWeight);
    pose.rotation.slerp(lungePose.rotation, state.lungeWeight);
    for (const key of [
      "torsoYaw",
      "shoulderYaw",
      "shoulderLift",
      "guardWeight",
    ] as const)
      pose[key] = THREE.MathUtils.lerp(
        pose[key],
        lungePose[key],
        state.lungeWeight,
      );
    pose.phase = input.isLunging ? "lunge" : "lunge-recovery";
  }
  root.userData.ironVanguardSwordPhase = pose.phase;
  root.updateWorldMatrix(true, true);
  const basis = root.getWorldQuaternion(new THREE.Quaternion());
  const turn = (
    bone: THREE.Object3D | undefined,
    axis: THREE.Vector3,
    angle: number,
  ) => {
    if (!bone?.parent || !angle) return;
    axis
      .applyQuaternion(basis)
      .applyQuaternion(
        bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      );
    bone.quaternion.premultiply(
      new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle),
    );
    bone.updateWorldMatrix(false, true);
  };
  // The chest leads and the shoulder follows; the legs keep their locomotion pose.
  for (const name of ["Spine02", "Spine01", "Spine"])
    turn(bones[name], new THREE.Vector3(0, 1, 0), pose.torsoYaw / 3);
  turn(bones.RightShoulder, new THREE.Vector3(0, 1, 0), pose.shoulderYaw);
  turn(bones.RightShoulder, new THREE.Vector3(0, 0, 1), pose.shoulderLift);
  const arm = bones.RightArm,
    elbow = bones.RightForeArm,
    hand = bones.RightHand;
  if (!arm || !elbow || !hand) return;
  const neutralWrist = hand.quaternion.clone();
  const travel = viewCut ? new THREE.Vector3() : pose.offset.clone();
  if (input.viewHandOffset && !viewCut) {
    travel.y *= 0.4;
    if (travel.x > 0) {
      travel.x *= 0.6;
      travel.z -= travel.x * 0.6;
    }
  }
  const target = hand
    .getWorldPosition(new THREE.Vector3())
    .add(
      travel
        .add(input.viewHandOffset ?? new THREE.Vector3())
        .applyQuaternion(basis),
    );
  // Keep the elbow outward/downward as the blade crosses the chest, while
  // preserving the approved elbow position at rest.
  const pole = elbow
    .getWorldPosition(new THREE.Vector3())
    .lerp(
      arm
        .getWorldPosition(new THREE.Vector3())
        .add(
          new THREE.Vector3(0.32, -0.26, 0.06)
            .lerp(
              input.viewHandOffset
                ? new THREE.Vector3(0.16, 0.18, -0.06)
                : new THREE.Vector3(0.2, -0.12, 0.02),
              state.lungeWeight,
            )
            .applyQuaternion(basis),
        ),
      viewCut ? 0 : pose.guardWeight,
    );
  solveLimb(
    root,
    arm,
    elbow,
    hand,
    target,
    hand.getWorldQuaternion(new THREE.Quaternion()),
    pole,
  );
  // Preserve the authored wrist-to-forearm relationship. The whole arm carries
  // the blade through the arc; independently aiming the wrist made both attacks
  // collapse into a straight poke and caused large axial wrist rotations.
  hand.quaternion.copy(neutralWrist);
  if (viewCut) {
    const worldRotation = basis
      .clone()
      .multiply(pose.rotation)
      .multiply(basis.clone().invert());
    arm.quaternion.copy(
      arm
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(
          worldRotation.multiply(
            arm.getWorldQuaternion(new THREE.Quaternion()),
          ),
        ),
    );
    arm.updateWorldMatrix(false, true);
  }
  if (state.lungeWeight > 0 && !finishing) {
    hand.updateWorldMatrix(false, false);
    // Blade centerline measured from the shipping prop in calibrated hand space.
    const worldHand = hand.getWorldQuaternion(new THREE.Quaternion());
    const blade = new THREE.Vector3(-0.286, 0.949, 0.136)
      .normalize()
      .applyQuaternion(worldHand);
    const correction = new THREE.Quaternion().setFromUnitVectors(
      blade,
      new THREE.Vector3(0, 0, -1).applyQuaternion(basis),
    );
    const angle = new THREE.Quaternion().angleTo(correction);
    correction.slerp(
      new THREE.Quaternion(),
      1 -
        Math.min(1, 0.65 / Math.max(angle, 0.001)) *
          pose.guardWeight *
          state.lungeWeight,
    );
    hand.quaternion.copy(
      hand
        .parent!.getWorldQuaternion(new THREE.Quaternion())
        .invert()
        .multiply(correction.multiply(worldHand)),
    );
  }
  const offhand = bones.LeftHand;
  if (offhand && bones.LeftArm && bones.LeftForeArm && pose.guardWeight > 0) {
    const offTarget = offhand
      .getWorldPosition(new THREE.Vector3())
      .add(
        new THREE.Vector3(0.035, 0.09, -0.04)
          .multiplyScalar(pose.guardWeight)
          .applyQuaternion(basis),
      );
    solveLimb(
      root,
      bones.LeftArm,
      bones.LeftForeArm,
      offhand,
      offTarget,
      offhand.getWorldQuaternion(new THREE.Quaternion()),
    );
  }
  if (input.isLunging) {
    state.lungeArmPose = Object.fromEntries(
      idleTracks.flatMap(({ bone }) =>
        bones[bone] ? [[bone, bones[bone].quaternion.clone()]] : [],
      ),
    );
  } else if (finishing && state.lungeArmPose) {
    for (const [name, rotation] of Object.entries(state.lungeArmPose)) {
      const bone = bones[name];
      if (bone)
        bone.quaternion.copy(
          rotation.clone().slerp(bone.quaternion, contactBlend),
        );
    }
    if (viewCut) pose.offset.multiplyScalar(contactBlend);
  }
  root.updateWorldMatrix(false, true);
  // Only the camera view consumes this translation; gameplay roots never move.
  return viewCut ? pose.offset : undefined;
}
export function applyVanguardFirstPersonSword(
  root: THREE.Group,
  input: VanguardSwordInput,
  bob = [0, 0, 0],
) {
  const pose = sampleVanguardSword({ ...input, localRecovery: true });
  root.position.set(
    0.3 + pose.offset.x,
    -0.34 + pose.offset.y + bob[1],
    -0.52 + pose.offset.z + bob[0],
  );
  root.quaternion.copy(pose.rotation).multiply(referenceRotation);
  root.rotateZ(bob[2]);
  root.userData.ironVanguardSwordPhase = pose.phase;
}
