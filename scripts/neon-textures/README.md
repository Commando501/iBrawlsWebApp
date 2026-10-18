# Neon Outrun Grid surfaces and light

Run `node scripts/neon-textures/author-surfaces.mjs` to reproduce the four shipped PNGs and their SHA-256 manifest. The dependency-free authoring script creates original periodic maps without source imagery, baked shadows, displacement or downloads.

A 6 m tile contains quiet 3 m composite floor panels. Their 18 mm joints are recessed by 2.2 mm in the normal map only; coating grain and broad roughness variation provide detail without changing floor geometry or movement. Albedo contrast is deliberately restrained: luminance standard deviation is 0.99/255, with no glowing floor grid. Ceramic, slate alloy and graphite architecture reuse the established Stadium coating, while small cyan/pink perimeter accents and neutral city windows carry restrained emission.

High and Balanced use 1024 px sRGB albedo, OpenGL (+Y) tangent normals and linear roughness. Low uses the averaged 512 px albedo with scalar roughness. The original maps total 1,269,171 bytes (approximately 1.21 MiB). The manifest records the physical scale, luminance statistics, dimensions, sizes and hashes. Tests check periodic edges, shallow physical relief, file budgets and low floor contrast.

Image sources are shared but each scene owns its texture handles. The loading gate covers both the original floor and shared Stadium coating. Missing or stalled requests settle to neutral one-pixel fallbacks within eight seconds, and late callbacks cannot resize those terminal fallbacks. Tests cover source reuse, surviving scenes, early disposal and late responses.

The static shader sky preserves the map's striped sunset identity with a warm disc, muted peach horizon and cool blue upper sky. It requires no image download, animation or postprocessing pass. A warm neutral key and two unshadowed fill lights keep the actual V3 armor readable. The existing directional key remains the sole shadow light and fits the current rectangular half-extents without changing the user's light intensity. A static reflection probe bakes once at 256 px on High or 128 px on Balanced/Low, with explicit ownership and cleanup of temporary resources, the probe target and the marked sky.
