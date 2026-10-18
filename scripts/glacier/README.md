# Glacier Hockey Rink asset pipeline

This original Blender kit upgrades the Glacier Hockey Rink preset with ceramic and alloy rink furniture, clear framed glass, fractured blue-gray ice ridges, and closed snow-covered evergreen boughs. Its broad armor panels and restrained red hockey trim follow the V3 Iron Vanguard environment palette. Character models remain the actual game assets and are not part of this kit.

## Reproduce

Run from the repository root with Blender 5.2 and Node.js available:

```powershell
& 'F:/Tools/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python scripts/glacier/author-kit.py
& scripts/glacier/optimize-kit.ps1
node scripts/glacier/validate-kit.mjs
```

The author script saves an editable Blender source at `output/glacier/glacier-kit-v1.blend` and renders `output/glacier/glacier-kit-review.png`. Append `-- --skip-render` to skip only the review render. These local working artifacts are ignored; the deterministic author script, manifest, and optimized GLBs are the shipping sources.

The optimizer uses glTF Transform 4.5.1 `dedup` followed by `prune --keep-attributes true`. UVs remain because runtime materials use them even though the kit embeds no textures. Native GLB loading requires no geometry compression decoder.

## Module contracts

Both `public/assets/glacier/architecture/kit-v1.glb` and `kit-low-v1.glb` contain the following exact roots. Dimensions are metres in Three.js X/Y/Z order; pivots are centered, node transforms are identity, and coordinates are Y-up.

| Root | Dimensions | High triangles | Low triangles | Material batches |
| --- | --- | ---: | ---: | ---: |
| `anchor-post` | .6 × 5 × .6 | 1,740 | 316 | 4 |
| `goal-buffer` | 1.5 × 2 × 4 | 1,784 | 816 | 4 |
| `rink-board` | 4 × .8 × .1 | 260 | 132 | 4 |
| `rink-glass` | 4 × 1.4 × .1 | 364 | 60 | 2 |
| `glacier-ridge` | 22 × 24 × 16 | 1,992 | 624 | 2 |
| `snowy-pine` | 6 × 12 × 6 | 10,488 | 4,204 | 3 |
| **Total** | | **16,628** | **6,152** | **19** |

Anchor vertices stay inside the existing radius .3 m cylinder. Goal buffers have solid inset backstops behind a sparse metal net pattern so they read as the existing solid obstacles. Thin boards and glass occupy their exact original depth. The runtime tiles these modules along existing objects and owns every collider, transform, map boundary, and movement behavior. Ice ridges and pines are background scenery and add no collision.

## Surfaces

The nine shared material roles are `glacier_ceramic`, `glacier_alloy`, `glacier_graphite`, `glacier_red`, `glacier_glass`, `glacier_ice`, `glacier_snow`, `glacier_foliage`, and `glacier_bark`. Every mesh has physical metre UVs for shared surface maps. No role emits light. Only the glass pane is transparent, authored at .20 opacity. Mountains, snow, and foliage are opaque geometry; there are no alpha foliage cards or glowing ice cliffs.

The High kit adds edge bevels, recessed fasteners, denser fractures, and more bough segments. Low retains the same six module envelopes, role names, and collision silhouettes while using 63.0% fewer source triangles. Source geometry is merged to one batch per material per module, making repeated scenery suitable for instancing.

## Validation

`validate-kit.mjs` uses the same Three.js `GLTFLoader` as the game. It checks exact centered envelopes, baked transforms, finite physical UVs, unit normals, all anchor vertices against cylindrical containment, approved glass opacity, opaque non-glass surfaces, zero emission, named roles, and manifest counts. It writes `kit-validation.json`.

Budgets are below 30,000 High / 12,000 Low triangles, fewer than 26 material batches, and at most 1.5 MB / .7 MB per GLB. Packaged High and Low files are 1,135,476 and 444,708 bytes. Runtime instance counts, material tiers, cleanup behavior, weather, and measured frame rate are covered separately by the map integration tests and QA report.
