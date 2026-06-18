import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { resolveHeldGrifballBallVisualPosition } from './grifballBallCarryVisuals';

test('V1 ball carriers swing the held ball forward during punch strike frames', () => {
  const basePosition = new THREE.Vector3(0, 1.1, 0);

  const posed = resolveHeldGrifballBallVisualPosition({
    basePosition,
    yaw: 0,
    activeWeapon: 'ball',
    weaponState: 'swing_down',
    weaponTimer: 0.06,
    settings: { hammerMeleeSpeed: 0.24 },
  });

  assert.equal(basePosition.toArray().join(','), '0,1.1,0');
  assert.ok(posed.z < -0.45, `expected ball to swing in front of carrier, got z=${posed.z}`);
  assert.ok(Math.abs(posed.x) > 0.05, `expected ball to travel across the carrier body, got x=${posed.x}`);
  assert.ok(posed.y > basePosition.y - 0.1, `expected ball to stay near hand height, got y=${posed.y}`);
});

test('non-V1 ball carriers keep the existing centered held-ball position', () => {
  const basePosition = new THREE.Vector3(0, 1.1, 0);

  for (const modelSystem of ['v2', 'v3'] as const) {
    const posed = resolveHeldGrifballBallVisualPosition({
      basePosition,
      yaw: 0,
      activeWeapon: 'ball',
      weaponState: 'swing_down',
      weaponTimer: 0.06,
      settings: { hammerMeleeSpeed: 0.24 },
      modelSystem,
    });

    assert.deepEqual(posed.toArray(), basePosition.toArray(), `${modelSystem} should not receive the V1 ball swing`);
  }
});

test('V1 carriers reset the held ball to a visible carry pose after punching', () => {
  const basePosition = new THREE.Vector3(0, 1.1, 0);

  const posed = resolveHeldGrifballBallVisualPosition({
    basePosition,
    yaw: 0,
    activeWeapon: 'ball',
    weaponState: 'ready',
    weaponTimer: 0,
    settings: { hammerMeleeSpeed: 0.24 },
  });

  assert.notDeepEqual(posed.toArray(), basePosition.toArray());
  assert.ok(posed.z < -0.2, `expected reset pose to keep the ball in front of the carrier, got z=${posed.z}`);
  assert.ok(Math.abs(posed.x) > 0.05, `expected reset pose to stay in the carrier's hands, got x=${posed.x}`);
  assert.ok(posed.y > basePosition.y - 0.1, `expected reset pose to stay near hand height, got y=${posed.y}`);
});
