import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertV3ReferenceAssetShape,
  parseV3ObjMetadata,
  type V3ObjMetadata,
} from './v3ObjParser';

const obj = [
  '# synthetic V3 reference-like source',
  'mtllib synthetic.mtl',
  'o Helmet',
  'v 0 0 0',
  'v 2 0 0',
  'v 0 3 0',
  'v 0 0 4',
  'usemtl spartan_armor',
  'g Helmet Visor',
  'f 1/1/1 2/2/1 3/3/1',
  'usemtl visor_glass',
  'f 1 3 4',
  'o Chest',
  'g Torso',
  'usemtl undersuit',
  'v -1 -2 -3',
  'f -1 -2 -3 -4',
].join('\n');

describe('parseV3ObjMetadata', () => {
  it('summarizes objects, groups, materials, faces, triangle estimates, and bounds', () => {
    const parsed = parseV3ObjMetadata(obj);

    assert.equal(parsed.vertexCount, 5);
    assert.equal(parsed.faceCount, 3);
    assert.equal(parsed.triangleCountEstimate, 4);
    assert.deepEqual(parsed.materialLibraries, ['synthetic.mtl']);
    assert.deepEqual(parsed.materials, ['spartan_armor', 'visor_glass', 'undersuit']);
    assert.deepEqual(parsed.bounds, { min: [-1, -2, -3], max: [2, 3, 4] });
    assert.deepEqual(parsed.objects.map((object) => object.name), ['Helmet', 'Chest']);
    assert.deepEqual(parsed.objects[0].groupNames, ['Helmet', 'Visor']);
    assert.deepEqual(parsed.objects[0].materialNames, ['spartan_armor', 'visor_glass']);
    assert.deepEqual(parsed.objects[0].bounds, { min: [0, 0, 0], max: [2, 3, 4] });
    assert.deepEqual(parsed.objects[1].materialNames, ['undersuit']);
    assert.equal(parsed.objects[1].faceCount, 1);
    assert.equal(parsed.objects[1].triangleCountEstimate, 2);
  });

  it('creates a default object when faces arrive before an object declaration', () => {
    const parsed = parseV3ObjMetadata([
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'usemtl default_mat',
      'f 1 2 3',
    ].join('\n'));

    assert.equal(parsed.objects.length, 1);
    assert.equal(parsed.objects[0].name, 'default');
    assert.deepEqual(parsed.objects[0].materialNames, ['default_mat']);
    assert.deepEqual(parsed.objects[0].referencedVertexIndexes, [1, 2, 3]);
  });

  it('ignores malformed vertices and unresolved face references without throwing', () => {
    const parsed = parseV3ObjMetadata([
      'o Broken',
      'v 0 0 nope',
      'v 1 1 1',
      'usemtl metal',
      'f 1 99 -7',
    ].join('\n'));

    assert.equal(parsed.vertexCount, 1);
    assert.equal(parsed.faceCount, 1);
    assert.deepEqual(parsed.bounds, { min: [1, 1, 1], max: [1, 1, 1] });
    assert.deepEqual(parsed.objects[0].referencedVertexIndexes, [1]);
  });
});

describe('assertV3ReferenceAssetShape', () => {
  it('accepts metadata that meets the private reference inspection floor', () => {
    const metadata: V3ObjMetadata = {
      materialLibraries: ['reference.mtl'],
      materials: ['spartan_armor'],
      vertexCount: 18_001,
      faceCount: 20_001,
      triangleCountEstimate: 20_001,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      objects: Array.from({ length: 12 }, (_, index) => ({
        name: `part_${index}`,
        groupNames: [],
        materialNames: index === 0 ? ['spartan_armor'] : [],
        faceCount: 1,
        triangleCountEstimate: 1,
        referencedVertexIndexes: [1],
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      })),
    };

    assert.doesNotThrow(() => assertV3ReferenceAssetShape(metadata));
  });

  it('reports every missing reference expectation in one error', () => {
    const parsed = parseV3ObjMetadata('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');

    assert.throws(
      () => assertV3ReferenceAssetShape(parsed),
      /expected at least 12 objects; expected material spartan_armor; expected more than 18000 vertices; expected more than 20000 faces/
    );
  });
});
