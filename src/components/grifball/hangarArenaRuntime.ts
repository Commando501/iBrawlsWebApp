import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import type { DefaultArenaSceneAdminSettings } from './defaultArenaSceneRuntime';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createHangarFloorMaterial } from './hangarMaterials';
import { buildHangarFillLighting, configureHangarShadow } from './hangarLighting';

/** Visual replacement only: preserve the legacy circular floor and radius updater contract. */
export function buildHangarBaseArenaForRefs({
  refs, adminSettings, quality = getEnvironmentQualityProfile(),
}: {
  refs: GrifballThreeRefs;
  adminSettings: DefaultArenaSceneAdminSettings;
  quality?: EnvironmentQualityProfile;
}): void {
  const scene = refs.scene;
  if (!scene) return;
  scene.userData.environmentQuality = quality;
  const floorGeometry = new THREE.CylinderGeometry(20, 20, .2, 64);
  applyStadiumWorldUVs(floorGeometry, 6);
  const floor = new THREE.Mesh(floorGeometry, createHangarFloorMaterial(quality));
  floor.name = 'hangar_floor';
  floor.position.y = -.1;
  floor.receiveShadow = true;
  scene.add(floor);

  const ambient = new THREE.AmbientLight('#b3c4d0', adminSettings.ambientLightIntensity ?? .82);
  const key = new THREE.DirectionalLight('#fff0da', adminSettings.directLightIntensity ?? 1.6);
  key.name = 'hangar_directional_key';
  key.castShadow = true;
  configureHangarShadow(key, 20, quality);
  scene.add(ambient, key, buildHangarFillLighting());
  refs.ambientLight = ambient;
  refs.dirLight = key;
}
