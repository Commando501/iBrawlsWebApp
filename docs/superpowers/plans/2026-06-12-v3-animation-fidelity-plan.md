# V3 Animation Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade V3 from functional layered motion to expressive, deterministic procedural animation in third person, first person, replay, observer, and editor preview paths.

**Architecture:** Add a pure V3 animation profile module that owns shared pose curves for first-person weapons, third-person weapon meshes, upper-body weapon layers, recoil, lunge, breathing, hit reaction, and locomotion accents. Route the existing V3 runtime and editor seeds through those shared profiles so procedural animation remains authoritative while the editor can refine key pose presets. Keep every change visual-only and gated behind V3 model-system checks or backward-compatible optional parameters.

**Tech Stack:** TypeScript, Three.js group transforms, Node test runner with `tsx`, existing combatant rig and V3 model builder modules, existing animation editor core/export helpers, existing replay/observer visual runtime.

---

## Scope And Guardrails

- Do not change hitboxes, collision, weapon reach, weapon timing, scoring, AI decisions, replay time, or network authority.
- Do not change V1 or V2 animation behavior.
- Do not add random pose changes; V3 procedural animation must be deterministic for replay and smoke checks.
- Preserve the body-mask principle: locomotion drives lower body, weapon actions drive upper body, additive details can affect upper body/head without mutating gameplay.
- Keep mobile and remote throttling behavior intact. New additive phases must advance only on consumed animation frames.
- Keep first-person and third-person weapon poses synchronized through shared profile functions instead of duplicate hardcoded curves.
- Keep editor exports as refinement data. Do not make exported editor JSON replace the procedural runtime.

## Planned Files

- Create `src/components/grifball/v3AnimationFidelity.ts`
- Create `src/components/grifball/v3AnimationFidelity.test.ts`
- Modify `src/components/grifball/combatantAnimationV3.ts`
- Modify `src/components/grifball/combatantAnimationV3.test.ts`
- Modify `src/components/grifball/combatantAnimation.ts`
- Modify `src/components/grifball/visualUpdateCallbacks.ts`
- Modify `src/components/grifball/replayPlaybackVisuals.ts`
- Modify `src/components/grifball/replayPlaybackRuntime.ts`
- Modify `src/components/grifball/replayPlaybackRuntime.test.ts`
- Modify `src/components/grifball/localPlayerViewRuntime.ts`
- Modify `src/components/grifball/localPlayerViewRuntime.test.ts`
- Create `src/components/grifball/playerWeaponAnimationV3.test.ts`
- Modify `src/components/grifball/playerHammerAnimationRuntime.ts`
- Modify `src/components/grifball/playerSwordAnimationRuntime.ts`
- Modify `src/components/grifball/playerPistolAnimationRuntime.ts`
- Modify `src/tools/animationEditor.ts`
- Modify `src/tools/animationEditorCore.ts`
- Modify `src/tools/animationEditorCore.test.ts`
- Modify `package.json`
- Modify `README.md`

---

## Task 1: Shared V3 Animation Profile Contracts

**Files:**
- Create: `src/components/grifball/v3AnimationFidelity.ts`
- Create: `src/components/grifball/v3AnimationFidelity.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing shared profile tests**

Create `src/components/grifball/v3AnimationFidelity.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  V3_ANIMATION_PROFILE_VERSION,
  getV3AnimationTrackDefinition,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
} from './v3AnimationFidelity';

const finiteTuple = (tuple: readonly number[]) => tuple.every(Number.isFinite);

describe('V3 animation fidelity profiles', () => {
  it('declares a stable profile version and known editor track ids', () => {
    assert.equal(V3_ANIMATION_PROFILE_VERSION, 1);
    assert.equal(getV3AnimationTrackDefinition('hammer_windup').weapon, 'hammer');
    assert.equal(getV3AnimationTrackDefinition('sword_lunge').weapon, 'sword');
    assert.equal(getV3AnimationTrackDefinition('pistol_fire').weapon, 'pistol');
  });

  it('samples synchronized first-person and third-person pistol recoil curves', () => {
    const firstPerson = sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const thirdPerson = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: {},
    });
    const recovered = sampleV3ThirdPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0.18,
      isLunging: false,
      settings: {},
    });

    assert.equal(finiteTuple(firstPerson.position), true);
    assert.equal(finiteTuple(firstPerson.rotation), true);
    assert.equal(firstPerson.rotation[0] < -0.1, true);
    assert.equal(thirdPerson.rotation[0] < recovered.rotation[0], true);
    assert.equal(thirdPerson.position[2] > recovered.position[2], true);
  });

  it('samples expressive upper-body poses without lower-body data', () => {
    const hammer = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.2,
      isLunging: false,
      settings: { hammerSlamWindupTime: 0.45, hammerSlamAttackTime: 0.3 },
    });
    const sword = sampleV3UpperBodyWeaponPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.08,
      isLunging: true,
      settings: {},
    });

    assert.equal(hammer.rightArmRotation[0] < -0.8, true);
    assert.equal(hammer.leftArmRotation[0] < -0.45, true);
    assert.equal(Math.abs(hammer.headRotation[1]) > 0.02, true);
    assert.equal(sword.upperTorsoRotation[0] > 0.1, true);
    assert.equal(sword.rightArmRotation[0] < -0.6, true);
  });
});
```

- [ ] **Step 2: Run the shared profile test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/v3AnimationFidelity.test.ts
```

Expected: FAIL because `v3AnimationFidelity.ts` does not exist.

- [ ] **Step 3: Implement the shared profile module**

Create `src/components/grifball/v3AnimationFidelity.ts` with these exports:

```ts
import * as THREE from 'three';
import {
  DEFAULT_HAMMER_SLAM_ATTACK_TIME,
  DEFAULT_HAMMER_SLAM_WINDUP_TIME,
  resolveHammerSlamTiming,
} from '../../game/hammerSlamTiming';
import type { UniversalSettings } from '../../types';
import type { WeaponPose } from './attackAnimationPresets';

export const V3_ANIMATION_PROFILE_VERSION = 1;

export type V3AnimationWeaponId = 'hammer' | 'sword' | 'pistol';
export type V3AnimationTrackId =
  | 'hammer_windup'
  | 'hammer_strike'
  | 'hammer_recover'
  | 'hammer_melee'
  | 'hammer_melee_recover'
  | 'sword_lunge'
  | 'sword_slash'
  | 'sword_recover'
  | 'pistol_fire'
  | 'pistol_recover';

export interface V3AnimationTrackDefinition {
  id: V3AnimationTrackId;
  label: string;
  weapon: V3AnimationWeaponId;
  defaultDuration: number;
}

export interface V3WeaponPoseSampleInput {
  activeWeapon: V3AnimationWeaponId;
  weaponState: string;
  weaponTimer: number;
  isLunging: boolean;
  settings: Partial<UniversalSettings>;
}

export interface V3UpperBodyPose {
  upperTorsoRotation: THREE.Vector3Tuple;
  headRotation: THREE.Vector3Tuple;
  leftArmRotation: THREE.Vector3Tuple;
  rightArmRotation: THREE.Vector3Tuple;
}
```

Add deterministic helpers in the same file:

```ts
export const V3_ANIMATION_TRACKS: readonly V3AnimationTrackDefinition[] = [
  { id: 'hammer_windup', label: 'Hammer windup', weapon: 'hammer', defaultDuration: DEFAULT_HAMMER_SLAM_WINDUP_TIME },
  { id: 'hammer_strike', label: 'Hammer strike', weapon: 'hammer', defaultDuration: DEFAULT_HAMMER_SLAM_ATTACK_TIME },
  { id: 'hammer_recover', label: 'Hammer recover', weapon: 'hammer', defaultDuration: 0.6 },
  { id: 'hammer_melee', label: 'Hammer melee swing', weapon: 'hammer', defaultDuration: 0.24 },
  { id: 'hammer_melee_recover', label: 'Hammer melee recover', weapon: 'hammer', defaultDuration: 0.5 },
  { id: 'sword_lunge', label: 'Sword lunge', weapon: 'sword', defaultDuration: 0.18 },
  { id: 'sword_slash', label: 'Sword slash', weapon: 'sword', defaultDuration: 0.22 },
  { id: 'sword_recover', label: 'Sword recover', weapon: 'sword', defaultDuration: 0.6 },
  { id: 'pistol_fire', label: 'Pistol fire', weapon: 'pistol', defaultDuration: 0.18 },
  { id: 'pistol_recover', label: 'Pistol recover', weapon: 'pistol', defaultDuration: 0.18 },
];

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
export const easeOutCubic = (value: number): number => {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
};
export const easeInOutCubic = (value: number): number => {
  const t = clamp01(value);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export function getV3AnimationTrackDefinition(id: V3AnimationTrackId): V3AnimationTrackDefinition {
  const track = V3_ANIMATION_TRACKS.find((candidate) => candidate.id === id);
  if (!track) throw new Error(`Unknown V3 animation track: ${id}`);
  return track;
}
```

Implement:

```ts
export function sampleV3FirstPersonWeaponPose(input: V3WeaponPoseSampleInput): WeaponPose;
export function sampleV3ThirdPersonWeaponPose(input: V3WeaponPoseSampleInput): WeaponPose;
export function sampleV3UpperBodyWeaponPose(input: V3WeaponPoseSampleInput): V3UpperBodyPose;
```

Use the existing values from `combatantAnimationV3.ts` as the starting curves, then add the Phase 11 expressive details:

- Hammer windup: head anticipates toward the strike side, offhand follows the grip, upper torso has a small counter-roll.
- Hammer strike: stronger torso follow-through with recovery back toward neutral.
- Sword lunge: forward torso pitch, right-arm extension, left-arm counterbalance, first-person blade pushes forward.
- Sword slash: torso yaw sweep plus first-person blade edge sweep.
- Pistol fire: recoil decays from `weaponTimer / 0.18`, with first-person muzzle rise and third-person right-arm recoil.

- [ ] **Step 4: Add the new test file to `npm test`**

Add `src/components/grifball/v3AnimationFidelity.test.ts` immediately before `src/components/grifball/combatantAnimationV3.test.ts` in `package.json`.

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/components/grifball/v3AnimationFidelity.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
```

Expected: exits 0.

- [ ] **Step 5: Run focused Task 1 tests**

Run:

```powershell
node --import tsx --test src/components/grifball/v3AnimationFidelity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add src/components/grifball/v3AnimationFidelity.ts src/components/grifball/v3AnimationFidelity.test.ts package.json
git commit -m "feat: add v3 animation fidelity profiles"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: Route V3 Runtime Through Shared Pose Profiles

**Files:**
- Modify: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`

- [ ] **Step 1: Write failing runtime profile tests**

Add tests to `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
it('uses shared V3 sword lunge body profile while locomotion remains active', () => {
  const model = createV3Model();
  const refs = createInitialGrifballThreeRefs();

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(3, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'sword',
    weaponState: 'ready',
    weaponTimer: 0.08,
    isLunging: true,
    dt: 1,
    settings: {},
  });

  assert.equal(model.userData.upperTorso.rotation.x > 0.1, true);
  assert.equal(model.userData.rightArm.rotation.x < -0.6, true);
  assert.notEqual(model.userData.leftLeg.rotation.x, 0);
  assert.notEqual(model.userData.rightLeg.rotation.x, 0);
});

it('decays V3 pistol recoil deterministically across ticks', () => {
  const model = createV3Model();
  const refs = createInitialGrifballThreeRefs();

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'pistol',
    weaponState: 'firing',
    weaponTimer: 0,
    dt: 1,
    settings: {},
  });
  const peakRecoil = model.userData.rightArm.rotation.x;

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'pistol',
    weaponState: 'firing',
    weaponTimer: 0.18,
    dt: 1,
    settings: {},
  });

  assert.equal(peakRecoil < model.userData.rightArm.rotation.x, true);
  assert.equal(Number.isFinite(model.userData.upperTorso.rotation.x), true);
});
```

- [ ] **Step 2: Run the focused runtime tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/v3AnimationFidelity.test.ts
```

Expected: FAIL until `combatantAnimationV3.ts` uses the shared Phase 11 profiles.

- [ ] **Step 3: Replace duplicate V3 pose math with profile calls**

In `src/components/grifball/combatantAnimationV3.ts`, import:

```ts
import {
  clamp01,
  easeInOutCubic,
  easeOutCubic,
  sampleV3FirstPersonWeaponPose,
  sampleV3ThirdPersonWeaponPose,
  sampleV3UpperBodyWeaponPose,
} from './v3AnimationFidelity';
```

Remove local `clamp01`, `easeOutCubic`, and `easeInOutCubic` definitions.

Update `applyV3HammerLayer`, `applyV3SwordLayer`, and `applyV3PistolLayer` to call `sampleV3UpperBodyWeaponPose(...)` and then `lerpRotation(...)` the returned `upperTorsoRotation`, `headRotation`, `leftArmRotation`, and `rightArmRotation`.

Update `getFirstPersonV3WeaponPose(...)` to return `sampleV3FirstPersonWeaponPose(...)`.

Update `animateV3WeaponMeshes(...)` to use `sampleV3ThirdPersonWeaponPose(...)` for V3 hammer, sword, and pistol branches. Keep V1/V2 branches in `combatantAnimation.ts` unchanged.

- [ ] **Step 4: Run focused Task 2 tests**

Run:

```powershell
node --import tsx --test src/components/grifball/v3AnimationFidelity.test.ts src/components/grifball/combatantAnimationV3.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts
git commit -m "feat: route v3 animation through shared profiles"
```

Expected: commit succeeds with only Task 2 files.

---

## Task 3: Add Deterministic Additive Motion, Hit Reaction, And Look Offsets

**Files:**
- Modify: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`

- [ ] **Step 1: Write failing additive motion tests**

Add tests:

```ts
it('adds V3 hit reaction when hp drops without changing lower-body locomotion phase', () => {
  const model = createV3Model();
  const refs = createInitialGrifballThreeRefs();

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(3, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'hammer',
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 0.1,
    settings: {},
  });
  const phaseBeforeHit = model.userData.v3WalkPhase;

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(3, 0, 0),
    yaw: 0,
    hp: 75,
    activeWeapon: 'hammer',
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 0.1,
    settings: {},
  });

  assert.equal(model.userData.v3WalkPhase > phaseBeforeHit, true);
  assert.notEqual(model.userData.upperTorso.rotation.z, 0);
  assert.notEqual(model.userData.head.rotation.x, 0);
});

it('applies optional V3 look offsets only to additive upper-body groups', () => {
  const model = createV3Model();
  const refs = createInitialGrifballThreeRefs();

  animateV3CombatantModel({
    refs,
    mesh: model,
    vel: new THREE.Vector3(0, 0, 0),
    yaw: 0,
    hp: 100,
    activeWeapon: 'pistol',
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 1,
    lookYawOffset: 0.35,
    lookPitch: -0.2,
    settings: {},
  });

  assert.equal(model.userData.head.rotation.y > 0.1, true);
  assert.equal(model.userData.head.rotation.x < 0, true);
  assert.equal(model.userData.leftLeg.rotation.x, 0);
  assert.equal(model.userData.rightLeg.rotation.x, 0);
});
```

- [ ] **Step 2: Run additive tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts
```

Expected: FAIL because `lookYawOffset`, `lookPitch`, and hit-reaction memory are not implemented.

- [ ] **Step 3: Extend the V3 animation input with optional visual-only additive fields**

In `V3CombatantAnimationInput`, add optional fields:

```ts
  lookYawOffset?: number;
  lookPitch?: number;
```

Do not require callers to pass these. Existing call sites must keep compiling without edits until Task 4.

- [ ] **Step 4: Implement deterministic additive pose state**

In `animateV3CombatantModel(...)`:

- Track `mesh.userData.v3LastHp`.
- When `hp` drops and remains above zero, set `mesh.userData.v3HitReactTimer = 0.18`.
- Decrease that timer by consumed `dt`.
- Apply hit reaction through `upperTorso`, `head`, `leftArm`, and `rightArm` only.
- Apply `lookYawOffset` and `lookPitch` through `head` and a small `upperTorso` contribution only.
- Leave lower-body rotations and `v3WalkPhase` under `applyV3LocomotionLayer(...)`.

Use bounded values:

```ts
const safeLookYaw = THREE.MathUtils.clamp(lookYawOffset ?? 0, -0.65, 0.65);
const safeLookPitch = THREE.MathUtils.clamp(lookPitch ?? 0, -0.45, 0.45);
```

- [ ] **Step 5: Preserve throttle semantics**

Ensure additive timers and breathing phases update after `consumeV3AnimationThrottle(...)` returns `shouldAnimate: true`, and do not update when throttled frames return `false`.

Add this assertion to the existing mobileLow throttle test:

```ts
const firstRemoteBreath = remoteModel.userData.v3BreathingPhase;
// after the throttled second call:
assert.equal(remoteModel.userData.v3BreathingPhase, firstRemoteBreath);
```

- [ ] **Step 6: Run focused Task 3 tests**

Run:

```powershell
node --import tsx --test src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/v3AnimationThrottle.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts
git commit -m "feat: add deterministic v3 additive animation"
```

Expected: commit succeeds with only Task 3 files.

---

## Task 4: Replay And Observer V3 Body Animation Parity

**Files:**
- Modify: `src/components/grifball/combatantAnimation.ts`
- Modify: `src/components/grifball/visualUpdateCallbacks.ts`
- Modify: `src/components/grifball/replayPlaybackVisuals.ts`
- Modify: `src/components/grifball/replayPlaybackRuntime.ts`
- Modify: `src/components/grifball/replayPlaybackRuntime.test.ts`

- [ ] **Step 1: Write failing replay body parity test**

Add to `src/components/grifball/replayPlaybackRuntime.test.ts` near the V3 replay visual test:

```ts
test('replay V3 body animation receives active weapon and lunge state', () => {
  const scene = new THREE.Scene();
  const refs = {
    scene,
    otherPlayerMeshes: new Map(),
    damageExplosionParticles: [],
    enemyGroup: null,
    hostGroup: null,
  } as any;
  const calls: any[] = [];

  updateReplayCombatantVisualsForFrame({
    refs,
    replayData: {
      id: 'v3-replay-body',
      name: 'V3 Replay Body',
      description: '',
      date: new Date(0).toISOString(),
      duration: 1,
      playerHue: 200,
      playerName: 'Player',
      opponentName: 'Bot',
      mapType: 'hangar' as ReplayFile['mapType'],
      mode: 'sandbox',
      maxScore: 25,
      visualModelPolicy: 'v3',
      frames: [],
    },
    updatedPlayers: new Map([['player', {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(2, 0, 0),
      yaw: 0,
      pitch: -0.15,
      crouchScaleY: 1,
      hp: 5,
      activeWeapon: 'sword',
      weaponState: 'ready',
      isCrouching: false,
      isLunging: true,
      isDashing: false,
      isSprinting: true,
      isSliding: false,
      weaponTimer: 0.08,
      score: 0,
      kills: 0,
      deaths: 0,
      respawnTimer: 0,
      invulnerabilityTimer: 0,
      name: 'Player',
      hue: 200,
    }]]),
    targetId: 'free',
    observerCamMode: 'third',
    replayPlayerName: 'Player',
    dt: 0.016,
    animateSpartanModel: (...args: any[]) => { calls.push(args); },
    renderSwordLungeTrailVfx: () => {},
    updateBlinking: () => {},
    settings: {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0][9], 'sword');
  assert.equal(calls[0][10], true);
});
```

- [ ] **Step 2: Run replay parity test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/replayPlaybackRuntime.test.ts
```

Expected: FAIL because replay body animation does not pass active weapon and lunge state.

- [ ] **Step 3: Widen visual-only animation callback signatures**

Update callback types to append optional arguments after `isSprinting`:

```ts
activeWeapon?: string;
isLunging?: boolean;
lookPitch?: number;
```

Touch:

- `src/components/grifball/replayPlaybackVisuals.ts`
- `src/components/grifball/replayPlaybackRuntime.ts`
- `src/components/grifball/visualUpdateCallbacks.ts`

In `visualUpdateCallbacks.ts`, pass the optional fields through to `animateSpartanCombatantModel(...)` as:

```ts
activeWeapon,
isLunging,
lookPitch,
```

Keep all new arguments optional so existing non-replay callers compile.

- [ ] **Step 4: Pass replay frame active weapon, lunge, and pitch**

In `updateReplayCombatantVisualsForFrame(...)`, call:

```ts
animateSpartanModel(
  group,
  player.vel,
  player.yaw,
  player.hp,
  player.weaponState,
  player.weaponTimer || 0,
  dt,
  player.isSliding || false,
  player.isSprinting || false,
  player.activeWeapon,
  Boolean(player.isLunging),
  player.pitch
);
```

- [ ] **Step 5: Run focused replay and V3 animation tests**

Run:

```powershell
node --import tsx --test src/components/grifball/replayPlaybackRuntime.test.ts src/components/grifball/combatantAnimationV3.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```powershell
git add src/components/grifball/combatantAnimation.ts src/components/grifball/visualUpdateCallbacks.ts src/components/grifball/replayPlaybackVisuals.ts src/components/grifball/replayPlaybackRuntime.ts src/components/grifball/replayPlaybackRuntime.test.ts
git commit -m "feat: preserve v3 replay animation state"
```

Expected: commit succeeds with only Task 4 files.

---

## Task 5: First-Person V3 Weapon Feel And Local View Startup Poses

**Files:**
- Modify: `src/components/grifball/localPlayerViewRuntime.ts`
- Modify: `src/components/grifball/localPlayerViewRuntime.test.ts`
- Create: `src/components/grifball/playerWeaponAnimationV3.test.ts`
- Modify: `src/components/grifball/playerHammerAnimationRuntime.ts`
- Modify: `src/components/grifball/playerSwordAnimationRuntime.ts`
- Modify: `src/components/grifball/playerPistolAnimationRuntime.ts`
- Modify: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing local first-person startup pose test**

Add to `src/components/grifball/localPlayerViewRuntime.test.ts`:

```ts
test('local first-person V3 weapons start from shared V3 first-person poses', () => {
  const refs = createInitialGrifballThreeRefs();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();

  buildLocalPlayerViewForRefs({
    refs,
    scene,
    camera,
    adminSettings: { playerHue: 192 },
    playerLoadout: { modelSystem: 'v3' },
  });

  assert.equal(refs.playerHammer?.position.x, 0.35);
  assert.equal(refs.playerHammer?.position.z, -0.65);
  assert.equal(refs.playerSword?.rotation.x, -Math.PI / 2);
  assert.equal(refs.playerPistol?.position.z, -0.4);
});
```

If Task 1 changes the exact shared values, update the assertions to the exported `sampleV3FirstPersonWeaponPose(...)` return values instead of duplicating literals.

- [ ] **Step 2: Write failing first-person runtime V3 sampler tests**

Create `src/components/grifball/playerWeaponAnimationV3.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import { buildV3HammerModel, buildV3PistolModel, buildV3SwordModel } from '../v3/VoxelModelsV3';
import type { GrifballRuntimeState } from './runtimeState';
import { sampleV3FirstPersonWeaponPose } from './v3AnimationFidelity';
import { updatePlayerHammerAnimationForState } from './playerHammerAnimationRuntime';
import { updatePlayerPistolAnimationForState } from './playerPistolAnimationRuntime';
import { updatePlayerSwordAnimationForState } from './playerSwordAnimationRuntime';

const baseState = (): GrifballRuntimeState => ({
  activeWeapon: 'hammer',
  pWeaponState: 'ready',
  pWeaponTimer: 0,
  pWeaponReady: true,
  pWeaponCooldown: 1,
  pSwordState: 'ready',
  pSwordTimer: 0,
  pSwordReady: true,
  pSwordCooldown: 1,
  pPistolState: 'ready',
  pPistolTimer: 0,
  pPistolReady: true,
  pPistolCooldown: 1,
  pSwordRecoverDuration: 0.6,
  isLunging: false,
  lungeTimer: 0,
  swapCooldownTimer: 0,
  swapCooldownDuration: 0,
  settings: {},
} as GrifballRuntimeState);

const assertPoseClose = (actual: THREE.Object3D, expected: ReturnType<typeof sampleV3FirstPersonWeaponPose>) => {
  assert.equal(Math.abs(actual.position.x - expected.position[0]) < 0.0001, true);
  assert.equal(Math.abs(actual.position.y - expected.position[1]) < 0.0001, true);
  assert.equal(Math.abs(actual.position.z - expected.position[2]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.x - expected.rotation[0]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.y - expected.rotation[1]) < 0.0001, true);
  assert.equal(Math.abs(actual.rotation.z - expected.rotation[2]) < 0.0001, true);
};

describe('V3 first-person player weapon animation runtime', () => {
  it('uses the shared V3 hammer sampler for live first-person hammer windup', () => {
    const state = baseState();
    state.activeWeapon = 'hammer';
    state.pWeaponState = 'swing_up';
    state.settings = { hammerSlamWindupTime: 0.45, hammerSlamAttackTime: 0.3 };
    const hammer = buildV3HammerModel(192);

    updatePlayerHammerAnimationForState({
      state,
      playerHammer: hammer,
      dt: 0.1,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyHammerStrikeImpact: () => {},
      applyPlayerHammerMeleeImpact: () => {},
    });

    assertPoseClose(hammer, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'hammer',
      weaponState: 'swing_up',
      weaponTimer: 0.1,
      isLunging: false,
      settings: state.settings,
    }));
  });

  it('uses the shared V3 sword sampler for live first-person lunge', () => {
    const state = baseState();
    state.activeWeapon = 'sword';
    state.isLunging = true;
    state.lungeTimer = 0.08;
    const sword = buildV3SwordModel(192);

    updatePlayerSwordAnimationForState({
      state,
      playerSword: sword,
      playerHammer: buildV3HammerModel(192),
      dt: 0,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
      applyPlayerSwordSlashImpact: () => false,
    });

    assertPoseClose(sword, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'sword',
      weaponState: 'ready',
      weaponTimer: 0.08,
      isLunging: true,
      settings: state.settings,
    }));
  });

  it('uses the shared V3 pistol sampler for live first-person recoil', () => {
    const state = baseState();
    state.activeWeapon = 'pistol';
    state.pPistolState = 'firing';
    const pistol = buildV3PistolModel(192);

    updatePlayerPistolAnimationForState({
      state,
      playerPistol: pistol,
      playerHammer: buildV3HammerModel(192),
      playerSword: buildV3SwordModel(192),
      dt: 0,
      idleXBob: 0,
      idleYBob: 0,
      idleZRotBob: 0,
    });

    assertPoseClose(pistol, sampleV3FirstPersonWeaponPose({
      activeWeapon: 'pistol',
      weaponState: 'firing',
      weaponTimer: 0,
      isLunging: false,
      settings: state.settings,
    }));
  });
});
```

- [ ] **Step 3: Add the new first-person runtime test to `npm test`**

Add `src/components/grifball/playerWeaponAnimationV3.test.ts` immediately after `src/components/grifball/localPlayerViewRuntime.test.ts` in `package.json`.

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/components/grifball/playerWeaponAnimationV3.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
```

Expected: exits 0.

- [ ] **Step 4: Write failing first-person sway/recoil mesh test**

Add to `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
it('adds deterministic V3 first-person idle sway without affecting third-person combatant weapons', () => {
  const pistol = buildV3PistolModel(192);
  pistol.userData.v3View = 'firstPerson';

  animateCombatantWeaponMeshes({
    pistolModel: pistol,
    activeWeapon: 'pistol',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    dt: 0.25,
    settings: {},
  });
  const firstPersonY = pistol.position.y;

  const thirdPerson = buildV3PistolModel(192);
  animateCombatantWeaponMeshes({
    pistolModel: thirdPerson,
    activeWeapon: 'pistol',
    weaponState: 'ready',
    weaponTimer: 0,
    isLunging: false,
    dt: 0.25,
    settings: {},
    combatantModel: createV3Model(),
  });

  assert.notEqual(firstPersonY, thirdPerson.position.y);
  assert.equal(thirdPerson.userData.v3FirstPersonSwayPhase, undefined);
});
```

- [ ] **Step 5: Run first-person tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/playerWeaponAnimationV3.test.ts src/components/grifball/combatantAnimationV3.test.ts
```

Expected: FAIL until startup poses, live player weapon runtimes, and first-person-only sway are wired.

- [ ] **Step 6: Apply shared startup poses for V3 local weapons**

In `buildLocalPlayerViewForRefs(...)`, after building each V3 weapon, set:

```ts
const hammerPose = getFirstPersonV3WeaponPose({
  activeWeapon: 'hammer',
  weaponState: 'ready',
  weaponTimer: 0,
  isLunging: false,
  settings: {},
});
```

Use the returned position/rotation for V3 weapons. Keep the existing V1/V2 startup values for non-V3 loadouts.

Tag first-person V3 weapons:

```ts
playerHammer.userData.v3View = 'firstPerson';
playerSword.userData.v3View = 'firstPerson';
playerPistol.userData.v3View = 'firstPerson';
```

- [ ] **Step 7: Route live first-person player runtimes through V3 samplers**

In `playerHammerAnimationRuntime.ts`, `playerSwordAnimationRuntime.ts`, and `playerPistolAnimationRuntime.ts`:

- Import `applyWeaponPose` only where still needed for V1/V2 high-fidelity presets.
- Import `sampleV3FirstPersonWeaponPose` from `./v3AnimationFidelity`.
- When `player*.userData.modelSystem === 'v3'`, use `sampleV3FirstPersonWeaponPose(...)` for ready, windup, strike, recover, melee, lunge, slash, pistol fire, and pistol recover visual transforms.
- Preserve the existing state-machine transitions and impact timing exactly. The sampler may move meshes, but it must not change when impacts fire or cooldowns update.
- Keep the current V1/V2 branches and legacy high-fidelity helper calls for non-V3 weapon models.

- [ ] **Step 8: Add first-person-only deterministic sway**

In `animateV3WeaponMeshes(...)`, after applying the shared V3 pose, only when `model.userData.v3View === 'firstPerson'`:

- Increment `model.userData.v3FirstPersonSwayPhase` by consumed `dt * 1.8`.
- Add a small deterministic idle offset to weapon position and roll.
- Keep recoil from `sampleV3FirstPersonWeaponPose(...)` dominant during firing/attack states.
- Do not apply this sway to third-person combatant weapons attached to `combatantModel`.

- [ ] **Step 9: Run focused first-person tests**

Run:

```powershell
node --import tsx --test src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/playerWeaponAnimationV3.test.ts src/components/grifball/combatantAnimationV3.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

Run:

```powershell
git add src/components/grifball/localPlayerViewRuntime.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/playerWeaponAnimationV3.test.ts src/components/grifball/playerHammerAnimationRuntime.ts src/components/grifball/playerSwordAnimationRuntime.ts src/components/grifball/playerPistolAnimationRuntime.ts src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts package.json
git commit -m "feat: improve v3 first-person weapon feel"
```

Expected: commit succeeds with only Task 5 files.

---

## Task 6: Animation Editor V3 Profile Parity

**Files:**
- Modify: `src/tools/animationEditor.ts`
- Modify: `src/tools/animationEditorCore.ts`
- Modify: `src/tools/animationEditorCore.test.ts`

- [ ] **Step 1: Write failing editor export metadata test**

Add to `src/tools/animationEditorCore.test.ts`:

```ts
it('can export V3 procedural profile metadata alongside editable rig frames', () => {
  const frames = generatePoseFrames([
    { frame: 0, pose: pose(0), label: 'Ready' },
    { frame: 2, pose: pose(2), label: 'Peak' },
  ], 3, 'linear');

  const payload = buildAnimationEditorExportPayload({
    weapon: 'pistol',
    view: 'firstPerson',
    track: 'pistol_fire',
    frameCount: 3,
    interpolation: 'linear',
    keyframes: [
      { frame: 0, pose: pose(0), label: 'Ready' },
      { frame: 2, pose: pose(2), label: 'Peak' },
    ],
    frames,
    proceduralProfile: {
      modelSystem: 'v3',
      profileVersion: 1,
      source: 'v3AnimationFidelity',
    },
  });

  assert.deepEqual(payload.proceduralProfile, {
    modelSystem: 'v3',
    profileVersion: 1,
    source: 'v3AnimationFidelity',
  });
});
```

- [ ] **Step 2: Run editor core test and confirm RED**

Run:

```powershell
node --import tsx --test src/tools/animationEditorCore.test.ts
```

Expected: FAIL because `proceduralProfile` is not accepted/exported.

- [ ] **Step 3: Add optional procedural profile metadata to editor export**

In `src/tools/animationEditorCore.ts`, add:

```ts
export interface AnimationEditorProceduralProfile {
  modelSystem: 'v3';
  profileVersion: number;
  source: 'v3AnimationFidelity';
}
```

Add to `AnimationEditorExportInput`:

```ts
  proceduralProfile?: AnimationEditorProceduralProfile;
```

Add to `buildAnimationEditorExportPayload(...)`:

```ts
  proceduralProfile: input.proceduralProfile ? { ...input.proceduralProfile } : undefined,
```

- [ ] **Step 4: Route editor track seeds through shared V3 profiles**

In `src/tools/animationEditor.ts`:

- Import `V3_ANIMATION_PROFILE_VERSION`, `V3_ANIMATION_TRACKS`, `getV3AnimationTrackDefinition`, `sampleV3FirstPersonWeaponPose`, and `sampleV3ThirdPersonWeaponPose`.
- Replace duplicated V3 first-person weapon sampling with `sampleV3FirstPersonWeaponPose(...)`.
- Replace duplicated V3 third-person weapon sampling with `sampleV3ThirdPersonWeaponPose(...)` where the edited model system is V3.
- Keep V1/V2 editor sampling intact.
- When exporting a V3 track, pass:

```ts
proceduralProfile: {
  modelSystem: 'v3',
  profileVersion: V3_ANIMATION_PROFILE_VERSION,
  source: 'v3AnimationFidelity',
}
```

- [ ] **Step 5: Run focused editor tests**

Run:

```powershell
node --import tsx --test src/tools/animationEditorCore.test.ts src/components/grifball/v3AnimationFidelity.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

Run:

```powershell
git add src/tools/animationEditor.ts src/tools/animationEditorCore.ts src/tools/animationEditorCore.test.ts
git commit -m "feat: align v3 animation editor profiles"
```

Expected: commit succeeds with only Task 6 files.

---

## Task 7: Documentation, Browser Smoke, And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README Phase 11 text**

Add after the Phase 10 paragraph in the V3 Offline Asset Tooling section:

```md
Phase 11 upgrades V3 animation fidelity with shared procedural pose profiles, deterministic additive motion, first-person weapon sway/recoil, replay-aware active weapon body animation, and animation-editor exports that identify their V3 procedural profile source. These changes remain visual-only: V1/V2 animation, hitboxes, weapon timings, network authority, replay timing, and gameplay simulation are unchanged.
```

- [ ] **Step 2: Run full verification**

Run:

```powershell
npm run lint
npm test
npm run build
git diff --check
```

Expected:

- `npm run lint`: PASS
- `npm test`: PASS
- `npm run build`: PASS; existing Vite chunk-size warnings are acceptable
- `git diff --check`: no whitespace errors

- [ ] **Step 3: Browser smoke V3 runtime and editor paths**

Use the existing local server on `http://127.0.0.1:3000` when possible.

Check:

```text
http://127.0.0.1:3000/
http://127.0.0.1:3000/animation-editor.html
```

Required checks:

- Main menu still shows V1 Classic, V2 Rigged, and V3 Advanced (Recommended).
- Starting or previewing V3 does not blank the page.
- `animation-editor.html` still exposes Version 3 and first-person/third-person controls.
- At mobile `390x844`, Model Set controls still do not overflow.

If browser automation is blocked, record the exact blocker and keep CLI evidence.

- [ ] **Step 4: Commit Task 7**

Run:

```powershell
git add README.md
git commit -m "docs: document v3 animation fidelity pass"
```

Expected: commit succeeds with only README changes.

---

## Phase 11 Completion Criteria

- Shared V3 animation profile contracts exist and are included in `npm test`.
- V3 third-person body and weapon mesh animation use shared deterministic pose profiles.
- V3 first-person weapon startup poses and sway/recoil use the shared profile path.
- V3 additive motion includes deterministic breathing/look/hit reaction without mutating lower-body locomotion or gameplay state.
- Replay V3 body animation receives active weapon and lunge state, so replay body and weapon visuals stay aligned.
- Animation editor V3 first-person and third-person seeds use the shared procedural profiles and exports identify the V3 procedural profile source.
- V1/V2 animation paths remain unchanged.
- `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.
- Browser smoke covers main menu, V3 selector visibility, animation editor V3 controls, and mobile Model Set overflow.

## Self-Review

- Spec coverage: This plan implements Phase 11's requested locomotion, upper-body weapon layers, first-person weapon feel, hit reactions, recoil, breathing, look tracking, hand-to-weapon/profile synchronization, editor-tuned pose presets, and replay/editor parity.
- Placeholder scan: There are no `TBD`, `TODO`, "implement later", or "similar to" placeholders.
- Type consistency: Shared profile names are `sampleV3FirstPersonWeaponPose`, `sampleV3ThirdPersonWeaponPose`, `sampleV3UpperBodyWeaponPose`, and `V3_ANIMATION_PROFILE_VERSION`; later tasks use the same names.
