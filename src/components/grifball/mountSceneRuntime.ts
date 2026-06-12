import { type AIOrchestratorEvents, type AIOrchestratorSpawnCallbacks } from '../../game/aiOrchestrator';
import { type LegacyRosterProps } from '../../game/rosterSlotConfig';
import { type CustomMapData, type ReplayFile, type UniversalSettings } from '../../types';
import { type CharacterLoadout } from '../VoxelModels';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
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

export interface GrifballMountLoadingStage {
  progress: number;
  stage: string;
  detail?: string;
}

const yieldToBrowser = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });

export async function initializeGrifballMountSceneForState({
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
  visualPlayerLoadout,
  v3Options = {},
  resetTransientVfx,
  getLegacyRosterProps,
  getOfflineBotCount,
  buildOrchestratorSpawnCallbacks,
  buildSilentOrchestratorEvents,
  placeCombatantsAtGrifballSpawns,
  onLoadingStage,
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
  visualPlayerLoadout?: CharacterLoadout;
  v3Options?: V3RenderOptions;
  resetTransientVfx: () => void;
  getLegacyRosterProps: () => LegacyRosterProps;
  getOfflineBotCount: () => number;
  buildOrchestratorSpawnCallbacks: () => AIOrchestratorSpawnCallbacks;
  buildSilentOrchestratorEvents: () => AIOrchestratorEvents;
  placeCombatantsAtGrifballSpawns: () => void;
  onLoadingStage?: (stage: GrifballMountLoadingStage) => void;
}): Promise<InitializedGrifballScene> {
  const report = async (progress: number, stage: string, detail?: string) => {
    onLoadingStage?.({ progress, stage, detail });
    await yieldToBrowser();
  };

  await report(6, 'Preparing renderer', 'Allocating WebGL scene and camera');
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
    await report(18, 'Building arena floor', activeCustomMap.name || 'Custom map geometry');
    buildCustomMapBaseArenaForRefs({
      refs,
      activeCustomMap,
    });

    await report(34, 'Loading synthwave set pieces');
    buildCustomMapSynthwaveSceneryForRefs({
      refs,
      activeCustomMap,
    });

    await report(45, 'Loading street set pieces');
    buildCustomMapRainyStreetsSceneryForRefs({
      refs,
      activeCustomMap,
    });

    await report(56, 'Loading winter set pieces');
    buildCustomMapWinterSceneryForRefs({
      refs,
      activeCustomMap,
    });

    await report(67, 'Loading stadium set pieces');
    buildCustomMapStadiumSceneryForRefs({
      refs,
      activeCustomMap,
    });

    refs.navMesh = undefined;
  } else {
    await report(30, 'Building arena', isHangar ? 'Industrial Hangar' : 'Circular Arena');
    buildDefaultArenaSceneForRefs({
      refs,
      isHangar,
      adminSettings,
    });
  }

  if (!replayData) {
    if (isMultiplayer) {
      await report(76, 'Provisioning multiplayer view');
      buildMultiplayerEnemyViewForRefs({
        refs,
        scene,
        mainAIHue,
        v3Options,
      });
    } else {
      await report(76, 'Spawning combatants');
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

  await report(88, 'Building player model', 'Preparing first-person Spartan view');
  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings,
    playerLoadout: visualPlayerLoadout,
    v3Options,
  });

  await report(94, 'Finalizing render targets');
  return initialized;
}
