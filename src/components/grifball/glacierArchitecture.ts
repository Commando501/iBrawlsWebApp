import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { CustomMapData } from '../../types';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createGlacierArchitectureMaterial } from './glacierMaterials';
import { disposeGlacierObjectResources, registerGlacierResourceCleanup } from './glacierResourceDisposal';
import { createGlacierWeather } from './glacierWeather';

export const GLACIER_ARCHITECTURE_ASSETS = {
  high: 'assets/glacier/architecture/kit-v1.glb', low: 'assets/glacier/architecture/kit-low-v1.glb',
} as const;
export const GLACIER_ARCHITECTURE_PARTS = ['anchor-post', 'goal-buffer', 'rink-board', 'rink-glass', 'glacier-ridge', 'snowy-pine'] as const;
export type GlacierArchitecturePart = typeof GLACIER_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface GlacierPlacement { matrix: THREE.Matrix4; objectId?: string }
export interface GlacierArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, GlacierArchitecturePart>> = {
  post_nw: 'anchor-post', post_sw: 'anchor-post', post_ne: 'anchor-post', post_se: 'anchor-post',
  goal_w: 'goal-buffer', goal_e: 'goal-buffer',
  board_low_n: 'rink-board', board_low_s: 'rink-board', board_low_w: 'rink-board', board_low_e: 'rink-board',
  board_glass_n: 'rink-glass', board_glass_s: 'rink-glass', board_glass_w: 'rink-glass', board_glass_e: 'rink-glass',
};
export const GLACIER_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<GlacierArchitecturePart, THREE.Vector3> = {
  'anchor-post': new THREE.Vector3(.6, 5, .6), 'goal-buffer': new THREE.Vector3(1.5, 2, 4),
  'rink-board': new THREE.Vector3(4, .8, .1), 'rink-glass': new THREE.Vector3(4, 1.4, .1),
  'glacier-ridge': new THREE.Vector3(22, 24, 16), 'snowy-pine': new THREE.Vector3(6, 12, 6),
};

/** Immutable source kits are shared between matches; failed downloads can retry. */
export function createGlacierArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail) => {
    const previous = cache.get(detail);
    if (previous) return previous;
    const pending = load(detail).catch(error => {
      if (cache.get(detail) === pending) cache.delete(detail);
      throw error;
    });
    cache.set(detail, pending);
    return pending;
  };
}
const loadSource = createGlacierArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${GLACIER_ARCHITECTURE_ASSETS[detail]}`);
  for (const part of GLACIER_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(part)) throw new Error(`Glacier architecture is missing ${part}`);
  }
  return scene;
});

/** Reads both authored and existing Grifball layouts without changing gameplay data. */
export function getGlacierArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail): Record<GlacierArchitecturePart, GlacierPlacement[]> {
  const placements: Record<GlacierArchitecturePart, GlacierPlacement[]> = {
    'anchor-post': [], 'goal-buffer': [], 'rink-board': [], 'rink-glass': [], 'glacier-ridge': [], 'snowy-pine': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    const center = new THREE.Vector3(object.position.x, object.position.y, object.position.z);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
    if (part === 'rink-board' || part === 'rink-glass') {
      // Tile metre-sized modules across the source object, retaining its exact
      // combined envelope even after the existing Grifball conversion stretches it.
      const alongX = object.scale.x >= object.scale.z;
      const length = alongX ? object.scale.x : object.scale.z;
      const thickness = alongX ? object.scale.z : object.scale.x;
      const count = Math.max(1, Math.ceil(length / 4)), width = length / count;
      const tileRotation = rotation.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), alongX ? 0 : Math.PI / 2));
      for (let index = 0; index < count; index++) {
        const along = -length / 2 + width * (index + .5);
        const position = new THREE.Vector3(alongX ? along : 0, 0, alongX ? 0 : along).applyQuaternion(rotation).add(center);
        placements[part].push({ objectId: object.id, matrix: new THREE.Matrix4().compose(position, tileRotation,
          new THREE.Vector3(width / 4, object.scale.y / PART_SIZE[part].y, thickness / .1)) });
      }
    } else {
      placements[part].push({ objectId: object.id, matrix: new THREE.Matrix4().compose(center, rotation,
        new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part])) });
    }
  }
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const place = (part: GlacierArchitecturePart, x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx) => {
    placements[part].push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)) });
  };
  // Place full rotated ridge bounds beyond the rink, with deliberate gaps between
  // silhouettes. Nothing added here participates in movement or collision.
  for (const side of [-1, 1]) {
    for (const index of detail === 'high' ? [0, 1, 2, 3] : [0, 2]) {
      const along = [-1.12, -.4, .4, 1.12][index];
      const scale = .95 + .13 * (index % 3), height = .9 + .2 * ((index + (side > 0 ? 1 : 0)) % 3);
      const reach = Math.hypot(11, 8) * scale;
      place('glacier-ridge', along * (half.x + 10), 12 * height - .7, side * (half.z + reach + 12),
        side * (.16 + index * .24), scale, height, scale);
    }
    place('glacier-ridge', side * (half.x + 28), 13.7, half.z * .18, side * .28, 1, 1.2, 1);
    for (const index of detail === 'high' ? [0, 1, 2, 3, 4, 5] : [0, 2, 5]) {
      const along = [-.98, -.61, -.22, .2, .59, .98][index];
      const scale = .75 + (index % 3) * .13, reach = Math.hypot(3, 3) * scale;
      place('snowy-pine', along * half.x, 6 * scale - .24, side * (half.z + reach + 4.2 + (index % 2) * 1.8),
        index * 1.27 + side, scale);
    }
  }
  return placements;
}

/** Repeated architecture becomes one draw per material batch, including every board tile. */
export function createGlacierArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = GLACIER_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Glacier architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'glacier_blender_architecture'; group.userData.detail = detail;
  const placements = getGlacierArchitecturePlacements(map, detail);
  const materials = new Map<THREE.Material, THREE.Material>(), textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>(), allocatedMaterials = new Set<THREE.Material>();
  const ownMaterial = (sourceMaterial: THREE.Material) => {
    const existing = materials.get(sourceMaterial); if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    allocatedMaterials.add(material);
    const sourceTextures = new Set(Object.values(sourceMaterial).filter(value => value instanceof THREE.Texture));
    for (const [slot, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture) || !sourceTextures.has(value)) continue;
      let texture = textures.get(value);
      if (!texture) { texture = value.clone(); textures.set(value, texture); }
      (material as unknown as Record<string, unknown>)[slot] = texture;
    }
    material.userData.preserveEmissiveIntensity = true; materials.set(sourceMaterial, material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [index, part] of GLACIER_ARCHITECTURE_PARTS.entries()) {
      if (!placements[part].length) continue;
      const root = roots[index], inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        // Preserve authored metre-scale UVs on the tiled board and landscape geometry.
        if (!geometry.getAttribute('uv')) applyStadiumWorldUVs(geometry, 3);
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const assigned = sourceMaterials.map(ownMaterial), batch = placements[part];
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], batch.length);
        mesh.name = `glacier_kit_${part}_${child.name}`; mesh.userData.architecturePart = part;
        mesh.userData.objectIds = batch.flatMap(placement => placement.objectId ? [placement.objectId] : []);
        mesh.castShadow = part === 'anchor-post' || part === 'goal-buffer' || part === 'rink-board'; mesh.receiveShadow = true;
        batch.forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...allocatedMaterials]));
    disposeGlacierObjectResources([group, ...holders]); throw error;
  }
}

/** A shallow, opaque foundation and snow ground stay below the unchanged ice. */
export function createGlacierPerimeter(map: CustomMapData, materialFactory?: MaterialFactory, _detail: ArchitectureDetail = 'high'): THREE.Group {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const group = new THREE.Group(); group.name = 'glacier_subdeck';
  const parts: Record<string, THREE.BufferGeometry[]> = { glacier_snow: [], glacier_graphite: [], glacier_alloy: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  box('glacier_snow', 0, -1.04, 0, half.x * 2 + 160, 1.6, half.z * 2 + 160);
  box('glacier_graphite', 0, -.44, 0, half.x * 2, .48, half.z * 2);
  for (const side of [-1, 1]) {
    box('glacier_alloy', 0, -.3, side * (half.z + .05), half.x * 2 + .18, .2, .14);
    box('glacier_alloy', side * (half.x + .05), -.3, 0, .14, .2, half.z * 2 + .18);
  }
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'glacier_snow' ? '#c9d5d9' : '#5c6b73', metalness: .3, roughness: .75 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `glacier_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose()); disposeGlacierObjectResources([group]); throw error;
  }
}

/** Quiet rink markings share one draw; no logos, raised decals or extra collisions. */
export function createGlacierRinkPaint(map: CustomMapData): THREE.Mesh {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const pieces: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, x: number, z: number, color: string) => {
    geometry.rotateX(-Math.PI / 2); geometry.translate(x, .012, z);
    const value = new THREE.Color(color), count = geometry.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) value.toArray(colors, index * 3);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); pieces.push(geometry);
  };
  const red = '#8e4b51', blue = '#527a96';
  add(new THREE.PlaneGeometry(.12, half.z * 2 - .6), 0, 0, red);
  for (const side of [-1, 1]) {
    add(new THREE.PlaneGeometry(.14, half.z * 2 - .6), side * half.x * .34, 0, blue);
    for (const z of [-half.z * .46, half.z * .46]) {
      add(new THREE.RingGeometry(1.49, 1.56, 40), side * half.x * .62, z, red);
      add(new THREE.CircleGeometry(.11, 12), side * half.x * .62, z, red);
    }
  }
  add(new THREE.RingGeometry(2.36, 2.44, 48), 0, 0, blue);
  add(new THREE.CircleGeometry(.15, 16), 0, 0, blue);
  const geometry = mergeGeometries(pieces)!; pieces.forEach(piece => piece.dispose());
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: .36,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  material.name = 'glacier_rink_paint'; material.userData.preserveEmissiveIntensity = true;
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'glacier_rink_paint'; return mesh;
}

export function buildGlacierSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createGlacierArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): GlacierArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'winter_glacier_rink' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'glacier_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.halfExtents = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
  group.userData.detail = quality.architectureDetail;
  group.add(createGlacierPerimeter(activeCustomMap, materialFactory, quality.architectureDetail));
  group.add(createGlacierRinkPaint(activeCustomMap));
  const snow = createGlacierWeather(activeCustomMap, quality); if (snow) group.add(snow);
  scene.add(group); (refs.customMapObjects ??= []).push(group);
  const previousVisibility = new Map<THREE.Object3D, boolean>();
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  const stop = () => {
    canceled = true;
    for (const [object, visible] of previousVisibility) object.visible = visible;
    previousVisibility.clear(); group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  };
  registerGlacierResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    group.add(createGlacierArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory));
    scene.traverse(object => {
      const id = object.userData.glacierLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Glacier architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop(); const architecture = group.getObjectByName('glacier_blender_architecture');
    if (architecture) disposeGlacierObjectResources([architecture]);
  } };
}
