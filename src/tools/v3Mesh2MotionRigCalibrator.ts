import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { animateV3CombatantModel, animateV3WeaponMeshes } from '../components/grifball/combatantAnimationV3';
import { createCombatantMeshRig } from '../components/grifball/combatantModels';
import {
  getV3Mesh2MotionDriverRig,
  getV3Mesh2MotionDriverWeaponSocketWorldTransform,
} from '../components/grifball/v3Mesh2MotionDriverRig';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import type { V3AuthoredClipId } from '../components/grifball/v3AuthoredAnimationClips';
import type { V3WeaponId } from '../components/v3/v3ModelTypes';
import {
  V3_MESH2MOTION_DEFAULT_CALIBRATION,
  buildV3Mesh2MotionCalibrationDiagnostics,
  computeV3Mesh2MotionSocketCalibrationFromWorldTransform,
  normalizeV3Mesh2MotionCalibration,
  parseV3Mesh2MotionCalibrationJson,
  serializeV3Mesh2MotionCalibration,
  setV3Mesh2MotionCalibrationOverride,
  type V3Mesh2MotionCalibration,
} from './v3Mesh2MotionRigCalibratorCore';

type Mesh2MotionPreviewClipId = Extract<
  V3AuthoredClipId,
  'clean_sprint' | 'clean_slide' | 'clean_sword_carry' | 'clean_sword_lunge' | 'clean_sword_slash'
>;

interface PreviewClipConfig {
  id: Mesh2MotionPreviewClipId;
  durationFrames: number;
  activeWeapon: V3WeaponId;
  weaponState: string;
  isSliding?: boolean;
  isSprinting?: boolean;
  isLunging?: boolean;
}

const LOCAL_STORAGE_KEY = 'ibrawls_v3_mesh2motion_rig_calibration';

const CLIPS: Record<Mesh2MotionPreviewClipId, PreviewClipConfig> = {
  clean_sprint: {
    id: 'clean_sprint',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSprinting: true,
  },
  clean_slide: {
    id: 'clean_slide',
    durationFrames: 72,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isSliding: true,
  },
  clean_sword_carry: {
    id: 'clean_sword_carry',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
  },
  clean_sword_lunge: {
    id: 'clean_sword_lunge',
    durationFrames: 60,
    activeWeapon: 'sword',
    weaponState: 'ready',
    isLunging: true,
  },
  clean_sword_slash: {
    id: 'clean_sword_slash',
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
const resetCalibrationButton = document.getElementById('reset-calibration') as HTMLButtonElement;
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
const jointSelect = document.getElementById('joint-select') as HTMLSelectElement;
const jointXInput = document.getElementById('joint-x') as HTMLInputElement;
const jointYInput = document.getElementById('joint-y') as HTMLInputElement;
const jointZInput = document.getElementById('joint-z') as HTMLInputElement;
const applyJointButton = document.getElementById('apply-joint') as HTMLButtonElement;
const clearJointButton = document.getElementById('clear-joint') as HTMLButtonElement;
const socketXInput = document.getElementById('socket-x') as HTMLInputElement;
const socketYInput = document.getElementById('socket-y') as HTMLInputElement;
const socketZInput = document.getElementById('socket-z') as HTMLInputElement;
const socketRxInput = document.getElementById('socket-rx') as HTMLInputElement;
const socketRyInput = document.getElementById('socket-ry') as HTMLInputElement;
const socketRzInput = document.getElementById('socket-rz') as HTMLInputElement;
const applySocketButton = document.getElementById('apply-socket') as HTMLButtonElement;
const transformTranslateButton = document.getElementById('transform-translate') as HTMLButtonElement;
const transformRotateButton = document.getElementById('transform-rotate') as HTMLButtonElement;
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

const socketHandle = new THREE.Group();
socketHandle.name = 'v3Mesh2MotionRigCalibratorRightHandSocketHandle';
const socketMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 20, 12),
  new THREE.MeshBasicMaterial({ color: 0xfacc15, depthTest: false })
);
socketMarker.renderOrder = 20;
socketHandle.add(socketMarker);
const socketRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.085, 0.006, 8, 24),
  new THREE.MeshBasicMaterial({ color: 0x67e8f9, depthTest: false })
);
socketRing.rotation.x = Math.PI / 2;
socketRing.renderOrder = 19;
socketHandle.add(socketRing);
scene.add(socketHandle);

const socketTetherGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(),
  new THREE.Vector3(),
]);
const socketTether = new THREE.Line(
  socketTetherGeometry,
  new THREE.LineBasicMaterial({ color: 0xfacc15, transparent: true, opacity: 0.85, depthTest: false })
);
socketTether.renderOrder = 18;
scene.add(socketTether);

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setMode('translate');
transformControls.setSpace('local');
transformControls.setTranslationSnap(0.01);
transformControls.setRotationSnap(0.05);
transformControls.attach(socketHandle);
scene.add(transformControls.getHelper());

let calibration: V3Mesh2MotionCalibration = loadLocalCalibration();
let currentFrame = 30;
let playing = false;
let frameCarry = 0;
let lastTimeMs = 0;
let suppressHandleCommit = false;

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

function tupleFromInputs(
  x: HTMLInputElement,
  y: HTMLInputElement,
  z: HTMLInputElement
): [number, number, number] {
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

function readInputsIntoCalibration(): void {
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    armSpread: {
      left: numberValue(leftSpreadInput, calibration.armSpread.left),
      right: numberValue(rightSpreadInput, calibration.armSpread.right),
    },
    weaponSockets: {
      rightHandGrip: {
        position: tupleFromInputs(socketXInput, socketYInput, socketZInput),
        rotation: tupleFromInputs(socketRxInput, socketRyInput, socketRzInput),
      },
    },
  });
}

function syncInputsFromCalibration(): void {
  leftSpreadInput.value = calibration.armSpread.left.toFixed(3);
  rightSpreadInput.value = calibration.armSpread.right.toFixed(3);
  const selectedJoint = jointSelect.value as keyof V3Mesh2MotionCalibration['jointOffsets'];
  const jointOffset = calibration.jointOffsets[selectedJoint] ?? [0, 0, 0];
  setTupleInputs([jointXInput, jointYInput, jointZInput], jointOffset);
  setTupleInputs([socketXInput, socketYInput, socketZInput], calibration.weaponSockets.rightHandGrip.position);
  setTupleInputs([socketRxInput, socketRyInput, socketRzInput], calibration.weaponSockets.rightHandGrip.rotation);
  jsonOutput.value = serializeV3Mesh2MotionCalibration(calibration);
}

function formatDiagnostics(): string {
  const report = buildV3Mesh2MotionCalibrationDiagnostics(meshRig.group, meshRig.sword, 'sword');
  return [
    `Ready: ${report.ready ? 'yes' : 'no'}`,
    report.warnings.length ? `Warnings: ${report.warnings.join(', ')}` : 'Warnings: none',
    '',
    'Left arm clearance:',
    ...report.arms.left.clearances.map((entry) =>
      `${entry.status.padEnd(4)} ${entry.slot.padEnd(13)} gap ${entry.outwardGap.toFixed(3)} chest-intersect ${entry.intersectsChest}`
    ),
    'Right arm clearance:',
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
        `Sword primary drift: ${report.weapon.primaryGripDrift.toFixed(3)}`,
        `Sword forward axis: ${report.weapon.forwardAxis.x.toFixed(3)}, ${report.weapon.forwardAxis.y.toFixed(3)}, ${report.weapon.forwardAxis.z.toFixed(3)}`,
        `Sword up axis: ${report.weapon.upAxis.x.toFixed(3)}, ${report.weapon.upAxis.y.toFixed(3)}, ${report.weapon.upAxis.z.toFixed(3)}`,
      ].join('\n')
      : 'Sword diagnostics unavailable',
  ].join('\n');
}

function getRightHandCenter(): THREE.Vector3 | null {
  const partGroups = meshRig.group.userData.v3PartGroups as Record<string, THREE.Object3D> | undefined;
  const hand = partGroups?.handRight;
  if (!hand) return null;
  return new THREE.Box3().setFromObject(hand).getCenter(new THREE.Vector3());
}

function updateSocketTether(): void {
  const handCenter = getRightHandCenter();
  if (!handCenter) {
    socketTether.visible = false;
    return;
  }
  socketTether.visible = true;
  const positionAttribute = socketTetherGeometry.getAttribute('position') as THREE.BufferAttribute;
  positionAttribute.setXYZ(0, handCenter.x, handCenter.y, handCenter.z);
  positionAttribute.setXYZ(1, socketHandle.position.x, socketHandle.position.y, socketHandle.position.z);
  positionAttribute.needsUpdate = true;
  socketTetherGeometry.computeBoundingSphere();
}

function updateSocketHandle(): void {
  const transform = getV3Mesh2MotionDriverWeaponSocketWorldTransform(meshRig.group, 'rightHandGrip');
  if (!transform) return;
  suppressHandleCommit = true;
  socketHandle.position.copy(transform.position);
  socketHandle.quaternion.copy(transform.quaternion);
  socketHandle.rotation.setFromQuaternion(socketHandle.quaternion);
  socketHandle.updateMatrixWorld(true);
  updateSocketTether();
  suppressHandleCommit = false;
}

function commitSocketHandleToInputs(): void {
  const rig = getV3Mesh2MotionDriverRig(meshRig.group);
  const socket = rig.weaponSockets.rightHandGrip;
  const parent = socket.object.parent;
  if (!parent) return;
  parent.updateWorldMatrix(true, false);
  socketHandle.updateMatrixWorld(true);
  const next = computeV3Mesh2MotionSocketCalibrationFromWorldTransform({
    parentWorldMatrix: parent.matrixWorld,
    handleWorldMatrix: socketHandle.matrixWorld,
    restLocalPosition: new THREE.Vector3(...socket.restLocalPosition),
  });
  setTupleInputs([socketXInput, socketYInput, socketZInput], next.position.toArray());
  setTupleInputs([socketRxInput, socketRyInput, socketRzInput], next.rotation);
}

function applyPreview(message?: string): void {
  readInputsIntoCalibration();
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
  updateSocketHandle();
  syncInputsFromCalibration();
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
  applyPreview(`Loaded ${selectedClip().id}`);
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

for (const input of [leftSpreadInput, rightSpreadInput, socketXInput, socketYInput, socketZInput, socketRxInput, socketRyInput, socketRzInput]) {
  input.addEventListener('change', () => applyPreview('Calibration updated'));
}

jointSelect.addEventListener('change', () => syncInputsFromCalibration());
applyJointButton.addEventListener('click', () => {
  const selectedJoint = jointSelect.value as keyof V3Mesh2MotionCalibration['jointOffsets'];
  calibration = normalizeV3Mesh2MotionCalibration({
    ...calibration,
    jointOffsets: {
      ...calibration.jointOffsets,
      [selectedJoint]: tupleFromInputs(jointXInput, jointYInput, jointZInput),
    },
  });
  syncInputsFromCalibration();
  applyPreview(`Applied ${selectedJoint} offset`);
});
clearJointButton.addEventListener('click', () => {
  const selectedJoint = jointSelect.value as keyof V3Mesh2MotionCalibration['jointOffsets'];
  const jointOffsets = { ...calibration.jointOffsets };
  delete jointOffsets[selectedJoint];
  calibration = normalizeV3Mesh2MotionCalibration({ ...calibration, jointOffsets });
  syncInputsFromCalibration();
  applyPreview(`Cleared ${selectedJoint} offset`);
});
applySocketButton.addEventListener('click', () => applyPreview('Applied right-hand socket'));
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
  commitSocketHandleToInputs();
  applyPreview('Socket handle adjusted');
});

resetCalibrationButton.addEventListener('click', () => setCalibration(V3_MESH2MOTION_DEFAULT_CALIBRATION, 'Reset to source defaults'));
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
  link.download = 'v3-mesh2motion-rig-calibration.json';
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

syncInputsFromCalibration();
updateClipControls();
resize();
applyPreview('Mesh2Motion calibrator ready');
requestAnimationFrame(animate);

(window as any).__IBRAWLS_V3_MESH2MOTION_RIG_CALIBRATOR__ = {
  get calibration() {
    return calibration;
  },
  importJson: (json: string) => {
    setCalibration(parseV3Mesh2MotionCalibrationJson(json), 'Imported calibration JSON');
    return calibration;
  },
  diagnostics: () => buildV3Mesh2MotionCalibrationDiagnostics(meshRig.group, meshRig.sword, 'sword'),
};
