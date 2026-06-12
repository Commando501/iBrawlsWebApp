# V3 Match Policy Multiplayer Replay Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose match-wide V1/V2/V3 visual model policy controls for offline and multiplayer play, apply that policy consistently to live loading previews and runtime visuals, and persist replay visual metadata with safe legacy fallbacks.

**Architecture:** The match visual policy remains a render-only contract layered on top of existing gameplay settings, hitboxes, AI, weapon timings, and network simulation. Offline policy lives in persisted admin settings, multiplayer policy lives in normalized `MatchLobbyConfig.visualModelPolicy`, and render/loading/replay paths resolve a visual loadout from policy plus sanitized player loadouts at the boundary where meshes are built. Older saves, lobbies, and replays normalize to stable defaults without private mesh assets or runtime imports.

**Tech Stack:** TypeScript, React, Three.js, existing V1/V2/V3 voxel model builders, `MatchLobbyConfig`, local save codec, Node test runner with `tsx`, Vite build.

---

## Scope And Guardrails

- Preserve user optionality across V1, V2, and V3. Offline sandbox and multiplayer host setup must expose:

```ts
[
  { value: 'v1', label: 'Version 1 Classic' },
  { value: 'v2', label: 'Version 2 Rigged' },
  { value: 'v3', label: 'Version 3 Advanced' },
]
```

- Treat match visual policy as visual-only. Do not change hitboxes, combat ranges, movement physics, AI target logic, score rules, or weapon timings.
- Do not replace player customization. The player can keep a personal V3 loadout while a match forces V1/V2 visuals.
- Multiplayer host selection is authoritative for the lobby. Clients and observers consume `MatchLobbyConfig.visualModelPolicy`.
- Loading previews must render the match policy for all participants, not the participant's personal model system alone.
- Replays recorded before this phase must keep legacy visuals. Missing replay policy falls back to V1 playback behavior.
- Persist newly recorded replay policy and sanitized loadout metadata only. Do not store raw mesh imports, private reference paths, OBJ/FBX/Blend data, or unsanitized custom payloads.
- End-user tooling stays in-game voxel editing only. Developer mesh tooling remains offline and repo-local.
- README must be kept in parity with added model-policy controls and replay/loading behavior.

## Planned Files

- Modify `src/model/modelSystem.ts`: add shared visual-policy option labels and label lookup.
- Modify `src/model/modelSystem.test.ts`: cover option ordering, labels, and fallback label behavior.
- Modify `src/types.ts`: add persisted `UniversalSettings.visualModelPolicy`, optional replay visual policy, and replay visual-loadout metadata fields without importing `CharacterLoadout`.
- Modify `src/settings/gameplaySettings.ts`: default and normalize persisted offline visual policy.
- Modify `src/settings/saveCodec.ts`: export normalized visual policy inside save payloads.
- Modify `src/settings/saveCodec.test.ts`: prove exported/imported save data preserves the visual policy.
- Modify `src/components/main-menu/SandboxSetupPanel.tsx`: add offline visual model selector.
- Modify `src/components/main-menu/SinglePlayerSetupPanel.tsx`: pass offline visual policy through to sandbox setup.
- Modify `src/components/main-menu/SinglePlayerSetupPanel.test.tsx`: cover the sandbox model selector markup.
- Modify `src/components/main-menu/MainMenuPrimaryPanel.tsx`: pass admin-setting policy and setter through existing play rail.
- Modify `src/components/multiplayer/MultiplayerSetupPanel.tsx`: add host visual policy selector, include policy in created lobby config, and show staging policy.
- Create `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`: cover host UI labels and staged policy text.
- Modify `src/components/multiplayer/useGameplayConnection.ts`: attach lobby visual policy to loading participant updates where available.
- Modify `src/components/loading/loadingTypes.ts`: add optional participant/status `visualModelPolicy`.
- Modify `src/components/loading/matchLoadingState.ts`: normalize optional participant policy while preserving missing-policy fallback.
- Modify `src/components/loading/matchLoadingState.test.ts`: cover policy preservation and loading preview loadout resolution.
- Modify `src/components/loading/PlayerModelPreview.tsx`: resolve preview loadouts through optional policy.
- Modify `src/components/loading/MatchLoadingOverlay.tsx`: pass match policy into solo and multiplayer previews.
- Modify `src/components/loading/useMatchLoadingGate.ts`: send local loading status with active match policy.
- Modify `src/components/ActiveGameSurface.tsx`: pass active policy/loadout metadata into `GrifballGame` and loading overlay.
- Modify `src/components/grifball/GrifballGameProps.ts`: add render-only visual-policy prop.
- Modify `src/components/GrifballGame.tsx`: derive visual loadout for mesh builders while leaving gameplay model-type reads on the raw player loadout.
- Modify `src/components/grifball/mountSceneRuntime.ts`: receive resolved visual loadout for first-person weapon setup.
- Modify `src/components/grifball/viewTargetCallbacks.ts`: receive resolved visual loadout for host/client spectator rebuilds.
- Modify `src/components/grifball/arenaOrchestratorCallbacks.ts`: attach active offline policy to AI mesh provisioning.
- Modify `src/components/grifball/aiOrchestratorBridge.ts`: allow AI event payloads to carry visual policy to the mesh provisioner.
- Modify `src/components/grifball/remoteCombatantProvisioning.ts`: let AI visuals use explicit offline policy while defaulting to V1 when no policy is present.
- Modify `src/components/grifball/remoteCombatantProvisioning.test.ts`: cover default AI V1 plus explicit V2/V3 offline policy.
- Modify `src/components/grifball/localPlayerViewRuntime.test.ts`: cover policy-resolved first-person weapons through resolved loadouts.
- Modify `src/components/grifball/combatantModelRebuild.test.ts`: cover resolved visual loadout for spectator rebuilds without changing gameplay model type.
- Modify `src/components/grifball/replayRecordingRuntime.ts`: persist replay `visualModelPolicy`, local sanitized loadout, and combatant visual loadout map.
- Modify `src/components/grifball/replayRuntimeCallbacks.ts`: pass active visual policy and player loadout into replay recording.
- Create `src/components/grifball/replayVisualMetadata.ts`: normalize replay visual policy, sanitize replay loadouts, and resolve playback loadout per combatant.
- Create `src/components/grifball/replayVisualMetadata.test.ts`: cover legacy replay fallback and V3 replay loadout resolution.
- Modify `src/components/grifball/replayPlaybackVisuals.ts`: build/rebuild replay meshes from replay visual metadata.
- Modify `src/components/grifball/replayPlaybackRuntime.ts`: pass replay data into visual playback.
- Modify `src/components/grifball/replayPlaybackRuntime.test.ts`: cover legacy V1 fallback and V3 playback mesh construction.
- Modify `src/services/replayUpload.ts`: keep sanitized visual metadata when stripping replay PII and avoid raw loadout expansion.
- Modify `src/services/replayUpload.test.ts`: cover replay visual metadata survival through upload sanitization.
- Modify `package.json`: include the Phase 7 tests plus existing V3 policy tests in the enumerated `npm test` command.
- Modify `README.md`: document match model policy controls, loading previews, replay fallback, and V3 visual-only behavior.

---

## Task 1: Shared Visual Policy Settings And Saves

**Files:**
- Modify: `src/model/modelSystem.ts`
- Modify: `src/model/modelSystem.test.ts`
- Modify: `src/types.ts`
- Modify: `src/settings/gameplaySettings.ts`
- Modify: `src/settings/saveCodec.ts`
- Modify: `src/settings/saveCodec.test.ts`

- [ ] **Step 1: Write failing tests for policy options and persisted settings**

Add to `src/model/modelSystem.test.ts`:

```ts
test('visual model policy options expose legacy and advanced labels in order', () => {
  assert.deepEqual(VISUAL_MODEL_POLICY_OPTIONS, [
    { value: 'v1', label: 'Version 1 Classic' },
    { value: 'v2', label: 'Version 2 Rigged' },
    { value: 'v3', label: 'Version 3 Advanced' },
  ]);
});

test('visual model policy labels normalize unknown values to v3', () => {
  assert.equal(getVisualModelPolicyLabel('v1'), 'Version 1 Classic');
  assert.equal(getVisualModelPolicyLabel('v2'), 'Version 2 Rigged');
  assert.equal(getVisualModelPolicyLabel('v3'), 'Version 3 Advanced');
  assert.equal(getVisualModelPolicyLabel('bad'), 'Version 3 Advanced');
});
```

Add to `src/settings/saveCodec.test.ts`:

```ts
test('save codec preserves the selected visual model policy', () => {
  const settings = {
    ...createDefaultAdminSettings('Sptn-4321', 120),
    visualModelPolicy: 'v2' as const,
  };
  const data = buildSaveData(settings, 'Sptn-4321', getDefaultUiLayouts(), DEFAULT_KEYBINDINGS);
  const decoded = decryptSaveCode(encryptSaveData(data));

  assert.equal(decoded.adminSettings.visualModelPolicy, 'v2');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/settings/saveCodec.test.ts
```

Expected: FAIL because `VISUAL_MODEL_POLICY_OPTIONS`, `getVisualModelPolicyLabel`, and persisted `visualModelPolicy` defaults are not implemented.

- [ ] **Step 3: Add shared option labels**

In `src/model/modelSystem.ts`, add:

```ts
export const VISUAL_MODEL_POLICY_OPTIONS = [
  { value: 'v1', label: 'Version 1 Classic' },
  { value: 'v2', label: 'Version 2 Rigged' },
  { value: 'v3', label: 'Version 3 Advanced' },
] as const satisfies readonly { value: VisualModelPolicy; label: string }[];

export function getVisualModelPolicyLabel(value: unknown): string {
  const normalized = normalizeVisualModelPolicy(value);
  return VISUAL_MODEL_POLICY_OPTIONS.find((option) => option.value === normalized)?.label
    ?? VISUAL_MODEL_POLICY_OPTIONS[VISUAL_MODEL_POLICY_OPTIONS.length - 1].label;
}
```

- [ ] **Step 4: Add persisted offline policy to settings**

In `src/types.ts`, add the type import near the top:

```ts
import type { VisualModelPolicy } from './model/modelSystem';
```

Add to `UniversalSettings` near the player identity/model settings:

```ts
visualModelPolicy?: VisualModelPolicy;   // Match-wide visual model set for offline sandbox/tournament previews.
```

In `src/settings/gameplaySettings.ts`, import:

```ts
import { normalizeVisualModelPolicy } from '../model/modelSystem';
```

Add to `DEFAULT_ADMIN_SETTINGS`:

```ts
visualModelPolicy: 'v3',
```

Update `withDefaultGameplaySettings` so imported settings are normalized:

```ts
return {
  ...persistedDefaults,
  ...settings,
  visualModelPolicy: normalizeVisualModelPolicy(settings.visualModelPolicy ?? persistedDefaults.visualModelPolicy),
  hammerAttackAnimation: settings.hammerAttackAnimation ?? persistedDefaults.hammerAttackAnimation,
  hammerSplashVfx: settings.hammerSplashVfx ?? persistedDefaults.hammerSplashVfx,
  swordAttackAnimation: settings.swordAttackAnimation ?? persistedDefaults.swordAttackAnimation,
  swordLungeVfx: settings.swordLungeVfx ?? persistedDefaults.swordLungeVfx,
};
```

- [ ] **Step 5: Normalize save payload policy**

In `src/settings/saveCodec.ts`, import:

```ts
import { normalizeVisualModelPolicy } from '../model/modelSystem';
```

Change `buildSaveData` to normalize the admin payload:

```ts
const { playerHue, playerName: _settingsName, ...restSettings } = settings;
const adminSettings = {
  ...restSettings,
  visualModelPolicy: normalizeVisualModelPolicy(restSettings.visualModelPolicy),
};
return {
  version: 3,
  playerName,
  playerHue: playerHue ?? 200,
  uiLayouts,
  adminSettings,
  keybindings,
  playerLoadout,
  customArmorCatalog,
};
```

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/settings/saveCodec.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add src/model/modelSystem.ts src/model/modelSystem.test.ts src/types.ts src/settings/gameplaySettings.ts src/settings/saveCodec.ts src/settings/saveCodec.test.ts
git commit -m "feat: persist visual model policy"
```

Expected: commit succeeds with only Task 1 files.

## Task 2: Offline Sandbox Visual Policy Controls

**Files:**
- Modify: `src/components/main-menu/SandboxSetupPanel.tsx`
- Modify: `src/components/main-menu/SinglePlayerSetupPanel.tsx`
- Modify: `src/components/main-menu/SinglePlayerSetupPanel.test.tsx`
- Modify: `src/components/main-menu/MainMenuPrimaryPanel.tsx`

- [ ] **Step 1: Write failing sandbox selector markup test**

In `src/components/main-menu/SinglePlayerSetupPanel.test.tsx`, add:

```ts
test('SinglePlayerSetupPanel exposes sandbox visual model policy choices', () => {
  const html = renderToStaticMarkup(
    <SinglePlayerSetupPanel
      {...baseSinglePlayerProps()}
      adminSettings={{ ...DEFAULT_ADMIN_SETTINGS, visualModelPolicy: 'v2' }}
    />
  );

  assert.match(html, /Model Set/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.match(html, /Version 3 Advanced/);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/main-menu/SinglePlayerSetupPanel.test.tsx
```

Expected: FAIL because sandbox setup does not render model policy choices.

- [ ] **Step 3: Add sandbox policy props and selector**

In `src/components/main-menu/SandboxSetupPanel.tsx`, import:

```ts
import { VISUAL_MODEL_POLICY_OPTIONS, type VisualModelPolicy } from '../../model/modelSystem';
```

Change props:

```ts
interface SandboxSetupPanelProps {
  visualModelPolicy: VisualModelPolicy;
  onVisualModelPolicyChange: (policy: VisualModelPolicy) => void;
  onOpenBotSetup: () => void;
}
```

Render this control before the bottom CTA:

```tsx
<div className="rounded-lg border border-white/10 bg-black/30 p-3">
  <div className="mb-2 flex items-center justify-between gap-3">
    <span className="text-[10px] font-mono uppercase tracking-[0.22em] text-white/45">Model Set</span>
    <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300">
      {visualModelPolicy.toUpperCase()}
    </span>
  </div>
  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
    {VISUAL_MODEL_POLICY_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => onVisualModelPolicyChange(option.value)}
        className={`min-h-10 rounded border px-2 text-[10px] font-black uppercase tracking-wider transition-all ${
          visualModelPolicy === option.value
            ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
            : 'border-white/10 bg-black/35 text-white/45 hover:text-white/75'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Pass policy through single-player and primary panels**

In `src/components/main-menu/SinglePlayerSetupPanel.tsx`, import:

```ts
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
```

When rendering `SandboxSetupPanel`, pass:

```tsx
<SandboxSetupPanel
  visualModelPolicy={normalizeVisualModelPolicy(adminSettings.visualModelPolicy)}
  onVisualModelPolicyChange={(visualModelPolicy: VisualModelPolicy) => {
    setAdminSettings((previous) => ({ ...previous, visualModelPolicy }));
  }}
  onOpenBotSetup={onOpenBotSetup}
/>
```

No new `App.tsx` prop is needed because `MainMenuPrimaryPanel` already receives `adminSettings` and `setAdminSettings`.

- [ ] **Step 5: Run focused test and confirm GREEN**

Run:

```powershell
node --import tsx --test src/components/main-menu/SinglePlayerSetupPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/components/main-menu/SandboxSetupPanel.tsx src/components/main-menu/SinglePlayerSetupPanel.tsx src/components/main-menu/SinglePlayerSetupPanel.test.tsx src/components/main-menu/MainMenuPrimaryPanel.tsx
git commit -m "feat: add sandbox model policy controls"
```

Expected: commit succeeds. If `MainMenuPrimaryPanel.tsx` is unchanged after implementation, omit it from `git add`.

## Task 3: Apply Visual Policy To Runtime Mesh Construction

**Files:**
- Modify: `src/components/grifball/GrifballGameProps.ts`
- Modify: `src/components/GrifballGame.tsx`
- Modify: `src/components/grifball/mountSceneRuntime.ts`
- Modify: `src/components/grifball/viewTargetCallbacks.ts`
- Modify: `src/components/grifball/arenaOrchestratorCallbacks.ts`
- Modify: `src/components/grifball/aiOrchestratorBridge.ts`
- Modify: `src/components/grifball/remoteCombatantProvisioning.ts`
- Modify: `src/components/grifball/remoteCombatantProvisioning.test.ts`
- Modify: `src/components/grifball/localPlayerViewRuntime.test.ts`
- Modify: `src/components/grifball/combatantModelRebuild.test.ts`

- [ ] **Step 1: Write failing AI visual-policy tests**

In `src/components/grifball/remoteCombatantProvisioning.test.ts`, keep the existing default AI V1 test and add:

```ts
test('offline AI roster visuals can use explicit V3 visual policy', () => {
  const { state, refs } = createStateAndRefs();

  provisionCombatant(state, refs, 'bot_v3', {
    controller: 'ai',
    playerName: 'Bot',
    hue: 180,
    visualModelPolicy: 'v3',
  });

  const appliedLoadout = getAppliedLoadout(refs, 'bot_v3');
  const meshes = refs.otherPlayerMeshes.get('bot_v3');
  assert.ok(meshes);
  assert.equal(appliedLoadout.modelSystem, 'v3');
  assert.equal(meshes.group.userData.modelSystem, 'v3');
});

test('offline AI roster visuals can use explicit V2 visual policy', () => {
  const { state, refs } = createStateAndRefs();

  provisionCombatant(state, refs, 'bot_v2', {
    controller: 'ai',
    playerName: 'Bot',
    hue: 180,
    modelType: 'large',
    visualModelPolicy: 'v2',
  });

  const appliedLoadout = getAppliedLoadout(refs, 'bot_v2');
  const meshes = refs.otherPlayerMeshes.get('bot_v2');
  assert.ok(meshes);
  assert.equal(appliedLoadout.modelSystem, 'v2');
  assert.equal(appliedLoadout.modelType, 'large');
  assert.equal(meshes.group.userData.modelSystem, 'v2');
});
```

In `src/components/grifball/combatantModelRebuild.test.ts`, add a host/client visual-loadout regression:

```ts
test('host combatant rebuild can receive a V3 visual loadout without changing gameplay model type', () => {
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
  });

  assert.equal(refs.hostGroup?.userData.modelSystem, 'v3');
  assert.equal(state.playerModelType, 'medium');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/combatantModelRebuild.test.ts
```

Expected: FAIL because AI provisioning ignores explicit policy and host rebuild may not have the added assertion support.

- [ ] **Step 3: Derive resolved visual loadout inside GrifballGame**

In `src/components/grifball/GrifballGameProps.ts`, import:

```ts
import { type VisualModelPolicy } from '../../model/modelSystem';
```

Add prop:

```ts
visualModelPolicy?: VisualModelPolicy;
```

In `src/components/GrifballGame.tsx`, import:

```ts
import { normalizeVisualModelPolicy } from '../model/modelSystem';
import { resolveLoadoutForVisualPolicy } from '../model/modelVisualPolicy';
```

After refs/state initialization, derive render-only policy and loadout:

```ts
const activeVisualModelPolicy = normalizeVisualModelPolicy(
  matchLobbyConfig?.visualModelPolicy ?? visualModelPolicy ?? adminSettings.visualModelPolicy
);
const visualPlayerLoadout = useMemo(
  () => resolveLoadoutForVisualPolicy({
    visualModelPolicy: activeVisualModelPolicy,
    loadout: playerLoadout,
  }),
  [activeVisualModelPolicy, playerLoadout]
);
```

Keep existing gameplay model-type logic on the raw `playerLoadout`:

```ts
stateRef.current.playerModelType = resolveCharacterModelType(playerLoadout?.modelType, playerLoadout?.modelSystem);
```

- [ ] **Step 4: Pass resolved visual loadout to mesh builders**

Where `initializeGrifballMountSceneForState` is called from `src/components/GrifballGame.tsx`, pass:

```ts
playerLoadout: visualPlayerLoadout,
```

Where `createViewTargetCallbacksForState` is called, pass:

```ts
playerLoadout: visualPlayerLoadout,
```

Where `createArenaOrchestratorCallbacksForState` is called, pass:

```ts
getVisualModelPolicy: () => activeVisualModelPolicy,
```

Ensure the dependency arrays for callbacks/effects include `activeVisualModelPolicy` and `visualPlayerLoadout` where React requires it.

- [ ] **Step 5: Attach offline policy to AI provisioning**

In `src/components/grifball/arenaOrchestratorCallbacks.ts`, import:

```ts
import { type VisualModelPolicy } from '../../model/modelSystem';
```

Add option:

```ts
getVisualModelPolicy: () => VisualModelPolicy;
```

Wrap AI payloads in `createOrUpdateRemotePlayer`:

```ts
const createOrUpdateRemotePlayer = (clientId: string, data: any) => {
  const state = getState();
  const payload = data?.controller === 'ai'
    ? { ...data, visualModelPolicy: getVisualModelPolicy() }
    : data;
  createOrUpdateRemoteCombatantForState({
    state,
    refs: getRefs(),
    clientId,
    data: payload,
    opponentClientId,
    activeCustomMap: getActiveCustomMap(),
    spawnPoints,
    constrainCombatantToArena,
  });
};
```

In `src/components/grifball/remoteCombatantProvisioning.ts`, change AI visual loadout resolution:

```ts
if (data.controller === 'ai') {
  const visualModelPolicy = data.visualModelPolicy ?? 'v1';
  const loadout = visualModelPolicy === 'v2'
    ? { modelSystem: 'v2' as const, modelType }
    : data.loadout;
  return resolveLoadoutForVisualPolicy({
    visualModelPolicy,
    loadout,
  });
}
```

This keeps legacy AI V1 when no policy is present and enables explicit V2/V3 offline policy.

- [ ] **Step 6: Run focused runtime tests and confirm GREEN**

Run:

```powershell
node --import tsx --test src/model/modelVisualPolicy.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/combatantModelRebuild.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```powershell
git add src/components/grifball/GrifballGameProps.ts src/components/GrifballGame.tsx src/components/grifball/mountSceneRuntime.ts src/components/grifball/viewTargetCallbacks.ts src/components/grifball/arenaOrchestratorCallbacks.ts src/components/grifball/aiOrchestratorBridge.ts src/components/grifball/remoteCombatantProvisioning.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/combatantModelRebuild.test.ts
git commit -m "feat: apply match visual policy to runtime models"
```

Expected: commit succeeds.

## Task 4: Multiplayer Host Policy Controls And Loading Previews

**Files:**
- Modify: `src/components/multiplayer/MultiplayerSetupPanel.tsx`
- Create: `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`
- Modify: `src/components/multiplayer/useGameplayConnection.ts`
- Modify: `src/components/loading/loadingTypes.ts`
- Modify: `src/components/loading/matchLoadingState.ts`
- Modify: `src/components/loading/matchLoadingState.test.ts`
- Modify: `src/components/loading/PlayerModelPreview.tsx`
- Modify: `src/components/loading/MatchLoadingOverlay.tsx`
- Modify: `src/components/loading/useMatchLoadingGate.ts`
- Modify: `src/components/ActiveGameSurface.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write failing multiplayer UI and loading state tests**

Create `src/components/multiplayer/MultiplayerSetupPanel.test.tsx`:

```tsx
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { DEFAULT_ADMIN_SETTINGS } from '../../settings/gameplaySettings';
import { MultiplayerSetupPanel } from './MultiplayerSetupPanel';

const noop = () => {};

const baseProps = (): ComponentProps<typeof MultiplayerSetupPanel> => ({
  connectionMode: 'relay',
  onConnectionModeChange: noop,
  isOnline: true,
  userIp: '127.0.0.1',
  lanIp: '127.0.0.1',
  hostIdCode: '123456',
  connectionStatus: 'idle',
  connectionError: '',
  quickPlayStatus: 'idle',
  adminSettings: { ...DEFAULT_ADMIN_SETTINGS, visualModelPolicy: 'v1' },
  selectedMap: 'hangar',
  onSelectedMapChange: noop,
  lobbyCustomMapData: null,
  onCustomMapDataChange: noop,
  matchLobbyConfig: null,
  multiplayerRole: null,
  multiplayerSocket: null,
  multiplayerPlayerCount: 1,
  lobbyParticipants: [],
  chatMessages: [],
  joinIpOrId: '',
  onJoinIpOrIdChange: noop,
  customUrlInput: '',
  onCustomUrlInputChange: noop,
  onCancelHostOrJoin: noop,
  onCancelQuickPlay: noop,
  onQuickPlay: noop,
  onHostGame: noop,
  onStartHostedMatch: noop,
  onSendChatMessage: noop,
  onJoinGame: noop,
  onApplyMatchmakerUrl: noop,
  onResetMatchmakerUrl: noop,
});

test('MultiplayerSetupPanel exposes host visual model policy choices', () => {
  const html = renderToStaticMarkup(<MultiplayerSetupPanel {...baseProps()} />);

  assert.match(html, /Model Set/);
  assert.match(html, /Version 1 Classic/);
  assert.match(html, /Version 2 Rigged/);
  assert.match(html, /Version 3 Advanced/);
});

test('MultiplayerSetupPanel staging summary shows the lobby model policy', () => {
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
        visualModelPolicy: 'v2',
      }}
      multiplayerSocket={{ readyState: WebSocket.OPEN } as WebSocket}
    />
  );

  assert.match(html, /Models/);
  assert.match(html, /Version 2 Rigged/);
});
```

In `src/components/loading/matchLoadingState.test.ts`, add:

```ts
test('loading participants preserve visual model policy for previews', () => {
  const roster = upsertLoadingSlot({}, {
    clientId: 'guest',
    role: 'client',
    playerName: 'Guest',
    hue: 140,
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3' },
  }, 1_000);

  const participant = deriveMultiplayerLoadingSnapshot(roster, 1_000).participants[0];
  assert.equal(participant.visualModelPolicy, 'v1');
  assert.equal(participant.loadout?.modelSystem, 'v3');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/multiplayer/MultiplayerSetupPanel.test.tsx src/components/loading/matchLoadingState.test.ts
```

Expected: FAIL because the multiplayer selector and participant policy field do not exist.

- [ ] **Step 3: Add multiplayer host policy selector**

In `src/components/multiplayer/MultiplayerSetupPanel.tsx`, import:

```ts
import {
  VISUAL_MODEL_POLICY_OPTIONS,
  getVisualModelPolicyLabel,
  normalizeVisualModelPolicy,
  type VisualModelPolicy,
} from '../../model/modelSystem';
```

Add state:

```ts
const [visualModelPolicy, setVisualModelPolicy] = useState<VisualModelPolicy>(
  normalizeVisualModelPolicy(adminSettings.visualModelPolicy)
);
```

Include it in `activeConfig`:

```ts
visualModelPolicy,
```

Add `visualModelPolicy` to the `useMemo` dependency array.

Add a staging stat:

```tsx
<LobbyStat label="Models" value={getVisualModelPolicyLabel(stagedConfig.visualModelPolicy)} />
```

Render a selector in the host form after game-mode buttons:

```tsx
<div className="rounded border border-white/10 bg-black/25 p-2">
  <div className="mb-1.5 flex items-center justify-between gap-2">
    <span className="text-[10px] text-white/45 uppercase tracking-widest font-mono">Model Set</span>
    <span className="text-[10px] text-cyan-300 uppercase tracking-widest font-mono">
      {visualModelPolicy.toUpperCase()}
    </span>
  </div>
  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
    {VISUAL_MODEL_POLICY_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        onClick={() => setVisualModelPolicy(option.value)}
        className={`min-h-9 rounded border px-2 text-[10px] font-black uppercase tracking-wider ${
          visualModelPolicy === option.value
            ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
            : 'border-white/10 bg-black/35 text-white/45 hover:text-white/75'
        }`}
      >
        {option.label}
      </button>
    ))}
  </div>
</div>
```

- [ ] **Step 4: Normalize loading participant policy**

In `src/components/loading/loadingTypes.ts`, import:

```ts
import type { VisualModelPolicy } from '../../model/modelSystem';
```

Add `visualModelPolicy?: VisualModelPolicy;` to `MultiplayerLoadingParticipant`, `MultiplayerLoadingSlotPayload`, and `MultiplayerLoadingStatusPayload`.

In `src/components/loading/matchLoadingState.ts`, import:

```ts
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
```

Add:

```ts
function normalizeParticipantPolicy(value: unknown): VisualModelPolicy | undefined {
  if (value === undefined || value === null) return undefined;
  return normalizeVisualModelPolicy(value);
}
```

Set the field in both upsert functions:

```ts
visualModelPolicy: normalizeParticipantPolicy(slot.visualModelPolicy) ?? existing?.visualModelPolicy,
```

and:

```ts
visualModelPolicy: normalizeParticipantPolicy(status.visualModelPolicy) ?? existing?.visualModelPolicy,
```

- [ ] **Step 5: Make loading previews policy-aware**

In `src/components/loading/PlayerModelPreview.tsx`, import:

```ts
import { type VisualModelPolicy } from '../../model/modelSystem';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
```

Add prop:

```ts
visualModelPolicy?: VisualModelPolicy | null;
```

Resolve before signature/build:

```ts
const resolvedLoadout = resolveLoadoutForVisualPolicy({
  visualModelPolicy,
  loadout,
});
const loadoutSignature = getPreviewLoadoutSignature(resolvedLoadout);
const paramsRef = useRef({ hue, loadout: resolvedLoadout, loadoutSignature });
```

Use `resolvedLoadout` everywhere the component currently uses `loadout`.

In `src/components/loading/MatchLoadingOverlay.tsx`, add prop:

```ts
visualModelPolicy?: VisualModelPolicy | null;
```

Pass it to solo and roster previews:

```tsx
<PlayerModelPreview
  hue={participant.hue}
  loadout={participant.loadout}
  visualModelPolicy={participant.visualModelPolicy ?? visualModelPolicy}
  className="h-16 w-16"
/>
```

and:

```tsx
<PlayerModelPreview
  hue={playerHue}
  loadout={playerLoadout}
  visualModelPolicy={visualModelPolicy}
  className="min-h-[260px] w-full"
/>
```

- [ ] **Step 6: Send local loading status with match policy**

In `src/components/loading/useMatchLoadingGate.ts`, import `VisualModelPolicy`, add option:

```ts
visualModelPolicy?: VisualModelPolicy | null;
```

Add `visualModelPolicy` to the local `upsertLoadingParticipantStatus` payload and WebSocket `match_loading_status` payload.

In `src/components/multiplayer/useGameplayConnection.ts`, include `visualModelPolicy` when converting `player_joined`, `observer_joined`, and `match_loading_status` messages:

```ts
visualModelPolicy: data.visualModelPolicy ?? matchLobbyConfig?.visualModelPolicy,
```

For `mergeLoadingParticipants(data.participants ?? data.otherPlayers)`, rely on server-provided participant policy when present and on overlay global policy when absent.

- [ ] **Step 7: Pass active policy from App surfaces**

In `src/App.tsx`, import:

```ts
import { normalizeVisualModelPolicy } from './model/modelSystem';
```

After `activeMatchSettings`, derive:

```ts
const activeVisualModelPolicy = normalizeVisualModelPolicy(
  matchLobbyConfig?.visualModelPolicy ?? activeMatchSettings.visualModelPolicy
);
```

Pass `visualModelPolicy={activeVisualModelPolicy}` into `useMatchLoadingGate`, `ActiveGameSurface`, and any direct `MatchLoadingOverlay` usage through existing props.

In `src/components/ActiveGameSurface.tsx`, add prop `visualModelPolicy` and pass it to `GrifballGame` and `MatchLoadingOverlay`.

- [ ] **Step 8: Run focused tests and confirm GREEN**

Run:

```powershell
node --import tsx --test src/components/multiplayer/MultiplayerSetupPanel.test.tsx src/components/loading/matchLoadingState.test.ts src/model/modelVisualPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```powershell
git add src/components/multiplayer/MultiplayerSetupPanel.tsx src/components/multiplayer/MultiplayerSetupPanel.test.tsx src/components/multiplayer/useGameplayConnection.ts src/components/loading/loadingTypes.ts src/components/loading/matchLoadingState.ts src/components/loading/matchLoadingState.test.ts src/components/loading/PlayerModelPreview.tsx src/components/loading/MatchLoadingOverlay.tsx src/components/loading/useMatchLoadingGate.ts src/components/ActiveGameSurface.tsx src/App.tsx
git commit -m "feat: apply model policy to multiplayer loading"
```

Expected: commit succeeds.

## Task 5: Replay Visual Metadata And Playback

**Files:**
- Modify: `src/types.ts`
- Modify: `src/components/grifball/replayRecordingRuntime.ts`
- Modify: `src/components/grifball/replayRuntimeCallbacks.ts`
- Create: `src/components/grifball/replayVisualMetadata.ts`
- Create: `src/components/grifball/replayVisualMetadata.test.ts`
- Modify: `src/components/grifball/replayPlaybackVisuals.ts`
- Modify: `src/components/grifball/replayPlaybackRuntime.ts`
- Modify: `src/components/grifball/replayPlaybackRuntime.test.ts`
- Modify: `src/services/replayUpload.ts`
- Modify: `src/services/replayUpload.test.ts`

- [ ] **Step 1: Add failing replay metadata helper tests**

Create `src/components/grifball/replayVisualMetadata.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ReplayFile } from '../../types';
import {
  DEFAULT_REPLAY_VISUAL_MODEL_POLICY,
  resolveReplayCombatantVisualLoadout,
  resolveReplayVisualModelPolicy,
} from './replayVisualMetadata';

const baseReplay = (overrides: Partial<ReplayFile> = {}): ReplayFile => ({
  id: 'r1',
  name: 'Replay',
  description: '',
  date: new Date(0).toISOString(),
  duration: 1,
  playerHue: 200,
  playerName: 'Player',
  opponentName: 'Bot',
  mapType: 'hangar' as ReplayFile['mapType'],
  mode: 'sandbox',
  maxScore: 25,
  frames: [],
  ...overrides,
});

test('older replays without visual policy use legacy V1 visuals', () => {
  const replay = baseReplay();

  assert.equal(resolveReplayVisualModelPolicy(replay), DEFAULT_REPLAY_VISUAL_MODEL_POLICY);
  assert.deepEqual(resolveReplayCombatantVisualLoadout(replay, 'player'), { modelSystem: 'v1' });
});

test('V3 replay visual policy resolves sanitized stored loadouts', () => {
  const replay = baseReplay({
    visualModelPolicy: 'v3',
    visualLoadouts: {
      player: {
        modelSystem: 'v3',
        helmet: 'odst',
        rawMesh: { vertices: [1, 2, 3] },
      } as any,
    },
  });

  const loadout = resolveReplayCombatantVisualLoadout(replay, 'player') as any;
  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.helmet, 'odst');
  assert.equal(loadout.rawMesh, undefined);
});
```

- [ ] **Step 2: Add failing playback mesh test**

In `src/components/grifball/replayPlaybackRuntime.test.ts`, add:

```ts
test('replay visuals use legacy V1 loadout when replay has no visual policy', () => {
  const scene = new THREE.Scene();
  const refs = {
    scene,
    otherPlayerMeshes: new Map(),
    damageExplosionParticles: [],
    enemyGroup: null,
    hostGroup: null,
  } as any;

  updateReplayCombatantVisualsForFrame({
    refs,
    replayData: {
      id: 'old',
      name: 'Old Replay',
      description: '',
      date: new Date(0).toISOString(),
      duration: 1,
      playerHue: 200,
      playerName: 'Player',
      opponentName: 'Bot',
      mapType: 'hangar',
      mode: 'sandbox',
      maxScore: 25,
      frames: [],
    } as any,
    updatedPlayers: new Map([['player', {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0,
      crouchScaleY: 1,
      hp: 5,
      activeWeapon: 'hammer',
      weaponState: 'ready',
      isCrouching: false,
      isLunging: false,
      isDashing: false,
      isSprinting: false,
      isSliding: false,
      weaponTimer: 0,
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
    animateSpartanModel: () => {},
    renderSwordLungeTrailVfx: () => {},
    updateBlinking: () => {},
  });

  const meshes = refs.otherPlayerMeshes.get('player');
  assert.ok(meshes);
  assert.equal(meshes.group.userData.appliedLoadoutKey, JSON.stringify({ modelSystem: 'v1' }));
  assert.notEqual(meshes.group.userData.modelSystem, 'v3');
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/grifball/replayVisualMetadata.test.ts src/components/grifball/replayPlaybackRuntime.test.ts
```

Expected: FAIL because replay visual metadata helpers and `replayData` playback input do not exist.

- [ ] **Step 4: Extend replay file metadata types without importing VoxelModels**

In `src/types.ts`, add to `ReplayFile`:

```ts
/** Match visual model policy used when the replay was recorded. Missing means legacy V1 playback. */
visualModelPolicy?: VisualModelPolicy;
/** Sanitized loadout-like metadata keyed by replay combatant id. Values are re-sanitized before playback. */
visualLoadouts?: Record<string, Record<string, unknown>>;
```

Do not import `CharacterLoadout` into `src/types.ts`; `VoxelModels.ts` already imports from `types.ts`.

- [ ] **Step 5: Add replay visual metadata helper**

Create `src/components/grifball/replayVisualMetadata.ts`:

```ts
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { resolveLoadoutForVisualPolicy } from '../../model/modelVisualPolicy';
import type { ReplayFile } from '../../types';
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
import type { CharacterLoadout } from '../VoxelModels';

export const DEFAULT_REPLAY_VISUAL_MODEL_POLICY: VisualModelPolicy = 'v1';

export function resolveReplayVisualModelPolicy(replay: ReplayFile | null | undefined): VisualModelPolicy {
  return normalizeVisualModelPolicy(replay?.visualModelPolicy, DEFAULT_REPLAY_VISUAL_MODEL_POLICY);
}

export function sanitizeReplayVisualLoadout(value: unknown): CharacterLoadout | undefined {
  return sanitizeCharacterLoadoutForNetwork(value) as CharacterLoadout | undefined;
}

export function resolveReplayCombatantVisualLoadout(
  replay: ReplayFile | null | undefined,
  combatantId: string
): CharacterLoadout {
  const stored = replay?.visualLoadouts?.[combatantId];
  return resolveLoadoutForVisualPolicy({
    visualModelPolicy: resolveReplayVisualModelPolicy(replay),
    loadout: sanitizeReplayVisualLoadout(stored),
  });
}
```

- [ ] **Step 6: Persist replay visual policy and sanitized loadouts**

In `src/components/grifball/replayRecordingRuntime.ts`, import:

```ts
import { normalizeVisualModelPolicy, type VisualModelPolicy } from '../../model/modelSystem';
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
import type { CharacterLoadout } from '../VoxelModels';
```

Add params to `initializeReplayRecordingForState`:

```ts
visualModelPolicy?: VisualModelPolicy | null;
playerLoadout?: CharacterLoadout;
```

Set replay fields:

```ts
const replayVisualModelPolicy = normalizeVisualModelPolicy(visualModelPolicy ?? adminSettings.visualModelPolicy);
const playerVisualLoadout = sanitizeCharacterLoadoutForNetwork(playerLoadout) as Record<string, unknown> | undefined;
```

Inside the `ReplayFile` object:

```ts
visualModelPolicy: replayVisualModelPolicy,
visualLoadouts: playerVisualLoadout ? { player: playerVisualLoadout } : {},
```

In `recordReplayFrameForState`, when recording an `otherPlayers` frame, preserve an existing sanitized loadout if the combatant exposes one:

```ts
const visualLoadout = sanitizeCharacterLoadoutForNetwork((bot as { loadout?: unknown }).loadout);
if (visualLoadout) {
  replayRecordingRef.current.visualLoadouts = {
    ...(replayRecordingRef.current.visualLoadouts ?? {}),
    [id]: visualLoadout as Record<string, unknown>,
  };
}
```

In `src/components/grifball/replayRuntimeCallbacks.ts`, pass `visualModelPolicy` and `playerLoadout` from `GrifballGame`.

- [ ] **Step 7: Apply replay visual metadata during playback**

In `src/components/grifball/replayPlaybackVisuals.ts`, import:

```ts
import { type ReplayFile } from '../../types';
import { resolveReplayCombatantVisualLoadout } from './replayVisualMetadata';
```

Add `replayData: ReplayFile | null;` to `updateReplayCombatantVisualsForFrame` params.

Before mesh creation:

```ts
const visualLoadout = resolveReplayCombatantVisualLoadout(replayData, id);
const visualLoadoutKey = JSON.stringify(visualLoadout);
```

Replace the mesh creation block:

```ts
if (!meshes || meshes.group.userData.appliedHue !== player.hue || meshes.group.userData.appliedLoadoutKey !== visualLoadoutKey) {
  if (meshes?.group) scene.remove(meshes.group);
  meshes = createCombatantMeshRig(scene, player.hue, false, visualLoadout);
  meshes.group.userData.appliedLoadoutKey = visualLoadoutKey;
  refs.otherPlayerMeshes.set(id, meshes);
}
```

In `src/components/grifball/replayPlaybackRuntime.ts`, pass:

```ts
replayData,
```

- [ ] **Step 8: Keep replay upload visual metadata sanitized**

In `src/services/replayUpload.ts`, ensure `stripReplayPII` keeps `visualModelPolicy` and sanitizes `visualLoadouts`:

```ts
if (clone.visualLoadouts) {
  clone.visualLoadouts = Object.fromEntries(
    Object.entries(clone.visualLoadouts)
      .map(([id, loadout]) => [id, sanitizeCharacterLoadoutForNetwork(loadout) as Record<string, unknown> | undefined])
      .filter((entry): entry is [string, Record<string, unknown>] => Boolean(entry[1]))
  );
}
```

Add a test in `src/services/replayUpload.test.ts`:

```ts
test('stripReplayPII preserves sanitized visual replay metadata', () => {
  const sanitized = stripReplayPII(replay([]) as ReplayFile & {
    visualModelPolicy: 'v3';
    visualLoadouts: Record<string, Record<string, unknown>>;
  });
  sanitized.visualModelPolicy = 'v3';
  sanitized.visualLoadouts = {
    player: { modelSystem: 'v3', helmet: 'odst', rawMesh: { path: 'private.obj' } } as any,
  };

  const stripped = stripReplayPII(sanitized);
  assert.equal(stripped.visualModelPolicy, 'v3');
  assert.equal(stripped.visualLoadouts?.player.modelSystem, 'v3');
  assert.equal((stripped.visualLoadouts?.player as any).rawMesh, undefined);
});
```

- [ ] **Step 9: Run focused replay tests and confirm GREEN**

Run:

```powershell
node --import tsx --test src/components/grifball/replayVisualMetadata.test.ts src/components/grifball/replayPlaybackRuntime.test.ts src/services/replayUpload.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

Run:

```powershell
git add src/types.ts src/components/grifball/replayRecordingRuntime.ts src/components/grifball/replayRuntimeCallbacks.ts src/components/grifball/replayVisualMetadata.ts src/components/grifball/replayVisualMetadata.test.ts src/components/grifball/replayPlaybackVisuals.ts src/components/grifball/replayPlaybackRuntime.ts src/components/grifball/replayPlaybackRuntime.test.ts src/services/replayUpload.ts src/services/replayUpload.test.ts
git commit -m "feat: persist replay model policy metadata"
```

Expected: commit succeeds.

## Task 6: Documentation, Browser Smoke, And Full Verification

**Files:**
- Modify: `package.json`
- Modify: `README.md`

- [ ] **Step 1: Add Phase 7 tests to npm test**

`package.json` currently enumerates test files explicitly. Modify `scripts.test` so it includes each of these paths exactly once:

```text
src/model/modelSystem.test.ts
src/model/modelVisualPolicy.test.ts
src/components/multiplayer/MultiplayerSetupPanel.test.tsx
src/components/grifball/replayVisualMetadata.test.ts
worker/src/modelPolicy.test.ts
```

Use these placements so the script stays scan-friendly:

```text
src/model/modelSystem.test.ts src/model/modelVisualPolicy.test.ts
```

immediately before:

```text
src/features/tournament/tournament.test.ts
```

Add:

```text
src/components/multiplayer/MultiplayerSetupPanel.test.tsx
```

immediately before:

```text
src/components/multiplayer/useMultiplayerSessionState.test.ts
```

Add:

```text
src/components/grifball/replayVisualMetadata.test.ts
```

immediately before:

```text
src/components/grifball/replayPlaybackRuntime.test.ts
```

Add:

```text
worker/src/modelPolicy.test.ts
```

immediately before:

```text
worker/src/displayNames.test.ts
```

Run this assertion after editing:

```powershell
node -e "const s=require('./package.json').scripts.test; for (const p of ['src/model/modelSystem.test.ts','src/model/modelVisualPolicy.test.ts','src/components/multiplayer/MultiplayerSetupPanel.test.tsx','src/components/grifball/replayVisualMetadata.test.ts','worker/src/modelPolicy.test.ts']) { if (!s.includes(p)) throw new Error('missing '+p); }"
```

Expected: command exits 0.

- [ ] **Step 2: Update README**

Add or update the V3 model-system section with:

```md
- Match setup supports a visual model policy for Version 1 Classic, Version 2 Rigged, and Version 3 Advanced models.
- Offline sandbox applies the selected visual policy to the local player and bots while gameplay collision and weapon logic stay unchanged.
- Multiplayer hosts choose the lobby visual policy; clients and observers consume the host `MatchLobbyConfig.visualModelPolicy`.
- Loading screens use the match policy for participant previews.
- New replays store visual policy and sanitized loadout metadata; older replays without policy continue to use legacy V1 playback visuals.
```

- [ ] **Step 3: Run all focused Phase 7 tests**

Run:

```powershell
node --import tsx --test src/model/modelSystem.test.ts src/settings/saveCodec.test.ts src/components/main-menu/SinglePlayerSetupPanel.test.tsx src/components/multiplayer/MultiplayerSetupPanel.test.tsx src/components/loading/matchLoadingState.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/combatantModelRebuild.test.ts src/components/grifball/replayVisualMetadata.test.ts src/components/grifball/replayPlaybackRuntime.test.ts src/services/replayUpload.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run repository verification**

Run:

```powershell
npm run lint
```

Expected: PASS.

Run:

```powershell
npm test
```

Expected: PASS.

Run:

```powershell
npm run build
```

Expected: PASS. Existing chunk-size warnings are acceptable; TypeScript or Vite errors are not.

Run:

```powershell
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 5: Browser smoke the local app**

If a dev server is already running at `http://127.0.0.1:3000`, reuse it. Otherwise start the approved dev server command.

Open:

```text
http://127.0.0.1:3000
```

Check:

- Single Player > Sandbox shows Version 1 Classic, Version 2 Rigged, and Version 3 Advanced.
- Multiplayer > Host a Lobby shows the same model choices.
- Creating a staged lobby with V2 shows `Models: Version 2 Rigged`.
- Starting local sandbox with V1 still renders a match and does not crash loading.
- Starting local sandbox with V3 still renders a match and first-person weapons.
- Loading overlay participant previews do not show a participant's personal V3 model when the match policy is V1.

- [ ] **Step 6: Commit Task 6**

Run:

```powershell
git add package.json README.md
git commit -m "docs: document model policy rollout"
```

Expected: commit succeeds.

## Final Verification Checklist

- [ ] Offline sandbox exposes V1/V2/V3 policy and persists it through admin settings and save-code export/import.
- [ ] Multiplayer host setup includes `visualModelPolicy` in the config sent to `onHostGame`.
- [ ] Relay and worker normalization still default missing lobby policy to V3 for current lobbies.
- [ ] Runtime mesh construction uses the resolved visual policy while raw gameplay model type remains unchanged.
- [ ] Offline AI defaults to legacy V1 when no explicit policy exists and follows explicit V1/V2/V3 policy when present.
- [ ] Loading previews use match policy for local and roster previews.
- [ ] New replays store policy plus sanitized visual loadouts.
- [ ] Older replays with no policy use V1 playback visuals.
- [ ] `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.

## Self-Review

- Spec coverage: V1/V2/V3 optionality is covered by Tasks 1, 2, and 4. Visual-only runtime behavior is covered by Task 3. Loading previews are covered by Task 4. Replay metadata and legacy fallback are covered by Task 5. README and verification are covered by Task 6.
- Placeholder scan: The plan contains no open-ended implementation placeholders. Each code-changing step names exact files, snippets, commands, and expected results.
- Type consistency: `VisualModelPolicy` stays sourced from `src/model/modelSystem.ts`. `UniversalSettings.visualModelPolicy`, `MatchLobbyConfig.visualModelPolicy`, loading participant policy, and replay policy all use or normalize to that union. Replay loadout metadata is typed as sanitized record data in `src/types.ts` to avoid importing `CharacterLoadout` into the central type file.
