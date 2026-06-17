import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_REFERENCE_SUPPORTED_EXTENSIONS,
  assertNoV3ReferencePayloadPersisted,
  buildV3ReferenceMetadata,
  compareV3ReferenceSilhouettes,
  getV3ReferenceFileKind,
} from './v3ReferenceComparison';

describe('getV3ReferenceFileKind', () => {
  it('recognizes supported reference extensions case-insensitively', () => {
    assert.deepEqual(V3_REFERENCE_SUPPORTED_EXTENSIONS, ['.fbx', '.glb', '.gltf', '.obj']);
    assert.equal(getV3ReferenceFileKind('reach-spartan.FBX'), 'fbx');
    assert.equal(getV3ReferenceFileKind('base-model.glb'), 'glb');
    assert.equal(getV3ReferenceFileKind('rig-preview.gltf'), 'gltf');
    assert.equal(getV3ReferenceFileKind('armor.obj'), 'obj');
  });

  it('rejects unsupported or missing extensions', () => {
    assert.equal(getV3ReferenceFileKind('armor.blend'), 'unsupported');
    assert.equal(getV3ReferenceFileKind('armor'), 'unsupported');
    assert.equal(getV3ReferenceFileKind(''), 'unsupported');
  });
});

describe('buildV3ReferenceMetadata', () => {
  it('builds deterministic export-safe metadata for supported files', () => {
    const metadata = buildV3ReferenceMetadata({
      fileName: 'HaloReachSpartan.GLB',
      byteLength: 42_000,
      objectCount: 14,
      meshCount: 8,
      triangleCount: 21_500,
      bounds: {
        min: [-0.5, 0, -0.25],
        max: [0.5, 1.8, 0.25],
      },
    });

    assert.deepEqual(metadata, {
      fileName: 'HaloReachSpartan.GLB',
      kind: 'glb',
      extension: '.glb',
      byteLength: 42_000,
      objectCount: 14,
      meshCount: 8,
      triangleCount: 21_500,
      bounds: {
        min: [-0.5, 0, -0.25],
        max: [0.5, 1.8, 0.25],
      },
    });
  });

  it('rejects unsupported reference files before metadata is persisted', () => {
    assert.throws(
      () => buildV3ReferenceMetadata({ fileName: 'spartan.blend', byteLength: 100 }),
      /Unsupported V3 reference file extension: spartan\.blend/
    );
  });
});

describe('compareV3ReferenceSilhouettes', () => {
  it('returns normalized deltas and mismatch notes for front and side silhouettes', () => {
    const comparison = compareV3ReferenceSilhouettes(
      {
        front: { widthRatio: 0.72, heightRatio: 0.81, areaRatio: 0.37 },
        side: { widthRatio: 0.32, heightRatio: 0.84, areaRatio: 0.18 },
      },
      {
        front: { widthRatio: 0.6, heightRatio: 0.9, areaRatio: 0.3 },
        side: { widthRatio: 0.4, heightRatio: 0.8, areaRatio: 0.2 },
      }
    );

    assert.deepEqual(comparison.deltas, {
      front: { widthRatio: 0.2, heightRatio: -0.1, areaRatio: 0.233333 },
      side: { widthRatio: -0.2, heightRatio: 0.05, areaRatio: -0.1 },
    });
    assert.deepEqual(comparison.mismatchNotes, [
      'front width is 20.0% wider than reference',
      'front height is 10.0% shorter than reference',
      'front area is 23.3% larger than reference',
      'side width is 20.0% narrower than reference',
      'side area is 10.0% smaller than reference',
    ]);
  });

  it('returns no mismatch notes when silhouettes stay within tolerance', () => {
    const comparison = compareV3ReferenceSilhouettes(
      {
        front: { widthRatio: 0.62, heightRatio: 0.88, areaRatio: 0.31 },
        side: { widthRatio: 0.39, heightRatio: 0.82, areaRatio: 0.19 },
      },
      {
        front: { widthRatio: 0.6, heightRatio: 0.9, areaRatio: 0.3 },
        side: { widthRatio: 0.4, heightRatio: 0.8, areaRatio: 0.2 },
      }
    );

    assert.deepEqual(comparison.mismatchNotes, []);
  });
});

describe('assertNoV3ReferencePayloadPersisted', () => {
  it('strips raw file and parsed-object payloads while preserving export-safe metadata', () => {
    const sanitized = assertNoV3ReferencePayloadPersisted({
      metadata: buildV3ReferenceMetadata({ fileName: 'armor.obj', byteLength: 128 }),
      rawText: 'private obj contents',
      arrayBuffer: new ArrayBuffer(8),
      parsedObject: { privateSceneGraph: true },
      objectCount: 3,
      nested: {
        meshCount: 2,
        payload: new Uint8Array([1, 2, 3]),
        scene: { privateThreeScene: true },
      },
    });

    assert.deepEqual(sanitized, {
      metadata: {
        fileName: 'armor.obj',
        kind: 'obj',
        extension: '.obj',
        byteLength: 128,
      },
      objectCount: 3,
      nested: {
        meshCount: 2,
      },
    });
  });
});
