import type { VoxelData } from './VoxelModels';
import {
  getV2PartDimensions,
  V2_PART_CONSTRAINTS,
} from './v2ArmorConstraints';
import {
  V3_CHARACTER_SLOT_IDS,
  type V3CharacterSlotId,
} from './v3/v3ModelTypes';
import {
  getDefaultV3CharacterLoadout,
  getV3CharacterPartManifest,
} from './v3/v3AssetManifest';
import { getV3CharacterPartBounds } from './v3/v3PartBounds';
import { getV3Mesh2MotionNativeSlotDimensions } from './v3/v3Mesh2MotionNativeGeometry';
import { sanitizeV3RolePaintPayload } from './v3/v3PaintPalette';
import { resolveCharacterModelType } from '../characterModelTypes';
import { isModelSystem } from '../model/modelSystem';
import type { ModelSystem } from '../model/modelSystem';
import type { CharacterModelType } from '../types';

export type V2CustomArmorSlot = 'helmet' | 'torso' | 'arm' | 'leg';
export type V3CustomArmorSlot = V3CharacterSlotId;
export type CustomArmorSlot = V2CustomArmorSlot | V3CustomArmorSlot;
export type CustomArmorModelSystem = Extract<ModelSystem, 'v2' | 'v3'>;
export type CustomArmorGridScale = 1 | 2;
export type CustomArmorV3CoordinateSpace = 'legacy-grid' | 'mesh2motion-native';
export type CustomArmorMaterialRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'visor'
  | 'dark'
  | 'highlight'
  | 'undersuit'
  | 'emissive'
  | 'decal'
  | 'fixed';

export interface CustomArmorVoxel {
  x: number;
  y: number;
  z: number;
  role: CustomArmorMaterialRole;
  color?: string;
  emissive?: boolean;
}

export interface CustomArmorPieceSnapshot {
  version: 1;
  id: string;
  name: string;
  slot: CustomArmorSlot;
  modelSystem?: CustomArmorModelSystem;
  modelType?: CharacterModelType;
  gridScale?: CustomArmorGridScale;
  v3CoordinateSpace?: CustomArmorV3CoordinateSpace;
  sourcePreset?: string;
  voxels: CustomArmorVoxel[];
  thumbnail?: string;
  updatedAt: number;
}

export interface CustomArmorPiece extends CustomArmorPieceSnapshot {
  createdAt: number;
  history?: CustomArmorPieceSnapshot[];
}

export interface CustomArmorCatalog {
  version: 1;
  pieces: CustomArmorPiece[];
}

export interface CustomArmorValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    voxelCount: number;
    payloadBytes: number;
    components: number;
    bounds?: CustomArmorBounds;
    subpartCounts: Record<string, number>;
    anchorCluster: boolean;
    modelSystem: CustomArmorModelSystem;
    v3Slot?: V3CharacterSlotId;
  };
}

export interface CustomArmorBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface CustomArmorColors {
  primary: string;
  secondary: string;
  accent: string;
  visor: string;
  dark: string;
  highlight: string;
}

interface SlotSpec {
  label: string;
  bounds: CustomArmorBounds;
  minTotal: number;
  minAxisSpan: number;
  maxVoxels: number;
  subparts: Array<{
    name: string;
    min: number;
    includes: (voxel: CustomArmorVoxel | VoxelData) => boolean;
  }>;
}

export const CUSTOM_ARMOR_CATALOG_STORAGE_KEY = 'grifball_custom_armor_catalog';
export const CUSTOM_ARMOR_DRAFT_STORAGE_KEY = 'grifball_custom_armor_draft';
export const CUSTOM_ARMOR_MAX_CATALOG_PIECES = 64;
export const CUSTOM_ARMOR_MAX_SELECTED_BYTES = 256_000;
export const CUSTOM_ARMOR_MAX_CATALOG_BYTES = 2_000_000;
export const CUSTOM_ARMOR_MAX_HISTORY = 5;
export const DEFAULT_V3_CUSTOM_ARMOR_GRID_SCALE: CustomArmorGridScale = 1;

const MEDIUM_CUSTOM_ARMOR_SLOT_SPECS: Record<V2CustomArmorSlot, SlotSpec> = {
  helmet: {
    label: 'Helmet',
    bounds: { minX: -4, maxX: 4, minY: 35, maxY: 45, minZ: -5, maxZ: 4 },
    minTotal: 120,
    minAxisSpan: 5,
    maxVoxels: 900,
    subparts: [
      { name: 'neck', min: 6, includes: (v) => v.y === 35 },
      { name: 'head', min: 90, includes: (v) => v.y > 35 },
    ],
  },
  torso: {
    label: 'Chest',
    bounds: { minX: -6, maxX: 6, minY: 11, maxY: 34, minZ: -5, maxZ: 5 },
    minTotal: 300,
    minAxisSpan: 7,
    maxVoxels: 1_600,
    subparts: [
      { name: 'stomach', min: 80, includes: (v) => v.y <= 18 },
      { name: 'chest', min: 180, includes: (v) => v.y >= 19 },
    ],
  },
  arm: {
    label: 'Arms',
    bounds: { minX: -9, maxX: -4, minY: 12, maxY: 32, minZ: -4, maxZ: 3 },
    minTotal: 120,
    minAxisSpan: 5,
    maxVoxels: 900,
    subparts: [
      { name: 'shoulder', min: 50, includes: (v) => v.y >= 25 },
      { name: 'arm_upper', min: 24, includes: (v) => v.y >= 20 && v.y <= 24 },
      { name: 'arm_lower', min: 20, includes: (v) => v.y >= 16 && v.y <= 19 },
      { name: 'hand', min: 8, includes: (v) => v.y <= 15 },
    ],
  },
  leg: {
    label: 'Legs',
    bounds: { minX: -5, maxX: -1, minY: 0, maxY: 23, minZ: -4, maxZ: 3 },
    minTotal: 140,
    minAxisSpan: 6,
    maxVoxels: 1_000,
    subparts: [
      { name: 'leg_upper', min: 50, includes: (v) => v.y >= 17 },
      { name: 'leg_lower', min: 60, includes: (v) => v.y >= 8 && v.y <= 16 },
      { name: 'foot', min: 20, includes: (v) => v.y >= 3 && v.y <= 7 },
      { name: 'toes', min: 6, includes: (v) => v.y <= 2 },
    ],
  },
};

const LARGE_CUSTOM_ARMOR_SLOT_SPECS: Record<V2CustomArmorSlot, SlotSpec> = {
  helmet: {
    ...MEDIUM_CUSTOM_ARMOR_SLOT_SPECS.helmet,
    minTotal: 160,
    maxVoxels: 1_200,
  },
  torso: {
    ...MEDIUM_CUSTOM_ARMOR_SLOT_SPECS.torso,
    bounds: { minX: -6, maxX: 6, minY: 11, maxY: 34, minZ: -6, maxZ: 7 },
    minTotal: 380,
    maxVoxels: 3_800,
  },
  arm: {
    ...MEDIUM_CUSTOM_ARMOR_SLOT_SPECS.arm,
    bounds: { minX: -10, maxX: -4, minY: 12, maxY: 32, minZ: -4, maxZ: 4 },
    minTotal: 150,
    maxVoxels: 1_600,
  },
  leg: {
    ...MEDIUM_CUSTOM_ARMOR_SLOT_SPECS.leg,
    bounds: { minX: -6, maxX: -1, minY: 0, maxY: 23, minZ: -7, maxZ: 6 },
    minTotal: 180,
    maxVoxels: 2_000,
  },
};

export const V2_CUSTOM_ARMOR_SLOTS = ['helmet', 'torso', 'arm', 'leg'] as const;
export const V3_CUSTOM_ARMOR_SLOTS = V3_CHARACTER_SLOT_IDS;
const V2_SLOT_SET = new Set<CustomArmorSlot>(V2_CUSTOM_ARMOR_SLOTS);
const V3_SLOT_SET = new Set<CustomArmorSlot>(V3_CUSTOM_ARMOR_SLOTS);

export const CUSTOM_ARMOR_SLOT_SPECS: Record<V2CustomArmorSlot, SlotSpec> = MEDIUM_CUSTOM_ARMOR_SLOT_SPECS;

export function getCustomArmorSlotSpec(
  slot: CustomArmorSlot,
  modelType: CharacterModelType = 'medium'
): SlotSpec {
  const v2Slot = V2_SLOT_SET.has(slot) ? slot as V2CustomArmorSlot : 'helmet';
  return (modelType === 'large' ? LARGE_CUSTOM_ARMOR_SLOT_SPECS : MEDIUM_CUSTOM_ARMOR_SLOT_SPECS)[v2Slot];
}

const PRESET_FIELDS = {
  helmet: new Set(['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb']),
  torso: new Set(['mark-vi', 'scout', 'recon', 'eod', 'hayabusa']),
  arm: new Set(['mark-vi', 'odst', 'recon', 'eod', 'hayabusa']),
  leg: new Set(['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa']),
  hammerPreset: new Set(['default', 'akelas', 'akelus', 'paegaas', 'sepulotez', 'halbashi', 'eektah-fel', 'gravity-axe', 'gravity-mace', 'fist-of-rukt']),
  swordPreset: new Set(['default', 'halo-ce', 'halo-2', 'halo-3', 'reach', 'anniversary', 'halo-4', 'h2a-blue', 'h2a-pink', 'halo-5', 'infinite']),
};

const ROLE_SET = new Set<CustomArmorMaterialRole>([
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
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const coordKey = (v: { x: number; y: number; z: number }) => `${v.x},${v.y},${v.z}`;
const cloneVoxel = (voxel: CustomArmorVoxel): CustomArmorVoxel => ({ ...voxel });

function getDefaultV3CharacterPartManifestForSlot(slot: V3CharacterSlotId) {
  const manifestId = getDefaultV3CharacterLoadout().partIds[slot];
  const manifest = getV3CharacterPartManifest(manifestId);
  if (!manifest) {
    throw new Error(`Missing default V3 character part manifest for ${slot}`);
  }
  return manifest;
}

export function normalizeCustomArmorGridScale(
  value: unknown,
  fallback: CustomArmorGridScale = 1
): CustomArmorGridScale {
  return value === 2 ? 2 : value === 1 ? 1 : fallback;
}

const getV3EditableBounds = (
  slot: V3CharacterSlotId,
  gridScale: CustomArmorGridScale = 1,
  coordinateSpace: CustomArmorV3CoordinateSpace = 'mesh2motion-native'
): CustomArmorBounds => {
  if (coordinateSpace === 'mesh2motion-native') {
    const [x, y, z] = getV3Mesh2MotionNativeSlotDimensions(slot);
    return {
      minX: 0,
      maxX: x - 1,
      minY: 0,
      maxY: y - 1,
      minZ: 0,
      maxZ: z - 1,
    };
  }
  const dimensions = getV3CharacterPartBounds(slot).maxDimensions;
  return {
    minX: 0,
    maxX: dimensions.x * gridScale - 1,
    minY: 0,
    maxY: dimensions.y * gridScale - 1,
    minZ: 0,
    maxZ: dimensions.z * gridScale - 1,
  };
};

const mapLegacyCoordinateToNative = (
  value: number,
  legacyMin: number,
  legacyMax: number,
  nativeMax: number
): number => {
  if (nativeMax <= 0 || legacyMax <= legacyMin) return 0;
  const ratio = (value - legacyMin) / (legacyMax - legacyMin);
  return Math.max(0, Math.min(nativeMax, Math.round(ratio * nativeMax)));
};

const normalizeLegacyGridCoordinate = (
  value: number,
  gridScale: CustomArmorGridScale
): number => Math.floor(value / Math.max(1, gridScale));

export function convertCustomArmorV3VoxelsToNative(
  slot: V3CharacterSlotId,
  voxels: readonly CustomArmorVoxel[],
  gridScale: CustomArmorGridScale = 1,
  coordinateSpace: CustomArmorV3CoordinateSpace = 'legacy-grid'
): CustomArmorVoxel[] {
  if (coordinateSpace === 'mesh2motion-native') {
    const nativeBounds = getV3EditableBounds(slot, 1, 'mesh2motion-native');
    return dedupeCustomArmorVoxels(voxels.map((voxel) => ({
      ...cloneVoxel(voxel),
      x: Math.max(nativeBounds.minX, Math.min(nativeBounds.maxX, Math.round(voxel.x))),
      y: Math.max(nativeBounds.minY, Math.min(nativeBounds.maxY, Math.round(voxel.y))),
      z: Math.max(nativeBounds.minZ, Math.min(nativeBounds.maxZ, Math.round(voxel.z))),
    })));
  }

  const legacyBounds = getV3EditableBounds(slot, 1, 'legacy-grid');
  const nativeBounds = getV3EditableBounds(slot, 1, 'mesh2motion-native');
  return dedupeCustomArmorVoxels(voxels.map((voxel) => ({
    ...cloneVoxel(voxel),
    x: mapLegacyCoordinateToNative(normalizeLegacyGridCoordinate(voxel.x, gridScale), legacyBounds.minX, legacyBounds.maxX, nativeBounds.maxX),
    y: mapLegacyCoordinateToNative(normalizeLegacyGridCoordinate(voxel.y, gridScale), legacyBounds.minY, legacyBounds.maxY, nativeBounds.maxY),
    z: mapLegacyCoordinateToNative(normalizeLegacyGridCoordinate(voxel.z, gridScale), legacyBounds.minZ, legacyBounds.maxZ, nativeBounds.maxZ),
  })));
}

function getEditableBoundsForCustomArmor(
  slot: CustomArmorSlot,
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2',
  gridScale: CustomArmorGridScale = 1,
  v3CoordinateSpace: CustomArmorV3CoordinateSpace = 'mesh2motion-native'
): CustomArmorBounds {
  if (modelSystem === 'v3' && V3_SLOT_SET.has(slot)) {
    return getV3EditableBounds(slot as V3CharacterSlotId, gridScale, v3CoordinateSpace);
  }
  return getCustomArmorSlotSpec(slot, modelType).bounds;
}

function getV3CustomArmorVoxelBudget(
  slot: V3CharacterSlotId,
  gridScale: CustomArmorGridScale = 1
): number {
  return getDefaultV3CharacterPartManifestForSlot(slot).budget.sourceVoxelCount * gridScale * gridScale;
}

function getV3CustomArmorMinimumVoxelCount(
  slot: V3CharacterSlotId,
  gridScale: CustomArmorGridScale = 1
): number {
  const sourceVoxelCount = getDefaultV3CharacterPartManifestForSlot(slot).budget.sourceVoxelCount;
  const legacyMinimum = Math.max(3, Math.min(40, Math.floor(sourceVoxelCount * 0.08)));
  return legacyMinimum * gridScale;
}

export function getCustomArmorPieceModelSystem(
  piece: Pick<CustomArmorPieceSnapshot, 'modelSystem'>
): CustomArmorModelSystem {
  return piece.modelSystem === 'v3' ? 'v3' : 'v2';
}

export function getCustomArmorGridScale(
  piece: Pick<CustomArmorPieceSnapshot, 'modelSystem' | 'gridScale'>
): CustomArmorGridScale {
  return getCustomArmorPieceModelSystem(piece) === 'v3'
    ? normalizeCustomArmorGridScale(piece.gridScale, 1)
    : 1;
}

export function getCustomArmorV3CoordinateSpace(
  piece: Pick<CustomArmorPieceSnapshot, 'modelSystem' | 'v3CoordinateSpace'>
): CustomArmorV3CoordinateSpace | undefined {
  if (getCustomArmorPieceModelSystem(piece) !== 'v3') return undefined;
  return piece.v3CoordinateSpace === 'mesh2motion-native' ? 'mesh2motion-native' : 'legacy-grid';
}

export function getCustomArmorSlotLabel(
  slot: CustomArmorSlot,
  modelSystem: CustomArmorModelSystem = 'v2',
  modelType: CharacterModelType = 'medium'
): string {
  if (modelSystem === 'v3' && V3_SLOT_SET.has(slot)) {
    return getDefaultV3CharacterPartManifestForSlot(slot as V3CharacterSlotId).label;
  }
  return getCustomArmorSlotSpec(slot, modelType).label;
}

export function createEmptyCustomArmorCatalog(): CustomArmorCatalog {
  return { version: 1, pieces: [] };
}

export function createCustomArmorId(
  slot: CustomArmorSlot,
  modelSystem: CustomArmorModelSystem = 'v2'
): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `custom_${modelSystem}_${slot}_${Date.now().toString(36)}_${suffix}`;
}

export function createCustomArmorPiece(
  slot: CustomArmorSlot,
  name: string,
  voxels: CustomArmorVoxel[] = [],
  sourcePreset?: string,
  modelType: CharacterModelType | undefined = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2',
  gridScale?: CustomArmorGridScale
): CustomArmorPiece {
  const now = Date.now();
  const resolvedModelSystem: CustomArmorModelSystem = modelSystem === 'v3' ? 'v3' : 'v2';
  const resolvedModelType = resolvedModelSystem === 'v2'
    ? resolveCharacterModelType(modelType, 'v2')
    : undefined;
  const resolvedGridScale = resolvedModelSystem === 'v3'
    ? normalizeCustomArmorGridScale(gridScale, DEFAULT_V3_CUSTOM_ARMOR_GRID_SCALE)
    : undefined;
  const v3CoordinateSpace = resolvedModelSystem === 'v3' ? 'mesh2motion-native' : undefined;
  const label = getCustomArmorSlotLabel(slot, resolvedModelSystem, resolvedModelType ?? 'medium');
  return {
    version: 1,
    id: createCustomArmorId(slot, resolvedModelSystem),
    name: sanitizePieceName(name, label),
    slot,
    modelSystem: resolvedModelSystem,
    modelType: resolvedModelType,
    gridScale: resolvedGridScale,
    v3CoordinateSpace,
    sourcePreset,
    voxels: dedupeCustomArmorVoxels(voxels),
    thumbnail: createCustomArmorThumbnail(slot, voxels.length, resolvedModelSystem),
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

export function createCustomArmorSnapshot(piece: CustomArmorPiece | CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const modelSystem = getCustomArmorPieceModelSystem(piece);
  const gridScale = modelSystem === 'v3' ? getCustomArmorGridScale(piece) : undefined;
  const v3CoordinateSpace = modelSystem === 'v3' && piece.v3CoordinateSpace === 'mesh2motion-native'
    ? 'mesh2motion-native'
    : undefined;
  return {
    version: 1,
    id: piece.id,
    name: piece.name,
    slot: piece.slot,
    modelSystem,
    modelType: modelSystem === 'v2' ? resolveCharacterModelType(piece.modelType, 'v2') : undefined,
    gridScale,
    v3CoordinateSpace,
    sourcePreset: piece.sourcePreset,
    voxels: piece.voxels.map(cloneVoxel),
    thumbnail: piece.thumbnail,
    updatedAt: piece.updatedAt,
  };
}

export function upsertCustomArmorPieceInCatalog(
  catalog: CustomArmorCatalog,
  draftSnapshotOrPiece: CustomArmorPieceSnapshot | CustomArmorPiece,
  options: { now?: number } = {}
): { catalog: CustomArmorCatalog; piece: CustomArmorPiece; snapshot: CustomArmorPieceSnapshot } {
  const existing = catalog.pieces.find((piece) => piece.id === draftSnapshotOrPiece.id);
  const now = options.now ?? Date.now();
  const historyEntry = existing ? createCustomArmorSnapshot(existing) : undefined;
  const draftModelSystem = getCustomArmorPieceModelSystem(draftSnapshotOrPiece);
  const modelType = draftModelSystem === 'v2'
    ? resolveCharacterModelType(draftSnapshotOrPiece.modelType, 'v2')
    : undefined;
  const gridScale = draftModelSystem === 'v3'
    ? getCustomArmorGridScale(draftSnapshotOrPiece)
    : undefined;
  const draftV3CoordinateSpace = getCustomArmorV3CoordinateSpace(draftSnapshotOrPiece);
  const savedVoxels = draftModelSystem === 'v3'
    ? convertCustomArmorV3VoxelsToNative(
      draftSnapshotOrPiece.slot as V3CharacterSlotId,
      draftSnapshotOrPiece.voxels,
      gridScale ?? 1,
      draftV3CoordinateSpace ?? 'legacy-grid'
    )
    : draftSnapshotOrPiece.voxels.map(cloneVoxel);
  const nextPiece: CustomArmorPiece = {
    ...draftSnapshotOrPiece,
    modelSystem: draftModelSystem,
    modelType,
    gridScale,
    v3CoordinateSpace: draftModelSystem === 'v3' ? 'mesh2motion-native' : undefined,
    name: draftSnapshotOrPiece.name.trim() || `${getCustomArmorSlotLabel(draftSnapshotOrPiece.slot, draftModelSystem, modelType ?? 'medium')} Custom`,
    voxels: savedVoxels,
    thumbnail: createCustomArmorThumbnail(draftSnapshotOrPiece.slot, draftSnapshotOrPiece.voxels.length, draftModelSystem),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    history: [
      ...(historyEntry ? [historyEntry] : []),
      ...(existing?.history ?? []),
    ].slice(0, CUSTOM_ARMOR_MAX_HISTORY),
  };
  const nextCatalog: CustomArmorCatalog = {
    version: 1,
    pieces: existing
      ? catalog.pieces.map((piece) => piece.id === draftSnapshotOrPiece.id ? nextPiece : piece)
      : [...catalog.pieces, nextPiece],
  };

  return {
    catalog: nextCatalog,
    piece: nextPiece,
    snapshot: createCustomArmorSnapshot(nextPiece),
  };
}

export function duplicateCustomArmorPiece(
  piece: CustomArmorPiece | CustomArmorPieceSnapshot,
  name: string
): CustomArmorPiece {
  const modelSystem = getCustomArmorPieceModelSystem(piece);
  const now = Date.now();
  const gridScale = modelSystem === 'v3' ? getCustomArmorGridScale(piece) : undefined;
  const voxels = modelSystem === 'v3'
    ? convertCustomArmorV3VoxelsToNative(
      piece.slot as V3CharacterSlotId,
      piece.voxels,
      gridScale ?? 1,
      getCustomArmorV3CoordinateSpace(piece) ?? 'legacy-grid'
    )
    : piece.voxels.map(cloneVoxel);
  return {
    ...createCustomArmorSnapshot(piece),
    id: createCustomArmorId(piece.slot, modelSystem),
    name: sanitizePieceName(name, `${piece.name} Copy`),
    modelSystem,
    modelType: modelSystem === 'v2' ? resolveCharacterModelType(piece.modelType, 'v2') : undefined,
    gridScale,
    v3CoordinateSpace: modelSystem === 'v3' ? 'mesh2motion-native' : undefined,
    voxels,
    thumbnail: createCustomArmorThumbnail(piece.slot, piece.voxels.length, modelSystem),
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

export function restoreCustomArmorHistoryEntry(
  piece: CustomArmorPiece,
  historyIndex: number
): CustomArmorPieceSnapshot | undefined {
  const entry = piece.history?.[historyIndex];
  if (!entry) return undefined;
  return {
    ...createCustomArmorSnapshot(entry),
    id: piece.id,
    updatedAt: Date.now(),
  };
}

export function sanitizePieceName(value: unknown, fallback = 'Custom Armor'): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, 32);
  return normalized || fallback;
}

export function getCustomArmorBounds(voxels: Array<CustomArmorVoxel | VoxelData>): CustomArmorBounds | undefined {
  if (voxels.length === 0) return undefined;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of voxels) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

export function isVoxelInSlotBounds(
  slot: CustomArmorSlot,
  voxel: { x: number; y: number; z: number },
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2',
  gridScale: CustomArmorGridScale = 1,
  v3CoordinateSpace: CustomArmorV3CoordinateSpace = 'mesh2motion-native'
): boolean {
  if (modelSystem === 'v3' && !V3_SLOT_SET.has(slot)) return false;
  if (modelSystem === 'v2' && !V2_SLOT_SET.has(slot)) return false;
  const b = getEditableBoundsForCustomArmor(slot, modelType, modelSystem, gridScale, v3CoordinateSpace);
  return voxel.x >= b.minX && voxel.x <= b.maxX
    && voxel.y >= b.minY && voxel.y <= b.maxY
    && voxel.z >= b.minZ && voxel.z <= b.maxZ;
}

export function clampVoxelToSlot(
  slot: CustomArmorSlot,
  voxel: CustomArmorVoxel,
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2',
  gridScale: CustomArmorGridScale = 1,
  v3CoordinateSpace: CustomArmorV3CoordinateSpace = 'mesh2motion-native'
): CustomArmorVoxel {
  const b = getEditableBoundsForCustomArmor(slot, modelType, modelSystem, gridScale, v3CoordinateSpace);
  return {
    ...voxel,
    x: Math.max(b.minX, Math.min(b.maxX, Math.round(voxel.x))),
    y: Math.max(b.minY, Math.min(b.maxY, Math.round(voxel.y))),
    z: Math.max(b.minZ, Math.min(b.maxZ, Math.round(voxel.z))),
  };
}

export function normalizeCustomArmorVoxel(
  value: unknown,
  slot: CustomArmorSlot,
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2',
  gridScale: CustomArmorGridScale = 1,
  v3CoordinateSpace: CustomArmorV3CoordinateSpace = 'mesh2motion-native'
): CustomArmorVoxel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CustomArmorVoxel>;
  if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) return null;
  if (!isVoxelInSlotBounds(slot, raw as { x: number; y: number; z: number }, modelType, modelSystem, gridScale, v3CoordinateSpace)) return null;
  const role = ROLE_SET.has(raw.role as CustomArmorMaterialRole) ? raw.role as CustomArmorMaterialRole : 'primary';
  const color = typeof raw.color === 'string' && HEX_COLOR.test(raw.color) ? raw.color : undefined;
  return {
    x: raw.x,
    y: raw.y,
    z: raw.z,
    role,
    color: role === 'fixed' ? color ?? '#38bdf8' : color,
    emissive: raw.emissive === true,
  };
}

export function dedupeCustomArmorVoxels(voxels: CustomArmorVoxel[]): CustomArmorVoxel[] {
  const map = new Map<string, CustomArmorVoxel>();
  for (const voxel of voxels) {
    map.set(coordKey(voxel), cloneVoxel(voxel));
  }
  return [...map.values()].sort((a, b) => (
    a.y !== b.y ? a.y - b.y : a.z !== b.z ? a.z - b.z : a.x - b.x
  ));
}

export function normalizeCustomArmorPiece(value: unknown): CustomArmorPiece | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CustomArmorPiece>;
  if (raw.version !== 1) return null;
  const modelSystem: CustomArmorModelSystem = raw.modelSystem === 'v3' ? 'v3' : 'v2';
  if (modelSystem === 'v3' && !V3_SLOT_SET.has(raw.slot as CustomArmorSlot)) return null;
  if (modelSystem === 'v2' && !V2_SLOT_SET.has(raw.slot as CustomArmorSlot)) return null;
  const slot = raw.slot as CustomArmorSlot;
  const modelType = modelSystem === 'v2' ? resolveCharacterModelType(raw.modelType, 'v2') : undefined;
  const gridScale = modelSystem === 'v3'
    ? normalizeCustomArmorGridScale(raw.gridScale, 1)
    : undefined;
  const v3CoordinateSpace = modelSystem === 'v3' && raw.v3CoordinateSpace === 'mesh2motion-native'
    ? 'mesh2motion-native'
    : undefined;
  const v3BoundsCoordinateSpace = v3CoordinateSpace ?? 'legacy-grid';
  const maxVoxels = modelSystem === 'v3'
    ? getV3CustomArmorVoxelBudget(slot as V3CharacterSlotId, gridScale)
    : getCustomArmorSlotSpec(slot, modelType).maxVoxels;
  if (!Array.isArray(raw.voxels)) return null;
  const voxels = dedupeCustomArmorVoxels(
    raw.voxels
      .map((voxel) => normalizeCustomArmorVoxel(
        voxel,
        slot,
        modelType ?? 'medium',
        modelSystem,
        gridScale,
        v3BoundsCoordinateSpace
      ))
      .filter((voxel): voxel is CustomArmorVoxel => Boolean(voxel))
  ).slice(0, maxVoxels);
  const now = Date.now();
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : createCustomArmorId(slot, modelSystem);
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now;
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : updatedAt;
  const history = Array.isArray(raw.history)
    ? raw.history
        .map((entry) => normalizeCustomArmorSnapshot(entry))
        .filter((entry): entry is CustomArmorPieceSnapshot => Boolean(entry))
        .slice(0, CUSTOM_ARMOR_MAX_HISTORY)
    : [];

  return {
    version: 1,
    id,
    name: sanitizePieceName(raw.name, getCustomArmorSlotLabel(slot, modelSystem, modelType ?? 'medium')),
    slot,
    modelSystem,
    modelType,
    gridScale,
    v3CoordinateSpace,
    sourcePreset: typeof raw.sourcePreset === 'string' ? raw.sourcePreset.slice(0, 32) : undefined,
    voxels,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail.slice(0, 160) : createCustomArmorThumbnail(slot, voxels.length, modelSystem),
    createdAt,
    updatedAt,
    history,
  };
}

export function normalizeCustomArmorSnapshot(value: unknown): CustomArmorPieceSnapshot | null {
  const piece = normalizeCustomArmorPiece(value);
  return piece ? createCustomArmorSnapshot(piece) : null;
}

export function normalizeCustomArmorCatalog(value: unknown): CustomArmorCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptyCustomArmorCatalog();
  const raw = value as Partial<CustomArmorCatalog>;
  const pieces = Array.isArray(raw.pieces)
    ? raw.pieces
        .map(normalizeCustomArmorPiece)
        .filter((piece): piece is CustomArmorPiece => Boolean(piece))
        .slice(0, CUSTOM_ARMOR_MAX_CATALOG_PIECES)
    : [];
  return { version: 1, pieces };
}

export function loadCustomArmorCatalog(): CustomArmorCatalog {
  try {
    const raw = localStorage.getItem(CUSTOM_ARMOR_CATALOG_STORAGE_KEY);
    return raw ? normalizeCustomArmorCatalog(JSON.parse(raw)) : createEmptyCustomArmorCatalog();
  } catch {
    return createEmptyCustomArmorCatalog();
  }
}

export function persistCustomArmorCatalog(catalog: CustomArmorCatalog): void {
  try {
    localStorage.setItem(CUSTOM_ARMOR_CATALOG_STORAGE_KEY, JSON.stringify(normalizeCustomArmorCatalog(catalog)));
  } catch {
    // In-memory catalog changes still apply when storage is unavailable.
  }
}

export function createCustomArmorThumbnail(
  slot: CustomArmorSlot,
  voxelCount: number,
  modelSystem: CustomArmorModelSystem = 'v2'
): string {
  const prefix = modelSystem === 'v3' ? 'V3' : slot[0].toUpperCase();
  return `${prefix}:${Math.max(0, Math.min(9999, Math.round(voxelCount)))}`;
}

export function customArmorPieceToVoxels(
  piece: CustomArmorPieceSnapshot,
  colors: CustomArmorColors,
  options: { mirrorX?: boolean } = {}
): VoxelData[] {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return [];
  const modelSystem = getCustomArmorPieceModelSystem(normalized);
  const sourceVoxels = modelSystem === 'v3' && V3_SLOT_SET.has(normalized.slot)
    ? convertCustomArmorV3VoxelsToNative(
      normalized.slot as V3CharacterSlotId,
      normalized.voxels,
      getCustomArmorGridScale(normalized),
      getCustomArmorV3CoordinateSpace(normalized) ?? 'legacy-grid'
    )
    : normalized.voxels.map(cloneVoxel);
  return sourceVoxels.map((voxel) => ({
    x: options.mirrorX ? -voxel.x : voxel.x,
    y: voxel.y,
    z: voxel.z,
    color: resolveCustomArmorVoxelColor(voxel, colors),
    emissive: voxel.emissive,
  }));
}

export function voxelDataToCustomArmorVoxels(voxels: VoxelData[], role: CustomArmorMaterialRole = 'primary'): CustomArmorVoxel[] {
  return dedupeCustomArmorVoxels(voxels.map((voxel) => ({
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    role: voxel.emissive ? 'visor' : role,
    color: undefined,
    emissive: voxel.emissive === true,
  })));
}

export function resolveCustomArmorVoxelColor(voxel: CustomArmorVoxel, colors: CustomArmorColors): string {
  if (voxel.role === 'fixed') return voxel.color && HEX_COLOR.test(voxel.color) ? voxel.color : colors.primary;
  if (voxel.role === 'undersuit') return colors.dark;
  if (voxel.role === 'emissive') return colors.highlight;
  if (voxel.role === 'decal') return colors.accent;
  return colors[voxel.role] ?? colors.primary;
}

export function validateCustomArmorPiece(piece: CustomArmorPieceSnapshot | CustomArmorPiece): CustomArmorValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = normalizeCustomArmorSnapshot(piece);
  const rawVoxels = Array.isArray((piece as { voxels?: unknown }).voxels)
    ? (piece as { voxels: unknown[] }).voxels
    : [];

  if (!normalized) {
    return {
      valid: false,
      errors: ['Piece data is malformed.'],
      warnings,
      stats: {
        voxelCount: 0,
        payloadBytes: 0,
        components: 0,
        subpartCounts: {},
        anchorCluster: false,
        modelSystem: 'v2',
      },
    };
  }

  const modelSystem = getCustomArmorPieceModelSystem(normalized);
  const modelType = resolveCharacterModelType(normalized.modelType, 'v2');
  const gridScale = getCustomArmorGridScale(normalized);
  const spec = modelSystem === 'v2' ? getCustomArmorSlotSpec(normalized.slot, modelType) : undefined;
  const voxels = dedupeCustomArmorVoxels(normalized.voxels);
  const payloadBytes = JSON.stringify(createCustomArmorSnapshot({ ...normalized, voxels })).length;
  const bounds = getCustomArmorBounds(voxels);
  const dimensions = bounds
    ? {
        sizeX: bounds.maxX - bounds.minX + 1,
        sizeY: bounds.maxY - bounds.minY + 1,
        sizeZ: bounds.maxZ - bounds.minZ + 1,
      }
    : { sizeX: 0, sizeY: 0, sizeZ: 0 };
  const subpartCounts: Record<string, number> = {};

  if (modelSystem === 'v3') {
    const v3Slot = normalized.slot as V3CharacterSlotId;
    const v3CoordinateSpace = getCustomArmorV3CoordinateSpace(normalized) ?? 'legacy-grid';
    const manifest = getDefaultV3CharacterPartManifestForSlot(v3Slot);
    const maxVoxels = getV3CustomArmorVoxelBudget(v3Slot, gridScale);
    const minVoxels = getV3CustomArmorMinimumVoxelCount(v3Slot, gridScale);

    if (voxels.length < minVoxels) {
      errors.push(`${manifest.label} needs at least ${minVoxels} voxels; current piece has ${voxels.length}.`);
    }
    if (voxels.length > maxVoxels) {
      errors.push(`${manifest.label} exceeds the ${maxVoxels} voxel budget.`);
    }
    if (payloadBytes > CUSTOM_ARMOR_MAX_SELECTED_BYTES) {
      errors.push(`Selected piece payload is ${payloadBytes} bytes; max is ${CUSTOM_ARMOR_MAX_SELECTED_BYTES}.`);
    }
    for (const rawVoxel of rawVoxels) {
      const voxel = rawVoxel as Partial<CustomArmorVoxel>;
      if (!Number.isInteger(voxel.x) || !Number.isInteger(voxel.y) || !Number.isInteger(voxel.z)) continue;
      if (!isVoxelInSlotBounds(v3Slot, voxel as { x: number; y: number; z: number }, 'medium', 'v3', gridScale, v3CoordinateSpace)) {
        errors.push(`${manifest.label} voxel ${coordKey(voxel as { x: number; y: number; z: number })} is outside the V3 ${v3Slot} bounds.`);
        break;
      }
    }

    const components = countConnectedComponents(voxels);
    if (components > 1) {
      warnings.push(`${components} disconnected voxel islands detected; remove floating voxels before publishing.`);
    }
    if (voxels.some((voxel) => voxel.emissive)) {
      warnings.push('Emissive voxels are allowed, but large glowing surfaces can look noisy in motion.');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        voxelCount: voxels.length,
        payloadBytes,
        components,
        bounds,
        subpartCounts,
        anchorCluster: true,
        modelSystem,
        v3Slot,
      },
    };
  }

  if (!spec) {
    return {
      valid: false,
      errors: ['Piece data is malformed.'],
      warnings,
      stats: {
        voxelCount: voxels.length,
        payloadBytes,
        components: countConnectedComponents(voxels),
        bounds,
        subpartCounts,
        anchorCluster: false,
        modelSystem,
      },
    };
  }

  if (voxels.length < spec.minTotal) {
    errors.push(`${spec.label} needs at least ${spec.minTotal} voxels; current piece has ${voxels.length}.`);
  }
  if (voxels.length > spec.maxVoxels) {
    errors.push(`${spec.label} exceeds the ${spec.maxVoxels} voxel budget.`);
  }
  if (payloadBytes > CUSTOM_ARMOR_MAX_SELECTED_BYTES) {
    errors.push(`Selected piece payload is ${payloadBytes} bytes; max is ${CUSTOM_ARMOR_MAX_SELECTED_BYTES}.`);
  }

  const spanCount = [dimensions.sizeX, dimensions.sizeY, dimensions.sizeZ].filter((span) => span >= spec.minAxisSpan).length;
  if (spanCount < 2) {
    errors.push(`${spec.label} is too narrow; expand across at least two axes so it does not read as a ghost piece.`);
  }

  for (const voxel of voxels) {
    if (!isVoxelInSlotBounds(normalized.slot, voxel, modelType, 'v2')) {
      errors.push(`${spec.label} voxel ${coordKey(voxel)} is outside the editable hitbox.`);
      break;
    }
  }

  for (const subpart of spec.subparts) {
    const partVoxels = voxels.filter(subpart.includes);
    subpartCounts[subpart.name] = partVoxels.length;
    if (partVoxels.length < subpart.min) {
      errors.push(`${subpart.name} needs at least ${subpart.min} voxels; current count is ${partVoxels.length}.`);
    }
    const constraint = V2_PART_CONSTRAINTS[subpart.name];
    if (constraint) {
      const partDimensions = getV2PartDimensions(partVoxels as VoxelData[]);
      if (partDimensions.sizeX > constraint.maxX || partDimensions.sizeY > constraint.maxY || partDimensions.sizeZ > constraint.maxZ) {
        errors.push(
          `${subpart.name} exceeds ${constraint.maxX}x${constraint.maxY}x${constraint.maxZ}; ` +
          `current size is ${partDimensions.sizeX}x${partDimensions.sizeY}x${partDimensions.sizeZ}.`
        );
      }
    }
  }

  const components = countConnectedComponents(voxels);
  if (components > 1) {
    warnings.push(`${components} disconnected voxel islands detected; remove floating voxels before publishing.`);
  }

  const anchorCluster = hasCornerAnchorCluster(voxels);
  if (!anchorCluster) {
    errors.push('Add at least one connected 3-voxel anchor cluster in a far corner of the piece.');
  }

  if (voxels.some((voxel) => voxel.emissive)) {
    warnings.push('Emissive voxels are allowed, but large glowing surfaces can look noisy in motion.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: {
      voxelCount: voxels.length,
      payloadBytes,
      components,
      bounds,
      subpartCounts,
      anchorCluster,
      modelSystem,
    },
  };
}

export function countConnectedComponents(voxels: CustomArmorVoxel[]): number {
  if (voxels.length === 0) return 0;
  const remaining = new Set(voxels.map(coordKey));
  const coordMap = new Map(voxels.map((voxel) => [coordKey(voxel), voxel]));
  let components = 0;

  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    remaining.delete(first);
    components++;

    for (let i = 0; i < queue.length; i++) {
      const current = coordMap.get(queue[i]);
      if (!current) continue;
      for (const next of neighborKeys(current)) {
        if (remaining.delete(next)) {
          queue.push(next);
        }
      }
    }
  }

  return components;
}

export function hasCornerAnchorCluster(voxels: CustomArmorVoxel[]): boolean {
  const bounds = getCustomArmorBounds(voxels);
  if (!bounds) return false;
  const coordSet = new Set(voxels.map(coordKey));
  const corners = [
    [bounds.minX, bounds.minY, bounds.minZ],
    [bounds.minX, bounds.minY, bounds.maxZ],
    [bounds.minX, bounds.maxY, bounds.minZ],
    [bounds.minX, bounds.maxY, bounds.maxZ],
    [bounds.maxX, bounds.minY, bounds.minZ],
    [bounds.maxX, bounds.minY, bounds.maxZ],
    [bounds.maxX, bounds.maxY, bounds.minZ],
    [bounds.maxX, bounds.maxY, bounds.maxZ],
  ];

  return corners.some(([x, y, z]) => {
    const cornerVoxels = voxels.filter((voxel) =>
      Math.abs(voxel.x - x) <= 2 && Math.abs(voxel.y - y) <= 2 && Math.abs(voxel.z - z) <= 2
    );
    if (cornerVoxels.length < 3) return false;
    return largestConnectedComponent(cornerVoxels).length >= 3 && cornerVoxels.some((voxel) => coordSet.has(coordKey(voxel)));
  });
}

export function removeFloatingVoxels(voxels: CustomArmorVoxel[]): CustomArmorVoxel[] {
  return largestConnectedComponent(dedupeCustomArmorVoxels(voxels));
}

export function centerCustomArmorPiece(piece: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return piece;
  const bounds = getCustomArmorBounds(normalized.voxels);
  if (!bounds) return normalized;
  const modelSystem = getCustomArmorPieceModelSystem(normalized);
  const modelType = resolveCharacterModelType(normalized.modelType, 'v2');
  const gridScale = getCustomArmorGridScale(normalized);
  const v3CoordinateSpace = getCustomArmorV3CoordinateSpace(normalized) ?? 'legacy-grid';
  const slotBounds = getEditableBoundsForCustomArmor(normalized.slot, modelType, modelSystem, gridScale, v3CoordinateSpace);
  const currentCenterX = (bounds.minX + bounds.maxX) / 2;
  const targetCenterX = (slotBounds.minX + slotBounds.maxX) / 2;
  const currentCenterZ = (bounds.minZ + bounds.maxZ) / 2;
  const targetCenterZ = (slotBounds.minZ + slotBounds.maxZ) / 2;
  const dx = Math.round(targetCenterX - currentCenterX);
  const dz = Math.round(targetCenterZ - currentCenterZ);
  return {
    ...normalized,
    voxels: dedupeCustomArmorVoxels(normalized.voxels.map((voxel) => clampVoxelToSlot(normalized.slot, {
      ...voxel,
      x: voxel.x + dx,
      z: voxel.z + dz,
    }, modelType, modelSystem, gridScale, v3CoordinateSpace))),
    updatedAt: Date.now(),
  };
}

export function seedCornerAnchor(piece: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return piece;
  const modelSystem = getCustomArmorPieceModelSystem(normalized);
  const modelType = resolveCharacterModelType(normalized.modelType, 'v2');
  const gridScale = getCustomArmorGridScale(normalized);
  const v3CoordinateSpace = getCustomArmorV3CoordinateSpace(normalized) ?? 'legacy-grid';
  const b = getEditableBoundsForCustomArmor(normalized.slot, modelType, modelSystem, gridScale, v3CoordinateSpace);
  const anchorSeed: CustomArmorVoxel[] = [
    { x: b.minX, y: b.minY, z: b.minZ, role: 'accent' },
    { x: b.minX + 1, y: b.minY, z: b.minZ, role: 'accent' },
    { x: b.minX, y: b.minY + 1, z: b.minZ, role: 'accent' },
  ];
  const anchor = anchorSeed.map((voxel) => clampVoxelToSlot(normalized.slot, voxel, modelType, modelSystem, gridScale));
  return {
    ...normalized,
    voxels: dedupeCustomArmorVoxels([...normalized.voxels, ...anchor]),
    updatedAt: Date.now(),
  };
}

export function fitCustomArmorToBounds(piece: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return piece;
  const modelSystem = getCustomArmorPieceModelSystem(normalized);
  const gridScale = getCustomArmorGridScale(normalized);
  const v3CoordinateSpace = getCustomArmorV3CoordinateSpace(normalized) ?? 'legacy-grid';
  return {
    ...normalized,
    voxels: dedupeCustomArmorVoxels(normalized.voxels.map((voxel) => clampVoxelToSlot(
      normalized.slot,
      voxel,
      resolveCharacterModelType(normalized.modelType, 'v2'),
      modelSystem,
      gridScale,
      v3CoordinateSpace
    ))),
    updatedAt: Date.now(),
  };
}

export function sanitizeCharacterLoadoutForNetwork(loadout: unknown): unknown | undefined {
  if (!loadout || typeof loadout !== 'object' || Array.isArray(loadout)) return undefined;
  const raw = loadout as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, allowed] of Object.entries(PRESET_FIELDS)) {
    const value = raw[key];
    if (typeof value === 'string' && allowed.has(value)) out[key] = value;
  }
  if (isModelSystem(raw.modelSystem)) out.modelSystem = raw.modelSystem;
  const modelType = resolveCharacterModelType(raw.modelType, raw.modelSystem);
  if (out.modelSystem === 'v2') out.modelType = modelType;
  if (raw.paintJob && typeof raw.paintJob === 'object' && !Array.isArray(raw.paintJob)) {
    const paintPayload = JSON.stringify(raw.paintJob);
    if (paintPayload.length <= 48_000) {
      const v3Paint = sanitizeV3RolePaintPayload(raw.paintJob);
      const paintJob = { ...raw.paintJob } as Record<string, unknown>;
      if (v3Paint.v3RoleColors) {
        paintJob.v3RoleColors = v3Paint.v3RoleColors;
      } else {
        delete paintJob.v3RoleColors;
      }
      if (v3Paint.v3RoleEmissive) {
        paintJob.v3RoleEmissive = v3Paint.v3RoleEmissive;
      } else {
        delete paintJob.v3RoleEmissive;
      }
      out.paintJob = paintJob;
    }
  }
  const loadoutModelSystem: CustomArmorModelSystem = out.modelSystem === 'v3' ? 'v3' : 'v2';
  const customArmor = sanitizeSelectedCustomArmor(raw.customArmor, modelType, loadoutModelSystem);
  if (customArmor) out.customArmor = customArmor;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeSelectedCustomArmor(
  value: unknown,
  modelType: CharacterModelType = 'medium',
  modelSystem: CustomArmorModelSystem = 'v2'
): Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>> = {};
  const slots = modelSystem === 'v3' ? V3_CUSTOM_ARMOR_SLOTS : V2_CUSTOM_ARMOR_SLOTS;
  for (const slot of slots) {
    const snapshot = normalizeCustomArmorSnapshot((value as Record<string, unknown>)[slot]);
    if (!snapshot || snapshot.slot !== slot) continue;
    if (getCustomArmorPieceModelSystem(snapshot) !== modelSystem) continue;
    if (modelSystem === 'v2' && resolveCharacterModelType(snapshot.modelType, 'v2') !== modelType) continue;
    const validation = validateCustomArmorPiece(snapshot);
    if (validation.valid && validation.stats.payloadBytes <= CUSTOM_ARMOR_MAX_SELECTED_BYTES) {
      result[slot] = snapshot;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function largestConnectedComponent(voxels: CustomArmorVoxel[]): CustomArmorVoxel[] {
  if (voxels.length === 0) return [];
  const remaining = new Set(voxels.map(coordKey));
  const coordMap = new Map(voxels.map((voxel) => [coordKey(voxel), voxel]));
  let largest: CustomArmorVoxel[] = [];

  while (remaining.size > 0) {
    const first = remaining.values().next().value as string;
    const queue = [first];
    const current: CustomArmorVoxel[] = [];
    remaining.delete(first);

    for (let i = 0; i < queue.length; i++) {
      const voxel = coordMap.get(queue[i]);
      if (!voxel) continue;
      current.push(voxel);
      for (const next of neighborKeys(voxel)) {
        if (remaining.delete(next)) {
          queue.push(next);
        }
      }
    }

    if (current.length > largest.length) largest = current;
  }

  return largest.map(cloneVoxel);
}

function neighborKeys(voxel: { x: number; y: number; z: number }): string[] {
  return [
    `${voxel.x + 1},${voxel.y},${voxel.z}`,
    `${voxel.x - 1},${voxel.y},${voxel.z}`,
    `${voxel.x},${voxel.y + 1},${voxel.z}`,
    `${voxel.x},${voxel.y - 1},${voxel.z}`,
    `${voxel.x},${voxel.y},${voxel.z + 1}`,
    `${voxel.x},${voxel.y},${voxel.z - 1}`,
  ];
}
