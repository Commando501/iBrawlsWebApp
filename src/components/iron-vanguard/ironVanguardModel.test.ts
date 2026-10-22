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

test("cached authored frames preserve full poses through movement, weapons, and recovery", () => {
  for (const firstPerson of [false, true]) {
    const cached = createIronVanguardModel(200, firstPerson, gltf);
    const reference = createIronVanguardModel(200, firstPerson, gltf);
    const counts = [0, 0];
    [cached, reference].forEach((root, index) => {
      const mixer = root.userData.ironVanguard.mixer as THREE.AnimationMixer;
      const setTime = mixer.setTime.bind(mixer);
      mixer.setTime = time => { counts[index]++; return setTime(time); };
    });
    try {
      for (let i = 0; i < 120; i++) {
        const input = {
          activeWeapon: i < 50 || i >= 80 ? 'hammer' : i < 65 ? 'sword' : 'ball',
          weaponState: i >= 80 && i < 90 ? 'swing_up' : i < 100 && i >= 90 ? 'recovering' : 'ready',
          weaponTimer: i >= 80 && i < 100 ? (i % 10) * .03 : 0,
          dt: 1 / 60,
          vel: new THREE.Vector3(i < 10 ? 0 : 5, 0, i < 40 ? 0 : 2),
          yaw: i * .01,
          lookPitch: Math.sin(i * .1) * .4,
          isSprinting: i >= 20 && i < 30,
          isCrouching: i >= 30 && i < 40,
          isJumping: i >= 40 && i < 50,
          ballCharge: .5,
          settings,
        };
        // Re-evaluate the reference with the original mixer path every frame.
        reference.userData.ironVanguard.authoredFrame = undefined;
        animateIronVanguard(reference, input);
        animateIronVanguard(cached, input);
        cached.updateMatrixWorld(true);
        reference.updateMatrixWorld(true);
        const expected: number[] = [], actual: number[] = [];
        for (const [root, values] of [[reference, expected], [cached, actual]] as const) {
          root.traverse(object => {
            values.push(...object.matrixWorld.elements);
            if (object instanceof THREE.Mesh) values.push(...(object.morphTargetInfluences ?? []));
          });
        }
        assert.deepEqual(actual, expected, `frame ${i}, firstPerson=${firstPerson}`);
      }
      assert.equal(counts[1], 120);
      assert.ok(counts[0] < 25, `only changed authored poses should sample the mixer: ${counts[0]}`);
    } finally {
      disposeIronVanguard(cached);
      disposeIronVanguard(reference);
    }
  }
});

test("conservative culling encloses every skinned vertex through authored and procedural poses", () => {
  const root = createIronVanguardModel(200, false, gltf);
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse(object => { if (object instanceof THREE.SkinnedMesh) meshes.push(object); });
  const point = new THREE.Vector3();
  const assertEnclosed = (label: string) => {
    root.updateMatrixWorld(true);
    for (const mesh of meshes) {
      mesh.skeleton.update();
      assert.equal(mesh.frustumCulled, true);
      const sphere = mesh.boundingSphere!;
      let farthest = 0;
      for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
        mesh.getVertexPosition(i, point);
        farthest = Math.max(farthest, point.distanceTo(sphere.center));
      }
      assert.ok(farthest < sphere.radius, `${label}: ${mesh.name} extent ${farthest} exceeds ${sphere.radius}`);
    }
  };
  try {
    for (let i = 0; i <= 70; i++) {
      const state = i <= 24 ? 'swing_up' : i <= 34 ? 'swing_down' : 'recovering';
      const timer = i <= 24 ? i / 24 * .3 : i <= 34 ? (i - 24) / 10 * .2 : (i - 34) / 36 * 1.1;
      pose(root, state, timer);
      assertEnclosed(`authored ${i}`);
    }
    for (const activeWeapon of ['hammer', 'sword', 'ball', 'pistol']) {
      for (let i = 0; i < 32; i++) {
        animateIronVanguard(root, {
          activeWeapon, weaponState: i < 16 ? 'ready' : 'swing_up', weaponTimer: (i % 16) / 16 * .3,
          dt: 1 / 30, vel: new THREE.Vector3(Math.sin(i) * 12, i < 8 ? 5 : 0, Math.cos(i) * 12),
          yaw: i * .2, lookPitch: Math.sin(i) * 1.3, isJumping: i < 8,
          isSprinting: i >= 8 && i < 16, isCrouching: i >= 16 && i < 24,
          isSliding: i >= 24, isLunging: activeWeapon === 'sword' && i < 8,
          ballCharge: i / 32, settings,
        });
        assertEnclosed(`${activeWeapon} procedural ${i}`);
      }
    }
    const camera = new THREE.PerspectiveCamera(60, 1, .1, 200);
    camera.updateMatrixWorld(true);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    root.position.set(50, 0, -10); root.updateMatrixWorld(true);
    assert.ok(meshes.every(mesh => !frustum.intersectsObject(mesh)), 'offscreen bodies can be culled');
    root.position.set(3, 0, -5); root.updateMatrixWorld(true);
    assert.ok(meshes.every(mesh => frustum.intersectsObject(mesh)), 'edge-of-view limbs retain a generous margin');
    root.rotation.set(.1, 1.2, -.15); root.scale.set(1.3, .8, 1.1);
    assertEnclosed('translated, rotated, and scaled parent');
  } finally { disposeIronVanguard(root); }
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
