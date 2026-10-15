import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { disposeStadiumResources } from './stadiumResourceDisposal';

test('stadium cleanup releases shared PBR maps and instance buffers once without touching other scene assets', () => {
  const scene = new THREE.Scene();
  const stadium = new THREE.Group();
  stadium.name = 'stadium_scenery';
  scene.add(stadium);

  const maps = Array.from({ length: 5 }, () => new THREE.Texture());
  const material = new THREE.MeshStandardMaterial({
    map: maps[0], normalMap: maps[1], roughnessMap: maps[2], metalnessMap: maps[3], aoMap: maps[4],
    emissiveMap: maps[0],
  });
  const geometry = new THREE.BoxGeometry();
  const instances = new THREE.InstancedMesh(geometry, material, 4);
  stadium.add(instances, new THREE.Mesh(geometry, [material, material]));
  const floor = new THREE.Mesh(geometry, material);
  floor.name = 'stadium_floor';
  scene.add(floor);

  const unrelatedGeometry = new THREE.BoxGeometry();
  const unrelatedMap = new THREE.Texture();
  const unrelatedMaterial = new THREE.MeshStandardMaterial({ normalMap: unrelatedMap });
  const armor = new THREE.Mesh(unrelatedGeometry, unrelatedMaterial);
  scene.add(armor);
  const counts = new Map<object, number>();
  const resources = [...maps, material, geometry, instances, unrelatedGeometry, unrelatedMap, unrelatedMaterial];
  for (const resource of resources) {
    const dispatcher: THREE.EventDispatcher<{ dispose: object }> = resource;
    dispatcher.addEventListener('dispose', () => counts.set(resource, (counts.get(resource) ?? 0) + 1));
  }

  disposeStadiumResources(scene);
  disposeStadiumResources(scene);

  for (const resource of [...maps, material, geometry, instances]) assert.equal(counts.get(resource), 1);
  for (const resource of [unrelatedGeometry, unrelatedMap, unrelatedMaterial]) assert.equal(counts.has(resource), false);
  assert.deepEqual(scene.children, [armor]);
});

test('nested stadium ownership roots dispose only once and field markings are included', () => {
  const scene = new THREE.Scene();
  const stadium = new THREE.Group();
  stadium.name = 'stadium_scenery';
  const markings = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
  markings.name = 'stadium_field_markings';
  stadium.add(markings);
  scene.add(stadium);
  let disposals = 0;
  markings.geometry.addEventListener('dispose', () => disposals++);

  disposeStadiumResources(scene);
  disposeStadiumResources(null);

  assert.equal(disposals, 1);
  assert.equal(scene.children.length, 0);
});
