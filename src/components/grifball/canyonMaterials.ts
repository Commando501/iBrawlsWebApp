import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, createStadiumFloorMaterial, createStadiumMaterial, waitForStadiumTextures } from './stadiumMaterials';

interface RockSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  owners: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const rockSources = new Map<string, RockSource>();
const pendingRockSources = new Set<RockSource>();

function loadRockTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/canyon/surfaces/${path}.png`;
  let entry = rockSources.get(url);
  const isNew = !entry;
  if (!entry) {
    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    const created: RockSource = {
      source: new THREE.Source(null), owners: new Set(), ready, settled: false,
      finish: image => {
        if (created.settled) return;
        created.settled = true;
        if (image) {
          created.source.data = image;
          created.owners.forEach(texture => { texture.needsUpdate = true; });
        }
        pendingRockSources.delete(created);
        resolveReady();
      },
      fallback: () => {
        if (created.settled) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        if (context) {
          context.fillStyle = path.includes('normal-gl') ? '#8080ff' : path.includes('roughness') ? '#ffffff' : '#b19779';
          context.fillRect(0, 0, 1, 1);
        }
        created.finish(canvas);
      },
    };
    entry = created;
    rockSources.set(url, entry);
    pendingRockSources.add(entry);
  }
  // Defer allocation until the final image exists. A 1px placeholder cannot
  // later be resized once WebGL has allocated immutable texture storage.
  const texture = new THREE.Texture();
  texture.name = `canyon:${path}`;
  texture.source = entry.source;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  if (entry.source.data) texture.needsUpdate = true;
  entry.owners.add(texture);
  const ownedEntry = entry;
  texture.addEventListener('dispose', () => {
    ownedEntry.owners.delete(texture);
    if (!ownedEntry.owners.size) {
      ownedEntry.finish();
      if (rockSources.get(url) === ownedEntry) rockSources.delete(url);
    }
  });
  if (isNew) {
    const fail = (error: unknown) => {
      console.warn(`Canyon rock texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, fail); }
    catch (error) { fail(error); }
  }
  return texture;
}

/** Same low-contrast composite as Stadium, with a slightly warmer canyon tint. */
export function createCanyonFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const material = createStadiumFloorMaterial(quality);
  material.name = 'canyon_quiet_composite_floor';
  material.color.set('#636966');
  material.roughness = quality.textureTier === 'low' ? .82 : 1;
  material.envMapIntensity = .6;
  return material;
}

/** Material names are the Blender kit contract; all returned handles are scene-owned. */
export function createCanyonArchitectureMaterial(
  source: THREE.Material,
  quality: EnvironmentQualityProfile = getEnvironmentQualityProfile(),
): THREE.MeshStandardMaterial {
  const role = source.name.replace(/^canyon_/, '');
  let material: THREE.MeshStandardMaterial;
  switch (role) {
    case 'rock': {
      const low = quality.textureTier === 'low';
      material = new THREE.MeshStandardMaterial({
        color: '#ffffff', map: loadRockTexture(`rock-albedo${low ? '-low' : ''}`, true, quality),
        normalMap: low ? null : loadRockTexture('rock-normal-gl', false, quality),
        normalScale: new THREE.Vector2(.9, .9),
        roughnessMap: low ? null : loadRockTexture('rock-roughness', false, quality),
        roughness: low ? .88 : 1, metalness: 0, envMapIntensity: .35,
      });
      break;
    }
    case 'ceramic':
      material = createStadiumCeramicMaterial({ color: '#bfc8c6', roughness: quality.textureTier === 'low' ? .69 : .97, envMapIntensity: .8 }, quality);
      break;
    case 'alloy':
      material = createStadiumMaterial('metal', { color: '#9aabae', metalness: .58, roughness: .88, envMapIntensity: .85, aoMap: null }, quality);
      break;
    case 'graphite':
      material = createStadiumCeramicMaterial({ color: '#39464b', metalness: .25, roughness: .95, envMapIntensity: .65 }, quality);
      break;
    case 'trim':
      material = createStadiumCeramicMaterial({ color: '#65777d', metalness: .62, roughness: .72, envMapIntensity: .9 }, quality);
      break;
    case 'cyan':
      material = new THREE.MeshStandardMaterial({ color: '#729da5', emissive: '#5797a4', emissiveIntensity: .42, roughness: .45, metalness: .15 });
      break;
    case 'warm':
      material = new THREE.MeshStandardMaterial({ color: '#b19a72', emissive: '#b69664', emissiveIntensity: .25, roughness: .5, metalness: .1 });
      break;
    default:
      // Unknown kit materials remain opaque/readable without taking ownership
      // of any source GLB textures that could be disposed by another scene.
      material = new THREE.MeshStandardMaterial({ color: '#69797d', roughness: .8, metalness: .2 });
      break;
  }
  material.name = source.name || 'canyon_fallback';
  material.userData.preserveEmissiveIntensity = true;
  material.side = source.side;
  return material;
}

/** Covers both original rock and reused Stadium images; failed downloads settle to flat usable materials. */
export async function waitForCanyonTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingRockSources];
  const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitForRock = async () => {
    if (!pending.length) return;
    try {
      await Promise.race([
        Promise.all(pending.map(entry => entry.ready)),
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            const incomplete = pending.filter(entry => !entry.settled);
            if (incomplete.length) console.warn(`Canyon texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback());
            resolve();
          }, timeout);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  await Promise.all([waitForRock(), waitForStadiumTextures(timeout)]);
}
