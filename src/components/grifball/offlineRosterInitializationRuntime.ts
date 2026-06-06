import { seedOfflineRoster, type AIOrchestratorEvents, type AIOrchestratorSpawnCallbacks } from '../../game/aiOrchestrator';
import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type GrifballRuntimeState } from './runtimeState';

export function seedInitialOfflineRosterForState({
  state,
  legacy,
  offlineBotCount,
  spawnCallbacks,
  events,
  placeCombatantsAtGrifballSpawns,
}: {
  state: GrifballRuntimeState;
  legacy: LegacyRosterProps;
  offlineBotCount: number;
  spawnCallbacks: AIOrchestratorSpawnCallbacks;
  events: AIOrchestratorEvents;
  placeCombatantsAtGrifballSpawns: () => void;
}): void {
  seedOfflineRoster(
    {
      roster: state.otherPlayers,
      settings: state.settings,
      legacy,
      offlineBotCount,
      playerPos: state.playerPos,
      isPlaying: true,
      coordinator: state.aiMatchContext.coordinator,
      mainAiParams: {},
    },
    spawnCallbacks,
    {
      ...events,
      onPlayerPositioned: (yaw) => {
        state.yaw = yaw;
      },
    }
  );

  if (state.settings.gameMode === 'grifball') {
    placeCombatantsAtGrifballSpawns();
  }
}
