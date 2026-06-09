import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialGameStats } from './hud/useCurrentGameStats';
import { buildCurrentStatsSnapshot, resolveMultiplayerMatchEnd } from './useAppStatsUpdateHandler';
import { normalizeMatchLobbyConfig } from '../network/matchLobbyConfig';
import type { GameStats } from '../types';

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

test('resolveMultiplayerMatchEnd ends iBrawls on kill target', () => {
  const stats: GameStats = {
    ...createInitialGameStats(90, 12),
    scorePlayer: 25,
    scoreEnemy: 24,
    gameTime: 120,
  };

  const result = resolveMultiplayerMatchEnd(stats, normalizeMatchLobbyConfig({
    gameMode: 'sandbox',
    winTarget: 25,
  }));

  assert.deepEqual(result, { winner: 'host', reason: 'target' });
});

test('resolveMultiplayerMatchEnd ends Grifball on timer by leading score', () => {
  const stats: GameStats = {
    ...createInitialGameStats(90, 12),
    gameTime: 0,
    grifball: {
      phase: 'playing',
      blueGoals: 2,
      redGoals: 3,
      goalTarget: 5,
      roundNumber: 1,
      countdown: 0,
      ballCarrierName: null,
      ballCarrierTeam: null,
      winningTeam: null,
      localTeam: 'blue',
      localCarrying: false,
      passCharge: 0,
    },
  };

  const result = resolveMultiplayerMatchEnd(stats, normalizeMatchLobbyConfig({
    gameMode: 'grifball',
    winTarget: 5,
  }));

  assert.deepEqual(result, { winner: 'red', reason: 'timer' });
});
