import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveHttpBase } from '../services/liveConfig';
import {
  DEFAULT_REMOTE_RELAY_URL,
  buildRelaySocketUrl,
  getRelayWsUrl,
  normalizeRelayWsUrl,
  redactRelaySocketUrl,
  relayHttpBase,
  resolveRelayWsUrl,
} from './relayEndpoint';

const localPage = { protocol: 'http:', host: '127.0.0.1:3000' };
const retiredHost = 'ais-pre-tjrfoohpldxg7i2a3ncqfn-194609500028.us-west2.run.app';

test('local development and desktop clients use the secure remote Worker by default', () => {
  for (const host of ['127.0.0.1:3000', 'localhost:3000', '[::1]:4317']) {
    const socket = resolveRelayWsUrl({ location: { protocol: 'http:', host } });
    assert.equal(socket, DEFAULT_REMOTE_RELAY_URL);
    assert.equal(relayHttpBase(socket), 'https://ibrawlswebapp.commando501.workers.dev');
  }
});

test('Pages production and preview builds use the Worker without matching unrelated hosts', () => {
  for (const host of ['ibrawlswebapp.pages.dev', 'preview.ibrawlswebapp.pages.dev']) {
    assert.equal(resolveRelayWsUrl({ location: { protocol: 'https:', host } }), DEFAULT_REMOTE_RELAY_URL);
  }
  assert.equal(resolveRelayWsUrl({ location: { protocol: 'https:', host: 'ibrawlswebapp.pages.dev.example.com' } }), 'wss://ibrawlswebapp.pages.dev.example.com/ws');
  assert.equal(resolveRelayWsUrl({ location: { protocol: 'http:', host: '192.168.1.22:3000' } }), 'ws://192.168.1.22:3000/ws');
});

test('saved custom endpoints override build configuration and retain explicit local ws transport', () => {
  assert.equal(resolveRelayWsUrl({ savedUrl: 'http://192.168.1.20:3000', envUrl: 'wss://configured.example/ws', location: localPage }), 'ws://192.168.1.20:3000/ws');
  assert.equal(resolveRelayWsUrl({ envUrl: 'https://configured.example/relay/ws?region=us', location: localPage }), 'wss://configured.example/relay/ws?region=us');
  assert.equal(resolveRelayWsUrl({ savedUrl: 'not a URL', envUrl: 'wss://configured.example/ws' }), 'wss://configured.example/ws');
});

test('retired saved built-in URLs migrate without replacing deliberate custom routes or environment overrides', () => {
  for (const scheme of ['http', 'https', 'ws', 'wss']) {
    assert.equal(resolveRelayWsUrl({ savedUrl: `${scheme}://${retiredHost}/ws` }), DEFAULT_REMOTE_RELAY_URL);
  }
  assert.equal(resolveRelayWsUrl({ savedUrl: `wss://${retiredHost}/proxy/ws` }), `wss://${retiredHost}/proxy/ws`);
  assert.equal(resolveRelayWsUrl({ savedUrl: `wss://${retiredHost}/ws?region=test` }), `wss://${retiredHost}/ws?region=test`);
  assert.equal(resolveRelayWsUrl({ envUrl: `wss://${retiredHost}/ws` }), `wss://${retiredHost}/ws`);
});

test('HTTP input becomes a valid socket URL and the old double-prefix corruption is repaired on read', () => {
  assert.equal(normalizeRelayWsUrl(' https://relay.example ', 'http:'), 'wss://relay.example/ws');
  assert.equal(normalizeRelayWsUrl('http://127.0.0.1:3000/ws'), 'ws://127.0.0.1:3000/ws');
  assert.equal(normalizeRelayWsUrl('localhost:3000', 'http:'), 'ws://localhost:3000/ws');
  assert.equal(normalizeRelayWsUrl('relay.example', 'https:'), 'wss://relay.example/ws');
  assert.equal(normalizeRelayWsUrl('//relay.example/ws/', 'https:'), 'wss://relay.example/ws');
  assert.equal(resolveRelayWsUrl({ savedUrl: 'ws://https://relay.example/ws' }), 'wss://relay.example/ws');
});

test('invalid input cannot be applied as a malformed socket or carry URL credentials', () => {
  for (const input of ['', 'not a host', 'ftp://relay.example/ws', 'https://user:password@relay.example/ws', 'wss://relay.example/ws#fragment', 'ws://http://relay.example/ws']) {
    assert.throws(() => normalizeRelayWsUrl(input));
  }
  assert.equal(resolveRelayWsUrl({ savedUrl: 'invalid url', location: localPage }), DEFAULT_REMOTE_RELAY_URL);
});

test('REST bases strip socket query parameters before API paths are appended', () => {
  assert.equal(relayHttpBase('wss://relay.example/ws?region=west&accountToken=secret'), 'https://relay.example');
  assert.equal(relayHttpBase('wss://relay.example/proxy/ws/?region=west'), 'https://relay.example/proxy');
  assert.equal(relayHttpBase('ws://127.0.0.1:3000/ws'), 'http://127.0.0.1:3000');
});

test('socket identity is encoded once and replaces stale duplicate identity parameters', () => {
  const url = new URL(buildRelaySocketUrl('wss://relay.example/ws?region=west&type=old&type=stale&accountToken=old&name=old', {
    type: 'gameplay', onlineInstanceId: 'instance 1', name: 'A & B', accountId: 'account/1', accountToken: 'new&secret',
  }));
  assert.equal(url.searchParams.get('region'), 'west');
  assert.deepEqual(url.searchParams.getAll('type'), ['gameplay']);
  assert.equal(url.searchParams.get('name'), 'A & B');
  assert.equal(url.searchParams.get('onlineInstanceId'), 'instance 1');
  assert.equal(url.searchParams.get('accountToken'), 'new&secret');
});

test('guest and local unauthenticated sockets remove stored account credentials', () => {
  const guest = new URL(buildRelaySocketUrl('ws://localhost:3000/ws?accountId=old&accountToken=old&name=old', {
    type: 'lobby', onlineInstanceId: 'instance',
  }));
  assert.equal(guest.searchParams.has('accountId'), false);
  assert.equal(guest.searchParams.has('accountToken'), false);
  assert.equal(guest.searchParams.has('name'), false);
  const local = new URL(buildRelaySocketUrl('ws://localhost:3000/ws?accountToken=old', {
    type: 'gameplay', onlineInstanceId: 'instance', accountId: 'known', accountToken: null,
  }));
  assert.equal(local.searchParams.get('accountId'), 'known');
  assert.equal(local.searchParams.has('accountToken'), false);
});

test('socket diagnostics redact authentication and invite secrets', () => {
  const redacted = redactRelaySocketUrl('wss://relay.example/ws?accountToken=one&token=two&password=three&inviteToken=four&type=lobby');
  assert.doesNotMatch(redacted, /one|two|three|four/);
  assert.match(redacted, /type=lobby/);
});

test('non-browser tooling and unavailable storage can still resolve a usable endpoint', () => {
  assert.equal(getRelayWsUrl(), DEFAULT_REMOTE_RELAY_URL);
});

test('account/config/stats REST consumers resolve the same migrated host as sockets', () => {
  const globals = globalThis as typeof globalThis & { window?: unknown; localStorage?: unknown };
  const previousWindow = Object.getOwnPropertyDescriptor(globals, 'window');
  const previousStorage = Object.getOwnPropertyDescriptor(globals, 'localStorage');
  let saved = `ws://${retiredHost}/ws`;
  Object.defineProperty(globals, 'window', { configurable: true, value: { location: localPage } });
  Object.defineProperty(globals, 'localStorage', { configurable: true, value: { getItem: () => saved } });
  try {
    assert.equal(getRelayWsUrl(), DEFAULT_REMOTE_RELAY_URL);
    assert.equal(resolveHttpBase(), 'https://ibrawlswebapp.commando501.workers.dev');
    saved = 'https://custom.example/relay/ws?region=eu';
    assert.equal(getRelayWsUrl(), 'wss://custom.example/relay/ws?region=eu');
    assert.equal(resolveHttpBase(), 'https://custom.example/relay');
  } finally {
    if (previousWindow) Object.defineProperty(globals, 'window', previousWindow);
    else Reflect.deleteProperty(globals, 'window');
    if (previousStorage) Object.defineProperty(globals, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globals, 'localStorage');
  }
});
