import { MedalInfo } from '../types';

/**
 * Single source of truth for every medal the game can award. In-match
 * evaluation (rewards.ts), the death feed, and the lifetime Service Record all
 * read from this catalog so display data can never drift between systems.
 *
 * Adding a medal = add an entry here + award it from an evaluator. Lifetime
 * counting and the Service Record medal chest pick it up automatically.
 */
export const MEDAL_CATALOG: Record<string, MedalInfo> = {
  bulltrue: {
    id: 'bulltrue',
    name: 'Bulltrue',
    icon: 'bulltrue',
    color: 'rgb(239, 68, 68)',
    description: 'Killed an opponent during their sword lunge!',
  },
  spawnslayer: {
    id: 'spawnslayer',
    name: 'Spawn Slayer',
    icon: 'spawnslayer',
    color: 'rgb(34, 197, 94)',
    description: 'Killed an opponent within 1 second of spawning!',
  },
  closecall: {
    id: 'closecall',
    name: 'Close Call',
    icon: 'closecall',
    color: 'rgb(249, 115, 22)',
    description: 'Killed an opponent while near death!',
  },
  double: {
    id: 'double',
    name: 'Double Kill',
    icon: 'double',
    color: 'rgb(34, 211, 238)',
    description: '2 kills within 3 seconds!',
  },
  triple: {
    id: 'triple',
    name: 'Triple Kill',
    icon: 'triple',
    color: 'rgb(234, 179, 8)',
    description: '3 kills within 3 seconds!',
  },
  overkill: {
    id: 'overkill',
    name: 'Overkill',
    icon: 'quadra',
    color: 'rgb(168, 85, 247)',
    description: '4 or more kills within 3 seconds of each other!',
  },
  killingspree: {
    id: 'killingspree',
    name: 'Killing Spree',
    icon: 'killingspree',
    color: 'rgb(249, 115, 22)',
    description: '5 kills without dying!',
  },
  hammertime: {
    id: 'hammertime',
    name: 'Hammer Time',
    icon: 'hammertime',
    color: 'rgb(244, 63, 94)',
    description: 'Eliminated an opponent with the Gravity Hammer!',
  },
  swordslayer: {
    id: 'swordslayer',
    name: 'Sword Slayer',
    icon: 'swordslayer',
    color: 'rgb(6, 182, 212)',
    description: 'Eliminated an opponent with the Katar Sword!',
  },
};

export const MEDAL_IDS = Object.keys(MEDAL_CATALOG);

export function getMedalInfo(medalId: string): MedalInfo | undefined {
  return MEDAL_CATALOG[medalId];
}

/** Catalog entry as awarded in-match, with optional per-award overrides. */
export function buildMedal(medalId: string, overrides?: Partial<MedalInfo>): MedalInfo {
  const base = MEDAL_CATALOG[medalId];
  if (!base) {
    return {
      id: medalId,
      name: medalId,
      icon: medalId,
      color: 'rgb(148, 163, 184)',
      description: '',
      ...overrides,
    };
  }
  return overrides ? { ...base, ...overrides } : { ...base };
}
