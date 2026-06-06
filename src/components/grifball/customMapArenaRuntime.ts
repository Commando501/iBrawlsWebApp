import * as THREE from 'three';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { type CustomMapData } from '../../types';
import { createHighFidelityObjectMesh, generateCustomTexture } from './customMapAssets';
import { type GrifballThreeRefs } from './threeRefs';

type CustomMapFloorTexture =
  | 'futuristic_hex'
  | 'space_alloy'
  | 'city_concrete'
  | 'nature_grass'
  | 'space_lunar_dust'
  | 'fantasy_cobble'
  | 'forerunner_panel'
  | 'synthwave_grid'
  | 'rainy_streets_asphalt'
  | 'winter_ice'
  | 'stadium_steel_grid';

const getCustomMapFloorTexture = (theme: CustomMapData['theme']): CustomMapFloorTexture => {
  if (theme === 'hangar') return 'space_alloy';
  if (theme === 'rust') return 'city_concrete';
  if (theme === 'nature') return 'nature_grass';
  if (theme === 'space') return 'space_lunar_dust';
  if (theme === 'fantasy') return 'fantasy_cobble';
  if (theme === 'forerunner') return 'forerunner_panel';
  if (theme === 'synthwave') return 'synthwave_grid';
  if (theme === 'rainy_streets') return 'rainy_streets_asphalt';
  if (theme === 'winter_rink') return 'winter_ice';
  if (theme === 'grifball_stadium') return 'stadium_steel_grid';
  return 'futuristic_hex';
};

export function buildCustomMapBaseArenaForRefs({
  refs,
  activeCustomMap,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData;
}): void {
  const scene = refs.scene;
  if (!scene) return;

  const ambientLight = new THREE.AmbientLight(
    activeCustomMap.lighting.ambientColor || '#0a0f1d',
    activeCustomMap.lighting.ambientIntensity ?? 0.85
  );
  scene.add(ambientLight);
  refs.ambientLight = ambientLight;

  const dirLight = new THREE.DirectionalLight(
    activeCustomMap.lighting.directColor || '#e0f2fe',
    activeCustomMap.lighting.directIntensity ?? 2.2
  );
  const dp = activeCustomMap.lighting.directPosition || { x: 6, y: 22, z: 6 };
  dirLight.position.set(dp.x, dp.y, dp.z);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 40;
  dirLight.shadow.camera.left = -22;
  dirLight.shadow.camera.right = 22;
  dirLight.shadow.camera.top = 22;
  dirLight.shadow.camera.bottom = -22;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);
  refs.dirLight = dirLight;

  if (activeCustomMap.lighting.pointLights) {
    activeCustomMap.lighting.pointLights.forEach(pl => {
      const pointLight = new THREE.PointLight(pl.color, pl.intensity, pl.distance, pl.decay);
      pointLight.position.set(pl.position.x, pl.position.y, pl.position.z);
      scene.add(pointLight);
    });
  }

  const r = activeCustomMap.arenaRadius;
  const floorGeo = activeCustomMap.mapShape === 'rectangular'
    ? new THREE.BoxGeometry(
      getRectHalfExtents(r, activeCustomMap.arenaHalfExtents).x * 2,
      0.2,
      getRectHalfExtents(r, activeCustomMap.arenaHalfExtents).z * 2
    )
    : new THREE.CylinderGeometry(r, r, 0.2, 64);

  const floorTexture = generateCustomTexture(getCustomMapFloorTexture(activeCustomMap.theme), '#0f172a');
  const floorMat = new THREE.MeshStandardMaterial({
    map: floorTexture,
    bumpMap: floorTexture,
    bumpScale: activeCustomMap.theme === 'winter_rink' ? 0.005 : (activeCustomMap.theme === 'grifball_stadium' ? 0.015 : 0.02),
    roughness: activeCustomMap.theme === 'winter_rink' ? 0.2 : (activeCustomMap.theme === 'grifball_stadium' ? 0.18 : 0.8),
    metalness: activeCustomMap.theme === 'winter_rink' ? 0.1 : (activeCustomMap.theme === 'grifball_stadium' ? 0.9 : 0.5),
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.1;
  floor.receiveShadow = true;
  scene.add(floor);

  refs.customMapObjects = [];
  activeCustomMap.objects.forEach(obj => {
    if (obj.gameModeKind === 'spawn_point') return;

    const mesh = createHighFidelityObjectMesh(obj, THREE, generateCustomTexture);
    mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
    mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);

    scene.add(mesh);
    refs.customMapObjects!.push(mesh);
  });
}
