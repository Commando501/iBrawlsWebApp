import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  sampleVanguardBall,
  VANGUARD_BALL_HANDOFF_START,
  VANGUARD_BALL_HANDOFF_END,
} from "./ironVanguardBall";
import {
  createIronVanguardModel,
  animateIronVanguard,
  disposeIronVanguard,
} from "./ironVanguardModel";
import {
  createVanguardSwordView,
  animateVanguardBallView,
  animateVanguardSwordView,
} from "./ironVanguardSwordView";
import {
  prepareIronVanguardBallVisuals,
  finishIronVanguardBallVisuals,
} from "../grifball/ironVanguardBallRuntime";
import { createInitialGrifballRuntimeState } from "../grifball/runtimeState";
import { createInitialGrifballThreeRefs } from "../grifball/threeRefs";
import { DEFAULT_ADMIN_SETTINGS } from "../../settings/gameplaySettings";
import { ensureGrifballBallMeshForRefs } from "../grifball/grifballObjectiveRuntime";
import { updateV3GameplayBall } from "../grifball/v3GameplayBall";
const load = async (name: string) => {
  const b = readFileSync(`public/assets/iron-vanguard/${name}`);
  return new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), "");
};
const [body, sword] = await Promise.all([
  load("hammer-v018.glb"),
  load("sword-v001.glb"),
]);
const ready = { weaponState: "ready", weaponTimer: 0 };
const pos = (r: THREE.Group, n: string) =>
  r.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
const difference = (a: THREE.Matrix4, b: THREE.Matrix4) =>
  Math.max(...a.elements.map((v, i) => Math.abs(v - b.elements[i])));

test("overhand charge and release are continuous, including quick taps and follow-through", () => {
  for (const ballView of [false, true]) {
    const input = { ...ready, ballView };
    const carry = sampleVanguardBall(input).hand;
    for (const charge of [0, 0.05, 0.18, 0.2, 0.65, 1]) {
      const charged = sampleVanguardBall({ ...input, ballCharge: charge });
      const released = sampleVanguardBall({
        ...input,
        ballThrowTime: 0,
        ballReleaseCharge: charge,
      });
      for (const key of ["hand", "offhand", "elbow"] as const)
        assert.ok(
          charged[key].distanceTo(released[key]) < 1e-8,
          `${key} joins a partial charge`,
        );
      for (const key of [
        "torsoYaw",
        "torsoPitch",
        "wristPitch",
        "forearmRoll",
        "lift",
      ] as const)
        assert.equal(
          charged[key],
          released[key],
          `${key} joins a partial charge`,
        );
    }
    const pocket = sampleVanguardBall({ ...input, ballCharge: 1 }).hand;
    assert.ok(
      pocket.y > carry.y + (ballView ? 0.14 : 0.35),
      "throw draws into the shoulder pocket",
    );
    assert.ok(
      pocket.z > carry.z + (ballView ? 0.02 : 0.15),
      "throw draws backward before extending",
    );
    for (const t of [0.055, 0.12, 0.13, 0.26, 0.27, 0.46]) {
      const a = sampleVanguardBall({ ...input, ballThrowTime: t - 1e-6 }).hand;
      const b = sampleVanguardBall({ ...input, ballThrowTime: t }).hand;
      assert.ok(a.distanceTo(b) < 1e-4, `continuity at ${t}`);
    }
    assert.ok(
      sampleVanguardBall({ ...input, ballThrowTime: 0.13 }).hand.z <
        pocket.z - (ballView ? 0.12 : 0.4),
    );
  }
});

test("windup communicates strength through the entire charge range and holds at full power", () => {
  for (const ballView of [false, true]) {
    let previous = sampleVanguardBall({ ...ready, ballView });
    for (const charge of [0.25, 0.5, 0.75, 0.8, 0.9, 1]) {
      const pose = sampleVanguardBall({
        ...ready,
        ballView,
        ballCharge: charge,
      });
      assert.ok(
        pose.hand.distanceTo(previous.hand) > 0.005,
        "the hand must keep loading past 80% charge",
      );
      assert.ok(
        pose.torsoYaw < previous.torsoYaw,
        "shoulder coil must increase with power",
      );
      if (!ballView)
        assert.ok(
          Math.abs(pose.torsoYaw + 1.05 * charge) < 1e-8,
          "the visible shoulder turn tracks normalized gameplay charge",
        );
      previous = pose;
    }
    const held = sampleVanguardBall({ ...ready, ballView, ballCharge: 2 });
    assert.ok(held.hand.distanceTo(previous.hand) < 1e-8);
    assert.equal(
      held.torsoYaw,
      previous.torsoYaw,
      "holding beyond full charge must not loop or exaggerate power",
    );
  }
});

test("camera throw keeps moving through release and eases back into the grip", () => {
  const sample = (time: number) =>
    sampleVanguardBall({ ...ready, ballView: true, ballThrowTime: time });
  const epsilon = 1e-5;
  for (const time of [0.055, 0.12, 0.26]) {
    const before = sample(time - epsilon).hand;
    const at = sample(time).hand;
    const after = sample(time + epsilon).hand;
    const incoming = at.clone().sub(before).divideScalar(epsilon);
    const outgoing = after.clone().sub(at).divideScalar(epsilon);
    assert.ok(incoming.length() > 0.2, `hand does not stop at ${time}`);
    assert.ok(
      incoming.distanceTo(outgoing) < 0.01,
      `velocity joins at ${time}`,
    );
  }
  for (let frame = 0; frame <= 55; frame++) {
    const pose = sample(frame / 120);
    assert.ok(
      pose.fingerOpen >= 0 && pose.fingerOpen <= 1,
      "grip does not overshoot",
    );
    if (frame / 120 < VANGUARD_BALL_HANDOFF_START)
      assert.equal(pose.fingerOpen, 0);
  }
  assert.equal(sample(VANGUARD_BALL_HANDOFF_END).fingerOpen, 1);
  const beforeClose = sample(0.27 - epsilon).fingerOpen;
  const afterClose = sample(0.27 + epsilon).fingerOpen;
  assert.ok(
    Math.abs(beforeClose - afterClose) < 1e-4,
    "fingers close without a pose jump",
  );
  assert.equal(sample(0.46).fingerOpen, 0);
});

test("camera throw bends before extending and keeps tap/partial-charge wrists stable", () => {
  const root = createVanguardSwordView(200, body, sword);
  const sample = (input: {
    ballCharge?: number;
    ballThrowTime?: number;
    ballReleaseCharge?: number;
  }) => {
    animateVanguardBallView(root, { ...ready, dt: 0, ...input });
    const shoulder = pos(root, "RightArm"),
      elbow = pos(root, "RightForeArm"),
      hand = pos(root, "RightHand");
    const flexion =
      Math.PI - shoulder.sub(elbow).angleTo(hand.clone().sub(elbow));
    return { hand, elbow, flexion };
  };
  const carry = sample({});
  const loaded = sample({ ballCharge: 1 });
  assert.ok(
    loaded.hand.y > carry.hand.y + 0.25,
    "charged hand draws up beside the head",
  );
  assert.ok(loaded.flexion > Math.PI / 3, "windup has a bent elbow");
  const release = sample({ ballThrowTime: 0.12 });
  assert.ok(
    release.flexion < loaded.flexion - 0.3,
    "elbow extends into the delivery",
  );
  assert.ok(release.flexion > 0.2, "extension avoids locking the elbow");
  assert.ok(release.hand.z < loaded.hand.z - 0.12, "delivery travels forward");
  const tap = sample({ ballThrowTime: 0.055, ballReleaseCharge: 0 });
  assert.ok(
    tap.hand.distanceTo(carry.hand) < 0.08,
    "tap skips the full cocking pose",
  );
  for (const charge of [0, 0.05, 0.18, 0.5, 1]) {
    const previous = new Map<string, THREE.Quaternion>();
    for (let frame = 0; frame <= 200; frame++) {
      const time = frame / 120;
      sample(
        time < 1.2
          ? { ballCharge: Math.min(charge, time / 1.2) }
          : { ballThrowTime: time - 1.2, ballReleaseCharge: charge },
      );
      for (const name of ["RightArm", "RightForeArm", "RightHand"]) {
        const q = root
          .getObjectByName(name)!
          .getWorldQuaternion(new THREE.Quaternion());
        if (previous.has(name))
          assert.ok(
            previous.get(name)!.angleTo(q) < 0.3,
            `no abrupt wrist/arm step at charge ${charge}, time ${time}, ${name}`,
          );
        previous.set(name, q);
      }
    }
  }
  disposeIronVanguard(root);
});

test("camera throw loads beside the shoulder and pronates into a palm-down delivery", () => {
  const root = createVanguardSwordView(200, body, sword);
  const arm = root.getObjectByName("RightArm")!;
  const elbow = root.getObjectByName("RightForeArm")!;
  const hand = root.getObjectByName("RightHand")!;
  let elbowBind: THREE.Quaternion | undefined;
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh) || elbowBind) return;
    const { bones, boneInverses } = object.skeleton;
    const index = bones.indexOf(elbow as THREE.Bone);
    const parent = bones.indexOf(arm as THREE.Bone);
    if (index < 0 || parent < 0) return;
    elbowBind = new THREE.Quaternion();
    boneInverses[parent]
      .clone()
      .multiply(boneInverses[index].clone().invert())
      .decompose(new THREE.Vector3(), elbowBind, new THREE.Vector3());
  });
  assert.ok(elbowBind);
  const roll = () => {
    const forward = pos(root, "RightHand")
      .sub(pos(root, "RightForeArm"))
      .normalize();
    // Remove elbow flexion using the rig's bind orientation; measure only axial roll.
    const unrolled = arm
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(elbowBind!);
    const restDirection = hand.position
      .clone()
      .normalize()
      .applyQuaternion(unrolled);
    unrolled.premultiply(
      new THREE.Quaternion().setFromUnitVectors(restDirection, forward),
    );
    const delta = elbow
      .getWorldQuaternion(new THREE.Quaternion())
      .multiply(unrolled.invert());
    const angle =
      2 *
      Math.atan2(
        new THREE.Vector3(delta.x, delta.y, delta.z).dot(forward),
        delta.w,
      );
    return (
      THREE.MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
    );
  };
  animateVanguardBallView(root, { ...ready, dt: 0 });
  const carryRoll = roll();
  animateVanguardBallView(root, { ...ready, dt: 0, ballCharge: 1 });
  const loadedRoll = roll();
  const loadedHand = pos(root, "RightHand");
  const loadedElbow = pos(root, "RightForeArm");
  assert.ok(
    loadedHand.x > pos(root, "RightArm").x + 0.15,
    "load beside the shoulder, not in front of the face",
  );
  assert.ok(
    loadedElbow.y < loadedHand.y - 0.2,
    "elbow stays below the raised hand",
  );
  assert.ok(
    Math.abs(loadedElbow.z - loadedHand.z) < 0.12,
    "forearm stays upright in the pocket",
  );
  const palm = () =>
    pos(root, "DEF_Index_01_R")
      .sub(pos(root, "DEF_Pinky_01_R"))
      .cross(
        new THREE.Vector3(0, 1, 0).applyQuaternion(
          hand.getWorldQuaternion(new THREE.Quaternion()),
        ),
      )
      .normalize();

  animateVanguardBallView(root, { ...ready, dt: 0, ballThrowTime: 0.12 });
  const deliveredRoll = roll();
  assert.ok(
    palm().y < -0.45 && palm().z < 0.15,
    "release palm turns down and away from the camera",
  );
  animateVanguardBallView(root, { ...ready, dt: 0, ballThrowTime: 0.26 });
  assert.ok(
    pos(root, "RightHand").y < pos(root, "RightForeArm").y - 0.05,
    "hand drops below the elbow in follow-through",
  );
  assert.ok(palm().y < -0.45, "follow-through keeps the palm down");

  assert.ok(
    Math.atan2(
      Math.sin(deliveredRoll - loadedRoll),
      Math.cos(deliveredRoll - loadedRoll),
    ) < -0.5,
    "delivery pronates instead of reversing into a palm-up scoop",
  );
  const angleDelta = (a: number, b: number) =>
    Math.atan2(Math.sin(a - b), Math.cos(a - b));
  for (const charge of [0, 0.18, 0.5, 1]) {
    let previous = carryRoll;
    for (let frame = 0; frame <= 200; frame++) {
      const time = frame / 120;
      animateVanguardBallView(root, {
        ...ready,
        dt: 0,
        ...(time < 1.2
          ? { ballCharge: Math.min(charge, time / 1.2) }
          : { ballThrowTime: time - 1.2, ballReleaseCharge: charge }),
      });
      const current = roll();
      assert.ok(
        Math.abs(angleDelta(current, carryRoll)) < (160 * Math.PI) / 180,
        `forearm over-rotated at charge ${charge}, time ${time}`,
      );
      assert.ok(
        Math.abs(angleDelta(current, previous)) < 0.18,
        `axial roll must not snap: charge ${charge}, time ${time}, delta ${angleDelta(current, previous)}`,
      );
      if (charge >= 0.5 && time >= 0.96 && time < 1.2)
        assert.ok(
          angleDelta(current, carryRoll) < -0.4,
          "right forearm must roll back into the windup, not turn inward across the ball",
        );
      previous = current;
    }
    assert.ok(
      Math.abs(angleDelta(roll(), carryRoll)) < 1e-5,
      "recovery returns to the same grip roll",
    );
  }
  disposeIronVanguard(root);
});

test("football throw leads with the elbow, uncoils the shoulders and finishes across the body without moving the feet", () => {
  const root = createIronVanguardModel(200, false, body);
  const pose = (input: { ballCharge?: number; ballThrowTime?: number }) => {
    animateIronVanguard(root, {
      ...ready,
      dt: 0,
      activeWeapon: "ball",
      previewClip: "idle",
      previewTime: 0,
      ...input,
    });
    const names = [
      "RightArm",
      "LeftArm",
      "RightForeArm",
      "RightHand",
      "Spine",
      "Head",
      "LeftFoot",
      "RightFoot",
    ];
    return Object.fromEntries(names.map((name) => [name, pos(root, name)]));
  };
  const carry = pose({});
  const pocket = pose({ ballCharge: 1 });
  const shoulder = (p: Record<string, THREE.Vector3>) =>
    p.RightArm.clone().sub(p.LeftArm).normalize();
  assert.ok(
    shoulder(carry).angleTo(shoulder(pocket)) > 0.85,
    "shoulders visibly coil during charge",
  );
  const ball = root.userData.ironVanguard.ball.getWorldPosition(
    new THREE.Vector3(),
  );
  assert.ok(
    ball.distanceTo(pocket.Head) < 0.75 &&
      Math.abs(ball.y - pocket.Head.y) < 0.3,
    "ball sits beside the head instead of overhead",
  );
  const lead = pose({ ballThrowTime: 0.055 });
  assert.ok(
    lead.RightForeArm.z < lead.RightHand.z - 0.03,
    "elbow drives ahead while the hand lags",
  );
  const release = pose({ ballThrowTime: 0.13 });
  assert.ok(
    release.RightHand.z < release.RightForeArm.z - 0.08,
    "forearm extends through release",
  );
  const finish = pose({ ballThrowTime: 0.27 });
  assert.ok(
    finish.RightHand.x < finish.Spine.x - 0.08,
    "throwing hand crosses the torso",
  );
  assert.ok(
    shoulder(pocket).angleTo(shoulder(finish)) > 0.65,
    "body unwinds into the finish",
  );
  for (const p of [pocket, lead, release, finish])
    for (const foot of ["LeftFoot", "RightFoot"])
      assert.ok(
        p[foot].distanceTo(carry[foot]) < 1e-5,
        "throw overlay must preserve the current support/gait",
      );
  const once = root.userData.ironVanguard.bones.Spine.quaternion.clone();
  pose({ ballThrowTime: 0.27 });
  assert.ok(
    once.angleTo(root.userData.ironVanguard.bones.Spine.quaternion) < 1e-6,
    "repeated sampling must not accumulate twist",
  );
  assert.deepEqual(root.position.toArray(), [0, 0, 0]);
  disposeIronVanguard(root);
});

test("body throw keeps the wrist aligned, the elbow bent, and the palm down across charge levels", () => {
  const root = createIronVanguardModel(200, false, body);
  const bind = new Map<string, THREE.Quaternion>();
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const { bones, boneInverses } = object.skeleton;
    for (const [i, bone] of bones.entries()) {
      if (!/^(Right|Left)Hand$/.test(bone.name)) continue;
      const parent = bones.indexOf(bone.parent as THREE.Bone);
      const rotation = new THREE.Quaternion();
      boneInverses[parent]
        .clone()
        .multiply(boneInverses[i].clone().invert())
        .decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
      bind.set(bone.name, rotation.normalize());
    }
  });
  const animate = (input: {
    ballCharge?: number;
    ballThrowTime?: number;
    ballReleaseCharge?: number;
  }) =>
    animateIronVanguard(root, {
      ...ready,
      dt: 0,
      activeWeapon: "ball",
      previewClip: "idle",
      previewTime: 0,
      ...input,
    });
  const palm = () =>
    pos(root, "DEF_Index_01_R")
      .sub(pos(root, "DEF_Pinky_01_R"))
      .cross(
        new THREE.Vector3(0, 1, 0).applyQuaternion(
          root
            .getObjectByName("RightHand")!
            .getWorldQuaternion(new THREE.Quaternion()),
        ),
      )
      .normalize();
  for (const charge of [0, 0.05, 0.18, 0.35, 0.65, 1]) {
    const previous = new Map<string, THREE.Quaternion>();
    for (let frame = 0; frame <= 200; frame++) {
      const time = frame / 120;
      animate(
        time < 1.2
          ? { ballCharge: Math.min(charge, time / 1.2) }
          : { ballThrowTime: time - 1.2, ballReleaseCharge: charge },
      );
      for (const name of [
        "RightArm",
        "RightForeArm",
        "RightHand",
        "LeftArm",
        "LeftForeArm",
        "LeftHand",
      ]) {
        const bone = root.getObjectByName(name)!;
        const q = bone.getWorldQuaternion(new THREE.Quaternion());
        if (previous.has(name))
          assert.ok(
            previous.get(name)!.angleTo(q) < 0.4,
            `${name} snaps at charge ${charge}, time ${time}`,
          );
        previous.set(name, q);
        if (bind.has(name))
          assert.ok(
            bone.quaternion.angleTo(bind.get(name)!) < 0.5,
            `${name} bends excessively instead of rotating with the forearm`,
          );
      }
      const shoulder = pos(root, "RightArm"),
        elbow = pos(root, "RightForeArm"),
        hand = pos(root, "RightHand");
      assert.ok(
        shoulder.distanceTo(hand) /
          (shoulder.distanceTo(elbow) + elbow.distanceTo(hand)) <
          0.97,
        `elbow locks at charge ${charge}, time ${time}`,
      );
    }
    animate({ ballThrowTime: 0.13, ballReleaseCharge: charge });
    assert.ok(
      palm().y < -0.65,
      "release pronates into a palm-down throw, not a scoop",
    );
    animate({ ballThrowTime: 0.27, ballReleaseCharge: charge });
    assert.ok(
      palm().y < -0.35,
      "follow-through maintains the palm-down rotation",
    );
    assert.ok(
      pos(root, "RightHand").y < pos(root, "RightForeArm").y - 0.05,
      "hand drops below the elbow in the cross-body finish",
    );
  }
  const sample = (t: number) =>
    sampleVanguardBall({ ...ready, ballThrowTime: t }).hand;
  for (const t of [0.055, 0.13, 0.27]) {
    const epsilon = 1e-5;
    const before = sample(t - epsilon),
      at = sample(t),
      after = sample(t + epsilon);
    const incoming = at.clone().sub(before).divideScalar(epsilon);
    const outgoing = after.clone().sub(at).divideScalar(epsilon);
    assert.ok(
      incoming.length() > 0.2,
      "delivery must not stop at an intermediate pose",
    );
    assert.ok(
      incoming.distanceTo(outgoing) < 0.02,
      "body throw velocity is continuous",
    );
  }
  disposeIronVanguard(root);
});

test("football delivery has no wrist or elbow flips through wind-up, release and recovery in either view", () => {
  for (const firstPerson of [false, true]) {
    const root = firstPerson
      ? createVanguardSwordView(200, body, sword)
      : createIronVanguardModel(200, false, body);
    const previous = new Map<string, THREE.Quaternion>();
    for (let frame = 0; frame <= 200; frame++) {
      const time = frame / 120;
      const input = {
        ...ready,
        dt: 0,
        ballCharge: time < 1.2 ? time / 1.2 : 0,
        ballThrowTime: time >= 1.2 && time < 1.66 ? time - 1.2 : undefined,
      };
      if (firstPerson) animateVanguardBallView(root, input);
      else
        animateIronVanguard(root, {
          ...input,
          activeWeapon: "ball",
          previewClip: "idle",
          previewTime: 0,
        });
      for (const name of [
        "RightArm",
        "RightForeArm",
        "RightHand",
        "Spine",
        "LeftArm",
        "LeftForeArm",
      ]) {
        const q = root
          .getObjectByName(name)!
          .getWorldQuaternion(new THREE.Quaternion());
        assert.ok(q.toArray().every(Number.isFinite));
        if (previous.has(name))
          assert.ok(
            previous.get(name)!.angleTo(q) < 0.65,
            `no flip in ${firstPerson ? "first" : "third"} person ${name} at ${time}`,
          );
        previous.set(name, q);
      }
    }
    disposeIronVanguard(root);
  }
});

test("camera ball poses protect the aim lane, keep the carry visible, and aim a closed fist forward", () => {
  const root = createVanguardSwordView(200, body, sword);
  const camera = new THREE.PerspectiveCamera(75, 4 / 3, 0.01, 100);
  camera.updateMatrixWorld(true);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(
    camera.projectionMatrix,
  );
  let carryBall: THREE.Vector3 | undefined;
  let loadedFist: THREE.Vector3 | undefined;
  const samples = [
    ...Array.from({ length: 31 }, (_, i) => ({ ...ready, ballCharge: i / 30 })),
    ...Array.from({ length: 57 }, (_, i) => ({
      ...ready,
      ballThrowTime: i / 120,
    })),
    ...Array.from({ length: 105 }, (_, i) => {
      const t = i / 120;
      return {
        weaponState:
          t < 0.24 ? "swing_up" : t < 0.36 ? "swing_down" : "recovering",
        weaponTimer: t < 0.24 ? t : t < 0.36 ? t - 0.24 : t - 0.36,
      };
    }),
  ];
  for (const input of samples) {
    animateVanguardBallView(root, { ...input, dt: 0 });
    for (const side of ["Left", "Right"]) {
      assert.equal(
        frustum.intersectsSphere(
          new THREE.Sphere(pos(root, side + "Arm"), 0.1),
        ),
        false,
        "shoulder attachment and its surrounding cut remain below the camera",
      );
    }
    if (!("ballThrowTime" in input)) {
      root.userData.ironVanguard.ball.traverse((object: THREE.Object3D) => {
        if (!(object instanceof THREE.Mesh)) return;
        const vertices = object.geometry.getAttribute("position");
        for (let i = 0; i < vertices.count; i++) {
          const screen = new THREE.Vector3()
            .fromBufferAttribute(vertices, i)
            .applyMatrix4(object.matrixWorld)
            .project(camera);
          const charging =
            "ballCharge" in input &&
            typeof input.ballCharge === "number" &&
            input.ballCharge > 0.25;
          if (charging) {
            assert.ok(
              screen.x > 0.25,
              "windup moves the bomb to the right edge and clears the aim lane",
            );
            assert.ok(
              screen.z < 1,
              "windup never crosses the camera near plane",
            );
          } else {
            assert.ok(
              Math.abs(screen.x) < 1 && Math.abs(screen.y) < 1,
              `carry/gather stays visible: ${JSON.stringify(input)} ${screen.toArray()}`,
            );
          }
        }
      });
    }
    if (input.weaponState === "swing_up") {
      const ball = root.userData.ironVanguard.ball.getWorldPosition(
        new THREE.Vector3(),
      );
      carryBall ??= ball;
      assert.ok(
        ball.distanceTo(carryBall) < 0.025,
        "punch does not sweep the carrying hand across the view",
      );
      loadedFist = pos(root, "LeftHand");
    }
    if (input.weaponState === "recovering" && input.weaponTimer < 0.01) {
      const fist = pos(root, "LeftHand");
      assert.ok(
        fist.z < loadedFist!.z - 0.15,
        "punch extends forward from its loaded pose",
      );
      const screen = fist.clone().project(camera);
      assert.ok(
        Math.abs(screen.x) < 0.25 && Math.abs(screen.y) < 0.35,
        "punch drives toward the aim lane",
      );
      for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
        const bone = root.getObjectByName(`DEF_${finger}_03_L`)!;
        const tip = bone.localToWorld(new THREE.Vector3(0, 2, 0));
        assert.ok(
          tip.distanceTo(pos(root, `DEF_${finger}_01_L`)) < 0.06,
          "punch fingers fold into the fist instead of a weapon-handle grip",
        );
      }
    }
  }
  disposeIronVanguard(root);
});

test("skull carry cups the casing with a neutral wrist and keeps the grip until release in both views", () => {
  for (const firstPerson of [false, true]) {
    const root = firstPerson
      ? createVanguardSwordView(200, body, sword)
      : createIronVanguardModel(200, false, body);
    const bind = new Map<string, THREE.Quaternion>();
    root.traverse((object) => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const { bones, boneInverses } = object.skeleton;
      for (const [i, bone] of bones.entries()) {
        const parent = bones.indexOf(bone.parent as THREE.Bone);
        if (parent < 0) continue;
        const rotation = new THREE.Quaternion();
        boneInverses[parent]
          .clone()
          .multiply(boneInverses[i].clone().invert())
          .decompose(new THREE.Vector3(), rotation, new THREE.Vector3());
        bind.set(bone.name, rotation.normalize());
      }
    });
    const pose = (
      input: Partial<Parameters<typeof sampleVanguardBall>[0]> = {},
    ) => {
      const state = { ...ready, dt: 0, ...input };
      if (firstPerson) animateVanguardBallView(root, state);
      else
        animateIronVanguard(root, {
          ...state,
          activeWeapon: "ball",
          previewClip: "idle",
          previewTime: 0,
        });
    };
    pose();
    const hand = root.getObjectByName("RightHand")!;
    assert.ok(
      hand.quaternion.angleTo(bind.get("RightHand")!) < 0.3,
      "carry wrist stays near its anatomical rest angle",
    );
    for (const finger of ["Index", "Middle", "Ring", "Pinky"]) {
      assert.ok(
        pos(root, `DEF_${finger}_01_R`).distanceTo(
          pos(root, `DEF_${finger}_03_R`),
        ) > 0.065,
        `${finger} wraps a broad casing instead of folding into a handle fist`,
      );
    }
    const palmNormal = pos(root, "DEF_Index_01_R")
      .sub(pos(root, "DEF_Pinky_01_R"))
      .cross(
        new THREE.Vector3(0, 1, 0).applyQuaternion(
          hand.getWorldQuaternion(new THREE.Quaternion()),
        ),
      )
      .normalize();
    const ballDirection = root.userData.ironVanguard.ball
      .getWorldPosition(new THREE.Vector3())
      .sub(pos(root, "DEF_Middle_01_R"))
      .normalize();
    assert.ok(
      palmNormal.dot(ballDirection) > 0.8,
      "bomb rests on the palm side of the hand",
    );
    const fingers: THREE.Object3D[] = [];
    root.traverse((bone) => {
      if (/^DEF_.*_R$/.test(bone.name)) fingers.push(bone);
    });
    const cup = fingers.map((bone) => bone.quaternion.clone());
    for (const input of [
      { ballCharge: 0.18 },
      { ballCharge: 1 },
      { weaponState: "swing_up", weaponTimer: 0.24 },
      { weaponState: "swing_down", weaponTimer: 0.12 },
      { ballThrowTime: VANGUARD_BALL_HANDOFF_START },
    ]) {
      pose(input);
      fingers.forEach((bone, i) =>
        assert.ok(
          bone.quaternion.angleTo(cup[i]) < 1e-6,
          "grip stays closed while held",
        ),
      );
    }
    pose({ ballThrowTime: VANGUARD_BALL_HANDOFF_END });
    for (const bone of fingers)
      assert.ok(
        bone.quaternion.angleTo(bind.get(bone.name)!) < 1e-6,
        "fingers open as the ball leaves",
      );
    pose({ ballThrowTime: 0.46 });
    fingers.forEach((bone, i) =>
      assert.ok(
        bone.quaternion.angleTo(cup[i]) < 1e-6,
        "recovery restores the cup without accumulating rotation",
      ),
    );
    disposeIronVanguard(root);
  }
});

test("free-hand punch keeps the ball tucked and follows the existing impact clock", () => {
  const carry = sampleVanguardBall(ready);
  for (const speed of [0.12, 0.24, 0.48]) {
    const settings = { hammerMeleeSpeed: speed, grifballPunchCooldown: 0.5 };
    const windup = sampleVanguardBall({
      weaponState: "swing_up",
      weaponTimer: speed,
      settings,
    });
    const strike = sampleVanguardBall({
      weaponState: "swing_down",
      weaponTimer: speed * 0.5,
      settings,
    });
    const recover = sampleVanguardBall({
      weaponState: "recovering",
      weaponTimer: 0,
      settings,
    });
    for (const pose of [windup, strike, recover])
      assert.ok(
        pose.hand
          .clone()
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), -pose.torsoYaw)
          .distanceTo(carry.hand) < 1e-8,
        "carrying hand keeps its tuck while turning with the torso",
      );
    assert.ok(windup.torsoYaw > 0.85, "punch visibly coils before striking");
    assert.ok(strike.torsoYaw < -0.2, "shoulders drive through impact");
    const startStrike = sampleVanguardBall({
      weaponState: "swing_down",
      weaponTimer: 0,
      settings,
    });
    for (const key of ["torsoYaw", "torsoPitch"] as const) {
      assert.equal(windup[key], startStrike[key]);
      assert.equal(strike[key], recover[key]);
      assert.equal(
        sampleVanguardBall({
          weaponState: "recovering",
          weaponTimer: 0.5,
          settings,
        })[key],
        carry[key],
      );
    }
    for (const state of ["melee_up", "melee_swing", "melee_down"]) {
      const loaded = sampleVanguardBall({
        weaponState: state,
        weaponTimer: state === "melee_down" ? 0 : speed * 0.4,
        settings,
      });
      const extended = sampleVanguardBall({
        weaponState: state,
        weaponTimer: state === "melee_down" ? speed * 0.6 : speed,
        settings,
      });
      assert.equal(loaded.torsoYaw, windup.torsoYaw);
      assert.equal(extended.torsoYaw, strike.torsoYaw);
    }
    assert.ok(windup.offhand.z > carry.offhand.z);
    assert.ok(strike.offhand.z < carry.offhand.z - 0.2);
    assert.ok(recover.offhand.distanceTo(strike.offhand) < 1e-8);
    assert.ok(
      sampleVanguardBall({
        weaponState: "recovering",
        weaponTimer: 0.5,
        settings,
      }).offhand.distanceTo(carry.offhand) < 1e-8,
    );
  }
});

test("jab reaches full arm extension at impact and retracts without locking the elbow", () => {
  for (const firstPerson of [false, true]) {
    const root = firstPerson
      ? createVanguardSwordView(200, body, sword)
      : createIronVanguardModel(200, false, body);
    const animate = (
      weaponState: string,
      weaponTimer: number,
      speed: number,
    ) => {
      const input = {
        dt: 0,
        weaponState,
        weaponTimer,
        settings: { hammerMeleeSpeed: speed, grifballPunchCooldown: 0.5 },
      };
      if (firstPerson) animateVanguardBallView(root, input);
      else
        animateIronVanguard(root, {
          ...input,
          activeWeapon: "ball",
          previewClip: "idle",
          previewTime: 0,
        });
    };
    const arm = () => {
      const shoulder = pos(root, "LeftArm"),
        elbow = pos(root, "LeftForeArm"),
        hand = pos(root, "LeftHand");
      const length = shoulder.distanceTo(elbow) + elbow.distanceTo(hand);
      return {
        hand,
        length,
        reach: shoulder.distanceTo(hand) / length,
        angle:
          (shoulder.clone().sub(elbow).angleTo(hand.clone().sub(elbow)) * 180) /
          Math.PI,
      };
    };
    animate("ready", 0, 0.24);
    const guard = arm();
    const wrist = root.getObjectByName("LeftHand")!.quaternion.clone();
    for (const speed of [0.12, 0.24, 0.48]) {
      for (const [state, time] of [
        ["swing_down", speed * 0.5],
        ["melee_swing", speed],
      ] as const) {
        animate(state, time, speed);
        const impact = arm();
        assert.ok(
          impact.reach > 0.995 && impact.reach < 0.999,
          "jab uses full reach with a soft elbow",
        );
        assert.ok(
          impact.angle > 170 && impact.angle < 179,
          `near-straight elbow at impact: ${impact.angle}`,
        );
        assert.ok(
          Math.abs(impact.length - guard.length) < 1e-5,
          "bones never stretch to reach the target",
        );
        assert.ok(
          root.getObjectByName("LeftHand")!.quaternion.angleTo(wrist) < 1e-6,
          "wrist remains aligned with the forearm",
        );
        animate("recovering", 0, speed);
        assert.ok(
          arm().hand.distanceTo(impact.hand) < 1e-6,
          "recovery starts at the impact pose",
        );
        animate("recovering", 0.22, speed);
        assert.ok(
          arm().reach < 0.8,
          "jab returns to a bent guard before the cooldown ends",
        );
        animate("recovering", 0.5, speed);
        assert.ok(
          arm().hand.distanceTo(guard.hand) < 1e-6,
          "recovery returns to the original guard",
        );
      }
    }
    disposeIronVanguard(root);
  }
});

test("punch shoulders visibly coil without foot motion or arm flips in either view", () => {
  for (const firstPerson of [false, true]) {
    const root = firstPerson
      ? createVanguardSwordView(200, body, sword)
      : createIronVanguardModel(200, false, body);
    const previous = new Map<string, THREE.Quaternion>();
    let feet: THREE.Vector3[] = [];
    let shoulders: THREE.Vector3 | undefined;
    for (let frame = 0; frame <= 120; frame++) {
      const t = frame / 120;
      const input = {
        dt: 0,
        weaponState:
          t < 0.24
            ? "swing_up"
            : t < 0.36
              ? "swing_down"
              : t < 0.86
                ? "recovering"
                : "ready",
        weaponTimer:
          t < 0.24 ? t : t < 0.36 ? t - 0.24 : t < 0.86 ? t - 0.36 : 0,
      };
      if (firstPerson) animateVanguardBallView(root, input);
      else
        animateIronVanguard(root, {
          ...input,
          activeWeapon: "ball",
          previewClip: "idle",
          previewTime: 0,
        });
      if (frame === 0) {
        feet = [pos(root, "LeftFoot"), pos(root, "RightFoot")];
        shoulders = pos(root, "RightArm").sub(pos(root, "LeftArm")).normalize();
      }
      if (!firstPerson) {
        assert.ok(pos(root, "LeftFoot").distanceTo(feet[0]) < 1e-5);
        assert.ok(pos(root, "RightFoot").distanceTo(feet[1]) < 1e-5);
        if (frame === 28)
          assert.ok(
            shoulders!.angleTo(
              pos(root, "RightArm").sub(pos(root, "LeftArm")),
            ) > 0.85,
            "opponents see a broad shoulder wind-up",
          );
      }
      for (const name of [
        "RightArm",
        "RightForeArm",
        "RightHand",
        "Spine",
        "LeftArm",
        "LeftForeArm",
        "LeftHand",
      ]) {
        const q = root
          .getObjectByName(name)!
          .getWorldQuaternion(new THREE.Quaternion());
        assert.ok(q.toArray().every(Number.isFinite));
        if (previous.has(name))
          assert.ok(
            previous.get(name)!.angleTo(q) < 0.65,
            `no punch flip in ${firstPerson ? "first" : "third"} person ${name} at ${t}`,
          );
        previous.set(name, q);
      }
    }
    disposeIronVanguard(root);
  }
});

test("hand attachment remains rigid through eight travel directions, speeds, aim, jumping and slides", () => {
  const root = createIronVanguardModel(200, false, body);
  let grip: THREE.Matrix4 | undefined;
  const lengths = new Map<string, number>();
  for (let direction = 0; direction < 8; direction++)
    for (const speed of [0, 4, 10])
      for (const action of [
        "carry",
        "charge",
        "punch",
        "jump",
        "slide",
        "release",
        "follow-through",
        "jump-throw",
        "slide-throw",
      ]) {
        const a = (direction * Math.PI) / 4;
        const throwing = [
          "release",
          "follow-through",
          "jump-throw",
          "slide-throw",
        ].includes(action);
        animateIronVanguard(root, {
          ...ready,
          dt: 1 / 60,
          activeWeapon: "ball",
          vel: new THREE.Vector3(
            Math.sin(a) * speed,
            action.startsWith("jump") ? 4 : 0,
            -Math.cos(a) * speed,
          ),
          yaw: 0.6,
          lookPitch: 0.4,
          isJumping: action.startsWith("jump"),
          isSliding: action.startsWith("slide"),
          ballCharge: action === "charge" ? 0.8 : 0,
          ballThrowTime: throwing
            ? action === "follow-through"
              ? 0.27
              : 0.13
            : undefined,
          weaponState: action === "punch" ? "swing_down" : "ready",
          weaponTimer: 0.1,
        });
        root.updateWorldMatrix(true, true);
        const runtime = root.userData.ironVanguard;
        const current = new THREE.Matrix4()
          .copy(runtime.bones.RightHand.matrixWorld)
          .invert()
          .multiply(runtime.ball.matrixWorld);
        if (!grip) grip = current;
        else
          assert.ok(
            difference(grip, current) < 1e-3,
            `ball must not slip in the hand: ${direction} ${speed} ${action}`,
          );
        assert.equal(runtime.ball.visible, !throwing);
        assert.equal(runtime.hammer.visible, false);
        for (const side of ["Left", "Right"])
          for (const [start, end] of [
            ["Arm", "ForeArm"],
            ["ForeArm", "Hand"],
          ]) {
            const name = side + start;
            const length = pos(root, name).distanceTo(pos(root, side + end));
            if (!lengths.has(name)) lengths.set(name, length);
            assert.ok(
              Math.abs(length - lengths.get(name)!) < 1e-5,
              "arm bones must not stretch",
            );
          }
        assert.ok(runtime.ball.matrixWorld.elements.every(Number.isFinite));
      }
  animateIronVanguard(root, { ...ready, dt: 0, activeWeapon: "hammer" });
  assert.equal(root.userData.ironVanguard.ball.visible, false);
  animateIronVanguard(root, { ...ready, dt: 0, activeWeapon: "ball", hp: 0 });
  assert.equal(root.userData.ironVanguard.ball.visible, false);
  disposeIronVanguard(root);
});

function setup() {
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: null,
    isMultiplayer: false,
  });
  state.grifball.phase = "playing";
  state.playerHP = 1;
  state.pWeaponState = "ready";
  state.pSwordState = "ready";
  const refs = createInitialGrifballThreeRefs();
  refs.hostGroup = createIronVanguardModel(200, false, body);
  refs.playerSword = createVanguardSwordView(200, body, sword);
  refs.playerHammer = new THREE.Group();
  refs.playerPistol = new THREE.Group();
  refs.scene = new THREE.Scene();
  const ballMeshRef: { current: THREE.Mesh | null } = { current: null };
  ensureGrifballBallMeshForRefs({ refs, ballMeshRef });
  const mesh = ballMeshRef.current!;
  mesh.visible = true;
  const hold = (id: string, charge: number) => {
    Object.assign(state.grifball.ball, { state: "held", holderId: id });
    if (id === "player") {
      state.activeWeapon = "ball";
      state.grifballPassCharge = charge;
    } else state.otherPlayers.get(id)!.grifballPassCharge = charge;
    updateV3GameplayBall(state, refs, mesh, 0, "v3");
    prepareIronVanguardBallVisuals(state, refs, mesh, 0);
    assert.equal(mesh.getObjectByName("v3SkullBomb")?.visible, true);
    assert.equal((mesh.material as THREE.Material).visible, false);
    const model =
      id === "player" ? refs.hostGroup! : refs.otherPlayerMeshes.get(id)!.group;
    animateIronVanguard(model, { ...ready, dt: 0, activeWeapon: "ball" });
    finishIronVanguardBallVisuals(state, refs, mesh, 0);
    return model;
  };
  return { state, refs, mesh, hold };
}

test("live player hold duration drives the same body charge used for throw speed at configured charge times", async () => {
  const { updateGrifballObjectiveForState, throwPlayerGrifballPassForState } =
    await import("../grifball/grifballObjectiveRuntime");
  for (const chargeMax of [0.6, 1.2, 2.4]) {
    const { state, refs, mesh, hold } = setup();
    state.settings = {
      ...state.settings,
      gameMode: "grifball",
      grifballChargeMax: chargeMax,
    };
    const charging = { current: true },
      timer = { current: 0 };
    hold("player", 0);
    let elapsed = 0;
    for (const fraction of [0.25, 0.5, 0.75, 0.8, 0.9, 1, 1.5]) {
      const next = fraction * chargeMax;
      updateGrifballObjectiveForState({
        state,
        refs,
        ballMeshRef: { current: mesh },
        ballChargingRef: charging,
        ballChargeTimerRef: timer,
        dt: next - elapsed,
        isMultiplayer: false,
        activeCustomMap: null,
        placeCombatantsAtGrifballSpawns: () => {},
        pushStatsUpdate: () => {},
      });
      elapsed = next;
      const expected = Math.min(1, fraction);
      assert.ok(Math.abs(state.grifballPassCharge - expected) < 1e-8);
      prepareIronVanguardBallVisuals(state, refs, mesh, 0);
      assert.equal(
        refs.hostGroup!.userData.vanguardBallCharge,
        state.grifballPassCharge,
      );
      const pose = sampleVanguardBall({
        ...ready,
        ballCharge: refs.hostGroup!.userData.vanguardBallCharge,
      });
      assert.ok(Math.abs(pose.torsoYaw + 1.05 * expected) < 1e-8);
    }
    // Release uses the same held-time fraction as the visible winding pose.
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      hold("player", fraction);
      timer.current = fraction * chargeMax;
      charging.current = true;
      throwPlayerGrifballPassForState({
        state,
        refs,
        ballChargingRef: charging,
        ballChargeTimerRef: timer,
        playSwing: () => {},
      });
      const expectedSpeed =
        state.settings.grifballPassSpeedMin! +
        fraction *
          (state.settings.grifballPassSpeedMax! -
            state.settings.grifballPassSpeedMin!);
      assert.ok(
        Math.abs(
          Math.hypot(state.grifball.ball.vel.x, state.grifball.ball.vel.z) -
            expectedSpeed,
        ) < 1e-8,
      );
    }
    disposeIronVanguard(refs.hostGroup!);
    disposeIronVanguard(refs.playerSword!);
  }
});

test("player release hands off one visible ball without moving the physics state or delaying the throw", () => {
  const { state, refs, mesh, hold } = setup();
  hold("player", 0.18);
  assert.equal(mesh.visible, false);
  assert.ok(refs.playerSword!.visible);
  const prop = refs.playerSword!.userData.ironVanguard.ball;
  const origin = prop.getWorldPosition(new THREE.Vector3());
  Object.assign(state.grifball.ball, {
    state: "thrown",
    holderId: null,
    pos: { x: 0, y: 1.1, z: -0.4 },
    vel: { x: 0, y: 4, z: -12 },
  });
  state.activeWeapon = "hammer";
  state.grifballPassCharge = 0;
  mesh.position.set(0, 1.1, -0.4);
  mesh.visible = true;
  const before = JSON.stringify(state.grifball.ball);
  updateV3GameplayBall(state, refs, mesh, 0, "v3");
  prepareIronVanguardBallVisuals(state, refs, mesh, 0);
  finishIronVanguardBallVisuals(state, refs, mesh, 0);
  assert.equal(JSON.stringify(state.grifball.ball), before);
  assert.ok(mesh.position.distanceTo(origin) < 1e-5);
  assert.equal(prop.visible, false);
  assert.equal(mesh.visible, true);
  assert.equal(refs.playerHammer!.visible, false);
  assert.equal(mesh.userData.ironVanguardBallVisual.release.charge, 0.18);
  assert.equal(mesh.scale.x, 1);
  assert.equal(
    mesh.getObjectByName("v3SkullBomb")?.visible,
    true,
    "release keeps the gameplay skull",
  );
  assert.equal(
    (mesh.material as THREE.Material).visible,
    false,
    "release never reveals the old sphere",
  );
  assert.ok(
    mesh.quaternion
      .clone()
      .normalize()
      .angleTo(prop.getWorldQuaternion(new THREE.Quaternion()).normalize()) <
      1e-6,
    "the skull retains its hand orientation during the visual handoff",
  );
  mesh.position.set(0, 1.2, -1);
  prepareIronVanguardBallVisuals(
    state,
    refs,
    mesh,
    VANGUARD_BALL_HANDOFF_START - 0.001,
  );
  finishIronVanguardBallVisuals(state, refs, mesh, 0);
  assert.ok(
    mesh.position.distanceTo(prop.getWorldPosition(new THREE.Vector3())) < 1e-5,
    "ball stays on the hand through the elbow lead",
  );
  mesh.position.set(0, 1.3, -2);
  prepareIronVanguardBallVisuals(
    state,
    refs,
    mesh,
    VANGUARD_BALL_HANDOFF_END - VANGUARD_BALL_HANDOFF_START + 0.002,
  );
  finishIronVanguardBallVisuals(state, refs, mesh, 0);
  assert.deepEqual(mesh.position.toArray(), [0, 1.3, -2]);
  mesh.position.set(0, 1.3, -2);
  prepareIronVanguardBallVisuals(state, refs, mesh, 0.2);
  finishIronVanguardBallVisuals(state, refs, mesh, 0.2);
  assert.deepEqual(mesh.position.toArray(), [0, 1.3, -2]);
  prepareIronVanguardBallVisuals(state, refs, mesh, 0.3);
  finishIronVanguardBallVisuals(state, refs, mesh, 0.3);
  assert.equal(mesh.userData.ironVanguardBallVisual.release, undefined);
  assert.equal(refs.playerSword!.visible, false);
});

test("bot charge and throw share the same pose path; drops and final-frame deaths do not throw", () => {
  for (const outcome of ["thrown", "loose", "dead"] as const) {
    const { state, refs, mesh, hold } = setup();
    const bot = createIronVanguardModel(200, false, body);
    state.otherPlayers.set("main_ai", {
      hp: 1,
      weaponState: "ready",
      grifballPassCharge: 0,
    } as any);
    refs.otherPlayerMeshes.set("main_ai", {
      group: bot,
      hammer: bot.userData.ironVanguardHammer,
      sword: new THREE.Group(),
    } as any);
    hold("main_ai", 0.8);
    assert.equal(bot.userData.ironVanguardBallPhase, "charge");
    Object.assign(state.grifball.ball, {
      state: outcome === "dead" ? "loose" : outcome,
      holderId: null,
    });
    updateV3GameplayBall(state, refs, mesh, 0, "v2");
    assert.equal(
      mesh.getObjectByName("v3SkullBomb")?.visible,
      true,
      "bot release/drop retains the skull in a mixed-model match",
    );
    if (outcome === "dead") state.otherPlayers.get("main_ai")!.hp = 0;
    else prepareIronVanguardBallVisuals(state, refs, mesh, 0.016);
    finishIronVanguardBallVisuals(state, refs, mesh, 0.016);
    assert.equal(bot.userData.ironVanguard.ball.visible, false);
    assert.equal(
      Boolean(mesh.userData.ironVanguardBallVisual.release),
      outcome === "thrown",
    );
    if (outcome === "thrown") {
      animateIronVanguard(bot, { ...ready, dt: 0, activeWeapon: "hammer" });
      assert.equal(bot.userData.ironVanguardBallPhase, "release");
    }
  }
});

test("new possession and sword attacks interrupt throw follow-through; camera arms can return to sword", () => {
  for (const interrupt of ["catch", "sword", "death", "round"] as const) {
    const { state, refs, mesh, hold } = setup();
    hold("player", 1);
    Object.assign(state.grifball.ball, { state: "thrown", holderId: null });
    state.activeWeapon = "hammer";
    prepareIronVanguardBallVisuals(state, refs, mesh, 0);
    if (interrupt === "catch")
      Object.assign(state.grifball.ball, { state: "held", holderId: "player" });
    if (interrupt === "sword") {
      state.activeWeapon = "sword";
      state.pSwordState = "slashing";
    }
    if (interrupt === "death") state.playerHP = 0;
    if (interrupt === "round") state.grifball.phase = "countdown";
    prepareIronVanguardBallVisuals(state, refs, mesh, 0.016);
    assert.equal(mesh.userData.ironVanguardBallVisual.release, undefined);
    assert.equal(refs.hostGroup!.userData.vanguardBallThrowTime, undefined);
    animateVanguardBallView(refs.playerSword!, { ...ready, dt: 0 });
    animateVanguardSwordView(refs.playerSword!, { ...ready, dt: 0 });
    assert.ok(refs.playerSword!.userData.swordProp.visible);
    assert.equal(refs.playerSword!.userData.ironVanguard.ball.visible, false);
  }
});

test("real scripted AI pass drives charge, one release, and the Vanguard follow-through", async () => {
  const { defaultGrifballTactics } =
    await import("../../game/grifballTacticsConfig");
  const { updateGrifballTeamPlanForState } =
    await import("../grifball/grifballTeamPlanRuntime");
  const { tickScriptedGrifballPassForState } =
    await import("../grifball/grifballObjectiveRuntime");
  for (const id of ["main_ai", "bot_2"]) {
    const { state, refs, mesh } = setup();
    state.settings = { ...state.settings, gameMode: "grifball" };
    state.isObserverMode = true;
    state.arenaRadius = 60;
    for (const [key, x, team] of [
      [id, -20, "blue"],
      ["receiver", -8, "blue"],
      ["enemy", -45, "red"],
    ] as const) {
      state.otherPlayers.set(key, {
        id: key,
        playerName: key,
        controller: "ai",
        difficulty: "normal",
        team,
        pos: new THREE.Vector3(x, 0, key === "enemy" ? 18 : 0),
        vel: new THREE.Vector3(),
        yaw: 0,
        hp: 1,
        maxHp: 1,
        isCrouching: false,
        activeWeapon: key === id ? "ball" : "hammer",
        weaponState: "ready",
        respawnTimer: 0,
        hue: 0,
        score: 0,
        kills: 0,
        deaths: 0,
      });
    }
    Object.assign(state.grifball.ball, { state: "held", holderId: id });
    state.grifballTactics = defaultGrifballTactics();
    updateGrifballTeamPlanForState(state, 0.2, (team) => ({
      x: team === "blue" ? 47 : -47,
      z: 0,
    }));
    const pass =
      state.aiMatchContext.grifballTeamPlan.assignments.get(id)!.pass!;
    const selected = pass.candidates.find(
      (c) => c.viable && c.chargeSeconds > 0,
    )!;
    assert.ok(selected);
    pass.selected = selected;
    const model = createIronVanguardModel(200, false, body);
    refs.otherPlayerMeshes.set(id, { group: model } as any);
    assert.equal(
      tickScriptedGrifballPassForState(state, refs, selected.chargeSeconds / 2),
      false,
    );
    prepareIronVanguardBallVisuals(state, refs, mesh, 0);
    animateIronVanguard(model, { ...ready, dt: 0, activeWeapon: "ball" });
    assert.equal(model.userData.ironVanguardBallPhase, "charge");
    const normalizedCharge =
      selected.chargeSeconds / 2 / state.settings.grifballChargeMax!;
    assert.ok(
      Math.abs(
        state.otherPlayers.get(id)!.grifballPassCharge! - normalizedCharge,
      ) < 1e-8,
    );
    assert.equal(
      model.userData.vanguardBallCharge,
      state.otherPlayers.get(id)!.grifballPassCharge,
    );
    const pose = sampleVanguardBall({
      ...ready,
      ballCharge: model.userData.vanguardBallCharge,
    });
    assert.ok(Math.abs(pose.torsoYaw + 1.05 * normalizedCharge) < 1e-8);
    const finalCharge =
      selected.chargeSeconds / state.settings.grifballChargeMax!;
    assert.ok(
      Math.abs(
        selected.speed -
          (state.settings.grifballPassSpeedMin! +
            finalCharge *
              (state.settings.grifballPassSpeedMax! -
                state.settings.grifballPassSpeedMin!)),
      ) < 1e-8,
      "bot's visible charging time represents the planned launch speed",
    );
    assert.equal(
      tickScriptedGrifballPassForState(state, refs, selected.chargeSeconds / 2),
      true,
    );
    prepareIronVanguardBallVisuals(state, refs, mesh, 0);
    animateIronVanguard(model, {
      ...ready,
      dt: 0,
      activeWeapon: state.otherPlayers.get(id)!.activeWeapon,
    });
    assert.equal(model.userData.ironVanguardBallPhase, "release");
    assert.equal(model.userData.ironVanguard.ball.visible, false);
    assert.equal(state.grifball.ball.state, "thrown");
    const velocity = { ...state.grifball.ball.vel };
    assert.equal(tickScriptedGrifballPassForState(state, refs, 0.2), false);
    prepareIronVanguardBallVisuals(state, refs, mesh, 0.2);
    animateIronVanguard(model, { ...ready, dt: 0, activeWeapon: "hammer" });
    assert.equal(model.userData.ironVanguardBallPhase, "follow-through");
    assert.deepEqual(state.grifball.ball.vel, velocity);
  }
});
