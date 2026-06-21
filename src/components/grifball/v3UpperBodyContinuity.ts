import type * as THREE from 'three';
import type { V3SlotContinuityViewId } from './v3SlotContinuity';
import {
  analyzeV3SlotContinuity,
  type V3SlotContinuityLinkReport,
} from './v3SlotContinuity';

export type V3UpperBodyContinuityLinkId =
  | 'chest-shoulder-left'
  | 'chest-shoulder-right'
  | 'shoulder-upperArm-left'
  | 'shoulder-upperArm-right'
  | 'upperArm-forearm-left'
  | 'upperArm-forearm-right'
  | 'forearm-hand-left'
  | 'forearm-hand-right';

export interface V3UpperBodyContinuityLinkReport {
  id: V3UpperBodyContinuityLinkId;
  label: string;
  ready: boolean;
  visibleGap: number;
  projectedGap: Record<V3SlotContinuityViewId, number>;
  jointAnchorError: number;
  warnings: string[];
}

export interface V3UpperBodyContinuityReport {
  kind: 'v3-upper-body-continuity';
  version: 1;
  ready: boolean;
  maxVisibleGap: number;
  maxProjectedGap: number;
  maxJointAnchorError: number;
  warningCount: number;
  issues: string[];
  links: V3UpperBodyContinuityLinkReport[];
}

const UPPER_BODY_LINK_IDS = new Set<string>([
  'chest-shoulder-left',
  'chest-shoulder-right',
  'shoulder-upperArm-left',
  'shoulder-upperArm-right',
  'upperArm-forearm-left',
  'upperArm-forearm-right',
  'forearm-hand-left',
  'forearm-hand-right',
]);

const DEFAULT_MAX_VISIBLE_GAP = 0.055;
const DEFAULT_MAX_PROJECTED_GAP = 0.06;
const DEFAULT_MAX_JOINT_ANCHOR_ERROR = 0.08;

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const maxProjectedGap = (link: V3SlotContinuityLinkReport): number =>
  roundMetric(Math.max(0, ...Object.values(link.projectedGap)));

const maxUpperBodyProjectedGap = (link: V3UpperBodyContinuityLinkReport): number =>
  roundMetric(Math.max(0, ...Object.values(link.projectedGap)));

const toUpperBodyLink = (link: V3SlotContinuityLinkReport): V3UpperBodyContinuityLinkReport => ({
  id: link.id as V3UpperBodyContinuityLinkId,
  label: link.label,
  ready: (
    link.ready &&
    link.worldGap <= DEFAULT_MAX_VISIBLE_GAP &&
    maxProjectedGap(link) <= DEFAULT_MAX_PROJECTED_GAP &&
    link.jointAnchorError <= DEFAULT_MAX_JOINT_ANCHOR_ERROR
  ),
  visibleGap: link.worldGap,
  projectedGap: link.projectedGap,
  jointAnchorError: link.jointAnchorError,
  warnings: link.warnings.map((warning) => `${warning.code}: ${warning.message}`),
});

export function analyzeV3UpperBodyContinuity(model: THREE.Group): V3UpperBodyContinuityReport {
  const slotReport = analyzeV3SlotContinuity(model, {
    maxWorldGap: DEFAULT_MAX_VISIBLE_GAP,
    maxProjectedGap: DEFAULT_MAX_PROJECTED_GAP,
  });
  const links = slotReport.links
    .filter((link) => UPPER_BODY_LINK_IDS.has(link.id))
    .map(toUpperBodyLink);
  const issues = links
    .filter((link) => !link.ready)
    .map((link) => `${link.id} visible ${link.visibleGap.toFixed(3)} projected ${maxUpperBodyProjectedGap(link).toFixed(3)}`);
  const maxVisibleGap = roundMetric(Math.max(0, ...links.map((link) => link.visibleGap)));
  const maxProjected = roundMetric(Math.max(0, ...links.map((link) => Math.max(0, ...Object.values(link.projectedGap)))));
  const maxJointAnchorError = roundMetric(Math.max(0, ...links.map((link) => link.jointAnchorError)));
  const warningCount = links.reduce((total, link) => total + link.warnings.length + (link.ready ? 0 : 1), 0);

  return {
    kind: 'v3-upper-body-continuity',
    version: 1,
    ready: issues.length === 0,
    maxVisibleGap,
    maxProjectedGap: maxProjected,
    maxJointAnchorError,
    warningCount,
    issues,
    links,
  };
}
