import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_COMBO_DEFINITIONS,
  COMBO_ADVANCED_WEAPON_SWAP_IQ,
  COMBO_MIN_WEAPON_SWAP_IQ,
  canUseWeaponCombos,
  createBotComboState,
  isComboCompatible,
  notifyComboAttackStarted,
  pickComboOnHit,
  pickOpeningCombo,
  progressComboState,
  shouldAbortCombo,
} from './aiComboEngine';

test('canUseWeaponCombos gates easy and low IQ', () => {
  assert.equal(canUseWeaponCombos('easy', 95), false);
  assert.equal(canUseWeaponCombos('hard', COMBO_MIN_WEAPON_SWAP_IQ - 1), false);
  assert.equal(canUseWeaponCombos('hard', COMBO_MIN_WEAPON_SWAP_IQ), true);
});

test('isComboCompatible respects weapon prioritization extremes', () => {
  assert.equal(isComboCompatible('mixup', 0), false);
  assert.equal(isComboCompatible('mixup', 50), true);
  assert.equal(isComboCompatible('safe_finish', 100), true);
  assert.equal(isComboCompatible('double_tap', 100), false);
});

test('pickComboOnHit selects hammer follow-ups and sword double tap', () => {
  const hammerCombo = pickComboOnHit({
    difficulty: 'hard',
    weaponSwapIQ: 80,
    weaponPrioritization: 50,
    openingWeapon: 'hammer',
    distanceToTarget: 10,
    minLungeRange: 6,
    maxLungeRange: 14,
    targetRecovering: false,
    random: () => 0.01,
  });
  assert.ok(hammerCombo === 'mixup' || hammerCombo === 'safe_finish' || hammerCombo === 'bait_smash');

  const swordCombo = pickComboOnHit({
    difficulty: 'nightmare',
    weaponSwapIQ: 85,
    weaponPrioritization: 60,
    openingWeapon: 'sword',
    distanceToTarget: 4,
    minLungeRange: 6,
    maxLungeRange: 14,
    targetRecovering: true,
    random: () => 0.01,
  });
  assert.equal(swordCombo, 'double_tap');
});

test('pickOpeningCombo requires advanced IQ and mid range', () => {
  assert.equal(
    pickOpeningCombo({
      difficulty: 'hard',
      weaponSwapIQ: COMBO_ADVANCED_WEAPON_SWAP_IQ - 1,
      weaponPrioritization: 50,
      distanceToTarget: 10,
      minLungeRange: 6,
      maxLungeRange: 14,
      targetRecovering: false,
      random: () => 0,
    }),
    null
  );
  assert.equal(
    pickOpeningCombo({
      difficulty: 'hard',
      weaponSwapIQ: 95,
      weaponPrioritization: 50,
      distanceToTarget: 10,
      minLungeRange: 6,
      maxLungeRange: 14,
      targetRecovering: false,
      random: () => 0,
    }),
    'bait_smash'
  );
});

test('progressComboState walks mixup swap and attack steps', () => {
  let state = createBotComboState('mixup', 'player');

  let result = progressComboState({
    state,
    activeWeapon: 'hammer',
    weaponReady: true,
    swapLockoutRemaining: 0,
    swapFeintActive: false,
    distanceToTarget: 10,
    minLungeRange: 6,
    maxLungeRange: 14,
    inMeleeRange: false,
    dt: 0.016,
  });
  assert.equal(result.command.kind, 'swap');
  assert.equal(result.command.weapon, 'sword');
  state = result.state!;

  result = progressComboState({
    state,
    activeWeapon: 'sword',
    weaponReady: true,
    swapLockoutRemaining: 1,
    swapFeintActive: false,
    distanceToTarget: 10,
    minLungeRange: 6,
    maxLungeRange: 14,
    inMeleeRange: false,
    dt: 0.016,
  });
  assert.equal(result.command.kind, 'wait');

  result = progressComboState({
    state,
    activeWeapon: 'sword',
    weaponReady: true,
    swapLockoutRemaining: 0,
    swapFeintActive: false,
    distanceToTarget: 10,
    minLungeRange: 6,
    maxLungeRange: 14,
    inMeleeRange: false,
    dt: 0.016,
  });
  assert.equal(result.command.kind, 'attack');
  assert.equal(result.command.preferLunge, true);
  assert.equal(result.state?.stepIndex, 2);

  const finished = notifyComboAttackStarted(result.state!);
  assert.equal(finished, null);
});

test('shouldAbortCombo on target change, death, invuln, or commit', () => {
  const base = {
    targetId: 'player',
    targetHp: 1,
    targetInvuln: 0,
    targetIsLunging: false,
    targetWeaponState: 'ready',
    lockedTargetId: 'player',
    targetCommitted: false,
  };
  assert.equal(shouldAbortCombo({ ...base, targetId: 'main_ai' }), true);
  assert.equal(shouldAbortCombo({ ...base, targetHp: 0 }), true);
  assert.equal(shouldAbortCombo({ ...base, targetInvuln: 2 }), true);
  assert.equal(
    shouldAbortCombo({
      ...base,
      abortOnTargetCommit: true,
      targetCommitted: true,
      targetWeaponState: 'swing_up',
    }),
    true
  );
  assert.equal(shouldAbortCombo(base), false);
});
