import * as THREE from 'three';
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
  COMBATANT_BONE_NAMES,
  attachToAttachmentPoint,
  createFirstPersonWeaponRig,
  type CombatantAttachmentPointName,
  type CombatantBoneName,
} from '../components/grifball/combatantRig';
import { createCombatantMeshRig, type CombatantMeshRig } from '../components/grifball/combatantModels';
import { buildGravityHammerModel, buildKatarSwordModel } from '../components/VoxelModels';
import {
  buildAnimationEditorExportPayload,
  buildPoseArraySnippet,
  clampFrameIndex,
  clonePose,
  generatePoseFrames,
  normalizeKeyframes,
  roundPose,
  type AnimationInterpolationMode,
  type AnimationEditorRigTrack,
  type AnimationKeyframe,
  type GeneratedAnimationFrame,
  type RigTargetKind,
  type RigTargetPose,
  type SelectedRigTarget,
} from './animationEditorCore';

type WeaponChoice = 'hammer' | 'sword';
type EditorView = 'firstPerson' | 'thirdPerson';
type TransformMode = 'translate' | 'rotate';
type RigTrackMap = Record<string, AnimationKeyframe[]>;
type GeneratedRigTrackMap = Record<string, GeneratedAnimationFrame[]>;

interface TargetOption {
  target: SelectedRigTarget;
  label: string;
}

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
  selectedTarget: SelectedRigTarget;
  weaponKeyframes: AnimationKeyframe[];
  weaponGeneratedFrames: GeneratedAnimationFrame[];
  boneKeyframes: RigTrackMap;
  boneGeneratedFrames: GeneratedRigTrackMap;
  socketKeyframes: RigTrackMap;
  socketGeneratedFrames: GeneratedRigTrackMap;
  anchorFrames: [number, number, number];
  playing: boolean;
  showSkeleton: boolean;
  showSockets: boolean;
  showLabels: boolean;
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

const PREVIEW_ATTACK_SETTINGS = {
  hammerReloadTime: 0.6,
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
      weaponTimer: 0.28 * pct,
      isLunging: false,
      settings: PREVIEW_ATTACK_SETTINGS,
    });
  }

  if (trackId === 'hammer_strike') {
    return getThirdPersonCombatantArmPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_down',
      weaponTimer: 0.12 * pct,
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
const weaponSelect = requireElement<HTMLSelectElement>('weaponSelect');
const viewSelect = requireElement<HTMLSelectElement>('viewSelect');
const trackSelect = requireElement<HTMLSelectElement>('trackSelect');
const targetSelect = requireElement<HTMLSelectElement>('targetSelect');
const frameCountInput = requireElement<HTMLInputElement>('frameCountInput');
const interpolationSelect = requireElement<HTMLSelectElement>('interpolationSelect');
const seedButton = requireElement<HTMLButtonElement>('seedButton');
const generateButton = requireElement<HTMLButtonElement>('generateButton');
const translateButton = requireElement<HTMLButtonElement>('translateButton');
const rotateButton = requireElement<HTMLButtonElement>('rotateButton');
const setKeyframeButton = requireElement<HTMLButtonElement>('setKeyframeButton');
const showSkeletonToggle = requireElement<HTMLInputElement>('showSkeletonToggle');
const showSocketsToggle = requireElement<HTMLInputElement>('showSocketsToggle');
const showLabelsToggle = requireElement<HTMLInputElement>('showLabelsToggle');
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
const skeletonLineGeometry = new THREE.BufferGeometry();
const skeletonLinePositions = new Float32Array(SKELETON_CONNECTIONS.length * 2 * 3);
skeletonLineGeometry.setAttribute('position', new THREE.BufferAttribute(skeletonLinePositions, 3));
const skeletonLineMaterial = new THREE.LineBasicMaterial({
  color: 0x38bdf8,
  transparent: true,
  opacity: 0.58,
  depthTest: false,
});
const skeletonLines = new THREE.LineSegments(skeletonLineGeometry, skeletonLineMaterial);
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
  anchorFrames: makeAnchorFrames(31),
  playing: false,
  showSkeleton: true,
  showSockets: true,
  showLabels: true,
};

let draftFrame: number | null = null;
let draftPose: WeaponPose | null = null;
let playbackAccumulator = 0;
const playbackFrameDuration = 1 / 18;
let lastAnimationTime = performance.now();
const baselineTargetPoses = new Map<string, RigTargetPose>();

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

function seedLinkedThirdPersonArmTracks(weaponKeyframes: AnimationKeyframe[]): void {
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
    nextKeyframes[key] = normalizeKeyframes(armKeyframes[boneName], state.frameCount);
    nextGenerated[key] = generatePoseFrames(nextKeyframes[key], state.frameCount, state.interpolation);
  });

  state.boneKeyframes = nextKeyframes;
  state.boneGeneratedFrames = nextGenerated;
}

function getWeaponObject(view: EditorView, weapon: WeaponChoice): THREE.Group {
  if (view === 'firstPerson') {
    return weapon === 'hammer' ? firstPersonHammer : firstPersonSword;
  }
  return weapon === 'hammer' ? thirdPersonRig.hammer : thirdPersonRig.sword;
}

function getActiveWeaponObject(): THREE.Group {
  return getWeaponObject(state.view, state.weapon);
}

function getTargetObject(target: SelectedRigTarget): THREE.Group | null {
  if (target.kind === 'weapon') {
    return getWeaponObject(target.view, target.name as WeaponChoice);
  }

  if (target.kind === 'bone') {
    return target.view === 'thirdPerson'
      ? thirdPersonRig.rig.bones[target.name as CombatantBoneName] ?? null
      : null;
  }

  if (target.view === 'firstPerson') {
    const attachment = firstPersonRig.attachments[
      target.name as keyof typeof firstPersonRig.attachments
    ];
    return attachment?.group ?? null;
  }

  return thirdPersonRig.rig.attachments[target.name as CombatantAttachmentPointName]?.group ?? null;
}

function getTargetOptionsForView(view: EditorView): TargetOption[] {
  const options: TargetOption[] = [
    {
      target: { kind: 'weapon', name: state.weapon, view },
      label: targetLabel({ kind: 'weapon', name: state.weapon, view }),
    },
  ];

  if (view === 'thirdPerson') {
    COMBATANT_BONE_NAMES.forEach((name) => {
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
  if (state.selectedTarget.kind === 'weapon') {
    state.weaponKeyframes = keyframes;
    return;
  }

  const map = {
    ...getRigKeyframeMap(state.selectedTarget.kind),
    [targetKey(state.selectedTarget)]: keyframes,
  };
  setRigKeyframeMap(state.selectedTarget.kind, map);
}

function getSelectedGeneratedFrames(): GeneratedAnimationFrame[] {
  if (state.selectedTarget.kind === 'weapon') return state.weaponGeneratedFrames;
  return getRigGeneratedMap(state.selectedTarget.kind)[targetKey(state.selectedTarget)] ?? [];
}

function setSelectedGeneratedFrames(frames: GeneratedAnimationFrame[]): void {
  if (state.selectedTarget.kind === 'weapon') {
    state.weaponGeneratedFrames = frames;
    return;
  }

  const map = {
    ...getRigGeneratedMap(state.selectedTarget.kind),
    [targetKey(state.selectedTarget)]: frames,
  };
  setRigGeneratedMap(state.selectedTarget.kind, map);
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

function captureEditableTargetBaselines(): void {
  [
    { kind: 'weapon', name: 'hammer', view: 'thirdPerson' },
    { kind: 'weapon', name: 'sword', view: 'thirdPerson' },
    { kind: 'weapon', name: 'hammer', view: 'firstPerson' },
    { kind: 'weapon', name: 'sword', view: 'firstPerson' },
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
  if (weaponFrame) applyWeaponPose(getActiveWeaponObject(), weaponFrame.pose);

  if (draftFrame === state.currentFrame && draftPose) {
    applyPoseToSelected(draftPose);
  }
}

function buildOverlayMarkers(): void {
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
  SKELETON_CONNECTIONS.forEach(([startName, endName]) => {
    const startObject = thirdPersonRig.rig.bones[startName];
    const endObject = thirdPersonRig.rig.bones[endName];
    const start = new THREE.Vector3();
    const end = new THREE.Vector3();
    startObject.getWorldPosition(start);
    endObject.getWorldPosition(end);
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

function seedThreeFrames(): void {
  state.anchorFrames = makeAnchorFrames(state.frameCount);
  const track = getTrack(state.trackId);
  const basePose = state.selectedTarget.kind === 'weapon'
    ? null
    : getCurrentSelectedPose();
  const keyframes = state.anchorFrames.map((frame, index) => ({
    frame,
    label: String.fromCharCode(65 + index),
    pose: state.selectedTarget.kind === 'weapon'
      ? track.sample(state.view, index / 2)
      : clonePose(basePose ?? captureSelectedPose()),
  }));
  setSelectedKeyframes(keyframes);
  state.currentFrame = state.anchorFrames[0];
  clearDraft();
  regenerateSelectedFrames(state.view === 'thirdPerson' && state.selectedTarget.kind === 'weapon'
    ? 'Seeded weapon and linked arm key poses.'
    : 'Seeded three key poses.');
}

function regenerateSelectedFrames(message = 'Generated missing frames.'): void {
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

function setKeyframe(frame: number, pose: RigTargetPose, label?: string): void {
  const resolvedFrame = clampFrameIndex(frame, state.frameCount);
  setSelectedKeyframes(normalizeKeyframes([
    ...getSelectedKeyframes().filter((keyframe) => keyframe.frame !== resolvedFrame),
    { frame: resolvedFrame, label, pose },
  ], state.frameCount));
  clearDraft();
  regenerateSelectedFrames(`Keyframe set at frame ${resolvedFrame}.`);
}

function deleteKeyframe(frame: number): void {
  const selectedKeyframes = getSelectedKeyframes();
  if (selectedKeyframes.length <= 1) {
    setStatus('At least one keyframe is required.');
    return;
  }
  setSelectedKeyframes(selectedKeyframes.filter((keyframe) => keyframe.frame !== frame));
  clearDraft();
  regenerateSelectedFrames(`Keyframe ${frame} removed.`);
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
  firstPersonHammer.visible = state.view === 'firstPerson' && state.weapon === 'hammer';
  firstPersonSword.visible = state.view === 'firstPerson' && state.weapon === 'sword';
  reticle.visible = state.view === 'firstPerson';

  transformControls.detach();
  const selectedObject = getTargetObject(state.selectedTarget);
  if (selectedObject) transformControls.attach(selectedObject);
  transformControls.setMode(state.transformMode);
  applyFrameToScene();
  updateRigOverlays();
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
  frameSlider.max = String(state.frameCount - 1);
  frameSlider.value = String(state.currentFrame);
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

function buildExportPayload() {
  return buildAnimationEditorExportPayload({
    weapon: state.weapon,
    view: state.view,
    track: state.trackId,
    frameCount: state.frameCount,
    interpolation: state.interpolation,
    keyframes: state.weaponKeyframes,
    frames: state.weaponGeneratedFrames,
    rig: {
      bones: buildRigTrackExport('bone'),
      sockets: buildRigTrackExport('socket'),
    },
  });
}

function buildSnippet(): string {
  const constName = `${state.trackId}_${state.view}_frames`;
  return buildPoseArraySnippet(constName, state.weaponGeneratedFrames, 4);
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
  transformStatus.textContent = state.transformMode;
}

function renderAll(): void {
  weaponSelect.value = state.weapon;
  viewSelect.value = state.view;
  interpolationSelect.value = state.interpolation;
  frameCountInput.value = String(state.frameCount);
  showSkeletonToggle.checked = state.showSkeleton;
  showSocketsToggle.checked = state.showSockets;
  showLabelsToggle.checked = state.showLabels;
  refreshTrackOptions();
  refreshTargetOptions();
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
  const pose = readPoseInputs(captureSelectedPose());
  setDraftPose(pose);
  applyPoseToSelected(pose);
  updateRigOverlays();
  renderHud();
  renderSegmentInfo();
  setStatus(`Draft pose edited at frame ${state.currentFrame}.`);
}

Object.values(poseInputs).forEach((input) => {
  input.addEventListener('input', handlePoseInputChange);
});

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

  if (getSelectedKeyframes().length === 0) {
    setSelectedKeyframes([{
      frame: state.currentFrame,
      label: 'A',
      pose: getCurrentSelectedPose(),
    }]);
    setSelectedGeneratedFrames(generatePoseFrames(getSelectedKeyframes(), state.frameCount, state.interpolation));
  }

  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus(`Selected ${targetLabel(state.selectedTarget)}.`);
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
});

interpolationSelect.addEventListener('change', () => {
  state.interpolation = interpolationSelect.value as AnimationInterpolationMode;
  clearDraft();
  regenerateAllFrames();
  applyFrameToScene();
  syncPoseInputs(getCurrentSelectedPose());
  renderAll();
  setStatus('Interpolation mode updated.');
});

seedButton.addEventListener('click', seedThreeFrames);
generateButton.addEventListener('click', () => regenerateSelectedFrames());
setKeyframeButton.addEventListener('click', () => {
  setKeyframe(state.currentFrame, captureSelectedPose());
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
  const pose = captureSelectedPose();
  setDraftPose(pose);
  syncPoseInputs(pose);
  updateRigOverlays();
  renderHud();
  renderSegmentInfo();
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
      setCurrentFrame(state.currentFrame >= state.frameCount - 1 ? 0 : state.currentFrame + 1);
    }
  }

  controls.update();
  updateRigOverlays();
  renderer.render(scene, camera);
}

refreshTrackOptions();
captureEditableTargetBaselines();
buildOverlayMarkers();
seedThreeFrames();
syncSceneVisibility();
updateCameraForView();
resizeRenderer();
animate();
