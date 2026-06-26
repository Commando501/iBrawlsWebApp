import {
  normalizeCustomArmorSnapshot,
  type CustomArmorMaterialRole,
  type CustomArmorPieceSnapshot,
} from '../components/customArmor';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId, type V3Vec3Tuple } from '../components/v3/v3ModelTypes';

export const V3_MESH2MOTION_TPOSE_BIND_LEGACY_DOCUMENT_KIND = 'v3-mesh2motion-tpose-bind/v1' as const;
export const V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND = 'v3-mesh2motion-tpose-bind/v2' as const;
export const V3_MESH2MOTION_TPOSE_BIND_LOCAL_STORAGE_KEY_PREFIX = 'ibrawls_v3_mesh2motion_tpose_bind_editor' as const;
export const V3_MESH2MOTION_TPOSE_BIND_LOCAL_STORAGE_BIND_VERSION = 'all-slot-mannequin-envelope-fit-v2' as const;

export type V3Mesh2MotionTPoseBindTransformMode = 'translate' | 'rotate' | 'scale';

export interface V3Mesh2MotionTPoseBindPlacement {
  slot: V3CharacterSlotId;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  mirrorOf?: V3CharacterSlotId;
}

export interface V3Mesh2MotionTPoseBindArmorSectionBounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
  voxelCount: number;
  roles: CustomArmorMaterialRole[];
}

export interface V3Mesh2MotionTPoseBindArmorSection {
  id: string;
  label: string;
  slot: V3CharacterSlotId;
  voxelKeys: string[];
  bounds: V3Mesh2MotionTPoseBindArmorSectionBounds;
}

export interface V3Mesh2MotionTPoseBindSectionTransform {
  sectionId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export interface V3Mesh2MotionTPoseBindArmorEdit {
  slot: V3CharacterSlotId;
  piece: CustomArmorPieceSnapshot;
  sections: V3Mesh2MotionTPoseBindArmorSection[];
  sectionTransforms: Record<string, V3Mesh2MotionTPoseBindSectionTransform>;
}

export interface V3Mesh2MotionTPoseBindDocument {
  kind: typeof V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND;
  version: 2;
  source: {
    meshHash: string | null;
    authoringSpace: 'mesh2motion-native-v3';
    missingPlacementSlots?: readonly V3CharacterSlotId[];
  };
  selectedSlot: V3CharacterSlotId;
  placements: Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindPlacement>;
  selectedArmorSlots: V3CharacterSlotId[];
  selectedSectionIds: string[];
  armorEdits: Partial<Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindArmorEdit>>;
}

export type V3Mesh2MotionTPoseBindDiagnosticCode =
  | 'missing-placement'
  | 'mirrored-position'
  | 'mirrored-rotation'
  | 'inverted-scale'
  | 'extreme-position'
  | 'extreme-rotation'
  | 'extreme-scale';

export interface V3Mesh2MotionTPoseBindDiagnosticItem {
  slot: V3CharacterSlotId;
  code: V3Mesh2MotionTPoseBindDiagnosticCode;
  severity: 'warn' | 'fail';
  message: string;
}

export interface V3Mesh2MotionTPoseBindDiagnosticReport {
  kind: 'v3-mesh2motion-tpose-bind-diagnostics';
  version: 1;
  ready: boolean;
  items: V3Mesh2MotionTPoseBindDiagnosticItem[];
}

export interface V3Mesh2MotionTPoseBindDiagnosticOptions {
  referencePlacements?: Partial<Record<V3CharacterSlotId, Pick<V3Mesh2MotionTPoseBindPlacement, 'rotation' | 'scale'>>>;
  referenceRotationTolerance?: number;
  referenceScaleTolerance?: number;
}

export type V3Mesh2MotionTPoseBindEditorHotkeyAction =
  | { type: 'clearSelection' }
  | { type: 'resetSelected' }
  | { type: 'resetAll' }
  | { type: 'transformMode'; mode: V3Mesh2MotionTPoseBindTransformMode }
  | { type: 'selectAdjacentSlot'; direction: -1 | 1 }
  | { type: 'commit' };

export interface V3Mesh2MotionTPoseBindEditorHotkeyInput {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  targetTagName?: string | null;
  targetIsContentEditable?: boolean;
}

export interface V3Mesh2MotionTPoseBindResetOptions {
  mode: 'selected' | 'all';
  selectedSlot?: V3CharacterSlotId | null;
}

export interface V3Mesh2MotionTPoseBindNormalizeOptions {
  trackMissingPlacements?: boolean;
}

const SLOT_SET = new Set<string>(V3_CHARACTER_SLOT_IDS);
const SORTED_SLOTS = [...V3_CHARACTER_SLOT_IDS].sort() as V3CharacterSlotId[];
const POSITION_LIMIT = 2;
const EXTREME_POSITION = 1.5;
const EXTREME_ROTATION = Math.PI * 0.75;
const EXTREME_SCALE = 3;
const MIN_SCALE_MAGNITUDE = 0.1;
const MAX_SCALE_MAGNITUDE = 4;
const CUSTOM_ARMOR_ROLE_SET = new Set<CustomArmorMaterialRole>([
  'primary',
  'secondary',
  'accent',
  'visor',
  'dark',
  'highlight',
  'undersuit',
  'emissive',
  'decal',
  'fixed',
]);

const isSlot = (value: unknown): value is V3CharacterSlotId =>
  typeof value === 'string' && SLOT_SET.has(value);

const isCustomArmorRole = (value: unknown): value is CustomArmorMaterialRole =>
  typeof value === 'string' && CUSTOM_ARMOR_ROLE_SET.has(value as CustomArmorMaterialRole);

const roundFinite = (value: number): number => {
  if (Math.abs(value) === Math.PI) return value;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampScale = (value: number): number => {
  if (value === 0) return MIN_SCALE_MAGNITUDE;
  const sign = value < 0 ? -1 : 1;
  return sign * clamp(Math.abs(value), MIN_SCALE_MAGNITUDE, MAX_SCALE_MAGNITUDE);
};

const tupleFrom = (
  value: unknown,
  fallback: V3Vec3Tuple,
  normalize: (value: number, index: number) => number
): [number, number, number] => {
  const source = Array.isArray(value) ? value : [];
  return [0, 1, 2].map((index) =>
    roundFinite(normalize(finiteOr(source[index], fallback[index]), index))
  ) as [number, number, number];
};

const identityPlacement = (slot: V3CharacterSlotId): V3Mesh2MotionTPoseBindPlacement => ({
  slot,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

export const identityV3Mesh2MotionTPoseBindSectionTransform = (
  sectionId: string
): V3Mesh2MotionTPoseBindSectionTransform => ({
  sectionId,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
});

const normalizePlacement = (
  slot: V3CharacterSlotId,
  raw: unknown
): V3Mesh2MotionTPoseBindPlacement => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const placement: V3Mesh2MotionTPoseBindPlacement = {
    slot,
    position: tupleFrom(record.position, [0, 0, 0], (value) => clamp(value, -POSITION_LIMIT, POSITION_LIMIT)),
    rotation: tupleFrom(record.rotation, [0, 0, 0], (value) => clamp(value, -Math.PI, Math.PI)),
    scale: tupleFrom(record.scale, [1, 1, 1], clampScale),
  };
  if (isSlot(record.mirrorOf) && record.mirrorOf !== slot) {
    placement.mirrorOf = record.mirrorOf;
  }
  return placement;
};

const normalizeSectionId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, 64) : null;
};

const normalizeLabel = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized.slice(0, 48) : fallback;
};

const parseVoxelKey = (key: string): [number, number, number] | null => {
  const parts = key.split(':').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((value) => !Number.isInteger(value))) return null;
  return [parts[0], parts[1], parts[2]];
};

const boundsFromVoxelKeys = (
  voxelKeys: readonly string[]
): Pick<V3Mesh2MotionTPoseBindArmorSectionBounds, 'min' | 'max' | 'center' | 'size'> => {
  const points = voxelKeys.map(parseVoxelKey).filter((point): point is [number, number, number] => point !== null);
  if (points.length === 0) {
    return {
      min: [0, 0, 0],
      max: [0, 0, 0],
      center: [0, 0, 0],
      size: [1, 1, 1],
    };
  }
  const min: [number, number, number] = [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.min(...points.map((point) => point[2])),
  ];
  const max: [number, number, number] = [
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[2])),
  ];
  return {
    min,
    max,
    center: [
      roundFinite((min[0] + max[0]) / 2),
      roundFinite((min[1] + max[1]) / 2),
      roundFinite((min[2] + max[2]) / 2),
    ],
    size: [
      roundFinite(max[0] - min[0] + 1),
      roundFinite(max[1] - min[1] + 1),
      roundFinite(max[2] - min[2] + 1),
    ],
  };
};

const normalizeMetricTuple = (
  value: unknown,
  fallback: V3Vec3Tuple,
  normalize: (value: number) => number = (candidate) => candidate
): [number, number, number] => tupleFrom(value, fallback, (candidate) => normalize(candidate));

const normalizeSectionBounds = (
  raw: unknown,
  voxelKeys: readonly string[]
): V3Mesh2MotionTPoseBindArmorSectionBounds => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const fallback = boundsFromVoxelKeys(voxelKeys);
  const roles = Array.isArray(record.roles)
    ? [...new Set(record.roles.filter(isCustomArmorRole))]
    : [];
  const voxelCount = typeof record.voxelCount === 'number' && Number.isFinite(record.voxelCount)
    ? Math.max(0, Math.round(record.voxelCount))
    : voxelKeys.length;

  return {
    min: normalizeMetricTuple(record.min, fallback.min),
    max: normalizeMetricTuple(record.max, fallback.max),
    center: normalizeMetricTuple(record.center, fallback.center),
    size: normalizeMetricTuple(record.size, fallback.size, (candidate) => Math.max(0, candidate)),
    voxelCount,
    roles,
  };
};

const normalizeArmorSection = (
  slot: V3CharacterSlotId,
  raw: unknown
): V3Mesh2MotionTPoseBindArmorSection | null => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const id = normalizeSectionId(record.id);
  if (!id) return null;
  const rawVoxelKeys = Array.isArray(record.voxelKeys) ? record.voxelKeys : [];
  const voxelKeys = [...new Set(rawVoxelKeys
    .map((value) => typeof value === 'string' ? value.trim() : '')
    .filter((value) => value.length > 0))];
  if (voxelKeys.length === 0) return null;
  return {
    id,
    label: normalizeLabel(record.label, id),
    slot,
    voxelKeys,
    bounds: normalizeSectionBounds(record.bounds, voxelKeys),
  };
};

export const normalizeV3Mesh2MotionTPoseBindSectionTransform = (
  raw: unknown,
  sectionId: string
): V3Mesh2MotionTPoseBindSectionTransform => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return {
    sectionId,
    position: tupleFrom(record.position, [0, 0, 0], (value) => clamp(value, -POSITION_LIMIT, POSITION_LIMIT)),
    rotation: tupleFrom(record.rotation, [0, 0, 0], (value) => clamp(value, -Math.PI, Math.PI)),
    scale: tupleFrom(record.scale, [1, 1, 1], clampScale),
  };
};

const normalizeArmorEdit = (
  slot: V3CharacterSlotId,
  raw: unknown
): V3Mesh2MotionTPoseBindArmorEdit | null => {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  if (isSlot(record.slot) && record.slot !== slot) return null;
  const piece = normalizeCustomArmorSnapshot(record.piece);
  if (!piece || piece.slot !== slot || piece.modelSystem !== 'v3') return null;
  const sections = Array.isArray(record.sections)
    ? record.sections.map((section) => normalizeArmorSection(slot, section)).filter((section): section is V3Mesh2MotionTPoseBindArmorSection => section !== null)
    : [];
  if (sections.length === 0) return null;
  const rawTransforms = record.sectionTransforms && typeof record.sectionTransforms === 'object'
    ? record.sectionTransforms as Record<string, unknown>
    : {};
  const sectionTransforms = Object.fromEntries(sections.map((section) => [
    section.id,
    normalizeV3Mesh2MotionTPoseBindSectionTransform(rawTransforms[section.id], section.id),
  ]));
  return {
    slot,
    piece,
    sections,
    sectionTransforms,
  };
};

const clonePlacement = (placement: V3Mesh2MotionTPoseBindPlacement): V3Mesh2MotionTPoseBindPlacement => ({
  slot: placement.slot,
  position: [...placement.position],
  rotation: [...placement.rotation],
  scale: [...placement.scale],
  ...(placement.mirrorOf ? { mirrorOf: placement.mirrorOf } : {}),
});

const cloneDocument = (document: V3Mesh2MotionTPoseBindDocument): V3Mesh2MotionTPoseBindDocument =>
  normalizeV3Mesh2MotionTPoseBindDocument(document);

const deepFreezeDocument = (
  document: V3Mesh2MotionTPoseBindDocument
): V3Mesh2MotionTPoseBindDocument => {
  Object.freeze(document.source);
  for (const placement of Object.values(document.placements)) {
    Object.freeze(placement.position);
    Object.freeze(placement.rotation);
    Object.freeze(placement.scale);
    Object.freeze(placement);
  }
  Object.freeze(document.placements);
  Object.freeze(document.selectedArmorSlots);
  Object.freeze(document.selectedSectionIds);
  for (const edit of Object.values(document.armorEdits)) {
    if (!edit) continue;
    Object.freeze(edit.piece.voxels);
    Object.freeze(edit.piece);
    for (const section of edit.sections) {
      Object.freeze(section.voxelKeys);
      Object.freeze(section.bounds.min);
      Object.freeze(section.bounds.max);
      Object.freeze(section.bounds.center);
      Object.freeze(section.bounds.size);
      Object.freeze(section.bounds.roles);
      Object.freeze(section.bounds);
      Object.freeze(section);
    }
    Object.freeze(edit.sections);
    for (const transform of Object.values(edit.sectionTransforms)) {
      Object.freeze(transform.position);
      Object.freeze(transform.rotation);
      Object.freeze(transform.scale);
      Object.freeze(transform);
    }
    Object.freeze(edit.sectionTransforms);
    Object.freeze(edit);
  }
  Object.freeze(document.armorEdits);
  return Object.freeze(document);
};

export function normalizeV3Mesh2MotionTPoseBindDocument(raw: unknown): V3Mesh2MotionTPoseBindDocument {
  return normalizeV3Mesh2MotionTPoseBindDocumentWithOptions(raw, {});
}

function normalizeV3Mesh2MotionTPoseBindDocumentWithOptions(
  raw: unknown,
  options: V3Mesh2MotionTPoseBindNormalizeOptions
): V3Mesh2MotionTPoseBindDocument {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawSource = record.source && typeof record.source === 'object'
    ? record.source as Record<string, unknown>
    : {};
  const rawPlacements = record.placements && typeof record.placements === 'object'
    ? record.placements as Record<string, unknown>
    : {};
  const rawArmorEdits = record.armorEdits && typeof record.armorEdits === 'object'
    ? record.armorEdits as Record<string, unknown>
    : {};
  const placements = {} as Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindPlacement>;
  const armorEdits: Partial<Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindArmorEdit>> = {};
  const missingPlacementSlots = new Set<V3CharacterSlotId>();
  if (Array.isArray(rawSource.missingPlacementSlots)) {
    for (const slot of rawSource.missingPlacementSlots) {
      if (isSlot(slot)) missingPlacementSlots.add(slot);
    }
  }

  for (const slot of SORTED_SLOTS) {
    if (options.trackMissingPlacements && !Object.prototype.hasOwnProperty.call(rawPlacements, slot)) {
      missingPlacementSlots.add(slot);
    }
    placements[slot] = normalizePlacement(slot, rawPlacements[slot]);
    const armorEdit = normalizeArmorEdit(slot, rawArmorEdits[slot]);
    if (armorEdit) armorEdits[slot] = armorEdit;
  }

  const selectedSlot = isSlot(record.selectedSlot) ? record.selectedSlot : V3_CHARACTER_SLOT_IDS[0];
  const selectedArmorSlots = Array.isArray(record.selectedArmorSlots)
    ? [...new Set(record.selectedArmorSlots.filter(isSlot))]
    : [];
  const selectedSectionIds = Array.isArray(record.selectedSectionIds)
    ? [...new Set(record.selectedSectionIds
      .map(normalizeSectionId)
      .filter((sectionId): sectionId is string => sectionId !== null))]
    : [];
  const source: V3Mesh2MotionTPoseBindDocument['source'] = {
    meshHash: typeof rawSource.meshHash === 'string' && rawSource.meshHash.length > 0
      ? rawSource.meshHash
      : null,
    authoringSpace: 'mesh2motion-native-v3',
  };
  if (missingPlacementSlots.size > 0) {
    source.missingPlacementSlots = SORTED_SLOTS.filter((slot) => missingPlacementSlots.has(slot));
  }

  return {
    kind: V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND,
    version: 2,
    source,
    selectedSlot,
    placements,
    selectedArmorSlots,
    selectedSectionIds,
    armorEdits,
  };
}

export function serializeV3Mesh2MotionTPoseBindDocument(
  document: V3Mesh2MotionTPoseBindDocument
): string {
  return JSON.stringify(normalizeV3Mesh2MotionTPoseBindDocument(document), null, 2);
}

export function buildV3Mesh2MotionTPoseBindLocalStorageKey(
  sourceHash: string,
  foundationHash: string
): string {
  return [
    V3_MESH2MOTION_TPOSE_BIND_LOCAL_STORAGE_KEY_PREFIX,
    sourceHash,
    foundationHash,
    V3_MESH2MOTION_TPOSE_BIND_LOCAL_STORAGE_BIND_VERSION,
  ].join(':');
}

export function parseV3Mesh2MotionTPoseBindDocumentJson(json: string): V3Mesh2MotionTPoseBindDocument {
  return normalizeV3Mesh2MotionTPoseBindDocumentWithOptions(JSON.parse(json) as unknown, {
    trackMissingPlacements: true,
  });
}

export function resetV3Mesh2MotionTPoseBindPlacements(
  document: V3Mesh2MotionTPoseBindDocument,
  options: V3Mesh2MotionTPoseBindResetOptions
): V3Mesh2MotionTPoseBindDocument {
  const next = cloneDocument(document);
  if (options.mode === 'all') {
    for (const slot of SORTED_SLOTS) {
      next.placements[slot] = identityPlacement(slot);
    }
    return next;
  }

  const slot = options.selectedSlot ?? next.selectedSlot;
  if (isSlot(slot)) {
    next.placements[slot] = identityPlacement(slot);
    next.selectedSlot = slot;
  }
  return next;
}

const addDiagnostic = (
  items: V3Mesh2MotionTPoseBindDiagnosticItem[],
  slot: V3CharacterSlotId,
  code: V3Mesh2MotionTPoseBindDiagnosticCode,
  severity: 'warn' | 'fail',
  message: string
): void => {
  items.push({ slot, code, severity, message });
};

const hasAnyMagnitudeOver = (tuple: readonly number[], threshold: number): boolean =>
  tuple.some((value) => Math.abs(value) > threshold);

const tupleCloseTo = (left: readonly number[], right: readonly number[], tolerance: number): boolean =>
  left.length === right.length &&
  left.every((value, index) => Math.abs(value - (right[index] ?? 0)) <= tolerance);

const hasExpectedSourcePoseRotation = (
  placement: V3Mesh2MotionTPoseBindPlacement,
  options: V3Mesh2MotionTPoseBindDiagnosticOptions
): boolean => {
  const reference = options.referencePlacements?.[placement.slot]?.rotation;
  if (!reference) return false;
  return tupleCloseTo(
    placement.rotation,
    reference,
    Number.isFinite(options.referenceRotationTolerance) ? options.referenceRotationTolerance ?? 0.05 : 0.05
  );
};

const hasExpectedGeneratedScale = (
  placement: V3Mesh2MotionTPoseBindPlacement,
  options: V3Mesh2MotionTPoseBindDiagnosticOptions
): boolean => {
  const reference = options.referencePlacements?.[placement.slot]?.scale;
  if (!reference) return false;
  return tupleCloseTo(
    placement.scale,
    reference,
    Number.isFinite(options.referenceScaleTolerance) ? options.referenceScaleTolerance ?? 0.01 : 0.01
  );
};

const mirrorPartnerMismatch = (
  placement: V3Mesh2MotionTPoseBindPlacement,
  partner: V3Mesh2MotionTPoseBindPlacement
): boolean => {
  const xMatches = Math.abs(placement.position[0] + partner.position[0]) <= 0.05;
  const yMatches = Math.abs(placement.position[1] - partner.position[1]) <= 0.05;
  const zMatches = Math.abs(placement.position[2] - partner.position[2]) <= 0.05;
  return !(xMatches && yMatches && zMatches);
};

export function buildV3Mesh2MotionTPoseBindDiagnostics(
  document: V3Mesh2MotionTPoseBindDocument,
  options: V3Mesh2MotionTPoseBindDiagnosticOptions = {}
): V3Mesh2MotionTPoseBindDiagnosticReport {
  const normalized = normalizeV3Mesh2MotionTPoseBindDocument(document);
  const items: V3Mesh2MotionTPoseBindDiagnosticItem[] = [];

  for (const slot of SORTED_SLOTS) {
    const placement = normalized.placements[slot];
    if (normalized.source.missingPlacementSlots?.includes(slot)) {
      addDiagnostic(items, slot, 'missing-placement', 'fail', `${slot} placement was missing from the imported bind document`);
    }
    if (placement.mirrorOf) {
      const partner = normalized.placements[placement.mirrorOf];
      if (partner && mirrorPartnerMismatch(placement, partner)) {
        addDiagnostic(items, slot, 'mirrored-position', 'warn', `${slot} is not mirrored across X from ${placement.mirrorOf}`);
      }
      if (partner && Math.abs(placement.rotation[1] + partner.rotation[1]) > 0.1) {
        addDiagnostic(items, slot, 'mirrored-rotation', 'warn', `${slot} yaw is not mirrored from ${placement.mirrorOf}`);
      }
    }
    if (placement.scale.some((value) => value < 0)) {
      addDiagnostic(items, slot, 'inverted-scale', 'fail', `${slot} has negative scale`);
    }
    if (hasAnyMagnitudeOver(placement.position, EXTREME_POSITION)) {
      addDiagnostic(items, slot, 'extreme-position', 'warn', `${slot} position is outside the recommended bind range`);
    }
    if (hasAnyMagnitudeOver(placement.rotation, EXTREME_ROTATION) && !hasExpectedSourcePoseRotation(placement, options)) {
      addDiagnostic(items, slot, 'extreme-rotation', 'warn', `${slot} rotation is outside the recommended bind range`);
    }
    if (
      placement.scale.some((value) => Math.abs(value) > EXTREME_SCALE || Math.abs(value) < 0.25) &&
      !hasExpectedGeneratedScale(placement, options)
    ) {
      addDiagnostic(items, slot, 'extreme-scale', 'warn', `${slot} scale is outside the recommended bind range`);
    }
  }

  return {
    kind: 'v3-mesh2motion-tpose-bind-diagnostics',
    version: 1,
    ready: items.length === 0,
    items,
  };
}

export function resolveV3Mesh2MotionTPoseBindEditorHotkey({
  key,
  shiftKey = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
  targetTagName = null,
  targetIsContentEditable = false,
}: V3Mesh2MotionTPoseBindEditorHotkeyInput): V3Mesh2MotionTPoseBindEditorHotkeyAction | null {
  const tagName = targetTagName?.toUpperCase() ?? '';
  if (targetIsContentEditable || tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') {
    return null;
  }
  if (ctrlKey || metaKey || altKey) return null;

  if (key === 'Escape') return { type: 'clearSelection' };
  if (key === 'ArrowLeft') return { type: 'selectAdjacentSlot', direction: -1 };
  if (key === 'ArrowRight') return { type: 'selectAdjacentSlot', direction: 1 };
  if (key === 'Enter') return { type: 'commit' };

  switch (key.toLowerCase()) {
    case 'r':
      return shiftKey ? { type: 'resetAll' } : { type: 'resetSelected' };
    case 'w':
      return { type: 'transformMode', mode: 'translate' };
    case 'e':
      return { type: 'transformMode', mode: 'rotate' };
    case 's':
      return { type: 'transformMode', mode: 'scale' };
    default:
      return null;
  }
}

export const V3_MESH2MOTION_TPOSE_BIND_EDITOR_DEFAULT_DOCUMENT = deepFreezeDocument(
  normalizeV3Mesh2MotionTPoseBindDocument({})
);

export function cloneV3Mesh2MotionTPoseBindPlacement(
  placement: V3Mesh2MotionTPoseBindPlacement
): V3Mesh2MotionTPoseBindPlacement {
  return clonePlacement(placement);
}
