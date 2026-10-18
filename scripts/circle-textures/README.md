# Circle Arena surfaces and light

Run `node scripts/circle-textures/author-surfaces.mjs` to reproduce the four shipped PNGs and SHA-256 manifest. The dependency-free generator authors original periodic material maps without downloaded imagery.

The 6 m ceramic tile combines broad structural panels with fine coating grain. Most surface variation lives in tangent normals and roughness; the albedo stays quiet enough to read player movement. Authored luminance standard deviation is 0.815/255 and its total range is 6.52/255. The medium slate floor has no bright grid, painted damage, loose debris, displacement, baked lighting or reflection capture pass. Its surface changes do not change movement or collision geometry.

High and Balanced use 1024 px sRGB albedo, OpenGL (+Y) tangent normals and linear roughness. Low uses averaged 512 px albedo and scalar roughness. The four maps total 1,396,326 bytes (approximately 1.33 MiB). The manifest records physical scale, dimensions, luminance statistics, sizes and hashes. Automated checks decode the actual PNGs to verify quiet albedo, periodic boundaries, shallow physical relief and download budgets.

Architecture reuses the established Stadium V3 ceramic coating through independently owned texture handles. Ceramic, alloy, graphite and dark backing remain non-emissive. Cyan insets use emission 0.55; white light inserts use 0.8. All six roles are opaque and protect their authored emission from global map glow changes. There is no transmission pass or transparent environment shell.

Image sources are shared while each material owns its texture handles. The loading gate covers both new floor maps and Stadium coatings. Failed or stalled downloads settle to neutral one-pixel fallbacks within eight seconds. Late callbacks cannot resize terminal fallback storage. Tests cover source reuse, surviving sibling scenes, early disposal and stale downloads.

The static shader sky uses a restrained blue-gray facility horizon and broad haze. Original Circle controls remain hue 224 and brightness 4, with brightness 4 mapped to exposure 1. Hue updates modify existing uniforms; brightness is finite and bounded from 0 to 20. The sky needs no texture, time uniform, extra render pass or postprocessing.

A neutral-white key and two unshadowed fill lights separate actual V3 armor from the floor and remote architecture. The existing key remains the only shadow pass and retains the user's intensity. Its shadow camera fits the current radius or rectangular half-extents. A static reflection probe bakes once at 256 px on High or 128 px on Balanced/Low. Probe scratch geometry, owned render targets and explicitly marked skies are released without touching another map's resources. Runtime visual and frame-time measurements belong to the map integration QA report.
