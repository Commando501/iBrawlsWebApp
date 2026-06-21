import {
  V3_CHARACTER_SLOT_IDS,
  V3_WEAPON_IDS,
  type V3AssetBudget,
  type V3AssetMetadata,
  type V3CharacterSlotId,
  type V3LodLevel,
  type V3PaintRole,
  type V3SocketDefinition,
  type V3SocketName,
  type V3Vec3Tuple,
  type V3WeaponId,
} from './v3ModelTypes';

export interface V3CharacterPartManifest extends V3AssetMetadata {
  kind: 'characterPart';
  slot: V3CharacterSlotId;
  boundsId: V3CharacterSlotId;
  designLine: string;
}

export interface V3WeaponManifest extends Omit<V3AssetMetadata, 'sockets'> {
  kind: 'weapon';
  weapon: V3WeaponId;
  boundsId: V3WeaponId;
  designLine: string;
  sockets: V3SocketDefinition[];
  semanticAxes?: {
    forward: V3Vec3Tuple;
    up: V3Vec3Tuple;
  };
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
  sourceVoxelCount: 120000,
  mergedBoxCount: 60000,
  materialGroupCount: 95,
  drawCallEstimate: 95,
  memoryEstimateKb: 32000,
};

export const V3_DEFAULT_WEAPON_BUDGET_LIMITS: V3BudgetSummary = {
  partCount: V3_WEAPON_IDS.length,
  sourceVoxelCount: 4200,
  mergedBoxCount: 1050,
  materialGroupCount: 20,
  drawCallEstimate: 20,
  memoryEstimateKb: 980,
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

  if (budget.lodCount >= lods.length) {
    return lods;
  }

  if (budget.lodCount <= 1) {
    return [lods[lods.length - 1]];
  }

  return [
    lods[0],
    ...lods.slice(-(budget.lodCount - 1)),
  ];
};

const createSocket = (
  name: V3SocketName,
  bone: string,
  position: [number, number, number],
  rotation: [number, number, number]
): V3SocketDefinition => ({
  name,
  bone,
  position,
  rotation,
});

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
    roles: ['primary', 'secondary', 'visor', 'accent', 'emissive', 'fixed'],
    budget: createBudget(10500, 5400, 5, 5, 3, 2500),
  }),
  createCharacterPart({
    slot: 'neck',
    label: 'Aegis Sealed Collar',
    roles: ['undersuit', 'secondary'],
    budget: createBudget(3800, 2600, 4, 4, 3, 900),
  }),
  createCharacterPart({
    slot: 'chest',
    label: 'Aegis Core Chestplate',
    roles: ['undersuit', 'secondary', 'accent', 'decal', 'fixed'],
    budget: createBudget(4800, 2500, 4, 4, 3, 1200),
  }),
  createCharacterPart({
    slot: 'shoulderLeft',
    label: 'Aegis Left Guard',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(4300, 2400, 3, 3, 3, 1050),
  }),
  createCharacterPart({
    slot: 'shoulderRight',
    label: 'Aegis Right Guard',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(4300, 2400, 3, 3, 3, 1050),
  }),
  createCharacterPart({
    slot: 'upperArmLeft',
    label: 'Aegis Left Upper Arm',
    roles: ['undersuit', 'secondary', 'accent'],
    budget: createBudget(5400, 3000, 5, 5, 3, 1300),
  }),
  createCharacterPart({
    slot: 'upperArmRight',
    label: 'Aegis Right Upper Arm',
    roles: ['undersuit', 'secondary', 'accent'],
    budget: createBudget(5400, 3000, 5, 5, 3, 1300),
  }),
  createCharacterPart({
    slot: 'forearmLeft',
    label: 'Aegis Left Bracer',
    roles: ['undersuit', 'accent', 'secondary'],
    budget: createBudget(1650, 1400, 1, 1, 3, 400),
  }),
  createCharacterPart({
    slot: 'forearmRight',
    label: 'Aegis Right Bracer',
    roles: ['undersuit', 'accent', 'secondary'],
    budget: createBudget(1650, 1400, 1, 1, 3, 400),
  }),
  createCharacterPart({
    slot: 'handLeft',
    label: 'Aegis Left Glove',
    roles: ['undersuit', 'accent', 'fixed'],
    budget: createBudget(2100, 1300, 1, 1, 2, 500),
  }),
  createCharacterPart({
    slot: 'handRight',
    label: 'Aegis Right Glove',
    roles: ['undersuit', 'accent', 'fixed'],
    budget: createBudget(2100, 1300, 1, 1, 2, 500),
  }),
  createCharacterPart({
    slot: 'pelvis',
    label: 'Aegis Belt Assembly',
    roles: ['undersuit', 'secondary', 'accent', 'decal'],
    budget: createBudget(15800, 6500, 3, 3, 3, 3800),
  }),
  createCharacterPart({
    slot: 'thighLeft',
    label: 'Aegis Left Thigh Plate',
    roles: ['undersuit', 'secondary', 'accent'],
    budget: createBudget(6500, 3100, 4, 4, 3, 1600),
  }),
  createCharacterPart({
    slot: 'thighRight',
    label: 'Aegis Right Thigh Plate',
    roles: ['undersuit', 'secondary', 'accent'],
    budget: createBudget(6500, 3100, 4, 4, 3, 1600),
  }),
  createCharacterPart({
    slot: 'shinLeft',
    label: 'Aegis Left Shin Guard',
    roles: ['undersuit', 'accent', 'secondary', 'fixed'],
    budget: createBudget(7100, 3300, 4, 4, 3, 1700),
  }),
  createCharacterPart({
    slot: 'shinRight',
    label: 'Aegis Right Shin Guard',
    roles: ['undersuit', 'accent', 'secondary', 'fixed'],
    budget: createBudget(7100, 3300, 4, 4, 3, 1700),
  }),
  createCharacterPart({
    slot: 'footLeft',
    label: 'Aegis Left Boot',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(6800, 2600, 3, 3, 3, 1600),
  }),
  createCharacterPart({
    slot: 'footRight',
    label: 'Aegis Right Boot',
    roles: ['primary', 'secondary', 'accent'],
    budget: createBudget(6800, 2600, 3, 3, 3, 1600),
  }),
  createCharacterPart({
    slot: 'back',
    label: 'Aegis Utility Pack',
    roles: ['undersuit', 'secondary', 'emissive', 'fixed'],
    budget: createBudget(10300, 4800, 5, 5, 3, 2500),
  }),
];

export const BUILT_IN_V3_WEAPONS: readonly V3WeaponManifest[] = [
  {
    id: 'ibv3-aegis-rift-hammer',
    label: 'Aegis Rift Hammer',
    kind: 'weapon',
    weapon: 'hammer',
    boundsId: 'hammer',
    designLine: 'Aegis Vanguard',
    paintRoles: ['primary', 'secondary', 'accent', 'emissive', 'fixed'],
    budget: createBudget(1700, 420, 6, 6, 3, 360),
    lods: createLods('ibv3-aegis-rift-hammer', createBudget(1700, 420, 6, 6, 3, 360)),
    sockets: [
      createSocket('thirdPersonPrimaryGrip', 'handRight', [0.08, -0.1, 0.02], [0, 0, -0.22]),
      createSocket('thirdPersonOffhandGrip', 'handLeft', [0.52, -0.27, 0.17], [0.1, 0, 0.18]),
      createSocket('firstPersonPrimaryGrip', 'viewRightHand', [0.18, -0.32, -0.52], [-0.2, 0.08, -0.18]),
      createSocket('firstPersonOffhandGrip', 'viewLeftHand', [-0.18, -0.12, -0.46], [-0.1, -0.08, 0.16]),
    ],
    semanticAxes: { forward: [0, 1, 0], up: [0, 0, 1] },
  },
  {
    id: 'ibv3-aegis-flux-blade',
    label: 'Aegis Flux Blade',
    kind: 'weapon',
    weapon: 'sword',
    boundsId: 'sword',
    designLine: 'Aegis Vanguard',
    paintRoles: ['primary', 'secondary', 'emissive', 'fixed'],
    budget: createBudget(1250, 300, 5, 5, 3, 270),
    lods: createLods('ibv3-aegis-flux-blade', createBudget(1250, 300, 5, 5, 3, 270)),
    sockets: [
      createSocket('thirdPersonPrimaryGrip', 'handRight', [0.04, -0.04, 0.03], [0.1, 0, -0.36]),
      createSocket('thirdPersonOffhandGrip', 'handLeft', [-0.06, 0.08, 0.02], [0.18, 0.04, 0.28]),
      createSocket('firstPersonPrimaryGrip', 'viewRightHand', [0.22, -0.22, -0.48], [-0.18, 0.16, -0.32]),
      createSocket('firstPersonOffhandGrip', 'viewLeftHand', [-0.12, -0.08, -0.42], [-0.08, -0.06, 0.2]),
    ],
    semanticAxes: { forward: [0, 1, 0], up: [0, 0, 1] },
  },
  {
    id: 'ibv3-aegis-sidearm',
    label: 'Aegis Compact Pistol',
    kind: 'weapon',
    weapon: 'pistol',
    boundsId: 'pistol',
    designLine: 'Aegis Vanguard',
    paintRoles: ['primary', 'secondary', 'accent', 'emissive'],
    budget: createBudget(720, 160, 4, 4, 2, 160),
    lods: createLods('ibv3-aegis-sidearm', createBudget(720, 160, 4, 4, 2, 160)),
    sockets: [
      createSocket('thirdPersonPrimaryGrip', 'handRight', [0.02, -0.03, 0.01], [0, 0.04, -0.12]),
      createSocket('thirdPersonOffhandGrip', 'handLeft', [-0.04, 0.04, 0], [0.04, -0.02, 0.1]),
      createSocket('firstPersonPrimaryGrip', 'viewRightHand', [0.16, -0.18, -0.34], [-0.06, 0.1, -0.1]),
      createSocket('firstPersonOffhandGrip', 'viewLeftHand', [-0.08, -0.1, -0.3], [-0.04, -0.04, 0.08]),
    ],
    semanticAxes: { forward: [1, 0, 0], up: [0, 0, 1] },
  },
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

const copySocket = (socket: V3SocketDefinition): V3SocketDefinition => ({
  ...socket,
  position: [...socket.position],
  rotation: [...socket.rotation],
});

const copyCharacterPart = (part: V3CharacterPartManifest): V3CharacterPartManifest => ({
  ...part,
  paintRoles: [...part.paintRoles],
  budget: copyBudget(part.budget),
  lods: part.lods.map(copyLod),
});

const copyWeapon = (weapon: V3WeaponManifest): V3WeaponManifest => ({
  ...weapon,
  paintRoles: [...weapon.paintRoles],
  budget: copyBudget(weapon.budget),
  lods: weapon.lods.map(copyLod),
  sockets: weapon.sockets.map(copySocket),
  semanticAxes: weapon.semanticAxes
    ? {
      forward: [...weapon.semanticAxes.forward],
      up: [...weapon.semanticAxes.up],
    }
    : undefined,
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

export function getDefaultV3WeaponManifest(weapon: V3WeaponId): V3WeaponManifest {
  const manifest = BUILT_IN_V3_WEAPONS.find((candidate) => candidate.weapon === weapon);
  if (!manifest) {
    throw new Error(`Missing V3 weapon manifest: ${weapon}`);
  }

  return copyWeapon(manifest);
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

export function getDefaultV3WeaponBudgetSummary(): V3BudgetSummary {
  return BUILT_IN_V3_WEAPONS.reduce(
    (summary, weapon) => ({
      partCount: summary.partCount + 1,
      sourceVoxelCount: summary.sourceVoxelCount + weapon.budget.sourceVoxelCount,
      mergedBoxCount: summary.mergedBoxCount + weapon.budget.mergedBoxCount,
      materialGroupCount: summary.materialGroupCount + weapon.budget.materialGroupCount,
      drawCallEstimate: summary.drawCallEstimate + weapon.budget.drawCallEstimate,
      memoryEstimateKb: summary.memoryEstimateKb + weapon.budget.memoryEstimateKb,
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
