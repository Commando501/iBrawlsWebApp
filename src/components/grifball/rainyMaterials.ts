import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, createStadiumMaterial, waitForStadiumTextures } from './stadiumMaterials';
import { generateCustomTexture } from './customMapAssets';

interface RainyTextureSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  handles: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, RainyTextureSource>();
const pendingSources = new Set<RainyTextureSource>();

function createSource(path: string): RainyTextureSource {
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  const entry: RainyTextureSource = {
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
function loadRainyTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/rainy/surfaces/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) { entry = createSource(path); sources.set(url, entry); }
  const ownedEntry = entry;
  const texture = new THREE.Texture();
  texture.name = `rainy:${path}`;
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
      console.warn(`Rainy surface texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, onError); }
    catch (error) { onError(error); }
  }
  return texture;
}

/** Quiet six-metre asphalt tiles: wet aggregate and flush expansion joints live in physical relief. */
export function createRainyFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  return new THREE.MeshStandardMaterial({
    name: 'rainy_quiet_asphalt', color: '#46525e',
    map: loadRainyTexture(`asphalt-floor-albedo${low ? '-low' : ''}.png`, true, quality),
    normalMap: low ? null : loadRainyTexture('asphalt-floor-normal-gl.png', false, quality),
    roughnessMap: low ? null : loadRainyTexture('asphalt-floor-roughness.png', false, quality),
    normalScale: new THREE.Vector2(.9, .9), roughness: low ? .68 : 1,
    metalness: .025, envMapIntensity: .65,
  });
}

/** Preserve the existing game artwork, downsampled once to the selected tier's owned texture. */
function createDogBillboardTexture(quality: EnvironmentQualityProfile): THREE.Texture {
  const original = generateCustomTexture('rainy_streets_dog_billboard', '#06b6d4');
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = quality.textureTier === 'low' ? 512 : 1024;
  const context = canvas.getContext('2d');
  if (context) context.drawImage(original.image as HTMLCanvasElement, 0, 0, canvas.width, canvas.height);
  original.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = 'rainy:existing_game_dog_billboard';
  texture.colorSpace = THREE.SRGBColorSpace;
  // GLB screen coordinates already use glTF's image orientation.
  texture.flipY = false;
  texture.anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  return texture;
}

/** V3 pale ceramic, slate alloy and graphite share the established Stadium coating. */
export function createRainyArchitectureMaterial(source: THREE.Material, quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^rainy_/, '')) {
    case 'concrete':
      material = createStadiumMaterial('concrete', { color: '#8b9ba7', metalness: .015, roughness: low ? .78 : .94, normalScale: new THREE.Vector2(.4, .4), envMapIntensity: .48 }, quality); break;
    case 'ceramic':
      material = coating({ color: '#c2cbce', metalness: .08, roughness: low ? .76 : 1, normalScale: new THREE.Vector2(.65, .65), envMapIntensity: .65 }); break;
    case 'alloy':
      material = coating({ color: '#8396a4', metalness: .4, roughness: low ? .7 : .96, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .7 }); break;
    case 'graphite':
      material = coating({ color: '#354551', metalness: .2, roughness: low ? .8 : 1, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .55 }); break;
    case 'amber':
      material = new THREE.MeshStandardMaterial({ color: '#e6be83', emissive: '#ffb961', emissiveIntensity: .8, roughness: .44, metalness: .08 }); break;
    case 'window':
      material = new THREE.MeshStandardMaterial({ color: '#d5ba90', emissive: '#e9bb80', emissiveIntensity: .42, roughness: .47, metalness: .16 }); break;
    case 'screen': {
      const graphic = createDogBillboardTexture(quality);
      material = new THREE.MeshStandardMaterial({ color: '#ffffff', map: graphic, emissiveMap: graphic, emissive: '#ffffff', emissiveIntensity: .85, roughness: .5, metalness: 0 });
      break;
    }
    case 'foliage':
      material = new THREE.MeshStandardMaterial({ color: '#465a52', roughness: .83, metalness: 0 }); break;
    default:
      material = new THREE.MeshStandardMaterial({ color: '#83919b', roughness: .88, metalness: 0 });
  }
  material.name = source.name || 'rainy_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Both libraries settle together; terminal fallbacks cannot grow after a late callback. */
export async function waitForRainyTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingSources];
  const timeout = Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waitForPanels = async () => {
    if (!pending.length) return;
    try {
      await Promise.race([
        Promise.all(pending.map(entry => entry.ready)),
        new Promise<void>(resolve => {
          timer = setTimeout(() => {
            const incomplete = pending.filter(entry => !entry.settled);
            if (incomplete.length) console.warn(`Rainy texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback()); resolve();
          }, timeout);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  await Promise.all([waitForPanels(), waitForStadiumTextures(timeout)]);
}

