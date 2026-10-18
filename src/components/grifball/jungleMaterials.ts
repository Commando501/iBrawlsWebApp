import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, waitForStadiumTextures } from './stadiumMaterials';

interface JungleTextureSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  handles: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, JungleTextureSource>();
const pendingSources = new Set<JungleTextureSource>();

function createSource(path: string): JungleTextureSource {
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  const entry: JungleTextureSource = {
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
function loadJungleTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/jungle/surfaces/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) { entry = createSource(path); sources.set(url, entry); }
  const ownedEntry = entry;
  const texture = new THREE.Texture();
  texture.name = `jungle:${path}`;
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
      console.warn(`Jungle surface texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, onError); }
    catch (error) { onError(error); }
  }
  return texture;
}

function organicMaterial(surface: 'ground' | 'stone' | 'bark', options: THREE.MeshStandardMaterialParameters, quality: EnvironmentQualityProfile): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  return new THREE.MeshStandardMaterial({
    map: loadJungleTexture(`${surface}-albedo${low ? '-low' : ''}.png`, true, quality),
    normalMap: low ? null : loadJungleTexture(`${surface}-normal-gl.png`, false, quality),
    roughnessMap: low ? null : loadJungleTexture(`${surface}-roughness.png`, false, quality),
    normalScale: new THREE.Vector2(.85, .85), roughness: low ? .88 : 1,
    metalness: 0, envMapIntensity: .42, ...options,
  });
}

/** Six-metre floor UVs carry compact-earth grain without changing geometry or movement. */
export function createJungleFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  return organicMaterial('ground', { name: 'jungle_quiet_ground', color: '#777b6b', normalScale: new THREE.Vector2(.9, .9) }, quality);
}

/** Organic weathering surrounds the same restrained V3 coating used by the other upgraded arenas. */
export function createJungleArchitectureMaterial(source: THREE.Material, quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^jungle_/, '')) {
    case 'stone':
      material = organicMaterial('stone', { color: '#a0a599', normalScale: new THREE.Vector2(.95, .95) }, quality); break;
    case 'bark':
      material = organicMaterial('bark', { color: '#6c6252', normalScale: new THREE.Vector2(1, 1), envMapIntensity: .32 }, quality); break;
    case 'moss':
      material = organicMaterial('stone', { color: '#657b4e', normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .25 }, quality); break;
    case 'leaf':
      material = organicMaterial('stone', { color: '#41634b', normalScale: new THREE.Vector2(.3, .3), roughness: low ? .82 : .96, envMapIntensity: .3 }, quality); break;
    case 'leaf_light':
      material = organicMaterial('stone', { color: '#71885c', normalScale: new THREE.Vector2(.3, .3), roughness: low ? .82 : .96, envMapIntensity: .3 }, quality); break;
    case 'ceramic':
      material = coating({ color: '#bcc4b9', metalness: .08, roughness: low ? .76 : 1, normalScale: new THREE.Vector2(.7, .7), envMapIntensity: .65 }); break;
    case 'alloy':
      material = coating({ color: '#788b88', metalness: .4, roughness: low ? .68 : .95, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .75 }); break;
    case 'graphite':
      material = coating({ color: '#354343', metalness: .24, roughness: low ? .78 : 1, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .55 }); break;
    case 'jade':
      material = new THREE.MeshStandardMaterial({ color: '#97c1ae', emissive: '#7eae9b', emissiveIntensity: .45, roughness: .48, metalness: .12 }); break;
    default:
      material = new THREE.MeshStandardMaterial({ color: '#838f82', roughness: .88, metalness: 0 });
  }
  material.name = source.name || 'jungle_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Both libraries settle together; terminal fallbacks cannot grow after a late callback. */
export async function waitForJungleTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingSources];
  const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitForOrganic = async () => {
    if (!pending.length) return;
    try {
      await Promise.race([
        Promise.all(pending.map(entry => entry.ready)),
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            const incomplete = pending.filter(entry => !entry.settled);
            if (incomplete.length) console.warn(`Jungle texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback()); resolve();
          }, timeout);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  await Promise.all([waitForOrganic(), waitForStadiumTextures(timeout)]);
}
