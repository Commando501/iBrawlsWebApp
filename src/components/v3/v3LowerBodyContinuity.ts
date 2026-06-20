import * as THREE from 'three';
import type { V3CharacterSlotId } from './v3ModelTypes';

export type V3LowerBodyContinuityViewId = 'front' | 'left' | 'rear' | 'right';

export interface V3LowerBodyContinuityPoint2 {
  x: number;
  y: number;
}

export interface V3LowerBodyContinuityWarning {
  code: string;
  message: string;
}

export type V3LowerBodySeamWarningCode =
  | 'missing-from-slot'
  | 'missing-to-slot'
  | 'lower-body-seam-gap'
  | 'lower-body-projected-seam-gap';

export interface V3LowerBodySeamLinkDefinition {
  id: string;
  fromSlot: V3CharacterSlotId | 'lowerTorso';
  toSlot: V3CharacterSlotId;
  label: string;
  side?: 'left' | 'right' | 'center';
}

export interface V3LowerBodySeamIssue {
  linkId: string;
  label: string;
  viewId: V3LowerBodyContinuityViewId;
  maxSeamGap: number;
  projectedSeamGap: number;
  warnings: string[];
}

export interface V3LowerBodySeamLinkReport {
  id: string;
  label: string;
  fromSlot: V3LowerBodySeamLinkDefinition['fromSlot'];
  toSlot: V3CharacterSlotId;
  side: 'left' | 'right' | 'center';
  ready: boolean;
  maxSeamGap: number;
  projectedGap: Record<V3LowerBodyContinuityViewId, number>;
  warnings: Array<V3LowerBodyContinuityWarning & { code: V3LowerBodySeamWarningCode }>;
  endpoints: {
    from: [number, number, number];
    to: [number, number, number];
  };
  projectedEndpoints: Record<V3LowerBodyContinuityViewId, {
    from: V3LowerBodyContinuityPoint2;
    to: V3LowerBodyContinuityPoint2;
  }>;
}

export interface V3LowerBodyContinuitySummary {
  linkCount: number;
  failedLinkCount: number;
  maxLowerBodySeamGap: number;
  maxLowerBodyProjectedSeamGap: number;
  lowerBodyTearWarningCount: number;
}

export interface V3LowerBodyContinuityReport {
  ready: boolean;
  links: V3LowerBodySeamLinkReport[];
  summary: V3LowerBodyContinuitySummary;
}

export interface V3LowerBodyContinuityOptions {
  maxSeamGap?: number;
  maxProjectedSeamGap?: number;
  useRestBaseline?: boolean;
}

export interface V3LowerBodyRestSeamBaseline {
  maxSeamGap: number;
  projectedGap: Record<V3LowerBodyContinuityViewId, number>;
}

export type V3LowerBodyRestSeamBaselines = Record<string, V3LowerBodyRestSeamBaseline>;

export interface V3LowerBodyContinuityOverlay {
  linkId: string;
  label: string;
  connector: {
    from: [number, number];
    to: [number, number];
  };
  marker: {
    world: [number, number, number];
    projected: [number, number];
  };
  warnings: Array<V3LowerBodyContinuityWarning & { code: V3LowerBodySeamWarningCode }>;
}

export const V3_LOWER_BODY_SEAM_LINKS = [
  { id: 'lowerTorso-pelvis', fromSlot: 'lowerTorso', toSlot: 'pelvis', label: 'lowerTorso -> pelvis', side: 'center' },
  { id: 'pelvis-thigh-left', fromSlot: 'pelvis', toSlot: 'thighLeft', label: 'pelvis -> thighLeft', side: 'left' },
  { id: 'pelvis-thigh-right', fromSlot: 'pelvis', toSlot: 'thighRight', label: 'pelvis -> thighRight', side: 'right' },
  { id: 'thigh-shin-left', fromSlot: 'thighLeft', toSlot: 'shinLeft', label: 'thighLeft -> shinLeft', side: 'left' },
  { id: 'thigh-shin-right', fromSlot: 'thighRight', toSlot: 'shinRight', label: 'thighRight -> shinRight', side: 'right' },
  { id: 'shin-foot-left', fromSlot: 'shinLeft', toSlot: 'footLeft', label: 'shinLeft -> footLeft', side: 'left' },
  { id: 'shin-foot-right', fromSlot: 'shinRight', toSlot: 'footRight', label: 'shinRight -> footRight', side: 'right' },
] as const satisfies readonly V3LowerBodySeamLinkDefinition[];

const VIEW_IDS: readonly V3LowerBodyContinuityViewId[] = ['front', 'left', 'rear', 'right'];
const DEFAULT_MAX_SEAM_GAP = 0.16;
const DEFAULT_MAX_PROJECTED_SEAM_GAP = 0.16;
const EMPTY_VECTOR = new THREE.Vector3();

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

const tuple2 = (value: V3LowerBodyContinuityPoint2): [number, number] => [
  roundMetric(value.x),
  roundMetric(value.y),
];

const getPartGroups = (model: THREE.Object3D): Partial<Record<V3CharacterSlotId, THREE.Object3D>> => {
  const candidate = model.userData?.v3PartGroups;
  return candidate && typeof candidate === 'object'
    ? candidate as Partial<Record<V3CharacterSlotId, THREE.Object3D>>
    : {};
};

const getSlotObject = (model: THREE.Object3D, slot: V3LowerBodySeamLinkDefinition['fromSlot']): THREE.Object3D | undefined => {
  if (slot === 'lowerTorso') {
    return model.userData?.lowerTorso instanceof THREE.Object3D ? model.userData.lowerTorso : undefined;
  }
  const fromPartGroups = getPartGroups(model)[slot];
  if (fromPartGroups instanceof THREE.Object3D) return fromPartGroups;
  const fromUserData = model.userData?.[slot];
  return fromUserData instanceof THREE.Object3D ? fromUserData : undefined;
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

const projectPoint = (point: THREE.Vector3, viewId: V3LowerBodyContinuityViewId): V3LowerBodyContinuityPoint2 => {
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

const distance2 = (from: V3LowerBodyContinuityPoint2, to: V3LowerBodyContinuityPoint2): number => {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  return Math.sqrt(dx * dx + dy * dy);
};

const sideAnchorX = (
  upperBox: THREE.Box3,
  lowerBox: THREE.Box3,
  side: 'left' | 'right' | 'center'
): number => {
  if (side === 'center') return upperBox.getCenter(new THREE.Vector3()).x;
  const center = upperBox.getCenter(new THREE.Vector3()).x;
  const size = upperBox.getSize(new THREE.Vector3()).x;
  const fallback = center + (side === 'left' ? -size * 0.25 : size * 0.25);
  const lowerCenter = lowerBox.getCenter(new THREE.Vector3()).x;
  const isLowerOnExpectedSide = side === 'left' ? lowerCenter < center : lowerCenter > center;
  return isLowerOnExpectedSide ? lowerCenter : fallback;
};

const seamAnchors = (
  fromBox: THREE.Box3,
  toBox: THREE.Box3,
  side: 'left' | 'right' | 'center'
): { from: THREE.Vector3; to: THREE.Vector3 } => {
  const fromCenter = fromBox.getCenter(new THREE.Vector3());
  const toCenter = toBox.getCenter(new THREE.Vector3());
  const x = sideAnchorX(fromBox, toBox, side);
  return {
    from: new THREE.Vector3(
      x,
      fromCenter.y >= toCenter.y ? fromBox.min.y : fromBox.max.y,
      fromCenter.z
    ),
    to: new THREE.Vector3(
      toCenter.x,
      fromCenter.y >= toCenter.y ? toBox.max.y : toBox.min.y,
      toCenter.z
    ),
  };
};

const missingReport = (
  definition: V3LowerBodySeamLinkDefinition,
  code: V3LowerBodySeamWarningCode,
  missingTarget: string
): V3LowerBodySeamLinkReport => {
  const projectedEndpoints = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } },
  ])) as V3LowerBodySeamLinkReport['projectedEndpoints'];
  const projectedGap = Object.fromEntries(VIEW_IDS.map((viewId) => [viewId, 0])) as Record<V3LowerBodyContinuityViewId, number>;
  return {
    ...definition,
    side: definition.side ?? 'center',
    ready: false,
    maxSeamGap: 0,
    projectedGap,
    warnings: [{ code, message: `${definition.label} cannot be measured because ${missingTarget} is missing` }],
    endpoints: { from: [0, 0, 0], to: [0, 0, 0] },
    projectedEndpoints,
  };
};

const getRestBaseline = (
  model: THREE.Object3D,
  linkId: string,
  useRestBaseline: boolean
): V3LowerBodyRestSeamBaseline | undefined => {
  if (!useRestBaseline) return undefined;
  const baselines = model.userData?.v3LowerBodyRestSeamBaselines as V3LowerBodyRestSeamBaselines | undefined;
  return baselines?.[linkId];
};

const analyzeLink = (
  model: THREE.Object3D,
  definition: V3LowerBodySeamLinkDefinition,
  options: Required<V3LowerBodyContinuityOptions>
): V3LowerBodySeamLinkReport => {
  const fromObject = getSlotObject(model, definition.fromSlot);
  if (!fromObject) return missingReport(definition, 'missing-from-slot', definition.fromSlot);
  const toObject = getSlotObject(model, definition.toSlot);
  if (!toObject) return missingReport(definition, 'missing-to-slot', definition.toSlot);

  const anchors = seamAnchors(getObjectBox(fromObject), getObjectBox(toObject), definition.side ?? 'center');
  const projectedEndpoints = Object.fromEntries(VIEW_IDS.map((viewId) => {
    const from = projectPoint(anchors.from, viewId);
    const to = projectPoint(anchors.to, viewId);
    return [viewId, { from, to }];
  })) as V3LowerBodySeamLinkReport['projectedEndpoints'];
  const projectedGap = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    roundMetric(distance2(projectedEndpoints[viewId].from, projectedEndpoints[viewId].to)),
  ])) as Record<V3LowerBodyContinuityViewId, number>;
  const baseline = getRestBaseline(model, definition.id, options.useRestBaseline);
  const maxSeamGap = roundMetric(Math.max(0, anchors.from.distanceTo(anchors.to) - (baseline?.maxSeamGap ?? 0)));
  const normalizedProjectedGap = Object.fromEntries(VIEW_IDS.map((viewId) => [
    viewId,
    roundMetric(Math.max(0, projectedGap[viewId] - (baseline?.projectedGap[viewId] ?? 0))),
  ])) as Record<V3LowerBodyContinuityViewId, number>;
  const maxProjectedGap = Math.max(...Object.values(normalizedProjectedGap));
  const warnings: V3LowerBodySeamLinkReport['warnings'] = [];
  if (maxSeamGap > options.maxSeamGap) {
    warnings.push({
      code: 'lower-body-seam-gap',
      message: `${definition.label} has lower-body seam gap ${maxSeamGap.toFixed(3)}`,
    });
  }
  if (maxProjectedGap > options.maxProjectedSeamGap) {
    warnings.push({
      code: 'lower-body-projected-seam-gap',
      message: `${definition.label} has projected lower-body seam gap ${roundMetric(maxProjectedGap).toFixed(3)}`,
    });
  }

  return {
    ...definition,
    side: definition.side ?? 'center',
    ready: warnings.length === 0,
    maxSeamGap,
    projectedGap: normalizedProjectedGap,
    warnings,
    endpoints: {
      from: tuple3(anchors.from),
      to: tuple3(anchors.to),
    },
    projectedEndpoints,
  };
};

const summary = (links: readonly V3LowerBodySeamLinkReport[]): V3LowerBodyContinuitySummary => ({
  linkCount: links.length,
  failedLinkCount: links.filter((link) => !link.ready).length,
  maxLowerBodySeamGap: roundMetric(Math.max(0, ...links.map((link) => link.maxSeamGap))),
  maxLowerBodyProjectedSeamGap: roundMetric(Math.max(0, ...links.flatMap((link) => Object.values(link.projectedGap)))),
  lowerBodyTearWarningCount: links.reduce((total, link) => total + link.warnings.length, 0),
});

export function analyzeV3LowerBodyContinuity(
  model: THREE.Object3D,
  options: V3LowerBodyContinuityOptions = {}
): V3LowerBodyContinuityReport {
  model.updateMatrixWorld(true);
  const normalizedOptions: Required<V3LowerBodyContinuityOptions> = {
    maxSeamGap: options.maxSeamGap ?? DEFAULT_MAX_SEAM_GAP,
    maxProjectedSeamGap: options.maxProjectedSeamGap ?? DEFAULT_MAX_PROJECTED_SEAM_GAP,
    useRestBaseline: options.useRestBaseline ?? true,
  };
  const links = V3_LOWER_BODY_SEAM_LINKS.map((definition) => analyzeLink(model, definition, normalizedOptions));
  const reportSummary = summary(links);
  return {
    ready: reportSummary.failedLinkCount === 0,
    links,
    summary: reportSummary,
  };
}

export function captureV3LowerBodyRestSeamBaselines(
  model: THREE.Object3D
): V3LowerBodyRestSeamBaselines {
  const report = analyzeV3LowerBodyContinuity(model, {
    maxSeamGap: Number.POSITIVE_INFINITY,
    maxProjectedSeamGap: Number.POSITIVE_INFINITY,
    useRestBaseline: false,
  });
  return Object.fromEntries(report.links.map((link) => [
    link.id,
    {
      maxSeamGap: link.maxSeamGap,
      projectedGap: { ...link.projectedGap },
    },
  ])) as V3LowerBodyRestSeamBaselines;
}

export function buildV3LowerBodyContinuityOverlays(
  report: V3LowerBodyContinuityReport,
  viewId: V3LowerBodyContinuityViewId
): V3LowerBodyContinuityOverlay[] {
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

export function getV3LowerBodySeamAnchorPair(
  model: THREE.Object3D,
  linkId: string
): { from: THREE.Vector3; to: THREE.Vector3 } | null {
  const definition = V3_LOWER_BODY_SEAM_LINKS.find((link) => link.id === linkId);
  if (!definition) return null;
  const fromObject = getSlotObject(model, definition.fromSlot);
  const toObject = getSlotObject(model, definition.toSlot);
  if (!fromObject || !toObject) return null;
  const anchors = seamAnchors(getObjectBox(fromObject), getObjectBox(toObject), definition.side ?? 'center');
  return {
    from: anchors.from.clone(),
    to: anchors.to.clone(),
  };
}

export function midpointForLowerBodySeam(
  model: THREE.Object3D,
  linkId: string
): THREE.Vector3 {
  const anchors = getV3LowerBodySeamAnchorPair(model, linkId);
  if (!anchors) return EMPTY_VECTOR.clone();
  return anchors.from.add(anchors.to).multiplyScalar(0.5);
}
