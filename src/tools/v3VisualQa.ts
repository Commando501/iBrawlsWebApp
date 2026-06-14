import * as THREE from 'three';

export const V3_VISUAL_QA_VIEW_IDS = ['front', 'side', 'rear', 'threeQuarter'] as const;
export type V3VisualQaViewId = typeof V3_VISUAL_QA_VIEW_IDS[number];

export const V3_VISUAL_QA_VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 844 },
} as const;
export type V3VisualQaViewportId = keyof typeof V3_VISUAL_QA_VIEWPORTS;

export type V3VisualQaIssueCode =
  | 'missing_visual_mass'
  | 'occupied_area_low'
  | 'occupied_area_high'
  | 'dark_coverage_high'
  | 'emissive_coverage_high'
  | 'panel_count_low'
  | 'material_groups_low'
  | 'important_part_missing';

export interface V3VisualQaSnapshot {
  viewId: V3VisualQaViewId;
  viewportId: V3VisualQaViewportId;
  viewport: { width: number; height: number };
  occupiedAreaRatio: number;
  projectedWidth: number;
  projectedHeight: number;
  silhouetteAspect: number;
  panelCount: number;
  materialGroupCount: number;
  darkMaterialCoverage: number;
  emissiveMaterialCoverage: number;
  importantPartVisibility: Record<string, boolean>;
}

export interface V3VisualQaIssue {
  code: V3VisualQaIssueCode;
  message: string;
  viewId?: V3VisualQaViewId;
  viewportId?: V3VisualQaViewportId;
  value?: number;
  threshold?: number;
  partId?: string;
}

export interface V3VisualQaSummary {
  snapshotCount: number;
  minOccupiedAreaRatio: number;
  maxOccupiedAreaRatio: number;
  minProjectedWidth: number;
  minProjectedHeight: number;
  maxDarkMaterialCoverage: number;
  maxEmissiveMaterialCoverage: number;
  panelCount: number;
  materialGroupCount: number;
  visibleImportantPartCount: number;
  importantPartCount: number;
}

export interface V3VisualQaReport {
  ready: boolean;
  snapshots: V3VisualQaSnapshot[];
  issues: V3VisualQaIssue[];
  summary: V3VisualQaSummary;
}

export interface V3VisualQaThresholds {
  minOccupiedAreaRatio: number;
  maxOccupiedAreaRatio: number;
  maxDarkMaterialCoverage: number;
  maxEmissiveMaterialCoverage: number;
  minPanelCount: number;
  minMaterialGroupCount: number;
}

export interface V3VisualQaOptions {
  thresholds?: Partial<V3VisualQaThresholds>;
  importantPartIds?: string[];
  frameHeight?: number;
}

interface MeshSample {
  bounds: THREE.Box3;
  dark: boolean;
  emissive: boolean;
}

const DEFAULT_THRESHOLDS: V3VisualQaThresholds = {
  minOccupiedAreaRatio: 0.015,
  maxOccupiedAreaRatio: 0.82,
  maxDarkMaterialCoverage: 0.82,
  maxEmissiveMaterialCoverage: 0.38,
  minPanelCount: 12,
  minMaterialGroupCount: 3,
};

const DEFAULT_IMPORTANT_PART_IDS = [
  'head',
  'upperTorso',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
];

const VIEW_YAWS: Record<V3VisualQaViewId, number> = {
  front: 0,
  side: Math.PI / 2,
  rear: Math.PI,
  threeQuarter: Math.PI / 4,
};

const ROUND_DIGITS = 6;
const EMPTY_BOX = new THREE.Box3();

const roundMetric = (value: number): number => (
  Number.isFinite(value) ? Number(value.toFixed(ROUND_DIGITS)) : 0
);

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function materialColor(material: THREE.Material): THREE.Color | undefined {
  const maybeColored = material as THREE.Material & { color?: THREE.Color };
  return maybeColored.color?.isColor === true ? maybeColored.color : undefined;
}

function materialKey(material: THREE.Material): string {
  const color = materialColor(material);
  const emissive = (material as THREE.MeshStandardMaterial).emissive;
  const emissiveIntensity = (material as THREE.MeshStandardMaterial).emissiveIntensity ?? 0;
  return [
    material.uuid,
    color ? color.getHexString() : 'vertex',
    emissive?.isColor === true ? emissive.getHexString() : 'none',
    emissiveIntensity > 0 ? 'emissive' : 'standard',
  ].join(':');
}

function isDarkMaterial(material: THREE.Material): boolean {
  const color = materialColor(material);
  return color ? color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.16 : false;
}

function isEmissiveMaterial(material: THREE.Material): boolean {
  const standard = material as THREE.MeshStandardMaterial;
  return standard.emissive?.isColor === true
    && (standard.emissiveIntensity ?? 0) > 0
    && standard.emissive.getHex() !== 0;
}

function collectMeshes(subject: THREE.Object3D): MeshSample[] {
  subject.updateWorldMatrix(true, true);
  const meshes: MeshSample[] = [];
  subject.traverse((object) => {
    if (!isMesh(object) || object.visible === false) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    const materials = materialList(object.material);
    meshes.push({
      bounds,
      dark: materials.length > 0 && materials.every(isDarkMaterial),
      emissive: materials.some(isEmissiveMaterial),
    });
  });
  return meshes;
}

function collectSurfaceTotals(subject: THREE.Object3D): {
  panelCount: number;
  materialGroupCount: number;
} {
  let panelCount = 0;
  const materialGroups = new Set<string>();

  subject.traverse((object) => {
    const report = object.userData.v3ArmorSurface as { panelCount?: unknown; materialGroupCount?: unknown } | undefined;
    if (report && typeof report.panelCount === 'number') {
      panelCount += report.panelCount;
    }
    if (report && typeof report.materialGroupCount === 'number') {
      materialGroups.add(`surface:${object.uuid}:${report.materialGroupCount}`);
    }
    if (isMesh(object)) {
      for (const material of materialList(object.material)) {
        materialGroups.add(object.userData.v3MaterialKey ?? materialKey(material));
      }
    }
  });

  return {
    panelCount,
    materialGroupCount: materialGroups.size,
  };
}

function projectBox(
  bounds: THREE.Box3,
  center: THREE.Vector3,
  yaw: number
): { minX: number; maxX: number; minY: number; maxY: number; area: number } {
  const corners = [
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.min.x, bounds.max.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.min.y, bounds.max.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.min.z),
    new THREE.Vector3(bounds.max.x, bounds.max.y, bounds.max.z),
  ];
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    const dx = corner.x - center.x;
    const dz = corner.z - center.z;
    const projectedX = (dx * cos) - (dz * sin);
    minX = Math.min(minX, projectedX);
    maxX = Math.max(maxX, projectedX);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return { minX, maxX, minY, maxY, area: width * height };
}

function aggregateProjection(
  meshes: MeshSample[],
  center: THREE.Vector3,
  yaw: number
): {
  width: number;
  height: number;
  area: number;
  darkArea: number;
  emissiveArea: number;
  materialArea: number;
} {
  if (meshes.length === 0) {
    return { width: 0, height: 0, area: 0, darkArea: 0, emissiveArea: 0, materialArea: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let darkArea = 0;
  let emissiveArea = 0;
  let materialArea = 0;

  for (const sample of meshes) {
    const projection = projectBox(sample.bounds, center, yaw);
    minX = Math.min(minX, projection.minX);
    maxX = Math.max(maxX, projection.maxX);
    minY = Math.min(minY, projection.minY);
    maxY = Math.max(maxY, projection.maxY);
    materialArea += projection.area;
    if (sample.dark) darkArea += projection.area;
    if (sample.emissive) emissiveArea += projection.area;
  }

  const width = Math.max(0, maxX - minX);
  const height = Math.max(0, maxY - minY);
  return {
    width,
    height,
    area: width * height,
    darkArea,
    emissiveArea,
    materialArea,
  };
}

function resolveFrameHeight(bounds: THREE.Box3, options?: V3VisualQaOptions): number {
  if (typeof options?.frameHeight === 'number' && Number.isFinite(options.frameHeight) && options.frameHeight > 0) {
    return options.frameHeight;
  }
  const height = bounds.isEmpty() ? 0 : bounds.max.y - bounds.min.y;
  return Math.max(2.6, height * 1.18);
}

function resolveImportantPartIds(options?: V3VisualQaOptions): string[] {
  return options?.importantPartIds ?? DEFAULT_IMPORTANT_PART_IDS;
}

function findImportantPart(subject: THREE.Object3D, partId: string): THREE.Object3D | undefined {
  const direct = subject.userData[partId];
  if (direct instanceof THREE.Object3D) return direct;
  const partGroups = subject.userData.v3PartGroups as Record<string, THREE.Object3D | undefined> | undefined;
  return partGroups?.[partId];
}

function buildImportantPartVisibility(
  subject: THREE.Object3D,
  importantPartIds: string[]
): Record<string, boolean> {
  const visibility: Record<string, boolean> = {};
  for (const partId of importantPartIds) {
    const part = findImportantPart(subject, partId);
    const bounds = part ? new THREE.Box3().setFromObject(part) : undefined;
    visibility[partId] = Boolean(part && part.visible !== false && bounds && !bounds.isEmpty());
  }
  return visibility;
}

function resolveViewportFrameWidth(frameHeight: number, viewport: { width: number; height: number }, projectionWidth: number): number {
  const viewportAspect = viewport.width / Math.max(1, viewport.height);
  const aspectWidth = frameHeight * viewportAspect;
  const projectionWidthWithPadding = projectionWidth * 1.12;
  return Math.max(0.1, aspectWidth, projectionWidthWithPadding);
}

export function buildV3VisualQaSnapshots(
  subject: THREE.Object3D,
  options: V3VisualQaOptions = {}
): V3VisualQaSnapshot[] {
  const meshes = collectMeshes(subject);
  const subjectBounds = meshes.reduce(
    (bounds, sample) => bounds.union(sample.bounds),
    EMPTY_BOX.clone()
  );
  const center = subjectBounds.isEmpty() ? new THREE.Vector3() : subjectBounds.getCenter(new THREE.Vector3());
  const frameHeight = resolveFrameHeight(subjectBounds, options);
  const surfaceTotals = collectSurfaceTotals(subject);
  const importantPartVisibility = buildImportantPartVisibility(subject, resolveImportantPartIds(options));
  const snapshots: V3VisualQaSnapshot[] = [];

  for (const viewId of V3_VISUAL_QA_VIEW_IDS) {
    const projection = aggregateProjection(meshes, center, VIEW_YAWS[viewId]);
    const darkMaterialCoverage = projection.materialArea > 0 ? projection.darkArea / projection.materialArea : 0;
    const emissiveMaterialCoverage = projection.materialArea > 0 ? projection.emissiveArea / projection.materialArea : 0;

    for (const viewportId of Object.keys(V3_VISUAL_QA_VIEWPORTS) as V3VisualQaViewportId[]) {
      const viewport = V3_VISUAL_QA_VIEWPORTS[viewportId];
      const frameWidth = resolveViewportFrameWidth(frameHeight, viewport, projection.width);
      const frameArea = frameWidth * frameHeight;
      const occupiedAreaRatio = frameArea > 0 ? projection.area / frameArea : 0;
      snapshots.push({
        viewId,
        viewportId,
        viewport,
        occupiedAreaRatio: roundMetric(occupiedAreaRatio),
        projectedWidth: roundMetric(projection.width),
        projectedHeight: roundMetric(projection.height),
        silhouetteAspect: roundMetric(projection.height > 0 ? projection.width / projection.height : 0),
        panelCount: surfaceTotals.panelCount,
        materialGroupCount: surfaceTotals.materialGroupCount,
        darkMaterialCoverage: roundMetric(darkMaterialCoverage),
        emissiveMaterialCoverage: roundMetric(emissiveMaterialCoverage),
        importantPartVisibility: { ...importantPartVisibility },
      });
    }
  }

  return snapshots;
}

function pushSnapshotIssue(
  issues: V3VisualQaIssue[],
  snapshot: V3VisualQaSnapshot,
  code: V3VisualQaIssueCode,
  message: string,
  value: number,
  threshold: number
): void {
  issues.push({
    code,
    message,
    viewId: snapshot.viewId,
    viewportId: snapshot.viewportId,
    value,
    threshold,
  });
}

function summarizeSnapshots(snapshots: V3VisualQaSnapshot[]): V3VisualQaSummary {
  const occupied = snapshots.map((snapshot) => snapshot.occupiedAreaRatio);
  const widths = snapshots.map((snapshot) => snapshot.projectedWidth);
  const heights = snapshots.map((snapshot) => snapshot.projectedHeight);
  const first = snapshots[0];
  const visibilityValues = first ? Object.values(first.importantPartVisibility) : [];

  return {
    snapshotCount: snapshots.length,
    minOccupiedAreaRatio: roundMetric(occupied.length > 0 ? Math.min(...occupied) : 0),
    maxOccupiedAreaRatio: roundMetric(occupied.length > 0 ? Math.max(...occupied) : 0),
    minProjectedWidth: roundMetric(widths.length > 0 ? Math.min(...widths) : 0),
    minProjectedHeight: roundMetric(heights.length > 0 ? Math.min(...heights) : 0),
    maxDarkMaterialCoverage: roundMetric(Math.max(0, ...snapshots.map((snapshot) => snapshot.darkMaterialCoverage))),
    maxEmissiveMaterialCoverage: roundMetric(Math.max(0, ...snapshots.map((snapshot) => snapshot.emissiveMaterialCoverage))),
    panelCount: first?.panelCount ?? 0,
    materialGroupCount: first?.materialGroupCount ?? 0,
    visibleImportantPartCount: visibilityValues.filter(Boolean).length,
    importantPartCount: visibilityValues.length,
  };
}

export function buildV3VisualQaReport(
  subject: THREE.Object3D,
  options: V3VisualQaOptions = {}
): V3VisualQaReport {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...options.thresholds };
  const snapshots = buildV3VisualQaSnapshots(subject, options);
  const summary = summarizeSnapshots(snapshots);
  const issues: V3VisualQaIssue[] = [];

  if (summary.minProjectedWidth === 0 || summary.minProjectedHeight === 0) {
    issues.push({
      code: 'missing_visual_mass',
      message: 'subject has no projected visual mass in at least one fixed-angle view',
    });
  }

  for (const snapshot of snapshots) {
    if (snapshot.occupiedAreaRatio < thresholds.minOccupiedAreaRatio) {
      pushSnapshotIssue(
        issues,
        snapshot,
        'occupied_area_low',
        'projected occupied area is below the readability floor',
        snapshot.occupiedAreaRatio,
        thresholds.minOccupiedAreaRatio
      );
    }
    if (snapshot.occupiedAreaRatio > thresholds.maxOccupiedAreaRatio) {
      pushSnapshotIssue(
        issues,
        snapshot,
        'occupied_area_high',
        'projected occupied area exceeds the readability frame',
        snapshot.occupiedAreaRatio,
        thresholds.maxOccupiedAreaRatio
      );
    }
    if (snapshot.darkMaterialCoverage > thresholds.maxDarkMaterialCoverage) {
      pushSnapshotIssue(
        issues,
        snapshot,
        'dark_coverage_high',
        'dark material coverage obscures silhouette readability',
        snapshot.darkMaterialCoverage,
        thresholds.maxDarkMaterialCoverage
      );
    }
    if (snapshot.emissiveMaterialCoverage > thresholds.maxEmissiveMaterialCoverage) {
      pushSnapshotIssue(
        issues,
        snapshot,
        'emissive_coverage_high',
        'emissive material coverage is too dominant',
        snapshot.emissiveMaterialCoverage,
        thresholds.maxEmissiveMaterialCoverage
      );
    }
  }

  if (summary.panelCount < thresholds.minPanelCount) {
    issues.push({
      code: 'panel_count_low',
      message: 'V3 surface panel count is below the readability floor',
      value: summary.panelCount,
      threshold: thresholds.minPanelCount,
    });
  }
  if (summary.materialGroupCount < thresholds.minMaterialGroupCount) {
    issues.push({
      code: 'material_groups_low',
      message: 'material group count is below the readability floor',
      value: summary.materialGroupCount,
      threshold: thresholds.minMaterialGroupCount,
    });
  }

  for (const [partId, visible] of Object.entries(snapshots[0]?.importantPartVisibility ?? {})) {
    if (!visible) {
      issues.push({
        code: 'important_part_missing',
        message: `important V3 part ${partId} is not visible`,
        partId,
      });
    }
  }

  return {
    ready: issues.length === 0,
    snapshots,
    issues,
    summary,
  };
}
