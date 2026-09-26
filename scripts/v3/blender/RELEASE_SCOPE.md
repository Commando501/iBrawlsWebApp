# V3 gameplay animation release

This release makes Version 3 Preview available in local training with the current 31 Blender-authored animations, rebuilt hammer/katar/pistol/skull-bomb visuals, and native skeleton/armor binding. V2 remains the default for standard matches; tournament and multiplayer setup do not opt into V3.

Gameplay uses elapsed combat timers, distance-based locomotion, slide/lunge recovery, held-ball possession, and first-person weapon playback. Crouch input drives entry, breathing hold, and recovery for every carried item, with crouch-walking, crouched attacks, reversible transitions, and replay posture. Bots and remote/observer render paths share the animation runtime. Existing damage-observation updates on the development branch are included.

The animation atlas, clean editor, Blender authoring scripts, and generated runtime assets are included. Local process IDs, Blender review renders/backups, and temporary test artifacts are excluded.

## Validation

- TypeScript and targeted gameplay, crouch, bot, remote, replay, and first-person animation checks pass.
- Blender clip regression checks cover connected limbs, fixed bone lengths, soles, wrist articulation, and weapon contacts.
- The V3 local-training match boots and renders without browser console errors. In-app browser pointer-lock limitations prevent claiming a complete manual combat playtest.
- Earlier broad V3 audits reported character-readiness and legacy Mixamo/hammer expectations outside the Blender gameplay path. No audit thresholds or failing tests were disabled for this release; a green targeted run is not a claim that the entire repository suite passes.
