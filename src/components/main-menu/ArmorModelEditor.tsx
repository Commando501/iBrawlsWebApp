import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  buildVoxelSpartanModel,
  type CharacterLoadout,
  type VoxelData,
} from '../VoxelModels';
import { getVoxelSegmentDataV2 } from '../VoxelModelsV2';
import { buildCombatantRigForModel } from '../grifball/combatantRig';
import {
  CUSTOM_ARMOR_MAX_HISTORY,
  centerCustomArmorPiece,
  createCustomArmorPiece,
  createCustomArmorSnapshot,
  createCustomArmorThumbnail,
  customArmorPieceToVoxels,
  dedupeCustomArmorVoxels,
  duplicateCustomArmorPiece,
  fitCustomArmorToBounds,
  getCustomArmorPieceModelSystem,
  getCustomArmorSlotSpec,
  getCustomArmorSlotLabel,
  removeFloatingVoxels,
  restoreCustomArmorHistoryEntry,
  seedCornerAnchor,
  validateCustomArmorPiece,
  voxelDataToCustomArmorVoxels,
  V3_CUSTOM_ARMOR_SLOTS,
  type CustomArmorCatalog,
  type CustomArmorMaterialRole,
  type CustomArmorModelSystem,
  type CustomArmorPiece,
  type CustomArmorPieceSnapshot,
  type CustomArmorSlot,
  type V2CustomArmorSlot,
  type V3CustomArmorSlot,
  type CustomArmorVoxel,
} from '../customArmor';
import { getV3BuiltinPartVoxels } from '../v3/VoxelModelsV3';
import { getV3CharacterPartBounds } from '../v3/v3PartBounds';
import {
  getCharacterModelCollisionProfile,
  resolveCharacterModelType,
} from '../../characterModelTypes';
import { getV3CharacterPartManifest } from '../v3/v3AssetManifest';
import type { CharacterModelType } from '../../types';
import { buildArmorEditorValidationReport } from './armorEditorValidation';

interface ArmorModelEditorProps {
  catalog: CustomArmorCatalog;
  playerLoadout: CharacterLoadout;
  playerHue: number;
  onCatalogChange: React.Dispatch<React.SetStateAction<CustomArmorCatalog>>;
  onLoadoutChange: (patch: Partial<CharacterLoadout>) => void;
  onClose: () => void;
  onPaintPiece?: () => void;
  layout?: 'embedded' | 'standalone';
}

type EditorTool = 'place' | 'erase' | 'box' | 'line' | 'plane' | 'extrude' | 'move' | 'duplicate' | 'fill';
type Axis = 'x' | 'y' | 'z';
type ViewMode = 'edit' | 'rig';
type PoseMode = 'idle' | 'walk' | 'sprint' | 'crouch' | 'hammer' | 'sword';
type PaintSettings = {
  tool: EditorTool;
  role: CustomArmorMaterialRole;
  fixedColor: string;
  emissive: boolean;
  slot: CustomArmorSlot;
  modelType: CharacterModelType;
  modelSystem: CustomArmorModelSystem;
};
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

const POSE_OPTIONS: Array<{ id: PoseMode; label: string }> = [
  { id: 'idle', label: 'Idle' },
  { id: 'walk', label: 'Walk' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'crouch', label: 'Crouch' },
  { id: 'hammer', label: 'Hammer' },
  { id: 'sword', label: 'Sword' },
];

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
  modelSystem: CustomArmorModelSystem
): EditorBounds {
  if (modelSystem === 'v3') {
    const dimensions = getV3CharacterPartBounds(slot as V3CustomArmorSlot).maxDimensions;
    return {
      minX: 0,
      maxX: dimensions.x - 1,
      minY: 0,
      maxY: dimensions.y - 1,
      minZ: 0,
      maxZ: dimensions.z - 1,
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

const snapshotFromBuiltin = (
  slot: CustomArmorSlot,
  preset: string,
  hue: number,
  modelType: CharacterModelType,
  modelSystem: CustomArmorModelSystem = 'v2',
  name = `${preset} Remix`
): CustomArmorPieceSnapshot => {
  const voxels = modelSystem === 'v3'
    ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, hue)
    : getVoxelSegmentDataV2(getV2SourceSlot(slot), preset, hue, false, modelType);
  const piece = createCustomArmorPiece(
    slot,
    name,
    voxelDataToCustomArmorVoxels(voxels),
    preset,
    modelSystem === 'v2' ? modelType : undefined,
    modelSystem
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

function upsertPieceInCatalog(catalog: CustomArmorCatalog, draft: CustomArmorPieceSnapshot): CustomArmorCatalog {
  const existing = catalog.pieces.find((piece) => piece.id === draft.id);
  const now = Date.now();
  const historyEntry = existing ? createCustomArmorSnapshot(existing) : undefined;
  const draftModelSystem = getCustomArmorPieceModelSystem(draft);
  const nextPiece: CustomArmorPiece = {
    ...draft,
    modelSystem: draftModelSystem,
    modelType: draftModelSystem === 'v2' ? draft.modelType ?? 'medium' : undefined,
    name: draft.name.trim() || `${getCustomArmorSlotLabel(draft.slot, draftModelSystem, draft.modelType ?? 'medium')} Custom`,
    thumbnail: createCustomArmorThumbnail(draft.slot, draft.voxels.length, draftModelSystem),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    history: [
      ...(historyEntry ? [historyEntry] : []),
      ...(existing?.history ?? []),
    ].slice(0, CUSTOM_ARMOR_MAX_HISTORY),
  };
  return {
    version: 1,
    pieces: existing
      ? catalog.pieces.map((piece) => piece.id === draft.id ? nextPiece : piece)
      : [...catalog.pieces, nextPiece],
  };
}

export function ArmorModelEditor({
  catalog,
  playerLoadout,
  playerHue,
  onCatalogChange,
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
    const b = getEditorSlotBounds(slot, initialModelType, initialModelSystem);
    return { x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) };
  });
  const [size, setSize] = useState({ x: 2, y: 2, z: 2 });
  const [offset, setOffset] = useState({ x: 1, y: 0, z: 0 });
  const [undoStack, setUndoStack] = useState<CustomArmorPieceSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CustomArmorPieceSnapshot[]>([]);
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('');
  const [exportText, setExportText] = useState('');
  const [showBounds, setShowBounds] = useState(true);
  const [showSilhouette, setShowSilhouette] = useState(false);
  const [showCollision, setShowCollision] = useState(false);
  const [showDensity, setShowDensity] = useState(false);
  const [showPerformance, setShowPerformance] = useState(true);
  const [showClipping, setShowClipping] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const paintSettingsRef = useRef<PaintSettings>({ tool, role, fixedColor, emissive, slot, modelType, modelSystem });
  const cameraViewsRef = useRef<Record<ViewMode, ArmorEditorCameraView>>(createDefaultCameraViews());

  const validation = useMemo(() => validateCustomArmorPiece(draft), [draft]);
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
  const editorValidationReport = useMemo(() => {
    const builtIn = modelSystem === 'v3'
      ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, playerHue)
      : getVoxelSegmentDataV2(getV2SourceSlot(slot), selectedPreset, playerHue, false, modelType);
    const v3Manifest = modelSystem === 'v3'
      ? getV3CharacterPartManifest(getV3PresetForSlot(slot as V3CustomArmorSlot))
      : undefined;
    const slotBudget = modelSystem === 'v3'
      ? v3Manifest?.budget.sourceVoxelCount ?? validation.stats.voxelCount
      : getCustomArmorSlotSpec(slot, modelType).maxVoxels;

    return buildArmorEditorValidationReport({
      draft,
      validation,
      builtInVoxelCount: builtIn.length,
      slotBudget,
      recommendedRoles: modelSystem === 'v3'
        ? [...(v3Manifest?.paintRoles ?? [])]
        : ['primary', 'secondary', 'accent'],
    });
  }, [draft, modelSystem, modelType, playerHue, selectedPreset, slot, validation]);

  useEffect(() => {
    paintSettingsRef.current = { tool, role, fixedColor, emissive, slot, modelType, modelSystem };
  }, [emissive, fixedColor, modelSystem, modelType, role, slot, tool]);

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
    setDraftWithHistory(() => ({
      ...next,
      slot,
      modelSystem,
      modelType: modelSystem === 'v2' ? modelType : undefined,
      voxels: dedupeCustomArmorVoxels(next.voxels),
    }));
    setSelectedKeys(new Set());
  };

  const switchSlot = (nextSlot: CustomArmorSlot) => {
    setSlot(nextSlot);
    const b = getEditorSlotBounds(nextSlot, modelType, modelSystem);
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    const equipped = getEquippedPieceForType(nextSlot, modelType, modelSystem);
    setDraft(
      equipped
        ? cloneSnapshot(equipped)
        : snapshotFromBuiltin(
          nextSlot,
          modelSystem === 'v3'
            ? getV3PresetForSlot(nextSlot as V3CustomArmorSlot)
            : getDefaultPresetForSlot(nextSlot, playerLoadout),
          playerHue,
          modelType,
          modelSystem
        )
    );
    setUndoStack([]);
    setRedoStack([]);
    setSelectedKeys(new Set());
  };

  const switchModelType = (nextModelType: CharacterModelType) => {
    setModelSystem('v2');
    setModelType(nextModelType);
    onLoadoutChange({ modelSystem: 'v2', modelType: nextModelType });
    const nextSlot = SLOT_OPTIONS.some((option) => option.slot === slot) ? slot : 'helmet';
    setSlot(nextSlot);
    const b = getEditorSlotBounds(nextSlot, nextModelType, 'v2');
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
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
    const b = getEditorSlotBounds(nextSlot, nextModelType, nextModelSystem);
    setCursor({ x: Math.round((b.minX + b.maxX) / 2), y: b.minY, z: Math.round((b.minZ + b.maxZ) / 2) });
    const equipped = getEquippedPieceForType(nextSlot, nextModelType, nextModelSystem);
    setDraft(
      equipped
        ? cloneSnapshot(equipped)
        : snapshotFromBuiltin(
          nextSlot,
          nextModelSystem === 'v3'
            ? getV3PresetForSlot(nextSlot as V3CustomArmorSlot)
            : getDefaultPresetForSlot(nextSlot, playerLoadout),
          playerHue,
          nextModelType,
          nextModelSystem
        )
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
    return voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem));
  };

  const applyToolAtCursor = () => {
    if (tool === 'place') {
      addVoxels([createVoxel(cursor.x, cursor.y, cursor.z, role, fixedColor, emissive)].filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem)));
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
      addVoxels(voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem)));
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
      addVoxels(voxels.filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem)));
    } else if (tool === 'fill') {
      const b = getEditorSlotBounds(slot, modelType, modelSystem);
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
        .filter((voxel) => voxelWithinCurrentSlot(voxel, slot, modelType, modelSystem));
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
    onCatalogChange((current) => upsertPieceInCatalog(current, snapshot));
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
    const scale = 0.045;

    if (viewMode === 'rig') {
      const previewLoadout: CharacterLoadout = {
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
      const model = buildVoxelSpartanModel(false, playerHue, previewLoadout);
      model.position.set(0, 0, 0);
      model.rotation.y = -0.35;
      buildCombatantRigForModel(model);
      applyPreviewPose(model, poseMode);
      scene.add(model);
    } else {
      const b = getEditorSlotBounds(slot, modelType, modelSystem);
      const centerX = (b.minX + b.maxX) / 2;
      const centerY = (b.minY + b.maxY) / 2;
      const centerZ = (b.minZ + b.maxZ) / 2;
      const palette = {
        primary: `hsl(${playerHue}, 85%, 50%)`,
        secondary: '#1e293b',
        accent: `hsl(${playerHue}, 90%, 75%)`,
        visor: `hsl(${playerHue}, 95%, 70%)`,
        dark: '#0f172a',
        highlight: `hsl(${playerHue}, 75%, 65%)`,
      };
      const silhouetteVoxels = showSilhouette
        ? modelSystem === 'v3'
          ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, playerHue)
          : getVoxelSegmentDataV2(getV2SourceSlot(slot), selectedPreset, playerHue, false, modelType)
        : [];

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
              paintSettings.modelSystem
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
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
    };
  }, [
    draft,
    playerHue,
    playerLoadout,
    poseMode,
    selectedKeys,
    selectedPreset,
    modelSystem,
    modelType,
    showBounds,
    showCollision,
    showDensity,
    showSilhouette,
    slot,
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
              {(['edit', 'rig'] as ViewMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`px-2 py-1 rounded border text-[10px] font-black uppercase tracking-widest ${
                    viewMode === mode ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200' : 'bg-black/50 border-white/10 text-white/45'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
            {viewMode === 'rig' && (
              <div className="absolute right-3 top-3 z-10 flex flex-wrap justify-end gap-1.5 max-w-[340px]">
                {POSE_OPTIONS.map((pose) => (
                  <button
                    key={pose.id}
                    type="button"
                    onClick={() => setPoseMode(pose.id)}
                    className={`px-2 py-1 rounded border text-[10px] font-black uppercase tracking-widest ${
                      poseMode === pose.id ? 'bg-purple-500/25 border-purple-300 text-purple-100' : 'bg-black/50 border-white/10 text-white/45'
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
              {showClipping && <span className="text-[10px] text-amber-300">Clipping view is heuristic; confirm in rig poses before saving.</span>}
            </div>
            <div className="grid grid-cols-2 gap-1.5 mt-2">
              <button type="button" onClick={() => replaceDraft(centerCustomArmorPiece(draft))} className="editor-chip">Center</button>
              <button type="button" onClick={() => replaceDraft(fitCustomArmorToBounds(draft))} className="editor-chip">Fit</button>
              <button type="button" onClick={() => mutateVoxels(removeFloatingVoxels)} className="editor-chip">No Floating</button>
              <button type="button" onClick={() => replaceDraft(seedCornerAnchor(draft))} className="editor-chip">Seed Anchor</button>
            </div>
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
  modelSystem: CustomArmorModelSystem
): boolean {
  const b = getEditorSlotBounds(slot, modelType, modelSystem);
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

function applyPreviewPose(model: THREE.Group, pose: PoseMode) {
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
