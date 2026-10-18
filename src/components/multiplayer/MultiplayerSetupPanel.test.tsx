import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { V3_INTERNAL_PROTOTYPE_LABEL } from '../../model/v3InternalStatus';
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

test('MultiplayerSetupPanel hides V3 host visual model policy for non-admin players', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);

  assert.match(html, /Model Set/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.doesNotMatch(html, /Version 3 Advanced/);
  assert.doesNotMatch(html, new RegExp(V3_INTERNAL_PROTOTYPE_LABEL));
});

test('MultiplayerSetupPanel hides V3 host visual model policy for admin players', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      {...({ isAdmin: true } as Partial<ComponentProps<typeof MultiplayerSetupPanel>>)}
    />
  );

  assert.match(html, /Model Set/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.doesNotMatch(html, /Version 3 Advanced/);
  assert.doesNotMatch(html, new RegExp(V3_INTERNAL_PROTOTYPE_LABEL));
});

test('MultiplayerSetupPanel defaults new hosted lobbies to recommended V2', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      adminSettings={{ ...DEFAULT_ADMIN_SETTINGS }}
    />
  );

  assert.match(html, /Model Set/);
  assert.match(html, /Version 2 Rigged/);
  assert.doesNotMatch(html, /Version 3 Advanced/);
  assert.doesNotMatch(html, new RegExp(V3_INTERNAL_PROTOTYPE_LABEL));
});

test('MultiplayerSetupPanel stacks model policy buttons on mobile widths', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);

  assert.match(html, /grid grid-cols-1 gap-1\.5 sm:grid-cols-2/);
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

for (const role of ['host', 'client', 'observer'] as const) {
  test(`Online staging shows the active room code for ${role}`, () => {
    const html = renderToStaticMarkup(<MultiplayerSetupPanel
      {...baseProps()}
      connectionStatus={role === 'host' ? 'hosting' : 'connected'}
      multiplayerRole={role}
      hostIdCode="782598"
      joinIpOrId="686924"
      matchLobbyConfig={{ access: 'open', gameMode: 'sandbox', selectedMap: 'hangar', customMap: null, maxPlayers: 8, allowObservers: true, matchTimerSeconds: 300, winTarget: 25, visualModelPolicy: 'v3' }}
      multiplayerSocket={{ readyState: 1 } as WebSocket}
    />);
    assert.match(html, /Room Code/);
    assert.match(html, role === 'host' ? />782598<\/p>/ : />686924<\/p>/);
    assert.doesNotMatch(html, role === 'host' ? />686924<\/p>/ : />782598<\/p>/);
  });
}

test('MultiplayerSetupPanel staging summary shows Iron Vanguard for non-admin players', () => {
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
  assert.match(html, /Version 3 Iron Vanguard/);
  assert.doesNotMatch(html, /Version 3 Advanced/);
});

test('MultiplayerSetupPanel staging summary shows Iron Vanguard for admin players', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      isAdmin={true}
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
  assert.match(html, /Version 3 Iron Vanguard/);
  assert.doesNotMatch(html, /Version 3 Advanced/);
});

test('Online starts with distinct overview routes and retains hidden host and join controls', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);
  assert.match(html, /class="menu-online-home"/);
  assert.match(html, /class="menu-online-host" hidden=""/);
  assert.match(html, /class="menu-online-join" hidden=""/);
  assert.match(html, /Browse lobbies/);
  assert.match(html, /Create Lobby/);
  assert.match(html, /Observe/);
  assert.match(html, /online-iron-vanguard.png/);
  assert.match(html, /stadium-gameplay.png/);
});

test('Online accepts a lobby browser request without replacing an active staged match', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} requestedView="browse" lobbyBrowser={<div>Directory content</div>} connectionStatus="hosting" multiplayerRole="host" multiplayerSocket={{ readyState: 1 } as WebSocket} matchLobbyConfig={{ access: 'password', gameMode: 'grifball', selectedMap: 'circle', customMap: null, maxPlayers: 8, allowObservers: true, matchTimerSeconds: 300, winTarget: 5, visualModelPolicy: 'v3' }} />);
  assert.match(html, /Lobby Staging/);
  assert.match(html, /Circle Arena/);
  assert.match(html, /Start Match/);
  assert.match(html, /Leave Lobby/);
  assert.doesNotMatch(html, /Directory content/);
});

test('Online shows the requested browser and keeps Quick Play cancelable during search', () => {
  const browser = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} requestedView="browse" lobbyBrowser={<div>Live directory</div>} />);
  assert.match(browser, /class="menu-online-home" hidden=""/);
  assert.match(browser, /class="menu-online-browser" aria-label="Lobby browser"/);
  assert.match(browser, /Live directory/);
  const searching = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} quickPlayStatus="searching" />);
  assert.match(searching, /Searching for a match/);
  assert.match(searching, /Cancel/);
  assert.doesNotMatch(searching, /Create Lobby/);
});
