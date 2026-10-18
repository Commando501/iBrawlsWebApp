# Circle Arena asset pipeline

This original Blender kit gives the open Circle Arena a V3 Iron Vanguard training-facility identity: broad ceramic shields, slate alloy load rails, graphite service recesses, and small cyan status markers. It contains architecture only. The game continues to use its actual character models.

## Reproduce

Run from the repository root with Blender 5.2 and Node.js available:

```powershell
& 'F:/Tools/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python scripts/circle/author-kit.py
& scripts/circle/optimize-kit.ps1
node scripts/circle/validate-kit.mjs
```

The deterministic author script saves editable source at `output/circle/circle-kit-v1.blend` and a neutral review render at `output/circle/circle-kit-review.png`. These working artifacts are ignored. Append `-- --skip-render` to skip the review render only. The checked-in script, manifest, and optimized GLBs are the shipping sources.

The optimizer uses glTF Transform 4.5.1 `dedup` and `prune --keep-attributes true`. Retaining attributes preserves the physical metre UVs consumed by replacement runtime materials. Native GLTFLoader loading requires no geometry compression decoder.

## Module contracts

Both `public/assets/circle/architecture/kit-v1.glb` and `kit-low-v1.glb` contain these exact roots. Dimensions are metres in Three.js X/Y/Z order. Pivots are centered, node transforms are identity, and coordinates are Y-up.

| Root | Dimensions | High triangles | Low triangles | Material batches |
| --- | --- | ---: | ---: | ---: |
| `perimeter-pylon` | 1.2 × 9 × 1.2 | 1,692 | 476 | 4 |
| `ring-beam` | 7 × .5 × .9 | 1,140 | 308 | 4 |
| `projector-node` | 1.8 × 1.2 × 1.2 | 880 | 328 | 4 |
| `service-pod` | 4 × 3 × 2.4 | 2,244 | 676 | 5 |
| `backdrop-spire` | 3.5 × 24 × 3.5 | 2,860 | 716 | 4 |
| **Total** | | **8,816** | **2,504** | **21** |

The runtime places the kit outside the playable floor and overhead. These modules introduce no collision geometry and do not define map dimensions, movement, spawn positions, or gameplay boundaries. The ring beam's longitudinal axis is X. High adds chamfers, fasteners and service clamps; Low retains the same envelopes, pivots and roles with 71.6% fewer source triangles.

## Surfaces

The six shared roles are `circle_ceramic`, `circle_alloy`, `circle_graphite`, `circle_cyan`, `circle_light`, and `circle_dark`. All geometry is opaque. The kit has no embedded texture, alpha surface, baked lighting, or large emissive panel. Cyan and white emission strengths are .35 and .55 respectively; only small recessed status elements and overhead lenses use these roles. Their surface area remains below 1% per module in both tiers. Runtime materials provide the shared environment coatings.

Geometry is merged to one batch per material per module for efficient instancing. Packaged High and Low files are 455,620 and 166,812 bytes, below the 1.2 MB / .5 MB limits. Source triangle limits are 20,000 High / 7,000 Low, with at most 22 total batches.

## Validation

`validate-kit.mjs` loads both shipping variants with Three.js `GLTFLoader` and checks exact centered bounds, identity transforms, material role parity, finite UVs, unit normals, opaque surfaces, emission strength and surface area, manifest counts, and budgets. It writes `kit-validation.json`. Runtime instance placement, tier switching, loading failure behavior, resource cleanup, and measured frame time are covered by the map integration tests and separate QA report.
