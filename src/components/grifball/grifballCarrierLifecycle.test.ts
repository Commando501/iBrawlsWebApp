import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { createOfflineBotCombatant } from '../../game/roster';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { advanceGrifballFrameForState } from './activeFrameRuntime';
import { applyBotMeleeImpactForState } from './botMeleeImpactRuntime';
import { reconcileGrifballCarrierForState, setGrifballCarrierForState, updateGrifballObjectiveForState } from './grifballObjectiveRuntime';

import { updateGrifballTeamPlanForState } from './grifballTeamPlanRuntime';
import type { CustomMapData } from '../../types';
import { defaultGrifballTactics } from '../../game/grifballTacticsConfig';

const noop = () => {};
function fixture() {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: false, multiplayerRole: null,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', maxHP: 1, attackRadius: 5 } });
  state.grifballTactics = defaultGrifballTactics(); state.isObserverMode = true; state.grifball.phase = 'playing'; state.arenaRadius = 60;
  state.otherPlayers.clear();
  for (const [id, team, z] of [['carrier', 'blue', 0], ['attacker', 'red', 3]] as const) {
    state.otherPlayers.set(id, createOfflineBotCombatant({ id, playerName: id, team,
      spawnPos: new THREE.Vector3(0, 0, z), yaw: 0, hue: 0, difficulty: 'normal', settings: state.settings }));
  }
  for (const bot of state.otherPlayers.values()) bot.invulnerabilityTimer = 0;
  const refs = createInitialGrifballThreeRefs();
  const ballMeshRef = { current: null as THREE.Mesh | null }, ballChargingRef = { current: false }, ballChargeTimerRef = { current: 0 };
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'carrier';
  setGrifballCarrierForState({ state, refs, id: 'carrier', carrying: true });
  state.otherPlayers.get('carrier')!.hp = 1;
  const map = { objects: [{ type: 'box', goalPlateTeam: 'red', position: { x: 47, y: 0, z: 0 }, scale: { x: 2, y: 0.1, z: 2 } }] } as CustomMapData;
  const objective = (dt: number) => updateGrifballObjectiveForState({ state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef,
    dt, isMultiplayer: false, activeCustomMap: map, placeCombatantsAtGrifballSpawns: noop, pushStatsUpdate: noop });
  const impact = () => applyBotMeleeImpactForState({ state, botId: 'attacker', renderHammerSplashVfx: noop,
    spawnVoxelShockwaveParticles: noop, playExplosion: noop, playDeath: noop, playSwing: noop,
    recordBotPsychKill: noop, recordBotCalibrationDeath: noop });
  const args = { state, refs, ballMeshRef, ballChargingRef, ballChargeTimerRef, dt: 1 / 60,
    isPlaying: true, isPausedRef: { current: false }, replayData: null, keysPressed: { current: {} },
    grifbHoldTimerRef: { current: 0 }, secretAudioRef: { current: null }, isMultiplayer: false,
    multiplayerRole: null, multiplayerSocket: null, replayRecordingRef: { current: null },
    replayRecordingElapsedTimeRef: { current: 0 }, lastRecordTimeRef: { current: 0 },
    spawnVoxelShockwaveParticles: noop, rebuildHostModel: noop, updatePhysics: noop,
    updateHammerAnimations: noop, runAIOrchestrator: noop, updateAI: noop,
    updateGrifball: objective, updateCharacterSkeletalAnimations: impact, updateMatchTimers: noop,
    enforceArenaBounds: noop, renderGame: noop, updateFloatingNameplate: noop, pushStatsUpdate: noop,
    updateRadarDOM: noop, runReplayPlaybackLoop: noop, recordReplayFrame: noop, playRespawn: noop };
  return { state, refs, args, objective, impact, ballMeshRef, ballChargingRef, ballChargeTimerRef };
}

test('late lethal melee releases the carrier before the frame is published', () => {
  const { state, args } = fixture();
  let published = false, objectiveTicks = 0;
  const original = args.updateGrifball;
  args.updateGrifball = dt => { objectiveTicks++; original(dt); };
  args.renderGame = () => {
    published = true;
    assert.equal(state.otherPlayers.get('carrier')!.hp, 0, 'real melee must kill the runner');
    assert.equal(state.grifball.ball.holderId, null, 'dead carrier must not reach rendering');
    assert.equal(state.grifball.ball.state, 'loose');
  };
  advanceGrifballFrameForState(args);
  assert.ok(published); assert.equal(objectiveTicks, 1);
  assert.equal(state.otherPlayers.get('carrier')!.activeWeapon, 'hammer');
  assert.equal(state.otherPlayers.get('carrier')!.respawnTimer, 3);
  assert.equal(state.otherPlayers.get('attacker')!.kills, 1);
});

test('late cleanup cancels carrier orders and charge; repeated cleanup has no side effects', () => {
  const f = fixture(), { state } = f, bot = state.otherPlayers.get('carrier')!;
  updateGrifballTeamPlanForState(state, 0.01, team => ({ x: team === 'blue' ? 47 : -47, z: 0 }));
  const plan = state.aiMatchContext.grifballTeamPlan;
  assert.ok(plan.assignments.size > 0);
  plan.passCharge = { carrierId: 'carrier', receiverId: 'attacker', speed: 10, elapsed: 0.5 };
  bot.grifballPassCharge = 0.5; bot.pickupRequested = true;
  state.aiMatchContext.coordinator.priorityTargetId = 'carrier';
  f.ballMeshRef.current = new THREE.Mesh();
  f.impact();
  assert.equal(reconcileGrifballCarrierForState(f), true);
  assert.equal(bot.hp, 0); assert.equal(bot.maxHp, 1); assert.equal(bot.grifballPassCharge, 0);
  assert.equal(bot.pickupRequested, false); assert.equal(plan.passCharge, null);
  assert.equal(state.aiMatchContext.coordinator.priorityTargetId, undefined);
  assert.ok([...plan.assignments.values()].every(a => a.carrierId !== 'carrier'));
  assert.deepEqual(f.ballMeshRef.current.position.toArray(), [0, 0.35, 0]);
  const ball = structuredClone(state.grifball.ball);
  assert.equal(reconcileGrifballCarrierForState(f), false); f.impact();
  assert.deepEqual(state.grifball.ball, ball); assert.equal(state.otherPlayers.get('attacker')!.kills, 1);
  updateGrifballTeamPlanForState(state, 0.01, team => ({ x: team === 'blue' ? 47 : -47, z: 0 }));
  assert.equal(plan.snapshot!.holderId, null); assert.equal(plan.assignments.has('carrier'), false);
});

test('early death is released by the objective and a living actor can recover the loose ball', () => {
  const f = fixture(), { state } = f;
  f.impact(); f.objective(1 / 60);
  assert.equal(state.grifball.ball.state, 'loose');
  const survivor = state.otherPlayers.get('attacker')!;
  survivor.pos.set(0, 0, 0); survivor.pickupRequested = true;
  state.otherPlayers.get('carrier')!.pickupRequested = true;
  f.objective(1 / 60);
  assert.equal(state.grifball.ball.holderId, 'attacker');
  assert.equal(state.otherPlayers.get('carrier')!.hp, 0);
  assert.equal(reconcileGrifballCarrierForState(f), false, 'living recovery must survive cleanup');
});

for (const local of [false, true]) test(`respawning ${local ? 'local player' : 'bot'} cannot retain possession`, () => {
  const f = fixture(), { state } = f;
  if (local) {
    state.isObserverMode = false; state.grifball.ball.holderId = 'player';
    setGrifballCarrierForState({ state, refs: f.refs, id: 'player', carrying: true });
    state.playerRespawnTimer = 2; state.playerHP = 1; state.playerPickupRequested = true;
    state.grifballPassCharge = 0.8; f.ballChargingRef.current = true; f.ballChargeTimerRef.current = 0.8;
  } else state.otherPlayers.get('carrier')!.respawnTimer = 2;
  assert.equal(reconcileGrifballCarrierForState(f), true);
  assert.equal(state.grifball.ball.holderId, null);
  if (local) {
    assert.equal(f.ballChargingRef.current, false); assert.equal(f.ballChargeTimerRef.current, 0);
    assert.equal(state.grifballPassCharge, 0); assert.equal(state.playerPickupRequested, false);
    assert.equal(state.activeWeapon, 'hammer'); assert.equal(state.playerRespawnTimer, 2);
    state.playerPickupRequested = true; f.objective(1 / 60);
    assert.equal(state.grifball.ball.holderId, null);
  }
});

test('missing carrier returns a loose ball at home without crashing', () => {
  const f = fixture(); f.state.otherPlayers.delete('carrier');
  assert.equal(reconcileGrifballCarrierForState(f), true);
  assert.equal(f.state.grifball.ball.holderId, null);
  assert.equal(f.state.grifball.ball.pos.x, f.state.grifball.ball.home.x);
});

test('local carrier killed in late melee loses possession and charge before publishing', () => {
  const f = fixture(); f.state.isObserverMode = false; f.state.playerPos.set(0, 0, 0);
  f.state.playerHP = 1; f.state.playerInvulnerabilityTimer = 0; f.state.playerRespawnTimer = 0;
  f.state.localPlayerTeam = 'blue'; f.state.grifball.ball.holderId = 'player';
  f.state.playerRunnerHealDelayTimer = 10; f.state.activeWeapon = 'ball'; f.ballChargingRef.current = true; f.ballChargeTimerRef.current = 0.2;
  advanceGrifballFrameForState(f.args);
  assert.equal(f.state.playerHP, 0); assert.equal(f.state.grifball.ball.holderId, null);
  assert.equal(f.ballChargingRef.current, false); assert.equal(f.state.activeWeapon, 'hammer');
});

test('goal awarded before a later hit is preserved and cleanup does not score again', () => {
  const f = fixture(), { state } = f;
  state.otherPlayers.get('carrier')!.pos.set(47, 0, 0);
  f.args.updateCharacterSkeletalAnimations = () => { state.otherPlayers.get('carrier')!.hp = 0; };
  advanceGrifballFrameForState(f.args);
  assert.equal(state.teamScores.blue.goals, 1); assert.equal(state.grifball.phase, 'scored');
  assert.equal(state.grifball.ball.state, 'idle'); assert.equal(state.grifball.ball.holderId, null);
  assert.equal(reconcileGrifballCarrierForState(f), false); assert.equal(state.teamScores.blue.goals, 1);
});

for (const phase of ['countdown', 'matchEnd'] as const) test(`cleanup never advances ${phase} or revives a carrier`, () => {
  const f = fixture(); f.state.grifball.phase = phase; f.state.grifball.phaseTimer = 0.7;
  f.state.otherPlayers.get('carrier')!.hp = 0;
  reconcileGrifballCarrierForState(f);
  assert.equal(f.state.grifball.phase, phase); assert.equal(f.state.grifball.phaseTimer, 0.7);
  assert.equal(f.state.otherPlayers.get('carrier')!.hp, 0);
});

test('multiplayer and non-Grifball ownership remain with their existing authority', () => {
  const f = fixture(); f.state.otherPlayers.get('carrier')!.hp = 0;
  f.state.isMultiplayer = true; assert.equal(reconcileGrifballCarrierForState(f), false);
  f.state.isMultiplayer = false; f.state.settings.gameMode = 'sandbox';
  assert.equal(reconcileGrifballCarrierForState(f), false); assert.equal(f.state.grifball.ball.holderId, 'carrier');
});


test('respawn and round reset do not restore stale ownership or charge', () => {
  const f = fixture(), carrier = f.state.otherPlayers.get('carrier')!;
  f.impact(); reconcileGrifballCarrierForState(f);
  carrier.hp = carrier.maxHp; carrier.respawnTimer = 0; carrier.pos.set(20, 0, 0);
  f.objective(1 / 60);
  assert.equal(f.state.grifball.ball.holderId, null); assert.equal(carrier.activeWeapon, 'hammer');
  f.state.grifball.phase = 'scored'; f.state.grifball.phaseTimer = f.state.settings.grifballRoundResetDelay ?? 4;
  f.objective(1 / 60);
  assert.equal(f.state.grifball.ball.state, 'idle'); assert.equal(f.state.grifball.ball.holderId, null);
  assert.equal(carrier.grifballPassCharge, 0); assert.equal(f.state.aiMatchContext.grifballTeamPlan.passCharge, null);
});
