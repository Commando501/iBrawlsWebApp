import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROACH_FEINT_BACK_TIMER,
  canAttemptChargeAbortFeint,
  canAttemptLungeFakeout,
  canAttemptWeaponSwapFeint,
  getApproachFeintWindow,
  getEffectiveFeintChance,
  getPlayerFeintMultiplier,
  isFeintEligible,
  rollFeintAttempt,
  rollFeintCooldownDuration,
} from './aiFeints';
import {
  createPlayerModel,
  observePlayerCounter,
  toPlayerModelSnapshot,
} from './aiPlayerModel';

test('isFeintEligible requires positive feint chance and zero cooldown', () => {
  assert.equal(isFeintEligible({ feintChance: 0, feintCooldownRemaining: 0 }), false);
  assert.equal(isFeintEligible({ feintChance: 40, feintCooldownRemaining: 0.1 }), false);
  assert.equal(isFeintEligible({ feintChance: 40, feintCooldownRemaining: 0 }), true);
});

test('rollFeintAttempt respects cooldown and rng threshold', () => {
  assert.equal(
    rollFeintAttempt({ feintChance: 50, feintCooldownRemaining: 1, rng: 0 }),
    false,
  );
  assert.equal(
    rollFeintAttempt({ feintChance: 50, feintCooldownRemaining: 0, rng: 0.6 }),
    false,
  );
  assert.equal(
    rollFeintAttempt({ feintChance: 50, feintCooldownRemaining: 0, rng: 0.4 }),
    true,
  );
});

test('getEffectiveFeintChance scales with player model counter rate', () => {
  const model = createPlayerModel();
  for (let i = 0; i < 12; i += 1) {
    observePlayerCounter(model, true);
  }
  const snapshot = toPlayerModelSnapshot(model);
  const multiplier = getPlayerFeintMultiplier(snapshot);
  assert.ok(multiplier < 1);
  assert.ok(
    getEffectiveFeintChance({ feintChance: 50, feintCooldownRemaining: 0, playerModelMultiplier: multiplier }) <
      getEffectiveFeintChance({ feintChance: 50, feintCooldownRemaining: 0, playerModelMultiplier: 1 }),
  );
});

test('rollFeintCooldownDuration stays within 3–5 seconds', () => {
  assert.equal(rollFeintCooldownDuration(0), 3);
  assert.equal(rollFeintCooldownDuration(1), 5);
  assert.ok(rollFeintCooldownDuration(0.5) >= 3 && rollFeintCooldownDuration(0.5) <= 5);
});

test('getApproachFeintWindow opens early and mid forward dance windows', () => {
  assert.equal(
    getApproachFeintWindow({ timerRemaining: 0.5, targetProtected: false, feintEligible: true }),
    0.42,
  );
  assert.equal(
    getApproachFeintWindow({ timerRemaining: 0.2, targetProtected: false, feintEligible: true }),
    0.62,
  );
  assert.equal(
    getApproachFeintWindow({ timerRemaining: 0.08, targetProtected: false, feintEligible: true }),
    null,
  );
  assert.equal(
    getApproachFeintWindow({ timerRemaining: 0.5, targetProtected: true, feintEligible: true }),
    null,
  );
});

test('weapon swap feint only when hammer is ready in lunge band', () => {
  const base = {
    activeWeapon: 'hammer' as const,
    weaponReady: true,
    swapLockoutRemaining: 0,
    distanceToTarget: 10,
    minLungeRange: 8,
    maxLungeRange: 14,
    swapFeintActive: false,
    state: 'APPROACHING',
    feintEligible: true,
  };
  assert.equal(canAttemptWeaponSwapFeint(base), true);
  assert.equal(canAttemptWeaponSwapFeint({ ...base, activeWeapon: 'sword' }), false);
  assert.equal(canAttemptWeaponSwapFeint({ ...base, distanceToTarget: 20 }), false);
  assert.equal(canAttemptWeaponSwapFeint({ ...base, state: 'COOLDOWN' }), false);
});

test('charge abort feint requires target swing commitment', () => {
  assert.equal(
    canAttemptChargeAbortFeint({
      targetWeaponState: 'swing_up',
      dashCooldownRemaining: 0,
      targetProtected: false,
      feintEligible: true,
    }),
    true,
  );
  assert.equal(
    canAttemptChargeAbortFeint({
      targetWeaponState: 'ready',
      dashCooldownRemaining: 0,
      targetProtected: false,
      feintEligible: true,
    }),
    false,
  );
});

test('lunge fakeout requires sword in range', () => {
  assert.equal(
    canAttemptLungeFakeout({
      activeWeapon: 'sword',
      weaponReady: true,
      inLungeRange: true,
      targetProtected: false,
      feintEligible: true,
    }),
    true,
  );
  assert.equal(
    canAttemptLungeFakeout({
      activeWeapon: 'hammer',
      weaponReady: true,
      inLungeRange: true,
      targetProtected: false,
      feintEligible: true,
    }),
    false,
  );
});

test('APPROACH_FEINT_BACK_TIMER matches feint retreat duration', () => {
  assert.ok(APPROACH_FEINT_BACK_TIMER >= 0.4 && APPROACH_FEINT_BACK_TIMER <= 0.7);
});
