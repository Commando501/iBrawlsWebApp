import * as THREE from 'three';

const STADIUM_RESOURCE_ROOTS = new Set([
  'stadium_floor',
  'stadium_field_markings',
  'stadium_scenery',
]);

/** Release scene-owned stadium resources without touching shared armor or sky caches. */
export function disposeStadiumResources(scene: THREE.Scene | null): void {
  if (!scene) return;

  const roots: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (STADIUM_RESOURCE_ROOTS.has(object.name)) roots.push(object);
  });

  const objects = new Set<THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  for (const root of roots) {
    root.traverse((object) => {
      if (objects.has(object)) return;
      objects.add(object);
      const renderable = object as THREE.Mesh;
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (renderable.material) {
        const assigned = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
        for (const material of assigned) materials.add(material);
      }
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
  }

  for (const material of materials) {
    // Include all texture slots (normal, roughness, AO, emissive, etc.), not just map.
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
  }
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const root of roots) root.removeFromParent();
}
