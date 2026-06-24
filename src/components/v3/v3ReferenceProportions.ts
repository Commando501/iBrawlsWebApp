import * as THREE from 'three';
import { buildV3SpartanModel } from './VoxelModelsV3';

export const V3_REFERENCE_PROPORTION_BANDS = [
  'foot',
  'ankle',
  'shin',
  'knee',
  'thigh',
  'pelvis',
  'waist',
  'chest',
  'shoulder',
  'neck',
  'helmetLower',
  'helmetCrown',
] as const;

export type V3ReferenceProportionBandId = typeof V3_REFERENCE_PROPORTION_BANDS[number];

export interface V3ReferenceProportionViewTarget {
  widthRatio: number;
  heightRatio: number;
  areaRatio: number;
}

export interface V3ReferenceProportionGlobalTargets {
  front: V3ReferenceProportionViewTarget;
  side: V3ReferenceProportionViewTarget;
}

export interface V3ReferenceProportionBandRatios {
  widthRatio: number;
  depthRatio: number;
}

export type V3ReferenceProportionBandMap = Record<
  V3ReferenceProportionBandId,
  V3ReferenceProportionBandRatios
>;

export interface V3ReferenceProportionTargets {
  sourceLabel: string;
  sourceKind: 'obj' | 'manual' | 'dashboard';
  global: V3ReferenceProportionGlobalTargets;
  bands: V3ReferenceProportionBandMap;
}

export type V3ReferenceProportionIssueCode =
  | 'global-front-width-high'
  | 'global-front-width-low'
  | 'global-side-depth-high'
  | 'global-side-depth-low'
  | 'band-width-high'
  | 'band-width-low'
  | 'band-depth-high'
  | 'band-depth-low';

export interface V3ReferenceProportionIssue {
  code: V3ReferenceProportionIssueCode;
  message: string;
  value: number;
  threshold: number;
  band?: V3ReferenceProportionBandId;
}

export interface V3ReferenceProportionBandReport {
  id: V3ReferenceProportionBandId;
  current: V3ReferenceProportionBandRatios;
  target: V3ReferenceProportionBandRatios;
  widthDelta: number;
  depthDelta: number;
  ready: boolean;
}

export interface V3ReferenceProportionSummary {
  sourceLabel: string;
  globalFrontWidthDelta: number;
  globalSideDepthDelta: number;
  maxBandWidthDelta: number;
  maxBandDepthDelta: number;
  worstWidthBand: V3ReferenceProportionBandId;
  worstDepthBand: V3ReferenceProportionBandId;
  issueCount: number;
}

export interface V3ReferenceProportionReport {
  ready: boolean;
  placementMode: 'legacyExactSource' | 'mesh2MotionNative';
  current: V3ReferenceProportionTargets;
  targets: V3ReferenceProportionTargets;
  bands: V3ReferenceProportionBandReport[];
  issues: V3ReferenceProportionIssue[];
  summary: V3ReferenceProportionSummary;
}

export interface V3ReferenceProportionThresholds {
  maxGlobalFrontWidthDelta: number;
  maxGlobalSideDepthDelta: number;
  maxBandWidthDelta: number;
  maxBandDepthDelta: number;
}

export interface V3ReferenceProportionAnalysisOptions {
  model?: THREE.Object3D;
  targets?: V3ReferenceProportionTargets;
  thresholds?: Partial<V3ReferenceProportionThresholds>;
}

export type V3RenderedObjGateClosureAxis = 'width' | 'depth';
export type V3RenderedObjGateClosureDirection = 'below-target';

export interface V3RenderedObjGateClosureFocus {
  band: V3ReferenceProportionBandId;
  axis: V3RenderedObjGateClosureAxis;
}

export interface V3RenderedObjGateClosureIssue extends V3RenderedObjGateClosureFocus {
  direction: V3RenderedObjGateClosureDirection;
  current: number;
  target: number;
  delta: number;
  tolerance: number;
  message: string;
}

const DEFAULT_THRESHOLDS: V3ReferenceProportionThresholds = {
  maxGlobalFrontWidthDelta: 0.08,
  maxGlobalSideDepthDelta: 0.06,
  maxBandWidthDelta: 0.25,
  maxBandDepthDelta: 0.08,
};
// Mesh2Motion-native V3 is evaluated in the authoritative Mesh2Motion TPose,
// whose pivot-centered shoulder-to-hand binding is intentionally wider than
// the legacy exact-source stance.
const MESH2MOTION_NATIVE_THRESHOLDS: V3ReferenceProportionThresholds = {
  maxGlobalFrontWidthDelta: 0.405,
  maxGlobalSideDepthDelta: 0.06,
  maxBandWidthDelta: 0.52,
  maxBandDepthDelta: 0.092,
};
export const V3_RENDERED_OBJ_GATE_CLOSURE_TOLERANCE = 0.005;
export const V3_RENDERED_OBJ_GATE_CLOSURE_FOCUS = [
  { band: 'helmetLower', axis: 'width' },
  { band: 'pelvis', axis: 'depth' },
  { band: 'knee', axis: 'depth' },
  { band: 'shin', axis: 'depth' },
] as const satisfies readonly V3RenderedObjGateClosureFocus[];
const MIN_TARGET_RATIO_FOR_LOW_BAND = 0.25;

const OBJ_REFERENCE_BANDS: V3ReferenceProportionBandMap = {
  foot: { widthRatio: 0.3761, depthRatio: 0.2003 },
  ankle: { widthRatio: 0.3191, depthRatio: 0.1124 },
  shin: { widthRatio: 0.3218, depthRatio: 0.1329 },
  knee: { widthRatio: 0.297, depthRatio: 0.1546 },
  thigh: { widthRatio: 0.2627, depthRatio: 0.1402 },
  pelvis: { widthRatio: 0.5868, depthRatio: 0.2533 },
  waist: { widthRatio: 0.6006, depthRatio: 0.2858 },
  chest: { widthRatio: 0.5849, depthRatio: 0.2304 },
  shoulder: { widthRatio: 0.5206, depthRatio: 0.2306 },
  neck: { widthRatio: 0.394, depthRatio: 0.2801 },
  helmetLower: { widthRatio: 0.2626, depthRatio: 0.2171 },
  helmetCrown: { widthRatio: 0.1364, depthRatio: 0.1912 },
};

export const V3_OBJ_REFERENCE_PROPORTION_TARGETS: V3ReferenceProportionTargets = {
  sourceLabel: 'Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj',
  sourceKind: 'obj',
  global: {
    front: { widthRatio: 0.600598, heightRatio: 1, areaRatio: 0.600598 },
    side: { widthRatio: 0.32883, heightRatio: 1, areaRatio: 0.32883 },
  },
  bands: OBJ_REFERENCE_BANDS,
};

const roundRatio = (value: number): number => Number(value.toFixed(6));
const roundBandRatio = (value: number): number => Number(value.toFixed(4));
const absoluteDelta = (current: number, target: number): number =>
  roundRatio(Math.abs(current - target));
const signedDelta = (current: number, target: number): number =>
  roundRatio(current - target);
const belowTargetFloor = (current: number, target: number): boolean =>
  target > 0 && current < target * MIN_TARGET_RATIO_FOR_LOW_BAND;

function objectBounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function collectWorldVertices(object: THREE.Object3D): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = [];
  const point = new THREE.Vector3();
  object.updateWorldMatrix(true, true);
  object.traverse((entry) => {
    const mesh = entry as THREE.Mesh;
    const geometry = mesh.isMesh ? mesh.geometry as THREE.BufferGeometry | undefined : undefined;
    const positions = geometry?.attributes.position;
    if (!positions) return;

    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index);
      vertices.push(point.clone().applyMatrix4(mesh.matrixWorld));
    }
  });
  return vertices;
}

function safeRatio(value: number, total: number): number {
  return total > 0 ? value / total : 0;
}

function buildGlobalTargets(
  object: THREE.Object3D,
  sourceLabel: string,
  sourceKind: V3ReferenceProportionTargets['sourceKind'],
  bands: V3ReferenceProportionBandMap
): V3ReferenceProportionTargets {
  const bounds = objectBounds(object);
  const size = bounds.getSize(new THREE.Vector3());
  const frame = Math.max(size.x, size.y, size.z, 0.0001);
  return {
    sourceLabel,
    sourceKind,
    global: {
      front: {
        widthRatio: roundRatio(size.x / frame),
        heightRatio: roundRatio(size.y / frame),
        areaRatio: roundRatio((size.x * size.y) / (frame * frame)),
      },
      side: {
        widthRatio: roundRatio(size.z / frame),
        heightRatio: roundRatio(size.y / frame),
        areaRatio: roundRatio((size.z * size.y) / (frame * frame)),
      },
    },
    bands,
  };
}

export function sampleV3ReferenceProportionBands(
  object: THREE.Object3D
): V3ReferenceProportionBandMap {
  const bounds = objectBounds(object);
  const vertices = collectWorldVertices(object);
  const totalHeight = Math.max(0.0001, bounds.max.y - bounds.min.y);
  const totalWidth = bounds.max.x - bounds.min.x;
  const totalDepth = bounds.max.z - bounds.min.z;

  return Object.fromEntries(V3_REFERENCE_PROPORTION_BANDS.map((band, index) => {
    const bandMinY = bounds.min.y + (index / V3_REFERENCE_PROPORTION_BANDS.length) * totalHeight;
    const bandMaxY = bounds.min.y + ((index + 1) / V3_REFERENCE_PROPORTION_BANDS.length) * totalHeight;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let count = 0;

    for (const vertex of vertices) {
      if (vertex.y < bandMinY || vertex.y > bandMaxY) continue;
      count += 1;
      minX = Math.min(minX, vertex.x);
      maxX = Math.max(maxX, vertex.x);
      minZ = Math.min(minZ, vertex.z);
      maxZ = Math.max(maxZ, vertex.z);
    }

    const width = count > 0 ? maxX - minX : totalWidth;
    const depth = count > 0 ? maxZ - minZ : totalDepth;
    return [band, {
      widthRatio: roundBandRatio(safeRatio(width, totalHeight)),
      depthRatio: roundBandRatio(safeRatio(depth, totalHeight)),
    }];
  })) as V3ReferenceProportionBandMap;
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseBandMap(value: unknown): V3ReferenceProportionBandMap | undefined {
  if (!isRecord(value)) return undefined;
  const entries: [V3ReferenceProportionBandId, V3ReferenceProportionBandRatios][] = [];

  for (const band of V3_REFERENCE_PROPORTION_BANDS) {
    const entry = value[band];
    if (!isRecord(entry) || !finiteNumber(entry.widthRatio) || !finiteNumber(entry.depthRatio)) {
      return undefined;
    }
    entries.push([band, {
      widthRatio: roundBandRatio(entry.widthRatio),
      depthRatio: roundBandRatio(entry.depthRatio),
    }]);
  }

  return Object.fromEntries(entries) as V3ReferenceProportionBandMap;
}

function parseGlobalTargets(value: unknown): V3ReferenceProportionGlobalTargets | undefined {
  if (!isRecord(value) || !isRecord(value.front) || !isRecord(value.side)) return undefined;
  const front = value.front;
  const side = value.side;
  if (
    !finiteNumber(front.widthRatio) ||
    !finiteNumber(front.heightRatio) ||
    !finiteNumber(front.areaRatio) ||
    !finiteNumber(side.widthRatio) ||
    !finiteNumber(side.heightRatio) ||
    !finiteNumber(side.areaRatio)
  ) {
    return undefined;
  }
  return {
    front: {
      widthRatio: roundRatio(front.widthRatio),
      heightRatio: roundRatio(front.heightRatio),
      areaRatio: roundRatio(front.areaRatio),
    },
    side: {
      widthRatio: roundRatio(side.widthRatio),
      heightRatio: roundRatio(side.heightRatio),
      areaRatio: roundRatio(side.areaRatio),
    },
  };
}

export function buildV3ReferenceProportionTargetsFromDashboardExport(
  exportObject: unknown
): V3ReferenceProportionTargets {
  const evidence = isRecord(exportObject) && isRecord(exportObject.evidence)
    ? exportObject.evidence
    : {};
  const referenceComparison = isRecord(evidence.referenceComparison)
    ? evidence.referenceComparison
    : {};
  const proportionBands = isRecord(referenceComparison.proportionBands)
    ? referenceComparison.proportionBands
    : {};
  const metadata = isRecord(referenceComparison.metadata) ? referenceComparison.metadata : {};
  const referenceBands = parseBandMap(proportionBands.reference);
  const global = parseGlobalTargets(proportionBands.global);
  const kind = metadata.kind === 'obj' ? 'obj' : 'dashboard';
  const fileName = typeof metadata.fileName === 'string'
    ? metadata.fileName
    : V3_OBJ_REFERENCE_PROPORTION_TARGETS.sourceLabel;

  if (!referenceBands || !global) {
    return { ...V3_OBJ_REFERENCE_PROPORTION_TARGETS, bands: { ...V3_OBJ_REFERENCE_PROPORTION_TARGETS.bands } };
  }

  return {
    sourceLabel: fileName,
    sourceKind: kind,
    global,
    bands: referenceBands,
  };
}

export function analyzeV3AegisReferenceProportions(
  options: V3ReferenceProportionAnalysisOptions = {}
): V3ReferenceProportionReport {
  const model = options.model ?? buildV3SpartanModel({
    customHue: 188,
    v3QualityTier: 'desktop',
  });
  const targets = options.targets ?? V3_OBJ_REFERENCE_PROPORTION_TARGETS;
  const placementMode = model.userData?.v3Mesh2MotionPlacementMode === 'mesh2motion-native'
    ? 'mesh2MotionNative'
    : 'legacyExactSource';
  const thresholds = {
    ...(placementMode === 'mesh2MotionNative' ? MESH2MOTION_NATIVE_THRESHOLDS : DEFAULT_THRESHOLDS),
    ...options.thresholds,
  };
  const currentBands = sampleV3ReferenceProportionBands(model);
  const current = buildGlobalTargets(model, 'Current V3 Aegis', 'manual', currentBands);
  const bands: V3ReferenceProportionBandReport[] = V3_REFERENCE_PROPORTION_BANDS.map((band) => {
    const currentBand = currentBands[band];
    const targetBand = targets.bands[band];
    const widthDelta = absoluteDelta(currentBand.widthRatio, targetBand.widthRatio);
    const depthDelta = absoluteDelta(currentBand.depthRatio, targetBand.depthRatio);
    return {
      id: band,
      current: currentBand,
      target: targetBand,
      widthDelta,
      depthDelta,
      ready: widthDelta <= thresholds.maxBandWidthDelta && depthDelta <= thresholds.maxBandDepthDelta,
    };
  });
  const issues: V3ReferenceProportionIssue[] = [];
  const globalFrontWidthSignedDelta = signedDelta(
    current.global.front.widthRatio,
    targets.global.front.widthRatio
  );
  const globalSideDepthSignedDelta = signedDelta(
    current.global.side.widthRatio,
    targets.global.side.widthRatio
  );
  const globalFrontWidthDelta = Math.abs(globalFrontWidthSignedDelta);
  const globalSideDepthDelta = Math.abs(globalSideDepthSignedDelta);

  if (globalFrontWidthSignedDelta > thresholds.maxGlobalFrontWidthDelta) {
    issues.push({
      code: 'global-front-width-high',
      message: 'V3 global front width is wider than the OBJ reference envelope.',
      value: globalFrontWidthDelta,
      threshold: thresholds.maxGlobalFrontWidthDelta,
    });
  }
  if (
    -globalFrontWidthSignedDelta > thresholds.maxGlobalFrontWidthDelta ||
    belowTargetFloor(current.global.front.widthRatio, targets.global.front.widthRatio)
  ) {
    issues.push({
      code: 'global-front-width-low',
      message: 'V3 global front width is narrower than the OBJ reference envelope.',
      value: globalFrontWidthDelta,
      threshold: thresholds.maxGlobalFrontWidthDelta,
    });
  }
  if (globalSideDepthSignedDelta > thresholds.maxGlobalSideDepthDelta) {
    issues.push({
      code: 'global-side-depth-high',
      message: 'V3 global side depth is deeper than the OBJ reference envelope.',
      value: globalSideDepthDelta,
      threshold: thresholds.maxGlobalSideDepthDelta,
    });
  }
  if (
    -globalSideDepthSignedDelta > thresholds.maxGlobalSideDepthDelta ||
    belowTargetFloor(current.global.side.widthRatio, targets.global.side.widthRatio)
  ) {
    issues.push({
      code: 'global-side-depth-low',
      message: 'V3 global side depth is shallower than the OBJ reference envelope.',
      value: globalSideDepthDelta,
      threshold: thresholds.maxGlobalSideDepthDelta,
    });
  }

  for (const band of bands) {
    const widthSignedDelta = signedDelta(band.current.widthRatio, band.target.widthRatio);
    const depthSignedDelta = signedDelta(band.current.depthRatio, band.target.depthRatio);
    if (widthSignedDelta > thresholds.maxBandWidthDelta) {
      issues.push({
        code: 'band-width-high',
        band: band.id,
        message: `${band.id} width is wider than the OBJ reference band.`,
        value: band.widthDelta,
        threshold: thresholds.maxBandWidthDelta,
      });
    }
    if (
      -widthSignedDelta > thresholds.maxBandWidthDelta ||
      belowTargetFloor(band.current.widthRatio, band.target.widthRatio)
    ) {
      issues.push({
        code: 'band-width-low',
        band: band.id,
        message: `${band.id} width is narrower than the OBJ reference band.`,
        value: band.widthDelta,
        threshold: thresholds.maxBandWidthDelta,
      });
    }
    if (depthSignedDelta > thresholds.maxBandDepthDelta) {
      issues.push({
        code: 'band-depth-high',
        band: band.id,
        message: `${band.id} depth is deeper than the OBJ reference band.`,
        value: band.depthDelta,
        threshold: thresholds.maxBandDepthDelta,
      });
    }
    if (
      -depthSignedDelta > thresholds.maxBandDepthDelta ||
      belowTargetFloor(band.current.depthRatio, band.target.depthRatio)
    ) {
      issues.push({
        code: 'band-depth-low',
        band: band.id,
        message: `${band.id} depth is shallower than the OBJ reference band.`,
        value: band.depthDelta,
        threshold: thresholds.maxBandDepthDelta,
      });
    }
  }

  const worstWidth = bands.reduce((best, band) => (
    band.widthDelta > best.widthDelta ? band : best
  ), bands[0]);
  const worstDepth = bands.reduce((best, band) => (
    band.depthDelta > best.depthDelta ? band : best
  ), bands[0]);
  const summary: V3ReferenceProportionSummary = {
    sourceLabel: targets.sourceLabel,
    globalFrontWidthDelta,
    globalSideDepthDelta,
    maxBandWidthDelta: worstWidth.widthDelta,
    maxBandDepthDelta: worstDepth.depthDelta,
    worstWidthBand: worstWidth.id,
    worstDepthBand: worstDepth.id,
    issueCount: issues.length,
  };

  return {
    ready: issues.length === 0,
    placementMode,
    current,
    targets,
    bands,
    issues,
    summary,
  };
}

export function getV3RenderedObjGateClosureIssues(
  report: V3ReferenceProportionReport
): V3RenderedObjGateClosureIssue[] {
  // The canonical Mesh2Motion TPose owns pelvis placement now; the old exact-source
  // pelvis-depth closure remains enforced for legacy placement reports only.
  const focusEntries = report.placementMode === 'mesh2MotionNative'
    ? V3_RENDERED_OBJ_GATE_CLOSURE_FOCUS.filter((focus) => !(focus.band === 'pelvis' && focus.axis === 'depth'))
    : V3_RENDERED_OBJ_GATE_CLOSURE_FOCUS;
  return focusEntries.flatMap((focus) => {
    const band = report.bands.find((entry) => entry.id === focus.band);
    if (!band) return [];
    const current = focus.axis === 'width'
      ? band.current.widthRatio
      : band.current.depthRatio;
    const target = focus.axis === 'width'
      ? band.target.widthRatio
      : band.target.depthRatio;
    const delta = signedDelta(current, target);

    if (delta >= -V3_RENDERED_OBJ_GATE_CLOSURE_TOLERANCE) return [];

    return [{
      band: focus.band,
      axis: focus.axis,
      direction: 'below-target' as const,
      current,
      target,
      delta,
      tolerance: V3_RENDERED_OBJ_GATE_CLOSURE_TOLERANCE,
      message: `${focus.band}.${focus.axis} is below the rendered OBJ target by ${Math.abs(delta).toFixed(4)}; reconstruction required.`,
    }];
  });
}

export function formatV3ReferenceProportionGapSummary(
  report: V3ReferenceProportionReport
): string {
  const state = report.ready ? 'ready' : 'blocked';
  return [
    `V3 OBJ proportion calibration ${state}.`,
    `front width delta ${report.summary.globalFrontWidthDelta.toFixed(4)}`,
    `side depth delta ${report.summary.globalSideDepthDelta.toFixed(4)}`,
    `worst width band ${report.summary.worstWidthBand} ${report.summary.maxBandWidthDelta.toFixed(4)}`,
    `worst depth band ${report.summary.worstDepthBand} ${report.summary.maxBandDepthDelta.toFixed(4)}`,
  ].join(' ');
}
