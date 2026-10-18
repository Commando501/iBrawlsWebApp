import * as THREE from 'three';

const GLACIER_RESOURCE_ROOTS = new Set(['glacier_floor', 'glacier_fill', 'glacier_scenery', 'glacier_directional_key', 'glacier_weather']);
const cleanupByRoot = new WeakMap<THREE.Object3D, () => void>();

/** Cleanup must also settle an in-flight mount before its resources disappear. */
export function registerGlacierResourceCleanup(root: THREE.Object3D, cleanup: () => void): void {
  cleanupByRoot.set(root, cleanup);
}

/** Only scene-owned handles belong here; the immutable source kit stays outside the scene. */
export function disposeGlacierObjectResources(roots: readonly THREE.Object3D[]): void {
  const visited = new Set<THREE.Object3D>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const shadows = new Set<THREE.LightShadow>();
  for (const root of roots) {
    root.traverse(object => {
      if (visited.has(object)) return;
      visited.add(object);
      const cleanup = cleanupByRoot.get(object);
      if (cleanup) { cleanupByRoot.delete(object); cleanup(); }
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

/** Environment probe and sky ownership are handled by the lighting cleanup. */
export function disposeGlacierResources(scene: THREE.Scene | null): void {
  if (!scene) return;
  const roots: THREE.Object3D[] = [];
  scene.traverse(object => {
    if (GLACIER_RESOURCE_ROOTS.has(object.name) || typeof object.userData.glacierLegacyId === 'string') roots.push(object);
  });
  disposeGlacierObjectResources(roots);
}
