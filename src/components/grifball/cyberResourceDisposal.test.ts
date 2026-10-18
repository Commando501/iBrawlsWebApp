import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeCyberResources, registerCyberResourceCleanup } from './cyberResourceDisposal';

test('Cyber cleanup releases owned resources and lifecycle once while leaving armor and other arenas intact', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const geometry = new THREE.BoxGeometry();
  const group = new THREE.Group(); group.name = 'cyber_scenery'; scene.add(group);
  const instances = new THREE.InstancedMesh(geometry, material, 8); group.add(instances);
  for (const name of ['cyber_floor', 'cyber_fill']) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh);
  }
  const legacy = new THREE.Mesh(geometry, material); legacy.userData.cyberLegacyId = 'obj_central_core'; scene.add(legacy);
  const armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(armor);
  const canyon = new THREE.Group(); canyon.name = 'canyon_scenery'; scene.add(canyon);
  let cleanups = 0; registerCyberResourceCleanup(group, () => { cleanups++; });
  const counts = new Map<object, number>();
  for (const resource of [texture, material, geometry, instances, armor.geometry, armor.material]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }
  disposeCyberResources(scene); disposeCyberResources(scene); disposeCyberResources(null);
  for (const owned of [texture, material, geometry, instances]) assert.equal(counts.get(owned), 1);
  assert.equal(cleanups, 1);
  assert.equal(counts.has(armor.geometry), false); assert.equal(counts.has(armor.material), false);
  assert.deepEqual(scene.children, [armor, canyon]);
});
