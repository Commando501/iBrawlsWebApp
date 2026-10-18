import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, createStadiumFloorMaterial, waitForStadiumTextures } from './stadiumMaterials';

/** Restrained composite flooring shares the approved Stadium seams and coating. */
export function createHangarFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const material = createStadiumFloorMaterial(quality);
  material.name = 'hangar_quiet_composite_floor';
  material.color.set('#535e65');
  material.normalScale.set(.72, .72);
  material.roughness = quality.textureTier === 'low' ? .82 : 1;
  material.metalness = .14;
  material.envMapIntensity = .58;
  return material;
}

/** Blender roles use quiet coating relief; panel seams and recesses come from geometry. */
export function createHangarArchitectureMaterial(
  source: THREE.Material,
  quality: EnvironmentQualityProfile = getEnvironmentQualityProfile(),
): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^hangar_/, '')) {
    case 'alloy':
      material = coating({ color: '#7a898f', metalness: .48, roughness: low ? .64 : .86, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .85 });
      break;
    case 'graphite':
      material = coating({ color: '#344047', metalness: .22, roughness: low ? .78 : .96, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .65 });
      break;
    case 'ceramic':
      material = coating({ color: '#c5ccc9', metalness: .1, roughness: low ? .68 : .94, envMapIntensity: .8 });
      break;
    case 'trim':
      material = coating({ color: '#9ca9ad', metalness: .65, roughness: low ? .55 : .74, normalScale: new THREE.Vector2(.45, .45), envMapIntensity: .95 });
      break;
    case 'amber':
      material = new THREE.MeshStandardMaterial({ color: '#a37e44', emissive: '#b38135', emissiveIntensity: .55, roughness: .5, metalness: .1 });
      break;
    case 'light':
      material = new THREE.MeshStandardMaterial({ color: '#bfd4dd', emissive: '#bdd6e5', emissiveIntensity: 1.35, roughness: .4, metalness: .05 });
      break;
    default:
      // Never take ownership of cached GLB materials or their source textures.
      material = new THREE.MeshStandardMaterial({ color: '#718087', roughness: .8, metalness: .25 });
      break;
  }
  material.name = source.name || 'hangar_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Reused source images have independent handles and bounded neutral fallbacks. */
export async function waitForHangarTextures(timeoutMs = 8000): Promise<void> {
  await waitForStadiumTextures(timeoutMs);
}
