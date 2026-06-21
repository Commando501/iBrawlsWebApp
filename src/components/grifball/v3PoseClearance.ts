import * as THREE from 'three';
import type { CharacterLoadout } from '../VoxelModels';
import type { V3RenderOptions } from '../v3/v3QualityTiers';
import type { V3VisualQaOptions, V3VisualQaSummary } from '../../tools/v3VisualQa';
import { buildV3VisualQaReport } from '../../tools/v3VisualQa';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from './combatantModels';
import {
  getCombatantRig,
  type CombatantRig,
} from './combatantRig';
import {
  animateV3CombatantModel,
  animateV3WeaponMeshes,
} from './combatantAnimationV3';
import { createInitialGrifballThreeRefs } from './threeRefs';
import { analyzeV3WeaponCarryAlignment } from './v3WeaponSocketBasis';

export const V3_POSE_CLEARANCE_CASES = [
  { id: 'idle', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 1, vel: [0, 0, 0] },
  { id: 'walk', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 0.35, vel: [2.4, 0, 0] },
  { id: 'sprint', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 0.28, vel: [4.4, 0, 0], isSprinting: true },
  { id: 'slide', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 1, vel: [3.6, 0, 0], isSliding: true },
  { id: 'hammerWindup', activeWeapon: 'hammer', weaponState: 'swing_up', weaponTimer: 0.18, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'hammerStrike', activeWeapon: 'hammer', weaponState: 'swing_down', weaponTimer: 0.08, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'hammerRecover', activeWeapon: 'hammer', weaponState: 'recovering', weaponTimer: 0.3, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'hammerMelee', activeWeapon: 'hammer', weaponState: 'melee_swing', weaponTimer: 0.18, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'hammerMeleeRecover', activeWeapon: 'hammer', weaponState: 'melee_recover', weaponTimer: 0.3, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'swordLunge', activeWeapon: 'sword', weaponState: 'ready', weaponTimer: 0.12, dt: 1, vel: [0, 0, -3], isLunging: true, includeWeaponMetrics: true },
  { id: 'swordSlash', activeWeapon: 'sword', weaponState: 'swing_up', weaponTimer: 0.11, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'pistolFire', activeWeapon: 'pistol', weaponState: 'firing', weaponTimer: 0.04, dt: 1, vel: [0, 0, 0], includeWeaponMetrics: true, expectUpperLowerIsolation: true },
  { id: 'hitReact', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 0.12, vel: [1.8, 0, 0], previousHp: 100, hp: 72 },
  { id: 'death', activeWeapon: 'hammer', weaponState: 'ready', weaponTimer: 0, dt: 1, vel: [0, 0, 0], hp: 0 },
] as const;

export type V3PoseClearanceCaseId = (typeof V3_POSE_CLEARANCE_CASES)[number]['id'];

export type V3PoseClearanceIssueCode =
  | 'missing-rig'
  | 'non-finite-transform'
  | 'visual-qa-failed'
  | 'part-overlap-high'
  | 'limb-gap-low'
  | 'weapon-drift-high'
  | 'foot-floor-penetration'
  | 'foot-lift-high'
  | 'upper-lower-coupling';

export interface V3PoseClearanceIssue {
  code: V3PoseClearanceIssueCode;
  message: string;
  caseId: V3PoseClearanceCaseId;
  value?: number;
  threshold?: number;
  partIds?: string[];
}

export type V3PoseClearanceOverlayIssueCode = Extract<
  V3PoseClearanceIssueCode,
  | 'part-overlap-high'
  | 'limb-gap-low'
  | 'weapon-drift-high'
  | 'foot-floor-penetration'
  | 'foot-lift-high'
>;

export type V3PoseClearanceOverlayKind =
  | 'part-overlap'
  | 'limb-gap'
  | 'weapon-grip-drift'
  | 'foot-floor-penetration'
  | 'foot-lift';

export type V3PoseClearancePoint = [number, number, number];

export interface V3PoseClearanceOverlayBox {
  partId: string;
  min: V3PoseClearancePoint;
  max: V3PoseClearancePoint;
}

export interface V3PoseClearanceOverlayLine {
  from: V3PoseClearancePoint;
  to: V3PoseClearancePoint;
}

export interface V3PoseClearanceOverlay {
  id: string;
  caseId: V3PoseClearanceCaseId;
  kind: V3PoseClearanceOverlayKind;
  issueCode: V3PoseClearanceOverlayIssueCode;
  message: string;
  partIds: string[];
  value?: number;
  threshold?: number;
  boxes?: V3PoseClearanceOverlayBox[];
  line?: V3PoseClearanceOverlayLine;
  floorY?: number;
}

export interface V3PoseClearanceWeaponMetrics {
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  gripDrift: number;
  bodyClearance: number;
  basisForwardAlignment: number;
  basisUpAlignment: number;
  primaryGripDrift: number;
  offhandGripDrift: number | null;
  twoHandReadiness: number | null;
  oneHandReadiness: number | null;
}

export interface V3PoseClearanceMetrics {
  partCount: number;
  detailBoneCount: number;
  partOverlapRatio: number;
  limbGap: number;
  footFloorPenetration: number;
  footLift: number;
  upperLowerCoupling: number;
  minProjectedWidth: number;
  minProjectedHeight: number;
  weapon?: V3PoseClearanceWeaponMetrics;
}

export interface V3PoseClearanceCaseReport {
  id: V3PoseClearanceCaseId;
  ready: boolean;
  metrics: V3PoseClearanceMetrics;
  overlays: V3PoseClearanceOverlay[];
  visualQaSummary: V3VisualQaSummary | null;
  issues: V3PoseClearanceIssue[];
}

export interface V3PoseClearanceSummary {
  caseCount: number;
  readyCaseCount: number;
  issueCount: number;
  maxPartOverlapRatio: number;
  minLimbGap: number;
  maxWeaponGripDrift: number;
  maxFootFloorPenetration: number;
  maxFootLift: number;
  maxUpperLowerCoupling: number;
}

export interface V3PoseClearanceReport {
  ready: boolean;
  cases: V3PoseClearanceCaseReport[];
  summary: V3PoseClearanceSummary;
  issues: V3PoseClearanceIssue[];
}

export interface V3PoseClearanceThresholds {
  maxPartOverlapRatio: number;
  minLimbGap: number;
  maxWeaponGripDrift: number;
  maxFootFloorPenetration: number;
  maxFootLift: number;
  maxUpperLowerCoupling: number;
}

export interface V3PoseClearanceOptions {
  model?: THREE.Group;
  rig?: CombatantRig;
  hammerModel?: THREE.Group | null;
  swordModel?: THREE.Group | null;
  pistolModel?: THREE.Group | null;
  loadout?: CharacterLoadout;
  v3Options?: V3RenderOptions;
  thresholds?: Partial<V3PoseClearanceThresholds>;
  visualQaOptions?: V3VisualQaOptions;
  floorY?: number;
  hue?: number;
}

export interface V3PoseClearanceSubject {
  model: THREE.Group;
  rig?: CombatantRig;
  hammerModel?: THREE.Group | null;
  swordModel?: THREE.Group | null;
  pistolModel?: THREE.Group | null;
}

interface PartBounds {
  id: string;
  object: THREE.Object3D;
  bounds: THREE.Box3;
  volume: number;
}

interface ObjectTransformSnapshot {
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}

interface SubjectSnapshot {
  objects: ObjectTransformSnapshot[];
  hadLastHp: boolean;
  lastHp: unknown;
}

interface WeaponMeasurement {
  metrics: V3PoseClearanceWeaponMetrics;
  weaponPosition: THREE.Vector3;
  gripPosition: THREE.Vector3;
}

const DEFAULT_THRESHOLDS: V3PoseClearanceThresholds = {
  maxPartOverlapRatio: 0.6,
  minLimbGap: 0.01,
  maxWeaponGripDrift: 0.75,
  maxFootFloorPenetration: 0.35,
  maxFootLift: 0.5,
  maxUpperLowerCoupling: 0.35,
};

const DEFAULT_VISUAL_QA_OPTIONS: V3VisualQaOptions = {
  thresholds: {
    minOccupiedAreaRatio: 0.001,
    maxOccupiedAreaRatio: 0.95,
    maxDarkMaterialCoverage: 1,
    maxEmissiveMaterialCoverage: 1,
    minPanelCount: 0,
    minMaterialGroupCount: 1,
  },
};

const ROUND_DIGITS = 6;
const ACTIVE_WEAPONS = ['hammer', 'sword', 'pistol'] as const;
const MIRRORED_LIMB_STEMS = [
  'shoulder',
  'upperArm',
  'forearm',
  'hand',
  'thigh',
  'shin',
] as const;
const FOOT_PART_IDS = ['footLeft', 'footRight', 'leftFoot', 'rightFoot'] as const;

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(ROUND_DIGITS));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const isObject3D = (value: unknown): value is THREE.Object3D =>
  value instanceof THREE.Object3D;

const isFiniteVector3 = (value: THREE.Vector3): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

const isFiniteEuler = (value: THREE.Euler): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

const isFiniteQuaternion = (value: THREE.Quaternion): boolean =>
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) && Number.isFinite(value.w);

const isFiniteBox = (box: THREE.Box3): boolean => (
  isFiniteVector3(box.min)
  && isFiniteVector3(box.max)
  && !box.isEmpty()
);

const boxVolume = (box: THREE.Box3): number => {
  if (!isFiniteBox(box)) return 0;
  const size = box.getSize(new THREE.Vector3());
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z);
};

const distanceBetweenBoxes = (left: THREE.Box3, right: THREE.Box3): number => {
  const dx = left.max.x < right.min.x
    ? right.min.x - left.max.x
    : right.max.x < left.min.x
      ? left.min.x - right.max.x
      : 0;
  const dy = left.max.y < right.min.y
    ? right.min.y - left.max.y
    : right.max.y < left.min.y
      ? left.min.y - right.max.y
      : 0;
  const dz = left.max.z < right.min.z
    ? right.min.z - left.max.z
    : right.max.z < left.min.z
      ? left.min.z - right.max.z
      : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const findCaseDefinition = (caseId: V3PoseClearanceCaseId) => {
  const definition = V3_POSE_CLEARANCE_CASES.find((candidate) => candidate.id === caseId);
  if (!definition) throw new Error(`Unknown V3 pose-clearance case: ${caseId}`);
  return definition;
};

const createIssue = (
  caseId: V3PoseClearanceCaseId,
  code: V3PoseClearanceIssueCode,
  message: string,
  details: Omit<V3PoseClearanceIssue, 'caseId' | 'code' | 'message'> = {}
): V3PoseClearanceIssue => ({
  caseId,
  code,
  message,
  ...details,
});

const createBuiltSubject = (options: V3PoseClearanceOptions): V3PoseClearanceSubject => {
  if (options.model) {
    return {
      model: options.model,
      rig: options.rig ?? getCombatantRig(options.model),
      hammerModel: options.hammerModel,
      swordModel: options.swordModel,
      pistolModel: options.pistolModel,
    };
  }

  const scene = new THREE.Scene();
  const meshRig: CombatantMeshRig = createCombatantMeshRig(
    scene,
    options.hue ?? 192,
    false,
    options.loadout ?? { modelSystem: 'v3' },
    options.v3Options ?? {}
  );
  return {
    model: meshRig.group,
    rig: meshRig.rig,
    hammerModel: meshRig.hammer,
    swordModel: meshRig.sword,
    pistolModel: meshRig.pistol,
  };
};

const snapshotSubject = (subject: V3PoseClearanceSubject): SubjectSnapshot => {
  const seen = new Set<string>();
  const objects: ObjectTransformSnapshot[] = [];
  const maybeRoots: Array<THREE.Object3D | null | undefined> = [
    subject.model,
    subject.hammerModel,
    subject.swordModel,
    subject.pistolModel,
  ];
  const roots: THREE.Object3D[] = [];
  for (const object of maybeRoots) {
    if (object) roots.push(object);
  }

  for (const root of roots) {
    root.traverse((object) => {
      if (seen.has(object.uuid)) return;
      seen.add(object.uuid);
      objects.push({
        object,
        position: object.position.clone(),
        quaternion: object.quaternion.clone(),
        scale: object.scale.clone(),
        visible: object.visible,
      });
    });
  }

  return {
    objects,
    hadLastHp: Object.prototype.hasOwnProperty.call(subject.model.userData, 'v3LastHp'),
    lastHp: subject.model.userData.v3LastHp,
  };
};

const restoreSubject = (subject: V3PoseClearanceSubject, snapshot: SubjectSnapshot): void => {
  for (const entry of snapshot.objects) {
    entry.object.position.copy(entry.position);
    entry.object.quaternion.copy(entry.quaternion);
    entry.object.scale.copy(entry.scale);
    entry.object.visible = entry.visible;
    entry.object.updateMatrix();
  }

  if (snapshot.hadLastHp) {
    subject.model.userData.v3LastHp = snapshot.lastHp;
  } else {
    delete subject.model.userData.v3LastHp;
  }
  subject.model.updateMatrixWorld(true);
};

const collectNonFiniteTransforms = (root: THREE.Object3D): string[] => {
  const names: string[] = [];
  root.traverse((object) => {
    if (
      !isFiniteVector3(object.position)
      || !isFiniteEuler(object.rotation)
      || !isFiniteVector3(object.scale)
      || !isFiniteQuaternion(object.quaternion)
    ) {
      names.push(object.name || object.uuid);
    }
  });
  return names.sort();
};

const collectPartBounds = (model: THREE.Group): PartBounds[] => {
  const rawGroups = model.userData.v3PartGroups;
  if (!rawGroups || typeof rawGroups !== 'object') return [];

  const entries = Object.entries(rawGroups as Record<string, unknown>)
    .filter((entry): entry is [string, THREE.Object3D] => isObject3D(entry[1]))
    .sort(([left], [right]) => left.localeCompare(right));

  const parts: PartBounds[] = [];
  for (const [id, object] of entries) {
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    const volume = boxVolume(bounds);
    if (volume > 0) {
      parts.push({ id, object, bounds, volume });
    }
  }
  return parts;
};

const collectDetailBoneCount = (model: THREE.Group): number => {
  const detailBones = model.userData.v3DetailBones;
  if (!detailBones || typeof detailBones !== 'object') return 0;
  return Object.values(detailBones as Record<string, unknown>).filter(isObject3D).length;
};

const findPart = (parts: PartBounds[], id: string): PartBounds | undefined =>
  parts.find((part) => part.id === id);

const findMirroredPairs = (parts: PartBounds[]): [PartBounds, PartBounds][] => {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const pairs: [PartBounds, PartBounds][] = [];

  for (const stem of MIRRORED_LIMB_STEMS) {
    const left = byId.get(`${stem}Left`) ?? byId.get(`left${stem[0].toUpperCase()}${stem.slice(1)}`);
    const right = byId.get(`${stem}Right`) ?? byId.get(`right${stem[0].toUpperCase()}${stem.slice(1)}`);
    if (left && right) pairs.push([left, right]);
  }

  return pairs;
};

const measureMirroredOverlap = (parts: PartBounds[]): { ratio: number; partIds: string[] } => {
  let maxRatio = 0;
  let maxPartIds: string[] = [];
  for (const [left, right] of findMirroredPairs(parts)) {
    const intersection = left.bounds.clone().intersect(right.bounds);
    const overlapVolume = boxVolume(intersection);
    if (overlapVolume <= 0) continue;

    const ratio = overlapVolume / Math.max(0.000001, Math.min(left.volume, right.volume));
    if (ratio > maxRatio) {
      maxRatio = ratio;
      maxPartIds = [left.id, right.id];
    }
  }
  return { ratio: roundMetric(maxRatio), partIds: maxPartIds };
};

const measureMirroredLimbGap = (parts: PartBounds[]): { gap: number; partIds: string[] } => {
  let minGap = Number.POSITIVE_INFINITY;
  let minPartIds: string[] = [];

  for (const [left, right] of findMirroredPairs(parts)) {
    const gap = distanceBetweenBoxes(left.bounds, right.bounds);
    if (gap < minGap) {
      minGap = gap;
      minPartIds = [left.id, right.id];
    }
  }

  return {
    gap: roundMetric(Number.isFinite(minGap) ? minGap : 0),
    partIds: minPartIds,
  };
};

const measureFootFloor = (
  parts: PartBounds[],
  baselineFloorY: number
): { penetration: number; lift: number; partIds: string[] } => {
  const footBounds = FOOT_PART_IDS
    .map((id) => findPart(parts, id))
    .filter((part): part is PartBounds => Boolean(part));
  if (footBounds.length === 0) {
    return {
      penetration: 0,
      lift: 0,
      partIds: [],
    };
  }

  const minFootY = Math.min(...footBounds.map((part) => part.bounds.min.y));
  return {
    penetration: roundMetric(Math.max(0, baselineFloorY - minFootY)),
    lift: roundMetric(Math.max(0, minFootY - baselineFloorY)),
    partIds: footBounds.map((part) => part.id),
  };
};

const estimateFloorY = (parts: PartBounds[], explicitFloorY?: number): number => {
  if (typeof explicitFloorY === 'number' && Number.isFinite(explicitFloorY)) {
    return explicitFloorY;
  }
  const footBounds = FOOT_PART_IDS
    .map((id) => findPart(parts, id))
    .filter((part): part is PartBounds => Boolean(part));
  if (footBounds.length > 0) {
    return Math.min(...footBounds.map((part) => part.bounds.min.y));
  }
  if (parts.length > 0) {
    return Math.min(...parts.map((part) => part.bounds.min.y));
  }
  return 0;
};

const rotationMagnitude = (object: THREE.Object3D | undefined): number => {
  if (!object) return 0;
  return Math.sqrt(
    object.rotation.x * object.rotation.x
    + object.rotation.y * object.rotation.y
    + object.rotation.z * object.rotation.z
  );
};

const measureUpperLowerCoupling = (rig: CombatantRig | undefined): number => {
  if (!rig) return 0;
  const upperMotion = Math.max(
    rotationMagnitude(rig.segmentGroups.upperTorso),
    rotationMagnitude(rig.segmentGroups.head),
    rotationMagnitude(rig.segmentGroups.leftArm),
    rotationMagnitude(rig.segmentGroups.rightArm)
  );
  const lowerMotion = Math.max(
    rotationMagnitude(rig.segmentGroups.lowerTorso) + Math.abs(rig.segmentGroups.lowerTorso.position.y),
    rotationMagnitude(rig.segmentGroups.leftLeg),
    rotationMagnitude(rig.segmentGroups.rightLeg)
  );
  return roundMetric(upperMotion > 0.001 ? lowerMotion / upperMotion : lowerMotion);
};

const getWeaponModel = (
  subject: V3PoseClearanceSubject,
  activeWeapon: 'hammer' | 'sword' | 'pistol'
): THREE.Group | null | undefined => {
  if (activeWeapon === 'sword') return subject.swordModel;
  if (activeWeapon === 'pistol') return subject.pistolModel;
  return subject.hammerModel;
};

const measureWeapon = (
  subject: V3PoseClearanceSubject,
  parts: PartBounds[],
  activeWeapon: 'hammer' | 'sword' | 'pistol'
): WeaponMeasurement | undefined => {
  const weapon = getWeaponModel(subject, activeWeapon);
  const grip = subject.rig?.attachments.thirdPersonWeaponGrip?.group;
  if (!weapon || !grip) return undefined;

  weapon.updateWorldMatrix(true, true);
  grip.updateWorldMatrix(true, false);
  const weaponPosition = weapon.getWorldPosition(new THREE.Vector3());
  const gripPosition = grip.getWorldPosition(new THREE.Vector3());
  const weaponBounds = new THREE.Box3().setFromObject(weapon);
  const bodyBounds = parts.reduce(
    (bounds, part) => bounds.union(part.bounds),
    new THREE.Box3()
  );
  const alignment = analyzeV3WeaponCarryAlignment(subject.model, weapon, activeWeapon);

  return {
    metrics: {
      activeWeapon,
      gripDrift: roundMetric(weaponPosition.distanceTo(gripPosition)),
      bodyClearance: roundMetric(
        isFiniteBox(weaponBounds) && isFiniteBox(bodyBounds)
          ? distanceBetweenBoxes(weaponBounds, bodyBounds)
          : 0
      ),
      basisForwardAlignment: alignment.basisForwardAlignment,
      basisUpAlignment: alignment.basisUpAlignment,
      primaryGripDrift: alignment.primaryGripDrift,
      offhandGripDrift: alignment.offhandGripDrift,
      twoHandReadiness: alignment.twoHandReadiness,
      oneHandReadiness: alignment.oneHandReadiness,
    },
    weaponPosition,
    gripPosition,
  };
};

const serializePoint = (point: THREE.Vector3): V3PoseClearancePoint => [
  roundMetric(point.x),
  roundMetric(point.y),
  roundMetric(point.z),
];

const serializeBounds = (part: PartBounds): V3PoseClearanceOverlayBox => ({
  partId: part.id,
  min: serializePoint(part.bounds.min),
  max: serializePoint(part.bounds.max),
});

const findPartsByIds = (parts: PartBounds[], partIds: readonly string[]): PartBounds[] => {
  const byId = new Map(parts.map((part) => [part.id, part]));
  return partIds
    .map((partId) => byId.get(partId))
    .filter((part): part is PartBounds => Boolean(part));
};

const lineBetweenParts = (
  left: PartBounds | undefined,
  right: PartBounds | undefined
): V3PoseClearanceOverlayLine | undefined => {
  if (!left || !right) return undefined;
  return {
    from: serializePoint(left.bounds.getCenter(new THREE.Vector3())),
    to: serializePoint(right.bounds.getCenter(new THREE.Vector3())),
  };
};

const floorLineForParts = (
  footParts: PartBounds[],
  floorY: number
): V3PoseClearanceOverlayLine | undefined => {
  if (footParts.length === 0) return undefined;
  const bodyBounds = footParts.reduce(
    (bounds, part) => bounds.union(part.bounds),
    new THREE.Box3()
  );
  if (!isFiniteBox(bodyBounds)) return undefined;
  const center = bodyBounds.getCenter(new THREE.Vector3());
  return {
    from: serializePoint(new THREE.Vector3(center.x, floorY, center.z)),
    to: serializePoint(new THREE.Vector3(center.x, bodyBounds.min.y, center.z)),
  };
};

const buildBaseOverlay = (
  issue: V3PoseClearanceIssue,
  kind: V3PoseClearanceOverlayKind
): V3PoseClearanceOverlay => {
  const partIds = issue.partIds ?? [];
  const overlay: V3PoseClearanceOverlay = {
    id: `${issue.caseId}:${issue.code}:${partIds.length > 0 ? partIds.join('-') : kind}`,
    caseId: issue.caseId,
    kind,
    issueCode: issue.code as V3PoseClearanceOverlayIssueCode,
    message: issue.message,
    partIds: [...partIds],
  };
  if (typeof issue.value === 'number') overlay.value = roundMetric(issue.value);
  if (typeof issue.threshold === 'number') overlay.threshold = roundMetric(issue.threshold);
  return overlay;
};

const buildV3PoseClearanceOverlays = (
  issues: V3PoseClearanceIssue[],
  parts: PartBounds[],
  floorY: number,
  weaponMeasurement: WeaponMeasurement | undefined
): V3PoseClearanceOverlay[] => {
  const overlays: V3PoseClearanceOverlay[] = [];

  for (const issue of issues) {
    if (issue.code === 'part-overlap-high') {
      const overlay = buildBaseOverlay(issue, 'part-overlap');
      const issueParts = findPartsByIds(parts, issue.partIds ?? []);
      if (issueParts.length > 0) overlay.boxes = issueParts.map(serializeBounds);
      overlays.push(overlay);
      continue;
    }

    if (issue.code === 'limb-gap-low') {
      const overlay = buildBaseOverlay(issue, 'limb-gap');
      const issueParts = findPartsByIds(parts, issue.partIds ?? []);
      if (issueParts.length > 0) overlay.boxes = issueParts.map(serializeBounds);
      overlay.line = lineBetweenParts(issueParts[0], issueParts[1]);
      overlays.push(overlay);
      continue;
    }

    if (issue.code === 'foot-floor-penetration' || issue.code === 'foot-lift-high') {
      const kind: V3PoseClearanceOverlayKind = issue.code === 'foot-floor-penetration'
        ? 'foot-floor-penetration'
        : 'foot-lift';
      const overlay = buildBaseOverlay(issue, kind);
      const footParts = findPartsByIds(parts, issue.partIds ?? FOOT_PART_IDS);
      if (footParts.length > 0) overlay.boxes = footParts.map(serializeBounds);
      overlay.floorY = roundMetric(floorY);
      overlay.line = floorLineForParts(footParts, floorY);
      overlays.push(overlay);
      continue;
    }

    if (issue.code === 'weapon-drift-high' && weaponMeasurement) {
      const overlay = buildBaseOverlay(issue, 'weapon-grip-drift');
      overlay.line = {
        from: serializePoint(weaponMeasurement.gripPosition),
        to: serializePoint(weaponMeasurement.weaponPosition),
      };
      overlays.push(overlay);
    }
  }

  return overlays;
};

const caseHorizontalSpeed = (definition: (typeof V3_POSE_CLEARANCE_CASES)[number]): number => {
  const [x, , z] = definition.vel;
  return Math.sqrt(x * x + z * z);
};

const shouldCheckStaticLimbGap = (definition: (typeof V3_POSE_CLEARANCE_CASES)[number]): boolean => (
  caseHorizontalSpeed(definition) < 0.1
  && !('isSliding' in definition && definition.isSliding)
  && !('isLunging' in definition && definition.isLunging)
  && (!('hp' in definition) || definition.hp > 0)
);

const applyPoseCase = (
  subject: V3PoseClearanceSubject,
  caseId: V3PoseClearanceCaseId
): void => {
  const definition = findCaseDefinition(caseId);
  const refs = createInitialGrifballThreeRefs();
  refs.scene = subject.model.parent instanceof THREE.Scene ? subject.model.parent : null;
  const hp = 'hp' in definition ? definition.hp : 100;
  if ('previousHp' in definition) {
    subject.model.userData.v3LastHp = definition.previousHp;
  }

  animateV3CombatantModel({
    refs,
    mesh: subject.model,
    vel: new THREE.Vector3(...definition.vel),
    yaw: 0,
    hp,
    activeWeapon: definition.activeWeapon,
    weaponState: definition.weaponState,
    weaponTimer: definition.weaponTimer,
    dt: definition.dt,
    isSliding: 'isSliding' in definition ? definition.isSliding : false,
    isSprinting: 'isSprinting' in definition ? definition.isSprinting : false,
    isLunging: 'isLunging' in definition ? definition.isLunging : false,
    animationClockMs: 1000,
    isLocalV3Animation: true,
    v3PoseAlphaOverride: 1,
    settings: { hammerAttackAnimation: 'highFidelity' },
  });

  animateV3WeaponMeshes({
    hammerModel: subject.hammerModel,
    swordModel: subject.swordModel,
    pistolModel: subject.pistolModel,
    activeWeapon: definition.activeWeapon,
    weaponState: definition.weaponState,
    weaponTimer: definition.weaponTimer,
    isLunging: 'isLunging' in definition ? Boolean(definition.isLunging) : false,
    dt: definition.dt,
    settings: { hammerAttackAnimation: 'highFidelity' },
    combatantModel: subject.model,
  });
  subject.model.updateWorldMatrix(true, true);
};

export function applyV3PoseClearanceCase(
  subject: V3PoseClearanceSubject,
  caseId: V3PoseClearanceCaseId
): void {
  applyPoseCase({
    ...subject,
    rig: subject.rig ?? getCombatantRig(subject.model),
  }, caseId);
}

const buildSummary = (cases: V3PoseClearanceCaseReport[]): V3PoseClearanceSummary => {
  const weaponDrifts = cases
    .map((testCase) => testCase.metrics.weapon?.gripDrift)
    .filter((value): value is number => typeof value === 'number');
  const limbGaps = cases.map((testCase) => testCase.metrics.limbGap);

  return {
    caseCount: cases.length,
    readyCaseCount: cases.filter((testCase) => testCase.ready).length,
    issueCount: cases.reduce((total, testCase) => total + testCase.issues.length, 0),
    maxPartOverlapRatio: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.partOverlapRatio))),
    minLimbGap: roundMetric(limbGaps.length > 0 ? Math.min(...limbGaps) : 0),
    maxWeaponGripDrift: roundMetric(Math.max(0, ...weaponDrifts)),
    maxFootFloorPenetration: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.footFloorPenetration))),
    maxFootLift: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.footLift))),
    maxUpperLowerCoupling: roundMetric(Math.max(0, ...cases.map((testCase) => testCase.metrics.upperLowerCoupling))),
  };
};

export function analyzeV3PoseClearance(
  caseId: V3PoseClearanceCaseId,
  options: V3PoseClearanceOptions = {}
): V3PoseClearanceReport {
  const definition = findCaseDefinition(caseId);
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const subject = createBuiltSubject(options);
  const inputSnapshot = options.model ? snapshotSubject(subject) : null;
  const issues: V3PoseClearanceIssue[] = [];
  const initialParts = collectPartBounds(subject.model);
  const floorY = estimateFloorY(initialParts, options.floorY);

  const initialNonFinite = collectNonFiniteTransforms(subject.model);
  if (initialNonFinite.length > 0) {
    issues.push(createIssue(
      caseId,
      'non-finite-transform',
      'pose fixture contains non-finite transforms before animation',
      { partIds: initialNonFinite.slice(0, 4) }
    ));
  }

  const hasRig = Boolean(subject.rig)
    && subject.model.userData.modelSystem === 'v3'
    && initialParts.length > 0;
  if (!hasRig) {
    issues.push(createIssue(
      caseId,
      'missing-rig',
      'V3 pose-clearance analysis requires a V3 model with combatant rig and part groups'
    ));
  } else {
    applyPoseCase(subject, caseId);
  }

  const finalNonFinite = collectNonFiniteTransforms(subject.model);
  if (finalNonFinite.length > 0 && initialNonFinite.length === 0) {
    issues.push(createIssue(
      caseId,
      'non-finite-transform',
      'pose animation produced non-finite transforms',
      { partIds: finalNonFinite.slice(0, 4) }
    ));
  }

  const parts = collectPartBounds(subject.model);
  const detailBoneCount = collectDetailBoneCount(subject.model);
  const overlap = measureMirroredOverlap(parts);
  const limbGap = measureMirroredLimbGap(parts);
  const footFloor = measureFootFloor(parts, floorY);
  const upperLowerCoupling = measureUpperLowerCoupling(subject.rig);
  const activeWeapon = ACTIVE_WEAPONS.find((weapon) => weapon === definition.activeWeapon);
  const includeWeaponMetrics = 'includeWeaponMetrics' in definition
    ? definition.includeWeaponMetrics
    : false;
  const weaponMeasurement = activeWeapon && includeWeaponMetrics
    ? measureWeapon(subject, parts, activeWeapon)
    : undefined;
  const weapon = weaponMeasurement?.metrics;
  if (hasRig && activeWeapon && includeWeaponMetrics && !weapon) {
    issues.push(createIssue(
      caseId,
      'missing-rig',
      'active V3 weapon pose requires a weapon model and third-person grip attachment for clearance analysis',
      { partIds: [activeWeapon, 'thirdPersonWeaponGrip'] }
    ));
  }

  let visualQaSummary: V3VisualQaSummary | null = null;
  try {
    const visualQa = buildV3VisualQaReport(subject.model, {
      ...DEFAULT_VISUAL_QA_OPTIONS,
      ...options.visualQaOptions,
      thresholds: {
        ...DEFAULT_VISUAL_QA_OPTIONS.thresholds,
        ...options.visualQaOptions?.thresholds,
      },
    });
    visualQaSummary = visualQa.summary;
    if (!visualQa.ready) {
      issues.push(createIssue(
        caseId,
        'visual-qa-failed',
        'V3 pose failed fixed-angle visual QA projections',
        { value: visualQa.issues.length, threshold: 0 }
      ));
    }
  } catch {
    issues.push(createIssue(
      caseId,
      'visual-qa-failed',
      'V3 pose visual QA projection could not be computed'
    ));
  }

  if (overlap.ratio > thresholds.maxPartOverlapRatio) {
    issues.push(createIssue(
      caseId,
      'part-overlap-high',
      'mirrored V3 limb part overlap exceeds the clearance ceiling',
      { value: overlap.ratio, threshold: thresholds.maxPartOverlapRatio, partIds: overlap.partIds }
    ));
  }

  if (
    limbGap.partIds.length > 0
    && limbGap.gap < thresholds.minLimbGap
    && overlap.ratio <= 0
    && shouldCheckStaticLimbGap(definition)
  ) {
    issues.push(createIssue(
      caseId,
      'limb-gap-low',
      'mirrored V3 limb gap is below the clearance floor',
      { value: limbGap.gap, threshold: thresholds.minLimbGap, partIds: limbGap.partIds }
    ));
  }

  if (weapon && weapon.gripDrift > thresholds.maxWeaponGripDrift) {
    issues.push(createIssue(
      caseId,
      'weapon-drift-high',
      'active V3 weapon has drifted too far from the rig grip',
      { value: weapon.gripDrift, threshold: thresholds.maxWeaponGripDrift, partIds: [weapon.activeWeapon] }
    ));
  }

  if (footFloor.penetration > thresholds.maxFootFloorPenetration) {
    issues.push(createIssue(
      caseId,
      'foot-floor-penetration',
      'V3 foot bounds penetrate below the neutral pose floor',
      { value: footFloor.penetration, threshold: thresholds.maxFootFloorPenetration, partIds: footFloor.partIds }
    ));
  }

  if (footFloor.lift > thresholds.maxFootLift) {
    issues.push(createIssue(
      caseId,
      'foot-lift-high',
      'V3 foot bounds lift too far above the neutral pose floor',
      { value: footFloor.lift, threshold: thresholds.maxFootLift, partIds: footFloor.partIds }
    ));
  }

  const expectUpperLowerIsolation = 'expectUpperLowerIsolation' in definition
    ? definition.expectUpperLowerIsolation
    : false;
  if (expectUpperLowerIsolation && upperLowerCoupling > thresholds.maxUpperLowerCoupling) {
    issues.push(createIssue(
      caseId,
      'upper-lower-coupling',
      'upper-body V3 weapon pose is moving the lower-body layer too strongly',
      { value: upperLowerCoupling, threshold: thresholds.maxUpperLowerCoupling }
    ));
  }

  const metrics: V3PoseClearanceMetrics = {
    partCount: parts.length,
    detailBoneCount,
    partOverlapRatio: overlap.ratio,
    limbGap: limbGap.gap,
    footFloorPenetration: footFloor.penetration,
    footLift: footFloor.lift,
    upperLowerCoupling,
    minProjectedWidth: visualQaSummary?.minProjectedWidth ?? 0,
    minProjectedHeight: visualQaSummary?.minProjectedHeight ?? 0,
    ...(weapon ? { weapon } : {}),
  };
  const overlays = buildV3PoseClearanceOverlays(issues, parts, floorY, weaponMeasurement);

  const caseReport: V3PoseClearanceCaseReport = {
    id: caseId,
    ready: issues.length === 0,
    metrics,
    overlays,
    visualQaSummary,
    issues,
  };
  const summary = buildSummary([caseReport]);

  const report = {
    ready: caseReport.ready,
    cases: [caseReport],
    summary,
    issues,
  };
  if (inputSnapshot) restoreSubject(subject, inputSnapshot);
  return report;
}

export function analyzeV3BuiltInPoseClearance(
  options: V3PoseClearanceOptions = {}
): V3PoseClearanceReport {
  const cases = V3_POSE_CLEARANCE_CASES.map((definition) => (
    analyzeV3PoseClearance(definition.id, options).cases[0]
  ));
  const issues = cases.flatMap((testCase) => testCase.issues);
  const summary = buildSummary(cases);

  return {
    ready: issues.length === 0,
    cases,
    summary,
    issues,
  };
}
