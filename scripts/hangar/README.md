# Industrial Hangar environment kit

The Hangar kit uses original Blender geometry with the same pale ceramic,
graphite recesses, slate alloy, and restrained service markings as Championship
Stadium, Canyon Plateau, and the actual V3 Iron Vanguard. Broad clean panels
sit inside real H-section columns and triangulated ceiling trusses. Recessed
vents, protected conduits, rounded plate edges, and sparse fasteners provide
depth without covering the combat background with tiny contrasting details.
There are no imported Halo meshes or generated character images.

Rebuild the editable source, review render, and shipping GLBs from the repository
root:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/hangar/author-kit.py
& scripts/hangar/optimize-kit.ps1
node scripts/hangar/validate-kit.mjs
```

Append `-- --skip-render` to the Blender command when only rebuilding assets.
The source is saved as `output/hangar/hangar-kit-v1.blend`; separate hidden
Editable collections preserve primitives, bevels, and weighted-normal modifiers
for each quality tier. `output/hangar/hangar-kit-review.png` shows two adjacent
wall bays with the actual source modules. Only the review truss is shortened to
fit the studio composition; shipping dimensions remain those below.

| Root name | Width × height × depth (m) | Material batches | High / Low triangles |
| --- | --- | --- | --- |
| `wall-bay` | 10.68 × 12 × 0.55 | 5 | 5,844 / 1,552 |
| `support-column` | 1.5 × 12 × 1.5 | 5 | 2,100 / 780 |
| `ceiling-truss` | 50 × 1.5 × 0.5 | 3 | 5,724 / 728 |
| `high-bay-light` | 4 × 0.5 × 1.2 | 3 | 2,400 / 440 |

Both variants have identical root names, dimensions, centered pivots, and
identity transforms. Coordinates are metres, Y-up, with the wall's front facing
positive Z and the truss extending along X. Wall details never extend more than
0.275 m from its central plane. Child transforms are baked into geometry, and
primitives are merged by material so the runtime can instance each batch. These
are perimeter visuals; the kit defines no collision or movement parameters.

The six reusable materials are `hangar_alloy`, `hangar_graphite`,
`hangar_ceramic`, `hangar_trim`, `hangar_amber`, and `hangar_light`. In the source
GLB, only the small fixture diffusers emit light; amber is muted painted trim.
Runtime materials give sparse amber locators a restrained emission of 0.55
and the fixture diffusers 1.35. Runtime materials supply the shared texture library;
there are no embedded images. UVs use planar coordinates in metres, leaving
physical tiling to the runtime. Runtime illumination should use the shared
light rig rather than adding a shadow light for every fixture.

High includes paired truss diagonals, retaining bands, fasteners, finer louvers,
and fixture cooling fins. Low retains the same envelopes and material balance
with fewer diagonals and louvers, one-segment bevels, and simplified hardware.
The full source kit contains 16,068 High triangles or 3,500 Low triangles, a
78% reduction, with 16 material batches in either tier. After glTF Transform
deduplication and pruning, files are 706,152 and 203,896 bytes respectively.

The packaging script pins glTF Transform 4.5.1 and preserves unused vertex
attributes because UVs are consumed by materials attached in the game. It
updates manifest byte counts after optimization and does not introduce a
runtime compression decoder. The GLBs stay compatible with the game's current
GLTFLoader. Native source and intermediate files remain in ignored `output/`.

`validate-kit.mjs` loads both real GLBs through Three.js GLTFLoader and verifies
all four roots, exact envelopes, center pivots, baked transforms, finite vertex
attributes, normals and UVs, all six shared material roles, merged batch counts,
and manifest parity. Budgets are 30,000 triangles / 1.6 MB for High and 9,000 /
600 KB for Low, with no more than 18 source batches. Results are saved to
`public/assets/hangar/architecture/kit-validation.json`; authored palette and
provenance are recorded in `kit-v1.manifest.json`.

Instancing controls draw calls and geometry storage, but repeated geometry and
lighting still need an in-game frame-rate check with actual V3 combatants. The
asset budgets alone do not establish the 60 FPS target. The map's original
dimensions, floor collision, spawns, and movement remain owned by existing
gameplay code and must be preserved by runtime placement.
