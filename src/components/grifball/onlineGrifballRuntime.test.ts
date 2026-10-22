import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createRemoteCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { updateGrifballObjectiveForState, throwPlayerGrifballPassForState, reconcileGrifballCarrierForState } from './grifballObjectiveRuntime';
import { onlineGrifball, receiveOnlineGrifballMessage, publishOnlineGrifball, applyPendingOnlineGrifball, isOnlineGrifballAuthority, sendGrifballInput } from './onlineGrifballRuntime';
import { allowGrifballMessage } from '../../network/grifballSync';
import type { CustomMapData } from '../../types';
import { attachBallTo, throwBall } from '../../game/grifballBall';
import { deflectBallWithHammerForState } from './hammerBallDeflectionRuntime';
import { swapPlayerWeaponForState } from './playerWeaponActions';
const noop = () => {};

test('idle input is coalesced while pickup, charge, release, drop and round changes remain immediate', () => {
  const c = fixture('client', 'c');
  const net = onlineGrifball(c.state);
  c.tick(0);
  for (let i = 0; i < 20; i++) c.tick(0.01);
  assert.equal(c.messages.length, 1);
  c.state.playerPickupRequested = true; c.tick(0);
  assert.equal(c.messages.at(-1).objectiveInput.pickup, true);
  assert.equal(c.state.playerPickupRequested, false);
  sendGrifballInput(c.state, c.socket, true);
  assert.equal(c.messages.at(-1).objectiveInput.charging, true);
  sendGrifballInput(c.state, c.socket, false, true);
  assert.deepEqual(c.messages.at(-1).objectiveInput.release, { yaw: c.state.yaw });
  sendGrifballInput(c.state, c.socket, false, false, true);
  assert.equal(c.messages.at(-1).objectiveInput.drop, true);
  c.state.grifball.roundNumber++; c.tick(0);
  net.possession++; c.tick(0);
  assert.equal(c.messages.length, 7);
  c.tick(0.25);
  assert.equal(c.messages.length, 8);
  assert.deepEqual(c.messages.map(m => m.objectiveInput.sequence), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('unchanged charging heartbeats maintain the authoritative charge', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c');
  h.peer('c'); h.input('c', 1, { pickup: true }); h.tick(); deliver(h, c);
  onlineGrifball(c.state).inputSequence = 1;
  c.args.ballChargingRef.current = true;
  c.messages.length = 0;
  for (let frame = 0; frame < 100; frame++) {
    const count = c.messages.length;
    c.tick(.02);
    if (c.messages.length > count) receiveOnlineGrifballMessage(h.state, h.refs, {
      ...c.messages.at(-1), senderId: 'c', senderRole: 'client',
    });
    h.tick(.02);
  }
  assert.ok(c.messages.length <= 9, 'unchanged input stays near four packets per second');
  assert.equal(h.state.otherPlayers.get('c')!.grifballPassCharge, 1);
});

test('a closed socket does not consume pickup intent or its sequence', () => {
  const c = fixture('client', 'c');
  c.state.playerPickupRequested = true;
  sendGrifballInput(c.state, { readyState: 3 } as WebSocket, false);
  assert.equal(c.state.playerPickupRequested, true);
  assert.equal(onlineGrifball(c.state).inputSequence, 0);
  sendGrifballInput(c.state, c.socket, false);
  assert.equal(c.messages[0].objectiveInput.pickup, true);
});
function fixture(role: 'host' | 'client' | 'observer', id: string) {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: true, multiplayerRole: role === 'observer' ? null : role,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', grifballCountdownDuration: 0.1, grifballRoundResetDelay: 0.1, grifballGoalTarget: 2 } });
  state.multiplayerRole = role; state.isObserverMode = role === 'observer'; state.hostClientId = 'h';
  state.otherPlayers.clear(); state.playerPos.set(0, 0, 0); state.grifball.phase = 'playing';
  onlineGrifball(state).localId = id;
  const refs = createInitialGrifballThreeRefs();
  const messages: any[] = [], socket = { readyState: 1, send: (s: string) => messages.push(JSON.parse(s)) } as unknown as WebSocket;
  let resets = 0;
  const args = { state, refs, ballMeshRef: { current: null as THREE.Mesh | null }, ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 },
    isMultiplayer: true, multiplayerSocket: socket, activeCustomMap: { arenaRadius: 60, objects: [
      { type: 'box', goalPlateTeam: 'blue', position: { x: 10, y: 0, z: 0 }, scale: { x: 2, y: 0.1, z: 2 } }
    ] } as CustomMapData, placeCombatantsAtGrifballSpawns: () => { resets++; state.playerPos.set(0, 0, 12); }, pushStatsUpdate: noop };
  const tick = (dt = 0.05) => updateGrifballObjectiveForState({ ...args, dt });
  const peer = (id: string, x = 0) => {
    const actor = createRemoteCombatant({ id, playerName: id, spawnZ: 0, spawnPos: new THREE.Vector3(x, 0, 0), settings: state.settings });
    actor.team = 'red'; state.otherPlayers.set(id, actor); return actor;
  };
  const input = (id: string, sequence: number, changes = {}) => receiveOnlineGrifballMessage(state, refs,
    { action: 'grifball_input', senderId: id, senderRole: 'client', objectiveInput: {
      sequence, round: state.grifball.roundNumber, possession: onlineGrifball(state).possession, pickup: false, charging: false, ...changes } });
  return { state, refs, args, socket, messages, tick, peer, input, resets: () => resets };
}
function deliver(host: ReturnType<typeof fixture>, follower: ReturnType<typeof fixture>) {
  const data = { ...host.messages.at(-1), senderId: 'h', senderRole: 'host' };
  assert.equal(allowGrifballMessage(data, 'host', 'grifball', true), true);
  receiveOnlineGrifballMessage(follower.state, follower.refs, data);
  follower.tick(0);
  return data;
}

test('runner swap requests a host-authorized drop and restores the pre-pickup sword on all peers', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  h.peer('c').activeWeapon = 'sword';
  o.peer('c').activeWeapon = 'sword';
  c.state.activeWeapon = 'sword';
  h.input('c', 1, { pickup: true });
  h.tick();
  deliver(h, c); deliver(h, o);
  h.state.settings.grifballAllowThrowing = false;
  // Input sequence 1 was used for the pickup sent above.
  onlineGrifball(c.state).inputSequence = 1;
  swapPlayerWeaponForState({
    state: c.state, refs: c.refs, type: 'hammer', isPaused: false, isPlaying: true,
    recordWeaponSwap: noop, pushStatsUpdate: noop, multiplayerSocket: c.socket,
  });
  const packet = c.messages.at(-1);
  assert.equal(packet.objectiveInput.drop, true);
  assert.equal(allowGrifballMessage(packet, 'client', 'grifball', true), true);
  assert.equal(c.state.activeWeapon, 'ball', 'client waits for the authoritative release');
  assert.equal(c.state.grifball.ball.holderId, 'player');
  receiveOnlineGrifballMessage(h.state, h.refs, { ...packet, senderId: 'c', senderRole: 'client' });
  assert.equal(h.state.grifball.ball.state, 'loose');
  assert.equal(h.state.otherPlayers.get('c')!.activeWeapon, 'sword');
  h.tick();
  deliver(h, c); deliver(h, o);
  assert.equal(c.state.activeWeapon, 'sword');
  assert.equal(c.state.grifball.ball.holderId, null);
  assert.equal(o.state.otherPlayers.get('c')!.activeWeapon, 'sword');
  assert.equal(onlineGrifball(h.state).peers.get('c')!.elapsed, 0);
});

test('stale and non-holder drop requests cannot release someone else’s ball', () => {
  const h = fixture('host', 'h');
  h.peer('c'); h.peer('d');
  h.input('c', 1, { pickup: true }); h.tick();
  h.input('d', 1, { drop: true });
  h.input('c', 2, { drop: true, possession: onlineGrifball(h.state).possession - 1 });
  h.input('c', 3, { drop: true, round: h.state.grifball.roundNumber + 1 });
  assert.equal(h.state.grifball.ball.holderId, 'c');
  assert.equal(allowGrifballMessage({
    action: 'grifball_input', objectiveInput: {
      sequence: 4, round: 1, possession: 1, pickup: false, charging: false, drop: 'yes',
    },
  }, 'client', 'grifball', true), false);
});

test('hammer deflection flight and mechanics settings reach clients and observers', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  h.state.settings.hammerBallDeflectionStrength = 2.25;
  throwBall(h.state.grifball.ball, { x: 0, y: 1, z: 3 }, { x: 0, y: 0, z: -1 }, 20, 0);
  assert.equal(deflectBallWithHammerForState(h.state, h.state.playerPos, h.state.grifball.ball.pos, 4.5), true);
  publishOnlineGrifball(h.state, h.socket, 1);
  for (const follower of [c, o]) {
    deliver(h, follower);
    assert.deepEqual(follower.state.grifball.ball.vel, h.state.grifball.ball.vel);
    assert.equal(follower.state.settings.hammerBallDeflectionStrength, 2.25);
    assert.equal(follower.state.settings.hammerBallDeflectionEnabled, true);
  }
  h.state.settings.hammerBallDeflectionEnabled = false;
  publishOnlineGrifball(h.state, h.socket, 1);
  deliver(h, c);
  assert.equal(c.state.settings.hammerBallDeflectionEnabled, false);
});

test('host-authored ball deflection is identical on clients and observers', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  h.state.playerPos.set(20, 0, 20);
  h.peer('c'); c.peer('h'); o.peer('c');
  throwBall(h.state.grifball.ball, { x: 0, y: 1, z: 4 }, { x: 0, y: 0, z: -1 }, 30, 0);
  h.tick(.15);
  assert.ok(h.state.grifball.ball.vel.z > 0, 'host resolves the body impact');
  deliver(h, c); deliver(h, o);
  assert.deepEqual(c.state.grifball.ball.pos, h.state.grifball.ball.pos);
  assert.deepEqual(o.state.grifball.ball.vel, h.state.grifball.ball.vel);
  const before = structuredClone(c.state.grifball.ball);
  c.tick(.2);
  assert.deepEqual(c.state.grifball.ball, before, 'followers do not simulate another collision');
});

test('thrower clearance uses socket identities and maps the local thrower on receipt', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  for (const holder of ['player', 'c']) {
    attachBallTo(h.state.grifball.ball, holder);
    throwBall(h.state.grifball.ball, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }, 10);
    publishOnlineGrifball(h.state, h.socket, .1);
    const packet = deliver(h, c); deliver(h, o);
    const wireId = holder === 'player' ? 'h' : 'c';
    assert.equal(packet.objective.match.ball.releaseOwnerId, wireId);
    assert.equal(c.state.grifball.ball.releaseOwnerId, wireId === 'c' ? 'player' : wireId);
    assert.equal(o.state.grifball.ball.releaseOwnerId, wireId);
  }
});
test('host resolves competing pickups once; clients and spectators map the same holder', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  h.peer('c'); h.peer('d', 0.2); c.peer('h'); o.peer('c');
  h.input('c', 1, { pickup: true }); h.input('d', 1, { pickup: true }); h.tick();
  assert.equal(h.state.grifball.ball.holderId, 'c');
  deliver(h, c); deliver(h, o);
  assert.equal(c.state.grifball.ball.holderId, 'player'); assert.equal(c.state.activeWeapon, 'ball');
  assert.equal(o.state.grifball.ball.holderId, 'c'); assert.equal(o.state.otherPlayers.get('c')?.activeWeapon, 'ball');
  c.state.playerPos.set(10, 0, 0); c.tick(0.5);
  assert.equal(c.state.teamScores.red.goals, 0, 'followers cannot award their own goal');
});
test('charge, release and duplicate rejection preserve one host-authored flight', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'), o = fixture('observer', 'o');
  h.peer('c'); o.peer('c'); h.input('c', 1, { pickup: true }); h.tick(); deliver(h, c);
  h.input('c', 2, { charging: true }); h.tick(0.6); deliver(h, o);
  assert.ok(o.state.otherPlayers.get('c')!.grifballPassCharge! > 0.4);
  const possession = onlineGrifball(h.state).possession;
  h.input('c', 3, { release: { yaw: 0 } });
  const velocity = { ...h.state.grifball.ball.vel };
  assert.ok(velocity.z < -9 && velocity.z > -26);
  h.input('c', 3, { release: { yaw: Math.PI } });
  assert.deepEqual(h.state.grifball.ball.vel, velocity);
  h.tick(); deliver(h, c); deliver(h, o);
  assert.equal(c.state.activeWeapon, 'hammer'); assert.equal(c.state.grifball.ball.state, 'thrown');
  assert.equal(onlineGrifball(c.state).visualRelease?.actorId, 'player');
  assert.equal(onlineGrifball(o.state).visualRelease?.actorId, 'c');
  assert.ok(onlineGrifball(h.state).possession > possession);
});
test('client release sends intent and keeps ownership until host confirms', () => {
  const c = fixture('client', 'c'); c.state.grifball.ball.state = 'held'; c.state.grifball.ball.holderId = 'player'; c.state.activeWeapon = 'ball';
  c.args.ballChargingRef.current = true; c.args.ballChargeTimerRef.current = 1;
  throwPlayerGrifballPassForState({ ...c.args, playSwing: noop });
  assert.equal(c.messages.at(-1).action, 'grifball_input');
  assert.ok(c.messages.at(-1).objectiveInput.release);
  assert.equal(c.state.grifball.ball.state, 'held'); assert.equal(c.args.ballChargingRef.current, false);
});
test('dead, distant, observer, stale-round and non-holder requests cannot claim or throw', () => {
  const h = fixture('host', 'h'); const c = h.peer('c', 30);
  h.input('c', 1, { pickup: true }); h.tick(); assert.equal(h.state.grifball.ball.holderId, null);
  c.pos.set(0, 0, 0); c.hp = 0; h.input('c', 2, { pickup: true }); h.tick(); assert.equal(h.state.grifball.ball.holderId, null);
  c.hp = 1; c.isObserver = true; h.input('c', 3, { pickup: true }); h.tick(); assert.equal(h.state.grifball.ball.holderId, null);
  c.isObserver = false; h.input('c', 4, { pickup: true, round: 0 }); h.tick(); assert.equal(h.state.grifball.ball.holderId, null);
  h.input('c', 5, { release: { yaw: 0 } }); assert.equal(h.state.grifball.ball.state, 'idle');
});
test('death, disconnect and spectating drop possession; untouched ball returns home', () => {
  for (const cause of ['death', 'disconnect', 'observer']) {
    const h = fixture('host', 'h'), c = h.peer('c'); h.input('c', 1, { pickup: true }); h.tick();
    c.pos.set(4, 0, 0); h.tick();
    if (cause === 'death') c.hp = 0;
    if (cause === 'disconnect') h.state.otherPlayers.delete('c');
    if (cause === 'observer') c.isObserver = true;
    h.tick(); assert.equal(h.state.grifball.ball.state, 'loose', cause);
    assert.equal(h.state.grifball.ball.holderId, null); assert.equal(h.state.grifball.ball.pos.x, 4);
    h.tick(9); assert.equal(h.state.grifball.ball.state, 'idle');
  }
});
test('goal scores once, resets every peer, and late join gets the current round and score', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'); const actor = h.peer('c');
  h.input('c', 1, { pickup: true }); h.tick(); deliver(h, c);
  actor.pos.set(10, 0, 0); h.tick(); deliver(h, c);
  assert.equal(h.state.teamScores.red.goals, 1); assert.equal(c.state.teamScores.red.goals, 1);
  assert.equal(c.state.grifball.phase, 'scored');
  h.tick(0.1); deliver(h, c); assert.equal(h.resets(), 1); assert.equal(c.resets(), 1);
  assert.equal(c.state.grifball.roundNumber, 2); assert.equal(c.state.grifball.phase, 'countdown');
  const late = fixture('observer', 'late'); deliver(h, late);
  assert.equal(late.state.teamScores.red.goals, 1); assert.equal(late.state.grifball.roundNumber, 2);
  h.tick(0.1); assert.equal(h.state.teamScores.red.goals, 1);
});
test('forged and out-of-order snapshots cannot rewind possession or scores', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c'); h.tick(); const first = deliver(h, c);
  h.state.teamScores.blue.goals = 1; h.tick(); deliver(h, c);
  receiveOnlineGrifballMessage(c.state, c.refs, first); c.tick(0);
  assert.equal(c.state.teamScores.blue.goals, 1);
  const fake = { ...first, senderRole: 'client', objective: { ...first.objective, sequence: 999 } };
  receiveOnlineGrifballMessage(c.state, c.refs, fake); c.tick(0); assert.equal(c.state.teamScores.blue.goals, 1);
  assert.equal(allowGrifballMessage(fake, 'client', 'grifball', true), false);
  assert.equal(allowGrifballMessage(first, 'host', 'grifball', false), false);
  assert.equal(allowGrifballMessage({ action: 'grifball_input', objectiveInput: { sequence: 1, round: 1, possession: 0, pickup: true, charging: false } }, 'observer', 'grifball', true), false);
  assert.equal(allowGrifballMessage({ ...first, objective: { ...first.objective, charge: NaN } }, 'host', 'grifball', true), false);
});
test('room host retains objective authority while spectating', () => {
  const h = fixture('host', 'h'); h.state.playerPickupRequested = true; h.tick();
  h.state.playerPos.set(4, 0, 3); h.tick();
  h.state.multiplayerRole = 'observer'; h.state.isObserverMode = true;
  h.state.playerPos.set(0, 6, 17);
  assert.equal(isOnlineGrifballAuthority(h.state), true); h.tick();
  assert.equal(h.state.grifball.ball.holderId, null); assert.equal(h.messages.at(-1).action, 'grifball_state');
  assert.equal(h.state.grifball.ball.pos.x, 4); assert.equal(h.state.grifball.ball.pos.z, 3);
});


test('winning goal and match end are shared without another round reset', () => {
  const h = fixture('host', 'h'), c = fixture('client', 'c');
  const actor = h.peer('c'); h.state.teamScores.red.goals = 1;
  h.input('c', 1, { pickup: true }); h.tick(); actor.pos.set(10, 0, 0); h.tick(); deliver(h, c);
  assert.equal(c.state.grifball.winningTeam, 'red');
  h.tick(0.1); deliver(h, c);
  assert.equal(c.state.grifball.phase, 'matchEnd'); assert.equal(c.state.teamScores.red.goals, 2);
  assert.equal(c.resets(), 0); assert.equal(h.resets(), 0);
  h.input('c', 2, { pickup: true, release: { yaw: 0 } }); h.tick();
  assert.equal(h.state.grifball.ball.holderId, null); assert.equal(h.state.teamScores.red.goals, 2);
});

test('cancelled charge and stale possession inputs cannot leak into a later throw', () => {
  const h = fixture('host', 'h'), actor = h.peer('c');
  h.input('c', 1, { pickup: true }); h.tick();
  const oldPossession = onlineGrifball(h.state).possession;
  h.input('c', 2, { charging: true }); h.tick(0.6);
  h.input('c', 3, { charging: false }); h.tick(); assert.equal(actor.grifballPassCharge, 0);
  actor.hp = 0; h.tick(); actor.hp = 1;
  h.input('c', 4, { pickup: true }); h.tick();
  h.input('c', 5, { release: { yaw: 0 }, possession: oldPossession });
  assert.equal(h.state.grifball.ball.state, 'held');
  h.input('c', 6, { release: { yaw: 0 } });
  assert.equal(onlineGrifball(h.state).release?.charge, 0);
  assert.equal(h.state.grifball.ball.vel.z, -(h.state.settings.grifballPassSpeedMin ?? 9));
});
