import * as THREE from 'three';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';

type StadiumSurface = 'metal' | 'concrete';
type StadiumScreen = 'championship' | 'sapphire' | 'gauss';

// Share image sources (and GPU uploads) while a scene owns them. Each material
// gets its own handle so disposing one scene cannot break another.
interface TextureSourceEntry {
  source: THREE.Source<HTMLImageElement | HTMLCanvasElement | null>;
  textures: Set<THREE.Texture>;
  ready: Promise<void>;
  settled: boolean;
  finish: (image?: HTMLImageElement | HTMLCanvasElement) => void;
  fallback: () => void;
}
const sources = new Map<string, TextureSourceEntry>();
const pendingSources = new Set<TextureSourceEntry>();

function createSourceEntry(path: string): TextureSourceEntry {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
  const entry: TextureSourceEntry = {
    source: new THREE.Source(null), textures: new Set(), ready, settled: false,
    finish: (image) => {
      if (entry.settled) return;
      entry.settled = true;
      if (image) {
        entry.source.data = image;
        entry.textures.forEach(handle => { handle.needsUpdate = true; });
      }
      pendingSources.delete(entry);
      resolveReady();
    },
    fallback: () => {
      if (entry.settled) return;
      // A terminal fallback may be 1px: late downloads are ignored, so immutable
      // GPU storage never needs to grow from the fallback to the original size.
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');
      if (context) {
        context.fillStyle = path.includes('normal-gl') ? '#8080ff' : path.startsWith('screens/') ? '#17232a' : '#ffffff';
        context.fillRect(0, 0, 1, 1);
      }
      entry.finish(canvas);
    },
  };
  pendingSources.add(entry);
  return entry;
}

function loadStadiumTexture(path: string, color: boolean, repeatY = 1, anisotropy = 8): THREE.Texture {
  const base = import.meta.env?.BASE_URL ?? '/';
  const url = `${base}assets/stadium/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) {
    // Do not upload a 1px placeholder: WebGL allocates immutable texture storage,
    // which cannot later be resized to the decoded 2K image.
    entry = createSourceEntry(path);
    sources.set(url, entry);
  }
  const texture = new THREE.Texture();
  texture.name = `stadium:${path}`;
  texture.source = entry.source;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, repeatY);
  texture.anisotropy = anisotropy;
  if (entry.source.data) texture.needsUpdate = true;
  entry.textures.add(texture);
  const ownedEntry = entry;
  texture.addEventListener('dispose', () => {
    ownedEntry.textures.delete(texture);
    if (ownedEntry.textures.size === 0) {
      ownedEntry.finish();
      if (sources.get(url) === ownedEntry) sources.delete(url);
    }
  });
  if (isNew) {
    const onError = (error: unknown) => {
      console.warn(`Stadium texture could not load: ${url}`, error);
      ownedEntry.fallback();
    };
    try {
      new THREE.ImageLoader().load(url, (image) => ownedEntry.finish(image), undefined, onError);
    } catch (error) {
      onError(error);
    }
  }
  return texture;
}

export function createStadiumMaterial(
  kind: StadiumSurface,
  options: THREE.MeshStandardMaterialParameters = {},
  quality: EnvironmentQualityProfile = getEnvironmentQualityProfile(),
): THREE.MeshStandardMaterial {
  const directory = kind === 'metal' ? 'metal-panels' : 'concrete';
  // Concrete is a 2:1 image. Keep its grain physically proportioned.
  const repeatY = kind === 'concrete' ? 2 : 1;
  const low = quality.textureTier === 'low';
  const anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  const load = (name: string, color = false) => loadStadiumTexture(`${directory}/${name}${low ? '-low' : ''}.jpg`, color, repeatY, anisotropy);
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: options.map === undefined ? load('albedo', true) : options.map,
    normalMap: options.normalMap === undefined && !low ? load('normal-gl') : options.normalMap ?? null,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: options.roughnessMap === undefined && !low ? load('roughness') : options.roughnessMap ?? null,
    roughness: 0.9,
    metalness: kind === 'metal' ? 0.82 : 0,
    ...(kind === 'metal' && !low ? {
      metalnessMap: options.metalnessMap === undefined ? load('metalness') : options.metalnessMap,
      aoMap: options.aoMap === undefined ? load('ao') : options.aoMap,
      aoMapIntensity: 0.65,
    } : {}),
    ...options,
  });
}

/** Physical relief lives in highlights, while the quiet albedo protects player silhouettes. */
export function createStadiumFloorMaterial(quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  return new THREE.MeshStandardMaterial({
    name: 'stadium_quiet_composite_floor',
    color: '#4c5761',
    map: loadStadiumTexture(`surfaces/floor-albedo${low ? '-low' : ''}.png`, true, 1, anisotropy),
    normalMap: low ? null : loadStadiumTexture('surfaces/floor-normal-gl.png', false, 1, anisotropy),
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: low ? null : loadStadiumTexture('surfaces/floor-roughness.png', false, 1, anisotropy),
    roughness: low ? 0.77 : 1,
    metalness: 0.12,
    envMapIntensity: 0.65,
  });
}

/** Approved generated albedo with authored coating data; geometry supplies panel seams. */
export function createStadiumCeramicMaterial(
  options: THREE.MeshStandardMaterialParameters = {},
  quality: EnvironmentQualityProfile = getEnvironmentQualityProfile(),
): THREE.MeshStandardMaterial {
  const low = quality.textureTier === 'low';
  const anisotropy = quality.tier === 'high' ? 8 : quality.tier === 'balanced' ? 4 : 2;
  return new THREE.MeshStandardMaterial({
    color: '#e0e4e3',
    map: options.map === undefined ? loadStadiumTexture(`ceramic/albedo${low ? '-low' : ''}.jpg`, true, 1, anisotropy) : options.map,
    normalMap: options.normalMap === undefined && !low ? loadStadiumTexture('surfaces/ceramic-coating-normal-gl.png', false, 1, anisotropy) : options.normalMap ?? null,
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: options.roughnessMap === undefined && !low ? loadStadiumTexture('surfaces/ceramic-coating-roughness.png', false, 1, anisotropy) : options.roughnessMap ?? null,
    roughness: low ? 0.62 : 0.9,
    metalness: 0.1,
    envMapIntensity: 1.05,
    ...options,
  });
}

/** Wait only for active scene-owned downloads, with neutral terminal fallbacks on failure or timeout. */
export async function waitForStadiumTextures(timeoutMs = 8000): Promise<void> {
  const pending = [...pendingSources];
  if (!pending.length) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all(pending.map(entry => entry.ready)),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          const incomplete = pending.filter(entry => !entry.settled);
          if (incomplete.length) console.warn(`Stadium texture loading timed out; using ${incomplete.length} neutral fallbacks.`);
          incomplete.forEach(entry => entry.fallback());
          resolve();
        }, Math.max(0, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 8000, 8000)));
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Planar face UVs measured in metres, for geometry with dimensions baked in. */
export function applyStadiumWorldUVs(geometry: THREE.BufferGeometry, tileMeters = 3): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  if (!position || !normal || !uv) return;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
    if (ny >= nx && ny >= nz) uv.setXY(i, x / tileMeters, -z / tileMeters);
    else if (nx > nz) uv.setXY(i, z / tileMeters, y / tileMeters);
    else uv.setXY(i, x / tileMeters, y / tileMeters);
  }
  uv.needsUpdate = true;
}

export function loadStadiumScreenTexture(kind: StadiumScreen, quality: EnvironmentQualityProfile = getEnvironmentQualityProfile()): THREE.Texture {
  const texture = loadStadiumTexture(`screens/${kind}${quality.textureTier === 'low' ? '-low.jpg' : '.png'}`, true, 1, quality.tier === 'high' ? 8 : 2);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
