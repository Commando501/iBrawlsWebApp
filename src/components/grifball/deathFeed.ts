import { type DeathEvent, type GameStats, type MedalInfo } from '../../types';
import {
  queueReplayHeatmapDeathEventsForState,
  type ReplayHeatmapCombatantSource,
} from './replayHeatmapRuntime';
import { type GrifballRuntimeState } from './runtimeState';

export const getLocalPlayerFeedName = (
  playerName: string | undefined,
  multiplayerRole: GameStats['multiplayerRole']
): string => {
  if (playerName) return playerName;
  return multiplayerRole === 'client' ? 'Red (You)' : 'Blue (You)';
};

export const recordDeathEvent = (
  state: GrifballRuntimeState,
  attacker: string,
  victim: string,
  medals?: MedalInfo[],
  weapon?: DeathEvent['weapon'],
  heatmap?: {
    attacker: ReplayHeatmapCombatantSource;
    victim: ReplayHeatmapCombatantSource;
  }
): DeathEvent => {
  const newDeath: DeathEvent = {
    id: Math.random().toString(36).substring(2, 9),
    attacker,
    victim,
    medals,
    weapon,
  };
  state.lastDeaths = [newDeath, ...state.lastDeaths].slice(0, 3);
  if (heatmap) {
    queueReplayHeatmapDeathEventsForState({
      state,
      attacker: heatmap.attacker,
      victim: heatmap.victim,
      weapon,
    });
  }
  return newDeath;
};
