import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { PREMADE_MAPS } from '../../game/premadeMaps';
import { toGrifballArena } from '../../game/grifballMaps';
import { type CustomMapData, type CustomMapObject } from '../../types';
import { createHighFidelityObjectMesh } from './customMapAssets';

const PLACEMENT_EPSILON = 0.03;

function variantsForMap(map: CustomMapData): { name: string; map: CustomMapData }[] {
  const variants = [{ name: `${map.id}:authored`, map }];
  const grifballMap = toGrifballArena(map);
  if (grifballMap !== map) {
    variants.push({ name: `${map.id}:grifball`, map: grifballMap });
  }
  return variants;
}

function renderedBottomForObject(obj: CustomMapObject): number {
  const mesh = createHighFidelityObjectMesh(obj, THREE, undefined);
  mesh.position.set(obj.position.x, obj.position.y, obj.position.z);
  mesh.rotation.set(obj.rotation.x, obj.rotation.y, obj.rotation.z);
  mesh.updateMatrixWorld(true);

  const bounds = new THREE.Box3().setFromObject(mesh);
  assert.equal(bounds.isEmpty(), false, `${obj.id} should produce visible geometry`);
  return bounds.min.y;
}

for (const map of PREMADE_MAPS) {
  for (const variant of variantsForMap(map)) {
    test(`${variant.name} map objects honor authored vertical placement`, () => {
      for (const obj of variant.map.objects) {
        if (obj.gameModeKind === 'spawn_point') continue;

        const bottom = renderedBottomForObject(obj);
        const expectedBottom = obj.position.y - obj.scale.y / 2;
        assert.ok(
          Math.abs(bottom - expectedBottom) <= PLACEMENT_EPSILON,
          `${variant.name}/${obj.id} bottom ${bottom.toFixed(3)} should match ${expectedBottom.toFixed(3)}`
        );
      }
    });
  }
}
