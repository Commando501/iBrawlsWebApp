import { type GrifballRuntimeState } from './runtimeState';

export type GrifballAwarenessPoint = { x: number; z: number };

export function buildGrifballTeamAwarenessForCombatant(
  state: GrifballRuntimeState,
  botId: string,
  combatantTeam: string | undefined
): {
  alliesList: GrifballAwarenessPoint[];
  enemiesList: GrifballAwarenessPoint[];
} {
  const alliesList: GrifballAwarenessPoint[] = [];
  const enemiesList: GrifballAwarenessPoint[] = [];

  if (state.playerHP > 0 && state.playerRespawnTimer <= 0 && !state.isObserverMode) {
    if (state.localPlayerTeam === combatantTeam) {
      alliesList.push({ x: state.playerPos.x, z: state.playerPos.z });
    } else {
      enemiesList.push({ x: state.playerPos.x, z: state.playerPos.z });
    }
  }

  state.otherPlayers.forEach((other, otherId) => {
    if (otherId === botId) return;
    if (other.hp > 0 && (other.respawnTimer ?? 0) <= 0) {
      if (other.team === combatantTeam) {
        alliesList.push({ x: other.pos.x, z: other.pos.z });
      } else {
        enemiesList.push({ x: other.pos.x, z: other.pos.z });
      }
    }
  });

  return { alliesList, enemiesList };
}
