import * as THREE from 'three';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import { buildV3PerformanceSmokeScene } from './v3PerformanceSmoke';

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

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  current.camera.aspect = width / height;
  current.camera.updateProjectionMatrix();
}

function rebuild() {
  current = buildV3PerformanceSmokeScene({
    qualityTier: normalizeV3QualityTier(tierSelect.value),
  });
  summary.textContent = `${current.qualityTier} | models ${current.budget.modelCount} | parts ${current.budget.partCount} | draw ${current.budget.drawCallEstimate}`;
  resize();
}

tierSelect.addEventListener('change', rebuild);
window.addEventListener('resize', resize);
rebuild();

function frame(time: number) {
  current.scene.rotation.y = Math.sin(time / 4500) * 0.08;
  renderer.render(current.scene, current.camera);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
