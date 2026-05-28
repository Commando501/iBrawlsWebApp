import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_ARCHETYPES,
  applyArchetypeToSettings,
  applyPersonalityKnobs,
  getPersonalityFlags,
  pickRandomArchetype,
  playstyleToBehavior,
  resolveDerivedAIParams,
} from './aiPersonalities';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

test('each archetype defines knob overrides and flags', () => {
  assert.equal(AI_ARCHETYPES.length, 6);
  for (const archetype of AI_ARCHETYPES) {
    assert.ok(archetype.knobOverrides.aiPlaystyle !== undefined);
    assert.ok(archetype.flags.spacingBand > 0);
  }
});

test('applyPersonalityKnobs overrides base knobs for zoner', () => {
  const merged = applyPersonalityKnobs(
    {
      difficulty: 'hard',
      reactionLatency: 0.12,
      anticipationFactor: 0.7,
      movementComplexity: 80,
      weaponSwapIQ: 80,
      aiPlaystyle: 50,
      weaponPrioritization: 50,
    },
    'zoner'
  );

  assert.equal(merged.aiPlaystyle, 28);
  assert.equal(merged.weaponPrioritization, 82);
  assert.equal(merged.movementComplexity, 78);
});

test('counter-fighter skips pressure and widens spacing', () => {
  const flags = getPersonalityFlags('counter_fighter');
  assert.equal(flags.skipPressure, true);
  assert.ok(flags.spacingBand > 1);
});

test('mixup artist boosts feint chance via resolveDerivedAIParams', () => {
  const knobs = {
    difficulty: 'hard',
    reactionLatency: 0.12,
    anticipationFactor: 0.7,
    movementComplexity: 80,
    weaponSwapIQ: 80,
    aiPlaystyle: 58,
    weaponPrioritization: 50,
  };

  const base = resolveDerivedAIParams(DEFAULT_ADMIN_SETTINGS, knobs, 'none');
  const mixup = resolveDerivedAIParams(DEFAULT_ADMIN_SETTINGS, knobs, 'mixup_artist');

  assert.ok(mixup.feintChance > base.feintChance);
});

test('applyArchetypeToSettings writes tuning and archetype id', () => {
  const updated = applyArchetypeToSettings(DEFAULT_ADMIN_SETTINGS, 'berserker');
  assert.equal(updated.aiArchetype, 'berserker');
  assert.equal(updated.aiPlaystyle, 95);
  assert.equal(updated.aiWeaponPrioritization, 22);
});

test('playstyleToBehavior maps archetype playstyles', () => {
  assert.equal(playstyleToBehavior(10), 'passive');
  assert.equal(playstyleToBehavior(50), 'defensive');
  assert.equal(playstyleToBehavior(95), 'aggressive');
});

test('pickRandomArchetype returns a valid archetype id', () => {
  const id = pickRandomArchetype();
  assert.ok(AI_ARCHETYPES.some((a) => a.id === id));
});
