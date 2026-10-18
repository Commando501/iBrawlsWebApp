import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createNeonArchitectureMaterial } from './neonMaterials';

const NEON_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  neon_pillar_nw: 'neon_ceramic', neon_pillar_sw: 'neon_ceramic',
  neon_pillar_ne: 'neon_ceramic', neon_pillar_se: 'neon_ceramic',
  neon_pillar_cn: 'neon_alloy', neon_pillar_cs: 'neon_alloy',
  grid_barrier_w: 'neon_graphite', grid_barrier_e: 'neon_graphite',
};

/** Immediate cover fits the existing colliders while the decorative kit loads. */
export function createNeonFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = NEON_FALLBACK_ROLES[object.id];
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
  const material = createNeonArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
