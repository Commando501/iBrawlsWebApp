import {
  getNextReplayTargetId,
  type ReplayTargetCycleDirection,
} from './replayHelpers';
import { type GrifballRuntimeState } from './runtimeState';

export function cycleReplayTargetForState({
  state,
  playerIds,
  currentTarget,
  setTarget,
  direction = 'next',
  pushStatsUpdate,
}: {
  state: GrifballRuntimeState;
  playerIds: string[];
  currentTarget: string;
  setTarget: (targetId: string) => void;
  direction?: ReplayTargetCycleDirection;
  pushStatsUpdate: () => void;
}): void {
  if (playerIds.length === 0) return;

  const nextTarget = getNextReplayTargetId(playerIds, currentTarget || 'free', direction);
  if (!nextTarget) return;
  setTarget(nextTarget);
  console.log('Replay target cycled to:', nextTarget);

  if (nextTarget !== 'free' && state.observerCamMode === 'free') {
    state.observerCamMode = 'third';
  }

  pushStatsUpdate();
}
