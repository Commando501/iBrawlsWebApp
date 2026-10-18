import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeHangarResources } from './hangarResourceDisposal';

test('Hangar cleanup releases shared scene resources once and keeps armor and other arenas alive', () => {
  const scene = new THREE.Scene();
  const texture = new THREE.Texture();
  const material = new THREE.MeshStandardMaterial({ map: texture, normalMap: texture, roughnessMap: texture });
  const geometry = new THREE.BoxGeometry();
  const group = new THREE.Group(); group.name = 'hangar_scenery'; scene.add(group);
  const instances = new THREE.InstancedMesh(geometry, material, 12); group.add(instances);
  for (const name of ['hangar_floor', 'hangar_fill']) {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; scene.add(mesh);
  }
  const armor = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); scene.add(armor);
  const stadium = new THREE.Group(); stadium.name = 'stadium_scenery'; scene.add(stadium);
  const counts = new Map<object, number>();
  for (const resource of [texture, material, geometry, instances, armor.geometry, armor.material]) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }
  disposeHangarResources(scene); disposeHangarResources(scene); disposeHangarResources(null);
  for (const owned of [texture, material, geometry, instances]) assert.equal(counts.get(owned), 1);
  assert.equal(counts.has(armor.geometry), false); assert.equal(counts.has(armor.material), false);
  assert.deepEqual(scene.children, [armor, stadium]);
});
