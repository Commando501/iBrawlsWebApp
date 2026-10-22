import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelQueuedQuickPlayIfIdle, sendRelayHeartbeats } from './useLobbyConnection';

function queuedPlayer() {
  const messages: unknown[] = [];
  const requested = { current: true };
  const socket = {
    readyState: 1,
    send: (data: string) => messages.push(JSON.parse(data)),
  };
  return { messages, requested, socket };
}

test('lobby and gameplay sockets both stay alive throughout a match', () => {
  const lobby = queuedPlayer(), gameplay = queuedPlayer();
  sendRelayHeartbeats([gameplay.socket, lobby.socket], 123);
  assert.deepEqual(lobby.messages, [{ type: 'ping', timestamp: 123 }]);
  assert.deepEqual(gameplay.messages, lobby.messages);
  gameplay.socket.readyState = 3;
  sendRelayHeartbeats([gameplay.socket, lobby.socket, lobby.socket, null], 456);
  assert.equal(gameplay.messages.length, 1);
  assert.deepEqual(lobby.messages.at(-1), { type: 'ping', timestamp: 456 });
  assert.equal(lobby.messages.length, 2);
});

test('a failed heartbeat on one channel does not starve the other', t => {
  t.mock.method(console, 'error', () => {});
  const lobby = queuedPlayer();
  sendRelayHeartbeats([{ readyState: 1, send: () => { throw new Error('closing'); } }, lobby.socket], 789);
  assert.deepEqual(lobby.messages, [{ type: 'ping', timestamp: 789 }]);
});

test('Leaving Quick Play for Training removes the waiting client from the server queue', () => {
  const { messages, requested, socket } = queuedPlayer();
  cancelQueuedQuickPlayIfIdle('searching', socket, requested);
  assert.deepEqual(messages, []);

  // Training, Tournament, and Return to Main set the hook status to idle.
  cancelQueuedQuickPlayIfIdle('idle', socket, requested);
  assert.deepEqual(messages, [{ type: 'quickplay_leave' }]);
  assert.equal(requested.current, false, 'Late match assignments must now be ignored');

  cancelQueuedQuickPlayIfIdle('idle', socket, requested);
  assert.equal(messages.length, 1, 'Re-renders must not send another queue cancellation');
});

test('A successful match assignment can become idle without canceling its reservation', () => {
  const { messages, requested, socket } = queuedPlayer();
  // quickplay_match_found consumes the request before advancing to the room.
  requested.current = false;
  cancelQueuedQuickPlayIfIdle('idle', socket, requested);
  assert.deepEqual(messages, []);
});

test('A Quick Play host assignment is not canceled while its room is registering', () => {
  const { messages, requested, socket } = queuedPlayer();
  cancelQueuedQuickPlayIfIdle('matching', socket, requested);
  assert.deepEqual(messages, []);
  assert.equal(requested.current, true);
});

test('Offline cancellation clears local queue intent without sending on a closed socket', () => {
  const { messages, requested, socket } = queuedPlayer();
  socket.readyState = 3;
  cancelQueuedQuickPlayIfIdle('idle', socket, requested);
  assert.deepEqual(messages, []);
  assert.equal(requested.current, false);
});
