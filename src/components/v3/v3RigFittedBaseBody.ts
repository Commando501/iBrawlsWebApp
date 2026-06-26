import * as THREE from 'three';
import type { V3CharacterSlotId } from './v3ModelTypes';

export type V3RigFittedBaseBodySegmentId =
  | 'torso'
  | 'pelvis'
  | 'neck'
  | 'head'
  | 'shoulderLeft'
  | 'shoulderRight'
  | 'upperArmLeft'
  | 'upperArmRight'
  | 'forearmLeft'
  | 'forearmRight'
  | 'handLeft'
  | 'handRight'
  | 'thighLeft'
  | 'thighRight'
  | 'shinLeft'
  | 'shinRight'
  | 'footLeft'
  | 'footRight';

export interface V3RigFittedBaseBodySet {
  root: THREE.Group;
  segments: Record<V3RigFittedBaseBodySegmentId, THREE.Mesh>;
}

const SEGMENT_IDS: readonly V3RigFittedBaseBodySegmentId[] = [
  'torso',
  'pelvis',
  'neck',
  'head',
  'shoulderLeft',
  'shoulderRight',
  'upperArmLeft',
  'upperArmRight',
  'forearmLeft',
  'forearmRight',
  'handLeft',
  'handRight',
  'thighLeft',
  'thighRight',
  'shinLeft',
  'shinRight',
  'footLeft',
  'footRight',
];

const ELLIPSOID_SEGMENT_IDS = new Set<V3RigFittedBaseBodySegmentId>([
  'torso',
  'pelvis',
  'neck',
  'head',
  'handLeft',
  'handRight',
  'footLeft',
  'footRight',
]);

const BASE_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#22374d',
  roughness: 0.92,
  metalness: 0.04,
  emissive: '#07131d',
  emissiveIntensity: 0.12,
});

const EMPTY_BOX = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
const WORLD_UP = new THREE.Vector3(0, 1, 0);

const getPartGroups = (model: THREE.Object3D): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
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

const boxCenter = (box: THREE.Box3): THREE.Vector3 => box.getCenter(new THREE.Vector3());
const boxSize = (box: THREE.Box3): THREE.Vector3 => box.getSize(new THREE.Vector3());

const clampDimension = (value: number, min: number, max: number): number =>
  THREE.MathUtils.clamp(Number.isFinite(value) ? value : min, min, max);

const makeSegmentMesh = (id: V3RigFittedBaseBodySegmentId): THREE.Mesh => {
  const geometry = ELLIPSOID_SEGMENT_IDS.has(id)
    ? new THREE.SphereGeometry(0.5, 14, 8)
    : new THREE.CapsuleGeometry(0.5, 1, 4, 8);
  const mesh = new THREE.Mesh(geometry, BASE_BODY_MATERIAL);
  mesh.name = `v3RigFittedBaseBody:${id}`;
  mesh.userData.v3RigFittedBaseBodySegment = true;
  mesh.userData.v3RigFittedBaseBodySegmentId = id;
  mesh.visible = false;
  mesh.scale.set(0.001, 0.001, 0.001);
  return mesh;
};

const setEllipsoidSegment = (
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

const setCapsuleSegment = (
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
  const length = delta.length();
  if (length <= 0.0001) {
    mesh.visible = false;
    return;
  }
  mesh.visible = true;
  mesh.position.copy(from.add(to).multiplyScalar(0.5));
  mesh.quaternion.setFromUnitVectors(WORLD_UP, delta.normalize());
  mesh.scale.set(
    Math.max(0.001, width),
    Math.max(0.001, length * 0.5),
    Math.max(0.001, depth)
  );
};

const profileFromBox = (
  box: THREE.Box3,
  widthScale: number,
  depthScale = widthScale,
  minWidth = 0.045,
  minDepth = minWidth,
  maxWidth = Number.POSITIVE_INFINITY,
  maxDepth = maxWidth
): { width: number; depth: number } => {
  const size = boxSize(box);
  return {
    width: THREE.MathUtils.clamp(Math.min(size.x, size.z) * widthScale, minWidth, maxWidth),
    depth: THREE.MathUtils.clamp(Math.min(size.x, size.z) * depthScale, minDepth, maxDepth),
  };
};

const sideSlot = (side: 'Left' | 'Right', base: string): V3CharacterSlotId =>
  `${base}${side}` as V3CharacterSlotId;

export function createV3RigFittedBaseBody(): V3RigFittedBaseBodySet {
  const root = new THREE.Group();
  root.name = 'v3RigFittedBaseBody';
  root.userData.v3RigFittedBaseBody = true;
  root.userData.v3RigFittedBaseBodySource = 'mesh2motion-slot-envelope';
  root.visible = true;
  const segments = Object.fromEntries(SEGMENT_IDS.map((id) => {
    const mesh = makeSegmentMesh(id);
    root.add(mesh);
    return [id, mesh];
  })) as Record<V3RigFittedBaseBodySegmentId, THREE.Mesh>;
  return { root, segments };
}

export function updateV3RigFittedBaseBody(model: THREE.Object3D, visible = true): void {
  const bodySet = model.userData.v3RigFittedBaseBody as V3RigFittedBaseBodySet | undefined;
  if (!bodySet) return;
  bodySet.root.visible = visible;
  for (const segment of Object.values(bodySet.segments)) segment.visible = false;
  if (!visible) return;

  model.updateWorldMatrix(true, true);
  bodySet.root.updateWorldMatrix(true, false);
  const partGroups = getPartGroups(model);
  const box = (slot: V3CharacterSlotId) => getObjectBox(partGroups[slot]);
  const chestBox = box('chest');
  const backBox = box('back');
  const neckBox = box('neck');
  const helmetBox = box('helmet');
  const pelvisBox = box('pelvis');
  if (
    chestBox.isEmpty() ||
    backBox.isEmpty() ||
    neckBox.isEmpty() ||
    helmetBox.isEmpty() ||
    pelvisBox.isEmpty()
  ) {
    bodySet.root.visible = false;
    return;
  }

  const chestCenter = boxCenter(chestBox);
  const backCenter = boxCenter(backBox);
  const chestSize = boxSize(chestBox);
  const backSize = boxSize(backBox);
  const torsoBottom = pelvisBox.max.y - boxSize(pelvisBox).y * 0.16;
  const torsoTop = Math.max(chestBox.max.y, backBox.max.y, neckBox.min.y + boxSize(neckBox).y * 0.2);
  const torsoDepthSpan = Math.max(0.24, chestBox.max.z - backBox.min.z);
  setEllipsoidSegment(
    bodySet.root,
    bodySet.segments.torso,
    new THREE.Vector3(
      (chestCenter.x + backCenter.x) * 0.5,
      (torsoBottom + torsoTop) * 0.5,
      (chestCenter.z + backCenter.z) * 0.5
    ),
    new THREE.Vector3(
      clampDimension(Math.min(chestSize.x, backSize.x) * 0.62, 0.24, 0.46),
      Math.max(0.28, torsoTop - torsoBottom),
      clampDimension(torsoDepthSpan * 0.76, 0.26, 0.46)
    )
  );

  const pelvisSize = boxSize(pelvisBox);
  setEllipsoidSegment(
    bodySet.root,
    bodySet.segments.pelvis,
    boxCenter(pelvisBox),
    new THREE.Vector3(
      pelvisSize.x * 0.74,
      pelvisSize.y * 0.82,
      pelvisSize.z * 0.7
    )
  );

  const neckSize = boxSize(neckBox);
  setEllipsoidSegment(
    bodySet.root,
    bodySet.segments.neck,
    boxCenter(neckBox),
    new THREE.Vector3(
      neckSize.x * 0.78,
      neckSize.y * 1.08,
      neckSize.z * 0.78
    )
  );

  const helmetSize = boxSize(helmetBox);
  setEllipsoidSegment(
    bodySet.root,
    bodySet.segments.head,
    boxCenter(helmetBox),
    new THREE.Vector3(
      helmetSize.x * 0.58,
      helmetSize.y * 0.7,
      helmetSize.z * 0.58
    )
  );

  for (const side of ['Left', 'Right'] as const) {
    const shoulderBox = box(sideSlot(side, 'shoulder'));
    const upperArmBox = box(sideSlot(side, 'upperArm'));
    const forearmBox = box(sideSlot(side, 'forearm'));
    const handBox = box(sideSlot(side, 'hand'));
    const thighBox = box(sideSlot(side, 'thigh'));
    const shinBox = box(sideSlot(side, 'shin'));
    const footBox = box(sideSlot(side, 'foot'));
    const shoulderCenter = boxCenter(shoulderBox);
    const upperArmCenter = boxCenter(upperArmBox);
    const forearmCenter = boxCenter(forearmBox);
    const handCenter = boxCenter(handBox);
    const thighCenter = boxCenter(thighBox);
    const shinCenter = boxCenter(shinBox);
    const footCenter = boxCenter(footBox);
    const sign = shoulderCenter.x >= chestCenter.x ? 1 : -1;
    const chestShoulderAnchor = new THREE.Vector3(
      chestCenter.x + sign * chestSize.x * 0.36,
      Math.min(shoulderCenter.y, chestBox.max.y - chestSize.y * 0.08),
      (chestCenter.z + shoulderCenter.z) * 0.5
    );
    const shoulderProfile = profileFromBox(upperArmBox, 0.32, 0.34, 0.055, 0.058, 0.095, 0.105);
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[`shoulder${side}`],
      chestShoulderAnchor,
      shoulderCenter,
      shoulderProfile.width,
      shoulderProfile.depth
    );

    const upperArmProfile = profileFromBox(upperArmBox, 0.36, 0.38, 0.052, 0.056, 0.135, 0.145);
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[`upperArm${side}`],
      shoulderCenter,
      upperArmCenter,
      upperArmProfile.width,
      upperArmProfile.depth
    );

    const forearmProfile = profileFromBox(forearmBox, 0.42, 0.46, 0.05, 0.055, 0.115, 0.125);
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[`forearm${side}`],
      upperArmCenter,
      forearmCenter,
      forearmProfile.width,
      forearmProfile.depth
    );

    const handSize = boxSize(handBox);
    setEllipsoidSegment(
      bodySet.root,
      bodySet.segments[`hand${side}`],
      handCenter,
      new THREE.Vector3(
        Math.max(0.052, handSize.x * 0.8),
        Math.max(0.052, handSize.y * 0.74),
        Math.max(0.07, handSize.z * 0.72)
      )
    );

    const hipAnchor = new THREE.Vector3(
      boxCenter(pelvisBox).x + sign * pelvisSize.x * 0.24,
      pelvisBox.min.y + pelvisSize.y * 0.24,
      (boxCenter(pelvisBox).z + thighCenter.z) * 0.5
    );
    const thighProfile = profileFromBox(thighBox, 0.86, 0.82, 0.058, 0.06);
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[`thigh${side}`],
      hipAnchor,
      thighCenter,
      thighProfile.width,
      thighProfile.depth
    );

    const shinProfile = profileFromBox(shinBox, 0.82, 0.78, 0.055, 0.058);
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[`shin${side}`],
      thighCenter,
      shinCenter,
      shinProfile.width,
      shinProfile.depth
    );

    const footSize = boxSize(footBox);
    setEllipsoidSegment(
      bodySet.root,
      bodySet.segments[`foot${side}`],
      footCenter,
      new THREE.Vector3(
        Math.max(0.08, footSize.x * 0.72),
        Math.max(0.05, footSize.y * 0.8),
        Math.max(0.08, footSize.z * 0.66)
      )
    );
  }
}

export function setV3RigFittedBaseBodyVisible(model: THREE.Object3D, visible: boolean): void {
  const bodySet = model.userData.v3RigFittedBaseBody as V3RigFittedBaseBodySet | undefined;
  if (!bodySet) return;
  bodySet.root.visible = visible;
  for (const segment of Object.values(bodySet.segments)) {
    segment.visible = visible;
  }
}
