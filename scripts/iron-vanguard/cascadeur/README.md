# Iron Vanguard Cascadeur workflow

Current working scene: `output/iron-vanguard/iron-vanguard-hammer-v018-shoulder-corrective.casc` (2026-10-13).
The Blender canonical master and approved idle actions are unchanged.

## Current milestone

v018 reduces the shoulder/armpit collapse reported at frame 39 with localized, clip-specific
corrective blend shapes. It preserves the v017 skeleton, hammer path, hand poses and constraints.
The original v017 scene and canonical Blender master remain unchanged. Some cloth and armor folds
remain; the user accepted this result and its timing for this iteration. Contact polish and production optimization remain.

The correction blends 85% of a volume-preserving shoulder deformation into the original surface,
then bakes it against conditioned shoulder weights. Seventy `ShoulderFrame_00` through
`ShoulderFrame_69` shapes play on the separate `Shoulder_Correctives` track. Each integer frame
uses one complete correction; frame 70 reuses frame 0. Overlapping PCA components were rejected
because they produced native viewport shading artifacts. The final mesh uses smooth per-vertex
normals and replaces the old body only in v018. The 61-joint hierarchy and hammer mesh are retained.

All 71 frames pass joint/control preservation and six-hand-constraint checks; control movement
is below 0.005 mm from numerical evaluation, with rotation-matrix differences below 0.00004 after reopening.
The corrective values are checked against the source on every frame. The Blender construction
matches its target surface within 0.17 mm. The final native FBX export also matches within
0.17 mm, with up to 0.47 mm of round-trip drift outside the corrected region and a loop closure
error below 0.002 mm. Reopening confirms all 70 shape channels and their 71-frame values persist.

**Editing limitation:** the corrective shapes are baked for this exact swing. Keep their track
with the animation and rebuild them after changing poses or the alignment of tracks. Runtime speed changes are safe when all tracks share the same source clock. This is not a
reusable weight-paint repair and is not optimized for game delivery. Existing wrist/cuff and
forearm contact issues remain review work. The scene is saved paused at frame 39 for comparison.

Work files in `output/iron-vanguard/cascadeur-attack-work/`:
- `v018-shoulder-corrective.blend`: isolated editable Blender review file.
- `v018-shoulder-corrective-model-final.fbx`: replacement mesh with its 61-joint bind hierarchy.
- `v018-native-shape-values.npz`: the final 71-frame shape-value table.
- `v018-native-animation-validation.json` and `v018-reload-validation.json`: native control/rotation/constraint checks before and after reopening.
- `v018-final-review.fbx` and `v018-final-mesh-validation.json`: final export and mesh check.

Construction uses `build-shoulder-corrective-final.py`, `build-shoulder-corrective-blender.py`,
`build-shoulder-frame-shapes.py`, `import-final-frame-shapes-native.py`, and
`save-final-shoulder-native.py`. These are baseline-specific work scripts, not general rig tools;
do not replay them indiscriminately against an edited scene.

### v018 timing and impact review

The user accepted the shoulder result for this iteration. A read-only review of the saved v018
export retains its timing: wind-up 0-24 (0.80 s), strike 24-34 (0.33 s), follow-through 34-42
(0.27 s), recovery 42-70 (0.93 s), for a 2.33 s cycle at 30 fps. Hammer-tip segment speed peaks
at 10.13 m/s into frame 34 and drops 85.8% on the next segment. Frame 34 is the existing implied
impact pose; no target collision or gameplay impact has been verified. These are animation
measurements, not a physical impact simulation. The review makes no pose or timing changes.

Preview and measurements in `cascadeur-attack-work/`: `v018-timing-preview.mp4`,
`v018-timing-preview.gif`, `v018-timing-contact-sheet.png`, and `v018-timing-impact-review.json`.
The loop video omits the duplicate endpoint at frame 70. `review-v018-timing-impact.py` and
`package-v018-timing-review.py` create this isolated review from the saved native FBX export.

### Local browser swing test

Run `npm run dev` and open <http://localhost:3000/iron-vanguard-swing-test.html>.
This development-only Three.js page previews the accepted v018 native export with neutral materials.
**Saved timing** is selected on load: the user's accepted 0.30 s wind-up, 0.20 s strike,
0.10 s follow-through, and 1.00 s recovery (1.60 s total; impact at 0.50 s). These values
are stored in SAVED_SWING_TIMING and can be restored with the **Saved timing** button.
**Authored** uses the 2.33-second cycle. **Game defaults** uses the shared hammer timing resolver
(0.28-second wind-up, 0.12-second strike) and a 0.60-second follow-through/recovery interval,
for a 1.00-second cycle. These are preset defaults, not a connection to a running match's settings.
The four phase durations can be adjusted independently; bones, hammer and corrective shapes all
sample one clip clock. Playback, pause/resume, reset, looping, scrubbing and three camera views
are available. The amber marker is the hammer-tip joint's authored frame-34 position; its flash
is a visual cue and does not test hit volumes, collision, networking or gameplay damage.

The 25,838,124-byte Meshopt GLB retains both meshes, all 61 joints, one synchronized animation,
and 70 corrective shapes. No geometry simplification was applied. It remains a full-detail test
asset with substantial decoded geometry/morph memory, not a multiplayer-roster delivery asset.
`server.ts` serves it from `output/iron-vanguard/runtime-v018/` only in development; neither this
HTML entry nor the review GLB is included in the production build.

Rebuild from the saved native export (repository root, PowerShell; substitute Blender's path):

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/export_runtime_review.py
npx --yes @gltf-transform/cli@4.5.1 optimize output/iron-vanguard/runtime-v018/iron-vanguard-hammer-v018.raw.glb output/iron-vanguard/runtime-v018/iron-vanguard-hammer-v018.clean.glb --compress false --simplify false --weld false --join false --flatten false --instance false --palette false --texture-compress false --prune-attributes false --sparse false
npx --yes @gltf-transform/cli@4.5.1 meshopt output/iron-vanguard/runtime-v018/iron-vanguard-hammer-v018.clean.glb output/iron-vanguard/runtime-v018/hammer-v018-review.glb --level medium --quantize-position 16 --quantize-normal 16 --quantize-weight 16
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/capture_runtime_reference.py
node scripts/iron-vanguard/validate_runtime_review.mjs
node --import tsx --test src/tools/ironVanguardSwingTiming.test.ts
```

Verification on 2026-10-13:
- All 71 frames compared in Three.js against an independent native-FBX reference: maximum joint
  drift 0.390 mm; maximum morph-weight error 0.00000334.
- 510 deterministic body/shoulder surface samples over all 71 frames: maximum difference
  0.463 mm, RMS 0.066 mm. The source uses at most four vertex influences, so export drops no weights.
- glTF validation: no errors; two skinned-mesh hierarchy warnings. The validator cannot decode
  Meshopt, so the actual Three.js decoder and posed-surface checks above establish runtime fidelity.
- Browser checks pass for key poses, endpoint-to-start replay, pause/resume, loop impact counts,
  game timing, a custom 0.08-second strike, and mobile width (390 px). No browser console errors.
- Three timing tests and focused TypeScript checks pass. The full repository `npm run lint`
  exceeded Node's default heap limit; a full-repository typecheck result is unavailable.

Reports: `runtime-v018/export-manifest.json`, `runtime-v018/three-runtime-validation.json`.
Browser screenshots: `output/playwright/iron-vanguard/` (ready, frames 24/34/39, mobile).
The live roster, approved idle loops, Blender master, and native Cascadeur scene are unchanged.

### v017 arm untwist

v017 corrects the extra full turn of the left upper arm and forearm reported during v016
playback. The recovery elbow path accumulated +185.26 degrees from frames 42-70; v017 uses
the equivalent -174.74-degree return. Only the left elbow and its additional direction point
are retargeted on frames 43-69. The five key poses, accepted strike at 34, hammer motion,
hand poses and other body controls are retained. v016 is preserved as a separate scene.

Validation checks accumulated elbow rotation as well as consecutive-frame changes. It measures
360.00023 degrees less accumulated turn, and an independent continuous-quaternion loop check
confirms that both left-arm bones no longer contain the extra revolution. This addresses the
v016 validation gap: a gradual full turn can pass a per-frame angular-step threshold.
Hammer control differences are below 0.00044 mm; hand/control differences are below 0.016 mm,
including small evaluation differences on unedited frames. Arm-length changes are below
0.00021 mm; all six grip constraints remain enabled and loop closure is within 0.001 mm.

Reports: `cascadeur-attack-work/v017-plan.json`, `v017-validation.json`,
`v017-rotation-winding-check.json`, and `v017-mesh-check.json`. Review export: `v017-review.fbx`.
Construction: `plan-left-arm-untwist.py`, `prepare-left-arm-untwist.py`,
`apply-left-arm-untwist-batch.py`, and `validate-left-arm-untwist.py`; replay only against their
captured baselines. The scene remains 0-70 at 30 fps with sampled FIXED interpolation, saved
paused at 0. Existing wrist/cuff and right-arm contact cleanup remains unfinished, and the
artist must review the corrected motion before any production approval or game integration.

### v016 contact transitions

v016 blends the artist's v015 corrections into the existing 0-70 swing at 30 fps. The v015
scene is preserved. Frame 0 has the successful 1.56 cm forward hammer move; the right elbow
was nudged outward at 24 and 42. The six hand constraints remain enabled, and the temporary
hammer pins used for frame 42 have been released.

The reconstruction retains the existing swing arc and timing, applies smooth corrections to
body/weapon orientations and elbow bend directions, and rewrites 66 intermediate samples plus
frame 70. Frames 0, 24, 34 and 42 are preserved within 0.018 mm. Frame 70 matches the revised
frame 0 within 0.0011 mm. A smooth recovery-path pull of at most 0.639 cm avoids an almost straight
left elbow; maximum shoulder-to-wrist reach is 98.5% of the combined arm length. All intervals
still use sampled FIXED interpolation: future endpoint edits require rebuilding interior samples.

All 71 frames pass target, hand-constraint, loop and continuity checks. Maximum target error is
0.028 mm, maximum adjacent arm rotation is 41.97 degrees (slightly below the existing fast strike),
and foot positions change by at most 0.0062 mm. Small hand offsets introduced by the manual edits
are retained and blended: maximum grip-point variation relative to frame 0 is 3.575 mm, with a
maximum adjacent-frame change of 0.659 mm. This is not the earlier constant-grip result in v014.

An isolated Blender FBX check finds no hammer intersection with the tested torso, head, shoulder
and leg regions on all 71 integer frames. Forearm spot checks still find right forearm/torso contact
at 0, 24, 42, 56, 57, 63 and 70, and left cuff/hammer contact at 0, 24, 63 and 70. Frame 34 passes
these sampled forearm checks. Counts describe triangle overlaps, not penetration depth; hands,
finger deformation, swept collisions and final motion quality remain review work. These small
manual pose changes have not completed the contact/deformation cleanup.

Preview: `cascadeur-attack-work/v016-contact-transitions-preview.gif`; key views:
`v016-transition-contact-sheet.png`. Reports: `v016-before.json`, `v016-plan.json`,
`v016-validation.json`, and `v016-mesh-check.json`. Review export: `v016-review.fbx`.
Construction: `plan-contact-transitions.py`, `apply-contact-transitions-batch.py`, and
`validate-contact-transitions.py`; only replay against their captured baseline. The new scene is
saved paused at frame 0, with playback 0-70, ready for artist playback review. No game integration
or canonical-rig retargeting was performed.

### Manual control checks in v015

The manual hammer-follow retry passed: both wrists followed the 1.56 cm forward hammer move
with grip error below 0.001 mm. The earlier blocked drag was caused by five hand/elbow Fixation
pins, documented in `v015-unpin-report.json` together with its backup. Controller pins are
independent of timeline FIXED interpolation. The right-elbow nudge at 24 also tilted the hammer
about 3.58 degrees while retaining the grips; the nudge at 42 used temporary hammer pins, kept the
hammer stationary, and introduced hand-point offsets up to 3.6 mm. Both manual poses are saved
in v015 and retained in v016. v015 recovery and intermediate samples were not rebuilt until v016.

### Timing baseline in v014

v014 retimes the strike and follow-through while preserving poses 0, 24, 34, 42, and 70,
plus the existing lead-in and recovery. Only intermediate frames 25-33 and 35-41 are rewritten.
Hammer-tip travel now accelerates into frame 34 instead of easing to a near stop before it;
follow-through starts moving promptly and then decelerates. This treats frame 34 as a hit against
an implied target. A missed swing would need a different deceleration profile.

The planner resamples v013 by hammer-tip path length, with power 1.8 for strike progression and
quadratic ease-out for follow-through. Local weapon/grip transforms and arm lengths are retained;
elbows are solved between neighboring source poses. The scene remains 0-70 at 30 fps, saved paused
at 0. All intervals remain sampled FIXED; endpoint edits do not regenerate their interior samples.

Measured head speed increases from 0.93 to 10.14 m/s through the downswing, then settles from
1.44 to 0.10 m/s during follow-through. These are animation measurements, not a physics validation.
All 71 frames pass attachment checks (maximum drift 0.062 mm); the largest sampled arm rotation
step is 42.03 degrees. Unchanged-frame point differences stay below 0.009 mm. All 19 strike/follow-through
frames pass the tested torso/head/shoulder/leg mesh-clearance check; unchanged frames retain v013's
checks. Hands/arms, between-frame swept collisions, deformation, perceived weight, and final motion
quality remain review work. No production approval or canonical-rig retarget is implied.

Preview: `cascadeur-attack-work/timing-preview.gif` (approximately real-time); critical frames:
`timing-strike-contact.png`. Reports: `timing-plan.json`, `timing-validation.json`,
`timing-final-mesh-check.json`, and `timing-save-result.json`. Export: `timing-review.fbx`.
Recovery: v013 and `before-timing-session.casc`. Construction: `plan-timing.py`,
`timing_pose_math.py`, and `apply-timing.py`. Only replay against their captured baseline.
The canonical Blender master and approved idle loops are unchanged.

### Contact review after v014

An isolated review of `timing-review.fbx` checks all 71 integer frames with separate arm, hand,
and finger regions (vertex-weight threshold 0.75). Left forearm-weighted mesh intersects the hammer
on 0-29 and 59-70. Right forearm/torso intersections occur in ready, wind-up, follow-through and
recovery; exact frames are recorded in `v014-arm-contact-summary.json`. Close-ups show wrist
pinching during recovery and small finger protrusions; their skinning/topology causes are not yet
established. Hand/finger intersections at a grip need visual depth review, rather than a blanket
zero-intersection requirement. This is a surface test, not a penetration-depth or swept-volume test.

An isolated elbow-swivel probe preserves the hand transforms. Right-arm changes clear the sampled
arm/torso intersections at 42, 56 and 63, but tested swivels do not resolve all ready/wind-up contacts
or left cuff/weapon intersections. Do not apply the probe angles blindly: the combined-arm regions
include mixed-weight triangles and live Cascadeur propagation has not been validated.

The animation and Blender canonical master remain unchanged. Next cleanup must coordinate the
ready/wind-up hand, weapon and arm placement, retain the accepted strike at 34, and inspect wrist
and finger deformation. Review artifacts: `v014-contact-review.json`, `v014-contact-review.png`,
`v014-arm-contact-audit.json`, `v014-arm-contact-summary.json`, and
`v014-elbow-clearance-probe.json` in `cascadeur-attack-work/`.

### Earlier full-motion pass


v013 adds ready-to-wind-up motion on 0-24 and recovery on 42-70. The existing v012 swing
samples (24-42) are preserved within 0.039 mm. The ready pose keeps its weapon placement and
body pose, but the arms now use the accepted strike grip, preventing sliding into and out of the
swing. Both ends use the same revised ready pose. Earlier versions preserve the previous holds.

Lead-in and recovery use interpolated torso orientations with explicit arm/knee solves to keep
segment lengths consistent. The recovery arc adds a smooth temporary offset peaking at native
[+5, +5, -5] cm, chosen against the exported meshes to clear the right thigh. All four intervals
use sampled FIXED interpolation: editing an endpoint alone does not regenerate the motion.
The scene is saved paused at frame 0 with playback and visible timeline both set to 0-70.

Validation covers all 71 frames: all six hand constraints remain enabled; maximum measured grip
point drift is 0.053 mm; ready endpoint point mismatch is below 0.0003 mm. Maximum sampled arm
rotation step is 31.89 degrees within the retained strike. Foot points differ by up to 3.81 mm
from the previous held samples. The target-plan segment-length range is below 0.027 mm.
Tested torso/head/shoulder/leg triangles have zero hammer intersections. This combines the full
initial pass for unchanged frames with a repeat of all modified recovery frames (43-69).
Arm/hand mesh contact, final deformation, timing, and perceived weight remain review work.
This is a complete motion draft, not a production-approved animation or verified Blender retarget.

Preview: `cascadeur-attack-work/full-motion-preview.gif`; native capture contact sheet:
`full-motion-contact.png`. Reports in that folder: `full-motion-validation.json`,
`full-motion-final-mesh-check.json` (with source report per frame), `full-motion-plan-audit.json`,
`full-motion-save-result.json`. Final export: `full-motion-review.fbx`. Recovery checkpoint:
`before-full-motion-session.casc`. The final construction uses `plan-full-motion.py`,
`apply-full-motion.py`, and the recovery-only `apply-recovery-clearance.py`; intermediate
native interpolation and recovery arc experiments were rejected. Inspect script preconditions
before replaying them on artist-edited work. The Blender master and approved idle loops are unchanged.

A bridge request timed out while the application window was minimized; its queued mutation completed
later. The result file was checked before further edits. Never assume a timeout means no change.

### Earlier wind-up-to-strike pass

v012 adds a controlled wind-up-to-strike transition on frames 24-34 and preserves the v011
34-42 samples within 0.0042 mm. The frame-24 hammer-head rotation is retained; its origin moves
4.61 cm and both arms are refitted to the accepted frame-34 grip. The middle of the swing moves
forward to clear the abdomen and hip. Elbow bend directions are transported continuously along
the arm reach direction to avoid the flips found in automatic interpolation.

Both 24-34 and 34-42 use FIXED interpolation with explicit per-frame poses. This preserves the
reviewed follow-through against tangent changes from neighboring intervals. Changing pose endpoints
alone will not regenerate these sampled intervals; revise/bake the interval deliberately. v011 remains
available with its original 34-42 interpolation. Lead-in 0-24 and recovery 42-70 are still held poses.

All six hand constraints remain enabled across 24-42. Maximum grip drift is 0.0113 mm; the largest
sampled arm rotation step is 31.89 degrees. All 19 frames pass the isolated Blender hammer-to-body
check for torso, head, shoulder, and leg regions; arms/hands are excluded. Feet differ by up to 8.66 mm
from the previous held wind-up samples; foot planting and motion quality still require review.
Frame 0, accepted strike 34, follow-through 42, and ready 70 are preserved to numerical tolerance.

Saved scene: v012, paused at 24; playback bounds 24-42. Native viewport review includes frames
24, 29, 30, 34, and 42. Preview: `cascadeur-attack-work/windup-preview.gif`. Reports:
`windup-{validation,mesh-check,save-result}.json`; exported review: `windup-review.fbx` in that folder.
Recovery: `cascadeur-attack-work/before-windup-session.casc`. Current construction scripts are
`plan-controlled-windup.py` and `apply-controlled-windup.py`; the earlier automatic interpolation
experiment is rejected. Do not rerun these scripts against an arbitrary artist-edited scene.
Next: review this swing, then author lead-in/recovery, timing, and contact/deformation polish.

### Earlier grip-continuity pass

v011 fixes grip continuity over frames 34-42 using the user-accepted frame-34 hand positions and
orientations relative to the hammer. Frame 42 now uses a revised hammer angle (40% of the way from
the original frame-34 rotation to the original frame-42 rotation), a +5 cm native Z translation,
and refitted elbows. Elbow positions shift about 2.48 cm left and 1.70 cm right from original42.
This adjustment avoids unreachable arms and torso clipping encountered when retaining the original
follow-through weapon orientation. The original artist follow-through and v010 preview remain saved.

All six hand constraints are enabled on each of the nine transition frames. Maximum grip-point drift
in weapon space is 0.0113 mm. Frames 0, 24, 34, and 70 remain within 0.00028 mm of their baseline;
foot points differ from the original preview by at most 0.00043 mm. Isolated Blender reimport checks
find zero hammer intersections against tested torso/head/shoulder/leg triangles on all nine frames.
Arms/hands are excluded from this mesh check. The maximum sampled arm-joint rotation step is
26.35 degrees; numerical checks do not establish natural motion or final deformation quality.

The saved scene is paused at frame 34 with playback limited to 34-42. Other intervals remain held.
Review the corrected transition before extending smooth interpolation to wind-up and recovery.
Reports: `cascadeur-attack-work/grip-continuity-{apply-check,validation,mesh-check}.json`.
Preview: `cascadeur-attack-work/grip-continuity-preview.gif`; review export:
`cascadeur-attack-work/grip-continuity-review.fbx`. Experimental scripts and captures in this work
folder include rejected placements; the saved v011 uses `apply-searched-grip-continuity.py` and the
candidate recorded in `grip-placement-search.json`. Do not replay other placement experiments.

### Earlier transition preview

The artist-edited follow-through is preserved in `iron-vanguard-hammer-v009-blocking.casc`.
v010 adds a separate CLAMPED_BEZIER preview only across frames 34-42 on all 13 tracks, with playback
limited to that interval. All five pose keys are preserved within 0.00026 mm. Every sampled preview
frame retains all six hand constraints, and checked torso/head/shoulder/leg triangles have zero
hammer intersections (hands and arms excluded). Maximum sampled arm-joint rotation step is 17.23 degrees.
The endpoint grips differ: the left wrist shifts about 14.05 cm along the hammer shaft between
34 and 42; total wrist movement in weapon space is 16.13 cm left and 13.36 cm right. Enabled
constraints therefore do not establish a fixed grip across these differently authored keys.
This earlier preview is not a finished attack or approval of grip continuity. v011 above addresses
the sliding before expanding smooth motion to the full attack.
Reports: `cascadeur-attack-work/smooth-preview-{validation,mesh-check,hand-space}.json`; review export:
`cascadeur-attack-work/smooth-preview-review.fbx`.

The user accepted the revised frame-34 arms and right wrist as good enough on 2026-10-09.
v008 saves that artist pose with both hand attachments restored, held through frames 34-41.
Reattachment and interval revisits changed point positions by less than 0.00012 mm.
The other pose keys were not replaced by this strike pose. Overall attack approval, smooth motion,
and final grip polish remain pending. v007-wrist-work preserves the earlier manual-edit checkpoint.
Reports: `cascadeur-attack-work/accepted-strike-{reattach,interval}-check.json`.
The v006 clearance and export results below describe that earlier version; they have not been
rerun for the manually revised strike.

The user created the humanoid rig and imported the approved hold. The local MCP bridge was then used
to add native hammer rig elements and constrain both hands to `weapon_hammer_Triangle`.
Each hand's MainPoint, DirectionPoint, and AdditionalPoint has its Constraint setting enabled.
The scene is left on frame 34 in View mode. To pose the attached weapon, use Point Controller mode
and select its MainPoint, DirectionPoint, and AdditionalPoint together. The hands follow while their
constraints are enabled.

v006 preserves the user's approved hammer orientation and placement at frame 24 from
`iron-vanguard-hammer-v005-orientation.casc`, and applies the same rigid adjustment to the other
four pose keys and their held intervals. All six hand constraints are enabled across all 71 frames.
Maximum hand attachment difference between poses is 0.00392 mm; body point changes from the
pre-propagation poses remain below 0.1 mm. Existing foot drift remains about 3.51 mm.
Tested body-region intersections remain zero at all five keys; arms/hands remain outside that mesh
check. The isolated Blender FBX reimport preserves weapon-root positions within 0.00015 mm.
Reports: `cascadeur-attack-work/orientation-{key,attachment,mesh,roundtrip}-check.json`.
Review export: `cascadeur-attack-work/orientation-review.fbx`; current frame-24 capture:
`cascadeur-attack-work/orientation-final-24.png`. v005 preserves the user's adjustment before
propagation. The correction is approved only for hammer orientation at frame 24, not overall attack quality.

v004 contains five held pose keys: ready at frame 0, wind-up at 24, strike at 34, follow-through at 42,
and return to ready at 70. Every track uses STEP interpolation for this pose review. Playback jumps
between poses intentionally. These poses are unapproved studies; no smooth attack or finished timing
is claimed. The live scene is left at frame 24 in View mode. The original v003 attachment scene remains
preserved.

The strike and follow-through were revised after mesh checks detected contact with the right hip
armor. All five final pose keys now show zero weapon intersections against checked torso, head,
shoulder, and leg triangles. The check excludes arm/hand regions and does not establish complete
finger contact, armor quality, or future interpolated clearance. Both hands retain their attachment
across all 71 held frames (maximum relative point error 0.0013 mm). Maximum foot point drift from the
ready pose is approximately 3.5 mm; foot stability still needs refinement for continuous motion.

Native FBX export is enabled after the user's license activation. `cascadeur-attack-work/blocking-review.fbx`
reimports into isolated Blender with all five poses clear in the checked regions and weapon-root motion
matching across 71 frames (maximum error below 0.0001 mm). Retargeting this motion onto the canonical
Blender rig remains unverified. This review export does not modify that master.

Preview: `cascadeur-attack-work/blocking-preview.jpg`. Next: artist review of the poses, then refine
body mechanics, add breakdown poses, timing, arcs, recovery, and smooth interpolation.

## Validation and recovery

- Twelve tests moved the hammer by +/-2 cm and rotated it by +/-5 degrees on each axis.
- Maximum hand attachment error was approximately 0.0013 mm. Feet remained effectively stationary.
- The starting hold was restored, and all six constraints remained enabled after saving and reopening.
- Results and scripts: `output/iron-vanguard/cascadeur-weapon-work/`.
- Pre-change artist session: `output/iron-vanguard/iron-vanguard-hammer-v002.casc`.
- Intermediate weapon rig: `output/iron-vanguard/cascadeur-weapon-work/weapon-rig-checkpoint.casc`.

Numerical attachment tests do not establish natural posing or animation quality.

## Script bridge

Cascadeur's script MCP server listens at `http://127.0.0.1:8765/mcp`.
Run a reviewed local script in the current scene with:

```powershell
python scripts/iron-vanguard/cascadeur/mcp_call.py path/to/script.py --result path/to/result.json
```

Pause playback before bridge calls. During playback, a queued script can time out and execute only
after playback stops; inspect the scene/results before retrying a mutation.
Scripts run in Cascadeur's main thread and should finish within the server's 30-second limit.
Preserve a scene checkpoint before mutations. Use native scene edit transactions for undoable changes.
Reloading a scene invalidates object handles; reacquire them afterwards. The legacy rig's constraint
setting wrapper requires `object.Constraint.constraint_setting.id.set(1)` inside a scene edit;
calling the setting wrapper's direct `.set(1)` fails metadata lookup in this installation.

## Pose-work recovery and implementation notes (2026-10-09)

- Before blocking: `cascadeur-attack-work/user-session-before-blocking.casc`.
- Restarted user session: `cascadeur-attack-work/restarted-session.casc`.
- Stable attachment-only scene: `iron-vanguard-hammer-v003.casc`.
- Final held sequence: `iron-vanguard-hammer-v004.casc`; supersedes the individual pose studies.
- Reports: `blocking-check.json`, `blocking-tracks.json`, `blocking-attachment-check.json`,
  `blocking-mesh-check.json`, and `blocking-roundtrip-check.json` in `cascadeur-attack-work/`.
- Cascadeur stalled during earlier scripts that reloaded scene files. The successful resumed pass
  used bounded point edits and separate save/export calls without `ProjectLoader.load_from`.
  The exact cause of the stall is unproven; do not repeat in-callback scene reloads casually.
- `ProjectLoader.load_from` previously replaced scene contents without updating the application path.
  An explicit save path is required after loading; do not trust the displayed filename as a source indicator.
- Timeline channels have separate animated DataIds and SettingIds. Added frame ranges must initialize
  both, including the six hand-constraint switches. Copying only transform data leaves intermediate
  constraint settings at their default. This pass initialized 3,164 animated data channels and 54
  animated settings and verified all 71 frames after populating the held intervals.
- Source scripts and intermediate diagnostics remain in `cascadeur-attack-work/`; several early
  scripts include unsafe-for-this-session reload assumptions. Prefer the `*-bounded.py` variants
  and inspect their preconditions before replaying any operation.
