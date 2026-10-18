# Canyon Plateau environment kit

The Canyon visual upgrade uses original Blender architecture and stratified rock
geometry, with the same slate alloy, pale ceramic, subtle service details, and
restrained light accents as Championship Stadium and the actual V3 Iron Vanguard.
The game owns all combatants; this kit supplies only environment geometry.
There are no imported Halo assets or generated player models.

Rebuild the shipping files and editable native source from the repository root:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/canyon/author-kit.py
node scripts/canyon/validate-kit.mjs
```

Append `-- --skip-render` to skip the optional studio review PNG. The command
always saves `output/canyon/canyon-kit-v1.blend`, retaining separate editable
primitives and bevel/weighted-normal modifiers in hidden `Editable` collections.
The visible review composition uses independent proxies. The tower and cliff
are shown at half scale only in that review; exported modules retain full scale.
Review/source files remain under ignored `output/canyon/`.

| glTF root | Width × height × depth (m) | Material batches | High / Low triangles |
| --- | --- | --- | --- |
| `anchor-spire` | 2 × 8 × 2 | 4 | 8,580 / 1,412 |
| `buffer-cover` | 1.2 × 2 × 4 | 5 | 3,132 / 660 |
| `beacon-tower` | 3 × 40 × 3 | 6 | 15,228 / 3,036 |
| `canyon-cliff` | 20 × 30 × 12 | 1 | 10,644 / 2,628 |

Both GLBs use exact stable root names, identity transforms, center pivots,
metres, and Y-up coordinates. Child transforms are baked into geometry so the
runtime can instance each material batch directly. The anchor's entire visible
surface fits inside a horizontal radius of 1 m; its center-map instance can
scale to the existing 0.8 m collider. Architecture fits the existing map rather
than changing traversable space, collision, player speed, or map dimensions.

The seven shared PBR roles are `canyon_alloy`, `canyon_graphite`,
`canyon_ceramic`, `canyon_trim`, `canyon_cyan`, `canyon_warm`, and `canyon_rock`.
The exported materials distinguish ceramic paint, dark recesses, and metal
edges. Runtime materials supply the shared texture set and quality selection;
GLBs embed no textures. Planar UVs are authored in metres, leaving physical tile
scale to the runtime. Cyan and warm emissions appear only in small locator
slits and optical lenses, retaining the towers' material response in daylight.

The rock formation combines three interlocking geological masses with broad
strata, broken recessed shelves, diagonal clefts, sloped erosion, and uneven
crowns. Broad rock faces use smooth normals while undercuts stay sharp.
Its geometry adds large-scale depth; normal and roughness maps provide the
fine surface detail. This keeps the floor quieter than the surrounding cliffs.
Low geometry removes small fasteners, louvers, and locking flanges while
retaining recognizable armor panels and reducing geological ring density.

The exporter merges geometry by material and applies modifiers before shipping.
Files use native glTF attributes without adding a runtime decoder dependency.
The complete High kit has 37,584 triangles and 1,485,888 bytes; Low has 7,736
triangles and 381,948 bytes, an approximately 79% triangle reduction. Validation
enforces ceilings of 45,000 triangles / 2 MB and 10,000 triangles / 600 KB
respectively. Runtime instancing repeats the kit without
repeating geometry storage, but draw calls and total rendered triangles still
need measurement in an actual match.

`validate-kit.mjs` independently loads both exported files through Three.js
GLTFLoader. It checks exact root/child transforms, dimensions, centered bounds,
the anchor's collider radius, finite normals/UVs, shared material roles, merged
batch counts, manifest parity, and both quality budgets. Durable results are
`public/assets/canyon/architecture/kit-validation.json`; the export provenance,
palette, and per-module counts live in `kit-v1.manifest.json`.

## Shared surfaces and original rock maps

The playable floor reuses the approved Stadium composite surface with a slightly
warmer tint, keeping its low-contrast color, shallow seams, and broad roughness
variation. Ceramic panels reuse Stadium's approved generated albedo and authored
coating normal/roughness maps; metal surfaces reuse the existing licensed Stadium
library. Attribution and original generation provenance stay with those shared
assets rather than being duplicated into Canyon.

Regenerate the original geological texture pack with:

```powershell
node scripts/canyon/author-surfaces.mjs
```

This writes periodic sedimentary albedo, OpenGL normal, and roughness maps at
1024px, plus a 512px albedo derivative. The 8 m texture tile combines warped
strata, broad mineral variation, and fine grain without baked light. Background
rock carries the strongest surface variation; navigable floor detail stays
restrained. The complete four-image pack is 2,622,743 bytes, of which the Low
color image is 195,440 bytes. `public/assets/canyon/surfaces/manifest.json` records
the generator, provenance, shared asset references, physical tile size, color
spaces, resolution, byte counts, and SHA-256 hashes.

## Runtime quality and validation

High uses the detailed kit and eight background cliff instances. Balanced and
Low use the reduced kit and five cliff instances. High/Balanced load the 1K rock
PBR maps and shared Stadium physical maps; Low uses 512px color and scalar
roughness. Shadow sizes and pixel-ratio caps follow the existing environment
profiles: 2048/1.5, 1024/1.25, and 512/1 for High, Balanced, and Low. The shared
lighting design adds a cool hemisphere fill and a one-time sky/sun probe bake;
the directional sun remains the sole shadow light. The target is 60 FPS on a
desktop gaming GPU, subject to actual resolution, roster, device, and browser.
Asset budgets and offline validation are not a frame-rate measurement.

The runtime instances Blender material batches at the existing map object
transforms, with blue/red/neutral locator variants. Cliffs remain outside the
playable footprint. Gameplay dimensions, collisions, spawns, and speeds are
unchanged; Canyon has no new movement timing requirement. Failed downloads keep
usable procedural architecture or neutral material fallbacks, and teardown
releases the map's owned graphics resources.

```powershell
npm run canyon:validate
npm run test:canyon
```

The focused runtime suite complements GLB validation with placement/collider
contracts, fallback/cancellation behavior, texture ownership and quality tiers,
lighting disposal, and integration coverage. Final visual and performance checks
must use actual in-game V3 Iron Vanguard combatants.
