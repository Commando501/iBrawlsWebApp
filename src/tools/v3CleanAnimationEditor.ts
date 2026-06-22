import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  applyV3CleanRigPose,
  analyzeV3CleanRigContinuity,
  getV3CleanJointWorldPosition,
  type V3CleanJointName,
  type V3CleanRigContinuityReport,
  type V3QuatTuple,
  type V3Vec3Tuple,
} from '../components/grifball/v3CleanRig';
import { animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  sampleV3AuthoredClipData,
  V3_AUTHORED_ANIMATION_CLIP_IDS,
  type V3AuthoredClipExport,
  type V3AuthoredClipId,
  type V3AuthoredKeyframe,
} from '../components/grifball/v3AuthoredAnimationClips';
import { V3_DETAIL_BONE_NAMES, V3_DETAIL_BONE_SPECS } from '../components/v3/v3RigDetail';
import {
  applyV3CleanEditorPosePreset,
  buildV3CleanEditorValidationReport,
  clampV3CleanEditorLoopRange,
  commitV3CleanEditorHistory,
  copyV3CleanEditorFrame,
  createV3CleanEditorDocument,
  createV3CleanEditorHistory,
  deleteV3CleanEditorKeyframe,
  duplicateV3CleanEditorCustomClip,
  getV3CleanEditorFrameDraft,
  markV3CleanEditorHistorySaved,
  mirrorV3CleanEditorFrame,
  newV3CleanEditorClipFromCurrentFrame,
  normalizeV3AuthoredClipExport,
  pasteV3CleanEditorFrame,
  redoV3CleanEditorHistory,
  resetV3CleanEditorFrame,
  resetV3CleanEditorJoint,
  retimeV3CleanEditorKeyframe,
  setV3CleanEditorJointEuler,
  setV3CleanEditorRootOffset,
  setV3CleanEditorWeaponPose,
  undoV3CleanEditorHistory,
  V3_CLEAN_EDITOR_POSE_LIBRARY,
  type V3CleanEditorDocument,
  type V3CleanEditorHistory,
  type V3CleanEditorCustomClipRecord,
  type V3CleanEditorValidationItem,
  clearV3CleanEditorWeaponPose,
} from './v3CleanAnimationEditorCore';

const canvas = document.getElementById('editor-canvas') as HTMLCanvasElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const clipSelect = document.getElementById('clip-select') as HTMLSelectElement;
const frameInput = document.getElementById('frame-input') as HTMLInputElement;
const durationInput = document.getElementById('duration-input') as HTMLInputElement;
const speedInput = document.getElementById('speed-input') as HTMLInputElement;
const timelineInput = document.getElementById('timeline') as HTMLInputElement;
const jointSelect = document.getElementById('joint-select') as HTMLSelectElement;
const jointRxInput = document.getElementById('joint-rx') as HTMLInputElement;
const jointRyInput = document.getElementById('joint-ry') as HTMLInputElement;
const jointRzInput = document.getElementById('joint-rz') as HTMLInputElement;
const rootXInput = document.getElementById('root-x') as HTMLInputElement;
const rootYInput = document.getElementById('root-y') as HTMLInputElement;
const rootZInput = document.getElementById('root-z') as HTMLInputElement;
const weaponSelect = document.getElementById('weapon-select') as HTMLSelectElement;
const weaponXInput = document.getElementById('weapon-x') as HTMLInputElement;
const weaponYInput = document.getElementById('weapon-y') as HTMLInputElement;
const weaponZInput = document.getElementById('weapon-z') as HTMLInputElement;
const weaponRxInput = document.getElementById('weapon-rx') as HTMLInputElement;
const weaponRyInput = document.getElementById('weapon-ry') as HTMLInputElement;
const weaponRzInput = document.getElementById('weapon-rz') as HTMLInputElement;
const primaryXInput = document.getElementById('primary-x') as HTMLInputElement;
const primaryYInput = document.getElementById('primary-y') as HTMLInputElement;
const primaryZInput = document.getElementById('primary-z') as HTMLInputElement;
const offhandXInput = document.getElementById('offhand-x') as HTMLInputElement;
const offhandYInput = document.getElementById('offhand-y') as HTMLInputElement;
const offhandZInput = document.getElementById('offhand-z') as HTMLInputElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const prevFrameButton = document.getElementById('prev-frame') as HTMLButtonElement;
const nextFrameButton = document.getElementById('next-frame') as HTMLButtonElement;
const frontCameraButton = document.getElementById('front-camera') as HTMLButtonElement;
const leftCameraButton = document.getElementById('left-camera') as HTMLButtonElement;
const rearCameraButton = document.getElementById('rear-camera') as HTMLButtonElement;
const rightCameraButton = document.getElementById('right-camera') as HTMLButtonElement;
const fourViewButton = document.getElementById('four-view') as HTMLButtonElement;
const exportPanelToggleButton = document.getElementById('export-panel-toggle') as HTMLButtonElement;
const workspaceElement = document.getElementById('workspace') as HTMLDivElement;
const dirtyIndicator = document.getElementById('dirty-indicator') as HTMLSpanElement;
const setKeyframeButton = document.getElementById('set-keyframe') as HTMLButtonElement;
const deleteKeyframeButton = document.getElementById('delete-keyframe') as HTMLButtonElement;
const resetFrameButton = document.getElementById('reset-frame') as HTMLButtonElement;
const duplicateClipButton = document.getElementById('duplicate-clip') as HTMLButtonElement;
const newFromCurrentButton = document.getElementById('new-from-current') as HTMLButtonElement;
const loopInInput = document.getElementById('loop-in') as HTMLInputElement;
const loopOutInput = document.getElementById('loop-out') as HTMLInputElement;
const dopeSheetElement = document.getElementById('dope-sheet') as HTMLDivElement;
const applyJointButton = document.getElementById('apply-joint') as HTMLButtonElement;
const resetJointButton = document.getElementById('reset-joint') as HTMLButtonElement;
const mirrorFrameButton = document.getElementById('mirror-frame') as HTMLButtonElement;
const applyRootButton = document.getElementById('apply-root') as HTMLButtonElement;
const applyWeaponButton = document.getElementById('apply-weapon') as HTMLButtonElement;
const editTargetSelect = document.getElementById('edit-target') as HTMLSelectElement;
const transformTranslateButton = document.getElementById('transform-translate') as HTMLButtonElement;
const transformRotateButton = document.getElementById('transform-rotate') as HTMLButtonElement;
const transformSpaceButton = document.getElementById('transform-space') as HTMLButtonElement;
const autoKeyInput = document.getElementById('auto-key') as HTMLInputElement;
const snapTransformInput = document.getElementById('snap-transform') as HTMLInputElement;
const poseLibrarySelect = document.getElementById('pose-library') as HTMLSelectElement;
const applyPoseButton = document.getElementById('apply-pose') as HTMLButtonElement;
const undoButton = document.getElementById('undo') as HTMLButtonElement;
const redoButton = document.getElementById('redo') as HTMLButtonElement;
const copyFrameButton = document.getElementById('copy-frame') as HTMLButtonElement;
const pasteFrameButton = document.getElementById('paste-frame') as HTMLButtonElement;
const copyPrevFrameButton = document.getElementById('copy-prev-frame') as HTMLButtonElement;
const keyframeListElement = document.getElementById('keyframe-list') as HTMLDivElement;
const showSkeletonInput = document.getElementById('show-skeleton') as HTMLInputElement;
const showAxesInput = document.getElementById('show-axes') as HTMLInputElement;
const showWeaponAxesInput = document.getElementById('show-weapon-axes') as HTMLInputElement;
const showSocketMarkersInput = document.getElementById('show-socket-markers') as HTMLInputElement;
const showSeamsInput = document.getElementById('show-seams') as HTMLInputElement;
const showOnionInput = document.getElementById('show-onion') as HTMLInputElement;
const showReferenceInput = document.getElementById('show-reference') as HTMLInputElement;
const validationElement = document.getElementById('validation') as HTMLDivElement;
const jsonOutput = document.getElementById('json-output') as HTMLTextAreaElement;
const copyJsonButton = document.getElementById('copy-json') as HTMLButtonElement;
const downloadJsonButton = document.getElementById('download-json') as HTMLButtonElement;
const importJsonButton = document.getElementById('import-json') as HTMLButtonElement;
const chooseJsonButton = document.getElementById('choose-json') as HTMLButtonElement;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const importDropzone = document.getElementById('import-dropzone') as HTMLDivElement;
const saveLocalButton = document.getElementById('save-local') as HTMLButtonElement;
const clearLocalButton = document.getElementById('clear-local') as HTMLButtonElement;
const sendAtlasButton = document.getElementById('send-atlas') as HTMLButtonElement;

const LOCAL_STORAGE_PREFIX = 'ibrawls_v3_clean_editor_clip_';
const ATLAS_PREVIEW_STORAGE_KEY = 'ibrawls_v3_clean_editor_preview_clip';
const CUSTOM_CLIPS_STORAGE_KEY = 'ibrawls_v3_clean_editor_custom_clips';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x030b0f, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-0.08, 0.82, -0.18);
const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSpace('local');
transformControls.setTranslationSnap(0.01);
transformControls.setRotationSnap(0.05);
scene.add(transformControls.getHelper());

scene.add(new THREE.HemisphereLight(0xaeefff, 0x102028, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.8);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const floor = new THREE.GridHelper(3.8, 16, 0x24414a, 0x14242b);
floor.position.y = -0.06;
scene.add(floor);

const overlayRoot = new THREE.Group();
overlayRoot.name = 'v3CleanAnimationEditorOverlays';
scene.add(overlayRoot);

const transformHandle = new THREE.Object3D();
transformHandle.name = 'v3CleanAnimationEditorTransformHandle';
scene.add(transformHandle);

const rig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, {
  v3QualityTier: 'desktop',
  v3Distance: 0,
  v3SourceFidelity: 'exact',
});
rig.group.rotation.y = 0;

let documentState: V3CleanEditorDocument = createV3CleanEditorDocument('clean_idle');
let historyState: V3CleanEditorHistory = createV3CleanEditorHistory(documentState.clip);
let currentFrame = 0;
let playing = false;
let frameCarry = 0;
let lastTimeMs = 0;
let clipboardFrame: V3AuthoredKeyframe | null = null;
let currentSample = sampleV3AuthoredClipData(documentState.clip, { frame: 0 });
let loopRange = clampV3CleanEditorLoopRange(documentState.clip, { inFrame: 0, outFrame: documentState.clip.durationFrames });
let customClips: V3CleanEditorCustomClipRecord[] = [];
let activeClipOption = documentState.clip.id as string;
let fourViewEnabled = false;
let activeView: 'front' | 'left' | 'rear' | 'right' = 'front';
let transformSpace: 'local' | 'world' = 'local';
let suppressTransformCommit = false;
let draggingDopeFrame: { fromFrame: number; pointerId: number; track: HTMLElement } | null = null;
let draggingLoopMarker: { marker: 'in' | 'out'; pointerId: number; track: HTMLElement } | null = null;
let suppressNextDopeClick = false;

type EditorTransformTarget = 'joint' | 'root' | 'weapon' | 'primarySocketMarker' | 'offhandSocketMarker';
type EditorView = 'front' | 'left' | 'rear' | 'right';

const fixedViewCameras: Record<EditorView, THREE.PerspectiveCamera> = {
  front: new THREE.PerspectiveCamera(42, 1, 0.01, 80),
  left: new THREE.PerspectiveCamera(42, 1, 0.01, 80),
  rear: new THREE.PerspectiveCamera(42, 1, 0.01, 80),
  right: new THREE.PerspectiveCamera(42, 1, 0.01, 80),
};

const numberValue = (input: HTMLInputElement, fallback = 0): number => {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
};

const tupleFromInputs = (
  x: HTMLInputElement,
  y: HTMLInputElement,
  z: HTMLInputElement
): V3Vec3Tuple => [numberValue(x), numberValue(y), numberValue(z)];

const setTupleInputs = (
  inputs: [HTMLInputElement, HTMLInputElement, HTMLInputElement],
  value: readonly number[] | undefined
): void => {
  inputs[0].value = (value?.[0] ?? 0).toFixed(3);
  inputs[1].value = (value?.[1] ?? 0).toFixed(3);
  inputs[2].value = (value?.[2] ?? 0).toFixed(3);
};

const eulerFromQuat = (quaternion: V3QuatTuple | undefined): [number, number, number] => {
  if (!quaternion) return [0, 0, 0];
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(...quaternion).normalize(),
    'XYZ'
  );
  return [euler.x, euler.y, euler.z];
};

const clampFrame = (frame: number): number =>
  Math.max(0, Math.min(documentState.clip.durationFrames, Math.round(Number.isFinite(frame) ? frame : 0)));

const vec3Tuple = (value: THREE.Vector3): V3Vec3Tuple => [value.x, value.y, value.z];

const eulerTuple = (value: THREE.Euler): V3Vec3Tuple => [value.x, value.y, value.z];

const storageKey = (clipId = documentState.clip.id): string => `${LOCAL_STORAGE_PREFIX}${clipId}`;

const setStatus = (message: string): void => {
  statusElement.textContent = message;
};

const customOptionValue = (record: V3CleanEditorCustomClipRecord): string => `custom:${record.storageId}`;

const activeCustomRecord = (): V3CleanEditorCustomClipRecord | undefined =>
  activeClipOption.startsWith('custom:')
    ? customClips.find((record) => customOptionValue(record) === activeClipOption)
    : undefined;

const loadCustomClips = (): V3CleanEditorCustomClipRecord[] => {
  try {
    const raw = window.localStorage.getItem(CUSTOM_CLIPS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as V3CleanEditorCustomClipRecord[] : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((record) => {
      try {
        const clip = normalizeV3AuthoredClipExport(record.clip);
        return [{
          storageId: String(record.storageId),
          label: String(record.label ?? clip.label),
          createdAt: String(record.createdAt ?? new Date().toISOString()),
          updatedAt: String(record.updatedAt ?? new Date().toISOString()),
          sourceClipId: clip.id,
          clip,
        }];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

const saveCustomClips = (): void => {
  window.localStorage.setItem(CUSTOM_CLIPS_STORAGE_KEY, JSON.stringify(customClips));
};

function refreshClipSelect(): void {
  clipSelect.textContent = '';
  const builtInGroup = document.createElement('optgroup');
  builtInGroup.label = 'Built-in';
  for (const clipId of V3_AUTHORED_ANIMATION_CLIP_IDS) {
    const option = document.createElement('option');
    option.value = clipId;
    option.textContent = clipId.replace(/^clean_/, '').replace(/_/g, ' ');
    builtInGroup.appendChild(option);
  }
  clipSelect.appendChild(builtInGroup);
  if (customClips.length > 0) {
    const customGroup = document.createElement('optgroup');
    customGroup.label = 'Local custom';
    for (const record of customClips) {
      const option = document.createElement('option');
      option.value = customOptionValue(record);
      option.textContent = record.label;
      customGroup.appendChild(option);
    }
    clipSelect.appendChild(customGroup);
  }
  clipSelect.value = activeClipOption;
}

function syncActiveCustomClip(): void {
  const record = activeCustomRecord();
  if (!record) return;
  record.clip = normalizeV3AuthoredClipExport(documentState.clip);
  record.label = record.clip.label;
  record.updatedAt = new Date().toISOString();
}

function commitClipChange(nextClip: V3AuthoredClipExport, message?: string): void {
  historyState = commitV3CleanEditorHistory(historyState, nextClip);
  documentState = {
    ...documentState,
    clip: historyState.present,
  };
  syncActiveCustomClip();
  currentFrame = clampFrame(currentFrame);
  loopRange = clampV3CleanEditorLoopRange(documentState.clip, loopRange);
  refreshAll();
  if (message) setStatus(message);
}

function replaceDocumentClip(
  clip: V3AuthoredClipExport,
  options: { activeOption: string; dirty: boolean; frame?: number; message?: string }
): void {
  const normalized = normalizeV3AuthoredClipExport(clip);
  activeClipOption = options.activeOption;
  documentState = {
    version: ATLAS_EDITOR_EXPORT_VERSION,
    clip: normalized,
    selection: { target: 'joint', joint: selectedJoint() },
  };
  historyState = createV3CleanEditorHistory(normalized);
  if (options.dirty) {
    historyState = {
      ...historyState,
      savedJson: '',
      dirty: true,
    };
  }
  currentFrame = clampFrame(options.frame ?? 0);
  loopRange = clampV3CleanEditorLoopRange(normalized, { inFrame: 0, outFrame: normalized.durationFrames });
  refreshClipSelect();
  refreshAll();
  if (options.message) setStatus(options.message);
}

for (const preset of V3_CLEAN_EDITOR_POSE_LIBRARY) {
  const option = document.createElement('option');
  option.value = preset.id;
  option.textContent = preset.label;
  poseLibrarySelect.appendChild(option);
}

for (const jointName of V3_DETAIL_BONE_NAMES) {
  const option = document.createElement('option');
  option.value = jointName;
  option.textContent = jointName;
  jointSelect.appendChild(option);
}

function loadDocument(clipId: V3AuthoredClipId): void {
  try {
    const raw = window.localStorage.getItem(storageKey(clipId));
    const nextDocument = raw
      ? { ...createV3CleanEditorDocument(clipId), clip: normalizeV3AuthoredClipExport(raw) }
      : createV3CleanEditorDocument(clipId);
    documentState = nextDocument;
  } catch {
    documentState = createV3CleanEditorDocument(clipId);
  }
  currentFrame = 0;
  activeClipOption = documentState.clip.id;
  historyState = createV3CleanEditorHistory(documentState.clip);
  loopRange = clampV3CleanEditorLoopRange(documentState.clip, { inFrame: 0, outFrame: documentState.clip.durationFrames });
  refreshClipSelect();
  setStatus(`Loaded ${documentState.clip.label}`);
  refreshAll();
}

function saveDocument(): void {
  const record = activeCustomRecord();
  if (record) {
    syncActiveCustomClip();
    saveCustomClips();
    setStatus(`Saved local custom clip ${record.label}`);
  } else {
    window.localStorage.setItem(storageKey(), JSON.stringify(documentState.clip));
    setStatus(`Saved local draft for ${documentState.clip.id}`);
  }
  historyState = markV3CleanEditorHistorySaved(historyState);
  updateControlsFromFrame();
}

function selectedJoint(): V3CleanJointName {
  return jointSelect.value as V3CleanJointName;
}

function configureCameraForView(targetCamera: THREE.PerspectiveCamera, view: EditorView, aspect = targetCamera.aspect): void {
  const distance = 3.8;
  const y = 1.08;
  targetCamera.aspect = aspect;
  if (view === 'front') targetCamera.position.set(0, y, 3.2);
  if (view === 'left') targetCamera.position.set(-distance, y, -0.18);
  if (view === 'rear') targetCamera.position.set(0, y, -3.8);
  if (view === 'right') targetCamera.position.set(distance, y, -0.18);
  targetCamera.lookAt(-0.08, 0.82, -0.18);
  targetCamera.updateProjectionMatrix();
}

function setCameraView(view: EditorView): void {
  activeView = view;
  configureCameraForView(camera, view, camera.aspect);
  controls.target.set(-0.08, 0.82, -0.18);
  controls.update();
  updateTransformTarget();
  fourViewButton.classList.toggle('active', fourViewEnabled);
}

function updateFixedViewCameras(aspect: number): void {
  for (const view of Object.keys(fixedViewCameras) as EditorView[]) {
    configureCameraForView(fixedViewCameras[view], view, aspect);
  }
}

function cameraForView(view: EditorView): THREE.PerspectiveCamera {
  return view === activeView ? camera : fixedViewCameras[view];
}

function viewFromCanvasPoint(clientX: number, clientY: number): EditorView {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < rect.width / 2 && y < rect.height / 2) return 'front';
  if (x >= rect.width / 2 && y < rect.height / 2) return 'left';
  if (x < rect.width / 2 && y >= rect.height / 2) return 'rear';
  return 'right';
}

function disposeOverlay(): void {
  for (const child of [...overlayRoot.children]) {
    overlayRoot.remove(child);
    if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  }
}

function line(from: THREE.Vector3, to: THREE.Vector3, color: number, opacity = 0.95): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
  return new THREE.Line(geometry, material);
}

function marker(position: THREE.Vector3, color: number, radius = 0.025): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 10, 10),
    new THREE.MeshBasicMaterial({ color })
  );
  mesh.position.copy(position);
  return mesh;
}

function jointWorld(joint: V3CleanJointName): THREE.Vector3 {
  return new THREE.Vector3(...getV3CleanJointWorldPosition(rig.group, joint));
}

function drawSkeleton(opacity = 0.95): void {
  for (const jointName of V3_DETAIL_BONE_NAMES) {
    const parent = V3_DETAIL_BONE_SPECS[jointName].parent;
    if (!parent) continue;
    overlayRoot.add(line(jointWorld(parent), jointWorld(jointName), 0x67e8f9, opacity));
  }
}

function drawAxes(): void {
  const detailBones = rig.group.userData.v3DetailBones as Partial<Record<V3CleanJointName, THREE.Group>>;
  for (const jointName of V3_DETAIL_BONE_NAMES) {
    const bone = detailBones[jointName];
    if (!bone) continue;
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const quaternion = bone.getWorldQuaternion(new THREE.Quaternion());
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0.08, 0, 0).applyQuaternion(quaternion)), 0xef4444, 0.86));
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0, 0.08, 0).applyQuaternion(quaternion)), 0x22c55e, 0.86));
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0, 0, -0.08).applyQuaternion(quaternion)), 0x3b82f6, 0.86));
  }
}

function visibleWeaponModel(): THREE.Group | null {
  if (currentSample.weaponPose?.weapon === 'hammer') return rig.hammer;
  if (currentSample.weaponPose?.weapon === 'sword') return rig.sword;
  if (currentSample.weaponPose?.weapon === 'pistol') return rig.pistol ?? null;
  return null;
}

function detailBone(joint: V3CleanJointName): THREE.Group | null {
  const detailBones = rig.group.userData.v3DetailBones as Partial<Record<V3CleanJointName, THREE.Group>>;
  return detailBones[joint] ?? null;
}

function rootOffsetFromPelvis(pelvis: THREE.Group): V3Vec3Tuple {
  const rest = pelvis.userData.v3CleanRestLocalPosition;
  const restTuple = Array.isArray(rest) && rest.length === 3
    ? [Number(rest[0]) || 0, Number(rest[1]) || 0, Number(rest[2]) || 0]
    : [0, 0, 0];
  return [
    pelvis.position.x - restTuple[0],
    pelvis.position.y - restTuple[1],
    pelvis.position.z - restTuple[2],
  ];
}

function currentTransformTarget(): EditorTransformTarget {
  return editTargetSelect.value as EditorTransformTarget;
}

function setTransformButtons(): void {
  transformTranslateButton.classList.toggle('active', transformControls.mode === 'translate');
  transformRotateButton.classList.toggle('active', transformControls.mode === 'rotate');
  transformSpaceButton.classList.toggle('active', transformSpace === 'local');
  transformSpaceButton.textContent = transformSpace === 'local' ? 'Local' : 'World';
  transformControls.setSpace(transformSpace);
  if (snapTransformInput.checked) {
    transformControls.setTranslationSnap(0.01);
    transformControls.setRotationSnap(0.05);
  } else {
    transformControls.setTranslationSnap(null);
    transformControls.setRotationSnap(null);
  }
}

function updateTransformTarget(): void {
  suppressTransformCommit = true;
  transformControls.detach();
  transformControls.enabled = true;
  const target = currentTransformTarget();
  if (target === 'joint') {
    const bone = detailBone(selectedJoint());
    if (bone) transformControls.attach(bone);
  } else if (target === 'root') {
    const pelvis = detailBone('pelvis');
    if (pelvis) transformControls.attach(pelvis);
  } else if (target === 'weapon') {
    const weaponModel = visibleWeaponModel();
    if (weaponModel) transformControls.attach(weaponModel);
  } else {
    const weaponModel = visibleWeaponModel();
    const pose = currentSample.weaponPose;
    const markerValue = target === 'primarySocketMarker'
      ? pose?.primarySocketMarker
      : pose?.offhandSocketMarker;
    if (weaponModel) {
      const worldPosition = weaponModel.localToWorld(new THREE.Vector3(...(markerValue ?? [0, 0, 0])));
      transformHandle.position.copy(worldPosition);
      transformHandle.quaternion.copy(weaponModel.getWorldQuaternion(new THREE.Quaternion()));
      transformControls.attach(transformHandle);
    }
  }
  setTransformButtons();
  suppressTransformCommit = false;
}

function commitTransformPreviewToInputs(): void {
  const target = currentTransformTarget();
  if (target === 'joint') {
    const bone = detailBone(selectedJoint());
    if (!bone) return;
    setTupleInputs([jointRxInput, jointRyInput, jointRzInput], eulerTuple(bone.rotation));
    if (autoKeyInput.checked && transformControls.mode === 'rotate') applyJointInputs();
    if (transformControls.mode === 'translate') setStatus('Joint translation is preview-only; rotate joints or use Root Offset for keyed translation.');
    return;
  }
  if (target === 'root') {
    const pelvis = detailBone('pelvis');
    if (!pelvis) return;
    setTupleInputs([rootXInput, rootYInput, rootZInput], rootOffsetFromPelvis(pelvis));
    if (autoKeyInput.checked) applyRootInputs();
    return;
  }
  if (target === 'weapon') {
    const weaponModel = visibleWeaponModel();
    if (!weaponModel) return;
    setTupleInputs([weaponXInput, weaponYInput, weaponZInput], vec3Tuple(weaponModel.position));
    setTupleInputs([weaponRxInput, weaponRyInput, weaponRzInput], eulerTuple(weaponModel.rotation));
    if (autoKeyInput.checked) applyWeaponInputs();
    return;
  }
  const weaponModel = visibleWeaponModel();
  if (!weaponModel) return;
  const markerLocal = weaponModel.worldToLocal(transformHandle.position.clone());
  if (target === 'primarySocketMarker') {
    setTupleInputs([primaryXInput, primaryYInput, primaryZInput], vec3Tuple(markerLocal));
  } else {
    setTupleInputs([offhandXInput, offhandYInput, offhandZInput], vec3Tuple(markerLocal));
  }
  if (autoKeyInput.checked) applyWeaponInputs();
}

function drawWeaponDiagnostics(): void {
  const weaponModel = visibleWeaponModel();
  if (!weaponModel) return;
  const origin = weaponModel.getWorldPosition(new THREE.Vector3());
  const quaternion = weaponModel.getWorldQuaternion(new THREE.Quaternion());
  if (showWeaponAxesInput.checked) {
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0.18, 0, 0).applyQuaternion(quaternion)), 0xef4444));
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0, 0.18, 0).applyQuaternion(quaternion)), 0x22c55e));
    overlayRoot.add(line(origin, origin.clone().add(new THREE.Vector3(0, 0, -0.18).applyQuaternion(quaternion)), 0xfacc15));
  }
  if (showSocketMarkersInput.checked) {
    const pose = currentSample.weaponPose;
    if (pose?.primarySocketMarker) {
      overlayRoot.add(marker(weaponModel.localToWorld(new THREE.Vector3(...pose.primarySocketMarker)), 0xffffff, 0.035));
    }
    if (pose?.offhandSocketMarker) {
      overlayRoot.add(marker(weaponModel.localToWorld(new THREE.Vector3(...pose.offhandSocketMarker)), 0xfacc15, 0.035));
    }
  }
}

function drawSeams(): V3CleanRigContinuityReport {
  const report = analyzeV3CleanRigContinuity(rig.group);
  if (showSeamsInput.checked) {
    for (const link of report.links) {
      const color = link.gap > 0.08 ? 0xfb7185 : 0x94a3b8;
      overlayRoot.add(line(new THREE.Vector3(...link.endpoints.parent), new THREE.Vector3(...link.endpoints.child), color, 0.9));
    }
  }
  return report;
}

function renderValidationReport(continuityReport: V3CleanRigContinuityReport): void {
  const report = buildV3CleanEditorValidationReport(documentState.clip);
  validationElement.textContent = '';
  const summary = document.createElement('div');
  summary.textContent = [
    report.summary,
    `Seam max ${continuityReport.maxJointSeamGap.toFixed(4)}`,
  ].join(' | ');
  validationElement.appendChild(summary);

  const seamItems: V3CleanEditorValidationItem[] = continuityReport.jointSeamWarnings.map((warning) => ({
    severity: 'warning' as const,
    code: 'seam-gap',
    message: warning,
  }));
  const referenceItems: V3CleanEditorValidationItem[] = showReferenceInput.checked
    ? [{
      severity: 'info' as const,
      code: 'reference-overlay',
      message: 'Mixamo reference display is reference-only; manual clean rig keys remain authoritative.',
    }]
    : [];
  const items = [...report.items, ...seamItems, ...referenceItems];
  if (items.length === 0) {
    const item = document.createElement('div');
    item.textContent = 'No validation issues. Clean rig is ready for atlas review.';
    validationElement.appendChild(item);
    return;
  }
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `validation-item ${item.severity}`;
    button.textContent = `${item.severity.toUpperCase()} ${item.frame !== undefined ? `f${item.frame} ` : ''}${item.message}`;
    button.addEventListener('click', () => {
      if (item.frame !== undefined) currentFrame = clampFrame(item.frame);
      if (item.target && V3_DETAIL_BONE_NAMES.includes(item.target as V3CleanJointName)) {
        jointSelect.value = item.target;
        editTargetSelect.value = 'joint';
      }
      if (item.target === 'weapon') editTargetSelect.value = 'weapon';
      if (item.target === 'primarySocketMarker') editTargetSelect.value = 'primarySocketMarker';
      if (item.target === 'offhandSocketMarker') editTargetSelect.value = 'offhandSocketMarker';
      refreshAll();
    });
    validationElement.appendChild(button);
  }
}

function drawOnionSkin(): void {
  if (!showOnionInput.checked) return;
  const savedSample = currentSample;
  const savedFrame = currentFrame;
  for (const offset of [-6, 6]) {
    const frame = clampFrame(savedFrame + offset);
    const sample = sampleV3AuthoredClipData(documentState.clip, { frame });
    applyV3CleanRigPose(rig.group, sample.pose);
    rig.group.updateMatrixWorld(true);
    drawSkeleton(0.28);
  }
  currentSample = savedSample;
  applyV3CleanRigPose(rig.group, savedSample.pose);
  rig.group.updateMatrixWorld(true);
}

function refreshOverlays(): void {
  disposeOverlay();
  drawOnionSkin();
  if (showSkeletonInput.checked) drawSkeleton();
  if (showAxesInput.checked) drawAxes();
  drawWeaponDiagnostics();
  renderValidationReport(drawSeams());
}

function updateWeaponVisibility(): void {
  const weapon = currentSample.weaponPose?.weapon ?? null;
  rig.hammer.visible = weapon === 'hammer';
  rig.sword.visible = weapon === 'sword';
  if (rig.pistol) rig.pistol.visible = weapon === 'pistol';
}

function applyPreview(): void {
  currentFrame = clampFrame(currentFrame);
  currentSample = sampleV3AuthoredClipData(documentState.clip, { frame: currentFrame });
  applyV3CleanRigPose(rig.group, currentSample.pose);
  animateV3WeaponMeshes({
    hammerModel: rig.hammer,
    swordModel: rig.sword,
    pistolModel: rig.pistol,
    combatantModel: rig.group,
    activeWeapon: currentSample.weaponPose?.weapon ?? '',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    dt: 1 / 60,
    settings: {},
    v3AnimationAuthority: 'cleanRig',
    v3AuthoredClipId: documentState.clip.id,
    v3AuthoredNormalizedTime: currentSample.normalizedTime,
    v3AuthoredSampleOverride: currentSample,
  });
  updateWeaponVisibility();
  scene.updateMatrixWorld(true);
  refreshOverlays();
  updateTransformTarget();
}

function updateKeyframeList(): void {
  keyframeListElement.textContent = documentState.clip.keyframes
    .map((keyframe) => {
      const joints = Object.keys(keyframe.jointQuaternions).length;
      const weapon = keyframe.weaponPose?.weapon ?? 'hidden';
      return `frame ${keyframe.frame.toString().padStart(3, ' ')} | joints ${joints.toString().padStart(2, ' ')} | weapon ${weapon}`;
    })
    .join('\n');
  renderDopeSheet();
}

function percentForFrame(frame: number): number {
  return (clampFrame(frame) / Math.max(1, documentState.clip.durationFrames)) * 100;
}

function frameFromTrackPointer(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  const t = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
  return clampFrame(t * documentState.clip.durationFrames);
}

function rowFrames(row: 'root' | 'weapon' | 'joint' | 'all'): number[] {
  const selected = selectedJoint();
  return documentState.clip.keyframes
    .filter((keyframe) => {
      if (row === 'root') return Boolean(keyframe.rootOffset);
      if (row === 'weapon') return Boolean(keyframe.weaponPose);
      if (row === 'joint') return Boolean(keyframe.jointQuaternions[selected]);
      return true;
    })
    .map((keyframe) => keyframe.frame);
}

function renderDopeSheet(): void {
  dopeSheetElement.textContent = '';
  const rows: Array<{ id: 'root' | 'weapon' | 'joint' | 'all'; label: string }> = [
    { id: 'root', label: 'Root' },
    { id: 'weapon', label: 'Weapon' },
    { id: 'joint', label: selectedJoint() },
    { id: 'all', label: 'All Keys' },
  ];
  for (const row of rows) {
    const rowElement = document.createElement('div');
    rowElement.className = 'dope-row';
    const label = document.createElement('span');
    label.textContent = row.label;
    const track = document.createElement('div');
    track.className = 'dope-track';
    track.addEventListener('click', (event) => {
      if (event.target !== track) return;
      currentFrame = frameFromTrackPointer(track, event.clientX);
      playing = false;
      refreshAll();
    });

    if (row.id === 'all') {
      for (const marker of ['in', 'out'] as const) {
        const markerButton = document.createElement('button');
        markerButton.type = 'button';
        markerButton.className = 'loop-marker';
        markerButton.title = marker === 'in' ? 'Loop in marker' : 'Loop out marker';
        markerButton.textContent = marker === 'in' ? 'I' : 'O';
        markerButton.style.left = `${percentForFrame(marker === 'in' ? loopRange.inFrame : loopRange.outFrame)}%`;
        markerButton.addEventListener('pointerdown', (event) => {
          draggingLoopMarker = { marker, pointerId: event.pointerId, track };
          markerButton.setPointerCapture(event.pointerId);
          event.preventDefault();
        });
        track.appendChild(markerButton);
      }
    }

    for (const frame of rowFrames(row.id)) {
      const key = document.createElement('button');
      key.type = 'button';
      key.className = `dope-key${frame === currentFrame ? ' active' : ''}`;
      key.title = `Frame ${frame}`;
      key.style.left = `${percentForFrame(frame)}%`;
      key.addEventListener('pointerdown', (event) => {
        draggingDopeFrame = { fromFrame: frame, pointerId: event.pointerId, track };
        key.setPointerCapture(event.pointerId);
      });
      key.addEventListener('click', () => {
        if (suppressNextDopeClick) {
          suppressNextDopeClick = false;
          return;
        }
        currentFrame = clampFrame(frame);
        playing = false;
        refreshAll();
      });
      track.appendChild(key);
    }

    rowElement.append(label, track);
    dopeSheetElement.appendChild(rowElement);
  }
}

function updateControlsFromFrame(): void {
  const draft = getV3CleanEditorFrameDraft(documentState.clip, currentFrame).keyframe;
  const jointEuler = eulerFromQuat(draft.jointQuaternions[selectedJoint()]);
  setTupleInputs([jointRxInput, jointRyInput, jointRzInput], jointEuler);
  setTupleInputs([rootXInput, rootYInput, rootZInput], draft.rootOffset);
  const weaponPose = draft.weaponPose;
  weaponSelect.value = weaponPose?.weapon ?? '';
  setTupleInputs([weaponXInput, weaponYInput, weaponZInput], weaponPose?.position);
  setTupleInputs([weaponRxInput, weaponRyInput, weaponRzInput], weaponPose?.rotation);
  setTupleInputs([primaryXInput, primaryYInput, primaryZInput], weaponPose?.primarySocketMarker);
  setTupleInputs([offhandXInput, offhandYInput, offhandZInput], weaponPose?.offhandSocketMarker);
  frameInput.value = String(currentFrame);
  durationInput.value = String(documentState.clip.durationFrames);
  timelineInput.max = String(documentState.clip.durationFrames);
  timelineInput.value = String(currentFrame);
  loopRange = clampV3CleanEditorLoopRange(documentState.clip, loopRange);
  loopInInput.max = String(documentState.clip.durationFrames);
  loopOutInput.max = String(documentState.clip.durationFrames);
  loopInInput.value = String(loopRange.inFrame);
  loopOutInput.value = String(loopRange.outFrame);
  refreshClipSelect();
  updateKeyframeList();
  if (document.activeElement !== jsonOutput) {
    jsonOutput.value = JSON.stringify(documentState.clip, null, 2);
  }
  playButton.textContent = playing ? 'Pause' : 'Play';
  dirtyIndicator.textContent = historyState.dirty ? 'Unsaved changes' : 'Saved';
  dirtyIndicator.classList.toggle('dirty', historyState.dirty);
  undoButton.disabled = historyState.past.length === 0;
  redoButton.disabled = historyState.future.length === 0;
  fourViewButton.classList.toggle('active', fourViewEnabled);
  setTransformButtons();
  setStatus(`${documentState.clip.label} | frame ${currentFrame}/${documentState.clip.durationFrames} | ${historyState.dirty ? 'dirty' : 'saved'} | source manual editor`);
}

function refreshAll(): void {
  currentFrame = clampFrame(currentFrame);
  applyPreview();
  updateControlsFromFrame();
}

function applyJointInputs(): void {
  const nextClip = setV3CleanEditorJointEuler(documentState.clip, {
    frame: currentFrame,
    joint: selectedJoint(),
    euler: tupleFromInputs(jointRxInput, jointRyInput, jointRzInput),
  });
  commitClipChange(nextClip, `Set ${selectedJoint()} at frame ${currentFrame}`);
}

function applyRootInputs(): void {
  const nextClip = setV3CleanEditorRootOffset(documentState.clip, {
    frame: currentFrame,
    rootOffset: tupleFromInputs(rootXInput, rootYInput, rootZInput),
  });
  commitClipChange(nextClip, `Set root offset at frame ${currentFrame}`);
}

function applyWeaponInputs(): void {
  const weapon = weaponSelect.value;
  if (weapon !== 'hammer' && weapon !== 'sword' && weapon !== 'pistol') {
    commitClipChange(clearV3CleanEditorWeaponPose(documentState.clip, currentFrame), `Cleared weapon at frame ${currentFrame}`);
    return;
  }
  const nextClip = setV3CleanEditorWeaponPose(documentState.clip, {
    frame: currentFrame,
    weapon,
    position: tupleFromInputs(weaponXInput, weaponYInput, weaponZInput),
    rotation: tupleFromInputs(weaponRxInput, weaponRyInput, weaponRzInput),
    primarySocketMarker: tupleFromInputs(primaryXInput, primaryYInput, primaryZInput),
    offhandSocketMarker: tupleFromInputs(offhandXInput, offhandYInput, offhandZInput),
  });
  commitClipChange(nextClip, `Set ${weapon} pose at frame ${currentFrame}`);
}

function commitCurrentInputs(): void {
  let nextClip = setV3CleanEditorJointEuler(documentState.clip, {
    frame: currentFrame,
    joint: selectedJoint(),
    euler: tupleFromInputs(jointRxInput, jointRyInput, jointRzInput),
  });
  nextClip = setV3CleanEditorRootOffset(nextClip, {
    frame: currentFrame,
    rootOffset: tupleFromInputs(rootXInput, rootYInput, rootZInput),
  });
  const weapon = weaponSelect.value;
  if (weapon === 'hammer' || weapon === 'sword' || weapon === 'pistol') {
    nextClip = setV3CleanEditorWeaponPose(nextClip, {
      frame: currentFrame,
      weapon,
      position: tupleFromInputs(weaponXInput, weaponYInput, weaponZInput),
      rotation: tupleFromInputs(weaponRxInput, weaponRyInput, weaponRzInput),
      primarySocketMarker: tupleFromInputs(primaryXInput, primaryYInput, primaryZInput),
      offhandSocketMarker: tupleFromInputs(offhandXInput, offhandYInput, offhandZInput),
    });
  } else {
    nextClip = clearV3CleanEditorWeaponPose(nextClip, currentFrame);
  }
  commitClipChange(nextClip, `Set keyframe ${currentFrame}`);
}

function importFromTextarea(): void {
  try {
    const imported = normalizeV3AuthoredClipExport(jsonOutput.value);
    replaceDocumentClip(imported, {
      activeOption: imported.id,
      dirty: true,
      message: `Imported ${imported.label}`,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to import JSON');
  }
}

function importJsonText(text: string): void {
  const previousText = jsonOutput.value;
  jsonOutput.value = text;
  try {
    importFromTextarea();
  } catch (error) {
    jsonOutput.value = previousText;
    setStatus(error instanceof Error ? error.message : 'Unable to import JSON');
  }
}

function resize(): void {
  const parent = canvas.parentElement;
  const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
  const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  updateFixedViewCameras(width / Math.max(1, height));
}

clipSelect.addEventListener('change', () => {
  const value = clipSelect.value;
  if (value.startsWith('custom:')) {
    const record = customClips.find((candidate) => customOptionValue(candidate) === value);
    if (record) {
      replaceDocumentClip(record.clip, {
        activeOption: value,
        dirty: false,
        message: `Loaded local custom clip ${record.label}`,
      });
    }
    return;
  }
  loadDocument(value as V3AuthoredClipId);
});
jointSelect.addEventListener('change', () => updateControlsFromFrame());
timelineInput.addEventListener('input', () => {
  currentFrame = clampFrame(numberValue(timelineInput));
  refreshAll();
});
frameInput.addEventListener('change', () => {
  currentFrame = clampFrame(numberValue(frameInput));
  refreshAll();
});
durationInput.addEventListener('change', () => {
  const nextClip = normalizeV3AuthoredClipExport({
    ...documentState.clip,
    durationFrames: Math.max(1, Math.floor(numberValue(durationInput, documentState.clip.durationFrames))),
  });
  currentFrame = clampFrame(currentFrame);
  loopRange = clampV3CleanEditorLoopRange(nextClip, loopRange);
  commitClipChange(nextClip, `Set duration to ${nextClip.durationFrames} frames`);
});
loopInInput.addEventListener('change', () => {
  loopRange = clampV3CleanEditorLoopRange(documentState.clip, {
    inFrame: numberValue(loopInInput),
    outFrame: loopRange.outFrame,
  });
  refreshAll();
});
loopOutInput.addEventListener('change', () => {
  loopRange = clampV3CleanEditorLoopRange(documentState.clip, {
    inFrame: loopRange.inFrame,
    outFrame: numberValue(loopOutInput, documentState.clip.durationFrames),
  });
  refreshAll();
});
playButton.addEventListener('click', () => {
  playing = !playing;
  updateControlsFromFrame();
});
prevFrameButton.addEventListener('click', () => {
  playing = false;
  currentFrame = clampFrame(currentFrame - 1);
  refreshAll();
});
nextFrameButton.addEventListener('click', () => {
  playing = false;
  currentFrame = clampFrame(currentFrame + 1);
  refreshAll();
});
frontCameraButton.addEventListener('click', () => setCameraView('front'));
leftCameraButton.addEventListener('click', () => setCameraView('left'));
rearCameraButton.addEventListener('click', () => setCameraView('rear'));
rightCameraButton.addEventListener('click', () => setCameraView('right'));
applyJointButton.addEventListener('click', () => applyJointInputs());
applyRootButton.addEventListener('click', () => applyRootInputs());
applyWeaponButton.addEventListener('click', () => applyWeaponInputs());
setKeyframeButton.addEventListener('click', () => commitCurrentInputs());
deleteKeyframeButton.addEventListener('click', () => {
  commitClipChange(deleteV3CleanEditorKeyframe(documentState.clip, currentFrame), `Deleted keyframe ${currentFrame}`);
});
resetFrameButton.addEventListener('click', () => {
  commitClipChange(resetV3CleanEditorFrame(documentState.clip, currentFrame), `Reset frame ${currentFrame}`);
});
resetJointButton.addEventListener('click', () => {
  commitClipChange(
    resetV3CleanEditorJoint(documentState.clip, { frame: currentFrame, joint: selectedJoint() }),
    `Reset ${selectedJoint()} at frame ${currentFrame}`
  );
});
mirrorFrameButton.addEventListener('click', () => {
  commitClipChange(mirrorV3CleanEditorFrame(documentState.clip, currentFrame), `Mirrored frame ${currentFrame}`);
});
copyFrameButton.addEventListener('click', () => {
  clipboardFrame = copyV3CleanEditorFrame(documentState.clip, currentFrame);
  setStatus(`Copied frame ${currentFrame}`);
});
pasteFrameButton.addEventListener('click', () => {
  if (!clipboardFrame) return;
  commitClipChange(
    pasteV3CleanEditorFrame(documentState.clip, { frame: currentFrame, keyframe: clipboardFrame }),
    `Pasted frame ${currentFrame}`
  );
});
copyPrevFrameButton.addEventListener('click', () => {
  clipboardFrame = copyV3CleanEditorFrame(documentState.clip, clampFrame(currentFrame - 1));
  commitClipChange(
    pasteV3CleanEditorFrame(documentState.clip, { frame: currentFrame, keyframe: clipboardFrame }),
    `Copied previous frame into ${currentFrame}`
  );
});

duplicateClipButton.addEventListener('click', () => {
  const record = duplicateV3CleanEditorCustomClip(documentState.clip);
  customClips = [...customClips, record];
  activeClipOption = customOptionValue(record);
  saveCustomClips();
  replaceDocumentClip(record.clip, {
    activeOption: activeClipOption,
    dirty: false,
    message: `Duplicated ${record.label}`,
  });
});

newFromCurrentButton.addEventListener('click', () => {
  const record = newV3CleanEditorClipFromCurrentFrame(documentState.clip, { frame: currentFrame });
  customClips = [...customClips, record];
  activeClipOption = customOptionValue(record);
  saveCustomClips();
  replaceDocumentClip(record.clip, {
    activeOption: activeClipOption,
    dirty: false,
    message: `Created ${record.label} from frame ${currentFrame}`,
  });
});

undoButton.addEventListener('click', () => {
  historyState = undoV3CleanEditorHistory(historyState);
  documentState = { ...documentState, clip: historyState.present };
  syncActiveCustomClip();
  currentFrame = clampFrame(currentFrame);
  refreshAll();
  setStatus('Undo');
});

redoButton.addEventListener('click', () => {
  historyState = redoV3CleanEditorHistory(historyState);
  documentState = { ...documentState, clip: historyState.present };
  syncActiveCustomClip();
  currentFrame = clampFrame(currentFrame);
  refreshAll();
  setStatus('Redo');
});

applyPoseButton.addEventListener('click', () => {
  commitClipChange(
    applyV3CleanEditorPosePreset(documentState.clip, {
      frame: currentFrame,
      presetId: poseLibrarySelect.value,
    }),
    `Applied pose ${poseLibrarySelect.selectedOptions[0]?.textContent ?? poseLibrarySelect.value} at frame ${currentFrame}`
  );
});

editTargetSelect.addEventListener('change', () => updateTransformTarget());
transformTranslateButton.addEventListener('click', () => {
  transformControls.setMode('translate');
  setTransformButtons();
});
transformRotateButton.addEventListener('click', () => {
  transformControls.setMode('rotate');
  setTransformButtons();
});
transformSpaceButton.addEventListener('click', () => {
  transformSpace = transformSpace === 'local' ? 'world' : 'local';
  setTransformButtons();
});
snapTransformInput.addEventListener('change', () => setTransformButtons());
fourViewButton.addEventListener('click', () => {
  fourViewEnabled = !fourViewEnabled;
  fourViewButton.classList.toggle('active', fourViewEnabled);
  resize();
  refreshAll();
});
exportPanelToggleButton.addEventListener('click', () => {
  workspaceElement.classList.toggle('export-open');
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});
transformControls.addEventListener('objectChange', () => {
  if (suppressTransformCommit) return;
  commitTransformPreviewToInputs();
});

canvas.addEventListener('pointerdown', (event) => {
  if (!fourViewEnabled || event.button !== 0) return;
  const view = viewFromCanvasPoint(event.clientX, event.clientY);
  if (view !== activeView) {
    setCameraView(view);
    refreshAll();
  }
});

window.addEventListener('pointerup', (event) => {
  if (draggingDopeFrame) {
    const toFrame = frameFromTrackPointer(draggingDopeFrame.track, event.clientX);
    const fromFrame = draggingDopeFrame.fromFrame;
    draggingDopeFrame = null;
    currentFrame = toFrame;
    if (fromFrame !== toFrame) {
      suppressNextDopeClick = true;
      commitClipChange(retimeV3CleanEditorKeyframe(documentState.clip, { fromFrame, toFrame }), `Retimed frame ${fromFrame} to ${toFrame}`);
    } else {
      refreshAll();
    }
  }
  if (draggingLoopMarker) {
    const frame = frameFromTrackPointer(draggingLoopMarker.track, event.clientX);
    loopRange = clampV3CleanEditorLoopRange(documentState.clip, {
      inFrame: draggingLoopMarker.marker === 'in' ? frame : loopRange.inFrame,
      outFrame: draggingLoopMarker.marker === 'out' ? frame : loopRange.outFrame,
    });
    draggingLoopMarker = null;
    refreshAll();
  }
});

for (const input of [
  showSkeletonInput,
  showAxesInput,
  showWeaponAxesInput,
  showSocketMarkersInput,
  showSeamsInput,
  showOnionInput,
  showReferenceInput,
]) {
  input.addEventListener('change', () => refreshAll());
}

copyJsonButton.addEventListener('click', async () => {
  jsonOutput.value = JSON.stringify(documentState.clip, null, 2);
  try {
    await navigator.clipboard?.writeText(jsonOutput.value);
    setStatus('Copied authored clip JSON');
  } catch {
    setStatus('Clipboard unavailable; JSON is in the export box');
  }
});

downloadJsonButton.addEventListener('click', () => {
  jsonOutput.value = JSON.stringify(documentState.clip, null, 2);
  const blob = new Blob([jsonOutput.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-authored-${documentState.clip.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

importJsonButton.addEventListener('click', () => importFromTextarea());
chooseJsonButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = '';
  if (!file) return;
  try {
    importJsonText(await file.text());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read JSON file');
  }
});
importDropzone.addEventListener('dragover', (event) => {
  event.preventDefault();
  importDropzone.classList.add('drag-over');
});
importDropzone.addEventListener('dragleave', () => {
  importDropzone.classList.remove('drag-over');
});
importDropzone.addEventListener('drop', async (event) => {
  event.preventDefault();
  importDropzone.classList.remove('drag-over');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  try {
    importJsonText(await file.text());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read dropped JSON');
  }
});
saveLocalButton.addEventListener('click', () => saveDocument());
clearLocalButton.addEventListener('click', () => {
  const record = activeCustomRecord();
  if (record) {
    customClips = customClips.filter((candidate) => candidate.storageId !== record.storageId);
    saveCustomClips();
    loadDocument(record.sourceClipId);
    setStatus(`Deleted local custom clip ${record.label}`);
    return;
  }
  window.localStorage.removeItem(storageKey());
  loadDocument(documentState.clip.id);
  setStatus(`Cleared local draft for ${documentState.clip.id}`);
});
sendAtlasButton.addEventListener('click', () => {
  window.localStorage.setItem(ATLAS_PREVIEW_STORAGE_KEY, JSON.stringify(documentState.clip));
  const atlasWindow = window.open('/v3-animation-atlas-smoke.html?preview=clean-editor', '_blank', 'noopener');
  setStatus(atlasWindow
    ? 'Sent current draft and opened atlas'
    : 'Draft sent; open /v3-animation-atlas-smoke.html?preview=clean-editor');
});

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

window.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playing = !playing;
    updateControlsFromFrame();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    playing = false;
    currentFrame = clampFrame(currentFrame + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1));
    refreshAll();
    return;
  }
  if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    commitCurrentInputs();
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    commitClipChange(deleteV3CleanEditorKeyframe(documentState.clip, currentFrame), `Deleted keyframe ${currentFrame}`);
    return;
  }
  if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    commitClipChange(mirrorV3CleanEditorFrame(documentState.clip, currentFrame), `Mirrored frame ${currentFrame}`);
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redoButton.click();
    } else {
      undoButton.click();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoButton.click();
  }
});

window.addEventListener('resize', () => {
  resize();
  refreshAll();
});

function nextLoopedFrame(frame: number, deltaFrames: number): number {
  const range = clampV3CleanEditorLoopRange(documentState.clip, loopRange);
  const start = range.inFrame;
  const end = Math.max(start, range.outFrame);
  const span = Math.max(1, end - start + 1);
  const base = frame < start || frame > end ? start : frame;
  return start + ((((base + deltaFrames - start) % span) + span) % span);
}

function renderScene(): void {
  if (!fourViewEnabled) {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    camera.aspect = canvas.width / Math.max(1, canvas.height);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return;
  }

  renderer.setScissorTest(true);
  const width = canvas.width;
  const height = canvas.height;
  const halfWidth = Math.floor(width / 2);
  const halfHeight = Math.floor(height / 2);
  const views: Array<{ id: EditorView; x: number; y: number; width: number; height: number }> = [
    { id: 'front', x: 0, y: halfHeight, width: halfWidth, height: height - halfHeight },
    { id: 'left', x: halfWidth, y: halfHeight, width: width - halfWidth, height: height - halfHeight },
    { id: 'rear', x: 0, y: 0, width: halfWidth, height: halfHeight },
    { id: 'right', x: halfWidth, y: 0, width: width - halfWidth, height: halfHeight },
  ];
  for (const view of views) {
    const viewCamera = cameraForView(view.id);
    viewCamera.aspect = view.width / Math.max(1, view.height);
    viewCamera.updateProjectionMatrix();
    if (view.id !== activeView) configureCameraForView(viewCamera, view.id, viewCamera.aspect);
    renderer.setViewport(view.x, view.y, view.width, view.height);
    renderer.setScissor(view.x, view.y, view.width, view.height);
    renderer.render(scene, viewCamera);
  }
  renderer.setScissorTest(false);
}

function animate(timeMs: number): void {
  if (lastTimeMs === 0) lastTimeMs = timeMs;
  const delta = Math.min(0.08, Math.max(0, (timeMs - lastTimeMs) / 1000));
  lastTimeMs = timeMs;
  if (playing) {
    frameCarry += delta * 60 * Math.max(0.1, Math.min(4, numberValue(speedInput, 1)));
    const wholeFrames = Math.floor(frameCarry);
    if (wholeFrames > 0) {
      frameCarry -= wholeFrames;
      currentFrame = nextLoopedFrame(currentFrame, wholeFrames);
      applyPreview();
      updateControlsFromFrame();
    }
  }
  controls.update();
  renderScene();
  requestAnimationFrame(animate);
}

customClips = loadCustomClips();
refreshClipSelect();
setCameraView('front');
loadDocument('clean_idle');
resize();
refreshAll();
requestAnimationFrame(animate);

(window as any).__IBRAWLS_V3_CLEAN_ANIMATION_EDITOR__ = {
  get document() {
    return documentState;
  },
  sampleCurrentFrame: () => currentSample,
  importJson: (json: string) => {
    const imported = normalizeV3AuthoredClipExport(json);
    replaceDocumentClip(imported, {
      activeOption: imported.id,
      dirty: true,
      message: `Imported ${imported.label}`,
    });
    return documentState.clip;
  },
};
