import * as THREE from 'three';
import {
  animateV3CombatantModel,
  animateV3WeaponMeshes,
} from '../components/grifball/combatantAnimationV3';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from '../components/grifball/combatantModels';
import {
  createV3DeathVoxelBurst,
  disposeV3DeathVoxelBurst,
  updateV3DeathVoxelBurst,
  type V3DeathVoxelBurstInstance,
} from '../components/grifball/v3DeathVoxelBurst';
import {
  V3_POSE_CLEARANCE_CASES,
  type V3PoseClearanceCaseId,
} from '../components/grifball/v3PoseClearance';
import { getV3AnimationClipMetadataForCase } from '../components/grifball/v3AnimationClipMetadata';
import {
  analyzeV3RetargetedMotionRetention,
  type V3RetargetedClipId,
  type V3RetargetedClipSource,
  type V3RetargetedMotionRetentionReport,
} from '../components/grifball/v3RetargetedAnimationClips';
import { analyzeV3LowerBodyContinuity } from '../components/grifball/v3LowerBodyContinuity';
import { analyzeV3SlotContinuity } from '../components/grifball/v3SlotContinuity';
import { createInitialGrifballThreeRefs } from '../components/grifball/threeRefs';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import type { V3QualityTier } from '../components/v3/v3ModelTypes';
import type { V3RenderOptions } from '../components/v3/v3QualityTiers';
import type { CharacterLoadout } from '../components/VoxelModels';

export type V3AnimationAtlasCaseId = V3PoseClearanceCaseId;
export type V3AnimationAtlasPlaybackMode = 'normalizedReview' | 'runtimeSimulation';
export type V3AnimationAtlasWeapon = 'hammer' | 'sword' | 'pistol';
export type V3AnimationAtlasViewId = 'front' | 'left' | 'rear' | 'right';

export interface V3AnimationAtlasFrameState {
  frame: number;
  fps: 60;
  normalizedTime: number;
  elapsedSeconds: number;
}

export interface V3AnimationAtlasCaseDefinition {
  id: V3AnimationAtlasCaseId;
  label: string;
  durationFrames: number;
  durationSeconds: number;
  activeWeapon: V3AnimationAtlasWeapon;
  showsWeapon: boolean;
  clipSource?: V3RetargetedClipSource;
  clipId?: V3RetargetedClipId;
  sourceHash?: string;
  clipReady?: boolean;
  motionRetention?: V3RetargetedMotionRetentionReport;
  motionSourceLabel?: string;
}

export interface V3AnimationAtlasSample {
  caseId: V3AnimationAtlasCaseId;
  mode: V3AnimationAtlasPlaybackMode;
  frame: number;
  fps: 60;
  normalizedTime: number;
  elapsedSeconds: number;
  dt: number;
  velocity: [number, number, number];
  yaw: number;
  hp: number;
  previousHp?: number;
  activeWeapon: V3AnimationAtlasWeapon;
  visibleWeapon: V3AnimationAtlasWeapon | null;
  weaponState: string;
  weaponTimer: number;
  isSliding: boolean;
  isSprinting: boolean;
  isLunging: boolean;
  deathBurstActive: boolean;
  clipSource?: V3RetargetedClipSource;
  clipId?: V3RetargetedClipId;
  sourceHash?: string;
  clipReady?: boolean;
  motionRetention?: V3RetargetedMotionRetentionReport;
  motionSourceLabel?: string;
}

export interface V3AnimationAtlasSceneOptions {
  caseId?: V3AnimationAtlasCaseId;
  qualityTier?: V3QualityTier;
  v3Options?: V3RenderOptions;
  seed?: number;
}

export interface V3AnimationAtlasClock {
  caseId: V3AnimationAtlasCaseId;
  frame: number;
  fps: 60;
  mode: V3AnimationAtlasPlaybackMode;
  playing: boolean;
  loop: boolean;
  playbackSpeed: number;
}

export interface V3AnimationAtlasView {
  id: V3AnimationAtlasViewId;
  label: string;
  rig: CombatantMeshRig;
  labelAnchor: THREE.Group;
  overlayRoot: THREE.Group;
  slotContinuityOverlay: THREE.Group;
  boundsHelper: THREE.Box3Helper;
  deathBurst: V3DeathVoxelBurstInstance | null;
}

export interface V3AnimationAtlasScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  views: V3AnimationAtlasView[];
  clock: V3AnimationAtlasClock;
  cases: V3AnimationAtlasCaseDefinition[];
  qualityTier: V3QualityTier;
  v3Options: V3RenderOptions;
  seed: number;
  overlayRoot: THREE.Group;
}

export interface V3AnimationAtlasSceneUpdateOptions {
  caseId?: V3AnimationAtlasCaseId;
  frame?: number;
  mode?: V3AnimationAtlasPlaybackMode;
  resetDeathBurst?: boolean;
  showBounds?: boolean;
  showFloorContact?: boolean;
  showWeaponGripDrift?: boolean;
  showUpperLowerIsolation?: boolean;
  showSlotContinuity?: boolean;
}

const CASE_DURATIONS: Record<V3AnimationAtlasCaseId, number> = {
  idle: 120,
  walk: 90,
  sprint: 90,
  slide: 72,
  hammerWindup: 60,
  hammerStrike: 48,
  hammerRecover: 60,
  swordLunge: 60,
  swordSlash: 60,
  pistolFire: 42,
  hitReact: 60,
  death: 72,
};

const CASE_LABELS: Record<V3AnimationAtlasCaseId, string> = {
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
  death: 'Death Burst',
};

const VIEW_LAYOUT: Array<{
  id: V3AnimationAtlasViewId;
  label: string;
  x: number;
  rotationY: number;
}> = [
  { id: 'front', label: 'Front', x: -5.4, rotationY: 0 },
  { id: 'left', label: 'Left', x: -1.8, rotationY: Math.PI / 2 },
  { id: 'rear', label: 'Rear', x: 1.8, rotationY: Math.PI },
  { id: 'right', label: 'Right', x: 5.4, rotationY: -Math.PI / 2 },
];

const WEAPON_REVIEW_CASES = new Set<V3AnimationAtlasCaseId>([
  'hammerWindup',
  'hammerStrike',
  'hammerRecover',
  'swordLunge',
  'swordSlash',
  'pistolFire',
]);

const roundMetric = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const caseDefinition = (caseId: V3AnimationAtlasCaseId) => {
  const definition = V3_POSE_CLEARANCE_CASES.find((candidate) => candidate.id === caseId);
  if (!definition) throw new Error(`Unknown V3 animation atlas case: ${caseId}`);
  return definition;
};

const caseMeta = (caseId: V3AnimationAtlasCaseId): V3AnimationAtlasCaseDefinition => {
  const definition = caseDefinition(caseId);
  const durationFrames = CASE_DURATIONS[caseId];
  const clipMetadata = getV3AnimationClipMetadataForCase(caseId);
  const motionRetention = clipMetadata?.clipId
    ? analyzeV3RetargetedMotionRetention(clipMetadata.clipId)
    : undefined;
  return {
    id: caseId,
    label: CASE_LABELS[caseId],
    durationFrames,
    durationSeconds: roundMetric(durationFrames / 60),
    activeWeapon: definition.activeWeapon,
    showsWeapon: WEAPON_REVIEW_CASES.has(caseId),
    ...(clipMetadata ? {
      clipSource: clipMetadata.clipSource,
      clipId: clipMetadata.clipId,
      sourceHash: clipMetadata.sourceHash,
      clipReady: clipMetadata.ready,
      ...(motionRetention ? { motionRetention } : {}),
      motionSourceLabel: clipMetadata.label,
    } : {}),
  };
};

const interpolateTimer = (
  start: number,
  end: number,
  normalizedTime: number
): number => roundMetric(start + (end - start) * clamp01(normalizedTime));

const normalizedVelocity = (
  baseVelocity: readonly [number, number, number],
  normalizedTime: number,
  caseId: V3AnimationAtlasCaseId
): [number, number, number] => {
  const phase = Math.sin(normalizedTime * Math.PI * 2);
  if (caseId === 'walk') return [roundMetric(baseVelocity[0]), 0, roundMetric(phase * 0.08)];
  if (caseId === 'sprint') return [roundMetric(baseVelocity[0]), 0, roundMetric(phase * 0.12)];
  if (caseId === 'slide') return [roundMetric(baseVelocity[0] * (1 - normalizedTime * 0.35)), 0, 0];
  if (caseId === 'swordLunge') return [0, 0, roundMetric(baseVelocity[2] * (1 - normalizedTime * 0.25))];
  if (caseId === 'hitReact') return [roundMetric(baseVelocity[0] * (1 - normalizedTime * 0.45)), 0, 0];
  return [roundMetric(baseVelocity[0]), roundMetric(baseVelocity[1]), roundMetric(baseVelocity[2])];
};

const runtimeVelocity = (
  baseVelocity: readonly [number, number, number],
  elapsedSeconds: number,
  caseId: V3AnimationAtlasCaseId
): [number, number, number] => {
  const pulse = Math.sin(elapsedSeconds * Math.PI * 3);
  if (caseId === 'walk') return [roundMetric(baseVelocity[0] * (0.82 + pulse * 0.08)), 0, roundMetric(pulse * 0.18)];
  if (caseId === 'sprint') return [roundMetric(baseVelocity[0] * (0.9 + pulse * 0.05)), 0, roundMetric(pulse * 0.22)];
  if (caseId === 'slide') return [roundMetric(baseVelocity[0] * Math.max(0.42, 1 - elapsedSeconds * 0.38)), 0, 0];
  if (caseId === 'swordLunge') return [0, 0, roundMetric(baseVelocity[2] * (0.9 + pulse * 0.04))];
  if (caseId === 'hitReact') return [roundMetric(baseVelocity[0] * 0.74), 0, roundMetric(pulse * 0.06)];
  return [roundMetric(baseVelocity[0]), roundMetric(baseVelocity[1]), roundMetric(baseVelocity[2])];
};

const sampleWeaponTimer = (
  caseId: V3AnimationAtlasCaseId,
  baseTimer: number,
  normalizedTime: number,
  elapsedSeconds: number,
  mode: V3AnimationAtlasPlaybackMode
): number => {
  const t = mode === 'normalizedReview'
    ? normalizedTime
    : (elapsedSeconds % Math.max(0.001, CASE_DURATIONS[caseId] / 60)) / Math.max(0.001, CASE_DURATIONS[caseId] / 60);

  if (caseId === 'hammerWindup') return interpolateTimer(0.34, 0.02, t);
  if (caseId === 'hammerStrike') return interpolateTimer(0.18, 0.01, t);
  if (caseId === 'hammerRecover') return interpolateTimer(0.42, 0.02, t);
  if (caseId === 'swordSlash') return interpolateTimer(0.24, 0.01, t);
  if (caseId === 'swordLunge') return interpolateTimer(0.18, 0.02, t);
  if (caseId === 'pistolFire') return interpolateTimer(0.16, 0.01, t);
  return roundMetric(baseTimer);
};

export function buildV3AnimationAtlasCases(): V3AnimationAtlasCaseDefinition[] {
  return V3_POSE_CLEARANCE_CASES.map((definition) => caseMeta(definition.id));
}

export function createV3AnimationAtlasFrameState(
  frame: number,
  durationFrames: number,
  fps: 60 = 60
): V3AnimationAtlasFrameState {
  const safeDuration = Math.max(1, Math.floor(durationFrames));
  const safeFrame = Math.max(0, Math.min(safeDuration, Math.floor(frame)));
  return {
    frame: safeFrame,
    fps,
    normalizedTime: roundMetric(safeFrame / safeDuration),
    elapsedSeconds: roundMetric(safeFrame / fps),
  };
}

export function stepV3AnimationAtlasFrame({
  frame,
  delta,
  durationFrames,
  loop,
}: {
  frame: number;
  delta: number;
  durationFrames: number;
  loop: boolean;
}): number {
  const safeDuration = Math.max(0, Math.floor(durationFrames));
  const next = Math.floor(frame + delta);
  if (!loop) return Math.max(0, Math.min(safeDuration, next));
  if (safeDuration <= 0) return 0;
  if (next > safeDuration) return 0;
  if (next < 0) return safeDuration;
  return next;
}

export function sampleV3AnimationAtlasCase(
  caseId: V3AnimationAtlasCaseId,
  frameState: V3AnimationAtlasFrameState,
  mode: V3AnimationAtlasPlaybackMode
): V3AnimationAtlasSample {
  const definition = caseDefinition(caseId);
  const isRuntime = mode === 'runtimeSimulation';
  const velocity = isRuntime
    ? runtimeVelocity(definition.vel, frameState.elapsedSeconds, caseId)
    : normalizedVelocity(definition.vel, frameState.normalizedTime, caseId);
  const activeWeapon = definition.activeWeapon;
  const showsWeapon = WEAPON_REVIEW_CASES.has(caseId);
  const weaponTimer = sampleWeaponTimer(
    caseId,
    definition.weaponTimer,
    frameState.normalizedTime,
    frameState.elapsedSeconds,
    mode
  );
  const hp = 'hp' in definition ? definition.hp : 100;
  const previousHp = 'previousHp' in definition ? definition.previousHp : undefined;
  const clipMetadata = getV3AnimationClipMetadataForCase(caseId);
  const motionRetention = clipMetadata?.clipId
    ? analyzeV3RetargetedMotionRetention(clipMetadata.clipId)
    : undefined;

  return {
    caseId,
    mode,
    frame: frameState.frame,
    fps: frameState.fps,
    normalizedTime: frameState.normalizedTime,
    elapsedSeconds: frameState.elapsedSeconds,
    dt: isRuntime ? 1 / frameState.fps : roundMetric(Math.max(1 / frameState.fps, definition.dt / Math.max(1, CASE_DURATIONS[caseId]))),
    velocity,
    yaw: 0,
    hp,
    previousHp,
    activeWeapon,
    visibleWeapon: showsWeapon && hp > 0 ? activeWeapon : null,
    weaponState: definition.weaponState,
    weaponTimer,
    isSliding: 'isSliding' in definition ? Boolean(definition.isSliding) : false,
    isSprinting: 'isSprinting' in definition ? Boolean(definition.isSprinting) : false,
    isLunging: 'isLunging' in definition ? Boolean(definition.isLunging) : false,
    deathBurstActive: hp <= 0,
    ...(clipMetadata ? {
      clipSource: clipMetadata.clipSource,
      clipId: clipMetadata.clipId,
      sourceHash: clipMetadata.sourceHash,
      clipReady: clipMetadata.ready,
      ...(motionRetention ? { motionRetention } : {}),
      motionSourceLabel: clipMetadata.label,
    } : {}),
  };
}

function createLabelAnchor(label: string): THREE.Group {
  const group = new THREE.Group();
  group.name = `atlasLabel:${label}`;
  group.userData.label = label;
  return group;
}

function createBoundsHelper(): THREE.Box3Helper {
  const helper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#5eead4'));
  helper.name = 'v3AnimationAtlasBoundsOverlay';
  helper.visible = false;
  return helper;
}

function createFloorContactOverlay(): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.7, 0, 0),
    new THREE.Vector3(0.7, 0, 0),
  ]);
  const material = new THREE.LineBasicMaterial({
    color: '#facc15',
    transparent: true,
    opacity: 0.85,
  });
  const line = new THREE.Line(geometry, material);
  line.name = 'v3AnimationAtlasFloorContactOverlay';
  return line;
}

function createSlotContinuityOverlay(viewId: V3AnimationAtlasViewId): THREE.Group {
  const group = new THREE.Group();
  group.name = `v3AnimationAtlasSlotContinuityOverlay:${viewId}`;
  group.visible = false;
  return group;
}

function disposeOverlayChildren(group: THREE.Group): void {
  for (const child of [...group.children]) {
    group.remove(child);
    if (child instanceof THREE.Line || child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) material.dispose();
    }
  }
}

function createSlotContinuityLine(from: THREE.Vector3, to: THREE.Vector3, linkId: string): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
  const material = new THREE.LineBasicMaterial({
    color: '#ef4444',
    transparent: true,
    opacity: 0.94,
  });
  const line = new THREE.Line(geometry, material);
  line.name = `v3AnimationAtlasSlotContinuityLine:${linkId}`;
  return line;
}

function createSlotContinuityMarker(position: THREE.Vector3, linkId: string): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 8, 6),
    new THREE.MeshBasicMaterial({
      color: '#f59e0b',
      transparent: true,
      opacity: 0.92,
    })
  );
  marker.name = `v3AnimationAtlasSlotContinuityMarker:${linkId}`;
  marker.position.copy(position);
  return marker;
}

function setWeaponVisibility(
  rig: CombatantMeshRig,
  visibleWeapon: V3AnimationAtlasWeapon | null
): void {
  rig.hammer.visible = visibleWeapon === 'hammer';
  rig.sword.visible = visibleWeapon === 'sword';
  if (rig.pistol) rig.pistol.visible = visibleWeapon === 'pistol';
}

function applySampleToRig(
  scene: THREE.Scene,
  rig: CombatantMeshRig,
  sample: V3AnimationAtlasSample,
  qualityTier: V3QualityTier
): void {
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  if (typeof sample.previousHp === 'number') {
    rig.group.userData.v3LastHp = sample.previousHp;
  }

  animateV3CombatantModel({
    refs,
    mesh: rig.group,
    vel: new THREE.Vector3(...sample.velocity),
    yaw: sample.yaw,
    hp: sample.hp,
    activeWeapon: sample.activeWeapon,
    weaponState: sample.weaponState,
    weaponTimer: sample.weaponTimer,
    dt: sample.dt,
    isSliding: sample.isSliding,
    isSprinting: sample.isSprinting,
    isLunging: sample.isLunging,
    animationClockMs: sample.elapsedSeconds * 1000,
    isLocalV3Animation: true,
    settings: { hammerAttackAnimation: 'highFidelity' },
    v3QualityTier: qualityTier,
  });

  animateV3WeaponMeshes({
    hammerModel: rig.hammer,
    swordModel: rig.sword,
    pistolModel: rig.pistol,
    activeWeapon: sample.activeWeapon,
    weaponState: sample.weaponState,
    weaponTimer: sample.weaponTimer,
    isLunging: sample.isLunging,
    dt: sample.dt,
    settings: { hammerAttackAnimation: 'highFidelity' },
  });
  setWeaponVisibility(rig, sample.visibleWeapon);
}

function updateBoundsHelper(view: V3AnimationAtlasView, visible: boolean): void {
  view.boundsHelper.visible = visible;
  if (!visible) return;
  view.rig.group.updateWorldMatrix(true, true);
  view.boundsHelper.box.copy(new THREE.Box3().setFromObject(view.rig.group));
}

function updateSlotContinuityOverlay(view: V3AnimationAtlasView, visible: boolean): void {
  view.slotContinuityOverlay.visible = visible;
  disposeOverlayChildren(view.slotContinuityOverlay);
  if (!visible) return;

  const report = analyzeV3SlotContinuity(view.rig.group);
  const lowerBodyReport = analyzeV3LowerBodyContinuity(view.rig.group, {
    maxSeamGap: 0.08,
    maxProjectedSeamGap: 0.08,
  });
  view.slotContinuityOverlay.userData.v3LowerBodyContinuityReport = lowerBodyReport;
  const overlayOrigin = view.overlayRoot.getWorldPosition(new THREE.Vector3());
  for (const link of report.links) {
    if (link.ready) continue;
    const from = new THREE.Vector3(...link.endpoints.from).sub(overlayOrigin);
    const to = new THREE.Vector3(...link.endpoints.to).sub(overlayOrigin);
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    view.slotContinuityOverlay.add(createSlotContinuityLine(from, to, link.id));
    view.slotContinuityOverlay.add(createSlotContinuityMarker(midpoint, link.id));
  }
  for (const link of lowerBodyReport.links) {
    if (link.ready) continue;
    const from = new THREE.Vector3(...link.endpoints.from).sub(overlayOrigin);
    const to = new THREE.Vector3(...link.endpoints.to).sub(overlayOrigin);
    const midpoint = from.clone().add(to).multiplyScalar(0.5);
    view.slotContinuityOverlay.add(createSlotContinuityLine(from, to, `lowerBody:${link.id}`));
    view.slotContinuityOverlay.add(createSlotContinuityMarker(midpoint, `lowerBody:${link.id}`));
  }
}

function disposeViewDeathBurst(view: V3AnimationAtlasView): void {
  if (!view.deathBurst) return;
  disposeV3DeathVoxelBurst(view.deathBurst);
  view.deathBurst = null;
}

export function buildV3AnimationAtlasScene(
  options: V3AnimationAtlasSceneOptions = {}
): V3AnimationAtlasScene {
  const qualityTier = normalizeV3QualityTier(options.qualityTier ?? options.v3Options?.v3QualityTier ?? 'desktop');
  const caseId = options.caseId ?? 'idle';
  const seed = Number.isFinite(options.seed) ? Number(options.seed) : 42142;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#061016');

  const camera = new THREE.OrthographicCamera(-7.5, 7.5, 3.7, -0.7, 0.1, 80);
  camera.position.set(0, 1.8, 9);
  camera.lookAt(0, 1.35, 0);

  scene.add(new THREE.HemisphereLight('#f8fbff', '#17232c', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 1.8);
  key.position.set(2.5, 4.5, 5);
  scene.add(key);
  const fill = new THREE.DirectionalLight('#9ddcff', 0.75);
  fill.position.set(-3, 3, 4);
  scene.add(fill);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 2.2),
    new THREE.MeshBasicMaterial({
      color: '#17252d',
      transparent: true,
      opacity: 0.68,
    })
  );
  floor.name = 'v3AnimationAtlasDiagnosticFloor';
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const overlayRoot = new THREE.Group();
  overlayRoot.name = 'v3AnimationAtlasOverlays';
  scene.add(overlayRoot);

  const v3Options: V3RenderOptions = {
    ...options.v3Options,
    v3QualityTier: qualityTier,
    v3SourceFidelity: options.v3Options?.v3SourceFidelity ?? 'exact',
  };
  const loadout: CharacterLoadout = {
    modelSystem: 'v3',
    paintJob: {
      v3RoleColors: {
        primary: '#67d7ff',
        secondary: '#334155',
        accent: '#fbbf24',
        visor: '#67e8f9',
        emissive: '#5eead4',
        undersuit: '#111827',
      },
      v3RoleEmissive: {
        visor: true,
        emissive: true,
      },
    },
  };

  const views = VIEW_LAYOUT.map((layout, index): V3AnimationAtlasView => {
    const rig = createCombatantMeshRig(scene, (192 + index * 17) % 360, false, loadout, v3Options);
    rig.group.name = `v3AnimationAtlasRig:${layout.id}`;
    rig.group.position.set(layout.x, 0, 0);
    rig.group.rotation.y = layout.rotationY;
    rig.group.userData.v3AnimationAtlasView = layout.id;
    const labelAnchor = createLabelAnchor(layout.label);
    labelAnchor.position.set(layout.x, 2.62, 0);
    scene.add(labelAnchor);
    const overlayRootForView = new THREE.Group();
    overlayRootForView.name = `v3AnimationAtlasOverlay:${layout.id}`;
    overlayRootForView.position.set(layout.x, 0, 0);
    overlayRootForView.add(createFloorContactOverlay());
    const slotContinuityOverlay = createSlotContinuityOverlay(layout.id);
    overlayRootForView.add(slotContinuityOverlay);
    overlayRoot.add(overlayRootForView);
    const boundsHelper = createBoundsHelper();
    overlayRoot.add(boundsHelper);
    return {
      id: layout.id,
      label: layout.label,
      rig,
      labelAnchor,
      overlayRoot: overlayRootForView,
      slotContinuityOverlay,
      boundsHelper,
      deathBurst: null,
    };
  });

  const atlas: V3AnimationAtlasScene = {
    scene,
    camera,
    views,
    clock: {
      caseId,
      frame: 0,
      fps: 60,
      mode: 'normalizedReview',
      playing: false,
      loop: true,
      playbackSpeed: 1,
    },
    cases: buildV3AnimationAtlasCases(),
    qualityTier,
    v3Options,
    seed,
    overlayRoot,
  };
  updateV3AnimationAtlasScene(atlas, { caseId, frame: 0, resetDeathBurst: true });
  return atlas;
}

export function updateV3AnimationAtlasScene(
  atlas: V3AnimationAtlasScene,
  options: V3AnimationAtlasSceneUpdateOptions = {}
): V3AnimationAtlasSample {
  const caseId = options.caseId ?? atlas.clock.caseId;
  const definition = caseMeta(caseId);
  const frame = Math.max(0, Math.min(definition.durationFrames, Math.floor(options.frame ?? atlas.clock.frame)));
  const mode = options.mode ?? atlas.clock.mode;
  const frameState = createV3AnimationAtlasFrameState(frame, definition.durationFrames, atlas.clock.fps);
  const sample = sampleV3AnimationAtlasCase(caseId, frameState, mode);
  atlas.clock.caseId = caseId;
  atlas.clock.frame = frame;
  atlas.clock.mode = mode;

  atlas.views.forEach((view, index) => {
    if (options.resetDeathBurst || caseId !== 'death') {
      disposeViewDeathBurst(view);
    }

    if (sample.deathBurstActive) {
      if (!view.deathBurst) {
        view.rig.group.visible = true;
        view.deathBurst = createV3DeathVoxelBurst(atlas.scene, view.rig.group, {
          qualityTier: atlas.qualityTier,
          seed: atlas.seed + index * 101,
          duration: definition.durationSeconds,
        });
      }
      view.rig.group.visible = false;
      setWeaponVisibility(view.rig, null);
      if (view.deathBurst) {
        view.deathBurst.elapsed = Math.max(0, Math.min(definition.durationSeconds, sample.elapsedSeconds));
        updateV3DeathVoxelBurst(view.deathBurst, 0);
      }
    } else {
      view.rig.group.visible = true;
      applySampleToRig(atlas.scene, view.rig, sample, atlas.qualityTier);
    }

    updateBoundsHelper(view, options.showBounds === true);
    updateSlotContinuityOverlay(view, options.showSlotContinuity === true);
    view.overlayRoot.visible =
      options.showFloorContact === true ||
      options.showWeaponGripDrift === true ||
      options.showUpperLowerIsolation === true ||
      options.showSlotContinuity === true;
  });

  atlas.scene.updateMatrixWorld(true);
  return sample;
}
