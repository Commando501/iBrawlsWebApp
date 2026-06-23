import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  V3_SLOT_CONTINUITY_LINKS,
  analyzeV3SlotContinuity,
  buildV3SlotContinuityOverlays,
} from './v3SlotContinuity';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';

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
  size: THREE.Vector3Tuple = [0.2, 0.2, 0.2]
): void => {
  const part = makePart(slot, center, size);
  model.add(part);
  partGroups[slot] = part;
};

const buildContinuityFixture = (detachedSlot?: V3CharacterSlotId): THREE.Group => {
  const model = new THREE.Group();
  model.userData.modelSystem = 'v3';
  const partGroups: Partial<Record<V3CharacterSlotId, THREE.Group>> = {};
  const offset = detachedSlot ? new THREE.Vector3(0.9, 0.5, 0) : new THREE.Vector3();

  const place = (
    slot: V3CharacterSlotId,
    center: THREE.Vector3Tuple,
    size?: THREE.Vector3Tuple
  ): void => {
    const vector = new THREE.Vector3(...center);
    if (slot === detachedSlot) vector.add(offset);
    addPart(model, partGroups, slot, vector.toArray(), size);
  };

  place('chest', [0, 1.2, 0], [0.8, 0.4, 0.3]);
  place('neck', [0, 1.5, 0], [0.28, 0.2, 0.24]);
  place('helmet', [0, 1.72, 0], [0.42, 0.24, 0.32]);
  place('back', [0, 1.2, -0.28], [0.52, 0.36, 0.24]);
  place('shoulderLeft', [-0.52, 1.28, 0], [0.24, 0.24, 0.28]);
  place('upperArmLeft', [-0.72, 1.0, 0], [0.2, 0.4, 0.2]);
  place('forearmLeft', [-0.72, 0.6, 0], [0.18, 0.4, 0.18]);
  place('handLeft', [-0.72, 0.28, 0], [0.22, 0.24, 0.2]);
  place('shoulderRight', [0.52, 1.28, 0], [0.24, 0.24, 0.28]);
  place('upperArmRight', [0.72, 1.0, 0], [0.2, 0.4, 0.2]);
  place('forearmRight', [0.72, 0.6, 0], [0.18, 0.4, 0.18]);
  place('handRight', [0.72, 0.28, 0], [0.22, 0.24, 0.2]);
  place('pelvis', [0, 0.72, 0], [0.62, 0.32, 0.28]);
  place('thighLeft', [-0.24, 0.42, 0], [0.22, 0.32, 0.22]);
  place('shinLeft', [-0.24, 0.1, 0], [0.2, 0.32, 0.2]);
  place('footLeft', [-0.24, -0.08, 0.12], [0.24, 0.16, 0.36]);
  place('thighRight', [0.24, 0.42, 0], [0.22, 0.32, 0.22]);
  place('shinRight', [0.24, 0.1, 0], [0.2, 0.32, 0.2]);
  place('footRight', [0.24, -0.08, 0.12], [0.24, 0.16, 0.36]);

  const weaponGrip = new THREE.Group();
  weaponGrip.name = 'fixture:thirdPersonWeaponGrip';
  weaponGrip.position.set(0.84, 0.28, 0);
  model.add(weaponGrip);
  model.userData.combatantRig = {
    attachments: {
      thirdPersonWeaponGrip: {
        name: 'thirdPersonWeaponGrip',
        bone: 'rightArm',
        group: weaponGrip,
      },
    },
  };
  model.userData.v3PartGroups = partGroups;
  model.updateMatrixWorld(true);
  return model;
};

describe('V3 slot continuity analyzer', () => {
  it('defines the required continuity links as stable named contracts', () => {
    const ids = V3_SLOT_CONTINUITY_LINKS.map((link) => link.id);

    assert.deepEqual(ids, [
      'chest-shoulder-left',
      'chest-shoulder-right',
      'shoulder-upperArm-left',
      'shoulder-upperArm-right',
      'upperArm-forearm-left',
      'upperArm-forearm-right',
      'forearm-hand-left',
      'forearm-hand-right',
      'pelvis-thigh-left',
      'pelvis-thigh-right',
      'thigh-shin-left',
      'thigh-shin-right',
      'shin-foot-left',
      'shin-foot-right',
      'chest-neck',
      'neck-helmet',
      'chest-back',
      'hand-weapon-right',
    ]);
  });

  it('passes connected fixtures and projects every link for all atlas views', () => {
    const report = analyzeV3SlotContinuity(buildContinuityFixture());

    assert.equal(report.ready, true);
    assert.equal(report.links.length, V3_SLOT_CONTINUITY_LINKS.length);
    assert.equal(report.summary.failedLinkCount, 0);
    for (const link of report.links) {
      assert.equal(link.ready, true, link.id);
      assert.equal(link.warnings.length, 0, link.id);
      assert.ok(link.worldGap <= 0.03, link.id);
      assert.deepEqual(Object.keys(link.projectedGap).sort(), ['front', 'left', 'rear', 'right']);
      assert.ok(link.endpoints.from.length === 3);
      assert.ok(link.boxes.from.min.length === 3);
    }
  });

  it('can measure armor slot continuity without weapon attachment links', () => {
    const report = analyzeV3SlotContinuity(buildContinuityFixture(), { includeAttachments: false });

    assert.equal(report.ready, true);
    assert.equal(report.links.some((link) => link.attachment), false);
    assert.equal(report.summary.linkCount, V3_SLOT_CONTINUITY_LINKS.filter((link) => !('attachment' in link)).length);
  });

  it('flags detached slot links with stable codes and overlay connectors for failed links only', () => {
    const report = analyzeV3SlotContinuity(buildContinuityFixture('forearmRight'));
    const failedIds = report.links.filter((link) => !link.ready).map((link) => link.id);

    assert.equal(report.ready, false);
    assert.ok(failedIds.includes('upperArm-forearm-right'));
    assert.ok(failedIds.includes('forearm-hand-right'));

    const detachedLink = report.links.find((link) => link.id === 'upperArm-forearm-right');
    assert.ok(detachedLink);
    assert.equal(detachedLink.fromSlot, 'upperArmRight');
    assert.equal(detachedLink.toSlot, 'forearmRight');
    assert.ok(detachedLink.worldGap > 0.2);
    assert.ok(detachedLink.warnings.some((warning) => warning.code === 'slot-gap'));
    assert.ok(detachedLink.warnings.some((warning) => warning.message.includes('upperArmRight -> forearmRight')));

    const overlays = buildV3SlotContinuityOverlays(report, 'front');
    assert.deepEqual(overlays.map((overlay) => overlay.linkId).sort(), failedIds.sort());
    assert.ok(overlays.every((overlay) => overlay.connector.from.length === 2));
    assert.ok(overlays.every((overlay) => overlay.marker.world.length === 3));
  });
});
