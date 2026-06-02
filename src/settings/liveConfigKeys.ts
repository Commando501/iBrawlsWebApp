import { UniversalSettings } from '../types';
import {
  DEFAULT_ADMIN_SETTINGS,
  PersistedGameplaySettings,
  stripPlayerIdentitySettings,
} from './gameplaySettings';

/**
 * The set of gameplay-mechanic keys governed by the Official Multiplayer Preset
 * (live tuning). This is exactly `PersistedGameplaySettings` — i.e. every key in
 * `UniversalSettings` except the player-identity keys (`playerHue` / `playerName`).
 *
 * Derived at runtime from `DEFAULT_ADMIN_SETTINGS` so it stays in sync automatically
 * as settings are added. The Worker keeps a hand-mirrored copy in
 * `worker/src/liveConfigKeys.ts`; `liveConfig.test.ts` asserts the two never drift.
 */
export const LIVE_CONFIG_KEYS: (keyof PersistedGameplaySettings)[] = (
  Object.keys(stripPlayerIdentitySettings(DEFAULT_ADMIN_SETTINGS)) as (keyof PersistedGameplaySettings)[]
).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

export const LIVE_CONFIG_KEY_SET: ReadonlySet<string> = new Set(LIVE_CONFIG_KEYS as string[]);

/** Returns true when `key` is a governed live-config mechanic key. */
export const isLiveConfigKey = (key: string): key is keyof PersistedGameplaySettings =>
  LIVE_CONFIG_KEY_SET.has(key);

/**
 * Picks only the governed mechanic keys from an arbitrary settings-like object,
 * dropping unknown / identity keys. Used before publishing and when applying a
 * remote preset so identity (`playerHue`/`playerName`) is never overwritten.
 */
export const pickLiveConfigSettings = (
  settings: Partial<UniversalSettings>
): Partial<PersistedGameplaySettings> => {
  const out: Record<string, unknown> = {};
  for (const key of LIVE_CONFIG_KEYS) {
    const value = (settings as Record<string, unknown>)[key as string];
    if (value !== undefined) out[key as string] = value;
  }
  return out as Partial<PersistedGameplaySettings>;
};
