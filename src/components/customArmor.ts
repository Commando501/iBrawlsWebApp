import type { VoxelData } from './VoxelModels';
import {
  getV2PartDimensions,
  V2_PART_CONSTRAINTS,
} from './v2ArmorConstraints';

export type CustomArmorSlot = 'helmet' | 'torso' | 'arm' | 'leg';
export type CustomArmorMaterialRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'visor'
  | 'dark'
  | 'highlight'
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
export const CUSTOM_ARMOR_MAX_SELECTED_BYTES = 128_000;
export const CUSTOM_ARMOR_MAX_CATALOG_BYTES = 1_200_000;
export const CUSTOM_ARMOR_MAX_HISTORY = 5;

export const CUSTOM_ARMOR_SLOT_SPECS: Record<CustomArmorSlot, SlotSpec> = {
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

const PRESET_FIELDS = {
  helmet: new Set(['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb']),
  torso: new Set(['mark-vi', 'scout', 'recon', 'eod', 'hayabusa']),
  arm: new Set(['mark-vi', 'odst', 'recon', 'eod', 'hayabusa']),
  leg: new Set(['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa']),
  hammerPreset: new Set(['default', 'akelas', 'akelus', 'paegaas', 'sepulotez', 'halbashi', 'eektah-fel', 'gravity-axe', 'gravity-mace', 'fist-of-rukt']),
  swordPreset: new Set(['default', 'halo-ce', 'halo-2', 'halo-3', 'reach', 'anniversary', 'halo-4', 'h2a-blue', 'h2a-pink', 'halo-5', 'infinite']),
};

const ROLE_SET = new Set<CustomArmorMaterialRole>(['primary', 'secondary', 'accent', 'visor', 'dark', 'highlight', 'fixed']);
const SLOT_SET = new Set<CustomArmorSlot>(['helmet', 'torso', 'arm', 'leg']);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const coordKey = (v: { x: number; y: number; z: number }) => `${v.x},${v.y},${v.z}`;
const cloneVoxel = (voxel: CustomArmorVoxel): CustomArmorVoxel => ({ ...voxel });

export function createEmptyCustomArmorCatalog(): CustomArmorCatalog {
  return { version: 1, pieces: [] };
}

export function createCustomArmorId(slot: CustomArmorSlot): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `custom_${slot}_${Date.now().toString(36)}_${suffix}`;
}

export function createCustomArmorPiece(
  slot: CustomArmorSlot,
  name: string,
  voxels: CustomArmorVoxel[] = [],
  sourcePreset?: string
): CustomArmorPiece {
  const now = Date.now();
  return {
    version: 1,
    id: createCustomArmorId(slot),
    name: sanitizePieceName(name, CUSTOM_ARMOR_SLOT_SPECS[slot].label),
    slot,
    sourcePreset,
    voxels: dedupeCustomArmorVoxels(voxels),
    thumbnail: createCustomArmorThumbnail(slot, voxels.length),
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

export function createCustomArmorSnapshot(piece: CustomArmorPiece | CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  return {
    version: 1,
    id: piece.id,
    name: piece.name,
    slot: piece.slot,
    sourcePreset: piece.sourcePreset,
    voxels: piece.voxels.map(cloneVoxel),
    thumbnail: piece.thumbnail,
    updatedAt: piece.updatedAt,
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

export function isVoxelInSlotBounds(slot: CustomArmorSlot, voxel: { x: number; y: number; z: number }): boolean {
  const b = CUSTOM_ARMOR_SLOT_SPECS[slot].bounds;
  return voxel.x >= b.minX && voxel.x <= b.maxX
    && voxel.y >= b.minY && voxel.y <= b.maxY
    && voxel.z >= b.minZ && voxel.z <= b.maxZ;
}

export function clampVoxelToSlot(slot: CustomArmorSlot, voxel: CustomArmorVoxel): CustomArmorVoxel {
  const b = CUSTOM_ARMOR_SLOT_SPECS[slot].bounds;
  return {
    ...voxel,
    x: Math.max(b.minX, Math.min(b.maxX, Math.round(voxel.x))),
    y: Math.max(b.minY, Math.min(b.maxY, Math.round(voxel.y))),
    z: Math.max(b.minZ, Math.min(b.maxZ, Math.round(voxel.z))),
  };
}

export function normalizeCustomArmorVoxel(value: unknown, slot: CustomArmorSlot): CustomArmorVoxel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<CustomArmorVoxel>;
  if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) return null;
  if (!isVoxelInSlotBounds(slot, raw as { x: number; y: number; z: number })) return null;
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
  if (raw.version !== 1 || !SLOT_SET.has(raw.slot as CustomArmorSlot)) return null;
  const slot = raw.slot as CustomArmorSlot;
  if (!Array.isArray(raw.voxels)) return null;
  const voxels = dedupeCustomArmorVoxels(
    raw.voxels
      .map((voxel) => normalizeCustomArmorVoxel(voxel, slot))
      .filter((voxel): voxel is CustomArmorVoxel => Boolean(voxel))
  ).slice(0, CUSTOM_ARMOR_SLOT_SPECS[slot].maxVoxels);
  const now = Date.now();
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim().slice(0, 80) : createCustomArmorId(slot);
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
    name: sanitizePieceName(raw.name, CUSTOM_ARMOR_SLOT_SPECS[slot].label),
    slot,
    sourcePreset: typeof raw.sourcePreset === 'string' ? raw.sourcePreset.slice(0, 32) : undefined,
    voxels,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail.slice(0, 160) : createCustomArmorThumbnail(slot, voxels.length),
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

export function createCustomArmorThumbnail(slot: CustomArmorSlot, voxelCount: number): string {
  const code = slot[0].toUpperCase();
  return `${code}:${Math.max(0, Math.min(9999, Math.round(voxelCount)))}`;
}

export function customArmorPieceToVoxels(
  piece: CustomArmorPieceSnapshot,
  colors: CustomArmorColors,
  options: { mirrorX?: boolean } = {}
): VoxelData[] {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return [];
  return normalized.voxels.map((voxel) => ({
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
  return colors[voxel.role] ?? colors.primary;
}

export function validateCustomArmorPiece(piece: CustomArmorPieceSnapshot | CustomArmorPiece): CustomArmorValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalized = normalizeCustomArmorSnapshot(piece);

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
      },
    };
  }

  const spec = CUSTOM_ARMOR_SLOT_SPECS[normalized.slot];
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
    if (!isVoxelInSlotBounds(normalized.slot, voxel)) {
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
  const slotBounds = CUSTOM_ARMOR_SLOT_SPECS[normalized.slot].bounds;
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
    }))),
    updatedAt: Date.now(),
  };
}

export function seedCornerAnchor(piece: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return piece;
  const b = CUSTOM_ARMOR_SLOT_SPECS[normalized.slot].bounds;
  const anchorSeed: CustomArmorVoxel[] = [
    { x: b.minX, y: b.minY, z: b.minZ, role: 'accent' },
    { x: b.minX + 1, y: b.minY, z: b.minZ, role: 'accent' },
    { x: b.minX, y: b.minY + 1, z: b.minZ, role: 'accent' },
  ];
  const anchor = anchorSeed.map((voxel) => clampVoxelToSlot(normalized.slot, voxel));
  return {
    ...normalized,
    voxels: dedupeCustomArmorVoxels([...normalized.voxels, ...anchor]),
    updatedAt: Date.now(),
  };
}

export function fitCustomArmorToBounds(piece: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  const normalized = normalizeCustomArmorSnapshot(piece);
  if (!normalized) return piece;
  return {
    ...normalized,
    voxels: dedupeCustomArmorVoxels(normalized.voxels.map((voxel) => clampVoxelToSlot(normalized.slot, voxel))),
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
  if (raw.modelSystem === 'v1' || raw.modelSystem === 'v2') out.modelSystem = raw.modelSystem;
  if (raw.paintJob && typeof raw.paintJob === 'object' && !Array.isArray(raw.paintJob)) {
    const paintPayload = JSON.stringify(raw.paintJob);
    if (paintPayload.length <= 48_000) out.paintJob = raw.paintJob;
  }
  const customArmor = sanitizeSelectedCustomArmor(raw.customArmor);
  if (customArmor) out.customArmor = customArmor;
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeSelectedCustomArmor(value: unknown): Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Partial<Record<CustomArmorSlot, CustomArmorPieceSnapshot>> = {};
  for (const slot of SLOT_SET) {
    const snapshot = normalizeCustomArmorSnapshot((value as Record<string, unknown>)[slot]);
    if (!snapshot || snapshot.slot !== slot) continue;
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
