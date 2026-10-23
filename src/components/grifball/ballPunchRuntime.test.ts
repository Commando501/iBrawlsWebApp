import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS, withDefaultGameplaySettings } from '../../settings/gameplaySettings';
import { triggerPlayerHammerSwingForState } from './playerWeaponActions';
import { updatePlayerHammerAnimationForState } from './playerHammerAnimationRuntime';
import { updateRosterCombatantVisualsForState } from './rosterVisualSync';
import { applyHammerStrikeImpactForState } from './hammerStrikeImpactRuntime';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { getPlayerPunchLockTarget } from './ballPunchRuntime';
import { SETTING_DEFINITIONS } from '../../settings/settingsSchema';
import { createMatch } from '../../sim/factory';
import { idleAction } from '../../sim/actions';
import { stepCombatantWeapons } from '../../sim/weapons';
import { serializeState } from '../../sim/hash';

const noop = () => {};
const effects = {
  playSwing: noop, playDeath: noop, playExplosion: noop, playJump: noop, renderHammerSplashVfx: noop,
  spawnVoxelShockwaveParticles: noop, recordBotCalibrationDeath: noop,
  recordPlayerDamageTaken: noop, tryRecordCalibrationCounterSuccess: noop,
  recordBotPsychKill: noop, recordBotDamageTag: noop, tryEnterPressureState: () => false,
  tryStartComboOnHit: noop, pushStatsUpdate: noop, evaluatePlayerKillMedals: () => [],
  canCombatantsDamage: () => true, sendSync: () => true, applyOutgoingMultiplayerHitLocally: noop,
};
function fixture(attacker: string, distance = 3, magnetism = 100) {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: false, multiplayerRole: null,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', maxHP: 10, grifballPunchMagnetism: magnetism } });
  state.otherPlayers.clear(); state.playerPos.set(0, 0, 0);
  state.yaw = state.pitch = state.crouchAmount = 0;
  state.playerHP = 10; state.playerRespawnTimer = state.playerInvulnerabilityTimer = state.swapCooldownTimer = 0;
  state.localPlayerTeam = 'blue'; state.isObserverMode = attacker !== 'player';
  state.activeWeapon = 'ball'; state.pWeaponState = 'ready'; state.pWeaponReady = true;
  state.grifball.phase = 'playing'; state.grifball.ball.state = 'held'; state.grifball.ball.holderId = attacker;
  const refs = createInitialGrifballThreeRefs();
  const add = (id: string, x: number, z: number, team: 'red' | 'blue' = 'red') => {
    const c = createOfflineBotCombatant({ id, team, playerName: id, spawnPos: new THREE.Vector3(x, 0, z),
      yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings });
    c.hp = c.maxHp = 10; c.invulnerabilityTimer = c.respawnTimer = 0;
    state.otherPlayers.set(id, c);
    refs.otherPlayerMeshes.set(id, { group: new THREE.Group(), hammer: new THREE.Group(), sword: new THREE.Group() } as any);
    return c;
  };
  const target = add('target', 0, -distance);
  const bystander = add('bystander', 1.2, -distance);
  const bot = attacker === 'player' ? undefined : add(attacker, 0, 0, 'blue');
  if (bot) { bot.activeWeapon = 'ball'; bot.weaponState = 'swing_up'; bot.weaponTimer = 0; }
  const sent: unknown[] = [];
  const impact = () => applyHammerStrikeImpactForState({ ...effects, state, isPlayerStriking: true,
    mainAI: undefined, getEnemyAITarget: () => null, isMultiplayer: state.isMultiplayer,
    sendSync: payload => { sent.push(payload); return true; } });
  const model = new THREE.Group();
  const tick = () => {
    if (!bot) updatePlayerHammerAnimationForState({ state, playerHammer: model, dt: 1 / 60,
      idleXBob: 0, idleYBob: 0, idleZRotBob: 0, applyHammerStrikeImpact: impact, applyPlayerHammerMeleeImpact: noop });
    else updateRosterCombatantVisualsForState({ state, refs, dt: 1 / 60, renderSwordLungeTrailVfx: noop,
      applyBotMeleeImpact: botId => applyBotMeleeImpactForState({ ...effects, state, botId }) });
  };
  const start = () => { if (!bot) triggerPlayerHammerSwingForState({ state, recordHammerAttack: noop, playSwing: noop, sendSync: noop }); };
  return { state, target, bystander, bot, add, sent, impact, tick, start };
}

for (const id of ['player', 'main_ai', 'bot']) for (const magnetism of [0, 100]) {
  test(`${id} at ${magnetism}%: real punch frames lunge, hit one model once, and recover`, () => {
    const f = fixture(id, 3, magnetism);
    if (id === 'player') assert.equal(getPlayerPunchLockTarget(f.state)?.id, 'target');
    f.start();
    for (let i = 0; i < 60; i++) f.tick();
    assert.equal(f.target.hp, 9); assert.equal(f.bystander.hp, 10);
    assert.ok((f.bot?.pos.z ?? f.state.playerPos.z) < -.5);
    assert.ok((f.bot?.pos.z ?? f.state.playerPos.z) >= -1.8 - 1e-8);
    assert.equal(f.bot?.weaponState ?? f.state.pWeaponState, 'ready');
  });
}

test('white reticle performs a normal stationary jab, even if a target enters later', () => {
  const f = fixture('player'); f.target.pos.x = 2;
  assert.equal(getPlayerPunchLockTarget(f.state), null);
  f.start(); f.target.pos.set(0, 0, -3);
  for (let i = 0; i < 30; i++) f.tick();
  assert.equal(f.state.playerPos.z, 0); assert.equal(f.target.hp, 10);
});

test('teammates, protected, dead and observer targets do not make the reticle red', () => {
  const f = fixture('player'); f.bystander.hp = 0;
  for (const patch of [{ team: 'blue' as const }, { hp: 0 }, { invulnerabilityTimer: 1 }, { isObserver: true }, { respawnTimer: 1 }]) {
    Object.assign(f.target, { team: 'red', hp: 10, invulnerabilityTimer: 0, isObserver: false, respawnTimer: 0 }, patch);
    assert.equal(getPlayerPunchLockTarget(f.state), null);
  }
});

test('multiplayer punch sends exactly one direct hit and no hammer splash', () => {
  const f = fixture('player', 1.5); f.state.isMultiplayer = true;
  f.impact();
  assert.deepEqual(f.sent, [{ type: 'sync', action: 'hit_taken', damage: 1, targetId: 'target', weapon: 'ball' }]);
});

test('mechanics sliders persist, migrate older saves and expose zero magnetism as off', () => {
  assert.equal(withDefaultGameplaySettings({}).grifballPunchMagnetism, 100);
  assert.equal(withDefaultGameplaySettings({ grifballPunchMagnetism: 0 }).grifballPunchMagnetism, 0);
  for (const key of ['grifballPunchLungeDistance', 'grifballPunchMagnetism']) {
    const slider = SETTING_DEFINITIONS.find(d => d.key === key)!;
    assert.equal(slider.type, 'slider'); assert.equal(slider.sectionId, 'runnerBall');
  }
  const slider = SETTING_DEFINITIONS.find(d => d.key === 'grifballPunchMagnetism')!;
  assert.equal(slider.min, 0); assert.equal(slider.max, 100); assert.equal(slider.formatValue?.(0), '0% (Off)');
});

for (const execution of ['live-player-v1', 'live-roster-v2'] as const) test(`${execution} matches real punch frames and survives JSON continuation`, () => {
  const live = fixture(execution === 'live-player-v1' ? 'player' : 'bot');
  const sim = createMatch({ seed: 1, teamSizes: { blue: 2, red: 2 }, settings: live.state.settings });
  sim.combatExecution = execution;
  const c = sim.combatants.find(c => c.team === 'blue')!, enemies = sim.combatants.filter(c => c.team === 'red');
  sim.combatants = [c, ...enemies];
  c.pos = { x: 0, y: 0, z: 0 }; c.yaw = 0; c.weapon = 'ball'; c.weaponState = 'idle';
  c.weaponReadyTimer = c.attackCooldown = c.dashRemaining = c.respawnTimer = 0;
  c.alive = true; c.hp = 10;
  enemies.forEach((e, i) => { e.pos = { x: i * 1.2, y: 0, z: 3 }; e.hp = 10; e.alive = true; e.invulnerabilityTimer = e.respawnTimer = 0; });
  live.start();
  let restored: typeof sim | undefined;
  for (let frame = 0; frame < 55; frame++) {
    const action = { ...idleAction(), attackPrimary: frame === 0 };
    live.tick(); stepCombatantWeapons(sim, c, action, sim.settings, 1 / 60, []);
    assert.ok(Math.abs(c.pos.z + (live.bot?.pos.z ?? live.state.playerPos.z)) < 1e-8, `frame ${frame} position`);
    assert.equal(enemies[0].hp, live.target.hp, `frame ${frame} damage`);
    if (restored) {
      stepCombatantWeapons(restored, restored.combatants.find(a => a.id === c.id)!, action, restored.settings, 1 / 60, []);
      assert.equal(serializeState(sim), serializeState(restored));
    }
    if (frame === 5) restored = JSON.parse(JSON.stringify(sim));
  }
  assert.equal(enemies[0].hp, 9); assert.equal(enemies[1].hp, 10);
});
