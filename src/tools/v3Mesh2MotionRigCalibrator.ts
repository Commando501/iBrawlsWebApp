import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { animateV3CombatantModel, animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import {
  getV3Mesh2MotionDriverRig,
  type V3Mesh2MotionDriverRig,
  type V3Mesh2MotionDriverWeaponSocketName,
} from '../components/grifball/v3Mesh2MotionDriverRig';
import { V3_MESH2MOTION_CLIP_SET } from '../components/grifball/v3Mesh2MotionClips.generated';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import type { V3AuthoredClipId } from '../components/grifball/v3AuthoredAnimationClips';
import { type V3CharacterSlotId, type V3WeaponId } from '../components/v3/v3ModelTypes';
import {
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  buildV3Mesh2MotionCalibrationDiagnostics,
  computeDriverJointAdjustmentFromWorldTransform,
  computePartBindingAdjustmentFromWorldTransform,
  computeWeaponSocketAdjustmentFromWorldTransform,
  getV3Mesh2MotionCalibrationTargetWorldTransform,
  listV3Mesh2MotionCalibrationTargets,
  normalizeV3Mesh2MotionCalibration,
  parseV3Mesh2MotionCalibrationJson,
  serializeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
  type V3Mesh2MotionCalibrationTargetDescriptor,
} from './v3Mesh2MotionRigCalibratorCore';

type Mesh2MotionPreviewClipId = Extract<
  V3AuthoredClipId,
  'clean_sprint' | 'clean_slide' | 'clean_sword_carry' | 'clean_sword_lunge' | 'clean_sword_slash'
>;

type EditMode = V3Mesh2MotionCalibrationTargetDescriptor['kind'];
type CalibrationTuple = [number, number, number];
type CalibrationTransform = { position: CalibrationTuple; rotation: CalibrationTuple };

interface PreviewClipConfig {
  id: Mesh2MotionPreviewClipId;
  label: string;
  durationFrames: number;
  activeWeapon: V3WeaponId;
  weaponState: string;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
}

const LOCAL_STORAGE_KEY = 'ibrawls_v3_mesh2motion_rig_calibration';
const ZERO_TRANSFORM: CalibrationTransform = { position: [0, 0, 0], rotation: [0, 0, 0] };
const MODE_LABELS: Record<EditMode, string> = {
  partBinding: 'V3 Part Binding',
  driverJoint: 'Mesh2Motion Bone',
  weaponSocket: 'Weapon Socket',
};

const CLIPS: Record<Mesh2MotionPreviewClipId, PreviewClipConfig> = {
  clean_sprint: {
    id: 'clean_sprint',
    label: 'Sprint',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSprinting: true,
  },
  clean_slide: {
    id: 'clean_slide',
    label: 'Slide',
    durationFrames: 72,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSliding: true,
  },
  clean_sword_carry: {
    id: 'clean_sword_carry',
    label: 'Sword Carry',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
  },
  clean_sword_lunge: {
    id: 'clean_sword_lunge',
    label: 'Sword Lunge',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isLunging: true,
  },
  clean_sword_slash: {
    id: 'clean_sword_slash',
    label: 'Sword Slash',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'slashing',
  },
};

const canvas = document.getElementById('calibrator-canvas') as HTMLCanvasElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const clipSelect = document.getElementById('clip-select') as HTMLSelectElement;
const playButton = document.getElementById('play') as HTMLButtonElement;
const prevFrameButton = document.getElementById('prev-frame') as HTMLButtonElement;
const nextFrameButton = document.getElementById('next-frame') as HTMLButtonElement;
const saveLocalButton = document.getElementById('save-local') as HTMLButtonElement;
const copyJsonButton = document.getElementById('copy-json') as HTMLButtonElement;
const downloadJsonButton = document.getElementById('download-json') as HTMLButtonElement;
const importJsonButton = document.getElementById('import-json') as HTMLButtonElement;
const chooseJsonButton = document.getElementById('choose-json') as HTMLButtonElement;
const clearLocalButton = document.getElementById('clear-local') as HTMLButtonElement;
const importFileInput = document.getElementById('import-file') as HTMLInputElement;
const frameInput = document.getElementById('frame-input') as HTMLInputElement;
const durationInput = document.getElementById('duration-input') as HTMLInputElement;
const speedInput = document.getElementById('speed-input') as HTMLInputElement;
const timelineInput = document.getElementById('timeline') as HTMLInputElement;
const leftSpreadInput = document.getElementById('left-spread') as HTMLInputElement;
const rightSpreadInput = document.getElementById('right-spread') as HTMLInputElement;
const modeButtons: Record<EditMode, HTMLButtonElement> = {
  partBinding: document.getElementById('mode-part-binding') as HTMLButtonElement,
  driverJoint: document.getElementById('mode-driver-joint') as HTMLButtonElement,
  weaponSocket: document.getElementById('mode-weapon-socket') as HTMLButtonElement,
};
const targetSelect = document.getElementById('target-select') as HTMLSelectElement;
const targetXInput = document.getElementById('target-x') as HTMLInputElement;
const targetYInput = document.getElementById('target-y') as HTMLInputElement;
const targetZInput = document.getElementById('target-z') as HTMLInputElement;
const targetRxInput = document.getElementById('target-rx') as HTMLInputElement;
const targetRyInput = document.getElementById('target-ry') as HTMLInputElement;
const targetRzInput = document.getElementById('target-rz') as HTMLInputElement;
const applyTargetButton = document.getElementById('apply-target') as HTMLButtonElement;
const resetTargetButton = document.getElementById('reset-target') as HTMLButtonElement;
const resetModeButton = document.getElementById('reset-mode') as HTMLButtonElement;
const resetAllButton = document.getElementById('reset-all') as HTMLButtonElement;
const transformTranslateButton = document.getElementById('transform-translate') as HTMLButtonElement;
const transformRotateButton = document.getElementById('transform-rotate') as HTMLButtonElement;
const targetSummaryElement = document.getElementById('target-summary') as HTMLPreElement;
const diagnosticsElement = document.getElementById('diagnostics') as HTMLPreElement;
const jsonOutput = document.getElementById('json-output') as HTMLTextAreaElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x030b0f, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 80);
camera.position.set(1.4, 1.25, 3.4);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.85, 0);

scene.add(new THREE.HemisphereLight(0xaeefff, 0x102028, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0x67e8f9, 0.8);
fillLight.position.set(-4, 2, -3);
scene.add(fillLight);

const floor = new THREE.GridHelper(4, 16, 0x24414a, 0x14242b);
floor.position.y = -0.06;
scene.add(floor);

const meshRig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, {
  v3QualityTier: 'desktop',
  v3Distance: 0,
  v3SourceFidelity: 'exact',
});

const allTargets = listV3Mesh2MotionCalibrationTargets();
const selectedTargetByMode: Record<EditMode, string> = {
  partBinding: 'chest',
  driverJoint: 'pelvis',
  weaponSocket: 'rightHandGrip',
};

const driverChildrenByParent = new Map<string, string[]>();
for (const joint of V3_MESH2MOTION_CLIP_SET.skeleton.joints) {
  const parent = joint.parent ? String(joint.parent) : null;
  if (!parent) continue;
  driverChildrenByParent.set(parent, [...(driverChildrenByParent.get(parent) ?? []), String(joint.name)]);
}

const targetHandle = new THREE.Group();
targetHandle.name = 'v3Mesh2MotionRigCalibratorTargetHandle';
const targetMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 20, 12),
  new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false })
);
targetMarker.renderOrder = 30;
targetHandle.add(targetMarker);
const targetRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.085, 0.006, 8, 24),
  new THREE.MeshBasicMaterial({ color: 0x67e8f9, depthTest: false })
);
targetRing.rotation.x = Math.PI / 2;
targetRing.renderOrder = 29;
targetHandle.add(targetRing);
scene.add(targetHandle);

const targetTetherGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(),
  new THREE.Vector3(),
]);
const targetTether = new THREE.Line(
  targetTetherGeometry,
  new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85, depthTest: false })
);
targetTether.renderOrder = 24;
scene.add(targetTether);

const selectedPartBox = new THREE.Box3Helper(new THREE.Box3(), 0xfacc15);
selectedPartBox.visible = false;
selectedPartBox.renderOrder = 23;
scene.add(selectedPartBox);

const skeletonOverlay = new THREE.Group();
skeletonOverlay.name = 'v3Mesh2MotionRigCalibratorSkeletonOverlay';
scene.add(skeletonOverlay);
const jointMarkers = new Map<string, THREE.Mesh>();
const boneLines = new Map<string, THREE.Line>();
const markerGeometry = new THREE.SphereGeometry(0.017, 10, 8);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSpace('local');
transformControls.setTranslationSnap(0.01);
transformControls.setRotationSnap(0.05);
transformControls.attach(targetHandle);
scene.add(transformControls.getHelper());

let calibration: V3Mesh2MotionCalibration = loadLocalCalibration();
let editMode: EditMode = 'partBinding';
let currentFrame = 30;
let playing = false;
let frameCarry = 0;
let lastTimeMs = 0;
let suppressHandleCommit = false;
let suppressInputCommit = false;

const cloneTransform = (value: CalibrationTransform): CalibrationTransform => ({
  position: [...value.position],
  rotation: [...value.rotation],
});

const vectorFromTuple = (tuple: readonly number[]): THREE.Vector3 =>
  new THREE.Vector3(tuple[0] ?? 0, tuple[1] ?? 0, tuple[2] ?? 0);

const tupleFromVector = (value: THREE.Vector3): CalibrationTuple => [value.x, value.y, value.z];

const quaternionFromRotation = (rotation: readonly number[]): THREE.Quaternion =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0, 'XYZ')).normalize();

const numberValue = (input: HTMLInputElement, fallback = 0): number => {
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
};

const selectedClip = (): PreviewClipConfig =>
  CLIPS[clipSelect.value as Mesh2MotionPreviewClipId] ?? CLIPS.clean_sword_slash;

const safeFrame = (frame: number): number =>
  Math.max(0, Math.min(selectedClip().durationFrames, Math.round(Number.isFinite(frame) ? frame : 0)));

function loadLocalCalibration(): V3Mesh2MotionCalibration {
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? parseV3Mesh2MotionCalibrationJson(raw) : normalizeV3Mesh2MotionCalibration(V3_MESH2MOTION_DEFAULT_CALIBRATION);
  } catch {
    return normalizeV3Mesh2MotionCalibration(V3_MESH2MOTION_DEFAULT_CALIBRATION);
  }
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

const targetsForMode = (mode: EditMode = editMode): V3Mesh2MotionCalibrationTargetDescriptor[] =>
  allTargets.filter((target) => target.kind === mode);

function selectedTarget(): V3Mesh2MotionCalibrationTargetDescriptor {
  const targets = targetsForMode();
  return targets.find((target) => target.id === selectedTargetByMode[editMode]) ?? targets[0];
}

function tupleFromInputs(
  x: HTMLInputElement,
  y: HTMLInputElement,
  z: HTMLInputElement
): CalibrationTuple {
  return [numberValue(x), numberValue(y), numberValue(z)];
}

function setTupleInputs(
  inputs: [HTMLInputElement, HTMLInputElement, HTMLInputElement],
  value: readonly number[]
): void {
  inputs[0].value = (value[0] ?? 0).toFixed(3);
  inputs[1].value = (value[1] ?? 0).toFixed(3);
  inputs[2].value = (value[2] ?? 0).toFixed(3);
}

function getTargetCalibration(target = selectedTarget()): CalibrationTransform {
  if (target.kind === 'driverJoint') {
    const value = calibration.driverJoints[target.id] ?? V3_MESH2MOTION_DEFAULT_CALIBRATION.driverJoints[target.id];
    return value ? cloneTransform(value) : cloneTransform(ZERO_TRANSFORM);
  }
  if (target.kind === 'partBinding') {
    const value = calibration.partBindings[target.id as V3CharacterSlotId];
    return value ? cloneTransform(value) : cloneTransform(ZERO_TRANSFORM);
  }
  return cloneTransform(calibration.weaponSockets[target.id as V3Mesh2MotionDriverWeaponSocketName]);
}

function setTargetCalibration(target: V3Mesh2MotionCalibrationTargetDescriptor, transform: CalibrationTransform): void {
  if (target.kind === 'driverJoint') {
    calibration = normalizeV3Mesh2MotionCalibration({
      ...calibration,
      driverJoints: {
        ...calibration.driverJoints,
        [target.id]: transform,
      },
    });
    return;
  }
  if (target.kind === 'partBinding') {
    calibration = normalizeV3Mesh2MotionCalibration({
      ...calibration,
      partBindings: {
        ...calibration.partBindings,
        [target.id]: transform,
      },
    });
    return;
  }
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    weaponSockets: {
      ...calibration.weaponSockets,
      [target.id]: transform,
    },
  });
}

function deleteTargetCalibration(target: V3Mesh2MotionCalibrationTargetDescriptor): void {
  if (target.kind === 'driverJoint') {
    const driverJoints = { ...calibration.driverJoints };
    const defaultTransform = V3_MESH2MOTION_DEFAULT_CALIBRATION.driverJoints[target.id];
    if (defaultTransform) {
      driverJoints[target.id] = cloneTransform(defaultTransform);
    } else {
      delete driverJoints[target.id];
    }
    calibration = normalizeV3Mesh2MotionCalibration({ ...calibration, driverJoints });
    return;
  }
  if (target.kind === 'partBinding') {
    const partBindings = { ...calibration.partBindings };
    delete partBindings[target.id as V3CharacterSlotId];
    calibration = normalizeV3Mesh2MotionCalibration({ ...calibration, partBindings });
    return;
  }
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    weaponSockets: {
      ...calibration.weaponSockets,
      [target.id]: V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets[target.id as V3Mesh2MotionDriverWeaponSocketName],
    },
  });
}

function readArmSpreadIntoCalibration(): void {
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    armSpread: {
      left: numberValue(leftSpreadInput, calibration.armSpread.left),
      right: numberValue(rightSpreadInput, calibration.armSpread.right),
    },
  });
}

function syncTargetOptions(): void {
  const current = selectedTargetByMode[editMode];
  targetSelect.replaceChildren();
  for (const target of targetsForMode()) {
    const option = document.createElement('option');
    option.value = target.id;
    option.textContent = target.label;
    targetSelect.appendChild(option);
  }
  targetSelect.value = current;
  if (targetSelect.value !== current) {
    selectedTargetByMode[editMode] = targetSelect.value;
  }
}

function syncInputsFromCalibration(): void {
  suppressInputCommit = true;
  leftSpreadInput.value = calibration.armSpread.left.toFixed(3);
  rightSpreadInput.value = calibration.armSpread.right.toFixed(3);
  for (const [mode, button] of Object.entries(modeButtons) as [EditMode, HTMLButtonElement][]) {
    button.classList.toggle('active', mode === editMode);
    button.setAttribute('aria-pressed', String(mode === editMode));
  }
  syncTargetOptions();
  const transform = getTargetCalibration();
  setTupleInputs([targetXInput, targetYInput, targetZInput], transform.position);
  setTupleInputs([targetRxInput, targetRyInput, targetRzInput], transform.rotation);
  jsonOutput.value = serializeV3Mesh2MotionCalibration(calibration);
  suppressInputCommit = false;
}

function selectedTargetTransformFromInputs(): CalibrationTransform {
  return {
    position: tupleFromInputs(targetXInput, targetYInput, targetZInput),
    rotation: tupleFromInputs(targetRxInput, targetRyInput, targetRzInput),
  };
}

function commitInputsToTarget(message = 'Target updated'): void {
  if (suppressInputCommit) return;
  setTargetCalibration(selectedTarget(), selectedTargetTransformFromInputs());
  syncInputsFromCalibration();
  applyPreview(message);
}

function resetModeCalibration(): void {
  if (editMode === 'driverJoint') {
    calibration = normalizeV3Mesh2MotionCalibration({
      ...calibration,
      driverJoints: V3_MESH2MOTION_DEFAULT_CALIBRATION.driverJoints,
    });
    return;
  }
  if (editMode === 'partBinding') {
    calibration = normalizeV3Mesh2MotionCalibration({ ...calibration, partBindings: {} });
    return;
  }
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    weaponSockets: V3_MESH2MOTION_DEFAULT_CALIBRATION.weaponSockets,
  });
}

function selectedTargetBaseWorldPosition(rig: V3Mesh2MotionDriverRig, target = selectedTarget()): THREE.Vector3 | null {
  if (target.kind === 'driverJoint') {
    const joint = rig.joints[target.id];
    const parent = joint?.object.parent;
    if (!joint || !parent) return null;
    return parent.getWorldPosition(new THREE.Vector3());
  }
  const sourceJoint = target.sourceJointName ? rig.joints[target.sourceJointName] : null;
  return sourceJoint?.object.getWorldPosition(new THREE.Vector3()) ?? null;
}

function updateTargetTether(rig: V3Mesh2MotionDriverRig): void {
  const from = selectedTargetBaseWorldPosition(rig);
  if (!from) {
    targetTether.visible = false;
    return;
  }
  targetTether.visible = true;
  const positionAttribute = targetTetherGeometry.getAttribute('position') as THREE.BufferAttribute;
  positionAttribute.setXYZ(0, from.x, from.y, from.z);
  positionAttribute.setXYZ(1, targetHandle.position.x, targetHandle.position.y, targetHandle.position.z);
  positionAttribute.needsUpdate = true;
  targetTetherGeometry.computeBoundingSphere();
}

function ensureSkeletonOverlay(rig: V3Mesh2MotionDriverRig): void {
  for (const joint of Object.values(rig.joints)) {
    if (!jointMarkers.has(joint.name)) {
      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshBasicMaterial({ color: 0x67e8f9, depthTest: false, transparent: true, opacity: 0.86 })
      );
      marker.renderOrder = 22;
      skeletonOverlay.add(marker);
      jointMarkers.set(joint.name, marker);
    }
    if (joint.parentName && rig.joints[joint.parentName] && !boneLines.has(joint.name)) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0x67e8f9, transparent: true, opacity: 0.45, depthTest: false })
      );
      line.renderOrder = 21;
      skeletonOverlay.add(line);
      boneLines.set(joint.name, line);
    }
  }
}

function updateSkeletonOverlay(rig: V3Mesh2MotionDriverRig): void {
  const target = selectedTarget();
  const sourceJointName = target.kind === 'driverJoint' ? target.id : target.sourceJointName;
  const childNames = sourceJointName ? driverChildrenByParent.get(sourceJointName) ?? [] : [];
  ensureSkeletonOverlay(rig);
  for (const joint of Object.values(rig.joints)) {
    const marker = jointMarkers.get(joint.name);
    if (!marker) continue;
    marker.visible = true;
    marker.position.copy(joint.object.getWorldPosition(new THREE.Vector3()));
    const material = marker.material as THREE.MeshBasicMaterial;
    if (joint.name === sourceJointName) {
      material.color.setHex(0xfacc15);
      marker.scale.setScalar(1.8);
    } else if (childNames.includes(joint.name) || joint.name === target.parentJointName) {
      material.color.setHex(0xfb7185);
      marker.scale.setScalar(1.25);
    } else {
      material.color.setHex(0x67e8f9);
      marker.scale.setScalar(1);
    }
  }
  for (const joint of Object.values(rig.joints)) {
    const line = boneLines.get(joint.name);
    if (!line || !joint.parentName) continue;
    const parent = rig.joints[joint.parentName];
    if (!parent) {
      line.visible = false;
      continue;
    }
    line.visible = true;
    const from = parent.object.getWorldPosition(new THREE.Vector3());
    const to = joint.object.getWorldPosition(new THREE.Vector3());
    const positionAttribute = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.setXYZ(0, from.x, from.y, from.z);
    positionAttribute.setXYZ(1, to.x, to.y, to.z);
    positionAttribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    const material = line.material as THREE.LineBasicMaterial;
    material.color.setHex(joint.name === sourceJointName || childNames.includes(joint.name) ? 0xfacc15 : 0x67e8f9);
    material.opacity = joint.name === sourceJointName || childNames.includes(joint.name) ? 0.9 : 0.35;
  }
}

function updateSelectedPartBox(rig: V3Mesh2MotionDriverRig): void {
  const target = selectedTarget();
  const binding = target.kind === 'partBinding'
    ? rig.partBindings[target.id as V3CharacterSlotId]
    : null;
  if (!binding) {
    selectedPartBox.visible = false;
    return;
  }
  selectedPartBox.visible = true;
  selectedPartBox.box.copy(new THREE.Box3().setFromObject(binding.partGroup));
  selectedPartBox.updateMatrixWorld(true);
}

function updateTargetHandle(): void {
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  const target = selectedTarget();
  const transform = getV3Mesh2MotionCalibrationTargetWorldTransform(meshRig.group, target.kind, target.id, rig);
  if (!transform) {
    targetHandle.visible = false;
    transformControls.enabled = false;
    targetTether.visible = false;
    return;
  }
  suppressHandleCommit = true;
  targetHandle.visible = true;
  transformControls.enabled = true;
  targetHandle.position.copy(transform.position);
  targetHandle.quaternion.copy(transform.quaternion);
  targetHandle.rotation.setFromQuaternion(targetHandle.quaternion);
  targetHandle.updateMatrixWorld(true);
  updateTargetTether(rig);
  suppressHandleCommit = false;
}

function commitTargetHandleToCalibration(): void {
  const target = selectedTarget();
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  targetHandle.updateMatrixWorld(true);

  if (target.kind === 'driverJoint') {
    const joint = rig.joints[target.id];
    const parent = joint?.object.parent;
    if (!joint || !parent) return;
    const current = getTargetCalibration(target);
    const baseLocalPosition = joint.object.position.clone().sub(vectorFromTuple(current.position));
    const baseLocalQuaternion = joint.object.quaternion.clone()
      .multiply(quaternionFromRotation(current.rotation).invert())
      .normalize();
    parent.updateWorldMatrix(true, false);
    const next = computeDriverJointAdjustmentFromWorldTransform({
      parentWorldMatrix: parent.matrixWorld,
      handleWorldMatrix: targetHandle.matrixWorld,
      baseLocalPosition,
      baseLocalQuaternion,
    });
    setTargetCalibration(target, {
      position: tupleFromVector(next.position),
      rotation: next.rotation,
    });
  } else if (target.kind === 'partBinding') {
    const binding = rig.partBindings[target.id as V3CharacterSlotId];
    const joint = binding ? rig.joints[binding.sourceJointName] : null;
    if (!binding || !joint) return;
    joint.object.updateWorldMatrix(true, false);
    const baseWorldMatrix = joint.object.matrixWorld.clone().multiply(binding.bindMatrix);
    const next = computePartBindingAdjustmentFromWorldTransform({
      baseWorldMatrix,
      handleWorldMatrix: targetHandle.matrixWorld,
    });
    setTargetCalibration(target, {
      position: tupleFromVector(next.position),
      rotation: next.rotation,
    });
  } else {
    const socket = rig.weaponSockets[target.id as V3Mesh2MotionDriverWeaponSocketName];
    const parent = socket?.object.parent;
    if (!socket || !parent) return;
    parent.updateWorldMatrix(true, false);
    const next = computeWeaponSocketAdjustmentFromWorldTransform({
      parentWorldMatrix: parent.matrixWorld,
      handleWorldMatrix: targetHandle.matrixWorld,
      restLocalPosition: vectorFromTuple(socket.restLocalPosition),
    });
    setTargetCalibration(target, {
      position: tupleFromVector(next.position),
      rotation: next.rotation,
    });
  }

  syncInputsFromCalibration();
  applyPreview('Target handle adjusted');
}

function maxSlotDrift(rig: V3Mesh2MotionDriverRig): number {
  let maxDrift = 0;
  for (const binding of Object.values(rig.partBindings)) {
    if (!binding) continue;
    const joint = rig.joints[binding.sourceJointName];
    if (!joint) continue;
    const partCenter = new THREE.Box3().setFromObject(binding.partGroup).getCenter(new THREE.Vector3());
    const jointCenter = joint.object.getWorldPosition(new THREE.Vector3());
    maxDrift = Math.max(maxDrift, partCenter.distanceTo(jointCenter));
  }
  return maxDrift;
}

function footFloorClearance(): number {
  const partGroups = meshRig.group.userData.v3PartGroups as Record<string, THREE.Object3D> | undefined;
  const footLeft = partGroups?.footLeft ? new THREE.Box3().setFromObject(partGroups.footLeft).min.y : Number.POSITIVE_INFINITY;
  const footRight = partGroups?.footRight ? new THREE.Box3().setFromObject(partGroups.footRight).min.y : Number.POSITIVE_INFINITY;
  return Math.min(footLeft, footRight);
}

function formatTargetSummary(): string {
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  const target = selectedTarget();
  const targetTransform = getTargetCalibration(target);
  const worldTransform = getV3Mesh2MotionCalibrationTargetWorldTransform(meshRig.group, target.kind, target.id, rig);
  const sourceJointName = target.kind === 'driverJoint' ? target.id : target.sourceJointName;
  const sourceJoint = sourceJointName ? rig.joints[sourceJointName] : null;
  const childNames = sourceJointName ? driverChildrenByParent.get(sourceJointName) ?? [] : [];
  const worldPosition = worldTransform?.position;
  const parentPosition = target.parentJointName ? rig.joints[target.parentJointName]?.object.getWorldPosition(new THREE.Vector3()) : null;
  const parentDistance = worldPosition && parentPosition ? worldPosition.distanceTo(parentPosition) : null;
  const childDistances = worldPosition
    ? childNames
      .filter((name) => rig.joints[name])
      .map((name) => `${name}:${worldPosition.distanceTo(rig.joints[name].object.getWorldPosition(new THREE.Vector3())).toFixed(3)}`)
    : [];
  const offsetMagnitude = vectorFromTuple(targetTransform.position).length();
  const rotationDegrees = targetTransform.rotation.map((value) => THREE.MathUtils.radToDeg(value).toFixed(1));
  const warnings = [
    !target.hasVisibleBinding ? 'Warning: target has no directly bound visible V3 armor part.' : null,
    offsetMagnitude > 0.24 ? 'Warning: position offset is near the clamp limit.' : null,
    Math.max(...targetTransform.rotation.map(Math.abs)) > Math.PI * 0.75 ? 'Warning: rotation offset is near the clamp limit.' : null,
  ].filter(Boolean) as string[];

  return [
    `${MODE_LABELS[target.kind]}: ${target.label}`,
    `Source joint: ${sourceJointName ?? 'none'}`,
    `Affected slots: ${target.affectedSlots.length ? target.affectedSlots.join(', ') : 'none'}`,
    `Local offset magnitude: ${offsetMagnitude.toFixed(3)}`,
    `Rotation degrees: ${rotationDegrees.join(', ')}`,
    `Parent distance: ${parentDistance === null ? 'n/a' : parentDistance.toFixed(3)}`,
    `Child distances: ${childDistances.length ? childDistances.join('  ') : 'none'}`,
    `World position: ${worldPosition ? worldPosition.toArray().map((value) => value.toFixed(3)).join(', ') : 'n/a'}`,
    ...warnings,
    sourceJoint ? '' : 'Warning: source joint is not available in the current driver rig.',
  ].filter((line) => line !== '').join('\n');
}

function formatDiagnostics(): string {
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  const report = buildV3Mesh2MotionCalibrationDiagnostics(meshRig.group, meshRig.sword, 'sword');
  const slotDrift = maxSlotDrift(rig);
  const floorClearance = footFloorClearance();
  return [
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    report.warnings.length ? `Warnings: ${report.warnings.join(', ')}` : 'Warnings: none',
    `Max slot drift: ${slotDrift.toFixed(3)}`,
    `Foot floor clearance: ${Number.isFinite(floorClearance) ? floorClearance.toFixed(3) : 'n/a'}`,
    '',
    'Chest / arm clearance:',
    ...report.arms.left.clearances.map((entry) =>
      `${entry.status.padEnd(4)} ${entry.slot.padEnd(13)} gap ${entry.outwardGap.toFixed(3)} chest-intersect ${entry.intersectsChest}`
    ),
    ...report.arms.right.clearances.map((entry) =>
      `${entry.status.padEnd(4)} ${entry.slot.padEnd(13)} gap ${entry.outwardGap.toFixed(3)} chest-intersect ${entry.intersectsChest}`
    ),
    '',
    'Chain continuity:',
    ...[...report.arms.left.chainLinks, ...report.arms.right.chainLinks].map((entry) =>
      `${entry.status.padEnd(4)} ${entry.id.padEnd(28)} distance ${entry.distance.toFixed(3)}`
    ),
    '',
    report.weapon
      ? [
        `Weapon primary grip drift: ${report.weapon.primaryGripDrift.toFixed(3)}`,
        `Weapon offhand grip drift: ${report.weapon.offhandGripDrift === null ? 'n/a' : report.weapon.offhandGripDrift.toFixed(3)}`,
        `Weapon forward alignment: ${report.weapon.forwardAlignment.toFixed(3)}`,
        `Weapon up alignment: ${report.weapon.upAlignment.toFixed(3)}`,
      ].join('\n')
      : 'Weapon diagnostics unavailable',
  ].join('\n');
}

function updateOverlays(): void {
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  updateSkeletonOverlay(rig);
  updateSelectedPartBox(rig);
  updateTargetTether(rig);
}

function applyPreview(message?: string): void {
  readArmSpreadIntoCalibration();
  setV3Mesh2MotionCalibrationOverride(calibration);
  const clip = selectedClip();
  currentFrame = safeFrame(currentFrame);
  const normalizedTime = currentFrame / Math.max(1, clip.durationFrames);
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;

  animateV3CombatantModel({
    refs,
    mesh: meshRig.group,
    vel: new THREE.Vector3(4, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: clip.activeWeapon,
    weaponState: clip.weaponState,
    weaponTimer: normalizedTime,
    dt: 1,
    settings: {},
    animationClockMs: normalizedTime * 1000,
    isLocalV3Animation: true,
    v3PoseAlphaOverride: 1,
    v3AnimationAuthority: 'cleanRig',
    v3AuthoredClipId: clip.id,
    v3AuthoredNormalizedTime: normalizedTime,
    isSliding: clip.isSliding,
    isSprinting: clip.isSprinting,
    isLunging: clip.isLunging,
  });
  animateV3WeaponMeshes({
    hammerModel: meshRig.hammer,
    swordModel: meshRig.sword,
    pistolModel: meshRig.pistol,
    activeWeapon: clip.activeWeapon,
    weaponState: clip.weaponState,
    weaponTimer: normalizedTime,
    isLunging: clip.isLunging === true,
    dt: 1,
    settings: {},
    combatantModel: meshRig.group,
    v3AnimationAuthority: 'cleanRig',
    v3AuthoredClipId: clip.id,
    v3AuthoredNormalizedTime: normalizedTime,
  });
  meshRig.hammer.visible = false;
  meshRig.sword.visible = clip.id.startsWith('clean_sword');
  if (meshRig.pistol) meshRig.pistol.visible = false;
  meshRig.group.updateWorldMatrix(true, true);
  meshRig.sword.updateWorldMatrix(true, true);
  updateTargetHandle();
  updateOverlays();
  syncInputsFromCalibration();
  targetSummaryElement.textContent = formatTargetSummary();
  diagnosticsElement.textContent = formatDiagnostics();
  if (message) setStatus(message);
}

function updateClipControls(): void {
  const clip = selectedClip();
  durationInput.value = String(clip.durationFrames);
  timelineInput.max = String(clip.durationFrames);
  frameInput.max = String(clip.durationFrames);
  currentFrame = safeFrame(currentFrame);
  frameInput.value = String(currentFrame);
  timelineInput.value = String(currentFrame);
}

function setCalibration(next: unknown, message: string): void {
  calibration = normalizeV3Mesh2MotionCalibration(next);
  syncInputsFromCalibration();
  applyPreview(message);
}

function setMode(mode: EditMode): void {
  editMode = mode;
  syncInputsFromCalibration();
  applyPreview(`${MODE_LABELS[mode]} mode`);
}

function resize(): void {
  const parent = canvas.parentElement;
  const width = Math.max(1, parent?.clientWidth ?? window.innerWidth);
  const height = Math.max(1, parent?.clientHeight ?? window.innerHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

clipSelect.addEventListener('change', () => {
  updateClipControls();
  applyPreview(`Loaded ${selectedClip().label}`);
});
timelineInput.addEventListener('input', () => {
  currentFrame = safeFrame(numberValue(timelineInput));
  frameInput.value = String(currentFrame);
  applyPreview();
});
frameInput.addEventListener('change', () => {
  currentFrame = safeFrame(numberValue(frameInput));
  timelineInput.value = String(currentFrame);
  applyPreview();
});
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.classList.toggle('active', playing);
});
prevFrameButton.addEventListener('click', () => {
  playing = false;
  playButton.classList.remove('active');
  currentFrame = safeFrame(currentFrame - 1);
  timelineInput.value = String(currentFrame);
  frameInput.value = String(currentFrame);
  applyPreview();
});
nextFrameButton.addEventListener('click', () => {
  playing = false;
  playButton.classList.remove('active');
  currentFrame = safeFrame(currentFrame + 1);
  timelineInput.value = String(currentFrame);
  frameInput.value = String(currentFrame);
  applyPreview();
});

for (const input of [leftSpreadInput, rightSpreadInput]) {
  input.addEventListener('change', () => applyPreview('Arm spread updated'));
}
for (const input of [targetXInput, targetYInput, targetZInput, targetRxInput, targetRyInput, targetRzInput]) {
  input.addEventListener('change', () => commitInputsToTarget());
}
for (const [mode, button] of Object.entries(modeButtons) as [EditMode, HTMLButtonElement][]) {
  button.addEventListener('click', () => setMode(mode));
}
targetSelect.addEventListener('change', () => {
  selectedTargetByMode[editMode] = targetSelect.value;
  syncInputsFromCalibration();
  applyPreview(`Selected ${selectedTarget().label}`);
});
applyTargetButton.addEventListener('click', () => commitInputsToTarget('Target values applied'));
resetTargetButton.addEventListener('click', () => {
  deleteTargetCalibration(selectedTarget());
  syncInputsFromCalibration();
  applyPreview(`Reset ${selectedTarget().label}`);
});
resetModeButton.addEventListener('click', () => {
  resetModeCalibration();
  syncInputsFromCalibration();
  applyPreview(`Reset ${MODE_LABELS[editMode]}`);
});
resetAllButton.addEventListener('click', () => setCalibration(V3_MESH2MOTION_DEFAULT_CALIBRATION, 'Reset all calibration'));
transformTranslateButton.addEventListener('click', () => {
  transformControls.setMode('translate');
  transformTranslateButton.classList.add('active');
  transformRotateButton.classList.remove('active');
});
transformRotateButton.addEventListener('click', () => {
  transformControls.setMode('rotate');
  transformRotateButton.classList.add('active');
  transformTranslateButton.classList.remove('active');
});
transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !event.value;
});
transformControls.addEventListener('objectChange', () => {
  if (suppressHandleCommit) return;
  commitTargetHandleToCalibration();
});

saveLocalButton.addEventListener('click', () => {
  window.localStorage.setItem(LOCAL_STORAGE_KEY, serializeV3Mesh2MotionCalibration(calibration));
  setStatus('Saved local Mesh2Motion calibration draft');
});
clearLocalButton.addEventListener('click', () => {
  window.localStorage.removeItem(LOCAL_STORAGE_KEY);
  setCalibration(V3_MESH2MOTION_DEFAULT_CALIBRATION, 'Cleared local draft');
});
copyJsonButton.addEventListener('click', async () => {
  jsonOutput.value = serializeV3Mesh2MotionCalibration(calibration);
  try {
    await navigator.clipboard?.writeText(jsonOutput.value);
    setStatus('Copied calibration JSON');
  } catch {
    setStatus('Clipboard unavailable; JSON is in the export box');
  }
});
downloadJsonButton.addEventListener('click', () => {
  jsonOutput.value = serializeV3Mesh2MotionCalibration(calibration);
  const blob = new Blob([jsonOutput.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'v3-mesh2motion-retarget-calibration.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});
importJsonButton.addEventListener('click', () => {
  try {
    setCalibration(parseV3Mesh2MotionCalibrationJson(jsonOutput.value), 'Imported calibration JSON');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to import calibration JSON');
  }
});
chooseJsonButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = '';
  if (!file) return;
  try {
    setCalibration(parseV3Mesh2MotionCalibrationJson(await file.text()), `Imported ${file.name}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to import calibration JSON');
  }
});

window.addEventListener('resize', () => resize());

function animate(timeMs: number): void {
  if (lastTimeMs === 0) lastTimeMs = timeMs;
  const delta = Math.min(0.08, Math.max(0, (timeMs - lastTimeMs) / 1000));
  lastTimeMs = timeMs;
  if (playing) {
    frameCarry += delta * 60 * Math.max(0.1, Math.min(4, numberValue(speedInput, 1)));
    const wholeFrames = Math.floor(frameCarry);
    if (wholeFrames > 0) {
      frameCarry -= wholeFrames;
      const duration = selectedClip().durationFrames;
      currentFrame = (currentFrame + wholeFrames) % Math.max(1, duration + 1);
      timelineInput.value = String(currentFrame);
      frameInput.value = String(currentFrame);
      applyPreview();
    }
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

for (const clip of Object.values(CLIPS)) {
  const option = clipSelect.querySelector(`option[value="${clip.id}"]`);
  if (option) option.textContent = clip.label;
}
syncInputsFromCalibration();
updateClipControls();
resize();
applyPreview('Mesh2Motion retarget calibrator ready');
requestAnimationFrame(animate);

(window as any).__IBRAWLS_V3_MESH2MOTION_RIG_CALIBRATOR__ = {
  get calibration() {
    return calibration;
  },
  get editMode() {
    return editMode;
  },
  get selectedTarget() {
    return selectedTarget();
  },
  importJson: (json: string) => {
    setCalibration(parseV3Mesh2MotionCalibrationJson(json), 'Imported calibration JSON');
    return calibration;
  },
  diagnostics: () => buildV3Mesh2MotionCalibrationDiagnostics(meshRig.group, meshRig.sword, 'sword'),
  targets: () => listV3Mesh2MotionCalibrationTargets(),
};
