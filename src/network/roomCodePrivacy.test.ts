import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildActiveLobbies, type OnlineClient } from './onlineClients';
import { normalizePublicRoomCode } from './roomCodePrivacy';

test('normalizes only relay-safe public room codes', () => {
  assert.equal(normalizePublicRoomCode('123456'), '123456');
  assert.equal(normalizePublicRoomCode(' qp_123456 '), 'QP_123456');
  assert.equal(normalizePublicRoomCode('203.0.113.8'), undefined);
  assert.equal(normalizePublicRoomCode('192.168.1.10'), undefined);
  assert.equal(normalizePublicRoomCode('2001:db8::1'), undefined);
  assert.equal(normalizePublicRoomCode('host.example.com'), undefined);
  assert.equal(normalizePublicRoomCode('custom-lobby'), undefined);
});

test('active lobby grouping ignores private network endpoints', () => {
  const clients: OnlineClient[] = [
    { id: 'host', state: 'multi', roomCode: '123456', spaceAvailable: true },
    { id: 'direct-ip', state: 'multi', roomCode: '203.0.113.8', spaceAvailable: true },
    { id: 'lan-ip', state: 'multi', roomCode: '192.168.1.10', spaceAvailable: true },
    { id: 'quickplay', state: 'multi', roomCode: 'QP_654321', spaceAvailable: true },
  ];

  const lobbies = buildActiveLobbies(clients);

  assert.deepEqual(lobbies.map((lobby) => lobby.roomCode), ['123456', 'QP_654321']);
});
