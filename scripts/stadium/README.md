# Championship Stadium Blender kit

The shipped architectural modules are authored from reproducible Blender meshes,
with applied bevels, metre-scaled surface UVs, and geometry merged by material.
They complement the actual V3 Iron Vanguard at game scale. No generated player
geometry or third-party game models are included.

Generate both quality tiers and the editable `.blend` source from the repository
root, using an installed Blender 5.x binary:

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python scripts/stadium/author-kit.py
node scripts/stadium/validate-kit.mjs
```

Append `-- --skip-render` to the Blender command to skip the optional studio
review PNG. The command always saves the native editable source. Generated
review/source files live under ignored `output/stadium/`; shipping files live
under `public/assets/stadium/architecture/`.

| glTF root | Dimensions (width × height × depth, m) | Pivot | High / low triangles |
| --- | --- | --- | --- |
| `barrier-panel` | 8 × 3.2 × 0.7 | Bottom center | 2,264 / 624 |
| `support-pylon` | 2 × 16 × 2.5 | Bottom center | 5,892 / 1,548 |
| `light-fixture` | 6 × 1.2 × 1 | Center | 2,880 / 708 |
| `vent-module` | 3 × 2 × 0.5 | Center | 1,004 / 444 |

Both `kit-v1.glb` and `kit-low-v1.glb` use the same hierarchy, Y-up orientation,
and front facing +Z. Root transforms are identity. Child meshes have their
transforms baked into geometry, allowing material-specific instancing without
per-instance child transforms. Each module uses three or four material batches.

The six shared PBR materials are `stadium_alloy`, `stadium_graphite`,
`stadium_ceramic`, `stadium_trim`, `stadium_cyan`, and `stadium_warm`.
Painted panels, bare edges, ceramic shields, and luminous optics have distinct
metallic/roughness responses. Exported UVs use one repeat per metre; runtime
geometry normalizes them to the shared 3 m coating scale. The native source
retains editable primitives and bevel modifiers in
the two hidden `Editable` collections; the visible review uses separate proxies.

High quality has 12,040 triangles and is approximately 845 KiB. The lower tier
has 3,324 triangles and is approximately 245 KiB, removing small fasteners and
secondary details while retaining the same silhouette and lighting materials.
Files use native glTF attributes without a new runtime compression dependency.
No texture payloads are embedded: the game owns shared surface textures and
quality settings. Architectural modules are decorative; gameplay collision
continues to come from the map geometry. Runtime instanced kickplates, trim,
service panels, and team accents enrich the perimeter without adding obstacles
to the court. They add five draws / 7,488 triangles on High/Balanced and three
draws / 2,304 triangles on Low. Low retains the caps, kickplates, and team bands
while omitting service cassettes, louvers, and thin joints. All wall details stay
more than 0.8 m outside the court, at or below 3.2 m high, preserving the 12 m
goal gaps. They add no shadow casters. Broad strip lights are baked once into the environment probe for
directional material highlights rather than adding shadow-casting lights.

## Surface authoring

The approved generated ceramic albedo remains in `public/assets/stadium/ceramic/`,
with its generation prompt and provenance in `provenance.json`. Existing licensed
metal/concrete sources retain their attribution in
`public/assets/stadium/source-manifest.json`. The refinement adds original,
deterministically authored normal/roughness maps for the ceramic coating and
a quiet composite playing surface:

```powershell
node scripts/stadium-textures/author-surfaces.mjs
```

This writes six PNGs and `public/assets/stadium/surfaces/manifest.json`, recording
provenance, physical tile sizes, color spaces, dimensions, byte counts, and hashes.
High/Balanced use 1024px floor albedo, OpenGL normal, and roughness maps, plus
1024px ceramic coating normal/roughness. Low loads only the 512px floor color
derivative and uses scalar roughness. The complete new pack is approximately
2.5 MB; the Low floor image is approximately 59 KB. No textures are synthesized
per frame and the material changes add no draw calls.

The floor tile covers 6 m, forming 3 × 6 m panels with narrow rounded expansion
joints. Its neutral albedo has approximately 1.27/255 standard deviation; shallow
grain and broad roughness variation supply close-range surface depth without
high-contrast floor clutter. Ceramic coating data is authored at a 3 m tile
scale. Runtime material tint supplies the slate floor color. Color images use
sRGB and physical data uses linear/no color space. Existing packaging remains
available through Blender's `scripts/stadium-textures/pack.py`.

## Court dimensions and playback compatibility

Layout revision 2 measures 123 m along X (length) and 66.16 m along Z (width).
Subtracting the two 0.6 m player-center boundary insets leaves 121.8 m and
64.96 m of center travel. At 8.12 m/s, these correspond to 15 seconds lengthwise
and 8 seconds widthwise. Measure with sprint enabled, forward speed 100%,
sprint speed 140%, and forward+sprint held while facing along the measured
axis; exclude ball carrying, jumps, slides, and dashes. The movement code applies
sprint velocity immediately. Global settings defaults remain unchanged, and
custom speeds change travel time without changing authored map dimensions.

Goals, team lighting, and spawn positions follow the enlarged bounds. New
recordings carry revision 2; unversioned/older Stadium recordings resolve the
original 104 × 46 m revision 1 layout for playback, previews, and heatmaps.
The first-pass 125 FPS High / 131 FPS Low RTX 4090 results in
`qa-report-2026-10-16.json` predate this refinement and larger court. Updated
refinement samples averaged 126 FPS High / 124 FPS Low at 1080p, both with
13.9 ms p95 frame intervals. Independent AI matches are not a controlled tier
comparison. Live keyboard traversal reached both boundaries in 7.99 s / 15.00 s.
See `qa-refinement-2026-10-16.json` for methods, counters, tests, and limitations.
High beams now fade at their silhouettes and above the floor to avoid hard
triangular overlays. All online participants must use the updated build, since
premade-map networking synchronizes by map ID rather than geometry revision.

## Validation

`validate-kit.mjs` independently loads each GLB through the game's Three.js
loader, verifies exact root names, dimensions, pivots, UVs/normals, material
batches, triangle and binary budgets, and the lower-tier reduction. Its durable
output is `kit-validation.json`; authoring metadata is `kit-v1.manifest.json`.
The custom pivot metadata key is `pivotMode` because Three.js reserves `pivot`
for a numeric transform extension.

`npm run test:stadium` also checks material ownership/loading fallbacks and
shipped surface resolution, download budgets, restrained floor contrast, and
shallow physical relief. Visual and performance review must still use the
actual game and V3 Iron Vanguard combatants.
