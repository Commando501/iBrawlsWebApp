import { canCombatantsDamage } from '../../src/game/combatDamage';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { triggerPlayerSwordLungeForState, findPlayerSwordLungeHitTargetForState } from '../../src/components/grifball/playerWeaponActions';
import { updatePlayerSwordLungeForState } from '../../src/components/grifball/playerSwordLungeRuntime';
import { executeMainAITradeForState } from '../../src/components/grifball/tradeRuntime';
import { constrainCombatantToArenaBounds } from '../../src/components/grifball/arenaBounds';
import { reconcileGrifballCarrierForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { seededRandom, withSimulationRandom } from '../../src/game/simulationRandom';

const noop = () => {};
const identities = ['registered-main', 'legacy-main', 'regular', 'main-without-lookup'] as const;
type Identity = typeof identities[number];

/** Real live flight/weapon/respawn owners; no headless parity claims. */
function fixture(identity: Identity, hp = 2) {
  const f = createBotParityFixture('bystander', false, { gameMode: 'grifball', enableSwordTrade: false,
    enableHammerSwordTrade: false, swordLungeSpeed: 24, swordLungeReload: .6 }, identity === 'regular' ? 'victim' : 'main_ai');
  const { state, target } = f;
  f.bot.pos.set(50, 0, 50); f.bot.team = 'blue';
  state.playerPos.set(0, 0, 0); state.playerVel.set(0, 0, 0); state.activeWeapon = 'sword'; state.localPlayerTeam = 'blue';
  state.swapCooldownTimer = state.playerDashRemaining = 0; state.arenaRadius = 100;
  state.scorePlayer = state.playerKills = state.enemyDeaths = state.enemyKills = state.scoreEnemy = state.playerDeaths = 0;
  state.lastDeaths = []; state.playerHP = state.playerMaxHP = 2;
  target.pos.set(0, 0, 5); target.hp = target.maxHp = hp; target.deaths = target.kills = target.score = 0;
  target.aiState = 'APPROACHING'; target.activeWeapon = 'hammer'; target.weaponState = 'ready';
  if (identity === 'legacy-main') state.otherPlayers.delete(target.id);
  const mainAi = identity === 'regular' || identity === 'main-without-lookup' ? undefined : target;
  const network = { socket: null as WebSocket | null };
  const events = { counter: 0, outgoing: [] as string[], ends: [] as boolean[], starts: [] as number[], trades: [] as string[], calibration: [] as string[], medals: [] as string[] };
  const effects = { state, playExplosion: noop, playDeath: noop, playSwing: noop, spawnVoxelShockwaveParticles: noop,
    pushStatsUpdate: noop, recordBotCalibrationDeath: (id: string) => { events.calibration.push(id); },
    evaluatePlayerKillMedals: (id: string) => { events.medals.push(id); return []; } };
  const hostile = (a: string, b: string) => canCombatantsDamage(a, b);
  const start = () => triggerPlayerSwordLungeForState({ state, lockTarget: target, recordLungeStart: d => { events.starts.push(d); }, playDash: noop, sendSync: noop });
  let tick = 0;
  const random = seededRandom(55);
  const step = (dt = 1 / 60) => withSimulationRandom(random, ++tick / 60, () => updatePlayerSwordLungeForState({
    ...effects, dt, isMultiplayer: state.isMultiplayer, activeCustomMap: null, multiplayerSocket: network.socket, getMainAi: () => mainAi,
    canCombatantsDamage: hostile, constrainCombatantToArena: (pos, vel) => {
      constrainCombatantToArenaBounds({ pos, vel, activeCustomMap: null, arenaRadius: state.arenaRadius });
    }, renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: hit => { events.ends.push(hit); },
    recordPlayerCounterSuccess: () => { events.counter++; }, recordPlayerDamageDealt: noop, applyOutgoingMultiplayerHitLocally: id => { events.outgoing.push(id); },
    executeTrade: reason => { events.trades.push(reason); executeMainAITradeForState({ ...effects, mainAi, reason }); },
  }));
  const finish = () => { let frames = 0; while (state.isLunging && frames < 90) { step(); frames++; } return frames; };
  const select = () => findPlayerSwordLungeHitTargetForState({ state, mainAi, isMultiplayer: false, canCombatantsDamage: hostile });
  return { ...f, events, network, start, step, finish, select };
}

for (const identity of identities) for (const velocityY of [-6, 0, 6]) {
  test(`player trade/${identity}/${velocityY}: surviving roster flight stops drifting and reloads`, () => {
    const f = fixture(identity), { state, target } = f;
    target.pos.set(0, velocityY === 0 ? 0 : .5, 1);
    target.vel.set(10, velocityY, 24);
    target.activeWeapon = 'sword'; target.isLunging = true; target.aiState = 'LUNGING';
    state.settings.enableSwordTrade = true;
    f.start(); f.step();
    assert.equal(target.hp, 1); assert.equal(state.playerHP, 1);
    assert.equal(target.isLunging, false);
    assert.deepEqual(target.vel.toArray(), [0, Math.min(velocityY, 0), 0]);
    assert.equal(target.isJumping, velocityY !== 0);
    assert.equal(target.aiState, 'COOLDOWN');
    assert.equal(target.aiTimer, state.settings.swordLungeReload);
    assert.deepEqual(f.events.ends, [true]);
  });
}

for (const identity of [...identities, 'remote'] as const) for (const weapon of ['sword', 'hammer'] as const)
  for (const shield of [1, 1 / 60]) test(`player flight shield/${identity}/${weapon}/${shield}: active protection and exact-frame expiry`, t => {
    const f = fixture(identity === 'remote' ? 'regular' : identity), { state, target } = f;
    target.pos.z = 1; target.activeWeapon = weapon; target.weaponState = 'swing_up';
    state.playerInvulnerabilityTimer = shield;
    state.settings.enableSwordTrade = state.settings.enableHammerSwordTrade = true;
    const sent: unknown[] = [];
    if (identity === 'remote') {
      const previous = globalThis.WebSocket;
      globalThis.WebSocket = { OPEN: 1 } as typeof WebSocket;
      t.after(() => { globalThis.WebSocket = previous; });
      state.isMultiplayer = true; target.controller = 'remote';
      f.network.socket = { readyState: 1, send: (message: string) => sent.push(JSON.parse(message)) } as unknown as WebSocket;
    }
    f.start(); f.step();
    const expires = shield === 1 / 60;
    assert.equal(state.playerInvulnerabilityTimer, Math.max(0, shield - 1 / 60));
    assert.equal(state.playerHP, expires ? 1 : 2, 'active shields prevent reciprocal damage; expiry enables trades');
    assert.equal(target.hp, identity === 'remote' ? 2 : 1, 'ordinary hit still lands, remote damage awaits acknowledgement');
    assert.equal(state.playerDeaths, 0); assert.equal(target.kills, 0);
    assert.equal(sent.length, Number(identity === 'remote'));
    assert.deepEqual(f.events.ends, [true]);
    assert.equal(state.pSwordState, 'recovering');
    const afterContact = state.playerInvulnerabilityTimer;
    f.step();
    assert.equal(state.playerInvulnerabilityTimer, afterContact, 'inactive flight does not own shield countdown');
    assert.deepEqual(f.events.ends, [true]);
  });

for (const identity of identities) for (const hp of [1, 2]) for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  test(`player flight/${identity}/hp=${hp}/yaw=${yaw}: contact, credit, recovery and revival`, () => {
    const f = fixture(identity, hp), { state, target, events } = f;
    target.pos.set(Math.sin(yaw) * 5, 0, Math.cos(yaw) * 5);
    target.isLunging = true; target.weaponState = 'swing_down'; target.weaponTimer = .1;
    f.start(); assert.deepEqual(events.starts, [5]);
    assert.equal(f.finish(), 9, '24 units/s reaches the 1.5-unit contact radius on frame nine');
    assert.equal(target.hp, hp - 1); assert.deepEqual(events.ends, [true]);
    assert.equal(state.pSwordState, 'recovering'); assert.equal(state.pSwordReady, false); assert.equal(state.pSwordRecoverDuration, .6);
    assert.equal(state.playerKills, hp === 1 ? 1 : 0); assert.equal(target.deaths, hp === 1 ? 1 : 0);
    assert.equal(state.enemyDeaths, hp === 1 && identity !== 'regular' ? 1 : 0);
    assert.equal(state.lastDeaths.length, hp === 1 ? 1 : 0);
    if (hp === 1) {
      assert.equal(target.aiState, 'RESPAWNING'); assert.equal(target.respawnTimer, 3); assert.equal(target.isLunging, false);
      assert.equal(target.weaponState, 'ready'); assert.equal(target.weaponTimer, 0);
      assert.deepEqual(events.medals, [target.id]);
      assert.deepEqual(events.calibration, identity === 'regular' ? [] : ['main_ai']);
    } else assert.equal(target.isLunging, true, 'a non-trade surviving defender retains its attack');
    const pos = state.playerPos.clone(); f.step();
    assert.deepEqual(events.ends, [true]); assert.equal(target.hp, hp - 1); assert.ok(state.playerPos.equals(pos));
    // The actual animation owner advances the authored recovery duration.
    f.weaponFrame(.59); assert.equal(state.pSwordReady, false);
    f.weaponFrame(.02); assert.equal(state.pSwordState, 'ready');
    if (hp === 1 && identity !== 'legacy-main') {
      f.respawns(2.99); assert.equal(target.hp, 0);
      f.respawns(.02); assert.equal(target.hp, target.maxHp); assert.equal(target.respawnTimer, 0);
      assert.ok(target.invulnerabilityTimer > 0); assert.equal(target.deaths, 1);
    }
  });
}

for (const identity of identities) for (const excluded of ['shield', 'dead', 'respawn-clock', 'respawn-state', 'observer'] as const) {
  test(`player flight/${identity}: excludes ${excluded} from contact selection`, () => {
    const f = fixture(identity), { target, state } = f;
    f.bot.isObserver = true; // Isolate this victim; living allies now count as contacts.
    target.pos.z = 1;
    if (excluded === 'shield') target.invulnerabilityTimer = 1;
    if (excluded === 'dead') target.hp = 0;
    if (excluded === 'respawn-clock') target.respawnTimer = 1;
    if (excluded === 'respawn-state') target.aiState = 'RESPAWNING';
    if (excluded === 'observer') target.isObserver = true;
    const hp = target.hp;
    assert.equal(f.select().closestTarget, null);
    f.start(); f.step(); assert.deepEqual(f.events.ends, [false]); assert.equal(target.hp, hp);
    assert.equal(state.playerKills, 0); assert.equal(state.pSwordState, 'recovering');
  });
}

for (const reason of ['dead-player', 'respawning-player', 'observer-player'] as const) test(`player flight: cancels ${reason} without movement or contact`, () => {
  const f = fixture('registered-main'); f.target.pos.z = 1; f.start();
  if (reason === 'dead-player') f.state.playerHP = 0;
  if (reason === 'respawning-player') f.state.playerRespawnTimer = 1;
  if (reason === 'observer-player') f.state.isObserverMode = true;
  f.step(); assert.deepEqual(f.events.ends, [false]); assert.equal(f.target.hp, 2);
  assert.deepEqual(f.state.playerPos.toArray(), [0, 0, 0]);
  f.step(); assert.deepEqual(f.events.ends, [false]);
});

for (const mainFirst of [true, false]) test(`player flight: skips shielded main AI and contacts the nearest eligible opponent, mainFirst=${mainFirst}`, () => {
  const f = fixture('registered-main'), { state, target, bot } = f;
  target.pos.z = .8; target.invulnerabilityTimer = 1; bot.team = 'red'; bot.pos.set(0, 0, 1.5); bot.hp = 2;
  state.otherPlayers.clear(); for (const c of mainFirst ? [target, bot] : [bot, target]) state.otherPlayers.set(c.id, c);
  assert.equal(f.select().closestTarget?.id, bot.id);
  f.start(); f.step(); assert.equal(target.hp, 2); assert.equal(bot.hp, 1); assert.deepEqual(f.events.ends, [true]);
});

for (const identity of ['registered-main', 'regular'] as const) for (const kind of ['ordinary', 'sword', 'hammer', 'future', 'shield', 'closed'] as const) {
  test(`player flight multiplayer/${identity}/${kind}: preserves one outgoing hit and local trade recovery`, t => {
    const previous = globalThis.WebSocket;
    globalThis.WebSocket = { OPEN: 1 } as typeof WebSocket;
    t.after(() => { globalThis.WebSocket = previous; });
    const f = fixture(identity), { state, target } = f;
    const sent: { targetId: string; action: string; damage: number }[] = [];
    f.network.socket = { readyState: kind === 'closed' ? 3 : 1, send: (payload: string) => sent.push(JSON.parse(payload)) } as unknown as WebSocket;
    state.isMultiplayer = true; target.controller = 'remote'; target.pos.z = 1;
    f.bot.isObserver = true;
    state.settings.enableSwordTrade = state.settings.enableHammerSwordTrade = true;
    if (kind === 'sword' || kind === 'hammer') { target.activeWeapon = kind; target.weaponState = 'swing_up'; }
    if (kind === 'future') target.lastHammerAttackTime = 2_000_000;
    if (kind === 'shield') target.invulnerabilityTimer = 1;
    f.start(); f.step();
    const trade = kind === 'sword' || kind === 'hammer';
    const hit = kind !== 'shield' && kind !== 'closed';
    assert.equal(sent.length, Number(hit)); assert.equal(f.events.outgoing.length, Number(hit));
    if (hit) { assert.equal(sent[0].targetId, target.id); assert.equal(sent[0].damage, 1); assert.equal(sent[0].action, 'hit_taken'); }
    assert.equal(target.hp, 2, 'network acknowledgement owns remote damage');
    assert.equal(state.playerHP, trade ? 1 : 2); assert.equal(state.playerDeaths, 0);
    assert.equal(state.pSwordState, 'recovering'); assert.equal(state.pSwordReady, false);
    assert.deepEqual(f.events.ends, [kind !== 'shield']);
    f.step(); assert.equal(sent.length, Number(hit)); assert.equal(f.events.ends.length, 1);
  });
}

for (const identity of identities) for (const reason of ['timeout-hit', 'distance-hit', 'boundary-hit', 'timeout-miss', 'boundary-miss', 'missing-at-boundary'] as const) {
  test(`player flight/${identity}: records exactly one outcome for ${reason}`, () => {
    const f = fixture(identity), { state, target } = f;
    target.pos.z = reason.endsWith('hit') ? 1 : 50;
    f.start();
    if (reason.startsWith('timeout')) state.lungeTimer = .8;
    if (reason.startsWith('distance')) state.lungeStartPos.z = -17;
    if (reason.includes('boundary')) state.arenaRadius = 1;
    if (reason === 'missing-at-boundary') target.hp = 0;
    f.step(); assert.deepEqual(f.events.ends, [reason.endsWith('hit')]);
    assert.equal(state.isLunging, false); assert.equal(state.pSwordState, 'recovering');
    f.step(); assert.equal(f.events.ends.length, 1);
  });
}

for (const identity of ['registered-main', 'main-without-lookup', 'regular'] as const) test(`player flight/${identity}: killed carrier releases the ball once`, () => {
  const f = fixture(identity), { state, target, refs } = f;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = target.id;
  setGrifballCarrierForState({ state, id: target.id, carrying: true }); target.hp = 1;
  f.start(); f.finish(); assert.equal(target.hp, 0);
  const args = { state, refs, ballMeshRef: { current: null }, ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } };
  assert.equal(reconcileGrifballCarrierForState(args), true); assert.equal(state.grifball.ball.holderId, null);
  assert.equal(state.grifball.ball.state, 'loose'); assert.equal(target.respawnTimer, 3); assert.equal(target.activeWeapon, 'hammer');
  assert.equal(reconcileGrifballCarrierForState(args), false);
});

for (const identity of identities) for (const weapon of ['sword', 'hammer'] as const) for (const hp of [1, 2]) for (const playerHp of [1, 2]) {
  test(`player flight trade/${identity}/${weapon}/hp=${playerHp}:${hp}: only actual deaths get credit and feed entries`, () => {
    const f = fixture(identity, hp), { state, target } = f;
    target.pos.z = 1; target.activeWeapon = weapon; target.weaponState = 'swing_up';
    state.settings.enableSwordTrade = state.settings.enableHammerSwordTrade = true; state.playerHP = playerHp;
    f.start(); f.step();
    assert.deepEqual(f.events.trades, ['registered-main', 'legacy-main'].includes(identity)
      ? [weapon === 'sword' ? 'sword_vs_sword' : 'sword_lunge_vs_hammer'] : []);
    assert.deepEqual([state.playerHP, target.hp], [playerHp - 1, hp - 1]); assert.deepEqual(f.events.ends, [true]);
    assert.equal(target.kills, playerHp === 1 ? 1 : 0); assert.equal(target.deaths, hp === 1 ? 1 : 0);
    assert.equal(state.playerKills, hp === 1 ? 1 : 0); assert.equal(state.enemyDeaths, hp === 1 && identity !== 'regular' ? 1 : 0);
    assert.equal(state.playerDeaths, playerHp === 1 ? 1 : 0); assert.equal(state.enemyKills, playerHp === 1 && identity !== 'regular' ? 1 : 0);
    assert.equal(state.lastDeaths.length, Number(hp === 1) + Number(playerHp === 1));
    assert.equal(target.isLunging, false); assert.equal(target.weaponState, 'ready');
    if (hp === 1) { assert.equal(target.respawnTimer, 3); assert.equal(target.aiState, 'RESPAWNING'); }
    if (playerHp === 1) assert.equal(state.playerRespawnTimer, 3);
    else { assert.equal(state.pSwordState, 'recovering'); assert.equal(state.pSwordReady, false); }
    f.step(); assert.equal(f.events.trades.length, ['registered-main', 'legacy-main'].includes(identity) ? 1 : 0); assert.deepEqual(f.events.ends, [true]);
  });
}

for (const identity of identities) for (const weapon of ['sword', 'hammer'] as const) for (const history of ['zero', 'future', 'expired', 'recent', 'boundary', 'disabled', 'live-flight', 'stale-ai-state'] as const) {
  test(`player flight trade/${identity}/${weapon}/${history}: uses eligible committed or recent attacks`, () => {
    const f = fixture(identity), { state, target } = f;
    target.pos.z = 1; target.activeWeapon = weapon;
    state.settings.enableSwordTrade = state.settings.enableHammerSwordTrade = history !== 'disabled';
    const now = 1_000_000 + 1000 / 60;
    const time = history === 'zero' ? 0 : history === 'future' ? now + 100 : history === 'expired' ? now - 351
      : history === 'boundary' ? now - 350 : now - 100;
    target.lastSwordAttackTime = target.lastHammerAttackTime = time;
    if (history === 'live-flight' || history === 'stale-ai-state') {
      target.lastSwordAttackTime = target.lastHammerAttackTime = 0;
      target.isLunging = history === 'live-flight'; target.aiState = history === 'stale-ai-state' ? 'LUNGING' : 'APPROACHING';
    }
    f.start(); f.step();
    const trade = ['recent', 'boundary'].includes(history) || history === 'live-flight' && weapon === 'sword';
    assert.equal(f.events.counter, Number(trade)); assert.equal(state.playerHP, trade ? 1 : 2);
    assert.equal(target.hp, 1); assert.deepEqual(f.events.ends, [true]);
  });
}
