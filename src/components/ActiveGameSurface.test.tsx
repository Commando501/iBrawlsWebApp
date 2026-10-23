import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveActiveGameSettings, resolveSessionCustomMap } from './ActiveGameSurface';
import { DEFAULT_ADMIN_SETTINGS } from '../settings/gameplaySettings';
import { createPublishedMapSnapshot } from '../game/mapBalancing';
import { normalizeMatchLobbyConfig } from '../network/matchLobbyConfig';
import { resolveActiveCustomMap } from './grifball/mapSelection';

test('training renders the published snapshot and multiplayer always renders the host snapshot', () => {
  const training = createPublishedMapSnapshot('championship_stadium', { version: 7, settings: { mapScaleStadiumLength: 125 } })!;
  const host = createPublishedMapSnapshot('championship_stadium', { version: 8, settings: { mapScaleStadiumWidth: 75 } })!;
  const options = { selectedMap: training.id, selectedReplay: null, lobbyCustomMapData: null,
    isMultiplayer: false, matchLobbyConfig: normalizeMatchLobbyConfig({ selectedMap: host.id, customMap: host }),
    singlePlayerMode: 'sandbox' as const, trainingMapSnapshot: training };
  assert.equal(resolveSessionCustomMap(options), training);
  assert.equal(resolveActiveCustomMap({ selectedMap: training.id, customMap: resolveSessionCustomMap(options), gameMode: 'grifball' }), training);
  assert.equal(resolveSessionCustomMap({ ...options, isMultiplayer: true }), host);
  assert.equal(resolveSessionCustomMap({ ...options, isMultiplayer: true, matchLobbyConfig: null }), undefined, 'never leak local training geometry into a client');
  assert.equal(resolveSessionCustomMap({ ...options, selectedMap: 'hangar' }), undefined);
  assert.equal(resolveSessionCustomMap({ ...options, singlePlayerMode: 'tournament' }), undefined);
  assert.equal(resolveSessionCustomMap({ ...options, selectedReplay: { balancedMap: host } as any }), undefined, 'replay resolver must use recorded geometry');
  assert.equal(resolveSessionCustomMap({ ...options, selectedMap: 'custom_file', lobbyCustomMapData: host }), host, 'imports stay explicit');
});

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
