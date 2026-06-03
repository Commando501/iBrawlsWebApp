import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getRectHalfExtents,
  RECT_HALF_X_RATIO,
  RECT_HALF_Z_RATIO,
} from './arenaDimensions';

test('falls back to the legacy aspect ratio when no override is given', () => {
  const half = getRectHalfExtents(20);
  assert.equal(half.x, 20 * RECT_HALF_X_RATIO);
  assert.equal(half.z, 20 * RECT_HALF_Z_RATIO);
});

test('explicit half-extents override the ratio (Grifball long lane)', () => {
  const half = getRectHalfExtents(20, { x: 52, z: 23 });
  assert.deepEqual(half, { x: 52, z: 23 });
});

test('ignores degenerate (non-positive) overrides and falls back', () => {
  assert.deepEqual(getRectHalfExtents(10, { x: 0, z: 5 }), {
    x: 10 * RECT_HALF_X_RATIO,
    z: 10 * RECT_HALF_Z_RATIO,
  });
  assert.deepEqual(getRectHalfExtents(10, null), {
    x: 10 * RECT_HALF_X_RATIO,
    z: 10 * RECT_HALF_Z_RATIO,
  });
});
