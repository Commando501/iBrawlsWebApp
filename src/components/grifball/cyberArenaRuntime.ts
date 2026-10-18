import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createCyberArchitectureMaterial } from './cyberMaterials';

const CYBER_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  obj_central_core: 'cyber_core',
  obj_pillar_nw: 'cyber_ceramic', obj_pillar_ne: 'cyber_ceramic',
  obj_pillar_se: 'cyber_ceramic', obj_pillar_sw: 'cyber_ceramic',
  obj_barrier_north: 'cyber_alloy', obj_barrier_south: 'cyber_alloy',
  obj_crate_w: 'cyber_graphite', obj_crate_e: 'cyber_graphite',
};

/** Immediate visual fallback; authored map data remains the collision authority. */
export function createCyberFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = CYBER_FALLBACK_ROLES[object.id];
  if (!role || object.gameModeKind || object.floorTile) return;
  const { x, y, z } = object.scale;
  let geometry: THREE.BufferGeometry;
  if (object.type === 'sphere') {
    geometry = new THREE.SphereGeometry(.5, 24, 16); geometry.scale(x, y, z);
  } else if (object.type === 'cylinder') {
    geometry = new THREE.CylinderGeometry(.5, .5, y, 24); geometry.scale(x, 1, z);
  } else if (object.type === 'box') {
    geometry = new THREE.BoxGeometry(x, y, z);
  } else return;
  applyStadiumWorldUVs(geometry, 3);
  const source = new THREE.MeshStandardMaterial(); source.name = role;
  const material = createCyberArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
