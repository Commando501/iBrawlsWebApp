import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import type { DefaultArenaSceneAdminSettings } from './defaultArenaSceneRuntime';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createCircleFloorMaterial } from './circleMaterials';
import { buildCircleFillLighting, configureCircleShadow } from './circleLighting';

/** Visual replacement only: preserve the legacy circular floor and radius updater contract. */
export function buildCircleBaseArenaForRefs({
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
  const floor = new THREE.Mesh(floorGeometry, createCircleFloorMaterial(quality));
  floor.name = 'circle_floor';
  floor.position.y = -.1;
  floor.receiveShadow = true;
  scene.add(floor);

  const ambient = new THREE.AmbientLight('#c5d6e2', adminSettings.ambientLightIntensity ?? .82);
  ambient.name = 'circle_ambient_light';
  const key = new THREE.DirectionalLight('#eef4fa', adminSettings.directLightIntensity ?? 1.6);
  key.name = 'circle_directional_key';
  key.castShadow = true;
  configureCircleShadow(key, 20, quality);
  scene.add(ambient, key, buildCircleFillLighting());
  refs.ambientLight = ambient;
  refs.dirLight = key;
}
