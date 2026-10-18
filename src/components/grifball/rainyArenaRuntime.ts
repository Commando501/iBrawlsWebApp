import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createRainyArchitectureMaterial } from './rainyMaterials';

const RAINY_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  rainy_barrier_w: 'rainy_ceramic', rainy_barrier_e: 'rainy_ceramic',
  rainy_crate_nw: 'rainy_alloy', rainy_crate_se: 'rainy_alloy',
};

/** Immediate cover fits the existing box colliders while the decorative kit loads. */
export function createRainyFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = RAINY_FALLBACK_ROLES[object.id];
  if (!role || object.gameModeKind || object.floorTile || object.type !== 'box') return;
  const { x, y, z } = object.scale;
  const geometry = new THREE.BoxGeometry(x, y, z);
  applyStadiumWorldUVs(geometry, 3);
  const source = new THREE.MeshStandardMaterial(); source.name = role;
  const material = createRainyArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
