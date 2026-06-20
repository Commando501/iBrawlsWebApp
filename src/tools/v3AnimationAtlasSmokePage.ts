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
} from './v3AnimationAtlasSmoke';

const canvas = document.getElementById('atlas-canvas') as HTMLCanvasElement;
const animationSelect = document.getElementById('animation-select') as HTMLSelectElement;
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
const summary = document.getElementById('summary') as HTMLSpanElement;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

const atlas = buildV3AnimationAtlasScene({
  caseId: 'idle',
  qualityTier: 'desktop',
});

let playAll = false;
let lastTimeMs = 0;
let frameCarry = 0;
let currentDefectReport: V3AnimationAtlasDefectReport | null = null;
let currentDefectSignature: string | null = null;

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
  return modeSelect.value === 'runtimeSimulation' ? 'runtimeSimulation' : 'normalizedReview';
}

function buildDefectSignature(): string {
  return [
    atlas.clock.caseId,
    atlas.clock.mode,
    atlas.qualityTier,
    atlas.v3Options.v3SourceFidelity ?? 'runtimeLod',
    atlas.v3Options.v3QualityTier ?? atlas.qualityTier,
  ].join('|');
}

function ensureDefectReport(): V3AnimationAtlasDefectReport {
  const signature = buildDefectSignature();
  if (!currentDefectReport || currentDefectSignature !== signature) {
    currentDefectReport = analyzeV3AnimationAtlasDefects({
    caseIds: [atlas.clock.caseId],
    mode: atlas.clock.mode,
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
  atlas.camera.top = viewHeight / 2;
  atlas.camera.bottom = -viewHeight / 2;
  atlas.camera.left = -(viewHeight * aspect) / 2;
  atlas.camera.right = (viewHeight * aspect) / 2;
  atlas.camera.updateProjectionMatrix();
}

function publishReport() {
  const atlasCase = currentCase();
  const frameState = createV3AnimationAtlasFrameState(atlas.clock.frame, atlasCase.durationFrames, atlas.clock.fps);
  const sample = sampleV3AnimationAtlasCase(atlasCase.id, frameState, atlas.clock.mode);
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
    viewCount: atlas.views.length,
    visibleWeapon: sample.visibleWeapon,
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
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_SMOKE__ = report;
  (window as any).__IBRAWLS_V3_ANIMATION_ATLAS_DEFECTS__ = defectReport;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_SMOKE__ = report;
  (globalThis as any).__IBRAWLS_V3_ANIMATION_ATLAS_DEFECTS__ = defectReport;
  summary.textContent = `${report.title} | ${report.status} | ${atlasCase.label} | ${atlas.clock.mode} | frame ${atlas.clock.frame}/${atlasCase.durationFrames} | weapon ${sample.visibleWeapon ?? 'hidden'} | views ${atlas.views.length}`;
  defectReportElement.hidden = !showDefectsInput.checked;
  defectReportElement.textContent = showDefectsInput.checked
    ? `${defectSummary}\n${JSON.stringify(ensureDefectReport().summary, null, 2)}`
    : 'Defect Report hidden. Enable Show Defects to measure the selected case.';
}

function syncControls() {
  const atlasCase = currentCase();
  animationSelect.value = atlas.clock.caseId;
  timelineInput.max = String(atlasCase.durationFrames);
  timelineInput.value = String(atlas.clock.frame);
  playPauseButton.textContent = atlas.clock.playing ? 'Pause' : 'Play';
  atlas.clock.loop = loopInput.checked;
  atlas.clock.playbackSpeed = Math.max(0.1, Math.min(4, Number(speedInput.value) || 1));
  publishReport();
}

function renderAtlas(resetDeathBurst = false) {
  updateV3AnimationAtlasScene(atlas, {
    caseId: atlas.clock.caseId,
    frame: atlas.clock.frame,
    mode: currentMode(),
    resetDeathBurst,
    showBounds: boundsOverlayInput.checked,
    showFloorContact: floorOverlayInput.checked,
    showWeaponGripDrift: weaponOverlayInput.checked,
    showUpperLowerIsolation: isolationOverlayInput.checked,
    showSlotContinuity: slotContinuityOverlayInput.checked,
  });
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

animationSelect.addEventListener('change', () => setCase(animationSelect.value as V3AnimationAtlasCaseId));
modeSelect.addEventListener('change', () => renderAtlas(true));
loopInput.addEventListener('change', () => renderAtlas());
boundsOverlayInput.addEventListener('change', () => renderAtlas());
floorOverlayInput.addEventListener('change', () => renderAtlas());
weaponOverlayInput.addEventListener('change', () => renderAtlas());
isolationOverlayInput.addEventListener('change', () => renderAtlas());
slotContinuityOverlayInput.addEventListener('change', () => renderAtlas());
showDefectsInput.addEventListener('change', () => publishReport());
speedInput.addEventListener('change', () => syncControls());
timelineInput.addEventListener('input', () => setFrame(Number(timelineInput.value), atlas.clock.caseId === 'death'));

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

playPauseButton.addEventListener('click', () => {
  atlas.clock.playing = !atlas.clock.playing;
  playAll = false;
  syncControls();
});

playAllButton.addEventListener('click', () => {
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

resize();
renderAtlas(true);
requestAnimationFrame(animate);
