import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getGoalPlates, isOverGoalPlate, findScoringPlate } from './grifballGoals';
import { type CustomMapData, type CustomMapObject } from '../types';

function plateObj(team: 'blue' | 'red', x: number, scaleX = 6, scaleZ = 10): CustomMapObject {
  return {
    id: `plate_${team}`,
    name: `${team} goal`,
    type: 'box',
    position: { x, y: 0.05, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: scaleX, y: 0.1, z: scaleZ },
    color: '#ffffff',
    metalness: 0.2,
    roughness: 0.4,
    opacity: 0.85,
    transparent: true,
    emissive: '#000000',
    emissiveIntensity: 0.9,
    isCollidable: false,
    texture: 'none',
    goalPlateTeam: team,
  };
}

function mapWith(objects: CustomMapObject[]): CustomMapData {
  return {
    id: 'm', name: 'm', description: '', author: '', theme: 'grifball_stadium',
    mapShape: 'rectangular', arenaRadius: 40, arenaHalfExtents: { x: 52, z: 23 },
    spawnPoints: [], objects,
    lighting: { ambientColor: '#fff', ambientIntensity: 1, directColor: '#fff', directIntensity: 1, directPosition: { x: 0, y: 1, z: 0 }, pointLights: [] },
  };
}

test('getGoalPlates extracts flagged plates with footprint half-extents', () => {
  const plates = getGoalPlates(mapWith([plateObj('blue', -50), plateObj('red', 50)]));
  assert.equal(plates.length, 2);
  const blue = plates.find(p => p.team === 'blue')!;
  assert.deepEqual(blue.position, { x: -50, y: 0.05, z: 0 });
  assert.deepEqual(blue.halfExtents, { x: 3, z: 5 });
});

test('isOverGoalPlate respects the footprint and margin', () => {
  const [blue] = getGoalPlates(mapWith([plateObj('blue', -50)]));
  assert.ok(isOverGoalPlate(-50, 4, blue));      // inside z half-extent (5)
  assert.ok(!isOverGoalPlate(-50, 6, blue));     // outside
  assert.ok(isOverGoalPlate(-50, 6, blue, 1.5)); // inside with margin
});

test('findScoringPlate only scores on the enemy plate', () => {
  const plates = getGoalPlates(mapWith([plateObj('blue', -50), plateObj('red', 50)]));
  // A blue carrier standing on the RED plate scores.
  assert.equal(findScoringPlate(50, 0, 'blue', plates)?.team, 'red');
  // A blue carrier on their OWN plate does not score.
  assert.equal(findScoringPlate(-50, 0, 'blue', plates), null);
  // Standing in midfield scores nothing.
  assert.equal(findScoringPlate(0, 0, 'blue', plates), null);
});
