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
import { IRON_VANGUARD_MOVEMENT } from "./ironVanguardMovement.generated";
import {
  createVanguardMovementState,
  selectVanguardMovement,
} from "./ironVanguardMovement";
const bytes = readFileSync("public/assets/iron-vanguard/hammer-v018.glb");
const source = await new GLTFLoader()
  .setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
const position = (root: THREE.Group, name: string) =>
  root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
const relativeGrip = (root: THREE.Group, hand: string) => {
  root.updateMatrixWorld(true);
  return root
    .getObjectByName("weapon_hammer")!
    .matrixWorld.clone()
    .invert()
    .multiply(root.getObjectByName(hand)!.matrixWorld);
};
const error = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));
test("movement selection follows facing, sprint, crouch, slide, and airborne state", () => {
  const state = createVanguardMovementState();
  const select = (extra: Record<string, unknown>) =>
    selectVanguardMovement(
      { dt: 0.016, weaponState: "ready", ...extra },
      state,
    );
  assert.equal(select({ vel: new THREE.Vector3(0, 0, -4) }), "walk-forward");
  assert.equal(select({ vel: new THREE.Vector3(4, 0, 0) }), "walk-right");
  assert.equal(select({ vel: new THREE.Vector3(-4, 0, 0) }), "walk-left");
  assert.equal(
    select({ vel: new THREE.Vector3(-4, 0, 0), yaw: Math.PI / 2 }),
    "walk-forward",
  );
  assert.equal(select({ vel: new THREE.Vector3(0, 0, 6) }), "run-backward");
  assert.equal(select({ isCrouching: true }), "crouch");
  assert.equal(
    select({ isCrouching: true, vel: new THREE.Vector3(0, 0, -2) }),
    "crouch-walk-forward",
  );
  assert.equal(select({ isSliding: true }), "slide-enter");
  state.airborne = true;
  assert.equal(select({ vel: new THREE.Vector3(0, 2, 0) }), "jump");
  assert.equal(select({ vel: new THREE.Vector3(0, 0, 0) }), "fall");
});
test("all 20 clips keep bones connected, ankles above their baseline, and both hammer grips fixed", () => {
  assert.equal(Object.keys(IRON_VANGUARD_MOVEMENT.clips).length, 20);
  const root = createIronVanguardModel(200, false, source);
  const grips = ["LeftHand", "RightHand"].map((n) => relativeGrip(root, n));
  const feet = ["LeftFoot", "RightFoot"].map((n) => position(root, n).y);
  const segments = [
    ["LeftUpLeg", "LeftLeg"],
    ["LeftLeg", "LeftFoot"],
    ["RightUpLeg", "RightLeg"],
    ["RightLeg", "RightFoot"],
  ];
  const lengths = segments.map(([a, b]) =>
    position(root, a).distanceTo(position(root, b)),
  );
  for (const [clip, meta] of Object.entries(IRON_VANGUARD_MOVEMENT.clips)) {
    for (let frame = 0; frame <= 30; frame++) {
      animateIronVanguard(root, {
        dt: 0,
        weaponState: "ready",
        weaponTimer: 0,
        previewClip: clip,
        previewTime: (meta.duration * frame) / 30,
      });
      for (const [i, hand] of ["LeftHand", "RightHand"].entries())
        assert.ok(
          error(relativeGrip(root, hand), grips[i]) < 0.0001,
          `${clip} grip ${hand}`,
        );
      for (const [i, [a, b]] of segments.entries())
        assert.ok(
          Math.abs(
            position(root, a).distanceTo(position(root, b)) - lengths[i],
          ) < 0.0001,
          `${clip} segment ${a}`,
        );
      for (const [i, foot] of ["LeftFoot", "RightFoot"].entries())
        assert.ok(
          position(root, foot).y >= feet[i] - 0.002,
          `${clip} ${foot} below floor at ${frame}: ${position(root, foot).y}`,
        );
    }
    if (meta.loop)
      for (const track of meta.tracks) {
        const size =
          track.name === "Slide.weight"
            ? 1
            : track.name.endsWith(".quaternion")
              ? 4
              : 3;
        const first = track.values.slice(0, size),
          last = track.values.slice(-size);
        if (size === 4)
          assert.ok(
            new THREE.Quaternion()
              .fromArray(first)
              .angleTo(new THREE.Quaternion().fromArray(last)) < 0.002,
            `${clip} loop rotation`,
          );
        else if (size === 1) assert.ok(Math.abs(first[0] - last[0]) < 1e-6);
        else
          assert.ok(
            new THREE.Vector3()
              .fromArray(first)
              .distanceTo(new THREE.Vector3().fromArray(last)) < 0.001,
            `${clip} loop position`,
          );
      }
  }
  disposeIronVanguard(root);
});
test("movement offsets reset without drift and stationary native hammer poses remain exact", () => {
  const root = createIronVanguardModel(200, false, source),
    control = createIronVanguardModel(200, false, source);
  for (let i = 0; i < 600; i++)
    animateIronVanguard(root, {
      dt: 1 / 60,
      weaponState: "ready",
      weaponTimer: 0,
      vel: new THREE.Vector3(0, 0, -4),
      isCrouching: i % 120 < 60,
    });
  const input = {
    dt: 0,
    activeWeapon: "hammer",
    weaponState: "swing_down",
    weaponTimer: 0.1,
    settings: { hammerSlamAttackTime: 0.2 },
    vel: new THREE.Vector3(),
  };
  animateIronVanguard(root, input);
  animateIronVanguard(control, input);
  for (const name of ["Hips", "LeftFoot", "RightHand", "weapon_hammer"])
    assert.ok(
      error(
        root.getObjectByName(name)!.matrixWorld,
        control.getObjectByName(name)!.matrixWorld,
      ) < 1e-6,
      `${name} attack altered`,
    );
  const body = root.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  assert.ok(body.morphTargetInfluences![29] > 0.999);
  disposeIronVanguard(root);
  disposeIronVanguard(control);
});
test("crouch uses joints and jumping stays airborne at the apex, then lands", () => {
  const root = createIronVanguardModel(200, false, source);
  const initialHip = position(root, "Hips").y;
  for (let i = 0; i < 60; i++)
    animateIronVanguard(root, {
      dt: 1 / 60,
      weaponState: "ready",
      weaponTimer: 0,
      isCrouching: true,
    });
  assert.equal(root.scale.y, 1);
  assert.ok(position(root, "Hips").y < initialHip - 0.2);
  animateIronVanguard(root, {
    dt: 0.016,
    weaponState: "ready",
    weaponTimer: 0,
    isJumping: true,
    vel: new THREE.Vector3(0, 0, 0),
  });
  assert.equal(root.userData.ironVanguardMovement, "fall");
  animateIronVanguard(root, {
    dt: 0.016,
    weaponState: "ready",
    weaponTimer: 0,
    isJumping: false,
  });
  assert.equal(root.userData.ironVanguardMovement, "land");
  for (let i = 0; i < 60; i++)
    animateIronVanguard(root, {
      dt: 1 / 60,
      weaponState: "ready",
      weaponTimer: 0,
      isJumping: false,
    });
  assert.equal(root.userData.ironVanguardMovement, "idle");
  disposeIronVanguard(root);
});

test("moving attacks plant feet while preserving native grips and shoulder-correction timing", () => {
  const root = createIronVanguardModel(200, false, source),
    control = createIronVanguardModel(200, false, source);
  root.position.set(3, 2, -4);
  root.rotation.y = 0.7;
  root.updateMatrixWorld(true);
  const feet = ["LeftFoot", "RightFoot"].map((n) => position(root, n).y);
  const segments = [
    ["LeftUpLeg", "LeftLeg"],
    ["LeftLeg", "LeftFoot"],
    ["RightUpLeg", "RightLeg"],
    ["RightLeg", "RightFoot"],
  ];
  const lengths = segments.map(([a, b]) =>
    position(root, a).distanceTo(position(root, b)),
  );
  for (const clip of [
    "run-forward",
    "crouch-walk-left",
    "slide",
    "slide-enter",
    "slide-exit",
  ])
    for (let i = 0; i <= 10; i++) {
      const input = {
        dt: 0,
        activeWeapon: "hammer",
        weaponState: "swing_down",
        weaponTimer: (0.2 * i) / 10,
        settings: { hammerSlamAttackTime: 0.2 },
      };
      animateIronVanguard(control, input);
      animateIronVanguard(root, {
        ...input,
        previewClip: clip,
        previewTime: i * 0.07,
      });
      for (const [index, foot] of ["LeftFoot", "RightFoot"].entries())
        assert.ok(
          position(root, foot).y >= feet[index] - 0.002,
          `${clip} attack ${foot} below floor at ${i}`,
        );
      for (const [index, [a, b]] of segments.entries())
        assert.ok(
          Math.abs(
            position(root, a).distanceTo(position(root, b)) - lengths[index],
          ) < 0.0001,
          `${clip} attack stretched ${a}`,
        );
      for (const hand of ["LeftHand", "RightHand"])
        assert.ok(
          error(relativeGrip(root, hand), relativeGrip(control, hand)) < 0.0002,
          `${clip} attack grip ${hand}`,
        );
      assert.deepEqual(
        (
          root.getObjectByName(
            "IV_TransferBody_ShoulderFix",
          ) as THREE.SkinnedMesh
        ).morphTargetInfluences,
        (
          control.getObjectByName(
            "IV_TransferBody_ShoulderFix",
          ) as THREE.SkinnedMesh
        ).morphTargetInfluences,
      );
    }
  disposeIronVanguard(root);
  disposeIronVanguard(control);
});
test("combat slide leads with one leg, tucks the other, and blends without losing ground or grip contact", () => {
  const root = createIronVanguardModel(200, false, source);
  const hands = ["LeftHand", "RightHand"];
  const grips = hands.map((n) => relativeGrip(root, n));
  const baseline = ["LeftFoot", "RightFoot"].map((n) => position(root, n).y);
  const animate = (sliding: boolean) =>
    animateIronVanguard(root, {
      dt: 1 / 60,
      activeWeapon: "hammer",
      weaponState: "ready",
      weaponTimer: 0,
      isSliding: sliding,
      vel: new THREE.Vector3(0, 0, -6),
    });
  for (let i = 0; i < 60; i++) animate(false);
  for (let i = 0; i < 190; i++) {
    animate(i < 120);
    for (const [index, hand] of hands.entries())
      assert.ok(
        error(relativeGrip(root, hand), grips[index]) < 0.0002,
        `slide transition grip ${hand} at ${i}`,
      );
    for (const [index, foot] of ["LeftFoot", "RightFoot"].entries())
      assert.ok(
        position(root, foot).y >= baseline[index] - 0.002,
        `slide transition foot ${foot} at ${i}`,
      );
    if (i === 90) {
      assert.ok(
        position(root, "Hips").y < 0.45,
        "pelvis should settle into a low slide",
      );
      assert.ok(
        position(root, "RightFoot").z - position(root, "LeftFoot").z > 0.65,
        "boots should not form a symmetrical crouch",
      );
      const body = root.getObjectByName(
        "IV_TransferBody_ShoulderFix",
      ) as THREE.SkinnedMesh;
      body.skeleton.update();
      const vertex = new THREE.Vector3();
      let minimum = Infinity;
      for (let v = 0; v < body.geometry.attributes.position.count; v++) {
        body.getVertexPosition(v, vertex).applyMatrix4(body.matrixWorld);
        minimum = Math.min(minimum, vertex.y);
      }
      assert.ok(minimum >= -0.002, `slide mesh below floor: ${minimum}`);
    }
  }
  assert.equal(root.userData.ironVanguardMovement, "run-forward");
  assert.ok(position(root, "Hips").y > 0.85, "exit returns to running height");
  disposeIronVanguard(root);
});

test("slide phases play in order, release from partial depth, retrigger, and yield to jumping", () => {
  const root = createIronVanguardModel(200, false, source);
  const tick = (isSliding: boolean, extra = {}) =>
    animateIronVanguard(root, {
      dt: 1 / 60,
      activeWeapon: "hammer",
      weaponState: "ready",
      weaponTimer: 0,
      isSliding,
      isJumping: false,
      ...extra,
    });
  const clip = () => root.userData.ironVanguardMovement;
  tick(true);
  assert.equal(clip(), "slide-enter");
  for (let i = 0; i < 10; i++) tick(true);
  assert.equal(clip(), "slide-enter");
  const depth = position(root, "Hips").y;
  tick(false);
  assert.equal(clip(), "slide-exit");
  assert.ok(
    Math.abs(position(root, "Hips").y - depth) < 0.06,
    "short slide release should not drop to the full slide",
  );
  tick(true);
  assert.equal(clip(), "slide-enter");
  assert.ok(
    Math.abs(position(root, "Hips").y - depth) < 0.06,
    "retrigger should not reset to standing",
  );
  for (let i = 0; i < 60; i++) tick(true);
  assert.equal(clip(), "slide");
  for (let i = 0; i < 30; i++) tick(false);
  assert.equal(
    clip(),
    "slide-exit",
    "stand-up must finish before gait resumes",
  );
  for (let i = 0; i < 30; i++) tick(false);
  assert.equal(clip(), "idle");
  tick(true);
  tick(true, { isJumping: true, vel: new THREE.Vector3(0, 2, 0) });
  assert.equal(clip(), "jump");
  disposeIronVanguard(root);
});

test("slide pelvis and knee directions remain stable through the entire native attack", () => {
  const root = createIronVanguardModel(200, false, source);
  const control = createIronVanguardModel(200, false, source);
  root.position.set(3, 2, -4);
  root.rotation.y = 0.7;
  animateIronVanguard(root, {
    dt: 0,
    activeWeapon: "hammer",
    weaponState: "ready",
    weaponTimer: 0,
    previewClip: "slide",
    previewTime: 0,
  });
  const names = [
    "Hips",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
  ];
  const anchors = names.map((name) =>
    root.getObjectByName(name)!.matrixWorld.clone(),
  );
  for (let i = 0; i <= 96; i++) {
    const t = (1.6 * i) / 96;
    const input = {
      dt: 0,
      activeWeapon: "hammer",
      weaponState: t < 0.3 ? "swing_up" : t < 0.5 ? "swing_down" : "recovering",
      weaponTimer: t < 0.3 ? t : t < 0.5 ? t - 0.3 : t - 0.5,
      settings: {
        hammerSlamWindupTime: 0.3,
        hammerSlamAttackTime: 0.2,
        hammerReloadTime: 1.1,
      },
    };
    animateIronVanguard(control, input);
    animateIronVanguard(root, {
      ...input,
      previewClip: "slide",
      previewTime: t,
    });
    names.forEach((name, index) =>
      assert.ok(
        error(root.getObjectByName(name)!.matrixWorld, anchors[index]) < 1e-5,
        `${name} moved during attack at ${t}: ${error(root.getObjectByName(name)!.matrixWorld, anchors[index])}`,
      ),
    );
    for (const hand of ["LeftHand", "RightHand"])
      assert.ok(
        error(relativeGrip(root, hand), relativeGrip(control, hand)) < 0.0002,
        `${hand} lost grip at ${t}`,
      );
  }
  disposeIronVanguard(root);
  disposeIronVanguard(control);
});

test("slide phase endpoints join exactly and the sampled boot mesh clears the floor", () => {
  const root = createIronVanguardModel(200, false, source);
  const pose = (clip: string, time: number) => {
    animateIronVanguard(root, {
      dt: 0,
      activeWeapon: "hammer",
      weaponState: "ready",
      weaponTimer: 0,
      previewClip: clip,
      previewTime: time,
    });
    root.updateMatrixWorld(true);
    const bones: Record<string, THREE.Matrix4> = {};
    root.traverse((object) => {
      if (object instanceof THREE.Bone)
        bones[object.name] = object.matrixWorld.clone();
    });
    return bones;
  };
  for (const [a, t, b] of [
    ["slide-enter", 0, "idle"],
    ["slide-enter", 0.4, "slide"],
    ["slide-exit", 0, "slide"],
    ["slide-exit", 0.65, "idle"],
  ] as const) {
    const start = pose(a, t),
      end = pose(b, 0);
    for (const name of Object.keys(start))
      assert.ok(
        error(start[name], end[name]) < 0.0002,
        `${a} endpoint ${name}`,
      );
  }
  const body = root.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  const vertex = new THREE.Vector3();
  for (const clip of ["slide-enter", "slide", "slide-exit"])
    for (let i = 0; i <= 12; i++) {
      pose(clip, (IRON_VANGUARD_MOVEMENT.clips[clip].duration * i) / 12);
      body.skeleton.update();
      let minimum = Infinity;
      for (let v = 0; v < body.geometry.attributes.position.count; v++) {
        body.getVertexPosition(v, vertex).applyMatrix4(body.matrixWorld);
        minimum = Math.min(minimum, vertex.y);
      }
      assert.ok(
        minimum >= -0.002,
        `${clip} mesh clips floor at ${i}: ${minimum}`,
      );
    }
  disposeIronVanguard(root);
});

test("moving slide recovery plants the support boot, steps early in all eight directions, and preserves grips", () => {
  const directions = [
    [0, -1],
    [1, -1],
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
  ];
  for (const yaw of [0, 0.7])
    for (const speed of [2, 4, 8])
      for (const [x, z] of directions) {
        const root = createIronVanguardModel(200, false, source);
        const grips = ["LeftHand", "RightHand"].map((n) =>
          relativeGrip(root, n),
        );
        const baseline = ["LeftFoot", "RightFoot"].map(
          (n) => position(root, n).y,
        );
        const segments = [
          ["LeftUpLeg", "LeftLeg"],
          ["LeftLeg", "LeftFoot"],
          ["RightUpLeg", "RightLeg"],
          ["RightLeg", "RightFoot"],
        ];
        const lengths = segments.map(([a, b]) =>
          position(root, a).distanceTo(position(root, b)),
        );
        root.position.set(3, 0, -2);
        root.rotation.y = yaw;
        const vel = new THREE.Vector3(x, 0, z)
          .normalize()
          .multiplyScalar(speed)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const tick = (sliding: boolean) => {
          root.position.addScaledVector(vel, 1 / 60);
          animateIronVanguard(root, {
            dt: 1 / 60,
            activeWeapon: "hammer",
            weaponState: "ready",
            weaponTimer: 0,
            vel,
            yaw,
            isJumping: false,
            isSliding: sliding,
          });
        };
        for (let i = 0; i < 60; i++) tick(true);
        const start = root.position.clone();
        let planted = 0,
          gaitAt = Infinity,
          earlyBlend = false;
        let lastFoot = position(root, "RightFoot");
        for (let i = 1; i <= 60; i++) {
          tick(false);
          const foot = position(root, "RightFoot");
          if (root.userData.ironVanguardSupportPlanted) {
            planted++;
            assert.ok(
              foot.distanceTo(lastFoot) < 0.00001,
              `support slips: ${yaw}/${speed}/${x}/${z}`,
            );
          }
          lastFoot = foot;
          if (i < 20 && root.userData.ironVanguardRecoveryBlend > 0.15)
            earlyBlend = true;
          if (!root.userData.ironVanguardMovement.startsWith("slide"))
            gaitAt = Math.min(gaitAt, i / 60);
          for (const [j, name] of ["LeftFoot", "RightFoot"].entries())
            assert.ok(
              position(root, name).y >= baseline[j] - 0.002,
              `floor: ${yaw}/${speed}/${x}/${z} frame ${i} ${name}: ${position(root, name).y}`,
            );
          for (const [j, hand] of ["LeftHand", "RightHand"].entries())
            assert.ok(
              error(relativeGrip(root, hand), grips[j]) < 0.0001,
              `recovery grip ${hand}`,
            );
          for (const [j, [a, b]] of segments.entries())
            assert.ok(
              Math.abs(
                position(root, a).distanceTo(position(root, b)) - lengths[j],
              ) < 0.0001,
              `segment ${a}`,
            );
        }
        assert.ok(planted >= 2 && planted <= 6, `bounded push-off: ${planted}`);
        assert.ok(
          earlyBlend,
          "directional steps start before the stand-up finishes",
        );
        assert.ok(
          gaitAt <= (speed === 2 ? 0.55 : speed === 4 ? 0.41 : 0.35),
          `gait handoff ${gaitAt}`,
        );
        assert.ok(
          Math.abs(root.position.distanceTo(start) - speed) < 0.00001,
          "animation never moves the gameplay root",
        );
        disposeIronVanguard(root);
      }
});

test("recovery handles stopping, reversal, turning, and combat without retaining an invalid support point", () => {
  for (const change of [
    "stop",
    "reverse",
    "turn",
    "jump",
    "teleport",
    "retrigger",
    "dead",
  ]) {
    const root = createIronVanguardModel(200, false, source);
    const native = createIronVanguardModel(200, false, source);
    let vel = new THREE.Vector3(0, 0, -4),
      yaw = 0;
    const tick = (i: number, sliding: boolean) => {
      const attackTime = ((i + 60) / 60) % 1.6;
      const weaponState =
        attackTime < 0.3
          ? "swing_up"
          : attackTime < 0.5
            ? "swing_down"
            : "recovering";
      const weaponTimer =
        attackTime < 0.3
          ? attackTime
          : attackTime < 0.5
            ? attackTime - 0.3
            : attackTime - 0.5;
      animateIronVanguard(native, {
        dt: 0,
        activeWeapon: "hammer",
        weaponState,
        weaponTimer,
      });
      root.rotation.y = yaw;
      root.position.addScaledVector(vel, 1 / 60);
      animateIronVanguard(root, {
        dt: 1 / 60,
        activeWeapon: "hammer",
        weaponState,
        weaponTimer,
        vel,
        yaw,
        isSliding: sliding,
        isJumping: change === "jump" && i >= 3,
        hp: change === "dead" && i >= 3 ? 0 : 100,
      });
      for (const hand of ["LeftHand", "RightHand"])
        assert.ok(
          error(relativeGrip(root, hand), relativeGrip(native, hand)) < 0.0001,
          `${change} attack grip ${hand}`,
        );
      for (const name of ["LeftFoot", "RightFoot", "LeftLeg", "RightLeg"])
        assert.ok(
          position(root, name).toArray().every(Number.isFinite),
          `${change} finite leg pose`,
        );
    };
    for (let i = -60; i < 0; i++) tick(i, true);
    for (let i = 0; i < 65; i++) {
      if (i === 3) {
        if (change === "stop") vel.set(0, 0, 0);
        if (change === "reverse") vel.negate();
        if (change === "teleport") root.position.x += 20;
      }
      if (change === "turn" && i >= 3)
        yaw = Math.min(Math.PI / 2, ((i - 3) * Math.PI) / 30);
      tick(i, change === "retrigger" && i >= 3 && i < 30);
      if (["jump", "teleport", "retrigger", "dead"].includes(change) && i === 3)
        assert.equal(
          root.userData.ironVanguard.movement.support,
          undefined,
          `${change} clears old support`,
        );
    }
    if (change === "stop" || change === "dead")
      assert.equal(root.userData.ironVanguardMovement, "idle");
    if (change === "reverse")
      assert.equal(root.userData.ironVanguardMovement, "walk-backward");
    if (change === "turn")
      assert.equal(root.userData.ironVanguardMovement, "walk-right");
    if (change === "jump")
      assert.equal(root.userData.ironVanguardMovement, "fall");
    disposeIronVanguard(root);
    disposeIronVanguard(native);
  }
});
