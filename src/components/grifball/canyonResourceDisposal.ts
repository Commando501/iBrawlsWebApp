import * as THREE from 'three';

const CANYON_RESOURCE_ROOTS = new Set(['canyon_floor', 'canyon_fill', 'canyon_scenery', 'canyon_directional_key']);

/** The kit cache and character assets never enter this scene-owned traversal. */
export function disposeCanyonObjectResources(roots: readonly THREE.Object3D[]): void {
  const visited = new Set<THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const shadows = new Set<THREE.LightShadow>();
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
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.SpotLight || object instanceof THREE.PointLight) shadows.add(object.shadow);
    });
  }
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  }
  textures.forEach(texture => texture.dispose());
  materials.forEach(material => material.dispose());
  geometries.forEach(geometry => geometry.dispose());
  shadows.forEach(shadow => shadow.dispose());
  roots.forEach(root => root.removeFromParent());
}

/** Environment-probe ownership is handled by the mount's lighting cleanup. */
export function disposeCanyonResources(scene: THREE.Scene | null): void {
  if (!scene) return;
  const roots: THREE.Object3D[] = [];
  scene.traverse(object => {
    if (CANYON_RESOURCE_ROOTS.has(object.name) || object.name.startsWith('canyon_legacy_')
      || typeof object.userData.canyonLegacyId === 'string') roots.push(object);
  });
  disposeCanyonObjectResources(roots);
}
