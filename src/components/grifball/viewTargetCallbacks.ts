import { type CharacterLoadout } from '../VoxelModels';
import { type Combatant } from '../../types';
import {
  rebuildEnemyCombatantModelForState,
  rebuildHostCombatantModelForState,
} from './combatantModelRebuild';
import { cycleReplayTargetForState } from './replayTargetRuntime';
import { type ReplayTargetCycleDirection } from './replayHelpers';
import { type GrifballRuntimeState } from './runtimeState';
import {
  resolveSpectateTargetData,
  type SpectateTargetRole,
} from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';

type RefLike<T> = { current: T };
type MultiplayerRole = 'host' | 'client' | 'observer' | null | undefined;

export function createViewTargetCallbacksForState({
  getState,
  getRefs,
  getMainAI,
  replayPlayerIdsRef,
  replayTargetIdRef,
  lastOpponentHue,
  getOpponentName,
  opponentClientId,
  isMultiplayer,
  multiplayerRole,
  playerLoadout,
  visualPlayerLoadout,
  pushStatsUpdate,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getMainAI: () => Combatant | undefined;
  replayPlayerIdsRef: RefLike<string[] | null>;
  replayTargetIdRef: RefLike<string>;
  lastOpponentHue: RefLike<number | null | undefined>;
  getOpponentName: () => string;
  opponentClientId: string;
  isMultiplayer: boolean;
  multiplayerRole: MultiplayerRole;
  playerLoadout?: CharacterLoadout;
  visualPlayerLoadout?: CharacterLoadout;
  pushStatsUpdate: () => void;
}) {
  const meshPlayerLoadout = visualPlayerLoadout ?? playerLoadout;

  const getSpectateTargetData = (target: SpectateTargetRole) => resolveSpectateTargetData({
    target,
    state: getState(),
    isMultiplayer,
    multiplayerRole,
    mainAI: getMainAI(),
    opponentName: getOpponentName(),
    opponentClientId,
    lastOpponentHue: lastOpponentHue.current,
  });

  const cycleReplayTarget = (direction: ReplayTargetCycleDirection = 'next') => {
    const playerIds = replayPlayerIdsRef.current;
    if (!playerIds) return;
    cycleReplayTargetForState({
      state: getState(),
      playerIds,
      currentTarget: replayTargetIdRef.current || 'free',
      setTarget: (targetId) => {
        replayTargetIdRef.current = targetId;
      },
      direction,
      pushStatsUpdate,
    });
  };

  const rebuildEnemyModel = (hue: number) => {
    rebuildEnemyCombatantModelForState({
      state: getState(),
      refs: getRefs(),
      hue,
      isMultiplayer,
      multiplayerRole,
      playerLoadout: meshPlayerLoadout,
      mainAI: getMainAI(),
    });
  };

  const rebuildHostModel = (hue: number) => {
    rebuildHostCombatantModelForState({
      state: getState(),
      refs: getRefs(),
      hue,
      isMultiplayer,
      multiplayerRole,
      playerLoadout: meshPlayerLoadout,
    });
  };

  return {
    getSpectateTargetData,
    cycleReplayTarget,
    rebuildEnemyModel,
    rebuildHostModel,
  };
}
