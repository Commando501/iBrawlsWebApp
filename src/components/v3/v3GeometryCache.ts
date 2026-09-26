import * as THREE from 'three';

const materialCache = new Map<string, THREE.MeshStandardMaterial>();
const geometryCache = new Map<string, V3CachedGeometryEntry[]>();
const surfaceGeometryCache = new Map<string, THREE.BufferGeometry>();
let geometryHits = 0;
let geometryMisses = 0;

export interface V3CachedGeometryEntry {
  materialKey: string;
  color: string;
  emissive: boolean;
  geometry: THREE.BufferGeometry;
}

export interface V3GeometryCacheStats {
  materials: number;
  planCount: number;
  geometryCount: number;
  geometryEntries: number;
  approximateBytes: number;
  hits: number;
  misses: number;
}

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

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  if (geometry.index) {
    bytes += geometry.index.array.byteLength;
  }
  return bytes;
}

export function getOrCreateV3CachedGeometryEntries(
  cacheKey: string,
  createEntries: () => V3CachedGeometryEntry[]
): readonly V3CachedGeometryEntry[] {
  const existing = geometryCache.get(cacheKey);
  if (existing) {
    geometryHits++;
    return existing;
  }

  geometryMisses++;
  const entries = createEntries();
  geometryCache.set(cacheKey, entries);
  return entries;
}

/** Geometry is independent of armor hue; materials remain per palette. */
export function getOrCreateV3SurfaceGeometry(key: string, build: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const cached = surfaceGeometryCache.get(key);
  if (cached) return cached;
  const geometry = build();
  surfaceGeometryCache.set(key, geometry);
  return geometry;
}

export function getV3GeometryCacheStats(): V3GeometryCacheStats {
  let geometryEntries = 0;
  let approximateBytes = 0;
  const unique = new Set<THREE.BufferGeometry>();
  for (const entries of geometryCache.values()) {
    geometryEntries += entries.length;
    for (const entry of entries) {
      if (!unique.has(entry.geometry)) approximateBytes += estimateGeometryBytes(entry.geometry);
      unique.add(entry.geometry);
    }
  }

  return {
    materials: materialCache.size,
    planCount: geometryCache.size,
    geometryCount: unique.size,
    geometryEntries,
    approximateBytes,
    hits: geometryHits,
    misses: geometryMisses,
  };
}

export function clearV3GeometryCache(): void {
  const disposed = new Set<THREE.BufferGeometry>();
  for (const entries of geometryCache.values()) {
    for (const entry of entries) {
      if (!disposed.has(entry.geometry)) entry.geometry.dispose();
      disposed.add(entry.geometry);
    }
  }
  geometryCache.clear();
  for (const geometry of surfaceGeometryCache.values()) if (!disposed.has(geometry)) geometry.dispose();
  surfaceGeometryCache.clear();
  geometryHits = 0;
  geometryMisses = 0;

  for (const material of materialCache.values()) {
    material.dispose();
  }
  materialCache.clear();
}
