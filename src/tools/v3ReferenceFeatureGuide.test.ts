import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseV3ObjMetadata } from './v3ObjParser';
import { buildV3ReferenceFeatureGuide } from './v3ReferenceFeatureGuide';

type Vec3 = [number, number, number];

function syntheticFeatureObj(): string {
  const lines: string[] = [
    '# local synthetic OBJ reference',
    'mtllib C:/Users/private/source/reference.mtl',
  ];
  let vertex = 1;

  const addBox = (name: string, group: string, material: string, min: Vec3, max: Vec3) => {
    const start = vertex;
    lines.push(`o ${name}`, `g ${group}`, `usemtl ${material}`);
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

  addBox('Helmet_Crown_Ridge', 'helmet crown top channel', 'armor_primary', [-0.8, 10.8, -0.6], [0.8, 12, 0.4]);
  addBox('Helmet_Visor_Slit', 'helmet front visor', 'visor_gold_glass', [-0.7, 10.1, 0.35], [0.7, 10.7, 0.7]);
  addBox('Helmet_Jaw_Plate', 'helmet lower jaw vent', 'accent_dark_detail', [-0.6, 9.4, 0.2], [0.6, 10, 0.65]);
  addBox('Chest_L_Pectoral', 'left chest pectoral plate', 'armor_secondary', [-1.8, 7.8, -0.6], [-0.1, 9.2, 0.65]);
  addBox('Chest_R_Pectoral', 'right chest pectoral plate', 'armor_secondary', [0.1, 7.8, -0.6], [1.8, 9.2, 0.65]);
  addBox('Chest_Core_Channel', 'center chest core channel', 'undersuit_rubber_black', [-0.35, 7.2, 0.15], [0.35, 8.4, 0.75]);
  addBox('Chest_Abdomen_Vent', 'abdomen vent grille', 'emissive_blue_light', [-0.9, 6.2, 0.2], [0.9, 7.2, 0.7]);
  addBox('Back_Spine_Rail', 'back spine rail channel', 'armor_primary', [-0.25, 6.8, -1], [0.25, 9.1, -0.55]);
  addBox('Back_L_Rail', 'left back rail', 'accent_trim', [-1.15, 6.7, -1], [-0.75, 9, -0.55]);
  addBox('Back_R_Rail', 'right back rail', 'accent_trim', [0.75, 6.7, -1], [1.15, 9, -0.55]);
  addBox('Pelvis_Core_Belt', 'pelvis waist core', 'armor_primary', [-1.2, 5.1, -0.55], [1.2, 6.1, 0.55]);
  addBox('Shoulder_L_Pauldron', 'left shoulder ridge', 'armor_primary', [-2.6, 7.6, -0.55], [-1.85, 8.8, 0.55]);
  addBox('Shoulder_R_Pauldron', 'right shoulder ridge', 'armor_primary', [1.85, 7.6, -0.55], [2.6, 8.8, 0.55]);
  addBox('UpperArm_L_Bicep', 'left upper arm', 'armor_primary', [-2.5, 5.9, -0.45], [-1.8, 7.4, 0.45]);
  addBox('UpperArm_R_Bicep', 'right upper arm', 'armor_primary', [1.8, 5.9, -0.45], [2.5, 7.4, 0.45]);
  addBox('Forearm_L_Gauntlet_Channel', 'left forearm wrist channel', 'armor_secondary', [-2.45, 4.2, -0.45], [-1.65, 5.8, 0.45]);
  addBox('Forearm_R_Gauntlet_Channel', 'right forearm wrist channel', 'armor_secondary', [1.65, 4.2, -0.45], [2.45, 5.8, 0.45]);
  addBox('Hand_L_Glove', 'left hand glove', 'undersuit_rubber_black', [-2.35, 3.45, -0.35], [-1.65, 4.1, 0.35]);
  addBox('Hand_R_Glove', 'right hand glove', 'undersuit_rubber_black', [1.65, 3.45, -0.35], [2.35, 4.1, 0.35]);
  addBox('Thigh_L_Armor', 'left thigh armor', 'armor_primary', [-1.15, 3.2, -0.5], [-0.25, 5.05, 0.5]);
  addBox('Thigh_R_Armor', 'right thigh armor', 'armor_primary', [0.25, 3.2, -0.5], [1.15, 5.05, 0.5]);
  addBox('Shin_L_Greave_Vent', 'left shin knee vent', 'armor_secondary', [-1, 1.25, -0.45], [-0.25, 3.1, 0.5]);
  addBox('Shin_R_Greave_Vent', 'right shin knee vent', 'armor_secondary', [0.25, 1.25, -0.45], [1, 3.1, 0.5]);
  addBox('Foot_L_Boot_Toe', 'left boot toe', 'armor_primary', [-1.05, 0, -0.65], [-0.15, 1.15, 0.95]);
  addBox('Foot_R_Boot_Toe', 'right boot toe', 'armor_primary', [0.15, 0, -0.65], [1.05, 1.15, 0.95]);

  return lines.join('\n');
}

describe('buildV3ReferenceFeatureGuide', () => {
  it('extracts deterministic slot feature hints from OBJ metadata', () => {
    const guide = buildV3ReferenceFeatureGuide({
      objText: syntheticFeatureObj(),
      source: { kind: 'obj', fileName: 'C:/Users/private/source/reach-spartan.obj', label: 'Private Spartan OBJ' },
    });

    assert.equal(guide.schemaVersion, 'v3-reference-feature-guide/v1');
    assert.equal(guide.version, 1);
    assert.equal(guide.source.kind, 'obj');
    assert.equal(guide.source.fileName, 'reach-spartan.obj');
    assert.equal(guide.source.label, 'Private Spartan OBJ');
    assert.deepEqual(guide.slotOrder, [
      'helmet',
      'chest',
      'pelvis',
      'back',
      'shoulder',
      'upperArm',
      'forearm',
      'hand',
      'thigh',
      'shin',
      'foot',
    ]);
    assert.deepEqual(
      guide.slotGuides.map((slot) => slot.slot),
      guide.slotOrder
    );

    const helmet = guide.slotGuides.find((slot) => slot.slot === 'helmet');
    assert(helmet);
    assert.deepEqual(helmet.panelZones.map((zone) => zone.kind), ['visor', 'jaw', 'crown']);
    assert(helmet.ridgeHints.some((hint) => hint.kind === 'ridge' && hint.keyword === 'crown'));
    assert(helmet.ventHints.some((hint) => hint.kind === 'vent' && hint.keyword === 'vent'));
    assert(helmet.channelHints.some((hint) => hint.kind === 'channel' && hint.keyword === 'channel'));

    const chest = guide.slotGuides.find((slot) => slot.slot === 'chest');
    assert(chest);
    assert.deepEqual(chest.panelZones.map((zone) => zone.kind), ['pectoral', 'core', 'abdomen']);
    assert.deepEqual(chest.centerlineGaps.map((gap) => gap.kind), ['front-channel']);

    const back = guide.slotGuides.find((slot) => slot.slot === 'back');
    assert(back);
    assert.deepEqual(back.panelZones.map((zone) => zone.kind), ['rail', 'spine']);
    assert.deepEqual(back.channelHints.map((hint) => hint.keyword), ['channel']);
    assert.equal(back.symmetrySignature.leftCount, 1);
    assert.equal(back.symmetrySignature.rightCount, 1);

    const shin = guide.slotGuides.find((slot) => slot.slot === 'shin');
    const foot = guide.slotGuides.find((slot) => slot.slot === 'foot');
    assert(shin?.ventHints.some((hint) => hint.keyword === 'vent'));
    assert.deepEqual(foot?.panelZones.map((zone) => zone.kind), ['boot', 'toe']);

    const forearm = guide.slotGuides.find((slot) => slot.slot === 'forearm');
    const hand = guide.slotGuides.find((slot) => slot.slot === 'hand');
    assert(forearm?.channelHints.some((hint) => hint.keyword === 'channel'));
    assert.deepEqual(hand?.materialRoleHints, ['undersuit']);
  });

  it('extracts material roles and left/right symmetry signatures without raw payloads', () => {
    const objText = syntheticFeatureObj();
    const fromMetadata = buildV3ReferenceFeatureGuide({
      metadata: parseV3ObjMetadata(objText),
      source: { kind: 'obj', fileName: 'C:/Users/private/source/reach-spartan.obj' },
      rawSourceText: objText,
      payload: new ArrayBuffer(16),
      mesh: { vertices: [[0, 0, 0]], faces: [[1, 2, 3]], triangles: [{ private: true }] },
    } as never);
    const fromText = buildV3ReferenceFeatureGuide({
      objText,
      source: { kind: 'obj', fileName: 'C:/Users/private/source/reach-spartan.obj' },
    });

    assert.deepEqual(fromMetadata, fromText);
    assert.deepEqual(fromMetadata.summary.materialRoleHints, [
      'primary',
      'secondary',
      'accent',
      'undersuit',
      'visor',
      'emissive',
    ]);

    const shoulder = fromMetadata.slotGuides.find((slot) => slot.slot === 'shoulder');
    assert.deepEqual(shoulder?.symmetrySignature, {
      leftCount: 1,
      rightCount: 1,
      centerCount: 0,
      pairedObjectCount: 2,
      balance: 1,
      hasLeftRightPair: true,
    });

    const serialized = JSON.stringify(fromMetadata);
    assert.equal(serialized.includes('C:/Users/private'), false);
    assert.equal(serialized.includes('reference.mtl'), false);
    assert.equal(serialized.includes('rawSourceText'), false);
    assert.equal(serialized.includes('payload'), false);
    assert.equal(serialized.includes('vertices'), false);
    assert.equal(serialized.includes('faces'), false);
    assert.equal(serialized.includes('triangles'), false);
    assert.equal(serialized.includes('referencedVertexIndexes'), false);
    assert.equal(serialized.includes('v -0.8 10.8 -0.6'), false);
  });
});
