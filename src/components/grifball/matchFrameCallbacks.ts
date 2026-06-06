import { type Combatant, type CustomMapData, type GameStats, type Keybindings } from '../../types';
import { pushGrifballHudStatsUpdate } from './hudStatsRuntime';
import {
  type LiveCameraFrameState,
} from './liveCamera';
import { updateGrifballMatchTimers } from './matchTimers';
import { renderLiveGrifballFrame } from './renderFrame';
import { type GrifballRuntimeState } from './runtimeState';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';
import { type GrifballThreeRefs } from './threeRefs';
import { type WeatherParticleFrameState } from './visualState';

type RefLike<T> = { current: T };

export function createMatchFrameCallbacksForState({
  getState,
  getRefs,
  getMainAI,
  getOpponent,
  getKeysPressed,
  getKeybindings,
  liveCameraFrameRef,
  weatherParticleFrameRef,
  opponentClientId,
  getReplayActive,
  getSpectateTargetData,
  getActiveCustomMap,
  getOnStatsUpdate,
  isMultiplayer,
  multiplayerRole,
  getMultiplayerSocket,
  getFps,
  getOpponentPlayerName,
}: {
  getState: () => GrifballRuntimeState;
  getRefs: () => GrifballThreeRefs;
  getMainAI: () => Combatant | undefined;
  getOpponent: () => Combatant | undefined;
  getKeysPressed: () => Record<string, boolean>;
  getKeybindings: () => Keybindings;
  liveCameraFrameRef: RefLike<LiveCameraFrameState>;
  weatherParticleFrameRef: RefLike<WeatherParticleFrameState>;
  opponentClientId: string;
  getReplayActive: () => boolean;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
  getActiveCustomMap: () => CustomMapData | null;
  getOnStatsUpdate: () => (stats: GameStats) => void;
  isMultiplayer: boolean;
  multiplayerRole: GameStats['multiplayerRole'];
  getMultiplayerSocket: () => WebSocket | null;
  getFps: () => number;
  getOpponentPlayerName: () => string | undefined;
}) {
  const updateMatchTimers = (dt: number) => {
    updateGrifballMatchTimers(getState(), getMainAI(), dt);
  };

  const renderGame = () => {
    renderLiveGrifballFrame({
      state: getState(),
      refs: getRefs(),
      keysPressed: getKeysPressed(),
      keybindings: getKeybindings(),
      liveCameraFrameState: liveCameraFrameRef.current,
      weatherParticleFrameState: weatherParticleFrameRef.current,
      opponentClientId,
      replayActive: getReplayActive(),
      getSpectateTargetData,
      getActiveCustomMap,
    });
  };

  const pushStatsUpdate = () => {
    pushGrifballHudStatsUpdate({
      state: getState(),
      opponent: getOpponent(),
      onStatsUpdate: getOnStatsUpdate(),
      isMultiplayer,
      multiplayerRole,
      multiplayerSocket: getMultiplayerSocket(),
      fps: getFps(),
      getSpectateTargetData,
      opponentPlayerName: getOpponentPlayerName(),
    });
  };

  return {
    updateMatchTimers,
    renderGame,
    pushStatsUpdate,
  };
}
