import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { applyPlayerSwordSlashImpactForState } from './playerSwordSlashRuntime';
import { updatePlayerSwordLungeForState } from './playerSwordLungeRuntime';
import { applyMainAISwordSlashImpactForState } from './mainAISwordSlashRuntime';
import { applyAISwordLungeHitForState } from './aiSwordLungeHitRuntime';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { executePlayerCombatantTradeForState } from './tradeRuntime';
import { applyHammerStrikeImpactForState } from './hammerStrikeImpactRuntime';
import { cancelSwordForRunnerPunch } from './runnerSwordClash';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import { createInitialGrifballThreeRefs } from './threeRefs';

const noop = () => {};
const callbacks = {
  playSwing: noop, playDeath: noop, playExplosion: noop, renderHammerSplashVfx: noop,
  spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop,
  recordPlayerDamageTaken: noop, tryRecordCalibrationCounterSuccess: noop,
  recordBotPsychKill: noop, recordBotDamageTag: noop, tryEnterPressureState: () => false,
  tryStartComboOnHit: noop, pushStatsUpdate: noop, executeTrade: noop,
  evaluatePlayerKillMedals: () => [], areCombatantsHostile: () => true,
  sendSync: () => true, applyOutgoingMultiplayerHitLocally: noop,
  recordDeathEvent: () => ({ id: 'death', attacker: 'attacker', victim: 'victim' }),
};
function fixture(victimId: string, runner: boolean, hp: number) {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: false,
    multiplayerRole: null, adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball',
      enableSwordTrade: false, enableHammerSwordTrade: false, grifballRunnerHealth: hp } });
  state.otherPlayers.clear();
  const bot = (id: string, team: 'blue' | 'red', z: number) => {
    const c = createOfflineBotCombatant({ id, team, playerName: id, spawnPos: new THREE.Vector3(0, 0, z),
      yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
    c.invulnerabilityTimer = 0; c.hp = c.maxHp = hp;
    state.otherPlayers.set(id, c);
    return c;
  };
  const attacker = bot('attacker', 'red', 0);
  attacker.activeWeapon = 'sword';
  const victim = victimId === 'player' ? undefined : bot(victimId, 'blue', -1);
  state.playerPos.set(0, 0, victim ? 0 : -1);
  state.yaw = state.pitch = state.crouchAmount = 0;
  state.playerHP = state.playerMaxHP = hp; state.playerInvulnerabilityTimer = 0;
  state.playerRespawnTimer = 0; state.isObserverMode = !!victim;
  state.localPlayerTeam = victim ? 'red' : 'blue'; state.activeWeapon = victim ? 'sword' : runner ? 'ball' : 'hammer';
  state.grifball.phase = 'playing';
  state.grifball.ball.state = runner ? 'held' : 'loose';
  state.grifball.ball.holderId = runner ? victimId : null;
  if (victim && runner) victim.activeWeapon = 'ball';
  const target = { id: victimId, pos: victim?.pos ?? state.playerPos, hp, invuln: 0,
    maxHp: hp, vel: new THREE.Vector3(), isLunging: false, weaponState: 'ready',
    respawnTimer: 0, isObserver: false, playerName: victimId, activeWeapon: 'ball' as const,
    isCrouching: false, modelType: 'medium' as const };
  return { state, attacker, victim, target };
}

for (const hp of [2, 7.5, 100]) for (const runner of [true, false]) {
  for (const attack of ['player slash', 'player lunge', 'AI slash', 'AI lunge', 'main AI slash'] as const) {
    const victims = attack.startsWith('player') ? ['main_ai', 'bot'] : ['player', 'bot'];
    for (const victimId of victims) test(`${attack} against ${runner ? 'runner' : 'non-runner'} ${victimId} at ${hp} HP`, () => {
      const { state, attacker, victim, target } = fixture(victimId, runner, hp);
      if (attack.startsWith('player')) {
        state.otherPlayers.delete(attacker.id);
        state.isObserverMode = false;
      }
      if (attack === 'player slash') {
        applyPlayerSwordSlashImpactForState({ ...callbacks, state, mainAI: victimId === 'main_ai' ? victim : undefined, isMultiplayer: false });
      } else if (attack === 'player lunge') {
        state.isLunging = true; state.lungeTargetDir.set(0, 0, -1);
        updatePlayerSwordLungeForState({ ...callbacks, state, dt: 0, isMultiplayer: false,
          activeCustomMap: null, multiplayerSocket: null, getMainAi: () => victimId === 'main_ai' ? victim : undefined,
          constrainCombatantToArena: noop, renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: noop,
          recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop });
      } else if (attack === 'AI slash') {
        applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
      } else if (attack === 'AI lunge') {
        applyAISwordLungeHitForState({ ...callbacks, state, attackerBot: attacker, target,
          mainAi: undefined, cooldownMult: 1, finishSwordLunge: noop });
      } else {
        state.otherPlayers.delete(attacker.id); attacker.id = 'main_ai'; state.otherPlayers.set(attacker.id, attacker);
        applyMainAISwordSlashImpactForState({ ...callbacks, state, mainAI: attacker, target, isMultiplayer: false });
      }
      assert.equal(victim?.hp ?? state.playerHP, runner ? 0 : hp - 1);
      assert.equal(victim?.respawnTimer ?? state.playerRespawnTimer, runner ? 3 : 0);
      if (runner) assert.equal(victim?.deaths ?? state.playerDeaths, 1);
    });
  }
}

test('hammer melee still deals one damage to a runner', () => {
  const { state, attacker, victim } = fixture('bot', true, 4);
  attacker.activeWeapon = 'hammer';
  applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
  assert.equal(victim!.hp, 3);
});

test('spawn protection still blocks sword contact', () => {
  const { state, attacker, victim } = fixture('bot', true, 4);
  victim!.invulnerabilityTimer = 1;
  applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
  assert.equal(victim!.hp, 4);
});

test('multiplayer slash sends lethal runner damage and predicts the same damage locally', () => {
  const { state, attacker } = fixture('remote', true, 100);
  state.otherPlayers.delete(attacker.id); state.isMultiplayer = true; state.isObserverMode = false;
  const sent: unknown[] = [], predicted: unknown[] = [];
  applyPlayerSwordSlashImpactForState({ ...callbacks, state, mainAI: undefined, isMultiplayer: true,
    sendSync: payload => { sent.push(payload); return true; },
    applyOutgoingMultiplayerHitLocally: (id, damage) => predicted.push({ id, damage }) });
  assert.deepEqual(sent, [{ type: 'sync', action: 'hit_taken', targetId: 'remote', weapon: 'sword', damage: 100, hitId: '1' }]);
  assert.deepEqual(predicted, [{ id: 'remote', damage: 100 }]);
});

for (const weapon of ['sword', 'hammer'] as const) test(`runner's committed lunge trades against ${weapon}`, () => {
  const { state, attacker } = fixture('player', true, 100);
  state.isLunging = true; state.activeWeapon = 'ball'; attacker.activeWeapon = weapon;
  executePlayerCombatantTradeForState({ ...callbacks, state, combatant: attacker,
    reason: weapon === 'sword' ? 'sword_vs_sword' : 'sword_lunge_vs_hammer' });
  assert.equal(state.playerHP, weapon === 'sword' ? 0 : 99);
  assert.equal(attacker.hp, 99, 'the opponent is not a runner');
});

for (const attack of ['player slash', 'player lunge', 'AI slash', 'AI lunge', 'main AI slash'] as const) {
  for (const phase of ['swing_up', 'swing_down', 'ready', 'recovering'] as const) {
    for (const facesSword of [true, false]) test(`${attack}: runner ${phase}, facing sword=${facesSword}`, () => {
      const localSword = attack.startsWith('player'), victimId = localSword ? 'bot' : 'player';
      const { state, attacker, victim, target } = fixture(victimId, true, 2);
      const wins = facesSword && (phase === 'swing_up' || phase === 'swing_down');
      if (victim) { victim.weaponState = phase; victim.yaw = facesSword ? Math.PI : 0; }
      else { state.pWeaponState = phase; state.yaw = facesSword ? Math.PI : 0; }
      if (localSword) {
        state.otherPlayers.delete(attacker.id); state.isObserverMode = false;
        state.pSwordState = 'slashing';
      }
      if (attack === 'player slash') applyPlayerSwordSlashImpactForState({ ...callbacks, state, mainAI: undefined, isMultiplayer: false });
      else if (attack === 'player lunge') {
        state.isLunging = true; state.lungeTargetDir.set(0, 0, -1);
        updatePlayerSwordLungeForState({ ...callbacks, state, dt: 0, isMultiplayer: false,
          activeCustomMap: null, multiplayerSocket: null, getMainAi: () => undefined,
          constrainCombatantToArena: noop, renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: noop,
          recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop });
      } else if (attack === 'AI slash') {
        attacker.weaponState = 'swing_down';
        applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
      } else if (attack === 'AI lunge') {
        attacker.isLunging = true;
        applyAISwordLungeHitForState({ ...callbacks, state, attackerBot: attacker, target,
          mainAi: undefined, cooldownMult: 1, finishSwordLunge: noop });
      } else {
        state.otherPlayers.delete(attacker.id); attacker.id = 'main_ai'; state.otherPlayers.set(attacker.id, attacker);
        attacker.weaponState = 'swing_down';
        applyMainAISwordSlashImpactForState({ ...callbacks, state, mainAI: attacker, target, isMultiplayer: false });
      }
      assert.equal(victim?.hp ?? state.playerHP, wins ? 2 : 0);
      assert.equal(localSword ? state.playerHP : attacker.hp, wins ? 1 : 2);
      if (wins) {
        assert.equal(victim?.weaponState ?? state.pWeaponState, 'recovering', 'punch is consumed');
        assert.equal(localSword ? state.isLunging : attacker.isLunging ?? false, false);
        assert.equal(state.grifball.ball.holderId, victimId);
      }
    });
  }
}

for (const swordHp of [1, 3]) test(`punch-first cancels a sword attack, sword HP=${swordHp}`, () => {
  const { state, attacker } = fixture('player', true, 2);
  state.yaw = Math.PI; state.pWeaponState = 'swing_down'; attacker.weaponState = 'swing_down';
  attacker.hp = swordHp;
  applyHammerStrikeImpactForState({ ...callbacks, state, isPlayerStriking: true, mainAI: undefined,
    getEnemyAITarget: () => null, isMultiplayer: false, playJump: noop });
  assert.equal(attacker.hp, swordHp - 1);
  assert.equal(state.playerHP, 2);
  assert.equal(attacker.weaponState, swordHp === 1 ? 'ready' : 'recovering');
  assert.equal(state.playerKills, swordHp === 1 ? 1 : 0);
});

for (const runnerId of ['main_ai', 'bot']) test(`AI runner ${runnerId} wins a lethal punch clash against another AI`, () => {
  const { state, attacker, victim } = fixture(runnerId, true, 2);
  attacker.hp = 1; attacker.weaponState = 'swing_down';
  victim!.weaponState = 'swing_down'; victim!.yaw = Math.PI;
  applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
  assert.equal(victim!.hp, 2); assert.equal(victim!.kills, 1);
  assert.equal(attacker.hp, 0); assert.equal(attacker.deaths, 1);
  assert.equal(attacker.aiState, 'RESPAWNING');
  assert.equal(state.grifball.ball.holderId, runnerId);
  assert.equal(state.lastDeaths.length, 1);
});

test('a punch cannot negate an invulnerable sword attacker', () => {
  const { state, attacker } = fixture('player', true, 2);
  state.yaw = Math.PI; state.pWeaponState = 'swing_down';
  attacker.weaponState = 'swing_down'; attacker.invulnerabilityTimer = 1;
  applyBotMeleeImpactForState({ ...callbacks, state, botId: attacker.id });
  assert.equal(state.playerHP, 0); assert.equal(attacker.hp, 2);
});

for (const swordHp of [1, 3]) test(`roster animation preserves punch cancellation at sword HP=${swordHp}`, () => {
  const { state, attacker } = fixture('player', true, 2);
  state.yaw = Math.PI; state.pWeaponState = 'swing_down';
  attacker.hp = swordHp; attacker.weaponState = 'swing_up';
  attacker.weaponTimer = state.settings.swordSlashSpeed / 2;
  const refs = createInitialGrifballThreeRefs();
  refs.otherPlayerMeshes.set(attacker.id, {
    group: new THREE.Group(), hammer: new THREE.Group(), sword: new THREE.Group(), rig: {} as never,
  });
  let impacts = 0;
  const step = () => updateRosterCombatantVisualsForState({ state, refs, dt: 1 / 60,
    renderSwordLungeTrailVfx: noop, applyBotMeleeImpact: botId => {
      impacts++; applyBotMeleeImpactForState({ ...callbacks, state, botId });
    } });
  step();
  assert.equal(state.playerHP, 2);
  assert.equal(attacker.hp, swordHp - 1);
  assert.equal(attacker.weaponState, swordHp === 1 ? 'ready' : 'recovering');
  assert.equal(attacker.weaponTimer, 0);
  assert.equal(refs.otherPlayerMeshes.get(attacker.id)!.group.visible, swordHp > 1);
  step();
  assert.equal(impacts, 1, 'cancelled slash cannot resume on the next animation frame');
});

test('hitting an idle sword user does not add an attack cooldown', () => {
  const { state, attacker } = fixture('player', true, 3);
  attacker.weaponState = 'ready';
  cancelSwordForRunnerPunch(state, 'player', attacker.id);
  assert.equal(attacker.weaponState, 'ready');
});
