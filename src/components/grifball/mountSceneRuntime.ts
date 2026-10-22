import { disposeIronVanguardScene, isIronVanguardLoadout, preloadIronVanguard } from '../iron-vanguard/ironVanguardModel';
import { resolveFriendlyArmorTeam } from './combatantTeamArmor';
import { type AIOrchestratorEvents, type AIOrchestratorSpawnCallbacks } from '../../game/aiOrchestrator';
import {
  DEFAULT_AI_TEAM,
  opponentTeamId,
  type TeamId,
} from '../../game/teamScoring';
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
import { yieldForLoadingFrame } from '../loading/yieldForLoadingFrame';
import { waitForStadiumTextures } from './stadiumMaterials';
import { disposeStadiumResources } from './stadiumResourceDisposal';
import type { StadiumArchitectureHandle } from './stadiumArchitecture';
import { disposeSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { buildCanyonSceneryForRefs, type CanyonArchitectureHandle } from './canyonArchitecture';
import { waitForCanyonTextures } from './canyonMaterials';
import { disposeCanyonResources } from './canyonResourceDisposal';
import { disposeCanyonEnvironment } from './canyonLighting';
import { buildHangarBaseArenaForRefs } from './hangarArenaRuntime';
import { buildHangarSceneryForRefs, type HangarArchitectureHandle } from './hangarArchitecture';
import { waitForHangarTextures } from './hangarMaterials';
import { disposeHangarResources } from './hangarResourceDisposal';
import { disposeHangarEnvironment } from './hangarLighting';
import { buildCyberSceneryForRefs, type CyberArchitectureHandle } from './cyberArchitecture';
import { waitForCyberTextures } from './cyberMaterials';
import { disposeCyberResources } from './cyberResourceDisposal';
import { disposeCyberEnvironment } from './cyberLighting';
import { buildJungleSceneryForRefs, type JungleArchitectureHandle } from './jungleArchitecture';
import { waitForJungleTextures } from './jungleMaterials';
import { disposeJungleResources } from './jungleResourceDisposal';
import { disposeJungleEnvironment } from './jungleLighting';
import { buildAsteroidSceneryForRefs, type AsteroidArchitectureHandle } from './asteroidArchitecture';
import { waitForAsteroidTextures } from './asteroidMaterials';
import { disposeAsteroidResources } from './asteroidResourceDisposal';
import { disposeAsteroidEnvironment } from './asteroidLighting';
import { buildNeonSceneryForRefs, type NeonArchitectureHandle } from './neonArchitecture';
import { buildRainySceneryForRefs, type RainyArchitectureHandle } from './rainyArchitecture';
import { buildGlacierSceneryForRefs, type GlacierArchitectureHandle } from './glacierArchitecture';
import { buildCircleSceneryForRefs, type CircleArchitectureHandle } from './circleArchitecture';
import { buildCircleBaseArenaForRefs } from './circleArenaRuntime';
import { waitForNeonTextures } from './neonMaterials';
import { waitForRainyTextures } from './rainyMaterials';
import { waitForGlacierTextures } from './glacierMaterials';
import { waitForCircleTextures } from './circleMaterials';
import { disposeNeonResources } from './neonResourceDisposal';
import { disposeRainyResources } from './rainyResourceDisposal';
import { disposeGlacierResources } from './glacierResourceDisposal';
import { disposeCircleResources } from './circleResourceDisposal';
import { disposeNeonEnvironment } from './neonLighting';
import { disposeRainyEnvironment } from './rainyLighting';
import { disposeGlacierEnvironment } from './glacierLighting';
import { disposeCircleEnvironment } from './circleLighting';

const throwIfMountAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Match loading canceled', 'AbortError');
};

/** Stop awaiting immediately without canceling shared asset-cache downloads. */
export function waitForGrifballMountTask<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new DOMException('Match loading canceled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    task.then(value => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
    if (signal.aborted) {
      signal.removeEventListener('abort', abort);
      abort();
    }
  });
}

/** Only release the scene this mount created; newer mounts may reuse the refs. */
export function disposeUnfinishedGrifballMount(
  initialized: InitializedGrifballScene,
  refs: GrifballThreeRefs,
  atmosphere = refs.scene === initialized.scene ? refs.skyAtmosphere : null,
): void {
  const { scene, renderer, camera } = initialized;
  disposeIronVanguardScene(scene);
  disposeStadiumResources(scene);
  disposeCanyonResources(scene);
  disposeCanyonEnvironment(scene);
  disposeHangarResources(scene);
  disposeHangarEnvironment(scene);
  disposeCyberResources(scene);
  disposeCyberEnvironment(scene);
  disposeJungleResources(scene);
  disposeJungleEnvironment(scene);
  disposeAsteroidResources(scene);
  disposeAsteroidEnvironment(scene);
  disposeNeonResources(scene);
  disposeRainyResources(scene);
  disposeGlacierResources(scene);
  disposeCircleResources(scene);
  disposeNeonEnvironment(scene);
  disposeRainyEnvironment(scene);
  disposeGlacierEnvironment(scene);
  disposeCircleEnvironment(scene);
  disposeSkyAtmosphereForRefs({ ...refs, skyAtmosphere: atmosphere });
  if (refs.skyAtmosphere === atmosphere) refs.skyAtmosphere = null;
  if (refs.scene === scene) {
    refs.scene = null;
    refs.customMapObjects = [];
  }
  if (refs.renderer === renderer) refs.renderer = null;
  if (refs.camera === camera) refs.camera = null;
  renderer.dispose();
}

const mountDependencies = {
  initializeScene: initializeGrifballSceneForRefs,
  buildCustomArena: buildCustomMapBaseArenaForRefs,
  buildDefaultArena: buildDefaultArenaSceneForRefs,
  buildStadium: buildCustomMapStadiumSceneryForRefs,
  buildCanyon: buildCanyonSceneryForRefs,
  buildCyber: buildCyberSceneryForRefs,
  buildJungle: buildJungleSceneryForRefs,
  buildAsteroid: buildAsteroidSceneryForRefs,
  buildNeon: buildNeonSceneryForRefs,
  buildRainy: buildRainySceneryForRefs,
  buildGlacier: buildGlacierSceneryForRefs,
  buildCircleBase: buildCircleBaseArenaForRefs,
  buildCircle: buildCircleSceneryForRefs,
  buildHangarBase: buildHangarBaseArenaForRefs,
  buildHangar: buildHangarSceneryForRefs,
  buildLocalPlayer: buildLocalPlayerViewForRefs,
  waitForTextures: waitForStadiumTextures,
  waitForCanyonTextures,
  waitForHangarTextures,
  waitForCyberTextures,
  waitForJungleTextures,
  waitForAsteroidTextures,
  waitForNeonTextures,
  waitForRainyTextures,
  waitForGlacierTextures,
  waitForCircleTextures,
};

export interface GrifballMountLoadingStage {
  progress: number;
  stage: string;
  detail?: string;
}

const resolveInitialEnemyTeamArmorTeam = (state: GrifballRuntimeState): TeamId | null => {
  if (state.settings.gameMode !== 'grifball') return null;
  if (state.multiplayerRole === 'observer') return DEFAULT_AI_TEAM;
  return opponentTeamId(state.localPlayerTeam);
};

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
  signal,
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
  signal?: AbortSignal;
}, dependencies: Partial<typeof mountDependencies> = {}): Promise<InitializedGrifballScene> {
  const runtime = { ...mountDependencies, ...dependencies };
  let initialized: InitializedGrifballScene | undefined;
  let stadium: StadiumArchitectureHandle | undefined;
  let canyon: CanyonArchitectureHandle | undefined;
  let hangar: HangarArchitectureHandle | undefined;
  let cyber: CyberArchitectureHandle | undefined;
  let jungle: JungleArchitectureHandle | undefined;
  let asteroid: AsteroidArchitectureHandle | undefined;
  let neon: NeonArchitectureHandle | undefined;
  let rainy: RainyArchitectureHandle | undefined;
  let glacier: GlacierArchitectureHandle | undefined;
  let circle: CircleArchitectureHandle | undefined;
  let atmosphere: GrifballThreeRefs['skyAtmosphere'];
  const report = async (progress: number, stage: string, detail?: string) => {
    throwIfMountAborted(signal);
    onLoadingStage?.({ progress, stage, detail });
    await waitForGrifballMountTask(yieldForLoadingFrame(), signal);
    throwIfMountAborted(signal);
  };

  try {
    throwIfMountAborted(signal);
    if (isIronVanguardLoadout(visualPlayerLoadout)) {
      await report(3, 'Loading Iron Vanguard');
      await waitForGrifballMountTask(preloadIronVanguard(), signal);
    }
    await report(6, 'Preparing renderer', 'Allocating WebGL scene and camera');
    initialized = runtime.initializeScene({
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
    atmosphere = refs.skyAtmosphere;

    if (activeCustomMap) {
      await report(18, 'Building arena floor', activeCustomMap.name || 'Custom map geometry');
      runtime.buildCustomArena({
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

      const isCanyon = activeCustomMap.id === 'forerunner_canyon';
      const isCyber = activeCustomMap.id === 'cyber_hex_arena';
      const isJungle = activeCustomMap.id === 'botanical_outpost';
      const isAsteroid = activeCustomMap.id === 'vanguard_starbase';
      const isNeon = activeCustomMap.id === 'synthwave_grid_arena';
      const isRainy = activeCustomMap.id === 'rainy_industrial_streets';
      const isGlacier = activeCustomMap.id === 'winter_glacier_rink';
      await report(67, isGlacier ? 'Loading Glacier Hockey Rink scenery' : isRainy ? 'Loading Rainy Cyber Streets scenery' : isNeon ? 'Loading Neon Outrun skyline' : isAsteroid ? 'Loading asteroid mine scenery' : isJungle ? 'Loading jungle scenery' : isCyber ? 'Loading Cyber Hex Grid scenery' : isCanyon ? 'Loading canyon scenery' : 'Loading stadium set pieces');
      stadium = runtime.buildStadium({
        refs,
        activeCustomMap,
        quality: scene.userData.environmentQuality,
      });
      canyon = runtime.buildCanyon({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      cyber = runtime.buildCyber({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      jungle = runtime.buildJungle({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      asteroid = runtime.buildAsteroid({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      neon = runtime.buildNeon({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      rainy = runtime.buildRainy({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      glacier = runtime.buildGlacier({ refs, activeCustomMap, quality: scene.userData.environmentQuality });
      const architecture = glacier ?? rainy ?? neon ?? asteroid ?? jungle ?? cyber ?? canyon ?? stadium;
      if (architecture) {
        await report(70, isGlacier ? 'Loading Glacier Hockey Rink architecture' : isRainy ? 'Loading Rainy Cyber Streets architecture' : isNeon ? 'Loading Neon Outrun architecture' : isAsteroid ? 'Loading asteroid mine architecture' : isJungle ? 'Loading jungle architecture' : isCyber ? 'Loading Cyber Hex Grid architecture' : isCanyon ? 'Loading canyon architecture' : 'Loading stadium architecture', 'Preparing materials and arena detail');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await waitForGrifballMountTask(Promise.race([
            architecture.ready,
            // Stadium's full kit shares loading time with every roster preview.
            // Allow slow decoding to finish instead of silently dropping detail.
            new Promise<void>(resolve => { timeout = setTimeout(() => { architecture.cancel(); resolve(); }, stadium ? 30000 : 8000); }),
          ]), signal);
        } finally {
          clearTimeout(timeout);
        }
        throwIfMountAborted(signal);
        await waitForGrifballMountTask(glacier ? runtime.waitForGlacierTextures() : rainy ? runtime.waitForRainyTextures() : neon ? runtime.waitForNeonTextures() : asteroid ? runtime.waitForAsteroidTextures() : jungle ? runtime.waitForJungleTextures() : cyber ? runtime.waitForCyberTextures() : canyon ? runtime.waitForCanyonTextures() : runtime.waitForTextures(), signal);
        throwIfMountAborted(signal);
      }

      refs.navMesh = undefined;
    } else {
      await report(30, 'Building arena', isHangar ? 'Industrial Hangar' : 'Circular Arena');
      if (isHangar) {
        runtime.buildHangarBase({ refs, adminSettings, quality: scene.userData.environmentQuality });
        hangar = runtime.buildHangar({ refs, quality: scene.userData.environmentQuality });
        await report(60, 'Loading hangar architecture', 'Preparing wall bays and overhead fixtures');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await waitForGrifballMountTask(Promise.race([
            hangar?.ready ?? Promise.resolve(),
            new Promise<void>(resolve => { timeout = setTimeout(() => { hangar?.cancel(); resolve(); }, 8000); }),
          ]), signal);
        } finally { clearTimeout(timeout); }
        throwIfMountAborted(signal);
        await waitForGrifballMountTask(runtime.waitForHangarTextures(), signal);
        throwIfMountAborted(signal);
      } else if ((replayData?.mapType ?? selectedMap) === 'circle') {
        runtime.buildCircleBase({ refs, adminSettings, quality: scene.userData.environmentQuality });
        circle = runtime.buildCircle({ refs, quality: scene.userData.environmentQuality });
        await report(60, 'Loading Circle Arena architecture', 'Preparing perimeter supports and quiet combat surfaces');
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          await waitForGrifballMountTask(Promise.race([
            circle?.ready ?? Promise.resolve(),
            new Promise<void>(resolve => { timeout = setTimeout(() => { circle?.cancel(); resolve(); }, 8000); }),
          ]), signal);
        } finally { clearTimeout(timeout); }
        throwIfMountAborted(signal);
        await waitForGrifballMountTask(runtime.waitForCircleTextures(), signal);
        throwIfMountAborted(signal);
      } else {
        runtime.buildDefaultArena({ refs, isHangar, adminSettings });
      }
    }

    if (!replayData) {
      if (isMultiplayer) {
        await report(76, 'Provisioning multiplayer view');
        buildMultiplayerEnemyViewForRefs({
          refs,
          scene,
          mainAIHue,
          v3Options,
          teamArmorTeam: resolveInitialEnemyTeamArmorTeam(state),
          friendlyTeam: resolveFriendlyArmorTeam(state),
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
    runtime.buildLocalPlayer({
      refs,
      scene,
      camera,
      adminSettings,
      playerLoadout: visualPlayerLoadout,
      v3Options,
    });

    await report(94, 'Preparing arena and weapons');
    await waitForGrifballMountTask(Promise.all([
      refs.playerHammer?.userData.assetReady,
      refs.playerSword?.userData.assetReady,
      refs.playerPistol?.userData.assetReady,
    ]), signal);
    throwIfMountAborted(signal);
    // Include off-camera surfaces and hidden first-person weapons. Their first
    // appearance must not synchronously compile GPU programs during gameplay.
    // Three polls renderer-owned programs here; finish before cancellation can
    // dispose those handles, then reject a canceled mount before publishing it.
    await initialized.renderer.compileAsync(scene, camera);
    throwIfMountAborted(signal);
    return initialized;
  } catch (error) {
    stadium?.cancel();
    canyon?.cancel();
    hangar?.cancel();
    cyber?.cancel();
    jungle?.cancel();
    asteroid?.cancel();
    neon?.cancel();
    rainy?.cancel();
    glacier?.cancel();
    circle?.cancel();
    if (initialized) disposeUnfinishedGrifballMount(initialized, refs, atmosphere);
    throw error;
  }
}
