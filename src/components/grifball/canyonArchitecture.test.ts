import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import { getRectHalfExtents } from '../../game/arenaDimensions';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeCanyonResources } from './canyonResourceDisposal';
import {
  CANYON_ARCHITECTURE_PARTS, CANYON_REPLACED_OBJECT_IDS, buildCanyonSceneryForRefs,
  createCanyonArchitectureInstances, createCanyonArchitectureSourceCache, createCanyonPerimeter,
  getCanyonArchitecturePlacements,
} from './canyonArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'forerunner_canyon')!;
const sourceKit = () => {
  const source = new THREE.Group();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture });
  material.name = 'canyon_alloy';
  for (const name of CANYON_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();

test('Canyon source cache coalesces requests and retries rejected quality entries', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createCanyonArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
});

test('all existing prop centers, rotations and dimensions survive without changing gameplay data', () => {
  const before = JSON.stringify(map);
  // Converted modes can resize or remove props. Replacement reads the actual
  // data, rather than assuming the premade sandbox geometry.
  for (const active of [map, { ...map, arenaHalfExtents: { x: 52, z: 23 }, objects: map.objects.slice(2).map(object => ({
    ...object, position: { x: object.position.x * 1.7, y: object.position.y, z: object.position.z * 1.3 },
    scale: { x: object.scale.x * 1.7, y: object.scale.y, z: object.scale.z * 1.3 },
  })) }]) {
    const placements = getCanyonArchitecturePlacements(active, 'high');
    const found = Object.values(placements).flat().filter(placement => placement.objectId);
    assert.equal(found.length, active.objects.length);
    for (const object of active.objects) {
      const placement = found.find(item => item.objectId === object.id)!;
      assert.ok(placement, object.id);
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      placement.matrix.decompose(position, rotation, scale);
      assert.deepEqual(position.toArray(), [object.position.x, object.position.y, object.position.z]);
      const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
      assert.ok(rotation.angleTo(expected) < 1e-7);
      const originalSize = object.id.startsWith('barrier') ? [1.2, 2, 4] : object.id === 'bg_beacon_tower' ? [3, 40, 3] : [2, 8, 2];
      assert.ok(new THREE.Vector3().fromArray(originalSize).multiply(scale).distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
  }
  assert.equal(JSON.stringify(map), before);
});

test('cliff bounds stay outside combat and all perimeter detail stays beneath the original floor', () => {
  for (const half of [{ x: 24, z: 12 }, { x: 52, z: 23 }]) {
    const active = { ...map, arenaHalfExtents: half };
    const playBounds = new THREE.Box3(new THREE.Vector3(-half.x, -100, -half.z), new THREE.Vector3(half.x, 100, half.z));
    for (const detail of ['high', 'low'] as const) {
      const cliffs = getCanyonArchitecturePlacements(active, detail)['canyon-cliff'];
      assert.equal(cliffs.length, detail === 'high' ? 8 : 5);
      for (const cliff of cliffs) {
        const box = new THREE.Box3(new THREE.Vector3(-10, -15, -6), new THREE.Vector3(10, 15, 6)).applyMatrix4(cliff.matrix);
        assert.equal(box.intersectsBox(playBounds), false);
      }
    }
    const perimeter = createCanyonPerimeter(active, cloneMaterial);
    assert.equal(perimeter.children.length, 3, 'three material batches regardless of map size');
    const bounds = new THREE.Box3().setFromObject(perimeter);
    assert.ok(bounds.max.y < 0, 'never cover the playable floor');
  }
  assert.deepEqual(getRectHalfExtents(map.arenaRadius), { x: 24, z: 12 });
});

test('independent instances own their materials, textures and geometry while cached sources survive cleanup', () => {
  const source = sourceKit();
  const first = createCanyonArchitectureInstances(source, map, 'high');
  const second = createCanyonArchitectureInstances(source, map, 'high');
  const cachedMesh = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const firstMesh = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const secondMesh = second.children[0] as typeof firstMesh;
  assert.equal(first.children.length, 4);
  assert.equal(firstMesh.count, 8);
  assert.notEqual(firstMesh.geometry, cachedMesh.geometry); assert.notEqual(firstMesh.geometry, secondMesh.geometry);
  assert.notEqual(firstMesh.material, secondMesh.material); assert.notEqual(firstMesh.material.map, cachedMesh.material.map);
  assert.notEqual(firstMesh.material.map, secondMesh.material.map); assert.equal(firstMesh.material.map, firstMesh.material.roughnessMap);
  let sharedDisposed = 0;
  for (const resource of [cachedMesh.geometry, cachedMesh.material, cachedMesh.material.map!, secondMesh.geometry, secondMesh.material, secondMesh.material.map!]) {
    resource.addEventListener('dispose', () => sharedDisposed++);
  }
  const scene = new THREE.Scene(); const owner = new THREE.Group(); owner.name = 'canyon_scenery'; owner.add(first); scene.add(owner);
  disposeCanyonResources(scene); assert.equal(sharedDisposed, 0);
});

test('successful kit attachment replaces only matching legacy visuals; failed and canceled loads preserve fallback', async () => {
  for (const outcome of ['ready', 'failed', 'canceled', 'detached'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = CANYON_REPLACED_OBJECT_IDS.map(id => {
      const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.canyonLegacyId = id; refs.scene!.add(mesh); return mesh;
    });
    const unrelated = new THREE.Mesh(); unrelated.name = 'original_character'; refs.scene.add(unrelated);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let failures = 0;
    const handle = buildCanyonSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: async detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => failures++ })!;
    assert.ok(handle); assert.ok(legacy.every(mesh => mesh.visible));
    if (outcome === 'canceled') handle.cancel();
    if (outcome === 'detached') refs.scene.getObjectByName('canyon_scenery')!.removeFromParent();
    if (outcome === 'failed') reject(new Error('offline')); else resolve(sourceKit());
    await handle.ready;
    assert.ok(legacy.every(mesh => mesh.visible === (outcome !== 'ready')));
    for (const mesh of legacy) assert.equal(refs.scene.getObjectByName(mesh.userData.canyonLegacyId), mesh, 'preserve legacy object lookup');
    assert.equal(failures, outcome === 'failed' ? 1 : 0); assert.equal(unrelated.visible, true);
    assert.equal(Boolean(refs.scene.getObjectByName('canyon_blender_architecture')), outcome === 'ready');
    disposeCanyonResources(refs.scene);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildCanyonSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_forerunner_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'a matching theme alone must not change user maps');
});

test('shipping Blender kits preserve prop extents and fit scene draw/triangle budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/canyon/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    const sourceSizes = [[2, 8, 2], [1.2, 2, 4], [3, 40, 3], [20, 30, 12]];
    for (const [index, part] of CANYON_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!;
      assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sourceSizes[index])) < 0.01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, `${part} center pivot`);
    }
    const instances = createCanyonArchitectureInstances(source, map, detail);
    let triangles = 0, draws = 0;
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
    }
    assert.ok(draws <= 36, `${detail}: ${draws} draw budget`);
    assert.ok(triangles < 190_000, `${detail}: ${triangles} triangle budget`);
    reports.push({ detail, triangles, draws });
  }
  assert.ok(reports[1].triangles < reports[0].triangles * 0.5, 'Low materially reduces geometry');
});
