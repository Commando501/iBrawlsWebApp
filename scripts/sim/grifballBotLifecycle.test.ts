import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { lungeFixture } from './grifballLungeFixture';
import { setGrifballCarrierForState, reconcileGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { withSimulationRandom, seededRandom } from '../../src/game/simulationRandom';
import { getMatchBehaviorStats } from '../../src/game/aiPlayerModel';
import { triggerCombatantLungeAction } from '../../src/components/grifball/combatantActions';
import { resolveSwordLungeTradeReasonForState } from '../../src/components/grifball/tradeRuntime';

test('live lunge damages once, stops on contact, and applies the configured lunge cooldown', () => {
  const f = lungeFixture();
  for (let i = 0; i < 60; i++) { f.flight(); f.visuals(1 / 60); }
  assert.equal(f.target.hp, 19); assert.deepEqual(f.outcomes, ['hit']);
  assert.equal(f.bot.isLunging, false); assert.equal(f.bot.aiState, 'COOLDOWN');
  assert.equal(f.bot.aiTimer, f.state.settings.swordLungeReload); assert.equal(f.bot.vel.length(), 0);
});

test('contact on the timeout tick records a hit once, never overwrites it as a miss', () => {
  const f = lungeFixture(); f.bot.lungeTimer = .8; f.target.pos.z = .5;
  f.flight(); assert.equal(f.target.hp, 19); assert.deepEqual(f.outcomes, ['hit']);
  assert.equal(f.bot.aiLastLungeOutcome, 'hit');
});

test('a shielded target cannot take lunge damage or initiate a trade', () => {
  const f = lungeFixture(); f.target.pos.z = .5; f.target.invulnerabilityTimer = 1;
  f.target.activeWeapon = 'sword'; f.target.weaponState = 'swing_up'; f.state.settings.enableSwordTrade = true;
  f.flight(); assert.equal(f.target.hp, 20); assert.equal(f.bot.hp, f.bot.maxHp);
  assert.equal(f.bot.isLunging, true); assert.deepEqual(f.outcomes, []);
});

test('dead or friendly targets cancel a lunge without damage or a second finish', () => {
  for (const reason of ['dead', 'friendly']) {
    const f = lungeFixture(); f.bot.lungeTimer = .8;
    if (reason === 'dead') f.target.hp = 0; else f.target.team = f.bot.team;
    const hp = f.target.hp; f.flight(); assert.equal(f.target.hp, hp); assert.deepEqual(f.outcomes, ['target_dead']);
  }
});

for (const weapon of ['sword', 'hammer'] as const) test(`live ${weapon} lunge trade damages both once and respawns both after the delay`, () => {
  const f = lungeFixture(); f.target.hp = f.target.maxHp = f.bot.hp = f.bot.maxHp = 1;
  f.target.pos.z = .5; f.target.activeWeapon = weapon; f.target.weaponState = 'swing_up';
  f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = true;
  assert.equal(f.flight(), 'trade_return');
  assert.equal(f.target.hp, 0); assert.equal(f.bot.hp, 0);
  assert.equal(f.target.respawnTimer, 3); assert.equal(f.bot.respawnTimer, 3);
  assert.equal(f.bot.kills, 1); assert.equal(f.target.kills, 1); assert.equal(f.deaths.length, 2);
  f.visuals(1 / 60); assert.equal(f.bot.isLunging, false); assert.equal(f.target.weaponState, 'ready');
  for (let i = 0; i < 179; i++) f.respawns(1 / 60);
  assert.equal(f.bot.hp, 0); assert.equal(f.target.hp, 0);
  // Repeated floating-point subtraction can leave a sub-tick remainder at three seconds.
  f.respawns(1 / 60); f.respawns(1 / 60);
  for (const c of [f.bot, f.target]) {
    assert.equal(c.hp, 1); assert.equal(c.respawnTimer, 0); assert.equal(c.aiState, 'APPROACHING');
    assert.equal(c.invulnerabilityTimer, f.state.settings.respawnInvulnerabilityDuration);
    assert.equal(c.weaponState, 'ready'); assert.equal(c.vel.length(), 0);
    assert.ok(c.pos.length() > 2, 'respawn must use the team spawn');
  }
});

test('lethal lunge releases the carrier and shield blocks a fresh melee hit after respawn', () => {
  const f = lungeFixture(); const { state, target, bot, refs } = f;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = target.id;
  setGrifballCarrierForState({ state, id: target.id, carrying: true }); target.hp = 1; target.pos.z = .5;
  withSimulationRandom(seededRandom(1), 1, () => f.flight());
  assert.equal(target.hp, 0); assert.equal(target.respawnTimer, 3); assert.equal(bot.kills, 1);
  reconcileGrifballCarrierForState({ state, refs, ballMeshRef: { current: null },
    ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } });
  assert.equal(state.grifball.ball.holderId, null); assert.equal(state.grifball.ball.state, 'loose');
  f.respawns(3); assert.equal(target.hp, target.maxHp);
  target.pos.copy(bot.pos).add(new THREE.Vector3(0, 0, 1)); const hp = target.hp;
  f.impact(bot.id); assert.equal(target.hp, hp);
  target.invulnerabilityTimer = 0; f.impact(bot.id); assert.equal(target.hp, hp - 1);
});

for (const weapon of ['sword', 'hammer'] as const) test(`surviving ${weapon} trade consumes both attacks and finishes the attacker's flight`, () => {
  const f = lungeFixture('bot_2', true, 'main_ai');
  f.bot.hp = f.bot.maxHp = f.target.hp = f.target.maxHp = 3;
  f.target.pos.z = .4; f.target.activeWeapon = weapon; f.target.weaponState = 'swing_up';
  f.state.settings.enableSwordTrade = f.state.settings.enableHammerSwordTrade = true;
  f.state.settings.swordLungeReload = .35;
  assert.equal(f.flight(), 'trade_return');
  assert.equal(f.bot.hp, 2); assert.equal(f.target.hp, 2);
  assert.equal(f.bot.aiState, 'COOLDOWN'); assert.equal(f.bot.aiTimer, .35);
  assert.equal(f.bot.vel.length(), 0); assert.equal(f.bot.isLunging, false);
  assert.deepEqual(f.outcomes, ['hit']);
  assert.equal(f.target.weaponState, 'recovering'); assert.equal(f.target.weaponTimer, 0);
  for (let i = 0; i < 180; i++) { f.flight(); f.visuals(1 / 60); }
  assert.equal(f.target.weaponState, 'ready');
  assert.equal(f.bot.hp, 2); assert.equal(f.target.hp, 2); assert.equal(f.deaths.length, 0);
  for (const c of [f.bot, f.target]) {
    const stats = getMatchBehaviorStats(f.state.aiMatchContext, c.id);
    assert.equal(stats?.damageDealtCount, 1); assert.equal(stats?.damageReceivedCount, 1);
  }
});

test('main-AI lunge victim stays dead for the roster delay, releases the ball and revives with its shield', () => {
  const f = lungeFixture('bot_2', false, 'main_ai');
  const { state, target, refs } = f;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = target.id;
  setGrifballCarrierForState({ state, id: target.id, carrying: true });
  target.hp = 1; target.pos.z = .4;
  f.flight();
  assert.equal(target.hp, 0); assert.equal(target.respawnTimer, 3);
  assert.equal(target.deaths, 1); assert.equal(state.enemyDeaths, 1); assert.equal(f.bot.kills, 1);
  reconcileGrifballCarrierForState({ state, refs, ballMeshRef: { current: null },
    ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } });
  assert.equal(state.grifball.ball.holderId, null); assert.equal(target.activeWeapon, 'hammer');
  for (let i = 0; i < 179; i++) f.respawns(1 / 60);
  assert.equal(target.hp, 0); assert.equal(target.aiState, 'RESPAWNING');
  f.respawns(1 / 60); f.respawns(1 / 60);
  assert.equal(target.hp, target.maxHp); assert.equal(target.respawnTimer, 0);
  assert.equal(target.aiState, 'APPROACHING');
  assert.equal(target.invulnerabilityTimer, state.settings.respawnInvulnerabilityDuration);
  assert.equal(target.deaths, 1); assert.equal(state.enemyDeaths, 1);
});

test('one surviving lunge collision finishes both flights before the second actor can hit again', () => {
  const f = lungeFixture('bot_2', true, 'main_ai');
  f.bot.hp = f.target.hp = 3; f.target.pos.z = .4; f.target.activeWeapon = 'sword';
  f.state.settings.enableSwordTrade = true;
  withSimulationRandom(seededRandom(31), 0, () => triggerCombatantLungeAction({ self: f.target,
    settings: f.state.settings, lungeDir: new THREE.Vector3(0, 0, -1), pos: f.target.pos, vel: f.target.vel, playDash: () => {} }));
  f.flight();
  for (const c of [f.bot, f.target]) {
    assert.equal(c.hp, 2); assert.equal(c.isLunging, false); assert.equal(c.vel.length(), 0);
    assert.equal(c.aiLastLungeOutcome, 'hit'); assert.equal(c.aiState, 'COOLDOWN');
    assert.equal(c.aiTimer, f.state.settings.swordLungeReload);
    const stats = getMatchBehaviorStats(f.state.aiMatchContext, c.id);
    assert.equal(stats?.damageDealtCount, 1); assert.equal(stats?.damageReceivedCount, 1);
  }
  f.targetFlight(); assert.equal(f.bot.hp, 2); assert.equal(f.target.hp, 2);
});

test('stale main-AI LUNGING state and pre-respawn attack history cannot grant a trade', () => {
  const f = lungeFixture('bot_2', true, 'main_ai');
  f.target.activeWeapon = 'sword'; f.target.aiState = 'LUNGING'; f.target.isLunging = false;
  f.state.settings.enableSwordTrade = true; f.state.settings.swordTradeWindow = 10_000;
  const resolve = () => resolveSwordLungeTradeReasonForState({ state: f.state, target: f.target, mainAi: f.target });
  withSimulationRandom(seededRandom(1), 0, () => {
    assert.equal(resolve(), null);
    f.target.lastSwordAttackTime = 999_999; assert.equal(resolve(), 'sword_vs_sword');
    f.target.hp = 0; f.target.respawnTimer = 0; f.respawns(1 / 60);
    assert.equal(f.target.lastSwordAttackTime, 0); assert.equal(f.target.lastHammerAttackTime, 0);
    assert.equal(resolve(), null);
  });
});
