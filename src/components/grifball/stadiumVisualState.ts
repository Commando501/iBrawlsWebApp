import * as THREE from 'three';
import { getSkyboxTexture, resolveSkyboxTextureId } from '../../game/skyboxTextures';
import type { CustomMapData, UniversalSettings } from '../../types';
import { syncSkyAtmosphereForRefs } from './skyAtmosphereRuntime';
import type { GrifballThreeRefs } from './threeRefs';

/** Keep the authored Stadium backdrop stable when unrelated gameplay settings change. */
export function syncStadiumVisualStateForRefs({
  refs,
  activeCustomMap,
  adminSettings,
  skyControlsChanged,
}: {
  refs: GrifballThreeRefs;
  activeCustomMap: CustomMapData | null;
  adminSettings: UniversalSettings;
  skyControlsChanged: boolean;
}): boolean {
  if (!refs.scene || activeCustomMap?.theme !== 'grifball_stadium') return false;

  const skyType = activeCustomMap.skyboxTexture && activeCustomMap.skyboxTexture !== 'matched'
    ? activeCustomMap.skyboxTexture : activeCustomMap.theme;
  const visible = adminSettings.showSkybox !== false;
  const skyTypeChanged = refs.skyAtmosphere != null
    && refs.skyAtmosphere.skyboxTextureId !== resolveSkyboxTextureId(skyType);

  if (refs.skyboxMesh) refs.skyboxMesh.visible = visible;
  if (skyControlsChanged || skyTypeChanged) {
    const hue = adminSettings.skyboxHue ?? 224;
    const brightness = adminSettings.skyboxBrightness ?? 4;
    const colorString = `hsl(${hue}, 70%, ${brightness}%)`;
    if (refs.skyboxMesh?.material instanceof THREE.MeshBasicMaterial) {
      try {
        refs.skyboxMesh.material.map = getSkyboxTexture(skyType, hue, brightness, colorString);
        refs.skyboxMesh.material.needsUpdate = true;
      } catch (error) {
        console.error('Failed to update Stadium skybox texture:', error);
      }
    }
    // Explicit sky controls keep their existing effect on the matching fog.
    if (skyControlsChanged) {
      refs.scene.background = new THREE.Color(colorString);
      refs.scene.fog?.color.set(colorString);
    }
  }

  syncSkyAtmosphereForRefs({ refs, skyboxTexture: skyType, atmosphere: activeCustomMap.atmosphere, visible });
  return true;
}
