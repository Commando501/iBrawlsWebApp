import * as THREE from "three";
import type { UniversalSettings } from "../../types";
import { VANGUARD_SWORD_IDLE } from "./ironVanguardSword.generated";
import { solveLimb } from "./ironVanguardMovement";
import { buildV3SkullBombModel } from "../v3/v3SkullBombModel";
import { V3_SKULL_BOMB } from "../v3/v3SkullBomb.generated";

export const VANGUARD_BALL_THROW_DURATION = 0.46;
// Visual release follows the elbow drive; gameplay launches immediately on input release.
export const VANGUARD_BALL_HANDOFF_START = 0.075;
export const VANGUARD_BALL_HANDOFF_END = 0.14;
export interface VanguardBallInput {
  weaponState: string;
  weaponTimer: number;
  ballCharge?: number;
  ballThrowTime?: number;
  ballReleaseCharge?: number;
  ballView?: boolean;
  settings?: Partial<UniversalSettings>;
  hp?: number;
  previewTime?: number;
}
const smooth = (t: number) => THREE.MathUtils.smoothstep(t, 0, 1);
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
// Metres relative to the animated chest. Root motion remains owned by gameplay.
const carry = v(0.32, -0.2, -0.18);
const gathered = v(0.29, -0.02, -0.24);
const cocked = v(0.44, 0.25, -0.06);
const release = v(0.24, 0.15, -0.38);
const follow = v(-0.08, -0.16, -0.2);
const guard = v(-0.29, -0.2, -0.18);
const punchBack = v(-0.25, -0.08, 0.04);
const punchOut = v(-0.15, 0.1, -0.55);

type ThrowPose = {
  hand: THREE.Vector3;
  offhand: THREE.Vector3;
  elbow: THREE.Vector3;
  torsoYaw: number;
  torsoPitch: number;
  wristPitch: number;
  forearmRoll: number;
  fingerOpen: number;
  lift: number;
  punchExtension: number;
};
// Calibrates the neutral cup to the imported right-hand rig. Camera pose rolls are
// signed offsets about elbow-to-wrist. The delivery continues toward a palm-down
// finish instead of reversing into a palm-up scoop.
const CAMERA_CARRY_ROLL = 0.8;
const BODY_CARRY_ROLL = 0.6;
// The hand loads beside the ear, partly outside the right edge of the camera.
// Forcing the entire bomb on screen puts the elbow in front of the raised wrist.
// They share the body animation's phases, release and gameplay clocks.
const cameraPoses = {
  carry: {
    hand: v(0.27, 0.12, -0.36),
    offhand: v(-0.25, 0.1, -0.32),
    elbow: v(0.42, -0.22, 0.06),
    forearmRoll: 0,
  },
  gather: {
    hand: v(0.32, 0.23, -0.3),
    offhand: v(-0.22, 0.14, -0.34),
    elbow: v(0.56, -0.15, 0.02),
    torsoYaw: -0.03,
    torsoPitch: 0,
    wristPitch: 0,
    forearmRoll: -0.25,
    lift: 0.3,
  },
  pocket: {
    hand: v(0.44, 0.38, -0.02),
    offhand: v(-0.22, 0.19, -0.36),
    elbow: v(0.64, 0.01, 0.04),
    torsoYaw: -0.08,
    torsoPitch: 0,
    wristPitch: 0.08,
    forearmRoll: -1.4,
    lift: 1,
  },
  lead: {
    hand: v(0.43, 0.43, -0.06),
    offhand: v(-0.25, 0.12, -0.3),
    elbow: v(0.52, 0.09, -0.28),
    torsoYaw: 0,
    torsoPitch: 0,
    wristPitch: 0.06,
    forearmRoll: -1.8,
    lift: 1,
  },
  extended: {
    hand: v(0.16, 0.32, -0.37),
    elbow: v(0.38, 0.06, -0.34),
    torsoYaw: 0.04,
    torsoPitch: 0,
    wristPitch: 0.2,
    forearmRoll: -2.4,
    lift: 1,
  },
  finish: {
    hand: v(-0.04, -0.04, -0.29),
    offhand: v(-0.25, 0.06, -0.3),
    elbow: v(0.4, 0.16, -0.16),
    torsoYaw: 0.06,
    torsoPitch: 0,
    wristPitch: 0.3,
    forearmRoll: -2.2,
    lift: 1,
  },
  punchWindup: {
    offhand: v(-0.29, 0.16, -0.22),
    torsoYaw: 0.07,
    torsoPitch: 0,
  },
  punchStrike: {
    offhand: v(-0.1, 0.31, -0.39),
    torsoYaw: -0.06,
    torsoPitch: 0,
  },
} satisfies Record<string, Partial<ThrowPose>>;
function viewPose(
  pose: ThrowPose,
  stage: keyof typeof cameraPoses,
  view: boolean,
): ThrowPose {
  return view ? { ...pose, ...cameraPoses[stage] } : pose;
}
function carryPose(view = false): ThrowPose {
  return viewPose(
    {
      hand: carry.clone(),
      offhand: guard.clone(),
      elbow: v(0.46, -0.23, 0.03),
      torsoYaw: 0,
      torsoPitch: 0,
      wristPitch: 0,
      forearmRoll: 0,
      fingerOpen: 0,
      lift: 0,
      punchExtension: 0,
    },
    "carry",
    view,
  );
}
function blendThrow(a: ThrowPose, b: ThrowPose, t: number): ThrowPose {
  const weight = smooth(t);
  return {
    hand: a.hand.clone().lerp(b.hand, weight),
    offhand: a.offhand.clone().lerp(b.offhand, weight),
    elbow: a.elbow.clone().lerp(b.elbow, weight),
    torsoYaw: THREE.MathUtils.lerp(a.torsoYaw, b.torsoYaw, weight),
    torsoPitch: THREE.MathUtils.lerp(a.torsoPitch, b.torsoPitch, weight),
    wristPitch: THREE.MathUtils.lerp(a.wristPitch, b.wristPitch, weight),
    forearmRoll: THREE.MathUtils.lerp(a.forearmRoll, b.forearmRoll, weight),
    lift: THREE.MathUtils.lerp(a.lift, b.lift, weight),
    fingerOpen: THREE.MathUtils.lerp(a.fingerOpen, b.fingerOpen, weight),
    punchExtension: THREE.MathUtils.lerp(
      a.punchExtension,
      b.punchExtension,
      weight,
    ),
  };
}
type ThrowKey = { time: number; pose: ThrowPose };
/** Time-aware Hermite tangents keep the hand moving through the elbow lead and release. */
function sampleThrowCurve(keys: ThrowKey[], time: number): ThrowPose {
  const end = keys.findIndex((key) => key.time > time);
  if (end < 0) return keys[keys.length - 1].pose;
  const i = Math.max(0, end - 1),
    j = i + 1;
  const a = keys[i],
    b = keys[j];
  const span = b.time - a.time;
  const u = THREE.MathUtils.clamp((time - a.time) / span, 0, 1);
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1,
    h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2,
    h11 = u ** 3 - u ** 2;
  const before = keys[Math.max(0, i - 1)],
    after = keys[Math.min(keys.length - 1, j + 1)];
  const mix = (get: (pose: ThrowPose) => number) => {
    const va =
      i === 0 ? 0 : (get(b.pose) - get(before.pose)) / (b.time - before.time);
    const vb =
      j === keys.length - 1
        ? 0
        : (get(after.pose) - get(a.pose)) / (after.time - a.time);
    return (
      h00 * get(a.pose) + h10 * span * va + h01 * get(b.pose) + h11 * span * vb
    );
  };
  const result = { ...a.pose };
  for (const name of ["hand", "offhand", "elbow"] as const)
    result[name] = v(
      mix((p) => p[name].x),
      mix((p) => p[name].y),
      mix((p) => p[name].z),
    );
  for (const name of [
    "torsoYaw",
    "torsoPitch",
    "wristPitch",
    "forearmRoll",
    "lift",
    "fingerOpen",
    "punchExtension",
  ] as const)
    result[name] = mix((p) => p[name]);
  return result;
}
function chargePose(charge: number, view = false): ThrowPose {
  const gather = viewPose(
    {
      ...carryPose(view),
      hand: gathered,
      offhand: v(-0.2, -0.05, -0.31),
      elbow: v(0.51, -0.16, 0.06),
      torsoYaw: -0.28,
      torsoPitch: 0.02,
      wristPitch: 0.02,
      forearmRoll: -0.25,
      fingerOpen: 0,
      lift: 0.25,
    },
    "gather",
    view,
  );
  const pocket = viewPose(
    {
      ...gather,
      hand: cocked,
      offhand: v(-0.23, -0.02, -0.3),
      elbow: v(0.66, 0.15, 0.08),
      // A broad, early coil makes a charged pass readable to opponents.
      torsoYaw: -1.05,
      torsoPitch: 0.08,
      wristPitch: 0.08,
      forearmRoll: -1.0,
      fingerOpen: 0,
      lift: 1,
    },
    "pocket",
    view,
  );
  if (view)
    return sampleThrowCurve(
      [
        { time: 0, pose: carryPose(true) },
        { time: 0.22, pose: gather },
        { time: 1, pose: pocket },
      ],
      charge,
    );
  const pose = sampleThrowCurve(
    [
      { time: 0, pose: carryPose() },
      { time: 0.22, pose: gather },
      { time: 1, pose: pocket },
    ],
    charge,
  );
  // The shoulder silhouette is a direct readout of gameplay strength. Never
  // reach the full coil early: 25/50/75/100% charge show 15/30/45/60 degrees.
  pose.torsoYaw = pocket.torsoYaw * charge;
  return pose;
}

/** Football delivery: gather, shoulder coil, elbow lead, extension, cross-body finish. */
export function sampleVanguardBall(input: VanguardBallInput) {
  const view = Boolean(input.ballView);
  let pose = carryPose(view);
  let phase = "carry";
  const throwTime = input.ballThrowTime;
  const charge = THREE.MathUtils.clamp(input.ballCharge ?? 0, 0, 1);
  if (
    throwTime !== undefined &&
    throwTime >= 0 &&
    throwTime < VANGUARD_BALL_THROW_DURATION
  ) {
    phase = throwTime < 0.13 ? "release" : "follow-through";
    const start = chargePose(input.ballReleaseCharge ?? 1, view);
    const lead = viewPose(
      {
        ...start,
        hand: v(0.4, 0.3, -0.03),
        offhand: v(-0.25, -0.08, -0.18),
        elbow: v(0.52, 0.14, -0.12),
        torsoYaw: -0.5,
        torsoPitch: -0.04,
        wristPitch: 0.06,
        forearmRoll: -1.4,
        fingerOpen: 0,
        lift: 1,
      },
      "lead",
      view,
    );
    const extended = viewPose(
      {
        ...lead,
        hand: release,
        elbow: v(0.4, 0.08, -0.27),
        torsoYaw: 0.32,
        torsoPitch: -0.13,
        wristPitch: 0.2,
        forearmRoll: -2.0,
        fingerOpen: 1,
      },
      "extended",
      view,
    );
    const finish = viewPose(
      {
        ...extended,
        hand: follow,
        offhand: v(-0.29, -0.18, -0.12),
        elbow: v(0.26, 0.02, -0.16),
        torsoYaw: 0.42,
        torsoPitch: -0.18,
        wristPitch: 0.3,
        forearmRoll: -1.8,
      },
      "finish",
      view,
    );
    if (view) {
      // A tap drives from the current hand position; only a charged throw uses the full cock.
      const load = smooth(
        THREE.MathUtils.clamp(input.ballReleaseCharge ?? 1, 0, 1),
      );
      const tapLead = {
        ...start,
        hand: start.hand.clone().add(v(-0.01, 0.04, -0.015)),
        forearmRoll: start.forearmRoll - 0.6,
      };
      const cameraLead = blendThrow(tapLead, lead, load);
      const cameraExtension = {
        ...extended,
        forearmRoll: THREE.MathUtils.lerp(-1.65, extended.forearmRoll, load),
      };
      const cameraFinish = {
        ...finish,
        forearmRoll: THREE.MathUtils.lerp(-1.8, finish.forearmRoll, load),
      };
      pose = sampleThrowCurve(
        [
          { time: 0, pose: start },
          { time: 0.055, pose: cameraLead },
          { time: 0.12, pose: cameraExtension },
          { time: 0.26, pose: cameraFinish },
          { time: VANGUARD_BALL_THROW_DURATION, pose: carryPose(true) },
        ],
        throwTime,
      );
    } else {
      const load = smooth(
        THREE.MathUtils.clamp(input.ballReleaseCharge ?? 1, 0, 1),
      );
      const tapLead = {
        ...start,
        hand: start.hand.clone().add(v(-0.01, 0.04, -0.015)),
        forearmRoll: start.forearmRoll - 0.6,
      };
      pose = sampleThrowCurve(
        [
          { time: 0, pose: start },
          { time: 0.055, pose: blendThrow(tapLead, lead, load) },
          { time: 0.13, pose: extended },
          { time: 0.27, pose: finish },
          { time: VANGUARD_BALL_THROW_DURATION, pose: carryPose() },
        ],
        throwTime,
      );
    }
    const closeTime = view ? 0.26 : 0.27;
    pose.fingerOpen =
      throwTime < closeTime
        ? THREE.MathUtils.smoothstep(
            throwTime,
            VANGUARD_BALL_HANDOFF_START,
            VANGUARD_BALL_HANDOFF_END,
          )
        : 1 -
          THREE.MathUtils.smoothstep(
            throwTime,
            closeTime,
            VANGUARD_BALL_THROW_DURATION,
          );
  } else if (charge > 0) {
    phase = "charge";
    pose = chargePose(charge, view);
  } else {
    // Load the left shoulder, then drive it through the punch on the existing clock.
    const windup = viewPose(
      {
        ...carryPose(view),
        offhand: punchBack,
        torsoYaw: 1.05,
        torsoPitch: 0.04,
      },
      "punchWindup",
      view,
    );
    const strike = viewPose(
      {
        ...carryPose(view),
        offhand: punchOut,
        punchExtension: 1,
        torsoYaw: -0.4,
        torsoPitch: -0.08,
      },
      "punchStrike",
      view,
    );
    const speed = Math.max(0.001, input.settings?.hammerMeleeSpeed ?? 0.24);
    const recovery = Math.max(
      0.001,
      input.settings?.grifballPunchCooldown ?? 0.5,
    );
    const t = Math.max(0, input.weaponTimer);
    if (input.weaponState === "swing_up") {
      phase = "punch-windup";
      pose = blendThrow(carryPose(view), windup, t / speed);
    } else if (input.weaponState === "swing_down") {
      phase = "punch";
      pose = blendThrow(windup, strike, t / Math.max(0.03, speed * 0.5));
    } else if (
      ["melee_up", "melee_down", "melee_swing"].includes(input.weaponState)
    ) {
      const progress =
        input.weaponState === "melee_down" ? 0.4 + t / speed : t / speed;
      phase = progress < 0.4 ? "punch-windup" : "punch";
      pose =
        progress < 0.4
          ? blendThrow(carryPose(view), windup, progress / 0.4)
          : blendThrow(windup, strike, (progress - 0.4) / 0.6);
    } else if (["recovering", "melee_recover"].includes(input.weaponState)) {
      phase = "punch-recovery";
      pose = blendThrow(strike, carryPose(view), t / recovery);
      // Bring the jab back promptly while the shoulders finish their recovery.
      const retract = blendThrow(
        strike,
        carryPose(view),
        t / Math.min(0.22, recovery),
      );
      pose.offhand = retract.offhand;
      pose.punchExtension = retract.punchExtension;
    }
    // Carry the tucked ball with the ribcage as the free shoulder coils and unwinds.
    if (!view) {
      pose.hand.applyAxisAngle(v(0, 1, 0), pose.torsoYaw);
      pose.elbow.applyAxisAngle(v(0, 1, 0), pose.torsoYaw);
    }
  }
  if (
    !view &&
    (phase === "charge" || phase === "release" || phase === "follow-through")
  ) {
    // Author the arm paths in the coiling ribcage frame. A fixed world-space pole
    // crosses the shoulder-to-hand line and flips the elbow during a broad windup.
    pose = { ...pose };
    for (const key of ["hand", "elbow", "offhand"] as const)
      pose[key] = pose[key].clone().applyAxisAngle(v(0, 1, 0), pose.torsoYaw);
  }
  return { ...pose, phase };
}

const armRest = VANGUARD_SWORD_IDLE.tracks.filter((t) =>
  /^(Left|Right)(Shoulder|Arm|ForeArm|Hand)$/.test(t.name),
);
export function createVanguardBallProp() {
  const ball = buildV3SkullBombModel();
  ball.name = "Iron Vanguard held skull-bomb";
  ball.visible = false;
  return ball;
}

// Rotate around character axes, not imported joint axes; the lower body keeps its gait.
function rotateTorso(
  root: THREE.Group,
  bone: THREE.Object3D | undefined,
  axis: THREE.Vector3,
  angle: number,
) {
  if (!bone?.parent || Math.abs(angle) < 1e-8) return;
  axis
    .applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()))
    .applyQuaternion(
      bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
    );
  bone.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle),
  );
  bone.updateWorldMatrix(false, true);
}
// Imported hand axes mapped to fingers forward (-Z), palm up (+Y).
const gripBasis = new THREE.Quaternion(
  -0.63803156,
  0.30482081,
  -0.30482081,
  0.63803156,
).normalize();

// A broad cup around the casing; a handle fist folds the fingertips into the palm.
const fingerCurl: Record<string, readonly number[]> = {
  Index: [0.26, 0.26, 0.25],
  Middle: [0.24, 0.26, 0.25],
  Ring: [0.28, 0.3, 0.26],
  Pinky: [0.34, 0.34, 0.3],
  Thumb: [0.45, 0.18, 0.16],
};
const fingerSpread: Record<string, number> = {
  Index: -0.2,
  Middle: -0.06,
  Ring: 0.06,
  Pinky: 0.2,
  Thumb: -0.7,
};
const wristBindPoses = new WeakMap<THREE.Group, THREE.Quaternion>();
const elbowBindPoses = new WeakMap<THREE.Group, THREE.Quaternion>();
const fingerPoses = new WeakMap<
  THREE.Group,
  { bone: THREE.Object3D; open: THREE.Quaternion; cup: THREE.Quaternion }[]
>();
function poseBallFingers(root: THREE.Group, releaseWeight: number) {
  let poses = fingerPoses.get(root);
  if (!poses) {
    poses = [];
    const seen = new Set<THREE.Object3D>();
    root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const { bones, boneInverses } = object.skeleton;
      for (const [index, bone] of bones.entries()) {
        if (bone.name === "RightHand" || bone.name === "RightForeArm") {
          const parent = bones.indexOf(bone.parent as THREE.Bone);
          if (parent >= 0) {
            const local = boneInverses[parent]
              .clone()
              .multiply(boneInverses[index].clone().invert());
            const rotation = new THREE.Quaternion();
            local.decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
            (bone.name === "RightHand" ? wristBindPoses : elbowBindPoses).set(
              root,
              rotation.normalize(),
            );
          }
        }
        const match = /^DEF_(Index|Middle|Ring|Pinky|Thumb)_0([123])_R$/.exec(
          bone.name,
        );
        if (!match || seen.has(bone)) continue;
        seen.add(bone);
        const parent = bones.indexOf(bone.parent as THREE.Bone);
        if (parent < 0) continue;
        const local = boneInverses[parent]
          .clone()
          .multiply(boneInverses[index].clone().invert());
        const open = new THREE.Quaternion();
        local.decompose(new THREE.Vector3(), open, new THREE.Vector3());
        open.normalize();
        const curl = fingerCurl[match[1]][Number(match[2]) - 1];
        const cup = open
          .clone()
          .multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), -curl));
        if (match[2] === "1")
          cup.premultiply(
            new THREE.Quaternion().setFromAxisAngle(
              v(-0.78, 0, 0.63).normalize(),
              fingerSpread[match[1]],
            ),
          );
        poses!.push({ bone, open, cup });
      }
    });
    fingerPoses.set(root, poses);
  }
  for (const { bone, open, cup } of poses)
    bone.quaternion.copy(cup).slerp(open, releaseWeight);
}

const freeHandPoses = new WeakMap<
  THREE.Group,
  { bone: THREE.Bone; open: THREE.Quaternion; rotation: THREE.Quaternion }[]
>();
function poseFreeHand(root: THREE.Group, curl: number) {
  let poses = freeHandPoses.get(root);
  if (!poses) {
    poses = [];
    const seen = new Set<THREE.Bone>();
    root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const { bones, boneInverses } = object.skeleton;
      for (const [i, bone] of bones.entries()) {
        const finger = /^DEF_(Index|Middle|Ring|Pinky|Thumb)_0([123])_L$/.exec(
          bone.name,
        );
        if ((!finger && bone.name !== "LeftHand") || seen.has(bone)) continue;
        seen.add(bone);
        const parent = bones.indexOf(bone.parent as THREE.Bone);
        if (parent < 0) continue;
        const rotation = new THREE.Quaternion();
        boneInverses[parent]
          .clone()
          .multiply(boneInverses[i].clone().invert())
          .decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
        const open = rotation.clone().normalize();
        if (finger) {
          const joint = Number(finger[2]) - 1;
          const thumb = finger[1] === "Thumb";
          rotation.multiply(
            new THREE.Quaternion().setFromEuler(
              new THREE.Euler(
                -(thumb ? [0.6, 0.9, 0.65] : [1.25, 1.35, 0.8])[joint],
                thumb && joint === 0 ? -0.15 : 0,
                thumb && joint === 0 ? 0.4 : 0,
              ),
            ),
          );
        }
        poses!.push({ bone, open, rotation: rotation.normalize() });
      }
    });
    freeHandPoses.set(root, poses);
  }
  for (const { bone, open, rotation } of poses)
    bone.quaternion.copy(open).slerp(rotation, curl);
}

/** Body-led throw and punch layered over locomotion, with a stable hand attachment. */
export function applyVanguardBall(
  root: THREE.Group,
  bones: Record<string, THREE.Object3D>,
  input: VanguardBallInput,
) {
  if ((input.hp ?? 100) <= 0 || !bones.Spine) return;
  for (const track of armRest)
    bones[track.name]?.quaternion.fromArray(track.values).normalize();
  root.updateWorldMatrix(true, true);
  const pose = sampleVanguardBall(input);
  poseBallFingers(root, pose.fingerOpen);
  const bodyThrow =
    !input.ballView &&
    ["charge", "release", "follow-through"].includes(pose.phase);
  // A relaxed counterbalancing hand for the body throw; retain the closed punch guard.
  poseFreeHand(
    root,
    bodyThrow ? 1 - 0.45 * THREE.MathUtils.clamp(pose.lift, 0, 1) : 1,
  );
  for (const [name, weight] of [
    ["Spine02", 0.25],
    ["Spine01", 0.35],
    ["Spine", 0.4],
  ] as const) {
    rotateTorso(root, bones[name], v(0, 1, 0), pose.torsoYaw * weight);
    rotateTorso(root, bones[name], v(1, 0, 0), pose.torsoPitch * weight);
  }
  // Keep the eyes on target while either shoulder draws back.
  rotateTorso(root, bones.neck, v(0, 1, 0), -pose.torsoYaw * 0.8);
  const basis = root.getWorldQuaternion(new THREE.Quaternion());
  const chest = bones.Spine.getWorldPosition(new THREE.Vector3());
  for (const side of ["Right", "Left"] as const) {
    const arm = bones[side + "Arm"],
      elbow = bones[side + "ForeArm"],
      hand = bones[side + "Hand"];
    if (!arm || !elbow || !hand) continue;
    const neutral = hand.quaternion.clone();
    const target = chest
      .clone()
      .add(
        (side === "Right" ? pose.hand : pose.offhand)
          .clone()
          .applyQuaternion(basis),
      );
    if (side === "Left" && pose.punchExtension > 0) {
      // Drive the jab to this rig's full reach at impact. A small soft bend
      // keeps the elbow on its pole instead of locking or flipping at straight.
      const shoulder = arm.getWorldPosition(new THREE.Vector3());
      const joint = elbow.getWorldPosition(new THREE.Vector3());
      const reach =
        (shoulder.distanceTo(joint) +
          joint.distanceTo(hand.getWorldPosition(new THREE.Vector3()))) *
        0.998;
      const direction = target.clone().sub(shoulder);
      const distance = Math.min(
        reach,
        THREE.MathUtils.lerp(direction.length(), reach, pose.punchExtension),
      );
      target.copy(shoulder).addScaledVector(direction.normalize(), distance);
    }
    const pole = chest
      .clone()
      .add(
        (side === "Right"
          ? pose.elbow.clone()
          : v(-0.42, -0.23, 0.04).applyAxisAngle(
              v(0, 1, 0),
              bodyThrow ? pose.torsoYaw : 0,
            )
        ).applyQuaternion(basis),
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
    hand.quaternion.copy(neutral);
    if (side === "Right") {
      // Follow the forearm in the carry instead of bending the wrist to a weapon grip.
      const forward = hand
        .getWorldPosition(new THREE.Vector3())
        .sub(elbow.getWorldPosition(new THREE.Vector3()))
        .normalize();
      const wrist = new THREE.Quaternion();
      {
        // The elbow's bend plane gives a stable wrist frame even as the forearm passes vertical.
        const upper = elbow
          .getWorldPosition(new THREE.Vector3())
          .sub(arm.getWorldPosition(new THREE.Vector3()))
          .normalize();
        const hinge = upper.cross(forward).normalize();
        const palm = hinge.clone().cross(forward).normalize();
        const throwingWrist = new THREE.Quaternion()
          .setFromRotationMatrix(
            new THREE.Matrix4().makeBasis(
              hinge,
              palm,
              forward.clone().negate(),
            ),
          )
          .multiply(gripBasis);
        throwingWrist.premultiply(
          new THREE.Quaternion().setFromAxisAngle(
            forward,
            (input.ballView ? CAMERA_CARRY_ROLL : BODY_CARRY_ROLL) +
              pose.forearmRoll,
          ),
        );
        throwingWrist.premultiply(
          new THREE.Quaternion().setFromAxisAngle(
            v(1, 0, 0).applyQuaternion(
              throwingWrist.clone().multiply(gripBasis.clone().invert()),
            ),
            pose.wristPitch,
          ),
        );
        // Use one bend-plane frame from carry through recovery. Blending a world-up
        // frame into this one adds an unintended axial turn as the elbow rises.
        wrist.copy(throwingWrist);
      }
      // Supination belongs in the forearm. Leaving it in the wrist twists the cuff closed.
      const forearmWorld = elbow.getWorldQuaternion(new THREE.Quaternion());
      const desiredForearm = wrist
        .clone()
        .multiply((wristBindPoses.get(root) ?? neutral).clone().invert());
      const delta = desiredForearm.multiply(forearmWorld.clone().invert());
      const projected = forward
        .clone()
        .multiplyScalar(
          delta.x * forward.x + delta.y * forward.y + delta.z * forward.z,
        );
      const twist = new THREE.Quaternion(
        projected.x,
        projected.y,
        projected.z,
        delta.w,
      ).normalize();
      forearmWorld.premultiply(twist);
      const elbowBind = elbowBindPoses.get(root);
      if (elbowBind) {
        // Keep the upper arm's elbow hinge in the solved bend plane as the palm turns up.
        const upper = elbow
          .getWorldPosition(new THREE.Vector3())
          .sub(arm.getWorldPosition(new THREE.Vector3()))
          .normalize();
        const bend = upper.clone().cross(forward);
        const restBend = elbow.position
          .clone()
          .cross(hand.position.clone().applyQuaternion(elbowBind));
        if (bend.lengthSq() > 1e-8 && restBend.lengthSq() > 1e-8) {
          const armWorld = arm.getWorldQuaternion(new THREE.Quaternion());
          restBend.normalize().applyQuaternion(armWorld);
          bend.normalize();
          const roll = Math.atan2(
            upper.dot(restBend.clone().cross(bend)),
            restBend.dot(bend),
          );
          arm.quaternion.copy(
            arm
              .parent!.getWorldQuaternion(new THREE.Quaternion())
              .invert()
              .multiply(new THREE.Quaternion().setFromAxisAngle(upper, roll))
              .multiply(armWorld),
          );
          arm.updateWorldMatrix(false, true);
        }
      }
      elbow.quaternion.copy(
        elbow
          .parent!.getWorldQuaternion(new THREE.Quaternion())
          .invert()
          .multiply(forearmWorld),
      );
      elbow.updateWorldMatrix(false, true);
      wrist.premultiply(
        hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(),
      );
      hand.quaternion.copy(wrist);
    }
    hand.updateWorldMatrix(false, true);
  }
  root.updateWorldMatrix(false, true);
  root.userData.ironVanguardBallPhase = pose.phase;
}

/** Palm-space offset keeps the ball coupled to the hand through aim and movement. */
export function syncVanguardBallProp(
  root: THREE.Group,
  hand: THREE.Object3D,
  ball: THREE.Object3D,
) {
  const rotation = hand.getWorldQuaternion(new THREE.Quaternion());
  // Face outward from the character and seat the asset's underside grip in the palm.
  const bombRotation = rotation
    .clone()
    .multiply(gripBasis.clone().invert())
    .multiply(new THREE.Quaternion().setFromAxisAngle(v(0, 1, 0), Math.PI))
    .multiply(new THREE.Quaternion().setFromAxisAngle(v(1, 0, 0), -0.35));
  const palm = v(0, 0.012, -0.085)
    .applyQuaternion(gripBasis.clone().invert())
    .applyQuaternion(rotation);
  const offset = palm.sub(
    new THREE.Vector3(...V3_SKULL_BOMB.grip).applyQuaternion(bombRotation),
  );
  ball.position.copy(
    root.worldToLocal(hand.getWorldPosition(new THREE.Vector3()).add(offset)),
  );
  ball.quaternion.copy(
    root
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(bombRotation),
  );
  ball.updateWorldMatrix(false, true);
}
