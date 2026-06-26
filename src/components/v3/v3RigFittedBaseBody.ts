import * as THREE from 'three';
import { V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE } from './v3AegisObjSurfaceVoxels.generated';
import { V3_ARMOR_FOUNDATION } from './v3ArmorFoundation';
import { V3_MESH2MOTION_ARMOR_RIG } from './v3Mesh2MotionArmorRig.generated';
import type { V3CharacterSlotId } from './v3ModelTypes';

type V3RigFittedBaseBodySide = 'Left' | 'Right';
type V3RigFittedBaseBodyFingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';
type V3RigFittedBaseBodyFingerIndex = '01' | '02' | '03';
type V3RigFittedBaseBodyJointSuffix = 'l' | 'r';

export type V3RigFittedBaseBodyFingerSegmentId =
  `${V3RigFittedBaseBodyFingerName}${V3RigFittedBaseBodySide}${V3RigFittedBaseBodyFingerIndex}`;

export type V3RigFittedBaseBodyCoreSegmentId =
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

export type V3RigFittedBaseBodySegmentId =
  | V3RigFittedBaseBodyCoreSegmentId
  | V3RigFittedBaseBodyFingerSegmentId;

export interface V3RigFittedBaseBodySet {
  root: THREE.Group;
  segments: Record<V3RigFittedBaseBodySegmentId, THREE.Mesh>;
}

interface V3RigFittedBaseBodyFingerChainSpec {
  id: V3RigFittedBaseBodyFingerSegmentId;
  fromJointName: string;
  toJointName: string;
  width: number;
  depth: number;
}

interface V3RigFittedBaseBodyRuntimeJoint {
  object?: THREE.Object3D;
  restWorldPosition?: readonly number[];
}

const CORE_SEGMENT_IDS: readonly V3RigFittedBaseBodyCoreSegmentId[] = [
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

const FINGER_NAMES: readonly V3RigFittedBaseBodyFingerName[] = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const FINGER_SIDES: readonly {
  side: V3RigFittedBaseBodySide;
  suffix: V3RigFittedBaseBodyJointSuffix;
  handJointName: string;
}[] = [
  { side: 'Left', suffix: 'l', handJointName: 'hand_l' },
  { side: 'Right', suffix: 'r', handJointName: 'hand_r' },
];
const FINGER_PROFILE: Record<V3RigFittedBaseBodyFingerName, { width: number; depth: number }> = {
  thumb: { width: 0.024, depth: 0.023 },
  index: { width: 0.019, depth: 0.018 },
  middle: { width: 0.02, depth: 0.019 },
  ring: { width: 0.019, depth: 0.018 },
  pinky: { width: 0.016, depth: 0.015 },
};
const FINGER_CHAIN_SPECS: readonly V3RigFittedBaseBodyFingerChainSpec[] = FINGER_SIDES.flatMap((sideSpec) =>
  FINGER_NAMES.flatMap((fingerName) =>
    (['01', '02', '03'] as const).map((index) => {
      const profile = FINGER_PROFILE[fingerName];
      const previousIndex = `0${Number(index) - 1}` as '00' | '01' | '02';
      return {
        id: `${fingerName}${sideSpec.side}${index}` as V3RigFittedBaseBodyFingerSegmentId,
        fromJointName: index === '01'
          ? sideSpec.handJointName
          : `${fingerName}_${previousIndex}_${sideSpec.suffix}`,
        toJointName: `${fingerName}_${index}_${sideSpec.suffix}`,
        width: profile.width,
        depth: profile.depth,
      };
    })
  )
);
const PALM_HUB_SIZE = new THREE.Vector3(0.06, 0.044, 0.052);
const PALM_HUB_WRIST_OFFSET = 0.002;
const TORSO_CONNECTOR_PROFILE = { width: 0.16, depth: 0.125 };
const PELVIS_HUB_SIZE = new THREE.Vector3(0.31, 0.14, 0.18);
const NECK_CONNECTOR_PROFILE = { width: 0.074, depth: 0.066 };
const HEAD_HUB_SIZE = new THREE.Vector3(0.145, 0.154, 0.14);
const SHOULDER_CONNECTOR_PROFILE = { width: 0.082, depth: 0.078 };
const UPPER_ARM_CONNECTOR_PROFILE = { width: 0.116, depth: 0.108 };
const FOREARM_CONNECTOR_PROFILE = { width: 0.092, depth: 0.086 };
const THIGH_CONNECTOR_PROFILE = { width: 0.176, depth: 0.166 };
const SHIN_CONNECTOR_PROFILE = { width: 0.136, depth: 0.128 };
const FOOT_CONNECTOR_PROFILE = { width: 0.092, depth: 0.072 };
const SEGMENT_IDS: readonly V3RigFittedBaseBodySegmentId[] = [
  ...CORE_SEGMENT_IDS,
  ...FINGER_CHAIN_SPECS.map(({ id }) => id),
];

const ELLIPSOID_SEGMENT_IDS = new Set<V3RigFittedBaseBodySegmentId>([
  'pelvis',
  'head',
  'handLeft',
  'handRight',
]);

const BASE_BODY_MATERIAL = new THREE.MeshStandardMaterial({
  color: '#22374d',
  roughness: 0.92,
  metalness: 0.04,
  emissive: '#07131d',
  emissiveIntensity: 0.12,
});

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const LOCAL_FORWARD = new THREE.Vector3(1, 0, 0);
const LOCAL_UP = new THREE.Vector3(0, 1, 0);
const GENERATED_JOINTS: ReadonlyMap<string, (typeof V3_MESH2MOTION_ARMOR_RIG.skeleton.joints)[number]> =
  new Map(V3_MESH2MOTION_ARMOR_RIG.skeleton.joints.map((joint) => [joint.name, joint]));
const FOUNDATION_VOXEL_SCALE = V3_AEGIS_OBJ_SURFACE_VOXEL_SOURCE.coordinateSystem.voxelScale;

const tupleToVector = (value: readonly number[] | undefined): THREE.Vector3 | null => {
  if (!value || value.length !== 3 || !value.every(Number.isFinite)) return null;
  return new THREE.Vector3(value[0], value[1], value[2]);
};

const getMesh2MotionJoints = (
  model: THREE.Object3D
): Record<string, V3RigFittedBaseBodyRuntimeJoint> => {
  const candidate = model.userData?.v3Mesh2MotionJoints;
  return candidate && typeof candidate === 'object'
    ? candidate as Record<string, V3RigFittedBaseBodyRuntimeJoint>
    : {};
};

const getSlotPivots = (model: THREE.Object3D): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3Mesh2MotionSlotPivots ?? model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
};

const getJointWorldPosition = (model: THREE.Object3D, jointName: string): THREE.Vector3 | null => {
  const runtimeJoint = getMesh2MotionJoints(model)[jointName];
  if (runtimeJoint?.object instanceof THREE.Object3D) {
    runtimeJoint.object.updateWorldMatrix(true, false);
    return runtimeJoint.object.getWorldPosition(new THREE.Vector3());
  }
  const runtimeRest = tupleToVector(runtimeJoint?.restWorldPosition);
  if (runtimeRest) return model.localToWorld(runtimeRest);
  const generatedRest = tupleToVector(GENERATED_JOINTS.get(jointName)?.restWorldPosition);
  return generatedRest ? model.localToWorld(generatedRest) : null;
};

const getFoundationSlotWorldCenter = (
  model: THREE.Object3D,
  slot: V3CharacterSlotId
): THREE.Vector3 | null => {
  const foundationSlot = V3_ARMOR_FOUNDATION.slots[slot];
  const localCenter = tupleToVector(foundationSlot.mesh2MotionGeometry.position);
  if (!localCenter) return null;

  const slotPivot = getSlotPivots(model)[slot];
  if (slotPivot instanceof THREE.Object3D) {
    slotPivot.updateWorldMatrix(true, false);
    return slotPivot.localToWorld(localCenter.clone());
  }

  const generatedSlot = V3_MESH2MOTION_ARMOR_RIG.slots[slot];
  const pivotPosition = tupleToVector(generatedSlot?.pivotWorldPosition);
  if (!generatedSlot || !pivotPosition) return null;
  const pivotQuaternion = new THREE.Quaternion(
    generatedSlot.pivotWorldQuaternion[0] ?? 0,
    generatedSlot.pivotWorldQuaternion[1] ?? 0,
    generatedSlot.pivotWorldQuaternion[2] ?? 0,
    generatedSlot.pivotWorldQuaternion[3] ?? 1
  ).normalize();
  return model.localToWorld(localCenter.applyQuaternion(pivotQuaternion).add(pivotPosition));
};

const getFoundationSlotWorldSize = (slot: V3CharacterSlotId): THREE.Vector3 => {
  const sourceSize = V3_ARMOR_FOUNDATION.slots[slot].exactSourceBounds.size;
  return new THREE.Vector3(
    sourceSize[0] * FOUNDATION_VOXEL_SCALE,
    sourceSize[1] * FOUNDATION_VOXEL_SCALE,
    sourceSize[2] * FOUNDATION_VOXEL_SCALE
  );
};

const getFoundationEnvelope = (
  model: THREE.Object3D,
  slot: V3CharacterSlotId
): { center: THREE.Vector3; size: THREE.Vector3 } | null => {
  const center = getFoundationSlotWorldCenter(model, slot);
  if (!center) return null;
  return { center, size: getFoundationSlotWorldSize(slot) };
};

const getPalmFirstKnuckleWorldPositions = (
  model: THREE.Object3D,
  sideSpec: (typeof FINGER_SIDES)[number]
): THREE.Vector3[] =>
  FINGER_NAMES
    .map((fingerName) => getJointWorldPosition(model, `${fingerName}_01_${sideSpec.suffix}`))
    .filter((position): position is THREE.Vector3 => position !== null);

const getPalmFingerFanWorldDirection = (
  model: THREE.Object3D,
  sideSpec: (typeof FINGER_SIDES)[number]
): THREE.Vector3 | null => {
  const hand = getJointWorldPosition(model, sideSpec.handJointName);
  if (!hand) return null;

  const firstKnuckles = getPalmFirstKnuckleWorldPositions(model, sideSpec);
  if (firstKnuckles.length === 0) return null;

  const knuckleCenter = firstKnuckles
    .reduce((sum, position) => sum.add(position), new THREE.Vector3())
    .multiplyScalar(1 / firstKnuckles.length);
  const direction = knuckleCenter.sub(hand);
  return direction.lengthSq() > 0 ? direction.normalize() : null;
};

const getPalmHubWorldCenter = (
  model: THREE.Object3D,
  sideSpec: (typeof FINGER_SIDES)[number]
): THREE.Vector3 | null => {
  const hand = getJointWorldPosition(model, sideSpec.handJointName);
  if (!hand) return null;

  const direction = getPalmFingerFanWorldDirection(model, sideSpec);
  return direction
    ? hand.clone().addScaledVector(direction, -PALM_HUB_WRIST_OFFSET)
    : hand;
};

const getPelvisHubWorldCenter = (model: THREE.Object3D): THREE.Vector3 | null => {
  const jointPositions = ['pelvis', 'spine_01', 'thigh_l', 'thigh_r']
    .map((jointName) => getJointWorldPosition(model, jointName))
    .filter((position): position is THREE.Vector3 => position !== null);
  if (jointPositions.length === 0) return null;
  return new THREE.Box3().setFromPoints(jointPositions).getCenter(new THREE.Vector3());
};

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

const setOrientedEllipsoidSegment = (
  root: THREE.Group,
  mesh: THREE.Mesh,
  centerWorld: THREE.Vector3,
  size: THREE.Vector3,
  forwardWorld: THREE.Vector3,
  localAxis = LOCAL_FORWARD
): void => {
  setEllipsoidSegment(root, mesh, centerWorld, size);
  const forwardTarget = root.worldToLocal(
    centerWorld.clone().add(forwardWorld.clone().normalize())
  );
  const forwardLocal = forwardTarget.sub(mesh.position).normalize();
  if (forwardLocal.lengthSq() > 0) {
    mesh.quaternion.setFromUnitVectors(localAxis, forwardLocal);
  }
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

const profileFromFoundationSize = (
  slot: V3CharacterSlotId,
  widthScale: number,
  depthScale = widthScale,
  minWidth = 0.045,
  minDepth = minWidth,
  maxWidth = Number.POSITIVE_INFINITY,
  maxDepth = maxWidth
): { width: number; depth: number } => {
  const size = getFoundationSlotWorldSize(slot);
  return {
    width: THREE.MathUtils.clamp(Math.min(size.x, size.z) * widthScale, minWidth, maxWidth),
    depth: THREE.MathUtils.clamp(Math.min(size.x, size.z) * depthScale, minDepth, maxDepth),
  };
};

const sideSlot = (side: 'Left' | 'Right', base: string): V3CharacterSlotId =>
  `${base}${side}` as V3CharacterSlotId;

const segmentId = (
  prefix: 'shoulder' | 'upperArm' | 'forearm' | 'hand' | 'thigh' | 'shin' | 'foot',
  side: 'Left' | 'Right'
): V3RigFittedBaseBodySegmentId => `${prefix}${side}` as V3RigFittedBaseBodySegmentId;

export function createV3RigFittedBaseBody(): V3RigFittedBaseBodySet {
  const root = new THREE.Group();
  root.name = 'v3RigFittedBaseBody';
  root.userData.v3RigFittedBaseBody = true;
  root.userData.v3RigFittedBaseBodySource = 'mesh2motion-joints-foundation';
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
  const chest = getFoundationEnvelope(model, 'chest');
  const back = getFoundationEnvelope(model, 'back');
  const neck = getFoundationEnvelope(model, 'neck');
  const helmet = getFoundationEnvelope(model, 'helmet');
  const pelvis = getFoundationEnvelope(model, 'pelvis');
  if (!chest || !back || !neck || !helmet || !pelvis) {
    bodySet.root.visible = false;
    return;
  }

  const torsoDepthCenter = (chest.center.z + back.center.z) * 0.5;
  const torsoBaseFallback = new THREE.Vector3(
    (chest.center.x + back.center.x) * 0.5,
    pelvis.center.y + pelvis.size.y * 0.34,
    torsoDepthCenter
  );
  const torsoTopFallback = new THREE.Vector3(
    (chest.center.x + back.center.x) * 0.5,
    Math.max(chest.center.y + chest.size.y * 0.5, back.center.y + back.size.y * 0.5, neck.center.y - neck.size.y * 0.3),
    torsoDepthCenter
  );
  setCapsuleSegment(
    bodySet.root,
    bodySet.segments.torso,
    getJointWorldPosition(model, 'spine_01') ?? torsoBaseFallback,
    getJointWorldPosition(model, 'neck_01') ?? torsoTopFallback,
    TORSO_CONNECTOR_PROFILE.width,
    TORSO_CONNECTOR_PROFILE.depth
  );

  setEllipsoidSegment(
    bodySet.root,
    bodySet.segments.pelvis,
    getPelvisHubWorldCenter(model) ?? pelvis.center,
    PELVIS_HUB_SIZE
  );

  setCapsuleSegment(
    bodySet.root,
    bodySet.segments.neck,
    getJointWorldPosition(model, 'neck_01') ?? neck.center,
    getJointWorldPosition(model, 'head') ?? helmet.center,
    NECK_CONNECTOR_PROFILE.width,
    NECK_CONNECTOR_PROFILE.depth
  );

  const headBase = getJointWorldPosition(model, 'head');
  const headLeaf = getJointWorldPosition(model, 'head_leaf');
  const headCenter = headBase && headLeaf
    ? headBase.clone().add(headLeaf).multiplyScalar(0.5)
    : helmet.center;
  const headDirection = headBase && headLeaf
    ? headLeaf.clone().sub(headBase)
    : null;
  if (headDirection && headDirection.lengthSq() > 0) {
    setOrientedEllipsoidSegment(
      bodySet.root,
      bodySet.segments.head,
      headCenter,
      HEAD_HUB_SIZE,
      headDirection,
      LOCAL_UP
    );
  } else {
    setEllipsoidSegment(
      bodySet.root,
      bodySet.segments.head,
      headCenter,
      HEAD_HUB_SIZE
    );
  }

  for (const sideSpec of FINGER_SIDES) {
    const { side } = sideSpec;
    const shoulder = getFoundationEnvelope(model, sideSlot(side, 'shoulder'));
    const upperArm = getFoundationEnvelope(model, sideSlot(side, 'upperArm'));
    const forearm = getFoundationEnvelope(model, sideSlot(side, 'forearm'));
    const hand = getFoundationEnvelope(model, sideSlot(side, 'hand'));
    const thigh = getFoundationEnvelope(model, sideSlot(side, 'thigh'));
    const shin = getFoundationEnvelope(model, sideSlot(side, 'shin'));
    const foot = getFoundationEnvelope(model, sideSlot(side, 'foot'));
    if (!shoulder || !upperArm || !forearm || !hand || !thigh || !shin || !foot) continue;

    const sign = shoulder.center.x >= chest.center.x ? 1 : -1;
    const chestShoulderAnchor = new THREE.Vector3(
      chest.center.x + sign * chest.size.x * 0.36,
      Math.min(shoulder.center.y, chest.center.y + chest.size.y * 0.42),
      (chest.center.z + shoulder.center.z) * 0.5
    );
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('shoulder', side)],
      getJointWorldPosition(model, `clavicle_${sideSpec.suffix}`) ?? chestShoulderAnchor,
      getJointWorldPosition(model, `upperarm_${sideSpec.suffix}`) ?? shoulder.center,
      SHOULDER_CONNECTOR_PROFILE.width,
      SHOULDER_CONNECTOR_PROFILE.depth
    );

    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('upperArm', side)],
      getJointWorldPosition(model, `upperarm_${sideSpec.suffix}`) ?? shoulder.center,
      getJointWorldPosition(model, `lowerarm_${sideSpec.suffix}`) ?? upperArm.center,
      UPPER_ARM_CONNECTOR_PROFILE.width,
      UPPER_ARM_CONNECTOR_PROFILE.depth
    );

    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('forearm', side)],
      getJointWorldPosition(model, `lowerarm_${sideSpec.suffix}`) ?? upperArm.center,
      getJointWorldPosition(model, `hand_${sideSpec.suffix}`) ?? forearm.center,
      FOREARM_CONNECTOR_PROFILE.width,
      FOREARM_CONNECTOR_PROFILE.depth
    );

    const palmCenter = getPalmHubWorldCenter(model, sideSpec) ?? hand.center;
    const palmDirection = getPalmFingerFanWorldDirection(model, sideSpec);
    if (palmDirection) {
      setOrientedEllipsoidSegment(
        bodySet.root,
        bodySet.segments[segmentId('hand', side)],
        palmCenter,
        PALM_HUB_SIZE,
        palmDirection
      );
    } else {
      setEllipsoidSegment(
        bodySet.root,
        bodySet.segments[segmentId('hand', side)],
        palmCenter,
        PALM_HUB_SIZE
      );
    }

    const hipAnchor = new THREE.Vector3(
      pelvis.center.x + sign * pelvis.size.x * 0.24,
      pelvis.center.y - pelvis.size.y * 0.26,
      (pelvis.center.z + thigh.center.z) * 0.5
    );
    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('thigh', side)],
      getJointWorldPosition(model, `thigh_${sideSpec.suffix}`) ?? hipAnchor,
      getJointWorldPosition(model, `calf_${sideSpec.suffix}`) ?? thigh.center,
      THIGH_CONNECTOR_PROFILE.width,
      THIGH_CONNECTOR_PROFILE.depth
    );

    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('shin', side)],
      getJointWorldPosition(model, `calf_${sideSpec.suffix}`) ?? thigh.center,
      getJointWorldPosition(model, `foot_${sideSpec.suffix}`) ?? shin.center,
      SHIN_CONNECTOR_PROFILE.width,
      SHIN_CONNECTOR_PROFILE.depth
    );

    setCapsuleSegment(
      bodySet.root,
      bodySet.segments[segmentId('foot', side)],
      getJointWorldPosition(model, `foot_${sideSpec.suffix}`) ?? foot.center,
      getJointWorldPosition(model, `ball_leaf_${sideSpec.suffix}`) ?? foot.center.clone().add(new THREE.Vector3(0, 0, foot.size.z * 0.5)),
      FOOT_CONNECTOR_PROFILE.width,
      FOOT_CONNECTOR_PROFILE.depth
    );
  }

  for (const fingerSpec of FINGER_CHAIN_SPECS) {
    const from = getJointWorldPosition(model, fingerSpec.fromJointName);
    const to = getJointWorldPosition(model, fingerSpec.toJointName);
    const segment = bodySet.segments[fingerSpec.id];
    if (!from || !to) {
      segment.visible = false;
      continue;
    }
    setCapsuleSegment(bodySet.root, segment, from, to, fingerSpec.width, fingerSpec.depth);
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
