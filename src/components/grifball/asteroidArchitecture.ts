import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CustomMapData } from '../../types';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createAsteroidArchitectureMaterial } from './asteroidMaterials';
import { disposeAsteroidObjectResources, registerAsteroidResourceCleanup } from './asteroidResourceDisposal';

export const ASTEROID_ARCHITECTURE_ASSETS = {
  high: 'assets/asteroid/architecture/kit-v1.glb', low: 'assets/asteroid/architecture/kit-low-v1.glb',
} as const;
export const ASTEROID_ARCHITECTURE_PARTS = ['ore-extractor', 'ore-cluster', 'freight-container', 'blast-partition', 'asteroid-crag', 'mining-gantry'] as const;
export type AsteroidArchitecturePart = typeof ASTEROID_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface AsteroidPlacement { matrix: THREE.Matrix4; objectId?: string }
export interface AsteroidArchitectureHandle { ready: Promise<void>; cancel: () => void }

const BACKGROUND_PARTS = ['asteroid-crag', 'mining-gantry'] as const;
const PART_BY_ID: Readonly<Record<string, Exclude<AsteroidArchitecturePart, typeof BACKGROUND_PARTS[number]>>> = {
  obj_extractor: 'ore-extractor', obj_asteroid_1: 'ore-cluster', obj_asteroid_2: 'ore-cluster',
  obj_container_l: 'freight-container', obj_container_r: 'freight-container',
  obj_partition_n: 'blast-partition', obj_partition_s: 'blast-partition',
};
export const ASTEROID_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<AsteroidArchitecturePart, THREE.Vector3> = {
  'ore-extractor': new THREE.Vector3(2.6, 5, 2.6), 'ore-cluster': new THREE.Vector3(2.2, 3, 2.2),
  'freight-container': new THREE.Vector3(1.8, 2, 3.5), 'blast-partition': new THREE.Vector3(5, 3, 0.4),
  'asteroid-crag': new THREE.Vector3(14, 14, 14), 'mining-gantry': new THREE.Vector3(12, 16, 7),
};
const mapByScenery = new WeakMap<THREE.Object3D, CustomMapData>();

/** Two immutable quality sources are shared across matches; failed downloads may retry. */
export function createAsteroidArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail): Promise<THREE.Group> => {
    const previous = cache.get(detail);
    if (previous) return previous;
    const pending = Promise.resolve().then(() => load(detail)).catch(error => {
      if (cache.get(detail) === pending) cache.delete(detail);
      throw error;
    });
    cache.set(detail, pending);
    return pending;
  };
}

const loadSource = createAsteroidArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${ASTEROID_ARCHITECTURE_ASSETS[detail]}`);
  for (const name of ASTEROID_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(name)) throw new Error(`Asteroid architecture is missing ${name}`);
  }
  return scene;
});

/** Visuals follow actual mode-converted map data; no collision or movement data is changed. */
export function getAsteroidArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail, perimeterRadius = map.arenaRadius): Record<AsteroidArchitecturePart, AsteroidPlacement[]> {
  const placements: Record<AsteroidArchitecturePart, AsteroidPlacement[]> = {
    'ore-extractor': [], 'ore-cluster': [], 'freight-container': [], 'blast-partition': [], 'asteroid-crag': [], 'mining-gantry': [],
  };
  for (const object of map.objects) {
    const part = PART_BY_ID[object.id];
    if (!part) continue;
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(object.position.x, object.position.y, object.position.z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z)),
      new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z).divide(PART_SIZE[part]),
    );
    placements[part].push({ matrix, objectId: object.id });
  }
  // Uneven, staggered masses frame a working asteroid mine. Their conservative
  // horizontal bounding circles stay clear of the entire roster-scaled floor.
  const cragAngles = [0.12, 0.78, 1.61, 2.22, 3.03, 3.72, 4.56, 5.52];
  const cragCount = detail === 'high' ? 8 : 5;
  for (let index = 0; index < cragCount; index++) {
    const angle = cragAngles[detail === 'high' ? index : [0, 2, 3, 5, 7][index]];
    const width = 0.85 + 0.38 * (0.5 + 0.5 * Math.sin(index * 2.39));
    const height = 0.72 + 0.5 * (0.5 + 0.5 * Math.cos(index * 1.73));
    const depth = 0.9 + 0.32 * (0.5 + 0.5 * Math.cos(index * 2.81));
    const extent = Math.hypot(7 * width, 7 * depth);
    const radius = perimeterRadius + extent + 3.4 + (index % 3) * 2.3;
    placements['asteroid-crag'].push({ matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(angle) * radius, 7 * height - 1.2, Math.sin(angle) * radius),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 2.39996 + 0.35),
      new THREE.Vector3(width, height, depth),
    ) });
  }
  const gantryAngles = [0.38, 2.56, 4.06, 5.91];
  const gantryCount = detail === 'high' ? 4 : 2;
  for (let index = 0; index < gantryCount; index++) {
    const angle = gantryAngles[index * (detail === 'high' ? 1 : 2)];
    const scale = index % 2 ? 0.86 : 1;
    const extent = Math.hypot(6, 3.5) * scale;
    const radius = perimeterRadius + extent + 5.1 + (index % 2) * 5;
    placements['mining-gantry'].push({ matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(angle) * radius, 8 * scale - 0.65, Math.sin(angle) * radius),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - angle),
      new THREE.Vector3(scale, scale, scale),
    ) });
  }
  return placements;
}

/** Existing player-count floor scaling moves decoration only, never authored cover or collision objects. */
export function syncAsteroidSceneryRadius(scene: THREE.Scene, base20Radius: number): void {
  const group = scene.getObjectByName('asteroid_scenery');
  const map = group && mapByScenery.get(group);
  if (!group || !map || map.mapShape === 'rectangular' || !Number.isFinite(base20Radius) || base20Radius <= 0) return;
  const floorRadius = map.arenaRadius * (base20Radius / 20);
  if (group.userData.arenaRadius === floorRadius) return;
  group.userData.arenaRadius = floorRadius;
  const perimeter = group.getObjectByName('asteroid_perimeter');
  if (perimeter) perimeter.scale.set(floorRadius / map.arenaRadius, 1, floorRadius / map.arenaRadius);
  const detail: ArchitectureDetail = group.userData.detail === 'low' ? 'low' : 'high';
  const placements = getAsteroidArchitecturePlacements(map, detail, floorRadius);
  group.traverse(child => {
    if (!(child instanceof THREE.InstancedMesh)) return;
    const part = child.userData.architecturePart as typeof BACKGROUND_PARTS[number];
    if (!BACKGROUND_PARTS.includes(part)) return;
    placements[part].forEach((placement, index) => child.setMatrixAt(index, placement.matrix));
    child.instanceMatrix.needsUpdate = true; child.computeBoundingBox(); child.computeBoundingSphere();
  });
}

/** One instanced draw per authored material batch; every GPU handle is scene-owned. */
export function createAsteroidArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory, perimeterRadius = map.arenaRadius,
): THREE.Group {
  const roots = ASTEROID_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Asteroid architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'asteroid_blender_architecture'; group.userData.detail = detail;
  const placements = getAsteroidArchitecturePlacements(map, detail, perimeterRadius);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ownMaterial = (sourceMaterial: THREE.Material) => {
    const existing = materials.get(sourceMaterial);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    const sourceTextures = new Set(Object.values(sourceMaterial).filter(value => value instanceof THREE.Texture));
    for (const [slot, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture) || !sourceTextures.has(value)) continue;
      let texture = textures.get(value);
      if (!texture) { texture = value.clone(); textures.set(value, texture); }
      (material as unknown as Record<string, unknown>)[slot] = texture;
    }
    material.userData.preserveEmissiveIntensity = true;
    materials.set(sourceMaterial, material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [index, part] of ASTEROID_ARCHITECTURE_PARTS.entries()) {
      if (!placements[part].length) continue;
      const root = roots[index];
      const inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        if (!geometry.getAttribute('uv')) applyStadiumWorldUVs(geometry, 3);
        const assigned = (Array.isArray(child.material) ? child.material : [child.material]).map(ownMaterial);
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], placements[part].length);
        mesh.name = `asteroid_kit_${part}_${child.name}`;
        mesh.userData.architecturePart = part;
        mesh.userData.objectIds = placements[part].flatMap(placement => placement.objectId ? [placement.objectId] : []);
        mesh.castShadow = part !== 'asteroid-crag' && part !== 'mining-gantry'; mesh.receiveShadow = true;
        placements[part].forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        group.add(mesh);
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...materials.values()]));
    disposeAsteroidObjectResources([group, ...holders]);
    throw error;
  }
}

/** A three-draw suspended-deck edge, entirely beneath the existing playable surface. */
export function createAsteroidPerimeter(map: CustomMapData, materialFactory?: MaterialFactory): THREE.Group {
  const group = new THREE.Group(); group.name = 'asteroid_perimeter';
  const parts: Record<string, THREE.BufferGeometry[]> = { asteroid_rock: [], asteroid_alloy: [], asteroid_graphite: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.rotateY(yaw); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  const count = 64, radius = map.arenaRadius;
  // A steel foundation and fractured lunar crust sit below the authored floor.
  // No rail, platform, or loose rock enters a movement lane.
  for (let index = 0; index < count; index++) {
    const angle = (index + 0.5) * Math.PI * 2 / count;
    const yaw = Math.PI / 2 - angle;
    const x = Math.cos(angle), z = Math.sin(angle), width = 2 * radius * Math.tan(Math.PI / count);
    box('asteroid_graphite', x * (radius - 0.2), -1.15, z * (radius - 0.2), width + 0.04, 2, 0.7, yaw);
    box('asteroid_alloy', x * (radius + 0.09), -0.37, z * (radius + 0.09), width - 0.07, 0.26, 0.2, yaw);
  }
  const terrain = new THREE.RingGeometry(radius + 0.25, radius + 66, 96, 8);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    positions.setY(i, -0.9 + 0.32 * Math.sin(x * 0.15) * Math.cos(z * 0.12));
  }
  terrain.computeVertexNormals(); parts.asteroid_rock.push(terrain);
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'asteroid_alloy' ? '#66727d' : role === 'asteroid_rock' ? '#3b424b' : '#28323c', metalness: role === 'asteroid_rock' ? 0.05 : 0.55, roughness: 0.85 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `asteroid_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose());
    disposeAsteroidObjectResources([group]);
    throw error;
  }
}

export function buildAsteroidSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createAsteroidArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): AsteroidArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'vanguard_starbase' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'asteroid_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.arenaRadius = activeCustomMap.arenaRadius; group.userData.detail = quality.architectureDetail;
  mapByScenery.set(group, activeCustomMap);
  group.add(createAsteroidPerimeter(activeCustomMap, materialFactory)); scene.add(group);
  (refs.customMapObjects ??= []).push(group);
  const previousVisibility = new Map<THREE.Object3D, boolean>();
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  const restoreLegacy = () => {
    for (const [object, visible] of previousVisibility) object.visible = visible;
    previousVisibility.clear();
  };
  const stop = () => {
    canceled = true; restoreLegacy();
    group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  };
  registerAsteroidResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createAsteroidArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory, group.userData.arenaRadius);
    group.add(architecture);
    scene.traverse(object => {
      const id = object.userData.asteroidLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Asteroid architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop();
    const architecture = group.getObjectByName('asteroid_blender_architecture');
    if (architecture) disposeAsteroidObjectResources([architecture]);
  } };
}



