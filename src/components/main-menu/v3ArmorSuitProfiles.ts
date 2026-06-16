import type { CharacterLoadout } from '../VoxelModels';
import {
  CUSTOM_ARMOR_MAX_CATALOG_BYTES,
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  createCustomArmorSnapshot,
  getCustomArmorPieceModelSystem,
  normalizeCustomArmorSnapshot,
  sanitizePieceName,
  upsertCustomArmorPieceInCatalog,
  validateCustomArmorPiece,
  V3_CUSTOM_ARMOR_SLOTS,
  type CustomArmorCatalog,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type V3CustomArmorSlot,
} from '../customArmor';

export const V3_SUIT_PROFILE_CATALOG_STORAGE_KEY = 'grifball_v3_suit_profiles';
export const V3_SUIT_PROFILE_MAX_PROFILES = 24;
export const V3_SUIT_PROFILE_MAX_BYTES = 180_000;
export const V3_SUIT_PROFILE_MAX_NAME_LENGTH = 32;

export interface V3SuitProfile {
  version: 1;
  id: string;
  name: string;
  modelSystem: 'v3';
  slotPieceIds: Partial<Record<V3CustomArmorSlot, string>>;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
}

export interface V3SuitProfileCatalog {
  version: 1;
  profiles: V3SuitProfile[];
}

export interface V3SuitProfileExportBundle {
  version: 1;
  profile: V3SuitProfile;
  pieces: CustomArmorPieceSnapshot[];
}

export interface V3SuitProfileCreateResult {
  profile?: V3SuitProfile;
  errors: string[];
  warnings: string[];
}

export interface V3SuitProfileValidationResult {
  valid: boolean;
  status: 'ready' | 'partial' | 'missing';
  appliedSlotIds: V3CustomArmorSlot[];
  missingSlotIds: V3CustomArmorSlot[];
  errors: string[];
  warnings: string[];
}

export interface V3SuitProfileApplyResult {
  loadoutPatch?: Pick<CharacterLoadout, 'customArmor'>;
  appliedSlotIds: V3CustomArmorSlot[];
  missingSlotIds: V3CustomArmorSlot[];
  errors: string[];
  warnings: string[];
}

export interface V3SuitProfileUpsertResult {
  catalog: V3SuitProfileCatalog;
  profile?: V3SuitProfile;
  errors: string[];
}

export interface V3SuitProfileExportResult {
  bundle?: V3SuitProfileExportBundle;
  errors: string[];
  warnings: string[];
}

export interface V3SuitProfileImportResult {
  customArmorCatalog: CustomArmorCatalog;
  profileCatalog: V3SuitProfileCatalog;
  profile?: V3SuitProfile;
  importedPieces: CustomArmorPieceSnapshot[];
  errors: string[];
  warnings: string[];
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const V3_SLOT_SET = new Set<string>(V3_CUSTOM_ARMOR_SLOTS);

function createV3SuitProfileId(name: string, now: number): string {
  const slug = sanitizePieceName(name, 'Suit Profile')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return `v3_suit_${Math.max(0, Math.round(now)).toString(36)}_${slug || 'profile'}`.slice(0, 80);
}

function sanitizeProfileId(value: unknown, name: string, now: number): string {
  if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 80);
  return createV3SuitProfileId(name, now);
}

function sanitizeProfileName(value: unknown): string {
  return sanitizePieceName(value, 'V3 Suit Profile').slice(0, V3_SUIT_PROFILE_MAX_NAME_LENGTH);
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function isV3Slot(value: string): value is V3CustomArmorSlot {
  return V3_SLOT_SET.has(value);
}

function cloneProfile(profile: V3SuitProfile): V3SuitProfile {
  return {
    version: 1,
    id: profile.id,
    name: profile.name,
    modelSystem: 'v3',
    slotPieceIds: { ...profile.slotPieceIds },
    thumbnail: profile.thumbnail,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function normalizeSlotPieceIds(value: unknown): Partial<Record<V3CustomArmorSlot, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const result: Partial<Record<V3CustomArmorSlot, string>> = {};
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const pieceId = raw[slot];
    if (typeof pieceId === 'string' && pieceId.trim()) {
      result[slot] = pieceId.trim().slice(0, 80);
    }
  }
  return result;
}

function normalizeV3SuitProfile(value: unknown, fallbackNow = Date.now()): V3SuitProfile | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<V3SuitProfile>;
  if (raw.version !== 1 || raw.modelSystem !== 'v3') return null;
  const name = sanitizeProfileName(raw.name);
  const createdAt = normalizeTimestamp(raw.createdAt, fallbackNow);
  const updatedAt = normalizeTimestamp(raw.updatedAt, createdAt);
  const slotPieceIds = normalizeSlotPieceIds(raw.slotPieceIds);
  if (Object.keys(slotPieceIds).length === 0) return null;
  return {
    version: 1,
    id: sanitizeProfileId(raw.id, name, updatedAt),
    name,
    modelSystem: 'v3',
    slotPieceIds,
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail.slice(0, V3_SUIT_PROFILE_MAX_BYTES) : undefined,
    createdAt,
    updatedAt,
  };
}

function findCatalogPiece(
  catalog: CustomArmorCatalog,
  slot: V3CustomArmorSlot,
  pieceId: string | undefined
): CustomArmorPiece | undefined {
  if (!pieceId) return undefined;
  return catalog.pieces.find((piece) => (
    piece.id === pieceId &&
    piece.slot === slot &&
    getCustomArmorPieceModelSystem(piece) === 'v3' &&
    validateCustomArmorPiece(piece).valid
  ));
}

function cloneCatalog(catalog: CustomArmorCatalog): CustomArmorCatalog {
  return {
    version: 1,
    pieces: catalog.pieces.map((piece) => ({
      ...piece,
      voxels: piece.voxels.map((voxel) => ({ ...voxel })),
      history: piece.history?.map((entry) => createCustomArmorSnapshot(entry)),
    })),
  };
}

function catalogByteLength(catalog: V3SuitProfileCatalog): number {
  return JSON.stringify(catalog).length;
}

function customArmorCatalogByteLength(catalog: CustomArmorCatalog): number {
  return JSON.stringify(catalog).length;
}

function createImportedPieceId(originalId: string, now: number, usedIds: Set<string>): string {
  const stem = sanitizePieceName(originalId, 'piece')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36) || 'piece';
  const stamp = Math.max(0, Math.round(now)).toString(36);
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? stamp : `${stamp}_${index.toString(36)}`;
    const id = `${stem}_import_${suffix}`.slice(0, 80);
    if (!usedIds.has(id)) return id;
  }
  return `v3_import_${stamp}_${usedIds.size.toString(36)}`.slice(0, 80);
}

export function createEmptyV3SuitProfileCatalog(): V3SuitProfileCatalog {
  return { version: 1, profiles: [] };
}

export function normalizeV3SuitProfileCatalog(value: unknown): V3SuitProfileCatalog {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptyV3SuitProfileCatalog();
  const raw = value as Partial<V3SuitProfileCatalog>;
  const profiles = Array.isArray(raw.profiles)
    ? raw.profiles
        .map((profile) => normalizeV3SuitProfile(profile))
        .filter((profile): profile is V3SuitProfile => Boolean(profile))
        .slice(0, V3_SUIT_PROFILE_MAX_PROFILES)
    : [];
  const next: V3SuitProfileCatalog = { version: 1, profiles };
  while (catalogByteLength(next) > V3_SUIT_PROFILE_MAX_BYTES && next.profiles.length > 0) {
    next.profiles.pop();
  }
  return next;
}

export function loadV3SuitProfileCatalog(storage: StorageLike = localStorage): V3SuitProfileCatalog {
  try {
    const raw = storage.getItem(V3_SUIT_PROFILE_CATALOG_STORAGE_KEY);
    return raw ? normalizeV3SuitProfileCatalog(JSON.parse(raw)) : createEmptyV3SuitProfileCatalog();
  } catch {
    return createEmptyV3SuitProfileCatalog();
  }
}

export function persistV3SuitProfileCatalog(
  catalog: V3SuitProfileCatalog,
  storage: StorageLike = localStorage
): void {
  try {
    storage.setItem(V3_SUIT_PROFILE_CATALOG_STORAGE_KEY, JSON.stringify(normalizeV3SuitProfileCatalog(catalog)));
  } catch {
    // In-memory profile changes still apply when storage is unavailable.
  }
}

export function createV3SuitProfileFromLoadout(
  loadout: CharacterLoadout | undefined,
  catalog: CustomArmorCatalog,
  options: { id?: string; name?: string; now?: number; thumbnail?: string } = {}
): V3SuitProfileCreateResult {
  const now = options.now ?? Date.now();
  const name = sanitizeProfileName(options.name ?? 'V3 Suit Profile');
  const slotPieceIds: Partial<Record<V3CustomArmorSlot, string>> = {};
  const warnings: string[] = [];

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const equipped = loadout?.customArmor?.[slot];
    if (!equipped || getCustomArmorPieceModelSystem(equipped) !== 'v3') continue;
    const piece = findCatalogPiece(catalog, slot, equipped.id);
    if (piece) {
      slotPieceIds[slot] = piece.id;
    } else {
      warnings.push(`${slot} is equipped but its catalog piece is missing or invalid.`);
    }
  }

  if (Object.keys(slotPieceIds).length === 0) {
    return {
      errors: ['No valid V3 custom armor catalog pieces are equipped.'],
      warnings,
    };
  }

  return {
    profile: {
      version: 1,
      id: sanitizeProfileId(options.id, name, now),
      name,
      modelSystem: 'v3',
      slotPieceIds,
      thumbnail: options.thumbnail,
      createdAt: now,
      updatedAt: now,
    },
    errors: [],
    warnings,
  };
}

export function validateV3SuitProfile(
  profile: V3SuitProfile,
  catalog: CustomArmorCatalog
): V3SuitProfileValidationResult {
  const normalized = normalizeV3SuitProfile(profile);
  if (!normalized) {
    return {
      valid: false,
      status: 'missing',
      appliedSlotIds: [],
      missingSlotIds: [],
      errors: ['Suit profile is invalid or empty.'],
      warnings: [],
    };
  }

  const appliedSlotIds: V3CustomArmorSlot[] = [];
  const missingSlotIds: V3CustomArmorSlot[] = [];
  const warnings: string[] = [];

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const pieceId = normalized.slotPieceIds[slot];
    if (!pieceId) continue;
    const piece = findCatalogPiece(catalog, slot, pieceId);
    if (piece) {
      appliedSlotIds.push(slot);
    } else {
      missingSlotIds.push(slot);
      warnings.push(`${slot} references missing or invalid piece ${pieceId}.`);
    }
  }

  const status = appliedSlotIds.length === 0
    ? 'missing'
    : missingSlotIds.length > 0 ? 'partial' : 'ready';

  return {
    valid: appliedSlotIds.length > 0,
    status,
    appliedSlotIds,
    missingSlotIds,
    errors: appliedSlotIds.length > 0 ? [] : ['Suit profile has no available V3 custom armor pieces.'],
    warnings,
  };
}

export function applyV3SuitProfileToLoadout(
  loadout: CharacterLoadout,
  profile: V3SuitProfile,
  catalog: CustomArmorCatalog
): V3SuitProfileApplyResult {
  const validation = validateV3SuitProfile(profile, catalog);
  if (!validation.valid) {
    return {
      appliedSlotIds: [],
      missingSlotIds: validation.missingSlotIds,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const customArmor: CharacterLoadout['customArmor'] = {
    ...(loadout.customArmor ?? {}),
  };

  for (const slot of validation.appliedSlotIds) {
    const piece = findCatalogPiece(catalog, slot, profile.slotPieceIds[slot]);
    if (piece) customArmor[slot] = createCustomArmorSnapshot(piece);
  }

  return {
    loadoutPatch: {
      customArmor,
    },
    appliedSlotIds: validation.appliedSlotIds,
    missingSlotIds: validation.missingSlotIds,
    errors: [],
    warnings: validation.warnings,
  };
}

export function upsertV3SuitProfile(
  catalog: V3SuitProfileCatalog,
  profile: V3SuitProfile,
  options: { now?: number } = {}
): V3SuitProfileUpsertResult {
  const now = options.now ?? Date.now();
  const normalizedCatalog = normalizeV3SuitProfileCatalog(catalog);
  const normalizedProfile = normalizeV3SuitProfile({
    ...profile,
    updatedAt: now,
  }, now);

  if (!normalizedProfile) {
    return { catalog, errors: ['Suit profile is invalid or empty.'] };
  }

  const existing = normalizedCatalog.profiles.find((candidate) => candidate.id === normalizedProfile.id);
  const nextProfile: V3SuitProfile = {
    ...normalizedProfile,
    createdAt: existing?.createdAt ?? normalizedProfile.createdAt,
    updatedAt: now,
  };
  const nextCatalog: V3SuitProfileCatalog = {
    version: 1,
    profiles: existing
      ? normalizedCatalog.profiles.map((candidate) => candidate.id === nextProfile.id ? nextProfile : candidate)
      : [...normalizedCatalog.profiles, nextProfile],
  };

  if (nextCatalog.profiles.length > V3_SUIT_PROFILE_MAX_PROFILES) {
    return {
      catalog,
      errors: [`V3 suit profile catalog would contain ${nextCatalog.profiles.length} profiles; max is ${V3_SUIT_PROFILE_MAX_PROFILES}.`],
    };
  }

  const bytes = catalogByteLength(nextCatalog);
  if (bytes > V3_SUIT_PROFILE_MAX_BYTES) {
    return {
      catalog,
      errors: [`V3 suit profile catalog would be ${bytes} bytes; max is ${V3_SUIT_PROFILE_MAX_BYTES}.`],
    };
  }

  return {
    catalog: nextCatalog,
    profile: cloneProfile(nextProfile),
    errors: [],
  };
}

export function deleteV3SuitProfile(
  catalog: V3SuitProfileCatalog,
  profileId: string
): V3SuitProfileCatalog {
  return {
    version: 1,
    profiles: normalizeV3SuitProfileCatalog(catalog).profiles.filter((profile) => profile.id !== profileId),
  };
}

export function exportV3SuitProfileBundle(
  profile: V3SuitProfile,
  catalog: CustomArmorCatalog
): V3SuitProfileExportResult {
  const normalized = normalizeV3SuitProfile(profile);
  if (!normalized) {
    return { errors: ['Suit profile is invalid or empty.'], warnings: [] };
  }

  const pieces: CustomArmorPieceSnapshot[] = [];
  const warnings: string[] = [];
  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const pieceId = normalized.slotPieceIds[slot];
    if (!pieceId) continue;
    const piece = findCatalogPiece(catalog, slot, pieceId);
    if (piece) {
      pieces.push(createCustomArmorSnapshot(piece));
    } else {
      warnings.push(`${slot} references missing or invalid piece ${pieceId}.`);
    }
  }

  if (pieces.length === 0) {
    return {
      errors: ['Suit profile has no exportable V3 custom armor pieces.'],
      warnings,
    };
  }

  if (warnings.length > 0) {
    return {
      errors: ['Suit profile export bundle is missing referenced V3 custom armor pieces.'],
      warnings,
    };
  }

  return {
    bundle: {
      version: 1,
      profile: cloneProfile(normalized),
      pieces,
    },
    errors: [],
    warnings,
  };
}

export function importV3SuitProfileBundle(
  bundle: unknown,
  customArmorCatalog: CustomArmorCatalog,
  profileCatalog: V3SuitProfileCatalog,
  options: { now?: number } = {}
): V3SuitProfileImportResult {
  const now = options.now ?? Date.now();
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: ['Suit profile import bundle is invalid.'],
      warnings: [],
    };
  }

  const raw = bundle as Partial<V3SuitProfileExportBundle>;
  if (raw.version !== 1 || !Array.isArray(raw.pieces)) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: ['Suit profile import bundle is invalid.'],
      warnings: [],
    };
  }

  const profile = normalizeV3SuitProfile(raw.profile, now);
  if (!profile) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: ['Suit profile import bundle has an invalid profile.'],
      warnings: [],
    };
  }

  const referencedPieceIds = new Set(
    Object.values(profile.slotPieceIds).filter((pieceId): pieceId is string => Boolean(pieceId))
  );
  const usedPieceIds = new Set(customArmorCatalog.pieces.map((piece) => piece.id));
  const sourcePieceIds = new Set<string>();
  const idRemap = new Map<string, string>();
  const preparedPieces: CustomArmorPieceSnapshot[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const rawPiece of raw.pieces) {
    const snapshot = normalizeCustomArmorSnapshot(rawPiece);
    if (!snapshot) {
      errors.push('Imported suit profile bundle contains an invalid armor piece.');
      continue;
    }
    if (!isV3Slot(snapshot.slot) || getCustomArmorPieceModelSystem(snapshot) !== 'v3') {
      errors.push(`Imported piece ${snapshot.id} is not a V3 custom armor piece.`);
      continue;
    }
    const validation = validateCustomArmorPiece(snapshot);
    if (!validation.valid) {
      errors.push(`Imported piece ${snapshot.id} is invalid: ${validation.errors[0]}`);
      continue;
    }
    if (!referencedPieceIds.has(snapshot.id)) {
      warnings.push(`Imported piece ${snapshot.id} is not referenced by the suit profile and was skipped.`);
      continue;
    }
    if (sourcePieceIds.has(snapshot.id)) {
      errors.push(`Imported suit profile bundle contains duplicate piece id ${snapshot.id}.`);
      continue;
    }
    sourcePieceIds.add(snapshot.id);

    let nextId = snapshot.id;
    if (usedPieceIds.has(nextId)) {
      nextId = createImportedPieceId(snapshot.id, now, usedPieceIds);
      warnings.push(`Imported piece ${snapshot.id} was renamed to ${nextId} to avoid a local catalog id collision.`);
    }
    usedPieceIds.add(nextId);
    idRemap.set(snapshot.id, nextId);
    preparedPieces.push(nextId === snapshot.id ? snapshot : { ...snapshot, id: nextId });
  }

  for (const pieceId of referencedPieceIds) {
    if (!sourcePieceIds.has(pieceId)) {
      errors.push(`Suit profile import bundle is missing referenced piece ${pieceId}.`);
    }
  }

  if (errors.length > 0) {
    return { customArmorCatalog, profileCatalog, importedPieces: [], errors, warnings: [] };
  }

  let nextCustomArmorCatalog = cloneCatalog(customArmorCatalog);
  const importedPieces: CustomArmorPieceSnapshot[] = [];
  for (const snapshot of preparedPieces) {
    const upserted = upsertCustomArmorPieceInCatalog(nextCustomArmorCatalog, snapshot, { now });
    nextCustomArmorCatalog = upserted.catalog;
    importedPieces.push(upserted.snapshot);
  }

  if (nextCustomArmorCatalog.pieces.length > CUSTOM_ARMOR_MAX_CATALOG_PIECES) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: [`Custom armor catalog would contain ${nextCustomArmorCatalog.pieces.length} pieces; max is ${CUSTOM_ARMOR_MAX_CATALOG_PIECES}.`],
      warnings,
    };
  }

  const armorBytes = customArmorCatalogByteLength(nextCustomArmorCatalog);
  if (armorBytes > CUSTOM_ARMOR_MAX_CATALOG_BYTES) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: [`Custom armor catalog would be ${armorBytes} bytes; max is ${CUSTOM_ARMOR_MAX_CATALOG_BYTES}.`],
      warnings,
    };
  }

  const remappedProfile: V3SuitProfile = {
    ...profile,
    slotPieceIds: Object.fromEntries(
      Object.entries(profile.slotPieceIds).map(([slot, pieceId]) => [
        slot,
        typeof pieceId === 'string' ? idRemap.get(pieceId) ?? pieceId : pieceId,
      ])
    ) as Partial<Record<V3CustomArmorSlot, string>>,
  };
  const profileValidation = validateV3SuitProfile(remappedProfile, nextCustomArmorCatalog);
  if (!profileValidation.valid || profileValidation.status !== 'ready') {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: profileValidation.errors.length > 0
        ? profileValidation.errors
        : ['Suit profile import bundle is missing referenced pieces.'],
      warnings: [...warnings, ...profileValidation.warnings],
    };
  }

  const upsertedProfile = upsertV3SuitProfile(profileCatalog, remappedProfile, { now });
  if (upsertedProfile.errors.length > 0 || !upsertedProfile.profile) {
    return {
      customArmorCatalog,
      profileCatalog,
      importedPieces: [],
      errors: upsertedProfile.errors,
      warnings: [...warnings, ...profileValidation.warnings],
    };
  }

  return {
    customArmorCatalog: nextCustomArmorCatalog,
    profileCatalog: upsertedProfile.catalog,
    profile: upsertedProfile.profile,
    importedPieces,
    errors: [],
    warnings: [...warnings, ...profileValidation.warnings],
  };
}
