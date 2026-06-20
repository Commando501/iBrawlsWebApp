import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import { analyzeV3SlotContinuity } from './v3SlotContinuity';
import {
  V3_LOWER_BODY_SEAM_LINKS,
  analyzeV3LowerBodyContinuity,
  buildV3LowerBodyContinuityOverlays,
} from './v3LowerBodyContinuity';

const makePart = (slot: V3CharacterSlotId, center: THREE.Vector3Tuple, size: THREE.Vector3Tuple): THREE.Group => {
  const group = new THREE.Group();
  group.name = `fixture:${slot}`;
  group.userData.v3Slot = slot;
  group.position.fromArray(center);
  group.add(new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial()));
  return group;
};

const addPart = (
  model: THREE.Group,
  partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>>,
  slot: V3CharacterSlotId,
  center: THREE.Vector3Tuple,
  size: THREE.Vector3Tuple
): void => {
  const part = makePart(slot, center, size);
  model.add(part);
  partGroups[slot] = part;
};

const buildLowerBodyFixture = (tearLeftThigh = false): THREE.Group => {
  const model = new THREE.Group();
  model.userData.modelSystem = 'v3';
  const partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};
  const lowerTorso = new THREE.Group();
  lowerTorso.name = 'fixture:lowerTorso';
  lowerTorso.position.set(0, 0.98, 0);
  lowerTorso.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.26, 0.32), new THREE.MeshBasicMaterial()));
  model.add(lowerTorso);
  model.userData.lowerTorso = lowerTorso;

  addPart(model, partGroups, 'pelvis', [0, 0.75, 0], [0.9, 0.34, 0.32]);
  addPart(model, partGroups, 'thighLeft', [tearLeftThigh ? -0.02 : -0.22, 0.54, 0], [0.28, 0.36, 0.24]);
  addPart(model, partGroups, 'shinLeft', [tearLeftThigh ? -0.02 : -0.22, 0.22, 0], [0.24, 0.36, 0.22]);
  addPart(model, partGroups, 'footLeft', [tearLeftThigh ? -0.02 : -0.22, -0.02, 0.12], [0.28, 0.18, 0.42]);
  addPart(model, partGroups, 'thighRight', [0.22, 0.54, 0], [0.28, 0.36, 0.24]);
  addPart(model, partGroups, 'shinRight', [0.22, 0.22, 0], [0.24, 0.36, 0.22]);
  addPart(model, partGroups, 'footRight', [0.22, -0.02, 0.12], [0.28, 0.18, 0.42]);

  model.userData.v3PartGroups = partGroups;
  model.updateMatrixWorld(true);
  return model;
};

describe('v3LowerBodyContinuity', () => {
  it('defines stable seam links for lower torso through both feet', () => {
    assert.deepEqual(V3_LOWER_BODY_SEAM_LINKS.map((link) => link.id), [
      'lowerTorso-pelvis',
      'pelvis-thigh-left',
      'pelvis-thigh-right',
      'thigh-shin-left',
      'thigh-shin-right',
      'shin-foot-left',
      'shin-foot-right',
    ]);
  });

  it('passes connected lower-body seam fixtures', () => {
    const report = analyzeV3LowerBodyContinuity(buildLowerBodyFixture());

    assert.equal(report.ready, true);
    assert.equal(report.summary.lowerBodyTearWarningCount, 0);
    assert.equal(report.links.every((link) => link.ready), true);
  });

  it('flags visible seam tears even when box continuity still reports overlap', () => {
    const model = buildLowerBodyFixture(true);
    const boxReport = analyzeV3SlotContinuity(model);
    const seamReport = analyzeV3LowerBodyContinuity(model, { maxSeamGap: 0.1, maxProjectedSeamGap: 0.1 });

    const boxPelvisThigh = boxReport.links.find((link) => link.id === 'pelvis-thigh-left');
    assert.ok(boxPelvisThigh);
    assert.equal(boxPelvisThigh.worldGap, 0, 'box continuity should miss overlapping but wrong seam placement');

    assert.equal(seamReport.ready, false);
    assert.equal(seamReport.summary.lowerBodyTearWarningCount > 0, true);
    const pelvisThigh = seamReport.links.find((link) => link.id === 'pelvis-thigh-left');
    assert.ok(pelvisThigh);
    assert.equal(pelvisThigh.ready, false);
    assert.ok(pelvisThigh.maxSeamGap > 0.1);
    assert.ok(pelvisThigh.warnings.some((warning) => warning.code === 'lower-body-seam-gap'));

    const overlays = buildV3LowerBodyContinuityOverlays(seamReport, 'front');
    assert.ok(overlays.some((overlay) => overlay.linkId === 'pelvis-thigh-left'));
  });

  it('does not let visible bridge geometry hide measured seam tears', () => {
    const model = buildLowerBodyFixture(true);
    const bridgeRoot = new THREE.Group();
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    bridgeRoot.visible = true;
    bridge.visible = true;
    model.userData.v3LowerBodyJointBridges = {
      root: bridgeRoot,
      bridges: {
        'pelvis-thigh-left': bridge,
      },
    };

    const seamReport = analyzeV3LowerBodyContinuity(model, { maxSeamGap: 0.1, maxProjectedSeamGap: 0.1 });
    const pelvisThigh = seamReport.links.find((link) => link.id === 'pelvis-thigh-left');

    assert.equal(seamReport.ready, false);
    assert.ok(pelvisThigh);
    assert.equal(pelvisThigh.ready, false);
    assert.ok(pelvisThigh.maxSeamGap > 0.1);
  });
});
