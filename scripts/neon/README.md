# Neon Outrun Grid architecture kit

Original Blender geometry for the V3 Iron Vanguard environment sweep. Broad ceramic armor, slate alloy frames and graphite service recesses carry the upgraded arenas' visual language into the city setting. Protected cyan navigation marks and dark opaque window bands provide small accents. The kit contains no character models, downloaded geometry, or third-party game assets.

## Reproduce

From the repository root in PowerShell:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/neon/author-kit.py
& scripts/neon/optimize-kit.ps1
node scripts/neon/validate-kit.mjs
```

`author-kit.py -- --skip-render` skips only the review PNG. The authoring pass writes the editable source to `output/neon/neon-kit-v1.blend`, alongside `neon-kit-review.png`. The Blender source contains separate editable and runtime collections for High and Low, and an independent review composition. Review lighting is for geometry inspection; the game supplies physical surface maps, team accents and lighting.

The packaging script pins glTF Transform 4.5.1 and runs `dedup` then `prune --keep-attributes true`. Physical UVs survive packaging because runtime materials attach maps after loading. The GLBs require no geometry compression decoder or embedded textures.

## Shipping contract

`public/assets/neon/architecture/kit-v1.glb` and `kit-low-v1.glb` contain four exact named roots. All roots and child meshes have identity transforms. Vertices are authored in metres with centered pivots, glTF Y up and physical planar UVs. Each module has one mesh per material role. Both tiers use the same names, exact bounds and roles.

| Module | Exact width × height × depth (m) | High triangles | Low triangles | Batches |
| --- | --- | ---: | ---: | ---: |
| `beacon-column` | 1.5 × 8 × 1.5 | 3,408 | 1,264 | 4 |
| `goal-buffer` | 1.2 × 2 × 4 | 2,036 | 788 | 4 |
| `city-tower` | 12 × 38 × 12 | 8,084 | 3,152 | 5 |
| `neon-palm` | 8 × 12 × 8 | 4,360 | 1,648 | 4 |
| **Source kit total** | | **17,888** | **6,852** | **17** |

Optimized sizes: High **876,704 bytes**; Low **419,264 bytes**. `kit-v1.manifest.json` records generation, exact bounds, per-module budgets and base material values. `kit-validation.json` independently records the assets loaded by Three.js.

Every beacon vertex fits the original radius-0.75 m cylinder. Runtime can scale the center beacon uniformly in X/Z to its original 1.2 m diameter. The goal buffer preserves its complete existing 1.2 × 2 × 4 m envelope. No collision proxy, spawn, map dimension, floor or movement setting is added or changed by this kit. Towers and palms are remote scenery and must be placed outside the scaled gameplay floor by the runtime.

Material roles are `neon_ceramic`, `neon_alloy`, `neon_graphite`, `neon_accent` and `neon_window`. Only the last two have emission: authored strengths 0.45 and 0.08 respectively. Runtime controls final team colors and material appearance. Windows are opaque, and palm fronds are closed, faceted alloy geometry with ceramic spars; neither uses transparent foliage, glass or billboards.

## Validation and budgets

`validate-kit.mjs` loads both shipped GLBs through the game's actual Three.js GLTFLoader. It verifies module names and exact bounds, centered pivots, baked identity transforms, finite position/normal/UV attributes, material merging, opacity, only approved emissive roles, beacon cylindrical containment and manifest agreement. Hard limits are 17 source batches, 30,000/8,000 High/Low source triangles, and 1.5/0.5 MB file sizes. Low must have fewer than half the High triangles.

The final studio review was inspected after reducing microbevel tessellation and adjusting the camera to show the full tower crown. Broad chamfers retain shape while small fittings use cheaper geometry. Live gameplay performance, player readability, loading, cleanup and missing-asset fallbacks are verified by runtime integration and browser tests; these source budgets alone do not establish 60 FPS on every GPU.
