import * as THREE from 'three';

type StadiumSurface = 'metal' | 'concrete';
type StadiumScreen = 'championship' | 'sapphire' | 'gauss';

// Share image sources (and GPU uploads) while a scene owns them. Each material
// gets its own handle so disposing one scene cannot break another.
const sources = new Map<string, { source: THREE.Source<HTMLImageElement | null>; textures: Set<THREE.Texture> }>();

function loadStadiumTexture(path: string, color: boolean, repeatY = 1): THREE.Texture {
  const base = import.meta.env?.BASE_URL ?? '/';
  const url = `${base}assets/stadium/${path}`;
  let entry = sources.get(url);
  const isNew = !entry;
  if (!entry) {
    // Do not upload a 1px placeholder: WebGL allocates immutable texture storage,
    // which cannot later be resized to the decoded 2K image.
    entry = { source: new THREE.Source(null), textures: new Set() };
    sources.set(url, entry);
  }
  const texture = new THREE.Texture();
  texture.name = `stadium:${path}`;
  texture.source = entry.source;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, repeatY);
  texture.anisotropy = 8;
  if (entry.source.data) texture.needsUpdate = true;
  entry.textures.add(texture);
  const ownedEntry = entry;
  texture.addEventListener('dispose', () => {
    ownedEntry.textures.delete(texture);
    if (ownedEntry.textures.size === 0 && sources.get(url) === ownedEntry) sources.delete(url);
  });
  if (isNew) {
    new THREE.ImageLoader().load(url, (image) => {
      ownedEntry.source.data = image;
      ownedEntry.textures.forEach((handle) => { handle.needsUpdate = true; });
    }, undefined, (error) => {
      console.warn(`Stadium texture could not load: ${url}`, error);
    });
  }
  return texture;
}

export function createStadiumMaterial(
  kind: StadiumSurface,
  options: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  const directory = kind === 'metal' ? 'metal-panels' : 'concrete';
  // Concrete is a 2:1 image. Keep its grain physically proportioned.
  const repeatY = kind === 'concrete' ? 2 : 1;
  const load = (name: string, color = false) => loadStadiumTexture(`${directory}/${name}.jpg`, color, repeatY);
  return new THREE.MeshStandardMaterial({
    color: '#ffffff',
    map: load('albedo', true),
    normalMap: load('normal-gl'),
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: load('roughness'),
    roughness: 0.9,
    metalness: kind === 'metal' ? 0.82 : 0,
    ...(kind === 'metal' ? { metalnessMap: load('metalness'), aoMap: load('ao'), aoMapIntensity: 0.65 } : {}),
    ...options,
  });
}

/** A quiet playing surface: uniform color with only faint close-range grain. */
export function createStadiumFloorMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: '#424b53',
    normalMap: loadStadiumTexture('concrete/normal-gl.jpg', false, 2),
    normalScale: new THREE.Vector2(0.035, 0.035),
    roughness: 0.96,
    metalness: 0.03,
  });
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

export function loadStadiumScreenTexture(kind: StadiumScreen): THREE.Texture {
  const texture = loadStadiumTexture(`screens/${kind}.png`, true);
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}
