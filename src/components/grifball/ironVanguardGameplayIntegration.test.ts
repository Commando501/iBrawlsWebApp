import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { DEFAULT_KEYBINDINGS, type ReplayFile, type Combatant } from '../../types';
import { createInitialGrifballRuntimeState } from './runtimeState';
import { buildCombatantRigForModel } from './combatantRig';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { initializeReplayRecordingForState, recordReplayFrameForState } from './replayRecordingRuntime';
import { buildReplayPlaybackFrameSlice } from './replayHelpers';
import type { LastRecordedReplayEntityState } from './runtimeRefs';
import { updatePlayerHorizontalMovementForState } from './playerMovementRuntime';
import { prepareIronVanguardBallVisuals } from './ironVanguardBallRuntime';

function fixture() {
  const state = createInitialGrifballRuntimeState({ debugMode: false, isMultiplayer: false, multiplayerRole: null,
    adminSettings: { ...DEFAULT_ADMIN_SETTINGS, gameMode: 'grifball', enableSprint: true } });
  const refs = createInitialGrifballThreeRefs();
  const ballMesh = new THREE.Mesh();
  const replayRecordingRef: {current: ReplayFile | null} = {current: null};
  const lastRecordedStateRef = {current: new Map<string, LastRecordedReplayEntityState>()};
  initializeReplayRecordingForState({state, replayData: null, replayRecordingRef, lastRecordedStateRef,
    lastRecordTimeRef: {current: 0}, replayRecordingElapsedTimeRef: {current: 0}, adminSettings: state.settings, visualModelPolicy: 'v3'});
  const record = (time: number) => recordReplayFrameForState({state, refs, ballMesh, time, replayRecordingRef, lastRecordedStateRef, isMultiplayer: false});
  const at = (time: number) => buildReplayPlaybackFrameSlice({replayData: replayRecordingRef.current!, time, botColors: {}})!.updatedPlayers;
  return { state, refs, ballMesh, record, at, replayRecordingRef };
}

test('stationary local and bot charge, look, gait and action clocks survive sparse recording', () => {
  const {state, record, at, replayRecordingRef} = fixture();
  state.activeWeapon = 'ball'; state.pWeaponState = 'melee_swing'; state.pWeaponTimer = .1;
  state.pSwordTimer = 99; state.pPistolTimer = 98;
  const bot = {id: 'main_ai', controller: 'ai', playerName: 'Bot', hue: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(),
    yaw: 0, pitch: 0, hp: 100, activeWeapon: 'ball', weaponState: 'swing_up', weaponTimer: .1, isCrouching: false} as Combatant;
  state.otherPlayers.set(bot.id, bot);
  record(0);
  state.grifballPassCharge = .8; state.pitch = .5; state.pWeaponTimer = .2; state.playerIsSprinting = true; state.playerSlideActive = true;
  bot.grifballPassCharge = .8; bot.pitch = .5; bot.weaponTimer = .2; bot.aiIsSprinting = true; bot.aiSlideActive = true;
  record(.1);
  for (const id of ['player','main_ai']) {
    const midway = at(.05).get(id)!;
    assert.equal(midway.ballCharge, .4); assert.equal(midway.pitch, .25);
    assert.ok(Math.abs(midway.weaponTimer - .15) < 1e-8, 'uses the active attack clock');
    assert.equal(at(.1).get(id)!.isSprinting, true); assert.equal(at(.1).get(id)!.isSliding, true);
  }
  record(.2);
  assert.equal(replayRecordingRef.current!.frames[2].player, undefined, 'unchanged poses stay sparse');
  assert.equal(replayRecordingRef.current!.frames[2].otherPlayers!.length, 0);
  state.activeWeapon = 'sword'; state.pSwordState = 'slashing'; state.pSwordTimer = .07; record(.3);
  assert.equal(at(.3).get('player')!.weaponTimer, .07);
  state.activeWeapon = 'pistol'; state.pPistolState = 'firing'; state.pPistolTimer = .03; record(.4);
  assert.equal(at(.4).get('player')!.weaponTimer, .03);
});

test('first-person throw release is recorded without a spectator body and clears on completion', () => {
  const {state, refs, ballMesh, record, at} = fixture();
  assert.equal(refs.hostGroup, null);
  state.grifball.phase = 'playing'; state.activeWeapon = 'ball'; state.grifballPassCharge = .6;
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = 'player';
  prepareIronVanguardBallVisuals(state, refs, ballMesh, 0); record(0);
  state.activeWeapon = 'hammer'; state.grifball.ball.state = 'thrown'; state.grifball.ball.holderId = null;
  prepareIronVanguardBallVisuals(state, refs, ballMesh, 0); record(.1);
  prepareIronVanguardBallVisuals(state, refs, ballMesh, .1); record(.2);
  assert.equal(at(.1).get('player')!.ballReleaseCharge, .6);
  assert.ok(Math.abs(at(.15).get('player')!.ballThrowTime! - .05) < 1e-8);
  prepareIronVanguardBallVisuals(state, refs, ballMesh, 1); record(.3);
  assert.equal(at(.3).get('player')!.ballThrowTime, undefined);
});

test('observer mirror receives the same bot charge and release metadata as the live roster', () => {
  const {state, refs, ballMesh} = fixture();
  const bot = {id: 'main_ai', controller: 'ai', hp: 100, activeWeapon: 'ball', weaponState: 'ready', grifballPassCharge: .7} as Combatant;
  state.otherPlayers.set(bot.id, bot); state.isObserverMode = true; state.grifball.phase = 'playing';
  refs.enemyGroup = new THREE.Group();
  const body = new THREE.Group();
  refs.otherPlayerMeshes.set(bot.id, {group: body, hammer: new THREE.Group(), sword: new THREE.Group(), rig: buildCombatantRigForModel(body)});
  state.grifball.ball.state = 'held'; state.grifball.ball.holderId = bot.id;
  prepareIronVanguardBallVisuals(state, refs, ballMesh, 0);
  assert.equal(refs.enemyGroup.userData.vanguardBallCharge, .7);
  state.grifball.ball.state = 'thrown'; state.grifball.ball.holderId = null; bot.activeWeapon = 'hammer';
  prepareIronVanguardBallVisuals(state, refs, ballMesh, 0);
  for (const group of [body, refs.enemyGroup]) {
    assert.equal(group.userData.vanguardBallThrowTime, 0);
    assert.equal(group.userData.vanguardBallReleaseCharge, .7);
  }
});

test('published sprint follows toggle and gamepad input, not a fixed speed threshold', () => {
  const {state, refs} = fixture(); state.settings.gameMode = 'sandbox'; state.settings.speedSprint = 80;
  const bindings = {...DEFAULT_KEYBINDINGS, holdToSprint: false};
  const sprintToggleActiveRef = {current: false}, prevSprintInputRef = {current: false};
  const step = (keysPressed: Record<string,boolean>, gamepad: Gamepad | null = null) => updatePlayerHorizontalMovementForState({
    state, refs, dt: 1/60, keysPressed, movementKeybindings: bindings, actionKeybindings: bindings,
    gamepad, mobileJoystick: null, mobileControlsActive: false, sprintToggleActiveRef, prevSprintInputRef});
  step({[bindings.moveForward]: true, [bindings.sprint]: true});
  assert.equal(state.playerIsSprinting, true); assert.ok(state.playerVel.length() < 5.5);
  step({[bindings.moveForward]: true}); assert.equal(state.playerIsSprinting, true);
  step({[bindings.moveForward]: true, [bindings.sprint]: true}); assert.equal(state.playerIsSprinting, false);
  bindings.holdToSprint = true;
  const buttons = Array.from({length: 16}, () => ({pressed:false, touched:false, value:0}));
  buttons[bindings.gamepadSprint ?? 10].pressed = true;
  step({}, {axes:[0,-1], buttons, connected:true, id:'test', index:0, mapping:'standard', timestamp:0, hapticActuators:[], vibrationActuator:null} as Gamepad); assert.equal(state.playerIsSprinting, true);
  state.isJumping = true; step({[bindings.moveForward]:true,[bindings.sprint]:true}); assert.equal(state.playerIsSprinting, false);
  state.isJumping = false; state.activeWeapon = 'ball'; state.settings.gameMode = 'grifball'; state.grifball.ball.holderId = 'player';
  step({[bindings.moveForward]:true,[bindings.sprint]:true}); assert.equal(state.playerIsSprinting, false, 'runner speed is not sprint');
});


test('live sync packet carries exact jump/sprint/slide state into the remote combatant', async (t) => {
  const originalSocket = globalThis.WebSocket;
  globalThis.WebSocket = {OPEN: 1} as typeof WebSocket;
  t.after(() => { if (originalSocket) globalThis.WebSocket = originalSocket; else delete (globalThis as any).WebSocket; });
  const {advanceGrifballFrameForState} = await import('./activeFrameRuntime');
  const {createOrUpdateRemoteCombatantForState} = await import('./remoteCombatantProvisioning');
  const {state, refs} = fixture(); state.isMultiplayer = true;
  const receiving = fixture(); receiving.refs.scene = new THREE.Scene();
  const noop = () => {};
  let packet: any;
  const socket = {readyState: 1, send: (raw:string) => {packet = JSON.parse(raw);}} as WebSocket;
  const tick = () => advanceGrifballFrameForState({state,refs,ballMeshRef:{current:null},ballChargingRef:{current:false},ballChargeTimerRef:{current:0},dt:1/60,isPlaying:true,isPausedRef:{current:false},replayData:null,
    keysPressed:{current:{}},grifbHoldTimerRef:{current:0},secretAudioRef:{current:null},isMultiplayer:true,multiplayerRole:'host',multiplayerSocket:socket,
    replayRecordingRef:{current:null},replayRecordingElapsedTimeRef:{current:0},lastRecordTimeRef:{current:0},
    spawnVoxelShockwaveParticles:noop,rebuildHostModel:noop,updatePhysics:noop,updateHammerAnimations:noop,runAIOrchestrator:noop,updateAI:noop,
    updateGrifball:noop,updateCharacterSkeletalAnimations:noop,updateMatchTimers:noop,enforceArenaBounds:noop,renderGame:noop,
    updateFloatingNameplate:noop,pushStatsUpdate:noop,updateRadarDOM:noop,runReplayPlaybackLoop:noop,recordReplayFrame:noop,playRespawn:noop});
  for (const value of [true,false]) {
    state.isJumping = value; state.playerIsSprinting = value; state.playerSlideActive = value;
    tick();
    createOrUpdateRemoteCombatantForState({state:receiving.state,refs:receiving.refs,clientId:'peer',data:packet,opponentClientId:'peer',
      activeCustomMap:null,spawnPoints:[],constrainCombatantToArena:noop});
    const remote=receiving.state.otherPlayers.get('peer')!;
    assert.equal(remote.isJumping,value);assert.equal(remote.aiIsSprinting,value);assert.equal(remote.aiSlideActive,value);
  }
});
