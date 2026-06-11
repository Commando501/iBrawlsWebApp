import {
  V3_CHARACTER_SLOT_IDS,
  type V3AssetBudget,
  type V3AssetMetadata,
  type V3CharacterSlotId,
  type V3LodLevel,
  type V3PaintRole,
} from './v3ModelTypes';

export interface V3CharacterPartManifest extends V3AssetMetadata {
  kind: 'characterPart';
  slot: V3CharacterSlotId;
  boundsId: V3CharacterSlotId;
  designLine: string;
}

export interface V3CharacterLoadoutManifest {
  id: string;
  label: string;
  modelSystem: 'v3';
  partIds: Record<V3CharacterSlotId, string>;
}

export interface V3BudgetSummary {
  partCount: number;
  sourceVoxelCount: number;
  mergedBoxCount: number;
  materialGroupCount: number;
  drawCallEstimate: number;
  memoryEstimateKb: number;
}

export const V3_DEFAULT_CHARACTER_BUDGET_LIMITS: V3BudgetSummary = {
  partCount: V3_CHARACTER_SLOT_IDS.length,
  sourceVoxelCount: 12000,
  mergedBoxCount: 3200,
  materialGroupCount: 72,
  drawCallEstimate: 72,
  memoryEstimateKb: 3600,
};

const createBudget = (
  sourceVoxelCount: number,
  mergedBoxCount: number,
  materialGroupCount: number,
  drawCallEstimate: number,
  lodCount: number,
  memoryEstimateKb: number
): V3AssetBudget => ({
  sourceVoxelCount,
  mergedBoxCount,
  materialGroupCount,
  drawCallEstimate,
  lodCount,
  memoryEstimateKb,
});

const scaleBudget = (budget: V3AssetBudget, scale: number): V3AssetBudget => ({
  sourceVoxelCount: Math.max(1, Math.round(budget.sourceVoxelCount * scale)),
  mergedBoxCount: Math.max(1, Math.round(budget.mergedBoxCount * scale)),
  materialGroupCount: Math.max(1, Math.min(budget.materialGroupCount, Math.round(budget.materialGroupCount * scale))),
  drawCallEstimate: Math.max(1, Math.min(budget.drawCallEstimate, Math.round(budget.drawCallEstimate * scale))),
  lodCount: 1,
  memoryEstimateKb: Math.max(1, Math.round(budget.memoryEstimateKb * scale)),
});

const createLods = (assetId: string, budget: V3AssetBudget): V3LodLevel[] => {
  const lods: V3LodLevel[] = [
    {
      id: `${assetId}:lod-ultra`,
      sourceId: `${assetId}:source-ultra`,
      qualityTier: 'ultra',
      maxDistance: 8,
      budget: scaleBudget(budget, 1),
    },
    {
      id: `${assetId}:lod-desktop`,
      sourceId: `${assetId}:source-desktop`,
      qualityTier: 'desktop',
      maxDistance: 18,
      budget: scaleBudget(budget, 0.68),
    },
    {
      id: `${assetId}:lod-mobile`,
      sourceId: `${assetId}:source-mobile`,
      qualityTier: 'mobile',
      maxDistance: 9999,
      budget: scaleBudget(budget, 0.42),
    },
  ];

  return lods.slice(0, budget.lodCount);
};

const createCharacterPart = ({
  slot,
  label,
  roles,
  budget,
}: {
  slot: V3CharacterSlotId;
  label: string;
  roles: readonly V3PaintRole[];
  budget: V3AssetBudget;
}): V3CharacterPartManifest => {
  const id = `ibv3-aegis-${slot}`;
  return {
    id,
    label,
    kind: 'characterPart',
    slot,
    boundsId: slot,
    designLine: 'Aegis Vanguard',
    paintRoles: roles,
    budget,
    lods: createLods(id, budget),
  };
};

export const BUILT_IN_V3_CHARACTER_PARTS: readonly V3CharacterPartManifest[] = [
  createCharacterPart({
    slot: 'helmet',
    label: 'Aegis Vanguard Helmet',
    roles: ['primary', 'secondary', 'visor', 'accent', 'emissive'],
    budget: createBudget(780, 190, 5, 5, 3, 160),
  }),
  createCharacterPart({
    slot: 'neck',
    label: 'Aegis Sealed Collar',
    roles: ['undersuit', 'secondary'],
    budget: createBudget(180, 40, 2, 2, 2, 40),
  }),
  createCharacterPart({
    slot: 'chest',
    label: 'Aegis Core Chestplate',
    roles: ['primary', 'secondary', 'accent', 'decal'],
    budget: createBudget(1300, 320, 5, 5, 3, 260),
  }),
  createCharacterPart({
    slot: 'shoulderLeft',
    label: 'Aegis Left Guard',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(360, 85, 3, 3, 3, 72),
  }),
  createCharacterPart({
    slot: 'shoulderRight',
    label: 'Aegis Right Guard',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(360, 85, 3, 3, 3, 72),
  }),
  createCharacterPart({
    slot: 'upperArmLeft',
    label: 'Aegis Left Upper Arm',
    roles: ['primary', 'undersuit', 'secondary'],
    budget: createBudget(420, 95, 3, 3, 3, 84),
  }),
  createCharacterPart({
    slot: 'upperArmRight',
    label: 'Aegis Right Upper Arm',
    roles: ['primary', 'undersuit', 'secondary'],
    budget: createBudget(420, 95, 3, 3, 3, 84),
  }),
  createCharacterPart({
    slot: 'forearmLeft',
    label: 'Aegis Left Bracer',
    roles: ['primary', 'accent', 'undersuit'],
    budget: createBudget(460, 105, 3, 3, 3, 92),
  }),
  createCharacterPart({
    slot: 'forearmRight',
    label: 'Aegis Right Bracer',
    roles: ['primary', 'accent', 'undersuit'],
    budget: createBudget(460, 105, 3, 3, 3, 92),
  }),
  createCharacterPart({
    slot: 'handLeft',
    label: 'Aegis Left Glove',
    roles: ['undersuit', 'accent'],
    budget: createBudget(160, 38, 2, 2, 2, 34),
  }),
  createCharacterPart({
    slot: 'handRight',
    label: 'Aegis Right Glove',
    roles: ['undersuit', 'accent'],
    budget: createBudget(160, 38, 2, 2, 2, 34),
  }),
  createCharacterPart({
    slot: 'pelvis',
    label: 'Aegis Belt Assembly',
    roles: ['primary', 'secondary', 'undersuit', 'decal'],
    budget: createBudget(720, 170, 4, 4, 3, 140),
  }),
  createCharacterPart({
    slot: 'thighLeft',
    label: 'Aegis Left Thigh Plate',
    roles: ['primary', 'secondary', 'undersuit'],
    budget: createBudget(520, 120, 3, 3, 3, 104),
  }),
  createCharacterPart({
    slot: 'thighRight',
    label: 'Aegis Right Thigh Plate',
    roles: ['primary', 'secondary', 'undersuit'],
    budget: createBudget(520, 120, 3, 3, 3, 104),
  }),
  createCharacterPart({
    slot: 'shinLeft',
    label: 'Aegis Left Shin Guard',
    roles: ['primary', 'accent', 'undersuit'],
    budget: createBudget(560, 130, 3, 3, 3, 112),
  }),
  createCharacterPart({
    slot: 'shinRight',
    label: 'Aegis Right Shin Guard',
    roles: ['primary', 'accent', 'undersuit'],
    budget: createBudget(560, 130, 3, 3, 3, 112),
  }),
  createCharacterPart({
    slot: 'footLeft',
    label: 'Aegis Left Boot',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(300, 70, 3, 3, 3, 64),
  }),
  createCharacterPart({
    slot: 'footRight',
    label: 'Aegis Right Boot',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(300, 70, 3, 3, 3, 64),
  }),
  createCharacterPart({
    slot: 'back',
    label: 'Aegis Utility Pack',
    roles: ['primary', 'secondary', 'emissive', 'fixed'],
    budget: createBudget(640, 150, 4, 4, 3, 128),
  }),
];

const defaultPartIds = BUILT_IN_V3_CHARACTER_PARTS.reduce(
  (partIds, part) => ({
    ...partIds,
    [part.slot]: part.id,
  }),
  {} as Record<V3CharacterSlotId, string>
);

const DEFAULT_V3_CHARACTER_LOADOUT: V3CharacterLoadoutManifest = {
  id: 'ibrawls-v3-aegis',
  label: 'Aegis Vanguard',
  modelSystem: 'v3',
  partIds: defaultPartIds,
};

const copyBudget = (budget: V3AssetBudget): V3AssetBudget => ({ ...budget });

const copyLod = (lod: V3LodLevel): V3LodLevel => ({
  ...lod,
  budget: copyBudget(lod.budget),
});

const copyCharacterPart = (part: V3CharacterPartManifest): V3CharacterPartManifest => ({
  ...part,
  paintRoles: [...part.paintRoles],
  budget: copyBudget(part.budget),
  lods: part.lods.map(copyLod),
});

export function getDefaultV3CharacterLoadout(): V3CharacterLoadoutManifest {
  return {
    ...DEFAULT_V3_CHARACTER_LOADOUT,
    partIds: { ...DEFAULT_V3_CHARACTER_LOADOUT.partIds },
  };
}

export function getV3CharacterPartManifest(id: string): V3CharacterPartManifest | undefined {
  const part = BUILT_IN_V3_CHARACTER_PARTS.find((candidate) => candidate.id === id);
  return part ? copyCharacterPart(part) : undefined;
}

export function getDefaultV3CharacterBudgetSummary(): V3BudgetSummary {
  return BUILT_IN_V3_CHARACTER_PARTS.reduce(
    (summary, part) => ({
      partCount: summary.partCount + 1,
      sourceVoxelCount: summary.sourceVoxelCount + part.budget.sourceVoxelCount,
      mergedBoxCount: summary.mergedBoxCount + part.budget.mergedBoxCount,
      materialGroupCount: summary.materialGroupCount + part.budget.materialGroupCount,
      drawCallEstimate: summary.drawCallEstimate + part.budget.drawCallEstimate,
      memoryEstimateKb: summary.memoryEstimateKb + part.budget.memoryEstimateKb,
    }),
    {
      partCount: 0,
      sourceVoxelCount: 0,
      mergedBoxCount: 0,
      materialGroupCount: 0,
      drawCallEstimate: 0,
      memoryEstimateKb: 0,
    }
  );
}
