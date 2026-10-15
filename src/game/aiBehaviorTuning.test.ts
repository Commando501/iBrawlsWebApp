import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AI_TUNE_SETTING_KEYS,
  DEFAULT_AI_BEHAVIOR_TUNING,
  resolveBehaviorTuning,
  type AIBehaviorTuning,
} from './aiBehaviorTuning';
import type { UniversalSettings } from '../types';
import { rollFeintCooldownDuration } from './aiFeints';
import { deriveMatchStateMultipliers } from './aiTuning';

test('resolveBehaviorTuning returns defaults when no settings provided', () => {
  assert.deepEqual(resolveBehaviorTuning(undefined), DEFAULT_AI_BEHAVIOR_TUNING);
  assert.deepEqual(resolveBehaviorTuning({}), DEFAULT_AI_BEHAVIOR_TUNING);
});

test('resolveBehaviorTuning overlays a single override and leaves others at default', () => {
  const resolved = resolveBehaviorTuning({ aiTuneSprintEngageGap: 9.5 });
  assert.equal(resolved.sprintEngageGap, 9.5);
  assert.equal(resolved.slideMaxGap, DEFAULT_AI_BEHAVIOR_TUNING.slideMaxGap);
});

test('resolveBehaviorTuning ignores non-finite / non-number overrides', () => {
  const resolved = resolveBehaviorTuning({
    aiTuneMechanicAwareIq: Number.NaN,
    aiTuneFeintCooldownMin: undefined,
  } as Partial<UniversalSettings>);
  assert.equal(resolved.mechanicAwareIq, DEFAULT_AI_BEHAVIOR_TUNING.mechanicAwareIq);
  assert.equal(resolved.feintCooldownMin, DEFAULT_AI_BEHAVIOR_TUNING.feintCooldownMin);
});

test('every tuning field has a unique settings key', () => {
  const fields = Object.keys(AI_TUNE_SETTING_KEYS) as (keyof AIBehaviorTuning)[];
  const tuningFields = Object.keys(DEFAULT_AI_BEHAVIOR_TUNING) as (keyof AIBehaviorTuning)[];
  assert.deepEqual(new Set(fields), new Set(tuningFields), 'key map and defaults must cover the same fields');

  const settingKeys = Object.values(AI_TUNE_SETTING_KEYS);
  assert.equal(new Set(settingKeys).size, settingKeys.length, 'settings keys must be unique');
});

test('every override key applies', () => {
  const fields = Object.keys(AI_TUNE_SETTING_KEYS) as (keyof AIBehaviorTuning)[];
  for (const field of fields) {
    const settingKey = AI_TUNE_SETTING_KEYS[field];
    const sentinel = 123.456;
    const resolved = resolveBehaviorTuning({ [settingKey]: sentinel } as Partial<UniversalSettings>);
    assert.equal(resolved[field], sentinel, `override ${settingKey} should set ${field}`);
  }
});

test('tuning resolution observes edited and removed overrides without sharing results', () => {
  const settings: Partial<UniversalSettings> = {};
  for (const [field, key] of Object.entries(AI_TUNE_SETTING_KEYS) as [keyof AIBehaviorTuning, keyof UniversalSettings][]) {
    Object.assign(settings, { [key]: 123.456 });
    const first = resolveBehaviorTuning(settings);
    assert.equal(first[field], 123.456);
    first[field] = -999;
    assert.equal(resolveBehaviorTuning(settings)[field], 123.456, 'callers own their resolved object');
    Object.assign(settings, { [key]: 0 });
    assert.equal(resolveBehaviorTuning(settings)[field], 0, 'zero is a valid live override');
    for (const invalid of [NaN, Infinity, -Infinity, '4', null, undefined]) {
      Object.assign(settings, { [key]: invalid });
      assert.equal(resolveBehaviorTuning(settings)[field], DEFAULT_AI_BEHAVIOR_TUNING[field]);
    }
    delete settings[key];
    assert.deepEqual(resolveBehaviorTuning(settings), DEFAULT_AI_BEHAVIOR_TUNING);
  }
});

test('resolved overrides change downstream module behavior', () => {
  // Feint cooldown duration honors min/max overrides (rng=0 -> returns min).
  const t = resolveBehaviorTuning({ aiTuneFeintCooldownMin: 12, aiTuneFeintCooldownMax: 20 });
  assert.equal(rollFeintCooldownDuration(0, t.feintCooldownMin, t.feintCooldownMax), 12);

  // Score-ahead threshold gates the lead-protection multiplier branch.
  const ctx = { scorePlayer: 0, scoreEnemy: 3 };
  const neutral = deriveMatchStateMultipliers(ctx, 0.5, { aheadThreshold: 5 });
  assert.equal(neutral.avoidCoinFlipTrades, false, 'gap of 3 < threshold 5 stays neutral');
  const triggered = deriveMatchStateMultipliers(ctx, 0.5, { aheadThreshold: 2 });
  assert.equal(triggered.avoidCoinFlipTrades, true, 'lowering threshold to 2 trips lead behavior');
});
