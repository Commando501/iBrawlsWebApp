import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatchAggression,
  deriveAIParams,
  deriveFeintChance,
  deriveMatchStateMultipliers,
  deriveSpatialIQ,
  getEffectiveWeaponSwapIQ,
  NEUTRAL_MATCH_MULTIPLIERS,
  shouldAvoidCoinFlipTrade,
} from './aiTuning';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

test('deriveSpatialIQ blends movement complexity and anticipation', () => {
  assert.equal(deriveSpatialIQ(80, 0.7), 76);
  assert.equal(deriveSpatialIQ(0, 0), 0);
  assert.equal(deriveSpatialIQ(100, 1), 100);
});

test('deriveFeintChance is gated below Hard and custom IQ 60', () => {
  assert.equal(deriveFeintChance(80, 0.7, 'normal', 50), 0);
  assert.equal(deriveFeintChance(80, 0.7, 'easy', 95), 0);
  assert.equal(deriveFeintChance(80, 0.7, 'custom', 59), 0);
  assert.equal(deriveFeintChance(80, 0.7, 'custom', 60), 46);
  assert.equal(deriveFeintChance(80, 0.7, 'hard', 50), 46);
});

test('deriveAIParams applies custom overrides when set', () => {
  const knobs = {
    difficulty: 'custom',
    reactionLatency: 0.12,
    anticipationFactor: 0.7,
    movementComplexity: 80,
    weaponSwapIQ: 80,
    aiPlaystyle: 50,
    weaponPrioritization: 50,
  };

  const derived = deriveAIParams(
    {
      ...DEFAULT_ADMIN_SETTINGS,
      aiSpatialIQ: 88,
      aiFeintChance: 12,
      aiPressureAggression: 95,
    },
    knobs
  );

  assert.equal(derived.spatialIQ, 88);
  assert.equal(derived.feintChance, 12);
  assert.equal(derived.pressureAggression, 95);
  assert.equal(derived.mechanicAware, true);
});

test('deriveMatchStateMultipliers lowers aggression when ahead by 5+', () => {
  const mult = deriveMatchStateMultipliers(
    { scorePlayer: 2, scoreEnemy: 8 },
    0.7
  );

  assert.equal(mult.aggressionMult, 0.72);
  assert.equal(mult.avoidCoinFlipTrades, true);
  assert.ok(mult.cooldownMult > 1);
});

test('deriveMatchStateMultipliers raises aggression when behind by 5+', () => {
  const mult = deriveMatchStateMultipliers(
    { scorePlayer: 10, scoreEnemy: 3 },
    0.7
  );

  assert.equal(mult.aggressionMult, 1.28);
  assert.ok(mult.spacingMult < 1);
});

test('deriveMatchStateMultipliers boosts IQ gate in close matches', () => {
  const mult = deriveMatchStateMultipliers(
    { scorePlayer: 11, scoreEnemy: 12 },
    0.5
  );

  assert.equal(mult.iqGateBonus, 15);
  assert.equal(mult.aggressionMult, 1);
});

test('deriveMatchStateMultipliers applies match-point commit for aggressive bots', () => {
  const mult = deriveMatchStateMultipliers(
    { scorePlayer: 20, scoreEnemy: 24, killsToWin: 25 },
    0.75
  );

  assert.ok(mult.matchPointCommitBias > 1);
  assert.ok(mult.aggressionMult > 1);
});

test('deriveMatchStateMultipliers applies match-point patience for passive bots', () => {
  const mult = deriveMatchStateMultipliers(
    { scorePlayer: 20, scoreEnemy: 24, killsToWin: 25 },
    0.3
  );

  assert.ok(mult.matchPointCommitBias < 1);
  assert.equal(mult.avoidCoinFlipTrades, true);
});

test('shouldAvoidCoinFlipTrade respects lead-protection flag', () => {
  assert.equal(
    shouldAvoidCoinFlipTrade({
      difficulty: 'hard',
      playstyleFactor: 0.9,
      botHP: 1,
      targetHP: 1,
      multipliers: { ...NEUTRAL_MATCH_MULTIPLIERS, avoidCoinFlipTrades: true },
    }),
    true
  );
});

test('getEffectiveWeaponSwapIQ adds close-match and match-point bonuses', () => {
  const close = getEffectiveWeaponSwapIQ(70, {
    ...NEUTRAL_MATCH_MULTIPLIERS,
    iqGateBonus: 15,
    matchPointCommitBias: 1.35,
  });

  assert.equal(close, 92);
});

test('applyMatchAggression scales and clamps pressure aggression', () => {
  assert.equal(
    applyMatchAggression(80, { ...NEUTRAL_MATCH_MULTIPLIERS, aggressionMult: 1.28 }),
    100
  );
  assert.equal(
    applyMatchAggression(80, { ...NEUTRAL_MATCH_MULTIPLIERS, aggressionMult: 0.72 }),
    58
  );
});

test('deriveAIParams falls back to derived values without overrides', () => {
  const derived = deriveAIParams(DEFAULT_ADMIN_SETTINGS, {
    difficulty: 'normal',
    reactionLatency: 0.25,
    anticipationFactor: 0.4,
    movementComplexity: 50,
    weaponSwapIQ: 50,
    aiPlaystyle: 75,
    weaponPrioritization: 50,
  });

  assert.equal(derived.spatialIQ, 46);
  assert.equal(derived.feintChance, 0);
  assert.equal(derived.pressureAggression, 75);
  assert.equal(derived.mechanicAware, false);
});
