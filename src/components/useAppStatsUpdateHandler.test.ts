import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameStats } from './hud/useCurrentGameStats';
import { buildCurrentStatsSnapshot } from './useAppStatsUpdateHandler';

test('buildCurrentStatsSnapshot overlays live multiplayer status onto game stats', () => {
  const stats = createInitialGameStats(210, 0);
  const socket = {} as WebSocket;

  const snapshot = buildCurrentStatsSnapshot(stats, {
    isMultiplayer: true,
    multiplayerRole: 'host',
    multiplayerSocket: socket,
    ping: 48,
    clientId: 'host-1',
    opponentClientId: 'client-2',
  });

  assert.equal(snapshot.isMultiplayer, true);
  assert.equal(snapshot.multiplayerRole, 'host');
  assert.equal(snapshot.opponentConnected, true);
  assert.equal(snapshot.ping, 48);
  assert.equal(snapshot.playerClientId, 'host-1');
  assert.equal(snapshot.opponentClientId, 'client-2');
  assert.equal(snapshot.scorePlayer, stats.scorePlayer);
  assert.equal(snapshot.settings.playerHue, 210);
});

test('buildCurrentStatsSnapshot preserves App fallback client labels', () => {
  const snapshot = buildCurrentStatsSnapshot(createInitialGameStats(90, 12), {
    isMultiplayer: false,
    multiplayerRole: null,
    multiplayerSocket: null,
    ping: 12,
    clientId: '',
    opponentClientId: '',
  });

  assert.equal(snapshot.opponentConnected, false);
  assert.equal(snapshot.playerClientId, 'Player');
  assert.equal(snapshot.opponentClientId, 'Opponent');
});
