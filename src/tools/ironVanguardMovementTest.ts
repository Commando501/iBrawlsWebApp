import { DEFAULT_ADMIN_SETTINGS } from "../settings/gameplaySettings";
import {
  GRIFBALL_BALL_GRAVITY,
  GRIFBALL_THROW_ARC,
} from "../game/grifballBall";
import {
  createVanguardBallProp,
  VANGUARD_BALL_HANDOFF_START,
  VANGUARD_BALL_HANDOFF_END,
  VANGUARD_BALL_THROW_DURATION,
} from "../components/iron-vanguard/ironVanguardBall";
import {
  createVanguardSwordView,
  animateVanguardSwordView,
  animateVanguardBallView,
} from "../components/iron-vanguard/ironVanguardSwordView";
import {
  attachVanguardSword,
  createVanguardSword,
  preloadVanguardSword,
  createVanguardSwordState,
} from "../components/iron-vanguard/ironVanguardSword";
import "./ironVanguardSwingTest.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  createIronVanguardModel,
  preloadIronVanguard,
  animateIronVanguard,
  disposeIronVanguard,
} from "../components/iron-vanguard/ironVanguardModel";
import {
  VANGUARD_MOVEMENT_CLIPS,
  createVanguardMovementState,
} from "../components/iron-vanguard/ironVanguardMovement";
import { IRON_VANGUARD_MOVEMENT } from "../components/iron-vanguard/ironVanguardMovement.generated";
const labels = (name: string) =>
  name
    .split("-")
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
document.querySelector("#swing-test")!.innerHTML = `
<header><a href="/">iBrawls</a><span class="divider">/</span><strong>Iron Vanguard</strong><span class="badge">MOVEMENT REVIEW</span></header>
<main><section class="stage" aria-label="3D movement preview"><div id="viewport"></div><div class="scene-note"><span class="live-dot"></span><span id="load-state" role="status">Loading…</span></div><div class="view-buttons"><button data-view="three">Three-quarter</button><button data-view="front">Front</button><button data-view="side">Side</button><button id="first-person" data-view="first" hidden>First-person</button></div><div class="scene-hint">Drag to orbit · Scroll to zoom</div></section>
<aside><p class="eyebrow">ANIMATION LIBRARY</p><h1>Move the Vanguard.</h1><p class="description">Review movement on the gameplay model. Weapon timing stays independent of movement. Hammer: 1.60 s. Sword: 0.22 s slash + 0.60 s recovery.</p>
<label class="scrub-label" for="weapon">Weapon</label><select id="weapon" style="width:100%;padding:10px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="hammer">Hammer</option><option value="sword">Sword</option><option value="ball">Ball</option></select><div id="ball-controls" hidden><label class="scrub-label" for="ball-action">Ball action</label><select id="ball-action" style="width:100%;padding:10px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="throw">Charge → football throw</option><option value="punch">Free-hand punch</option></select><div id="throw-controls"><label class="scrub-label" for="throw-hold">Throw hold time <output id="throw-hold-value">1.20 s</output></label><input id="throw-hold" aria-label="Throw hold time" style="width:100%" type="range" min="0" max="2.4" step="0.05" value="1.2"><p class="scope-note" id="throw-charge-status" role="status"></p></div></div><div id="sword-controls" hidden><label class="scrub-label" for="sword-action">Sword action</label><select id="sword-action" style="width:100%;padding:10px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="slash">Slash</option><option value="lunge">Lunge → contact slash</option><option value="lunge-miss">Lunge → miss</option></select><div id="lunge-controls" hidden><label class="scrub-label" for="lunge-duration">Lunge travel time</label><input id="lunge-duration" type="range" min="0.12" max="0.8" step="0.01" value="0.5" style="width:100%"></div></div><label class="scrub-label" for="clip">Animation</label><select id="clip" style="width:100%;padding:12px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="jump-moving">Jump While Moving</option><option value="look-moving">Look While Moving / Turn in Place</option><option value="slide-moving">Slide While Moving</option><option value="slide-sequence">Slide Sequence (in place)</option>${VANGUARD_MOVEMENT_CLIPS.map((n) => `<option value="${n}">${labels(n)}</option>`).join("")}</select>
<div id="travel-controls" hidden style="margin-top:16px">
<label class="scrub-label" for="travel-direction">Travel direction</label><select id="travel-direction" style="width:100%;padding:8px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px">${["forward", "forward-right", "right", "backward-right", "backward", "backward-left", "left", "forward-left"].map((n) => `<option value="${n}">${labels(n)}</option>`).join("")}</select>
<label class="scrub-label" for="travel-speed">Travel speed <output id="travel-speed-value">4.0 m/s</output></label><input id="travel-speed" style="width:100%" type="range" min="0" max="8" step="0.5" value="4">
<label class="scrub-label" for="travel-stance">Movement stance</label><select id="travel-stance" style="width:100%;padding:8px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="normal">Walk / run with speed</option><option value="crouch">Crouched</option></select>
<div id="recovery-controls"><label class="scrub-label" id="recovery-label" for="travel-change">During stand-up</label><select id="travel-change" style="width:100%;padding:8px;background:#102231;color:#e3f2ff;border:1px solid #345066;border-radius:8px"><option value="steady">Keep moving</option><option value="stop">Stop</option><option value="reverse">Reverse direction</option><option value="turn">Turn while moving</option></select>
</div><label class="scrub-label" for="look-yaw">Look direction <output id="look-yaw-value">0°</output></label><input id="look-yaw" style="width:100%" type="range" min="-180" max="180" step="1" value="0">
<label class="scrub-label" for="look-pitch">Look up / down <output id="look-pitch-value">0°</output></label><input id="look-pitch" style="width:100%" type="range" min="-60" max="60" step="1" value="0">
<label class="loop"><input id="look-sweep" type="checkbox"> Sweep look direction</label>
<p class="scope-note">Set travel speed to zero to review turning steps. Looking and travel are independent. Slide torso twist is limited to 60°; the head can turn another 30°.</p>
<p class="scope-note">Uses gameplay movement flags and real travel across the floor. The camera follows. Change direction or speed to check the recovery.</p></div><div class="phase-status"><span id="phase">Idle</span><strong id="time">0.00 s</strong></div><label class="scrub-label" for="scrub">Scrub animation</label><input id="scrub" type="range" min="0" max="1" value="0" step="0.001"><div class="play-buttons"><button id="play" class="primary">Pause</button><button id="reset">Reset</button></div>
<label class="loop"><input id="attack" type="checkbox"> Combine with attack</label><div id="attack-controls" hidden><label class="scrub-label" for="attack-scrub">Scrub attack</label><output id="attack-time" style="font-size:12px;color:#91c9f5">0.00 s</output><input id="attack-scrub" style="width:100%" type="range" min="0" max="1.6" step="0.001" value="0"></div><label class="scrub-label" for="speed">Playback speed (whole preview)</label><input id="speed" type="range" min="0.25" max="1.5" value="1" step="0.25">
<p class="scope-note">${VANGUARD_MOVEMENT_CLIPS.length} baked movement clips. Jump While Moving and Slide While Moving test takeoff, recovery, and continued travel. Jump looking and weapon attacks can be combined. Slide Sequence samples the baked poses in place. Check foot contact, knee clearance, and grip stability from each view. Sword uses the approved hold/idle, a sweeping cut across the body, and a low forward lunge that holds its thrust during travel. Contact flows into the cross slash; a miss pulls back to guard. In first person, the slash sweeps from right to left across the view; the lunge extends straight ahead. First-person review uses the local player’s slash clock; other views use the bot clock. Ball: tucked right-arm carry, football-style wind-up, release and follow-through, and a free-hand punch. Combine these with movement to check the grip. Pistol actions still need their own animation pass.</p><p><a href="/iron-vanguard-swing-test.html" style="color:#91c9f5">Open hammer timing test →</a></p></aside></main>`;
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const host = get<HTMLDivElement>("viewport"),
  select = get<HTMLSelectElement>("clip"),
  scrub = get<HTMLInputElement>("scrub");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#111b26");
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 100);
camera.position.set(-3, 2.3, -4.2);
const firstCamera = new THREE.PerspectiveCamera(75, 1, 0.01, 100);
firstCamera.rotation.order = "YXZ";
scene.add(firstCamera);
let firstPerson = new URLSearchParams(location.search).get("view") === "first";
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
host.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xd5ecff, 0x364557, 2.5));
for (const [color, intensity, x, y, z] of [
  [0xffe8ce, 3, -3, 6, -5],
  [0x6aaeff, 2, 4, 3, 3],
]) {
  const light = new THREE.DirectionalLight(color, intensity);
  light.position.set(x, y, z);
  if (x < 0) {
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, {
      left: -3,
      right: 3,
      top: 3,
      bottom: -3,
      near: 0.1,
      far: 20,
    });
    light.shadow.normalBias = 0.015;
  }
  scene.add(light);
}
scene.add(new THREE.GridHelper(100, 200, 0x304b62, 0x20374a));
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshStandardMaterial({ color: 0x172736, roughness: 0.96 }),
);
floor.receiveShadow = true;
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.006;
scene.add(floor);
const resize = new ResizeObserver(() => {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  firstCamera.aspect = camera.aspect;
  firstCamera.updateProjectionMatrix();
});
resize.observe(host);
let model: THREE.Group | undefined,
  sword: THREE.Group | undefined,
  swordView: THREE.Group | undefined,
  elapsed = 0,
  attackElapsed = 0,
  playing = true,
  destroyed = false;
const weapon = get<HTMLSelectElement>("weapon");
weapon.value = ["sword", "ball"].includes(
  new URLSearchParams(location.search).get("weapon") ?? "",
)
  ? new URLSearchParams(location.search).get("weapon")!
  : "hammer";
const isLungePreview = () =>
  weapon.value === "sword" &&
  get<HTMLSelectElement>("sword-action").value.startsWith("lunge");
const lungeDuration = () => +get<HTMLInputElement>("lunge-duration").value;
const fullThrowChargeTime = DEFAULT_ADMIN_SETTINGS.grifballChargeMax ?? 1.2;
const throwHold = get<HTMLInputElement>("throw-hold");
throwHold.max = String(fullThrowChargeTime * 2);
throwHold.value = String(fullThrowChargeTime);
const throwHoldTime = () => +throwHold.value;
const attackDuration = () =>
  weapon.value === "sword"
    ? isLungePreview()
      ? lungeDuration() + 0.82
      : 0.82
    : weapon.value === "ball"
      ? get<HTMLSelectElement>("ball-action").value === "throw"
        ? throwHoldTime() + VANGUARD_BALL_THROW_DURATION + 0.4
        : 0.86
      : 1.6;
weapon.onchange = () => {
  resetSwordPreview();
  attackElapsed = 0;
  get("first-person").hidden = weapon.value === "hammer";
  if (weapon.value === "hammer") firstPerson = false;
  get("sword-controls").hidden = weapon.value !== "sword";
  get("ball-controls").hidden = weapon.value !== "ball";
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
};
weapon.onchange(new Event("change"));
const requestedClip = new URLSearchParams(location.search).get("clip");
if (
  requestedClip &&
  (requestedClip === "jump-moving" ||
    requestedClip === "look-moving" ||
    requestedClip === "slide-moving" ||
    requestedClip === "slide-sequence" ||
    VANGUARD_MOVEMENT_CLIPS.includes(requestedClip))
)
  select.value = requestedClip;
if (requestedClip === "look-moving")
  get<HTMLInputElement>("look-sweep").checked = true;
const sequence = [
  {
    clip: "slide-enter",
    duration: IRON_VANGUARD_MOVEMENT.clips["slide-enter"].duration,
  },
  { clip: "slide", duration: 1.2 },
  {
    clip: "slide-exit",
    duration: IRON_VANGUARD_MOVEMENT.clips["slide-exit"].duration,
  },
  { clip: "idle", duration: 0.35 },
];
const sequenceDuration = sequence.reduce(
  (sum, phase) => sum + phase.duration,
  0,
);
const duration = () =>
  select.value === "jump-moving"
    ? 3.2
    : select.value === "look-moving"
      ? 6.4
      : select.value === "slide-moving"
        ? 3.2
        : select.value === "slide-sequence"
          ? sequenceDuration
          : IRON_VANGUARD_MOVEMENT.clips[select.value].duration;
const previewSample = () => {
  if (select.value !== "slide-sequence")
    return { clip: select.value, time: elapsed };
  let time = elapsed;
  for (const phase of sequence) {
    if (time < phase.duration) return { clip: phase.clip, time };
    time -= phase.duration;
  }
  return { clip: "idle", time: 0 };
};
const movingPreview = () =>
  ["jump-moving", "slide-moving", "look-moving"].includes(select.value);
const moveCamera = (delta: THREE.Vector3) => {
  camera.position.add(delta);
  firstCamera.position.add(delta);
  controls.target.add(delta);
  for (const object of scene.children)
    if (object instanceof THREE.DirectionalLight) {
      object.position.add(delta);
      object.target.position.add(delta);
      object.target.updateMatrixWorld();
    }
};
function resetSwordPreview() {
  for (const root of [model, swordView])
    if (root?.userData.ironVanguard)
      root.userData.ironVanguard.sword = createVanguardSwordState();
}
get<HTMLSelectElement>("sword-action").onchange = () => {
  resetSwordPreview();
  resetMovement();
  attackElapsed = 0;
  get("lunge-controls").hidden = !isLungePreview();
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
};
get<HTMLInputElement>("lunge-duration").oninput = () => {
  resetSwordPreview();
  resetMovement();
  attackElapsed = 0;
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
};
const resetMovement = () => {
  if (!model) return;
  moveCamera(model.position.clone().negate());
  model.position.set(0, 0, 0);
  model.rotation.y = 0;
  model.userData.ironVanguard.movement = createVanguardMovementState();
  resetSwordPreview();
};
select.onchange = () => {
  elapsed = 0;
  resetMovement();
  get("travel-controls").hidden = !movingPreview();
  get("recovery-controls").hidden = select.value === "look-moving";
  get("recovery-label").textContent =
    select.value === "jump-moving" ? "After landing" : "During stand-up";
  scrub.max = String(duration());
  get("phase").textContent = labels(select.value);
  controls.target.y = select.value === "slide" ? 0.65 : 0.9;
};
select.onchange(new Event("change"));
get<HTMLSelectElement>("ball-action").onchange = () => {
  get("throw-controls").hidden =
    get<HTMLSelectElement>("ball-action").value !== "throw";
  attackElapsed = 0;
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
};
throwHold.oninput = () => {
  get("throw-hold-value").textContent = `${throwHoldTime().toFixed(2)} s`;
  attackElapsed = 0;
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
};
throwHold.oninput(new Event("input"));
const requestedAction = new URLSearchParams(location.search).get("action");
if (
  weapon.value === "ball" &&
  ["throw", "punch"].includes(requestedAction ?? "")
) {
  get<HTMLSelectElement>("ball-action").value = requestedAction!;
  get<HTMLSelectElement>("ball-action").onchange!(new Event("change"));
  get<HTMLInputElement>("attack").checked = true;
  get("attack-controls").hidden = false;
  get<HTMLInputElement>("attack-scrub").max = String(attackDuration());
}
if (
  weapon.value === "sword" &&
  ["lunge", "lunge-miss"].includes(requestedAction ?? "")
) {
  get<HTMLSelectElement>("sword-action").value = requestedAction!;
  get<HTMLInputElement>("attack").checked = true;
  get("attack-controls").hidden = false;
  get<HTMLSelectElement>("sword-action").onchange!(new Event("change"));
}

get("play").onclick = () => {
  playing = !playing;
  get("play").textContent = playing ? "Pause" : "Play";
};
get("reset").onclick = () => {
  resetMovement();
  elapsed = 0;
  attackElapsed = 0;
};
scrub.oninput = () => {
  const destination = +scrub.value;
  if (movingPreview()) {
    resetMovement();
    elapsed = 0;
    while (elapsed < destination - 1e-6) {
      const dt = Math.min(1 / 60, destination - elapsed);
      elapsed += dt;
      animatePreview(dt, attackElapsed - destination + elapsed);
    }
  }
  elapsed = destination;
  playing = false;
  get("play").textContent = "Play";
};
get<HTMLInputElement>("attack").onchange = () => {
  resetSwordPreview();
  get("attack-controls").hidden = !get<HTMLInputElement>("attack").checked;
};
get<HTMLInputElement>("attack-scrub").oninput = () => {
  attackElapsed = +get<HTMLInputElement>("attack-scrub").value;
  playing = false;
  get("play").textContent = "Play";
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-view]",
))
  button.onclick = () => {
    const view = button.dataset.view;
    firstPerson = view === "first";
    if (firstPerson) return;
    camera.position.set(
      ...((view === "front"
        ? [0, 1.4, -5]
        : view === "side"
          ? [-5, 1.4, 0]
          : [-3, 2.3, -4.2]) as [number, number, number]),
    );
    const offset = model?.position ?? new THREE.Vector3();
    camera.position.add(offset);
    controls.target.set(
      offset.x,
      offset.y + (select.value === "slide" ? 0.65 : 0.9),
      offset.z,
    );
    controls.update();
  };
Promise.all([preloadIronVanguard(), preloadVanguardSword()])
  .then(([source, swordSource]) => {
    if (destroyed) return;
    model = createIronVanguardModel(200, false, source);
    model.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    sword = createVanguardSword(swordSource);
    attachVanguardSword(model, sword);
    scene.add(model);
    swordView = createVanguardSwordView(200, source, swordSource);
    firstCamera.add(swordView);
    swordView.visible = false;
    get("load-state").textContent =
      `${VANGUARD_MOVEMENT_CLIPS.length} movement clips · gameplay mesh`;
  })
  .catch((e) => (get("load-state").textContent = String(e)));
const settings = {
  hammerSlamWindupTime: 0.3,
  hammerSlamAttackTime: 0.2,
  hammerReloadTime: 1.1,
  swordSlashSpeed: 0.22,
  swordSlashReload: 0.6,
};
const previewBallFlight = createVanguardBallProp();
scene.add(previewBallFlight);
function animatePreview(dt: number, attackTime = attackElapsed) {
  if (!model) return;
  const attack = get<HTMLInputElement>("attack").checked;
  const cycle = attackDuration();
  const t =
    attackTime >= 0 && attackTime < cycle
      ? attackTime
      : ((attackTime % cycle) + cycle) % cycle;
  const activeWeapon = weapon.value;
  if (sword) sword.visible = activeWeapon === "sword";
  const isLunging =
    activeWeapon === "sword" &&
    attack &&
    isLungePreview() &&
    t < lungeDuration();
  const lungePreview =
    activeWeapon === "sword" && attack && isLungePreview()
      ? {
          lungeTime: Math.min(t, lungeDuration()),
          lungeReleaseTime: isLunging ? undefined : t - lungeDuration(),
          lungeHit: get<HTMLSelectElement>("sword-action").value === "lunge",
        }
      : {};
  const ballThrow =
    activeWeapon === "ball" &&
    attack &&
    get<HTMLSelectElement>("ball-action").value === "throw";
  const holdTime = throwHoldTime();
  const releaseCharge = Math.min(1, holdTime / fullThrowChargeTime);
  const ballPreview = {
    ballCharge:
      ballThrow && t < holdTime ? Math.min(1, t / fullThrowChargeTime) : 0,
    ballReleaseCharge: releaseCharge,
    ballThrowTime:
      ballThrow && t >= holdTime && t < holdTime + VANGUARD_BALL_THROW_DURATION
        ? t - holdTime
        : undefined,
  };
  const shownCharge = t < holdTime ? ballPreview.ballCharge : releaseCharge;
  get("throw-charge-status").textContent = ballThrow
    ? `${t < holdTime ? "Winding up" : "Released"}: ${Math.round(shownCharge * 100)}% charge. Full strength at ${fullThrowChargeTime.toFixed(2)} s; holding longer keeps it fully loaded.`
    : `Full strength at ${fullThrowChargeTime.toFixed(2)} s. Enable Combine with attack to review.`;
  const windup =
    activeWeapon === "ball" ? 0.24 : activeWeapon === "sword" ? 0.11 : 0.3;
  const impact =
    activeWeapon === "ball" ? 0.36 : activeWeapon === "sword" ? 0.22 : 0.5;
  let weaponState =
    !attack || (activeWeapon === "sword" && isLungePreview())
      ? "ready"
      : t < windup
        ? "swing_up"
        : t < impact
          ? "swing_down"
          : "recovering";
  let weaponTimer = !attack
    ? 0
    : t < windup
      ? t
      : t < impact
        ? t - windup
        : t - impact;
  if (
    firstPerson &&
    activeWeapon === "sword" &&
    attack &&
    get<HTMLSelectElement>("sword-action").value === "slash"
  ) {
    weaponState = t < 0.22 ? "slashing" : "recovering";
    weaponTimer = t < 0.22 ? t : t - 0.22;
  }
  if (ballThrow) {
    weaponState = "ready";
    weaponTimer = 0;
  }
  if (swordView) {
    swordView.visible = firstPerson && activeWeapon !== "hammer";
    if (swordView.visible && activeWeapon === "ball")
      animateVanguardBallView(swordView, {
        dt,
        weaponState,
        weaponTimer,
        ...ballPreview,
        settings,
      });
    if (swordView.visible && activeWeapon === "sword")
      animateVanguardSwordView(swordView, {
        dt,
        weaponState,
        weaponTimer,
        isLunging,
        ...lungePreview,
        settings,
        ...(playing ? {} : { previewTime: elapsed }),
      });
  }
  model.visible = !firstPerson;
  if (movingPreview()) {
    const direction = get<HTMLSelectElement>("travel-direction").value;
    const speed = +get<HTMLInputElement>("travel-speed").value;
    const vel = new THREE.Vector3(
      direction.includes("left") ? -1 : direction.includes("right") ? 1 : 0,
      0,
      direction.includes("forward")
        ? -1
        : direction.includes("backward")
          ? 1
          : 0,
    )
      .normalize()
      .multiplyScalar(speed);
    const change =
      select.value !== "look-moving"
        ? get<HTMLSelectElement>("travel-change").value
        : "steady";
    const jumping = select.value === "jump-moving";
    const takeoff = 0.45,
      launchSpeed = 8,
      gravity = 18;
    const touchdown = takeoff + (2 * launchSpeed) / gravity;
    const flightTime = elapsed - takeoff;
    const airborne = jumping && elapsed >= takeoff && elapsed < touchdown;
    const changeStart = jumping ? touchdown + 0.04 : 1.43;
    const changeProgress = THREE.MathUtils.smoothstep(
      elapsed,
      changeStart,
      changeStart + 0.19,
    );
    if (change === "stop") vel.multiplyScalar(1 - changeProgress);
    if (change === "reverse") vel.multiplyScalar(1 - 2 * changeProgress);
    const lookYaw = THREE.MathUtils.degToRad(
      +get<HTMLInputElement>("look-yaw").value,
    );
    const sweep = get<HTMLInputElement>("look-sweep").checked
      ? Math.sin((elapsed * Math.PI) / 3.2) * Math.PI
      : 0;
    model.rotation.y =
      lookYaw +
      sweep +
      (change === "turn" ? Math.PI * 0.5 * changeProgress : 0);
    const displacement = vel.clone().multiplyScalar(dt);
    if (jumping) {
      const height = airborne
        ? launchSpeed * flightTime - 0.5 * gravity * flightTime ** 2
        : 0;
      displacement.y = height - model.position.y;
      vel.y = airborne ? launchSpeed - gravity * flightTime : 0;
    }
    model.position.add(displacement);
    moveCamera(displacement);
    animateIronVanguard(model, {
      dt,
      activeWeapon,
      isLunging,
      ...lungePreview,
      ...ballPreview,
      localRecovery: firstPerson,
      weaponState,
      weaponTimer,
      settings,
      vel,
      yaw: model.rotation.y,
      lookPitch: THREE.MathUtils.degToRad(
        +get<HTMLInputElement>("look-pitch").value,
      ),
      isJumping: airborne,
      isCrouching: get<HTMLSelectElement>("travel-stance").value === "crouch",
      isSliding:
        select.value === "slide-moving" && elapsed >= 0.35 && elapsed < 1.35,
    });
  } else {
    const preview = previewSample();
    if (attack && isLungePreview()) {
      const next = new THREE.Vector3(0, 0, -24 * Math.min(t, lungeDuration()));
      moveCamera(next.clone().sub(model.position));
      model.position.copy(next);
    }
    animateIronVanguard(model, {
      dt,
      activeWeapon,
      isLunging,
      ...lungePreview,
      ...ballPreview,
      localRecovery: firstPerson,
      weaponState,
      weaponTimer,
      settings,
      vel: isLunging ? new THREE.Vector3(0, 0, -24) : undefined,
      previewClip: preview.clip,
      previewTime: preview.time,
    });
  }
  previewBallFlight.visible = ballThrow && t >= holdTime;
  if (previewBallFlight.visible) {
    const actor = firstPerson ? swordView : model;
    const prop = actor?.userData.ironVanguard.ball;
    if (prop) {
      prop.visible = false;
      const flight = t - holdTime;
      const passSpeed = THREE.MathUtils.lerp(
        DEFAULT_ADMIN_SETTINGS.grifballPassSpeedMin ?? 9,
        DEFAULT_ADMIN_SETTINGS.grifballPassSpeedMax ?? 26,
        releaseCharge,
      );
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
        actor!.getWorldQuaternion(new THREE.Quaternion()),
      );
      const chest = actor!.userData.ironVanguard.bones.Spine as THREE.Object3D;
      const origin = chest
        .getWorldPosition(new THREE.Vector3())
        .add(
          new THREE.Vector3(0.22, 0.12, -0.4).applyQuaternion(
            actor!.getWorldQuaternion(new THREE.Quaternion()),
          ),
        );
      previewBallFlight.position
        .copy(origin)
        .addScaledVector(direction, flight * passSpeed);
      previewBallFlight.position.y +=
        passSpeed * GRIFBALL_THROW_ARC * flight -
        0.5 * GRIFBALL_BALL_GRAVITY * flight * flight;
      const handoff =
        1 -
        THREE.MathUtils.smoothstep(
          flight,
          VANGUARD_BALL_HANDOFF_START,
          VANGUARD_BALL_HANDOFF_END,
        );
      previewBallFlight.position.lerp(
        prop.getWorldPosition(new THREE.Vector3()),
        handoff,
      );
      previewBallFlight.quaternion
        .copy(actor!.getWorldQuaternion(new THREE.Quaternion()))
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            Math.PI,
          ),
        )
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(1, 0, 0),
            -flight * 4,
          ),
        )
        .slerp(prop.getWorldQuaternion(new THREE.Quaternion()), handoff);
    }
  }
}
get<HTMLInputElement>("travel-speed").oninput = () => {
  get("travel-speed-value").textContent =
    (+get<HTMLInputElement>("travel-speed").value).toFixed(1) + " m/s";
};
for (const id of ["look-yaw", "look-pitch"])
  get<HTMLInputElement>(id).oninput = () => {
    get(id + "-value").textContent = get<HTMLInputElement>(id).value + "°";
  };
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt =
    Math.min(0.1, (now - last) / 1000) * +get<HTMLInputElement>("speed").value;
  last = now;
  if (playing && model) {
    // Fixed-size simulation steps make the planted foot and scrub replay comparable.
    let remaining = dt;
    while (remaining > 1e-6) {
      const step = Math.min(1 / 60, remaining);
      elapsed += step;
      attackElapsed = (attackElapsed + step) % attackDuration();
      if (elapsed >= duration()) {
        elapsed %= duration();
        resetMovement();
      }
      animatePreview(step);
      remaining -= step;
    }
  } else animatePreview(0);
  const clip = movingPreview()
    ? (model?.userData.ironVanguardMovement ?? "idle")
    : previewSample().clip;
  scrub.value = String(elapsed);
  get<HTMLInputElement>("attack-scrub").value = String(attackElapsed);
  get("attack-time").textContent =
    attackElapsed.toFixed(2) + " / " + attackDuration().toFixed(2) + " s";
  get("phase").textContent = labels(clip);
  get("time").textContent = elapsed.toFixed(2) + " s";
  renderer.domElement.dataset.weapon = weapon.value;
  renderer.domElement.dataset.weaponPhase =
    (weapon.value === "ball"
      ? model?.userData.ironVanguardBallPhase
      : model?.userData.ironVanguardSwordPhase) ?? "hammer";
  renderer.domElement.dataset.clip = clip;
  renderer.domElement.dataset.attackTime = attackElapsed.toFixed(4);
  renderer.domElement.dataset.travel = JSON.stringify(
    model?.position.toArray() ?? [0, 0, 0],
  );
  renderer.domElement.dataset.recoveryBlend = String(
    model?.userData.ironVanguardRecoveryBlend ?? 0,
  );
  renderer.domElement.dataset.landingBlend = String(
    model?.userData.ironVanguardLandingBlend ?? 0,
  );
  renderer.domElement.dataset.supportPlanted = String(
    model?.userData.ironVanguardSupportPlanted ?? false,
  );
  renderer.domElement.dataset.bodyYaw = String(
    model?.userData.ironVanguardBodyYaw ?? 0,
  );
  renderer.domElement.dataset.turnStep = String(
    model?.userData.ironVanguardTurnStep ?? false,
  );
  renderer.domElement.dataset.lookPitch =
    get<HTMLInputElement>("look-pitch").value;
  controls.enabled = !firstPerson;
  if (firstPerson) {
    firstCamera.position
      .copy(model?.position ?? new THREE.Vector3())
      .add(new THREE.Vector3(0, 1.6, 0));
    firstCamera.rotation.set(
      movingPreview()
        ? THREE.MathUtils.degToRad(+get<HTMLInputElement>("look-pitch").value)
        : 0,
      model?.rotation.y ?? 0,
      0,
      "YXZ",
    );
  } else controls.update();
  renderer.domElement.dataset.view = firstPerson
    ? "first-person"
    : "third-person";
  document.querySelector(".scene-hint")!.textContent = firstPerson
    ? `${weapon.value === "ball" ? "Ball" : "Sword"} and arms · local player view`
    : "Drag to orbit · Scroll to zoom";
  renderer.render(scene, firstPerson ? firstCamera : camera);
});
window.addEventListener("pagehide", () => {
  destroyed = true;
  renderer.setAnimationLoop(null);
  resize.disconnect();
  controls.dispose();
  if (model) disposeIronVanguard(model);
  if (swordView) disposeIronVanguard(swordView);
  previewBallFlight.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    materials.forEach((material) => material.dispose());
  });
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  renderer.dispose();
});
