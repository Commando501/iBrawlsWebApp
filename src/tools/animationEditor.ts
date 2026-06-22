import * as THREE from 'three';
import type { CharacterModelType } from '../types';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import {
  applyWeaponPose,
  getFirstPersonHammerPose,
  getFirstPersonSwordLungePose,
  getFirstPersonSwordSlashPose,
  getThirdPersonCombatantArmPose,
  getThirdPersonHammerPose,
  getThirdPersonSwordLungePose,
  getThirdPersonSwordSlashPose,
  type CombatantArmPose,
  type HammerAttackPhase,
  type WeaponPose,
} from '../components/grifball/attackAnimationPresets';
import {
  V3_ANIMATION_PROFILE_VERSION,
  V3_ANIMATION_TRACKS,
  getV3AnimationTrackDefinition,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  type V3AnimationTrackId,
  type V3AnimationWeaponId,
} from '../components/grifball/v3AnimationFidelity';
import {
  COMBATANT_BONE_NAMES,
  attachToAttachmentPoint,
  createFirstPersonWeaponRig,
  type CombatantAttachmentPointName,
  type CombatantBoneName,
} from '../components/grifball/combatantRig';
import { createCombatantMeshRig, type CombatantMeshRig } from '../components/grifball/combatantModels';
import {
  buildGravityHammerModel,
  buildKatarSwordModel,
  buildPistolModel,
  type CharacterLoadout,
} from '../components/VoxelModels';
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../components/v3/VoxelModelsV3';
import type { V3RenderOptions } from '../components/v3/v3QualityTiers';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_TIMING_LOCKED,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
} from '../game/hammerSlamTiming';
import {
  buildAnimationEditorExportPayload,
  buildAnimationEditorValidationReport,
  buildPoseArraySnippet,
  clampAnimationEditorLoopRange,
  clampFrameIndex,
  clonePose,
  commitAnimationEditorHistory,
  createAnimationEditorDuplicateVariant,
  createAnimationEditorHistory,
  createAnimationEditorVariantFromCurrentFrame,
  generatePoseFrames,
  markAnimationEditorHistorySaved,
  mergeLinkedArmKeyframesPreservingPositions,
  mirrorAnimationEditorPose,
  mirrorAnimationEditorTarget,
  nextAnimationEditorLoopFrame,
  normalizeKeyframes,
  parseAnimationEditorImportText,
  redoAnimationEditorHistory,
  retimeAnimationEditorKeyframe,
  resolveSetKeyframePose,
  roundPose,
  undoAnimationEditorHistory,
  type AnimationEditorExportPayload,
  type AnimationEditorHistory,
  type AnimationInterpolationMode,
  type AnimationEditorRigTrack,
  type AnimationEditorLocalVariantRecord,
  type AnimationEditorLoopRange,
  type AnimationEditorSocketLock,
  type AnimationEditorValidationItem,
  type AnimationKeyframe,
  type GeneratedAnimationFrame,
  type RigTargetKind,
  type RigTargetPose,
  type SelectedRigTarget,
} from './animationEditorCore';

type WeaponChoice = V3AnimationWeaponId;
type ModelSystemChoice = 'v1' | 'v2' | 'v3';

const EDITOR_V3_RENDER_OPTIONS: V3RenderOptions = {
  v3QualityTier: 'desktop',
  v3Distance: 0,
};
type EditorView = 'firstPerson' | 'thirdPerson';
type TransformMode = 'translate' | 'rotate';
type RigTrackMap = Record<string, AnimationKeyframe[]>;
type GeneratedRigTrackMap = Record<string, GeneratedAnimationFrame[]>;

interface TargetOption {
  target: SelectedRigTarget;
  label: string;
}

interface TrackDefinition {
  id: V3AnimationTrackId;
  label: string;
  weapon: WeaponChoice;
  sample: (view: EditorView, progress: number, modelSystem: ModelSystemChoice) => WeaponPose;
}

interface VersionedAnimationData {
  weaponKeyframes: AnimationKeyframe[];
  weaponGeneratedFrames: GeneratedAnimationFrame[];
  boneKeyframes: RigTrackMap;
  boneGeneratedFrames: GeneratedRigTrackMap;
  socketKeyframes: RigTrackMap;
  socketGeneratedFrames: GeneratedRigTrackMap;
  socketLocks: Record<string, string>;
  frameCount: number;
  anchorFrames: [number, number, number];
  interpolation: AnimationInterpolationMode;
}

interface EditorState {
  weapon: WeaponChoice;
  view: EditorView;
  trackId: string;
  frameCount: number;
  currentFrame: number;
  interpolation: AnimationInterpolationMode;
  transformMode: TransformMode;
  selectedTarget: SelectedRigTarget;
  weaponKeyframes: AnimationKeyframe[];
  weaponGeneratedFrames: GeneratedAnimationFrame[];
  boneKeyframes: RigTrackMap;
  boneGeneratedFrames: GeneratedRigTrackMap;
  socketKeyframes: RigTrackMap;
  socketGeneratedFrames: GeneratedRigTrackMap;
  socketLocks: Record<string, string>;
  anchorFrames: [number, number, number];
  playing: boolean;
  showSkeleton: boolean;
  showSockets: boolean;
  showLabels: boolean;
  autoKey: boolean;
  localTransformSpace: boolean;
  modelSystem: ModelSystemChoice;
  modelType: CharacterModelType;
  versionedData: Record<ModelSystemChoice, VersionedAnimationData>;
}

interface AnimationEditorSnapshot {
  weapon: WeaponChoice;
  view: EditorView;
  trackId: string;
  frameCount: number;
  currentFrame: number;
  interpolation: AnimationInterpolationMode;
  transformMode: TransformMode;
  selectedTarget: SelectedRigTarget;
  weaponKeyframes: AnimationKeyframe[];
  weaponGeneratedFrames: GeneratedAnimationFrame[];
  boneKeyframes: RigTrackMap;
  boneGeneratedFrames: GeneratedRigTrackMap;
  socketKeyframes: RigTrackMap;
  socketGeneratedFrames: GeneratedRigTrackMap;
  socketLocks: Record<string, string>;
  anchorFrames: [number, number, number];
  modelSystem: ModelSystemChoice;
  modelType: CharacterModelType;
  versionedData: Record<ModelSystemChoice, VersionedAnimationData>;
}

type PosePresetId = 'guard' | 'windup' | 'strike' | 'recoil' | 'reload' | 'idleHands';

const TRACKS: TrackDefinition[] = V3_ANIMATION_TRACKS.map((track) => ({
  id: track.id,
  label: track.label,
  weapon: track.weapon,
  sample: (view, progress, modelSystem) => sampleEditorTrackPose(track.id, view, progress, modelSystem),
}));

function sampleEditorTrackPose(
  trackId: V3AnimationTrackId,
  view: EditorView,
  progress: number,
  modelSystem: ModelSystemChoice
): WeaponPose {
  if (modelSystem === 'v3') {
    return sampleV3EditorTrackPose(trackId, view, progress);
  }

  switch (trackId) {
    case 'hammer_windup':
      return sampleHammerPose(view, 'windup', progress);
    case 'hammer_strike':
      return sampleHammerPose(view, 'strike', progress);
    case 'hammer_recover':
      return sampleHammerPose(view, 'recover', progress);
    case 'hammer_melee':
      return sampleHammerPose(view, 'melee_swing', progress);
    case 'hammer_melee_recover':
      return sampleHammerPose(view, 'melee_recover', progress);
    case 'sword_lunge':
      return view === 'firstPerson'
        ? getFirstPersonSwordLungePose(progress * 0.18)
        : getThirdPersonSwordLungePose(progress * 0.18);
    case 'sword_slash':
      return view === 'firstPerson'
        ? getFirstPersonSwordSlashPose('slash', progress)
        : getThirdPersonSwordSlashPose('slash', progress);
    case 'sword_recover':
      return view === 'firstPerson'
        ? getFirstPersonSwordSlashPose('recover', progress)
        : getThirdPersonSwordSlashPose('recover', progress);
    case 'pistol_fire':
      return samplePistolPose(view, progress);
    case 'pistol_recover':
      return samplePistolPose(view, 1 - progress);
  }
}

function sampleV3EditorTrackPose(
  trackId: V3AnimationTrackId,
  view: EditorView,
  progress: number
): WeaponPose {
  const pct = Math.max(0, Math.min(1, progress));
  const track = getV3AnimationTrackDefinition(trackId);
  let weaponState = 'ready';
  let isLunging = false;

  switch (trackId) {
    case 'hammer_windup':
      weaponState = 'swing_up';
      break;
    case 'hammer_strike':
      weaponState = 'swing_down';
      break;
    case 'hammer_recover':
      weaponState = 'recovering';
      break;
    case 'hammer_melee':
      weaponState = 'melee_swing';
      break;
    case 'hammer_melee_recover':
      weaponState = 'melee_recover';
      break;
    case 'sword_lunge':
      isLunging = true;
      break;
    case 'sword_slash':
      weaponState = 'slashing';
      break;
    case 'sword_recover':
      weaponState = 'recovering';
      break;
    case 'pistol_fire':
    case 'pistol_recover':
      weaponState = 'firing';
      break;
  }

  const input = {
    activeWeapon: track.weapon,
    weaponState,
    weaponTimer: track.defaultDuration * pct,
    isLunging,
    settings: PREVIEW_ATTACK_SETTINGS,
  };

  return view === 'firstPerson'
    ? sampleV3FirstPersonWeaponPose(input)
    : sampleV3ThirdPersonWeaponPose(input);
}

function sampleHammerPose(view: EditorView, phase: HammerAttackPhase, progress: number): WeaponPose {
  return view === 'firstPerson'
    ? getFirstPersonHammerPose(phase, progress)
    : getThirdPersonHammerPose(phase, progress);
}

function samplePistolPose(view: EditorView, progress: number): WeaponPose {
  const pct = Math.max(0, Math.min(1, progress));
  const weaponTimer = 0.18 * pct;
  if (view === 'firstPerson') {
    return sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer,
      isLunging: false,
      settings: {},
    });
  }

  const recoil = 1 - pct;
  return {
    position: [0.08, -0.04 + recoil * 0.02, -0.18 + recoil * 0.1],
    rotation: [-0.04 - recoil * 0.28, 0.02, -0.06],
  };
}

const PREVIEW_ATTACK_SETTINGS = {
  hammerReloadTime: 0.6,
  hammerSlamWindupTime: DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  hammerSlamAttackTime: DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  hammerSlamTimingLocked: DEFAULT_HAMMER_SLAM_TIMING_LOCKED,
  hammerMeleeSpeed: 0.24,
  hammerMeleeReload: 0.5,
  swordSlashSpeed: 0.22,
  swordSlashReload: 0.6,
};

function sampleThirdPersonArmPose(trackId: string, progress: number): CombatantArmPose | null {
  const pct = Math.max(0, Math.min(1, progress));

  if (trackId === 'hammer_windup') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.hammerSlamWindupTime * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'hammer_strike') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_down',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.hammerSlamAttackTime * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'hammer_recover') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'recovering',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.hammerReloadTime * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'hammer_melee') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'melee_swing',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.hammerMeleeSpeed * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'hammer_melee_recover') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'melee_recover',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.hammerMeleeReload * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'sword_lunge') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.18 * pct,
      isLunging: true,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'sword_slash') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'sword',
      weaponState: 'slashing',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.swordSlashSpeed * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'sword_recover') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'sword',
      weaponState: 'recovering',
      weaponTimer: PREVIEW_ATTACK_SETTINGS.swordSlashReload * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'pistol_fire' || trackId === 'pistol_recover') {
    const recoil = trackId === 'pistol_fire' ? 1 - pct : pct;
    return {
      rightArmRotation: [-0.42 - recoil * 0.36, 0.04, -0.08],
      leftArmRotation: [-0.16, -0.12, 0.12],
    };
  }

  return null;
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

const THIRD_PERSON_SOCKET_NAMES: CombatantAttachmentPointName[] = [
  'thirdPersonWeaponGrip',
  'thirdPersonOffhandGrip',
  'rightHandGrip',
  'leftHandGrip',
  'headCenter',
  'chestCenter',
];

const FIRST_PERSON_SOCKET_NAMES: CombatantAttachmentPointName[] = [
  'firstPersonWeaponGrip',
  'firstPersonOffhandGrip',
];

const SKELETON_CONNECTIONS: Array<[CombatantBoneName, CombatantBoneName]> = [
  ['root', 'lowerTorso'],
  ['root', 'upperTorso'],
  ['upperTorso', 'head'],
  ['upperTorso', 'leftArm'],
  ['upperTorso', 'rightArm'],
  ['lowerTorso', 'leftLeg'],
  ['lowerTorso', 'rightLeg'],
];

const targetKey = (target: SelectedRigTarget): string =>
  `${target.view}:${target.kind}:${target.name}`;

const encodeTargetValue = targetKey;

const decodeTargetValue = (value: string): SelectedRigTarget | null => {
  const [view, kind, name] = value.split(':');
  if (
    (view !== 'firstPerson' && view !== 'thirdPerson') ||
    (kind !== 'weapon' && kind !== 'bone' && kind !== 'socket') ||
    !name
  ) {
    return null;
  }

  return { view, kind, name };
};

const targetLabel = (target: SelectedRigTarget): string => {
  const prefix = target.kind === 'weapon'
    ? 'Weapon'
    : target.kind === 'bone'
      ? 'Bone'
      : 'Socket';
  return `${prefix}: ${target.name}`;
};

const poseFromObject = (object: THREE.Object3D): RigTargetPose => ({
  position: [object.position.x, object.position.y, object.position.z],
  rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
});

const applyPoseToObject = (object: THREE.Object3D, pose: RigTargetPose): void => {
  object.position.set(...pose.position);
  object.rotation.set(...pose.rotation);
};

const viewport = requireElement<HTMLDivElement>('viewport');
const workspace = requireElement<HTMLDivElement>('workspace');
const weaponSelect = requireElement<HTMLSelectElement>('weaponSelect');
const viewSelect = requireElement<HTMLSelectElement>('viewSelect');
const trackSelect = requireElement<HTMLSelectElement>('trackSelect');
const targetSelect = requireElement<HTMLSelectElement>('targetSelect');
const frameCountInput = requireElement<HTMLInputElement>('frameCountInput');
const interpolationSelect = requireElement<HTMLSelectElement>('interpolationSelect');
const dirtyIndicator = requireElement<HTMLSpanElement>('dirtyIndicator');
const undoButton = requireElement<HTMLButtonElement>('undoButton');
const redoButton = requireElement<HTMLButtonElement>('redoButton');
const exportDrawerButton = requireElement<HTMLButtonElement>('exportDrawerButton');
const openAtlasButton = requireElement<HTMLButtonElement>('openAtlasButton');
const seedButton = requireElement<HTMLButtonElement>('seedButton');
const generateButton = requireElement<HTMLButtonElement>('generateButton');
const duplicateClipButton = requireElement<HTMLButtonElement>('duplicateClipButton');
const newFromCurrentButton = requireElement<HTMLButtonElement>('newFromCurrentButton');
const saveLocalButton = requireElement<HTMLButtonElement>('saveLocalButton');
const clearLocalButton = requireElement<HTMLButtonElement>('clearLocalButton');
const translateButton = requireElement<HTMLButtonElement>('translateButton');
const rotateButton = requireElement<HTMLButtonElement>('rotateButton');
const setKeyframeButton = requireElement<HTMLButtonElement>('setKeyframeButton');
const autoKeyToggle = requireElement<HTMLInputElement>('autoKeyToggle');
const localSpaceToggle = requireElement<HTMLInputElement>('localSpaceToggle');
const posePresetSelect = requireElement<HTMLSelectElement>('posePresetSelect');
const applyPosePresetButton = requireElement<HTMLButtonElement>('applyPosePresetButton');
const socketLockSelect = requireElement<HTMLSelectElement>('socketLockSelect');
const lockSocketButton = requireElement<HTMLButtonElement>('lockSocketButton');
const repositionSocketButton = requireElement<HTMLButtonElement>('repositionSocketButton');
const unlockSocketButton = requireElement<HTMLButtonElement>('unlockSocketButton');
const socketLockStatus = requireElement<HTMLElement>('socketLockStatus');
const showSkeletonToggle = requireElement<HTMLInputElement>('showSkeletonToggle');
const showSocketsToggle = requireElement<HTMLInputElement>('showSocketsToggle');
const showLabelsToggle = requireElement<HTMLInputElement>('showLabelsToggle');
const anchorRows = requireElement<HTMLDivElement>('anchorRows');
const keyframeList = requireElement<HTMLDivElement>('keyframeList');
const keyframeCount = requireElement<HTMLElement>('keyframeCount');
const playButton = requireElement<HTMLButtonElement>('playButton');
const frameSlider = requireElement<HTMLInputElement>('frameSlider');
const loopInInput = requireElement<HTMLInputElement>('loopInInput');
const loopOutInput = requireElement<HTMLInputElement>('loopOutInput');
const frameReadout = requireElement<HTMLElement>('frameReadout');
const timeline = requireElement<HTMLDivElement>('timeline');
const dopeSheet = requireElement<HTMLDivElement>('dopeSheet');
const exportText = requireElement<HTMLTextAreaElement>('exportText');
const importText = requireElement<HTMLTextAreaElement>('importText');
const importJsonButton = requireElement<HTMLButtonElement>('importJsonButton');
const chooseJsonButton = requireElement<HTMLButtonElement>('chooseJsonButton');
const importFileInput = requireElement<HTMLInputElement>('importFileInput');
const importDropzone = requireElement<HTMLDivElement>('importDropzone');
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
const validationStatus = requireElement<HTMLElement>('validationStatus');
const validationReport = requireElement<HTMLDivElement>('validationReport');
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
transformControls.setSpace('local');
transformControls.setTranslationSnap(0.01);
transformControls.setRotationSnap(0.05);
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

let thirdPersonRig: CombatantMeshRig = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v1' });
thirdPersonRig.group.position.set(0, 0, 0);
thirdPersonRig.group.rotation.y = Math.PI;

const modelSystemSelect = requireElement<HTMLSelectElement>('modelSystemSelect');
const modelTypeSelect = requireElement<HTMLSelectElement>('modelTypeSelect');

const V2_BONE_NAMES = [
  'pelvis',
  'stomach',
  'chest',
  'neck',
  'head',
  'shoulder_l',
  'arm_upper_l',
  'arm_lower_l',
  'hand_l',
  'shoulder_r',
  'arm_upper_r',
  'arm_lower_r',
  'hand_r',
  'leg_upper_l',
  'leg_lower_l',
  'foot_l',
  'toes_l',
  'leg_upper_r',
  'leg_lower_r',
  'foot_r',
  'toes_r',
] as const;

const V3_BONE_NAMES = ['lowerTorso', 'upperTorso', 'head', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;

const V2_SKELETON_CONNECTIONS: Array<[string, string]> = [
  ['pelvis', 'stomach'],
  ['stomach', 'chest'],
  ['chest', 'neck'],
  ['neck', 'head'],
  ['chest', 'shoulder_l'],
  ['shoulder_l', 'arm_upper_l'],
  ['arm_upper_l', 'arm_lower_l'],
  ['arm_lower_l', 'hand_l'],
  ['chest', 'shoulder_r'],
  ['shoulder_r', 'arm_upper_r'],
  ['arm_upper_r', 'arm_lower_r'],
  ['arm_lower_r', 'hand_r'],
  ['pelvis', 'leg_upper_l'],
  ['leg_upper_l', 'leg_lower_l'],
  ['leg_lower_l', 'foot_l'],
  ['foot_l', 'toes_l'],
  ['pelvis', 'leg_upper_r'],
  ['leg_upper_r', 'leg_lower_r'],
  ['leg_lower_r', 'foot_r'],
  ['foot_r', 'toes_r'],
];

const firstPersonRoot = new THREE.Group();
firstPersonRoot.position.set(0, 1.0, 0);
scene.add(firstPersonRoot);
const firstPersonRig = createFirstPersonWeaponRig(firstPersonRoot);
const firstPersonWeaponGrip = firstPersonRig.attachments.firstPersonWeaponGrip;

let firstPersonHammer: THREE.Group | undefined;
let firstPersonSword: THREE.Group | undefined;
let firstPersonPistol: THREE.Group | undefined;

const disposeObjectTree = (object: THREE.Object3D | undefined): void => {
  if (!object) return;
  object.parent?.remove(object);
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    }
  });
};

const rebuildFirstPersonWeapons = (system: ModelSystemChoice): void => {
  disposeObjectTree(firstPersonHammer);
  disposeObjectTree(firstPersonSword);
  disposeObjectTree(firstPersonPistol);

  if (system === 'v3') {
    firstPersonHammer = buildV3HammerModel(192, EDITOR_V3_RENDER_OPTIONS);
    firstPersonSword = buildV3SwordModel(192, EDITOR_V3_RENDER_OPTIONS);
    firstPersonPistol = buildV3PistolModel(192, EDITOR_V3_RENDER_OPTIONS);
  } else {
    firstPersonHammer = buildGravityHammerModel(192);
    firstPersonSword = buildKatarSwordModel(192);
    firstPersonPistol = buildPistolModel(192);
  }

  firstPersonHammer.visible = false;
  firstPersonSword.visible = false;
  firstPersonPistol.visible = false;
  attachToAttachmentPoint(firstPersonWeaponGrip, firstPersonHammer);
  attachToAttachmentPoint(firstPersonWeaponGrip, firstPersonSword);
  attachToAttachmentPoint(firstPersonWeaponGrip, firstPersonPistol);
};

rebuildFirstPersonWeapons('v1');

const reticleMaterial = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.42 });
const reticleGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-0.12, 0, -0.95),
  new THREE.Vector3(0.12, 0, -0.95),
  new THREE.Vector3(0, -0.12, -0.95),
  new THREE.Vector3(0, 0.12, -0.95),
]);
const reticle = new THREE.LineSegments(reticleGeometry, reticleMaterial);
firstPersonRoot.add(reticle);

interface RigOverlayMarker {
  target: SelectedRigTarget;
  group: THREE.Group;
  label: THREE.Sprite;
}

const rigOverlayRoot = new THREE.Group();
rigOverlayRoot.name = 'rigOverlayRoot';
scene.add(rigOverlayRoot);

const boneMarkerGeometry = new THREE.SphereGeometry(0.038, 12, 8);
const socketMarkerGeometry = new THREE.BoxGeometry(0.07, 0.07, 0.07);
const boneMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x22d3ee, depthTest: false });
const socketMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b, depthTest: false });
const selectedMarkerMaterial = new THREE.MeshBasicMaterial({ color: 0x34d399, depthTest: false });
let skeletonLineGeometry = new THREE.BufferGeometry();
let skeletonLinePositions = new Float32Array(SKELETON_CONNECTIONS.length * 2 * 3);
const skeletonLineMaterial = new THREE.LineBasicMaterial({
  color: 0x38bdf8,
  transparent: true,
  opacity: 0.58,
  depthTest: false,
});
let skeletonLines = new THREE.LineSegments(skeletonLineGeometry, skeletonLineMaterial);
rigOverlayRoot.add(skeletonLines);
const rigOverlayMarkers: RigOverlayMarker[] = [];

const createLabelSprite = (text: string, color: string): THREE.Sprite => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.font = '700 24px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillStyle = 'rgba(2, 6, 23, 0.72)';
    context.fillRect(0, 12, canvas.width, 40);
    context.strokeStyle = color;
    context.strokeRect(1, 13, canvas.width - 2, 38);
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.36, 0.09, 1);
  sprite.position.set(0, 0.11, 0);
  return sprite;
};

const createEmptyVersionedData = (frameCount = 31): VersionedAnimationData => ({
  weaponKeyframes: [],
  weaponGeneratedFrames: [],
  boneKeyframes: {},
  boneGeneratedFrames: {},
  socketKeyframes: {},
  socketGeneratedFrames: {},
  socketLocks: {},
  frameCount,
  anchorFrames: makeAnchorFrames(frameCount),
  interpolation: 'smoothstep',
});

const state: EditorState = {
  weapon: 'hammer',
  view: 'thirdPerson',
  trackId: 'hammer_windup',
  frameCount: 31,
  currentFrame: 0,
  interpolation: 'smoothstep',
  transformMode: 'translate',
  selectedTarget: { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
  weaponKeyframes: [],
  weaponGeneratedFrames: [],
  boneKeyframes: {},
  boneGeneratedFrames: {},
  socketKeyframes: {},
  socketGeneratedFrames: {},
  socketLocks: {},
  anchorFrames: makeAnchorFrames(31),
  playing: false,
  showSkeleton: true,
  showSockets: true,
  showLabels: true,
  autoKey: false,
  localTransformSpace: true,
  modelSystem: 'v1',
  modelType: 'medium',
  versionedData: {
    v1: createEmptyVersionedData(31),
    v2: createEmptyVersionedData(31),
    v3: createEmptyVersionedData(31),
  },
};

let draftFrame: number | null = null;
let draftPose: WeaponPose | null = null;
let playbackAccumulator = 0;
const playbackFrameDuration = 1 / 18;
let lastAnimationTime = performance.now();
const baselineTargetPoses = new Map<string, RigTargetPose>();
const SAVED_DRAFT_STORAGE_KEY = 'ibrawls_animation_editor_saved_draft';
const CUSTOM_CLIPS_STORAGE_KEY = 'ibrawls_animation_editor_custom_clips';

interface RuntimeSocketLock {
  target: SelectedRigTarget;
  socket: SelectedRigTarget;
  pivot: THREE.Group;
  child: THREE.Object3D;
  originalParent: THREE.Object3D | null;
}

const runtimeSocketLocks = new Map<string, RuntimeSocketLock>();
let loopRange: AnimationEditorLoopRange = { inFrame: 0, outFrame: state.frameCount - 1 };
let historyState: AnimationEditorHistory<AnimationEditorSnapshot> | null = null;
let customVariants: AnimationEditorLocalVariantRecord[] = [];
let draggingDopeKey: { targetKeyValue: string; frame: number; pointerId: number; track: HTMLElement } | null = null;

const cloneTarget = (target: SelectedRigTarget): SelectedRigTarget => ({ ...target });

const cloneKeyframe = (keyframe: AnimationKeyframe): AnimationKeyframe => ({
  ...keyframe,
  pose: clonePose(keyframe.pose),
});

const cloneGeneratedFrame = (frame: GeneratedAnimationFrame): GeneratedAnimationFrame => ({
  ...frame,
  pose: clonePose(frame.pose),
});

const cloneKeyframes = (keyframes: AnimationKeyframe[]): AnimationKeyframe[] => keyframes.map(cloneKeyframe);

const cloneGeneratedFrames = (frames: GeneratedAnimationFrame[]): GeneratedAnimationFrame[] =>
  frames.map(cloneGeneratedFrame);

const cloneKeyframeMap = (map: RigTrackMap): RigTrackMap =>
  Object.fromEntries(Object.entries(map).map(([key, keyframes]) => [key, cloneKeyframes(keyframes)]));

const cloneGeneratedMap = (map: GeneratedRigTrackMap): GeneratedRigTrackMap =>
  Object.fromEntries(Object.entries(map).map(([key, frames]) => [key, cloneGeneratedFrames(frames)]));

const cloneSocketLocks = (locks: Record<string, string>): Record<string, string> => ({ ...locks });

const cloneAnchorFrames = (frames: [number, number, number]): [number, number, number] => [
  frames[0],
  frames[1],
  frames[2],
];

const cloneVersionedData = (data: VersionedAnimationData): VersionedAnimationData => ({
  weaponKeyframes: cloneKeyframes(data.weaponKeyframes),
  weaponGeneratedFrames: cloneGeneratedFrames(data.weaponGeneratedFrames),
  boneKeyframes: cloneKeyframeMap(data.boneKeyframes),
  boneGeneratedFrames: cloneGeneratedMap(data.boneGeneratedFrames),
  socketKeyframes: cloneKeyframeMap(data.socketKeyframes),
  socketGeneratedFrames: cloneGeneratedMap(data.socketGeneratedFrames),
  socketLocks: cloneSocketLocks(data.socketLocks),
  frameCount: data.frameCount,
  anchorFrames: cloneAnchorFrames(data.anchorFrames),
  interpolation: data.interpolation,
});

const armPoseToRigTargetPose = (
  boneName: Extract<CombatantBoneName, 'rightArm' | 'leftArm'>,
  armPose: CombatantArmPose
): RigTargetPose => {
  const target: SelectedRigTarget = { kind: 'bone', name: boneName, view: 'thirdPerson' };
  const baseline = baselineTargetPoses.get(targetKey(target));
  return {
    position: baseline?.position ?? [0, 0, 0],
    rotation: boneName === 'rightArm' ? armPose.rightArmRotation : armPose.leftArmRotation,
  };
};

function seedLinkedThirdPersonArmTracksV1(weaponKeyframes: AnimationKeyframe[]): void {
  if (state.view !== 'thirdPerson' || state.selectedTarget.kind !== 'weapon') return;

  const normalized = normalizeKeyframes(weaponKeyframes, state.frameCount);
  const maxFrame = Math.max(1, state.frameCount - 1);
  const armKeyframes: Record<Extract<CombatantBoneName, 'rightArm' | 'leftArm'>, AnimationKeyframe[]> = {
    rightArm: [],
    leftArm: [],
  };

  normalized.forEach((keyframe) => {
    const armPose = sampleThirdPersonArmPose(state.trackId, keyframe.frame / maxFrame);
    if (!armPose) return;

    (['rightArm', 'leftArm'] as const).forEach((boneName) => {
      armKeyframes[boneName].push({
        frame: keyframe.frame,
        label: keyframe.label,
        pose: armPoseToRigTargetPose(boneName, armPose),
      });
    });
  });

  const nextKeyframes = { ...state.boneKeyframes };
  const nextGenerated = { ...state.boneGeneratedFrames };

  (['rightArm', 'leftArm'] as const).forEach((boneName) => {
    if (armKeyframes[boneName].length === 0) return;
    const target: SelectedRigTarget = { kind: 'bone', name: boneName, view: 'thirdPerson' };
    const key = targetKey(target);
    nextKeyframes[key] = mergeLinkedArmKeyframesPreservingPositions(
      armKeyframes[boneName],
      state.boneKeyframes[key],
      state.boneGeneratedFrames[key],
      state.frameCount
    );
    nextGenerated[key] = generatePoseFrames(nextKeyframes[key], state.frameCount, state.interpolation);
  });

  state.boneKeyframes = nextKeyframes;
  state.boneGeneratedFrames = nextGenerated;
}

function seedLinkedThirdPersonArmTracksV2(weaponKeyframes: AnimationKeyframe[]): void {
  if (state.view !== 'thirdPerson' || state.selectedTarget.kind !== 'weapon') return;

  const normalized = normalizeKeyframes(weaponKeyframes, state.frameCount);
  const maxFrame = Math.max(1, state.frameCount - 1);
  const v2BonesToSeed = ['arm_lower_r', 'arm_lower_l', 'hand_r'] as const;
  const boneKeyframesMap: Record<typeof v2BonesToSeed[number], AnimationKeyframe[]> = {
    arm_lower_r: [],
    arm_lower_l: [],
    hand_r: [],
  };

  normalized.forEach((keyframe) => {
    const progress = keyframe.frame / maxFrame;
    let arm_lower_r_rot = 0;
    let arm_lower_l_rot = 0;
    let hand_r_rot = 0;

    if (state.trackId.includes('windup')) {
      arm_lower_r_rot = -1.6 * progress;
      arm_lower_l_rot = -1.1 * progress;
      hand_r_rot = 0.4 * progress;
    } else if (state.trackId.includes('strike')) {
      arm_lower_r_rot = -1.6 + (-0.1 - -1.6) * progress;
      arm_lower_l_rot = -1.1 + (-0.1 - -1.1) * progress;
      hand_r_rot = 0.4 + (-0.6 - 0.4) * progress;
    } else if (state.trackId.includes('recover')) {
      arm_lower_r_rot = -0.1 + (-0.2 - -0.1) * progress;
      arm_lower_l_rot = -0.1 + (-0.2 - -0.1) * progress;
      hand_r_rot = -0.6 + (0.0 - -0.6) * progress;
    }

    boneKeyframesMap.arm_lower_r.push({
      frame: keyframe.frame,
      label: keyframe.label,
      pose: { position: [0, 0, 0], rotation: [arm_lower_r_rot, 0, 0] },
    });
    boneKeyframesMap.arm_lower_l.push({
      frame: keyframe.frame,
      label: keyframe.label,
      pose: { position: [0, 0, 0], rotation: [arm_lower_l_rot, 0, 0] },
    });
    boneKeyframesMap.hand_r.push({
      frame: keyframe.frame,
      label: keyframe.label,
      pose: { position: [0, 0, 0], rotation: [hand_r_rot, 0, 0] },
    });
  });

  const nextKeyframes = { ...state.boneKeyframes };
  const nextGenerated = { ...state.boneGeneratedFrames };

  v2BonesToSeed.forEach((boneName) => {
    const target: SelectedRigTarget = { kind: 'bone', name: boneName, view: 'thirdPerson' };
    const key = targetKey(target);
    nextKeyframes[key] = mergeLinkedArmKeyframesPreservingPositions(
      boneKeyframesMap[boneName],
      state.boneKeyframes[key],
      state.boneGeneratedFrames[key],
      state.frameCount
    );
    nextGenerated[key] = generatePoseFrames(nextKeyframes[key], state.frameCount, state.interpolation);
  });

  state.boneKeyframes = nextKeyframes;
  state.boneGeneratedFrames = nextGenerated;
}

function seedLinkedThirdPersonArmTracksV3(weaponKeyframes: AnimationKeyframe[]): void {
  seedLinkedThirdPersonArmTracksV1(weaponKeyframes);
}

function seedLinkedThirdPersonArmTracks(weaponKeyframes: AnimationKeyframe[]): void {
  if (state.modelSystem === 'v3') {
    seedLinkedThirdPersonArmTracksV3(weaponKeyframes);
  } else if (state.modelSystem === 'v2') {
    seedLinkedThirdPersonArmTracksV2(weaponKeyframes);
  } else {
    seedLinkedThirdPersonArmTracksV1(weaponKeyframes);
  }
}

const requireWeaponObject = (weapon: WeaponChoice, object: THREE.Group | undefined): THREE.Group => {
  if (!object) {
    throw new Error(`Missing animation editor weapon object: ${weapon}`);
  }
  return object;
};

function getWeaponObject(view: EditorView, weapon: WeaponChoice): THREE.Group {
  if (view === 'firstPerson') {
    if (weapon === 'hammer') return requireWeaponObject(weapon, firstPersonHammer);
    if (weapon === 'sword') return requireWeaponObject(weapon, firstPersonSword);
    return requireWeaponObject(weapon, firstPersonPistol);
  }
  if (weapon === 'hammer') return thirdPersonRig.hammer;
  if (weapon === 'sword') return thirdPersonRig.sword;
  return requireWeaponObject(weapon, thirdPersonRig.pistol);
}

function getActiveWeaponObject(): THREE.Group {
  return getWeaponObject(state.view, state.weapon);
}

function getRawTargetObject(target: SelectedRigTarget): THREE.Group | null {
  if (target.kind === 'weapon') {
    return getWeaponObject(target.view, target.name as WeaponChoice);
  }

  if (target.kind === 'bone') {
    if (target.view === 'thirdPerson') {
      if (state.modelSystem === 'v2') {
        return (thirdPersonRig.group.userData[target.name] as THREE.Group) ?? null;
      }
      return thirdPersonRig.rig.bones[target.name as CombatantBoneName] ?? null;
    }
    return null;
  }

  if (target.view === 'firstPerson') {
    const attachment = firstPersonRig.attachments[
      target.name as keyof typeof firstPersonRig.attachments
    ];
    return attachment?.group ?? null;
  }

  return thirdPersonRig.rig.attachments[target.name as CombatantAttachmentPointName]?.group ?? null;
}

function canTargetLockToSocket(target: SelectedRigTarget): boolean {
  return target.kind === 'weapon';
}

function getRuntimeSocketLock(target: SelectedRigTarget): RuntimeSocketLock | null {
  const key = targetKey(target);
  const socketKey = state.socketLocks[key];
  if (!socketKey) return null;

  const existing = runtimeSocketLocks.get(key);
  if (existing && targetKey(existing.socket) === socketKey) return existing;

  const socketTarget = decodeTargetValue(socketKey);
  if (!socketTarget || socketTarget.kind !== 'socket') return null;

  return createSocketLockRuntime(target, socketTarget, false);
}

function getTargetObject(target: SelectedRigTarget): THREE.Group | null {
  return getRuntimeSocketLock(target)?.pivot ?? getRawTargetObject(target);
}

function resetSelectedTrackToPose(pose: RigTargetPose, message: string): void {
  const keyframes = state.anchorFrames.map((frame, index) => ({
    frame,
    label: String.fromCharCode(65 + index),
    pose: clonePose(pose),
  }));
  setSelectedKeyframes(keyframes);
  setSelectedGeneratedFrames(generatePoseFrames(keyframes, state.frameCount, state.interpolation));
  clearDraft();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(message);
}

function removeSocketLockRuntime(targetKeyValue: string, preserveWorld = true): RuntimeSocketLock | null {
  const runtime = runtimeSocketLocks.get(targetKeyValue);
  if (!runtime) return null;

  runtime.pivot.updateWorldMatrix(true, true);
  runtime.child.updateWorldMatrix(true, false);
  if (preserveWorld && runtime.originalParent) {
    runtime.originalParent.attach(runtime.child);
  } else if (runtime.originalParent) {
    runtime.originalParent.add(runtime.child);
  }
  runtime.pivot.parent?.remove(runtime.pivot);
  runtimeSocketLocks.delete(targetKeyValue);
  return runtime;
}

function createSocketLockRuntime(
  target: SelectedRigTarget,
  socket: SelectedRigTarget,
  resetTrack: boolean
): RuntimeSocketLock | null {
  if (!canTargetLockToSocket(target) || socket.kind !== 'socket' || target.view !== socket.view) return null;

  const targetKeyValue = targetKey(target);
  const child = getRawTargetObject(target);
  const socketObject = getRawTargetObject(socket);
  if (!child || !socketObject) return null;

  const existing = runtimeSocketLocks.get(targetKeyValue);
  const originalParent = existing?.originalParent ?? child.parent;
  if (existing) {
    removeSocketLockRuntime(targetKeyValue, true);
  }

  const pivot = new THREE.Group();
  pivot.name = `socketLock:${target.name}->${socket.name}`;
  pivot.userData.socketLockTarget = targetKeyValue;
  pivot.userData.socketLockSocket = targetKey(socket);
  socketObject.add(pivot);
  socketObject.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  pivot.updateWorldMatrix(true, false);
  pivot.attach(child);

  const runtime: RuntimeSocketLock = {
    target: { ...target },
    socket: { ...socket },
    pivot,
    child,
    originalParent,
  };

  runtimeSocketLocks.set(targetKeyValue, runtime);
  state.socketLocks[targetKeyValue] = targetKey(socket);
  baselineTargetPoses.set(targetKeyValue, poseFromObject(pivot));

  if (resetTrack && targetKey(state.selectedTarget) === targetKeyValue) {
    resetSelectedTrackToPose(
      poseFromObject(pivot),
      `${targetLabel(target)} locked to ${targetLabel(socket)}.`
    );
  }

  return runtime;
}

function repositionTargetToSocket(target: SelectedRigTarget, socket: SelectedRigTarget): RuntimeSocketLock | null {
  const runtime = createSocketLockRuntime(target, socket, false);
  if (!runtime) return null;

  const socketPose: RigTargetPose = { position: [0, 0, 0], rotation: [0, 0, 0] };
  applyPoseToObject(runtime.pivot, socketPose);
  runtime.child.position.set(0, 0, 0);
  runtime.child.rotation.set(0, 0, 0);
  runtime.child.updateMatrixWorld(true);

  baselineTargetPoses.set(targetKey(target), clonePose(socketPose));

  if (targetKey(state.selectedTarget) === targetKey(target)) {
    setKeyframe(state.currentFrame, socketPose);
    setStatus(`${targetLabel(target)} repositioned to ${targetLabel(socket)}.`);
  }

  return runtime;
}

function getTargetOptionsForView(view: EditorView): TargetOption[] {
  const options: TargetOption[] = [
    {
      target: { kind: 'weapon', name: state.weapon, view },
      label: targetLabel({ kind: 'weapon', name: state.weapon, view }),
    },
  ];

  if (view === 'thirdPerson') {
    const bonesToUse = state.modelSystem === 'v3'
      ? V3_BONE_NAMES
      : state.modelSystem === 'v2'
        ? V2_BONE_NAMES
        : COMBATANT_BONE_NAMES;
    bonesToUse.forEach((name) => {
      options.push({
        target: { kind: 'bone', name, view },
        label: targetLabel({ kind: 'bone', name, view }),
      });
    });

    THIRD_PERSON_SOCKET_NAMES.forEach((name) => {
      if (thirdPersonRig.rig.attachments[name]) {
        options.push({
          target: { kind: 'socket', name, view },
          label: targetLabel({ kind: 'socket', name, view }),
        });
      }
    });
  } else {
    FIRST_PERSON_SOCKET_NAMES.forEach((name) => {
      options.push({
        target: { kind: 'socket', name, view },
        label: targetLabel({ kind: 'socket', name, view }),
      });
    });
  }

  return options;
}

function getRigTargetsForView(view: EditorView): SelectedRigTarget[] {
  return getTargetOptionsForView(view)
    .map((option) => option.target)
    .filter((target) => target.kind !== 'weapon');
}

function getSocketTargetsForView(view: EditorView): SelectedRigTarget[] {
  return getTargetOptionsForView(view)
    .map((option) => option.target)
    .filter((target) => target.kind === 'socket');
}

function getAllRigTargets(): SelectedRigTarget[] {
  return [
    ...getRigTargetsForView('thirdPerson'),
    ...getRigTargetsForView('firstPerson'),
  ];
}

function getDefaultTarget(): SelectedRigTarget {
  return { kind: 'weapon', name: state.weapon, view: state.view };
}

function isTargetAvailable(target: SelectedRigTarget): boolean {
  return getTargetOptionsForView(state.view)
    .some((option) => encodeTargetValue(option.target) === encodeTargetValue(target));
}

function ensureSelectedTarget(): void {
  state.selectedTarget.view = state.view;
  if (state.selectedTarget.kind === 'weapon') {
    state.selectedTarget.name = state.weapon;
  }
  if (!isTargetAvailable(state.selectedTarget)) {
    state.selectedTarget = getDefaultTarget();
  }
}

function clearRuntimeSocketLocks(preserveWorld = true): void {
  Array.from(runtimeSocketLocks.keys()).forEach((key) => {
    removeSocketLockRuntime(key, preserveWorld);
  });
}

function rebuildRuntimeSocketLocks(): void {
  clearRuntimeSocketLocks(true);
  Object.entries(state.socketLocks).forEach(([targetKeyValue, socketKeyValue]) => {
    const target = decodeTargetValue(targetKeyValue);
    const socket = decodeTargetValue(socketKeyValue);
    if (!target || !socket || socket.kind !== 'socket') {
      delete state.socketLocks[targetKeyValue];
      return;
    }
    createSocketLockRuntime(target, socket, false);
  });
}

function unlockSocketLockForTarget(target: SelectedRigTarget, resetTrack: boolean): void {
  const key = targetKey(target);
  if (!state.socketLocks[key]) {
    setStatus(`${targetLabel(target)} is not locked to a socket.`);
    return;
  }

  removeSocketLockRuntime(key, true);
  delete state.socketLocks[key];

  const rawObject = getRawTargetObject(target);
  if (rawObject) {
    baselineTargetPoses.set(key, poseFromObject(rawObject));
  }

  if (resetTrack && targetKey(state.selectedTarget) === key) {
    resetSelectedTrackToPose(
      captureSelectedPose(),
      `${targetLabel(target)} unlocked from socket pivot.`
    );
  }
}

function captureSelectedPose(): RigTargetPose {
  return poseFromObject(getTargetObject(state.selectedTarget) ?? getActiveWeaponObject());
}

function applyPoseToSelected(pose: RigTargetPose): void {
  const object = getTargetObject(state.selectedTarget);
  if (object) applyPoseToObject(object, pose);
}

function getRigKeyframeMap(kind: RigTargetKind): RigTrackMap {
  return kind === 'bone' ? state.boneKeyframes : state.socketKeyframes;
}

function getRigGeneratedMap(kind: RigTargetKind): GeneratedRigTrackMap {
  return kind === 'bone' ? state.boneGeneratedFrames : state.socketGeneratedFrames;
}

function setRigKeyframeMap(kind: RigTargetKind, map: RigTrackMap): void {
  if (kind === 'bone') {
    state.boneKeyframes = map;
  } else if (kind === 'socket') {
    state.socketKeyframes = map;
  }
}

function setRigGeneratedMap(kind: RigTargetKind, map: GeneratedRigTrackMap): void {
  if (kind === 'bone') {
    state.boneGeneratedFrames = map;
  } else if (kind === 'socket') {
    state.socketGeneratedFrames = map;
  }
}

function getSelectedKeyframes(): AnimationKeyframe[] {
  if (state.selectedTarget.kind === 'weapon') return state.weaponKeyframes;
  return getRigKeyframeMap(state.selectedTarget.kind)[targetKey(state.selectedTarget)] ?? [];
}

function setSelectedKeyframes(keyframes: AnimationKeyframe[]): void {
  setKeyframesForTarget(state.selectedTarget, keyframes);
}

function getKeyframesForTarget(target: SelectedRigTarget): AnimationKeyframe[] {
  if (target.kind === 'weapon') return state.weaponKeyframes;
  return getRigKeyframeMap(target.kind)[targetKey(target)] ?? [];
}

function setKeyframesForTarget(target: SelectedRigTarget, keyframes: AnimationKeyframe[]): void {
  if (target.kind === 'weapon') {
    state.weaponKeyframes = keyframes;
    return;
  }

  const map = {
    ...getRigKeyframeMap(target.kind),
    [targetKey(target)]: keyframes,
  };
  setRigKeyframeMap(target.kind, map);
}

function getSelectedGeneratedFrames(): GeneratedAnimationFrame[] {
  return getGeneratedFramesForTarget(state.selectedTarget);
}

function setSelectedGeneratedFrames(frames: GeneratedAnimationFrame[]): void {
  setGeneratedFramesForTarget(state.selectedTarget, frames);
}

function getGeneratedFramesForTarget(target: SelectedRigTarget): GeneratedAnimationFrame[] {
  if (target.kind === 'weapon') return state.weaponGeneratedFrames;
  return getRigGeneratedMap(target.kind)[targetKey(target)] ?? [];
}

function setGeneratedFramesForTarget(target: SelectedRigTarget, frames: GeneratedAnimationFrame[]): void {
  if (target.kind === 'weapon') {
    state.weaponGeneratedFrames = frames;
    return;
  }

  const map = {
    ...getRigGeneratedMap(target.kind),
    [targetKey(target)]: frames,
  };
  setRigGeneratedMap(target.kind, map);
}

function getCurrentSelectedPose(): RigTargetPose {
  if (draftFrame === state.currentFrame && draftPose) {
    return clonePose(draftPose);
  }

  const generatedPose = getSelectedGeneratedFrames()[state.currentFrame]?.pose;
  if (generatedPose) return clonePose(generatedPose);

  const firstKeyframePose = getSelectedKeyframes()[0]?.pose;
  if (firstKeyframePose) return clonePose(firstKeyframePose);

  const baselinePose = baselineTargetPoses.get(targetKey(state.selectedTarget));
  if (baselinePose) return clonePose(baselinePose);

  return captureSelectedPose();
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

function captureEditorSnapshot(): AnimationEditorSnapshot {
  saveVersionedData(state.modelSystem);
  return {
    weapon: state.weapon,
    view: state.view,
    trackId: state.trackId,
    frameCount: state.frameCount,
    currentFrame: state.currentFrame,
    interpolation: state.interpolation,
    transformMode: state.transformMode,
    selectedTarget: cloneTarget(state.selectedTarget),
    weaponKeyframes: cloneKeyframes(state.weaponKeyframes),
    weaponGeneratedFrames: cloneGeneratedFrames(state.weaponGeneratedFrames),
    boneKeyframes: cloneKeyframeMap(state.boneKeyframes),
    boneGeneratedFrames: cloneGeneratedMap(state.boneGeneratedFrames),
    socketKeyframes: cloneKeyframeMap(state.socketKeyframes),
    socketGeneratedFrames: cloneGeneratedMap(state.socketGeneratedFrames),
    socketLocks: cloneSocketLocks(state.socketLocks),
    anchorFrames: cloneAnchorFrames(state.anchorFrames),
    modelSystem: state.modelSystem,
    modelType: state.modelType,
    versionedData: {
      v1: cloneVersionedData(state.versionedData.v1),
      v2: cloneVersionedData(state.versionedData.v2),
      v3: cloneVersionedData(state.versionedData.v3),
    },
  };
}

function rebuildPreviewRig(system: ModelSystemChoice): void {
  clearRuntimeSocketLocks(true);
  disposeObjectTree(thirdPersonRig.group);
  thirdPersonRig = createCombatantMeshRig(
    scene,
    192,
    false,
    currentPreviewLoadout(system),
    system === 'v3' ? EDITOR_V3_RENDER_OPTIONS : undefined
  );
  thirdPersonRig.group.position.set(0, 0, 0);
  thirdPersonRig.group.rotation.y = Math.PI;
  rebuildFirstPersonWeapons(system);
  buildSkeletonLines();
  rebuildRuntimeSocketLocks();
  captureEditableTargetBaselines();
  buildOverlayMarkers();
}

function restoreEditorSnapshot(snapshot: AnimationEditorSnapshot, message?: string): void {
  const needsRigRebuild = state.modelSystem !== snapshot.modelSystem || state.modelType !== snapshot.modelType;
  clearRuntimeSocketLocks(true);
  state.weapon = snapshot.weapon;
  state.view = snapshot.view;
  state.trackId = snapshot.trackId;
  state.frameCount = snapshot.frameCount;
  state.currentFrame = clampFrameIndex(snapshot.currentFrame, snapshot.frameCount);
  state.interpolation = snapshot.interpolation;
  state.transformMode = snapshot.transformMode;
  state.selectedTarget = cloneTarget(snapshot.selectedTarget);
  state.weaponKeyframes = cloneKeyframes(snapshot.weaponKeyframes);
  state.weaponGeneratedFrames = cloneGeneratedFrames(snapshot.weaponGeneratedFrames);
  state.boneKeyframes = cloneKeyframeMap(snapshot.boneKeyframes);
  state.boneGeneratedFrames = cloneGeneratedMap(snapshot.boneGeneratedFrames);
  state.socketKeyframes = cloneKeyframeMap(snapshot.socketKeyframes);
  state.socketGeneratedFrames = cloneGeneratedMap(snapshot.socketGeneratedFrames);
  state.socketLocks = cloneSocketLocks(snapshot.socketLocks);
  state.anchorFrames = cloneAnchorFrames(snapshot.anchorFrames);
  state.modelSystem = snapshot.modelSystem;
  state.modelType = snapshot.modelType;
  state.versionedData = {
    v1: cloneVersionedData(snapshot.versionedData.v1),
    v2: cloneVersionedData(snapshot.versionedData.v2),
    v3: cloneVersionedData(snapshot.versionedData.v3),
  };
  loopRange = clampAnimationEditorLoopRange(state.frameCount, loopRange);
  clearDraft();

  if (needsRigRebuild) {
    rebuildPreviewRig(state.modelSystem);
  } else {
    rebuildRuntimeSocketLocks();
  }

  syncFormControls();
  updateCameraForView();
  syncSceneVisibility();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  if (message) setStatus(message);
}

function syncFormControls(): void {
  weaponSelect.value = state.weapon;
  viewSelect.value = state.view;
  modelSystemSelect.value = state.modelSystem;
  modelTypeSelect.value = state.modelType;
  frameCountInput.value = String(state.frameCount);
  interpolationSelect.value = state.interpolation;
  autoKeyToggle.checked = state.autoKey;
  localSpaceToggle.checked = state.localTransformSpace;
  transformControls.setSpace(state.localTransformSpace ? 'local' : 'world');
  transformControls.setMode(state.transformMode);
}

function renderHistoryControls(): void {
  const dirty = Boolean(historyState?.dirty);
  dirtyIndicator.textContent = dirty ? 'Unsaved' : 'Saved';
  dirtyIndicator.classList.toggle('dirty', dirty);
  undoButton.disabled = !historyState || historyState.past.length === 0;
  redoButton.disabled = !historyState || historyState.future.length === 0;
}

function initializeHistory(): void {
  historyState = createAnimationEditorHistory(captureEditorSnapshot());
  renderHistoryControls();
}

function commitEditorChange(): void {
  if (!historyState) return;
  historyState = commitAnimationEditorHistory(historyState, captureEditorSnapshot());
  renderHistoryControls();
}

function markEditorSaved(): void {
  if (!historyState) {
    initializeHistory();
    return;
  }
  historyState = markAnimationEditorHistorySaved(historyState);
  renderHistoryControls();
}

function undoEditorChange(): void {
  if (!historyState || historyState.past.length === 0) return;
  historyState = undoAnimationEditorHistory(historyState);
  restoreEditorSnapshot(historyState.present, 'Undo.');
  renderHistoryControls();
}

function redoEditorChange(): void {
  if (!historyState || historyState.future.length === 0) return;
  historyState = redoAnimationEditorHistory(historyState);
  restoreEditorSnapshot(historyState.present, 'Redo.');
  renderHistoryControls();
}

function loadCustomVariants(): void {
  try {
    const raw = window.localStorage.getItem(CUSTOM_CLIPS_STORAGE_KEY);
    if (!raw) {
      customVariants = [];
      return;
    }
    const parsed = JSON.parse(raw);
    customVariants = Array.isArray(parsed) ? parsed : [];
  } catch {
    customVariants = [];
  }
}

function saveCustomVariants(): void {
  window.localStorage.setItem(CUSTOM_CLIPS_STORAGE_KEY, JSON.stringify(customVariants));
}

function saveLocalDraft(): void {
  window.localStorage.setItem(SAVED_DRAFT_STORAGE_KEY, JSON.stringify(captureEditorSnapshot()));
  markEditorSaved();
  setStatus('Local draft saved.');
}

function loadLocalDraft(): boolean {
  try {
    const raw = window.localStorage.getItem(SAVED_DRAFT_STORAGE_KEY);
    if (!raw) return false;
    restoreEditorSnapshot(JSON.parse(raw) as AnimationEditorSnapshot, 'Local draft loaded.');
    initializeHistory();
    return true;
  } catch {
    window.localStorage.removeItem(SAVED_DRAFT_STORAGE_KEY);
    return false;
  }
}

function captureEditableTargetBaselines(): void {
  [
    { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
    { kind: 'weapon', name: 'sword', view: 'thirdPerson' },
    { kind: 'weapon', name: 'pistol', view: 'thirdPerson' },
    { kind: 'weapon', name: 'hammer', view: 'firstPerson' },
    { kind: 'weapon', name: 'sword', view: 'firstPerson' },
    { kind: 'weapon', name: 'pistol', view: 'firstPerson' },
    ...getAllRigTargets(),
  ].forEach((target) => {
    const typedTarget = target as SelectedRigTarget;
    const object = getTargetObject(typedTarget);
    if (object) {
      baselineTargetPoses.set(targetKey(typedTarget), poseFromObject(object));
    }
  });
}

function resetRigTargetsToBaseline(view: EditorView): void {
  getRigTargetsForView(view)
    .filter((target) => target.kind === 'bone')
    .forEach((target) => {
      const object = getTargetObject(target);
      const baseline = baselineTargetPoses.get(targetKey(target));
      if (object && baseline) applyPoseToObject(object, baseline);
    });

  getRigTargetsForView(view)
    .filter((target) => target.kind === 'socket')
    .forEach((target) => {
      const object = getTargetObject(target);
      const baseline = baselineTargetPoses.get(targetKey(target));
      if (object && baseline) applyPoseToObject(object, baseline);
    });
}

function applyRigGeneratedTracks(kind: 'bone' | 'socket', frame: number): void {
  const map = getRigGeneratedMap(kind);
  Object.entries(map).forEach(([key, frames]) => {
    const target = decodeTargetValue(key);
    if (!target || target.view !== state.view || target.kind !== kind) return;

    const pose = frames[frame]?.pose;
    const object = getTargetObject(target);
    if (pose && object) applyPoseToObject(object, pose);
  });
}

function applyFrameToScene(): void {
  resetRigTargetsToBaseline(state.view);
  applyRigGeneratedTracks('bone', state.currentFrame);
  applyRigGeneratedTracks('socket', state.currentFrame);

  const weaponFrame = state.weaponGeneratedFrames[state.currentFrame];
  if (weaponFrame) {
    const weaponTarget: SelectedRigTarget = { kind: 'weapon', name: state.weapon, view: state.view };
    applyWeaponPose(getTargetObject(weaponTarget) ?? getActiveWeaponObject(), weaponFrame.pose);
  }

  if (draftFrame === state.currentFrame && draftPose) {
    applyPoseToSelected(draftPose);
  }
}

function buildOverlayMarkers(): void {
  // Clear old markers from rigOverlayRoot
  rigOverlayMarkers.forEach((marker) => {
    rigOverlayRoot.remove(marker.group);
  });
  rigOverlayMarkers.splice(0, rigOverlayMarkers.length);

  getAllRigTargets().forEach((target) => {
    const group = new THREE.Group();
    group.name = `overlay:${target.kind}:${target.name}`;
    const isBone = target.kind === 'bone';
    const mesh = new THREE.Mesh(
      isBone ? boneMarkerGeometry : socketMarkerGeometry,
      isBone ? boneMarkerMaterial : socketMarkerMaterial
    );
    group.add(mesh);

    const label = createLabelSprite(target.name, isBone ? '#22d3ee' : '#f59e0b');
    group.add(label);
    rigOverlayRoot.add(group);
    rigOverlayMarkers.push({ target, group, label });
  });
}

function updateRigOverlays(): void {
  const selectedKey = targetKey(state.selectedTarget);
  const worldPosition = new THREE.Vector3();
  const showBones = state.view === 'thirdPerson' && state.showSkeleton;
  const showSockets = state.showSockets;

  rigOverlayMarkers.forEach((marker) => {
    const object = getTargetObject(marker.target);
    const isCurrentView = marker.target.view === state.view;
    const isBone = marker.target.kind === 'bone';
    const visible = Boolean(object) && isCurrentView && (isBone ? showBones : showSockets);
    marker.group.visible = visible;
    marker.label.visible = visible && state.showLabels;
    marker.group.scale.setScalar(targetKey(marker.target) === selectedKey ? 1.55 : 1);

    const mesh = marker.group.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh | undefined;
    if (mesh) {
      mesh.material = targetKey(marker.target) === selectedKey
        ? selectedMarkerMaterial
        : isBone
          ? boneMarkerMaterial
          : socketMarkerMaterial;
    }

    if (object) {
      object.getWorldPosition(worldPosition);
      marker.group.position.copy(worldPosition);
    }
  });

  skeletonLines.visible = showBones;
  if (!showBones) return;

  let offset = 0;
  const connections = state.modelSystem === 'v2' ? V2_SKELETON_CONNECTIONS : SKELETON_CONNECTIONS;
  connections.forEach(([startName, endName]) => {
    const startObject = state.modelSystem === 'v2'
      ? (thirdPersonRig.group.userData[startName] as THREE.Object3D)
      : thirdPersonRig.rig.bones[startName as CombatantBoneName];
    const endObject = state.modelSystem === 'v2'
      ? (thirdPersonRig.group.userData[endName] as THREE.Object3D)
      : thirdPersonRig.rig.bones[endName as CombatantBoneName];

    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    if (startObject && endObject) {
      startObject.getWorldPosition(start);
      endObject.getWorldPosition(end);
    }
    skeletonLinePositions[offset++] = start.x;
    skeletonLinePositions[offset++] = start.y;
    skeletonLinePositions[offset++] = start.z;
    skeletonLinePositions[offset++] = end.x;
    skeletonLinePositions[offset++] = end.y;
    skeletonLinePositions[offset++] = end.z;
  });
  skeletonLineGeometry.attributes.position.needsUpdate = true;
}

function sampleTrackProgressForFrame(frame: number): number {
  return state.frameCount <= 1 ? 0 : frame / (state.frameCount - 1);
}

function seedThreeFrames(commit = true): void {
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  const track = getTrack(state.trackId);
  const basePose = state.selectedTarget.kind === 'weapon'
    ? null
    : getCurrentSelectedPose();
  const keyframes = state.anchorFrames.map((frame, index) => ({
    frame,
    label: String.fromCharCode(65 + index),
    pose: state.selectedTarget.kind === 'weapon'
      ? track.sample(state.view, index / 2, state.modelSystem)
      : clonePose(basePose ?? captureSelectedPose()),
  }));
  setSelectedKeyframes(keyframes);
  state.currentFrame = state.anchorFrames[0];
  clearDraft();
  regenerateSelectedFrames(state.view === 'thirdPerson' && state.selectedTarget.kind === 'weapon'
    ? 'Seeded weapon and linked arm key poses.'
    : 'Seeded three key poses.', commit);
}

function regenerateSelectedFrames(message = 'Generated missing frames.', commit = true): void {
  const normalizedKeyframes = normalizeKeyframes(getSelectedKeyframes(), state.frameCount);
  setSelectedKeyframes(normalizedKeyframes);
  setSelectedGeneratedFrames(generatePoseFrames(normalizedKeyframes, state.frameCount, state.interpolation));
  seedLinkedThirdPersonArmTracks(normalizedKeyframes);
  state.currentFrame = clampFrameIndex(state.currentFrame, state.frameCount);
  frameSlider.max = String(state.frameCount - 1);
  frameSlider.value = String(state.currentFrame);
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(message);
  if (commit) commitEditorChange();
}

function regenerateAllFrames(): void {
  state.weaponKeyframes = normalizeKeyframes(state.weaponKeyframes, state.frameCount);
  if (state.weaponKeyframes.length > 0) {
    state.weaponGeneratedFrames = generatePoseFrames(state.weaponKeyframes, state.frameCount, state.interpolation);
    seedLinkedThirdPersonArmTracks(state.weaponKeyframes);
  }

  (['bone', 'socket'] as const).forEach((kind) => {
    const keyframeMap = getRigKeyframeMap(kind);
    const generatedMap: GeneratedRigTrackMap = {};
    Object.entries(keyframeMap).forEach(([key, keyframes]) => {
      const normalized = normalizeKeyframes(keyframes, state.frameCount);
      keyframeMap[key] = normalized;
      if (normalized.length > 0) {
        generatedMap[key] = generatePoseFrames(normalized, state.frameCount, state.interpolation);
      }
    });
    setRigGeneratedMap(kind, generatedMap);
  });
}

function setCurrentFrame(frame: number): void {
  state.currentFrame = clampFrameIndex(frame, state.frameCount);
  clearDraft();
  frameSlider.value = String(state.currentFrame);
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderTimeline();
  renderHud();
  renderSegmentInfo();
}

function setKeyframe(frame: number, pose: RigTargetPose, label?: string, commit = true): void {
  const resolvedFrame = clampFrameIndex(frame, state.frameCount);
  setSelectedKeyframes(normalizeKeyframes([
    ...getSelectedKeyframes().filter((keyframe) => keyframe.frame !== resolvedFrame),
    { frame: resolvedFrame, label, pose },
  ], state.frameCount));
  clearDraft();
  regenerateSelectedFrames(`Keyframe set at frame ${resolvedFrame}.`, commit);
}

function deleteKeyframe(frame: number, commit = true): void {
  const selectedKeyframes = getSelectedKeyframes();
  if (selectedKeyframes.length <= 1) {
    setStatus('At least one keyframe is required.');
    return;
  }
  setSelectedKeyframes(selectedKeyframes.filter((keyframe) => keyframe.frame !== frame));
  clearDraft();
  regenerateSelectedFrames(`Keyframe ${frame} removed.`, commit);
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

function refreshTargetOptions(): void {
  ensureSelectedTarget();
  const options = getTargetOptionsForView(state.view);
  targetSelect.innerHTML = '';

  const groups: Record<RigTargetKind, HTMLOptGroupElement> = {
    weapon: document.createElement('optgroup'),
    bone: document.createElement('optgroup'),
    socket: document.createElement('optgroup'),
  };
  groups.weapon.label = 'Weapons';
  groups.bone.label = 'Bones';
  groups.socket.label = 'Sockets';

  options.forEach(({ target, label }) => {
    const option = document.createElement('option');
    option.value = encodeTargetValue(target);
    option.textContent = label;
    groups[target.kind].appendChild(option);
  });

  (['weapon', 'bone', 'socket'] as const).forEach((kind) => {
    if (groups[kind].children.length > 0) {
      targetSelect.appendChild(groups[kind]);
    }
  });

  targetSelect.value = encodeTargetValue(state.selectedTarget);
  trackSelect.disabled = state.selectedTarget.kind !== 'weapon';
}

function syncSceneVisibility(): void {
  ensureSelectedTarget();
  thirdPersonRig.group.visible = state.view === 'thirdPerson';
  firstPersonRoot.visible = state.view === 'firstPerson';

  thirdPersonRig.hammer.visible = state.view === 'thirdPerson' && state.weapon === 'hammer';
  thirdPersonRig.sword.visible = state.view === 'thirdPerson' && state.weapon === 'sword';
  if (thirdPersonRig.pistol) {
    thirdPersonRig.pistol.visible = state.view === 'thirdPerson' && state.weapon === 'pistol';
  }
  if (firstPersonHammer) firstPersonHammer.visible = state.view === 'firstPerson' && state.weapon === 'hammer';
  if (firstPersonSword) firstPersonSword.visible = state.view === 'firstPerson' && state.weapon === 'sword';
  if (firstPersonPistol) firstPersonPistol.visible = state.view === 'firstPerson' && state.weapon === 'pistol';
  reticle.visible = state.view === 'firstPerson';

  transformControls.detach();
  const selectedObject = getTargetObject(state.selectedTarget);
  if (selectedObject) transformControls.attach(selectedObject);
  transformControls.setMode(state.transformMode);
  applyFrameToScene();
  updateRigOverlays();
}

function saveVersionedData(system: ModelSystemChoice): void {
  state.versionedData[system] = {
    weaponKeyframes: cloneKeyframes(state.weaponKeyframes),
    weaponGeneratedFrames: cloneGeneratedFrames(state.weaponGeneratedFrames),
    boneKeyframes: cloneKeyframeMap(state.boneKeyframes),
    boneGeneratedFrames: cloneGeneratedMap(state.boneGeneratedFrames),
    socketKeyframes: cloneKeyframeMap(state.socketKeyframes),
    socketGeneratedFrames: cloneGeneratedMap(state.socketGeneratedFrames),
    socketLocks: cloneSocketLocks(state.socketLocks),
    frameCount: state.frameCount,
    anchorFrames: cloneAnchorFrames(state.anchorFrames),
    interpolation: state.interpolation,
  };
}

function loadVersionedData(system: ModelSystemChoice): void {
  const data = state.versionedData[system];
  state.weaponKeyframes = cloneKeyframes(data.weaponKeyframes);
  state.weaponGeneratedFrames = cloneGeneratedFrames(data.weaponGeneratedFrames);
  state.boneKeyframes = cloneKeyframeMap(data.boneKeyframes);
  state.boneGeneratedFrames = cloneGeneratedMap(data.boneGeneratedFrames);
  state.socketKeyframes = cloneKeyframeMap(data.socketKeyframes);
  state.socketGeneratedFrames = cloneGeneratedMap(data.socketGeneratedFrames);
  state.socketLocks = cloneSocketLocks(data.socketLocks ?? {});
  state.frameCount = data.frameCount;
  state.anchorFrames = cloneAnchorFrames(data.anchorFrames);
  state.interpolation = data.interpolation;
}

function currentPreviewLoadout(system: ModelSystemChoice = state.modelSystem): CharacterLoadout {
  if (system === 'v3') return { modelSystem: 'v3' };
  return system === 'v2'
    ? { modelSystem: 'v2', modelType: state.modelType }
    : { modelSystem: 'v1' };
}

function buildSkeletonLines(): void {
  if (skeletonLines) {
    rigOverlayRoot.remove(skeletonLines);
    skeletonLineGeometry.dispose();
  }

  const connections = state.modelSystem === 'v2' ? V2_SKELETON_CONNECTIONS : SKELETON_CONNECTIONS;
  skeletonLineGeometry = new THREE.BufferGeometry();
  skeletonLinePositions = new Float32Array(connections.length * 2 * 3);
  skeletonLineGeometry.setAttribute('position', new THREE.BufferAttribute(skeletonLinePositions, 3));
  
  skeletonLines = new THREE.LineSegments(skeletonLineGeometry, skeletonLineMaterial);
  rigOverlayRoot.add(skeletonLines);
}

function swapModelSystem(newSystem: ModelSystemChoice): void {
  if (state.modelSystem === newSystem) return;

  // 1. Save current system data
  saveVersionedData(state.modelSystem);
  clearRuntimeSocketLocks(true);

  // 2. Remove old character rig from scene
  if (thirdPersonRig) {
    scene.remove(thirdPersonRig.group);
    // Dispose geometry/materials to prevent memory leaks
    thirdPersonRig.group.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  // 3. Set the new system in state
  state.modelSystem = newSystem;

  // 4. Create the new rig
  thirdPersonRig = createCombatantMeshRig(
    scene,
    192,
    false,
    currentPreviewLoadout(newSystem),
    newSystem === 'v3' ? EDITOR_V3_RENDER_OPTIONS : undefined
  );
  thirdPersonRig.group.position.set(0, 0, 0);
  thirdPersonRig.group.rotation.y = Math.PI;
  rebuildFirstPersonWeapons(newSystem);

  // 5. Load new system data and rebuild socket locks
  buildSkeletonLines();
  loadVersionedData(newSystem);
  rebuildRuntimeSocketLocks();
  captureEditableTargetBaselines();
  buildOverlayMarkers();

  // 6. If the loaded system has no weapon keyframes, seed it for the first time
  if (state.weaponKeyframes.length === 0) {
    seedThreeFrames();
  }

  // 7. Rebuild controls & UI
  state.selectedTarget = getDefaultTarget();
  clearDraft();
  
  // Set values to DOM elements
  modelSystemSelect.value = newSystem;
  modelTypeSelect.value = state.modelType;
  
  regenerateAllFrames();
  renderAll();
  setStatus(`Swapped to Model System ${newSystem.toUpperCase()}.`);
}

function swapModelType(newModelType: CharacterModelType): void {
  if (state.modelType === newModelType) return;
  state.modelType = newModelType;
  if (state.modelSystem !== 'v2') {
    modelTypeSelect.value = newModelType;
    return;
  }

  clearRuntimeSocketLocks(true);
  scene.remove(thirdPersonRig.group);
  thirdPersonRig.hammer.parent?.remove(thirdPersonRig.hammer);
  thirdPersonRig.sword.parent?.remove(thirdPersonRig.sword);
  thirdPersonRig.pistol?.parent?.remove(thirdPersonRig.pistol);

  thirdPersonRig = createCombatantMeshRig(scene, 192, false, currentPreviewLoadout('v2'));
  thirdPersonRig.group.position.set(0, 0, 0);
  thirdPersonRig.group.rotation.y = Math.PI;

  buildSkeletonLines();
  rebuildRuntimeSocketLocks();
  captureEditableTargetBaselines();
  buildOverlayMarkers();
  refreshTargetOptions();
  regenerateAllFrames();
  renderAll();
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
      commitEditorChange();
    });

    const goButton = document.createElement('button');
    goButton.type = 'button';
    goButton.textContent = 'Go';
    goButton.addEventListener('click', () => setCurrentFrame(state.anchorFrames[index]));

    const setButton = document.createElement('button');
    setButton.type = 'button';
    setButton.textContent = 'Set';
    setButton.addEventListener('click', () => {
      setKeyframe(state.anchorFrames[index], captureSelectedPose(), String.fromCharCode(65 + index));
    });

    row.append(label, input, goButton, setButton);
    anchorRows.appendChild(row);
  });
}

function renderKeyframes(): void {
  const normalized = normalizeKeyframes(getSelectedKeyframes(), state.frameCount);
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
      setSelectedKeyframes(getSelectedKeyframes().filter((candidate) => candidate.frame !== keyframe.frame));
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
  loopRange = clampAnimationEditorLoopRange(state.frameCount, loopRange);
  frameSlider.max = String(state.frameCount - 1);
  frameSlider.value = String(state.currentFrame);
  loopInInput.max = String(state.frameCount - 1);
  loopOutInput.max = String(state.frameCount - 1);
  loopInInput.value = String(loopRange.inFrame);
  loopOutInput.value = String(loopRange.outFrame);
  frameReadout.textContent = `Frame ${state.currentFrame} / ${state.frameCount - 1}`;
  timeline.innerHTML = '';

  getSelectedGeneratedFrames().forEach((frame) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'frame-cell';
    button.textContent = String(frame.frame);
    button.dataset.source = frame.source;
    button.dataset.current = String(frame.frame === state.currentFrame);
    button.addEventListener('click', () => setCurrentFrame(frame.frame));
    timeline.appendChild(button);
  });

  renderDopeSheet();
}

function framePercent(frame: number): string {
  const maxFrame = Math.max(1, state.frameCount - 1);
  return `${(clampFrameIndex(frame, state.frameCount) / maxFrame) * 100}%`;
}

function frameFromTrackPointer(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect();
  const pct = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  return clampFrameIndex(pct * (state.frameCount - 1), state.frameCount);
}

function dopeRows(): Array<{ key: string; target: SelectedRigTarget; label: string; keyframes: AnimationKeyframe[] }> {
  const rows = new Map<string, { key: string; target: SelectedRigTarget; label: string; keyframes: AnimationKeyframe[] }>();
  const addRow = (target: SelectedRigTarget): void => {
    const key = targetKey(target);
    if (rows.has(key)) return;
    rows.set(key, {
      key,
      target,
      label: target.kind === 'weapon' ? `weapon.${target.name}` : `${target.kind}.${target.name}`,
      keyframes: normalizeKeyframes(getKeyframesForTarget(target), state.frameCount),
    });
  };

  addRow({ kind: 'weapon', name: state.weapon, view: state.view });
  addRow(state.selectedTarget);

  (['bone', 'socket'] as const).forEach((kind) => {
    Object.entries(getRigKeyframeMap(kind)).forEach(([key, keyframes]) => {
      const target = decodeTargetValue(key);
      if (!target || target.view !== state.view || keyframes.length === 0) return;
      addRow(target);
    });
  });

  return [...rows.values()].filter((row) => row.keyframes.length > 0 || row.target.kind === 'weapon');
}

function renderDopeSheet(): void {
  dopeSheet.innerHTML = '';
  dopeRows().forEach((row) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'dope-row';

    const label = document.createElement('div');
    label.className = 'dope-label';
    label.textContent = row.label;

    const track = document.createElement('div');
    track.className = 'dope-track';
    track.style.setProperty('--loop-in', framePercent(loopRange.inFrame));
    track.style.setProperty('--loop-out', framePercent(loopRange.outFrame));
    track.addEventListener('click', (event) => {
      setCurrentFrame(frameFromTrackPointer(track, event.clientX));
    });

    row.keyframes.forEach((keyframe) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dope-key';
      button.title = `${row.label} frame ${keyframe.frame}`;
      button.style.left = framePercent(keyframe.frame);
      button.dataset.current = String(keyframe.frame === state.currentFrame);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setCurrentFrame(keyframe.frame);
      });
      button.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        button.setPointerCapture(event.pointerId);
        draggingDopeKey = { targetKeyValue: row.key, frame: keyframe.frame, pointerId: event.pointerId, track };
      });
      track.appendChild(button);
    });

    wrapper.append(label, track);
    dopeSheet.appendChild(wrapper);
  });
}

function regenerateFramesForTarget(target: SelectedRigTarget, message: string, commit = true): void {
  const normalized = normalizeKeyframes(getKeyframesForTarget(target), state.frameCount);
  setKeyframesForTarget(target, normalized);
  if (normalized.length > 0) {
    setGeneratedFramesForTarget(target, generatePoseFrames(normalized, state.frameCount, state.interpolation));
    if (target.kind === 'weapon' && state.view === 'thirdPerson') {
      seedLinkedThirdPersonArmTracks(normalized);
    }
  }
  clearDraft();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(message);
  if (commit) commitEditorChange();
}

function renderValidation(): void {
  const report = buildAnimationEditorValidationReport(buildExportPayload());
  validationStatus.textContent = report.ok ? 'ok' : `${report.items.length} issue${report.items.length === 1 ? '' : 's'}`;
  validationReport.innerHTML = '';
  if (report.items.length === 0) {
    const item = document.createElement('div');
    item.className = 'validation-item info';
    item.innerHTML = '<strong>OK</strong><span>No validation issues.</span>';
    validationReport.appendChild(item);
    return;
  }

  report.items.forEach((issue: AnimationEditorValidationItem) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `validation-item ${issue.severity}`;
    const heading = [issue.severity, issue.code, issue.frame === undefined ? '' : `frame ${issue.frame}`]
      .filter(Boolean)
      .join(' | ');
    button.innerHTML = `<strong>${heading}</strong><span>${issue.message}</span>`;
    button.addEventListener('click', () => {
      if (issue.frame !== undefined) setCurrentFrame(issue.frame);
      if (issue.target === 'weapon') {
        state.selectedTarget = { kind: 'weapon', name: state.weapon, view: state.view };
      } else if (issue.target?.startsWith('bones.')) {
        state.selectedTarget = { kind: 'bone', name: issue.target.slice('bones.'.length), view: state.view };
      } else if (issue.target?.startsWith('sockets.')) {
        state.selectedTarget = { kind: 'socket', name: issue.target.slice('sockets.'.length), view: state.view };
      }
      renderAll();
    });
    validationReport.appendChild(button);
  });
}

function buildRigTrackExport(kind: 'bone' | 'socket'): Record<string, AnimationEditorRigTrack> {
  const keyframeMap = getRigKeyframeMap(kind);
  const generatedMap = getRigGeneratedMap(kind);
  const exportTracks: Record<string, AnimationEditorRigTrack> = {};

  Object.entries(keyframeMap).forEach(([key, keyframes]) => {
    const target = decodeTargetValue(key);
    if (!target || target.view !== state.view || target.kind !== kind) return;

    const frames = generatedMap[key] ?? [];
    if (keyframes.length === 0 && frames.length === 0) return;

    exportTracks[target.name] = {
      keyframes: normalizeKeyframes(keyframes, state.frameCount),
      frames,
    };
  });

  return exportTracks;
}

function buildSocketLockExport(): AnimationEditorSocketLock[] {
  return Object.entries(state.socketLocks)
    .map(([targetKeyValue, socketKeyValue]) => {
      const target = decodeTargetValue(targetKeyValue);
      const socket = decodeTargetValue(socketKeyValue);
      if (!target || !socket || socket.kind !== 'socket' || target.view !== state.view) return null;
      return { target, socket };
    })
    .filter((lock): lock is AnimationEditorSocketLock => Boolean(lock));
}

function buildExportPayload(): AnimationEditorExportPayload {
  return buildAnimationEditorExportPayload({
    weapon: state.weapon,
    view: state.view,
    track: state.trackId,
    frameCount: state.frameCount,
    interpolation: state.interpolation,
    keyframes: state.weaponKeyframes,
    frames: state.weaponGeneratedFrames,
    proceduralProfile: state.modelSystem === 'v3'
      ? {
          modelSystem: 'v3',
          profileVersion: V3_ANIMATION_PROFILE_VERSION,
          source: 'v3AnimationFidelity',
        }
      : undefined,
    rig: {
      bones: buildRigTrackExport('bone'),
      sockets: buildRigTrackExport('socket'),
      socketLocks: buildSocketLockExport(),
    },
  });
}

function buildSnippet(): string {
  const constName = `${state.trackId}_${state.view}_frames`;
  return buildPoseArraySnippet(constName, state.weaponGeneratedFrames, 4);
}

function isWeaponChoice(value: string): value is WeaponChoice {
  return value === 'hammer' || value === 'sword' || value === 'pistol';
}

function safeTrackForWeapon(trackId: string, weapon: WeaponChoice): string {
  return TRACKS.some((track) => track.id === trackId && track.weapon === weapon)
    ? trackId
    : TRACKS.find((track) => track.weapon === weapon)?.id ?? TRACKS[0].id;
}

function encodeRigTrackMap(
  kind: 'bone' | 'socket',
  view: EditorView,
  tracks: Record<string, AnimationEditorRigTrack>
): { keyframes: RigTrackMap; frames: GeneratedRigTrackMap } {
  const keyframes: RigTrackMap = {};
  const frames: GeneratedRigTrackMap = {};
  Object.entries(tracks).forEach(([name, track]) => {
    const key = targetKey({ kind, name, view });
    keyframes[key] = cloneKeyframes(track.keyframes);
    frames[key] = cloneGeneratedFrames(track.frames);
  });
  return { keyframes, frames };
}

function applyExportPayload(payload: AnimationEditorExportPayload, options: { dirty: boolean; message: string }): void {
  const nextWeapon = isWeaponChoice(payload.weapon) ? payload.weapon : state.weapon;
  const nextSystem: ModelSystemChoice = payload.proceduralProfile?.modelSystem === 'v3'
    ? 'v3'
    : state.modelSystem;
  const needsRigRebuild = state.modelSystem !== nextSystem;
  clearRuntimeSocketLocks(true);

  state.weapon = nextWeapon;
  state.view = payload.view;
  state.trackId = safeTrackForWeapon(payload.track, nextWeapon);
  state.frameCount = Math.max(1, Math.floor(payload.frameCount));
  state.currentFrame = 0;
  state.interpolation = payload.interpolation;
  state.selectedTarget = { kind: 'weapon', name: nextWeapon, view: payload.view };
  state.modelSystem = nextSystem;
  state.weaponKeyframes = cloneKeyframes(payload.keyframes);
  state.weaponGeneratedFrames = cloneGeneratedFrames(payload.frames);

  const boneTracks = encodeRigTrackMap('bone', payload.view, payload.rig.bones);
  const socketTracks = encodeRigTrackMap('socket', payload.view, payload.rig.sockets);
  state.boneKeyframes = boneTracks.keyframes;
  state.boneGeneratedFrames = boneTracks.frames;
  state.socketKeyframes = socketTracks.keyframes;
  state.socketGeneratedFrames = socketTracks.frames;
  state.socketLocks = Object.fromEntries(payload.rig.socketLocks.map((lock) => [
    targetKey(lock.target),
    targetKey(lock.socket),
  ]));
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  loopRange = clampAnimationEditorLoopRange(state.frameCount, { inFrame: 0, outFrame: state.frameCount - 1 });
  saveVersionedData(state.modelSystem);
  clearDraft();

  if (needsRigRebuild) {
    rebuildPreviewRig(state.modelSystem);
  } else {
    rebuildRuntimeSocketLocks();
  }

  syncFormControls();
  updateCameraForView();
  syncSceneVisibility();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(options.message);
  if (options.dirty) {
    commitEditorChange();
  } else {
    markEditorSaved();
  }
}

function importJsonText(text: string): void {
  try {
    const imported = parseAnimationEditorImportText(text);
    applyExportPayload(imported.payload, {
      dirty: true,
      message: `Imported ${imported.payload.track}.`,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to import JSON.');
  }
}

function createVariantStorageId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function addCustomVariant(record: AnimationEditorLocalVariantRecord): void {
  customVariants = [
    ...customVariants.filter((candidate) => candidate.storageId !== record.storageId),
    record,
  ].slice(-40);
  saveCustomVariants();
}

function duplicateCurrentClip(): void {
  const record = createAnimationEditorDuplicateVariant(buildExportPayload(), {
    storageId: createVariantStorageId('duplicate'),
  });
  addCustomVariant(record);
  setStatus(`Saved local duplicate ${record.label}.`);
}

function newClipFromCurrentFrame(): void {
  try {
    const record = createAnimationEditorVariantFromCurrentFrame(buildExportPayload(), {
      storageId: createVariantStorageId('current'),
      frame: state.currentFrame,
    });
    addCustomVariant(record);
    applyExportPayload(record.payload, {
      dirty: false,
      message: `Created local current-pose clip ${record.label}.`,
    });
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to create current-pose clip.');
  }
}

const POSE_PRESETS: Record<PosePresetId, { trackId: V3AnimationTrackId; progress: number }> = {
  guard: { trackId: 'sword_lunge', progress: 0 },
  windup: { trackId: 'hammer_windup', progress: 1 },
  strike: { trackId: 'hammer_strike', progress: 0.58 },
  recoil: { trackId: 'hammer_recover', progress: 0 },
  reload: { trackId: 'pistol_recover', progress: 0.35 },
  idleHands: { trackId: 'hammer_windup', progress: 0 },
};

function applyPosePreset(): void {
  const preset = POSE_PRESETS[posePresetSelect.value as PosePresetId] ?? POSE_PRESETS.guard;
  const pose = sampleEditorTrackPose(preset.trackId, state.view, preset.progress, state.modelSystem);
  setKeyframe(state.currentFrame, pose, posePresetSelect.value);
}

function mirrorCurrentFrame(): void {
  const sourceTarget = cloneTarget(state.selectedTarget);
  const destinationTarget = mirrorAnimationEditorTarget(sourceTarget);
  const target = isTargetAvailable(destinationTarget) ? destinationTarget : sourceTarget;
  const mirroredPose = mirrorAnimationEditorPose(getCurrentSelectedPose());
  const resolvedFrame = clampFrameIndex(state.currentFrame, state.frameCount);
  setKeyframesForTarget(target, normalizeKeyframes([
    ...getKeyframesForTarget(target).filter((keyframe) => keyframe.frame !== resolvedFrame),
    { frame: resolvedFrame, label: 'Mirror', pose: mirroredPose },
  ], state.frameCount));
  state.selectedTarget = target;
  regenerateFramesForTarget(target, `Mirrored ${targetLabel(sourceTarget)} to ${targetLabel(target)}.`);
}

function renderExport(): void {
  metricFrames.textContent = String(state.frameCount);
  metricMode.textContent = state.interpolation === 'smoothstep' ? 'smooth' : state.interpolation;
  exportStatus.textContent = `${state.view === 'firstPerson' ? 'first-person' : 'third-person'} rig`;
  exportText.value = `${JSON.stringify(buildExportPayload(), null, 2)}\n\n${buildSnippet()}`;
}

function renderHud(): void {
  const pose = getCurrentSelectedPose();
  const source = getSelectedGeneratedFrames()[state.currentFrame]?.source ?? 'generated';
  hudTitle.textContent = `${targetLabel(state.selectedTarget)} / ${state.view === 'firstPerson' ? 'First person' : 'Third person'}`;
  hudFrame.textContent = `Frame ${state.currentFrame} (${source})`;
  hudPose.textContent = formatPoseShort(pose);
  trackStatus.textContent = state.selectedTarget.kind === 'weapon'
    ? getTrack(state.trackId).label
    : targetLabel(state.selectedTarget);
}

function renderSegmentInfo(): void {
  const normalized = normalizeKeyframes(getSelectedKeyframes(), state.frameCount);
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
  transformStatus.textContent = `${state.transformMode} | ${state.localTransformSpace ? 'local' : 'world'}`;
}

function renderSocketLockControls(): void {
  const sockets = getSocketTargetsForView(state.view);
  const selectedKey = targetKey(state.selectedTarget);
  const activeSocketKey = state.socketLocks[selectedKey];
  const canLock = canTargetLockToSocket(state.selectedTarget);

  socketLockSelect.innerHTML = '';
  sockets.forEach((socket) => {
    const option = document.createElement('option');
    option.value = targetKey(socket);
    option.textContent = targetLabel(socket);
    socketLockSelect.appendChild(option);
  });

  const fallbackSocketKey = sockets[0] ? targetKey(sockets[0]) : '';
  socketLockSelect.value = activeSocketKey ?? fallbackSocketKey;
  socketLockSelect.disabled = !canLock || sockets.length === 0;
  lockSocketButton.disabled = !canLock || sockets.length === 0;
  repositionSocketButton.disabled = !canLock || sockets.length === 0;
  unlockSocketButton.disabled = !activeSocketKey;

  if (!canLock) {
    socketLockStatus.textContent = 'Socket locks are available for weapon targets.';
    return;
  }

  if (!activeSocketKey) {
    socketLockStatus.textContent = 'No socket lock.';
    return;
  }

  const socket = decodeTargetValue(activeSocketKey);
  socketLockStatus.textContent = socket
    ? `Locked to ${targetLabel(socket)}.`
    : 'Socket lock target is unavailable.';
}

function renderAll(): void {
  syncFormControls();
  modelTypeSelect.disabled = state.modelSystem !== 'v2';
  showSkeletonToggle.checked = state.showSkeleton;
  showSocketsToggle.checked = state.showSockets;
  showLabelsToggle.checked = state.showLabels;
  refreshTrackOptions();
  refreshTargetOptions();
  syncSceneVisibility();
  renderTransformButtons();
  renderSocketLockControls();
  renderAnchorRows();
  renderKeyframes();
  renderTimeline();
  renderExport();
  renderHud();
  renderSegmentInfo();
  renderValidation();
  renderHistoryControls();
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
  const pose = readPoseInputs(captureSelectedPose());
  setDraftPose(pose);
  applyPoseToSelected(pose);
  updateRigOverlays();
  if (state.autoKey) {
    setKeyframe(state.currentFrame, pose);
    return;
  }
  renderHud();
  renderSegmentInfo();
  setStatus(`Draft pose edited at frame ${state.currentFrame}.`);
}

Object.values(poseInputs).forEach((input) => {
  input.addEventListener('input', handlePoseInputChange);
});

undoButton.addEventListener('click', undoEditorChange);
redoButton.addEventListener('click', redoEditorChange);
exportDrawerButton.addEventListener('click', () => {
  const open = workspace.dataset.exportOpen !== 'true';
  workspace.dataset.exportOpen = String(open);
  exportDrawerButton.dataset.active = String(open);
});
openAtlasButton.addEventListener('click', () => {
  const atlasWindow = window.open('/v3-animation-atlas-smoke.html', '_blank', 'noopener');
  setStatus(atlasWindow ? 'Atlas opened.' : 'Open /v3-animation-atlas-smoke.html');
});
duplicateClipButton.addEventListener('click', duplicateCurrentClip);
newFromCurrentButton.addEventListener('click', newClipFromCurrentFrame);
saveLocalButton.addEventListener('click', saveLocalDraft);
clearLocalButton.addEventListener('click', () => {
  window.localStorage.removeItem(SAVED_DRAFT_STORAGE_KEY);
  customVariants = [];
  saveCustomVariants();
  setStatus('Local animation editor drafts cleared.');
});
autoKeyToggle.addEventListener('change', () => {
  state.autoKey = autoKeyToggle.checked;
  setStatus(state.autoKey ? 'Auto Key enabled.' : 'Auto Key disabled.');
  renderHistoryControls();
});
localSpaceToggle.addEventListener('change', () => {
  state.localTransformSpace = localSpaceToggle.checked;
  transformControls.setSpace(state.localTransformSpace ? 'local' : 'world');
  renderTransformButtons();
});
applyPosePresetButton.addEventListener('click', applyPosePreset);

weaponSelect.addEventListener('change', () => {
  state.weapon = weaponSelect.value as WeaponChoice;
  if (state.selectedTarget.kind === 'weapon') {
    state.selectedTarget.name = state.weapon;
  }
  const compatibleTrack = TRACKS.find((track) => track.weapon === state.weapon);
  state.trackId = compatibleTrack?.id ?? state.trackId;
  refreshTrackOptions();
  refreshTargetOptions();
  seedThreeFrames();
  updateCameraForView();
});

modelSystemSelect.addEventListener('change', () => {
  swapModelSystem(modelSystemSelect.value as ModelSystemChoice);
  commitEditorChange();
});

modelTypeSelect.addEventListener('change', () => {
  swapModelType(modelTypeSelect.value as CharacterModelType);
  commitEditorChange();
});

viewSelect.addEventListener('change', () => {
  state.view = viewSelect.value as EditorView;
  state.selectedTarget = getDefaultTarget();
  seedThreeFrames();
  updateCameraForView();
});

trackSelect.addEventListener('change', () => {
  state.trackId = trackSelect.value;
  state.selectedTarget = getDefaultTarget();
  seedThreeFrames();
});

targetSelect.addEventListener('change', () => {
  const nextTarget = decodeTargetValue(targetSelect.value);
  if (!nextTarget) return;
  state.selectedTarget = nextTarget;
  clearDraft();

  let createdTrack = false;
  if (getSelectedKeyframes().length === 0) {
    setSelectedKeyframes([{
      frame: state.currentFrame,
      label: 'A',
      pose: getCurrentSelectedPose(),
    }]);
    setSelectedGeneratedFrames(generatePoseFrames(getSelectedKeyframes(), state.frameCount, state.interpolation));
    createdTrack = true;
  }

  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(`Selected ${targetLabel(state.selectedTarget)}.`);
  if (createdTrack) commitEditorChange();
});

frameCountInput.addEventListener('change', () => {
  const nextFrameCount = Math.min(96, Math.max(3, Math.round(Number(frameCountInput.value) || state.frameCount)));
  state.frameCount = nextFrameCount;
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  state.currentFrame = clampFrameIndex(state.currentFrame, state.frameCount);
  regenerateAllFrames();
  clearDraft();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus('Frame count updated.');
  commitEditorChange();
});

interpolationSelect.addEventListener('change', () => {
  state.interpolation = interpolationSelect.value as AnimationInterpolationMode;
  clearDraft();
  regenerateAllFrames();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus('Interpolation mode updated.');
  commitEditorChange();
});

seedButton.addEventListener('click', () => seedThreeFrames());
generateButton.addEventListener('click', () => regenerateSelectedFrames());
setKeyframeButton.addEventListener('click', () => {
  setKeyframe(
    state.currentFrame,
    resolveSetKeyframePose({
      currentFrame: state.currentFrame,
      capturedPose: captureSelectedPose(),
      draftFrame,
      draftPose,
    })
  );
});

lockSocketButton.addEventListener('click', () => {
  const socketTarget = decodeTargetValue(socketLockSelect.value);
  if (!socketTarget || socketTarget.kind !== 'socket') {
    setStatus('Choose a valid socket before locking.');
    return;
  }

  const runtime = createSocketLockRuntime(state.selectedTarget, socketTarget, true);
  if (!runtime) {
    setStatus('Only weapon targets can lock to sockets in this editor pass.');
    renderSocketLockControls();
    return;
  }

  transformControls.detach();
  transformControls.attach(runtime.pivot);
  renderSocketLockControls();
  commitEditorChange();
});

repositionSocketButton.addEventListener('click', () => {
  const socketTarget = decodeTargetValue(socketLockSelect.value);
  if (!socketTarget || socketTarget.kind !== 'socket') {
    setStatus('Choose a valid socket before repositioning.');
    return;
  }

  const runtime = repositionTargetToSocket(state.selectedTarget, socketTarget);
  if (!runtime) {
    setStatus('Only weapon targets can reposition to sockets in this editor pass.');
    renderSocketLockControls();
    return;
  }

  transformControls.detach();
  transformControls.attach(runtime.pivot);
  renderSocketLockControls();
  commitEditorChange();
});

unlockSocketButton.addEventListener('click', () => {
  unlockSocketLockForTarget(state.selectedTarget, true);
  const selectedObject = getTargetObject(state.selectedTarget);
  transformControls.detach();
  if (selectedObject) transformControls.attach(selectedObject);
  renderSocketLockControls();
  commitEditorChange();
});

translateButton.addEventListener('click', () => {
  state.transformMode = 'translate';
  transformControls.setMode('translate');
  transformControls.setSpace(state.localTransformSpace ? 'local' : 'world');
  renderTransformButtons();
});

rotateButton.addEventListener('click', () => {
  state.transformMode = 'rotate';
  transformControls.setMode('rotate');
  transformControls.setSpace(state.localTransformSpace ? 'local' : 'world');
  renderTransformButtons();
});

showSkeletonToggle.addEventListener('change', () => {
  state.showSkeleton = showSkeletonToggle.checked;
  updateRigOverlays();
});

showSocketsToggle.addEventListener('change', () => {
  state.showSockets = showSocketsToggle.checked;
  updateRigOverlays();
});

showLabelsToggle.addEventListener('change', () => {
  state.showLabels = showLabelsToggle.checked;
  updateRigOverlays();
});

frameSlider.addEventListener('input', () => {
  setCurrentFrame(Number(frameSlider.value));
});

loopInInput.addEventListener('change', () => {
  loopRange = clampAnimationEditorLoopRange(state.frameCount, {
    inFrame: Number(loopInInput.value),
    outFrame: loopRange.outFrame,
  });
  renderTimeline();
});

loopOutInput.addEventListener('change', () => {
  loopRange = clampAnimationEditorLoopRange(state.frameCount, {
    inFrame: loopRange.inFrame,
    outFrame: Number(loopOutInput.value),
  });
  renderTimeline();
});

playButton.addEventListener('click', () => {
  state.playing = !state.playing;
  if (state.playing && (state.currentFrame < loopRange.inFrame || state.currentFrame > loopRange.outFrame)) {
    setCurrentFrame(loopRange.inFrame);
  }
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

importJsonButton.addEventListener('click', () => importJsonText(importText.value || exportText.value));
chooseJsonButton.addEventListener('click', () => importFileInput.click());
importFileInput.addEventListener('change', async () => {
  const file = importFileInput.files?.[0];
  importFileInput.value = '';
  if (!file) return;
  try {
    importJsonText(await file.text());
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Unable to read JSON file.');
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
    setStatus(error instanceof Error ? error.message : 'Unable to read dropped JSON.');
  }
});

transformControls.addEventListener('dragging-changed', (event) => {
  controls.enabled = !Boolean(event.value);
});

transformControls.addEventListener('objectChange', () => {
  const pose = captureSelectedPose();
  setDraftPose(pose);
  syncPoseInputs(pose);
  updateRigOverlays();
  if (state.autoKey) {
    setKeyframe(state.currentFrame, pose);
    return;
  }
  renderHud();
  renderSegmentInfo();
});

window.addEventListener('pointerup', (event) => {
  if (!draggingDopeKey || draggingDopeKey.pointerId !== event.pointerId) return;
  const target = decodeTargetValue(draggingDopeKey.targetKeyValue);
  if (!target) {
    draggingDopeKey = null;
    return;
  }
  const toFrame = frameFromTrackPointer(draggingDopeKey.track, event.clientX);
  const retimed = retimeAnimationEditorKeyframe(getKeyframesForTarget(target), {
    fromFrame: draggingDopeKey.frame,
    toFrame,
    frameCount: state.frameCount,
  });
  draggingDopeKey = null;
  setKeyframesForTarget(target, retimed);
  state.selectedTarget = target;
  state.currentFrame = toFrame;
  regenerateFramesForTarget(target, `Retimed ${targetLabel(target)} key to frame ${toFrame}.`);
});

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || element.isContentEditable;
}

function stepFrame(delta: number): void {
  state.playing = false;
  playButton.textContent = 'Play';
  setCurrentFrame(clampFrameIndex(state.currentFrame + delta, state.frameCount));
}

window.addEventListener('keydown', (event) => {
  if (isTypingTarget(event.target)) return;
  if (event.code === 'Space') {
    event.preventDefault();
    playButton.click();
    return;
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    stepFrame((event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 10 : 1));
    return;
  }
  if (event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    setKeyframe(
      state.currentFrame,
      resolveSetKeyframePose({
        currentFrame: state.currentFrame,
        capturedPose: captureSelectedPose(),
        draftFrame,
        draftPose,
      })
    );
    return;
  }
  if (event.key === 'Delete') {
    event.preventDefault();
    deleteKeyframe(state.currentFrame);
    return;
  }
  if (event.key.toLowerCase() === 'm' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    mirrorCurrentFrame();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) {
      redoEditorChange();
    } else {
      undoEditorChange();
    }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoEditorChange();
  }
});

window.addEventListener('resize', resizeRenderer);

function animate(): void {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastAnimationTime) / 1000;
  lastAnimationTime = now;
  if (state.playing && getSelectedGeneratedFrames().length > 0) {
    playbackAccumulator += dt;
    if (playbackAccumulator >= playbackFrameDuration) {
      playbackAccumulator = 0;
      setCurrentFrame(nextAnimationEditorLoopFrame(state.currentFrame, 1, state.frameCount, loopRange));
    }
  }

  controls.update();
  updateRigOverlays();
  renderer.render(scene, camera);
}

refreshTrackOptions();
buildSkeletonLines();
captureEditableTargetBaselines();
buildOverlayMarkers();
loadCustomVariants();
seedThreeFrames(false);
if (!loadLocalDraft()) {
  initializeHistory();
}
syncSceneVisibility();
updateCameraForView();
resizeRenderer();
animate();
