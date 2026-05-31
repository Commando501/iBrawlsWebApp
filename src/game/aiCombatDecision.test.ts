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

test('incoming lunge avoids sword coin-flip when protecting a large lead', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    currentWeapon: 'sword',
    distanceToTarget: 4.5,
    combatDistanceToTarget: 4.5,
    canUseHammerCounter: false,
    target: {
      ...baseInput.target,
      isLunging: true,
    },
    matchMultipliers: {
      aggressionMult: 0.72,
      cooldownMult: 1.25,
      spacingMult: 1.2,
      iqGateBonus: 0,
      avoidCoinFlipTrades: true,
      matchPointCommitBias: 1,
      pressureDurationMult: 0.85,
    },
  });

  assert.equal(decision.postMissSpacing, true);
  assert.equal(decision.bulltrueCounter, null);
});

test('close match score boosts weapon swap IQ gate pass rate', () => {
  const neutral = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 60,
    random: () => 0.75,
  });
  const close = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 60,
    random: () => 0.75,
    matchMultipliers: {
      aggressionMult: 1,
      cooldownMult: 1,
      spacingMult: 1,
      iqGateBonus: 15,
      avoidCoinFlipTrades: false,
      matchPointCommitBias: 1,
      pressureDurationMult: 1,
    },
  });

  assert.equal(neutral.weapon, null);
  assert.notEqual(close.weapon, null);
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

test('weapon prioritization of 0 (100% Hammer) immediately swaps to hammer at any distance, bypassing IQ random gates', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 0,
    currentWeapon: 'sword',
    distanceToTarget: 25.0,
    combatDistanceToTarget: 25.0,
    random: () => 0.99, // Fails random IQ gate
  });

  assert.equal(decision.weapon, 'hammer');
  assert.equal(decision.bypassedRandomGate, true);
});

test('weapon prioritization of 100 (100% Sword) immediately swaps to sword at any distance, bypassing IQ random gates', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponPrioritization: 100,
    currentWeapon: 'hammer',
    distanceToTarget: 25.0,
    combatDistanceToTarget: 25.0,
    random: () => 0.99, // Fails random IQ gate
  });

  assert.equal(decision.weapon, 'sword');
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

test('dash lockout in lunge range commits sword and bypasses random gate', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    target: {
      ...baseInput.target,
      dashCooldownRemaining: 1.5,
      swapLockoutRemaining: 0,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'sword');
  assert.equal(decision.bypassedRandomGate, true);
});

test('hammer weapon with swap lockout chooses safe hammer close', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    distanceToTarget: 4.5,
    combatDistanceToTarget: 4.5,
    target: {
      ...baseInput.target,
      activeWeapon: 'hammer',
      dashCooldownRemaining: 0,
      swapLockoutRemaining: 1.2,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'hammer');
  assert.equal(decision.bypassedRandomGate, true);
});

test('sword weapon with swap lockout commits sword lunge punish', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    target: {
      ...baseInput.target,
      activeWeapon: 'sword',
      dashCooldownRemaining: 0,
      swapLockoutRemaining: 1.2,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'sword');
  assert.equal(decision.bypassedRandomGate, true);
});

test('opponent lockout punish window does not apply on normal difficulty', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    difficulty: 'normal',
    weaponSwapIQ: 50,
    target: {
      ...baseInput.target,
      dashCooldownRemaining: 2.0,
      swapLockoutRemaining: 2.0,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, null);
  assert.equal(decision.bypassedRandomGate, false);
});

test('player model steers sword choice toward learned lunge distance', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    swordLungeDistance: 14.5,
    distanceToTarget: 10.5,
    combatDistanceToTarget: 10.5,
    playerModel: {
      avgLungeDistance: 10.5,
      lungeFrequency: 0.7,
      dodgeBiasX: 0,
      dodgeBiasZ: 0,
      counterRate: 0.15,
      approachSpeed: 0.7,
      edgeProximity: 0.3,
      reactionTime: 0.3,
      sampleCount: 12,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'sword');
});

test('player model prefers hammer against counter-heavy opponents', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    distanceToTarget: 8.0,
    combatDistanceToTarget: 8.0,
    playerModel: {
      avgLungeDistance: 8.0,
      lungeFrequency: 0.5,
      dodgeBiasX: 0,
      dodgeBiasZ: 0,
      counterRate: 0.75,
      approachSpeed: 0.5,
      edgeProximity: 0.3,
      reactionTime: 0.3,
      sampleCount: 15,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'hammer');
});

test('player model bait hammer at learned lunge distance when opponent lunges often', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    swordLungeDistance: 14.5,
    distanceToTarget: 9.2,
    combatDistanceToTarget: 9.2,
    playerModel: {
      avgLungeDistance: 9.5,
      lungeFrequency: 0.8,
      dodgeBiasX: 0,
      dodgeBiasZ: 0,
      counterRate: 0.45,
      approachSpeed: 0.4,
      edgeProximity: 0.3,
      reactionTime: 0.3,
      sampleCount: 20,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, 'hammer');
});

test('dash lockout punish is skipped when target is invulnerable', () => {
  const decision = evaluateAICombatDecision({
    ...baseInput,
    weaponSwapIQ: 10,
    target: {
      ...baseInput.target,
      dashCooldownRemaining: 2.0,
      invulnerabilityTimer: 1.5,
    },
    random: () => 0.99,
  });

  assert.equal(decision.weapon, null);
  assert.equal(decision.bypassedRandomGate, false);
});
