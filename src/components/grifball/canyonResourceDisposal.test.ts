import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeCanyonResources } from './canyonResourceDisposal';

test('Canyon cleanup disposes all owned PBR and instance resources once while leaving unrelated game assets alone', () => {
  const scene = new THREE.Scene();
  const group = new THREE.Group(); group.name = 'canyon_scenery'; scene.add(group);
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const geometry = new THREE.BoxGeometry();
  const instances = new THREE.InstancedMesh(geometry, material, 8); group.add(instances);
  for (const name of ['canyon_floor', 'canyon_fill', 'canyon_legacy_spire_nw']) {
    const child = new THREE.Mesh(geometry, material); child.name = name; scene.add(child);
  }
  const armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(armor);
  const counts = new Map<object, number>();
  for (const resource of [texture, material, geometry, instances, armor.material, armor.geometry]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }
  disposeCanyonResources(scene); disposeCanyonResources(scene); disposeCanyonResources(null);
  for (const owned of [texture, material, geometry, instances]) assert.equal(counts.get(owned), 1);
  assert.equal(counts.has(armor.material), false); assert.equal(counts.has(armor.geometry), false);
  assert.deepEqual(scene.children, [armor]);
});
