import { type TeamId } from './teamScoring';

/** Canonical team ids (kept as literals to avoid a runtime import cycle with teamScoring). */
const BLUE: TeamId = 'blue';
const RED: TeamId = 'red';

/**
 * Total AI combatants in offline Grifball (main_ai + bot_2…bot_7). With the human
 * on blue this yields a 4v4: player + 3 AI on blue, 4 AI on red.
 */
export const GRIFBALL_TOTAL_AI = 7;

/** Local-player id; spawns on the blue team in Grifball. */
const PLAYER_ID = 'player';

/**
 * Map a combatant id to a 0-based AI slot index. `main_ai` (and any non-`bot_*`
 * id) is slot 0; `bot_2` → 1, `bot_3` → 2, … so the ordering is stable.
 */
function aiSlotIndex(combatantId: string): number {
  if (combatantId.startsWith('bot_')) {
    const n = parseInt(combatantId.slice('bot_'.length), 10);
    return Number.isFinite(n) ? n - 1 : 0;
  }
  return 0;
}

/**
 * Deterministic Grifball team for a combatant. The human is always blue; AI slots
 * alternate red/blue by index so even counts split evenly and the human's blue
 * team is the one that ends up one AI short (keeping sides balanced).
 */
export function resolveGrifballTeam(combatantId: string): TeamId {
  if (combatantId === PLAYER_ID) return BLUE;
  return aiSlotIndex(combatantId) % 2 === 0 ? RED : BLUE;
}
