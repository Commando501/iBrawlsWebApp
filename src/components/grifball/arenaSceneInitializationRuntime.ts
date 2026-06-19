import * as THREE from 'three';
import { getSkyboxTexture } from '../../game/skyboxTextures';
import { type CustomMapData, type UniversalSettings } from '../../types';
import { buildSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import { type GrifballThreeRefs } from './threeRefs';
import { clearAllV3DeathVoxelBursts } from './v3DeathVoxelBurstRuntime';

export interface InitializedGrifballScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  isHangar: boolean;
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
  const isHangar = effectiveMapId === 'hangar';

  let bgHex = isHangar ? '#07090d' : '#030712';
  let fogDensity = isHangar ? 0.028 : 0.015;

  if (activeCustomMap) {
    bgHex = activeCustomMap.fogColor || '#030712';
    fogDensity = activeCustomMap.fogDensity ?? 0.015;
  }

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
  } else if (isHangar) {
    skyType = 'hangar';
    skyHue = 220;
    skyBrightness = 3;
  }

  try {
    const skyTexture = getSkyboxTexture(skyType, skyHue, skyBrightness, bgHex);
    const skyGeo = new THREE.SphereGeometry(250, 32, 15);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.name = 'skybox_mesh';
    skyMesh.visible = adminSettings.showSkybox !== false;
    scene.add(skyMesh);
    refs.skyboxMesh = skyMesh;
  } catch (err) {
    console.error('Failed to create skybox mesh:', err);
  }

  buildSkyAtmosphereForRefs({
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
