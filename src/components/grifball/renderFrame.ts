import * as THREE from 'three';
import { type CustomMapData, type Keybindings } from '../../types';
import {
  updateLiveCameraFovForState,
  updateLiveCameraTransformForState,
  type LiveCameraFrameState,
} from './liveCamera';
import { type GrifballRuntimeState } from './runtimeState';
import { updateSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { type GrifballThreeRefs } from './threeRefs';
import { type SpectateTargetData, type SpectateTargetRole } from './spectateTargets';
import {
  updateDebugStrikeVisualsForState,
  updateEmissiveGlowPulseForScene,
  updateHammerJumpZoneVisualizerForState,
  updateLiveInvulnerabilityBlinkingForState,
  updateLiveSpectatorModelVisibilityForState,
  updateWeatherParticlesForScene,
  type WeatherParticleFrameState,
  whiteBlinkMaterial,
} from './visualState';

export function renderLiveGrifballFrame({
  state,
  refs,
  keysPressed,
  keybindings,
  liveCameraFrameState,
  weatherParticleFrameState,
  opponentClientId,
  replayActive,
  getSpectateTargetData,
  getActiveCustomMap,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  keysPressed: Record<string, boolean>;
  keybindings: Keybindings;
  liveCameraFrameState: LiveCameraFrameState;
  weatherParticleFrameState: WeatherParticleFrameState;
  opponentClientId: string;
  replayActive: boolean;
  getSpectateTargetData: (target: SpectateTargetRole) => SpectateTargetData;
  getActiveCustomMap: () => CustomMapData | null;
}): void {
  const { camera, renderer, scene } = refs;
  if (!camera || !renderer || !scene) return;

  updateLiveCameraFovForState({
    state,
    camera,
    keysPressed,
    keybindings,
    frameState: liveCameraFrameState,
  });

  updateLiveInvulnerabilityBlinkingForState({
    state,
    refs,
    opponentClientId,
    replayActive,
  });

  if (state.isObserverMode && !replayActive) {
    updateLiveSpectatorModelVisibilityForState({
      state,
      refs,
      replayActive: false,
      hostData: getSpectateTargetData('host'),
      clientData: getSpectateTargetData('client'),
    });
  }

  if (!replayActive) {
    updateLiveCameraTransformForState({
      state,
      camera,
      getSpectateTargetData,
      getActiveCustomMap,
    });
  }

  updateDebugStrikeVisualsForState({
    state,
    playerSphere: refs.debugPlayerSphere,
    enemySphere: refs.debugEnemySphere,
  });
  updateHammerJumpZoneVisualizerForState({
    state,
    jumpZoneMesh: refs.playerJumpZoneMesh,
  });

  updateEmissiveGlowPulseForScene({ scene, blinkMaterial: whiteBlinkMaterial });
  const now = performance.now();
  if (weatherParticleFrameState.lastAtmosphereTime === undefined) {
    weatherParticleFrameState.lastAtmosphereTime = now;
  }
  const atmosphereDt = Math.min(0.1, (now - weatherParticleFrameState.lastAtmosphereTime) / 1000);
  weatherParticleFrameState.lastAtmosphereTime = now;
  updateSkyAtmosphereForRefs(refs, atmosphereDt, now / 1000);
  updateWeatherParticlesForScene({ scene, frameState: weatherParticleFrameState, now });

  renderer.render(scene, camera);
}
