import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { CustomMapData } from '../../types';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeJungleObjectResources, disposeJungleResources } from './jungleResourceDisposal';
import {
  JUNGLE_ARCHITECTURE_PARTS, JUNGLE_REPLACED_OBJECT_IDS, buildJungleSceneryForRefs,
  createJungleArchitectureInstances, createJungleArchitectureSourceCache, createJunglePerimeter,
  getJungleArchitecturePlacements, syncJungleSceneryRadius,
} from './jungleArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'botanical_outpost')!;
const sizes = [[1.2, 4, 1.2], [3, 3, 3], [2, 7, 2], [3, 2, 0.6], [12, 24, 12]];
const sourceKit = () => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture }); material.name = 'jungle_alloy';
  for (const name of JUNGLE_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();
const assertMatrix = (actual: THREE.Matrix4, expected: THREE.Matrix4) => {
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 3e-6));
};

test('Jungle source cache coalesces each quality request and retries failures', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createJungleArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
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
    ['obj_nature_totem', 'cylinder', [0, 2, 0], [1.2, 4, 1.2], [0, 0, 0], true],
    ['obj_rock_nw', 'box', [-9, 1.5, -9], [3, 3, 3], [0, 0.3, 0], true],
    ['obj_rock_se', 'box', [9, 1.5, 9], [3, 3, 3], [0, -0.2, 0], true],
    ['obj_trunk_ne', 'cylinder', [9, 3.5, -9], [2, 7, 2], [0, 0, 0], true],
    ['obj_trunk_sw', 'cylinder', [-9, 3.5, 9], [2, 7, 2], [0, 0, 0], true],
    ['obj_ruined_wall_n', 'box', [-4, 1, -4], [3, 2, 0.6], [0, 0.4, 0], true],
    ['obj_ruined_wall_s', 'box', [4, 1, 4], [3, 2, 0.6], [0, 0.4, 0], true],
  ]);
  const converted: CustomMapData = { ...map, arenaRadius: 31.5,
    objects: map.objects.slice(2).map(object => ({ ...object,
      position: { x: object.position.x * 1.7, y: object.position.y, z: object.position.z * 1.3 },
      rotation: { x: 0.12, y: 0.8, z: 0.06 },
      scale: { x: object.scale.x * 1.7, y: object.scale.y, z: object.scale.z * 1.3 },
    })) };
  for (const active of [map, converted]) {
    const placements = getJungleArchitecturePlacements(active, 'high');
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
      const index = JUNGLE_ARCHITECTURE_PARTS.indexOf(part as typeof JUNGLE_ARCHITECTURE_PARTS[number]);
      assert.ok(new THREE.Vector3().fromArray(sizes[index]).multiply(scale)
        .distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
  }
  assert.equal(JSON.stringify(map), before);
  assert.equal(map.arenaRadius, 21); assert.equal(map.objects.length, 7);
});

test('Varied remote canopies stay outside the full floor and three-draw terrain stays below it', () => {
  for (const active of [map, { ...map, arenaRadius: 28.875 }, { ...map, arenaRadius: 31.5 }]) {
    for (const detail of ['high', 'low'] as const) {
      const trees = getJungleArchitecturePlacements(active, detail)['jungle-canopy'];
      assert.equal(trees.length, detail === 'high' ? 32 : 16);
      const heights = new Set<number>(), yaws = new Set<number>();
      const layers = { tall: 0, middle: 0, understory: 0 };
      for (const tree of trees) {
        const position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
        tree.matrix.decompose(position, rotation, scale);
        const crownRadius = Math.hypot(6 * scale.x, 6 * scale.z);
        assert.ok(Math.hypot(position.x, position.z) - crownRadius >= active.arenaRadius + 3.39);
        assert.ok(Math.abs(position.y - 12 * scale.y + 0.55) < 1e-6, 'trees meet distant ground');
        if (scale.y > 0.8) layers.tall++;
        else if (scale.y >= 0.399 && scale.y <= 0.601) {
          layers.middle++;
          assert.ok(scale.x >= 1 && scale.x <= 1.4);
        } else {
          layers.understory++;
          assert.ok(scale.y >= 0.119 && scale.y <= 0.201);
          assert.ok(scale.x >= 0.599 && scale.x <= 0.951);
        }
        heights.add(scale.y); yaws.add(rotation.y);
      }
      assert.ok(heights.size > 5); assert.ok(yaws.size > 5);
      assert.deepEqual(layers, detail === 'high' ? { tall: 16, middle: 8, understory: 8 } : { tall: 10, middle: 3, understory: 3 });
    }
    const perimeter = createJunglePerimeter(active, cloneMaterial);
    assert.equal(perimeter.children.length, 3);
    assert.ok(new THREE.Box3().setFromObject(perimeter).max.y < -0.1);
    perimeter.traverse(object => { if (object instanceof THREE.Mesh) assert.equal(object.castShadow, false); });
    disposeJungleObjectResources([perimeter]);
  }
});

test('Instances own geometry, material and texture handles even with shallow-cloning or passthrough factories', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit();
    const first = createJungleArchitectureInstances(source, map, 'high', factory);
    const second = createJungleArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 5); assert.equal(a.count, 1);
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
    disposeJungleObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeJungleObjectResources([second, source]);
  }
});

test('Successful kit attachment hides only tagged originals and cancel restores their exact original visibility', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = JUNGLE_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.jungleLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const handle = buildJungleSceneryForRefs({ refs, activeCustomMap: map, load: async () => sourceKit(), materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('jungle_blender_architecture'));
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('jungle_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('jungle_perimeter'));
  for (const mesh of legacy) {
    assert.equal(refs.scene.getObjectByName(mesh.name), mesh); assert.ok(refs.customMapObjects!.includes(mesh));
  }
  disposeJungleResources(refs.scene); assert.equal(refs.scene.children[0], actor);
});

test('Failed, malformed, canceled, detached and disposed pending loads retain originals and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.jungleLegacyId = 'obj_nature_totem'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildJungleSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('jungle_scenery')!;
    assert.ok(group.getObjectByName('jungle_perimeter')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeJungleResources(refs.scene); await handle.ready; }
    if (outcome === 'failed') reject(new Error('offline')); else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('jungle_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeJungleObjectResources([group]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildJungleSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_jungle_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching must not alter user maps');
});

test('Existing 20-based roster scaling moves only terrain and remote canopies, including pending attachment', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const handle = buildJungleSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('high'), load: () => pending, materialFactory: cloneMaterial })!;
  syncJungleSceneryRadius(refs.scene, 27.5);
  assert.equal(refs.scene.getObjectByName('jungle_perimeter')!.scale.x, 1.375);
  resolve(sourceKit()); await handle.ready;
  const check = (radius: number) => {
    const expected = getJungleArchitecturePlacements(map, 'high', radius);
    refs.scene!.getObjectByName('jungle_blender_architecture')!.traverse(child => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const part = child.userData.architecturePart as typeof JUNGLE_ARCHITECTURE_PARTS[number];
      expected[part].forEach((placement, index) => { const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix); assertMatrix(matrix, placement.matrix); });
    });
  };
  assert.equal(refs.scene.getObjectByName('jungle_scenery')!.userData.arenaRadius, 28.875);
  check(28.875); syncJungleSceneryRadius(refs.scene, 30); check(31.5);
  syncJungleSceneryRadius(refs.scene, 20); check(21);
  assert.equal(refs.scene.getObjectByName('jungle_perimeter')!.scale.x, 1);
  disposeJungleResources(refs.scene);
});

test('Shipping Blender kits preserve centered collision envelopes and fit scene budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/jungle/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of JUNGLE_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < 0.01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, `${part} centered`);
      if (part === 'relic-spire' || part === 'ancient-trunk') {
        root.updateMatrixWorld(true);
        const inverse = root.matrixWorld.clone().invert();
        root.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const transform = inverse.clone().multiply(child.matrixWorld), position = child.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
            assert.ok(Math.hypot(vertex.x, vertex.z) <= (part === 'relic-spire' ? 0.6001 : 1.0001), `${part} cylinder collision envelope`);
          }
        });
      }
    }
    const instances = createJungleArchitectureInstances(source, map, detail, undefined, 31.5);
    let triangles = 0, draws = 0;
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
      if (child.userData.architecturePart === 'jungle-canopy') {
        assert.equal(child.castShadow, false, 'remote foliage does not add shadow work');
        const position = child.geometry.getAttribute('position'), matrix = new THREE.Matrix4();
        for (let instance = 0; instance < child.count; instance++) {
          child.getMatrixAt(instance, matrix);
          for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, vertexIndex).applyMatrix4(matrix);
            assert.ok(Math.hypot(vertex.x, vertex.z) > 31.5 + 3, 'all actual branches and leaves stay outside the largest floor');
          }
        }
      }
    }
    assert.ok(draws + 3 <= 25, `${detail}: ${draws + 3} draw budget`);
    assert.ok(triangles < (detail === 'high' ? 250_000 : 60_000), `${detail}: ${triangles} triangle budget`);
    reports.push({ detail, triangles, draws }); disposeJungleObjectResources([instances, source]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * 0.5, 'Low materially reduces geometry');
});

