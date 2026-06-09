import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialMultiplayerSessionSnapshot } from './useMultiplayerSessionState';

test('createInitialMultiplayerSessionSnapshot preserves App bootstrap multiplayer defaults', () => {
  assert.deepEqual(createInitialMultiplayerSessionSnapshot(), {
    connectionMode: 'relay',
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerSocket: null,
    connectionStatus: 'idle',
    connectionError: '',
    opponentClientId: '',
    multiplayerPlayerCount: 1,
    multiplayerSpawnSlot: 0,
    gameplayClientId: '',
    matchLobbyConfig: null,
  });
});

test('createInitialMultiplayerSessionSnapshot returns a fresh snapshot', () => {
  const snapshot = createInitialMultiplayerSessionSnapshot();
  snapshot.connectionError = 'changed';

  assert.equal(createInitialMultiplayerSessionSnapshot().connectionError, '');
});
