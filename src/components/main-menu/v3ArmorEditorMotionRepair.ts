import type {
  CustomArmorMaterialRole,
  CustomArmorGridScale,
  CustomArmorPieceSnapshot,
  CustomArmorVoxel,
  V3CustomArmorSlot,
} from '../customArmor';
import {
  V3_CUSTOM_ARMOR_SLOTS,
  dedupeCustomArmorVoxels,
  getCustomArmorBounds,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  getCustomArmorV3CoordinateSpace,
  isVoxelInSlotBounds,
  validateCustomArmorPiece,
} from '../customArmor';
import type { V3PoseClearanceCaseId } from '../grifball/v3PoseClearance';
import type { V3ArmorEditorMotionQaReport } from './v3ArmorEditorMotionQa';
import type {
  V3SmartAuthoringVoxelDiff,
  V3SmartAuthoringVoxelRemapDiff,
} from './v3ArmorEditorSmartAuthoring';

export type V3ArmorMotionRepairActionId =
  | 'poseSafePolish'
  | 'clearLimbOverlap'
  | 'reducePoseBulk'
  | 'raiseFootClearance'
  | 'fixWeaponGripDrift';

export interface V3ArmorMotionRepairAction {
  id: V3ArmorMotionRepairActionId;
  label: string;
  reason: string;
  enabled: boolean;
  issueCodes: V3ArmorEditorMotionQaReport['issues'][number]['code'][];
}

export interface V3ArmorMotionRepairContext {
  motionQa?: V3ArmorEditorMotionQaReport;
  selectedCaseId?: V3PoseClearanceCaseId;
  activeSlot: V3CustomArmorSlot;
  gridScale: CustomArmorGridScale;
  now?: number;
  cursor?: { x: number; y: number; z: number };
  size?: { x: number; y: number; z: number };
}

export interface V3ArmorMotionRepairPreview {
  actionId: V3ArmorMotionRepairActionId;
  previewDraft: CustomArmorPieceSnapshot;
  changed: boolean;
  added: V3SmartAuthoringVoxelDiff[];
  removed: V3SmartAuthoringVoxelDiff[];
  remapped: V3SmartAuthoringVoxelRemapDiff[];
}

const ACTION_ORDER: V3ArmorMotionRepairActionId[] = [
  'poseSafePolish',
  'clearLimbOverlap',
  'reducePoseBulk',
  'raiseFootClearance',
  'fixWeaponGripDrift',
];

type MotionQaIssue = V3ArmorEditorMotionQaReport['issues'][number];
type MotionQaIssueCode = MotionQaIssue['code'];

const LABELS: Record<V3ArmorMotionRepairActionId, string> = {
  poseSafePolish: 'Pose-Safe Polish',
  clearLimbOverlap: 'Clear Limb Overlap',
  reducePoseBulk: 'Reduce Pose Bulk',
  raiseFootClearance: 'Raise Foot Clearance',
  fixWeaponGripDrift: 'Fix Weapon Grip Drift',
};

const FOOT_REPAIR_SLOTS = new Set<V3CustomArmorSlot>([
  'footLeft',
  'footRight',
  'shinLeft',
  'shinRight',
]);
const GRIP_REPAIR_SLOTS = new Set<V3CustomArmorSlot>([
  'handLeft',
  'handRight',
  'forearmLeft',
  'forearmRight',
  'back',
]);
const V3_SLOT_SET = new Set<string>(V3_CUSTOM_ARMOR_SLOTS);
const PRESERVED_REMAP_ROLES = new Set<CustomArmorMaterialRole>([
  'fixed',
  'emissive',
  'decal',
  'visor',
]);
const READABILITY_ROLES: CustomArmorMaterialRole[] = ['secondary', 'accent', 'highlight'];

const cloneVoxel = (voxel: CustomArmorVoxel): CustomArmorVoxel => ({ ...voxel });

const cloneDraft = (draft: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot => ({
  ...draft,
  voxels: draft.voxels.map(cloneVoxel),
});

const coordKey = (voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): string =>
  `${voxel.x}:${voxel.y}:${voxel.z}`;

function stableVoxelSort(a: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>, b: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>): number {
  return a.y - b.y || a.z - b.z || a.x - b.x;
}

function isV3Draft(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): boolean {
  return getCustomArmorPieceModelSystem(draft) === 'v3'
    && V3_SLOT_SET.has(draft.slot)
    && draft.slot === context.activeSlot;
}

function issueMatchesContext(issue: MotionQaIssue, context: V3ArmorMotionRepairContext): boolean {
  if (issue.code === 'unsupported-non-v3') return false;
  if (context.selectedCaseId && issue.caseId && issue.caseId !== context.selectedCaseId) {
    return false;
  }
  return issue.slots.length === 0 || issue.slots.includes(context.activeSlot);
}

function getMatchingIssueCodes(
  context: V3ArmorMotionRepairContext,
  codes: readonly MotionQaIssueCode[]
): MotionQaIssueCode[] {
  const allowed = new Set(codes);
  const matches = context.motionQa?.summary.supported
    ? context.motionQa.issues
      .filter((issue) => allowed.has(issue.code))
      .filter((issue) => issueMatchesContext(issue, context))
      .map((issue) => issue.code)
    : [];
  return [...new Set(matches)];
}

function createAction(
  id: V3ArmorMotionRepairActionId,
  enabled: boolean,
  issueCodes: MotionQaIssueCode[],
  reason: string
): V3ArmorMotionRepairAction {
  return {
    id,
    label: LABELS[id],
    reason,
    enabled,
    issueCodes,
  };
}

function disabledActions(reason: string): V3ArmorMotionRepairAction[] {
  return ACTION_ORDER.map((id) => createAction(id, false, [], reason));
}

function getActionState(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): Record<V3ArmorMotionRepairActionId, { enabled: boolean; issueCodes: MotionQaIssueCode[]; reason: string }> {
  if (!isV3Draft(draft, context)) {
    const reason = 'Motion repairs only apply to the active V3 armor draft.';
    return Object.fromEntries(ACTION_ORDER.map((id) => [
      id,
      { enabled: false, issueCodes: [], reason },
    ])) as Record<V3ArmorMotionRepairActionId, { enabled: boolean; issueCodes: MotionQaIssueCode[]; reason: string }>;
  }
  if (!context.motionQa || !context.motionQa.summary.supported) {
    const reason = 'Run V3 Motion QA before applying motion repairs.';
    return Object.fromEntries(ACTION_ORDER.map((id) => [
      id,
      { enabled: false, issueCodes: [], reason },
    ])) as Record<V3ArmorMotionRepairActionId, { enabled: boolean; issueCodes: MotionQaIssueCode[]; reason: string }>;
  }

  const overlapCodes = getMatchingIssueCodes(context, ['part-overlap-high']);
  const gapCodes = getMatchingIssueCodes(context, ['limb-gap-low']);
  const footCodes = FOOT_REPAIR_SLOTS.has(context.activeSlot)
    ? getMatchingIssueCodes(context, ['foot-floor-penetration', 'foot-lift-high'])
    : [];
  const gripCodes = GRIP_REPAIR_SLOTS.has(context.activeSlot)
    ? getMatchingIssueCodes(context, ['weapon-drift-high'])
    : [];
  const clearCodes = [...new Set([...overlapCodes, ...gapCodes])];
  const bulkCodes = overlapCodes;
  const polishCodes = [...new Set([...clearCodes, ...bulkCodes, ...footCodes, ...gripCodes])];

  return {
    poseSafePolish: {
      enabled: polishCodes.length > 0,
      issueCodes: polishCodes,
      reason: polishCodes.length > 0
        ? 'Runs safe bulk, overlap, clearance, grip, and readability repairs.'
        : 'No motion repair issue matches this active slot.',
    },
    clearLimbOverlap: {
      enabled: clearCodes.length > 0,
      issueCodes: clearCodes,
      reason: clearCodes.length > 0
        ? 'Motion QA found tight limb spacing or part overlap for this slot.'
        : 'No limb overlap repair is needed for this slot.',
    },
    reducePoseBulk: {
      enabled: bulkCodes.length > 0,
      issueCodes: bulkCodes,
      reason: bulkCodes.length > 0
        ? 'Motion QA found high part overlap for this slot.'
        : 'No pose bulk reduction is needed for this slot.',
    },
    raiseFootClearance: {
      enabled: footCodes.length > 0,
      issueCodes: footCodes,
      reason: footCodes.length > 0
        ? 'Motion QA found foot-floor or foot-lift clearance issues for this leg slot.'
        : 'Foot clearance repair only applies to foot, ankle, or lower-leg slots.',
    },
    fixWeaponGripDrift: {
      enabled: gripCodes.length > 0,
      issueCodes: gripCodes,
      reason: gripCodes.length > 0
        ? 'Motion QA found weapon grip drift for this grip-adjacent slot.'
        : 'Weapon grip repair only applies to hands, forearms, or back mounts.',
    },
  };
}

function isActionEnabled(
  draft: CustomArmorPieceSnapshot,
  actionId: V3ArmorMotionRepairActionId,
  context: V3ArmorMotionRepairContext
): boolean {
  return getActionState(draft, context)[actionId]?.enabled ?? false;
}

export function buildV3ArmorMotionRepairActions(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): V3ArmorMotionRepairAction[] {
  if (!isV3Draft(draft, context)) {
    return disabledActions('Motion repairs only apply to the active V3 armor draft.');
  }
  if (!context.motionQa || !context.motionQa.summary.supported) {
    return disabledActions('Run V3 Motion QA before applying motion repairs.');
  }
  const state = getActionState(draft, context);
  return ACTION_ORDER.map((id) => createAction(
    id,
    state[id].enabled,
    state[id].issueCodes,
    state[id].reason
  ));
}

function getUpdatedAt(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): number {
  return context.now ?? draft.updatedAt;
}

function sameVoxels(a: readonly CustomArmorVoxel[], b: readonly CustomArmorVoxel[]): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) {
    const left = a[index];
    const right = b[index];
    if (!left || !right) return false;
    if (
      left.x !== right.x ||
      left.y !== right.y ||
      left.z !== right.z ||
      left.role !== right.role ||
      left.color !== right.color ||
      left.emissive !== right.emissive
    ) {
      return false;
    }
  }
  return true;
}

function normalizedVoxels(
  draft: CustomArmorPieceSnapshot,
  voxels: readonly CustomArmorVoxel[]
): CustomArmorVoxel[] {
  const gridScale = getCustomArmorGridScale(draft);
  const coordinateSpace = getCustomArmorV3CoordinateSpace(draft) ?? 'legacy-grid';
  return dedupeCustomArmorVoxels(voxels
    .map(cloneVoxel)
    .filter((voxel) => isVoxelInSlotBounds(draft.slot, voxel, 'medium', 'v3', gridScale, coordinateSpace)));
}

function commitVoxels(
  draft: CustomArmorPieceSnapshot,
  voxels: readonly CustomArmorVoxel[],
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  const current = normalizedVoxels(draft, draft.voxels);
  const next = normalizedVoxels(draft, voxels);
  if (sameVoxels(current, next)) return cloneDraft(draft);

  const candidate: CustomArmorPieceSnapshot = {
    ...draft,
    voxels: next,
    updatedAt: getUpdatedAt(draft, context),
  };

  if (validateCustomArmorPiece(draft).valid && !validateCustomArmorPiece(candidate).valid) {
    return cloneDraft(draft);
  }

  return candidate;
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

function cornerScore(
  voxel: CustomArmorVoxel,
  bounds: NonNullable<ReturnType<typeof getCustomArmorBounds>>
): number {
  return (
    (voxel.x === bounds.minX || voxel.x === bounds.maxX ? 1 : 0) +
    (voxel.y === bounds.minY || voxel.y === bounds.maxY ? 1 : 0) +
    (voxel.z === bounds.minZ || voxel.z === bounds.maxZ ? 1 : 0)
  );
}

function removeSelectedVoxels(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext,
  candidates: CustomArmorVoxel[],
  ratio: number,
  preserveRatio: number
): CustomArmorPieceSnapshot {
  const voxels = normalizedVoxels(draft, draft.voxels);
  if (voxels.length === 0 || candidates.length === 0) return cloneDraft(draft);

  const safeFloor = Math.ceil(voxels.length * preserveRatio);
  const target = Math.max(1, Math.ceil(voxels.length * ratio));
  const removeCount = Math.min(candidates.length, Math.max(0, voxels.length - safeFloor), target);
  if (removeCount <= 0) return cloneDraft(draft);

  const removeKeys = new Set(candidates.slice(0, removeCount).map(coordKey));
  return commitVoxels(
    draft,
    voxels.filter((voxel) => !removeKeys.has(coordKey(voxel))),
    context
  );
}

function reducePoseBulk(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  const voxels = normalizedVoxels(draft, draft.voxels);
  const bounds = getCustomArmorBounds(voxels);
  if (!bounds || voxels.length < 16) return cloneDraft(draft);
  const occupied = new Set(voxels.map(coordKey));
  const candidates = [...voxels]
    .filter((voxel) => cornerScore(voxel, bounds) > 0 || exposureScore(voxel, occupied) >= 2)
    .sort((a, b) => (
      cornerScore(b, bounds) - cornerScore(a, bounds) ||
      exposureScore(b, occupied) - exposureScore(a, occupied) ||
      b.y - a.y ||
      b.z - a.z ||
      a.x - b.x
    ));
  return removeSelectedVoxels(draft, context, candidates, 0.08, 0.88);
}

function getSelectionBounds(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): NonNullable<ReturnType<typeof getCustomArmorBounds>> | undefined {
  const bounds = getCustomArmorBounds(draft.voxels);
  if (!bounds) return undefined;
  if (!context.cursor || !context.size) return bounds;

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));
  const range = (
    center: number,
    size: number,
    min: number,
    max: number
  ): [number, number] => {
    const safeSize = Math.max(1, Math.round(Math.abs(Number.isFinite(size) ? size : 1)));
    const start = Math.round(center) - Math.floor((safeSize - 1) / 2);
    return [
      clamp(start, min, max),
      clamp(start + safeSize - 1, min, max),
    ];
  };
  const [minX, maxX] = range(context.cursor.x, context.size.x, bounds.minX, bounds.maxX);
  const [minY, maxY] = range(context.cursor.y, context.size.y, bounds.minY, bounds.maxY);
  const [minZ, maxZ] = range(context.cursor.z, context.size.z, bounds.minZ, bounds.maxZ);
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function isInsideSelection(
  voxel: CustomArmorVoxel,
  selection: NonNullable<ReturnType<typeof getCustomArmorBounds>>
): boolean {
  return voxel.x >= selection.minX && voxel.x <= selection.maxX
    && voxel.y >= selection.minY && voxel.y <= selection.maxY
    && voxel.z >= selection.minZ && voxel.z <= selection.maxZ;
}

function clearLimbOverlap(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  const voxels = normalizedVoxels(draft, draft.voxels);
  const selection = getSelectionBounds(draft, context);
  if (!selection) return cloneDraft(draft);
  const occupied = new Set(voxels.map(coordKey));
  const candidates = voxels
    .filter((voxel) => isInsideSelection(voxel, selection))
    .filter((voxel) => exposureScore(voxel, occupied) > 0)
    .sort((a, b) => (
      exposureScore(b, occupied) - exposureScore(a, occupied) ||
      b.y - a.y ||
      b.z - a.z ||
      a.x - b.x
    ));
  return removeSelectedVoxels(draft, context, candidates, 0.04, 0.92);
}

function raiseFootClearance(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  if (!FOOT_REPAIR_SLOTS.has(context.activeSlot)) return cloneDraft(draft);
  const voxels = normalizedVoxels(draft, draft.voxels);
  if (voxels.length === 0) return cloneDraft(draft);
  const gridScale = getCustomArmorGridScale(draft);
  const coordinateSpace = getCustomArmorV3CoordinateSpace(draft) ?? 'legacy-grid';
  const shifted = voxels.map((voxel) => ({ ...voxel, y: voxel.y + 1 }));
  if (!shifted.every((voxel) => isVoxelInSlotBounds(draft.slot, voxel, 'medium', 'v3', gridScale, coordinateSpace))) {
    return cloneDraft(draft);
  }
  return commitVoxels(draft, shifted, context);
}

function remapVoxelRole(
  voxel: CustomArmorVoxel,
  role: CustomArmorMaterialRole
): CustomArmorVoxel {
  if (voxel.role === role) return cloneVoxel(voxel);
  const next: CustomArmorVoxel = { ...voxel, role };
  if (role !== 'fixed') {
    delete next.color;
  }
  return next;
}

function remapSurfaceRoles(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext,
  ratio: number
): CustomArmorPieceSnapshot {
  const voxels = normalizedVoxels(draft, draft.voxels);
  if (voxels.length === 0) return cloneDraft(draft);
  const occupied = new Set(voxels.map(coordKey));
  const candidates = voxels
    .filter((voxel) => !PRESERVED_REMAP_ROLES.has(voxel.role))
    .filter((voxel) => exposureScore(voxel, occupied) > 0)
    .sort((a, b) => (
      exposureScore(b, occupied) - exposureScore(a, occupied) ||
      b.y - a.y ||
      b.z - a.z ||
      a.x - b.x
    ));
  const remapCount = Math.min(candidates.length, Math.max(1, Math.ceil(voxels.length * ratio)));
  if (remapCount <= 0) return cloneDraft(draft);

  const selectedKeys = new Set(candidates.slice(0, remapCount).map(coordKey));
  let remapped = 0;
  return commitVoxels(
    draft,
    voxels.map((voxel) => {
      if (!selectedKeys.has(coordKey(voxel))) return voxel;
      const role = READABILITY_ROLES[remapped % READABILITY_ROLES.length] ?? 'accent';
      remapped++;
      return remapVoxelRole(voxel, role);
    }),
    context
  );
}

function fixWeaponGripDrift(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  if (!GRIP_REPAIR_SLOTS.has(context.activeSlot)) return cloneDraft(draft);
  return remapSurfaceRoles(draft, context, 0.12);
}

function applyPoseSafePolish(
  draft: CustomArmorPieceSnapshot,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  let next = draft;
  if (isActionEnabled(next, 'reducePoseBulk', context)) {
    next = reducePoseBulk(next, context);
  }
  if (isActionEnabled(next, 'clearLimbOverlap', context)) {
    next = clearLimbOverlap(next, context);
  }
  if (isActionEnabled(next, 'raiseFootClearance', context)) {
    next = raiseFootClearance(next, context);
  }
  if (isActionEnabled(next, 'fixWeaponGripDrift', context)) {
    next = fixWeaponGripDrift(next, context);
  }
  return remapSurfaceRoles(next, context, 0.06);
}

export function applyV3ArmorMotionRepairAction(
  draft: CustomArmorPieceSnapshot,
  actionId: V3ArmorMotionRepairActionId,
  context: V3ArmorMotionRepairContext
): CustomArmorPieceSnapshot {
  if (!isV3Draft(draft, context)) return cloneDraft(draft);
  if (!isActionEnabled(draft, actionId, context)) return cloneDraft(draft);

  switch (actionId) {
    case 'reducePoseBulk':
      return reducePoseBulk(draft, context);
    case 'clearLimbOverlap':
      return clearLimbOverlap(draft, context);
    case 'raiseFootClearance':
      return raiseFootClearance(draft, context);
    case 'fixWeaponGripDrift':
      return fixWeaponGripDrift(draft, context);
    case 'poseSafePolish':
      return applyPoseSafePolish(draft, context);
    default:
      return cloneDraft(draft);
  }
}

function buildVoxelMap(voxels: readonly CustomArmorVoxel[]): Map<string, CustomArmorVoxel> {
  const map = new Map<string, CustomArmorVoxel>();
  for (const voxel of voxels) {
    map.set(coordKey(voxel), cloneVoxel(voxel));
  }
  return map;
}

function sameVoxelMaterial(a: CustomArmorVoxel, b: CustomArmorVoxel): boolean {
  return a.role === b.role && a.color === b.color && a.emissive === b.emissive;
}

function toVoxelDiff(voxel: CustomArmorVoxel): V3SmartAuthoringVoxelDiff {
  const diff: V3SmartAuthoringVoxelDiff = {
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    role: voxel.role,
  };
  if (voxel.color !== undefined) diff.color = voxel.color;
  if (voxel.emissive !== undefined) diff.emissive = voxel.emissive;
  return diff;
}

function buildVoxelDiff(
  before: readonly CustomArmorVoxel[],
  after: readonly CustomArmorVoxel[]
): Pick<V3ArmorMotionRepairPreview, 'changed' | 'added' | 'removed' | 'remapped'> {
  const beforeMap = buildVoxelMap(before);
  const afterMap = buildVoxelMap(after);
  const added: V3SmartAuthoringVoxelDiff[] = [];
  const removed: V3SmartAuthoringVoxelDiff[] = [];
  const remapped: V3SmartAuthoringVoxelRemapDiff[] = [];

  for (const [key, afterVoxel] of afterMap) {
    const beforeVoxel = beforeMap.get(key);
    if (!beforeVoxel) {
      added.push(toVoxelDiff(afterVoxel));
    } else if (!sameVoxelMaterial(beforeVoxel, afterVoxel)) {
      remapped.push({
        before: toVoxelDiff(beforeVoxel),
        after: toVoxelDiff(afterVoxel),
      });
    }
  }
  for (const [key, beforeVoxel] of beforeMap) {
    if (!afterMap.has(key)) {
      removed.push(toVoxelDiff(beforeVoxel));
    }
  }

  added.sort(stableVoxelSort);
  removed.sort(stableVoxelSort);
  remapped.sort((a, b) => stableVoxelSort(a.after, b.after));

  return {
    changed: added.length > 0 || removed.length > 0 || remapped.length > 0,
    added,
    removed,
    remapped,
  };
}

export function buildV3ArmorMotionRepairPreview(
  draft: CustomArmorPieceSnapshot,
  actionId: V3ArmorMotionRepairActionId,
  context: V3ArmorMotionRepairContext
): V3ArmorMotionRepairPreview {
  const applied = applyV3ArmorMotionRepairAction(draft, actionId, context);
  const previewDraft = {
    ...applied,
    voxels: applied.voxels.map(cloneVoxel),
    updatedAt: draft.updatedAt,
  };
  const diff = buildVoxelDiff(draft.voxels, previewDraft.voxels);

  return {
    actionId,
    previewDraft,
    ...diff,
  };
}
