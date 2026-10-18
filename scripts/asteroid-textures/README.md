# Vanguard Asteroid Mine surfaces

Run `node scripts/asteroid-textures/author-surfaces.mjs` to regenerate the eight shipped maps and their SHA-256 manifest. The dependency-free script produces original periodic materials without downloads, baked lighting, or displacement.

The 6 m compacted regolith floor stays charcoal and quiet: broad albedo variation has a standard deviation below 3/255, while shallow normals and roughness supply surface detail. The 3 m asteroid-rock family has stronger fracture relief, pores, and grain for cover and distant crags. Ore uses the same rock maps with a darker, slightly metallic finish. The industrial ceramic, alloy, graphite, and hazard trim reuse the approved Stadium coating. Only small amber service-light surfaces emit.

High and Balanced use 1024 px sRGB albedo, OpenGL (+Y) tangent normals, and linear roughness. Low uses 512 px averaged albedo and scalar roughness. The original maps total approximately 3.81 MiB; the Stadium coating is shared with other upgraded arenas. Texture handles are owned by each scene while image sources are shared. Loading settles within eight seconds with neutral terminal fallbacks; late downloads cannot resize an uploaded fallback.

The manifest records physical tile scale, pixel dimensions, byte sizes, hashes, and luminance statistics. Tests verify periodic edges, normal relief, floor readability, quality tiers, asynchronous loading, and disposal ownership. The procedural sky adds sparse static stars and a subdued planetoid without an image download, animation, extra mesh, or postprocessing pass. Warm industrial key lighting and a cool fill preserve the V3 armor colors; one static reflection probe is baked at 256 px on High or 128 px on Balanced/Low.
