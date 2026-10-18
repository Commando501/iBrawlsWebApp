# Cyber Hex Grid environment kit

Cyber Hex Grid uses original Blender geometry with the pale ceramic, slate
alloy, graphite recesses, and broad readable armor surfaces shared by Stadium,
Canyon, Hangar, and V3 Iron Vanguard. Restrained cyan service locators and a
protected violet reactor retain the map's identity. Layered shields, rounded
edges, real recesses, reinforced collars, and sparse hardware provide surface
depth without adding a dense emissive pattern behind combatants.

There are no imported Halo models or generated character images. These are
visual replacements; map dimensions, obstacle placements, collision data,
spawns, movement, and gameplay remain owned by the existing game code.

Rebuild from the repository root:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/cyber/author-kit.py
& scripts/cyber/optimize-kit.ps1
node scripts/cyber/validate-kit.mjs
```

Append `-- --skip-render` to the Blender command when only rebuilding assets.
Editable primitives, bevels, and weighted normals are preserved in the hidden
Editable High and Low collections of `output/cyber/cyber-kit-v1.blend`.
`output/cyber/cyber-kit-review.png` renders the real source modules under neutral
studio lighting. No review geometry, camera, floor, or lights ship in the GLBs.

| Root name | Width × height × depth (m) | Material batches | High / Low triangles |
| --- | --- | --- | --- |
| `tech-column` | 1.8 × 6 × 1.8 | 5 | 8,244 / 1,396 |
| `tactical-cover` | 4 × 2.5 × 0.8 | 4 | 3,180 / 588 |
| `recharge-crate` | 1.6 × 1.6 × 1.6 | 4 | 4,008 / 784 |
| `reactor-core` | 3.5 × 3.5 × 3.5 | 5 | 5,204 / 1,852 |
| `relay-fin` | 4 × 14 × 3 | 4 | 8,532 / 932 |

Both tiers retain the same root names, dimensions, centered pivots, and
identity transforms. Child transforms are baked into mesh data. Coordinates
are metres and Y-up; tactical cover extends along X. The technical column's
vertices all fit within the existing 0.9 m horizontal cylinder radius, including
trim corners. The reactor's cage, brackets, and chamber all fit within the
existing 1.75 m sphere. The relay fins are remote architectural background
elements and should be placed outside the gameplay footprint.

The six shared material roles are `cyber_alloy`, `cyber_graphite`,
`cyber_ceramic`, `cyber_trim`, `cyber_cyan`, and `cyber_core`. In the authored
GLB, cyan locators emit at 0.65 and the small violet chamber emits at 1.15.
Source geometry is merged into one mesh per material per module for runtime
instancing. The kit contains no embedded images; runtime materials supply the
shared approved surface library. Planar UV coordinates are measured in metres
for consistent physical texture tiling. Emissive details do not require a
separate shadow light per object.

High includes finer collar and cage segmentation, paired lock pins, shield
restraints, cooling slots, and two-segment broad bevels. Low removes tiny
bevels and secondary hardware, simplifies the reactor rings, and retains broad
panels and major edge highlights. The complete source kit has 29,168 High
triangles and 5,552 Low triangles, an 81% reduction. Each variant has 22
material batches. Optimized shipping sizes are 1,333,632 bytes for High and
339,112 bytes for Low.

The optimizer pins glTF Transform 4.5.1, deduplicates shared content, and prunes
unused content while preserving UV attributes required by runtime materials.
It updates the manifest byte counts and adds no runtime compression decoder.
Native Blender source and intermediate files stay in ignored `output/`.

`validate-kit.mjs` loads both actual GLBs with Three.js GLTFLoader. It checks
all five exact roots, bounds, center pivots, baked transforms, material reuse,
finite positions/normals/UVs, manifest parity, and per-vertex cylindrical and
spherical containment. High budgets are 30,000 triangles / 1.6 MB; Low budgets
are 8,000 triangles / 500 KB; both allow at most 22 material batches. Validation
results are saved to `public/assets/cyber/architecture/kit-validation.json`.

Asset budgets and instancing reduce draw and memory costs. The 60 FPS target
still requires testing the complete running map with actual V3 combatants;
source-kit triangle counts alone are not a frame-rate measurement.
