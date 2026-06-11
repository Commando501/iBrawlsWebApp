# V3 Offline Asset Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build developer-only V3 reference inspection, voxelization, validation, and preview tooling without adding private mesh assets, direct Halo-derived output, or any server/runtime upload path.

**Architecture:** Keep Phase 2 under `src/tools/`, `scripts/v3/`, and a local preview page. The committed code parses and validates metadata using synthetic tests; private OBJ/FBX/Blend files are only local inputs to offline scripts and never become committed fixtures or shipped assets.

**Tech Stack:** TypeScript, Node test runner with `tsx`, Node filesystem scripts, Three.js-compatible metadata shapes, browser-only local preview HTML.

---

## Scope And Guardrails

- This phase is developer tooling only. Do not add network messages, save payloads, server upload routes, Worker code, or player-facing mesh import.
- Do not commit `.obj`, `.mtl`, `.fbx`, `.blend`, textures, screenshots of the reference asset, or converted direct-Halo voxel output.
- Tests use small synthetic geometry strings and generated synthetic voxel data.
- Local reference inspection may read this private file path when present on the developer machine:

```powershell
C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj
```

- Reference inspection should produce terminal summaries only. Any exported original iBrawls V3 assets belong to Phase 3 after art-direction review.

## File Structure

- Create `src/tools/v3ObjParser.ts`: pure OBJ metadata parser for object names, group names, material libraries, material usage, vertex count, face count, triangle estimate, bounds, and per-object referenced-vertex bounds.
- Create `src/tools/v3ObjParser.test.ts`: synthetic parser tests covering objects, groups, materials, bounds, negative indices, default objects, invalid numeric vertices, and local reference expectation helpers.
- Create `scripts/v3/inspect-reference-asset.ts`: local-only CLI that reads a supplied OBJ path, optionally reads an MTL path, and prints deterministic summary JSON or text.
- Create `src/tools/v3Voxelize.ts`: deterministic mesh-to-voxel helpers for coarse preview grids using bounds, triangles, materials, and resolution budgets.
- Create `src/tools/v3Voxelize.test.ts`: synthetic voxelization tests that do not use private assets.
- Create `src/tools/v3AssetValidation.ts`: validation helpers for voxel count, bounds, material-role coverage, part grouping, and connected components.
- Create `src/tools/v3AssetValidation.test.ts`: validation tests for passing and failing synthetic assets.
- Create `src/tools/v3VoxelPartClassifier.ts`: object/material name classifier that maps reference parts to candidate V3 slots for developer review.
- Create `src/tools/v3VoxelPartClassifier.test.ts`: classifier tests using synthetic object/material names.
- Create `public/v3-asset-preview.html`: local-only preview page for synthetic or manually selected summary JSON.
- Modify `package.json`: include all new tests in the `npm test` command.
- Modify `README.md`: add a short developer-tooling note once the preview page exists.

---

## Task 1: OBJ Metadata Parser

**Files:**
- Create: `src/tools/v3ObjParser.test.ts`
- Create: `src/tools/v3ObjParser.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing parser tests**

Create `src/tools/v3ObjParser.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  assertV3ReferenceAssetShape,
  parseV3ObjMetadata,
  type V3ObjMetadata,
} from './v3ObjParser';

const obj = [
  '# synthetic V3 reference-like source',
  'mtllib synthetic.mtl',
  'o Helmet',
  'v 0 0 0',
  'v 2 0 0',
  'v 0 3 0',
  'v 0 0 4',
  'usemtl spartan_armor',
  'g Helmet Visor',
  'f 1/1/1 2/2/1 3/3/1',
  'usemtl visor_glass',
  'f 1 3 4',
  'o Chest',
  'g Torso',
  'usemtl undersuit',
  'v -1 -2 -3',
  'f -1 -2 -3 -4',
].join('\n');

describe('parseV3ObjMetadata', () => {
  it('summarizes objects, groups, materials, faces, triangle estimates, and bounds', () => {
    const parsed = parseV3ObjMetadata(obj);

    assert.equal(parsed.vertexCount, 5);
    assert.equal(parsed.faceCount, 3);
    assert.equal(parsed.triangleCountEstimate, 4);
    assert.deepEqual(parsed.materialLibraries, ['synthetic.mtl']);
    assert.deepEqual(parsed.materials, ['spartan_armor', 'visor_glass', 'undersuit']);
    assert.deepEqual(parsed.bounds, { min: [-1, -2, -3], max: [2, 3, 4] });
    assert.deepEqual(parsed.objects.map((object) => object.name), ['Helmet', 'Chest']);
    assert.deepEqual(parsed.objects[0].groupNames, ['Helmet', 'Visor']);
    assert.deepEqual(parsed.objects[0].materialNames, ['spartan_armor', 'visor_glass']);
    assert.deepEqual(parsed.objects[0].bounds, { min: [0, 0, 0], max: [2, 3, 4] });
    assert.deepEqual(parsed.objects[1].materialNames, ['undersuit']);
    assert.equal(parsed.objects[1].faceCount, 1);
    assert.equal(parsed.objects[1].triangleCountEstimate, 2);
  });

  it('creates a default object when faces arrive before an object declaration', () => {
    const parsed = parseV3ObjMetadata([
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'usemtl default_mat',
      'f 1 2 3',
    ].join('\n'));

    assert.equal(parsed.objects.length, 1);
    assert.equal(parsed.objects[0].name, 'default');
    assert.deepEqual(parsed.objects[0].materialNames, ['default_mat']);
    assert.deepEqual(parsed.objects[0].referencedVertexIndexes, [1, 2, 3]);
  });

  it('ignores malformed vertices and unresolved face references without throwing', () => {
    const parsed = parseV3ObjMetadata([
      'o Broken',
      'v 0 0 nope',
      'v 1 1 1',
      'usemtl metal',
      'f 1 99 -7',
    ].join('\n'));

    assert.equal(parsed.vertexCount, 1);
    assert.equal(parsed.faceCount, 1);
    assert.deepEqual(parsed.bounds, { min: [1, 1, 1], max: [1, 1, 1] });
    assert.deepEqual(parsed.objects[0].referencedVertexIndexes, [1]);
  });
});

describe('assertV3ReferenceAssetShape', () => {
  it('accepts metadata that meets the private reference inspection floor', () => {
    const metadata: V3ObjMetadata = {
      materialLibraries: ['reference.mtl'],
      materials: ['spartan_armor'],
      vertexCount: 18_001,
      faceCount: 20_001,
      triangleCountEstimate: 20_001,
      bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
      objects: Array.from({ length: 12 }, (_, index) => ({
        name: `part_${index}`,
        groupNames: [],
        materialNames: index === 0 ? ['spartan_armor'] : [],
        faceCount: 1,
        triangleCountEstimate: 1,
        referencedVertexIndexes: [1],
        bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      })),
    };

    assert.doesNotThrow(() => assertV3ReferenceAssetShape(metadata));
  });

  it('reports every missing reference expectation in one error', () => {
    const parsed = parseV3ObjMetadata('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');

    assert.throws(
      () => assertV3ReferenceAssetShape(parsed),
      /expected at least 12 objects; expected material spartan_armor; expected more than 18000 vertices; expected more than 20000 faces/
    );
  });
});
```

- [ ] **Step 2: Run the focused parser test and confirm it fails**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts
```

Expected: FAIL because `src/tools/v3ObjParser.ts` does not exist.

- [ ] **Step 3: Implement the metadata parser**

Create `src/tools/v3ObjParser.ts` with this public API:

```ts
export type V3Vec3 = [number, number, number];

export interface V3Bounds {
  min: V3Vec3;
  max: V3Vec3;
}

export interface V3ObjObjectMetadata {
  name: string;
  groupNames: string[];
  materialNames: string[];
  faceCount: number;
  triangleCountEstimate: number;
  referencedVertexIndexes: number[];
  bounds: V3Bounds | null;
}

export interface V3ObjMetadata {
  materialLibraries: string[];
  materials: string[];
  vertexCount: number;
  faceCount: number;
  triangleCountEstimate: number;
  bounds: V3Bounds | null;
  objects: V3ObjObjectMetadata[];
}

export function parseV3ObjMetadata(source: string): V3ObjMetadata;
export function assertV3ReferenceAssetShape(metadata: V3ObjMetadata): void;
```

Implementation rules:

```ts
const createEmptyMetadata = (): V3ObjMetadata => ({
  materialLibraries: [],
  materials: [],
  vertexCount: 0,
  faceCount: 0,
  triangleCountEstimate: 0,
  bounds: null,
  objects: [],
});

const updateBounds = (bounds: V3Bounds | null, point: V3Vec3): V3Bounds => {
  if (!bounds) return { min: [...point], max: [...point] };
  return {
    min: [
      Math.min(bounds.min[0], point[0]),
      Math.min(bounds.min[1], point[1]),
      Math.min(bounds.min[2], point[2]),
    ],
    max: [
      Math.max(bounds.max[0], point[0]),
      Math.max(bounds.max[1], point[1]),
      Math.max(bounds.max[2], point[2]),
    ],
  };
};
```

Parse only metadata-relevant OBJ commands: `mtllib`, `o`, `g`, `usemtl`, `v`, and `f`. Count face statements as `faceCount`. Estimate triangles as `Math.max(1, faceVertexCount - 2)` for each valid `f` statement with at least three tokens. Resolve negative indices using OBJ semantics, where `-1` points at the most recently parsed valid vertex.

- [ ] **Step 4: Run the focused parser test and confirm it passes**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts
```

Expected: PASS.

- [ ] **Step 5: Add the parser test to `npm test`**

Modify the `test` script in `package.json` so the command includes:

```text
src/tools/v3ObjParser.test.ts
```

Place it beside the existing `src/tools/animationEditorCore.test.ts` entry.

- [ ] **Step 6: Run the npm test entry for the new file**

Run:

```powershell
npm test -- src/tools/v3ObjParser.test.ts
```

Expected: The repository test command does not use pass-through filtering, so use the focused Node command from Step 4 for targeted validation and rely on full `npm test` in the verification task.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add src/tools/v3ObjParser.ts src/tools/v3ObjParser.test.ts package.json
git commit -m "feat: add v3 obj metadata parser"
```

Expected: commit succeeds with only Task 1 files.

## Task 2: Local Reference Inspection CLI

**Files:**
- Create: `scripts/v3/inspect-reference-asset.ts`

- [ ] **Step 1: Write the CLI script**

Create `scripts/v3/inspect-reference-asset.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import {
  assertV3ReferenceAssetShape,
  parseV3ObjMetadata,
  type V3ObjMetadata,
} from '../../src/tools/v3ObjParser';

interface InspectArgs {
  objPath: string;
  mtlPath?: string;
  json: boolean;
  assertReferenceShape: boolean;
}

const readArgValue = (args: string[], flag: string): string | undefined => {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  return args[index + 1];
};

const parseArgs = (args: string[]): InspectArgs => {
  const objPath = readArgValue(args, '--obj');
  if (!objPath) {
    throw new Error('Usage: node --import tsx scripts/v3/inspect-reference-asset.ts --obj <path> [--mtl <path>] [--json] [--assert-reference-shape]');
  }

  return {
    objPath,
    mtlPath: readArgValue(args, '--mtl'),
    json: args.includes('--json'),
    assertReferenceShape: args.includes('--assert-reference-shape'),
  };
};

const summarizeText = (metadata: V3ObjMetadata, objPath: string, mtlPath?: string): string => [
  `OBJ: ${objPath}`,
  `MTL: ${mtlPath ?? metadata.materialLibraries.join(', ') || 'none declared'}`,
  `vertices: ${metadata.vertexCount}`,
  `faces: ${metadata.faceCount}`,
  `triangles_estimate: ${metadata.triangleCountEstimate}`,
  `bounds: ${metadata.bounds ? JSON.stringify(metadata.bounds) : 'none'}`,
  `materials: ${metadata.materials.join(', ') || 'none'}`,
  `objects:`,
  ...metadata.objects.map((object) =>
    `  - ${object.name}: faces=${object.faceCount}, triangles=${object.triangleCountEstimate}, materials=${object.materialNames.join(', ') || 'none'}, groups=${object.groupNames.join(', ') || 'none'}`
  ),
].join('\n');

const main = () => {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.objPath)) {
    throw new Error(`OBJ file does not exist: ${options.objPath}`);
  }
  if (options.mtlPath && !existsSync(options.mtlPath)) {
    throw new Error(`MTL file does not exist: ${options.mtlPath}`);
  }

  const source = readFileSync(options.objPath, 'utf8');
  const metadata = parseV3ObjMetadata(source);
  if (options.assertReferenceShape) {
    assertV3ReferenceAssetShape(metadata);
  }

  if (options.json) {
    console.log(JSON.stringify({
      sourceFile: basename(options.objPath),
      mtlFile: options.mtlPath ? basename(options.mtlPath) : null,
      metadata,
    }, null, 2));
    return;
  }

  console.log(summarizeText(metadata, options.objPath, options.mtlPath));
};

main();
```

- [ ] **Step 2: Run the CLI against a synthetic temporary file**

Create a temporary local OBJ outside the repo or under `C:\tmp`, then run:

```powershell
node --import tsx scripts/v3/inspect-reference-asset.ts --obj C:\tmp\ibrawls-v3-synthetic.obj --json
```

Expected: JSON summary prints with no repo asset output.

- [ ] **Step 3: Run the CLI against the private reference if accessible**

Run:

```powershell
node --import tsx scripts/v3/inspect-reference-asset.ts --obj "C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj" --mtl "C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.mtl" --assert-reference-shape
```

Expected: text summary prints. If the local file is unavailable or sandboxed, record the access blocker without changing committed tests.

- [ ] **Step 4: Commit Task 2**

Run:

```powershell
git add scripts/v3/inspect-reference-asset.ts
git commit -m "feat: add v3 reference inspection script"
```

Expected: commit succeeds with only the CLI script.

## Task 3: Candidate Part Classifier

**Files:**
- Create: `src/tools/v3VoxelPartClassifier.test.ts`
- Create: `src/tools/v3VoxelPartClassifier.ts`
- Modify: `package.json`

- [ ] **Step 1: Write classifier tests using synthetic object and material names**

Create `src/tools/v3VoxelPartClassifier.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classifyV3ReferencePart } from './v3VoxelPartClassifier';

describe('classifyV3ReferencePart', () => {
  it('maps common armor names to V3 slot candidates', () => {
    assert.equal(classifyV3ReferencePart({ objectName: 'Helmet_Mark', materialNames: [] }).slot, 'helmet');
    assert.equal(classifyV3ReferencePart({ objectName: 'Left_Shoulder_Pad', materialNames: [] }).slot, 'shoulder');
    assert.equal(classifyV3ReferencePart({ objectName: 'Boot_R', materialNames: [] }).slot, 'foot');
    assert.equal(classifyV3ReferencePart({ objectName: 'Backpack', materialNames: [] }).slot, 'back');
  });

  it('maps material names to paint roles for developer review', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'Chest',
      materialNames: ['undersuit_black', 'visor_gold', 'armor_primary'],
    });

    assert.deepEqual(classified.paintRoles, ['undersuit', 'visor', 'primary']);
  });

  it('returns unknown slot and fixed paint role for unrecognized names', () => {
    const classified = classifyV3ReferencePart({
      objectName: 'DecorativeThing',
      materialNames: ['plain_metal'],
    });

    assert.equal(classified.slot, 'unknown');
    assert.deepEqual(classified.paintRoles, ['fixed']);
  });
});
```

- [ ] **Step 2: Run classifier tests and confirm they fail**

Run:

```powershell
node --import tsx --test src/tools/v3VoxelPartClassifier.test.ts
```

Expected: FAIL because the classifier module does not exist.

- [ ] **Step 3: Implement the classifier**

Create `src/tools/v3VoxelPartClassifier.ts` with exported unions for slots and paint roles plus:

```ts
export interface V3ReferencePartInput {
  objectName: string;
  groupNames?: string[];
  materialNames: string[];
}

export interface V3ReferencePartClassification {
  slot: V3CandidateSlot;
  paintRoles: V3CandidatePaintRole[];
}

export function classifyV3ReferencePart(input: V3ReferencePartInput): V3ReferencePartClassification;
```

Use lowercase token matching. Slot keywords should include helmet, neck, chest, shoulder, upper arm, forearm, hand, pelvis, thigh, shin, foot, back, weapon, hammer, sword, and pistol. Paint role keywords should include primary, secondary, accent, trim, undersuit, visor, emissive, decal, detail, and fixed.

- [ ] **Step 4: Run classifier tests and add them to `npm test`**

Run:

```powershell
node --import tsx --test src/tools/v3VoxelPartClassifier.test.ts
```

Expected: PASS.

Modify `package.json` to include `src/tools/v3VoxelPartClassifier.test.ts` next to the other tool tests.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add src/tools/v3VoxelPartClassifier.ts src/tools/v3VoxelPartClassifier.test.ts package.json
git commit -m "feat: classify v3 reference parts"
```

Expected: commit succeeds with only Task 3 files.

## Task 4: Coarse Voxelization Helpers

**Files:**
- Create: `src/tools/v3Voxelize.test.ts`
- Create: `src/tools/v3Voxelize.ts`
- Modify: `package.json`

- [ ] **Step 1: Write voxelization tests with synthetic triangles**

Create `src/tools/v3Voxelize.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { voxelizeBoundsPreview, voxelizeTriangleBoundsPreview } from './v3Voxelize';

describe('voxelizeBoundsPreview', () => {
  it('fills a deterministic voxel shell for a bounded part', () => {
    const preview = voxelizeBoundsPreview({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      resolution: 4,
      material: 'armor_primary',
    });

    assert.equal(preview.resolution, 4);
    assert.equal(preview.voxels.length, 56);
    assert.deepEqual(preview.voxels[0], { x: 0, y: 0, z: 0, material: 'armor_primary' });
  });
});

describe('voxelizeTriangleBoundsPreview', () => {
  it('marks voxels overlapped by triangle bounding boxes', () => {
    const preview = voxelizeTriangleBoundsPreview({
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
      resolution: 4,
      triangles: [
        { a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0], material: 'visor' },
      ],
    });

    assert.equal(preview.voxels.length, 16);
    assert.equal(preview.voxels.every((voxel) => voxel.z === 0), true);
  });
});
```

- [ ] **Step 2: Run voxelization tests and confirm they fail**

Run:

```powershell
node --import tsx --test src/tools/v3Voxelize.test.ts
```

Expected: FAIL because `v3Voxelize.ts` does not exist.

- [ ] **Step 3: Implement deterministic coarse voxel preview helpers**

Create `src/tools/v3Voxelize.ts` with:

```ts
import type { V3Bounds, V3Vec3 } from './v3ObjParser';

export interface V3PreviewVoxel {
  x: number;
  y: number;
  z: number;
  material: string;
}

export interface V3VoxelPreview {
  resolution: number;
  bounds: V3Bounds;
  voxels: V3PreviewVoxel[];
}

export interface V3PreviewTriangle {
  a: V3Vec3;
  b: V3Vec3;
  c: V3Vec3;
  material: string;
}
```

`voxelizeBoundsPreview` should mark shell cells where any grid coordinate is `0` or `resolution - 1`. `voxelizeTriangleBoundsPreview` should map each triangle's axis-aligned bounding box into grid coordinates and mark each occupied cell once per material.

- [ ] **Step 4: Run voxelization tests and add them to `npm test`**

Run:

```powershell
node --import tsx --test src/tools/v3Voxelize.test.ts
```

Expected: PASS.

Modify `package.json` to include `src/tools/v3Voxelize.test.ts`.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add src/tools/v3Voxelize.ts src/tools/v3Voxelize.test.ts package.json
git commit -m "feat: add v3 coarse voxel preview helpers"
```

Expected: commit succeeds with only Task 4 files.

## Task 5: Asset Validation Helpers

**Files:**
- Create: `src/tools/v3AssetValidation.test.ts`
- Create: `src/tools/v3AssetValidation.ts`
- Modify: `package.json`

- [ ] **Step 1: Write validation tests**

Create `src/tools/v3AssetValidation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateV3VoxelAsset } from './v3AssetValidation';

const voxels = [
  { x: 0, y: 0, z: 0, material: 'armor_primary' },
  { x: 1, y: 0, z: 0, material: 'armor_primary' },
  { x: 1, y: 1, z: 0, material: 'armor_secondary' },
];

describe('validateV3VoxelAsset', () => {
  it('accepts connected voxels inside budget and bounds', () => {
    const result = validateV3VoxelAsset({
      voxels,
      maxVoxels: 8,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
      requiredMaterials: ['armor_primary'],
    });

    assert.deepEqual(result.errors, []);
    assert.equal(result.connectedComponentCount, 1);
    assert.equal(result.materials.length, 2);
  });

  it('reports budget, bounds, material, and connectivity failures', () => {
    const result = validateV3VoxelAsset({
      voxels: [
        ...voxels,
        { x: 9, y: 9, z: 9, material: 'loose' },
      ],
      maxVoxels: 2,
      allowedBounds: { min: [0, 0, 0], max: [2, 2, 2] },
      requiredMaterials: ['visor'],
    });

    assert.deepEqual(result.errors, [
      'voxel count 4 exceeds budget 2',
      'voxel 9,9,9 is outside allowed bounds',
      'missing required material visor',
      'asset has 2 disconnected components',
    ]);
  });
});
```

- [ ] **Step 2: Run validation tests and confirm they fail**

Run:

```powershell
node --import tsx --test src/tools/v3AssetValidation.test.ts
```

Expected: FAIL because `v3AssetValidation.ts` does not exist.

- [ ] **Step 3: Implement validation helpers**

Create `src/tools/v3AssetValidation.ts` with:

```ts
import type { V3Bounds } from './v3ObjParser';
import type { V3PreviewVoxel } from './v3Voxelize';

export interface V3VoxelAssetValidationInput {
  voxels: V3PreviewVoxel[];
  maxVoxels: number;
  allowedBounds: V3Bounds;
  requiredMaterials?: string[];
}

export interface V3VoxelAssetValidationResult {
  errors: string[];
  voxelCount: number;
  materials: string[];
  connectedComponentCount: number;
}

export function validateV3VoxelAsset(input: V3VoxelAssetValidationInput): V3VoxelAssetValidationResult;
```

Connectivity should use 6-neighbor adjacency. Sort materials and errors deterministically.

- [ ] **Step 4: Run validation tests and add them to `npm test`**

Run:

```powershell
node --import tsx --test src/tools/v3AssetValidation.test.ts
```

Expected: PASS.

Modify `package.json` to include `src/tools/v3AssetValidation.test.ts`.

- [ ] **Step 5: Commit Task 5**

Run:

```powershell
git add src/tools/v3AssetValidation.ts src/tools/v3AssetValidation.test.ts package.json
git commit -m "feat: validate v3 voxel assets"
```

Expected: commit succeeds with only Task 5 files.

## Task 6: Local Preview Page

**Files:**
- Create: `public/v3-asset-preview.html`
- Modify: `README.md`

- [ ] **Step 1: Add local preview page**

Create `public/v3-asset-preview.html` as a self-contained page with:

```html
<main>
  <section class="toolbar">
    <label>Resolution <input id="resolution" type="number" min="4" max="48" value="12"></label>
    <button id="render">Render Synthetic Preview</button>
  </section>
  <canvas id="preview" width="960" height="540"></canvas>
  <pre id="summary"></pre>
</main>
```

The script should render a deterministic synthetic shell preview to canvas, show voxel count, materials, and validation status, and work without reading private files.

- [ ] **Step 2: Add README developer note**

Add a short README section:

```md
### V3 Offline Asset Tooling

V3 reference mesh tooling is developer-only and local. Use `node --import tsx scripts/v3/inspect-reference-asset.ts --obj <local.obj>` to inspect OBJ metadata, and use `/v3-asset-preview.html` during local development for synthetic voxel budget previews. Do not commit private reference meshes, textures, or direct conversions.
```

- [ ] **Step 3: Browser smoke**

Run the dev server and open:

```text
http://localhost:3000/v3-asset-preview.html
```

Expected: nonblank canvas, visible controls, summary text, and no console errors.

- [ ] **Step 4: Commit Task 6**

Run:

```powershell
git add public/v3-asset-preview.html README.md
git commit -m "feat: add v3 asset preview page"
```

Expected: commit succeeds with only Task 6 files.

## Task 7: Phase 2 Verification

**Files:**
- No planned new files unless verification finds defects in Phase 2 files.

- [ ] **Step 1: Run focused tool tests**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts src/tools/v3VoxelPartClassifier.test.ts src/tools/v3Voxelize.test.ts src/tools/v3AssetValidation.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run local reference inspection if file access is available**

Run:

```powershell
node --import tsx scripts/v3/inspect-reference-asset.ts --obj "C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.obj" --mtl "C:\Users\eastr\Downloads\Halo Reach - Spartans\Halo Reach - Spartans\Halo Reach - Spartans [IK Rigged] V3 UNSC Armory.mtl" --assert-reference-shape
```

Expected: PASS if the local file is available to the sandbox. If access is blocked, record the exact sandbox error and do not change committed tests.

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
```

Expected: no `.obj`, `.mtl`, `.fbx`, `.blend`, texture, or direct converted reference asset appears in staged or unstaged repo changes.
