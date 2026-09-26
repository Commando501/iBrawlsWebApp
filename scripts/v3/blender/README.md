# V3 Blender workflow

Run commands from the repository root. Blender must be open with the configured MCP add-on connected on its existing port. The bridge launches the installed `mcp-for-blender` server through `uvx`; set `BLENDER_MCP_UVX` to its executable path if it is not on PATH. Nothing is uploaded to an external asset service.

The local review file is `output/blender-repair/ibrawls-animation-repair.blend`. It contains the original runtime armor in a hidden reference collection and a repaired collection with armor rigidly parented to one 56-joint skeleton. Timeline markers identify the 26 clips. Weapon visibility follows the timeline. All output geometry and `.blend` files are local, ignored artifacts.

## Skull-bomb and runner animations

Run `node scripts/v3/blender/run.cjs ball` and `node --import tsx scripts/v3/generate-blender-ball.ts` to rebuild the skull-bomb source and synchronous runtime geometry. The local `v3-skull-bomb.glb` uses Y-up asset coordinates with the face toward +Z; animation transforms rotate it into game space. `node scripts/v3/blender/run.cjs runner` authors carry, walk, sprint, slide, ball jab, and throw. Export with `run.cjs export`, then run `npm run v3:generate-blender-clips -- --clips=clean_ball_carry,clean_slide_ball,clean_ball_walk,clean_ball_sprint,clean_ball_punch,clean_ball_throw`. `run.cjs review-runner` renders the motion stages and an isolated product view. Throw release is frame 45, stored in `extra-clips.json` and propagated into the generated bake. The remaining 20 clips are preserved. The animated review ball shares the same Blender geometry as the exported runtime model.

## Rebuild from the runtime sources

```sh
node scripts/v3/blender/run.cjs weapons
npm run v3:generate-blender-weapons
npm run v3:export-blender-review
node scripts/v3/blender/run.cjs import
node scripts/v3/blender/run.cjs ball
node --import tsx scripts/v3/generate-blender-ball.ts
node scripts/v3/blender/run.cjs author
node scripts/v3/blender/run.cjs export
node scripts/v3/blender/run.cjs review
npm run v3:generate-blender-clips
npm run test:v3-blender
```

`import` creates a separate review scene and preserves other scenes. `author` replaces only the generated repaired collection in that review scene, so save a separate copy before hand-editing its keys. It authors constrained hand/foot targets, solves fixed-length limbs, corrects the visible armor soles to the floor, and rotates the source's +Z forward to the game's -Z forward. Blender rest-bone matrices are measured after creation; 51 armor-binding samples must match the runtime bind before saving.

`weapons` rebuilds the gravity hammer and energy katar from editable bevelled Blender parts, exports local GLBs and mesh data, and preserves other collections. The next command generates synchronous runtime geometry, grouped by paint role. Runtime scales the hammer to 75% and katar to 50% of the rendered character height. Both primary grips are at source origin; the hammer support grip is at `(0, 0.24, 0)` on the haft. Re-export the runtime review/bind before authoring animations after a weapon change. The arm solve keeps elbows near the ribcage and derives hand directions from carry/attack targets. The weapon tests also raycast both sides of each handle to verify physical grip placement.

## Keep manual animation edits

The [September 25 motion review](MOTION_REVIEW.md) records the full 26-clip pass, measurements, and remaining polish work. `node scripts/v3/blender/run.cjs audit-motion` evaluates every authored frame and transition without writing scene keys. `run.cjs review-motion` renders three poses per baked clip. To rebake a small selection without replacing the scene, use `run.cjs refine clean_idle,clean_walk,clean_sprint` (comma-separated IDs), then export and regenerate the clips as usual. Small batches avoid the Blender server's socket timeout. Both free wrists follow their forearms; walk/sprint foot swings ease through lift-off and landing. The throw switches to connected joint rotations after release, and the lunge uses a stable elbow plane during its crouch. Pistol recoil and hit response now distinguish the quick impulse from the longer settle.

For the shared left-arm pass, run `node scripts/v3/blender/run.cjs left-arm`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips`. This rebakes the existing 26 ranges without rebuilding the scene. Use `BLENDER_MCP_TIMEOUT_MS=600000` for the full pass on slower machines. The Blender server also has its own socket timeout: a timeout does not cancel work already executing in Blender. Check the saved scene timestamp and `blender-binding-validation.json` before retrying authoring; once that save completes, export the evaluated scene. `run.cjs review-left-arm` renders close views of the former problem poses. The left elbow uses a torso-relative bend direction, free wrists follow the forearm, and the hammer support hand can adjust its rotation while retaining its contact.

For the runner jab only, run `node scripts/v3/blender/run.cjs punch`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_ball_punch`. It chambers briefly, punches the ball straight forward, retracts, and returns to carry. Select **Runner Ball Punch** in the atlas. The throw and other clips are preserved.

For the runner throw only, run `node scripts/v3/blender/run.cjs throw`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_ball_throw`. The windup uses a deep rear-shoulder pullback, torso coil, rearward weight shift, and a forward-reaching free arm before the overhead release at frame 45. Other clips are preserved.

To update the shared slide recovery across unarmed and all four item holds, run `node scripts/v3/blender/run.cjs slide-recovery`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_slide,clean_slide_hammer,clean_slide_sword,clean_slide_pistol,clean_slide_ball`. The left boot stays planted during weight transfer and the airborne right-foot return; the right then supports a short left-foot adjustment. Hip rise and upper-body settling use staggered timing. Partial authoring preserves existing timeline starts and rejects clip-range overlaps. The expanded 84-frame clips fit inside their original spacing without touching other animations.

For all four slide holds, run `node scripts/v3/blender/run.cjs carries`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_slide_hammer,clean_slide_sword,clean_slide_pistol,clean_slide_ball,clean_ball_carry`. These appended ranges are defined in `extra-clips.json`; the original 17 clips are preserved. Each slide uses the shared 84-frame body motion and returns to its item’s neutral carry. Hammer/pistol retain both hand contacts, the katar keeps its hand-relative orientation, and the ball uses the skull-bomb with one underside contact. `node scripts/v3/blender/run.cjs review-carries` renders all four at seven held, weight-transfer, stepping, and settled poses from two angles.

For the player slide only, run `node scripts/v3/blender/run.cjs slide`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_slide`. The 84-frame clip has a standing entry, held skid (frames 18–48), and a stepping recovery (frames 49–84). Its leading boot is tilted up and grounded at the heel; the other leg stays tucked. The atlas adds 0.95 units of decelerating preview travel, while the exported root remains in place. `node scripts/v3/blender/run.cjs review-slide` renders seven stages of the recovery from two angles. All other clips are preserved.

For the upward hammer pommel strike, run `node scripts/v3/blender/run.cjs melee`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_hammer_melee,clean_hammer_melee_recover`. These two clips connect to the existing hammer carry, maintain both physical handle contacts and the primary hand-to-hammer orientation; the left support hand adjusts to avoid an overbent wrist, and leave the overhand swing unchanged. `node scripts/v3/blender/run.cjs review-melee` renders the neutral, load, rising strike, impact, return, and settled poses from two angles. **Play Hammer Melee** previews the connected sequence in the atlas.

For the katar lunge only, run `node scripts/v3/blender/run.cjs lunge`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_sword_lunge`. The clip lowers into a grounded split stance, holds an extended thrust during frames 11–33, cuts horizontally at the authored contact point (frame 33), and returns to carry after frame 48. The root remains in place so future gameplay owns forward travel; the atlas adds 0.85 units of preview travel that stops at frame 33. Contact timing is currently authored for the internal atlas. `node scripts/v3/blender/run.cjs review-lunge` renders six stages from two angles. All other clips are preserved.

For the katar slash and recovery only, run `node scripts/v3/blender/run.cjs sword`, `node scripts/v3/blender/run.cjs export`, and `npm run v3:generate-blender-clips -- --clips=clean_sword_slash,clean_sword_recover`. The slash follows a diagonal circular cut with the cutting edge tangent to the motion and a fixed hand-to-weapon orientation. `node scripts/v3/blender/run.cjs review-sword` renders the actual blade-tip trajectory from two angles. Select **Sword Slash** in the atlas and use **Katar Blade Path** to compare the baked tip with its path while scrubbing.

For the overhand hammer swing only, run `node scripts/v3/blender/run.cjs hammer`, then `node scripts/v3/blender/run.cjs export`, then `npm run v3:generate-blender-clips -- --clips=clean_hammer_windup,clean_hammer_strike,clean_hammer_recover`. This edits the existing windup/strike/recovery key ranges and preserves all other Blender keys and generated clips. `node scripts/v3/blender/run.cjs review-hammer` renders six swing stages from two angles. In the atlas, **Play Hammer Swing** plays the two-hand neutral hold, lift behind the right shoulder, overhand strike, and return as a connected sequence.

Open the saved review file, edit the unified skeleton or the `Repaired weapon_*` transforms, and save it. Then run only `run.cjs export`, `v3:generate-blender-clips`, and `test:v3-blender`. Export reads the actual evaluated Blender bones and weapon transforms, including edited keys. Keep the clip ranges in `repair-timeline.json` and avoid animated bone scales. Do not rerun `author` to export hand-edited motion.

The generated TypeScript artifact contains compact position and quaternion tracks at 60 FPS; constant tracks are collapsed and quaternion signs are made continuous. It includes secondary grip coordinates for two-handed clips. Runtime interpolation uses quaternion slerp. The clean editor's older JSON format is a separate manual override format and cannot import this bake directly.

## Review

Start `npm run dev` and open `/v3-animation-atlas-smoke.html`. Clear any manual preview to see the Blender source. Review all angles, motion endpoints, and attacks; For Slide, Carry selects the hammer, sword, pistol, or ball slide variant; Hidden selects the unarmed slide. Ball selects runner locomotion on walk/sprint; the other items still select their standing carry references on those cases. The generated regression checks validate every baked frame, native limb lengths, grounded support soles, primary and secondary grips, and loop endpoints. They do not replace visual inspection of custom armor or certify full-body surface collision freedom. First-person poses and procedural death effects use their existing animation paths.
