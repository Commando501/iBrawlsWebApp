import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LIVE_CONFIG_KEYS, pickLiveConfigSettings } from './liveConfigKeys';
import { LIVE_CONFIG_KEYS as WORKER_LIVE_CONFIG_KEYS } from '../../worker/src/liveConfigKeys';
import {
  DEFAULT_ADMIN_SETTINGS,
  stripPlayerIdentitySettings,
  withDefaultGameplaySettings,
} from './gameplaySettings';
import { UniversalSettings } from '../types';

// Mirror of the App.tsx multiplayer overlay so the forcing rule is unit-tested.
function applyOfficialOverlay(
  local: UniversalSettings,
  preset: { settings: Partial<UniversalSettings> }
): UniversalSettings {
  return {
    ...local,
    ...withDefaultGameplaySettings(preset.settings),
    playerHue: local.playerHue,
    playerName: local.playerName,
  };
}

test('worker allowlist matches the client allowlist exactly (no drift)', () => {
  const client = [...LIVE_CONFIG_KEYS].sort();
  const worker = [...WORKER_LIVE_CONFIG_KEYS].sort();
  assert.deepEqual(
    worker,
    client,
    'worker/src/liveConfigKeys.ts is out of sync — regenerate it from LIVE_CONFIG_KEYS'
  );
});

test('allowlist excludes player-identity keys', () => {
  assert.ok(!LIVE_CONFIG_KEYS.includes('playerHue' as never));
  assert.ok(!LIVE_CONFIG_KEYS.includes('playerName' as never));
});

test('allowlist covers the full persisted mechanic subset', () => {
  const persistedKeys = Object.keys(
    stripPlayerIdentitySettings(DEFAULT_ADMIN_SETTINGS)
  ).sort();
  assert.deepEqual([...LIVE_CONFIG_KEYS].sort(), persistedKeys);
});

test('pickLiveConfigSettings strips identity and unknown keys', () => {
  const picked = pickLiveConfigSettings({
    maxHP: 9,
    playerHue: 123,
    playerName: 'Nope',
    bogusKey: true,
  } as Partial<UniversalSettings> & { bogusKey: boolean });
  assert.equal(picked.maxHP, 9);
  assert.ok(!('playerHue' in picked));
  assert.ok(!('playerName' in picked));
  assert.ok(!('bogusKey' in picked));
});

test('official overlay forces mechanic keys but preserves identity', () => {
  const local: UniversalSettings = {
    ...DEFAULT_ADMIN_SETTINGS,
    maxHP: 50, // local edit that should be overridden
    playerHue: 312,
    playerName: 'LocalGuy',
  };
  const official = { settings: { maxHP: 3, attackRadius: 7.5 } };

  const effective = applyOfficialOverlay(local, official);

  // Mechanic keys come from the official preset.
  assert.equal(effective.maxHP, 3);
  assert.equal(effective.attackRadius, 7.5);
  // Identity stays local.
  assert.equal(effective.playerHue, 312);
  assert.equal(effective.playerName, 'LocalGuy');
});
