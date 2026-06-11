# V3 Model System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a parallel V3 voxel character and weapon model system with match-level visual policy, modular customization, procedural layered animation, offline asset tooling, and V1/V2 legacy support.

**Architecture:** Implement V3 as a parallel model system instead of replacing V2. Start by adding shared contracts and visual-policy resolution, then add offline asset tooling, V3 manifests/builders, V3 rigging, V3 animation, V3 customization, multiplayer/replay integration, and adaptive performance tiers in separate gated phases.

**Tech Stack:** TypeScript, React, Three.js, Vite, Node test runner with `tsx`, local Node/WebSocket relay, Cloudflare Worker relay, existing voxel greedy meshing utilities.

---

## Scope And Execution Model

The approved design is intentionally broad. It spans contracts, model assets, offline tooling, rendering, animation, customization, multiplayer, replay, and mobile performance. Execute it as a sequence of independently reviewable phases. Do not attempt to implement all phases in one pass.

This master plan locks the order, ownership boundaries, and verification gates. Before coding a later phase with open design variables, write a focused phase plan under `docs/superpowers/plans/` that expands that phase into exact code-level tasks.

The first implementation slice is Phase 1: architecture and contracts. That phase should not require final V3 art assets.

## Current Repo Constraints

- The worktree may already contain unrelated dirty files. Preserve them.
- `docs/` is ignored by git in this checkout, so documentation files under `docs/superpowers/` must be staged with `git add -f`.
- Local dev server uses port `3000`.
- Use CodeGraph for structural questions before broad grep.
- Runtime animation/rig changes must update the animation editor preview/export path when parity matters.
- V1 and V2 remain playable and selectable throughout the work.

## Phase Overview

1. **Contracts And Visual Policy:** Add model-system types, match visual policy, loadout sanitation, and policy tests.
2. **Offline Asset Pipeline:** Build developer-only OBJ/FBX/reference ingestion and voxel preview/validation tooling.
3. **V3 Canonical Assets:** Add original V3 character and weapon manifests with budgets and LOD metadata.
4. **Runtime Builder And Rig:** Add V3 character/weapon builders, V3 sockets, first-person support, and compatibility adapters.
5. **Layered Procedural Animation:** Add body-mask procedural animation layers and V3 first/third-person parity.
6. **Customization And Editors:** Add V3 modular armor selection, paint roles, custom armor constraints, and animation-editor V3 targets.
7. **Match Policy, Multiplayer, Replay:** Wire offline/host policy through UI, local relay, Worker relay, loading, observer, and replay.
8. **Performance And Mobile:** Add adaptive quality ladder, LOD selection, render budgets, and 8-combatant mobile/desktop validation.
9. **Default Rollout:** Make V3 the recommended default while retaining V1/V2 sandbox options and update documentation.

---

## File Structure Plan

### Shared Contracts

- Create `src/model/modelSystem.ts`: canonical `ModelSystem`, `VisualModelPolicy`, helpers, defaults.
- Modify `src/components/VoxelModels.ts`: widen `CharacterLoadout.modelSystem` to shared `ModelSystem`.
- Modify `src/characterModelTypes.ts`: keep collision profiles independent of visual model policy.
- Modify `src/network/protocol.ts`: add visual model policy to `MatchLobbyConfig`.
- Modify `src/components/customArmor.ts`: accept/sanitize V3 model-system fields without allowing arbitrary mesh import.
- Modify `worker/src/index.ts`: mirror relay-side policy and loadout sanitation.
- Modify `server.ts`: keep local relay sanitation aligned with browser/shared code.

### V3 Asset And Builder Modules

- Create `src/components/v3/v3ModelTypes.ts`: V3 slots, part ids, paint roles, budget metadata, quality tiers.
- Create `src/components/v3/v3PartBounds.ts`: V3 visual fit envelopes and validation helpers.
- Create `src/components/v3/v3AssetManifest.ts`: curated V3 manifest shape and initial built-in manifest entries.
- Create `src/components/v3/VoxelModelsV3.ts`: V3 character and weapon builders.
- Create `src/components/v3/v3GeometryCache.ts`: geometry/material cache helpers for reused parts.
- Create `src/components/v3/v3Lod.ts`: LOD selection by quality tier, distance, and platform.

### V3 Rig And Animation

- Create `src/components/grifball/combatantRigV3.ts`: V3 rig graph, sockets, first-person hand rig, compatibility adapter.
- Modify `src/components/grifball/combatantRig.ts`: route V3 models to V3-aware attachment behavior while preserving V1/V2.
- Create `src/components/grifball/combatantAnimationV3.ts`: layered procedural animation runtime.
- Modify `src/components/grifball/combatantAnimation.ts`: dispatch V3 models into V3 animation runtime.
- Modify `src/components/grifball/combatantModels.ts`: build V3 character plus V3 hammer/sword/pistol when policy resolves to V3.
- Modify `src/components/grifball/localPlayerViewRuntime.ts`: first-person V3 arms/weapons.

### Policy Consumers

- Create `src/model/modelVisualPolicy.ts`: visual model policy resolution for local, multiplayer, replay, preview, and fallback contexts.
- Modify `src/components/grifball/remoteCombatantProvisioning.ts`: render remote humans through resolved policy.
- Modify `src/components/grifball/replayPlaybackVisuals.ts`: render replay combatants through replay policy metadata.
- Modify `src/components/loading/PlayerModelPreview.tsx`: render loading roster previews through policy.
- Modify `src/components/CharacterPreview.tsx`: render main-menu preview through selected policy.
- Modify `src/components/previewModelUtils.ts` if present in the live tree: include model policy in preview signatures.

### UI Surfaces

- Modify `src/components/multiplayer/MultiplayerSetupPanel.tsx`: host visual model policy control.
- Modify `src/components/main-menu/SandboxSetupPanel.tsx`: offline visual model policy control.
- Modify `src/components/main-menu/CustomizationPanel.tsx`: V3 modular selections and paint role surface.
- Modify `src/components/main-menu/ArmorModelEditor.tsx`: V3 custom armor bounds and part slots.
- Modify `src/armorModelEditorPage.tsx`: V3-aware editor entry state.
- Modify `animation-editor.html`: add Version 3 option and V3 weapon target coverage.
- Modify `src/tools/animationEditor.ts`: V3 skeleton overlay, target selection, preview loadout, export data.
- Modify `src/tools/animationEditorCore.ts`: versioned V3 rig/pose export schema if needed.

### Offline Tooling

- Create `src/tools/v3ObjParser.ts`: small OBJ parser for local converter tests and fallback geometry ingestion.
- Create `src/tools/v3Voxelize.ts`: mesh-to-voxel sampling helpers.
- Create `src/tools/v3VoxelPartClassifier.ts`: map object/material names to candidate V3 slots for developer review.
- Create `src/tools/v3AssetValidation.ts`: budgets, bounds, connected-component checks.
- Create `scripts/v3/preview-v3-asset.mjs` or TypeScript equivalent: local-only developer preview/conversion runner.
- Create `public/v3-asset-preview.html` or in-repo tool page if browser preview is needed.

### Tests

- Create `src/model/modelSystem.test.ts`.
- Create `src/model/modelVisualPolicy.test.ts`.
- Modify `src/network/matchLobbyConfig.test.ts`.
- Modify `src/components/customArmor.test.ts`.
- Modify `src/components/grifball/remoteCombatantProvisioning.test.ts`.
- Modify `src/components/loading/matchLoadingState.test.ts`.
- Create `src/components/v3/v3ModelTypes.test.ts`.
- Create `src/components/v3/v3PartBounds.test.ts`.
- Create `src/tools/v3ObjParser.test.ts`.
- Create `src/tools/v3Voxelize.test.ts`.
- Create `src/components/grifball/combatantRigV3.test.ts`.
- Create `src/components/grifball/combatantAnimationV3.test.ts`.
- Modify `src/components/grifball/combatantRig.test.ts`.
- Modify `src/components/grifball/replayPlaybackRuntime.test.ts`.

---

## Phase 1: Contracts And Visual Policy

### Task 1: Add Shared Model-System And Visual-Policy Types

**Files:**
- Create: `src/model/modelSystem.ts`
- Create: `src/model/modelSystem.test.ts`
- Modify: `package.json` test list if the focused test must be added to `npm test`

- [ ] **Step 1: Write failing tests for canonical model-system helpers**

Create `src/model/modelSystem.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL_SYSTEM,
  DEFAULT_VISUAL_MODEL_POLICY,
  MODEL_SYSTEMS,
  isModelSystem,
  normalizeModelSystem,
  normalizeVisualModelPolicy,
} from './modelSystem';

test('model system helpers accept v1, v2, and v3 only', () => {
  assert.deepEqual(MODEL_SYSTEMS, ['v1', 'v2', 'v3']);
  assert.equal(isModelSystem('v1'), true);
  assert.equal(isModelSystem('v2'), true);
  assert.equal(isModelSystem('v3'), true);
  assert.equal(isModelSystem('v4'), false);
  assert.equal(isModelSystem(undefined), false);
});

test('normalizeModelSystem falls back to the configured default', () => {
  assert.equal(DEFAULT_MODEL_SYSTEM, 'v3');
  assert.equal(normalizeModelSystem('v1'), 'v1');
  assert.equal(normalizeModelSystem('v2'), 'v2');
  assert.equal(normalizeModelSystem('v3'), 'v3');
  assert.equal(normalizeModelSystem('bad'), DEFAULT_MODEL_SYSTEM);
});

test('normalizeVisualModelPolicy preserves visual-only policy choices', () => {
  assert.equal(DEFAULT_VISUAL_MODEL_POLICY, 'v3');
  assert.equal(normalizeVisualModelPolicy('v1'), 'v1');
  assert.equal(normalizeVisualModelPolicy('v2'), 'v2');
  assert.equal(normalizeVisualModelPolicy('v3'), 'v3');
  assert.equal(normalizeVisualModelPolicy(null), DEFAULT_VISUAL_MODEL_POLICY);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts
```

Expected: FAIL because `src/model/modelSystem.ts` does not exist.

- [ ] **Step 3: Implement the shared model-system module**

Create `src/model/modelSystem.ts`:

```ts
export const MODEL_SYSTEMS = ['v1', 'v2', 'v3'] as const;

export type ModelSystem = (typeof MODEL_SYSTEMS)[number];

export type VisualModelPolicy = ModelSystem;

export const DEFAULT_MODEL_SYSTEM: ModelSystem = 'v3';
export const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = DEFAULT_MODEL_SYSTEM;

export function isModelSystem(value: unknown): value is ModelSystem {
  return value === 'v1' || value === 'v2' || value === 'v3';
}

export function normalizeModelSystem(
  value: unknown,
  fallback: ModelSystem = DEFAULT_MODEL_SYSTEM
): ModelSystem {
  return isModelSystem(value) ? value : fallback;
}

export function normalizeVisualModelPolicy(
  value: unknown,
  fallback: VisualModelPolicy = DEFAULT_VISUAL_MODEL_POLICY
): VisualModelPolicy {
  return normalizeModelSystem(value, fallback);
}
```

- [ ] **Step 4: Run the focused test and confirm it passes**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/model/modelSystem.ts src/model/modelSystem.test.ts
git commit -m "feat: add model system contracts"
```

Expected: commit succeeds with only Task 1 files.

### Task 2: Widen Character Loadout To V3 Without Changing Collision Semantics

**Files:**
- Modify: `src/components/VoxelModels.ts`
- Modify: `src/characterModelTypes.ts`
- Modify: `src/components/customArmor.ts`
- Modify: `src/components/customArmor.test.ts`

- [ ] **Step 1: Write failing tests for V3 loadout sanitation**

Add to `src/components/customArmor.test.ts`:

```ts
test('sanitizeCharacterLoadoutForNetwork preserves v3 model system without custom mesh data', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v3',
    modelType: 'large',
    helmet: 'mark-vi',
    torso: 'scout',
    hammerPreset: 'gravity-axe',
    meshImportPath: 'C:/private/reference.obj',
    rawMesh: { vertices: [0, 1, 2] },
  }) as any;

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.modelType, undefined);
  assert.equal(loadout.helmet, 'mark-vi');
  assert.equal(loadout.torso, 'scout');
  assert.equal(loadout.hammerPreset, 'gravity-axe');
  assert.equal(loadout.meshImportPath, undefined);
  assert.equal(loadout.rawMesh, undefined);
});

test('sanitizeCharacterLoadoutForNetwork keeps v2 model type semantics unchanged', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v2',
    modelType: 'large',
  }) as any;

  assert.equal(loadout.modelSystem, 'v2');
  assert.equal(loadout.modelType, 'large');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts
```

Expected: FAIL because V3 is not accepted by current sanitation.

- [ ] **Step 3: Widen `CharacterLoadout.modelSystem`**

In `src/components/VoxelModels.ts`, import `ModelSystem` and update the interface:

```ts
import type { ModelSystem } from '../model/modelSystem';
```

Change:

```ts
modelSystem?: 'v1' | 'v2';
```

to:

```ts
modelSystem?: ModelSystem;
```

- [ ] **Step 4: Keep collision profile lookup V2-compatible and visual-policy independent**

In `src/characterModelTypes.ts`, keep `resolveCharacterModelType` defaulting V1 to medium and treating V3 like normalized gameplay unless a later phase adds visual-only V3 body-size variants:

```ts
export function resolveCharacterModelType(value: unknown, modelSystem?: unknown): CharacterModelType {
  if (modelSystem === 'v1' || modelSystem === 'v3') return DEFAULT_CHARACTER_MODEL_TYPE;
  return isCharacterModelType(value) ? value : DEFAULT_CHARACTER_MODEL_TYPE;
}
```

- [ ] **Step 5: Update local loadout sanitation**

In `src/components/customArmor.ts`, import `isModelSystem`:

```ts
import { isModelSystem } from '../model/modelSystem';
```

In `sanitizeCharacterLoadoutForNetwork`, replace the V1/V2-only model-system check with:

```ts
if (isModelSystem(raw.modelSystem)) out.modelSystem = raw.modelSystem;
const modelType = resolveCharacterModelType(raw.modelType, raw.modelSystem);
if (out.modelSystem === 'v2') out.modelType = modelType;
```

Keep `customArmor` sanitation restricted to bounded voxel snapshots. Do not copy arbitrary properties from the raw loadout object.

- [ ] **Step 6: Run the focused tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/components/customArmor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add src/components/VoxelModels.ts src/characterModelTypes.ts src/components/customArmor.ts src/components/customArmor.test.ts
git commit -m "feat: allow v3 loadout contracts"
```

Expected: commit succeeds with only Task 2 files.

### Task 3: Add Match Visual Policy To Shared Lobby Config

**Files:**
- Modify: `src/network/protocol.ts`
- Modify: `src/network/matchLobbyConfig.test.ts`

- [ ] **Step 1: Inspect current `MatchLobbyConfig` shape**

Run:

```powershell
Select-String -LiteralPath 'src/network/protocol.ts' -Pattern 'interface MatchLobbyConfig|normalizeMatchLobbyConfig|createMatchLobbySummary' -Context 4,12
```

Expected: output shows the shared lobby config and normalizer.

- [ ] **Step 2: Write failing tests for policy normalization**

Add to `src/network/matchLobbyConfig.test.ts`:

```ts
test('normalizeMatchLobbyConfig defaults visual model policy to v3', () => {
  const config = normalizeMatchLobbyConfig({});
  assert.equal(config.visualModelPolicy, 'v3');
});

test('normalizeMatchLobbyConfig preserves v1 and v2 visual model policy choices', () => {
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
  assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v3' }).visualModelPolicy, 'v3');
});

test('normalizeMatchLobbyConfig rejects invalid visual model policy values', () => {
  const config = normalizeMatchLobbyConfig({ visualModelPolicy: 'v4' } as any);
  assert.equal(config.visualModelPolicy, 'v3');
});
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/network/matchLobbyConfig.test.ts
```

Expected: FAIL because `visualModelPolicy` is not on the normalized config.

- [ ] **Step 4: Add the policy to protocol types and normalization**

In `src/network/protocol.ts`, import:

```ts
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../model/modelSystem';
```

Add to `MatchLobbyConfig`:

```ts
visualModelPolicy: VisualModelPolicy;
```

In `normalizeMatchLobbyConfig`, set:

```ts
visualModelPolicy: normalizeVisualModelPolicy(input?.visualModelPolicy),
```

Ensure `createMatchLobbySummary` includes the normalized `lobbyConfig` with this field through its existing config payload, not a separate duplicate field.

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/network/matchLobbyConfig.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add src/network/protocol.ts src/network/matchLobbyConfig.test.ts
git commit -m "feat: add visual model policy to lobby config"
```

Expected: commit succeeds with only Task 3 files.

### Task 4: Mirror Visual Policy And V3 Sanitation In Local Relay And Worker

**Files:**
- Modify: `server.ts`
- Modify: `worker/src/index.ts`
- Modify: `worker/src/displayNames.test.ts` only if an existing worker test file needs new imports or fixtures
- Create: `worker/src/modelPolicy.test.ts` if adding a new worker-focused test is cleaner

- [ ] **Step 1: Write worker normalization tests**

Create `worker/src/modelPolicy.test.ts` with tests that import or exercise exported normalizers if worker helpers are exported. If worker helpers remain unexported, add tests through the lowest existing worker-facing normalizer that can be imported.

Target assertions:

```ts
assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'v3' }).visualModelPolicy, 'v3');
assert.equal(normalizeMatchLobbyConfig({ visualModelPolicy: 'bad' }).visualModelPolicy, 'v3');
assert.equal(sanitizeCharacterLoadoutForNetwork({ modelSystem: 'v3', rawMesh: {} })?.modelSystem, 'v3');
```

If worker helper export churn is too high, document that in the phase PR and cover worker parity with a focused TypeScript-only test of the shared browser/server helpers plus manual worker typecheck.

- [ ] **Step 2: Run worker typecheck and focused tests**

Run:

```powershell
npm run typecheck:worker
```

Expected before implementation: FAIL or type errors if policy fields are not present.

- [ ] **Step 3: Update Worker `MatchLobbyConfig` and normalizer**

In `worker/src/index.ts`, add the Worker-local equivalent type:

```ts
type ModelSystem = "v1" | "v2" | "v3";
type VisualModelPolicy = ModelSystem;
const DEFAULT_VISUAL_MODEL_POLICY: VisualModelPolicy = "v3";

function normalizeVisualModelPolicy(value: unknown): VisualModelPolicy {
  return value === "v1" || value === "v2" || value === "v3" ? value : DEFAULT_VISUAL_MODEL_POLICY;
}
```

Add to Worker `MatchLobbyConfig`:

```ts
visualModelPolicy: VisualModelPolicy;
```

Set it in Worker `normalizeMatchLobbyConfig`:

```ts
visualModelPolicy: normalizeVisualModelPolicy(raw.visualModelPolicy),
```

- [ ] **Step 4: Update Worker character loadout sanitation**

In `worker/src/index.ts`, update V1/V2-only logic:

```ts
if (raw.modelSystem === "v1" || raw.modelSystem === "v2" || raw.modelSystem === "v3") {
  out.modelSystem = raw.modelSystem;
}
const modelType = normalizeCharacterModelType(raw.modelType, raw.modelSystem);
if (out.modelSystem === "v2") out.modelType = modelType;
```

Do not allow `rawMesh`, `meshImportPath`, `vertices`, `faces`, or similar arbitrary mesh payloads to pass into `out`.

- [ ] **Step 5: Check local relay path**

`server.ts` should already call shared `normalizeMatchLobbyConfig` and `sanitizeCharacterLoadoutForNetwork`. Confirm no local V1/V2-only model-system branch remains:

```powershell
rg -n "modelSystem ===|modelSystem === \"v1\"|modelSystem === \"v2\"|visualModelPolicy" server.ts
```

Expected: no relay-local branch rejects V3.

- [ ] **Step 6: Run verification**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/network/matchLobbyConfig.test.ts src/components/customArmor.test.ts
npm run typecheck:worker
```

Expected: PASS, except if `npm run typecheck:worker` hits the known `EPERM: operation not permitted, lstat 'C:\Users\eastr'` environment blocker. If that blocker appears, record it in the PR notes and do not treat it as a code failure.

- [ ] **Step 7: Commit Task 4**

Run:

```powershell
git add server.ts worker/src/index.ts worker/src/modelPolicy.test.ts
git commit -m "feat: mirror visual model policy in relays"
```

Expected: commit succeeds with only Task 4 files. If `worker/src/modelPolicy.test.ts` was not created, omit it from `git add`.

### Task 5: Add Policy Resolver For Runtime And Preview Consumers

**Files:**
- Create: `src/model/modelVisualPolicy.ts`
- Create: `src/model/modelVisualPolicy.test.ts`
- Modify: `src/components/grifball/remoteCombatantProvisioning.ts`
- Modify: `src/components/grifball/remoteCombatantProvisioning.test.ts`

- [ ] **Step 1: Write failing tests for policy resolution**

Create `src/model/modelVisualPolicy.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  resolveCombatantVisualModelSystem,
  resolveLoadoutForVisualPolicy,
} from './modelVisualPolicy';

test('resolveCombatantVisualModelSystem lets match policy override personal loadout model system', () => {
  assert.equal(resolveCombatantVisualModelSystem({
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3' },
  }), 'v1');
  assert.equal(resolveCombatantVisualModelSystem({
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v3' },
  }), 'v2');
  assert.equal(resolveCombatantVisualModelSystem({
    visualModelPolicy: 'v3',
    loadout: { modelSystem: 'v1' },
  }), 'v3');
});

test('resolveLoadoutForVisualPolicy returns safe loadout shape for forced legacy systems', () => {
  assert.deepEqual(resolveLoadoutForVisualPolicy({
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3', modelType: 'large' } as any,
  }), { modelSystem: 'v1' });

  assert.deepEqual(resolveLoadoutForVisualPolicy({
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v3', modelType: 'large' } as any,
  }), { modelSystem: 'v2', modelType: 'medium' });
});

test('resolveLoadoutForVisualPolicy keeps v3 personal customization when policy is v3', () => {
  const loadout = resolveLoadoutForVisualPolicy({
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v3',
      helmet: 'mark-vi',
      hammerPreset: 'gravity-axe',
    } as any,
  });

  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.helmet, 'mark-vi');
  assert.equal(loadout.hammerPreset, 'gravity-axe');
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```powershell
node --import tsx --test src/model/modelVisualPolicy.test.ts
```

Expected: FAIL because `modelVisualPolicy.ts` does not exist.

- [ ] **Step 3: Implement policy resolver**

Create `src/model/modelVisualPolicy.ts`:

```ts
import type { CharacterLoadout } from '../components/VoxelModels';
import { DEFAULT_LOADOUT } from '../components/VoxelModels';
import { resolveCharacterModelType } from '../characterModelTypes';
import {
  normalizeVisualModelPolicy,
  type ModelSystem,
  type VisualModelPolicy,
} from './modelSystem';

export interface CombatantVisualModelSystemInput {
  visualModelPolicy?: VisualModelPolicy | null;
  loadout?: CharacterLoadout | null;
}

export function resolveCombatantVisualModelSystem(input: CombatantVisualModelSystemInput): ModelSystem {
  return normalizeVisualModelPolicy(input.visualModelPolicy);
}

export function resolveLoadoutForVisualPolicy(input: CombatantVisualModelSystemInput): CharacterLoadout {
  const modelSystem = resolveCombatantVisualModelSystem(input);
  const base = input.loadout ?? DEFAULT_LOADOUT;

  if (modelSystem === 'v1') {
    return { modelSystem: 'v1' };
  }

  if (modelSystem === 'v2') {
    return {
      ...DEFAULT_LOADOUT,
      ...base,
      modelSystem: 'v2',
      modelType: resolveCharacterModelType(base.modelType, 'v2'),
    };
  }

  return {
    ...DEFAULT_LOADOUT,
    ...base,
    modelSystem: 'v3',
  };
}
```

- [ ] **Step 4: Run resolver tests**

Run:

```powershell
node --import tsx --test src/model/modelVisualPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update remote provisioning to accept visual policy input without changing behavior yet**

In `src/components/grifball/remoteCombatantProvisioning.ts`, add an optional `visualModelPolicy` to the relevant update/provisioning input and route loadout creation through `resolveLoadoutForVisualPolicy`. Preserve the existing AI fallback to V1 until a later phase explicitly upgrades AI model policy.

Target shape:

```ts
const visualLoadout = resolveLoadoutForVisualPolicy({
  visualModelPolicy: data.visualModelPolicy ?? 'v2',
  loadout: data.loadout,
});
```

If the current function does not carry lobby config into this path yet, only add the resolver utility and tests in this task. Do not force a broad runtime wiring change prematurely.

- [ ] **Step 6: Add remote provisioning tests for policy override**

Extend `src/components/grifball/remoteCombatantProvisioning.test.ts` to assert that a remote human with V3 personal loadout can be resolved to V1 or V2 when a forced visual policy is supplied. Keep existing tests for offline AI staying V1 intact until policy wiring intentionally changes bots.

- [ ] **Step 7: Run focused tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/model/modelVisualPolicy.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```powershell
git add src/model/modelVisualPolicy.ts src/model/modelVisualPolicy.test.ts src/components/grifball/remoteCombatantProvisioning.ts src/components/grifball/remoteCombatantProvisioning.test.ts
git commit -m "feat: add visual model policy resolver"
```

Expected: commit succeeds with only Task 5 files.

### Task 6: Document Phase 1 Contracts In README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README section for visual model policy**

Add a concise paragraph near existing multiplayer/model-system documentation:

```md
Model visuals are controlled separately from gameplay collision. Matches can resolve visible combatants through a visual model policy (`v1`, `v2`, or `v3`) while combat ranges, collision, and AI decisions remain normalized. V3 is planned as the advanced default-capable voxel model system, and V1/V2 remain selectable sandbox modes for offline and hosted play.
```

- [ ] **Step 2: Verify README diff is scoped**

Run:

```powershell
git diff -- README.md
```

Expected: only the new visual model policy documentation is present in the diff from this task. If unrelated README edits already exist, do not stage them unless they are yours.

- [ ] **Step 3: Commit Task 6 carefully**

If README had unrelated dirty edits before this task, use patch staging:

```powershell
git add -p README.md
git commit -m "docs: describe visual model policy"
```

Expected: commit includes only this README paragraph. If patch staging is unsafe due to overlapping unrelated edits, skip the commit and note the README update as pending for the branch owner.

### Task 7: Phase 1 Full Verification

**Files:**
- No new files unless fixing failures.

- [ ] **Step 1: Run focused contract tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/model/modelVisualPolicy.test.ts src/network/matchLobbyConfig.test.ts src/components/customArmor.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS, unless unrelated pre-existing dirty-tree issues are present. If it fails, inspect whether the failure belongs to Phase 1 files before editing.

- [ ] **Step 3: Run full tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```powershell
npm run build
```

Expected: PASS. If Windows file locks hit stale `dist/assets`, run `npm run clean` only after confirming the lock is unrelated.

- [ ] **Step 5: Check staged/untracked scope**

Run:

```powershell
git status --short
```

Expected: only unrelated pre-existing dirty files remain, or a clean tree if Phase 1 work was isolated.

---

## Phase 2: Offline Asset Pipeline

Write a dedicated Phase 2 plan before implementation. The Phase 2 plan must expand these tasks into exact code-level steps.

### Task 8: Plan And Build Local Reference-Asset Inspection

**Files:**
- Create: `docs/superpowers/plans/YYYY-MM-DD-v3-offline-asset-pipeline-plan.md`
- Create: `src/tools/v3ObjParser.ts`
- Create: `src/tools/v3ObjParser.test.ts`
- Create: `scripts/v3/inspect-reference-asset.mjs` or `scripts/v3/inspect-reference-asset.ts`

- [ ] **Step 1: Write Phase 2 plan with exact parser and inspection tasks**

The Phase 2 plan must include tests for:

```ts
assert.equal(parsed.objects.length, 12);
assert.equal(parsed.materials.has('spartan_armor'), true);
assert.ok(parsed.vertexCount > 18_000);
assert.ok(parsed.faceCount > 20_000);
```

Use the private local reference files only as local inputs. Do not commit reference `.obj`, `.fbx`, `.blend`, texture, or converted direct-Halo assets.

- [ ] **Step 2: Implement an OBJ metadata parser**

Parser output should include object names, material names, vertex count, face count, and bounds. It should not attempt full production voxelization yet.

- [ ] **Step 3: Verify local reference inspection**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts
```

Expected: PASS.

Run:

```powershell
node scripts/v3/inspect-reference-asset.mjs --obj "C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj"
```

Expected: outputs object/material/bounds summary and does not write committed assets.

### Task 9: Build Developer-Only Voxelization Preview

**Files:**
- Create: `src/tools/v3Voxelize.ts`
- Create: `src/tools/v3Voxelize.test.ts`
- Create: `src/tools/v3AssetValidation.ts`
- Create: `src/tools/v3AssetValidation.test.ts`
- Create: `public/v3-asset-preview.html` or an equivalent local-only preview page

- [ ] **Step 1: Write tests for voxel budget and bounds validation**

Test a synthetic mesh/voxel input, not the private reference file.

- [ ] **Step 2: Implement coarse voxel sampling**

The first implementation should produce deterministic voxel grids from bounds and triangle occupancy at configurable resolutions.

- [ ] **Step 3: Add preview page**

Preview must show resolution, voxel count, material role mapping, part grouping, and LOD estimate.

- [ ] **Step 4: Browser smoke**

Run dev server on port `3000` and open:

```text
http://localhost:3000/v3-asset-preview.html
```

Expected: nonblank preview, visible controls, and no console errors for synthetic assets.

---

## Phase 3: Canonical V3 Model And Weapons

Write a dedicated Phase 3 plan before implementation.

### Task 10: Define Original V3 Manifest Format And Starter Assets

**Files:**
- Create: `src/components/v3/v3ModelTypes.ts`
- Create: `src/components/v3/v3ModelTypes.test.ts`
- Create: `src/components/v3/v3AssetManifest.ts`
- Create: `src/components/v3/v3AssetManifest.test.ts`

- [ ] **Step 1: Define V3 slots, paint roles, and budgets**

Required TypeScript names:

```ts
export type V3ArmorSlot =
  | 'helmet'
  | 'neck'
  | 'chest'
  | 'shoulder'
  | 'upperArm'
  | 'forearm'
  | 'hand'
  | 'pelvis'
  | 'thigh'
  | 'shin'
  | 'foot'
  | 'back';

export type V3PaintRole =
  | 'primary'
  | 'secondary'
  | 'accent'
  | 'undersuit'
  | 'visor'
  | 'emissive'
  | 'decal'
  | 'fixed';
```

- [ ] **Step 2: Add starter original V3 parts**

Start with a minimal original blockout manifest, not a direct reference conversion. Include budget metadata for every part.

- [ ] **Step 3: Add V3 weapon manifest entries**

Include `hammer`, `sword`, and `pistol`, each with grip metadata and budgets.

---

## Phase 4: Runtime Builder And Rig

Write a dedicated Phase 4 plan before implementation.

### Task 11: Add V3 Runtime Builder

**Files:**
- Create: `src/components/v3/VoxelModelsV3.ts`
- Create: `src/components/v3/v3GeometryCache.ts`
- Create: `src/components/v3/v3Lod.ts`
- Modify: `src/components/VoxelModels.ts`
- Modify: `src/components/grifball/combatantModels.ts`
- Create: `src/components/v3/VoxelModelsV3.test.ts`

- [ ] **Step 1: Add tests proving V1/V2 remain unchanged and V3 dispatches separately**

Assertions:

```ts
assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v1' }).userData.modelSystem, undefined);
assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v2' }).userData.modelSystem, 'v2');
assert.equal(buildVoxelSpartanModel(false, 192, { modelSystem: 'v3' }).userData.modelSystem, 'v3');
```

- [ ] **Step 2: Implement V3 builder with starter original blockout assets**

The first V3 builder can use curated blockout parts from `v3AssetManifest.ts` and must expose all rig target groups.

- [ ] **Step 3: Add V3 weapon builders**

Export V3 hammer/sword/pistol builders and route them from `combatantModels.ts` when the resolved loadout is V3.

### Task 12: Add V3 Combatant Rig And First-Person Support

**Files:**
- Create: `src/components/grifball/combatantRigV3.ts`
- Create: `src/components/grifball/combatantRigV3.test.ts`
- Modify: `src/components/grifball/combatantRig.ts`
- Modify: `src/components/grifball/localPlayerViewRuntime.ts`

- [ ] **Step 1: Test V3 bone and socket availability**

Required assertions:

```ts
assert.ok(rig.bones.spineUpper);
assert.ok(rig.bones.hand_r);
assert.ok(rig.attachments.thirdPersonWeaponGrip);
assert.ok(rig.attachments.firstPersonWeaponGrip);
```

- [ ] **Step 2: Implement V3 rig creation**

V3 rig should expose fine-grained bones and a compatibility adapter for broad combatant consumers.

- [ ] **Step 3: Add first-person V3 arms/hands**

First-person grip semantics must match third-person grip names.

---

## Phase 5: Layered Procedural Animation

Write a dedicated Phase 5 plan before implementation.

### Task 13: Add Body-Masked V3 Animation Runtime

**Files:**
- Create: `src/components/grifball/combatantAnimationV3.ts`
- Create: `src/components/grifball/combatantAnimationV3.test.ts`
- Modify: `src/components/grifball/combatantAnimation.ts`

- [ ] **Step 1: Test body-mask isolation**

Required behavior:

```ts
// Upper-body hammer windup changes spine/chest/arms.
// Lower-body leg locomotion remains driven by movement inputs.
// Pistol recoil affects hands/forearms/chest but not feet.
```

- [ ] **Step 2: Implement lower-body locomotion layer**

Include idle, walk, strafe, sprint, crouch, jump/fall, landing, and toe/foot hints.

- [ ] **Step 3: Implement upper-body weapon layers**

Include hammer slam/melee, sword ready/slash/lunge/recover, pistol ready/fire/recover, ball carry/pass.

- [ ] **Step 4: Implement additive and constraint layers**

Include hit reactions, recoil, breathing, shield flare, weapon weight, look/head tracking, grip correction, and practical foot grounding.

---

## Phase 6: Customization And Editors

Write a dedicated Phase 6 plan before implementation.

### Task 14: Add V3 Modular Customization

**Files:**
- Modify: `src/components/main-menu/CustomizationPanel.tsx`
- Modify: `src/components/main-menu/ArmorModelEditor.tsx`
- Modify: `src/armorModelEditorPage.tsx`
- Create: `src/components/v3/v3PartBounds.ts`
- Create: `src/components/v3/v3PartBounds.test.ts`

- [ ] **Step 1: Test visual bounds for V3 custom armor**

Custom parts must be rejected when outside V3 visual bounds or over budget.

- [ ] **Step 2: Add V3 modular part selection and paint roles**

Expose V3 parts and paint roles while preserving V1/V2 customization paths.

### Task 15: Add V3 Animation Editor Targets

**Files:**
- Modify: `animation-editor.html`
- Modify: `src/tools/animationEditor.ts`
- Modify: `src/tools/animationEditorCore.ts`
- Modify: `src/tools/animationEditorCore.test.ts`

- [ ] **Step 1: Add Version 3 option to the editor UI**

Add:

```html
<option value="v3">Version 3 (Advanced)</option>
```

- [ ] **Step 2: Add V3 bone and socket target lists**

V3 target list must include first-person and third-person hammer, sword, and pistol.

- [ ] **Step 3: Add V3 export schema tests**

V3 exports must coexist with V1/V2 editor data.

---

## Phase 7: Match Policy, Multiplayer, Replay, And Loading

Write a dedicated Phase 7 plan before implementation.

### Task 16: Add User-Facing Visual Policy Controls

**Files:**
- Modify: `src/components/main-menu/SandboxSetupPanel.tsx`
- Modify: `src/components/multiplayer/MultiplayerSetupPanel.tsx`
- Modify: `src/settings/saveCodec.ts`
- Modify: `src/components/multiplayer/useGameplayConnection.ts`

- [ ] **Step 1: Add offline model policy control**

Control labels:

```ts
[
  { value: 'v1', label: 'Version 1 Classic' },
  { value: 'v2', label: 'Version 2 Rigged' },
  { value: 'v3', label: 'Version 3 Advanced' },
]
```

- [ ] **Step 2: Add host model policy control**

The host-selected policy must become part of `MatchLobbyConfig`.

### Task 17: Persist Policy In Replay Metadata And Loading Roster

**Files:**
- Modify: `src/components/grifball/replayRecordingRuntime.ts`
- Modify: `src/components/grifball/replayPlaybackVisuals.ts`
- Modify: `src/components/loading/matchLoadingState.ts`
- Modify: `src/components/loading/PlayerModelPreview.tsx`

- [ ] **Step 1: Add replay fallback tests**

Older replays without policy should render with legacy defaults.

- [ ] **Step 2: Add V3 replay metadata**

Persist the match visual policy and sanitized loadouts.

- [ ] **Step 3: Apply policy to loading previews**

Loading roster previews should use the match policy, not only personal loadout.

---

## Phase 8: Performance And Mobile

Write a dedicated Phase 8 plan before implementation.

### Task 18: Add Adaptive V3 Quality Tiers

**Files:**
- Create: `src/components/v3/v3QualityTiers.ts`
- Create: `src/components/v3/v3QualityTiers.test.ts`
- Modify: `src/platform/useBrowserDiagnostics.ts`
- Modify: `src/components/v3/v3Lod.ts`

- [ ] **Step 1: Define quality tiers**

Required tiers:

```ts
export type V3QualityTier = 'low' | 'medium' | 'high' | 'ultra';
```

- [ ] **Step 2: Add automatic default tier selection**

Use hardware/browser/FPS signals where available. Mobile defaults no higher than `medium` until verified.

### Task 19: Verify 8-Combatant V3 Performance

**Files:**
- Create or modify focused test/smoke helpers as needed.
- Update README with measured caveats.

- [ ] **Step 1: Add a deterministic 8-combatant V3 smoke setup**

Smoke should spawn eight visible V3 combatants with V3 weapons and representative animation states.

- [ ] **Step 2: Browser QA desktop and mobile viewports**

Verify nonblank render, stable frame pacing, no obvious overlaps, and no console errors.

---

## Phase 9: Default Rollout

Write a dedicated Phase 9 plan before implementation.

### Task 20: Make V3 The Recommended Default While Preserving Legacy Options

**Files:**
- Modify: `src/model/modelSystem.ts`
- Modify: settings defaults that choose visual model policy
- Modify: `README.md`

- [ ] **Step 1: Confirm all V3 completion criteria**

Required gates:

```powershell
npm run lint
npm test
npm run build
```

Plus browser smoke for editor, preview, live match, replay, loading, desktop, and mobile.

- [ ] **Step 2: Make V3 the recommended default**

V1 and V2 remain selectable in offline and hosted match model-policy controls.

- [ ] **Step 3: Update docs**

README must document the visual-only policy, V3 requirements, V1/V2 fallback options, and any mobile quality-tier behavior.

---

## Master Verification Checklist

Use this checklist at the end of every phase:

- [ ] Focused tests for touched modules pass.
- [ ] `npm run lint` passes or any failure is confirmed unrelated to the phase.
- [ ] `npm test` passes or any failure is confirmed unrelated to the phase.
- [ ] `npm run build` passes or environment-specific blockers are documented.
- [ ] `git diff --check` is clean for touched files.
- [ ] README/docs parity is maintained for user-visible behavior.
- [ ] V1 and V2 behavior remains covered by tests.
- [ ] No arbitrary mesh or private reference data is added to network/save payloads.
- [ ] Runtime/editor parity is addressed when a rig or animation contract changes.

## Execution Notes

- Start implementation with Phase 1.
- Do not commit private reference assets.
- Do not add direct Halo-derived assets to shipped files.
- Keep V3 visual policy independent from gameplay collision and range logic.
- Use frequent commits at the end of each task.
- If a later phase reveals a design mismatch, update the design spec first, then update the relevant phase plan.
