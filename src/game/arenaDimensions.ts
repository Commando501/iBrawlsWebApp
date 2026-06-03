/**
 * Single source of truth for rectangular-arena half-extents.
 *
 * Historically rectangular maps derived their bounds from a fixed aspect ratio
 * (`arenaRadius * 1.2` on X, `arenaRadius * 0.6` on Z). Grifball arenas need a
 * much longer goal-to-goal axis than that ratio can express, so `CustomMapData`
 * may now carry explicit `arenaHalfExtents`. When present they win; otherwise we
 * fall back to the legacy ratio so every existing map is byte-for-byte unchanged.
 */

export interface ArenaHalfExtents {
  x: number;
  z: number;
}

/** Legacy aspect-ratio multipliers for rectangular maps. */
export const RECT_HALF_X_RATIO = 1.2;
export const RECT_HALF_Z_RATIO = 0.6;

/**
 * Resolve the rectangular half-extents (pre-inset) for a map.
 * @param arenaRadius Map arena radius (fallback sizing source).
 * @param halfExtents Explicit override from `CustomMapData.arenaHalfExtents`.
 */
export function getRectHalfExtents(
  arenaRadius: number,
  halfExtents?: ArenaHalfExtents | null
): ArenaHalfExtents {
  if (halfExtents && halfExtents.x > 0 && halfExtents.z > 0) {
    return { x: halfExtents.x, z: halfExtents.z };
  }
  return { x: arenaRadius * RECT_HALF_X_RATIO, z: arenaRadius * RECT_HALF_Z_RATIO };
}
