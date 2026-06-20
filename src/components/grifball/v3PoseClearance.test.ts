import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import type { CombatantRig } from './combatantRig';
import type { V3PoseClearanceOverlay, V3PoseClearanceSubject } from './v3PoseClearance';
import {
  V3_POSE_CLEARANCE_CASES,
  analyzeV3BuiltInPoseClearance,
  analyzeV3PoseClearance,
  applyV3PoseClearanceCase,
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
  const leftFoot = createBoxPart('footLeft', [-0.18, -0.06, 0.08], [0.24, 0.12, 0.34]);
  const rightFoot = createBoxPart('footRight', [0.18, -0.06, 0.08], [0.24, 0.12, 0.34]);

  model.add(lowerTorso, upperTorso, head, leftArm, rightArm, leftLeg, rightLeg, leftFoot, rightFoot);
  model.userData.v3PartGroups = {
    pelvis: lowerTorso,
    chest: upperTorso,
    helmet: head,
    upperArmLeft: leftArm,
    upperArmRight: rightArm,
    thighLeft: leftLeg,
    thighRight: rightLeg,
    footLeft: leftFoot,
    footRight: rightFoot,
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

const createSyntheticWeaponFixture = (
  activeWeapon: 'hammer' | 'sword' | 'pistol',
  position: THREE.Vector3Tuple
): THREE.Group => {
  const weapon = new THREE.Group();
  weapon.name = `fixture:${activeWeapon}`;
  weapon.position.fromArray(position);
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 0.8, 0.2),
    new THREE.MeshBasicMaterial({ color: 0xcc9966 })
  );
  weapon.add(mesh);
  return weapon;
};

const snapshotTransforms = (...roots: THREE.Object3D[]) => {
  const entries: Array<{
    root: string;
    name: string;
    position: number[];
    quaternion: number[];
    scale: number[];
    visible: boolean;
  }> = [];
  for (const root of roots) {
    root.traverse((object) => {
      entries.push({
        root: root.name,
        name: object.name,
        position: object.position.toArray(),
        quaternion: object.quaternion.toArray(),
        scale: object.scale.toArray(),
        visible: object.visible,
      });
    });
  }
  return entries;
};

const assertOverlayIsSerializable = (overlays: V3PoseClearanceOverlay[]): void => {
  assert.deepEqual(JSON.parse(JSON.stringify(overlays)), overlays);
};

let cachedBuiltInPoseClearanceReport: ReturnType<typeof analyzeV3BuiltInPoseClearance> | null = null;
const getBuiltInPoseClearanceReport = (): ReturnType<typeof analyzeV3BuiltInPoseClearance> => {
  cachedBuiltInPoseClearanceReport ??= analyzeV3BuiltInPoseClearance();
  return cachedBuiltInPoseClearanceReport;
};

describe('v3PoseClearance', () => {
  it('passes every built-in V3 pose case with deterministic output', () => {
    assert.deepEqual(V3_POSE_CLEARANCE_CASES.map((testCase) => testCase.id), EXPECTED_CASE_IDS);

    const first = getBuiltInPoseClearanceReport();
    const syntheticFirst = analyzeV3PoseClearance('idle', { model: createSyntheticV3Fixture() });
    const syntheticSecond = analyzeV3PoseClearance('idle', { model: createSyntheticV3Fixture() });

    assert.deepEqual(syntheticFirst, syntheticSecond);
    assert.equal(first.ready, true, first.issues.map((issue) => issue.code).join(', '));
    assert.deepEqual(first.cases.map((testCase) => testCase.id), EXPECTED_CASE_IDS);
    assert.equal(first.summary.caseCount, EXPECTED_CASE_IDS.length);
    assert.equal(first.summary.readyCaseCount, EXPECTED_CASE_IDS.length);

    for (const testCase of first.cases) {
      assert.equal(testCase.ready, true, `${testCase.id} should be ready`);
      assert.deepEqual(testCase.overlays, []);
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
    const hammerModel = createSyntheticWeaponFixture('hammer', [3, 3, 3]);
    const beforeTransforms = snapshotTransforms(fixture, hammerModel);
    const hadLastHp = Object.prototype.hasOwnProperty.call(fixture.userData, 'v3LastHp');
    const lastHp = fixture.userData.v3LastHp;

    analyzeV3PoseClearance('hammerWindup', { model: fixture, hammerModel });

    assert.deepEqual(snapshotTransforms(fixture, hammerModel), beforeTransforms);
    assert.equal(Object.prototype.hasOwnProperty.call(fixture.userData, 'v3LastHp'), hadLastHp);
    assert.equal(fixture.userData.v3LastHp, lastHp);
  });

  it('applies a selected V3 pose case to an editor subject without restoring it', () => {
    const fixture = createSyntheticV3Fixture();
    const hammerModel = createSyntheticWeaponFixture('hammer', [0, 0, 0]);
    const subject: V3PoseClearanceSubject = {
      model: fixture,
      rig: fixture.userData.combatantRig,
      hammerModel,
    };

    const beforeTransforms = snapshotTransforms(fixture, hammerModel);

    applyV3PoseClearanceCase(subject, 'hitReact');

    assert.notDeepEqual(snapshotTransforms(fixture, hammerModel), beforeTransforms);
    assert.equal(typeof fixture.userData.v3LastHp, 'number');
  });

  it('adds serializable overlays for overlap, limb gap, and foot floor issues', () => {
    const fixture = createSyntheticV3Fixture();
    fixture.userData.leftArm.position.set(0, 1.25, 0);
    fixture.userData.rightArm.position.set(0, 1.25, 0);
    const gapFixture = createSyntheticV3Fixture();
    gapFixture.userData.leftArm.position.set(-0.19, 1.25, 0);
    gapFixture.userData.rightArm.position.set(0.19, 1.25, 0);

    const penetrationReport = analyzeV3PoseClearance('idle', {
      model: fixture,
      floorY: 0.3,
      thresholds: {
        maxPartOverlapRatio: 0.01,
        minLimbGap: 0.2,
        maxFootFloorPenetration: 0.01,
      },
    });
    const gapReport = analyzeV3PoseClearance('idle', {
      model: gapFixture,
      thresholds: {
        maxPartOverlapRatio: 0.01,
        minLimbGap: 0.2,
      },
    });
    const overlays = [
      ...penetrationReport.cases[0].overlays,
      ...gapReport.cases[0].overlays,
    ];

    assert.equal(penetrationReport.ready, false);
    assert.equal(gapReport.ready, false);
    assertOverlayIsSerializable(overlays);
    assert.ok(overlays.some((overlay) => (
      overlay.kind === 'part-overlap'
      && overlay.issueCode === 'part-overlap-high'
      && overlay.boxes?.length === 2
      && overlay.boxes.every((box) => box.min.length === 3 && box.max.length === 3)
    )), JSON.stringify(overlays));
    assert.ok(overlays.some((overlay) => (
      overlay.kind === 'limb-gap'
      && overlay.issueCode === 'limb-gap-low'
      && overlay.boxes?.length === 2
    )), JSON.stringify(overlays));
    assert.ok(overlays.some((overlay) => (
      overlay.kind === 'foot-floor-penetration'
      && overlay.issueCode === 'foot-floor-penetration'
      && typeof overlay.floorY === 'number'
    )), JSON.stringify(overlays));

    const liftReport = analyzeV3PoseClearance('idle', {
      model: createSyntheticV3Fixture(),
      floorY: -0.6,
      thresholds: { maxFootLift: 0.01 },
    });

    assert.ok(liftReport.cases[0].overlays.some((overlay) => (
      overlay.kind === 'foot-lift'
      && overlay.issueCode === 'foot-lift-high'
      && typeof overlay.floorY === 'number'
    )));
  });

  it('adds a weapon grip drift overlay when active weapon drift fails', () => {
    const fixture = createSyntheticV3Fixture();
    const hammerModel = createSyntheticWeaponFixture('hammer', [4, 3, 2]);

    const report = analyzeV3PoseClearance('hammerWindup', {
      model: fixture,
      hammerModel,
      thresholds: { maxWeaponGripDrift: 0.01 },
    });
    const overlay = report.cases[0].overlays.find((candidate) => (
      candidate.kind === 'weapon-grip-drift'
    ));

    assert.equal(report.ready, false);
    assert.ok(overlay);
    assert.equal(overlay.issueCode, 'weapon-drift-high');
    assert.deepEqual(overlay.partIds, ['hammer']);
    assert.equal(overlay.line?.from.length, 3);
    assert.equal(overlay.line?.to.length, 3);
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
    const builtIn = getBuiltInPoseClearanceReport();

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
