import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../src/settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from '../../src/components/grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../../src/components/grifball/threeRefs';
import { createRemoteCombatant } from '../../src/game/roster';
import { onlineGrifball, receiveOnlineGrifballMessage } from '../../src/components/grifball/onlineGrifballRuntime';
import { updateGrifballObjectiveForState } from '../../src/components/grifball/grifballObjectiveRuntime';
const url = process.env.ONLINE_RELAY_TEST_URL;
test('real relay: host authority, client pickup/charge/throw, late spectator, forged state and disconnect', { skip: !url, timeout: 20000 }, async t => {
  const sockets: WebSocket[] = [];
  t.after(() => sockets.forEach(s => s.close()));
  async function connect() {
    const socket = new WebSocket(url!); sockets.push(socket);
    const messages: any[] = [];
    socket.on('message', raw => messages.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const wait = async (fn: (m: any) => boolean) => {
      const until = Date.now() + 5000;
      while (Date.now() < until) { const m = messages.find(fn); if (m) return m; await new Promise(r => setTimeout(r, 20)); }
      throw new Error('Relay response timed out: ' + messages.map(m => m.type + ':' + m.action).slice(-8));
    };
    return { socket, messages, send: (value: unknown) => socket.send(JSON.stringify(value)), wait };
  }
  const host = await connect();
  host.send({ type: 'host', customId: 'BALL_' + Date.now(), playerName: 'BallHost', lobbyConfig: { gameMode: 'grifball', visualModelPolicy: 'v3', allowObservers: true } });
  const hosted = await host.wait(m => m.type === 'hosted');
  const guest = await connect(); guest.send({ type: 'join', targetIpOrId: hosted.keys[0], playerName: 'BallGuest' });
  const joined = await guest.wait(m => m.type === 'connected');
  host.send({ type: 'start_match' }); await guest.wait(m => m.type === 'match_start');
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true, multiplayerRole: 'host',
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball' } });
  const refs = createInitialGrifballThreeRefs(); state.otherPlayers.clear(); state.grifball.phase = 'playing';
  onlineGrifball(state).localId = hosted.clientId; state.hostClientId = hosted.clientId;
  const actor = createRemoteCombatant({ id: joined.clientId, playerName: 'BallGuest', spawnZ: 0, spawnPos: new THREE.Vector3(), settings: state.settings });
  actor.team = 'red'; state.otherPlayers.set(actor.id, actor);
  const args = { state, refs, ballMeshRef: { current: null }, ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 },
    dt: 0.05, isMultiplayer: true, multiplayerSocket: host.socket as any, activeCustomMap: null, placeCombatantsAtGrifballSpawns() {}, pushStatsUpdate() {} };
  host.socket.on('message', raw => { const m = JSON.parse(String(raw));
    if (m.type === 'player_left') state.otherPlayers.delete(m.leftPlayerId);
    if (m.type === 'sync') receiveOnlineGrifballMessage(state, refs, m);
  });
  const timer = setInterval(() => updateGrifballObjectiveForState(args), 50); t.after(() => clearInterval(timer));
  let seq = 0;
  const input = (data: object) => guest.send({ type: 'sync', action: 'grifball_input', senderId: 'forged-host', senderRole: 'host', objectiveInput: {
    sequence: ++seq, round: 1, possession: onlineGrifball(state).possession, pickup: false, charging: false, ...data } });
  input({ pickup: true });
  const held = await guest.wait(m => m.objective?.match.ball.holderId === actor.id);
  assert.equal(held.senderId, hosted.clientId);
  input({ charging: true });
  await guest.wait(m => m.objective?.charge > 0.2);
  input({ release: { yaw: 0 } });
  const thrown = await guest.wait(m => m.objective?.match.ball.state === 'thrown');
  assert.equal(thrown.objective.release.actorId, actor.id);
  const spectator = await connect(); spectator.send({ type: 'join', targetIpOrId: hosted.keys[0], isObserver: true });
  await spectator.wait(m => m.type === 'connected');
  await spectator.wait(m => m.objective?.release?.actorId === actor.id);
  guest.send({ type: 'sync', action: 'grifball_state', objective: { ...thrown.objective, sequence: 999999 } });
  await new Promise(r => setTimeout(r, 150));
  assert.equal(spectator.messages.some(m => m.objective?.sequence === 999999), false);
  assert.equal(host.messages.some(m => m.objective?.sequence === 999999), false);
  // Reacquire at the authoritative position, then disconnect the carrier.
  state.grifball.ball.state = 'loose'; state.grifball.ball.pos = { x: 0, y: 0.35, z: 0 }; state.grifball.ball.vel = { x: 0, y: 0, z: 0 };
  const before = onlineGrifball(state).sequence; input({ pickup: true });
  await guest.wait(m => m.objective?.sequence > before && m.objective?.match.ball.holderId === actor.id);
  guest.socket.close();
  await spectator.wait(m => m.objective?.sequence > before && m.objective?.match.ball.state === 'loose');
  assert.equal(state.grifball.ball.holderId, null);
});
