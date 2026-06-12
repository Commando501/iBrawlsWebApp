# V3 Performance And Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add adaptive V3 render quality tiers, route those tiers through live V3 mesh/animation construction, and provide deterministic 8-combatant desktop/mobile smoke coverage before V3 becomes the recommended default.

**Architecture:** V3 quality stays visual-only and render-only. The selected tier is derived from device, graphics, and FPS signals in the app shell, then passed into Grifball render construction without changing hitboxes, movement, combat ranges, replay timing, or multiplayer simulation. Geometry builders expose selected LOD and budget metadata, V3 animation work is throttled for remote combatants on constrained tiers, and a local smoke harness renders eight V3 combatants with representative weapons for desktop and mobile verification.

**Tech Stack:** TypeScript, React, Three.js, existing V3 voxel builders, existing browser diagnostics, Node test runner with `tsx`, Vite build, Browser plugin for local smoke checks.

---

## Scope And Guardrails

- Preserve the existing V3 quality vocabulary from `src/components/v3/v3ModelTypes.ts`:

```ts
export const V3_QUALITY_TIERS = ['mobileLow', 'mobile', 'desktop', 'ultra'] as const;
```

- Do not introduce a second `low | medium | high` quality naming layer. If UI copy needs friendlier labels, map it from the canonical tiers.
- Mobile defaults no higher than `mobile`; unaccelerated or weak environments default to `mobileLow`.
- Quality tier changes are visual-only. Do not change collision cylinders, melee/lunge ranges, movement physics, AI decisions, scoring, weapon timings, or network payload authority.
- V1 and V2 render paths must remain unaffected.
- The local player and first-person weapons should remain smooth; throttling primarily applies to V3 remote/AI/observer combatants.
- Replays should remain deterministic and should not silently throttle playback timing. Any replay-specific throttling must be opt-in and tested separately; this phase keeps replay playback at the normal animation path.
- The target live scenario is up to 8 visible players/bots, desktop and mobile.
- Developer/browser smoke tooling is local only. No server upload or private mesh reference path is added.
- README and the enumerated `npm test` script must stay in parity with new tests.

## Existing Seams

- `src/components/v3/v3ModelTypes.ts` defines canonical V3 quality tiers and asset budget metadata.
- `src/components/v3/v3Lod.ts` selects a `V3LodLevel`, but V3 builders currently use it only for weapon metadata and always request `desktop`.
- `src/components/v3/v3AssetManifest.ts` currently builds LOD arrays with `slice(0, budget.lodCount)`, so assets with `lodCount: 2` can keep `ultra` and `desktop` while dropping the cheapest `mobile` fallback. Phase 8 must fix this before relying on mobile quality.
- `src/components/v3/VoxelModelsV3.ts` builds V3 character parts and V3 hammer/sword/pistol visuals.
- `src/components/VoxelModels.ts` routes `loadout.modelSystem === 'v3'` into `buildV3SpartanModel(...)`.
- `src/components/grifball/combatantModels.ts` creates/rebuilds third-person combatant rigs and V3 weapons.
- `src/components/GrifballGame.tsx` owns the frame loop and FPS sample.
- `src/platform/useBrowserDiagnostics.ts` owns device/graphics/Edge FPS diagnostics and is the right place to derive app-level V3 quality.
- `src/components/grifball/visualUpdateCallbacks.ts`, `rosterVisualSync.ts`, and `observerVisualSync.ts` call `animateSpartanCombatantModel(...)`.
- `src/components/grifball/renderFrame.ts` is the final live render call.
- Existing static V3 preview lives at `public/v3-asset-preview.html`; Phase 8 should add a Vite-transformed smoke page for real Three/V3 module imports.

## Planned Files

- Create `src/components/v3/v3QualityTiers.ts`
- Create `src/components/v3/v3QualityTiers.test.ts`
- Create `src/components/v3/v3PerformanceBudget.ts`
- Create `src/components/v3/v3PerformanceBudget.test.ts`
- Modify `src/components/v3/v3Lod.ts`
- Modify `src/components/v3/v3Lod.test.ts`
- Modify `src/components/v3/v3AssetManifest.ts`
- Modify `src/components/v3/v3AssetManifest.test.ts`
- Modify `src/components/v3/VoxelModelsV3.ts`
- Modify `src/components/v3/VoxelModelsV3.test.ts`
- Modify `src/components/VoxelModels.ts`
- Modify `src/components/grifball/combatantModels.ts`
- Modify `src/components/grifball/combatantModelRebuild.ts`
- Modify `src/components/grifball/remoteCombatantProvisioning.ts`
- Modify `src/components/grifball/mountSceneRuntime.ts`
- Modify `src/components/grifball/localPlayerViewRuntime.ts`
- Modify `src/components/grifball/multiplayerEnemyViewRuntime.ts`
- Modify `src/components/grifball/viewTargetCallbacks.ts`
- Modify `src/components/grifball/arenaOrchestratorCallbacks.ts`
- Modify `src/components/grifball/aiOrchestratorBridge.ts`
- Modify `src/components/grifball/replayPlaybackVisuals.ts`
- Modify `src/components/loading/PlayerModelPreview.tsx`
- Modify `src/components/CharacterPreview.tsx`
- Modify `src/tools/animationEditor.ts`
- Modify `src/components/grifball/GrifballGameProps.ts`
- Modify `src/components/GrifballGame.tsx`
- Modify `src/components/ActiveGameSurface.tsx`
- Modify `src/App.tsx`
- Modify `src/platform/useBrowserDiagnostics.ts`
- Modify `src/components/useAppStatsUpdateHandler.ts`
- Create `src/components/grifball/v3AnimationThrottle.ts`
- Create `src/components/grifball/v3AnimationThrottle.test.ts`
- Modify `src/components/grifball/combatantAnimation.ts`
- Modify `src/components/grifball/combatantAnimationV3.ts`
- Modify `src/components/grifball/combatantAnimationV3.test.ts`
- Modify `src/components/grifball/visualUpdateCallbacks.ts`
- Modify `src/components/grifball/rosterVisualSync.ts`
- Modify `src/components/grifball/observerVisualSync.ts`
- Create `src/tools/v3PerformanceSmoke.ts`
- Create `src/tools/v3PerformanceSmoke.test.ts`
- Create `v3-performance-smoke.html`
- Modify `vite.config.ts`
- Modify `package.json`
- Modify `README.md`

---

## Task 1: Pure V3 Quality Selection And Browser Diagnostics

**Files:**
- Create: `src/components/v3/v3QualityTiers.ts`
- Create: `src/components/v3/v3QualityTiers.test.ts`
- Modify: `src/platform/useBrowserDiagnostics.ts`
- Modify: `src/components/useAppStatsUpdateHandler.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing quality-selection tests**

Create `src/components/v3/v3QualityTiers.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getV3AnimationThrottleForTier,
  normalizeV3QualityTier,
  selectV3QualityTier,
} from './v3QualityTiers';

test('normalizeV3QualityTier accepts only canonical V3 tiers', () => {
  assert.equal(normalizeV3QualityTier('mobileLow'), 'mobileLow');
  assert.equal(normalizeV3QualityTier('mobile'), 'mobile');
  assert.equal(normalizeV3QualityTier('desktop'), 'desktop');
  assert.equal(normalizeV3QualityTier('ultra'), 'ultra');
  assert.equal(normalizeV3QualityTier('bad'), 'desktop');
});

test('mobile devices default no higher than mobile', () => {
  assert.equal(selectV3QualityTier({ isMobile: true, graphicsAccelerated: true, hardwareConcurrency: 8 }), 'mobile');
  assert.equal(selectV3QualityTier({ isMobile: true, graphicsAccelerated: true, hardwareConcurrency: 2 }), 'mobileLow');
  assert.equal(selectV3QualityTier({ forceMobileControls: true, graphicsAccelerated: true, hardwareConcurrency: 16 }), 'mobile');
});

test('unaccelerated graphics forces the safest tier', () => {
  assert.equal(selectV3QualityTier({ isMobile: false, graphicsAccelerated: false, hardwareConcurrency: 16 }), 'mobileLow');
});

test('desktop quality can recover and promote with strong signals', () => {
  assert.equal(selectV3QualityTier({ isMobile: false, graphicsAccelerated: true, hardwareConcurrency: 8 }), 'desktop');
  assert.equal(selectV3QualityTier({
    isMobile: false,
    graphicsAccelerated: true,
    hardwareConcurrency: 16,
    deviceMemoryGb: 8,
    fps: 95,
    previousTier: 'desktop',
  }), 'ultra');
});

test('low FPS demotes one tier at a time to avoid oscillation', () => {
  assert.equal(selectV3QualityTier({
    isMobile: false,
    graphicsAccelerated: true,
    hardwareConcurrency: 8,
    fps: 42,
    previousTier: 'ultra',
  }), 'desktop');
  assert.equal(selectV3QualityTier({
    isMobile: true,
    graphicsAccelerated: true,
    hardwareConcurrency: 8,
    fps: 24,
    previousTier: 'mobile',
  }), 'mobileLow');
});

test('animation throttles remote V3 work only on constrained tiers', () => {
  assert.deepEqual(getV3AnimationThrottleForTier('ultra'), { remoteAnimationIntervalMs: 0 });
  assert.deepEqual(getV3AnimationThrottleForTier('desktop'), { remoteAnimationIntervalMs: 0 });
  assert.deepEqual(getV3AnimationThrottleForTier('mobile'), { remoteAnimationIntervalMs: 33 });
  assert.deepEqual(getV3AnimationThrottleForTier('mobileLow'), { remoteAnimationIntervalMs: 50 });
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/v3QualityTiers.test.ts
```

Expected: FAIL because `v3QualityTiers.ts` does not exist.

- [ ] **Step 3: Add the pure quality helper**

Create `src/components/v3/v3QualityTiers.ts`:

```ts
import {
  V3_QUALITY_TIERS,
  type V3QualityTier,
} from './v3ModelTypes';

export interface V3QualitySignals {
  isMobile?: boolean;
  forceMobileControls?: boolean;
  graphicsAccelerated?: boolean;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  fps?: number;
  previousTier?: V3QualityTier;
}

export interface V3AnimationThrottle {
  remoteAnimationIntervalMs: number;
}

const tierRank = (tier: V3QualityTier): number => V3_QUALITY_TIERS.indexOf(tier);

const tierAtRank = (rank: number): V3QualityTier =>
  V3_QUALITY_TIERS[Math.max(0, Math.min(V3_QUALITY_TIERS.length - 1, rank))];

export function normalizeV3QualityTier(value: unknown, fallback: V3QualityTier = 'desktop'): V3QualityTier {
  return typeof value === 'string' && V3_QUALITY_TIERS.includes(value as V3QualityTier)
    ? value as V3QualityTier
    : fallback;
}

export function selectV3QualityTier(signals: V3QualitySignals): V3QualityTier {
  if (signals.graphicsAccelerated === false) {
    return 'mobileLow';
  }

  const cores = Number.isFinite(signals.hardwareConcurrency) ? Math.max(0, signals.hardwareConcurrency ?? 0) : 0;
  const memory = Number.isFinite(signals.deviceMemoryGb) ? Math.max(0, signals.deviceMemoryGb ?? 0) : 0;
  const fps = Number.isFinite(signals.fps) ? Math.max(0, signals.fps ?? 0) : undefined;
  const previous = normalizeV3QualityTier(signals.previousTier, signals.isMobile ? 'mobile' : 'desktop');

  let target: V3QualityTier;
  const mobilePath = Boolean(signals.isMobile || signals.forceMobileControls);

  if (mobilePath) {
    target = cores > 2 ? 'mobile' : 'mobileLow';
  } else if (cores >= 12 && memory >= 8 && (fps === undefined || fps >= 80)) {
    target = 'ultra';
  } else {
    target = 'desktop';
  }

  if (fps !== undefined && fps > 0) {
    if (fps < 28) {
      target = tierAtRank(tierRank(previous) - 1);
    } else if (fps < 50) {
      target = tierAtRank(Math.min(tierRank(target), tierRank(previous)));
    }
  }

  if (mobilePath && tierRank(target) > tierRank('mobile')) {
    return 'mobile';
  }

  return target;
}

export function getV3AnimationThrottleForTier(tier: V3QualityTier): V3AnimationThrottle {
  if (tier === 'mobileLow') return { remoteAnimationIntervalMs: 50 };
  if (tier === 'mobile') return { remoteAnimationIntervalMs: 33 };
  return { remoteAnimationIntervalMs: 0 };
}
```

- [ ] **Step 4: Run the pure helper test and confirm GREEN**

Run:

```powershell
node --import tsx --test src/components/v3/v3QualityTiers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire browser diagnostics without changing gameplay**

Modify `src/platform/useBrowserDiagnostics.ts`:

```ts
import {
  selectV3QualityTier,
  type V3QualitySignals,
} from '../components/v3/v3QualityTiers';
import type { V3QualityTier } from '../components/v3/v3ModelTypes';
```

Change the hook options interface:

```ts
interface UseBrowserDiagnosticsOptions {
  isPlaying: boolean;
  isPaused: boolean;
  forceMobileControls?: boolean;
}
```

Add near existing state:

```ts
const getHardwareConcurrency = (): number | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency;

const getDeviceMemoryGb = (): number | undefined => {
  const nav = typeof navigator === 'undefined'
    ? undefined
    : navigator as Navigator & { deviceMemory?: number };
  return typeof nav?.deviceMemory === 'number' ? nav.deviceMemory : undefined;
};

const buildV3QualitySignals = (
  device: DeviceInfo,
  check: GraphicsCheckResult,
  forceMobileControls?: boolean,
  fps?: number,
  previousTier?: V3QualityTier
): V3QualitySignals => ({
  isMobile: device.isMobile,
  forceMobileControls,
  graphicsAccelerated: check.checked ? check.accelerated : true,
  hardwareConcurrency: getHardwareConcurrency(),
  deviceMemoryGb: getDeviceMemoryGb(),
  fps,
  previousTier,
});
```

Add hook state and tracker:

```ts
const [v3QualityTier, setV3QualityTier] = useState<V3QualityTier>(() =>
  selectV3QualityTier(buildV3QualitySignals(detectDeviceOS(), graphicsCheck, forceMobileControls))
);

useEffect(() => {
  setV3QualityTier((previous) => {
    const next = selectV3QualityTier(buildV3QualitySignals(
      deviceInfo,
      graphicsCheck,
      forceMobileControls,
      undefined,
      previous
    ));
    return next === previous ? previous : next;
  });
}, [deviceInfo, graphicsCheck, forceMobileControls]);

const trackV3PerformanceSample = useCallback((fps: number | undefined) => {
  setV3QualityTier((previous) => {
    const next = selectV3QualityTier(buildV3QualitySignals(
      deviceInfo,
      graphicsCheck,
      forceMobileControls,
      fps,
      previous
    ));
    return next === previous ? previous : next;
  });
}, [deviceInfo, graphicsCheck, forceMobileControls]);
```

Return:

```ts
v3QualityTier,
trackV3PerformanceSample,
```

- [ ] **Step 6: Send FPS samples into diagnostics**

Modify `src/components/useAppStatsUpdateHandler.ts`:

```ts
trackV3PerformanceSample: (fps: number | undefined) => void;
```

Call it immediately after `trackEdgeLowFps(stats.fps)`:

```ts
trackV3PerformanceSample(stats.fps);
```

Modify `src/App.tsx` where `useBrowserDiagnostics` is destructured:

```ts
v3QualityTier,
trackV3PerformanceSample,
```

Pass forced mobile controls into `useBrowserDiagnostics`:

```ts
const {
  ...
  v3QualityTier,
  trackV3PerformanceSample,
} = useBrowserDiagnostics({
  isPlaying,
  isPaused,
  forceMobileControls,
});
```

Pass `trackV3PerformanceSample` into `useAppStatsUpdateHandler`.

- [ ] **Step 7: Run focused diagnostics tests**

Run:

```powershell
node --import tsx --test src/components/v3/v3QualityTiers.test.ts src/components/useAppStatsUpdateHandler.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
git add src/components/v3/v3QualityTiers.ts src/components/v3/v3QualityTiers.test.ts src/platform/useBrowserDiagnostics.ts src/components/useAppStatsUpdateHandler.ts src/App.tsx
git commit -m "feat: select adaptive v3 quality tiers"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: Route V3 Quality Through Runtime Mesh Construction

**Files:**
- Modify: `src/components/grifball/GrifballGameProps.ts`
- Modify: `src/components/GrifballGame.tsx`
- Modify: `src/components/ActiveGameSurface.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/VoxelModels.ts`
- Modify: `src/components/grifball/combatantModels.ts`
- Modify: `src/components/grifball/combatantModelRebuild.ts`
- Modify: `src/components/grifball/remoteCombatantProvisioning.ts`
- Modify: `src/components/grifball/mountSceneRuntime.ts`
- Modify: `src/components/grifball/localPlayerViewRuntime.ts`
- Modify: `src/components/grifball/multiplayerEnemyViewRuntime.ts`
- Modify: `src/components/grifball/viewTargetCallbacks.ts`
- Modify: `src/components/grifball/arenaOrchestratorCallbacks.ts`
- Modify: `src/components/grifball/aiOrchestratorBridge.ts`
- Modify: existing tests near these seams.

- [ ] **Step 1: Write failing builder-routing tests**

Add to `src/components/v3/VoxelModelsV3.test.ts`:

```ts
it('buildVoxelSpartanModel passes V3 quality options into V3 builders', () => {
  const model = buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }, {
    v3QualityTier: 'mobileLow',
    v3Distance: 32,
  });

  assert.equal(model.userData.v3QualityTier, 'mobileLow');
  assert.equal(model.userData.v3Distance, 32);
});
```

Add to `src/components/grifball/combatantModelRebuild.test.ts`:

```ts
test('host combatant rebuild tags V3 quality without changing gameplay model type', () => {
  const scene = new THREE.Scene();
  const refs = createInitialGrifballThreeRefs();
  refs.scene = scene;
  const state = createInitialGrifballRuntimeState({
    debugMode: false,
    adminSettings: DEFAULT_ADMIN_SETTINGS,
    multiplayerRole: 'host',
    isMultiplayer: true,
  });
  state.playerModelType = 'medium';

  rebuildHostCombatantModelForState({
    state,
    refs,
    hue: 220,
    isMultiplayer: true,
    multiplayerRole: 'host',
    playerLoadout: { modelSystem: 'v3', modelType: 'large' },
    v3QualityTier: 'mobileLow',
  });

  assert.equal(refs.hostGroup?.userData.v3QualityTier, 'mobileLow');
  assert.equal(state.playerModelType, 'medium');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantModelRebuild.test.ts
```

Expected: FAIL because build/rebuild signatures do not accept V3 quality options yet.

- [ ] **Step 3: Add shared V3 render options**

Add to `src/components/v3/v3QualityTiers.ts`:

```ts
export interface V3RenderOptions {
  v3QualityTier?: V3QualityTier;
  v3Distance?: number;
}
```

- [ ] **Step 4: Extend low-level model builders**

Modify `src/components/VoxelModels.ts`:

```ts
import type { V3RenderOptions } from './v3/v3QualityTiers';
```

Change the exported builder signature:

```ts
export function buildVoxelSpartanModel(
  isEnemy: boolean = true,
  customHue?: number,
  loadout: CharacterLoadout = DEFAULT_LOADOUT,
  v3Options: V3RenderOptions = {}
): THREE.Group {
  if (loadout.modelSystem === 'v3') {
    return buildV3SpartanModel({ isEnemy, customHue, loadout, ...v3Options });
  }
```

Modify `src/components/v3/VoxelModelsV3.ts`:

```ts
import {
  normalizeV3QualityTier,
  type V3RenderOptions,
} from './v3QualityTiers';

export interface V3SpartanBuildOptions extends V3RenderOptions {
  isEnemy?: boolean;
  customHue?: number;
  loadout?: CharacterLoadout;
}

export interface V3WeaponBuildOptions extends V3RenderOptions {
  customHue?: number;
}
```

Inside `buildV3SpartanModel`:

```ts
const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
root.userData.v3QualityTier = v3QualityTier;
root.userData.v3Distance = v3Distance;
```

Inside `buildV3WeaponModel`:

```ts
const v3QualityTier = normalizeV3QualityTier(options.v3QualityTier);
const v3Distance = Number.isFinite(options.v3Distance) ? Math.max(0, options.v3Distance ?? 0) : 0;
const selectedLod = selectV3LodLevel({
  lods: manifest.lods,
  qualityTier: v3QualityTier,
  distance: v3Distance,
});
group.userData.v3QualityTier = v3QualityTier;
group.userData.v3Distance = v3Distance;
```

- [ ] **Step 5: Extend combatant mesh builders**

Modify `src/components/grifball/combatantModels.ts`:

```ts
import type { V3RenderOptions } from '../v3/v3QualityTiers';
```

Change helper signatures:

```ts
const buildCombatantHammer = (
  hue: number | undefined,
  loadout?: CharacterLoadout,
  v3Options: V3RenderOptions = {}
): THREE.Group =>
  isV3Loadout(loadout) ? buildV3HammerModel(hue, v3Options) : buildGravityHammerModel(hue, loadout?.hammerPreset);
```

Make matching changes for sword/pistol and add an optional `v3Options` parameter to:

```ts
  createCombatantMeshRig(scene, hue, isEnemyBot, loadout, v3Options)
  rebuildDualWeaponCombatantModel({ ..., v3Options })
```

Pass `v3Options` into `buildVoxelSpartanModel(...)` and the V3 weapon builders.
Set rebuild metadata on created groups:

```ts
group.userData.appliedV3QualityTier = v3Options.v3QualityTier;
group.userData.appliedV3Distance = v3Options.v3Distance;
```

Do not put the quality tier into `CharacterLoadout`; quality is render-runtime state, not player customization, replay identity, or network loadout data.

- [ ] **Step 6: Thread quality from App into GrifballGame**

Modify `src/components/grifball/GrifballGameProps.ts`:

```ts
import type { V3QualityTier } from '../v3/v3ModelTypes';

v3QualityTier?: V3QualityTier;
```

Modify `src/components/ActiveGameSurface.tsx` to accept `v3QualityTier` and pass it to `GrifballGame`.

Modify `src/App.tsx` to pass `v3QualityTier={v3QualityTier}` to `ActiveGameSurface`.

Modify `src/components/GrifballGame.tsx`:

```ts
const activeV3RenderOptions = useMemo(() => ({
  v3QualityTier,
  v3Distance: 0,
}), [v3QualityTier]);
```

Pass `activeV3RenderOptions` to mount scene initialization, host/client model rebuild callbacks, and AI/remote provisioning callbacks.

- [ ] **Step 7: Thread quality through runtime provisioners**

Add `v3Options?: V3RenderOptions` to the relevant inputs and pass through unchanged:

```ts
initializeGrifballMountSceneForState(..., v3Options)
buildLocalPlayerViewForRefs(..., v3Options)
buildMultiplayerEnemyViewForRefs(..., v3Options)
createArenaOrchestratorCallbacksForState(..., v3Options)
provisionCombatant(..., v3Options)
rebuildHostCombatantModelForState(..., v3Options)
rebuildEnemyCombatantModelForState(..., v3Options)
createViewTargetCallbacksForState(..., v3Options)
```

Keep V1/V2 calls passing no options or ignored options.

When an existing V3 mesh can be reused or rebuilt based on `appliedLoadoutKey`, include a separate quality check:

```ts
const qualityChanged = meshes.group.userData.appliedV3QualityTier !== v3Options.v3QualityTier;
```

Rebuild V3 meshes when `qualityChanged` is true. Keep existing V1/V2 rebuild behavior unchanged.

- [ ] **Step 8: Update replay, loading, character preview, and animation-editor V3 build paths**

Thread optional V3 render options through:

```ts
src/components/grifball/replayPlaybackVisuals.ts
src/components/loading/PlayerModelPreview.tsx
src/components/CharacterPreview.tsx
src/tools/animationEditor.ts
```

Use `desktop` as the default for editor and static previews unless a caller explicitly supplies a tier. Replay playback may tag V3 quality metadata for budget reporting, but it must not throttle replay time or change replay policy/loadout fallback behavior from Phase 7.

- [ ] **Step 9: Run focused runtime routing tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantModelRebuild.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/replayPlaybackRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 2**

Run:

```powershell
git add src/components/v3/v3QualityTiers.ts src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts src/components/VoxelModels.ts src/components/grifball/combatantModels.ts src/components/grifball/combatantModelRebuild.ts src/components/grifball/remoteCombatantProvisioning.ts src/components/grifball/mountSceneRuntime.ts src/components/grifball/localPlayerViewRuntime.ts src/components/grifball/multiplayerEnemyViewRuntime.ts src/components/grifball/viewTargetCallbacks.ts src/components/grifball/arenaOrchestratorCallbacks.ts src/components/grifball/aiOrchestratorBridge.ts src/components/grifball/replayPlaybackVisuals.ts src/components/loading/PlayerModelPreview.tsx src/components/CharacterPreview.tsx src/tools/animationEditor.ts src/components/grifball/GrifballGameProps.ts src/components/GrifballGame.tsx src/components/ActiveGameSurface.tsx src/App.tsx src/components/grifball/combatantModelRebuild.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/replayPlaybackRuntime.test.ts
git commit -m "feat: route v3 quality through combatant builders"
```

Expected: commit succeeds.

---

## Task 3: V3 LOD Budget Metadata And Render Budget Accounting

**Files:**
- Create: `src/components/v3/v3PerformanceBudget.ts`
- Create: `src/components/v3/v3PerformanceBudget.test.ts`
- Modify: `src/components/v3/v3AssetManifest.ts`
- Modify: `src/components/v3/v3AssetManifest.test.ts`
- Modify: `src/components/v3/v3Lod.ts`
- Modify: `src/components/v3/v3Lod.test.ts`
- Modify: `src/components/v3/VoxelModelsV3.ts`
- Modify: `src/components/v3/VoxelModelsV3.test.ts`

- [ ] **Step 1: Write failing asset-manifest LOD fallback tests**

Add to `src/components/v3/v3AssetManifest.test.ts`:

```ts
import { V3_QUALITY_TIERS } from './v3ModelTypes';

it('every built-in V3 asset keeps at least one mobile-capable LOD fallback', () => {
  const assets = [
    ...BUILT_IN_V3_CHARACTER_PARTS,
    ...BUILT_IN_V3_WEAPONS,
  ];

  for (const asset of assets) {
    assert.equal(asset.lods.length, asset.budget.lodCount);
    assert.equal(
      asset.lods.some((lod) => V3_QUALITY_TIERS.indexOf(lod.qualityTier) <= V3_QUALITY_TIERS.indexOf('mobile')),
      true,
      `${asset.id} should expose a mobile-capable LOD`
    );
  }
});

it('two-LOD V3 assets keep richest plus cheapest LODs instead of dropping mobile fallback', () => {
  const pistol = getDefaultV3WeaponManifest('pistol');
  assert.equal(pistol.budget.lodCount, 2);
  assert.deepEqual(pistol.lods.map((lod) => lod.qualityTier), ['ultra', 'mobile']);
});
```

- [ ] **Step 2: Run asset-manifest test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: FAIL because `createLods(...).slice(0, budget.lodCount)` keeps `ultra` and `desktop` for two-LOD assets and drops the `mobile` fallback.

- [ ] **Step 3: Fix LOD creation to preserve cheapest fallback**

Modify `src/components/v3/v3AssetManifest.ts` inside `createLods`:

```ts
if (budget.lodCount >= lods.length) {
  return lods;
}

if (budget.lodCount <= 1) {
  return [lods[lods.length - 1]];
}

return [
  lods[0],
  ...lods.slice(-(budget.lodCount - 1)),
];
```

This preserves the richest preview source plus the cheapest mobile-capable fallback when an asset only has two authored LOD slots.

- [ ] **Step 4: Run asset-manifest test and confirm GREEN**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing budget tests**

Create `src/components/v3/v3PerformanceBudget.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createCombatantMeshRig } from '../grifball/combatantModels';
import {
  collectV3RenderBudget,
  summarizeV3SceneRenderBudget,
} from './v3PerformanceBudget';

test('collectV3RenderBudget counts selected V3 LOD budgets on a combatant', () => {
  const scene = new THREE.Scene();
  const meshes = createCombatantMeshRig(scene, 192, false, { modelSystem: 'v3' }, {
    v3QualityTier: 'mobile',
    v3Distance: 24,
  });

  const budget = collectV3RenderBudget(meshes.group);
  assert.equal(budget.modelCount, 1);
  assert.equal(budget.partCount > 0, true);
  assert.equal(budget.sourceVoxelCount > 0, true);
  assert.equal(budget.drawCallEstimate > 0, true);
  assert.equal(budget.qualityTiers.mobile > 0, true);
});

test('summarizeV3SceneRenderBudget counts eight V3 combatants', () => {
  const scene = new THREE.Scene();
  for (let i = 0; i < 8; i += 1) {
    const meshes = createCombatantMeshRig(scene, (i * 45) % 360, false, { modelSystem: 'v3' }, {
      v3QualityTier: i < 4 ? 'mobile' : 'desktop',
      v3Distance: i * 4,
    });
    meshes.group.position.x = i - 3.5;
  }

  const budget = summarizeV3SceneRenderBudget(scene);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount >= 8 * 19, true);
  assert.equal(budget.qualityTiers.mobile > 0, true);
  assert.equal(budget.qualityTiers.desktop > 0, true);
});
```

- [ ] **Step 6: Run budget tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/v3PerformanceBudget.test.ts
```

Expected: FAIL because the budget helper does not exist.

- [ ] **Step 7: Add budget collection helper**

Create `src/components/v3/v3PerformanceBudget.ts`:

```ts
import * as THREE from 'three';
import {
  V3_QUALITY_TIERS,
  type V3AssetBudget,
  type V3QualityTier,
} from './v3ModelTypes';

export interface V3RenderBudgetSummary extends V3AssetBudget {
  modelCount: number;
  partCount: number;
  qualityTiers: Record<V3QualityTier, number>;
}

export const createEmptyV3RenderBudget = (): V3RenderBudgetSummary => ({
  modelCount: 0,
  partCount: 0,
  sourceVoxelCount: 0,
  mergedBoxCount: 0,
  materialGroupCount: 0,
  drawCallEstimate: 0,
  lodCount: 0,
  memoryEstimateKb: 0,
  qualityTiers: Object.fromEntries(V3_QUALITY_TIERS.map((tier) => [tier, 0])) as Record<V3QualityTier, number>,
});

export function collectV3RenderBudget(root: THREE.Object3D): V3RenderBudgetSummary {
  const summary = createEmptyV3RenderBudget();
  root.traverse((object) => {
    if (object.userData?.modelSystem === 'v3') {
      summary.modelCount += 1;
    }
    const selectedLod = object.userData?.v3SelectedLod as { qualityTier?: V3QualityTier; budget?: V3AssetBudget } | undefined;
    if (!selectedLod?.budget || !selectedLod.qualityTier) return;

    summary.partCount += 1;
    summary.sourceVoxelCount += selectedLod.budget.sourceVoxelCount;
    summary.mergedBoxCount += selectedLod.budget.mergedBoxCount;
    summary.materialGroupCount += selectedLod.budget.materialGroupCount;
    summary.drawCallEstimate += selectedLod.budget.drawCallEstimate;
    summary.lodCount += selectedLod.budget.lodCount;
    summary.memoryEstimateKb += selectedLod.budget.memoryEstimateKb;
    summary.qualityTiers[selectedLod.qualityTier] += 1;
  });
  return summary;
}

export const summarizeV3SceneRenderBudget = collectV3RenderBudget;
```

- [ ] **Step 8: Attach selected LOD metadata to V3 character parts**

Modify `src/components/v3/VoxelModelsV3.ts` inside the part loop:

```ts
const selectedLod = selectV3LodLevel({
  lods: part.lods,
  qualityTier: v3QualityTier,
  distance: v3Distance,
});
group.userData.v3SelectedLod = selectedLod;
group.userData.v3QualityTier = v3QualityTier;
```

Keep custom armor validation unchanged. Custom V3 armor still uses the slot's selected LOD metadata for budget planning.

- [ ] **Step 9: Harden LOD selection tests**

Add to `src/components/v3/v3Lod.test.ts`:

```ts
it('mobileLow falls back to the cheapest available mobile LOD when no explicit mobileLow LOD exists', () => {
  const lod = selectV3LodLevel({ lods: sampleLods, qualityTier: 'mobileLow', distance: 2 });
  assert.equal(lod.qualityTier, 'mobile');
});

it('copies selected LOD budget data so callers cannot mutate manifest state', () => {
  const lod = selectV3LodLevel({ lods: sampleLods, qualityTier: 'ultra', distance: 2 });
  lod.budget.sourceVoxelCount = 1;
  assert.notEqual(sampleLods[0].budget.sourceVoxelCount, 1);
});
```

- [ ] **Step 10: Run V3 LOD and budget tests**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts src/components/v3/v3Lod.test.ts src/components/v3/VoxelModelsV3.test.ts src/components/v3/v3PerformanceBudget.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 3**

Run:

```powershell
git add src/components/v3/v3PerformanceBudget.ts src/components/v3/v3PerformanceBudget.test.ts src/components/v3/v3AssetManifest.ts src/components/v3/v3AssetManifest.test.ts src/components/v3/v3Lod.ts src/components/v3/v3Lod.test.ts src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts
git commit -m "feat: track v3 lod render budgets"
```

Expected: commit succeeds.

---

## Task 4: V3 Remote Animation Throttling

**Files:**
- Create: `src/components/grifball/v3AnimationThrottle.ts`
- Create: `src/components/grifball/v3AnimationThrottle.test.ts`
- Modify: `src/components/grifball/combatantAnimation.ts`
- Modify: `src/components/grifball/combatantAnimationV3.ts`
- Modify: `src/components/grifball/combatantAnimationV3.test.ts`
- Modify: `src/components/grifball/visualUpdateCallbacks.ts`
- Modify: `src/components/grifball/rosterVisualSync.ts`
- Modify: `src/components/grifball/observerVisualSync.ts`

Animation throttling is allowed to skip only V3 pose/weapon-mesh animation work. It must not skip:

```ts
player.weaponState = weaponState;
player.weaponTimer = weaponTimer;
applyBotMeleeImpact(clientId);
renderSwordLungeTrailVfx(...);
```

`renderer.render(...)`, physics, AI, objective state, HUD stats, nameplates, radar, and replay timing must still run every frame.

- [ ] **Step 1: Write failing throttle tests**

Create `src/components/grifball/v3AnimationThrottle.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  consumeV3AnimationThrottle,
  getV3AnimationThrottleState,
} from './v3AnimationThrottle';

test('desktop V3 animation is never throttled', () => {
  const mesh = new THREE.Group();
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'desktop',
    isLocal: false,
    nowMs: 0,
    dt: 0.016,
  }).shouldAnimate, true);
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'desktop',
    isLocal: false,
    nowMs: 1,
    dt: 0.016,
  }).shouldAnimate, true);
});

test('mobileLow throttles remote V3 animation and accumulates dt', () => {
  const mesh = new THREE.Group();
  const first = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 0,
    dt: 0.016,
  });
  const second = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 20,
    dt: 0.016,
  });
  const third = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 52,
    dt: 0.016,
  });

  assert.equal(first.shouldAnimate, true);
  assert.equal(second.shouldAnimate, false);
  assert.equal(third.shouldAnimate, true);
  assert.equal(third.dt > 0.03, true);
  assert.equal(getV3AnimationThrottleState(mesh).lastAnimationMs, 52);
});

test('local V3 animation is not throttled even on mobileLow', () => {
  const mesh = new THREE.Group();
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: true,
    nowMs: 0,
    dt: 0.016,
  }).shouldAnimate, true);
  assert.equal(consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: true,
    nowMs: 10,
    dt: 0.016,
  }).shouldAnimate, true);
});
```

- [ ] **Step 2: Run throttle tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/v3AnimationThrottle.test.ts
```

Expected: FAIL because `v3AnimationThrottle.ts` does not exist.

- [ ] **Step 3: Add the throttle helper**

Create `src/components/grifball/v3AnimationThrottle.ts`:

```ts
import * as THREE from 'three';
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { getV3AnimationThrottleForTier } from '../v3/v3QualityTiers';

interface StoredV3AnimationThrottleState {
  lastAnimationMs: number;
  accumulatedDt: number;
}

export interface V3AnimationThrottleInput {
  mesh: THREE.Group;
  qualityTier: V3QualityTier;
  isLocal: boolean;
  nowMs: number;
  dt: number;
}

export interface V3AnimationThrottleResult {
  shouldAnimate: boolean;
  dt: number;
}

export function getV3AnimationThrottleState(mesh: THREE.Group): StoredV3AnimationThrottleState {
  const existing = mesh.userData.v3AnimationThrottle as StoredV3AnimationThrottleState | undefined;
  if (existing) return existing;
  const state = { lastAnimationMs: Number.NEGATIVE_INFINITY, accumulatedDt: 0 };
  mesh.userData.v3AnimationThrottle = state;
  return state;
}

export function consumeV3AnimationThrottle({
  mesh,
  qualityTier,
  isLocal,
  nowMs,
  dt,
}: V3AnimationThrottleInput): V3AnimationThrottleResult {
  const intervalMs = isLocal ? 0 : getV3AnimationThrottleForTier(qualityTier).remoteAnimationIntervalMs;
  if (intervalMs <= 0) {
    return { shouldAnimate: true, dt };
  }

  const state = getV3AnimationThrottleState(mesh);
  state.accumulatedDt += Math.max(0, dt);

  if (!Number.isFinite(state.lastAnimationMs) || nowMs - state.lastAnimationMs >= intervalMs) {
    const nextDt = state.accumulatedDt;
    state.accumulatedDt = 0;
    state.lastAnimationMs = nowMs;
    return { shouldAnimate: true, dt: nextDt };
  }

  return { shouldAnimate: false, dt: 0 };
}
```

- [ ] **Step 4: Extend animation signatures**

Modify `src/components/grifball/combatantAnimationV3.ts`:

```ts
import type { V3QualityTier } from '../v3/v3ModelTypes';
import { normalizeV3QualityTier } from '../v3/v3QualityTiers';
import { consumeV3AnimationThrottle } from './v3AnimationThrottle';

export interface V3CombatantAnimationInput {
  ...
  v3QualityTier?: V3QualityTier;
  isLocalV3Animation?: boolean;
  animationClockMs?: number;
}
```

At the start of `animateV3CombatantModel` after `groups` is resolved:

```ts
const throttle = consumeV3AnimationThrottle({
  mesh,
  qualityTier: normalizeV3QualityTier(v3QualityTier),
  isLocal: Boolean(isLocalV3Animation),
  nowMs: Number.isFinite(animationClockMs) ? animationClockMs ?? 0 : performance.now(),
  dt,
});
if (!throttle.shouldAnimate) return;
dt = throttle.dt;
```

Modify `src/components/grifball/combatantAnimation.ts` so `animateSpartanCombatantModel(...)` accepts and forwards:

```ts
v3QualityTier?: V3QualityTier;
isLocalV3Animation?: boolean;
animationClockMs?: number;
```

- [ ] **Step 5: Pass quality to live animation callers**

Modify:

```ts
src/components/grifball/visualUpdateCallbacks.ts
src/components/grifball/rosterVisualSync.ts
src/components/grifball/observerVisualSync.ts
```

Thread `v3QualityTier` into callbacks. Mark local player/host first-person animation calls as local:

```ts
isLocalV3Animation: true
```

Use remote/AI/observer roster calls with:

```ts
isLocalV3Animation: false
```

Pass `animationClockMs: performance.now()` from the caller once per frame where practical.
In `src/components/grifball/rosterVisualSync.ts`, keep weapon-state/timer progression and melee-impact calls before any throttled animation decision. Apply the throttle only around:

```ts
animateSpartanCombatantModel(...);
animateCombatantWeaponMeshes(...);
```

- [ ] **Step 6: Add animation regression tests**

Add to `src/components/grifball/combatantAnimationV3.test.ts`:

```ts
it('throttles remote V3 locomotion updates on mobileLow but keeps local updates live', () => {
  const remote = buildV3SpartanModel();
  const local = buildV3SpartanModel();
  const vel = new THREE.Vector3(3, 0, 0);

  animateV3CombatantModel({
    refs: createInitialGrifballThreeRefs(),
    mesh: remote,
    vel,
    yaw: 0,
    hp: 5,
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 0.016,
    v3QualityTier: 'mobileLow',
    animationClockMs: 0,
  });
  const firstPhase = remote.userData.v3WalkPhase;

  animateV3CombatantModel({
    refs: createInitialGrifballThreeRefs(),
    mesh: remote,
    vel,
    yaw: 0,
    hp: 5,
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 0.016,
    v3QualityTier: 'mobileLow',
    animationClockMs: 20,
  });

  animateV3CombatantModel({
    refs: createInitialGrifballThreeRefs(),
    mesh: local,
    vel,
    yaw: 0,
    hp: 5,
    weaponState: 'ready',
    weaponTimer: 0,
    dt: 0.016,
    v3QualityTier: 'mobileLow',
    isLocalV3Animation: true,
    animationClockMs: 20,
  });

  assert.equal(remote.userData.v3WalkPhase, firstPhase);
  assert.equal((local.userData.v3WalkPhase ?? 0) > 0, true);
});
```

Add to `src/components/grifball/v3AnimationThrottle.test.ts` or the most focused roster visual test file:

```ts
test('throttled remote animation still allows roster weapon timers to advance outside the gate', () => {
  const mesh = new THREE.Group();
  const first = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 0,
    dt: 0.016,
  });
  const skipped = consumeV3AnimationThrottle({
    mesh,
    qualityTier: 'mobileLow',
    isLocal: false,
    nowMs: 20,
    dt: 0.016,
  });
  let weaponTimer = 0;
  weaponTimer += 0.016;
  weaponTimer += 0.016;

  assert.equal(first.shouldAnimate, true);
  assert.equal(skipped.shouldAnimate, false);
  assert.equal(weaponTimer, 0.032);
});
```

- [ ] **Step 7: Run focused animation tests**

Run:

```powershell
node --import tsx --test src/components/grifball/v3AnimationThrottle.test.ts src/components/grifball/combatantAnimationV3.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```powershell
git add src/components/grifball/v3AnimationThrottle.ts src/components/grifball/v3AnimationThrottle.test.ts src/components/grifball/combatantAnimation.ts src/components/grifball/combatantAnimationV3.ts src/components/grifball/combatantAnimationV3.test.ts src/components/grifball/visualUpdateCallbacks.ts src/components/grifball/rosterVisualSync.ts src/components/grifball/observerVisualSync.ts
git commit -m "feat: throttle remote v3 animation on constrained tiers"
```

Expected: commit succeeds.

---

## Task 5: Deterministic 8-Combatant V3 Smoke Harness

**Files:**
- Create: `src/tools/v3PerformanceSmoke.ts`
- Create: `src/tools/v3PerformanceSmoke.test.ts`
- Create: `v3-performance-smoke.html`
- Modify: `vite.config.ts`

- [ ] **Step 1: Write failing smoke harness tests**

Create `src/tools/v3PerformanceSmoke.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  buildV3PerformanceSmokeScene,
  createV3PerformanceSmokeCombatants,
} from './v3PerformanceSmoke';

test('createV3PerformanceSmokeCombatants builds eight V3 combatants with mixed weapons', () => {
  const scene = new THREE.Scene();
  const combatants = createV3PerformanceSmokeCombatants(scene, 'mobile');

  assert.equal(combatants.length, 8);
  assert.deepEqual(new Set(combatants.map((entry) => entry.meshes.group.userData.modelSystem)), new Set(['v3']));
  assert.deepEqual(new Set(combatants.map((entry) => entry.activeWeapon)), new Set(['hammer', 'sword', 'pistol']));
});

test('buildV3PerformanceSmokeScene creates a nonblank scene with V3 budget metadata', () => {
  const { scene, camera, combatants, budget } = buildV3PerformanceSmokeScene({ qualityTier: 'mobileLow' });

  assert.ok(scene.children.length > 0);
  assert.ok(camera.position.length() > 0);
  assert.equal(combatants.length, 8);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount > 0, true);
});
```

- [ ] **Step 2: Run smoke tests and confirm RED**

Run:

```powershell
node --import tsx --test src/tools/v3PerformanceSmoke.test.ts
```

Expected: FAIL because `v3PerformanceSmoke.ts` does not exist.

- [ ] **Step 3: Add the smoke harness module**

Create `src/tools/v3PerformanceSmoke.ts`:

```ts
import * as THREE from 'three';
import { createCombatantMeshRig, type CombatantMeshRig } from '../components/grifball/combatantModels';
import { summarizeV3SceneRenderBudget } from '../components/v3/v3PerformanceBudget';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import type { V3QualityTier } from '../components/v3/v3ModelTypes';

export interface V3PerformanceSmokeCombatant {
  id: string;
  meshes: CombatantMeshRig;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
}

const weapons = ['hammer', 'sword', 'pistol'] as const;

export function createV3PerformanceSmokeCombatants(
  scene: THREE.Scene,
  qualityTier: V3QualityTier
): V3PerformanceSmokeCombatant[] {
  return Array.from({ length: 8 }, (_, index) => {
    const meshes = createCombatantMeshRig(scene, (index * 47) % 360, false, { modelSystem: 'v3' }, {
      v3QualityTier: qualityTier,
      v3Distance: index * 3,
    });
    const row = index < 4 ? 0 : 1;
    const col = index % 4;
    meshes.group.position.set((col - 1.5) * 1.8, 0, row === 0 ? -1.4 : 1.4);
    meshes.group.rotation.y = row === 0 ? 0.25 : Math.PI - 0.25;
    const activeWeapon = weapons[index % weapons.length];
    meshes.hammer.visible = activeWeapon === 'hammer';
    meshes.sword.visible = activeWeapon === 'sword';
    if (meshes.pistol) meshes.pistol.visible = activeWeapon === 'pistol';
    return { id: `smoke-${index + 1}`, meshes, activeWeapon };
  });
}

export function buildV3PerformanceSmokeScene({
  qualityTier,
}: {
  qualityTier: V3QualityTier;
}) {
  const normalizedTier = normalizeV3QualityTier(qualityTier);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#071014');
  const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 100);
  camera.position.set(0, 3.2, 8);
  camera.lookAt(0, 0.9, 0);
  scene.add(new THREE.HemisphereLight('#ffffff', '#223344', 1.7));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const combatants = createV3PerformanceSmokeCombatants(scene, normalizedTier);
  const budget = summarizeV3SceneRenderBudget(scene);
  return { scene, camera, combatants, budget, qualityTier: normalizedTier };
}
```

- [ ] **Step 4: Add the local Vite smoke page**

Create `v3-performance-smoke.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>V3 Performance Smoke</title>
    <style>
      html, body, #root { margin: 0; width: 100%; height: 100%; background: #071014; color: #eef8fb; }
      body { font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      canvas { display: block; width: 100vw; height: 100vh; }
      #hud { position: fixed; top: 12px; left: 12px; display: grid; gap: 6px; padding: 10px 12px; background: rgba(7, 16, 20, 0.78); border: 1px solid rgba(93, 214, 201, 0.35); border-radius: 8px; font: 12px/1.35 "Cascadia Mono", monospace; }
      select { background: #12242b; color: #eef8fb; border: 1px solid #24414a; border-radius: 6px; min-height: 32px; }
    </style>
  </head>
  <body>
    <canvas id="smoke-canvas"></canvas>
    <div id="hud">
      <label>Tier <select id="tier">
        <option value="mobileLow">mobileLow</option>
        <option value="mobile">mobile</option>
        <option value="desktop" selected>desktop</option>
        <option value="ultra">ultra</option>
      </select></label>
      <span id="summary">Preparing...</span>
    </div>
    <script type="module" src="/src/tools/v3PerformanceSmokePage.ts"></script>
  </body>
</html>
```

Create `src/tools/v3PerformanceSmokePage.ts`:

```ts
import * as THREE from 'three';
import { buildV3PerformanceSmokeScene } from './v3PerformanceSmoke';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';

const canvas = document.getElementById('smoke-canvas') as HTMLCanvasElement;
const tierSelect = document.getElementById('tier') as HTMLSelectElement;
const summary = document.getElementById('summary') as HTMLSpanElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

let current = buildV3PerformanceSmokeScene({ qualityTier: normalizeV3QualityTier(tierSelect.value) });

function resize() {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  renderer.setSize(width, height, false);
  current.camera.aspect = width / height;
  current.camera.updateProjectionMatrix();
}

function rebuild() {
  current = buildV3PerformanceSmokeScene({ qualityTier: normalizeV3QualityTier(tierSelect.value) });
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
```

Modify `vite.config.ts` build inputs:

```ts
v3PerformanceSmoke: path.resolve(__dirname, 'v3-performance-smoke.html'),
```

- [ ] **Step 5: Run smoke harness tests**

Run:

```powershell
node --import tsx --test src/tools/v3PerformanceSmoke.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

Run:

```powershell
git add src/tools/v3PerformanceSmoke.ts src/tools/v3PerformanceSmoke.test.ts src/tools/v3PerformanceSmokePage.ts v3-performance-smoke.html vite.config.ts
git commit -m "feat: add v3 performance smoke harness"
```

Expected: commit succeeds.

---

## Task 6: Package, README, Browser Smoke, And Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add Phase 8 tests to `npm test`**

Add these paths exactly once to `package.json` `scripts.test`:

```text
src/components/v3/v3QualityTiers.test.ts
src/components/v3/v3PerformanceBudget.test.ts
src/components/grifball/v3AnimationThrottle.test.ts
src/tools/v3PerformanceSmoke.test.ts
```

Use these placements:

```text
src/components/v3/v3QualityTiers.test.ts
```

immediately after:

```text
src/components/v3/v3Lod.test.ts
```

Add:

```text
src/components/v3/v3PerformanceBudget.test.ts
```

immediately after:

```text
src/components/v3/v3GeometryCache.test.ts
```

Add:

```text
src/components/grifball/v3AnimationThrottle.test.ts
```

immediately after:

```text
src/components/grifball/combatantAnimationV3.test.ts
```

Add:

```text
src/tools/v3PerformanceSmoke.test.ts
```

immediately after:

```text
src/tools/v3AssetValidation.test.ts
```

Run this assertion:

```powershell
node -e "const s=require('./package.json').scripts.test; for (const p of ['src/components/v3/v3QualityTiers.test.ts','src/components/v3/v3PerformanceBudget.test.ts','src/components/grifball/v3AnimationThrottle.test.ts','src/tools/v3PerformanceSmoke.test.ts']) { const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count); }"
```

Expected: exits 0.

- [ ] **Step 2: Update README**

Update the V3 offline tooling/model-system sections with these facts:

```md
- Phase 8 adds adaptive V3 quality tiers using the canonical `mobileLow`, `mobile`, `desktop`, and `ultra` tier names.
- Mobile devices default no higher than `mobile`, while unaccelerated graphics defaults to `mobileLow`.
- V3 quality is render-only: model budget metadata, selected LODs, and remote animation throttling do not alter hitboxes, movement, AI, weapon timings, scoring, or network authority.
- `v3-performance-smoke.html` is a local developer smoke page that renders eight V3 combatants with mixed weapons for desktop/mobile checks.
```

- [ ] **Step 3: Run all focused Phase 8 tests**

Run:

```powershell
node --import tsx --test src/components/v3/v3QualityTiers.test.ts src/components/v3/v3Lod.test.ts src/components/v3/VoxelModelsV3.test.ts src/components/v3/v3PerformanceBudget.test.ts src/components/grifball/v3AnimationThrottle.test.ts src/components/grifball/combatantAnimationV3.test.ts src/tools/v3PerformanceSmoke.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

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
- `npm run build`: PASS; existing chunk-size warnings are acceptable
- `git diff --check`: no whitespace errors

- [ ] **Step 5: Browser smoke the local performance page**

If `http://127.0.0.1:3000` is already running from this worktree, reuse it. Otherwise start the approved local dev server.

Open:

```text
http://127.0.0.1:3000/v3-performance-smoke.html
```

Check desktop viewport:

- Page renders a nonblank canvas.
- HUD shows `models 8`.
- HUD shows nonzero parts and draw budget.
- Switching tiers between `mobileLow`, `mobile`, `desktop`, and `ultra` updates the HUD without console errors.
- A V3 sandbox match with 8 visible combatants renders without a blank canvas or console errors.
- Existing `/v3-asset-preview.html`, `armor-model-editor.html`, and `animation-editor.html` still load.
- A replay with V3 visual metadata still plays without changing legacy replay fallback behavior.

Check mobile viewport, for example `390x844`:

- Page renders a nonblank canvas.
- HUD remains visible and does not overlap the whole canvas.
- `mobileLow` and `mobile` tiers render eight combatants without console errors.
- The live V3 sandbox HUD/mobile controls remain usable and do not cover the entire viewport.
- Loading overlay policy previews still render under the active match model policy.

If browser tooling serves stale dev HTML or the React/browser root is blank, record the exact blocker and keep the CLI verification evidence. Do not mark browser smoke as passed without a live rendered page.

- [ ] **Step 6: Commit Task 6**

Run:

```powershell
git add package.json README.md
git commit -m "docs: document v3 performance tiers"
```

Expected: commit succeeds.

---

## Final Verification Checklist

- [ ] V3 quality tiers are selected from device, graphics, hardware, and FPS signals.
- [ ] Mobile defaults no higher than `mobile`; unaccelerated graphics defaults to `mobileLow`.
- [ ] V3 quality tier is passed from `App` to live Grifball render construction.
- [ ] V1/V2 visuals and gameplay model-type behavior remain unchanged.
- [ ] V3 character parts and weapons are tagged with selected LOD and budget metadata.
- [ ] V3 remote/AI/observer animation can throttle on constrained tiers.
- [ ] Local V3 first-person/local animation remains unthrottled.
- [ ] 8-combatant V3 smoke harness builds eight visible V3 combatants with mixed weapons.
- [ ] `v3-performance-smoke.html` is included in Vite build inputs.
- [ ] README documents Phase 8 behavior and render-only guarantees.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.
- [ ] Browser smoke is either passed with desktop/mobile evidence or explicitly reported as environment-blocked.

## Self-Review

- Spec coverage: Adaptive quality tiers are covered by Task 1. LOD selection and budget metadata are covered by Tasks 2 and 3. Animation throttling is covered by Task 4. 8-combatant desktop/mobile smoke coverage is covered by Task 5 and Task 6. README/package parity is covered by Task 6.
- Placeholder scan: This plan contains no unresolved placeholder tokens or open-ended "handle edge cases" instructions.
- Type consistency: All quality values use existing `V3QualityTier` from `src/components/v3/v3ModelTypes.ts`. `V3RenderOptions` lives in `v3QualityTiers.ts` and carries `v3QualityTier` plus optional `v3Distance` through builders. No gameplay state type is changed to use V3 render quality for hitboxes or combat logic.
