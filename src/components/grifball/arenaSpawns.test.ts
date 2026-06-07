import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createDefaultSpawnPoints,
  getGrifballTeamSpawn,
  getMultiplayerSpawnPoint,
} from './arenaSpawns';

test('multiplayer spawn slots map to unique default spawn points', () => {
  const spawns = createDefaultSpawnPoints();
  const positions = Array.from({ length: 8 }, (_, slot) => getMultiplayerSpawnPoint(null, spawns, slot));
  const uniquePositions = new Set(positions.map(pos => `${pos.x.toFixed(3)},${pos.z.toFixed(3)}`));

  assert.equal(uniquePositions.size, 8);
  assert.ok(positions[0].distanceTo(new THREE.Vector3(0, 0, 13)) < 0.001);
  assert.ok(positions[1].distanceTo(new THREE.Vector3(0, 0, -13)) < 0.001);
});

test('multiplayer spawn slots wrap without collapsing all guests to one point', () => {
  const spawns = createDefaultSpawnPoints();
  const firstGuest = getMultiplayerSpawnPoint(null, spawns, 1);
  const wrappedGuest = getMultiplayerSpawnPoint(null, spawns, 9);

  assert.ok(firstGuest.distanceTo(wrappedGuest) < 0.001);
});

test('grifball team spawns honor preferred multiplayer slot when no positions are excluded', () => {
  const customMap = {
    spawnPoints: [],
    teamSpawns: {
      red: [
        { x: -1, y: 0, z: -10 },
        { x: 1, y: 0, z: -10 },
      ],
    },
  } as any;

  const slotOneSpawn = getGrifballTeamSpawn(customMap, 'red', createDefaultSpawnPoints(), [], 1);
  const slotThreeSpawn = getGrifballTeamSpawn(customMap, 'red', createDefaultSpawnPoints(), [], 3);

  assert.deepEqual({ x: slotOneSpawn.x, z: slotOneSpawn.z }, { x: 1, z: -10 });
  assert.deepEqual({ x: slotThreeSpawn.x, z: slotThreeSpawn.z }, { x: 1, z: -10 });
});
