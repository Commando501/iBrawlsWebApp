import { type Combatant, type GameStats } from '../../types';
import { buildGrifballHudStats } from './hudStats';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';

export function pushGrifballHudStatsUpdate({
  state,
  opponent,
  onStatsUpdate,
  isMultiplayer,
  multiplayerRole,
  multiplayerSocket,
  fps,
  getSpectateTargetData,
  opponentPlayerName,
}: {
  state: GrifballRuntimeState;
  opponent: Combatant | undefined;
  onStatsUpdate: (stats: GameStats) => void;
  isMultiplayer: boolean;
  multiplayerRole: GameStats['multiplayerRole'];
  multiplayerSocket: WebSocket | null;
  fps: number;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
  opponentPlayerName: string | undefined;
}): void {
  onStatsUpdate(buildGrifballHudStats({
    state,
    opponent,
    isMultiplayer,
    multiplayerRole,
    opponentConnected: isMultiplayer && multiplayerSocket?.readyState === WebSocket.OPEN,
    fps,
    observerTargetName: getSpectateTargetData(state.observerTarget).name,
    opponentPlayerName,
  }));
}
