import type { VanguardBallInput } from "./ironVanguardBall";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  createIronVanguardModel,
  animateIronVanguard,
} from "./ironVanguardModel";
import {
  applyVanguardSword,
  updateVanguardSwordLunge,
  sampleVanguardSword,
  attachVanguardSword,
  createVanguardSword,
  type VanguardSwordInput,
} from "./ironVanguardSword";

/** A compact, instance-owned arm mesh. The cached full-body geometry stays intact. */
export function createVanguardArmGeometry(mesh: THREE.SkinnedMesh) {
  const source = mesh.geometry;
  const joints = source.getAttribute("skinIndex");
  const weights = source.getAttribute("skinWeight");
  const armBones = new Set(
    mesh.skeleton.bones.flatMap((bone, index) =>
      /^(Right|Left)(Arm|ForeArm|Hand)$|^DEF_(Thumb|Index|Middle|Ring|Pinky)_/.test(
        bone.name,
      )
        ? [index]
        : [],
    ),
  );
  const isArm = (index: number) => {
    let weight = 0;
    for (let component = 0; component < 4; component++)
      if (armBones.has(joints.getComponent(index, component)))
        weight += weights.getComponent(index, component);
    return weight > 0.5;
  };
  const vertexMap = new Map<number, number>();
  const indices: number[] = [];
  const count = source.index?.count ?? source.getAttribute("position").count;
  for (let i = 0; i < count; i += 3) {
    const triangle = [0, 1, 2].map(
      (offset) => source.index?.getX(i + offset) ?? i + offset,
    );
    if (!triangle.every(isArm)) continue;
    for (const index of triangle) {
      if (!vertexMap.has(index)) vertexMap.set(index, vertexMap.size);
      indices.push(vertexMap.get(index)!);
    }
  }
  const geometry = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv", "skinIndex", "skinWeight"]) {
    const attribute = source.getAttribute(name);
    if (!attribute) continue;
    const values: number[] = [];
    for (const index of vertexMap.keys())
      for (let component = 0; component < attribute.itemSize; component++)
        values.push(attribute.getComponent(index, component));
    geometry.setAttribute(
      name,
      name === "skinIndex"
        ? new THREE.Uint16BufferAttribute(values, attribute.itemSize)
        : new THREE.Float32BufferAttribute(values, attribute.itemSize),
    );
  }
  geometry.setIndex(indices);
  return geometry;
}

type ViewInput = VanguardSwordInput & { dt?: number; previewTime?: number };

export function createVanguardSwordView(hue = 200, body?: GLTF, prop?: GLTF) {
  const root = createIronVanguardModel(hue, false, body);
  root.name = "Iron Vanguard first-person sword and arms";
  root.userData.ironVanguardSword = true;
  root.userData.ironVanguardSwordView = true;
  const sword = createVanguardSword(prop);
  attachVanguardSword(root, sword);
  root.userData.swordProp = sword;
  root.userData.swordViewPose = {
    input: { weaponState: "ready", weaponTimer: 0 },
    bob: [0, 0, 0],
  };
  const prepare = () => {
    const runtime = root.userData.ironVanguard;
    if (runtime.disposed || !runtime.body) return;
    runtime.body.geometry = createVanguardArmGeometry(runtime.body);
    runtime.body.userData.ironVanguardSharedGeometry = false;
    runtime.body.updateMorphTargets();
    runtime.hammer.visible = false;
    root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = false;
        object.receiveShadow = false;
      }
    });
    root.userData.swordViewReady = true;
    const { input, bob } = root.userData.swordViewPose;
    animateVanguardSwordView(root, input, bob);
  };
  if (root.userData.assetStatus === "ready") prepare();
  root.userData.assetReady = Promise.all([
    root.userData.assetReady,
    sword.userData.assetReady,
  ]).then(() => {
    if (!root.userData.swordViewReady) prepare();
    sword.traverse((object) => {
      if (object instanceof THREE.Mesh)
        object.castShadow = object.receiveShadow = false;
    });
  });
  return root;
}

/** Camera-local arm rig; gameplay still owns the slash impact and recovery clocks. */
export function animateVanguardSwordView(
  root: THREE.Group,
  input: ViewInput,
  bob = [0, 0, 0],
) {
  root.userData.vanguardBallViewActive = false;
  root.userData.swordProp.visible = true;
  if (root.userData.ironVanguard.ball)
    root.userData.ironVanguard.ball.visible = false;
  root.userData.swordViewPose = { input, bob };
  root.userData.ironVanguardSwordPhase = sampleVanguardSword(input).phase;
  const runtime = root.userData.ironVanguard;
  if (!root.userData.swordViewReady || runtime.disposed) return;
  // Keep the ready hold fixed in camera space; only attacks move the view rig.
  root.position.set(-0.05, -1.95, -0.32);
  root.rotation.set(0, 0, 0);
  updateVanguardSwordLunge(runtime.sword, {
    ...input,
    dt: input.dt ?? 0,
    lungeTime:
      input.lungeTime ?? (input.isLunging ? input.weaponTimer : undefined),
  });
  const viewTravel = applyVanguardSword(
    runtime.facingFrame,
    runtime.bones,
    runtime.sword,
    {
      ...input,
      dt: input.dt ?? 0,
      lungeTime:
        input.lungeTime ?? (input.isLunging ? input.weaponTimer : undefined),
      // Freeze the underlying idle pose without stopping slash/lunge clocks.
      previewTime: 0,
      localRecovery: input.localRecovery ?? true,
      viewHandOffset: new THREE.Vector3(0, 0.51, -0.02),
    },
  );
  if (viewTravel)
    root.position.add(viewTravel.applyQuaternion(root.quaternion));
  root.updateWorldMatrix(true, true);
  const hand = runtime.bones.RightHand as THREE.Object3D;
  const socket = root.userData.ironVanguardSwordGrip as THREE.Group;
  socket.position.copy(
    root.worldToLocal(hand.getWorldPosition(new THREE.Vector3())),
  );
  socket.quaternion.copy(
    root
      .getWorldQuaternion(new THREE.Quaternion())
      .invert()
      .multiply(hand.getWorldQuaternion(new THREE.Quaternion())),
  );
  root.userData.ironVanguardSwordPhase =
    runtime.facingFrame.userData.ironVanguardSwordPhase;
  root.updateWorldMatrix(false, true);
}

/** Shared camera arm rig, with the sword hidden while carrying or releasing the ball. */
export function animateVanguardBallView(
  root: THREE.Group,
  input: VanguardBallInput & { dt: number },
) {
  if (!root.userData.swordViewReady) return;
  root.userData.vanguardBallViewActive = true;
  root.userData.swordProp.visible = false;
  // The camera is above and ahead of the shoulders, so the arms enter from below.
  root.position.set(0, -1.85, -0.22);
  root.rotation.set(0, 0, 0);
  animateIronVanguard(root, {
    ...input,
    activeWeapon: "ball",
    ballView: true,
    previewClip: "idle",
    previewTime: input.previewTime ?? 0,
  });
  root.userData.ironVanguard.hammer.visible = false;
  if (root.userData.ironVanguard.ball)
    root.userData.ironVanguard.ball.castShadow = false;
}
