import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { V3PaintRole } from './v3ModelTypes';
import { V3_BLENDER_WEAPONS } from './v3BlenderWeapons.generated';

export type V3BlenderWeaponSet = Record<'hammer' | 'sword', {
  meshes: { name: string; role: V3PaintRole; positions: number[]; normals: number[] }[];
  primaryGrip: [number, number, number];
  offhandGrip: [number, number, number];
  targetBodyHeightRatio: number;
}>;

/** Blender geometry grouped by paint role; keeps the game's synchronous builder. */
export function buildV3BlenderWeapon(weapon: 'hammer' | 'sword', colorForRole: (role: V3PaintRole) => string): THREE.Group {
  const root = new THREE.Group();
  const roles = new Map<V3PaintRole, THREE.BufferGeometry[]>();
  for (const source of V3_BLENDER_WEAPONS[weapon].meshes) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
    const geometries = roles.get(source.role) ?? [];
    geometries.push(geometry); roles.set(source.role, geometries);
  }
  for (const [role, geometries] of roles) {
    const geometry = mergeGeometries(geometries)!;
    geometries.forEach(g => g.dispose());
    const energy = role === 'emissive', color = colorForRole(role);
    const material = new THREE.MeshStandardMaterial({ color,
      roughness: role === 'undersuit' ? .78 : .34, metalness: energy ? .05 : .65,
      emissive: energy ? color : '#000000', emissiveIntensity: energy ? 1.25 : 0 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `v3:${weapon}:${role}`;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  root.userData.v3WeaponGeometrySource = 'blender-v2';
  root.userData.v3WeaponDesign = V3_BLENDER_WEAPONS[weapon].targetBodyHeightRatio;
  return root;
}
