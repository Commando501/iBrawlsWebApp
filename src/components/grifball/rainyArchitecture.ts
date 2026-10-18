import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { CustomMapData } from '../../types';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createRainyArchitectureMaterial } from './rainyMaterials';
import { disposeRainyObjectResources, registerRainyResourceCleanup } from './rainyResourceDisposal';
import { createRainyWeather } from './rainyWeather';

export const RAINY_ARCHITECTURE_ASSETS = {
  high: 'assets/rainy/architecture/kit-v1.glb', low: 'assets/rainy/architecture/kit-low-v1.glb',
} as const;
export const RAINY_ARCHITECTURE_PARTS = ['street-buffer', 'cargo-crate', 'building-block', 'streetlight', 'billboard-frame', 'street-palm'] as const;
export type RainyArchitecturePart = typeof RAINY_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface RainyPlacement { matrix: THREE.Matrix4; objectId?: string }
export interface RainyArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, 'street-buffer' | 'cargo-crate'>> = {
  rainy_barrier_w: 'street-buffer', rainy_barrier_e: 'street-buffer',
  rainy_crate_nw: 'cargo-crate', rainy_crate_se: 'cargo-crate',
};
export const RAINY_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<RainyArchitecturePart, THREE.Vector3> = {
  'street-buffer': new THREE.Vector3(1.2, 2, 4), 'cargo-crate': new THREE.Vector3(2, 2, 2),
  'building-block': new THREE.Vector3(14, 36, 12), 'streetlight': new THREE.Vector3(3, 10, 2),
  'billboard-frame': new THREE.Vector3(12, 8, 1.6), 'street-palm': new THREE.Vector3(8, 12, 8),
};

/** Immutable source kits are shared between matches; failed downloads can retry. */
export function createRainyArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
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
const loadSource = createRainyArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${RAINY_ARCHITECTURE_ASSETS[detail]}`);
  for (const part of RAINY_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(part)) throw new Error(`Rainy architecture is missing ${part}`);
  }
  return scene;
});

/** Reads both authored and existing Grifball layouts without changing gameplay data. */
export function getRainyArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail): Record<RainyArchitecturePart, RainyPlacement[]> {
  const placements: Record<RainyArchitecturePart, RainyPlacement[]> = {
    'street-buffer': [], 'cargo-crate': [], 'building-block': [], 'streetlight': [], 'billboard-frame': [], 'street-palm': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    placements[part].push({ objectId: object.id, matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(object.position.x, object.position.y, object.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z)),
      new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part]),
    ) });
  }
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const place = (part: RainyArchitecturePart, x: number, y: number, z: number, yaw = 0, sx = 1, sy = sx, sz = sx) => {
    placements[part].push({ matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(sx, sy, sz)) });
  };
  // Setbacks and varied heights leave gaps in the skyline; rotated bounds include
  // a clear buffer outside the full floor in both combat and Grifball modes.
  const citySites = [
    [-1.06, -1, true], [-.36, -1, true], [.44, -1, true], [1.16, -1, true],
    [-1.1, 1, true], [-.36, 1, true], [.4, 1, true], [1.13, 1, true],
    [-.62, -1, false], [.66, -1, false], [-.61, 1, false], [.64, 1, false],
  ] as const;
  const cityIndices = detail === 'high' ? citySites.map((_, index) => index) : [0, 2, 5, 7, 8, 11];
  for (const index of cityIndices) {
    const [along, side, alongX] = citySites[index];
    const width = .82 + .12 * (index % 4), height = .84 + .18 * ((index * 3) % 5);
    const offset = (alongX ? half.z : half.x) + Math.hypot(7, 6) * width + 13 + (index % 3) * 4;
    const x = alongX ? along * (half.x + 9) : side * offset;
    const z = alongX ? side * offset : along * (half.z + 10);
    place('building-block', x, 18 * height - 12, z, (index % 3 - 1) * .12, width, height, width);
  }
  for (const side of [-1, 1]) {
    for (const index of detail === 'high' ? [0, 1, 2] : [0, 2]) {
      const scale = index === 1 ? .88 : 1, along = [-.82, 0, .82][index];
      const reach = Math.hypot(4, 4) * scale;
      place('street-palm', along * half.x, 6 * scale - 1.1, side * (half.z + reach + 4.1), index * 1.7 + side * .36, scale);
    }
    for (const along of detail === 'high' ? [-.65, 0, .65] : [-.65, .65]) {
      place('streetlight', along * half.x, 3.9, side * (half.z + 5.6), side > 0 ? Math.PI : 0);
    }
  }
  // The original dog artwork faces inward from the north side, above two grounded posts.
  place('billboard-frame', half.x * .56, 14, -(half.z + 9));
  return placements;
}

/** Repeated architecture becomes one draw per material batch, not per building. */
export function createRainyArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = RAINY_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Rainy architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'rainy_blender_architecture'; group.userData.detail = detail;
  const placements = getRainyArchitecturePlacements(map, detail);
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
    for (const [index, part] of RAINY_ARCHITECTURE_PARTS.entries()) {
      if (!placements[part].length) continue;
      const root = roots[index], inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        // Authored screen UVs must remain in 0–1 so the existing dog appears once.
        if (!geometry.getAttribute('uv')) applyStadiumWorldUVs(geometry, 3);
        const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
        const assigned = sourceMaterials.map(ownMaterial), batch = placements[part];
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], batch.length);
        mesh.name = `rainy_kit_${part}_${child.name}`; mesh.userData.architecturePart = part;
        mesh.userData.objectIds = batch.flatMap(placement => placement.objectId ? [placement.objectId] : []);
        mesh.castShadow = part === 'street-buffer' || part === 'cargo-crate'; mesh.receiveShadow = true;
        batch.forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere(); group.add(mesh);
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...allocatedMaterials]));
    disposeRainyObjectResources([group, ...holders]); throw error;
  }
}

/** Opaque foundations and service decks stay below the unchanged play surface. */
export function createRainyPerimeter(map: CustomMapData, materialFactory?: MaterialFactory, detail: ArchitectureDetail = 'high'): THREE.Group {
  const half = getRectHalfExtents(map.arenaRadius, map.arenaHalfExtents);
  const group = new THREE.Group(); group.name = 'rainy_subdeck';
  const parts: Record<string, THREE.BufferGeometry[]> = { rainy_graphite: [], rainy_concrete: [], rainy_alloy: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  // A solid foundation reaches the lower city street; the match floor remains untouched.
  box('rainy_concrete', 0, -6.1, 0, half.x * 2, 11.8, half.z * 2);
  box('rainy_graphite', 0, -12.6, 0, half.x * 2 + 136, 1.2, half.z * 2 + 136);
  for (const side of [-1, 1]) {
    for (const alongX of [true, false]) {
      const length = (alongX ? half.x : half.z) * 2, edge = (alongX ? half.z : half.x) + .13;
      const count = Math.max(1, Math.ceil(length / 5.5)), width = length / count;
      for (let index = 0; index < count; index++) {
        const along = -length / 2 + width * (index + .5);
        box('rainy_graphite', alongX ? along : side * edge, -.51, alongX ? side * edge : along,
          alongX ? width - .08 : .26, .72, alongX ? .26 : width - .08);
        box('rainy_alloy', alongX ? along - width / 2 : side * (edge + .01), -2.2, alongX ? side * (edge + .01) : along - width / 2,
          alongX ? .16 : .3, 3.8, alongX ? .3 : .16);
      }
    }
  }
  const placements = getRainyArchitecturePlacements(map, detail);
  // Both sides use short maintenance decks tied to the arena, under every visible plant/lamp.
  for (const part of ['street-palm', 'streetlight'] as const) {
    for (const placement of placements[part]) {
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      placement.matrix.decompose(position, rotation, scale);
      const inset = Math.sign(position.z) * (half.z - .8), end = position.z + Math.sign(position.z) * .8;
      const length = Math.abs(end - inset), centerZ = (end + inset) / 2;
      const width = part === 'street-palm' ? 1.7 * scale.x : 3.2;
      box('rainy_graphite', position.x, -1.82, centerZ, width, 1.04, length);
      box('rainy_concrete', position.x, -1.26, position.z, width, .32, 2);
      box('rainy_alloy', position.x, -1.39, centerZ, width - .12, .06, length - .12);
    }
  }
  const boardPosition = new THREE.Vector3().setFromMatrixPosition(placements['billboard-frame'][0].matrix);
  for (const side of [-1, 1]) {
    const x = boardPosition.x + side * 4.35;
    const inset = -half.z + .8, end = boardPosition.z - .8;
    box('rainy_graphite', x, -1.85, (inset + end) / 2, 1.2, 1.5, Math.abs(inset - end));
    // Posts are outside the protected map bounds and meet the frame's bottom exactly.
    box('rainy_alloy', x, 4.45, boardPosition.z, .38, 11.1, .5);
  }
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'rainy_concrete' ? '#68737c' : '#35434c', metalness: .4, roughness: .74 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `rainy_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose()); disposeRainyObjectResources([group]); throw error;
  }
}

export function buildRainySceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createRainyArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): RainyArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'rainy_industrial_streets' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'rainy_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.halfExtents = getRectHalfExtents(activeCustomMap.arenaRadius, activeCustomMap.arenaHalfExtents);
  group.userData.detail = quality.architectureDetail;
  group.add(createRainyPerimeter(activeCustomMap, materialFactory, quality.architectureDetail));
  const rain = createRainyWeather(activeCustomMap, quality); if (rain) group.add(rain);
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
  registerRainyResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    group.add(createRainyArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory));
    scene.traverse(object => {
      const id = object.userData.rainyLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Rainy architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop(); const architecture = group.getObjectByName('rainy_blender_architecture');
    if (architecture) disposeRainyObjectResources([architecture]);
  } };
}
