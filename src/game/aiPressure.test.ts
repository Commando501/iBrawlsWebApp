import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPressureApproachSpeed,
  getPressureAttackCooldown,
  getPressureDuration,
  getPressureMaxRange,
  PRESSURE_AGGRESSION_THRESHOLD,
  shouldEnterPressure,
  shouldExitPressure,
  shouldPressurePreferLunge,
  shouldPressureReSwing,
} from './aiPressure';

test('shouldEnterPressure requires aggression, living uninvuln target', () => {
  assert.equal(
    shouldEnterPressure({
      pressureAggression: PRESSURE_AGGRESSION_THRESHOLD - 1,
      targetHp: 1,
      targetInvuln: 0,
    }),
    false
  );
  assert.equal(
    shouldEnterPressure({
      pressureAggression: 50,
      targetHp: 0,
      targetInvuln: 0,
    }),
    false
  );
  assert.equal(
    shouldEnterPressure({
      pressureAggression: 50,
      targetHp: 1,
      targetInvuln: 1,
    }),
    false
  );
  assert.equal(
    shouldEnterPressure({
      pressureAggression: 50,
      targetHp: 1,
      targetInvuln: 0,
    }),
    true
  );
});

test('pressure duration and approach scale with aggression', () => {
  assert.equal(getPressureDuration(0), 1.4);
  assert.equal(getPressureDuration(100), 3.2);
  assert.ok(getPressureApproachSpeed(100) > getPressureApproachSpeed(25));
});

test('pressure attack cooldown is shorter than base', () => {
  const base = 1.1;
  assert.ok(getPressureAttackCooldown(100, base) < base);
  assert.ok(getPressureAttackCooldown(25, base) < base);
});

test('shouldExitPressure on lock break, death, invuln, timer, or range', () => {
  const base = {
    targetHp: 1,
    targetInvuln: 0,
    distanceToTarget: 5,
    maxPressureRange: 12,
    timerRemaining: 1,
    targetMatchesLock: true,
  };
  assert.equal(shouldExitPressure({ ...base, targetMatchesLock: false }), true);
  assert.equal(shouldExitPressure({ ...base, targetHp: 0 }), true);
  assert.equal(shouldExitPressure({ ...base, targetInvuln: 2 }), true);
  assert.equal(shouldExitPressure({ ...base, timerRemaining: 0 }), true);
  assert.equal(shouldExitPressure({ ...base, distanceToTarget: 20 }), true);
  assert.equal(shouldExitPressure(base), false);
});

test('getPressureMaxRange extends beyond melee reach', () => {
  assert.equal(getPressureMaxRange(4, 14), 16);
});

test('pressure weapon preference favors lunge in sword range or re-swing in reach', () => {
  const attackBase = {
    activeWeapon: 'sword' as const,
    distanceToTarget: 10,
    aiReach: 4,
    minLungeRange: 3,
    maxLungeRange: 14,
    weaponReady: true,
    targetProtected: false,
  };
  assert.equal(shouldPressurePreferLunge(attackBase), true);
  assert.equal(shouldPressureReSwing(attackBase), false);

  const hammerClose = { ...attackBase, activeWeapon: 'hammer' as const, distanceToTarget: 3.5 };
  assert.equal(shouldPressurePreferLunge(hammerClose), false);
  assert.equal(shouldPressureReSwing(hammerClose), true);
});
