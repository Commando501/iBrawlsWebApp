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
