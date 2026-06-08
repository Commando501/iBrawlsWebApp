import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createLocalGameMultiplayerReset,
  createReturnToMainMultiplayerReset,
  shouldShowTerminatedOverlayAfterClose,
} from './useAppLifecycleActions';

test('createLocalGameMultiplayerReset preserves the local start-game reset contract', () => {
  assert.deepEqual(createLocalGameMultiplayerReset(), {
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerPlayerCount: 1,
    multiplayerSpawnSlot: 0,
    multiplayerSocket: null,
  });
});

test('createReturnToMainMultiplayerReset preserves the main-menu multiplayer reset contract', () => {
  assert.deepEqual(createReturnToMainMultiplayerReset(), {
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerPlayerCount: 1,
    multiplayerSpawnSlot: 0,
    multiplayerSocket: null,
    connectionStatus: 'idle',
    opponentClientId: '',
  });
});

test('shouldShowTerminatedOverlayAfterClose keeps tournament closes silent', () => {
  assert.equal(shouldShowTerminatedOverlayAfterClose('sandbox'), true);
  assert.equal(shouldShowTerminatedOverlayAfterClose('tournament'), false);
});
