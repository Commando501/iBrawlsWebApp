import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { CombatantRig } from './combatantRig';
import {
  V3_POSE_CLEARANCE_CASES,
  analyzeV3BuiltInPoseClearance,
  analyzeV3PoseClearance,
} from './v3PoseClearance';

const EXPECTED_CASE_IDS = [
  'idle',
  'walk',
  'sprint',
  'slide',
  'hammerWindup',
  'hammerStrike',
  'hammerRecover',
  'swordLunge',
  'swordSlash',
  'pistolFire',
  'hitReact',
  'death',
] as const;

const ACTIVE_WEAPON_CASE_IDS = [
  'hammerWindup',
  'hammerStrike',
  'hammerRecover',
  'swordLunge',
  'swordSlash',
  'pistolFire',
] as const;

const createBoxPart = (
  id: string,
  position: THREE.Vector3Tuple,
  scale: THREE.Vector3Tuple
): THREE.Group => {
  const part = new THREE.Group();
  part.name = `fixture:${id}`;
  part.position.fromArray(position);
  part.userData.v3PartId = id;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(scale[0], scale[1], scale[2]),
    new THREE.MeshBasicMaterial({ color: 0x6699cc })
  );
  part.add(mesh);
  return part;
};

const createSyntheticV3Fixture = (): THREE.Group => {
  const model = new THREE.Group();
  model.name = 'synthetic-v3-clearance-fixture';
  model.userData.modelSystem = 'v3';

  const lowerTorso = createBoxPart('lowerTorso', [0, 0.8, 0], [0.45, 0.45, 0.3]);
  const upperTorso = createBoxPart('upperTorso', [0, 1.28, 0], [0.52, 0.55, 0.35]);
  const head = createBoxPart('head', [0, 1.75, 0], [0.28, 0.28, 0.28]);
  const leftArm = createBoxPart('leftArm', [-0.48, 1.24, 0], [0.22, 0.62, 0.22]);
  const rightArm = createBoxPart('rightArm', [0.48, 1.24, 0], [0.22, 0.62, 0.22]);
  const leftLeg = createBoxPart('leftLeg', [-0.18, 0.28, 0], [0.2, 0.58, 0.2]);
  const rightLeg = createBoxPart('rightLeg', [0.18, 0.28, 0], [0.2, 0.58, 0.2]);

  model.add(lowerTorso, upperTorso, head, leftArm, rightArm, leftLeg, rightLeg);
  model.userData.v3PartGroups = {
    pelvis: lowerTorso,
    chest: upperTorso,
    helmet: head,
    upperArmLeft: leftArm,
    upperArmRight: rightArm,
    thighLeft: leftLeg,
    thighRight: rightLeg,
  };
  model.userData.v3DetailBones = {};
  model.userData.lowerTorso = lowerTorso;
  model.userData.upperTorso = upperTorso;
  model.userData.head = head;
  model.userData.leftArm = leftArm;
  model.userData.rightArm = rightArm;
  model.userData.leftLeg = leftLeg;
  model.userData.rightLeg = rightLeg;

  const rightHandGrip = new THREE.Group();
  rightHandGrip.name = 'fixture:rightHandGrip';
  rightHandGrip.position.set(0, -0.28, -0.05);
  rightArm.add(rightHandGrip);
  const thirdPersonWeaponGrip = new THREE.Group();
  thirdPersonWeaponGrip.name = 'fixture:thirdPersonWeaponGrip';
  thirdPersonWeaponGrip.position.set(0, -0.28, -0.05);
  rightArm.add(thirdPersonWeaponGrip);

  const rig: CombatantRig = {
    root: model,
    bones: {
      root: model,
      lowerTorso,
      upperTorso,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
    },
    attachments: {
      rightHandGrip: { name: 'rightHandGrip', bone: 'rightArm', group: rightHandGrip },
      thirdPersonWeaponGrip: { name: 'thirdPersonWeaponGrip', bone: 'rightArm', group: thirdPersonWeaponGrip },
    },
    segmentGroups: {
      lowerTorso,
      upperTorso,
      head,
      leftArm,
      rightArm,
      leftLeg,
      rightLeg,
    },
    detailBones: {},
  };
  model.userData.combatantRig = rig;
  return model;
};

const snapshotTransforms = (root: THREE.Object3D) => {
  const entries: Array<{
    name: string;
    position: number[];
    quaternion: number[];
    scale: number[];
    visible: boolean;
  }> = [];
  root.traverse((object) => {
    entries.push({
      name: object.name,
      position: object.position.toArray(),
      quaternion: object.quaternion.toArray(),
      scale: object.scale.toArray(),
      visible: object.visible,
    });
  });
  return entries;
};

describe('v3PoseClearance', () => {
  it('passes every built-in V3 pose case with deterministic output', () => {
    assert.deepEqual(V3_POSE_CLEARANCE_CASES.map((testCase) => testCase.id), EXPECTED_CASE_IDS);

    const first = analyzeV3BuiltInPoseClearance();
    const second = analyzeV3BuiltInPoseClearance();

    assert.deepEqual(first, second);
    assert.equal(first.ready, true, first.issues.map((issue) => issue.code).join(', '));
    assert.deepEqual(first.cases.map((testCase) => testCase.id), EXPECTED_CASE_IDS);
    assert.equal(first.summary.caseCount, EXPECTED_CASE_IDS.length);
    assert.equal(first.summary.readyCaseCount, EXPECTED_CASE_IDS.length);

    for (const testCase of first.cases) {
      assert.equal(testCase.ready, true, `${testCase.id} should be ready`);
      assert.equal(Number.isFinite(testCase.metrics.partOverlapRatio), true);
      assert.equal(Number.isFinite(testCase.metrics.limbGap), true);
      assert.equal(Number.isFinite(testCase.metrics.footFloorPenetration), true);
      assert.equal(Number.isFinite(testCase.metrics.footLift), true);
      assert.equal(Number.isFinite(testCase.metrics.upperLowerCoupling), true);
    }
  });

  it('reports missing-rig for a bare group fixture', () => {
    const report = analyzeV3PoseClearance('idle', { model: new THREE.Group() });

    assert.equal(report.ready, false);
    assert.equal(report.issues.some((issue) => issue.code === 'missing-rig'), true);
  });

  it('reports non-finite-transform for a fixture with a NaN transform', () => {
    const fixture = createSyntheticV3Fixture();
    fixture.userData.leftArm.rotation.x = Number.NaN;

    const report = analyzeV3PoseClearance('idle', { model: fixture });

    assert.equal(report.ready, false);
    assert.equal(report.issues.some((issue) => issue.code === 'non-finite-transform'), true);
  });

  it('reports broad synthetic limb collisions as part-overlap-high or limb-gap-low', () => {
    const fixture = createSyntheticV3Fixture();
    fixture.userData.leftArm.position.set(0, 1.25, 0);
    fixture.userData.rightArm.position.set(0, 1.25, 0);

    const report = analyzeV3PoseClearance('idle', { model: fixture });
    const issueCodes = new Set(report.issues.map((issue) => issue.code));

    assert.equal(report.ready, false);
    assert.equal(
      issueCodes.has('part-overlap-high') || issueCodes.has('limb-gap-low'),
      true
    );
  });

  it('does not leave pose mutations on caller-provided V3 fixtures', () => {
    const fixture = createSyntheticV3Fixture();
    const beforeTransforms = snapshotTransforms(fixture);
    const hadLastHp = Object.prototype.hasOwnProperty.call(fixture.userData, 'v3LastHp');
    const lastHp = fixture.userData.v3LastHp;

    analyzeV3PoseClearance('hitReact', { model: fixture });

    assert.deepEqual(snapshotTransforms(fixture), beforeTransforms);
    assert.equal(Object.prototype.hasOwnProperty.call(fixture.userData, 'v3LastHp'), hadLastHp);
    assert.equal(fixture.userData.v3LastHp, lastHp);
  });

  it('fails active weapon pose cases when weapon clearance metrics cannot be measured', () => {
    const fixture = createSyntheticV3Fixture();

    const report = analyzeV3PoseClearance('hammerWindup', { model: fixture });
    const missingWeaponIssue = report.issues.find((issue) => (
      issue.code === 'missing-rig'
      && issue.partIds?.includes('hammer')
      && issue.partIds?.includes('thirdPersonWeaponGrip')
    ));

    assert.equal(report.ready, false);
    assert.equal(report.cases[0].metrics.weapon, undefined);
    assert.ok(missingWeaponIssue);
  });

  it('includes weapon clearance metrics for active weapon pose cases without drift failures', () => {
    const builtIn = analyzeV3BuiltInPoseClearance();

    for (const caseId of ACTIVE_WEAPON_CASE_IDS) {
      const testCase = builtIn.cases.find((candidate) => candidate.id === caseId);
      assert.ok(testCase, `missing case ${caseId}`);
      assert.ok(testCase.metrics.weapon, `${caseId} should include weapon metrics`);
      assert.equal(Number.isFinite(testCase.metrics.weapon.gripDrift), true);
      assert.equal(
        testCase.issues.some((issue) => issue.code === 'weapon-drift-high'),
        false,
        `${caseId} should not report weapon drift`
      );
    }
  });
});
