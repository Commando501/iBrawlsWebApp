import { canCombatantsDamage } from '../../src/game/combatDamage';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBotParityFixture } from './grifballBotExecutionParity';
import { createCombatImpactCallbacksForState } from '../../src/components/grifball/combatImpactCallbacks';
import { reconcileGrifballCarrierForState, setGrifballCarrierForState } from '../../src/components/grifball/grifballObjectiveRuntime';
import { updateWeaponAnimationFrameForState } from '../../src/components/grifball/weaponAnimationFrameRuntime';
import { triggerPlayerSwordSlashForState, triggerPlayerHammerSwingForState, triggerPlayerHammerMeleeForState } from '../../src/components/grifball/playerWeaponActions';

const noop = () => {};
const attacks = ['slash', 'slam', 'swipe', 'punch'] as const;
type Attack = typeof attacks[number];
const identities = ['registered-main', 'legacy-main', 'regular', 'main-without-lookup'] as const;
type Identity = typeof identities[number];

/** Live-only boundary tests. These do not count as independent headless parity traces. */
function fixture(attack: Attack, identity: Identity, multiplayer = false) {
  const f = createBotParityFixture('bystander', false, { gameMode: 'grifball', enableSwordTrade: false,
    attackRange: 2, grifballPunchLungeDistance: 2, swordSlashSpeed: .22 }, identity === 'regular' ? 'victim' : 'main_ai');
  const { state, target } = f;
  f.bot.pos.set(50, 0, 50);
  state.playerPos.set(0, 0, 0); state.yaw = Math.PI; state.pitch = state.crouchAmount = 0;
  state.localPlayerTeam = 'blue'; state.isMultiplayer = multiplayer;
  state.activeWeapon = attack === 'slash' ? 'sword' : attack === 'punch' ? 'ball' : 'hammer';
  state.swapCooldownTimer = state.playerDashRemaining = 0;
  state.scorePlayer = state.playerKills = state.enemyDeaths = 0; state.lastDeaths = [];
  target.hp = target.maxHp = 2; target.deaths = 0; target.aiState = 'APPROACHING';
  target.activeWeapon = 'hammer'; target.weaponState = 'ready'; target.weaponTimer = 0;
  if (identity === 'legacy-main') state.otherPlayers.delete(target.id);
  const mainAI = identity === 'regular' || identity === 'main-without-lookup' ? undefined : target;
  const events = { deaths: 0, medals: [] as string[], calibration: [] as string[], trades: [] as string[],
    sent: [] as object[], outgoing: [] as string[] };
  const impacts = createCombatImpactCallbacksForState({ getState: () => state, getMainAI: () => mainAI,
    getEnemyAITarget: () => null, isMultiplayer: multiplayer,
    canCombatantsDamage,
    executeTrade: reason => { events.trades.push(reason); },
    sendSync: payload => { events.sent.push(payload); return true; },
    applyOutgoingMultiplayerHitLocally: id => { events.outgoing.push(id); },
    renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop,
    evaluatePlayerKillMedals: id => { events.medals.push(id); return []; },
    recordBotCalibrationDeath: id => { events.calibration.push(id); }, recordPlayerDamageTaken: noop,
    tryRecordCalibrationCounterSuccess: noop, recordBotPsychKill: noop, recordBotDamageTag: noop,
    tryEnterPressureState: () => false, tryStartComboOnHit: noop,
    playExplosion: noop, playSwing: noop, playDeath: () => { events.deaths++; }, playJump: noop, pushStatsUpdate: noop });
  const impact = () => attack === 'slash' ? impacts.applyPlayerSwordSlashImpact()
    : attack === 'swipe' ? impacts.applyPlayerHammerMeleeImpact() : impacts.applyHammerStrikeImpact(true);
  const start = () => {
    const args = { state, playSwing: noop, sendSync: noop, recordHammerAttack: noop };
    if (attack === 'slash') triggerPlayerSwordSlashForState(args);
    else if (attack === 'swipe') triggerPlayerHammerMeleeForState(args);
    else triggerPlayerHammerSwingForState(args);
  };
  const weaponFrame = (dt: number) => updateWeaponAnimationFrameForState({ state, refs: f.refs, dt, mainAI,
    getPlayerSwordLockTarget: () => null, ...impacts });
  return { ...f, events, impact, start, weaponFrame };
}

for (const attack of attacks) for (const identity of identities) {
  test(`${attack}/${identity}: one damage per impact, one lethal credit, immediate attack cancellation`, () => {
    const f = fixture(attack, identity), { state, target, events } = f;
    target.aiState = 'LUNGING'; target.isLunging = true; target.weaponState = 'swing_down'; target.weaponTimer = .1;
    f.impact();
    assert.equal(target.hp, 1, 'one impact must not traverse the same victim twice');
    assert.equal(target.isLunging, true, 'nonlethal contact preserves the committed attack');
    assert.equal(state.playerKills, 0); assert.equal(events.deaths, 0);
    f.impact();
    assert.equal(target.hp, 0); assert.equal(target.respawnTimer, 3); assert.equal(target.aiState, 'RESPAWNING');
    assert.equal(target.isLunging, false); assert.equal(target.weaponState, 'ready'); assert.equal(target.weaponTimer, 0);
    assert.equal(target.deaths, 1); assert.equal(state.playerKills, 1); assert.equal(state.scorePlayer, 1);
    assert.equal(state.enemyDeaths, identity === 'regular' ? 0 : 1);
    assert.equal(events.deaths, 1); assert.deepEqual(events.medals, [target.id]);
    assert.deepEqual(events.calibration, identity === 'regular' ? [] : ['main_ai']);
    assert.equal(state.lastDeaths.length, 1);
    f.impact();
    assert.equal(target.deaths, 1); assert.equal(state.playerKills, 1); assert.equal(events.deaths, 1);
  });

  for (const exclusion of ['shield', 'dead', 'respawn-timer', 'respawn-state', 'observer', 'dead-player', 'far'] as const) {
    test(`${attack}/${identity}: excludes ${exclusion}`, () => {
      const f = fixture(attack, identity), { state, target } = f;
      if (exclusion === 'shield') target.invulnerabilityTimer = 1;
      if (exclusion === 'dead') target.hp = 0;
      if (exclusion === 'respawn-timer') target.respawnTimer = 1;
      if (exclusion === 'respawn-state') target.aiState = 'RESPAWNING';
      if (exclusion === 'observer') target.isObserver = true;
      if (exclusion === 'dead-player') state.playerHP = 0;
      if (exclusion === 'far') target.pos.set(50, 0, 50);
      const hp = target.hp;
      f.impact();
      assert.equal(target.hp, hp); assert.equal(state.playerKills, 0); assert.equal(f.events.deaths, 0);
    });
  }
}

for (const identity of ['registered-main', 'legacy-main'] as const) test(`slash/${identity}: preserves exactly one main-AI trade callback`, () => {
  const f = fixture('slash', identity);
  f.state.settings.enableSwordTrade = true; f.target.activeWeapon = 'sword'; f.target.weaponState = 'swing_up';
  assert.equal(f.impact(), true); assert.deepEqual(f.events.trades, ['sword_vs_sword']);
  assert.equal(f.target.hp, 2); assert.equal(f.state.playerKills, 0);
});

for (const attack of attacks) for (const mainFirst of [true, false]) {
  test(`${attack}/multiple victims/mainFirst=${mainFirst}: punches hit only the first model; area attacks hit both`, () => {
    const f = fixture(attack, 'registered-main'), { state, bot, target } = f;
    bot.team = 'red'; bot.pos.copy(target.pos); bot.hp = bot.maxHp = 2; bot.deaths = 0;
    if (attack === 'punch') bot.pos.addScaledVector(target.pos.clone().sub(state.playerPos).normalize(), .2);
    state.otherPlayers.clear();
    for (const c of mainFirst ? [target, bot] : [bot, target]) state.otherPlayers.set(c.id, c);
    if (attack === 'punch') {
      f.impact(); assert.deepEqual([target.hp, bot.hp], [1, 2]);
      f.impact(); assert.deepEqual([target.hp, bot.hp], [0, 2]);
      assert.equal(state.playerKills, 1); assert.equal(state.scorePlayer, 1); assert.equal(state.enemyDeaths, 1);
      assert.deepEqual(f.events.medals, ['main_ai']); assert.equal(f.events.deaths, 1);
      return;
    }
    f.impact();
    assert.deepEqual([target.hp, bot.hp], [1, 1]); assert.equal(state.playerKills, 0);
    f.impact();
    assert.deepEqual([target.hp, bot.hp], [0, 0]); assert.deepEqual([target.deaths, bot.deaths], [1, 1]);
    assert.equal(state.playerKills, 2); assert.equal(state.scorePlayer, 2); assert.equal(state.enemyDeaths, 1);
    assert.deepEqual(f.events.medals, ['main_ai', bot.id]); assert.equal(f.events.deaths, 2);
    f.impact(); assert.equal(state.playerKills, 2); assert.equal(f.events.deaths, 2);
  });
}

for (const attack of attacks) for (const identity of ['registered-main', 'regular'] as const) {
  test(`${attack}/${identity}: real weapon frame hits once, roster stays dead for three seconds then revives`, () => {
    const f = fixture(attack, identity), { target, state } = f;
    target.hp = 1;
    f.start();
    let hitTick = 0;
    for (let tick = 1; tick <= 120; tick++) {
      f.weaponFrame(1 / 60);
      if (!hitTick && target.hp === 0) hitTick = tick;
    }
    assert.ok(hitTick > 0); if (attack === 'slash') assert.equal(hitTick, 7);
    assert.equal(state.playerKills, 1); assert.equal(target.deaths, 1); assert.equal(target.respawnTimer, 3);
    f.respawns(2.99); assert.equal(target.hp, 0);
    f.respawns(.02); assert.equal(target.hp, target.maxHp); assert.equal(target.respawnTimer, 0);
    assert.ok(target.invulnerabilityTimer > 0); assert.equal(target.isLunging, false);
    assert.equal(target.deaths, 1); assert.equal(state.playerKills, 1);
  });

  test(`${attack}/${identity}: multiplayer sends one hit without offline kill bookkeeping`, () => {
    const f = fixture(attack, identity, true);
    f.impact();
    assert.deepEqual(f.events.sent.filter(p => 'action' in p && p.action === 'hit_taken'),
      [{ type: 'sync', action: 'hit_taken', damage: 1, targetId: f.target.id,
        ...(attack === 'slash' ? { weapon: 'sword' } : attack === 'punch' ? { weapon: 'ball' } : {}) }]);
    assert.equal(f.target.hp, 2); assert.equal(f.target.deaths, 0); assert.equal(f.state.playerKills, 0);
    assert.deepEqual(f.events.outgoing, attack === 'swipe' ? [] : [f.target.id]);
  });

  test(`${attack}/${identity}: killed runner releases possession before revival`, () => {
    const f = fixture(attack, identity), { state, target, refs } = f;
    state.grifball.ball.state = 'held'; state.grifball.ball.holderId = target.id;
    setGrifballCarrierForState({ state, refs, id: target.id, carrying: true }); target.hp = 1;
    f.impact();
    assert.equal(target.hp, 0);
    const args = { state, refs, ballMeshRef: { current: null }, ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } };
    assert.equal(reconcileGrifballCarrierForState(args), true);
    assert.equal(state.grifball.ball.state, 'loose'); assert.equal(state.grifball.ball.holderId, null);
    assert.equal(target.activeWeapon, 'hammer'); assert.equal(target.respawnTimer, 3);
    assert.equal(reconcileGrifballCarrierForState(args), false);
    assert.equal(target.deaths, 1); assert.equal(state.playerKills, 1);
  });
}
