import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { V3ObjMetadata } from './v3ObjParser';
import { buildV3OfflineReviewPackage } from './v3OfflineReviewPackage';

const metadata = (): V3ObjMetadata => ({
  materialLibraries: ['private-source.mtl'],
  materials: ['armor_primary', 'visor_gold'],
  materialSummaries: [
    { name: 'armor_primary', diffuse: [0.2, 0.4, 0.6], emissive: null, hasTextureReference: true },
    { name: 'visor_gold', diffuse: [1, 0.8, 0.2], emissive: [0.2, 0.6, 1], hasTextureReference: false },
  ],
  vertexCount: 4,
  faceCount: 2,
  triangleCountEstimate: 2,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  objects: [
    {
      name: 'Helmet_Primary',
      groupNames: ['Helmet'],
      materialNames: ['armor_primary', 'visor_gold'],
      faceCount: 2,
      triangleCountEstimate: 2,
      referencedVertexIndexes: [1, 2, 3, 4],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    },
  ],
  triangles: [
    {
      objectName: 'Helmet_Primary',
      groupNames: ['Helmet'],
      materialName: 'armor_primary',
      a: [0, 0, 0],
      b: [1, 0, 0],
      c: [0, 1, 0],
    },
    {
      objectName: 'Helmet_Primary',
      groupNames: ['Helmet'],
      materialName: 'visor_gold',
      a: [0, 0, 0],
      b: [0, 1, 0],
      c: [0, 0, 1],
    },
  ],
});

describe('buildV3OfflineReviewPackage', () => {
  it('builds deterministic sanitized review packages without absolute source paths', () => {
    const review = buildV3OfflineReviewPackage({
      sourcePath: 'C:/Users/private/Halo Reach - Spartans/source.obj',
      metadata: metadata(),
      previewResolution: 6,
    });

    assert.equal(review.schemaVersion, 1);
    assert.equal(review.source.baseName, 'source.obj');
    assert.match(review.source.metadataHashSha256, /^[a-f0-9]{64}$/);
    assert.equal(review.source.metadataHashSha256, buildV3OfflineReviewPackage({
      sourcePath: 'D:/another/private/source.obj',
      metadata: metadata(),
      previewResolution: 6,
    }).source.metadataHashSha256);
    assert.equal(review.source.absolutePathIncluded, false);
    assert.equal(JSON.stringify(review).includes('C:/Users/private'), false);
    assert.equal(review.parts.length, 1);
    assert.equal(review.parts[0].objectName, 'Helmet_Primary');
    assert.equal(review.parts[0].slotCandidate, 'helmet');
    assert.deepEqual(review.parts[0].paintRoles, ['primary', 'visor']);
    assert.equal(review.parts[0].preview.resolution, 6);
    assert.equal(review.parts[0].validation.errors.length, 0);
  });

  it('reports unknown slots and validation failures for review instead of dropping parts', () => {
    const source = metadata();
    source.objects[0] = {
      ...source.objects[0],
      name: 'MysteryDecoration',
      groupNames: [],
      materialNames: ['plain'],
      bounds: { min: [-999, 0, 0], max: [999, 1, 1] },
    };
    source.triangles[0] = {
      ...source.triangles[0],
      objectName: 'MysteryDecoration',
      groupNames: [],
      materialName: 'plain',
      a: [-999, 0, 0],
      b: [999, 0, 0],
      c: [0, 1, 0],
    };

    const review = buildV3OfflineReviewPackage({
      sourcePath: 'source.obj',
      metadata: source,
      previewResolution: 4,
    });

    assert.equal(review.parts[0].slotCandidate, 'unknown');
    assert.equal(review.parts[0].validation.errors.some((error) => error.includes('outside allowed bounds')), true);
    assert.equal(review.summary.unknownPartCount, 1);
    assert.equal(review.summary.invalidPartCount, 1);
  });
});
