import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { MultiplayerSetupPanel } from './MultiplayerSetupPanel';

const testGlobal = globalThis as typeof globalThis & { WebSocket?: typeof WebSocket };
testGlobal.WebSocket ??= class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
} as unknown as typeof WebSocket;

const noop = () => {};

const baseProps = (): ComponentProps<typeof MultiplayerSetupPanel> => ({
  connectionMode: 'relay',
  onConnectionModeChange: noop,
  isOnline: true,
  userIp: '127.0.0.1',
  lanIp: '127.0.0.1',
  hostIdCode: '123456',
  connectionStatus: 'idle',
  connectionError: '',
  quickPlayStatus: 'idle',
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS, visualModelPolicy: 'v1' },
  selectedMap: 'hangar',
  onSelectedMapChange: noop,
  lobbyCustomMapData: null,
  onCustomMapDataChange: noop,
  matchLobbyConfig: null,
  multiplayerRole: null,
  multiplayerSocket: null,
  multiplayerPlayerCount: 1,
  lobbyParticipants: [],
  chatMessages: [],
  joinIpOrId: '',
  onJoinIpOrIdChange: noop,
  customUrlInput: '',
  onCustomUrlInputChange: noop,
  onCancelHostOrJoin: noop,
  onCancelQuickPlay: noop,
  onQuickPlay: noop,
  onHostGame: noop,
  onStartHostedMatch: noop,
  onSendChatMessage: noop,
  onJoinGame: noop,
  onApplyMatchmakerUrl: noop,
  onResetMatchmakerUrl: noop,
});

test('MultiplayerSetupPanel exposes host visual model policy choices', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);

  assert.match(html, /Model Set/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});

test('MultiplayerSetupPanel defaults new hosted lobbies to recommended V3', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      adminSettings={{ ...DEFAULT_ADMIN_SETTINGS }}
    />
  );

  assert.match(html, /Model Set/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});

test('MultiplayerSetupPanel stacks model policy buttons on mobile widths', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);

  assert.match(html, /grid grid-cols-1 gap-1\.5 sm:grid-cols-3/);
});

test('MultiplayerSetupPanel staging summary shows the lobby model policy', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      connectionStatus="hosting"
      multiplayerRole="host"
      matchLobbyConfig={{
        access: 'open',
        gameMode: 'sandbox',
        selectedMap: 'hangar',
        customMap: null,
        maxPlayers: 8,
        allowObservers: true,
        matchTimerSeconds: 522,
        winTarget: 25,
        visualModelPolicy: 'v2',
      }}
      multiplayerSocket={{ readyState: 1 } as WebSocket}
    />
  );

  assert.match(html, /Models/);
  assert.match(html, /Version 2 Rigged/);
});

test('MultiplayerSetupPanel staging summary labels recommended V3 policy', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      connectionStatus="hosting"
      multiplayerRole="host"
      matchLobbyConfig={{
        access: 'open',
        gameMode: 'sandbox',
        selectedMap: 'hangar',
        customMap: null,
        maxPlayers: 8,
        allowObservers: true,
        matchTimerSeconds: 522,
        winTarget: 25,
        visualModelPolicy: 'v3',
      }}
      multiplayerSocket={{ readyState: 1 } as WebSocket}
    />
  );

  assert.match(html, /Models/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});
