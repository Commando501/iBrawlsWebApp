import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  createIronVanguardModel,
  animateIronVanguard,
  disposeIronVanguard,
} from "./ironVanguardModel";
import {
  animateSpartanCombatantModel,
  animateCombatantWeaponMeshes,
} from "../grifball/combatantAnimation";
import { updatePlayerHammerAnimationForState } from "../grifball/playerHammerAnimationRuntime";
import {
  registerCombatantTeamArmorSources,
  syncCombatantTeamArmor,
  syncCombatantRunnerArmor,
} from "../grifball/combatantTeamArmor";
import { sanitizeCharacterLoadoutForNetwork } from "../customArmor";
import {
  getPreviewLoadoutSignature,
  disposePreviewObject,
} from "../previewModelUtils";
import { resolveLoadoutForVisualPolicy } from "../../model/modelVisualPolicy";
import type { GrifballRuntimeState } from "../grifball/runtimeState";
import { createInitialGrifballThreeRefs } from "../grifball/threeRefs";
const bytes = readFileSync(
  new URL(
    "../../../public/assets/iron-vanguard/hammer-v018.glb",
    import.meta.url,
  ),
);
const gltf = await new GLTFLoader()
  .setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
const settings = {
  hammerSlamWindupTime: 0.3,
  hammerSlamAttackTime: 0.2,
  hammerReloadTime: 1.1,
};
const pose = (root: THREE.Group, state: string, timer: number) =>
  animateIronVanguard(root, {
    weaponState: state,
    weaponTimer: timer,
    dt: 0,
    settings,
  });

test("gameplay asset retains its corrective shapes, skeleton, and reduced geometry budget", () => {
  const root = createIronVanguardModel(200, false, gltf);
  const body = root.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  assert.equal(root.userData.assetStatus, "ready");
  assert.equal(body.morphTargetInfluences?.length, 70);
  assert.equal(body.skeleton.bones.length, 61);
  let triangles = 0;
  root.traverse((o) => {
    if (o instanceof THREE.Mesh)
      triangles +=
        (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  });
  assert.ok(triangles < 45000);
  assert.ok(bytes.byteLength < 7_000_000);
  root.updateMatrixWorld(true);
  const height = new THREE.Box3()
    .setFromObject(body, true)
    .getSize(new THREE.Vector3()).y;
  assert.ok(height > 1.7 && height < 1.9, `body height ${height}`);
  disposeIronVanguard(root);
});

test("independent instances share geometry but retain independent pose and materials", () => {
  const a = createIronVanguardModel(0, false, gltf),
    b = createIronVanguardModel(200, false, gltf);
  const ab = a.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  const bb = b.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  assert.equal(ab.geometry, bb.geometry);
  assert.notEqual(ab.skeleton, bb.skeleton);
  assert.notEqual(ab.material, bb.material);
  const before = b
    .getObjectByName("LeftHand")!
    .getWorldPosition(new THREE.Vector3());
  pose(a, "swing_up", 0.3);
  assert.ok(
    a
      .getObjectByName("LeftHand")!
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(before) > 0.1,
  );
  assert.ok(
    b
      .getObjectByName("LeftHand")!
      .getWorldPosition(new THREE.Vector3())
      .distanceTo(before) < 0.00001,
  );
  pose(a, "recovering", 1.1);
  pose(a, "swing_up", 0.3);
  assert.ok(
    ab.morphTargetInfluences![24] > 0.999,
    "seeking after the endpoint must resume",
  );
  let disposedGeometry = 0;
  ab.geometry.addEventListener("dispose", () => disposedGeometry++);
  disposePreviewObject(a);
  assert.equal(disposedGeometry, 0);
  pose(b, "swing_down", 0.1);
  assert.equal(b.userData.ironVanguardSourceFrame, 29);
  disposeIronVanguard(b);
});

test("team and runner colors affect the body while hammer visibility follows weapon switches", () => {
  const root = createIronVanguardModel(200, false, gltf);
  const body = root.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  const weapon = root.getObjectByName("IV_TransferHammer") as THREE.SkinnedMesh;
  const originalWeaponMaterial = weapon.material;
  assert.deepEqual(registerCombatantTeamArmorSources(root), [body]);
  syncCombatantTeamArmor(root, "blue", "blue");
  syncCombatantRunnerArmor(root, true);
  assert.equal(
    (body.material as THREE.MeshStandardMaterial).color.getHexString(),
    "fbbf24",
  );
  assert.equal(weapon.material, originalWeaponMaterial);
  const hammer = root.userData.ironVanguardHammer;
  animateCombatantWeaponMeshes({
    combatantModel: root,
    hammerModel: hammer,
    swordModel: null,
    activeWeapon: "sword",
    weaponState: "ready",
    weaponTimer: 0,
    dt: 0.016,
    isLunging: false,
    settings,
  });
  assert.equal(weapon.visible, false);
  animateCombatantWeaponMeshes({
    combatantModel: root,
    hammerModel: hammer,
    swordModel: null,
    activeWeapon: "hammer",
    weaponState: "ready",
    weaponTimer: 0,
    dt: 0.016,
    isLunging: false,
    settings,
  });
  assert.equal(weapon.visible, true);
  disposeIronVanguard(root);
});

test("live third-person animation selects the authored impact pose through the shared runtime", () => {
  const root = createIronVanguardModel(200, false, gltf);
  animateSpartanCombatantModel({
    refs: createInitialGrifballThreeRefs(),
    mesh: root,
    vel: new THREE.Vector3(),
    yaw: 0,
    hp: 100,
    weaponState: "recovering",
    weaponTimer: 0,
    dt: 0.016,
    settings,
  });
  assert.equal(root.userData.ironVanguardSourceFrame, 34);
  assert.ok(
    (root.getObjectByName("IV_TransferBody_ShoulderFix") as THREE.SkinnedMesh)
      .morphTargetInfluences![34] > 0.999,
  );
  disposeIronVanguard(root);
});

test("first-person swing keeps the authoritative impact callback and authored pose synchronized", () => {
  const root = createIronVanguardModel(200, true, gltf);
  const state = {
    activeWeapon: "hammer",
    pWeaponState: "swing_up",
    pWeaponTimer: 0,
    pWeaponReady: false,
    swapCooldownTimer: 0,
    settings,
  } as GrifballRuntimeState;
  let impacts = 0;
  const tick = (dt: number) =>
    updatePlayerHammerAnimationForState({
      state,
      playerHammer: root,
      dt,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyHammerStrikeImpact: () => impacts++,
      applyPlayerHammerMeleeImpact: () => {},
    });
  tick(0.3);
  assert.equal(impacts, 0);
  assert.equal(root.userData.ironVanguardSourceFrame, 24);
  tick(0.2);
  assert.equal(impacts, 1);
  assert.equal(root.userData.ironVanguardSourceFrame, 34);
  tick(0.1);
  assert.equal(root.userData.ironVanguardSourceFrame, 42);
  tick(1);
  assert.equal(impacts, 1);
  assert.equal(state.pWeaponState, "ready");
  assert.equal(
    root.getObjectByName("IV_TransferBody_ShoulderFix")!.visible,
    false,
  );
  disposeIronVanguard(root);
});

test("loadout persistence and V3 visual policy select the character", () => {
  const loadout = {
    characterAsset: "iron-vanguard" as const,
    modelSystem: "v2" as const,
    modelType: "medium" as const,
  };
  assert.deepEqual(sanitizeCharacterLoadoutForNetwork(loadout), loadout);
  assert.equal(
    resolveLoadoutForVisualPolicy({ loadout, visualModelPolicy: "v3" })
      .characterAsset,
    "iron-vanguard",
  );
  assert.equal(
    sanitizeCharacterLoadoutForNetwork({
      characterAsset: "https://invalid.example/asset.glb",
    }),
    undefined,
  );
  assert.notEqual(
    getPreviewLoadoutSignature(loadout),
    getPreviewLoadoutSignature({ modelSystem: "v2", modelType: "medium" }),
  );
});

test("baked movement and secondary poses do not accumulate or leak into the next authored pose", () => {
  const root = createIronVanguardModel(200, false, gltf);
  const leg = root.getObjectByName("LeftUpLeg")!;
  const arm = root.getObjectByName("LeftArm")!;
  const readyLeg = leg.quaternion.clone(),
    readyArm = arm.quaternion.clone();
  for (let i = 0; i < 300; i++)
    animateIronVanguard(root, {
      weaponState: "ready",
      weaponTimer: 0,
      dt: 0.016,
      vel: new THREE.Vector3(6, 0, 0),
      activeWeapon: "sword",
    });
  pose(root, "swing_up", 0);
  assert.ok(leg.quaternion.angleTo(readyLeg) < 0.00001);
  assert.ok(arm.quaternion.angleTo(readyArm) < 0.00001);
  for (let i = 0; i < 5; i++) {
    pose(root, "swing_up", 0.3);
    pose(root, "swing_up", 0);
  }
  assert.ok(leg.quaternion.angleTo(readyLeg) < 0.00001);
  disposeIronVanguard(root);
});

test('remote roster and replay factories retain the character, animated hammer, and death/respawn visibility', async () => {
  const { mock } = await import('node:test');
  const { preloadIronVanguard } = await import('./ironVanguardModel');
  const transport = mock.method(GLTFLoader.prototype, 'loadAsync', async () => gltf);
  try { await preloadIronVanguard(); } finally { transport.mock.restore(); }
  const { createInitialGrifballRuntimeState } = await import('../grifball/runtimeState');
  const { DEFAULT_ADMIN_SETTINGS } = await import('../../settings/gameplaySettings');
  const { createOrUpdateRemoteCombatantForState } = await import('../grifball/remoteCombatantProvisioning');
  const { updateRosterCombatantVisualsForState } = await import('../grifball/rosterVisualSync');
  const { updateReplayCombatantVisualsForFrame } = await import('../grifball/replayPlaybackVisuals');
  const loadout = {characterAsset:'iron-vanguard' as const, modelSystem:'v2' as const, modelType:'medium' as const};
  const state = createInitialGrifballRuntimeState({debugMode:false,adminSettings:{...DEFAULT_ADMIN_SETTINGS,...settings},multiplayerRole:null,isMultiplayer:false});
  const refs = createInitialGrifballThreeRefs();refs.scene = new THREE.Scene();
  createOrUpdateRemoteCombatantForState({state,refs,clientId:'peer',data:{controller:'remote',loadout,visualModelPolicy:'v3',hp:1,activeWeapon:'hammer'},opponentClientId:'peer',activeCustomMap:null,spawnPoints:[],constrainCombatantToArena:()=>{}});
  const remote = refs.otherPlayerMeshes.get('peer')!;
  assert.equal(remote.group.userData.assetStatus,'ready');
  const actor = state.otherPlayers.get('peer')!;
  actor.weaponState='recovering';actor.weaponTimer=0;actor.respawnTimer=0;
  const update = () => updateRosterCombatantVisualsForState({state,refs,dt:0,renderSwordLungeTrailVfx:()=>{},applyBotMeleeImpact:()=>{}});
  update();assert.equal(remote.group.userData.ironVanguardSourceFrame,34);
  assert.equal(remote.hammer,remote.group.userData.ironVanguardHammer);
  actor.hp=0;actor.respawnTimer=3;update();assert.equal(remote.group.visible,false);
  actor.hp=1;actor.respawnTimer=0;update();assert.equal(remote.group.visible,true);
  assert.equal(remote.group.userData.assetStatus,'ready');
  const player = {pos:new THREE.Vector3(),vel:new THREE.Vector3(),yaw:0,hp:1,hue:200,weaponState:'recovering',weaponTimer:0,respawnTimer:0,activeWeapon:'hammer',crouchScaleY:1,team:'blue'};
  const replayData = {visualModelPolicy:'v3',visualLoadouts:{replayed:loadout},gameMode:'grifball'};
  updateReplayCombatantVisualsForFrame({refs,replayData:replayData as any,updatedPlayers:new Map([['replayed',player as any]]),targetId:'replayed',observerCamMode:'third',replayPlayerName:'test',dt:0,settings,animateSpartanModel:()=>{throw Error('Must not use legacy animation')},renderSwordLungeTrailVfx:()=>{},updateBlinking:()=>{}});
  const replay = refs.otherPlayerMeshes.get('replayed')!;
  assert.equal(replay.group.userData.assetStatus,'ready');
  assert.equal(replay.group.userData.ironVanguardSourceFrame,34);
  assert.equal(replay.group.userData.teamArmorSources.length,1);
  disposeIronVanguard(remote.group);disposeIronVanguard(replay.group);
});
