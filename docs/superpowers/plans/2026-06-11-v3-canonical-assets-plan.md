# V3 Canonical Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add original iBrawls V3 character and weapon asset contracts, manifests, fit bounds, budgets, and LOD metadata without routing V3 into live gameplay builders yet.

**Architecture:** Phase 3 is data-contract first. It creates the canonical V3 taxonomy and curated built-in manifest data that later runtime builders can consume. It must not commit private reference meshes, generated Halo-derived conversions, textures, or runtime upload paths. It must not change V1/V2 runtime behavior.

**Out of scope for Phase 3:**
- No live `buildVoxelSpartanModel()` V3 routing.
- No first-person or third-person V3 mesh construction in active gameplay.
- No animation runtime changes.
- No player-facing V3 custom armor editor yet.
- No server, Worker, or network payload changes beyond existing V3 policy contracts.

---

## Requirements

- Keep all canonical V3 asset definitions original to iBrawls.
- Preserve modular armor from the start.
- Include V3 hammer, sword, and pistol from the start.
- Include paint roles, visual fit bounds, budget metadata, and LOD metadata for every character part and weapon.
- Define socket/grip metadata as data, not hard-coded offsets scattered through consumers.
- Keep V1/V2 behavior unchanged.
- Add focused tests to `npm test`.
- Keep README parity after adding the new asset manifest surface.

## Planned Files

- Create `src/components/v3/v3ModelTypes.ts`
- Create `src/components/v3/v3ModelTypes.test.ts`
- Create `src/components/v3/v3PartBounds.ts`
- Create `src/components/v3/v3PartBounds.test.ts`
- Create `src/components/v3/v3AssetManifest.ts`
- Create `src/components/v3/v3AssetManifest.test.ts`
- Create `src/components/v3/v3Lod.ts`
- Create `src/components/v3/v3Lod.test.ts`
- Modify `package.json`
- Modify `README.md`

---

## Task 1: V3 Model Taxonomy And Budgets

**Files:**
- Create: `src/components/v3/v3ModelTypes.test.ts`
- Create: `src/components/v3/v3ModelTypes.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing taxonomy tests**

Create `src/components/v3/v3ModelTypes.test.ts` with tests that assert:

- `V3_CHARACTER_SLOT_IDS` includes the required modular families:
  - `helmet`
  - `neck`
  - `chest`
  - `shoulderLeft`
  - `shoulderRight`
  - `upperArmLeft`
  - `upperArmRight`
  - `forearmLeft`
  - `forearmRight`
  - `handLeft`
  - `handRight`
  - `pelvis`
  - `thighLeft`
  - `thighRight`
  - `shinLeft`
  - `shinRight`
  - `footLeft`
  - `footRight`
  - `back`
- `V3_WEAPON_IDS` is `['hammer', 'sword', 'pistol']`.
- `V3_PAINT_ROLES` includes `primary`, `secondary`, `accent`, `undersuit`, `visor`, `emissive`, `decal`, and `fixed`.
- `V3_QUALITY_TIERS` is ordered from cheapest to richest: `mobileLow`, `mobile`, `desktop`, `ultra`.
- Budget validation accepts a sane budget and rejects zero/negative source voxels, merged boxes, material groups, draw calls, and LOD count.

- [ ] **Step 2: Run the taxonomy test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3ModelTypes.test.ts
```

Expected: FAIL because `v3ModelTypes.ts` does not exist.

- [ ] **Step 3: Implement taxonomy contracts**

Create `src/components/v3/v3ModelTypes.ts` exporting:

- `V3_CHARACTER_SLOT_IDS`
- `V3_WEAPON_IDS`
- `V3_PAINT_ROLES`
- `V3_QUALITY_TIERS`
- `V3CharacterSlotId`
- `V3WeaponId`
- `V3PaintRole`
- `V3QualityTier`
- `V3AssetKind`
- `V3AssetBudget`
- `V3LodLevel`
- `V3SocketName`
- `V3SocketDefinition`
- `V3AssetMetadata`
- `validateV3AssetBudget(budget: V3AssetBudget): string[]`

Keep this file pure data/types with no Three.js import.

- [ ] **Step 4: Run the taxonomy test and add it to `npm test`**

Run:

```powershell
node --import tsx --test src/components/v3/v3ModelTypes.test.ts
```

Expected: PASS.

Modify `package.json` so `npm test` includes `src/components/v3/v3ModelTypes.test.ts` near the other component/tool model tests.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/components/v3/v3ModelTypes.ts src/components/v3/v3ModelTypes.test.ts package.json
git commit -m "feat: add v3 model taxonomy"
```

Expected: commit succeeds with only Task 1 files.

---

## Task 2: V3 Visual Fit Bounds

**Files:**
- Create: `src/components/v3/v3PartBounds.test.ts`
- Create: `src/components/v3/v3PartBounds.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing fit-bound tests**

Create `src/components/v3/v3PartBounds.test.ts` with tests that assert:

- Every `V3_CHARACTER_SLOT_IDS` entry has a fit-bound definition.
- Every `V3_WEAPON_IDS` entry has a fit-bound definition.
- Character fit bounds include max voxel dimensions and center offsets.
- Weapon fit bounds include max dimensions and grip safety envelope metadata.
- `validateV3FitBounds()` reports missing or non-positive dimensions.
- `getV3CharacterPartBounds('helmet')` and `getV3WeaponBounds('hammer')` return immutable data copies or readonly objects.

- [ ] **Step 2: Run the fit-bound test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3PartBounds.test.ts
```

Expected: FAIL because `v3PartBounds.ts` does not exist.

- [ ] **Step 3: Implement fit-bound contracts**

Create `src/components/v3/v3PartBounds.ts` exporting:

- `V3VoxelDimensions`
- `V3FitBounds`
- `V3_CHARACTER_PART_BOUNDS`
- `V3_WEAPON_BOUNDS`
- `getV3CharacterPartBounds(slot: V3CharacterSlotId): V3FitBounds`
- `getV3WeaponBounds(weapon: V3WeaponId): V3FitBounds`
- `validateV3FitBounds(bounds: V3FitBounds): string[]`

Use conservative visual bounds that preserve normalized gameplay hitboxes. These are visual fit constraints, not combat collision dimensions.

- [ ] **Step 4: Run the fit-bound test and add it to `npm test`**

Run:

```powershell
node --import tsx --test src/components/v3/v3PartBounds.test.ts
```

Expected: PASS.

Modify `package.json` so `npm test` includes `src/components/v3/v3PartBounds.test.ts`.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/components/v3/v3PartBounds.ts src/components/v3/v3PartBounds.test.ts package.json
git commit -m "feat: add v3 fit bounds"
```

Expected: commit succeeds with only Task 2 files.

---

## Task 3: Canonical Character Manifest

**Files:**
- Create: `src/components/v3/v3AssetManifest.test.ts`
- Create: `src/components/v3/v3AssetManifest.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing character manifest tests**

Create `src/components/v3/v3AssetManifest.test.ts` with tests that assert:

- The built-in manifest has one default complete V3 character loadout.
- The default character loadout covers every `V3_CHARACTER_SLOT_IDS` entry exactly once.
- Every character part references a valid slot, paint role, fit-bound id, budget, and LOD list.
- Every character part is original iBrawls naming. Do not use private reference asset names, Halo-derived names, or direct material names from the private OBJ/MTL.
- Character part budgets pass `validateV3AssetBudget()`.
- Total default-character source voxel and draw-call estimates stay under the Phase 3 budget constants.

- [ ] **Step 2: Run the manifest test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: FAIL because `v3AssetManifest.ts` does not exist.

- [ ] **Step 3: Implement the default character manifest**

Create `src/components/v3/v3AssetManifest.ts` with:

- Original default V3 character set id, for example `ibrawls-v3-aegis`.
- Character part manifest entries for every required slot.
- Paint role metadata for each part.
- Budget and LOD metadata for each part.
- Summary helpers:
  - `getDefaultV3CharacterLoadout()`
  - `getV3CharacterPartManifest(id: string)`
  - `getDefaultV3CharacterBudgetSummary()`

The manifest should be data-only. Do not include voxel payload arrays in this phase.

- [ ] **Step 4: Run the manifest test and add it to `npm test`**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: PASS.

Modify `package.json` so `npm test` includes `src/components/v3/v3AssetManifest.test.ts`.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add src/components/v3/v3AssetManifest.ts src/components/v3/v3AssetManifest.test.ts package.json
git commit -m "feat: add v3 character manifest"
```

Expected: commit succeeds with only Task 3 files.

---

## Task 4: Canonical Weapon Manifest

**Files:**
- Modify: `src/components/v3/v3AssetManifest.test.ts`
- Modify: `src/components/v3/v3AssetManifest.ts`

- [ ] **Step 1: Extend manifest tests for V3 weapons**

Add tests that assert:

- The manifest includes exactly one built-in `hammer`, `sword`, and `pistol`.
- Every weapon has paint roles, budgets, LOD metadata, and fit bounds.
- Every weapon defines required sockets:
  - `thirdPersonPrimaryGrip`
  - `thirdPersonOffhandGrip`
  - `firstPersonPrimaryGrip`
  - `firstPersonOffhandGrip`
- Weapon budgets pass `validateV3AssetBudget()`.
- Weapon ids and names are original iBrawls names.

- [ ] **Step 2: Run the manifest test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: FAIL because weapon manifest entries are missing.

- [ ] **Step 3: Add weapon manifest entries**

Update `src/components/v3/v3AssetManifest.ts` with original V3 weapon entries for:

- Gravity hammer
- Energy sword
- Pistol

Add helpers:

- `getDefaultV3WeaponManifest(weapon: V3WeaponId)`
- `getDefaultV3WeaponBudgetSummary()`

- [ ] **Step 4: Run the manifest test**

Run:

```powershell
node --import tsx --test src/components/v3/v3AssetManifest.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add src/components/v3/v3AssetManifest.ts src/components/v3/v3AssetManifest.test.ts
git commit -m "feat: add v3 weapon manifest"
```

Expected: commit succeeds with only Task 4 files.

---

## Task 5: V3 LOD And Quality Selection

**Files:**
- Create: `src/components/v3/v3Lod.test.ts`
- Create: `src/components/v3/v3Lod.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing LOD tests**

Create `src/components/v3/v3Lod.test.ts` with tests that assert:

- LOD selection prefers lower-detail entries on `mobileLow` and `mobile`.
- LOD selection can use richer entries on `desktop` and `ultra`.
- Distance thresholds downgrade to cheaper LODs as distance increases.
- Missing or malformed LOD lists fall back to a safe lowest-detail level.
- Returned LOD entries include budget metadata and a stable source id for future builders.

- [ ] **Step 2: Run the LOD test and confirm it fails**

Run:

```powershell
node --import tsx --test src/components/v3/v3Lod.test.ts
```

Expected: FAIL because `v3Lod.ts` does not exist.

- [ ] **Step 3: Implement LOD helpers**

Create `src/components/v3/v3Lod.ts` exporting:

- `V3LodSelectionInput`
- `selectV3LodLevel(input: V3LodSelectionInput): V3LodLevel`
- `getV3QualityTierRank(tier: V3QualityTier): number`

Keep this pure and deterministic so mobile performance policy can use it later.

- [ ] **Step 4: Run the LOD test and add it to `npm test`**

Run:

```powershell
node --import tsx --test src/components/v3/v3Lod.test.ts
```

Expected: PASS.

Modify `package.json` so `npm test` includes `src/components/v3/v3Lod.test.ts`.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add src/components/v3/v3Lod.ts src/components/v3/v3Lod.test.ts package.json
git commit -m "feat: add v3 lod selection"
```

Expected: commit succeeds with only Task 5 files.

---

## Task 6: Documentation And Phase 3 Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add README developer/runtime note**

Add a short README note near the V3 model/customization section explaining:

- Phase 3 adds original V3 manifest contracts only.
- No private reference mesh, texture, or direct conversion is committed.
- Live gameplay still uses existing V1/V2 builders until Phase 4 runtime builder work lands.

- [ ] **Step 2: Run focused V3 component tests**

Run:

```powershell
node --import tsx --test src/components/v3/v3ModelTypes.test.ts src/components/v3/v3PartBounds.test.ts src/components/v3/v3AssetManifest.test.ts src/components/v3/v3Lod.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```powershell
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run full tests**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 5: Run build**

Run:

```powershell
npm run build
```

Expected: PASS with only existing Vite chunk-size warnings.

- [ ] **Step 6: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no output.

- [ ] **Step 7: Review private asset exclusion**

Run:

```powershell
git status --short
git diff --name-only HEAD
```

Expected: no `.obj`, `.mtl`, `.fbx`, `.blend`, texture, or direct converted reference asset appears in staged or unstaged repo changes.

- [ ] **Step 8: Commit documentation**

Run:

```powershell
git add README.md
git commit -m "docs: describe v3 canonical manifests"
```

Expected: commit succeeds with only README changes unless verification found a defect that was fixed.

---

## Phase 3 Completion Criteria

Phase 3 is complete when:

- V3 taxonomy, slots, paint roles, quality tiers, bounds, budgets, manifests, and LOD helpers are implemented and tested.
- The default V3 character manifest covers every required modular character slot.
- The default V3 weapon manifest covers hammer, sword, and pistol with first-person and third-person grip metadata.
- README clearly states that Phase 3 is manifest-only and does not route live gameplay to V3 builders yet.
- No private reference assets or direct conversions are committed.
- Focused tests, full tests, lint, build, and whitespace checks pass.
