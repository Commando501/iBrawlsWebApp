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
import type { VanguardMovementState } from "./ironVanguardMovement";

const bytes = readFileSync("public/assets/iron-vanguard/hammer-v018.glb");
const source = await new GLTFLoader()
  .setMeshoptDecoder(MeshoptDecoder)
  .parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
const position = (root: THREE.Group, name: string) =>
  root.getObjectByName(name)!.getWorldPosition(new THREE.Vector3());
const state = (root: THREE.Group) =>
  root.userData.ironVanguard.movement as VanguardMovementState;
const grip = (root: THREE.Group, hand: string) => {
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
  activeWeapon: "hammer",
  weaponState: "ready",
  weaponTimer: 0,
  isJumping: false,
};
const segments = [
  ["LeftUpLeg", "LeftLeg"],
  ["LeftLeg", "LeftFoot"],
  ["RightUpLeg", "RightLeg"],
  ["RightLeg", "RightFoot"],
];
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
const swing = (t: number) => ({
  weaponState: t < 0.3 ? "swing_up" : t < 0.5 ? "swing_down" : "recovering",
  weaponTimer: t < 0.3 ? t : t < 0.5 ? t - 0.3 : t - 0.5,
  settings: {
    hammerSlamWindupTime: 0.3,
    hammerSlamAttackTime: 0.2,
    hammerReloadTime: 1.1,
  },
});

test("airborne travel, free look, and attacks preserve the rig and simulation across eight directions and five speeds", () => {
  const native = createIronVanguardModel(200, false, source);
  for (const speed of [0, 2, 4, 7, 8])
    for (const [x, z] of directions)
      for (const attacking of [false, true]) {
        const root = createIronVanguardModel(200, false, source);
        const lengths = segments.map(([a, b]) =>
          position(root, a).distanceTo(position(root, b)),
        );
        const floor = ["LeftFoot", "RightFoot"].map((n) => position(root, n).y);
        const horizontal = new THREE.Vector3(x, 0, z)
          .normalize()
          .multiplyScalar(speed);
        const seen = new Set<string>();
        for (let i = 0; i < 140; i++) {
          const t = i / 60,
            flight = t - 0.3,
            airborne = flight >= 0 && flight < 1;
          const vel = horizontal.clone().setY(airborne ? 8 - 16 * flight : 0);
          root.position.addScaledVector(horizontal, 1 / 60);
          root.position.y = airborne ? 8 * flight - 8 * flight * flight : 0;
          const yaw = Math.PI * Math.sin(t * 2),
            pitch = 0.7 * Math.sin(t * 3);
          root.rotation.y = yaw;
          const before = root.position.clone(),
            rotation = root.quaternion.clone();
          const attack = attacking ? swing(t % 1.6) : {};
          animateIronVanguard(native, { ...ready, ...attack });
          animateIronVanguard(root, {
            ...ready,
            ...attack,
            vel,
            yaw,
            lookPitch: pitch,
            isJumping: airborne,
            isSprinting: speed >= 7,
            isCrouching: speed === 2,
          });
          seen.add(root.userData.ironVanguardMovement);
          assert.ok(
            root.position.distanceTo(before) < 1e-10 &&
              root.quaternion.equals(rotation),
            "animation changed the simulation root",
          );
          for (const [j, [a, b]] of segments.entries())
            assert.ok(
              Math.abs(
                position(root, a).distanceTo(position(root, b)) - lengths[j],
              ) < 1e-4,
              `stretched ${a}: ${speed}/${x}/${z}/${i}`,
            );
          for (const hand of ["LeftHand", "RightHand"])
            assert.ok(
              error(grip(root, hand), grip(native, hand)) < 1e-4,
              `grip ${hand}: ${speed}/${x}/${z}/${i}`,
            );
          for (const [j, foot] of ["LeftFoot", "RightFoot"].entries()) {
            const p = position(root, foot);
            assert.ok(p.toArray().every(Number.isFinite));
            assert.ok(
              p.y >= floor[j] - 0.002,
              `floor ${foot}: ${speed}/${x}/${z}/${i}: ${p.y}`,
            );
          }
          if (i === 48)
            assert.equal(state(root).airborne, true, "apex must stay airborne");
          const body = root.getObjectByName(
            "IV_TransferBody_ShoulderFix",
          ) as THREE.SkinnedMesh;
          const nativeBody = native.getObjectByName(
            "IV_TransferBody_ShoulderFix",
          ) as THREE.SkinnedMesh;
          assert.deepEqual(
            body.morphTargetInfluences,
            nativeBody.morphTargetInfluences,
            "movement must not retime shoulder corrections",
          );
        }
        for (const phase of ["jump", "fall", "land"])
          assert.ok(seen.has(phase), `missing ${phase}`);
        assert.match(
          root.userData.ironVanguardMovement,
          speed === 0
            ? /^idle$/
            : speed === 2
              ? /^crouch-walk-/
              : speed >= 7
                ? /^run-/
                : /^walk-/,
        );
        disposeIronVanguard(root);
      }
  disposeIronVanguard(native);
});

test("jump legs respond to travel speed and direction without crossing the body centre", () => {
  const poses: Record<string, THREE.Vector3[]> = {};
  for (const [name, x, z, speed] of [
    ["still", 0, 0, 0],
    ["slow", 0, -1, 2],
    ["forward", 0, -1, 7],
    ["back", 0, 1, 7],
    ["right", 1, 0, 7],
    ["left", -1, 0, 7],
  ] as const) {
    const root = createIronVanguardModel(200, false, source);
    for (let i = 0; i < 24; i++)
      animateIronVanguard(root, {
        ...ready,
        isJumping: true,
        vel: new THREE.Vector3(x * speed, 4, z * speed),
      });
    poses[name] = ["LeftFoot", "RightFoot"].map((n) => position(root, n));
    assert.ok(
      poses[name][0].x < -0.1 && poses[name][1].x > 0.1,
      `${name} crossed legs`,
    );
    disposeIronVanguard(root);
  }
  const separation = (name: string) => poses[name][0].z - poses[name][1].z;
  assert.ok(
    separation("forward") < separation("back") - 0.5,
    "forward and backward jumps need opposite leg reach",
  );
  assert.ok(
    Math.abs(separation("forward")) > Math.abs(separation("slow")) + 0.15,
    "speed should strengthen the traveling pose",
  );
  assert.ok(
    poses.right[1].x > poses.still[1].x + 0.15 &&
      poses.left[0].x < poses.still[0].x - 0.15,
    "strafe jumps must reach toward travel",
  );
});

test("moving landings step during impact and release their world contact before overextension", () => {
  for (const speed of [2, 4, 8])
    for (const [x, z] of directions) {
      const root = createIronVanguardModel(200, false, source);
      const vel = new THREE.Vector3(x, 0, z).normalize().multiplyScalar(speed);
      const tick = (airborne: boolean) => {
        root.position.addScaledVector(vel, 1 / 60);
        animateIronVanguard(root, {
          ...ready,
          vel: vel.clone().setY(airborne ? -6 : 0),
          isJumping: airborne,
          isCrouching: speed === 2,
        });
      };
      for (let i = 0; i < 30; i++) tick(true);
      let firstStep: THREE.Vector3 | undefined,
        lastContact: THREE.Vector3 | undefined,
        planted = 0,
        steps = 0;
      for (let i = 0; i < 30; i++) {
        tick(false);
        const side = state(root).air.lead;
        const foot = position(root, side + "Foot");
        if (root.userData.ironVanguardSupportPlanted) {
          planted++;
          if (lastContact)
            assert.ok(
              foot.distanceTo(lastContact) < 1e-4,
              `landing slip ${speed}/${x}/${z}`,
            );
          lastContact = foot;
        }
        const other = root.worldToLocal(
          position(root, (side === "Left" ? "Right" : "Left") + "Foot"),
        );
        if (i === 5) {
          assert.equal(root.userData.ironVanguardMovement, "land");
          assert.ok(
            root.userData.ironVanguardLandingBlend > 0.99,
            "gait should be active by 0.1 seconds",
          );
          firstStep = other.clone();
        }
        if (i === 12 && other.distanceTo(firstStep!) > 0.04) steps++;
      }
      assert.ok(
        planted >= 1 && planted <= 6,
        `landing contact must be brief: ${planted} at ${speed}/${x}/${z}`,
      );
      assert.equal(
        steps,
        1,
        "leg should step before impact absorption finishes",
      );
      assert.equal(state(root).support, undefined);
      assert.match(
        root.userData.ironVanguardMovement,
        /^(run|walk|crouch-walk)-/,
      );
      disposeIronVanguard(root);
    }
});

test("stationary landing retains impact absorption while moving recovery can stop, reverse, or be interrupted", () => {
  for (const change of [
    "stationary",
    "stop",
    "reverse",
    "jump",
    "slide",
    "teleport",
    "dead",
  ]) {
    const root = createIronVanguardModel(200, false, source);
    const vel = new THREE.Vector3(0, 0, change === "stationary" ? 0 : -4);
    for (let i = 0; i < 30; i++)
      animateIronVanguard(root, {
        ...ready,
        isJumping: true,
        vel: vel.clone().setY(-6),
      });
    let firstHip = 0,
      lowHip = Infinity;
    for (let i = 0; i < 60; i++) {
      if (i === 2) {
        if (change === "stop") vel.setScalar(0);
        if (change === "reverse") vel.negate();
        if (change === "teleport") root.position.x += 20;
      }
      root.position.addScaledVector(vel, 1 / 60);
      animateIronVanguard(root, {
        ...ready,
        vel,
        isJumping: change === "jump" && i >= 2,
        isSliding: change === "slide" && i >= 2,
        hp: change === "dead" && i >= 2 ? 0 : 100,
      });
      if (i === 0) firstHip = position(root, "Hips").y;
      lowHip = Math.min(lowHip, position(root, "Hips").y);
      if (change === "stationary")
        assert.equal(root.userData.ironVanguardLandingBlend, 0);
      if (i === 2 && ["jump", "slide", "teleport", "dead"].includes(change))
        assert.equal(
          state(root).support,
          undefined,
          `${change} retained landing support`,
        );
    }
    if (change === "stationary")
      assert.ok(
        lowHip < firstHip - 0.07,
        "stationary landing must visibly absorb impact",
      );
    if (["stop", "stationary", "dead"].includes(change))
      assert.equal(root.userData.ironVanguardMovement, "idle");
    if (change === "reverse")
      assert.equal(root.userData.ironVanguardMovement, "walk-backward");
    if (change === "jump")
      assert.equal(root.userData.ironVanguardMovement, "fall");
    if (change === "slide")
      assert.equal(root.userData.ironVanguardMovement, "slide");
    assert.equal(state(root).support, undefined);
    disposeIronVanguard(root);
  }
});
