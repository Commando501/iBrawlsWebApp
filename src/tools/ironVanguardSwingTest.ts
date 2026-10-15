import "./ironVanguardSwingTest.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import {
  AUTHORED_SWING_TIMING,
  SAVED_SWING_TIMING,
  SWING_PHASES,
  crossedSwingImpacts,
  gameSwingTiming,
  sampleSwing,
  swingDuration,
  timeAtSwingFrame,
  type SwingTiming,
} from "./ironVanguardSwingTiming";

const root = document.querySelector<HTMLDivElement>("#swing-test")!;
root.innerHTML = `
  <header><a href="/">iBrawls</a><span class="divider">/</span><strong>Iron Vanguard</strong><span class="badge">SWING TEST · v018</span></header>
  <main><section class="stage" aria-label="3D swing preview"><div id="viewport"></div>
    <div class="scene-note"><span class="live-dot"></span><span id="load-state" role="status">Loading swing…</span></div>
    <div class="view-buttons" aria-label="Camera views"><button data-view="three">Three-quarter</button><button data-view="front">Front</button><button data-view="side">Side</button></div>
    <div class="scene-hint">Drag to orbit · Scroll to zoom</div>
  </section>
  <aside><p class="eyebrow">PLAYBACK</p><h1>Feel the swing.</h1><p class="description">Test your saved timing, the original motion, or game defaults.</p>
    <div class="presets"><button id="saved" aria-pressed="true">Saved timing</button><button id="authored" aria-pressed="false">Authored</button><button id="game" aria-pressed="false">Game defaults</button></div>
    <div class="phase-status"><span id="phase">Ready</span><strong id="frame-label">Frame 0</strong></div>
    <label class="scrub-label" for="scrub">Scrub animation</label><input id="scrub" aria-label="Animation frame" type="range" min="0" max="70" step="0.1" value="0" disabled>
    <div class="play-buttons"><button id="play" class="primary" disabled>Play swing</button><button id="reset" disabled>Reset</button></div>
    <label class="loop"><input id="loop" type="checkbox"> Loop playback</label>
    <div class="impact-card"><span>IMPACT CUE</span><strong id="impact-time">0.50 s</strong><small>Source frame 34 · <span id="hit-count">0</span> cues fired</small></div>
    <details open><summary>Phase timing</summary><p class="detail-note">Durations in seconds. Poses and shoulder corrections stay together.</p><div class="duration-inputs">${SWING_PHASES.map((name, i) => `<label>${name}<input id="duration-${i}" type="number" min="0.02" max="5" step="0.01" aria-label="${name} duration"></label>`).join("")}</div></details>
    <div class="total"><span>Full cycle</span><strong id="total-time">1.60 s</strong></div>
    <p class="scope-note">Local animation test. The amber marker shows the authored impact position; cues are visual only, not gameplay damage. Neutral review materials.</p>
  </aside></main>`;
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const host = get<HTMLDivElement>("viewport");
const scrub = get<HTMLInputElement>("scrub");
const play = get<HTMLButtonElement>("play");
const loop = get<HTMLInputElement>("loop");
const status = get<HTMLSpanElement>("load-state");
let timing: SwingTiming = [...SAVED_SWING_TIMING];
let elapsed = 0,
  playing = false,
  hitCount = 0,
  pulse = 0;
let mixer: THREE.AnimationMixer | undefined,
  model: THREE.Group | undefined,
  action: THREE.AnimationAction | undefined;
let destroyed = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#111b26");
scene.fog = new THREE.Fog("#111b26", 11, 28);
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(-3.6, 2.6, -4.7);
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (error) {
  status.textContent =
    "WebGL is unavailable. Try a browser with hardware acceleration.";
  throw error;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
host.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.35, 0);
controls.enableDamping = true;
controls.minDistance = 1;
controls.maxDistance = 10;
controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xd5ecff, 0x364557, 2.5));
const key = new THREE.DirectionalLight(0xffe8ce, 3);
key.position.set(-3, 6, -5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x6aaeff, 2);
rim.position.set(4, 3, 3);
scene.add(rim);
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.MeshStandardMaterial({ color: 0x172736, roughness: 0.96 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.006;
scene.add(floor);
const grid = new THREE.GridHelper(16, 32, 0x304b62, 0x20374a);
scene.add(grid);
const markerMaterial = new THREE.MeshBasicMaterial({
  color: 0xf4bd58,
  transparent: true,
  opacity: 0.6,
});
const marker = new THREE.Mesh(
  new THREE.TorusGeometry(0.19, 0.009, 8, 48),
  markerMaterial,
);
marker.visible = false;
scene.add(marker);
const flashMaterial = new THREE.MeshBasicMaterial({
  color: 0xffce77,
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const flash = new THREE.Mesh(
  new THREE.SphereGeometry(0.12, 16, 12),
  flashMaterial,
);
scene.add(flash);
let impactPosition = new THREE.Vector3();
const resize = () => {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
};
const observer = new ResizeObserver(resize);
observer.observe(host);
const updateTimingUI = () => {
  timing.forEach(
    (n, i) =>
      (get<HTMLInputElement>(`duration-${i}`).value = Number(
        n.toFixed(3),
      ).toString()),
  );
  get("impact-time").textContent = `${(timing[0] + timing[1]).toFixed(2)} s`;
  get("total-time").textContent = `${swingDuration(timing).toFixed(2)} s`;
};
const pose = () => {
  const total = swingDuration(timing);
  const local =
    loop.checked && elapsed >= total
      ? elapsed % total
      : Math.min(total, elapsed);
  const sample = sampleSwing(local, timing);
  if (action) {
    action.paused = false;
    action.enabled = true;
  }
  mixer?.setTime(sample.sourceTime);
  model?.updateMatrixWorld(true);
  scrub.value = String(sample.frame);
  get("frame-label").textContent = `Frame ${sample.frame.toFixed(1)}`;
  get("phase").textContent = sample.frame === 0 ? "Ready" : sample.phase;
  renderer.domElement.dataset.frame = sample.frame.toFixed(4);
  return sample;
};
const pause = () => {
  playing = false;
  play.textContent = "Play swing";
};
function chooseTiming(
  next: SwingTiming,
  preset?: "saved" | "authored" | "game",
) {
  const frame = Number(scrub.value);
  pause();
  timing = next;
  elapsed = timeAtSwingFrame(frame, timing);
  pulse = 0;
  get("saved").setAttribute("aria-pressed", String(preset === "saved"));
  get("authored").setAttribute("aria-pressed", String(preset === "authored"));
  get("game").setAttribute("aria-pressed", String(preset === "game"));
  updateTimingUI();
  pose();
}
get("saved").onclick = () => chooseTiming([...SAVED_SWING_TIMING], "saved");
get("authored").onclick = () =>
  chooseTiming([...AUTHORED_SWING_TIMING], "authored");
get("game").onclick = () => chooseTiming(gameSwingTiming(), "game");
for (let i = 0; i < 4; i++)
  get<HTMLInputElement>(`duration-${i}`).onchange = (e) => {
    const input = e.target as HTMLInputElement;
    const value = input.valueAsNumber;
    if (!Number.isFinite(value) || value < 0.02 || value > 5) {
      updateTimingUI();
      return;
    }
    const next = [...timing] as [number, number, number, number];
    next[i] = value;
    chooseTiming(next);
  };
play.onclick = () => {
  if (playing) {
    pause();
    return;
  }
  if (!loop.checked && elapsed >= swingDuration(timing)) elapsed = 0;
  playing = true;
  play.textContent = "Pause";
};
get("reset").onclick = () => {
  pause();
  elapsed = 0;
  hitCount = 0;
  pulse = 0;
  get("hit-count").textContent = "0";
  pose();
};
scrub.oninput = () => {
  pause();
  elapsed = timeAtSwingFrame(scrub.valueAsNumber, timing);
  pulse = 0;
  pose();
};
loop.onchange = () => {
  elapsed = timeAtSwingFrame(Number(scrub.value), timing);
  pose();
};
root.querySelectorAll<HTMLButtonElement>("[data-view]").forEach(
  (button) =>
    (button.onclick = () => {
      const v = button.dataset.view;
      camera.position.set(
        ...((v === "front"
          ? [0, 1.8, -5.8]
          : v === "side"
            ? [-5.8, 1.8, 0]
            : [-3.6, 2.6, -4.7]) as [number, number, number]),
      );
      controls.target.set(0, 1.35, 0);
      controls.update();
    }),
);
const visibility = () => {
  if (document.hidden) pause();
};
document.addEventListener("visibilitychange", visibility);
const lost = (e: Event) => {
  e.preventDefault();
  pause();
  status.textContent = "Graphics context lost. Reload to resume.";
};
renderer.domElement.addEventListener("webglcontextlost", lost);
updateTimingUI();
resize();
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  if (playing && mixer) {
    const before = elapsed;
    elapsed += dt;
    const count = crossedSwingImpacts(before, elapsed, timing, loop.checked);
    if (count) {
      hitCount += count;
      pulse = 0.25;
      get("hit-count").textContent = String(hitCount);
    }
    if (!loop.checked && elapsed >= swingDuration(timing)) {
      elapsed = swingDuration(timing);
      pause();
    }
  }
  pose();
  pulse = Math.max(0, pulse - dt);
  flashMaterial.opacity = (pulse / 0.25) * 0.8;
  flash.scale.setScalar(1 + (1 - pulse / 0.25) * 2);
  markerMaterial.opacity = pulse > 0 ? 1 : 0.5;
  marker.quaternion.copy(camera.quaternion);
  controls.update();
  renderer.render(scene, camera);
});
const disposeModel = (group: THREE.Object3D) =>
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      for (const m of Array.isArray(obj.material)
        ? obj.material
        : [obj.material])
        m.dispose();
    }
  });
new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
  "/assets/iron-vanguard/hammer-v018-review.glb",
  (gltf) => {
    if (destroyed) {
      disposeModel(gltf.scene);
      return;
    }
    try {
      if (gltf.animations.length !== 1)
        throw new Error(
          `Expected one synchronized clip; got ${gltf.animations.length}`,
        );
      const clip = gltf.animations[0];
      if (Math.abs(clip.duration - 70 / 30) > 0.001)
        throw new Error(`Unexpected clip duration ${clip.duration}`);
      model = gltf.scene;
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      action = mixer.clipAction(clip);
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      // Explicit seeking uses the clip's single source clock for bones and morph weights together.
      mixer.setTime(34 / 30);
      model.updateMatrixWorld(true);
      const tip = model.getObjectByName("weapon_hammer_tip");
      if (!tip) throw new Error("Hammer impact reference is missing");
      tip.getWorldPosition(impactPosition);
      marker.position.copy(impactPosition);
      flash.position.copy(impactPosition);
      marker.visible = true;
      mixer.setTime(0);
      action.paused = false;
      pose();
      play.disabled = false;
      get<HTMLButtonElement>("reset").disabled = false;
      scrub.disabled = false;
      status.textContent = "Ready · all animation tracks loaded";
      // Read-only diagnostics support the export and browser smoke checks.
      Object.defineProperty(window, "__ironVanguardReview", {
        configurable: true,
        value: {
          snapshot: () => {
            const skinned: THREE.SkinnedMesh[] = [];
            model!.traverse((o) => {
              if (o instanceof THREE.SkinnedMesh) skinned.push(o);
            });
            const points: Record<string, number[]> = {};
            for (const name of ["weapon_hammer_tip", "LeftHand", "RightHand"]) {
              const o = model!.getObjectByName(name);
              if (o)
                points[name] = o
                  .getWorldPosition(new THREE.Vector3())
                  .toArray();
            }
            return {
              frame: Number(scrub.value),
              playing,
              hitCount,
              timing: [...timing],
              clipDuration: clip.duration,
              points,
              meshes: skinned.map((m) => ({
                name: m.name,
                vertices: m.geometry.attributes.position.count,
                morphCount: m.morphTargetInfluences?.length ?? 0,
                activeMorphs: m.morphTargetInfluences
                  ?.map((weight, index) => ({ weight, index }))
                  .filter((x) => Math.abs(x.weight) > 1e-5),
              })),
              drawCalls: renderer.info.render.calls,
              triangles: renderer.info.render.triangles,
            };
          },
        },
      });
    } catch (error) {
      pause();
      status.textContent = `Cannot play this export: ${String(error)}`;
      console.error(error);
    }
  },
  (xhr) => {
    if (xhr.total)
      status.textContent = `Loading swing… ${Math.round((xhr.loaded / xhr.total) * 100)}%`;
  },
  (error) => {
    status.textContent =
      "Could not load the swing. Check the local asset export.";
    console.error(error);
  },
);
function dispose() {
  destroyed = true;
  renderer.setAnimationLoop(null);
  observer.disconnect();
  document.removeEventListener("visibilitychange", visibility);
  controls.dispose();
  mixer?.stopAllAction();
  if (model) mixer?.uncacheRoot(model);
  disposeModel(scene);
  renderer.dispose();
  delete (window as Window & { __ironVanguardReview?: unknown })
    .__ironVanguardReview;
}
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
