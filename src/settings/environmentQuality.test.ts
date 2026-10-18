import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_QUALITY_STORAGE_KEY,
  getEnvironmentQualityPreference,
  getEnvironmentQualityProfile,
  normalizeEnvironmentQualityPreference,
  resolveEnvironmentQualityTier,
  setEnvironmentQualityPreference,
} from './environmentQuality';

test('environment quality accepts supported preferences and safely resets unknown saved values to auto', () => {
  for (const value of ['auto', 'high', 'balanced', 'low'] as const) {
    assert.equal(normalizeEnvironmentQualityPreference(value), value);
  }
  for (const value of [null, undefined, '', 'ultra', 'HIGH', {}, 0]) {
    assert.equal(normalizeEnvironmentQualityPreference(value), 'auto');
  }
});

test('environment quality persists separately from match rules and reads it back', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  assert.equal(getEnvironmentQualityPreference(storage), 'auto');
  assert.equal(setEnvironmentQualityPreference('balanced', storage), true);
  assert.equal(getEnvironmentQualityPreference(storage), 'balanced');
  assert.deepEqual([...values], [[ENVIRONMENT_QUALITY_STORAGE_KEY, 'balanced']]);
  assert.equal(setEnvironmentQualityPreference('auto', storage), true);
  assert.equal(getEnvironmentQualityPreference(storage), 'auto');
});

test('missing or denied storage does not crash startup or claim a preference was saved', () => {
  const denied = {
    getItem: () => { throw new Error('Storage denied'); },
    setItem: () => { throw new Error('Storage denied'); },
  };
  assert.equal(getEnvironmentQualityPreference(null), 'auto');
  assert.equal(getEnvironmentQualityPreference(denied), 'auto');
  assert.equal(setEnvironmentQualityPreference('high', null), false);
  assert.equal(setEnvironmentQualityPreference('high', denied), false);
});

test('failed persistence keeps the previous preference available for the next match', () => {
  const storage = {
    getItem: () => 'low',
    setItem: () => { throw new Error('Storage quota exceeded'); },
  };
  assert.equal(setEnvironmentQualityPreference('high', storage), false);
  assert.equal(getEnvironmentQualityPreference(storage), 'low');
});

test('auto uses high for desktop, balanced for limited desktop hardware, and low for mobile', () => {
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: 16, deviceMemoryGb: 8 }), 'high');
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: 4, deviceMemoryGb: 8 }), 'balanced');
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: 12, deviceMemoryGb: 4 }), 'balanced');
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: 2, deviceMemoryGb: 8 }), 'low');
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: 12, deviceMemoryGb: 2 }), 'low');
  assert.equal(resolveEnvironmentQualityTier('auto', { isMobile: true, hardwareConcurrency: 16, deviceMemoryGb: 8 }), 'low');
  assert.equal(resolveEnvironmentQualityTier('auto'), 'high');
  assert.equal(resolveEnvironmentQualityTier('auto', { hardwareConcurrency: NaN, deviceMemoryGb: 0 }), 'high');
});

test('explicit environment preferences override device heuristics', () => {
  assert.equal(resolveEnvironmentQualityTier('high', { isMobile: true, hardwareConcurrency: 2 }), 'high');
  assert.equal(resolveEnvironmentQualityTier('low', { isMobile: false, hardwareConcurrency: 32, deviceMemoryGb: 8 }), 'low');
  assert.equal(resolveEnvironmentQualityTier('balanced', { isMobile: true }), 'balanced');
});

test('fallback profiles reduce rendering and scenery costs without changing match or model rules', () => {
  const high = getEnvironmentQualityProfile('high');
  const balanced = getEnvironmentQualityProfile('balanced');
  const low = getEnvironmentQualityProfile('low');
  assert.ok(high.pixelRatioCap > balanced.pixelRatioCap && balanced.pixelRatioCap > low.pixelRatioCap);
  assert.ok(high.shadowMapSize > balanced.shadowMapSize && balanced.shadowMapSize > low.shadowMapSize);
  assert.ok(high.seatStride < balanced.seatStride && balanced.seatStride < low.seatStride);
  assert.ok(high.dustCount > balanced.dustCount && balanced.dustCount > low.dustCount);
  assert.equal(low.dustCount, 0);
  assert.equal(high.architectureDetail, 'high');
  assert.equal(low.architectureDetail, 'low');
  assert.equal(high.lightShafts, true);
  assert.equal(low.lightShafts, false);
  assert.equal(high.textureTier, 'high');
  assert.equal(low.textureTier, 'low');
  high.shadowMapSize = 1;
  assert.equal(getEnvironmentQualityProfile('high').shadowMapSize, 2048);
});
