import * as THREE from 'three';
import type { V3CharacterSlotId } from './v3ModelTypes';

export type V3UpperBodyJointBridgeId =
  | 'torsoCore'
  | 'upperYoke'
  | 'backCollar'
  | 'scapulaLeft'
  | 'scapulaRight'
  | 'neckColumn'
  | 'clavicleLeft'
  | 'clavicleRight'
  | 'shoulderSleeveLeft'
  | 'shoulderSleeveRight'
  | 'armpitLeft'
  | 'armpitRight';

export interface V3UpperBodyJointBridgeSet {
  root: THREE.Group;
  bridges: Record<V3UpperBodyJointBridgeId, THREE.Mesh>;
}

const BRIDGE_IDS: readonly V3UpperBodyJointBridgeId[] = [
  'torsoCore',
  'upperYoke',
  'backCollar',
  'scapulaLeft',
  'scapulaRight',
  'neckColumn',
  'clavicleLeft',
  'clavicleRight',
  'shoulderSleeveLeft',
  'shoulderSleeveRight',
  'armpitLeft',
  'armpitRight',
];

const UNDERSUIT_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#3a4b5d',
  roughness: 0.85,
  metalness: 0.12,
  emissive: '#081b22',
  emissiveIntensity: 0.28,
});

const EMPTY_BOX = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const getPartGroups = (model: THREE.Object3D): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
};

const getSlotObject = (model: THREE.Object3D, slot: V3CharacterSlotId): THREE.Object3D | undefined => {
  const fromPartGroups = getPartGroups(model)[slot];
  if (fromPartGroups instanceof THREE.Object3D) return fromPartGroups;
  const fromUserData = model.userData?.[slot];
  return fromUserData instanceof THREE.Object3D ? fromUserData : undefined;
};

const getObjectBox = (object: THREE.Object3D | undefined): THREE.Box3 => {
  if (!object) return EMPTY_BOX.clone();
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    const position = object.getWorldPosition(new THREE.Vector3());
    return new THREE.Box3(position.clone(), position.clone());
  }
  return box;
};

const makeBridgeMesh = (id: V3UpperBodyJointBridgeId): THREE.Mesh => {
  const geometry = id === 'torsoCore'
    ? new THREE.SphereGeometry(0.5, 14, 8)
    : new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, UNDERSUIT_MATERIAL);
  mesh.name = `v3UpperBodyJointBridge:${id}`;
  mesh.userData.v3UpperBodyJointBridge = true;
  mesh.userData.v3UpperBodyBridgeId = id;
  mesh.scale.set(0, 0, 0);
  mesh.visible = false;
  return mesh;
};

const setBoxBridge = (
  root: THREE.Group,
  mesh: THREE.Mesh,
  centerWorld: THREE.Vector3,
  size: THREE.Vector3
): void => {
  mesh.visible = true;
  mesh.position.copy(root.worldToLocal(centerWorld.clone()));
  mesh.quaternion.identity();
  mesh.scale.set(
    Math.max(0.001, size.x),
    Math.max(0.001, size.y),
    Math.max(0.001, size.z)
  );
};

const setSegmentBridge = (
  root: THREE.Group,
  mesh: THREE.Mesh,
  fromWorld: THREE.Vector3,
  toWorld: THREE.Vector3,
  width: number,
  depth: number
): void => {
  const from = root.worldToLocal(fromWorld.clone());
  const to = root.worldToLocal(toWorld.clone());
  const delta = to.clone().sub(from);
  const length = Math.max(width, delta.length());
  if (length <= 0.0001) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from.add(to).multiplyScalar(0.5));
  mesh.scale.set(width, length, depth);
  mesh.quaternion.setFromUnitVectors(WORLD_UP, delta.normalize());
};

const boxCenter = (box: THREE.Box3): THREE.Vector3 => box.getCenter(new THREE.Vector3());
const boxSize = (box: THREE.Box3): THREE.Vector3 => box.getSize(new THREE.Vector3());

export function createV3UpperBodyJointBridges(): V3UpperBodyJointBridgeSet {
  const root = new THREE.Group();
  root.name = 'v3UpperBodyJointBridges';
  root.userData.v3UpperBodyJointBridges = true;
  root.visible = true;
  const bridges = Object.fromEntries(BRIDGE_IDS.map((id) => {
    const mesh = makeBridgeMesh(id);
    root.add(mesh);
    return [id, mesh];
  })) as Record<V3UpperBodyJointBridgeId, THREE.Mesh>;
  return { root, bridges };
}

export function updateV3UpperBodyJointBridges(model: THREE.Object3D, visible = true): void {
  const bridgeSet = model.userData.v3UpperBodyJointBridges as V3UpperBodyJointBridgeSet | undefined;
  if (!bridgeSet) return;
  bridgeSet.root.visible = visible;
  model.updateMatrixWorld(true);
  bridgeSet.root.updateWorldMatrix(true, false);
  if (!visible) {
    for (const bridge of Object.values(bridgeSet.bridges)) bridge.visible = false;
    return;
  }

  const chestBox = getObjectBox(getSlotObject(model, 'chest'));
  const backBox = getObjectBox(getSlotObject(model, 'back'));
  const neckBox = getObjectBox(getSlotObject(model, 'neck'));
  const shoulderLeftBox = getObjectBox(getSlotObject(model, 'shoulderLeft'));
  const shoulderRightBox = getObjectBox(getSlotObject(model, 'shoulderRight'));
  const upperArmLeftBox = getObjectBox(getSlotObject(model, 'upperArmLeft'));
  const upperArmRightBox = getObjectBox(getSlotObject(model, 'upperArmRight'));
  const chestCenter = boxCenter(chestBox);
  const backCenter = boxCenter(backBox);
  const chestSize = boxSize(chestBox);
  const backSize = boxSize(backBox);
  const inset = Math.min(chestSize.z, backSize.z) * 0.08;
  const torsoTop = Math.min(backBox.max.y - 0.02, neckBox.max.y - 0.035);
  const torsoBottom = chestBox.min.y + chestSize.y * 0.08;
  const torsoMin = new THREE.Vector3(
    chestCenter.x - Math.min(chestSize.x, backSize.x) * 0.26,
    torsoBottom,
    Math.min(chestBox.min.z, backBox.min.z) + inset
  );
  const torsoMax = new THREE.Vector3(
    chestCenter.x + Math.min(chestSize.x, backSize.x) * 0.26,
    Math.max(torsoBottom + 0.12, torsoTop),
    Math.max(chestBox.max.z, backBox.max.z) - inset
  );
  setBoxBridge(
    bridgeSet.root,
    bridgeSet.bridges.torsoCore,
    torsoMin.clone().add(torsoMax).multiplyScalar(0.5),
    torsoMax.clone().sub(torsoMin)
  );

  const upperYokeMaxY = Math.min(neckBox.min.y - 0.014, chestBox.max.y - chestSize.y * 0.02);
  const upperYokeHeight = Math.min(0.085, Math.max(0.055, chestSize.y * 0.28));
  setBoxBridge(
    bridgeSet.root,
    bridgeSet.bridges.upperYoke,
    new THREE.Vector3(
      chestCenter.x,
      upperYokeMaxY - upperYokeHeight * 0.5,
      (chestCenter.z + backCenter.z) * 0.5
    ),
    new THREE.Vector3(
      Math.min(chestSize.x, backSize.x) * 0.55,
      upperYokeHeight,
      Math.max(0.24, Math.min(chestSize.z + backSize.z * 0.22, 0.32))
    )
  );

  const backCollarMinY = neckBox.min.y + 0.015;
  const backCollarMaxY = backBox.max.y - 0.025;
  setBoxBridge(
    bridgeSet.root,
    bridgeSet.bridges.backCollar,
    new THREE.Vector3(
      (backCenter.x + chestCenter.x) * 0.5,
      (backCollarMinY + backCollarMaxY) * 0.5,
      (backCenter.z + neckBox.getCenter(new THREE.Vector3()).z) * 0.5
    ),
    new THREE.Vector3(
      Math.min(chestSize.x, backSize.x) * 0.44,
      Math.max(0.08, backCollarMaxY - backCollarMinY),
      Math.max(0.26, Math.min(backSize.z + chestSize.z * 0.42, 0.36))
    )
  );

  const setScapula = (
    bridgeId: 'scapulaLeft' | 'scapulaRight',
    shoulderBox: THREE.Box3
  ): void => {
    const shoulderCenter = boxCenter(shoulderBox);
    const shoulderSize = boxSize(shoulderBox);
    setSegmentBridge(
      bridgeSet.root,
      bridgeSet.bridges[bridgeId],
      new THREE.Vector3(
        THREE.MathUtils.clamp(shoulderCenter.x, backBox.min.x, backBox.max.x),
        Math.min(backBox.max.y - 0.04, neckBox.min.y + 0.1),
        backBox.max.z - backSize.z * 0.18
      ),
      new THREE.Vector3(
        shoulderCenter.x,
        shoulderBox.max.y - shoulderSize.y * 0.1,
        shoulderCenter.z
      ),
      0.046,
      0.056
    );
  };

  setScapula('scapulaLeft', shoulderLeftBox);
  setScapula('scapulaRight', shoulderRightBox);

  const neckCenter = boxCenter(neckBox);
  const neckSize = boxSize(neckBox);
  setBoxBridge(
    bridgeSet.root,
    bridgeSet.bridges.neckColumn,
    new THREE.Vector3(
      (chestCenter.x + neckCenter.x) * 0.5,
      (chestBox.max.y + neckCenter.y) * 0.5,
      (chestCenter.z + neckCenter.z) * 0.5
    ),
    new THREE.Vector3(
      Math.min(chestSize.x * 0.42, neckSize.x * 0.54),
      Math.max(0.12, neckBox.max.y - chestBox.max.y + neckSize.y * 0.45),
      Math.min(chestSize.z * 0.72, neckSize.z * 0.82)
    )
  );

  const setClavicle = (
    bridgeId: 'clavicleLeft' | 'clavicleRight',
    shoulderBox: THREE.Box3,
    sign: 1 | -1
  ): void => {
    const shoulderCenter = boxCenter(shoulderBox);
    const shoulderSize = boxSize(shoulderBox);
    setSegmentBridge(
      bridgeSet.root,
      bridgeSet.bridges[bridgeId],
      new THREE.Vector3(
        chestCenter.x + sign * chestSize.x * 0.32,
        chestBox.max.y - chestSize.y * 0.2,
        chestCenter.z
      ),
      new THREE.Vector3(
        shoulderCenter.x - sign * shoulderSize.x * 0.24,
        shoulderCenter.y,
        shoulderCenter.z
      ),
      0.046,
      0.058
    );
  };

  const setShoulderSleeve = (
    bridgeId: 'shoulderSleeveLeft' | 'shoulderSleeveRight',
    shoulderBox: THREE.Box3,
    upperArmBox: THREE.Box3
  ): void => {
    setSegmentBridge(
      bridgeSet.root,
      bridgeSet.bridges[bridgeId],
      boxCenter(shoulderBox),
      boxCenter(upperArmBox),
      0.048,
      0.062
    );
  };

  const setArmpitSocket = (
    bridgeId: 'armpitLeft' | 'armpitRight',
    shoulderBox: THREE.Box3,
    upperArmBox: THREE.Box3,
    sign: 1 | -1
  ): void => {
    const shoulderCenter = boxCenter(shoulderBox);
    const upperArmCenter = boxCenter(upperArmBox);
    const shoulderSize = boxSize(shoulderBox);
    const chestSideX = chestCenter.x + sign * chestSize.x * 0.34;
    const outerX = shoulderCenter.x - sign * shoulderSize.x * 0.16;
    const center = new THREE.Vector3(
      (chestSideX + outerX + upperArmCenter.x) / 3,
      Math.min(shoulderCenter.y - shoulderSize.y * 0.03, chestBox.max.y + chestSize.y * 0.14),
      (chestCenter.z + shoulderCenter.z + upperArmCenter.z) / 3
    );
    const width = THREE.MathUtils.clamp(Math.abs(outerX - chestSideX) + 0.035, 0.1, 0.12);
    setBoxBridge(
      bridgeSet.root,
      bridgeSet.bridges[bridgeId],
      center,
      new THREE.Vector3(
        width,
        THREE.MathUtils.clamp(shoulderSize.y * 0.44, 0.12, 0.15),
        THREE.MathUtils.clamp(Math.max(chestSize.z, shoulderSize.z) * 0.385, 0.13, 0.18)
      )
    );
  };

  setClavicle('clavicleLeft', shoulderLeftBox, 1);
  setClavicle('clavicleRight', shoulderRightBox, -1);
  setShoulderSleeve('shoulderSleeveLeft', shoulderLeftBox, upperArmLeftBox);
  setShoulderSleeve('shoulderSleeveRight', shoulderRightBox, upperArmRightBox);
  setArmpitSocket('armpitLeft', shoulderLeftBox, upperArmLeftBox, 1);
  setArmpitSocket('armpitRight', shoulderRightBox, upperArmRightBox, -1);
}

export function setV3UpperBodyJointBridgesVisible(model: THREE.Object3D, visible: boolean): void {
  const bridgeSet = model.userData.v3UpperBodyJointBridges as V3UpperBodyJointBridgeSet | undefined;
  if (!bridgeSet) return;
  bridgeSet.root.visible = visible;
  for (const bridge of Object.values(bridgeSet.bridges)) bridge.visible = visible;
}
