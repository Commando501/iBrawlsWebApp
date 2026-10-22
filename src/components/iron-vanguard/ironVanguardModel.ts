import {
  applyVanguardBall,
  createVanguardBallProp,
  syncVanguardBallProp,
} from "./ironVanguardBall";
import {
  applyVanguardSword,
  updateVanguardSwordLunge,
  vanguardLungeBodyWeight,
  createVanguardSwordState,
  type VanguardSwordState,
} from "./ironVanguardSword";
import {
  updateVanguardFacing,
  applyVanguardTurnFeet,
  applyVanguardAim,
} from "./ironVanguardFacing";
import {
  applyVanguardMovement,
  createVanguardMovementState,
  type VanguardMovementState,
} from "./ironVanguardMovement";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { UniversalSettings } from "../../types";
import type { CharacterLoadout } from "../VoxelModels";
import type { CombatantRig, CombatantBoneName } from "../grifball/combatantRig";
import { getCombatantTeamArmorState } from "../grifball/combatantTeamArmor";
import { ironVanguardSourceFrame } from "../../game/ironVanguardTiming";

export const IRON_VANGUARD_ASSET_URL = "/assets/iron-vanguard/hammer-v018.glb";
// Deliberately wider than the complete animated body/hammer envelope. Bind-pose
// bounds are unsafe for skinned meshes; this also covers procedural limb motion.
const IRON_VANGUARD_CULL_RADIUS = 6;
export const isIronVanguardLoadout = (loadout?: CharacterLoadout) =>
  loadout?.characterAsset === "iron-vanguard";
let asset: GLTF | undefined;
let pending: Promise<GLTF> | undefined;
export function preloadIronVanguard(): Promise<GLTF> {
  if (asset) return Promise.resolve(asset);
  return (pending ??= new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(IRON_VANGUARD_ASSET_URL)
    .then((value) => {
      validateAsset(value);
      asset = value;
      return value;
    })
    .catch((error) => {
      pending = undefined;
      throw error;
    }));
}
function validateAsset(value: GLTF) {
  if (
    value.animations.length !== 1 ||
    Math.abs(value.animations[0].duration - 70 / 30) > 0.001
  )
    throw new Error("Iron Vanguard animation is missing or incompatible.");
  for (const name of [
    "IV_TransferBody_ShoulderFix",
    "IV_TransferHammer",
    "Hips",
    "LeftHand",
    "RightHand",
    "weapon_hammer_tip",
  ]) {
    if (!value.scene.getObjectByName(name))
      throw new Error(`Iron Vanguard is missing ${name}.`);
  }
}
interface Runtime {
  disposed: boolean;
  firstPerson: boolean;
  firstPersonHoldRotation: THREE.Quaternion;
  hue: number;
  hammer: THREE.Group;
  scene?: THREE.Group;
  facingFrame: THREE.Group;
  mixer?: THREE.AnimationMixer;
  action?: THREE.AnimationAction;
  bones: Record<string, THREE.Object3D>;
  body?: THREE.SkinnedMesh;
  weapon?: THREE.SkinnedMesh;
  movement: VanguardMovementState;
  sword: VanguardSwordState;
  ball?: THREE.Group;
  authoredMorphs?: number[];
  authoredFrame?: number;
  proxies: Record<string, THREE.Group>;
  restHand: THREE.Quaternion;
  restLeftHand: THREE.Quaternion;
  authoredRotations: Map<
    THREE.Object3D,
    {
      position: THREE.Vector3;
      rotation: THREE.Quaternion;
      scale: THREE.Vector3;
    }
  >;
}
export function isIronVanguardModel(root?: THREE.Object3D | null): boolean {
  return root?.userData.characterAsset === "iron-vanguard";
}

/** Synchronous shell fits existing model factories; the shared asset loads once. */
export function createIronVanguardModel(
  hue = 200,
  firstPerson = false,
  source?: GLTF,
): THREE.Group {
  const root = new THREE.Group();
  root.name = firstPerson
    ? "Iron Vanguard first-person hammer"
    : "Iron Vanguard";
  root.userData.characterAsset = "iron-vanguard";
  root.userData.modelSystem = "v2";
  root.userData.modelType = "medium";
  const hammer = new THREE.Group();
  hammer.name = "Iron Vanguard hammer visibility";
  hammer.userData.characterAsset = "iron-vanguard";
  root.add(hammer);
  const facingFrame = new THREE.Group();
  facingFrame.name = "Iron Vanguard visual heading";
  root.add(facingFrame);
  const runtime: Runtime = {
    facingFrame,
    disposed: false,
    firstPerson,
    firstPersonHoldRotation: new THREE.Quaternion(),
    hue,
    hammer,
    bones: {},
    movement: createVanguardMovementState(),
    sword: createVanguardSwordState(),
    proxies: {},
    restHand: new THREE.Quaternion(),
    restLeftHand: new THREE.Quaternion(),
    authoredRotations: new Map(),
  };
  root.userData.ironVanguard = runtime;
  root.userData.ironVanguardHammer = hammer;
  const boneNames = [
    "lowerTorso",
    "upperTorso",
    "head",
    "leftArm",
    "rightArm",
    "leftLeg",
    "rightLeg",
  ] as const;
  for (const name of boneNames) {
    const proxy = new THREE.Group();
    proxy.name = `iron-vanguard:${name}`;
    root.add(proxy);
    runtime.proxies[name] = proxy;
    root.userData[name] = proxy;
  }
  const rightGrip = new THREE.Group();
  const leftGrip = new THREE.Group();
  const swordGrip = new THREE.Group();
  swordGrip.name = "Iron Vanguard sword hand socket";
  root.add(rightGrip, leftGrip, swordGrip);
  runtime.proxies.swordGrip = swordGrip;
  root.userData.ironVanguardSwordGrip = swordGrip;
  runtime.proxies.rightGrip = rightGrip;
  runtime.proxies.leftGrip = leftGrip;
  const bones = {
    root,
    ...Object.fromEntries(
      boneNames.map((name) => [name, runtime.proxies[name]]),
    ),
  } as Record<CombatantBoneName, THREE.Group>;
  const rig: CombatantRig = {
    root,
    bones,
    segmentGroups: runtime.proxies as CombatantRig["segmentGroups"],
    attachments: {
      thirdPersonWeaponGrip: {
        name: "thirdPersonWeaponGrip",
        bone: "rightArm",
        group: rightGrip,
      },
      thirdPersonOffhandGrip: {
        name: "thirdPersonOffhandGrip",
        bone: "leftArm",
        group: leftGrip,
      },
      rightHandGrip: {
        name: "rightHandGrip",
        bone: "rightArm",
        group: rightGrip,
      },
      leftHandGrip: { name: "leftHandGrip", bone: "leftArm", group: leftGrip },
      headCenter: { name: "headCenter", bone: "head", group: bones.head },
      chestCenter: {
        name: "chestCenter",
        bone: "upperTorso",
        group: bones.upperTorso,
      },
    },
  };
  root.userData.combatantRig = rig;
  root.userData.disposeIronVanguard = () => disposeIronVanguard(root);
  root.addEventListener("removed", root.userData.disposeIronVanguard);
  const ready = (value: GLTF) => {
    if (!runtime.disposed) attachAsset(root, value);
  };
  if (source ?? asset) ready((source ?? asset)!);
  else if (typeof window !== "undefined") {
    root.userData.assetStatus = "loading";
    root.userData.assetReady = preloadIronVanguard()
      .then(ready)
      .catch((error) => {
        root.userData.assetStatus = "error";
        root.userData.assetError = String(error);
        console.error("Could not load Iron Vanguard", error);
      });
  }
  return root;
}
function attachAsset(root: THREE.Group, value: GLTF) {
  validateAsset(value);
  const runtime = root.userData.ironVanguard as Runtime;
  const model = clone(value.scene) as THREE.Group;
  runtime.scene = model;
  runtime.facingFrame.add(model);
  model.traverse((object) => {
    if (object instanceof THREE.Bone) runtime.bones[object.name] = object;
    if (object instanceof THREE.Mesh) {
      // Cache owns geometry/morph buffers; instances own materials and skeletons.
      object.userData.ironVanguardSharedGeometry = true;
      object.material = Array.isArray(object.material)
        ? object.material.map((m) => m.clone())
        : object.material.clone();
      object.frustumCulled = false;
      object.castShadow = !runtime.firstPerson;
      object.receiveShadow = !runtime.firstPerson;
    }
  });
  runtime.body = model.getObjectByName(
    "IV_TransferBody_ShoulderFix",
  ) as THREE.SkinnedMesh;
  runtime.weapon = model.getObjectByName(
    "IV_TransferHammer",
  ) as THREE.SkinnedMesh;
  runtime.weapon.userData.ironVanguardWeapon = true;
  runtime.body.visible = !runtime.firstPerson;
  (runtime.body.material as THREE.MeshStandardMaterial).color.setHSL(
    runtime.hue / 360,
    0.55,
    0.43,
  );
  root.userData.teamArmorSources = runtime.firstPerson ? [] : [runtime.body];
  const armor =
    root instanceof THREE.Group ? getCombatantTeamArmorState(root) : null;
  if (armor && !runtime.firstPerson) {
    armor.meshes.push({
      source: runtime.body,
      originalMaterial: runtime.body.material,
    });
    runtime.body.material = armor.material;
    runtime.body.userData.teamArmorMesh = true;
  }
  let hammerVisible = runtime.hammer.visible;
  Object.defineProperty(runtime.hammer, "visible", {
    configurable: true,
    get: () => hammerVisible,
    set: (visible: boolean) => {
      hammerVisible = visible;
      runtime.weapon!.visible = visible;
    },
  });
  runtime.hammer.visible = hammerVisible;
  runtime.mixer = new THREE.AnimationMixer(model);
  runtime.action = runtime.mixer.clipAction(value.animations[0]);
  runtime.action.setLoop(THREE.LoopOnce, 1);
  runtime.action.clampWhenFinished = true;
  runtime.action.play();
  seek(root, 0);
  if (!runtime.firstPerson) {
    model.traverse(object => {
      if (!(object instanceof THREE.SkinnedMesh)) return;
      const rootToMesh = object.matrixWorld.clone().invert().multiply(root.matrixWorld);
      object.boundingSphere = new THREE.Sphere(new THREE.Vector3(), IRON_VANGUARD_CULL_RADIUS)
        .applyMatrix4(rootToMesh);
      object.frustumCulled = true;
    });
  }
  if (runtime.firstPerson) {
    const handle = runtime.bones.weapon_hammer.getWorldPosition(new THREE.Vector3());
    const head = runtime.bones.weapon_hammer_tip.getWorldPosition(new THREE.Vector3());
    const axis = root.worldToLocal(head).sub(root.worldToLocal(handle)).normalize();
    runtime.firstPersonHoldRotation.setFromUnitVectors(axis, new THREE.Vector3(0, 1, 0));
  }
  runtime.restHand
    .copy(localBoneQuaternion(root, runtime.bones.RightHand))
    .invert();
  runtime.restLeftHand
    .copy(localBoneQuaternion(root, runtime.bones.LeftHand))
    .invert();
  syncIronVanguardProxies(root);
  root.userData.assetStatus = "ready";
}
const worldPosition = new THREE.Vector3();
const rootQuaternion = new THREE.Quaternion();
const proxyRootInverse = new THREE.Matrix4();
const proxyBoneQuaternion = new THREE.Quaternion();
const proxyScale = new THREE.Vector3();
const PROXY_BONE_NAMES = [
  ["lowerTorso", "Hips"],
  ["upperTorso", "Spine"],
  ["head", "neck"],
  ["leftArm", "LeftArm"],
  ["rightArm", "RightArm"],
  ["leftLeg", "LeftUpLeg"],
  ["rightLeg", "RightUpLeg"],
  ["swordGrip", "RightHand"],
  ["rightGrip", "RightHand"],
  ["leftGrip", "LeftHand"],
] as const;
function localBoneQuaternion(
  root: THREE.Group,
  bone: THREE.Object3D,
): THREE.Quaternion {
  return root
    .getWorldQuaternion(rootQuaternion)
    .invert()
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
}
export function syncIronVanguardProxies(root: THREE.Group) {
  const runtime = root.userData.ironVanguard as Runtime;
  // The imported skeleton and these root-level proxy sockets are separate
  // subtrees. Refresh both once; writing a proxy cannot change a source bone.
  root.updateWorldMatrix(true, true);
  proxyRootInverse.copy(root.matrixWorld).invert();
  root.matrixWorld.decompose(worldPosition, rootQuaternion, proxyScale);
  rootQuaternion.invert();
  for (const [proxyName, boneName] of PROXY_BONE_NAMES) {
    const bone = runtime.bones[boneName];
    if (!bone) continue;
    const proxy = runtime.proxies[proxyName];
    proxy.position.copy(worldPosition.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(proxyRootInverse));
    // Match getWorldQuaternion's decomposition rather than decomposing the local
    // matrix: the former also preserves existing nonuniform/reflected-scale math.
    bone.matrixWorld.decompose(worldPosition, proxyBoneQuaternion, proxyScale);
    proxy.quaternion.copy(rootQuaternion).multiply(proxyBoneQuaternion);
    if (proxyName === "rightGrip") proxy.quaternion.multiply(runtime.restHand);
    if (proxyName === "leftGrip")
      proxy.quaternion.multiply(runtime.restLeftHand);
  }
}
function seek(root: THREE.Group, frame: number, refreshWorld = true) {
  const runtime = root.userData.ironVanguard as Runtime;
  if (!runtime.action) return;
  // Three's mixer may skip identical values. Restore the last authored pose before
  // applying another procedural layer, otherwise idle-frame rotations accumulate.
  for (const [bone, pose] of runtime.authoredRotations) {
    bone.position.copy(pose.position);
    bone.quaternion.copy(pose.rotation);
    bone.scale.copy(pose.scale);
  }
  if (runtime.authoredMorphs && runtime.body?.morphTargetInfluences)
    runtime.body.morphTargetInfluences.splice(
      0,
      runtime.authoredMorphs.length,
      ...runtime.authoredMorphs,
    );
  // Idle and locomotion reuse frame zero. The restored pose is already the
  // mixer's exact result; only a different source frame needs sampling again.
  // Procedural movement, aim, and weapon layers still run on every render.
  if (runtime.authoredFrame !== frame) {
    runtime.action.paused = false;
    runtime.action.enabled = true;
    runtime.mixer!.setTime(frame / 30);
    runtime.authoredMorphs = runtime.body?.morphTargetInfluences?.slice();
    for (const bone of Object.values(runtime.bones)) {
      const pose = runtime.authoredRotations.get(bone) ?? {
        position: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        scale: new THREE.Vector3(),
      };
      pose.position.copy(bone.position);
      pose.rotation.copy(bone.quaternion);
      pose.scale.copy(bone.scale);
      runtime.authoredRotations.set(bone, pose);
    }
    runtime.authoredFrame = frame;
  }
  if (refreshWorld) root.updateWorldMatrix(true, true);
  root.userData.ironVanguardSourceFrame = frame;
}
function rotateInCharacterSpace(
  root: THREE.Group,
  bone: THREE.Object3D | undefined,
  angle: number,
  axis = new THREE.Vector3(1, 0, 0),
) {
  if (!bone?.parent) return;
  root.getWorldQuaternion(rootQuaternion);
  const parentRotation = bone.parent
    .getWorldQuaternion(new THREE.Quaternion())
    .invert();
  axis.applyQuaternion(rootQuaternion).applyQuaternion(parentRotation);
  bone.quaternion.premultiply(
    new THREE.Quaternion().setFromAxisAngle(axis.normalize(), angle),
  );
  bone.updateWorldMatrix(false, true);
}
export function animateIronVanguard(
  root: THREE.Group,
  input: {
    activeWeapon?: string;
    weaponState: string;
    weaponTimer: number;
    dt: number;
    vel?: THREE.Vector3;
    hp?: number;
    isCrouching?: boolean;
    isSliding?: boolean;
    isSprinting?: boolean;
    isJumping?: boolean;
    isLunging?: boolean;
    lungeTime?: number;
    lungeReleaseTime?: number;
    lungeHit?: boolean;
    localRecovery?: boolean;
    yaw?: number;
    lookPitch?: number;
    ballCharge?: number;
    ballThrowTime?: number;
    ballReleaseCharge?: number;
    ballView?: boolean;
    previewClip?: string;
    previewTime?: number;
    settings?: Partial<UniversalSettings>;
  },
): boolean {
  const runtime = root.userData.ironVanguard as Runtime | undefined;
  if (!runtime || runtime.disposed) return false;
  const activeWeapon = input.activeWeapon ?? "hammer";
  const frame =
    activeWeapon === "hammer"
      ? ironVanguardSourceFrame(
          input.weaponState,
          input.weaponTimer,
          input.settings,
        )
      : 0;
  seek(root, frame, runtime.firstPerson);
  if (!runtime.scene) return true;
  runtime.hammer.visible = activeWeapon === "hammer";
  if (runtime.firstPerson) {
    // Park the heavy head beside the sightline; ease back onto the authored
    // attack path during wind-up, then settle into the side hold on recovery.
    const holdWeight =
      1 - THREE.MathUtils.smoothstep(frame, 0, 24) +
      THREE.MathUtils.smoothstep(frame, 42, 70);
    // Straighten the handle around its head so the upright hold retains its
    // right-side framing. The authored third-person skeleton stays untouched.
    root.worldToLocal(runtime.bones.weapon_hammer_tip.getWorldPosition(worldPosition));
    root.quaternion.identity().slerp(runtime.firstPersonHoldRotation, holdWeight);
    root.position.set(0.45 + 0.30 * holdWeight, -1.65 - 0.12 * holdWeight, -0.4);
    root.position.add(worldPosition);
    root.position.sub(worldPosition.applyQuaternion(root.quaternion));
    root.scale.setScalar(1);
    return true;
  }
  root.scale.y = 1;
  if (activeWeapon === "sword") updateVanguardSwordLunge(runtime.sword, input);
  const lungeBlend =
    activeWeapon === "sword" ? vanguardLungeBodyWeight(runtime.sword) : 0;
  const bodyYaw = updateVanguardFacing(root, runtime.movement, {
    ...input,
    isSliding: input.isSliding || lungeBlend > 0.01,
  });
  runtime.facingFrame.rotation.y = bodyYaw - (input.yaw ?? 0);
  applyVanguardMovement(runtime.facingFrame, runtime.bones, runtime.movement, {
    ...input,
    yaw: bodyYaw,
    lungeBlend,
    activeWeapon,
  });
  const ballThrowTime =
    input.ballThrowTime ?? root.userData.vanguardBallThrowTime;
  const ballActive =
    (input.hp ?? 100) > 0 &&
    (activeWeapon === "ball" || ballThrowTime !== undefined);
  if (ballActive) {
    runtime.body?.morphTargetInfluences?.fill(0);
    applyVanguardBall(runtime.facingFrame, runtime.bones, {
      ...input,
      ballCharge: input.ballCharge ?? root.userData.vanguardBallCharge,
      ballThrowTime,
      ballReleaseCharge:
        input.ballReleaseCharge ?? root.userData.vanguardBallReleaseCharge,
    });
    root.userData.ironVanguardBallPhase =
      runtime.facingFrame.userData.ironVanguardBallPhase;
  }
  if (activeWeapon === "sword" && !ballActive) {
    runtime.body?.morphTargetInfluences?.fill(0);
    applyVanguardSword(
      runtime.facingFrame,
      runtime.bones,
      runtime.sword,
      input,
    );
    root.userData.ironVanguardSwordPhase =
      runtime.facingFrame.userData.ironVanguardSwordPhase;
  } else {
    runtime.sword.lungeWeight = 0;
    runtime.sword.wasLunging = false;
    runtime.sword.lungeRecovery = false;
    runtime.sword.lungeContact = false;
    runtime.sword.lungeArmPose = undefined;
  }
  if (!input.previewClip && (input.hp ?? 100) > 0 && lungeBlend < 0.01)
    applyVanguardTurnFeet(
      runtime.facingFrame,
      runtime.bones,
      runtime.movement.facing,
    );
  applyVanguardAim(
    runtime.facingFrame,
    runtime.bones,
    runtime.movement.facing,
    (input.hp ?? 100) > 0 ? (input.lookPitch ?? 0) : 0,
  );
  for (const key of [
    "ironVanguardMovement",
    "ironVanguardMovementTime",
    "ironVanguardRecoveryBlend",
    "ironVanguardLandingBlend",
    "ironVanguardLungeBlend",
    "ironVanguardSupportPlanted",
  ])
    root.userData[key] = runtime.facingFrame.userData[key];
  if (activeWeapon === "pistol") {
    // Pistol carry remains provisional.
    rotateInCharacterSpace(root, runtime.bones.LeftArm, -0.6);
    if (input.weaponState !== "ready")
      rotateInCharacterSpace(
        root,
        runtime.bones.RightArm,
        -0.45 * Math.sin(Math.min(1, input.weaponTimer / 0.3) * Math.PI),
      );
  }
  if (ballActive && !runtime.ball) {
    runtime.ball = createVanguardBallProp();
    root.add(runtime.ball);
  }
  if (runtime.ball) {
    runtime.ball.visible =
      ballActive && activeWeapon === "ball" && ballThrowTime === undefined;
    if (ballActive)
      syncVanguardBallProp(root, runtime.bones.RightHand, runtime.ball);
  }
  syncIronVanguardProxies(root);
  return true;
}
export function disposeIronVanguard(root: THREE.Object3D) {
  const runtime = root.userData.ironVanguard as Runtime | undefined;
  if (!runtime || runtime.disposed) return;
  runtime.disposed = true;
  runtime.mixer?.stopAllAction();
  if (runtime.scene) runtime.mixer?.uncacheRoot(runtime.scene);
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  runtime.scene?.traverse((object) => {
    if (object instanceof THREE.Mesh)
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).forEach((m) => materials.add(m));
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  // Secondary weapons and effects are instance-owned, unlike the cached GLB geometry.
  root.traverse((object) => {
    if (object.userData.ironVanguardSword) object.userData.disposed = true;
    if (
      object instanceof THREE.Mesh &&
      !object.userData.ironVanguardSharedGeometry
    ) {
      object.geometry.dispose();
      (Array.isArray(object.material)
        ? object.material
        : [object.material]
      ).forEach((m) => materials.add(m));
    }
  });
  const armor =
    root instanceof THREE.Group ? getCombatantTeamArmorState(root) : null;
  if (armor) materials.add(armor.material);
  for (const item of armor?.meshes ?? [])
    (Array.isArray(item.originalMaterial)
      ? item.originalMaterial
      : [item.originalMaterial]
    ).forEach((m) => materials.add(m));
  for (const material of materials) material.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
}
export function disposeIronVanguardScene(scene: THREE.Object3D | null) {
  scene?.traverse((object) => {
    if (object.userData.ironVanguard) disposeIronVanguard(object);
  });
}
