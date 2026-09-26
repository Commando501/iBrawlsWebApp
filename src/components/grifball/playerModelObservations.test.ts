import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { getMatchBehaviorStats } from '../../game/aiPlayerModel';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { type Combatant, type DeathEvent } from '../../types';
import { createCombatantActionCallbacksForState } from './combatantActionCallbacks';
import { type TacticalTargetCandidate } from './combatGeometry';
import { tryStartAISwordLungeForCombatant } from './aiSwordLungeStartRuntime';
import { applyAISwordLungeHitForState } from './aiSwordLungeHitRuntime';
import {
  recordCombatantCounterSuccessObservation,
  recordCombatantDamageDealtObservation,
  recordCombatantDamageReceivedObservation,
  recordCombatantModelObservation,
} from './playerModelObservations';
import { createInitialGrifballRuntimeState, type GrifballRuntimeState } from './runtimeState';
import { executeCustomBotTradeForState } from './tradeRuntime';

const makeState = (): GrifballRuntimeState =>
  createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });

const makeCombatant = (
  id: string,
  overrides: Partial<Combatant> = {}
): Combatant => ({
  id,
  playerName: id,
  hue: 0,
  controller: 'ai',
  pos: new THREE.Vector3(0, 0, 0),
  vel: new THREE.Vector3(0, 0, 0),
  yaw: 0,
  isCrouching: false,
  hp: 2,
  maxHp: 2,
  respawnTimer: 0,
  invulnerabilityTimer: 0,
  score: 0,
  kills: 0,
  deaths: 0,
  activeWeapon: 'hammer',
  weaponState: 'ready',
  weaponTimer: 0,
  lastSwordAttackTime: 0,
  lastHammerAttackTime: 0,
  ...overrides,
});

const makeTarget = (combatant: Combatant): TacticalTargetCandidate => ({
  id: combatant.id,
  hp: combatant.hp,
  maxHp: combatant.maxHp,
  activeWeapon: combatant.activeWeapon === 'sword' ? 'sword' : 'hammer',
  weaponState: combatant.weaponState ?? 'ready',
  isLunging: combatant.isLunging ?? false,
  invulnerabilityTimer: combatant.invulnerabilityTimer,
  isCrouching: combatant.isCrouching,
  playerName: combatant.playerName,
  modelType: combatant.modelType,
  pos: combatant.pos,
  vel: combatant.vel,
});

const noop = () => {};

const recordDeathEvent = (): DeathEvent => ({
  id: 'death',
  attacker: 'attacker',
  victim: 'victim',
});

test('combatant observation helpers update only the requested AI combatant', () => {
  const state = makeState();
  state.otherPlayers.set('bot_1', makeCombatant('bot_1'));
  state.otherPlayers.set('bot_2', makeCombatant('bot_2'));

  recordCombatantDamageDealtObservation(state, 'bot_1');
  recordCombatantDamageReceivedObservation(state, 'bot_2');
  recordCombatantCounterSuccessObservation(state, 'bot_2');

  const botOneStats = getMatchBehaviorStats(state.aiMatchContext, 'bot_1');
  const botTwoStats = getMatchBehaviorStats(state.aiMatchContext, 'bot_2');

  assert.equal(botOneStats?.damageDealtCount, 1);
  assert.equal(botOneStats?.damageReceivedCount, 0);
  assert.equal(botOneStats?.countersAttempted, 0);
  assert.equal(botTwoStats?.damageDealtCount, 0);
  assert.equal(botTwoStats?.damageReceivedCount, 1);
  assert.equal(botTwoStats?.countersAttempted, 1);
  assert.equal(botTwoStats?.countersLanded, 1);
});

test('combatant observation helpers skip remote human combatants', () => {
  const state = makeState();
  state.otherPlayers.set('remote_1', makeCombatant('remote_1', { controller: 'remote' }));

  recordCombatantDamageDealtObservation(state, 'remote_1');
  recordCombatantDamageReceivedObservation(state, 'remote_1');
  recordCombatantCounterSuccessObservation(state, 'remote_1');

  assert.equal(getMatchBehaviorStats(state.aiMatchContext, 'remote_1'), null);
});

test('AI sword lunge hit records damage received for the AI target', () => {
  const state = makeState();
  const attacker = makeCombatant('bot_attacker');
  const target = makeCombatant('bot_target', {
    pos: new THREE.Vector3(1, 0, 0),
    hp: 2,
  });
  state.otherPlayers.set(attacker.id, attacker);
  state.otherPlayers.set(target.id, target);

  applyAISwordLungeHitForState({
    state,
    attackerBot: attacker,
    target: makeTarget(target),
    mainAi: undefined,
    cooldownMult: 1,
    finishSwordLunge: noop,
    recordPlayerDamageTaken: noop,
    playExplosion: noop,
    playDeath: noop,
    spawnVoxelShockwaveParticles: noop,
    recordDeathEvent,
    recordBotPsychKill: noop,
    recordBotCalibrationDeath: noop,
  });

  const targetStats = getMatchBehaviorStats(state.aiMatchContext, target.id);
  assert.equal(targetStats?.damageReceivedCount, 1);
});

test('bot-vs-bot trade records counter success and mutual trade damage', () => {
  const state = makeState();
  const attacker = makeCombatant('bot_attacker', { hp: 2 });
  const counteringTarget = makeCombatant('bot_counter', { hp: 2 });
  state.otherPlayers.set(attacker.id, attacker);
  state.otherPlayers.set(counteringTarget.id, counteringTarget);

  executeCustomBotTradeForState({
    state,
    attackerBot: attacker,
    target: { id: counteringTarget.id },
    rosterCombatant: (id) => state.otherPlayers.get(id),
    evaluatePlayerKillMedals: () => [],
    recordDeathEvent,
    getLocalPlayerFeedName: () => 'Player',
    playExplosion: noop,
    playDeath: noop,
    spawnVoxelShockwaveParticles: noop,
    recordBotCalibrationDeath: noop,
    pushStatsUpdate: noop,
  });

  const attackerStats = getMatchBehaviorStats(state.aiMatchContext, attacker.id);
  const targetStats = getMatchBehaviorStats(state.aiMatchContext, counteringTarget.id);

  assert.equal(attackerStats?.damageDealtCount, 1);
  assert.equal(attackerStats?.damageReceivedCount, 1);
  assert.equal(targetStats?.damageDealtCount, 1);
  assert.equal(targetStats?.damageReceivedCount, 1);
  assert.equal(targetStats?.countersAttempted, 1);
  assert.equal(targetStats?.countersLanded, 1);
});

test('existing hammer attack and lunge-start hooks record a single acting-bot sample each', () => {
  const state = makeState();
  const bot = makeCombatant('bot_actor', {
    activeWeapon: 'hammer',
    weaponState: 'ready',
  });
  const target = makeCombatant('bot_target', {
    pos: new THREE.Vector3(6, 0, 0),
  });
  state.otherPlayers.set(bot.id, bot);
  state.otherPlayers.set(target.id, target);

  const actions = createCombatantActionCallbacksForState({
    getState: () => state,
    getRefs: () => ({}) as never,
    spawnPoints: [],
    getRosterAI: () => [bot, target],
    getActiveCustomMap: () => null,
    getOptimalSpawnPoint: () => new THREE.Vector3(),
    recordCombatantObservation: (combatantId, observe) =>
      recordCombatantModelObservation(state, combatantId, observe),
    onMainAIHammerSwing: noop,
    playSwing: noop,
    playJump: noop,
    playDash: noop,
    playRespawn: noop,
  });

  actions.triggerCombatantAttack(bot, 'hammer');
  tryStartAISwordLungeForCombatant({
    self: bot,
    target: makeTarget(target),
    pos: bot.pos,
    vel: bot.vel,
    targetAirborne: false,
    playerModel: null,
    botId: bot.id,
    lungeDistanceToTarget: 6,
    triggerCombatantLunge: actions.triggerCombatantLunge,
    recordCombatantObservation: (combatantId, observe) =>
      recordCombatantModelObservation(state, combatantId, observe),
  });

  const stats = getMatchBehaviorStats(state.aiMatchContext, bot.id);
  assert.equal(stats?.hammerAttacks, 1);
  assert.equal(stats?.lungeAttempts, 1);
});
