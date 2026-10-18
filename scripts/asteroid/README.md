# Vanguard Asteroid Mine architecture kit

Original Blender geometry for the V3 Iron Vanguard environment sweep. Broad ceramic armor, graphite service recesses, machined alloy frames and small amber lamps share the upgraded arenas' material language. Fractured basalt and ore cover establish the mine setting without putting noisy patterns or extra debris on the playable floor. The kit contains no character models, downloaded geometry, or third-party game assets.

## Reproduce

From the repository root in PowerShell:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/asteroid/author-kit.py
& scripts/asteroid/optimize-kit.ps1
node scripts/asteroid/validate-kit.mjs
```

`author-kit.py -- --skip-render` skips only the review PNG. The authoring pass always writes the editable source to `output/asteroid/asteroid-kit-v1.blend`, alongside the optional `asteroid-kit-review.png`. The Blender source contains separate editable and runtime collections for High and Low, plus an independent review composition. Review lighting is for inspecting geometry; the game supplies the shipped physical surface maps and lighting.

The PowerShell packaging step pins glTF Transform 4.5.1 and runs `dedup` then `prune --keep-attributes true`. UVs must survive packaging because runtime materials attach physical maps after loading. These GLBs have no geometry compression decoder or embedded texture requirement. Compressed file size is not a substitute for scene triangle or draw-call measurements.

## Shipping contract

`public/assets/asteroid/architecture/kit-v1.glb` and `kit-low-v1.glb` have six exact named roots. All roots and child meshes have identity transforms. Their vertices are authored in metres with centered pivots, glTF Y up, and physical planar UVs. Each module has one mesh per material role. Source and Low LOD use the same names, bounds and roles.

| Module | Exact width × height × depth (m) | High triangles | Low triangles | Batches |
| --- | --- | ---: | ---: | ---: |
| `ore-extractor` | 2.6 × 5 × 2.6 | 9,084 | 1,692 | 4 |
| `ore-cluster` | 2.2 × 3 × 2.2 | 654 | 366 | 2 |
| `freight-container` | 1.8 × 2 × 3.5 | 5,532 | 944 | 4 |
| `blast-partition` | 5 × 3 × 0.4 | 2,748 | 540 | 4 |
| `asteroid-crag` | 14 × 14 × 14 | 866 | 366 | 2 |
| `mining-gantry` | 12 × 16 × 7 | 8,872 | 1,624 | 5 |
| **Source kit total** | | **27,756** | **5,532** | **21** |

Optimized sizes: High **1,250,224 bytes**; Low **346,664 bytes**. `kit-v1.manifest.json` records the generator, exact bounds, per-module budgets and base material values. `kit-validation.json` records the counts independently loaded by Three.js.

The four gameplay modules replace only the rendering of the existing seven obstacles: one extractor, two ore clusters, two containers and two partitions. Every extractor vertex fits the original radius-1.3 m cylinder, not merely its bounding box. The box modules fit their exact original envelopes. No collision proxy, spawn, map dimension, floor, or movement setting is added or changed by these files. Crags and gantries are remote scenery and must be placed outside the scaled gameplay floor by the runtime.

Material roles are `asteroid_rock`, `asteroid_ore`, `asteroid_ceramic`, `asteroid_alloy`, `asteroid_graphite`, `asteroid_amber`, and `asteroid_hazard`. Only amber has emission; ore and hazard paint remain matte. All roles are opaque, including lamps. Rock and ore share the original fractured physical surface maps; the industrial roles share the approved Stadium coating library. See the runtime material module for tier-specific physical maps, filtering, disposal and fallback behavior.

## Validation and budgets

`validate-kit.mjs` loads both shipped GLBs with the game's actual Three.js GLTFLoader. It verifies exact module names and bounds, centered pivots, identity transforms, finite vertex/normal/UV attributes, per-module material merging, opacity, seven roles, extractor cylindrical containment and manifest agreement. Limits are 24 total source batches, 38,000/10,000 High/Low source triangles, and 1.8/0.65 MB file sizes. Repeated crags are below 2,000 triangles and gantries below 10,000/3,000 per tier. Low must contain fewer than half the High triangles.

The review caught and corrected an occluded extractor chamber and coplanar inspection cap before final export. The final chamber is visible through its protective cage. Real gameplay performance, camera readability, resource cleanup and blocked-asset fallback are verified separately by the runtime integration and browser tests; these asset budgets alone do not establish 60 FPS on all hardware.
