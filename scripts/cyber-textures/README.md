# Cyber Hex Grid surface library

Regenerate with `node scripts/cyber-textures/author-surfaces.mjs`.

These are original deterministic maps, authored from periodic hexagonal signed distances and coating noise. There is no downloaded imagery, baked lighting, text, or emissive grid. The albedo stays within 222–239/255 before its slate material tint; detail comes from recessed 3.5 mm joints, small rounded lips, submillimetre grain, and broad roughness variation.

- High/Balanced: 1024² albedo, OpenGL normal, roughness (about 1.16 MiB total).
- Low: 512² albedo only (about 53 KiB); flat normal and scalar roughness.
- The periodic cell is 6 × 5.196 m, containing two regular hexagons of 2 m radius. Apply world UVs with a 6 m tile and texture repeat `(1, 2 / sqrt(3))`. Existing scene scaling remains untouched.
- `manifest.json` records dimensions, hashes, provenance, byte counts and albedo statistics. Tests check actual PNG dimensions, hashes, edge continuity, physical relief and contrast budget.

Architecture uses the already approved generated Stadium ceramic albedo and original coating normal/roughness maps with independently owned texture handles. Palette roles are slate alloy, graphite, pale ceramic, machined trim, restrained cyan locator accents and cool core fixtures. Only the last two emit light visually; they add no shadow-casting lights.

The static shader sky has a broad navy/violet horizon and no animated pattern. The PMREM probe is captured once at 256² for High or 128² for Balanced/Low; a hemisphere and unshadowed rim supplement the existing user-controlled directional key. A scene only disposes its own texture handles, reflection target, and explicitly marked sky.
