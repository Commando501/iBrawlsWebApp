import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAICombatDecision } from './aiCombatDecision';

const baseInput = {
  difficulty: 'hard',
  weaponSwapIQ: 80,
  currentWeapon: 'sword' as const,
  botHP: 1,
  botMaxHP: 1,
  distanceToTarget: 7.5,
  combatDistanceToTarget: 7.5,
  nearbyEnemiesCount: 0,
  target: {
    id: 'player',
    hp: 1,
    activeWeapon: 'sword' as const,
    weaponState: 'ready',
    isLunging: false,
    invulnerabilityTimer: 0,
  },
  attackRange: 3.7,
  attackRadius: 2.1,
  swordLungeDistance: 8.0,
  swordLungeSpeed: 16.0,
  swordTradeWindowMs: 350,
  canStartWeaponAction: true,
  weaponState: 'ready',
  weaponPrioritization: 50,
  random: () => 0.99,
};

test('recent missed lunge against a close one-HP target chooses hammer', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    recentLungeMemory: {
      outcome: 'miss_timeout',
      targetId: 'player',
      timeRemaining: 1.0,
    },
  });

  assert.equal(decision.weapon, 'hammer');
  assert.equal(decision.postMissSpacing, true);
  assert.equal(decision.bypassedRandomGate, true);
});

test('incoming sword lunge with hammer counter timing chooses hammer', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    currentWeapon: 'hammer',
    distanceToTarget: 6.0,
    combatDistanceToTarget: 6.0,
    target: {
      ...baseInput.target,
      isLunging: true,
    },
  });

  assert.equal(decision.weapon, 'hammer');
  assert.equal(decision.bulltrueCounter, 'hammer');
});

test('incoming sword lunge uses sword counter when hammer is unavailable', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    distanceToTarget: 3.2,
    combatDistanceToTarget: 3.2,
    target: {
      ...baseInput.target,
      isLunging: true,
    },
    canUseHammerCounter: false,
  });

  assert.equal(decision.weapon, 'sword');
  assert.equal(decision.bulltrueCounter, 'sword');
});

test('normal difficulty does not bypass the weapon-swap random gate', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    difficulty: 'normal',
    weaponSwapIQ: 50,
    recentLungeMemory: {
      outcome: 'miss_timeout',
      targetId: 'player',
      timeRemaining: 1.0,
    },
  });

  assert.equal(decision.weapon, null);
  assert.equal(decision.bypassedRandomGate, false);
});

test('high-IQ custom preset gets mechanic-aware tactical overrides', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    difficulty: 'custom',
    weaponSwapIQ: 90,
    recentLungeMemory: {
      outcome: 'miss_arena',
      targetId: 'player',
      timeRemaining: 1.0,
    },
  });

  assert.equal(decision.weapon, 'hammer');
  assert.equal(decision.bypassedRandomGate, true);
});

test('weapon prioritization of 0 (100% Hammer) always chooses hammer in close combat', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 0,
    distanceToTarget: 2.0,
    combatDistanceToTarget: 2.0,
    random: () => 0.0, // Should still choose hammer
  });

  assert.equal(decision.weapon, 'hammer');
});

test('weapon prioritization of 100 (100% Sword) always chooses sword in close combat', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 100,
    distanceToTarget: 2.0,
    combatDistanceToTarget: 2.0,
    random: () => 0.0, // Should still choose sword
  });

  assert.equal(decision.weapon, 'sword');
});

test('weapon prioritization 0 (100% Hammer) blocks sword counter even when target is lunging', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 0,
    currentWeapon: 'sword',
    distanceToTarget: 3.2,
    combatDistanceToTarget: 3.2,
    target: {
      ...baseInput.target,
      isLunging: true,
    },
    canUseHammerCounter: false,
    random: () => 0.0,
  });

  // Should NOT choose sword since sword is forbidden at prioritization 0
  assert.notEqual(decision.weapon, 'sword');
});

test('weapon prioritization 100 (100% Sword) overrides hammer in target-lunging fallback', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 100,
    distanceToTarget: 7.5,
    combatDistanceToTarget: 7.5,
    target: {
      ...baseInput.target,
      isLunging: true,
    },
    random: () => 0.5,
  });

  // Should choose sword instead of hammer since hammer is forbidden at prioritization 100
  assert.equal(decision.weapon, 'sword');
});

test('weapon prioritization 100 (100% Sword) overrides hammer when target is protected', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 100,
    target: {
      ...baseInput.target,
      invulnerabilityTimer: 2.0,
    },
    random: () => 0.0,
  });

  assert.equal(decision.weapon, 'sword');
});
