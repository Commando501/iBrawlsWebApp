import { MAIN_AI_ID } from '../../game/roster';
import type { Combatant } from '../../types';
import type { GrifballRuntimeState } from './runtimeState';

/** Sandbox combat remains free-for-all even when roster colors match. */
export function isFriendlyFireForState(state: GrifballRuntimeState, attackerId: string, victimId: string): boolean {
  if (state.settings.gameMode !== 'grifball') return false;
  const teamOf = (id: string) => id === 'player' ? state.localPlayerTeam : state.otherPlayers.get(id)?.team;
  const attackerTeam = teamOf(attackerId);
  return attackerId === victimId || !!attackerTeam && attackerTeam === teamOf(victimId);
}

/** Deaths and respawns still occur on a team kill, but it earns no kill credit. */
export function creditCombatKillForState(
  state: GrifballRuntimeState, attackerId: string, victimId: string, fallback?: Combatant,
): boolean {
  if (isFriendlyFireForState(state, attackerId, victimId)) return false;
  if (attackerId === 'player') {
    state.scorePlayer += 1;
    state.playerKills += 1;
  } else {
    const attacker = state.otherPlayers.get(attackerId) ?? fallback;
    if (attacker) {
      attacker.score = (attacker.score || 0) + 1;
      attacker.kills = (attacker.kills || 0) + 1;
    }
    if (attackerId === MAIN_AI_ID) {
      state.scoreEnemy += 1;
      state.enemyKills += 1;
    }
  }
  return true;
}
