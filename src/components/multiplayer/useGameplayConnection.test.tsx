import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { getPlayerCountAfterParticipantLeft, useGameplayConnection } from './useGameplayConnection';
import { upsertLoadingSlot, upsertLoadingSlots } from '../loading/matchLoadingState';
import type { MultiplayerLoadingParticipant } from '../loading/loadingTypes';

class FakeSocket extends EventTarget {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 0;
  closeCalls = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }

  open() { this.readyState = 1; this.onopen?.(); }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.closeCalls += 1; this.readyState = 2; }
  finishClose(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  receive(data: unknown) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
}

type Options = Parameters<typeof useGameplayConnection>[0];

function setup(t: TestContext, overrides: Partial<Options> = {}) {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  FakeSocket.instances = [];
  const oldSocket = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: FakeSocket });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { protocol: 'http:', host: 'localhost:3000' } },
  });
  t.after(() => {
    if (oldSocket) Object.defineProperty(globalThis, 'WebSocket', oldSocket);
    else Reflect.deleteProperty(globalThis, 'WebSocket');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });
  const state: Record<string, unknown> = {
    connectionStatus: 'idle', connectionError: '', multiplayerSocket: null,
    isMultiplayer: false, multiplayerRole: null, multiplayerPlayerCount: 1,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
  };
  const noop = () => {};
  const options = {
    connectionMode: 'relay', userIp: '', lanIp: '', hostIdCode: '123456',
    playerName: 'Local QA', playerHue: 180, playerLoadout: {},
    selectedMap: 'championship_stadium', lobbyCustomMapData: null,
    adminSettings: DEFAULT_ADMIN_SETTINGS, matchLobbyConfig: null,
    isMultiplayer: false, multiplayerSocket: null, multiplayerRole: null,
    gameplayClientId: '', getWsUrl: () => 'wss://relay.invalid',
    buildGameplayWsUrl: (url: string) => url, redactWsUrl: (url: string) => url,
    mergeLoadingParticipants: noop, upsertLoadingParticipantSlot: noop,
    upsertLoadingParticipantStatus: noop, removeLoadingParticipantById: noop,
  } as unknown as Options;
  for (const key of [
    'hostIdCode', 'joinIpOrId', 'selectedMap', 'lobbyCustomMapData', 'adminSettings',
    'matchLobbyConfig', 'connectionStatus', 'connectionError', 'chatMessages',
    'multiplayerSocket', 'isMultiplayer', 'multiplayerRole', 'gameplayClientId',
    'opponentClientId', 'multiplayerPlayerCount', 'multiplayerSpawnSlot',
    'isPlaying', 'isPaused', 'isTerminated',
  ]) {
    const setter = `set${key[0].toUpperCase()}${key.slice(1)}`;
    (options as unknown as Record<string, unknown>)[setter] = (value: unknown) => {
      state[key] = typeof value === 'function' ? value(state[key]) : value;
    };
  }
  Object.assign(options, overrides);
  let connection!: ReturnType<typeof useGameplayConnection>;
  function Probe() {
    connection = useGameplayConnection(options);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return { connection, state, latest: () => FakeSocket.instances.at(-1)! };
}

for (const role of ['host', 'join'] as const) {
  test(`Cancel closes a pending ${role} and ignores its late handshake`, (t) => {
    const { connection, state, latest } = setup(t);
    if (role === 'host') connection.handleHostGame();
    else connection.handleJoinGame('123456');
    const socket = latest();
    connection.cancelHostOrJoin();
    assert.equal(socket.closeCalls, 1);
    socket.open();
    socket.receive({ type: role === 'host' ? 'hosted' : 'connected', clientId: 'late' });
    socket.finishClose();
    assert.equal(socket.sent.length, 0);
    assert.equal(state.connectionStatus, 'idle');
    assert.equal(state.multiplayerSocket, null);
    assert.equal(state.isMultiplayer, false);
  });

  test(`${role} server rejection remains an error after the socket closes`, (t) => {
    const { connection, state, latest } = setup(t);
    if (role === 'host') connection.handleHostGame();
    else connection.handleJoinGame('123456');
    const socket = latest();
    socket.open();
    socket.receive({ type: 'error', message: 'Incorrect lobby password.' });
    socket.finishClose();
    assert.equal(state.connectionStatus, 'error');
    assert.equal(state.connectionError, 'Incorrect lobby password.');
    assert.equal(state.isMultiplayer, false);
    assert.equal(state.multiplayerRole, null);
  });
}

test('An old socket closing cannot clear a newer hosted lobby', (t) => {
  const { connection, state, latest } = setup(t);
  connection.handleJoinGame('111111');
  const old = latest();
  connection.handleHostGame('222222');
  const current = latest();
  current.open();
  current.receive({ type: 'hosted', clientId: 'current', keys: ['222222'] });
  old.receive({ type: 'error', message: 'Stale rejection' });
  old.finishClose(1006);
  assert.equal(old.closeCalls, 1);
  assert.equal(state.connectionStatus, 'hosting');
  assert.equal(state.multiplayerSocket, current);
  assert.equal(state.gameplayClientId, 'current');
  assert.equal(state.connectionError, '');
});

test('Transport failure preserves its error and clears multiplayer state', (t) => {
  const { connection, state, latest } = setup(t);
  connection.handleHostGame();
  latest().onerror?.(new Error('Transport refused'));
  latest().finishClose(1006);
  assert.equal(state.connectionStatus, 'error');
  assert.equal(state.connectionError, 'Matchmaker registration failed.');
  assert.equal(state.multiplayerSocket, null);
  assert.equal(state.multiplayerRole, null);
  assert.equal(state.isMultiplayer, false);
});

test('An unexpected active socket close shows a recoverable error', (t) => {
  const { connection, state, latest } = setup(t);
  connection.handleHostGame();
  latest().open();
  latest().receive({ type: 'hosted', clientId: 'current', keys: ['123456'] });
  state.isPlaying = true;
  latest().finishClose(1006);
  assert.equal(state.connectionStatus, 'error');
  assert.match(String(state.connectionError), /connection.*lost/i);
  assert.equal(state.multiplayerPlayerCount, 1);
  assert.equal(state.gameplayClientId, '');
  assert.equal(state.isPlaying, false);
});

test('A blank room code does not create a connection', (t) => {
  const { connection, state } = setup(t);
  connection.handleJoinGame('   ');
  assert.equal(FakeSocket.instances.length, 0);
  assert.match(String(state.connectionError), /provide.*room code/i);
});

test('Quick Play can host through the relay while Local is selected', (t) => {
  const { connection, latest } = setup(t, { connectionMode: 'local' });
  connection.handleHostGame('123456', { access: 'open' }, undefined, 'relay');
  assert.equal(latest().url, 'wss://relay.invalid');
  latest().open();
  assert.equal((latest().sent[0] as { type: string }).type, 'host');
});

test('Canceling before starting a local game prevents a late close from ending it', (t) => {
  const { connection, state, latest } = setup(t);
  connection.handleHostGame();
  latest().open();
  latest().receive({ type: 'hosted', clientId: 'current', keys: ['123456'] });
  const old = latest();
  connection.cancelHostOrJoin();
  state.isPlaying = true;
  old.finishClose(1006);
  assert.equal(state.isPlaying, true);
  assert.equal(state.connectionStatus, 'idle');
});

for (const role of ['client', 'observer'] as const) {
  test(`The ${role} handshake builds a staging roster with both peers and its own acknowledged identity`, (t) => {
    let roster: Record<string, MultiplayerLoadingParticipant> = {};
    const { connection, latest } = setup(t, {
      playerName: 'Local QA',
      playerHue: 30,
      playerLoadout: { modelSystem: 'v3', characterAsset: 'iron-vanguard' },
      mergeLoadingParticipants: slots => { roster = upsertLoadingSlots(roster, slots, 1000); },
      upsertLoadingParticipantSlot: slot => { roster = upsertLoadingSlot(roster, slot, 1000); },
    });
    connection.handleJoinGame('123456', role === 'observer');
    latest().open();
    latest().receive({
      type: 'connected', clientId: 'self-id', playerName: 'Acknowledged QA', role,
      spawnSlot: role === 'client' ? 1 : undefined,
      lobbyConfig: { selectedMap: 'championship_stadium', visualModelPolicy: 'v3' },
      participants: [{ clientId: 'host-id', playerName: 'QA Host', role: 'host', spawnSlot: 0, hue: 200 }],
      otherPlayerIds: ['host-id'],
    });
    assert.equal(roster['host-id'].playerName, 'QA Host');
    assert.equal(roster['self-id'].playerName, 'Acknowledged QA');
    assert.equal(roster['self-id'].role, role);
    assert.equal(roster['self-id'].hue, 30);
    assert.equal(roster['self-id'].loadout?.characterAsset, 'iron-vanguard');
    assert.equal(roster['self-id'].visualModelPolicy, 'v3');
    connection.cancelHostOrJoin();
  });
}

test('An observer departure removes no playable slot from the lobby count', () => {
  assert.equal(getPlayerCountAfterParticipantLeft(2, 'observer'), 2);
  assert.equal(getPlayerCountAfterParticipantLeft(2, 'client'), 1);
  assert.equal(getPlayerCountAfterParticipantLeft(3), 2, 'Legacy player departures still decrement');
  assert.equal(getPlayerCountAfterParticipantLeft(1, 'client'), 1);
});
