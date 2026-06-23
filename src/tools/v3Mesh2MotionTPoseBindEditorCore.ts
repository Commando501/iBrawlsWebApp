import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId, type V3Vec3Tuple } from '../components/v3/v3ModelTypes';

export const V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND = 'v3-mesh2motion-tpose-bind/v1' as const;

export type V3Mesh2MotionTPoseBindTransformMode = 'translate' | 'rotate' | 'scale';

export interface V3Mesh2MotionTPoseBindPlacement {
  slot: V3CharacterSlotId;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  mirrorOf?: V3CharacterSlotId;
}

export interface V3Mesh2MotionTPoseBindDocument {
  kind: typeof V3_MESH2MOTION_TPOSE_BIND_DOCUMENT_KIND;
  version: 1;
  source: {
    meshHash: string | null;
    authoringSpace: 'mesh2motion-native-v3';
    missingPlacementSlots?: readonly V3CharacterSlotId[];
  };
  selectedSlot: V3CharacterSlotId;
  placements: Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindPlacement>;
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

const isSlot = (value: unknown): value is V3CharacterSlotId =>
  typeof value === 'string' && SLOT_SET.has(value);

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
  const placements = {} as Record<V3CharacterSlotId, V3Mesh2MotionTPoseBindPlacement>;
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
  }

  const selectedSlot = isSlot(record.selectedSlot) ? record.selectedSlot : V3_CHARACTER_SLOT_IDS[0];
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
    version: 1,
    source,
    selectedSlot,
    placements,
  };
}

export function serializeV3Mesh2MotionTPoseBindDocument(
  document: V3Mesh2MotionTPoseBindDocument
): string {
  return JSON.stringify(normalizeV3Mesh2MotionTPoseBindDocument(document), null, 2);
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
  document: V3Mesh2MotionTPoseBindDocument
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
    if (hasAnyMagnitudeOver(placement.rotation, EXTREME_ROTATION)) {
      addDiagnostic(items, slot, 'extreme-rotation', 'warn', `${slot} rotation is outside the recommended bind range`);
    }
    if (placement.scale.some((value) => Math.abs(value) > EXTREME_SCALE || Math.abs(value) < 0.25)) {
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
