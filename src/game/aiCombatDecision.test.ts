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
