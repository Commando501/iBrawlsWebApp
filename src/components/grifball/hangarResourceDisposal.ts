import * as THREE from 'three';

const HANGAR_RESOURCE_ROOTS = new Set(['hangar_floor', 'hangar_fill', 'hangar_scenery']);

/** These are scene-owned clones; the immutable kit cache and armor are not traversed. */
export function disposeHangarObjectResources(roots: readonly THREE.Object3D[]): void {
  const visited = new Set<THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  for (const root of roots) {
    root.traverse(object => {
      if (visited.has(object)) return;
      visited.add(object);
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      if (mesh.material) {
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  }
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  roots.forEach(root => root.removeFromParent());
}

/** Lighting owns its PMREM separately from the arena meshes. */
export function disposeHangarResources(scene: THREE.Scene | null): void {
  if (!scene) return;
  const roots: THREE.Object3D[] = [];
  scene.traverse(object => { if (HANGAR_RESOURCE_ROOTS.has(object.name)) roots.push(object); });
  disposeHangarObjectResources(roots);
}
