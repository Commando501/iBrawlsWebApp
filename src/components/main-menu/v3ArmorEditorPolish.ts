import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
} from '../customArmor';
import {
  centerCustomArmorPiece,
  dedupeCustomArmorVoxels,
  fitCustomArmorToBounds,
  getCustomArmorBounds,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  removeFloatingVoxels,
  validateCustomArmorPiece,
} from '../customArmor';
import type { V3ArmorEditorVisualQaReport } from './v3ArmorEditorVisualQa';

export type V3ArmorEditorPolishActionId =
  | 'boostReadability'
  | 'reduceDarkCoverage'
  | 'improvePaneling'
  | 'polishSilhouette';

type V3ArmorEditorPolishIssueCode = V3ArmorEditorVisualQaReport['issues'][number]['code'];

export interface V3ArmorEditorPolishAction {
  id: V3ArmorEditorPolishActionId;
  label: string;
  reason: string;
  enabled: boolean;
  issueCodes: V3ArmorEditorPolishIssueCode[];
}

export interface V3ArmorEditorPolishContext {
  visualQa?: V3ArmorEditorVisualQaReport;
  missingRecommendedRoles?: CustomArmorMaterialRole[];
  now?: number;
}

const ACTION_ORDER: V3ArmorEditorPolishActionId[] = [
  'boostReadability',
  'reduceDarkCoverage',
  'improvePaneling',
  'polishSilhouette',
];

const READABLE_REMAP_ROLES: CustomArmorMaterialRole[] = ['secondary', 'accent', 'highlight', 'primary'];
const PANEL_REMAP_ROLES: CustomArmorMaterialRole[] = ['secondary', 'accent', 'highlight'];
const DARK_ROLES = new Set<CustomArmorMaterialRole>(['dark', 'undersuit']);
const PRESERVED_ROLES = new Set<CustomArmorMaterialRole>(['fixed', 'emissive', 'decal', 'visor']);

function getIssueCodes(context: V3ArmorEditorPolishContext): V3ArmorEditorPolishIssueCode[] {
  return [...new Set(context.visualQa?.issues.map((issue) => issue.code) ?? [])];
}

function getMatchingIssueCodes(
  context: V3ArmorEditorPolishContext,
  codes: readonly V3ArmorEditorPolishIssueCode[]
): V3ArmorEditorPolishIssueCode[] {
  const present = new Set(getIssueCodes(context));
  return codes.filter((code) => present.has(code));
}

function isV3Draft(draft: CustomArmorPieceSnapshot): boolean {
  return getCustomArmorPieceModelSystem(draft) === 'v3';
}

function countRoles(
  voxels: readonly CustomArmorVoxel[],
  roles: ReadonlySet<CustomArmorMaterialRole>
): number {
  return voxels.reduce((count, voxel) => count + (roles.has(voxel.role) ? 1 : 0), 0);
}

function getRoleDiversity(voxels: readonly CustomArmorVoxel[]): number {
  return new Set(voxels.map((voxel) => voxel.role)).size;
}

function isDarkDominant(draft: CustomArmorPieceSnapshot): boolean {
  const voxels = dedupeCustomArmorVoxels(draft.voxels);
  if (voxels.length < 8) return false;
  return countRoles(voxels, DARK_ROLES) / voxels.length >= 0.55;
}

function hasPanelingGap(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): boolean {
  const issueCodes = getIssueCodes(context);
  return (
    issueCodes.includes('panel_count_low') ||
    issueCodes.includes('material_groups_low') ||
    (context.missingRecommendedRoles?.some((role) => !DARK_ROLES.has(role)) ?? false) ||
    getRoleDiversity(draft.voxels) < 2
  );
}

function getBoundsDimensions(voxels: readonly CustomArmorVoxel[]): {
  sizeX: number;
  sizeY: number;
  sizeZ: number;
} | undefined {
  const bounds = getCustomArmorBounds([...voxels]);
  if (!bounds) return undefined;
  return {
    sizeX: bounds.maxX - bounds.minX + 1,
    sizeY: bounds.maxY - bounds.minY + 1,
    sizeZ: bounds.maxZ - bounds.minZ + 1,
  };
}

function isBroadEnoughForSilhouette(voxels: readonly CustomArmorVoxel[]): boolean {
  if (voxels.length < 48) return false;
  const dimensions = getBoundsDimensions(voxels);
  if (!dimensions) return false;
  const broadAxes = [dimensions.sizeX, dimensions.sizeY, dimensions.sizeZ]
    .filter((size) => size >= 6).length;
  return broadAxes >= 2;
}

function createAction(
  id: V3ArmorEditorPolishActionId,
  enabled: boolean,
  issueCodes: V3ArmorEditorPolishIssueCode[],
  reason: string
): V3ArmorEditorPolishAction {
  const labels: Record<V3ArmorEditorPolishActionId, string> = {
    boostReadability: 'Boost readability',
    reduceDarkCoverage: 'Reduce dark coverage',
    improvePaneling: 'Improve paneling',
    polishSilhouette: 'Polish silhouette',
  };
  return {
    id,
    label: labels[id],
    reason,
    enabled,
    issueCodes,
  };
}

export function buildV3ArmorEditorPolishActions(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext = {}
): V3ArmorEditorPolishAction[] {
  if (!isV3Draft(draft)) {
    return ACTION_ORDER.map((id) => createAction(
      id,
      false,
      [],
      'V3 polish actions only apply to V3 armor drafts.'
    ));
  }

  const darkIssueCodes = getMatchingIssueCodes(context, ['dark_coverage_high']);
  const panelIssueCodes = getMatchingIssueCodes(context, ['panel_count_low', 'material_groups_low', 'important_part_missing']);
  const reduceDarkCoverage = darkIssueCodes.length > 0 || isDarkDominant(draft);
  const improvePaneling = hasPanelingGap(draft, context);
  const polishSilhouette = isBroadEnoughForSilhouette(dedupeCustomArmorVoxels(draft.voxels));
  const boostReadability = reduceDarkCoverage || improvePaneling || polishSilhouette;

  return [
    createAction(
      'boostReadability',
      boostReadability,
      [...new Set([...darkIssueCodes, ...panelIssueCodes])],
      boostReadability
        ? 'Runs safe cleanup, material balancing, panel separation, and silhouette trimming.'
        : 'No readability polish is currently needed.'
    ),
    createAction(
      'reduceDarkCoverage',
      reduceDarkCoverage,
      darkIssueCodes,
      reduceDarkCoverage
        ? 'Dark or undersuit materials dominate the visible armor read.'
        : 'Dark material coverage is already balanced.'
    ),
    createAction(
      'improvePaneling',
      improvePaneling,
      panelIssueCodes,
      improvePaneling
        ? 'Adds material separation by remapping existing panel voxels.'
        : 'Material paneling already has enough separation.'
    ),
    createAction(
      'polishSilhouette',
      polishSilhouette,
      [],
      polishSilhouette
        ? 'Trims deterministic slab corners while preserving the editable bounds.'
        : 'The silhouette is not broad enough for safe trimming.'
    ),
  ];
}

function getUpdatedAt(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): number {
  return context.now ?? draft.updatedAt;
}

function withVoxels(
  draft: CustomArmorPieceSnapshot,
  voxels: CustomArmorVoxel[],
  context: V3ArmorEditorPolishContext
): CustomArmorPieceSnapshot {
  return {
    ...draft,
    voxels: dedupeCustomArmorVoxels(voxels),
    updatedAt: getUpdatedAt(draft, context),
  };
}

function isValidCandidate(
  original: CustomArmorPieceSnapshot,
  candidate: CustomArmorPieceSnapshot
): boolean {
  return !validateCustomArmorPiece(original).valid || validateCustomArmorPiece(candidate).valid;
}

function commitCandidate(
  original: CustomArmorPieceSnapshot,
  candidate: CustomArmorPieceSnapshot
): CustomArmorPieceSnapshot {
  return isValidCandidate(original, candidate) ? candidate : original;
}

function restoreDraftMetadata(
  original: CustomArmorPieceSnapshot,
  candidate: CustomArmorPieceSnapshot
): CustomArmorPieceSnapshot {
  return {
    ...candidate,
    version: original.version,
    id: original.id,
    name: original.name,
    slot: original.slot,
    modelSystem: original.modelSystem,
    modelType: original.modelType,
    gridScale: original.gridScale,
    sourcePreset: original.sourcePreset,
    thumbnail: original.thumbnail,
  };
}

function roleAt(
  roles: readonly CustomArmorMaterialRole[],
  index: number
): CustomArmorMaterialRole {
  return roles[index % roles.length] ?? 'primary';
}

function remapVoxelRole(
  voxel: CustomArmorVoxel,
  role: CustomArmorMaterialRole
): CustomArmorVoxel {
  if (voxel.role === role) return { ...voxel };
  const next: CustomArmorVoxel = { ...voxel, role };
  if (role !== 'fixed') {
    delete next.color;
  }
  return next;
}

function coordKey(voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string {
  return `${voxel.x}:${voxel.y}:${voxel.z}`;
}

function buildCoordSet(voxels: readonly CustomArmorVoxel[]): Set<string> {
  return new Set(voxels.map(coordKey));
}

function exposureScore(voxel: CustomArmorVoxel, occupied: ReadonlySet<string>): number {
  const neighbors = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  return neighbors.reduce((score, [dx, dy, dz]) => (
    occupied.has(`${voxel.x + dx}:${voxel.y + dy}:${voxel.z + dz}`) ? score : score + 1
  ), 0);
}

function sortVoxelsForSurfaceReadability(voxels: readonly CustomArmorVoxel[]): CustomArmorVoxel[] {
  const occupied = buildCoordSet(voxels);
  return [...voxels].sort((a, b) => (
    exposureScore(b, occupied) - exposureScore(a, occupied) ||
    b.y - a.y ||
    b.z - a.z ||
    a.x - b.x
  ));
}

function chooseEvenly<T>(items: readonly T[], count: number): T[] {
  if (count <= 0 || items.length === 0) return [];
  if (count >= items.length) return [...items];
  const selected: T[] = [];
  const usedIndexes = new Set<number>();
  const denominator = count + 1;
  for (let index = 1; index <= count; index++) {
    let itemIndex = Math.floor((items.length * index) / denominator);
    while (usedIndexes.has(itemIndex) && itemIndex < items.length - 1) {
      itemIndex++;
    }
    while (usedIndexes.has(itemIndex) && itemIndex > 0) {
      itemIndex--;
    }
    usedIndexes.add(itemIndex);
    const item = items[itemIndex];
    if (item !== undefined) selected.push(item);
  }
  return selected;
}

function getReadableRoles(context: V3ArmorEditorPolishContext): CustomArmorMaterialRole[] {
  const requested = context.missingRecommendedRoles
    ?.filter((role) => READABLE_REMAP_ROLES.includes(role)) ?? [];
  return [...new Set([...requested, ...READABLE_REMAP_ROLES])];
}

function reduceDarkCoverage(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): CustomArmorPieceSnapshot {
  const voxels = dedupeCustomArmorVoxels(draft.voxels);
  const darkCount = countRoles(voxels, DARK_ROLES);
  if (darkCount === 0) return draft;
  const issueCodes = getIssueCodes(context);
  if (!issueCodes.includes('dark_coverage_high') && !isDarkDominant(draft)) return draft;

  const targetDarkCount = Math.floor(voxels.length * 0.42);
  const targetDrivenRemapCount = Math.max(0, darkCount - targetDarkCount);
  const issueDrivenRemapCount = issueCodes.includes('dark_coverage_high')
    ? Math.max(1, Math.ceil(darkCount * 0.25))
    : 0;
  const remapCount = Math.min(darkCount, Math.max(targetDrivenRemapCount, issueDrivenRemapCount));
  if (remapCount === 0) return draft;

  const darkCandidates = sortVoxelsForSurfaceReadability(voxels)
    .filter((voxel) => DARK_ROLES.has(voxel.role));
  const selectedKeys = new Set(chooseEvenly(darkCandidates, remapCount).map(coordKey));
  const roles = getReadableRoles(context);
  let remapped = 0;
  const next = voxels.map((voxel) => {
    if (!selectedKeys.has(coordKey(voxel))) return voxel;
    const replacement = remapVoxelRole(voxel, roleAt(roles, remapped));
    remapped++;
    return replacement;
  });

  return commitCandidate(draft, withVoxels(draft, next, context));
}

function getPanelRoles(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): CustomArmorMaterialRole[] {
  const present = new Set(draft.voxels.map((voxel) => voxel.role));
  const requested = context.missingRecommendedRoles
    ?.filter((role) => PANEL_REMAP_ROLES.includes(role)) ?? [];
  return [...new Set([
    ...requested,
    ...PANEL_REMAP_ROLES.filter((role) => !present.has(role)),
    ...PANEL_REMAP_ROLES,
  ])];
}

function improvePaneling(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): CustomArmorPieceSnapshot {
  if (!hasPanelingGap(draft, context)) return draft;
  const voxels = dedupeCustomArmorVoxels(draft.voxels);
  const roles = getPanelRoles(draft, context);
  if (roles.length === 0) return draft;

  const candidates = sortVoxelsForSurfaceReadability(voxels)
    .filter((voxel) => !PRESERVED_ROLES.has(voxel.role));
  const remapCount = Math.min(
    candidates.length,
    Math.max(roles.length, Math.floor(voxels.length * 0.14))
  );
  if (remapCount === 0) return draft;

  const selectedKeys = new Set(chooseEvenly(candidates, remapCount).map(coordKey));
  let remapped = 0;
  const next = voxels.map((voxel) => {
    if (!selectedKeys.has(coordKey(voxel))) return voxel;
    const replacement = remapVoxelRole(voxel, roleAt(roles, remapped));
    remapped++;
    return replacement;
  });

  return commitCandidate(draft, withVoxels(draft, next, context));
}

function getCornerScore(
  voxel: CustomArmorVoxel,
  bounds: NonNullable<ReturnType<typeof getCustomArmorBounds>>
): number {
  return (
    (voxel.x === bounds.minX || voxel.x === bounds.maxX ? 1 : 0) +
    (voxel.y === bounds.minY || voxel.y === bounds.maxY ? 1 : 0) +
    (voxel.z === bounds.minZ || voxel.z === bounds.maxZ ? 1 : 0)
  );
}

function polishSilhouette(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): CustomArmorPieceSnapshot {
  const voxels = dedupeCustomArmorVoxels(draft.voxels);
  if (!isBroadEnoughForSilhouette(voxels)) return draft;
  const bounds = getCustomArmorBounds(voxels);
  if (!bounds) return draft;

  const safeFloor = Math.max(24, Math.ceil(voxels.length * 0.85));
  const removable = voxels
    .filter((voxel) => getCornerScore(voxel, bounds) >= 2)
    .sort((a, b) => (
      getCornerScore(b, bounds) - getCornerScore(a, bounds) ||
      b.y - a.y ||
      b.z - a.z ||
      a.x - b.x
    ));
  const removeCount = Math.min(removable.length, voxels.length - safeFloor);
  if (removeCount <= 0) return draft;

  const removeKeys = new Set(removable.slice(0, removeCount).map(coordKey));
  const next = voxels.filter((voxel) => !removeKeys.has(coordKey(voxel)));
  if (next.length < safeFloor) return draft;

  return commitCandidate(draft, withVoxels(draft, next, context));
}

function normalizeForReadability(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorEditorPolishContext
): CustomArmorPieceSnapshot {
  const fitted = fitCustomArmorToBounds(draft);
  const centered = centerCustomArmorPiece(fitted);
  const connectedVoxels = removeFloatingVoxels(centered.voxels);
  const candidate = restoreDraftMetadata(draft, withVoxels(
    {
      ...centered,
      gridScale: getCustomArmorGridScale(centered),
    },
    connectedVoxels,
    context
  ));
  return commitCandidate(draft, candidate);
}

export function applyV3ArmorEditorPolishAction(
  draft: CustomArmorPieceSnapshot,
  actionId: V3ArmorEditorPolishActionId,
  context: V3ArmorEditorPolishContext = {}
): CustomArmorPieceSnapshot {
  if (!isV3Draft(draft)) {
    return {
      ...draft,
      voxels: draft.voxels.map((voxel) => ({ ...voxel })),
    };
  }

  switch (actionId) {
    case 'reduceDarkCoverage':
      return reduceDarkCoverage(draft, context);
    case 'improvePaneling':
      return improvePaneling(draft, context);
    case 'polishSilhouette':
      return polishSilhouette(draft, context);
    case 'boostReadability': {
      const normalized = normalizeForReadability(draft, context);
      const reduced = reduceDarkCoverage(normalized, context);
      const paneled = improvePaneling(reduced, context);
      return polishSilhouette(paneled, context);
    }
    default:
      return draft;
  }
}
