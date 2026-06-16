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

function goalPlateObject(team: 'blue' | 'red'): CustomMapObject {
  return {
    id: `test_goal_${team}`,
    name: `${team} Goal Plate`,
    type: 'cylinder',
    position: { x: 0, y: 0.06, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1.1, y: 0.12, z: 1.1 },
    color: '#10342f',
    metalness: 0.82,
    roughness: 0.28,
    opacity: 0.96,
    transparent: false,
    emissive: team === 'red' ? '#ff3b3b' : '#3b82ff',
    emissiveIntensity: 1.15,
    isCollidable: false,
    texture: team === 'red' ? 'goal_plate_red' : 'goal_plate_blue',
    gameModeKind: 'grifball_goal',
    team,
    goalPlateTeam: team,
  };
}

test('goal plates render as a multi-part cyberpunk floor assembly', () => {
  const obj = goalPlateObject('blue');
  const mesh = createHighFidelityObjectMesh(obj, THREE, undefined);

  assert.ok(mesh.children.length >= 5, 'goal plate should include base, rings, core, and tech accents');
  assert.ok(mesh.children.some((child) => child.userData.goalPlateTeam === 'blue'));
  assert.ok(
    Math.abs(renderedBottomForObject(obj) - (obj.position.y - obj.scale.y / 2)) <= PLACEMENT_EPSILON
  );
});

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
