import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resolveCombatantBodyCollisions, type CombatantColliderEntity } from './bodyCollisions';

const makeCollider = (
  id: string,
  x: number,
  modelType?: 'medium' | 'large'
): CombatantColliderEntity => ({
  id,
  pos: new THREE.Vector3(x, 0, 0),
  vel: new THREE.Vector3(),
  isCrouching: false,
  modelType,
});

test('large combatants separate using their larger body radius', () => {
  const medium = makeCollider('medium', 0, 'medium');
  const large = makeCollider('large', 1.2, 'large');

  resolveCombatantBodyCollisions([medium, large]);

  const distance = medium.pos.distanceTo(large.pos);
  assert.ok(distance >= 1.29, `expected medium+large separation near 1.3m, got ${distance}`);
});

test('medium combatants preserve legacy body separation', () => {
  const a = makeCollider('a', 0, 'medium');
  const b = makeCollider('b', 1.0, 'medium');

  resolveCombatantBodyCollisions([a, b]);

  const distance = a.pos.distanceTo(b.pos);
  assert.ok(distance >= 1.09, `expected medium+medium separation near 1.1m, got ${distance}`);
  assert.ok(distance < 1.2, `legacy medium separation should not inflate to large size, got ${distance}`);
});
