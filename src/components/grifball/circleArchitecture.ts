import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getEnvironmentQualityProfile, type EnvironmentQualityProfile } from '../../settings/environmentQuality';
import type { GrifballThreeRefs } from './threeRefs';
import { createCircleArchitectureMaterial } from './circleMaterials';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { disposeCircleObjectResources, registerCircleResourceCleanup } from './circleResourceDisposal';

export const CIRCLE_ARCHITECTURE_ASSETS = {
  high: 'assets/circle/architecture/kit-v1.glb',
  low: 'assets/circle/architecture/kit-low-v1.glb',
} as const;
export const CIRCLE_ARCHITECTURE_PARTS = [
  'perimeter-pylon', 'ring-beam', 'projector-node', 'service-pod', 'backdrop-spire',
] as const;
export type CircleArchitecturePart = typeof CIRCLE_ARCHITECTURE_PARTS[number];
type ArchitectureDetail = EnvironmentQualityProfile['architectureDetail'];
type MaterialFactory = (source: THREE.Material) => THREE.Material | undefined;
export interface CircleArchitectureHandle { ready: Promise<void>; cancel: () => void }

/** Only immutable source kits are cached; a failed request must remain retryable. */
export function createCircleArchitectureSourceCache(load: (detail: ArchitectureDetail) => Promise<THREE.Group>) {
  const cache = new Map<ArchitectureDetail, Promise<THREE.Group>>();
  return (detail: ArchitectureDetail) => {
    const existing = cache.get(detail);
    if (existing) return existing;
    const pending = Promise.resolve().then(() => load(detail)).catch(error => {
      if (cache.get(detail) === pending) cache.delete(detail);
      throw error;
    });
    cache.set(detail, pending);
    return pending;
  };
}
const loadSource = createCircleArchitectureSourceCache(async detail => {
  const base = import.meta.env?.BASE_URL ?? '/';
  const { scene } = await new GLTFLoader().loadAsync(`${base}${CIRCLE_ARCHITECTURE_ASSETS[detail]}`);
  for (const part of CIRCLE_ARCHITECTURE_PARTS) {
    if (!scene.getObjectByName(part)) throw new Error(`Circle architecture is missing ${part}`);
  }
  return scene;
});
const validRadius = (radius: number): number => Number.isFinite(radius) && radius > 0 ? radius : 20;

/** The halo is outside the collision circle at every roster size, including its chord midpoints. */
export function getCircleArchitecturePlacements(
  arenaRadius = 20, detail: ArchitectureDetail = 'high',
): Record<CircleArchitecturePart, THREE.Matrix4[]> {
  const radius = validRadius(arenaRadius);
  const placements: Record<CircleArchitecturePart, THREE.Matrix4[]> = {
    'perimeter-pylon': [], 'ring-beam': [], 'projector-node': [], 'service-pod': [], 'backdrop-spire': [],
  };
  const radial = (distance: number, angle: number, y: number, sx = 1) => new THREE.Matrix4().compose(
    new THREE.Vector3(Math.cos(angle) * distance, y, Math.sin(angle) * distance),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -angle - Math.PI / 2),
    new THREE.Vector3(sx, 1, 1),
  );
  const haloRadius = radius + 4;
  for (let index = 0; index < 16; index++) {
    const angle = (index + .5) * Math.PI / 8;
    const chord = 2 * haloRadius * Math.sin(Math.PI / 16);
    placements['ring-beam'].push(radial(haloRadius * Math.cos(Math.PI / 16), angle, 9, chord / 7));
  }
  for (let index = 0; index < 8; index++) {
    const angle = index * Math.PI / 4;
    placements['perimeter-pylon'].push(radial(haloRadius, angle, 4.5));
    placements['projector-node'].push(radial(radius + 1.5, angle + Math.PI / 8, .4));
  }
  for (let index = 0; index < 4; index++) {
    placements['service-pod'].push(radial(radius + 8, (index + .5) * Math.PI / 2, 1.5));
  }
  const spires = detail === 'high' ? 8 : 4;
  for (let index = 0; index < spires; index++) {
    placements['backdrop-spire'].push(radial(radius + 30, (index + .5) * Math.PI * 2 / spires, 11));
  }
  return placements;
}

function applyPlacements(group: THREE.Object3D, radius: number): void {
  const detail: ArchitectureDetail = group.userData.detail === 'low' ? 'low' : 'high';
  const placements = getCircleArchitecturePlacements(radius, detail);
  group.traverse(child => {
    if (child.userData.circleRadialDeck === true) child.scale.set(radius / 20, 1, radius / 20);
    if (!(child instanceof THREE.InstancedMesh)) return;
    const part = child.userData.circlePart as CircleArchitecturePart | undefined;
    if (!part) return;
    placements[part].forEach((matrix, index) => child.setMatrixAt(index, matrix));
    child.instanceMatrix.needsUpdate = true;
    child.computeBoundingBox(); child.computeBoundingSphere();
  });
  group.userData.arenaRadius = radius;
}

/** Preserve the existing roster radius; never alter collision shapes, actors, or spawn points. */
export function syncCircleSceneryRadius(scene: THREE.Scene, arenaRadius: number): void {
  const group = scene.getObjectByName('circle_scenery');
  if (!group && !scene.getObjectByName('circle_floor')) return;
  const radius = validRadius(arenaRadius);
  scene.userData.circleArenaRadius = radius;
  if (!group || group.userData.arenaRadius === radius) return;
  applyPlacements(group, radius);
}

/** Scene-owned geometry, materials and textures keep the shared GLB cache safe during cleanup. */
export function createCircleArchitectureInstances(
  source: THREE.Group, arenaRadius: number, detail: ArchitectureDetail, materialFactory?: MaterialFactory,
): THREE.Group {
  const roots = CIRCLE_ARCHITECTURE_PARTS.map(part => {
    const root = source.getObjectByName(part);
    if (!root) throw new Error(`Circle architecture is missing ${part}`);
    return root;
  });
  const group = new THREE.Group(); group.name = 'circle_blender_architecture'; group.userData.detail = detail;
  const placements = getCircleArchitecturePlacements(arenaRadius, detail);
  const materials = new Map<THREE.Material, THREE.Material>();
  const textures = new Map<THREE.Texture, THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const ownMaterial = (sourceMaterial: THREE.Material) => {
    const cached = materials.get(sourceMaterial);
    if (cached) return cached;
    const supplied = materialFactory?.(sourceMaterial);
    const material = supplied && supplied !== sourceMaterial ? supplied : sourceMaterial.clone();
    const sourceTextures = new Set(Object.values(sourceMaterial).filter(value => value instanceof THREE.Texture));
    for (const [slot, value] of Object.entries(material)) {
      if (!(value instanceof THREE.Texture) || (supplied && supplied !== sourceMaterial && !sourceTextures.has(value))) continue;
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
    for (const [index, part] of CIRCLE_ARCHITECTURE_PARTS.entries()) {
      const root = roots[index];
      const inverse = root.matrixWorld.clone().invert();
      root.traverse(child => {
        if (!(child instanceof THREE.Mesh)) return;
        const geometry = child.geometry.clone(); geometries.add(geometry);
        geometry.applyMatrix4(inverse.clone().multiply(child.matrixWorld));
        applyStadiumWorldUVs(geometry, 3);
        const assigned = (Array.isArray(child.material) ? child.material : [child.material]).map(ownMaterial);
        const mesh = new THREE.InstancedMesh(geometry, Array.isArray(child.material) ? assigned : assigned[0], placements[part].length);
        mesh.name = `circle_kit_${part}_${child.name}`;
        mesh.userData.circlePart = part;
        // Remote scenery and thin halo accents need no shadow pass of their own.
        mesh.castShadow = part === 'perimeter-pylon' || part === 'service-pod'; mesh.receiveShadow = true;
        group.add(mesh);
      });
    }
    applyPlacements(group, validRadius(arenaRadius));
    return group;
  } catch (error) {
    const holders = [...geometries].map(geometry => new THREE.Mesh(geometry, [...materials.values()]));
    disposeCircleObjectResources([group, ...holders]);
    throw error;
  }
}

/** A readable, complete perimeter survives blocked or unavailable kit requests. */
export function createCircleFallback(
  arenaRadius: number, detail: ArchitectureDetail = 'high', materialFactory?: MaterialFactory,
): THREE.Group {
  const source = new THREE.Group();
  const materialByRole = new Map<string, THREE.MeshStandardMaterial>();
  const roleMaterial = (name: string) => {
    let material = materialByRole.get(name);
    if (!material) {
      const cyan = name === 'circle_cyan';
      material = new THREE.MeshStandardMaterial({ color: cyan ? '#58aaba' : name === 'circle_ceramic' ? '#b2bec2' : '#394a56',
        roughness: .7, metalness: .45, emissive: cyan ? '#58aaba' : '#000000', emissiveIntensity: cyan ? .5 : 0 });
      material.name = name; materialByRole.set(name, material);
    }
    return material;
  };
  type Box = [string, number, number, number, number, number, number];
  const module = (name: CircleArchitecturePart, boxes: Box[]) => {
    const root = new THREE.Group(); root.name = name; source.add(root);
    const batches = new Map<string, THREE.BufferGeometry[]>();
    for (const [role, x, y, z, sx, sy, sz] of boxes) {
      const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.translate(x, y, z);
      const batch = batches.get(role) ?? []; batch.push(geometry); batches.set(role, batch);
    }
    for (const [role, pieces] of batches) {
      const geometry = mergeGeometries(pieces); pieces.forEach(piece => piece.dispose());
      if (geometry) { const mesh = new THREE.Mesh(geometry, roleMaterial(role)); mesh.name = role; root.add(mesh); }
    }
  };
  module('perimeter-pylon', [
    ['circle_alloy', 0, 0, 0, 1.2, 9, 1.2],
    ['circle_ceramic', 0, -.3, .58, .76, 7.5, .04],
    ['circle_cyan', 0, 2.8, .605, .3, 1.2, .01],
  ]);
  module('ring-beam', [
    ['circle_alloy', 0, 0, 0, 7, .5, .9],
    ['circle_cyan', 0, -.22, .455, 6.6, .04, .01],
  ]);
  module('projector-node', [
    ['circle_alloy', 0, 0, 0, 1.8, 1.2, 1.2],
    ['circle_cyan', 0, .605, 0, .8, .01, .6],
  ]);
  module('service-pod', [
    ['circle_graphite', 0, 0, 0, 4, 3, 2.4],
    ['circle_ceramic', 0, 0, 1.18, 3.8, 2.4, .04],
  ]);
  module('backdrop-spire', [
    ['circle_graphite', 0, 0, 0, 3.5, 24, 3.5],
    ['circle_alloy', 0, 1, 1.73, 1.2, 21, .04],
  ]);
  try {
    const fallback = createCircleArchitectureInstances(source, arenaRadius, detail, materialFactory);
    fallback.name = 'circle_fallback_architecture';
    return fallback;
  } finally { disposeCircleObjectResources([source]); }
}

/** Structural depth stays below the old floor; two subdued edge rings leave combat surfaces quiet. */
export function createCircleSubdeck(arenaRadius: number): THREE.Group {
  const group = new THREE.Group(); group.name = 'circle_subdeck'; group.userData.circleRadialDeck = true;
  group.scale.set(validRadius(arenaRadius) / 20, 1, validRadius(arenaRadius) / 20);
  const side = new THREE.MeshStandardMaterial({ color: '#253542', metalness: .6, roughness: .72 });
  side.name = 'circle_subdeck_alloy';
  const backing = new THREE.Mesh(new THREE.CylinderGeometry(20.35, 20.85, .8, 96), side);
  backing.position.y = -.64; backing.name = 'circle_subdeck_backing'; backing.receiveShadow = true;
  group.add(backing);
  const ringParts = [[19.1, 19.15], [18.91, 18.94]].map(([inner, outer]) => {
    const geometry = new THREE.RingGeometry(inner, outer, 128);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, .004, 0);
    return geometry;
  });
  const rings = mergeGeometries(ringParts)!; ringParts.forEach(geometry => geometry.dispose());
  const marking = new THREE.MeshStandardMaterial({ color: '#657a88', roughness: .9, metalness: .12 });
  marking.name = 'circle_edge_marking'; marking.userData.preserveEmissiveIntensity = true;
  const paint = new THREE.Mesh(rings, marking); paint.name = 'circle_edge_markings'; paint.receiveShadow = true;
  group.add(paint);
  return group;
}

export function buildCircleSceneryForRefs({
  refs, quality = getEnvironmentQualityProfile(), load = loadSource,
  materialFactory = source => createCircleArchitectureMaterial(source, quality), onError,
}: {
  refs: GrifballThreeRefs; quality?: EnvironmentQualityProfile;
  load?: (detail: ArchitectureDetail) => Promise<THREE.Group>; materialFactory?: MaterialFactory; onError?: (error: unknown) => void;
}): CircleArchitectureHandle | undefined {
  if (!refs.scene) return;
  const scene = refs.scene;
  const floor = scene.getObjectByName('circle_floor');
  const radius = validRadius(scene.userData.circleArenaRadius ?? (floor ? 20 * floor.scale.x : 20));
  const group = new THREE.Group(); group.name = 'circle_scenery'; group.userData.detail = quality.architectureDetail;
  group.userData.architectureStatus = 'loading'; group.userData.arenaRadius = radius;
  scene.userData.circleArenaRadius = radius;
  const fallback = createCircleFallback(radius, quality.architectureDetail, materialFactory);
  group.add(fallback, createCircleSubdeck(radius)); scene.add(group);
  let canceled = false, settled = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = () => { settled = true; resolve(); }; });
  const stop = () => {
    canceled = true;
    if (group.userData.architectureStatus === 'loading') group.userData.architectureStatus = 'fallback';
    if (!settled) finish();
  };
  registerCircleResourceCleanup(group, stop);
  void Promise.resolve().then(() => load(quality.architectureDetail)).then(source => {
    if (canceled || group.parent !== scene) return;
    const architecture = createCircleArchitectureInstances(source, group.userData.arenaRadius, quality.architectureDetail, materialFactory);
    group.add(architecture);
    disposeCircleObjectResources([fallback]);
    group.userData.architectureStatus = 'ready';
  }).catch(error => {
    if (canceled || group.parent !== scene) return;
    group.userData.architectureStatus = 'fallback';
    (onError ?? (reason => console.warn('Circle architecture unavailable; keeping the complete perimeter.', reason)))(error);
  }).finally(() => { if (!settled) finish(); });
  return { ready, cancel: stop };
}
