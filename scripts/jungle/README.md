# Jungle Ruined Outpost environment kit

Original Blender geometry gives Jungle a layered forest silhouette and an
abandoned outpost identity within the material language of Stadium, Canyon,
Hangar, Cyber Hex Grid, and V3 Iron Vanguard. The playable cover uses broad
weathered stone, restrained pale ceramic shields, recessed alloy reinforcement,
small jade relic windows, and selective moss on protected upper surfaces.
There are no imported Halo models, generated character pictures, or added
collision meshes. Gameplay dimensions, obstacle placement, spawns, and movement
remain owned by the existing map data.

The remote canopy uses a ridged, buttressed trunk, tapering branches, and
layered compound fronds with individual pointed leaves. Each leaf is a closed
opaque volume with a raised midrib. Lower boughs add a sparse forest understory
without transparent cards, alpha overdraw, spherical crowns, or runtime foliage
animation. These modules belong outside the playable floor. The playable
`ancient-trunk` contains no foliage across combat sightlines.

Rebuild from the repository root:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/jungle/author-kit.py
& scripts/jungle/optimize-kit.ps1
node scripts/jungle/validate-kit.mjs
```

Append `-- --skip-render` to the Blender command when only rebuilding assets.
The editable source is `output/jungle/jungle-kit-v1.blend`; it contains separate
High and Low authoring collections and the merged runtime meshes. The neutral
studio review is `output/jungle/jungle-kit-review.png`. Review lighting, camera,
and ground do not ship in the GLBs. Runtime surface maps are supplied by
`jungleMaterials.ts`, so the studio preview intentionally shows untextured
source geometry and base material colors.

| Root name | Width × height × depth (m) | Material batches | High / Low triangles |
| --- | --- | --- | --- |
| `relic-spire` | 1.2 × 4 × 1.2 | 5 | 2,828 / 844 |
| `moss-boulder` | 3 × 3 × 3 | 2 | 688 / 240 |
| `ancient-trunk` | 2 × 7 × 2 | 2 | 800 / 312 |
| `ruined-wall` | 3 × 2 × 0.6 | 4 | 3,048 / 664 |
| `jungle-canopy` | 12 × 24 × 12 | 3 | 6,388 / 2,620 |

Both tiers use the same exact names and bounds. Roots have centered pivots and
identity transforms; all child transforms are baked into mesh data. Units are
metres, glTF is Y-up, and ruined walls extend along X. All relic vertices fit
the original 0.6 m horizontal collision radius; all playable trunk vertices,
including buttress roots and moss, fit the original 1 m radius. Box modules fit
their existing collision envelopes. No runtime enlargement is necessary.

Nine material roles are shared across the kit: `jungle_stone`, `jungle_bark`,
`jungle_moss`, `jungle_ceramic`, `jungle_alloy`, `jungle_graphite`, `jungle_jade`,
`jungle_leaf`, and `jungle_leaf_light`. Small jade windows emit at 0.45 in the
source kit. All foliage is opaque; no leaf material has emissive or alpha
effects. One mesh per role per module allows the game to instance the complete
kit in 16 material batches. Planar UV coordinates are measured in metres for
consistent physical tiling. The GLBs have no embedded images or lights.

High includes finer bark ridges, denser branching and leaf sprays, broad
two-segment structural bevels, additional surface fractures, and flush shield
clamps. Low retains the module silhouettes while reducing leaf counts, branch
segments, bark rings, bevels, and small hardware. The complete kit contains
13,752 High triangles and 4,680 Low triangles, a 66% reduction. Optimized file
sizes are 856,700 bytes and 333,408 bytes respectively.

The packaging script pins glTF Transform 4.5.1. It deduplicates and prunes while
preserving physical UV attributes needed by runtime materials, updates manifest
byte counts, and requires no runtime compression decoder. Native Blender and
intermediate files remain in ignored `output/`.

`validate-kit.mjs` loads both shipping assets with Three.js GLTFLoader. It checks
all five exact roots, dimensions, centered pivots, baked transforms, per-vertex
cylindrical containment, finite positions/normals/UVs, opaque foliage, material
batch reuse, and manifest parity. Budgets are 35,000 triangles / 1.8 MB for High,
9,000 triangles / 600 KB for Low, and 22 source material batches. A separate
canopy cap of 7,000 / 3,000 triangles protects the repeated background tree
budget. Results are written to `public/assets/jungle/architecture/kit-validation.json`.

These asset budgets support the 60 FPS target; they are not a frame-rate
measurement. Performance must be checked in the running map with actual V3
combatants, the selected graphics tier, and representative hardware.
