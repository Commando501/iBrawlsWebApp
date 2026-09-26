import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { V3_SKULL_BOMB } from './v3SkullBomb.generated';

export interface V3SkullBombAsset {
  meshes: { name: string; role: string; positions: number[]; normals: number[] }[];
  palette: Record<string, string>;
  grip: [number, number, number];
  radius: number;
}

export function buildV3SkullBombModel(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'v3SkullBomb';
  for (const [role, color] of Object.entries(V3_SKULL_BOMB.palette)) {
    const pieces = V3_SKULL_BOMB.meshes.filter(m => m.role === role).map(source => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(source.positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(source.normals, 3));
      return geometry;
    });
    const geometry = mergeGeometries(pieces)!;
    pieces.forEach(p => p.dispose());
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color,
      metalness: role === 'shell' || role === 'metal' ? .65 : .2, roughness: .42,
      emissive: role === 'ember' ? color : '#000000', emissiveIntensity: role === 'ember' ? 2 : 0,
    }));
    mesh.name = `skullBomb:${role}`;
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.v3GeometrySource = 'blender-skull-bomb';
  return group;
}
