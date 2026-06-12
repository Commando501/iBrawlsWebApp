# V3 Customization Depth And Creator UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand V3 customization from bounded V3 custom armor support into a practical creator workflow with role-level paint control, weapon paint parity, clearer validation, comparison tools, and better save/load ergonomics.

**Architecture:** This phase builds on the existing `customArmor` catalog, V3 manifests, V3 bounds, V3 armor editor mode, and V3 builders. It adds additive local data contracts and UI helpers only; gameplay collision, hitboxes, network authority, V1/V2 customization, and mesh upload rules stay unchanged. V3 role paint is stored in the existing `paintJob` payload and consumed by V3 character and weapon builders.

**Tech Stack:** TypeScript, React, Three.js, existing localStorage customization state, Node test runner with `tsx`, Vite.

---

## Scope And Guardrails

- Preserve V1 and V2 customization. Existing paint jobs, V2 custom armor, V2 medium/large behavior, and legacy presets must keep working.
- V3 customization remains visual-only. Do not change gameplay collision, melee reach, target hitboxes, AI, scoring, replay timing, weapon timing, or network authority.
- End-user creation remains in the in-game/local voxel editor. Do not add OBJ/FBX/Blend upload, server upload, Worker upload, or runtime mesh import.
- Developer-only offline mesh tooling from Phase 12 remains separate from player-facing customization.
- V3 armor and weapon paint must share the V3 manifest paint-role vocabulary: `primary`, `secondary`, `accent`, `undersuit`, `visor`, `emissive`, `decal`, and `fixed`.
- V3 weapon visuals must receive the same role palette as the V3 character path for local player, bots, remotes, first-person weapons, and preview paths where a loadout is available.
- Keep UI dense and editor-focused. Do not add a marketing or instructional landing surface.

## File Structure

- Create `src/components/v3/v3PaintPalette.ts`: sanitize and resolve V3 role color/emissive overrides.
- Create `src/components/v3/v3PaintPalette.test.ts`: unit coverage for V3 role paint sanitization and fallback behavior.
- Modify `src/components/VoxelModels.ts`: extend `ArmorPaintJob` with V3 role paint fields.
- Modify `src/components/customArmor.ts`: sanitize the new V3 role paint fields in `sanitizeCharacterLoadoutForNetwork()`.
- Modify `src/components/customArmor.test.ts`: preserve sanitized V3 role paint fields and reject malformed color/emissive payloads.
- Modify `src/components/v3/VoxelModelsV3.ts`: route V3 role palette into character parts, custom armor colors, and hammer/sword/pistol builders.
- Modify `src/components/v3/VoxelModelsV3.test.ts`: prove V3 role paint affects character and weapon visuals without affecting V2.
- Modify `src/components/grifball/combatantModels.ts`: pass V3 loadout paint into third-person V3 weapon builders.
- Modify `src/components/grifball/localPlayerViewRuntime.ts`: pass V3 loadout paint into first-person V3 weapon builders.
- Modify related focused tests for combatant/local player weapon color propagation.
- Create `src/components/main-menu/v3PaintRoleControls.ts`: pure helpers for updating V3 paint-role colors/emissive values in a loadout.
- Create `src/components/main-menu/v3PaintRoleControls.test.ts`: helper tests for role update, reset, and payload size safety.
- Modify `src/components/main-menu/ArmoryPanel.tsx`: add V3 role paint controls in the existing Armory panel when V3 is active.
- Create or modify `src/components/main-menu/ArmoryPanel.test.tsx`: static-render coverage for V3 role controls and V1/V2 hiding.
- Create `src/components/main-menu/armorEditorValidation.ts`: pure V3 editor validation/comparison report helpers.
- Create `src/components/main-menu/armorEditorValidation.test.ts`: unit tests for role coverage, budget percent, missing recommended roles, and built-in comparison deltas.
- Modify `src/components/main-menu/ArmorModelEditor.tsx`: render the new validation/comparison report and add save-copy/history restore controls.
- Modify `src/components/customArmor.ts`: add pure helpers for duplicating custom armor variants and restoring history snapshots.
- Modify `src/components/customArmor.test.ts`: cover duplicate and history restore behavior.
- Modify `README.md`: document the customization-depth pass and reiterate no-upload/no-gameplay-change guardrails.
- Modify `package.json`: register all new test files.

---

## Task 1: V3 Role Paint Palette Contracts

**Files:**
- Modify `src/components/VoxelModels.ts`
- Modify `src/components/customArmor.ts`
- Modify `src/components/customArmor.test.ts`
- Create `src/components/v3/v3PaintPalette.ts`
- Create `src/components/v3/v3PaintPalette.test.ts`
- Modify `package.json`

- [ ] **Step 1: Write failing V3 paint palette tests**

Create `src/components/v3/v3PaintPalette.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
  sanitizeV3RolePaintPayload,
} from './v3PaintPalette';

const base = {
  primary: '#111111',
  secondary: '#222222',
  accent: '#333333',
  visor: '#444444',
  dark: '#050505',
  highlight: '#777777',
};

describe('v3PaintPalette', () => {
  it('sanitizes V3 role colors and emissive flags by manifest role', () => {
    const sanitized = sanitizeV3RolePaintPayload({
      v3RoleColors: {
        primary: '#Aa00ff',
        visor: '#00ffaa',
        invalidRole: '#ffffff',
        accent: 'not-a-color',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
        fixed: true,
        invalidRole: true,
      },
    });

    assert.deepEqual(sanitized, {
      v3RoleColors: { primary: '#aa00ff', visor: '#00ffaa' },
      v3RoleEmissive: { primary: false, visor: true, fixed: true },
    });
  });

  it('resolves V3 role colors with paint overrides before hue defaults', () => {
    const paintJob = { v3RoleColors: { primary: '#abcdef', undersuit: '#123456' } };

    assert.equal(resolveV3RoleColor('primary', base, paintJob), '#abcdef');
    assert.equal(resolveV3RoleColor('undersuit', base, paintJob), '#123456');
    assert.equal(resolveV3RoleColor('secondary', base, paintJob), '#222222');
    assert.equal(resolveV3RoleColor('emissive', base, paintJob), '#777777');
    assert.equal(resolveV3RoleColor('decal', base, paintJob), '#f8fafc');
    assert.equal(resolveV3RoleColor('fixed', base, paintJob), '#27272a');
  });

  it('resolves emissive flags with safe defaults', () => {
    const paintJob = { v3RoleEmissive: { primary: true, visor: false } };

    assert.equal(resolveV3RoleEmissive('primary', paintJob, false), true);
    assert.equal(resolveV3RoleEmissive('visor', paintJob, true), false);
    assert.equal(resolveV3RoleEmissive('accent', paintJob, true), true);
  });
});
```

Append to `src/components/customArmor.test.ts`:

```ts
test('sanitizeCharacterLoadoutForNetwork preserves sanitized V3 role paint only', () => {
  const loadout = sanitizeCharacterLoadoutForNetwork({
    modelSystem: 'v3',
    paintJob: {
      v3RoleColors: {
        primary: '#ABCDEF',
        visor: '#00ffaa',
        accent: 'bad-color',
        rawMesh: '#ffffff',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
        rawMesh: true,
      },
    },
  }) as any;

  assert.deepEqual(loadout.paintJob.v3RoleColors, { primary: '#abcdef', visor: '#00ffaa' });
  assert.deepEqual(loadout.paintJob.v3RoleEmissive, { primary: false, visor: true });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/v3PaintPalette.test.ts src/components/customArmor.test.ts
```

Expected: FAIL because `v3PaintPalette.ts` does not exist and `sanitizeCharacterLoadoutForNetwork()` does not sanitize V3 role paint.

- [ ] **Step 3: Extend paint-job contracts**

In `src/components/VoxelModels.ts`, add a type import and extend `ArmorPaintJob`:

```ts
import type { V3PaintRole } from './v3/v3ModelTypes';

export type V3RolePaintColors = Partial<Record<V3PaintRole, string>>;
export type V3RolePaintEmissive = Partial<Record<V3PaintRole, boolean>>;

export interface ArmorPaintJob {
  helmet?: { [key: string]: string };
  torso?: { [key: string]: string };
  leftArm?: { [key: string]: string };
  rightArm?: { [key: string]: string };
  leftLeg?: { [key: string]: string };
  rightLeg?: { [key: string]: string };
  v3RoleColors?: V3RolePaintColors;
  v3RoleEmissive?: V3RolePaintEmissive;
  emissive?: {
    helmet?: { [key: string]: boolean };
    torso?: { [key: string]: boolean };
    leftArm?: { [key: string]: boolean };
    rightArm?: { [key: string]: boolean };
    leftLeg?: { [key: string]: boolean };
    rightLeg?: { [key: string]: boolean };
  };
  baseColors?: {
    helmet?: string;
    torso?: string;
    leftArm?: string;
    rightArm?: string;
    leftLeg?: string;
    rightLeg?: string;
  };
}
```

- [ ] **Step 4: Add V3 paint palette helper**

Create `src/components/v3/v3PaintPalette.ts`:

```ts
import type { ArmorPaintJob } from '../VoxelModels';
import { V3_PAINT_ROLES, type V3PaintRole } from './v3ModelTypes';

export interface V3BasePaintColors {
  primary: string;
  secondary: string;
  accent: string;
  visor: string;
  dark: string;
  highlight: string;
}

export interface SanitizedV3RolePaintPayload {
  v3RoleColors?: Partial<Record<V3PaintRole, string>>;
  v3RoleEmissive?: Partial<Record<V3PaintRole, boolean>>;
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ROLE_SET = new Set<string>(V3_PAINT_ROLES);

const sanitizeColorMap = (value: unknown): Partial<Record<V3PaintRole, string>> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Partial<Record<V3PaintRole, string>> = {};
  for (const [role, color] of Object.entries(value)) {
    if (!ROLE_SET.has(role) || typeof color !== 'string' || !HEX_COLOR.test(color)) continue;
    output[role as V3PaintRole] = color.toLowerCase();
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

const sanitizeEmissiveMap = (value: unknown): Partial<Record<V3PaintRole, boolean>> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const output: Partial<Record<V3PaintRole, boolean>> = {};
  for (const [role, enabled] of Object.entries(value)) {
    if (!ROLE_SET.has(role) || typeof enabled !== 'boolean') continue;
    output[role as V3PaintRole] = enabled;
  }
  return Object.keys(output).length > 0 ? output : undefined;
};

export function sanitizeV3RolePaintPayload(value: unknown): SanitizedV3RolePaintPayload {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { v3RoleColors?: unknown; v3RoleEmissive?: unknown }
    : {};
  const colors = sanitizeColorMap(raw.v3RoleColors);
  const emissive = sanitizeEmissiveMap(raw.v3RoleEmissive);
  return {
    ...(colors ? { v3RoleColors: colors } : {}),
    ...(emissive ? { v3RoleEmissive: emissive } : {}),
  };
}

export function resolveV3RoleColor(
  role: V3PaintRole | string,
  base: V3BasePaintColors,
  paintJob?: Pick<ArmorPaintJob, 'v3RoleColors'>
): string {
  const override = paintJob?.v3RoleColors?.[role as V3PaintRole];
  if (override && HEX_COLOR.test(override)) return override.toLowerCase();
  if (role === 'secondary') return base.secondary;
  if (role === 'accent') return base.accent;
  if (role === 'undersuit') return base.dark;
  if (role === 'visor') return base.visor;
  if (role === 'emissive') return base.highlight;
  if (role === 'decal') return '#f8fafc';
  if (role === 'fixed') return '#27272a';
  return base.primary;
}

export function resolveV3RoleEmissive(
  role: V3PaintRole | string,
  paintJob: Pick<ArmorPaintJob, 'v3RoleEmissive'> | undefined,
  fallback: boolean
): boolean {
  const override = paintJob?.v3RoleEmissive?.[role as V3PaintRole];
  return typeof override === 'boolean' ? override : fallback;
}
```

- [ ] **Step 5: Sanitize V3 role paint in network/loadout sanitation**

In `src/components/customArmor.ts`, import `sanitizeV3RolePaintPayload`:

```ts
import { sanitizeV3RolePaintPayload } from './v3/v3PaintPalette';
```

In `sanitizeCharacterLoadoutForNetwork()`, replace the current broad `paintJob` copy with:

```ts
  if (raw.paintJob && typeof raw.paintJob === 'object' && !Array.isArray(raw.paintJob)) {
    const paintPayload = JSON.stringify(raw.paintJob);
    if (paintPayload.length <= 48_000) {
      const v3Paint = sanitizeV3RolePaintPayload(raw.paintJob);
      out.paintJob = {
        ...raw.paintJob,
        ...(v3Paint.v3RoleColors ? { v3RoleColors: v3Paint.v3RoleColors } : { v3RoleColors: undefined }),
        ...(v3Paint.v3RoleEmissive ? { v3RoleEmissive: v3Paint.v3RoleEmissive } : { v3RoleEmissive: undefined }),
      };
      if (!v3Paint.v3RoleColors) delete out.paintJob.v3RoleColors;
      if (!v3Paint.v3RoleEmissive) delete out.paintJob.v3RoleEmissive;
    }
  }
```

- [ ] **Step 6: Register and verify tests**

Add `src/components/v3/v3PaintPalette.test.ts` to `package.json` near the other V3 tests.

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/components/v3/v3PaintPalette.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
node --import tsx --test src/components/v3/v3PaintPalette.test.ts src/components/customArmor.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add package.json src/components/VoxelModels.ts src/components/customArmor.ts src/components/customArmor.test.ts src/components/v3/v3PaintPalette.ts src/components/v3/v3PaintPalette.test.ts
git commit -m "feat: add v3 role paint palette contracts"
```

---

## Task 2: Route V3 Role Paint Through Character And Weapon Builders

**Files:**
- Modify `src/components/v3/VoxelModelsV3.ts`
- Modify `src/components/v3/VoxelModelsV3.test.ts`
- Modify `src/components/grifball/combatantModels.ts`
- Modify `src/components/grifball/localPlayerViewRuntime.ts`
- Modify related focused tests only if signatures require fixture updates

- [ ] **Step 1: Write failing V3 builder tests**

Append to `src/components/v3/VoxelModelsV3.test.ts`:

```ts
test('V3 character builder applies role paint overrides to built-in and custom armor', () => {
  const loadout = {
    modelSystem: 'v3' as const,
    paintJob: {
      v3RoleColors: {
        primary: '#123456',
        visor: '#abcdef',
      },
      v3RoleEmissive: {
        primary: true,
        visor: false,
      },
    },
  };

  const model = buildV3SpartanModel({ customHue: 200, loadout });
  const colors = collectMeshColors(model);

  assert.equal(colors.has('#123456'), true);
  assert.equal(colors.has('#abcdef'), true);
});

test('V3 weapon builder applies role paint overrides when a loadout is supplied', () => {
  const model = buildV3WeaponModel('hammer', {
    customHue: 200,
    loadout: {
      modelSystem: 'v3',
      paintJob: {
        v3RoleColors: {
          fixed: '#101010',
          emissive: '#00ffcc',
        },
        v3RoleEmissive: {
          fixed: false,
          emissive: true,
        },
      },
    },
  });

  const colors = collectMeshColors(model);

  assert.equal(colors.has('#101010'), true);
  assert.equal(colors.has('#00ffcc'), true);
});
```

If `collectMeshColors()` does not exist in the test file, add this helper near the top:

```ts
function collectMeshColors(root: THREE.Object3D): Set<string> {
  const colors = new Set<string>();
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      const color = (material as THREE.MeshStandardMaterial).color;
      if (color) colors.add(`#${color.getHexString()}`);
    }
  });
  return colors;
}
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts
```

Expected: FAIL because V3 builders ignore `paintJob.v3RoleColors`.

- [ ] **Step 3: Apply palette resolution in V3 builders**

In `src/components/v3/VoxelModelsV3.ts`, import:

```ts
import {
  resolveV3RoleColor,
  resolveV3RoleEmissive,
  type V3BasePaintColors,
} from './v3PaintPalette';
```

Change `V3WeaponBuildOptions`:

```ts
export interface V3WeaponBuildOptions extends V3RenderOptions {
  customHue?: number;
  loadout?: CharacterLoadout;
}
```

Change `createColors()` return type to `V3BasePaintColors`. Replace `roleColor()` with:

```ts
const roleColor = (
  role: string,
  colors: V3BasePaintColors,
  loadout?: CharacterLoadout
): string => resolveV3RoleColor(role, colors, loadout?.paintJob);
```

Where V3 voxels currently use `roleColor(role, colors)`, pass the loadout:

```ts
roleColor(part.paintRoles[0] ?? 'primary', colors, options.loadout)
```

For emissive defaults, wrap existing booleans:

```ts
resolveV3RoleEmissive('emissive', options.loadout?.paintJob, part.paintRoles.includes('emissive'))
```

Create custom armor colors from palette-aware values:

```ts
const createCustomArmorColors = (
  colors: V3BasePaintColors,
  loadout?: CharacterLoadout
): CustomArmorColors => ({
  primary: roleColor('primary', colors, loadout),
  secondary: roleColor('secondary', colors, loadout),
  accent: roleColor('accent', colors, loadout),
  visor: roleColor('visor', colors, loadout),
  dark: roleColor('undersuit', colors, loadout),
  highlight: roleColor('emissive', colors, loadout),
});
```

Use `createCustomArmorColors(colors, options.loadout)` inside `buildV3SpartanModel()`.

Change `getV3BuiltinWeaponVoxels()` to accept an optional loadout:

```ts
export function getV3BuiltinWeaponVoxels(
  weapon: V3WeaponId,
  customHue?: number,
  loadout?: CharacterLoadout
): VoxelData[] {
  const colors = createColors(false, customHue);
  const fixedColor = roleColor('fixed', colors, loadout);
  const emissiveColor = roleColor('emissive', colors, loadout);
  // use fixedColor for fixed/handle blocks and emissiveColor for glowing blocks
}
```

Inside `buildV3WeaponModel()`, call:

```ts
const voxels = getV3BuiltinWeaponVoxels(weapon, options.customHue, options.loadout);
```

Change wrapper signatures without breaking existing callers:

```ts
export function buildV3HammerModel(
  customHue?: number,
  v3Options: V3RenderOptions & { loadout?: CharacterLoadout } = {}
): THREE.Group {
  return buildV3WeaponModel('hammer', { customHue, ...v3Options });
}
```

Repeat for sword and pistol.

- [ ] **Step 4: Pass loadout into live V3 weapon creation**

In `src/components/grifball/combatantModels.ts`, change V3 weapon calls:

```ts
isV3Loadout(loadout) ? buildV3HammerModel(hue, { ...v3Options, loadout }) : buildGravityHammerModel(hue, loadout?.hammerPreset);
isV3Loadout(loadout) ? buildV3SwordModel(hue, { ...v3Options, loadout }) : buildKatarSwordModel(hue, loadout?.swordPreset);
isV3Loadout(loadout) ? buildV3PistolModel(hue, { ...v3Options, loadout }) : buildPistolModel(hue);
```

In `src/components/grifball/localPlayerViewRuntime.ts`, change first-person V3 calls:

```ts
hammer: loadout?.modelSystem === 'v3' ? buildV3HammerModel(hue, { ...v3Options, loadout }) : buildGravityHammerModel(hue, loadout?.hammerPreset),
sword: loadout?.modelSystem === 'v3' ? buildV3SwordModel(hue, { ...v3Options, loadout }) : buildKatarSwordModel(hue, loadout?.swordPreset),
pistol: loadout?.modelSystem === 'v3' ? buildV3PistolModel(hue, { ...v3Options, loadout }) : buildPistolModel(hue),
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/grifball/localPlayerViewRuntime.test.ts src/components/grifball/combatantModelRebuild.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts src/components/grifball/combatantModels.ts src/components/grifball/localPlayerViewRuntime.ts
git commit -m "feat: apply v3 role paint to characters and weapons"
```

---

## Task 3: Armory V3 Role Paint Controls

**Files:**
- Create `src/components/main-menu/v3PaintRoleControls.ts`
- Create `src/components/main-menu/v3PaintRoleControls.test.ts`
- Modify `src/components/main-menu/ArmoryPanel.tsx`
- Create `src/components/main-menu/ArmoryPanel.test.tsx`
- Modify `package.json`

- [ ] **Step 1: Write failing helper and render tests**

Create `src/components/main-menu/v3PaintRoleControls.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resetV3PaintRole,
  updateV3PaintRoleColor,
  updateV3PaintRoleEmissive,
} from './v3PaintRoleControls';

test('updateV3PaintRoleColor stores lowercase hex colors without disturbing legacy paint', () => {
  const next = updateV3PaintRoleColor({
    helmet: { '0,0,0': '#ffffff' },
    v3RoleColors: { primary: '#111111' },
  }, 'visor', '#ABCDEF');

  assert.deepEqual(next.helmet, { '0,0,0': '#ffffff' });
  assert.deepEqual(next.v3RoleColors, { primary: '#111111', visor: '#abcdef' });
});

test('updateV3PaintRoleEmissive stores explicit boolean role flags', () => {
  const next = updateV3PaintRoleEmissive({ v3RoleEmissive: { visor: true } }, 'primary', true);

  assert.deepEqual(next.v3RoleEmissive, { primary: true, visor: true });
});

test('resetV3PaintRole removes both color and emissive overrides for one role', () => {
  const next = resetV3PaintRole({
    v3RoleColors: { primary: '#111111', visor: '#222222' },
    v3RoleEmissive: { primary: true, visor: false },
  }, 'primary');

  assert.deepEqual(next.v3RoleColors, { visor: '#222222' });
  assert.deepEqual(next.v3RoleEmissive, { visor: false });
});
```

Create `src/components/main-menu/ArmoryPanel.test.tsx`:

```tsx
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { ArmoryPanel } from './ArmoryPanel';

const noop = () => {};

const baseProps = (modelSystem: 'v1' | 'v2' | 'v3'): ComponentProps<typeof ArmoryPanel> => ({
  isPainting: false,
  playerLoadout: { modelSystem },
  customArmorCatalog: { version: 1, pieces: [] },
  playerHue: 200,
  customizerWeapon: 'hammer',
  setPlayerLoadout: noop as React.Dispatch<React.SetStateAction<any>>,
  setIsPainting: noop as React.Dispatch<React.SetStateAction<boolean>>,
  setCustomizerWeapon: noop as React.Dispatch<React.SetStateAction<any>>,
  setAdminSettings: noop as React.Dispatch<React.SetStateAction<any>>,
});

test('ArmoryPanel renders V3 material role controls only for V3 loadouts', () => {
  const v3Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v3')} />);
  const v2Html = renderToStaticMarkup(<ArmoryPanel {...baseProps('v2')} />);

  assert.match(v3Html, /V3 Material Roles/);
  assert.match(v3Html, /Primary/);
  assert.match(v3Html, /Emissive/);
  assert.doesNotMatch(v2Html, /V3 Material Roles/);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```powershell
node --import tsx --test src/components/main-menu/v3PaintRoleControls.test.ts src/components/main-menu/ArmoryPanel.test.tsx
```

Expected: FAIL because the helper and rendered V3 controls do not exist.

- [ ] **Step 3: Add pure role control helpers**

Create `src/components/main-menu/v3PaintRoleControls.ts`:

```ts
import type { ArmorPaintJob } from '../VoxelModels';
import type { V3PaintRole } from '../v3/v3ModelTypes';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function updateV3PaintRoleColor(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole,
  color: string
): ArmorPaintJob {
  const normalized = HEX_COLOR.test(color) ? color.toLowerCase() : '#ffffff';
  return {
    ...(paintJob ?? {}),
    v3RoleColors: {
      ...(paintJob?.v3RoleColors ?? {}),
      [role]: normalized,
    },
  };
}

export function updateV3PaintRoleEmissive(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole,
  emissive: boolean
): ArmorPaintJob {
  return {
    ...(paintJob ?? {}),
    v3RoleEmissive: {
      ...(paintJob?.v3RoleEmissive ?? {}),
      [role]: emissive,
    },
  };
}

export function resetV3PaintRole(
  paintJob: ArmorPaintJob | undefined,
  role: V3PaintRole
): ArmorPaintJob {
  const v3RoleColors = { ...(paintJob?.v3RoleColors ?? {}) };
  const v3RoleEmissive = { ...(paintJob?.v3RoleEmissive ?? {}) };
  delete v3RoleColors[role];
  delete v3RoleEmissive[role];
  return {
    ...(paintJob ?? {}),
    v3RoleColors,
    v3RoleEmissive,
  };
}
```

- [ ] **Step 4: Render controls in ArmoryPanel**

In `src/components/main-menu/ArmoryPanel.tsx`, import:

```ts
import { V3_PAINT_ROLES, type V3PaintRole } from '../v3/v3ModelTypes';
import {
  resetV3PaintRole,
  updateV3PaintRoleColor,
  updateV3PaintRoleEmissive,
} from './v3PaintRoleControls';
```

Add helper inside `ArmoryPanel`:

```ts
const updateV3PaintJob = (paintJob: ArmorPaintJob) => {
  updateLoadout({
    modelSystem: 'v3',
    paintJob,
  });
};
```

Add this block after the existing color hue controls and only when `activeModelSystem === 'v3'`:

```tsx
{activeModelSystem === 'v3' && (
  <div className="bg-white/5 border border-white/5 rounded-lg p-3">
    <div className="flex justify-between items-center mb-2">
      <span className="text-xs font-bold text-[#38bdf8] uppercase tracking-wider">V3 Material Roles</span>
      <span className="text-[10px] text-white/45 uppercase tracking-widest">Armor + weapons</span>
    </div>
    <div className="grid grid-cols-2 gap-2">
      {V3_PAINT_ROLES.map((role) => {
        const color = playerLoadout.paintJob?.v3RoleColors?.[role] ?? '#38bdf8';
        const emissive = playerLoadout.paintJob?.v3RoleEmissive?.[role] ?? role === 'emissive' || role === 'visor';
        return (
          <div key={role} className="flex items-center gap-2 bg-black/20 border border-white/5 rounded-md p-2 min-w-0">
            <input
              aria-label={`${role} color`}
              type="color"
              value={color}
              onChange={(event) => updateV3PaintJob(updateV3PaintRoleColor(playerLoadout.paintJob, role as V3PaintRole, event.target.value))}
              className="w-7 h-7 rounded border border-white/10 bg-transparent shrink-0"
            />
            <span className="text-[10px] text-white/70 uppercase truncate flex-1">{role}</span>
            <label className="flex items-center gap-1 text-[9px] text-white/45 uppercase">
              <input
                type="checkbox"
                checked={emissive}
                onChange={(event) => updateV3PaintJob(updateV3PaintRoleEmissive(playerLoadout.paintJob, role as V3PaintRole, event.target.checked))}
                className="w-3 h-3"
              />
              Emissive
            </label>
            <button type="button" onClick={() => updateV3PaintJob(resetV3PaintRole(playerLoadout.paintJob, role as V3PaintRole))} className="text-[9px] text-white/35 hover:text-white">Reset</button>
          </div>
        );
      })}
    </div>
  </div>
)}
```

- [ ] **Step 5: Register tests, verify, and commit**

Add both new tests to `package.json`.

Run:

```powershell
node --import tsx --test src/components/main-menu/v3PaintRoleControls.test.ts src/components/main-menu/ArmoryPanel.test.tsx
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add package.json src/components/main-menu/v3PaintRoleControls.ts src/components/main-menu/v3PaintRoleControls.test.ts src/components/main-menu/ArmoryPanel.tsx src/components/main-menu/ArmoryPanel.test.tsx
git commit -m "feat: add v3 material role controls"
```

---

## Task 4: Armor Editor Validation And Built-In Comparison

**Files:**
- Create `src/components/main-menu/armorEditorValidation.ts`
- Create `src/components/main-menu/armorEditorValidation.test.ts`
- Modify `src/components/main-menu/ArmorModelEditor.tsx`
- Modify `package.json`

- [ ] **Step 1: Write failing validation report tests**

Create `src/components/main-menu/armorEditorValidation.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { CustomArmorPieceSnapshot, CustomArmorValidationResult } from '../customArmor';
import { buildArmorEditorValidationReport } from './armorEditorValidation';

const validation = (overrides: Partial<CustomArmorValidationResult> = {}): CustomArmorValidationResult => ({
  valid: true,
  errors: [],
  warnings: [],
  stats: {
    voxelCount: 4,
    payloadBytes: 400,
    components: 1,
    subpartCounts: {},
    anchorCluster: true,
    modelSystem: 'v3',
    v3Slot: 'helmet',
  },
  ...overrides,
});

const piece = (roles: Array<'primary' | 'secondary' | 'visor'>): CustomArmorPieceSnapshot => ({
  version: 1,
  id: 'draft',
  name: 'Draft',
  slot: 'helmet',
  modelSystem: 'v3',
  voxels: roles.map((role, index) => ({ x: index, y: 0, z: 0, role })),
  updatedAt: 1,
});

test('buildArmorEditorValidationReport reports role coverage and missing V3 recommended roles', () => {
  const report = buildArmorEditorValidationReport({
    draft: piece(['primary']),
    validation: validation(),
    builtInVoxelCount: 10,
    slotBudget: 780,
    recommendedRoles: ['primary', 'secondary', 'visor'],
  });

  assert.equal(report.budgetPercent, 1);
  assert.deepEqual(report.roleCounts, { primary: 1 });
  assert.deepEqual(report.missingRecommendedRoles, ['secondary', 'visor']);
  assert.equal(report.builtInVoxelDelta, -6);
});
```

- [ ] **Step 2: Run test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/main-menu/armorEditorValidation.test.ts
```

Expected: FAIL because `armorEditorValidation.ts` does not exist.

- [ ] **Step 3: Add validation report helper**

Create `src/components/main-menu/armorEditorValidation.ts`:

```ts
import type {
  CustomArmorMaterialRole,
  CustomArmorPieceSnapshot,
  CustomArmorValidationResult,
} from '../customArmor';

export interface ArmorEditorValidationReportInput {
  draft: CustomArmorPieceSnapshot;
  validation: CustomArmorValidationResult;
  builtInVoxelCount: number;
  slotBudget: number;
  recommendedRoles: CustomArmorMaterialRole[];
}

export interface ArmorEditorValidationReport {
  budgetPercent: number;
  roleCounts: Partial<Record<CustomArmorMaterialRole, number>>;
  missingRecommendedRoles: CustomArmorMaterialRole[];
  builtInVoxelDelta: number;
  status: 'pass' | 'warn';
}

export function buildArmorEditorValidationReport(
  input: ArmorEditorValidationReportInput
): ArmorEditorValidationReport {
  const roleCounts: Partial<Record<CustomArmorMaterialRole, number>> = {};
  for (const voxel of input.draft.voxels) {
    roleCounts[voxel.role] = (roleCounts[voxel.role] ?? 0) + 1;
  }

  return {
    budgetPercent: Math.round((input.validation.stats.voxelCount / Math.max(1, input.slotBudget)) * 100),
    roleCounts,
    missingRecommendedRoles: input.recommendedRoles.filter((role) => !roleCounts[role]),
    builtInVoxelDelta: input.validation.stats.voxelCount - input.builtInVoxelCount,
    status: input.validation.valid ? 'pass' : 'warn',
  };
}
```

- [ ] **Step 4: Render report in ArmorModelEditor**

In `src/components/main-menu/ArmorModelEditor.tsx`, import:

```ts
import { buildArmorEditorValidationReport } from './armorEditorValidation';
import { getV3CharacterPartManifest } from '../v3/v3AssetManifest';
```

Add a memo near the existing `validation` memo:

```ts
const editorValidationReport = useMemo(() => {
  const builtIn = modelSystem === 'v3'
    ? getV3BuiltinPartVoxels(slot as V3CustomArmorSlot, playerHue)
    : getVoxelSegmentDataV2(getV2SourceSlot(slot), selectedPreset, playerHue, false, modelType);
  const v3Manifest = modelSystem === 'v3'
    ? getV3CharacterPartManifest(getV3PresetForSlot(slot as V3CustomArmorSlot))
    : undefined;
  const slotBudget = modelSystem === 'v3'
    ? v3Manifest?.budget.sourceVoxelCount ?? validation.stats.voxelCount
    : getCustomArmorSlotSpec(slot, modelType).maxVoxels;
  return buildArmorEditorValidationReport({
    draft,
    validation,
    builtInVoxelCount: builtIn.length,
    slotBudget,
    recommendedRoles: modelSystem === 'v3'
      ? [...(v3Manifest?.paintRoles ?? [])]
      : ['primary', 'secondary', 'accent'],
  });
}, [draft, modelSystem, modelType, playerHue, selectedPreset, slot, validation]);
```

In the validation panel near `Metric label="Vox"`, add:

```tsx
<Metric label="Budget" value={`${editorValidationReport.budgetPercent}%`} />
<Metric label="Built-in Delta" value={editorValidationReport.builtInVoxelDelta > 0 ? `+${editorValidationReport.builtInVoxelDelta}` : String(editorValidationReport.builtInVoxelDelta)} />
```

Below warnings, add:

```tsx
{modelSystem === 'v3' && editorValidationReport.missingRecommendedRoles.length > 0 && (
  <span className="text-[10px] text-amber-300">
    Missing roles: {editorValidationReport.missingRecommendedRoles.join(', ')}
  </span>
)}
```

- [ ] **Step 5: Register tests, verify, and commit**

Add `src/components/main-menu/armorEditorValidation.test.ts` to `package.json`.

Run:

```powershell
node --import tsx --test src/components/main-menu/armorEditorValidation.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add package.json src/components/main-menu/armorEditorValidation.ts src/components/main-menu/armorEditorValidation.test.ts src/components/main-menu/ArmorModelEditor.tsx
git commit -m "feat: improve v3 armor editor validation feedback"
```

---

## Task 5: Creator Save, Duplicate, And History Restore Ergonomics

**Files:**
- Modify `src/components/customArmor.ts`
- Modify `src/components/customArmor.test.ts`
- Modify `src/components/main-menu/ArmorModelEditor.tsx`

- [ ] **Step 1: Write failing custom armor library tests**

Append to `src/components/customArmor.test.ts`:

```ts
test('duplicateCustomArmorPiece creates a new variant without copying history', () => {
  const piece = createCustomArmorPiece('helmet', 'Original', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ], undefined, undefined, 'v3');
  piece.history = [createCustomArmorSnapshot(piece)];

  const copy = duplicateCustomArmorPiece(piece, 'Original Copy');

  assert.notEqual(copy.id, piece.id);
  assert.equal(copy.name, 'Original Copy');
  assert.equal(copy.modelSystem, 'v3');
  assert.equal(copy.history?.length ?? 0, 0);
  assert.deepEqual(copy.voxels, piece.voxels);
});

test('restoreCustomArmorHistoryEntry returns a current snapshot from piece history', () => {
  const piece = createCustomArmorPiece('helmet', 'Current', [
    { x: 0, y: 0, z: 0, role: 'primary' },
    { x: 1, y: 0, z: 0, role: 'secondary' },
    { x: 0, y: 1, z: 0, role: 'visor' },
  ], undefined, undefined, 'v3');
  piece.history = [{
    ...createCustomArmorSnapshot(piece),
    name: 'Previous',
    voxels: [{ x: 0, y: 0, z: 0, role: 'visor' }],
  }];

  const restored = restoreCustomArmorHistoryEntry(piece, 0);

  assert.equal(restored?.id, piece.id);
  assert.equal(restored?.name, 'Previous');
  assert.deepEqual(restored?.voxels, [{ x: 0, y: 0, z: 0, role: 'visor' }]);
});
```

- [ ] **Step 2: Run test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts
```

Expected: FAIL because `duplicateCustomArmorPiece` and `restoreCustomArmorHistoryEntry` do not exist.

- [ ] **Step 3: Add pure library helpers**

In `src/components/customArmor.ts`, export:

```ts
export function duplicateCustomArmorPiece(
  piece: CustomArmorPiece | CustomArmorPieceSnapshot,
  name: string
): CustomArmorPiece {
  const modelSystem = getCustomArmorPieceModelSystem(piece);
  const now = Date.now();
  return {
    ...createCustomArmorSnapshot(piece),
    id: createCustomArmorId(piece.slot, modelSystem),
    name: sanitizePieceName(name, `${piece.name} Copy`),
    modelSystem,
    modelType: modelSystem === 'v2' ? resolveCharacterModelType(piece.modelType, 'v2') : undefined,
    voxels: piece.voxels.map(cloneVoxel),
    thumbnail: createCustomArmorThumbnail(piece.slot, piece.voxels.length, modelSystem),
    createdAt: now,
    updatedAt: now,
    history: [],
  };
}

export function restoreCustomArmorHistoryEntry(
  piece: CustomArmorPiece,
  historyIndex: number
): CustomArmorPieceSnapshot | undefined {
  const entry = piece.history?.[historyIndex];
  if (!entry) return undefined;
  return {
    ...createCustomArmorSnapshot(entry),
    id: piece.id,
    updatedAt: Date.now(),
  };
}
```

- [ ] **Step 4: Add editor controls**

In `src/components/main-menu/ArmorModelEditor.tsx`, import:

```ts
import {
  duplicateCustomArmorPiece,
  restoreCustomArmorHistoryEntry,
} from '../customArmor';
```

Add handlers:

```ts
const saveCopy = () => {
  const copy = duplicateCustomArmorPiece(draft, `${draft.name} Copy`);
  const result = validateCustomArmorPiece(copy);
  if (!result.valid) {
    setStatus('Resolve validation errors before saving a copy.');
    return;
  }
  const snapshot = createCustomArmorSnapshot(copy);
  onCatalogChange((current) => ({ version: 1, pieces: [...current.pieces, copy] }));
  onLoadoutChange({
    modelSystem,
    modelType: modelSystem === 'v2' ? modelType : undefined,
    customArmor: {
      ...(playerLoadout.customArmor ?? {}),
      [slot]: snapshot,
    },
  });
  setDraft(snapshot);
  setStatus(`${copy.name} saved as a new variant.`);
};

const restoreHistory = (piece: CustomArmorPiece, historyIndex: number) => {
  const restored = restoreCustomArmorHistoryEntry(piece, historyIndex);
  if (!restored) {
    setStatus('History entry is unavailable.');
    return;
  }
  replaceDraft(restored);
  setStatus(`${restored.name} restored from history.`);
};
```

Near the existing `Save + Equip` button, add:

```tsx
<button type="button" onClick={saveCopy} className="px-3 h-9 rounded border border-cyan-400/40 bg-cyan-500/15 text-cyan-100 text-[10px] font-black uppercase tracking-widest">
  Save Copy
</button>
```

In the saved-piece list, add for pieces with history:

```tsx
{piece.history && piece.history.length > 0 && (
  <button type="button" onClick={() => restoreHistory(piece, 0)} className="editor-chip">Restore Previous</button>
)}
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
node --import tsx --test src/components/customArmor.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add src/components/customArmor.ts src/components/customArmor.test.ts src/components/main-menu/ArmorModelEditor.tsx
git commit -m "feat: improve v3 armor editor save workflows"
```

---

## Task 6: Documentation, Browser Smoke, And Full Verification

**Files:**
- Modify `README.md`

- [ ] **Step 1: Update README customization depth text**

Add after the Phase 12 paragraph in the V3 Offline Asset Tooling section:

```md
Phase 12B expands V3 creator depth. V3 armor and V3 weapon visuals can share per-role paint overrides, the armory exposes V3 material-role controls, and the armor editor surfaces role coverage, budget comparison, built-in deltas, save-copy, and history restore workflows. These tools stay local and visual-only: V1/V2 customization remains available, gameplay simulation is unchanged, and mesh upload/import remains excluded from player-facing UI.
```

- [ ] **Step 2: Browser smoke the Armory and editor**

Run the dev server if it is not already running:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:3000/
```

Verify:

- Main menu loads without a blank root.
- Armory V3 model selection still exposes V1, V2, and V3 options.
- Selecting V3 shows `V3 Material Roles`.
- Mobile viewport `390x844` has no horizontal overflow in the Armory surface.

Open:

```text
http://127.0.0.1:3000/armor-model-editor.html
```

Verify:

- Page title renders.
- The editor can show V3 mode.
- Validation metrics include `Budget`.
- `Save Copy` is visible.

- [ ] **Step 3: Run full verification**

Run:

```powershell
npm run lint
npm test
npm run build
git diff --check
```

Expected:

- `npm run lint`: PASS.
- `npm test`: PASS with the new V3 paint, armory, validation, and library tests included.
- `npm run build`: PASS; existing large chunk warnings are acceptable.
- `git diff --check`: no whitespace errors.

- [ ] **Step 4: Commit docs**

Commit:

```powershell
git add README.md
git commit -m "docs: document v3 customization depth"
```

---

## Phase Completion Criteria

- V3 role paint overrides are sanitized, persisted, and preserved through loadout normalization.
- V3 character parts, V3 custom armor, and V3 hammer/sword/pistol visuals all consume the same V3 role palette where a loadout is available.
- Armory exposes V3 material-role controls only for V3 loadouts.
- Armor editor shows V3 role coverage, budget percentage, missing recommended roles, and built-in voxel delta.
- Armor editor supports save-copy and restore-previous workflows without breaking existing save/equip behavior.
- V1/V2 customization, V2 large/medium pieces, and legacy paint jobs remain compatible.
- No server, Worker, network upload, gameplay mesh import, or player-facing OBJ/FBX/Blend path is added.
- `npm run lint`, `npm test`, `npm run build`, `git diff --check`, desktop browser smoke, and mobile viewport smoke pass.

## Self-Review

- Spec coverage: This plan targets the remaining customization-depth roadmap requirements: more useful paint/material controls, V3 weapon paint parity, validation feedback, preview comparison, and save/load ergonomics while preserving V1/V2 and no-upload rules.
- Instruction completeness: Checked for deferred-work markers; none are used as implementation instructions.
- Type consistency: The plan consistently uses `v3RoleColors`, `v3RoleEmissive`, `V3PaintRole`, `buildArmorEditorValidationReport`, `duplicateCustomArmorPiece`, and `restoreCustomArmorHistoryEntry`.
