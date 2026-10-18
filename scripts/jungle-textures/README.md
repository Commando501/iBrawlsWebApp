# Jungle Ruined Outpost surfaces

Run `node scripts/jungle-textures/author-surfaces.mjs` to recreate the shipped maps and their SHA-256 manifest. This dependency-free authoring script creates original periodic material data, without downloaded imagery, baked light, or geometry displacement.

The compact earth/stone floor uses a 6 m tile with broad, subtle moss coloring. Its micrograin is carried by normal and roughness maps so combat silhouettes remain readable. Weathered stone and bark use 3 m tiles, each with distinct physical relief. Stone also supplies moss and opaque leaf surface microdetail. The relic's metal and ceramic pieces reuse the approved Stadium coating library.

High and Balanced use 1024 px albedo, OpenGL (+Y) tangent normals, and linear roughness. Low uses only a 512 px averaged albedo and scalar roughness. Runtime texture handles are independently disposable while source images are shared; loading gates settle in at most 8 seconds with neutral terminal fallbacks. Late downloads cannot resize a fallback's GPU storage.

The manifest records resolution, byte size, hashes, physical tile scale, and luminance statistics. Material tests check those assets, physical-normal relief, low floor contrast, periodic edges, quality budgets, and resource lifetime.
