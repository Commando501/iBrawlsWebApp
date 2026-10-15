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

const ready = {
  dt: 1 / 60,
  weaponState: "ready",
  weaponTimer: 0,
  isJumping: false,
};
const quat = (root: THREE.Group, name: string) =>
  root.getObjectByName(name)!.getWorldQuaternion(new THREE.Quaternion());
test("aim pitch preserves both hammer grips throughout native attacks and resets without drift", () => {
  const root = createIronVanguardModel(200, false, source),
    native = createIronVanguardModel(200, false, source);
  for (const pitch of [-Math.PI / 3, 0, Math.PI / 3])
    for (let i = 0; i < 97; i++) {
      const t = i / 60;
      const input = {
        ...ready,
        weaponState:
          t < 0.3 ? "swing_up" : t < 0.5 ? "swing_down" : "recovering",
        weaponTimer: t < 0.3 ? t : t < 0.5 ? t - 0.3 : t - 0.5,
        settings: {
          hammerSlamWindupTime: 0.3,
          hammerSlamAttackTime: 0.2,
          hammerReloadTime: 1.1,
        },
      };
      animateIronVanguard(root, { ...input, lookPitch: pitch });
      animateIronVanguard(native, input);
      for (const hand of ["LeftHand", "RightHand"])
        assert.ok(
          error(relativeGrip(root, hand), relativeGrip(native, hand)) < 1e-4,
        );
      for (const leg of ["LeftUpLeg", "RightUpLeg", "LeftFoot", "RightFoot"])
        assert.ok(
          error(
            root.getObjectByName(leg)!.matrixWorld,
            native.getObjectByName(leg)!.matrixWorld,
          ) < 1e-6,
        );
      assert.ok(
        Math.abs(
          quat(root, "neck")
            .normalize()
            .angleTo(quat(native, "neck").normalize()) - Math.abs(pitch),
        ) < 1e-5,
        `pitch ${pitch} time ${t} head ${quat(root, "neck").angleTo(quat(native, "neck"))}`,
      );
    }
  animateIronVanguard(root, ready);
  animateIronVanguard(native, ready);
  for (const name of ["Spine02", "Spine01", "Spine", "neck", "weapon_hammer"])
    assert.ok(
      error(
        root.getObjectByName(name)!.matrixWorld,
        native.getObjectByName(name)!.matrixWorld,
      ) < 1e-6,
    );
  disposeIronVanguard(root);
  disposeIronVanguard(native);
});

test("held slide legs retain travel heading while look wraps through 360 degrees", () => {
  for (const direction of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const root = createIronVanguardModel(200, false, source),
      reference = createIronVanguardModel(200, false, source);
    const vel = new THREE.Vector3(
      -Math.sin(direction) * 4,
      0,
      -Math.cos(direction) * 4,
    );
    const input = { ...ready, vel, isSliding: true };
    for (let i = 0; i < 90; i++) {
      animateIronVanguard(root, { ...input, yaw: 0 });
      animateIronVanguard(reference, { ...input, yaw: 0 });
    }
    let lastHead = quat(root, "neck");
    for (let i = 0; i < 241; i++) {
      const yaw = (i / 240) * Math.PI * 2;
      root.rotation.y = yaw;
      animateIronVanguard(root, {
        ...input,
        yaw,
        lookPitch: Math.sin(yaw) * 0.6,
      });
      animateIronVanguard(reference, input);
      for (const name of [
        "Hips",
        "LeftLeg",
        "RightLeg",
        "LeftFoot",
        "RightFoot",
      ])
        assert.ok(
          error(
            root.getObjectByName(name)!.matrixWorld,
            reference.getObjectByName(name)!.matrixWorld,
          ) < 1e-5,
          name,
        );
      for (const hand of ["LeftHand", "RightHand"])
        assert.ok(
          error(relativeGrip(root, hand), relativeGrip(reference, hand)) < 1e-4,
        );
      assert.ok(
        lastHead.angleTo(quat(root, "neck")) < 0.13,
        "bounded look transition through rear wrap",
      );
      lastHead = quat(root, "neck");
    }
    disposeIronVanguard(root);
    disposeIronVanguard(reference);
  }
});

test("stationary look keeps the legs still, then turns with alternating support feet", () => {
  const root = createIronVanguardModel(200, false, source);
  animateIronVanguard(root, ready);
  const initial = [position(root, "LeftFoot"), position(root, "RightFoot")];
  root.rotation.y = 0.3;
  for (let i = 0; i < 30; i++)
    animateIronVanguard(root, { ...ready, yaw: 0.3 });
  for (const [i, name] of ["LeftFoot", "RightFoot"].entries())
    assert.ok(position(root, name).distanceTo(initial[i]) < 0.001);
  let plantedFrames = 0,
    liftedFrames = 0,
    maxSlip = 0;
  let before = [position(root, "LeftFoot"), position(root, "RightFoot")];
  root.rotation.y = Math.PI / 2;
  for (let i = 0; i < 120; i++) {
    animateIronVanguard(root, { ...ready, yaw: Math.PI / 2 });
    const turn = root.userData.ironVanguard.movement.facing.turn;
    if (turn) {
      const support = turn.time / 0.48 < 0.5 ? 1 - turn.first : turn.first;
      // Skip the one frame crossing between support feet.
      const phase = turn.time / 0.48;
      if (Math.abs(phase - 0.5) > 0.04) {
        const slip = position(
          root,
          support ? "RightFoot" : "LeftFoot",
        ).distanceTo(before[support]);
        maxSlip = Math.max(maxSlip, slip);
        plantedFrames++;
      }
    }
    before = [position(root, "LeftFoot"), position(root, "RightFoot")];
    if (
      position(root, "LeftFoot").y > initial[0].y + 0.02 ||
      position(root, "RightFoot").y > initial[1].y + 0.02
    )
      liftedFrames++;
    for (const [index, name] of ["LeftFoot", "RightFoot"].entries())
      assert.ok(position(root, name).y >= initial[index].y - 0.002);
  }
  assert.ok(plantedFrames > 20);
  assert.ok(liftedFrames > 10);
  assert.ok(maxSlip < 0.002, `support slip ${maxSlip}`);
  assert.ok(
    Math.abs(root.userData.ironVanguardBodyYaw - Math.PI / 2) <= Math.PI / 5,
  );
  assert.ok(root.userData.ironVanguardBodyYaw > 0.9);
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  assert.equal(root.rotation.y, Math.PI / 2);
  disposeIronVanguard(root);
});

test("airborne, slide, translation, death and teleport discard a turn contact", () => {
  for (const interrupt of ["jump", "slide", "move", "death", "teleport"]) {
    const root = createIronVanguardModel(200, false, source);
    animateIronVanguard(root, ready);
    root.rotation.y = 1.4;
    animateIronVanguard(root, { ...ready, yaw: 1.4 });
    assert.ok(root.userData.ironVanguard.movement.facing.turn);
    if (interrupt === "teleport") root.position.x += 5;
    animateIronVanguard(root, {
      ...ready,
      yaw: 1.4,
      isJumping: interrupt === "jump",
      isSliding: interrupt === "slide",
      hp: interrupt === "death" ? 0 : 100,
      vel: new THREE.Vector3(interrupt === "move" ? 4 : 0, 0, 0),
    });
    assert.equal(
      root.userData.ironVanguard.movement.facing.turn,
      undefined,
      interrupt,
    );
    disposeIronVanguard(root);
  }
});

test("moving, crouched and stationary turn attacks retain contacts and combat timing while looking around", () => {
  for (const [speed, crouch] of [
    [0, false],
    [2, true],
    [4, false],
    [7, false],
  ] as const) {
    const root = createIronVanguardModel(200, false, source),
      native = createIronVanguardModel(200, false, source);
    for (let i = 0; i < 192; i++) {
      const t = (i / 60) % 1.6,
        yaw = Math.sin(i / 40) * 2.9;
      const vel = new THREE.Vector3(-speed / Math.SQRT2, 0, speed / Math.SQRT2);
      root.position.addScaledVector(vel, 1 / 60);
      root.rotation.y = yaw;
      const before = root.position.clone();
      const input = {
        ...ready,
        weaponState:
          t < 0.3 ? "swing_up" : t < 0.5 ? "swing_down" : "recovering",
        weaponTimer: t < 0.3 ? t : t < 0.5 ? t - 0.3 : t - 0.5,
        settings: {
          hammerSlamWindupTime: 0.3,
          hammerSlamAttackTime: 0.2,
          hammerReloadTime: 1.1,
        },
      };
      animateIronVanguard(native, input);
      animateIronVanguard(root, {
        ...input,
        vel,
        yaw,
        isCrouching: crouch,
        lookPitch: Math.sin(i / 30) * 0.8,
      });
      assert.deepEqual(root.position.toArray(), before.toArray());
      assert.equal(root.rotation.y, yaw);
      assert.equal(
        root.userData.ironVanguardSourceFrame,
        native.userData.ironVanguardSourceFrame,
      );
      for (const hand of ["LeftHand", "RightHand"])
        assert.ok(
          error(relativeGrip(root, hand), relativeGrip(native, hand)) < 1e-4,
        );
      for (const side of ["Left", "Right"])
        for (const [a, b] of [
          ["UpLeg", "Leg"],
          ["Leg", "Foot"],
        ]) {
          const length = position(root, side + a).distanceTo(
            position(root, side + b),
          );
          const expected = position(native, side + a).distanceTo(
            position(native, side + b),
          );
          assert.ok(Math.abs(length - expected) < 1e-5);
        }
    }
    disposeIronVanguard(root);
    disposeIronVanguard(native);
  }
});
