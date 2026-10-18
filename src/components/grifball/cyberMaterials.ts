import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, waitForStadiumTextures } from './stadiumMaterials';

interface CyberTextureSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  handles: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, CyberTextureSource>();
const pendingSources = new Set<CyberTextureSource>();

function createSource(path: string): CyberTextureSource {
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  const entry: CyberTextureSource = {
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
        context.fillStyle = path.includes('normal-gl') ? '#8080ff' : path.includes('roughness') ? '#cccccc' : '#eeeeee';
        context.fillRect(0, 0, 1, 1);
      }
      entry.finish(canvas);
    },
  };
  pendingSources.add(entry);
  return entry;
}

/** Shared image storage, independently disposable handles; no upload before final dimensions exist. */
function loadCyberFloorTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/cyber/surfaces/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) { entry = createSource(path); sources.set(url, entry); }
  const ownedEntry = entry;
  const texture = new THREE.Texture();
  texture.name = `cyber:${path}`;
  texture.source = entry.source;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  // The repeat cell is 6 by 3*sqrt(3) metres, containing two regular hexagons.
  texture.repeat.set(1, 2 / Math.sqrt(3));
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
      console.warn(`Cyber floor texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, onError); }
    catch (error) { onError(error); }
  }
  return texture;
}

/** Recessed physical hex joints keep the map identity without a bright grid behind combatants. */
export function createCyberFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  return new THREE.MeshStandardMaterial({
    name: 'cyber_quiet_hex_floor', color: '#59646b',
    map: loadCyberFloorTexture(`hex-floor-albedo${low ? '-low' : ''}.png`, true, quality),
    normalMap: low ? null : loadCyberFloorTexture('hex-floor-normal-gl.png', false, quality),
    normalScale: new THREE.Vector2(.8, .8),
    roughnessMap: low ? null : loadCyberFloorTexture('hex-floor-roughness.png', false, quality),
    roughness: low ? .78 : 1, metalness: .18, envMapIntensity: .7,
  });
}

/** The same approved ceramic/coating library as Stadium and Hangar, with restrained cool accents. */
export function createCyberArchitectureMaterial(
  source: THREE.Material,
  quality: EnvironmentQualityProfile = getEnvironmentQualityProfile(),
): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^cyber_/, '')) {
    case 'alloy':
      material = coating({ color: '#7d8b96', metalness: .48, roughness: low ? .62 : .86, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .88 });
      break;
    case 'graphite':
      material = coating({ color: '#343f4b', metalness: .24, roughness: low ? .76 : .96, normalScale: new THREE.Vector2(.52, .52), envMapIntensity: .65 });
      break;
    case 'ceramic':
      material = coating({ color: '#c3cbce', metalness: .1, roughness: low ? .67 : .94, envMapIntensity: .86 });
      break;
    case 'trim':
      material = coating({ color: '#a2afb7', metalness: .64, roughness: low ? .54 : .76, normalScale: new THREE.Vector2(.45, .45), envMapIntensity: 1 });
      break;
    case 'cyan':
      material = new THREE.MeshStandardMaterial({ color: '#83afb8', emissive: '#73bdcd', emissiveIntensity: .65, roughness: .48, metalness: .12 });
      break;
    case 'core':
      material = new THREE.MeshStandardMaterial({ color: '#bdb4d3', emissive: '#b09bd6', emissiveIntensity: 1.15, roughness: .42, metalness: .08 });
      break;
    default:
      // Source GLB materials and textures remain cache-owned.
      material = new THREE.MeshStandardMaterial({ color: '#77838d', roughness: .8, metalness: .25 });
  }
  material.name = source.name || 'cyber_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Both libraries settle in parallel; terminal fallbacks never resize after a late callback. */
export async function waitForCyberTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingSources];
  const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitForFloor = async () => {
    if (!pending.length) return;
    try {
      await Promise.race([
        Promise.all(pending.map(entry => entry.ready)),
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            const incomplete = pending.filter(entry => !entry.settled);
            if (incomplete.length) console.warn(`Cyber texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback());
            resolve();
          }, timeout);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  await Promise.all([waitForFloor(), waitForStadiumTextures(timeout)]);
}
