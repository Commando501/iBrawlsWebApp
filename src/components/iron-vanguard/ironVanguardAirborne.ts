import * as THREE from "three";

export type VanguardPose = Record<string, number[]>;
export interface VanguardAirState {
  velocity: THREE.Vector3;
  time: number;
  lead: "Left" | "Right";
}
export const createVanguardAirState = (): VanguardAirState => ({
  velocity: new THREE.Vector3(),
  time: 0,
  lead: "Left",
});

/** Shape the baked airborne pose in body space; simulation still owns the trajectory. */
export function shapeVanguardAirPose(
  pose: VanguardPose,
  reference: VanguardPose,
  air: VanguardAirState,
  yaw: number,
  verticalSpeed: number,
) {
  const speed = air.velocity.length();
  const amount = THREE.MathUtils.smoothstep(speed, 0.15, 6);
  const direction = air.velocity
    .clone()
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
  if (speed > 0.001) direction.divideScalar(speed);
  const extension = THREE.MathUtils.smoothstep(-verticalSpeed, 1, 7);
  const tuck = 1 - extension * 0.85;
  const weight = amount * THREE.MathUtils.smoothstep(air.time, 0, 0.12);
  for (const side of ["Left", "Right"] as const) {
    const lead = side === air.lead;
    const foot = pose[side + "FootTarget.position"];
    const neutral = reference[side + "FootTarget.position"];
    const reach = (lead ? 0.1 + 0.14 * amount : -0.07 - 0.09 * amount) * weight;
    foot[0] = neutral[0] + direction.x * reach;
    // Keep knees and boots on their own side even during rearward look changes.
    foot[0] =
      side === "Left" ? Math.min(-0.14, foot[0]) : Math.max(0.14, foot[0]);
    foot[1] =
      THREE.MathUtils.lerp(foot[1], neutral[1], extension * 0.9) +
      (lead ? 0.16 : 0.06) * weight * tuck;
    foot[2] =
      THREE.MathUtils.lerp(foot[2], neutral[2], amount) + direction.z * reach;
    const knee = pose[side + "KneeTarget.position"];
    knee[0] += direction.x * reach * 0.35;
    knee[1] += (lead ? 0.06 : 0.02) * weight * tuck;
    knee[2] -= 0.08 * weight * tuck;
  }
  // The source skeleton uses Z-up centimetres, while foot targets use game-space metres.
  // A modest travel lean is transferred identically to the pelvis and weapon by the caller.
  const lean = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(direction.z * 0.1 * weight, direction.x * 0.08 * weight, 0),
  );
  new THREE.Quaternion()
    .fromArray(pose["Hips.quaternion"])
    .premultiply(lean)
    .normalize()
    .toArray(pose["Hips.quaternion"]);
}

/** Keep strides alive during impact absorption instead of waiting in a two-foot landing. */
export function movingVanguardLanding(
  landing: VanguardPose,
  gait: VanguardPose,
  reference: VanguardPose,
  weight: number,
): VanguardPose {
  const compression =
    (landing["Hips.position"][2] - reference["Hips.position"][2]) * 0.55;
  for (const [name, values] of Object.entries(gait)) {
    const from = landing[name];
    if (name.endsWith(".quaternion")) {
      new THREE.Quaternion()
        .fromArray(from)
        .slerp(new THREE.Quaternion().fromArray(values), weight)
        .normalize()
        .toArray(from);
    } else {
      for (let i = 0; i < values.length; i++)
        from[i] = THREE.MathUtils.lerp(from[i], values[i], weight);
    }
  }
  landing["Hips.position"][2] += compression * weight;
  return landing;
}
