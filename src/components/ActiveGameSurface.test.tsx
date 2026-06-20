import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActiveGameSettings } from './ActiveGameSurface';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';

test('resolveActiveGameSettings forces tournament matches to sandbox mode', () => {
  const grifballSettings = {
    ...DEFAULT_ADMIN_SETTINGS,
    gameMode: 'grifball' as const,
  };

  assert.equal(
    resolveActiveGameSettings(grifballSettings, true).gameMode,
    'sandbox'
  );
});

test('resolveActiveGameSettings preserves non-tournament grifball mode', () => {
  const grifballSettings = {
    ...DEFAULT_ADMIN_SETTINGS,
    gameMode: 'grifball' as const,
  };

  assert.equal(
    resolveActiveGameSettings(grifballSettings, false).gameMode,
    'grifball'
  );
});
