import { test } from 'node:test';
import assert from 'node:assert/strict';

import { enemyGoalForTeam, ownGoalForTeam } from './aiGrifballRoles';
import { type GoalPlate } from './grifballGoals';

const plates: GoalPlate[] = [
  { team: 'blue', position: { x: -47, y: 0, z: 0 }, halfExtents: { x: 3.5, z: 13 } },
  { team: 'red', position: { x: 47, y: 0, z: 0 }, halfExtents: { x: 3.5, z: 13 } },
];

test('a carrier runs toward the ENEMY plate', () => {
  assert.equal(enemyGoalForTeam('blue', plates)?.team, 'red');
  assert.equal(enemyGoalForTeam('red', plates)?.team, 'blue');
  // Blue attacks the +x (red) plate; red attacks the -x (blue) plate.
  assert.equal(enemyGoalForTeam('blue', plates)?.position.x, 47);
  assert.equal(enemyGoalForTeam('red', plates)?.position.x, -47);
});

test('a defender guards their OWN plate', () => {
  assert.equal(ownGoalForTeam('blue', plates)?.position.x, -47);
  assert.equal(ownGoalForTeam('red', plates)?.position.x, 47);
});

test('returns null for unknown team or empty plates', () => {
  assert.equal(enemyGoalForTeam(undefined, plates), null);
  assert.equal(enemyGoalForTeam('blue', []), null);
  assert.equal(ownGoalForTeam('green', plates), null);
});

import {
  getGrifballRole,
  getGrifballEscortTarget,
  getGrifballSpacingOffset,
  getGrifballRunnerSteering
} from './aiGrifballRoles';

test('getGrifballRole resolves runner, escort, and chaser roles', () => {
  assert.equal(getGrifballRole('bot_1', 'blue', 'bot_1', 'blue'), 'runner');
  assert.equal(getGrifballRole('bot_2', 'blue', 'bot_1', 'blue'), 'escort');
  assert.equal(getGrifballRole('bot_2', 'blue', 'bot_3', 'red'), 'chaser');
  assert.equal(getGrifballRole('bot_2', 'blue', null, undefined), 'chaser');
});

test('getGrifballEscortTarget fans out escorts tactically', () => {
  const runner = { x: 0, y: 0, z: 0 };
  const goal = { x: 10, y: 0, z: 0 }; // Moving along +x
  
  // Index 0 leads straight ahead (forward 6.5m, lateral 0m)
  const target0 = getGrifballEscortTarget(runner, goal, 0);
  assert.equal(target0.x, 6.5);
  assert.equal(target0.z, 0);

  // Index 1 fans left (forward 4.5m, lateral -4.5m)
  const target1 = getGrifballEscortTarget(runner, goal, 1);
  assert.equal(target1.x, 4.5);
  assert.ok(target1.z < 0); // negative z is left flank

  // Index 2 fans right (forward 4.5m, lateral +4.5m)
  const target2 = getGrifballEscortTarget(runner, goal, 2);
  assert.equal(target2.x, 4.5);
  assert.ok(target2.z > 0); // positive z is right flank
});

test('getGrifballSpacingOffset applies repulsion from close teammates', () => {
  const myPos = { x: 0, z: 0 };
  const closeAllies = [{ x: 0, z: 2.0 }]; // too close (spacing < 4.0)
  const farAllies = [{ x: 0, z: 6.0 }]; // far enough
  
  const offsetClose = getGrifballSpacingOffset(myPos, closeAllies, 4.0);
  assert.ok(offsetClose.z < 0); // pushes away in negative z direction
  assert.equal(offsetClose.x, 0);

  const offsetFar = getGrifballSpacingOffset(myPos, farAllies, 4.0);
  assert.equal(offsetFar.x, 0);
  assert.equal(offsetFar.z, 0);
});

test('getGrifballRunnerSteering steers away from enemy blockers', () => {
  const myPos = { x: 0, z: 0 };
  const goalPos = { x: 10, z: 0 }; // goal is straight +x
  const enemies = [{ x: 4.0, z: 0.5 }]; // enemy directly in path ahead
  
  const steer = getGrifballRunnerSteering(myPos, goalPos, enemies, 8.0);
  assert.ok(steer.x > 0); // still moving forward
  assert.ok(Math.abs(steer.z) > 0.01); // steered laterally to avoid the enemy
});
