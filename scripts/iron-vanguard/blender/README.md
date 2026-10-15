# Iron Vanguard asset production

Status: first authored finger/grip, weapon-attachment, upper-body deformation, and limb-IK pass complete,
2026-10-08. Weapon proportions remain intentionally editable. Motion-specific refinement, materials,
runtime optimization, and game integration remain.

## Current rigging master

**Open `output/iron-vanguard/master-v021/iron-vanguard-master.blend`.** Use the `CANONICAL_Master` scene.

**Artist approval (2026-10-09):** the user approved both `IV_Hammer_Idle` and `IV_Sword_Idle`.
Approval metadata is stored on those actions and in `master-v020/idle-approval.json`, including curve
signatures. Preserve these approved loops when authoring separate attack actions. This approval covers
the idle loops; it does not complete the remaining asset or combat-animation work.


v021 adds a separate **Hammer attack** draft. Choose **Hammer attack**, then **Play attack** in the
sidebar. It plays frames 1-141 at 60 fps (about 2.35 seconds): wind-up 1-41, strike 42-65,
follow-through 66-81, recovery 82-141. It returns exactly to the artist hold. Auto-key stays off during
preview and is restored on return to a static hold. The original holds and approved idle curves are
unchanged. **The user rejected this attack on 2026-10-09. Do not use it as the motion-quality baseline.**

`author_hammer_attack.py` creates the isolated 115-frame path; `retime_hammer_attack.py` extends strike
and recovery while preserving that path. Both run in background Blender against copies. The final
candidate is `hammer-attack-work/draft-09/attack-candidate.blend`, with a 30 fps `hammer-attack.mp4`
review video alongside it. `master-v021/attack-validation.json` records 141 integer-frame body-clearance
checks and 281 half-frame attachment/scale samples: no detected triangle overlaps in the checked body
regions, maximum hand-target error 0.00051 mm, maximum half-frame limb rotation 3.87 degrees. Clearance
checks exclude hands and forearms, and do not establish finished grip anatomy, armor deformation, or
all forms of mesh penetration. No game export or combat timing integration has been performed.
Recovery: `master-v021/user-session-before-attack.blend`. The previous v020 master is preserved.

Cascadeur handoff (2026-10-09): the user rejected the v021 hammer attack. A separate transfer package
is in `output/iron-vanguard/cascadeur-transfer-v003/`. Import `01-iron-vanguard-rig-setup.fbx` using
Cascadeur's Scene preset in a new scene. It includes the deformation skeleton, root, skinned body,
and independent `weapon_hammer` / `weapon_hammer_tip` joints. It excludes Blender control bones and
the rejected attack. The companion `02-iron-vanguard-approved-hammer-hold.fbx` carries the same
skeleton with a two-frame stationary approved hold for later Animation import.

`export_cascadeur.py` builds this centimetre-scale transfer only in a background copy;
`verify_cascadeur_export.py` reimports both FBX files and checks skeleton names, mesh counts, and hold
alignment. The package has 61 bones and two meshes, with FBX roundtrip mesh/joint error below 0.002 mm.
`transfer-report.json` and `START-HERE.txt` record checks and the handoff. v001/v002 are incomplete
export diagnostics, superseded by v003. The live Blender master and approved actions were not changed.
The user imported and generated the humanoid rig in Cascadeur. The current Cascadeur working file is
`output/iron-vanguard/iron-vanguard-hammer-v018-shoulder-corrective.casc`, with native hammer controls and active constraints
for both hands. Twelve small translation/rotation tests and an actual save/reload check pass; the starting
hold is restored. These checks establish attachment behavior, not visual animation quality or large-arc
reach. See [Cascadeur workflow](../cascadeur/README.md). Attack key poses and animation return remain
unverified. Returning motion requires a separate test copy and either a bake to the deformation skeleton
with Blender IK disabled or retargeting to the existing controls. Cascadeur v004 now contains five held
pose keys (0, 24, 34, 42, 70), with attachment, tested body-region clearance, and isolated Blender
FBX reimport checks passing. These pose studies remain unapproved; smooth timing and canonical-rig
retargeting are unfinished. See the Cascadeur workflow for the preview and precise validation limits.
Cascadeur v006 applies the user-approved frame-24 hammer orientation and placement to all five held
poses, reconnects both hands, and passes attachment and tested body-clearance checks. Overall attack
quality remains unapproved; the canonical Blender master is unchanged.
v008 saves the user-accepted frame-34 arm/wrist revision, restores both hand attachments, and holds
it through frame 41. Reattachment and pose-persistence checks pass; smooth motion remains unfinished.
v009 preserves the artist follow-through edits. v010 previews smooth motion only from frames 34-42,
with pose keys preserved and checked body regions clear. Endpoint grip offsets differ, producing
hand movement along/around the handle in that preview. v011 corrects grip continuity on frames 34-42
with a revised follow-through hammer placement and elbows, preserving the accepted strike. All nine
frames pass tested body-region clearance; maximum sampled grip drift is 0.0113 mm. The other attack
intervals remain held, and arm/hand contact and motion quality still require review.
v012 extends the review through frames 24-42, adding a controlled wind-up-to-strike arc and elbow
paths while preserving the v011 follow-through. Grip and tested body-region clearance checks pass
on all 19 frames. v013 adds lead-in and recovery to make a full 0-70 draft, preserving the 24-42
swing. All 71 frames pass sampled grip and tested body-region clearance checks. Both ready
endpoints match. Timing, weight, arm/hand contact, and overall animation-quality review remain.
v014 retimes the strike to accelerate into frame 34 and lets the follow-through decelerate, preserving
the five main poses and existing lead-in/recovery. Sampled grips and tested body-region clearance pass.
It remains a review draft, saved paused at 0 with playback 0-70; see the Cascadeur workflow for limits.
A later arm/contact review found left cuff/hammer and right forearm/torso intersections, plus recovery
wrist pinching. These were excluded from the earlier body-clearance checks. v014 is unchanged.
v015 preserves the successful manual hammer-follow test and the artist corrections at 0, 24 and 42.
Temporary hammer pins are released. v016 blends those changes into the existing swing, preserves
the corrected pose keys and accepted strike, and matches frame 70 to the updated frame 0. All 71
frames pass target/constraint/loop checks and tested torso/head/shoulder/leg weapon clearance.
Forearm/cuff intersections remain in ready, wind-up and recovery spot checks; deformation and
motion quality still need review. See v016-validation.json and v016-mesh-check.json in
cascadeur-attack-work, with v016-contact-transitions-preview.gif for playback review.

v017 fixes the extra full turn of the left arm during recovery by changing only the left elbow
and its direction control on frames 43-69. The hammer path, both hand poses and five key poses
are retained within numerical evaluation tolerance; v016 is preserved. Accumulated-rotation
and continuous-quaternion loop checks verify removal of the extra revolution, which the earlier
per-frame angular checks missed. See v017-validation.json and v017-rotation-winding-check.json.
The corrected motion still needs artist review; existing contact/deformation cleanup remains.

Cascadeur v018 adds a localized shoulder-volume correction for the armpit collapse. Its isolated
Blender review file is `output/iron-vanguard/cascadeur-attack-work/v018-shoulder-corrective.blend`.
Seventy per-frame corrective shapes preserve the existing skeleton and hammer/hand motion while
reducing shoulder collapse. They are specific to the current 0-70 clip and must be rebuilt after
substantial pose or timing changes. The final native mesh uses smooth per-vertex normals to avoid
import shading issues. This is a review asset, not a general skin-weight fix or optimized runtime
export. Remaining armor folds and cuff/contact polish are unfinished. v017 and master-v021,
including the approved idle actions, are preserved. See the Cascadeur workflow for validation.
The user accepted the v018 shoulder result and timing for this iteration. A separate full-detail
GLB now runs in the local [browser swing test](http://localhost:3000/iron-vanguard-swing-test.html),
with authored/game timing presets and independent phase durations on one synchronized animation
clock. This does not retarget the motion into the canonical Blender rig or add it to the live roster.
`export_runtime_review.py` exports the native FBX; `capture_runtime_reference.py` generates the
independent 71-frame references. See the [runtime export/check commands](../cascadeur/README.md#local-browser-swing-test).


Earlier v020 idle work:

v020 adds **Hammer idle / Sword idle** and a **Play idle / Pause idle** button. Both idle actions are
separate copies of the artist's finished corrected holds. They run four seconds at 60 fps: play frames
1-240, with frame 241 duplicating frame 1 and cycle modifiers on the animated channels. The motion uses
subtle torso breathing, a 1 cm total lateral weight shift, 2 mm vertical settling, planted feet, torso-led
weapon movement, and a small relaxed-hand movement for the sword. There is no root travel.

Use the **Hammer hold / Sword hold** buttons to return to the static artist poses. Auto-key is disabled
for idle preview and restored on return to a hold. Original hold/action curve signatures are unchanged.
The active initial preview is `IV_Hammer_Idle`; the other new action is `IV_Sword_Idle`.

`author_idles.py` is the background authoring script. `master-v020/idle-validation.json` records all-frame
hand/foot attachment, loop closure, saved-file reload, and original-action preservation checks. Maximum
hand-to-weapon positional drift and foot drift are below 0.001 mm; maximum neighboring limb rotation is
0.023 degrees. The duplicate endpoint matches exactly, with a loop velocity mismatch below 0.004 mm/frame.
Rendered previews and front/side review frames are in `idle-work/candidate-v2/`; `hammer-idle.mp4` and
`sword-idle.mp4` are 24 fps review videos. This is a restrained first idle pass, not attack-animation or
collision-free mesh approval. Existing glove and cloth/armor deformation still need visual refinement.
Recovery copies: `master-v020/user-session-before-idles.blend` and
`idle-work/finished-holds-20261009-150822.blend`. The earlier `idle-work/candidate/` is superseded because
its first authoring pass did not key the intended hip weight shift.

Earlier v019 elbow correction:


v019 corrects the elbow bend orientation in the artist-adjusted hammer and sword holds. Use the
**Hammer hold / Sword hold** buttons at the top of **Pose the hold**, which load
`IV_Hammer_ElbowsCorrected` / `IV_Sword_ElbowsCorrected`. These preserve the artist's weapon transforms
and hand orientations; maximum wrist position change was 0.026 mm. Earlier templates remain in advanced
settings for recovery and comparison and do not contain this correction.

The original arm IK was calibrated against a nearly straight bind pose. Its solved forearm flexion axis
had a negative local X component, unlike the reference source motion, twisting the upper-arm armor inward.
`correct_elbows.py` derives a positive flexion axis from source frame 1, matches the current elbow bend
angle, and keys a forearm rotation seed plus calibrated IK pole angle in separate corrected actions.
The elbow positions stay within 0.024 mm of their previous locations. Historical rig actions receive
explicit keys for the original pole angles so those values cannot leak between actions. Rest bones,
skin weights, weapon geometry, and existing animation channels are unchanged.

Recovery: `master-v019/user-session-before-elbow-apply.blend` and
`elbow-work/before-elbows-20261009-145301.blend`. Evidence in `elbow-work/candidate/` includes front/side
before-and-after renders, `elbow-validation.json`, and `motion-validation.json`. Source body-bone poses
were unchanged across all 239 frames. Each corrected hold was tested through 121 samples of small weapon
translations (up to 2 cm) and rotations (8 degrees); maximum adjacent joint rotation was 0.80 degrees,
with no snapping in this tested range. Large attack arcs and near-straight reaches still need animation
review. Grip anatomy and cloth/armor deformation remain unfinished.

Earlier v018 control work:


v018 adds a **Pose the hold** sidebar with **Move / Rotate** buttons for the weapon and each hand,
and **Move** buttons for the elbows. It exposes the actual grip targets with visible custom shapes,
hides driven proxies and unrelated bones, and selects the matching Blender gizmo. No bone names or
console commands are needed for this workflow. Existing hand targets retain their internal names for
animation compatibility; no rest bones, constraints, mesh weights, or weapon transforms were changed.

The active action is a separate `IV_Hammer_Posing` copy. **Remember moves automatically** enables
Blender auto-keying, and **Keep pose at this frame** explicitly keys the five posing controls and hand
curl properties. Ctrl+S saves the file. Existing poses/settings are in the collapsed **Pose library and
advanced settings** section. Switching poses replaces the displayed pose: key and save edits first.
Run the packaged `IV_RIG_TOOLS.py` after reopening if the sidebar is not registered in that Blender session.

`master-v018/user-session-before-controls.blend` preserves the live session before this change.
`simplify_controls.py` installs this revision only on its separate v018 working file;
`validate_simple_controls.py` exercises actual Blender move/rotate operators on a disposable action.
The hammer test covers both hands, weapon, elbows, and keyframe reload: hand target errors below
0.04 mm, matching wrist orientation, and exact restoration of the starting pose. The viewport screenshot
`master-v018/posing-panel.png` confirms visible buttons and movement arrows. These checks establish
control behavior only. **Arm alignment, believable grips, and hand deformation remain unfinished.**

Earlier v017 pose work:

**v015's automatic fit was rejected in visual review:** the hands closed beside the shaft rather than
around it. Passing attachment tests did not establish a believable grip. v017 adds **Hammer grip
correction / Sword grip correction**, using centered hand placement and retaining the weapon transforms.
The corrected poses and movement checks are exposed in the sidebar. The live pre-apply session is
preserved in `master-v016/user-session-before-apply.blend`.

v016 is the background candidate; v017 retains the live session and adds the corrected actions.

This is a placement correction, **not a finished grip**: close-up finger deformation still needs proper
joint/weight refinement before animation approval. The rejected automatic poses remain only for recovery.
Do not use `refine_contacts.py`'s surface-distance optimization as a grip-quality acceptance test.
`correct_grip_placement.py` records the correction; `correction-review.json` distinguishes the successful
attachment check from the unfinished visual work.

Historical v015 work (superseded):

v015 adds **Hammer fitted grip / Sword fitted grip** (`IV_Hammer_ContactHold` / `IV_Sword_ContactHold`),
with hand target offsets, individual curls, thumb opposition, and localized glove-weight cleanup.
Weapon transforms and bind geometry are unchanged. The open session was backed up to
`output/iron-vanguard/grip-work/user-session-before.blend`. v011–v014 are development candidates.

Use **Hammer grip check / Sword grip check** and play frames 1–91 to review small weapon translations
and rotations. Both checks keep the hands attached within 0.05 mm without bone stretching. These are
attachment tests, not finished idle animations. `contact-validation.json` records the motion checks and
approximate surface-distance measurements; thin glove-armor edges still crease at tight bends and
localized overlaps remain. Do not treat this as collision-free final hand topology.

2,991 hand vertices have revised weights; the rest of the body is unchanged. The existing source bone
animation is verified across all 239 frames, though the hand surface deforms differently with its improved
weights. Neutral hand-target channels are added to older actions to prevent stale offsets when switching.
`preservation-validation.json` records bind/rest/weapon preservation, source-bone motion, normalized
four-influence skinning, action persistence, and pose switching. No corrective shape keys were retained.

The earlier v010 hold foundation follows:

v010 preserves the live artist session and adds `IV_Hammer_NaturalHold` and `IV_Sword_NaturalHold`.
These refine the spine, clavicles, elbow bend direction, and sword free arm while retaining the user's
weapon mesh placement corrections. The original grip actions remain unchanged. The live session before
the addition is backed up as `master-v010/user-session-before.blend`; v009 is the background pose candidate.
`master-v010/hold-validation.json` verifies unchanged existing action curves, body geometry/weights, rig rest
matrices, and weapon fits, plus hand IK errors below 0.04 mm and sidebar selection.

The earlier v008 rigging foundation follows:
This revision was built from the user's saved, resized v004 master; that input file is unchanged.
v005–v007 are development checkpoints. Do not run `build_master.py` to continue artistic work: it starts
from the intake and does not preserve hand edits.

### Use in Blender

1. In the Text Editor, select **IV_RIG_TOOLS.py** and click **Run Script** once.
   This enables the **iBrawls** tab in the 3D View sidebar (N). It is optional; all controls are also
   ordinary pose bones and custom properties. The sidebar script is packaged in the blend and in
   `scripts/iron-vanguard/blender/rig_ui.py`; no add-on installation or automatic script execution is required.
2. Load **Hammer grip correction** or **Sword grip correction**, then **Duplicate action for editing** before authoring changes.
   The **Hammer grip** and **Sword grip** buttons still load the original poses for comparison.
3. Select `IV_Rig`, enter Pose Mode, and move `CTRL_Hammer` or `CTRL_Sword` for the equipped weapon.
   The arm IK follows its grip targets. Elbow pole rings adjust bend direction.
4. Use the hand **Grip**, individual digit **Curl**, and **Thumb Opposition** sliders to refine contact.
   The hammer preset uses both hands; the sword preset relaxes the left hand beside the body.
5. **Free IK from current pose** creates an editable action copy, releases weapon following, and matches
   the hand/foot controls to the evaluated pose. Move hand/foot rings and elbow/knee poles to pose.
   Per-limb IK influence blends between source FK and IK; arbitrary manual blend changes are not an
   automatic FK/IK matching operation. The Free IK button performs the matched transition.
6. Save artistic edits to a new versioned Blender file. `output/` is gitignored, so back up these masters separately.

### Future weapon resizing

The user's working sizes are retained: hammer approximately **1.32 m** long, sword approximately **0.84 m** long.
Their original nonuniform mesh scales were baked into the weapon meshes and corresponding markers.

Use the sidebar **Hammer/Sword size X/Y/Z** properties on `IV_Rig` for later resizing.
A value of 1 is the user's baseline. These properties scale the weapon assembly and its grip anchors together,
including the hammer's support-hand target. Avoid scaling only the mesh object, which would bypass the anchor setup.
The primary grip stays at the assembly origin. **Diameter changes still need a finger-curl/contact review**;
the rig preserves anchor alignment, not automatic finger collision solving. Large length changes can exceed arm reach.

The dependency order is weapon control → grip target bones → hand controls → arm IK. All control dependencies
are inside the armature; rendered weapon objects follow the weapon control. This avoids a hand/weapon/offhand
dependency cycle. In v018, the three hand grip targets are exposed in **Grip Controls**; the anchor mechanisms remain hidden.
Use the sidebar hand Move/Rotate buttons for grip placement. Marker empties retain the weapon-local contact
and tip/impact references.

### Changes and evidence

- **30 new finger deform bones**, three per digit on each hand, with transferred hand weights.
  Both hands have whole-hand curl, per-digit offsets, and thumb-opposition controls.
- **77 total bones**: the 31-bone foundation, 30 finger joints, ten animator controls, and six grip mechanism bones.
- Arm and leg IK with elbow/knee poles, wrist/ankle orientation controls, and disabled IK stretching.
- Authored `IV_Hammer_Grip` and `IV_Sword_Grip` actions. Existing source actions disable new IK/grip controls
  and preserve the original body-bone motion.
- Upper-body weights smoothed across torso, shoulders, sleeves and cuffs with blended region boundaries.
  Helmet influence is made more rigid toward Head with a neck transition. Vertex positions/topology are unchanged.
  The before/after stills use the same source frame and camera. Fine armor folding and motion-specific corrective
  poses remain animation-polish work; this pass does not certify collision-free motion in every pose.
- Original weights are saved in `original-skin-weights.npz`; source v004 remains the authoritative untouched backup.

The earlier v008 `rigging-validation.json` records verification of all 239 source-animation frames, ten digit controls,
normalized skin weights with at most four influences, matched free-IK switching, and independent hand/foot targets.
Eight size cases (baseline, 0.85×, 1.15×, and one nonuniform case for each weapon) retain the grip anchors;
measured hand/socket errors stay below **0.04 mm**. A character-only baked grip GLB round trip preserves sampled
surface positions within **0.05 mm**. This smoke GLB is unoptimized and is not the runtime control-rig contract.

Review `master-overview.png`, `hammer-grip.png`, `sword-grip.png`, front/reverse hand close-ups,
`hammer-support-hand.png`, and `torso-before.png` / `torso-after.png` beside the master.

### Reproduce or verify this pass

The upgrade script is for a v004-style foundation that does not already have these controls.
It reads the **saved input blend**, not the raw intake, and refuses to overwrite an existing output.
For further work on the current rig, edit the saved master rather than rerunning the upgrade.

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/rig_master.py -- --source output/iron-vanguard/master-v004/iron-vanguard-master.blend --output output/iron-vanguard/master-v009
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/validate_rigging.py -- output/iron-vanguard/master-v008
```

Validation does not save changes to either blend. It regenerates review outputs and a character-only smoke GLB.
Baking evaluated deform-bone motion is required for game export; the Blender control rig itself is for authoring.

## Canonical foundation (historical v004)

Open `output/iron-vanguard/master-v004/iron-vanguard-master.blend` and use the
`CANONICAL_Master` scene. This is the historical FK foundation. Its user-resized weapon meshes are the input to the current rigging master. Source scenes and their actions remain inside the file.

- Body: `IV_Body`; armature: `IV_Rig`.
- Height: **1.8 metres**, using the current medium-player convention as the working default.
- Coordinates: one metre per unit, floor at Z=0, body centred in XY, **+Y forward / +Z up**.
  Standard glTF Y-up export produces **-Z forward / +Y up**. Body and rig object transforms are identity.
- Skeleton: the original 28 bones plus non-deforming `root`, `weapon_socket_r`, and `weapon_socket_l`.
  Original deform-bone names, rest shape, topology, and weights are retained.
- Bone collections separate source FK bones, root, and provisional sockets. Arrow empties show socket heads.
- Actions: `IV_Bind`, `IV_SourceMotion_Root`, and `IV_SourceMotion_InPlace`.
  Select the rig, open the Action Editor, and choose one of these actions. They are also marked as action assets.
  Motion is baked at 60 FPS over frames 1–239 with continuous quaternion signs and linear sampled curves.
- `root` carries horizontal displacement; Hips retains vertical motion and orientation. The in-place copy zeros
  only root translation. No source motion smoothing, contact cleanup, or new combat animation is implied.
- Weapons are in `04_Weapon_Prep`, staged beside the character at the same uniform scale factor as the body.
  Their assembly origins are provisional primary grips; support/impact/tip markers are editable empties.
  **They are not attached or fitted to closed hands yet.** The hammer remains taller than the character at source proportions.
- All source textures are packed. The character still lacks a supplied base-color texture.
  `START_HERE` inside the Blender Text Editor records the essential handoff.

The rest-pose conversion and baked motion were checked across **239 frames / 28 source bones**:
maximum joint-position error **0.003 mm**, zero unweighted vertices, at most four skin influences,
and negligible socket drift. In-place motion preserves Z and subtracts only the root's XY displacement.
These checks establish faithful transfer, not animation quality; visible torso/shoulder deformation still needs cleanup.

`validation.json`, `master-manifest.json`, the overview, and six motion stills sit next to the master.
The unoptimized `canonical-character-smoke.glb` contains one character mesh, one skin, one travelling clip,
and the root/socket bones. Blender reimport passed sampled surface checks at frames 1, 97, and 239
with maximum error below **0.015 mm**. This is a pipeline check, not the shipping asset or a browser performance test.
The master and original FBX hashes were unchanged during validation.

### Rebuild and validate

The builder starts from the intake, not an artist's edited master. It refuses to overwrite an existing master.
Use a fresh output directory for a rebuild; **save hand-edited masters as new Blender versions** and never
regenerate over them.

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/build_master.py -- --output output/iron-vanguard/master-v005 --height 1.8
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/validate_master.py -- output/iron-vanguard/master-v005
```

Validation reopens the master read-only and regenerates review outputs without saving scene changes.
The GLB export explicitly uses the active scene **and** selected rig/body, excluding source scenes and weapon staging.
The Blender importer creates its own bone-display Icosphere; the validator checks actual GLB mesh/skin counts
and the imported skinned mesh, rather than mistaking that helper for an exported model.

## Source and review

Original assets: `reference/Meshy_AI_Iron_Vanguard_biped (1)/Meshy_AI_Iron_Vanguard_biped/`.
Treat original FBXs and textures as immutable. Work on versioned Blender copies.

Local review file: `output/iron-vanguard/intake/iron-vanguard-source-review.blend`.
It has separate scenes for character, animation, hammer, and sword. Images are packed.
The animation scene imports with its short source action active; select the action ending
in `retarget_clip|BaseLayer` to review the substantial clip. The render script explicitly
selects it for motion samples. This is a raw source review, not a fitted production rig.

Evidence in the same directory:
- `source-audit.json`: source hashes, bones, hierarchy, dimensions, topology, actions, textures.
- `review-details.json`: material nodes, rig comparison, sampled hip trajectory.
- `character-front.png`, `hammer-front.png`, `sword-front.png`: geometry review.
- `animation-001.png` through `animation-239.png`: six motion samples.

The PNGs use Blender Workbench material shading: they review geometry and poses, not final textured appearance.
The entire `output/` directory is already gitignored. Back up hand-edited Blender masters separately;
the scripts and source references do not substitute for backing up new artistic work.

## Intake findings

| Asset | Imported size | Triangles | Texture findings |
| --- | --- | ---: | --- |
| Character | 1.70 high | 197,776 | One 2K normal map; no base-color texture or vertex colors found |
| Animation mesh | 1.70 high | 197,773 | No image textures linked |
| Hammer | 1.905 long | 139,275 | Four linked 4K maps |
| Sword / plasma katar | 0.424 long | 177,650 | Four linked 4K maps |

Dimensions are raw Blender import units, not approved game dimensions. Weapon lengths use their longest bounding-box axes.
The current gameplay profiles use standing heights 1.8 (medium) and 2.2 (large), but this does not decide the new character's visual height.

Both character FBXs contain 28 bones, with `Hips` as root, `RightHand` and `LeftHand` plus hand-end bones,
and no articulated fingers, dedicated grip sockets, or separate motion-root bone. Hands are visibly open.
The substantial imported action spans approximately frames 1–239 at 60 FPS (3.97 seconds).
The animation file also has a roughly one-frame take; the character file has a static action.

**Correction after canonical-master validation:** the earlier intake comparison reported a 90-degree
world-space rest mismatch using stale inactive-scene object transforms. The animation FBX applies an
armature-object rotation. After activating and evaluating each scene, the source rigs have matching world-space
rest orientations (0-degree measured maximum difference). Their raw local matrices still differ.
The master builder evaluates the source object animation and bakes world-space deformation onto the normalized
canonical rig; directly copying only bone F-curves would omit the object transform. The intake reviewer now evaluates both scenes correctly.

The sampled motion has horizontal hip travel. Decide how to extract or remove that travel before exporting
in-place locomotion. A single action may contain multiple gestures; clip segmentation needs full playback review.
Motion stills show torso/shoulder deformation requiring closer inspection; the source is not animation-quality approved.

## Production milestones

1. **Canonical Blender master.** Confirm whether the supplied mesh/rig is the production foundation or a reference
   for a rebuild. Establish character height, floor origin, facing direction, rest pose, bone naming, and one
   authoritative skeleton. Resolve FBX rest-basis differences and inspect weight deformation. Preserve source takes.
2. **Hands and weapon fitting.** Establish believable closed-hand shapes through finger rigging/weights or deliberate
   grip shape keys. Fit the hammer and katar to the hand anatomy, then choose their visual sizes. Create named
   `weapon_socket_r` / `weapon_socket_l` attachments and weapon-local primary grip, support grip, and impact/tip
   markers. Fit the hammer's support hand with IK; check wrists and forearms across the whole swing.
   The katar needs a fist-grip fit and blade-forward alignment.
3. **Animation control rig.** Add animator-facing hand/foot IK, pole controls, root control, and appropriate IK/FK
   switching while keeping a stable export skeleton. Use Blender as the authoritative master. Cascadeur is optional
   for motion experiments; round-trip through a duplicate and bake/validate back onto the canonical rig.
4. **First playable slice.** Deliver idle/carry, walk/run, hammer windup/strike/recovery, and sword slash/lunge/recovery
   with fixed grips and deliberate contact timing. Prove a GLB round trip in an isolated Three.js review before
   changing gameplay defaults. Gameplay movement, collisions, and combat timing remain authoritative.
5. **Complete motion set.** Add crouch transitions/locomotion, jump/land, slide/recovery, weapon switching,
   hit/death, and ball carry/run/jab/throw as required. Define first-person treatment separately.
6. **Shipping assets.** Preserve high-resolution masters; produce reviewed runtime meshes/LODs and texture budgets.
   Bake constraints to export bones, validate GLB names/transforms/skin/clip loops/sockets, then apply measured
   glTF optimization. Verify primary/support grip drift, planted feet, transitions, and performance with a full roster.

Each milestone should end with a saved Blender master, renders or motion previews, and a short record of accepted
scale/rig/animation decisions. Do not run the older V3 authoring scripts against this new character.

## Reproduce intake

Run from the repository root in PowerShell (substitute the Blender executable if needed):

```powershell
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/inspect_sources.py
& 'F:\Tools\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python-exit-code 1 --python scripts/iron-vanguard/blender/review_sources.py
```

The importer refuses to replace an existing review blend. For a new intake, append
`-- --output output/iron-vanguard/intake-02`; pass that same directory to the reviewer as
`-- output/iron-vanguard/intake-02`. Run in a background process, separate from an artist's open Blender session.


## Hold refinement and live Blender connection

`refine_holds.py --source <saved.blend> --output <new-directory>` creates separate natural-hold actions
without rebuilding the rig or overwriting a master. It preserves weapon placement and renders multiple views.
`validate_holds.py <master-directory>` compares a final master against its `user-session-before.blend` backup.

The currently running Blender extension is `extensions/user_default/mcp`, using null-delimited JSON
execute requests on localhost:9876. `live_call.py <script.py> --result <result.json>` supports that protocol;
the supplied script returns a JSON-serializable `result` dictionary. The older V3 `mcp-call.cjs` targets a
different add-on protocol and does not work with this extension. Save a uniquely named copy of the live
session before changes; never replace a user session with a background file that could omit unsaved edits.

`refine_contacts.py` fits hand target transforms and finger controls against the weapon meshes.
`finalize_contacts.py` saves the reviewed v015 candidate with grip-check actions; `validate_contacts.py`
reopens it and verifies preservation against the live-session backup. The latter two scripts target the
recorded revision paths and are review/reproduction scripts, not commands to rerun over an artist master.
