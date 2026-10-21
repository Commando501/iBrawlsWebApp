import type { GrifballRuntimeState } from './runtimeState';
import type { GrifballThreeRefs } from './threeRefs';
import { isGrifballInput, isGrifballSnapshot, GRIFBALL_RULE_KEYS, GRIFBALL_BOOLEAN_RULE_KEYS, type GrifballInput, type GrifballSnapshot } from '../../network/grifballSync';
import { throwBall } from '../../game/grifballBall';
import { getForwardHeadingForYaw } from '../../game/yaw';
import { resolveRunnerThrowAllowed } from '../../game/runnerBallSettings';
import { dropGrifballForWeaponSwap, setGrifballCarrierForState } from './grifballObjectiveRuntime';

type PeerInput = { sequence: number; charging: boolean; elapsed: number; age: number };
export interface OnlineGrifballState {
  localId: string;
  sequence: number;
  receivedSequence: number;
  possession: number;
  lastHolder: string | null;
  sendTimer: number;
  inputSequence: number;
  peers: Map<string, PeerInput>;
  pending?: GrifballSnapshot;
  release: GrifballSnapshot['release'];
  visualRelease?: GrifballSnapshot['release'];
  seenRelease: number;
}
export function onlineGrifball(state: GrifballRuntimeState): OnlineGrifballState {
  return state.onlineGrifball ??= { localId: '', sequence: 0, receivedSequence: -1, possession: 0,
    lastHolder: null, sendTimer: 0, inputSequence: 0, peers: new Map(), release: null, seenRelease: 0 };
}
export function isOnlineGrifballAuthority(state: GrifballRuntimeState): boolean {
  return state.multiplayerRole === 'host' || !!(state.onlineGrifball?.localId && state.hostClientId === state.onlineGrifball.localId);
}
const send = (socket: WebSocket | null | undefined, value: unknown) => {
  if (socket?.readyState === 1) socket.send(JSON.stringify(value));
};
export function sendGrifballInput(state: GrifballRuntimeState, socket: WebSocket | null | undefined, charging: boolean, release = false, drop = false) {
  const net = onlineGrifball(state);
  const input: GrifballInput = { sequence: ++net.inputSequence, round: state.grifball.roundNumber,
    possession: net.possession, pickup: state.playerPickupRequested, charging,
    ...(drop ? { drop: true } : {}),
    ...(release ? { release: { yaw: state.yaw } } : {}) };
  send(socket, { type: 'sync', action: 'grifball_input', objectiveInput: input });
  state.playerPickupRequested = false;
}
export function noteOnlineGrifballThrow(state: GrifballRuntimeState, actorId: string, charge: number) {
  if (!state.isMultiplayer) return;
  const net = onlineGrifball(state);
  net.release = { sequence: (net.release?.sequence ?? 0) + 1,
    actorId: actorId === 'player' ? net.localId : actorId, charge, age: 0 };
  net.visualRelease = { ...net.release, actorId };
}
/** Authenticated sender IDs/roles come from the relay, not the input payload. */
export function receiveOnlineGrifballMessage(state: GrifballRuntimeState, refs: GrifballThreeRefs, data: any): boolean {
  if (!['grifball_input', 'grifball_state'].includes(data.action)) return false;
  if (!state.isMultiplayer || state.settings.gameMode !== 'grifball') return true;
  const net = onlineGrifball(state);
  if (data.action === 'grifball_state') {
    if (isOnlineGrifballAuthority(state) || data.senderRole !== 'host' || !isGrifballSnapshot(data.objective)) return true;
    if (state.hostClientId && state.hostClientId !== data.senderId) return true;
    state.hostClientId = data.senderId;
    if (data.objective.sequence <= net.receivedSequence) return true;
    net.receivedSequence = data.objective.sequence;
    net.pending = data.objective;
    return true;
  }
  if (!isOnlineGrifballAuthority(state) || data.senderRole !== 'client' || !isGrifballInput(data.objectiveInput)) return true;
  const actor = state.otherPlayers.get(data.senderId), input: GrifballInput = data.objectiveInput;
  if (!actor || actor.isObserver) return true;
  const old = net.peers.get(actor.id);
  if (old && input.sequence <= old.sequence) return true;
  const peer: PeerInput = { sequence: input.sequence, charging: false, elapsed: old?.elapsed ?? 0, age: 0 };
  net.peers.set(actor.id, peer);
  if (actor.hp <= 0 || actor.respawnTimer > 0 || input.round !== state.grifball.roundNumber || state.grifball.phase !== 'playing') return true;
  if (input.pickup && input.possession === net.possession) actor.pickupRequested = true;
  if (state.grifball.ball.holderId !== actor.id || input.possession !== net.possession) return true;
  if (input.drop) {
    dropGrifballForWeaponSwap(state, refs, actor.id);
    peer.elapsed = 0;
    return true;
  }
  if (!resolveRunnerThrowAllowed(state.settings)) return true;
  peer.charging = input.charging;
  if (input.release) {
    const charge = Math.min(1, peer.elapsed / Math.max(0.001, state.settings.grifballChargeMax ?? 1.2));
    const min = state.settings.grifballPassSpeedMin ?? 9, max = state.settings.grifballPassSpeedMax ?? 26;
    const heading = getForwardHeadingForYaw(input.release.yaw);
    throwBall(state.grifball.ball, { x: actor.pos.x, y: actor.pos.y + 1.1, z: actor.pos.z }, { ...heading, y: 0 }, min + charge * (max - min));
    noteOnlineGrifballThrow(state, actor.id, charge);
    setGrifballCarrierForState({ state, refs, id: actor.id, carrying: false });
    peer.charging = false;
  }
  if (!peer.charging) peer.elapsed = 0;
  return true;
}
export function advanceOnlineGrifballCharges(state: GrifballRuntimeState, dt: number) {
  const net = onlineGrifball(state);
  if (net.release) net.release.age += dt;
  for (const [id, peer] of net.peers) {
    const actor = state.otherPlayers.get(id);
    if (!actor) { net.peers.delete(id); continue; }
    peer.age += dt;
    if (state.grifball.ball.holderId !== id || peer.age > 1 || state.grifball.phase !== 'playing') {
      peer.charging = false; peer.elapsed = 0;
    }
    if (peer.charging) peer.elapsed += dt;
    actor.grifballPassCharge = Math.min(1, peer.elapsed / Math.max(0.001, state.settings.grifballChargeMax ?? 1.2));
  }
}
export function publishOnlineGrifball(state: GrifballRuntimeState, socket: WebSocket | null | undefined, dt: number) {
  const net = onlineGrifball(state), ball = state.grifball.ball;
  const changed = net.lastHolder !== ball.holderId;
  if (changed) { net.possession++; net.lastHolder = ball.holderId; }
  net.sendTimer += dt;
  if (!changed && net.sendTimer < 0.05) return;
  net.sendTimer = 0;
  const snapshot: GrifballSnapshot = {
    sequence: ++net.sequence, possession: net.possession,
    match: { ...state.grifball, ball: { ...ball, holderId: ball.holderId === 'player' ? net.localId : ball.holderId,
      ...(ball.releaseOwnerId ? { releaseOwnerId: ball.releaseOwnerId === 'player' ? net.localId : ball.releaseOwnerId } : {}) } },
    goals: { blue: state.teamScores.blue.goals, red: state.teamScores.red.goals },
    charge: ball.holderId === 'player' ? state.grifballPassCharge : state.otherPlayers.get(ball.holderId ?? '')?.grifballPassCharge ?? 0,
    release: net.release,
    rules: Object.fromEntries([...GRIFBALL_RULE_KEYS, ...GRIFBALL_BOOLEAN_RULE_KEYS].map(k => [k, state.settings[k]])),
  };
  send(socket, { type: 'sync', action: 'grifball_state', objective: snapshot });
}
export function applyPendingOnlineGrifball(state: GrifballRuntimeState, refs: GrifballThreeRefs, resetRound: () => void): boolean {
  const net = onlineGrifball(state), snapshot = net.pending;
  if (!snapshot) return false;
  delete net.pending;
  const local = (id: string | null) => id && id === net.localId ? 'player' : id;
  const oldHolder = state.grifball.ball.holderId, holder = local(snapshot.match.ball.holderId);
  const reset = state.grifball.roundNumber !== snapshot.match.roundNumber;
  // Copy only objective rules; the host cannot overwrite unrelated local preferences.
  for (const k of [...GRIFBALL_RULE_KEYS, ...GRIFBALL_BOOLEAN_RULE_KEYS]) if (snapshot.rules[k] !== undefined) (state.settings as any)[k] = snapshot.rules[k];
  state.grifball = { ...snapshot.match, ball: { ...snapshot.match.ball, holderId: holder,
    ...(snapshot.match.ball.releaseOwnerId ? { releaseOwnerId: local(snapshot.match.ball.releaseOwnerId)! } : {}),
    pos: { ...snapshot.match.ball.pos }, vel: { ...snapshot.match.ball.vel }, home: { ...snapshot.match.ball.home } } };
  state.teamScores.blue.goals = snapshot.goals.blue;
  state.teamScores.red.goals = snapshot.goals.red;
  net.possession = snapshot.possession;
  if (oldHolder !== holder) {
    if (oldHolder) setGrifballCarrierForState({ state, refs, id: oldHolder, carrying: false });
    if (holder) setGrifballCarrierForState({ state, refs, id: holder, carrying: true });
  }
  for (const actor of state.otherPlayers.values()) {
    actor.grifballPassCharge = actor.id === holder ? snapshot.charge : 0;
    if (actor.id === holder) actor.activeWeapon = 'ball';
    else if (actor.activeWeapon === 'ball') actor.activeWeapon = 'hammer';
  }
  if (holder === 'player') state.activeWeapon = 'ball';
  else if (state.activeWeapon === 'ball') state.activeWeapon = 'hammer';
  if (snapshot.release && snapshot.release.sequence > net.seenRelease) {
    net.seenRelease = snapshot.release.sequence;
    // Late joiners do not replay an old release.
    if (snapshot.release.age < 0.46) net.visualRelease = { ...snapshot.release, actorId: local(snapshot.release.actorId)! };
  }
  if (reset) {
    state.playerHP = state.playerMaxHP; state.playerRespawnTimer = 0;
    state.playerSlideActive = false; state.isLunging = false;
    resetRound();
  }
  return oldHolder !== holder || reset;
}
