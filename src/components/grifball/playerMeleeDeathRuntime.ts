import { MAIN_AI_ID } from '../../game/roster';
import type { Combatant } from '../../types';
import type { GrifballRuntimeState } from './runtimeState';

/** Called once when a living offline victim crosses zero HP from a player melee hit. */
export function recordPlayerMeleeKillForState(
  state: GrifballRuntimeState,
  victim: Combatant,
  recordBotCalibrationDeath: (botId: string) => void,
): void {
  victim.hp = 0;
  victim.respawnTimer = 3;
  victim.isLunging = false;
  victim.weaponState = 'ready';
  victim.weaponTimer = 0;
  if (victim.controller === 'ai') victim.aiState = 'RESPAWNING';
  victim.deaths = (victim.deaths ?? 0) + 1;
  state.scorePlayer += 1;
  state.playerKills += 1;
  if (victim.id === MAIN_AI_ID) {
    state.enemyRespawnTimer = 3;
    state.enemyDeaths += 1;
    recordBotCalibrationDeath(MAIN_AI_ID);
  }
}
