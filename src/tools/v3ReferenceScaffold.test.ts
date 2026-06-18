import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseV3ObjMetadata } from './v3ObjParser';
import { buildV3ReferenceScaffold } from './v3ReferenceScaffold';

function syntheticObj(): string {
  const lines: string[] = ['# local synthetic OBJ reference', 'mtllib C:/private/source/reference.mtl'];
  let vertex = 1;

  const addBox = (
    name: string,
    material: string,
    min: [number, number, number],
    max: [number, number, number]
  ) => {
    const start = vertex;
    lines.push(`o ${name}`, `usemtl ${material}`);
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          lines.push(`v ${x} ${y} ${z}`);
          vertex += 1;
        }
      }
    }
    lines.push(
      `f ${start} ${start + 1} ${start + 3} ${start + 2}`,
      `f ${start + 4} ${start + 6} ${start + 7} ${start + 5}`,
      `f ${start} ${start + 4} ${start + 5} ${start + 1}`,
      `f ${start + 2} ${start + 3} ${start + 7} ${start + 6}`
    );
  };

  addBox('Boot_L', 'armor_boot', [-2, 0, -1], [-0.5, 2, 1]);
  addBox('Boot_R', 'armor_boot', [0.5, 0, -1], [2, 2, 1]);
  addBox('Shin', 'armor_leg', [-1.5, 2, -0.75], [1.5, 6, 0.75]);
  addBox('Chest', 'spartan_armor', [-2, 6, -1], [2, 9, 1]);
  addBox('Helmet', 'visor_gold', [-1, 9, -0.75], [1, 12, 0.75]);

  return lines.join('\n');
}

describe('buildV3ReferenceScaffold', () => {
  it('parses synthetic OBJ text into a sanitized scaffold', () => {
    const scaffold = buildV3ReferenceScaffold({
      objText: syntheticObj(),
      source: { kind: 'obj', fileName: 'C:/private/source/synthetic.obj' },
    });

    assert.equal(scaffold.schemaVersion, 'v3-reference-scaffold/v1');
    assert.equal(scaffold.version, 1);
    assert.equal(scaffold.source.kind, 'obj');
    assert.equal(scaffold.source.fileName, 'synthetic.obj');
    assert.equal(scaffold.source.calibrationAllowed, true);
    assert.equal(scaffold.source.inspectionOnly, false);
    assert.equal(scaffold.source.metadata.objectCount, 5);
    assert.equal(scaffold.source.metadata.vertexCount, 40);
    assert.equal(scaffold.globalRatios.widthToHeight, 0.333333);
    assert.equal(scaffold.globalRatios.depthToHeight, 0.166667);
    assert.equal(scaffold.verticalBands.length, 12);
    assert.equal(scaffold.verticalBands[0].id, 'foot');
    assert(scaffold.verticalBands[0].occupancyRatio > 0);
    assert.equal(scaffold.occupancySummary.familyObjectCounts.helmet, 1);
    assert.equal(scaffold.occupancySummary.familyObjectCounts.torso, 1);
    assert.equal(scaffold.occupancySummary.familyObjectCounts.legs, 3);
    assert.equal(scaffold.occupancySummary.objectCoverageRatio, 1);
  });

  it('is deterministic from OBJ text and from existing metadata', () => {
    const objText = syntheticObj();
    const metadata = parseV3ObjMetadata(objText);
    const fromText = buildV3ReferenceScaffold({
      objText,
      source: { kind: 'obj', fileName: 'synthetic.obj' },
    });
    const fromMetadata = buildV3ReferenceScaffold({
      metadata,
      source: { kind: 'obj', fileName: 'synthetic.obj' },
    });

    assert.deepEqual(buildV3ReferenceScaffold({
      objText,
      source: { kind: 'obj', fileName: 'synthetic.obj' },
    }), fromText);
    assert.deepEqual(fromMetadata, fromText);
  });

  it('extracts slot-family envelopes from OBJ object names', () => {
    const scaffold = buildV3ReferenceScaffold({
      objText: syntheticObj(),
      source: { kind: 'obj', fileName: 'synthetic.obj' },
    });

    const helmet = scaffold.slotFamilyEnvelopes.find((entry) => entry.family === 'helmet');
    const torso = scaffold.slotFamilyEnvelopes.find((entry) => entry.family === 'torso');
    const legs = scaffold.slotFamilyEnvelopes.find((entry) => entry.family === 'legs');

    assert.equal(helmet?.objectCount, 1);
    assert.equal(helmet?.verticalRange.minRatio, 0.75);
    assert.equal(helmet?.verticalRange.maxRatio, 1);
    assert.equal(torso?.objectCount, 1);
    assert.equal(legs?.objectCount, 3);
    assert.deepEqual(legs?.objectNames, ['Boot_L', 'Boot_R', 'Shin']);
  });

  it('flags non-OBJ sources as inspection-only and blocks calibration', () => {
    const scaffold = buildV3ReferenceScaffold({
      metadata: parseV3ObjMetadata(syntheticObj()),
      source: { kind: 'fbx', fileName: 'reference.fbx' },
    });

    assert.equal(scaffold.source.kind, 'fbx');
    assert.equal(scaffold.source.canonicalKind, 'obj');
    assert.equal(scaffold.source.calibrationAllowed, false);
    assert.equal(scaffold.source.inspectionOnly, true);
    assert.match(scaffold.source.issues.join('\n'), /OBJ sources can calibrate/i);
  });

  it('excludes raw payloads, source text, private paths, and raw geometry fields', () => {
    const objText = syntheticObj();
    const scaffold = buildV3ReferenceScaffold({
      objText,
      metadata: parseV3ObjMetadata(objText),
      source: { kind: 'obj', fileName: 'C:/private/source/synthetic.obj' },
      rawSourceText: objText,
      payload: new ArrayBuffer(16),
      mesh: { vertices: [[-2, 0, -1]], faces: [[1, 2, 3]] },
    } as never);
    const serialized = JSON.stringify(scaffold);

    assert.equal(serialized.includes('C:/private'), false);
    assert.equal(serialized.includes('reference.mtl'), false);
    assert.equal(serialized.includes('rawSourceText'), false);
    assert.equal(serialized.includes('payload'), false);
    assert.equal(serialized.includes('vertices'), false);
    assert.equal(serialized.includes('faces'), false);
    assert.equal(serialized.includes('triangles'), false);
    assert.equal(serialized.includes('v -2 0 -1'), false);
  });
});
