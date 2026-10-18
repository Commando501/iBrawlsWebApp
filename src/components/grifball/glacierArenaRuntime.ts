import * as THREE from 'three';
import type { CustomMapObject } from '../../types';
import type { EnvironmentQualityProfile } from '../../settings/environmentQuality';
import { applyStadiumWorldUVs } from './stadiumMaterials';
import { createGlacierArchitectureMaterial } from './glacierMaterials';

const GLACIER_FALLBACK_ROLES: Readonly<Record<string, string>> = {
  post_nw: 'glacier_ceramic', post_sw: 'glacier_ceramic', post_ne: 'glacier_ceramic', post_se: 'glacier_ceramic',
  goal_w: 'glacier_red', goal_e: 'glacier_red',
  board_low_n: 'glacier_ceramic', board_low_s: 'glacier_ceramic', board_low_w: 'glacier_ceramic', board_low_e: 'glacier_ceramic',
  board_glass_n: 'glacier_glass', board_glass_s: 'glacier_glass', board_glass_w: 'glacier_glass', board_glass_e: 'glacier_glass',
};

/** Immediate props preserve the existing box/cylinder envelopes and transparent glass. */
export function createGlacierFallbackObject(object: CustomMapObject, quality: EnvironmentQualityProfile): THREE.Group | undefined {
  const role = GLACIER_FALLBACK_ROLES[object.id];
  if (!role || object.gameModeKind || object.floorTile || (object.type !== 'box' && object.type !== 'cylinder')) return;
  const { x, y, z } = object.scale;
  const geometry = object.type === 'cylinder'
    ? new THREE.CylinderGeometry(x / 2, x / 2, y, 16).scale(1, 1, z / x)
    : new THREE.BoxGeometry(x, y, z);
  applyStadiumWorldUVs(geometry, 3);
  const source = new THREE.MeshStandardMaterial(); source.name = role;
  const material = createGlacierArchitectureMaterial(source, quality); source.dispose();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = role !== 'glacier_glass'; mesh.receiveShadow = true; mesh.userData.id = object.id;
  const group = new THREE.Group(); group.name = object.id; group.add(mesh);
  return group;
}
