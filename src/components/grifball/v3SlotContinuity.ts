import * as THREE from 'three';
import type { V3CharacterSlotId } from '../v3/v3ModelTypes';
import type { CombatantAttachmentPointName } from './combatantRig';

export type V3SlotContinuityViewId = 'front' | 'left' | 'rear' | 'right';

export type V3SlotContinuityWarningCode =
  | 'missing-from-slot'
  | 'missing-to-slot'
  | 'missing-attachment'
  | 'slot-gap'
  | 'projected-gap';

export interface V3SlotContinuityLinkDefinition {
  id: string;
  fromSlot: V3CharacterSlotId;
  toSlot?: V3CharacterSlotId;
  attachment?: CombatantAttachmentPointName;
  label: string;
}

export interface V3SlotContinuityPoint2 {
  readonly x: number;
  readonly y: number;
}

export interface V3SlotContinuityBox {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
}

export interface V3SlotContinuityWarning {
  code: V3SlotContinuityWarningCode;
  message: string;
}

export interface V3SlotContinuityLinkReport {
  id: string;
  label: string;
  fromSlot: V3CharacterSlotId;
  toSlot?: V3CharacterSlotId;
  attachment?: CombatantAttachmentPointName;
  worldGap: number;
  projectedGap: Record<V3SlotContinuityViewId, number>;
  jointAnchorError: number;
  ready: boolean;
  warnings: V3SlotContinuityWarning[];
  endpoints: {
    from: [number, number, number];
    to: [number, number, number];
  };
  boxes: {
    from: V3SlotContinuityBox;
    to: V3SlotContinuityBox;
  };
  projectedEndpoints: Record<V3SlotContinuityViewId, {
    from: V3SlotContinuityPoint2;
    to: V3SlotContinuityPoint2;
  }>;
}

export interface V3SlotContinuitySummary {
  linkCount: number;
  failedLinkCount: number;
  warningCount: number;
  maxWorldGap: number;
  maxProjectedGap: number;
  maxJointAnchorError: number;
}

export interface V3SlotContinuityReport {
  ready: boolean;
  links: V3SlotContinuityLinkReport[];
  summary: V3SlotContinuitySummary;
}

export interface V3SlotContinuityOptions {
  maxWorldGap?: number;
  maxProjectedGap?: number;
}

export interface V3SlotContinuityOverlay {
  linkId: string;
  label: string;
  fromSlot: V3CharacterSlotId;
  toSlot?: V3CharacterSlotId;
  attachment?: CombatantAttachmentPointName;
  connector: {
    from: [number, number];
    to: [number, number];
  };
  marker: {
    world: [number, number, number];
    projected: [number, number];
  };
  warnings: V3SlotContinuityWarning[];
}

export const V3_SLOT_CONTINUITY_LINKS = [
  { id: 'chest-shoulder-left', fromSlot: 'chest', toSlot: 'shoulderLeft', label: 'chest -> shoulderLeft' },
  { id: 'chest-shoulder-right', fromSlot: 'chest', toSlot: 'shoulderRight', label: 'chest -> shoulderRight' },
  { id: 'shoulder-upperArm-left', fromSlot: 'shoulderLeft', toSlot: 'upperArmLeft', label: 'shoulderLeft -> upperArmLeft' },
  { id: 'shoulder-upperArm-right', fromSlot: 'shoulderRight', toSlot: 'upperArmRight', label: 'shoulderRight -> upperArmRight' },
  { id: 'upperArm-forearm-left', fromSlot: 'upperArmLeft', toSlot: 'forearmLeft', label: 'upperArmLeft -> forearmLeft' },
  { id: 'upperArm-forearm-right', fromSlot: 'upperArmRight', toSlot: 'forearmRight', label: 'upperArmRight -> forearmRight' },
  { id: 'forearm-hand-left', fromSlot: 'forearmLeft', toSlot: 'handLeft', label: 'forearmLeft -> handLeft' },
  { id: 'forearm-hand-right', fromSlot: 'forearmRight', toSlot: 'handRight', label: 'forearmRight -> handRight' },
  { id: 'pelvis-thigh-left', fromSlot: 'pelvis', toSlot: 'thighLeft', label: 'pelvis -> thighLeft' },
  { id: 'pelvis-thigh-right', fromSlot: 'pelvis', toSlot: 'thighRight', label: 'pelvis -> thighRight' },
  { id: 'thigh-shin-left', fromSlot: 'thighLeft', toSlot: 'shinLeft', label: 'thighLeft -> shinLeft' },
  { id: 'thigh-shin-right', fromSlot: 'thighRight', toSlot: 'shinRight', label: 'thighRight -> shinRight' },
  { id: 'shin-foot-left', fromSlot: 'shinLeft', toSlot: 'footLeft', label: 'shinLeft -> footLeft' },
  { id: 'shin-foot-right', fromSlot: 'shinRight', toSlot: 'footRight', label: 'shinRight -> footRight' },
  { id: 'chest-neck', fromSlot: 'chest', toSlot: 'neck', label: 'chest -> neck' },
  { id: 'neck-helmet', fromSlot: 'neck', toSlot: 'helmet', label: 'neck -> helmet' },
  { id: 'chest-back', fromSlot: 'chest', toSlot: 'back', label: 'chest -> back' },
  {
    id: 'hand-weapon-right',
    fromSlot: 'handRight',
    attachment: 'thirdPersonWeaponGrip',
    label: 'handRight -> thirdPersonWeaponGrip',
  },
] as const satisfies readonly V3SlotContinuityLinkDefinition[];

const VIEW_IDS: readonly V3SlotContinuityViewId[] = ['front', 'left', 'rear', 'right'];
const DEFAULT_MAX_WORLD_GAP = 0.08;
const DEFAULT_MAX_PROJECTED_GAP = 0.08;
const EMPTY_BOX = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const tuple3 = (value: THREE.Vector3): [number, number, number] => [
  roundMetric(value.x),
  roundMetric(value.y),
  roundMetric(value.z),
];

const tuple2 = (value: V3SlotContinuityPoint2): [number, number] => [
  roundMetric(value.x),
  roundMetric(value.y),
];

const boxToReport = (box: THREE.Box3): V3SlotContinuityBox => ({
  min: tuple3(box.min),
  max: tuple3(box.max),
  center: tuple3(box.getCenter(new THREE.Vector3())),
  size: tuple3(box.getSize(new THREE.Vector3())),
});

const getPartGroups = (model: THREE.Group): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
};

const getSlotObject = (model: THREE.Group, slot: V3CharacterSlotId): THREE.Object3D | undefined => {
  const fromPartGroups = getPartGroups(model)[slot];
  if (fromPartGroups instanceof THREE.Object3D) return fromPartGroups;

  const fromUserData = model.userData?.[slot];
  return fromUserData instanceof THREE.Object3D ? fromUserData : undefined;
};

const getAttachmentObject = (
  model: THREE.Group,
  attachment: CombatantAttachmentPointName
): THREE.Object3D | undefined => {
  const rigAttachment = model.userData?.combatantRig?.attachments?.[attachment]?.group;
  if (rigAttachment instanceof THREE.Object3D) return rigAttachment;

  const userDataAttachment = model.userData?.attachments?.[attachment]?.group;
  return userDataAttachment instanceof THREE.Object3D ? userDataAttachment : undefined;
};

const getObjectBox = (object: THREE.Object3D): THREE.Box3 => {
  object.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(object);
  if (!Number.isFinite(box.min.x) || box.isEmpty()) {
    const position = object.getWorldPosition(new THREE.Vector3());
    return new THREE.Box3(position.clone(), position.clone());
  }
  return box;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const closestPointsBetweenBoxes = (fromBox: THREE.Box3, toBox: THREE.Box3): {
  from: THREE.Vector3;
  to: THREE.Vector3;
  gap: number;
} => {
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();

  for (const axis of ['x', 'y', 'z'] as const) {
    if (fromBox.max[axis] < toBox.min[axis]) {
      from[axis] = fromBox.max[axis];
      to[axis] = toBox.min[axis];
    } else if (toBox.max[axis] < fromBox.min[axis]) {
      from[axis] = fromBox.min[axis];
      to[axis] = toBox.max[axis];
    } else {
      const midpoint = (Math.max(fromBox.min[axis], toBox.min[axis]) + Math.min(fromBox.max[axis], toBox.max[axis])) / 2;
      from[axis] = midpoint;
      to[axis] = midpoint;
    }
  }

  return { from, to, gap: from.distanceTo(to) };
};

const projectPoint = (point: THREE.Vector3, viewId: V3SlotContinuityViewId): V3SlotContinuityPoint2 => {
  switch (viewId) {
    case 'front':
      return { x: point.x, y: point.y };
    case 'left':
      return { x: point.z, y: point.y };
    case 'rear':
      return { x: -point.x, y: point.y };
    case 'right':
      return { x: -point.z, y: point.y };
  }
};

const distance2 = (from: V3SlotContinuityPoint2, to: V3SlotContinuityPoint2): number => {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const buildMissingLinkReport = (
  definition: V3SlotContinuityLinkDefinition,
  missingCode: V3SlotContinuityWarningCode,
  missingTarget: string
): V3SlotContinuityLinkReport => {
  const projectedEndpoints = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
  ])) as V3SlotContinuityLinkReport['projectedEndpoints'];
  const projectedGap = Object.fromEntries(VIEW_IDS.map((viewId) => [viewId, 0])) as Record<V3SlotContinuityViewId, number>;
  return {
    ...definition,
    worldGap: 0,
    projectedGap,
    jointAnchorError: 0,
    ready: false,
    warnings: [{
      code: missingCode,
      message: `${definition.label} cannot be measured because ${missingTarget} is missing`,
    }],
    endpoints: { from: [0, 0, 0], to: [0, 0, 0] },
    boxes: { from: boxToReport(EMPTY_BOX), to: boxToReport(EMPTY_BOX) },
    projectedEndpoints,
  };
};

const analyzeLink = (
  model: THREE.Group,
  definition: V3SlotContinuityLinkDefinition,
  options: Required<V3SlotContinuityOptions>
): V3SlotContinuityLinkReport => {
  const fromObject = getSlotObject(model, definition.fromSlot);
  if (!fromObject) {
    return buildMissingLinkReport(definition, 'missing-from-slot', definition.fromSlot);
  }

  const toObject = definition.toSlot
    ? getSlotObject(model, definition.toSlot)
    : definition.attachment ? getAttachmentObject(model, definition.attachment) : undefined;
  if (!toObject) {
    return buildMissingLinkReport(
      definition,
      definition.toSlot ? 'missing-to-slot' : 'missing-attachment',
      definition.toSlot ?? definition.attachment ?? 'target'
    );
  }

  const fromBox = getObjectBox(fromObject);
  const toBox = getObjectBox(toObject);
  const closest = closestPointsBetweenBoxes(fromBox, toBox);
  const projectedEndpoints = Object.fromEntries(VIEW_IDS.map((viewId) => {
    const from = projectPoint(closest.from, viewId);
    const to = projectPoint(closest.to, viewId);
    return [viewId, { from, to }];
  })) as V3SlotContinuityLinkReport['projectedEndpoints'];
  const projectedGap = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    roundMetric(distance2(projectedEndpoints[viewId].from, projectedEndpoints[viewId].to)),
  ])) as Record<V3SlotContinuityViewId, number>;
  const worldGap = roundMetric(closest.gap);
  const maxProjectedGap = Math.max(...Object.values(projectedGap));
  const warnings: V3SlotContinuityWarning[] = [];
  if (worldGap > options.maxWorldGap) {
    warnings.push({
      code: 'slot-gap',
      message: `${definition.label} has world gap ${worldGap.toFixed(3)}`,
    });
  }
  if (maxProjectedGap > options.maxProjectedGap) {
    warnings.push({
      code: 'projected-gap',
      message: `${definition.label} has projected gap ${roundMetric(maxProjectedGap).toFixed(3)}`,
    });
  }

  const fromCenter = fromBox.getCenter(new THREE.Vector3());
  const toCenter = toBox.getCenter(new THREE.Vector3());
  const jointAnchor = closest.from.clone().add(closest.to).multiplyScalar(0.5);
  const jointAnchorError = roundMetric(Math.max(
    0,
    jointAnchor.distanceTo(new THREE.Vector3(
      clamp(jointAnchor.x, Math.min(fromCenter.x, toCenter.x), Math.max(fromCenter.x, toCenter.x)),
      clamp(jointAnchor.y, Math.min(fromCenter.y, toCenter.y), Math.max(fromCenter.y, toCenter.y)),
      clamp(jointAnchor.z, Math.min(fromCenter.z, toCenter.z), Math.max(fromCenter.z, toCenter.z))
    ))
  ));

  return {
    ...definition,
    worldGap,
    projectedGap,
    jointAnchorError,
    ready: warnings.length === 0,
    warnings,
    endpoints: {
      from: tuple3(closest.from),
      to: tuple3(closest.to),
    },
    boxes: {
      from: boxToReport(fromBox),
      to: boxToReport(toBox),
    },
    projectedEndpoints,
  };
};

const buildSummary = (links: readonly V3SlotContinuityLinkReport[]): V3SlotContinuitySummary => ({
  linkCount: links.length,
  failedLinkCount: links.filter((link) => !link.ready).length,
  warningCount: links.reduce((total, link) => total + link.warnings.length, 0),
  maxWorldGap: roundMetric(Math.max(0, ...links.map((link) => link.worldGap))),
  maxProjectedGap: roundMetric(Math.max(0, ...links.flatMap((link) => Object.values(link.projectedGap)))),
  maxJointAnchorError: roundMetric(Math.max(0, ...links.map((link) => link.jointAnchorError))),
});

export function analyzeV3SlotContinuity(
  model: THREE.Group,
  options: V3SlotContinuityOptions = {}
): V3SlotContinuityReport {
  model.updateMatrixWorld(true);
  const normalizedOptions: Required<V3SlotContinuityOptions> = {
    maxWorldGap: options.maxWorldGap ?? DEFAULT_MAX_WORLD_GAP,
    maxProjectedGap: options.maxProjectedGap ?? DEFAULT_MAX_PROJECTED_GAP,
  };
  const links = V3_SLOT_CONTINUITY_LINKS.map((definition) => analyzeLink(model, definition, normalizedOptions));
  const summary = buildSummary(links);
  return {
    ready: summary.failedLinkCount === 0,
    links,
    summary,
  };
}

export function buildV3SlotContinuityOverlays(
  report: V3SlotContinuityReport,
  viewId: V3SlotContinuityViewId
): V3SlotContinuityOverlay[] {
  return report.links
    .filter((link) => !link.ready)
    .map((link) => {
      const projected = link.projectedEndpoints[viewId];
      const markerWorld = new THREE.Vector3(...link.endpoints.from)
        .add(new THREE.Vector3(...link.endpoints.to))
        .multiplyScalar(0.5);
      const markerProjected = {
        x: (projected.from.x + projected.to.x) / 2,
        y: (projected.from.y + projected.to.y) / 2,
      };
      return {
        linkId: link.id,
        label: link.label,
        fromSlot: link.fromSlot,
        toSlot: link.toSlot,
        attachment: link.attachment,
        connector: {
          from: tuple2(projected.from),
          to: tuple2(projected.to),
        },
        marker: {
          world: tuple3(markerWorld),
          projected: tuple2(markerProjected),
        },
        warnings: link.warnings,
      };
    });
}
