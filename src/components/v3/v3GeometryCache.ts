import * as THREE from 'three';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function getV3CachedMaterial(color: string, emissive = false): THREE.MeshStandardMaterial {
  const key = `${color}:${emissive ? '1' : '0'}`;
  const existing = materialCache.get(key);
  if (existing) {
    return existing;
  }

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.58,
    metalness: 0.28,
    emissive: emissive ? new THREE.Color(color) : new THREE.Color('#000000'),
    emissiveIntensity: emissive ? 0.55 : 0,
  });
  materialCache.set(key, material);
  return material;
}

export function getV3GeometryCacheStats(): { materials: number } {
  return { materials: materialCache.size };
}

export function clearV3GeometryCache(): void {
  for (const material of materialCache.values()) {
    material.dispose();
  }
  materialCache.clear();
}
