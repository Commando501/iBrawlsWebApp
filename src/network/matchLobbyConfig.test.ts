import assert from 'node:assert/strict';
import test from 'node:test';
import { buildActiveLobbies, type OnlineClient } from './onlineClients';
import {
  DEFAULT_GRIFBALL_GOAL_TARGET,
  DEFAULT_IBRAWLS_KILL_TARGET,
  MAX_MATCH_LOBBY_PLAYERS,
  MAX_MATCH_TIMER_SECONDS,
  MIN_MATCH_LOBBY_PLAYERS,
  MIN_MATCH_TIMER_SECONDS,
  createMatchLobbySummary,
  formatMatchTimerLabel,
  getMatchLobbyModeLabel,
  getMatchLobbyTargetLabel,
  normalizeMatchLobbyConfig,
  sanitizeLobbyPassword,
} from './matchLobbyConfig';

test('normalizeMatchLobbyConfig clamps lobby limits and applies mode defaults', () => {
  const ibrawls = normalizeMatchLobbyConfig({
    access: 'password',
    gameMode: 'sandbox',
    selectedMap: '  arena-01  ',
    maxPlayers: 99,
    allowObservers: false,
    matchTimerSeconds: 5,
  });

  assert.equal(ibrawls.access, 'password');
  assert.equal(ibrawls.gameMode, 'sandbox');
  assert.equal(ibrawls.selectedMap, 'arena-01');
  assert.equal(ibrawls.maxPlayers, MAX_MATCH_LOBBY_PLAYERS);
  assert.equal(ibrawls.allowObservers, false);
  assert.equal(ibrawls.matchTimerSeconds, MIN_MATCH_TIMER_SECONDS);
  assert.equal(ibrawls.winTarget, DEFAULT_IBRAWLS_KILL_TARGET);

  const grifball = normalizeMatchLobbyConfig({
    gameMode: 'grifball',
    maxPlayers: 0,
    matchTimerSeconds: 99999,
  });

  assert.equal(grifball.maxPlayers, MIN_MATCH_LOBBY_PLAYERS);
  assert.equal(grifball.matchTimerSeconds, MAX_MATCH_TIMER_SECONDS);
  assert.equal(grifball.winTarget, DEFAULT_GRIFBALL_GOAL_TARGET);
});

test('normalizeMatchLobbyConfig defaults visual model policy to v3', () => {
  const config = normalizeMatchLobbyConfig({});
  assert.equal(config.visualModelPolicy, 'v3');
});

test('normalizeMatchLobbyConfig preserves v1 and v2 visual model policy choices', () => {
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v3' }).visualModelPolicy, 'v3');
});

test('normalizeMatchLobbyConfig rejects invalid visual model policy values', () => {
  const config = normalizeMatchLobbyConfig({ visualModelPolicy: 'v4' } as any);
  assert.equal(config.visualModelPolicy, 'v3');
});

test('lobby summaries expose metadata without storing raw passwords', () => {
  const config = normalizeMatchLobbyConfig({
    access: 'password',
    gameMode: 'grifball',
    selectedMap: 'stadium',
    maxPlayers: 4,
    matchTimerSeconds: 300,
    winTarget: 5,
  });

  assert.equal(sanitizeLobbyPassword('  secret-pass  '), 'secret-pass');
  assert.equal(sanitizeLobbyPassword('    '), undefined);

  const summary = createMatchLobbySummary(config, { hasPassword: true });

  assert.equal(summary.access, 'password');
  assert.equal(summary.hasPassword, true);
  assert.equal(summary.maxPlayers, 4);
  assert.equal(summary.visualModelPolicy, 'v3');
  assert.equal(getMatchLobbyModeLabel(summary.gameMode), 'Grifball');
  assert.equal(getMatchLobbyTargetLabel(summary), '5 goals');
  assert.equal(formatMatchTimerLabel(summary.matchTimerSeconds), '5:00');
  assert.equal('password' in summary, false);
});

test('active lobby metadata respects private visibility, capacity, and password access', () => {
  const openSummary = createMatchLobbySummary(normalizeMatchLobbyConfig({
    access: 'open',
    maxPlayers: 2,
  }));
  const passwordSummary = createMatchLobbySummary(normalizeMatchLobbyConfig({
    access: 'password',
    maxPlayers: 4,
  }), { hasPassword: true });
  const privateSummary = createMatchLobbySummary(normalizeMatchLobbyConfig({
    access: 'private',
    maxPlayers: 4,
  }));
  const clients: OnlineClient[] = [
    {
      id: 'open-host',
      state: 'multi',
      roomCode: '123456',
      spaceAvailable: true,
      playerCount: 2,
      maxPlayers: 2,
      lobby: openSummary,
    },
    {
      id: 'password-host',
      state: 'multi',
      roomCode: '654321',
      spaceAvailable: true,
      playerCount: 1,
      maxPlayers: 4,
      lobby: passwordSummary,
    },
    {
      id: 'private-host',
      state: 'multi',
      roomCode: '111111',
      spaceAvailable: true,
      playerCount: 1,
      maxPlayers: 4,
      lobby: privateSummary,
    },
  ];

  const lobbies = buildActiveLobbies(clients);
  const lobbiesByCode = new Map(lobbies.map((lobby) => [lobby.roomCode, lobby]));

  assert.equal(lobbiesByCode.get('123456')?.isOpen, false);
  assert.equal(lobbiesByCode.get('654321')?.isOpen, true);
  assert.equal(lobbiesByCode.get('654321')?.lobby?.hasPassword, true);
  assert.equal(lobbiesByCode.get('111111')?.isOpen, false);
});
