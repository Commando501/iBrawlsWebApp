import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { preloadIronVanguard, disposeIronVanguardScene } from './ironVanguardModel';
import { createArenaOrchestratorCallbacksForState } from '../grifball/arenaOrchestratorCallbacks';
import { createInitialGrifballRuntimeState } from '../grifball/runtimeState';
import { createInitialGrifballThreeRefs } from '../grifball/threeRefs';
import { createOfflineBotCombatant } from '../../game/roster';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { updateRosterCombatantVisualsForState } from '../grifball/rosterVisualSync';
import { buildLocalPlayerViewForRefs } from '../grifball/localPlayerViewRuntime';
import { rebuildEnemyCombatantModelForState, rebuildHostCombatantModelForState } from '../grifball/combatantModelRebuild';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import { updateV3GameplayBall } from '../grifball/v3GameplayBall';
import type { VisualModelPolicy } from '../../model/modelSystem';

const bytes = readFileSync(new URL('../../../public/assets/iron-vanguard/hammer-v018.glb', import.meta.url));
const asset = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength), '');
const transport = mock.method(GLTFLoader.prototype, 'loadAsync', async () => asset);
try { await preloadIronVanguard(); } finally { transport.mock.restore(); }

test('Version 3 covers main AI, every added bot, hue rebuilds, respawns, and return to Version 2', () => {
  const state = createInitialGrifballRuntimeState({debugMode:false, adminSettings:{...DEFAULT_ADMIN_SETTINGS, gameMode:'grifball'}, multiplayerRole:null,isMultiplayer:false});
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  let policy: VisualModelPolicy = 'v3';
  const callbacks = createArenaOrchestratorCallbacksForState({
    getState:()=>state, getRefs:()=>refs, spawnPoints:[], getActiveCustomMap:()=>null,
    getLegacyRosterProps:()=>({}), getOfflineBotCount:()=>7, isPlaying:true, opponentClientId:'peer',
    constrainCombatantToArena:()=>{},getVisualModelPolicy:()=>policy,pushStatsUpdate:()=>{},playRespawn:()=>{},
  });
  const events = callbacks.buildOrchestratorEvents({silentSpawn:true});
  const bodies: THREE.Group[] = [];
  for (let slot=0;slot<7;slot++) {
    const bot = createOfflineBotCombatant({id:slot===0?'main_ai':`bot_${slot}`,playerName:`Bot ${slot}`,team:slot%2?'blue':'red',spawnPos:new THREE.Vector3(slot,0,0),yaw:0,hue:slot*40,difficulty:slot===0?'easy':'hard',settings:state.settings});
    state.otherPlayers.set(bot.id,bot);
    // Stale per-bot policy cannot override the current match selection.
    Object.assign(bot,{visualModelPolicy:'v1'});
    if(slot===0) events.onMainAICreated!(bot); else events.onBotSpawned!(bot.id,bot);
    const rig = refs.otherPlayerMeshes.get(bot.id)!;
    assert.equal(rig.group.userData.characterAsset,'iron-vanguard',bot.id);
    assert.equal(rig.group.userData.assetStatus,'ready',bot.id);
    assert.equal(rig.hammer,rig.group.userData.ironVanguardHammer);
    assert.equal(rig.group.userData.teamArmorSources.length,1);
    bot.weaponState='recovering';bot.weaponTimer=0;bot.respawnTimer=0;bot.hp=1;
    bodies.push(rig.group);
  }
  const tick=()=>updateRosterCombatantVisualsForState({state,refs,dt:0,renderSwordLungeTrailVfx:()=>{},applyBotMeleeImpact:()=>{}});
  tick();
  for(const group of bodies) assert.equal(group.userData.ironVanguardSourceFrame,34);
  const neutralHeads = bodies.map(group => group.getObjectByName('neck')!.getWorldQuaternion(new THREE.Quaternion()).normalize());
  for (const [index, bot] of Array.from(state.otherPlayers.values()).entries()) bot.pitch = index % 2 ? -0.4 : 0.5;
  tick();
  for (const [index, group] of bodies.entries()) {
    const actual = group.getObjectByName('neck')!.getWorldQuaternion(new THREE.Quaternion()).normalize();
    assert.ok(Math.abs(actual.angleTo(neutralHeads[index]) - (index % 2 ? 0.4 : 0.5)) < 1e-5, 'roster pitch reaches every Vanguard');
  }
  for (const bot of state.otherPlayers.values()) bot.pitch = 0;
  tick();
  const main=state.otherPlayers.get('main_ai')!;
  main.hp=0;main.respawnTimer=3;tick();assert.equal(bodies[0].visible,false);
  main.hp=1;main.respawnTimer=0;tick();assert.equal(bodies[0].visible,true);
  main.hue=250;events.onHueChanged!('main_ai',main);
  assert.notEqual(refs.otherPlayerMeshes.get('main_ai')!.group,bodies[0]);
  assert.equal(refs.otherPlayerMeshes.get('main_ai')!.group.userData.assetStatus,'ready');
  policy='v2';
  for(const bot of state.otherPlayers.values()) {
    callbacks.createOrUpdateRemotePlayer(bot.id,bot);
    assert.equal(refs.otherPlayerMeshes.get(bot.id)!.group.userData.characterAsset,undefined);
    assert.equal(refs.otherPlayerMeshes.get(bot.id)!.group.userData.modelSystem,'v2');
  }
  policy='v3';
  for(const bot of state.otherPlayers.values()) callbacks.createOrUpdateRemotePlayer(bot.id,bot);
  assert.equal(refs.otherPlayerMeshes.size,7);
  for(const rig of refs.otherPlayerMeshes.values()) assert.equal(rig.group.userData.assetStatus,'ready');
  disposeIronVanguardScene(refs.scene);
});

test('Version 3 local weapons and observer rebuilds keep the imported hammer and character', () => {
  const state = createInitialGrifballRuntimeState({debugMode:false,adminSettings:DEFAULT_ADMIN_SETTINGS,multiplayerRole:null,isMultiplayer:false});
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene(); refs.camera = new THREE.PerspectiveCamera();
  refs.scene.add(refs.camera);
  const playerLoadout = resolveLoadoutForVisualPolicy({visualModelPolicy:'v3'});
  buildLocalPlayerViewForRefs({refs,scene:refs.scene,camera:refs.camera,adminSettings:{},playerLoadout});
  assert.equal(refs.playerHammer!.userData.characterAsset,'iron-vanguard');
  assert.equal(refs.playerHammer!.userData.assetStatus,'ready');
  const ball = new THREE.Mesh(new THREE.SphereGeometry(),new THREE.MeshStandardMaterial());
  assert.equal(updateV3GameplayBall(state,refs,ball,0,'v3'),false);
  assert.equal(ball.material.visible,false);
  assert.equal(ball.getObjectByName('v3SkullBomb')?.visible,true);
  ball.geometry.dispose();ball.material.dispose();
  assert.equal(refs.playerHammer!.getObjectByName('IV_TransferBody_ShoulderFix')!.visible,false);
  rebuildHostCombatantModelForState({state,refs,hue:200,isMultiplayer:false,multiplayerRole:null,playerLoadout});
  assert.equal(refs.hostGroup!.userData.assetStatus,'ready');
  refs.enemyGroup = new THREE.Group();refs.scene.add(refs.enemyGroup);
  rebuildEnemyCombatantModelForState({state,refs,hue:100,isMultiplayer:false,multiplayerRole:null,playerLoadout,mainAI:undefined});
  assert.equal(refs.enemyGroup!.userData.assetStatus,'ready');
  assert.equal(refs.enemyHammer,refs.enemyGroup!.userData.ironVanguardHammer);
  disposeIronVanguardScene(refs.scene);
});


test('recorded ball charge and release reach the gameplay rig, hide the restored weapon, and clear on rewind', async () => {
  const { updateReplayCombatantVisualsForFrame } = await import('../grifball/replayPlaybackVisuals');
  const { buildReplayPlaybackFrameSlice } = await import('../grifball/replayHelpers');
  const { initializeReplayRecordingForState, recordReplayFrameForState } = await import('../grifball/replayRecordingRuntime');
  const state = createInitialGrifballRuntimeState({debugMode: false, isMultiplayer: false, multiplayerRole: null, adminSettings: DEFAULT_ADMIN_SETTINGS});
  const refs = createInitialGrifballThreeRefs(); refs.scene = new THREE.Scene();
  const recording = {current: null as import('../../types').ReplayFile | null};
  const previous = {current: new Map<string, import('../grifball/runtimeRefs').LastRecordedReplayEntityState>()};
  const ballMesh = new THREE.Mesh();
  initializeReplayRecordingForState({state, replayData: null, replayRecordingRef: recording, lastRecordTimeRef: {current:0},
    replayRecordingElapsedTimeRef: {current:0}, lastRecordedStateRef: previous, adminSettings: DEFAULT_ADMIN_SETTINGS, visualModelPolicy:'v3'});
  const record = (time:number) => recordReplayFrameForState({state, ballMesh, time, replayRecordingRef:recording, lastRecordedStateRef:previous, isMultiplayer:false});
  const draw = (time:number) => updateReplayCombatantVisualsForFrame({refs, replayData:recording.current,
    updatedPlayers:buildReplayPlaybackFrameSlice({replayData:recording.current!,time,botColors:{}})!.updatedPlayers,
    targetId:'free',observerCamMode:'third',replayPlayerName:'Player',dt:0,animateSpartanModel:()=>{},renderSwordLungeTrailVfx:()=>{},updateBlinking:()=>{},settings:state.settings});
  state.activeWeapon='ball'; state.grifballPassCharge=.7; record(0); draw(0);
  const rig=refs.otherPlayerMeshes.get('player')!;
  assert.equal(rig.group.userData.assetStatus,'ready');
  assert.equal(rig.group.userData.ironVanguardBallPhase,'charge');
  const wrist=rig.group.getObjectByName('RightHand')!;
  const charged=wrist.getWorldPosition(new THREE.Vector3());
  state.activeWeapon='hammer';
  ballMesh.userData.ironVanguardBallVisual={release:{id:'player',time:.2,charge:.7}};
  record(.1); draw(.1);
  assert.equal(rig.hammer.visible,false);
  assert.equal(rig.sword.visible,false);
  assert.ok(wrist.getWorldPosition(new THREE.Vector3()).distanceTo(charged)>.1,'release animates the real skeleton');
  delete ballMesh.userData.ironVanguardBallVisual;
  record(.2); draw(.2);
  assert.equal(rig.hammer.visible,true);
  draw(0);
  assert.equal(rig.group.userData.vanguardBallThrowTime,undefined);
  assert.ok(wrist.getWorldPosition(new THREE.Vector3()).distanceTo(charged)<1e-5,'seeking clears the release overlay');
  disposeIronVanguardScene(refs.scene);
});
