import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CustomMapData } from '../../types';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createJungleArchitectureMaterial } from './jungleMaterials';
import { disposeJungleObjectResources, registerJungleResourceCleanup } from './jungleResourceDisposal';

export const JUNGLE_ARCHITECTURE_ASSETS = {
  high: 'assets/jungle/architecture/kit-v1.glb', low: 'assets/jungle/architecture/kit-low-v1.glb',
} as const;
export const JUNGLE_ARCHITECTURE_PARTS = ['relic-spire', 'moss-boulder', 'ancient-trunk', 'ruined-wall', 'jungle-canopy'] as const;
export type JungleArchitecturePart = typeof JUNGLE_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface JunglePlacement { matrix: THREE.Matrix4; objectId?: string }
export interface JungleArchitectureHandle { ready: Promise<void>; cancel: () => void }

const PART_BY_ID: Readonly<Record<string, Exclude<JungleArchitecturePart, 'jungle-canopy'>>> = {
  obj_nature_totem: 'relic-spire', obj_rock_nw: 'moss-boulder', obj_rock_se: 'moss-boulder',
  obj_trunk_ne: 'ancient-trunk', obj_trunk_sw: 'ancient-trunk',
  obj_ruined_wall_n: 'ruined-wall', obj_ruined_wall_s: 'ruined-wall',
};
export const JUNGLE_REPLACED_OBJECT_IDS = Object.keys(PART_BY_ID);
const PART_SIZE: Record<JungleArchitecturePart, THREE.Vector3> = {
  'relic-spire': new THREE.Vector3(1.2, 4, 1.2), 'moss-boulder': new THREE.Vector3(3, 3, 3),
  'ancient-trunk': new THREE.Vector3(2, 7, 2), 'ruined-wall': new THREE.Vector3(3, 2, 0.6),
  'jungle-canopy': new THREE.Vector3(12, 24, 12),
};
const mapByScenery = new WeakMap<THREE.Object3D, CustomMapData>();

/** Two immutable quality sources are shared across matches; failed downloads may retry. */
export function createJungleArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
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

const loadSource = createJungleArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${JUNGLE_ARCHITECTURE_ASSETS[detail]}`);
  for (const name of JUNGLE_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(name)) throw new Error(`Jungle architecture is missing ${name}`);
  }
  return scene;
});

/** Visuals follow actual mode-converted map data; no collision or movement data is changed. */
export function getJungleArchitecturePlacements(map: CustomMapData, detail: ArchitectureDetail, perimeterRadius = map.arenaRadius): Record<JungleArchitecturePart, JunglePlacement[]> {
  const placements: Record<JungleArchitecturePart, JunglePlacement[]> = {
    'relic-spire': [], 'moss-boulder': [], 'ancient-trunk': [], 'ruined-wall': [], 'jungle-canopy': [],
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
  const count = detail === 'high' ? 16 : 10;
  // Deterministic variation breaks the repeated-tree silhouette. The bounding
  // circle of every scaled crown stays outside the *actual* floor, even though
  // existing roster scaling reports a 20-based gameplay radius for this map.
  for (let index = 0; index < count; index++) {
    const angle = Math.PI * 2 * index / count + 0.1 * Math.sin(index * 4.7);
    const width = 0.94 + 0.2 * (0.5 + 0.5 * Math.sin(index * 2.39));
    const height = 0.87 + 0.28 * (0.5 + 0.5 * Math.cos(index * 1.73));
    const depth = 0.92 + 0.2 * (0.5 + 0.5 * Math.cos(index * 2.81));
    const crownRadius = Math.hypot(6 * width, 6 * depth);
    const radius = perimeterRadius + crownRadius + 3.4 + (index % 3) * 1.3;
    placements['jungle-canopy'].push({ matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(angle) * radius, 12 * height - 0.55, Math.sin(angle) * radius),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 2.39996 + 0.35),
      new THREE.Vector3(width, height, depth),
    ) });
  }
  // Reuse the same opaque canopy batches at two lower heights, filling the
  // horizon between tall trunks without adding draws, shadows, or floor clutter.
  const layerCount = detail === 'high' ? 8 : 3;
  for (const layer of ['middle', 'understory'] as const) {
    for (let index = 0; index < layerCount; index++) {
      const middle = layer === 'middle';
      const phase = middle ? 0.19 : 0.61;
      const angle = Math.PI * 2 * index / layerCount + phase + 0.16 * Math.sin(index * 3.17 + phase);
      const variation = 0.5 + 0.5 * Math.sin(index * 2.71 + phase);
      const width = middle ? 1 + 0.4 * variation : 0.6 + 0.35 * variation;
      const depth = middle ? 1 + 0.35 * (0.5 + 0.5 * Math.cos(index * 1.91)) : 0.65 + 0.3 * (0.5 + 0.5 * Math.cos(index * 2.13));
      const height = middle ? 0.4 + 0.2 * (0.5 + 0.5 * Math.cos(index * 2.43)) : 0.12 + 0.08 * (0.5 + 0.5 * Math.sin(index * 2.83));
      const crownRadius = Math.hypot(6 * width, 6 * depth);
      const radius = perimeterRadius + crownRadius + (middle ? 6.2 + (index % 3) * 1.1 : 3.4 + (index % 3) * 0.45);
      placements['jungle-canopy'].push({ matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(Math.cos(angle) * radius, 12 * height - 0.55, Math.sin(angle) * radius),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), index * 2.39996 + phase * 4),
        new THREE.Vector3(width, height, depth),
      ) });
    }
  }
  return placements;
}

/** Existing player-count floor scaling moves decoration only, never authored cover or collision objects. */
export function syncJungleSceneryRadius(scene: THREE.Scene, base20Radius: number): void {
  const group = scene.getObjectByName('jungle_scenery');
  const map = group && mapByScenery.get(group);
  if (!group || !map || map.mapShape === 'rectangular' || !Number.isFinite(base20Radius) || base20Radius <= 0) return;
  const floorRadius = map.arenaRadius * (base20Radius / 20);
  if (group.userData.arenaRadius === floorRadius) return;
  group.userData.arenaRadius = floorRadius;
  const perimeter = group.getObjectByName('jungle_perimeter');
  if (perimeter) perimeter.scale.set(floorRadius / map.arenaRadius, 1, floorRadius / map.arenaRadius);
  const detail: ArchitectureDetail = group.userData.detail === 'low' ? 'low' : 'high';
  const placements = getJungleArchitecturePlacements(map, detail, floorRadius)['jungle-canopy'];
  group.traverse(child => {
    if (!(child instanceof THREE.InstancedMesh) || child.userData.architecturePart !== 'jungle-canopy') return;
    placements.forEach((placement, index) => child.setMatrixAt(index, placement.matrix));
    child.instanceMatrix.needsUpdate = true; child.computeBoundingBox(); child.computeBoundingSphere();
  });
}

/** One instanced draw per authored material batch; every GPU handle is scene-owned. */
export function createJungleArchitectureInstances(
  source: THREE.Group, map: CustomMapData, detail: ArchitectureDetail, materialFactory?: MaterialFactory, perimeterRadius = map.arenaRadius,
): THREE.Group {
  const roots = JUNGLE_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root || !root.getObjectsByProperty('isMesh', true).length) throw new Error(`Jungle architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'jungle_blender_architecture'; group.userData.detail = detail;
  const placements = getJungleArchitecturePlacements(map, detail, perimeterRadius);
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
    for (const [index, part] of JUNGLE_ARCHITECTURE_PARTS.entries()) {
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
        mesh.name = `jungle_kit_${part}_${child.name}`;
        mesh.userData.architecturePart = part;
        mesh.userData.objectIds = placements[part].flatMap(placement => placement.objectId ? [placement.objectId] : []);
        mesh.castShadow = part !== 'jungle-canopy'; mesh.receiveShadow = true;
        placements[part].forEach((placement, i) => mesh.setMatrixAt(i, placement.matrix));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
        group.add(mesh);
      });
    }
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...materials.values()]));
    disposeJungleObjectResources([group, ...holders]);
    throw error;
  }
}

/** A three-draw suspended-deck edge, entirely beneath the existing playable surface. */
export function createJunglePerimeter(map: CustomMapData, materialFactory?: MaterialFactory): THREE.Group {
  const group = new THREE.Group(); group.name = 'jungle_perimeter';
  const parts: Record<string, THREE.BufferGeometry[]> = { jungle_stone: [], jungle_moss: [], jungle_ceramic: [] };
  const box = (role: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.rotateY(yaw); geometry.translate(x, y, z); parts[role].push(geometry);
  };
  const count = 64, radius = map.arenaRadius;
  // This foundation and the distant landbase are entirely below the authored
  // floor. They add visual weight without changing its outline or collisions.
  for (let index = 0; index < count; index++) {
    const angle = (index + 0.5) * Math.PI * 2 / count;
    const yaw = Math.PI / 2 - angle;
    const x = Math.cos(angle), z = Math.sin(angle), width = 2 * radius * Math.tan(Math.PI / count);
    box('jungle_stone', x * (radius - 0.2), -0.95, z * (radius - 0.2), width + 0.04, 1.6, 0.7, yaw);
    // Incomplete ceramic bands suggest the older outpost rather than a new rail.
    if (index % 9 < 5) box('jungle_ceramic', x * (radius + 0.09), -0.37, z * (radius + 0.09), width - 0.07, 0.26, 0.2, yaw);
  }
  const terrain = new THREE.RingGeometry(radius + 0.25, radius + 72, 96, 8);
  terrain.rotateX(-Math.PI / 2);
  const positions = terrain.getAttribute('position');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), z = positions.getZ(i);
    positions.setY(i, -0.7 + 0.16 * Math.sin(x * 0.15) * Math.cos(z * 0.12));
  }
  terrain.computeVertexNormals(); parts.jungle_moss.push(terrain);
  try {
    for (const [role, pieces] of Object.entries(parts)) {
      const geometry = mergeGeometries(pieces);
      pieces.forEach(piece => piece.dispose()); parts[role] = [];
      if (!geometry) continue;
      applyStadiumWorldUVs(geometry, 3);
      const source = new THREE.MeshStandardMaterial({ color: role === 'jungle_ceramic' ? '#9ba69a' : role === 'jungle_moss' ? '#374533' : '#545b50', metalness: 0.05, roughness: 0.9 });
      source.name = role;
      let material: THREE.Material;
      try { material = materialFactory?.(source) ?? source.clone(); }
      catch (error) { geometry.dispose(); source.dispose(); throw error; }
      if (material !== source) source.dispose();
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `jungle_perimeter_${role}`;
      mesh.receiveShadow = true; group.add(mesh);
    }
    return group;
  } catch (error) {
    Object.values(parts).flat().forEach(geometry => geometry.dispose());
    disposeJungleObjectResources([group]);
    throw error;
  }
}

export function buildJungleSceneryForRefs({
  refs, activeCustomMap, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createJungleArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; activeCustomMap: CustomMapData; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): JungleArchitectureHandle | undefined {
  if (activeCustomMap.id !== 'botanical_outpost' || !refs.scene) return;
  const scene = refs.scene;
  const group = new THREE.Group(); group.name = 'jungle_scenery'; group.userData.architectureStatus = 'loading';
  group.userData.arenaRadius = activeCustomMap.arenaRadius; group.userData.detail = quality.architectureDetail;
  mapByScenery.set(group, activeCustomMap);
  group.add(createJunglePerimeter(activeCustomMap, materialFactory)); scene.add(group);
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
  registerJungleResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createJungleArchitectureInstances(source, activeCustomMap, quality.architectureDetail, materialFactory, group.userData.arenaRadius);
    group.add(architecture);
    scene.traverse(object => {
      const id = object.userData.jungleLegacyId;
      if (typeof id === 'string' && PART_BY_ID[id] && activeCustomMap.objects.some(item => item.id === id)) {
        previousVisibility.set(object, object.visible); object.visible = false;
      }
    });
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Jungle architecture unavailable; keeping the original arena props.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    stop();
    const architecture = group.getObjectByName('jungle_blender_architecture');
    if (architecture) disposeJungleObjectResources([architecture]);
  } };
}

