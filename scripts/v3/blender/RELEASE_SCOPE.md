# Internal V3 animation release

This release publishes the approved 26-clip Blender animation set, rebuilt hammer/katar/skull-bomb assets, native skeleton and armor binding support, and the animation review/authoring tools. It does not migrate live Grifball gameplay to V3. V2 remains the default selectable gameplay model; V3 remains internal.

The release branch is assembled from `main` and the V3 animation dependencies. Earlier AI damage-observation and combat-trade changes on the development branch are excluded, as are local process IDs and test scratch files.

## Validation boundaries

The Blender regression checks cover loop/stage joins, fixed bone lengths, soles, connected arms, wrist/elbow articulation and weapon contacts. The atlas provides visual review. These checks do not establish live gameplay readiness or custom-armor clearance.

The broad regression run found five remaining V3 failures after correcting two outdated test fixtures:

- Two character readiness failures (manifest budgets and reference proportions) reproduce on development commit `9566bce`, before the animation changes.
- Three legacy Mixamo hammer expectations (carry direction in two tests and windup height in one) conflict with the rebuilt hammer's grip/geometry. They remain visible in the full test suite. The approved Blender clip tests validate the new motion separately; legacy gameplay retargeting has not been certified.

No readiness thresholds were relaxed and no failing tests were disabled. The full suite is therefore not green. These issues remain work for the V3 migration, alongside weapon locomotion, real gameplay clocks, ball possession/release, collision-driven transitions, and local/AI/remote/replay integration.

The local V2 smoke test confirmed rendering, weapon selection, sword/jump input and respawn. Codex's in-app browser rejected pointer lock, limiting manual mouse-look testing. This is not a claim that V3 works during live gameplay.
