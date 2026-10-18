# Rainy Cyber Streets asset pipeline

This kit contains original Blender-authored city architecture for the Rainy Cyber Streets preset. It uses the same broad ceramic armor, recessed graphite equipment, restrained metal edges, and small navigation lights as the upgraded arenas. Runtime textures provide weathering. The existing game's dog billboard graphic is applied to the dedicated screen material; the GLBs contain no embedded imagery or character models.

## Reproduce

From the repository root, with Blender 5.2 and Node.js available:

```powershell
& 'F:/Tools/Blender Foundation/Blender 5.2/blender.exe' --background --factory-startup --python scripts/rainy/author-kit.py
& scripts/rainy/optimize-kit.ps1
node scripts/rainy/validate-kit.mjs
```

Use `-- --skip-render` after the author script to skip only the review render. The author script always saves an editable source file at `output/rainy/rainy-kit-v1.blend`. The normal run also produces `output/rainy/rainy-kit-review.png` for visual inspection. These output files are local working artifacts; the reproducible author script and packaged assets are the shipping sources.

The optimizer runs glTF Transform 4.5.1 `dedup` and `prune --keep-attributes true`. Keeping attributes is intentional: UVs are used by materials assigned by the runtime even though no textures are embedded in the GLBs. No external geometry decoder is required.

## Module contracts

`public/assets/rainy/architecture/kit-v1.glb` and `kit-low-v1.glb` each contain the following six named roots. All dimensions are metres in Three.js X/Y/Z order; all pivots are centered and all node transforms are baked to identity.

| Root | Dimensions | High triangles | Low triangles | Material batches |
| --- | --- | ---: | ---: | ---: |
| `street-buffer` | 1.2 × 2 × 4 | 2,084 | 836 | 4 |
| `cargo-crate` | 2 × 2 × 2 | 2,124 | 900 | 3 |
| `building-block` | 14 × 36 × 12 | 7,928 | 3,096 | 5 |
| `streetlight` | 3 × 10 × 2 | 908 | 336 | 4 |
| `billboard-frame` | 12 × 8 × 1.6 | 866 | 294 | 4 |
| `street-palm` | 8 × 12 × 8 | 1,792 | 852 | 3 |
| **Total** | | **15,702** | **6,314** | **23** |

The two gameplay modules exactly occupy the existing obstacle envelopes. The runtime retains all existing collision, scale, rotation, and position data. Architectural modules do not introduce collision and are placed outside the playable floor. Every freestanding module's lower contact plane is at `-height / 2`; billboard mounting posts or building attachments are supplied by scene placement.

## Surfaces and UVs

The eight shared roles are `rainy_concrete`, `rainy_ceramic`, `rainy_alloy`, `rainy_graphite`, `rainy_amber`, `rainy_window`, `rainy_screen`, and `rainy_foliage`. Only amber lamps, occupied windows, and the screen have authored emission. All surfaces, including palms, are opaque; foliage uses closed connected geometry instead of alpha cards.

Architectural surfaces use physical metre UVs. The `rainy_screen` mesh is the sole exception: it is a front-facing +Z quad with a complete 0–1 UV chart. Do not overwrite that chart with world-projected UVs. The screen is recessed behind its protective frame and in front of the solid backing. Runtime material code owns the existing dog graphic and its texture orientation.

## Validation and budgets

`validate-kit.mjs` loads the packaged GLBs through the game's Three.js `GLTFLoader` and verifies roots, exact centered bounds, identity transforms, material merging, finite normals and UVs, opaque surfaces, emission roles, screen direction, and the screen's 0–1 chart. It compares triangle and batch counts against the manifest and writes `kit-validation.json`.

Source budgets are fewer than 30,000 High triangles and 12,000 Low triangles, at most 25 material batches, and at most 1.5 MB / 0.7 MB per High / Low GLB. The packaged files currently occupy 776,652 bytes and 385,996 bytes. Low uses 59.8% fewer source triangles. Scene instancing, placement counts, texture tiers, rain, and measured performance are validated separately by the runtime tests and map QA.
