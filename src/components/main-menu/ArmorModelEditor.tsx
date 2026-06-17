import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  buildVoxelSpartanModel,
  type CharacterLoadout,
  type VoxelData,
} from '../VoxelModels';
import { getVoxelSegmentDataV2 } from '../VoxelModelsV2';
import { buildCombatantRigForModel } from '../grifball/combatantRig';
import { createCombatantMeshRig } from '../grifball/combatantModels';
import {
  V3_POSE_CLEARANCE_CASES,
  applyV3PoseClearanceCase,
  type V3PoseClearanceCaseId,
  type V3PoseClearanceOverlay,
} from '../grifball/v3PoseClearance';
import {
  centerCustomArmorPiece,
  createCustomArmorPiece,
  createCustomArmorSnapshot,
  createCustomArmorThumbnail,
  customArmorPieceToVoxels,
  dedupeCustomArmorVoxels,
  duplicateCustomArmorPiece,
  fitCustomArmorToBounds,
  getCustomArmorGridScale,
  getCustomArmorPieceModelSystem,
  getCustomArmorSlotSpec,
  getCustomArmorSlotLabel,
  removeFloatingVoxels,
  restoreCustomArmorHistoryEntry,
  seedCornerAnchor,
  upsertCustomArmorPieceInCatalog,
  validateCustomArmorPiece,
  voxelDataToCustomArmorVoxels,
  V3_CUSTOM_ARMOR_SLOTS,
  type CustomArmorCatalog,
  type CustomArmorMaterialRole,
  type CustomArmorModelSystem,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type CustomArmorSlot,
  type CustomArmorColors,
  type V2CustomArmorSlot,
  type V3CustomArmorSlot,
  type CustomArmorVoxel,
} from '../customArmor';
import { getV3BuiltinPartVoxels } from '../v3/VoxelModelsV3';
import {
  V3_ARMOR_SURFACE_BASE_VOXEL_SCALE,
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from '../v3/v3VoxelArmorSurface';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  getCharacterModelCollisionProfile,
  resolveCharacterModelType,
} from '../../characterModelTypes';
import { getV3CharacterPartManifest } from '../v3/v3AssetManifest';
import type { CharacterModelType } from '../../types';
import { buildArmorEditorValidationReport } from './armorEditorValidation';
import { buildV3ArmorEditorVisualQa } from './v3ArmorEditorVisualQa';
import {
  applyV3ArmorEditorPolishAction,
  buildV3ArmorEditorPolishActions,
  type V3ArmorEditorPolishActionId,
} from './v3ArmorEditorPolish';
import {
  applyV3SmartAuthoringTool,
  buildV3SmartAuthoringPreview,
  type V3ArmorSmartToolId,
  type V3SmartAuthoringOptions,
  type V3SmartAuthoringPreview,
  type V3SmartAuthoringStrength,
} from './v3ArmorEditorSmartAuthoring';
import {
  applyV3ArmorMotionRepairAction,
  buildV3ArmorMotionRepairActions,
  buildV3ArmorMotionRepairPreview,
  type V3ArmorMotionRepairActionId,
  type V3ArmorMotionRepairContext,
} from './v3ArmorEditorMotionRepair';
import { buildV3SmartAuthoringFeedback } from './v3ArmorEditorSmartFeedback';
import {
  createV3ArmorTemplateDraft,
  getV3ArmorTemplateLabel,
} from './v3ArmorEditorTemplates';
import {
  buildV3SuitSavePlan,
  createV3SuitDraftMap,
  mergeV3SuitPreviewLoadout,
  validateV3SuitDrafts,
  type V3SuitDraftMap,
  type V3SuitSavePlan,
} from './v3ArmorEditorSuitWorkflow';
import {
  applyV3SuitProfileToLoadout,
  createEmptyV3SuitProfileCatalog,
  createV3SuitProfileFromLoadout,
  deleteV3SuitProfile,
  exportV3SuitProfileBundle,
  importV3SuitProfileBundle,
  upsertV3SuitProfile,
  validateV3SuitProfile,
  type V3SuitProfile,
  type V3SuitProfileCatalog,
} from './v3ArmorSuitProfiles';
import {
  buildV3ArmorEditorMotionQaReport,
  type V3ArmorEditorMotionQaMode,
  type V3ArmorEditorMotionQaReport,
} from './v3ArmorEditorMotionQa';

interface ArmorModelEditorProps {
  catalog: CustomArmorCatalog;
  v3SuitProfileCatalog?: V3SuitProfileCatalog;
  playerLoadout: CharacterLoadout;
  playerHue: number;
  onCatalogChange: React.Dispatch<React.SetStateAction<CustomArmorCatalog>>;
  onV3SuitProfileCatalogChange?: React.Dispatch<React.SetStateAction<V3SuitProfileCatalog>>;
  onLoadoutChange: (patch: Partial<CharacterLoadout>) => void;
  onClose: () => void;
  onPaintPiece?: () => void;
  layout?: 'embedded' | 'standalone';
}

type EditorTool = 'place' | 'erase' | 'box' | 'line' | 'plane' | 'extrude' | 'move' | 'duplicate' | 'fill';
type Axis = 'x' | 'y' | 'z';
type ViewMode = 'edit' | 'preview' | 'rig';
type V2PoseMode = 'idle' | 'walk' | 'sprint' | 'crouch' | 'hammer' | 'sword';
type PoseMode = V2PoseMode | V3PoseClearanceCaseId;
type V3SmartMirrorScope = 'piece' | 'cursorVolume';
type V3PendingSuitSave = {
  drafts: V3SuitDraftMap;
  saveTime: number;
  activeSlot: V3CustomArmorSlot;
  token: number;
  catalogCommitQueued?: boolean;
  committedPlan?: V3SuitSavePlan;
};
type PaintSettings = {
  tool: EditorTool;
  role: CustomArmorMaterialRole;
  fixedColor: string;
  emissive: boolean;
  slot: CustomArmorSlot;
  modelType: CharacterModelType;
  modelSystem: CustomArmorModelSystem;
  gridScale: 1 | 2;
};
type V3PreviewOverlayDiff = Pick<V3SmartAuthoringPreview, 'added' | 'removed' | 'remapped'>;
type ArmorEditorCameraView = {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
};

const SLOT_OPTIONS: Array<{ slot: V2CustomArmorSlot; label: string }> = [
  { slot: 'helmet', label: 'Helmet' },
  { slot: 'torso', label: 'Chest' },
  { slot: 'arm', label: 'Arms' },
  { slot: 'leg', label: 'Legs' },
];

const formatV3SlotLabel = (slot: string): string =>
  slot
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (value) => value.toUpperCase());

const V3_SLOT_OPTIONS: Array<{ slot: V3CustomArmorSlot; label: string; title: string }> = V3_CUSTOM_ARMOR_SLOTS.map((slot) => ({
  slot,
  label: formatV3SlotLabel(slot),
  title: getCustomArmorSlotLabel(slot, 'v3'),
}));

const MATERIAL_OPTIONS: Array<{ role: CustomArmorMaterialRole; label: string }> = [
  { role: 'primary', label: 'Primary' },
  { role: 'secondary', label: 'Secondary' },
  { role: 'accent', label: 'Accent' },
  { role: 'visor', label: 'Visor' },
  { role: 'dark', label: 'Dark' },
  { role: 'highlight', label: 'Highlight' },
  { role: 'fixed', label: 'Fixed' },
];

const TOOL_OPTIONS: Array<{ id: EditorTool; label: string }> = [
  { id: 'place', label: 'Voxel' },
  { id: 'erase', label: 'Erase' },
  { id: 'box', label: 'Box' },
  { id: 'line', label: 'Line' },
  { id: 'plane', label: 'Plane' },
  { id: 'extrude', label: 'Extrude' },
  { id: 'move', label: 'Move' },
  { id: 'duplicate', label: 'Duplicate' },
  { id: 'fill', label: 'Fill' },
];

const V3_SMART_TOOL_OPTIONS: Array<{ id: V3ArmorSmartToolId; label: string }> = [
  { id: 'panelStripe', label: 'Panel Stripe' },
  { id: 'edgeAccent', label: 'Edge Accent' },
  { id: 'carveSeam', label: 'Carve Seam' },
  { id: 'trimCorners', label: 'Trim Corners' },
  { id: 'taperMass', label: 'Taper Mass' },
  { id: 'mirrorLocalX', label: 'Mirror X' },
];

const V3_SMART_STRENGTH_OPTIONS: Array<{ id: V3SmartAuthoringStrength; label: string }> = [
  { id: 'light', label: 'Light' },
  { id: 'normal', label: 'Normal' },
  { id: 'heavy', label: 'Heavy' },
];

const V3_SMART_MIRROR_SCOPE_OPTIONS: Array<{ id: V3SmartMirrorScope; label: string }> = [
  { id: 'piece', label: 'Whole Piece' },
  { id: 'cursorVolume', label: 'Cursor Volume' },
];

const V2_POSE_OPTIONS: Array<{ id: V2PoseMode; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'walk', label: 'Walk' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'hammer', label: 'Hammer' },
  { id: 'sword', label: 'Sword' },
];

const V3_POSE_LABELS: Record<V3PoseClearanceCaseId, string> = {
  idle: 'Idle',
  walk: 'Walk',
  sprint: 'Sprint',
  slide: 'Slide',
  hammerWindup: 'Hammer Windup',
  hammerStrike: 'Hammer Strike',
  hammerRecover: 'Hammer Recover',
  swordLunge: 'Sword Lunge',
  swordSlash: 'Sword Slash',
  pistolFire: 'Pistol Fire',
  hitReact: 'Hit React',
  death: 'Death',
};

const V3_POSE_OPTIONS: Array<{ id: V3PoseClearanceCaseId; label: string }> =
  V3_POSE_CLEARANCE_CASES.map((poseCase) => ({
    id: poseCase.id,
    label: V3_POSE_LABELS[poseCase.id],
  }));

const V3_POSE_CASE_IDS = new Set<string>(V3_POSE_CLEARANCE_CASES.map((poseCase) => poseCase.id));
const V2_POSE_CASE_IDS = new Set<string>(V2_POSE_OPTIONS.map((pose) => pose.id));

const normalizeV3PoseMode = (poseMode: PoseMode): V3PoseClearanceCaseId => (
  V3_POSE_CASE_IDS.has(poseMode) ? poseMode as V3PoseClearanceCaseId : 'idle'
);

const normalizeV2PoseMode = (poseMode: PoseMode): V2PoseMode => (
  V2_POSE_CASE_IDS.has(poseMode) ? poseMode as V2PoseMode : 'idle'
);

const BUILTIN_PRESETS: Record<V2CustomArmorSlot, string[]> = {
  helmet: ['mark-vi', 'odst', 'recon', 'eva', 'gungnir', 'eod', 'hayabusa', 'cqb'],
  torso: ['mark-vi', 'scout', 'recon', 'eod', 'hayabusa'],
  arm: ['mark-vi', 'odst', 'recon', 'eod', 'hayabusa'],
  leg: ['mark-vi', 'jump-jet', 'odst', 'eod', 'hayabusa'],
};

const createDefaultCameraViews = (): Record<ViewMode, ArmorEditorCameraView> => ({
  edit: {
    target: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0.07,
    distance: 2.25,
  },
  preview: {
    target: { x: 0, y: 0, z: 0 },
    yaw: -0.25,
    pitch: 0.08,
    distance: 2.45,
  },
  rig: {
    target: { x: 0, y: 0.9, z: 0 },
    yaw: 0,
    pitch: 0.08,
    distance: 4.2,
  },
});

const roleColorPreview: Record<CustomArmorMaterialRole, string> = {
  primary: '#38bdf8',
  secondary: '#1e293b',
  accent: '#a855f7',
  visor: '#67e8f9',
  dark: '#020617',
  highlight: '#93c5fd',
  undersuit: '#020617',
  emissive: '#67e8f9',
  decal: '#a855f7',
  fixed: '#f472b6',
};

const createEditorPreviewPalette = (playerHue: number): CustomArmorColors => ({
  primary: `hsl(${playerHue}, 85%, 50%)`,
  secondary: '#1e293b',
  accent: `hsl(${playerHue}, 90%, 75%)`,
  visor: `hsl(${playerHue}, 95%, 70%)`,
  dark: '#0f172a',
  highlight: `hsl(${playerHue}, 75%, 65%)`,
});

const formatSignedReadDelta = (delta: number): string => (
  delta > 0 ? `+${delta} Read` : `${delta} Read`
);

type EditorBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

const getV3PresetForSlot = (slot: V3CustomArmorSlot): string => `ibv3-aegis-${slot}`;

function getEditorSlotBounds(
  slot: CustomArmorSlot,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem,
  gridScale: 1 | 2 = 1
): EditorBounds {
  if (modelSystem === 'v3') {
    const dimensions = getV3CharacterPartBounds(slot as V3CustomArmorSlot).maxDimensions;
    return {
      minX: 0,
      maxX: dimensions.x * gridScale - 1,
      minY: 0,
      maxY: dimensions.y * gridScale - 1,
      minZ: 0,
      maxZ: dimensions.z * gridScale - 1,
    };
  }
  return getCustomArmorSlotSpec(slot, modelType).bounds;
}

const getDefaultPresetForSlot = (slot: CustomArmorSlot, loadout: CharacterLoadout): string => {
  if (slot === 'helmet') return loadout.helmet ?? 'mark-vi';
  if (slot === 'torso') return loadout.torso ?? 'mark-vi';
  if (slot === 'arm') return loadout.arm ?? 'mark-vi';
  return loadout.leg ?? 'mark-vi';
};

const getV2SourceSlot = (slot: CustomArmorSlot): string => {
  if (slot === 'arm') return 'leftArm';
  if (slot === 'leg') return 'leftLeg';
  return slot;
};

const createVoxel = (
  x: number,
  y: number,
  z: number,
  role: CustomArmorMaterialRole,
  color: string,
  emissive: boolean
): CustomArmorVoxel => ({
  x,
  y,
  z,
  role,
  color: role === 'fixed' ? color : undefined,
  emissive,
});

const cloneSnapshot = (snapshot: CustomArmorPieceSnapshot): CustomArmorPieceSnapshot => ({
  ...snapshot,
  voxels: snapshot.voxels.map((voxel) => ({ ...voxel })),
});

const cloneV3SuitDraftForSlot = (
  slot: V3CustomArmorSlot,
  snapshot: CustomArmorPieceSnapshot
): CustomArmorPieceSnapshot => cloneSnapshot({
  ...snapshot,
  slot,
  modelSystem: 'v3',
  modelType: undefined,
  gridScale: getCustomArmorGridScale(snapshot),
});

const snapshotFromBuiltin = (
  slot: CustomArmorSlot,
  preset: string,
  hue: number,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem = 'v2',
  name = `${preset} Remix`
): CustomArmorPieceSnapshot => {
  const voxels = modelSystem === 'v3'
    ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, hue, undefined, { gridScale: 1 })
    : getVoxelSegmentDataV2(getV2SourceSlot(slot), preset, hue, false, modelType);
  const piece = createCustomArmorPiece(
    slot,
    name,
    voxelDataToCustomArmorVoxels(voxels),
    preset,
    modelSystem === 'v2' ? modelType : undefined,
    modelSystem,
    modelSystem === 'v3' ? 1 : undefined
  );
  return createCustomArmorSnapshot(piece);
};

const createBlankSnapshot = (
  slot: CustomArmorSlot,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem
): CustomArmorPieceSnapshot =>
  createCustomArmorSnapshot(createCustomArmorPiece(
    slot,
    `${getCustomArmorSlotLabel(slot, modelSystem, modelType)} Draft`,
    [],
    undefined,
    modelSystem === 'v2' ? modelType : undefined,
    modelSystem
  ));

const getSlotPatchField = (slot: CustomArmorSlot): 'helmet' | 'torso' | 'arm' | 'leg' => (
  slot === 'torso' || slot === 'arm' || slot === 'leg' ? slot : 'helmet'
);

function resolveOverlayVoxelColor(voxel: V3SmartAuthoringPreview['added'][number], palette: CustomArmorColors): string {
  if (voxel.role === 'fixed' && voxel.color) return voxel.color;
  if (voxel.role in palette) return palette[voxel.role as keyof CustomArmorColors];
  return roleColorPreview[voxel.role] ?? '#38bdf8';
}

function addVoxelOverlayCube(
  group: THREE.Group,
  voxel: Pick<CustomArmorVoxel, 'x' | 'y' | 'z'>,
  scale: number,
  origin: { x: number; y: number; z: number },
  material: THREE.Material,
  sizeMultiplier = 1
): void {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(scale * sizeMultiplier, scale * sizeMultiplier, scale * sizeMultiplier),
    material
  );
  mesh.position.set(
    (voxel.x - origin.x) * scale,
    (voxel.y - origin.y) * scale,
    (voxel.z - origin.z) * scale
  );
  group.add(mesh);
}

function createV3SmartPreviewOverlayGroup(
  preview: V3PreviewOverlayDiff,
  palette: CustomArmorColors,
  scale: number,
  origin: { x: number; y: number; z: number }
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'v3-smart-preview-overlay';
  const addedMaterial = new THREE.MeshBasicMaterial({
    color: '#22d3ee',
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  const removedMaterial = new THREE.MeshBasicMaterial({
    color: '#ef4444',
    transparent: true,
    opacity: 0.86,
    wireframe: true,
    depthWrite: false,
  });
  const remappedBeforeMaterial = new THREE.MeshBasicMaterial({
    color: '#f59e0b',
    transparent: true,
    opacity: 0.9,
    wireframe: true,
    depthWrite: false,
  });
  const remappedAfterOutlineMaterial = new THREE.MeshBasicMaterial({
    color: '#a855f7',
    transparent: true,
    opacity: 0.9,
    wireframe: true,
    depthWrite: false,
  });

  preview.added.forEach((voxel) => addVoxelOverlayCube(group, voxel, scale, origin, addedMaterial, 1.08));
  preview.removed.forEach((voxel) => addVoxelOverlayCube(group, voxel, scale, origin, removedMaterial, 1.12));
  preview.remapped.forEach(({ before, after }) => {
    addVoxelOverlayCube(group, before, scale, origin, remappedBeforeMaterial, 1.14);
    const targetMaterial = new THREE.MeshBasicMaterial({
      color: resolveOverlayVoxelColor(after, palette),
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    addVoxelOverlayCube(group, after, scale, origin, targetMaterial, 1.06);
    addVoxelOverlayCube(group, after, scale, origin, remappedAfterOutlineMaterial, 1.18);
  });

  return group;
}

export function ArmorModelEditor({
  catalog,
  v3SuitProfileCatalog = createEmptyV3SuitProfileCatalog(),
  playerLoadout,
  playerHue,
  onCatalogChange,
  onV3SuitProfileCatalogChange,
  onLoadoutChange,
  onClose,
  onPaintPiece,
  layout = 'embedded',
}: ArmorModelEditorProps) {
  const isStandalone = layout === 'standalone';
  const initialModelSystem: CustomArmorModelSystem = playerLoadout.modelSystem === 'v3' ? 'v3' : 'v2';
  const initialModelType = resolveCharacterModelType(playerLoadout.modelType, 'v2');
  const initialSlots = initialModelSystem === 'v3' ? V3_CUSTOM_ARMOR_SLOTS : SLOT_OPTIONS.map((option) => option.slot);
  const pieceMatchesMode = (
    piece: CustomArmorPieceSnapshot | undefined,
    targetModelSystem: CustomArmorModelSystem,
    targetModelType: CharacterModelType
  ): piece is CustomArmorPieceSnapshot => Boolean(piece)
    && getCustomArmorPieceModelSystem(piece!) === targetModelSystem
    && (targetModelSystem === 'v3' || resolveCharacterModelType(piece!.modelType, 'v2') === targetModelType);
  const initialSlot = initialSlots
    .find((slot) => (
      pieceMatchesMode(playerLoadout.customArmor?.[slot], initialModelSystem, initialModelType)
    )) ?? 'helmet';
  const [modelSystem, setModelSystem] = useState<CustomArmorModelSystem>(initialModelSystem);
  const [modelType, setModelType] = useState<CharacterModelType>(initialModelType);
  const [slot, setSlot] = useState<CustomArmorSlot>(initialSlot);
  const [draft, setDraft] = useState<CustomArmorPieceSnapshot>(() => (
    pieceMatchesMode(playerLoadout.customArmor?.[initialSlot], initialModelSystem, initialModelType)
      ? cloneSnapshot(playerLoadout.customArmor[initialSlot]!)
      : snapshotFromBuiltin(
        initialSlot,
        initialModelSystem === 'v3'
          ? getV3PresetForSlot(initialSlot as V3CustomArmorSlot)
          : getDefaultPresetForSlot(initialSlot, playerLoadout),
        playerHue,
        initialModelType,
        initialModelSystem
      )
  ));
  const [tool, setTool] = useState<EditorTool>('place');
  const [role, setRole] = useState<CustomArmorMaterialRole>('primary');
  const [fixedColor, setFixedColor] = useState('#38bdf8');
  const [fixedColorText, setFixedColorText] = useState('#38bdf8');
  const [emissive, setEmissive] = useState(false);
  const [axis, setAxis] = useState<Axis>('y');
  const [viewMode, setViewMode] = useState<ViewMode>('edit');
  const [poseMode, setPoseMode] = useState<PoseMode>('idle');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(() => {
    const initialPiece = playerLoadout.customArmor?.[initialSlot];
    const initialGridScale = initialModelSystem === 'v3' && pieceMatchesMode(initialPiece, initialModelSystem, initialModelType)
      ? getCustomArmorGridScale(initialPiece)
      : 1;
    const b = getEditorSlotBounds(slot, initialModelType, initialModelSystem, initialGridScale);
    return { x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) };
  });
  const [size, setSize] = useState({ x: 2, y: 2, z: 2 });
  const [offset, setOffset] = useState({ x: 1, y: 0, z: 0 });
  const [selectedSmartToolId, setSelectedSmartToolId] = useState<V3ArmorSmartToolId>('panelStripe');
  const [transientSmartToolId, setTransientSmartToolId] = useState<V3ArmorSmartToolId | null>(null);
  const [smartStrength, setSmartStrength] = useState<V3SmartAuthoringStrength>('normal');
  const [smartStripeWidth, setSmartStripeWidth] = useState(1);
  const [smartMirrorScope, setSmartMirrorScope] = useState<V3SmartMirrorScope>('piece');
  const [smartMirrorOverwrite, setSmartMirrorOverwrite] = useState(false);
  const [undoStack, setUndoStack] = useState<CustomArmorPieceSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CustomArmorPieceSnapshot[]>([]);
  const [v3SuitDrafts, setV3SuitDrafts] = useState<V3SuitDraftMap | null>(null);
  const [v3SuitPreviewEnabled, setV3SuitPreviewEnabled] = useState(false);
  const [pendingV3SuitSave, setPendingV3SuitSave] = useState<V3PendingSuitSave | null>(null);
  const [selectedV3SuitProfileId, setSelectedV3SuitProfileId] = useState('');
  const [v3MotionQaReport, setV3MotionQaReport] = useState<V3ArmorEditorMotionQaReport | null>(null);
  const [v3MotionQaReportToken, setV3MotionQaReportToken] = useState('');
  const [v3MotionQaMode, setV3MotionQaMode] = useState<V3ArmorEditorMotionQaMode>('active-slot');
  const [selectedV3MotionRepairActionId, setSelectedV3MotionRepairActionId] =
    useState<V3ArmorMotionRepairActionId>('poseSafePolish');
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [showBounds, setShowBounds] = useState(true);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showCollision, setShowCollision] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [showPerformance, setShowPerformance] = useState(true);
  const [showClipping, setShowClipping] = useState(false);
  const [showMotionOverlay, setShowMotionOverlay] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const paintSettingsRef = useRef<PaintSettings>({ tool, role, fixedColor, emissive, slot, modelType, modelSystem, gridScale: 1 });
  const cameraViewsRef = useRef<Record<ViewMode, ArmorEditorCameraView>>(createDefaultCameraViews());
  const suitSaveTokenRef = useRef(0);

  const validation = useMemo(() => validateCustomArmorPiece(draft), [draft]);
  const editorPreviewPalette = useMemo(() => createEditorPreviewPalette(playerHue), [playerHue]);
  const slotPieces = catalog.pieces.filter((piece) => (
    piece.slot === slot &&
    pieceMatchesMode(piece, modelSystem, modelType)
  ));
  const selectedPreset = modelSystem === 'v2' && draft.sourcePreset && BUILTIN_PRESETS[slot as V2CustomArmorSlot].includes(draft.sourcePreset)
    ? draft.sourcePreset
    : modelSystem === 'v3'
      ? getV3PresetForSlot(slot as V3CustomArmorSlot)
      : getDefaultPresetForSlot(slot, playerLoadout);
  const activeSlotOptions = modelSystem === 'v3' ? V3_SLOT_OPTIONS : SLOT_OPTIONS;
  const draftGridScale = modelSystem === 'v3' ? getCustomArmorGridScale(draft) : 1;
  const activeViewModes: ViewMode[] = modelSystem === 'v3' ? ['edit', 'preview', 'rig'] : ['edit', 'rig'];
  const selectedV3PoseCaseId = normalizeV3PoseMode(poseMode);
  const activePoseOptions = modelSystem === 'v3' ? V3_POSE_OPTIONS : V2_POSE_OPTIONS;
  const activeV3SuitDrafts = useMemo<V3SuitDraftMap | null>(() => {
    if (modelSystem !== 'v3' || !v3SuitDrafts) return null;
    return {
      ...v3SuitDrafts,
      [slot as V3CustomArmorSlot]: cloneV3SuitDraftForSlot(slot as V3CustomArmorSlot, draft),
    };
  }, [draft, modelSystem, slot, v3SuitDrafts]);
  const v3SuitValidation = useMemo(() => (
    activeV3SuitDrafts ? validateV3SuitDrafts(activeV3SuitDrafts) : undefined
  ), [activeV3SuitDrafts]);
  const selectedV3SuitProfile = useMemo<V3SuitProfile | undefined>(() => (
    v3SuitProfileCatalog.profiles.find((profile) => profile.id === selectedV3SuitProfileId)
    ?? v3SuitProfileCatalog.profiles[0]
  ), [selectedV3SuitProfileId, v3SuitProfileCatalog]);
  const selectedV3SuitProfileValidation = useMemo(() => (
    selectedV3SuitProfile ? validateV3SuitProfile(selectedV3SuitProfile, catalog) : undefined
  ), [catalog, selectedV3SuitProfile]);
  const editorValidationReport = useMemo(() => {
    const builtIn = modelSystem === 'v3'
      ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, playerHue)
      : getVoxelSegmentDataV2(getV2SourceSlot(slot), selectedPreset, playerHue, false, modelType);
    const v3Manifest = modelSystem === 'v3'
      ? getV3CharacterPartManifest(getV3PresetForSlot(slot as V3CustomArmorSlot))
      : undefined;
    const slotBudget = modelSystem === 'v3'
      ? (v3Manifest?.budget.sourceVoxelCount ?? validation.stats.voxelCount) * draftGridScale * draftGridScale
      : getCustomArmorSlotSpec(slot, modelType).maxVoxels;
    const visualQa = modelSystem === 'v3'
      ? buildV3ArmorEditorVisualQa({
          draft,
          colors: editorPreviewPalette,
          slot: slot as V3CustomArmorSlot,
          gridScale: draftGridScale,
        })
      : undefined;

    return buildArmorEditorValidationReport({
      draft,
      validation,
      builtInVoxelCount: builtIn.length,
      slotBudget,
      recommendedRoles: modelSystem === 'v3'
        ? [...(v3Manifest?.paintRoles ?? [])]
        : ['primary', 'secondary', 'accent'],
      visualQa,
    });
  }, [draft, draftGridScale, editorPreviewPalette, modelSystem, modelType, playerHue, selectedPreset, slot, validation]);
  const v3ArmorEditorPolishActions = useMemo(() => (
    modelSystem === 'v3'
      ? buildV3ArmorEditorPolishActions(draft, {
          visualQa: editorValidationReport.visualQa,
          missingRecommendedRoles: editorValidationReport.missingRecommendedRoles,
        })
      : []
  ), [draft, editorValidationReport.missingRecommendedRoles, editorValidationReport.visualQa, modelSystem]);
  const v3SmartAuthoringContext = useMemo(() => ({
    cursor,
    size,
    axis,
    role,
    fixedColor,
    emissive,
  }), [axis, cursor, emissive, fixedColor, role, size]);
  const v3SmartAuthoringOptions = useMemo<V3SmartAuthoringOptions>(() => ({
    strength: smartStrength,
    panelStripe: {
      thickness: smartStripeWidth,
    },
    mirrorLocalX: {
      scope: smartMirrorScope,
      overwriteExisting: smartMirrorOverwrite,
    },
  }), [smartMirrorOverwrite, smartMirrorScope, smartStrength, smartStripeWidth]);
  const activeSmartToolId = transientSmartToolId ?? selectedSmartToolId;
  const activeSmartToolLabel = V3_SMART_TOOL_OPTIONS.find((option) => option.id === activeSmartToolId)?.label ?? 'Smart Tool';
  const selectedSmartToolLabel = V3_SMART_TOOL_OPTIONS.find((option) => option.id === selectedSmartToolId)?.label ?? 'Smart Tool';
  const v3SmartAuthoringPreview = useMemo(() => (
    modelSystem === 'v3'
      ? buildV3SmartAuthoringPreview(draft, activeSmartToolId, v3SmartAuthoringContext, v3SmartAuthoringOptions)
      : undefined
  ), [activeSmartToolId, draft, modelSystem, v3SmartAuthoringContext, v3SmartAuthoringOptions]);
  const v3SmartAuthoringFeedback = useMemo(() => (
    v3SmartAuthoringPreview
      ? buildV3SmartAuthoringFeedback(draft, v3SmartAuthoringPreview.previewDraft)
      : undefined
  ), [draft, v3SmartAuthoringPreview]);
  const buildV3MotionQaSourceToken = (
    mode: V3ArmorEditorMotionQaMode,
    stagedDraftOverride?: V3SuitDraftMap
  ): string => {
    const sourceDrafts = stagedDraftOverride ?? activeV3SuitDrafts;
    if (mode === 'full-suit') {
      const currentSlot = slot as V3CustomArmorSlot;
      const stagedDrafts = sourceDrafts
        ? ({
            ...sourceDrafts,
            [currentSlot]: cloneV3SuitDraftForSlot(currentSlot, draft),
          } as V3SuitDraftMap)
        : undefined;
      const draftRows = stagedDrafts
        ? (Object.entries(stagedDrafts) as Array<[V3CustomArmorSlot, CustomArmorPieceSnapshot]>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([draftSlot, stagedDraft]) => ({
            slot: draftSlot,
            id: stagedDraft.id,
            updatedAt: stagedDraft.updatedAt,
            voxelCount: stagedDraft.voxels.length,
          }))
        : [];
      return JSON.stringify({
        mode,
        pose: 'all',
        stagedDrafts: draftRows,
      });
    }

    const stagedDrafts = sourceDrafts
      ? (Object.entries(sourceDrafts) as Array<[V3CustomArmorSlot, CustomArmorPieceSnapshot]>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([draftSlot, stagedDraft]) => ({
          slot: draftSlot,
          id: stagedDraft.id,
          updatedAt: stagedDraft.updatedAt,
          voxelCount: stagedDraft.voxels.length,
        }))
      : [];
    return JSON.stringify({
      mode,
      activeSlot: slot,
      pose: mode === 'active-slot' ? selectedV3PoseCaseId : 'all',
      draft: {
        id: draft.id,
        slot: draft.slot,
        updatedAt: draft.updatedAt,
        voxelCount: draft.voxels.length,
      },
      stagedDrafts,
    });
  };
  const currentV3MotionQaToken = useMemo(
    () => buildV3MotionQaSourceToken(v3MotionQaMode),
    [activeV3SuitDrafts, draft, selectedV3PoseCaseId, slot, v3MotionQaMode]
  );
  const v3MotionQaIsStale = Boolean(v3MotionQaReport) && v3MotionQaReportToken !== currentV3MotionQaToken;
  const selectedV3MotionQaCase = v3MotionQaReport?.cases.find((testCase) => testCase.id === selectedV3PoseCaseId);
  const freshV3MotionQaReport = v3MotionQaReport && !v3MotionQaIsStale ? v3MotionQaReport : undefined;
  const v3MotionRepairContext = useMemo<V3ArmorMotionRepairContext>(() => ({
    motionQa: freshV3MotionQaReport,
    selectedCaseId: v3MotionQaMode === 'active-slot' ? selectedV3PoseCaseId : undefined,
    activeSlot: slot as V3CustomArmorSlot,
    gridScale: draftGridScale,
    cursor,
    size,
  }), [cursor, draftGridScale, freshV3MotionQaReport, selectedV3PoseCaseId, size, slot, v3MotionQaMode]);
  const v3MotionRepairActions = useMemo(() => (
    modelSystem === 'v3'
      ? buildV3ArmorMotionRepairActions(draft, v3MotionRepairContext)
      : []
  ), [draft, modelSystem, v3MotionRepairContext]);
  const selectedV3MotionRepairAction = v3MotionRepairActions.find((action) => action.id === selectedV3MotionRepairActionId)
    ?? v3MotionRepairActions[0];
  const selectedV3MotionRepairLabel = selectedV3MotionRepairAction?.label ?? 'Motion Fix';
  const v3MotionRepairPreview = useMemo(() => (
    modelSystem === 'v3' && freshV3MotionQaReport && selectedV3MotionRepairAction
      ? buildV3ArmorMotionRepairPreview(draft, selectedV3MotionRepairAction.id, v3MotionRepairContext)
      : undefined
  ), [draft, freshV3MotionQaReport, modelSystem, selectedV3MotionRepairAction, v3MotionRepairContext]);
  const activeV3PreviewOverlay = v3MotionRepairPreview?.changed ? v3MotionRepairPreview : v3SmartAuthoringPreview;

  useEffect(() => {
    paintSettingsRef.current = { tool, role, fixedColor, emissive, slot, modelType, modelSystem, gridScale: draftGridScale };
  }, [draftGridScale, emissive, fixedColor, modelSystem, modelType, role, slot, tool]);

  useEffect(() => {
    if (modelSystem !== 'v3' && viewMode === 'preview') {
      setViewMode('edit');
    }
  }, [modelSystem, viewMode]);

  useEffect(() => {
    if (modelSystem === 'v2') {
      setPoseMode((current) => normalizeV2PoseMode(current));
    }
  }, [modelSystem]);

  const getEquippedPieceForType = (
    targetSlot: CustomArmorSlot,
    targetModelType: CharacterModelType,
    targetModelSystem: CustomArmorModelSystem = modelSystem
  ): CustomArmorPieceSnapshot | undefined => {
    const piece = playerLoadout.customArmor?.[targetSlot];
    return pieceMatchesMode(piece, targetModelSystem, targetModelType) ? piece : undefined;
  };

  const setFixedColorValue = (value: string) => {
    const normalized = value.toLowerCase();
    setFixedColor(normalized);
    setFixedColorText(normalized);
  };

  const handleFixedColorTextChange = (value: string) => {
    const normalized = value.trim();
    setFixedColorText(value);
    if (/^#[0-9a-fA-F]{6}$/.test(normalized)) {
      setFixedColor(normalized.toLowerCase());
    }
  };

  const setDraftWithHistory = (updater: (current: CustomArmorPieceSnapshot) => CustomArmorPieceSnapshot) => {
    setDraft((current) => {
      const previous = cloneSnapshot(current);
      const next = {
        ...updater(previous),
        updatedAt: Date.now(),
      };
      setUndoStack((stack) => [...stack.slice(-24), previous]);
      setRedoStack([]);
      try {
        localStorage.setItem('grifball_custom_armor_draft', JSON.stringify(next));
      } catch {
        // Draft recovery is best-effort.
      }
      return next;
    });
  };

  const replaceDraft = (next: CustomArmorPieceSnapshot) => {
    const nextGridScale = modelSystem === 'v3' ? getCustomArmorGridScale(next) : 1;
    const nextBounds = getEditorSlotBounds(slot, modelType, modelSystem, nextGridScale);
    setCursor({
      x: Math.round((nextBounds.minX + nextBounds.maxX) / 2),
      y: nextBounds.minY,
      z: Math.round((nextBounds.minZ + nextBounds.maxZ) / 2),
    });
    setDraftWithHistory(() => ({
      ...next,
      slot,
      modelSystem,
      modelType: modelSystem === 'v2' ? modelType : undefined,
      gridScale: modelSystem === 'v3' ? nextGridScale : undefined,
      voxels: dedupeCustomArmorVoxels(next.voxels),
    }));
    setSelectedKeys(new Set());
  };

  const applyPolishAction = (actionId: V3ArmorEditorPolishActionId, actionLabel: string) => {
    const polished = applyV3ArmorEditorPolishAction(draft, actionId, {
      visualQa: editorValidationReport.visualQa,
      missingRecommendedRoles: editorValidationReport.missingRecommendedRoles,
    });
    replaceDraft(polished);
    setStatus(`${actionLabel} applied.`);
  };

  const applyV3SmartStart = () => {
    const v3Slot = slot as V3CustomArmorSlot;
    const label = getV3ArmorTemplateLabel(v3Slot);
    replaceDraft(createV3ArmorTemplateDraft(v3Slot, {
      hue: playerHue,
      now: Date.now(),
      name: `${label} Smart Start`,
    }));
    setStatus(`${label} smart start loaded.`);
  };

  const selectV3SmartTool = (toolId: V3ArmorSmartToolId, toolLabel: string) => {
    setSelectedSmartToolId(toolId);
    setStatus(`${toolLabel} preview selected.`);
  };

  const applySelectedV3SmartTool = () => {
    replaceDraft(applyV3SmartAuthoringTool(draft, selectedSmartToolId, {
      cursor,
      size,
      axis,
      role,
      fixedColor,
      emissive,
      now: Date.now(),
    }, v3SmartAuthoringOptions));
    setStatus(`${selectedSmartToolLabel} applied.`);
  };

  const applySelectedV3MotionRepair = () => {
    if (!selectedV3MotionRepairAction || !v3MotionRepairPreview?.changed) return;
    replaceDraft(applyV3ArmorMotionRepairAction(draft, selectedV3MotionRepairAction.id, {
      ...v3MotionRepairContext,
      now: Date.now(),
    }));
    setStatus(`${selectedV3MotionRepairAction.label} applied.`);
  };

  const setSmartStripeWidthValue = (value: number) => {
    setSmartStripeWidth(Math.max(1, Math.round(Number.isFinite(value) ? value : 1)));
  };

  const runV3MotionQa = (mode: V3ArmorEditorMotionQaMode) => {
    if (modelSystem !== 'v3') return;
    const stagedDrafts = mode === 'full-suit'
      ? activeV3SuitDrafts ?? createStagedV3SuitDrafts()
      : undefined;
    const report = buildV3ArmorEditorMotionQaReport({
      mode,
      activeSlot: slot as V3CustomArmorSlot,
      draft,
      suitDrafts: stagedDrafts ?? undefined,
      loadout: playerLoadout,
      catalog,
      selectedCaseId: selectedV3PoseCaseId,
      hue: playerHue,
    });
    if (mode === 'full-suit' && stagedDrafts) {
      setV3SuitDrafts(stagedDrafts);
      setV3SuitPreviewEnabled(true);
    }
    setV3MotionQaMode(mode);
    setV3MotionQaReport(report);
    setV3MotionQaReportToken(buildV3MotionQaSourceToken(mode, stagedDrafts));
    const scopeLabel = mode === 'full-suit' ? 'Full suit' : V3_POSE_LABELS[selectedV3PoseCaseId];
    setStatus(`${scopeLabel} Motion QA ${report.ready ? 'passed' : `reported ${report.issues.length} advisory issue${report.issues.length === 1 ? '' : 's'}`}.`);
  };

  const clearActiveDraftHistory = () => {
    setUndoStack([]);
    setRedoStack([]);
    setSelectedKeys(new Set());
  };

  const loadDraftForSlot = (
    nextSlot: CustomArmorSlot,
    nextDraft: CustomArmorPieceSnapshot,
    nextModelType: CharacterModelType = modelType,
    nextModelSystem: CustomArmorModelSystem = modelSystem
  ) => {
    const nextGridScale = nextModelSystem === 'v3' ? getCustomArmorGridScale(nextDraft) : 1;
    const b = getEditorSlotBounds(nextSlot, nextModelType, nextModelSystem, nextGridScale);
    setSlot(nextSlot);
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    setDraft(cloneSnapshot(nextDraft));
    clearActiveDraftHistory();
  };

  const createStagedV3SuitDrafts = (baseDrafts: V3SuitDraftMap | null = v3SuitDrafts): V3SuitDraftMap => {
    const base = baseDrafts ?? createV3SuitDraftMap(playerLoadout, catalog, playerHue, Date.now());
    const currentSlot = slot as V3CustomArmorSlot;
    return {
      ...base,
      [currentSlot]: cloneV3SuitDraftForSlot(currentSlot, draft),
    };
  };

  const startV3SuitWorkspace = () => {
    const nextDrafts = createStagedV3SuitDrafts(
      v3SuitDrafts ?? createV3SuitDraftMap(playerLoadout, catalog, playerHue, Date.now())
    );
    const currentSlot = slot as V3CustomArmorSlot;
    setV3SuitDrafts(nextDrafts);
    setV3SuitPreviewEnabled(false);
    loadDraftForSlot(currentSlot, nextDrafts[currentSlot], modelType, 'v3');
    setStatus('Full suit workspace started.');
  };

  const previewV3SuitWorkspace = () => {
    const stagedDrafts = createStagedV3SuitDrafts();
    setV3SuitDrafts(stagedDrafts);
    setV3SuitPreviewEnabled(true);
    setViewMode('rig');
    setStatus('Full suit preview enabled.');
  };

  const saveV3SuitWorkspace = () => {
    const stagedDrafts = createStagedV3SuitDrafts();
    const validationResult = validateV3SuitDrafts(stagedDrafts);
    setV3SuitDrafts(stagedDrafts);

    if (!validationResult.valid) {
      const firstInvalidSlot = V3_CUSTOM_ARMOR_SLOTS.find((candidate) => !validationResult.slots[candidate]?.valid);
      if (firstInvalidSlot) {
        loadDraftForSlot(firstInvalidSlot, stagedDrafts[firstInvalidSlot], modelType, 'v3');
      }
      setStatus(`Full suit save blocked: ${validationResult.errors[0]}`);
      return;
    }

    const saveTime = Date.now();
    suitSaveTokenRef.current += 1;
    setPendingV3SuitSave({
      drafts: stagedDrafts,
      saveTime,
      activeSlot: slot as V3CustomArmorSlot,
      token: suitSaveTokenRef.current,
    });
    setStatus('Full suit save queued.');
  };

  const hasUnsavedV3SuitDrafts = (): boolean => {
    if (modelSystem !== 'v3' || !v3SuitDrafts) return false;
    const stagedDrafts = createStagedV3SuitDrafts();
    return V3_CUSTOM_ARMOR_SLOTS.some((candidate) => {
      const staged = stagedDrafts[candidate];
      const equipped = playerLoadout.customArmor?.[candidate];
      return !equipped || equipped.id !== staged.id || equipped.updatedAt !== staged.updatedAt;
    });
  };

  const saveV3SuitProfile = () => {
    if (!onV3SuitProfileCatalogChange) {
      setStatus('Suit profile storage is unavailable.');
      return;
    }
    if (hasUnsavedV3SuitDrafts()) {
      setStatus('Save & Equip Suit before saving a suit profile.');
      return;
    }

    const now = Date.now();
    const createResult = createV3SuitProfileFromLoadout(playerLoadout, catalog, {
      name: `Suit Profile ${v3SuitProfileCatalog.profiles.length + 1}`,
      now,
    });
    if (!createResult.profile) {
      setStatus(`Suit profile save blocked: ${createResult.errors[0]}`);
      return;
    }

    const upserted = upsertV3SuitProfile(v3SuitProfileCatalog, createResult.profile, { now });
    if (upserted.errors.length > 0 || !upserted.profile) {
      setStatus(`Suit profile save blocked: ${upserted.errors[0]}`);
      return;
    }

    onV3SuitProfileCatalogChange(upserted.catalog);
    setSelectedV3SuitProfileId(upserted.profile.id);
    setStatus(`${upserted.profile.name} saved as a suit profile.`);
  };

  const loadV3SuitProfile = () => {
    if (!selectedV3SuitProfile) {
      setStatus('No suit profile selected.');
      return;
    }
    const result = applyV3SuitProfileToLoadout(playerLoadout, selectedV3SuitProfile, catalog);
    if (!result.loadoutPatch) {
      setStatus(`Suit profile load blocked: ${result.errors[0]}`);
      return;
    }

    onLoadoutChange(result.loadoutPatch);
    const previewLoadout: CharacterLoadout = {
      ...playerLoadout,
      ...result.loadoutPatch,
    };
    const drafts = createV3SuitDraftMap(previewLoadout, catalog, playerHue, Date.now());
    const currentSlot = slot as V3CustomArmorSlot;
    setV3SuitDrafts(drafts);
    setV3SuitPreviewEnabled(true);
    loadDraftForSlot(currentSlot, drafts[currentSlot], modelType, 'v3');
    setStatus(result.missingSlotIds.length > 0
      ? `${selectedV3SuitProfile.name} loaded with ${result.missingSlotIds.length} missing slots skipped.`
      : `${selectedV3SuitProfile.name} loaded.`);
  };

  const duplicateV3SuitProfile = () => {
    if (!onV3SuitProfileCatalogChange || !selectedV3SuitProfile) {
      setStatus('No suit profile selected.');
      return;
    }
    const now = Date.now();
    const copy: V3SuitProfile = {
      ...selectedV3SuitProfile,
      id: `${selectedV3SuitProfile.id}_copy_${now.toString(36)}`.slice(0, 80),
      name: `${selectedV3SuitProfile.name} Copy`.slice(0, 32),
      createdAt: now,
      updatedAt: now,
    };
    const upserted = upsertV3SuitProfile(v3SuitProfileCatalog, copy, { now });
    if (upserted.errors.length > 0 || !upserted.profile) {
      setStatus(`Suit profile duplicate blocked: ${upserted.errors[0]}`);
      return;
    }
    onV3SuitProfileCatalogChange(upserted.catalog);
    setSelectedV3SuitProfileId(upserted.profile.id);
    setStatus(`${upserted.profile.name} duplicated.`);
  };

  const deleteSelectedV3SuitProfile = () => {
    if (!onV3SuitProfileCatalogChange || !selectedV3SuitProfile) {
      setStatus('No suit profile selected.');
      return;
    }
    if (!confirm(`Delete "${selectedV3SuitProfile.name}"?`)) return;
    onV3SuitProfileCatalogChange(deleteV3SuitProfile(v3SuitProfileCatalog, selectedV3SuitProfile.id));
    setSelectedV3SuitProfileId('');
    setStatus(`${selectedV3SuitProfile.name} deleted.`);
  };

  const exportSelectedV3SuitProfile = () => {
    if (!selectedV3SuitProfile) {
      setStatus('No suit profile selected.');
      return;
    }
    const result = exportV3SuitProfileBundle(selectedV3SuitProfile, catalog);
    if (!result.bundle) {
      setStatus(`Suit profile export blocked: ${result.errors[0]}`);
      return;
    }
    const payload = JSON.stringify(result.bundle, null, 2);
    setExportText(payload);
    void navigator.clipboard?.writeText(payload).catch(() => undefined);
    setStatus(result.warnings.length > 0 ? `Suit profile exported with warnings: ${result.warnings[0]}` : 'Suit profile export JSON prepared.');
  };

  const importV3SuitProfile = () => {
    if (!onV3SuitProfileCatalogChange) {
      setStatus('Suit profile storage is unavailable.');
      return;
    }
    try {
      const parsed = JSON.parse(importText);
      const result = importV3SuitProfileBundle(parsed, catalog, v3SuitProfileCatalog, { now: Date.now() });
      if (result.errors.length > 0 || !result.profile) {
        setStatus(`Suit profile import blocked: ${result.errors[0]}`);
        return;
      }
      onCatalogChange(result.customArmorCatalog);
      onV3SuitProfileCatalogChange(result.profileCatalog);
      setSelectedV3SuitProfileId(result.profile.id);
      setStatus(`${result.profile.name} imported.`);
    } catch (error: any) {
      setStatus(error?.message || 'Suit profile import failed.');
    }
  };

  useEffect(() => {
    if (!pendingV3SuitSave) return;

    if (!pendingV3SuitSave.committedPlan) {
      if (pendingV3SuitSave.catalogCommitQueued) return;

      const { drafts, saveTime, token } = pendingV3SuitSave;
      setPendingV3SuitSave((current) => (
        current?.token === token ? { ...current, catalogCommitQueued: true } : current
      ));
      onCatalogChange((currentCatalog) => {
        const currentPlan = buildV3SuitSavePlan(currentCatalog, playerLoadout, drafts, saveTime);
        Promise.resolve().then(() => {
          if (currentPlan.errors.length > 0) {
            setStatus(`Full suit save blocked: ${currentPlan.errors[0]}`);
            setPendingV3SuitSave((current) => current?.token === token ? null : current);
            return;
          }
          setPendingV3SuitSave((current) => (
            current?.token === token ? { ...current, committedPlan: currentPlan } : current
          ));
        });
        return currentPlan.errors.length > 0 ? currentCatalog : currentPlan.nextCatalog;
      });
      return;
    }

    const plan = pendingV3SuitSave.committedPlan;

    if (plan.errors.length > 0) {
      setStatus(`Full suit save blocked: ${plan.errors[0]}`);
      setPendingV3SuitSave(null);
      return;
    }

    if (plan.loadoutPatch) {
      onLoadoutChange(plan.loadoutPatch);
    }

    const savedDrafts = Object.fromEntries(
      V3_CUSTOM_ARMOR_SLOTS.map((candidate) => [
        candidate,
        cloneSnapshot(plan.savedSnapshots[candidate] ?? pendingV3SuitSave.drafts[candidate]),
      ])
    ) as V3SuitDraftMap;
    setV3SuitDrafts(savedDrafts);
    setV3SuitPreviewEnabled(true);
    loadDraftForSlot(pendingV3SuitSave.activeSlot, savedDrafts[pendingV3SuitSave.activeSlot], modelType, 'v3');
    setPendingV3SuitSave(null);
    setStatus('Full suit saved and equipped.');
  }, [loadDraftForSlot, modelType, onCatalogChange, onLoadoutChange, pendingV3SuitSave, playerLoadout]);

  const switchSlot = (nextSlot: CustomArmorSlot) => {
    if (modelSystem === 'v3' && v3SuitDrafts && V3_CUSTOM_ARMOR_SLOTS.includes(nextSlot as V3CustomArmorSlot)) {
      const stagedDrafts = createStagedV3SuitDrafts();
      const nextV3Slot = nextSlot as V3CustomArmorSlot;
      setV3SuitDrafts(stagedDrafts);
      loadDraftForSlot(nextV3Slot, stagedDrafts[nextV3Slot], modelType, 'v3');
      return;
    }
    setSlot(nextSlot);
    const equipped = getEquippedPieceForType(nextSlot, modelType, modelSystem);
    const nextDraft = equipped
      ? cloneSnapshot(equipped)
      : snapshotFromBuiltin(
        nextSlot,
        modelSystem === 'v3'
          ? getV3PresetForSlot(nextSlot as V3CustomArmorSlot)
          : getDefaultPresetForSlot(nextSlot, playerLoadout),
        playerHue,
        modelType,
        modelSystem
      );
    const b = getEditorSlotBounds(nextSlot, modelType, modelSystem, modelSystem === 'v3' ? getCustomArmorGridScale(nextDraft) : 1);
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    setDraft(
      nextDraft
    );
    setUndoStack([]);
    setRedoStack([]);
    setSelectedKeys(new Set());
  };

  const switchModelType = (nextModelType: CharacterModelType) => {
    setModelSystem('v2');
    setModelType(nextModelType);
    setV3SuitDrafts(null);
    setV3SuitPreviewEnabled(false);
    setPendingV3SuitSave(null);
    onLoadoutChange({ modelSystem: 'v2', modelType: nextModelType });
    const nextSlot = SLOT_OPTIONS.some((option) => option.slot === slot) ? slot : 'helmet';
    setSlot(nextSlot);
    const b = getEditorSlotBounds(nextSlot, nextModelType, 'v2');
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    setViewMode((current) => current === 'preview' ? 'edit' : current);
    const equipped = getEquippedPieceForType(nextSlot, nextModelType, 'v2');
    setDraft(
      equipped
        ? cloneSnapshot(equipped)
        : snapshotFromBuiltin(nextSlot, getDefaultPresetForSlot(nextSlot, playerLoadout), playerHue, nextModelType, 'v2')
    );
    setUndoStack([]);
    setRedoStack([]);
    setSelectedKeys(new Set());
  };

  const switchModelSystem = (nextModelSystem: CustomArmorModelSystem) => {
    setModelSystem(nextModelSystem);
    if (nextModelSystem !== 'v3') {
      setV3SuitDrafts(null);
      setV3SuitPreviewEnabled(false);
      setPendingV3SuitSave(null);
    }
    const nextModelType = nextModelSystem === 'v2' ? modelType : 'medium';
    setModelType(nextModelType);
    const nextSlot = nextModelSystem === 'v3'
      ? (V3_CUSTOM_ARMOR_SLOTS.includes(slot as V3CustomArmorSlot) ? slot : 'helmet')
      : (SLOT_OPTIONS.some((option) => option.slot === slot) ? slot : 'helmet');
    setSlot(nextSlot);
    onLoadoutChange({
      modelSystem: nextModelSystem,
      modelType: nextModelSystem === 'v2' ? nextModelType : undefined,
    });
    const equipped = getEquippedPieceForType(nextSlot, nextModelType, nextModelSystem);
    const nextDraft = equipped
      ? cloneSnapshot(equipped)
      : snapshotFromBuiltin(
        nextSlot,
        nextModelSystem === 'v3'
          ? getV3PresetForSlot(nextSlot as V3CustomArmorSlot)
          : getDefaultPresetForSlot(nextSlot, playerLoadout),
        playerHue,
        nextModelType,
        nextModelSystem
      );
    const b = getEditorSlotBounds(nextSlot, nextModelType, nextModelSystem, nextModelSystem === 'v3' ? getCustomArmorGridScale(nextDraft) : 1);
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    setViewMode((current) => nextModelSystem === 'v2' && current === 'preview' ? 'edit' : current);
    setDraft(
      nextDraft
    );
    setUndoStack([]);
    setRedoStack([]);
    setSelectedKeys(new Set());
  };

  const mutateVoxels = (mutator: (voxels: CustomArmorVoxel[]) => CustomArmorVoxel[]) => {
    setDraftWithHistory((current) => ({
      ...current,
      voxels: dedupeCustomArmorVoxels(mutator(current.voxels)),
    }));
  };

  const addVoxels = (voxels: CustomArmorVoxel[]) => {
    mutateVoxels((current) => [...current, ...voxels]);
  };

  const eraseKeys = (keys: Set<string>) => {
    if (keys.size === 0) return;
    mutateVoxels((voxels) => voxels.filter((voxel) => !keys.has(`${voxel.x},${voxel.y},${voxel.z}`)));
    setSelectedKeys(new Set());
  };

  const makeBoxVoxels = (): CustomArmorVoxel[] => {
    const voxels: CustomArmorVoxel[] = [];
    for (let dx = 0; dx < Math.max(1, size.x); dx++) {
      for (let dy = 0; dy < Math.max(1, size.y); dy++) {
        for (let dz = 0; dz < Math.max(1, size.z); dz++) {
          voxels.push(createVoxel(cursor.x + dx, cursor.y + dy, cursor.z + dz, role, fixedColor, emissive));
        }
      }
    }
    return voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem, draftGridScale));
  };

  const applyToolAtCursor = () => {
    if (tool === 'place') {
      addVoxels([createVoxel(cursor.x, cursor.y, cursor.z, role, fixedColor, emissive)].filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem, draftGridScale)));
    } else if (tool === 'erase') {
      eraseKeys(new Set([`${cursor.x},${cursor.y},${cursor.z}`]));
    } else if (tool === 'box') {
      addVoxels(makeBoxVoxels());
    } else if (tool === 'line') {
      const voxels: CustomArmorVoxel[] = [];
      const length = Math.max(1, size[axis]);
      for (let i = 0; i < length; i++) {
        voxels.push(createVoxel(
          cursor.x + (axis === 'x' ? i : 0),
          cursor.y + (axis === 'y' ? i : 0),
          cursor.z + (axis === 'z' ? i : 0),
          role,
          fixedColor,
          emissive
        ));
      }
      addVoxels(voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem, draftGridScale)));
    } else if (tool === 'plane') {
      const voxels: CustomArmorVoxel[] = [];
      for (let a = 0; a < Math.max(1, size.x); a++) {
        for (let b = 0; b < Math.max(1, size.z); b++) {
          voxels.push(createVoxel(
            cursor.x + (axis === 'x' ? 0 : a),
            cursor.y + (axis === 'y' ? 0 : a),
            cursor.z + (axis === 'z' ? 0 : b),
            role,
            fixedColor,
            emissive
          ));
        }
      }
      addVoxels(voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem, draftGridScale)));
    } else if (tool === 'fill') {
      const b = getEditorSlotBounds(slot, modelType, modelSystem, draftGridScale);
      const voxels: CustomArmorVoxel[] = [];
      for (let x = b.minX; x <= b.maxX; x++) {
        for (let y = b.minY; y <= b.maxY; y++) {
          for (let z = b.minZ; z <= b.maxZ; z++) {
            voxels.push(createVoxel(x, y, z, role, fixedColor, emissive));
          }
        }
      }
      addVoxels(voxels);
    } else if (tool === 'extrude' || tool === 'duplicate' || tool === 'move') {
      transformSelection(tool === 'move');
    }
  };

  const transformSelection = (removeOriginal: boolean) => {
    const keys = selectedKeys.size > 0 ? selectedKeys : new Set([`${cursor.x},${cursor.y},${cursor.z}`]);
    setDraftWithHistory((current) => {
      const selected = current.voxels.filter((voxel) => keys.has(`${voxel.x},${voxel.y},${voxel.z}`));
      const moved = selected
        .map((voxel) => ({
          ...voxel,
          x: voxel.x + offset.x,
          y: voxel.y + offset.y,
          z: voxel.z + offset.z,
        }))
        .filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem, draftGridScale));
      const retained = removeOriginal
        ? current.voxels.filter((voxel) => !keys.has(`${voxel.x},${voxel.y},${voxel.z}`))
        : current.voxels;
      return {
        ...current,
        voxels: dedupeCustomArmorVoxels([...retained, ...moved]),
      };
    });
  };

  const savePiece = () => {
    const nextDraft = {
      ...draft,
      modelSystem,
      modelType: modelSystem === 'v2' ? modelType : undefined,
      thumbnail: createCustomArmorThumbnail(draft.slot, draft.voxels.length, modelSystem),
      updatedAt: Date.now(),
    };
    const result = validateCustomArmorPiece(nextDraft);
    if (!result.valid) {
      setStatus('Resolve validation errors before saving.');
      return;
    }
    const snapshot = createCustomArmorSnapshot(nextDraft);
    onCatalogChange((current) => upsertCustomArmorPieceInCatalog(current, snapshot).catalog);
    onLoadoutChange({
      modelSystem,
      modelType: modelSystem === 'v2' ? modelType : undefined,
      customArmor: {
        ...(playerLoadout.customArmor ?? {}),
        [slot]: snapshot,
      },
    });
    setDraft(snapshot);
    setStatus(`${snapshot.name} saved and equipped.`);
  };

  const saveCopy = () => {
    const copy = duplicateCustomArmorPiece(draft, `${draft.name} Copy`);
    const result = validateCustomArmorPiece(copy);
    if (!result.valid) {
      setStatus('Resolve validation errors before saving a copy.');
      return;
    }
    const snapshot = createCustomArmorSnapshot(copy);
    onCatalogChange((current) => ({ version: 1, pieces: [...current.pieces, copy] }));
    onLoadoutChange({
      modelSystem,
      modelType: modelSystem === 'v2' ? modelType : undefined,
      customArmor: {
        ...(playerLoadout.customArmor ?? {}),
        [slot]: snapshot,
      },
    });
    setDraft(snapshot);
    setStatus(`${copy.name} saved as a new variant.`);
  };

  const restoreHistory = (piece: CustomArmorPiece, historyIndex: number) => {
    const restored = restoreCustomArmorHistoryEntry(piece, historyIndex);
    if (!restored) {
      setStatus('History entry is unavailable.');
      return;
    }
    replaceDraft(restored);
    setStatus(`${restored.name} restored from history.`);
  };

  const deletePiece = (piece: CustomArmorPiece) => {
    if (!confirm(`Delete "${piece.name}"?`)) return;
    onCatalogChange((current) => ({
      version: 1,
      pieces: current.pieces.filter((entry) => entry.id !== piece.id),
    }));
    if (playerLoadout.customArmor?.[piece.slot]?.id === piece.id) {
      const nextCustomArmor = { ...(playerLoadout.customArmor ?? {}) };
      delete nextCustomArmor[piece.slot];
      onLoadoutChange({ customArmor: nextCustomArmor });
    }
  };

  const equipPiece = (piece: CustomArmorPiece) => {
    const snapshot = createCustomArmorSnapshot(piece);
    setDraft(snapshot);
    const pieceModelSystem = getCustomArmorPieceModelSystem(snapshot);
    onLoadoutChange({
      modelSystem: pieceModelSystem,
      modelType: pieceModelSystem === 'v2' ? modelType : undefined,
      customArmor: {
        ...(playerLoadout.customArmor ?? {}),
        [piece.slot]: snapshot,
      },
    });
    setStatus(`${piece.name} equipped.`);
  };

  const undo = () => {
    setUndoStack((stack) => {
      const previous = stack[stack.length - 1];
      if (!previous) return stack;
      setRedoStack((redo) => [...redo, cloneSnapshot(draft)]);
      setDraft(previous);
      return stack.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack((stack) => {
      const next = stack[stack.length - 1];
      if (!next) return stack;
      setUndoStack((undoStackNext) => [...undoStackNext, cloneSnapshot(draft)]);
      setDraft(next);
      return stack.slice(0, -1);
    });
  };

  const exportDraft = () => {
    const payload = JSON.stringify(draft, null, 2);
    setExportText(payload);
    void navigator.clipboard?.writeText(payload).catch(() => undefined);
    setStatus('Export JSON prepared.');
  };

  const importDraft = () => {
    try {
      const parsed = JSON.parse(importText);
      const imported = createCustomArmorSnapshot({
        ...parsed,
        slot,
        modelSystem,
        modelType: modelSystem === 'v2' ? modelType : undefined,
        id: typeof parsed.id === 'string' ? parsed.id : draft.id,
        name: typeof parsed.name === 'string' ? parsed.name : `${getCustomArmorSlotLabel(slot, modelSystem, modelType)} Import`,
        updatedAt: Date.now(),
      });
      replaceDraft(imported);
      setStatus('Import loaded into draft.');
    } catch (error: any) {
      setStatus(error?.message || 'Import failed.');
    }
  };

  const renameDraft = (name: string) => {
    setDraft((current) => ({ ...current, name: name.slice(0, 32) }));
  };

  const getV3SuitSlotStatusLabels = (targetSlot: V3CustomArmorSlot): string[] => {
    const labels: string[] = [];
    const slotValidation = v3SuitValidation?.slots[targetSlot];
    if (slotValidation) {
      labels.push(!slotValidation.valid ? 'Invalid' : slotValidation.warnings.length > 0 ? 'Warn' : 'Valid');
    } else {
      labels.push('Draft');
    }

    const stagedDraft = activeV3SuitDrafts?.[targetSlot]
      ?? (targetSlot === slot ? cloneV3SuitDraftForSlot(targetSlot, draft) : undefined);
    if (stagedDraft && playerLoadout.customArmor?.[targetSlot]?.id === stagedDraft.id) {
      labels.push('Equipped');
    }

    if (
      v3MotionQaReport
      && !v3MotionQaIsStale
      && v3MotionQaMode === 'full-suit'
      && v3MotionQaReport.slotIssueCounts[targetSlot]
    ) {
      labels.push('Motion Warn');
    } else if (
      v3MotionQaReport
      && !v3MotionQaIsStale
      && v3MotionQaMode === 'full-suit'
      && v3MotionQaReport.summary.supported
    ) {
      labels.push('Motion');
    }

    return labels;
  };

  const getV3SuitSlotStatusClass = (label: string): string => {
    if (label === 'Invalid') return 'border-red-400/40 bg-red-500/15 text-red-200';
    if (label === 'Motion Warn') return 'border-orange-400/40 bg-orange-500/15 text-orange-100';
    if (label === 'Warn') return 'border-amber-400/40 bg-amber-500/15 text-amber-200';
    if (label === 'Valid') return 'border-emerald-400/40 bg-emerald-500/15 text-emerald-200';
    if (label === 'Motion') return 'border-sky-400/40 bg-sky-500/15 text-sky-100';
    if (label === 'Equipped') return 'border-purple-400/40 bg-purple-500/15 text-purple-100';
    return 'border-white/10 bg-black/35 text-white/45';
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scene = new THREE.Scene();
    const width = container.clientWidth || 520;
    const height = container.clientHeight || 420;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 80);
    const savedCameraView = cameraViewsRef.current[viewMode];
    const cameraTarget = new THREE.Vector3(
      savedCameraView.target.x,
      savedCameraView.target.y,
      savedCameraView.target.z
    );
    const cameraState = {
      yaw: savedCameraView.yaw,
      pitch: savedCameraView.pitch,
      distance: savedCameraView.distance,
    };
    const minCameraDistance = viewMode === 'rig' ? 2.3 : 0.65;
    const maxCameraDistance = viewMode === 'rig' ? 7 : 4.5;
    const applyCamera = () => {
      const clampedPitch = Math.max(-1.25, Math.min(1.25, cameraState.pitch));
      cameraState.pitch = clampedPitch;
      cameraState.distance = Math.max(minCameraDistance, Math.min(maxCameraDistance, cameraState.distance));
      const cosPitch = Math.cos(cameraState.pitch);
      camera.position.set(
        cameraTarget.x + Math.sin(cameraState.yaw) * cosPitch * cameraState.distance,
        cameraTarget.y + Math.sin(cameraState.pitch) * cameraState.distance,
        cameraTarget.z + Math.cos(cameraState.yaw) * cosPitch * cameraState.distance
      );
      camera.lookAt(cameraTarget);
      camera.updateProjectionMatrix();
      cameraViewsRef.current[viewMode] = {
        target: {
          x: cameraTarget.x,
          y: cameraTarget.y,
          z: cameraTarget.z,
        },
        yaw: cameraState.yaw,
        pitch: cameraState.pitch,
        distance: cameraState.distance,
      };
    };
    applyCamera();

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    container.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight('#ffffff', 0.72));
    const keyLight = new THREE.DirectionalLight('#ffffff', 1.35);
    keyLight.position.set(5, 6, 5);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight('#a855f7', 1.6, 8);
    rimLight.position.set(-2.5, 2.5, 2.5);
    scene.add(rimLight);

    const meshes: THREE.Mesh[] = [];
    const baseScale = modelSystem === 'v3' ? V3_ARMOR_SURFACE_BASE_VOXEL_SCALE : 0.045;
    const scale = modelSystem === 'v3' ? baseScale / draftGridScale : baseScale;

    if (viewMode === 'rig') {
      const previewLoadout: CharacterLoadout = modelSystem === 'v3' && v3SuitPreviewEnabled && v3SuitDrafts
        ? mergeV3SuitPreviewLoadout(playerLoadout, v3SuitDrafts, slot as V3CustomArmorSlot, draft)
        : {
          ...playerLoadout,
          modelSystem,
          modelType: modelSystem === 'v2' ? modelType : undefined,
          customArmor: {
            ...(playerLoadout.customArmor ?? {}),
            [slot]: {
              ...draft,
              modelSystem,
              modelType: modelSystem === 'v2' ? modelType : undefined,
            },
          },
        };
      let model: THREE.Group;
      if (modelSystem === 'v3') {
        const meshRig = createCombatantMeshRig(scene, playerHue, false, previewLoadout, {
          v3QualityTier: 'desktop',
        });
        model = meshRig.group;
        applyV3PoseClearanceCase({
          model: meshRig.group,
          rig: meshRig.rig,
          hammerModel: meshRig.hammer,
          swordModel: meshRig.sword,
          pistolModel: meshRig.pistol,
        }, selectedV3PoseCaseId);
        model.position.set(0, 0, 0);
        model.rotation.y = -0.35;
        if (showMotionOverlay && selectedV3MotionQaCase && !v3MotionQaIsStale) {
          model.add(createV3MotionOverlayGroup(selectedV3MotionQaCase.overlays));
        }
      } else {
        model = buildVoxelSpartanModel(false, playerHue, previewLoadout);
        model.position.set(0, 0, 0);
        model.rotation.y = -0.35;
        buildCombatantRigForModel(model);
        applyPreviewPose(model, normalizeV2PoseMode(poseMode));
        scene.add(model);
      }
      if (modelSystem === 'v3' && activeV3PreviewOverlay?.changed) {
        const partGroups = model.userData.v3PartGroups as Partial<Record<V3CustomArmorSlot, THREE.Group>> | undefined;
        const partGroup = partGroups?.[slot as V3CustomArmorSlot];
        if (partGroup) {
          partGroup.add(createV3SmartPreviewOverlayGroup(
            activeV3PreviewOverlay,
            editorPreviewPalette,
            V3_ARMOR_SURFACE_BASE_VOXEL_SCALE / draftGridScale,
            { x: 0, y: 0, z: 0 }
          ));
        }
      }
    } else {
      const b = getEditorSlotBounds(slot, modelType, modelSystem, draftGridScale);
      const centerX = (b.minX + b.maxX) / 2;
      const centerY = (b.minY + b.maxY) / 2;
      const centerZ = (b.minZ + b.maxZ) / 2;
      const palette = editorPreviewPalette;
      const baseSilhouetteVoxels = showSilhouette
        ? modelSystem === 'v3'
          ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, playerHue, undefined, { gridScale: 1 })
          : getVoxelSegmentDataV2(getV2SourceSlot(slot), selectedPreset, playerHue, false, modelType)
        : [];
      const silhouetteVoxels = modelSystem === 'v3' && draftGridScale > 1
        ? baseSilhouetteVoxels.map((voxel) => ({
            ...voxel,
            x: voxel.x * draftGridScale,
            y: voxel.y * draftGridScale,
            z: voxel.z * draftGridScale,
          }))
        : baseSilhouetteVoxels;

      if (showBounds) {
        const box = new THREE.Box3(
          new THREE.Vector3((b.minX - centerX - 0.5) * scale, (b.minY - centerY - 0.5) * scale, (b.minZ - centerZ - 0.5) * scale),
          new THREE.Vector3((b.maxX - centerX + 0.5) * scale, (b.maxY - centerY + 0.5) * scale, (b.maxZ - centerZ + 0.5) * scale)
        );
        scene.add(new THREE.Box3Helper(box, new THREE.Color('#a855f7')));
      }

      if (showCollision) {
        const collisionProfile = getCharacterModelCollisionProfile(modelType, modelSystem);
        const cylinder = new THREE.Mesh(
          new THREE.CylinderGeometry(
            collisionProfile.radius,
            collisionProfile.radius,
            collisionProfile.standingHeight,
            32,
            1,
            true
          ),
          new THREE.MeshBasicMaterial({ color: '#22d3ee', transparent: true, opacity: 0.08, wireframe: true })
        );
        cylinder.position.y = collisionProfile.standingHeight * 0.5 - 0.45;
        scene.add(cylinder);
      }

      silhouetteVoxels.forEach((voxel) => {
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(scale, scale, scale),
          new THREE.MeshBasicMaterial({ color: '#64748b', transparent: true, opacity: 0.14 })
        );
        mesh.position.set((voxel.x - centerX) * scale, (voxel.y - centerY) * scale, (voxel.z - centerZ) * scale);
        scene.add(mesh);
      });

      const renderVoxels = customArmorPieceToVoxels(draft, palette);
      const density = buildNeighborDensity(renderVoxels);
      if (viewMode === 'preview' && modelSystem === 'v3') {
        const armorPreview = createV3VoxelArmorGroup(renderVoxels, {
          ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
          voxelScale: scale,
          renderStyle: 'armorSurface',
          qualityTier: 'desktop',
          pivot: [centerX, centerY, centerZ],
        });
        scene.add(armorPreview);
      } else {
        renderVoxels.forEach((voxel) => {
          const key = `${voxel.x},${voxel.y},${voxel.z}`;
          const baseColor = showDensity
            ? densityColor(density.get(key) ?? 0)
            : voxel.color;
          const selected = selectedKeys.has(key);
          const material = new THREE.MeshStandardMaterial({
            color: selected ? '#fbbf24' : baseColor,
            emissive: voxel.emissive || selected ? new THREE.Color(selected ? '#f59e0b' : baseColor) : new THREE.Color('#000000'),
            emissiveIntensity: selected ? 1.6 : voxel.emissive ? 2.3 : 0,
            roughness: 0.35,
            metalness: 0.55,
          });
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(scale, scale, scale), material);
          mesh.position.set((voxel.x - centerX) * scale, (voxel.y - centerY) * scale, (voxel.z - centerZ) * scale);
          mesh.userData.key = key;
          mesh.userData.voxel = voxel;
          scene.add(mesh);
          meshes.push(mesh);
        });

        const cursorMesh = new THREE.Mesh(
          new THREE.BoxGeometry(scale * 1.15, scale * 1.15, scale * 1.15),
          new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true, transparent: true, opacity: 0.78 })
        );
        cursorMesh.position.set((cursor.x - centerX) * scale, (cursor.y - centerY) * scale, (cursor.z - centerZ) * scale);
        scene.add(cursorMesh);
      }

      if (modelSystem === 'v3' && activeV3PreviewOverlay?.changed) {
        scene.add(createV3SmartPreviewOverlayGroup(
          activeV3PreviewOverlay,
          palette,
          scale,
          { x: centerX, y: centerY, z: centerZ }
        ));
      }
    }

    type CameraDragMode = 'orbit' | 'pan';
    let dragging = false;
    let pointerMoved = false;
    let dragMode: CameraDragMode = 'orbit';
    let activeButton = 0;
    let startX = 0;
    let startY = 0;
    let previousX = 0;
    let previousY = 0;
    const clickMoveThreshold = 5;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const applyVoxelClick = (event: PointerEvent) => {
      if (viewMode === 'edit' && meshes.length > 0) {
        const paintSettings = paintSettingsRef.current;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(meshes)[0];
        if (hit?.object?.userData?.key) {
          const key = hit.object.userData.key as string;
          if (paintSettings.tool === 'erase') {
            eraseKeys(new Set([key]));
          } else if (paintSettings.tool === 'place') {
            const voxel = hit.object.userData.voxel as VoxelData;
            const normal = hit.face?.normal ?? new THREE.Vector3(0, 1, 0);
            addVoxels([createVoxel(
              voxel.x + Math.round(normal.x),
              voxel.y + Math.round(normal.y),
              voxel.z + Math.round(normal.z),
              paintSettings.role,
              paintSettings.fixedColor,
              paintSettings.emissive
            )].filter((candidate) => voxelWithinCurrentSlot(
              candidate,
              paintSettings.slot,
              paintSettings.modelType,
              paintSettings.modelSystem,
              paintSettings.gridScale
            )));
          } else {
            setSelectedKeys((keys) => {
              const next = new Set(keys);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }
        }
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      dragging = true;
      pointerMoved = false;
      dragMode = event.button === 1 || event.button === 2 || event.shiftKey ? 'pan' : 'orbit';
      activeButton = event.button;
      startX = event.clientX;
      startY = event.clientY;
      previousX = event.clientX;
      previousY = event.clientY;
      renderer.domElement.style.cursor = dragMode === 'pan' ? 'grabbing' : 'move';
      event.preventDefault();
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - previousX;
      const dy = event.clientY - previousY;
      previousX = event.clientX;
      previousY = event.clientY;
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > clickMoveThreshold) {
        pointerMoved = true;
      }

      if (dragMode === 'pan') {
        const forward = new THREE.Vector3();
        const right = new THREE.Vector3();
        const up = new THREE.Vector3();
        camera.getWorldDirection(forward);
        right.crossVectors(forward, camera.up).normalize();
        up.crossVectors(right, forward).normalize();
        const panScale = cameraState.distance * 0.0014;
        cameraTarget.addScaledVector(right, -dx * panScale);
        cameraTarget.addScaledVector(up, dy * panScale);
      } else {
        cameraState.yaw -= dx * 0.006;
        cameraState.pitch -= dy * 0.006;
      }
      applyCamera();
    };
    const finishPointerDrag = (event: PointerEvent, allowClick: boolean) => {
      const isClick = activeButton === 0
        && allowClick
        && !pointerMoved
        && Math.hypot(event.clientX - startX, event.clientY - startY) <= clickMoveThreshold;
      dragging = false;
      renderer.domElement.style.cursor = 'grab';
      if (isClick) {
        applyVoxelClick(event);
      }
      try { renderer.domElement.releasePointerCapture(event.pointerId); } catch {}
    };
    const onPointerUp = (event: PointerEvent) => finishPointerDrag(event, true);
    const onPointerCancel = (event: PointerEvent) => finishPointerDrag(event, false);
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      cameraState.distance *= Math.exp(event.deltaY * 0.001);
      applyCamera();
    };
    const onContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.cursor = 'grab';
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerCancel);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
    renderer.domElement.addEventListener('contextmenu', onContextMenu);

    let frame = 0;
    const animate = () => {
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    const handleResize = () => {
      const nextWidth = container.clientWidth || width;
      const nextHeight = container.clientHeight || height;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      applyCamera();
      renderer.setSize(nextWidth, nextHeight);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      renderer.domElement.removeEventListener('wheel', onWheel);
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry?.dispose();
          if (child.userData.v3CachedMaterial) return;
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    };
  }, [
    axis,
    cursor,
    draft,
    draftGridScale,
    editorPreviewPalette,
    playerHue,
    playerLoadout,
    poseMode,
    selectedV3MotionQaCase,
    selectedV3PoseCaseId,
    selectedKeys,
    selectedPreset,
    modelSystem,
    modelType,
    showBounds,
    showCollision,
    showDensity,
    showSilhouette,
    showMotionOverlay,
    size,
    smartMirrorOverwrite,
    smartMirrorScope,
    smartStrength,
    smartStripeWidth,
    slot,
    activeV3PreviewOverlay,
    v3MotionQaIsStale,
    v3SuitDrafts,
    v3SuitPreviewEnabled,
    viewMode,
  ]);

  return (
    <div className={`flex flex-col gap-3 min-h-0 ${isStandalone ? 'h-full' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        <div className="flex bg-black/40 border border-white/10 rounded p-1 gap-1">
          {activeSlotOptions.map((option) => (
            <button
              key={option.slot}
              type="button"
              onClick={() => switchSlot(option.slot)}
              title={'title' in option ? option.title : option.label}
              className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded border ${
                slot === option.slot
                  ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                  : 'bg-black/20 border-white/10 text-white/45 hover:text-white'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 h-9 rounded border border-white/10 bg-black/40 overflow-hidden">
          {(['v2', 'v3'] as const).map((system) => (
            <button
              key={system}
              type="button"
              onClick={() => switchModelSystem(system)}
              className={`px-3 text-[10px] font-black uppercase tracking-widest ${
                modelSystem === system
                  ? 'bg-cyan-500/20 text-cyan-100'
                  : 'text-white/45 hover:text-white/75 hover:bg-white/5'
              }`}
            >
              {system.toUpperCase()}
            </button>
          ))}
        </div>
        {modelSystem === 'v2' && (
          <div className="grid grid-cols-2 h-9 rounded border border-white/10 bg-black/40 overflow-hidden">
            {(['medium', 'large'] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => switchModelType(type)}
                className={`px-3 text-[10px] font-black uppercase tracking-widest ${
                  modelType === type
                    ? 'bg-cyan-500/20 text-cyan-100'
                    : 'text-white/45 hover:text-white/75 hover:bg-white/5'
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        )}
        <input
          value={draft.name}
          onChange={(event) => renameDraft(event.target.value)}
          className="min-w-[160px] flex-1 h-9 bg-black/50 border border-white/10 rounded px-3 text-xs text-white outline-none focus:border-purple-400"
        />
        <button type="button" onClick={savePiece} className="px-3 h-9 rounded border border-purple-400/50 bg-purple-500/20 text-purple-100 text-[10px] font-black uppercase tracking-widest">
          Save & Equip
        </button>
        <button type="button" onClick={saveCopy} className="px-3 h-9 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-100 text-[10px] font-black uppercase tracking-widest">
          Save Copy
        </button>
        <button type="button" onClick={onClose} className="px-3 h-9 rounded border border-white/10 bg-black/30 text-white/60 text-[10px] font-black uppercase tracking-widest">
          Close
        </button>
      </div>

      <div className={`grid grid-cols-1 gap-3 min-h-0 ${isStandalone ? 'flex-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_390px]' : 'xl:grid-cols-[minmax(0,1fr)_340px]'}`}>
        <div className={`flex flex-col gap-3 min-h-0 ${isStandalone ? 'h-full' : ''}`}>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => replaceDraft(createBlankSnapshot(slot, modelType, modelSystem))} className="editor-chip">Blank</button>
            {modelSystem === 'v2' && (
              <select
                value={selectedPreset}
                onChange={(event) => replaceDraft(snapshotFromBuiltin(slot, event.target.value, playerHue, modelType, 'v2'))}
                className="h-8 bg-black/50 border border-white/10 rounded px-2 text-xs text-white"
              >
                {BUILTIN_PRESETS[slot as V2CustomArmorSlot].map((preset) => <option key={preset} value={preset}>{preset}</option>)}
              </select>
            )}
            <button
              type="button"
              onClick={() => replaceDraft(snapshotFromBuiltin(slot, selectedPreset, playerHue, modelType, modelSystem, `${selectedPreset} Remix`))}
              className="editor-chip"
            >
              Clone Built-In
            </button>
            {getEquippedPieceForType(slot, modelType, modelSystem) && (
              <button type="button" onClick={() => replaceDraft(cloneSnapshot(getEquippedPieceForType(slot, modelType, modelSystem)!))} className="editor-chip">Clone Equipped</button>
            )}
            <button type="button" onClick={undo} disabled={undoStack.length === 0} className="editor-chip disabled:opacity-30">Undo</button>
            <button type="button" onClick={redo} disabled={redoStack.length === 0} className="editor-chip disabled:opacity-30">Redo</button>
          </div>

          <div className={`min-h-[420px] rounded-lg border border-white/10 bg-slate-950/80 overflow-hidden relative ${isStandalone ? 'flex-1' : ''}`} ref={containerRef}>
            <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-1.5">
              {activeViewModes.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 rounded border text-[10px] font-black uppercase tracking-widest ${
                    viewMode === mode ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-black/50 border-white/10 text-white/45'
                  }`}
                >
                  {mode === 'edit' ? 'Voxel Edit' : mode === 'preview' ? 'Armor Preview' : 'Rig Preview'}
                </button>
              ))}
            </div>
            {viewMode === 'rig' && (
              <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-1.5 max-w-[340px]">
                {activePoseOptions.map((pose) => (
                  <button
                    key={pose.id}
                    type="button"
                    onClick={() => setPoseMode(pose.id)}
                    className={`px-2 py-1 rounded border text-[10px] font-black uppercase tracking-widest ${
                      (modelSystem === 'v3' ? selectedV3PoseCaseId : normalizeV2PoseMode(poseMode)) === pose.id
                        ? 'bg-purple-500/25 border-purple-300 text-purple-100'
                        : 'bg-black/50 border-white/10 text-white/45'
                    }`}
                  >
                    {pose.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
            <Toggle label="Bounds" checked={showBounds} onChange={setShowBounds} />
            <Toggle label="Silhouette" checked={showSilhouette} onChange={setShowSilhouette} />
            <Toggle label="Cylinder" checked={showCollision} onChange={setShowCollision} />
            <Toggle label="Density" checked={showDensity} onChange={setShowDensity} />
            <Toggle label="Clipping" checked={showClipping} onChange={setShowClipping} />
            <Toggle label="Budget" checked={showPerformance} onChange={setShowPerformance} />
            {modelSystem === 'v3' && (
              <Toggle label="Motion Overlay" checked={showMotionOverlay} onChange={setShowMotionOverlay} />
            )}
          </div>
        </div>

        <div className={`flex flex-col gap-3 min-h-0 ${isStandalone ? 'overflow-y-auto pr-1' : ''}`}>
          <Panel title="Tools">
            <div className="grid grid-cols-3 gap-1.5">
              {TOOL_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTool(option.id)}
                  className={`py-1.5 rounded border text-[10px] font-black uppercase tracking-widest ${
                    tool === option.id ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-black/30 border-white/10 text-white/45'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <NumberInput label="X" value={cursor.x} onChange={(value) => setCursor((current) => ({ ...current, x: value }))} />
              <NumberInput label="Y" value={cursor.y} onChange={(value) => setCursor((current) => ({ ...current, y: value }))} />
              <NumberInput label="Z" value={cursor.z} onChange={(value) => setCursor((current) => ({ ...current, z: value }))} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              <NumberInput label="W" value={size.x} onChange={(value) => setSize((current) => ({ ...current, x: Math.max(1, value) }))} />
              <NumberInput label="H" value={size.y} onChange={(value) => setSize((current) => ({ ...current, y: Math.max(1, value) }))} />
              <NumberInput label="D" value={size.z} onChange={(value) => setSize((current) => ({ ...current, z: Math.max(1, value) }))} />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-2">
              <select value={axis} onChange={(event) => setAxis(event.target.value as Axis)} className="col-span-1 bg-black/50 border border-white/10 rounded px-2 text-xs text-white">
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z">Z</option>
              </select>
              <NumberInput label="dX" value={offset.x} onChange={(value) => setOffset((current) => ({ ...current, x: value }))} />
              <NumberInput label="dY" value={offset.y} onChange={(value) => setOffset((current) => ({ ...current, y: value }))} />
              <NumberInput label="dZ" value={offset.z} onChange={(value) => setOffset((current) => ({ ...current, z: value }))} />
            </div>
            <button type="button" onClick={applyToolAtCursor} className="mt-3 w-full py-2 rounded border border-cyan-400/50 bg-cyan-500/20 text-cyan-100 text-[10px] font-black uppercase tracking-widest">
              Apply Tool
            </button>
          </Panel>

          {modelSystem === 'v3' && (
            <Panel title="Smart V3">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={applyV3SmartStart}
                  className="editor-chip border-cyan-400/40 text-cyan-100"
                >
                  Start Shape
                </button>
                {V3_SMART_TOOL_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectV3SmartTool(option.id, option.label)}
                    onMouseEnter={() => setTransientSmartToolId(option.id)}
                    onMouseLeave={() => setTransientSmartToolId(null)}
                    onFocus={() => setTransientSmartToolId(option.id)}
                    onBlur={() => setTransientSmartToolId(null)}
                    aria-pressed={selectedSmartToolId === option.id}
                    className={`editor-chip ${
                      activeSmartToolId === option.id
                        ? 'border-cyan-400/50 text-cyan-100'
                        : selectedSmartToolId === option.id
                          ? 'border-purple-400/45 text-purple-100'
                          : ''
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 rounded border border-white/10 bg-black/35 p-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Strength</span>
                  <select
                    value={smartStrength}
                    onChange={(event) => setSmartStrength(event.target.value as V3SmartAuthoringStrength)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none"
                  >
                    {V3_SMART_STRENGTH_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 rounded border border-white/10 bg-black/35 p-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Stripe Width</span>
                  <input
                    type="number"
                    min={1}
                    value={smartStripeWidth}
                    onChange={(event) => setSmartStripeWidthValue(parseInt(event.target.value || '1', 10))}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none"
                  />
                </label>
                <label className="flex flex-col gap-1 rounded border border-white/10 bg-black/35 p-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Mirror Scope</span>
                  <select
                    value={smartMirrorScope}
                    onChange={(event) => setSmartMirrorScope(event.target.value as V3SmartMirrorScope)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none"
                  >
                    {V3_SMART_MIRROR_SCOPE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <Toggle label="Mirror Overwrite" checked={smartMirrorOverwrite} onChange={setSmartMirrorOverwrite} />
              </div>
              <div className="mt-3 rounded border border-cyan-400/20 bg-cyan-500/10 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-black uppercase tracking-widest text-cyan-100">Smart Tool Preview</span>
                  <span className="text-[10px] font-mono text-white/55">{activeSmartToolLabel}</span>
                </div>
                {v3SmartAuthoringPreview && v3SmartAuthoringFeedback && (
                  <div className="mt-2 flex flex-col gap-1 text-[10px] text-white/60">
                    <div className="flex flex-wrap gap-1.5 font-mono">
                      <span>{formatSignedReadDelta(v3SmartAuthoringFeedback.delta)}</span>
                      <span>{v3SmartAuthoringPreview.added.length} added</span>
                      <span>{v3SmartAuthoringPreview.removed.length} removed</span>
                      <span>{v3SmartAuthoringPreview.remapped.length} remapped</span>
                    </div>
                    <div className="text-white/45">{v3SmartAuthoringFeedback.labels.join(' / ')}</div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={applySelectedV3SmartTool}
                  disabled={!v3SmartAuthoringPreview?.changed}
                  className="mt-2 w-full py-2 rounded border border-cyan-400/50 bg-cyan-500/20 text-cyan-100 text-[10px] font-black uppercase tracking-widest disabled:opacity-35"
                >
                  Apply Smart Tool
                </button>
              </div>
            </Panel>
          )}

          {modelSystem === 'v3' && (
            <Panel title="Motion QA">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 rounded border border-white/10 bg-black/35 p-2">
                  <span className="text-[9px] font-black uppercase tracking-widest text-white/40">Pose Case</span>
                  <select
                    value={selectedV3PoseCaseId}
                    onChange={(event) => setPoseMode(event.target.value as V3PoseClearanceCaseId)}
                    className="bg-black/50 border border-white/10 rounded px-2 py-1 text-xs text-white outline-none"
                  >
                    {V3_POSE_OPTIONS.map((pose) => (
                      <option key={pose.id} value={pose.id}>{pose.label}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
                  <Metric label="Motion" value={v3MotionQaReport ? `${v3MotionQaReport.score}%` : '--'} />
                  <Metric
                    label="Cases"
                    value={v3MotionQaReport ? `${v3MotionQaReport.summary.readyCaseCount}/${v3MotionQaReport.summary.caseCount}` : '--'}
                  />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => runV3MotionQa('active-slot')}
                  className="editor-chip border-cyan-400/40 text-cyan-100"
                >
                  Check Active Pose
                </button>
                <button
                  type="button"
                  onClick={() => runV3MotionQa('full-suit')}
                  className="editor-chip border-purple-400/40 text-purple-100"
                >
                  Check Full Suit
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-1 text-[10px] leading-relaxed">
                {!v3MotionQaReport ? (
                  <span className="text-white/45">Motion QA: run an advisory check for the selected pose or staged suit.</span>
                ) : v3MotionQaIsStale ? (
                  <span className="text-amber-300">Motion QA: report is stale after draft or suit changes.</span>
                ) : (
                  <span className={v3MotionQaReport.ready ? 'text-emerald-300' : 'text-amber-300'}>
                    Motion QA: {v3MotionQaReport.ready
                      ? 'selected armor motion reads clearly.'
                      : v3MotionQaReport.issues[0]?.message ?? 'pose clearance needs review.'}
                  </span>
                )}
                {selectedV3MotionQaCase && !v3MotionQaIsStale && (
                  <span className={selectedV3MotionQaCase.ready ? 'text-emerald-300' : 'text-amber-300'}>
                    Selected pose: {V3_POSE_LABELS[selectedV3PoseCaseId]} {selectedV3MotionQaCase.ready
                      ? 'passed.'
                      : `${selectedV3MotionQaCase.issues.length} advisory issue${selectedV3MotionQaCase.issues.length === 1 ? '' : 's'}.`}
                  </span>
                )}
              </div>
            </Panel>
          )}

          {modelSystem === 'v3' && (
            <Panel title="Motion Fixes">
              <div className="flex flex-col gap-2 text-[10px] leading-relaxed">
                {!freshV3MotionQaReport ? (
                  <span className="text-white/45">
                    Run Motion QA to preview pose-aware fixes such as Clear Limb Overlap.
                  </span>
                ) : freshV3MotionQaReport.ready ? (
                  <span className="text-emerald-300">Motion Fixes: no pose repair is currently needed.</span>
                ) : (
                  <span className="text-amber-300">
                    Motion Fixes: select a repair for the active slot, preview it, then apply it through undoable history.
                  </span>
                )}
                {freshV3MotionQaReport && (
                  <div className="flex flex-col gap-2">
                    {v3MotionRepairActions.map((action) => (
                      <div key={action.id} className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-2 items-start">
                        <button
                          type="button"
                          onClick={() => setSelectedV3MotionRepairActionId(action.id)}
                          disabled={!action.enabled}
                          aria-pressed={selectedV3MotionRepairActionId === action.id}
                          className={`editor-chip text-left disabled:opacity-35 ${
                            selectedV3MotionRepairActionId === action.id && action.enabled
                              ? 'border-cyan-400/50 text-cyan-100'
                              : action.enabled
                                ? 'border-purple-400/40 text-purple-100'
                                : 'border-white/10 text-white/35'
                          }`}
                        >
                          {action.label}
                        </button>
                        <span className={`text-[10px] leading-relaxed ${action.enabled ? 'text-white/55' : 'text-white/35'}`}>
                          {action.reason}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {v3MotionRepairPreview && (
                  <div className="rounded border border-cyan-400/20 bg-cyan-500/10 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black uppercase tracking-widest text-cyan-100">Motion Fix Preview</span>
                      <span className="text-[10px] font-mono text-white/55">{selectedV3MotionRepairLabel}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-white/60">
                      <span>{v3MotionRepairPreview.added.length} added</span>
                      <span>{v3MotionRepairPreview.removed.length} removed</span>
                      <span>{v3MotionRepairPreview.remapped.length} remapped</span>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={applySelectedV3MotionRepair}
                  disabled={!v3MotionRepairPreview?.changed}
                  className="w-full py-2 rounded border border-cyan-400/50 bg-cyan-500/20 text-cyan-100 text-[10px] font-black uppercase tracking-widest disabled:opacity-35"
                >
                  Apply Motion Fix
                </button>
              </div>
            </Panel>
          )}

          {modelSystem === 'v3' && (
            <Panel title="Suit Workspace">
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={startV3SuitWorkspace}
                  className="editor-chip border-cyan-400/40 text-cyan-100"
                >
                  Start Full Suit
                </button>
                <button
                  type="button"
                  onClick={previewV3SuitWorkspace}
                  className="editor-chip border-purple-400/40 text-purple-100"
                >
                  Preview Full Suit
                </button>
                <button
                  type="button"
                  onClick={saveV3SuitWorkspace}
                  className="editor-chip border-emerald-400/40 text-emerald-100"
                >
                  Save & Equip Suit
                </button>
              </div>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-44 overflow-y-auto">
                {V3_SLOT_OPTIONS.map((option) => {
                  const statusLabels = getV3SuitSlotStatusLabels(option.slot);
                  return (
                    <button
                      key={option.slot}
                      type="button"
                      onClick={() => switchSlot(option.slot)}
                      title={option.title}
                      className={`rounded border p-2 text-left ${
                        slot === option.slot
                          ? 'border-cyan-400/50 bg-cyan-500/10'
                          : 'border-white/10 bg-black/25 hover:border-white/20'
                      }`}
                    >
                      <span className="block text-[10px] font-black uppercase tracking-widest text-white/70">{option.label}</span>
                      <span className="mt-1 flex flex-wrap gap-1">
                        {statusLabels.map((label) => (
                          <span
                            key={label}
                            className={`rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest ${getV3SuitSlotStatusClass(label)}`}
                          >
                            {label}
                          </span>
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Panel>
          )}

          {modelSystem === 'v3' && (
            <Panel title="Suit Profiles">
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={saveV3SuitProfile}
                  className="editor-chip border-emerald-400/40 text-emerald-100"
                >
                  Save Suit Profile
                </button>
                <button
                  type="button"
                  onClick={loadV3SuitProfile}
                  disabled={!selectedV3SuitProfile}
                  className="editor-chip border-cyan-400/40 text-cyan-100 disabled:opacity-35"
                >
                  Load Profile
                </button>
                <button
                  type="button"
                  onClick={duplicateV3SuitProfile}
                  disabled={!selectedV3SuitProfile}
                  className="editor-chip disabled:opacity-35"
                >
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedV3SuitProfile}
                  disabled={!selectedV3SuitProfile}
                  className="editor-chip text-red-200 disabled:opacity-35"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={exportSelectedV3SuitProfile}
                  disabled={!selectedV3SuitProfile}
                  className="editor-chip border-purple-400/40 text-purple-100 disabled:opacity-35"
                >
                  Export Profile
                </button>
                <button
                  type="button"
                  onClick={importV3SuitProfile}
                  className="editor-chip border-purple-400/40 text-purple-100"
                >
                  Import Profile
                </button>
              </div>
              {v3SuitProfileCatalog.profiles.length > 0 ? (
                <div className="mt-3 flex flex-col gap-2">
                  <select
                    value={selectedV3SuitProfile?.id ?? ''}
                    onChange={(event) => setSelectedV3SuitProfileId(event.target.value)}
                    className="h-8 bg-black/50 border border-white/10 rounded px-2 text-xs text-white"
                  >
                    {v3SuitProfileCatalog.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.name}</option>
                    ))}
                  </select>
                  {selectedV3SuitProfileValidation && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-black uppercase tracking-widest">
                      <span className="rounded border border-cyan-400/30 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-100">
                        {selectedV3SuitProfileValidation.status}
                      </span>
                      <span className="rounded border border-white/10 bg-black/25 px-1.5 py-0.5 text-white/45">
                        {selectedV3SuitProfileValidation.appliedSlotIds.length} ready
                      </span>
                      {selectedV3SuitProfileValidation.missingSlotIds.length > 0 && (
                        <span className="rounded border border-amber-400/30 bg-amber-500/10 px-1.5 py-0.5 text-amber-100">
                          {selectedV3SuitProfileValidation.missingSlotIds.length} missing
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-3 text-[10px] italic text-white/35">No saved suit profiles.</div>
              )}
            </Panel>
          )}

          <Panel title="Materials">
            <div className="grid grid-cols-2 gap-1.5">
              {MATERIAL_OPTIONS.map((option) => (
                <button
                  key={option.role}
                  type="button"
                  onClick={() => setRole(option.role)}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded border text-[10px] font-black uppercase tracking-widest ${
                    role === option.role ? 'bg-purple-500/20 border-purple-300 text-purple-100' : 'bg-black/30 border-white/10 text-white/45'
                  }`}
                >
                  <span className="w-3 h-3 rounded-sm border border-white/20" style={{ backgroundColor: roleColorPreview[option.role] }} />
                  {option.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <input aria-label="Fixed color picker" type="color" value={fixedColor} onChange={(event) => setFixedColorValue(event.target.value)} className="w-8 h-8 bg-transparent" />
              <input
                aria-label="Fixed color hex"
                value={fixedColorText}
                onChange={(event) => handleFixedColorTextChange(event.target.value)}
                onBlur={() => setFixedColorText(fixedColor)}
                spellCheck={false}
                className="h-8 w-24 rounded border border-white/10 bg-black/35 px-2 font-mono text-[10px] font-black uppercase text-white/70 outline-none focus:border-cyan-400/60"
              />
              <Toggle label="Emissive" checked={emissive} onChange={setEmissive} />
            </div>
          </Panel>

          <Panel title="Validation">
            <div className="grid grid-cols-3 gap-1.5 text-[10px] font-mono">
              <Metric label="Vox" value={validation.stats.voxelCount} />
              <Metric label="Bytes" value={validation.stats.payloadBytes} />
              <Metric label="Isles" value={validation.stats.components} />
              <Metric label="Budget" value={`${editorValidationReport.budgetPercent}%`} />
              <Metric
                label="Built-in Delta"
                value={editorValidationReport.builtInVoxelDelta > 0
                  ? `+${editorValidationReport.builtInVoxelDelta}`
                  : String(editorValidationReport.builtInVoxelDelta)}
              />
              {modelSystem === 'v3' && editorValidationReport.visualQa && (
                <Metric label="Read" value={`${editorValidationReport.visualQa.score}%`} />
              )}
            </div>
            {showPerformance && (
              <div className="mt-2 text-[10px] text-white/45 leading-relaxed">
                Mesh budget estimates use voxel and payload count. Lower disconnected islands improve merge quality.
              </div>
            )}
            <div className="mt-2 max-h-28 overflow-y-auto flex flex-col gap-1">
              {validation.errors.length === 0 ? (
                <span className="text-[10px] text-emerald-300">Piece is save-ready.</span>
              ) : validation.errors.map((error) => (
                <span key={error} className="text-[10px] text-red-300">{error}</span>
              ))}
              {validation.warnings.map((warning) => (
                <span key={warning} className="text-[10px] text-amber-300">{warning}</span>
              ))}
              {modelSystem === 'v3' && editorValidationReport.missingRecommendedRoles.length > 0 && (
                <span className="text-[10px] text-amber-300">
                  Missing roles: {editorValidationReport.missingRecommendedRoles.join(', ')}
                </span>
              )}
              {modelSystem === 'v3' && editorValidationReport.visualQa && (
                <span className={`text-[10px] ${editorValidationReport.visualQa.ready ? 'text-emerald-300' : 'text-amber-300'}`}>
                  Visual QA: {editorValidationReport.visualQa.ready
                    ? 'armor preview reads clearly.'
                    : editorValidationReport.visualQa.issues[0]?.message ?? 'armor preview needs readability polish.'}
                </span>
              )}
              {showClipping && <span className="text-[10px] text-amber-300">Clipping view is heuristic; confirm in rig poses before saving.</span>}
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <button type="button" onClick={() => replaceDraft(centerCustomArmorPiece(draft))} className="editor-chip">Center</button>
              <button type="button" onClick={() => replaceDraft(fitCustomArmorToBounds(draft))} className="editor-chip">Fit</button>
              <button type="button" onClick={() => mutateVoxels(removeFloatingVoxels)} className="editor-chip">No Floating</button>
              <button type="button" onClick={() => replaceDraft(seedCornerAnchor(draft))} className="editor-chip">Seed Anchor</button>
            </div>
            {modelSystem === 'v3' && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-cyan-200">Suggested Fixes</div>
                <div className="flex flex-col gap-2">
                  {v3ArmorEditorPolishActions.map((action) => (
                    <div key={action.id} className="grid grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] gap-2 items-start">
                      <button
                        type="button"
                        onClick={() => applyPolishAction(action.id, action.label)}
                        disabled={!action.enabled}
                        className={`editor-chip text-left disabled:opacity-35 ${
                          action.enabled ? 'border-cyan-400/40 text-cyan-100' : 'border-white/10 text-white/35'
                        }`}
                      >
                        {action.label}
                      </button>
                      <span className={`text-[10px] leading-relaxed ${action.enabled ? 'text-white/55' : 'text-white/35'}`}>
                        {action.reason}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Catalog">
            <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
              {slotPieces.length === 0 ? (
                <span className="text-[10px] text-white/35">No saved {getCustomArmorSlotLabel(slot, modelSystem, modelType).toLowerCase()} pieces.</span>
              ) : slotPieces.map((piece) => (
                <div key={piece.id} className="flex items-center gap-1.5 bg-black/30 border border-purple-500/20 rounded p-1.5">
                  <span className="w-8 shrink-0 rounded bg-purple-500/25 border border-purple-300/25 text-purple-100 text-[9px] font-black text-center py-1">{piece.thumbnail}</span>
                  <button type="button" onClick={() => equipPiece(piece)} className="min-w-0 flex-1 text-left text-[10px] text-white/70 truncate">{piece.name}</button>
                  <button type="button" onClick={() => replaceDraft(createCustomArmorSnapshot(piece))} className="text-[9px] text-cyan-300">Edit</button>
                  {piece.history && piece.history.length > 0 && (
                    <button type="button" onClick={() => restoreHistory(piece, 0)} className="editor-chip">Restore Previous</button>
                  )}
                  <button type="button" onClick={() => deletePiece(piece)} className="text-[9px] text-red-300">Del</button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Import / Export">
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={exportDraft} className="editor-chip">Export JSON</button>
              <button type="button" onClick={importDraft} className="editor-chip">Import JSON</button>
            </div>
            <textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste custom armor JSON" className="mt-2 h-16 w-full resize-none bg-black/50 border border-white/10 rounded p-2 text-[10px] text-white/70 outline-none" />
            {exportText && <textarea readOnly value={exportText} className="mt-2 h-16 w-full resize-none bg-black/50 border border-white/10 rounded p-2 text-[10px] text-purple-100 outline-none" />}
            {onPaintPiece && (
              <button type="button" onClick={onPaintPiece} className="mt-2 w-full py-2 rounded border border-purple-400/45 bg-purple-500/20 text-purple-100 text-[10px] font-black uppercase tracking-widest">
                Paint This Piece
              </button>
            )}
            {status && <div className="mt-2 text-[10px] text-cyan-200">{status}</div>}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function voxelWithinCurrentSlot(
  voxel: CustomArmorVoxel,
  slot: CustomArmorSlot,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem,
  gridScale: 1 | 2 = 1
): boolean {
  const b = getEditorSlotBounds(slot, modelType, modelSystem, gridScale);
  return voxel.x >= b.minX && voxel.x <= b.maxX
    && voxel.y >= b.minY && voxel.y <= b.maxY
    && voxel.z >= b.minZ && voxel.z <= b.maxZ;
}

function buildNeighborDensity(voxels: VoxelData[]): Map<string, number> {
  const keys = new Set(voxels.map((voxel) => `${voxel.x},${voxel.y},${voxel.z}`));
  const density = new Map<string, number>();
  for (const voxel of voxels) {
    const neighbors = [
      `${voxel.x + 1},${voxel.y},${voxel.z}`,
      `${voxel.x - 1},${voxel.y},${voxel.z}`,
      `${voxel.x},${voxel.y + 1},${voxel.z}`,
      `${voxel.x},${voxel.y - 1},${voxel.z}`,
      `${voxel.x},${voxel.y},${voxel.z + 1}`,
      `${voxel.x},${voxel.y},${voxel.z - 1}`,
    ].filter((key) => keys.has(key)).length;
    density.set(`${voxel.x},${voxel.y},${voxel.z}`, neighbors);
  }
  return density;
}

function densityColor(neighborCount: number): string {
  if (neighborCount <= 1) return '#ef4444';
  if (neighborCount <= 3) return '#f59e0b';
  return '#22c55e';
}

function motionOverlayColor(kind: V3PoseClearanceOverlay['kind']): string {
  if (kind === 'part-overlap') return '#fb7185';
  if (kind === 'limb-gap') return '#f59e0b';
  if (kind === 'weapon-grip-drift') return '#a78bfa';
  return '#38bdf8';
}

function createV3MotionOverlayGroup(overlays: readonly V3PoseClearanceOverlay[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'v3-motion-clearance-overlays';

  overlays.forEach((overlay) => {
    const color = motionOverlayColor(overlay.kind);
    overlay.boxes?.forEach((box) => {
      const min = new THREE.Vector3(...box.min);
      const max = new THREE.Vector3(...box.max);
      const size = max.clone().sub(min);
      if (size.x <= 0 || size.y <= 0 || size.z <= 0) return;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x, size.y, size.z),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: overlay.kind === 'part-overlap' ? 0.16 : 0.08,
          wireframe: overlay.kind !== 'part-overlap',
          depthWrite: false,
        })
      );
      mesh.position.copy(min.add(max).multiplyScalar(0.5));
      group.add(mesh);
    });

    if (overlay.line) {
      const from = new THREE.Vector3(...overlay.line.from);
      const to = new THREE.Vector3(...overlay.line.to);
      const delta = to.clone().sub(from);
      const length = delta.length();
      if (length <= 0.0001) return;
      const line = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, length, 8),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false })
      );
      line.position.copy(from.clone().add(to).multiplyScalar(0.5));
      line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      group.add(line);
    }
  });

  return group;
}

function applyPreviewPose(model: THREE.Group, pose: V2PoseMode) {
  const data = model.userData as Record<string, THREE.Group | undefined>;
  if (pose === 'idle') return;
  if (pose === 'crouch') {
    data.leg_upper_l?.rotation.set(-0.9, 0, 0.08);
    data.leg_upper_r?.rotation.set(-0.9, 0, -0.08);
    data.leg_lower_l?.rotation.set(1.15, 0, 0);
    data.leg_lower_r?.rotation.set(1.15, 0, 0);
    data.chest?.rotation.set(0.18, 0, 0);
  } else if (pose === 'walk' || pose === 'sprint') {
    const amp = pose === 'sprint' ? 0.75 : 0.45;
    data.leg_upper_l?.rotation.set(amp, 0, 0);
    data.leg_upper_r?.rotation.set(-amp, 0, 0);
    data.arm_upper_l?.rotation.set(-amp * 0.7, 0, 0);
    data.arm_upper_r?.rotation.set(amp * 0.7, 0, 0);
    data.chest?.rotation.set(pose === 'sprint' ? 0.14 : 0.04, 0, 0);
  } else if (pose === 'hammer') {
    data.arm_upper_r?.rotation.set(-1.0, 0.25, -0.35);
    data.arm_lower_r?.rotation.set(-1.1, 0.15, 0);
    data.arm_upper_l?.rotation.set(-0.55, -0.2, 0.25);
    data.chest?.rotation.set(0, -0.25, 0);
  } else if (pose === 'sword') {
    data.arm_upper_r?.rotation.set(-1.35, 0, -0.25);
    data.arm_lower_r?.rotation.set(-0.7, 0, 0);
    data.leg_upper_l?.rotation.set(-0.55, 0, 0);
    data.leg_upper_r?.rotation.set(0.35, 0, 0);
    data.chest?.rotation.set(0.2, 0, 0);
  }
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
      className={`h-8 rounded border text-[10px] font-black uppercase tracking-widest ${
        checked ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-black/30 border-white/10 text-white/40'
      }`}
    >
      {label}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#38bdf8]">{title}</div>
      {children}
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex items-center gap-1 rounded border border-white/10 bg-black/35 px-1.5 py-1">
      <span className="text-[9px] font-mono text-white/35">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(parseInt(event.target.value || '0', 10))}
        className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none"
      />
    </label>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-white/10 bg-black/35 p-1.5">
      <div className="text-white/35">{label}</div>
      <div className="text-white/80">{value}</div>
    </div>
  );
}
