import type { UniversalSettings } from "../types";
import { resolveHammerSlamTiming } from "./hammerSlamTiming";

export const IRON_VANGUARD_TIMING = [0.3, 0.2, 0.1, 1.0] as const;

/** The gameplay state owns time and impacts; the character only samples the matching pose. */
export function ironVanguardSourceFrame(
  state: string,
  timer: number,
  settings: Partial<UniversalSettings> = {},
): number {
  const { windupTime, attackTime } = resolveHammerSlamTiming(settings);
  timer = Number.isFinite(timer) ? Math.max(0, timer) : 0;
  const fraction = (duration: number) =>
    Math.max(0, Math.min(1, timer / Math.max(0.001, duration)));
  const melee =
    settings.hammerMeleeSpeed &&
    Number.isFinite(settings.hammerMeleeSpeed) &&
    settings.hammerMeleeSpeed > 0
      ? settings.hammerMeleeSpeed
      : 0.24;
  // Reuse the authored swing for provisional quick melee; its impact is halfway
  // through the local swing, or at the end of the remote downstroke.
  if (state === "melee_swing") return 34 * fraction(melee * 0.5);
  if (state === "melee_up") return 24 * fraction(melee * 0.4);
  if (state === "melee_down") return 24 + 10 * fraction(melee * 0.6);
  if (state === "melee_recover") {
    const recovery =
      settings.hammerMeleeReload &&
      Number.isFinite(settings.hammerMeleeReload) &&
      settings.hammerMeleeReload > 0
        ? settings.hammerMeleeReload
        : 0.5;
    return 34 + 36 * fraction(recovery);
  }
  if (state === "swing_up") return 24 * fraction(windupTime);
  if (state === "swing_down") return 24 + 10 * fraction(attackTime);
  if (state === "recovering") {
    const value = settings.hammerReloadTime;
    const reload =
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : 0.6;
    const follow =
      (reload * IRON_VANGUARD_TIMING[2]) /
      (IRON_VANGUARD_TIMING[2] + IRON_VANGUARD_TIMING[3]);
    return timer <= follow
      ? 34 + 8 * fraction(follow)
      : 42 +
          28 *
            Math.max(
              0,
              Math.min(1, (timer - follow) / Math.max(0.001, reload - follow)),
            );
  }
  return 0;
}
