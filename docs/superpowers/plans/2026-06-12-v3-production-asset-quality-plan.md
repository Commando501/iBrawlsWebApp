# V3 Production Asset Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the default V3 character and weapon assets from blockout-quality generated shells into measurable production-candidate voxel assets while preserving performance budgets and visual-only gameplay semantics.

**Architecture:** Add a small asset-quality audit module that measures generated voxel payloads without depending on rendered Three.js internals. Then enrich the existing V3 procedural voxel generators with role-aware detail grammar, slot-specific silhouette features, and weapon-specific production details. Keep the manifest, bounds, LOD, and render-quality contracts as the source of truth.

**Tech Stack:** TypeScript, Three.js voxel builders, Node test runner with `tsx`, existing V3 manifest/bounds/LOD modules, existing Vite build.

---

## Scope And Guardrails

- Do not commit private reference OBJ/FBX/Blend files or generated direct conversions.
- Do not add player-facing mesh import/upload paths.
- Do not alter gameplay collision, hitboxes, movement, combat reach, weapon timing, AI, replay timing, or network authority.
- Keep V1 and V2 behavior unchanged.
- Keep all new production-quality checks deterministic and runnable in `npm test`.
- Keep V3 output within existing fit bounds and budget limits.

## Planned Files

- Create `src/components/v3/v3ProductionQuality.ts`
- Create `src/components/v3/v3ProductionQuality.test.ts`
- Modify `src/components/v3/VoxelModelsV3.ts`
- Modify `src/components/v3/VoxelModelsV3.test.ts`
- Modify `package.json`
- Modify `README.md`

---

## Task 1: Production Quality Audit Contracts

**Files:**
- Create: `src/components/v3/v3ProductionQuality.ts`
- Create: `src/components/v3/v3ProductionQuality.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing production-quality audit tests**

Create `src/components/v3/v3ProductionQuality.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { VoxelData } from '../VoxelModels';
import {
  V3_PRODUCTION_QUALITY_THRESHOLDS,
  analyzeV3VoxelQuality,
  classifyV3ProductionReadiness,
} from './v3ProductionQuality';

const blockout: VoxelData[] = [
  { x: 0, y: 0, z: 0, color: '#111111' },
  { x: 1, y: 0, z: 0, color: '#111111' },
  { x: 0, y: 1, z: 0, color: '#111111' },
  { x: 1, y: 1, z: 0, color: '#111111' },
];

const productionCandidate: VoxelData[] = [
  { x: 0, y: 0, z: 0, color: '#111111' },
  { x: 2, y: 0, z: 0, color: '#222222' },
  { x: 0, y: 2, z: 0, color: '#333333' },
  { x: 1, y: 1, z: 1, color: '#44ccff', emissive: true },
  { x: 3, y: 1, z: 0, color: '#eeeeee' },
  { x: 1, y: 3, z: 0, color: '#ffcc00', emissive: true },
  { x: 0, y: 1, z: 2, color: '#222222' },
  { x: 2, y: 2, z: 2, color: '#333333' },
];

describe('V3 production quality audit', () => {
  it('measures material diversity, emissive detail, occupied span, and silhouette variation', () => {
    const report = analyzeV3VoxelQuality(productionCandidate);

    assert.equal(report.voxelCount, productionCandidate.length);
    assert.equal(report.materialCount, 5);
    assert.equal(report.emissiveVoxelCount, 2);
    assert.deepEqual(report.occupiedDimensions, { x: 4, y: 4, z: 3 });
    assert.equal(report.silhouetteColumnCount >= 7, true);
  });

  it('classifies plain blockouts below the production candidate threshold', () => {
    const report = analyzeV3VoxelQuality(blockout);

    assert.equal(classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.characterPart), 'blockout');
  });

  it('classifies richer voxel payloads as production candidates', () => {
    const report = analyzeV3VoxelQuality(productionCandidate);

    assert.equal(
      classifyV3ProductionReadiness(report, {
        minVoxels: 8,
        minMaterials: 4,
        minEmissiveVoxels: 2,
        minSilhouetteColumns: 7,
      }),
      'productionCandidate'
    );
  });
});
```

- [ ] **Step 2: Run the audit test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/v3ProductionQuality.test.ts
```

Expected: FAIL because `v3ProductionQuality.ts` does not exist.

- [ ] **Step 3: Implement the audit module**

Create `src/components/v3/v3ProductionQuality.ts`:

```ts
import type { VoxelData } from '../VoxelModels';

export type V3ProductionReadiness = 'blockout' | 'productionCandidate';

export interface V3ProductionQualityThresholds {
  minVoxels: number;
  minMaterials: number;
  minEmissiveVoxels: number;
  minSilhouetteColumns: number;
}

export interface V3VoxelQualityReport {
  voxelCount: number;
  materialCount: number;
  emissiveVoxelCount: number;
  occupiedDimensions: { x: number; y: number; z: number };
  silhouetteColumnCount: number;
}

export const V3_PRODUCTION_QUALITY_THRESHOLDS = {
  characterPart: {
    minVoxels: 24,
    minMaterials: 3,
    minEmissiveVoxels: 0,
    minSilhouetteColumns: 12,
  },
  weapon: {
    minVoxels: 32,
    minMaterials: 3,
    minEmissiveVoxels: 1,
    minSilhouetteColumns: 18,
  },
} as const satisfies Record<string, V3ProductionQualityThresholds>;

export function analyzeV3VoxelQuality(voxels: readonly VoxelData[]): V3VoxelQualityReport {
  if (voxels.length === 0) {
    return {
      voxelCount: 0,
      materialCount: 0,
      emissiveVoxelCount: 0,
      occupiedDimensions: { x: 0, y: 0, z: 0 },
      silhouetteColumnCount: 0,
    };
  }

  const xs = voxels.map((voxel) => voxel.x);
  const ys = voxels.map((voxel) => voxel.y);
  const zs = voxels.map((voxel) => voxel.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const silhouetteColumns = new Set(voxels.map((voxel) => `${voxel.x},${voxel.y}`));

  return {
    voxelCount: voxels.length,
    materialCount: new Set(voxels.map((voxel) => voxel.color)).size,
    emissiveVoxelCount: voxels.filter((voxel) => voxel.emissive).length,
    occupiedDimensions: {
      x: maxX - minX + 1,
      y: maxY - minY + 1,
      z: maxZ - minZ + 1,
    },
    silhouetteColumnCount: silhouetteColumns.size,
  };
}

export function classifyV3ProductionReadiness(
  report: V3VoxelQualityReport,
  thresholds: V3ProductionQualityThresholds
): V3ProductionReadiness {
  if (
    report.voxelCount >= thresholds.minVoxels &&
    report.materialCount >= thresholds.minMaterials &&
    report.emissiveVoxelCount >= thresholds.minEmissiveVoxels &&
    report.silhouetteColumnCount >= thresholds.minSilhouetteColumns
  ) {
    return 'productionCandidate';
  }

  return 'blockout';
}
```

- [ ] **Step 4: Add the audit test to `npm test`**

Add `src/components/v3/v3ProductionQuality.test.ts` immediately after `src/components/v3/v3PerformanceBudget.test.ts` in `package.json`.

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/components/v3/v3ProductionQuality.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
```

Expected: exits 0.

- [ ] **Step 5: Run focused Task 1 tests**

Run:

```powershell
node --import tsx --test src/components/v3/v3ProductionQuality.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add src/components/v3/v3ProductionQuality.ts src/components/v3/v3ProductionQuality.test.ts package.json
git commit -m "feat: add v3 production quality audit"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: Production-Candidate Character Part Grammar

**Files:**
- Modify: `src/components/v3/VoxelModelsV3.ts`
- Modify: `src/components/v3/VoxelModelsV3.test.ts`

- [ ] **Step 1: Write failing character asset quality tests**

Add to `src/components/v3/VoxelModelsV3.test.ts`:

```ts
import {
  V3_PRODUCTION_QUALITY_THRESHOLDS,
  analyzeV3VoxelQuality,
  classifyV3ProductionReadiness,
} from './v3ProductionQuality';
```

Add this test under `describe('buildV3SpartanModel', ...)`:

```ts
  it('generates production-candidate built-in character part voxel payloads', () => {
    const requiredEmissiveSlots = new Set(['helmet', 'back']);

    for (const slot of V3_CHARACTER_SLOT_IDS) {
      const voxels = getV3BuiltinPartVoxels(slot, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.equal(
        classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.characterPart),
        'productionCandidate',
        `${slot} should be richer than a blockout`
      );

      if (requiredEmissiveSlots.has(slot)) {
        assert.equal(report.emissiveVoxelCount > 0, true, `${slot} should include readable emissive detail`);
      }
    }
  });
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts
```

Expected: FAIL because at least simple slots do not meet the production candidate thresholds.

- [ ] **Step 3: Add role-aware detail grammar**

In `src/components/v3/VoxelModelsV3.ts`, extend `roleColor(...)` so `decal` has a distinct readable color:

```ts
  if (role === 'decal') return '#f8fafc';
```

Add helper functions near `addTranslatedBox(...)`:

```ts
const addPanelStripe = (
  voxels: VoxelData[],
  axis: 'x' | 'y',
  fixedZ: number,
  color: string,
  emissive = false
) => {
  const maxX = Math.max(...voxels.map((voxel) => voxel.x));
  const maxY = Math.max(...voxels.map((voxel) => voxel.y));
  const value = axis === 'x' ? Math.floor(maxY / 2) : Math.floor(maxX / 2);

  for (let index = 1; index < (axis === 'x' ? maxX : maxY); index += 1) {
    voxels.push(axis === 'x'
      ? { x: index, y: value, z: fixedZ, color, emissive }
      : { x: value, y: index, z: fixedZ, color, emissive });
  }
};

const addCornerArmorTabs = (
  voxels: VoxelData[],
  dimensions: [number, number, number],
  color: string
) => {
  const [width, height, depth] = dimensions;
  voxels.push({ x: -1, y: Math.max(1, height - 3), z: Math.floor(depth / 2), color });
  voxels.push({ x: width, y: Math.max(1, height - 3), z: Math.floor(depth / 2), color });
};
```

Then update `createPartVoxels(...)` to add:

```ts
  const frontZ = Math.max(0, depth - 1);

  addPanelStripe(voxels, 'x', frontZ, roleColor('secondary', colors));
  addPanelStripe(voxels, 'y', frontZ, roleColor('accent', colors), part.paintRoles.includes('emissive'));
  addCornerArmorTabs(voxels, dimensions, roleColor('fixed', colors));

  if (part.paintRoles.includes('decal')) {
    const decalColor = roleColor('decal', colors);
    for (let y = 1; y < height - 1; y += 2) {
      voxels.push({ x: Math.floor(width / 2), y, z: frontZ + 1, color: decalColor });
    }
  }
```

Keep the existing visor/emissive behavior and custom armor path.

- [ ] **Step 4: Run focused character tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/v3/v3ProductionQuality.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts
git commit -m "feat: enrich v3 character asset grammar"
```

Expected: commit succeeds with only Task 2 files.

---

## Task 3: Production-Candidate Weapon Grammar

**Files:**
- Modify: `src/components/v3/VoxelModelsV3.ts`
- Modify: `src/components/v3/VoxelModelsV3.test.ts`

- [ ] **Step 1: Write failing weapon quality tests**

Add this import in `src/components/v3/VoxelModelsV3.test.ts` if not already present:

```ts
  getV3BuiltinWeaponVoxels,
```

Add under `describe('V3 weapon builders', ...)`:

```ts
  it('generates production-candidate built-in weapon voxel payloads', () => {
    for (const weapon of V3_WEAPON_IDS) {
      const voxels = getV3BuiltinWeaponVoxels(weapon, 192);
      const report = analyzeV3VoxelQuality(voxels);

      assert.equal(
        classifyV3ProductionReadiness(report, V3_PRODUCTION_QUALITY_THRESHOLDS.weapon),
        'productionCandidate',
        `${weapon} should be richer than a blockout`
      );
      assert.equal(report.emissiveVoxelCount > 0, true, `${weapon} should expose readable emissive weapon state`);
    }
  });
```

- [ ] **Step 2: Run focused test and confirm RED**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts
```

Expected: FAIL because `getV3BuiltinWeaponVoxels` is not exported yet or weapon payloads do not meet thresholds.

- [ ] **Step 3: Export weapon voxel payloads and add richer weapon detail**

In `src/components/v3/VoxelModelsV3.ts`, rename `createWeaponVoxels(...)` to:

```ts
export function getV3BuiltinWeaponVoxels(weapon: V3WeaponId, customHue?: number): VoxelData[] {
  const colors = createColors(false, customHue);
  const voxels: VoxelData[] = [];
  ...
}
```

Update `buildV3WeaponModel(...)`:

```ts
  const group = createVoxelGroup(getV3BuiltinWeaponVoxels(weapon, options.customHue), V3_WEAPON_SCALE);
```

Enrich each weapon branch:

- Hammer: add side plates, counterweight, emissive impact cells, and secondary grip bands.
- Sword: add twin prongs, guard fins, emissive spine, and alternating accent edge cells.
- Pistol: add grip, slide, sight post, muzzle cells, and emissive chamber.

Keep every generated weapon within `V3_WEAPON_BOUNDS`.

- [ ] **Step 4: Run focused weapon tests**

Run:

```powershell
node --import tsx --test src/components/v3/VoxelModelsV3.test.ts src/components/v3/v3ProductionQuality.test.ts src/components/v3/v3PartBounds.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add src/components/v3/VoxelModelsV3.ts src/components/v3/VoxelModelsV3.test.ts
git commit -m "feat: enrich v3 weapon asset grammar"
```

Expected: commit succeeds with only Task 3 files.

---

## Task 4: Documentation, Preview Checks, And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README production roadmap text**

Add after the Phase 9 paragraph in the V3 Offline Asset Tooling section:

```md
Phase 10 starts the production asset quality pass. Built-in V3 character parts and V3 hammer/sword/pistol visuals now run through deterministic production-quality audits for material diversity, emissive/detail usage, silhouette variation, and budget compliance before they are treated as production candidates.
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

- [ ] **Step 3: Browser smoke V3 previews**

Use the existing local server if it is running from this worktree, or start a local dev server.

Check:

```text
http://127.0.0.1:3000/v3-asset-preview.html
http://127.0.0.1:3000/
```

Required checks:
- `/v3-asset-preview.html` renders nonblank V3 preview content.
- Main menu V3 default remains recommended and V1/V2 remain visible.
- At mobile `390x844`, Model Set buttons do not overflow.

If browser automation is blocked, record the exact blocker and keep CLI evidence.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add README.md
git commit -m "docs: document v3 production asset quality pass"
```

Expected: commit succeeds with only README changes.

---

## Phase 10 Completion Criteria

- V3 production quality audit contracts exist and are included in `npm test`.
- Built-in V3 character part voxel payloads classify as production candidates.
- Built-in V3 weapon voxel payloads classify as production candidates.
- V3 fit bounds and performance budgets remain intact.
- README documents Phase 10 as the first production asset quality pass.
- `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.
- Browser smoke for V3 preview/default selector either passes or has an explicit environment blocker.

## Self-Review

- Spec coverage: This plan directly advances the long-term V3 vision by improving shipped original V3 voxel assets before animation/customization/QA polish.
- Placeholder scan: There are no `TBD`, `TODO`, "implement later", or open-ended test instructions.
- Type consistency: The new audit module consumes existing `VoxelData` and does not alter runtime gameplay contracts.
