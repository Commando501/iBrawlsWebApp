import { IRON_VANGUARD_TIMING } from "../game/ironVanguardTiming";
import { resolveHammerSlamTiming } from "../game/hammerSlamTiming";
import type { UniversalSettings } from "../types";

export const SWING_FPS = 30;
export const SWING_FRAMES = [0, 24, 34, 42, 70] as const;
export const SWING_PHASES = [
  "Wind-up",
  "Strike",
  "Follow-through",
  "Recovery",
] as const;
export type SwingTiming = readonly [number, number, number, number];
// User-selected preview timing, accepted on 2026-10-13.
export const SAVED_SWING_TIMING: SwingTiming = IRON_VANGUARD_TIMING;
export const AUTHORED_SWING_TIMING: SwingTiming = [
  24 / 30,
  10 / 30,
  8 / 30,
  28 / 30,
];

export function gameSwingTiming(
  settings: Partial<UniversalSettings> = {},
): SwingTiming {
  const { windupTime, attackTime } = resolveHammerSlamTiming(settings);
  const reload = settings.hammerReloadTime;
  const recovery =
    typeof reload === "number" && Number.isFinite(reload) && reload > 0
      ? reload
      : 0.6;
  const follow = recovery * IRON_VANGUARD_TIMING[2] / (IRON_VANGUARD_TIMING[2] + IRON_VANGUARD_TIMING[3]);
  return [windupTime, attackTime, follow, recovery - follow];
}

export function swingDuration(timing: SwingTiming): number {
  if (timing.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError("Each swing phase needs a positive, finite duration.");
  }
  return timing.reduce((sum, value) => sum + value, 0);
}

export function sampleSwing(elapsed: number, timing: SwingTiming) {
  const total = swingDuration(timing);
  let remaining = Math.max(
    0,
    Math.min(total, Number.isFinite(elapsed) ? elapsed : 0),
  );
  for (let phase = 0; phase < 4; phase++) {
    if (remaining < timing[phase] || phase === 3) {
      const progress = Math.min(1, remaining / timing[phase]);
      const frame =
        SWING_FRAMES[phase] +
        (SWING_FRAMES[phase + 1] - SWING_FRAMES[phase]) * progress;
      return {
        frame,
        sourceTime: frame / SWING_FPS,
        phase: SWING_PHASES[phase],
        finished: elapsed >= total,
      };
    }
    remaining -= timing[phase];
  }
  throw new Error("Unreachable swing phase");
}

export function timeAtSwingFrame(frame: number, timing: SwingTiming): number {
  swingDuration(timing);
  const f = Math.max(0, Math.min(70, Number.isFinite(frame) ? frame : 0));
  let elapsed = 0;
  for (let phase = 0; phase < 4; phase++) {
    if (f <= SWING_FRAMES[phase + 1]) {
      return (
        elapsed +
        (timing[phase] * (f - SWING_FRAMES[phase])) /
          (SWING_FRAMES[phase + 1] - SWING_FRAMES[phase])
      );
    }
    elapsed += timing[phase];
  }
  return elapsed;
}

/** Counts crossed impact markers, including a long frame that skips the marker or whole loops. */
export function crossedSwingImpacts(
  before: number,
  after: number,
  timing: SwingTiming,
  loop = false,
): number {
  const duration = swingDuration(timing);
  if (!Number.isFinite(before) || !Number.isFinite(after) || after <= before)
    return 0;
  const impact = timing[0] + timing[1];
  const count = (time: number) =>
    time + 1e-10 < impact
      ? 0
      : loop
        ? Math.floor((time - impact + 1e-10) / duration) + 1
        : 1;
  return Math.max(0, count(after) - count(before));
}
