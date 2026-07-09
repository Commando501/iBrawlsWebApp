import * as THREE from 'three';
import {
  analyzeV3AnimationAtlasDefects,
  formatV3AnimationAtlasDefectSummary,
  type V3AnimationAtlasDefectReport,
} from '../components/grifball/v3AnimationAtlasDefects';
import {
  buildV3AnimationAtlasScene,
  createV3AnimationAtlasFrameState,
  sampleV3AnimationAtlasCase,
  stepV3AnimationAtlasFrame,
  updateV3AnimationAtlasScene,
  type V3AnimationAtlasCaseId,
  type V3AnimationAtlasPlaybackMode,
  type V3AnimationAtlasViewId,
  V3_ANIMATION_ATLAS_BIND_REST_POSE_ID,
} from './v3AnimationAtlasSmoke';
import {
  exportV3AuthoredClipToJson,
  normalizeV3AuthoredClipExport,
  type V3AuthoredClipExport,
} from '../components/grifball/v3AuthoredAnimationClips';

const canvas = document.getElementById('atlas-canvas') as HTMLCanvasElement;
const animationSelect = document.getElementById('animation-select') as HTMLSelectElement;
const carryWeaponSelect = document.getElementById('carry-weapon') as HTMLSelectElement;
const playAllButton = document.getElementById('play-all') as HTMLButtonElement;
const playPauseButton = document.getElementById('play-pause') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const framePrevButton = document.getElementById('frame-prev') as HTMLButtonElement;
const frameNextButton = document.getElementById('frame-next') as HTMLButtonElement;
const timelineInput = document.getElementById('timeline') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const speedInput = document.getElementById('speed') as HTMLInputElement;
const loopInput = document.getElementById('loop') as HTMLInputElement;
const boundsOverlayInput = document.getElementById('bounds-overlay') as HTMLInputElement;
const floorOverlayInput = document.getElementById('floor-overlay') as HTMLInputElement;
const weaponOverlayInput = document.getElementById('weapon-overlay') as HTMLInputElement;
const isolationOverlayInput = document.getElementById('isolation-overlay') as HTMLInputElement;
const slotContinuityOverlayInput = document.getElementById('slot-continuity-overlay') as HTMLInputElement;
const showDefectsInput = document.getElementById('show-defects') as HTMLInputElement;
const copyDefectReportButton = document.getElementById('copy-defect-report') as HTMLButtonElement;
const downloadDefectReportButton = document.getElementById('download-defect-report') as HTMLButtonElement;
const defectReportElement = document.getElementById('defect-report') as HTMLPreElement;
const cleanAuthorityElement = document.getElementById('clean-authority') as HTMLOutputElement;
const cleanAuthoredClipElement = document.getElementById('clean-authored-clip') as HTMLOutputElement;
const cleanMotionSourceElement = document.getElementById('clean-motion-source') as HTMLOutputElement;
const cleanMixamoClipElement = document.getElementById('clean-mixamo-clip') as HTMLOutputElement;
const cleanEditorExportElement = document.getElementById('clean-editor-export') as HTMLTextAreaElement;
const copyCleanClipButton = document.getElementById('copy-clean-clip') as HTMLButtonElement;
const downloadCleanClipButton = document.getElementById('download-clean-clip') as HTMLButtonElement;
const previewCleanClipButton = document.getElementById('preview-clean-clip') as HTMLButtonElement;
const clearCleanPreviewButton = document.getElementById('clear-clean-preview') as HTMLButtonElement;
const summary = document.getElementById('summary') as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const atlas = buildV3AnimationAtlasScene({
  caseId: 'idle',
  qualityTier: 'desktop',
});
const baseViewRotations = Object.fromEntries(
  atlas.views.map((view) => [view.id, view.rig.group.rotation.y])
) as Record<V3AnimationAtlasViewId, number>;
const sharedReviewRotation = new THREE.Euler(0, 0, 0, 'YXZ');
const sharedReviewQuaternion = new THREE.Quaternion();
const baseViewQuaternion = new THREE.Quaternion();
const dragRotationSpeed = 0.008;
const dragPitchLimit = Math.PI / 2;
const modelDragState = {
  active: false,
  pointerId: -1,
  lastX: 0,
  lastY: 0,
};

let playAll = false;
let lastTimeMs = 0;
let frameCarry = 0;
let currentDefectReport: V3AnimationAtlasDefectReport | null = null;
let currentDefectSignature: string | null = null;
let manualClipExport: V3AuthoredClipExport | null = null;
let lastAnimationPlaybackMode: Exclude<V3AnimationAtlasPlaybackMode, 'bindRestPose'> = 'normalizedReview';
const MANUAL_PREVIEW_STORAGE_KEY = 'ibrawls_v3_clean_editor_preview_clip';

for (const atlasCase of atlas.cases) {
  const option = document.createElement('option');
  option.value = atlasCase.id;
  option.textContent = atlasCase.label;
  animationSelect.appendChild(option);
}

function currentCase() {
  return atlas.cases.find((entry) => entry.id === atlas.clock.caseId) ?? atlas.cases[0];
}

function currentMode(): V3AnimationAtlasPlaybackMode {
  if (modeSelect.value === 'bindRestPose') return 'bindRestPose';
  return modeSelect.value === 'runtimeSimulation' ? 'runtimeSimulation' : 'normalizedReview';
}

function exitBindPoseReviewForAnimation(): boolean {
  if (currentMode() !== 'bindRestPose') return false;
  modeSelect.value = lastAnimationPlaybackMode;
  atlas.clock.mode = lastAnimationPlaybackMode;
  return true;
}

function currentCarryWeapon() {
  return carryWeaponSelect.value === 'hammer' || carryWeaponSelect.value === 'sword' || carryWeaponSelect.value === 'pistol'
    ? carryWeaponSelect.value
    : null;
}

function loadManualClipPreview(): void {
  try {
    const raw = window.localStorage.getItem(MANUAL_PREVIEW_STORAGE_KEY);
    manualClipExport = raw ? normalizeV3AuthoredClipExport(raw) : null;
  } catch {
    manualClipExport = null;
  }
}

function saveManualClipPreview(): void {
  if (!manualClipExport) {
    window.localStorage.removeItem(MANUAL_PREVIEW_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(MANUAL_PREVIEW_STORAGE_KEY, JSON.stringify(manualClipExport));
}

function buildDefectSignature(): string {
  return [
    atlas.clock.caseId,
    atlas.clock.mode,
    currentCarryWeapon() ?? 'no-carry',
    atlas.qualityTier,
    atlas.v3Options.v3SourceFidelity ?? 'runtimeLod',
    atlas.v3Options.v3QualityTier ?? atlas.qualityTier,
    manualClipExport?.id ?? 'no-manual-preview',
    manualClipExport?.label ?? 'no-manual-label',
  ].join('|');
}

function ensureDefectReport(): V3AnimationAtlasDefectReport {
  const signature = buildDefectSignature();
  if (!currentDefectReport || currentDefectSignature !== signature) {
    currentDefectReport = analyzeV3AnimationAtlasDefects({
    caseIds: [atlas.clock.caseId],
    mode: atlas.clock.mode === 'bindRestPose' ? 'normalizedReview' : atlas.clock.mode,
    qualityTier: atlas.qualityTier,
    v3Options: atlas.v3Options,
  });
    currentDefectSignature = signature;
  }
  return currentDefectReport;
}

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const viewHeight = 4.4;
  const minViewWidth = 15;
  const viewWidth = Math.max(viewHeight * aspect, minViewWidth);
  atlas.camera.top = viewHeight / 2;
  atlas.camera.bottom = -viewHeight / 2;
  atlas.camera.left = -viewWidth / 2;
  atlas.camera.right = viewWidth / 2;
  atlas.camera.updateProjectionMatrix();
}

function reviewRotationState() {
  return {
    pitch: Number(sharedReviewRotation.x.toFixed(6)),
    yaw: Number(sharedReviewRotation.y.toFixed(6)),
  };
}

function publishReviewRotationState(): void {
  const state = reviewRotationState();
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_REVIEW_ROTATION__ = state;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_REVIEW_ROTATION__ = state;
}

function applyReviewRotation(): void {
  sharedReviewQuaternion.setFromEuler(sharedReviewRotation);
  for (const view of atlas.views) {
    baseViewQuaternion.setFromEuler(new THREE.Euler(0, baseViewRotations[view.id], 0, 'YXZ'));
    view.rig.group.quaternion.copy(baseViewQuaternion).multiply(sharedReviewQuaternion).normalize();
  }
  publishReviewRotationState();
}

function publishReport() {
  const atlasCase = currentCase();
  const frameState = createV3AnimationAtlasFrameState(atlas.clock.frame, atlasCase.durationFrames, atlas.clock.fps);
  const sample = sampleV3AnimationAtlasCase(atlasCase.id, frameState, atlas.clock.mode, {
    carryWeapon: currentCarryWeapon(),
    manualClipExport,
  });
  const deathFragments = atlas.views.reduce((total, view) => total + (view.deathBurst?.plan.fragments.length ?? 0), 0);
  const defectReport = showDefectsInput.checked
    ? ensureDefectReport()
    : currentDefectReport;
  const defectSummary = defectReport
    ? formatV3AnimationAtlasDefectSummary(defectReport)
    : 'V3 animation atlas defects: not measured';
  const report = {
    ready: true,
    title: 'V3 Animation Atlas Smoke',
    status: 'V3 Internal Prototype - Not Player Ready',
    caseId: atlas.clock.caseId,
    caseLabel: atlasCase.label,
    mode: atlas.clock.mode,
    frame: atlas.clock.frame,
    durationFrames: atlasCase.durationFrames,
    normalizedTime: sample.normalizedTime,
    motionSourceLabel: sample.motionSourceLabel ?? 'procedural runtime',
    animationAuthority: sample.animationAuthority,
    authoredClipId: sample.authoredClipId,
    cleanMotionSource: sample.cleanMotionSource,
    cleanMixamoClipId: sample.cleanMixamoClipId ?? null,
    cleanSourceNormalizedTime: sample.cleanSourceNormalizedTime ?? null,
    cleanRigReady: sample.cleanRigReady,
    jointSeamWarnings: sample.jointSeamWarnings,
    manualClipPreviewActive: sample.manualClipPreviewActive === true,
    manualClipLabel: sample.manualClipLabel ?? null,
    atlasEditorExportVersion: sample.atlasEditorExportVersion,
    clipId: sample.clipId ?? null,
    clipSource: sample.clipSource ?? null,
    sourceHash: sample.sourceHash ?? null,
    viewCount: atlas.views.length,
    reviewRotation: reviewRotationState(),
    visibleWeapon: sample.visibleWeapon,
    carryWeapon: currentCarryWeapon(),
    deathBurstActive: sample.deathBurstActive,
    deathFragments,
    defectSummary,
    defects: defectReport,
    overlays: {
      bounds: boundsOverlayInput.checked,
      floorContact: floorOverlayInput.checked,
      weaponGripDrift: weaponOverlayInput.checked,
      upperLowerIsolation: isolationOverlayInput.checked,
      slotContinuity: slotContinuityOverlayInput.checked,
    },
  };
  const editorState = {
    ready: true,
    animationAuthority: sample.animationAuthority,
    authoredClipId: sample.bindPoseReview ? V3_ANIMATION_ATLAS_BIND_REST_POSE_ID : sample.authoredClipId,
    cleanMotionSource: sample.bindPoseReview ? 'mesh2motion-tpose-bind' : sample.cleanMotionSource,
    cleanMixamoClipId: sample.cleanMixamoClipId ?? null,
    cleanSourceNormalizedTime: sample.cleanSourceNormalizedTime ?? null,
    atlasEditorExportVersion: sample.atlasEditorExportVersion,
    manualClipPreviewActive: sample.manualClipPreviewActive === true,
    manualClipLabel: sample.manualClipLabel ?? null,
    bindPoseReview: sample.bindPoseReview === true,
    export: sample.bindPoseReview
      ? {
        kind: 'v3-animation-atlas-bind-rest-pose-preview',
        id: V3_ANIMATION_ATLAS_BIND_REST_POSE_ID,
        label: 'Mesh2Motion authored T-pose bind/rest pose',
        source: 'V3_MESH2MOTION_TPOSE_BIND',
        caseId: sample.caseId,
      }
      : sample.manualClipExport ?? exportV3AuthoredClipToJson(sample.authoredClipId),
  };
  cleanAuthorityElement.value = sample.bindPoseReview ? 'bindRestPose' : sample.animationAuthority;
  cleanAuthoredClipElement.value = sample.bindPoseReview ? V3_ANIMATION_ATLAS_BIND_REST_POSE_ID : sample.authoredClipId;
  cleanMotionSourceElement.value = sample.bindPoseReview ? 'mesh2motion-tpose-bind' : sample.cleanMotionSource;
  cleanMixamoClipElement.value = sample.bindPoseReview
    ? 'none (bind rest)'
    : sample.cleanMixamoClipId
    ? `${sample.cleanMixamoClipId} @ ${(sample.cleanSourceNormalizedTime ?? 0).toFixed(3)}`
    : 'none';
  if (document.activeElement !== cleanEditorExportElement) {
    cleanEditorExportElement.value = JSON.stringify(editorState.export, null, 2);
  }
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_SMOKE__ = report;
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_DEFECTS__ = defectReport;
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_EDITOR__ = editorState;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_SMOKE__ = report;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_DEFECTS__ = defectReport;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_EDITOR__ = editorState;
  summary.textContent = `${report.title} | ${report.status} | ${atlasCase.label} | ${report.motionSourceLabel} | ${atlas.clock.mode} | frame ${atlas.clock.frame}/${atlasCase.durationFrames} | weapon ${sample.visibleWeapon ?? 'hidden'} | views ${atlas.views.length}`;
  previewCleanClipButton.disabled = sample.bindPoseReview === true;
  defectReportElement.hidden = !showDefectsInput.checked;
  defectReportElement.textContent = showDefectsInput.checked
    ? `${defectSummary}\n${JSON.stringify(ensureDefectReport().summary, null, 2)}`
    : 'Defect Report hidden. Enable Show Defects to measure the selected case.';
}

function syncControls() {
  const atlasCase = currentCase();
  animationSelect.value = atlas.clock.caseId;
  modeSelect.value = atlas.clock.mode;
  timelineInput.max = String(atlasCase.durationFrames);
  timelineInput.value = String(atlas.clock.frame);
  playPauseButton.textContent = atlas.clock.playing ? 'Pause' : 'Play';
  atlas.clock.loop = loopInput.checked;
  atlas.clock.playbackSpeed = Math.max(0.1, Math.min(4, Number(speedInput.value) || 1));
  publishReport();
}

function renderAtlas(resetDeathBurst = false) {
  const mode = currentMode();
  if (mode === 'bindRestPose') {
    atlas.clock.playing = false;
    playAll = false;
    atlas.clock.frame = 0;
  }
  updateV3AnimationAtlasScene(atlas, {
    caseId: atlas.clock.caseId,
    frame: atlas.clock.frame,
    mode,
    resetDeathBurst,
    showBounds: boundsOverlayInput.checked,
    showFloorContact: floorOverlayInput.checked,
    showWeaponGripDrift: weaponOverlayInput.checked,
    showUpperLowerIsolation: isolationOverlayInput.checked,
    showSlotContinuity: slotContinuityOverlayInput.checked,
    carryWeapon: currentCarryWeapon(),
    animationAuthority: atlas.animationAuthority,
    manualClipExport,
  });
  applyReviewRotation();
  syncControls();
  renderer.render(atlas.scene, atlas.camera);
}

function setCase(caseId: V3AnimationAtlasCaseId) {
  atlas.clock.caseId = caseId;
  atlas.clock.frame = 0;
  frameCarry = 0;
  renderAtlas(true);
}

function setFrame(frame: number, resetDeathBurst = false) {
  atlas.clock.frame = Math.max(0, Math.min(currentCase().durationFrames, Math.floor(frame)));
  renderAtlas(resetDeathBurst);
}

function nextCase() {
  const index = atlas.cases.findIndex((entry) => entry.id === atlas.clock.caseId);
  const next = atlas.cases[(index + 1) % atlas.cases.length];
  setCase(next.id);
}

animationSelect.addEventListener('change', () => {
  exitBindPoseReviewForAnimation();
  setCase(animationSelect.value as V3AnimationAtlasCaseId);
});
carryWeaponSelect.addEventListener('change', () => {
  exitBindPoseReviewForAnimation();
  renderAtlas(true);
});
modeSelect.addEventListener('change', () => {
  const mode = currentMode();
  if (mode !== 'bindRestPose') lastAnimationPlaybackMode = mode;
  renderAtlas(true);
});
loopInput.addEventListener('change', () => renderAtlas());
boundsOverlayInput.addEventListener('change', () => renderAtlas());
floorOverlayInput.addEventListener('change', () => renderAtlas());
weaponOverlayInput.addEventListener('change', () => renderAtlas());
isolationOverlayInput.addEventListener('change', () => renderAtlas());
slotContinuityOverlayInput.addEventListener('change', () => renderAtlas());
showDefectsInput.addEventListener('change', () => publishReport());
speedInput.addEventListener('change', () => syncControls());
timelineInput.addEventListener('input', () => {
  exitBindPoseReviewForAnimation();
  setFrame(Number(timelineInput.value), atlas.clock.caseId === 'death');
});

canvas.addEventListener('pointerdown', (event) => {
  if (!event.isPrimary || event.button !== 0) return;
  modelDragState.active = true;
  modelDragState.pointerId = event.pointerId;
  modelDragState.lastX = event.clientX;
  modelDragState.lastY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  canvas.classList.add('is-dragging');
  event.preventDefault();
});

canvas.addEventListener('pointermove', (event) => {
  if (!modelDragState.active || event.pointerId !== modelDragState.pointerId) return;
  const deltaX = event.clientX - modelDragState.lastX;
  const deltaY = event.clientY - modelDragState.lastY;
  modelDragState.lastX = event.clientX;
  modelDragState.lastY = event.clientY;
  sharedReviewRotation.y -= deltaX * dragRotationSpeed;
  sharedReviewRotation.x = THREE.MathUtils.clamp(
    sharedReviewRotation.x - deltaY * dragRotationSpeed,
    -dragPitchLimit,
    dragPitchLimit
  );
  applyReviewRotation();
  renderer.render(atlas.scene, atlas.camera);
  event.preventDefault();
});

function endModelDrag(event: PointerEvent): void {
  if (!modelDragState.active || event.pointerId !== modelDragState.pointerId) return;
  modelDragState.active = false;
  modelDragState.pointerId = -1;
  canvas.releasePointerCapture(event.pointerId);
  canvas.classList.remove('is-dragging');
  publishReport();
}

canvas.addEventListener('pointerup', endModelDrag);
canvas.addEventListener('pointercancel', endModelDrag);

copyDefectReportButton.addEventListener('click', async () => {
  const report = ensureDefectReport();
  publishReport();
  const payload = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard?.writeText(payload);
    copyDefectReportButton.textContent = 'Copied Defect Report';
  } catch {
    copyDefectReportButton.textContent = 'Copy Unavailable';
  }
  window.setTimeout(() => {
    copyDefectReportButton.textContent = 'Copy Defect Report';
  }, 1400);
});

downloadDefectReportButton.addEventListener('click', () => {
  const report = ensureDefectReport();
  publishReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-animation-atlas-defects-${atlas.clock.caseId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

copyCleanClipButton.addEventListener('click', async () => {
  publishReport();
  const payload = cleanEditorExportElement.value;
  try {
    await navigator.clipboard?.writeText(payload);
    copyCleanClipButton.textContent = 'Copied Clean Clip JSON';
  } catch {
    copyCleanClipButton.textContent = 'Copy Unavailable';
  }
  window.setTimeout(() => {
    copyCleanClipButton.textContent = 'Copy Clean Clip JSON';
  }, 1400);
});

downloadCleanClipButton.addEventListener('click', () => {
  publishReport();
  const clipId = cleanAuthoredClipElement.value || 'clean_clip';
  const blob = new Blob([cleanEditorExportElement.value], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `v3-authored-${clipId}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

previewCleanClipButton.addEventListener('click', () => {
  try {
    manualClipExport = normalizeV3AuthoredClipExport(cleanEditorExportElement.value);
    saveManualClipPreview();
    previewCleanClipButton.textContent = 'Previewing JSON';
    renderAtlas(true);
  } catch (error) {
    previewCleanClipButton.textContent = error instanceof Error ? error.message.slice(0, 28) : 'Invalid JSON';
  }
  window.setTimeout(() => {
    previewCleanClipButton.textContent = 'Preview JSON';
  }, 1800);
});

clearCleanPreviewButton.addEventListener('click', () => {
  manualClipExport = null;
  saveManualClipPreview();
  renderAtlas(true);
});

playPauseButton.addEventListener('click', () => {
  const exitedBindPose = exitBindPoseReviewForAnimation();
  atlas.clock.playing = !atlas.clock.playing;
  playAll = false;
  if (exitedBindPose) {
    renderAtlas(true);
  } else {
    syncControls();
  }
});

playAllButton.addEventListener('click', () => {
  exitBindPoseReviewForAnimation();
  playAll = true;
  atlas.clock.playing = true;
  atlas.clock.frame = 0;
  renderAtlas(true);
});

resetButton.addEventListener('click', () => {
  playAll = false;
  atlas.clock.playing = false;
  setFrame(0, true);
});

framePrevButton.addEventListener('click', () => {
  exitBindPoseReviewForAnimation();
  playAll = false;
  atlas.clock.playing = false;
  setFrame(stepV3AnimationAtlasFrame({
    frame: atlas.clock.frame,
    delta: -1,
    durationFrames: currentCase().durationFrames,
    loop: atlas.clock.loop,
  }), atlas.clock.caseId === 'death');
});

frameNextButton.addEventListener('click', () => {
  exitBindPoseReviewForAnimation();
  playAll = false;
  atlas.clock.playing = false;
  setFrame(stepV3AnimationAtlasFrame({
    frame: atlas.clock.frame,
    delta: 1,
    durationFrames: currentCase().durationFrames,
    loop: atlas.clock.loop,
  }), atlas.clock.caseId === 'death');
});

window.addEventListener('resize', () => {
  resize();
  renderAtlas();
});

function animate(timeMs: number) {
  if (lastTimeMs === 0) lastTimeMs = timeMs;
  const deltaSeconds = Math.min(0.08, Math.max(0, (timeMs - lastTimeMs) / 1000));
  lastTimeMs = timeMs;

  if (atlas.clock.playing) {
    const atlasCase = currentCase();
    frameCarry += deltaSeconds * atlas.clock.fps * atlas.clock.playbackSpeed;
    const frameDelta = Math.floor(frameCarry);
    if (frameDelta > 0) {
      frameCarry -= frameDelta;
      const nextFrame = atlas.clock.frame + frameDelta;
      if (nextFrame > atlasCase.durationFrames) {
        if (playAll) {
          nextCase();
        } else if (atlas.clock.loop) {
          setFrame(0, true);
        } else {
          atlas.clock.playing = false;
          setFrame(atlasCase.durationFrames);
        }
      } else {
        setFrame(nextFrame);
      }
    } else {
      renderer.render(atlas.scene, atlas.camera);
    }
  } else {
    renderer.render(atlas.scene, atlas.camera);
  }

  requestAnimationFrame(animate);
}

loadManualClipPreview();
resize();
renderAtlas(true);
requestAnimationFrame(animate);
