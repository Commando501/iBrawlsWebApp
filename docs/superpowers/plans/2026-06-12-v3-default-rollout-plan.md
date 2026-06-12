# V3 Default Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make V3 the recommended default model policy while keeping V1 and V2 first-class selectable sandbox options.

**Architecture:** The shared model-policy module remains the source of truth for defaults, labels, and recommended metadata. Settings and lobby normalization continue defaulting missing or invalid policies to V3, but explicit persisted V1/V2 choices are preserved. UI surfaces consume the shared policy metadata so offline and hosted-match selectors communicate the V3 recommendation without changing visual-only gameplay contracts.

**Tech Stack:** TypeScript, React server-render tests, existing model-policy helpers, existing gameplay settings persistence, Node test runner with `tsx`, Vite build.

---

## Scope And Guardrails

- Do not remove V1 or V2 options.
- Do not override an explicit persisted V1 or V2 choice in local settings, save codes, or lobby configs.
- Do not change collision, hitboxes, movement, combat reach, weapon timing, AI, scoring, replay timing, or network authority.
- Do not add private reference assets or arbitrary mesh upload paths.
- Keep all user-facing model policy labels sourced from `src/model/modelSystem.ts`.
- README and the enumerated `npm test` script must stay in parity with new tests.

## Existing Seams

- `src/model/modelSystem.ts` already defines `DEFAULT_MODEL_SYSTEM` and `DEFAULT_VISUAL_MODEL_POLICY` as `v3`.
- `src/settings/gameplaySettings.ts` already sets `DEFAULT_ADMIN_SETTINGS.visualModelPolicy` to `v3` and preserves provided policy values through `withDefaultGameplaySettings`.
- `src/network/matchLobbyConfig.ts` already defaults invalid or missing lobby policy to `v3`.
- `worker/src/index.ts` mirrors `v3` policy defaults for deployed relay sanitation.
- `src/components/main-menu/SandboxSetupPanel.tsx` and `src/components/multiplayer/MultiplayerSetupPanel.tsx` render `VISUAL_MODEL_POLICY_OPTIONS`.
- `README.md` still says V3-by-default matchmaking is a later phase, so docs must be updated.

## Planned Files

- Modify `src/model/modelSystem.ts`
- Modify `src/model/modelSystem.test.ts`
- Create `src/settings/gameplaySettings.test.ts`
- Modify `src/components/main-menu/SinglePlayerSetupPanel.test.tsx`
- Modify `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`
- Modify `package.json`
- Modify `README.md`

---

## Task 1: Recommended Policy Metadata And Default Preservation

**Files:**
- Modify: `src/model/modelSystem.ts`
- Modify: `src/model/modelSystem.test.ts`
- Create: `src/settings/gameplaySettings.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing model-policy tests**

Update `src/model/modelSystem.test.ts` so the option metadata and helper expectations require V3 to be recommended:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_MODEL_SYSTEM,
  DEFAULT_VISUAL_MODEL_POLICY,
  MODEL_SYSTEMS,
  VISUAL_MODEL_POLICY_OPTIONS,
  getRecommendedVisualModelPolicy,
  getVisualModelPolicyLabel,
  isModelSystem,
  isRecommendedVisualModelPolicy,
  normalizeModelSystem,
  normalizeVisualModelPolicy,
} from './modelSystem';
```

Replace the existing `visual model policy labels are shared UI data` test with:

```ts
test('visual model policy labels mark V3 as the recommended default', () => {
  assert.deepEqual(VISUAL_MODEL_POLICY_OPTIONS, [
    {
      value: 'v1',
      label: 'Version 1 Classic',
      recommended: false,
    },
    {
      value: 'v2',
      label: 'Version 2 Rigged',
      recommended: false,
    },
    {
      value: 'v3',
      label: 'Version 3 Advanced (Recommended)',
      recommended: true,
    },
  ]);

  assert.equal(getRecommendedVisualModelPolicy(), 'v3');
  assert.equal(isRecommendedVisualModelPolicy('v3'), true);
  assert.equal(isRecommendedVisualModelPolicy('v1'), false);
  assert.equal(isRecommendedVisualModelPolicy('bad'), false);
  assert.equal(getVisualModelPolicyLabel('v1'), 'Version 1 Classic');
  assert.equal(getVisualModelPolicyLabel('v2'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('v3'), 'Version 3 Advanced (Recommended)');
  assert.equal(getVisualModelPolicyLabel('bad'), 'Version 3 Advanced (Recommended)');
});
```

- [ ] **Step 2: Add gameplay settings preservation tests**

Create `src/settings/gameplaySettings.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_ADMIN_SETTINGS,
  createDefaultAdminSettings,
  withDefaultGameplaySettings,
} from './gameplaySettings';

test('default gameplay settings use the recommended V3 visual model policy', () => {
  assert.equal(DEFAULT_ADMIN_SETTINGS.visualModelPolicy, 'v3');
  assert.equal(createDefaultAdminSettings('Player').visualModelPolicy, 'v3');
  assert.equal(withDefaultGameplaySettings({}).visualModelPolicy, 'v3');
});

test('default rollout preserves explicit legacy visual model policy choices', () => {
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v1' }).visualModelPolicy, 'v1');
  assert.equal(withDefaultGameplaySettings({ visualModelPolicy: 'v2' }).visualModelPolicy, 'v2');
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/settings/gameplaySettings.test.ts
```

Expected: FAIL because `recommended`, `getRecommendedVisualModelPolicy`, and `isRecommendedVisualModelPolicy` do not exist yet.

- [ ] **Step 4: Implement recommended policy metadata**

Modify `src/model/modelSystem.ts`:

```ts
export interface VisualModelPolicyOption {
  value: VisualModelPolicy;
  label: string;
  recommended: boolean;
}

export const VISUAL_MODEL_POLICY_OPTIONS = [
  { value: 'v1', label: 'Version 1 Classic', recommended: false },
  { value: 'v2', label: 'Version 2 Rigged', recommended: false },
  { value: 'v3', label: 'Version 3 Advanced (Recommended)', recommended: true },
] as const satisfies readonly VisualModelPolicyOption[];
```

Add below `normalizeVisualModelPolicy(...)`:

```ts
export function getRecommendedVisualModelPolicy(): VisualModelPolicy {
  return VISUAL_MODEL_POLICY_OPTIONS.find((option) => option.recommended)?.value
    ?? DEFAULT_VISUAL_MODEL_POLICY;
}

export function isRecommendedVisualModelPolicy(value: unknown): value is VisualModelPolicy {
  const normalized = normalizeVisualModelPolicy(value);
  return VISUAL_MODEL_POLICY_OPTIONS.some(
    (option) => option.value === normalized && option.recommended && value === normalized
  );
}
```

Keep `getVisualModelPolicyLabel(...)` using `VISUAL_MODEL_POLICY_OPTIONS`.

- [ ] **Step 5: Add the new settings test to `npm test`**

In `package.json`, add:

```text
src/settings/gameplaySettings.test.ts
```

immediately after:

```text
src/settings/saveCodec.test.ts
```

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/settings/gameplaySettings.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
```

Expected: exits 0.

- [ ] **Step 6: Run focused Task 1 tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/settings/gameplaySettings.test.ts src/settings/saveCodec.test.ts src/network/matchLobbyConfig.test.ts worker/src/modelPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add src/model/modelSystem.ts src/model/modelSystem.test.ts src/settings/gameplaySettings.test.ts package.json
git commit -m "feat: mark v3 as recommended model policy"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: Offline And Multiplayer Recommended UI Coverage

**Files:**
- Modify: `src/components/main-menu/SinglePlayerSetupPanel.test.tsx`
- Modify: `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`

- [ ] **Step 1: Update offline policy UI tests**

Modify `src/components/main-menu/SinglePlayerSetupPanel.test.tsx` in the sandbox visual policy test:

```ts
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
```

Add a new test:

```ts
test('SinglePlayerSetupPanel defaults sandbox model policy to recommended V3', () => {
  const html = renderToStaticMarkup(<SinglePlayerSetupPanel {...baseSinglePlayerProps()} />);

  assert.match(html, /Model Set/);
  assert.match(html, /V3/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});
```

- [ ] **Step 2: Update multiplayer policy UI tests**

Modify `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`:

1. In `baseProps()`, leave `adminSettings: { ...DEFAULT_ADMIN_SETTINGS, visualModelPolicy: 'v1' }` so the legacy path remains covered.
2. In `MultiplayerSetupPanel exposes host visual model policy choices`, change the V3 assertion to:

```ts
assert.match(html, /Version 3 Advanced \(Recommended\)/);
```

Add a new test:

```ts
test('MultiplayerSetupPanel defaults new hosted lobbies to recommended V3', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      adminSettings={{ ...DEFAULT_ADMIN_SETTINGS }}
    />
  );

  assert.match(html, /Model Set/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});
```

Add a V3 staging summary assertion:

```ts
test('MultiplayerSetupPanel staging summary labels recommended V3 policy', () => {
  const html = renderToStaticMarkup(
    <MultiplayerSetupPanel
      {...baseProps()}
      connectionStatus="hosting"
      multiplayerRole="host"
      matchLobbyConfig={{
        access: 'open',
        gameMode: 'sandbox',
        selectedMap: 'hangar',
        customMap: null,
        maxPlayers: 8,
        allowObservers: true,
        matchTimerSeconds: 522,
        winTarget: 25,
        visualModelPolicy: 'v3',
      }}
      multiplayerSocket={{ readyState: 1 } as WebSocket}
    />
  );

  assert.match(html, /Models/);
  assert.match(html, /Version 3 Advanced \(Recommended\)/);
});
```

- [ ] **Step 3: Run focused UI tests**

Run:

```powershell
node --import tsx --test src/components/main-menu/SinglePlayerSetupPanel.test.tsx src/components/multiplayer/MultiplayerSetupPanel.test.tsx
```

Expected: PASS after Task 1 metadata changes.

- [ ] **Step 4: Commit Task 2**

Run:

```powershell
git add src/components/main-menu/SinglePlayerSetupPanel.test.tsx src/components/multiplayer/MultiplayerSetupPanel.test.tsx
git commit -m "test: cover recommended v3 setup labels"
```

Expected: commit succeeds with only Task 2 files.

---

## Task 3: Documentation And Phase 9 Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README V3 phase text**

In the V3 offline tooling section, replace the Phase 7/Phase 8 paragraph sequence with text that includes:

```md
Phase 7 adds match-wide V1/V2/V3 visual policy controls, loading-preview policy resolution, and replay visual metadata.

Phase 8 adds adaptive V3 render quality using the canonical `mobileLow`, `mobile`, `desktop`, and `ultra` tier names. Mobile devices default no higher than `mobile`, and unaccelerated graphics defaults to `mobileLow`. Quality is render-only: selected LODs, budget metadata, and constrained-tier remote animation throttling do not alter hitboxes, movement, AI decisions, weapon timings, scoring, replay timing, or network authority. Use `/v3-performance-smoke.html` while `npm run dev` is running to render eight V3 combatants with mixed hammer/sword/pistol loadouts for desktop and mobile smoke checks.

Phase 9 marks V3 as the recommended default model policy for new offline and hosted matches. V1 Classic and V2 Rigged remain available in the same Model Set controls, and explicit saved or hosted V1/V2 selections are preserved.
```

- [ ] **Step 2: Update README model-system bullets**

In the Spartan Armor section, update the V3 bullet heading to:

```md
- **Version 3 (Advanced, Recommended)**:
```

Update the Match Visual Policy bullet to say:

```md
Match setup recommends **Version 3 Advanced** by default and still supports **Version 1 Classic** and **Version 2 Rigged** model policies.
```

- [ ] **Step 3: Run full verification**

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

- [ ] **Step 4: Browser smoke default/recommended labels**

Use the existing local server if it is running from this worktree. Otherwise start a local built server or dev server.

Check:

```text
http://127.0.0.1:<port>/
```

Desktop checks:
- Offline sandbox setup shows Model Set with V3 selected/recommended by default for fresh settings.
- V1 and V2 buttons remain visible/selectable.
- Multiplayer host setup shows the same three options and recommends V3 for fresh settings.
- Staging/lobby summary shows the selected model policy label.

Mobile check at `390x844`:
- The Model Set buttons remain visible and do not overflow their container.

If the browser environment is blocked, record the exact blocker and keep CLI verification evidence.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add README.md
git commit -m "docs: complete v3 default rollout"
```

Expected: commit succeeds with only README changes.

---

## Final Verification Checklist

- [ ] V3 remains the default model system and visual model policy.
- [ ] V3 is marked as recommended in shared policy metadata and UI labels.
- [ ] V1 and V2 remain selectable in offline and hosted match setup.
- [ ] Explicit saved V1/V2 settings survive defaulting and save-code round trips.
- [ ] Local and Worker lobby normalization still default missing/invalid policy to V3.
- [ ] README no longer says V3-by-default remains a future phase.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.
- [ ] Browser smoke is either passed with desktop/mobile evidence or explicitly reported as environment-blocked.

## Self-Review

- Spec coverage: The plan implements Phase 9 by formalizing V3 as recommended/default, preserving legacy V1/V2 options, and updating docs/tests. It does not change runtime physics, hitboxes, animation contracts, or network authority.
- Placeholder scan: This plan contains no `TBD`, `TODO`, "implement later", or open-ended test instructions.
- Type consistency: New helpers live in `src/model/modelSystem.ts`; tests import exactly those helper names. The existing `VisualModelPolicy` type remains `ModelSystem`, so consumer prop types do not change.
