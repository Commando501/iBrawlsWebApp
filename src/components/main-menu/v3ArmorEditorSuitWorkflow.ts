import type { CharacterLoadout } from '../VoxelModels';
import {
  CUSTOM_ARMOR_MAX_CATALOG_BYTES,
  CUSTOM_ARMOR_MAX_CATALOG_PIECES,
  createCustomArmorSnapshot,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  upsertCustomArmorPieceInCatalog,
  validateCustomArmorPiece,
  V3_CUSTOM_ARMOR_SLOTS,
  type CustomArmorCatalog,
  type CustomArmorPieceSnapshot,
  type CustomArmorValidationResult,
  type V3CustomArmorSlot,
} from '../customArmor';
import {
  createV3ArmorTemplateDraft,
  getV3ArmorTemplateLabel,
} from './v3ArmorEditorTemplates';

export type V3SuitDraftMap = Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>;

export interface V3SuitSlotValidation {
  slot: V3CustomArmorSlot;
  valid: boolean;
  errors: string[];
  warnings: string[];
  advisoryScore: number;
  dirty?: boolean;
  validation?: CustomArmorValidationResult;
}

export interface V3SuitDraftValidationResult {
  valid: boolean;
  slots: Record<V3CustomArmorSlot, V3SuitSlotValidation>;
  blockers: string[];
  errors: string[];
  advisoryScore: number;
  dirty?: boolean;
}

export interface V3SuitSavePlan {
  nextCatalog: CustomArmorCatalog;
  loadoutPatch?: Pick<CharacterLoadout, 'modelSystem' | 'modelType' | 'customArmor'>;
  savedSnapshots: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>>;
  errors: string[];
}

function cloneSnapshot(snapshot: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot {
  return createCustomArmorSnapshot(snapshot);
}

function isValidV3DraftForSlot(
  slot: V3CustomArmorSlot,
  snapshot: CustomArmorPieceSnapshot | undefined
): snapshot is CustomArmorPieceSnapshot {
  if (!snapshot || snapshot.slot !== slot) return false;
  if (getCustomArmorPieceModelSystem(snapshot) !== 'v3') return false;
  return validateCustomArmorPiece(snapshot).valid;
}

function getCatalogSnapshotById(
  catalog: CustomArmorCatalog,
  id: string | undefined
): CustomArmorPieceSnapshot | undefined {
  if (!id) return undefined;
  const piece = catalog.pieces.find((candidate) => candidate.id === id);
  return piece ? createCustomArmorSnapshot(piece) : undefined;
}

export function createV3SuitDraftMap(
  loadout: CharacterLoadout | undefined,
  catalog: CustomArmorCatalog,
  hue: number,
  now: number
): V3SuitDraftMap {
  return Object.fromEntries(
    V3_CUSTOM_ARMOR_SLOTS.map((slot) => {
      const equipped = loadout?.customArmor?.[slot];
      const catalogSnapshot = getCatalogSnapshotById(catalog, equipped?.id);
      const preferred = isValidV3DraftForSlot(slot, catalogSnapshot) ? catalogSnapshot : equipped;
      const draft = isValidV3DraftForSlot(slot, preferred)
        ? cloneSnapshot(preferred)
        : createV3ArmorTemplateDraft(slot, { hue, now });
      return [slot, draft];
    })
  ) as V3SuitDraftMap;
}

export function mergeV3SuitPreviewLoadout(
  baseLoadout: CharacterLoadout,
  suitDrafts: V3SuitDraftMap,
  activeSlot: V3CustomArmorSlot,
  activeDraft: CustomArmorPieceSnapshot
): CharacterLoadout {
  const customArmor: CharacterLoadout['customArmor'] = {
    ...(baseLoadout.customArmor ?? {}),
  };

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    customArmor[slot] = cloneSnapshot(suitDrafts[slot]);
  }
  customArmor[activeSlot] = cloneSnapshot(activeDraft);

  return {
    ...baseLoadout,
    modelSystem: 'v3',
    modelType: undefined,
    customArmor,
  };
}

function advisoryScoreFor(errors: readonly string[], warnings: readonly string[]): number {
  return Math.max(0, Math.min(100, 100 - (errors.length * 25) - (warnings.length * 5)));
}

function getDraftDirtyState(snapshot: CustomArmorPieceSnapshot | undefined): boolean | undefined {
  if (!snapshot) return undefined;
  return snapshot.id.startsWith('v3_template_') ? true : undefined;
}

export function validateV3SuitDrafts(suitDrafts: V3SuitDraftMap): V3SuitDraftValidationResult {
  const slots = {} as Record<V3CustomArmorSlot, V3SuitSlotValidation>;
  const blockers: string[] = [];
  const slotsByDraftId = new Map<string, V3CustomArmorSlot[]>();
  let totalAdvisoryScore = 0;
  let scoredSlots = 0;
  let dirty = false;

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const id = suitDrafts[slot]?.id;
    if (!id) continue;
    const current = slotsByDraftId.get(id);
    if (current) {
      current.push(slot);
    } else {
      slotsByDraftId.set(id, [slot]);
    }
  }

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const draft = suitDrafts[slot];
    const structuralErrors: string[] = [];

    if (!draft) {
      structuralErrors.push(`${getV3ArmorTemplateLabel(slot)} draft is missing.`);
    } else {
      if (draft.slot !== slot) {
        structuralErrors.push(`${getV3ArmorTemplateLabel(slot)} draft is assigned to ${draft.slot}.`);
      }
      if (getCustomArmorPieceModelSystem(draft) !== 'v3') {
        structuralErrors.push(`${getV3ArmorTemplateLabel(slot)} draft is not a V3 custom piece.`);
      }
      const duplicateSlots = slotsByDraftId.get(draft.id) ?? [];
      if (duplicateSlots.length > 1) {
        const labels = duplicateSlots.map(getV3ArmorTemplateLabel).join(', ');
        structuralErrors.push(`Duplicate draft id ${draft.id} is shared by ${labels}.`);
      }
    }

    const validation = draft ? validateCustomArmorPiece(draft) : undefined;
    const validationErrors = validation?.errors ?? [];
    const warnings = validation?.warnings ?? [];
    const errors = [...structuralErrors, ...validationErrors];
    const slotDirty = getDraftDirtyState(draft);
    const advisoryScore = advisoryScoreFor(errors, warnings);

    totalAdvisoryScore += advisoryScore;
    scoredSlots += 1;
    if (slotDirty === true) dirty = true;
    blockers.push(...errors.map((error) => `${getV3ArmorTemplateLabel(slot)}: ${error}`));

    slots[slot] = {
      slot,
      valid: errors.length === 0,
      errors,
      warnings,
      advisoryScore,
      dirty: slotDirty,
      validation,
    };
  }

  return {
    valid: blockers.length === 0,
    slots,
    blockers,
    errors: blockers,
    advisoryScore: scoredSlots > 0 ? Math.round(totalAdvisoryScore / scoredSlots) : 0,
    dirty: dirty ? true : undefined,
  };
}

export function buildV3SuitSavePlan(
  catalog: CustomArmorCatalog,
  loadout: CharacterLoadout,
  suitDrafts: V3SuitDraftMap,
  now: number
): V3SuitSavePlan {
  const validation = validateV3SuitDrafts(suitDrafts);
  if (!validation.valid) {
    return {
      nextCatalog: catalog,
      savedSnapshots: {},
      errors: validation.blockers,
    };
  }

  let nextCatalog: CustomArmorCatalog = {
    version: 1,
    pieces: catalog.pieces.map((piece) => ({ ...piece, history: piece.history?.map(cloneSnapshot) })),
  };
  const savedSnapshots: Partial<Record<V3CustomArmorSlot, CustomArmorPieceSnapshot>> = {};

  for (const slot of V3_CUSTOM_ARMOR_SLOTS) {
    const result = upsertCustomArmorPieceInCatalog(nextCatalog, {
      ...suitDrafts[slot],
      slot,
      modelSystem: 'v3',
      modelType: undefined,
      gridScale: getCustomArmorGridScale(suitDrafts[slot]),
    }, { now });
    nextCatalog = result.catalog;
    savedSnapshots[slot] = result.snapshot;
  }

  if (nextCatalog.pieces.length > CUSTOM_ARMOR_MAX_CATALOG_PIECES) {
    return {
      nextCatalog: catalog,
      savedSnapshots: {},
      errors: [`Custom armor catalog would contain ${nextCatalog.pieces.length} pieces; max is ${CUSTOM_ARMOR_MAX_CATALOG_PIECES}.`],
    };
  }

  const catalogBytes = JSON.stringify(nextCatalog).length;
  if (catalogBytes > CUSTOM_ARMOR_MAX_CATALOG_BYTES) {
    return {
      nextCatalog: catalog,
      savedSnapshots: {},
      errors: [`Custom armor catalog would be ${catalogBytes} bytes; max is ${CUSTOM_ARMOR_MAX_CATALOG_BYTES}.`],
    };
  }

  return {
    nextCatalog,
    savedSnapshots,
    loadoutPatch: {
      modelSystem: 'v3',
      modelType: undefined,
      customArmor: {
        ...(loadout.customArmor ?? {}),
        ...savedSnapshots,
      },
    },
    errors: [],
  };
}
