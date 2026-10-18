import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, waitForStadiumTextures } from './stadiumMaterials';

interface AsteroidTextureSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  handles: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, AsteroidTextureSource>();
const pendingSources = new Set<AsteroidTextureSource>();

function createSource(path: string): AsteroidTextureSource {
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  const entry: AsteroidTextureSource = {
    source: new THREE.Source(null), handles: new Set(), ready, settled: false,
    finish(image) {
      if (entry.settled) return;
      entry.settled = true;
      if (image) {
        entry.source.data = image;
        entry.handles.forEach(handle => { handle.needsUpdate = true; });
      }
      pendingSources.delete(entry);
      resolve();
    },
    fallback() {
      if (entry.settled) return;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = path.includes('normal-gl') ? '#8080ff' : path.includes('roughness') ? '#dddddd' : '#eeeeee';
        context.fillRect(0, 0, 1, 1);
      }
      entry.finish(canvas);
    },
  };
  pendingSources.add(entry);
  return entry;
}

/** Image sources are shared; handles and their disposal remain owned by each scene. */
function loadAsteroidTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/asteroid/surfaces/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) { entry = createSource(path); sources.set(url, entry); }
  const ownedEntry = entry;
  const texture = new THREE.Texture();
  texture.name = `asteroid:${path}`;
  texture.source = entry.source;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  entry.handles.add(texture);
  if (entry.source.data) texture.needsUpdate = true;
  texture.addEventListener('dispose', () => {
    ownedEntry.handles.delete(texture);
    if (!ownedEntry.handles.size) {
      ownedEntry.finish();
      if (sources.get(url) === ownedEntry) sources.delete(url);
    }
  });
  if (isNew) {
    const onError = (error: unknown) => {
      console.warn(`Asteroid surface texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, onError); }
    catch (error) { onError(error); }
  }
  return texture;
}

function rockMaterial(surface: 'ground' | 'rock', options: THREE.MeshStandardMaterialParameters, quality: EnvironmentQualityProfile): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  return new THREE.MeshStandardMaterial({
    map: loadAsteroidTexture(`${surface}-albedo${low ? '-low' : ''}.png`, true, quality),
    normalMap: low ? null : loadAsteroidTexture(`${surface}-normal-gl.png`, false, quality),
    roughnessMap: low ? null : loadAsteroidTexture(`${surface}-roughness.png`, false, quality),
    normalScale: new THREE.Vector2(.85, .85), roughness: low ? .88 : 1,
    metalness: 0, envMapIntensity: .5, ...options,
  });
}

/** Six-metre floor UVs carry quiet compacted regolith without changing geometry or movement. */
export function createAsteroidFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  return rockMaterial('ground', { name: 'asteroid_quiet_ground', color: '#777c82', normalScale: new THREE.Vector2(.9, .9) }, quality);
}

/** Fractured rock surrounds the restrained V3 coating used by the other upgraded arenas. */
export function createAsteroidArchitectureMaterial(source: THREE.Material, quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^asteroid_/, '')) {
    case 'rock':
      material = rockMaterial('rock', { color: '#818a94', normalScale: new THREE.Vector2(1, 1) }, quality); break;
    case 'ore':
      material = rockMaterial('rock', { color: '#545963', normalScale: new THREE.Vector2(.9, .9), metalness: .28, roughness: low ? .7 : .84, envMapIntensity: .7 }, quality); break;
    case 'ceramic':
      material = coating({ color: '#c2c9ca', metalness: .08, roughness: low ? .76 : 1, normalScale: new THREE.Vector2(.7, .7), envMapIntensity: .65 }); break;
    case 'alloy':
      material = coating({ color: '#899aa7', metalness: .42, roughness: low ? .68 : .95, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .75 }); break;
    case 'graphite':
      material = coating({ color: '#394650', metalness: .24, roughness: low ? .78 : 1, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .55 }); break;
    case 'hazard':
      material = coating({ color: '#b99952', metalness: .05, roughness: low ? .8 : 1, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .5 }); break;
    case 'amber':
      material = new THREE.MeshStandardMaterial({ color: '#ffcb8c', emissive: '#ffc789', emissiveIntensity: .7, roughness: .48, metalness: .12 }); break;
    default:
      material = new THREE.MeshStandardMaterial({ color: '#838e98', roughness: .88, metalness: 0 });
  }
  material.name = source.name || 'asteroid_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Both libraries settle together; terminal fallbacks cannot grow after a late callback. */
export async function waitForAsteroidTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingSources];
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
            if (incomplete.length) console.warn(`Asteroid texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback()); resolve();
          }, timeout);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  await Promise.all([waitForRock(), waitForStadiumTextures(timeout)]);
}

