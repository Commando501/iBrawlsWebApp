import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  clearV3GeometryCache,
  getV3CachedMaterial,
  getV3GeometryCacheStats,
} from './v3GeometryCache';

describe('v3GeometryCache', () => {
  it('reuses materials for identical color and emissive keys', () => {
    clearV3GeometryCache();
    const a = getV3CachedMaterial('#ff0000', false);
    const b = getV3CachedMaterial('#ff0000', false);
    const c = getV3CachedMaterial('#ff0000', true);

    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.deepEqual(getV3GeometryCacheStats(), { materials: 2 });
  });

  it('clears and disposes cached materials', () => {
    clearV3GeometryCache();
    const material = getV3CachedMaterial('#00ff00', false);
    let disposed = false;
    material.addEventListener('dispose', () => {
      disposed = true;
    });

    clearV3GeometryCache();

    assert.equal(disposed, true);
    assert.deepEqual(getV3GeometryCacheStats(), { materials: 0 });
  });
});
