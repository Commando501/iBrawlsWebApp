import type { VisualModelPolicy } from '../../model/modelSystem';

export const REQUIRED_V3_PRODUCTION_PARITY_SURFACES = [
  'offline',
  'host',
  'client',
  'observer',
  'loadingPreview',
  'replay',
  'characterPreview',
  'firstPerson',
  'thirdPerson',
  'armorEditor',
  'animationEditor',
  'performanceSmoke',
] as const;

export type V3ProductionParitySurface = (typeof REQUIRED_V3_PRODUCTION_PARITY_SURFACES)[number];

export interface V3ProductionParityEvidence {
  surface: V3ProductionParitySurface;
  status: 'pass' | 'fail';
  modelPolicies: readonly VisualModelPolicy[];
  desktopCovered: boolean;
  mobileCovered: boolean;
  notes: string;
}

export interface V3ProductionParityReport {
  ready: boolean;
  requiredSurfaces: readonly V3ProductionParitySurface[];
  missingSurfaces: V3ProductionParitySurface[];
  failedSurfaces: V3ProductionParitySurface[];
  incompleteSurfaces: V3ProductionParitySurface[];
  evidence: V3ProductionParityEvidence[];
}

const REQUIRED_POLICIES: readonly VisualModelPolicy[] = ['v1', 'v2', 'v3'];

const hasEveryPolicy = (policies: readonly VisualModelPolicy[]): boolean =>
  REQUIRED_POLICIES.every((policy) => policies.includes(policy));

export function buildV3ProductionParityReport(
  evidence: readonly V3ProductionParityEvidence[]
): V3ProductionParityReport {
  const bySurface = new Map(evidence.map((entry) => [entry.surface, entry]));
  const missingSurfaces = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.filter((surface) => !bySurface.has(surface));
  const failedSurfaces = evidence
    .filter((entry) => entry.status === 'fail')
    .map((entry) => entry.surface);
  const incompleteSurfaces = evidence
    .filter((entry) => (
      entry.status === 'pass' && (
        !hasEveryPolicy(entry.modelPolicies) ||
        !entry.desktopCovered ||
        !entry.mobileCovered ||
        entry.notes.trim().length === 0
      )
    ))
    .map((entry) => entry.surface);

  return {
    ready: missingSurfaces.length === 0 && failedSurfaces.length === 0 && incompleteSurfaces.length === 0,
    requiredSurfaces: REQUIRED_V3_PRODUCTION_PARITY_SURFACES,
    missingSurfaces,
    failedSurfaces,
    incompleteSurfaces,
    evidence: [...evidence],
  };
}
