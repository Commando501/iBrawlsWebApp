import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  applyWeaponPose,
  getFirstPersonHammerPose,
  getFirstPersonSwordLungePose,
  getFirstPersonSwordSlashPose,
  getThirdPersonHammerPose,
  getThirdPersonSwordLungePose,
  getThirdPersonSwordSlashPose,
  type HammerAttackPhase,
  type WeaponPose,
} from '../components/grifball/attackAnimationPresets';
import {
  attachToAttachmentPoint,
  createFirstPersonWeaponRig,
} from '../components/grifball/combatantRig';
import { createCombatantMeshRig, type CombatantMeshRig } from '../components/grifball/combatantModels';
import { buildGravityHammerModel, buildKatarSwordModel } from '../components/VoxelModels';
import {
  buildPoseArraySnippet,
  clampFrameIndex,
  clonePose,
  generatePoseFrames,
  normalizeKeyframes,
  roundPose,
  type AnimationInterpolationMode,
  type AnimationKeyframe,
  type GeneratedAnimationFrame,
} from './animationEditorCore';

type WeaponChoice = 'hammer' | 'sword';
type EditorView = 'firstPerson' | 'thirdPerson';
type TransformMode = 'translate' | 'rotate';

interface TrackDefinition {
  id: string;
  label: string;
  weapon: WeaponChoice;
  sample: (view: EditorView, progress: number) => WeaponPose;
}

interface EditorState {
  weapon: WeaponChoice;
  view: EditorView;
  trackId: string;
  frameCount: number;
  currentFrame: number;
  interpolation: AnimationInterpolationMode;
  transformMode: TransformMode;
  keyframes: AnimationKeyframe[];
  generatedFrames: GeneratedAnimationFrame[];
  anchorFrames: [number, number, number];
  playing: boolean;
}

const TRACKS: TrackDefinition[] = [
  {
    id: 'hammer_windup',
    label: 'Hammer windup',
    weapon: 'hammer',
    sample: (view, progress) => sampleHammerPose(view, 'windup', progress),
  },
  {
    id: 'hammer_strike',
    label: 'Hammer strike',
    weapon: 'hammer',
    sample: (view, progress) => sampleHammerPose(view, 'strike', progress),
  },
  {
    id: 'hammer_recover',
    label: 'Hammer recover',
    weapon: 'hammer',
    sample: (view, progress) => sampleHammerPose(view, 'recover', progress),
  },
  {
    id: 'hammer_melee',
    label: 'Hammer melee swing',
    weapon: 'hammer',
    sample: (view, progress) => sampleHammerPose(view, 'melee_swing', progress),
  },
  {
    id: 'hammer_melee_recover',
    label: 'Hammer melee recover',
    weapon: 'hammer',
    sample: (view, progress) => sampleHammerPose(view, 'melee_recover', progress),
  },
  {
    id: 'sword_lunge',
    label: 'Sword lunge',
    weapon: 'sword',
    sample: (view, progress) => view === 'firstPerson'
      ? getFirstPersonSwordLungePose(progress * 0.18)
      : getThirdPersonSwordLungePose(progress * 0.18),
  },
  {
    id: 'sword_slash',
    label: 'Sword slash',
    weapon: 'sword',
    sample: (view, progress) => view === 'firstPerson'
      ? getFirstPersonSwordSlashPose('slash', progress)
      : getThirdPersonSwordSlashPose('slash', progress),
  },
  {
    id: 'sword_recover',
    label: 'Sword recover',
    weapon: 'sword',
    sample: (view, progress) => view === 'firstPerson'
      ? getFirstPersonSwordSlashPose('recover', progress)
      : getThirdPersonSwordSlashPose('recover', progress),
  },
];

function sampleHammerPose(view: EditorView, phase: HammerAttackPhase, progress: number): WeaponPose {
  return view === 'firstPerson'
    ? getFirstPersonHammerPose(phase, progress)
    : getThirdPersonHammerPose(phase, progress);
}

const requireElement = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing animation editor element: ${id}`);
  }
  return element as T;
};

const getTrack = (trackId: string): TrackDefinition =>
  TRACKS.find((track) => track.id === trackId) ?? TRACKS[0];

const formatNumber = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? '0' : String(rounded);
};

const formatPoseShort = (pose: WeaponPose): string => {
  const rounded = roundPose(pose, 2);
  return `pos ${rounded.position.map((value) => formatNumber(value, 2)).join(', ')} | rot ${rounded.rotation.map((value) => formatNumber(value, 2)).join(', ')}`;
};

const makeAnchorFrames = (frameCount: number): [number, number, number] => [
  0,
  Math.floor((frameCount - 1) / 2),
  frameCount - 1,
];

const viewport = requireElement<HTMLDivElement>('viewport');
const weaponSelect = requireElement<HTMLSelectElement>('weaponSelect');
const viewSelect = requireElement<HTMLSelectElement>('viewSelect');
const trackSelect = requireElement<HTMLSelectElement>('trackSelect');
const frameCountInput = requireElement<HTMLInputElement>('frameCountInput');
const interpolationSelect = requireElement<HTMLSelectElement>('interpolationSelect');
const seedButton = requireElement<HTMLButtonElement>('seedButton');
const generateButton = requireElement<HTMLButtonElement>('generateButton');
const translateButton = requireElement<HTMLButtonElement>('translateButton');
const rotateButton = requireElement<HTMLButtonElement>('rotateButton');
const setKeyframeButton = requireElement<HTMLButtonElement>('setKeyframeButton');
const anchorRows = requireElement<HTMLDivElement>('anchorRows');
const keyframeList = requireElement<HTMLDivElement>('keyframeList');
const keyframeCount = requireElement<HTMLElement>('keyframeCount');
const playButton = requireElement<HTMLButtonElement>('playButton');
const frameSlider = requireElement<HTMLInputElement>('frameSlider');
const frameReadout = requireElement<HTMLElement>('frameReadout');
const timeline = requireElement<HTMLDivElement>('timeline');
const exportText = requireElement<HTMLTextAreaElement>('exportText');
const copySnippetButton = requireElement<HTMLButtonElement>('copySnippetButton');
const downloadJsonButton = requireElement<HTMLButtonElement>('downloadJsonButton');
const statusText = requireElement<HTMLElement>('statusText');
const trackStatus = requireElement<HTMLElement>('trackStatus');
const transformStatus = requireElement<HTMLElement>('transformStatus');
const hudTitle = requireElement<HTMLElement>('hudTitle');
const hudFrame = requireElement<HTMLElement>('hudFrame');
const hudPose = requireElement<HTMLElement>('hudPose');
const metricFrames = requireElement<HTMLElement>('metricFrames');
const metricKeys = requireElement<HTMLElement>('metricKeys');
const metricMode = requireElement<HTMLElement>('metricMode');
const exportStatus = requireElement<HTMLElement>('exportStatus');
const segmentInfo = requireElement<HTMLElement>('segmentInfo');

const poseInputs = {
  posX: requireElement<HTMLInputElement>('posXInput'),
  posY: requireElement<HTMLInputElement>('posYInput'),
  posZ: requireElement<HTMLInputElement>('posZInput'),
  rotX: requireElement<HTMLInputElement>('rotXInput'),
  rotY: requireElement<HTMLInputElement>('rotYInput'),
  rotZ: requireElement<HTMLInputElement>('rotZInput'),
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#020617');
scene.fog = new THREE.Fog('#020617', 8, 18);

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.6;
controls.maxDistance = 8;

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(0.78);
scene.add(transformControls.getHelper());

const hemiLight = new THREE.HemisphereLight(0x9bdcff, 0x111827, 1.8);
scene.add(hemiLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
keyLight.position.set(3, 5, 4);
keyLight.castShadow = true;
scene.add(keyLight);

const fillLight = new THREE.PointLight(0x22d3ee, 3, 8);
fillLight.position.set(-2.4, 1.4, 2.2);
scene.add(fillLight);

const grid = new THREE.GridHelper(6, 24, 0x164e63, 0x172554);
grid.position.y = -0.01;
scene.add(grid);

const axes = new THREE.AxesHelper(0.9);
axes.position.set(-1.8, 0.02, -1.8);
scene.add(axes);

const thirdPersonRig: CombatantMeshRig = createCombatantMeshRig(scene, 192, false);
thirdPersonRig.group.position.set(0, 0, 0);
thirdPersonRig.group.rotation.y = Math.PI;

const firstPersonRoot = new THREE.Group();
firstPersonRoot.position.set(0, 1.0, 0);
scene.add(firstPersonRoot);
const firstPersonRig = createFirstPersonWeaponRig(firstPersonRoot);
const firstPersonWeaponGrip = firstPersonRig.attachments.firstPersonWeaponGrip;

const firstPersonHammer = buildGravityHammerModel(192);
const firstPersonSword = buildKatarSwordModel(192);
attachToAttachmentPoint(firstPersonWeaponGrip, firstPersonHammer);
attachToAttachmentPoint(firstPersonWeaponGrip, firstPersonSword);

const reticleMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.42 });
const reticleGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.12, 0, -0.95),
  new THREE.Vector3(0.12, 0, -0.95),
  new THREE.Vector3(0, -0.12, -0.95),
  new THREE.Vector3(0, 0.12, -0.95),
]);
const reticle = new THREE.LineSegments(reticleGeometry, reticleMaterial);
firstPersonRoot.add(reticle);

const state: EditorState = {
  weapon: 'hammer',
  view: 'thirdPerson',
  trackId: 'hammer_windup',
  frameCount: 31,
  currentFrame: 0,
  interpolation: 'smoothstep',
  transformMode: 'translate',
  keyframes: [],
  generatedFrames: [],
  anchorFrames: makeAnchorFrames(31),
  playing: false,
};

let draftFrame: number | null = null;
let draftPose: WeaponPose | null = null;
let playbackAccumulator = 0;
const playbackFrameDuration = 1 / 18;
let lastAnimationTime = performance.now();

function getActiveWeaponObject(): THREE.Group {
  if (state.view === 'firstPerson') {
    return state.weapon === 'hammer' ? firstPersonHammer : firstPersonSword;
  }
  return state.weapon === 'hammer' ? thirdPersonRig.hammer : thirdPersonRig.sword;
}

function captureActivePose(): WeaponPose {
  const object = getActiveWeaponObject();
  return {
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
  };
}

function applyPoseToActive(pose: WeaponPose): void {
  applyWeaponPose(getActiveWeaponObject(), pose);
}

function getCurrentPose(): WeaponPose {
  if (draftFrame === state.currentFrame && draftPose) {
    return clonePose(draftPose);
  }
  return clonePose(state.generatedFrames[state.currentFrame]?.pose ?? state.keyframes[0]?.pose ?? getTrack(state.trackId).sample(state.view, 0));
}

function setStatus(message: string): void {
  statusText.textContent = message;
}

function syncPoseInputs(pose: WeaponPose): void {
  poseInputs.posX.value = formatNumber(pose.position[0]);
  poseInputs.posY.value = formatNumber(pose.position[1]);
  poseInputs.posZ.value = formatNumber(pose.position[2]);
  poseInputs.rotX.value = formatNumber(pose.rotation[0]);
  poseInputs.rotY.value = formatNumber(pose.rotation[1]);
  poseInputs.rotZ.value = formatNumber(pose.rotation[2]);
}

function parseInputValue(input: HTMLInputElement, fallback: number): number {
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPoseInputs(fallback: WeaponPose): WeaponPose {
  return {
    position: [
      parseInputValue(poseInputs.posX, fallback.position[0]),
      parseInputValue(poseInputs.posY, fallback.position[1]),
      parseInputValue(poseInputs.posZ, fallback.position[2]),
    ],
    rotation: [
      parseInputValue(poseInputs.rotX, fallback.rotation[0]),
      parseInputValue(poseInputs.rotY, fallback.rotation[1]),
      parseInputValue(poseInputs.rotZ, fallback.rotation[2]),
    ],
  };
}

function setDraftPose(pose: WeaponPose): void {
  draftFrame = state.currentFrame;
  draftPose = clonePose(pose);
}

function clearDraft(): void {
  draftFrame = null;
  draftPose = null;
}

function sampleTrackProgressForFrame(frame: number): number {
  return state.frameCount <= 1 ? 0 : frame / (state.frameCount - 1);
}

function seedThreeFrames(): void {
  const track = getTrack(state.trackId);
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  state.keyframes = state.anchorFrames.map((frame, index) => ({
    frame,
    label: String.fromCharCode(65 + index),
    pose: track.sample(state.view, index / 2),
  }));
  state.currentFrame = state.anchorFrames[0];
  clearDraft();
  regenerateFrames('Seeded three key poses.');
}

function regenerateFrames(message = 'Generated missing frames.'): void {
  state.keyframes = normalizeKeyframes(state.keyframes, state.frameCount);
  state.generatedFrames = generatePoseFrames(state.keyframes, state.frameCount, state.interpolation);
  state.currentFrame = clampFrameIndex(state.currentFrame, state.frameCount);
  frameSlider.max = String(state.frameCount - 1);
  frameSlider.value = String(state.currentFrame);
  applyPoseToActive(getCurrentPose());
  syncPoseInputs(getCurrentPose());
  renderAll();
  setStatus(message);
}

function setCurrentFrame(frame: number): void {
  state.currentFrame = clampFrameIndex(frame, state.frameCount);
  clearDraft();
  frameSlider.value = String(state.currentFrame);
  applyPoseToActive(getCurrentPose());
  syncPoseInputs(getCurrentPose());
  renderTimeline();
  renderHud();
  renderSegmentInfo();
}

function setKeyframe(frame: number, pose: WeaponPose, label?: string): void {
  const resolvedFrame = clampFrameIndex(frame, state.frameCount);
  state.keyframes = normalizeKeyframes([
    ...state.keyframes.filter((keyframe) => keyframe.frame !== resolvedFrame),
    { frame: resolvedFrame, label, pose },
  ], state.frameCount);
  clearDraft();
  regenerateFrames(`Keyframe set at frame ${resolvedFrame}.`);
}

function deleteKeyframe(frame: number): void {
  if (state.keyframes.length <= 1) {
    setStatus('At least one keyframe is required.');
    return;
  }
  state.keyframes = state.keyframes.filter((keyframe) => keyframe.frame !== frame);
  clearDraft();
  regenerateFrames(`Keyframe ${frame} removed.`);
}

function refreshTrackOptions(): void {
  const compatibleTracks = TRACKS.filter((track) => track.weapon === state.weapon);
  if (!compatibleTracks.some((track) => track.id === state.trackId)) {
    state.trackId = compatibleTracks[0].id;
  }

  trackSelect.innerHTML = '';
  compatibleTracks.forEach((track) => {
    const option = document.createElement('option');
    option.value = track.id;
    option.textContent = track.label;
    trackSelect.appendChild(option);
  });
  trackSelect.value = state.trackId;
}

function syncSceneVisibility(): void {
  thirdPersonRig.group.visible = state.view === 'thirdPerson';
  firstPersonRoot.visible = state.view === 'firstPerson';

  thirdPersonRig.hammer.visible = state.view === 'thirdPerson' && state.weapon === 'hammer';
  thirdPersonRig.sword.visible = state.view === 'thirdPerson' && state.weapon === 'sword';
  firstPersonHammer.visible = state.view === 'firstPerson' && state.weapon === 'hammer';
  firstPersonSword.visible = state.view === 'firstPerson' && state.weapon === 'sword';
  reticle.visible = state.view === 'firstPerson';

  transformControls.detach();
  transformControls.attach(getActiveWeaponObject());
  transformControls.setMode(state.transformMode);
  applyPoseToActive(getCurrentPose());
}

function updateCameraForView(): void {
  if (state.view === 'firstPerson') {
    camera.position.set(0, 1.16, 1.45);
    controls.target.set(0, 0.66, -0.66);
  } else {
    camera.position.set(2.45, 1.75, 3.1);
    controls.target.set(0, 0.82, 0);
  }
  controls.update();
}

function renderAnchorRows(): void {
  anchorRows.innerHTML = '';
  state.anchorFrames.forEach((frame, index) => {
    const row = document.createElement('div');
    row.className = 'anchor-row';

    const label = document.createElement('strong');
    label.textContent = String.fromCharCode(65 + index);

    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.max = String(state.frameCount - 1);
    input.step = '1';
    input.value = String(frame);
    input.addEventListener('change', () => {
      state.anchorFrames[index] = clampFrameIndex(Number(input.value), state.frameCount);
      renderAnchorRows();
    });

    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.textContent = 'Go';
    goButton.addEventListener('click', () => setCurrentFrame(state.anchorFrames[index]));

    const setButton = document.createElement('button');
    setButton.type = 'button';
    setButton.textContent = 'Set';
    setButton.addEventListener('click', () => {
      setKeyframe(state.anchorFrames[index], captureActivePose(), String.fromCharCode(65 + index));
    });

    row.append(label, input, goButton, setButton);
    anchorRows.appendChild(row);
  });
}

function renderKeyframes(): void {
  const normalized = normalizeKeyframes(state.keyframes, state.frameCount);
  keyframeCount.textContent = `${normalized.length}`;
  metricKeys.textContent = `${normalized.length}`;
  keyframeList.innerHTML = '';

  normalized.forEach((keyframe) => {
    const row = document.createElement('div');
    row.className = 'keyframe-row';

    const label = document.createElement('strong');
    label.textContent = keyframe.label ?? 'K';

    const frameInput = document.createElement('input');
    frameInput.type = 'number';
    frameInput.min = '0';
    frameInput.max = String(state.frameCount - 1);
    frameInput.step = '1';
    frameInput.value = String(keyframe.frame);
    frameInput.addEventListener('change', () => {
      const nextFrame = clampFrameIndex(Number(frameInput.value), state.frameCount);
      state.keyframes = state.keyframes.filter((candidate) => candidate.frame !== keyframe.frame);
      setKeyframe(nextFrame, keyframe.pose, keyframe.label);
    });

    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.textContent = 'Go';
    goButton.addEventListener('click', () => setCurrentFrame(keyframe.frame));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.textContent = 'Del';
    deleteButton.className = 'danger';
    deleteButton.addEventListener('click', () => deleteKeyframe(keyframe.frame));

    row.append(label, frameInput, goButton, deleteButton);
    keyframeList.appendChild(row);
  });
}

function renderTimeline(): void {
  frameSlider.max = String(state.frameCount - 1);
  frameSlider.value = String(state.currentFrame);
  frameReadout.textContent = `Frame ${state.currentFrame} / ${state.frameCount - 1}`;
  timeline.innerHTML = '';

  state.generatedFrames.forEach((frame) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame-cell';
    button.textContent = String(frame.frame);
    button.dataset.source = frame.source;
    button.dataset.current = String(frame.frame === state.currentFrame);
    button.addEventListener('click', () => setCurrentFrame(frame.frame));
    timeline.appendChild(button);
  });
}

function buildExportPayload() {
  return {
    tool: 'ibrawls-animation-editor',
    weapon: state.weapon,
    view: state.view,
    track: state.trackId,
    frameCount: state.frameCount,
    interpolation: state.interpolation,
    keyframes: normalizeKeyframes(state.keyframes, state.frameCount).map((keyframe) => ({
      ...keyframe,
      pose: roundPose(keyframe.pose, 4),
    })),
    frames: state.generatedFrames.map((frame) => ({
      frame: frame.frame,
      source: frame.source,
      pose: roundPose(frame.pose, 4),
    })),
  };
}

function buildSnippet(): string {
  const constName = `${state.trackId}_${state.view}_frames`;
  return buildPoseArraySnippet(constName, state.generatedFrames, 4);
}

function renderExport(): void {
  metricFrames.textContent = String(state.frameCount);
  metricMode.textContent = state.interpolation === 'smoothstep' ? 'smooth' : state.interpolation;
  exportStatus.textContent = state.view === 'firstPerson' ? 'first-person' : 'third-person';
  exportText.value = `${JSON.stringify(buildExportPayload(), null, 2)}\n\n${buildSnippet()}`;
}

function renderHud(): void {
  const pose = getCurrentPose();
  const source = state.generatedFrames[state.currentFrame]?.source ?? 'generated';
  hudTitle.textContent = `${state.weapon === 'hammer' ? 'Hammer' : 'Sword'} / ${state.view === 'firstPerson' ? 'First person' : 'Third person'}`;
  hudFrame.textContent = `Frame ${state.currentFrame} (${source})`;
  hudPose.textContent = formatPoseShort(pose);
  trackStatus.textContent = getTrack(state.trackId).label;
}

function renderSegmentInfo(): void {
  const normalized = normalizeKeyframes(state.keyframes, state.frameCount);
  if (normalized.length === 0) {
    segmentInfo.textContent = 'No keyframes.';
    return;
  }

  const nextIndex = normalized.findIndex((keyframe) => keyframe.frame >= state.currentFrame);
  const start = nextIndex <= 0
    ? normalized[0]
    : normalized[nextIndex - 1];
  const end = nextIndex === -1
    ? normalized[normalized.length - 1]
    : normalized[nextIndex];

  const deltaPosition = end.pose.position.map((value, axis) => value - start.pose.position[axis]);
  const deltaRotation = end.pose.rotation.map((value, axis) => value - start.pose.rotation[axis]);

  segmentInfo.innerHTML = [
    `<span>Frames ${start.frame} -> ${end.frame}</span>`,
    `<span>Position delta: ${deltaPosition.map((value) => formatNumber(value, 3)).join(', ')}</span>`,
    `<span>Rotation delta: ${deltaRotation.map((value) => formatNumber(value, 3)).join(', ')}</span>`,
    `<span>Progress: ${formatNumber(sampleTrackProgressForFrame(state.currentFrame), 3)}</span>`,
  ].join('');
}

function renderTransformButtons(): void {
  translateButton.dataset.active = String(state.transformMode === 'translate');
  rotateButton.dataset.active = String(state.transformMode === 'rotate');
  transformStatus.textContent = state.transformMode;
}

function renderAll(): void {
  weaponSelect.value = state.weapon;
  viewSelect.value = state.view;
  interpolationSelect.value = state.interpolation;
  frameCountInput.value = String(state.frameCount);
  refreshTrackOptions();
  syncSceneVisibility();
  renderTransformButtons();
  renderAnchorRows();
  renderKeyframes();
  renderTimeline();
  renderExport();
  renderHud();
  renderSegmentInfo();
}

function resizeRenderer(): void {
  const rect = viewport.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function handlePoseInputChange(): void {
  const pose = readPoseInputs(captureActivePose());
  setDraftPose(pose);
  applyPoseToActive(pose);
  renderHud();
  renderSegmentInfo();
  setStatus(`Draft pose edited at frame ${state.currentFrame}.`);
}

Object.values(poseInputs).forEach((input) => {
  input.addEventListener('input', handlePoseInputChange);
});

weaponSelect.addEventListener('change', () => {
  state.weapon = weaponSelect.value as WeaponChoice;
  const compatibleTrack = TRACKS.find((track) => track.weapon === state.weapon);
  state.trackId = compatibleTrack?.id ?? state.trackId;
  refreshTrackOptions();
  seedThreeFrames();
  updateCameraForView();
});

viewSelect.addEventListener('change', () => {
  state.view = viewSelect.value as EditorView;
  seedThreeFrames();
  updateCameraForView();
});

trackSelect.addEventListener('change', () => {
  state.trackId = trackSelect.value;
  seedThreeFrames();
});

frameCountInput.addEventListener('change', () => {
  const nextFrameCount = Math.min(96, Math.max(3, Math.round(Number(frameCountInput.value) || state.frameCount)));
  state.frameCount = nextFrameCount;
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  state.currentFrame = clampFrameIndex(state.currentFrame, state.frameCount);
  state.keyframes = normalizeKeyframes(state.keyframes, state.frameCount);
  clearDraft();
  regenerateFrames('Frame count updated.');
});

interpolationSelect.addEventListener('change', () => {
  state.interpolation = interpolationSelect.value as AnimationInterpolationMode;
  clearDraft();
  regenerateFrames('Interpolation mode updated.');
});

seedButton.addEventListener('click', seedThreeFrames);
generateButton.addEventListener('click', () => regenerateFrames());
setKeyframeButton.addEventListener('click', () => {
  setKeyframe(state.currentFrame, captureActivePose());
});

translateButton.addEventListener('click', () => {
  state.transformMode = 'translate';
  transformControls.setMode('translate');
  renderTransformButtons();
});

rotateButton.addEventListener('click', () => {
  state.transformMode = 'rotate';
  transformControls.setMode('rotate');
  renderTransformButtons();
});

frameSlider.addEventListener('input', () => {
  setCurrentFrame(Number(frameSlider.value));
});

playButton.addEventListener('click', () => {
  state.playing = !state.playing;
  playButton.textContent = state.playing ? 'Pause' : 'Play';
  setStatus(state.playing ? 'Playback running.' : 'Playback paused.');
});

copySnippetButton.addEventListener('click', async () => {
  const snippet = buildSnippet();
  try {
    await navigator.clipboard.writeText(snippet);
    setStatus('TypeScript frame array copied.');
  } catch {
    exportText.focus();
    exportText.select();
    setStatus('Clipboard unavailable; export text selected.');
  }
});

downloadJsonButton.addEventListener('click', () => {
  const payload = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ibrawls-${state.trackId}-${state.view}-${state.frameCount}f.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  setStatus('JSON export downloaded.');
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !Boolean(event.value);
});

transformControls.addEventListener('objectChange', () => {
  const pose = captureActivePose();
  setDraftPose(pose);
  syncPoseInputs(pose);
  renderHud();
  renderSegmentInfo();
});

window.addEventListener('resize', resizeRenderer);

function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastAnimationTime) / 1000;
  lastAnimationTime = now;
  if (state.playing && state.generatedFrames.length > 0) {
    playbackAccumulator += dt;
    if (playbackAccumulator >= playbackFrameDuration) {
      playbackAccumulator = 0;
      setCurrentFrame(state.currentFrame >= state.frameCount - 1 ? 0 : state.currentFrame + 1);
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

refreshTrackOptions();
seedThreeFrames();
syncSceneVisibility();
updateCameraForView();
resizeRenderer();
animate();
