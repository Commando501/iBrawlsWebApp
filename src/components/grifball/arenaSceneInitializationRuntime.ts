import * as THREE from 'three';
import { getSkyboxTexture } from '../../game/skyboxTextures';
import { type CustomMapData, type UniversalSettings } from '../../types';
import { buildSkyAtmosphereForRefs, disposeSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { type GrifballThreeRefs } from './threeRefs';
import { clearAllV3DeathVoxelBursts } from './v3DeathVoxelBurstRuntime';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { initializeStadiumEnvironment } from './stadiumLighting';
import { createCanyonSkyMaterial, disposeCanyonEnvironment, initializeCanyonEnvironment } from './canyonLighting';
import { disposeStadiumResources } from './stadiumResourceDisposal';
import { disposeCanyonResources } from './canyonResourceDisposal';
import { disposeHangarResources } from './hangarResourceDisposal';
import { disposeHangarEnvironment, initializeHangarEnvironment } from './hangarLighting';
import { disposeCyberResources } from './cyberResourceDisposal';
import { createCyberSkyMaterial, disposeCyberEnvironment, initializeCyberEnvironment } from './cyberLighting';
import { disposeJungleResources } from './jungleResourceDisposal';
import { createJungleSkyMaterial, disposeJungleEnvironment, initializeJungleEnvironment } from './jungleLighting';
import { disposeAsteroidResources } from './asteroidResourceDisposal';
import { disposeNeonResources } from './neonResourceDisposal';
import { disposeRainyResources } from './rainyResourceDisposal';
import { disposeGlacierResources } from './glacierResourceDisposal';
import { disposeCircleResources } from './circleResourceDisposal';
import { createNeonSkyMaterial, disposeNeonEnvironment, initializeNeonEnvironment } from './neonLighting';
import { createRainySkyMaterial, disposeRainyEnvironment, initializeRainyEnvironment } from './rainyLighting';
import { createGlacierSkyMaterial, disposeGlacierEnvironment, initializeGlacierEnvironment } from './glacierLighting';
import { createCircleSkyMaterial, disposeCircleEnvironment, initializeCircleEnvironment } from './circleLighting';
import { createAsteroidSkyMaterial, disposeAsteroidEnvironment, initializeAsteroidEnvironment } from './asteroidLighting';

export interface InitializedGrifballScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  isHangar: boolean;
}

/** An initializer that throws never returns a scene for the mount to clean up. */
export function disposeFailedArenaSceneInitialization(
  { scene, camera, renderer }: Pick<InitializedGrifballScene, 'scene' | 'camera' | 'renderer'>,
  refs: GrifballThreeRefs,
  atmosphere = refs.scene === scene ? refs.skyAtmosphere : null,
): void {
  const skybox = scene.getObjectByName('skybox_mesh');
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
  // Canyon cleanup already owns its shader sky. Other sky materials own only
  // their geometry/material; their cached sky textures remain shared.
  if (skybox instanceof THREE.Mesh && skybox.parent === scene) {
    skybox.removeFromParent();
    skybox.geometry.dispose();
    const materials = Array.isArray(skybox.material) ? skybox.material : [skybox.material];
    materials.forEach(material => material.dispose());
  }
  if (refs.skyboxMesh === skybox) refs.skyboxMesh = null;
  if (refs.skyAtmosphere === atmosphere) refs.skyAtmosphere = null;
  if (refs.scene === scene) {
    refs.scene = null;
    refs.customMapObjects = [];
  }
  if (refs.camera === camera) refs.camera = null;
  if (refs.renderer === renderer) refs.renderer = null;
  renderer.dispose();
}

export function initializeGrifballSceneForRefs({
  refs,
  container,
  canvas,
  activeCustomMap,
  selectedMap,
  replayMapType,
  adminSettings,
  resetTransientVfx,
}: {
  refs: GrifballThreeRefs;
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  activeCustomMap: CustomMapData | null;
  selectedMap: string;
  replayMapType?: string | null;
  adminSettings: UniversalSettings;
  resetTransientVfx: () => void;
}): InitializedGrifballScene {
  clearAllV3DeathVoxelBursts(refs);
  const scene = new THREE.Scene();
  refs.scene = scene;

  // Clear stale mesh references from any previous scene so remote player setup
  // always builds fresh meshes instead of reusing orphaned objects.
  refs.otherPlayerMeshes.clear();
  resetTransientVfx();
  refs.hostGroup = null;
  refs.hostHammer = null;
  refs.hostSword = null;
  refs.skyAtmosphere = null;

  const effectiveMapId = replayMapType ?? selectedMap;
  const isHangar = !activeCustomMap && effectiveMapId === 'hangar';
  const isCircle = !activeCustomMap && effectiveMapId === 'circle';
  const isCanyon = activeCustomMap?.id === 'forerunner_canyon';
  const isCyber = activeCustomMap?.id === 'cyber_hex_arena';
  const isJungle = activeCustomMap?.id === 'botanical_outpost';
  const isAsteroid = activeCustomMap?.id === 'vanguard_starbase';
  const isNeon = activeCustomMap?.id === 'synthwave_grid_arena';
  const isRainy = activeCustomMap?.id === 'rainy_industrial_streets';
  const isGlacier = activeCustomMap?.id === 'winter_glacier_rink';

  let bgHex = isCircle ? '#17232f' : isHangar ? '#101923' : '#030712';
  let fogDensity = isCircle ? 0.008 : isHangar ? 0.012 : 0.015;

  if (activeCustomMap) {
    bgHex = activeCustomMap.fogColor || '#030712';
    fogDensity = activeCustomMap.fogDensity ?? 0.015;
  }
  if (isCanyon) {
    bgHex = '#9a7c66';
    fogDensity = 0.007;
  }
  if (isCyber) {
    bgHex = '#182333';
    fogDensity = 0.008;
  }
  if (isJungle) {
    bgHex = '#7e9187';
    fogDensity = 0.009;
  }
  if (isAsteroid) {
    bgHex = '#101824';
    fogDensity = 0.006;
  }

  if (isNeon) {
    bgHex = '#323747';
    fogDensity = 0.005;
  }

  if (isRainy) { bgHex = '#101c28'; fogDensity = 0.012; }

  if (isGlacier) { bgHex = '#9bafbc'; fogDensity = 0.008; }

  const skyColor = new THREE.Color(bgHex);
  scene.background = skyColor;
  scene.fog = new THREE.FogExp2(bgHex, fogDensity);

  let skyType = 'cyberpunk';
  let skyHue = adminSettings.skyboxHue !== undefined ? adminSettings.skyboxHue : 280;
  let skyBrightness = adminSettings.skyboxBrightness !== undefined ? adminSettings.skyboxBrightness : 5;

  if (activeCustomMap) {
    skyType = activeCustomMap.skyboxTexture || activeCustomMap.theme || 'cyberpunk';
    if (skyType === 'matched') {
      skyType = activeCustomMap.theme || 'cyberpunk';
    }
    skyHue = activeCustomMap.skyboxHue ?? skyHue;
    skyBrightness = activeCustomMap.skyboxBrightness ?? skyBrightness;
  } else if (isCircle) {
    skyHue = adminSettings.skyboxHue ?? 224;
    skyBrightness = adminSettings.skyboxBrightness ?? 4;
  } else if (isHangar) {
    skyType = 'hangar';
    skyHue = 220;
    skyBrightness = 3;
  }

  try {
    const skyGeo = new THREE.SphereGeometry(250, 32, 15);
    const skyMat = isCircle ? createCircleSkyMaterial(skyHue, skyBrightness) : isGlacier ? createGlacierSkyMaterial(skyHue, skyBrightness) : isRainy ? createRainySkyMaterial(skyHue, skyBrightness) : isNeon ? createNeonSkyMaterial(skyHue, skyBrightness) : isAsteroid ? createAsteroidSkyMaterial(skyHue, skyBrightness) : isJungle ? createJungleSkyMaterial(skyHue, skyBrightness) : isCyber ? createCyberSkyMaterial(skyHue, skyBrightness) : isCanyon ? createCanyonSkyMaterial(skyHue, skyBrightness) : new THREE.MeshBasicMaterial({
      map: getSkyboxTexture(skyType, skyHue, skyBrightness, bgHex),
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.name = 'skybox_mesh';
    if (isHangar) skyMesh.userData.hangarOwnedSky = true;
    if (isCyber) skyMesh.userData.cyberOwnedSky = true;
    if (isJungle) skyMesh.userData.jungleOwnedSky = true;
    if (isAsteroid) skyMesh.userData.asteroidOwnedSky = true;
    if (isNeon) skyMesh.userData.neonOwnedSky = true;
    if (isRainy) skyMesh.userData.rainyOwnedSky = true;
    if (isGlacier) skyMesh.userData.glacierOwnedSky = true;
    if (isCircle) skyMesh.userData.circleOwnedSky = true;
    skyMesh.visible = adminSettings.showSkybox !== false;
    scene.add(skyMesh);
    refs.skyboxMesh = skyMesh;
  } catch (err) {
    console.error('Failed to create skybox mesh:', err);
  }

  if (!isCanyon && !isHangar && !isCyber && !isJungle && !isAsteroid && !isNeon && !isRainy && !isGlacier && !isCircle) buildSkyAtmosphereForRefs({
    refs,
    skyboxTexture: skyType,
    atmosphere: activeCustomMap?.atmosphere,
    visible: adminSettings.showSkybox !== false,
  });

  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight;
  const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 400);
  refs.camera = camera;
  scene.add(camera);

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
  });
  renderer.setSize(width, height);
  refs.renderer = renderer;
  if (activeCustomMap?.theme === 'grifball_stadium' || isCanyon || isHangar || isCyber || isJungle || isAsteroid || isNeon || isRainy || isGlacier || isCircle) {
    const quality = getEnvironmentQualityProfile();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
    scene.userData.environmentQuality = quality;
    try {
      if (isCircle) initializeCircleEnvironment(scene, renderer, quality);
      else if (isHangar) initializeHangarEnvironment(scene, renderer, quality);
      else if (isNeon) initializeNeonEnvironment(scene, renderer, quality);
      else if (isRainy) initializeRainyEnvironment(scene, renderer, quality);
      else if (isGlacier) initializeGlacierEnvironment(scene, renderer, quality);
      else if (isAsteroid) initializeAsteroidEnvironment(scene, renderer, quality);
      else if (isJungle) initializeJungleEnvironment(scene, renderer, quality);
      else if (isCyber) initializeCyberEnvironment(scene, renderer, quality);
      else if (isCanyon) initializeCanyonEnvironment(scene, renderer, quality);
      else initializeStadiumEnvironment(scene, renderer, quality);
    } catch (error) {
      disposeFailedArenaSceneInitialization({ scene, camera, renderer }, refs);
      throw error;
    }
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  refs.renderer = renderer;

  return {
    scene,
    camera,
    renderer,
    isHangar,
  };
}
