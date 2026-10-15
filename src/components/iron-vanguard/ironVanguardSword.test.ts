import { finishPlayerSwordLungeRecoveryForState } from "../grifball/playerWeaponActions";
import { finishAISwordLungeWithVitals } from "../grifball/aiSwordLungeFinishRuntime";
import {
  createVanguardSwordView,
  animateVanguardSwordView,
} from "./ironVanguardSwordView";
import { buildLocalPlayerViewForRefs } from "../grifball/localPlayerViewRuntime";
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
  attachVanguardSword,
  createVanguardSword,
  sampleVanguardSword,
} from "./ironVanguardSword";
import { VANGUARD_SWORD_IDLE } from "./ironVanguardSword.generated";
import { updatePlayerSwordAnimationForState } from "../grifball/playerSwordAnimationRuntime";
import {
  createCombatantMeshRig,
  rebuildDualWeaponCombatantModel,
} from "../grifball/combatantModels";
import { animateCombatantWeaponMeshes } from "../grifball/combatantAnimation";
const load = async (name: string) => {
  const b = readFileSync(`public/assets/iron-vanguard/${name}`);
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
};
const [body, prop] = await Promise.all([
  load("hammer-v018.glb"),
  load("sword-v001.glb"),
]);
const position = (root: THREE.Group, n: string) =>
  root.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
const matrixError = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));

test("shipping sword is a bounded, finite rigid prop; instances own disposable resources", () => {
  let count = 0;
  prop.scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      count++;
      assert.ok(!(o instanceof THREE.SkinnedMesh));
      assert.ok(o.geometry.index!.count / 3 < 20000);
      assert.ok(
        Array.from(o.geometry.attributes.position.array).every(Number.isFinite),
      );
    }
  });
  assert.equal(count, 1);
  const a = createVanguardSword(prop),
    b = createVanguardSword(prop);
  let am: THREE.Mesh | undefined, bm: THREE.Mesh | undefined;
  a.traverse((o) => {
    if (o instanceof THREE.Mesh) am = o;
  });
  b.traverse((o) => {
    if (o instanceof THREE.Mesh) bm = o;
  });
  assert.notEqual(am!.geometry, bm!.geometry);
  assert.notEqual(am!.material, bm!.material);
  const size = new THREE.Box3().setFromObject(a).getSize(new THREE.Vector3());
  assert.ok(size.length() < 1.5, `size ${size.toArray()}`);
});
test("local and bot contact poses match their authoritative impact boundaries and recover continuously", () => {
  const local = sampleVanguardSword({
    weaponState: "slashing",
    weaponTimer: 0.11,
  });
  const bot = sampleVanguardSword({
    weaponState: "swing_down",
    weaponTimer: 0.11,
  });
  assert.ok(local.offset.distanceTo(bot.offset) < 1e-9);
  assert.ok(local.rotation.angleTo(bot.rotation) < 1e-6);
  for (const localRecovery of [false, true]) {
    const end = sampleVanguardSword({
      weaponState: localRecovery ? "slashing" : "swing_down",
      weaponTimer: localRecovery ? 0.22 : 0.11,
    });
    const start = sampleVanguardSword({
      weaponState: "recovering",
      weaponTimer: 0,
      localRecovery,
    });
    assert.ok(end.offset.distanceTo(start.offset) < 1e-9);
    const ready = sampleVanguardSword({
      weaponState: "recovering",
      weaponTimer: 0.6,
      localRecovery,
    });
    assert.ok(ready.offset.length() < 1e-9);
    assert.ok(ready.rotation.angleTo(new THREE.Quaternion()) < 1e-6);
  }
  const faster = sampleVanguardSword({
    weaponState: "slashing",
    weaponTimer: 0.05,
    settings: { swordSlashSpeed: 0.1 },
  });
  assert.ok(local.offset.distanceTo(faster.offset) < 1e-9);
});
test("sword is locked to the hand through directions, aim, jump, slide, attack and lunge without bone stretching", () => {
  const root = createIronVanguardModel(200, false, body),
    sword = createVanguardSword(prop);
  attachVanguardSword(root, sword);
  const pairs = [
    ["RightArm", "RightForeArm"],
    ["RightForeArm", "RightHand"],
    ["LeftArm", "LeftForeArm"],
    ["LeftForeArm", "LeftHand"],
  ];
  const lengths = pairs.map(([a, b]) =>
    position(root, a).distanceTo(position(root, b)),
  );
  const pose = {
    activeWeapon: "sword",
    weaponState: "ready",
    weaponTimer: 0,
    dt: 0,
  };
  animateIronVanguard(root, pose);
  // Canonical pose must transfer without a skeleton-basis conversion error.
  const expected = new THREE.Vector3().setFromMatrixPosition(
    new THREE.Matrix4().fromArray(VANGUARD_SWORD_IDLE.gripMatrix),
  );
  const hand = position(root, "RightHand");
  assert.ok(
    hand.distanceTo(expected) < 0.08,
    `canonical grip mismatch ${hand.toArray()} vs ${expected.toArray()}`,
  );
  for (let frame = 0; frame < 240; frame++) {
    const yaw = Math.sin(frame / 30) * Math.PI;
    root.rotation.y = yaw;
    animateIronVanguard(root, {
      ...pose,
      dt: 1 / 60,
      yaw,
      lookPitch: Math.sin(frame / 20) * 0.8,
      vel: new THREE.Vector3(
        Math.sin(frame / 20) * 5,
        frame > 60 && frame < 100 ? 3 : 0,
        Math.cos(frame / 20) * 5,
      ),
      isSliding: frame > 120 && frame < 160,
      isJumping: frame > 60 && frame < 100,
      isSprinting: frame > 180,
      isLunging: frame > 200 && frame < 215,
      weaponState:
        frame % 60 < 15 ? "slashing" : frame % 60 < 50 ? "recovering" : "ready",
      weaponTimer: (frame % 15) / 60,
    });
    root.updateWorldMatrix(true, true);
    const socket = root.userData.ironVanguardSwordGrip as THREE.Group;
    assert.ok(
      socket
        .getWorldPosition(new THREE.Vector3())
        .distanceTo(position(root, "RightHand")) < 1e-6,
    );
    const angle = socket
      .getWorldQuaternion(new THREE.Quaternion())
      .normalize()
      .angleTo(
        root
          .getObjectByName("RightHand")!
          .getWorldQuaternion(new THREE.Quaternion())
          .normalize(),
      );
    assert.ok(angle < 1e-5, `grip orientation ${frame}: ${angle}`);
    assert.ok(matrixError(sword.matrixWorld, socket.matrixWorld) < 1e-6);
    pairs.forEach(([a, b], i) =>
      assert.ok(
        Math.abs(position(root, a).distanceTo(position(root, b)) - lengths[i]) <
          1e-5,
      ),
    );
  }
  disposeIronVanguard(root);
});
test("weapon switching restores the authored hammer pose and shoulder morphs without accumulated sword offsets", () => {
  const root = createIronVanguardModel(200, false, body);
  const sample = {
    weaponState: "ready",
    weaponTimer: 0,
    dt: 0,
    previewClip: "idle",
    previewTime: 0,
  };
  animateIronVanguard(root, sample);
  const ref = root.getObjectByName("RightHand")!.matrixWorld.clone();
  const morphs = (
    root.getObjectByName("IV_TransferBody_ShoulderFix") as THREE.SkinnedMesh
  ).morphTargetInfluences!.slice();
  for (let i = 0; i < 50; i++)
    animateIronVanguard(root, {
      ...sample,
      activeWeapon: "sword",
      isLunging: true,
      dt: 1 / 60,
    });
  animateIronVanguard(root, sample);
  assert.ok(
    matrixError(ref, root.getObjectByName("RightHand")!.matrixWorld) < 1e-6,
  );
  assert.deepEqual(
    (root.getObjectByName("IV_TransferBody_ShoulderFix") as THREE.SkinnedMesh)
      .morphTargetInfluences,
    morphs,
  );
  disposeIronVanguard(root);
});
test("player sword retains one impact at half slash and configured recovery, visibility and lunge", () => {
  const sword = createVanguardSwordView(200, body, prop),
    hammer = new THREE.Group();
  const state: any = {
    activeWeapon: "sword",
    settings: { swordSlashSpeed: 0.3, swordSlashReload: 0.8 },
    pSwordState: "slashing",
    pSwordTimer: 0,
    pSwordReady: false,
    pSwordCooldown: 0,
    swapCooldownTimer: 0,
  };
  let hits = 0;
  const tick = (dt: number) =>
    updatePlayerSwordAnimationForState({
      state,
      playerSword: sword,
      playerHammer: hammer,
      dt,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyPlayerSwordSlashImpact: () => {
        hits++;
        return false;
      },
    });
  tick(0.14);
  assert.equal(hits, 0);
  tick(0.01);
  assert.equal(hits, 1);
  tick(0.15);
  assert.equal(state.pSwordState, "recovering");
  assert.equal(state.pSwordRecoverDuration, 0.8);
  tick(0.8);
  assert.equal(state.pSwordState, "ready");
  assert.equal(hits, 1);
  state.isLunging = true;
  tick(0.01);
  assert.equal(sword.userData.ironVanguardSwordPhase, "lunge");
  assert.equal(hammer.visible, false);
  state.activeWeapon = "hammer";
  tick(0.01);
  assert.equal(sword.visible, false);
});
test("shared AI/remote/replay factories attach the actual sword and legacy mesh animation cannot move it", () => {
  const scene = new THREE.Scene();
  const loadout: any = { modelSystem: "v3", characterAsset: "iron-vanguard" };
  const rig = createCombatantMeshRig(scene, 200, true, loadout);
  assert.equal(rig.sword.userData.ironVanguardSword, true);
  assert.equal(rig.sword.parent, rig.group.userData.ironVanguardSwordGrip);
  animateCombatantWeaponMeshes({
    combatantModel: rig.group,
    hammerModel: rig.hammer,
    swordModel: rig.sword,
    activeWeapon: "sword",
    weaponState: "swing_down",
    weaponTimer: 0.1,
    isLunging: false,
    settings: {},
  } as any);
  assert.equal(rig.sword.position.length(), 0);
  assert.equal(rig.sword.visible, true);
  assert.equal(rig.hammer.visible, false);
  const rebuilt = rebuildDualWeaponCombatantModel({
    scene,
    previousGroup: rig.group,
    isEnemyBot: true,
    hue: 200,
    loadout,
    position: new THREE.Vector3(),
    activeWeapon: "sword",
  });
  assert.equal(
    rebuilt.sword.parent,
    rebuilt.group.userData.ironVanguardSwordGrip,
  );
  assert.equal(rebuilt.sword.visible, true);
  disposeIronVanguard(rebuilt.group);
});

test("Version 3 local view receives the imported sword and starts hidden until equipped", () => {
  const refs: any = {};
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 200 },
    playerLoadout: {
      characterAsset: "iron-vanguard",
      modelSystem: "v3",
    } as any,
  });
  assert.equal(refs.playerSword.userData.ironVanguardSword, true);
  assert.equal(refs.playerSword.userData.ironVanguardSwordView, true);
  assert.equal(refs.playerSword.visible, false);
  assert.equal(refs.playerSword.userData.ironVanguardSwordPhase, "guard");
  assert.equal(refs.playerHammer.userData.characterAsset, "iron-vanguard");
});

test("first-person arms own compact geometry without changing or disposing the cached body", () => {
  const original = body.scene.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  const count = original.geometry.index!.count;
  let sourceDisposals = 0;
  original.geometry.addEventListener("dispose", () => sourceDisposals++);
  const view = createVanguardSwordView(200, body, prop);
  const arms = view.getObjectByName(original.name) as THREE.SkinnedMesh;
  assert.notEqual(arms.geometry, original.geometry);
  assert.ok(arms.geometry.index!.count > 1000);
  assert.ok(arms.geometry.index!.count < count / 2);
  assert.equal(Object.keys(arms.geometry.morphAttributes).length, 0);
  const joints = arms.geometry.getAttribute("skinIndex");
  const weights = arms.geometry.getAttribute("skinWeight");
  for (let vertex = 0; vertex < joints.count; vertex++) {
    let armWeight = 0;
    for (let component = 0; component < 4; component++) {
      const name =
        arms.skeleton.bones[joints.getComponent(vertex, component)].name;
      if (
        /^(Right|Left)(Arm|ForeArm|Hand)$|^DEF_(Thumb|Index|Middle|Ring|Pinky)_/.test(
          name,
        )
      )
        armWeight += weights.getComponent(vertex, component);
    }
    assert.ok(armWeight > 0.5, `non-arm vertex ${vertex}`);
  }
  let armDisposals = 0;
  arms.geometry.addEventListener("dispose", () => armDisposals++);
  disposeIronVanguard(view);
  disposeIronVanguard(view);
  assert.equal(armDisposals, 1);
  assert.equal(sourceDisposals, 0);
  assert.equal(original.geometry.index!.count, count);
});

test("first-person sword grip stays attached and clear of the camera across slash and recovery", () => {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.01, 100);
  const view = createVanguardSwordView(200, body, prop);
  camera.add(view);
  const sword = view.userData.swordProp as THREE.Group;
  let mesh: THREE.Mesh;
  sword.traverse((o) => {
    if (o instanceof THREE.Mesh) mesh = o;
  });
  const vertex = new THREE.Vector3();
  for (let frame = 0; frame <= 82; frame++) {
    const time = frame / 100;
    camera.position.set(frame, 1.6 + Math.sin(time), -frame);
    camera.rotation.set(Math.sin(time) * 0.9, time * 6, 0, "YXZ");
    animateVanguardSwordView(view, {
      weaponState: time < 0.22 ? "slashing" : "recovering",
      weaponTimer: time < 0.22 ? time : time - 0.22,
      previewTime: 0,
    });
    camera.updateWorldMatrix(true, true);
    const hand = view.getObjectByName("RightHand")!;
    assert.ok(
      matrixError(
        sword.matrixWorld,
        (view.userData.ironVanguardSwordGrip as THREE.Group).matrixWorld,
      ) < 1e-6,
    );
    assert.ok(
      sword
        .getWorldPosition(vertex)
        .distanceTo(hand.getWorldPosition(new THREE.Vector3())) < 1e-6,
    );
    // Sample every prop vertex: a conservative rotated AABB alone can overstate clipping.
    const transform = camera.matrixWorld
      .clone()
      .invert()
      .multiply(mesh!.matrixWorld);
    const positions = mesh!.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(transform);
      assert.ok(
        vertex.z < -0.03,
        `camera intersection at ${time}: ${vertex.z}`,
      );
    }
  }
  camera.remove(view);
});

test("sword skeleton joins both recovery clocks continuously and does not accumulate procedural rotations", () => {
  for (const local of [false, true]) {
    const model = createIronVanguardModel(200, false, body);
    const update = (weaponState: string, weaponTimer: number) =>
      animateIronVanguard(model, {
        activeWeapon: "sword",
        dt: 0,
        previewClip: "idle",
        previewTime: 0,
        weaponState,
        weaponTimer,
      });
    update(local ? "slashing" : "swing_down", local ? 0.22 : 0.11);
    const bones = [
      "Spine",
      "RightShoulder",
      "RightArm",
      "RightForeArm",
      "RightHand",
      "LeftHand",
    ];
    const before = bones.map((name) =>
      model.getObjectByName(name)!.matrixWorld.clone(),
    );
    update("recovering", 0);
    bones.forEach((name, i) =>
      assert.ok(
        matrixError(before[i], model.getObjectByName(name)!.matrixWorld) < 1e-5,
        name,
      ),
    );
    update("ready", 0);
    const rest = bones.map((name) =>
      model.getObjectByName(name)!.matrixWorld.clone(),
    );
    for (let i = 0; i < 30; i++) update("ready", 0);
    bones.forEach((name, i) =>
      assert.ok(
        matrixError(rest[i], model.getObjectByName(name)!.matrixWorld) < 1e-5,
        name,
      ),
    );
    disposeIronVanguard(model);
  }
});

test("first-person lunge releases smoothly and returns to the same guard", () => {
  const view = createVanguardSwordView(200, body, prop);
  const rest = position(view, "RightHand");
  for (let i = 0; i < 20; i++)
    animateVanguardSwordView(view, {
      weaponState: "ready",
      weaponTimer: i / 60,
      isLunging: true,
      dt: 1 / 60,
    });
  const thrust = position(view, "RightHand");
  const weight = view.userData.ironVanguard.sword.lungeWeight;
  animateVanguardSwordView(view, {
    weaponState: "ready",
    weaponTimer: 0,
    dt: 1 / 60,
  });
  assert.ok(view.userData.ironVanguard.sword.lungeWeight > 0);
  assert.ok(view.userData.ironVanguard.sword.lungeWeight < weight);
  assert.ok(position(view, "RightHand").distanceTo(thrust) < 0.12);
  for (let i = 0; i < 60; i++)
    animateVanguardSwordView(view, {
      weaponState: "ready",
      weaponTimer: 0,
      dt: 1 / 60,
    });
  assert.ok(position(view, "RightHand").distanceTo(rest) < 0.03);
  disposeIronVanguard(view);
});

test("slash sweeps across the body without stopping at either clock's contact boundary", () => {
  for (const local of [false, true]) {
    const eps = 0.00001;
    const before = sampleVanguardSword({
      weaponState: local ? "slashing" : "swing_down",
      weaponTimer: 0.11 - eps,
    });
    const at = sampleVanguardSword({
      weaponState: local ? "slashing" : "swing_down",
      weaponTimer: 0.11,
    });
    const after = sampleVanguardSword({
      weaponState: local ? "slashing" : "recovering",
      weaponTimer: local ? 0.11 + eps : eps,
      localRecovery: false,
    });
    const incoming = at.offset.clone().sub(before.offset).divideScalar(eps);
    const outgoing = after.offset.clone().sub(at.offset).divideScalar(eps);
    assert.ok(incoming.length() > 1, "cut must be travelling through contact");
    assert.ok(
      incoming.distanceTo(outgoing) < 0.01,
      "no stop or velocity discontinuity at hit",
    );
    assert.ok(
      incoming.x < 0 && outgoing.x < 0,
      "cut continues toward the left",
    );
  }
  const model = createIronVanguardModel(200, false, body);
  const pose = (state: string, time: number) => {
    animateIronVanguard(model, {
      activeWeapon: "sword",
      dt: 0,
      previewClip: "idle",
      previewTime: 0,
      weaponState: state,
      weaponTimer: time,
    });
    return position(model, "RightHand");
  };
  const wind = pose("slashing", 0.055),
    end = pose("slashing", 0.22);
  assert.ok(
    wind.x - end.x > 0.5,
    "slash must cross the body instead of poking forward",
  );
  disposeIronVanguard(model);
});

test("missed lunge draws back, extends forward, and releases from the actual interrupted pose without a slash recovery", () => {
  for (const firstPerson of [false, true]) {
    const model = firstPerson
      ? createVanguardSwordView(200, body, prop)
      : createIronVanguardModel(200, false, body);
    const update = (input: any) =>
      firstPerson
        ? animateVanguardSwordView(model, { previewTime: 0, dt: 0, ...input })
        : animateIronVanguard(model, {
            activeWeapon: "sword",
            previewClip: "idle",
            previewTime: 0,
            dt: 0,
            ...input,
          });
    update({ weaponState: "ready", weaponTimer: 0 });
    const rest = position(model, "RightHand");
    const restRotation = model
      .getObjectByName("RightHand")!
      .getWorldQuaternion(new THREE.Quaternion());
    update({
      weaponState: "ready",
      weaponTimer: 0,
      isLunging: true,
      lungeTime: 0.04,
    });
    const chamber = position(model, "RightHand");
    update({
      weaponState: "ready",
      weaponTimer: 0,
      isLunging: true,
      lungeTime: 0.18,
    });
    const thrust = position(model, "RightHand");
    assert.ok(chamber.z - thrust.z > 0.18, "thrust needs visible extension");
    assert.ok(
      Math.abs(chamber.x - thrust.x) < 0.13,
      `thrust stays on a forward lane: first=${firstPerson} ${chamber.toArray()} -> ${thrust.toArray()}`,
    );
    const blade = new THREE.Vector3(-0.286, 0.949, 0.136)
      .normalize()
      .applyQuaternion(
        model
          .getObjectByName("RightHand")!
          .getWorldQuaternion(new THREE.Quaternion()),
      );
    assert.ok(
      blade.dot(new THREE.Vector3(0, 0, -1)) > 0.97,
      `blade points into thrust ${blade.toArray()}`,
    );
    for (const interruption of [0.025, 0.07, 0.3]) {
      update({
        weaponState: "ready",
        weaponTimer: 0,
        isLunging: true,
        lungeTime: interruption,
      });
      const before = model.getObjectByName("RightHand")!.matrixWorld.clone();
      update({ weaponState: "recovering", weaponTimer: 0, dt: 0 });
      assert.ok(
        matrixError(before, model.getObjectByName("RightHand")!.matrixWorld) <
          1e-6,
        "release begins at the interrupted pose",
      );
      for (let i = 1; i <= 36; i++) {
        update({ weaponState: "recovering", weaponTimer: i / 60, dt: 1 / 60 });
        if (i >= 14)
          assert.ok(
            position(model, "RightHand").distanceTo(rest) < 1e-6,
            "stay in guard after pulling back, without entering slash follow-through",
          );
      }
    }
    update({ weaponState: "slashing", weaponTimer: 0.055 });
    assert.ok(
      position(model, "RightHand").distanceTo(rest) > 0.15 ||
        model
          .getObjectByName("RightHand")!
          .getWorldQuaternion(new THREE.Quaternion())
          .angleTo(restRotation) > 0.3,
      "next slash is not suppressed by lunge recovery",
    );
    disposeIronVanguard(model);
  }
});

test("lunge and pullback keep every sword vertex in front of the first-person camera", () => {
  const view = createVanguardSwordView(200, body, prop);
  let mesh: THREE.Mesh;
  (view.userData.swordProp as THREE.Group).traverse((o) => {
    if (o instanceof THREE.Mesh) mesh = o;
  });
  const vertex = new THREE.Vector3();
  for (let frame = 0; frame <= 60; frame++) {
    const t = frame / 100;
    animateVanguardSwordView(view, {
      weaponState: "ready",
      weaponTimer: 0,
      isLunging: t < 0.3,
      lungeTime: Math.min(t, 0.3),
      lungeReleaseTime: t < 0.3 ? undefined : t - 0.3,
      previewTime: 0,
    });
    const positions = mesh!.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i).applyMatrix4(mesh!.matrixWorld);
      assert.ok(
        vertex.z < -0.03,
        `lunge camera intersection at ${t}: ${vertex.z}`,
      );
    }
  }
  disposeIronVanguard(view);
});

test("first-person cross slash moves the grip across the view with a stable bent arm and attached blade", () => {
  const view = createVanguardSwordView(200, body, prop);
  const arms = view.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  const hand = view.getObjectByName("RightHand")!;
  const forearm = view.getObjectByName("RightForeArm")!;
  const sword = view.userData.swordProp as THREE.Group;
  const joints = arms.geometry.getAttribute("skinIndex");
  const weights = arms.geometry.getAttribute("skinWeight");
  // Use the actual rendered palm/fingers, not just the socket transform.
  const gripVertices: number[] = [];
  for (let i = 0; i < joints.count; i++) {
    let gripWeight = 0;
    for (let j = 0; j < 4; j++) {
      const name = arms.skeleton.bones[joints.getComponent(i, j)].name;
      if (
        name === "RightHand" ||
        /^DEF_(Thumb|Index|Middle|Ring|Pinky)_.*_R$/.test(name)
      )
        gripWeight += weights.getComponent(i, j);
    }
    if (gripWeight > 0.99999) gripVertices.push(i);
  }
  assert.ok(gripVertices.length > 50);
  const gripInSword = () => {
    view.updateMatrixWorld(true);
    return gripVertices.map((i) =>
      sword.worldToLocal(
        arms
          .getVertexPosition(i, new THREE.Vector3())
          .applyMatrix4(arms.matrixWorld),
      ),
    );
  };
  const restGrip = gripInSword();
  const restWrist = hand.quaternion.clone();
  const restForearm = forearm.quaternion.clone();
  const bladeAxis = new THREE.Vector3(-0.286, 0.949, 0.136).normalize();
  const bladeTip = () =>
    hand
      .getWorldPosition(new THREE.Vector3())
      .addScaledVector(
        bladeAxis
          .clone()
          .applyQuaternion(hand.getWorldQuaternion(new THREE.Quaternion())),
        0.47,
      );
  const update = (time: number, speed = 0.22) => {
    animateVanguardSwordView(view, {
      weaponState: time < speed ? "slashing" : "recovering",
      weaponTimer: time < speed ? time : time - speed,
      settings: { swordSlashSpeed: speed },
      previewTime: 0,
    });
  };
  let previous: THREE.Quaternion | undefined;
  for (let frame = 0; frame <= 246; frame++) {
    update(frame / 300);
    const upper = position(view, "RightForeArm").sub(
      position(view, "RightArm"),
    );
    const lower = position(view, "RightHand").sub(
      position(view, "RightForeArm"),
    );
    assert.ok(
      upper.clone().normalize().dot(lower.clone().normalize()) < 0.5,
      "elbow must stay bent instead of snapping to full IK reach",
    );
    assert.ok(
      hand.quaternion.angleTo(restWrist) < 1e-5,
      "no independent wrist roll",
    );
    assert.ok(
      forearm.quaternion.angleTo(restForearm) < 1e-5,
      "forearm follows the same arc",
    );
    const rotation = hand.getWorldQuaternion(new THREE.Quaternion());
    if (previous)
      assert.ok(previous.angleTo(rotation) < 0.2, "no orientation flips");
    previous = rotation;
    if (frame % 15 === 0)
      gripInSword().forEach((v, i) =>
        assert.ok(
          v.distanceTo(restGrip[i]) < 1e-5,
          "visible grip must not slide off the blade",
        ),
      );
  }
  update(0.055);
  const start = bladeTip();
  const gripStart = position(view, "RightHand");
  update(0.22);
  const end = bladeTip();
  const gripEnd = position(view, "RightHand");
  assert.ok(start.x - end.x > 0.5, "blade sweeps across the view");
  assert.ok(start.y - end.y > 0.25, "cut follows a descending diagonal");
  assert.ok(
    gripStart.x > 0.3 && gripEnd.x < -0.2 && gripStart.x - gripEnd.x > 0.65,
    "the grip must cross from right to left, not just tilt the blade in place",
  );
  update(0.11);
  const gripContact = position(view, "RightHand");
  assert.ok(
    Math.abs(gripContact.x) < 0.1,
    "grip passes near the center at contact",
  );
  assert.ok(
    gripContact.z < Math.min(gripStart.z, gripEnd.z) - 0.05,
    "the cross slash reaches through depth at contact",
  );
  const contact = hand.matrixWorld.clone();
  update(0.055, 0.11);
  assert.ok(
    matrixError(contact, hand.matrixWorld) < 1e-5,
    "speed preserves the contact pose",
  );
  // The local hit must occur during motion, not at a pause between two poses.
  update(0.11 - 0.00001);
  const before = bladeTip();
  update(0.11);
  const at = bladeTip();
  update(0.11 + 0.00001);
  const after = bladeTip();
  const incoming = at.clone().sub(before).divideScalar(0.00001);
  const outgoing = after.clone().sub(at).divideScalar(0.00001);
  assert.ok(incoming.x < -1 && outgoing.x < -1);
  assert.ok(
    incoming.distanceTo(outgoing) < 0.03,
    "blade velocity stays continuous at impact",
  );
  update(0.22 - 0.000001);
  const lastCut = hand.matrixWorld.clone();
  update(0.22);
  assert.ok(
    matrixError(lastCut, hand.matrixWorld) < 1e-5,
    "no pop into recovery",
  );
  update(0.52);
  assert.ok(
    position(view, "RightHand").y < Math.min(gripStart.y, gripEnd.y) - 0.12,
    "recovery pulls back below the cut instead of reversing the swipe",
  );
  disposeIronVanguard(view);
});

test("lunge holds a low split stance for the actual flight and recovers into movement without moving the gameplay root", () => {
  const root = createIronVanguardModel(200, false, body);
  const segments = [
    ["LeftUpLeg", "LeftLeg"],
    ["LeftLeg", "LeftFoot"],
    ["RightUpLeg", "RightLeg"],
    ["RightLeg", "RightFoot"],
  ];
  const lengths = segments.map(([a, b]) =>
    position(root, a).distanceTo(position(root, b)),
  );
  const restHeight = position(root, "Hips").y;
  const tick = (extra: any) =>
    animateIronVanguard(root, {
      activeWeapon: "sword",
      weaponState: "ready",
      weaponTimer: 0,
      dt: 1 / 60,
      ...extra,
    });
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 4]) {
    root.position.set(3, 0, 5);
    root.rotation.y = yaw;
    const velocity = new THREE.Vector3(0, 0, -24).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      yaw,
    );
    for (let frame = 0; frame <= 72; frame++) {
      tick({ isLunging: true, lungeTime: frame / 60, yaw, vel: velocity });
      assert.deepEqual(root.position.toArray(), [3, 0, 5]);
      segments.forEach(([a, b], i) =>
        assert.ok(
          Math.abs(
            position(root, a).distanceTo(position(root, b)) - lengths[i],
          ) < 1e-5,
          `${a} keeps its length`,
        ),
      );
      if (frame >= 15) {
        assert.ok(
          position(root, "Hips").y < restHeight - 0.2,
          "stays low even on a long glide",
        );
        const front = root.worldToLocal(position(root, "RightFoot"));
        const back = root.worldToLocal(position(root, "LeftFoot"));
        assert.ok(
          back.z - front.z > 0.6,
          "leading and trailing feet remain separated",
        );
        assert.ok(
          front.y > 0.1 && back.y > 0.1,
          "feet do not tunnel through the floor",
        );
      }
    }
    for (let frame = 0; frame < 60; frame++)
      tick({
        isLunging: false,
        lungeHit: true,
        yaw,
        vel: velocity.clone().multiplyScalar(0.25),
      });
    assert.equal(root.userData.ironVanguardLungeBlend, 0);
    assert.ok(
      position(root, "Hips").y > restHeight - 0.12,
      "standing locomotion resumes",
    );
  }
  disposeIronVanguard(root);
});

test("early and late lunge contact joins continuously into a cross slash in both views; misses never slash", () => {
  for (const firstPerson of [false, true])
    for (const hit of [false, true])
      for (const flight of [0.025, 0.12, 0.8]) {
        const root = firstPerson
          ? createVanguardSwordView(200, body, prop)
          : createIronVanguardModel(200, false, body);
        const tick = (extra: any) =>
          firstPerson
            ? animateVanguardSwordView(root, {
                weaponState: "ready",
                weaponTimer: 0,
                previewTime: 0,
                dt: 0,
                ...extra,
              })
            : animateIronVanguard(root, {
                activeWeapon: "sword",
                weaponState: "ready",
                weaponTimer: 0,
                previewClip: "idle",
                previewTime: 0,
                dt: 0,
                ...extra,
              });
        tick({ isLunging: true, lungeTime: flight });
        const before = root.getObjectByName("RightHand")!.matrixWorld.clone();
        tick({ isLunging: false, lungeHit: hit });
        assert.ok(
          matrixError(before, root.getObjectByName("RightHand")!.matrixWorld) <
            1e-5,
          "contact starts at the actual interrupted pose",
        );
        const handPositions: number[] = [];
        for (let frame = 1; frame <= 60; frame++) {
          tick({ isLunging: false, lungeHit: hit, dt: 1 / 60 });
          handPositions.push(position(root, "RightHand").x);
          if (frame < 8)
            assert.equal(
              root.userData.ironVanguardSwordPhase,
              hit ? "lunge-slash" : "lunge-recovery",
            );
        }
        if (hit)
          assert.ok(
            Math.max(...handPositions.slice(0, 10)) -
              Math.min(...handPositions.slice(0, 10)) >
              0.3,
            "contact visibly cuts across the body/view",
          );
        assert.equal(root.userData.ironVanguardSwordPhase, "guard");
        tick({ isLunging: true, lungeTime: 0 });
        assert.equal(
          root.userData.ironVanguard.sword.lungeContact,
          false,
          "next flight clears the previous outcome",
        );
        disposeIronVanguard(root);
      }
});

test("contact slash keeps every blade vertex ahead of the camera, including an interrupted draw-back", () => {
  const view = createVanguardSwordView(200, body, prop);
  let mesh: THREE.Mesh;
  (view.userData.swordProp as THREE.Group).traverse((o) => {
    if (o instanceof THREE.Mesh) mesh = o;
  });
  const vertex = new THREE.Vector3();
  for (const flight of [0.025, 0.5]) {
    animateVanguardSwordView(view, {
      weaponState: "ready",
      weaponTimer: 0,
      isLunging: true,
      lungeTime: flight,
      previewTime: 0,
    });
    for (let frame = 0; frame <= 90; frame++) {
      animateVanguardSwordView(view, {
        weaponState: "recovering",
        weaponTimer: frame / 120,
        lungeHit: true,
        dt: frame === 0 ? 0 : 1 / 120,
        previewTime: 0,
      });
      const vertices = mesh!.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++) {
        vertex.fromBufferAttribute(vertices, i).applyMatrix4(mesh!.matrixWorld);
        assert.ok(
          vertex.z < -0.03,
          `camera intersection: flight=${flight} release=${frame / 120} z=${vertex.z}`,
        );
      }
    }
  }
  disposeIronVanguard(view);
});

test("gameplay lunge completion drives the cosmetic slash without another damage event or a cooldown change", () => {
  for (const hit of [false, true]) {
    const sword = createVanguardSwordView(200, body, prop);
    const state: any = {
      activeWeapon: "sword",
      settings: { swordLungeReload: 1.2 },
      isLunging: true,
      lungeTimer: 0.3,
      pSwordState: "ready",
      pSwordTimer: 0,
      swapCooldownTimer: 0,
    };
    let extraHits = 0;
    const tick = (dt: number) =>
      updatePlayerSwordAnimationForState({
        state,
        playerSword: sword,
        playerHammer: null,
        dt,
        idleXBob: 0,
        idleYBob: 0,
        idleZRotBob: 0,
        applyPlayerSwordSlashImpact: () => {
          extraHits++;
          return false;
        },
      });
    tick(1 / 60);
    finishPlayerSwordLungeRecoveryForState({
      state,
      hit,
      recordLungeEnd: (recorded) => assert.equal(recorded, hit),
    });
    tick(1 / 60);
    assert.equal(
      sword.userData.ironVanguardSwordPhase,
      hit ? "lunge-slash" : "lunge-recovery",
    );
    assert.equal(state.pSwordState, "recovering");
    assert.equal(state.pSwordRecoverDuration, 1.2);
    tick(1);
    assert.equal(state.pSwordReady, false);
    tick(0.2);
    assert.equal(state.pSwordState, "ready");
    assert.equal(extraHits, 0);
    disposeIronVanguard(sword);

    const self: any = { isLunging: true, vel: new THREE.Vector3(0, 0, -24) };
    const frame: any = {
      pos: new THREE.Vector3(),
      vel: self.vel.clone(),
      aiState: "LUNGING",
      timer: 0,
      weaponState: "ready",
    };
    finishAISwordLungeWithVitals({
      state,
      self,
      frame,
      botId: "bot",
      outcome: hit ? "hit" : "miss_timeout",
      targetVitals: { hp: 0, invulnerabilityTimer: 0 },
      recordCombatantObservation: () => {},
      recordBotDamageTag: () => {},
      tryEnterPressureState: () => false,
      tryStartComboOnHit: () => {},
    });
    assert.equal(self.isLunging, false);
    assert.equal(self.swordLungeHit, hit);
    assert.equal(
      self.weaponState,
      "ready",
      "cosmetic slash does not start a bot weapon attack",
    );
    assert.equal(frame.timer, 1.2);
  }
});
