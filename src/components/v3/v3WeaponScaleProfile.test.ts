import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import {
  analyzeV3WeaponScaleFit,
  applyV3WeaponScaleProfile,
  getV3WeaponScaleProfile,
} from './v3WeaponScaleProfile';
import { V3_WEAPON_IDS } from './v3ModelTypes';

const makeBoxModel = (width: number, height: number, depth: number): THREE.Group => {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.y = height / 2;
  group.add(mesh);
  group.updateWorldMatrix(true, true);
  return group;
};

const makeBounds = (width: number, height: number, depth: number): THREE.Box3 =>
  new THREE.Box3(
    new THREE.Vector3(-width / 2, 0, -depth / 2),
    new THREE.Vector3(width / 2, height, depth / 2)
  );

describe('V3 weapon scale profile', () => {
  it('defines deterministic V3-only scale profiles for every built-in weapon', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const first = getV3WeaponScaleProfile(weapon);
      const second = getV3WeaponScaleProfile(weapon);

      assert.equal(first.weapon, weapon);
      assert.deepEqual(first, second);
      assert.equal(first.modelSystem, 'v3');
      assert.equal(first.targetBodyHeightRatio > 0, true, `${weapon} body ratio`);
      assert.equal(first.maxHandSpanRatio > 0, true, `${weapon} hand span ratio`);
      assert.equal(first.minUniformScale > 0, true, `${weapon} min scale`);
      assert.equal(first.maxUniformScale >= first.minUniformScale, true, `${weapon} scale range`);
      assert.equal(Object.isFrozen(first), true, `${weapon} profile is immutable`);
    }

    assert.equal(getV3WeaponScaleProfile('hammer').targetBodyHeightRatio, 0.72);
    assert.equal(getV3WeaponScaleProfile('sword').targetBodyHeightRatio, 0.64);
    assert.equal(getV3WeaponScaleProfile('pistol').targetBodyHeightRatio, 0.16);
  });

  it('analyzes Object3D and Box3 fits against body height and hand span deterministically', () => {
    const bodyBounds = makeBounds(0.9, 1.8, 0.42);
    const hammerModel = makeBoxModel(0.42, 2.4, 0.36);

    const objectReport = analyzeV3WeaponScaleFit(hammerModel, bodyBounds);
    const boundsReport = analyzeV3WeaponScaleFit(makeBounds(0.42, 2.4, 0.36), bodyBounds);

    assert.deepEqual(objectReport, boundsReport);
    assert.equal(objectReport.bodyHeight, 1.8);
    assert.equal(objectReport.handSpan, 0.18);
    assert.equal(objectReport.currentBodyHeightRatio, 1.333333);
    assert.equal(objectReport.currentHandSpanRatio, 2.333333);
    assert.equal(objectReport.recommendedUniformScale, 0.54);
    assert.equal(objectReport.ready, false);
    assert.deepEqual(objectReport.issues.map((issue) => issue.code), [
      'height-ratio-high',
      'hand-span-ratio-high',
    ]);
  });

  it('applies a uniform V3 profile scale once and records fit metadata on the model', () => {
    const bodyBounds = makeBounds(0.9, 1.8, 0.42);
    const hammerModel = makeBoxModel(0.42, 2.4, 0.36);

    const applied = applyV3WeaponScaleProfile(hammerModel, 'hammer', { bodyBounds });
    const afterFirst = new THREE.Box3().setFromObject(hammerModel).getSize(new THREE.Vector3());
    const second = applyV3WeaponScaleProfile(hammerModel, 'hammer', { bodyBounds });
    const afterSecond = new THREE.Box3().setFromObject(hammerModel).getSize(new THREE.Vector3());

    assert.equal(applied.appliedUniformScale, 0.54);
    assert.equal(Number(afterFirst.y.toFixed(6)), 1.296);
    assert.deepEqual(
      afterFirst.toArray().map((value) => Number(value.toFixed(6))),
      afterSecond.toArray().map((value) => Number(value.toFixed(6)))
    );
    assert.equal(second.appliedUniformScale, 1);
    assert.equal(hammerModel.userData.v3WeaponScaleProfile.weapon, 'hammer');
    assert.equal(hammerModel.userData.v3WeaponScaleProfile.modelSystem, 'v3');
    assert.equal(hammerModel.userData.v3WeaponScaleProfile.appliedUniformScale, 0.54);
  });

  it('uses explicit hand span context when the caller has measured V3 hand sockets', () => {
    const pistolModel = makeBoxModel(0.4, 0.18, 0.12);
    const bodyBounds = makeBounds(0.9, 1.8, 0.42);

    const looseGrip = analyzeV3WeaponScaleFit(pistolModel, bodyBounds, {
      weapon: 'pistol',
      handSpan: 0.2,
    });
    const compactGrip = analyzeV3WeaponScaleFit(pistolModel, bodyBounds, {
      weapon: 'pistol',
      handSpan: 0.12,
    });

    assert.equal(looseGrip.recommendedUniformScale, 1.6);
    assert.equal(compactGrip.recommendedUniformScale, 1.2);
    assert.ok(looseGrip.recommendedUniformScale > compactGrip.recommendedUniformScale);
  });
});
