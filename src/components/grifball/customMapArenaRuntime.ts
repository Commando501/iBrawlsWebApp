import * as THREE from 'three';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { type CustomMapData } from '../../types';
import { createHighFidelityObjectMesh, generateCustomTexture } from './customMapAssets';
import { type GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs, createStadiumFloorMaterial } from './stadiumMaterials';
import { buildStadiumFieldMarkings } from './stadiumFieldMarkings';
import { buildStadiumFillLighting, configureStadiumShadow } from './stadiumLighting';
import { mapScaleFactors } from '../../game/mapBalancing';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createCanyonFloorMaterial } from './canyonMaterials';
import { buildCanyonFillLighting, configureCanyonShadow } from './canyonLighting';
import { createCyberFloorMaterial } from './cyberMaterials';
import { buildCyberFillLighting, configureCyberShadow } from './cyberLighting';
import { createCyberFallbackObject } from './cyberArenaRuntime';
import { createJungleFloorMaterial } from './jungleMaterials';
import { buildJungleFillLighting, configureJungleShadow } from './jungleLighting';
import { createJungleFallbackObject } from './jungleArenaRuntime';
import { createAsteroidFloorMaterial } from './asteroidMaterials';
import { buildAsteroidFillLighting, configureAsteroidShadow } from './asteroidLighting';
import { createAsteroidFallbackObject } from './asteroidArenaRuntime';
import { createNeonFloorMaterial } from './neonMaterials';
import { createRainyFloorMaterial } from './rainyMaterials';
import { createGlacierFloorMaterial } from './glacierMaterials';
import { buildNeonFillLighting, configureNeonShadow } from './neonLighting';
import { buildRainyFillLighting, configureRainyShadow } from './rainyLighting';
import { buildGlacierFillLighting, configureGlacierShadow } from './glacierLighting';
import { createNeonFallbackObject } from './neonArenaRuntime';
import { createRainyFallbackObject } from './rainyArenaRuntime';
import { createGlacierFallbackObject } from './glacierArenaRuntime';

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
  const isCanyon = activeCustomMap.id === 'forerunner_canyon';
  const isCyber = activeCustomMap.id === 'cyber_hex_arena';
  const isJungle = activeCustomMap.id === 'botanical_outpost';
  const isAsteroid = activeCustomMap.id === 'vanguard_starbase';
  const isNeon = activeCustomMap.id === 'synthwave_grid_arena';
  const isRainy = activeCustomMap.id === 'rainy_industrial_streets';
  const isGlacier = activeCustomMap.id === 'winter_glacier_rink';
  const quality = scene.userData.environmentQuality ?? getEnvironmentQualityProfile();

  const ambientLight = new THREE.AmbientLight(
    isGlacier ? '#d2dee5' : isRainy ? '#a9bbc9' : isNeon ? '#bac4d0' : isAsteroid ? '#b5c2d1' : isJungle ? '#b5c6bc' : isCyber ? '#b4c5d4' : activeCustomMap.lighting.ambientColor || '#0a0f1d',
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
  if (activeCustomMap.theme === 'grifball_stadium') {
    dirLight.name = 'stadium_directional_key';
    configureStadiumShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents),
      scene.userData.environmentQuality ?? getEnvironmentQualityProfile());
  } else if (isCanyon) {
    dirLight.name = 'canyon_directional_key';
    configureCanyonShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents),
      scene.userData.environmentQuality ?? getEnvironmentQualityProfile());
  } else if (isCyber) {
    dirLight.name = 'cyber_directional_key';
    configureCyberShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents), quality);
  } else if (isJungle) {
    dirLight.name = 'jungle_directional_key';
    configureJungleShadow(dirLight, activeCustomMap.arenaRadius, quality);
  } else if (isGlacier) {
    dirLight.name = 'glacier_directional_key';
    configureGlacierShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents), quality);
  } else if (isRainy) {
    dirLight.name = 'rainy_directional_key';
    configureRainyShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents), quality);
  } else if (isNeon) {
    dirLight.name = 'neon_directional_key';
    configureNeonShadow(dirLight, getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents), quality);
  } else if (isAsteroid) {
    dirLight.name = 'asteroid_directional_key';
    configureAsteroidShadow(dirLight, activeCustomMap.arenaRadius, quality);
  }
  scene.add(dirLight);
  refs.dirLight = dirLight;

  if (!isCyber && !isJungle && !isAsteroid && !isNeon && !isRainy && !isGlacier && activeCustomMap.lighting.pointLights) {
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

  const isStadium = activeCustomMap.theme === 'grifball_stadium';
  let floorMat: THREE.MeshStandardMaterial;
  if (isStadium || isCanyon || isCyber || isJungle || isAsteroid || isNeon || isRainy || isGlacier) {
    applyStadiumWorldUVs(floorGeo, 6);
    const quality = scene.userData.environmentQuality ?? getEnvironmentQualityProfile();
    floorMat = isGlacier ? createGlacierFloorMaterial(quality) : isRainy ? createRainyFloorMaterial(quality) : isNeon ? createNeonFloorMaterial(quality) : isAsteroid ? createAsteroidFloorMaterial(quality) : isJungle ? createJungleFloorMaterial(quality) : isCyber ? createCyberFloorMaterial(quality) : isCanyon ? createCanyonFloorMaterial(quality) : createStadiumFloorMaterial(quality);
  } else {
    const floorTexture = generateCustomTexture(getCustomMapFloorTexture(activeCustomMap.theme), '#0f172a');
    floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      bumpMap: floorTexture,
      bumpScale: activeCustomMap.theme === 'winter_rink' ? 0.005 : 0.02,
      roughness: activeCustomMap.theme === 'winter_rink' ? 0.2 : 0.8,
      metalness: activeCustomMap.theme === 'winter_rink' ? 0.1 : 0.5,
    });
  }
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.1;
  if (activeCustomMap.balanceScale) {
    floor.scale.y = mapScaleFactors(activeCustomMap.balanceScale).y;
    floor.position.y *= floor.scale.y;
  }
  floor.receiveShadow = true;
  scene.add(floor);
  if (isStadium) {
    floor.name = 'stadium_floor';
    const factors = mapScaleFactors(activeCustomMap.balanceScale);
    const scaledHalf = getRectHalfExtents(r, activeCustomMap.arenaHalfExtents);
    const originalHalf = { x: scaledHalf.x / factors.x, z: scaledHalf.z / factors.z };
    const fill = buildStadiumFillLighting(originalHalf);
    fill.scale.set(factors.x, factors.y, factors.z);
    scene.add(fill);
    if (activeCustomMap.mapShape === 'rectangular') {
      const markings = buildStadiumFieldMarkings(originalHalf.x, originalHalf.z);
      markings.scale.set(factors.x, factors.y, factors.z);
      scene.add(markings);
    }
  } else if (isCanyon) {
    floor.name = 'canyon_floor';
    scene.add(buildCanyonFillLighting());
  } else if (isCyber) {
    floor.name = 'cyber_floor';
    scene.add(buildCyberFillLighting());
  } else if (isJungle) {
    floor.name = 'jungle_floor';
    scene.add(buildJungleFillLighting());
  } else if (isGlacier) {
    floor.name = 'glacier_floor';
    scene.add(buildGlacierFillLighting());
  } else if (isRainy) {
    floor.name = 'rainy_floor';
    scene.add(buildRainyFillLighting());
  } else if (isNeon) {
    floor.name = 'neon_floor';
    scene.add(buildNeonFillLighting());
  } else if (isAsteroid) {
    floor.name = 'asteroid_floor';
    scene.add(buildAsteroidFillLighting());
  }

  refs.customMapObjects = [];
  activeCustomMap.objects.forEach(obj => {
    if (obj.gameModeKind === 'spawn_point') return;

    // Preserve the authored compound mesh (including tiny trim/ring dimensions).
    // Scaling its assembled parts avoids generator minimum sizes clipping the floor.
    const factors = mapScaleFactors(activeCustomMap.balanceScale);
    const meshObject = activeCustomMap.balanceScale ? {
      ...obj,
      scale: { x: obj.scale.x / factors.x, y: obj.scale.y / factors.y, z: obj.scale.z / factors.z },
    } : obj;

    const mesh = (isGlacier ? createGlacierFallbackObject(obj, quality) : isRainy ? createRainyFallbackObject(obj, quality) : isNeon ? createNeonFallbackObject(obj, quality) : isAsteroid ? createAsteroidFallbackObject(obj, quality) : isJungle ? createJungleFallbackObject(obj, quality) : isCyber ? createCyberFallbackObject(obj, quality) : undefined)
      ?? createHighFidelityObjectMesh(meshObject, THREE, generateCustomTexture);
    if (activeCustomMap.balanceScale) mesh.scale.set(factors.x, factors.y, factors.z);
    if (isCanyon) mesh.userData.canyonLegacyId = obj.id;
    if (isCyber) mesh.userData.cyberLegacyId = obj.id;
    if (isJungle) mesh.userData.jungleLegacyId = obj.id;
    if (isAsteroid) mesh.userData.asteroidLegacyId = obj.id;
    if (isNeon) mesh.userData.neonLegacyId = obj.id;
    if (isRainy) mesh.userData.rainyLegacyId = obj.id;
    if (isGlacier) mesh.userData.glacierLegacyId = obj.id;
    mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
    mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);

    scene.add(mesh);
    refs.customMapObjects!.push(mesh);
  });
}
