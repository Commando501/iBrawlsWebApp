import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { canCombatantsDamage } from '../../game/combatDamage';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createCombatImpactCallbacksForState } from './combatImpactCallbacks';
import { updatePlayerSwordLungeForState } from './playerSwordLungeRuntime';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { resolveAISwordLungeFlightForCombatant } from './aiSwordLungeFlightRuntime';
import { finishAISwordLungeFrameForCombatant } from './aiSwordLungeFinishRuntime';
import { triggerPlayerPistolFireForState } from './playerPistolRuntime';
import { evaluatePlayerKillMedalsForState } from './playerMedals';
import { executePlayerCombatantTradeForState } from './tradeRuntime';
import { reconcileGrifballCarrierForState, setGrifballCarrierForState } from './grifballObjectiveRuntime';
import { buildPotentialTacticalTargets } from './tacticalTargets';
import { createMatch } from '../../sim/factory';
import { idleAction } from '../../sim/actions';
import { stepCombatantWeapons, type KillEvent } from '../../sim/weapons';

const noop = () => {};
const effects = {
  canCombatantsDamage, playSwing: noop, playDeath: noop, playExplosion: noop, playJump: noop,
  renderHammerSplashVfx: noop, spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop,
  recordPlayerDamageTaken: noop, tryRecordCalibrationCounterSuccess: noop, recordBotPsychKill: noop,
  recordBotDamageTag: noop, tryEnterPressureState: () => false, tryStartComboOnHit: noop, pushStatsUpdate: noop,
  executeTrade: noop, sendSync: () => false, applyOutgoingMultiplayerHitLocally: noop,
  evaluatePlayerKillMedals: () => [], recordDeathEvent: () => ({ id: 'death', attacker: 'bot', victim: 'ally' }),
};
function fixture() {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: false, multiplayerRole: null,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', enableSwordTrade: false, enableHammerSwordTrade: false } });
  state.otherPlayers.clear(); state.localPlayerTeam = 'blue'; state.isObserverMode = false;
  state.playerPos.set(0, 0, 0); state.playerVel.set(0, 0, 0); state.yaw = state.pitch = state.crouchAmount = 0;
  state.playerHP = state.playerMaxHP = 2; state.playerRespawnTimer = state.playerInvulnerabilityTimer = 0;
  state.grifball.phase = 'playing';
  const refs = createInitialGrifballThreeRefs();
  const add = (id: string, z: number, team = 'blue') => {
    const actor = createOfflineBotCombatant({ id, playerName: id, team, spawnPos: new THREE.Vector3(0, 0, z),
      yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
    actor.hp = actor.maxHp = 1; actor.invulnerabilityTimer = actor.respawnTimer = 0;
    actor.weaponState = 'ready'; actor.activeWeapon = 'hammer';
    state.otherPlayers.set(id, actor);
    return actor;
  };
  return { state, refs, add };
}

for (const attack of ['slam', 'swipe', 'slash', 'lunge', 'punch', 'pistol'] as const)
  for (const id of ['main_ai', 'ally']) test(`player ${attack} kills allied ${id} without credit`, () => {
    const { state, refs, add } = fixture(), ally = add(id, -1.2);
    state.activeWeapon = attack === 'punch' ? 'ball' : attack === 'pistol' ? 'pistol' : ['slash', 'lunge'].includes(attack) ? 'sword' : 'hammer';
    const mainAI = id === 'main_ai' ? ally : undefined;
    const impacts = createCombatImpactCallbacksForState({ ...effects, getState: () => state,
      getMainAI: () => mainAI, getEnemyAITarget: () => null, isMultiplayer: false });
    if (attack === 'lunge') {
      state.isLunging = true; state.lungeTargetDir.set(0, 0, -1);
      updatePlayerSwordLungeForState({ ...effects, state, dt: 0, isMultiplayer: false, activeCustomMap: null,
        multiplayerSocket: null, getMainAi: () => mainAI, constrainCombatantToArena: noop,
        renderSwordLungeTrailVfx: noop, recordPlayerLungeEnd: noop, recordPlayerCounterSuccess: noop, recordPlayerDamageDealt: noop });
    } else if (attack === 'pistol') {
      refs.camera = new THREE.PerspectiveCamera(); refs.scene = new THREE.Scene();
      state.pitch = -Math.atan2(.825, 1.2); state.pPistolReady = true; state.pPistolState = 'ready';
      const previous = globalThis.window;
      try {
        Object.assign(globalThis, { window: {} });
        triggerPlayerPistolFireForState({ ...effects, state, refs, isPaused: false, isPlaying: true, playImpact: noop });
      } finally { if (previous === undefined) delete (globalThis as any).window; else globalThis.window = previous; }
    } else if (attack === 'slash') impacts.applyPlayerSwordSlashImpact();
    else if (attack === 'swipe') impacts.applyPlayerHammerMeleeImpact();
    else impacts.applyHammerStrikeImpact(true);
    assert.equal(ally.hp, 0); assert.equal(ally.deaths, 1); assert.equal(ally.respawnTimer, 3);
    assert.equal(state.playerHP, 2, 'no self damage');
    assert.equal(state.playerKills, 0); assert.equal(state.scorePlayer, 0);
    assert.equal(state.lastDeaths.length, 1);
    assert.deepEqual(evaluatePlayerKillMedalsForState({ state, getState: () => state, victimId: id, victim: ally,
      playMedal: () => assert.fail('team kills must not award medals'), onPopupExpired: noop }), []);
  });

for (const attackerId of ['main_ai', 'bot']) for (const weapon of ['hammer', 'sword', 'ball'] as const)
  for (const victimId of ['player', 'ally']) test(`${attackerId} ${weapon} damages allied ${victimId}`, () => {
    const { state, add } = fixture(), attacker = add(attackerId, 0);
    attacker.hp = 2; attacker.activeWeapon = weapon;
    state.isObserverMode = victimId !== 'player'; state.playerPos.z = -1.2; state.playerHP = 1;
    const ally = victimId === 'player' ? undefined : add(victimId, -1.2);
    applyBotMeleeImpactForState({ ...effects, state, botId: attackerId,
      recordBotPsychKill: () => assert.fail('team kills must not reward the AI'),
      tryStartComboOnHit: () => assert.fail('allies must not become combo targets') });
    assert.equal(ally?.hp ?? state.playerHP, 0);
    assert.equal(ally?.deaths ?? state.playerDeaths, 1);
    assert.equal(attacker.hp, 2); assert.equal(attacker.kills, 0); assert.equal(attacker.score, 0);
    assert.equal(state.enemyKills, 0); assert.equal(state.scoreEnemy, 0);
  });

for (const attackerId of ['main_ai', 'bot']) test(`${attackerId} committed lunge hits an ally in its path while retaining enemy-only targeting`, () => {
  const { state, add } = fixture(), attacker = add(attackerId, 0), ally = add(attackerId === 'bot' ? 'main_ai' : 'ally', -1), enemy = add('enemy', -10, 'red');
  state.isObserverMode = true; attacker.activeWeapon = 'sword'; attacker.isLunging = true;
  assert.deepEqual(buildPotentialTacticalTargets(state, attacker.id, [...state.otherPlayers.values()]).map(c => c.id), ['enemy']);
  attacker.lungeTargetDir = new THREE.Vector3(0, 0, -1); attacker.lungeStartPos = attacker.pos.clone();
  const finishes: string[] = [];
  resolveAISwordLungeFlightForCombatant({ ...effects, state, self: attacker, target: { ...enemy, weaponState: 'ready', isLunging: false },
    mainAi: undefined, botId: attacker.id, botMesh: new THREE.Group(), pos: attacker.pos, vel: attacker.vel,
    dt: 0, cooldownMult: 1, activeCustomMap: null, gravityAcceleration: 18,
    recoverCombatantAltitude: () => false, constrainCombatantToArena: noop,
    finishSwordLunge: (_cooldown, _outcome, id) => { finishes.push(id!); attacker.isLunging = false; },
    finishTradedTargetLunge: noop, executeCustomBotTrade: noop, renderSwordLungeTrailVfx: noop });
  assert.equal(ally.hp, 0); assert.equal(enemy.hp, 1); assert.equal(attacker.kills, 0);
  assert.deepEqual(finishes, [ally.id]);
});

test('surviving friendly lunge contact enters recovery without pressure or combo attacks', () => {
  const { state, add } = fixture(), attacker = add('bot', 0), ally = add('ally', -1);
  const result = finishAISwordLungeFrameForCombatant({ state, self: attacker, botId: attacker.id, targetId: ally.id,
    outcome: 'hit', pos: attacker.pos, vel: attacker.vel, timer: 0, weaponState: 'ready', aiState: 'LUNGING',
    recordCombatantObservation: noop, recordBotDamageTag: () => assert.fail('no friendly damage tags'),
    tryEnterPressureState: () => { assert.fail('no pressure on an ally'); },
    tryStartComboOnHit: () => assert.fail('no combo on an ally') });
  assert.equal(result.aiState, 'COOLDOWN'); assert.equal(attacker.isLunging, false);
});

for (const excluded of ['shielded', 'observer', 'respawning'] as const) test(`friendly lunge cannot hit a ${excluded} target`, () => {
  const { state, add } = fixture(), attacker = add('bot', 0), ally = add('ally', -1);
  state.isObserverMode = true; attacker.activeWeapon = 'sword'; attacker.isLunging = true;
  attacker.lungeTargetDir = new THREE.Vector3(0, 0, -1); attacker.lungeStartPos = attacker.pos.clone();
  if (excluded === 'shielded') ally.invulnerabilityTimer = 1;
  if (excluded === 'observer') ally.isObserver = true;
  if (excluded === 'respawning') ally.respawnTimer = 1;
  resolveAISwordLungeFlightForCombatant({ ...effects, state, self: attacker,
    target: { ...ally, weaponState: 'ready', isLunging: false }, mainAi: undefined,
    botId: attacker.id, botMesh: new THREE.Group(), pos: attacker.pos, vel: attacker.vel,
    dt: 0, cooldownMult: 1, activeCustomMap: null, gravityAcceleration: 18,
    recoverCombatantAltitude: () => false, constrainCombatantToArena: noop,
    finishSwordLunge: () => assert.fail('excluded contact must not end the flight'),
    finishTradedTargetLunge: noop, executeCustomBotTrade: noop, renderSwordLungeTrailVfx: noop });
  assert.equal(ally.hp, 1); assert.equal(attacker.hp, 1); assert.equal(attacker.isLunging, true);
});

test('a team kill drops the carrier ball and friendly trades give neither actor points', () => {
  const { state, refs, add } = fixture(), ally = add('ally', -1);
  setGrifballCarrierForState({ state, id: ally.id, carrying: true });
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = ally.id;
  state.playerHP = 1; state.activeWeapon = 'sword';
  executePlayerCombatantTradeForState({ ...effects, state, combatant: ally, reason: 'sword_vs_sword' });
  reconcileGrifballCarrierForState({ state, refs, ballMeshRef: { current: null },
    ballChargingRef: { current: false }, ballChargeTimerRef: { current: 0 } });
  assert.equal(state.grifball.ball.holderId, null);
  assert.equal(ally.hp, 0); assert.equal(state.playerHP, 0);
  assert.equal(ally.kills, 0); assert.equal(state.playerKills, 0);
  assert.equal(ally.deaths, 1); assert.equal(state.playerDeaths, 1);
});

for (const execution of ['legacy-v1', 'live-player-v1', 'live-roster-v2'] as const)
  for (const attack of ['slam', 'swipe', 'slash', 'punch'] as const) test(`simulation ${execution}/${attack}: friendly damage and no score`, () => {
    const state = createMatch({ seed: 1, teamSizes: { blue: 2, red: 0 }, settings: { enableSwordTrade: false, enableHammerSwordTrade: false } });
    state.combatExecution = execution;
    const [attacker, ally] = state.combatants;
    ally.team = attacker.team;
    attacker.pos = { x: 0, y: 0, z: 0 }; attacker.yaw = 0; attacker.hp = 2;
    attacker.weapon = attack === 'slash' ? 'sword' : attack === 'punch' ? 'ball' : 'hammer';
    attacker.weaponState = 'idle'; attacker.weaponReadyTimer = attacker.attackCooldown = attacker.invulnerabilityTimer = 0;
    ally.pos = { x: 0, y: 0, z: 1.2 }; ally.hp = 1; ally.invulnerabilityTimer = 0;
    const events: KillEvent[] = [];
    for (let tick = 0; tick < 90; tick++) stepCombatantWeapons(state, attacker,
      { ...idleAction(), attackPrimary: tick === 0 && attack !== 'swipe', attackSecondary: tick === 0 && attack === 'swipe' },
      state.settings, 1 / 60, events);
    assert.equal(ally.hp, 0); assert.equal(attacker.hp, 2); assert.equal(events.length, 1);
    assert.equal(state.scores.blue.kills, 0); assert.equal(state.scores.blue.score, 0); assert.equal(state.scores.blue.deaths, 1);
  });
