import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGameplayMessage } from './parseGameplayMessage';
import { sendGameplaySnapshot } from './sendGameplaySnapshot';

test('listeners share one parsed event, including null, while malformed JSON still fails', () => {
  let reads = 0;
  const event = { get data() { reads++; return '{"pos":{"x":4}}'; } } as MessageEvent;
  assert.equal(parseGameplayMessage(event), parseGameplayMessage(event));
  assert.equal(reads, 1);
  assert.equal(parseGameplayMessage({ data: 'null' } as MessageEvent), null);
  assert.throws(() => parseGameplayMessage({ data: 'invalid' } as MessageEvent));
});

test('idle clock updates coalesce while changed poses, health, weapons and respawns send immediately', () => {
  const sent: any[] = [];
  const socket = { readyState: 1, send: (data: string) => sent.push(JSON.parse(data)) };
  const snapshot = { type: 'sync', pos: { x: 1, y: 0, z: 2 }, hp: 1, activeWeapon: 'hammer', respawnTimer: 0, gameTime: 0 };
  for (let t = 0; t <= 1000; t += 5) sendGameplaySnapshot(socket, { ...snapshot, gameTime: t / 1000 }, t);
  assert.equal(sent.length, 5);
  assert.equal(sent.at(-1).gameTime, 1);
  for (const change of [{ pos: { x: 2, y: 0, z: 2 } }, { hp: 0 }, { activeWeapon: 'sword' }, { respawnTimer: 3 }]) {
    Object.assign(snapshot, change);
    assert.equal(sendGameplaySnapshot(socket, snapshot, 1001), true);
  }
});

test('closed/failed sockets do not consume a snapshot and a new connection gets a full snapshot', () => {
  const snapshot = { type: 'sync', pos: { x: 0 } };
  const sent: string[] = [];
  const socket = { readyState: 3, send: (data: string) => { sent.push(data); } };
  assert.equal(sendGameplaySnapshot(socket, snapshot, 0), false);
  socket.readyState = 1;
  assert.equal(sendGameplaySnapshot(socket, snapshot, 1), true);
  const broken = { readyState: 1, send: (): void => { throw new Error('closed'); } };
  assert.throws(() => sendGameplaySnapshot(broken, snapshot, 2));
  broken.send = () => {};
  assert.equal(sendGameplaySnapshot(broken, snapshot, 3), true);
  assert.equal(sendGameplaySnapshot({ ...socket }, snapshot, 2), true);
});
