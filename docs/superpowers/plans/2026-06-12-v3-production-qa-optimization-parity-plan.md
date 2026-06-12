# V3 Production QA Optimization Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 13 by proving V3 is production-ready for eight-player visual play across desktop/mobile tiers and every visual policy surface while preserving V1/V2 legacy options and visual-only gameplay isolation.

**Architecture:** Add small pure contracts that make production readiness auditable instead of relying on manual checks. Keep V3 performance smoke, visual-policy parity, loading/replay metadata, and browser smoke evidence as separate modules so runtime code stays scoped and testable.

**Tech Stack:** TypeScript, Node test runner with `tsx`, Three.js scene budget metadata, Vite/browser smoke pages, existing V3 model, loadout, replay, loading, and combatant provisioning contracts.

---

## File Structure

- Create `src/components/v3/v3ProductionParityAudit.ts` to define the required Phase 13 visual surfaces and summarize pass/fail readiness evidence.
- Create `src/components/v3/v3ProductionParityAudit.test.ts` to prove missing, failed, and incomplete parity entries block readiness.
- Modify `src/tools/v3PerformanceSmoke.ts` to add tier-specific eight-combatant budget gates and a production smoke report.
- Modify `src/tools/v3PerformanceSmoke.test.ts` to enforce eight combatants, mixed weapons, V3 role-paint loadouts, quality tiers, and budget thresholds for every V3 quality tier.
- Modify `src/tools/v3PerformanceSmokePage.ts` so the root `v3-performance-smoke.html` page publishes machine-readable Phase 13 smoke data and visible pass/fail text.
- Create `src/tools/v3RuntimeSmoke.ts` to define the required browser smoke URL/viewport checklist.
- Create `src/tools/v3RuntimeSmoke.test.ts` to prove desktop and mobile smoke coverage includes main menu, Armory V3 controls, armor editor, asset preview, and performance smoke.
- Modify `src/components/grifball/remoteCombatantProvisioning.test.ts` to prove V3 role paint survives forced V3 remote policy and V1/V2 forced policies still keep legacy visual behavior.
- Modify `src/components/loading/matchLoadingState.test.ts` to prove loading snapshots preserve V1/V2/V3 policy and sanitized V3 role-paint metadata for participant previews.
- Modify `src/components/grifball/replayVisualMetadata.test.ts` to prove replay V3 role paint survives sanitization while unsafe raw mesh fields remain stripped.
- Modify `package.json` to include the new test files in `npm test`.
- Modify `README.md` to document Phase 13 completion scope and the final V3 completion criteria.

---

### Task 1: V3 Production Parity Audit Contract

**Files:**
- Create: `src/components/v3/v3ProductionParityAudit.ts`
- Create: `src/components/v3/v3ProductionParityAudit.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Add `src/components/v3/v3ProductionParityAudit.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REQUIRED_V3_PRODUCTION_PARITY_SURFACES,
  buildV3ProductionParityReport,
  type V3ProductionParityEvidence,
} from './v3ProductionParityAudit';

const passingEvidence = (
  surface: V3ProductionParityEvidence['surface']
): V3ProductionParityEvidence => ({
  surface,
  status: 'pass',
  modelPolicies: ['v1', 'v2', 'v3'],
  desktopCovered: true,
  mobileCovered: true,
  notes: `${surface} verified`,
});

test('buildV3ProductionParityReport fails when required surfaces are missing', () => {
  const report = buildV3ProductionParityReport([
    passingEvidence('offline'),
    passingEvidence('host'),
  ]);

  assert.equal(report.ready, false);
  assert.ok(report.missingSurfaces.includes('replay'));
  assert.ok(report.missingSurfaces.includes('firstPerson'));
});

test('buildV3ProductionParityReport requires V1 V2 and V3 policy coverage', () => {
  const entries = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence);
  entries[0] = {
    ...entries[0],
    modelPolicies: ['v3'],
  };

  const report = buildV3ProductionParityReport(entries);

  assert.equal(report.ready, false);
  assert.deepEqual(report.incompleteSurfaces, ['offline']);
});

test('buildV3ProductionParityReport requires desktop and mobile coverage', () => {
  const entries = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence);
  entries[1] = {
    ...entries[1],
    mobileCovered: false,
  };

  const report = buildV3ProductionParityReport(entries);

  assert.equal(report.ready, false);
  assert.deepEqual(report.incompleteSurfaces, ['host']);
});

test('buildV3ProductionParityReport passes only with every required surface covered', () => {
  const report = buildV3ProductionParityReport(
    REQUIRED_V3_PRODUCTION_PARITY_SURFACES.map(passingEvidence)
  );

  assert.equal(report.ready, true);
  assert.deepEqual(report.missingSurfaces, []);
  assert.deepEqual(report.failedSurfaces, []);
  assert.deepEqual(report.incompleteSurfaces, []);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/components/v3/v3ProductionParityAudit.test.ts
```

Expected: FAIL because `src/components/v3/v3ProductionParityAudit.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/v3/v3ProductionParityAudit.ts`:

```ts
import type { VisualModelPolicy } from '../../model/modelSystem';

export const REQUIRED_V3_PRODUCTION_PARITY_SURFACES = [
  'offline',
  'host',
  'client',
  'observer',
  'loadingPreview',
  'replay',
  'characterPreview',
  'firstPerson',
  'thirdPerson',
  'armorEditor',
  'animationEditor',
  'performanceSmoke',
] as const;

export type V3ProductionParitySurface = (typeof REQUIRED_V3_PRODUCTION_PARITY_SURFACES)[number];

export interface V3ProductionParityEvidence {
  surface: V3ProductionParitySurface;
  status: 'pass' | 'fail';
  modelPolicies: readonly VisualModelPolicy[];
  desktopCovered: boolean;
  mobileCovered: boolean;
  notes: string;
}

export interface V3ProductionParityReport {
  ready: boolean;
  requiredSurfaces: readonly V3ProductionParitySurface[];
  missingSurfaces: V3ProductionParitySurface[];
  failedSurfaces: V3ProductionParitySurface[];
  incompleteSurfaces: V3ProductionParitySurface[];
  evidence: V3ProductionParityEvidence[];
}

const REQUIRED_POLICIES: readonly VisualModelPolicy[] = ['v1', 'v2', 'v3'];

const hasEveryPolicy = (policies: readonly VisualModelPolicy[]): boolean =>
  REQUIRED_POLICIES.every((policy) => policies.includes(policy));

export function buildV3ProductionParityReport(
  evidence: readonly V3ProductionParityEvidence[]
): V3ProductionParityReport {
  const bySurface = new Map(evidence.map((entry) => [entry.surface, entry]));
  const missingSurfaces = REQUIRED_V3_PRODUCTION_PARITY_SURFACES.filter((surface) => !bySurface.has(surface));
  const failedSurfaces = evidence
    .filter((entry) => entry.status === 'fail')
    .map((entry) => entry.surface);
  const incompleteSurfaces = evidence
    .filter((entry) => (
      entry.status === 'pass' && (
        !hasEveryPolicy(entry.modelPolicies) ||
        !entry.desktopCovered ||
        !entry.mobileCovered ||
        entry.notes.trim().length === 0
      )
    ))
    .map((entry) => entry.surface);

  return {
    ready: missingSurfaces.length === 0 && failedSurfaces.length === 0 && incompleteSurfaces.length === 0,
    requiredSurfaces: REQUIRED_V3_PRODUCTION_PARITY_SURFACES,
    missingSurfaces,
    failedSurfaces,
    incompleteSurfaces,
    evidence: [...evidence],
  };
}
```

- [ ] **Step 4: Add test to package script**

Insert `src/components/v3/v3ProductionParityAudit.test.ts` after `src/components/v3/v3ProductionQuality.test.ts` in the `npm test` script.

- [ ] **Step 5: Run tests to verify green**

Run:

```bash
node --import tsx --test src/components/v3/v3ProductionParityAudit.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json src/components/v3/v3ProductionParityAudit.ts src/components/v3/v3ProductionParityAudit.test.ts
git commit -m "feat: add v3 production parity audit"
```

---

### Task 2: Eight Combatant Performance Budget Gates

**Files:**
- Modify: `src/tools/v3PerformanceSmoke.ts`
- Modify: `src/tools/v3PerformanceSmoke.test.ts`

- [ ] **Step 1: Write the failing tests**

Replace `src/tools/v3PerformanceSmoke.test.ts` with:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  V3_PERFORMANCE_SMOKE_BUDGETS,
  assertV3PerformanceSmokeBudget,
  buildV3PerformanceSmokeReport,
  buildV3PerformanceSmokeScene,
  createV3PerformanceSmokeCombatants,
} from './v3PerformanceSmoke';
import { V3_QUALITY_TIERS } from '../components/v3/v3ModelTypes';

test('createV3PerformanceSmokeCombatants builds eight V3 combatants with mixed weapons and role paint', () => {
  const scene = new THREE.Scene();
  const combatants = createV3PerformanceSmokeCombatants(scene, 'mobile');

  assert.equal(combatants.length, 8);
  assert.deepEqual(new Set(combatants.map((entry) => entry.meshes.group.userData.modelSystem)), new Set(['v3']));
  assert.deepEqual(new Set(combatants.map((entry) => entry.activeWeapon)), new Set(['hammer', 'sword', 'pistol']));
  for (const entry of combatants) {
    assert.equal(entry.loadout.modelSystem, 'v3');
    assert.ok(entry.loadout.paintJob?.v3RoleColors?.primary);
    assert.ok(entry.loadout.paintJob?.v3RoleColors?.accent);
  }
});

test('buildV3PerformanceSmokeScene creates a nonblank scene with V3 budget metadata', () => {
  const { scene, camera, combatants, budget } = buildV3PerformanceSmokeScene({ qualityTier: 'mobileLow' });

  assert.ok(scene.children.length > 0);
  assert.ok(camera.position.length() > 0);
  assert.equal(combatants.length, 8);
  assert.equal(budget.modelCount, 8);
  assert.equal(budget.partCount > 0, true);
});

test('buildV3PerformanceSmokeReport gates every quality tier against production smoke budgets', () => {
  for (const tier of V3_QUALITY_TIERS) {
    const smoke = buildV3PerformanceSmokeScene({ qualityTier: tier });
    const report = buildV3PerformanceSmokeReport(smoke);

    assert.equal(report.qualityTier, tier);
    assert.equal(report.combatantCount, 8);
    assert.equal(report.ready, true, `${tier}: ${report.issues.join(', ')}`);
    assert.deepEqual(report.weaponCoverage, ['hammer', 'pistol', 'sword']);
    assert.ok(smoke.budget.drawCallEstimate <= V3_PERFORMANCE_SMOKE_BUDGETS[tier].maxDrawCallEstimate);
    assert.doesNotThrow(() => assertV3PerformanceSmokeBudget(smoke));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/tools/v3PerformanceSmoke.test.ts
```

Expected: FAIL because budget exports, reports, assertions, and loadout metadata do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Update `src/tools/v3PerformanceSmoke.ts` to:

```ts
import * as THREE from 'three';
import {
  createCombatantMeshRig,
  type CombatantMeshRig,
} from '../components/grifball/combatantModels';
import { summarizeV3SceneRenderBudget, type V3RenderBudgetSummary } from '../components/v3/v3PerformanceBudget';
import { normalizeV3QualityTier } from '../components/v3/v3QualityTiers';
import { V3_QUALITY_TIERS, type V3QualityTier } from '../components/v3/v3ModelTypes';
import type { CharacterLoadout } from '../components/VoxelModels';

export interface V3PerformanceSmokeCombatant {
  id: string;
  meshes: CombatantMeshRig;
  activeWeapon: 'hammer' | 'sword' | 'pistol';
  loadout: CharacterLoadout;
}

export interface V3PerformanceSmokeBudgetGate {
  maxDrawCallEstimate: number;
  maxMergedBoxCount: number;
  maxMemoryEstimateKb: number;
}

export interface V3PerformanceSmokeReport {
  ready: boolean;
  qualityTier: V3QualityTier;
  combatantCount: number;
  weaponCoverage: ('hammer' | 'pistol' | 'sword')[];
  budget: V3RenderBudgetSummary;
  gates: V3PerformanceSmokeBudgetGate;
  issues: string[];
}

export const V3_PERFORMANCE_SMOKE_BUDGETS: Record<V3QualityTier, V3PerformanceSmokeBudgetGate> = {
  mobileLow: { maxDrawCallEstimate: 620, maxMergedBoxCount: 1850, maxMemoryEstimateKb: 3800 },
  mobile: { maxDrawCallEstimate: 760, maxMergedBoxCount: 2500, maxMemoryEstimateKb: 5200 },
  desktop: { maxDrawCallEstimate: 980, maxMergedBoxCount: 3400, maxMemoryEstimateKb: 7200 },
  ultra: { maxDrawCallEstimate: 1280, maxMergedBoxCount: 4600, maxMemoryEstimateKb: 9600 },
};

const weapons = ['hammer', 'sword', 'pistol'] as const;

const smokePaints = [
  ['#4f86f7', '#f97316'],
  ['#ef4444', '#22d3ee'],
  ['#22c55e', '#eab308'],
  ['#a855f7', '#f8fafc'],
] as const;

function createSmokeLoadout(index: number): CharacterLoadout {
  const [primary, accent] = smokePaints[index % smokePaints.length];
  return {
    modelSystem: 'v3',
    helmet: index % 2 === 0 ? 'mark-vi' : 'odst',
    torso: 'mark-vi',
    arm: 'mark-vi',
    leg: 'mark-vi',
    hammerPreset: index % 2 === 0 ? 'gravity-axe' : 'default',
    swordPreset: index % 3 === 0 ? 'energy-katar' : 'default',
    pistolPreset: index % 2 === 0 ? 'sidekick' : 'default',
    paintJob: {
      primary,
      secondary: '#1f2937',
      accent,
      visor: '#67e8f9',
      v3RoleColors: {
        primary,
        accent,
        visor: '#67e8f9',
        emissive: '#5eead4',
      },
      v3RoleEmissive: {
        visor: true,
        emissive: true,
      },
    },
  };
}

export function createV3PerformanceSmokeCombatants(
  scene: THREE.Scene,
  qualityTier: V3QualityTier
): V3PerformanceSmokeCombatant[] {
  return Array.from({ length: 8 }, (_, index) => {
    const loadout = createSmokeLoadout(index);
    const meshes = createCombatantMeshRig(scene, (index * 47) % 360, false, loadout, {
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
    if (meshes.pistol) {
      meshes.pistol.visible = activeWeapon === 'pistol';
    }

    return {
      id: `smoke-${index + 1}`,
      meshes,
      activeWeapon,
      loadout,
    };
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

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({
      color: '#0f1f25',
      roughness: 0.78,
      metalness: 0.08,
    })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  scene.add(floor);

  const combatants = createV3PerformanceSmokeCombatants(scene, normalizedTier);
  const budget = summarizeV3SceneRenderBudget(scene);
  return {
    scene,
    camera,
    combatants,
    budget,
    qualityTier: normalizedTier,
  };
}

export function buildV3PerformanceSmokeReport(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): V3PerformanceSmokeReport {
  const gates = V3_PERFORMANCE_SMOKE_BUDGETS[smoke.qualityTier];
  const weaponCoverage = [...new Set(smoke.combatants.map((entry) => entry.activeWeapon))].sort();
  const issues: string[] = [];

  if (smoke.combatants.length !== 8) issues.push(`expected 8 combatants, found ${smoke.combatants.length}`);
  if (!V3_QUALITY_TIERS.includes(smoke.qualityTier)) issues.push(`invalid quality tier ${smoke.qualityTier}`);
  for (const weapon of weapons) {
    if (!weaponCoverage.includes(weapon)) issues.push(`missing ${weapon} combatant`);
  }
  if (smoke.budget.modelCount !== 8) issues.push(`expected 8 V3 models, found ${smoke.budget.modelCount}`);
  if (smoke.budget.drawCallEstimate > gates.maxDrawCallEstimate) {
    issues.push(`draw call estimate ${smoke.budget.drawCallEstimate} exceeds ${gates.maxDrawCallEstimate}`);
  }
  if (smoke.budget.mergedBoxCount > gates.maxMergedBoxCount) {
    issues.push(`merged box count ${smoke.budget.mergedBoxCount} exceeds ${gates.maxMergedBoxCount}`);
  }
  if (smoke.budget.memoryEstimateKb > gates.maxMemoryEstimateKb) {
    issues.push(`memory estimate ${smoke.budget.memoryEstimateKb}KB exceeds ${gates.maxMemoryEstimateKb}KB`);
  }

  return {
    ready: issues.length === 0,
    qualityTier: smoke.qualityTier,
    combatantCount: smoke.combatants.length,
    weaponCoverage,
    budget: smoke.budget,
    gates,
    issues,
  };
}

export function assertV3PerformanceSmokeBudget(
  smoke: ReturnType<typeof buildV3PerformanceSmokeScene>
): void {
  const report = buildV3PerformanceSmokeReport(smoke);
  if (!report.ready) {
    throw new Error(`V3 performance smoke failed: ${report.issues.join('; ')}`);
  }
}
```

- [ ] **Step 4: Run tests to verify green**

Run:

```bash
node --import tsx --test src/tools/v3PerformanceSmoke.test.ts
npm run lint
```

Expected: PASS. If the real generated budgets are above the gates, raise the gates only to the smallest stable values above current production content and keep the test meaningful.

- [ ] **Step 5: Commit**

```bash
git add src/tools/v3PerformanceSmoke.ts src/tools/v3PerformanceSmoke.test.ts
git commit -m "feat: gate v3 performance smoke budgets"
```

---

### Task 3: Visual Policy Parity Matrix Tests

**Files:**
- Modify: `src/components/grifball/remoteCombatantProvisioning.test.ts`
- Modify: `src/components/loading/matchLoadingState.test.ts`
- Modify: `src/components/grifball/replayVisualMetadata.test.ts`

- [ ] **Step 1: Add failing remote combatant parity test**

Append to `src/components/grifball/remoteCombatantProvisioning.test.ts`:

```ts
test('remote V3 visual policy preserves sanitized V3 role paint while forced V1 and V2 remain legacy visual policies', () => {
  const { state, refs } = createStateAndRefs();
  const v3Loadout = {
    modelSystem: 'v3',
    helmet: 'odst',
    paintJob: {
      v3RoleColors: {
        primary: '#123456',
        accent: '#abcdef',
        invalid: '#ffffff',
      },
      v3RoleEmissive: {
        visor: true,
        primary: false,
      },
    },
  } as any;

  provisionCombatant(state, refs, 'peer-v3', {
    controller: 'remote',
    visualModelPolicy: 'v3',
    loadout: v3Loadout,
  });
  const v3Applied = getAppliedLoadout(refs, 'peer-v3') as any;
  assert.equal(v3Applied.modelSystem, 'v3');
  assert.equal(v3Applied.paintJob.v3RoleColors.primary, '#123456');
  assert.equal(v3Applied.paintJob.v3RoleColors.accent, '#abcdef');
  assert.equal(v3Applied.paintJob.v3RoleColors.invalid, undefined);
  assert.equal(v3Applied.paintJob.v3RoleEmissive.visor, true);

  provisionCombatant(state, refs, 'peer-v1', {
    controller: 'remote',
    visualModelPolicy: 'v1',
    loadout: v3Loadout,
  });
  assert.deepEqual(getAppliedLoadout(refs, 'peer-v1'), { modelSystem: 'v1' });

  provisionCombatant(state, refs, 'peer-v2', {
    controller: 'remote',
    visualModelPolicy: 'v2',
    loadout: v3Loadout,
  });
  assert.deepEqual(getAppliedLoadout(refs, 'peer-v2'), { modelSystem: 'v2', modelType: 'medium' });
});
```

- [ ] **Step 2: Add failing loading parity test**

Append to `src/components/loading/matchLoadingState.test.ts`:

```ts
test('loading participant previews preserve V3 role paint while V1 and V2 policies remain selectable', () => {
  let roster = {};
  roster = upsertLoadingSlot(roster, {
    clientId: 'legacy',
    role: 'host',
    playerName: 'Legacy',
    visualModelPolicy: 'v1',
    loadout: { modelSystem: 'v3' },
  }, 1_000);
  roster = upsertLoadingSlot(roster, {
    clientId: 'rigged',
    role: 'client',
    playerName: 'Rigged',
    visualModelPolicy: 'v2',
    loadout: { modelSystem: 'v2', modelType: 'large' },
  }, 1_000);
  roster = upsertLoadingSlot(roster, {
    clientId: 'advanced',
    role: 'observer',
    playerName: 'Advanced',
    visualModelPolicy: 'v3',
    loadout: {
      modelSystem: 'v3',
      paintJob: {
        v3RoleColors: {
          primary: '#123456',
          accent: '#abcdef',
          invalid: '#ffffff',
        },
        v3RoleEmissive: {
          visor: true,
        },
      },
    } as any,
  }, 1_000);

  const participants = deriveMultiplayerLoadingSnapshot(roster, 1_000).participants;
  assert.deepEqual(participants.map((entry) => entry.visualModelPolicy), ['v1', 'v2', 'v3']);
  const advanced = participants.find((entry) => entry.clientId === 'advanced');
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleColors.primary, '#123456');
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleColors.invalid, undefined);
  assert.equal((advanced?.loadout as any)?.paintJob.v3RoleEmissive.visor, true);
});
```

- [ ] **Step 3: Add failing replay parity test**

Append to `src/components/grifball/replayVisualMetadata.test.ts`:

```ts
test('V3 replay visual policy preserves role paint but strips unsafe mesh fields', () => {
  const replay = baseReplay({
    visualModelPolicy: 'v3',
    visualLoadouts: {
      player: {
        modelSystem: 'v3',
        paintJob: {
          v3RoleColors: {
            primary: '#123456',
            accent: '#abcdef',
            invalid: '#ffffff',
          },
          v3RoleEmissive: {
            visor: true,
          },
        },
        rawMesh: { vertices: [1, 2, 3] },
      } as any,
    },
  });

  const loadout = resolveReplayCombatantVisualLoadout(replay, 'player') as any;
  assert.equal(loadout.modelSystem, 'v3');
  assert.equal(loadout.paintJob.v3RoleColors.primary, '#123456');
  assert.equal(loadout.paintJob.v3RoleColors.accent, '#abcdef');
  assert.equal(loadout.paintJob.v3RoleColors.invalid, undefined);
  assert.equal(loadout.paintJob.v3RoleEmissive.visor, true);
  assert.equal(loadout.rawMesh, undefined);
});
```

- [ ] **Step 4: Run tests to verify failure**

Run:

```bash
node --import tsx --test src/components/grifball/remoteCombatantProvisioning.test.ts src/components/loading/matchLoadingState.test.ts src/components/grifball/replayVisualMetadata.test.ts
```

Expected: At least the loading parity test fails because loading state currently shallow-copies loadouts instead of using network sanitization. If another test already passes, keep it as regression coverage.

- [ ] **Step 5: Implement minimal sanitization**

In `src/components/loading/matchLoadingState.ts`, replace the local shallow loadout normalization with the existing network sanitizer:

```ts
import { sanitizeCharacterLoadoutForNetwork } from '../customArmor';
```

Then update `normalizeLoadout`:

```ts
function normalizeLoadout(loadout: unknown): CharacterLoadout | undefined {
  return sanitizeCharacterLoadoutForNetwork(loadout) as CharacterLoadout | undefined;
}
```

- [ ] **Step 6: Run tests to verify green**

Run:

```bash
node --import tsx --test src/components/grifball/remoteCombatantProvisioning.test.ts src/components/loading/matchLoadingState.test.ts src/components/grifball/replayVisualMetadata.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/grifball/remoteCombatantProvisioning.test.ts src/components/loading/matchLoadingState.ts src/components/loading/matchLoadingState.test.ts src/components/grifball/replayVisualMetadata.test.ts
git commit -m "test: harden v3 visual policy parity"
```

---

### Task 4: Browser Runtime Smoke Metadata

**Files:**
- Create: `src/tools/v3RuntimeSmoke.ts`
- Create: `src/tools/v3RuntimeSmoke.test.ts`
- Modify: `src/tools/v3PerformanceSmokePage.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing runtime smoke tests**

Create `src/tools/v3RuntimeSmoke.test.ts`:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  V3_RUNTIME_SMOKE_VIEWPORTS,
  buildV3RuntimeSmokeChecklist,
} from './v3RuntimeSmoke';

test('buildV3RuntimeSmokeChecklist includes desktop and mobile viewports', () => {
  assert.deepEqual(V3_RUNTIME_SMOKE_VIEWPORTS.map((viewport) => viewport.id), ['desktop', 'mobile']);
});

test('buildV3RuntimeSmokeChecklist covers every required Phase 13 browser surface', () => {
  const checklist = buildV3RuntimeSmokeChecklist();
  const routes = checklist.map((item) => item.path);

  assert.ok(routes.includes('/'));
  assert.ok(routes.includes('/armor-model-editor.html'));
  assert.ok(routes.includes('/v3-asset-preview.html'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=mobileLow'));
  assert.ok(routes.includes('/v3-performance-smoke.html?tier=desktop'));
  assert.ok(checklist.every((item) => item.expectedText.length > 0));
  assert.ok(checklist.every((item) => item.viewports.length > 0));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node --import tsx --test src/tools/v3RuntimeSmoke.test.ts
```

Expected: FAIL because `src/tools/v3RuntimeSmoke.ts` does not exist.

- [ ] **Step 3: Implement runtime smoke checklist**

Create `src/tools/v3RuntimeSmoke.ts`:

```ts
export interface V3RuntimeSmokeViewport {
  id: 'desktop' | 'mobile';
  width: number;
  height: number;
}

export interface V3RuntimeSmokeChecklistItem {
  id: string;
  path: string;
  expectedText: readonly string[];
  viewports: readonly V3RuntimeSmokeViewport['id'][];
}

export const V3_RUNTIME_SMOKE_VIEWPORTS: readonly V3RuntimeSmokeViewport[] = [
  { id: 'desktop', width: 1280, height: 800 },
  { id: 'mobile', width: 390, height: 844 },
];

export function buildV3RuntimeSmokeChecklist(): V3RuntimeSmokeChecklistItem[] {
  return [
    {
      id: 'main-menu-model-policy',
      path: '/',
      expectedText: ['Customization', 'V1', 'V2', 'V3'],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'armor-editor-v3-validation',
      path: '/armor-model-editor.html',
      expectedText: ['V3', 'Validation', 'Budget', 'Save Copy'],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'asset-preview-local-tooling',
      path: '/v3-asset-preview.html',
      expectedText: ['V3 Asset Preview', 'Render Synthetic Preview'],
      viewports: ['desktop'],
    },
    {
      id: 'performance-smoke-mobile-low',
      path: '/v3-performance-smoke.html?tier=mobileLow',
      expectedText: ['Phase 13 Ready', 'mobileLow', 'models 8'],
      viewports: ['mobile'],
    },
    {
      id: 'performance-smoke-desktop',
      path: '/v3-performance-smoke.html?tier=desktop',
      expectedText: ['Phase 13 Ready', 'desktop', 'models 8'],
      viewports: ['desktop'],
    },
  ];
}
```

- [ ] **Step 4: Publish performance smoke readiness data**

Modify `src/tools/v3PerformanceSmokePage.ts` to import `buildV3PerformanceSmokeReport`, build a report in `rebuild()`, set visible summary text with `Phase 13 Ready` or `Phase 13 Blocked`, and expose it on `window.__IBRAWLS_V3_PERFORMANCE_SMOKE__`:

```ts
import { buildV3PerformanceSmokeReport, buildV3PerformanceSmokeScene } from './v3PerformanceSmoke';
```

Use this inside `rebuild()`:

```ts
const report = buildV3PerformanceSmokeReport(current);
const status = report.ready ? 'Phase 13 Ready' : 'Phase 13 Blocked';
summary.textContent = `${status} | ${current.qualityTier} | models ${current.budget.modelCount} | parts ${current.budget.partCount} | draw ${current.budget.drawCallEstimate}`;
(window as any).__IBRAWLS_V3_PERFORMANCE_SMOKE__ = report;
```

- [ ] **Step 5: Add test to package script**

Insert `src/tools/v3RuntimeSmoke.test.ts` before `src/tools/v3PerformanceSmoke.test.ts` in the `npm test` script.

- [ ] **Step 6: Run tests to verify green**

Run:

```bash
node --import tsx --test src/tools/v3RuntimeSmoke.test.ts src/tools/v3PerformanceSmoke.test.ts
npm run lint
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json src/tools/v3RuntimeSmoke.ts src/tools/v3RuntimeSmoke.test.ts src/tools/v3PerformanceSmokePage.ts
git commit -m "feat: add v3 runtime smoke checklist"
```

---

### Task 5: Phase 13 Docs And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README**

Insert after the Phase 12B paragraph:

```md
Phase 13 finishes the production QA, optimization, and parity pass for the current V3 roadmap. The V3 performance smoke scene now gates eight V3 combatants across mobile-low, mobile, desktop, and ultra tiers, browser smoke metadata covers desktop and mobile surfaces, and parity tests protect V1/V2/V3 visual policy behavior across live combatants, loading previews, and replays. V3 remains visual-only: gameplay collision, timing, scoring, AI, network authority, and V1/V2 legacy model choices are unchanged.
```

- [ ] **Step 2: Run focused test set**

Run:

```bash
node --import tsx --test src/components/v3/v3ProductionParityAudit.test.ts src/tools/v3PerformanceSmoke.test.ts src/tools/v3RuntimeSmoke.test.ts src/components/grifball/remoteCombatantProvisioning.test.ts src/components/loading/matchLoadingState.test.ts src/components/grifball/replayVisualMetadata.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run browser smoke on the existing dev server**

Use the in-app browser or Playwright against `http://127.0.0.1:3000` and record evidence:

```text
Desktop 1280x800:
- / loads nonblank and shows model policy choices V1, V2, V3.
- / customization with V3 selected shows V3 Material Roles and has no horizontal overflow.
- /armor-model-editor.html loads nonblank and shows V3, Validation, Budget, Save Copy.
- /v3-asset-preview.html loads nonblank and shows V3 Asset Preview.
- /v3-performance-smoke.html?tier=desktop loads nonblank and shows Phase 13 Ready, desktop, models 8.

Mobile 390x844:
- / customization with V3 selected shows V3 Material Roles and has no horizontal overflow.
- /armor-model-editor.html loads nonblank and shows V3, Validation, Budget, Save Copy.
- /v3-performance-smoke.html?tier=mobileLow loads nonblank and shows Phase 13 Ready, mobileLow, models 8.
```

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run lint
npm test
npm run build
git diff --check
```

Expected: PASS. `npm run build` may print existing Vite chunk-size warnings; those warnings do not fail the command.

- [ ] **Step 5: Commit docs and final verification metadata**

```bash
git add README.md
git commit -m "docs: document v3 production parity completion"
```

---

## Completion Audit

Phase 13 is complete only when current evidence proves:

- `src/components/v3/v3ProductionParityAudit.test.ts` passes and requires every Phase 13 surface.
- `src/tools/v3PerformanceSmoke.test.ts` passes and gates all four quality tiers with eight V3 combatants.
- `src/tools/v3RuntimeSmoke.test.ts` passes and covers desktop/mobile browser smoke surfaces.
- Live visual policy parity tests pass for remote combatants, loading previews, and replays.
- Browser smoke confirms nonblank desktop/mobile surfaces and visible Phase 13 performance readiness.
- `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.
- README documents Phase 13 and still states V3 is visual-only with V1/V2 legacy options preserved.
