import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  customArmorPieceToVoxels,
  type CustomArmorColors,
  type CustomArmorPieceSnapshot,
} from '../components/customArmor';
import { buildV3SpartanModel } from '../components/v3/VoxelModelsV3';
import { getV3BuiltinPartVoxelScale } from '../components/v3/v3AegisSuitParts';
import {
  updateV3RigFittedBaseBody,
} from '../components/v3/v3RigFittedBaseBody';
import {
  V3_ARMOR_FOUNDATION,
  generateV3ArmorFromFoundation,
  getV3ArmorFoundationMesh2MotionGeometry,
} from '../components/v3/v3ArmorFoundation';
import { V3_MESH2MOTION_ARMOR_RIG } from '../components/v3/v3Mesh2MotionArmorRig.generated';
import { V3_CHARACTER_SLOT_IDS, type V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import {
  V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
  createV3VoxelArmorGroup,
} from '../components/v3/v3VoxelArmorSurface';
import {
  createV3Mesh2MotionTPoseBindArmorEdit,
  createV3Mesh2MotionTPoseBindSectionRenderPiece,
  measureV3Mesh2MotionTPoseBindVoxelBounds,
  mirrorV3Mesh2MotionTPoseBindTransform,
  resolveV3Mesh2MotionTPoseBindMirrorSlot,
} from './v3Mesh2MotionTPoseBindArmor';
import {
  buildV3Mesh2MotionTPoseBindLocalStorageKey,
  buildV3Mesh2MotionTPoseBindDiagnostics,
  identityV3Mesh2MotionTPoseBindSectionTransform,
  normalizeV3Mesh2MotionTPoseBindDocument,
  normalizeV3Mesh2MotionTPoseBindSectionTransform,
  parseV3Mesh2MotionTPoseBindDocumentJson,
  resolveV3Mesh2MotionTPoseBindEditorHotkey,
  serializeV3Mesh2MotionTPoseBindDocument,
  type V3Mesh2MotionTPoseBindArmorEdit,
  type V3Mesh2MotionTPoseBindArmorSection,
  type V3Mesh2MotionTPoseBindDocument,
  type V3Mesh2MotionTPoseBindPlacement,
  type V3Mesh2MotionTPoseBindSectionTransform,
  type V3Mesh2MotionTPoseBindTransformMode,
} from './v3Mesh2MotionTPoseBindEditorCore';

const SOURCE_HASH = V3_MESH2MOTION_ARMOR_RIG.source.sha256;
const FOUNDATION_HASH = [
  V3_ARMOR_FOUNDATION.source.exactObjSurfaceHash,
  V3_ARMOR_FOUNDATION.source.referenceSourceBindSha256,
  V3_ARMOR_FOUNDATION.source.referenceLimbVoxelSha256,
].join(':');
const LOCAL_STORAGE_KEY = buildV3Mesh2MotionTPoseBindLocalStorageKey(SOURCE_HASH, FOUNDATION_HASH);
const MANNEQUIN_REVIEW_QUERY = '?view=front&review=mannequin';
const EDITOR_CUSTOM_ARMOR_COLORS: CustomArmorColors = {
  primary: 'hsl(188, 86%, 50%)',
  secondary: 'hsl(188, 58%, 34%)',
  accent: 'hsl(236, 82%, 58%)',
  visor: 'hsl(188, 95%, 74%)',
  dark: '#2f3f52',
  highlight: 'hsl(188, 72%, 68%)',
};

type BindEditorDebugView = 'front' | 'left' | 'right' | 'rear';
type BindEditorReviewMode = 'mannequin' | 'ghost' | 'armor';
type BindEditorTransformScope = 'piece' | 'section';

const parseReviewMode = (value: string | null): BindEditorReviewMode => {
  if (value === 'mannequin' || value === 'mannequin-only') return 'mannequin';
  if (value === 'ghost' || value === 'armor-ghost') return 'ghost';
  if (value === 'armor' || value === 'armor-visible') return 'armor';
  return 'ghost';
};

const parseDebugView = (value: string | null): BindEditorDebugView | null => {
  if (value === 'front' || value === 'left' || value === 'right' || value === 'rear') return value;
  if (value === 'side') return 'right';
  return null;
};

const searchParams = new URLSearchParams(window.location.search);

const canvas = document.getElementById('bind-canvas') as HTMLCanvasElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const slotSelect = document.getElementById('slot-select') as HTMLSelectElement;
const armorSlotMenuButton = document.getElementById('armor-slot-menu-button') as HTMLButtonElement;
const armorSlotMenu = document.getElementById('armor-slot-menu') as HTMLDivElement;
const armorSlotOptions = document.getElementById('armor-slot-options') as HTMLDivElement;
const armorSelectionSummary = document.getElementById('armor-selection-summary') as HTMLPreElement;
const regenerateArmorButton = document.getElementById('regenerate-armor') as HTMLButtonElement;
const transformScopeButtons: Record<BindEditorTransformScope, HTMLButtonElement> = {
  piece: document.getElementById('transform-scope-piece') as HTMLButtonElement,
  section: document.getElementById('transform-scope-section') as HTMLButtonElement,
};
const mirrorTransformModeButton = document.getElementById('mirror-transform-mode') as HTMLButtonElement;
const reviewButtons: Record<BindEditorReviewMode, HTMLButtonElement> = {
  mannequin: document.getElementById('review-mannequin-only') as HTMLButtonElement,
  ghost: document.getElementById('review-armor-ghost') as HTMLButtonElement,
  armor: document.getElementById('review-armor-visible') as HTMLButtonElement,
};
const toggleSkeletonLinesButton = document.getElementById('toggle-skeleton-lines') as HTMLButtonElement;
const toggleSlotPivotsButton = document.getElementById('toggle-slot-pivots') as HTMLButtonElement;
const toggleFingerJointsButton = document.getElementById('toggle-finger-joints') as HTMLButtonElement;
const saveLocalButton = document.getElementById('save-local') as HTMLButtonElement;
const copyJsonButton = document.getElementById('copy-json') as HTMLButtonElement;
const downloadJsonButton = document.getElementById('download-json') as HTMLButtonElement;
const importJsonButton = document.getElementById('import-json') as HTMLButtonElement;
const chooseJsonButton = document.getElementById('choose-json') as HTMLButtonElement;
const clearLocalButton = document.getElementById('clear-local') as HTMLButtonElement;
const resetSelectedButton = document.getElementById('reset-selected') as HTMLButtonElement;
const resetAllButton = document.getElementById('reset-all') as HTMLButtonElement;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const transformButtons: Record<V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement> = {
  translate: document.getElementById('transform-translate') as HTMLButtonElement,
  rotate: document.getElementById('transform-rotate') as HTMLButtonElement,
  scale: document.getElementById('transform-scale') as HTMLButtonElement,
};
const positionInputs = [
  document.getElementById('slot-x') as HTMLInputElement,
  document.getElementById('slot-y') as HTMLInputElement,
  document.getElementById('slot-z') as HTMLInputElement,
] as const;
const rotationInputs = [
  document.getElementById('slot-rx') as HTMLInputElement,
  document.getElementById('slot-ry') as HTMLInputElement,
  document.getElementById('slot-rz') as HTMLInputElement,
] as const;
const scaleInputs = [
  document.getElementById('slot-sx') as HTMLInputElement,
  document.getElementById('slot-sy') as HTMLInputElement,
  document.getElementById('slot-sz') as HTMLInputElement,
] as const;
const selectedSummaryElement = document.getElementById('selected-summary') as HTMLPreElement;
const sectionButtonsElement = document.getElementById('section-buttons') as HTMLDivElement;
const diagnosticsElement = document.getElementById('diagnostics') as HTMLPreElement;
const jsonOutput = document.getElementById('json-output') as HTMLTextAreaElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x061116, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 80);
camera.position.set(1.8, 1.45, 3.2);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.9, 0);

let reviewMode: BindEditorReviewMode = parseReviewMode(searchParams.get('review'));
let showSkeletonLines = true;
let showSlotPivots = true;
let showFingerJoints = true;

const MESH2MOTION_SLOT_SKELETON_LINKS = [
  ['pelvis', 'chest'],
  ['chest', 'neck'],
  ['neck', 'helmet'],
  ['chest', 'back'],
  ['chest', 'shoulderLeft'],
  ['shoulderLeft', 'upperArmLeft'],
  ['upperArmLeft', 'forearmLeft'],
  ['forearmLeft', 'handLeft'],
  ['chest', 'shoulderRight'],
  ['shoulderRight', 'upperArmRight'],
  ['upperArmRight', 'forearmRight'],
  ['forearmRight', 'handRight'],
  ['pelvis', 'thighLeft'],
  ['thighLeft', 'shinLeft'],
  ['shinLeft', 'footLeft'],
  ['pelvis', 'thighRight'],
  ['thighRight', 'shinRight'],
  ['shinRight', 'footRight'],
] as const satisfies readonly (readonly [V3CharacterSlotId, V3CharacterSlotId])[];

const setDebugCameraView = (view: BindEditorDebugView): void => {
  const target = controls.target;
  const distance = Math.max(2.6, camera.position.distanceTo(target));
  const height = 0.55;
  const views: Record<BindEditorDebugView, THREE.Vector3> = {
    front: new THREE.Vector3(0, height, distance),
    rear: new THREE.Vector3(0, height, -distance),
    left: new THREE.Vector3(-distance, height, 0),
    right: new THREE.Vector3(distance, height, 0),
  };
  camera.position.copy(target).add(views[view]);
  controls.update();
};

(window as typeof window & {
  __v3Mesh2MotionBindEditorDebug?: {
    setView: (view: BindEditorDebugView) => void;
    setReviewMode: (mode: BindEditorReviewMode) => void;
    mannequinReviewQuery: string;
  };
}).__v3Mesh2MotionBindEditorDebug = {
  setView: setDebugCameraView,
  setReviewMode,
  mannequinReviewQuery: MANNEQUIN_REVIEW_QUERY,
};

const requestedDebugView = parseDebugView(searchParams.get('view'));
if (requestedDebugView) {
  setDebugCameraView(requestedDebugView);
}

scene.add(new THREE.HemisphereLight(0xdff9ff, 0x13242c, 1.55));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.25);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.85);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const floor = new THREE.GridHelper(4, 16, 0x2a4b55, 0x173038);
floor.position.y = -0.02;
scene.add(floor);

const model = buildV3SpartanModel({
  isEnemy: false,
  customHue: 188,
  v3QualityTier: 'desktop',
  v3Distance: 0,
  v3SourceFidelity: 'exact',
});
scene.add(model);
const skeletonRoot = model.userData.v3Mesh2MotionSkeletonRoot as THREE.Group | undefined;
if (skeletonRoot) skeletonRoot.visible = false;

const slotPivots = model.userData.v3PartGroups as Record<V3CharacterSlotId, THREE.Group>;
const geometryGroups = model.userData.v3PartGeometryGroups as Record<V3CharacterSlotId, THREE.Group>;
const originalSlotChildren = Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => [
  slot,
  [...geometryGroups[slot].children],
])) as Record<V3CharacterSlotId, THREE.Object3D[]>;
const sectionGroups = new Map<string, THREE.Group>();
const sectionOverlayMeshes = new Map<string, THREE.Mesh[]>();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let transformScope: BindEditorTransformScope = 'piece';
let mirrorTransformMode = false;
let isDraggingTransform = false;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSpace('local');
scene.add(transformControls.getHelper());
transformControls.addEventListener('dragging-changed', (event) => {
  isDraggingTransform = (event as { value?: boolean }).value === true;
  controls.enabled = !isDraggingTransform;
  if (!isDraggingTransform) {
    if (transformScope === 'section') captureSelectedSectionTransform();
    else captureSelectedTransform();
  }
});
transformControls.addEventListener('objectChange', () => {
  if (transformScope === 'section') {
    if (isDraggingTransform) previewSelectedSectionTransform();
    else captureSelectedSectionTransform();
  } else {
    if (isDraggingTransform) previewSelectedPieceTransform();
    else captureSelectedTransform();
  }
});

const skeletonLines = (() => {
  const values: number[] = [];
  model.updateWorldMatrix(true, true);
  for (const [fromSlot, toSlot] of MESH2MOTION_SLOT_SKELETON_LINKS) {
    const from = slotPivots[fromSlot].getWorldPosition(new THREE.Vector3());
    const to = slotPivots[toSlot].getWorldPosition(new THREE.Vector3());
    values.push(...from.toArray(), ...to.toArray());
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(values, 3));
  const lines = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.72, depthTest: false })
  );
  lines.renderOrder = 20;
  return lines;
})();
scene.add(skeletonLines);

const slotMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false });
const slotMarkers: THREE.Mesh[] = [];
for (const slot of V3_CHARACTER_SLOT_IDS) {
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 8), slotMarkerMaterial);
  marker.name = `v3Mesh2MotionTPoseSlotMarker:${slot}`;
  marker.renderOrder = 25;
  slotPivots[slot].add(marker);
  slotMarkers.push(marker);
}

const isFingerJointName = (jointName: string): boolean =>
  jointName === 'hand_l' ||
  jointName === 'hand_r' ||
  /^(thumb|index|middle|ring|pinky)_0[1-3]_[lr]$/.test(jointName);

const fingerJointMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xf472b6, depthTest: false });
const fingerJointMarkers: THREE.Mesh[] = [];
const mesh2MotionJoints = model.userData.v3Mesh2MotionJoints as
  | Record<string, { object?: THREE.Object3D }>
  | undefined;
for (const [jointName, joint] of Object.entries(mesh2MotionJoints ?? {})) {
  if (!isFingerJointName(jointName) || !(joint.object instanceof THREE.Object3D)) continue;
  const marker = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 6), fingerJointMarkerMaterial);
  marker.name = `v3Mesh2MotionTPoseFingerJointMarker:${jointName}`;
  marker.renderOrder = 26;
  joint.object.add(marker);
  fingerJointMarkers.push(marker);
}

const ghostMaterial = (material: THREE.Material): THREE.Material => {
  const clone = material.clone();
  clone.transparent = true;
  clone.opacity = Math.min(material.opacity, 0.28);
  clone.depthWrite = false;
  return clone;
};

const getGhostMaterial = (mesh: THREE.Mesh): THREE.Material | THREE.Material[] => {
  const userData = mesh.userData as {
    v3BindEditorOriginalMaterial?: THREE.Material | THREE.Material[];
    v3BindEditorGhostMaterial?: THREE.Material | THREE.Material[];
  };
  if (!userData.v3BindEditorOriginalMaterial) {
    userData.v3BindEditorOriginalMaterial = mesh.material;
  }
  if (!userData.v3BindEditorGhostMaterial) {
    userData.v3BindEditorGhostMaterial = Array.isArray(userData.v3BindEditorOriginalMaterial)
      ? userData.v3BindEditorOriginalMaterial.map(ghostMaterial)
      : ghostMaterial(userData.v3BindEditorOriginalMaterial);
  }
  return userData.v3BindEditorGhostMaterial;
};

const restoreOriginalMaterial = (mesh: THREE.Mesh): void => {
  const original = (mesh.userData as { v3BindEditorOriginalMaterial?: THREE.Material | THREE.Material[] })
    .v3BindEditorOriginalMaterial;
  if (original) mesh.material = original;
};

const setArmorReviewMaterial = (ghosted: boolean): void => {
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    geometryGroups[slot].traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      if (object.userData.v3BindEditorSectionOverlay) return;
      if (ghosted) {
        object.material = getGhostMaterial(object);
      } else {
        restoreOriginalMaterial(object);
      }
    });
  }
};

const updateReviewButtons = (): void => {
  for (const [mode, button] of Object.entries(reviewButtons) as [BindEditorReviewMode, HTMLButtonElement][]) {
    button.classList.toggle('active', mode === reviewMode);
  }
  toggleSkeletonLinesButton.classList.toggle('active', showSkeletonLines);
  toggleSlotPivotsButton.classList.toggle('active', showSlotPivots);
  toggleFingerJointsButton.classList.toggle('active', showFingerJoints);
};

const applyReviewVisibility = (): void => {
  const armorVisible = reviewMode !== 'mannequin';
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    geometryGroups[slot].visible = armorVisible;
  }
  setArmorReviewMaterial(reviewMode === 'ghost');
  const baseBody = model.userData.v3RigFittedBaseBody as { root?: THREE.Group } | undefined;
  if (baseBody?.root) baseBody.root.visible = true;
  skeletonLines.visible = showSkeletonLines;
  for (const marker of slotMarkers) marker.visible = showSlotPivots;
  for (const marker of fingerJointMarkers) marker.visible = showFingerJoints;
  updateReviewButtons();
};

function setReviewMode(mode: BindEditorReviewMode): void {
  reviewMode = mode;
  applyReviewVisibility();
}

const generatedDocument = (): V3Mesh2MotionTPoseBindDocument => normalizeV3Mesh2MotionTPoseBindDocument({
  source: { meshHash: SOURCE_HASH, authoringSpace: 'mesh2motion-native-v3' },
  selectedSlot: 'helmet',
  placements: Object.fromEntries(V3_CHARACTER_SLOT_IDS.map((slot) => {
    const resolvedPlacement = geometryGroups[slot].userData.v3ResolvedMannequinFitPlacement as
      | { position?: readonly number[]; rotation?: readonly number[]; scale?: readonly number[] }
      | undefined;
    const placement = resolvedPlacement ?? getV3ArmorFoundationMesh2MotionGeometry(slot);
    return [slot, {
      slot,
      position: placement.position,
      rotation: placement.rotation,
      scale: placement.scale,
    }];
  })),
});

let referenceDocumentCache: V3Mesh2MotionTPoseBindDocument | null = null;
const referenceDocument = (): V3Mesh2MotionTPoseBindDocument => {
  referenceDocumentCache ??= generatedDocument();
  return referenceDocumentCache;
};

const sourceForCurrentMesh = (
  source: V3Mesh2MotionTPoseBindDocument['source']
): V3Mesh2MotionTPoseBindDocument['source'] => ({
  ...source,
  meshHash: SOURCE_HASH,
  authoringSpace: 'mesh2motion-native-v3',
});

const sourceClearingMissingSlot = (
  slot: V3CharacterSlotId
): V3Mesh2MotionTPoseBindDocument['source'] => {
  const remaining = bindDocument.source.missingPlacementSlots?.filter((candidate) => candidate !== slot) ?? [];
  return remaining.length > 0
    ? { ...bindDocument.source, missingPlacementSlots: remaining }
    : {
      meshHash: bindDocument.source.meshHash,
      authoringSpace: 'mesh2motion-native-v3',
    };
};

const loadInitialDocument = (): V3Mesh2MotionTPoseBindDocument => {
  const stored = window.localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!stored) return generatedDocument();
  try {
    const parsed = parseV3Mesh2MotionTPoseBindDocumentJson(stored);
    return normalizeV3Mesh2MotionTPoseBindDocument({
      ...parsed,
      source: sourceForCurrentMesh(parsed.source),
    });
  } catch {
    return generatedDocument();
  }
};

let bindDocument = loadInitialDocument();
let transformMode: V3Mesh2MotionTPoseBindTransformMode = 'translate';

const tupleFromInputs = (inputs: readonly HTMLInputElement[]): [number, number, number] => [
  Number(inputs[0].value),
  Number(inputs[1].value),
  Number(inputs[2].value),
];

const setTupleInputs = (inputs: readonly HTMLInputElement[], value: readonly number[]): void => {
  for (let index = 0; index < inputs.length; index += 1) {
    inputs[index].value = String(Number((value[index] ?? 0).toFixed(6)));
  }
};

const applyPlacementToSlot = (slot: V3CharacterSlotId, placement: V3Mesh2MotionTPoseBindPlacement): void => {
  const geometry = geometryGroups[slot];
  geometry.position.fromArray(placement.position);
  geometry.rotation.set(...placement.rotation, 'XYZ');
  geometry.scale.fromArray(placement.scale);
};

const sectionMapKey = (slot: V3CharacterSlotId, sectionId: string): string => `${slot}:${sectionId}`;

const sectionCenterPosition = (group: THREE.Group): THREE.Vector3 => {
  const center = group.userData.v3BindEditorSectionRenderCenter as readonly number[] | undefined;
  const voxelScale = group.userData.v3BindEditorVoxelScale as number | undefined;
  return new THREE.Vector3(
    center?.[0] ?? 0,
    center?.[1] ?? 0,
    center?.[2] ?? 0
  ).multiplyScalar(Number.isFinite(voxelScale) ? voxelScale ?? 1 : 1);
};

const applySectionTransformToGroup = (
  group: THREE.Group,
  transform: V3Mesh2MotionTPoseBindSectionTransform
): void => {
  group.position.copy(sectionCenterPosition(group)).add(new THREE.Vector3(...transform.position));
  group.rotation.set(...transform.rotation, 'XYZ');
  group.scale.fromArray(transform.scale);
};

const captureSectionTransformFromGroup = (
  group: THREE.Group,
  sectionId: string
): V3Mesh2MotionTPoseBindSectionTransform => ({
  sectionId,
  position: group.position.clone().sub(sectionCenterPosition(group)).toArray() as [number, number, number],
  rotation: [group.rotation.x, group.rotation.y, group.rotation.z],
  scale: group.scale.toArray() as [number, number, number],
});

const clearRenderedSectionMaps = (slot: V3CharacterSlotId): void => {
  for (const key of [...sectionGroups.keys()]) {
    if (key.startsWith(`${slot}:`)) sectionGroups.delete(key);
  }
  for (const key of [...sectionOverlayMeshes.keys()]) {
    if (key.startsWith(`${slot}:`)) sectionOverlayMeshes.delete(key);
  }
};

const mirrorPlacementFromReference = (
  slot: V3CharacterSlotId,
  placement: V3Mesh2MotionTPoseBindPlacement
): V3Mesh2MotionTPoseBindPlacement | null => {
  const mirrorSlot = resolveV3Mesh2MotionTPoseBindMirrorSlot(slot);
  if (!mirrorSlot) return null;
  const reference = referenceDocument();
  const base = reference.placements[slot];
  const mirrorBase = reference.placements[mirrorSlot];
  if (!base || !mirrorBase) return null;
  const scaleRatio = placement.scale.map((value, index) => {
    const baseValue = base.scale[index] ?? 1;
    return Math.abs(baseValue) > 0.000001 ? value / baseValue : value;
  });
  return {
    slot: mirrorSlot,
    position: [
      mirrorBase.position[0] - (placement.position[0] - base.position[0]),
      mirrorBase.position[1] + (placement.position[1] - base.position[1]),
      mirrorBase.position[2] + (placement.position[2] - base.position[2]),
    ],
    rotation: [
      mirrorBase.rotation[0] + (placement.rotation[0] - base.rotation[0]),
      mirrorBase.rotation[1] - (placement.rotation[1] - base.rotation[1]),
      mirrorBase.rotation[2] - (placement.rotation[2] - base.rotation[2]),
    ],
    scale: [
      mirrorBase.scale[0] * (scaleRatio[0] ?? 1),
      mirrorBase.scale[1] * (scaleRatio[1] ?? 1),
      mirrorBase.scale[2] * (scaleRatio[2] ?? 1),
    ],
  };
};

const restoreSlotGeometry = (slot: V3CharacterSlotId): void => {
  const geometry = geometryGroups[slot];
  geometry.clear();
  geometry.add(...originalSlotChildren[slot]);
  clearRenderedSectionMaps(slot);
};

const createSectionRenderGroup = (
  edit: V3Mesh2MotionTPoseBindArmorEdit,
  section: V3Mesh2MotionTPoseBindArmorSection,
  selected: boolean
): THREE.Group => {
  const voxelScale = getV3BuiltinPartVoxelScale(edit.slot);
  const sectionPiece = createV3Mesh2MotionTPoseBindSectionRenderPiece(edit.piece, section);
  const renderBounds = measureV3Mesh2MotionTPoseBindVoxelBounds(sectionPiece.voxels);
  const renderGroup = createV3VoxelArmorGroup(customArmorPieceToVoxels(sectionPiece, EDITOR_CUSTOM_ARMOR_COLORS), {
    ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
    voxelScale,
    renderStyle: 'armorSurface',
    qualityTier: 'desktop',
    pivot: renderBounds.center,
  });
  renderGroup.name = `v3Mesh2MotionRegeneratedSection:${edit.slot}:${section.id}`;
  renderGroup.userData.v3BindEditorArmorSection = section.id;
  renderGroup.userData.v3BindEditorArmorSlot = edit.slot;
  renderGroup.userData.v3BindEditorSectionRenderCenter = renderBounds.center;
  renderGroup.userData.v3BindEditorVoxelScale = voxelScale;

  const overlayGroup = createV3VoxelArmorGroup(customArmorPieceToVoxels(sectionPiece, EDITOR_CUSTOM_ARMOR_COLORS), {
    ...V3_ARMOR_SURFACE_DEFAULT_OPTIONS,
    voxelScale,
    renderStyle: 'armorSurface',
    qualityTier: 'desktop',
    pivot: renderBounds.center,
  });
  overlayGroup.name = `v3Mesh2MotionRegeneratedSectionOverlay:${edit.slot}:${section.id}`;
  const overlayMaterial = new THREE.MeshBasicMaterial({
    color: selected ? 0xfacc15 : 0x67e8f9,
    wireframe: true,
    transparent: true,
    opacity: selected ? 0.92 : 0.34,
    depthTest: false,
  });
  const overlayMeshes: THREE.Mesh[] = [];
  overlayGroup.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = overlayMaterial;
    object.renderOrder = selected ? 42 : 38;
    object.userData.v3BindEditorSectionOverlay = true;
    object.userData.v3BindEditorArmorSection = section.id;
    object.userData.v3BindEditorArmorSlot = edit.slot;
    overlayMeshes.push(object);
  });
  renderGroup.add(overlayGroup);
  sectionOverlayMeshes.set(sectionMapKey(edit.slot, section.id), overlayMeshes);

  return renderGroup;
};

const activeArmorEdit = (): V3Mesh2MotionTPoseBindArmorEdit | undefined =>
  bindDocument.armorEdits[selectedSlot()];

const activeSectionIds = (): string[] => {
  const edit = activeArmorEdit();
  if (!edit) return [];
  const available = new Set(edit.sections.map((section) => section.id));
  return bindDocument.selectedSectionIds.filter((sectionId) => available.has(sectionId));
};

const firstActiveSection = (): V3Mesh2MotionTPoseBindArmorSection | null => {
  const edit = activeArmorEdit();
  const firstId = activeSectionIds()[0];
  return edit?.sections.find((section) => section.id === firstId) ?? null;
};

const sectionTransformForInputs = (): V3Mesh2MotionTPoseBindSectionTransform => {
  const edit = activeArmorEdit();
  const section = firstActiveSection();
  if (!edit || !section) return identityV3Mesh2MotionTPoseBindSectionTransform('section');
  return edit.sectionTransforms[section.id] ?? identityV3Mesh2MotionTPoseBindSectionTransform(section.id);
};

const selectedSectionGroup = (): THREE.Group | null => {
  const firstId = activeSectionIds()[0];
  if (!firstId) return null;
  return sectionGroups.get(sectionMapKey(selectedSlot(), firstId)) ?? null;
};

const renderArmorSlot = (slot: V3CharacterSlotId): void => {
  const edit = bindDocument.armorEdits[slot];
  if (!edit) {
    restoreSlotGeometry(slot);
    return;
  }

  const geometry = geometryGroups[slot];
  const selectedIds = slot === selectedSlot() ? new Set(activeSectionIds()) : new Set<string>();
  geometry.clear();
  clearRenderedSectionMaps(slot);
  for (const section of edit.sections) {
    const selected = selectedIds.has(section.id);
    const sectionGroup = createSectionRenderGroup(edit, section, selected);
    const transform = edit.sectionTransforms[section.id] ?? identityV3Mesh2MotionTPoseBindSectionTransform(section.id);
    applySectionTransformToGroup(sectionGroup, transform);
    sectionGroups.set(sectionMapKey(slot, section.id), sectionGroup);
    geometry.add(sectionGroup);
  }
};

const applyDocumentToModel = (): void => {
  for (const slot of V3_CHARACTER_SLOT_IDS) {
    renderArmorSlot(slot);
    applyPlacementToSlot(slot, bindDocument.placements[slot]);
  }
  model.updateWorldMatrix(true, true);
  updateV3RigFittedBaseBody(model, true);
  applyReviewVisibility();
};

const selectedSlot = (): V3CharacterSlotId => bindDocument.selectedSlot;

const selectedGeometry = (): THREE.Group => geometryGroups[selectedSlot()];

const refreshSlotSelect = (): void => {
  slotSelect.replaceChildren(...V3_CHARACTER_SLOT_IDS.map((slot) => {
    const option = document.createElement('option');
    option.value = slot;
    option.textContent = slot;
    option.selected = slot === selectedSlot();
    return option;
  }));
};

const refreshArmorRegenerationControls = (): void => {
  const selected = new Set(bindDocument.selectedArmorSlots);
  armorSlotOptions.replaceChildren(...V3_CHARACTER_SLOT_IDS.map((slot) => {
    const label = document.createElement('label');
    label.className = 'check-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(slot);
    checkbox.addEventListener('change', () => {
      const nextSelected = new Set(bindDocument.selectedArmorSlots);
      if (checkbox.checked) nextSelected.add(slot);
      else nextSelected.delete(slot);
      bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
        ...bindDocument,
        selectedArmorSlots: V3_CHARACTER_SLOT_IDS.filter((candidate) => nextSelected.has(candidate)),
      });
      refreshArmorRegenerationControls();
      refreshDiagnosticsAndJson();
    });
    const text = document.createElement('span');
    text.textContent = slot;
    label.append(checkbox, text);
    return label;
  }));
  const selectedSlots = bindDocument.selectedArmorSlots;
  armorSlotMenuButton.textContent = selectedSlots.length > 0
    ? `${selectedSlots.length} slot${selectedSlots.length === 1 ? '' : 's'} selected`
    : `Use current slot: ${selectedSlot()}`;
  armorSelectionSummary.textContent = selectedSlots.length > 0
    ? selectedSlots.join('\n')
    : `current slot\n${selectedSlot()}`;
};

const setSelectedSection = (sectionId: string, additive: boolean): void => {
  const edit = activeArmorEdit();
  if (!edit || !edit.sections.some((section) => section.id === sectionId)) return;
  const next = new Set(additive ? activeSectionIds() : []);
  if (additive && next.has(sectionId)) next.delete(sectionId);
  else next.add(sectionId);
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    selectedSectionIds: [...next],
  });
  transformScope = 'section';
  refreshAll();
};

const refreshSectionButtons = (): void => {
  const edit = activeArmorEdit();
  if (!edit) {
    const empty = document.createElement('pre');
    empty.className = 'section-state';
    empty.textContent = 'No regenerated armor for this slot.';
    sectionButtonsElement.replaceChildren(empty);
    return;
  }
  const selectedIds = new Set(activeSectionIds());
  sectionButtonsElement.replaceChildren(...edit.sections.map((section) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${section.label} (${section.bounds.voxelCount})`;
    button.classList.toggle('active', selectedIds.has(section.id));
    button.addEventListener('click', (event) => setSelectedSection(section.id, (event as MouseEvent).shiftKey));
    return button;
  }));
};

const syncInputsFromDocument = (): void => {
  if (transformScope === 'section') {
    const sectionTransform = sectionTransformForInputs();
    setTupleInputs(positionInputs, sectionTransform.position);
    setTupleInputs(rotationInputs, sectionTransform.rotation);
    setTupleInputs(scaleInputs, sectionTransform.scale);
    return;
  }
  const placement = bindDocument.placements[selectedSlot()];
  setTupleInputs(positionInputs, placement.position);
  setTupleInputs(rotationInputs, placement.rotation);
  setTupleInputs(scaleInputs, placement.scale);
};

const updateTransformButtons = (): void => {
  for (const [mode, button] of Object.entries(transformButtons) as [V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement][]) {
    button.classList.toggle('active', mode === transformMode);
  }
  for (const [scope, button] of Object.entries(transformScopeButtons) as [BindEditorTransformScope, HTMLButtonElement][]) {
    button.classList.toggle('active', scope === transformScope);
  }
  mirrorTransformModeButton.classList.toggle('active', mirrorTransformMode);
  transformControls.setMode(transformMode);
};

const updateTransformAttachment = (): void => {
  transformControls.detach();
  if (transformScope === 'section') {
    const sectionTarget = selectedSectionGroup();
    if (sectionTarget) transformControls.attach(sectionTarget);
    return;
  }
  transformControls.attach(selectedGeometry());
};

const setTransformScope = (scope: BindEditorTransformScope): void => {
  transformScope = scope;
  syncInputsFromDocument();
  updateTransformButtons();
  updateTransformAttachment();
  refreshDiagnosticsAndJson();
};

const setSelectedSlot = (slot: V3CharacterSlotId): void => {
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    selectedSlot: slot,
  });
  refreshAll();
};

const updateSelectedPlacement = (placement: Partial<V3Mesh2MotionTPoseBindPlacement>): void => {
  const slot = selectedSlot();
  const nextPlacement = {
    ...bindDocument.placements[slot],
    ...placement,
    slot,
  };
  const mirroredPlacement = mirrorTransformMode
    ? mirrorPlacementFromReference(slot, nextPlacement)
    : null;
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    placements: {
      ...bindDocument.placements,
      [slot]: nextPlacement,
      ...(mirroredPlacement ? { [mirroredPlacement.slot]: mirroredPlacement } : {}),
    },
    source: sourceClearingMissingSlot(slot),
  });
  applyDocumentToModel();
};

function captureSelectedTransform(): void {
  const geometry = selectedGeometry();
  updateSelectedPlacement({
    position: geometry.position.toArray() as [number, number, number],
    rotation: [geometry.rotation.x, geometry.rotation.y, geometry.rotation.z],
    scale: geometry.scale.toArray() as [number, number, number],
  });
  syncInputsFromDocument();
  refreshDiagnosticsAndJson();
}

function previewSelectedPieceTransform(): void {
  if (!mirrorTransformMode) return;
  const slot = selectedSlot();
  const mirroredPlacement = mirrorPlacementFromReference(slot, {
    slot,
    position: selectedGeometry().position.toArray() as [number, number, number],
    rotation: [selectedGeometry().rotation.x, selectedGeometry().rotation.y, selectedGeometry().rotation.z],
    scale: selectedGeometry().scale.toArray() as [number, number, number],
  });
  if (mirroredPlacement) applyPlacementToSlot(mirroredPlacement.slot, mirroredPlacement);
}

function previewSelectedSectionTransform(): void {
  const edit = activeArmorEdit();
  const section = firstActiveSection();
  const group = selectedSectionGroup();
  if (!edit || !section || !group) return;
  const selectedIds = activeSectionIds();
  const transform = normalizeV3Mesh2MotionTPoseBindSectionTransform(
    captureSectionTransformFromGroup(group, section.id),
    section.id
  );

  for (const sectionId of selectedIds) {
    const target = sectionGroups.get(sectionMapKey(edit.slot, sectionId));
    if (!target) continue;
    applySectionTransformToGroup(target, {
      ...transform,
      sectionId,
    });
  }

  if (!mirrorTransformMode) return;
  const mirrorSlot = resolveV3Mesh2MotionTPoseBindMirrorSlot(edit.slot);
  const mirrorEdit = mirrorSlot ? bindDocument.armorEdits[mirrorSlot] : undefined;
  if (!mirrorSlot || !mirrorEdit) return;
  for (const sectionId of selectedIds) {
    if (!mirrorEdit.sections.some((candidate) => candidate.id === sectionId)) continue;
    const target = sectionGroups.get(sectionMapKey(mirrorSlot, sectionId));
    if (!target) continue;
    applySectionTransformToGroup(target, mirrorV3Mesh2MotionTPoseBindTransform({
      ...transform,
      sectionId,
    }));
  }
}

const updateSelectedSectionTransforms = (
  transform: V3Mesh2MotionTPoseBindSectionTransform
): void => {
  const slot = selectedSlot();
  const edit = bindDocument.armorEdits[slot];
  if (!edit) return;
  const selectedIds = activeSectionIds();
  if (selectedIds.length === 0) return;
  const mirrorSlot = mirrorTransformMode ? resolveV3Mesh2MotionTPoseBindMirrorSlot(slot) : null;
  const mirrorEdit = mirrorSlot ? bindDocument.armorEdits[mirrorSlot] : undefined;
  const sectionTransforms = { ...edit.sectionTransforms };
  const mirrorSectionTransforms = mirrorEdit ? { ...mirrorEdit.sectionTransforms } : null;

  for (const sectionId of selectedIds) {
    const section = edit.sections.find((candidate) => candidate.id === sectionId);
    if (!section) continue;
    const normalized = normalizeV3Mesh2MotionTPoseBindSectionTransform({
      ...transform,
      sectionId,
    }, sectionId);
    sectionTransforms[sectionId] = normalized;
    const group = sectionGroups.get(sectionMapKey(slot, sectionId));
    if (group) applySectionTransformToGroup(group, normalized);

    if (mirrorSlot && mirrorEdit && mirrorSectionTransforms) {
      const mirrorSection = mirrorEdit.sections.find((candidate) => candidate.id === sectionId);
      if (!mirrorSection) continue;
      const mirrored = mirrorV3Mesh2MotionTPoseBindTransform({
        ...normalized,
        sectionId,
      });
      mirrorSectionTransforms[sectionId] = mirrored;
      const mirrorGroup = sectionGroups.get(sectionMapKey(mirrorSlot, sectionId));
      if (mirrorGroup) applySectionTransformToGroup(mirrorGroup, mirrored);
    }
  }

  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    armorEdits: {
      ...bindDocument.armorEdits,
      [slot]: {
        ...edit,
        sectionTransforms,
      },
      ...(mirrorSlot && mirrorEdit && mirrorSectionTransforms
        ? {
          [mirrorSlot]: {
            ...mirrorEdit,
            sectionTransforms: mirrorSectionTransforms,
          },
        }
        : {}),
    },
  });
};

function captureSelectedSectionTransform(): void {
  const edit = activeArmorEdit();
  const section = firstActiveSection();
  const group = selectedSectionGroup();
  if (!edit || !section || !group) return;
  updateSelectedSectionTransforms(captureSectionTransformFromGroup(group, section.id));
  syncInputsFromDocument();
  refreshDiagnosticsAndJson();
}

const updateSelectedSectionsFromInputs = (): void => {
  const section = firstActiveSection();
  if (!section) return;
  updateSelectedSectionTransforms({
    sectionId: section.id,
    position: tupleFromInputs(positionInputs),
    rotation: tupleFromInputs(rotationInputs),
    scale: tupleFromInputs(scaleInputs),
  });
};

const applyInputsToSelected = (): void => {
  if (transformScope === 'section') {
    updateSelectedSectionsFromInputs();
    refreshAll();
    return;
  }
  updateSelectedPlacement({
    position: tupleFromInputs(positionInputs),
    rotation: tupleFromInputs(rotationInputs),
    scale: tupleFromInputs(scaleInputs),
  });
  refreshAll();
};

const refreshDiagnosticsAndJson = (): void => {
  const diagnostics = buildV3Mesh2MotionTPoseBindDiagnostics(bindDocument, {
    referencePlacements: referenceDocument().placements,
  });
  diagnosticsElement.textContent = diagnostics.items.length === 0
    ? 'ready'
    : diagnostics.items.map((item) => `${item.severity.toUpperCase()} ${item.slot} ${item.code}: ${item.message}`).join('\n');
  jsonOutput.value = serializeV3Mesh2MotionTPoseBindDocument(bindDocument);
  const placement = bindDocument.placements[selectedSlot()];
  const pivot = V3_MESH2MOTION_ARMOR_RIG.slots[selectedSlot()];
  const edit = activeArmorEdit();
  const selectedSections = activeSectionIds();
  const sectionTransform = sectionTransformForInputs();
  selectedSummaryElement.textContent = [
    `slot: ${selectedSlot()}`,
    `scope: ${transformScope}`,
    `mirror mode: ${mirrorTransformMode ? 'on' : 'off'}`,
    `regenerated: ${edit ? `${edit.sections.length} section(s)` : 'no'}`,
    `selected sections: ${selectedSections.length > 0 ? selectedSections.join(', ') : 'none'}`,
    `source joint: ${pivot.sourceJointName}`,
    `center joints: ${pivot.centerJointNames.join(', ')}`,
    `position: ${placement.position.map((value) => value.toFixed(4)).join(', ')}`,
    `rotation: ${placement.rotation.map((value) => value.toFixed(4)).join(', ')}`,
    `scale: ${placement.scale.map((value) => value.toFixed(4)).join(', ')}`,
    ...(transformScope === 'section'
      ? [
        `section position: ${sectionTransform.position.map((value) => value.toFixed(4)).join(', ')}`,
        `section rotation: ${sectionTransform.rotation.map((value) => value.toFixed(4)).join(', ')}`,
        `section scale: ${sectionTransform.scale.map((value) => value.toFixed(4)).join(', ')}`,
      ]
      : []),
  ].join('\n');
  statusElement.textContent = diagnostics.ready
    ? `Editing ${selectedSlot()} from Mesh2Motion TPose (${SOURCE_HASH.slice(0, 10)})`
    : `${diagnostics.items.length} diagnostic item(s) for ${selectedSlot()}`;
};

function refreshAll(): void {
  applyDocumentToModel();
  refreshSlotSelect();
  refreshArmorRegenerationControls();
  refreshSectionButtons();
  syncInputsFromDocument();
  updateTransformButtons();
  updateTransformAttachment();
  refreshDiagnosticsAndJson();
}

const saveLocal = (): void => {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeV3Mesh2MotionTPoseBindDocument(bindDocument));
  statusElement.textContent = `saved local draft for ${SOURCE_HASH.slice(0, 10)}`;
};

const importDocumentFromText = (text: string): void => {
  try {
    const parsed = parseV3Mesh2MotionTPoseBindDocumentJson(text);
    bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
      ...parsed,
      source: sourceForCurrentMesh(parsed.source),
    });
    refreshAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown import error';
    statusElement.textContent = `import failed: ${message}`;
  }
};

const regenerateSelectedArmor = (): void => {
  const slots = bindDocument.selectedArmorSlots.length > 0
    ? bindDocument.selectedArmorSlots
    : [selectedSlot()];
  const armorEdits = { ...bindDocument.armorEdits };
  const now = Date.now();

  for (const slot of slots) {
    armorEdits[slot] = createV3Mesh2MotionTPoseBindArmorEdit(
      generateV3ArmorFromFoundation({ slot, now })
    );
  }

  const nextSelectedSlot = slots.includes(selectedSlot()) ? selectedSlot() : slots[0];
  const nextSelectedEdit = armorEdits[nextSelectedSlot];
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    selectedSlot: nextSelectedSlot,
    selectedArmorSlots: slots,
    selectedSectionIds: nextSelectedEdit?.sections[0] ? [nextSelectedEdit.sections[0].id] : [],
    armorEdits,
  });
  transformScope = nextSelectedEdit?.sections[0] ? 'section' : 'piece';
  refreshAll();
  statusElement.textContent = `regenerated ${slots.length} armor slot${slots.length === 1 ? '' : 's'} from V3 foundation`;
};

slotSelect.addEventListener('change', () => {
  setSelectedSlot(slotSelect.value as V3CharacterSlotId);
});
armorSlotMenuButton.addEventListener('click', () => {
  const hidden = !armorSlotMenu.hidden;
  armorSlotMenu.hidden = hidden;
  armorSlotMenuButton.setAttribute('aria-expanded', String(!hidden));
});
document.addEventListener('click', (event) => {
  const target = event.target as Node | null;
  if (!target || armorSlotMenu.hidden) return;
  if (armorSlotMenu.contains(target) || armorSlotMenuButton.contains(target)) return;
  armorSlotMenu.hidden = true;
  armorSlotMenuButton.setAttribute('aria-expanded', 'false');
});
regenerateArmorButton.addEventListener('click', regenerateSelectedArmor);
for (const [scope, button] of Object.entries(transformScopeButtons) as [BindEditorTransformScope, HTMLButtonElement][]) {
  button.addEventListener('click', () => setTransformScope(scope));
}
mirrorTransformModeButton.addEventListener('click', () => {
  mirrorTransformMode = !mirrorTransformMode;
  updateTransformButtons();
  refreshDiagnosticsAndJson();
});
for (const input of [...positionInputs, ...rotationInputs, ...scaleInputs]) {
  input.addEventListener('change', applyInputsToSelected);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    applyInputsToSelected();
    input.blur();
  });
}
for (const [mode, button] of Object.entries(transformButtons) as [V3Mesh2MotionTPoseBindTransformMode, HTMLButtonElement][]) {
  button.addEventListener('click', () => {
    transformMode = mode;
    updateTransformButtons();
  });
}
for (const [mode, button] of Object.entries(reviewButtons) as [BindEditorReviewMode, HTMLButtonElement][]) {
  button.addEventListener('click', () => setReviewMode(mode));
}
toggleSkeletonLinesButton.addEventListener('click', () => {
  showSkeletonLines = !showSkeletonLines;
  applyReviewVisibility();
});
toggleSlotPivotsButton.addEventListener('click', () => {
  showSlotPivots = !showSlotPivots;
  applyReviewVisibility();
});
toggleFingerJointsButton.addEventListener('click', () => {
  showFingerJoints = !showFingerJoints;
  applyReviewVisibility();
});
resetSelectedButton.addEventListener('click', () => {
  const slot = selectedSlot();
  const generated = referenceDocument();
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    source: sourceClearingMissingSlot(slot),
    placements: {
      ...bindDocument.placements,
      [slot]: generated.placements[slot],
    },
  });
  refreshAll();
});
resetAllButton.addEventListener('click', () => {
  bindDocument = referenceDocument();
  refreshAll();
});
saveLocalButton.addEventListener('click', saveLocal);
clearLocalButton.addEventListener('click', () => {
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  bindDocument = referenceDocument();
  refreshAll();
});
copyJsonButton.addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
    await navigator.clipboard.writeText(serializeV3Mesh2MotionTPoseBindDocument(bindDocument));
    statusElement.textContent = 'copied editor JSON';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'clipboard unavailable';
    statusElement.textContent = `copy failed: ${message}`;
  }
});
downloadJsonButton.addEventListener('click', () => {
  const blob = new Blob([serializeV3Mesh2MotionTPoseBindDocument(bindDocument)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-mesh2motion-tpose-bind-${SOURCE_HASH.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
importJsonButton.addEventListener('click', () => importDocumentFromText(jsonOutput.value));
chooseJsonButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  if (!file) return;
  try {
    importDocumentFromText(await file.text());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown file error';
    statusElement.textContent = `import failed: ${message}`;
  } finally {
    importFileInput.value = '';
  }
});

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || sectionOverlayMeshes.size === 0) return;
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
  pointer.y = -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects([...sectionOverlayMeshes.values()].flat(), false);
  const overlay = hits[0]?.object as THREE.Mesh | undefined;
  const slot = overlay?.userData.v3BindEditorArmorSlot;
  const sectionId = overlay?.userData.v3BindEditorArmorSection;
  if (!slot || !sectionId || !V3_CHARACTER_SLOT_IDS.includes(slot)) return;

  const additive = event.shiftKey && slot === selectedSlot();
  const nextSelected = new Set<string>(additive ? activeSectionIds() : []);
  if (additive && nextSelected.has(sectionId)) nextSelected.delete(sectionId);
  else nextSelected.add(sectionId);
  bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
    ...bindDocument,
    selectedSlot: slot,
    selectedSectionIds: [...nextSelected],
  });
  transformScope = 'section';
  event.preventDefault();
  refreshAll();
});

window.addEventListener('keydown', (event) => {
  const action = resolveV3Mesh2MotionTPoseBindEditorHotkey({
    key: event.key,
    shiftKey: event.shiftKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    targetTagName: (event.target as HTMLElement | null)?.tagName ?? null,
    targetIsContentEditable: (event.target as HTMLElement | null)?.isContentEditable,
  });
  if (!action) return;
  event.preventDefault();
  if (action.type === 'clearSelection') {
    bindDocument = normalizeV3Mesh2MotionTPoseBindDocument({
      ...bindDocument,
      selectedSectionIds: [],
    });
    transformControls.detach();
    refreshAll();
  }
  if (action.type === 'resetSelected') resetSelectedButton.click();
  if (action.type === 'resetAll') resetAllButton.click();
  if (action.type === 'commit') saveLocal();
  if (action.type === 'transformMode') {
    transformMode = action.mode;
    updateTransformButtons();
  }
  if (action.type === 'selectAdjacentSlot') {
    const index = V3_CHARACTER_SLOT_IDS.indexOf(selectedSlot());
    const next = (index + action.direction + V3_CHARACTER_SLOT_IDS.length) % V3_CHARACTER_SLOT_IDS.length;
    setSelectedSlot(V3_CHARACTER_SLOT_IDS[next]);
  }
});

const resize = (): void => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
};
window.addEventListener('resize', resize);

const animate = (): void => {
  resize();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};

refreshAll();
animate();
