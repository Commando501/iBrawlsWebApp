import * as THREE from 'three';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import {
  buildV3PerformanceSmokeRuntimeReport,
  buildV3PerformanceSmokeScene,
  type V3PerformanceSmokeRuntimeReport,
} from './v3PerformanceSmoke';

const canvas = document.getElementById('smoke-canvas') as HTMLCanvasElement;
const tierSelect = document.getElementById('tier') as HTMLSelectElement;
const summary = document.getElementById('summary') as HTMLSpanElement;
const requestedTier = new URLSearchParams(window.location.search).get('tier');
const initialTier = normalizeV3QualityTier(requestedTier ?? tierSelect.value);
tierSelect.value = initialTier;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

let current = buildV3PerformanceSmokeScene({
  qualityTier: initialTier,
});
let sampleStartMs = 0;
let sampledFrames = 0;
let latestReport: V3PerformanceSmokeRuntimeReport = buildV3PerformanceSmokeRuntimeReport(current);

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  current.camera.aspect = width / height;
  current.camera.updateProjectionMatrix();
}

function publishReport(time?: number) {
  const sample = time !== undefined && sampleStartMs > 0
    ? {
        sampledFrames,
        elapsedMs: Math.max(0, time - sampleStartMs),
      }
    : undefined;
  latestReport = buildV3PerformanceSmokeRuntimeReport(current, sample);
  const status = latestReport.ready
    ? 'Phase 13 Ready'
    : latestReport.runtimeReady
      ? 'Phase 13 Blocked'
      : 'Phase 13 Sampling';
  const fpsLabel = latestReport.sampledFrames > 0
    ? latestReport.averageFps.toFixed(1)
    : 'sampling';
  const frameLabel = latestReport.averageFrameMs > 0
    ? latestReport.averageFrameMs.toFixed(1)
    : 'sampling';
  summary.textContent = `${status} | ${current.qualityTier} | models ${current.budget.modelCount} | parts ${current.budget.partCount} | draw ${current.budget.drawCallEstimate} | fps ${fpsLabel} | frame ${frameLabel}ms`;
  (window as any).__IBRAWLS_V3_PERFORMANCE_SMOKE__ = latestReport;
}

function rebuild() {
  current = buildV3PerformanceSmokeScene({
    qualityTier: normalizeV3QualityTier(tierSelect.value),
  });
  sampleStartMs = 0;
  sampledFrames = 0;
  publishReport();
  resize();
}

tierSelect.addEventListener('change', rebuild);
window.addEventListener('resize', resize);
rebuild();

function frame(time: number) {
  if (sampleStartMs === 0) {
    sampleStartMs = time;
    sampledFrames = 0;
  }
  sampledFrames += 1;
  publishReport(time);
  current.scene.rotation.y = Math.sin(time / 4500) * 0.08;
  renderer.render(current.scene, current.camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
