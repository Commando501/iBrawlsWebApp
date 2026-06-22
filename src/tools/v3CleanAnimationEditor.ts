import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  applyV3CleanRigPose,
  analyzeV3CleanRigContinuity,
  getV3CleanJointWorldPosition,
  type V3CleanJointName,
  type V3QuatTuple,
  type V3Vec3Tuple,
} from '../components/grifball/v3CleanRig';
import { animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import {
  ATLAS_EDITOR_EXPORT_VERSION,
  sampleV3AuthoredClipData,
  V3_AUTHORED_ANIMATION_CLIP_IDS,
  type V3AuthoredClipId,
  type V3AuthoredKeyframe,
} from '../components/grifball/v3AuthoredAnimationClips';
import { V3_DETAIL_BONE_NAMES, V3_DETAIL_BONE_SPECS } from '../components/v3/v3RigDetail';
import {
  copyV3CleanEditorFrame,
  createV3CleanEditorDocument,
  deleteV3CleanEditorKeyframe,
  getV3CleanEditorFrameDraft,
  mirrorV3CleanEditorFrame,
  normalizeV3AuthoredClipExport,
  pasteV3CleanEditorFrame,
  resetV3CleanEditorFrame,
  resetV3CleanEditorJoint,
  setV3CleanEditorJointEuler,
  setV3CleanEditorRootOffset,
  setV3CleanEditorWeaponPose,
  type V3CleanEditorDocument,
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
const setKeyframeButton = document.getElementById('set-keyframe') as HTMLButtonElement;
const deleteKeyframeButton = document.getElementById('delete-keyframe') as HTMLButtonElement;
const resetFrameButton = document.getElementById('reset-frame') as HTMLButtonElement;
const applyJointButton = document.getElementById('apply-joint') as HTMLButtonElement;
const resetJointButton = document.getElementById('reset-joint') as HTMLButtonElement;
const mirrorFrameButton = document.getElementById('mirror-frame') as HTMLButtonElement;
const applyRootButton = document.getElementById('apply-root') as HTMLButtonElement;
const applyWeaponButton = document.getElementById('apply-weapon') as HTMLButtonElement;
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
const saveLocalButton = document.getElementById('save-local') as HTMLButtonElement;
const clearLocalButton = document.getElementById('clear-local') as HTMLButtonElement;
const sendAtlasButton = document.getElementById('send-atlas') as HTMLButtonElement;

const LOCAL_STORAGE_PREFIX = 'ibrawls_v3_clean_editor_clip_';
const ATLAS_PREVIEW_STORAGE_KEY = 'ibrawls_v3_clean_editor_preview_clip';

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x030b0f, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(-0.08, 0.82, -0.18);

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

const rig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, {
  v3QualityTier: 'desktop',
  v3Distance: 0,
  v3SourceFidelity: 'exact',
});
rig.group.rotation.y = 0;

let documentState: V3CleanEditorDocument = createV3CleanEditorDocument('clean_idle');
let currentFrame = 0;
let playing = false;
let frameCarry = 0;
let lastTimeMs = 0;
let clipboardFrame: V3AuthoredKeyframe | null = null;
let currentSample = sampleV3AuthoredClipData(documentState.clip, { frame: 0 });

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

const storageKey = (clipId = documentState.clip.id): string => `${LOCAL_STORAGE_PREFIX}${clipId}`;

const setStatus = (message: string): void => {
  statusElement.textContent = message;
};

for (const clipId of V3_AUTHORED_ANIMATION_CLIP_IDS) {
  const option = document.createElement('option');
  option.value = clipId;
  option.textContent = clipId.replace(/^clean_/, '').replace(/_/g, ' ');
  clipSelect.appendChild(option);
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
    documentState = raw
      ? { ...createV3CleanEditorDocument(clipId), clip: normalizeV3AuthoredClipExport(raw) }
      : createV3CleanEditorDocument(clipId);
  } catch {
    documentState = createV3CleanEditorDocument(clipId);
  }
  currentFrame = 0;
  clipSelect.value = documentState.clip.id;
  setStatus(`Loaded ${documentState.clip.label}`);
  refreshAll();
}

function saveDocument(): void {
  window.localStorage.setItem(storageKey(), JSON.stringify(documentState.clip));
  setStatus(`Saved local draft for ${documentState.clip.id}`);
}

function selectedJoint(): V3CleanJointName {
  return jointSelect.value as V3CleanJointName;
}

function setCameraView(view: 'front' | 'left' | 'rear' | 'right'): void {
  const distance = 3.8;
  const y = 1.08;
  if (view === 'front') camera.position.set(0, y, 3.2);
  if (view === 'left') camera.position.set(-distance, y, -0.18);
  if (view === 'rear') camera.position.set(0, y, -3.8);
  if (view === 'right') camera.position.set(distance, y, -0.18);
  controls.target.set(-0.08, 0.82, -0.18);
  camera.lookAt(controls.target);
  controls.update();
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

function drawSeams(): void {
  const report = analyzeV3CleanRigContinuity(rig.group);
  if (!showSeamsInput.checked) {
    validationElement.textContent = report.ready
      ? `Clean rig ready. Max seam gap ${report.maxJointSeamGap.toFixed(4)}.`
      : report.warnings.join('\n');
    return;
  }
  for (const link of report.links) {
    const color = link.gap > 0.08 ? 0xfb7185 : 0x94a3b8;
    overlayRoot.add(line(new THREE.Vector3(...link.endpoints.parent), new THREE.Vector3(...link.endpoints.child), color, 0.9));
  }
  validationElement.textContent = [
    `Clean rig ready: ${report.ready}`,
    `Max seam gap: ${report.maxJointSeamGap.toFixed(4)}`,
    ...report.jointSeamWarnings,
  ].join('\n');
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
  drawSeams();
  if (showReferenceInput.checked) {
    validationElement.textContent += '\nMixamo reference display is reference-only; manual clean rig keys remain authoritative.';
  }
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
}

function updateKeyframeList(): void {
  keyframeListElement.textContent = documentState.clip.keyframes
    .map((keyframe) => {
      const joints = Object.keys(keyframe.jointQuaternions).length;
      const weapon = keyframe.weaponPose?.weapon ?? 'hidden';
      return `frame ${keyframe.frame.toString().padStart(3, ' ')} | joints ${joints.toString().padStart(2, ' ')} | weapon ${weapon}`;
    })
    .join('\n');
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
  clipSelect.value = documentState.clip.id;
  updateKeyframeList();
  if (document.activeElement !== jsonOutput) {
    jsonOutput.value = JSON.stringify(documentState.clip, null, 2);
  }
  playButton.textContent = playing ? 'Pause' : 'Play';
  setStatus(`${documentState.clip.label} | frame ${currentFrame}/${documentState.clip.durationFrames} | source manual editor`);
}

function refreshAll(): void {
  currentFrame = clampFrame(currentFrame);
  applyPreview();
  updateControlsFromFrame();
}

function applyJointInputs(): void {
  documentState.clip = setV3CleanEditorJointEuler(documentState.clip, {
    frame: currentFrame,
    joint: selectedJoint(),
    euler: tupleFromInputs(jointRxInput, jointRyInput, jointRzInput),
  });
  refreshAll();
}

function applyRootInputs(): void {
  documentState.clip = setV3CleanEditorRootOffset(documentState.clip, {
    frame: currentFrame,
    rootOffset: tupleFromInputs(rootXInput, rootYInput, rootZInput),
  });
  refreshAll();
}

function applyWeaponInputs(): void {
  const weapon = weaponSelect.value;
  if (weapon !== 'hammer' && weapon !== 'sword' && weapon !== 'pistol') {
    documentState.clip = clearV3CleanEditorWeaponPose(documentState.clip, currentFrame);
    refreshAll();
    return;
  }
  documentState.clip = setV3CleanEditorWeaponPose(documentState.clip, {
    frame: currentFrame,
    weapon,
    position: tupleFromInputs(weaponXInput, weaponYInput, weaponZInput),
    rotation: tupleFromInputs(weaponRxInput, weaponRyInput, weaponRzInput),
    primarySocketMarker: tupleFromInputs(primaryXInput, primaryYInput, primaryZInput),
    offhandSocketMarker: tupleFromInputs(offhandXInput, offhandYInput, offhandZInput),
  });
  refreshAll();
}

function importFromTextarea(): void {
  try {
    const imported = normalizeV3AuthoredClipExport(jsonOutput.value);
    documentState = {
      version: ATLAS_EDITOR_EXPORT_VERSION,
      clip: imported,
      selection: { target: 'joint', joint: selectedJoint() },
    };
    currentFrame = 0;
    setStatus(`Imported ${imported.label}`);
    refreshAll();
  } catch (error) {
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
}

clipSelect.addEventListener('change', () => loadDocument(clipSelect.value as V3AuthoredClipId));
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
  documentState.clip = normalizeV3AuthoredClipExport({
    ...documentState.clip,
    durationFrames: Math.max(1, Math.floor(numberValue(durationInput, documentState.clip.durationFrames))),
  });
  currentFrame = clampFrame(currentFrame);
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
setKeyframeButton.addEventListener('click', () => {
  applyJointInputs();
  applyRootInputs();
  if (weaponSelect.value) applyWeaponInputs();
});
deleteKeyframeButton.addEventListener('click', () => {
  documentState.clip = deleteV3CleanEditorKeyframe(documentState.clip, currentFrame);
  refreshAll();
});
resetFrameButton.addEventListener('click', () => {
  documentState.clip = resetV3CleanEditorFrame(documentState.clip, currentFrame);
  refreshAll();
});
resetJointButton.addEventListener('click', () => {
  documentState.clip = resetV3CleanEditorJoint(documentState.clip, { frame: currentFrame, joint: selectedJoint() });
  refreshAll();
});
mirrorFrameButton.addEventListener('click', () => {
  documentState.clip = mirrorV3CleanEditorFrame(documentState.clip, currentFrame);
  refreshAll();
});
copyFrameButton.addEventListener('click', () => {
  clipboardFrame = copyV3CleanEditorFrame(documentState.clip, currentFrame);
  setStatus(`Copied frame ${currentFrame}`);
});
pasteFrameButton.addEventListener('click', () => {
  if (!clipboardFrame) return;
  documentState.clip = pasteV3CleanEditorFrame(documentState.clip, { frame: currentFrame, keyframe: clipboardFrame });
  refreshAll();
});
copyPrevFrameButton.addEventListener('click', () => {
  clipboardFrame = copyV3CleanEditorFrame(documentState.clip, clampFrame(currentFrame - 1));
  documentState.clip = pasteV3CleanEditorFrame(documentState.clip, { frame: currentFrame, keyframe: clipboardFrame });
  refreshAll();
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
saveLocalButton.addEventListener('click', () => saveDocument());
clearLocalButton.addEventListener('click', () => {
  window.localStorage.removeItem(storageKey());
  setStatus(`Cleared local draft for ${documentState.clip.id}`);
});
sendAtlasButton.addEventListener('click', () => {
  window.localStorage.setItem(ATLAS_PREVIEW_STORAGE_KEY, JSON.stringify(documentState.clip));
  setStatus('Sent current draft to atlas preview storage');
});

window.addEventListener('resize', () => {
  resize();
  refreshAll();
});

function animate(timeMs: number): void {
  if (lastTimeMs === 0) lastTimeMs = timeMs;
  const delta = Math.min(0.08, Math.max(0, (timeMs - lastTimeMs) / 1000));
  lastTimeMs = timeMs;
  if (playing) {
    frameCarry += delta * 60 * Math.max(0.1, Math.min(4, numberValue(speedInput, 1)));
    const wholeFrames = Math.floor(frameCarry);
    if (wholeFrames > 0) {
      frameCarry -= wholeFrames;
      currentFrame = currentFrame + wholeFrames > documentState.clip.durationFrames
        ? 0
        : currentFrame + wholeFrames;
      applyPreview();
      updateControlsFromFrame();
    }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

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
    documentState.clip = normalizeV3AuthoredClipExport(json);
    currentFrame = 0;
    refreshAll();
    return documentState.clip;
  },
};
