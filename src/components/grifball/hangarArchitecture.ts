import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import { createHangarArchitectureMaterial } from './hangarMaterials';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { disposeHangarObjectResources } from './hangarResourceDisposal';

export const HANGAR_ARCHITECTURE_ASSETS = {
  high: 'assets/hangar/architecture/kit-v1.glb',
  low: 'assets/hangar/architecture/kit-low-v1.glb',
} as const;
export const HANGAR_ARCHITECTURE_PARTS = ['wall-bay', 'support-column', 'ceiling-truss', 'high-bay-light'] as const;
export type HangarArchitecturePart = typeof HANGAR_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface HangarArchitectureHandle { ready: Promise<void>; cancel: () => void }

/** Rejected downloads can be retried; successful quality sources remain immutable. */
export function createHangarArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail) => {
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
const loadSource = createHangarArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${HANGAR_ARCHITECTURE_ASSETS[detail]}`);
  for (const name of HANGAR_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(name)) throw new Error(`Hangar architecture is missing ${name}`);
  }
  return scene;
});

const validRadius = (radius: number): number => Number.isFinite(radius) && radius > 0 ? radius : 20;

/** Match the existing visual perimeter; neither colliders nor spawn points are created here. */
export function getHangarArchitecturePlacements(arenaRadius = 20): Record<HangarArchitecturePart, THREE.Matrix4[]> {
  const scale = validRadius(arenaRadius) / 20;
  const placements: Record<HangarArchitecturePart, THREE.Matrix4[]> = {
    'wall-bay': [], 'support-column': [], 'ceiling-truss': [], 'high-bay-light': [],
  };
  const matrix = (x: number, y: number, z: number, yaw = 0, sx = 1, sz = 1) => new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
    new THREE.Vector3(sx, 1, sz),
  );
  for (let index = 0; index < 12; index++) {
    const angle = index * Math.PI / 6;
    const midAngle = angle + Math.PI / 12;
    // Authored +Z faces inward, as in the original Object3D.lookAt(0, 6, 0).
    placements['wall-bay'].push(matrix(Math.cos(midAngle) * 20.6 * scale, 6, Math.sin(midAngle) * 20.6 * scale,
      -Math.PI / 2 - midAngle, scale, scale));
    placements['support-column'].push(matrix(Math.cos(angle) * 20.3 * scale, 6, Math.sin(angle) * 20.3 * scale,
      -Math.PI / 2 - angle));
  }
  for (const offset of [-15, 0, 15]) {
    placements['ceiling-truss'].push(matrix(0, 11, offset * scale, 0, scale));
    placements['ceiling-truss'].push(matrix(offset * scale, 11.2, 0, Math.PI / 2, scale));
  }
  // Fixtures stay above the original trusses' lowest edge (10.25 m), not in combat sightlines.
  for (const x of [-10, 0, 10]) for (const z of [-7.5, 7.5]) {
    placements['high-bay-light'].push(matrix(x * scale, 10.75, z * scale));
  }
  return placements;
}

function applyPlacements(group: THREE.Object3D, radius: number): void {
  const placements = getHangarArchitecturePlacements(radius);
  group.traverse(child => {
    if (child.userData.hangarRoof === true) child.scale.set(radius / 20, 1, radius / 20);
    if (!(child instanceof THREE.InstancedMesh)) return;
    const part = child.userData.hangarPart as HangarArchitecturePart | undefined;
    if (!part || !placements[part]) return;
    placements[part].forEach((matrix, index) => child.setMatrixAt(index, matrix));
    child.instanceMatrix.needsUpdate = true;
    child.computeBoundingBox(); child.computeBoundingSphere();
  });
  group.userData.arenaRadius = radius;
}

/** Preserve the existing player-count radius control, including changes made during a download. */
export function syncHangarSceneryRadius(scene: THREE.Scene, arenaRadius: number): void {
  const group = scene.getObjectByName('hangar_scenery');
  if (!group) return;
  const radius = validRadius(arenaRadius);
  if (group.userData.arenaRadius === radius) return;
  scene.userData.hangarArenaRadius = radius;
  applyPlacements(group, radius);
}

/** Each material-role mesh is one draw across all bays/columns/trusses. */
export function createHangarArchitectureInstances(
  source: THREE.Group, arenaRadius: number, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = HANGAR_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root) throw new Error(`Hangar architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'hangar_blender_architecture'; group.userData.detail = detail;
  const placements = getHangarArchitecturePlacements(arenaRadius);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ownMaterial = (sourceMaterial: THREE.Material) => {
    const existing = materials.get(sourceMaterial);
    if (existing) return existing;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    if (!supplied || supplied === sourceMaterial) {
      for (const [slot, value] of Object.entries(material)) {
        if (!(value instanceof THREE.Texture)) continue;
        let texture = textures.get(value);
        if (!texture) { texture = value.clone(); textures.set(value, texture); }
        (material as unknown as Record<string, unknown>)[slot] = texture;
      }
    }
    material.userData.preserveEmissiveIntensity = true;
    materials.set(sourceMaterial, material);
    return material;
  };
  try {
    source.updateMatrixWorld(true);
    for (const [index, part] of HANGAR_ARCHITECTURE_PARTS.entries()) {
      const root = roots[index];
      const inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        applyStadiumWorldUVs(geometry, 3);
        const assigned = (Array.isArray(child.material) ? child.material : [child.material]).map(ownMaterial);
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], placements[part].length);
        mesh.name = `hangar_kit_${part}_${child.name}`;
        mesh.userData.hangarPart = part;
        mesh.castShadow = part === 'wall-bay' || part === 'support-column'; mesh.receiveShadow = true;
        group.add(mesh);
      });
    }
    applyPlacements(group, validRadius(arenaRadius));
    return group;
  } catch (error) {
    // Include handles allocated just before a material/batch construction failed.
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...materials.values()]));
    disposeHangarObjectResources([group, ...holders]);
    throw error;
  }
}

/** A complete low-cost shell exists before any asset or texture request can finish. */
export function createHangarFallback(arenaRadius: number, materialFactory?: MaterialFactory): THREE.Group {
  const source = new THREE.Group();
  const materialByRole = new Map<string, THREE.MeshStandardMaterial>();
  const roleMaterial = (name: string) => {
    let material = materialByRole.get(name);
    if (!material) {
      const light = name === 'hangar_light';
      material = new THREE.MeshStandardMaterial({ color: light ? '#dce7e8' : name === 'hangar_ceramic' ? '#6e767a' : '#323c45',
        roughness: 0.7, metalness: 0.45, emissive: light ? '#dce7e8' : '#000000', emissiveIntensity: light ? 0.7 : 0 });
      material.name = name; materialByRole.set(name, material);
    }
    return material;
  };
  const module = (name: HangarArchitecturePart, boxes: [string, number, number, number, number, number, number][]) => {
    const root = new THREE.Group(); root.name = name; source.add(root);
    const parts = new Map<string, THREE.BufferGeometry[]>();
    for (const [role, x, y, z, sx, sy, sz] of boxes) {
      const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z);
      const batch = parts.get(role) ?? []; batch.push(geometry); parts.set(role, batch);
    }
    for (const [role, pieces] of parts) {
      const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
      if (geometry) { const mesh = new THREE.Mesh(geometry, roleMaterial(role)); mesh.name = role; root.add(mesh); }
    }
  };
  module('wall-bay', [
    ['hangar_graphite', 0, 0, -0.17, 10.68, 12, 0.21],
    ['hangar_ceramic', 0, 1, 0, 10.1, 6, 0.18],
    ['hangar_alloy', 0, -3.5, 0, 10.68, 0.25, 0.5],
    ['hangar_alloy', 0, 3.5, 0, 10.68, 0.25, 0.5],
  ]);
  module('support-column', [
    ['hangar_alloy', 0, 0, 0, 0.55, 12, 0.9],
    ['hangar_alloy', 0, -5.85, 0, 1.5, 0.3, 1.5],
    ['hangar_ceramic', 0, 0, 0.5, 0.75, 10.8, 0.16],
  ]);
  const truss: [string, number, number, number, number, number, number][] = [
    ['hangar_alloy', 0, 0.625, 0, 50, 0.25, 0.5],
    ['hangar_alloy', 0, -0.625, 0, 50, 0.25, 0.5],
  ];
  for (let x = -24; x <= 24; x += 4) truss.push(['hangar_alloy', x, 0, 0, 0.12, 1.25, 0.3]);
  module('ceiling-truss', truss);
  module('high-bay-light', [
    ['hangar_graphite', 0, 0, 0, 4, 0.5, 1.2],
    ['hangar_light', 0, -0.245, 0, 3.7, 0.01, 0.95],
  ]);
  try {
    const fallback = createHangarArchitectureInstances(source, arenaRadius, 'low', materialFactory);
    fallback.name = 'hangar_fallback_architecture';
    return fallback;
  } finally { disposeHangarObjectResources([source]); }
}

/** Sparse ceiling seams and an opaque backing replace the outdoor laser-line skyline. */
export function createHangarCeiling(arenaRadius: number, materialFactory?: MaterialFactory): THREE.Group {
  const group = new THREE.Group(); group.name = 'hangar_ceiling'; group.userData.hangarRoof = true;
  group.scale.set(validRadius(arenaRadius) / 20, 1, validRadius(arenaRadius) / 20);
  const material = (name: string, color: string) => {
    const source = new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.8 }); source.name = name;
    const owned = materialFactory?.(source) ?? source.clone();
    if (owned !== source) source.dispose();
    owned.side = THREE.DoubleSide;
    return owned;
  };
  const graphite = material('hangar_graphite', '#27323b');
  const alloy = material('hangar_alloy', '#52616a');
  const backing = new THREE.Mesh(new THREE.CylinderGeometry(21.4, 21.4, 0.28, 12), graphite);
  backing.position.y = 14.5; backing.name = 'hangar_ceiling_backing'; group.add(backing);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(21.1, 21.1, 2.4, 12, 1, true), graphite);
  collar.position.y = 13.2; collar.name = 'hangar_ceiling_collar'; group.add(collar);
  const points: number[] = [];
  for (const [radius, angle] of [[1.8, -13], [21.25, -14.6], [21.25, 14.6], [1.8, 13]]) {
    points.push(Math.cos(angle * Math.PI / 180) * radius, 0, Math.sin(angle * Math.PI / 180) * radius);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals(); applyStadiumWorldUVs(geometry, 6);
  const panels = new THREE.InstancedMesh(geometry, alloy, 12); panels.name = 'hangar_ceiling_panels';
  for (let index = 0; index < 12; index++) {
    const matrix = new THREE.Matrix4().makeRotationY(index * Math.PI / 6 + Math.PI / 12);
    matrix.setPosition(0, 14.3, 0); panels.setMatrixAt(index, matrix);
  }
  panels.instanceMatrix.needsUpdate = true; panels.computeBoundingBox(); panels.computeBoundingSphere();
  group.add(panels);
  // The existing single shadow light acts as the indoor fixture key. An opaque
  // roof must not shadow that virtual light out of the entire playfield.
  group.traverse(child => { if (child instanceof THREE.Mesh) { child.castShadow = false; child.receiveShadow = true; } });
  return group;
}

export function buildHangarSceneryForRefs({
  refs, quality = getEnvironmentQualityProfile(), arenaRadius = 20, load = loadSource,
  materialFactory = source => createHangarArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; quality?: EnvironmentQualityProfile; arenaRadius?: number;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): HangarArchitectureHandle | undefined {
  if (!refs.scene) return;
  const scene = refs.scene;
  const radius = validRadius(arenaRadius);
  const group = new THREE.Group(); group.name = 'hangar_scenery';
  group.userData.architectureStatus = 'loading'; group.userData.arenaRadius = radius;
  scene.userData.hangarArenaRadius = radius;
  const fallback = createHangarFallback(radius, materialFactory);
  group.add(fallback, createHangarCeiling(radius, materialFactory)); scene.add(group);
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createHangarArchitectureInstances(source, group.userData.arenaRadius, quality.architectureDetail, materialFactory);
    group.add(architecture);
    disposeHangarObjectResources([fallback]);
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Hangar architecture unavailable; keeping the complete arena shell.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: () => {
    canceled = true;
    if (group.userData.architectureStatus === 'loading') group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  } };
}
