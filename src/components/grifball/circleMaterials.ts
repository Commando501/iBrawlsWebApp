import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createStadiumCeramicMaterial, waitForStadiumTextures } from './stadiumMaterials';

interface CircleTextureSource {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  handles: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, CircleTextureSource>();
const pendingSources = new Set<CircleTextureSource>();

function createSource(path: string): CircleTextureSource {
  let resolve!: () => void;
  const ready = new Promise<void>(done => { resolve = done; });
  const entry: CircleTextureSource = {
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
function loadCircleTexture(path: string, color: boolean, quality: EnvironmentQualityProfile): THREE.Texture {
  const url = `${import.meta.env?.BASE_URL ?? '/'}assets/circle/surfaces/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) { entry = createSource(path); sources.set(url, entry); }
  const ownedEntry = entry;
  const texture = new THREE.Texture();
  texture.name = `circle:${path}`;
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
      console.warn(`Circle surface texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try { new THREE.ImageLoader().load(url, image => ownedEntry.finish(image), undefined, onError); }
    catch (error) { onError(error); }
  }
  return texture;
}

/** Quiet six-metre ceramic floor with broad panel joins and subtle physical surface relief. */
export function createCircleFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const material = new THREE.MeshStandardMaterial({
    name: 'circle_quiet_ceramic', color: '#667888',
    map: loadCircleTexture(`ceramic-floor-albedo${low ? '-low' : ''}.png`, true, quality),
    normalMap: low ? null : loadCircleTexture('ceramic-floor-normal-gl.png', false, quality),
    roughnessMap: low ? null : loadCircleTexture('ceramic-floor-roughness.png', false, quality),
    normalScale: new THREE.Vector2(.7, .7), roughness: low ? .78 : 1,
    metalness: .045, envMapIntensity: .65,
  });
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** V3 pale ceramic, slate alloy and graphite share the established Stadium coating. */
export function createCircleArchitectureMaterial(source: THREE.Material, quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const coating = (options: THREE.MeshStandardMaterialParameters) => createStadiumCeramicMaterial(options, quality);
  let material: THREE.MeshStandardMaterial;
  switch (source.name.replace(/^circle_/, '')) {
    case 'ceramic':
      material = coating({ color: '#bfc9cb', metalness: .06, roughness: low ? .72 : .95, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .65 }); break;
    case 'alloy':
      material = coating({ color: '#8396a4', metalness: .4, roughness: low ? .7 : .96, normalScale: new THREE.Vector2(.6, .6), envMapIntensity: .7 }); break;
    case 'graphite':
      material = coating({ color: '#354551', metalness: .2, roughness: low ? .8 : 1, normalScale: new THREE.Vector2(.55, .55), envMapIntensity: .55 }); break;
    case 'dark':
      material = coating({ color: '#26333f', metalness: .18, roughness: low ? .84 : 1, normalScale: new THREE.Vector2(.45, .45), envMapIntensity: .5 }); break;
    case 'cyan':
      material = new THREE.MeshStandardMaterial({ color: '#6fa5b3', emissive: '#5a9cb1', emissiveIntensity: .55, metalness: .12, roughness: .6, envMapIntensity: .5 }); break;
    case 'light':
      material = new THREE.MeshStandardMaterial({ color: '#cbd5d7', emissive: '#d7e6ec', emissiveIntensity: .8, metalness: .03, roughness: .6, envMapIntensity: .4 }); break;
    default:
      material = new THREE.MeshStandardMaterial({ color: '#83919b', roughness: .88, metalness: 0 });
  }
  material.name = source.name || 'circle_fallback';
  material.side = source.side;
  material.userData.preserveEmissiveIntensity = true;
  return material;
}

/** Both libraries settle together; terminal fallbacks cannot grow after a late callback. */
export async function waitForCircleTextures(timeoutMs = 8000): Promise<void> {
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
            if (incomplete.length) console.warn(`Circle texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
            incomplete.forEach(entry => entry.fallback()); resolve();
          }, timeout);
        }),
      ]);
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  await Promise.all([waitForPanels(), waitForStadiumTextures(timeout)]);
}
