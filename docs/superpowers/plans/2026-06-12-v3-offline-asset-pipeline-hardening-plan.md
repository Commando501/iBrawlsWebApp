# V3 Offline Asset Pipeline Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the developer-only V3 offline asset pipeline so OBJ/MTL reference files can produce reviewable, sanitized voxel candidate packages without committing private source assets or adding any runtime upload path.

**Architecture:** Phase 12 builds on the existing Phase 2 parser, classifier, voxel preview, validation helpers, local CLI, and preview page. The committed code remains synthetic-test driven and source-safe: offline scripts can read private local meshes, but persisted review packages contain sanitized metadata, slot candidates, fit/budget validation, and coarse voxel previews only.

**Tech Stack:** TypeScript, Node test runner with `tsx`, Node filesystem CLI scripts, existing V3 manifest/bounds/budget contracts, browser-only local preview HTML.

---

## Scope And Guardrails

- Developer tooling only. Do not add gameplay runtime mesh loading, network messages, server upload routes, Worker upload routes, or player-facing OBJ/FBX/Blend import.
- Do not commit `.obj`, `.mtl`, `.fbx`, `.blend`, textures, generated direct-reference voxel payloads, screenshots of the private reference asset, or absolute private source paths.
- Synthetic tests must be enough to verify parser, review package, validation, CLI, and preview behavior.
- The local CLI may read private files on the developer machine, but committed output examples must be synthetic only.
- Review packages must store `source.baseName`, content-derived hashes, counts, slot candidates, role candidates, validation results, and preview voxels. They must not store full source text, absolute paths, texture filenames, or material file contents.
- End-user customization remains in-game voxel editing only. This phase must not expose mesh upload to players.

---

## File Structure

- Modify `src/tools/v3ObjParser.ts`: add parsed face triangles and optional MTL material summaries while preserving existing metadata API.
- Modify `src/tools/v3ObjParser.test.ts`: cover face extraction and sanitized material parsing from synthetic OBJ/MTL strings.
- Create `src/tools/v3OfflineReviewPackage.ts`: build sanitized per-part V3 review packages from parsed metadata, classifier output, voxel previews, and existing V3 bounds/budget contracts.
- Create `src/tools/v3OfflineReviewPackage.test.ts`: verify slot grouping, budget validation, source sanitization, and deterministic package output.
- Modify `scripts/v3/inspect-reference-asset.ts`: add `--review-json`, `--preview-resolution`, and `--out` for writing sanitized local review package JSON.
- Create `scripts/v3/inspect-reference-asset.test.ts`: test CLI argument behavior and JSON writing with synthetic local temp files.
- Modify `public/v3-asset-preview.html`: allow pasted review package JSON and render per-part validation summaries without uploading anything.
- Modify `README.md`: document Phase 12 as offline hardening and repeat the private-source guardrails.
- Modify `package.json`: include any new test files in `npm test`.

---

## Task 1: Parser Face And MTL Metadata

**Files:**
- Modify: `src/tools/v3ObjParser.ts`
- Modify: `src/tools/v3ObjParser.test.ts`

- [ ] **Step 1: Write failing parser tests for face extraction and MTL material summaries**

Append to `src/tools/v3ObjParser.test.ts`:

```ts
describe('parseV3ObjMetadata face extraction and material summaries', () => {
  it('captures triangulated faces with object, group, material, and vertex positions', () => {
    const parsed = parseV3ObjMetadata([
      'o Helmet',
      'g Visor',
      'usemtl visor_gold',
      'v 0 0 0',
      'v 1 0 0',
      'v 1 1 0',
      'v 0 1 0',
      'f 1 2 3 4',
    ].join('\n'));

    assert.equal(parsed.triangles.length, 2);
    assert.deepEqual(parsed.triangles[0], {
      objectName: 'Helmet',
      groupNames: ['Visor'],
      materialName: 'visor_gold',
      a: [0, 0, 0],
      b: [1, 0, 0],
      c: [1, 1, 0],
    });
    assert.deepEqual(parsed.triangles[1].c, [0, 1, 0]);
  });

  it('parses sanitized MTL material color and emissive hints without texture paths', () => {
    const parsed = parseV3ObjMetadata('mtllib private.mtl\nv 0 0 0', [
      'newmtl armor_primary',
      'Kd 0.25 0.5 0.75',
      'Ke 0.1 0.2 0.3',
      'map_Kd C:/private/source/armor.png',
      'newmtl visor_gold',
      'Kd 1.0 0.75 0.2',
    ].join('\n'));

    assert.deepEqual(parsed.materialSummaries, [
      { name: 'armor_primary', diffuse: [0.25, 0.5, 0.75], emissive: [0.1, 0.2, 0.3], hasTextureReference: true },
      { name: 'visor_gold', diffuse: [1, 0.75, 0.2], emissive: null, hasTextureReference: false },
    ]);
    assert.equal(JSON.stringify(parsed).includes('armor.png'), false);
    assert.equal(JSON.stringify(parsed).includes('C:/private'), false);
  });
});
```

- [ ] **Step 2: Run parser test and confirm RED**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts
```

Expected: FAIL because `parseV3ObjMetadata` accepts one argument and `V3ObjMetadata` has no `triangles` or `materialSummaries`.

- [ ] **Step 3: Add parser types**

In `src/tools/v3ObjParser.ts`, extend the public API:

```ts
export interface V3ObjTriangleMetadata {
  objectName: string;
  groupNames: string[];
  materialName: string | null;
  a: V3Vec3;
  b: V3Vec3;
  c: V3Vec3;
}

export interface V3MtlMaterialSummary {
  name: string;
  diffuse: V3Vec3 | null;
  emissive: V3Vec3 | null;
  hasTextureReference: boolean;
}

export interface V3ObjMetadata {
  materialLibraries: string[];
  materials: string[];
  materialSummaries: V3MtlMaterialSummary[];
  vertexCount: number;
  faceCount: number;
  triangleCountEstimate: number;
  bounds: V3Bounds | null;
  objects: V3ObjObjectMetadata[];
  triangles: V3ObjTriangleMetadata[];
}

export function parseV3ObjMetadata(source: string, mtlSource?: string): V3ObjMetadata;
```

Update `createEmptyMetadata()`:

```ts
const createEmptyMetadata = (): V3ObjMetadata => ({
  materialLibraries: [],
  materials: [],
  materialSummaries: [],
  vertexCount: 0,
  faceCount: 0,
  triangleCountEstimate: 0,
  bounds: null,
  objects: [],
  triangles: [],
});
```

- [ ] **Step 4: Add sanitized MTL parser**

Add helpers in `src/tools/v3ObjParser.ts`:

```ts
const parseColor = (value: string): V3Vec3 | null => {
  const [r, g, b] = value.split(/\s+/).map(Number);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) return null;
  return [r, g, b];
};

const parseV3MtlMaterialSummaries = (source: string | undefined): V3MtlMaterialSummary[] => {
  if (!source) return [];
  const summaries: V3MtlMaterialSummary[] = [];
  let current: V3MtlMaterialSummary | null = null;

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const { command, value } = readLineCommand(trimmed);

    if (command === 'newmtl' && value) {
      current = { name: value, diffuse: null, emissive: null, hasTextureReference: false };
      summaries.push(current);
      continue;
    }
    if (!current) continue;
    if (command === 'Kd') current.diffuse = parseColor(value);
    if (command === 'Ke') current.emissive = parseColor(value);
    if (command.toLowerCase().startsWith('map_')) current.hasTextureReference = true;
  }

  return summaries;
};
```

- [ ] **Step 5: Capture triangulated faces**

Inside the `f` branch of `parseV3ObjMetadata`, after collecting resolved vertex indexes, fan-triangulate faces:

```ts
const resolvedVertexIndexes = faceTokens
  .map((token) => parseFaceVertexIndex(token, vertices.length))
  .filter((vertexIndex): vertexIndex is number => vertexIndex !== null);

for (const vertexIndex of resolvedVertexIndexes) {
  addUnique(object.referencedVertexIndexes, vertexIndex);
  object.bounds = updateBounds(object.bounds, vertices[vertexIndex - 1]);
}

for (let i = 1; i < resolvedVertexIndexes.length - 1; i += 1) {
  metadata.triangles.push({
    objectName: object.name,
    groupNames: [...object.groupNames],
    materialName: currentMaterial,
    a: [...vertices[resolvedVertexIndexes[0] - 1]],
    b: [...vertices[resolvedVertexIndexes[i] - 1]],
    c: [...vertices[resolvedVertexIndexes[i + 1] - 1]],
  });
}
```

At the start of `parseV3ObjMetadata`, after `metadata` is created:

```ts
metadata.materialSummaries = parseV3MtlMaterialSummaries(mtlSource);
```

- [ ] **Step 6: Run parser tests and commit**

Run:

```powershell
node --import tsx --test src/tools/v3ObjParser.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add src/tools/v3ObjParser.ts src/tools/v3ObjParser.test.ts
git commit -m "feat: enrich v3 reference parser metadata"
```

---

## Task 2: Sanitized Offline Review Package Builder

**Files:**
- Create: `src/tools/v3OfflineReviewPackage.ts`
- Create: `src/tools/v3OfflineReviewPackage.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing review package tests**

Create `src/tools/v3OfflineReviewPackage.test.ts`:

```ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { V3ObjMetadata } from './v3ObjParser';
import { buildV3OfflineReviewPackage } from './v3OfflineReviewPackage';

const metadata = (): V3ObjMetadata => ({
  materialLibraries: ['private-source.mtl'],
  materials: ['armor_primary', 'visor_gold'],
  materialSummaries: [
    { name: 'armor_primary', diffuse: [0.2, 0.4, 0.6], emissive: null, hasTextureReference: true },
    { name: 'visor_gold', diffuse: [1, 0.8, 0.2], emissive: [0.2, 0.6, 1], hasTextureReference: false },
  ],
  vertexCount: 4,
  faceCount: 2,
  triangleCountEstimate: 2,
  bounds: { min: [0, 0, 0], max: [1, 1, 1] },
  objects: [
    {
      name: 'Helmet_Primary',
      groupNames: ['Helmet'],
      materialNames: ['armor_primary', 'visor_gold'],
      faceCount: 2,
      triangleCountEstimate: 2,
      referencedVertexIndexes: [1, 2, 3, 4],
      bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    },
  ],
  triangles: [
    { objectName: 'Helmet_Primary', groupNames: ['Helmet'], materialName: 'armor_primary', a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] },
    { objectName: 'Helmet_Primary', groupNames: ['Helmet'], materialName: 'visor_gold', a: [0, 0, 0], b: [0, 1, 0], c: [0, 0, 1] },
  ],
});

describe('buildV3OfflineReviewPackage', () => {
  it('builds deterministic sanitized review packages without absolute source paths', () => {
    const review = buildV3OfflineReviewPackage({
      sourcePath: 'C:/Users/private/Halo Reach - Spartans/source.obj',
      metadata: metadata(),
      previewResolution: 6,
    });

    assert.equal(review.schemaVersion, 1);
    assert.equal(review.source.baseName, 'source.obj');
    assert.equal(review.source.absolutePathIncluded, false);
    assert.equal(JSON.stringify(review).includes('C:/Users/private'), false);
    assert.equal(review.parts.length, 1);
    assert.equal(review.parts[0].objectName, 'Helmet_Primary');
    assert.equal(review.parts[0].slotCandidate, 'helmet');
    assert.deepEqual(review.parts[0].paintRoles, ['primary', 'visor']);
    assert.equal(review.parts[0].preview.resolution, 6);
    assert.equal(review.parts[0].validation.errors.length, 0);
  });

  it('reports unknown slots and validation failures for review instead of dropping parts', () => {
    const source = metadata();
    source.objects[0] = {
      ...source.objects[0],
      name: 'MysteryDecoration',
      groupNames: [],
      materialNames: ['plain'],
      bounds: { min: [-999, 0, 0], max: [999, 1, 1] },
    };
    source.triangles[0] = {
      ...source.triangles[0],
      objectName: 'MysteryDecoration',
      groupNames: [],
      materialName: 'plain',
      a: [-999, 0, 0],
      b: [999, 0, 0],
      c: [0, 1, 0],
    };

    const review = buildV3OfflineReviewPackage({
      sourcePath: 'source.obj',
      metadata: source,
      previewResolution: 4,
    });

    assert.equal(review.parts[0].slotCandidate, 'unknown');
    assert.equal(review.parts[0].validation.errors.some((error) => error.includes('outside allowed bounds')), true);
    assert.equal(review.summary.unknownPartCount, 1);
    assert.equal(review.summary.invalidPartCount, 1);
  });
});
```

- [ ] **Step 2: Run review package test and confirm RED**

Run:

```powershell
node --import tsx --test src/tools/v3OfflineReviewPackage.test.ts
```

Expected: FAIL because `src/tools/v3OfflineReviewPackage.ts` does not exist.

- [ ] **Step 3: Implement review package types and builder**

Create `src/tools/v3OfflineReviewPackage.ts`:

```ts
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { V3Bounds, V3ObjMetadata, V3ObjObjectMetadata, V3ObjTriangleMetadata } from './v3ObjParser';
import { classifyV3ReferencePart, type V3CandidatePaintRole, type V3CandidateSlot } from './v3VoxelPartClassifier';
import { voxelizeTriangleBoundsPreview, type V3PreviewTriangle, type V3VoxelPreview } from './v3Voxelize';
import { validateV3VoxelAsset, type V3VoxelAssetValidationResult } from './v3AssetValidation';
import type { V3CharacterSlotId } from '../components/v3/v3ModelTypes';
import { getV3CharacterPartBounds, getV3WeaponBounds, type V3FitBounds } from '../components/v3/v3PartBounds';
import { BUILT_IN_V3_CHARACTER_PARTS, getDefaultV3WeaponManifest } from '../components/v3/v3AssetManifest';

export interface V3OfflineReviewPackageInput {
  sourcePath: string;
  metadata: V3ObjMetadata;
  previewResolution?: number;
}

export interface V3OfflineReviewPart {
  objectName: string;
  groupNames: string[];
  materialNames: string[];
  slotCandidate: V3CandidateSlot;
  paintRoles: V3CandidatePaintRole[];
  faceCount: number;
  triangleCountEstimate: number;
  sourceBounds: V3ObjObjectMetadata['bounds'];
  preview: V3VoxelPreview;
  validation: V3VoxelAssetValidationResult;
}

export interface V3OfflineReviewPackage {
  schemaVersion: 1;
  source: {
    baseName: string;
    absolutePathIncluded: false;
    vertexCount: number;
    faceCount: number;
    triangleCountEstimate: number;
  };
  summary: {
    partCount: number;
    unknownPartCount: number;
    invalidPartCount: number;
  };
  parts: V3OfflineReviewPart[];
}

const CHARACTER_SLOT_FOR_CANDIDATE: Partial<Record<V3CandidateSlot, V3CharacterSlotId>> = {
  helmet: 'helmet',
  neck: 'neck',
  chest: 'chest',
  shoulder: 'shoulderLeft',
  upperArm: 'upperArmLeft',
  forearm: 'forearmLeft',
  hand: 'handLeft',
  pelvis: 'pelvis',
  thigh: 'thighLeft',
  shin: 'shinLeft',
  foot: 'footLeft',
  back: 'back',
};

const getCandidateCharacterManifest = (slot: V3CandidateSlot) => {
  const characterSlot = CHARACTER_SLOT_FOR_CANDIDATE[slot];
  return characterSlot
    ? BUILT_IN_V3_CHARACTER_PARTS.find((part) => part.slot === characterSlot)
    : undefined;
};

const slotBudget = (slot: V3CandidateSlot): number => {
  if (slot === 'hammer' || slot === 'sword' || slot === 'pistol') {
    return getDefaultV3WeaponManifest(slot).budget.sourceVoxelCount;
  }
  if (slot === 'unknown' || slot === 'weapon') return 96;
  return getCandidateCharacterManifest(slot)?.budget.sourceVoxelCount ?? 96;
};

const fitBoundsToVoxelBounds = (bounds: V3FitBounds): V3Bounds => ({
  min: [0, 0, 0],
  max: [
    bounds.maxDimensions.x - 1,
    bounds.maxDimensions.y - 1,
    bounds.maxDimensions.z - 1,
  ],
});

const fallbackReviewBounds = (): V3Bounds => ({ min: [0, 0, 0], max: [2, 2, 2] });

const slotBounds = (slot: V3CandidateSlot): V3Bounds => {
  if (slot === 'hammer' || slot === 'sword' || slot === 'pistol') return fitBoundsToVoxelBounds(getV3WeaponBounds(slot));
  if (slot === 'unknown' || slot === 'weapon') return fallbackReviewBounds();
  const characterSlot = CHARACTER_SLOT_FOR_CANDIDATE[slot];
  return characterSlot ? fitBoundsToVoxelBounds(getV3CharacterPartBounds(characterSlot)) : fallbackReviewBounds();
};

const trianglesForObject = (
  object: V3ObjObjectMetadata,
  triangles: V3ObjTriangleMetadata[]
): V3PreviewTriangle[] =>
  triangles
    .filter((triangle) => triangle.objectName === object.name)
    .map((triangle) => ({
      a: triangle.a,
      b: triangle.b,
      c: triangle.c,
      material: triangle.materialName ?? object.materialNames[0] ?? 'fixed',
    }));

export function buildV3OfflineReviewPackage(input: V3OfflineReviewPackageInput): V3OfflineReviewPackage {
  const resolution = input.previewResolution ?? 8;
  const parts = input.metadata.objects.map((object) => {
    const classification = classifyV3ReferencePart({
      objectName: object.name,
      groupNames: object.groupNames,
      materialNames: object.materialNames,
    });
    const bounds = slotBounds(classification.slot);
    const preview = voxelizeTriangleBoundsPreview({
      bounds: object.bounds ?? input.metadata.bounds ?? bounds,
      resolution,
      triangles: trianglesForObject(object, input.metadata.triangles),
    });
    const validation = validateV3VoxelAsset({
      voxels: preview.voxels,
      maxVoxels: slotBudget(classification.slot),
      allowedBounds: bounds,
      requiredMaterials: object.materialNames,
    });

    return {
      objectName: object.name,
      groupNames: [...object.groupNames],
      materialNames: [...object.materialNames],
      slotCandidate: classification.slot,
      paintRoles: classification.paintRoles,
      faceCount: object.faceCount,
      triangleCountEstimate: object.triangleCountEstimate,
      sourceBounds: object.bounds,
      preview,
      validation,
    };
  });

  return {
    schemaVersion: 1,
    source: {
      baseName: basename(input.sourcePath),
      absolutePathIncluded: false,
      vertexCount: input.metadata.vertexCount,
      faceCount: input.metadata.faceCount,
      triangleCountEstimate: input.metadata.triangleCountEstimate,
    },
    summary: {
      partCount: parts.length,
      unknownPartCount: parts.filter((part) => part.slotCandidate === 'unknown').length,
      invalidPartCount: parts.filter((part) => part.validation.errors.length > 0).length,
    },
    parts,
  };
}
```

- [ ] **Step 4: Register test in `package.json`**

Add `src/tools/v3OfflineReviewPackage.test.ts` immediately after `src/tools/v3AssetValidation.test.ts` in the `test` script.

Run:

```powershell
node -e "const s=require('./package.json').scripts.test; const p='src/tools/v3OfflineReviewPackage.test.ts'; const count=s.split(p).length-1; if (count !== 1) throw new Error(p+' count '+count);"
```

Expected: exits 0.

- [ ] **Step 5: Run review package tests and commit**

Run:

```powershell
node --import tsx --test src/tools/v3OfflineReviewPackage.test.ts src/tools/v3ObjParser.test.ts src/tools/v3AssetValidation.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add src/tools/v3OfflineReviewPackage.ts src/tools/v3OfflineReviewPackage.test.ts package.json
git commit -m "feat: build sanitized v3 offline review packages"
```

---

## Task 3: CLI Review Package Output

**Files:**
- Modify: `scripts/v3/inspect-reference-asset.ts`
- Create: `scripts/v3/inspect-reference-asset.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI tests**

Create `scripts/v3/inspect-reference-asset.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { inspectV3ReferenceAssetForCli } from './inspect-reference-asset';

const tmp = join(process.cwd(), '.tmp-v3-inspect-test');

describe('inspectV3ReferenceAssetForCli', () => {
  it('writes sanitized review JSON without absolute source paths', () => {
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    const objPath = join(tmp, 'synthetic.obj');
    const mtlPath = join(tmp, 'synthetic.mtl');
    const outPath = join(tmp, 'review.json');
    writeFileSync(objPath, [
      'mtllib synthetic.mtl',
      'o Helmet_Primary',
      'g Helmet',
      'usemtl armor_primary',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'f 1 2 3',
    ].join('\n'));
    writeFileSync(mtlPath, 'newmtl armor_primary\nKd 0.2 0.4 0.6\nmap_Kd private.png\n');

    const result = inspectV3ReferenceAssetForCli([
      '--obj', objPath,
      '--mtl', mtlPath,
      '--review-json',
      '--preview-resolution', '5',
      '--out', outPath,
    ]);

    const saved = readFileSync(outPath, 'utf8');
    assert.equal(result.mode, 'review-json');
    assert.equal(saved.includes(objPath), false);
    assert.equal(saved.includes('private.png'), false);
    assert.equal(JSON.parse(saved).source.baseName, 'synthetic.obj');
    assert.equal(JSON.parse(saved).parts[0].preview.resolution, 5);
  });
});
```

- [ ] **Step 2: Run CLI test and confirm RED**

Run:

```powershell
node --import tsx --test scripts/v3/inspect-reference-asset.test.ts
```

Expected: FAIL because `inspectV3ReferenceAssetForCli` is not exported and `--review-json` is not implemented.

- [ ] **Step 3: Refactor CLI into testable exported function**

In `scripts/v3/inspect-reference-asset.ts`, add `writeFileSync` import and builder import:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { buildV3OfflineReviewPackage } from '../../src/tools/v3OfflineReviewPackage';
```

Extend `InspectArgs`:

```ts
  reviewJson: boolean;
  outPath?: string;
  previewResolution: number;
```

Extend `parseArgs`:

```ts
const parsePreviewResolution = (value: string | undefined): number => {
  const parsed = Number.parseInt(value ?? '8', 10);
  return Number.isFinite(parsed) ? Math.max(1, parsed) : 8;
};

return {
  objPath,
  mtlPath: readArgValue(args, '--mtl'),
  json: args.includes('--json'),
  reviewJson: args.includes('--review-json'),
  outPath: readArgValue(args, '--out'),
  previewResolution: parsePreviewResolution(readArgValue(args, '--preview-resolution')),
  assertReferenceShape: args.includes('--assert-reference-shape'),
};
```

Add exported function:

```ts
export function inspectV3ReferenceAssetForCli(args: string[]): { mode: 'text' | 'json' | 'review-json'; output: string } {
  const options = parseArgs(args);
  if (!existsSync(options.objPath)) throw new Error(`OBJ file does not exist: ${options.objPath}`);
  if (options.mtlPath && !existsSync(options.mtlPath)) throw new Error(`MTL file does not exist: ${options.mtlPath}`);

  const source = readFileSync(options.objPath, 'utf8');
  const mtlSource = options.mtlPath ? readFileSync(options.mtlPath, 'utf8') : undefined;
  const metadata = parseV3ObjMetadata(source, mtlSource);
  if (options.assertReferenceShape) assertV3ReferenceAssetShape(metadata);

  if (options.reviewJson) {
    const output = JSON.stringify(buildV3OfflineReviewPackage({
      sourcePath: options.objPath,
      metadata,
      previewResolution: options.previewResolution,
    }), null, 2);
    if (options.outPath) writeFileSync(options.outPath, output);
    return { mode: 'review-json', output };
  }

  if (options.json) {
    return {
      mode: 'json',
      output: JSON.stringify({ sourceFile: basename(options.objPath), mtlFile: options.mtlPath ? basename(options.mtlPath) : null, metadata }, null, 2),
    };
  }

  return { mode: 'text', output: summarizeText(metadata, options.objPath, options.mtlPath) };
}
```

Replace direct `main()` behavior with:

```ts
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(inspectV3ReferenceAssetForCli(process.argv.slice(2)).output);
}
```

- [ ] **Step 4: Register CLI test and run**

Add `scripts/v3/inspect-reference-asset.test.ts` to `package.json` after `src/tools/v3OfflineReviewPackage.test.ts`.

Run:

```powershell
node --import tsx --test scripts/v3/inspect-reference-asset.test.ts src/tools/v3OfflineReviewPackage.test.ts
npm run lint
```

Expected: PASS.

Commit:

```powershell
git add scripts/v3/inspect-reference-asset.ts scripts/v3/inspect-reference-asset.test.ts package.json
git commit -m "feat: emit v3 offline review packages from cli"
```

---

## Task 4: Preview Page Review JSON Mode

**Files:**
- Modify: `public/v3-asset-preview.html`

- [ ] **Step 1: Add review JSON paste UI**

In `public/v3-asset-preview.html`, add this inside `.toolbar` after the render button:

```html
<button id="loadReview">Load Review JSON</button>
```

Add after the toolbar:

```html
<textarea id="reviewInput" placeholder="Paste sanitized V3 review package JSON"></textarea>
```

Add CSS:

```css
#reviewInput {
  width: 100%;
  min-height: 120px;
  margin-bottom: 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  padding: 12px;
  font: 13px/1.45 "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
}
```

- [ ] **Step 2: Add client-side review parsing**

In the script, add references:

```js
const loadReviewButton = document.getElementById("loadReview");
const reviewInput = document.getElementById("reviewInput");
```

Add summary renderer:

```js
function renderReviewPackage(review) {
  const parts = Array.isArray(review.parts) ? review.parts : [];
  const lines = [
    `Review package schema: ${review.schemaVersion}`,
    `Source: ${review.source?.baseName ?? "unknown"}`,
    `Parts: ${parts.length}`,
    `Unknown parts: ${review.summary?.unknownPartCount ?? 0}`,
    `Invalid parts: ${review.summary?.invalidPartCount ?? 0}`,
    "",
    ...parts.map((part) => {
      const status = part.validation?.errors?.length ? `WARN ${part.validation.errors.join("; ")}` : "PASS";
      return `${status} ${part.objectName} -> ${part.slotCandidate} roles=${(part.paintRoles ?? []).join(", ")} voxels=${part.preview?.voxels?.length ?? 0}`;
    }),
  ];
  summary.textContent = lines.join("\n");
  summary.className = (review.summary?.invalidPartCount ?? 0) > 0 ? "status-warn" : "status-pass";
}

loadReviewButton.addEventListener("click", () => {
  try {
    renderReviewPackage(JSON.parse(reviewInput.value));
  } catch (error) {
    summary.textContent = `Invalid review JSON: ${error instanceof Error ? error.message : String(error)}`;
    summary.className = "status-warn";
  }
});
```

- [ ] **Step 3: Browser smoke preview page**

Run the dev server if it is not already running:

```powershell
npm run dev
```

Open:

```text
http://127.0.0.1:3000/v3-asset-preview.html
```

Paste this synthetic review package and click `Load Review JSON`:

```json
{"schemaVersion":1,"source":{"baseName":"synthetic.obj","absolutePathIncluded":false,"vertexCount":3,"faceCount":1,"triangleCountEstimate":1},"summary":{"partCount":1,"unknownPartCount":0,"invalidPartCount":0},"parts":[{"objectName":"Helmet_Primary","slotCandidate":"helmet","paintRoles":["primary"],"preview":{"voxels":[{"x":0,"y":0,"z":0,"material":"primary"}]},"validation":{"errors":[]}}]}
```

Expected:

- Page does not upload or navigate.
- Summary contains `Source: synthetic.obj`.
- Summary contains `PASS Helmet_Primary -> helmet`.

Commit:

```powershell
git add public/v3-asset-preview.html
git commit -m "feat: preview v3 offline review packages"
```

---

## Task 5: Documentation And Full Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README Phase 12 text**

Add after the Phase 11 paragraph:

```md
Phase 12 hardens the developer-only offline V3 asset pipeline. Local OBJ/MTL inspection can now emit sanitized review packages with slot candidates, paint-role hints, coarse voxel previews, fit/budget validation, and source-safe metadata. These packages are for local art-direction review only: private reference files, texture paths, direct conversions, server uploads, and gameplay/runtime mesh import remain excluded.
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

- `npm run lint`: PASS.
- `npm test`: PASS with the new parser, review package, CLI, and preview-adjacent tests included.
- `npm run build`: PASS; existing Vite chunk warnings are acceptable.
- `git diff --check`: no whitespace errors.

- [ ] **Step 3: Commit docs**

Commit:

```powershell
git add README.md
git commit -m "docs: document v3 offline asset pipeline hardening"
```

---

## Phase 12 Completion Criteria

- OBJ parsing exposes triangulated face metadata and sanitized MTL material summaries.
- Sanitized review packages group candidate parts by object, classify V3 slots and paint roles, include coarse preview voxels, and carry validation results.
- Review packages do not include absolute source paths, source mesh text, MTL texture paths, or private reference asset bytes.
- CLI can emit text summaries, metadata JSON, and review-package JSON to a local `--out` path.
- Preview page can display pasted review package summaries without server upload.
- README documents Phase 12 and the private-reference guardrails.
- No server, Worker, network protocol, gameplay runtime, or player-facing mesh import path is added.
- `npm run lint`, `npm test`, `npm run build`, and `git diff --check` pass.

## Self-Review

- Spec coverage: The plan hardens the developer-only offline path, supports OBJ/MTL review packages, keeps FBX/Blend as local reference inputs for future Blender-side tooling, and preserves the no-upload/no-private-assets rule.
- Placeholder scan: There are no `TBD`, `TODO`, "implement later", or "similar to" placeholders.
- Type consistency: `V3OfflineReviewPackage`, `V3OfflineReviewPart`, `V3ObjTriangleMetadata`, and `V3MtlMaterialSummary` names are used consistently across tasks.
