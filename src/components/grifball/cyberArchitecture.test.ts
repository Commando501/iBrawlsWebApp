import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PREMADE_MAPS } from '../../game/premadeMaps';
import type { CustomMapData } from '../../types';
import { getEnvironmentQualityProfile } from '../../settings/environmentQuality';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { disposeCyberObjectResources, disposeCyberResources } from './cyberResourceDisposal';
import {
  CYBER_ARCHITECTURE_PARTS, CYBER_REPLACED_OBJECT_IDS, buildCyberSceneryForRefs,
  createCyberArchitectureInstances, createCyberArchitectureSourceCache, createCyberPerimeter,
  getCyberArchitecturePlacements, syncCyberSceneryRadius,
} from './cyberArchitecture';

const map = PREMADE_MAPS.find(candidate => candidate.id === 'cyber_hex_arena')!;
const sizes = [[1.8, 6, 1.8], [4, 2.5, 0.8], [1.6, 1.6, 1.6], [3.5, 3.5, 3.5], [4, 14, 3]];
const sourceKit = () => {
  const source = new THREE.Group(), texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughnessMap: texture }); material.name = 'cyber_alloy';
  for (const name of CYBER_ARCHITECTURE_PARTS) {
    const part = new THREE.Group(); part.name = name;
    part.add(new THREE.Mesh(new THREE.BoxGeometry(), material)); source.add(part);
  }
  return source;
};
const cloneMaterial = (material: THREE.Material) => material.clone();
const assertMatrix = (actual: THREE.Matrix4, expected: THREE.Matrix4) => {
  assert.ok(actual.elements.every((value, index) => Math.abs(value - expected.elements[index]) < 3e-6));
};

test('Cyber source cache coalesces each quality request and retries failures', async () => {
  let calls = 0, fail = true;
  const source = sourceKit();
  const load = createCyberArchitectureSourceCache(async () => { calls++; if (fail) throw new Error('offline'); return source; });
  const pending = load('high'); assert.equal(pending, load('high'));
  await assert.rejects(pending, /offline/); fail = false;
  assert.equal(await load('high'), source); assert.equal(await load('high'), source);
  assert.equal(await load('low'), source); assert.equal(calls, 3);
});

test('Replacement matrices retain every authored object position, rotation and dimension without mutating map data', () => {
  const before = JSON.stringify(map);
  const converted: CustomMapData = { ...map, mapShape: 'rectangular', arenaHalfExtents: { x: 52, z: 23 },
    objects: map.objects.slice(2).map(object => ({ ...object,
      position: { x: object.position.x * 1.7, y: object.position.y, z: object.position.z * 1.3 },
      rotation: { x: 0.12, y: 0.8, z: 0.06 },
      scale: { x: object.scale.x * 1.7, y: object.scale.y, z: object.scale.z * 1.3 },
    })) };
  for (const active of [map, converted]) {
    const placements = getCyberArchitecturePlacements(active, 'high');
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
      const index = CYBER_ARCHITECTURE_PARTS.indexOf(part as typeof CYBER_ARCHITECTURE_PARTS[number]);
      assert.ok(new THREE.Vector3().fromArray(sizes[index]).multiply(scale)
        .distanceTo(new THREE.Vector3(object.scale.x, object.scale.y, object.scale.z)) < 1e-7);
    }
  }
  assert.equal(JSON.stringify(map), before);
  assert.equal(map.arenaRadius, 20); assert.equal(map.objects.length, 9);
});

test('Remote relay fins remain outside combat and three-draw subdeck stays below the original floor', () => {
  for (const active of [map, { ...map, arenaRadius: 27.5 }, { ...map, mapShape: 'rectangular' as const, arenaHalfExtents: { x: 52, z: 23 } }]) {
    const half = active.mapShape === 'rectangular' ? active.arenaHalfExtents! : { x: active.arenaRadius, z: active.arenaRadius };
    const playBounds = new THREE.Box3(new THREE.Vector3(-half.x, -100, -half.z), new THREE.Vector3(half.x, 100, half.z));
    for (const detail of ['high', 'low'] as const) {
      const fins = getCyberArchitecturePlacements(active, detail)['relay-fin'];
      assert.equal(fins.length, detail === 'high' ? 8 : 6);
      for (const fin of fins) {
        const bounds = new THREE.Box3(new THREE.Vector3(-2, -7, -1.5), new THREE.Vector3(2, 7, 1.5)).applyMatrix4(fin.matrix);
        assert.equal(bounds.intersectsBox(playBounds), false);
      }
    }
    const perimeter = createCyberPerimeter(active, cloneMaterial);
    assert.equal(perimeter.children.length, 3);
    assert.ok(new THREE.Box3().setFromObject(perimeter).max.y < -0.1);
    perimeter.traverse(object => { if (object instanceof THREE.Mesh) assert.equal(object.castShadow, false); });
    disposeCyberObjectResources([perimeter]);
  }
});

test('Instances own geometry, material and texture handles even with shallow-cloning or passthrough factories', () => {
  for (const factory of [undefined, cloneMaterial, (material: THREE.Material) => material]) {
    const source = sourceKit();
    const first = createCyberArchitectureInstances(source, map, 'high', factory);
    const second = createCyberArchitectureInstances(source, map, 'high', factory);
    const cached = source.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const a = first.children[0] as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const b = second.children[0] as typeof a;
    assert.equal(first.children.length, 5); assert.equal(a.count, 4);
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
    disposeCyberObjectResources([first]); assert.equal(sharedDisposed, 0);
    disposeCyberObjectResources([second, source]);
  }
});

test('Successful kit attachment hides only tagged originals and cancel restores their exact original visibility', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const legacy = CYBER_REPLACED_OBJECT_IDS.map((id, index) => {
    const mesh = new THREE.Mesh(); mesh.name = id; mesh.userData.cyberLegacyId = id;
    mesh.visible = index !== 0; refs.scene!.add(mesh); refs.customMapObjects!.push(mesh); return mesh;
  });
  const actor = new THREE.Mesh(); actor.name = 'iron_vanguard'; refs.scene.add(actor);
  const handle = buildCyberSceneryForRefs({ refs, activeCustomMap: map, load: async () => sourceKit(), materialFactory: cloneMaterial })!;
  await handle.ready;
  assert.ok(legacy.every(mesh => !mesh.visible)); assert.equal(actor.visible, true);
  assert.ok(refs.scene.getObjectByName('cyber_blender_architecture'));
  handle.cancel(); handle.cancel();
  assert.ok(legacy.every((mesh, index) => mesh.visible === (index !== 0)));
  assert.equal(refs.scene.getObjectByName('cyber_blender_architecture'), undefined);
  assert.ok(refs.scene.getObjectByName('cyber_subdeck'));
  for (const mesh of legacy) {
    assert.equal(refs.scene.getObjectByName(mesh.name), mesh); assert.ok(refs.customMapObjects!.includes(mesh));
  }
  disposeCyberResources(refs.scene); assert.equal(refs.scene.children[0], actor);
});

test('Failed, malformed, canceled, detached and disposed pending loads retain originals and never attach late', async () => {
  for (const outcome of ['failed', 'invalid', 'canceled', 'detached', 'disposed'] as const) {
    const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
    const legacy = new THREE.Mesh(); legacy.userData.cyberLegacyId = 'obj_central_core'; refs.scene.add(legacy);
    let resolve!: (source: THREE.Group) => void, reject!: (reason: Error) => void;
    const pending = new Promise<THREE.Group>((yes, no) => { resolve = yes; reject = no; });
    let errors = 0;
    const handle = buildCyberSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('low'),
      load: detail => { assert.equal(detail, 'low'); return pending; }, materialFactory: cloneMaterial, onError: () => errors++ })!;
    const group = refs.scene.getObjectByName('cyber_scenery')!;
    assert.ok(group.getObjectByName('cyber_subdeck')); assert.equal(legacy.visible, true);
    if (outcome === 'canceled') { handle.cancel(); await handle.ready; }
    if (outcome === 'detached') group.removeFromParent();
    if (outcome === 'disposed') { disposeCyberResources(refs.scene); await handle.ready; }
    if (outcome === 'failed') reject(new Error('offline')); else resolve(outcome === 'invalid' ? new THREE.Group() : sourceKit());
    await handle.ready; await new Promise<void>(done => setImmediate(done));
    assert.equal(group.getObjectByName('cyber_blender_architecture'), undefined);
    assert.equal(legacy.visible, true); assert.equal(errors, outcome === 'failed' || outcome === 'invalid' ? 1 : 0);
    if (outcome !== 'disposed') disposeCyberObjectResources([group]);
  }
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  assert.equal(buildCyberSceneryForRefs({ refs, activeCustomMap: { ...map, id: 'user_cyber_map' } }), undefined);
  assert.equal(refs.scene.children.length, 0, 'theme matching must not alter user maps');
});

test('Existing player-count radius changes affect only subdeck and remote fins, including pending attachment', async () => {
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  let resolve!: (source: THREE.Group) => void;
  const pending = new Promise<THREE.Group>(yes => { resolve = yes; });
  const handle = buildCyberSceneryForRefs({ refs, activeCustomMap: map, quality: getEnvironmentQualityProfile('high'), load: () => pending, materialFactory: cloneMaterial })!;
  syncCyberSceneryRadius(refs.scene, 27.5);
  assert.equal(refs.scene.getObjectByName('cyber_subdeck')!.scale.x, 1.375);
  resolve(sourceKit()); await handle.ready;
  const check = (radius: number) => {
    const expected = getCyberArchitecturePlacements(map, 'high', radius);
    refs.scene!.getObjectByName('cyber_blender_architecture')!.traverse(child => {
      if (!(child instanceof THREE.InstancedMesh)) return;
      const part = child.userData.architecturePart as typeof CYBER_ARCHITECTURE_PARTS[number];
      expected[part].forEach((placement, index) => { const matrix = new THREE.Matrix4(); child.getMatrixAt(index, matrix); assertMatrix(matrix, placement.matrix); });
    });
  };
  check(27.5); syncCyberSceneryRadius(refs.scene, 20); check(20);
  assert.equal(refs.scene.getObjectByName('cyber_subdeck')!.scale.x, 1);
  disposeCyberResources(refs.scene);
});

test('Shipping Blender kits preserve centered collision envelopes and fit scene budgets', async () => {
  const reports: { detail: string; triangles: number; draws: number }[] = [];
  for (const detail of ['high', 'low'] as const) {
    const filename = detail === 'high' ? 'kit-v1.glb' : 'kit-low-v1.glb';
    const bytes = await readFile(new URL(`../../../public/assets/cyber/architecture/${filename}`, import.meta.url));
    const source = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene;
    for (const [index, part] of CYBER_ARCHITECTURE_PARTS.entries()) {
      const root = source.getObjectByName(part)!; assert.ok(root, part);
      const box = new THREE.Box3().setFromObject(root);
      assert.ok(box.getSize(new THREE.Vector3()).distanceTo(new THREE.Vector3().fromArray(sizes[index])) < 0.01, part);
      assert.ok(box.getCenter(new THREE.Vector3()).length() < 0.01, `${part} centered`);
      if (part === 'tech-column' || part === 'reactor-core') {
        root.updateMatrixWorld(true);
        const inverse = root.matrixWorld.clone().invert();
        root.traverse(child => {
          if (!(child instanceof THREE.Mesh)) return;
          const transform = inverse.clone().multiply(child.matrixWorld), position = child.geometry.getAttribute('position');
          for (let i = 0; i < position.count; i++) {
            const vertex = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(transform);
            assert.ok((part === 'tech-column' ? Math.hypot(vertex.x, vertex.z) : vertex.length()) <= (part === 'tech-column' ? 0.9001 : 1.7501), `${part} collision envelope`);
          }
        });
      }
    }
    const instances = createCyberArchitectureInstances(source, map, detail);
    let triangles = 0, draws = 0;
    for (const child of instances.children) {
      assert.ok(child instanceof THREE.InstancedMesh);
      triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3 * child.count;
      draws += Array.isArray(child.material) ? child.geometry.groups.length : 1;
    }
    assert.ok(draws + 3 <= 25, `${detail}: ${draws + 3} draw budget`);
    assert.ok(triangles < 150_000, `${detail}: ${triangles} triangle budget`);
    reports.push({ detail, triangles, draws }); disposeCyberObjectResources([instances, source]);
  }
  assert.ok(reports[1].triangles < reports[0].triangles * 0.5, 'Low materially reduces geometry');
});
