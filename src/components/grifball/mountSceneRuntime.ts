import { type AIOrchestratorEvents, type AIOrchestratorSpawnCallbacks } from '../../game/aiOrchestrator';
import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type CustomMapData, type ReplayFile, type UniversalSettings } from '../../types';
import { type CharacterLoadout } from '../VoxelModels';
import {
  initializeGrifballSceneForRefs,
  type InitializedGrifballScene,
} from './arenaSceneInitializationRuntime';
import { buildCustomMapBaseArenaForRefs } from './customMapArenaRuntime';
import { buildCustomMapRainyStreetsSceneryForRefs } from './customMapRainyStreetsSceneryRuntime';
import { buildCustomMapStadiumSceneryForRefs } from './customMapStadiumSceneryRuntime';
import { buildCustomMapSynthwaveSceneryForRefs } from './customMapSynthwaveSceneryRuntime';
import { buildCustomMapWinterSceneryForRefs } from './customMapWinterSceneryRuntime';
import { buildDefaultArenaSceneForRefs } from './defaultArenaSceneRuntime';
import { buildLocalPlayerViewForRefs } from './localPlayerViewRuntime';
import { buildMultiplayerEnemyViewForRefs } from './multiplayerEnemyViewRuntime';
import { seedInitialOfflineRosterForState } from './offlineRosterInitializationRuntime';
import { type GrifballRuntimeState } from './runtimeState';
import { type GrifballThreeRefs } from './threeRefs';

export function initializeGrifballMountSceneForState({
  state,
  refs,
  container,
  canvas,
  activeCustomMap,
  selectedMap,
  replayData,
  adminSettings,
  isMultiplayer,
  mainAIHue,
  playerLoadout,
  resetTransientVfx,
  getLegacyRosterProps,
  getOfflineBotCount,
  buildOrchestratorSpawnCallbacks,
  buildSilentOrchestratorEvents,
  placeCombatantsAtGrifballSpawns,
}: {
  state: GrifballRuntimeState;
  refs: GrifballThreeRefs;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  activeCustomMap: CustomMapData | null;
  selectedMap: string;
  replayData: ReplayFile | null;
  adminSettings: UniversalSettings;
  isMultiplayer: boolean;
  mainAIHue?: number;
  playerLoadout?: CharacterLoadout;
  resetTransientVfx: () => void;
  getLegacyRosterProps: () => LegacyRosterProps;
  getOfflineBotCount: () => number;
  buildOrchestratorSpawnCallbacks: () => AIOrchestratorSpawnCallbacks;
  buildSilentOrchestratorEvents: () => AIOrchestratorEvents;
  placeCombatantsAtGrifballSpawns: () => void;
}): InitializedGrifballScene {
  const initialized = initializeGrifballSceneForRefs({
    refs,
    container,
    canvas,
    activeCustomMap,
    selectedMap,
    replayMapType: replayData?.mapType,
    adminSettings,
    resetTransientVfx,
  });
  const { scene, camera, isHangar } = initialized;

  if (activeCustomMap) {
    buildCustomMapBaseArenaForRefs({
      refs,
      activeCustomMap,
    });

    buildCustomMapSynthwaveSceneryForRefs({
      refs,
      activeCustomMap,
    });

    buildCustomMapRainyStreetsSceneryForRefs({
      refs,
      activeCustomMap,
    });

    buildCustomMapWinterSceneryForRefs({
      refs,
      activeCustomMap,
    });

    buildCustomMapStadiumSceneryForRefs({
      refs,
      activeCustomMap,
    });

    refs.navMesh = undefined;
  } else {
    buildDefaultArenaSceneForRefs({
      refs,
      isHangar,
      adminSettings,
    });
  }

  if (!replayData) {
    if (isMultiplayer) {
      buildMultiplayerEnemyViewForRefs({
        refs,
        scene,
        mainAIHue,
      });
    } else {
      seedInitialOfflineRosterForState({
        state,
        legacy: getLegacyRosterProps(),
        offlineBotCount: getOfflineBotCount(),
        spawnCallbacks: buildOrchestratorSpawnCallbacks(),
        events: buildSilentOrchestratorEvents(),
        placeCombatantsAtGrifballSpawns,
      });
    }
  }

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings,
    playerLoadout,
  });

  return initialized;
}
