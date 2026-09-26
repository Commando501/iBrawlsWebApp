import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3BlenderWeapon } from './v3BlenderWeaponModels';
import { buildV3WeaponModel, buildV3SpartanModel } from './VoxelModelsV3';
import { getDefaultV3WeaponManifest } from './v3AssetManifest';

describe('Blender V3 weapon replacements', () => {
  it('keeps the hammer and katar at their approved character proportions', () => {
    const body = buildV3SpartanModel({ customHue: 192 });
    const height = new THREE.Box3().setFromObject(body).getSize(new THREE.Vector3()).y;
    for (const [weapon, ratio] of [['hammer', .75], ['sword', .5]] as const) {
      const model = buildV3WeaponModel(weapon, { customHue: 192 });
      assert.equal(model.userData.v3WeaponGeometrySource, 'blender-v2');
      assert.ok(Math.abs(new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y / height - ratio) < .001);
      assert.ok(model.children.length <= 6, 'paint roles are batched into at most six meshes');
    }
  });

  it('places primary and hammer support sockets inside graspable handle geometry', () => {
    for (const weapon of ['hammer', 'sword'] as const) {
      const model = buildV3BlenderWeapon(weapon, () => '#777777');
      model.updateWorldMatrix(true, true);
      const sockets = getDefaultV3WeaponManifest(weapon).sockets.filter(s =>
        s.name === 'thirdPersonPrimaryGrip' || (weapon === 'hammer' && s.name === 'thirdPersonOffhandGrip'));
      assert.equal(sockets.length, weapon === 'hammer' ? 2 : 1);
      for (const socket of sockets) {
        const center = new THREE.Vector3(...socket.position);
        const axis = weapon === 'hammer' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
        // Cast from both sides: the socket must be centered in a hand-sized solid grip.
        for (const side of [-1, 1]) {
          const ray = new THREE.Raycaster(center.clone().addScaledVector(axis, .1 * side), axis.clone().multiplyScalar(-side));
          const hit = ray.intersectObject(model, true)[0];
          assert.ok(hit, `${weapon} ${socket.name} misses its handle`);
          const radius = hit.point.distanceTo(center);
          assert.ok(radius > .012 && radius < .032, `${weapon} grip radius ${radius}`);
        }
      }
    }
  });
});
