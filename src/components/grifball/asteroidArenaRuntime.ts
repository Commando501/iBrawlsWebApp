import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createAsteroidArchitectureMaterial } from './asteroidMaterials';

const ASTEROID_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  obj_extractor: 'asteroid_alloy',
  obj_asteroid_1: 'asteroid_rock', obj_asteroid_2: 'asteroid_rock',
  obj_container_l: 'asteroid_graphite', obj_container_r: 'asteroid_graphite',
  obj_partition_n: 'asteroid_ceramic', obj_partition_s: 'asteroid_ceramic',
};

/** Immediate, collider-sized cover while the decorative Blender kit loads. */
export function createAsteroidFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = ASTEROID_FALLBACK_ROLES[object.id];
  if (!role || object.gameModeKind || object.floorTile) return;
  const { x, y, z } = object.scale;
  let geometry: THREE.BufferGeometry;
  if (object.type === 'cylinder') {
    geometry = new THREE.CylinderGeometry(.5, .5, y, 24); geometry.scale(x, 1, z);
  } else if (object.type === 'box') {
    geometry = new THREE.BoxGeometry(x, y, z);
  } else return;
  applyStadiumWorldUVs(geometry, 3);
  const source = new THREE.MeshStandardMaterial(); source.name = role;
  const material = createAsteroidArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
