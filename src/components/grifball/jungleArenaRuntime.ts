import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createJungleArchitectureMaterial } from './jungleMaterials';

const JUNGLE_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  obj_nature_totem: 'jungle_ceramic',
  obj_rock_nw: 'jungle_stone', obj_rock_se: 'jungle_stone',
  obj_trunk_ne: 'jungle_bark', obj_trunk_sw: 'jungle_bark',
  obj_ruined_wall_n: 'jungle_stone', obj_ruined_wall_s: 'jungle_stone',
};

/** Immediate, collider-sized cover while the decorative Blender kit loads. */
export function createJungleFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = JUNGLE_FALLBACK_ROLES[object.id];
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
  const material = createJungleArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
