import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SpartanIdentityAccount from '../SpartanIdentityAccount';
import { GlobalChatPanel, PlayerListSubframe } from './GlobalBroadcastPanel';
import type { AccountInfo } from '../../services/account';

const noop = () => {};
const account: AccountInfo = {
  id: 'test-account', email: 'pilot@example.invalid', username: 'TestPilot',
  registeredDisplayName: 'TestPilot', recoveryCode: '9182', createdAt: 0,
  usernameChangedAt: null, emailChangedAt: null, passwordChangedAt: null, isAdmin: false,
};
const identityProps = { playerName: 'TestPilot', onRegistered: noop, onLoggedIn: noop, onLoggedOut: noop, onAccountChanged: noop };
const directoryProps = { clientId: 'self', connectionStatus: 'idle' as const, connectionMode: 'relay' as const, menuSocket: null, hostIdCode: '', onJoinGame: noop, setInviteNotifications: noop };

test('screen account keeps recovery private and retains each real account edit', () => {
  const html = renderToStaticMarkup(<SpartanIdentityAccount {...identityProps} account={account} presentation="screen" />);
  assert.doesNotMatch(html, /9182/);
  assert.match(html, /Show code/);
  assert.match(html, /Change username/);
  assert.match(html, /Change email/);
  assert.match(html, /Change password/);
  assert.match(html, /Activate Admin/);
  assert.match(html, /Log Out/);
});

test('screen account preserves all edit cooldowns and actual admin eligibility', () => {
  const now = Date.now();
  const html = renderToStaticMarkup(<SpartanIdentityAccount {...identityProps} presentation="screen" account={{ ...account, isAdmin: true, usernameChangedAt: now, emailChangedAt: now, passwordChangedAt: now }} />);
  assert.equal((html.match(/disabled=""/g) || []).length, 3);
  assert.match(html, /Available in 7d/);
  assert.match(html, /Available in 1d/);
  assert.doesNotMatch(html, /Activate Admin/);
});

test('guest profile retains login, registration, and recovery without fabricated account data', () => {
  const html = renderToStaticMarkup(<SpartanIdentityAccount {...identityProps} account={null} presentation="screen" />);
  assert.match(html, /Log In/);
  assert.match(html, /Create Account/);
  assert.match(html, /Recover account/);
  assert.doesNotMatch(html, /pilot@example/);
});

test('social player directory uses public display names and preserves password lobby actions', () => {
  const html = renderToStaticMarkup(<PlayerListSubframe {...directoryProps} presentation="screen" onlineClients={[{ id: 'remote', name: 'OldName', publicDisplayName: 'PublicName', state: 'multi', roomCode: '234567', spaceAvailable: true, lobby: { access: 'password', hasPassword: true, gameMode: 'grifball', selectedMap: 'hangar', maxPlayers: 8, allowObservers: true, matchTimerSeconds: 300, winTarget: 5, visualModelPolicy: 'v3' } }]} />);
  assert.match(html, /PublicName/);
  assert.doesNotMatch(html, /OldName/);
  assert.match(html, /Enter password/);
  assert.match(html, /Search online players/);
  assert.doesNotMatch(html, /Invite player/);
});

test('online lobby browser can start with actual lobby data and no invented rows', () => {
  const html = renderToStaticMarkup(<PlayerListSubframe {...directoryProps} presentation="screen" initialTab="lobbies" onlineClients={[]} />);
  assert.match(html, /No active lobbies broadcasting right now/);
  assert.doesNotMatch(html, /menu-player-row/);
});

test('disconnected global chat announces its state and retains accessible real history', () => {
  const html = renderToStaticMarkup(<GlobalChatPanel presentation="screen" disabled messages={[{ id: 'chat-1', sender: 'ActualSender', text: '<test message>', timestamp: '12:00', role: 'client', isLocal: false }]} onSendMessage={noop} />);
  assert.match(html, /role="log"/);
  assert.match(html, /ActualSender/);
  assert.match(html, /&lt;test message&gt;/);
  assert.match(html, /Reconnect to send. Your draft is kept/);
  assert.match(html, /aria-label="Global message"/);
  assert.match(html, /disabled=""/);
});
