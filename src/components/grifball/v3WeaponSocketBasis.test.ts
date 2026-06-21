import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3WeaponModel } from '../v3/VoxelModelsV3';
import {
  analyzeV3WeaponSemanticAlignment,
  applyV3WeaponSocketBasis,
  deriveV3WeaponSemanticAxes,
} from './v3WeaponSocketBasis';

describe('V3 weapon socket basis semantic axes', () => {
  it('derives semantic weapon axes from model metadata instead of root Euler guesses', () => {
    const hammer = buildV3WeaponModel('hammer');
    const sword = buildV3WeaponModel('sword');
    const pistol = buildV3WeaponModel('pistol');

    assert.deepEqual(deriveV3WeaponSemanticAxes(hammer, 'hammer').sourceForward.toArray(), [0, 1, 0]);
    assert.deepEqual(deriveV3WeaponSemanticAxes(sword, 'sword').sourceForward.toArray(), [0, 1, 0]);
    assert.deepEqual(deriveV3WeaponSemanticAxes(pistol, 'pistol').sourceForward.toArray(), [1, 0, 0]);
  });

  it('keeps semantic forward/up aligned after applying the socket basis correction', () => {
    for (const weapon of ['hammer', 'sword', 'pistol'] as const) {
      const model = buildV3WeaponModel(weapon);

      applyV3WeaponSocketBasis(model, weapon, 'thirdPersonPrimaryGrip');
      const report = analyzeV3WeaponSemanticAlignment(model, weapon);

      assert.ok(report.forwardAlignment > 0.92, `${weapon} forward ${report.forwardAlignment}`);
      assert.ok(report.upAlignment > 0.92, `${weapon} up ${report.upAlignment}`);
      assert.ok(
        report.semanticForwardWorld.distanceTo(new THREE.Vector3(0, 0, -1)) < 0.4,
        `${weapon} semantic forward distance ${report.semanticForwardWorld.toArray().join(',')}`
      );
    }
  });
});
