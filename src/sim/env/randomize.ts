/**
 * Domain randomization over the live-tunable **dynamics** settings (the ✅ "wired" set from
 * `SIM_AUDIT.md`). Each match samples a perturbed settings object, so a policy trained across
 * the distribution stays robust to balance patches — small/moderate preset tweaks land inside
 * its training band instead of breaking its baked-in spacing/timing assumptions.
 *
 * Pure + RNG-driven (no `Math.random`), so randomized matches remain reproducible.
 */

import { type UniversalSettings } from '../../types';
import { type Rng } from '../rng';

export interface RandomizeSpec {
  /** Master switch. When false, `randomizeSettings` returns the base unchanged. */
  enabled: boolean;
  /** Symmetric fraction each key is jittered by, e.g. 0.15 = ±15%. */
  pct: number;
  /** Keys to randomize; defaults to {@link DOMAIN_RANDOMIZABLE_KEYS}. */
  keys?: (keyof UniversalSettings)[];
}

/**
 * The continuous "feel" knobs the sim actually models and reads. Deliberately excludes:
 * `maxHP` (discrete, central), match-flow (`grifballGoalTarget` / countdowns), enable-toggles,
 * and `hammerJumpAirLimit` (small int) — randomizing those changes the task, not the feel.
 */
export const DOMAIN_RANDOMIZABLE_KEYS: (keyof UniversalSettings)[] = [
  'speedForward', 'speedBackward', 'speedSide',
  'dashDistance', 'dashDuration', 'dashCooldown',
  'respawnInvulnerabilityDuration', 'weaponSwapLockout', 'weaponReadyTime',
  'attackRange', 'attackRadius',
  'hammerReloadTime', 'hammerMeleeSpeed', 'hammerMeleeReload',
  'swordSlashSpeed', 'swordSlashReload',
  'swordLungeDistance', 'swordLungeSpeed', 'swordLungeReload',
  'hammerJumpPower', 'hammerJumpWindow',
  'swordTradeWindow', 'hammerSwordTradeWindow',
  'grifballPickupRadius', 'grifballBallReturnTimeout',
  'grifballPassSpeedMin', 'grifballPassSpeedMax', 'grifballChargeMax',
];

const MIN_VALUE = 0.001; // keep durations/speeds strictly positive

/**
 * Return a copy of `base` with each randomizable numeric key scaled by a uniform factor in
 * `[1 - pct, 1 + pct]`. Non-numeric / unlisted keys pass through unchanged.
 */
export function randomizeSettings(
  base: UniversalSettings,
  spec: RandomizeSpec,
  rng: Rng
): UniversalSettings {
  if (!spec.enabled || spec.pct <= 0) return base;
  const keys = spec.keys ?? DOMAIN_RANDOMIZABLE_KEYS;
  const out: UniversalSettings = { ...base };

  for (const key of keys) {
    const v = base[key];
    // Skip non-numeric and non-positive (zero-default toggles like input gates) — a
    // multiplicative factor can't move 0, and the positivity clamp would spuriously bump it.
    if (typeof v !== 'number' || v <= 0) continue;
    const factor = 1 + rng.range(-spec.pct, spec.pct);
    (out as unknown as Record<string, number>)[key as string] = Math.max(MIN_VALUE, v * factor);
  }

  // Keep the pass-speed pair ordered after independent jitter.
  const lo = out.grifballPassSpeedMin;
  const hi = out.grifballPassSpeedMax;
  if (typeof lo === 'number' && typeof hi === 'number' && lo > hi) {
    out.grifballPassSpeedMin = hi;
    out.grifballPassSpeedMax = lo;
  }
  return out;
}
