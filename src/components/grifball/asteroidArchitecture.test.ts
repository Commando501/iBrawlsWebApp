import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { CustomMapData } from '../../types';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeAsteroidObjectResources, disposeAsteroidResources } from './asteroidResourceDisposal';
import {
  ASTEROID_ARCHITECTURE_PARTS, ASTEROID_REPLACED_OBJECT_IDS, buildAsteroidSceneryForRefs,
  createAsteroidArchitectureInstances, createAsteroidArchitectureSourceCache, createAsteroidPerimeter,
  getAsteroidArchitecturePlacements, syncAsteroidSceneryRadius,
} from './asteroidArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'vanguard_starbase')!;
const sizes = [[2.6, 5, 2.6], [2.2, 3, 2.2], [1.8, 2, 3.5], [5, 3, 0.4], [14, 14, 14], [12, 16, 7]];
const sourceKit = () => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture }); material.name = 'asteroid_alloy';
  for (const name of ASTEROID_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();
const assertMatrix = (actual: THREE.Matrix4, expected: THREE.Matrix4) => {
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 3e-6));
};

test('Asteroid source cache coalesces each quality request and retries failures', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createAsteroidArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
});

test('Replacement matrices retain every authored object position, rotation and dimension without mutating map data', () => {
  const before = JSON.stringify(map);
  assert.deepEqual(map.objects.map(object => [object.id, object.type,
    [object.position.x, object.position.y, object.position.z],
    [object.scale.x, object.scale.y, object.scale.z], [object.rotation.x, object.rotation.y, object.rotation.z], object.isCollidable]), [
    ['obj_extractor', 'cylinder', [0, 2.5, 0], [2.6, 5, 2.6], [0, 0, 0], true],
    ['obj_asteroid_1', 'box', [-6, 1.5, 5], [2.2, 3, 2.2], [0, 0.6, 0], true],
    ['obj_asteroid_2', 'box', [6, 1.5, -5], [2.2, 3, 2.2], [0, -0.4, 0], true],
    ['obj_container_l', 'box', [-7, 1, -5], [1.8, 2, 3.5], [0, 0.1, 0], true],
    ['obj_container_r', 'box', [7, 1, 5], [1.8, 2, 3.5], [0, 0.1, 0], true],
    ['obj_partition_n', 'box', [0, 1.5, -8], [5, 3, 0.4], [0, 0, 0], true],
    ['obj_partition_s', 'box', [0, 1.5, 8], [5, 3, 0.4], [0, 0, 0], true],
  ]);
  const converted: CustomMapData = { ...map, arenaRadius: 28.5,
    objects: map.objects.slice(2).map(object => ({ ...object,
      position: { x: object.position.x * 1.7, y: object.position.y, z: object.position.z * 1.3 },
      rotation: { x: 0.12, y: 0.8, z: 0.06 },
      scale: { x: object.scale.x * 1.7, y: object.scale.y, z: object.scale.z * 1.3 },
    })) };
  for (const active of [map, converted]) {
    const placements = getAsteroidArchitecturePlacements(active, 'high');
    const found = Object.values(placements).flat().filter(placement => placement.objectId);
    assert.equal(found.length, active.objects.length);
    for (const object of active.objects) {
      const [part, placement] = Object.entries(placements).flatMap(([part, items]) => items.map(item => [part, item] as const))
        .find(([, item]) => item.objectId === object.id)!;
      const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
      placement.matrix.decompose(position, rotation, scale);
      assert.ok(position.distanceTo(new THREE.Vector3(object.position.x, object.position.y, object.position.z)) < 1e-7);
      const expected = new THREE.Quaternion().setFromEuler(new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z));
      assert.ok(rotation.angleTo(expected) < 1e-7);
      const index = ASTEROID_ARCHITECTURE_PARTS.indexOf(part as typeof ASTEROID_ARCHITECTURE_PARTS[number]);
      assert.ok(new THREE.Vector3().fromArray(sizes[index]).multiply(scale)
        .distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
  }
  assert.equal(JSON.stringify(map), before);
  assert.equal(map.arenaRadius, 19); assert.equal(map.objects.length, 7);
});

test('Staggered mine structures stay outside the full floor and three-draw crust stays below it', () => {
  for (const active of [map, { ...map, arenaRadius: 26.125 }, { ...map, arenaRadius: 28.5 }]) {
    for (const detail of ['high', 'low'] as const) {
      const placements = getAsteroidArchitecturePlacements(active, detail);
      assert.equal(placements['asteroid-crag'].length, detail === 'high' ? 8 : 5);
      assert.equal(placements['mining-gantry'].length, detail === 'high' ? 4 : 2);
      for (const part of ['asteroid-crag', 'mining-gantry'] as const) {
        const radii = new Set<number>(), yaws = new Set<number>();
        for (const item of placements[part]) {
          const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
          item.matrix.decompose(position, rotation, scale);
          const half = part === 'asteroid-crag' ? [7, 7, 7] : [6, 8, 3.5];
          const extent = Math.hypot(half[0] * scale.x, half[2] * scale.z);
          assert.ok(Math.hypot(position.x, position.z) - extent >= active.arenaRadius + 3.39);
          assert.ok(Math.abs(position.y - half[1] * scale.y + (part === 'asteroid-crag' ? 1.2 : .65)) < 1e-6);
          radii.add(Math.hypot(position.x,position.z)); yaws.add(rotation.y);
        }
        assert.ok(radii.size >= 2); assert.ok(yaws.size >= 2);
      }
    }
    const perimeter = createAsteroidPerimeter(active, cloneMaterial);
    assert.equal(perimeter.children.length, 3);
    assert.ok(new THREE.Box3().setFromObject(perimeter).max.y < -0.1);
    perimeter.traverse(object => { if (object instanceof THREE.Mesh) assert.equal(object.castShadow, false); });
    disposeAsteroidObjectResources([perimeter]);
  }
});
test('Instances own geometry, material and texture handles even with shallow-cloning or passthrough factories', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit();
    const first = createAsteroidArchitectureInstances(source, map, 'high', factory);
    const second = createAsteroidArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 6); assert.equal(a.count, 1);
    assert.notEqual(a.geometry, cached.geometry); assert.notEqual(a.geometry, b.geometry);
    assert.notEqual(a.material, cached.material); assert.notEqual(a.material, b.material);
    assert.notEqual(a.material.map, cached.material.map); assert.notEqual(a.material.map, b.material.map);
    assert.equal(a.material.map, a.material.roughnessMap);
    assert.equal(a.material.userData.preserveEmissiveIntensity, true);
    let sharedDisposed = 0;
    for (const resource of [cached.geometry, cached.material, cached.material.map!, b.geometry, b.material, b.material.map!]) {
      const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
      dispatcher.addEventListener('dispose', () => sharedDisposed++);
    }
    disposeAsteroidObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeAsteroidObjectResources([second, source]);
  }
});

test('Successful kit attachment hides only tagged originals and cancel restores their exact original visibility', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = ASTEROID_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.asteroidLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const handle = buildAsteroidSceneryForRefs({ refs, activeCustomMap: map, load: async () => sourceKit(), materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('asteroid_blender_architecture'));
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('asteroid_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('asteroid_perimeter'));
  for (const mesh of legacy) {
    assert.equal(refs.scene.getObjectByName(mesh.name), mesh); assert.ok(refs.customMapObjects!.includes(mesh));
  }
  disposeAsteroidResources(refs.scene); assert.equal(refs.scene.children[0], actor);
});

test('Failed, malformed, canceled, detached and disposed pending loads retain originals and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.asteroidLegacyId = 'obj_extractor'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildAsteroidSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('asteroid_scenery')!;
    assert.ok(group.getObjectByName('asteroid_perimeter')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeAsteroidResources(refs.scene); await handle.ready; }
    if (outcome === 'failed') reject(new Error('offline')); else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('asteroid_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeAsteroidObjectResources([group]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildAsteroidSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_asteroid_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching must not alter user maps');
});

test('Existing 20-based roster scaling moves only terrain and remote mine structures, including pending attachment', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const handle = buildAsteroidSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('high'), load: () => pending, materialFactory: cloneMaterial })!;
  syncAsteroidSceneryRadius(refs.scene, 27.5);
  assert.equal(refs.scene.getObjectByName('asteroid_perimeter')!.scale.x, 1.375);
  resolve(sourceKit()); await handle.ready;
  const check = (radius: number) => {
    const expected = getAsteroidArchitecturePlacements(map, 'high', radius);
    refs.scene!.getObjectByName('asteroid_blender_architecture')!.traverse(child => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const part = child.userData.architecturePart as typeof ASTEROID_ARCHITECTURE_PARTS[number];
      expected[part].forEach((placement, index) => { const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix); assertMatrix(matrix, placement.matrix); });
    });
  };
  assert.equal(refs.scene.getObjectByName('asteroid_scenery')!.userData.arenaRadius, 26.125);
  check(26.125); syncAsteroidSceneryRadius(refs.scene, 30); check(28.5);
  syncAsteroidSceneryRadius(refs.scene, 20); check(19);
  assert.equal(refs.scene.getObjectByName('asteroid_perimeter')!.scale.x, 1);
  disposeAsteroidResources(refs.scene);
});

test('Shipping Blender kits preserve centered collision envelopes and fit scene budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/asteroid/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of ASTEROID_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < 0.01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, `${part} centered`);
      if (part === 'ore-extractor') {
        root.updateMatrixWorld(true);
        const inverse = root.matrixWorld.clone().invert();
        root.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const transform = inverse.clone().multiply(child.matrixWorld), position = child.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
            assert.ok(Math.hypot(vertex.x, vertex.z) <= 1.3001, `${part} cylinder collision envelope`);
          }
        });
      }
    }
    const instances = createAsteroidArchitectureInstances(source, map, detail, undefined, 28.5);
    let triangles = 0, draws = 0;
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
      if (child.userData.architecturePart === 'asteroid-crag' || child.userData.architecturePart === 'mining-gantry') {
        assert.equal(child.castShadow, false, 'remote architecture does not add shadow work');
        const position = child.geometry.getAttribute('position'), matrix = new THREE.Matrix4();
        for (let instance = 0; instance < child.count; instance++) {
          child.getMatrixAt(instance, matrix);
          for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
            assert.ok(Math.hypot(vertex.x, vertex.z) > 28.5 + 3, 'all actual remote geometry stays outside the largest floor');
          }
        }
      }
    }
    assert.ok(draws + 3 <= 27, `${detail}: ${draws + 3} draw budget`);
    assert.ok(triangles < (detail === 'high' ? 230_000 : 65_000), `${detail}: ${triangles} triangle budget`);
    reports.push({ detail, triangles, draws }); disposeAsteroidObjectResources([instances, source]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * 0.5, 'Low materially reduces geometry');
});



